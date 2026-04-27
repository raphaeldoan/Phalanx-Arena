use super::*;

pub(crate) const FIXED_PIPS_PER_BOUND: i32 = 8;
pub(crate) const MISSILE_SECTOR_LATERAL_LIMIT: i32 = 2;

pub(crate) fn path_uses_difficult_terrain(state: &GameState, path: &[Coord]) -> bool {
    path.iter().any(|coord| {
        !matches!(
            terrain_at(state, coord),
            TerrainType::Open | TerrainType::Road
        )
    })
}

pub(crate) fn path_uses_difficult_terrain_with_indexes(
    indexes: &GameIndexes,
    path: &[Coord],
) -> bool {
    path.iter().any(|coord| {
        !matches!(
            indexes.terrain_at(coord),
            TerrainType::Open | TerrainType::Road
        )
    })
}

pub(crate) fn single_action_pip_cost(
    state: &GameState,
    unit: &Unit,
    action_type: &str,
    path: &[Coord],
) -> Option<i32> {
    if !can_receive_voluntary_orders(unit) {
        return None;
    }
    if unit.disordered && action_type == "march_move" {
        return None;
    }
    if unit.formation_state == FormationState::DisorderedPike && action_type == "march_move" {
        return None;
    }
    if action_type == "charge"
        && matches!(
            get_unit_class(unit),
            UnitClass::Elephant | UnitClass::Chariot
        )
        && (is_bad_going_for_pike(state, unit) || path_uses_difficult_terrain(state, path))
    {
        return None;
    }

    let mut cost = 1;
    if action_type == "charge" {
        cost += 1;
    }
    if !unit.in_command {
        cost += 1;
    }
    if matches!(action_type, "move" | "march_move" | "charge")
        && path_uses_difficult_terrain(state, path)
    {
        cost += 1;
    }
    if matches!(&unit.kind, UnitKind::Artillery | UnitKind::Elephants) {
        cost += 1;
    }
    Some(cost)
}

pub(crate) fn single_action_pip_cost_with_indexes(
    indexes: &GameIndexes,
    unit: &Unit,
    action_type: &str,
    path: &[Coord],
) -> Option<i32> {
    if !can_receive_voluntary_orders(unit) {
        return None;
    }
    if unit.disordered && action_type == "march_move" {
        return None;
    }
    if unit.formation_state == FormationState::DisorderedPike && action_type == "march_move" {
        return None;
    }
    if action_type == "charge"
        && matches!(
            get_unit_class(unit),
            UnitClass::Elephant | UnitClass::Chariot
        )
        && (is_bad_going_for_pike_with_indexes(indexes, unit)
            || path_uses_difficult_terrain_with_indexes(indexes, path))
    {
        return None;
    }

    let mut cost = 1;
    if action_type == "charge" {
        cost += 1;
    }
    if !unit.in_command {
        cost += 1;
    }
    if matches!(action_type, "move" | "march_move" | "charge")
        && path_uses_difficult_terrain_with_indexes(indexes, path)
    {
        cost += 1;
    }
    if matches!(&unit.kind, UnitKind::Artillery | UnitKind::Elephants) {
        cost += 1;
    }
    Some(cost)
}

pub(crate) fn group_action_pip_cost_with_indexes(
    indexes: &GameIndexes,
    units: &[&Unit],
    action_type: &str,
    paths: &[Vec<Coord>],
) -> Option<i32> {
    if units.iter().any(|unit| !can_receive_voluntary_orders(unit)) {
        return None;
    }
    if units.iter().any(|unit| unit.disordered) {
        return None;
    }
    if matches!(action_type, "group_march_move" | "group_charge")
        && units
            .iter()
            .any(|unit| unit.formation_state == FormationState::DisorderedPike)
    {
        return None;
    }
    if units.iter().any(|unit| !unit.in_command) {
        return None;
    }

    let mut cost = 1;
    match action_type {
        "group_charge" => cost += 2,
        _ => {}
    }
    if paths
        .iter()
        .any(|path| path_uses_difficult_terrain_with_indexes(indexes, path))
    {
        cost += 1;
    }
    if units
        .iter()
        .any(|unit| matches!(&unit.kind, UnitKind::Artillery | UnitKind::Elephants))
    {
        cost += 1;
    }
    Some(cost)
}
