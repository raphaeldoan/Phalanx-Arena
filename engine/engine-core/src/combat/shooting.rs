use super::*;

pub fn apply_shoot(state: &mut GameState, action: &Action) -> Result<(), EngineError> {
    let Action::Shoot { unit_id, target_id } = action else {
        return Err(EngineError::InvalidAction(
            "expected shoot action".to_string(),
        ));
    };

    let attacker_index = validate_active_unit(state, unit_id)?;
    let attacker = state.units[attacker_index].clone();
    let pip_cost = single_action_pip_cost(state, &attacker, "shoot", &[])
        .ok_or_else(|| EngineError::InvalidAction("illegal shot.".to_string()))?;
    apply_shoot_with_pip_cost(state, unit_id, target_id, pip_cost)
}

pub fn apply_shoot_with_pip_cost(
    state: &mut GameState,
    unit_id: &str,
    target_id: &str,
    pip_cost: i32,
) -> Result<(), EngineError> {
    let attacker_index = validate_active_unit(state, unit_id)?;
    let attacker = state.units[attacker_index].clone();
    let defender_index = find_unit(state, target_id)
        .ok_or_else(|| EngineError::InvalidAction(format!("unknown unit id: {target_id}")))?;
    let defender = state.units[defender_index].clone();

    if !adjacent_enemies(state, &attacker).is_empty() {
        return Err(EngineError::InvalidAction(
            "illegal shot while adjacent to an enemy.".to_string(),
        ));
    }
    shot_range_to_target(state, &attacker, &defender)
        .ok_or_else(|| EngineError::InvalidAction("illegal shot.".to_string()))?;
    if pip_cost > state.pips_remaining {
        return Err(EngineError::InvalidAction("No PIPs remain.".to_string()));
    }

    state.units[attacker_index].activated_this_bound = true;
    state.pips_remaining -= pip_cost;
    state.pending_shots.push(PendingShot {
        unit_id: attacker.id.clone(),
        target_id: defender.id.clone(),
    });
    append_log(
        state,
        format!(
            "{} {} prepared missile fire at {} {}; it will resolve at end_bound.",
            format_army(&attacker.army),
            attacker.name,
            format_army(&defender.army),
            defender.name
        ),
    );
    sync_army_pips(state);
    Ok(())
}

pub(crate) fn resolve_pending_shots(state: &mut GameState) {
    let active_army = state.current_player.clone();
    let pending_shots = std::mem::take(&mut state.pending_shots);
    let mut resolving = Vec::new();
    let mut retained = Vec::new();

    for shot in pending_shots {
        let should_resolve =
            find_unit_ref(state, &shot.unit_id).is_some_and(|unit| unit.army == active_army);
        if should_resolve {
            resolving.push(shot);
        } else {
            retained.push(shot);
        }
    }
    state.pending_shots = retained;

    if resolving.is_empty() {
        return;
    }

    let shot_count = resolving.len();
    append_log(
        state,
        format!(
            "{} resolved {} prepared missile shot{}.",
            format_army(&active_army),
            shot_count,
            if shot_count == 1 { "" } else { "s" }
        ),
    );

    for shot in resolving {
        if let Err(reason) = resolve_pending_shot(state, &shot) {
            append_log(
                state,
                format!(
                    "Prepared missile fire {} -> {} had no effect: {}.",
                    shot.unit_id, shot.target_id, reason
                ),
            );
        }
    }

    sync_army_pips(state);
}

