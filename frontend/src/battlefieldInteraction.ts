import type {
  Action,
  ChargeActionOption,
  Coord,
  DeployActionOption,
  GameState,
  GroupChargeActionOption,
  GroupMarchMoveActionOption,
  GroupMoveActionOption,
  LegalAction,
  MarchMoveActionOption,
  MoveActionOption,
  RallyActionOption,
  ReformPikeActionOption,
  RotateActionOption,
  ShootActionOption,
  TerrainType,
  Unit,
} from './types'
import {
  footprintKeys,
  isChargeAction,
  isDeployAction,
  isGroupChargeAction,
  isGroupMarchAction,
  isGroupMoveAction,
  isMarchAction,
  isMoveAction,
  isRallyAction,
  isReformPikeAction,
  isRotateAction,
  isShootAction,
  keyForCoord,
  materializeAction,
  sameUnitSet,
  type GroupActionAnchor,
  type GroupActionOption,
} from './battlefieldShared'

export type BattlefieldOverlayDescriptor =
  | { kind: 'rotate'; coord: Coord; action: RotateActionOption }
  | { kind: 'group'; coord: Coord; actions: GroupActionAnchor[] }
  | { kind: 'shoot'; coord: Coord; action: ShootActionOption; target: Unit }

export type BattlefieldPickTarget =
  | { kind: 'cell'; coord: Coord; key: string }
  | { kind: 'unit'; coord: Coord; key: string; unit: Unit }

export type BattlefieldInteractionModel = {
  boardCells: Coord[]
  boardHeight: number
  boardWidth: number
  chargeTargetFootprints: Set<string>
  chargeTargets: Map<string, ChargeActionOption>
  chargeTargetsByEnemyId: Map<string, ChargeActionOption[]>
  deployTargetFootprints: Set<string>
  deployTargets: Map<string, DeployActionOption>
  groupActionAnchors: Map<string, GroupActionAnchor[]>
  groupAnchorUnitId: string | null
  groupChargeTargetFootprints: Set<string>
  groupTargetFootprints: Set<string>
  legalActions: LegalAction[]
  marchTargetFootprints: Set<string>
  marchTargets: Map<string, MarchMoveActionOption>
  moveTargetFootprints: Set<string>
  moveTargets: Map<string, MoveActionOption>
  previewAction: LegalAction | null
  previewDestinationKeys: Set<string>
  previewPathKeys: Set<string>
  previewTargetKeys: Set<string>
  selectedCharges: ChargeActionOption[]
  selectedDeployments: DeployActionOption[]
  selectedGroupActionOptions: GroupActionOption[]
  selectedGroupCharges: GroupChargeActionOption[]
  selectedGroupMarches: GroupMarchMoveActionOption[]
  selectedGroupUnits: Unit[]
  selectedGroups: GroupMoveActionOption[]
  selectedMarches: MarchMoveActionOption[]
  selectedMoves: MoveActionOption[]
  selectedRallies: RallyActionOption[]
  selectedReforms: ReformPikeActionOption[]
  selectedRotations: RotateActionOption[]
  selectedShotTargets: Array<{ action: ShootActionOption; target: Unit }>
  selectedShots: ShootActionOption[]
  selectedUnit: Unit | null
  selectedUnitIdSet: Set<string>
  selectedUnitIds: string[]
  selectedUnits: Unit[]
  shotTargetsByUnitId: Map<string, ShootActionOption>
  state: GameState | null
  terrainByCell: Map<string, TerrainType>
  unitsByCell: Map<string, Unit>
}

export type BattlefieldClickResult =
  | { type: 'dispatch'; action: Action }
  | { type: 'selection'; selectedUnitIds: string[] }
  | { type: 'none' }

type BuildBattlefieldInteractionModelParams = {
  legalActions: LegalAction[]
  previewAction: LegalAction | null
  selectedUnitIds: string[]
  state: GameState | null
}

