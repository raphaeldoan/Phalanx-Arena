use super::*;

pub(crate) fn refresh_derived_fields(state: &mut GameState) {
    refresh_command_status(state, false);
    refresh_battle_scores(state);
}

pub(crate) fn legal_actions(state: &GameState) -> Vec<LegalAction> {
    if game_is_over(state) {
        return Vec::new();
    }

    let mut actions = if state.phase == GamePhase::Deployment {
        legal_deployment_actions(state)
    } else {
        let indexes = GameIndexes::new(state);
        let mut battle_actions = vec![LegalAction::EndBound];
        if state.pips_remaining > 0 {
            for unit in indexes.active_units(state, &state.current_player) {
                if unit.activated_this_bound {
                    continue;
                }
                if !can_receive_voluntary_orders(unit) {
                    continue;
                }

                battle_actions.extend(legal_rally_actions(state, &indexes, unit));
                battle_actions.extend(legal_reform_pike_actions(state, &indexes, unit));
                battle_actions.extend(legal_rotate_actions(state, &indexes, unit));
                battle_actions.extend(legal_charge_actions(state, &indexes, unit));
                battle_actions.extend(legal_march_actions(state, &indexes, unit));
                battle_actions.extend(legal_move_actions(state, &indexes, unit));
                battle_actions.extend(legal_shoot_actions(state, &indexes, unit));
            }

            battle_actions.extend(legal_group_charge_actions(state, &indexes));
            battle_actions.extend(legal_group_march_actions(state, &indexes));
            battle_actions.extend(legal_group_actions(state, &indexes));
        }
        battle_actions
    };

    actions = dedupe_legal_actions(actions);
    sort_legal_actions(&mut actions);
    actions
}

pub(crate) fn apply_action(state: &mut GameState, action: Action) -> Result<(), EngineError> {
    let mut prepared = state.clone();
    prepare_action_application(&mut prepared)?;
    let legal_action = resolve_action(&prepared, &action)?;
    apply_resolved_legal_action(&mut prepared, &legal_action)?;
    *state = prepared;
    Ok(())
}

pub(crate) fn apply_resolved_legal_action_unchecked(
    state: &mut GameState,
    action: &LegalAction,
) -> Result<(), EngineError> {
    let mut prepared = state.clone();
    prepare_action_application(&mut prepared)?;
    apply_resolved_legal_action(&mut prepared, action)?;
    *state = prepared;
    Ok(())
}

pub(crate) fn prepare_action_application(state: &mut GameState) -> Result<(), EngineError> {
    refresh_command_status(state, false);
    refresh_battle_scores(state);
    if game_is_over(state) {
        return Err(EngineError::InvalidAction(
            "The game is already over.".to_string(),
        ));
    }

    state.recent_resolutions.clear();
    Ok(())
}

