import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { computeMorphedAttributes } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import baseTileAssetUrl from '../../../3Dassets/base_tile.fbx?url'
import baseTileGroundTextureUrl from '../../../3Dassets/base_tile_ground_texture.png'
import oliveTreeAssetUrl from '../../../3Dassets/olive_tree_2.fbx?url'
import oliveTreeBaseColorUrl from '../../../3Dassets/olive_tree_2_basecolor.JPEG'
import selectionIndicatorAssetUrl from '../../../3Dassets/standard.fbx?url'
import roadTextureUrl from '../../../3Dassets/road_texture.png'
import waterNoiseTextureUrl from '../../../3Dassets/water_noise_texture.png'
import waterMaskChannelUrl from '../../../3Dassets/watermask_channel.png'
import waterMaskFullUrl from '../../../3Dassets/watermask_full.png'
import waterMaskOuterCornerUrl from '../../../3Dassets/watermask_outercorner.png'
import waterMaskPondUrl from '../../../3Dassets/watermask_pond.png'
import waterMaskShoreUrl from '../../../3Dassets/watermask_shore.png'
import waterMaskThreeSidedEndUrl from '../../../3Dassets/watermask_threesidedend.png'
import arrowVolleyAssetUrl from '../../../3Dassets/arrow_volley.fbx?url'
import ballistaAssetUrl from '../../../3Dassets/ballista.fbx?url'
import elephantAssetUrl from '../../../3Dassets/SK_elephant.fbx?url'
import phalangiteAssetUrl from '../../../3Dassets/SK_phalangite.fbx?url'
import archerAssetUrl from '../../../3Dassets/SK_archer.fbx?url'
import cataphractAssetUrl from '../../../3Dassets/SK_cataphract.fbx?url'
import gallicMercenaryAssetUrl from '../../../3Dassets/SK_gallic_mercenary.fbx?url'
import imitationLegionaryAssetUrl from '../../../3Dassets/SK_imitation_legionary.fbx?url'
import lightCavalryAssetUrl from '../../../3Dassets/SK_light_cavalry.fbx?url'
import parthianArcherAssetUrl from '../../../3Dassets/SK_parthian_archer.fbx?url'
import psilosAssetUrl from '../../../3Dassets/SK_psilos.fbx?url'
import slingerAssetUrl from '../../../3Dassets/SK_slinger.fbx?url'
import scythedChariotAssetUrl from '../../../3Dassets/SK_scythed_chariot.fbx?url'
import thorakitaiAssetUrl from '../../../3Dassets/SK_thorakitai.fbx?url'
import thureophorosAssetUrl from '../../../3Dassets/SK_thureophoros.fbx?url'
import cavalryAssetUrl from '../../../3Dassets/SK_companion_cavalry.fbx?url'
import type { TerrainType } from '../types'

export const TILE_SIZE = 2.5
const TILE_GAP = 1
export const TILE_WORLD_SPAN = TILE_SIZE * TILE_GAP
export const TILE_SUBDIVISIONS = 4
export const MAX_PIXEL_RATIO = 1.25
const MODEL_TARGET_HEIGHT = TILE_WORLD_SPAN * 0.36
export const FORMATION_GROUND_OFFSET = 0.02
export const FORMATION_EDGE_MARGIN = 0
export const ANIMATION_PHASE_BUCKETS = 4
const BAKED_ANIMATION_FRAMES = 12
export const CROWD_VARIANT_ORDER = [
  'spear',
  'pike',
  'imitation_legionary',
  'thorakitai',
  'gallic_mercenary',
  'archer',
  'slinger',
  'psilos',
  'cavalry',
  'cataphract',
  'bow_cavalry',
  'light_cavalry',
  'scythed_chariot',
  'elephant',
  'artillery',
] as const
export const TILE_BORDER_LIFT = 0.003
export const HILL_PEAK_HEIGHT = 0.34
export const HILL_SLOPE_DISTANCE = TILE_WORLD_SPAN / 2
export const BLOB_SHADOW_LIFT = 0.008
export const FOREST_TREE_COUNT = 5
const FOREST_TREE_TARGET_HEIGHT = TILE_WORLD_SPAN * 0.39
export const FOREST_TREE_MARGIN = TILE_WORLD_SPAN * 0.16
export const FOREST_TREE_MIN_SPACING = TILE_WORLD_SPAN * 0.22
export const FOREST_TREE_HEIGHT_OFFSET = 0.01
export const FOREST_TREE_SCALE_JITTER = 0.08
const VOLLEY_TARGET_SPAN = TILE_WORLD_SPAN * 0.74
export const VOLLEY_LOOP_DURATION = 1.05
export const VOLLEY_ARC_HEIGHT = TILE_WORLD_SPAN * 0.92
export const VOLLEY_LAUNCH_HEIGHT = 0.62
export const VOLLEY_IMPACT_HEIGHT = 0.34
export const VOLLEY_EDGE_OFFSET = TILE_WORLD_SPAN * 0.5 - FORMATION_EDGE_MARGIN
export const VOLLEY_MODEL_YAW_OFFSET = -Math.PI / 2
const SELECTION_INDICATOR_TARGET_SPAN = TILE_WORLD_SPAN * 0.28
const SELECTION_INDICATOR_TARGET_HEIGHT = TILE_WORLD_SPAN * 0.52
export const SELECTION_INDICATOR_GROUND_OFFSET = FORMATION_GROUND_OFFSET + 0.02
export const DISORDER_PULSE_RATE = 0.32
export const DISORDER_TINT_COLOR = new THREE.Color(0xff7a72)
export const DISORDER_EMISSIVE_COLOR = new THREE.Color(0xff3a2d)
export const DISORDER_NOTICE_DURATION_MS = 1900
export const DISORDER_NOTICE_RISE_PX = 32
export const DISORDER_NOTICE_WORLD_LIFT = 0.42
const SKINNED_NORMAL_FALLBACK_EPSILON = 1e-10

const bakedBoneMatrix = new THREE.Matrix4()
const bakedSkinMatrix = new THREE.Matrix4()
const bakedSkinNormalMatrix = new THREE.Matrix3()
const bakedSourceNormal = new THREE.Vector3()
const bakedSkinnedNormal = new THREE.Vector3()
const bakedSkinIndices = new THREE.Vector4()
const bakedSkinWeights = new THREE.Vector4()

