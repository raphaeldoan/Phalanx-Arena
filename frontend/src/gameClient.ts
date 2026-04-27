import type {
  Action,
  CreateGameRequest,
  GameSnapshot,
  ReplayData,
  ScenarioSummary,
} from './types'

export interface GameClient {
  listScenarios(): Promise<ScenarioSummary[]>
  createGame(payload: CreateGameRequest): Promise<GameSnapshot>
  submitAction(gameId: string, action: Action): Promise<GameSnapshot>
  undoGame(gameId: string): Promise<GameSnapshot>
  fetchReplay(gameId: string): Promise<ReplayData>
  createGameFromReplay(payload: ReplayData): Promise<GameSnapshot>
  dropGame(gameId: string): Promise<void>
}

type BrowserGameClientAdapter = GameClient

function hasBrowserAdapter(candidate: unknown): candidate is BrowserGameClientAdapter {
  if (!candidate || typeof candidate !== 'object') {
    return false
  }

  const methods: Array<keyof BrowserGameClientAdapter> = [
    'listScenarios',
    'createGame',
    'submitAction',
    'undoGame',
    'fetchReplay',
    'createGameFromReplay',
    'dropGame',
  ]

  return methods.every((method) => typeof (candidate as Record<string, unknown>)[method] === 'function')
}

function resolveBrowserAdapter(): BrowserGameClientAdapter {
  if (typeof window === 'undefined') {
    throw new Error('The local WASM game client is only available in the browser.')
  }

  const candidate = (window as Window & { __PHALANX_WASM_GAME_CLIENT__?: unknown }).__PHALANX_WASM_GAME_CLIENT__
  if (!hasBrowserAdapter(candidate)) {
    throw new Error('The local WASM game client failed to initialize. Reload after the WASM bundle finishes building.')
  }

  return candidate
}

export function createGameClient(): GameClient {
  return resolveBrowserAdapter()
}

