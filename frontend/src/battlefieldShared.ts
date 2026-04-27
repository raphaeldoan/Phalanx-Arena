import type { CSSProperties } from 'react'
import type {
  Action,
  ArmyId,
  BattleScore,
  ChargeActionOption,
  CombatResolution,
  Coord,
  DeployActionOption,
  FormationClass,
  GameState,
  GroupChargeActionOption,
  GroupChargeStep,
  GroupMarchMoveActionOption,
  GroupMoveActionOption,
  GroupMoveStep,
  LegalAction,
  MarchMoveActionOption,
  MoveActionOption,
  RallyActionOption,
  ReformPikeActionOption,
  RotateActionOption,
  ShootActionOption,
  TerrainType,
  Unit,
  UnitKind,
  UnitQuality,
} from './types'

export type CameraPresetId = 'reset' | 'top' | 'isometric' | 'army_a' | 'army_b' | 'focus_selection' | 'focus_target'
export type AiController = 'off' | ArmyId | 'both'
export type GroupActionOption = GroupMoveActionOption | GroupMarchMoveActionOption | GroupChargeActionOption
export type GroupActionStep = GroupMoveStep | GroupChargeStep
export type GroupActionAnchor = {
  action: GroupActionOption
  step: GroupActionStep
  variant: 'move' | 'march' | 'charge'
}

export const UNIT_LABELS: Record<UnitKind, string> = {
  spear: 'Sp',
  pike: 'Pk',
  guard_pike: 'GPk',
  blade: 'Bd',
  warband: 'Wb',
  auxilia: 'Ax',
  horde: 'Hd',
  cavalry: 'Cv',
  light_horse: 'LH',
  bow_cavalry: 'BC',
  knights: 'Kn',
  elephants: 'El',
  scythed_chariots: 'SCh',
  bow: 'Bw',
  slinger: 'Sl',
  psiloi: 'Ps',
  artillery: 'Art',
  leader: 'Ldr',
}

export const UNIT_RULES_LABELS: Record<UnitKind, string> = {
  spear: 'Spear',
  pike: 'Pike',
  guard_pike: 'Guard Pike',
  blade: 'Blade',
  warband: 'Warband',
  auxilia: 'Auxilia',
  horde: 'Horde',
  cavalry: 'Cavalry',
  light_horse: 'Light Horse',
  bow_cavalry: 'Bow Cavalry',
  knights: 'Knights',
  elephants: 'Elephants',
  scythed_chariots: 'Scythed Chariots',
  bow: 'Bow',
  slinger: 'Slingers',
  psiloi: 'Psiloi',
  artillery: 'Artillery',
  leader: 'Leader',
}

export const UNIT_FLAVOUR_LABELS: Record<UnitKind, string> = {
  spear: 'Thureophoroi',
  pike: 'Phalangites',
  guard_pike: 'Guard Phalangites',
  blade: 'Imitation Legionaries',
  warband: 'Gallic Mercenaries',
  auxilia: 'Thorakitai',
  horde: 'Gallic Levies',
  cavalry: 'Companion Cavalry',
  light_horse: 'Tarantine Horse',
  bow_cavalry: 'Parthian Horse Archers',
  knights: 'Cataphracts',
  elephants: 'War Elephants',
  scythed_chariots: 'Scythed Chariots',
  bow: 'Cretan Archers',
  slinger: 'Slingers',
  psiloi: 'Psiloi',
  artillery: 'Ballista',
  leader: 'General',
}

export const TERRAIN_LABELS: Record<TerrainType, string> = {
  open: 'Open',
  forest: 'Forest',
  hill: 'Hill',
  water: 'Water',
  road: 'Road',
}

export const ARMY_DISPLAY_NAMES: Record<ArmyId, string> = {
  A: 'Antiochus',
  B: 'Ptolemy',
}

export function footprintCells(coord: Coord, facing: 'N' | 'E' | 'S' | 'W'): Coord[] {
  void facing
  return [coord]
}

export function keyForCoord(coord: Coord): string {
  return `${coord.x},${coord.y}`
}

export function footprintKeys(coord: Coord, facing: 'N' | 'E' | 'S' | 'W'): string[] {
  return footprintCells(coord, facing).map(keyForCoord)
}

