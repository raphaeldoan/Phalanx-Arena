import type { Dispatch, SetStateAction } from 'react'
import * as THREE from 'three'
import type { BattlefieldInteractionModel, BattlefieldPickTarget } from '../battlefieldInteraction'
import {
  clamp,
  formatArmyDisplayName,
  formatFormationClass,
  formatFormationState,
  formatPipCost,
  formatPursuitClass,
  formatUnitClass,
  formatUnitDisplayLabelForUnit,
  formatUnitName,
  formatUnitQuality,
  groupActionChipLabel,
  groupActionLabel,
  TERRAIN_LABELS,
  unitStatusLabels,
} from '../battlefieldShared'
import type { Coord, Direction, GameState, LegalAction, LogEntry, Unit } from '../types'
import { DISORDER_NOTICE_DURATION_MS, DISORDER_NOTICE_RISE_PX } from './sceneResources'
import {
  buildRotateOverlayWorldPoint,
  coordToWorld,
  resolveDisorderNoticeWorldPoint,
  resolveUnitOverlayWorldPoint,
  type TerrainSurface,
} from './sceneGraph'

export type HoverPointerPosition = {
  height: number
  width: number
  x: number
  y: number
}

export type HtmlOverlayKind = 'rotate' | 'group' | 'shoot' | 'order'

export type HtmlOverlayDescriptor = {
  action: LegalAction
  anchor?: Coord
  id: string
  kind: HtmlOverlayKind
  label: string
  offset: { x: number; y: number }
  tooltip: string
  world?: THREE.Vector3
}

export type UnitStatusOverlayKind =
  | 'steady'
  | 'command'
  | 'ordered_pike'
  | 'disordered'
  | 'disordered_pike'
  | 'panic'
  | 'rout'
  | 'overpursuit'
  | 'reserve'
  | 'off_map'

export type UnitStatusOverlayDescriptor = {
  army: Unit['army']
  id: string
  kind: UnitStatusOverlayKind
  label: string
  moraleValue: number
  offset: { x: number; y: number }
  tooltip: string
  world: THREE.Vector3
}

export type TransientUnitOverlayKind = 'disorder_notice'

export type TransientUnitOverlayDescriptor = {
  createdAt: number
  expiresAt: number
  id: string
  kind: TransientUnitOverlayKind
  label: string
  offset: { x: number; y: number }
  tooltip: string
  world: THREE.Vector3
}

export type MapEdgeOverlayDescriptor = {
  id: string
  kind: 'edge_label'
  label: Direction
  offset: { x: number; y: number }
  tooltip: string
  world: THREE.Vector3
}

export type ScreenOverlayDescriptor =
  | HtmlOverlayDescriptor
  | UnitStatusOverlayDescriptor
  | TransientUnitOverlayDescriptor
  | MapEdgeOverlayDescriptor

export type UnitHoverTooltip = {
  name: string | null
  status: string | null
  summary: string
}

export function hasAnimatingHtmlOverlay(descriptors: ScreenOverlayDescriptor[], currentTime: number): boolean {
  return descriptors.some((descriptor) => descriptor.kind === 'disorder_notice' && descriptor.expiresAt > currentTime)
}

export function isInteractiveOverlayKind(
  kind: HtmlOverlayKind | UnitStatusOverlayKind | TransientUnitOverlayKind | 'edge_label',
): kind is HtmlOverlayKind {
  return kind === 'rotate' || kind === 'group' || kind === 'shoot' || kind === 'order'
}

export function overlayZIndex(
  kind: HtmlOverlayKind | UnitStatusOverlayKind | TransientUnitOverlayKind | 'edge_label',
): string {
  if (kind === 'shoot') {
    return '4'
  }
  if (kind === 'group') {
    return '3'
  }
  if (kind === 'order') {
    return '4'
  }
  if (kind === 'disorder_notice') {
    return '5'
  }
  if (kind === 'edge_label') {
    return '1'
  }
  return '2'
}

export function overlayTransform(descriptor: ScreenOverlayDescriptor, currentTime: number): string {
  if (descriptor.kind !== 'disorder_notice') {
    return 'translate(-50%, -50%)'
  }

  const progress = overlayProgress(descriptor, currentTime)
  const rise = progress * DISORDER_NOTICE_RISE_PX
  const scale = 0.92 + (1 - progress) * 0.14
  return `translate(-50%, calc(-50% - ${rise}px)) scale(${scale})`
}

