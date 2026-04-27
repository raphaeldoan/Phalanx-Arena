use super::*;

pub(crate) fn terrain_at(state: &GameState, coord: &Coord) -> TerrainType {
    state
        .terrain
        .iter()
        .find(|tile| tile.position == *coord)
        .map(|tile| tile.terrain.clone())
        .unwrap_or(TerrainType::Open)
}

pub(crate) fn terrain_at_with_indexes(indexes: &GameIndexes, coord: &Coord) -> TerrainType {
    indexes.terrain_at(coord)
}

pub(crate) fn terrain_under_footprint(
    state: &GameState,
    position: &Coord,
    facing: &Direction,
) -> Vec<TerrainType> {
    footprint_keys_for(position, facing)
        .into_iter()
        .map(|(x, y)| terrain_at(state, &Coord { x, y }))
        .collect()
}

pub(crate) fn terrain_under_footprint_with_indexes(
    indexes: &GameIndexes,
    position: &Coord,
    facing: &Direction,
) -> Vec<TerrainType> {
    footprint_keys_for(position, facing)
        .into_iter()
        .map(|(x, y)| indexes.terrain_at(&Coord { x, y }))
        .collect()
}

pub(crate) fn terrain_for_unit(state: &GameState, unit: &Unit) -> TerrainType {
    let terrains = terrain_under_footprint(state, &unit.position, &unit.facing);
    terrain_for_footprint(terrains)
}

pub(crate) fn terrain_for_unit_with_indexes(indexes: &GameIndexes, unit: &Unit) -> TerrainType {
    let terrains = terrain_under_footprint_with_indexes(indexes, &unit.position, &unit.facing);
    terrain_for_footprint(terrains)
}

pub(crate) fn terrain_for_footprint(terrains: Vec<TerrainType>) -> TerrainType {
    if terrains
        .iter()
        .any(|terrain| terrain == &TerrainType::Forest)
    {
        TerrainType::Forest
    } else if terrains.iter().any(|terrain| terrain == &TerrainType::Hill) {
        TerrainType::Hill
    } else if terrains
        .iter()
        .any(|terrain| terrain == &TerrainType::Water)
    {
        TerrainType::Water
    } else if terrains.iter().any(|terrain| terrain == &TerrainType::Road) {
        TerrainType::Road
    } else {
        TerrainType::Open
    }
}

pub(crate) fn terrain_counts_as_good(terrain: &TerrainType) -> bool {
    matches!(terrain, TerrainType::Open | TerrainType::Road)
}

pub(crate) fn is_bad_going_for_pike(state: &GameState, unit: &Unit) -> bool {
    !terrain_counts_as_good(&terrain_for_unit(state, unit))
}

pub(crate) fn is_bad_going_for_pike_with_indexes(indexes: &GameIndexes, unit: &Unit) -> bool {
    !terrain_counts_as_good(&terrain_for_unit_with_indexes(indexes, unit))
}

pub(crate) fn movement_cost(unit: &Unit, terrain: &TerrainType) -> Option<i32> {
    match terrain {
        TerrainType::Water => None,
        TerrainType::Road => Some(1),
        TerrainType::Forest => {
            if is_mounted(&unit.kind) || matches!(&unit.kind, UnitKind::Artillery) {
                None
            } else if matches!(unit.formation_class, FormationClass::OpenOrder) {
                Some(1)
            } else {
                Some(2)
            }
        }
        TerrainType::Hill => {
            if matches!(&unit.kind, UnitKind::Artillery | UnitKind::ScythedChariots) {
                None
            } else if is_mounted(&unit.kind) {
                Some(2)
            } else {
                Some(1)
            }
        }
        TerrainType::Open => Some(1),
    }
}

pub(crate) fn deployment_zones_for_army<'a>(
    state: &'a GameState,
    army: &ArmyId,
) -> Vec<&'a DeploymentZone> {
    state
        .deployment_zones
        .iter()
        .filter(|zone| zone.army == *army)
        .collect()
}

pub(crate) fn is_in_bounds(state: &GameState, x: i32, y: i32) -> bool {
    x >= 0 && x < state.board_width && y >= 0 && y < state.board_height
}