const TERRAIN_TINTS: Record<TerrainType, { color: number; roughness: number; metalness?: number }> = {
  open: { color: 0xffffff, roughness: 1, metalness: 0 },
  road: { color: 0xb78654, roughness: 1, metalness: 0 },
  forest: { color: 0xffffff, roughness: 1, metalness: 0 },
  hill: { color: 0xffffff, roughness: 1, metalness: 0 },
  water: { color: 0xffffff, roughness: 0.82, metalness: 0.02 },
}

export type CrowdVariant = (typeof CROWD_VARIANT_ORDER)[number]

export type CrowdTemplatePart = {
  frameGeometries: THREE.BufferGeometry[]
  material: THREE.Material | THREE.Material[]
}

export type CrowdTemplate = {
  clipDuration: number
  frameCount: number
  footprintSize: THREE.Vector3
  parts: CrowdTemplatePart[]
}

export type CrowdTemplates = Record<CrowdVariant, CrowdTemplate>

export type VolleyTemplate = {
  clip: THREE.AnimationClip | null
  model: THREE.Group
}

export type TerrainTemplate = {
  baseHeight: number
  model: THREE.Group
}

export type TerrainMaterials = Record<TerrainType, THREE.MeshStandardMaterial>

export type WaterMaskKind = 'channel' | 'full' | 'outercorner' | 'pond' | 'shore' | 'threesidedend'

export type WaterAssets = {
  maskTextures: Record<WaterMaskKind, THREE.Texture>
  noiseTexture: THREE.Texture
  roadTexture: THREE.Texture
}

export type WaterTileSelection = {
  flowDirection: THREE.Vector2
  kind: WaterMaskKind
  quarterTurnsCW: 0 | 1 | 2 | 3
}

export type ConnectedTileMaskSelection = {
  eastConnected: boolean
  kind: WaterMaskKind
  northConnected: boolean
  quarterTurnsCW: 0 | 1 | 2 | 3
  southConnected: boolean
  westConnected: boolean
}

export type WaterMaterialState = {
  material: THREE.MeshStandardMaterial
  uniforms: {
    time: { value: number }
    waterFlowDirection: { value: THREE.Vector2 }
    waterMaskMap: { value: THREE.Texture }
    waterMaskQuarterTurns: { value: number }
    waterNoiseMap: { value: THREE.Texture }
  }
}

export type BattlefieldSceneResources = {
  crowdTemplates: CrowdTemplates
  forestTreeTemplate: THREE.Group
  selectionIndicatorTemplate: THREE.Group
  terrainMaterials: TerrainMaterials
  terrainTemplate: TerrainTemplate
  terrainTexture: THREE.Texture
  volleyTemplate: VolleyTemplate
  waterAssets: WaterAssets
}

export type BattlefieldSceneResourceHandles = {
  crowdTemplates: Partial<Record<CrowdVariant, CrowdTemplate>> | null
  forestTreeTemplate: THREE.Group | null
  selectionIndicatorTemplate: THREE.Group | null
  terrainMaterials: TerrainMaterials | null
  terrainTemplate: TerrainTemplate | null
  terrainTexture: THREE.Texture | null
  volleyTemplate: VolleyTemplate | null
  waterAssets: WaterAssets | null
}

const CROWD_ASSETS: Record<CrowdVariant, { label: string; url: string }> = {
  spear: {
    label: 'thureophoros',
    url: thureophorosAssetUrl,
  },
  pike: {
    label: 'phalangite',
    url: phalangiteAssetUrl,
  },
  archer: {
    label: 'archer',
    url: archerAssetUrl,
  },
  slinger: {
    label: 'slinger',
    url: slingerAssetUrl,
  },
  imitation_legionary: {
    label: 'imitation legionary',
    url: imitationLegionaryAssetUrl,
  },
  thorakitai: {
    label: 'thorakitai',
    url: thorakitaiAssetUrl,
  },
  gallic_mercenary: {
    label: 'gallic mercenary',
    url: gallicMercenaryAssetUrl,
  },
  psilos: {
    label: 'psilos',
    url: psilosAssetUrl,
  },
  cavalry: {
    label: 'companion cavalry',
    url: cavalryAssetUrl,
  },
  cataphract: {
    label: 'cataphract',
    url: cataphractAssetUrl,
  },
  bow_cavalry: {
    label: 'bow cavalry',
    url: parthianArcherAssetUrl,
  },
  light_cavalry: {
    label: 'light cavalry',
    url: lightCavalryAssetUrl,
  },
  scythed_chariot: {
    label: 'scythed chariot',
    url: scythedChariotAssetUrl,
  },
  elephant: {
    label: 'elephant',
    url: elephantAssetUrl,
  },
  artillery: {
    label: 'ballista',
    url: ballistaAssetUrl,
  },
}

const OLIVE_TREE_TEXTURE_URLS = {
  'olive_tree_2_basecolor.jpeg': oliveTreeBaseColorUrl,
}

