import initEngineWasm, {
  EngineHandle,
  list_scenarios_json,
} from './generated/engine-wasm/engine_wasm'
import type {
  Action,
  CreateGameRequest,
  GameSnapshot,
  ReplayData,
  ScenarioSummary,
} from './types'

type BrowserGameClientAdapter = {
  listScenarios(): Promise<ScenarioSummary[]>
  createGame(payload: CreateGameRequest): Promise<GameSnapshot>
  submitAction(gameId: string, action: Action): Promise<GameSnapshot>
  undoGame(gameId: string): Promise<GameSnapshot>
  fetchReplay(gameId: string): Promise<ReplayData>
  createGameFromReplay(payload: ReplayData): Promise<GameSnapshot>
  dropGame(gameId: string): Promise<void>
}

type WindowWithGameClient = Window & {
  __PHALANX_WASM_GAME_CLIENT__?: BrowserGameClientAdapter
}

const handles = new Map<string, EngineHandle>()

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T
}

function normalizeSnapshot(payload: unknown): GameSnapshot {
  if (
    payload &&
    typeof payload === 'object' &&
    'state' in payload &&
    payload.state &&
    typeof payload.state === 'object'
  ) {
    return payload as GameSnapshot
  }

  if (
    payload &&
    typeof payload === 'object' &&
    'snapshot' in payload &&
    payload.snapshot &&
    typeof payload.snapshot === 'object'
  ) {
    return (payload as { snapshot: GameSnapshot }).snapshot
  }

  throw new Error('Local engine returned an invalid snapshot payload.')
}

function getHandle(gameId: string): EngineHandle {
  const handle = handles.get(gameId)
  if (!handle) {
    throw new Error(`Unknown local game id: ${gameId}`)
  }
  return handle
}

function snapshotFromHandle(handle: EngineHandle): GameSnapshot {
  return normalizeSnapshot(parseJson<unknown>(handle.snapshot_json()))
}

function registerHandle(handle: EngineHandle): GameSnapshot {
  const snapshot = snapshotFromHandle(handle)
  handles.set(snapshot.state.game_id, handle)
  return snapshot
}

function createAdapter(): BrowserGameClientAdapter {
  return {
    async listScenarios() {
      return parseJson<ScenarioSummary[]>(list_scenarios_json())
    },
    async createGame(payload) {
      const deploymentFirstArmy = payload.deployment_first_army ?? 'A'
      const firstBoundArmy = payload.first_bound_army ?? deploymentFirstArmy
      const handle = EngineHandle.new_with_roles
        ? EngineHandle.new_with_roles(payload.scenario_id, BigInt(payload.seed), deploymentFirstArmy, firstBoundArmy)
        : new EngineHandle(payload.scenario_id, BigInt(payload.seed))
      return registerHandle(handle)
    },
    async submitAction(gameId, action) {
      const handle = getHandle(gameId)
      return normalizeSnapshot(parseJson<unknown>(handle.apply_action_json(JSON.stringify(action))))
    },
    async undoGame(gameId) {
      const handle = getHandle(gameId)
      return normalizeSnapshot(parseJson<unknown>(handle.undo_json()))
    },
    async fetchReplay(gameId) {
      const handle = getHandle(gameId)
      return parseJson<ReplayData>(handle.replay_json())
    },
    async createGameFromReplay(payload) {
      const deploymentFirstArmy = payload.deployment_first_army ?? 'A'
      const firstBoundArmy = payload.first_bound_army ?? deploymentFirstArmy
      const handle = EngineHandle.new_with_roles
        ? EngineHandle.new_with_roles(payload.scenario_id, BigInt(payload.seed), deploymentFirstArmy, firstBoundArmy)
        : new EngineHandle(payload.scenario_id, BigInt(payload.seed))
      for (const action of payload.actions) {
        handle.apply_action_json(JSON.stringify(action))
      }
      return registerHandle(handle)
    },
    async dropGame(gameId) {
      const handle = getHandle(gameId)
      handles.delete(gameId)
      handle.free()
    },
  }
}

export async function installWasmGameClient(): Promise<void> {
  if (typeof window === 'undefined') {
    return
  }
  const browserWindow = window as WindowWithGameClient
  if (browserWindow.__PHALANX_WASM_GAME_CLIENT__) {
    return
  }
  await initEngineWasm()
  browserWindow.__PHALANX_WASM_GAME_CLIENT__ = createAdapter()
}
