use super::*;

pub(crate) fn apply_group_move_resolved(
    state: &mut GameState,
    unit_ids: &[String],
    steps: &[GroupMoveStep],
    pip_cost: i32,
) -> Result<(), EngineError> {
    ensure_resolved_order_can_spend(state, pip_cost)?;
    validate_group_action_units(unit_ids, "A group move requires at least two units.")?;
    apply_group_unit_movements(state, unit_ids, steps)?;
    spend_resolved_order_pips(state, pip_cost);
    append_log(
        state,
        format!(
            "{} group moved {} for {} PIPs.",
            state.current_player,
            unit_ids.join(", "),
            pip_cost
        ),
    );
    let moved_unit_ids: Vec<&str> = unit_ids.iter().map(String::as_str).collect();
    refresh_after_movement_order(state, &moved_unit_ids, false);
    Ok(())
}

#[allow(dead_code)]
pub(crate) fn apply_group_march_move(
    state: &mut GameState,
    action: &Action,
) -> Result<(), EngineError> {
    let Action::GroupMarchMove { unit_ids, steps } = action else {
        return Err(EngineError::InvalidAction(
            "expected group march action".to_string(),
        ));
    };
    let legal_option = resolve_group_march_move_action(state, action)?;
    let LegalAction::GroupMarchMove { pip_cost, .. } = legal_option else {
        unreachable!();
    };
    apply_group_march_move_resolved(state, unit_ids, steps, pip_cost)
}

pub(crate) fn apply_group_march_move_resolved(
    state: &mut GameState,
    unit_ids: &[String],
    steps: &[GroupMoveStep],
    pip_cost: i32,
) -> Result<(), EngineError> {
    ensure_resolved_order_can_spend(state, pip_cost)?;
    validate_group_action_units(unit_ids, "A group march requires at least two units.")?;
    apply_group_unit_movements(state, unit_ids, steps)?;
    spend_resolved_order_pips(state, pip_cost);
    append_log(
        state,
        format!(
            "{} group marched {} for {} PIPs.",
            state.current_player,
            unit_ids.join(", "),
            pip_cost
        ),
    );
    let moved_unit_ids: Vec<&str> = unit_ids.iter().map(String::as_str).collect();
    refresh_after_movement_order(state, &moved_unit_ids, false);
    Ok(())
}

#[allow(dead_code)]
pub(crate) fn apply_group_charge(
    state: &mut GameState,
    action: &Action,
) -> Result<(), EngineError> {
    let Action::GroupCharge { unit_ids, steps } = action else {
        return Err(EngineError::InvalidAction(
            "expected group charge action".to_string(),
        ));
    };
    let legal_option = resolve_group_charge_action(state, action)?;
    let LegalAction::GroupCharge { pip_cost, .. } = legal_option else {
        unreachable!();
    };
    apply_group_charge_resolved(state, unit_ids, steps, pip_cost)
}

pub(crate) fn apply_group_charge_resolved(
    state: &mut GameState,
    unit_ids: &[String],
    steps: &[GroupChargeStep],
    pip_cost: i32,
) -> Result<(), EngineError> {
    ensure_resolved_order_can_spend(state, pip_cost)?;
    validate_group_action_units(unit_ids, "A group charge requires at least two units.")?;
    apply_group_unit_movements(state, unit_ids, steps)?;
    spend_resolved_order_pips(state, pip_cost);
    append_log(
        state,
        format!(
            "{} group charged {} for {} PIPs.",
            state.current_player,
            unit_ids.join(", "),
            pip_cost
        ),
    );
    for step in steps {
        let Some(defender_index) = find_unit_index(state, &step.target_id) else {
            continue;
        };
        let Some(attacker_index) = find_unit_index(state, &step.unit_id) else {
            continue;
        };
        let defender = state.units[defender_index].clone();
        let attacker = state.units[attacker_index].clone();
        if !maybe_evade_charge(state, &defender, &attacker) {
            if ordered_pike_charge_warning(&attacker, &defender, "front", state).is_some()
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
            let attacker_can_remain_in_contact =
                find_unit(state, &attacker.id).is_some_and(|unit| {
                    unit.formation_state != FormationState::Panic
                        && !unit.eliminated
                        && !unit.off_map
                });
            if attacker_can_remain_in_contact {
                conform_defender_if_isolated(state, &defender, &attacker);
                mark_unit_as_charging(state, &attacker.id);
            }
        }
    }
    refresh_after_movement_order(state, &[], true);
    Ok(())
}
