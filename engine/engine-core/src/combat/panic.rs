use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PanicTrigger {
    MissileDisorder,
    LostCloseCombat,
    ChargedOrderedPike,
    FlankOrRearContact,
    ShotByLightTroops,
    DisplacedThroughFriends,
}

impl PanicTrigger {
    fn severity(self) -> i32 {
        match self {
            Self::MissileDisorder => 1,
            Self::LostCloseCombat
            | Self::ChargedOrderedPike
            | Self::FlankOrRearContact
            | Self::ShotByLightTroops
            | Self::DisplacedThroughFriends => 2,
        }
    }
}

pub(crate) fn charge_evade_preview(
    state: &GameState,
    defender: &Unit,
    attacker: &Unit,
) -> Option<Vec<Coord>> {
    if defender.eliminated || attacker.eliminated {
        return None;
    }
    if !defender.can_evade || defender.disordered {
        return None;
    }
    if attack_aspect(attacker, defender) != "front" {
        return None;
    }
    withdrawal_path(state, defender, attacker, 2)
}

pub fn should_test_panic(unit: &Unit, _trigger: PanicTrigger, _state: &GameState) -> bool {
    !unit.eliminated
        && !matches!(
            unit.formation_state,
            FormationState::Panic | FormationState::Rout
        )
        && matches!(
            get_unit_class(unit),
            UnitClass::Elephant | UnitClass::Chariot
        )
}

pub fn resolve_panic_test(
    state: &mut GameState,
    unit_id: &str,
    trigger: PanicTrigger,
    source: Option<Unit>,
) -> bool {
    let Some(unit) = find_unit_ref(state, unit_id).cloned() else {
        return false;
    };
    if !should_test_panic(&unit, trigger, state) {
        return false;
    }
    let command_modifier = if unit.in_command { 1 } else { 0 } + command_aura_bonus(state, &unit);
    let current_order_modifier = if unit.charging { -1 } else { 1 };
    let mut panic_score = quality_modifier(&unit) + command_modifier + current_order_modifier
        - trigger.severity()
        - if unit.disordered { 1 } else { 0 };
    if get_unit_class(&unit) == UnitClass::Chariot && trigger == PanicTrigger::ShotByLightTroops {
        panic_score -= 1;
    }
    if panic_score > -1 {
        append_log(
            state,
            format!(
                "{} {} held panic test {:?} with score {}.",
                format_army(&unit.army),
                unit.name,
                trigger,
                panic_score
            ),
        );
        return false;
    }

    if let Some(index) = find_unit(state, unit_id) {
        state.units[index].formation_state = FormationState::Panic;
        state.units[index].disordered = true;
        state.units[index].panic_turns_remaining = 1;
        state.units[index].activated_this_bound = true;
        state.units[index].charging = false;
    }
    append_log(
        state,
        format!(
            "{} {} panicked from {:?} with score {}.",
            format_army(&unit.army),
            unit.name,
            trigger,
            panic_score
        ),
    );
    move_panicked_unit(state, unit_id, source.as_ref());
    true
}

