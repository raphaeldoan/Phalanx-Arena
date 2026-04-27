import { resolveBrowserAiAction, requestBrowserAiSelection } from './browserAi'
import { describeAction, materializeAction } from './battlefieldShared'
import { requestNeuralPolicyAiSelection } from './neuralPolicyAi'
import { requestSimpleAiSelection } from './simpleAi'
import type { GameClient } from './gameClient'
import type { BrowserAiProviderName } from './aiProviders'
import { STRATEGOS_1_MODEL_ID, type LocalAiModelId } from './aiSession'
import type { Action, AiTurnResponse, ArmyId, Coord, DeployActionOption, GameSnapshot, LegalAction } from './types'

export const AUTO_END_BOUND_MODEL = 'system:auto-end-bound'
export const AI_BATCH_ACTION_INTERVAL_MS = 1000

export function shouldAutoEndBound(snapshot: GameSnapshot): boolean {
  return (
    snapshot.state.phase === 'battle' &&
    snapshot.state.pips_remaining === 0 &&
    snapshot.legal_actions.length === 1 &&
    snapshot.legal_actions[0]?.type === 'end_bound'
  )
}

export interface RunAiTurnInput {
  snapshot: GameSnapshot
  activeArmy: ArmyId
  gameClient: GameClient
  browserAiApiKey: string
  activeBrowserAiProvider: BrowserAiProviderName
  activeBrowserAiBaseUrl: string
  activeBrowserAiModel: string
  localSimpleAi?: boolean
  localAiModel?: LocalAiModelId
  currentIntent: string
  onDecision?: (decision: AiTurnDecision) => void | Promise<void>
  onWillResolveAction?: (
    snapshot: GameSnapshot,
    legalAction: LegalAction,
    action: Action,
    appliedCount: number,
  ) => void | Promise<void>
  onResolvedAction?: (snapshot: GameSnapshot, action: Action, appliedCount: number) => void | Promise<void>
  resolvedActionIntervalMs?: number
}

export interface AiTurnDecision {
  actionSummary: string
  confidence: number
  intent_update: string | null
  model: string
  prompt_text: string
  reasoning: string
  usage: AiTurnResponse['usage']
  visual_observations: string
}

