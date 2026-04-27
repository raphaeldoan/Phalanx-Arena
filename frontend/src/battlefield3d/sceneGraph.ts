import type { CSSProperties } from 'react'
import * as THREE from 'three'
import type { BattlefieldInteractionModel, BattlefieldPickTarget } from '../battlefieldInteraction'
import { clamp, isInDeploymentZone, keyForCoord } from '../battlefieldShared'
import type {
  ArmyId,
  CombatResolution,
  Coord,
  Direction,
  GameState,
  LegalAction,
  TerrainType,
  Unit,
} from '../types'
import {
  ANIMATION_PHASE_BUCKETS,
  BLOB_SHADOW_LIFT,
  CROWD_VARIANT_ORDER,
  DISORDER_NOTICE_WORLD_LIFT,
  DISORDER_EMISSIVE_COLOR,
  DISORDER_PULSE_RATE,
  DISORDER_TINT_COLOR,
  FOREST_TREE_COUNT,
  FOREST_TREE_HEIGHT_OFFSET,
  FOREST_TREE_MARGIN,
  FOREST_TREE_MIN_SPACING,
  FOREST_TREE_SCALE_JITTER,
  FORMATION_EDGE_MARGIN,
  FORMATION_GROUND_OFFSET,
  HILL_PEAK_HEIGHT,
  HILL_SLOPE_DISTANCE,
  SELECTION_INDICATOR_GROUND_OFFSET,
  TILE_BORDER_LIFT,
  TILE_SIZE,
  TILE_SUBDIVISIONS,
  TILE_WORLD_SPAN,
  VOLLEY_ARC_HEIGHT,
  VOLLEY_EDGE_OFFSET,
  VOLLEY_IMPACT_HEIGHT,
  VOLLEY_LAUNCH_HEIGHT,
  VOLLEY_LOOP_DURATION,
  VOLLEY_MODEL_YAW_OFFSET,
  applyMatteMaterialFinish,
  collectRenderableMeshes,
  createRoadTerrainMaterial,
  createWaterTerrainMaterial,
  disposeWaterMaterialStates,
  type ConnectedTileMaskSelection,
  type CrowdTemplate,
  type CrowdTemplates,
  type CrowdVariant,
  type TerrainMaterials,
  type TerrainTemplate,
  type VolleyTemplate,
  type WaterAssets,
  type WaterMaterialState,
  type WaterTileSelection,
} from './sceneResources'

type FormationConfig = {
  columns: number
  rows: number
  columnSpacing: number
  rowSpacing: number
  fillWidth?: boolean
  depthJitter?: number
  lateralJitter?: number
  rotationJitter?: number
  skipChance?: number
}

type FormationSlotDescriptor = {
  bucketIndex: number
  depthJitter: number
  lateralJitter: number
  rotationJitter: number
}

export type CombatAnchorProjection = {
  anchorStyle: CSSProperties
  side: 'left' | 'right'
}

type ActiveVolleySignal = {
  attackerFacing: Direction | null
  attackerId: string
  attackerPosition: Coord
  key: string
  targetId: string
  targetFacing: Direction | null
  targetPosition: Coord
}

export type ActiveVolleyState = {
  action: THREE.AnimationAction | null
  arcHeight: number
  duration: number
  end: THREE.Vector3
  key: string
  mixer: THREE.AnimationMixer | null
  model: THREE.Group
  start: THREE.Vector3
}

export type CrowdAnimationState = {
  activeFrames: number[]
  clipDuration: number
  frameCount: number
  phaseFrameOffsets: number[]
  phaseMeshes: THREE.InstancedMesh[][][]
}

type PhaseMatrixBuckets = {
  disordered: THREE.Matrix4[][]
  normal: THREE.Matrix4[][]
}

export type DisorderedPulseMaterialState = {
  colorBase: THREE.Color | null
  emissiveBase: THREE.Color | null
  emissiveIntensityBase: number | null
  material: THREE.Material
}

type HillTileData = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  northExposed: boolean
  eastExposed: boolean
  southExposed: boolean
  westExposed: boolean
}

type ForestTileData = {
  northConnected: boolean
  eastConnected: boolean
  southConnected: boolean
  westConnected: boolean
}

const EMPTY_FOREST_TILE_DATA: ForestTileData = {
  northConnected: false,
  eastConnected: false,
  southConnected: false,
  westConnected: false,
}

type TerrainSurfaceTriangle = {
  a: THREE.Vector3
  b: THREE.Vector3
  c: THREE.Vector3
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type TerrainSurface = {
  triangles: TerrainSurfaceTriangle[]
}

const FORMATION_CONFIGS: Record<CrowdVariant, FormationConfig> = {
  spear: {
    columns: 12,
    rows: 3,
    columnSpacing: 0.22,
    rowSpacing: 0.34,
  },
  pike: {
    columns: 12,
    rows: 3,
    columnSpacing: 0.22,
    rowSpacing: 0.34,
  },
  archer: {
    columns: 12,
    rows: 3,
    columnSpacing: 0.22,
    rowSpacing: 0.34,
  },
  slinger: {
    columns: 10,
    rows: 2,
    columnSpacing: 0.24,
    rowSpacing: 0.38,
    fillWidth: true,
    depthJitter: 0.04,
    lateralJitter: 0.08,
    rotationJitter: 0.12,
    skipChance: 0.14,
  },
  imitation_legionary: {
    columns: 12,
    rows: 3,
    columnSpacing: 0.22,
    rowSpacing: 0.34,
  },
  thorakitai: {
    columns: 12,
    rows: 3,
    columnSpacing: 0.22,
    rowSpacing: 0.34,
  },
  gallic_mercenary: {
    columns: 10,
    rows: 3,
    columnSpacing: 0.24,
    rowSpacing: 0.36,
    fillWidth: true,
    depthJitter: 0.04,
    lateralJitter: 0.08,
    rotationJitter: 0.12,
    skipChance: 0.08,
  },
  psilos: {
    columns: 7,
    rows: 2,
    columnSpacing: 0.28,
    rowSpacing: 0.42,
    fillWidth: true,
    depthJitter: 0.08,
    lateralJitter: 0.12,
    rotationJitter: 0.2,
    skipChance: 0.28,
  },
  cavalry: {
    columns: 8,
    rows: 3,
    columnSpacing: 0.22,
    rowSpacing: 0.34,
    fillWidth: true,
  },
  cataphract: {
    columns: 7,
    rows: 3,
    columnSpacing: 0.24,
    rowSpacing: 0.34,
    fillWidth: true,
  },
  bow_cavalry: {
    columns: 8,
    rows: 3,
    columnSpacing: 0.22,
    rowSpacing: 0.34,
    fillWidth: true,
  },
  light_cavalry: {
    columns: 8,
    rows: 3,
    columnSpacing: 0.22,
    rowSpacing: 0.34,
    fillWidth: true,
  },
  scythed_chariot: {
    columns: 4,
    rows: 1,
    columnSpacing: 0.34,
    rowSpacing: 0.34,
    fillWidth: true,
  },
  elephant: {
    columns: 3,
    rows: 1,
    columnSpacing: 0.34,
    rowSpacing: 0.34,
    fillWidth: true,
  },
  artillery: {
    columns: 1,
    rows: 1,
    columnSpacing: 0.2,
    rowSpacing: 0.2,
  },
}

const BLOB_SHADOW_GEOMETRY = new THREE.PlaneGeometry(1, 1)
const BLOB_SHADOW_TEXTURE = createBlobShadowTexture()
const BLOB_SHADOW_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x000000,
  alphaMap: BLOB_SHADOW_TEXTURE,
  transparent: true,
  opacity: 0.34,
  depthWrite: false,
  alphaTest: 0.02,
  side: THREE.DoubleSide,
  toneMapped: false,
})

const BLOB_SHADOW_SIZES: Record<CrowdVariant, number> = {
  spear: 0.24,
  pike: 0.24,
  archer: 0.24,
  slinger: 0.22,
  imitation_legionary: 0.24,
  thorakitai: 0.24,
  gallic_mercenary: 0.26,
  psilos: 0.2,
  cavalry: 0.34,
  cataphract: 0.38,
  bow_cavalry: 0.3,
  light_cavalry: 0.3,
  scythed_chariot: 0.44,
  elephant: 0.52,
  artillery: 0.42,
}

const CROWD_VARIANT_YAW_OFFSETS: Record<CrowdVariant, number> = {
  spear: 0,
  pike: 0,
  imitation_legionary: 0,
  thorakitai: 0,
  gallic_mercenary: 0,
  archer: 0,
  slinger: 0,
  psilos: 0,
  cavalry: 0,
  cataphract: 0,
  bow_cavalry: 0,
  light_cavalry: 0,
  scythed_chariot: 0,
  elephant: 0,
  artillery: 0,
}

const ARMY_COLORS: Record<ArmyId, number> = {
  A: 0x1e6157,
  B: 0x8e4524,
}

const TILE_BORDER_MATERIAL = new THREE.LineBasicMaterial({
  color: 0x7b6b50,
  transparent: true,
  opacity: 0.34,
  depthWrite: false,
})

export function rebuildTerrainScene({
  forestGroup,
  forestTreeTemplate,
  state,
  terrainBorderGroup,
  terrainGroup,
  terrainMaterials,
  terrainTemplate,
  waterAssets,
  waterMaterialStates,
}: {
  forestGroup: THREE.Group
  forestTreeTemplate: THREE.Group | null
  state: GameState | null
  terrainBorderGroup: THREE.Group
  terrainGroup: THREE.Group
  terrainMaterials: TerrainMaterials | null
  terrainTemplate: TerrainTemplate | null
  waterAssets: WaterAssets | null
  waterMaterialStates: WaterMaterialState[]
}): Map<string, TerrainSurface> {
  disposeTerrainScene({
    forestGroup,
    terrainBorderGroup,
    terrainGroup,
    waterMaterialStates,
  })

  const terrainSurfaceMap = new Map<string, TerrainSurface>()
  if (!state || !terrainTemplate || !terrainMaterials || !waterAssets || !forestTreeTemplate) {
    return terrainSurfaceMap
  }

  const terrainByCell = new Map<string, TerrainType>()
  for (const tile of state.terrain) {
    terrainByCell.set(coordKey(tile.position.x, tile.position.y), tile.terrain)
  }
  const hillTiles = buildHillTileData(state.board_width, state.board_height, terrainByCell)
  const forestTiles = buildForestTileData(state.board_width, state.board_height, terrainByCell)

  for (let y = 0; y < state.board_height; y += 1) {
    for (let x = 0; x < state.board_width; x += 1) {
      const terrain = terrainByCell.get(coordKey(x, y)) ?? 'open'
      const { x: worldX, z: worldZ } = coordToWorld(x, y, state.board_width, state.board_height)
      const material =
        terrain === 'water'
          ? createWaterTerrainMaterial(
              terrainMaterials.water,
              waterAssets,
              selectWaterTileMask(x, y, terrainByCell),
              waterMaterialStates,
            )
          : terrain === 'road'
            ? createRoadTerrainMaterial(
                terrainMaterials.open,
                waterAssets,
                selectRoadTileMask(x, y, terrainByCell, state.board_width, state.board_height),
              )
            : terrainMaterials[terrain]
      const tileModel = createTerrainTile(terrainTemplate, material, terrain, worldX, worldZ, hillTiles)

      tileModel.position.set(worldX, 0, worldZ)
      tileModel.updateMatrixWorld(true)
      terrainGroup.add(tileModel)

      const borderLines = createTerrainBorderLines(worldX, worldZ, hillTiles)
      borderLines.frustumCulled = false
      terrainBorderGroup.add(borderLines)

      const terrainSurface = buildTerrainSurface(tileModel)
      if (terrainSurface) {
        terrainSurfaceMap.set(coordKey(x, y), terrainSurface)
      }

      if (terrain === 'forest') {
        addForestTrees(
          forestGroup,
          forestTreeTemplate,
          terrainSurface ?? undefined,
          worldX,
          worldZ,
          forestTiles.get(coordKey(x, y)) ?? EMPTY_FOREST_TILE_DATA,
          `${state.seed}:${x}:${y}`,
        )
      }
    }
  }

  return terrainSurfaceMap
}

