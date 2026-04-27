use super::*;

pub fn end_bound(state: &mut GameState) -> Result<(), EngineError> {
    if state.phase != GamePhase::Battle {
        return Err(EngineError::InvalidAction(
            "Bounds only exist once the battle has started.".to_string(),
        ));
    }

    ensure_armies(state);
    let shaken_at_bound_start: HashMap<ArmyId, bool> = state
        .armies
        .iter()
        .map(|army| (army.id.clone(), army.shaken))
        .collect();
    refresh_command_status(state, false);
    append_log(
        state,
        format!("{} ended the bound.", format_army(&state.current_player)),
    );
    resolve_pending_shots(state);
    update_all_pike_disorder_from_contacts(state);
    resolve_close_combats(state)?;
    clear_charging_status(state);
    check_army_morale(state, &shaken_at_bound_start);
    update_victory_state(state);
    if game_is_over(state) {
        return Ok(());
    }
    resolve_residual_contacts(state);

    state.current_player = enemy_army(&state.current_player);
    state.bound_number += 1;
    for unit in &mut state.units {
        unit.activated_this_bound = false;
    }

    state.last_pip_roll = FIXED_PIPS_PER_BOUND;
    state.pips_remaining = FIXED_PIPS_PER_BOUND;
    process_start_of_bound_formation_states(state, state.current_player.clone());
    rally_disorder(state, state.current_player.clone());
    refresh_command_status(state, true);
    sync_army_pips(state);
    update_victory_state(state);
    if game_is_over(state) {
        return Ok(());
    }
    append_log(
        state,
        format!(
            "{} begins bound {} with {} PIPs.",
            format_army(&state.current_player),
            state.bound_number,
            FIXED_PIPS_PER_BOUND
        ),
    );
    Ok(())
}

#[derive(Clone)]
struct CloseCombatPlan {
    attacker: Unit,
    defender: Unit,
    attacker_aspect: String,
    attacker_notes: Vec<String>,
    defender_notes: Vec<String>,
    attacker_score: i32,
    attacker_roll: i32,
    attacker_total: i32,
    defender_score: i32,
    defender_roll: i32,
    defender_total: i32,
    differential: i32,
    outcome: &'static str,
    winner: Option<Unit>,
    loser: Option<Unit>,
    winner_aspect: Option<String>,
    frontage_lane: Option<i32>,
}

pub fn resolve_close_combats(state: &mut GameState) -> Result<(), EngineError> {
    let engagements = build_combat_pairs(state);
    if engagements.is_empty() {
        append_log(
            state,
            "No close combats were in contact at bound end.".to_string(),
        );
        return Ok(());
    }

    let mut resolution_state = state.clone();
    let plans: Vec<CloseCombatPlan> = engagements
        .iter()
        .filter_map(|engagement| build_close_combat_plan(&mut resolution_state, engagement))
        .collect();
    state.roll_index = resolution_state.roll_index;

    for plan in &plans {
        apply_close_combat_plan(state, plan);
    }

    update_victory_state(state);
    Ok(())
}

