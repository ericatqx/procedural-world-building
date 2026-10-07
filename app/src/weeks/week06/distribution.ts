import { CELL, cellCenter, GRID_SIZE, sampleGrid } from '../../project/grid.ts'
import { dailyInsolation, type Solid } from '../../project/light.ts'
import { simplex2 } from '../../shared/noise/simplex.ts'
import { hasFooting, massFootprints, structureMass, type Block } from './structureForms.ts'
import { createStudyTerrain, isWaterAt, STUDY_HALF, type StudyTerrain } from './studyTerrain.ts'

/**
 * Week 06 — Distribution: scattering three asset layers over a study
 * terrain. Every layer runs the same pipeline:
 *
 *   seeded candidates → valid ground? → weight (method) → accept with
 *   probability = weight, keeping spacing → until the layer's count is reached
 *
 * Validity and weight are separate. Valid ground is a hard rule shared by
 * every method: on the block, off the water unless the layer allows it,
 * footing under a structure's whole footprint (see `hasFooting`), and
 * outside structure footprints for the layers placed after structures.
 * The method only changes the weight: Random gives every candidate 1, Noise
 * reads coherent noise, Environment reads the world's fields through the
 * layer's preferences. Preferences are soft: each scales the weight down,
 * never to zero.
 */

export type Method = 'random' | 'noise' | 'environment'
export type LayerId = 'structures' | 'vegetation' | 'colonies'
export type FieldId = 'elevation' | 'slope' | 'moisture' | 'light' | 'waterside' | 'weight'

export const METHODS: readonly Method[] = ['random', 'noise', 'environment']
/** Placement order: later layers read the earlier ones (footprints, shade). */
export const LAYERS: readonly LayerId[] = ['structures', 'vegetation', 'colonies']
export const FIELDS: readonly FieldId[] = ['elevation', 'slope', 'moisture', 'light', 'waterside', 'weight']

/** Noon sun height for the daily light field, the Project's starting season. */
export const NOON_ELEVATION = 60
/** Candidates drawn per requested point; more lets selective weights still reach the count. */
export const OVERSAMPLE = 12
/** Smallest candidate pool, so a layer of a few points can still reach its count. */
export const MIN_POOL = 600
/** Candidates stay inside this share of the block's half-width, clear of the cut edge. */
const RIM = 0.97
/** Beyond the slope limit a candidate keeps this share of its weight. */
const SLOPE_FLOOR = 0.1
/** The least a factor keeps at full preference strength, so no preference excludes ground. */
export const PREFERENCE_FLOOR = 0.1
/** Slope that maps to 1 in the slope field view. */
export const SLOPE_DISPLAY_MAX = 45
/** Distance over which the waterside field falls from 1 at the shore toward 0, world units. */
const WATERSIDE_RANGE = 0.3
/** Two broad octaves: blob-like patches with uneven edges, not fine speckle. */
const NOISE_OCTAVES = 2
const NOISE_GAIN = 0.45
/** Half-width of the patch edge, in coverage, at Edge = 1. */
const NOISE_EDGE_SPAN = 0.16

/** Analysis drawing: the field stays dim so marks read on top of it. */
export const ANALYSIS_COLORS = {
  fieldLow: '#101010',
  fieldHigh: '#77746d',
  cliff: '#1a1a19',
  /** Ground that is not valid for the layer: water, unless the layer allows it. */
  invalid: '#0f1733',
  /** Accepted points of the layer under analysis: the active state. */
  accepted: '#ff4a1c',
  /** Accepted points of the other layers. */
  otherAccepted: '#e9e6df',
  rejected: '#d9d6cf',
  inactive: '#5c5a55',
} as const

/** Asset sizes in world units at scale 1. Structures are sized in modules: see structureForms.ts. */
export const PLANT_HEIGHT = 0.18
export const COLONY_RADIUS = 0.2