pub(crate) fn apply_resolved_legal_action(
    state: &mut GameState,
    action: &LegalAction,
) -> Result<(), EngineError> {
    match action {
        LegalAction::Deploy {
            unit_id,
            destination,
        } => apply_deploy_resolved(state, unit_id, destination),
        LegalAction::Move {
            unit_id,
            destination,
            path,
            facing,
            pip_cost,
        } => apply_move_resolved(state, unit_id, destination, path, facing, *pip_cost),
        LegalAction::MarchMove {
            unit_id,
            destination,
            path,
            facing,
            pip_cost,
        } => apply_march_move_resolved(state, unit_id, destination, path, facing, *pip_cost),
        LegalAction::Charge {
            unit_id,
            target_id,
            destination,
            path,
            facing,
            aspect,
            pip_cost,
            ..
        } => apply_charge_resolved(
            state,
            unit_id,
            target_id,
            destination,
            path,
            facing,
            aspect,
            *pip_cost,
        ),
        LegalAction::GroupMove {
            unit_ids,
            steps,
            pip_cost,
        } => apply_group_move_resolved(state, unit_ids, steps, *pip_cost),
        LegalAction::GroupMarchMove {
            unit_ids,
            steps,
            pip_cost,
        } => apply_group_march_move_resolved(state, unit_ids, steps, *pip_cost),
        LegalAction::GroupCharge {
            unit_ids,
            steps,
            pip_cost,
            ..
        } => apply_group_charge_resolved(state, unit_ids, steps, *pip_cost),
        LegalAction::Rotate {
            unit_id,
            facing,
            pip_cost,
        } => apply_rotate_resolved(state, unit_id, facing, *pip_cost),
        LegalAction::Shoot {
            unit_id,
            target_id,
            pip_cost,
            ..
        } => apply_shoot_resolved(state, unit_id, target_id, *pip_cost),
        LegalAction::Rally { unit_id, pip_cost } => apply_rally_resolved(state, unit_id, *pip_cost),
        LegalAction::ReformPike { unit_id, pip_cost } => {
            apply_reform_pike_resolved(state, unit_id, *pip_cost)
        }
        LegalAction::FinalizeDeployment => finalize_deployment(state),
        LegalAction::EndBound => end_bound(state),
    }
}

pub(crate) fn resolve_action(
    state: &GameState,
    action: &Action,
) -> Result<LegalAction, EngineError> {
    match action {
        Action::Deploy {
            unit_id,
            destination,
        } => Ok(LegalAction::Deploy {
            unit_id: unit_id.clone(),
            destination: destination.clone(),
        }),
        Action::Move { .. } => resolve_move_action(state, action),
        Action::MarchMove { .. } => resolve_march_move_action(state, action),
        Action::Charge { .. } => resolve_charge_action(state, action),
        Action::GroupMove { .. } => resolve_group_move_action(state, action),
        Action::GroupMarchMove { .. } => resolve_group_march_move_action(state, action),
        Action::GroupCharge { .. } => resolve_group_charge_action(state, action),
        Action::Rotate { .. } => resolve_rotate_action(state, action),
        Action::Shoot { .. } => resolve_shoot_action(state, action),
        Action::Rally { .. } => resolve_rally_action(state, action),
        Action::ReformPike { .. } => resolve_reform_pike_action(state, action),
        Action::FinalizeDeployment => Ok(LegalAction::FinalizeDeployment),
        Action::EndBound => Ok(LegalAction::EndBound),
    }
}

pub(crate) fn ensure_battle_order_action(state: &GameState) -> Result<(), EngineError> {
    if state.phase != GamePhase::Battle {
        return Err(EngineError::InvalidAction(
            "Battle actions are only legal once the battle has started.".to_string(),
        ));
    }
    if state.pips_remaining < 1 {
        return Err(EngineError::InvalidAction("No PIPs remain.".to_string()));
    }
    Ok(())
}

pub(crate) fn ensure_resolved_order_can_spend(
    state: &GameState,
    pip_cost: i32,
) -> Result<(), EngineError> {
    ensure_battle_order_action(state)?;
    if pip_cost > state.pips_remaining {
        return Err(EngineError::InvalidAction("No PIPs remain.".to_string()));
    }
    Ok(())
}

pub(crate) struct AppliedUnitMovement {
    pub(crate) unit_index: usize,
    pub(crate) origin: Coord,
    pub(crate) original_facing: Direction,
}

pub(crate) fn apply_active_unit_movement(
    state: &mut GameState,
    unit_id: &str,
    destination: &Coord,
    facing: &Direction,
) -> Result<AppliedUnitMovement, EngineError> {
    let unit_index = validate_active_unit_index(state, unit_id)?;
    let origin = state.units[unit_index].position.clone();
    let original_facing = state.units[unit_index].facing.clone();
    state.units[unit_index].position = destination.clone();
    state.units[unit_index].facing = facing.clone();
    state.units[unit_index].activated_this_bound = true;
    Ok(AppliedUnitMovement {
        unit_index,
        origin,
        original_facing,
    })
}

