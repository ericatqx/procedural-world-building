import { clamp01, smoothstep } from '../project02/core.ts'
import { LAND_EXTENT, LANDFORM_02 } from '../project02/landform.ts'
import { perlin2 } from '../shared/noise/perlin.ts'
import { simplex2 } from '../shared/noise/simplex.ts'
import type { NoiseLayer, NoiseType, ShapingType } from '../shared/noise/types.ts'

/**
 * Shadow Ecology 0.3 — a bounded landscape in meters.
 * `size` is the field width and depth. It stays divisible by `chunkSize`,
 * and `chunkSize` stays divisible by every lod step, so neighboring chunks
 * share edge samples exactly.
 */
export const LANDSCAPE = {
  size: 4096,
  chunkSize: 128,
  /**
   * Vertex spacing in meters. Each step divides the chunk and the one before
   * it, so a coarser neighbor can share an edge exactly. The 2 m step is
   * only used at Ultra, near the camera.
   */
  lodStep: [2, 4, 8, 16, 32] as const,
}

export type LandscapeConfig = typeof LANDSCAPE

export const DETAIL_LEVELS = ['low', 'medium', 'high', 'ultra'] as const
export type DetailLevel = (typeof DETAIL_LEVELS)[number]

/**
 * Distance thresholds for lod 0..3. Every level ends at 16 m, so a far ridge
 * keeps close to its true height; the 32 m step stays available to
 * `lodStep` but is not selected. A 0 never matches, so that level is skipped.
 * High is the 4 m field.
 */
const DETAIL_BANDS: Record<DetailLevel, readonly [number, number, number, number]> = {
  low: [0, 0, 0, Infinity],
  medium: [0, 0, 900, Infinity],
  high: [0, 640, 1600, Infinity],
  ultra: [380, 1100, 2400, Infinity],
}

const LODS = LANDSCAPE.lodStep.length

/** Lod index for a chunk whose center is `distance` meters from the camera. */
export function lodForDistance(distance: number, detail: DetailLevel = 'high'): number {
  const bands = DETAIL_BANDS[detail]
  for (let lod = 0; lod < bands.length; lod += 1) {
    if (distance < bands[lod]) return lod
  }
  return LANDSCAPE.lodStep.length - 1
}

/** How far the finest spacing of this detail reaches, used to keep the place underfoot. */
export function detailReach(detail: DetailLevel): number {
  const bands = DETAIL_BANDS[detail]
  for (let lod = 0; lod < bands.length; lod += 1) {
    if (bands[lod] > 0) return bands[lod]
  }
  return 900
}

export function chunksAcross(config: LandscapeConfig = LANDSCAPE): number {
  return Math.round(config.size / config.chunkSize)
}

/** World origin (minimum x, z) of chunk column (ix, iz). */
export function chunkOrigin(ix: number, iz: number, config: LandscapeConfig = LANDSCAPE): [number, number] {
  const half = config.size * 0.5
  return [-half + ix * config.chunkSize, -half + iz * config.chunkSize]
}

let coastChunks: Uint8Array | null = null

/** True for a chunk the island outline passes through. */
export function isCoastChunk(ix: number, iz: number): boolean {
  const n = chunksAcross()
  if (!coastChunks) {
    coastChunks = new Uint8Array(n * n)
    const size = LANDSCAPE.chunkSize
    for (let cz = 0; cz < n; cz += 1) {
      for (let cx = 0; cx < n; cx += 1) {
        const [ox, oz] = chunkOrigin(cx, cz)
        let inside = 0
        let outside = 0
        for (let j = 0; j <= 8; j += 1) {
          for (let i = 0; i <= 8; i += 1) {
            const x = ox + (i / 8) * size
            const z = oz + (j / 8) * size
            if (Math.hypot(x, z) <= islandRadius(Math.atan2(z, x))) inside += 1
            else outside += 1
          }
        }
        if (inside > 0 && outside > 0) coastChunks[cx + cz * n] = 1
      }
    }
  }
  return coastChunks[ix + iz * n] === 1
}

/**
 * The coast is meshed finely whatever the distance. A 4 m cell follows the
 * outline closely, so the ground ends where the cliff begins.
 */
export function coastLod(_detail: DetailLevel): number {
  return 1
}

/**
 * Meters per 0.2 landform unit, so the outline fills the 4 km field with the
 * same margin it has inside 0.2's extent. Vertical shell distances use this
 * too; the top surface stays the 0.3 height field.
 */
