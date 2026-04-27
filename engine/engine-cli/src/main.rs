use std::collections::HashMap;
use std::io::{self, BufRead, Write};

use engine_core::{
    build_action_catalog, build_user_prompt, describe_legal_action, legal_action_to_action,
    rules_metadata, Action, ActionCatalogEntry, AiTurnRequest, CreateGameRequest, EngineCore,
    FastGameHandle, GameSnapshot, LegalAction, ReplayData,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Default)]
struct EngineCli {
    games: HashMap<String, FastGameHandle>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
enum EngineRequest {
    Ping,
    RulesMetadata,
    ListScenarios,
    CreateGame {
        request: CreateGameRequest,
    },
    CreateFromReplay {
        replay: ReplayData,
    },
    CloneGame {
        game_id: String,
    },
    Snapshot {
        game_id: String,
    },
    Apply {
        game_id: String,
        action: Action,
    },
    ApplyLegalActionIndex {
        game_id: String,
        index: usize,
    },
    Undo {
        game_id: String,
    },
    DropGame {
        game_id: String,
    },
    Replay {
        game_id: String,
    },
    BuildActionCatalog {
        legal_actions: Vec<LegalAction>,
    },
    BuildUserPrompt {
        snapshot: GameSnapshot,
        request: AiTurnRequest,
        action_catalog: Vec<ActionCatalogEntry>,
        #[serde(default)]
        action_history: Vec<Action>,
        prompt_profile: Option<String>,
    },
    DescribeLegalAction {
        action: LegalAction,
    },
    LegalActionToAction {
        action: LegalAction,
    },
}

#[derive(Debug, Serialize)]
struct EngineResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl EngineResponse {
    fn ok(result: Value) -> Self {
        Self {
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    fn error(error: impl Into<String>) -> Self {
        Self {
            ok: false,
            result: None,
            error: Some(error.into()),
        }
    }
}

impl EngineCli {
    fn handle(&mut self, request: EngineRequest) -> Result<Value, String> {
        match request {
            EngineRequest::Ping => Ok(json!({"protocol": "stdio-json-v1"})),
            EngineRequest::RulesMetadata => Self::serialize(rules_metadata()),
            EngineRequest::ListScenarios => Self::serialize(EngineCore::new().list_scenarios()),
            EngineRequest::CreateGame { request } => {
                let handle = EngineCore::new()
                    .new_game_with_roles(
                        &request.scenario_id,
                        request.seed,
                        request.deployment_first_army,
                        request.first_bound_army,
                    )
                    .map_err(|error| error.to_string())?;
                let snapshot = handle.snapshot_game();
                let game_id = snapshot.state.game_id.clone();
                self.games.insert(game_id, handle);
                Self::serialize(snapshot)
            }
            EngineRequest::CreateFromReplay { replay } => {
                let handle = EngineCore::new()
                    .load_replay(&replay)
                    .map_err(|error| error.to_string())?;
                let snapshot = handle.snapshot_game();
                let game_id = snapshot.state.game_id.clone();
                self.games.insert(game_id, handle);
                Self::serialize(snapshot)
            }
            EngineRequest::CloneGame { game_id } => {
                let handle = self
                    .games
                    .get(&game_id)
                    .ok_or_else(|| format!("Unknown game id: {game_id}"))?
                    .clone();
                let mut cloned_handle = handle;
                let cloned_game_id = Uuid::new_v4().simple().to_string();
                cloned_handle.state.game_id = cloned_game_id.clone();
                let snapshot = cloned_handle.snapshot_game();
                self.games.insert(cloned_game_id, cloned_handle);
                Self::serialize(snapshot)
            }
            EngineRequest::Snapshot { game_id } => {
                let handle = self.get_game(&game_id)?;
                Self::serialize(handle.snapshot_game())
            }
            EngineRequest::Apply { game_id, action } => {
                let handle = self.get_game_mut(&game_id)?;
                handle
                    .apply_action(action)
                    .map_err(|error| error.to_string())?;
                let snapshot = handle.snapshot_game();
                Self::serialize(snapshot)
            }
            EngineRequest::ApplyLegalActionIndex { game_id, index } => {
                let handle = self.get_game_mut(&game_id)?;
                handle
                    .apply_legal_action_index(index)
                    .map_err(|error| error.to_string())?;
                let snapshot = handle.snapshot_game();
                Self::serialize(snapshot)
            }
            EngineRequest::Undo { game_id } => {
                let handle = self.get_game_mut(&game_id)?;
                handle.undo().map_err(|error| error.to_string())?;
                let snapshot = handle.snapshot_game();
                Self::serialize(snapshot)
            }
            EngineRequest::DropGame { game_id } => {
                if self.games.remove(&game_id).is_none() {
                    return Err(format!("Unknown game id: {game_id}"));
                }
                Ok(Value::Null)
            }
            EngineRequest::Replay { game_id } => {
                let handle = self.get_game(&game_id)?;
                Self::serialize(handle.replay())
            }
            EngineRequest::BuildActionCatalog { legal_actions } => {
                Self::serialize(build_action_catalog(&legal_actions))
            }
            EngineRequest::BuildUserPrompt {
                snapshot,
                request,
                action_catalog,
                action_history,
                prompt_profile,
            } => Ok(json!(build_user_prompt(
                &snapshot,
                &request,
                &action_catalog,
                &action_history,
                prompt_profile
                    .as_deref()
                    .map(str::trim)
                    .filter(|profile| !profile.is_empty()),
            ))),
            EngineRequest::DescribeLegalAction { action } => {
                Ok(json!(describe_legal_action(&action)))
            }
            EngineRequest::LegalActionToAction { action } => {
                Self::serialize(legal_action_to_action(&action))
            }
        }
    }

    fn get_game(&self, game_id: &str) -> Result<&FastGameHandle, String> {
        self.games
            .get(game_id)
            .ok_or_else(|| format!("Unknown game id: {game_id}"))
    }

    fn get_game_mut(&mut self, game_id: &str) -> Result<&mut FastGameHandle, String> {
        self.games
            .get_mut(game_id)
            .ok_or_else(|| format!("Unknown game id: {game_id}"))
    }

    fn serialize<T: Serialize>(value: T) -> Result<Value, String> {
        serde_json::to_value(value).map_err(|error| error.to_string())
    }
}

fn main() -> io::Result<()> {
    if std::env::args().nth(1).as_deref() != Some("--stdio") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "engine-cli expects --stdio",
        ));
    }

    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    let mut engine = EngineCli::default();

    for line_result in stdin.lock().lines() {
        let line = line_result?;
        if line.trim().is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<EngineRequest>(&line) {
            Ok(request) => match engine.handle(request) {
                Ok(result) => EngineResponse::ok(result),
                Err(error) => EngineResponse::error(error),
            },
            Err(error) => EngineResponse::error(format!("invalid engine request: {error}")),
        };

        serde_json::to_writer(&mut stdout, &response)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
    }

    Ok(())
}
