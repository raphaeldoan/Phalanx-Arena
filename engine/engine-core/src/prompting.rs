use serde::{Deserialize, Serialize};

use crate::combat::{build_combat_pairs, charge_evade_preview};
use crate::rules_shared::{
    adjacent_enemies, command_radius_for_army, find_unit, unit_profile, FIXED_PIPS_PER_BOUND,
};
use crate::types::{
    Action, AiTurnRequest, ArmyId, CombatKind, CombatResolution, Coord, FormationState, GamePhase,
    GameSnapshot, GroupChargeStep, GroupMoveStep, LegalAction, LogEntry, Unit,
};

mod catalog;
mod compact_actions;
mod compact_state;
mod profiles;
mod strict_prompt;

pub use self::catalog::*;
pub use self::compact_actions::*;
pub use self::compact_state::*;
pub use self::profiles::*;
pub use self::strict_prompt::*;
