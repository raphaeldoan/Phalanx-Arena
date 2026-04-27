from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, Field


class ArmyId(StrEnum):
    A = "A"
    B = "B"


class Direction(StrEnum):
    N = "N"
    E = "E"
    S = "S"
    W = "W"


class UnitKind(StrEnum):
    SPEAR = "spear"
    PIKE = "pike"
    GUARD_PIKE = "guard_pike"
    BLADE = "blade"
    WARBAND = "warband"
    AUXILIA = "auxilia"
    HORDE = "horde"
    CAVALRY = "cavalry"
    LIGHT_HORSE = "light_horse"
    BOW_CAVALRY = "bow_cavalry"
    KNIGHTS = "knights"
    ELEPHANTS = "elephants"
    SCYTHED_CHARIOTS = "scythed_chariots"
    BOW = "bow"
    SLINGER = "slinger"
    PSILOI = "psiloi"
    ARTILLERY = "artillery"
    LEADER = "leader"


class FormationClass(StrEnum):
    OPEN_ORDER = "open_order"
    CLOSE_ORDER = "close_order"


class UnitQuality(StrEnum):
    INFERIOR = "inferior"
    ORDINARY = "ordinary"
    SUPERIOR = "superior"


class FormationState(StrEnum):
    NORMAL = "Normal"
    ORDERED_PIKE = "OrderedPike"
    DISORDERED_PIKE = "DisorderedPike"
    ROUT = "Rout"
    PANIC = "Panic"
    OVERPURSUIT = "Overpursuit"


class UnitClass(StrEnum):
    LIGHT = "Light"
    FORMED = "Formed"
    PIKE = "Pike"
    CAVALRY = "Cavalry"
    ELEPHANT = "Elephant"
    CHARIOT = "Chariot"
    LEADER = "Leader"


class PursuitClass(StrEnum):
    NONE = "None"
    NORMAL = "Normal"
    IMPETUOUS = "Impetuous"


class TerrainType(StrEnum):
    OPEN = "open"
    FOREST = "forest"
    HILL = "hill"
    WATER = "water"
    ROAD = "road"


class GamePhase(StrEnum):
    DEPLOYMENT = "deployment"
    BATTLE = "battle"


class AiInputMode(StrEnum):
    TEXT_ONLY = "text_only"


class Coord(BaseModel):
    x: int
    y: int


class TerrainTile(BaseModel):
    position: Coord
    terrain: TerrainType


class DeploymentZone(BaseModel):
    army: ArmyId
    min_x: int
    max_x: int
    min_y: int
    max_y: int


class Unit(BaseModel):
    id: str
    army: ArmyId
    name: str
    kind: UnitKind
    position: Coord
    facing: Direction
    leader: bool = False
    formation_class: FormationClass = FormationClass.CLOSE_ORDER
    quality: UnitQuality = UnitQuality.ORDINARY
    in_command: bool = True
    disordered: bool = False
    can_evade: bool = False
    activated_this_bound: bool = False
    charging: bool = False
    eliminated: bool = False
    unit_class: UnitClass = UnitClass.FORMED
    formation_state: FormationState = FormationState.NORMAL
    pursuit_class: PursuitClass = PursuitClass.NONE
    morale_value: int = 0
    has_routed_before: bool = False
    overpursuit_turns_remaining: int = 0
    panic_turns_remaining: int = 0
    army_general: bool = False
    deployed: bool = True
    off_map: bool = False


class LogEntry(BaseModel):
    step: int
    message: str


class AttritionStatus(BaseModel):
    army: ArmyId
    starting_units: int
    losses: int = 0
    target_losses: int


class BattleScore(BaseModel):
    army: ArmyId
    enemy_losses: int = 0
    total: int = 0


class Army(BaseModel):
    id: ArmyId
    pips: int = 0
    morale_loss: int = 0
    morale_threshold: int = 0
    shaken: bool = False
    broken: bool = False


class CombatResolution(BaseModel):
    kind: Literal["close_combat", "missile"]
    attacker_id: str
    attacker_name: str
    attacker_position: Coord
    defender_id: str
    defender_name: str
    defender_position: Coord
    attacker_score: int
    attacker_roll: int
    attacker_total: int
    defender_score: int
    defender_roll: int
    defender_total: int
    attacker_notes: list[str] = Field(default_factory=list)
    defender_notes: list[str] = Field(default_factory=list)
    aspect: str | None = None
    range: int | None = None
    differential: int
    outcome: str
    winner_id: str | None = None
    loser_id: str | None = None


