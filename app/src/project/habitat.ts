import { cellCenter, GRID_SIZE } from './grid.ts'
import type { Hydrology } from './hydrology.ts'
import { outlineRadius } from './terrain.ts'

/**
 * Shadow Ecology — creature habitat: where shade-dependent creatures could
 * live, not where plants grow. Built from three things:
 *
 *   suitability = shelter(remembered daylight sun) · moisture · footing(slope)
 *
 * Shelter is shade in daylight only (the traced daily sunlight samples the
 * day, so night never counts as shelter), and it is remembered: each sunset
 * the day's sunlight is blended into a running memory over `MEMORY_DAYS`, so
 * when architecture casts new shadow, habitat follows over days, not at once.
 */
export type HabitatRule = {
  /**
   * Remembered daily sunlight (relative to open flat ground) that shelter
   * gives way at: full below half of it, half gone at it, none at 1.5×.
   */
  sunlightLimit: number
  /** Slope in degrees above which ground gives no footing. */
  maxSlope: number
}

/** Defaults leave roughly a tenth of the island suitable at first, with shelter doing most of the selecting. */
export const DEFAULT_HABITAT_RULE: HabitatRule = { sunlightLimit: 0.7, maxSlope: 40 }

export const HABITAT_RULE_RANGE = {
  sunlightLimit: { min: 0.1, max: 0.9, step: 0.01 },
  maxSlope: { min: 10, max: 45, step: 1 },
} as const

/** Days over which remembered sunlight follows a change in shade (1/e). */
export const MEMORY_DAYS = 4
/** Dry ground keeps this share of its suitability; moisture adds the rest. */
const MOISTURE_FLOOR = 0.5
/** Water and its immediate edge hold no habitat. */
const WATER_CLEARANCE = 0.04
const RIM_LIMIT = 0.95
const SLOPE_STEP = 0.03
/** Habitat above this counts as suitable in the summary. */
export const SUITABLE = 0.35

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Ground slope per grid cell, in degrees. */
export function groundSlopes(hydrology: Hydrology, groundHeight: (x: number, z: number) => number): Float32Array {
  const slopes = new Float32Array(GRID_SIZE * GRID_SIZE)
  for (let index = 0; index < slopes.length; index += 1) {
    if (!hydrology.inside[index]) {
      continue
    }
    const [x, z] = cellCenter(index)
    const dx = (groundHeight(x + SLOPE_STEP, z) - groundHeight(x - SLOPE_STEP, z)) / (2 * SLOPE_STEP)
    const dz = (groundHeight(x, z + SLOPE_STEP) - groundHeight(x, z - SLOPE_STEP)) / (2 * SLOPE_STEP)
    slopes[index] = (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI
  }
  return slopes
}

/** Blends one day's traced sunlight into the running memory, in place. */
export function rememberSunlight(memory: Float32Array, insolation: Float32Array) {
  const blend = 1 - Math.exp(-1 / MEMORY_DAYS)
  for (let index = 0; index < memory.length; index += 1) {
    memory[index] = memory[index]! + (insolation[index]! - memory[index]!) * blend
  }
}

export function habitatSuitability(
  hydrology: Hydrology,
  slopes: Float32Array,
  sunMemory: Float32Array,
  footprint: Uint8Array,
  rule: HabitatRule,
): Float32Array {
  const habitat = new Float32Array(GRID_SIZE * GRID_SIZE)
  for (let index = 0; index < habitat.length; index += 1) {
    if (
      !hydrology.inside[index] ||
      footprint[index] ||
      hydrology.waterDistance[index]! < WATER_CLEARANCE
    ) {
      continue
    }
    const [x, z] = cellCenter(index)
    if (Math.hypot(x, z) / outlineRadius(Math.atan2(z, x)) > RIM_LIMIT) {
      continue
    }
    const shelter = 1 - smoothstep(rule.sunlightLimit * 0.5, rule.sunlightLimit * 1.5, sunMemory[index]!)
    const footing = 1 - smoothstep(rule.maxSlope * 0.5, rule.maxSlope, slopes[index]!)
    const moisture = MOISTURE_FLOOR + (1 - MOISTURE_FLOOR) * hydrology.moisture[index]!
    habitat[index] = shelter * footing * moisture
  }
  return habitat
}

/** Share of island ground above `SUITABLE`. */
export function suitableShare(hydrology: Hydrology, habitat: Float32Array): number {
  let inside = 0
  let suitable = 0
  for (let index = 0; index < habitat.length; index += 1) {
    if (hydrology.inside[index]) {
      inside += 1
      suitable += habitat[index]! >= SUITABLE ? 1 : 0
    }
  }
  return inside > 0 ? suitable / inside : 0
}
