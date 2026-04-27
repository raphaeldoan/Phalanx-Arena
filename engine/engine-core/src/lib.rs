pub mod combat;
pub mod core;
pub mod error;
pub mod movement;
pub mod prompting;
pub mod rules_shared;
pub mod scenario;
pub mod types;

pub use core::{EngineCore, FastGameHandle};
pub use error::EngineError;
pub use prompting::{
    build_action_catalog, build_user_prompt, describe_legal_action, legal_action_to_action,
    ActionCatalogEntry,
};
pub use rules_shared::{rules_metadata, RulesMetadata, UnitDefaultMetadata, UnitProfileMetadata};
pub use scenario::{
    build_game_state, get_scenario_definition, list_scenarios, load_scenario_definitions,
};
pub use types::*;
pub use types::{AiTurnContext, RichSnapshot};

pub const ENGINE_NAME: &str = "Phalanx Arena";
pub const ENGINE_VERSION: &str = "0.21";
pub const DESIGN_BASIS: &str = "SAB-inspired square-grid ancients engine with facing-led movement, line-and-column groups, scaled attrition, structured combat details, march actions, screening fire, flee/pursuit, residual contact cleanup, lane-based frontage pairing, terrain-aware combat, interpenetration, and broader scenario support";
