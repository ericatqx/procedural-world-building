import { LATTICE_ORIGIN, LAYER_BASE, MODULE_SIZE, VOXEL_SIZE } from '../../project/architecture.ts'
import {
  isWaterAt,
  LOWLAND_MOISTURE,
  MOISTURE_RANGE,
  STUDY_HALF,
  studyHeight,
  studySurfaceHeight,
  WATER_LEVEL,
} from '../week06/studyTerrain.ts'

/**
 * Week 07 Branching Histories — the site: the Week 06 study terrain itself
 * (`week06/studyTerrain.ts`), the same block, heightfield, lake and outlet,
 * read by the histories on a coarser logical grid.
 *
 * The grid is the Project's module lattice: one cell per architecture
 * module, one level per rise (two voxel layers), so the Project's
 * architecture grows on it unchanged (see `architecture.ts` here). A cell
 * is land when its centre lies on the block, water when the Week 06 ground
 * there lies below the lake's surface. The scene draws the Week 06 block
 * and water meshes; the grid is never drawn.
 */

export { isWaterAt, LOWLAND_MOISTURE, MOISTURE_RANGE, STUDY_HALF, WATER_LEVEL }
export const groundHeight = studyHeight
/** The rendered block's surface, exactly: where things placed on the ground stand. */
export const surfaceHeight = studySurfaceHeight

export const CELL = MODULE_SIZE
export const HALF = -LATTICE_ORIGIN
export const GRID = Math.round((2 * HALF) / CELL)
export const LEVEL = 2 * VOXEL_SIZE
export const CELLS = GRID * GRID

export const cellX = (c: number) => -HALF + ((c % GRID) + 0.5) * CELL
export const cellZ = (c: number) => -HALF + (Math.floor(c / GRID) + 0.5) * CELL
export const cellAt = (i: number, j: number) => (i < 0 || j < 0 || i >= GRID || j >= GRID ? -1 : j * GRID + i)
export const cellOf = (x: number, z: number) => cellAt(Math.floor((x + HALF) / CELL), Math.floor((z + HALF) / CELL))

export const onBlock = (x: number, z: number) => Math.abs(x) <= STUDY_HALF && Math.abs(z) <= STUDY_HALF

/**
 * The open plain between the lake and the massif, where the structure
 * stands: its grounded modules keep to this footing, though slabs may reach
 * past it.
 */
const FOOTING = { x: -0.3, z: -0.06, rx: 0.6, rz: 0.26 }
/** A rounded rectangle, so whole modules fit along its edges. */
export const onFooting = (x: number, z: number) =>
  ((x - FOOTING.x) / FOOTING.rx) ** 4 + ((z - FOOTING.z) / FOOTING.rz) ** 4 <= 1 && !isWaterAt(x, z)

/** The top of the Project voxel layer just above the footing's highest ground: the structure's level 0 starts here. */
export const BASE_HEIGHT = (() => {
  let top = -Infinity
  for (let x = FOOTING.x - FOOTING.rx; x <= FOOTING.x + FOOTING.rx; x += 0.02) {
    for (let z = FOOTING.z - FOOTING.rz; z <= FOOTING.z + FOOTING.rz; z += 0.02) {
      if (onFooting(x, z)) {
        top = Math.max(top, studyHeight(x, z))
      }
    }
  }
  return LAYER_BASE + Math.ceil((top - LAYER_BASE) / VOXEL_SIZE) * VOXEL_SIZE
})()

export type Site = {
  land: Uint8Array
  /** Ground height per cell, at its centre; water cells hold their bed. */
  ground: Float32Array
  water: Uint8Array
  /** 0 on the highest ground, 1 on the lowest: Week 06's low-lying damp. */
  lowland: Float32Array
  /**
   * The terrain's own shelter, 0…1: how high the ground around a cell rises
   * above it, by the horizon angle in each direction, averaged. High in
   * hollows and at the foot of the escarpment and the hill, near 0 on ridges
   * and plateaus.
   */
  enclosure: Float32Array
  /** Height the architecture's level 0 starts from. */
  base: number
}

/** Terrain enclosure: directions read, how far, and the horizon angles (degrees) between open and enclosed. */
const ENCLOSURE = { directions: 16, step: 0.08, reach: 0.9, open: 12, enclosed: 36 } as const

function enclosureAt(x: number, z: number) {
  const h = studyHeight(x, z)
  let sum = 0
  for (let k = 0; k < ENCLOSURE.directions; k++) {
    const a = (k / ENCLOSURE.directions) * 2 * Math.PI
    let horizon = 0
    for (let d = ENCLOSURE.step; d <= ENCLOSURE.reach; d += ENCLOSURE.step) {
      const px = x + Math.cos(a) * d
      const pz = z + Math.sin(a) * d
      if (!onBlock(px, pz)) {
        break
      }
      horizon = Math.max(horizon, Math.atan2(studyHeight(px, pz) - h, d))
    }
    const t = Math.min(1, Math.max(0, ((horizon * 180) / Math.PI - ENCLOSURE.open) / (ENCLOSURE.enclosed - ENCLOSURE.open)))
    sum += t * t * (3 - 2 * t)
  }
  // A cliff along one whole side encloses half the directions: that already reads as full shelter.
  return Math.min(1, (2 * sum) / ENCLOSURE.directions)
}

function buildSite(): Site {
  const land = new Uint8Array(CELLS)
  const ground = new Float32Array(CELLS)
  const water = new Uint8Array(CELLS)
  const lowland = new Float32Array(CELLS)
  const enclosure = new Float32Array(CELLS)
  let low = Infinity
  let top = -Infinity
  for (let c = 0; c < CELLS; c++) {
    const x = cellX(c)
    const z = cellZ(c)
    if (!onBlock(x, z)) {
      continue
    }
    land[c] = 1
    ground[c] = studyHeight(x, z)
    water[c] = ground[c]! < WATER_LEVEL ? 1 : 0
    enclosure[c] = enclosureAt(x, z)
    low = Math.min(low, ground[c]!)
    top = Math.max(top, ground[c]!)
  }
  for (let c = 0; c < CELLS; c++) {
    lowland[c] = land[c] ? 1 - (ground[c]! - low) / (top - low) : 0
  }
  return { land, ground, water, lowland, enclosure, base: BASE_HEIGHT }
}

export const SITE = buildSite()
