import { DurableObject } from 'cloudflare:workers'
import initEngineWasm, {
  EngineHandle,
  list_scenarios_json,
} from './generated/engine-wasm/engine_wasm.js'
import engineWasmModule from './generated/engine-wasm/engine_wasm_bg.wasm'

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ROOM_CODE_LENGTH = 6
const ROOM_STORAGE_KEY = 'room'
const DEFAULT_SCENARIO_ID = 'classic_battle'
const DEFAULT_SEED = 7

let engineReadyPromise = null

function ensureEngineReady() {
  if (!engineReadyPromise) {
    engineReadyPromise = initEngineWasm({ module_or_path: engineWasmModule })
  }
  return engineReadyPromise
}

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      ...init.headers,
    },
  })
}

function textResponse(message, init = {}) {
  return new Response(message, {
    ...init,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      ...init.headers,
    },
  })
}

async function parseJsonBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return {}
  }
  const text = await request.text()
  if (!text.trim()) {
    return {}
  }
  return JSON.parse(text)
}

function createRoomCode() {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join('')
}

function normalizeRoomCode(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function randomToken() {
  return crypto.randomUUID()
}

function isMultiplayerPath(pathname) {
  return pathname.startsWith('/api/multiplayer') || pathname.startsWith('/phalanxarena/api/multiplayer')
}

function multiplayerPathname(pathname) {
  return pathname.startsWith('/phalanxarena/api/multiplayer')
    ? pathname.slice('/phalanxarena'.length)
    : pathname
}

function roomStub(env, roomCode) {
  const id = env.MATCH_ROOMS.idFromName(roomCode)
  return env.MATCH_ROOMS.get(id)
}

async function fetchRoom(env, roomCode, path, init = {}) {
  const url = new URL(`https://phalanx-room.local${path}`)
  url.searchParams.set('room_code', roomCode)
  return roomStub(env, roomCode).fetch(new Request(url, init))
}

async function handleCreateRoom(request, env) {
  const payload = await parseJsonBody(request)
  const scenarioId = typeof payload.scenario_id === 'string' && payload.scenario_id.trim()
    ? payload.scenario_id.trim()
    : DEFAULT_SCENARIO_ID
  const seed = Number.isSafeInteger(payload.seed) && payload.seed >= 0 ? payload.seed : DEFAULT_SEED
  const roomPayload = {
    deployment_first_army: payload.deployment_first_army === 'B' ? 'B' : 'A',
    first_bound_army: payload.first_bound_army === 'B' ? 'B' : 'A',
    scenario_id: scenarioId,
    seed,
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const roomCode = createRoomCode()
    const response = await fetchRoom(env, roomCode, '/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(roomPayload),
    })
    if (response.status !== 409) {
      return response
    }
  }

  return jsonResponse({ error: 'Could not allocate a unique room code. Try again.' }, { status: 503 })
}

async function handleJoinRoom(request, env, roomCode) {
  return fetchRoom(env, roomCode, '/join', {
    method: 'POST',
    headers: { 'Content-Type': request.headers.get('Content-Type') ?? 'application/json' },
    body: await request.text(),
  })
}

async function handleRoomSession(request, env, roomCode) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token') ?? request.headers.get('X-Player-Token') ?? ''
  return fetchRoom(env, roomCode, `/session?token=${encodeURIComponent(token)}`, { method: 'GET' })
}

async function handleRoomSocket(request, env, roomCode) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token') ?? ''
  return roomStub(env, roomCode).fetch(
    new Request(`https://phalanx-room.local/ws?room_code=${encodeURIComponent(roomCode)}&token=${encodeURIComponent(token)}`, {
      headers: request.headers,
      method: request.method,
    }),
  )
}