export function buildBattlefieldInteractionModel({
  state,
  legalActions,
  selectedUnitIds,
  previewAction,
}: BuildBattlefieldInteractionModelParams): BattlefieldInteractionModel {
  const isSelectableUnit = (unit: Unit) => !unit.eliminated && !unit.off_map && (state?.phase !== 'battle' || unit.deployed)
  const occupiesBoard = (unit: Unit) => isSelectableUnit(unit) && unit.deployed
  const deployActions = legalActions.filter(isDeployAction)
  const chargeActions = legalActions.filter(isChargeAction)
  const marchActions = legalActions.filter(isMarchAction)
  const moveActions = legalActions.filter(isMoveAction)
  const groupChargeActions = legalActions.filter(isGroupChargeAction)
  const groupMarchActions = legalActions.filter(isGroupMarchAction)
  const groupActions = legalActions.filter(isGroupMoveAction)
  const rotateActions = legalActions.filter(isRotateAction)
  const shootActions = legalActions.filter(isShootAction)
  const rallyActions = legalActions.filter(isRallyAction)
  const reformActions = legalActions.filter(isReformPikeAction)

  const selectedUnits =
    state === null
      ? []
      : selectedUnitIds
          .map((unitId) => state.units.find((unit) => unit.id === unitId && isSelectableUnit(unit)) ?? null)
          .filter((unit): unit is Unit => unit !== null)
  const selectedUnitIdSet = new Set(selectedUnits.map((unit) => unit.id))
  const selectedUnit = selectedUnits.length === 1 ? selectedUnits[0] : null
  const selectedGroupUnits = selectedUnits.length > 1 ? selectedUnits : []
  const groupAnchorUnitId = selectedGroupUnits[0]?.id ?? null
  const selectedDeployments = selectedUnit
    ? deployActions.filter((action) => action.unit_id === selectedUnit.id)
    : []
  const selectedCharges = selectedUnit
    ? chargeActions.filter((action) => action.unit_id === selectedUnit.id)
    : []
  const selectedMarches = selectedUnit
    ? marchActions.filter((action) => action.unit_id === selectedUnit.id)
    : []
  const selectedMoves = selectedUnit ? moveActions.filter((action) => action.unit_id === selectedUnit.id) : []
  const selectedRotations = selectedUnit
    ? rotateActions.filter((action) => action.unit_id === selectedUnit.id)
    : []
  const selectedShots = selectedUnit ? shootActions.filter((action) => action.unit_id === selectedUnit.id) : []
  const selectedRallies = selectedUnit ? rallyActions.filter((action) => action.unit_id === selectedUnit.id) : []
  const selectedReforms = selectedUnit ? reformActions.filter((action) => action.unit_id === selectedUnit.id) : []
  const selectedShotTargets =
    state === null
      ? []
      : selectedShots
          .map((action) => {
            const target = state.units.find((unit) => unit.id === action.target_id && isSelectableUnit(unit)) ?? null
            return target ? { action, target } : null
          })
          .filter((entry): entry is { action: ShootActionOption; target: Unit } => entry !== null)
  const selectedGroupCharges =
    selectedGroupUnits.length > 1
      ? groupChargeActions.filter((action) => sameUnitSet(action.unit_ids, selectedGroupUnits.map((unit) => unit.id)))
      : []
  const selectedGroupMarches =
    selectedGroupUnits.length > 1
      ? groupMarchActions.filter((action) => sameUnitSet(action.unit_ids, selectedGroupUnits.map((unit) => unit.id)))
      : []
  const selectedGroups =
    selectedGroupUnits.length > 1
      ? groupActions.filter((action) => sameUnitSet(action.unit_ids, selectedGroupUnits.map((unit) => unit.id)))
      : []
  const selectedGroupActionOptions: GroupActionOption[] = [
    ...selectedGroupCharges,
    ...selectedGroupMarches,
    ...selectedGroups,
  ]

  const unitsByCell = new Map<string, Unit>()
  for (const unit of state?.units ?? []) {
    if (occupiesBoard(unit)) {
      for (const key of footprintKeys(unit.position, unit.facing)) {
        unitsByCell.set(key, unit)
      }
    }
  }

  const terrainByCell = new Map<string, TerrainType>()
  for (const tile of state?.terrain ?? []) {
    terrainByCell.set(keyForCoord(tile.position), tile.terrain)
  }

  const moveTargets = new Map<string, MoveActionOption>()
  const moveTargetFootprints = new Set<string>()
  for (const action of selectedMoves) {
    for (const key of footprintKeys(action.destination, action.facing)) {
      moveTargets.set(key, action)
      moveTargetFootprints.add(key)
    }
  }

  const marchTargets = new Map<string, MarchMoveActionOption>()
  const marchTargetFootprints = new Set<string>()
  for (const action of selectedMarches) {
    for (const key of footprintKeys(action.destination, action.facing)) {
      marchTargets.set(key, action)
      marchTargetFootprints.add(key)
    }
  }

  const chargeTargets = new Map<string, ChargeActionOption>()
  const chargeTargetFootprints = new Set<string>()
  for (const action of selectedCharges) {
    const chargingUnit =
      state?.units.find((unit) => unit.id === action.unit_id && isSelectableUnit(unit)) ?? selectedUnit
    for (const key of footprintKeys(action.destination, chargingUnit?.facing ?? 'N')) {
      chargeTargets.set(key, action)
      chargeTargetFootprints.add(key)
    }
  }

  const deployTargets = new Map<string, DeployActionOption>()
  const deployTargetFootprints = new Set<string>()
  for (const action of selectedDeployments) {
    const deployingUnit =
      state?.units.find((unit) => unit.id === action.unit_id && isSelectableUnit(unit)) ?? selectedUnit
    for (const key of footprintKeys(action.destination, deployingUnit?.facing ?? 'N')) {
      deployTargets.set(key, action)
      deployTargetFootprints.add(key)
    }
  }

  const shotTargetsByUnitId = new Map<string, ShootActionOption>()
  for (const action of selectedShots) {
    shotTargetsByUnitId.set(action.target_id, action)
  }

  const chargeTargetsByEnemyId = new Map<string, ChargeActionOption[]>()
  for (const action of selectedCharges) {
    const options = chargeTargetsByEnemyId.get(action.target_id) ?? []
    options.push(action)
    chargeTargetsByEnemyId.set(action.target_id, options)
  }

  const groupActionAnchors = new Map<string, GroupActionAnchor[]>()
  const groupTargetFootprints = new Set<string>()
  const groupChargeTargetFootprints = new Set<string>()
  for (const action of selectedGroupActionOptions) {
    const selectedStep = groupAnchorUnitId ? action.steps.find((step) => step.unit_id === groupAnchorUnitId) ?? null : null
    if (!selectedStep) {
      continue
    }

    const variant = action.type === 'group_charge' ? 'charge' : action.type === 'group_march_move' ? 'march' : 'move'
    for (const key of footprintKeys(selectedStep.destination, selectedStep.facing)) {
      const anchors = groupActionAnchors.get(key) ?? []
      anchors.push({ action, step: selectedStep, variant })
      groupActionAnchors.set(key, anchors)
      groupTargetFootprints.add(key)
      if (variant === 'charge') {
        groupChargeTargetFootprints.add(key)
      }
    }
  }

  const previewPathKeys = new Set<string>()
  const previewDestinationKeys = new Set<string>()
  const previewTargetKeys = new Set<string>()
  if (previewAction) {
    if (previewAction.type === 'move' || previewAction.type === 'march_move' || previewAction.type === 'charge') {
      previewAction.path.forEach((coord) => previewPathKeys.add(keyForCoord(coord)))
      footprintKeys(previewAction.destination, previewAction.facing).forEach((key) => previewDestinationKeys.add(key))
      if (previewAction.type === 'charge') {
        const target = state?.units.find((unit) => unit.id === previewAction.target_id && isSelectableUnit(unit)) ?? null
        if (target) {
          footprintKeys(target.position, target.facing).forEach((key) => previewTargetKeys.add(key))
        }
      }
    } else if (previewAction.type === 'group_move' || previewAction.type === 'group_march_move') {
      previewAction.steps.forEach((step) => {
        step.path.forEach((coord) => previewPathKeys.add(keyForCoord(coord)))
        footprintKeys(step.destination, step.facing).forEach((key) => previewDestinationKeys.add(key))
      })
    } else if (previewAction.type === 'group_charge') {
      previewAction.steps.forEach((step) => {
        step.path.forEach((coord) => previewPathKeys.add(keyForCoord(coord)))
        footprintKeys(step.destination, step.facing).forEach((key) => previewDestinationKeys.add(key))
        const target = state?.units.find((unit) => unit.id === step.target_id && isSelectableUnit(unit)) ?? null
        if (target) {
          footprintKeys(target.position, target.facing).forEach((key) => previewTargetKeys.add(key))
        }
      })
    } else if (previewAction.type === 'deploy') {
      const previewUnit = state?.units.find((unit) => unit.id === previewAction.unit_id && isSelectableUnit(unit)) ?? null
      footprintKeys(previewAction.destination, previewUnit?.facing ?? 'N').forEach((key) => previewDestinationKeys.add(key))
    } else if (previewAction.type === 'shoot') {
      const target = state?.units.find((unit) => unit.id === previewAction.target_id && isSelectableUnit(unit)) ?? null
      if (target) {
        footprintKeys(target.position, target.facing).forEach((key) => previewTargetKeys.add(key))
      }
    }
  }

  const boardWidth = state?.board_width ?? 0
  const boardHeight = state?.board_height ?? 0
  const boardCells = Array.from({ length: boardWidth * boardHeight }, (_, index) => {
    const x = index % boardWidth
    const y = Math.floor(index / boardWidth)
    return { x, y }
  })

  return {
    boardCells,
    boardHeight,
    boardWidth,
    chargeTargetFootprints,
    chargeTargets,
    chargeTargetsByEnemyId,
    deployTargetFootprints,
    deployTargets,
    groupActionAnchors,
    groupAnchorUnitId,
    groupChargeTargetFootprints,
    groupTargetFootprints,
    legalActions,
    marchTargetFootprints,
    marchTargets,
    moveTargetFootprints,
    moveTargets,
    previewAction,
    previewDestinationKeys,
    previewPathKeys,
    previewTargetKeys,
    selectedCharges,
    selectedDeployments,
    selectedGroupActionOptions,
    selectedGroupCharges,
    selectedGroupMarches,
    selectedGroupUnits,
    selectedGroups,
    selectedMarches,
    selectedMoves,
    selectedRallies,
    selectedReforms,
    selectedRotations,
    selectedShotTargets,
    selectedShots,
    selectedUnit,
    selectedUnitIdSet,
    selectedUnitIds,
    selectedUnits,
    shotTargetsByUnitId,
    state,
    terrainByCell,
    unitsByCell,
  }
}

