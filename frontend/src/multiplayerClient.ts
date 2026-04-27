import type { Action, ArmyId, CreateGameRequest, GameSnapshot } from './types'

export type MultiplayerRoomStatus = 'waiting' | 'active' | 'finished'

export type MultiplayerSeatState = {
  connected: boolean
  occupied: boolean
}

export type MultiplayerSeats = Record<ArmyId, MultiplayerSeatState>

export type MultiplayerSession = {
  army: ArmyId
  room_code: string
  seats: MultiplayerSeats
  snapshot: GameSnapshot
  status: MultiplayerRoomStatus
  token: string
}

export type StoredMultiplayerSession = {
  army: ArmyId
  room_code: string
  token: string
}

type MultiplayerServerMessage =
  | ({
      type: 'hello'
    } & MultiplayerSession)
  | {
      action_count?: number
      request_id?: string
      room_code: string
      seats: MultiplayerSeats
      snapshot: GameSnapshot
      status: MultiplayerRoomStatus
      submitted_by?: ArmyId
      type: 'snapshot'
    }
  | {
      room_code: string
      seats: MultiplayerSeats
      status: MultiplayerRoomStatus
      type: 'presence'
    }
  | {
      error: string
      request_id?: string
      type: 'error'
    }
  | {
      type: 'pong'
    }

type MultiplayerConnectionHandlers = {
  onConnectionChange: (connected: boolean) => void
  onError: (message: string) => void
  onPresence: (seats: MultiplayerSeats, status: MultiplayerRoomStatus) => void
  onSnapshot: (session: MultiplayerSession) => void
}

export type MultiplayerConnection = {
  close: () => void
  submitAction: (action: Action) => Promise<GameSnapshot>
}

const STORAGE_KEY = 'phalanx.multiplayer.session'

function apiPrefix(): string {
  const base = import.meta.env.BASE_URL === '/' ? '' : import.meta.env.BASE_URL.replace(/\/$/, '')
  return `${base}/api/multiplayer`
}

function websocketUrl(roomCode: string, token: string): string {
  const base = import.meta.env.BASE_URL === '/' ? '' : import.meta.env.BASE_URL.replace(/\/$/, '')
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${base}/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/ws?token=${encodeURIComponent(token)}`
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : `Request failed with status ${response.status}.`
    throw new Error(message)
  }
  return payload as T
}

export async function createMultiplayerRoom(payload: CreateGameRequest): Promise<MultiplayerSession> {
  const response = await fetch(`${apiPrefix()}/rooms`, {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  return readJsonResponse<MultiplayerSession>(response)
}

export async function joinMultiplayerRoom(roomCode: string): Promise<MultiplayerSession> {
  const response = await fetch(`${apiPrefix()}/rooms/${encodeURIComponent(roomCode)}/join`, {
    body: JSON.stringify({}),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  return readJsonResponse<MultiplayerSession>(response)
}

export async function restoreMultiplayerSession(stored: StoredMultiplayerSession): Promise<MultiplayerSession> {
  const response = await fetch(
    `${apiPrefix()}/rooms/${encodeURIComponent(stored.room_code)}/session?token=${encodeURIComponent(stored.token)}`,
    { method: 'GET' },
  )
  return readJsonResponse<MultiplayerSession>(response)
}

export function storeMultiplayerSession(session: StoredMultiplayerSession): void {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function loadStoredMultiplayerSession(): StoredMultiplayerSession | null {
  const raw = window.sessionStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as StoredMultiplayerSession
    if (
      (parsed.army === 'A' || parsed.army === 'B') &&
      typeof parsed.room_code === 'string' &&
      typeof parsed.token === 'string'
    ) {
      return parsed
    }
  } catch {
    // Ignore malformed session storage values.
  }

  window.sessionStorage.removeItem(STORAGE_KEY)
  return null
}

export function clearStoredMultiplayerSession(): void {
  window.sessionStorage.removeItem(STORAGE_KEY)
}

export function connectMultiplayerSession(
  session: StoredMultiplayerSession,
  handlers: MultiplayerConnectionHandlers,
): MultiplayerConnection {
  let socket: WebSocket | null = null
  let closedByClient = false
  let reconnectTimer: number | null = null
  const pendingRequests = new Map<string, { reject: (error: Error) => void; resolve: (snapshot: GameSnapshot) => void }>()

  function rejectPendingRequests(message: string) {
    for (const pending of pendingRequests.values()) {
      pending.reject(new Error(message))
    }
    pendingRequests.clear()
  }

  function scheduleReconnect() {
    if (closedByClient || reconnectTimer !== null) {
      return
    }
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      openSocket()
    }, 1000)
  }

  function handleMessage(event: MessageEvent<string>) {
    let message: MultiplayerServerMessage
    try {
      message = JSON.parse(String(event.data)) as MultiplayerServerMessage
    } catch {
      handlers.onError('Received an invalid multiplayer message.')
      return
    }

    if (message.type === 'hello') {
      handlers.onSnapshot(message)
      handlers.onPresence(message.seats, message.status)
      return
    }

    if (message.type === 'snapshot') {
      handlers.onSnapshot({
        army: session.army,
        room_code: message.room_code,
        seats: message.seats,
        snapshot: message.snapshot,
        status: message.status,
        token: session.token,
      })
      handlers.onPresence(message.seats, message.status)
      if (message.request_id) {
        const pending = pendingRequests.get(message.request_id)
        if (pending) {
          pending.resolve(message.snapshot)
          pendingRequests.delete(message.request_id)
        }
      }
      return
    }

    if (message.type === 'presence') {
      handlers.onPresence(message.seats, message.status)
      return
    }

    if (message.type === 'error') {
      if (message.request_id) {
        const pending = pendingRequests.get(message.request_id)
        if (pending) {
          pending.reject(new Error(message.error))
          pendingRequests.delete(message.request_id)
          return
        }
      }
      handlers.onError(message.error)
      return
    }
  }

  function openSocket() {
    socket = new WebSocket(websocketUrl(session.room_code, session.token))

    socket.addEventListener('open', () => {
      handlers.onConnectionChange(true)
    })

    socket.addEventListener('close', () => {
      handlers.onConnectionChange(false)
      rejectPendingRequests('Disconnected from the multiplayer room.')
      scheduleReconnect()
    })

    socket.addEventListener('error', () => {
      if (!closedByClient) {
        handlers.onError('The multiplayer connection failed.')
      }
    })

    socket.addEventListener('message', handleMessage)
  }

  openSocket()

  return {
    close() {
      closedByClient = true
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      rejectPendingRequests('Disconnected from the multiplayer room.')
      socket?.close(1000, 'Client closed multiplayer session.')
    },
    submitAction(action) {
      const activeSocket = socket
      if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('The multiplayer room is not connected.'))
      }

      const requestId = crypto.randomUUID()
      return new Promise((resolve, reject) => {
        pendingRequests.set(requestId, { reject, resolve })
        activeSocket.send(JSON.stringify({ action, request_id: requestId, type: 'action' }))
      })
    },
  }
}