export function disposeTerrainScene({
  forestGroup,
  terrainBorderGroup,
  terrainGroup,
  waterMaterialStates,
}: {
  forestGroup: THREE.Group
  terrainBorderGroup: THREE.Group
  terrainGroup: THREE.Group
  waterMaterialStates: WaterMaterialState[]
}) {
  disposeTerrainInstances(terrainGroup)
  disposeLineGroupGeometries(terrainBorderGroup)
  disposeWaterMaterialStates(waterMaterialStates)
  waterMaterialStates.length = 0
  terrainGroup.clear()
  terrainBorderGroup.clear()
  forestGroup.clear()
}

export function rebuildFormationScene({
  crowdTemplates,
  elapsedTime,
  formationGroup,
  keyLight,
  previousDisorderedPulseMaterialStates,
  state,
  terrainSurfaceMap,
}: {
  crowdTemplates: CrowdTemplates | null
  elapsedTime: number
  formationGroup: THREE.Group
  keyLight: THREE.DirectionalLight | null
  previousDisorderedPulseMaterialStates: DisorderedPulseMaterialState[]
  state: GameState | null
  terrainSurfaceMap: Map<string, TerrainSurface>
}): {
  crowdAnimationStates: CrowdAnimationState[]
  disorderedPulseMaterialStates: DisorderedPulseMaterialState[]
} {
  disposeFormationScene({
    disorderedPulseMaterialStates: previousDisorderedPulseMaterialStates,
    formationGroup,
  })

  if (!state || !crowdTemplates) {
    return {
      crowdAnimationStates: [],
      disorderedPulseMaterialStates: [],
    }
  }

  const boardSpan = Math.max(state.board_width, state.board_height) * TILE_SIZE
  const phaseMatricesByVariant = createEmptyPhaseMatrixBucketsByVariant()
  const blobShadowMatricesByVariant = createEmptyMatrixListByVariant()
  populateFormationMatrices(
    state,
    crowdTemplates,
    terrainSurfaceMap,
    phaseMatricesByVariant,
    blobShadowMatricesByVariant,
  )
  addBlobShadowInstances(formationGroup, blobShadowMatricesByVariant)

  const disorderedPulseMaterialStates: DisorderedPulseMaterialState[] = []
  const crowdAnimationStates: CrowdAnimationState[] = []

  for (const variant of CROWD_VARIANT_ORDER) {
    const crowdTemplate = crowdTemplates[variant]
    const phaseMatrices = phaseMatricesByVariant[variant]
    const phaseFrameOffsets = buildPhaseFrameOffsets(
      `${state.seed}:${variant}`,
      phaseMatrices.normal.length,
      crowdTemplate.frameCount,
    )
    const initialBaseFrame = getAnimationFrameIndex(elapsedTime, crowdTemplate.clipDuration, crowdTemplate.frameCount)

    if (hasMatrices(phaseMatrices.normal)) {
      crowdAnimationStates.push(
        addCrowdInstances(formationGroup, crowdTemplate, phaseMatrices.normal, phaseFrameOffsets, initialBaseFrame),
      )
    }
    if (hasMatrices(phaseMatrices.disordered)) {
      crowdAnimationStates.push(
        addCrowdInstances(
          formationGroup,
          crowdTemplate,
          phaseMatrices.disordered,
          phaseFrameOffsets,
          initialBaseFrame,
          disorderedPulseMaterialStates,
        ),
      )
    }
  }

  if (keyLight) {
    updateDirectionalShadowFrustum(keyLight, boardSpan)
  }

  return {
    crowdAnimationStates,
    disorderedPulseMaterialStates,
  }
}

export function disposeFormationScene({
  disorderedPulseMaterialStates,
  formationGroup,
}: {
  disorderedPulseMaterialStates: DisorderedPulseMaterialState[]
  formationGroup: THREE.Group
}) {
  disposeInstancedChildren(formationGroup)
  disposeDisorderedPulseMaterials(disorderedPulseMaterialStates)
  formationGroup.clear()
}

export function rebuildVolleyScene({
  activeVolley,
  clock,
  previewAction,
  selectedResolution,
  state,
  terrainSurfaceMap,
  volleyGroup,
  volleyTemplate,
}: {
  activeVolley: ActiveVolleyState | null
  clock: THREE.Clock
  previewAction: LegalAction | null
  selectedResolution: CombatResolution | null
  state: GameState | null
  terrainSurfaceMap: Map<string, TerrainSurface>
  volleyGroup: THREE.Group
  volleyTemplate: VolleyTemplate | null
}): ActiveVolleyState | null {
  const signal = state ? resolveActiveVolleySignal(state, previewAction, selectedResolution) : null

  if (!state || !volleyTemplate || !signal) {
    disposeVolleyScene({ activeVolley, volleyGroup })
    return null
  }

  const nextEndpoints = resolveVolleyEndpoints(state, signal, terrainSurfaceMap)
  if (activeVolley && activeVolley.key === signal.key) {
    activeVolley.start.copy(nextEndpoints.start)
    activeVolley.end.copy(nextEndpoints.end)
    return activeVolley
  }

  disposeVolleyScene({ activeVolley, volleyGroup })
  const nextActiveVolley = createActiveVolley(volleyTemplate, signal.key, nextEndpoints.start, nextEndpoints.end)
  applyActiveVolleyTransform(
    nextActiveVolley,
    (((clock.getElapsedTime() % nextActiveVolley.duration) + nextActiveVolley.duration) % nextActiveVolley.duration) /
      nextActiveVolley.duration,
  )
  volleyGroup.add(nextActiveVolley.model)
  return nextActiveVolley
}

export function disposeVolleyScene({
  activeVolley,
  volleyGroup,
}: {
  activeVolley: ActiveVolleyState | null
  volleyGroup: THREE.Group
}) {
  disposeActiveVolley(activeVolley)
  volleyGroup.clear()
}

export function rebuildInteractionProxyScene({
  group,
  state,
}: {
  group: THREE.Group
  state: GameState | null
}) {
  disposeOverlayGroup(group)
  group.clear()

  if (!state) {
    return
  }

  buildInteractionProxyMeshes(group, state)
}

export function rebuildTacticalOverlayScene({
  group,
  hoveredTarget,
  interaction,
  selectionIndicatorTemplate,
  state,
  terrainSurfaceMap,
}: {
  group: THREE.Group
  hoveredTarget: BattlefieldPickTarget | null
  interaction: BattlefieldInteractionModel | null
  selectionIndicatorTemplate: THREE.Group | null
  state: GameState | null
  terrainSurfaceMap: Map<string, TerrainSurface>
}) {
  disposeOverlayGroup(group)
  group.clear()

  if (!state || !interaction) {
    return
  }

  buildTacticalOverlayMeshes(
    group,
    state,
    interaction,
    hoveredTarget,
    terrainSurfaceMap,
    selectionIndicatorTemplate,
  )
}

function createTerrainTile(
  terrainTemplate: TerrainTemplate,
  material: THREE.Material | THREE.Material[],
  terrain: TerrainType,
  worldX: number,
  worldZ: number,
  hillTiles: HillTileData[],
): THREE.Group {
  const tileModel = terrainTemplate.model.clone(true)

  tileModel.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return
    }

    child.geometry = child.geometry.clone()
    applyTerrainShape(child.geometry, terrain, worldX, worldZ, hillTiles)
    child.material = material
    child.castShadow = false
    child.receiveShadow = true
    child.frustumCulled = false
  })

  return tileModel
}

function applyTerrainShape(
  geometry: THREE.BufferGeometry,
  terrain: TerrainType,
  worldX: number,
  worldZ: number,
  hillTiles: HillTileData[],
) {
  const positionAttribute = geometry.getAttribute('position')
  if (!(positionAttribute instanceof THREE.BufferAttribute)) {
    return
  }

  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox
  if (!bounds) {
    return
  }

  const baseMinX = bounds.min.x
  const baseMaxX = bounds.max.x
  const baseMinZ = bounds.min.z
  const baseMaxZ = bounds.max.z

  for (let index = 0; index < positionAttribute.count; index += 1) {
    const localX = positionAttribute.getX(index)
    const localZ = positionAttribute.getZ(index)
    const sampleWorldX = worldX + localX
    const sampleWorldZ = worldZ + localZ
    const heightY =
      terrain === 'hill' ? sampleHillElevationAtWorld(sampleWorldX, sampleWorldZ, hillTiles) : 0

    positionAttribute.setXYZ(index, localX, heightY, localZ)
  }

  positionAttribute.needsUpdate = true
  geometry.computeBoundingBox()
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()

  if (geometry.boundingBox) {
    geometry.boundingBox.min.x = baseMinX
    geometry.boundingBox.max.x = baseMaxX
    geometry.boundingBox.min.z = baseMinZ
    geometry.boundingBox.max.z = baseMaxZ
  }
}

function createEmptyPhaseMatrixSet(): THREE.Matrix4[][] {
  return Array.from({ length: ANIMATION_PHASE_BUCKETS }, () => [] as THREE.Matrix4[])
}

function createEmptyPhaseMatrixBucketsByVariant(): Record<CrowdVariant, PhaseMatrixBuckets> {
  return Object.fromEntries(
    CROWD_VARIANT_ORDER.map((variant) => [
      variant,
      {
        disordered: createEmptyPhaseMatrixSet(),
        normal: createEmptyPhaseMatrixSet(),
      },
    ]),
  ) as Record<CrowdVariant, PhaseMatrixBuckets>
}

