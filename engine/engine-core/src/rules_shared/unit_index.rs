use super::*;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct GameIndexes {
    unit_index_by_id: HashMap<String, usize>,
    unit_id_by_occupied_cell: HashMap<(i32, i32), String>,
    active_unit_indices_by_army: HashMap<ArmyId, Vec<usize>>,
    terrain_by_cell: HashMap<(i32, i32), TerrainType>,
    army_unit_count: HashMap<ArmyId, i32>,
    army_has_leader: HashSet<ArmyId>,
    leader_index_by_army: HashMap<ArmyId, usize>,
    command_radius_by_army: HashMap<ArmyId, i32>,
}

impl GameIndexes {
    pub(crate) fn new(state: &GameState) -> Self {
        let mut unit_index_by_id = HashMap::with_capacity(state.units.len());
        let mut unit_id_by_occupied_cell = HashMap::new();
        let mut active_unit_indices_by_army: HashMap<ArmyId, Vec<usize>> = HashMap::new();
        let mut army_unit_count: HashMap<ArmyId, i32> = HashMap::new();
        let mut army_has_leader = HashSet::new();
        let mut leader_index_by_army = HashMap::new();

        for (index, unit) in state.units.iter().enumerate() {
            unit_index_by_id.insert(unit.id.clone(), index);
            *army_unit_count.entry(unit.army.clone()).or_insert(0) += 1;
            if unit.leader {
                army_has_leader.insert(unit.army.clone());
            }

            if !unit.eliminated && !unit.off_map {
                active_unit_indices_by_army
                    .entry(unit.army.clone())
                    .or_default()
                    .push(index);
                if unit.leader {
                    leader_index_by_army
                        .entry(unit.army.clone())
                        .or_insert(index);
                }
            }

            if unit.eliminated
                || unit.off_map
                || (state.phase == GamePhase::Deployment && !unit.deployed)
            {
                continue;
            }
            for cell in footprint_keys_for(&unit.position, &unit.facing) {
                unit_id_by_occupied_cell.insert(cell, unit.id.clone());
            }
        }

        let terrain_by_cell = state
            .terrain
            .iter()
            .map(|tile| ((tile.position.x, tile.position.y), tile.terrain.clone()))
            .collect();
        let command_radius_by_army = army_unit_count
            .iter()
            .map(|(army, count)| {
                (
                    army.clone(),
                    BASE_COMMAND_RADIUS + i32::max(0, (*count - 1) / COMMAND_RADIUS_UNIT_STEP),
                )
            })
            .collect();

        Self {
            unit_index_by_id,
            unit_id_by_occupied_cell,
            active_unit_indices_by_army,
            terrain_by_cell,
            army_unit_count,
            army_has_leader,
            leader_index_by_army,
            command_radius_by_army,
        }
    }

    pub(crate) fn occupied_cells(&self) -> &HashMap<(i32, i32), String> {
        &self.unit_id_by_occupied_cell
    }

    pub(crate) fn find_unit_index(&self, unit_id: &str) -> Option<usize> {
        self.unit_index_by_id.get(unit_id).copied()
    }

    pub(crate) fn find_unit<'a>(&self, state: &'a GameState, unit_id: &str) -> Option<&'a Unit> {
        self.find_unit_index(unit_id)
            .and_then(|index| state.units.get(index))
    }

    pub(crate) fn active_unit_indices(&self, army: &ArmyId) -> &[usize] {
        self.active_unit_indices_by_army
            .get(army)
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    pub(crate) fn active_units<'a>(
        &'a self,
        state: &'a GameState,
        army: &ArmyId,
    ) -> impl Iterator<Item = &'a Unit> + 'a {
        self.active_unit_indices(army)
            .iter()
            .filter_map(|index| state.units.get(*index))
    }

    pub(crate) fn terrain_at(&self, coord: &Coord) -> TerrainType {
        self.terrain_by_cell
            .get(&(coord.x, coord.y))
            .cloned()
            .unwrap_or(TerrainType::Open)
    }

    pub(crate) fn army_has_leader(&self, army: &ArmyId) -> bool {
        self.army_has_leader.contains(army)
    }

    pub(crate) fn general_for_army<'a>(
        &self,
        state: &'a GameState,
        army: &ArmyId,
    ) -> Option<&'a Unit> {
        self.leader_index_by_army
            .get(army)
            .and_then(|index| state.units.get(*index))
    }

    pub(crate) fn command_radius_for_army(&self, army: &ArmyId) -> i32 {
        self.command_radius_by_army
            .get(army)
            .copied()
            .unwrap_or(BASE_COMMAND_RADIUS)
    }

    pub(crate) fn is_in_command(&self, state: &GameState, unit: &Unit) -> bool {
        if unit.eliminated || unit.off_map || unit.formation_state == FormationState::Overpursuit {
            return false;
        }
        if !self.army_has_leader(&unit.army) {
            return true;
        }
        let Some(leader) = self.general_for_army(state, &unit.army) else {
            return false;
        };
        distance_between(&unit.position, &leader.position)
            <= self.command_radius_for_army(&unit.army)
    }
}

pub(crate) fn occupied_cells(state: &GameState) -> HashMap<(i32, i32), String> {
    let mut occupied = HashMap::new();
    for unit in &state.units {
        if unit.eliminated
            || unit.off_map
            || (state.phase == GamePhase::Deployment && !unit.deployed)
        {
            continue;
        }
        for cell in footprint_keys_for(&unit.position, &unit.facing) {
            occupied.insert(cell, unit.id.clone());
        }
    }
    occupied
}

pub(crate) fn find_unit<'a>(state: &'a GameState, unit_id: &str) -> Option<&'a Unit> {
    state.units.iter().find(|unit| unit.id == unit_id)
}

pub(crate) fn find_unit_index(state: &GameState, unit_id: &str) -> Option<usize> {
    state.units.iter().position(|unit| unit.id == unit_id)
}

pub(crate) fn validate_active_unit_index(
    state: &GameState,
    unit_id: &str,
) -> Result<usize, EngineError> {
    let index = find_unit_index(state, unit_id)
        .ok_or_else(|| EngineError::InvalidAction(format!("unknown unit id: {unit_id}")))?;
    let unit = &state.units[index];
    if unit.eliminated {
        return Err(EngineError::InvalidAction(format!(
            "unit {unit_id} has been eliminated"
        )));
    }
    if unit.army != state.current_player {
        return Err(EngineError::InvalidAction(format!(
            "unit {unit_id} does not belong to current player"
        )));
    }
    if unit.activated_this_bound {
        return Err(EngineError::InvalidAction(format!(
            "unit {unit_id} has already acted this bound"
        )));
    }
    Ok(index)
}

pub(crate) fn active_units<'a>(state: &'a GameState, army: &ArmyId) -> Vec<&'a Unit> {
    state
        .units
        .iter()
        .filter(|unit| unit.army == *army && !unit.eliminated && !unit.off_map)
        .collect()
}

pub(crate) fn general_for_army<'a>(state: &'a GameState, army: &ArmyId) -> Option<&'a Unit> {
    state
        .units
        .iter()
        .find(|unit| unit.army == *army && unit.leader && !unit.eliminated && !unit.off_map)
}