pub(crate) fn move_panicked_unit(state: &mut GameState, unit_id: &str, source: Option<&Unit>) {
    let Some(unit) = find_unit_ref(state, unit_id).cloned() else {
        return;
    };
    if unit.eliminated {
        return;
    }
    let away = panic_away_direction(state, &unit, source);
    let directions = panic_direction_order(&away);
    for direction in directions {
        match panic_path_for_direction(state, &unit, &direction) {
            PanicPath::Blocked => continue,
            PanicPath::Exit { path, passed } => {
                apply_panic_pass_through_effects(state, &unit, &passed);
                eliminate_unit(
                    state,
                    &unit,
                    format!(
                        "{} {} panicked off the map via {}.",
                        format_army(&unit.army),
                        unit.name,
                        format_path(&path)
                    ),
                );
                return;
            }
            PanicPath::Legal { path, passed } => {
                let destination = path
                    .last()
                    .cloned()
                    .unwrap_or_else(|| unit.position.clone());
                if let Some(index) = find_unit(state, unit_id) {
                    let origin = state.units[index].position.clone();
                    state.units[index].position = destination.clone();
                    state.units[index].facing = direction.clone();
                    append_log(
                        state,
                        format!(
                            "{} {} panicked from {} to {} via {}.",
                            format_army(&unit.army),
                            unit.name,
                            format_coord(&origin),
                            format_coord(&destination),
                            format_path(&path)
                        ),
                    );
                }
                apply_panic_pass_through_effects(state, &unit, &passed);
                update_pike_disorder_from_position(state, unit_id);
                return;
            }
        }
    }
    eliminate_unit(
        state,
        &unit,
        format!(
            "{} {} panicked with no legal path and was lost.",
            format_army(&unit.army),
            unit.name
        ),
    );
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum PanicPath {
    Legal {
        path: Vec<Coord>,
        passed: Vec<String>,
    },
    Exit {
        path: Vec<Coord>,
        passed: Vec<String>,
    },
    Blocked,
}

pub(crate) fn panic_path_for_direction(
    state: &GameState,
    unit: &Unit,
    direction: &Direction,
) -> PanicPath {
    let (dx, dy) = direction_vector(direction);
    let occupied = occupied_cells(state);
    let mut current = unit.position.clone();
    let mut path = Vec::new();
    let mut passed = Vec::new();
    for step_index in 1..=2 {
        let destination = Coord {
            x: current.x + dx,
            y: current.y + dy,
        };
        path.push(destination.clone());
        if !is_in_bounds(state, destination.x, destination.y) {
            return PanicPath::Exit { path, passed };
        }
        if !can_enter_cell(state, unit, &destination, Some(direction)) {
            return PanicPath::Blocked;
        }
        if let Some(occupant_id) = occupied.get(&(destination.x, destination.y)) {
            if occupant_id != &unit.id {
                if step_index == 2 {
                    return PanicPath::Blocked;
                }
                passed.push(occupant_id.clone());
            }
        }
        current = destination;
    }
    PanicPath::Legal { path, passed }
}

pub(crate) fn apply_panic_pass_through_effects(
    state: &mut GameState,
    panicker: &Unit,
    passed_ids: &[String],
) {
    let mut secondary_panic = Vec::new();
    for passed_id in passed_ids {
        let Some(target) = find_unit_ref(state, passed_id).cloned() else {
            continue;
        };
        apply_disorder(
            state,
            &target,
            Some(format!(
                "{} {} was disordered by panicking {}.",
                format_army(&target.army),
                target.name,
                panicker.name
            )),
        );
        if target.army == panicker.army
            && matches!(
                get_unit_class(&target),
                UnitClass::Elephant | UnitClass::Chariot
            )
        {
            secondary_panic.push(target.id.clone());
        }
    }
    for target_id in secondary_panic {
        if target_id != panicker.id {
            resolve_panic_test(
                state,
                &target_id,
                PanicTrigger::DisplacedThroughFriends,
                Some(panicker.clone()),
            );
        }
    }
}

pub(crate) fn resolve_overpursuit_if_needed(
    state: &mut GameState,
    winner: &Unit,
    loser: &Unit,
    winning_aspect: &str,
    outcome: &str,
) -> bool {
    if !matches!(outcome, "flee" | "destroy") || winning_aspect != "front" {
        return false;
    }
    let pursuit_class = get_pursuit_class(winner);
    if pursuit_class == PursuitClass::None || winner.leader {
        return false;
    }
    let command_modifier = if winner.in_command { 1 } else { 0 };
    let leader_adjacent_modifier = command_aura_bonus(state, winner);
    let charge_modifier = if winner.charging { 1 } else { 0 };
    let impetuous_modifier = if pursuit_class == PursuitClass::Impetuous {
        1
    } else {
        0
    };
    let disorder_modifier = if winner.disordered { 1 } else { 0 };
    let pursuit_score = quality_modifier(winner) + command_modifier + leader_adjacent_modifier
        - charge_modifier
        - impetuous_modifier
        - disorder_modifier;
    if pursuit_score > -1 {
        return false;
    }
    let Some(index) = find_unit(state, &winner.id) else {
        return false;
    };
    state.units[index].formation_state = FormationState::Overpursuit;
    state.units[index].overpursuit_turns_remaining = if pursuit_class == PursuitClass::Impetuous {
        2
    } else {
        1
    };
    state.units[index].charging = false;
    append_log(
        state,
        format!(
            "{} {} entered Overpursuit after {} routed/destroyed {} (score {}).",
            format_army(&winner.army),
            winner.name,
            winner.name,
            loser.name,
            pursuit_score
        ),
    );
    move_overpursuing_unit(state, &winner.id);
    true
}

pub(crate) fn move_overpursuing_unit(state: &mut GameState, unit_id: &str) {
    let Some(unit) = find_unit_ref(state, unit_id).cloned() else {
        return;
    };
    let profile = unit_profile(&unit.kind);
    let (dx, dy) = direction_vector(&unit.facing);
    let occupied = occupied_cells(state);
    let mut path = Vec::new();
    let mut current = unit.position.clone();
    for _ in 0..profile.pursuit_distance {
        let destination = Coord {
            x: current.x + dx,
            y: current.y + dy,
        };
        path.push(destination.clone());
        if !is_in_bounds(state, destination.x, destination.y) {
            if let Some(index) = find_unit(state, unit_id) {
                state.units[index].position = destination.clone();
                state.units[index].off_map = true;
            }
            append_log(
                state,
                format!(
                    "{} {} overpursued off-map via {}.",
                    format_army(&unit.army),
                    unit.name,
                    format_path(&path)
                ),
            );
            return;
        }
        if !can_enter_cell(state, &unit, &destination, Some(&unit.facing)) {
            path.pop();
            break;
        }
        if occupied
            .get(&(destination.x, destination.y))
            .is_some_and(|occupant_id| occupant_id != unit_id)
        {
            path.pop();
            break;
        }
        current = destination;
    }
    if path.is_empty() {
        return;
    }
    if let Some(index) = find_unit(state, unit_id) {
        let origin = state.units[index].position.clone();
        state.units[index].position = current.clone();
        append_log(
            state,
            format!(
                "{} {} overpursued from {} to {} via {}.",
                format_army(&unit.army),
                unit.name,
                format_coord(&origin),
                format_coord(&current),
                format_path(&path)
            ),
        );
    }
}

pub(crate) fn panic_away_direction(
    state: &GameState,
    unit: &Unit,
    source: Option<&Unit>,
) -> Direction {
    if let Some(source) = source {
        let dx = unit.position.x - source.position.x;
        let dy = unit.position.y - source.position.y;
        if dx.abs() >= dy.abs() && dx != 0 {
            return if dx > 0 { Direction::E } else { Direction::W };
        }
        if dy != 0 {
            return if dy > 0 { Direction::S } else { Direction::N };
        }
    }
    rear_edge_direction(state, &unit.army)
}

pub(crate) fn rear_edge_direction(_state: &GameState, army: &ArmyId) -> Direction {
    match army {
        ArmyId::A => Direction::S,
        ArmyId::B => Direction::N,
    }
}

pub(crate) fn panic_direction_order(away: &Direction) -> Vec<Direction> {
    vec![
        away.clone(),
        left_flank_direction(away),
        right_flank_direction(away),
        opposite_direction(away),
    ]
}