fn build_close_combat_plan(
    state: &mut GameState,
    engagement: &CombatPair,
) -> Option<CloseCombatPlan> {
    let attacker_index = find_unit(state, &engagement.attacker_id)?;
    let defender_index = find_unit(state, &engagement.defender_id)?;
    let attacker = state.units[attacker_index].clone();
    let defender = state.units[defender_index].clone();
    if attacker.eliminated || defender.eliminated {
        return None;
    }

    let attacker_aspect = engagement.attacker_aspect.clone();
    let defender_aspect = engagement.defender_aspect.clone();
    let role_neutral = ordinary_frontage_contact(engagement, &attacker, &defender);
    let attacker_acts_as_attacker = !role_neutral;
    let defender_acts_as_attacker = false;
    let attacker_notes = combat_modifier_notes(
        state,
        &attacker,
        &defender,
        &attacker_aspect,
        attacker_acts_as_attacker,
        engagement.frontage.as_ref(),
    );
    let defender_notes = combat_modifier_notes(
        state,
        &defender,
        &attacker,
        &defender_aspect,
        defender_acts_as_attacker,
        engagement.frontage.as_ref(),
    );
    let attacker_score = close_combat_score(
        state,
        &attacker,
        &defender,
        &attacker_aspect,
        attacker_acts_as_attacker,
        engagement.frontage.as_ref(),
    );
    let attacker_roll = if role_neutral {
        role_neutral_combat_die_roll(state, "close_combat", &attacker, &defender, &attacker)
    } else {
        local_combat_die_roll(state, "close_combat", &attacker, &defender, &attacker)
    };
    let attacker_total = attacker_score + attacker_roll;
    let defender_score = close_combat_score(
        state,
        &defender,
        &attacker,
        &defender_aspect,
        defender_acts_as_attacker,
        engagement.frontage.as_ref(),
    );
    let defender_roll = if role_neutral {
        role_neutral_combat_die_roll(state, "close_combat", &attacker, &defender, &defender)
    } else {
        local_combat_die_roll(state, "close_combat", &attacker, &defender, &defender)
    };
    let defender_total = defender_score + defender_roll;
    let differential = attacker_total - defender_total;

    let (winner, loser, winner_aspect, outcome) = if differential == 0 {
        (None, None, None, "stand")
    } else if differential > 0 {
        let outcome = resolve_close_combat_outcome(
            state,
            &attacker,
            &defender,
            &attacker_aspect,
            differential.abs(),
        );
        (
            Some(attacker.clone()),
            Some(defender.clone()),
            Some(attacker_aspect.clone()),
            outcome,
        )
    } else {
        let outcome = resolve_close_combat_outcome(
            state,
            &defender,
            &attacker,
            &defender_aspect,
            differential.abs(),
        );
        (
            Some(defender.clone()),
            Some(attacker.clone()),
            Some(defender_aspect.clone()),
            outcome,
        )
    };

    let frontage_lane = engagement
        .frontage
        .as_ref()
        .and_then(|frontage| frontage.lane_value_by_unit.get(&attacker.id).copied());

    Some(CloseCombatPlan {
        attacker,
        defender,
        attacker_aspect,
        attacker_notes,
        defender_notes,
        attacker_score,
        attacker_roll,
        attacker_total,
        defender_score,
        defender_roll,
        defender_total,
        differential,
        outcome,
        winner,
        loser,
        winner_aspect,
        frontage_lane,
    })
}

fn ordinary_frontage_contact(engagement: &CombatPair, attacker: &Unit, defender: &Unit) -> bool {
    engagement.frontage.is_some()
        && engagement.attacker_aspect == "front"
        && engagement.defender_aspect == "front"
        && !attacker.charging
        && !defender.charging
}