pub(crate) trait MovementStepView {
    fn unit_id(&self) -> &str;
    fn destination(&self) -> &Coord;
    fn facing(&self) -> &Direction;
}

impl MovementStepView for GroupMoveStep {
    fn unit_id(&self) -> &str {
        &self.unit_id
    }

    fn destination(&self) -> &Coord {
        &self.destination
    }

    fn facing(&self) -> &Direction {
        &self.facing
    }
}

impl MovementStepView for GroupChargeStep {
    fn unit_id(&self) -> &str {
        &self.unit_id
    }

    fn destination(&self) -> &Coord {
        &self.destination
    }

    fn facing(&self) -> &Direction {
        &self.facing
    }
}

pub(crate) fn apply_group_unit_movements<T: MovementStepView>(
    state: &mut GameState,
    unit_ids: &[String],
    steps: &[T],
) -> Result<(), EngineError> {
    let steps_by_unit: HashMap<&str, &T> =
        steps.iter().map(|step| (step.unit_id(), step)).collect();
    for unit_id in unit_ids {
        let step = steps_by_unit.get(unit_id.as_str()).ok_or_else(|| {
            EngineError::InvalidAction(format!("missing step for unit {unit_id}"))
        })?;
        apply_active_unit_movement(state, unit_id, step.destination(), step.facing())?;
    }
    Ok(())
}

pub(crate) fn spend_resolved_order_pips(state: &mut GameState, pip_cost: i32) {
    state.pips_remaining -= pip_cost;
}

pub(crate) fn refresh_after_movement_order(
    state: &mut GameState,
    moved_unit_ids: &[&str],
    refresh_all_contact_disorder: bool,
) {
    refresh_command_status(state, true);
    if refresh_all_contact_disorder {
        update_all_pike_disorder_from_contacts(state);
    } else {
        for unit_id in moved_unit_ids {
            update_pike_disorder_from_position(state, unit_id);
        }
    }
    sync_army_pips(state);
    update_victory_state(state);
}

pub(crate) fn find_matching_legal_action(
    options: Vec<LegalAction>,
    action: &Action,
    message: &str,
) -> Result<LegalAction, EngineError> {
    options
        .into_iter()
        .find(|option| legal_action_matches_action(option, action))
        .ok_or_else(|| EngineError::InvalidAction(message.to_string()))
}