export function tokenGridStyle(unit: Unit): CSSProperties {
  const isVertical = unit.facing === 'N' || unit.facing === 'S'
  return {
    gridColumn: `${unit.position.x + 1}`,
    gridRow: `${unit.position.y + 1}`,
    width: isVertical ? '100%' : '54%',
    height: isVertical ? '54%' : '100%',
    justifySelf: unit.facing === 'W' ? 'start' : unit.facing === 'E' ? 'end' : 'stretch',
    alignSelf: unit.facing === 'N' ? 'start' : unit.facing === 'S' ? 'end' : 'stretch',
  }
}

export function cellGridStyle(coord: Coord): CSSProperties {
  return {
    gridColumn: `${coord.x + 1}`,
    gridRow: `${coord.y + 1}`,
  }
}

export function overlayGridStyle(coord: Coord): CSSProperties {
  return {
    gridColumn: `${coord.x + 1}`,
    gridRow: `${coord.y + 1}`,
  }
}

export function isMoveAction(action: LegalAction): action is MoveActionOption {
  return action.type === 'move'
}

export function isChargeAction(action: LegalAction): action is ChargeActionOption {
  return action.type === 'charge'
}

export function isMarchAction(action: LegalAction): action is MarchMoveActionOption {
  return action.type === 'march_move'
}

export function isDeployAction(action: LegalAction): action is DeployActionOption {
  return action.type === 'deploy'
}

export function isGroupMoveAction(action: LegalAction): action is GroupMoveActionOption {
  return action.type === 'group_move'
}

export function isGroupMarchAction(action: LegalAction): action is GroupMarchMoveActionOption {
  return action.type === 'group_march_move'
}

export function isGroupChargeAction(action: LegalAction): action is GroupChargeActionOption {
  return action.type === 'group_charge'
}

export function isRotateAction(action: LegalAction): action is RotateActionOption {
  return action.type === 'rotate'
}

export function isShootAction(action: LegalAction): action is ShootActionOption {
  return action.type === 'shoot'
}

export function isRallyAction(action: LegalAction): action is RallyActionOption {
  return action.type === 'rally'
}

export function isReformPikeAction(action: LegalAction): action is ReformPikeActionOption {
  return action.type === 'reform_pike'
}

export function formatPath(path: Coord[]): string {
  return path.map((coord) => `(${coord.x}, ${coord.y})`).join(' -> ')
}

export function tokenFacingClass(unit: Unit): string {
  return `token--facing-${unit.facing.toLowerCase()}`
}

export function formatEnumLabel(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

export function formatFormationClass(value: FormationClass): string {
  return formatEnumLabel(value)
}

export function formatUnitQuality(value: UnitQuality): string {
  return formatEnumLabel(value)
}

export function formatFormationState(value: Unit['formation_state']): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2')
}

export function formatUnitClass(value: Unit['unit_class']): string {
  return value
}

export function formatPursuitClass(value: Unit['pursuit_class']): string {
  return value
}

export function formatUnitTypeLabel(kind: UnitKind): string {
  return UNIT_RULES_LABELS[kind]
}

export function formatUnitFlavourLabel(kind: UnitKind): string {
  return UNIT_FLAVOUR_LABELS[kind]
}

export function formatUnitDisplayLabel(kind: UnitKind): string {
  const flavourLabel = formatUnitFlavourLabel(kind)
  const typeLabel = formatUnitTypeLabel(kind)
  return flavourLabel === typeLabel ? typeLabel : `${flavourLabel} (${typeLabel})`
}

export function formatUnitDisplayLabelForUnit(unit: Pick<Unit, 'kind' | 'name'>): string {
  void unit
  return formatUnitDisplayLabel(unit.kind)
}

export function formatArmyDisplayName(army: ArmyId): string {
  return ARMY_DISPLAY_NAMES[army]
}

export function formatUnitName(unit: Pick<Unit, 'id' | 'kind' | 'name'>): string {
  const explicitName = unit.name.trim()
  if (explicitName) {
    return explicitName
  }

  const inferredOrdinal = inferUnitOrdinal(unit.id)
  return inferredOrdinal ? `${formatUnitFlavourLabel(unit.kind)} ${inferredOrdinal}` : formatUnitFlavourLabel(unit.kind)
}

