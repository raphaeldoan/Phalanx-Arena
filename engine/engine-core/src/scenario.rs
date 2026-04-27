use std::collections::HashSet;
use std::sync::OnceLock;

use serde_json::from_str;

use crate::error::EngineError;
use crate::rules_shared::{
    get_morale_value, initialize_pike_formation_states, sync_all_unit_state_fields,
};
use crate::types::{
    Army, ArmyId, AttritionStatus, BattleScore, Coord, GamePhase, GameState, LogEntry,
    ScenarioDefinition, ScenarioSummary, Unit,
};
use crate::{DESIGN_BASIS, ENGINE_NAME, ENGINE_VERSION};

static SCENARIOS: OnceLock<Vec<ScenarioDefinition>> = OnceLock::new();

pub fn list_scenarios() -> Vec<ScenarioSummary> {
    load_scenario_definitions()
        .iter()
        .map(ScenarioDefinition::summary)
        .collect()
}

pub fn get_scenario_definition(scenario_id: &str) -> Option<&'static ScenarioDefinition> {
    load_scenario_definitions()
        .iter()
        .find(|definition| definition.scenario_id == scenario_id)
}

pub fn build_game_state(
    game_id: String,
    scenario_id: &str,
    seed: u64,
) -> Result<GameState, EngineError> {
    build_game_state_with_roles(game_id, scenario_id, seed, ArmyId::A, ArmyId::A)
}

pub fn build_game_state_with_roles(
    game_id: String,
    scenario_id: &str,
    seed: u64,
    deployment_first_army: ArmyId,
    first_bound_army: ArmyId,
) -> Result<GameState, EngineError> {
    let definition = get_scenario_definition(scenario_id)
        .ok_or_else(|| EngineError::UnknownScenario(scenario_id.to_string()))?;
    Ok(definition.build_game_state_with_roles(
        game_id,
        seed,
        deployment_first_army,
        first_bound_army,
    ))
}

pub fn load_scenario_definitions() -> &'static [ScenarioDefinition] {
    SCENARIOS.get_or_init(|| {
        let mut definitions = Vec::new();
        for (label, source) in embedded_scenarios().iter().copied() {
            let definition: ScenarioDefinition = from_str(source)
                .unwrap_or_else(|error| panic!("invalid embedded scenario {label}: {error}"));
            definition
                .validate()
                .unwrap_or_else(|error| panic!("invalid embedded scenario {label}: {error}"));
            definitions.push(definition);
        }
        definitions.sort_by(|left, right| left.scenario_id.cmp(&right.scenario_id));
        definitions
    })
}

include!(concat!(env!("OUT_DIR"), "/embedded_scenarios.rs"));

impl ScenarioDefinition {
    pub fn summary(&self) -> ScenarioSummary {
        ScenarioSummary {
            scenario_id: self.scenario_id.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            board_width: self.board_width,
            board_height: self.board_height,
        }
    }

    pub fn validate(&self) -> Result<(), EngineError> {
        if self.board_width < 1 || self.board_height < 1 {
            return Err(EngineError::InvalidScenario(
                "board dimensions must be positive".to_string(),
            ));
        }

        let mut occupied_units = HashSet::new();
        let mut unit_ids = HashSet::new();
        for unit in &self.units {
            if !unit_ids.insert(unit.id.clone()) {
                return Err(EngineError::InvalidScenario(format!(
                    "duplicate unit id: {}",
                    unit.id
                )));
            }
            assert_in_bounds(
                self.board_width,
                self.board_height,
                &unit.position,
                &format!("unit {}", unit.id),
            )?;
            if !occupied_units.insert((unit.position.x, unit.position.y)) {
                return Err(EngineError::InvalidScenario(format!(
                    "multiple units occupy ({}, {})",
                    unit.position.x, unit.position.y
                )));
            }
        }

        let mut terrain_cells = HashSet::new();
        for tile in &self.terrain {
            assert_in_bounds(
                self.board_width,
                self.board_height,
                &tile.position,
                "terrain tile",
            )?;
            if !terrain_cells.insert((tile.position.x, tile.position.y)) {
                return Err(EngineError::InvalidScenario(format!(
                    "multiple terrain tiles occupy ({}, {})",
                    tile.position.x, tile.position.y
                )));
            }
        }

        let mut zone_armies = HashSet::new();
        for zone in &self.deployment_zones {
            if zone.min_x > zone.max_x || zone.min_y > zone.max_y {
                return Err(EngineError::InvalidScenario(format!(
                    "invalid deployment zone for army {:?}",
                    zone.army
                )));
            }
            assert_in_bounds(
                self.board_width,
                self.board_height,
                &Coord {
                    x: zone.min_x,
                    y: zone.min_y,
                },
                "deployment zone",
            )?;
            assert_in_bounds(
                self.board_width,
                self.board_height,
                &Coord {
                    x: zone.max_x,
                    y: zone.max_y,
                },
                "deployment zone",
            )?;
            zone_armies.insert(zone.army.clone());
        }

        if !zone_armies.is_empty() && zone_armies.len() != 2 {
            return Err(EngineError::InvalidScenario(
                "if deployment zones are defined, both armies must have a zone".to_string(),
            ));
        }

        Ok(())
    }