fn resolve_pending_shot(state: &mut GameState, shot: &PendingShot) -> Result<(), String> {
    let attacker_index =
        find_unit(state, &shot.unit_id).ok_or_else(|| "shooter no longer exists".to_string())?;
    let attacker = state.units[attacker_index].clone();
    if attacker.eliminated || attacker.off_map {
        return Err("shooter is no longer able to fire".to_string());
    }
    if attacker.army != state.current_player {
        return Err("shooter is no longer the active army".to_string());
    }
    if !adjacent_enemies(state, &attacker).is_empty() {
        return Err("shooter is now adjacent to an enemy".to_string());
    }
    let defender_index =
        find_unit(state, &shot.target_id).ok_or_else(|| "target no longer exists".to_string())?;
    let defender = state.units[defender_index].clone();
    if defender.eliminated || defender.off_map {
        return Err("target is no longer present".to_string());
    }
    let range = shot_range_to_target(state, &attacker, &defender)
        .ok_or_else(|| "target is no longer visible or in range".to_string())?;

    let attacker_score = missile_attack_score(state, &attacker, &defender);
    let attacker_roll = local_combat_die_roll(state, "missile", &attacker, &defender, &attacker);
    let attacker_total = attacker_score + attacker_roll;
    let defender_score = missile_defense_score(state, &defender);
    let defender_roll = local_combat_die_roll(state, "missile", &attacker, &defender, &defender);
    let defender_total = defender_score + defender_roll;
    append_log(
        state,
        format!(
            "{} {} shot at {} {} ({} vs {}).",
            format_army(&attacker.army),
            attacker.name,
            format_army(&defender.army),
            defender.name,
            attacker_total,
            defender_total
        ),
    );

    let differential = attacker_total - defender_total;
    let outcome = resolve_missile_outcome(state, &attacker, &defender, differential);
    let mut final_outcome = outcome;
    match outcome {
        "destroy" => {
            let message = if differential == 1 {
                format!(
                    "{} {} was destroyed by concentrated missile fire.",
                    format_army(&defender.army),
                    defender.name
                )
            } else {
                format!(
                    "{} {} was destroyed by missile fire.",
                    format_army(&defender.army),
                    defender.name
                )
            };
            eliminate_unit(state, &defender, message);
        }
        "flee" => {
            if flee_unit(state, &defender, &attacker).is_none() {
                eliminate_unit(
                    state,
                    &defender,
                    format!(
                        "{} {} had no route to flee from missile fire.",
                        format_army(&defender.army),
                        defender.name
                    ),
                );
                final_outcome = "destroy";
            }
        }
        "recoil" => {
            if !recoil_unit(state, &defender, &attacker) {
                eliminate_unit(
                    state,
                    &defender,
                    format!(
                        "{} {} had no room to recoil from missile fire.",
                        format_army(&defender.army),
                        defender.name
                    ),
                );
                final_outcome = "destroy";
            }
        }
        "no_effect" if missile_cover_blunts_narrow_hit(state, &defender) => {
            append_log(
                state,
                format!(
                    "Cover blunted the missiles against {} {}.",
                    format_army(&defender.army),
                    defender.name
                ),
            );
        }
        _ => append_log(
            state,
            "The missiles caused no significant effect.".to_string(),
        ),
    }

    record_combat_resolution(
        state,
        CombatResolution {
            kind: CombatKind::Missile,
            attacker_id: attacker.id.clone(),
            attacker_name: attacker.name.clone(),
            attacker_position: attacker.position.clone(),
            defender_id: defender.id.clone(),
            defender_name: defender.name.clone(),
            defender_position: defender.position.clone(),
            attacker_score,
            attacker_roll,
            attacker_total,
            defender_score,
            defender_roll,
            defender_total,
            attacker_notes: missile_modifier_notes(state, &attacker, &defender),
            defender_notes: missile_defense_notes(state, &defender, &attacker),
            aspect: None,
            range: Some(range),
            differential,
            outcome: final_outcome.to_string(),
            winner_id: if differential > 0 {
                Some(attacker.id.clone())
            } else {
                None
            },
            loser_id: if differential > 0 {
                Some(defender.id.clone())
            } else {
                None
            },
        },
    );
    let resolution = state
        .recent_resolutions
        .last()
        .cloned()
        .expect("just pushed");
    append_combat_summary(state, &resolution);
    if matches!(
        get_unit_class(&defender),
        UnitClass::Elephant | UnitClass::Chariot
    ) && find_unit_ref(state, &defender.id).is_some_and(|unit| !unit.eliminated)
    {
        let trigger = if get_unit_class(&defender) == UnitClass::Chariot
            && matches!(
                attacker.kind,
                UnitKind::Psiloi | UnitKind::Slinger | UnitKind::Bow | UnitKind::BowCavalry
            ) {
            Some(PanicTrigger::ShotByLightTroops)
        } else if final_outcome != "no_effect" {
            Some(PanicTrigger::MissileDisorder)
        } else {
            None
        };
        if let Some(trigger) = trigger {
            resolve_panic_test(state, &defender.id, trigger, Some(attacker.clone()));
        }
    }
    Ok(())
}