export type LayerSettings = {
  enabled: boolean
  /** Target number of points. */
  count: number
  seed: number
  /** Minimum distance between two points of this layer. */
  spacing: number
  /** Random scale range: 1 ± variation. */
  scaleVariation: number
  /** Valid ground: whether lakes and rivers count. A hard rule, for every method. */
  onWater: boolean
  /** Noise: wavelength of the patches, world units. */
  clusterSize: number
  /** Noise: share of the layer's valid ground inside the patches. */
  coverage: number
  /** Noise: 0 is a hard patch edge, 1 a wide soft falloff. */
  edge: number
  /** Environment preferences, −1…1: which end of each field is preferred, and how strongly. */
  elevation: number
  moisture: number
  light: number
  waterside: number
  /** Environment: slope (degrees) where the weight has fallen to SLOPE_FLOOR. */
  maxSlope: number
}

export type LayerSettingsMap = Record<LayerId, LayerSettings>

type Range = { min: number; max: number; step: number }

export const LAYER_INFO: Record<
  LayerId,
  { label: string; note: string; count: Range; spacing: Range; salt: number }
> = {
  structures: {
    label: 'Structures',
    note: 'Compact masses in the Project’s block grammar: stepped blocks, walls, cantilevers and gates. Placed first: their footprints block, and their shade darkens, the ground the other layers read.',
    count: { min: 0, max: 120, step: 1 },
    spacing: { min: 0.2, max: 1, step: 0.01 },
    salt: 1,
  },
  vegetation: {
    label: 'Vegetation',
    note: 'Clumps of the Project’s plant forms, which answer moisture and light where they stand: the broad cover of the ground.',
    count: { min: 0, max: 600, step: 5 },
    spacing: { min: 0.03, max: 0.3, step: 0.01 },
    salt: 2,
  },
  colonies: {
    label: 'Colonies',
    note: 'Sparse, low formations of dots on the ground: blooms, crescents and drifts. Placed last, so they can find the shade the structures cast.',
    count: { min: 0, max: 200, step: 1 },
    spacing: { min: 0.1, max: 1, step: 0.01 },
    salt: 3,
  },
}

export type PreferenceKey = 'elevation' | 'moisture' | 'light' | 'waterside'

/**
 * The environmental factors each layer reads in Environment; the others stay
 * neutral (factor 1). Structures look for footing, light and the water's
 * edge, as the Project's architecture does; vegetation for water and light on
 * ground that holds soil; colonies only for shelter and damp, on any slope.
 */
export const LAYER_FACTORS: Record<LayerId, { preferences: readonly PreferenceKey[]; slope: boolean }> = {
  structures: { preferences: ['elevation', 'waterside', 'light'], slope: true },
  vegetation: { preferences: ['moisture', 'waterside', 'light'], slope: true },
  colonies: { preferences: ['moisture', 'light'], slope: false },
}
/** A slope limit no ground reaches: the slope factor stays 1. */
const NO_SLOPE_LIMIT = 180

/** The settings as Environment reads them: factors the layer does not read set neutral. */
export function environmentSettings(layer: LayerId, settings: LayerSettings): LayerSettings {
  const { preferences, slope } = LAYER_FACTORS[layer]
  const read = (key: PreferenceKey) => (preferences.includes(key) ? settings[key] : 0)
  return {
    ...settings,
    elevation: read('elevation'),
    moisture: read('moisture'),
    light: read('light'),
    waterside: read('waterside'),
    maxSlope: slope ? settings.maxSlope : NO_SLOPE_LIMIT,
  }
}

export const SHARED_RANGES = {
  seed: { min: 1, max: 999, step: 1 },
  scaleVariation: { min: 0, max: 0.8, step: 0.05 },
  clusterSize: { min: 0.4, max: 3, step: 0.05 },
  coverage: { min: 0.1, max: 0.9, step: 0.05 },
  edge: { min: 0, max: 1, step: 0.05 },
  preference: { min: -1, max: 1, step: 0.05 },
  maxSlope: { min: 5, max: 45, step: 1 },
} as const

