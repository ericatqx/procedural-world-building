import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
} from 'three'
import { cellCenter, CELL, forEachNeighbour, GRID_SIZE } from '../../project/grid.ts'
import type { Ground } from '../../project/light.ts'
import { simplex2 } from '../../shared/noise/simplex.ts'

/**
 * Week 06 study terrain: a square block cut from a landscape, like a
 * terrain model or a specimen, read with the Project's materials. One of
 * each condition the distribution rules respond to, kept apart so each
 * reads on its own:
 *
 *   back right  a broad massif: high ground with gentle to moderate flanks
 *   centre      an open plain, near level
 *   left        a level plateau, ending in a steep escarpment
 *   front       a basin lake with an outlet channel running to the edge
 *
 * Laid on the Project's analysis grid (cells off the block lie far below,
 * so light traced across them passes), so the Project's light trace and
 * plant forms read it unchanged.
 */

/** Half the block's width, world units. */
export const STUDY_HALF = 2.6
/** The lake's surface. Ground below it is water. */
export const WATER_LEVEL = -0.2
/** Ground this close above the water still counts as water: the wet shore line. */
const SHORE = 0.012
/** How far the block's base sits below its lowest ground. */
const BLOCK_DEPTH = 0.55
/** `aBelow` at a wall's rim: just over 0, so the rim reads as wall, not top, while sharing its height. */
const WALL_RIM = 1e-3
const TOP_SEGMENTS = 176
const WATER_SEGMENTS = 120
/** Ground height given to grid cells off the block, so light passes them. */
const OFF_BLOCK = -10
const MOISTURE_RANGE = 0.45
const LOWLAND_MOISTURE = 0.35
/** Water-proximity falloff for the terrain material's bank darkening. */
const WATER_EDGE_RANGE = 0.12
/** The outlet channel: from inside the lake to beyond the front edge. */
const OUTLET: readonly [number, number][] = [
  [0, 1.15],
  [-0.3, 1.65],
  [-0.1, 2.15],
  [-0.3, 2.9],
]

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

const gauss = (dx: number, dz: number, rx: number, rz: number) => Math.exp(-((dx / rx) ** 2) - (dz / rz) ** 2)

function outletDistance(x: number, z: number): number {
  let best = Infinity
  for (let k = 0; k < OUTLET.length - 1; k += 1) {
    const [ax, az] = OUTLET[k]!
    const [bx, bz] = OUTLET[k + 1]!
    const lx = bx - ax
    const lz = bz - az
    const t = Math.min(1, Math.max(0, ((x - ax) * lx + (z - az) * lz) / (lx * lx + lz * lz)))
    best = Math.min(best, Math.hypot(x - ax - t * lx, z - az - t * lz))
  }
  return best
}

const clampToBlock = (value: number) => Math.min(STUDY_HALF, Math.max(-STUDY_HALF, value))

/** Ground height at (x, z), clamped to the block. */
export function studyHeight(px: number, pz: number): number {
  const x = clampToBlock(px)
  const z = clampToBlock(pz)
  const tilt = -0.07 * z
  const massif = 0.78 * gauss(x - 1.1, z + 1.2, 1.05, 0.8) + 0.25 * gauss(x - 0.1, z + 1.9, 0.8, 0.5)
  const escarpment = 0.42 * smoothstep(0.8, 1.15, -x + 0.18 * Math.sin(z * 1.4))
  const basin = -0.62 * gauss(x - 0.3, z - 0.85, 0.85, 0.6)
  const d = outletDistance(x, z)
  const outlet = -0.32 * Math.exp(-((d / 0.12) ** 2)) * smoothstep(0.9, 1.3, z)
  const texture = 0.05 * simplex2(x * 0.8 + 3.1, z * 0.8 - 1.7) + 0.02 * simplex2(x * 2.3 - 5.3, z * 2.3 + 2.9)
  return 0.05 + tilt + massif + escarpment + basin + outlet + texture
}

/** Side of one cell of the block's top grid, world units. */
export const STUDY_CELL = (2 * STUDY_HALF) / TOP_SEGMENTS

let topGrid: Float64Array | null = null

