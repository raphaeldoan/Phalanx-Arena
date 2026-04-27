use super::*;

pub(crate) fn is_mounted(kind: &UnitKind) -> bool {
    crate::rules_shared::is_mounted(kind)
}

pub(crate) fn direction_vector(direction: &Direction) -> (i32, i32) {
    crate::rules_shared::direction_vector(direction)
}

pub(crate) fn distance_between(source: &Coord, target: &Coord) -> i32 {
    crate::rules_shared::distance_between(source, target)
}

pub(crate) fn terrain_for_unit(state: &GameState, unit: &Unit) -> TerrainType {
    crate::rules_shared::terrain_for_unit(state, unit)
}

pub(crate) fn terrain_counts_as_good(terrain: TerrainType) -> bool {
    crate::rules_shared::terrain_counts_as_good(&terrain)
}

pub(crate) fn footprints_touch(
    source_position: &Coord,
    source_facing: &Direction,
    target_position: &Coord,
    target_facing: &Direction,
) -> bool {
    crate::rules_shared::footprints_touch(
        source_position,
        source_facing,
        target_position,
        target_facing,
    )
}

pub(crate) fn recoil_step_from_contact(winner: &Unit, loser: &Unit) -> (i32, i32) {
    crate::rules_shared::recoil_step_from_contact(winner, loser)
}

pub(crate) fn charge_facing_for_target(destination: &Coord, defender: &Unit) -> Option<Direction> {
    crate::rules_shared::charge_facing_for_target(destination, defender)
}

pub(crate) fn occupied_cells(state: &GameState) -> HashMap<(i32, i32), String> {
    crate::rules_shared::occupied_cells(state)
}

pub(crate) fn active_units(state: &GameState, army: &ArmyId) -> Vec<Unit> {
    crate::rules_shared::active_units(state, army)
        .into_iter()
        .cloned()
        .collect()
}

pub(crate) fn find_unit(state: &GameState, unit_id: &str) -> Option<usize> {
    crate::rules_shared::find_unit_index(state, unit_id)
}

pub(crate) fn find_unit_ref<'a>(state: &'a GameState, unit_id: &str) -> Option<&'a Unit> {
    crate::rules_shared::find_unit(state, unit_id)
}

pub(crate) fn validate_active_unit(state: &GameState, unit_id: &str) -> Result<usize, EngineError> {
    crate::rules_shared::validate_active_unit_index(state, unit_id)
}

pub(crate) fn append_log(state: &mut GameState, message: String) {
    crate::rules_shared::append_log(state, message)
}

pub(crate) fn refresh_command_status(state: &mut GameState, log_changes: bool) {
    crate::rules_shared::refresh_command_status(state, log_changes)
}

pub(crate) fn single_action_pip_cost(
    state: &GameState,
    unit: &Unit,
    action_type: &str,
    path: &[Coord],
) -> Option<i32> {
    crate::rules_shared::single_action_pip_cost(state, unit, action_type, path)
}

pub(crate) fn can_enter_cell(
    state: &GameState,
    unit: &Unit,
    coord: &Coord,
    facing: Option<&Direction>,
) -> bool {
    crate::rules_shared::can_enter_cell(state, unit, coord, facing)
}

pub(crate) fn placement_is_clear(
    state: &GameState,
    _unit: &Unit,
    position: &Coord,
    facing: &Direction,
    ignored_unit_id: Option<&str>,
) -> bool {
    let occupied = occupied_cells(state);
    let ignored = ignored_unit_id.map(|unit_id| HashSet::from([unit_id.to_string()]));
    crate::rules_shared::placement_is_clear(position, facing, &occupied, ignored.as_ref())
}

pub(crate) fn can_recoil_into_cell(state: &GameState, unit: &Unit, coord: &Coord) -> bool {
    crate::rules_shared::can_recoil_into_cell(state, unit, coord)
}

pub(crate) fn can_flee_into_cell(state: &GameState, unit: &Unit, coord: &Coord) -> bool {
    crate::rules_shared::can_flee_into_cell(state, unit, coord)
}

pub(crate) fn enemy_army(army: &ArmyId) -> ArmyId {
    crate::rules_shared::enemy_army(army)
}

pub(crate) fn footprint_keys_for(position: &Coord, facing: &Direction) -> Vec<(i32, i32)> {
    crate::rules_shared::footprint_keys_for(position, facing)
        .into_iter()
        .collect()
}

pub(crate) fn adjacent_enemies(state: &GameState, unit: &Unit) -> Vec<Unit> {
    crate::rules_shared::adjacent_enemies(state, unit)
        .into_iter()
        .cloned()
        .collect()
}

pub(crate) fn front_contact_enemies(state: &GameState, unit: &Unit) -> Vec<Unit> {
    crate::rules_shared::front_contact_enemies(state, unit)
        .into_iter()
        .cloned()
        .collect()
}