pub(crate) fn visible_enemies_in_sector(
    state: &GameState,
    unit: &Unit,
    occupied: &HashMap<(i32, i32), String>,
) -> Vec<(Unit, i32)> {
    crate::rules_shared::visible_enemies_in_sector(state, unit, occupied)
        .into_iter()
        .map(|(target, range)| (target.clone(), range))
        .collect()
}

pub(crate) fn shot_range_to_target(
    state: &GameState,
    attacker: &Unit,
    defender: &Unit,
) -> Option<i32> {
    let occupied = occupied_cells(state);
    visible_enemies_in_sector(state, attacker, &occupied)
        .into_iter()
        .find(|(target, _)| target.id == defender.id)
        .map(|(_, range)| range)
}

pub(crate) fn narrow_missile_outcome(
    state: &GameState,
    attacker: &Unit,
    defender: &Unit,
) -> &'static str {
    if missile_cover_blunts_narrow_hit(state, defender) {
        return "no_effect";
    }
    if defender.kind == UnitKind::ScythedChariots {
        return "flee";
    }
    if defender.kind == UnitKind::Elephants {
        return if attacker.kind == UnitKind::Artillery {
            "destroy"
        } else {
            "recoil"
        };
    }
    if defender.kind == UnitKind::Horde {
        return "recoil";
    }
    if matches!(defender.kind, UnitKind::LightHorse | UnitKind::BowCavalry)
        && attacker.kind == UnitKind::Artillery
    {
        return "flee";
    }
    if should_destroy_by_missile_narrow_hit(state, attacker, defender) {
        return "destroy";
    }
    "recoil"
}

pub(crate) fn doubled_missile_outcome(
    state: &GameState,
    attacker: &Unit,
    defender: &Unit,
) -> &'static str {
    if defender.kind == UnitKind::ScythedChariots {
        return "flee";
    }
    if matches!(defender.kind, UnitKind::LightHorse | UnitKind::BowCavalry) {
        return if matches!(
            attacker.kind,
            UnitKind::Psiloi | UnitKind::Slinger | UnitKind::Bow | UnitKind::Artillery
        ) || !terrain_counts_as_good(terrain_for_unit(state, defender))
        {
            "destroy"
        } else {
            "flee"
        };
    }
    "destroy"
}

pub(crate) fn should_destroy_by_missile_narrow_hit(
    state: &GameState,
    attacker: &Unit,
    defender: &Unit,
) -> bool {
    let terrain = terrain_for_unit(state, defender);
    if matches!(
        defender.kind,
        UnitKind::Bow | UnitKind::Slinger | UnitKind::Psiloi
    ) && terrain != TerrainType::Forest
    {
        return true;
    }
    if is_mounted(&defender.kind) && attacker.kind == UnitKind::Bow && terrain == TerrainType::Open
    {
        return true;
    }
    false
}

pub(crate) fn missile_cover_blunts_narrow_hit(state: &GameState, defender: &Unit) -> bool {
    let terrain = terrain_for_unit(state, defender);
    terrain == TerrainType::Forest
        && !matches!(
            defender.kind,
            UnitKind::Bow | UnitKind::Slinger | UnitKind::Psiloi
        )
}

pub(crate) fn missile_modifier_notes(
    state: &GameState,
    attacker: &Unit,
    defender: &Unit,
) -> Vec<String> {
    crate::rules_shared::missile_modifier_notes(state, attacker, defender)
}

pub(crate) fn missile_defense_notes(
    state: &GameState,
    defender: &Unit,
    _attacker: &Unit,
) -> Vec<String> {
    crate::rules_shared::missile_defense_notes(state, defender)
}

pub fn missile_attack_score(state: &GameState, attacker: &Unit, defender: &Unit) -> i32 {
    crate::rules_shared::missile_attack_score(state, attacker, defender)
}

pub fn missile_defense_score(state: &GameState, defender: &Unit) -> i32 {
    crate::rules_shared::missile_defense_score(state, defender)
}

pub fn resolve_missile_outcome(
    state: &GameState,
    attacker: &Unit,
    defender: &Unit,
    differential: i32,
) -> &'static str {
    if differential <= 0 {
        return "no_effect";
    }
    if differential >= 2 {
        return doubled_missile_outcome(state, attacker, defender);
    }
    narrow_missile_outcome(state, attacker, defender)
}