async function handleMultiplayerRequest(request, env) {
  const url = new URL(request.url)
  const pathname = multiplayerPathname(url.pathname)

  if (pathname === '/api/multiplayer/rooms' && request.method === 'POST') {
    return handleCreateRoom(request, env)
  }

  const match = pathname.match(/^\/api\/multiplayer\/rooms\/([A-Za-z0-9-]+)\/(join|session|ws)$/)
  if (!match) {
    return jsonResponse({ error: 'Unknown multiplayer endpoint.' }, { status: 404 })
  }

  const roomCode = normalizeRoomCode(match[1])
  if (roomCode.length !== ROOM_CODE_LENGTH) {
    return jsonResponse({ error: 'Invalid room code.' }, { status: 400 })
  }

  const action = match[2]
  if (action === 'join' && request.method === 'POST') {
    return handleJoinRoom(request, env, roomCode)
  }
  if (action === 'session' && request.method === 'GET') {
    return handleRoomSession(request, env, roomCode)
  }
  if (action === 'ws' && request.method === 'GET') {
    return handleRoomSocket(request, env, roomCode)
  }

  return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
}

function parseJson(value) {
  return JSON.parse(value)
}

function createHandle(room) {
  const deploymentFirstArmy = room.deployment_first_army ?? 'A'
  const firstBoundArmy = room.first_bound_army ?? deploymentFirstArmy
  const handle = EngineHandle.new_with_roles
    ? EngineHandle.new_with_roles(room.scenario_id, BigInt(room.seed), deploymentFirstArmy, firstBoundArmy)
    : new EngineHandle(room.scenario_id, BigInt(room.seed))

  for (const action of room.actions) {
    handle.apply_action_json(JSON.stringify(action))
  }

  return handle
}

function normalizeSnapshotForRoom(snapshot, room) {
  snapshot.state.game_id = room.code
  snapshot.can_undo = false
  return snapshot
}

function publicSeats(room, sessions) {
  return {
    A: {
      occupied: Boolean(room.seats.A?.token),
      connected: [...sessions.values()].some((session) => session.army === 'A'),
    },
    B: {
      occupied: Boolean(room.seats.B?.token),
      connected: [...sessions.values()].some((session) => session.army === 'B'),
    },
  }
}

function playerForToken(room, token) {
  if (room.seats.A?.token === token) {
    return { army: 'A', token }
  }
  if (room.seats.B?.token === token) {
    return { army: 'B', token }
  }
  return null
}

function roomStatus(room) {
  if (room.status === 'finished') {
    return 'finished'
  }
  return room.seats.A?.token && room.seats.B?.token ? 'active' : 'waiting'
}

function playerPayload(room, player, snapshot, sessions) {
  return {
    army: player.army,
    room_code: room.code,
    seats: publicSeats(room, sessions),
    snapshot,
    status: roomStatus(room),
    token: player.token,
  }
}