export const ISLAND_METERS_PER_UNIT = (LANDSCAPE.size * 0.5) / LAND_EXTENT

/** 0.2's outline, in meters. */
export function islandRadius(angle: number): number {
  return LANDFORM_02.outlineRadius(angle) * ISLAND_METERS_PER_UNIT
}

/** Same integer always rebuilds the same land. */
export const DEFAULT_TERRAIN_SEED = 12041

export type TerrainLayer = NoiseLayer & { name: string }

/** Tallest massif above the basement, in meters. */
const MASSIF_MAX = 420
/** Share of a massif's height that its ridge network can carve away. */
const RIDGE_SHARE = 0.62

/**
 * The layers that build the height, largest landform first.
 * Frequency is cycles across the 4 km field. Amplitude is meters.
 * Weight is how much of that layer reaches the ground.
 *
 *   highland  jittered cells, one massif or none per cell, each its own
 *             height, width, and heading, bent by a large domain warp
 *   ridges    ridged multifractal. Each octave branches only where the one
 *             before it stands high, so ranges split into spurs
 *   hills     rolling ground, strongest on the skirts of the massifs
 *   drainage  the same ridged hierarchy inverted: a branching channel
 *             network cut into skirts and lowlands
 *   detail    a few meters of grain
 */
export const TERRAIN_LAYERS: readonly TerrainLayer[] = [
  {
    id: 'highland',
    name: 'Highland regions',
    enabled: true,
    noiseType: 'cellular',
    frequency: 3.7,
    amplitude: MASSIF_MAX,
    weight: 1,
    shaping: 'domainWarp',
    shapingParam: 300,
  },
  {
    id: 'ridges',
    name: 'Mountain network',
    enabled: true,
    noiseType: 'perlin',
    frequency: 5.4,
    amplitude: Math.round(MASSIF_MAX * RIDGE_SHARE),
    weight: RIDGE_SHARE,
    shaping: 'ridged',
    shapingParam: 5,
  },
  {
    id: 'hills',
    name: 'Hills and valleys',
    enabled: true,
    noiseType: 'simplex',
    frequency: 10.8,
    amplitude: 56,
    weight: 1,
    shaping: 'none',
    shapingParam: 3,
  },
  {
    id: 'drainage',
    name: 'Drainage network',
    enabled: true,
    noiseType: 'perlin',
    frequency: 4.5,
    amplitude: 42,
    weight: 1,
    shaping: 'ridged',
    shapingParam: 3,
  },
  {
    id: 'detail',
    name: 'Surface detail',
    enabled: true,
    noiseType: 'simplex',
    frequency: 74,
    amplitude: 3,
    weight: 1,
    shaping: 'none',
    shapingParam: 2,
  },
]

const HIGHLAND = TERRAIN_LAYERS[0]!
const RIDGES = TERRAIN_LAYERS[1]!
const HILLS = TERRAIN_LAYERS[2]!
const DRAINAGE = TERRAIN_LAYERS[3]!
const DETAIL = TERRAIN_LAYERS[4]!

const TAU = Math.PI * 2

type Massif = { x: number; z: number; c: number; s: number; a: number; b: number; h: number; reach: number }
type SeedField = { seed: number; cos: number; sin: number; o: number[]; massifs: Massif[] }

function mixBits(value: number): number {
  let x = value | 0
  x = Math.imul(x ^ (x >>> 16), 2246822519)
  x = Math.imul(x ^ (x >>> 13), 3266489917)
  return (x ^ (x >>> 16)) >>> 0
}

/** A repeatable number in [0, 1) for these integers. */
function hash01(a: number, b: number, c: number, d: number, e: number): number {
  let h = mixBits(a + 0x9e3779b9)
  h = mixBits(h ^ (b + 0x7f4a7c15))
  h = mixBits(h ^ (c + 0x165667b1))
  h = mixBits(h ^ (d + 0x27d4eb2f))
  h = mixBits(h ^ (e + 0x85ebca6b))
  return h / 4294967296
}

/**
 * One massif per cell with some probability. The grid is turned by the seed,
 * and every centre is jittered, so the groups sit irregularly.
 */
