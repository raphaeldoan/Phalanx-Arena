/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  buildBattlefieldInteractionModel,
  resolveCellClick,
  resolvePreviewActionAtCoord,
  type BattlefieldInteractionModel,
  type BattlefieldPickTarget,
} from './battlefieldInteraction'
import {
  clamp,
  resolutionKey,
  type CameraPresetId,
} from './battlefieldShared'
import {
  disposeBattlefieldSceneResources,
  loadBattlefieldSceneResources,
  MAX_PIXEL_RATIO,
  TILE_SIZE,
  type CrowdTemplates,
  type TerrainMaterials,
  type TerrainTemplate,
  type VolleyTemplate,
  type WaterAssets,
  type WaterMaterialState,
} from './battlefield3d/sceneResources'
import {
  coordToWorld,
  disposeFormationScene,
  disposeOverlayGroup,
  disposeTerrainScene,
  disposeVolleyScene,
  pickTargetFromPointerEvent,
  projectCombatAnchor,
  projectWorldPointToScreen,
  rebuildFormationScene,
  rebuildInteractionProxyScene,
  rebuildTacticalOverlayScene,
  rebuildTerrainScene,
  rebuildVolleyScene,
  resolveUnitOverlayWorldPoint,
  updateActiveVolley,
  updateCrowdAnimation,
  updateDisorderedPulseMaterials,
  type ActiveVolleyState,
  type CombatAnchorProjection,
  type CrowdAnimationState,
  type DisorderedPulseMaterialState,
  type TerrainSurface,
} from './battlefield3d/sceneGraph'
import { Battlefield3DToolbar } from './battlefield3d/Battlefield3DToolbar'
import {
  applyCameraPresetToScene,
  constrainControlsTarget,
  persistCameraPreset,
  readStoredCameraPreset,
} from './battlefield3d/cameraControls'
import { canvasShowsPresentedScene, yieldToBrowser } from './battlefield3d/sceneLifecycle'
import {
  buildHoverInfo,
  buildHtmlOverlayDescriptors,
  buildMapEdgeOverlayDescriptors,
  buildTransientDisorderOverlays,
  buildUnitHoverTooltip,
  buildUnitStatusOverlayDescriptors,
  clearTransientUnitOverlayTimeouts,
  hasAnimatingHtmlOverlay,
  isInteractiveOverlayKind,
  overlayOpacity,
  overlayTransform,
  overlayZIndex,
  queueTransientUnitOverlayRemovals,
  type HoverPointerPosition,
  type ScreenOverlayDescriptor,
  type TransientUnitOverlayDescriptor,
} from './battlefield3d/overlays'
import { BattlefieldHtmlOverlayLayer } from './battlefield3d/BattlefieldHtmlOverlayLayer'
import { arePickTargetsEqual } from './battlefield3d/picking'
import type {
  Action,
  ArmyId,
  CombatResolution,
  Coord,
  GameState,
  LegalAction,
} from './types'

type Battlefield3DProps = {
  interaction?: BattlefieldInteractionModel | null
  cameraDistanceScale?: number
  initialCameraPreset?: CameraPresetId
  legalActions?: LegalAction[]
  onCellClick?: (coord: Coord, additiveSelection?: boolean) => void
  onLoadStateChange?: (state: { errorMessage: string | null; isScenePresented: boolean; loadStatus: LoadStatus }) => void
  onClearPreview?: () => void
  onPreviewAction?: (action: LegalAction | null) => void
  onResolveAction?: (action: Action) => void
  onSelectionChange?: (selectedUnitIds: string[]) => void
  providerLabels?: Partial<Record<ArmyId, string>> | null
  onCombatAnchorChange?: (layout: CombatAnchorProjection | null) => void
  onCameraPresetChange?: (preset: CameraPresetId) => void
  previewAction?: LegalAction | null
  selectedResolution?: CombatResolution | null
  selectedUnitIds?: string[]
  state?: GameState | null
  uiLocked?: boolean
}

type LoadStatus = 'loading' | 'ready' | 'error'
type CameraTransitionState = {
  durationMs: number
  endPosition: THREE.Vector3
  endTarget: THREE.Vector3
  startPosition: THREE.Vector3
  startTarget: THREE.Vector3
  startedAt: number
}

