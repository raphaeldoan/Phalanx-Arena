use super::*;

pub(crate) const BASE_COMMAND_RADIUS: i32 = 8;
pub(crate) const COMMAND_RADIUS_UNIT_STEP: i32 = 8;

pub(crate) fn get_unit_class(unit: &Unit) -> UnitClass {
    let inferred = unit_class_for_kind(&unit.kind, unit.leader);
    if unit.unit_class == UnitClass::Formed && inferred != UnitClass::Formed {
        inferred
    } else {
        unit.unit_class.clone()
    }
}

pub(crate) fn get_pursuit_class(unit: &Unit) -> PursuitClass {
    let inferred = pursuit_class_for_kind(&unit.kind, unit.leader);
    if unit.pursuit_class == PursuitClass::None && inferred != PursuitClass::None {
        inferred
    } else {
        unit.pursuit_class.clone()
    }
}

pub(crate) fn get_morale_value(unit: &Unit) -> i32 {
    if unit.morale_value > 0 {
        unit.morale_value
    } else {
        morale_value_for_kind(&unit.kind, unit.leader)
    }
}

pub(crate) fn sync_unit_disorder_with_formation(unit: &mut Unit) {
    match unit.formation_state {
        FormationState::OrderedPike => unit.disordered = false,
        FormationState::DisorderedPike | FormationState::Panic | FormationState::Rout => {
            unit.disordered = true
        }
        FormationState::Normal | FormationState::Overpursuit => {}
    }
}

pub(crate) fn sync_all_unit_state_fields(state: &mut GameState) {
    for unit in &mut state.units {
        unit.unit_class = get_unit_class(unit);
        unit.pursuit_class = get_pursuit_class(unit);
        unit.morale_value = get_morale_value(unit);
        sync_unit_disorder_with_formation(unit);
    }
}

pub(crate) fn initialize_pike_formation_states(state: &mut GameState) {
    let unit_ids: Vec<String> = state.units.iter().map(|unit| unit.id.clone()).collect();
    for unit_id in unit_ids {
        let Some(index) = find_unit_index(state, &unit_id) else {
            continue;
        };
        if state.units[index].eliminated || get_unit_class(&state.units[index]) != UnitClass::Pike {
            continue;
        }
        if state.units[index].disordered {
            state.units[index].formation_state = FormationState::DisorderedPike;
            sync_unit_disorder_with_formation(&mut state.units[index]);
            continue;
        }
        if !is_bad_going_for_pike(state, &state.units[index])
            && !has_enemy_in_flank_or_rear(&state.units[index], state)
        {
            state.units[index].formation_state = FormationState::OrderedPike;
            sync_unit_disorder_with_formation(&mut state.units[index]);
        } else if state.units[index].formation_state == FormationState::OrderedPike {
            state.units[index].formation_state = FormationState::Normal;
        }
    }
}

pub(crate) fn is_ordered_pike(unit: &Unit, state: &GameState) -> bool {
    !unit.eliminated
        && get_unit_class(unit) == UnitClass::Pike
        && unit.formation_state == FormationState::OrderedPike
        && !unit.disordered
        && !matches!(
            unit.formation_state,
            FormationState::Rout | FormationState::Panic | FormationState::Overpursuit
        )
        && !is_bad_going_for_pike(state, unit)
        && !has_enemy_in_flank_or_rear(unit, state)
}

pub(crate) fn is_ordered_pike_with_indexes(
    unit: &Unit,
    state: &GameState,
    indexes: &GameIndexes,
) -> bool {
    !unit.eliminated
        && get_unit_class(unit) == UnitClass::Pike
        && unit.formation_state == FormationState::OrderedPike
        && !unit.disordered
        && !matches!(
            unit.formation_state,
            FormationState::Rout | FormationState::Panic | FormationState::Overpursuit
        )
        && !is_bad_going_for_pike_with_indexes(indexes, unit)
        && !has_enemy_in_flank_or_rear_with_indexes(unit, state, indexes)
}

pub(crate) fn set_pike_disordered(state: &mut GameState, unit_id: &str, reason: &str) {
    let Some(index) = find_unit_index(state, unit_id) else {
        return;
    };
    if state.units[index].eliminated || get_unit_class(&state.units[index]) != UnitClass::Pike {
        return;
    }
    if state.units[index].formation_state == FormationState::DisorderedPike {
        state.units[index].disordered = true;
        return;
    }
    state.units[index].formation_state = FormationState::DisorderedPike;
    state.units[index].disordered = true;
    append_log(
        state,
        format!(
            "{} {} became DisorderedPike ({reason}).",
            format_army(&state.units[index].army),
            state.units[index].name
        ),
    );
}

pub(crate) fn update_pike_disorder_from_position(state: &mut GameState, unit_id: &str) {
    let Some(index) = find_unit_index(state, unit_id) else {
        return;
    };
    let unit = state.units[index].clone();
    if unit.eliminated || get_unit_class(&unit) != UnitClass::Pike {
        return;
    }
    if matches!(
        unit.formation_state,
        FormationState::DisorderedPike
            | FormationState::Panic
            | FormationState::Rout
            | FormationState::Overpursuit
    ) {
        return;
    }
    if is_bad_going_for_pike(state, &unit) {
        set_pike_disordered(state, unit_id, "bad going");
        return;
    }
    if has_enemy_in_flank_or_rear(&unit, state) {
        set_pike_disordered(state, unit_id, "flank or rear contact");
    }
}