class PendingShot(BaseModel):
    unit_id: str
    target_id: str


class GameState(BaseModel):
    game_id: str
    engine_name: str
    engine_version: str
    design_basis: str
    scenario_id: str
    scenario_name: str
    board_width: int
    board_height: int
    phase: GamePhase
    bound_number: int
    current_player: ArmyId
    deployment_first_army: ArmyId = ArmyId.A
    first_bound_army: ArmyId = ArmyId.A
    pips_remaining: int
    last_pip_roll: int
    seed: int
    roll_index: int
    winner: ArmyId | None = None
    draw: bool = False
    terrain: list[TerrainTile] = Field(default_factory=list)
    deployment_zones: list[DeploymentZone] = Field(default_factory=list)
    deployment_ready: list[ArmyId] = Field(default_factory=list)
    attrition_status: list[AttritionStatus] = Field(default_factory=list)
    battle_scores: list[BattleScore] = Field(default_factory=list)
    armies: list[Army] = Field(default_factory=list)
    victory_target: int = 0
    units: list[Unit]
    log: list[LogEntry] = Field(default_factory=list)
    recent_resolutions: list[CombatResolution] = Field(default_factory=list)
    pending_shots: list[PendingShot] = Field(default_factory=list)
    endgame_deadline_bound: int | None = None
    winner_reason: str | None = None
    use_endgame_clock: bool = False


class DeployAction(BaseModel):
    type: Literal["deploy"]
    unit_id: str
    destination: Coord


class MoveAction(BaseModel):
    type: Literal["move"]
    unit_id: str
    destination: Coord
    path: list[Coord]
    facing: Direction


class MarchMoveAction(BaseModel):
    type: Literal["march_move"]
    unit_id: str
    destination: Coord
    path: list[Coord]
    facing: Direction


class ChargeAction(BaseModel):
    type: Literal["charge"]
    unit_id: str
    target_id: str
    destination: Coord
    path: list[Coord]
    facing: Direction


class GroupMoveStep(BaseModel):
    unit_id: str
    destination: Coord
    path: list[Coord]
    facing: Direction


class GroupChargeStep(BaseModel):
    unit_id: str
    target_id: str
    destination: Coord
    path: list[Coord]
    facing: Direction


class GroupMoveAction(BaseModel):
    type: Literal["group_move"]
    unit_ids: list[str]
    steps: list[GroupMoveStep]


class GroupMarchMoveAction(BaseModel):
    type: Literal["group_march_move"]
    unit_ids: list[str]
    steps: list[GroupMoveStep]


class GroupChargeAction(BaseModel):
    type: Literal["group_charge"]
    unit_ids: list[str]
    steps: list[GroupChargeStep]


class RotateAction(BaseModel):
    type: Literal["rotate"]
    unit_id: str
    facing: Direction


class ShootAction(BaseModel):
    type: Literal["shoot"]
    unit_id: str
    target_id: str


class RallyAction(BaseModel):
    type: Literal["rally"]
    unit_id: str


class ReformPikeAction(BaseModel):
    type: Literal["reform_pike"]
    unit_id: str


class FinalizeDeploymentAction(BaseModel):
    type: Literal["finalize_deployment"]


class EndBoundAction(BaseModel):
    type: Literal["end_bound"]


Action = Annotated[
    DeployAction
    | MoveAction
    | MarchMoveAction
    | ChargeAction
    | GroupMoveAction
    | GroupMarchMoveAction
    | GroupChargeAction
    | RotateAction
    | ShootAction
    | RallyAction
    | ReformPikeAction
    | FinalizeDeploymentAction
    | EndBoundAction,
    Field(discriminator="type"),
]


class DeployActionOption(BaseModel):
    type: Literal["deploy"] = "deploy"
    unit_id: str
    destination: Coord


class MoveActionOption(BaseModel):
    type: Literal["move"] = "move"
    unit_id: str
    destination: Coord
    path: list[Coord]
    facing: Direction
    pip_cost: int = 1


class MarchMoveActionOption(BaseModel):
    type: Literal["march_move"] = "march_move"
    unit_id: str
    destination: Coord
    path: list[Coord]
    facing: Direction
    pip_cost: int = 1