pub(crate) fn placement_cost(
    state: &GameState,
    unit: &Unit,
    position: &Coord,
    facing: Option<&Direction>,
) -> Option<i32> {
    let resolved_facing = facing.unwrap_or(&unit.facing);
    let mut costs = Vec::new();
    for (x, y) in footprint_keys_for(position, resolved_facing) {
        if !is_in_bounds(state, x, y) {
            return None;
        }
        let cost = movement_cost(unit, &terrain_at(state, &Coord { x, y }))?;
        costs.push(cost);
    }
    costs.into_iter().max().or(Some(1))
}

pub(crate) fn placement_cost_with_indexes(
    state: &GameState,
    indexes: &GameIndexes,
    unit: &Unit,
    position: &Coord,
    facing: Option<&Direction>,
) -> Option<i32> {
    let resolved_facing = facing.unwrap_or(&unit.facing);
    let mut costs = Vec::new();
    for (x, y) in footprint_keys_for(position, resolved_facing) {
        if !is_in_bounds(state, x, y) {
            return None;
        }
        let cost = movement_cost(unit, &indexes.terrain_at(&Coord { x, y }))?;
        costs.push(cost);
    }
    costs.into_iter().max().or(Some(1))
}

pub(crate) fn placement_is_clear(
    position: &Coord,
    facing: &Direction,
    occupied: &HashMap<(i32, i32), String>,
    ignored_unit_ids: Option<&HashSet<String>>,
) -> bool {
    for cell in footprint_keys_for(position, facing) {
        if let Some(occupant_id) = occupied.get(&cell) {
            if ignored_unit_ids.is_none_or(|set| !set.contains(occupant_id)) {
                return false;
            }
        }
    }
    true
}

pub(crate) fn can_enter_cell(
    state: &GameState,
    unit: &Unit,
    coord: &Coord,
    facing: Option<&Direction>,
) -> bool {
    let resolved_facing = facing.unwrap_or(&unit.facing);
    placement_cost(state, unit, coord, Some(resolved_facing)).is_some()
}

pub(crate) fn can_enter_cell_with_indexes(
    state: &GameState,
    indexes: &GameIndexes,
    unit: &Unit,
    coord: &Coord,
    facing: Option<&Direction>,
) -> bool {
    let resolved_facing = facing.unwrap_or(&unit.facing);
    placement_cost_with_indexes(state, indexes, unit, coord, Some(resolved_facing)).is_some()
}

pub(crate) fn can_recoil_into_cell(state: &GameState, unit: &Unit, coord: &Coord) -> bool {
    if !can_enter_cell(state, unit, coord, Some(&unit.facing)) {
        return false;
    }
    let terrains = terrain_under_footprint(state, coord, &unit.facing);
    if is_mounted(&unit.kind) && terrains.iter().any(|terrain| terrain == &TerrainType::Hill) {
        return false;
    }
    true
}

pub(crate) fn can_flee_into_cell(state: &GameState, unit: &Unit, coord: &Coord) -> bool {
    if !can_enter_cell(state, unit, coord, Some(&unit.facing)) {
        return false;
    }
    let terrains = terrain_under_footprint(state, coord, &unit.facing);
    if is_mounted(&unit.kind) && terrains.iter().any(|terrain| terrain == &TerrainType::Hill) {
        return false;
    }
    if is_mounted(&unit.kind)
        && terrains
            .iter()
            .any(|terrain| terrain == &TerrainType::Forest)
    {
        return false;
    }
    true
}

pub(crate) fn can_interpenetrate_through(state: &GameState, mover: &Unit, occupant: &Unit) -> bool {
    if occupant.army != mover.army {
        return false;
    }
    if !matches!(mover.formation_class, FormationClass::OpenOrder) {
        return false;
    }
    if !profile_supports_interpenetration(&mover.kind, &occupant.kind) {
        return false;
    }
    if occupant.facing != mover.facing {
        return false;
    }
    adjacent_enemies(state, occupant).is_empty()
}

pub(crate) fn can_interpenetrate_through_with_indexes(
    state: &GameState,
    indexes: &GameIndexes,
    mover: &Unit,
    occupant: &Unit,
) -> bool {
    if occupant.army != mover.army {
        return false;
    }
    if !matches!(mover.formation_class, FormationClass::OpenOrder) {
        return false;
    }
    if !profile_supports_interpenetration(&mover.kind, &occupant.kind) {
        return false;
    }
    if occupant.facing != mover.facing {
        return false;
    }
    adjacent_enemies_with_indexes(state, indexes, occupant).is_empty()
}
