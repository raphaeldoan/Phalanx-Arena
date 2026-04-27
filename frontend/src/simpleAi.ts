import trainedModelPayload from './simple-ai/model.classic_battle.json'
import { describeAction, materializeAction } from './battlefieldShared'
import type { BrowserAiSelection, DeploymentPlacement } from './browserAi'
import { STRATEGOS_1_MODEL_ID } from './aiSession'
import type { GameClient } from './gameClient'
import type { Coord, GameSnapshot, LegalAction, Unit } from './types'

type FeatureMap = Record<string, number>

type SimpleAiModelPayload = {
  name: string
  version: string
  weights: Record<string, number>
  training?: {
    candidate_accuracy?: number
    examples?: number
  }
}

const SIMPLE_AI_MODEL = trainedModelPayload as SimpleAiModelPayload
const ACTION_SCORE_WINDOW = 1.35
const BATTLE_SCORE_WINDOW = 1.15
const DEPLOYMENT_SCORE_WINDOW = 1.2
const BATTLE_MIN_ACTION_SCORE = 0.35
const LOOKAHEAD_CANDIDATE_LIMIT = 8
const LOOKAHEAD_SCORE_SCALE = 0.12
const SOFTMAX_TEMPERATURE = 0.55

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

const UNIT_KIND_PROFILES: Record<Unit['kind'], UnitProfile> = {
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

export async function requestSimpleAiSelection({
  battleBatch,
  deploymentBatch,
  gameClient,
  snapshot,
}: {
  battleBatch: boolean
  deploymentBatch: boolean
  gameClient?: GameClient
  snapshot: GameSnapshot
}): Promise<BrowserAiSelection> {
  if (!snapshot.legal_actions.length) {
    throw new Error(`${STRATEGOS_1_MODEL_ID} cannot choose from an empty legal action list.`)
  }

  const ranked = rankLegalActions(snapshot)
  const rng = Math.random
  const tacticalRanked = battleBatch && gameClient
    ? await rankWithEngineLookahead(snapshot, ranked, gameClient)
    : ranked
  const selected = deploymentBatch
    ? selectDeploymentPlan(snapshot, ranked, rng)
    : battleBatch
      ? selectBattlePlan(snapshot, tacticalRanked, rng)
      : [sampleRankedAction(tacticalRanked, rng, ACTION_SCORE_WINDOW)]
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
  const confidence = selectionConfidence(ranked)
  const payload = deploymentBatch
    ? { placements, selected_action_indices: actionIndices }
    : { selected_action_indices: actionIndices }

  return {
    actionIndex,
    actionIndices,
    placements,
    actionSummary,
    reasoning: `${STRATEGOS_1_MODEL_ID} scored ${snapshot.legal_actions.length} legal actions locally from structured state features.`,
    visualObservations: 'No provider call was made; the local model used the engine snapshot and legal action list.',
    confidence,
    intentUpdate: null,
    promptText: '',
    rawText: JSON.stringify(payload),
    model: STRATEGOS_1_MODEL_ID,
    usage: null,
  }
}

export function simpleAiDisplayName(): string {
  return STRATEGOS_1_MODEL_ID
}

type RankedAction = {
  action: LegalAction
  index: number
  score: number
}

type RandomSource = () => number

function rankLegalActions(snapshot: GameSnapshot): RankedAction[] {
  return snapshot.legal_actions
    .map((action, index) => ({
      action,
      index,
      score: scoreFeatures(extractActionFeatures(snapshot, action), SIMPLE_AI_MODEL.weights) +
        tacticalActionAdjustment(snapshot, action),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
}

function scoreFeatures(features: FeatureMap, weights: Record<string, number>): number {
  let score = 0
  for (const [name, value] of Object.entries(features)) {
    score += (weights[name] ?? 0) * value
  }
  return score
}

function tacticalActionAdjustment(snapshot: GameSnapshot, action: LegalAction): number {
  if (action.type === 'charge' || action.type === 'group_charge') {
    return chargeAdjustment(snapshot, action)
  }
  if (action.type === 'shoot') {
    return shootAdjustment(snapshot, action)
  }
  if (action.type === 'rally') {
    return rallyAdjustment(snapshot, action)
  }
  if (action.type === 'reform_pike') {
    return reformAdjustment(snapshot, action)
  }
  if (
    action.type === 'move' ||
    action.type === 'march_move' ||
    action.type === 'group_move' ||
    action.type === 'group_march_move'
  ) {
    return movementSafetyAdjustment(snapshot, action)
  }
  if (action.type === 'end_bound') {
    const nonEndCount = snapshot.legal_actions.filter((legalAction) => legalAction.type !== 'end_bound').length
    return nonEndCount === 0 ? 2 : -0.6
  }
  return 0
}

async function rankWithEngineLookahead(
  snapshot: GameSnapshot,
  ranked: RankedAction[],
  gameClient: GameClient,
): Promise<RankedAction[]> {
  if (snapshot.state.phase !== 'battle') {
    return ranked
  }

  const candidates = ranked
    .filter((entry) => entry.action.type !== 'end_bound' && shouldUseEngineLookahead(snapshot, entry.action))
    .slice(0, LOOKAHEAD_CANDIDATE_LIMIT)
  if (!candidates.length) {
    return ranked
  }

  const activeArmy = snapshot.state.current_player
  const adjustments = new Map<number, number>()
  let scratchGameId: string | null = null
  try {
    const replay = await gameClient.fetchReplay(snapshot.state.game_id)
    const scratchSnapshot = await gameClient.createGameFromReplay(replay)
    scratchGameId = scratchSnapshot.state.game_id

    for (const entry of candidates) {
      let applied = false
      try {
        const nextSnapshot = await gameClient.submitAction(scratchGameId, materializeAction(entry.action))
        applied = true
        adjustments.set(entry.index, lookaheadStateValue(nextSnapshot, activeArmy) * LOOKAHEAD_SCORE_SCALE)
      } catch {
        // Keep the base score if a speculative action cannot be applied.
      } finally {
        if (applied) {
          try {
            await gameClient.undoGame(scratchGameId)
          } catch {
            // Leave the base ordering if scratch rollback fails; the live game was not mutated.
          }
        }
      }
    }
  } catch {
    return ranked
  } finally {
    if (scratchGameId) {
      await gameClient.dropGame(scratchGameId).catch(() => undefined)
    }
  }

  if (!adjustments.size) {
    return ranked
  }
  return ranked
    .map((entry) => ({
      ...entry,
      score: entry.score + (adjustments.get(entry.index) ?? 0),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
}

function shouldUseEngineLookahead(snapshot: GameSnapshot, action: LegalAction): boolean {
  if (
    action.type === 'charge' ||
    action.type === 'group_charge' ||
    action.type === 'shoot' ||
    action.type === 'rally' ||
    action.type === 'reform_pike'
  ) {
    return true
  }
  if (
    action.type !== 'move' &&
    action.type !== 'march_move' &&
    action.type !== 'group_move' &&
    action.type !== 'group_march_move'
  ) {
    return false
  }

  const enemyUnits = liveUnits(snapshot, enemyArmy(snapshot.state.current_player))
  return movementStepData(action).some((step) => {
    if (!step.destination) {
      return false
    }
    return (nearestUnitDistance(step.destination, enemyUnits) ?? 99) <= 2
  })
}

function lookaheadStateValue(snapshot: GameSnapshot, army: string): number {
  const winner = snapshot.state.winner
  if (winner === army) {
    return 80
  }
  if (winner && winner !== army) {
    return -80
  }
  if (snapshot.state.draw) {
    return 0
  }

  const opponent = enemyArmy(army)
  const ownScore = battleScoreForArmy(snapshot, army)
  const opponentScore = battleScoreForArmy(snapshot, opponent)
  const ownAttrition = attritionForArmy(snapshot, army)
  const opponentAttrition = attritionForArmy(snapshot, opponent)
  let value = 0
  value += (ownScore - opponentScore) * 0.9
  value += (opponentAttrition.losses - ownAttrition.losses) * 4.5
  if (ownAttrition.targetLosses) {
    value -= Math.max(0, ownAttrition.losses - ownAttrition.targetLosses + 1) * 5
  }
  if (opponentAttrition.targetLosses) {
    value += Math.max(0, opponentAttrition.losses - opponentAttrition.targetLosses + 1) * 5
  }
  value += pendingShotValue(snapshot, army)

  for (const unit of liveUnits(snapshot, army)) {
    value += unitPositionalValue(snapshot, unit, true)
  }
  for (const unit of liveUnits(snapshot, opponent)) {
    value -= unitPositionalValue(snapshot, unit, false)
  }
  if (snapshot.state.current_player === army) {
    value += Math.min(8, Math.max(0, snapshot.state.pips_remaining)) * 0.25
  }
  return clamp(value, -24, 24)
}

function unitPositionalValue(snapshot: GameSnapshot, unit: Unit, friendly: boolean): number {
  const enemyUnits = liveUnits(snapshot, enemyArmy(unit.army))
  const friendlyUnits = liveUnits(snapshot, unit.army)
  const moraleValue = Math.max(1, unit.morale_value || 0)
  const adjacentEnemies = adjacentUnitCount(unit.position, enemyUnits)
  const adjacentFriends = adjacentUnitCount(unit.position, friendlyUnits, new Set([unit.id]))
  const nearestEnemy = nearestUnitDistance(unit.position, enemyUnits)
  const enemyChargeThreats = enemyChargeThreatCount(unit.position, enemyUnits)
  let value = 0

  if (adjacentEnemies) {
    let exposure = adjacentEnemies * (0.7 + moraleValue * 0.16)
    if (unit.unit_class === 'Light') {
      exposure += adjacentEnemies * 1.1
    }
    if (unit.leader || unit.unit_class === 'Leader') {
      exposure += adjacentEnemies * 3.2
    }
    if (unit.disordered) {
      exposure += adjacentEnemies * 0.8
    }
    value -= exposure
  } else if (nearestEnemy !== null && nearestEnemy <= 2 && (unit.unit_class === 'Light' || unit.unit_class === 'Leader')) {
    value -= 0.7
  }

  if (enemyChargeThreats && adjacentEnemies === 0 && adjacentFriends === 0) {
    let threatPenalty = 0.4
    if (unit.unit_class === 'Light' || unit.unit_class === 'Leader' || unit.leader) {
      threatPenalty = 0.95
    } else if (isMobileUnitClass(unit.unit_class)) {
      threatPenalty = 0.55
    }
    value -= Math.min(2.4, enemyChargeThreats * threatPenalty)
  }

  if (adjacentFriends >= 2) {
    value += 0.45
  } else if (adjacentFriends === 0 && nearestEnemy !== null && nearestEnemy <= 2) {
    value -= 0.45
  }
  if (unit.disordered) {
    value -= 0.6 + moraleValue * 0.12
  }
  if (unit.formation_state === 'DisorderedPike') {
    value -= 0.8
  }
  if (!unit.in_command) {
    value -= 0.35
  }
  if (
    (unit.kind === 'bow' || unit.kind === 'slinger' || unit.kind === 'psiloi' || unit.kind === 'bow_cavalry' || unit.kind === 'artillery') &&
    adjacentEnemies === 0
  ) {
    value += 0.25
  }
  return friendly ? value : value * 0.8
}

function chargeAdjustment(
  snapshot: GameSnapshot,
  action: Extract<LegalAction, { type: 'charge' | 'group_charge' }>,
): number {
  const unitsById = new Map(snapshot.state.units.map((unit) => [unit.id, unit]))
  const activeArmy = snapshot.state.current_player
  const friendlyUnits = liveUnits(snapshot, activeArmy)
  const enemyUnits = liveUnits(snapshot, enemyArmy(activeArmy))
  const actingUnitIds = new Set(actionUnitIds(action))
  let adjustment = 0

  for (const step of chargeStepData(action)) {
    const unit = unitsById.get(step.unitId)
    const target = unitsById.get(step.targetId)
    if (!unit || !target) {
      continue
    }

    const closeDelta = closeMatchupDelta(unit, target)
    const flankOrRear = step.aspect === 'side' || step.aspect === 'rear'

    if (flankOrRear) {
      adjustment += step.aspect === 'side' ? 1.4 : 2
    } else if (closeDelta <= 0) {
      adjustment -= 0.7 + Math.abs(closeDelta) * 0.75
    }

    if (closeDelta > 0) {
      adjustment += Math.min(2, closeDelta * 0.65)
    } else if (closeDelta < 0) {
      adjustment -= Math.min(3, Math.abs(closeDelta) * 0.9)
    }

    if (unit.leader || unit.unit_class === 'Leader') {
      adjustment -= 4
      if (flankOrRear && closeDelta >= 0) {
        adjustment += 1.2
      }
      if (closeDelta < 0 && isCombatUnitClass(target.unit_class)) {
        adjustment -= 2
      }
    }
    if (unit.unit_class === 'Light') {
      adjustment -= 1.6
      if (!flankOrRear && isCombatUnitClass(target.unit_class)) {
        adjustment -= 2
      }
    }
    if ((unit.kind === 'bow' || unit.kind === 'slinger' || unit.kind === 'psiloi' || unit.kind === 'bow_cavalry') && !flankOrRear) {
      adjustment -= 1.1
    }
    if (
      target.kind === 'elephants' &&
      (unit.kind === 'cavalry' || unit.kind === 'light_horse' || unit.kind === 'knights') &&
      !flankOrRear
    ) {
      adjustment -= 1.6
    }
    if (target.unit_class === 'Light' || target.disordered) {
      adjustment += 1.1
    }
    if (unit.disordered) {
      adjustment -= 1.2
    }
    if (target.leader) {
      adjustment += 0.9
    }

    if (step.destination) {
      const friendCount = adjacentUnitCount(step.destination, friendlyUnits, actingUnitIds)
      const enemyCount = adjacentUnitCount(step.destination, enemyUnits, new Set([step.targetId]))
      if (friendCount === 0 && !flankOrRear) {
        adjustment -= 0.8
      } else if (friendCount >= 2) {
        adjustment += 0.4
      }
      if (enemyCount >= 2) {
        adjustment -= 1
      }
    }
  }

  return clamp(adjustment, -9, 6)
}

function shootAdjustment(snapshot: GameSnapshot, action: Extract<LegalAction, { type: 'shoot' }>): number {
  const unit = unitById(snapshot, action.unit_id)
  const target = unitById(snapshot, action.target_id)
  if (!unit || !target) {
    return 0
  }

  const unitProfile = UNIT_KIND_PROFILES[unit.kind]
  const targetProfile = UNIT_KIND_PROFILES[target.kind]
  let adjustment = (unitProfile.missileStrength - targetProfile.missileDefense) * 0.55
  if (action.range <= 2) {
    adjustment += 0.5
  }
  if (target.disordered) {
    adjustment += 0.6
  }
  if (target.leader) {
    adjustment += 0.4
  }
  if (target.unit_class === 'Pike' || target.unit_class === 'Formed') {
    adjustment += 0.2
  }
  return clamp(adjustment, -2, 2.2)
}

function rallyAdjustment(snapshot: GameSnapshot, action: Extract<LegalAction, { type: 'rally' }>): number {
  const unit = unitById(snapshot, action.unit_id)
  if (!unit?.disordered) {
    return 0
  }
  const attrition = attritionForArmy(snapshot, unit.army)
  return 1 + (attrition.targetLosses > 0 && attrition.losses >= Math.max(1, attrition.targetLosses - 1) ? 0.5 : 0)
}

function reformAdjustment(snapshot: GameSnapshot, action: Extract<LegalAction, { type: 'reform_pike' }>): number {
  const unit = unitById(snapshot, action.unit_id)
  if (!unit || unit.unit_class !== 'Pike' || unit.formation_state === 'OrderedPike') {
    return 0
  }
  return 0.7
}

function movementSafetyAdjustment(
  snapshot: GameSnapshot,
  action: Extract<LegalAction, { type: 'move' | 'march_move' | 'group_move' | 'group_march_move' }>,
): number {
  const activeArmy = snapshot.state.current_player
  const friendlyUnits = liveUnits(snapshot, activeArmy)
  const enemyUnits = liveUnits(snapshot, enemyArmy(activeArmy))
  let adjustment = 0

  for (const step of movementStepData(action)) {
    const unit = unitById(snapshot, step.unitId)
    if (!unit || !step.destination) {
      continue
    }
    const enemyAdjacent = adjacentUnitCount(step.destination, enemyUnits)
    const friendAdjacent = adjacentUnitCount(step.destination, friendlyUnits, new Set([step.unitId]))
    const nearestEnemy = nearestUnitDistance(step.destination, enemyUnits)
    const nearestFriend = nearestUnitDistance(step.destination, friendlyUnits, new Set([step.unitId]))
    const chargeThreats = enemyChargeThreatCount(step.destination, enemyUnits)

    if (enemyAdjacent) {
      adjustment -= enemyAdjacent * (unit.unit_class === 'Light' || unit.unit_class === 'Leader' ? 1.4 : 0.9)
    }
    if (friendAdjacent >= 2) {
      adjustment += 0.45
    } else if (nearestEnemy !== null && nearestEnemy <= 2 && (nearestFriend === null || nearestFriend > 2)) {
      adjustment -= 0.8
    }
    if (chargeThreats && friendAdjacent === 0) {
      let threatPenalty = 0.45
      if (unit.unit_class === 'Light' || unit.unit_class === 'Leader' || unit.leader) {
        threatPenalty = 1.1
      } else if (isMobileUnitClass(unit.unit_class)) {
        threatPenalty = 0.65
      }
      adjustment -= Math.min(3, chargeThreats * threatPenalty)
    } else if (chargeThreats && (unit.unit_class === 'Light' || unit.unit_class === 'Leader' || unit.leader)) {
      adjustment -= Math.min(1.2, chargeThreats * 0.35)
    }
    if ((unit.leader || unit.unit_class === 'Leader') && nearestEnemy !== null && nearestEnemy <= 2) {
      adjustment -= 1.4
    }
  }

  return clamp(adjustment, -4, 2)
}

type RankedDeployAction = RankedAction & {
  action: Extract<LegalAction, { type: 'deploy' }>
}

function selectDeploymentPlan(snapshot: GameSnapshot, ranked: RankedAction[], rng: RandomSource): RankedAction[] {
  const planned = autoDeploymentPlan(snapshot, rng)
  if (planned.length) {
    return planned
  }

  const selected: RankedAction[] = []
  const usedUnits = new Set<string>()
  const usedDestinations = new Set<string>()
  for (const entry of ranked) {
    if (entry.action.type !== 'deploy') {
      continue
    }
    const destinationKey = coordKey(entry.action.destination)
    if (usedUnits.has(entry.action.unit_id) || usedDestinations.has(destinationKey)) {
      continue
    }
    usedUnits.add(entry.action.unit_id)
    usedDestinations.add(destinationKey)
    selected.push(entry)
  }
  if (!selected.length) {
    const finalize = ranked.find((entry) => entry.action.type === 'finalize_deployment')
    if (finalize) {
      selected.push(finalize)
    }
  }
  return selected
}

function autoDeploymentPlan(snapshot: GameSnapshot, rng: RandomSource): RankedAction[] {
  const deployEntries = snapshot.legal_actions
    .map((action, index) => ({ action, index, score: 0 }))
    .filter((entry): entry is RankedDeployAction => entry.action.type === 'deploy')
  if (!deployEntries.length) {
    return []
  }

  const unitsById = new Map(snapshot.state.units.map((unit) => [unit.id, unit]))
  const destinations = deployEntries.map((entry) => entry.action.destination)
  const minX = Math.min(...destinations.map((coord) => coord.x))
  const maxX = Math.max(...destinations.map((coord) => coord.x))
  const minY = Math.min(...destinations.map((coord) => coord.y))
  const maxY = Math.max(...destinations.map((coord) => coord.y))
  const centerX = (minX + maxX) / 2
  const activeArmy = snapshot.state.current_player
  const frontY = activeArmy === 'A' ? minY : maxY
  const supportY = activeArmy === 'A' ? maxY : minY
  const entriesByUnit = new Map<string, RankedDeployAction[]>()

  for (const entry of deployEntries) {
    const unitEntries = entriesByUnit.get(entry.action.unit_id) ?? []
    unitEntries.push(entry)
    entriesByUnit.set(entry.action.unit_id, unitEntries)
  }

  const usedDestinations = new Set<string>()
  const selected: RankedAction[] = []
  const unitIds = shufflePriorityTies([...entriesByUnit.keys()].sort((left, right) => {
    const leftPriority = deploymentUnitPriority(unitsById.get(left))
    const rightPriority = deploymentUnitPriority(unitsById.get(right))
    return leftPriority - rightPriority || left.localeCompare(right)
  }), unitsById, rng)

  for (const unitId of unitIds) {
    const unit = unitsById.get(unitId)
    const legalEntries = (entriesByUnit.get(unitId) ?? []).filter(
      (entry) => !usedDestinations.has(coordKey(entry.action.destination)),
    )
    if (!legalEntries.length) {
      continue
    }
    const scoredEntries = legalEntries.map((entry) => ({
      entry,
      score: deploymentDestinationScore(unit, entry.action.destination, minX, maxX, centerX, frontY, supportY),
    }))
    const best = sampleLowestScored(scoredEntries, rng, DEPLOYMENT_SCORE_WINDOW)
    usedDestinations.add(coordKey(best.action.destination))
    selected.push(best)
  }

  return selected
}

function shufflePriorityTies(unitIds: string[], unitsById: Map<string, Unit>, rng: RandomSource): string[] {
  const grouped = new Map<number, string[]>()
  for (const unitId of unitIds) {
    const priority = deploymentUnitPriority(unitsById.get(unitId))
    grouped.set(priority, [...(grouped.get(priority) ?? []), unitId])
  }

  const shuffled: string[] = []
  for (const priority of [...grouped.keys()].sort((left, right) => left - right)) {
    const tied = [...(grouped.get(priority) ?? [])]
    for (let index = tied.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(rng() * (index + 1))
      const current = tied[index]
      tied[index] = tied[swapIndex]
      tied[swapIndex] = current
    }
    shuffled.push(...tied)
  }
  return shuffled
}

function sampleLowestScored(
  scoredEntries: Array<{ entry: RankedDeployAction; score: number }>,
  rng: RandomSource,
  scoreWindow: number,
): RankedDeployAction {
  const ordered = [...scoredEntries].sort(
    (left, right) => left.score - right.score || left.entry.index - right.entry.index,
  )
  const bestScore = ordered[0]?.score ?? 0
  const candidates = ordered.slice(0, 8).filter((item) => item.score <= bestScore + scoreWindow)
  return weightedChoice(candidates.length ? candidates : ordered.slice(0, 1), rng, (item) => -item.score).entry
}

function sampleRankedAction(ranked: RankedAction[], rng: RandomSource, scoreWindow: number): RankedAction {
  if (ranked.length <= 1) {
    return ranked[0]
  }
  const bestScore = ranked[0].score
  const candidates = ranked.slice(0, 8).filter((entry) => entry.score >= bestScore - scoreWindow)
  return weightedChoice(candidates.length ? candidates : ranked.slice(0, 1), rng, (entry) => entry.score)
}

function weightedChoice<T>(items: T[], rng: RandomSource, score: (item: T) => number): T {
  if (items.length <= 1) {
    return items[0]
  }
  const scores = items.map(score)
  const maxScore = Math.max(...scores)
  const weights = scores.map((value) => Math.exp((value - maxScore) / SOFTMAX_TEMPERATURE))
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

function deploymentUnitPriority(unit: Unit | undefined): number {
  if (!unit) {
    return 99
  }
  if (unit.unit_class === 'Pike') {
    return 0
  }
  if (unit.unit_class === 'Formed') {
    return 1
  }
  if (unit.unit_class === 'Cavalry' || unit.unit_class === 'Elephant' || unit.unit_class === 'Chariot') {
    return 2
  }
  if (unit.leader || unit.unit_class === 'Leader') {
    return 3
  }
  if (unit.kind === 'artillery') {
    return 4
  }
  return 5
}

function deploymentDestinationScore(
  unit: Unit | undefined,
  destination: Coord,
  minX: number,
  maxX: number,
  centerX: number,
  frontY: number,
  supportY: number,
): number {
  const unitClass = unit?.unit_class ?? ''
  const isLeader = unit?.leader ?? false
  const distanceFromCenter = Math.abs(destination.x - centerX)
  const prefersFront = isCombatUnitClass(unitClass) && !isLeader && unit?.kind !== 'artillery'
  const rowScore = destination.y === (prefersFront ? frontY : supportY) ? 0 : 8

  if (isMobileUnitClass(unitClass) && !isLeader) {
    const deploymentWidth = maxX - minX
    const flankTarget = Math.max(2, Math.min(deploymentWidth / 2 - 1, deploymentWidth * 0.32))
    const edgePenalty = destination.x === minX || destination.x === maxX ? 1.5 : 0
    return rowScore + Math.abs(distanceFromCenter - flankTarget) + edgePenalty
  }
  if (unitClass === 'Light') {
    return rowScore + distanceFromCenter * 0.5
  }
  return rowScore + distanceFromCenter
}

function selectBattlePlan(snapshot: GameSnapshot, ranked: RankedAction[], rng: RandomSource): RankedAction[] {
  const selected: RankedAction[] = []
  const usedUnits = new Set<string>()
  let remainingPips = Math.max(0, snapshot.state.pips_remaining || 1)
  const maxOrders = Math.max(1, Math.min(8, remainingPips || 1))
  let remaining = ranked.filter((entry) => entry.action.type !== 'end_bound')
  const endBound = ranked.find((entry) => entry.action.type === 'end_bound') ?? null
  const minimumScore = Math.max(BATTLE_MIN_ACTION_SCORE, endBound ? endBound.score + 0.45 : BATTLE_MIN_ACTION_SCORE)
  while (remaining.length && selected.length < maxOrders) {
    const available = remaining.filter(
      (entry) =>
        !actionUnitIds(entry.action).some((unitId) => usedUnits.has(unitId)) &&
        battlePipCost(entry.action) <= remainingPips,
    )
    if (!available.length) {
      break
    }
    const entry = sampleRankedAction(available, rng, BATTLE_SCORE_WINDOW)
    if (entry.score < minimumScore) {
      break
    }
    const unitIds = actionUnitIds(entry.action)
    selected.push(entry)
    for (const unitId of unitIds) {
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

function deploymentPlacements(selected: RankedAction[]): DeploymentPlacement[] {
  return selected
    .map((entry) => entry.action)
    .filter((action): action is Extract<LegalAction, { type: 'deploy' }> => action.type === 'deploy')
    .map((action) => ({
      unit_id: action.unit_id,
      x: action.destination.x,
      y: action.destination.y,
    }))
}

function selectionConfidence(ranked: RankedAction[]): number {
  if (ranked.length <= 1) {
    return 1
  }
  const gap = ranked[0].score - ranked[1].score
  return Math.max(0.35, Math.min(0.9, 0.5 + Math.tanh(gap / 4) * 0.35))
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
  const activeUnits = units.filter(
    (unit) => unit.army === activeArmy && !unit.eliminated && !unit.off_map,
  )
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
  const nonEndCount = snapshot.legal_actions.filter((legalAction) => legalAction.type !== 'end_bound').length
  add('legal_non_end_count', clippedRatio(nonEndCount, 16))

  const pipCost = actionPipCost(action)
  if (pipCost !== null) {
    add('pip_cost', clippedRatio(pipCost, 4))
    if (phase === 'deployment' || pipCost <= state.pips_remaining) {
      add('pip_affordable')
    } else {
      add('pip_expensive')
    }
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
    if (nonEndCount === 0) {
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
  add(`${prefix}_kind:${unit.kind}`)
  add(`${prefix}_class:${unit.unit_class}`)
  add(`${prefix}_quality:${unit.quality}`)
  add(`${prefix}_formation:${unit.formation_state}`)
  add(`action_${prefix}_kind:${actionType}:${unit.kind}`)
  add(`action_${prefix}_class:${actionType}:${unit.unit_class}`)
  const profile = UNIT_KIND_PROFILES[unit.kind]
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
  const unitProfile = UNIT_KIND_PROFILES[unit.kind]
  const targetProfile = UNIT_KIND_PROFILES[target.kind]
  const unitClose = targetProfile.mounted ? unitProfile.closeVsMounted : unitProfile.closeVsFoot
  const targetClose = unitProfile.mounted ? targetProfile.closeVsMounted : targetProfile.closeVsFoot
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

  if (unitProfile.missileRange > 0) {
    const missileAdvantage = clamp((unitProfile.missileStrength - targetProfile.missileDefense) / 4, -1, 1)
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
    if (['Pike', 'Formed', 'Cavalry', 'Elephant', 'Chariot'].includes(unit.unit_class)) {
      add('deploy_combat_unit')
    }
    if (unit.unit_class === 'Leader') {
      add('deploy_leader')
    }
    if (unit.kind === 'artillery') {
      add('deploy_artillery')
    }
    const profile = UNIT_KIND_PROFILES[unit.kind]
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

  const profile = UNIT_KIND_PROFILES[unit.kind]
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

function chargeStepData(
  action: Extract<LegalAction, { type: 'charge' | 'group_charge' }>,
): Array<{ unitId: string; targetId: string; destination: Coord | null; aspect: string }> {
  if (action.type === 'group_charge') {
    return action.steps.map((step) => ({
      unitId: step.unit_id,
      targetId: step.target_id,
      destination: step.destination,
      aspect: 'front',
    }))
  }
  return [
    {
      unitId: action.unit_id,
      targetId: action.target_id,
      destination: action.destination,
      aspect: action.aspect,
    },
  ]
}

function movementStepData(
  action: Extract<LegalAction, { type: 'move' | 'march_move' | 'group_move' | 'group_march_move' }>,
): Array<{ unitId: string; destination: Coord | null }> {
  if (action.type === 'group_move' || action.type === 'group_march_move') {
    return action.steps.map((step) => ({ unitId: step.unit_id, destination: step.destination }))
  }
  return [{ unitId: action.unit_id, destination: actionDestination(action) }]
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

function unitById(snapshot: GameSnapshot, unitId: string): Unit | null {
  return snapshot.state.units.find((unit) => unit.id === unitId) ?? null
}

function liveUnits(snapshot: GameSnapshot, army: string): Unit[] {
  return snapshot.state.units.filter(
    (unit) => unit.army === army && !unit.eliminated && !unit.off_map && unit.deployed,
  )
}

function enemyArmy(army: string): string {
  return army === 'A' ? 'B' : 'A'
}

function closeMatchupDelta(unit: Unit, target: Unit): number {
  const unitProfile = UNIT_KIND_PROFILES[unit.kind]
  const targetProfile = UNIT_KIND_PROFILES[target.kind]
  const unitClose = targetProfile.mounted ? unitProfile.closeVsMounted : unitProfile.closeVsFoot
  const targetClose = unitProfile.mounted ? targetProfile.closeVsMounted : targetProfile.closeVsFoot
  return unitClose - targetClose
}

function adjacentUnitCount(position: Coord, units: Unit[], skipIds = new Set<string>()): number {
  return units.filter(
    (unit) =>
      !skipIds.has(unit.id) &&
      Math.abs(position.x - unit.position.x) + Math.abs(position.y - unit.position.y) === 1,
  ).length
}

function nearestUnitDistance(position: Coord, units: Unit[], skipIds = new Set<string>()): number | null {
  let nearest: number | null = null
  for (const unit of units) {
    if (skipIds.has(unit.id)) {
      continue
    }
    const distance = Math.abs(position.x - unit.position.x) + Math.abs(position.y - unit.position.y)
    nearest = nearest === null ? distance : Math.min(nearest, distance)
  }
  return nearest
}

function enemyChargeThreatCount(position: Coord, units: Unit[], skipIds = new Set<string>()): number {
  let threats = 0
  for (const unit of units) {
    if (skipIds.has(unit.id)) {
      continue
    }
    const profile = UNIT_KIND_PROFILES[unit.kind]
    if (profile.movement <= 0) {
      continue
    }
    const distance = Math.abs(position.x - unit.position.x) + Math.abs(position.y - unit.position.y)
    if (distance <= Math.max(2, profile.movement)) {
      threats += 1
    }
  }
  return threats
}

function attritionForArmy(snapshot: GameSnapshot, army: string): { losses: number; targetLosses: number } {
  const status = snapshot.state.attrition_status.find((candidate) => candidate.army === army)
  return { losses: status?.losses ?? 0, targetLosses: status?.target_losses ?? 0 }
}

function battleScoreForArmy(snapshot: GameSnapshot, army: string): number {
  return snapshot.state.battle_scores.find((candidate) => candidate.army === army)?.total ?? 0
}

function pendingShotValue(snapshot: GameSnapshot, army: string): number {
  const unitsById = new Map(snapshot.state.units.map((unit) => [unit.id, unit]))
  let value = 0
  for (const shot of snapshot.state.pending_shots ?? []) {
    const shooter = unitsById.get(shot.unit_id)
    const target = unitsById.get(shot.target_id)
    if (!shooter || !target) {
      continue
    }
    const shotValue = 0.6 + Math.max(0, closeMatchupDelta(shooter, target)) * 0.1
    value += shooter.army === army ? shotValue : -shotValue
  }
  return value
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

function isCombatUnitClass(unitClass: string): boolean {
  return ['Pike', 'Formed', 'Cavalry', 'Elephant', 'Chariot'].includes(unitClass)
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
