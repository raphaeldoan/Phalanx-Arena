use super::*;

pub(crate) fn deployment_destinations_with_indexes(
    state: &GameState,
    indexes: &GameIndexes,
    unit: &Unit,
    occupied: &HashMap<(i32, i32), String>,
) -> Vec<Coord> {
    let mut destinations = Vec::new();
    for zone in deployment_zones_for_army(state, &unit.army) {
        for y in zone.min_y..=zone.max_y {
            for x in zone.min_x..=zone.max_x {
                if unit.deployed && (x, y) == (unit.position.x, unit.position.y) {
                    continue;
                }
                let destination = Coord { x, y };
                if !can_enter_cell_with_indexes(
                    state,
                    indexes,
                    unit,
                    &destination,
                    Some(&unit.facing),
                ) {
                    continue;
                }
                let ignored = HashSet::from([unit.id.clone()]);
                if !placement_is_clear(&destination, &unit.facing, occupied, Some(&ignored)) {
                    continue;
                }
                destinations.push(destination);
            }
        }
    }
    destinations
}

pub(crate) fn legal_deployment_destination(
    state: &GameState,
    unit: &Unit,
    destination: &Coord,
) -> bool {
    let indexes = GameIndexes::new(state);
    deployment_destinations_with_indexes(state, &indexes, unit, indexes.occupied_cells())
        .into_iter()
        .any(|candidate| candidate == *destination)
}