pub(crate) fn legal_action_matches_action(legal_action: &LegalAction, action: &Action) -> bool {
    match (legal_action, action) {
        (
            LegalAction::Deploy {
                unit_id,
                destination,
            },
            Action::Deploy {
                unit_id: action_unit_id,
                destination: action_destination,
            },
        ) => unit_id == action_unit_id && destination == action_destination,
        (
            LegalAction::Move {
                unit_id,
                destination,
                path,
                facing,
                ..
            },
            Action::Move {
                unit_id: action_unit_id,
                destination: action_destination,
                path: action_path,
                facing: action_facing,
            },
        ) => {
            unit_id == action_unit_id
                && destination == action_destination
                && path == action_path
                && facing == action_facing
        }
        (
            LegalAction::MarchMove {
                unit_id,
                destination,
                path,
                facing,
                ..
            },
            Action::MarchMove {
                unit_id: action_unit_id,
                destination: action_destination,
                path: action_path,
                facing: action_facing,
            },
        ) => {
            unit_id == action_unit_id
                && destination == action_destination
                && path == action_path
                && facing == action_facing
        }
        (
            LegalAction::Charge {
                unit_id,
                target_id,
                destination,
                path,
                facing,
                ..
            },
            Action::Charge {
                unit_id: action_unit_id,
                target_id: action_target_id,
                destination: action_destination,
                path: action_path,
                facing: action_facing,
            },
        ) => {
            unit_id == action_unit_id
                && target_id == action_target_id
                && destination == action_destination
                && path == action_path
                && facing == action_facing
        }
        (
            LegalAction::GroupMove {
                unit_ids, steps, ..
            },
            Action::GroupMove {
                unit_ids: action_unit_ids,
                steps: action_steps,
            },
        ) => unit_ids == action_unit_ids && steps == action_steps,
        (
            LegalAction::GroupMarchMove {
                unit_ids, steps, ..
            },
            Action::GroupMarchMove {
                unit_ids: action_unit_ids,
                steps: action_steps,
            },
        ) => unit_ids == action_unit_ids && steps == action_steps,
        (
            LegalAction::GroupCharge {
                unit_ids, steps, ..
            },
            Action::GroupCharge {
                unit_ids: action_unit_ids,
                steps: action_steps,
            },
        ) => unit_ids == action_unit_ids && steps == action_steps,
        (
            LegalAction::Rotate {
                unit_id, facing, ..
            },
            Action::Rotate {
                unit_id: action_unit_id,
                facing: action_facing,
            },
        ) => unit_id == action_unit_id && facing == action_facing,
        (
            LegalAction::Shoot {
                unit_id, target_id, ..
            },
            Action::Shoot {
                unit_id: action_unit_id,
                target_id: action_target_id,
            },
        ) => unit_id == action_unit_id && target_id == action_target_id,
        (
            LegalAction::Rally { unit_id, .. },
            Action::Rally {
                unit_id: action_unit_id,
            },
        ) => unit_id == action_unit_id,
        (
            LegalAction::ReformPike { unit_id, .. },
            Action::ReformPike {
                unit_id: action_unit_id,
            },
        ) => unit_id == action_unit_id,
        (LegalAction::FinalizeDeployment, Action::FinalizeDeployment)
        | (LegalAction::EndBound, Action::EndBound) => true,
        _ => false,
    }
}

pub(crate) fn apply_shoot_resolved(
    state: &mut GameState,
    unit_id: &str,
    target_id: &str,
    pip_cost: i32,
) -> Result<(), EngineError> {
    apply_shoot_with_pip_cost(state, unit_id, target_id, pip_cost)
}

pub(crate) fn resolve_move_action(
    state: &GameState,
    action: &Action,
) -> Result<LegalAction, EngineError> {
    let Action::Move { unit_id, .. } = action else {
        return Err(EngineError::InvalidAction(
            "expected move action".to_string(),
        ));
    };
    ensure_battle_order_action(state)?;
    let indexes = GameIndexes::new(state);
    let unit_index = validate_active_unit_index(state, unit_id)?;
    find_matching_legal_action(
        legal_move_actions(state, &indexes, &state.units[unit_index]),
        action,
        "Illegal move.",
    )
}

pub(crate) fn resolve_march_move_action(
    state: &GameState,
    action: &Action,
) -> Result<LegalAction, EngineError> {
    let Action::MarchMove { unit_id, .. } = action else {
        return Err(EngineError::InvalidAction(
            "expected march move action".to_string(),
        ));
    };
    ensure_battle_order_action(state)?;
    let indexes = GameIndexes::new(state);
    let unit_index = validate_active_unit_index(state, unit_id)?;
    find_matching_legal_action(
        legal_march_actions(state, &indexes, &state.units[unit_index]),
        action,
        "Illegal march move.",
    )
}

pub(crate) fn resolve_charge_action(
    state: &GameState,
    action: &Action,
) -> Result<LegalAction, EngineError> {
    let Action::Charge { unit_id, .. } = action else {
        return Err(EngineError::InvalidAction(
            "expected charge action".to_string(),
        ));
    };
    ensure_battle_order_action(state)?;
    let indexes = GameIndexes::new(state);
    let unit_index = validate_active_unit_index(state, unit_id)?;
    find_matching_legal_action(
        legal_charge_actions(state, &indexes, &state.units[unit_index]),
        action,
        "Illegal charge.",
    )
}