export async function runAiTurn(input: RunAiTurnInput): Promise<AiTurnResponse> {
  const {
    snapshot,
    activeArmy,
    gameClient,
    browserAiApiKey,
    activeBrowserAiProvider,
    activeBrowserAiBaseUrl,
    activeBrowserAiModel,
    localSimpleAi = false,
    localAiModel,
    currentIntent,
    onDecision,
    onWillResolveAction,
    onResolvedAction,
    resolvedActionIntervalMs = AI_BATCH_ACTION_INTERVAL_MS,
  } = input

  if (shouldAutoEndBound(snapshot)) {
    const appliedAction: Action = { type: 'end_bound' }
    const nextSnapshot = await gameClient.submitAction(snapshot.state.game_id, appliedAction)
    return {
      snapshot: nextSnapshot,
      applied_action: appliedAction,
      applied_action_index: 0,
      applied_action_summary: describeAction(snapshot.legal_actions[0]),
      input_mode_used: 'text_only',
      prompt_text: '',
      reasoning: `No model call was made because army ${activeArmy} had 0 PIPs remaining, so end_bound was the only legal battle action.`,
      visual_observations: '',
      confidence: 1,
      model: AUTO_END_BOUND_MODEL,
      usage: null,
      intent_update: null,
    }
  }

  const canUpdateIntent = canUpdateAiIntent(snapshot, activeArmy, currentIntent)
  const deploymentBatch = snapshot.state.phase === 'deployment'
  const battleBatch = snapshot.state.phase === 'battle'
  const selection = localSimpleAi
    ? localAiModel === STRATEGOS_1_MODEL_ID
      ? await requestSimpleAiSelection({
          battleBatch,
          deploymentBatch,
          gameClient,
          snapshot,
        })
      : await requestNeuralPolicyAiSelection({
          battleBatch,
          deploymentBatch,
          snapshot,
        })
    : await requestBrowserAiSelection({
        actionHistory: (await gameClient.fetchReplay(snapshot.state.game_id)).actions,
        apiKey: browserAiApiKey.trim(),
        baseUrl: activeBrowserAiBaseUrl,
        canUpdateIntent,
        currentIntent,
        deploymentBatch,
        battleBatch,
        legalActions: snapshot.legal_actions,
        model: activeBrowserAiModel,
        provider: activeBrowserAiProvider,
        snapshot,
      })
  await onDecision?.({
    actionSummary: describeAiSelectionSummary(snapshot, selection.actionSummary, selection.actionIndices, selection.placements),
    confidence: selection.confidence,
    intent_update: selection.intentUpdate,
    model: selection.model,
    prompt_text: selection.promptText,
    reasoning: selection.reasoning,
    usage: selection.usage,
    visual_observations: selection.visualObservations,
  })
  if (deploymentBatch) {
    const deploymentResult = await applyBrowserAiDeploymentBatch(
      gameClient,
      snapshot,
      selection.placements,
      selection.actionIndices,
      onWillResolveAction,
      onResolvedAction,
      resolvedActionIntervalMs,
    )
    return {
      snapshot: deploymentResult.snapshot,
      applied_action: deploymentResult.firstAction,
      applied_action_index: deploymentResult.firstActionIndex,
      applied_action_summary: `deployment batch: ${deploymentResult.appliedCount} actions`,
      input_mode_used: 'text_only',
      prompt_text: selection.promptText,
      reasoning: selection.reasoning,
      visual_observations: selection.visualObservations,
      confidence: selection.confidence,
      model: selection.model,
      usage: selection.usage,
      intent_update: selection.intentUpdate,
    }
  }
  if (battleBatch) {
    const battleResult = await applyBrowserAiBattleBatch(
      gameClient,
      snapshot,
      selection.actionIndices,
      onWillResolveAction,
      onResolvedAction,
      resolvedActionIntervalMs,
    )
    return {
      snapshot: battleResult.snapshot,
      applied_action: battleResult.firstAction,
      applied_action_index: battleResult.firstActionIndex,
      applied_action_summary: `bound plan: ${battleResult.appliedCount} actions`,
      input_mode_used: 'text_only',
      prompt_text: selection.promptText,
      reasoning: selection.reasoning,
      visual_observations: selection.visualObservations,
      confidence: selection.confidence,
      model: selection.model,
      usage: selection.usage,
      intent_update: selection.intentUpdate,
    }
  }
  const appliedAction = await resolveBrowserAiAction(snapshot.legal_actions, selection)
  const nextSnapshot = await gameClient.submitAction(snapshot.state.game_id, appliedAction)
  return {
    snapshot: nextSnapshot,
    applied_action: appliedAction,
    applied_action_index: selection.actionIndex,
    applied_action_summary: selection.actionSummary,
    input_mode_used: 'text_only',
    prompt_text: selection.promptText,
    reasoning: selection.reasoning,
    visual_observations: selection.visualObservations,
    confidence: selection.confidence,
    model: selection.model,
    usage: selection.usage,
    intent_update: selection.intentUpdate,
  }
}

function describeAiSelectionSummary(
  snapshot: GameSnapshot,
  actionSummary: string,
  actionIndices: number[],
  placements: Array<{ unit_id: string; x: number; y: number }>,
): string {
  if (snapshot.state.phase === 'deployment') {
    const plannedCount = Math.max(placements.length, actionIndices.length)
    return plannedCount ? `deployment plan: ${plannedCount} ${plannedCount === 1 ? 'choice' : 'choices'}` : 'deployment plan selected'
  }
  if (snapshot.state.phase === 'battle') {
    const plannedOrders = actionIndices.filter((actionIndex) => snapshot.legal_actions[actionIndex]?.type !== 'end_bound').length
    return plannedOrders ? `bound plan: ${plannedOrders} ${plannedOrders === 1 ? 'order' : 'orders'}` : 'bound plan selected'
  }
  return actionSummary
}

interface BattleBatchResult {
  snapshot: GameSnapshot
  firstAction: Action
  firstActionIndex: number
  appliedCount: number
}