pub(crate) fn recoil_displacements(
    state: &GameState,
    unit: &Unit,
    step: (i32, i32),
) -> Option<Vec<(String, Coord)>> {
    let destination = Coord {
        x: unit.position.x + step.0,
        y: unit.position.y + step.1,
    };
    if !can_recoil_into_cell(state, unit, &destination) {
        return None;
    }

    let occupied = occupied_cells(state);
    let colliding_ids: HashSet<String> = footprint_keys_for(&destination, &unit.facing)
        .into_iter()
        .filter_map(|cell| occupied.get(&cell).cloned())
        .filter(|occupant_id| occupant_id != &unit.id)
        .collect();
    if colliding_ids.is_empty() {
        return Some(vec![(unit.id.clone(), destination)]);
    }
    if colliding_ids.len() > 1 {
        return None;
    }
    let occupant_id = colliding_ids.iter().next().cloned()?;
    let occupant_index = find_unit(state, &occupant_id)?;
    let occupant = &state.units[occupant_index];
    if occupant.army != unit.army {
        return None;
    }
    let mut pushed = recoil_displacements(state, occupant, step)?;
    pushed.push((unit.id.clone(), destination));
    Some(pushed)
}

pub(crate) fn withdrawal_path(
    state: &GameState,
    unit: &Unit,
    threat: &Unit,
    distance: i32,
) -> Option<Vec<Coord>> {
    let step = recoil_step_from_contact(threat, unit);
    let occupied = occupied_cells(state);
    let mut path = Vec::new();
    let mut current = unit.position.clone();
    for step_index in 1..=distance {
        let destination = Coord {
            x: current.x + step.0,
            y: current.y + step.1,
        };
        if !can_flee_into_cell(state, unit, &destination) {
            return None;
        }
        let occupant_id = occupied.get(&(destination.x, destination.y)).cloned();
        let occupant = occupant_id.as_deref().and_then(|occupant_id| {
            if occupant_id == unit.id {
                None
            } else {
                find_unit_ref(state, occupant_id)
            }
        });
        let is_final_step = step_index == distance;
        if let Some(occupant) = occupant {
            if occupant.army != unit.army
                || is_final_step
                || !can_interpenetrate_through(state, unit, occupant)
            {
                return None;
            }
        }
        path.push(destination.clone());
        current = destination;
    }
    Some(path)
}

pub(crate) fn pursue_follow_up(
    state: &mut GameState,
    winner: &Unit,
    winning_aspect: &str,
    max_distance: i32,
) {
    let profile = unit_profile(&winner.kind);
    if winning_aspect != "front" || !profile.pursuit_eligible || profile.pursuit_distance <= 0 {
        return;
    }
    let (dx, dy) = direction_vector(&winner.facing);
    let occupied = occupied_cells(state);
    let mut path = Vec::new();
    let mut current = winner.position.clone();
    let limit = profile.pursuit_distance.min(max_distance);
    for _ in 0..limit {
        let destination = Coord {
            x: current.x + dx,
            y: current.y + dy,
        };
        if !can_enter_cell(state, winner, &destination, Some(&winner.facing)) {
            break;
        }
        if !placement_is_clear(
            state,
            winner,
            &destination,
            &winner.facing,
            Some(&winner.id),
        ) {
            break;
        }
        if occupied.contains_key(&(destination.x, destination.y)) && destination != current {
            break;
        }
        path.push(destination.clone());
        current = destination;
    }
    if path.is_empty() {
        return;
    }
    if let Some(index) = find_unit(state, &winner.id) {
        let origin = state.units[index].position.clone();
        state.units[index].position = path.last().cloned().expect("non-empty path");
        append_log(
            state,
            format!(
                "{} {} pursued from {} to {} via {}.",
                format_army(&winner.army),
                winner.name,
                format_coord(&origin),
                format_coord(&state.units[index].position),
                format_path(&path)
            ),
        );
    }
}

pub fn recoil_unit(state: &mut GameState, loser: &Unit, winner: &Unit) -> bool {
    let step = recoil_step_from_contact(winner, loser);
    let Some(displacements) = recoil_displacements(state, loser, step) else {
        return false;
    };
    let mut panic_tests = Vec::new();
    for (displaced_unit_id, destination) in displacements {
        let Some(index) = find_unit(state, &displaced_unit_id) else {
            continue;
        };
        let origin = state.units[index].position.clone();
        state.units[index].position = destination.clone();
        if displaced_unit_id == loser.id {
            let army = state.units[index].army.clone();
            let name = state.units[index].name.clone();
            append_log(
                state,
                format!(
                    "{} {} recoiled from {} to {}.",
                    format_army(&army),
                    name,
                    format_coord(&origin),
                    format_coord(&destination)
                ),
            );
        } else {
            let army = state.units[index].army.clone();
            let name = state.units[index].name.clone();
            append_log(
                state,
                format!(
                    "{} {} was pushed back from {} to {} by friendly recoil.",
                    format_army(&army),
                    name,
                    format_coord(&origin),
                    format_coord(&destination)
                ),
            );
        }
        let displaced = state.units[index].clone();
        apply_disorder(state, &displaced, None);
        if matches!(
            get_unit_class(&displaced),
            UnitClass::Elephant | UnitClass::Chariot
        ) {
            panic_tests.push(displaced.id.clone());
        }
    }
    for unit_id in panic_tests {
        resolve_panic_test(
            state,
            &unit_id,
            PanicTrigger::DisplacedThroughFriends,
            Some(winner.clone()),
        );
    }
    true
}