export const DEFAULT_LAYERS: LayerSettingsMap = {
  structures: {
    enabled: true,
    count: 40,
    seed: 7,
    spacing: 0.45,
    scaleVariation: 0.35,
    onWater: false,
    clusterSize: 1.8,
    coverage: 0.25,
    edge: 0.15,
    elevation: 0.2,
    moisture: 0,
    light: 0.7,
    waterside: 0.3,
    maxSlope: 22,
  },
  vegetation: {
    enabled: true,
    count: 280,
    seed: 11,
    spacing: 0.08,
    scaleVariation: 0.4,
    onWater: false,
    clusterSize: 1.3,
    coverage: 0.22,
    edge: 0.15,
    elevation: 0,
    moisture: 0.7,
    light: 0.5,
    waterside: 0.5,
    maxSlope: 26,
  },
  colonies: {
    enabled: true,
    count: 50,
    seed: 23,
    spacing: 0.3,
    scaleVariation: 0.35,
    onWater: false,
    clusterSize: 1.1,
    coverage: 0.2,
    edge: 0.15,
    elevation: 0,
    moisture: 0.5,
    light: -0.9,
    waterside: 0,
    maxSlope: 40,
  },
}

/** The world's fields on the Project's analysis grid. Static: read from the terrain once. */
export type Environment = {
  terrain: StudyTerrain
  /** 0…1, lowest to highest ground on the block. */
  elevation: Float32Array
  /** Degrees. */
  slope: Float32Array
  /** 0…1: near water, or low lying. */
  moisture: Float32Array
  /** 1 under the lake and channel, 0 on land: the validity mask, not a preference. */
  water: Float32Array
  /** 0…1, closeness to the nearest water: 1 at the shore. */
  waterside: Float32Array
  /** Daily sunlight relative to open flat ground, terrain shadows only. */
  light: Float32Array
}

/** Ground slope in degrees per grid cell, from central differences of the height. */
function groundSlopes(terrain: StudyTerrain): Float32Array {
  const step = CELL / 2
  const slope = new Float32Array(GRID_SIZE * GRID_SIZE)
  for (let index = 0; index < slope.length; index += 1) {
    if (terrain.inside[index]) {
      const [x, z] = cellCenter(index)
      const h = terrain.groundHeight
      const dx = (h(x + step, z) - h(x - step, z)) / (2 * step)
      const dz = (h(x, z + step) - h(x, z - step)) / (2 * step)
      slope[index] = (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI
    }
  }
  return slope
}

export function createEnvironment(): Environment {
  const terrain = createStudyTerrain()
  const { inside, ground } = terrain
  const count = GRID_SIZE * GRID_SIZE
  let low = Infinity
  let high = -Infinity
  for (let index = 0; index < count; index += 1) {
    if (inside[index]) {
      low = Math.min(low, ground.heights[index]!)
      high = Math.max(high, ground.heights[index]!)
    }
  }
  const elevation = new Float32Array(count)
  const waterside = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    if (inside[index]) {
      elevation[index] = (ground.heights[index]! - low) / (high - low)
      waterside[index] = Math.exp(-terrain.waterDistance[index]! / WATERSIDE_RANGE)
    }
  }
  return {
    terrain,
    elevation,
    slope: groundSlopes(terrain),
    moisture: terrain.moisture,
    water: terrain.water01,
    waterside,
    light: dailyInsolation(ground, inside, null, NOON_ELEVATION),
  }
}

export type CandidateStatus =
  /** Placed. */
  | 'accepted'
  /** Lost the weighted draw. */
  | 'rejected'
  /** Won the draw but stood too close to a placed point. */
  | 'spacing'
  /** Not valid ground for the layer: on water. */
  | 'invalid'
  /** A structure without footing: past the block's edge, over a cliff or in the water. */
  | 'unsupported'
  /** Inside a structure footprint. */
  | 'blocked'
  /** Drawn after the count was reached. */
  | 'unused'

export type Candidate = {
  x: number
  z: number
  weight: number
  status: CandidateStatus
  /** Size multiplier, 1 ± scale variation. */
  scale: number
  /** Rotation about the vertical, radians. */
  turn: number
  /** 0…1, for per-instance variety. */
  variety: number
}

