import type { CSSProperties, RefObject } from 'react'
import { controlsArmy, formatArmyDisplayName, type AiController } from './battlefieldShared'
import type { CombatCalloutLayout } from './combatCalloutLayout'
import type { ArmyId, CombatResolution } from './types'

export interface CombatCalloutProps {
  resolution: CombatResolution
  layout: CombatCalloutLayout | null
  modalRef: RefObject<HTMLDivElement | null>
  centeredModalStyle: CSSProperties
  aiController: AiController
  attackerArmy: ArmyId | null
  defenderArmy: ArmyId | null
  resolutionPositionLabel: string | null
  canViewPrevious: boolean
  canViewNext: boolean
  onPrevious: () => void
  onNext: () => void
  onClose: () => void
}

export function CombatCallout({
  resolution,
  layout,
  modalRef,
  centeredModalStyle,
  aiController,
  attackerArmy,
  defenderArmy,
  resolutionPositionLabel,
  canViewPrevious,
  canViewNext,
  onPrevious,
  onNext,
  onClose,
}: CombatCalloutProps) {
  const title = describeResolutionTitle(resolution, attackerArmy, defenderArmy, aiController)

  return (
    <div className="combat-callout-layer">
      {layout ? <span className="combat-callout__anchor" style={layout.anchorStyle} /> : null}
      <div
        ref={modalRef}
        className={[
          'resolution-modal',
          'combat-callout',
          layout ? `combat-callout--${layout.side}` : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={layout?.modalStyle ?? centeredModalStyle}
      >
        {layout ? <span className="combat-callout__pointer" style={layout.pointerStyle} /> : null}
        <div className="resolution-modal__header">
          <div>
            <p className="eyebrow">Combat Detail</p>
            <h2 className="resolution-modal__title">{title}</h2>
            {resolutionPositionLabel ? <p className="card__headline">Resolution {resolutionPositionLabel}</p> : null}
          </div>
          <div className="replay-card__actions">
            <button
              className="button button--secondary"
              disabled={!canViewPrevious}
              onClick={onPrevious}
            >
              Previous
            </button>
            <button
              className="button button--secondary"
              disabled={!canViewNext}
              onClick={onNext}
            >
              Next
            </button>
            <button className="button button--secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="resolution-modal__meta">
          <div className="stat">
            <span>Outcome</span>
            <strong>{resolution.outcome}</strong>
          </div>
          <div className="stat">
            <span>Differential</span>
            <strong>{resolution.differential >= 0 ? `+${resolution.differential}` : resolution.differential}</strong>
          </div>
          {resolution.aspect ? (
            <div className="stat">
              <span>Aspect</span>
              <strong>{resolution.aspect}</strong>
            </div>
          ) : null}
          {resolution.range !== null ? (
            <div className="stat">
              <span>Range</span>
              <strong>{resolution.range}</strong>
            </div>
          ) : null}
        </div>
        <div className="resolution-modal__grid">
          <div
            className={[
              'card',
              'resolution-modal__side',
              attackerArmy ? `resolution-modal__side--army-${attackerArmy.toLowerCase()}` : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <h3>{resolution.attacker_name}</h3>
            <p className="card__headline">{resolution.attacker_id}</p>
            <p>
              {resolution.attacker_score} base + {resolution.attacker_roll} die ={' '}
              <strong>{resolution.attacker_total}</strong>
            </p>
            {resolution.attacker_notes.length ? (
              <ul className="legend-list">
                {resolution.attacker_notes.map((note) => (
                  <li key={`attacker-${note}`}>{note}</li>
                ))}
              </ul>
            ) : (
              <p>No modifiers.</p>
            )}
          </div>
          <div
            className={[
              'card',
              'resolution-modal__side',
              defenderArmy ? `resolution-modal__side--army-${defenderArmy.toLowerCase()}` : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <h3>{resolution.defender_name}</h3>
            <p className="card__headline">{resolution.defender_id}</p>
            <p>
              {resolution.defender_score} base + {resolution.defender_roll} die ={' '}
              <strong>{resolution.defender_total}</strong>
            </p>
            {resolution.defender_notes.length ? (
              <ul className="legend-list">
                {resolution.defender_notes.map((note) => (
                  <li key={`defender-${note}`}>{note}</li>
                ))}
              </ul>
            ) : (
              <p>No modifiers.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

type CombatantRole = 'attacker' | 'defender'

type ResolutionCombatant = {
  role: CombatantRole
  name: string
  army: ArmyId | null
  total: number
}

function describeResolutionTitle(
  resolution: CombatResolution,
  attackerArmy: ArmyId | null,
  defenderArmy: ArmyId | null,
  aiController: AiController,
): string {
  const kindLabel = resolution.kind === 'missile' ? 'Shooting' : 'Close Combat'
  const subject = selectSubjectCombatant(resolution, attackerArmy, defenderArmy)
  const object = selectObjectCombatant(resolution, attackerArmy, defenderArmy, subject.role)
  const score = `${subject.total}-${object.total}`

  return `${kindLabel}: ${formatCombatant(subject, aiController)} ${formatOutcomePhrase(resolution)} ${formatCombatant(
    object,
    aiController,
  )} [${score}]`
}

function selectSubjectCombatant(
  resolution: CombatResolution,
  attackerArmy: ArmyId | null,
  defenderArmy: ArmyId | null,
): ResolutionCombatant {
  if (!isCloseCombatStandOff(resolution)) {
    const winnerRole = roleForUnitId(resolution, resolution.winner_id)
    if (winnerRole) {
      return combatantForRole(resolution, attackerArmy, defenderArmy, winnerRole)
    }
  }

  return combatantForRole(resolution, attackerArmy, defenderArmy, 'attacker')
}

function selectObjectCombatant(
  resolution: CombatResolution,
  attackerArmy: ArmyId | null,
  defenderArmy: ArmyId | null,
  subjectRole: CombatantRole,
): ResolutionCombatant {
  const loserRole = roleForUnitId(resolution, resolution.loser_id)
  if (loserRole && loserRole !== subjectRole) {
    return combatantForRole(resolution, attackerArmy, defenderArmy, loserRole)
  }

  return combatantForRole(resolution, attackerArmy, defenderArmy, subjectRole === 'attacker' ? 'defender' : 'attacker')
}

function roleForUnitId(resolution: CombatResolution, unitId: string | null): CombatantRole | null {
  if (unitId === resolution.attacker_id) {
    return 'attacker'
  }
  if (unitId === resolution.defender_id) {
    return 'defender'
  }
  return null
}

function combatantForRole(
  resolution: CombatResolution,
  attackerArmy: ArmyId | null,
  defenderArmy: ArmyId | null,
  role: CombatantRole,
): ResolutionCombatant {
  if (role === 'attacker') {
    return {
      role,
      name: resolution.attacker_name,
      army: attackerArmy,
      total: resolution.attacker_total,
    }
  }

  return {
    role,
    name: resolution.defender_name,
    army: defenderArmy,
    total: resolution.defender_total,
  }
}

function formatCombatant(combatant: ResolutionCombatant, aiController: AiController): string {
  if (!combatant.army) {
    return combatant.name
  }

  const controlLabel = controlsArmy(aiController, combatant.army) ? 'AI' : 'Player'
  return `${controlLabel} ${formatPossessive(formatArmyDisplayName(combatant.army))} ${combatant.name}`
}

function formatPossessive(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`
}

function isCloseCombatStandOff(resolution: CombatResolution): boolean {
  return resolution.kind === 'close_combat' && (resolution.outcome === 'stand' || resolution.outcome === 'no_effect')
}

function formatOutcomePhrase(resolution: CombatResolution): string {
  switch (resolution.outcome) {
    case 'destroy':
      return 'destroyed'
    case 'disorder':
      return 'disordered'
    case 'flee':
      return 'routed'
    case 'recoil':
      return 'pushed back'
    case 'stand':
      return 'stood off against'
    case 'no_effect':
      return resolution.kind === 'close_combat' ? 'stood off against' : 'had no lasting effect on'
    default:
      return `resolved ${resolution.outcome.replaceAll('_', ' ')} against`
  }
}