pub(crate) fn resolve_rally_action(
    state: &GameState,
    action: &Action,
) -> Result<LegalAction, EngineError> {
    let Action::Rally { unit_id } = action else {
        return Err(EngineError::InvalidAction(
            "expected rally action".to_string(),
        ));
    };
    ensure_battle_order_action(state)?;
    let indexes = GameIndexes::new(state);
    let unit_index = validate_active_unit_index(state, unit_id)?;
    find_matching_legal_action(
        legal_rally_actions(state, &indexes, &state.units[unit_index]),
        action,
        "Illegal rally.",
    )
}

pub(crate) fn resolve_reform_pike_action(
    state: &GameState,
    action: &Action,
) -> Result<LegalAction, EngineError> {
    let Action::ReformPike { unit_id } = action else {
        return Err(EngineError::InvalidAction(
            "expected reform_pike action".to_string(),
        ));
    };
    ensure_battle_order_action(state)?;
    let indexes = GameIndexes::new(state);
    let unit_index = validate_active_unit_index(state, unit_id)?;
    find_matching_legal_action(
        legal_reform_pike_actions(state, &indexes, &state.units[unit_index]),
        action,
        "Illegal pike reform.",
    )
}

pub(crate) fn resolve_rotate_action(
    state: &GameState,
    action: &Action,
) -> Result<LegalAction, EngineError> {
    let Action::Rotate { unit_id, .. } = action else {
        return Err(EngineError::InvalidAction(
            "expected rotate action".to_string(),
        ));
    };
    ensure_battle_order_action(state)?;
    let indexes = GameIndexes::new(state);
    let unit_index = validate_active_unit_index(state, unit_id)?;
    find_matching_legal_action(
        legal_rotate_actions(state, &indexes, &state.units[unit_index]),
        action,
        "Illegal facing change.",
    )
}

pub(crate) fn resolve_shoot_action(
    state: &GameState,
    action: &Action,
) -> Result<LegalAction, EngineError> {
    let Action::Shoot { unit_id, .. } = action else {
        return Err(EngineError::InvalidAction(
            "expected shoot action".to_string(),
        ));
    };
    ensure_battle_order_action(state)?;
    let indexes = GameIndexes::new(state);
    let unit_index = validate_active_unit_index(state, unit_id)?;
    find_matching_legal_action(
        legal_shoot_actions(state, &indexes, &state.units[unit_index]),
        action,
        "illegal shot.",
    )
}

pub(crate) fn resolve_group_move_action(
    state: &GameState,
    action: &Action,
) -> Result<LegalAction, EngineError> {
    let Action::GroupMove { unit_ids, .. } = action else {
        return Err(EngineError::InvalidAction(
            "expected group move action".to_string(),
        ));
    };
    ensure_battle_order_action(state)?;
    validate_group_action_units(unit_ids, "A group move requires at least two units.")?;
    let indexes = GameIndexes::new(state);
    find_matching_legal_action(
        legal_group_actions_for_action(state, &indexes, unit_ids),
        action,
        "Illegal group move.",
    )
}

pub(crate) fn resolve_group_march_move_action(
    state: &GameState,
    action: &Action,
) -> Result<LegalAction, EngineError> {
    let Action::GroupMarchMove { unit_ids, .. } = action else {
        return Err(EngineError::InvalidAction(
            "expected group march action".to_string(),
        ));
    };
    ensure_battle_order_action(state)?;
    validate_group_action_units(unit_ids, "A group march requires at least two units.")?;
    let indexes = GameIndexes::new(state);
    find_matching_legal_action(
        legal_group_march_actions_for_action(state, &indexes, unit_ids),
        action,
        "Illegal group march.",
    )
}