export async function loadBattlefieldSceneResources(): Promise<BattlefieldSceneResources> {
  const loadedModels = {} as Partial<Record<CrowdVariant, THREE.Group>>
  const textureLoader = new THREE.TextureLoader()
  const [
    loadResults,
    loadedTerrainModel,
    loadedTerrainTexture,
    loadedWaterAssets,
    loadedForestTreeModel,
    loadedSelectionIndicatorModel,
    loadedVolleyModel,
  ] = await Promise.all([
    Promise.allSettled(
      CROWD_VARIANT_ORDER.map(async (variant) => ({
        model: await loadCrowdModel(CROWD_ASSETS[variant].url),
        variant,
      })),
    ),
    loadStaticModel(baseTileAssetUrl),
    textureLoader.loadAsync(baseTileGroundTextureUrl),
    loadWaterAssets(textureLoader),
    loadCrowdModel(oliveTreeAssetUrl, OLIVE_TREE_TEXTURE_URLS),
    loadStaticModel(selectionIndicatorAssetUrl),
    loadStaticModel(arrowVolleyAssetUrl),
  ])

  let firstError: unknown = null
  for (const loadResult of loadResults) {
    if (loadResult.status === 'fulfilled') {
      loadedModels[loadResult.value.variant] = loadResult.value.model
    } else if (!firstError) {
      firstError = loadResult.reason
    }
  }

  if (firstError) {
    throw firstError
  }

  await yieldToBrowser()

  const referenceInfantryModel = loadedModels.pike
  if (!referenceInfantryModel) {
    throw new Error('The pike FBX asset could not be loaded.')
  }

  const referenceSize = getObjectSize(referenceInfantryModel)
  const worldScale = MODEL_TARGET_HEIGHT / Math.max(referenceSize.y, 0.001)
  const nextTemplates = {} as Partial<CrowdTemplates>
  const terrainTemplate = prepareTerrainTemplate(loadedTerrainModel)
  const terrainMaterials = createTerrainMaterials(loadedTerrainTexture)
  const forestTreeTemplate = prepareForestTreeTemplate(loadedForestTreeModel)
  const selectionIndicatorTemplate = prepareSelectionIndicatorTemplate(loadedSelectionIndicatorModel)
  const volleyTemplate = prepareVolleyTemplate(loadedVolleyModel)

  for (const variant of CROWD_VARIANT_ORDER) {
    const loadedModel = loadedModels[variant]
    if (!loadedModel) {
      throw new Error(`The ${CROWD_ASSETS[variant].label} FBX asset could not be loaded.`)
    }

    prepareModel(loadedModel, worldScale)
    normalizeMaterialTextures(loadedModel)
    nextTemplates[variant] = buildCrowdTemplate(loadedModel)

    await yieldToBrowser()
  }

  return {
    crowdTemplates: nextTemplates as CrowdTemplates,
    forestTreeTemplate,
    selectionIndicatorTemplate,
    terrainMaterials,
    terrainTemplate,
    terrainTexture: loadedTerrainTexture,
    volleyTemplate,
    waterAssets: loadedWaterAssets,
  }
}

export function disposeBattlefieldSceneResources(resources: BattlefieldSceneResourceHandles | null) {
  if (!resources) {
    return
  }

  disposeCrowdTemplates(resources.crowdTemplates)
  disposeTerrainTemplate(resources.terrainTemplate)
  disposeTerrainMaterials(resources.terrainMaterials)
  disposeTemplateModel(resources.forestTreeTemplate)
  disposeTemplateModel(resources.selectionIndicatorTemplate)
  disposeTemplateModel(resources.volleyTemplate?.model ?? null)
  resources.terrainTexture?.dispose()
  disposeWaterAssets(resources.waterAssets)
}

function prepareModel(model: THREE.Group, worldScaleFactor: number) {
  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = false
      child.receiveShadow = false
      child.frustumCulled = false
    }
  })

  model.scale.multiplyScalar(worldScaleFactor)
  model.updateMatrixWorld(true)

  const normalizedBox = new THREE.Box3().setFromObject(model)
  const normalizedCenter = new THREE.Vector3()
  normalizedBox.getCenter(normalizedCenter)

  model.position.x -= normalizedCenter.x
  model.position.z -= normalizedCenter.z
  model.position.y -= normalizedBox.min.y
  model.updateMatrixWorld(true)
}

function prepareTerrainTemplate(model: THREE.Group): TerrainTemplate {
  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = false
      child.receiveShadow = true
      child.frustumCulled = false
    }
  })

  const sourceSize = getObjectSize(model)
  const footprintScale = TILE_WORLD_SPAN / Math.max(sourceSize.x, sourceSize.z, 0.001)
  model.scale.multiplyScalar(footprintScale)
  model.updateMatrixWorld(true)

  const normalizedBox = new THREE.Box3().setFromObject(model)
  const normalizedCenter = new THREE.Vector3()
  normalizedBox.getCenter(normalizedCenter)

  model.position.x -= normalizedCenter.x
  model.position.z -= normalizedCenter.z
  model.position.y -= normalizedBox.min.y
  model.updateMatrixWorld(true)

  const bakedModel = new THREE.Group()
  let maxY = 0

  for (const mesh of collectRenderableMeshes(model)) {
    const bakedGeometry = mesh.geometry.clone()
    bakedGeometry.applyMatrix4(mesh.matrixWorld)
    bakedGeometry.computeBoundingBox()
    bakedGeometry.computeBoundingSphere()
    maxY = Math.max(maxY, bakedGeometry.boundingBox?.max.y ?? 0)
    bakedModel.add(new THREE.Mesh(bakedGeometry, mesh.material))
  }

  return {
    baseHeight: maxY,
    model: bakedModel,
  }
}

function prepareForestTreeTemplate(model: THREE.Group): THREE.Group {
  normalizeMaterialTextures(model)
  applyBlackKeyCutoutToTree(model)

  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true
      child.receiveShadow = true
      child.frustumCulled = false
    }
  })

  const sourceSize = getObjectSize(model)
  const heightScale = FOREST_TREE_TARGET_HEIGHT / Math.max(sourceSize.y, 0.001)
  model.scale.multiplyScalar(heightScale)
  model.updateMatrixWorld(true)

  const normalizedBox = new THREE.Box3().setFromObject(model)
  const normalizedCenter = new THREE.Vector3()
  normalizedBox.getCenter(normalizedCenter)

  model.position.x -= normalizedCenter.x
  model.position.z -= normalizedCenter.z
  model.position.y -= normalizedBox.min.y
  model.updateMatrixWorld(true)

  return model
}

function prepareSelectionIndicatorTemplate(model: THREE.Group): THREE.Group {
  normalizeMaterialTextures(model)

  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = false
      child.receiveShadow = false
      child.frustumCulled = false
    }
  })

  const sourceSize = getObjectSize(model)
  const footprintScale = SELECTION_INDICATOR_TARGET_SPAN / Math.max(sourceSize.x, sourceSize.z, 0.001)
  const heightScale = SELECTION_INDICATOR_TARGET_HEIGHT / Math.max(sourceSize.y, 0.001)
  model.scale.multiplyScalar(Math.min(footprintScale, heightScale))
  model.updateMatrixWorld(true)

  const normalizedBox = new THREE.Box3().setFromObject(model)
  const normalizedCenter = new THREE.Vector3()
  normalizedBox.getCenter(normalizedCenter)

  model.position.x -= normalizedCenter.x
  model.position.z -= normalizedCenter.z
  model.position.y -= normalizedBox.min.y
  model.updateMatrixWorld(true)

  return model
}

