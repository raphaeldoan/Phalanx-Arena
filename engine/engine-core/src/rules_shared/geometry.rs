use super::*;

pub(crate) const ROTATION_ORDER: [Direction; 4] =
    [Direction::N, Direction::E, Direction::S, Direction::W];

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MoveCandidate {
    pub(crate) destination: Coord,
    pub(crate) path: Vec<Coord>,
    pub(crate) facing: Direction,
    pub(crate) spent: i32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ChargeCandidate {
    pub(crate) destination: Coord,
    pub(crate) path: Vec<Coord>,
    pub(crate) facing: Direction,
    pub(crate) defender: Unit,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FrontageContext {
    pub(crate) line_by_army: HashMap<ArmyId, Vec<String>>,
    pub(crate) lane_value_by_unit: HashMap<String, i32>,
    pub(crate) unit_by_lane: HashMap<ArmyId, HashMap<i32, String>>,
    pub(crate) index_by_unit: HashMap<String, usize>,
    pub(crate) pair_by_unit: HashMap<String, String>,
}

pub(crate) struct CombatPair {
    pub(crate) attacker_id: String,
    pub(crate) defender_id: String,
    pub(crate) attacker_aspect: String,
    pub(crate) defender_aspect: String,
    pub(crate) frontage: Option<FrontageContext>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct MovementEndpoints {
    pub(crate) moves: Vec<MoveCandidate>,
    pub(crate) charges: Vec<ChargeCandidate>,
}

pub(crate) fn direction_index(direction: &Direction) -> usize {
    match direction {
        Direction::N => 0,
        Direction::E => 1,
        Direction::S => 2,
        Direction::W => 3,
    }
}

pub(crate) fn direction_from_index(index: usize) -> Direction {
    ROTATION_ORDER[index % ROTATION_ORDER.len()].clone()
}

pub(crate) fn direction_delta(direction: &Direction) -> (i32, i32) {
    match direction {
        Direction::N => (0, -1),
        Direction::E => (1, 0),
        Direction::S => (0, 1),
        Direction::W => (-1, 0),
    }
}

pub(crate) fn direction_vector(direction: &Direction) -> (i32, i32) {
    direction_delta(direction)
}

pub(crate) fn opposite_direction(direction: &Direction) -> Direction {
    direction_from_index(direction_index(direction) + 2)
}

pub(crate) fn left_flank_direction(direction: &Direction) -> Direction {
    direction_from_index(direction_index(direction) + 3)
}

pub(crate) fn right_flank_direction(direction: &Direction) -> Direction {
    direction_from_index(direction_index(direction) + 1)
}

pub(crate) fn flank_directions(direction: &Direction) -> (Direction, Direction) {
    (
        left_flank_direction(direction),
        right_flank_direction(direction),
    )
}

pub(crate) fn frontage_step_for_facing(facing: &Direction) -> (i32, i32) {
    if matches!(facing, Direction::N | Direction::S) {
        (1, 0)
    } else {
        (0, 1)
    }
}

pub(crate) fn normalise_step(dx: i32, dy: i32) -> (i32, i32) {
    (clamp_step(dx), clamp_step(dy))
}

pub(crate) fn recoil_step_from_contact(winner: &Unit, loser: &Unit) -> (i32, i32) {
    normalise_step(
        loser.position.x - winner.position.x,
        loser.position.y - winner.position.y,
    )
}

pub(crate) fn clamp_step(value: i32) -> i32 {
    if value > 0 {
        1
    } else if value < 0 {
        -1
    } else {
        0
    }
}

pub(crate) fn facing_from_delta(dx: i32, dy: i32) -> Direction {
    match normalise_step(dx, dy) {
        (0, -1) => Direction::N,
        (1, 0) => Direction::E,
        (0, 1) => Direction::S,
        (-1, 0) => Direction::W,
        _ => panic!("A move must change position."),
    }
}

pub(crate) fn direction_between(source: &Coord, target: &Coord) -> Direction {
    facing_from_delta(target.x - source.x, target.y - source.y)
}

pub(crate) fn distance_between(source: &Coord, target: &Coord) -> i32 {
    (target.x - source.x).abs() + (target.y - source.y).abs()
}

pub(crate) fn charge_facing_for_target(destination: &Coord, defender: &Unit) -> Option<Direction> {
    if distance_between(destination, &defender.position) != 1 {
        return None;
    }
    Some(direction_between(destination, &defender.position))
}

pub(crate) fn footprint_keys_for(position: &Coord, _facing: &Direction) -> [(i32, i32); 1] {
    [(position.x, position.y)]
}

pub(crate) fn edge_contact_keys_for(
    position: &Coord,
    _facing: &Direction,
    direction: &Direction,
) -> [(i32, i32); 1] {
    let (dx, dy) = direction_delta(direction);
    [(position.x + dx, position.y + dy)]
}

pub(crate) fn footprints_touch(
    source_position: &Coord,
    _source_facing: &Direction,
    target_position: &Coord,
    _target_facing: &Direction,
) -> bool {
    distance_between(source_position, target_position) == 1
}

pub(crate) fn adjacent_enemies_at_with_indexes<'a>(
    state: &'a GameState,
    indexes: &'a GameIndexes,
    army: &ArmyId,
    destination: &Coord,
    facing: &Direction,
    ignored_unit_ids: Option<&HashSet<String>>,
) -> Vec<&'a Unit> {
    let ignored = ignored_unit_ids;
    let enemy_army = army.other();
    indexes
        .active_units(state, &enemy_army)
        .filter(|enemy| ignored.is_none_or(|set| !set.contains(&enemy.id)))
        .filter(|enemy| footprints_touch(destination, facing, &enemy.position, &enemy.facing))
        .collect()
}

pub(crate) fn adjacent_enemies<'a>(state: &'a GameState, unit: &Unit) -> Vec<&'a Unit> {
    active_units(state, &unit.army.other())
        .into_iter()
        .filter(|enemy| {
            footprints_touch(&unit.position, &unit.facing, &enemy.position, &enemy.facing)
        })
        .collect()
}

