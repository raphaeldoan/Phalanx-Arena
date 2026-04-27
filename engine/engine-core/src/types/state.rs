use super::*;

fn default_army_a() -> ArmyId {
    ArmyId::A
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LogEntry {
    pub step: i32,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttritionStatus {
    pub army: ArmyId,
    pub starting_units: usize,
    pub losses: usize,
    pub target_losses: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BattleScore {
    pub army: ArmyId,
    pub enemy_losses: usize,
    pub total: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Army {
    pub id: ArmyId,
    pub pips: i32,
    pub morale_loss: i32,
    pub morale_threshold: i32,
    pub shaken: bool,
    pub broken: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CombatKind {
    CloseCombat,
    Missile,
}

impl Display for CombatKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::CloseCombat => "close_combat",
            Self::Missile => "missile",
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CombatResolution {
    pub kind: CombatKind,
    pub attacker_id: String,
    pub attacker_name: String,
    pub attacker_position: Coord,
    pub defender_id: String,
    pub defender_name: String,
    pub defender_position: Coord,
    pub attacker_score: i32,
    pub attacker_roll: i32,
    pub attacker_total: i32,
    pub defender_score: i32,
    pub defender_roll: i32,
    pub defender_total: i32,
    #[serde(default)]
    pub attacker_notes: Vec<String>,
    #[serde(default)]
    pub defender_notes: Vec<String>,
    #[serde(default)]
    pub aspect: Option<String>,
    #[serde(default, rename = "range")]
    pub range: Option<i32>,
    pub differential: i32,
    pub outcome: String,
    #[serde(default)]
    pub winner_id: Option<String>,
    #[serde(default)]
    pub loser_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingShot {
    pub unit_id: String,
    pub target_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameState {
    pub game_id: String,
    pub engine_name: String,
    pub engine_version: String,
    pub design_basis: String,
    pub scenario_id: String,
    pub scenario_name: String,
    pub board_width: i32,
    pub board_height: i32,
    pub phase: GamePhase,
    pub bound_number: i32,
    pub current_player: ArmyId,
    #[serde(default = "default_army_a")]
    pub deployment_first_army: ArmyId,
    #[serde(default = "default_army_a")]
    pub first_bound_army: ArmyId,
    pub pips_remaining: i32,
    pub last_pip_roll: i32,
    pub seed: u64,
    pub roll_index: u64,
    #[serde(default)]
    pub winner: Option<ArmyId>,
    #[serde(default)]
    pub draw: bool,
    #[serde(default)]
    pub terrain: Vec<TerrainTile>,
    #[serde(default)]
    pub deployment_zones: Vec<DeploymentZone>,
    #[serde(default)]
    pub deployment_ready: Vec<ArmyId>,
    #[serde(default)]
    pub attrition_status: Vec<AttritionStatus>,
    #[serde(default)]
    pub battle_scores: Vec<BattleScore>,
    #[serde(default)]
    pub armies: Vec<Army>,
    pub victory_target: i32,
    pub units: Vec<Unit>,
    #[serde(default)]
    pub log: Vec<LogEntry>,
    #[serde(default)]
    pub recent_resolutions: Vec<CombatResolution>,
    #[serde(default)]
    pub pending_shots: Vec<PendingShot>,
    #[serde(default)]
    pub endgame_deadline_bound: Option<i32>,
    #[serde(default)]
    pub winner_reason: Option<String>,
    #[serde(default)]
    pub use_endgame_clock: bool,
}