async function applyBrowserAiBattleBatch(
  gameClient: GameClient,
  initialSnapshot: GameSnapshot,
  selectedActionIndices: number[],
  onWillResolveAction: RunAiTurnInput['onWillResolveAction'],
  onResolvedAction: RunAiTurnInput['onResolvedAction'],
  resolvedActionIntervalMs: number,
): Promise<BattleBatchResult> {
  let snapshot = initialSnapshot
  let firstAction: Action | null = null
  let firstActionIndex = selectedActionIndices[0] ?? 0
  let appliedCount = 0

  for (const actionIndex of selectedActionIndices) {
    if (snapshot.state.phase !== 'battle') {
      break
    }
    const selectedLegalAction = initialSnapshot.legal_actions[actionIndex]
    if (!selectedLegalAction) {
      continue
    }
    const selectedAction = materializeAction(selectedLegalAction)
    if (selectedAction.type === 'end_bound') {
      break
    }
    const currentLegalAction = findMatchingLegalAction(snapshot.legal_actions, selectedAction)
    if (!currentLegalAction) {
      continue
    }
    const action = materializeAction(currentLegalAction)
    appliedCount += 1
    await publishPendingActionStep(
      snapshot,
      currentLegalAction,
      action,
      appliedCount,
      onWillResolveAction,
      resolvedActionIntervalMs,
    )
    snapshot = await gameClient.submitAction(snapshot.state.game_id, action)
    if (!firstAction) {
      firstAction = action
      firstActionIndex = actionIndex
    }
    await publishResolvedActionStep(
      snapshot,
      action,
      appliedCount,
      onResolvedAction,
      onWillResolveAction ? 0 : resolvedActionIntervalMs,
    )
  }

  if (snapshot.state.phase === 'battle') {
    const endBoundAction = snapshot.legal_actions.find((action) => action.type === 'end_bound')
    if (endBoundAction) {
      const action = materializeAction(endBoundAction)
      appliedCount += 1
      await publishPendingActionStep(
        snapshot,
        endBoundAction,
        action,
        appliedCount,
        onWillResolveAction,
        resolvedActionIntervalMs,
      )
      snapshot = await gameClient.submitAction(snapshot.state.game_id, action)
      firstAction ??= action
      await publishResolvedActionStep(
        snapshot,
        action,
        appliedCount,
        onResolvedAction,
        onWillResolveAction ? 0 : resolvedActionIntervalMs,
      )
    }
  }

  if (!firstAction) {
    throw new Error('Browser AI bound plan did not produce any legal battle action.')
  }

  return {
    snapshot,
    firstAction,
    firstActionIndex,
    appliedCount,
  }
}

interface DeploymentBatchResult {
  snapshot: GameSnapshot
  firstAction: Action
  firstActionIndex: number
  appliedCount: number
}