export type Placement = {
  candidates: Candidate[]
  accepted: Candidate[]
  /** The weight on every grid cell, 0 off valid ground, for the Analysis view. */
  weightField: Float32Array
  /** The light this layer read: terrain only for structures, with structure shade after. */
  lightField: Float32Array
}

/** Footprints of placed structures, which later layers cannot stand inside. */
export type Blocker = { x0: number; x1: number; z0: number; z1: number }

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** Valid ground for a layer at a point on the block: the hard rule, before any weight. */
const isValid = (settings: LayerSettings, x: number, z: number) => settings.onWater || !isWaterAt(x, z)

/**
 * A bipolar preference: `match` is how well the ground matches the preferred
 * end (0…1), `preference` how much that matters. The factor never falls
 * below 1 − 0.9·|preference|, so a preference shifts weight rather than
 * excluding ground.
 */
export function preferenceFactor(preference: number, value: number): number {
  const match = preference >= 0 ? value : 1 - value
  return 1 - (1 - PREFERENCE_FLOOR) * Math.abs(preference) * (1 - match)
}

export const slopeFactor = (maxSlope: number, slope: number) =>
  1 - (1 - SLOPE_FLOOR) * smoothstep(0.5 * maxSlope, maxSlope, slope)

export type FieldSample = {
  elevation: number
  slope: number
  moisture: number
  light: number
  waterside: number
}

/** Raw environmental suitability: the product of the layer's soft factors. */
export function suitability(settings: LayerSettings, sample: FieldSample): number {
  return (
    preferenceFactor(settings.elevation, sample.elevation) *
    slopeFactor(settings.maxSlope, sample.slope) *
    preferenceFactor(settings.moisture, sample.moisture) *
    preferenceFactor(settings.light, clamp01(sample.light)) *
    preferenceFactor(settings.waterside, sample.waterside)
  )
}

/** Coherent noise for the Noise method: broad fbm of simplex, offset by the seed. About −1…1. */
function noiseValue(settings: LayerSettings, salt: number, x: number, z: number): number {
  const ox = ((settings.seed * 12.9898 + salt * 31.7) % 97) + 11
  const oz = ((settings.seed * 78.233 + salt * 17.3) % 89) + 23
  let sum = 0
  let total = 0
  let amplitude = 1
  let frequency = 1 / settings.clusterSize
  for (let octave = 0; octave < NOISE_OCTAVES; octave += 1) {
    sum += amplitude * simplex2(x * frequency + ox, z * frequency + oz)
    total += amplitude
    amplitude *= NOISE_GAIN
    frequency *= 2
  }
  return sum / total
}

/**
 * Noise turned into a weight by rank: a value's share of the layer's valid
 * ground with lower noise. Thresholding the rank at 1 − coverage makes
 * coverage exact whatever the noise's range, so patches and empty ground are
 * both guaranteed; Edge widens the band where the weight ramps from 0 to 1.
 */
class NoiseRanks {
  private readonly sorted: Float32Array
  private readonly threshold: number
  private readonly band: number

  constructor(values: Float32Array, settings: LayerSettings) {
    this.sorted = values.slice().sort()
    this.threshold = 1 - settings.coverage
    this.band = 0.005 + NOISE_EDGE_SPAN * settings.edge
  }

  weight(value: number): number {
    const { sorted } = this
    if (sorted.length === 0) {
      return 0
    }
    let lo = 0
    let hi = sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid]! < value) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    const rank = lo / sorted.length
    return smoothstep(this.threshold - this.band, this.threshold + this.band, rank)
  }
}

function sampleFields(env: Environment, light: Float32Array, x: number, z: number): FieldSample {
  return {
    elevation: sampleGrid(env.elevation, x, z),
    slope: sampleGrid(env.slope, x, z),
    moisture: sampleGrid(env.moisture, x, z),
    light: sampleGrid(light, x, z),
    waterside: sampleGrid(env.waterside, x, z),
  }
}

