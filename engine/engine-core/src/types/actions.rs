use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    Deploy {
        unit_id: String,
        destination: Coord,
    },
    Move {
        unit_id: String,
        destination: Coord,
        path: Vec<Coord>,
        facing: Direction,
    },
    MarchMove {
        unit_id: String,
        destination: Coord,
        path: Vec<Coord>,
        facing: Direction,
    },
    Charge {
        unit_id: String,
        target_id: String,
        destination: Coord,
        path: Vec<Coord>,
        facing: Direction,
    },
    GroupMove {
        unit_ids: Vec<String>,
        steps: Vec<GroupMoveStep>,
    },
    GroupMarchMove {
        unit_ids: Vec<String>,
        steps: Vec<GroupMoveStep>,
    },
    GroupCharge {
        unit_ids: Vec<String>,
        steps: Vec<GroupChargeStep>,
    },
    Rotate {
        unit_id: String,
        facing: Direction,
    },
    Shoot {
        unit_id: String,
        target_id: String,
    },
    Rally {
        unit_id: String,
    },
    ReformPike {
        unit_id: String,
    },
    FinalizeDeployment,
    EndBound,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct GroupMoveStep {
    pub unit_id: String,
    pub destination: Coord,
    pub path: Vec<Coord>,
    pub facing: Direction,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct GroupChargeStep {
    pub unit_id: String,
    pub target_id: String,
    pub destination: Coord,
    pub path: Vec<Coord>,
    pub facing: Direction,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LegalAction {
    Deploy {
        unit_id: String,
        destination: Coord,
    },
    Move {
        unit_id: String,
        destination: Coord,
        path: Vec<Coord>,
        facing: Direction,
        pip_cost: i32,
    },
    MarchMove {
        unit_id: String,
        destination: Coord,
        path: Vec<Coord>,
        facing: Direction,
        pip_cost: i32,
    },
    Charge {
        unit_id: String,
        target_id: String,
        destination: Coord,
        path: Vec<Coord>,
        facing: Direction,
        aspect: String,
        pip_cost: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        warning: Option<String>,
    },
    GroupMove {
        unit_ids: Vec<String>,
        steps: Vec<GroupMoveStep>,
        pip_cost: i32,
    },
    GroupMarchMove {
        unit_ids: Vec<String>,
        steps: Vec<GroupMoveStep>,
        pip_cost: i32,
    },
    GroupCharge {
        unit_ids: Vec<String>,
        steps: Vec<GroupChargeStep>,
        pip_cost: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        warning: Option<String>,
    },
    Rotate {
        unit_id: String,
        facing: Direction,
        pip_cost: i32,
    },
    Shoot {
        unit_id: String,
        target_id: String,
        range: i32,
        pip_cost: i32,
    },
    Rally {
        unit_id: String,
        pip_cost: i32,
    },
    ReformPike {
        unit_id: String,
        pip_cost: i32,
    },
    FinalizeDeployment,
    EndBound,
}