function surfaceGrid(): Float64Array {
  const n = TOP_SEGMENTS
  if (!topGrid) {
    topGrid = new Float64Array((n + 1) * (n + 1))
    const at = (k: number) => -STUDY_HALF + (2 * STUDY_HALF * k) / n
    for (let j = 0; j <= n; j += 1) {
      for (let i = 0; i <= n; i += 1) {
        topGrid[i + j * (n + 1)] = studyHeight(at(i), at(j))
      }
    }
  }
  return topGrid
}

/**
 * Height of the rendered top surface at (x, z): the flat grid triangles of
 * the block, split as `blockGeometry` splits them, rather than the smooth
 * ground they sample. Between grid vertices the two differ by up to a few
 * thousandths, so anything laid closely on the ground has to follow this one.
 */
export function studySurfaceHeight(px: number, pz: number): number {
  const n = TOP_SEGMENTS
  const topGrid = surfaceGrid()
  const u = (clampToBlock(px) + STUDY_HALF) / STUDY_CELL
  const v = (clampToBlock(pz) + STUDY_HALF) / STUDY_CELL
  const i = Math.min(n - 1, Math.floor(u))
  const j = Math.min(n - 1, Math.floor(v))
  const fu = u - i
  const fv = v - j
  const a = topGrid[i + j * (n + 1)]!
  const b = topGrid[i + (j + 1) * (n + 1)]!
  const c = topGrid[i + 1 + j * (n + 1)]!
  const d = topGrid[i + 1 + (j + 1) * (n + 1)]!
  // Cells split along b–c: (a, b, c) where fu + fv ≤ 1, (c, b, d) beyond.
  return fu + fv <= 1 ? a + fu * (c - a) + fv * (b - a) : d + (1 - fu) * (b - d) + (1 - fv) * (c - d)
}

/**
 * How far the slope of the rendered top surface varies over the rectangle
 * (x0, z0)–(x1, z1): the length of the spread of its grid triangles' gradients.
 */
export function studySurfaceBend(x0: number, z0: number, x1: number, z1: number): number {
  const n = TOP_SEGMENTS
  const grid = surfaceGrid()
  const i0 = Math.min(n - 1, Math.max(0, Math.floor((x0 + STUDY_HALF) / STUDY_CELL)))
  const i1 = Math.min(n - 1, Math.max(0, Math.floor((x1 + STUDY_HALF) / STUDY_CELL)))
  const j0 = Math.min(n - 1, Math.max(0, Math.floor((z0 + STUDY_HALF) / STUDY_CELL)))
  const j1 = Math.min(n - 1, Math.max(0, Math.floor((z1 + STUDY_HALF) / STUDY_CELL)))
  let gxLow = Infinity
  let gxHigh = -Infinity
  let gzLow = Infinity
  let gzHigh = -Infinity
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const a = grid[i + j * (n + 1)]!
      const b = grid[i + (j + 1) * (n + 1)]!
      const c = grid[i + 1 + j * (n + 1)]!
      const d = grid[i + 1 + (j + 1) * (n + 1)]!
      gxLow = Math.min(gxLow, c - a, d - b)
      gxHigh = Math.max(gxHigh, c - a, d - b)
      gzLow = Math.min(gzLow, b - a, d - c)
      gzHigh = Math.max(gzHigh, b - a, d - c)
    }
  }
  return Math.hypot(gxHigh - gxLow, gzHigh - gzLow) / STUDY_CELL
}

/** Whether the ground at (x, z) lies under the lake or channel. */
export const isWaterAt = (x: number, z: number) => studyHeight(x, z) < WATER_LEVEL + SHORE

export type StudyTerrain = {
  /** Top surface, cut walls and base, with `aBelow` (depth below the rim) for the terrain material. */
  geometry: BufferGeometry
  /** Lake and channel surface, with the water material's attributes. */
  water: BufferGeometry
  groundHeight: (x: number, z: number) => number
  /** The same ground on the analysis grid, for tracing light. */
  ground: Ground
  /** 1 on grid cells inside the block. */
  inside: Uint8Array
  /** 1 on grid cells under water. */
  water01: Float32Array
  /** Distance to the nearest water, world units. */
  waterDistance: Float32Array
  /** 0…1: near water, or low lying. */
  moisture: Float32Array
  /** Ground data for the terrain material: R moisture, A water proximity. */
  field: DataTexture
  /** Empty habitat field: the terrain material's habitat layer stays off. */
  habitatField: DataTexture
  /** The block's base. */
  lowest: number
}

