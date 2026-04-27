import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { BattlefieldInteractionModel } from '../battlefieldInteraction'
import { clamp, type CameraPresetId } from '../battlefieldShared'
import type { CombatResolution, GameState } from '../types'
import { TILE_SIZE, TILE_WORLD_SPAN } from './sceneResources'
import {
  coordToWorld,
  resolveArmyCameraRig,
  resolveSelectionFocusPoint,
  resolveTargetFocusPoint,
} from './sceneGraph'

const CAMERA_PRESET_STORAGE_KEY = 'battlefield-3d-camera-preset'

export type CameraBoardBounds = {
  centerX: number
  centerZ: number
  halfSpan: number
}

type ApplyCameraPresetArgs = {
  boardBounds: CameraBoardBounds
  camera: THREE.PerspectiveCamera | null
  controls: OrbitControls | null
  distanceScale?: number
  interaction: BattlefieldInteractionModel | null
  preset: CameraPresetId
  selectedResolution: CombatResolution | null
  state: GameState | null
}

export function readStoredCameraPreset(): CameraPresetId {
  if (typeof window === 'undefined') {
    return 'army_a'
  }

  const stored = window.localStorage.getItem(CAMERA_PRESET_STORAGE_KEY)
  if (
    stored === 'reset' ||
    stored === 'top' ||
    stored === 'isometric' ||
    stored === 'army_a' ||
    stored === 'army_b' ||
    stored === 'focus_selection' ||
    stored === 'focus_target'
  ) {
    return stored
  }

  return 'army_a'
}

export function persistCameraPreset(preset: CameraPresetId) {
  try {
    window.localStorage.setItem(CAMERA_PRESET_STORAGE_KEY, preset)
  } catch {
    // Ignore storage failures.
  }
}

export function constrainControlsTarget(controls: OrbitControls | null, bounds: CameraBoardBounds): boolean {
  if (!controls) {
    return false
  }

  const margin = Math.max(bounds.halfSpan * 0.18, TILE_WORLD_SPAN * 1.25)
  const nextX = clamp(controls.target.x, bounds.centerX - bounds.halfSpan - margin, bounds.centerX + bounds.halfSpan + margin)
  const nextZ = clamp(controls.target.z, bounds.centerZ - bounds.halfSpan - margin, bounds.centerZ + bounds.halfSpan + margin)
  const nextY = 0.8
  const changed =
    Math.abs(controls.target.x - nextX) > 0.0001 ||
    Math.abs(controls.target.y - nextY) > 0.0001 ||
    Math.abs(controls.target.z - nextZ) > 0.0001

  if (!changed) {
    return false
  }

  controls.target.set(nextX, nextY, nextZ)
  return true
}

export function applyCameraPresetToScene({
  boardBounds,
  camera,
  controls,
  distanceScale = 1,
  interaction,
  preset,
  selectedResolution,
  state,
}: ApplyCameraPresetArgs): boolean {
  if (!camera || !controls || !state) {
    return false
  }

  const boardWidth = state.board_width
  const boardHeight = state.board_height
  const boardSpan = Math.max(boardWidth, boardHeight) * TILE_SIZE
  const center = coordToWorld((boardWidth - 1) / 2, (boardHeight - 1) / 2, boardWidth, boardHeight)
  const focus = new THREE.Vector3(center.x, 0.8, center.z)

  const selectionFocus = resolveSelectionFocusPoint(interaction, state) ?? focus
  const armyCameraRig =
    preset === 'army_a'
      ? resolveArmyCameraRig(state, 'A', boardSpan, camera)
      : preset === 'army_b'
        ? resolveArmyCameraRig(state, 'B', boardSpan, camera)
        : null
  const target =
    preset === 'focus_selection'
      ? selectionFocus
      : preset === 'focus_target'
        ? resolveTargetFocusPoint(state, selectedResolution) ?? selectionFocus
        : armyCameraRig?.target ?? focus
  controls.target.copy(target)
  constrainControlsTarget(controls, boardBounds)
  target.copy(controls.target)

  if (preset === 'top') {
    camera.position.set(target.x, boardSpan * 1.15, target.z + 0.001)
  } else if (preset === 'army_a') {
    camera.position.copy(armyCameraRig?.position ?? new THREE.Vector3(target.x, boardSpan * 0.34, target.z - boardSpan * 0.48))
  } else if (preset === 'army_b') {
    camera.position.copy(armyCameraRig?.position ?? new THREE.Vector3(target.x, boardSpan * 0.34, target.z + boardSpan * 0.48))
  } else if (preset === 'focus_target' && selectedResolution) {
    camera.position.copy(resolveResolutionCameraPosition(state, selectedResolution, target, boardSpan))
  } else if (preset === 'focus_selection' || preset === 'focus_target') {
    camera.position.set(target.x + boardSpan * 0.35, boardSpan * 0.42, target.z + boardSpan * 0.42)
  } else {
    camera.position.set(target.x + boardSpan * 0.42, boardSpan * 0.46, target.z + boardSpan * 0.55)
  }

  if (Number.isFinite(distanceScale) && distanceScale > 0 && Math.abs(distanceScale - 1) > 0.001) {
    camera.position.lerp(target, clamp(1 - distanceScale, -1, 0.82))
  }

  camera.updateProjectionMatrix()
  controls.update()
  return true
}

function resolveResolutionCameraPosition(
  state: GameState,
  resolution: CombatResolution,
  target: THREE.Vector3,
  boardSpan: number,
): THREE.Vector3 {
  const attacker = coordToWorld(resolution.attacker_position.x, resolution.attacker_position.y, state.board_width, state.board_height)
  const defender = coordToWorld(resolution.defender_position.x, resolution.defender_position.y, state.board_width, state.board_height)
  const attackVector = new THREE.Vector3(defender.x - attacker.x, 0, defender.z - attacker.z)
  const engagementSpan = Math.max(attackVector.length(), TILE_SIZE)
  const sideDirection =
    attackVector.lengthSq() > 0.0001
      ? new THREE.Vector3(-attackVector.z, 0, attackVector.x).normalize()
      : new THREE.Vector3(1, 0, 1).normalize()
  sideDirection.add(new THREE.Vector3(0.35, 0, 0.45)).normalize()

  const horizontalDistance = clamp(
    engagementSpan * (resolution.kind === 'missile' ? 1.3 : 0.85) + TILE_SIZE * (resolution.kind === 'missile' ? 3.6 : 3.2),
    TILE_SIZE * 3.6,
    boardSpan * 0.7,
  )
  const height = clamp(horizontalDistance * 0.58, TILE_SIZE * 2.2, boardSpan * 0.36)

  return new THREE.Vector3(
    target.x + sideDirection.x * horizontalDistance,
    target.y + height,
    target.z + sideDirection.z * horizontalDistance,
  )
}