function placeMassifs(seed: number, attempt: number): Massif[] {
  const cell = LANDSCAPE.size / HIGHLAND.frequency
  const massifs: Massif[] = []
  for (let iz = -4; iz <= 4; iz += 1) {
    for (let ix = -4; ix <= 4; ix += 1) {
      const r = (k: number) => hash01(seed, attempt, ix, iz, k)
      if (r(0) > 0.74) continue
      const x = (ix + 0.5 + (r(1) - 0.5) * 0.82) * cell
      const z = (iz + 0.5 + (r(2) - 0.5) * 0.82) * cell
      if (Math.hypot(x, z) > LANDSCAPE.size * 0.6) continue
      const h = HIGHLAND.amplitude * HIGHLAND.weight * (0.3 + 0.7 * r(3) ** 1.3)
      const radius = cell * (0.4 + 0.28 * r(4))
      const aspect = Math.sqrt(1 + 0.6 * r(5))
      const heading = r(6) * TAU
      const a = radius * aspect
      massifs.push({ x, z, c: Math.cos(heading), s: Math.sin(heading), a, b: radius / aspect, h, reach: a * 1.02 })
    }
  }
  return massifs
}

/** Several groups, none alone in charge: that is the organization the layers share. */
function acceptable(massifs: Massif[], cos: number, sin: number): boolean {
  const inside = massifs.filter((m) => {
    const wx = m.x * cos + m.z * sin
    const wz = -m.x * sin + m.z * cos
    return Math.hypot(wx, wz) < islandRadius(Math.atan2(wz, wx)) * 0.82
  })
  if (inside.length < 4 || inside.length > 7) return false
  const tallest = Math.max(...inside.map((m) => m.h))
  const comparable = inside.filter((m) => m.h > tallest * 0.62).length
  return comparable >= 2 && comparable <= 4
}

function seedField(seed: number): SeedField {
  const angle = hash01(seed, 7, 1, 2, 3) * TAU
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const o: number[] = []
  for (let i = 0; i < 16; i += 1) o.push(hash01(seed, 11, i, 5, 9) * 300)
  let massifs: Massif[] = []
  for (let attempt = 0; attempt < 24; attempt += 1) {
    massifs = placeMassifs(seed, attempt)
    if (acceptable(massifs, cos, sin)) break
  }
  return { seed, cos, sin, o, massifs }
}

let field = seedField(DEFAULT_TERRAIN_SEED)

export function terrainSeed(): number {
  return field.seed
}

/** Offsets and turns the noise domain. The shared permutation tables stay as they are. */
export function setTerrainSeed(seed: number): void {
  const next = Number.isFinite(seed) ? seed | 0 : DEFAULT_TERRAIN_SEED
  if (next !== field.seed) field = seedField(next)
}

/** Fractal sum of simplex noise, about [-1, 1]. */
function fbm(x: number, z: number, octaves: number, ox: number, oz: number, gain = 0.5): number {
  let sum = 0
  let norm = 0
  let amplitude = 1
  let px = x + ox
  let pz = z + oz
  for (let i = 0; i < octaves; i += 1) {
    sum += simplex2(px, pz) * amplitude
    norm += amplitude
    amplitude *= gain
    const rx = px * 0.8 - pz * 0.6
    pz = (px * 0.6 + pz * 0.8) * 2.03
    px = rx * 2.03
  }
  return sum / norm
}

/**
 * Ridged multifractal, 0 in the valleys to about 1 on the crests. Each octave
 * is turned and weighted by the one before it, so fine ridges grow only on
 * coarse ones. Crests are rounded by the square root, and finer octaves stay
 * at their mean away from the main crests.
 */
function ridged(x: number, z: number, octaves: number, ox: number, oz: number): number {
  let px = x + ox
  let pz = z + oz
  let sum = 0
  let norm = 0
  let amplitude = 1
  let weight = 1
  let crest = 1
  for (let i = 0; i < octaves; i += 1) {
    const n = perlin2(px + i * 17.3, pz - i * 9.1) * 1.3
    let signal = Math.max(0, 1 - Math.sqrt(n * n + 0.02)) ** 1.5
    signal *= weight
    weight = clamp01(0.3 + signal * 1.6)
    if (i === 0) crest = smoothstep(0.22, 0.7, signal)
    const detail = i === 0 ? signal : 0.49 + (signal - 0.49) * crest
    sum += detail * amplitude
    norm += amplitude
    amplitude *= 0.58
    const rx = px * 0.8 - pz * 0.6
    pz = (px * 0.6 + pz * 0.8) * 2.03
    px = rx * 2.03
  }
  return sum / norm
}

/** Every term of the last height evaluated. The preview reads it back. */
const parts = { mass: 0, ridge: 0, hills: 0, drain: 0, detail: 0, height: 0 }