pub fn flee_unit(state: &mut GameState, loser: &Unit, winner: &Unit) -> Option<Vec<Coord>> {
    let path = withdrawal_path(state, loser, winner, 2)?;
    let index = find_unit(state, &loser.id)?;
    let origin = state.units[index].position.clone();
    state.units[index].position = path.last().cloned()?;
    let displaced = state.units[index].clone();
    apply_disorder(state, &displaced, None);
    let army = state.units[index].army.clone();
    let name = state.units[index].name.clone();
    append_log(
        state,
        format!(
            "{} {} fled from {} to {} via {}.",
            format_army(&army),
            name,
            format_coord(&origin),
            format_coord(&state.units[index].position),
            format_path(&path)
        ),
    );
    if matches!(
        get_unit_class(&displaced),
        UnitClass::Elephant | UnitClass::Chariot
    ) {
        resolve_panic_test(
            state,
            &displaced.id,
            PanicTrigger::DisplacedThroughFriends,
            Some(winner.clone()),
        );
    }
    Some(path)
}

pub fn maybe_evade_charge(state: &mut GameState, defender: &Unit, attacker: &Unit) -> bool {
    let Some(path) = charge_evade_preview(state, defender, attacker) else {
        return false;
    };
    let Some(index) = find_unit(state, &defender.id) else {
        return false;
    };
    let origin = state.units[index].position.clone();
    state.units[index].position = path.last().cloned().expect("non-empty withdrawal path");
    state.units[index].disordered = true;
    let army = state.units[index].army.clone();
    let name = state.units[index].name.clone();
    append_log(
        state,
        format!(
            "{} {} evaded from {} to {} via {} and became disordered.",
            format_army(&army),
            name,
            format_coord(&origin),
            format_coord(&state.units[index].position),
            format_path(&path)
        ),
    );
    true
}

pub fn advance_after_melee(state: &mut GameState, winner: &Unit, _loser: &Unit) {
    if winner.eliminated || game_is_over(state) {
        return;
    }
    let (dx, dy) = direction_vector(&winner.facing);
    let destination = Coord {
        x: winner.position.x + dx,
        y: winner.position.y + dy,
    };
    if !can_enter_cell(state, winner, &destination, Some(&winner.facing)) {
        return;
    }
    if !placement_is_clear(
        state,
        winner,
        &destination,
        &winner.facing,
        Some(&winner.id),
    ) {
        return;
    }
    if let Some(index) = find_unit(state, &winner.id) {
        let origin = state.units[index].position.clone();
        state.units[index].position = destination.clone();
        append_log(
            state,
            format!(
                "{} {} advanced from {} to {}.",
                format_army(&winner.army),
                winner.name,
                format_coord(&origin),
                format_coord(&destination)
            ),
        );
    }
}

pub fn pursue_after_recoil(
    state: &mut GameState,
    winner: &Unit,
    loser: &Unit,
    winning_aspect: &str,
) {
    if winner.eliminated || loser.eliminated || game_is_over(state) {
        return;
    }
    if winning_aspect != "front" {
        return;
    }
    pursue_follow_up(state, winner, winning_aspect, 1);
}

pub fn pursue_after_flee(state: &mut GameState, winner: &Unit, loser: &Unit, winning_aspect: &str) {
    if winner.eliminated || loser.eliminated || game_is_over(state) {
        return;
    }
    pursue_follow_up(state, winner, winning_aspect, 2);
}

pub fn resolve_residual_contacts(state: &mut GameState) {
    let mut changed = true;
    while changed {
        changed = false;
        let mut units: Vec<Unit> = state
            .units
            .iter()
            .filter(|unit| !unit.eliminated)
            .cloned()
            .collect();
        units.sort_by(|left, right| left.id.cmp(&right.id));
        for unit in units {
            if enemy_in_front_contact(state, &unit) {
                continue;
            }
            let adjacent = adjacent_enemies(state, &unit);
            if adjacent.len() != 1 {
                continue;
            }
            let Some(desired_facing) = charge_facing_for_target(&unit.position, &adjacent[0])
            else {
                continue;
            };
            if desired_facing == unit.facing {
                continue;
            }
            if let Some(index) = find_unit(state, &unit.id) {
                let original_facing = state.units[index].facing.clone();
                state.units[index].facing = desired_facing.clone();
                append_log(
                    state,
                    format!(
                        "{} {} turned from {:?} to {:?} to face lingering contact.",
                        format_army(&unit.army),
                        unit.name,
                        original_facing,
                        desired_facing
                    ),
                );
                changed = true;
            }
        }
    }
}