function createEmptyMatrixListByVariant(): Record<CrowdVariant, THREE.Matrix4[]> {
  return Object.fromEntries(CROWD_VARIANT_ORDER.map((variant) => [variant, [] as THREE.Matrix4[]])) as Record<
    CrowdVariant,
    THREE.Matrix4[]
  >
}

function hasMatrices(phaseMatrices: THREE.Matrix4[][]): boolean {
  return phaseMatrices.some((matrices) => matrices.length > 0)
}

function populateFormationMatrices(
  state: GameState,
  crowdTemplates: CrowdTemplates,
  terrainSurfaceMap: Map<string, TerrainSurface>,
  phaseMatricesByVariant: Record<CrowdVariant, PhaseMatrixBuckets>,
  blobShadowMatricesByVariant: Record<CrowdVariant, THREE.Matrix4[]>,
) {
  const dummy = new THREE.Object3D()

  for (const unit of state.units) {
    if (unit.eliminated || unit.off_map || !unit.deployed) {
      continue
    }

    const crowdVariant = getCrowdVariant(unit)
    const formationConfig = getFormationConfig(crowdVariant, crowdTemplates[crowdVariant])
    const { anchorX, anchorZ, centerX, centerZ, forward } = resolveUnitFormationAnchor(unit, state)
    const phaseMatrices = unit.disordered
      ? phaseMatricesByVariant[crowdVariant].disordered
      : phaseMatricesByVariant[crowdVariant].normal
    const blobShadowMatrices = blobShadowMatricesByVariant[crowdVariant]
    const terrainSurface = terrainSurfaceMap.get(coordKey(unit.position.x, unit.position.y))
    const centerGroundY = sampleTerrainHeightAt(terrainSurface, centerX, centerZ) ?? 0
    const slots = collectFormationSlots(state, unit, formationConfig, phaseMatrices.length)
    const frontLayouts = [
      {
        anchorX,
        anchorZ,
        columns: formationConfig.columns,
        facing: unit.facing,
        forward,
        lateral: new THREE.Vector3(-forward.z, 0, forward.x),
      },
    ]
    const frontSlotCounts = new Array(frontLayouts.length).fill(0)

    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      const slot = slots[slotIndex]
      const frontIndex = frontLayouts.length > 1 ? slotIndex % frontLayouts.length : 0
      const frontLayout = frontLayouts[frontIndex]
      const localIndex = frontSlotCounts[frontIndex]
      frontSlotCounts[frontIndex] += 1
      const rowIndex = Math.floor(localIndex / frontLayout.columns)
      const columnIndex = localIndex % frontLayout.columns
      const depthOffset = ((formationConfig.rows - 1) / 2 - rowIndex) * formationConfig.rowSpacing
      const lateralOffset =
        (columnIndex - (frontLayout.columns - 1) / 2) * formationConfig.columnSpacing
      const soldierX =
        frontLayout.anchorX +
        frontLayout.lateral.x * (lateralOffset + slot.lateralJitter) +
        frontLayout.forward.x * (depthOffset + slot.depthJitter)
      const soldierZ =
        frontLayout.anchorZ +
        frontLayout.lateral.z * (lateralOffset + slot.lateralJitter) +
        frontLayout.forward.z * (depthOffset + slot.depthJitter)
      const soldierGroundY = sampleTerrainHeightAt(terrainSurface, soldierX, soldierZ) ?? centerGroundY

      dummy.position.set(
        soldierX,
        soldierGroundY + FORMATION_GROUND_OFFSET,
        soldierZ,
      )
      dummy.rotation.set(
        0,
        directionAngle(frontLayout.facing) + CROWD_VARIANT_YAW_OFFSETS[crowdVariant] + slot.rotationJitter,
        0,
      )
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      phaseMatrices[slot.bucketIndex].push(dummy.matrix.clone())

      const blobShadowSize = BLOB_SHADOW_SIZES[crowdVariant]
      dummy.position.set(soldierX, soldierGroundY + BLOB_SHADOW_LIFT, soldierZ)
      dummy.rotation.set(-Math.PI / 2, 0, 0)
      dummy.scale.set(blobShadowSize, blobShadowSize, 1)
      dummy.updateMatrix()
      blobShadowMatrices.push(dummy.matrix.clone())
    }
  }
}

function addForestTrees(
  forestGroup: THREE.Group,
  forestTreeTemplate: THREE.Group,
  terrainSurface: TerrainSurface | undefined,
  worldX: number,
  worldZ: number,
  forestTileData: ForestTileData,
  seedKey: string,
) {
  const usableHalfSpan = Math.max(TILE_WORLD_SPAN / 2 - FOREST_TREE_MARGIN, 0)
  const usableSpan = usableHalfSpan * 2
  const gridColumns = 3
  const gridRows = 2
  const cellWidth = usableSpan / gridColumns
  const cellDepth = usableSpan / gridRows
  const jitterX = Math.min(cellWidth * 0.22, FOREST_TREE_MIN_SPACING * 0.35)
  const jitterZ = Math.min(cellDepth * 0.22, FOREST_TREE_MIN_SPACING * 0.35)
  const edgePullX = cellWidth * 0.26
  const edgePullZ = cellDepth * 0.24
  const cellCandidates: Array<{ centerX: number; centerZ: number; cellIndex: number; weight: number }> = []

  for (let cellIndex = 0; cellIndex < gridColumns * gridRows; cellIndex += 1) {
    const columnIndex = cellIndex % gridColumns
    const rowIndex = Math.floor(cellIndex / gridColumns)
    const normalizedX = gridColumns > 1 ? columnIndex / (gridColumns - 1) : 0.5
    const normalizedZ = gridRows > 1 ? rowIndex / (gridRows - 1) : 0.5
    const westWeight = 1 - normalizedX
    const eastWeight = normalizedX
    const southWeight = 1 - normalizedZ
    const northWeight = normalizedZ

    cellCandidates.push({
      cellIndex,
      centerX:
        worldX -
        usableHalfSpan +
        cellWidth * (columnIndex + 0.5) +
        (forestTileData.eastConnected ? eastWeight * edgePullX : 0) -
        (forestTileData.westConnected ? westWeight * edgePullX : 0),
      centerZ:
        worldZ -
        usableHalfSpan +
        cellDepth * (rowIndex + 0.5) +
        (forestTileData.northConnected ? northWeight * edgePullZ : 0) -
        (forestTileData.southConnected ? southWeight * edgePullZ : 0),
      weight:
        1 +
        (forestTileData.eastConnected ? eastWeight * 1.2 : 0) +
        (forestTileData.westConnected ? westWeight * 1.2 : 0) +
        (forestTileData.northConnected ? northWeight * 1.4 : 0) +
        (forestTileData.southConnected ? southWeight * 1.4 : 0),
    })
  }

  const skippedCellIndex = cellCandidates.reduce((bestCellIndex, candidate) => {
    const bestCandidate = cellCandidates[bestCellIndex]
    const candidateScore =
      candidate.weight + randomUnitFromHash(stableHash(`${seedKey}:empty-cell:${candidate.cellIndex}`)) * 0.18
    const bestScore =
      bestCandidate.weight + randomUnitFromHash(stableHash(`${seedKey}:empty-cell:${bestCandidate.cellIndex}`)) * 0.18
    return candidateScore < bestScore ? candidate.cellIndex : bestCellIndex
  }, 0)
  const placements: Array<{ x: number; z: number }> = []

  for (const candidate of cellCandidates) {
    if (candidate.cellIndex === skippedCellIndex) {
      continue
    }

    placements.push({
      x: THREE.MathUtils.clamp(
        candidate.centerX + signedJitterFromHash(stableHash(`${seedKey}:tree:${candidate.cellIndex}:x`), jitterX),
        worldX - usableHalfSpan,
        worldX + usableHalfSpan,
      ),
      z: THREE.MathUtils.clamp(
        candidate.centerZ + signedJitterFromHash(stableHash(`${seedKey}:tree:${candidate.cellIndex}:z`), jitterZ),
        worldZ - usableHalfSpan,
        worldZ + usableHalfSpan,
      ),
    })
  }

  for (let placementIndex = 0; placementIndex < FOREST_TREE_COUNT; placementIndex += 1) {
    const placement = placements[placementIndex]
    const tree = forestTreeTemplate.clone(true)
    const scaleMultiplier =
      1 + signedJitterFromHash(stableHash(`${seedKey}:scale:${placementIndex}`), FOREST_TREE_SCALE_JITTER)
    const groundY = sampleTerrainHeightAt(terrainSurface, placement.x, placement.z) ?? 0

    tree.position.set(placement.x, groundY + FOREST_TREE_HEIGHT_OFFSET, placement.z)
    tree.rotation.y = randomUnitFromHash(stableHash(`${seedKey}:rotation:${placementIndex}`)) * Math.PI * 2
    tree.scale.multiplyScalar(scaleMultiplier)
    tree.updateMatrixWorld(true)
    forestGroup.add(tree)
  }
}

function resolveUnitFormationAnchor(unit: Unit, state: GameState) {
  const crowdVariant = getCrowdVariant(unit)
  const formationConfig = FORMATION_CONFIGS[crowdVariant]
  const center = coordToWorld(unit.position.x, unit.position.y, state.board_width, state.board_height)
  const anchor = resolveFormationAnchorForFacing(center.x, center.z, formationConfig, unit.facing)

  return {
    anchorX: anchor.anchorX,
    anchorZ: anchor.anchorZ,
    centerX: center.x,
    centerZ: center.z,
    forward: anchor.forward,
  }
}

function collectFormationSlots(
  state: GameState,
  unit: Unit,
  formationConfig: FormationConfig,
  bucketCount: number,
): FormationSlotDescriptor[] {
  const slots: FormationSlotDescriptor[] = []

  for (let rowIndex = 0; rowIndex < formationConfig.rows; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < formationConfig.columns; columnIndex += 1) {
      const slotSeed = `${state.seed}:${unit.id}:${rowIndex}:${columnIndex}`
      if (
        formationConfig.skipChance &&
        randomUnitFromHash(stableHash(`${slotSeed}:skip`)) < formationConfig.skipChance
      ) {
        continue
      }

      slots.push({
        bucketIndex: stableHash(`${state.seed}:${unit.id}:${rowIndex}:${columnIndex}`) % bucketCount,
        depthJitter: signedJitterFromHash(
          stableHash(`${slotSeed}:depth`),
          formationConfig.depthJitter ?? 0,
        ),
        lateralJitter: signedJitterFromHash(
          stableHash(`${slotSeed}:lateral`),
          formationConfig.lateralJitter ?? 0,
        ),
        rotationJitter: signedJitterFromHash(
          stableHash(`${slotSeed}:rotation`),
          formationConfig.rotationJitter ?? 0,
        ),
      })
    }
  }

  return slots
}