fn apply_close_combat_plan(state: &mut GameState, plan: &CloseCombatPlan) {
    if let Some(lane_value) = plan.frontage_lane {
        append_log(
            state,
            format!(
                "Frontage lane {} matched {} {} against {} {}.",
                lane_value,
                format_army(&plan.attacker.army),
                plan.attacker.name,
                format_army(&plan.defender.army),
                plan.defender.name
            ),
        );
    }
    append_log(
        state,
        format!(
            "{} {} engaged {} {} from the {} ({} vs {}).",
            format_army(&plan.attacker.army),
            plan.attacker.name,
            format_army(&plan.defender.army),
            plan.defender.name,
            plan.attacker_aspect,
            plan.attacker_total,
            plan.defender_total
        ),
    );
    if !plan.attacker_notes.is_empty() || !plan.defender_notes.is_empty() {
        append_log(
            state,
            format!(
                "Modifiers: {} {}; {} {}.",
                format_army(&plan.attacker.army),
                format_notes(&plan.attacker_notes),
                format_army(&plan.defender.army),
                format_notes(&plan.defender_notes)
            ),
        );
    }

    if plan.differential == 0 {
        record_combat_resolution(
            state,
            combat_resolution_from_plan(plan, "stand", None, None),
        );
        let resolution = state
            .recent_resolutions
            .last()
            .cloned()
            .expect("just pushed");
        append_combat_summary(state, &resolution);
        append_log(
            state,
            "The combat is a stand-off; units remain in combat while still in contact.".to_string(),
        );
        return;
    }

    let Some(winner) = plan.winner.as_ref() else {
        return;
    };
    let Some(loser) = plan.loser.as_ref() else {
        return;
    };
    let winner_aspect = plan.winner_aspect.as_deref().unwrap_or("front");
    let mut final_outcome = plan.outcome;
    match plan.outcome {
        "destroy" => {
            eliminate_unit(
                state,
                loser,
                format!(
                    "{} {} was destroyed in close combat.",
                    format_army(&loser.army),
                    loser.name
                ),
            );
            if !resolve_overpursuit_if_needed(state, winner, loser, winner_aspect, "destroy") {
                advance_after_melee(state, winner, loser);
            }
        }
        "disorder" => apply_disorder(
            state,
            loser,
            Some(format!(
                "{} {} was disordered in close combat.",
                format_army(&loser.army),
                loser.name
            )),
        ),
        "flee" => {
            if flee_unit(state, loser, winner).is_none() {
                eliminate_unit(
                    state,
                    loser,
                    format!(
                        "{} {} had no route to flee and was destroyed.",
                        format_army(&loser.army),
                        loser.name
                    ),
                );
                if !resolve_overpursuit_if_needed(state, winner, loser, winner_aspect, "destroy") {
                    advance_after_melee(state, winner, loser);
                }
                final_outcome = "destroy";
            } else if !resolve_overpursuit_if_needed(state, winner, loser, winner_aspect, "flee") {
                pursue_after_flee(state, winner, loser, winner_aspect);
            }
        }
        "recoil" => {
            if !recoil_unit(state, loser, winner) {
                eliminate_unit(
                    state,
                    loser,
                    format!(
                        "{} {} had no space to recoil and was destroyed.",
                        format_army(&loser.army),
                        loser.name
                    ),
                );
                advance_after_melee(state, winner, loser);
                final_outcome = "destroy";
            } else {
                pursue_after_recoil(state, winner, loser, winner_aspect);
            }
        }
        _ => append_log(
            state,
            format!(
                "{} {} stood firm despite losing the exchange; units remain in combat while still in contact.",
                format_army(&loser.army),
                loser.name
            ),
        ),
    }

    record_combat_resolution(
        state,
        combat_resolution_from_plan(
            plan,
            final_outcome,
            Some(winner.id.clone()),
            Some(loser.id.clone()),
        ),
    );
    let resolution = state
        .recent_resolutions
        .last()
        .cloned()
        .expect("just pushed");
    append_combat_summary(state, &resolution);
    if final_outcome != "destroy"
        && matches!(
            find_unit_ref(state, &loser.id).map(get_unit_class),
            Some(UnitClass::Elephant | UnitClass::Chariot)
        )
    {
        resolve_panic_test(
            state,
            &loser.id,
            PanicTrigger::LostCloseCombat,
            Some(winner.clone()),
        );
    }
}

fn combat_resolution_from_plan(
    plan: &CloseCombatPlan,
    final_outcome: &str,
    winner_id: Option<String>,
    loser_id: Option<String>,
) -> CombatResolution {
    CombatResolution {
        kind: CombatKind::CloseCombat,
        attacker_id: plan.attacker.id.clone(),
        attacker_name: plan.attacker.name.clone(),
        attacker_position: plan.attacker.position.clone(),
        defender_id: plan.defender.id.clone(),
        defender_name: plan.defender.name.clone(),
        defender_position: plan.defender.position.clone(),
        attacker_score: plan.attacker_score,
        attacker_roll: plan.attacker_roll,
        attacker_total: plan.attacker_total,
        defender_score: plan.defender_score,
        defender_roll: plan.defender_roll,
        defender_total: plan.defender_total,
        attacker_notes: plan.attacker_notes.clone(),
        defender_notes: plan.defender_notes.clone(),
        aspect: Some(
            plan.winner_aspect
                .clone()
                .unwrap_or_else(|| plan.attacker_aspect.clone()),
        ),
        range: None,
        differential: plan.differential,
        outcome: final_outcome.to_string(),
        winner_id,
        loser_id,
    }
}

