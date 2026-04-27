export type ArmyId = 'A' | 'B'

export type Direction = 'N' | 'E' | 'S' | 'W'
export type GamePhase = 'deployment' | 'battle'
export type AiInputMode = 'text_only'

export type UnitKind =
  | 'spear'
  | 'pike'
  | 'guard_pike'
  | 'blade'
  | 'warband'
  | 'auxilia'
  | 'horde'
  | 'cavalry'
  | 'light_horse'
  | 'bow_cavalry'
  | 'knights'
  | 'elephants'
  | 'scythed_chariots'
  | 'bow'
  | 'slinger'
  | 'psiloi'
  | 'artillery'
  | 'leader'

export type FormationClass = 'open_order' | 'close_order'
export type UnitQuality = 'inferior' | 'ordinary' | 'superior'
export type FormationState = 'Normal' | 'OrderedPike' | 'DisorderedPike' | 'Rout' | 'Panic' | 'Overpursuit'
export type UnitClass = 'Light' | 'Formed' | 'Pike' | 'Cavalry' | 'Elephant' | 'Chariot' | 'Leader'
export type PursuitClass = 'None' | 'Normal' | 'Impetuous'

export type TerrainType = 'open' | 'forest' | 'hill' | 'water' | 'road'

export interface Coord {
  x: number
  y: number
}

export interface TerrainTile {
  position: Coord
  terrain: TerrainType
}

export interface DeploymentZone {
  army: ArmyId
  min_x: number
  max_x: number
  min_y: number
  max_y: number
}

export interface Unit {
  id: string
  army: ArmyId
  name: string
  kind: UnitKind
  position: Coord
  facing: Direction
  leader: boolean
  formation_class: FormationClass
  quality: UnitQuality
  in_command: boolean
  disordered: boolean
  can_evade: boolean
  activated_this_bound: boolean
  charging: boolean
  eliminated: boolean
  unit_class: UnitClass
  formation_state: FormationState
  pursuit_class: PursuitClass
  morale_value: number
  has_routed_before: boolean
  overpursuit_turns_remaining: number
  panic_turns_remaining: number
  army_general: boolean
  deployed: boolean
  off_map: boolean
}

export interface LogEntry {
  step: number
  message: string
}

export interface AttritionStatus {
  army: ArmyId
  starting_units: number
  losses: number
  target_losses: number
}

export interface BattleScore {
  army: ArmyId
  enemy_losses: number
  total: number
}

export interface Army {
  id: ArmyId
  pips: number
  morale_loss: number
  morale_threshold: number
  shaken: boolean
  broken: boolean
}

export interface CombatResolution {
  kind: 'close_combat' | 'missile'
  attacker_id: string
  attacker_name: string
  attacker_position: Coord
  defender_id: string
  defender_name: string
  defender_position: Coord
  attacker_score: number
  attacker_roll: number
  attacker_total: number
  defender_score: number
  defender_roll: number
  defender_total: number
  attacker_notes: string[]
  defender_notes: string[]
  aspect: string | null
  range: number | null
  differential: number
  outcome: string
  winner_id: string | null
  loser_id: string | null
}

export interface PendingShot {
  unit_id: string
  target_id: string
}

export interface GameState {
  game_id: string
  engine_name: string
  engine_version: string
  design_basis: string
  scenario_id: string
  scenario_name: string
  board_width: number
  board_height: number
  phase: GamePhase
  bound_number: number
  current_player: ArmyId
  pips_remaining: number
  last_pip_roll: number
  seed: number
  roll_index: number
  winner: ArmyId | null
  draw: boolean
  terrain: TerrainTile[]
  deployment_zones: DeploymentZone[]
  deployment_ready: ArmyId[]
  attrition_status: AttritionStatus[]
  battle_scores: BattleScore[]
  armies: Army[]
  victory_target: number
  units: Unit[]
  log: LogEntry[]
  recent_resolutions: CombatResolution[]
  pending_shots?: PendingShot[]
  endgame_deadline_bound: number | null
  winner_reason: string | null
  use_endgame_clock: boolean
}

export interface DeployAction {
  type: 'deploy'
  unit_id: string
  destination: Coord
}

export interface MoveAction {
  type: 'move'
  unit_id: string
  destination: Coord
  path: Coord[]
  facing: Direction
}

export interface MarchMoveAction {
  type: 'march_move'
  unit_id: string
  destination: Coord
  path: Coord[]
  facing: Direction
}

export interface ChargeAction {
  type: 'charge'
  unit_id: string
  target_id: string
  destination: Coord
  path: Coord[]
  facing: Direction
}

