import type { BattlefieldInteractionModel } from '../battlefieldInteraction'
import {
  describeArmyMorale,
  describeBattleTarget,
  formatArmyDisplayName,
  formatFormationState,
  formatPipCost,
  formatPursuitClass,
  formatUnitClass,
  formatUnitDisplayLabelForUnit,
  formatUnitName,
  formatUnitQuality,
  materializeAction,
  unitStatusLabels,
} from '../battlefieldShared'
import type { AiLiveDecision, AiTurnRecord } from '../aiSession'
import type {
  Action,
  ArmyId,
  DeployActionOption,
  DeploymentZone,
  GameState,
  LegalAction,
  RallyActionOption,
  ReformPikeActionOption,
  Unit,
} from '../types'

type RecoveryActionOption = RallyActionOption | ReformPikeActionOption

type DeploymentDockProps = {
  currentPlayer: ArmyId
  deployedDeploymentUnits: Unit[]
  deploymentActionsByUnit: Map<string, DeployActionOption[]>
  deploymentProgressPercent: number
  deploymentUnits: Unit[]
  deploymentZonesForCurrent: DeploymentZone[]
  gameFinished: boolean
  isAutoDeploying: boolean
  onAutoDeploy: () => void
  onSelectDeploymentUnit: (unitId: string) => void
  reserveDeploymentUnits: Unit[]
  selectedDeploymentActions: DeployActionOption[]
  selectedDeploymentUnit: Unit | null
  uiLocked: boolean
}

type BattlefieldHudMenusProps = {
  armyMorale: GameState['armies']
  interaction: BattlefieldInteractionModel
  onPreviewAction: (action: LegalAction | null) => void
  onResolveAction: (action: Action) => void
  selectedRecoveryActions: RecoveryActionOption[]
  selectedUnit: Unit | null
  selectedWarnings: string[]
  state: GameState | null
  uiLocked: boolean
}

type CommanderChatPanelProps = {
  aiStatus: string | null
  aiTurnHistory: AiTurnRecord[]
  currentPlayer: ArmyId | null
  isAiThinking: boolean
  lastAiTurn: AiTurnRecord | null
  liveAiDecision: AiLiveDecision | null
}

