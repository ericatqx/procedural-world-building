import type { Tone } from '../../shared/ui/instrument.tsx'

/**
 * Week 05 — shader studies. Each study is one rule that works unchanged on
 * every specimen geometry, described as Input → Rule → Output. This file is data only: the GLSL for
 * each rule lives in studyShaders.ts, keyed by the same id.
 */

export type ShaderStudyId =
  | 'height'
  | 'slope'
  | 'distance'
  | 'fresnel'
  | 'displacement'
  | 'contact'
  | 'surface'
  | 'habitat'
  | 'growth'
  | 'exposure'

/** Foundations isolate one rule; applications combine rules toward the world. */
export type StudyGroup = 'foundation' | 'application'

/** Surface colours shared by the shaders and the output legends. */
export const STUDY_COLORS = {
  stone: '#e4e0d8',
  rim: '#e9e6df',
  sediment: '#f0ae56',
  signal: '#ff4a1c',
  /** Contact: a dark graphite ground under the specimen, just lighter than the black field. */
  contactFloor: '#4a4843',
  habitat: '#64dcff',
  heightRamp: ['#4b5f78', '#6e7f92', '#a2a9b0', '#ebe9e4'],
  /** Surface palettes, dark → mid → light; index matches the Palette option. */
  surfacePalettes: [
    ['#3b3935', '#8c867c', '#e4e0d8'],
    ['#2b323b', '#6e7f92', '#d6dadd'],
    ['#3f2e20', '#a27242', '#efdcc0'],
  ],
  /** Growth: tissue the front has passed, and the young band just behind it. */
  growthGrown: '#6b6861',
  growthFront: '#f6f3ec',
  /** Exposure: sheltered patina, and fully weathered bleached stone. */
  patina: '#8f8a81',
  bleached: '#eeebe4',
} as const

/** Fixed parts of rules, kept out of the controls. */
export const STUDY_CONSTANTS = {
  distanceRingSpacing: 0.1,
  fresnelSurface: 0.3,
  contactFalloff: 1.5,
  /** Contact ground radius: solid inside, fading gradually to the black background by the outer edge. */
  contactPlateInner: 1.4,
  contactPlateOuter: 3,
  /** Contact floor guides: faint proximity rings every d/4, and the firmer ring where the gap reaches d. */
  contactRingOpacity: 0.09,
  contactReachOpacity: 0.2,
  /** Pits darken towards this fraction of the stone colour at full depth. */
  displacementPitShade: 0.5,
  displacementMaxAmplitude: 0.3,
  surfaceOctaves: 4,
  /** Half-width of the shelter transition, in exposure units. */
  habitatExposureSoftness: 0.05,
  /** Half-width of the footing transition, in degrees. */
  habitatSlopeSoftness: 5,
  /** How strongly the habitat colour replaces the lit surface. */
  habitatOverlay: 0.85,
  /** Brightness of the habitat colour; unlit, so it reads inside shadow. */
  habitatGlow: 0.75,
  sunDistance: 7,
  /** Age between growth rings. */
  growthRingSpacing: 0.05,
  /** How strongly the young band replaces the lit surface; unlit, so it reads inside shadow. */
  growthFrontOverlay: 0.85,
  /** Width of the weathering onset, in exposure units. */
  exposureSoftness: 0.25,
  /** Pits per world unit. */
  exposurePitScale: 18,
  /** Pits darken towards this fraction of the albedo at full weathering. */
  exposurePitShade: 0.45,
  /** Pit depth in world units at full weathering. */
  exposurePitRelief: 0.012,
} as const

/**
 * One control; `uniform` is the GLSL float it drives, and the key in
 * StudyValues. With `options` it is a discrete choice instead of a slider.
 */
export type StudyParam = {
  uniform: string
  label: string
  min: number
  max: number
  step: number
  default: number
  digits: number
  unit?: string
  /** Shown instead of the number when the value is 0. */
  zeroLabel?: string
  options?: readonly { value: number; label: string }[]
  tone?: Tone
  tip: string
}

export type StudyValues = Record<string, number>

/** A colour bar for the output, left → right, with its end labels. */
export type StudyLegend = {
  gradient: string
  start: string
  end: string
}