export function formatPipCost(cost: number): string {
  return `${cost} PIP${cost === 1 ? '' : 's'}`
}

export function formatActionWarning(action: LegalAction): string | null {
  if ((action.type === 'charge' || action.type === 'group_charge') && action.warning) {
    return action.warning
  }
  return null
}

export function unitStatusLabels(unit: Unit): string[] {
  const labels: string[] = []
  if (!unit.deployed) {
    labels.push('Reserve')
  }
  if (unit.off_map) {
    labels.push('Off map')
  }
  if (unit.formation_state !== 'Normal') {
    labels.push(formatFormationState(unit.formation_state))
  }
  if (unit.disordered && unit.formation_state !== 'DisorderedPike' && unit.formation_state !== 'Panic' && unit.formation_state !== 'Rout') {
    labels.push('Disordered')
  }
  if (!unit.in_command) {
    labels.push('Out of command')
  }
  if (unit.activated_this_bound) {
    labels.push('Activated')
  }
  if (unit.charging) {
    labels.push('Charging')
  }
  if (unit.panic_turns_remaining > 0) {
    labels.push(`Panic ${unit.panic_turns_remaining}`)
  }
  if (unit.overpursuit_turns_remaining > 0) {
    labels.push(`Overpursuit ${unit.overpursuit_turns_remaining}`)
  }
  return labels
}

function inferUnitOrdinal(unitId: string): string | null {
  const ordinalText = unitId.match(/(\d+)$/)?.[1]
  if (!ordinalText) {
    return null
  }

  const ordinal = Number.parseInt(ordinalText, 10)
  if (!Number.isFinite(ordinal) || ordinal < 1) {
    return null
  }

  return toRomanNumeral(ordinal)
}

function toRomanNumeral(value: number): string {
  const numerals: Array<[number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ]

  let remainder = Math.trunc(value)
  let result = ''
  for (const [amount, symbol] of numerals) {
    while (remainder >= amount) {
      result += symbol
      remainder -= amount
    }
  }

  return result
}

export function describeBattleScore(score: BattleScore): string {
  return `${formatArmyDisplayName(score.army)}: enemy loss total ${score.total}`
}

export function describeBattleScores(state: GameState | null): string {
  if (!state) {
    return '-'
  }
  if (state.armies.length) {
    return state.armies.map(describeArmyMorale).join(' / ')
  }
  return state.battle_scores.map(describeBattleScore).join(' / ')
}

export function describeBattleTarget(state: GameState | null): string {
  if (!state) {
    return '-'
  }
  if (state.armies.length) {
    return state.armies.map((army) => `${formatArmyDisplayName(army.id)} ${army.morale_threshold}`).join(' / ')
  }
  return `${state.victory_target} legacy points`
}

export function describeArmyMorale(army: GameState['armies'][number]): string {
  const state = army.broken ? 'broken' : army.shaken ? 'shaken' : 'steady'
  return `${formatArmyDisplayName(army.id)} loss ${army.morale_loss}/${army.morale_threshold} (${state})`
}

export function isGameFinished(state: GameState | null | undefined): boolean {
  return Boolean(state?.winner) || Boolean(state?.draw)
}

export function controlsArmy(controller: AiController, army: ArmyId): boolean {
  return controller === 'both' || controller === army
}

export function describeAiController(controller: AiController): string {
  if (controller === 'off') {
    return 'Human hotseat only'
  }
  if (controller === 'both') {
    return 'AI controls both commanders'
  }
  return `AI controls ${formatArmyDisplayName(controller)}`
}

export function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function groupActionLabel(action: GroupActionOption): string {
  const warning = formatActionWarning(action)
  if (action.type === 'group_march_move') {
    return `Group march ${formatGroupStepDestinations(action.steps)} (${formatPipCost(action.pip_cost)})`
  }
  if (action.type === 'group_charge') {
    return `Group charge ${formatGroupChargeDestinations(action.steps)} (${formatPipCost(action.pip_cost)})${warning ? ` - ${warning}` : ''}`
  }
  return `Group move ${formatGroupStepDestinations(action.steps)} (${formatPipCost(action.pip_cost)})`
}

