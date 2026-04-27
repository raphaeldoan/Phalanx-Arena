import neuralPolicyPayload from './simple-ai/neural-policy-v1/model.json'
import { STRATEGOS_2_MODEL_ID } from './aiSession'
import { describeAction } from './battlefieldShared'
import type { BrowserAiSelection, DeploymentPlacement } from './browserAi'
import type { Coord, GameSnapshot, LegalAction, Unit } from './types'

type FeatureMap = Record<string, number>

type NeuralPolicyPayload = {
  name: string
  version: string
  base_policy_weights?: Record<string, number>
  inference?: {
    base_score_scale?: number
    neural_score_scale?: number
    selection_variance?: number
  }
  network: {
    hash_dim: number
    hidden_dim: number
    input_hidden: number[][]
    hidden_bias: number[]
    hidden_output: number[]
    output_bias: number
  }
}

type UnitProfile = {
  movement: number
  marchBonus: number
  closeVsFoot: number
  closeVsMounted: number
  missileRange: number
  missileStrength: number
  missileDefense: number
  supportEligible: boolean
  pursuitEligible: boolean
  pursuitDistance: number
  mounted: boolean
  screenHeight: number
}

export type NeuralPolicyRankedAction = {
  action: LegalAction
  index: number
  score: number
}

const NEURAL_POLICY_MODEL = neuralPolicyPayload as NeuralPolicyPayload
const FNV_OFFSET_BASIS = 2166136261
const FNV_PRIME = 16777619
const DEFAULT_SELECTION_VARIANCE = 0.15
const DEPLOYMENT_SELECTION_VARIANCE = 0.35
const SOFTMAX_TEMPERATURE = 0.18