pub(crate) fn clear_charging_status(state: &mut GameState) {
    for unit in &mut state.units {
        unit.charging = false;
    }
}

pub(crate) fn process_start_of_bound_formation_states(state: &mut GameState, army: ArmyId) {
    let unit_ids: Vec<String> = state
        .units
        .iter()
        .filter(|unit| unit.army == army && !unit.eliminated)
        .map(|unit| unit.id.clone())
        .collect();
    for unit_id in unit_ids {
        let Some(index) = find_unit(state, &unit_id) else {
            continue;
        };
        match state.units[index].formation_state {
            FormationState::Panic => {
                if state.units[index].panic_turns_remaining > 0 {
                    state.units[index].panic_turns_remaining -= 1;
                }
                if state.units[index].panic_turns_remaining <= 0 {
                    let adjacent = adjacent_enemies(state, &state.units[index]);
                    state.units[index].formation_state = FormationState::Normal;
                    state.units[index].disordered = true;
                    if !adjacent.is_empty() {
                        state.units[index].activated_this_bound = true;
                    }
                    append_log(
                        state,
                        format!(
                            "{} {} recovered from panic but remains disordered.",
                            format_army(&state.units[index].army),
                            state.units[index].name
                        ),
                    );
                }
            }
            FormationState::Overpursuit => {
                if state.units[index].overpursuit_turns_remaining > 0 {
                    state.units[index].overpursuit_turns_remaining -= 1;
                }
                if state.units[index].overpursuit_turns_remaining <= 0 {
                    if state.units[index].off_map {
                        if return_overpursuer_to_map(state, &unit_id) {
                            append_log(
                                state,
                                format!("{unit_id} returned from off-map overpursuit."),
                            );
                        } else if let Some(index) = find_unit(state, &unit_id) {
                            state.units[index].overpursuit_turns_remaining = 1;
                        }
                    } else {
                        state.units[index].formation_state = FormationState::Normal;
                        append_log(
                            state,
                            format!(
                                "{} {} ended overpursuit.",
                                format_army(&state.units[index].army),
                                state.units[index].name
                            ),
                        );
                    }
                }
            }
            _ => {}
        }
    }
}

pub(crate) fn return_overpursuer_to_map(state: &mut GameState, unit_id: &str) -> bool {
    let Some(unit) = find_unit_ref(state, unit_id).cloned() else {
        return false;
    };
    let y = match unit.army {
        ArmyId::A => state.board_height - 1,
        ArmyId::B => 0,
    };
    let occupied = occupied_cells(state);
    let mut candidates: Vec<Coord> = (0..state.board_width).map(|x| Coord { x, y }).collect();
    candidates.sort_by_key(|coord| ((coord.x - unit.position.x).abs(), coord.x));
    for coord in candidates {
        if !can_enter_cell(state, &unit, &coord, Some(&unit.facing)) {
            continue;
        }
        if !placement_is_clear(state, &unit, &coord, &unit.facing, Some(unit_id)) {
            continue;
        }
        if occupied
            .get(&(coord.x, coord.y))
            .is_some_and(|occupant_id| occupant_id != unit_id)
        {
            continue;
        }
        if let Some(index) = find_unit(state, unit_id) {
            state.units[index].position = coord;
            state.units[index].off_map = false;
            state.units[index].formation_state = FormationState::Normal;
            state.units[index].overpursuit_turns_remaining = 0;
            state.units[index].activated_this_bound = true;
        }
        return true;
    }
    false
}

