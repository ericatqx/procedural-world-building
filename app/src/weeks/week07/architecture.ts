import type { BufferGeometry } from 'three'
import {
  architectureSolid,
  createArchitecture,
  createArchitectureGeometry,
  growArchitecture,
  LATTICE_ORIGIN,
  LAYER_BASE,
  MODULE_SIZE,
  VOXEL_SIZE,
  type Architecture,
} from '../../project/architecture.ts'
import { CELL as HYDROLOGY_CELL, cellCenter, forEachNeighbour, GRID_SIZE } from '../../project/grid.ts'
import type { Hydrology } from '../../project/hydrology.ts'
import { dailyInsolation, sunVisible, type Ground } from '../../project/light.ts'
import { sunAt } from '../../project/sun.ts'
import { BASE_HEIGHT, CELLS, GRID, groundHeight, onBlock, onFooting, WATER_LEVEL } from './site.ts'

/**
 * Week 07 Branching Histories — the established structure, grown by the
 * Project's own architecture system on this site: sites scored by light,
 * footing and the water's edge; a stepped seed block at each; then the
 * grammar of moves (rise, wall, terrace, cantilever, span, opening, cut),
 * each weighted by the sun of that moment, over simulated days, exactly as
 * the Project's simulation drives it.
 *
 * The Project reads the site through its own hydrology and ground. Grounded
 * mass stands only on the footing, the plain south of the lake: elsewhere
 * the hydrology reports no clearance from water, which the Project will not
 * build on, though its slabs may still reach out past it.
 *
 * The histories then work on whole levels of each module (two voxel
 * layers); the scene draws what still stands with the Project's own block
 * geometry and material.
 */

export const LEVELS = 10
/** Noon sun the structure grew under; the light field uses the same day. */
export const GROWTH_NOON = 50
/** Voxels (above ground) the Project grows before the histories begin. */
const GROWN_VOXELS = 1200
const SEED = 20260929

const TICK_HOURS = 0.25
const TICKS_PER_DAY = 24 / TICK_HOURS
const GROWTH_RATE = 16
const MAX_BUDGET = 40
const MAX_DAYS = 60
/** Ground given to points off the block, so light traced across them passes (as Week 06 does). */
const OFF_BLOCK = -10

const MODULE = Math.round(MODULE_SIZE / VOXEL_SIZE)
const LATTICE = GRID * MODULE
const layerOf = (y: number) => Math.floor((y - LAYER_BASE) / VOXEL_SIZE)
/** The first voxel layer above the footing: level 0. */
const FIRST_LAYER = layerOf(BASE_HEIGHT + 1e-4)
const voxelIndex = (ix: number, iy: number, iz: number) => ix + iz * LATTICE + iy * LATTICE * LATTICE