function resolveFormationAnchorForFacing(
  centerX: number,
  centerZ: number,
  formationConfig: FormationConfig,
  facing: Direction,
) {
  const halfFormationDepth = ((formationConfig.rows - 1) * formationConfig.rowSpacing) / 2
  const formationAnchorOffset = TILE_SIZE / 2 - (halfFormationDepth + FORMATION_EDGE_MARGIN)
  const forward = directionVector(facing)

  return {
    anchorX: centerX + forward.x * formationAnchorOffset,
    anchorZ: centerZ + forward.z * formationAnchorOffset,
    forward,
  }
}

export function resolveUnitOverlayWorldPoint(
  unit: Unit,
  state: GameState,
  terrainSurfaceMap: Map<string, TerrainSurface>,
): THREE.Vector3 {
  const { anchorX, anchorZ } = resolveUnitFormationAnchor(unit, state)
  const terrainSurface = terrainSurfaceMap.get(coordKey(unit.position.x, unit.position.y))
  const groundY = sampleTerrainHeightAt(terrainSurface, anchorX, anchorZ) ?? 0
  return new THREE.Vector3(anchorX, groundY + 0.2, anchorZ)
}

function resolveActiveVolleySignal(
  state: GameState,
  previewAction: LegalAction | null,
  selectedResolution: CombatResolution | null,
): ActiveVolleySignal | null {
  if (previewAction?.type === 'shoot') {
    const attacker = state.units.find((unit) => unit.id === previewAction.unit_id && !unit.eliminated) ?? null
    const target = state.units.find((unit) => unit.id === previewAction.target_id && !unit.eliminated) ?? null
    if ((attacker?.kind === 'bow' || attacker?.kind === 'slinger') && target) {
      return {
        attackerFacing: attacker.facing,
        attackerId: attacker.id,
        attackerPosition: attacker.position,
        key: `${attacker.id}:${target.id}`,
        targetId: target.id,
        targetFacing: target.facing,
        targetPosition: target.position,
      }
    }
  }

  if (selectedResolution?.kind === 'missile') {
    const attacker = state.units.find((unit) => unit.id === selectedResolution.attacker_id) ?? null
    if (attacker?.kind === 'bow' || attacker?.kind === 'slinger') {
      return {
        attackerFacing: attacker.facing,
        attackerId: selectedResolution.attacker_id,
        attackerPosition: selectedResolution.attacker_position,
        key: `${selectedResolution.attacker_id}:${selectedResolution.defender_id}`,
        targetId: selectedResolution.defender_id,
        targetFacing: state.units.find((unit) => unit.id === selectedResolution.defender_id)?.facing ?? null,
        targetPosition: selectedResolution.defender_position,
      }
    }
  }

  return null
}

function resolveVolleyEndpoints(
  state: GameState,
  signal: ActiveVolleySignal,
  terrainSurfaceMap: Map<string, TerrainSurface>,
) {
  const startCenter = coordToWorld(
    signal.attackerPosition.x,
    signal.attackerPosition.y,
    state.board_width,
    state.board_height,
  )
  const endCenter = coordToWorld(signal.targetPosition.x, signal.targetPosition.y, state.board_width, state.board_height)
  const startSurface = terrainSurfaceMap.get(coordKey(signal.attackerPosition.x, signal.attackerPosition.y))
  const endSurface = terrainSurfaceMap.get(coordKey(signal.targetPosition.x, signal.targetPosition.y))
  const attackerForward = signal.attackerFacing
    ? directionVector(signal.attackerFacing)
    : new THREE.Vector3(endCenter.x - startCenter.x, 0, endCenter.z - startCenter.z)

  if (attackerForward.lengthSq() < 0.0001) {
    attackerForward.set(0, 0, 1)
  } else {
    attackerForward.normalize()
  }

  const targetForward = signal.targetFacing
    ? directionVector(signal.targetFacing)
    : new THREE.Vector3(startCenter.x - endCenter.x, 0, startCenter.z - endCenter.z)

  if (targetForward.lengthSq() < 0.0001) {
    targetForward.copy(attackerForward).multiplyScalar(-1)
  } else {
    targetForward.normalize()
  }

  const startX = startCenter.x + attackerForward.x * VOLLEY_EDGE_OFFSET
  const startZ = startCenter.z + attackerForward.z * VOLLEY_EDGE_OFFSET
  const endX = endCenter.x + targetForward.x * VOLLEY_EDGE_OFFSET
  const endZ = endCenter.z + targetForward.z * VOLLEY_EDGE_OFFSET
  const startGroundY = sampleTerrainHeightAt(startSurface, startX, startZ) ?? 0
  const endGroundY = sampleTerrainHeightAt(endSurface, endX, endZ) ?? 0

  return {
    end: new THREE.Vector3(endX, endGroundY + VOLLEY_IMPACT_HEIGHT, endZ),
    start: new THREE.Vector3(
      startX,
      startGroundY + VOLLEY_LAUNCH_HEIGHT,
      startZ,
    ),
  }
}

function createActiveVolley(
  volleyTemplate: VolleyTemplate,
  key: string,
  start: THREE.Vector3,
  end: THREE.Vector3,
): ActiveVolleyState {
  const model = volleyTemplate.model.clone(true)
  let mixer: THREE.AnimationMixer | null = null
  let action: THREE.AnimationAction | null = null

  if (volleyTemplate.clip) {
    mixer = new THREE.AnimationMixer(model)
    action = mixer.clipAction(volleyTemplate.clip)
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.play()
  }

  return {
    action,
    arcHeight: VOLLEY_ARC_HEIGHT,
    duration: VOLLEY_LOOP_DURATION,
    end: end.clone(),
    key,
    mixer,
    model,
    start: start.clone(),
  }
}

function applyActiveVolleyTransform(activeVolley: ActiveVolleyState, t: number) {
  const clampedT = THREE.MathUtils.clamp(t, 0, 1)
  const position = new THREE.Vector3().lerpVectors(activeVolley.start, activeVolley.end, clampedT)
  const tangent = new THREE.Vector3().subVectors(activeVolley.end, activeVolley.start)

  position.y += activeVolley.arcHeight * 4 * clampedT * (1 - clampedT)
  tangent.y += activeVolley.arcHeight * 4 * (1 - 2 * clampedT)

  activeVolley.model.position.copy(position)
  if (tangent.lengthSq() > 0.000001) {
    activeVolley.model.lookAt(position.clone().add(tangent))
    activeVolley.model.rotateY(VOLLEY_MODEL_YAW_OFFSET)
  }
}

export function updateActiveVolley(activeVolley: ActiveVolleyState | null, elapsedTime: number, deltaTime: number) {
  if (!activeVolley) {
    return
  }

  activeVolley.mixer?.update(deltaTime)
  const loopTime = ((elapsedTime % activeVolley.duration) + activeVolley.duration) % activeVolley.duration
  applyActiveVolleyTransform(activeVolley, loopTime / activeVolley.duration)
}

export function disposeActiveVolley(activeVolley: ActiveVolleyState | null) {
  if (!activeVolley) {
    return
  }

  activeVolley.action?.stop()
  activeVolley.mixer?.stopAllAction()
  activeVolley.mixer?.uncacheRoot(activeVolley.model)
}

function buildTerrainSurface(object: THREE.Object3D): TerrainSurface | null {
  const triangles: TerrainSurfaceTriangle[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const edgeAB = new THREE.Vector3()
  const edgeAC = new THREE.Vector3()
  const normal = new THREE.Vector3()

  object.updateMatrixWorld(true)

  for (const mesh of collectRenderableMeshes(object)) {
    const positionAttribute = mesh.geometry.getAttribute('position')
    if (!(positionAttribute instanceof THREE.BufferAttribute)) {
      continue
    }

    const indexAttribute = mesh.geometry.getIndex()
    const triangleCount = indexAttribute ? indexAttribute.count / 3 : positionAttribute.count / 3

    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
      const baseIndex = triangleIndex * 3
      const aIndex = indexAttribute ? indexAttribute.getX(baseIndex) : baseIndex
      const bIndex = indexAttribute ? indexAttribute.getX(baseIndex + 1) : baseIndex + 1
      const cIndex = indexAttribute ? indexAttribute.getX(baseIndex + 2) : baseIndex + 2

      a.fromBufferAttribute(positionAttribute, aIndex).applyMatrix4(mesh.matrixWorld)
      b.fromBufferAttribute(positionAttribute, bIndex).applyMatrix4(mesh.matrixWorld)
      c.fromBufferAttribute(positionAttribute, cIndex).applyMatrix4(mesh.matrixWorld)

      edgeAB.subVectors(b, a)
      edgeAC.subVectors(c, a)
      normal.crossVectors(edgeAB, edgeAC)

      if (normal.y <= 0.0001) {
        continue
      }

      triangles.push({
        a: a.clone(),
        b: b.clone(),
        c: c.clone(),
        minX: Math.min(a.x, b.x, c.x),
        maxX: Math.max(a.x, b.x, c.x),
        minZ: Math.min(a.z, b.z, c.z),
        maxZ: Math.max(a.z, b.z, c.z),
      })
    }
  }

  if (!triangles.length) {
    return null
  }

  return {
    triangles,
  }
}

export function sampleTerrainHeightAt(terrainSurface: TerrainSurface | undefined, worldX: number, worldZ: number): number | null {
  if (!terrainSurface) {
    return null
  }

  let heightY = Number.NEGATIVE_INFINITY

  for (const triangle of terrainSurface.triangles) {
    if (
      worldX < triangle.minX - 0.0001 ||
      worldX > triangle.maxX + 0.0001 ||
      worldZ < triangle.minZ - 0.0001 ||
      worldZ > triangle.maxZ + 0.0001
    ) {
      continue
    }

    const triangleY = sampleTriangleHeightAtXZ(triangle, worldX, worldZ)
    if (triangleY !== null && triangleY > heightY) {
      heightY = triangleY
    }
  }

  if (!Number.isFinite(heightY)) {
    return null
  }

  return heightY
}

function sampleTriangleHeightAtXZ(triangle: TerrainSurfaceTriangle, x: number, z: number): number | null {
  const denominator =
    (triangle.b.z - triangle.c.z) * (triangle.a.x - triangle.c.x) +
    (triangle.c.x - triangle.b.x) * (triangle.a.z - triangle.c.z)

  if (Math.abs(denominator) < 0.000001) {
    return null
  }

  const alpha =
    ((triangle.b.z - triangle.c.z) * (x - triangle.c.x) + (triangle.c.x - triangle.b.x) * (z - triangle.c.z)) /
    denominator
  const beta =
    ((triangle.c.z - triangle.a.z) * (x - triangle.c.x) + (triangle.a.x - triangle.c.x) * (z - triangle.c.z)) /
    denominator
  const gamma = 1 - alpha - beta

  if (alpha < -0.0001 || beta < -0.0001 || gamma < -0.0001) {
    return null
  }

  return alpha * triangle.a.y + beta * triangle.b.y + gamma * triangle.c.y
}