pub(crate) fn resolve_group_charge_action(
    state: &GameState,
    action: &Action,
) -> Result<LegalAction, EngineError> {
    let Action::GroupCharge { unit_ids, .. } = action else {
        return Err(EngineError::InvalidAction(
            "expected group charge action".to_string(),
        ));
    };
    ensure_battle_order_action(state)?;
    validate_group_action_units(unit_ids, "A group charge requires at least two units.")?;
    let indexes = GameIndexes::new(state);
    find_matching_legal_action(
        legal_group_charge_actions_for_action(state, &indexes, unit_ids),
        action,
        "Illegal group charge.",
    )
}

pub(crate) fn validate_group_action_units(
    unit_ids: &[String],
    too_small_message: &str,
) -> Result<(), EngineError> {
    if unit_ids.len() < 2 {
        return Err(EngineError::InvalidAction(too_small_message.to_string()));
    }
    Ok(())
}

#[allow(dead_code)]
pub(crate) fn apply_move(state: &mut GameState, action: &Action) -> Result<(), EngineError> {
    let Action::Move {
        unit_id,
        destination,
        path,
        facing,
    } = action
    else {
        return Err(EngineError::InvalidAction(
            "expected move action".to_string(),
        ));
    };

    let legal_option = resolve_move_action(state, action)?;
    let LegalAction::Move { pip_cost, .. } = legal_option else {
        unreachable!();
    };
    apply_move_resolved(state, unit_id, destination, path, facing, pip_cost)
}

pub(crate) fn apply_move_resolved(
    state: &mut GameState,
    unit_id: &str,
    destination: &Coord,
    path: &[Coord],
    facing: &Direction,
    pip_cost: i32,
) -> Result<(), EngineError> {
    ensure_resolved_order_can_spend(state, pip_cost)?;
    let breaks_contact = find_unit(state, unit_id).is_some_and(|unit| {
        unit.can_evade && !unit.disordered && !adjacent_enemies(state, unit).is_empty()
    });
    let applied = apply_active_unit_movement(state, unit_id, destination, facing)?;
    if breaks_contact {
        state.units[applied.unit_index].disordered = true;
    }
    spend_resolved_order_pips(state, pip_cost);
    append_log(
        state,
        format!(
            "{:?} {} moved from {} facing {} to {} facing {} via {}.",
            state.units[applied.unit_index].army,
            state.units[applied.unit_index].name,
            format_coord(&applied.origin),
            applied.original_facing,
            format_coord(&state.units[applied.unit_index].position),
            state.units[applied.unit_index].facing,
            format_path(path)
        ),
    );
    if breaks_contact {
        append_log(
            state,
            format!(
                "{:?} {} broke off from close combat and became disordered.",
                state.units[applied.unit_index].army, state.units[applied.unit_index].name
            ),
        );
    }
    refresh_after_movement_order(state, &[unit_id], false);
    Ok(())
}

#[allow(dead_code)]
pub(crate) fn apply_march_move(state: &mut GameState, action: &Action) -> Result<(), EngineError> {
    let Action::MarchMove {
        unit_id,
        destination,
        path,
        facing,
    } = action
    else {
        return Err(EngineError::InvalidAction(
            "expected march move action".to_string(),
        ));
    };

    let legal_option = resolve_march_move_action(state, action)?;
    let LegalAction::MarchMove { pip_cost, .. } = legal_option else {
        unreachable!();
    };
    apply_march_move_resolved(state, unit_id, destination, path, facing, pip_cost)
}

pub(crate) fn apply_march_move_resolved(
    state: &mut GameState,
    unit_id: &str,
    destination: &Coord,
    path: &[Coord],
    facing: &Direction,
    pip_cost: i32,
) -> Result<(), EngineError> {
    ensure_resolved_order_can_spend(state, pip_cost)?;
    let applied = apply_active_unit_movement(state, unit_id, destination, facing)?;
    spend_resolved_order_pips(state, pip_cost);
    append_log(
        state,
        format!(
            "{:?} {} marched from {} to {} via {}.",
            state.units[applied.unit_index].army,
            state.units[applied.unit_index].name,
            format_coord(&applied.origin),
            format_coord(&state.units[applied.unit_index].position),
            format_path(path)
        ),
    );
    refresh_after_movement_order(state, &[unit_id], false);
    Ok(())
}

