use std::collections::{HashMap, HashSet, VecDeque};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::EngineError;
use crate::types::{
    can_evade_for_kind, default_unit_name, formation_class_for_kind, formation_state_for_kind,
    morale_value_for_kind, pursuit_class_for_kind, quality_for_kind, unit_class_for_kind, Army,
    ArmyId, AttritionStatus, BattleScore, Coord, DeploymentZone, Direction, FormationClass,
    FormationState, GamePhase, GameState, GroupChargeStep, LogEntry, PursuitClass, TerrainType,
    Unit, UnitClass, UnitKind, UnitQuality,
};

mod attrition;
mod combat_math;
mod command;
mod deployment;
mod formatting;
mod geometry;
mod movement_candidates;
mod pips;
mod profiles;
mod terrain;
mod unit_index;
mod victory;

pub(crate) use self::attrition::*;
pub(crate) use self::combat_math::*;
pub(crate) use self::command::*;
pub(crate) use self::deployment::*;
pub(crate) use self::formatting::*;
pub(crate) use self::geometry::*;
pub(crate) use self::movement_candidates::*;
pub(crate) use self::pips::*;
pub use self::profiles::*;
pub(crate) use self::terrain::*;
pub(crate) use self::unit_index::*;
pub(crate) use self::victory::*;