/** Builds the block: top grid, four cut walls down to a flat base, and the base. */
function blockGeometry(base: number): BufferGeometry {
  const positions: number[] = []
  const below: number[] = []
  const indices: number[] = []
  const vertex = (x: number, y: number, z: number, depth: number) => {
    positions.push(x, y, z)
    below.push(depth)
    return below.length - 1
  }
  const n = TOP_SEGMENTS
  const at = (k: number) => -STUDY_HALF + (2 * STUDY_HALF * k) / n

  const top: number[] = []
  for (let j = 0; j <= n; j += 1) {
    for (let i = 0; i <= n; i += 1) {
      top.push(vertex(at(i), studyHeight(at(i), at(j)), at(j), 0))
    }
  }
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = top[i + j * (n + 1)]!
      const b = top[i + (j + 1) * (n + 1)]!
      const c = top[i + 1 + j * (n + 1)]!
      const d = top[i + 1 + (j + 1) * (n + 1)]!
      indices.push(a, b, c, c, b, d)
    }
  }

  // Each wall runs along one edge; its rim follows the ground, its foot the base.
  const walls: { point: (k: number) => [number, number]; outward: [number, number] }[] = [
    { point: (k) => [at(k), -STUDY_HALF], outward: [0, -1] },
    { point: (k) => [at(k), STUDY_HALF], outward: [0, 1] },
    { point: (k) => [-STUDY_HALF, at(k)], outward: [-1, 0] },
    { point: (k) => [STUDY_HALF, at(k)], outward: [1, 0] },
  ]
  for (const { point, outward } of walls) {
    const rims: number[] = []
    const feet: number[] = []
    for (let k = 0; k <= n; k += 1) {
      const [x, z] = point(k)
      const y = studyHeight(x, z)
      rims.push(vertex(x, y, z, WALL_RIM))
      feet.push(vertex(x, base, z, y - base))
    }
    // Rim → foot → next rim faces +z along x, −x along z; the other two walls wind the other way.
    const forward = outward[1] > 0 || outward[0] < 0
    for (let k = 0; k < n; k += 1) {
      if (forward) {
        indices.push(rims[k]!, feet[k]!, rims[k + 1]!, rims[k + 1]!, feet[k]!, feet[k + 1]!)
      } else {
        indices.push(rims[k]!, rims[k + 1]!, feet[k]!, rims[k + 1]!, feet[k + 1]!, feet[k]!)
      }
    }
  }

  const depth = 1.5
  const c00 = vertex(-STUDY_HALF, base, -STUDY_HALF, depth)
  const c10 = vertex(STUDY_HALF, base, -STUDY_HALF, depth)
  const c01 = vertex(-STUDY_HALF, base, STUDY_HALF, depth)
  const c11 = vertex(STUDY_HALF, base, STUDY_HALF, depth)
  indices.push(c00, c10, c01, c10, c11, c01)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('aBelow', new BufferAttribute(new Float32Array(below), 1))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