export function buildBattlefieldPickTargets(model: BattlefieldInteractionModel): BattlefieldPickTarget[] {
  const targets: BattlefieldPickTarget[] = []
  for (const coord of model.boardCells) {
    const key = keyForCoord(coord)
    const unit = model.unitsByCell.get(key) ?? null
    if (unit) {
      targets.push({ kind: 'unit', coord, key, unit })
      continue
    }
    targets.push({ kind: 'cell', coord, key })
  }
  return targets
}

export function resolvePreviewActionAtCoord(model: BattlefieldInteractionModel, coord: Coord): LegalAction | null {
  if (!model.state) {
    return null
  }

  const key = keyForCoord(coord)
  const unit = model.unitsByCell.get(key) ?? null
  if (unit && model.selectedUnit && unit.army !== model.state.current_player) {
    const chargeOptions = model.chargeTargetsByEnemyId.get(unit.id) ?? []
    if (chargeOptions.length === 1) {
      return chargeOptions[0]
    }
    const shotAction = model.shotTargetsByUnitId.get(unit.id)
    if (shotAction) {
      return shotAction
    }
  }

  const deployAction = model.deployTargets.get(key)
  if (deployAction) {
    return deployAction
  }

  const chargeAction = model.chargeTargets.get(key)
  if (chargeAction) {
    return chargeAction
  }

  const marchAction = model.marchTargets.get(key)
  if (marchAction) {
    return marchAction
  }

  const groupActions = model.groupActionAnchors.get(key) ?? []
  if (groupActions.length === 1) {
    return groupActions[0].action
  }

  return model.moveTargets.get(key) ?? null
}