const UNIT_KIND_PROFILES: Record<string, UnitProfile> = {
  spear: {
    movement: 2,
    marchBonus: 1,
    closeVsFoot: 4,
    closeVsMounted: 4,
    missileRange: 0,
    missileStrength: 0,
    missileDefense: 3,
    supportEligible: true,
    pursuitEligible: false,
    pursuitDistance: 0,
    mounted: false,
    screenHeight: 2,
  },
  pike: {
    movement: 2,
    marchBonus: 1,
    closeVsFoot: 4,
    closeVsMounted: 5,
    missileRange: 0,
    missileStrength: 0,
    missileDefense: 3,
    supportEligible: true,
    pursuitEligible: true,
    pursuitDistance: 1,
    mounted: false,
    screenHeight: 2,
  },
  guard_pike: {
    movement: 2,
    marchBonus: 1,
    closeVsFoot: 4,
    closeVsMounted: 5,
    missileRange: 0,
    missileStrength: 0,
    missileDefense: 3,
    supportEligible: true,
    pursuitEligible: true,
    pursuitDistance: 1,
    mounted: false,
    screenHeight: 2,
  },
  blade: {
    movement: 3,
    marchBonus: 1,
    closeVsFoot: 5,
    closeVsMounted: 3,
    missileRange: 0,
    missileStrength: 0,
    missileDefense: 4,
    supportEligible: true,
    pursuitEligible: true,
    pursuitDistance: 1,
    mounted: false,
    screenHeight: 2,
  },
  warband: {
    movement: 3,
    marchBonus: 1,
    closeVsFoot: 4,
    closeVsMounted: 3,
    missileRange: 0,
    missileStrength: 0,
    missileDefense: 2,
    supportEligible: false,
    pursuitEligible: true,
    pursuitDistance: 1,
    mounted: false,
    screenHeight: 2,
  },
  auxilia: {
    movement: 3,
    marchBonus: 1,
    closeVsFoot: 3,
    closeVsMounted: 3,
    missileRange: 0,
    missileStrength: 0,
    missileDefense: 2,
    supportEligible: false,
    pursuitEligible: false,
    pursuitDistance: 0,
    mounted: false,
    screenHeight: 2,
  },
  horde: {
    movement: 2,
    marchBonus: 0,
    closeVsFoot: 2,
    closeVsMounted: 2,
    missileRange: 0,
    missileStrength: 0,
    missileDefense: 1,
    supportEligible: false,
    pursuitEligible: false,
    pursuitDistance: 0,
    mounted: false,
    screenHeight: 2,
  },
  cavalry: {
    movement: 4,
    marchBonus: 2,
    closeVsFoot: 3,
    closeVsMounted: 3,
    missileRange: 0,
    missileStrength: 0,
    missileDefense: 3,
    supportEligible: false,
    pursuitEligible: true,
    pursuitDistance: 2,
    mounted: true,
    screenHeight: 3,
  },
  light_horse: {
    movement: 4,
    marchBonus: 2,
    closeVsFoot: 2,
    closeVsMounted: 2,
    missileRange: 0,
    missileStrength: 0,
    missileDefense: 2,
    supportEligible: false,
    pursuitEligible: false,
    pursuitDistance: 0,
    mounted: true,
    screenHeight: 2,
  },
  bow_cavalry: {
    movement: 4,
    marchBonus: 2,
    closeVsFoot: 2,
    closeVsMounted: 2,
    missileRange: 2,
    missileStrength: 2,
    missileDefense: 2,
    supportEligible: false,
    pursuitEligible: false,
    pursuitDistance: 0,
    mounted: true,
    screenHeight: 2,
  },
  knights: {
    movement: 3,
    marchBonus: 2,
    closeVsFoot: 4,
    closeVsMounted: 4,
    missileRange: 0,
    missileStrength: 0,
    missileDefense: 4,
    supportEligible: false,
    pursuitEligible: true,
    pursuitDistance: 2,
    mounted: true,
    screenHeight: 3,
  },
  elephants: {
    movement: 3,
    marchBonus: 1,
    closeVsFoot: 5,
    closeVsMounted: 5,
    missileRange: 0,
    missileStrength: 0,
    missileDefense: 4,
    supportEligible: false,
    pursuitEligible: true,
    pursuitDistance: 1,
    mounted: true,
    screenHeight: 4,
  },
  scythed_chariots: {
    movement: 4,
    marchBonus: 2,
    closeVsFoot: 4,
    closeVsMounted: 4,
    missileRange: 0,
    missileStrength: 0,
    missileDefense: 2,
    supportEligible: false,
    pursuitEligible: true,
    pursuitDistance: 1,
    mounted: true,
    screenHeight: 3,
  },
  bow: {
    movement: 2,
    marchBonus: 0,
    closeVsFoot: 2,
    closeVsMounted: 2,
    missileRange: 4,
    missileStrength: 3,
    missileDefense: 2,
    supportEligible: false,
    pursuitEligible: false,
    pursuitDistance: 0,
    mounted: false,
    screenHeight: 2,
  },
  slinger: {
    movement: 2,
    marchBonus: 1,
    closeVsFoot: 2,
    closeVsMounted: 2,
    missileRange: 3,
    missileStrength: 2,
    missileDefense: 2,
    supportEligible: false,
    pursuitEligible: false,
    pursuitDistance: 0,
    mounted: false,
    screenHeight: 2,
  },
  psiloi: {
    movement: 3,
    marchBonus: 1,
    closeVsFoot: 2,
    closeVsMounted: 3,
    missileRange: 2,
    missileStrength: 2,
    missileDefense: 2,
    supportEligible: false,
    pursuitEligible: false,
    pursuitDistance: 0,
    mounted: false,
    screenHeight: 1,
  },
  artillery: {
    movement: 1,
    marchBonus: 0,
    closeVsFoot: 2,
    closeVsMounted: 2,
    missileRange: 5,
    missileStrength: 4,
    missileDefense: 1,
    supportEligible: false,
    pursuitEligible: false,
    pursuitDistance: 0,
    mounted: false,
    screenHeight: 3,
  },
  leader: {
    movement: 4,
    marchBonus: 2,
    closeVsFoot: 3,
    closeVsMounted: 3,
    missileRange: 0,
    missileStrength: 0,
    missileDefense: 3,
    supportEligible: false,
    pursuitEligible: true,
    pursuitDistance: 2,
    mounted: true,
    screenHeight: 3,
  },
}

export function neuralPolicyDisplayName(): string {
  return STRATEGOS_2_MODEL_ID
}