export function overlayOpacity(descriptor: ScreenOverlayDescriptor, currentTime: number): string {
  if (descriptor.kind !== 'disorder_notice') {
    return '1'
  }

  const progress = overlayProgress(descriptor, currentTime)
  const fadeIn = clamp(progress / 0.14, 0, 1)
  const fadeOut = clamp((1 - progress) / 0.28, 0, 1)
  return `${Math.min(fadeIn, fadeOut)}`
}

export function buildHtmlOverlayDescriptors(
  state: GameState | null,
  interaction: BattlefieldInteractionModel | null,
  hoveredTarget: BattlefieldPickTarget | null,
): HtmlOverlayDescriptor[] {
  if (!state || !interaction) {
    return []
  }

  const descriptors: HtmlOverlayDescriptor[] = []
  const selectedUnit = interaction.selectedUnit

  if (selectedUnit) {
    const recoveryActions = [...interaction.selectedReforms, ...interaction.selectedRallies]
    recoveryActions.forEach((action, index) => {
      descriptors.push({
        action,
        anchor: selectedUnit.position,
        id: `order-${action.type}-${action.unit_id}`,
        kind: 'order',
        label: action.type === 'reform_pike' ? 'Reform' : 'Rally',
        offset: { x: (index - (recoveryActions.length - 1) / 2) * 72, y: -74 },
        tooltip: `${action.type === 'reform_pike' ? 'Reform pike' : 'Rally'} ${selectedUnit.name} (${formatPipCost(action.pip_cost)})`,
      })
    })

    for (const action of interaction.selectedRotations) {
      descriptors.push({
        action,
        id: `rotate-${action.unit_id}-${action.facing}`,
        kind: 'rotate',
        label: action.facing,
        offset: { x: 0, y: 0 },
        tooltip: `Rotate ${selectedUnit.name} to ${action.facing}`,
        world: buildRotateOverlayWorldPoint(selectedUnit, action.facing, state),
      })
    }
  }

  if (interaction.selectedGroupUnits.length > 1) {
    for (const [key, anchors] of interaction.groupActionAnchors.entries()) {
      anchors.forEach((anchor, index) => {
        descriptors.push({
          action: anchor.action,
          anchor: coordFromKey(key),
          id: `group-${anchor.action.type}-${anchor.action.unit_ids.join('-')}-${index}`,
          kind: 'group',
          label: groupActionChipLabel(anchor.action),
          offset: { x: (index - (anchors.length - 1) / 2) * 72, y: -28 },
          tooltip: groupActionLabel(anchor.action),
        })
      })
    }
  }

  for (const { action, target } of interaction.selectedShotTargets) {
    descriptors.push({
      action,
      anchor: target.position,
      id: `shoot-${action.unit_id}-${action.target_id}`,
      kind: 'shoot',
      label: 'Shoot',
      offset: { x: 0, y: -36 },
      tooltip: `Shoot ${target.name} at range ${action.range}`,
    })
  }

  if (hoveredTarget && hoveredTarget.kind === 'unit') {
    const shotAction = interaction.shotTargetsByUnitId.get(hoveredTarget.unit.id)
    if (shotAction) {
      descriptors.push({
        action: shotAction,
        anchor: hoveredTarget.coord,
        id: `hover-shoot-${hoveredTarget.unit.id}`,
        kind: 'shoot',
        label: 'Shoot',
        offset: { x: 0, y: 32 },
        tooltip: `Shoot ${hoveredTarget.unit.name}`,
      })
    }
  }

  return descriptors
}

export function buildUnitStatusOverlayDescriptors(
  state: GameState | null,
  terrainSurfaceMap: Map<string, TerrainSurface>,
): UnitStatusOverlayDescriptor[] {
  if (!state) {
    return []
  }

  const descriptors: UnitStatusOverlayDescriptor[] = []
  for (const unit of state.units) {
    if (unit.eliminated || (state.phase === 'deployment' && !unit.deployed)) {
      continue
    }

    const status = primaryUnitStatus(unit)

    descriptors.push({
      army: unit.army,
      id: `status-${unit.id}-${status.kind}-${unit.army}-${unit.morale_value}`,
      kind: status.kind,
      label: status.label,
      moraleValue: unit.morale_value,
      offset: { x: 0, y: -62 },
      tooltip: buildUnitStatusOverlayTooltip(unit, status.tooltip),
      world: resolveUnitOverlayWorldPoint(unit, state, terrainSurfaceMap),
    })
  }
  return descriptors
}

