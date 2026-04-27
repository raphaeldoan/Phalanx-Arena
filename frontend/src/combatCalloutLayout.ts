import type { CSSProperties } from 'react'
import { clamp } from './battlefieldShared'

export type CombatCalloutLayout = {
  anchorStyle: CSSProperties
  modalStyle: CSSProperties
  pointerStyle: CSSProperties
  side: 'left' | 'right'
}

export function buildCombatCalloutLayout(
  anchorX: number,
  anchorY: number,
  modalRect: DOMRect,
): CombatCalloutLayout {
  const viewportMargin = 8
  const side: 'left' | 'right' = anchorX <= window.innerWidth / 2 ? 'right' : 'left'
  let left = side === 'right' ? window.innerWidth - modalRect.width - viewportMargin : viewportMargin

  left = clamp(left, viewportMargin, Math.max(viewportMargin, window.innerWidth - modalRect.width - viewportMargin))
  const top = clamp(
    anchorY - modalRect.height / 2,
    viewportMargin,
    Math.max(viewportMargin, window.innerHeight - modalRect.height - viewportMargin),
  )
  const pointerTop = clamp(anchorY - top, 24, Math.max(24, modalRect.height - 24))

  return {
    anchorStyle: {
      left: `${anchorX}px`,
      top: `${anchorY}px`,
    },
    modalStyle: {
      left: `${left}px`,
      top: `${top}px`,
    },
    pointerStyle: {
      top: `${pointerTop}px`,
    },
    side,
  }
}