export async function requestNeuralPolicyAiSelection({
  battleBatch,
  deploymentBatch,
  snapshot,
}: {
  battleBatch: boolean
  deploymentBatch: boolean
  snapshot: GameSnapshot
}): Promise<BrowserAiSelection> {
  if (!snapshot.legal_actions.length) {
    throw new Error(`${STRATEGOS_2_MODEL_ID} cannot choose from an empty legal action list.`)
  }

  const ranked = rankNeuralPolicyLegalActions(snapshot)
  const selected = selectNeuralPolicyActions({
    battleBatch,
    deploymentBatch,
    snapshot,
  })
  const fallbackSelected = selected.length ? selected : ranked.slice(0, 1)
  const actionIndex = fallbackSelected[0]?.index ?? 0
  const actionIndices = fallbackSelected.map((entry) => entry.index)
  const placements = deploymentBatch ? deploymentPlacements(fallbackSelected) : []
  const chosenAction = snapshot.legal_actions[actionIndex] ?? snapshot.legal_actions[0]
  const actionSummary = deploymentBatch
    ? `local deployment plan: ${Math.max(placements.length, actionIndices.length)} choices`
    : battleBatch
      ? `local bound plan: ${actionIndices.length} orders`
      : describeAction(chosenAction)

  return {
    actionIndex,
    actionIndices,
    placements,
    actionSummary,
    reasoning: `${STRATEGOS_2_MODEL_ID} scored ${snapshot.legal_actions.length} legal actions locally with a browser neural policy.`,
    visualObservations: 'No provider call was made; the local model used the engine snapshot and legal action list.',
    confidence: selectionConfidence(ranked),
    intentUpdate: null,
    promptText: '',
    rawText: JSON.stringify({ placements, selected_action_indices: actionIndices }),
    model: STRATEGOS_2_MODEL_ID,
    usage: null,
  }
}

