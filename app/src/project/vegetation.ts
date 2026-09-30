import { cellCenter, CELL, cellIndex, GRID_EXTENT, GRID_SIZE, sampleGrid } from './grid.ts'
import type { Hydrology } from './hydrology.ts'
import { outlineRadius } from './terrain.ts'

/**
 * Shadow Ecology — where vegetation can stand, read from the world:
 *
 *   suitability = moisture · footing(slope) · sunlight
 *
 * where sunlight is the traced daily sunlight (terrain and architecture
 * shadows over the whole day): plants need enough of it, and deep shade
 * starves them. Water, paths, architecture and the rim are excluded. Plants
 * are scattered by a hash: the more suitable the ground, the denser and
 * taller they stand, so regions emerge rather than being drawn. Each carries
 * its moisture, light and vigour so its form can answer them.
 */
const FOOTING_FULL = 14
const FOOTING_NONE = 26
/** Daily sunlight (relative to open flat ground) below which plants cannot stand, and at which they thrive. */
const LIGHT_MIN = 0.2
const LIGHT_FULL = 0.65
const WATER_CLEARANCE = 0.08
const PATH_CLEARANCE = 0.07
const RIM_LIMIT = 0.93
const SLOPE_STEP = 0.03

const SPACING = 0.07
const MIN_SUITABILITY = 0.22
/** Suitability at which plants stand densest and tallest. */
const FULL_SUITABILITY = 0.65
const MAX_DENSITY = 0.7
const MIN_HEIGHT = 0.05
const HEIGHT_RANGE = 0.2
/** Gap kept between a plant's tip and any structure above it. */
const TIP_CLEARANCE = 0.01

export type Plant = {
  x: number
  y: number
  z: number
  height: number
  seed: number
  /** Ground moisture, daily sunlight (0…1) and vigour where it stands, for its form and colour. */
  moisture: number
  light: number
  vigour: number
}

export type Vegetation = {
  plants: Plant[]
  /** 0…1 per grid cell: 0 below the minimum suitability, 1 at full vigour. */
  region: Float32Array
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}

export function createVegetation(
  hydrology: Hydrology,
  groundHeight: (x: number, z: number) => number,
  insolation: Float32Array,
  pathDistance: Float32Array,
  footprint: Uint8Array,
  clearance: (x: number, z: number, ground: number) => number,
): Vegetation {
  const suitability = new Float32Array(GRID_SIZE * GRID_SIZE)
  for (let index = 0; index < suitability.length; index += 1) {
    const [x, z] = cellCenter(index)
    const rim = Math.hypot(x, z) / outlineRadius(Math.atan2(z, x))
    if (
      !hydrology.inside[index] ||
      hydrology.waterDistance[index]! < WATER_CLEARANCE ||
      pathDistance[index]! < PATH_CLEARANCE ||
      rim > RIM_LIMIT ||
      footprint[index]
    ) {
      continue
    }
    const dx = (groundHeight(x + SLOPE_STEP, z) - groundHeight(x - SLOPE_STEP, z)) / (2 * SLOPE_STEP)
    const dz = (groundHeight(x, z + SLOPE_STEP) - groundHeight(x, z - SLOPE_STEP)) / (2 * SLOPE_STEP)
    const slope = (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI
    const footing = 1 - smoothstep(FOOTING_FULL, FOOTING_NONE, slope)
    const sunlight = smoothstep(LIGHT_MIN, LIGHT_FULL, insolation[index]!)
    suitability[index] = hydrology.moisture[index]! * footing * sunlight
  }

  const onFootprint = (x: number, z: number) => {
    const i = Math.floor((x + GRID_EXTENT) / CELL)
    const j = Math.floor((z + GRID_EXTENT) / CELL)
    return i >= 0 && j >= 0 && i < GRID_SIZE && j < GRID_SIZE && footprint[cellIndex(i, j)] === 1
  }

  const plants: Plant[] = []
  const steps = Math.floor((2 * GRID_EXTENT) / SPACING)
  for (let j = 0; j < steps; j += 1) {
    for (let i = 0; i < steps; i += 1) {
      const x = -GRID_EXTENT + (i + hash(i, j)) * SPACING
      const z = -GRID_EXTENT + (j + hash(j, i + 91)) * SPACING
      const s = sampleGrid(suitability, x, z)
      const vigour = smoothstep(MIN_SUITABILITY, FULL_SUITABILITY, s)
      if (s < MIN_SUITABILITY || hash(i + 17, j + 5) > MAX_DENSITY * vigour || onFootprint(x, z)) {
        continue
      }
      const seed = hash(i + 3, j + 41)
      const y = groundHeight(x, z)
      const height = Math.min(
        MIN_HEIGHT + HEIGHT_RANGE * vigour * (0.6 + 0.4 * seed),
        clearance(x, z, y) - TIP_CLEARANCE,
      )
      if (height > MIN_HEIGHT * 0.5) {
        plants.push({
          x,
          y,
          z,
          height,
          seed,
          moisture: sampleGrid(hydrology.moisture, x, z),
          light: Math.min(1, sampleGrid(insolation, x, z)),
          vigour,
        })
      }
    }
  }
  const region = suitability.map((s) => smoothstep(MIN_SUITABILITY, FULL_SUITABILITY, s))
  return { plants, region }
}