pub(crate) fn narrow_close_combat_outcome(
    state: &GameState,
    winner: &Unit,
    loser: &Unit,
    winning_aspect: &str,
) -> &'static str {
    let loser_terrain = terrain_for_unit(state, loser);
    let good_going = terrain_counts_as_good(loser_terrain);

    if is_mounted(&loser.kind) && winner.kind == UnitKind::Spear && winning_aspect == "front" {
        return "destroy";
    }
    if matches!(loser.kind, UnitKind::Bow | UnitKind::Slinger) {
        return if is_mounted(&winner.kind)
            || matches!(
                winner.kind,
                UnitKind::Spear | UnitKind::Pike | UnitKind::Blade
            ) {
            "destroy"
        } else {
            "recoil"
        };
    }
    if loser.kind == UnitKind::Psiloi {
        return if winner.kind == UnitKind::Blade || (is_mounted(&winner.kind) && good_going) {
            "destroy"
        } else {
            "recoil"
        };
    }
    if matches!(loser.kind, UnitKind::Cavalry)
        || matches!(loser.kind, UnitKind::LightHorse | UnitKind::BowCavalry)
    {
        return if winner.kind == UnitKind::ScythedChariots || !good_going {
            "flee"
        } else {
            "recoil"
        };
    }
    if loser.kind == UnitKind::ScythedChariots {
        return "destroy";
    }
    if loser.kind == UnitKind::Elephants {
        if winner.kind == UnitKind::Elephants {
            return "flee";
        }
        return if matches!(winner.kind, UnitKind::LightHorse | UnitKind::BowCavalry)
            || matches!(
                winner.kind,
                UnitKind::Auxilia | UnitKind::Psiloi | UnitKind::Artillery
            ) {
            "destroy"
        } else {
            "recoil"
        };
    }
    if loser.kind == UnitKind::Knights {
        return if matches!(winner.kind, UnitKind::LightHorse | UnitKind::BowCavalry)
            || matches!(winner.kind, UnitKind::ScythedChariots | UnitKind::Elephants)
        {
            "destroy"
        } else {
            "recoil"
        };
    }
    if loser.kind == UnitKind::Warband {
        return if matches!(winner.kind, UnitKind::Knights | UnitKind::ScythedChariots) && good_going
        {
            "destroy"
        } else {
            "recoil"
        };
    }
    if loser.kind == UnitKind::Auxilia {
        return if winner.kind == UnitKind::Knights && good_going {
            "destroy"
        } else {
            "recoil"
        };
    }
    if matches!(
        loser.kind,
        UnitKind::Spear | UnitKind::Pike | UnitKind::Blade
    ) {
        if winner.kind == UnitKind::Warband {
            return "destroy";
        }
        return if matches!(winner.kind, UnitKind::Knights | UnitKind::ScythedChariots) && good_going
        {
            "destroy"
        } else {
            "recoil"
        };
    }
    if loser.kind == UnitKind::Horde {
        if winner.kind == UnitKind::Warband {
            return "destroy";
        }
        return if matches!(winner.kind, UnitKind::Knights | UnitKind::Elephants) && good_going {
            "destroy"
        } else {
            "no_effect"
        };
    }
    if loser.kind == UnitKind::Artillery {
        return "destroy";
    }
    "recoil"
}