pub(crate) fn adjacent_enemies_with_indexes<'a>(
    state: &'a GameState,
    indexes: &'a GameIndexes,
    unit: &Unit,
) -> Vec<&'a Unit> {
    let enemy_army = unit.army.other();
    indexes
        .active_units(state, &enemy_army)
        .filter(|enemy| {
            footprints_touch(&unit.position, &unit.facing, &enemy.position, &enemy.facing)
        })
        .collect()
}

pub(crate) fn is_front_contact(attacker: &Unit, defender: &Unit) -> bool {
    let front_keys = edge_contact_keys_for(&attacker.position, &attacker.facing, &attacker.facing);
    footprint_keys_for(&defender.position, &defender.facing)
        .into_iter()
        .any(|cell| front_keys.contains(&cell))
}

pub(crate) fn is_flank_or_rear_contact(attacker: &Unit, defender: &Unit) -> bool {
    footprints_touch(
        &attacker.position,
        &attacker.facing,
        &defender.position,
        &defender.facing,
    ) && attack_aspect(attacker, defender) != "front"
}

pub(crate) fn has_enemy_in_flank_or_rear(unit: &Unit, state: &GameState) -> bool {
    adjacent_enemies(state, unit)
        .into_iter()
        .any(|enemy| is_flank_or_rear_contact(enemy, unit))
}

pub(crate) fn has_enemy_in_flank_or_rear_with_indexes(
    unit: &Unit,
    state: &GameState,
    indexes: &GameIndexes,
) -> bool {
    adjacent_enemies_with_indexes(state, indexes, unit)
        .into_iter()
        .any(|enemy| is_flank_or_rear_contact(enemy, unit))
}

pub(crate) fn enemy_in_front_contact(state: &GameState, unit: &Unit) -> bool {
    !front_contact_enemies(state, unit).is_empty()
}

pub(crate) fn front_contact_enemies_at<'a>(
    state: &'a GameState,
    army: &ArmyId,
    position: &Coord,
    facing: &Direction,
    ignored_unit_ids: Option<&HashSet<String>>,
) -> Vec<&'a Unit> {
    let front_keys = edge_contact_keys_for(position, facing, facing);
    let ignored = ignored_unit_ids;
    active_units(state, &army.other())
        .into_iter()
        .filter(|enemy| ignored.is_none_or(|set| !set.contains(&enemy.id)))
        .filter(|enemy| {
            footprint_keys_for(&enemy.position, &enemy.facing)
                .into_iter()
                .any(|cell| front_keys.contains(&cell))
        })
        .collect()
}

pub(crate) fn front_contact_enemies_at_with_indexes<'a>(
    state: &'a GameState,
    indexes: &'a GameIndexes,
    army: &ArmyId,
    position: &Coord,
    facing: &Direction,
    ignored_unit_ids: Option<&HashSet<String>>,
) -> Vec<&'a Unit> {
    let front_keys = edge_contact_keys_for(position, facing, facing);
    let ignored = ignored_unit_ids;
    let enemy_army = army.other();
    indexes
        .active_units(state, &enemy_army)
        .filter(|enemy| ignored.is_none_or(|set| !set.contains(&enemy.id)))
        .filter(|enemy| {
            footprint_keys_for(&enemy.position, &enemy.facing)
                .into_iter()
                .any(|cell| front_keys.contains(&cell))
        })
        .collect()
}

pub(crate) fn front_contact_enemies<'a>(state: &'a GameState, unit: &Unit) -> Vec<&'a Unit> {
    front_contact_enemies_at(state, &unit.army, &unit.position, &unit.facing, None)
}

pub(crate) fn threat_zone_cells(unit: &Unit) -> [(i32, i32); 3] {
    let x = unit.position.x;
    let y = unit.position.y;
    match unit.facing {
        Direction::N => [(x - 1, y - 1), (x, y - 1), (x + 1, y - 1)],
        Direction::E => [(x + 1, y - 1), (x + 1, y), (x + 1, y + 1)],
        Direction::S => [(x - 1, y + 1), (x, y + 1), (x + 1, y + 1)],
        Direction::W => [(x - 1, y - 1), (x - 1, y), (x - 1, y + 1)],
    }
}

pub(crate) fn threat_generators_at_with_indexes<'a>(
    state: &'a GameState,
    indexes: &'a GameIndexes,
    army: &ArmyId,
    coord: &Coord,
    ignored_unit_ids: Option<&HashSet<String>>,
) -> Vec<&'a Unit> {
    let ignored = ignored_unit_ids;
    let enemy_army = army.other();
    indexes
        .active_units(state, &enemy_army)
        .filter(|enemy| ignored.is_none_or(|set| !set.contains(&enemy.id)))
        .filter(|enemy| {
            threat_zone_cells(enemy)
                .into_iter()
                .any(|cell| cell == (coord.x, coord.y))
        })
        .collect()
}

pub(crate) fn rotation_cost(source: &Direction, target: &Direction) -> i32 {
    if source == target {
        return 0;
    }
    let source_index = direction_index(source);
    let target_index = direction_index(target);
    let clockwise = (target_index + ROTATION_ORDER.len() - source_index) % ROTATION_ORDER.len();
    let counter_clockwise =
        (source_index + ROTATION_ORDER.len() - target_index) % ROTATION_ORDER.len();
    clockwise.min(counter_clockwise) as i32
}