export function groupActionChipLabel(action: GroupActionOption): string {
  if (action.type === 'group_march_move') {
    return `G March (${formatPipCost(action.pip_cost)})`
  }
  if (action.type === 'group_charge') {
    return `G Charge (${formatPipCost(action.pip_cost)})`
  }
  return `G Move (${formatPipCost(action.pip_cost)})`
}

export function sameUnitSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  const other = new Set(b)
  return a.every((unitId) => other.has(unitId))
}

export function materializeAction(action: LegalAction): Action {
  if (action.type === 'group_move') {
    return {
      type: 'group_move',
      unit_ids: action.unit_ids,
      steps: action.steps,
    }
  }
  if (action.type === 'group_march_move') {
    return {
      type: 'group_march_move',
      unit_ids: action.unit_ids,
      steps: action.steps,
    }
  }
  if (action.type === 'group_charge') {
    return {
      type: 'group_charge',
      unit_ids: action.unit_ids,
      steps: action.steps,
    }
  }
  if (action.type === 'move') {
    return {
      type: 'move',
      unit_id: action.unit_id,
      destination: action.destination,
      path: action.path,
      facing: action.facing,
    }
  }
  if (action.type === 'march_move') {
    return {
      type: 'march_move',
      unit_id: action.unit_id,
      destination: action.destination,
      path: action.path,
      facing: action.facing,
    }
  }
  if (action.type === 'charge') {
    return {
      type: 'charge',
      unit_id: action.unit_id,
      target_id: action.target_id,
      destination: action.destination,
      path: action.path,
      facing: action.facing,
    }
  }
  if (action.type === 'rotate') {
    return {
      type: 'rotate',
      unit_id: action.unit_id,
      facing: action.facing,
    }
  }
  if (action.type === 'shoot') {
    return {
      type: 'shoot',
      unit_id: action.unit_id,
      target_id: action.target_id,
    }
  }
  if (action.type === 'rally') {
    return {
      type: 'rally',
      unit_id: action.unit_id,
    }
  }
  if (action.type === 'reform_pike') {
    return {
      type: 'reform_pike',
      unit_id: action.unit_id,
    }
  }
  if (action.type === 'deploy') {
    return {
      type: 'deploy',
      unit_id: action.unit_id,
      destination: action.destination,
    }
  }
  if (action.type === 'finalize_deployment') {
    return { type: 'finalize_deployment' }
  }
  return { type: 'end_bound' }
}

export function describeAction(action: LegalAction): string {
  if (action.type === 'deploy') {
    return `deploy ${action.unit_id} -> (${action.destination.x}, ${action.destination.y})`
  }
  if (action.type === 'move') {
    return `move ${action.unit_id} -> (${action.destination.x}, ${action.destination.y}) via ${formatPath(action.path)} facing ${action.facing} (${formatPipCost(action.pip_cost)})`
  }
  if (action.type === 'march_move') {
    return `march ${action.unit_id} -> (${action.destination.x}, ${action.destination.y}) via ${formatPath(action.path)} (${formatPipCost(action.pip_cost)})`
  }
  if (action.type === 'charge') {
    const warning = formatActionWarning(action)
    return `charge ${action.unit_id} -> ${action.target_id} from (${action.destination.x}, ${action.destination.y}) via ${formatPath(action.path)} [${action.aspect}] (${formatPipCost(action.pip_cost)})${warning ? ` - ${warning}` : ''}`
  }
  if (action.type === 'group_move') {
    return `group ${formatGroupStepDestinations(action.steps)} (${formatPipCost(action.pip_cost)})`
  }
  if (action.type === 'group_march_move') {
    return `group march ${formatGroupStepDestinations(action.steps)} (${formatPipCost(action.pip_cost)})`
  }
  if (action.type === 'group_charge') {
    const warning = formatActionWarning(action)
    return `group charge ${formatGroupChargeDestinations(action.steps)} (${formatPipCost(action.pip_cost)})${warning ? ` - ${warning}` : ''}`
  }
  if (action.type === 'rotate') {
    return `rotate ${action.unit_id} -> ${action.facing} (${formatPipCost(action.pip_cost)})`
  }
  if (action.type === 'shoot') {
    return `shoot ${action.unit_id} -> ${action.target_id} (${formatPipCost(action.pip_cost)})`
  }
  if (action.type === 'rally') {
    return `rally ${action.unit_id} (${formatPipCost(action.pip_cost)})`
  }
  if (action.type === 'reform_pike') {
    return `reform pike ${action.unit_id} (${formatPipCost(action.pip_cost)})`
  }
  if (action.type === 'finalize_deployment') {
    return 'finalize_deployment'
  }
  return 'end_bound'
}

