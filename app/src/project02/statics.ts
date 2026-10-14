import { gridCellCenter } from '../project/grid.ts'
import { RIVER_MIN_CELLS } from '../project/hydrology.ts'
import type { Ground } from '../project/light.ts'
import { createBaseWorld, type BaseWorld } from '../project/world.ts'
import { clamp01, smoothstep, WORLD_SCALE } from './core.ts'
import { cellOf, GRID_SIZE, sampleGrid } from './grid.ts'
import { LAND_GRID, LANDFORM_02 } from './landform.ts'

/**
 * Shadow Ecology 0.2 — the parts of the world that never change: the
 * landmass (landform.ts) at WORLD_SCALE, its drainage and water, and what
 * the terrain alone says about each grid cell (height, slope, elevation,
 * normal, water, moisture, ridge and valley). Shared by every history
 * branch; never cloned. `readTerrain` is the sample later systems should use.
 *
 * The regions read from these: exposed high ground and cliff edges where
 * architecture roots, sheltered slopes and hollows below them, wet ground
 * around the lakes and rivers, and the falls over the rim into the cloud
 * layer below.
 */
export type Statics = {
  /** The base world in landform units; meshes are drawn at WORLD_SCALE. */
  base: BaseWorld
  scale: number
  /** Ground heights per grid cell, world units, for tracing light. */
  ground: Ground
  /** Underside of the island, world units. */
  lowest: number
  /** Height of the cloud layer the falls drop into, world units. */
  cloud: number
  inside: Uint8Array
  /** Ground slope, degrees. */
  slope: Float32Array
  /** The terrain's own shelter: hollows and the feet of slopes, 0…1. */
  enclosure: Float32Array
  /** 0 on the lowest ground of the island, 1 on the highest. */
  elevation: Float32Array
  /** Standing above its surroundings: crests, knolls, plateau rims, 0…1. */
  ridge: Float32Array
  /** Level ground at the top of a drop: cliff edges, 0…1. */
  edge: Float32Array
  /** 1 on lake or river cells. */
  water: Uint8Array
  /** Water surface height on water cells. */
  waterLevel: Float32Array
  /** World distance to the nearest lake or river. */
  waterDistance: Float32Array
  /** 0…1: near water, or low in a drainage. */
  moisture: Float32Array
  /** 0…1 valley floor: drainage gathered here, and not a crest. */
  valley: Float32Array
  /** 0 at the centre, 1 at the rim. */
  rim: Float32Array
  /** Where the falls leave the rim (world x, y, z), for the cloud layer. */
  falls: [number, number, number][]
  /** Ground height at (x, z), channels cut. */
  groundAt: (x: number, z: number) => number
  /** Grid cell holding (x, z), or −1 off the grid. */
  cellAt: (x: number, z: number) => number
  /** The island's outline radius by angle, world units. */
  outline: (angle: number) => number
}

const ENCLOSURE = { reach: 0.9, step: 0.1, from: 6, to: 26 } as const
/** Falls drop this far (landform units) below the underside, into the cloud layer. */
const FALL_BELOW = 0.3