function buildHillTileData(
  boardWidth: number,
  boardHeight: number,
  terrainByCell: Map<string, TerrainType>,
): HillTileData[] {
  const hillTiles: HillTileData[] = []
  const halfSpan = TILE_WORLD_SPAN / 2

  for (let y = 0; y < boardHeight; y += 1) {
    for (let x = 0; x < boardWidth; x += 1) {
      if (terrainByCell.get(coordKey(x, y)) !== 'hill') {
        continue
      }

      const center = coordToWorld(x, y, boardWidth, boardHeight)
      hillTiles.push({
        minX: center.x - halfSpan,
        maxX: center.x + halfSpan,
        minZ: center.z - halfSpan,
        maxZ: center.z + halfSpan,
        northExposed: terrainByCell.get(coordKey(x, y - 1)) !== 'hill',
        eastExposed: terrainByCell.get(coordKey(x + 1, y)) !== 'hill',
        southExposed: terrainByCell.get(coordKey(x, y + 1)) !== 'hill',
        westExposed: terrainByCell.get(coordKey(x - 1, y)) !== 'hill',
      })
    }
  }

  return hillTiles
}

function buildForestTileData(
  boardWidth: number,
  boardHeight: number,
  terrainByCell: Map<string, TerrainType>,
): Map<string, ForestTileData> {
  const forestTiles = new Map<string, ForestTileData>()

  for (let y = 0; y < boardHeight; y += 1) {
    for (let x = 0; x < boardWidth; x += 1) {
      if (terrainByCell.get(coordKey(x, y)) !== 'forest') {
        continue
      }

      forestTiles.set(coordKey(x, y), {
        northConnected: terrainByCell.get(coordKey(x, y - 1)) === 'forest',
        eastConnected: terrainByCell.get(coordKey(x + 1, y)) === 'forest',
        southConnected: terrainByCell.get(coordKey(x, y + 1)) === 'forest',
        westConnected: terrainByCell.get(coordKey(x - 1, y)) === 'forest',
      })
    }
  }

  return forestTiles
}

function selectConnectedTileMask(
  x: number,
  y: number,
  terrainByCell: Map<string, TerrainType>,
  terrainType: TerrainType,
): ConnectedTileMaskSelection {
  const north = terrainByCell.get(coordKey(x, y - 1)) === terrainType
  const east = terrainByCell.get(coordKey(x + 1, y)) === terrainType
  const south = terrainByCell.get(coordKey(x, y + 1)) === terrainType
  const west = terrainByCell.get(coordKey(x - 1, y)) === terrainType

  return selectTileMaskFromConnectivity(north, east, south, west)
}

function selectTileMaskFromConnectivity(
  north: boolean,
  east: boolean,
  south: boolean,
  west: boolean,
): ConnectedTileMaskSelection {
  const northBank = !north
  const eastBank = !east
  const southBank = !south
  const westBank = !west
  const bankCount = Number(northBank) + Number(eastBank) + Number(southBank) + Number(westBank)

  if (bankCount === 0) {
    return { eastConnected: east, kind: 'full', northConnected: north, quarterTurnsCW: 0, southConnected: south, westConnected: west }
  }

  if (bankCount === 4) {
    return { eastConnected: east, kind: 'pond', northConnected: north, quarterTurnsCW: 0, southConnected: south, westConnected: west }
  }

  if (bankCount === 1) {
    if (southBank) {
      return { eastConnected: east, kind: 'shore', northConnected: north, quarterTurnsCW: 0, southConnected: south, westConnected: west }
    }
    if (westBank) {
      return { eastConnected: east, kind: 'shore', northConnected: north, quarterTurnsCW: 1, southConnected: south, westConnected: west }
    }
    if (northBank) {
      return { eastConnected: east, kind: 'shore', northConnected: north, quarterTurnsCW: 2, southConnected: south, westConnected: west }
    }
    return { eastConnected: east, kind: 'shore', northConnected: north, quarterTurnsCW: 3, southConnected: south, westConnected: west }
  }

  if (bankCount === 2) {
    if (northBank && southBank) {
      return { eastConnected: east, kind: 'channel', northConnected: north, quarterTurnsCW: 0, southConnected: south, westConnected: west }
    }
    if (eastBank && westBank) {
      return { eastConnected: east, kind: 'channel', northConnected: north, quarterTurnsCW: 1, southConnected: south, westConnected: west }
    }
    if (northBank && eastBank) {
      return { eastConnected: east, kind: 'outercorner', northConnected: north, quarterTurnsCW: 0, southConnected: south, westConnected: west }
    }
    if (eastBank && southBank) {
      return { eastConnected: east, kind: 'outercorner', northConnected: north, quarterTurnsCW: 1, southConnected: south, westConnected: west }
    }
    if (southBank && westBank) {
      return { eastConnected: east, kind: 'outercorner', northConnected: north, quarterTurnsCW: 2, southConnected: south, westConnected: west }
    }
    return { eastConnected: east, kind: 'outercorner', northConnected: north, quarterTurnsCW: 3, southConnected: south, westConnected: west }
  }

  if (!westBank) {
    return { eastConnected: east, kind: 'threesidedend', northConnected: north, quarterTurnsCW: 0, southConnected: south, westConnected: west }
  }
  if (!northBank) {
    return { eastConnected: east, kind: 'threesidedend', northConnected: north, quarterTurnsCW: 1, southConnected: south, westConnected: west }
  }
  if (!eastBank) {
    return { eastConnected: east, kind: 'threesidedend', northConnected: north, quarterTurnsCW: 2, southConnected: south, westConnected: west }
  }
  return { eastConnected: east, kind: 'threesidedend', northConnected: north, quarterTurnsCW: 3, southConnected: south, westConnected: west }
}

function selectWaterTileMask(
  x: number,
  y: number,
  terrainByCell: Map<string, TerrainType>,
): WaterTileSelection {
  const selection = selectConnectedTileMask(x, y, terrainByCell, 'water')

  return {
    flowDirection: getWaterFlowDirection(
      selection.northConnected,
      selection.eastConnected,
      selection.southConnected,
      selection.westConnected,
    ),
    kind: selection.kind,
    quarterTurnsCW: selection.quarterTurnsCW,
  }
}

function selectRoadTileMask(
  x: number,
  y: number,
  terrainByCell: Map<string, TerrainType>,
  boardWidth: number,
  boardHeight: number,
): ConnectedTileMaskSelection {
  const north = y === 0 || terrainByCell.get(coordKey(x, y - 1)) === 'road'
  const east = x === boardWidth - 1 || terrainByCell.get(coordKey(x + 1, y)) === 'road'
  const south = y === boardHeight - 1 || terrainByCell.get(coordKey(x, y + 1)) === 'road'
  const west = x === 0 || terrainByCell.get(coordKey(x - 1, y)) === 'road'

  return selectTileMaskFromConnectivity(north, east, south, west)
}

function getWaterFlowDirection(north: boolean, east: boolean, south: boolean, west: boolean) {
  if ((east || west) && !(north || south)) {
    return new THREE.Vector2(1, 0)
  }
  if ((north || south) && !(east || west)) {
    return new THREE.Vector2(0, 1)
  }
  if ((north && east) || (south && west)) {
    return new THREE.Vector2(0.75, 0.75).normalize()
  }
  if ((east && south) || (west && north)) {
    return new THREE.Vector2(0.75, -0.75).normalize()
  }
  return new THREE.Vector2(0.92, 0.35).normalize()
}

function sampleHillElevationAtWorld(worldX: number, worldZ: number, hillTiles: HillTileData[]): number {
  let nearestBoundaryDistance = Number.POSITIVE_INFINITY
  let insideHill = false

  for (const hillTile of hillTiles) {
    if (
      worldX < hillTile.minX - 0.0001 ||
      worldX > hillTile.maxX + 0.0001 ||
      worldZ < hillTile.minZ - 0.0001 ||
      worldZ > hillTile.maxZ + 0.0001
    ) {
      continue
    }

    insideHill = true

    if (hillTile.northExposed) {
      nearestBoundaryDistance = Math.min(nearestBoundaryDistance, hillTile.maxZ - worldZ)
    }
    if (hillTile.eastExposed) {
      nearestBoundaryDistance = Math.min(nearestBoundaryDistance, hillTile.maxX - worldX)
    }
    if (hillTile.southExposed) {
      nearestBoundaryDistance = Math.min(nearestBoundaryDistance, worldZ - hillTile.minZ)
    }
    if (hillTile.westExposed) {
      nearestBoundaryDistance = Math.min(nearestBoundaryDistance, worldX - hillTile.minX)
    }
  }

  if (!insideHill) {
    return 0
  }

  if (!Number.isFinite(nearestBoundaryDistance)) {
    return HILL_PEAK_HEIGHT
  }

  return HILL_PEAK_HEIGHT * THREE.MathUtils.smoothstep(nearestBoundaryDistance, 0, HILL_SLOPE_DISTANCE)
}

function createTerrainBorderLines(worldX: number, worldZ: number, hillTiles: HillTileData[]) {
  const halfSpan = TILE_WORLD_SPAN / 2
  const step = TILE_WORLD_SPAN / TILE_SUBDIVISIONS
  const perimeter: THREE.Vector3[] = []

  for (let index = 0; index <= TILE_SUBDIVISIONS; index += 1) {
    perimeter.push(new THREE.Vector3(worldX - halfSpan + step * index, 0, worldZ + halfSpan))
  }
  for (let index = 1; index <= TILE_SUBDIVISIONS; index += 1) {
    perimeter.push(new THREE.Vector3(worldX + halfSpan, 0, worldZ + halfSpan - step * index))
  }
  for (let index = 1; index <= TILE_SUBDIVISIONS; index += 1) {
    perimeter.push(new THREE.Vector3(worldX + halfSpan - step * index, 0, worldZ - halfSpan))
  }
  for (let index = 1; index < TILE_SUBDIVISIONS; index += 1) {
    perimeter.push(new THREE.Vector3(worldX - halfSpan, 0, worldZ - halfSpan + step * index))
  }

  const linePoints: THREE.Vector3[] = []
  for (let index = 0; index < perimeter.length; index += 1) {
    const current = perimeter[index]
    const next = perimeter[(index + 1) % perimeter.length]
    current.y = sampleHillElevationAtWorld(current.x, current.z, hillTiles) + TILE_BORDER_LIFT
    next.y = sampleHillElevationAtWorld(next.x, next.z, hillTiles) + TILE_BORDER_LIFT
    linePoints.push(current.clone(), next.clone())
  }

  return new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(linePoints), TILE_BORDER_MATERIAL)
}

function getFormationConfig(crowdVariant: CrowdVariant, crowdTemplate: CrowdTemplate): FormationConfig {
  const baseConfig = FORMATION_CONFIGS[crowdVariant]
  if (!baseConfig.fillWidth || baseConfig.columns <= 1) {
    return baseConfig
  }

  const fillWidthSpacing = Math.max(
    (TILE_WORLD_SPAN - crowdTemplate.footprintSize.x) / (baseConfig.columns - 1),
    0,
  )

  return {
    ...baseConfig,
    columnSpacing: fillWidthSpacing,
  }
}

