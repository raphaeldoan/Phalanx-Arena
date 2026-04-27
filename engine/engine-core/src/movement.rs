use std::collections::{HashMap, HashSet};

use crate::combat::{apply_shoot_with_pip_cost, end_bound, maybe_evade_charge};
use crate::error::EngineError;
use crate::rules_shared::*;
use crate::types::{
    Action, Coord, Direction, FormationState, GamePhase, GameState, GroupChargeStep, GroupMoveStep,
    LegalAction, Unit, UnitClass,
};

mod apply_group;
mod apply_single;
mod deployment;
mod legal_group;
mod legal_single;

pub(crate) use self::apply_group::*;
pub(crate) use self::apply_single::*;
pub(crate) use self::deployment::*;
pub(crate) use self::legal_group::*;
pub(crate) use self::legal_single::*;