export type ShaderStudy = {
  id: ShaderStudyId
  label: string
  group: StudyGroup
  /** Program stage where the rule runs. */
  stage: 'vertex' | 'fragment'
  input: {
    name: string
    /** The GLSL values the rule reads. */
    source: string
    note: string
  }
  rule: {
    formula: string
    summary: string
  }
  output: {
    /** The shader variable the rule writes. */
    writes: string
    note: string
    /** The scalar shown by the Term view, 0 black → 1 white. */
    term: string
  }
  params: readonly StudyParam[]
  legend: (values: StudyValues) => StudyLegend
}

export const TERM_LEGEND: StudyLegend = {
  gradient: 'linear-gradient(90deg, #000000, #ffffff)',
  start: '0',
  end: '1',
}

function scaleHex(hex: string, factor: number): string {
  const channel = (offset: number) =>
    Math.round(Math.min(255, parseInt(hex.slice(offset, offset + 2), 16) * factor))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(1)}${channel(3)}${channel(5)}`
}

function mixHex(a: string, b: string, t: number): string {
  const channel = (offset: number) => {
    const from = parseInt(a.slice(offset, offset + 2), 16)
    const to = parseInt(b.slice(offset, offset + 2), 16)
    return Math.round(from + (to - from) * t)
  }
  return `rgb(${channel(1)}, ${channel(3)}, ${channel(5)})`
}

/** Samples a 0…1 → colour function into a CSS gradient. */
function sampledGradient(colorAt: (t: number) => string, samples = 9): string {
  const stops = Array.from({ length: samples }, (_, i) => {
    const t = i / (samples - 1)
    return `${colorAt(t)} ${(t * 100).toFixed(1)}%`
  })
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export const SHADER_STUDIES: readonly ShaderStudy[] = [
  {
    id: 'height',
    label: 'Height',
    group: 'foundation',
    stage: 'fragment',
    input: {
      name: 'World height',
      source: 'vStudyWorldPos.y',
      note: 'The vertex world position, interpolated per pixel. 0 at the floor, 1.60 at the top of the specimen.',
    },
    rule: {
      formula: 't = clamp((y − low) / (high − low))\nalbedo = ramp(t)',
      summary:
        'Position becomes colour. The same colour always means the same height, whatever the light does. Contour lines mark every Δy.',
    },
    output: {
      writes: 'diffuseColor · albedo',
      note: 'Written before lighting, so the key light still shades the ramp.',
      term: 't: position on the ramp',
    },
    params: [
      {
        uniform: 'uHeightLow',
        label: 'Low',
        min: 0,
        max: 1.6,
        step: 0.01,
        default: 0,
        digits: 2,
        tip: 'World height mapped to the bottom of the ramp. Everything below reads as the lowest colour.',
      },
      {
        uniform: 'uHeightHigh',
        label: 'High',
        min: 0,
        max: 1.6,
        step: 0.01,
        default: 1.6,
        digits: 2,
        tip: 'World height mapped to the top of the ramp. Narrow the range to spend the whole ramp on one band of the form.',
      },
      {
        uniform: 'uHeightInterval',
        label: 'Contour Δy',
        min: 0,
        max: 0.4,
        step: 0.01,
        default: 0.1,
        digits: 2,
        zeroLabel: 'off',
        tip: 'Height between contour lines. Lines crowd where the surface is steep and spread where it is flat.',
      },
    ],
    legend: (values) => ({
      gradient: `linear-gradient(90deg, ${STUDY_COLORS.heightRamp[0]} 0%, ${STUDY_COLORS.heightRamp[1]} 40%, ${STUDY_COLORS.heightRamp[2]} 70%, ${STUDY_COLORS.heightRamp[3]} 100%)`,
      start: `y ${values.uHeightLow.toFixed(2)}`,
      end: `y ${values.uHeightHigh.toFixed(2)}`,
    }),
  },
  {
    id: 'slope',
    label: 'Slope',
    group: 'foundation',
    stage: 'fragment',
    input: {
      name: 'Surface normal',
      source: 'normalize(vStudyWorldNormal).y',
      note: 'The world-space normal, interpolated per pixel. Its y component is cos(slope): 1 on flat tops, 0 on vertical faces.',
    },
    rule: {
      formula:
        'angle = acos(n.y)\nsteep = smoothstep(θ − s, θ + s, angle)\nalbedo = mix(stone, amber, steep)',
      summary:
        'Orientation becomes a class. Faces steeper than θ turn sediment amber, where loose material would slide. The line marks angle = θ exactly.',
    },
    output: {
      writes: 'diffuseColor · albedo',
      note: 'Written before lighting; the θ line is drawn after it.',
      term: 'steep: 0 below θ, 1 above',
    },
    params: [
      {
        uniform: 'uSlopeThreshold',
        label: 'Threshold θ',
        min: 0,
        max: 90,
        step: 1,
        default: 35,
        digits: 0,
        unit: '°',
        tone: 'sediment',
        tip: 'Slope angle above which a face is marked. 0° marks everything but perfectly flat tops; 90° marks nothing.',
      },
      {
        uniform: 'uSlopeSoftness',
        label: 'Softness s',
        min: 0,
        max: 30,
        step: 1,
        default: 3,
        digits: 0,
        unit: '°',
        tip: 'Half-width of the transition around θ. 0° gives a hard edge.',
      },
    ],
    legend: (values) => {
      const soft = Math.max(values.uSlopeSoftness, 0.01)
      return {
        gradient: sampledGradient(
          (t) =>
            mixHex(
              STUDY_COLORS.stone,
              STUDY_COLORS.sediment,
              smoothstep(values.uSlopeThreshold - soft, values.uSlopeThreshold + soft, t * 90),
            ),
          31,
        ),
        start: '0° flat',
        end: '90° vertical',
      }
    },
  },
  {
    id: 'distance',
    label: 'Distance',
    group: 'foundation',
    stage: 'fragment',
    input: {
      name: 'World position + probe',
      source: 'vStudyWorldPos, uProbeX, uProbeY',
      note: 'The pixel’s world position and a probe point passed in as uniforms. Nothing about the surface itself is read.',
    },
    rule: {
      formula:
        'd = length(p − probe)\ninfluence = 1 − smoothstep(0, r, d)\nalbedo = mix(stone, signal, influence)',
      summary: `A spherical field in space. Where it meets the surface it traces the form: rings every ${STUDY_CONSTANTS.distanceRingSpacing}, outline at d = r.`,
    },
    output: {
      writes: 'diffuseColor · albedo',
      note: 'Written before lighting; rings and outline are drawn after it.',
      term: 'influence: 1 at the probe, 0 at r',
    },
    params: [
      {
        uniform: 'uProbeX',
        label: 'Probe X',
        min: -1.5,
        max: 1.5,
        step: 0.01,
        default: 0.6,
        digits: 2,
        tone: 'x',
        tip: 'Probe position along X.',
      },
      {
        uniform: 'uProbeY',
        label: 'Probe Y',
        min: 0,
        max: 2,
        step: 0.01,
        default: 1.2,
        digits: 2,
        tone: 'y',
        tip: 'Probe height above the floor.',
      },
      {
        uniform: 'uProbeRadius',
        label: 'Radius r',
        min: 0.1,
        max: 2.5,
        step: 0.01,
        default: 1,
        digits: 2,
        tone: 'signal',
        tip: 'Distance at which influence reaches zero. The outline on the surface is this sphere.',
      },
    ],
    legend: (values) => ({
      gradient: sampledGradient((t) =>
        mixHex(STUDY_COLORS.signal, STUDY_COLORS.stone, smoothstep(0, 1, t)),
      ),
      start: 'd 0',
      end: `d ${values.uProbeRadius.toFixed(2)}`,
    }),
  },
  {
    id: 'fresnel',
    label: 'Fresnel',
    group: 'foundation',
    stage: 'fragment',
    input: {
      name: 'Normal + view direction',
      source: 'normal, normalize(vViewPosition)',
      note: 'Both in view space. Their dot product is 1 where the surface faces the camera and 0 where it turns edge-on, so it changes as you orbit.',
    },
    rule: {
      formula: `rim = (1 − max(n · v, 0))^p · k\nlight = lit · ${STUDY_CONSTANTS.fresnelSurface} + rim`,
      summary:
        'Viewing angle becomes light. Edge-on faces glow and the lit surface is dimmed so the rim reads. Orbit, and the rim follows the silhouette.',
    },
    output: {
      writes: 'outgoingLight',
      note: 'Written after lighting; the rim is added on top of the lit colour.',
      term: 'rim: 0 facing, bright at the silhouette',
    },
    params: [
      {
        uniform: 'uFresnelPower',
        label: 'Power p',
        min: 0.5,
        max: 8,
        step: 0.1,
        default: 3,
        digits: 1,
        tip: 'Higher values push the glow out to the silhouette; lower values spread it across the form.',
      },
      {
        uniform: 'uFresnelStrength',
        label: 'Strength k',
        min: 0,
        max: 1.5,
        step: 0.01,
        default: 0.9,
        digits: 2,
        tip: 'Rim brightness.',
      },
    ],
    legend: (values) => ({
      gradient: sampledGradient((t) =>
        mixHex('#111111', STUDY_COLORS.rim, Math.min(1, t ** values.uFresnelPower * values.uFresnelStrength)),
      ),
      start: 'n·v 1 facing',
      end: 'n·v 0 edge-on',
    }),
  },
  {
    id: 'displacement',
    label: 'Displacement',
    group: 'foundation',
    stage: 'vertex',
    input: {
      name: 'Vertex position + normal',
      source: 'position, normal, uTime',
      note: 'Object-space attributes of each vertex, before projection. Runs once per vertex, not per pixel, and again in the shadow pass; the vertex count depends on the geometry.',
    },
    rule: {
      formula: 'h = a · (2 · noise(p · f + t · speed) − 1)\np′ = p + n · h',
      summary:
        'Geometry moves before rasterisation, so the silhouette and cast shadow change, not just the shading. Pits are darkened; the line marks h = 0, the original surface.',
    },
    output: {
      writes: 'transformed · vertex position',
      note: 'Face normals are rebuilt per pixel from the moved surface, so light follows the new shape.',
      term: 'noise: 0.5 is no offset',
    },
    params: [
      {
        uniform: 'uDisplaceAmplitude',
        label: 'Amplitude a',
        min: 0,
        max: STUDY_CONSTANTS.displacementMaxAmplitude,
        step: 0.005,
        default: 0.12,
        digits: 3,
        tip: 'Maximum distance a vertex moves along its normal, in or out.',
      },
      {
        uniform: 'uDisplaceFrequency',
        label: 'Frequency f',
        min: 0.5,
        max: 8,
        step: 0.1,
        default: 3,
        digits: 1,
        tip: 'Noise features per unit. Past the mesh density the bumps alias: there are not enough vertices to carry them.',
      },
      {
        uniform: 'uDisplaceSpeed',
        label: 'Speed',
        min: 0,
        max: 2,
        step: 0.05,
        default: 0.3,
        digits: 2,
        zeroLabel: 'still',
        tip: 'How fast the noise field scrolls through the form. At 0 the shape holds still.',
      },
    ],
    legend: (values) => {
      const depth = values.uDisplaceAmplitude / STUDY_CONSTANTS.displacementMaxAmplitude
      const pit = 1 - (1 - STUDY_CONSTANTS.displacementPitShade) * depth
      return {
        gradient: `linear-gradient(90deg, ${scaleHex(STUDY_COLORS.stone, pit)}, ${STUDY_COLORS.stone} 50%, ${STUDY_COLORS.stone})`,
        start: `h −${values.uDisplaceAmplitude.toFixed(3)} in`,
        end: `+${values.uDisplaceAmplitude.toFixed(3)} out`,
      }
    },
  },
  {
    id: 'contact',
    label: 'Contact',
    group: 'foundation',
    stage: 'fragment',
    input: {
      name: 'Gap to the other surface',
      source: 'vStudyWorldPos.y, vStudyWorldNormal.y · floor xz',
      note: 'On the form, the gap is its height above the floor, counted only where the face turns toward the floor: fully on walls and undersides, not at all on tops. On the floor, it is the horizontal distance to the nearest point where the form touches it, precomputed per geometry; the floor always faces the form.',
    },
    rule: {
      formula: `facing = 1 − max(n.y, 0)\nc = (1 − clamp(gap / d))^${STUDY_CONSTANTS.contactFalloff} · facing · strength\nlight = lit · (1 − c)`,
      summary:
        'Light is taken away where the form nearly touches the floor: a hand-made proximity field, not ambient occlusion. It only knows the floor, so corners between parts of the form are not darkened.',
    },
    output: {
      writes: 'outgoingLight',
      note: 'Written after lighting; it multiplies the lit colour of the form and the floor. Guides: faint rings on the floor mark each quarter of d, and the gap where darkening ends.',
      term: 'c: 1 at contact, 0 at gap d',
    },
    params: [
      {
        uniform: 'uContactDistance',
        label: 'Distance d',
        min: 0.02,
        max: 1,
        step: 0.01,
        default: 0.4,
        digits: 2,
        tip: 'Gap at which darkening reaches zero.',
      },
      {
        uniform: 'uContactStrength',
        label: 'Strength',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.85,
        digits: 2,
        tip: 'Darkening where the gap is zero.',
      },
    ],
    legend: (values) => ({
      gradient: sampledGradient((t) =>
        scaleHex(
          STUDY_COLORS.stone,
          1 - (1 - t) ** STUDY_CONSTANTS.contactFalloff * values.uContactStrength,
        ),
      ),
      start: 'gap 0',
      end: `gap ${values.uContactDistance.toFixed(2)}`,
    }),
  },
  {
    id: 'surface',
    label: 'Surface Material',
    group: 'application',
    stage: 'fragment',
    input: {
      name: 'Surface position',
      source: 'vStudyWorldPos · uSurfaceScale',
      note: 'World position drives 3D noise, so the pattern is carved through the form rather than wrapped onto it: no UVs, no seams.',
    },
    rule: {
      formula: `n = fbm(p · scale), ${STUDY_CONSTANTS.surfaceOctaves} octaves\nn′ = clamp((n − 0.5) · contrast + 0.5)\nalbedo = palette(n′)\nroughness = mix(0.65, 1, n′)\nnormal = bump(n′ · relief)`,
      summary:
        'Noise becomes material. One field drives colour, roughness and relief together, so every vein is also a groove: appearance without a texture image.',
    },
    output: {
      writes: 'diffuseColor · roughness · normal',
      note: 'All before lighting: the key light reads the relief as texture, and highlights break up where the surface is rough.',
      term: 'n′: the contrasted noise field',
    },
    params: [
      {
        uniform: 'uSurfaceScale',
        label: 'Scale',
        min: 0.5,
        max: 12,
        step: 0.1,
        default: 3.5,
        digits: 1,
        tip: 'Noise features per unit. Low values give broad mottling; high values give grain.',
      },
      {
        uniform: 'uSurfaceContrast',
        label: 'Contrast',
        min: 0.5,
        max: 6,
        step: 0.1,
        default: 2.5,
        digits: 1,
        tip: 'Stretches the noise around its middle. Low values blend into one tone; high values split it into two materials with a hard boundary.',
      },
      {
        uniform: 'uSurfaceRelief',
        label: 'Relief',
        min: 0,
        max: 0.05,
        step: 0.001,
        default: 0.015,
        digits: 3,
        zeroLabel: 'flat',
        tip: 'Bump height in world units. Only the normal changes; the silhouette stays smooth, unlike Displacement.',
      },
      {
        uniform: 'uSurfacePalette',
        label: 'Palette',
        min: 0,
        max: 2,
        step: 1,
        default: 0,
        digits: 0,
        options: [
          { value: 0, label: 'Stone' },
          { value: 1, label: 'Slate' },
          { value: 2, label: 'Ochre' },
        ],
        tip: 'Three restrained material families, each mapped dark → mid → light across n′.',
      },
    ],
    legend: (values) => {
      const palette = STUDY_COLORS.surfacePalettes[values.uSurfacePalette] ?? STUDY_COLORS.surfacePalettes[0]
      return {
        gradient: `linear-gradient(90deg, ${palette[0]}, ${palette[1]} 50%, ${palette[2]})`,
        start: 'n′ 0',
        end: 'n′ 1',
      }
    },
  },
  {
    id: 'habitat',
    label: 'Habitat',
    group: 'application',
    stage: 'fragment',
    input: {
      name: 'Light exposure + normal',
      source: 'directLight.color, directLight.direction, normal',
      note: 'Direct light reaching each pixel after the shadow map: n·l times the shadow term, from the same key light that lights the scene. This rule reads the lighting itself.',
    },
    rule: {
      formula: `e = max(n · l, 0) · shadow\nshelter = 1 − smoothstep(e₀ ± ${STUDY_CONSTANTS.habitatExposureSoftness}, e)\nfooting = 1 − smoothstep(slope₀ ± ${STUDY_CONSTANTS.habitatSlopeSoftness}°, slope)\nhabitat = shelter · footing`,
      summary:
        'Shadow becomes habitat. Where the sun barely reaches and the surface is flat enough to hold on, the field fills in water cyan: shade keeps moisture. Move the sun and the habitat migrates.',
    },
    output: {
      writes: 'outgoingLight',
      note: 'Runs after the lights, because it reads their result. The outline marks habitat = 0.5.',
      term: 'habitat: 1 sheltered footing, 0 exposed or too steep',
    },
    params: [
      {
        uniform: 'uSunAzimuth',
        label: 'Sun azimuth',
        min: 0,
        max: 360,
        step: 1,
        default: 170,
        digits: 0,
        unit: '°',
        tip: 'Compass direction of the key light around the specimen. Shadows and the habitat swing to the opposite side.',
      },
      {
        uniform: 'uSunElevation',
        label: 'Sun elevation',
        min: 5,
        max: 85,
        step: 1,
        default: 30,
        digits: 0,
        unit: '°',
        tip: 'Height of the key light. A low sun casts long shadows and shelters most of the form; a high sun leaves only overhangs and the lee side.',
      },
      {
        uniform: 'uHabitatExposure',
        label: 'Shelter e₀',
        min: 0.05,
        max: 0.9,
        step: 0.01,
        default: 0.3,
        digits: 2,
        tone: 'water',
        tip: 'Exposure below which a surface counts as sheltered. 0 is full shade, 1 is the sun head-on.',
      },
      {
        uniform: 'uHabitatSlope',
        label: 'Max slope',
        min: 10,
        max: 90,
        step: 1,
        default: 55,
        digits: 0,
        unit: '°',
        tip: 'Steepest face that still offers footing. Overhangs and the underside never qualify.',
      },
    ],
    legend: (values) => ({
      gradient: sampledGradient((t) => {
        const soft = STUDY_CONSTANTS.habitatExposureSoftness
        const shelter =
          1 - smoothstep(values.uHabitatExposure - soft, values.uHabitatExposure + soft, t)
        return mixHex(
          scaleHex(STUDY_COLORS.stone, 0.2 + 0.8 * t),
          scaleHex(STUDY_COLORS.habitat, STUDY_CONSTANTS.habitatGlow),
          shelter * STUDY_CONSTANTS.habitatOverlay,
        )
      }, 21),
      start: 'e 0 shade',
      end: 'e 1 full sun',
    }),
  },
  {
    id: 'growth',
    label: 'Growth',
    group: 'application',
    stage: 'fragment',
    input: {
      name: 'Growth age',
      source: 'aGrowthAge → vGrowthAge',
      note: 'Path length along the surface from where the form touches the floor, found once per geometry by walking the mesh edges (Dijkstra) and stored per vertex: 0 at the floor, 1 at the last point reached. Growth has to climb around corners and along limbs, never through the air.',
    },
    rule: {
      formula:
        'grown = age < progress\nfront = grown · (1 − smoothstep(0, w, progress − age))\nalbedo = mix(stone, grown tone, grown)\nlight = mix(lit, front tone, front)',
      summary: `Time becomes a threshold on a field. Everything the front has passed is grown, ringed every ${STUDY_CONSTANTS.growthRingSpacing} of age; the youngest band, just behind the front, stays bright. Scrub Progress to replay the process on each geometry.`,
    },
    output: {
      writes: 'diffuseColor · outgoingLight',
      note: 'The grown tone is written before lighting; the young band after it, unlit, so the front reads inside shadow too.',
      term: 'grown: 1 behind the front, 0 ahead',
    },
    params: [
      {
        uniform: 'uGrowthProgress',
        label: 'Growth progress',
        min: 0,
        max: 1,
        step: 0.005,
        default: 0.55,
        digits: 2,
        tip: 'Position of the growth front on the age field. 0 is nothing grown; 1 is the whole form.',
      },
      {
        uniform: 'uGrowthEdge',
        label: 'Edge width w',
        min: 0.005,
        max: 0.3,
        step: 0.005,
        default: 0.08,
        digits: 3,
        tip: 'Depth of the young band behind the front, in age units. Narrow gives a sharp front; wide shows the most recent growth as a soft band.',
      },
      {
        uniform: 'uGrowthShowField',
        label: 'Show field',
        min: 0,
        max: 1,
        step: 1,
        default: 0,
        digits: 0,
        options: [
          { value: 0, label: 'Off' },
          { value: 1, label: 'On' },
        ],
        tip: 'On replaces the material with the age field itself, as gray: black at the floor, white where growth arrives last. The front and rings stay on top.',
      },
    ],
    legend: (values) => {
      if (values.uGrowthShowField) {
        return { gradient: 'linear-gradient(90deg, #000000, #ffffff)', start: 'age 0 floor', end: 'age 1 last' }
      }
      const edge = Math.max(values.uGrowthEdge, 1e-3)
      return {
        gradient: sampledGradient((t) => {
          if (t > values.uGrowthProgress) {
            return STUDY_COLORS.stone
          }
          const young = 1 - smoothstep(0, edge, values.uGrowthProgress - t)
          return mixHex(STUDY_COLORS.growthGrown, STUDY_COLORS.growthFront, young * STUDY_CONSTANTS.growthFrontOverlay)
        }, 41),
        start: 'age 0 floor',
        end: 'age 1 last',
      }
    },
  },
  {
    id: 'exposure',
    label: 'Exposure',
    group: 'application',
    stage: 'fragment',
    input: {
      name: 'Sky facing + convexity',
      source: 'normalize(vStudyWorldNormal).y, aConvexity',
      note: 'Sky facing comes from the normal: 1 facing up, 0 facing down. Convexity is precomputed per geometry: how far each vertex stands proud of a smoothed copy of the form; 1 on ridges, edges and tips, 0 in crevices and inner corners.',
    },
    rule: {
      formula: `sky = (n.y + 1) / 2\ne = (sky + convexity) / 2\nw = smoothstep(1 − E, 1 − E + ${STUDY_CONSTANTS.exposureSoftness}, e) · k\nalbedo = mix(patina, bleached, w) · pits(w)\nroughness, normal = pitting(w)`,
      summary:
        'Openness becomes wear. Surfaces that face the sky and stand proud of the form take the weather: bleached, rough and pitted. Crevices and undersides keep a smooth, dark patina. The line marks e = 1 − E, where weathering begins.',
    },
    output: {
      writes: 'diffuseColor · roughness · normal',
      note: 'All before lighting, so the key light reads the pitting as texture and highlights break up on worn faces.',
      term: 'w: 0 sheltered, k fully exposed',
    },
    params: [
      {
        uniform: 'uExposure',
        label: 'Exposure E',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
        digits: 2,
        tip: 'How harsh the environment is. 0 weathers nothing; 1 weathers everything but the deepest crevices. The onset line moves down into the form as E rises.',
      },
      {
        uniform: 'uWeathering',
        label: 'Weathering strength k',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.85,
        digits: 2,
        tip: 'How far a fully exposed surface is worn: bleaching, roughness and pit depth together. 0 leaves the patina untouched.',
      },
      {
        uniform: 'uExposureShowField',
        label: 'Show field',
        min: 0,
        max: 1,
        step: 1,
        default: 0,
        digits: 0,
        options: [
          { value: 0, label: 'Off' },
          { value: 1, label: 'On' },
        ],
        tip: 'On replaces the material with the exposure field e itself, as gray: black sheltered, white exposed. Compare it with the result to read the rule.',
      },
    ],
    legend: (values) => {
      if (values.uExposureShowField) {
        return { gradient: 'linear-gradient(90deg, #000000, #ffffff)', start: 'e 0 sheltered', end: 'e 1 exposed' }
      }
      const onset = 1 - values.uExposure
      return {
        gradient: sampledGradient(
          (t) =>
            mixHex(
              STUDY_COLORS.patina,
              STUDY_COLORS.bleached,
              smoothstep(onset, onset + STUDY_CONSTANTS.exposureSoftness, t) * values.uWeathering,
            ),
          31,
        ),
        start: 'e 0 sheltered',
        end: 'e 1 exposed',
      }
    },
  },
]

export function getStudy(id: ShaderStudyId): ShaderStudy {
  const study = SHADER_STUDIES.find((item) => item.id === id)
  if (!study) {
    throw new Error(`Unknown shader study: ${id}`)
  }
  return study
}

export function defaultStudyValues(study: ShaderStudy): StudyValues {
  return Object.fromEntries(study.params.map((param) => [param.uniform, param.default]))
}

export function formatParam(param: StudyParam, value: number): string {
  const option = param.options?.find((item) => item.value === value)
  if (option) {
    return option.label
  }
  if (value === 0 && param.zeroLabel) {
    return param.zeroLabel
  }
  return `${value.toFixed(param.digits)}${param.unit ?? ''}`
}