function addBlobShadowInstances(
  formationGroup: THREE.Group,
  blobShadowMatricesByVariant: Record<CrowdVariant, THREE.Matrix4[]>,
) {
  for (const variant of CROWD_VARIANT_ORDER) {
    const matrices = blobShadowMatricesByVariant[variant]
    if (!matrices.length) {
      continue
    }

    const blobShadows = new THREE.InstancedMesh(BLOB_SHADOW_GEOMETRY, BLOB_SHADOW_MATERIAL, matrices.length)
    blobShadows.frustumCulled = false
    blobShadows.castShadow = false
    blobShadows.receiveShadow = false
    blobShadows.renderOrder = 1

    for (let index = 0; index < matrices.length; index += 1) {
      blobShadows.setMatrixAt(index, matrices[index])
    }

    blobShadows.instanceMatrix.needsUpdate = true
    formationGroup.add(blobShadows)
  }
}

function addCrowdInstances(
  formationGroup: THREE.Group,
  crowdTemplate: CrowdTemplate,
  phaseMatrices: THREE.Matrix4[][],
  phaseFrameOffsets: number[],
  initialBaseFrame: number,
  disorderedPulseMaterialStates?: DisorderedPulseMaterialState[],
): CrowdAnimationState {
  const phaseMeshes = phaseMatrices.map(() =>
    Array.from({ length: crowdTemplate.frameCount }, () => [] as THREE.InstancedMesh[]),
  )
  const activeFrames = phaseMatrices.map(
    (_, phaseIndex) => (initialBaseFrame + phaseFrameOffsets[phaseIndex]) % crowdTemplate.frameCount,
  )
  const partMaterials = crowdTemplate.parts.map((part) =>
    disorderedPulseMaterialStates
      ? cloneMaterialsForDisorderedPulse(part.material, disorderedPulseMaterialStates)
      : part.material,
  )

  for (let phaseIndex = 0; phaseIndex < phaseMatrices.length; phaseIndex += 1) {
    const matrices = phaseMatrices[phaseIndex]
    if (!matrices.length) {
      continue
    }

    for (let frameIndex = 0; frameIndex < crowdTemplate.frameCount; frameIndex += 1) {
      for (let partIndex = 0; partIndex < crowdTemplate.parts.length; partIndex += 1) {
        const part = crowdTemplate.parts[partIndex]
        const instancedMesh = new THREE.InstancedMesh(
          part.frameGeometries[frameIndex],
          partMaterials[partIndex],
          matrices.length,
        )
        instancedMesh.frustumCulled = false
        instancedMesh.castShadow = false
        instancedMesh.receiveShadow = false
        instancedMesh.visible = frameIndex === activeFrames[phaseIndex]

        for (let matrixIndex = 0; matrixIndex < matrices.length; matrixIndex += 1) {
          instancedMesh.setMatrixAt(matrixIndex, matrices[matrixIndex])
        }

        instancedMesh.instanceMatrix.needsUpdate = true
        phaseMeshes[phaseIndex][frameIndex].push(instancedMesh)
        formationGroup.add(instancedMesh)
      }
    }
  }

  return {
    activeFrames,
    clipDuration: crowdTemplate.clipDuration,
    frameCount: crowdTemplate.frameCount,
    phaseFrameOffsets,
    phaseMeshes,
  }
}

function cloneMaterialsForDisorderedPulse(
  material: THREE.Material | THREE.Material[],
  disorderedPulseMaterialStates: DisorderedPulseMaterialState[],
): THREE.Material | THREE.Material[] {
  if (Array.isArray(material)) {
    return material.map((entry) => cloneMaterialForDisorderedPulse(entry, disorderedPulseMaterialStates))
  }

  return cloneMaterialForDisorderedPulse(material, disorderedPulseMaterialStates)
}

function cloneMaterialForDisorderedPulse(
  material: THREE.Material,
  disorderedPulseMaterialStates: DisorderedPulseMaterialState[],
): THREE.Material {
  const clonedMaterial = material.clone()
  const tintableMaterial = clonedMaterial as THREE.Material & {
    color?: THREE.Color
    emissive?: THREE.Color
    emissiveIntensity?: number
  }

  disorderedPulseMaterialStates.push({
    colorBase: tintableMaterial.color instanceof THREE.Color ? tintableMaterial.color.clone() : null,
    emissiveBase: tintableMaterial.emissive instanceof THREE.Color ? tintableMaterial.emissive.clone() : null,
    emissiveIntensityBase:
      typeof tintableMaterial.emissiveIntensity === 'number' ? tintableMaterial.emissiveIntensity : null,
    material: clonedMaterial,
  })

  return clonedMaterial
}

export function updateCrowdAnimation(animationState: CrowdAnimationState, elapsedTime: number) {
  if (animationState.frameCount <= 1) {
    return
  }

  const baseFrame = getAnimationFrameIndex(elapsedTime, animationState.clipDuration, animationState.frameCount)

  for (let phaseIndex = 0; phaseIndex < animationState.phaseMeshes.length; phaseIndex += 1) {
    const nextFrame = (baseFrame + animationState.phaseFrameOffsets[phaseIndex]) % animationState.frameCount
    const previousFrame = animationState.activeFrames[phaseIndex]

    if (nextFrame === previousFrame) {
      continue
    }

    setInstancedMeshesVisible(animationState.phaseMeshes[phaseIndex][previousFrame], false)
    setInstancedMeshesVisible(animationState.phaseMeshes[phaseIndex][nextFrame], true)
    animationState.activeFrames[phaseIndex] = nextFrame
  }
}

export function updateDisorderedPulseMaterials(states: DisorderedPulseMaterialState[], elapsedTime: number) {
  if (!states.length) {
    return
  }

  const pulse = (Math.sin(elapsedTime * DISORDER_PULSE_RATE * Math.PI * 2 - Math.PI / 2) + 1) / 2
  const tintMix = 0.18 + pulse * 0.34
  const emissiveMix = 0.08 + pulse * 0.34
  const emissiveBoost = 0.04 + pulse * 0.28

  for (const state of states) {
    const material = state.material as THREE.Material & {
      color?: THREE.Color
      emissive?: THREE.Color
      emissiveIntensity?: number
    }

    if (state.colorBase && material.color instanceof THREE.Color) {
      material.color.copy(state.colorBase).lerp(DISORDER_TINT_COLOR, tintMix)
    }
    if (state.emissiveBase && material.emissive instanceof THREE.Color) {
      material.emissive.copy(state.emissiveBase).lerp(DISORDER_EMISSIVE_COLOR, emissiveMix)
    }
    if (state.emissiveIntensityBase !== null && typeof material.emissiveIntensity === 'number') {
      material.emissiveIntensity = state.emissiveIntensityBase + emissiveBoost
    }
  }
}

function setInstancedMeshesVisible(meshes: THREE.InstancedMesh[], visible: boolean) {
  for (const mesh of meshes) {
    mesh.visible = visible
  }
}

function getAnimationFrameIndex(elapsedTime: number, clipDuration: number, frameCount: number): number {
  const normalizedTime = ((elapsedTime % clipDuration) + clipDuration) % clipDuration
  return Math.floor((normalizedTime / clipDuration) * frameCount) % frameCount
}

function createBlobShadowTexture(): THREE.DataTexture {
  const size = 64
  const data = new Uint8Array(size * size * 4)
  const center = (size - 1) / 2
  const maxDistance = Math.sqrt(2) * center

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center
      const dy = y - center
      const normalizedDistance = Math.min(Math.sqrt(dx * dx + dy * dy) / maxDistance, 1)
      const falloff = 1 - THREE.MathUtils.smoothstep(normalizedDistance, 0.35, 1)
      const value = Math.round(falloff * falloff * 255)
      const pixelIndex = (y * size + x) * 4
      data[pixelIndex] = value
      data[pixelIndex + 1] = value
      data[pixelIndex + 2] = value
      data[pixelIndex + 3] = 255
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.colorSpace = THREE.NoColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

function updateDirectionalShadowFrustum(light: THREE.DirectionalLight, boardSpan: number) {
  const shadowHalfSpan = Math.max(boardSpan * 0.7, 10)
  light.shadow.camera.left = -shadowHalfSpan
  light.shadow.camera.right = shadowHalfSpan
  light.shadow.camera.top = shadowHalfSpan
  light.shadow.camera.bottom = -shadowHalfSpan
  light.shadow.camera.far = Math.max(boardSpan * 2.4, 60)
  light.shadow.camera.updateProjectionMatrix()
}

function randomUnitFromHash(hash: number): number {
  return hash / 0xffffffff
}

function signedJitterFromHash(hash: number, magnitude: number): number {
  return (randomUnitFromHash(hash) * 2 - 1) * magnitude
}

function buildPhaseFrameOffsets(seedKey: string, phaseCount: number, frameCount: number): number[] {
  return Array.from({ length: phaseCount }, (_, phaseIndex) => stableHash(`${seedKey}:phase:${phaseIndex}`) % frameCount)
}

function stableHash(value: string): number {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function getCrowdVariant(unit: Unit): CrowdVariant {
  if (unit.kind === 'psiloi') {
    return 'psilos'
  }

  if (unit.kind === 'slinger') {
    return 'slinger'
  }

  if (unit.kind === 'pike' || unit.kind === 'guard_pike') {
    return 'pike'
  }

  if (unit.kind === 'spear') {
    return 'spear'
  }

  if (unit.kind === 'blade') {
    return 'imitation_legionary'
  }

  if (unit.kind === 'auxilia') {
    return 'thorakitai'
  }

  if (unit.kind === 'warband' || unit.kind === 'horde') {
    return 'gallic_mercenary'
  }

  if (unit.kind === 'bow') {
    return 'archer'
  }

  if (unit.kind === 'elephants') {
    return 'elephant'
  }

  if (unit.kind === 'artillery') {
    return 'artillery'
  }

  if (unit.kind === 'bow_cavalry') {
    return 'bow_cavalry'
  }

  if (unit.kind === 'light_horse') {
    return 'light_cavalry'
  }

  if (unit.kind === 'scythed_chariots') {
    return 'scythed_chariot'
  }

  if (unit.kind === 'knights') {
    return 'cataphract'
  }

  if (unit.kind === 'cavalry' || unit.kind === 'leader') {
    return 'cavalry'
  }

  return 'spear'
}

export function disposeInstancedChildren(group: THREE.Group) {
  for (const child of group.children) {
    if (child instanceof THREE.InstancedMesh) {
      child.dispose()
    }
  }
}

export function disposeDisorderedPulseMaterials(states: DisorderedPulseMaterialState[]) {
  const disposedMaterials = new Set<THREE.Material>()

  for (const state of states) {
    if (disposedMaterials.has(state.material)) {
      continue
    }

    disposedMaterials.add(state.material)
    state.material.dispose()
  }
}

function disposeTerrainInstances(group: THREE.Group) {
  const disposedRoadMaterials = new Set<THREE.Material>()

  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return
    }

    child.geometry.dispose()
    disposePerTileRoadMaterials(child.material, disposedRoadMaterials)
  })
}

