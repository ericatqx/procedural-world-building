import { sampleNoise } from './sample.ts'
import type { NoiseType, ShapingType } from './types.ts'

export type SampleFn = (x: number, y: number) => number

export function makeSampleFn(noiseType: NoiseType): SampleFn {
  return (x, y) => sampleNoise(x, y, noiseType)
}

/**
 * Apply a shaping operation to a base noise sample.
 * Some shapes need extra samples (turbulence, domain warp).
 */
export function applyShaping(
  x: number,
  y: number,
  sample: SampleFn,
  shaping: ShapingType,
  param: number,
): number {
  switch (shaping) {
    case 'none':
      return sample(x, y)
    case 'ridged': {
      const n = 1 - Math.abs(sample(x, y))
      return n * n * 2 - 1
    }
    case 'billow':
      return Math.abs(sample(x, y)) * 2 - 1
    case 'turbulence': {
      // A few fixed abs-octaves — educational "turbulence", not layered blending UI.
      let sum = 0
      let amp = 1
      let freq = 1
      let max = 0
      const octaves = Math.max(1, Math.round(param))
      for (let i = 0; i < octaves; i++) {
        sum += Math.abs(sample(x * freq, y * freq)) * amp
        max += amp
        amp *= 0.5
        freq *= 2
      }
      return (sum / max) * 2 - 1
    }
    case 'terracing': {
      const steps = Math.max(2, Math.round(param))
      const n = (sample(x, y) + 1) / 2
      const terraced = Math.floor(n * steps) / steps
      return terraced * 2 - 1
    }
    case 'power': {
      const power = Math.max(0.1, param)
      const n = sample(x, y)
      const sign = n < 0 ? -1 : 1
      return sign * Math.pow(Math.abs(n), power)
    }
    case 'domainWarp': {
      const strength = param
      const wx = sample(x, y)
      const wy = sample(x + 5.2, y + 1.3)
      return sample(x + wx * strength, y + wy * strength)
    }
  }
}

export function shapingNeedsParam(shaping: ShapingType): boolean {
  return (
    shaping === 'turbulence' ||
    shaping === 'terracing' ||
    shaping === 'power' ||
    shaping === 'domainWarp'
  )
}

export function shapingParamLabel(shaping: ShapingType): string {
  switch (shaping) {
    case 'turbulence':
      return 'Octaves'
    case 'terracing':
      return 'Steps'
    case 'power':
      return 'Exponent'
    case 'domainWarp':
      return 'Warp strength'
    default:
      return 'Parameter'
  }
}

export function shapingParamRange(shaping: ShapingType): {
  min: number
  max: number
  step: number
} {
  switch (shaping) {
    case 'turbulence':
      return { min: 1, max: 6, step: 1 }
    case 'terracing':
      return { min: 2, max: 16, step: 1 }
    case 'power':
      return { min: 0.2, max: 4, step: 0.1 }
    case 'domainWarp':
      return { min: 0, max: 1.5, step: 0.05 }
    default:
      return { min: 0, max: 1, step: 0.1 }
  }
}