    pub fn build_game_state(&self, game_id: String, seed: u64) -> GameState {
        self.build_game_state_with_roles(game_id, seed, ArmyId::A, ArmyId::A)
    }

    pub fn build_game_state_with_roles(
        &self,
        game_id: String,
        seed: u64,
        deployment_first_army: ArmyId,
        first_bound_army: ArmyId,
    ) -> GameState {
        let units: Vec<Unit> = self
            .units
            .clone()
            .into_iter()
            .map(|unit| {
                let mut unit = unit.into_unit();
                unit.deployed = false;
                unit
            })
            .collect();
        let attrition_status = build_attrition_status(&units);
        let battle_scores = vec![
            BattleScore {
                army: ArmyId::A,
                enemy_losses: 0,
                total: 0,
            },
            BattleScore {
                army: ArmyId::B,
                enemy_losses: 0,
                total: 0,
            },
        ];
        let armies = build_armies(&units, &self.armies);
        let victory_target = build_victory_target(&attrition_status);
        let mut state = GameState {
            game_id,
            engine_name: ENGINE_NAME.to_string(),
            engine_version: ENGINE_VERSION.to_string(),
            design_basis: DESIGN_BASIS.to_string(),
            scenario_id: self.scenario_id.clone(),
            scenario_name: self.name.clone(),
            board_width: self.board_width,
            board_height: self.board_height,
            phase: GamePhase::Deployment,
            bound_number: 1,
            current_player: deployment_first_army.clone(),
            deployment_first_army,
            first_bound_army,
            pips_remaining: 0,
            last_pip_roll: 0,
            seed,
            roll_index: 0,
            winner: None,
            draw: false,
            terrain: self.terrain.clone(),
            deployment_zones: self.deployment_zones.clone(),
            deployment_ready: Vec::new(),
            attrition_status,
            battle_scores,
            armies,
            victory_target,
            units,
            log: Vec::new(),
            recent_resolutions: Vec::new(),
            pending_shots: Vec::new(),
            endgame_deadline_bound: None,
            winner_reason: None,
            use_endgame_clock: self.use_endgame_clock,
        };
        sync_all_unit_state_fields(&mut state);
        initialize_pike_formation_states(&mut state);
        state.log.push(LogEntry {
            step: 0,
            message: format!("{:?} deployment phase begins.", state.current_player),
        });
        state
    }
}

fn build_attrition_status(units: &[Unit]) -> Vec<AttritionStatus> {
    [ArmyId::A, ArmyId::B]
        .into_iter()
        .map(|army| {
            let starting_units = units.iter().filter(|unit| unit.army == army).count();
            AttritionStatus {
                army,
                starting_units,
                losses: 0,
                target_losses: usize::max(4, starting_units.div_ceil(3)),
            }
        })
        .collect()
}

fn build_victory_target(attrition_status: &[AttritionStatus]) -> i32 {
    attrition_status
        .iter()
        .map(|status| status.target_losses)
        .max()
        .map(|losses| i32::max(5, (losses as i32) + 1))
        .unwrap_or(5)
}

fn build_armies(units: &[Unit], overrides: &[crate::types::ScenarioArmy]) -> Vec<Army> {
    [ArmyId::A, ArmyId::B]
        .into_iter()
        .map(|army| {
            let total_morale: i32 = units
                .iter()
                .filter(|unit| unit.army == army)
                .map(get_morale_value)
                .sum();
            let default_threshold = ((total_morale as f32) * 0.4).ceil() as i32;
            let morale_threshold = overrides
                .iter()
                .find(|override_army| override_army.id == army)
                .and_then(|override_army| override_army.morale_threshold)
                .unwrap_or(default_threshold);
            Army {
                id: army,
                pips: 0,
                morale_loss: 0,
                morale_threshold,
                shaken: false,
                broken: false,
            }
        })
        .collect()
}

fn assert_in_bounds(
    board_width: i32,
    board_height: i32,
    coord: &Coord,
    label: &str,
) -> Result<(), EngineError> {
    if coord.x < 0 || coord.x >= board_width || coord.y < 0 || coord.y >= board_height {
        return Err(EngineError::InvalidScenario(format!(
            "{label} is out of bounds at ({}, {})",
            coord.x, coord.y
        )));
    }
    Ok(())
}
