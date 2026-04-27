import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { waitForPaint } from './battlefieldShared'
import { createGameClient } from './gameClient'
import {
  ReplayVideoAbortError,
  buildReplayTimeline,
  downloadReplayVideo,
  recordReplayTimelineVideo,
} from './replayVideo'
import type { ArmyId, GameSnapshot, ReplayData } from './types'

const Battlefield3D = lazy(() => import('./Battlefield3D'))

type ReplayVideoRendererRequest = {
  actionDurationMs?: number
  cameraDistanceScale?: number
  endHoldMs?: number
  fps?: number
  label?: string
  providerLabels?: Partial<Record<ArmyId, string>>
  replay: ReplayData
  startHoldMs?: number
}

type LoadStatus = 'loading' | 'ready' | 'error'

declare global {
  interface Window {
    __PHALANX_REPLAY_VIDEO_DONE__?: (result: { extension: string; mimeType: string }) => void
    __PHALANX_REPLAY_VIDEO_ERROR__?: (message: string) => void
    __PHALANX_REPLAY_VIDEO_REQUEST__?: ReplayVideoRendererRequest
  }
}

function ReplayVideoRenderer() {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null)
  const [status, setStatus] = useState('Preparing replay video renderer...')
  const loadStateRef = useRef<{ errorMessage: string | null; isScenePresented: boolean; loadStatus: LoadStatus }>({
    errorMessage: null,
    isScenePresented: false,
    loadStatus: 'loading',
  })
  const cancelledRef = useRef(false)
  const gameClient = useMemo(() => createGameClient(), [])
  const cameraDistanceScale = window.__PHALANX_REPLAY_VIDEO_REQUEST__?.cameraDistanceScale
  const providerLabels = window.__PHALANX_REPLAY_VIDEO_REQUEST__?.providerLabels

  useEffect(() => {
    cancelledRef.current = false

    async function renderReplayVideo() {
      const request = window.__PHALANX_REPLAY_VIDEO_REQUEST__
      if (!request) {
        throw new Error('Missing replay video request. Launch this renderer through the replay video CLI.')
      }

      const label = request.label?.trim() || `${request.replay.scenario_id} seed ${request.replay.seed}`
      setStatus(`Building replay timeline for ${label}...`)
      const timeline = await buildReplayTimeline(gameClient, request.replay, () => cancelledRef.current)
      if (!timeline.length) {
        throw new Error('Replay timeline is empty.')
      }

      setSnapshot(timeline[0])
      await waitForPaint()
      await waitForBattlefield3DReady(loadStateRef, cancelledRef)

      const canvas = document.querySelector<HTMLCanvasElement>('.battlefield-3d__viewport canvas')
      if (!canvas) {
        throw new Error('The 3D battlefield canvas is not mounted.')
      }

      setStatus(`Recording ${label}...`)
      const video = await recordReplayTimelineVideo({
        canvas,
        timeline,
        endHoldMs: request.endHoldMs,
        fps: request.fps,
        frameDurationMs: request.actionDurationMs,
        isCancelled: () => cancelledRef.current,
        startHoldMs: request.startHoldMs,
        applyFrame: async (nextSnapshot, frameIndex, frameCount) => {
          setSnapshot(nextSnapshot)
          setStatus(`Recording ${label} (${frameIndex + 1}/${frameCount})...`)
          await waitForPaint()
          await waitForPaint()
        },
      })

      setStatus(`Saving ${label}...`)
      downloadReplayVideo(video, label)
      window.__PHALANX_REPLAY_VIDEO_DONE__?.({
        extension: video.extension,
        mimeType: video.mimeType,
      })
    }

    void renderReplayVideo().catch((error) => {
      const message =
        error instanceof ReplayVideoAbortError
          ? 'Replay video recording was cancelled.'
          : error instanceof Error
            ? error.message
            : String(error || 'Replay video recording failed.')
      console.error(error)
      setStatus(message)
      window.__PHALANX_REPLAY_VIDEO_ERROR__?.(message)
    })

    return () => {
      cancelledRef.current = true
    }
  }, [gameClient])

  return (
    <main className="replay-video-renderer">
      {snapshot ? (
        <Suspense fallback={null}>
          <Battlefield3D
            cameraDistanceScale={cameraDistanceScale}
            onLoadStateChange={(state) => {
              loadStateRef.current = state
            }}
            providerLabels={providerLabels}
            state={snapshot.state}
            uiLocked
          />
        </Suspense>
      ) : null}
      <div className="replay-video-renderer__status" role="status" aria-live="polite">
        {status}
      </div>
    </main>
  )
}

async function waitForBattlefield3DReady(
  loadStateRef: React.RefObject<{ errorMessage: string | null; isScenePresented: boolean; loadStatus: LoadStatus }>,
  cancelledRef: React.RefObject<boolean>,
) {
  const startedAt = performance.now()

  while (true) {
    const loadState = loadStateRef.current
    if (cancelledRef.current) {
      throw new ReplayVideoAbortError()
    }
    if (loadState.loadStatus === 'error') {
      throw new Error(loadState.errorMessage ?? 'The 3D battlefield failed to load.')
    }
    if (loadState.loadStatus === 'ready' && loadState.isScenePresented) {
      await waitForPaint()
      await waitForPaint()
      return
    }
    if (performance.now() - startedAt > 30000) {
      throw new Error('Timed out waiting for the 3D battlefield to become ready.')
    }
    await waitForDelay(120)
  }
}

function waitForDelay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs)
  })
}

export default ReplayVideoRenderer