export function buildTransientDisorderOverlays(
  entries: LogEntry[],
  logOffset: number,
  previousState: GameState,
  nextState: GameState,
  terrainSurfaceMap: Map<string, TerrainSurface>,
  createdAt: number,
): TransientUnitOverlayDescriptor[] {
  const overlays: TransientUnitOverlayDescriptor[] = []
  const candidateUnits = collectUniqueUnits(previousState, nextState)

  entries.forEach((entry, index) => {
    if (!isDisorderLogEntry(entry)) {
      return
    }

    const matchedUnit = matchUnitFromLogEntry(entry.message, candidateUnits)
    if (!matchedUnit) {
      return
    }

    const liveUnit = nextState.units.find((unit) => unit.id === matchedUnit.id) ?? matchedUnit
    overlays.push({
      createdAt,
      expiresAt: createdAt + DISORDER_NOTICE_DURATION_MS,
      id: `disorder-notice-${nextState.game_id}-${logOffset + index}-${liveUnit.id}`,
      kind: 'disorder_notice',
      label: 'Disordered!',
      offset: { x: 0, y: -84 },
      tooltip: entry.message,
      world: resolveDisorderNoticeWorldPoint(liveUnit, nextState, terrainSurfaceMap),
    })
  })

  return overlays
}

export function queueTransientUnitOverlayRemovals(
  overlays: TransientUnitOverlayDescriptor[],
  timeoutIds: Map<string, number>,
  setOverlays: Dispatch<SetStateAction<TransientUnitOverlayDescriptor[]>>,
) {
  const now = performance.now()

  for (const overlay of overlays) {
    const timeoutId = window.setTimeout(() => {
      timeoutIds.delete(overlay.id)
      setOverlays((current) => current.filter((entry) => entry.id !== overlay.id))
    }, Math.max(0, overlay.expiresAt - now))

    timeoutIds.set(overlay.id, timeoutId)
  }
}

export function clearTransientUnitOverlayTimeouts(timeoutIds: Map<string, number>) {
  for (const timeoutId of timeoutIds.values()) {
    window.clearTimeout(timeoutId)
  }
  timeoutIds.clear()
}

export function buildMapEdgeOverlayDescriptors(state: GameState | null): MapEdgeOverlayDescriptor[] {
  if (!state) {
    return []
  }

  const edgeMargin = 1.18
  const centerX = (state.board_width - 1) / 2
  const centerY = (state.board_height - 1) / 2
  const edgeHeight = 0.2

  return [
    {
      id: 'edge-label-n',
      kind: 'edge_label',
      label: 'N',
      offset: { x: 0, y: -16 },
      tooltip: 'North edge',
      world: (() => {
        const world = coordToWorld(centerX, -edgeMargin, state.board_width, state.board_height)
        return new THREE.Vector3(world.x, edgeHeight, world.z)
      })(),
    },
    {
      id: 'edge-label-s',
      kind: 'edge_label',
      label: 'S',
      offset: { x: 0, y: 16 },
      tooltip: 'South edge',
      world: (() => {
        const world = coordToWorld(centerX, state.board_height - 1 + edgeMargin, state.board_width, state.board_height)
        return new THREE.Vector3(world.x, edgeHeight, world.z)
      })(),
    },
    {
      id: 'edge-label-w',
      kind: 'edge_label',
      label: 'W',
      offset: { x: -16, y: 0 },
      tooltip: 'West edge',
      world: (() => {
        const world = coordToWorld(-edgeMargin, centerY, state.board_width, state.board_height)
        return new THREE.Vector3(world.x, edgeHeight, world.z)
      })(),
    },
    {
      id: 'edge-label-e',
      kind: 'edge_label',
      label: 'E',
      offset: { x: 16, y: 0 },
      tooltip: 'East edge',
      world: (() => {
        const world = coordToWorld(state.board_width - 1 + edgeMargin, centerY, state.board_width, state.board_height)
        return new THREE.Vector3(world.x, edgeHeight, world.z)
      })(),
    },
  ]
}

export function buildHoverInfo(target: BattlefieldPickTarget | null, state: GameState | null): string | null {
  if (!target || !state) {
    return null
  }

  const terrain = state.terrain.find((tile) => tile.position.x === target.coord.x && tile.position.y === target.coord.y)?.terrain ?? 'open'
  if (target.kind === 'unit') {
    return null
  }

  return `${target.coord.x},${target.coord.y} / ${TERRAIN_LABELS[terrain]}`
}

