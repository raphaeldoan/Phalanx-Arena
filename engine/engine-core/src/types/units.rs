use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnitKind {
    Spear,
    Pike,
    GuardPike,
    Blade,
    Warband,
    Auxilia,
    Horde,
    Cavalry,
    LightHorse,
    BowCavalry,
    Knights,
    Elephants,
    ScythedChariots,
    Bow,
    Slinger,
    Psiloi,
    Artillery,
    Leader,
}

impl Display for UnitKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Spear => "spear",
            Self::Pike => "pike",
            Self::GuardPike => "guard_pike",
            Self::Blade => "blade",
            Self::Warband => "warband",
            Self::Auxilia => "auxilia",
            Self::Horde => "horde",
            Self::Cavalry => "cavalry",
            Self::LightHorse => "light_horse",
            Self::BowCavalry => "bow_cavalry",
            Self::Knights => "knights",
            Self::Elephants => "elephants",
            Self::ScythedChariots => "scythed_chariots",
            Self::Bow => "bow",
            Self::Slinger => "slinger",
            Self::Psiloi => "psiloi",
            Self::Artillery => "artillery",
            Self::Leader => "leader",
        })
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum FormationState {
    #[default]
    Normal,
    OrderedPike,
    DisorderedPike,
    Rout,
    Panic,
    Overpursuit,
}

impl Display for FormationState {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Normal => "Normal",
            Self::OrderedPike => "OrderedPike",
            Self::DisorderedPike => "DisorderedPike",
            Self::Rout => "Rout",
            Self::Panic => "Panic",
            Self::Overpursuit => "Overpursuit",
        })
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum UnitClass {
    Light,
    #[default]
    Formed,
    Pike,
    Cavalry,
    Elephant,
    Chariot,
    Leader,
}

impl Display for UnitClass {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Light => "Light",
            Self::Formed => "Formed",
            Self::Pike => "Pike",
            Self::Cavalry => "Cavalry",
            Self::Elephant => "Elephant",
            Self::Chariot => "Chariot",
            Self::Leader => "Leader",
        })
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum PursuitClass {
    #[default]
    None,
    Normal,
    Impetuous,
}

impl Display for PursuitClass {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::None => "None",
            Self::Normal => "Normal",
            Self::Impetuous => "Impetuous",
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FormationClass {
    OpenOrder,
    CloseOrder,
}

impl Display for FormationClass {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::OpenOrder => "open_order",
            Self::CloseOrder => "close_order",
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnitQuality {
    Inferior,
    Ordinary,
    Superior,
}

impl Display for UnitQuality {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Inferior => "inferior",
            Self::Ordinary => "ordinary",
            Self::Superior => "superior",
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]

pub struct Unit {
    pub id: String,
    pub army: ArmyId,
    pub name: String,
    pub kind: UnitKind,
    pub position: Coord,
    pub facing: Direction,
    pub leader: bool,
    pub formation_class: FormationClass,
    pub quality: UnitQuality,
    pub in_command: bool,
    pub disordered: bool,
    pub can_evade: bool,
    pub activated_this_bound: bool,
    #[serde(default)]
    pub charging: bool,
    pub eliminated: bool,
    #[serde(default)]
    pub unit_class: UnitClass,
    #[serde(default)]
    pub formation_state: FormationState,
    #[serde(default)]
    pub pursuit_class: PursuitClass,
    #[serde(default)]
    pub morale_value: i32,
    #[serde(default)]
    pub has_routed_before: bool,
    #[serde(default)]
    pub overpursuit_turns_remaining: i32,
    #[serde(default)]
    pub panic_turns_remaining: i32,
    #[serde(default)]
    pub army_general: bool,
    #[serde(default = "default_true")]
    pub deployed: bool,
    #[serde(default)]
    pub off_map: bool,
}
