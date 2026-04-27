use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AiIntentUpdate {
    pub army: ArmyId,
    pub bound_number: i32,
    pub action_number: i32,
    pub intent: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameSnapshot {
    pub state: GameState,
    pub legal_actions: Vec<LegalAction>,
    #[serde(default)]
    pub can_undo: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AiTurnRequest {
    pub army: ArmyId,
    #[serde(default = "default_ai_input_mode")]
    pub input_mode: AiInputMode,
    #[serde(default)]
    pub include_rationale: bool,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub current_intent: String,
    #[serde(default)]
    pub can_update_intent: bool,
    #[serde(default)]
    pub deployment_batch: bool,
    #[serde(default)]
    pub battle_batch: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AiUsage {
    #[serde(default)]
    pub input_tokens: Option<i32>,
    #[serde(default)]
    pub output_tokens: Option<i32>,
    #[serde(default)]
    pub total_tokens: Option<i32>,
    #[serde(default)]
    pub cached_input_tokens: Option<i32>,
    #[serde(default)]
    pub reasoning_tokens: Option<i32>,
    #[serde(default)]
    pub input_cost_usd: Option<f64>,
    #[serde(default)]
    pub output_cost_usd: Option<f64>,
    #[serde(default)]
    pub total_cost_usd: Option<f64>,
    #[serde(default)]
    pub pricing_model: Option<String>,
    #[serde(default = "default_true")]
    pub estimated: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AiTurnResponse {
    pub snapshot: GameSnapshot,
    pub applied_action: Action,
    pub applied_action_index: usize,
    pub applied_action_summary: String,
    pub input_mode_used: AiInputMode,
    pub prompt_text: String,
    pub reasoning: String,
    pub visual_observations: String,
    pub confidence: f64,
    pub model: String,
    #[serde(default)]
    pub usage: Option<AiUsage>,
    #[serde(default)]
    pub intent_update: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RichSnapshot {
    pub snapshot: GameSnapshot,
    pub replay: ReplayData,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AiTurnContext {
    pub snapshot: RichSnapshot,
    pub input_mode: AiInputMode,
    #[serde(default)]
    pub action_history: Vec<Action>,
    pub prompt_text: String,
}