pub(crate) fn doubled_close_combat_outcome(
    state: &GameState,
    winner: &Unit,
    loser: &Unit,
    winning_aspect: &str,
) -> &'static str {
    let loser_terrain = terrain_for_unit(state, loser);
    let good_going = terrain_counts_as_good(loser_terrain);

    if winning_aspect == "rear" {
        return "destroy";
    }
    if matches!(loser.kind, UnitKind::LightHorse | UnitKind::BowCavalry) {
        return if matches!(
            winner.kind,
            UnitKind::Psiloi | UnitKind::Slinger | UnitKind::Bow | UnitKind::Artillery
        ) || is_mounted(&winner.kind)
            || !good_going
        {
            "destroy"
        } else {
            "flee"
        };
    }
    if loser.kind == UnitKind::Cavalry {
        return if matches!(
            winner.kind,
            UnitKind::Spear | UnitKind::Pike | UnitKind::Horde
        ) && good_going
        {
            "flee"
        } else {
            "destroy"
        };
    }
    if loser.kind == UnitKind::Psiloi {
        if matches!(winner.kind, UnitKind::Elephants | UnitKind::ScythedChariots) {
            return "recoil";
        }
        return if matches!(
            winner.kind,
            UnitKind::Auxilia | UnitKind::Psiloi | UnitKind::Slinger | UnitKind::Bow
        ) || (is_mounted(&winner.kind) && good_going)
        {
            "destroy"
        } else {
            "flee"
        };
    }
    if loser.kind == UnitKind::ScythedChariots {
        return "destroy";
    }
    "destroy"
}

pub(crate) fn combat_modifier_notes(
    state: &GameState,
    unit: &Unit,
    opponent: &Unit,
    incoming_aspect: &str,
    acting_as_attacker: bool,
    frontage: Option<&FrontageContext>,
) -> Vec<String> {
    crate::rules_shared::combat_modifier_notes(
        state,
        unit,
        opponent,
        incoming_aspect,
        acting_as_attacker,
        frontage,
    )
}

pub(crate) fn format_notes(notes: &[String]) -> String {
    crate::rules_shared::format_notes(notes)
}

pub(crate) fn aspect_priority(aspect: &str) -> i32 {
    crate::rules_shared::aspect_priority(aspect)
}

pub(crate) fn format_army(army: &ArmyId) -> &'static str {
    crate::rules_shared::format_army(army)
}

pub(crate) fn format_coord(coord: &Coord) -> String {
    crate::rules_shared::format_coord(coord)
}

pub(crate) fn format_path(path: &[Coord]) -> String {
    crate::rules_shared::format_path(path)
}

pub(crate) fn apply_disorder(state: &mut GameState, unit: &Unit, reason: Option<String>) {
    if unit.eliminated {
        return;
    }
    if let Some(index) = find_unit(state, &unit.id) {
        if get_unit_class(&state.units[index]) == UnitClass::Pike {
            state.units[index].formation_state = FormationState::DisorderedPike;
        }
        if state.units[index].disordered {
            return;
        }
        state.units[index].disordered = true;
        append_log(
            state,
            reason.unwrap_or_else(|| {
                format!(
                    "{} {} became disordered.",
                    format_army(&unit.army),
                    unit.name
                )
            }),
        );
    }
}

pub(crate) fn rally_disorder(state: &mut GameState, army: ArmyId) {
    let targets: Vec<String> = active_units(state, &army)
        .into_iter()
        .filter(|unit| should_clear_disorder_at_start_of_bound(unit, state))
        .map(|unit| unit.id.clone())
        .collect();
    for unit_id in targets {
        if let Some(index) = find_unit(state, &unit_id) {
            let army = state.units[index].army.clone();
            let name = state.units[index].name.clone();
            state.units[index].disordered = false;
            append_log(
                state,
                format!(
                    "{} {} rallied and restored good order.",
                    format_army(&army),
                    name
                ),
            );
        }
    }
}

pub(crate) fn eliminate_unit(state: &mut GameState, unit: &Unit, message: String) {
    if find_unit_ref(state, &unit.id).is_some_and(|current| current.eliminated) {
        return;
    }
    ensure_armies(state);
    if let Some(index) = find_unit(state, &unit.id) {
        state.units[index].eliminated = true;
        state.units[index].in_command = false;
        state.units[index].off_map = false;
        state.units[index].formation_state = FormationState::Rout;
        state.units[index].disordered = true;
    }
    append_log(state, message);
    if unit.leader {
        append_log(
            state,
            format!(
                "{} {}, the general, has fallen.",
                format_army(&unit.army),
                unit.name
            ),
        );
    }

    let losses = state
        .units
        .iter()
        .filter(|candidate| candidate.army == unit.army && candidate.eliminated)
        .count();
    if let Some(status) = attrition_status_for_army(state, &unit.army) {
        status.losses = losses;
    }
    apply_morale_loss(state, &unit.army, unit, "unit lost");
    spread_loss_disorder(state, unit);
    refresh_command_status(state, true);
}

