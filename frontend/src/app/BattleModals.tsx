import { describeAiController, describeBattleScores, describeBattleTarget, formatArmyDisplayName, type AiController } from '../battlefieldShared'
import type { AiTurnUsageTotals } from '../aiSession'
import type { GameState } from '../types'

type DeploymentIntroModalProps = {
  aiController: AiController
  onClose: () => void
  state: GameState
  summary: string
  title: string
}

type TurnIntroModalProps = {
  aiController: AiController
  onClose: () => void
  state: GameState
  summary: string
  title: string
}

type WinnerModalProps = {
  aiController: AiController
  aiUsageCostCounter: string
  aiUsageSummary: AiTurnUsageTotals
  aiUsageTokenCounter: string
  onClose: () => void
  onPlayAgain: () => void
  resultLabel: string | null
  state: GameState
  summary: string
  title: string
}

export function DeploymentIntroModal({ aiController, onClose, state, summary, title }: DeploymentIntroModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="resolution-modal deployment-modal" onClick={(event) => event.stopPropagation()}>
        <div className="resolution-modal__header">
          <div>
            <p className="eyebrow">Deployment Phase</p>
            <h2 className="resolution-modal__title">{title}</h2>
            <p className="card__headline deployment-modal__copy">{summary}</p>
          </div>
          <div className="replay-card__actions">
            <button className="button" onClick={onClose}>
              Begin Deployment
            </button>
          </div>
        </div>
        <div className="resolution-modal__meta">
          <div className="stat">
            <span>Scenario</span>
            <strong>{state.scenario_name}</strong>
          </div>
          <div className="stat">
            <span>Active Side</span>
            <strong>{formatArmyDisplayName(state.current_player)}</strong>
          </div>
          <div className="stat">
            <span>Ready</span>
            <strong>{state.deployment_ready.map(formatArmyDisplayName).join(', ') || 'none'}</strong>
          </div>
          <div className="stat">
            <span>Mode</span>
            <strong>{describeAiController(aiController)}</strong>
          </div>
        </div>
      </div>
    </div>
  )
}

export function TurnIntroModal({ aiController, onClose, state, summary, title }: TurnIntroModalProps) {
  return (
    <div className="modal-backdrop modal-backdrop--turn" onClick={onClose}>
      <div className="resolution-modal turn-modal" onClick={(event) => event.stopPropagation()}>
        <div className="resolution-modal__header">
          <div>
            <p className="eyebrow">Bound Start</p>
            <h2 className="resolution-modal__title">{title}</h2>
            <p className="card__headline turn-modal__copy">{summary}</p>
          </div>
          <div className="replay-card__actions">
            <button className="button" onClick={onClose}>
              Begin Turn
            </button>
          </div>
        </div>
        <div className="resolution-modal__meta">
          <div className="stat">
            <span>Active Side</span>
            <strong>{formatArmyDisplayName(state.current_player)}</strong>
          </div>
          <div className="stat">
            <span>Bound</span>
            <strong>{state.bound_number}</strong>
          </div>
          <div className="stat">
            <span>Action Points</span>
            <strong>{state.pips_remaining}</strong>
          </div>
          <div className="stat">
            <span>Mode</span>
            <strong>{describeAiController(aiController)}</strong>
          </div>
        </div>
      </div>
    </div>
  )
}

export function WinnerModal({
  aiController,
  aiUsageCostCounter,
  aiUsageSummary,
  aiUsageTokenCounter,
  onClose,
  onPlayAgain,
  resultLabel,
  state,
  summary,
  title,
}: WinnerModalProps) {
  return (
    <div className="modal-backdrop modal-backdrop--winner" onClick={onClose}>
      <div className="resolution-modal winner-modal" onClick={(event) => event.stopPropagation()}>
        <div className="resolution-modal__header">
          <div>
            <p className="eyebrow">Battle Result</p>
            <h2 className="resolution-modal__title winner-modal__title">{title}</h2>
            <p className="card__headline">{summary}</p>
          </div>
          <div className="replay-card__actions">
            <button className="button button--secondary" onClick={onClose}>
              Close
            </button>
            <button className="button" onClick={onPlayAgain}>
              Play Again
            </button>
          </div>
        </div>
        <div className="resolution-modal__meta">
          <div className="stat">
            <span>Result</span>
            <strong>{resultLabel ?? '-'}</strong>
          </div>
          <div className="stat">
            <span>Scenario</span>
            <strong>{state.scenario_name}</strong>
          </div>
          <div className="stat">
            <span>Bound</span>
            <strong>{state.bound_number}</strong>
          </div>
          <div className="stat stat--wide">
            <span>Army Morale Loss</span>
            <strong>{describeBattleScores(state)}</strong>
          </div>
          <div className="stat stat--wide">
            <span>Break Threshold</span>
            <strong>{describeBattleTarget(state)}</strong>
          </div>
          <div className="stat">
            <span>Mode</span>
            <strong>{describeAiController(aiController)}</strong>
          </div>
          <div className="stat">
            <span>AI Turns</span>
            <strong>{aiUsageSummary.turnCount}</strong>
          </div>
          <div className="stat">
            <span>AI Tokens</span>
            <strong>{aiUsageTokenCounter}</strong>
          </div>
          <div className="stat">
            <span>AI Cost</span>
            <strong>{aiUsageCostCounter}</strong>
          </div>
          {state.winner_reason ? (
            <div className="stat stat--wide">
              <span>Reason</span>
              <strong>{state.winner_reason}</strong>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
