use engine_core::{
    build_action_catalog, build_user_prompt, describe_legal_action, legal_action_to_action,
    rules_metadata, Action, ActionCatalogEntry, AiTurnRequest, EngineCore, GameSnapshot,
    LegalAction, ReplayData,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct EngineHandle {
    inner: engine_core::FastGameHandle,
}

#[wasm_bindgen]
impl EngineHandle {
    #[wasm_bindgen(constructor)]
    pub fn new(scenario_id: String, seed: u64) -> Result<EngineHandle, JsValue> {
        let inner = EngineCore::new()
            .new_game(&scenario_id, seed)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        Ok(Self { inner })
    }

    pub fn new_with_roles(
        scenario_id: String,
        seed: u64,
        deployment_first_army: String,
        first_bound_army: String,
    ) -> Result<EngineHandle, JsValue> {
        let inner = EngineCore::new()
            .new_game_with_roles(
                &scenario_id,
                seed,
                parse_army_id(&deployment_first_army)?,
                parse_army_id(&first_bound_army)?,
            )
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        Ok(Self { inner })
    }

    pub fn snapshot_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.inner.snapshot_game()).map_err(json_error)
    }

    pub fn legal_actions_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.inner.legal_actions()).map_err(json_error)
    }

    pub fn apply_action_json(&mut self, action_json: String) -> Result<String, JsValue> {
        let action: Action = serde_json::from_str(&action_json).map_err(json_error)?;
        self.inner
            .apply_action(action)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        self.snapshot_json()
    }

    pub fn apply_legal_action_index(&mut self, index: usize) -> Result<String, JsValue> {
        self.inner
            .apply_legal_action_index(index)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        self.snapshot_json()
    }

    pub fn undo_json(&mut self) -> Result<String, JsValue> {
        self.inner
            .undo()
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        self.snapshot_json()
    }

    pub fn replay_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.inner.replay()).map_err(json_error)
    }
}

#[wasm_bindgen]
pub fn list_scenarios_json() -> Result<String, JsValue> {
    serde_json::to_string(&EngineCore::new().list_scenarios()).map_err(json_error)
}

#[wasm_bindgen]
pub fn rules_metadata_json() -> Result<String, JsValue> {
    serde_json::to_string(&rules_metadata()).map_err(json_error)
}

#[wasm_bindgen]
pub fn load_replay_json(replay_json: String) -> Result<String, JsValue> {
    let replay: ReplayData = serde_json::from_str(&replay_json).map_err(json_error)?;
    let inner = EngineCore::new()
        .load_replay(&replay)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    serde_json::to_string(&inner.snapshot_game()).map_err(json_error)
}

#[wasm_bindgen]
pub fn build_action_catalog_json(legal_actions_json: String) -> Result<String, JsValue> {
    let legal_actions: Vec<LegalAction> =
        serde_json::from_str(&legal_actions_json).map_err(json_error)?;
    serde_json::to_string(&build_action_catalog(&legal_actions)).map_err(json_error)
}

#[wasm_bindgen]
pub fn build_user_prompt_json(
    snapshot_json: String,
    request_json: String,
    action_catalog_json: String,
    action_history_json: String,
    prompt_profile: String,
) -> Result<String, JsValue> {
    let snapshot: GameSnapshot = serde_json::from_str(&snapshot_json).map_err(json_error)?;
    let request: AiTurnRequest = serde_json::from_str(&request_json).map_err(json_error)?;
    let action_catalog: Vec<ActionCatalogEntry> =
        serde_json::from_str(&action_catalog_json).map_err(json_error)?;
    let action_history: Vec<Action> =
        serde_json::from_str(&action_history_json).map_err(json_error)?;
    Ok(build_user_prompt(
        &snapshot,
        &request,
        &action_catalog,
        &action_history,
        Some(prompt_profile.as_str()),
    ))
}

#[wasm_bindgen]
pub fn describe_legal_action_json(action_json: String) -> Result<String, JsValue> {
    let action: LegalAction = serde_json::from_str(&action_json).map_err(json_error)?;
    Ok(describe_legal_action(&action))
}

#[wasm_bindgen]
pub fn legal_action_to_action_json(action_json: String) -> Result<String, JsValue> {
    let action: LegalAction = serde_json::from_str(&action_json).map_err(json_error)?;
    serde_json::to_string(&legal_action_to_action(&action)).map_err(json_error)
}

fn json_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

fn parse_army_id(value: &str) -> Result<engine_core::ArmyId, JsValue> {
    match value {
        "A" => Ok(engine_core::ArmyId::A),
        "B" => Ok(engine_core::ArmyId::B),
        _ => Err(JsValue::from_str("army id must be A or B")),
    }
}
