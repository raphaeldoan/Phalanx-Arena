import type { CSSProperties, RefObject } from 'react'
import { materializeAction } from '../battlefieldShared'
import type { Action, LegalAction, Unit } from '../types'
import type { CombatAnchorProjection } from './sceneGraph'
import type {
  HoverPointerPosition,
  HtmlOverlayDescriptor,
  HtmlOverlayKind,
  MapEdgeOverlayDescriptor,
  TransientUnitOverlayDescriptor,
  TransientUnitOverlayKind,
  UnitHoverTooltip,
  UnitStatusOverlayDescriptor,
  UnitStatusOverlayKind,
} from './overlays'

type BattlefieldHtmlOverlayLayerProps = {
  combatAnchorProjection: CombatAnchorProjection | null
  hoverInfo: string | null
  hoverPointerPosition: HoverPointerPosition | null
  mapEdgeDescriptors: MapEdgeOverlayDescriptor[]
  onPreviewActionChange: (action: LegalAction | null) => void
  onResolveAction: (action: Action) => void
  overlayDescriptors: HtmlOverlayDescriptor[]
  overlayElementMapRef: RefObject<Map<string, HTMLButtonElement | HTMLDivElement>>
  overlayLayerRef: RefObject<HTMLDivElement | null>
  transientUnitOverlayDescriptors: TransientUnitOverlayDescriptor[]
  unitHoverTooltip: UnitHoverTooltip | null
  unitStatusDescriptors: UnitStatusOverlayDescriptor[]
}