export function createStatics(): Statics {
  const base = createBaseWorld(LANDFORM_02, FALL_BELOW, LAND_GRID)
  const { hydrology } = base
  const s = WORLD_SCALE
  const count = GRID_SIZE * GRID_SIZE
  const slope = new Float32Array(count)
  const baseHeights = base.ground.heights
  const heights = new Float32Array(count)
  const enclosure = new Float32Array(count)
  const elevation = new Float32Array(count)
  const ridge = new Float32Array(count)
  const edge = new Float32Array(count)
  const water = new Uint8Array(count)
  const waterLevel = new Float32Array(count)
  const waterDistance = new Float32Array(count)
  const moisture = new Float32Array(count)
  const valley = new Float32Array(count)
  const rim = new Float32Array(count)

  const riverLevel = new Map<number, number>()
  for (const river of hydrology.rivers) {
    for (const point of river.points) {
      const i = Math.floor((point.x + LAND_GRID.extent) / LAND_GRID.cell)
      const j = Math.floor((point.z + LAND_GRID.extent) / LAND_GRID.cell)
      if (i >= 0 && j >= 0 && i < GRID_SIZE && j < GRID_SIZE) {
        riverLevel.set(i + j * GRID_SIZE, point.level)
      }
    }
  }

  let low = Infinity
  let high = -Infinity
  for (let index = 0; index < count; index += 1) {
    heights[index] = baseHeights[index]! * s
    if (hydrology.inside[index]) {
      low = Math.min(low, baseHeights[index]!)
      high = Math.max(high, baseHeights[index]!)
    }
  }
  const sample = (x: number, z: number) => {
    const fx = Math.min(GRID_SIZE - 1, Math.max(0, (x + LAND_GRID.extent) / LAND_GRID.cell - 0.5))
    const fz = Math.min(GRID_SIZE - 1, Math.max(0, (z + LAND_GRID.extent) / LAND_GRID.cell - 0.5))
    const i = Math.min(GRID_SIZE - 2, Math.floor(fx))
    const j = Math.min(GRID_SIZE - 2, Math.floor(fz))
    const tx = fx - i
    const tz = fz - j
    const a = baseHeights[i + j * GRID_SIZE]!
    const b = baseHeights[i + 1 + j * GRID_SIZE]!
    const c = baseHeights[i + (j + 1) * GRID_SIZE]!
    const d = baseHeights[i + 1 + (j + 1) * GRID_SIZE]!
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz
  }
  const logRiver = Math.log(LANDFORM_02.water?.riverMinCells ?? RIVER_MIN_CELLS)

  // Terrain readings in landform units: ratios and angles, unchanged by scale.
  for (let index = 0; index < count; index += 1) {
    if (!hydrology.inside[index]) {
      rim[index] = 1
      waterDistance[index] = hydrology.waterDistance[index]! * s
      continue
    }
    const [x, z] = gridCellCenter(LAND_GRID, index)
    const step = 0.08
    const gx = (base.groundHeight(x + step, z) - base.groundHeight(x - step, z)) / (2 * step)
    const gz = (base.groundHeight(x, z + step) - base.groundHeight(x, z - step)) / (2 * step)
    slope[index] = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI
    rim[index] = Math.hypot(x, z) / LANDFORM_02.outlineRadius(Math.atan2(z, x))
    moisture[index] = hydrology.moisture[index]!
    waterDistance[index] = hydrology.waterDistance[index]! * s
    elevation[index] = (baseHeights[index]! - low) / Math.max(1e-6, high - low)
    const lake = hydrology.lakeId[index]!
    if (lake >= 0) {
      water[index] = 1
      waterLevel[index] = hydrology.lakes[lake]!.level * s
    } else if (hydrology.river[index]) {
      water[index] = 1
      waterLevel[index] = (riverLevel.get(index) ?? baseHeights[index]! - 0.02) * s
    }

    const h0 = baseHeights[index]!
    let sum = 0
    let around = 0
    let drop = 0
    for (let a = 0; a < 8; a += 1) {
      const angle = (a / 8) * Math.PI * 2
      const dx = Math.cos(angle)
      const dz = Math.sin(angle)
      let best = 0
      for (let d = ENCLOSURE.step; d <= ENCLOSURE.reach; d += ENCLOSURE.step) {
        const h = sample(x + dx * d, z + dz * d)
        best = Math.max(best, Math.atan2(h - h0, d))
      }
      sum += smoothstep(ENCLOSURE.from, ENCLOSURE.to, (best * 180) / Math.PI)
      around += sample(x + dx * 0.3, z + dz * 0.3) + sample(x + dx * 0.55, z + dz * 0.55)
      // Off the island counts as a long drop: the rim is an edge too.
      const outer = Math.hypot(x + dx * 0.22, z + dz * 0.22) > LANDFORM_02.outlineRadius(Math.atan2(z + dz * 0.22, x + dx * 0.22))
      drop = Math.max(drop, outer ? 0.5 : h0 - Math.min(sample(x + dx * 0.12, z + dz * 0.12), sample(x + dx * 0.22, z + dz * 0.22)))
    }
    enclosure[index] = sum / 8
    ridge[index] = smoothstep(0.02, 0.14, h0 - around / 16)
    const gathered = Math.min(1, Math.log(Math.max(1, hydrology.accumulation[index]!)) / logRiver)
    valley[index] = gathered * gathered * (1 - ridge[index]!)
    edge[index] = smoothstep(0.07, 0.24, drop) * (1 - smoothstep(16, 30, slope[index]!))
  }

  const outlets = hydrology.rivers.filter((r) => r.outlet && r.points.length > 1)
  return {
    base,
    scale: s,
    ground: { heights, top: base.ground.top * s },
    lowest: base.landmass.lowest * s,
    cloud: (base.landmass.lowest - FALL_BELOW) * s,
    inside: hydrology.inside,
    slope,
    enclosure,
    elevation,
    ridge,
    edge,
    water,
    waterLevel,
    waterDistance,
    moisture,
    valley,
    rim,
    falls: outlets.map((r) => {
      const p = r.points[r.points.length - 1]!
      return [p.x * s, p.level * s, p.z * s]
    }),
    groundAt: (x, z) => base.groundHeight(x / s, z / s) * s,
    cellAt: cellOf,
    outline: (angle) => LANDFORM_02.outlineRadius(angle) * s,
  }
}