function formatGroupStepDestinations(steps: Array<{ unit_id: string; destination: Coord }>): string {
  const shown = steps.slice(0, 5).map((step) => `${step.unit_id}->(${step.destination.x}, ${step.destination.y})`)
  if (steps.length > shown.length) {
    shown.push(`+${steps.length - shown.length}`)
  }
  return shown.join(', ')
}

function formatGroupChargeDestinations(
  steps: Array<{ unit_id: string; target_id: string; destination: Coord }>,
): string {
  const shown = steps
    .slice(0, 5)
    .map((step) => `${step.unit_id}->${step.target_id}@(${step.destination.x}, ${step.destination.y})`)
  if (steps.length > shown.length) {
    shown.push(`+${steps.length - shown.length}`)
  }
  return shown.join(', ')
}

type DirectControlCategory = 'single_unit' | 'group' | 'top_bar'

function directControlCategory(action: LegalAction): DirectControlCategory | null {
  if (
    action.type === 'deploy' ||
    action.type === 'move' ||
    action.type === 'march_move' ||
    action.type === 'charge' ||
    action.type === 'rotate' ||
    action.type === 'shoot' ||
    action.type === 'rally' ||
    action.type === 'reform_pike'
  ) {
    return 'single_unit'
  }
  if (action.type === 'group_move' || action.type === 'group_march_move' || action.type === 'group_charge') {
    return 'group'
  }
  if (action.type === 'finalize_deployment' || action.type === 'end_bound') {
    return 'top_bar'
  }
  return null
}

export function summarizeDirectControls(legalActions: LegalAction[]) {
  const uncovered: LegalAction[] = []
  let singleUnitButtons = 0
  let groupButtons = 0
  let topBarButtons = 0

  for (const action of legalActions) {
    const category = directControlCategory(action)
    if (category === 'single_unit') {
      singleUnitButtons += 1
      continue
    }
    if (category === 'group') {
      groupButtons += 1
      continue
    }
    if (category === 'top_bar') {
      topBarButtons += 1
      continue
    }
    uncovered.push(action)
  }

  return {
    groupButtons,
    singleUnitButtons,
    topBarButtons,
    uncovered,
  }
}

export function describeCombatResolution(resolution: CombatResolution): string {
  const verb = resolution.kind === 'missile' ? 'shot' : 'fought'
  return `${resolution.attacker_name} ${verb} ${resolution.defender_name} (${resolution.attacker_total}-${resolution.defender_total}, ${resolution.outcome})`
}

export function resolutionKey(resolution: CombatResolution): string {
  return [
    resolution.kind,
    resolution.attacker_id,
    resolution.defender_id,
    resolution.attacker_total,
    resolution.defender_total,
    resolution.outcome,
    resolution.differential,
  ].join(':')
}

export function directionGlyph(direction: 'N' | 'E' | 'S' | 'W'): string {
  if (direction === 'N') {
    return '↑'
  }
  if (direction === 'E') {
    return '→'
  }
  if (direction === 'S') {
    return '↓'
  }
  return '←'
}

export function isInDeploymentZone(
  coord: Coord,
  zones: { army: 'A' | 'B'; min_x: number; max_x: number; min_y: number; max_y: number }[],
  army: 'A' | 'B',
): boolean {
  return zones.some(
    (zone) =>
      zone.army === army &&
      coord.x >= zone.min_x &&
      coord.x <= zone.max_x &&
      coord.y >= zone.min_y &&
      coord.y <= zone.max_y,
  )
}
