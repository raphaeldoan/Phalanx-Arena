use std::collections::{HashMap, HashSet};

use crate::error::EngineError;
use crate::rules_shared::{
    apply_morale_loss, check_army_morale, command_aura_bonus, enemy_in_front_contact,
    ensure_armies, game_is_over, get_pursuit_class, get_unit_class, is_in_bounds,
    left_flank_direction, local_combat_die_roll, opposite_direction, quality_modifier,
    right_flank_direction, role_neutral_combat_die_roll, should_clear_disorder_at_start_of_bound,
    sync_army_pips, unit_profile, update_all_pike_disorder_from_contacts,
    update_pike_disorder_from_position, CombatPair, FrontageContext, FIXED_PIPS_PER_BOUND,
};
use crate::types::{
    Action, ArmyId, AttritionStatus, BattleScore, CombatKind, CombatResolution, Coord, Direction,
    FormationClass, FormationState, GamePhase, GameState, PendingShot, PursuitClass, TerrainType,
    Unit, UnitClass, UnitKind, UnitQuality,
};

mod close_combat;
mod frontage;
mod panic;
mod recoil_flee;
mod shooting;

pub use self::close_combat::*;
pub(crate) use self::frontage::*;
pub use self::panic::*;
pub use self::recoil_flee::*;
pub use self::shooting::*;