export function buildUnitHoverTooltip(target: BattlefieldPickTarget | null): UnitHoverTooltip | null {
  if (!target) {
    return null
  }

  if (target.kind !== 'unit') {
    return null
  }

  const summary = [
    formatUnitDisplayLabelForUnit(target.unit),
    formatUnitQuality(target.unit.quality),
    formatFormationClass(target.unit.formation_class),
    formatUnitClass(target.unit.unit_class),
  ].join(' / ')

  const statusTokens = [
    target.unit.leader ? 'Leader' : null,
    target.unit.in_command ? 'In command' : 'Far from General',
    formatFormationState(target.unit.formation_state),
    `Pursuit ${formatPursuitClass(target.unit.pursuit_class)}`,
    `Loss Value ${target.unit.morale_value}`,
    ...unitStatusLabels(target.unit),
    `Facing ${target.unit.facing}`,
  ].filter((token): token is string => Boolean(token))

  return {
    name: formatUnitName(target.unit),
    summary,
    status: statusTokens.length ? statusTokens.join(' / ') : null,
  }
}

function overlayProgress(descriptor: TransientUnitOverlayDescriptor, currentTime: number): number {
  return clamp((currentTime - descriptor.createdAt) / Math.max(1, descriptor.expiresAt - descriptor.createdAt), 0, 1)
}

function primaryUnitStatus(unit: Unit): { kind: UnitStatusOverlayKind; label: string; tooltip: string } {
  if (!unit.deployed) {
    return { kind: 'reserve', label: 'Reserve', tooltip: `${unit.name} has not deployed yet.` }
  }
  if (unit.off_map) {
    return { kind: 'off_map', label: 'Off map', tooltip: `${unit.name} is off-map in overpursuit.` }
  }
  if (unit.formation_state === 'Rout') {
    return {
      kind: 'rout',
      label: 'Rout',
      tooltip: `${unit.name} is routing.`,
    }
  }
  if (unit.formation_state === 'Panic') {
    return {
      kind: 'panic',
      label: unit.panic_turns_remaining > 0 ? `Panic ${unit.panic_turns_remaining}` : 'Panic',
      tooltip: `${unit.name} is panicked and cannot receive voluntary orders.`,
    }
  }
  if (unit.formation_state === 'Overpursuit') {
    return {
      kind: 'overpursuit',
      label: unit.overpursuit_turns_remaining > 0 ? `Over ${unit.overpursuit_turns_remaining}` : 'Overpursuit',
      tooltip: `${unit.name} is overpursuing and cannot receive orders.`,
    }
  }
  if (unit.formation_state === 'DisorderedPike') {
    return { kind: 'disordered_pike', label: 'Dis Pike', tooltip: `${unit.name} must reform to regain ordered pike.` }
  }
  if (unit.disordered) {
    return { kind: 'disordered', label: 'Dis', tooltip: `${unit.name} is disordered.` }
  }
  if (unit.formation_state === 'OrderedPike') {
    return { kind: 'ordered_pike', label: 'Ord Pike', tooltip: `${unit.name} is in ordered pike formation.` }
  }
  if (!unit.in_command) {
    return { kind: 'command', label: 'No Cmd', tooltip: `${unit.name} is outside command.` }
  }
  return { kind: 'steady', label: 'Steady', tooltip: `${unit.name} is steady.` }
}

function buildUnitStatusOverlayTooltip(unit: Unit, statusTooltip: string): string {
  const commandStatus = unit.in_command ? 'in command' : 'outside command'
  return `${formatArmyDisplayName(unit.army)} ${formatUnitName(unit)}: loss value ${unit.morale_value}, ${formatFormationState(
    unit.formation_state,
  )}, ${commandStatus}. ${statusTooltip}`
}

function collectUniqueUnits(previousState: GameState, nextState: GameState): Unit[] {
  const unitsById = new Map<string, Unit>()
  for (const unit of previousState.units) {
    unitsById.set(unit.id, unit)
  }
  for (const unit of nextState.units) {
    unitsById.set(unit.id, unit)
  }
  return [...unitsById.values()].sort(
    (left, right) => `${right.army} ${right.name}`.length - `${left.army} ${left.name}`.length,
  )
}

function isDisorderLogEntry(entry: LogEntry): boolean {
  return entry.message.includes('became disordered') || entry.message.includes('was disordered in close combat')
}

function matchUnitFromLogEntry(message: string, units: Unit[]): Unit | null {
  for (const unit of units) {
    if (message.startsWith(`${unit.army} ${unit.name}`)) {
      return unit
    }
  }
  return null
}

function coordFromKey(key: string): Coord {
  const [x, y] = key.split(',').map((value) => Number(value))
  return { x, y }
}