function evaluate(x: number, z: number, config: LandscapeConfig): void {
  const f = field
  const o = f.o
  const span = config.size
  const px = x * f.cos - z * f.sin
  const pz = x * f.sin + z * f.cos
  const warp = HIGHLAND.shapingParam
  const qx = px + simplex2(px / 1900 + o[0]!, pz / 1900 + o[1]!) * warp + simplex2(px / 560 + o[4]!, pz / 560 + o[5]!) * 55
  const qz = pz + simplex2(px / 1900 + o[2]!, pz / 1900 + o[3]!) * warp + simplex2(px / 560 + o[6]!, pz / 560 + o[7]!) * 55

  const angle = Math.atan2(z, x)
  const t = Math.min(1, Math.hypot(x, z) / islandRadius(angle))

  // Highland regions: the massifs blend as a soft maximum, so two that touch
  // meet in a saddle rather than a sum.
  // The shoulders and summits of a massif are modulated by a broad field, so
  // each rises to uneven crests and secondary summits instead of one cone.
  const lobes = 0.74 + 0.55 * fbm(qx / 520 + o[4]!, qz / 520 + o[5]!, 2, 3.1, 7.7)
  let acc = 0
  for (const m of f.massifs) {
    const dx = qx - m.x
    const dz = qz - m.z
    if (dx > m.reach || dx < -m.reach || dz > m.reach || dz < -m.reach) continue
    const u = (dx * m.c + dz * m.s) / m.a
    const v = (-dx * m.s + dz * m.c) / m.b
    const d2 = u * u + v * v
    if (d2 >= 1) continue
    const k = 1 - d2
    const value = m.h * k ** 1.3 * Math.max(0.35, Math.min(1.15, lobes))
    acc += value * value * value
  }
  const mass = Math.cbrt(acc) * (1 - 0.8 * smoothstep(0.6, 1, t))

  // Mountain network: the massif's height is cut into ridges and valleys.
  const ridgeRaw = ridged(qx / (span / RIDGES.frequency), qz / (span / RIDGES.frequency), RIDGES.shapingParam, o[8]!, o[9]!)
  const ridge = clamp01((ridgeRaw - 0.24) / 0.5)
  const relief = mass * (1 - RIDGES.weight + RIDGES.weight * ridge)

  // Hills and valleys: strongest where the massifs fall away into foothills.
  const skirt = smoothstep(8, 80, mass) * (1 - smoothstep(170, 340, mass))
  const hills = fbm(qx / (span / HILLS.frequency), qz / (span / HILLS.frequency), HILLS.shapingParam, o[10]!, o[11]!) * HILLS.amplitude * HILLS.weight * (0.24 + 0.76 * skirt)

  // Drainage: crest lines of an independent ridged field, cut downward.
  const channelRaw = ridged(qx / (span / DRAINAGE.frequency), qz / (span / DRAINAGE.frequency), DRAINAGE.shapingParam, o[12]!, o[13]!)
  const channel = clamp01((channelRaw - 0.3) / 0.45) ** 1.5
  const open = (1 - smoothstep(150, 380, mass)) * (1 - smoothstep(0.82, 1, t))
  const drain = channel * DRAINAGE.amplitude * DRAINAGE.weight * open

  const basement = 82 + simplex2(px / 1700 + o[14]!, pz / 1700 + o[15]!) * 26 + simplex2(px / 640 + o[12]!, pz / 640 + o[13]!) * 8
  const grainScale = span / DETAIL.frequency
  const detail = fbm(px / grainScale, pz / grainScale, DETAIL.shapingParam, o[6]!, o[7]!) * DETAIL.amplitude * DETAIL.weight

  parts.mass = mass
  parts.ridge = ridge
  parts.hills = hills
  parts.drain = drain
  parts.detail = detail
  parts.height = basement + relief + hills - drain + detail - 0.6 * LANDFORM_02.rimErosion(t, angle) * ISLAND_METERS_PER_UNIT
}

/** The layer's own field, in [-1, 1], for the inspector preview. */
export function terrainLayerSignal(id: string, x: number, z: number, config: LandscapeConfig = LANDSCAPE): number {
  evaluate(x, z, config)
  if (id === HIGHLAND.id) return Math.max(-1, Math.min(1, (parts.mass / (HIGHLAND.amplitude * HIGHLAND.weight)) * 2.4 - 1))
  if (id === RIDGES.id) return parts.ridge * 2 - 1
  if (id === HILLS.id) return Math.max(-1, Math.min(1, parts.hills / (HILLS.amplitude * HILLS.weight)))
  if (id === DRAINAGE.id) return Math.max(-1, Math.min(1, (parts.drain / (DRAINAGE.amplitude * DRAINAGE.weight)) * 2 - 1))
  return Math.max(-1, Math.min(1, parts.detail / (DETAIL.amplitude * DETAIL.weight)))
}

