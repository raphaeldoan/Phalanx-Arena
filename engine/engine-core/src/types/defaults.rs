use super::*;

pub fn default_ai_input_mode() -> AiInputMode {
    AiInputMode::TextOnly
}

pub fn default_true() -> bool {
    true
}

pub fn formation_class_for_kind(kind: &UnitKind) -> FormationClass {
    match kind {
        UnitKind::Auxilia
        | UnitKind::Bow
        | UnitKind::Slinger
        | UnitKind::Psiloi
        | UnitKind::LightHorse
        | UnitKind::BowCavalry => FormationClass::OpenOrder,
        _ => FormationClass::CloseOrder,
    }
}

pub fn quality_for_kind(_kind: &UnitKind, leader: bool) -> UnitQuality {
    if leader {
        UnitQuality::Superior
    } else {
        UnitQuality::Ordinary
    }
}

pub fn can_evade_for_kind(kind: &UnitKind) -> bool {
    matches!(
        kind,
        UnitKind::Bow
            | UnitKind::Slinger
            | UnitKind::Psiloi
            | UnitKind::LightHorse
            | UnitKind::BowCavalry
    )
}

pub fn default_unit_name(kind: &UnitKind, unit_id: &str) -> String {
    let flavor = match kind {
        UnitKind::Spear => "Thureophoroi",
        UnitKind::Pike => "Phalangites",
        UnitKind::GuardPike => "Guard Phalangites",
        UnitKind::Blade => "Imitation Legionaries",
        UnitKind::Warband => "Gallic Mercenaries",
        UnitKind::Auxilia => "Thorakitai",
        UnitKind::Horde => "Gallic Levies",
        UnitKind::Cavalry => "Companion Cavalry",
        UnitKind::LightHorse => "Tarantine Horse",
        UnitKind::BowCavalry => "Parthian Horse Archers",
        UnitKind::Knights => "Cataphracts",
        UnitKind::Elephants => "War Elephants",
        UnitKind::ScythedChariots => "Scythed Chariots",
        UnitKind::Bow => "Cretan Archers",
        UnitKind::Slinger => "Slingers",
        UnitKind::Psiloi => "Psiloi",
        UnitKind::Artillery => "Ballista",
        UnitKind::Leader => "General",
    };
    match infer_unit_ordinal(unit_id) {
        Some(ordinal) => format!("{flavor} {ordinal}"),
        None => flavor.to_string(),
    }
}

pub fn unit_class_for_kind(kind: &UnitKind, leader: bool) -> UnitClass {
    if leader || matches!(kind, UnitKind::Leader) {
        return UnitClass::Leader;
    }
    match kind {
        UnitKind::Psiloi | UnitKind::Slinger | UnitKind::Bow => UnitClass::Light,
        UnitKind::LightHorse | UnitKind::BowCavalry | UnitKind::Cavalry | UnitKind::Knights => {
            UnitClass::Cavalry
        }
        UnitKind::Pike | UnitKind::GuardPike => UnitClass::Pike,
        UnitKind::Elephants => UnitClass::Elephant,
        UnitKind::ScythedChariots => UnitClass::Chariot,
        UnitKind::Leader => UnitClass::Leader,
        _ => UnitClass::Formed,
    }
}

pub fn pursuit_class_for_kind(kind: &UnitKind, leader: bool) -> PursuitClass {
    if leader || matches!(kind, UnitKind::Leader) {
        return PursuitClass::None;
    }
    match kind {
        UnitKind::Cavalry | UnitKind::LightHorse | UnitKind::BowCavalry => PursuitClass::Normal,
        UnitKind::Knights | UnitKind::Elephants | UnitKind::ScythedChariots => {
            PursuitClass::Impetuous
        }
        _ => PursuitClass::None,
    }
}

pub fn morale_value_for_kind(kind: &UnitKind, leader: bool) -> i32 {
    if leader || matches!(kind, UnitKind::Leader) {
        return 8;
    }
    match kind {
        UnitKind::Psiloi | UnitKind::Slinger | UnitKind::Bow => 1,
        UnitKind::BowCavalry | UnitKind::LightHorse => 2,
        UnitKind::Spear | UnitKind::Blade | UnitKind::Cavalry => 3,
        UnitKind::Pike | UnitKind::Knights => 4,
        UnitKind::GuardPike => 6,
        UnitKind::Elephants => 5,
        UnitKind::ScythedChariots | UnitKind::Artillery => 2,
        UnitKind::Warband | UnitKind::Auxilia | UnitKind::Horde => 2,
        UnitKind::Leader => 8,
    }
}

pub fn formation_state_for_kind(unit_class: &UnitClass, disordered: bool) -> FormationState {
    if unit_class == &UnitClass::Pike {
        if disordered {
            FormationState::DisorderedPike
        } else {
            FormationState::OrderedPike
        }
    } else {
        FormationState::Normal
    }
}

pub fn infer_unit_ordinal(unit_id: &str) -> Option<String> {
    let digits: String = unit_id
        .chars()
        .rev()
        .take_while(|character| character.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        return None;
    }
    let value: usize = digits.chars().rev().collect::<String>().parse().ok()?;
    if value < 1 {
        return None;
    }
    Some(to_roman_numeral(value))
}

pub fn to_roman_numeral(value: usize) -> String {
    let numerals = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut remainder = value;
    let mut result = String::new();
    for (threshold, numeral) in numerals {
        while remainder >= threshold {
            result.push_str(numeral);
            remainder -= threshold;
        }
    }
    result
}