function disposePerTileRoadMaterials(
  material: THREE.Material | THREE.Material[],
  disposedMaterials: Set<THREE.Material>,
) {
  const materials = Array.isArray(material) ? material : [material]

  for (const entry of materials) {
    if (!entry.userData.isPerTileRoad || disposedMaterials.has(entry)) {
      continue
    }

    disposedMaterials.add(entry)
    entry.dispose()
  }
}

function disposeLineGroupGeometries(group: THREE.Group) {
  group.traverse((child) => {
    if (child instanceof THREE.LineSegments) {
      child.geometry.dispose()
    }
  })
}

export function coordToWorld(x: number, y: number, boardWidth: number, boardHeight: number) {
  return {
    x: (x - (boardWidth - 1) / 2) * TILE_SIZE,
    z: ((boardHeight - 1) / 2 - y) * TILE_SIZE,
  }
}

function coordKey(x: number, y: number): string {
  return `${x},${y}`
}

function directionAngle(direction: Direction): number {
  if (direction === 'N') {
    return 0
  }
  if (direction === 'E') {
    return Math.PI / 2
  }
  if (direction === 'S') {
    return Math.PI
  }
  return -Math.PI / 2
}

function directionVector(direction: Direction): THREE.Vector3 {
  if (direction === 'N') {
    return new THREE.Vector3(0, 0, 1)
  }
  if (direction === 'E') {
    return new THREE.Vector3(1, 0, 0)
  }
  if (direction === 'S') {
    return new THREE.Vector3(0, 0, -1)
  }
  return new THREE.Vector3(-1, 0, 0)
}

export function buildRotateOverlayWorldPoint(unit: Unit, facing: Direction, state: GameState): THREE.Vector3 {
  const center = coordToWorld(unit.position.x, unit.position.y, state.board_width, state.board_height)
  const forward = directionVector(facing)
  const overlayRadius = TILE_WORLD_SPAN * 0.48
  return new THREE.Vector3(center.x + forward.x * overlayRadius, 0.24, center.z + forward.z * overlayRadius)
}

export function resolveDisorderNoticeWorldPoint(
  unit: Unit,
  state: GameState,
  terrainSurfaceMap: Map<string, TerrainSurface>,
): THREE.Vector3 {
  const worldPoint = resolveUnitOverlayWorldPoint(unit, state, terrainSurfaceMap)
  worldPoint.y += DISORDER_NOTICE_WORLD_LIFT
  return worldPoint
}

export function projectWorldPointToScreen(
  world: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  container: HTMLElement,
): { x: number; y: number } | null {
  const vector = world.clone().project(camera)
  if (vector.z < -1 || vector.z > 1 || vector.x < -1 || vector.x > 1 || vector.y < -1 || vector.y > 1) {
    return null
  }

  return {
    x: ((vector.x + 1) / 2) * container.clientWidth,
    y: ((1 - vector.y) / 2) * container.clientHeight,
  }
}

function projectBoardCoordToScreen(
  state: GameState,
  coord: Coord,
  camera: THREE.PerspectiveCamera,
  container: HTMLElement,
): { x: number; y: number } | null {
  const world = coordToWorld(coord.x, coord.y, state.board_width, state.board_height)
  return projectWorldPointToScreen(new THREE.Vector3(world.x, 0.2, world.z), camera, container)
}

export function projectCombatAnchor(
  state: GameState,
  resolution: CombatResolution,
  camera: THREE.PerspectiveCamera,
  container: HTMLElement,
): CombatAnchorProjection | null {
  const attacker = projectBoardCoordToScreen(state, resolution.attacker_position, camera, container)
  const defender = projectBoardCoordToScreen(state, resolution.defender_position, camera, container)
  if (!attacker || !defender) {
    return null
  }

  const anchorX = (attacker.x + defender.x) / 2
  const anchorY = (attacker.y + defender.y) / 2
  const side: 'left' | 'right' = anchorX <= container.clientWidth / 2 ? 'right' : 'left'

  return {
    anchorStyle: {
      left: `${clamp(anchorX, 8, Math.max(8, container.clientWidth - 8))}px`,
      top: `${clamp(anchorY, 8, Math.max(8, container.clientHeight - 8))}px`,
    },
    side,
  }
}

export function resolveSelectionFocusPoint(
  interaction: BattlefieldInteractionModel | null,
  state: GameState,
): THREE.Vector3 | null {
  const selectedUnits = (interaction?.selectedUnits ?? []).filter((unit) => unit.deployed)
  if (!selectedUnits.length) {
    return null
  }

  const center = selectedUnits.reduce(
    (accumulator, unit) => {
      const { anchorX, anchorZ } = resolveUnitFormationAnchor(unit, state)
      accumulator.x += anchorX
      accumulator.z += anchorZ
      return accumulator
    },
    new THREE.Vector3(0, 0.8, 0),
  )

  center.x /= selectedUnits.length
  center.z /= selectedUnits.length
  return center
}

export function resolveTargetFocusPoint(state: GameState, resolution: CombatResolution | null): THREE.Vector3 | null {
  if (!resolution) {
    return null
  }

  const attacker = coordToWorld(resolution.attacker_position.x, resolution.attacker_position.y, state.board_width, state.board_height)
  const defender = coordToWorld(resolution.defender_position.x, resolution.defender_position.y, state.board_width, state.board_height)
  return new THREE.Vector3((attacker.x + defender.x) / 2, 0.8, (attacker.z + defender.z) / 2)
}

export function resolveArmyCameraRig(
  state: GameState,
  army: ArmyId,
  boardSpan: number,
  camera: THREE.PerspectiveCamera,
): { position: THREE.Vector3; target: THREE.Vector3 } {
  const units = state.units.filter((unit) => unit.army === army && !unit.eliminated && !unit.off_map && unit.deployed)
  const dominantFacing = resolveDominantArmyFacing(units, army)
  const forward = directionVector(dominantFacing)
  const center = coordToWorld((state.board_width - 1) / 2, (state.board_height - 1) / 2, state.board_width, state.board_height)
  const target = new THREE.Vector3(center.x, 0.8, center.z)
  const offsetDirection = new THREE.Vector3(-forward.x * 0.48, 0.34, -forward.z * 0.48).normalize()
  const lookDirection = offsetDirection.clone().multiplyScalar(-1)
  const distance = resolveBoardFitDistance(state, target, lookDirection, camera, boardSpan)
  const position = target.clone().addScaledVector(offsetDirection, distance)
  return { position, target }
}

function resolveBoardFitDistance(
  state: GameState,
  target: THREE.Vector3,
  lookDirection: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  boardSpan: number,
): number {
  const halfWidth = (state.board_width * TILE_SIZE) / 2
  const halfDepth = (state.board_height * TILE_SIZE) / 2
  const featureHeight = Math.max(1.6, boardSpan * 0.08)
  const verticalFov = THREE.MathUtils.degToRad(camera.fov)
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(camera.aspect, 0.001))
  const verticalLimit = Math.max(Math.tan(verticalFov / 2), 0.001)
  const horizontalLimit = Math.max(Math.tan(horizontalFov / 2), 0.001)
  const worldUp = new THREE.Vector3(0, 1, 0)
  const right = new THREE.Vector3().crossVectors(worldUp, lookDirection).normalize()
  const up = new THREE.Vector3().crossVectors(lookDirection, right).normalize()
  let requiredDistance = 0

  for (const x of [-halfWidth, halfWidth]) {
    for (const y of [0, featureHeight]) {
      for (const z of [-halfDepth, halfDepth]) {
        const delta = new THREE.Vector3(x, y - target.y, z)
        const depthOffset = delta.dot(lookDirection)
        requiredDistance = Math.max(
          requiredDistance,
          Math.abs(delta.dot(right)) / horizontalLimit - depthOffset,
          Math.abs(delta.dot(up)) / verticalLimit - depthOffset,
        )
      }
    }
  }

  return Math.max(requiredDistance * 1.08 + TILE_SIZE * 0.6, boardSpan * 0.8)
}

function resolveDominantArmyFacing(units: Unit[], army: ArmyId): Direction {
  const facingCounts: Record<Direction, number> = { N: 0, E: 0, S: 0, W: 0 }
  for (const unit of units) {
    facingCounts[unit.facing] += 1
  }

  let dominantFacing: Direction = army === 'A' ? 'N' : 'S'
  let bestCount = facingCounts[dominantFacing]
  for (const facing of ['N', 'E', 'S', 'W'] as const) {
    if (facingCounts[facing] > bestCount) {
      dominantFacing = facing
      bestCount = facingCounts[facing]
    }
  }

  return dominantFacing
}

export function pickTargetFromPointerEvent(
  event: PointerEvent,
  proxyGroup: THREE.Group,
  camera: THREE.PerspectiveCamera | null,
  raycaster: THREE.Raycaster,
  pointer: THREE.Vector2,
): BattlefieldPickTarget | null {
  const element = event.currentTarget as HTMLElement | null
  if (!camera || !element) {
    return null
  }

  const rect = element.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
  raycaster.setFromCamera(pointer, camera)
  const hits = raycaster.intersectObjects(proxyGroup.children, true)
  if (!hits.length) {
    return null
  }

  const unitHit = hits.find((hit) => (hit.object.userData as { kind?: string }).kind === 'unit')
  const chosenHit = unitHit ?? hits[0]
  const userData = chosenHit.object.userData as { kind?: 'cell' | 'unit'; coord?: Coord; unit?: Unit }
  if (!userData.coord || !userData.kind) {
    return null
  }

  if (userData.kind === 'unit' && userData.unit) {
    return { kind: 'unit', coord: userData.coord, key: keyForCoord(userData.coord), unit: userData.unit }
  }

  return { kind: 'cell', coord: userData.coord, key: keyForCoord(userData.coord) }
}