pub(crate) fn update_all_pike_disorder_from_contacts(state: &mut GameState) {
    let ids: Vec<String> = state
        .units
        .iter()
        .filter(|unit| !unit.eliminated && get_unit_class(unit) == UnitClass::Pike)
        .map(|unit| unit.id.clone())
        .collect();
    for unit_id in ids {
        update_pike_disorder_from_position(state, &unit_id);
    }
}

pub(crate) fn army_unit_count(state: &GameState, army: &ArmyId) -> i32 {
    state.units.iter().filter(|unit| unit.army == *army).count() as i32
}

pub(crate) fn command_radius_for_army(state: &GameState, army: &ArmyId) -> i32 {
    let army_size = army_unit_count(state, army);
    BASE_COMMAND_RADIUS + i32::max(0, (army_size - 1) / COMMAND_RADIUS_UNIT_STEP)
}

#[cfg(test)]
pub(crate) fn is_in_command(state: &GameState, unit: &Unit) -> bool {
    GameIndexes::new(state).is_in_command(state, unit)
}

pub(crate) fn command_aura_bonus(state: &GameState, unit: &Unit) -> i32 {
    let Some(leader) = general_for_army(state, &unit.army) else {
        return 0;
    };
    if distance_between(&unit.position, &leader.position) <= 1 {
        1
    } else {
        0
    }
}

pub(crate) fn refresh_command_status(state: &mut GameState, log_changes: bool) {
    let indexes = GameIndexes::new(state);
    let current_status: Vec<bool> = state
        .units
        .iter()
        .map(|unit| indexes.is_in_command(state, unit))
        .collect();
    let mut pending_logs = Vec::new();

    for (unit, next_status) in state.units.iter_mut().zip(current_status) {
        let previous_status = unit.in_command;
        if log_changes && previous_status != next_status {
            if next_status {
                pending_logs.push(format!("{:?} {} is back in command.", unit.army, unit.name));
            } else {
                pending_logs.push(format!("{:?} {} is out of command.", unit.army, unit.name));
            }
        }
        unit.in_command = next_status;
    }

    for message in pending_logs {
        append_log(state, message);
    }
}

pub(crate) fn can_receive_voluntary_orders(unit: &Unit) -> bool {
    !matches!(
        unit.formation_state,
        FormationState::Panic | FormationState::Rout | FormationState::Overpursuit
    ) && !unit.off_map
}

pub(crate) fn can_rally_with_indexes(
    unit: &Unit,
    state: &GameState,
    indexes: &GameIndexes,
) -> bool {
    state.phase == GamePhase::Battle
        && !unit.eliminated
        && !unit.activated_this_bound
        && unit.disordered
        && unit.formation_state != FormationState::DisorderedPike
        && can_receive_voluntary_orders(unit)
        && adjacent_enemies_with_indexes(state, indexes, unit).is_empty()
}

pub(crate) fn can_reform_pike_with_indexes(
    unit: &Unit,
    state: &GameState,
    indexes: &GameIndexes,
) -> bool {
    state.phase == GamePhase::Battle
        && !unit.eliminated
        && !unit.activated_this_bound
        && get_unit_class(unit) == UnitClass::Pike
        && unit.formation_state == FormationState::DisorderedPike
        && can_receive_voluntary_orders(unit)
        && adjacent_enemies_with_indexes(state, indexes, unit).is_empty()
        && !is_bad_going_for_pike_with_indexes(indexes, unit)
}

pub(crate) fn should_clear_disorder_at_start_of_bound(unit: &Unit, state: &GameState) -> bool {
    if !unit.disordered || unit.eliminated || !adjacent_enemies(state, unit).is_empty() {
        return false;
    }
    match get_unit_class(unit) {
        UnitClass::Light => true,
        UnitClass::Cavalry => unit.in_command,
        UnitClass::Leader => true,
        UnitClass::Formed | UnitClass::Pike | UnitClass::Elephant | UnitClass::Chariot => false,
    }
}

pub(crate) fn ordered_pike_charge_warning(
    attacker: &Unit,
    defender: &Unit,
    aspect: &str,
    state: &GameState,
) -> Option<String> {
    if aspect == "front"
        && is_ordered_pike(defender, state)
        && matches!(
            get_unit_class(attacker),
            UnitClass::Cavalry | UnitClass::Elephant | UnitClass::Chariot
        )
    {
        Some(
            "Charging an OrderedPike front will cancel shock and may trigger elephant/chariot panic."
                .to_string(),
        )
    } else {
        None
    }
}

pub(crate) fn ordered_pike_charge_warning_with_indexes(
    attacker: &Unit,
    defender: &Unit,
    aspect: &str,
    state: &GameState,
    indexes: &GameIndexes,
) -> Option<String> {
    if aspect == "front"
        && is_ordered_pike_with_indexes(defender, state, indexes)
        && matches!(
            get_unit_class(attacker),
            UnitClass::Cavalry | UnitClass::Elephant | UnitClass::Chariot
        )
    {
        Some(
            "Charging an OrderedPike front will cancel shock and may trigger elephant/chariot panic."
                .to_string(),
        )
    } else {
        None
    }
}