export function BattlefieldHtmlOverlayLayer({
  combatAnchorProjection,
  hoverInfo,
  hoverPointerPosition,
  mapEdgeDescriptors,
  onPreviewActionChange,
  onResolveAction,
  overlayDescriptors,
  overlayElementMapRef,
  overlayLayerRef,
  transientUnitOverlayDescriptors,
  unitHoverTooltip,
  unitStatusDescriptors,
}: BattlefieldHtmlOverlayLayerProps) {
  const setOverlayElement = (id: string, element: HTMLButtonElement | HTMLDivElement | null) => {
    if (element) {
      overlayElementMapRef.current.set(id, element)
    } else {
      overlayElementMapRef.current.delete(id)
    }
  }

  return (
    <>
      <div ref={overlayLayerRef} className="battlefield-3d__html-overlays" style={overlayLayerStyle}>
        {overlayDescriptors.map((descriptor) => (
          <button
            key={descriptor.id}
            ref={(element) => setOverlayElement(descriptor.id, element)}
            type="button"
            style={{
              ...htmlOverlayButtonStyle(descriptor.kind),
              position: 'absolute',
              left: 0,
              top: 0,
            }}
            title={descriptor.tooltip}
            aria-label={descriptor.tooltip}
            onMouseEnter={() => onPreviewActionChange(descriptor.action)}
            onMouseLeave={() => onPreviewActionChange(null)}
            onClick={() => onResolveAction(materializeAction(descriptor.action))}
          >
            {descriptor.label}
          </button>
        ))}
        {unitStatusDescriptors.map((descriptor) => (
          <div
            key={descriptor.id}
            ref={(element) => setOverlayElement(descriptor.id, element)}
            aria-label={descriptor.tooltip}
            style={{
              ...unitStatusOverlayStyle(descriptor),
              position: 'absolute',
              left: 0,
              top: 0,
            }}
            title={descriptor.tooltip}
          >
            <span aria-hidden="true" style={unitStatusArmyStyle(descriptor.army)}>
              {descriptor.army}
            </span>
            <span aria-hidden="true" style={unitStatusMoraleValueStyle()}>
              {descriptor.moraleValue}
            </span>
            <span style={unitStatusLabelStyle(descriptor.kind)}>{descriptor.label}</span>
          </div>
        ))}
        {transientUnitOverlayDescriptors.map((descriptor) => (
          <div
            key={descriptor.id}
            ref={(element) => setOverlayElement(descriptor.id, element)}
            aria-label={descriptor.tooltip}
            style={{
              ...transientUnitOverlayStyle(descriptor.kind),
              position: 'absolute',
              left: 0,
              top: 0,
            }}
            title={descriptor.tooltip}
          >
            {descriptor.label}
          </div>
        ))}
        {mapEdgeDescriptors.map((descriptor) => (
          <div
            key={descriptor.id}
            ref={(element) => setOverlayElement(descriptor.id, element)}
            aria-label={descriptor.tooltip}
            style={{
              ...mapEdgeOverlayStyle(),
              position: 'absolute',
              left: 0,
              top: 0,
            }}
            title={descriptor.tooltip}
          >
            {descriptor.label}
          </div>
        ))}
        {hoverInfo ? <div style={hoverInfoStyle}>{hoverInfo}</div> : null}
        {unitHoverTooltip && hoverPointerPosition ? (
          <div style={unitHoverTooltipStyle(hoverPointerPosition)}>
            {unitHoverTooltip.name ? (
              <strong
                style={{
                  display: 'block',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  color: '#ffffff',
                  marginBottom: '0.18rem',
                }}
              >
                {unitHoverTooltip.name}
              </strong>
            ) : null}
            <span style={{ display: 'block' }}>{unitHoverTooltip.summary}</span>
            {unitHoverTooltip.status ? (
              <span style={{ display: 'block', marginTop: '0.18rem', color: 'rgba(247, 243, 235, 0.84)' }}>
                {unitHoverTooltip.status}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {combatAnchorProjection ? <div aria-hidden="true" style={combatAnchorMarkerStyle(combatAnchorProjection)} /> : null}
    </>
  )
}

const overlayLayerStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
}

const hoverInfoStyle: CSSProperties = {
  position: 'absolute',
  left: '0.75rem',
  top: 'calc(var(--battlefield-stage-hud-clearance, 84px) + 0.75rem)',
  background: 'rgba(20, 17, 12, 0.82)',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  borderRadius: '0.75rem',
  color: '#f7f3eb',
  fontSize: '0.78rem',
  padding: '0.45rem 0.65rem',
  pointerEvents: 'none',
}

function unitHoverTooltipStyle(position: HoverPointerPosition): CSSProperties {
  const tooltipWidth = 240
  const tooltipHeight = 84
  const left = position.x + tooltipWidth + 20 > position.width ? Math.max(12, position.x - tooltipWidth - 14) : position.x + 18
  const top = position.y + tooltipHeight + 20 > position.height ? Math.max(12, position.y - tooltipHeight - 14) : position.y + 18

  return {
    position: 'absolute',
    left: `${left}px`,
    top: `${top}px`,
    maxWidth: '15rem',
    background: 'rgba(20, 17, 12, 0.9)',
    border: '1px solid rgba(255, 255, 255, 0.18)',
    borderRadius: '0.75rem',
    boxShadow: '0 12px 28px rgba(0, 0, 0, 0.24)',
    color: '#f7f3eb',
    fontSize: '0.76rem',
    lineHeight: 1.35,
    padding: '0.55rem 0.72rem',
    pointerEvents: 'none',
    zIndex: 8,
  }
}

function htmlOverlayButtonStyle(kind: HtmlOverlayKind): CSSProperties {
  const base = {
    background: 'rgba(255, 250, 243, 0.94)',
    border: '1px solid rgba(123, 107, 80, 0.3)',
    borderRadius: '0.75rem',
    boxShadow: '0 8px 18px rgba(29, 23, 16, 0.15)',
    color: '#2d2418',
    cursor: 'pointer',
    fontSize: '0.72rem',
    fontWeight: 800,
    letterSpacing: '0.04em',
    lineHeight: 1,
    minWidth: '2.2rem',
    padding: '0.42rem 0.55rem',
    textTransform: 'uppercase' as const,
  }

  if (kind === 'shoot') {
    return { ...base, background: 'rgba(142, 69, 36, 0.95)', color: '#fff4ec' }
  }
  if (kind === 'group') {
    return { ...base, background: 'rgba(30, 97, 87, 0.95)', color: '#eef8f6' }
  }
  if (kind === 'order') {
    return { ...base, background: 'rgba(49, 88, 132, 0.95)', color: '#eff6ff' }
  }
  return base
}

const UNIT_STATUS_TONES: Record<UnitStatusOverlayKind, { border: string; color: string }> = {
  steady: { border: 'rgba(217, 195, 145, 0.52)', color: '#efe3c5' },
  command: { border: 'rgba(125, 176, 219, 0.58)', color: '#c7e5ff' },
  ordered_pike: { border: 'rgba(92, 193, 174, 0.58)', color: '#bfefe6' },
  disordered: { border: 'rgba(218, 151, 82, 0.62)', color: '#ffd2a2' },
  disordered_pike: { border: 'rgba(218, 151, 82, 0.62)', color: '#ffd2a2' },
  panic: { border: 'rgba(235, 96, 86, 0.72)', color: '#ffc5bc' },
  rout: { border: 'rgba(198, 74, 66, 0.76)', color: '#ffb4aa' },
  overpursuit: { border: 'rgba(164, 143, 219, 0.66)', color: '#ddd2ff' },
  reserve: { border: 'rgba(178, 178, 178, 0.54)', color: '#e6e0d8' },
  off_map: { border: 'rgba(146, 136, 122, 0.58)', color: '#d9d0c2' },
}

const UNIT_ARMY_TONES: Record<Unit['army'], { accent: string; background: string; color: string }> = {
  A: { accent: 'rgba(79, 205, 185, 0.96)', background: 'rgba(30, 97, 87, 0.98)', color: '#ecfffb' },
  B: { accent: 'rgba(229, 139, 94, 0.98)', background: 'rgba(142, 69, 36, 0.98)', color: '#fff3ec' },
}

function unitStatusOverlayStyle(descriptor: UnitStatusOverlayDescriptor): CSSProperties {
  const statusTone = UNIT_STATUS_TONES[descriptor.kind]
  const armyTone = UNIT_ARMY_TONES[descriptor.army]
  return {
    alignItems: 'center',
    background: 'linear-gradient(180deg, rgba(34, 29, 22, 0.92), rgba(16, 14, 11, 0.88))',
    border: `1px solid ${statusTone.border}`,
    borderBottom: `2px solid ${armyTone.accent}`,
    borderRadius: '0.34rem',
    boxShadow: '0 8px 18px rgba(10, 8, 6, 0.22)',
    color: '#fff7eb',
    display: 'inline-flex',
    fontSize: '0.58rem',
    fontWeight: 800,
    height: '1.34rem',
    letterSpacing: 0,
    lineHeight: 1,
    maxWidth: '7.4rem',
    minWidth: '4.9rem',
    overflow: 'hidden',
    padding: 0,
    pointerEvents: 'none',
    textAlign: 'center',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  }
}

function unitStatusArmyStyle(army: Unit['army']): CSSProperties {
  const armyTone = UNIT_ARMY_TONES[army]
  return {
    alignItems: 'center',
    alignSelf: 'stretch',
    background: armyTone.background,
    color: armyTone.color,
    display: 'inline-flex',
    flex: '0 0 1.22rem',
    fontSize: '0.62rem',
    fontWeight: 900,
    justifyContent: 'center',
  }
}

function unitStatusMoraleValueStyle(): CSSProperties {
  return {
    alignItems: 'center',
    color: '#fff8ea',
    display: 'inline-flex',
    flex: '0 0 1.18rem',
    fontSize: '0.62rem',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 900,
    justifyContent: 'center',
  }
}

function unitStatusLabelStyle(kind: UnitStatusOverlayKind): CSSProperties {
  const statusTone = UNIT_STATUS_TONES[kind]
  return {
    color: statusTone.color,
    display: 'block',
    flex: '1 1 auto',
    fontSize: '0.54rem',
    fontWeight: 900,
    overflow: 'hidden',
    padding: '0 0.42rem 0 0.12rem',
    textOverflow: 'ellipsis',
    textTransform: 'uppercase',
  }
}

function transientUnitOverlayStyle(kind: TransientUnitOverlayKind): CSSProperties {
  void kind
  return {
    background: 'rgba(184, 55, 48, 0.96)',
    border: '1px solid rgba(255, 232, 225, 0.34)',
    borderRadius: '999px',
    boxShadow: '0 10px 24px rgba(77, 16, 12, 0.28)',
    color: '#fff7f3',
    fontSize: '0.62rem',
    fontWeight: 900,
    letterSpacing: '0.08em',
    lineHeight: 1,
    padding: '0.38rem 0.62rem',
    pointerEvents: 'none',
    textAlign: 'center',
    textTransform: 'uppercase',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    willChange: 'opacity, transform',
  }
}

function mapEdgeOverlayStyle(): CSSProperties {
  return {
    color: 'rgba(255, 247, 235, 0.94)',
    display: 'block',
    fontSize: '0.82rem',
    fontWeight: 900,
    letterSpacing: '0.08em',
    lineHeight: 1,
    pointerEvents: 'none',
    textAlign: 'center',
    textShadow: '0 2px 8px rgba(0, 0, 0, 0.55), 0 0 1px rgba(20, 17, 12, 0.95)',
    textTransform: 'uppercase',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  }
}

function combatAnchorMarkerStyle(projection: CombatAnchorProjection): CSSProperties {
  return {
    ...projection.anchorStyle,
    background: 'rgba(142, 69, 36, 0.85)',
    borderRadius: '999px',
    height: '0.75rem',
    pointerEvents: 'none',
    position: 'absolute',
    transform: 'translate(-50%, -50%)',
    width: '0.75rem',
    zIndex: 5,
  }
}