export interface GroupMoveStep {
  unit_id: string
  destination: Coord
  path: Coord[]
  facing: Direction
}

export interface GroupChargeStep {
  unit_id: string
  target_id: string
  destination: Coord
  path: Coord[]
  facing: Direction
}

export interface GroupMoveAction {
  type: 'group_move'
  unit_ids: string[]
  steps: GroupMoveStep[]
}

export interface GroupMarchMoveAction {
  type: 'group_march_move'
  unit_ids: string[]
  steps: GroupMoveStep[]
}

export interface GroupChargeAction {
  type: 'group_charge'
  unit_ids: string[]
  steps: GroupChargeStep[]
}

export interface RotateAction {
  type: 'rotate'
  unit_id: string
  facing: Direction
}

export interface ShootAction {
  type: 'shoot'
  unit_id: string
  target_id: string
}

export interface RallyAction {
  type: 'rally'
  unit_id: string
}

export interface ReformPikeAction {
  type: 'reform_pike'
  unit_id: string
}

export interface FinalizeDeploymentAction {
  type: 'finalize_deployment'
}

export interface EndBoundAction {
  type: 'end_bound'
}

export type Action =
  | DeployAction
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
  | EndBoundAction

export interface DeployActionOption {
  type: 'deploy'
  unit_id: string
  destination: Coord
}

export interface MoveActionOption {
  type: 'move'
  unit_id: string
  destination: Coord
  path: Coord[]
  facing: Direction
  pip_cost: number
}

export interface MarchMoveActionOption {
  type: 'march_move'
  unit_id: string
  destination: Coord
  path: Coord[]
  facing: Direction
  pip_cost: number
}

export interface ChargeActionOption {
  type: 'charge'
  unit_id: string
  target_id: string
  destination: Coord
  path: Coord[]
  facing: Direction
  aspect: string
  pip_cost: number
  warning?: string
}

export interface GroupMoveActionOption {
  type: 'group_move'
  unit_ids: string[]
  steps: GroupMoveStep[]
  pip_cost: number
}

export interface GroupMarchMoveActionOption {
  type: 'group_march_move'
  unit_ids: string[]
  steps: GroupMoveStep[]
  pip_cost: number
}

export interface GroupChargeActionOption {
  type: 'group_charge'
  unit_ids: string[]
  steps: GroupChargeStep[]
  pip_cost: number
  warning?: string
}

export interface RotateActionOption {
  type: 'rotate'
  unit_id: string
  facing: Direction
  pip_cost: number
}

export interface ShootActionOption {
  type: 'shoot'
  unit_id: string
  target_id: string
  range: number
  pip_cost: number
}

export interface RallyActionOption {
  type: 'rally'
  unit_id: string
  pip_cost: number
}

export interface ReformPikeActionOption {
  type: 'reform_pike'
  unit_id: string
  pip_cost: number
}

export interface FinalizeDeploymentActionOption {
  type: 'finalize_deployment'
}

export interface EndBoundActionOption {
  type: 'end_bound'
}

export type LegalAction =
  | DeployActionOption
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
  | EndBoundActionOption

export interface CreateGameRequest {
  deployment_first_army?: ArmyId
  first_bound_army?: ArmyId
  scenario_id: string
  seed: number
}

export interface ScenarioSummary {
  scenario_id: string
  name: string
  description: string
  board_width: number
  board_height: number
}

export interface GameSnapshot {
  state: GameState
  legal_actions: LegalAction[]
  can_undo: boolean
}

export interface ReplayData {
  scenario_id: string
  seed: number
  deployment_first_army?: ArmyId
  first_bound_army?: ArmyId
  actions: Action[]
  intent_updates?: AiIntentUpdate[]
}

export interface AiIntentUpdate {
  army: ArmyId
  bound_number: number
  action_number: number
  intent: string
}

export interface AiTurnRequest {
  army: ArmyId
  input_mode?: AiInputMode
  include_rationale?: boolean
  model?: string | null
  provider?: string | null
  current_intent?: string
  can_update_intent?: boolean
  deployment_batch?: boolean
  battle_batch?: boolean
}

export interface AiUsage {
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  cached_input_tokens: number | null
  reasoning_tokens: number | null
  input_cost_usd: number | null
  output_cost_usd: number | null
  total_cost_usd: number | null
  pricing_model: string | null
  estimated: boolean
}

export interface AiTurnResponse {
  snapshot: GameSnapshot
  applied_action: Action
  applied_action_index: number
  applied_action_summary: string
  input_mode_used: AiInputMode
  prompt_text: string
  reasoning: string
  visual_observations: string
  confidence: number
  model: string
  usage: AiUsage | null
  intent_update?: string | null
}