export function DeploymentDock({
  currentPlayer,
  deployedDeploymentUnits,
  deploymentActionsByUnit,
  deploymentProgressPercent,
  deploymentUnits,
  deploymentZonesForCurrent,
  gameFinished,
  isAutoDeploying,
  onAutoDeploy,
  onSelectDeploymentUnit,
  reserveDeploymentUnits,
  selectedDeploymentActions,
  selectedDeploymentUnit,
  uiLocked,
}: DeploymentDockProps) {
  return (
    <aside className="deployment-dock" aria-label="Deployment roster">
      <div className="deployment-dock__header">
        <div>
          <p className="viewer-mode-menu__eyebrow">Deployment</p>
          <h2>{formatArmyDisplayName(currentPlayer)}</h2>
        </div>
        <span className="deployment-dock__counter">
          {deployedDeploymentUnits.length}/{deploymentUnits.length}
        </span>
      </div>

      <div className="deployment-progress" aria-label={`Deployment progress ${deploymentProgressPercent}%`}>
        <span style={{ width: `${deploymentProgressPercent}%` }} />
      </div>

      <div className="deployment-dock__meta" aria-label="Deployment status">
        <span>{reserveDeploymentUnits.length} reserve</span>
        <span>{deployedDeploymentUnits.length} placed</span>
        <span>{selectedDeploymentActions.length} cells</span>
      </div>

      <button
        type="button"
        className="button button--secondary deployment-dock__auto-button"
        disabled={uiLocked || gameFinished || !reserveDeploymentUnits.length}
        onClick={onAutoDeploy}
      >
        {isAutoDeploying ? 'Deploying...' : 'Deploy Automatically'}
      </button>

      {deploymentZonesForCurrent.length ? (
        <div className="deployment-dock__zones" aria-label="Deployment zones">
          {deploymentZonesForCurrent.map((zone) => (
            <span key={`${zone.army}-${zone.min_x}-${zone.max_x}-${zone.min_y}-${zone.max_y}`}>{formatDeploymentZone(zone)}</span>
          ))}
        </div>
      ) : null}

      <div className="deployment-roster" role="list" aria-label="Units to deploy">
        {reserveDeploymentUnits.length ? (
          reserveDeploymentUnits.map((unit) => {
            const unitActions = deploymentActionsByUnit.get(unit.id) ?? []
            const isSelectedDeploymentUnit = selectedDeploymentUnit?.id === unit.id

            return (
              <button
                key={`deploy-roster-${unit.id}`}
                type="button"
                className={[
                  'deployment-unit',
                  'deployment-unit--reserve',
                  isSelectedDeploymentUnit ? 'deployment-unit--selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={uiLocked || gameFinished}
                onClick={() => onSelectDeploymentUnit(unit.id)}
              >
                <span className="deployment-unit__main">
                  <strong>{formatUnitName(unit)}</strong>
                  <span>{formatUnitDisplayLabelForUnit(unit)}</span>
                </span>
                <span className="deployment-unit__tags" aria-label={`Reserve, loss value ${unit.morale_value}`}>
                  <span>Reserve</span>
                  <span>{formatUnitQuality(unit.quality)}</span>
                  <span>Loss {unit.morale_value}</span>
                  <span>{unitActions.length}</span>
                </span>
              </button>
            )
          })
        ) : (
          <p className="deployment-roster__empty">All units placed.</p>
        )}
      </div>

      {selectedDeploymentUnit ? (
        <div className="deployment-selection" aria-live="polite">
          <p className="viewer-mode-menu__eyebrow">Selected</p>
          <p className="deployment-selection__name">
            <strong>{formatUnitName(selectedDeploymentUnit)}</strong>
            <span>{selectedDeploymentUnit.deployed ? 'Placed' : 'Reserve'}</span>
          </p>
          <div className="selection-status-chips">
            <span>{formatUnitClass(selectedDeploymentUnit.unit_class)}</span>
            <span>{formatFormationState(selectedDeploymentUnit.formation_state)}</span>
            <span>{selectedDeploymentActions.length} legal cells</span>
          </div>
        </div>
      ) : null}
    </aside>
  )
}

export function BattlefieldHudMenus({
  armyMorale,
  interaction,
  onPreviewAction,
  onResolveAction,
  selectedRecoveryActions,
  selectedUnit,
  selectedWarnings,
  state,
  uiLocked,
}: BattlefieldHudMenusProps) {
  if (!state) {
    return <div className="battlefield-stage__hud-menus" />
  }

  const uniqueWarnings = [...new Set(selectedWarnings)]

  return (
    <div className="battlefield-stage__hud-menus">
      <details className="viewer-mode-menu">
        <summary className="viewer-mode-toggle__button viewer-mode-toggle__button--menu" aria-label="Victory conditions">
          <span className="viewer-mode-toggle__hamburger" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>Victory</span>
        </summary>
        <div className="viewer-mode-menu__panel">
          <section className="viewer-mode-menu__section">
            <p className="viewer-mode-menu__eyebrow">Break Threshold</p>
            <p className="viewer-mode-menu__copy">
              Destroyed units add their loss value to army morale loss. Armies become shaken at their threshold, then
              broken if still at or above it after a later bound. Thresholds:{' '}
              <strong>{describeBattleTarget(state)}</strong>. If an army has no surviving units, it loses immediately.{' '}
              {state.endgame_deadline_bound !== null
                ? `Endgame clock active: if no one wins sooner, the battle is decided after bound ${state.endgame_deadline_bound}.`
                : 'The endgame clock is not active for this battle.'}
            </p>
          </section>

          <section className="viewer-mode-menu__section">
            <p className="viewer-mode-menu__eyebrow">Army Morale Loss</p>
            <ul className="viewer-mode-menu__list">
              {armyMorale.map((army) => (
                <li key={`morale-${army.id}`}>{describeArmyMorale(army)}</li>
              ))}
            </ul>
          </section>

          {state.winner_reason ? (
            <section className="viewer-mode-menu__section">
              <p className="viewer-mode-menu__eyebrow">Current Result</p>
              <p className="viewer-mode-menu__copy">{state.winner_reason}</p>
            </section>
          ) : null}
        </div>
      </details>

      <details className="viewer-mode-menu">
        <summary className="viewer-mode-toggle__button viewer-mode-toggle__button--menu" aria-label="Selected unit">
          <span className="viewer-mode-toggle__hamburger" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>Selection</span>
        </summary>
        <div className="viewer-mode-menu__panel">
          {selectedUnit ? (
            <>
              <section className="viewer-mode-menu__section">
                <p className="viewer-mode-menu__eyebrow">Selected Unit</p>
                <p className="viewer-mode-menu__copy">
                  <strong>{formatUnitName(selectedUnit)}</strong> / {formatUnitDisplayLabelForUnit(selectedUnit)}
                </p>
                <ul className="selection-metric-list">
                  <li>
                    <span>Quality</span>
                    <strong>{formatUnitQuality(selectedUnit.quality)}</strong>
                  </li>
                  <li>
                    <span>Class</span>
                    <strong>{formatUnitClass(selectedUnit.unit_class)}</strong>
                  </li>
                  <li>
                    <span>Formation</span>
                    <strong>{formatFormationState(selectedUnit.formation_state)}</strong>
                  </li>
                  <li>
                    <span>Pursuit</span>
                    <strong>{formatPursuitClass(selectedUnit.pursuit_class)}</strong>
                  </li>
                  <li>
                    <span>Loss Value</span>
                    <strong>{selectedUnit.morale_value}</strong>
                  </li>
                </ul>
                {unitStatusLabels(selectedUnit).length ? (
                  <div className="selection-status-chips">
                    {unitStatusLabels(selectedUnit).map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>
                ) : null}
              </section>

              {selectedRecoveryActions.length ? (
                <section className="viewer-mode-menu__section">
                  <p className="viewer-mode-menu__eyebrow">Recovery Orders</p>
                  <div className="selection-action-buttons">
                    {selectedRecoveryActions.map((action) => (
                      <button
                        key={`${action.type}-${action.unit_id}`}
                        className="action-button"
                        disabled={uiLocked}
                        onMouseEnter={() => onPreviewAction(action)}
                        onMouseLeave={() => onPreviewAction(null)}
                        onClick={() => onResolveAction(materializeAction(action))}
                      >
                        <strong>{action.type === 'reform_pike' ? 'Reform Pike' : 'Rally'}</strong>
                        <span>{formatPipCost(action.pip_cost)}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {uniqueWarnings.length ? (
                <section className="viewer-mode-menu__section">
                  <p className="viewer-mode-menu__eyebrow">Warnings</p>
                  <ul className="viewer-mode-menu__list">
                    {uniqueWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          ) : interaction.selectedGroupUnits.length > 1 ? (
            <section className="viewer-mode-menu__section">
              <p className="viewer-mode-menu__eyebrow">Selected Group</p>
              <p className="viewer-mode-menu__copy">
                <strong>{interaction.selectedGroupUnits.length}</strong> units selected.
              </p>
              {uniqueWarnings.length ? (
                <ul className="viewer-mode-menu__list">
                  {uniqueWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : (
            <section className="viewer-mode-menu__section">
              <p className="viewer-mode-menu__copy">No active unit selected.</p>
            </section>
          )}
        </div>
      </details>
    </div>
  )
}

export function CommanderChatPanel({
  aiStatus,
  aiTurnHistory,
  currentPlayer,
  isAiThinking,
  lastAiTurn,
  liveAiDecision,
}: CommanderChatPanelProps) {
  const recentAiMessages = aiTurnHistory
    .filter((turn) => turn.messageId !== liveAiDecision?.messageId)
    .slice(-8)
    .reverse()

  return (
    <aside className="battlefield-ai-chat" aria-label="Commander reasoning">
      <div className="battlefield-ai-chat__header">
        <div>
          <p className="battlefield-ai-chat__eyebrow">Commander Chat</p>
          <h3 className="battlefield-ai-chat__title">AI reasoning</h3>
        </div>
        {lastAiTurn ? <span className="battlefield-ai-chat__summary">{aiTurnHistory.length} turns</span> : null}
      </div>
      <div className="battlefield-ai-chat__messages" aria-live="polite">
        {isAiThinking && currentPlayer ? (
          <article className="battlefield-ai-chat__message battlefield-ai-chat__message--pending" data-army={currentPlayer}>
            <div className="battlefield-ai-chat__message-meta">
              <span className="battlefield-ai-chat__speaker">{formatArmyDisplayName(currentPlayer)}</span>
              <span className="battlefield-ai-chat__action battlefield-ai-chat__action--pending">
                <span className="battlefield-ai-chat__spinner" aria-hidden="true" />
                <span>thinking</span>
              </span>
            </div>
            <p className="battlefield-ai-chat__reasoning">Evaluating the board and weighing the legal actions.</p>
            <p className="battlefield-ai-chat__foot">{aiStatus ?? 'Awaiting the next commander message.'}</p>
          </article>
        ) : null}
        {liveAiDecision ? (
          <article
            key={liveAiDecision.messageId}
            className="battlefield-ai-chat__message battlefield-ai-chat__message--live"
            data-army={liveAiDecision.actingArmy}
          >
            <div className="battlefield-ai-chat__message-meta">
              <span className="battlefield-ai-chat__speaker">{formatArmyDisplayName(liveAiDecision.actingArmy)}</span>
              <span className="battlefield-ai-chat__action">{liveAiDecision.actionSummary}</span>
            </div>
            {liveAiDecision.intent_update ? (
              <p className="battlefield-ai-chat__intent">Intent: {liveAiDecision.intent_update}</p>
            ) : null}
            <p className="battlefield-ai-chat__reasoning">{liveAiDecision.reasoning}</p>
            <p className="battlefield-ai-chat__foot">
              {liveAiDecision.model} | {Math.round(liveAiDecision.confidence * 100)}% confidence | resolving
            </p>
          </article>
        ) : null}
        {recentAiMessages.length ? (
          recentAiMessages.map((turn) => (
            <article key={turn.messageId} className="battlefield-ai-chat__message" data-army={turn.actingArmy}>
              <div className="battlefield-ai-chat__message-meta">
                <span className="battlefield-ai-chat__speaker">{formatArmyDisplayName(turn.actingArmy)}</span>
                <span className="battlefield-ai-chat__action">{turn.applied_action_summary}</span>
              </div>
              {turn.intent_update ? <p className="battlefield-ai-chat__intent">Intent: {turn.intent_update}</p> : null}
              <p className="battlefield-ai-chat__reasoning">{turn.reasoning}</p>
              <p className="battlefield-ai-chat__foot">
                {turn.model} | {Math.round(turn.confidence * 100)}% confidence
              </p>
            </article>
          ))
        ) : !isAiThinking && !liveAiDecision ? (
          <p className="battlefield-ai-chat__empty">No commander messages yet.</p>
        ) : null}
      </div>
    </aside>
  )
}

function formatDeploymentZone(zone: DeploymentZone): string {
  return `x ${zone.min_x}-${zone.max_x}, y ${zone.min_y}-${zone.max_y}`
}