function prepareVolleyTemplate(model: THREE.Group): VolleyTemplate {
  normalizeMaterialTextures(model)

  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = false
      child.receiveShadow = false
      child.frustumCulled = false
    }
  })

  const sourceSize = getObjectSize(model)
  const footprintScale = VOLLEY_TARGET_SPAN / Math.max(sourceSize.x, sourceSize.y, sourceSize.z, 0.001)
  model.scale.multiplyScalar(footprintScale)
  model.updateMatrixWorld(true)

  const normalizedBox = new THREE.Box3().setFromObject(model)
  const normalizedCenter = new THREE.Vector3()
  normalizedBox.getCenter(normalizedCenter)

  model.position.x -= normalizedCenter.x
  model.position.z -= normalizedCenter.z
  model.position.y -= normalizedCenter.y
  model.updateMatrixWorld(true)

  return {
    clip: model.animations[0] ?? null,
    model,
  }
}

function createTerrainMaterials(groundTexture: THREE.Texture): TerrainMaterials {
  groundTexture.colorSpace = THREE.SRGBColorSpace
  groundTexture.needsUpdate = true

  return {
    open: new THREE.MeshStandardMaterial({
      color: TERRAIN_TINTS.open.color,
      map: groundTexture,
      roughness: TERRAIN_TINTS.open.roughness,
      metalness: TERRAIN_TINTS.open.metalness ?? 0,
    }),
    road: new THREE.MeshStandardMaterial({
      color: TERRAIN_TINTS.road.color,
      map: groundTexture,
      roughness: TERRAIN_TINTS.road.roughness,
      metalness: TERRAIN_TINTS.road.metalness ?? 0,
    }),
    forest: new THREE.MeshStandardMaterial({
      color: TERRAIN_TINTS.forest.color,
      map: groundTexture,
      roughness: TERRAIN_TINTS.forest.roughness,
      metalness: TERRAIN_TINTS.forest.metalness ?? 0,
    }),
    hill: new THREE.MeshStandardMaterial({
      color: TERRAIN_TINTS.hill.color,
      map: groundTexture,
      roughness: TERRAIN_TINTS.hill.roughness,
      metalness: TERRAIN_TINTS.hill.metalness ?? 0,
    }),
    water: new THREE.MeshStandardMaterial({
      color: TERRAIN_TINTS.water.color,
      map: groundTexture,
      roughness: TERRAIN_TINTS.water.roughness,
      metalness: TERRAIN_TINTS.water.metalness ?? 0,
    }),
  }
}

export function createWaterTerrainMaterial(
  baseMaterial: THREE.MeshStandardMaterial,
  waterAssets: WaterAssets,
  selection: WaterTileSelection,
  runtimeStates: WaterMaterialState[],
): THREE.MeshStandardMaterial {
  const material = baseMaterial.clone()
  const uniforms: WaterMaterialState['uniforms'] = {
    time: { value: 0 },
    waterFlowDirection: { value: selection.flowDirection.clone() },
    waterMaskMap: { value: waterAssets.maskTextures[selection.kind] },
    waterMaskQuarterTurns: { value: selection.quarterTurnsCW },
    waterNoiseMap: { value: waterAssets.noiseTexture },
  }

  material.userData.isPerTileWater = true
  material.onBeforeCompile = (shader) => {
    shader.uniforms.time = uniforms.time
    shader.uniforms.waterFlowDirection = uniforms.waterFlowDirection
    shader.uniforms.waterMaskMap = uniforms.waterMaskMap
    shader.uniforms.waterMaskQuarterTurns = uniforms.waterMaskQuarterTurns
    shader.uniforms.waterNoiseMap = uniforms.waterNoiseMap

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vTerrainWorldPosition;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vTerrainWorldPosition = worldPosition.xyz;`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float time;
uniform vec2 waterFlowDirection;
uniform sampler2D waterMaskMap;
uniform float waterMaskQuarterTurns;
uniform sampler2D waterNoiseMap;
varying vec3 vTerrainWorldPosition;
float waterMaskAmount = 0.0;

vec2 rotateWaterMaskUv(vec2 uv, float quarterTurns) {
  if (quarterTurns < 0.5) {
    return uv;
  }
  if (quarterTurns < 1.5) {
    return vec2(uv.y, 1.0 - uv.x);
  }
  if (quarterTurns < 2.5) {
    return vec2(1.0 - uv.x, 1.0 - uv.y);
  }
  return vec2(1.0 - uv.y, uv.x);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  vec2 waterMaskUv = rotateWaterMaskUv(vMapUv, waterMaskQuarterTurns);
  float waterMaskSample = texture2D(waterMaskMap, waterMaskUv).r;
  waterMaskAmount = smoothstep(0.16, 0.68, waterMaskSample);
  float shoreBand = smoothstep(0.08, 0.34, waterMaskSample) * (1.0 - smoothstep(0.34, 0.56, waterMaskSample));

  vec2 flowDirection = normalize(waterFlowDirection);
  vec2 worldUvA = vTerrainWorldPosition.xz * 0.18 + flowDirection * time * 0.045;
  vec2 worldUvB = vec2(-flowDirection.y, flowDirection.x) * 0.35 + vTerrainWorldPosition.xz * 0.12 - flowDirection * time * 0.02;
  float noiseA = texture2D(waterNoiseMap, worldUvA).r;
  float noiseB = texture2D(waterNoiseMap, worldUvB).r;
  float shimmer = clamp(noiseA * 0.54 + noiseB * 0.22, 0.0, 1.0);

  vec3 riverBedColor = mix(sampledDiffuseColor.rgb, vec3(0.22, 0.19, 0.13), 0.46);
  vec3 waterColor = mix(vec3(0.035, 0.051, 0.026), vec3(0.108, 0.131, 0.071), shimmer);
  waterColor = mix(riverBedColor, waterColor, 0.76);
  vec3 shoreColor = mix(sampledDiffuseColor.rgb, vec3(0.71, 0.67, 0.52), 0.28);
  vec3 terrainColor = mix(sampledDiffuseColor.rgb, shoreColor, shoreBand * 0.72);
  vec3 finalColor = mix(terrainColor, waterColor, waterMaskAmount);
  diffuseColor *= vec4(finalColor, sampledDiffuseColor.a);
#endif`,
      )
      .replace(
        'float roughnessFactor = roughness;',
        'float roughnessFactor = mix(roughness, 0.3, waterMaskAmount);',
      )
      .replace(
        'float metalnessFactor = metalness;',
        'float metalnessFactor = mix(metalness, 0.02, waterMaskAmount);',
      )
  }

  material.customProgramCacheKey = () => 'terrain-water-mask-v2'
  material.needsUpdate = true
  runtimeStates.push({ material, uniforms })

  return material
}