export class MatchRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.ctx = ctx
    this.env = env
    this.handle = null
    this.room = null
    this.roomPromise = null
    this.sessions = new Map()

    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment()
      if (attachment?.token && attachment?.army) {
        this.sessions.set(ws, attachment)
      }
    }
  }

  async fetch(request) {
    const url = new URL(request.url)
    const pathname = url.pathname

    try {
      if (pathname === '/create' && request.method === 'POST') {
        return this.createRoom(url.searchParams.get('room_code'), await parseJsonBody(request))
      }
      if (pathname === '/join' && request.method === 'POST') {
        return this.joinRoom(await parseJsonBody(request))
      }
      if (pathname === '/session' && request.method === 'GET') {
        return this.getSession(url.searchParams.get('token') ?? '')
      }
      if (pathname === '/ws' && request.method === 'GET') {
        return this.connectWebSocket(request, url.searchParams.get('token') ?? '')
      }
    } catch (error) {
      const status = error.message === 'Room does not exist.' ? 404 : 500
      return jsonResponse({ error: error.message || String(error) }, { status })
    }

    return jsonResponse({ error: 'Unknown room endpoint.' }, { status: 404 })
  }

  async createRoom(roomCode, payload) {
    await ensureEngineReady()
    const existing = await this.ctx.storage.get(ROOM_STORAGE_KEY)
    if (existing) {
      return jsonResponse({ error: 'Room already exists.' }, { status: 409 })
    }

    const scenarioId = payload.scenario_id || DEFAULT_SCENARIO_ID
    const seed = Number.isSafeInteger(payload.seed) && payload.seed >= 0 ? payload.seed : DEFAULT_SEED
    const room = {
      actions: [],
      code: normalizeRoomCode(roomCode),
      created_at: new Date().toISOString(),
      deployment_first_army: payload.deployment_first_army === 'B' ? 'B' : 'A',
      first_bound_army: payload.first_bound_army === 'B' ? 'B' : 'A',
      scenario_id: scenarioId,
      seats: {
        A: { token: randomToken() },
        B: null,
      },
      seed,
      status: 'waiting',
      updated_at: new Date().toISOString(),
    }

    let snapshot
    try {
      this.handle = createHandle(room)
      snapshot = normalizeSnapshotForRoom(parseJson(this.handle.snapshot_json()), room)
    } catch (error) {
      this.handle = null
      return jsonResponse({ error: error.message || String(error) }, { status: 400 })
    }

    await this.persistRoom(room)
    return jsonResponse(playerPayload(room, { army: 'A', token: room.seats.A.token }, snapshot, this.sessions), {
      status: 201,
    })
  }

  async joinRoom(payload) {
    const room = await this.requireRoom()
    await ensureEngineReady()

    const requestedToken = typeof payload.token === 'string' ? payload.token : ''
    const existingPlayer = requestedToken ? playerForToken(room, requestedToken) : null
    if (existingPlayer) {
      const snapshot = await this.currentSnapshot()
      return jsonResponse(playerPayload(room, existingPlayer, snapshot, this.sessions))
    }

    if (room.seats.B?.token) {
      return jsonResponse({ error: 'Room is already full.' }, { status: 409 })
    }

    room.seats.B = { token: randomToken() }
    room.status = roomStatus(room)
    room.updated_at = new Date().toISOString()
    await this.persistRoom(room)
    const snapshot = await this.currentSnapshot()
    this.broadcast({
      room_code: room.code,
      seats: publicSeats(room, this.sessions),
      snapshot,
      status: roomStatus(room),
      type: 'snapshot',
    })
    return jsonResponse(playerPayload(room, { army: 'B', token: room.seats.B.token }, snapshot, this.sessions))
  }

  async getSession(token) {
    const room = await this.requireRoom()
    const player = playerForToken(room, token)
    if (!player) {
      return jsonResponse({ error: 'Invalid player token.' }, { status: 403 })
    }

    return jsonResponse(playerPayload(room, player, await this.currentSnapshot(), this.sessions))
  }

  async connectWebSocket(request, token) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return textResponse('Expected WebSocket upgrade.', { status: 426 })
    }

    const room = await this.requireRoom()
    const player = playerForToken(room, token)
    if (!player) {
      return textResponse('Invalid player token.', { status: 403 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    const attachment = { army: player.army, token: player.token }
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment(attachment)
    this.sessions.set(server, attachment)
    server.send(
      JSON.stringify({
        ...playerPayload(room, player, await this.currentSnapshot(), this.sessions),
        type: 'hello',
      }),
    )
    this.broadcastPresence()

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws, message) {
    const session = this.sessions.get(ws) ?? ws.deserializeAttachment()
    if (!session) {
      ws.send(JSON.stringify({ error: 'Unknown WebSocket session.', type: 'error' }))
      ws.close(1008, 'Unknown session')
      return
    }

    let payload
    try {
      payload = JSON.parse(String(message))
    } catch {
      ws.send(JSON.stringify({ error: 'Invalid JSON message.', type: 'error' }))
      return
    }

    if (payload.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }))
      return
    }

    if (payload.type !== 'action') {
      ws.send(JSON.stringify({ error: 'Unknown message type.', request_id: payload.request_id, type: 'error' }))
      return
    }

    await this.applyPlayerAction(ws, session, payload)
  }

  async webSocketClose(ws) {
    this.sessions.delete(ws)
    this.broadcastPresence()
  }

  async webSocketError(ws) {
    this.sessions.delete(ws)
    this.broadcastPresence()
  }

  async applyPlayerAction(ws, session, payload) {
    const room = await this.requireRoom()
    const player = playerForToken(room, session.token)
    if (!player) {
      ws.send(JSON.stringify({ error: 'Invalid player token.', request_id: payload.request_id, type: 'error' }))
      return
    }
    if (roomStatus(room) !== 'active') {
      ws.send(JSON.stringify({ error: 'The match is waiting for the second player.', request_id: payload.request_id, type: 'error' }))
      return
    }

    const snapshot = await this.currentSnapshot()
    if (snapshot.state.current_player !== player.army) {
      ws.send(JSON.stringify({ error: 'It is not your turn.', request_id: payload.request_id, type: 'error' }))
      return
    }

    try {
      const handle = await this.ensureHandle()
      const nextSnapshot = normalizeSnapshotForRoom(
        parseJson(handle.apply_action_json(JSON.stringify(payload.action))),
        room,
      )
      room.actions.push(payload.action)
      room.status = nextSnapshot.state.winner || nextSnapshot.state.draw ? 'finished' : roomStatus(room)
      room.updated_at = new Date().toISOString()
      await this.persistRoom(room)
      this.broadcast({
        action_count: room.actions.length,
        request_id: payload.request_id,
        room_code: room.code,
        seats: publicSeats(room, this.sessions),
        snapshot: nextSnapshot,
        status: roomStatus(room),
        submitted_by: player.army,
        type: 'snapshot',
      })
    } catch (error) {
      ws.send(JSON.stringify({ error: error.message || String(error), request_id: payload.request_id, type: 'error' }))
    }
  }

  async requireRoom() {
    const room = await this.loadRoom()
    if (!room) {
      throw new Error('Room does not exist.')
    }
    return room
  }

  async loadRoom() {
    if (!this.roomPromise) {
      this.roomPromise = this.ctx.storage.get(ROOM_STORAGE_KEY).then((room) => {
        this.room = room ?? null
        return this.room
      })
    }
    return this.roomPromise
  }

  async persistRoom(room) {
    this.room = room
    this.roomPromise = Promise.resolve(room)
    await this.ctx.storage.put(ROOM_STORAGE_KEY, room)
  }

  async ensureHandle() {
    if (!this.handle) {
      await ensureEngineReady()
      this.handle = createHandle(await this.requireRoom())
    }
    return this.handle
  }

  async currentSnapshot() {
    const room = await this.requireRoom()
    const handle = await this.ensureHandle()
    return normalizeSnapshotForRoom(parseJson(handle.snapshot_json()), room)
  }

  broadcastPresence() {
    if (!this.room) {
      return
    }
    this.broadcast({
      room_code: this.room.code,
      seats: publicSeats(this.room, this.sessions),
      status: roomStatus(this.room),
      type: 'presence',
    })
  }

  broadcast(payload) {
    const message = JSON.stringify(payload)
    for (const ws of this.sessions.keys()) {
      try {
        ws.send(message)
      } catch {
        this.sessions.delete(ws)
      }
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/phalanxbench' || url.pathname.startsWith('/phalanxbench/')) {
      return textResponse('Phalanx Arena has moved to /phalanxarena.', { status: 410 })
    }
    if (isMultiplayerPath(url.pathname)) {
      try {
        return await handleMultiplayerRequest(request, env)
      } catch (error) {
        return jsonResponse({ error: error.message || String(error) }, { status: 500 })
      }
    }
    if (url.pathname === '/api/scenarios' || url.pathname === '/phalanxarena/api/scenarios') {
      await ensureEngineReady()
      return jsonResponse(parseJson(list_scenarios_json()))
    }
    return env.ASSETS.fetch(request)
  },
}