function Battlefield3D({
  cameraDistanceScale = 1,
  initialCameraPreset = 'army_a',
  interaction,
  legalActions,
  onCameraPresetChange,
  onCellClick,
  onClearPreview,
  onLoadStateChange,
  onCombatAnchorChange,
  onPreviewAction,
  onResolveAction,
  onSelectionChange,
  previewAction,
  providerLabels,
  selectedResolution,
  selectedUnitIds,
  state,
  uiLocked = false,
}: Battlefield3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const overlayLayerRef = useRef<HTMLDivElement | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const raycasterRef = useRef(new THREE.Raycaster())
  const pointerRef = useRef(new THREE.Vector2())
  const keyLightRef = useRef<THREE.DirectionalLight | null>(null)
  const terrainGroupRef = useRef(new THREE.Group())
  const terrainBorderGroupRef = useRef(new THREE.Group())
  const forestGroupRef = useRef(new THREE.Group())
  const volleyGroupRef = useRef(new THREE.Group())
  const overlayGroupRef = useRef(new THREE.Group())
  const providerBadgeGroupRef = useRef(new THREE.Group())
  const proxyGroupRef = useRef(new THREE.Group())
  const terrainTemplateRef = useRef<TerrainTemplate | null>(null)
  const terrainMaterialsRef = useRef<TerrainMaterials | null>(null)
  const terrainTextureRef = useRef<THREE.Texture | null>(null)
  const forestTreeTemplateRef = useRef<THREE.Group | null>(null)
  const selectionIndicatorTemplateRef = useRef<THREE.Group | null>(null)
  const volleyTemplateRef = useRef<VolleyTemplate | null>(null)
  const waterAssetsRef = useRef<WaterAssets | null>(null)
  const waterMaterialStatesRef = useRef<WaterMaterialState[]>([])
  const terrainSurfaceMapRef = useRef(new Map<string, TerrainSurface>())
  const providerBadgeTextureCacheRef = useRef(new Map<string, THREE.CanvasTexture>())
  const formationGroupRef = useRef(new THREE.Group())
  const crowdTemplatesRef = useRef<CrowdTemplates | null>(null)
  const crowdAnimationStatesRef = useRef<CrowdAnimationState[]>([])
  const disorderedPulseMaterialStatesRef = useRef<DisorderedPulseMaterialState[]>([])
  const activeVolleyRef = useRef<ActiveVolleyState | null>(null)
  const overlayElementMapRef = useRef(new Map<string, HTMLButtonElement | HTMLDivElement>())
  const screenOverlayDescriptorsRef = useRef<ScreenOverlayDescriptor[]>([])
  const htmlOverlaysDirtyRef = useRef(true)
  const transientOverlayTimeoutIdsRef = useRef(new Map<string, number>())
  const previousStateRef = useRef<GameState | null>(null)
  const effectiveStateRef = useRef<GameState | null>(null)
  const selectedResolutionRef = useRef<CombatResolution | null>(selectedResolution ?? null)
  const interactionModelRef = useRef<BattlefieldInteractionModel | null>(null)
  const selectedUnitIdsRef = useRef<string[]>(selectedUnitIds ?? interaction?.selectedUnitIds ?? [])
  const hoveredTargetRef = useRef<BattlefieldPickTarget | null>(null)
  const cameraPresetRef = useRef<CameraPresetId>(readStoredCameraPreset())
  const combatAnchorRef = useRef<CombatAnchorProjection | null>(null)
  const boardBoundsRef = useRef({ centerX: 0, centerZ: 0, halfSpan: 0 })
  const clockRef = useRef(new THREE.Clock())
  const lastFrameTimeRef = useRef(0)
  const cameraInteractionActiveRef = useRef(false)
  const cameraInteractionMovedRef = useRef(false)
  const cameraInteractionStartPositionRef = useRef(new THREE.Vector3())
  const cameraInteractionStartTargetRef = useRef(new THREE.Vector3())
  const cameraTransitionRef = useRef<CameraTransitionState | null>(null)
  const suppressClickUntilRef = useRef(0)
  const manualCameraOverrideRef = useRef(false)
  const lastAutoCameraBoardKeyRef = useRef<string | null>(null)
  const lastAutoFocusedResolutionKeyRef = useRef<string | null>(null)
  const loadStatusRef = useRef<LoadStatus>('loading')
  const isScenePresentedRef = useRef(false)
  const pendingPresentationCheckRef = useRef(false)
  const visiblePresentationFrameCountRef = useRef(0)
  const skipNextReadyLayoutBuildRef = useRef(false)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isScenePresented, setIsScenePresented] = useState(false)
  const [internalSelectedUnitIds, setInternalSelectedUnitIds] = useState<string[]>(selectedUnitIds ?? [])
  const [internalPreviewAction, setInternalPreviewAction] = useState<LegalAction | null>(null)
  const [hoveredTarget, setHoveredTarget] = useState<BattlefieldPickTarget | null>(null)
  const [hoverPointerPosition, setHoverPointerPosition] = useState<HoverPointerPosition | null>(null)
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>(readStoredCameraPreset())
  const [combatAnchorProjection, setCombatAnchorProjection] = useState<CombatAnchorProjection | null>(null)
  const [transientUnitOverlays, setTransientUnitOverlays] = useState<TransientUnitOverlayDescriptor[]>([])
  const [terrainSurfaceMapSnapshot, setTerrainSurfaceMapSnapshot] = useState<Map<string, TerrainSurface>>(() => new Map())

  const effectiveState = interaction?.state ?? state ?? null
  const effectiveSelectedUnitIds = interaction?.selectedUnitIds ?? selectedUnitIds ?? internalSelectedUnitIds
  const effectivePreviewAction = previewAction ?? internalPreviewAction
  const effectiveInteraction = useMemo(
    () =>
      interaction ??
      (effectiveState && legalActions
        ? buildBattlefieldInteractionModel({
            state: effectiveState,
            legalActions,
            previewAction: effectivePreviewAction,
            selectedUnitIds: effectiveSelectedUnitIds,
          })
        : null),
    [effectivePreviewAction, effectiveSelectedUnitIds, effectiveState, interaction, legalActions],
  )
  const overlayDescriptors = useMemo(
    () => buildHtmlOverlayDescriptors(effectiveState, effectiveInteraction, hoveredTarget),
    [effectiveInteraction, effectiveState, hoveredTarget],
  )
  const unitStatusDescriptors = useMemo(
    () => buildUnitStatusOverlayDescriptors(effectiveState, terrainSurfaceMapSnapshot),
    [effectiveState, terrainSurfaceMapSnapshot],
  )
  const transientUnitOverlayDescriptors = transientUnitOverlays
  const mapEdgeDescriptors = useMemo(() => buildMapEdgeOverlayDescriptors(effectiveState), [effectiveState])
  const screenOverlayDescriptors = useMemo<ScreenOverlayDescriptor[]>(
    () => [...overlayDescriptors, ...unitStatusDescriptors, ...transientUnitOverlayDescriptors, ...mapEdgeDescriptors],
    [mapEdgeDescriptors, overlayDescriptors, transientUnitOverlayDescriptors, unitStatusDescriptors],
  )
  const activeGameId = effectiveState?.game_id ?? null
  const autoCameraBoardKey = effectiveState
    ? `${effectiveState.game_id}:${effectiveState.board_width}:${effectiveState.board_height}`
    : null

  function markHtmlOverlaysDirty() {
    htmlOverlaysDirtyRef.current = true
  }

  useLayoutEffect(() => {
    effectiveStateRef.current = effectiveState
    selectedResolutionRef.current = selectedResolution ?? null
    interactionModelRef.current = effectiveInteraction
    markHtmlOverlaysDirty()
  }, [effectiveInteraction, effectiveState, selectedResolution])

  useEffect(() => {
    selectedUnitIdsRef.current = effectiveSelectedUnitIds
    markHtmlOverlaysDirty()
    if (!interaction?.selectedUnitIds && selectedUnitIds === undefined) {
      setInternalSelectedUnitIds(effectiveSelectedUnitIds)
    }
  }, [effectiveSelectedUnitIds, interaction?.selectedUnitIds, selectedUnitIds])

  useEffect(() => {
    cameraPresetRef.current = cameraPreset
    onCameraPresetChange?.(cameraPreset)
  }, [cameraPreset, onCameraPresetChange])

  useEffect(() => {
    if (!activeGameId) {
      return
    }

    manualCameraOverrideRef.current = false
    cameraPresetRef.current = initialCameraPreset
    setCameraPreset((current) => (current === initialCameraPreset ? current : initialCameraPreset))
  }, [activeGameId, initialCameraPreset])

  useEffect(() => {
    persistCameraPreset(cameraPreset)
  }, [cameraPreset])

  useEffect(() => {
    if (!effectiveState) {
      previousStateRef.current = null
      clearTransientUnitOverlayTimeouts(transientOverlayTimeoutIdsRef.current)
      setTransientUnitOverlays([])
      markHtmlOverlaysDirty()
      return
    }

    const previousState = previousStateRef.current
    if (
      !previousState ||
      previousState.game_id !== effectiveState.game_id ||
      effectiveState.log.length < previousState.log.length
    ) {
      previousStateRef.current = effectiveState
      clearTransientUnitOverlayTimeouts(transientOverlayTimeoutIdsRef.current)
      setTransientUnitOverlays([])
      markHtmlOverlaysDirty()
      return
    }

    const appendedEntries = effectiveState.log.slice(previousState.log.length)
    if (appendedEntries.length) {
      const now = performance.now()
      const nextOverlays = buildTransientDisorderOverlays(
        appendedEntries,
        previousState.log.length,
        previousState,
        effectiveState,
        terrainSurfaceMapRef.current,
        now,
      )

      if (nextOverlays.length) {
        setTransientUnitOverlays((current) => [...current.filter((overlay) => overlay.expiresAt > now), ...nextOverlays])
        queueTransientUnitOverlayRemovals(nextOverlays, transientOverlayTimeoutIdsRef.current, setTransientUnitOverlays)
        markHtmlOverlaysDirty()
      }
    }

    previousStateRef.current = effectiveState
  }, [effectiveState])

  useEffect(() => {
    return () => {
      clearTransientUnitOverlayTimeouts(transientOverlayTimeoutIdsRef.current)
    }
  }, [])

  const rebuildTerrain = useEffectEvent((nextState: GameState | null) => {
    terrainSurfaceMapRef.current = rebuildTerrainScene({
      forestGroup: forestGroupRef.current,
      forestTreeTemplate: forestTreeTemplateRef.current,
      state: nextState,
      terrainBorderGroup: terrainBorderGroupRef.current,
      terrainGroup: terrainGroupRef.current,
      terrainMaterials: terrainMaterialsRef.current,
      terrainTemplate: terrainTemplateRef.current,
      waterAssets: waterAssetsRef.current,
      waterMaterialStates: waterMaterialStatesRef.current,
    })
    setTerrainSurfaceMapSnapshot(new Map(terrainSurfaceMapRef.current))
    markHtmlOverlaysDirty()
  })

  const rebuildFormation = useEffectEvent((nextState: GameState | null) => {
    if (!cameraRef.current || !controlsRef.current) {
      disposeFormationScene({
        disorderedPulseMaterialStates: disorderedPulseMaterialStatesRef.current,
        formationGroup: formationGroupRef.current,
      })
      crowdAnimationStatesRef.current = []
      disorderedPulseMaterialStatesRef.current = []
      markHtmlOverlaysDirty()
      return
    }

    const { crowdAnimationStates, disorderedPulseMaterialStates } = rebuildFormationScene({
      crowdTemplates: crowdTemplatesRef.current,
      elapsedTime: clockRef.current.getElapsedTime(),
      formationGroup: formationGroupRef.current,
      keyLight: keyLightRef.current,
      previousDisorderedPulseMaterialStates: disorderedPulseMaterialStatesRef.current,
      state: nextState,
      terrainSurfaceMap: terrainSurfaceMapRef.current,
    })
    crowdAnimationStatesRef.current = crowdAnimationStates
    disorderedPulseMaterialStatesRef.current = disorderedPulseMaterialStates
    markHtmlOverlaysDirty()
  })

  const rebuildVolley = useEffectEvent(
    (nextState: GameState | null, nextPreviewAction: LegalAction | null, nextSelectedResolution: CombatResolution | null) => {
      activeVolleyRef.current = rebuildVolleyScene({
        activeVolley: activeVolleyRef.current,
        clock: clockRef.current,
        previewAction: nextPreviewAction,
        selectedResolution: nextSelectedResolution,
        state: nextState,
        terrainSurfaceMap: terrainSurfaceMapRef.current,
        volleyGroup: volleyGroupRef.current,
        volleyTemplate: volleyTemplateRef.current,
      })
      markHtmlOverlaysDirty()
    },
  )

  const rebuildInteractionProxies = useEffectEvent((nextState: GameState | null) => {
    if (!nextState) {
      boardBoundsRef.current = { centerX: 0, centerZ: 0, halfSpan: 0 }
    } else {
      boardBoundsRef.current = {
        centerX: coordToWorld((nextState.board_width - 1) / 2, (nextState.board_height - 1) / 2, nextState.board_width, nextState.board_height).x,
        centerZ: coordToWorld((nextState.board_width - 1) / 2, (nextState.board_height - 1) / 2, nextState.board_width, nextState.board_height).z,
        halfSpan: Math.max(nextState.board_width, nextState.board_height) * TILE_SIZE * 0.5,
      }
    }

    rebuildInteractionProxyScene({
      group: proxyGroupRef.current,
      state: nextState,
    })
    markHtmlOverlaysDirty()
  })

  const rebuildTacticalOverlays = useEffectEvent((nextState: GameState | null, nextInteraction: BattlefieldInteractionModel | null) => {
    rebuildTacticalOverlayScene({
      group: overlayGroupRef.current,
      hoveredTarget: hoveredTargetRef.current,
      interaction: nextInteraction,
      selectionIndicatorTemplate: selectionIndicatorTemplateRef.current,
      state: nextState,
      terrainSurfaceMap: terrainSurfaceMapRef.current,
    })
    markHtmlOverlaysDirty()
  })

  const rebuildProviderBadges = useEffectEvent((nextState: GameState | null) => {
    rebuildProviderBadgeScene({
      group: providerBadgeGroupRef.current,
      providerLabels,
      state: nextState,
      terrainSurfaceMap: terrainSurfaceMapRef.current,
      textureCache: providerBadgeTextureCacheRef.current,
    })
  })

  const buildPreviewInteractionModel = useEffectEvent(
    (
      nextState: GameState | null,
      nextInteraction: BattlefieldInteractionModel | null,
      nextPreviewAction: LegalAction | null,
    ): BattlefieldInteractionModel | null => {
      if (!nextState) {
        return null
      }

      const nextLegalActions = nextInteraction?.legalActions ?? legalActions
      if (!nextLegalActions) {
        return nextInteraction
      }

      return buildBattlefieldInteractionModel({
        state: nextState,
        legalActions: nextLegalActions,
        selectedUnitIds: nextInteraction?.selectedUnitIds ?? selectedUnitIdsRef.current,
        previewAction: nextPreviewAction,
      })
    },
  )

  function handlePreviewActionChange(action: LegalAction | null) {
    markHtmlOverlaysDirty()
    if (action) {
      onPreviewAction?.(action)
      if (!onPreviewAction) {
        setInternalPreviewAction(action)
      }
      return
    }

    onClearPreview?.()
    if (!onClearPreview) {
      setInternalPreviewAction(null)
    }
  }

  const updatePointerPreview = useEffectEvent((target: BattlefieldPickTarget | null) => {
    if (arePickTargetsEqual(hoveredTargetRef.current, target)) {
      return
    }

    hoveredTargetRef.current = target
    setHoveredTarget(target)

    const nextState = effectiveState
    const nextInteraction = interactionModelRef.current
    if (!nextState) {
      if (target === null) {
        handlePreviewActionChange(null)
      }
      return
    }

    if (target === null) {
      handlePreviewActionChange(null)
      rebuildTacticalOverlays(nextState, buildPreviewInteractionModel(nextState, nextInteraction, null) ?? nextInteraction)
      return
    }

    const action = nextInteraction ? resolvePreviewActionAtCoord(nextInteraction, target.coord) : null
    handlePreviewActionChange(action ?? null)

    rebuildTacticalOverlays(nextState, buildPreviewInteractionModel(nextState, nextInteraction, action ?? null) ?? nextInteraction)
  })

  const handleSelectionChange = useEffectEvent((selectedIds: string[]) => {
    selectedUnitIdsRef.current = selectedIds
    markHtmlOverlaysDirty()
    onSelectionChange?.(selectedIds)
    if (!onSelectionChange) {
      setInternalSelectedUnitIds(selectedIds)
    }
  })

  const handleResolvedAction = (action: Action) => {
    onResolveAction?.(action)
  }

  const handlePickClick = useEffectEvent((target: BattlefieldPickTarget, additiveSelection: boolean) => {
    const nextState = effectiveState
    const nextInteraction = interactionModelRef.current
    if (!nextState || !nextInteraction) {
      return
    }

    if (onCellClick) {
      onCellClick(target.coord, additiveSelection)
      return
    }

    const result = resolveCellClick(nextInteraction, target.coord, selectedUnitIdsRef.current, additiveSelection)
    if (result.type === 'dispatch') {
      handleResolvedAction(result.action)
      return
    }

    if (result.type === 'selection') {
      handleSelectionChange(result.selectedUnitIds)
    }
  })

  const handlePointerMove = useEffectEvent((event: PointerEvent) => {
    if (cameraInteractionActiveRef.current) {
      return
    }

    const container = containerRef.current
    if (container) {
      const rect = container.getBoundingClientRect()
      setHoverPointerPosition({
        height: rect.height,
        width: rect.width,
        x: clamp(event.clientX - rect.left, 0, rect.width),
        y: clamp(event.clientY - rect.top, 0, rect.height),
      })
    }

    const target = pickTargetFromPointerEvent(event, proxyGroupRef.current, cameraRef.current, raycasterRef.current, pointerRef.current)
    if (!target) {
      updatePointerPreview(null)
      return
    }

    updatePointerPreview(target)
  })

  const handlePointerLeave = useEffectEvent((event: PointerEvent) => {
    const relatedTarget = event.relatedTarget as Node | null
    if (relatedTarget && containerRef.current?.contains(relatedTarget)) {
      return
    }

    hoveredTargetRef.current = null
    setHoveredTarget(null)
    setHoverPointerPosition(null)
    handlePreviewActionChange(null)
    rebuildTacticalOverlays(
      effectiveState,
      buildPreviewInteractionModel(effectiveState, interactionModelRef.current, null) ?? interactionModelRef.current,
    )
  })

  const handlePointerClick = useEffectEvent((event: PointerEvent) => {
    if (uiLocked || cameraInteractionActiveRef.current || performance.now() < suppressClickUntilRef.current) {
      return
    }

    const eventTarget = event.target as Node | null
    if (eventTarget && overlayLayerRef.current?.contains(eventTarget)) {
      return
    }

    const target = pickTargetFromPointerEvent(event, proxyGroupRef.current, cameraRef.current, raycasterRef.current, pointerRef.current)
    if (!target) {
      handlePreviewActionChange(null)
      return
    }

    handlePickClick(target, event.shiftKey || event.ctrlKey || event.metaKey)
  })

  const updateProjectedCombatAnchor = useEffectEvent(() => {
    const nextState = effectiveState
    const nextResolution = selectedResolution ?? null
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!nextState || !nextResolution || !camera || !controls) {
      combatAnchorRef.current = null
      setCombatAnchorProjection(null)
      onCombatAnchorChange?.(null)
      return
    }

    const container = containerRef.current
    if (!container) {
      combatAnchorRef.current = null
      setCombatAnchorProjection(null)
      onCombatAnchorChange?.(null)
      return
    }

    const projection = projectCombatAnchor(nextState, nextResolution, camera, container)
    if (!projection) {
      combatAnchorRef.current = null
      setCombatAnchorProjection(null)
      onCombatAnchorChange?.(null)
      return
    }

    const previousProjection = combatAnchorRef.current
    if (
      previousProjection &&
      previousProjection.anchorStyle.left === projection.anchorStyle.left &&
      previousProjection.anchorStyle.top === projection.anchorStyle.top &&
      previousProjection.side === projection.side
    ) {
      return
    }

    combatAnchorRef.current = projection
    setCombatAnchorProjection(projection)
    onCombatAnchorChange?.(projection)
  })

  const positionHtmlOverlays = useEffectEvent((currentTime = performance.now()) => {
    const camera = cameraRef.current
    const state = effectiveState
    const container = containerRef.current
    if (!camera || !state || !container) {
      return
    }

    camera.updateMatrixWorld()

    const width = container.clientWidth
    const height = container.clientHeight
    const descriptors = screenOverlayDescriptorsRef.current

    for (const descriptor of descriptors) {
      const element = overlayElementMapRef.current.get(descriptor.id)
      if (!element) {
        continue
      }

      const screen =
        'world' in descriptor && descriptor.world
          ? projectWorldPointToScreen(descriptor.world, camera, container)
          : 'anchor' in descriptor && descriptor.anchor
            ? (() => {
                const world = coordToWorld(descriptor.anchor.x, descriptor.anchor.y, state.board_width, state.board_height)
                return projectWorldPointToScreen(new THREE.Vector3(world.x, 0.2, world.z), camera, container)
              })()
            : null
      if (!screen) {
        element.style.display = 'none'
        continue
      }

      element.style.display = 'block'
      element.style.left = `${clamp(screen.x + descriptor.offset.x, 8, Math.max(8, width - 8))}px`
      element.style.top = `${clamp(screen.y + descriptor.offset.y, 8, Math.max(8, height - 8))}px`
      element.style.transform = overlayTransform(descriptor, currentTime)
      element.style.opacity = overlayOpacity(descriptor, currentTime)
      element.style.pointerEvents =
        cameraInteractionActiveRef.current || !isInteractiveOverlayKind(descriptor.kind) ? 'none' : 'auto'
      element.style.zIndex = overlayZIndex(descriptor.kind)
    }

    updateProjectedCombatAnchor()
    htmlOverlaysDirtyRef.current = false
  })

  useLayoutEffect(() => {
    screenOverlayDescriptorsRef.current = screenOverlayDescriptors
    markHtmlOverlaysDirty()

    if (loadStatus === 'ready' && isScenePresented) {
      positionHtmlOverlays()
    }
  }, [isScenePresented, loadStatus, screenOverlayDescriptors])

  function applyCameraPreset(preset: CameraPresetId) {
    const camera = cameraRef.current
    const controls = controlsRef.current
    const presetArgs = {
      boardBounds: boardBoundsRef.current,
      camera,
      controls,
      distanceScale: cameraDistanceScale,
      interaction: interactionModelRef.current,
      preset,
      selectedResolution: selectedResolutionRef.current,
      state: effectiveStateRef.current,
    }
    cameraTransitionRef.current = null
    const applied = applyCameraPresetToScene(presetArgs)
    if (applied) {
      markHtmlOverlaysDirty()
    }
  }

  function transitionCameraToPreset(preset: CameraPresetId, durationMs = 520) {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) {
      return
    }

    const startPosition = camera.position.clone()
    const startTarget = controls.target.clone()
    const applied = applyCameraPresetToScene({
      boardBounds: boardBoundsRef.current,
      camera,
      controls,
      distanceScale: cameraDistanceScale,
      interaction: interactionModelRef.current,
      preset,
      selectedResolution: selectedResolutionRef.current,
      state: effectiveStateRef.current,
    })
    if (applied) {
      const endPosition = camera.position.clone()
      const endTarget = controls.target.clone()
      camera.position.copy(startPosition)
      controls.target.copy(startTarget)
      controls.update()
      cameraTransitionRef.current = {
        durationMs,
        endPosition,
        endTarget,
        startPosition,
        startTarget,
        startedAt: performance.now(),
      }
      markHtmlOverlaysDirty()
    }
  }

  function updateCameraTransition(currentTime: number): boolean {
    const transition = cameraTransitionRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!transition || !camera || !controls) {
      return false
    }

    const progress = clamp((currentTime - transition.startedAt) / transition.durationMs, 0, 1)
    const easedProgress = 1 - Math.pow(1 - progress, 3)
    camera.position.lerpVectors(transition.startPosition, transition.endPosition, easedProgress)
    controls.target.lerpVectors(transition.startTarget, transition.endTarget, easedProgress)

    if (progress >= 1) {
      cameraTransitionRef.current = null
    }

    return true
  }

  function applyExplicitCameraPreset(preset: CameraPresetId) {
    manualCameraOverrideRef.current = false
    setCameraPreset(preset)
    applyCameraPreset(preset)
  }

  const focusSelectedResolutionCamera = useEffectEvent(() => {
    transitionCameraToPreset('focus_target')
  })

  useEffect(() => {
    if (!selectedResolution) {
      lastAutoFocusedResolutionKeyRef.current = null
      return
    }

    if (loadStatus !== 'ready' || !isScenePresented || !effectiveState) {
      return
    }

    const key = resolutionKey(selectedResolution)
    if (lastAutoFocusedResolutionKeyRef.current === key) {
      return
    }

    lastAutoFocusedResolutionKeyRef.current = key
    focusSelectedResolutionCamera()
  }, [effectiveState, isScenePresented, loadStatus, selectedResolution])

  useEffect(() => {
    if (!selectedResolution || !effectiveState || !cameraRef.current || !controlsRef.current) {
      setCombatAnchorProjection(null)
      onCombatAnchorChange?.(null)
      return
    }

    updateProjectedCombatAnchor()
  }, [effectiveState, onCombatAnchorChange, selectedResolution, updateProjectedCombatAnchor])

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (isTextEntryTarget(event.target)) {
      return
    }

    if (event.key === 'Escape') {
      hoveredTargetRef.current = null
      setHoveredTarget(null)
      setHoverPointerPosition(null)
      handlePreviewActionChange(null)
      handleSelectionChange([])
      rebuildInteractionProxies(effectiveState)
      rebuildTacticalOverlays(
        effectiveState,
        buildPreviewInteractionModel(effectiveState, interactionModelRef.current, null) ?? interactionModelRef.current,
      )
      return
    }

    if (event.key === 'r' || event.key === 'R') {
      applyExplicitCameraPreset('reset')
      return
    }

    if (event.key === 'f' || event.key === 'F') {
      applyExplicitCameraPreset('focus_selection')
    }
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xffffff)

    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 150)
    camera.position.set(12, 9, 12)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = false
    controls.enableZoom = true
    controls.enablePan = true
    controls.screenSpacePanning = false
    controls.rotateSpeed = 0.9
    controls.panSpeed = 0.9
    controls.zoomSpeed = 0.9
    controls.minPolarAngle = Math.PI / 14
    controls.maxPolarAngle = Math.PI / 2.12
    controls.minDistance = 10
    controls.maxDistance = 60
    controlsRef.current = controls

    const hemisphereLight = new THREE.HemisphereLight(0xf8f0de, 0x544937, 1.2)
    scene.add(hemisphereLight)

    const keyLight = new THREE.DirectionalLight(0xfff7e8, 1.8)
    keyLight.position.set(10, 18, 12)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(1536, 1536)
    keyLight.shadow.bias = -0.00035
    keyLight.shadow.normalBias = 0.015
    keyLight.shadow.camera.near = 0.5
    keyLight.shadow.camera.far = 60
    keyLight.shadow.camera.left = -18
    keyLight.shadow.camera.right = 18
    keyLight.shadow.camera.top = 18
    keyLight.shadow.camera.bottom = -18
    keyLightRef.current = keyLight
    scene.add(keyLight)

    const fillLight = new THREE.DirectionalLight(0xcfd6e8, 0.56)
    fillLight.position.set(-12, 10, -8)
    scene.add(fillLight)

    const terrainGroup = terrainGroupRef.current
    const terrainBorderGroup = terrainBorderGroupRef.current
    const forestGroup = forestGroupRef.current
    const volleyGroup = volleyGroupRef.current
    const providerBadgeGroup = providerBadgeGroupRef.current
    const formationGroup = formationGroupRef.current
    const proxyGroup = proxyGroupRef.current
    const overlayGroup = overlayGroupRef.current
    scene.add(terrainGroup)
    scene.add(terrainBorderGroup)
    scene.add(forestGroup)
    scene.add(volleyGroup)
    scene.add(formationGroup)
    scene.add(providerBadgeGroup)
    scene.add(proxyGroup)
    scene.add(overlayGroup)

    const resize = () => {
      const nextWidth = container.clientWidth
      const nextHeight = container.clientHeight
      if (nextWidth <= 0 || nextHeight <= 0) {
        return
      }

      camera.aspect = nextWidth / nextHeight
      camera.updateProjectionMatrix()
      renderer.setSize(nextWidth, nextHeight, false)
      markHtmlOverlaysDirty()
    }

    resize()
    const resizeObserver = new ResizeObserver(() => resize())
    resizeObserver.observe(container)

    const handleControlsStart = () => {
      cameraTransitionRef.current = null
      manualCameraOverrideRef.current = true
      cameraInteractionActiveRef.current = true
      cameraInteractionMovedRef.current = false
      cameraInteractionStartPositionRef.current.copy(camera.position)
      cameraInteractionStartTargetRef.current.copy(controls.target)
      markHtmlOverlaysDirty()
    }

    const handleControlsChange = () => {
      markHtmlOverlaysDirty()
      if (cameraInteractionActiveRef.current && !cameraInteractionMovedRef.current) {
        const movedPosition = camera.position.distanceToSquared(cameraInteractionStartPositionRef.current) > 0.0001
        const movedTarget = controls.target.distanceToSquared(cameraInteractionStartTargetRef.current) > 0.0001
        if (movedPosition || movedTarget) {
          cameraInteractionMovedRef.current = true
          updatePointerPreview(null)
        }
      }
    }

    const handleControlsEnd = () => {
      cameraInteractionActiveRef.current = false
      if (cameraInteractionMovedRef.current) {
        suppressClickUntilRef.current = performance.now() + 120
      }
      if (constrainControlsTarget(controls, boardBoundsRef.current)) {
        controls.update()
      }
      updateProjectedCombatAnchor()
      markHtmlOverlaysDirty()
    }

    controls.addEventListener('start', handleControlsStart)
    controls.addEventListener('change', handleControlsChange)
    controls.addEventListener('end', handleControlsEnd)
    renderer.domElement.addEventListener('pointermove', handlePointerMove)
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave)
    renderer.domElement.addEventListener('click', handlePointerClick)
    window.addEventListener('keydown', handleKeyDown)

    clockRef.current.start()
    lastFrameTimeRef.current = 0
    const markScenePresented = () => {
      if (cancelled || isScenePresentedRef.current) {
        return
      }

      pendingPresentationCheckRef.current = false
      visiblePresentationFrameCountRef.current = 0
      skipNextReadyLayoutBuildRef.current = true
      isScenePresentedRef.current = true
      setIsScenePresented(true)
      setLoadStatus('ready')
      setErrorMessage(null)
    }

    renderer.setAnimationLoop(() => {
      const frameTime = performance.now()
      const elapsedTime = clockRef.current.getElapsedTime()
      const deltaTime = Math.max(0, elapsedTime - lastFrameTimeRef.current)
      lastFrameTimeRef.current = elapsedTime
      for (const crowdAnimationState of crowdAnimationStatesRef.current) {
        updateCrowdAnimation(crowdAnimationState, elapsedTime)
      }
      updateDisorderedPulseMaterials(disorderedPulseMaterialStatesRef.current, elapsedTime)

      updateActiveVolley(activeVolleyRef.current, elapsedTime, deltaTime)

      for (const waterMaterialState of waterMaterialStatesRef.current) {
        waterMaterialState.uniforms.time.value = elapsedTime
      }

      const cameraTransitionChanged = updateCameraTransition(frameTime)
      if (controls.update() || cameraTransitionChanged) {
        markHtmlOverlaysDirty()
      }
      const overlayTime = frameTime
      if (htmlOverlaysDirtyRef.current || activeVolleyRef.current || hasAnimatingHtmlOverlay(screenOverlayDescriptorsRef.current, overlayTime)) {
        positionHtmlOverlays(overlayTime)
      }
      renderer.render(scene, camera)

      if (pendingPresentationCheckRef.current) {
        if (canvasShowsPresentedScene(renderer)) {
          visiblePresentationFrameCountRef.current += 1
          if (visiblePresentationFrameCountRef.current >= 2) {
            markScenePresented()
          }
        } else {
          visiblePresentationFrameCountRef.current = 0
        }
      }
    })

    let cancelled = false
    const loadTimeoutIds = new Set<number>()
    const scheduleLoadTimeout = (callback: () => void, delay: number) => {
      const timeoutId = window.setTimeout(() => {
        loadTimeoutIds.delete(timeoutId)
        callback()
      }, delay)
      loadTimeoutIds.add(timeoutId)
      return timeoutId
    }

    async function loadModel() {
      try {
        const loadedResources = await loadBattlefieldSceneResources()

        if (cancelled) {
          disposeBattlefieldSceneResources(loadedResources)
          return
        }

        crowdTemplatesRef.current = loadedResources.crowdTemplates
        terrainTemplateRef.current = loadedResources.terrainTemplate
        terrainMaterialsRef.current = loadedResources.terrainMaterials
        terrainTextureRef.current = loadedResources.terrainTexture
        forestTreeTemplateRef.current = loadedResources.forestTreeTemplate
        selectionIndicatorTemplateRef.current = loadedResources.selectionIndicatorTemplate
        volleyTemplateRef.current = loadedResources.volleyTemplate
        waterAssetsRef.current = loadedResources.waterAssets
        manualCameraOverrideRef.current = false
        lastAutoCameraBoardKeyRef.current = autoCameraBoardKey
        rebuildTerrain(effectiveState)
        rebuildFormation(effectiveState)
        rebuildProviderBadges(effectiveState)
        rebuildVolley(effectiveState, effectivePreviewAction, selectedResolution ?? null)
        rebuildInteractionProxies(effectiveState)
        rebuildTacticalOverlays(effectiveState, effectiveInteraction)
        updateProjectedCombatAnchor()
        applyCameraPreset(cameraPresetRef.current)
        positionHtmlOverlays()

        await yieldToBrowser()

        if (cancelled) {
          return
        }

        pendingPresentationCheckRef.current = true
        visiblePresentationFrameCountRef.current = 0
        scheduleLoadTimeout(() => {
          if (!cancelled && pendingPresentationCheckRef.current && !isScenePresentedRef.current) {
            markScenePresented()
          }
        }, 2200)

        const compilingRenderer = renderer as THREE.WebGLRenderer & {
          compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera) => Promise<void>
        }
        const compileDeadline = new Promise<void>((resolve) => {
          scheduleLoadTimeout(() => resolve(), 1800)
        })

        if (typeof compilingRenderer.compileAsync === 'function') {
          await Promise.race([compilingRenderer.compileAsync(scene, camera), compileDeadline])
        } else {
          renderer.compile(scene, camera)
        }

        if (cancelled) {
          return
        }
      } catch (error) {
        if (cancelled) {
          return
        }

        pendingPresentationCheckRef.current = false
        visiblePresentationFrameCountRef.current = 0
        isScenePresentedRef.current = false
        setIsScenePresented(false)
        setLoadStatus('error')
        setErrorMessage(error instanceof Error ? error.message : 'The FBX asset could not be loaded.')
      }
    }

    void loadModel()

    return () => {
      cancelled = true
      for (const timeoutId of loadTimeoutIds) {
        window.clearTimeout(timeoutId)
      }
      loadTimeoutIds.clear()
      renderer.setAnimationLoop(null)
      resizeObserver.disconnect()
      controls.removeEventListener('start', handleControlsStart)
      controls.removeEventListener('change', handleControlsChange)
      controls.removeEventListener('end', handleControlsEnd)
      renderer.domElement.removeEventListener('pointermove', handlePointerMove)
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)
      renderer.domElement.removeEventListener('click', handlePointerClick)
      window.removeEventListener('keydown', handleKeyDown)
      controls.dispose()
      renderer.dispose()
      disposeFormationScene({
        disorderedPulseMaterialStates: disorderedPulseMaterialStatesRef.current,
        formationGroup,
      })
      disposeTerrainScene({
        forestGroup,
        terrainBorderGroup,
        terrainGroup,
        waterMaterialStates: waterMaterialStatesRef.current,
      })
      disposeVolleyScene({
        activeVolley: activeVolleyRef.current,
        volleyGroup,
      })
      disposeProviderBadgeScene(providerBadgeGroup)
      providerBadgeGroup.clear()
      disposeProviderBadgeTextures(providerBadgeTextureCacheRef.current)
      activeVolleyRef.current = null
      disposeOverlayGroup(proxyGroup)
      proxyGroup.clear()
      disposeOverlayGroup(overlayGroup)
      overlayGroup.clear()
      clearTransientUnitOverlayTimeouts(transientOverlayTimeoutIdsRef.current)
      scene.clear()
      disposeBattlefieldSceneResources({
        crowdTemplates: crowdTemplatesRef.current,
        forestTreeTemplate: forestTreeTemplateRef.current,
        selectionIndicatorTemplate: selectionIndicatorTemplateRef.current,
        terrainMaterials: terrainMaterialsRef.current,
        terrainTemplate: terrainTemplateRef.current,
        terrainTexture: terrainTextureRef.current,
        volleyTemplate: volleyTemplateRef.current,
        waterAssets: waterAssetsRef.current,
      })
      crowdTemplatesRef.current = null
      terrainTemplateRef.current = null
      terrainMaterialsRef.current = null
      terrainTextureRef.current = null
      forestTreeTemplateRef.current = null
      selectionIndicatorTemplateRef.current = null
      volleyTemplateRef.current = null
      waterAssetsRef.current = null
      crowdAnimationStatesRef.current = []
      disorderedPulseMaterialStatesRef.current = []
      lastFrameTimeRef.current = 0
      pendingPresentationCheckRef.current = false
      visiblePresentationFrameCountRef.current = 0
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
      cameraRef.current = null
      controlsRef.current = null
      keyLightRef.current = null
    }
  }, [])

  useEffect(() => {
    loadStatusRef.current = loadStatus
    markHtmlOverlaysDirty()
    if (loadStatus !== 'ready') {
      setIsScenePresented(false)
      isScenePresentedRef.current = false
    }
  }, [loadStatus])

  useEffect(() => {
    isScenePresentedRef.current = isScenePresented
    markHtmlOverlaysDirty()
  }, [isScenePresented])

  useEffect(() => {
    onLoadStateChange?.({
      errorMessage,
      isScenePresented,
      loadStatus,
    })
  }, [errorMessage, isScenePresented, loadStatus, onLoadStateChange])

  useLayoutEffect(() => {
    if (loadStatus !== 'ready') {
      return
    }

    if (skipNextReadyLayoutBuildRef.current) {
      skipNextReadyLayoutBuildRef.current = false
      return
    }

    rebuildTerrain(effectiveState)
    rebuildFormation(effectiveState)
    rebuildProviderBadges(effectiveState)
    rebuildInteractionProxies(effectiveState)
    positionHtmlOverlays()
  }, [effectiveState, loadStatus])

  useLayoutEffect(() => {
    if (loadStatus !== 'ready') {
      return
    }

    rebuildProviderBadges(effectiveState)
  }, [effectiveState, loadStatus, providerLabels])

  useLayoutEffect(() => {
    if (loadStatus !== 'ready') {
      return
    }

    rebuildTacticalOverlays(effectiveState, effectiveInteraction)
    positionHtmlOverlays()
  }, [effectiveInteraction, effectiveState, loadStatus])

  useLayoutEffect(() => {
    if (loadStatus !== 'ready') {
      return
    }

    rebuildVolley(effectiveState, effectivePreviewAction, selectedResolution ?? null)
    updateProjectedCombatAnchor()
  }, [effectivePreviewAction, effectiveState, loadStatus, selectedResolution])

  useEffect(() => {
    if (loadStatus !== 'ready') {
      return
    }

    if (!autoCameraBoardKey || lastAutoCameraBoardKeyRef.current === autoCameraBoardKey) {
      return
    }

    lastAutoCameraBoardKeyRef.current = autoCameraBoardKey
    applyExplicitCameraPreset(initialCameraPreset)
  }, [autoCameraBoardKey, effectiveState, initialCameraPreset, loadStatus])

  const hoverInfo = buildHoverInfo(hoveredTarget, effectiveState)
  const unitHoverTooltip = buildUnitHoverTooltip(hoveredTarget)

  return (
    <div className="battlefield-3d">
      <div className="battlefield-3d__meta">
        <div className="battlefield-3d__header-row" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <p className="battlefield-3d__note" style={{ margin: 0 }}>
            Prototype view: drag to orbit and inspect instanced animated crowd formations for every active unit.
          </p>
          <Battlefield3DToolbar activePreset={cameraPreset} onSelectPreset={applyExplicitCameraPreset} />
        </div>
      </div>
      <div
        ref={containerRef}
        className={[
          'battlefield-3d__viewport',
          loadStatus === 'loading' || (loadStatus === 'ready' && !isScenePresented) ? 'battlefield-3d__viewport--loading' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {loadStatus !== 'ready' || !isScenePresented ? (
          <div
            className={[
              'battlefield-3d__overlay',
              loadStatus === 'loading' || (loadStatus === 'ready' && !isScenePresented) ? 'battlefield-3d__overlay--loading' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {loadStatus === 'loading' || (loadStatus === 'ready' && !isScenePresented) ? (
              <div className="battlefield-3d__loading-panel" aria-label="Preparing 3D preview" role="status">
                <strong className="battlefield-3d__loading-title">Loading 3D battlefield</strong>
                <span className="battlefield-3d__loading-copy">Preparing the scene and unit models.</span>
                <div className="battlefield-3d__loading-shell" aria-hidden="true">
                  <div className="battlefield-3d__loading-bar">
                    <div className="battlefield-3d__loading-bar-fill" />
                  </div>
                </div>
                <span className="battlefield-3d__loading-credit">Work in progress</span>
              </div>
            ) : (
              <>
                <strong>3D preview unavailable</strong>
                <span>{errorMessage ?? 'The preview asset could not be read.'}</span>
              </>
            )}
            </div>
        ) : null}
        {loadStatus === 'ready' && isScenePresented ? (
          <BattlefieldHtmlOverlayLayer
            combatAnchorProjection={combatAnchorProjection}
            hoverInfo={hoverInfo}
            hoverPointerPosition={hoverPointerPosition}
            mapEdgeDescriptors={mapEdgeDescriptors}
            onPreviewActionChange={handlePreviewActionChange}
            onResolveAction={handleResolvedAction}
            overlayDescriptors={overlayDescriptors}
            overlayElementMapRef={overlayElementMapRef}
            overlayLayerRef={overlayLayerRef}
            transientUnitOverlayDescriptors={transientUnitOverlayDescriptors}
            unitHoverTooltip={unitHoverTooltip}
            unitStatusDescriptors={unitStatusDescriptors}
          />
        ) : null}
      </div>
    </div>
  )
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) {
    return false
  }

  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element.isContentEditable
  )
}

type ProviderBadgeProvider = 'openai' | 'anthropic' | 'xai' | 'google' | 'mistral' | 'unknown'

type ProviderBadgeSceneOptions = {
  group: THREE.Group
  providerLabels?: Partial<Record<ArmyId, string>> | null
  state: GameState | null
  terrainSurfaceMap: Map<string, TerrainSurface>
  textureCache: Map<string, THREE.CanvasTexture>
}

const PROVIDER_BADGE_SCENE_TONES: Record<ProviderBadgeProvider, { background: string; border: string; color: string }> = {
  anthropic: { background: '#d9772b', border: '#fff0df', color: '#fff8ef' },
  google: { background: '#2f6fed', border: '#e3ecff', color: '#ffffff' },
  mistral: { background: '#ef8a1f', border: '#ffedd3', color: '#211608' },
  openai: { background: '#111827', border: '#f0f5fa', color: '#f8fafc' },
  unknown: { background: '#4b5563', border: '#f3f4f6', color: '#f9fafb' },
  xai: { background: '#050505', border: '#ffffff', color: '#ffffff' },
}

function rebuildProviderBadgeScene({
  group,
  providerLabels,
  state,
  terrainSurfaceMap,
  textureCache,
}: ProviderBadgeSceneOptions) {
  disposeProviderBadgeScene(group)
  group.clear()

  if (!state || !providerLabels) {
    return
  }

  for (const unit of state.units) {
    if (unit.eliminated || unit.off_map || !unit.deployed) {
      continue
    }

    const fullLabel = providerLabels[unit.army]?.trim()
    if (!fullLabel) {
      continue
    }

    const provider = resolveProviderBadgeProvider(fullLabel)
    const badgeLabel = providerBadgeShortLabel(provider, fullLabel)
    const texture = getProviderBadgeTexture(textureCache, provider, badgeLabel, unit.army)
    const material = new THREE.SpriteMaterial({
      depthTest: false,
      depthWrite: false,
      map: texture,
      transparent: true,
    })
    const sprite = new THREE.Sprite(material)
    const world = resolveUnitOverlayWorldPoint(unit, state, terrainSurfaceMap)
    sprite.position.set(world.x, world.y + 0.72, world.z)
    sprite.renderOrder = 40
    sprite.scale.set(0.68, 0.68, 1)
    sprite.userData = { kind: 'provider_badge', army: unit.army, provider }
    group.add(sprite)
  }
}

function disposeProviderBadgeScene(group: THREE.Group) {
  group.traverse((child) => {
    if (child instanceof THREE.Sprite) {
      child.material.dispose()
    }
  })
}

function disposeProviderBadgeTextures(textureCache: Map<string, THREE.CanvasTexture>) {
  for (const texture of textureCache.values()) {
    texture.dispose()
  }
  textureCache.clear()
}

function getProviderBadgeTexture(
  textureCache: Map<string, THREE.CanvasTexture>,
  provider: ProviderBadgeProvider,
  label: string,
  army: ArmyId,
): THREE.CanvasTexture {
  const key = `${provider}:${label}:${army}`
  const cached = textureCache.get(key)
  if (cached) {
    return cached
  }

  const texture = createProviderBadgeTexture(provider, label, army)
  textureCache.set(key, texture)
  return texture
}

function createProviderBadgeTexture(provider: ProviderBadgeProvider, label: string, army: ArmyId): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Could not create provider badge texture.')
  }

  const tone = PROVIDER_BADGE_SCENE_TONES[provider]
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.save()
  context.shadowColor = 'rgba(0, 0, 0, 0.35)'
  context.shadowBlur = 12
  context.shadowOffsetY = 4
  context.beginPath()
  context.arc(64, 64, 45, 0, Math.PI * 2)
  context.fillStyle = tone.background
  context.fill()
  context.restore()

  context.beginPath()
  context.arc(64, 64, 45, 0, Math.PI * 2)
  context.lineWidth = 9
  context.strokeStyle = tone.border
  context.stroke()

  context.beginPath()
  context.arc(64, 64, 50, Math.PI * 0.12, Math.PI * 0.88)
  context.lineWidth = 7
  context.strokeStyle = army === 'A' ? '#4fcdb9' : '#e58b5e'
  context.stroke()

  context.fillStyle = tone.color
  context.font = provider === 'openai' || provider === 'xai' ? '900 27px Arial' : '900 48px Arial'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(label, 64, 65)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function resolveProviderBadgeProvider(label: string): ProviderBadgeProvider {
  const normalized = label.toLowerCase()
  if (normalized.includes('openai') || normalized.includes('gpt')) {
    return 'openai'
  }
  if (normalized.includes('claude') || normalized.includes('anthropic')) {
    return 'anthropic'
  }
  if (normalized.includes('grok') || normalized.includes('xai') || normalized.includes('x.ai')) {
    return 'xai'
  }
  if (normalized.includes('gemini') || normalized.includes('google')) {
    return 'google'
  }
  if (normalized.includes('mistral')) {
    return 'mistral'
  }
  return 'unknown'
}

function providerBadgeShortLabel(provider: ProviderBadgeProvider, fullLabel: string): string {
  if (provider === 'openai') {
    return 'GPT'
  }
  if (provider === 'anthropic') {
    return 'C'
  }
  if (provider === 'xai') {
    return 'xAI'
  }
  if (provider === 'google') {
    return 'G'
  }
  if (provider === 'mistral') {
    return 'M'
  }
  return fullLabel.trim().slice(0, 2).toUpperCase()
}

export default Battlefield3D