export function createRoadTerrainMaterial(
  baseMaterial: THREE.MeshStandardMaterial,
  waterAssets: WaterAssets,
  selection: ConnectedTileMaskSelection,
): THREE.MeshStandardMaterial {
  const material = baseMaterial.clone()
  const roadMaskMap = waterAssets.maskTextures[selection.kind]
  const roadTexture = waterAssets.roadTexture

  material.userData.isPerTileRoad = true
  material.onBeforeCompile = (shader) => {
    shader.uniforms.roadMaskMap = { value: roadMaskMap }
    shader.uniforms.roadMaskQuarterTurns = { value: selection.quarterTurnsCW }
    shader.uniforms.roadTextureMap = { value: roadTexture }

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vTerrainWorldPosition;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vTerrainWorldPosition = worldPosition.xyz;`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D roadMaskMap;
uniform float roadMaskQuarterTurns;
uniform sampler2D roadTextureMap;
varying vec3 vTerrainWorldPosition;

vec2 rotateRoadMaskUv(vec2 uv, float quarterTurns) {
  if (quarterTurns < 0.5) {
    return uv;
  }
  if (quarterTurns < 1.5) {
    return vec2(uv.y, 1.0 - uv.x);
  }
  if (quarterTurns < 2.5) {
    return vec2(1.0 - uv.x, 1.0 - uv.y);
  }
  return vec2(1.0 - uv.y, uv.x);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  vec2 roadMaskUv = rotateRoadMaskUv(vMapUv, roadMaskQuarterTurns);
  float roadMaskSample = texture2D(roadMaskMap, roadMaskUv).r;
  float roadMaskAmount = smoothstep(0.38, 0.84, roadMaskSample);
  float roadEdgeBand = smoothstep(0.18, 0.42, roadMaskSample) * (1.0 - smoothstep(0.42, 0.68, roadMaskSample));

  vec2 roadUv = roadMaskUv * 5.5;
  vec3 roadSample = texture2D(roadTextureMap, roadUv).rgb;
  vec3 vergeColor = mix(sampledDiffuseColor.rgb, vec3(0.72, 0.66, 0.52), roadEdgeBand * 0.42);
  vec3 roadColor = mix(roadSample, vec3(0.47, 0.39, 0.28), 0.12);
  vec3 finalColor = mix(vergeColor, roadColor, roadMaskAmount);
  diffuseColor *= vec4(finalColor, sampledDiffuseColor.a);
#endif`,
      )
  }

  material.customProgramCacheKey = () => 'terrain-road-mask-v3'
  material.needsUpdate = true

  return material
}

function normalizeMaterialTextures(model: THREE.Group) {
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      const meshMaterial = material as THREE.MeshPhongMaterial
      if (meshMaterial.map) {
        meshMaterial.map.colorSpace = THREE.SRGBColorSpace
        meshMaterial.map.needsUpdate = true
        meshMaterial.color.setHex(0xffffff)
        applyMatteMaterialFinish(material)
      }
      meshMaterial.needsUpdate = true
    }
  })
}

function applyBlackKeyCutoutToTree(model: THREE.Group) {
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      const mappedMaterial = material as THREE.MeshPhongMaterial & {
        alphaMap?: THREE.Texture | null
        alphaTest?: number
        side?: number
        transparent?: boolean
        depthWrite?: boolean
      }

      if (!mappedMaterial.map) {
        continue
      }

      const alphaMap = createBlackKeyAlphaMap(mappedMaterial.map)
      if (!alphaMap) {
        continue
      }

      mappedMaterial.alphaMap = alphaMap
      mappedMaterial.transparent = true
      mappedMaterial.alphaTest = Math.max(mappedMaterial.alphaTest ?? 0, 0.28)
      mappedMaterial.side = THREE.DoubleSide
      mappedMaterial.depthWrite = true
      mappedMaterial.needsUpdate = true
    }
  })
}

function createBlackKeyAlphaMap(sourceTexture: THREE.Texture): THREE.CanvasTexture | null {
  const image = sourceTexture.image as CanvasImageSource & { width?: number; height?: number }
  const width = image?.width
  const height = image?.height

  if (!image || typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
    return null
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    return null
  }

  context.drawImage(image, 0, 0, width, height)
  const imageData = context.getImageData(0, 0, width, height)
  const pixels = imageData.data

  for (let index = 0; index < pixels.length; index += 4) {
    const signal = pixels[index] + pixels[index + 1] + pixels[index + 2]
    const alpha =
      signal <= 24 ? 0 : signal >= 96 ? 255 : Math.round(((signal - 24) / (96 - 24)) * 255)
    pixels[index] = alpha
    pixels[index + 1] = alpha
    pixels[index + 2] = alpha
    pixels[index + 3] = 255
  }

  context.putImageData(imageData, 0, 0)

  const alphaTexture = new THREE.CanvasTexture(canvas)
  alphaTexture.colorSpace = THREE.NoColorSpace
  alphaTexture.wrapS = THREE.ClampToEdgeWrapping
  alphaTexture.wrapT = THREE.ClampToEdgeWrapping
  alphaTexture.needsUpdate = true
  return alphaTexture
}

