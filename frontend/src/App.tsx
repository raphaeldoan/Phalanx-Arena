import { Suspense, lazy, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import './App.css'
import {
  buildBattlefieldInteractionModel,
  resolveCellClick,
} from './battlefieldInteraction'
import {
  controlsArmy,
  describeAction,
  describeAiController,
  formatArmyDisplayName,
  formatActionWarning,
  isGameFinished,
  resolutionKey,
  type AiController,
} from './battlefieldShared'
import { createGameClient } from './gameClient'
import {
  STRATEGOS_1_MODEL_ID,
  STRATEGOS_2_MODEL_ID,
  isLocalAiAccessMode,
  summarizeAiTurnHistory,
  type AiLiveDecision,
  type AiTurnRecord,
  type AiTurnUsageTotals,
} from './aiSession'
import {
  SUPPORTED_BROWSER_AI_PROVIDERS,
  browserAiApiKeyPlaceholder,
  browserAiModelPlaceholder,
  providerDisplayName,
} from './aiProviders'
import { runAiTurn, shouldAutoEndBound } from './aiOrchestrator'
import {
  clearStoredMultiplayerSession,
  connectMultiplayerSession,
  createMultiplayerRoom,
  joinMultiplayerRoom,
  loadStoredMultiplayerSession,
  restoreMultiplayerSession,
  storeMultiplayerSession,
  type MultiplayerConnection,
  type MultiplayerRoomStatus,
  type MultiplayerSession,
} from './multiplayerClient'
import { CombatCallout } from './CombatCallout'
import {
  buildCombatCalloutLayout,
  type CombatCalloutLayout,
} from './combatCalloutLayout'
import { DeploymentIntroModal, TurnIntroModal, WinnerModal } from './app/BattleModals'
import { BattlefieldHudMenus, CommanderChatPanel, DeploymentDock } from './app/BattlefieldPanels'
import { useBrowserAiSettings } from './hooks/useBrowserAiSettings'
import type {
  Action,
  ArmyId,
  CombatResolution,
  Coord,
  DeployActionOption,
  GameSnapshot,
  LegalAction,
  ScenarioSummary,
  Unit,
} from './types'

const Battlefield3D = lazy(() => import('./Battlefield3D'))
const DEFAULT_SCENARIO_ID = 'classic_battle'
const APP_VERSION = __PHALANX_APP_VERSION__
const LOGO_TEXT_URL = `${import.meta.env.BASE_URL}logo-text.png`
const PROJECT_ARTICLE_URL = 'https://vestigia.org/phalanxarena/intro'

type ResolutionBatch = {
  key: string
  resolutions: CombatResolution[]
}

type MultiplayerSessionState = Omit<MultiplayerSession, 'snapshot'>
type PlayMode = 'single_player' | 'local_multiplayer' | 'online_multiplayer'

const EMPTY_COMBAT_RESOLUTIONS: CombatResolution[] = []
const PLAY_MODE_OPTIONS: Array<{ description: string; id: PlayMode; kicker: string; title: string }> = [
  {
    description: 'Command one army while AI (the default one or any LLM) handles the opposing side.',
    id: 'single_player',
    kicker: 'Against AI',
    title: 'Single Player',
  },
  {
    description: 'Control both armies on this device with AI disabled.',
    id: 'local_multiplayer',
    kicker: 'Hotseat',
    title: 'Local Multiplayer',
  },
  {
    description: 'Host or join an online duel with a friend.',
    id: 'online_multiplayer',
    kicker: 'Invite Code',
    title: 'Online Multiplayer',
  },
]

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

function formatUsd(value: number): string {
  if (value >= 1) {
    return `$${value.toFixed(2)}`
  }
  if (value >= 0.01) {
    return `$${value.toFixed(3)}`
  }
  return `$${value.toFixed(4)}`
}

function formatSessionTokenCount(summary: AiTurnUsageTotals): string {
  if (!summary.turnCount) {
    return '-'
  }
  if (!summary.trackedTurns) {
    return 'n/a'
  }
  return formatTokenCount(summary.totalTokens)
}

function formatSessionCost(summary: AiTurnUsageTotals): string {
  if (!summary.turnCount) {
    return '-'
  }
  if (!summary.pricedTurns || summary.totalCostUsd === null) {
    return 'n/a'
  }
  return formatUsd(summary.totalCostUsd)
}

function buildDeploymentActionsByUnit(actions: LegalAction[]): Map<string, DeployActionOption[]> {
  const actionsByUnit = new Map<string, DeployActionOption[]>()
  for (const action of actions) {
    if (action.type !== 'deploy') {
      continue
    }
    const unitActions = actionsByUnit.get(action.unit_id) ?? []
    unitActions.push(action)
    actionsByUnit.set(action.unit_id, unitActions)
  }
  return actionsByUnit
}

function compareDeploymentUnits(left: Unit, right: Unit): number {
  if (left.deployed !== right.deployed) {
    return left.deployed ? 1 : -1
  }
  return left.id.localeCompare(right.id)
}

function coordKey(coord: Coord): string {
  return `${coord.x},${coord.y}`
}

function buildAutoDeploymentActions(
  units: Unit[],
  deploymentActionsByUnit: Map<string, DeployActionOption[]>,
  currentPlayer: ArmyId,
): Action[] {
  const reserveUnits = units.filter((unit) => !unit.deployed)
  if (!reserveUnits.length) {
    return []
  }

  const allDestinations = [...deploymentActionsByUnit.values()].flatMap((actions) => actions.map((action) => action.destination))
  if (!allDestinations.length) {
    return []
  }

  const minY = Math.min(...allDestinations.map((coord) => coord.y))
  const maxY = Math.max(...allDestinations.map((coord) => coord.y))
  const minX = Math.min(...allDestinations.map((coord) => coord.x))
  const maxX = Math.max(...allDestinations.map((coord) => coord.x))
  const centerX = (minX + maxX) / 2
  const frontY = currentPlayer === 'A' ? minY : maxY
  const supportY = currentPlayer === 'A' ? maxY : minY
  const assignedDestinations = new Set<string>()
  const orderedUnits = [...reserveUnits].sort(compareAutoDeploymentUnits)
  const actions: Action[] = []

  for (const unit of orderedUnits) {
    const preferredAction = (deploymentActionsByUnit.get(unit.id) ?? [])
      .filter((action) => !assignedDestinations.has(coordKey(action.destination)))
      .sort((left, right) => {
        const leftScore = scoreAutoDeploymentDestination(unit, left.destination, minX, maxX, centerX, frontY, supportY)
        const rightScore = scoreAutoDeploymentDestination(unit, right.destination, minX, maxX, centerX, frontY, supportY)
        return leftScore - rightScore || left.destination.x - right.destination.x || left.destination.y - right.destination.y
      })[0]

    if (!preferredAction) {
      continue
    }

    assignedDestinations.add(coordKey(preferredAction.destination))
    actions.push({
      type: 'deploy',
      unit_id: preferredAction.unit_id,
      destination: preferredAction.destination,
    })
  }

  return actions
}

function compareAutoDeploymentUnits(left: Unit, right: Unit): number {
  return autoDeploymentUnitPriority(left) - autoDeploymentUnitPriority(right) || left.id.localeCompare(right.id)
}

function autoDeploymentUnitPriority(unit: Unit): number {
  if (unit.unit_class === 'Pike') {
    return 0
  }
  if (unit.unit_class === 'Formed') {
    return 1
  }
  if (unit.unit_class === 'Cavalry' || unit.unit_class === 'Elephant' || unit.unit_class === 'Chariot') {
    return 2
  }
  if (unit.unit_class === 'Leader') {
    return 3
  }
  if (unit.kind === 'artillery') {
    return 4
  }
  return 5
}

function scoreAutoDeploymentDestination(
  unit: Unit,
  destination: Coord,
  minX: number,
  maxX: number,
  centerX: number,
  frontY: number,
  supportY: number,
): number {
  const distanceFromCenter = Math.abs(destination.x - centerX)
  const prefersFront =
    unit.unit_class === 'Pike' ||
    unit.unit_class === 'Formed' ||
    unit.unit_class === 'Cavalry' ||
    unit.unit_class === 'Elephant' ||
    unit.unit_class === 'Chariot'
  const rowScore = destination.y === (prefersFront ? frontY : supportY) ? 0 : 8

  if (unit.unit_class === 'Cavalry' || unit.unit_class === 'Elephant' || unit.unit_class === 'Chariot') {
    const deploymentWidth = maxX - minX
    const flankTarget = Math.max(2, Math.min(deploymentWidth / 2 - 1, deploymentWidth * 0.32))
    const edgePenalty = destination.x === minX || destination.x === maxX ? 1.5 : 0
    return rowScore + Math.abs(distanceFromCenter - flankTarget) + edgePenalty
  }

  if (unit.unit_class === 'Light') {
    return rowScore + distanceFromCenter * 0.5
  }

  return rowScore + distanceFromCenter
}

function toMultiplayerSessionState(session: MultiplayerSession): MultiplayerSessionState {
  return {
    army: session.army,
    room_code: session.room_code,
    seats: session.seats,
    status: session.status,
    token: session.token,
  }
}

function normalizeRoomCodeInput(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
}

function formatMultiplayerStatus(status: MultiplayerRoomStatus): string {
  if (status === 'waiting') {
    return 'Waiting for opponent'
  }
  if (status === 'finished') {
    return 'Finished'
  }
  return 'Active'
}

function createOnlineSeed(): number {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return values[0] || 1
}

function opponentArmy(army: ArmyId): ArmyId {
  return army === 'A' ? 'B' : 'A'
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function App() {
  const resolutionModalRef = useRef<HTMLDivElement | null>(null)
  const lastBattleTurnKeyRef = useRef<string | null>(null)
  const multiplayerConnectionRef = useRef<MultiplayerConnection | null>(null)
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null)
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([])
  const [selectedScenarioId, setSelectedScenarioId] = useState(DEFAULT_SCENARIO_ID)
  const [joinRoomCode, setJoinRoomCode] = useState('')
  const [isMultiplayerPending, setIsMultiplayerPending] = useState(false)
  const [isMultiplayerConnected, setIsMultiplayerConnected] = useState(false)
  const [multiplayerSession, setMultiplayerSession] = useState<MultiplayerSessionState | null>(null)
  const [multiplayerStatus, setMultiplayerStatus] = useState<string | null>(null)
  const [copiedRoomCode, setCopiedRoomCode] = useState<string | null>(null)
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([])
  const [previewAction, setPreviewAction] = useState<LegalAction | null>(null)
  const [modalResolutionIndex, setModalResolutionIndex] = useState<number | null>(null)
  const [dismissedResolutionBatchKey, setDismissedResolutionBatchKey] = useState<string | null>(null)
  const [visibleResolutionBatch, setVisibleResolutionBatch] = useState<ResolutionBatch | null>(null)
  const [dismissedWinnerModalKey, setDismissedWinnerModalKey] = useState<string | null>(null)
  const [dismissedDeploymentModalKeys, setDismissedDeploymentModalKeys] = useState<string[]>([])
  const [dismissedTurnModalKeys, setDismissedTurnModalKeys] = useState<string[]>([])
  const [pendingTurnModalKey, setPendingTurnModalKey] = useState<string | null>(null)
  const [aiController, setAiController] = useState<AiController>('B')
  const {
    browserAiAccessMode,
    setBrowserAiAccessMode,
    browserAiApiKey,
    setBrowserAiApiKey,
    setBrowserAiProvider,
    browserAiBaseUrl,
    setBrowserAiBaseUrl,
    browserAiModel,
    setBrowserAiModel,
    activeBrowserAiProvider,
    activeBrowserAiModel,
    activeBrowserAiBaseUrl,
    browserAiReady,
  } = useBrowserAiSettings()
  const [isAiPending, setIsAiPending] = useState(false)
  const [isAiThinking, setIsAiThinking] = useState(false)
  const [isAutoDeploying, setIsAutoDeploying] = useState(false)
  const [aiStatus, setAiStatus] = useState<string | null>(null)
  const [liveAiDecision, setLiveAiDecision] = useState<AiLiveDecision | null>(null)
  const [lastAiTurn, setLastAiTurn] = useState<AiTurnRecord | null>(null)
  const [aiTurnHistory, setAiTurnHistory] = useState<AiTurnRecord[]>([])
  const [aiIntents, setAiIntents] = useState<Record<ArmyId, string>>({ A: '', B: '' })
  const [error, setError] = useState<string | null>(null)
  const [combatCalloutLayout, setCombatCalloutLayout] = useState<CombatCalloutLayout | null>(null)
  const [projectedCombatAnchor, setProjectedCombatAnchor] = useState<{ x: number; y: number } | null>(null)
  const [battlefield3DLoadPhase, setBattlefield3DLoadPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [hasConfirmedBattleSetup, setHasConfirmedBattleSetup] = useState(false)
  const [selectedPlayMode, setSelectedPlayMode] = useState<PlayMode | null>(null)
  const aiTurnReady = browserAiReady
  const gameClient = useMemo(() => createGameClient(), [])
  const resetUiForSnapshot = useCallback((nextSnapshot: GameSnapshot, scenarioId: string) => {
    setSnapshot(nextSnapshot)
    setSelectedScenarioId(scenarioId)
    setSelectedUnitIds([])
    setPreviewAction(null)
    setModalResolutionIndex(null)
    setDismissedResolutionBatchKey(null)
    setVisibleResolutionBatch(null)
    setDismissedWinnerModalKey(null)
    setDismissedDeploymentModalKeys([])
    setDismissedTurnModalKeys([])
    setPendingTurnModalKey(null)
    lastBattleTurnKeyRef.current = null
    setAiStatus(null)
    setIsAiThinking(false)
    setLiveAiDecision(null)
    setLastAiTurn(null)
    setAiTurnHistory([])
    setAiIntents({ A: '', B: '' })
  }, [])

  function clearMultiplayerSessionState() {
    multiplayerConnectionRef.current?.close()
    multiplayerConnectionRef.current = null
    clearStoredMultiplayerSession()
    setIsMultiplayerConnected(false)
    setIsMultiplayerPending(false)
    setMultiplayerSession(null)
    setMultiplayerStatus(null)
    setCopiedRoomCode(null)
  }

  const activateMultiplayerSession = useCallback((session: MultiplayerSession, statusMessage: string) => {
    resetUiForSnapshot(session.snapshot, session.snapshot.state.scenario_id)
    setAiController('off')
    setHasConfirmedBattleSetup(true)
    setSelectedPlayMode('online_multiplayer')
    setJoinRoomCode(session.room_code)
    setMultiplayerSession(toMultiplayerSessionState(session))
    setMultiplayerStatus(statusMessage)
    setCopiedRoomCode(null)
    storeMultiplayerSession({
      army: session.army,
      room_code: session.room_code,
      token: session.token,
    })
  }, [resetUiForSnapshot])

  const applyMultiplayerSessionUpdate = useCallback((session: MultiplayerSession) => {
    setError(null)
    setSnapshot(session.snapshot)
    setSelectedScenarioId(session.snapshot.state.scenario_id)
    setMultiplayerSession((current) =>
      current && current.room_code === session.room_code
        ? { ...current, seats: session.seats, status: session.status }
        : toMultiplayerSessionState(session),
    )
  }, [])

  async function bootstrapGame(scenarioId: string) {
    clearMultiplayerSessionState()
    setBattlefield3DLoadPhase('loading')
    setError(null)
    try {
      const nextSnapshot = await gameClient.createGame({ scenario_id: scenarioId, seed: 7 })
      resetUiForSnapshot(nextSnapshot, scenarioId)
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  useEffect(() => {
    let cancelled = false

    async function loadInitialData() {
      try {
        const loadedScenarios = await gameClient.listScenarios()
        if (cancelled) {
          return
        }

        setScenarios(loadedScenarios)
        const preferredScenarioId =
          loadedScenarios.find((scenario) => scenario.scenario_id === DEFAULT_SCENARIO_ID)?.scenario_id ??
          loadedScenarios[0]?.scenario_id ??
          DEFAULT_SCENARIO_ID

        const storedMultiplayerSession = loadStoredMultiplayerSession()
        if (storedMultiplayerSession) {
          try {
            const restoredSession = await restoreMultiplayerSession(storedMultiplayerSession)
            if (cancelled) {
              return
            }

            activateMultiplayerSession(
              restoredSession,
              `Reconnected to duel ${restoredSession.room_code} as ${formatArmyDisplayName(restoredSession.army)}.`,
            )
            return
          } catch {
            clearStoredMultiplayerSession()
          }
        }

        const nextSnapshot = await gameClient.createGame({ scenario_id: preferredScenarioId, seed: 7 })
        if (cancelled) {
          return
        }

        resetUiForSnapshot(nextSnapshot, preferredScenarioId)
      } catch (caughtError) {
        if (!cancelled) {
          setError(getErrorMessage(caughtError))
        }
      }
    }

    void loadInitialData()

    return () => {
      cancelled = true
    }
  }, [activateMultiplayerSession, gameClient, resetUiForSnapshot])

  const multiplayerArmy = multiplayerSession?.army ?? null
  const multiplayerRoomCode = multiplayerSession?.room_code ?? null
  const multiplayerToken = multiplayerSession?.token ?? null

  useEffect(() => {
    if (!multiplayerArmy || !multiplayerRoomCode || !multiplayerToken) {
      return
    }

    const connection = connectMultiplayerSession(
      {
        army: multiplayerArmy,
        room_code: multiplayerRoomCode,
        token: multiplayerToken,
      },
      {
        onConnectionChange: (connected) => {
          setIsMultiplayerConnected(connected)
          setMultiplayerStatus(
            connected
              ? `Connected to duel ${multiplayerRoomCode} as ${formatArmyDisplayName(multiplayerArmy)}.`
              : `Disconnected from duel ${multiplayerRoomCode}.`,
          )
        },
        onError: (message) => setError(message),
        onPresence: (seats, status) => {
          setMultiplayerSession((current) =>
            current && current.room_code === multiplayerRoomCode ? { ...current, seats, status } : current,
          )
        },
        onSnapshot: applyMultiplayerSessionUpdate,
      },
    )

    multiplayerConnectionRef.current = connection

    return () => {
      if (multiplayerConnectionRef.current === connection) {
        multiplayerConnectionRef.current = null
      }
      connection.close()
    }
  }, [applyMultiplayerSessionUpdate, multiplayerArmy, multiplayerRoomCode, multiplayerToken])

  useEffect(() => {
    if (!multiplayerArmy || !multiplayerRoomCode || !multiplayerToken) {
      return
    }

    let cancelled = false
    let inFlight = false
    const storedSession = {
      army: multiplayerArmy,
      room_code: multiplayerRoomCode,
      token: multiplayerToken,
    }

    async function refreshSession() {
      if (inFlight) {
        return
      }
      inFlight = true
      try {
        const refreshedSession = await restoreMultiplayerSession(storedSession)
        if (!cancelled) {
          applyMultiplayerSessionUpdate(refreshedSession)
        }
      } catch (caughtError) {
        if (!cancelled && !isMultiplayerConnected) {
          setError(getErrorMessage(caughtError))
        }
      } finally {
        inFlight = false
      }
    }

    const intervalMs = multiplayerSession?.status === 'waiting' || !isMultiplayerConnected ? 1000 : 5000
    void refreshSession()
    const interval = window.setInterval(() => {
      void refreshSession()
    }, intervalMs)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [
    applyMultiplayerSessionUpdate,
    isMultiplayerConnected,
    multiplayerArmy,
    multiplayerRoomCode,
    multiplayerSession?.status,
    multiplayerToken,
  ])

  useEffect(() => {
    if (!copiedRoomCode) {
      return
    }

    const timer = window.setTimeout(() => {
      setCopiedRoomCode(null)
    }, 2400)

    return () => {
      window.clearTimeout(timer)
    }
  }, [copiedRoomCode])

  async function executeAiTurn(armyOverride?: ArmyId) {
    if (!snapshot || isGameFinished(snapshot.state)) {
      return
    }

    const activeArmy = armyOverride ?? snapshot.state.current_player
    if (activeArmy !== snapshot.state.current_player) {
      setError(`It is currently ${formatArmyDisplayName(snapshot.state.current_player)}'s turn.`)
      return
    }

    const autoEndBound = shouldAutoEndBound(snapshot)
    const localSimpleAi = isLocalAiAccessMode(browserAiAccessMode)
    setIsAiPending(true)
    setIsAiThinking(!autoEndBound)
    setLiveAiDecision(null)
    setAiStatus(
      autoEndBound
        ? `${formatArmyDisplayName(activeArmy)} has 0 PIPs remaining, so the bound will end automatically.`
        : localSimpleAi
          ? `Preparing ${activeBrowserAiModel} for ${formatArmyDisplayName(activeArmy)}.`
          : `Preparing benchmark-aligned text-only board description for ${formatArmyDisplayName(activeArmy)}.`,
    )
    setError(null)
    setSelectedUnitIds([])
    setPreviewAction(null)
    setModalResolutionIndex(null)

    try {
      if (!autoEndBound && !localSimpleAi && !browserAiApiKey.trim()) {
        throw new Error(`Enter a ${providerDisplayName(activeBrowserAiProvider)} API key to use browser AI.`)
      }
      if (!autoEndBound && !localSimpleAi && !activeBrowserAiModel) {
        throw new Error(`Enter a ${providerDisplayName(activeBrowserAiProvider)} model id to use browser AI.`)
      }
      setAiStatus(
        autoEndBound
          ? `${formatArmyDisplayName(activeArmy)} is ending the bound automatically.`
          : localSimpleAi
            ? `${formatArmyDisplayName(activeArmy)} is using ${activeBrowserAiModel} to score legal actions locally.`
            : `${formatArmyDisplayName(activeArmy)} is choosing an action.`,
      )
      const result = await runAiTurn({
        snapshot,
        activeArmy,
        gameClient,
        browserAiApiKey,
        activeBrowserAiProvider,
        activeBrowserAiBaseUrl,
        activeBrowserAiModel,
        localSimpleAi,
        localAiModel: isLocalAiAccessMode(browserAiAccessMode) ? browserAiAccessMode : undefined,
        currentIntent: aiIntents[activeArmy] ?? '',
        onDecision: (decision) => {
          setIsAiThinking(false)
          setLiveAiDecision({
            actingArmy: activeArmy,
            actionSummary: decision.actionSummary,
            confidence: decision.confidence,
            intent_update: decision.intent_update,
            messageId: `${snapshot.state.game_id}:${activeArmy}:live:${Date.now()}`,
            model: decision.model,
            reasoning: decision.reasoning,
          })
          setAiStatus(`${formatArmyDisplayName(activeArmy)} chose ${decision.actionSummary}. Resolving orders.`)
        },
        onWillResolveAction: (actionSnapshot, legalAction, action, appliedCount) => {
          setSnapshot(actionSnapshot)
          setSelectedUnitIds(selectedUnitIdsForAction(action))
          setPreviewAction(legalAction)
          setModalResolutionIndex(null)
          setDismissedResolutionBatchKey(null)
          setAiStatus(`${formatArmyDisplayName(activeArmy)} order ${appliedCount}: ${describeAction(legalAction)}.`)
        },
        onResolvedAction: (nextSnapshot, action, appliedCount) => {
          setSnapshot(nextSnapshot)
          setSelectedUnitIds(selectedUnitIdsForAction(action))
          setPreviewAction(null)
          setModalResolutionIndex(null)
          setDismissedResolutionBatchKey(null)
          setAiStatus(
            action.type === 'end_bound'
              ? `${formatArmyDisplayName(activeArmy)} is resolving shooting and close combat.`
              : `${formatArmyDisplayName(activeArmy)} resolved order ${appliedCount}.`,
          )
        },
      })
      const recordedAiTurn: AiTurnRecord = {
        ...result,
        actingArmy: activeArmy,
        messageId: `${snapshot.state.game_id}:${activeArmy}:${Date.now()}:${result.applied_action_index}`,
      }

      setSnapshot(result.snapshot)
      setSelectedUnitIds([])
      setPreviewAction(null)
      setModalResolutionIndex(null)
      setDismissedResolutionBatchKey(null)
      setDismissedWinnerModalKey(null)
      setLastAiTurn(recordedAiTurn)
      setAiTurnHistory((current) => [...current, recordedAiTurn])
      setLiveAiDecision(null)
      if (result.intent_update) {
        setAiIntents((current) => ({ ...current, [activeArmy]: result.intent_update ?? '' }))
      }
      setAiStatus(`${formatArmyDisplayName(activeArmy)} played ${result.applied_action_summary}.`)
    } catch (caughtError) {
      setAiStatus(null)
      setLiveAiDecision(null)
      setError(getErrorMessage(caughtError))
    } finally {
      setIsAiThinking(false)
      setIsAiPending(false)
    }
  }

  const runAiTurnEffect = useEffectEvent(async () => {
    await executeAiTurn()
  })

  useEffect(() => {
    const currentPlayerIsAi = !multiplayerSession && snapshot && controlsArmy(aiController, snapshot.state.current_player)
    const currentPlayerIsRemote =
      multiplayerSession && snapshot && multiplayerSession.army !== snapshot.state.current_player
    if (!snapshot || (!currentPlayerIsAi && !currentPlayerIsRemote)) {
      return
    }

    setSelectedUnitIds([])
    setPreviewAction(null)
    setModalResolutionIndex(null)
  }, [aiController, multiplayerSession, snapshot])

  useEffect(() => {
    if (
      !snapshot ||
      multiplayerSession ||
      !hasConfirmedBattleSetup ||
      isAiPending ||
      isGameFinished(snapshot.state) ||
      visibleResolutionBatch !== null ||
      !controlsArmy(aiController, snapshot.state.current_player) ||
      (!aiTurnReady && !shouldAutoEndBound(snapshot))
    ) {
      return
    }

    const timer = window.setTimeout(() => {
      void runAiTurnEffect()
    }, 250)

    return () => {
      window.clearTimeout(timer)
    }
  }, [aiController, aiTurnReady, hasConfirmedBattleSetup, isAiPending, multiplayerSession, snapshot, visibleResolutionBatch])

  async function dispatchAction(action: Action) {
    if (
      !snapshot ||
      isAiPending ||
      isAutoDeploying ||
      visibleResolutionBatch !== null
    ) {
      return
    }

    if (multiplayerSession) {
      if (!isMultiplayerConnected || !multiplayerConnectionRef.current) {
        setError('The online duel is not connected.')
        return
      }
      const opponent = opponentArmy(multiplayerSession.army)
      if (!multiplayerSession.seats[opponent]?.occupied) {
        setError(`Invite ${multiplayerSession.room_code} is still waiting for your opponent to join.`)
        return
      }
      if (multiplayerSession.army !== snapshot.state.current_player) {
        setError(`It is currently ${formatArmyDisplayName(snapshot.state.current_player)}'s turn.`)
        return
      }
    } else if (controlsArmy(aiController, snapshot.state.current_player)) {
      return
    }

    setError(null)
    try {
      const nextSnapshot = multiplayerSession
        ? await multiplayerConnectionRef.current!.submitAction(action)
        : await gameClient.submitAction(snapshot.state.game_id, action)
      setSnapshot(nextSnapshot)
      if ('unit_id' in action) {
        setSelectedUnitIds([action.unit_id])
        setPreviewAction(null)
        return
      }
      if ('unit_ids' in action) {
        setSelectedUnitIds([...action.unit_ids])
        setPreviewAction(null)
        return
      }
      setSelectedUnitIds([])
      setPreviewAction(null)
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  async function handleUndo() {
    if (
      !snapshot?.can_undo ||
      isAiPending ||
      isAutoDeploying ||
      visibleResolutionBatch !== null ||
      multiplayerSession ||
      controlsArmy(aiController, snapshot.state.current_player)
    ) {
      return
    }

    setError(null)
    try {
      const nextSnapshot = await gameClient.undoGame(snapshot.state.game_id)
      setSnapshot(nextSnapshot)
      setSelectedUnitIds([])
      setPreviewAction(null)
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  function closeResolutionModal() {
    if (resolutionBatchKey) {
      setDismissedResolutionBatchKey(resolutionBatchKey)
    }
    setVisibleResolutionBatch(null)
    setModalResolutionIndex(null)
  }

  function closeWinnerModal() {
    if (winnerModalKey) {
      setDismissedWinnerModalKey(winnerModalKey)
    }
  }

  function closeDeploymentModal() {
    if (!deploymentModalKey) {
      return
    }

    setDismissedDeploymentModalKeys((current) =>
      current.includes(deploymentModalKey) ? current : [...current, deploymentModalKey],
    )
  }

  function closeTurnModal() {
    if (!pendingTurnModalKey) {
      return
    }

    setDismissedTurnModalKeys((current) =>
      current.includes(pendingTurnModalKey) ? current : [...current, pendingTurnModalKey],
    )
    setPendingTurnModalKey(null)
  }

  const state = snapshot?.state ?? null
  const gameFinished = isGameFinished(state)
  const currentPlayer = state?.current_player ?? null
  const humanArmy = multiplayerSession
    ? multiplayerSession.army
    : aiController === 'A'
      ? 'B'
      : aiController === 'B'
        ? 'A'
        : null
  const isCurrentPlayerRemote = Boolean(multiplayerSession && currentPlayer && multiplayerSession.army !== currentPlayer)
  const multiplayerOpponentArmy = multiplayerSession ? opponentArmy(multiplayerSession.army) : null
  const isMultiplayerOpponentSeated = Boolean(
    multiplayerSession && multiplayerOpponentArmy && multiplayerSession.seats[multiplayerOpponentArmy]?.occupied,
  )
  const isMultiplayerWaiting = Boolean(
    multiplayerSession && multiplayerSession.status !== 'finished' && !isMultiplayerOpponentSeated,
  )
  const canActInMultiplayer = Boolean(
    multiplayerSession &&
      currentPlayer &&
      multiplayerSession.army === currentPlayer &&
      isMultiplayerConnected &&
      isMultiplayerOpponentSeated,
  )
  const isMultiplayerInputLocked = Boolean(
    multiplayerSession &&
      !gameFinished &&
      (!isMultiplayerConnected || isCurrentPlayerRemote || isMultiplayerWaiting),
  )
  const initialCameraPreset = multiplayerSession?.army === 'B' ? 'army_b' : 'army_a'
  const localBrowserAi = isLocalAiAccessMode(browserAiAccessMode)
  const showCommanderChat = !localBrowserAi && !multiplayerSession
  const browserAiMenuStatus = localBrowserAi
    ? [activeBrowserAiModel, 'local', 'ready'].join(' | ')
    : [
        providerDisplayName(activeBrowserAiProvider),
        browserAiApiKey.trim() ? 'key ready' : 'key missing',
        activeBrowserAiModel || 'model missing',
      ].join(' | ')
  const winnerModalKey =
    state !== null && gameFinished
      ? `${state.game_id}:${state.draw ? 'draw' : state.winner}:${state.bound_number}:${state.log.length}`
      : null
  const showWinnerModal =
    winnerModalKey !== null && winnerModalKey !== dismissedWinnerModalKey && visibleResolutionBatch === null
  const resultLabel = state?.draw ? 'Draw' : state?.winner ? formatArmyDisplayName(state.winner) : null
  const winnerModalTitle =
    state === null || !gameFinished
      ? null
      : state.draw
        ? 'Draw'
      : humanArmy
        ? state.winner === humanArmy
          ? 'Victory'
          : 'Defeat'
        : `${formatArmyDisplayName(state.winner!)} Wins`
  const winnerModalSummary =
    state === null || !gameFinished
      ? null
      : state.draw
        ? `${state.scenario_name} ended in a draw.`
      : humanArmy
        ? state.winner === humanArmy
          ? `${formatArmyDisplayName(state.winner!)} has won ${state.scenario_name}.`
          : `${formatArmyDisplayName(state.winner!)} has beaten your force in ${state.scenario_name}.`
        : `${state.scenario_name} ended with ${formatArmyDisplayName(state.winner!)} victorious.`
  const isGameViewReady = battlefield3DLoadPhase !== 'loading'
  const showBattlefieldLoadingCover = !error && (!snapshot || battlefield3DLoadPhase === 'loading')
  const showBattlefieldSetupModal = !error && Boolean(snapshot) && isGameViewReady && !hasConfirmedBattleSetup
  const isCurrentPlayerAi =
    !multiplayerSession && currentPlayer ? controlsArmy(aiController, currentPlayer) && aiTurnReady && hasConfirmedBattleSetup : false
  const battleTurnKey =
    state?.phase === 'battle' && !gameFinished && currentPlayer
      ? `${state.game_id}:turn:${state.bound_number}:${currentPlayer}`
      : null
  const uiLocked =
    isAiPending ||
    isAutoDeploying ||
    showBattlefieldSetupModal ||
    isMultiplayerInputLocked ||
    (isCurrentPlayerAi && !gameFinished)
  const legalActions = snapshot?.legal_actions ?? []
  const phaseHudLabel = state ? (state.phase === 'deployment' ? 'Deployment' : 'Battle') : '-'
  const pipsHudLabel = state?.phase === 'battle' ? `${state.pips_remaining}` : '-'
  const armyMorale = [...(state?.armies ?? [])].sort((left, right) => left.id.localeCompare(right.id))
  const canFinalizeDeployment = legalActions.some((action) => action.type === 'finalize_deployment')
  const canEndBound = legalActions.some((action) => action.type === 'end_bound')
  const interaction = buildBattlefieldInteractionModel({
    state,
    legalActions,
    selectedUnitIds,
    previewAction,
  })
  const selectedUnit = interaction.selectedUnit
  const selectedRecoveryActions = [...interaction.selectedReforms, ...interaction.selectedRallies]
  const selectedWarnings = [
    ...interaction.selectedCharges.map(formatActionWarning),
    ...interaction.selectedGroupActionOptions.map(formatActionWarning),
  ].filter((warning): warning is string => Boolean(warning))
  const deploymentActionsByUnit = buildDeploymentActionsByUnit(legalActions)
  const deploymentUnits =
    state?.phase === 'deployment' && currentPlayer
      ? state.units
          .filter((unit) => unit.army === currentPlayer && !unit.eliminated && !unit.off_map)
          .sort(compareDeploymentUnits)
      : []
  const deployedDeploymentUnits = deploymentUnits.filter((unit) => unit.deployed)
  const reserveDeploymentUnits = deploymentUnits.filter((unit) => !unit.deployed)
  const selectedDeploymentUnit =
    state?.phase === 'deployment' && selectedUnit?.army === currentPlayer ? selectedUnit : null
  const selectedDeploymentActions = selectedDeploymentUnit
    ? deploymentActionsByUnit.get(selectedDeploymentUnit.id) ?? []
    : []
  const deploymentProgressPercent = deploymentUnits.length
    ? Math.round((deployedDeploymentUnits.length / deploymentUnits.length) * 100)
    : 0
  const deploymentZonesForCurrent =
    state?.phase === 'deployment' && currentPlayer
      ? state.deployment_zones.filter((zone) => zone.army === currentPlayer)
      : []
  const liveRecentResolutions = state?.recent_resolutions ?? EMPTY_COMBAT_RESOLUTIONS
  const liveResolutionBatchKey =
    state && liveRecentResolutions.length
      ? `${state.game_id}:${state.bound_number}:${state.log.length}:${liveRecentResolutions.map(resolutionKey).join('|')}`
      : null
  const recentResolutions = visibleResolutionBatch?.resolutions ?? EMPTY_COMBAT_RESOLUTIONS
  const resolutionBatchKey = visibleResolutionBatch?.key ?? null
  const effectiveResolutionIndex =
    modalResolutionIndex !== null
      ? modalResolutionIndex
      : resolutionBatchKey !== null && resolutionBatchKey !== dismissedResolutionBatchKey
        ? 0
        : null
  const selectedResolution =
    effectiveResolutionIndex !== null &&
    effectiveResolutionIndex >= 0 &&
    effectiveResolutionIndex < recentResolutions.length
      ? recentResolutions[effectiveResolutionIndex]
      : null
  const attackerArmy =
    selectedResolution && state
      ? state.units.find((unit) => unit.id === selectedResolution.attacker_id)?.army ?? null
      : null
  const defenderArmy =
    selectedResolution && state
      ? state.units.find((unit) => unit.id === selectedResolution.defender_id)?.army ?? null
      : null
  const canViewPreviousResolution = effectiveResolutionIndex !== null && effectiveResolutionIndex > 0
  const canViewNextResolution =
    effectiveResolutionIndex !== null && effectiveResolutionIndex < recentResolutions.length - 1
  const resolutionPositionLabel =
    effectiveResolutionIndex !== null ? `${effectiveResolutionIndex + 1} / ${recentResolutions.length}` : null
  const aiUsageSummary = summarizeAiTurnHistory(aiTurnHistory)
  const aiUsageTokenCounter = formatSessionTokenCount(aiUsageSummary)
  const aiUsageCostCounter = formatSessionCost(aiUsageSummary)
  const deploymentModalKey =
    state?.phase === 'deployment' &&
    !gameFinished &&
    currentPlayer &&
    !isCurrentPlayerAi &&
    !isMultiplayerInputLocked &&
    isGameViewReady &&
    hasConfirmedBattleSetup
      ? `${state.game_id}:deployment:${currentPlayer}:${state.deployment_ready.join(',')}`
      : null
  const showDeploymentModal =
    deploymentModalKey !== null && !dismissedDeploymentModalKeys.includes(deploymentModalKey)
  const deploymentSideLabel =
    currentPlayer && humanArmy === currentPlayer ? 'Your army' : currentPlayer ? formatArmyDisplayName(currentPlayer) : null
  const deploymentModalTitle = currentPlayer ? `${deploymentSideLabel ?? formatArmyDisplayName(currentPlayer)}: Begin Deployment` : null
  const deploymentModalSummary =
    state?.phase === 'deployment' && deploymentSideLabel
      ? `${deploymentSideLabel} must deploy every reserve unit inside the highlighted deployment zone before finalizing.`
      : null
  const turnModalTitle =
    state?.phase !== 'battle' || !currentPlayer
      ? null
      : humanArmy === currentPlayer
        ? 'Your Turn'
        : `${formatArmyDisplayName(currentPlayer)} Turn`
  const turnModalSummary =
    state?.phase !== 'battle' || !currentPlayer
      ? null
      : humanArmy === currentPlayer
        ? `You begin bound ${state.bound_number} with ${state.pips_remaining} action point${state.pips_remaining === 1 ? '' : 's'}.`
        : `${formatArmyDisplayName(currentPlayer)} begins bound ${state.bound_number} with ${state.pips_remaining} action point${
            state.pips_remaining === 1 ? '' : 's'
          }.`
  const showTurnModal =
    pendingTurnModalKey !== null &&
    pendingTurnModalKey === battleTurnKey &&
    selectedResolution === null &&
    isGameViewReady &&
    hasConfirmedBattleSetup &&
    !isCurrentPlayerAi &&
    !isMultiplayerInputLocked &&
    !dismissedTurnModalKeys.includes(pendingTurnModalKey)

  useEffect(() => {
    if (
      !liveResolutionBatchKey ||
      !liveRecentResolutions.length ||
      liveResolutionBatchKey === dismissedResolutionBatchKey ||
      visibleResolutionBatch?.key === liveResolutionBatchKey
    ) {
      return
    }

    setVisibleResolutionBatch({
      key: liveResolutionBatchKey,
      resolutions: liveRecentResolutions,
    })
    setModalResolutionIndex(0)
    setPendingTurnModalKey(null)
  }, [dismissedResolutionBatchKey, liveRecentResolutions, liveResolutionBatchKey, visibleResolutionBatch?.key])

  useEffect(() => {
    if (!battleTurnKey || battleTurnKey === lastBattleTurnKeyRef.current) {
      return
    }

    lastBattleTurnKeyRef.current = battleTurnKey
    setPendingTurnModalKey(isCurrentPlayerAi || isMultiplayerInputLocked ? null : battleTurnKey)
  }, [battleTurnKey, isCurrentPlayerAi, isMultiplayerInputLocked])

  useLayoutEffect(() => {
    if (!selectedResolution || !resolutionModalRef.current) {
      setCombatCalloutLayout(null)
      return
    }

    const modalElement = resolutionModalRef.current

    const updateLayout = () => {
      if (!projectedCombatAnchor) {
        setCombatCalloutLayout(null)
        return
      }

      setCombatCalloutLayout(
        buildCombatCalloutLayout(projectedCombatAnchor.x, projectedCombatAnchor.y, modalElement.getBoundingClientRect()),
      )
    }

    updateLayout()
    window.addEventListener('resize', updateLayout)

    return () => {
      window.removeEventListener('resize', updateLayout)
    }
  }, [effectiveResolutionIndex, projectedCombatAnchor, selectedResolution])

  const scenarioDescription =
    scenarios.find((scenario) => scenario.scenario_id === selectedScenarioId)?.description ?? ''
  const centeredCombatModalStyle: CSSProperties = {
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
  }

  function handleScenarioSelection(nextScenarioId: string) {
    if (multiplayerSession) {
      return
    }
    setSelectedScenarioId(nextScenarioId)
    void bootstrapGame(nextScenarioId)
  }

  async function handleCreateMultiplayerRoom() {
    if (isMultiplayerPending || multiplayerSession) {
      return
    }

    setError(null)
    setIsMultiplayerPending(true)
    try {
      const session = await createMultiplayerRoom({
        scenario_id: selectedScenarioId,
        seed: createOnlineSeed(),
      })
      activateMultiplayerSession(
        session,
        `Online duel ${session.room_code} created. Share the invite code with your opponent.`,
      )
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    } finally {
      setIsMultiplayerPending(false)
    }
  }

  async function handleJoinMultiplayerRoom() {
    const roomCode = normalizeRoomCodeInput(joinRoomCode)
    if (isMultiplayerPending || multiplayerSession || roomCode.length !== 6) {
      return
    }

    setError(null)
    setIsMultiplayerPending(true)
    try {
      const session = await joinMultiplayerRoom(roomCode)
      activateMultiplayerSession(
        session,
        `Joined duel ${session.room_code} as ${formatArmyDisplayName(session.army)}.`,
      )
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    } finally {
      setIsMultiplayerPending(false)
    }
  }

  function handleLeaveMultiplayerRoom() {
    const scenarioId = selectedScenarioId
    clearMultiplayerSessionState()
    setHasConfirmedBattleSetup(false)
    setSelectedPlayMode(null)
    void bootstrapGame(scenarioId)
  }

  function handleSelectPlayMode(mode: PlayMode) {
    setError(null)
    setSelectedPlayMode(mode)
    setJoinRoomCode('')

    if (mode === 'single_player') {
      setAiController('B')
      return
    }

    setAiController('off')
  }

  function handleChangePlayMode() {
    if (multiplayerSession) {
      return
    }

    setError(null)
    setSelectedPlayMode(null)
    setJoinRoomCode('')
  }

  function handleConfirmBattleSetup() {
    if (!selectedPlayMode || selectedPlayMode === 'online_multiplayer') {
      return
    }

    if (selectedPlayMode === 'local_multiplayer') {
      setAiController('off')
    }

    setHasConfirmedBattleSetup(true)
  }

  async function handleCopyMultiplayerRoomCode() {
    if (!multiplayerSession) {
      return
    }

    try {
      await copyTextToClipboard(multiplayerSession.room_code)
      setCopiedRoomCode(multiplayerSession.room_code)
      setMultiplayerStatus(`Copied invite code ${multiplayerSession.room_code}.`)
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  function renderScenarioField(label: string | null, className = 'field') {
    return (
      <label className={className}>
        {label ? <span>{label}</span> : null}
        <select
          aria-label="Scenario"
          disabled={Boolean(multiplayerSession)}
          value={selectedScenarioId}
          onChange={(event) => handleScenarioSelection(event.target.value)}
        >
          {scenarios.map((scenario) => (
            <option key={scenario.scenario_id} value={scenario.scenario_id}>
              {scenario.name}
            </option>
          ))}
        </select>
      </label>
    )
  }

  function renderAiControlField(label: string | null, className = 'field') {
    return (
      <label className={className}>
        {label ? <span>{label}</span> : null}
        <select
          aria-label="AI Controls"
          value={aiController}
          disabled={isAiPending || Boolean(multiplayerSession)}
          onChange={(event) => setAiController(event.target.value as AiController)}
        >
          <option value="off">AI Controls: Off</option>
          <option value="A">AI Controls: {formatArmyDisplayName('A')}</option>
          <option value="B">AI Controls: {formatArmyDisplayName('B')}</option>
          <option value="both">AI Controls: Both commanders</option>
        </select>
      </label>
    )
  }

  function renderBrowserAiSettingsFields(className: string) {
    return (
      <div className={className}>
        <label className="field field--compact">
          <span>Mode</span>
          <select
            value={browserAiAccessMode}
            disabled={isAiPending}
            onChange={(event) =>
              setBrowserAiAccessMode(
                isLocalAiAccessMode(event.target.value) ? event.target.value : 'bring_your_own_key',
              )
            }
          >
            <option value={STRATEGOS_1_MODEL_ID}>{STRATEGOS_1_MODEL_ID}</option>
            <option value={STRATEGOS_2_MODEL_ID}>{STRATEGOS_2_MODEL_ID}</option>
            <option value="bring_your_own_key">Bring your own key</option>
          </select>
        </label>
        {isLocalAiAccessMode(browserAiAccessMode) ? (
          <label className="field field--compact">
            <span>Model</span>
            <input
              type="text"
              value={browserAiAccessMode}
              disabled
              readOnly
              spellCheck={false}
            />
          </label>
        ) : (
          <>
            <label className="field field--compact">
              <span>Provider</span>
              <select
                value={activeBrowserAiProvider}
                disabled={isAiPending}
                onChange={(event) => setBrowserAiProvider(event.target.value)}
              >
                {SUPPORTED_BROWSER_AI_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {providerDisplayName(provider)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--compact">
              <span>Model</span>
              <input
                type="text"
                value={browserAiModel}
                disabled={isAiPending}
                onChange={(event) => setBrowserAiModel(event.target.value)}
                placeholder={browserAiModelPlaceholder(activeBrowserAiProvider)}
                spellCheck={false}
              />
            </label>
            <label className="field field--wide">
              <span>{providerDisplayName(activeBrowserAiProvider)} API Key</span>
              <input
                type="password"
                value={browserAiApiKey}
                disabled={isAiPending}
                onChange={(event) => setBrowserAiApiKey(event.target.value)}
                placeholder={browserAiApiKeyPlaceholder(activeBrowserAiProvider)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="field field--wide">
              <span>Base URL</span>
              <input
                type="text"
                value={browserAiBaseUrl}
                disabled={isAiPending}
                onChange={(event) => setBrowserAiBaseUrl(event.target.value)}
                placeholder={activeBrowserAiBaseUrl}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </>
        )}
      </div>
    )
  }

  const battlefield3dLoadingIndicator = (
    <div className="battlefield-3d__loading-panel">
      <strong className="battlefield-3d__loading-title">Loading 3D battlefield</strong>
      <span className="battlefield-3d__loading-copy">Preparing the scene and unit models.</span>
      <div className="battlefield-3d__loading-shell" aria-hidden="true">
        <div className="battlefield-3d__loading-bar">
          <div className="battlefield-3d__loading-bar-fill" />
        </div>
      </div>
      <span className="battlefield-3d__loading-credit">Work in progress</span>
    </div>
  )
  const battlefield3dLoadingFallback = (
    <div className="battlefield-3d-lazy-state">
      <div className="battlefield-3d__overlay battlefield-3d__overlay--loading" role="status" aria-live="polite" aria-label="Loading 3D battlefield">
        {battlefield3dLoadingIndicator}
      </div>
    </div>
  )
  const battlefield3dLoadingCover =
    showBattlefieldLoadingCover ? (
      <div className="battlefield-stage__loading-cover" role="status" aria-live="polite" aria-label="Loading 3D battlefield">
        <div className="battlefield-3d__overlay battlefield-3d__overlay--loading">{battlefield3dLoadingIndicator}</div>
      </div>
    ) : null
  const canJoinMultiplayerRoom = normalizeRoomCodeInput(joinRoomCode).length === 6
  const setupRequiresAiReady = selectedPlayMode === 'single_player' && aiController !== 'off' && !browserAiReady
  const selectedPlayModeDetails = PLAY_MODE_OPTIONS.find((option) => option.id === selectedPlayMode) ?? null
  const playModeMenu = (
    <div className="play-mode-grid">
      {PLAY_MODE_OPTIONS.map((option) => (
        <button
          className="play-mode-card"
          key={option.id}
          onClick={() => handleSelectPlayMode(option.id)}
          type="button"
        >
          <span className="play-mode-card__kicker">{option.kicker}</span>
          <strong>{option.title}</strong>
          <span>{option.description}</span>
        </button>
      ))}
    </div>
  )
  const multiplayerSetupSection = (
    <div className="setup-modal__section multiplayer-setup">
      <div>
        <p className="viewer-mode-menu__eyebrow">Invite Code</p>
        <p className="card__headline setup-modal__copy">
          Host creates an invite code and sends it to a friend. The friend enters that code to join.
        </p>
      </div>
      {multiplayerSession ? (
        <div className="multiplayer-setup__active">
          <span className="multiplayer-setup__code">{multiplayerSession.room_code}</span>
          <span>{formatArmyDisplayName(multiplayerSession.army)}</span>
          <span>{formatMultiplayerStatus(multiplayerSession.status)}</span>
        </div>
      ) : (
        <div className="multiplayer-setup__actions">
          <button
            className="button button--secondary"
            disabled={isMultiplayerPending}
            onClick={() => void handleCreateMultiplayerRoom()}
            type="button"
          >
            {isMultiplayerPending ? 'Creating...' : 'Host Online Duel'}
          </button>
          <label className="field field--compact multiplayer-setup__join-code">
            <span>Invite Code</span>
            <input
              autoComplete="off"
              inputMode="text"
              onChange={(event) => setJoinRoomCode(normalizeRoomCodeInput(event.target.value))}
              placeholder="ABC123"
              spellCheck={false}
              value={joinRoomCode}
            />
          </label>
          <button
            className="button"
            disabled={isMultiplayerPending || !canJoinMultiplayerRoom}
            onClick={() => void handleJoinMultiplayerRoom()}
            type="button"
          >
            Join Friend
          </button>
        </div>
      )}
    </div>
  )
  const selectedPlayModeSetup = selectedPlayMode ? (
    <>
      <div className="setup-modal__grid">
        {renderScenarioField('Scenario', 'field setup-modal__field')}
        {selectedPlayMode === 'single_player'
          ? renderAiControlField('AI Controls', 'field setup-modal__field')
          : null}
      </div>

      {selectedPlayMode === 'single_player' ? (
        <div className="setup-modal__section">
          {setupRequiresAiReady ? (
            <p className="browser-ai-warning setup-modal__warning">
              Choose {STRATEGOS_1_MODEL_ID}, {STRATEGOS_2_MODEL_ID}, or enter a key and model before continuing with AI control.
            </p>
          ) : null}
          {renderBrowserAiSettingsFields('browser-ai-settings setup-modal__settings')}
        </div>
      ) : null}

      {selectedPlayMode === 'local_multiplayer' ? (
        <div className="setup-modal__section setup-modal__mode-note">
          <p className="card__headline setup-modal__copy">Both armies will use this device, and AI turns stay off.</p>
        </div>
      ) : null}

      {selectedPlayMode === 'online_multiplayer' ? multiplayerSetupSection : null}
    </>
  ) : null
  const battlefieldSetupModal = showBattlefieldSetupModal ? (
    <div className="modal-backdrop modal-backdrop--setup" role="dialog" aria-modal="true" aria-labelledby="battle-setup-title">
      <div className="resolution-modal setup-modal">
        <div className="resolution-modal__header">
          <div>
            <p className="eyebrow">{selectedPlayMode ? 'Battle Setup' : 'Play Mode'}</p>
            <h2 className="resolution-modal__title" id="battle-setup-title">
              {selectedPlayModeDetails?.title ?? 'Choose Play Mode'}
            </h2>
            <p className="card__headline setup-modal__copy">
              {selectedPlayModeDetails?.description ?? 'Start a solo battle, local hotseat match, or online duel.'}
            </p>
          </div>
          {selectedPlayMode ? (
            <div className="setup-modal__actions">
              <button className="button button--secondary" onClick={handleChangePlayMode} type="button">
                Change Mode
              </button>
              {selectedPlayMode !== 'online_multiplayer' ? (
                <button className="button" disabled={setupRequiresAiReady} onClick={handleConfirmBattleSetup} type="button">
                  Start Battle
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {selectedPlayMode ? selectedPlayModeSetup : playModeMenu}
      </div>
    </div>
  ) : null

  function handlePreviewAction(action: LegalAction | null) {
    setPreviewAction(action)
  }

  function handleCellClick(coord: Coord, additiveSelection = false) {
    if (!state || gameFinished || uiLocked) {
      return
    }

    const result = resolveCellClick(interaction, coord, selectedUnitIds, additiveSelection)
    if (result.type === 'dispatch') {
      void dispatchAction(result.action)
      return
    }
    if (result.type === 'selection') {
      setPreviewAction(null)
      setSelectedUnitIds(result.selectedUnitIds)
    }
  }

  function selectedUnitIdsForAction(action: Action): string[] {
    if ('unit_ids' in action) {
      return [...action.unit_ids]
    }
    if ('unit_id' in action) {
      return [action.unit_id]
    }
    return []
  }

  async function handleAutoDeploy() {
    if (
      !snapshot ||
      isAutoDeploying ||
      isAiPending ||
      snapshot.state.phase !== 'deployment' ||
      uiLocked
    ) {
      return
    }

    const actions = buildAutoDeploymentActions(deploymentUnits, deploymentActionsByUnit, snapshot.state.current_player)
    if (!actions.length) {
      return
    }

    setError(null)
    setIsAutoDeploying(true)
    try {
      let nextSnapshot = snapshot
      for (const action of actions) {
        nextSnapshot = multiplayerSession
          ? await multiplayerConnectionRef.current!.submitAction(action)
          : await gameClient.submitAction(nextSnapshot.state.game_id, action)
      }
      setSnapshot(nextSnapshot)
      setSelectedUnitIds([])
      setPreviewAction(null)
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    } finally {
      setIsAutoDeploying(false)
    }
  }

  function selectDeploymentUnit(unitId: string) {
    if (
      !state ||
      state.phase !== 'deployment' ||
      gameFinished ||
      uiLocked
    ) {
      return
    }

    setSelectedUnitIds([unitId])
    setPreviewAction(null)
  }

  const battlefieldCopy = multiplayerSession
    ? isCurrentPlayerRemote && currentPlayer
      ? `Waiting for ${formatArmyDisplayName(currentPlayer)} to act in duel ${multiplayerSession.room_code}.`
      : isMultiplayerWaiting
        ? `You command ${formatArmyDisplayName(multiplayerSession.army)} in duel ${multiplayerSession.room_code}. Waiting for your opponent to join with this invite code.`
        : `You command ${formatArmyDisplayName(multiplayerSession.army)} in duel ${multiplayerSession.room_code}.`
    : state?.phase === 'deployment'
      ? "Select one of the active side's reserve units, then click a highlighted deployment cell to place it before battle starts."
      : 'Click your own unit to select it. Shift-click friendly units to define an exact group, click highlighted cells for movement or charges, use overlays for group actions, rotation, rally, and pike reform, or click an enemy to shoot.'
  const battlefieldContext = [
    multiplayerSession ? formatMultiplayerStatus(multiplayerSession.status) : null,
    multiplayerSession ? (isMultiplayerConnected ? 'Connected.' : 'Disconnected.') : null,
    multiplayerSession ? multiplayerStatus : null,
    isCurrentPlayerAi && currentPlayer ? `${formatArmyDisplayName(currentPlayer)} is AI-controlled and will move automatically.` : null,
    resultLabel ? `Result: ${resultLabel}` : null,
    state?.winner_reason ? `Reason: ${state.winner_reason}` : null,
  ]
    .filter(Boolean)
    .join(' ')
  const battlefieldActionButtons = (
    <div className="panel-actions banner__battlefield-actions">
      {multiplayerSession ? (
        <div className="multiplayer-room-chip" aria-label={`Share invite code ${multiplayerSession.room_code}`}>
          <span className="multiplayer-room-chip__label">Invite Code</span>
          <strong className="multiplayer-room-chip__code">{multiplayerSession.room_code}</strong>
          <button
            className="button button--secondary multiplayer-room-chip__copy"
            onClick={() => void handleCopyMultiplayerRoomCode()}
            type="button"
          >
            {copiedRoomCode === multiplayerSession.room_code ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : null}
      {multiplayerSession ? (
        <button
          className="button button--secondary"
          onClick={handleLeaveMultiplayerRoom}
          type="button"
        >
          Leave Online
        </button>
      ) : null}
      {!multiplayerSession ? (
        <button
          className="button button--secondary"
          disabled={!snapshot?.can_undo || uiLocked}
          onClick={() => void handleUndo()}
        >
          Undo
        </button>
      ) : null}
      {multiplayerSession && !canActInMultiplayer && !gameFinished ? (
        <button className="button" disabled type="button">
          {isMultiplayerWaiting
            ? 'Waiting for Opponent'
            : currentPlayer
              ? `Waiting for ${formatArmyDisplayName(currentPlayer)}`
              : 'Waiting'}
        </button>
      ) : state?.phase === 'deployment' ? (
        <button
          className="button"
          disabled={!state || uiLocked || gameFinished || !canFinalizeDeployment}
          title={canFinalizeDeployment ? 'Finalize deployment' : 'Deploy every unit before finalizing.'}
          onClick={() => void dispatchAction({ type: 'finalize_deployment' })}
        >
          Finalize Deployment
        </button>
      ) : (
        <button
          className="button"
          disabled={!state || uiLocked || gameFinished || !canEndBound}
          onClick={() => void dispatchAction({ type: 'end_bound' })}
        >
          End Bound
        </button>
      )}
    </div>
  )
  const deploymentPanel =
    state?.phase === 'deployment' && currentPlayer && (!multiplayerSession || canActInMultiplayer) ? (
      <DeploymentDock
        currentPlayer={currentPlayer}
        deployedDeploymentUnits={deployedDeploymentUnits}
        deploymentActionsByUnit={deploymentActionsByUnit}
        deploymentProgressPercent={deploymentProgressPercent}
        deploymentUnits={deploymentUnits}
        deploymentZonesForCurrent={deploymentZonesForCurrent}
        gameFinished={gameFinished}
        isAutoDeploying={isAutoDeploying}
        onAutoDeploy={handleAutoDeploy}
        onSelectDeploymentUnit={selectDeploymentUnit}
        reserveDeploymentUnits={reserveDeploymentUnits}
        selectedDeploymentActions={selectedDeploymentActions}
        selectedDeploymentUnit={selectedDeploymentUnit}
        uiLocked={uiLocked}
      />
    ) : null

  return (
    <div className="shell shell--immersive-3d">
      <header className="banner">
        <div className="banner__intro">
          <p className="eyebrow">Ancient Battle Sandbox</p>
          <h1 className="banner__title">
            <img className="banner__logo-wordmark" src={LOGO_TEXT_URL} alt="Phalanx Arena" />
          </h1>
        </div>
        <div className="banner__controls-shell">
          <div className="banner__controls">
            {renderScenarioField(null)}
            {renderAiControlField(null)}
          </div>
          {!multiplayerSession ? (
            <details
              className={[
                'viewer-mode-menu',
                'header-ai-menu',
                browserAiReady ? '' : 'header-ai-menu--needs-setup',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <summary
                className="viewer-mode-toggle__button viewer-mode-toggle__button--menu"
                aria-label="AI setup"
                title={browserAiMenuStatus}
              >
                <span className="viewer-mode-toggle__hamburger" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span>AI Setup</span>
                <span className="header-ai-menu__status">{browserAiMenuStatus}</span>
              </summary>
              <div className="viewer-mode-menu__panel header-ai-menu__panel">
                {renderBrowserAiSettingsFields('browser-ai-settings header-ai-menu__settings')}
              </div>
            </details>
          ) : null}
        </div>
        {scenarioDescription ? <p className="banner__scenario-copy">{scenarioDescription}</p> : null}
        <p className="banner__scenario-copy">
          {multiplayerSession
            ? `Online duel ${multiplayerSession.room_code} | ${formatArmyDisplayName(multiplayerSession.army)} | ${formatMultiplayerStatus(multiplayerSession.status)}`
            : describeAiController(aiController)}
          {aiStatus && !multiplayerSession ? ` ${aiStatus}` : ''}
        </p>
        <div className="banner__battlefield-bar">
          <div className="banner__battlefield-copy">
            <p className="banner__battlefield-label">Battlefield</p>
            <p className="banner__battlefield-text">
              {battlefieldCopy}
              {battlefieldContext ? ` ${battlefieldContext}` : ''}
            </p>
          </div>
          {battlefieldActionButtons}
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <main className="workspace workspace--immersive-3d">
        <div className="visualizer-stack visualizer-stack--immersive-3d">
          <section className="table-panel table-panel--immersive-3d">
          <div className="battlefield-shell">
            <div className="battlefield-stage battlefield-stage--3d">
              <div className="battlefield-stage__hud">
                <div className="battlefield-stage__hud-statuses" role="group" aria-label="Battle state">
                  <span className="viewer-mode-toggle__status" aria-label={`Phase ${phaseHudLabel}`}>
                    <span>Phase</span>
                    <strong>{phaseHudLabel}</strong>
                  </span>
                  <span className="viewer-mode-toggle__status" aria-label={`Bound ${state?.bound_number ?? '-'}`}>
                    <span>Bound</span>
                    <strong>{state?.bound_number ?? '-'}</strong>
                  </span>
                  <span
                    className="viewer-mode-toggle__status"
                    aria-label={`Active side ${state?.current_player ? formatArmyDisplayName(state.current_player) : '-'}`}
                  >
                    <span>Active Side</span>
                    <strong>{state?.current_player ? formatArmyDisplayName(state.current_player) : '-'}</strong>
                  </span>
                  <span className="viewer-mode-toggle__status" aria-label={`Action Points ${pipsHudLabel}`}>
                    <span>Action Points</span>
                    <strong>{pipsHudLabel}</strong>
                  </span>
                </div>

                <BattlefieldHudMenus
                  armyMorale={armyMorale}
                  interaction={interaction}
                  onPreviewAction={setPreviewAction}
                  onResolveAction={(action) => void dispatchAction(action)}
                  selectedRecoveryActions={selectedRecoveryActions}
                  selectedUnit={selectedUnit}
                  selectedWarnings={selectedWarnings}
                  state={state}
                  uiLocked={uiLocked}
                />
              </div>

              <section className="battlefield-stage__panel battlefield-stage__panel--3d battlefield-stage__panel--immersive-3d">
                  {deploymentPanel}
                  {snapshot ? (
                    <Suspense fallback={null}>
                      <Battlefield3D
                        initialCameraPreset={initialCameraPreset}
                        interaction={interaction}
                        onCellClick={handleCellClick}
                        onClearPreview={() => setPreviewAction(null)}
                        onPreviewAction={handlePreviewAction}
                        onResolveAction={(action) => void dispatchAction(action)}
                        onLoadStateChange={({ loadStatus, isScenePresented }) => {
                          if (loadStatus === 'error') {
                            setBattlefield3DLoadPhase('error')
                            return
                          }

                          setBattlefield3DLoadPhase(loadStatus === 'ready' && isScenePresented ? 'ready' : 'loading')
                        }}
                        onCombatAnchorChange={(projection) => {
                          if (!projection) {
                            setProjectedCombatAnchor(null)
                            return
                          }

                          const viewport = document.querySelector<HTMLElement>('.battlefield-3d__viewport')
                          if (!viewport) {
                            setProjectedCombatAnchor(null)
                            return
                          }

                          const viewportRect = viewport.getBoundingClientRect()
                          const anchorX = Number.parseFloat(String(projection.anchorStyle.left ?? '0'))
                          const anchorY = Number.parseFloat(String(projection.anchorStyle.top ?? '0'))
                          if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY)) {
                            setProjectedCombatAnchor(null)
                            return
                          }

                          setProjectedCombatAnchor({
                            x: viewportRect.left + anchorX,
                            y: viewportRect.top + anchorY,
                          })
                        }}
                        selectedResolution={selectedResolution}
                        uiLocked={uiLocked}
                      />
                    </Suspense>
                  ) : (
                    battlefield3dLoadingFallback
                  )}
                  {showCommanderChat ? (
                    <CommanderChatPanel
                      aiStatus={aiStatus}
                      aiTurnHistory={aiTurnHistory}
                      currentPlayer={currentPlayer}
                      isAiThinking={isAiThinking}
                      lastAiTurn={lastAiTurn}
                      liveAiDecision={liveAiDecision}
                    />
                  ) : null}
              </section>
            </div>
          </div>
          </section>
        </div>
      </main>

      {battlefield3dLoadingCover}
      {battlefieldSetupModal}
      <BuildStamp />

      {selectedResolution ? (
        <CombatCallout
          resolution={selectedResolution}
          layout={combatCalloutLayout}
          modalRef={resolutionModalRef}
          centeredModalStyle={centeredCombatModalStyle}
          aiController={aiController}
          attackerArmy={attackerArmy}
          defenderArmy={defenderArmy}
          resolutionPositionLabel={resolutionPositionLabel}
          canViewPrevious={canViewPreviousResolution}
          canViewNext={canViewNextResolution}
          onPrevious={() => {
            if (effectiveResolutionIndex === null) {
              return
            }
            setModalResolutionIndex(effectiveResolutionIndex - 1)
          }}
          onNext={() => {
            if (effectiveResolutionIndex === null) {
              return
            }
            setModalResolutionIndex(effectiveResolutionIndex + 1)
          }}
          onClose={() => closeResolutionModal()}
        />
      ) : null}

      {showDeploymentModal && state && deploymentModalTitle && deploymentModalSummary ? (
        <DeploymentIntroModal
          aiController={aiController}
          onClose={closeDeploymentModal}
          state={state}
          summary={deploymentModalSummary}
          title={deploymentModalTitle}
        />
      ) : null}

      {showTurnModal && state && turnModalTitle && turnModalSummary ? (
        <TurnIntroModal
          aiController={aiController}
          onClose={closeTurnModal}
          state={state}
          summary={turnModalSummary}
          title={turnModalTitle}
        />
      ) : null}

      {showWinnerModal && state && winnerModalTitle && winnerModalSummary ? (
        <WinnerModal
          aiController={aiController}
          aiUsageCostCounter={aiUsageCostCounter}
          aiUsageSummary={aiUsageSummary}
          aiUsageTokenCounter={aiUsageTokenCounter}
          onClose={closeWinnerModal}
          onPlayAgain={() => void bootstrapGame(selectedScenarioId)}
          resultLabel={resultLabel}
          state={state}
          summary={winnerModalSummary}
          title={winnerModalTitle}
        />
      ) : null}
    </div>
  )
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'Unknown error'
}

function BuildStamp() {
  return (
    <a
      href={PROJECT_ARTICLE_URL}
      target="_blank"
      rel="noreferrer"
      className="build-stamp"
      aria-label={`Version v${APP_VERSION}. Made by Raphaël Doan / Vestigia`}
    >
      <span>v{APP_VERSION}</span>
      <span className="build-stamp__credit">Made by Raphaël Doan / Vestigia</span>
    </a>
  )
}

export default App
