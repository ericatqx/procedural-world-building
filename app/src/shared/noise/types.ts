export type NoiseType = 'perlin' | 'simplex' | 'value' | 'cellular'

export type ShapingType =
  | 'none'
  | 'ridged'
  | 'billow'
  | 'turbulence'
  | 'terracing'
  | 'power'
  | 'domainWarp'

export type NoiseLayer = {
  id: string
  enabled: boolean
  noiseType: NoiseType
  frequency: number
  amplitude: number
  weight: number
  shaping: ShapingType
  shapingParam: number
}

export type NoiseSettings = {
  resolution: number
  layers: NoiseLayer[]
}

export function createNoiseLayer(overrides: Partial<NoiseLayer> = {}): NoiseLayer {
  const makeId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? () => crypto.randomUUID()
      : () => `layer-${Math.random().toString(36).slice(2, 10)}`

  return {
    id: makeId(),
    enabled: true,
    noiseType: 'perlin',
    frequency: 4,
    amplitude: 1.2,
    weight: 1,
    shaping: 'none',
    shapingParam: 4,
    ...overrides,
  }
}

/**
 * Default landform, largest scale first: a very broad, lightly weighted layer
 * tilts the whole window so it tends to rise toward one region; a
 * domain-warped base sets the valleys, basins and highlands; a lighter ridged
 * layer adds ridgelines; a faint high-frequency layer adds surface texture.
 * Layers are weight-averaged, so the other amplitudes are scaled up to keep
 * their relief with the regional layer included.
 */
export const DEFAULT_NOISE_SETTINGS: NoiseSettings = {
  resolution: 64,
  layers: [
    createNoiseLayer({
      noiseType: 'perlin',
      frequency: 0.5,
      amplitude: 1.2,
      weight: 0.3,
      shaping: 'none',
    }),
    createNoiseLayer({
      noiseType: 'simplex',
      frequency: 1,
      amplitude: 1.5,
      weight: 1,
      shaping: 'domainWarp',
      shapingParam: 0.7,
    }),
    createNoiseLayer({
      noiseType: 'perlin',
      frequency: 2.4,
      amplitude: 1.05,
      weight: 0.4,
      shaping: 'ridged',
    }),
    createNoiseLayer({
      noiseType: 'simplex',
      frequency: 7,
      amplitude: 0.6,
      weight: 0.15,
      shaping: 'none',
    }),
  ],
}

export const NOISE_TYPE_OPTIONS: { value: NoiseType; label: string }[] = [
  { value: 'perlin', label: 'Perlin' },
  { value: 'simplex', label: 'Simplex' },
  { value: 'value', label: 'Value' },
  { value: 'cellular', label: 'Cellular / Worley' },
]

export const SHAPING_OPTIONS: { value: ShapingType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'ridged', label: 'Ridged' },
  { value: 'billow', label: 'Billow' },
  { value: 'turbulence', label: 'Turbulence' },
  { value: 'terracing', label: 'Terracing' },
  { value: 'power', label: 'Power Curve' },
  { value: 'domainWarp', label: 'Domain Warping' },
]