export function applyMatteMaterialFinish(material: THREE.Material) {
  const standardMaterial = material as THREE.MeshStandardMaterial
  if (typeof standardMaterial.roughness === 'number') {
    standardMaterial.roughness = 1
  }
  if (typeof standardMaterial.metalness === 'number') {
    standardMaterial.metalness = 0
  }

  const phongMaterial = material as THREE.MeshPhongMaterial
  if (typeof phongMaterial.shininess === 'number') {
    phongMaterial.shininess = 0
  }
  if (typeof phongMaterial.reflectivity === 'number') {
    phongMaterial.reflectivity = 0
  }
  if (phongMaterial.specular instanceof THREE.Color) {
    phongMaterial.specular.setHex(0x000000)
  }
}

function buildCrowdTemplate(model: THREE.Group): CrowdTemplate {
  const renderableMeshes = collectRenderableMeshes(model)
  if (!renderableMeshes.length) {
    throw new Error('The FBX did not contain any renderable meshes.')
  }

  const clip = model.animations[0] ?? null
  const frameCount = clip ? BAKED_ANIMATION_FRAMES : 1
  const clipDuration = clip ? Math.max(clip.duration, 0.001) : 1
  const footprintBox = new THREE.Box3()
  const parts = renderableMeshes.map((mesh) => ({
    frameGeometries: [] as THREE.BufferGeometry[],
    material: mesh.material,
  }))

  const mixer = clip ? new THREE.AnimationMixer(model) : null
  const action = clip && mixer ? mixer.clipAction(clip) : null
  if (action) {
    action.play()
  }

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    if (action && mixer) {
      mixer.setTime((frameIndex / frameCount) * clipDuration)
    }

    model.updateMatrixWorld(true)

    renderableMeshes.forEach((mesh, meshIndex) => {
      const bakedGeometry = bakeMeshFrame(mesh)
      if (bakedGeometry.boundingBox) {
        footprintBox.union(bakedGeometry.boundingBox)
      }
      parts[meshIndex].frameGeometries.push(bakedGeometry)
    })
  }

  action?.stop()
  mixer?.uncacheRoot(model)

  const footprintSize = new THREE.Vector3()
  footprintBox.getSize(footprintSize)

  return {
    clipDuration,
    frameCount,
    footprintSize,
    parts,
  }
}

async function loadCrowdModel(
  assetUrl: string,
  explicitTextureUrls?: Record<string, string>,
): Promise<THREE.Group> {
  let embeddedTextureUrls: string[] = []

  try {
    const textureUrlMap = await extractEmbeddedTextureUrls(assetUrl)
    embeddedTextureUrls = [...new Set(textureUrlMap.values())]
    if (explicitTextureUrls) {
      for (const [textureName, textureUrl] of Object.entries(explicitTextureUrls)) {
        for (const key of buildTextureLookupKeys(textureName)) {
          textureUrlMap.set(key, textureUrl)
        }
      }
    }
    const fallbackTextureUrl = embeddedTextureUrls.length === 1 ? embeddedTextureUrls[0] : null

    const loadingManager = new THREE.LoadingManager()
    if (textureUrlMap.size > 0) {
      loadingManager.setURLModifier((url) => resolveEmbeddedTextureUrl(url, textureUrlMap, fallbackTextureUrl) ?? url)
    }

    const loader = new FBXLoader(loadingManager)
    const loadedModel = await new Promise<THREE.Group>((resolve, reject) => {
      loader.load(assetUrl, resolve, undefined, reject)
    })

    return loadedModel
  } finally {
    for (const embeddedTextureUrl of embeddedTextureUrls) {
      URL.revokeObjectURL(embeddedTextureUrl)
    }
  }
}

async function loadStaticModel(assetUrl: string): Promise<THREE.Group> {
  const loader = new FBXLoader()

  return new Promise<THREE.Group>((resolve, reject) => {
    loader.load(assetUrl, resolve, undefined, reject)
  })
}

async function loadWaterAssets(textureLoader: THREE.TextureLoader): Promise<WaterAssets> {
  const [noiseTexture, roadTexture, channelTexture, fullTexture, outerCornerTexture, pondTexture, shoreTexture, threeSidedEndTexture] =
    await Promise.all([
      textureLoader.loadAsync(waterNoiseTextureUrl),
      textureLoader.loadAsync(roadTextureUrl),
      textureLoader.loadAsync(waterMaskChannelUrl),
      textureLoader.loadAsync(waterMaskFullUrl),
      textureLoader.loadAsync(waterMaskOuterCornerUrl),
      textureLoader.loadAsync(waterMaskPondUrl),
      textureLoader.loadAsync(waterMaskShoreUrl),
      textureLoader.loadAsync(waterMaskThreeSidedEndUrl),
    ])

  noiseTexture.wrapS = THREE.RepeatWrapping
  noiseTexture.wrapT = THREE.RepeatWrapping
  noiseTexture.colorSpace = THREE.NoColorSpace
  noiseTexture.needsUpdate = true

  roadTexture.wrapS = THREE.RepeatWrapping
  roadTexture.wrapT = THREE.RepeatWrapping
  roadTexture.colorSpace = THREE.SRGBColorSpace
  roadTexture.needsUpdate = true

  const maskTextures: WaterAssets['maskTextures'] = {
    channel: channelTexture,
    full: fullTexture,
    outercorner: outerCornerTexture,
    pond: pondTexture,
    shore: shoreTexture,
    threesidedend: threeSidedEndTexture,
  }

  for (const texture of Object.values(maskTextures)) {
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.colorSpace = THREE.NoColorSpace
    texture.needsUpdate = true
  }

  return {
    maskTextures,
    noiseTexture,
    roadTexture,
  }
}

export function collectRenderableMeshes(
  model: THREE.Object3D,
): Array<THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>> {
  const meshes: Array<THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>> = []

  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return
    }

    if (!child.geometry?.attributes.position || !child.geometry?.attributes.normal) {
      return
    }

    meshes.push(child as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>)
  })

  return meshes
}

