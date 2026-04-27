import { waitForPaint } from './battlefieldShared'
import type { GameClient } from './gameClient'
import type { Action, GameSnapshot, ReplayData } from './types'

export const REPLAY_VIDEO_FPS = 30
export const REPLAY_VIDEO_ACTION_DURATION_MS = 720
export const REPLAY_VIDEO_START_HOLD_MS = 900
export const REPLAY_VIDEO_END_HOLD_MS = 1400

export type ReplayVideoChoice = {
  id: string
  label: string
  replay: ReplayData
}

export type ReplayVideoBlob = {
  blob: Blob
  extension: string
  mimeType: string
}

type ReplayRecordOptions = {
  applyFrame: (snapshot: GameSnapshot, frameIndex: number, frameCount: number) => Promise<void> | void
  canvas: HTMLCanvasElement
  endHoldMs?: number
  frameDurationMs?: number
  fps?: number
  isCancelled?: () => boolean
  onProgress?: (frameIndex: number, frameCount: number) => void
  startHoldMs?: number
  timeline: GameSnapshot[]
}

export class ReplayVideoAbortError extends Error {
  constructor() {
    super('Replay video recording was cancelled.')
    this.name = 'ReplayVideoAbortError'
  }
}

export async function buildReplayTimeline(
  gameClient: GameClient,
  replay: ReplayData,
  isCancelled?: () => boolean,
): Promise<GameSnapshot[]> {
  throwIfCancelled(isCancelled)
  let snapshot = await gameClient.createGame({
    deployment_first_army: replay.deployment_first_army,
    first_bound_army: replay.first_bound_army,
    scenario_id: replay.scenario_id,
    seed: replay.seed,
  })
  const timeline = [snapshot]

  for (const action of replay.actions) {
    throwIfCancelled(isCancelled)
    snapshot = await gameClient.submitAction(snapshot.state.game_id, action)
    timeline.push(snapshot)
  }

  return timeline
}

export async function recordReplayTimelineVideo({
  applyFrame,
  canvas,
  endHoldMs = REPLAY_VIDEO_END_HOLD_MS,
  fps = REPLAY_VIDEO_FPS,
  frameDurationMs = REPLAY_VIDEO_ACTION_DURATION_MS,
  isCancelled,
  onProgress,
  startHoldMs = REPLAY_VIDEO_START_HOLD_MS,
  timeline,
}: ReplayRecordOptions): Promise<ReplayVideoBlob> {
  if (!timeline.length) {
    throw new Error('Replay timeline is empty.')
  }

  if (typeof canvas.captureStream !== 'function') {
    throw new Error('This browser cannot record canvas video. Use a browser with HTMLCanvasElement.captureStream support.')
  }

  if (typeof MediaRecorder === 'undefined') {
    throw new Error('This browser cannot encode recorded video because MediaRecorder is unavailable.')
  }

  const mimeType = resolveSupportedVideoMimeType()
  const stream = canvas.captureStream(fps)
  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data)
      }
    })
    recorder.addEventListener('stop', () => resolve(), { once: true })
    recorder.addEventListener('error', () => reject(new Error('Video recording failed.')), { once: true })
  })

  let caughtError: unknown = null
  recorder.start(1000)

  try {
    await applyFrame(timeline[0], 0, timeline.length)
    onProgress?.(1, timeline.length)
    await waitForPaint()
    await waitForDuration(startHoldMs, isCancelled)

    for (let frameIndex = 1; frameIndex < timeline.length; frameIndex += 1) {
      throwIfCancelled(isCancelled)
      await applyFrame(timeline[frameIndex], frameIndex, timeline.length)
      onProgress?.(frameIndex + 1, timeline.length)
      await waitForPaint()
      await waitForDuration(frameDurationMs, isCancelled)
    }

    await waitForDuration(endHoldMs, isCancelled)
  } catch (error) {
    caughtError = error
  } finally {
    try {
      if (recorder.state !== 'inactive') {
        recorder.stop()
      }
      await stopped
    } finally {
      for (const track of stream.getTracks()) {
        track.stop()
      }
    }
  }

  if (caughtError) {
    throw caughtError
  }

  const resolvedMimeType = recorder.mimeType || mimeType || 'video/webm'
  return {
    blob: new Blob(chunks, { type: resolvedMimeType }),
    extension: resolvedMimeType.includes('mp4') ? 'mp4' : 'webm',
    mimeType: resolvedMimeType,
  }
}