pub(crate) fn attrition_status_for_army<'a>(
    state: &'a mut GameState,
    army: &ArmyId,
) -> Option<&'a mut AttritionStatus> {
    crate::rules_shared::attrition_status_for_army(state, army)
}

#[allow(dead_code)]
pub(crate) fn battle_score_for_army<'a>(
    state: &'a mut GameState,
    army: &ArmyId,
) -> Option<&'a mut BattleScore> {
    crate::rules_shared::battle_score_for_army(state, army)
}

pub(crate) fn can_interpenetrate_through(state: &GameState, mover: &Unit, occupant: &Unit) -> bool {
    crate::rules_shared::can_interpenetrate_through(state, mover, occupant)
}

pub fn spread_loss_disorder(state: &mut GameState, eliminated_unit: &Unit) {
    let affected: Vec<String> = active_units(state, &eliminated_unit.army)
        .into_iter()
        .filter(|unit| distance_between(&unit.position, &eliminated_unit.position) == 1)
        .filter(|unit| {
            unit.quality == UnitQuality::Inferior
                || unit.formation_class == FormationClass::OpenOrder
        })
        .map(|unit| unit.id.clone())
        .collect();
    for unit_id in affected {
        if let Some(index) = find_unit(state, &unit_id) {
            let unit = state.units[index].clone();
            apply_disorder(
                state,
                &unit,
                Some(format!(
                    "{} {} became disordered after the nearby loss of {}.",
                    format_army(&unit.army),
                    unit.name,
                    eliminated_unit.name
                )),
            );
        }
    }
}

pub fn ensure_attrition_status(state: &mut GameState) {
    crate::rules_shared::ensure_attrition_status(state)
}

pub fn refresh_battle_scores(state: &mut GameState) {
    crate::rules_shared::refresh_battle_scores(state)
}

pub fn update_victory_state(state: &mut GameState) {
    crate::rules_shared::update_victory_state(state)
}

pub fn attack_aspect(attacker: &Unit, defender: &Unit) -> &'static str {
    crate::rules_shared::attack_aspect(attacker, defender)
}

pub fn record_combat_resolution(state: &mut GameState, resolution: CombatResolution) {
    state.recent_resolutions.push(resolution);
}

pub fn append_combat_summary(state: &mut GameState, resolution: &CombatResolution) {
    if resolution.kind == CombatKind::Missile {
        append_log(
            state,
            format!(
                "Missile result: {} vs {} at range {} -> {} ({} vs {}).",
                resolution.attacker_name,
                resolution.defender_name,
                resolution.range.unwrap_or(0),
                resolution.outcome,
                resolution.attacker_total,
                resolution.defender_total
            ),
        );
        return;
    }

    if resolution.outcome == "stand" || resolution.winner_id.is_none() {
        append_log(
            state,
            format!(
                "Close combat result: {} and {} stood ({} vs {}).",
                resolution.attacker_name,
                resolution.defender_name,
                resolution.attacker_total,
                resolution.defender_total
            ),
        );
        return;
    }

    let winner_name = if resolution.winner_id.as_ref() == Some(&resolution.attacker_id) {
        &resolution.attacker_name
    } else {
        &resolution.defender_name
    };
    let loser_name = if resolution.loser_id.as_ref() == Some(&resolution.defender_id) {
        &resolution.defender_name
    } else {
        &resolution.attacker_name
    };
    append_log(
        state,
        format!(
            "Close combat result: {} beat {} from the {} -> {} ({} vs {}).",
            winner_name,
            loser_name,
            resolution.aspect.as_deref().unwrap_or("front"),
            resolution.outcome,
            resolution.attacker_total,
            resolution.defender_total
        ),
    );
}