async function applyBrowserAiDeploymentBatch(
  gameClient: GameClient,
  initialSnapshot: GameSnapshot,
  placements: Array<{ unit_id: string; x: number; y: number }>,
  selectedActionIndices: number[],
  onWillResolveAction: RunAiTurnInput['onWillResolveAction'],
  onResolvedAction: RunAiTurnInput['onResolvedAction'],
  resolvedActionIntervalMs: number,
): Promise<DeploymentBatchResult> {
  let snapshot = initialSnapshot
  let firstAction: Action | null = null
  let firstActionIndex = selectedActionIndices[0] ?? 0
  let appliedCount = 0
  let finalized = false
  const usedUnitIds = new Set<string>()

  for (const placement of placements) {
    if (snapshot.state.phase !== 'deployment') {
      break
    }
    const currentLegalAction = findMatchingDeploymentPlacementLegalAction(
      snapshot.legal_actions,
      placement,
      snapshot,
      usedUnitIds,
    )
    if (!currentLegalAction) {
      continue
    }
    const action = materializeAction(currentLegalAction)
    usedUnitIds.add(currentLegalAction.unit_id)
    appliedCount += 1
    await publishPendingActionStep(
      snapshot,
      currentLegalAction,
      action,
      appliedCount,
      onWillResolveAction,
      resolvedActionIntervalMs,
    )
    snapshot = await gameClient.submitAction(snapshot.state.game_id, action)
    if (!firstAction) {
      firstAction = action
      firstActionIndex = 0
    }
    await publishResolvedActionStep(
      snapshot,
      action,
      appliedCount,
      onResolvedAction,
      onWillResolveAction ? 0 : resolvedActionIntervalMs,
    )
  }

  for (const actionIndex of selectedActionIndices) {
    if (snapshot.state.phase !== 'deployment') {
      break
    }
    const selectedLegalAction = initialSnapshot.legal_actions[actionIndex]
    if (!selectedLegalAction) {
      continue
    }
    const selectedAction = materializeAction(selectedLegalAction)
    if (selectedAction.type === 'deploy') {
      if (usedUnitIds.has(selectedAction.unit_id)) {
        continue
      }
      const currentLegalAction = findMatchingDeploymentLegalAction(snapshot.legal_actions, selectedAction)
      if (!currentLegalAction) {
        continue
      }
      const action = materializeAction(currentLegalAction)
      usedUnitIds.add(selectedAction.unit_id)
      appliedCount += 1
      await publishPendingActionStep(
        snapshot,
        currentLegalAction,
        action,
        appliedCount,
        onWillResolveAction,
        resolvedActionIntervalMs,
      )
      snapshot = await gameClient.submitAction(snapshot.state.game_id, action)
      if (!firstAction) {
        firstAction = action
        firstActionIndex = actionIndex
      }
      await publishResolvedActionStep(
        snapshot,
        action,
        appliedCount,
        onResolvedAction,
        onWillResolveAction ? 0 : resolvedActionIntervalMs,
      )
      continue
    }
    if (selectedAction.type === 'finalize_deployment') {
      const currentLegalAction = snapshot.legal_actions.find((action) => action.type === 'finalize_deployment')
      if (!currentLegalAction) {
        continue
      }
      const action = materializeAction(currentLegalAction)
      appliedCount += 1
      await publishPendingActionStep(
        snapshot,
        currentLegalAction,
        action,
        appliedCount,
        onWillResolveAction,
        resolvedActionIntervalMs,
      )
      snapshot = await gameClient.submitAction(snapshot.state.game_id, action)
      if (!firstAction) {
        firstAction = action
        firstActionIndex = actionIndex
      }
      finalized = true
      await publishResolvedActionStep(
        snapshot,
        action,
        appliedCount,
        onResolvedAction,
        onWillResolveAction ? 0 : resolvedActionIntervalMs,
      )
      break
    }
  }

  while (snapshot.state.phase === 'deployment') {
    const reserveUnit = snapshot.state.units
      .filter((unit) => unit.army === snapshot.state.current_player && !unit.eliminated && !unit.deployed)
      .sort((left, right) => left.id.localeCompare(right.id))[0]
    if (!reserveUnit) {
      break
    }
    const deployAction = snapshot.legal_actions.find(
      (action) => action.type === 'deploy' && action.unit_id === reserveUnit.id,
    )
    if (!deployAction) {
      break
    }
    const action = materializeAction(deployAction)
    appliedCount += 1
    await publishPendingActionStep(
      snapshot,
      deployAction,
      action,
      appliedCount,
      onWillResolveAction,
      resolvedActionIntervalMs,
    )
    snapshot = await gameClient.submitAction(snapshot.state.game_id, action)
    firstAction ??= action
    await publishResolvedActionStep(
      snapshot,
      action,
      appliedCount,
      onResolvedAction,
      onWillResolveAction ? 0 : resolvedActionIntervalMs,
    )
  }

  if (!finalized && snapshot.state.phase === 'deployment') {
    const finalizeAction = snapshot.legal_actions.find((action) => action.type === 'finalize_deployment')
    if (finalizeAction) {
      const action = materializeAction(finalizeAction)
      appliedCount += 1
      await publishPendingActionStep(
        snapshot,
        finalizeAction,
        action,
        appliedCount,
        onWillResolveAction,
        resolvedActionIntervalMs,
      )
      snapshot = await gameClient.submitAction(snapshot.state.game_id, action)
      firstAction ??= action
      await publishResolvedActionStep(
        snapshot,
        action,
        appliedCount,
        onResolvedAction,
        onWillResolveAction ? 0 : resolvedActionIntervalMs,
      )
    }
  }

  if (!firstAction) {
    throw new Error('Browser AI deployment batch did not produce any legal deployment action.')
  }

  return {
    snapshot,
    firstAction,
    firstActionIndex,
    appliedCount,
  }
}

async function publishPendingActionStep(
  snapshot: GameSnapshot,
  legalAction: LegalAction,
  action: Action,
  appliedCount: number,
  onWillResolveAction: RunAiTurnInput['onWillResolveAction'],
  resolvedActionIntervalMs: number,
): Promise<void> {
  if (!onWillResolveAction) {
    return
  }
  await onWillResolveAction(snapshot, legalAction, action, appliedCount)
  if (resolvedActionIntervalMs > 0) {
    await delay(resolvedActionIntervalMs)
  }
}