/**
 * The weight on every valid grid cell (0 elsewhere), and the scorer for
 * candidates. Environment is normalised so the best valid ground is 1; Noise
 * is ranked over the valid ground.
 */
function weighting(
  env: Environment,
  layer: LayerId,
  settings: LayerSettings,
  method: Method,
  light: Float32Array,
): { field: Float32Array; weightAt: (x: number, z: number) => number } {
  const { inside } = env.terrain
  const salt = LAYER_INFO[layer].salt
  const field = new Float32Array(GRID_SIZE * GRID_SIZE)
  const valid: number[] = []
  for (let index = 0; index < field.length; index += 1) {
    if (inside[index] && (settings.onWater || !env.water[index])) {
      valid.push(index)
    }
  }

  if (method === 'random') {
    for (const index of valid) {
      field[index] = 1
    }
    return { field, weightAt: () => 1 }
  }

  if (method === 'noise') {
    const values = new Float32Array(valid.length)
    valid.forEach((index, k) => {
      const [x, z] = cellCenter(index)
      values[k] = noiseValue(settings, salt, x, z)
    })
    const ranks = new NoiseRanks(values, settings)
    valid.forEach((index, k) => {
      field[index] = ranks.weight(values[k]!)
    })
    return { field, weightAt: (x, z) => ranks.weight(noiseValue(settings, salt, x, z)) }
  }

  const read = environmentSettings(layer, settings)
  let max = 0
  for (const index of valid) {
    const value = suitability(read, {
      elevation: env.elevation[index]!,
      slope: env.slope[index]!,
      moisture: env.moisture[index]!,
      light: light[index]!,
      waterside: env.waterside[index]!,
    })
    field[index] = value
    max = Math.max(max, value)
  }
  const scale = max > 0 ? 1 / max : 1
  for (const index of valid) {
    field[index]! *= scale
  }
  return {
    field,
    weightAt: (x, z) => Math.min(1, suitability(read, sampleFields(env, light, x, z)) * scale),
  }
}

/** Points within `spacing` of each other, found through a uniform hash grid. */
class SpacingGrid {
  private cells = new Map<string, Candidate[]>()
  private readonly spacing: number

  constructor(spacing: number) {
    this.spacing = spacing
  }

  private key(i: number, j: number) {
    return `${i},${j}`
  }

  isClear(x: number, z: number): boolean {
    const i = Math.floor(x / this.spacing)
    const j = Math.floor(z / this.spacing)
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let di = -1; di <= 1; di += 1) {
        for (const other of this.cells.get(this.key(i + di, j + dj)) ?? []) {
          if (Math.hypot(other.x - x, other.z - z) < this.spacing) {
            return false
          }
        }
      }
    }
    return true
  }

  add(point: Candidate) {
    const key = this.key(Math.floor(point.x / this.spacing), Math.floor(point.z / this.spacing))
    const list = this.cells.get(key) ?? []
    list.push(point)
    this.cells.set(key, list)
  }
}

/**
 * Scatters one layer. Each candidate draws the same six random numbers in
 * the same order whatever happens to it, so candidate k is identical for a
 * given seed: raising the count only adds points, and the same settings
 * always give the same placement.
 */