#[allow(dead_code)]
pub(crate) fn apply_charge(state: &mut GameState, action: &Action) -> Result<(), EngineError> {
    let Action::Charge {
        unit_id,
        target_id,
        destination,
        path,
        facing,
    } = action
    else {
        return Err(EngineError::InvalidAction(
            "expected charge action".to_string(),
        ));
    };

    let legal_option = resolve_charge_action(state, action)?;
    let LegalAction::Charge {
        pip_cost, aspect, ..
    } = legal_option
    else {
        unreachable!();
    };
    apply_charge_resolved(
        state,
        unit_id,
        target_id,
        destination,
        path,
        facing,
        &aspect,
        pip_cost,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn apply_charge_resolved(
    state: &mut GameState,
    unit_id: &str,
    target_id: &str,
    destination: &Coord,
    path: &[Coord],
    facing: &Direction,
    aspect: &str,
    pip_cost: i32,
) -> Result<(), EngineError> {
    ensure_resolved_order_can_spend(state, pip_cost)?;
    let applied = apply_active_unit_movement(state, unit_id, destination, facing)?;
    let defender_index = find_unit_index(state, target_id)
        .ok_or_else(|| EngineError::InvalidAction(format!("unknown unit id: {target_id}")))?;
    let defender = state.units[defender_index].clone();
    let attacker = state.units[applied.unit_index].clone();
    spend_resolved_order_pips(state, pip_cost);
    append_log(
        state,
        format!(
            "{:?} {} charged from {} to {} against {} ({}) via {}.",
            state.units[applied.unit_index].army,
            state.units[applied.unit_index].name,
            format_coord(&applied.origin),
            format_coord(&state.units[applied.unit_index].position),
            target_id,
            aspect,
            format_path(path)
        ),
    );
    if !maybe_evade_charge(state, &defender, &attacker) {
        if get_unit_class(&defender) == UnitClass::Pike && aspect != "front" {
            set_pike_disordered(state, &defender.id, "flank or rear contact");
        }
        if matches!(
            get_unit_class(&defender),
            UnitClass::Elephant | UnitClass::Chariot
        ) && aspect != "front"
        {
            crate::combat::resolve_panic_test(
                state,
                &defender.id,
                crate::combat::PanicTrigger::FlankOrRearContact,
                Some(attacker.clone()),
            );
        }
        if ordered_pike_charge_warning(&attacker, &defender, aspect, state).is_some()
            && matches!(
                get_unit_class(&attacker),
                UnitClass::Elephant | UnitClass::Chariot
            )
        {
            crate::combat::resolve_panic_test(
                state,
                &attacker.id,
                crate::combat::PanicTrigger::ChargedOrderedPike,
                Some(defender.clone()),
            );
        }
        let attacker_can_remain_in_contact = find_unit(state, &attacker.id).is_some_and(|unit| {
            unit.formation_state != FormationState::Panic && !unit.eliminated && !unit.off_map
        });
        if attacker_can_remain_in_contact {
            conform_defender_if_isolated(state, &defender, &attacker);
            mark_unit_as_charging(state, &attacker.id);
        }
    }
    refresh_after_movement_order(state, &[unit_id], true);
    Ok(())
}

pub(crate) fn mark_unit_as_charging(state: &mut GameState, unit_id: &str) {
    let Some(index) = find_unit_index(state, unit_id) else {
        return;
    };
    if state.units[index].charging {
        return;
    }

    state.units[index].charging = true;
    append_log(
        state,
        format!(
            "{} {} is charging and will add impact in the next close combat resolution.",
            format_army(&state.units[index].army),
            state.units[index].name
        ),
    );
}

pub(crate) fn apply_rally_resolved(
    state: &mut GameState,
    unit_id: &str,
    pip_cost: i32,
) -> Result<(), EngineError> {
    ensure_resolved_order_can_spend(state, pip_cost)?;
    let unit_index = validate_active_unit_index(state, unit_id)?;
    state.units[unit_index].disordered = false;
    state.units[unit_index].activated_this_bound = true;
    state.pips_remaining -= pip_cost;
    append_log(
        state,
        format!(
            "{} {} rallied and restored good order.",
            format_army(&state.units[unit_index].army),
            state.units[unit_index].name
        ),
    );
    refresh_command_status(state, true);
    sync_army_pips(state);
    Ok(())
}

#[allow(dead_code)]
pub(crate) fn apply_reform_pike(state: &mut GameState, action: &Action) -> Result<(), EngineError> {
    let Action::ReformPike { unit_id } = action else {
        return Err(EngineError::InvalidAction(
            "expected reform_pike action".to_string(),
        ));
    };
    let legal_option = resolve_reform_pike_action(state, action)?;
    let LegalAction::ReformPike { pip_cost, .. } = legal_option else {
        unreachable!();
    };
    apply_reform_pike_resolved(state, unit_id, pip_cost)
}

pub(crate) fn apply_reform_pike_resolved(
    state: &mut GameState,
    unit_id: &str,
    pip_cost: i32,
) -> Result<(), EngineError> {
    ensure_resolved_order_can_spend(state, pip_cost)?;
    let unit_index = validate_active_unit_index(state, unit_id)?;
    state.units[unit_index].formation_state = FormationState::OrderedPike;
    state.units[unit_index].disordered = false;
    state.units[unit_index].activated_this_bound = true;
    state.pips_remaining -= pip_cost;
    append_log(
        state,
        format!(
            "{} {} reformed into OrderedPike.",
            format_army(&state.units[unit_index].army),
            state.units[unit_index].name
        ),
    );
    refresh_command_status(state, true);
    sync_army_pips(state);
    Ok(())
}

pub(crate) fn apply_rotate_resolved(
    state: &mut GameState,
    unit_id: &str,
    facing: &Direction,
    pip_cost: i32,
) -> Result<(), EngineError> {
    ensure_resolved_order_can_spend(state, pip_cost)?;
    let unit_index = validate_active_unit_index(state, unit_id)?;
    let original_facing = state.units[unit_index].facing.clone();
    state.units[unit_index].facing = facing.clone();
    state.units[unit_index].activated_this_bound = true;
    state.pips_remaining -= pip_cost;
    append_log(
        state,
        format!(
            "{} {} rotated from {} to {}.",
            state.units[unit_index].army,
            state.units[unit_index].name,
            original_facing,
            state.units[unit_index].facing
        ),
    );
    update_pike_disorder_from_position(state, unit_id);
    sync_army_pips(state);
    Ok(())
}

pub(crate) fn conform_defender_if_isolated(
    state: &mut GameState,
    defender: &Unit,
    attacker: &Unit,
) {
    if defender.eliminated || attacker.eliminated {
        return;
    }

    let adjacent = adjacent_enemies(state, defender);
    if adjacent.len() != 1 || adjacent[0].id != attacker.id {
        return;
    }

    let Some(new_facing) = charge_facing_for_target(&defender.position, attacker) else {
        return;
    };
    if defender.facing == new_facing {
        return;
    }

    let Some(defender_index) = find_unit_index(state, &defender.id) else {
        return;
    };
    let original_facing = state.units[defender_index].facing.clone();
    state.units[defender_index].facing = new_facing.clone();
    append_log(
        state,
        format!(
            "{} {} conformed from {} to {} to meet the charge.",
            state.units[defender_index].army,
            state.units[defender_index].name,
            original_facing,
            new_facing
        ),
    );
}