function mulberry32(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const siteGround = (x: number, z: number) => (onBlock(x, z) ? groundHeight(x, z) : OFF_BLOCK)

/** The site as the Project's hydrology sees it: the lake and its outlet as one lake, at one level. */
function siteHydrology(): Hydrology {
  const count = GRID_SIZE * GRID_SIZE
  const inside = new Uint8Array(count)
  const lakeId = new Int16Array(count).fill(-1)
  const distance = new Float32Array(count).fill(Infinity)
  const cells: number[] = []
  let maxDepth = 0
  for (let index = 0; index < count; index++) {
    const [x, z] = cellCenter(index)
    if (!onBlock(x, z)) {
      continue
    }
    inside[index] = 1
    if (groundHeight(x, z) < WATER_LEVEL) {
      lakeId[index] = 0
      distance[index] = 0
      cells.push(index)
      maxDepth = Math.max(maxDepth, WATER_LEVEL - groundHeight(x, z))
    }
  }
  const relax = (index: number) =>
    forEachNeighbour(index, (other, step) => {
      distance[index] = Math.min(distance[index]!, distance[other]! + step)
    })
  for (let index = 0; index < count; index++) {
    relax(index)
  }
  for (let index = count - 1; index >= 0; index--) {
    relax(index)
  }
  const waterDistance = new Float32Array(count)
  for (let index = 0; index < count; index++) {
    const [x, z] = cellCenter(index)
    waterDistance[index] = onFooting(x, z) ? distance[index]! * HYDROLOGY_CELL : 0
  }
  return {
    inside,
    accumulation: new Float32Array(count),
    lakeId,
    lakes: [{ cells, level: WATER_LEVEL, maxDepth }],
    rivers: [],
    river: new Uint8Array(count),
    waterDistance,
    moisture: new Float32Array(count),
  }
}

function siteLight(): Ground {
  const heights = new Float32Array(GRID_SIZE * GRID_SIZE)
  let top = -Infinity
  for (let index = 0; index < heights.length; index++) {
    const [x, z] = cellCenter(index)
    heights[index] = siteGround(x, z)
    top = Math.max(top, heights[index]!)
  }
  return { heights, top }
}

/** Grows the structure as the Project's simulation does: a budget per quarter hour of sun, spent under that sun. */
function growStructure(): Architecture {
  const hydrology = siteHydrology()
  const ground = siteLight()
  const architecture = createArchitecture(hydrology, siteGround, dailyInsolation(ground, hydrology.inside, null, GROWTH_NOON))
  const random = mulberry32(SEED)
  let budget = 0
  for (let tick = 0; architecture.count < GROWN_VOXELS && tick < MAX_DAYS * TICKS_PER_DAY; tick++) {
    architecture.clock = tick * TICK_HOURS
    const sun = sunAt((tick % TICKS_PER_DAY) * TICK_HOURS, GROWTH_NOON)
    if (sun.daylight <= 0) {
      continue
    }
    budget = Math.min(MAX_BUDGET, budget + TICK_HOURS * GROWTH_RATE * sun.daylight * Math.max(0, sun.direction[1]))
    if (budget > 0) {
      const solid = architectureSolid(architecture)
      budget -= growArchitecture(
        architecture,
        Math.min(budget, GROWN_VOXELS - architecture.count),
        sun.direction,
        (x, y, z) => sunVisible(x, y, z, sun.direction, ground, solid),
        random,
      )
    }
  }
  return architecture
}

const GROWN = growStructure()

/** Hours the structure grew for: the age the scene's material starts from. */
export const GROWN_HOURS = GROWN.clock

const moduleColumns = (c: number) => {
  const ix = (c % GRID) * MODULE
  const iz = Math.floor(c / GRID) * MODULE
  const out: [number, number][] = []
  for (let dz = 0; dz < MODULE; dz++) {
    for (let dx = 0; dx < MODULE; dx++) {
      out.push([ix + dx, iz + dz])
    }
  }
  return out
}
const levelLayers = (l: number) => [FIRST_LAYER + 2 * l, FIRST_LAYER + 2 * l + 1]

/** The grown structure as levels, `cell * LEVELS + level`: a level stands where either of its layers does. */
function grownLevels() {
  const voxels = new Uint8Array(CELLS * LEVELS)
  const birth = new Float32Array(CELLS * LEVELS)
  for (let c = 0; c < CELLS; c++) {
    for (let l = 0; l < LEVELS; l++) {
      let first = Infinity
      for (const [ix, iz] of moduleColumns(c)) {
        for (const iy of levelLayers(l)) {
          const index = voxelIndex(ix, iy, iz)
          if (GROWN.solid[index]) {
            first = Math.min(first, GROWN.birth[index]!)
          }
        }
      }
      if (Number.isFinite(first)) {
        voxels[c * LEVELS + l] = 1
        birth[c * LEVELS + l] = first
      }
    }
  }
  return { voxels, birth }
}

const LEVELLED = grownLevels()
export const ORIGIN_VOXELS: Readonly<Uint8Array> = LEVELLED.voxels
/** Per level: the hour it was placed. */
export const ORIGIN_BIRTH: Readonly<Float32Array> = LEVELLED.birth

/**
 * The Project's block mesh of what still stands: each standing level keeps
 * its grown layers (so thin slabs stay thin), grounded modules their
 * foundations. Ages against `GROWN_HOURS`; weathering reads the form.
 */
export function standingGeometry(voxels: Uint8Array): BufferGeometry {
  const solid = new Uint8Array(GROWN.solid.length)
  const moduleTop = new Int16Array(GROWN.moduleTop.length).fill(-1)
  const moduleBottom = new Int16Array(GROWN.moduleBottom.length).fill(-1)
  for (let c = 0; c < CELLS; c++) {
    let lowest = Infinity
    for (let l = 0; l < LEVELS; l++) {
      if (!voxels[c * LEVELS + l]) {
        continue
      }
      for (const [ix, iz] of moduleColumns(c)) {
        const layers = l === 0 ? Array.from({ length: FIRST_LAYER + 2 }, (_, k) => k) : levelLayers(l)
        for (const iy of layers) {
          const index = voxelIndex(ix, iy, iz)
          if (GROWN.solid[index]) {
            solid[index] = GROWN.solid[index]!
            moduleTop[c] = Math.max(moduleTop[c]!, iy)
            lowest = Math.min(lowest, iy)
          }
        }
      }
    }
    moduleBottom[c] = voxels[c * LEVELS] || !Number.isFinite(lowest) ? -1 : lowest
  }
  return createArchitectureGeometry({ ...GROWN, solid, moduleTop, moduleBottom })
}

/** Centre of the grown structure's footprint: fallen material is thrown outward from it. */
export const ARCH_CENTRE: [number, number] = (() => {
  let x = 0
  let z = 0
  let n = 0
  for (let c = 0; c < CELLS; c++) {
    if (ORIGIN_VOXELS[c * LEVELS]) {
      x += LATTICE_ORIGIN + ((c % GRID) + 0.5) * MODULE_SIZE
      z += LATTICE_ORIGIN + (Math.floor(c / GRID) + 0.5) * MODULE_SIZE
      n++
    }
  }
  return n > 0 ? [x / n, z / n] : [0, 0]
})()