export function placeLayer(
  env: Environment,
  layer: LayerId,
  settings: LayerSettings,
  method: Method,
  light: Float32Array,
  blockers: readonly Blocker[],
): Placement {
  const info = LAYER_INFO[layer]
  const random = mulberry32(settings.seed * 7919 + info.salt * 104729)
  const { field, weightAt } = weighting(env, layer, settings, method, light)
  const { groundHeight } = env.terrain
  const supported =
    layer === 'structures'
      ? (c: Candidate) => hasFooting(groundHeight, structureMass(groundHeight, c), settings.onWater)
      : () => true
  const spacing = new SpacingGrid(settings.spacing)
  const candidates: Candidate[] = []
  const accepted: Candidate[] = []
  const pool = settings.count > 0 ? Math.max(MIN_POOL, settings.count * OVERSAMPLE) : 0

  const reach = STUDY_HALF * RIM
  for (let k = 0; k < pool; k += 1) {
    const x = reach * (2 * random() - 1)
    const z = reach * (2 * random() - 1)
    const draw = random()
    const scale = 1 + settings.scaleVariation * (2 * random() - 1)
    const turn = random() * 2 * Math.PI
    const variety = random()

    const valid = isValid(settings, x, z)
    const weight = valid ? weightAt(x, z) : 0
    const candidate: Candidate = { x, z, weight, status: 'unused', scale, turn, variety }
    candidates.push(candidate)
    if (accepted.length >= settings.count) {
      continue
    }
    if (!valid) {
      candidate.status = 'invalid'
    } else if (!supported(candidate)) {
      candidate.status = 'unsupported'
    } else if (blockers.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1)) {
      candidate.status = 'blocked'
    } else if (draw >= weight) {
      candidate.status = 'rejected'
    } else if (!spacing.isClear(x, z)) {
      candidate.status = 'spacing'
    } else {
      candidate.status = 'accepted'
      spacing.add(candidate)
      accepted.push(candidate)
    }
  }

  return { candidates, accepted, weightField: field, lightField: light }
}

/** The structures' blocks as a solid for the light trace, so later layers see their shade. */
export function structureSolid(env: Environment, structures: readonly Candidate[]): Solid {
  const cell = 0.25
  const cells = new Map<string, Block[]>()
  let top = -Infinity
  for (const s of structures) {
    for (const block of structureMass(env.terrain.groundHeight, s).blocks) {
      top = Math.max(top, block.y1)
      for (let j = Math.floor(block.z0 / cell); j <= Math.floor(block.z1 / cell); j += 1) {
        for (let i = Math.floor(block.x0 / cell); i <= Math.floor(block.x1 / cell); i += 1) {
          const key = `${i},${j}`
          const list = cells.get(key) ?? []
          list.push(block)
          cells.set(key, list)
        }
      }
    }
  }
  return {
    top,
    isSolid: (x, y, z) => {
      if (y > top) {
        return false
      }
      for (const b of cells.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []) {
        if (y >= b.y0 && y <= b.y1 && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) {
          return true
        }
      }
      return false
    },
  }
}

/** Daily light with the placed structures' shade, for the layers placed after them. */
export function shadedLight(env: Environment, structures: readonly Candidate[]): Float32Array {
  if (structures.length === 0) {
    return env.light
  }
  return dailyInsolation(env.terrain.ground, env.terrain.inside, structureSolid(env, structures), NOON_ELEVATION)
}

/** How many candidates the pipeline worked through: every one drawn before the count was reached. */
export function processedCount(placement: Placement): number {
  const first = placement.candidates.findIndex((c) => c.status === 'unused')
  return first < 0 ? placement.candidates.length : first
}

/**
 * The placement as it stood after its first `steps` candidates. Each
 * candidate's outcome depends only on the ones before it, so this is the
 * same run stopped early, and running it to the end gives the full result.
 */
export function placementAt(placement: Placement, steps: number): Placement {
  if (steps >= processedCount(placement)) {
    return placement
  }
  const candidates = placement.candidates.slice(0, Math.max(0, steps))
  return { ...placement, candidates, accepted: candidates.filter((c) => c.status === 'accepted') }
}

/** The structures' grounded footprints, which vegetation and colonies cannot stand inside. */
export const structureBlockers = (env: Environment, structures: readonly Candidate[]): Blocker[] =>
  structures.flatMap((s) => massFootprints(structureMass(env.terrain.groundHeight, s)))

/** A field as 0…1 per grid cell, for drawing. */
export function fieldValues(env: Environment, field: FieldId, placement: Placement): Float32Array {
  switch (field) {
    case 'elevation':
      return env.elevation
    case 'slope':
      return env.slope.map((slope) => clamp01(slope / SLOPE_DISPLAY_MAX))
    case 'moisture':
      return env.moisture
    case 'light':
      return placement.lightField.map(clamp01)
    case 'waterside':
      return env.waterside
    case 'weight':
      return placement.weightField
  }
}
