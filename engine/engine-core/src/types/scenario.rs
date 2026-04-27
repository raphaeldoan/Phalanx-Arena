use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerrainTile {
    pub position: Coord,
    pub terrain: TerrainType,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeploymentZone {
    pub army: ArmyId,
    pub min_x: i32,
    pub max_x: i32,
    pub min_y: i32,
    pub max_y: i32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScenarioUnit {
    pub id: String,
    pub army: ArmyId,
    #[serde(default)]
    pub name: Option<String>,
    pub kind: UnitKind,
    pub position: Coord,
    pub facing: Direction,
    #[serde(default)]
    pub leader: bool,
    #[serde(default)]
    pub formation_class: Option<FormationClass>,
    #[serde(default)]
    pub quality: Option<UnitQuality>,
    #[serde(default)]
    pub in_command: Option<bool>,
    #[serde(default)]
    pub disordered: Option<bool>,
    #[serde(default)]
    pub can_evade: Option<bool>,
    #[serde(default)]
    pub activated_this_bound: Option<bool>,
    #[serde(default)]
    pub charging: Option<bool>,
    #[serde(default)]
    pub eliminated: Option<bool>,
    #[serde(default)]
    pub unit_class: Option<UnitClass>,
    #[serde(default)]
    pub formation_state: Option<FormationState>,
    #[serde(default)]
    pub pursuit_class: Option<PursuitClass>,
    #[serde(default)]
    pub morale_value: Option<i32>,
    #[serde(default)]
    pub has_routed_before: Option<bool>,
    #[serde(default)]
    pub overpursuit_turns_remaining: Option<i32>,
    #[serde(default)]
    pub panic_turns_remaining: Option<i32>,
    #[serde(default)]
    pub army_general: Option<bool>,
    #[serde(default)]
    pub deployed: Option<bool>,
    #[serde(default)]
    pub off_map: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScenarioArmy {
    pub id: ArmyId,
    #[serde(default)]
    pub morale_threshold: Option<i32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]

pub struct ScenarioSummary {
    pub scenario_id: String,
    pub name: String,
    pub description: String,
    pub board_width: i32,
    pub board_height: i32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CreateGameRequest {
    pub scenario_id: String,
    pub seed: u64,
    #[serde(default = "default_army_a")]
    pub deployment_first_army: ArmyId,
    #[serde(default = "default_army_a")]
    pub first_bound_army: ArmyId,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReplayData {
    pub scenario_id: String,
    pub seed: u64,
    #[serde(default = "default_army_a")]
    pub deployment_first_army: ArmyId,
    #[serde(default = "default_army_a")]
    pub first_bound_army: ArmyId,
    #[serde(default)]
    pub actions: Vec<Action>,
    #[serde(default)]
    pub intent_updates: Vec<AiIntentUpdate>,
}

fn default_army_a() -> ArmyId {
    ArmyId::A
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ScenarioDefinition {
    pub scenario_id: String,
    pub name: String,
    pub description: String,
    pub board_width: i32,
    pub board_height: i32,
    #[serde(default)]
    pub terrain: Vec<TerrainTile>,
    #[serde(default)]
    pub deployment_zones: Vec<DeploymentZone>,
    #[serde(default)]
    pub armies: Vec<ScenarioArmy>,
    #[serde(default)]
    pub use_endgame_clock: bool,
    pub units: Vec<ScenarioUnit>,
}

impl ScenarioUnit {
    pub fn into_unit(self) -> Unit {
        let leader = self.leader;
        let kind = self.kind.clone();
        let id = self.id;
        let disordered = self.disordered.unwrap_or(false);
        let unit_class = self
            .unit_class
            .unwrap_or_else(|| unit_class_for_kind(&kind, leader));
        let pursuit_class = self
            .pursuit_class
            .unwrap_or_else(|| pursuit_class_for_kind(&kind, leader));
        let morale_value = self
            .morale_value
            .unwrap_or_else(|| morale_value_for_kind(&kind, leader));
        let formation_state = self
            .formation_state
            .unwrap_or_else(|| formation_state_for_kind(&unit_class, disordered));
        Unit {
            name: self.name.unwrap_or_else(|| default_unit_name(&kind, &id)),
            formation_class: self
                .formation_class
                .unwrap_or_else(|| formation_class_for_kind(&kind)),
            quality: self
                .quality
                .unwrap_or_else(|| quality_for_kind(&kind, leader)),
            in_command: self.in_command.unwrap_or(true),
            disordered,
            can_evade: self.can_evade.unwrap_or_else(|| can_evade_for_kind(&kind)),
            activated_this_bound: self.activated_this_bound.unwrap_or(false),
            charging: self.charging.unwrap_or(false),
            eliminated: self.eliminated.unwrap_or(false),
            unit_class,
            formation_state,
            pursuit_class,
            morale_value,
            has_routed_before: self.has_routed_before.unwrap_or(false),
            overpursuit_turns_remaining: self.overpursuit_turns_remaining.unwrap_or(0),
            panic_turns_remaining: self.panic_turns_remaining.unwrap_or(0),
            army_general: self.army_general.unwrap_or(leader),
            deployed: self.deployed.unwrap_or(true),
            off_map: self.off_map.unwrap_or(false),
            id,
            army: self.army,
            kind,
            position: self.position,
            facing: self.facing,
            leader,
        }
    }
}