pub(crate) fn close_combat_score(
    state: &GameState,
    unit: &Unit,
    opponent: &Unit,
    incoming_aspect: &str,
    acting_as_attacker: bool,
    frontage: Option<&FrontageContext>,
) -> i32 {
    crate::rules_shared::close_combat_score(
        state,
        unit,
        opponent,
        incoming_aspect,
        acting_as_attacker,
        frontage,
    )
}

pub fn resolve_close_combat_outcome(
    state: &GameState,
    winner: &Unit,
    loser: &Unit,
    winning_aspect: &str,
    differential: i32,
) -> &'static str {
    if let Some(outcome) = frontal_pike_line_outcome(winner, loser, winning_aspect, differential) {
        return apply_inferior_front_loser_rule(loser, winning_aspect, outcome);
    }
    if loser.disordered && winning_aspect != "front" {
        return "destroy";
    }
    if winning_aspect == "rear" {
        return "destroy";
    }

    if winning_aspect != "front" {
        return if differential >= 2 {
            doubled_close_combat_outcome(state, winner, loser, winning_aspect)
        } else {
            narrow_close_combat_outcome(state, winner, loser, winning_aspect)
        };
    }

    if winning_aspect == "front" {
        if differential <= 1 {
            return apply_inferior_front_loser_rule(loser, winning_aspect, "no_effect");
        }
        if differential == 2 && is_resilient_frontal_loser(loser) {
            return apply_inferior_front_loser_rule(loser, winning_aspect, "no_effect");
        }
        if differential <= 4 {
            let outcome = narrow_close_combat_outcome(state, winner, loser, winning_aspect);
            return apply_inferior_front_loser_rule(
                loser,
                winning_aspect,
                soften_frontal_destroy(outcome, loser),
            );
        }
    }

    if differential >= 5 {
        return doubled_close_combat_outcome(state, winner, loser, winning_aspect);
    }
    let outcome = narrow_close_combat_outcome(state, winner, loser, winning_aspect);
    apply_inferior_front_loser_rule(loser, winning_aspect, outcome)
}

fn apply_inferior_front_loser_rule(
    loser: &Unit,
    winning_aspect: &str,
    outcome: &'static str,
) -> &'static str {
    if loser.quality == UnitQuality::Inferior
        && winning_aspect == "front"
        && matches!(outcome, "recoil" | "no_effect")
    {
        "disorder"
    } else {
        outcome
    }
}

fn frontal_pike_line_outcome(
    winner: &Unit,
    loser: &Unit,
    winning_aspect: &str,
    differential: i32,
) -> Option<&'static str> {
    if winning_aspect != "front"
        || get_unit_class(winner) != UnitClass::Pike
        || get_unit_class(loser) != UnitClass::Pike
    {
        return None;
    }

    if loser.disordered || loser.formation_state == FormationState::DisorderedPike {
        return Some(match differential {
            0 | 1 => "no_effect",
            2 | 3 => "recoil",
            4 | 5 => "flee",
            _ => "destroy",
        });
    }

    Some(match differential {
        0..=2 => "no_effect",
        3..=4 => "disorder",
        5..=6 => "recoil",
        _ => "destroy",
    })
}

fn is_resilient_frontal_loser(loser: &Unit) -> bool {
    matches!(
        get_unit_class(loser),
        UnitClass::Pike | UnitClass::Formed | UnitClass::Cavalry | UnitClass::Elephant
    )
}

fn soften_frontal_destroy(outcome: &'static str, loser: &Unit) -> &'static str {
    if outcome == "destroy" && is_resilient_frontal_loser(loser) {
        if loser.disordered || loser.formation_state == FormationState::DisorderedPike {
            "flee"
        } else {
            "recoil"
        }
    } else {
        outcome
    }
}