function bakeMeshFrame(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>,
): THREE.BufferGeometry {
  const bakedGeometry = mesh.geometry.clone()
  const morphedAttributes = computeMorphedAttributes(mesh) as {
    morphedNormalAttribute: THREE.BufferAttribute
    morphedPositionAttribute: THREE.BufferAttribute
  }

  bakedGeometry.setAttribute('position', morphedAttributes.morphedPositionAttribute.clone())
  bakedGeometry.setAttribute('normal', bakeNormalFrame(mesh, morphedAttributes.morphedNormalAttribute))
  bakedGeometry.deleteAttribute('skinIndex')
  bakedGeometry.deleteAttribute('skinWeight')
  bakedGeometry.morphAttributes = {}
  bakedGeometry.applyMatrix4(mesh.matrixWorld)
  bakedGeometry.computeBoundingBox()
  bakedGeometry.computeBoundingSphere()

  return bakedGeometry
}

function bakeNormalFrame(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>,
  fallbackNormalAttribute: THREE.BufferAttribute,
): THREE.BufferAttribute {
  if (!(mesh instanceof THREE.SkinnedMesh)) {
    return fallbackNormalAttribute.clone()
  }

  const sourceNormalAttribute = mesh.geometry.getAttribute('normal')
  const sourceSkinIndexAttribute = mesh.geometry.getAttribute('skinIndex')
  const sourceSkinWeightAttribute = mesh.geometry.getAttribute('skinWeight')

  if (
    !(sourceNormalAttribute instanceof THREE.BufferAttribute) ||
    !(sourceSkinIndexAttribute instanceof THREE.BufferAttribute) ||
    !(sourceSkinWeightAttribute instanceof THREE.BufferAttribute)
  ) {
    return fallbackNormalAttribute.clone()
  }

  const bakedNormalAttribute = new THREE.BufferAttribute(
    new Float32Array(sourceNormalAttribute.count * sourceNormalAttribute.itemSize),
    sourceNormalAttribute.itemSize,
    sourceNormalAttribute.normalized,
  )

  for (let index = 0; index < sourceNormalAttribute.count; index += 1) {
    bakedSourceNormal.fromBufferAttribute(sourceNormalAttribute, index)
    bakedSkinIndices.fromBufferAttribute(sourceSkinIndexAttribute, index)
    bakedSkinWeights.fromBufferAttribute(sourceSkinWeightAttribute, index)

    const skinMatrixElements = bakedSkinMatrix.elements
    skinMatrixElements.fill(0)

    for (let weightIndex = 0; weightIndex < 4; weightIndex += 1) {
      const weight = bakedSkinWeights.getComponent(weightIndex)
      if (weight <= 0) {
        continue
      }

      const boneIndex = Math.trunc(bakedSkinIndices.getComponent(weightIndex))
      bakedBoneMatrix.multiplyMatrices(
        mesh.skeleton.bones[boneIndex].matrixWorld,
        mesh.skeleton.boneInverses[boneIndex],
      )

      const boneMatrixElements = bakedBoneMatrix.elements
      for (let elementIndex = 0; elementIndex < skinMatrixElements.length; elementIndex += 1) {
        skinMatrixElements[elementIndex] += boneMatrixElements[elementIndex] * weight
      }
    }

    bakedSkinMatrix.premultiply(mesh.bindMatrixInverse)
    bakedSkinMatrix.multiply(mesh.bindMatrix)
    bakedSkinNormalMatrix.setFromMatrix4(bakedSkinMatrix)
    bakedSkinnedNormal.copy(bakedSourceNormal).applyMatrix3(bakedSkinNormalMatrix)

    if (bakedSkinnedNormal.lengthSq() <= SKINNED_NORMAL_FALLBACK_EPSILON) {
      bakedSkinnedNormal.copy(bakedSourceNormal)
    }

    bakedSkinnedNormal.normalize()
    bakedNormalAttribute.setXYZ(index, bakedSkinnedNormal.x, bakedSkinnedNormal.y, bakedSkinnedNormal.z)
  }

  return bakedNormalAttribute
}

function getObjectSize(object: THREE.Object3D): THREE.Vector3 {
  const size = new THREE.Vector3()
  object.updateMatrixWorld(true)
  new THREE.Box3().setFromObject(object).getSize(size)
  return size
}

export function disposeCrowdTemplates(templates: Partial<Record<CrowdVariant, CrowdTemplate>> | null) {
  if (!templates) {
    return
  }

  for (const variant of CROWD_VARIANT_ORDER) {
    disposeCrowdTemplate(templates[variant] ?? null)
  }
}

function disposeCrowdTemplate(template: CrowdTemplate | null) {
  if (!template) {
    return
  }

  const disposedMaterials = new Set<THREE.Material>()
  const disposedTextures = new Set<THREE.Texture>()

  for (const part of template.parts) {
    for (const geometry of part.frameGeometries) {
      geometry.dispose()
    }

    const materials = Array.isArray(part.material) ? part.material : [part.material]
    for (const material of materials) {
      if (disposedMaterials.has(material)) {
        continue
      }

      disposedMaterials.add(material)
      disposeMaterialTextures(material, disposedTextures)
      material.dispose()
    }
  }
}

function disposeMaterialTextures(material: THREE.Material, disposedTextures: Set<THREE.Texture>) {
  const maybeMaterial = material as unknown as Record<string, unknown>
  for (const value of Object.values(maybeMaterial)) {
    if (!(value instanceof THREE.Texture) || disposedTextures.has(value)) {
      continue
    }

    disposedTextures.add(value)
    value.dispose()
  }
}

export function disposeTerrainTemplate(template: TerrainTemplate | null) {
  if (!template) {
    return
  }

  disposeTemplateModel(template.model)
}

export function disposeTerrainMaterials(materials: TerrainMaterials | null) {
  if (!materials) {
    return
  }

  for (const material of Object.values(materials)) {
    material.dispose()
  }
}

export function disposeWaterAssets(waterAssets: WaterAssets | null) {
  if (!waterAssets) {
    return
  }

  waterAssets.noiseTexture.dispose()
  waterAssets.roadTexture.dispose()
  for (const texture of Object.values(waterAssets.maskTextures)) {
    texture.dispose()
  }
}

export function disposeWaterMaterialStates(states: WaterMaterialState[]) {
  for (const state of states) {
    state.material.dispose()
  }
}

export function disposeTemplateModel(model: THREE.Object3D | null) {
  if (!model) {
    return
  }

  const disposedMaterials = new Set<THREE.Material>()
  const disposedTextures = new Set<THREE.Texture>()

  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return
    }

    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (disposedMaterials.has(material)) {
        continue
      }

      disposedMaterials.add(material)
      disposeMaterialTextures(material, disposedTextures)
      material.dispose()
    }
  })
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, 0)
    })
  })
}

