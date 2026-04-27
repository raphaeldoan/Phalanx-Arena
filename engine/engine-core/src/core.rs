use uuid::Uuid;

use crate::error::EngineError;
use crate::movement;
use crate::prompting::{build_action_catalog, build_user_prompt, legal_action_to_action};
use crate::scenario::{build_game_state_with_roles, list_scenarios};
use crate::types::{
    Action, AiInputMode, AiTurnContext, AiTurnRequest, ArmyId, GameSnapshot, LegalAction,
    ReplayData, RichSnapshot, ScenarioSummary,
};

#[derive(Debug, Default, Clone, Copy)]
pub struct EngineCore;

#[derive(Clone, Debug, PartialEq)]
pub struct FastGameHandle {
    pub state: crate::types::GameState,
    pub history: Vec<Action>,
}

impl EngineCore {
    pub fn new() -> Self {
        Self
    }

    pub fn list_scenarios(&self) -> Vec<ScenarioSummary> {
        list_scenarios()
    }

    pub fn new_game(&self, scenario_id: &str, seed: u64) -> Result<FastGameHandle, EngineError> {
        self.new_game_with_roles(scenario_id, seed, ArmyId::A, ArmyId::A)
    }

    pub fn new_game_with_roles(
        &self,
        scenario_id: &str,
        seed: u64,
        deployment_first_army: ArmyId,
        first_bound_army: ArmyId,
    ) -> Result<FastGameHandle, EngineError> {
        let game_id = Uuid::new_v4().simple().to_string();
        let state = build_game_state_with_roles(
            game_id,
            scenario_id,
            seed,
            deployment_first_army,
            first_bound_army,
        )?;
        Ok(FastGameHandle {
            state,
            history: Vec::new(),
        })
    }

    pub fn load_replay(&self, replay: &ReplayData) -> Result<FastGameHandle, EngineError> {
        let mut handle = self.new_game_with_roles(
            &replay.scenario_id,
            replay.seed,
            replay.deployment_first_army.clone(),
            replay.first_bound_army.clone(),
        )?;
        for action in replay.actions.iter().cloned() {
            handle.apply_action(action)?;
        }
        Ok(handle)
    }
}

impl FastGameHandle {
    pub fn snapshot(&self) -> RichSnapshot {
        RichSnapshot {
            snapshot: self.snapshot_game(),
            replay: self.replay(),
        }
    }

    pub fn snapshot_game(&self) -> GameSnapshot {
        let mut state = self.state.clone();
        movement::refresh_derived_fields(&mut state);
        let legal_actions = movement::legal_actions(&state);
        GameSnapshot {
            state,
            legal_actions,
            can_undo: !self.history.is_empty(),
        }
    }

    pub fn legal_actions(&self) -> Vec<LegalAction> {
        let mut state = self.state.clone();
        movement::refresh_derived_fields(&mut state);
        movement::legal_actions(&state)
    }

    pub fn apply_legal_action_index(
        &mut self,
        index: usize,
    ) -> Result<&crate::types::GameState, EngineError> {
        let legal_actions = self.legal_actions();
        let legal_action = legal_actions.get(index).ok_or_else(|| {
            EngineError::InvalidAction(format!("legal action index {index} is out of bounds"))
        })?;
        self.apply_resolved_legal_action_unchecked(legal_action)
    }

    fn apply_resolved_legal_action_unchecked(
        &mut self,
        legal_action: &LegalAction,
    ) -> Result<&crate::types::GameState, EngineError> {
        let action = legal_action_to_action(legal_action);
        movement::apply_resolved_legal_action_unchecked(&mut self.state, legal_action)?;
        self.history.push(action);
        Ok(&self.state)
    }

    pub fn apply_action(
        &mut self,
        action: Action,
    ) -> Result<&crate::types::GameState, EngineError> {
        movement::apply_action(&mut self.state, action.clone())?;
        self.history.push(action);
        Ok(&self.state)
    }

    pub fn undo(&mut self) -> Result<&crate::types::GameState, EngineError> {
        if self.history.pop().is_none() {
            return Err(EngineError::NothingToUndo);
        }
        let replay = self.replay();
        let rebuilt = EngineCore::new().load_replay(&replay)?;
        self.state = rebuilt.state;
        self.history = rebuilt.history;
        Ok(&self.state)
    }

    pub fn replay(&self) -> ReplayData {
        ReplayData {
            scenario_id: self.state.scenario_id.clone(),
            seed: self.state.seed,
            deployment_first_army: self.state.deployment_first_army.clone(),
            first_bound_army: self.state.first_bound_army.clone(),
            actions: self.history.clone(),
            intent_updates: Vec::new(),
        }
    }

    pub fn is_terminal(&self) -> bool {
        self.state.winner.is_some() || self.state.draw
    }

    pub fn winner(&self) -> Option<ArmyId> {
        self.state.winner.clone()
    }

    pub fn build_ai_turn_context(
        &self,
        input_mode: AiInputMode,
        action_history: Vec<Action>,
    ) -> AiTurnContext {
        let snapshot = self.snapshot();
        let request = AiTurnRequest {
            army: snapshot.snapshot.state.current_player.clone(),
            input_mode: input_mode.clone(),
            include_rationale: false,
            model: None,
            provider: None,
            current_intent: String::new(),
            can_update_intent: false,
            deployment_batch: false,
            battle_batch: false,
        };
        let action_catalog = build_action_catalog(&snapshot.snapshot.legal_actions);
        let prompt_text = build_user_prompt(
            &snapshot.snapshot,
            &request,
            &action_catalog,
            &action_history,
            None,
        );
        AiTurnContext {
            snapshot,
            input_mode,
            action_history,
            prompt_text,
        }
    }
}