export function toggleUnitSelection(
  state: GameState | null,
  currentSelectedUnitIds: string[],
  unit: Unit,
  additiveSelection = false,
): string[] {
  if (!state || unit.eliminated || unit.off_map || !unit.deployed) {
    return currentSelectedUnitIds
  }
  if (unit.army !== state.current_player) {
    return []
  }
  if (state.phase !== 'battle' || !additiveSelection) {
    return currentSelectedUnitIds.length === 1 && currentSelectedUnitIds[0] === unit.id ? [] : [unit.id]
  }
  if (currentSelectedUnitIds.includes(unit.id)) {
    return currentSelectedUnitIds.filter((currentUnitId) => currentUnitId !== unit.id)
  }
  return [...currentSelectedUnitIds, unit.id]
}

export function resolveCellClick(
  model: BattlefieldInteractionModel,
  coord: Coord,
  currentSelectedUnitIds: string[],
  additiveSelection = false,
): BattlefieldClickResult {
  if (!model.state || model.state.winner || model.state.draw) {
    return { type: 'none' }
  }

  const key = keyForCoord(coord)
  const unit = model.unitsByCell.get(key)
  if (unit) {
    if (model.selectedUnit && unit.army !== model.state.current_player) {
      const chargeOptions = model.chargeTargetsByEnemyId.get(unit.id) ?? []
      if (chargeOptions.length === 1) {
        return {
          type: 'dispatch',
          action: materializeAction(chargeOptions[0]),
        }
      }

      const shotAction = model.shotTargetsByUnitId.get(unit.id)
      if (shotAction) {
        return {
          type: 'dispatch',
          action: materializeAction(shotAction),
        }
      }
    }

    return {
      type: 'selection',
      selectedUnitIds: toggleUnitSelection(model.state, currentSelectedUnitIds, unit, additiveSelection),
    }
  }

  const deployAction = model.deployTargets.get(key)
  if (deployAction) {
    return { type: 'dispatch', action: materializeAction(deployAction) }
  }

  const chargeAction = model.chargeTargets.get(key)
  if (chargeAction) {
    return { type: 'dispatch', action: materializeAction(chargeAction) }
  }

  const marchAction = model.marchTargets.get(key)
  if (marchAction) {
    return { type: 'dispatch', action: materializeAction(marchAction) }
  }

  const groupActions = model.groupActionAnchors.get(key) ?? []
  if (groupActions.length === 1) {
    return { type: 'dispatch', action: materializeAction(groupActions[0].action) }
  }
  if (groupActions.length > 1) {
    return { type: 'none' }
  }

  const moveAction = model.moveTargets.get(key) ?? null
  if (moveAction) {
    return { type: 'dispatch', action: materializeAction(moveAction) }
  }

  return { type: 'selection', selectedUnitIds: [] }
}