function buildInteractionProxyMeshes(group: THREE.Group, state: GameState) {
  const cellGeometry = new THREE.PlaneGeometry(TILE_SIZE * 0.94, TILE_SIZE * 0.94)
  const cellMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthTest: false,
    depthWrite: false,
    opacity: 0,
    transparent: true,
  })
  const unitGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.78, 0.22, TILE_SIZE * 0.78)
  const unitMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthTest: false,
    depthWrite: false,
    opacity: 0,
    transparent: true,
  })

  for (let y = 0; y < state.board_height; y += 1) {
    for (let x = 0; x < state.board_width; x += 1) {
      const coord = { x, y }
      const world = coordToWorld(coord.x, coord.y, state.board_width, state.board_height)
      const cellProxy = new THREE.Mesh(cellGeometry.clone(), cellMaterial.clone())
      cellProxy.rotation.x = -Math.PI / 2
      cellProxy.position.set(world.x, 0.03, world.z)
      cellProxy.userData = { kind: 'cell', coord }
      group.add(cellProxy)
    }
  }

  for (const unit of state.units) {
    if (unit.eliminated || unit.off_map || !unit.deployed) {
      continue
    }

    const world = coordToWorld(unit.position.x, unit.position.y, state.board_width, state.board_height)
    const unitProxy = new THREE.Mesh(unitGeometry.clone(), unitMaterial.clone())
    unitProxy.position.set(world.x, 0.12, world.z)
    unitProxy.userData = { kind: 'unit', coord: unit.position, unit }
    group.add(unitProxy)
  }
}

function buildTacticalOverlayMeshes(
  group: THREE.Group,
  state: GameState,
  interaction: BattlefieldInteractionModel,
  hoveredTarget: BattlefieldPickTarget | null,
  terrainSurfaceMap: Map<string, TerrainSurface>,
  selectionIndicatorTemplate: THREE.Group | null,
) {
  const addPlane = (coord: Coord, color: number, opacity: number, yOffset = 0.06) => {
    const world = coordToWorld(coord.x, coord.y, state.board_width, state.board_height)
    const terrainSurface = terrainSurfaceMap.get(coordKey(coord.x, coord.y))
    const groundY = sampleTerrainHeightAt(terrainSurface, world.x, world.z) ?? 0
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(TILE_SIZE * 0.92, TILE_SIZE * 0.92),
      new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        opacity,
        side: THREE.DoubleSide,
        transparent: true,
      }),
    )
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(world.x, groundY + yOffset, world.z)
    mesh.renderOrder = 2
    group.add(mesh)
  }

  const addTerrainTint = (coord: Coord, color: number, opacity: number) => {
    addPlane(coord, color, opacity, 0.08)
  }

  const addRing = (coord: Coord, color: number, scale = 1, opacity = 0.92) => {
    const world = coordToWorld(coord.x, coord.y, state.board_width, state.board_height)
    const terrainSurface = terrainSurfaceMap.get(coordKey(coord.x, coord.y))
    const groundY = sampleTerrainHeightAt(terrainSurface, world.x, world.z) ?? 0
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(TILE_SIZE * 0.28 * scale, TILE_SIZE * 0.44 * scale, 32),
      new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        opacity,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    )
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(world.x, groundY + 0.14, world.z)
    mesh.renderOrder = 5
    group.add(mesh)
  }

  const addSelectionIndicator = (unit: Unit, scale = 1) => {
    if (!selectionIndicatorTemplate) {
      addRing(unit.position, ARMY_COLORS[unit.army], scale)
      return
    }

    const { anchorX, anchorZ } = resolveUnitFormationAnchor(unit, state)
    const terrainSurface = terrainSurfaceMap.get(coordKey(unit.position.x, unit.position.y))
    const groundY = sampleTerrainHeightAt(terrainSurface, anchorX, anchorZ) ?? 0
    const marker = selectionIndicatorTemplate.clone(true)

    marker.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return
      }

      child.geometry = child.geometry.clone()
      const nextMaterials = (Array.isArray(child.material) ? child.material : [child.material]).map((material) => {
        const nextMaterial = material.clone()
        const tintableMaterial = nextMaterial as THREE.MeshStandardMaterial & {
          color?: THREE.Color
          emissive?: THREE.Color
        }
        tintableMaterial.color?.setHex(ARMY_COLORS[unit.army])
        tintableMaterial.emissive?.setHex(ARMY_COLORS[unit.army])
        if (typeof tintableMaterial.emissiveIntensity === 'number') {
          tintableMaterial.emissiveIntensity = 0.2
        }
        nextMaterial.depthTest = false
        nextMaterial.depthWrite = false
        applyMatteMaterialFinish(nextMaterial)
        nextMaterial.needsUpdate = true
        return nextMaterial
      })

      child.material = Array.isArray(child.material) ? nextMaterials : nextMaterials[0]
      child.renderOrder = 6
    })

    marker.scale.multiplyScalar(scale)
    marker.position.set(anchorX, groundY + SELECTION_INDICATOR_GROUND_OFFSET, anchorZ)
    marker.rotation.y = directionAngle(unit.facing)
    group.add(marker)
  }

  for (const cell of interaction.boardCells) {
    if (state.phase === 'deployment' && isInDeploymentZone(cell, state.deployment_zones, state.current_player)) {
      addTerrainTint(cell, ARMY_COLORS.A, 0.24)
    }
  }

  if (state.phase === 'battle' && (interaction.selectedUnit !== null || interaction.selectedGroupUnits.length > 1)) {
    for (const key of collectEnemyThreatZoneKeys(state)) {
      const coord = coordFromKey(key)
      addTerrainTint(coord, 0x9b5d45, 0.14)
    }
  }

  for (const key of interaction.moveTargetFootprints) {
    const coord = coordFromKey(key)
    addTerrainTint(coord, 0x3f6c8a, 0.2)
  }

  for (const key of interaction.marchTargetFootprints) {
    const coord = coordFromKey(key)
    addTerrainTint(coord, 0x547ea0, 0.18)
  }

  for (const key of interaction.deployTargetFootprints) {
    const coord = coordFromKey(key)
    addTerrainTint(coord, 0x1e6157, 0.2)
  }

  for (const key of interaction.groupTargetFootprints) {
    const coord = coordFromKey(key)
    addTerrainTint(coord, 0x2a7d70, 0.22)
  }

  for (const key of interaction.chargeTargetFootprints) {
    const coord = coordFromKey(key)
    addTerrainTint(coord, 0x8e4524, 0.24)
  }

  for (const key of interaction.groupChargeTargetFootprints) {
    const coord = coordFromKey(key)
    addTerrainTint(coord, 0x8e4524, 0.28)
  }

  if (hoveredTarget) {
    addTerrainTint(hoveredTarget.coord, ARMY_COLORS.A, 0.2)
  }

  if (interaction.selectedUnit?.deployed) {
    addTerrainTint(interaction.selectedUnit.position, ARMY_COLORS[interaction.selectedUnit.army], 0.1)
    addSelectionIndicator(interaction.selectedUnit, 1)
  }

  const selectedGroupUnits = interaction.selectedGroupUnits.filter((unit) => unit.deployed)
  if (selectedGroupUnits.length > 1) {
    const groupCenter = selectedGroupUnits.reduce(
      (accumulator, unit) => {
        const { anchorX, anchorZ } = resolveUnitFormationAnchor(unit, state)
        accumulator.x += anchorX
        accumulator.z += anchorZ
        return accumulator
      },
      new THREE.Vector3(0, 0.2, 0),
    )
    groupCenter.x /= selectedGroupUnits.length
    groupCenter.z /= selectedGroupUnits.length

    const groupLinkPoints: THREE.Vector3[] = []
    for (const unit of selectedGroupUnits) {
      addTerrainTint(unit.position, ARMY_COLORS[unit.army], 0.12)
      addSelectionIndicator(unit, unit.id === interaction.groupAnchorUnitId ? 1.08 : 0.94)
      groupLinkPoints.push(groupCenter.clone())
      const { anchorX, anchorZ } = resolveUnitFormationAnchor(unit, state)
      groupLinkPoints.push(new THREE.Vector3(anchorX, 0.2, anchorZ))
    }

    if (groupLinkPoints.length >= 2) {
      const groupLinks = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(groupLinkPoints),
        new THREE.LineBasicMaterial({
          color: ARMY_COLORS.A,
          depthTest: false,
          depthWrite: false,
          opacity: 0.55,
          transparent: true,
        }),
      )
      group.add(groupLinks)
    }
  }

  for (const { target } of interaction.selectedShotTargets) {
    addRing(target.position, 0x8e4524, 1.05)
  }

  for (const key of interaction.previewDestinationKeys) {
    addPlane(coordFromKey(key), 0x304c7a, 0.18, 0.08)
  }

  for (const key of interaction.previewPathKeys) {
    addPlane(coordFromKey(key), 0x304c7a, 0.08, 0.05)
  }

  for (const key of interaction.previewTargetKeys) {
    addRing(coordFromKey(key), 0x8e4524, 1.1)
  }

  if (interaction.previewAction) {
    for (const points of buildPreviewPathPointSets(state, interaction.previewAction)) {
      if (points.length <= 1) {
        continue
      }

      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: 0x304c7a,
          depthWrite: false,
          transparent: true,
          opacity: 0.88,
        }),
      )
      group.add(line)
    }
  }
}

function buildPreviewPathPointSets(state: GameState, action: LegalAction): THREE.Vector3[][] {
  const toPoint = (coord: Coord) => {
    const world = coordToWorld(coord.x, coord.y, state.board_width, state.board_height)
    return new THREE.Vector3(world.x, 0.16, world.z)
  }

  if (action.type === 'move' || action.type === 'march_move' || action.type === 'charge') {
    return [action.path.map(toPoint)]
  }

  if (action.type === 'group_move' || action.type === 'group_march_move' || action.type === 'group_charge') {
    return action.steps.map((step) => step.path.map(toPoint))
  }

  if (action.type === 'deploy') {
    return [[toPoint(action.destination)]]
  }

  return []
}

function collectEnemyThreatZoneKeys(state: GameState): Set<string> {
  const keys = new Set<string>()
  for (const unit of state.units) {
    if (unit.eliminated || unit.off_map || !unit.deployed || unit.army === state.current_player) {
      continue
    }

    for (const coord of threatZoneCoordsForUnit(unit, state)) {
      keys.add(keyForCoord(coord))
    }
  }

  return keys
}

function threatZoneCoordsForUnit(unit: Unit, state: GameState): Coord[] {
  const coords: Coord[] = []
  if (unit.facing === 'N' || unit.facing === 'S') {
    const y = unit.position.y + (unit.facing === 'N' ? -1 : 1)
    for (let x = unit.position.x - 1; x <= unit.position.x + 1; x += 1) {
      if (isBoardCoordInBounds(x, y, state)) {
        coords.push({ x, y })
      }
    }
    return coords
  }

  const x = unit.position.x + (unit.facing === 'E' ? 1 : -1)
  for (let y = unit.position.y - 1; y <= unit.position.y + 1; y += 1) {
    if (isBoardCoordInBounds(x, y, state)) {
      coords.push({ x, y })
    }
  }
  return coords
}

function isBoardCoordInBounds(x: number, y: number, state: GameState): boolean {
  return x >= 0 && x < state.board_width && y >= 0 && y < state.board_height
}

export function disposeOverlayGroup(group: THREE.Group) {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose()
      const material = child.material
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose())
      } else {
        material.dispose()
      }
    }
  })
}

function coordFromKey(key: string): Coord {
  const [x, y] = key.split(',').map((value) => Number(value))
  return { x, y }
}