async function extractEmbeddedTextureUrls(assetUrl: string): Promise<Map<string, string>> {
  const response = await fetch(assetUrl)
  if (!response.ok) {
    return new Map()
  }

  const buffer = await response.arrayBuffer()
  const textureNames = extractEmbeddedTextureNames(buffer)
  const textureAssets = extractEmbeddedImages(buffer)
  const textureUrlMap = new Map<string, string>()

  for (let index = 0; index < Math.min(textureNames.length, textureAssets.length); index += 1) {
    const blobUrl = createEmbeddedTextureUrl(textureAssets[index])
    for (const key of buildTextureLookupKeys(textureNames[index])) {
      textureUrlMap.set(key, blobUrl)
    }
  }

  if (!textureUrlMap.size && textureAssets.length === 1) {
    textureUrlMap.set('.', createEmbeddedTextureUrl(textureAssets[0]))
  }

  return textureUrlMap
}

function createEmbeddedTextureUrl(textureAsset: { bytes: Uint8Array; mimeType: string }): string {
  const blobBuffer = textureAsset.bytes.buffer.slice(
    textureAsset.bytes.byteOffset,
    textureAsset.bytes.byteOffset + textureAsset.bytes.byteLength,
  ) as ArrayBuffer

  return URL.createObjectURL(new Blob([blobBuffer], { type: textureAsset.mimeType }))
}

function extractEmbeddedTextureNames(buffer: ArrayBuffer): string[] {
  const text = new TextDecoder('latin1').decode(buffer)
  const textureNames: string[] = []
  const seen = new Set<string>()
  const filenamePattern = /(?:RelativeFilename|Filename)S[\s\S]{0,24}?([A-Za-z0-9_ .:\\/-]+\.(?:png|jpg|jpeg|webp))/gi

  for (const match of text.matchAll(filenamePattern)) {
    const textureName = match[1]?.trim()
    if (!textureName) {
      continue
    }

    const normalizedName = textureName.toLowerCase()
    if (seen.has(normalizedName)) {
      continue
    }

    seen.add(normalizedName)
    textureNames.push(textureName)
  }

  return textureNames
}

function extractEmbeddedImages(buffer: ArrayBuffer): Array<{ bytes: Uint8Array; mimeType: string }> {
  const bytes = new Uint8Array(buffer)
  const textureAssets: Array<{ bytes: Uint8Array; mimeType: string }> = []
  let searchIndex = 0

  while (searchIndex < bytes.length) {
    const webpOffset = findWebpOffset(bytes, searchIndex)
    const pngOffset = findPattern(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], searchIndex)
    const jpegOffset = findPattern(bytes, [0xff, 0xd8, 0xff], searchIndex)
    const nextOffset = [webpOffset, pngOffset, jpegOffset].filter((offset) => offset >= 0).sort((a, b) => a - b)[0]

    if (nextOffset === undefined) {
      break
    }

    if (nextOffset === webpOffset) {
      const byteLength = new DataView(buffer, webpOffset + 4, 4).getUint32(0, true) + 8
      textureAssets.push({
        bytes: bytes.slice(webpOffset, webpOffset + byteLength),
        mimeType: 'image/webp',
      })
      searchIndex = webpOffset + byteLength
      continue
    }

    if (nextOffset === pngOffset) {
      const pngTail = findPattern(bytes, [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], pngOffset)
      if (pngTail >= 0) {
        textureAssets.push({
          bytes: bytes.slice(pngOffset, pngTail + 8),
          mimeType: 'image/png',
        })
        searchIndex = pngTail + 8
        continue
      }
    }

    const jpegTail = findPattern(bytes, [0xff, 0xd9], jpegOffset + 3)
    if (jpegTail >= 0) {
      textureAssets.push({
        bytes: bytes.slice(jpegOffset, jpegTail + 2),
        mimeType: 'image/jpeg',
      })
      searchIndex = jpegTail + 2
      continue
    }

    searchIndex = nextOffset + 1
  }

  return textureAssets
}

function resolveEmbeddedTextureUrl(
  url: string,
  textureUrlMap: Map<string, string>,
  fallbackTextureUrl: string | null,
): string | null {
  for (const key of buildTextureLookupKeys(url)) {
    const resolved = textureUrlMap.get(key)
    if (resolved) {
      return resolved
    }
  }

  if (fallbackTextureUrl && isEmbeddedTextureReference(url)) {
    return fallbackTextureUrl
  }

  return null
}

function buildTextureLookupKeys(textureName: string): string[] {
  const normalizedName = textureName.trim().replace(/\\/g, '/').toLowerCase()
  const basename = normalizedName.split('/').pop() ?? normalizedName

  return Array.from(
    new Set([
      normalizedName,
      basename,
      normalizedName.startsWith('/') ? normalizedName.slice(1) : normalizedName,
    ]),
  )
}

function findWebpOffset(bytes: Uint8Array, startIndex = 0): number {
  for (let index = startIndex; index <= bytes.length - 12; index += 1) {
    if (
      bytes[index] === 0x52 &&
      bytes[index + 1] === 0x49 &&
      bytes[index + 2] === 0x46 &&
      bytes[index + 3] === 0x46 &&
      bytes[index + 8] === 0x57 &&
      bytes[index + 9] === 0x45 &&
      bytes[index + 10] === 0x42 &&
      bytes[index + 11] === 0x50
    ) {
      return index
    }
  }

  return -1
}

function findPattern(bytes: Uint8Array, pattern: number[], startIndex = 0): number {
  for (let index = startIndex; index <= bytes.length - pattern.length; index += 1) {
    let matched = true

    for (let patternIndex = 0; patternIndex < pattern.length; patternIndex += 1) {
      if (bytes[index + patternIndex] !== pattern[patternIndex]) {
        matched = false
        break
      }
    }

    if (matched) {
      return index
    }
  }

  return -1
}

function isEmbeddedTextureReference(url: string): boolean {
  return url === '.' || url.endsWith('/.') || url.toLowerCase().endsWith('.fbm')
}