export function extractReplayVideoChoices(payload: unknown, sourceLabel = 'Replay data'): ReplayVideoChoice[] {
  const choices: ReplayVideoChoice[] = []
  collectReplayVideoChoices(payload, sourceLabel, choices, new Set<object>())
  return choices.map((choice, index) => ({
    ...choice,
    id: `replay-video-choice-${index}`,
  }))
}

export function downloadReplayVideo(video: ReplayVideoBlob, label: string) {
  const link = document.createElement('a')
  const url = URL.createObjectURL(video.blob)
  link.href = url
  link.download = `${sanitizeFilename(label)}.${video.extension}`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function collectReplayVideoChoices(
  value: unknown,
  fallbackLabel: string,
  choices: ReplayVideoChoice[],
  visited: Set<object>,
) {
  if (!value || typeof value !== 'object') {
    return
  }

  if (visited.has(value)) {
    return
  }
  visited.add(value)

  if (isReplayData(value)) {
    choices.push({
      id: '',
      label: replayLabel(value, fallbackLabel),
      replay: normalizeReplayData(value),
    })
    return
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectReplayVideoChoices(entry, `${fallbackLabel} ${index + 1}`, choices, visited))
    return
  }

  const record = value as Record<string, unknown>
  if (isReplayData(record.replay)) {
    choices.push({
      id: '',
      label: replayLabel(record.replay, describeReplayContainer(record, fallbackLabel)),
      replay: normalizeReplayData(record.replay),
    })
  }

  for (const [key, child] of Object.entries(record)) {
    if (key === 'replay') {
      continue
    }
    collectReplayVideoChoices(child, `${fallbackLabel} ${key}`, choices, visited)
  }
}

function replayLabel(replay: ReplayData, fallbackLabel: string): string {
  const actionLabel = `${replay.actions.length} action${replay.actions.length === 1 ? '' : 's'}`
  return `${fallbackLabel} | ${replay.scenario_id} | seed ${replay.seed} | ${actionLabel}`
}

function describeReplayContainer(record: Record<string, unknown>, fallbackLabel: string): string {
  const matchIndex = readFiniteNumber(record.match_index)
  const seed = readFiniteNumber(record.seed)
  const commanderLabels = readCommanderLabels(record.commander_labels)
  const winner = readString(record.winner)
  const pieces = [
    matchIndex !== null ? `Match ${matchIndex}` : null,
    seed !== null ? `seed ${seed}` : null,
    commanderLabels,
    winner ? `winner ${winner}` : null,
  ].filter((piece): piece is string => Boolean(piece))

  return pieces.length ? pieces.join(' | ') : fallbackLabel
}

function readCommanderLabels(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const armyA = readString(record.A)
  const armyB = readString(record.B)
  return armyA && armyB ? `${armyA} vs ${armyB}` : null
}

function isReplayData(value: unknown): value is ReplayData {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    typeof record.scenario_id === 'string' &&
    Number.isFinite(record.seed) &&
    Array.isArray(record.actions) &&
    record.actions.every(isReplayAction)
  )
}

function normalizeReplayData(replay: ReplayData): ReplayData {
  return {
    scenario_id: replay.scenario_id,
    seed: replay.seed,
    deployment_first_army: replay.deployment_first_army,
    first_bound_army: replay.first_bound_army,
    actions: replay.actions.map((action) => ({ ...action })),
  }
}

function isReplayAction(value: unknown): value is Action {
  return Boolean(value && typeof value === 'object' && typeof (value as Record<string, unknown>).type === 'string')
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function resolveSupportedVideoMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ]

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
}

function waitForDuration(durationMs: number, isCancelled?: () => boolean): Promise<void> {
  const startTime = performance.now()

  return new Promise((resolve, reject) => {
    const tick = () => {
      if (isCancelled?.()) {
        reject(new ReplayVideoAbortError())
        return
      }

      if (performance.now() - startTime >= durationMs) {
        resolve()
        return
      }

      window.setTimeout(tick, 80)
    }

    tick()
  })
}

function throwIfCancelled(isCancelled?: () => boolean) {
  if (isCancelled?.()) {
    throw new ReplayVideoAbortError()
  }
}

function sanitizeFilename(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')

  return normalized ? `phalanx-replay-${normalized}`.slice(0, 96).replace(/-$/g, '') : 'phalanx-replay-video'
}