async function publishResolvedActionStep(
  snapshot: GameSnapshot,
  action: Action,
  appliedCount: number,
  onResolvedAction: RunAiTurnInput['onResolvedAction'],
  resolvedActionIntervalMs: number,
): Promise<void> {
  if (!onResolvedAction) {
    return
  }
  await onResolvedAction(snapshot, action, appliedCount)
  if (resolvedActionIntervalMs > 0) {
    await delay(resolvedActionIntervalMs)
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function findMatchingLegalAction(legalActions: LegalAction[], action: Action): LegalAction | null {
  return (
    legalActions.find((candidate) => JSON.stringify(materializeAction(candidate)) === JSON.stringify(action)) ?? null
  )
}

function findMatchingDeploymentLegalAction(legalActions: LegalAction[], action: Action): LegalAction | null {
  if (action.type === 'deploy') {
    return (
      legalActions.find(
        (candidate) =>
          candidate.type === 'deploy' &&
          candidate.unit_id === action.unit_id &&
          candidate.destination.x === action.destination.x &&
          candidate.destination.y === action.destination.y,
      ) ?? null
    )
  }
  if (action.type === 'finalize_deployment') {
    return legalActions.find((candidate) => candidate.type === 'finalize_deployment') ?? null
  }
  return null
}

function findMatchingDeploymentPlacementLegalAction(
  legalActions: LegalAction[],
  placement: { unit_id: string; x: number; y: number },
  snapshot: GameSnapshot,
  usedUnitIds: Set<string>,
): DeployActionOption | null {
  const unitIds = deploymentCandidateUnitIds(placement.unit_id, snapshot.state.current_player)
  const coordinates = deploymentCandidateCoordinates(placement.x, placement.y, snapshot)
  for (const unitId of unitIds) {
    if (usedUnitIds.has(unitId)) {
      continue
    }
    for (const coordinate of coordinates) {
      const legalAction = legalActions.find(
        (candidate): candidate is DeployActionOption =>
          candidate.type === 'deploy' &&
          candidate.unit_id === unitId &&
          candidate.destination.x === coordinate.x &&
          candidate.destination.y === coordinate.y,
      )
      if (legalAction) {
        return legalAction
      }
    }
  }
  return null
}

function deploymentCandidateUnitIds(unitId: string, army: ArmyId): string[] {
  const normalized = unitId.trim()
  if (!normalized) {
    return []
  }
  const enemy = army === 'A' ? 'B' : 'A'
  return uniqueStrings([
    normalized,
    normalized.startsWith('SELF-') ? `${army}-${normalized.slice('SELF-'.length)}` : null,
    normalized.startsWith('ENEMY-') ? `${enemy}-${normalized.slice('ENEMY-'.length)}` : null,
  ])
}

function deploymentCandidateCoordinates(x: number, y: number, snapshot: GameSnapshot): Coord[] {
  const candidates: Coord[] = [{ x, y }]
  if (snapshot.state.current_player === 'B') {
    const localAsGlobal = {
      x: snapshot.state.board_width - 1 - x,
      y: snapshot.state.board_height - 1 - y,
    }
    if (!candidates.some((candidate) => candidate.x === localAsGlobal.x && candidate.y === localAsGlobal.y)) {
      candidates.push(localAsGlobal)
    }
  }
  return candidates
}

function uniqueStrings(values: Array<string | null>): string[] {
  const unique: string[] = []
  for (const value of values) {
    if (value && !unique.includes(value)) {
      unique.push(value)
    }
  }
  return unique
}

export function canUpdateAiIntent(snapshot: GameSnapshot, army: ArmyId, currentIntent: string): boolean {
  if (snapshot.state.current_player !== army) {
    return false
  }
  if (snapshot.state.phase === 'deployment') {
    return currentIntent.trim().length === 0
  }
  if (snapshot.state.phase !== 'battle') {
    return false
  }
  if (snapshot.state.pips_remaining !== snapshot.state.last_pip_roll) {
    return false
  }
  return !snapshot.state.units.some(
    (unit) => unit.army === army && !unit.eliminated && unit.activated_this_bound,
  )
}