export function rankNeuralPolicyLegalActions(snapshot: GameSnapshot): NeuralPolicyRankedAction[] {
  return snapshot.legal_actions
    .map((action, index) => ({
      action,
      index,
      score: scoreNeuralPolicyFeatures(extractActionFeatures(snapshot, action)),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
}

export function selectNeuralPolicyActions({
  battleBatch,
  deploymentBatch,
  rng = Math.random,
  snapshot,
}: {
  battleBatch: boolean
  deploymentBatch: boolean
  rng?: () => number
  snapshot: GameSnapshot
}): NeuralPolicyRankedAction[] {
  const ranked = rankNeuralPolicyLegalActions(snapshot)
  if (deploymentBatch) {
    return selectDeploymentBatch(ranked, rng)
  }
  if (battleBatch) {
    return selectBattleBatch(snapshot, ranked, rng)
  }
  return ranked.length ? [sampleRankedAction(ranked, rng)] : []
}

export function scoreNeuralPolicyFeatures(features: FeatureMap): number {
  const baseWeights = NEURAL_POLICY_MODEL.base_policy_weights ?? {}
  const baseScale = NEURAL_POLICY_MODEL.inference?.base_score_scale ?? 0
  const neuralScale = NEURAL_POLICY_MODEL.inference?.neural_score_scale ?? 1
  let score = baseScale * scoreSparseFeatures(features, baseWeights)
  const hidden = [...NEURAL_POLICY_MODEL.network.hidden_bias]
  for (const [name, value] of Object.entries(features)) {
    if (value === 0) {
      continue
    }
    const row = NEURAL_POLICY_MODEL.network.input_hidden[stableFeatureIndex(name, NEURAL_POLICY_MODEL.network.hash_dim)]
    for (let index = 0; index < hidden.length; index += 1) {
      hidden[index] += (row?.[index] ?? 0) * value
    }
  }
  let neuralScore = NEURAL_POLICY_MODEL.network.output_bias
  for (let index = 0; index < hidden.length; index += 1) {
    if (hidden[index] > 0) {
      neuralScore += hidden[index] * (NEURAL_POLICY_MODEL.network.hidden_output[index] ?? 0)
    }
  }
  score += neuralScale * neuralScore
  return score
}

function scoreSparseFeatures(features: FeatureMap, weights: Record<string, number>): number {
  let score = 0
  for (const [name, value] of Object.entries(features)) {
    score += (weights[name] ?? 0) * value
  }
  return score
}

function stableFeatureIndex(name: string, hashDim: number): number {
  let value = FNV_OFFSET_BASIS
  const bytes = new TextEncoder().encode(name)
  for (const byte of bytes) {
    value ^= byte
    value = Math.imul(value, FNV_PRIME) >>> 0
  }
  return value % Math.max(1, hashDim)
}

function selectDeploymentBatch(ranked: NeuralPolicyRankedAction[], rng: () => number): NeuralPolicyRankedAction[] {
  const selected: NeuralPolicyRankedAction[] = []
  const usedUnits = new Set<string>()
  const usedDestinations = new Set<string>()
  let remaining = ranked.filter((entry) => entry.action.type === 'deploy')

  while (remaining.length) {
    const available = remaining.filter((entry) => {
      if (entry.action.type !== 'deploy') {
        return false
      }
      const destinationKey = coordKey(entry.action.destination)
      return !usedUnits.has(entry.action.unit_id) && !usedDestinations.has(destinationKey)
    })
    if (!available.length) {
      break
    }

    const entry = sampleDeploymentAction(available, rng)
    if (entry.action.type !== 'deploy') {
      break
    }
    const destinationKey = coordKey(entry.action.destination)
    usedUnits.add(entry.action.unit_id)
    usedDestinations.add(destinationKey)
    selected.push(entry)
    remaining = remaining.filter((candidate) => candidate !== entry)
  }
  return selected.length ? selected : ranked.filter((entry) => entry.action.type === 'finalize_deployment').slice(0, 1)
}

function sampleDeploymentAction(ranked: NeuralPolicyRankedAction[], rng: () => number): NeuralPolicyRankedAction {
  if (ranked.length <= 1) {
    return ranked[0]
  }
  const bestScore = ranked[0].score
  const modelVariance = NEURAL_POLICY_MODEL.inference?.selection_variance ?? DEFAULT_SELECTION_VARIANCE
  const scoreWindow = Math.max(DEPLOYMENT_SELECTION_VARIANCE, modelVariance)
  const candidates = ranked.slice(0, 12).filter((entry) => entry.score >= bestScore - scoreWindow)
  return weightedChoice(candidates.length ? candidates : ranked.slice(0, 1), rng)
}

function deploymentPlacements(selected: NeuralPolicyRankedAction[]): DeploymentPlacement[] {
  return selected
    .filter((entry): entry is NeuralPolicyRankedAction & { action: Extract<LegalAction, { type: 'deploy' }> } =>
      entry.action.type === 'deploy',
    )
    .map((entry) => ({
      unit_id: entry.action.unit_id,
      x: entry.action.destination.x,
      y: entry.action.destination.y,
    }))
}

function selectBattleBatch(
  snapshot: GameSnapshot,
  ranked: NeuralPolicyRankedAction[],
  rng: () => number,
): NeuralPolicyRankedAction[] {
  const selected: NeuralPolicyRankedAction[] = []
  const usedUnits = new Set<string>()
  let remainingPips = Math.max(0, snapshot.state.pips_remaining || 1)
  const maxOrders = Math.max(1, Math.min(8, remainingPips || 1))
  const endBound = ranked.find((entry) => entry.action.type === 'end_bound') ?? null
  let remaining = ranked.filter((entry) => entry.action.type !== 'end_bound')

  while (remaining.length && selected.length < maxOrders) {
    const available = remaining.filter(
      (entry) =>
        battlePipCost(entry.action) <= remainingPips &&
        !actionUnitIds(entry.action).some((unitId) => usedUnits.has(unitId)),
    )
    if (!available.length) {
      break
    }
    const entry = sampleRankedAction(available, rng)
    if (endBound && entry.score < endBound.score && selected.length) {
      break
    }
    selected.push(entry)
    for (const unitId of actionUnitIds(entry.action)) {
      usedUnits.add(unitId)
    }
    remainingPips -= battlePipCost(entry.action)
    if (remainingPips <= 0) {
      break
    }
    remaining = remaining.filter((candidate) => candidate !== entry)
  }
  return selected.length ? selected : endBound ? [endBound] : []
}

function sampleRankedAction(ranked: NeuralPolicyRankedAction[], rng: () => number): NeuralPolicyRankedAction {
  if (ranked.length <= 1) {
    return ranked[0]
  }
  const bestScore = ranked[0].score
  const selectionVariance = NEURAL_POLICY_MODEL.inference?.selection_variance ?? DEFAULT_SELECTION_VARIANCE
  const candidates = ranked.slice(0, 8).filter((entry) => entry.score >= bestScore - selectionVariance)
  return weightedChoice(candidates.length ? candidates : ranked.slice(0, 1), rng)
}

function weightedChoice(items: NeuralPolicyRankedAction[], rng: () => number): NeuralPolicyRankedAction {
  if (items.length <= 1) {
    return items[0]
  }
  const maxScore = Math.max(...items.map((item) => item.score))
  const weights = items.map((item) => Math.exp((item.score - maxScore) / SOFTMAX_TEMPERATURE))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let draw = rng() * total
  for (let index = 0; index < items.length; index += 1) {
    draw -= weights[index]
    if (draw <= 0) {
      return items[index]
    }
  }
  return items[items.length - 1]
}

function selectionConfidence(ranked: NeuralPolicyRankedAction[]): number {
  if (ranked.length <= 1) {
    return 1
  }
  const gap = ranked[0].score - ranked[1].score
  return clamp(0.55 + gap * 0.2, 0.55, 0.95)
}

function extractActionFeatures(snapshot: GameSnapshot, action: LegalAction): FeatureMap {
  const state = snapshot.state
  const actionType = action.type
  const phase = state.phase
  const activeArmy = state.current_player
  const boardWidth = Math.max(1, state.board_width || 1)
  const boardHeight = Math.max(1, state.board_height || 1)
  const maxBoardDistance = Math.max(1, boardWidth + boardHeight - 2)
  const units = state.units
  const unitsById = new Map(units.map((unit) => [unit.id, unit]))
  const activeUnits = units.filter((unit) => unit.army === activeArmy && !unit.eliminated && !unit.off_map)
  const enemyUnits = units.filter(
    (unit) => unit.army !== activeArmy && !unit.eliminated && !unit.off_map && unit.deployed,
  )
  const activeLeaders = activeUnits.filter((unit) => unit.leader)
  const features: FeatureMap = {}
  const add = (name: string, value = 1) => {
    if (value === 0) {
      return
    }
    features[name] = (features[name] ?? 0) + value
  }

  add('bias')
  add(`phase:${phase}`)
  add(`action:${actionType}`)
  add(`phase_action:${phase}:${actionType}`)
  add('pips_remaining', clippedRatio(state.pips_remaining, 8))
  add('legal_non_end_count', clippedRatio(snapshot.legal_actions.filter((candidate) => candidate.type !== 'end_bound').length, 16))

  const pipCost = actionPipCost(action)
  if (pipCost !== null) {
    add('pip_cost', clippedRatio(pipCost, 4))
    add(phase === 'deployment' || pipCost <= state.pips_remaining ? 'pip_affordable' : 'pip_expensive')
  }

  const unitIds = actionUnitIds(action)
  const targetIds = actionTargetIds(action)
  const primaryUnit = unitIds.length ? unitsById.get(unitIds[0]) ?? null : null
  const targetUnit = targetIds.length ? unitsById.get(targetIds[0]) ?? null : null
  if (unitIds.length > 1) {
    add('group_action')
    add('group_size', clippedRatio(unitIds.length, 8))
    if (unitIds.length >= 3) {
      add('group_size_ge_3')
    }
  }

  if (primaryUnit) {
    addUnitFeatures(add, primaryUnit, 'unit', actionType)
    add('unit_enemy_closeness', proximityToNearest(primaryUnit.position, enemyUnits, maxBoardDistance))
    add('unit_leader_closeness', proximityToNearest(primaryUnit.position, activeLeaders, 8, primaryUnit.id))
  }

  if (targetUnit) {
    addUnitFeatures(add, targetUnit, 'target', actionType)
    add('target_friendly_closeness', proximityToNearest(targetUnit.position, activeUnits, maxBoardDistance))
  }

  if (primaryUnit && targetUnit) {
    addMatchupFeatures(add, primaryUnit, targetUnit, actionType)
  }

  if (action.type === 'deploy') {
    addDeploymentFeatures(add, snapshot, action, action.destination, activeArmy, activeUnits)
  }

  const destination = actionDestination(action)
  if (destination && primaryUnit) {
    const before = nearestDistance(primaryUnit.position, enemyUnits)
    const after = nearestDistance(destination, enemyUnits)
    if (before !== null && after !== null) {
      add('dest_enemy_closeness_delta', clamp((before - after) / maxBoardDistance, -1, 1))
      add('dest_enemy_closeness', 1 - Math.min(after, maxBoardDistance) / maxBoardDistance)
      if (after <= 1) {
        add('dest_enemy_adjacent')
      }
    }
    addDestinationTerrainFeatures(add, snapshot, destination, primaryUnit)
    add('dest_forward_progress', clamp(forwardProgress(primaryUnit.position, destination, activeArmy) / 4, -1, 1))
    add('dest_centered', centeredness(destination.x, boardWidth))
    if (isOverextendedDestination(destination, activeArmy, boardHeight)) {
      add('dest_overextended')
      if (primaryUnit.unit_class === 'Light') {
        add('dest_light_overextended')
      }
      if (primaryUnit.leader || primaryUnit.unit_class === 'Leader') {
        add('dest_leader_overextended')
      }
    }
    if (destination.x === 0 || destination.x === boardWidth - 1) {
      add('dest_edge_file')
      if (!isMobileUnitClass(primaryUnit.unit_class)) {
        add('dest_non_mobile_edge_file')
      }
    }
  }

  if (action.type === 'charge') {
    add(`charge_aspect:${action.aspect}`)
    if (action.aspect !== 'front') {
      add('charge_flank_or_rear')
    }
    if (action.warning) {
      add('charge_warning')
    }
  }

  if (action.type === 'group_charge') {
    if (action.warning) {
      add('charge_warning')
    }
    const chargeTargets = targetIds.map((targetId) => unitsById.get(targetId)).filter((unit): unit is Unit => Boolean(unit))
    if (chargeTargets.some((unit) => unit.disordered)) {
      add('group_charge_has_disordered_target')
    }
  }

  if (action.type === 'shoot') {
    add('shoot_range', clippedRatio(action.range, 4))
    if (action.range <= 2) {
      add('shoot_short_range')
    }
  }

  if (action.type === 'rally' && primaryUnit?.disordered) {
    add('rally_disordered_unit')
  }

  if (action.type === 'reform_pike' && primaryUnit) {
    if (primaryUnit.unit_class === 'Pike') {
      add('reform_pike_unit')
    }
    if (primaryUnit.formation_state !== 'OrderedPike') {
      add('reform_not_ordered')
    }
  }

  if (action.type === 'end_bound') {
    add('end_bound_pips_remaining', clippedRatio(state.pips_remaining, 8))
    if (!snapshot.legal_actions.some((candidate) => candidate.type !== 'end_bound')) {
      add('end_bound_only_legal')
    }
  }

  return features
}

function addUnitFeatures(
  add: (name: string, value?: number) => void,
  unit: Unit,
  prefix: string,
  actionType: string,
) {
  const profile = unitProfile(unit)
  add(`${prefix}_kind:${unit.kind}`)
  add(`${prefix}_class:${unit.unit_class}`)
  add(`${prefix}_quality:${unit.quality}`)
  add(`${prefix}_formation:${unit.formation_state}`)
  add(`action_${prefix}_kind:${actionType}:${unit.kind}`)
  add(`action_${prefix}_class:${actionType}:${unit.unit_class}`)
  if (unit.leader) {
    add(`${prefix}_leader`)
  }
  if (unit.disordered) {
    add(`${prefix}_disordered`)
  }
  if (!unit.in_command) {
    add(`${prefix}_out_of_command`)
  }
  if (unit.activated_this_bound) {
    add(`${prefix}_activated`)
  }
  if (unit.charging) {
    add(`${prefix}_charging`)
  }
  if (unit.morale_value) {
    add(`${prefix}_morale_value`, clippedRatio(unit.morale_value, 4))
  }
  add(`${prefix}_movement`, clippedRatio(profile.movement, 4))
  add(`${prefix}_march_bonus`, clippedRatio(profile.marchBonus, 2))
  add(`${prefix}_close_vs_foot`, clippedRatio(profile.closeVsFoot, 5))
  add(`${prefix}_close_vs_mounted`, clippedRatio(profile.closeVsMounted, 5))
  add(`${prefix}_missile_defense`, clippedRatio(profile.missileDefense, 4))
  add(`${prefix}_screen_height`, clippedRatio(profile.screenHeight, 4))
  if (profile.movement >= 4) {
    add(`${prefix}_fast`)
    add(`action_${prefix}_fast:${actionType}`)
  }
  if (profile.movement <= 2) {
    add(`${prefix}_slow`)
    add(`action_${prefix}_slow:${actionType}`)
  }
  if (profile.mounted) {
    add(`${prefix}_mounted`)
    add(`action_${prefix}_mounted:${actionType}`)
  }
  if (profile.supportEligible) {
    add(`${prefix}_support_eligible`)
    add(`action_${prefix}_support_eligible:${actionType}`)
  }
  if (profile.pursuitEligible) {
    add(`${prefix}_pursuit_eligible`)
    add(`action_${prefix}_pursuit_eligible:${actionType}`)
  }
  if (profile.pursuitDistance > 0) {
    add(`${prefix}_pursuit_distance`, clippedRatio(profile.pursuitDistance, 2))
  }
  if (profile.missileRange > 0) {
    add(`${prefix}_missile_capable`)
    add(`action_${prefix}_missile_capable:${actionType}`)
    add(`${prefix}_missile_range`, clippedRatio(profile.missileRange, 5))
    add(`${prefix}_missile_strength`, clippedRatio(profile.missileStrength, 4))
  }
}

function addMatchupFeatures(
  add: (name: string, value?: number) => void,
  unit: Unit,
  target: Unit,
  actionType: string,
) {
  const unitData = unitProfile(unit)
  const targetData = unitProfile(target)
  const unitClose = targetData.mounted ? unitData.closeVsMounted : unitData.closeVsFoot
  const targetClose = unitData.mounted ? targetData.closeVsMounted : targetData.closeVsFoot
  const closeAdvantage = clamp((unitClose - targetClose) / 5, -1, 1)
  add('matchup_close_advantage', closeAdvantage)
  add(`${actionType}_close_advantage`, closeAdvantage)
  if (closeAdvantage > 0) {
    add('matchup_close_favorable')
    add(`${actionType}_close_favorable`)
  } else if (closeAdvantage < 0) {
    add('matchup_close_unfavorable')
    add(`${actionType}_close_unfavorable`)
  }

  if (unitData.missileRange > 0) {
    const missileAdvantage = clamp((unitData.missileStrength - targetData.missileDefense) / 4, -1, 1)
    add('matchup_missile_advantage', missileAdvantage)
    add(`${actionType}_missile_advantage`, missileAdvantage)
    if (missileAdvantage > 0) {
      add('matchup_missile_favorable')
      add(`${actionType}_missile_favorable`)
    } else if (missileAdvantage < 0) {
      add('matchup_missile_unfavorable')
      add(`${actionType}_missile_unfavorable`)
    }
  }
}

function addDeploymentFeatures(
  add: (name: string, value?: number) => void,
  snapshot: GameSnapshot,
  action: Extract<LegalAction, { type: 'deploy' }>,
  destination: Coord,
  activeArmy: string,
  activeUnits: Unit[],
) {
  const unit = activeUnits.find((candidate) => candidate.id === action.unit_id) ?? null
  const zone = snapshot.state.deployment_zones.find((candidate) => candidate.army === activeArmy)
  if (!zone) {
    add('deploy_centered', centeredness(destination.x, snapshot.state.board_width))
  } else {
    const centerX = (zone.min_x + zone.max_x) / 2
    const halfWidth = Math.max(1, (zone.max_x - zone.min_x) / 2)
    add('deploy_centered', 1 - Math.min(1, Math.abs(destination.x - centerX) / halfWidth))
    const frontY = activeArmy === 'A' ? zone.min_y : zone.max_y
    const backY = activeArmy === 'A' ? zone.max_y : zone.min_y
    if (destination.y === frontY) {
      add('deploy_front_row')
    }
    if (destination.y === backY) {
      add('deploy_back_row')
    }
    const zoneDepth = Math.max(1, zone.max_y - zone.min_y)
    const localY = activeArmy === 'A' ? destination.y - zone.min_y : zone.max_y - destination.y
    add('deploy_frontness', 1 - Math.min(1, localY / zoneDepth))
  }

  const deployedFriends = activeUnits.filter((candidate) => candidate.deployed)
  if (nearestDistance(destination, deployedFriends) === 1) {
    add('deploy_adjacent_friend')
  }

  if (unit) {
    const profile = unitProfile(unit)
    if (['Pike', 'Formed', 'Cavalry', 'Elephant', 'Chariot'].includes(unit.unit_class)) {
      add('deploy_combat_unit')
    }
    if (unit.unit_class === 'Leader') {
      add('deploy_leader')
    }
    if (unit.kind === 'artillery') {
      add('deploy_artillery')
    }
    if (profile.missileRange > 0) {
      add('deploy_missile_unit')
    }
    if (profile.mounted) {
      add('deploy_mounted_unit')
    }
    if (profile.supportEligible) {
      add('deploy_support_unit')
    }
    addDestinationTerrainFeatures(add, snapshot, destination, unit, 'deploy_dest')
  }
}

function addDestinationTerrainFeatures(
  add: (name: string, value?: number) => void,
  snapshot: GameSnapshot,
  destination: Coord,
  unit: Unit,
  prefix = 'dest',
) {
  const terrain = terrainAt(snapshot, destination)
  const profile = unitProfile(unit)
  add(`${prefix}_terrain:${terrain}`)
  if (terrain === 'hill') {
    add(`${prefix}_hill`)
  }
  if (terrain === 'forest') {
    add(`${prefix}_forest`)
  }
  if (terrain === 'road') {
    add(`${prefix}_road`)
  }
  if (terrain === 'water') {
    add(`${prefix}_water`)
  }
  if (terrain === 'hill' && profile.missileRange > 0) {
    add(`${prefix}_missile_hill`)
  }
  if (terrain === 'forest' && profile.mounted) {
    add(`${prefix}_mounted_forest`)
  }
  if (terrain === 'forest' && (unit.unit_class === 'Pike' || unit.unit_class === 'Formed')) {
    add(`${prefix}_close_order_forest`)
  }
}

function actionPipCost(action: LegalAction): number | null {
  return 'pip_cost' in action ? action.pip_cost : null
}

function battlePipCost(action: LegalAction): number {
  return Math.max(0, actionPipCost(action) ?? 1)
}

function actionUnitIds(action: LegalAction): string[] {
  if (action.type === 'group_move' || action.type === 'group_march_move' || action.type === 'group_charge') {
    return [...action.unit_ids]
  }
  return 'unit_id' in action ? [action.unit_id] : []
}

function actionTargetIds(action: LegalAction): string[] {
  if (action.type === 'group_charge') {
    return action.steps.map((step) => step.target_id)
  }
  return 'target_id' in action ? [action.target_id] : []
}

function actionDestination(action: LegalAction): Coord | null {
  if (action.type === 'move' || action.type === 'march_move' || action.type === 'charge' || action.type === 'deploy') {
    return action.destination
  }
  if (action.type === 'group_move' || action.type === 'group_march_move' || action.type === 'group_charge') {
    if (!action.steps.length) {
      return null
    }
    return {
      x: Math.round(action.steps.reduce((total, step) => total + step.destination.x, 0) / action.steps.length),
      y: Math.round(action.steps.reduce((total, step) => total + step.destination.y, 0) / action.steps.length),
    }
  }
  return null
}

function terrainAt(snapshot: GameSnapshot, position: Coord): string {
  return (
    snapshot.state.terrain.find((tile) => tile.position.x === position.x && tile.position.y === position.y)?.terrain ??
    'open'
  )
}

function nearestDistance(position: Coord, units: Unit[], skipId?: string): number | null {
  let nearest: number | null = null
  for (const unit of units) {
    if (skipId && unit.id === skipId) {
      continue
    }
    const distance = Math.abs(position.x - unit.position.x) + Math.abs(position.y - unit.position.y)
    nearest = nearest === null ? distance : Math.min(nearest, distance)
  }
  return nearest
}

function proximityToNearest(position: Coord, units: Unit[], scale: number, skipId?: string): number {
  const distance = nearestDistance(position, units, skipId)
  if (distance === null) {
    return 0
  }
  return 1 - Math.min(distance, scale) / Math.max(1, scale)
}

function forwardProgress(origin: Coord, destination: Coord, activeArmy: string): number {
  return activeArmy === 'A' ? origin.y - destination.y : destination.y - origin.y
}

function isOverextendedDestination(destination: Coord, activeArmy: string, boardHeight: number): boolean {
  return activeArmy === 'A' ? destination.y <= 1 : destination.y >= boardHeight - 2
}

function isMobileUnitClass(unitClass: string): boolean {
  return unitClass === 'Cavalry' || unitClass === 'Elephant' || unitClass === 'Chariot'
}

function centeredness(x: number, width: number): number {
  const center = (width - 1) / 2
  return 1 - Math.min(1, Math.abs(x - center) / Math.max(1, center))
}

function clippedRatio(value: number, scale: number): number {
  return clamp(value / Math.max(1, scale), 0, 1)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function coordKey(coord: Coord): string {
  return `${coord.x},${coord.y}`
}

function unitProfile(unit: Unit): UnitProfile {
  return UNIT_KIND_PROFILES[unit.kind] ?? UNIT_KIND_PROFILES.spear
}