/** The water surface over every cell that reaches below it, plus its cut face where it meets the edge. */
function waterGeometry(): BufferGeometry {
  const positions: number[] = []
  const depths: number[] = []
  const indices: number[] = []
  const vertex = (x: number, y: number, z: number) => {
    positions.push(x, y, z)
    depths.push(Math.max(0, WATER_LEVEL - studyHeight(x, z)))
    return depths.length - 1
  }
  const n = WATER_SEGMENTS
  const at = (k: number) => -STUDY_HALF + (2 * STUDY_HALF * k) / n
  const wet = (i: number, j: number) => studyHeight(at(i), at(j)) < WATER_LEVEL
  const ids = new Map<number, number>()
  const id = (i: number, j: number) => {
    const key = i + j * (n + 1)
    let index = ids.get(key)
    if (index === undefined) {
      index = vertex(at(i), WATER_LEVEL, at(j))
      ids.set(key, index)
    }
    return index
  }
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      if (wet(i, j) || wet(i + 1, j) || wet(i, j + 1) || wet(i + 1, j + 1)) {
        const a = id(i, j)
        const b = id(i, j + 1)
        const c = id(i + 1, j)
        const d = id(i + 1, j + 1)
        indices.push(a, b, c, c, b, d)
      }
    }
  }
  // The outlet meets the front edge: close the water there with a cut face.
  for (let i = 0; i < n; i += 1) {
    const x0 = at(i)
    const x1 = at(i + 1)
    const h0 = Math.min(WATER_LEVEL, studyHeight(x0, STUDY_HALF))
    const h1 = Math.min(WATER_LEVEL, studyHeight(x1, STUDY_HALF))
    if (h0 < WATER_LEVEL || h1 < WATER_LEVEL) {
      const a = vertex(x0, WATER_LEVEL, STUDY_HALF)
      const b = vertex(x1, WATER_LEVEL, STUDY_HALF)
      const c = vertex(x0, h0, STUDY_HALF)
      const d = vertex(x1, h1, STUDY_HALF)
      indices.push(a, c, b, b, c, d)
    }
  }
  const geometry = new BufferGeometry()
  const count = depths.length
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('aDepth', new BufferAttribute(new Float32Array(depths), 1))
  // A lake throughout: no flow (aFlow −1), no falls, no current.
  geometry.setAttribute('aFlow', new BufferAttribute(new Float32Array(count).fill(-1), 1))
  geometry.setAttribute('aFall', new BufferAttribute(new Float32Array(count), 1))
  geometry.setAttribute('aAcross', new BufferAttribute(new Float32Array(count), 1))
  geometry.setAttribute('aSpeed', new BufferAttribute(new Float32Array(count), 1))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function gridTexture(data: Uint8Array): DataTexture {
  const texture = new DataTexture(data, GRID_SIZE, GRID_SIZE, RGBAFormat, UnsignedByteType)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

const byte = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255)

export function createStudyTerrain(): StudyTerrain {
  const count = GRID_SIZE * GRID_SIZE
  const inside = new Uint8Array(count)
  const heights = new Float32Array(count).fill(OFF_BLOCK)
  const water01 = new Float32Array(count)
  const distance = new Float32Array(count).fill(Infinity)
  let top = -Infinity
  let low = Infinity
  for (let index = 0; index < count; index += 1) {
    const [x, z] = cellCenter(index)
    if (Math.abs(x) > STUDY_HALF || Math.abs(z) > STUDY_HALF) {
      continue
    }
    inside[index] = 1
    const h = studyHeight(x, z)
    heights[index] = h
    top = Math.max(top, h)
    low = Math.min(low, h)
    if (h < WATER_LEVEL) {
      water01[index] = 1
      distance[index] = 0
    }
  }

  // Distance to water: a two-pass chamfer transform over the grid.
  const relax = (index: number) => {
    forEachNeighbour(index, (other, step) => {
      if (distance[other]! + step < distance[index]!) {
        distance[index] = distance[other]! + step
      }
    })
  }
  for (let index = 0; index < count; index += 1) {
    relax(index)
  }
  for (let index = count - 1; index >= 0; index -= 1) {
    relax(index)
  }

  const waterDistance = new Float32Array(count)
  const moisture = new Float32Array(count)
  const data = new Uint8Array(count * 4)
  for (let index = 0; index < count; index += 1) {
    waterDistance[index] = distance[index]! * CELL
    if (inside[index]) {
      const lowland = 1 - (heights[index]! - low) / (top - low)
      moisture[index] = Math.min(1, Math.exp(-waterDistance[index]! / MOISTURE_RANGE) + LOWLAND_MOISTURE * lowland ** 2)
      data[index * 4] = byte(moisture[index]!)
      data[index * 4 + 3] = byte(Math.exp(-waterDistance[index]! / WATER_EDGE_RANGE))
    }
  }

  const lowest = low - BLOCK_DEPTH
  return {
    geometry: blockGeometry(lowest),
    water: waterGeometry(),
    groundHeight: studyHeight,
    ground: { heights, top },
    inside,
    water01,
    waterDistance,
    moisture,
    field: gridTexture(data),
    habitatField: gridTexture(new Uint8Array(count * 4)),
    lowest,
  }
}
