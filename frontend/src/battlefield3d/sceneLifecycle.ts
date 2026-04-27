import * as THREE from 'three'

export function canvasShowsPresentedScene(renderer: THREE.WebGLRenderer): boolean {
  const context = renderer.getContext()
  const width = context.drawingBufferWidth
  const height = context.drawingBufferHeight
  if (width <= 0 || height <= 0) {
    return false
  }

  const sample = new Uint8Array(4)
  const sampleXs = [0.2, 0.5, 0.8]
  const sampleYs = [0.25, 0.5, 0.75]
  let nonBackgroundSamples = 0

  for (const normalizedY of sampleYs) {
    for (const normalizedX of sampleXs) {
      const x = Math.min(width - 1, Math.max(0, Math.round((width - 1) * normalizedX)))
      const y = Math.min(height - 1, Math.max(0, Math.round((height - 1) * normalizedY)))
      context.readPixels(x, y, 1, 1, context.RGBA, context.UNSIGNED_BYTE, sample)

      const isOpaque = sample[3] >= 250
      const differsFromBackground =
        Math.abs(sample[0] - 255) > 10 || Math.abs(sample[1] - 255) > 10 || Math.abs(sample[2] - 255) > 10

      if (isOpaque && differsFromBackground) {
        nonBackgroundSamples += 1
        if (nonBackgroundSamples >= 2) {
          return true
        }
      }
    }
  }

  return false
}

export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, 0)
    })
  })
}