const SITE = {
  /** Slope (degrees) where a footing is fully buildable, and where it is gone. */
  footing: [14, 32],
  /** Distance from water (landform units) a footing keeps. */
  waterClearance: 0.08,
  rimLimit: 0.95,
  /** World distance from water over which nearness still helps a little. */
  shore: [0.5, 2.5],
  /** Water's share of the weight: a weak pull, so sites don't line the shores. */
  water: 0.12,
  /** World distance from water within which a site counts as a shore site. */
  shoreKind: 1.2,
  /** Elevation band where the weight eases off, so sites don't crowd the peaks. */
  peak: [0.78, 1],
} as const

/**
 * Where new architecture can root, Week 06-style: a product of soft
 * factors, each scaling the weight and none excluding ground on its own —
 *
 *   light       daily sun on the ground (mainly)
 *   buildable   gentle enough slope for a footing (mainly)
 *   support     firm ground: off the rim, off cliff lips, drier (mainly)
 *   open        open sky rather than an enclosed hollow (mainly)
 *   water       a little nearer the shore (weakly)
 *   peaks       eased off on the highest ground
 *
 * The environment decides the suitable regions; the architecture's seeded
 * draw (with its spacing and clustering) chooses sites within them.
 */
export function seedSuitability(statics: Statics, insolation: Float32Array): Float32Array {
  const { hydrology } = statics.base
  const out = new Float32Array(GRID_SIZE * GRID_SIZE)
  for (let index = 0; index < out.length; index += 1) {
    if (!statics.inside[index] || statics.water[index] || statics.rim[index]! > SITE.rimLimit) continue
    if (hydrology.waterDistance[index]! < SITE.waterClearance) continue
    const light = Math.min(1, insolation[index]!) ** 1.2
    const buildable = 1 - smoothstep(SITE.footing[0], SITE.footing[1], statics.slope[index]!)
    const support = (1 - smoothstep(0.8, SITE.rimLimit, statics.rim[index]!)) * (1 - 0.5 * statics.edge[index]!) * (0.75 + 0.25 * (1 - statics.moisture[index]!))
    const open = 1 - 0.7 * clamp01(statics.enclosure[index]!)
    const shore = 1 - smoothstep(SITE.shore[0], SITE.shore[1], statics.waterDistance[index]!)
    const peaks = 1 - 0.5 * smoothstep(SITE.peak[0], SITE.peak[1], statics.elevation[index]!)
    out[index] = light * buildable * support * open * (1 - SITE.water + SITE.water * shore) * peaks
  }
  return out
}

export type SiteKind = 'cliff' | 'slope' | 'valley' | 'plateau' | 'water'

/** The setting a footing stands in, so new sites can favour settings not yet built on. */
export function siteKind(statics: Statics, index: number): SiteKind {
  if (statics.waterDistance[index]! < SITE.shoreKind) return 'water'
  if (statics.edge[index]! > 0.5 || statics.slope[index]! > 30) return 'cliff'
  if (statics.valley[index]! > 0.45 || statics.elevation[index]! < 0.3) return 'valley'
  if (statics.slope[index]! < 10) return 'plateau'
  return 'slope'
}

/** What the terrain says at a world point. Deterministic; safe for later systems to share. */
export type TerrainSample = {
  /** Ground height, channels cut, world units. */
  height: number
  /** Slope in degrees. */
  slope: number
  /** 0 on the lowest ground of the island, 1 on the highest. */
  elevation: number
  /** Unit normal, y up. */
  normal: [number, number, number]
  /** Lake or river. */
  water: boolean
  /** World distance to the nearest lake or river. */
  waterDistance: number
  /** 0…1, near water or low in a drainage. */
  moisture: number
  /** 0…1, standing above its surroundings. */
  ridge: number
  /** 0…1, valley floor where drainage gathers. */
  valley: number
  /** Inside the outline. */
  land: boolean
}

const NORMAL_STEP = 0.45

export function readTerrain(statics: Statics, x: number, z: number): TerrainSample {
  const cell = statics.cellAt(x, z)
  const land = cell >= 0 && statics.inside[cell] === 1
  const height = statics.groundAt(x, z)
  const gx = (statics.groundAt(x + NORMAL_STEP, z) - statics.groundAt(x - NORMAL_STEP, z)) / (2 * NORMAL_STEP)
  const gz = (statics.groundAt(x, z + NORMAL_STEP) - statics.groundAt(x, z - NORMAL_STEP)) / (2 * NORMAL_STEP)
  const len = Math.hypot(gx, 1, gz) || 1
  return {
    height,
    slope: (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI,
    elevation: land ? sampleGrid(statics.elevation, x, z) : 0,
    normal: [-gx / len, 1 / len, -gz / len],
    water: land && statics.water[cell] === 1,
    waterDistance: land ? sampleGrid(statics.waterDistance, x, z) : Infinity,
    moisture: land ? sampleGrid(statics.moisture, x, z) : 0,
    ridge: land ? sampleGrid(statics.ridge, x, z) : 0,
    valley: land ? sampleGrid(statics.valley, x, z) : 0,
    land,
  }
}