class ChargeActionOption(BaseModel):
    type: Literal["charge"] = "charge"
    unit_id: str
    target_id: str
    destination: Coord
    path: list[Coord]
    facing: Direction
    aspect: str
    pip_cost: int = 1
    warning: str | None = None


class GroupMoveActionOption(BaseModel):
    type: Literal["group_move"] = "group_move"
    unit_ids: list[str]
    steps: list[GroupMoveStep]
    pip_cost: int = 1


class GroupMarchMoveActionOption(BaseModel):
    type: Literal["group_march_move"] = "group_march_move"
    unit_ids: list[str]
    steps: list[GroupMoveStep]
    pip_cost: int = 1


class GroupChargeActionOption(BaseModel):
    type: Literal["group_charge"] = "group_charge"
    unit_ids: list[str]
    steps: list[GroupChargeStep]
    pip_cost: int = 1
    warning: str | None = None


class RotateActionOption(BaseModel):
    type: Literal["rotate"] = "rotate"
    unit_id: str
    facing: Direction
    pip_cost: int = 1


class ShootActionOption(BaseModel):
    type: Literal["shoot"] = "shoot"
    unit_id: str
    target_id: str
    range: int
    pip_cost: int = 1


class RallyActionOption(BaseModel):
    type: Literal["rally"] = "rally"
    unit_id: str
    pip_cost: int = 1


class ReformPikeActionOption(BaseModel):
    type: Literal["reform_pike"] = "reform_pike"
    unit_id: str
    pip_cost: int = 1


class FinalizeDeploymentActionOption(BaseModel):
    type: Literal["finalize_deployment"] = "finalize_deployment"


class EndBoundActionOption(BaseModel):
    type: Literal["end_bound"] = "end_bound"


LegalAction = Annotated[
    DeployActionOption
    | MoveActionOption
    | MarchMoveActionOption
    | ChargeActionOption
    | GroupMoveActionOption
    | GroupMarchMoveActionOption
    | GroupChargeActionOption
    | RotateActionOption
    | ShootActionOption
    | RallyActionOption
    | ReformPikeActionOption
    | FinalizeDeploymentActionOption
    | EndBoundActionOption,
    Field(discriminator="type"),
]


class ScenarioSummary(BaseModel):
    scenario_id: str
    name: str
    description: str
    board_width: int
    board_height: int


class CreateGameRequest(BaseModel):
    scenario_id: str = "classic_battle"
    seed: int = 7
    deployment_first_army: ArmyId = ArmyId.A
    first_bound_army: ArmyId = ArmyId.A


class ReplayData(BaseModel):
    scenario_id: str
    seed: int
    deployment_first_army: ArmyId = ArmyId.A
    first_bound_army: ArmyId = ArmyId.A
    actions: list[Action] = Field(default_factory=list)
    intent_updates: list["AiIntentUpdate"] = Field(default_factory=list)


class AiIntentUpdate(BaseModel):
    army: ArmyId
    bound_number: int
    action_number: int
    intent: str


class GameSnapshot(BaseModel):
    state: GameState
    legal_actions: list[LegalAction]
    can_undo: bool = False


class AiTurnRequest(BaseModel):
    army: ArmyId
    input_mode: AiInputMode = AiInputMode.TEXT_ONLY
    include_rationale: bool = False
    model: str | None = None
    provider: str | None = None
    current_intent: str = ""
    can_update_intent: bool = False
    deployment_batch: bool = False
    battle_batch: bool = False


class ReplayAiTurnRequest(BaseModel):
    replay: ReplayData
    request: AiTurnRequest


class AiUsage(BaseModel):
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    cached_input_tokens: int | None = None
    reasoning_tokens: int | None = None
    input_cost_usd: float | None = None
    output_cost_usd: float | None = None
    total_cost_usd: float | None = None
    pricing_model: str | None = None
    estimated: bool = True


class AiTurnResponse(BaseModel):
    snapshot: GameSnapshot
    applied_action: Action
    applied_action_index: int
    applied_action_summary: str
    input_mode_used: AiInputMode
    prompt_text: str
    reasoning: str
    visual_observations: str
    confidence: float
    model: str
    usage: AiUsage | None = None
    intent_update: str | None = None


