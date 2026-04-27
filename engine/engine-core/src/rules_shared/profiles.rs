use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct UnitProfile {
    pub(crate) movement: i32,
    pub(crate) march_bonus: i32,
    pub(crate) close_vs_foot: i32,
    pub(crate) close_vs_mounted: i32,
    pub(crate) missile_range: i32,
    pub(crate) missile_strength: i32,
    pub(crate) missile_defense: i32,
    pub(crate) support_eligible: bool,
    pub(crate) pursuit_eligible: bool,
    pub(crate) pursuit_distance: i32,
    pub(crate) mounted: bool,
    pub(crate) screen_height: i32,
    pub(crate) short_name: &'static str,
    pub(crate) interpenetrates_friends: &'static [UnitKind],
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RulesMetadata {
    pub unit_kinds: Vec<String>,
    pub unit_profiles: Vec<UnitProfileMetadata>,
    pub unit_defaults: Vec<UnitDefaultMetadata>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct UnitProfileMetadata {
    pub kind: String,
    pub movement: i32,
    pub march_bonus: i32,
    pub close_vs_foot: i32,
    pub close_vs_mounted: i32,
    pub missile_range: i32,
    pub missile_strength: i32,
    pub missile_defense: i32,
    pub support_eligible: bool,
    pub pursuit_eligible: bool,
    pub pursuit_distance: i32,
    pub mounted: bool,
    pub screen_height: i32,
    pub short_name: &'static str,
    pub pass_through: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct UnitDefaultMetadata {
    pub kind: String,
    pub leader: bool,
    pub formation_class: String,
    pub quality: String,
    pub can_evade: bool,
    pub unit_class: String,
    pub pursuit_class: String,
    pub morale_value: i32,
    pub formation_state: String,
    pub default_name: String,
}

pub(crate) const SPEAR_PROFILE: UnitProfile = UnitProfile {
    movement: 2,
    march_bonus: 1,
    close_vs_foot: 4,
    close_vs_mounted: 4,
    missile_range: 0,
    missile_strength: 0,
    missile_defense: 3,
    support_eligible: true,
    pursuit_eligible: false,
    pursuit_distance: 0,
    mounted: false,
    screen_height: 2,
    short_name: "Sp",
    interpenetrates_friends: &[],
};
pub(crate) const PIKE_PROFILE: UnitProfile = UnitProfile {
    movement: 2,
    march_bonus: 1,
    close_vs_foot: 4,
    close_vs_mounted: 5,
    missile_range: 0,
    missile_strength: 0,
    missile_defense: 3,
    support_eligible: true,
    pursuit_eligible: true,
    pursuit_distance: 1,
    mounted: false,
    screen_height: 2,
    short_name: "Pk",
    interpenetrates_friends: &[],
};
pub(crate) const BLADE_PROFILE: UnitProfile = UnitProfile {
    movement: 3,
    march_bonus: 1,
    close_vs_foot: 5,
    close_vs_mounted: 3,
    missile_range: 0,
    missile_strength: 0,
    missile_defense: 4,
    support_eligible: true,
    pursuit_eligible: true,
    pursuit_distance: 1,
    mounted: false,
    screen_height: 2,
    short_name: "Bd",
    interpenetrates_friends: &[],
};
pub(crate) const WARBAND_PROFILE: UnitProfile = UnitProfile {
    movement: 3,
    march_bonus: 1,
    close_vs_foot: 4,
    close_vs_mounted: 3,
    missile_range: 0,
    missile_strength: 0,
    missile_defense: 2,
    support_eligible: false,
    pursuit_eligible: true,
    pursuit_distance: 1,
    mounted: false,
    screen_height: 2,
    short_name: "Wb",
    interpenetrates_friends: &[],
};
pub(crate) const AUXILIA_PROFILE: UnitProfile = UnitProfile {
    movement: 3,
    march_bonus: 1,
    close_vs_foot: 3,
    close_vs_mounted: 3,
    missile_range: 0,
    missile_strength: 0,
    missile_defense: 2,
    support_eligible: false,
    pursuit_eligible: false,
    pursuit_distance: 0,
    mounted: false,
    screen_height: 2,
    short_name: "Ax",
    interpenetrates_friends: &[],
};
pub(crate) const HORDE_PROFILE: UnitProfile = UnitProfile {
    movement: 2,
    march_bonus: 0,
    close_vs_foot: 2,
    close_vs_mounted: 2,
    missile_range: 0,
    missile_strength: 0,
    missile_defense: 1,
    support_eligible: false,
    pursuit_eligible: false,
    pursuit_distance: 0,
    mounted: false,
    screen_height: 2,
    short_name: "Hd",
    interpenetrates_friends: &[],
};
pub(crate) const CAVALRY_PROFILE: UnitProfile = UnitProfile {
    movement: 4,
    march_bonus: 2,
    close_vs_foot: 3,
    close_vs_mounted: 3,
    missile_range: 0,
    missile_strength: 0,
    missile_defense: 3,
    support_eligible: false,
    pursuit_eligible: true,
    pursuit_distance: 2,
    mounted: true,
    screen_height: 3,
    short_name: "Cv",
    interpenetrates_friends: &[],
};
pub(crate) const LIGHT_HORSE_PROFILE: UnitProfile = UnitProfile {
    movement: 4,
    march_bonus: 2,
    close_vs_foot: 2,
    close_vs_mounted: 2,
    missile_range: 0,
    missile_strength: 0,
    missile_defense: 2,
    support_eligible: false,
    pursuit_eligible: false,
    pursuit_distance: 0,
    mounted: true,
    screen_height: 2,
    short_name: "LH",
    interpenetrates_friends: &[],
};
pub(crate) const BOW_CAVALRY_PROFILE: UnitProfile = UnitProfile {
    movement: 4,
    march_bonus: 2,
    close_vs_foot: 2,
    close_vs_mounted: 2,
    missile_range: 2,
    missile_strength: 2,
    missile_defense: 2,
    support_eligible: false,
    pursuit_eligible: false,
    pursuit_distance: 0,
    mounted: true,
    screen_height: 2,
    short_name: "BC",
    interpenetrates_friends: &[],
};
pub(crate) const KNIGHTS_PROFILE: UnitProfile = UnitProfile {
    movement: 3,
    march_bonus: 2,
    close_vs_foot: 4,
    close_vs_mounted: 4,
    missile_range: 0,
    missile_strength: 0,
    missile_defense: 4,
    support_eligible: false,
    pursuit_eligible: true,
    pursuit_distance: 2,
    mounted: true,
    screen_height: 3,
    short_name: "Kn",
    interpenetrates_friends: &[],
};
pub(crate) const ELEPHANTS_PROFILE: UnitProfile = UnitProfile {
    movement: 3,
    march_bonus: 1,
    close_vs_foot: 5,
    close_vs_mounted: 5,
    missile_range: 0,
    missile_strength: 0,
    missile_defense: 4,
    support_eligible: false,
    pursuit_eligible: true,
    pursuit_distance: 1,
    mounted: true,
    screen_height: 4,
    short_name: "El",
    interpenetrates_friends: &[],
};
pub(crate) const SCYTHED_CHARIOTS_PROFILE: UnitProfile = UnitProfile {
    movement: 4,
    march_bonus: 2,
    close_vs_foot: 4,
    close_vs_mounted: 4,
    missile_range: 0,
    missile_strength: 0,
    missile_defense: 2,
    support_eligible: false,
    pursuit_eligible: true,
    pursuit_distance: 1,
    mounted: true,
    screen_height: 3,
    short_name: "SCh",
    interpenetrates_friends: &[],
};
pub(crate) const BOW_PROFILE: UnitProfile = UnitProfile {
    movement: 2,
    march_bonus: 0,
    close_vs_foot: 2,
    close_vs_mounted: 2,
    missile_range: 4,
    missile_strength: 3,
    missile_defense: 2,
    support_eligible: false,
    pursuit_eligible: false,
    pursuit_distance: 0,
    mounted: false,
    screen_height: 2,
    short_name: "Bw",
    interpenetrates_friends: &[UnitKind::Psiloi, UnitKind::Slinger, UnitKind::Bow],
};
pub(crate) const SLINGER_PROFILE: UnitProfile = UnitProfile {
    movement: 2,
    march_bonus: 1,
    close_vs_foot: 2,
    close_vs_mounted: 2,
    missile_range: 3,
    missile_strength: 2,
    missile_defense: 2,
    support_eligible: false,
    pursuit_eligible: false,
    pursuit_distance: 0,
    mounted: false,
    screen_height: 2,
    short_name: "Sl",
    interpenetrates_friends: &[
        UnitKind::Spear,
        UnitKind::Pike,
        UnitKind::Blade,
        UnitKind::Warband,
        UnitKind::Auxilia,
        UnitKind::Horde,
        UnitKind::Bow,
        UnitKind::Slinger,
        UnitKind::Psiloi,
    ],
};
pub(crate) const PSILOI_PROFILE: UnitProfile = UnitProfile {
    movement: 3,
    march_bonus: 1,
    close_vs_foot: 2,
    close_vs_mounted: 3,
    missile_range: 2,
    missile_strength: 2,
    missile_defense: 2,
    support_eligible: false,
    pursuit_eligible: false,
    pursuit_distance: 0,
    mounted: false,
    screen_height: 1,
    short_name: "Ps",
    interpenetrates_friends: &[
        UnitKind::Spear,
        UnitKind::Pike,
        UnitKind::Blade,
        UnitKind::Warband,
        UnitKind::Auxilia,
        UnitKind::Horde,
        UnitKind::Bow,
        UnitKind::Psiloi,
    ],
};
pub(crate) const ARTILLERY_PROFILE: UnitProfile = UnitProfile {
    movement: 1,
    march_bonus: 0,
    close_vs_foot: 2,
    close_vs_mounted: 2,
    missile_range: 5,
    missile_strength: 4,
    missile_defense: 1,
    support_eligible: false,
    pursuit_eligible: false,
    pursuit_distance: 0,
    mounted: false,
    screen_height: 3,
    short_name: "Art",
    interpenetrates_friends: &[],
};

pub(crate) fn unit_profile(kind: &UnitKind) -> &'static UnitProfile {
    match kind {
        UnitKind::Spear => &SPEAR_PROFILE,
        UnitKind::Pike => &PIKE_PROFILE,
        UnitKind::GuardPike => &PIKE_PROFILE,
        UnitKind::Blade => &BLADE_PROFILE,
        UnitKind::Warband => &WARBAND_PROFILE,
        UnitKind::Auxilia => &AUXILIA_PROFILE,
        UnitKind::Horde => &HORDE_PROFILE,
        UnitKind::Cavalry => &CAVALRY_PROFILE,
        UnitKind::LightHorse => &LIGHT_HORSE_PROFILE,
        UnitKind::BowCavalry => &BOW_CAVALRY_PROFILE,
        UnitKind::Knights => &KNIGHTS_PROFILE,
        UnitKind::Elephants => &ELEPHANTS_PROFILE,
        UnitKind::ScythedChariots => &SCYTHED_CHARIOTS_PROFILE,
        UnitKind::Bow => &BOW_PROFILE,
        UnitKind::Slinger => &SLINGER_PROFILE,
        UnitKind::Psiloi => &PSILOI_PROFILE,
        UnitKind::Artillery => &ARTILLERY_PROFILE,
        UnitKind::Leader => &CAVALRY_PROFILE,
    }
}

pub fn rules_metadata() -> RulesMetadata {
    let unit_kinds = all_unit_kinds();
    RulesMetadata {
        unit_kinds: unit_kinds.iter().map(ToString::to_string).collect(),
        unit_profiles: unit_kinds
            .iter()
            .map(UnitProfileMetadata::from_kind)
            .collect(),
        unit_defaults: unit_kinds
            .iter()
            .flat_map(|kind| {
                [false, true]
                    .into_iter()
                    .map(move |leader| UnitDefaultMetadata::from_kind(kind, leader))
            })
            .collect(),
    }
}

pub(crate) fn all_unit_kinds() -> [UnitKind; 18] {
    [
        UnitKind::Spear,
        UnitKind::Pike,
        UnitKind::GuardPike,
        UnitKind::Blade,
        UnitKind::Warband,
        UnitKind::Auxilia,
        UnitKind::Horde,
        UnitKind::Cavalry,
        UnitKind::LightHorse,
        UnitKind::BowCavalry,
        UnitKind::Knights,
        UnitKind::Elephants,
        UnitKind::ScythedChariots,
        UnitKind::Bow,
        UnitKind::Slinger,
        UnitKind::Psiloi,
        UnitKind::Artillery,
        UnitKind::Leader,
    ]
}

impl UnitProfileMetadata {
    fn from_kind(kind: &UnitKind) -> Self {
        let profile = unit_profile(kind);
        Self {
            kind: kind.to_string(),
            movement: profile.movement,
            march_bonus: profile.march_bonus,
            close_vs_foot: profile.close_vs_foot,
            close_vs_mounted: profile.close_vs_mounted,
            missile_range: profile.missile_range,
            missile_strength: profile.missile_strength,
            missile_defense: profile.missile_defense,
            support_eligible: profile.support_eligible,
            pursuit_eligible: profile.pursuit_eligible,
            pursuit_distance: profile.pursuit_distance,
            mounted: profile.mounted,
            screen_height: profile.screen_height,
            short_name: profile.short_name,
            pass_through: profile
                .interpenetrates_friends
                .iter()
                .map(ToString::to_string)
                .collect(),
        }
    }
}

impl UnitDefaultMetadata {
    fn from_kind(kind: &UnitKind, leader: bool) -> Self {
        let unit_class = unit_class_for_kind(kind, leader);
        Self {
            kind: kind.to_string(),
            leader,
            formation_class: formation_class_for_kind(kind).to_string(),
            quality: quality_for_kind(kind, leader).to_string(),
            can_evade: can_evade_for_kind(kind),
            unit_class: unit_class.to_string(),
            pursuit_class: pursuit_class_for_kind(kind, leader).to_string(),
            morale_value: morale_value_for_kind(kind, leader),
            formation_state: formation_state_for_kind(&unit_class, false).to_string(),
            default_name: default_unit_name(kind, "UNIT-1"),
        }
    }
}

pub(crate) fn is_mounted(kind: &UnitKind) -> bool {
    unit_profile(kind).mounted
}

pub(crate) fn profile_supports_interpenetration(mover: &UnitKind, occupant: &UnitKind) -> bool {
    unit_profile(mover)
        .interpenetrates_friends
        .contains(occupant)
}