/** Grayscale source for one layer. Points off the island are black. */
export function terrainLayerPreview(id: string, resolution = 48, config: LandscapeConfig = LANDSCAPE): Float32Array {
  const values = new Float32Array(resolution * resolution)
  const half = config.size * 0.5
  const denom = Math.max(1, resolution - 1)
  for (let j = 0; j < resolution; j += 1) {
    for (let i = 0; i < resolution; i += 1) {
      const x = -half + (i / denom) * config.size
      const z = -half + (j / denom) * config.size
      const inside = Math.hypot(x, z) <= islandRadius(Math.atan2(z, x))
      values[j * resolution + i] = inside ? terrainLayerSignal(id, x, z, config) : -1
    }
  }
  return values
}

/**
 * Meters above the datum: massifs of different height and width, cut into
 * branching ridges, with foothills and a drainage network between them.
 */
export function landscapeHeight(x: number, z: number, config: LandscapeConfig = LANDSCAPE): number {
  evaluate(x, z, config)
  return parts.height
}

export const NOISE_TYPE_LABEL: Record<NoiseType, string> = {
  perlin: 'Perlin',
  simplex: 'Simplex',
  value: 'Value',
  cellular: 'Cellular',
}

export const SHAPING_LABEL: Record<ShapingType, string> = {
  none: 'None',
  ridged: 'Ridged',
  billow: 'Billow',
  turbulence: 'Turbulence',
  terracing: 'Terracing',
  power: 'Power',
  domainWarp: 'Domain warp',
}

export type CameraPose = { position: [number, number, number]; target: [number, number, number] }

/**
 * Three-quarter view, 37° below the horizon, from the north-west, aimed at
 * the ground. Orbit turns around this ground point.
 */
export function overviewPose(x = 0, z = 0, config: LandscapeConfig = LANDSCAPE): CameraPose {
  const depression = (37 * Math.PI) / 180
  const polar = Math.PI / 2 - depression
  const heading = Math.atan2(9.5, 15) + Math.PI
  const height = config.size * 0.6
  const ground = landscapeHeight(x, z, config)
  const back = height * Math.tan(polar)
  return {
    position: [x + Math.sin(heading) * back, ground + height, z + Math.cos(heading) * back],
    target: [x, ground, z],
  }
}

/**
 * A closer oblique view of the same place, from the side the previous
 * camera was on. The pivot stays on the ground.
 */
export function approachPose(x: number, z: number, yaw = Math.PI, config: LandscapeConfig = LANDSCAPE): CameraPose {
  const limit = config.size * 0.5 - 80
  const ground = landscapeHeight(x, z, config)
  const dist = 640
  const camX = Math.max(-limit, Math.min(limit, x + Math.sin(yaw) * dist))
  const camZ = Math.max(-limit, Math.min(limit, z + Math.cos(yaw) * dist))
  const targetY = ground + 6
  let camY = Math.max(ground + 300, landscapeHeight(camX, camZ, config) + 80)
  for (let n = 0; n < 4; n += 1) {
    const along = 0.45
    const mid = landscapeHeight(camX + (x - camX) * along, camZ + (z - camZ) * along, config)
    const line = camY + (targetY - camY) * along
    if (mid + 36 > line) camY += mid + 36 - line
  }
  return { position: [camX, camY, camZ], target: [x, targetY, z] }
}

/** Yaw faces uphill. Pitch stays near the slope so the ground and the sky both sit in frame. */
export function exploreLook(x: number, z: number, config: LandscapeConfig = LANDSCAPE): { yaw: number; pitch: number } {
  const here = landscapeHeight(x, z, config)
  const step = 120
  let yaw = Math.PI
  let rise = 0
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2
    const gained = landscapeHeight(x + Math.sin(angle) * step, z + Math.cos(angle) * step, config) - here
    if (gained > rise) {
      rise = gained
      yaw = angle + Math.PI
    }
  }
  const pitch = Math.max(-0.14, Math.min(0.26, Math.atan2(rise, step) - 0.2))
  return { yaw, pitch }
}

export const EYE_HEIGHT = 1.6
export const WALK_SPEED = 1.4

/** Fast movement multiplies the walking speed by this. */
export const FAST_WALK_FACTOR = 3
export { LODS }
