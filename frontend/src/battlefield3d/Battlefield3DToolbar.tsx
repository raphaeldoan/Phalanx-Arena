import type { CSSProperties } from 'react'
import { formatArmyDisplayName, type CameraPresetId } from '../battlefieldShared'

type Battlefield3DToolbarProps = {
  activePreset: CameraPresetId
  onSelectPreset: (preset: CameraPresetId) => void
}

const CAMERA_PRESETS = ['army_a', 'army_b'] as const

export function Battlefield3DToolbar({ activePreset, onSelectPreset }: Battlefield3DToolbarProps) {
  return (
    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
      {CAMERA_PRESETS.map((preset) => {
        const label = formatCameraPresetLabel(preset)

        return (
          <button
            key={preset}
            type="button"
            onClick={() => onSelectPreset(preset)}
            style={toolbarButtonStyle(activePreset === preset)}
            aria-label={`${label} camera view`}
          >
            <CameraIcon />
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

function formatCameraPresetLabel(preset: CameraPresetId): string {
  if (preset === 'army_a') {
    return formatArmyDisplayName('A')
  }
  if (preset === 'army_b') {
    return formatArmyDisplayName('B')
  }
  if (preset === 'focus_selection') {
    return 'FOCUS SEL'
  }
  if (preset === 'focus_target') {
    return 'FOCUS TGT'
  }
  return preset.toUpperCase()
}

function CameraIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="0.95rem"
      height="0.95rem"
      fill="currentColor"
    >
      <path d="M9 5.25a1.5 1.5 0 0 1 1.29-.75h3.42A1.5 1.5 0 0 1 15 5.25l.6 1.05h2.15A2.25 2.25 0 0 1 20 8.55v7.2A2.25 2.25 0 0 1 17.75 18h-11.5A2.25 2.25 0 0 1 4 15.75v-7.2A2.25 2.25 0 0 1 6.25 6.3H8.4L9 5.25Zm3 10.2a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6Zm0-1.5a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6Z" />
    </svg>
  )
}

function toolbarButtonStyle(active: boolean): CSSProperties {
  return {
    appearance: 'none',
    alignItems: 'center',
    background: active ? 'rgba(30, 97, 87, 0.92)' : 'rgba(255, 255, 255, 0.9)',
    border: `1px solid ${active ? 'rgba(30, 97, 87, 0.9)' : 'rgba(123, 107, 80, 0.35)'}`,
    borderRadius: '999px',
    color: active ? '#ffffff' : '#2e2419',
    cursor: 'pointer',
    display: 'inline-flex',
    fontSize: '0.72rem',
    fontWeight: 700,
    gap: '0.35rem',
    justifyContent: 'center',
    letterSpacing: '0.05em',
    padding: '0.42rem 0.68rem',
    textTransform: 'uppercase',
  }
}
