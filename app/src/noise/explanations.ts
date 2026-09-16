import type { NoiseType, ShapingType } from './types.ts'

/** Short hover tips for control sliders / selects. */
export const CONTROL_TOOLTIPS = {
  layers:
    'Add layers to mix broad shapes with finer detail.',
  layerEnabled:
    'Toggle this layer on or off.',
  noiseType:
    'Choose the base noise pattern for this layer.',
  frequency:
    'Higher values create smaller, tighter features.',
  amplitude:
    'Higher values make this layer contribute taller height changes.',
  weight:
    'Higher values make this layer matter more in the blend.',
  resolution:
    'Higher resolution adds more samples, detail, and cost.',
  shaping:
    'Choose a math transform to reshape the noise.',
  shapingParam: {
    turbulence:
      'More octaves add finer turbulent detail.',
    terracing:
      'More steps create thinner terrace bands.',
    power:
      'Higher exponents sharpen peaks and flatten midtones.',
    domainWarp:
      'Higher warp strength bends the pattern more strongly.',
  },
} as const

export type NoiseExplanation = {
  summary: string
  equation: string
}

export const NOISE_EXPLANATIONS: Record<NoiseType, NoiseExplanation> = {
  perlin: {
    summary:
      'Gradient noise: random gradients on a lattice, smoothly interpolated. Classic “hilly” look.',
    equation: 'n = Perlin(x, y)  ∈  ≈[-1, 1]',
  },
  simplex: {
    summary:
      'Simplex noise: similar idea to Perlin on a triangular grid — often slightly less grid artifacts.',
    equation: 'n = Simplex(x, y)  ∈  ≈[-1, 1]',
  },
  value: {
    summary:
      'Value noise: random numbers at lattice points, faded between cells. A bit blotchier than Perlin.',
    equation: 'n = lerp(fade(hash), …)  ∈  ≈[-1, 1]',
  },
  cellular: {
    summary:
      'Worley / cellular: distance to the nearest random feature point. Makes cells and cracks.',
    equation: 'n = remap( min ‖p − feature‖ )  ∈  ≈[-1, 1]',
  },
}

export type ShapingExplanation = {
  summary: string
  equation: string
  paramNote?: string
}

export const SHAPING_EXPLANATIONS: Record<ShapingType, ShapingExplanation> = {
  none: {
    summary: 'No transform — the raw noise value is used as height.',
    equation: 'h = n(x, y)',
  },
  ridged: {
    summary:
      'Folds valleys into sharp ridges: invert absolute value, then square for sharper crests.',
    equation: 'h = (1 − |n|)^2 · 2 − 1',
  },
  billow: {
    summary:
      'Absolute value makes rolling “billowy” hills from both positive and negative lobes.',
    equation: 'h = |n| · 2 − 1',
  },
  turbulence: {
    summary:
      'Sums absolute noise at increasing frequencies (a few octaves) for crumpled, chaotic detail.',
    equation: 'h = Σ |n(x·2ⁱ, y·2ⁱ)| · ½ⁱ   (normalized)',
    paramNote: 'Octaves = how many terms i are summed.',
  },
  terracing: {
    summary:
      'Quantizes height into flat bands — like contour terraces or stepped topography.',
    equation: 'h = floor( ((n+1)/2) · steps ) / steps · 2 − 1',
    paramNote: 'Steps = number of discrete elevation bands.',
  },
  power: {
    summary:
      'Raises |n| to a power, keeping sign. Pushes values toward 0 or toward ±1 depending on p.',
    equation: 'h = sign(n) · |n|^p',
    paramNote: 'Exponent p: p>1 sharpens peaks; 0<p<1 fills midtones.',
  },
  domainWarp: {
    summary:
      'Warps the sample domain: look up noise at a noise-offset position for swirls and distortion.',
    equation: 'h = n( x + s·n(x,y),  y + s·n(x+5.2, y+1.3) )',
    paramNote: 'Warp strength s controls how far coordinates are displaced.',
  },
}
