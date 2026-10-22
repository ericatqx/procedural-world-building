import { BufferAttribute, BufferGeometry } from 'three'
import { LANDSCAPE, islandRadius, landscapeHeight } from './terrain.ts'

/**
 * Shadow Ecology 0.3 — still water, in meters.
 *
 * Lakes and pools are found in the terrain's own height field. A priority
 * flood (water poured in from the island's rim, rising only where the ground
 * holds it) marks every closed depression and the level it would fill to, the
 * level of its lowest pass. That level is the lake's surface, so the shore is
 * wherever the ground meets it and the water can never stand above its own
 * outlet. The pass is two-stage: a coarse sweep of the island proposes the
 * basins, then each chosen basin is measured again on a fine local grid, which
 * is also the grid the surface mesh is cut from.
 *
 * Everything is a function of the terrain and the world seed, with no state of
 * its own. `WaterBody` carries what later systems read: rivers can start at a
 * body's `outlet` and end at another's surface, shore vegetation can read
 * `depthAt`, and architecture can keep clear of `depthAt > 0`.
 */

export type WaterKind = 'lake' | 'pool'

export type WaterBody = {
  id: number
  kind: WaterKind
  /** Centroid of the wet cells. */
  x: number
  z: number
  /** Surface height, in meters. */
  level: number
  /** Surface area, m². */
  area: number
  /** Deepest point below the surface, in meters. */
  depth: number
  /** The lowest pass on the basin's rim, where a river would leave. */
  outlet: { x: number; z: number }
  /** Bounds of the fine grid, meters. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** Fine grid: cell size, columns, rows, origin. `wet` holds depth below the surface per node, 0 on dry nodes. */
  grid: { step: number; cols: number; rows: number; x0: number; z0: number; wet: Float32Array }
}

export type WaterSystem = {
  seed: number
  bodies: WaterBody[]
  /** Depth of standing water at a point, 0 on dry ground. */
  depthAt: (x: number, z: number) => number
  /** Surface height of the water at a point, or null on dry ground. */
  surfaceAt: (x: number, z: number) => number | null
  /** Calls `visit` for each wet node, once per `step`² of surface. */
  forEachWet: (visit: (x: number, z: number, depth: number, body: WaterBody) => void) => void
}

/** Deepest water a walker wades into, in meters. */
export const WADE_DEPTH = 1

const COARSE = 12
const FINE = 4
/** The rim zone, in meters inside the island's outline, where water drains over the edge. */
const RIM_ZONE = 90
const MIN_COARSE_DEPTH = 0.6
/** Ground draining into a basin, as a multiple of its surface: a summit crater has almost none, a valley lake many times its own area. */
const MIN_CATCHMENT = { lake: 8, pool: 4 }
const LAKE = { minArea: 3200, minDepth: 1.4, maxArea: 90000, count: 5 }
const POOL = { minArea: 520, minDepth: 0.6, count: 5 }
/** Basins measured on the fine grid: the larger ones for lakes, the smaller for pools. */
const CANDIDATES = { lakes: 9, pools: 9 }
const LOCAL_MARGIN = 56
/** The surface mesh reaches this far below the surface at the shore, so the terrain, not the polygon, cuts the shoreline. */
const SHORE_REACH = -0.8

const NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
]

/** A deterministic stream from the world seed and a named channel, so each system draws from its own. */
export function deriveSeed(world: number, channel: string): number {
  let h = (world | 0) ^ 0x9e3779b9
  for (let i = 0; i < channel.length; i += 1) {
    h = Math.imul(h ^ channel.charCodeAt(i), 0x01000193)
    h ^= h >>> 15
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Binary min-heap of cell indexes keyed by level. */
class Heap {
  private keys: number[] = []
  private items: number[] = []
  get size() {
    return this.items.length
  }
  push(key: number, item: number) {
    const keys = this.keys
    const items = this.items
    let i = items.length
    keys.push(key)
    items.push(item)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (keys[parent]! <= key) break
      keys[i] = keys[parent]!
      items[i] = items[parent]!
      i = parent
    }
    keys[i] = key
    items[i] = item
  }
  pop(): number {
    const keys = this.keys
    const items = this.items
    const top = items[0]!
    const lastKey = keys.pop()!
    const lastItem = items.pop()!
    const n = items.length
    if (n > 0) {
      let i = 0
      for (;;) {
        let child = 2 * i + 1
        if (child >= n) break
        if (child + 1 < n && keys[child + 1]! < keys[child]!) child += 1
        if (keys[child]! >= lastKey) break
        keys[i] = keys[child]!
        items[i] = items[child]!
        i = child
      }
      keys[i] = lastKey
      items[i] = lastItem
    }
    return top
  }
}

/**
 * Priority flood. `sink` cells drain the grid; every other cell ends at the
 * lowest height water could stand at before spilling to a sink.
 */
function flood(
  heights: Float32Array,
  sink: Uint8Array,
  cols: number,
  rows: number,
  skip?: Uint8Array,
  accumulate?: Float32Array,
): Float32Array {
  const filled = new Float32Array(cols * rows).fill(Number.NaN)
  const closed = new Uint8Array(cols * rows)
  const heap = new Heap()
  const parent = accumulate ? new Int32Array(cols * rows).fill(-1) : null
  const order: number[] = []
  for (let i = 0; i < sink.length; i += 1) {
    if (!sink[i]) continue
    filled[i] = heights[i]!
    closed[i] = 1
    heap.push(heights[i]!, i)
  }
  while (heap.size > 0) {
    const index = heap.pop()
    if (parent) order.push(index)
    const cx = index % cols
    const cz = (index - cx) / cols
    const level = filled[index]!
    for (const [dx, dz] of NEIGHBORS) {
      const nx = cx + dx
      const nz = cz + dz
      if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue
      const next = nz * cols + nx
      if (closed[next] || skip?.[next]) continue
      closed[next] = 1
      const value = Math.max(heights[next]!, level)
      filled[next] = value
      if (parent) parent[next] = index
      heap.push(value, next)
    }
  }
  if (accumulate && parent) {
    // Each cell drains to the neighbour it was reached from: the cells above a point are its catchment.
    accumulate.fill(1)
    for (let k = order.length - 1; k >= 0; k -= 1) {
      const cell = order[k]!
      const down = parent[cell]!
      if (down >= 0) accumulate[down]! += accumulate[cell]!
    }
  }
  return filled
}

type Candidate = { cells: number[]; area: number; catchment: number; minX: number; maxX: number; minZ: number; maxZ: number; lowX: number; lowZ: number; lowH: number; depth: number }

/** Coarse sweep of the island: the closed depressions, with their rough extents. */
function findBasins(): Candidate[] {
  const half = LANDSCAPE.size * 0.5
  const n = Math.round(LANDSCAPE.size / COARSE)
  const heights = new Float32Array(n * n)
  const sink = new Uint8Array(n * n)
  const skip = new Uint8Array(n * n)
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const x = -half + (i + 0.5) * COARSE
      const z = -half + (j + 0.5) * COARSE
      const index = j * n + i
      const reach = islandRadius(Math.atan2(z, x))
      const r = Math.hypot(x, z)
      if (r > reach + COARSE) {
        skip[index] = 1
        continue
      }
      heights[index] = landscapeHeight(x, z)
      if (r > reach - RIM_ZONE) sink[index] = 1
    }
  }
  const accumulation = new Float32Array(n * n)
  const filled = flood(heights, sink, n, n, skip, accumulation)
  const seen = new Uint8Array(n * n)
  const basins: Candidate[] = []
  for (let start = 0; start < n * n; start += 1) {
    if (seen[start] || skip[start] || sink[start]) continue
    const depth = filled[start]! - heights[start]!
    if (!(depth >= MIN_COARSE_DEPTH)) continue
    const level = filled[start]!
    const stack = [start]
    seen[start] = 1
    const basin: Candidate = { cells: [], area: 0, catchment: 0, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, lowX: 0, lowZ: 0, lowH: Infinity, depth: 0 }
    while (stack.length > 0) {
      const index = stack.pop()!
      const i = index % n
      const j = (index - i) / n
      const x = -half + (i + 0.5) * COARSE
      const z = -half + (j + 0.5) * COARSE
      basin.cells.push(index)
      basin.catchment = Math.max(basin.catchment, accumulation[index]! * COARSE * COARSE)
      basin.minX = Math.min(basin.minX, x)
      basin.maxX = Math.max(basin.maxX, x)
      basin.minZ = Math.min(basin.minZ, z)
      basin.maxZ = Math.max(basin.maxZ, z)
      basin.depth = Math.max(basin.depth, level - heights[index]!)
      if (heights[index]! < basin.lowH) {
        basin.lowH = heights[index]!
        basin.lowX = x
        basin.lowZ = z
      }
      for (const [dx, dz] of NEIGHBORS.slice(0, 4)) {
        const ni = i + dx
        const nj = j + dz
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue
        const next = nj * n + ni
        if (seen[next] || skip[next] || sink[next]) continue
        if (Math.abs(filled[next]! - level) > 0.02 || filled[next]! - heights[next]! < MIN_COARSE_DEPTH * 0.5) continue
        seen[next] = 1
        stack.push(next)
      }
    }
    basin.area = basin.cells.length * COARSE * COARSE
    basins.push(basin)
  }
  return basins
}

/** Measures one basin on a fine local grid: its exact level, wet nodes, and outlet. */
function measure(candidate: Candidate, cap: number): Omit<WaterBody, 'id' | 'kind'> | null {
  const minX = Math.floor((candidate.minX - LOCAL_MARGIN) / FINE) * FINE
  const minZ = Math.floor((candidate.minZ - LOCAL_MARGIN) / FINE) * FINE
  const cols = Math.ceil((candidate.maxX + LOCAL_MARGIN - minX) / FINE) + 1
  const rows = Math.ceil((candidate.maxZ + LOCAL_MARGIN - minZ) / FINE) + 1
  const heights = new Float32Array(cols * rows)
  const sink = new Uint8Array(cols * rows)
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      heights[j * cols + i] = landscapeHeight(minX + i * FINE, minZ + j * FINE)
      if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) sink[j * cols + i] = 1
    }
  }
  const filled = flood(heights, sink, cols, rows)
  // Start at the lowest node near the coarse low point.
  let start = -1
  let lowest = Infinity
  const si = Math.round((candidate.lowX - minX) / FINE)
  const sj = Math.round((candidate.lowZ - minZ) / FINE)
  for (let dj = -3; dj <= 3; dj += 1) {
    for (let di = -3; di <= 3; di += 1) {
      const i = si + di
      const j = sj + dj
      if (i < 1 || j < 1 || i >= cols - 1 || j >= rows - 1) continue
      const h = heights[j * cols + i]!
      if (h < lowest) {
        lowest = h
        start = j * cols + i
      }
    }
  }
  if (start < 0) return null
  let level = filled[start]!
  if (!(level - heights[start]! > 0.1)) return null

  const region = (surface: number, strict: boolean): number[] => {
    const wet: number[] = []
    const mark = new Uint8Array(cols * rows)
    const stack = [start]
    mark[start] = 1
    while (stack.length > 0) {
      const index = stack.pop()!
      wet.push(index)
      const i = index % cols
      const j = (index - i) / cols
      for (let k = 0; k < 4; k += 1) {
        const ni = i + (k === 0 ? 1 : k === 1 ? -1 : 0)
        const nj = j + (k === 2 ? 1 : k === 3 ? -1 : 0)
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue
        const next = nj * cols + ni
        if (mark[next] || sink[next]) continue
        if (strict ? heights[next]! >= surface : surface - heights[next]! < 0.05 || Math.abs(filled[next]! - level) > 0.02) continue
        mark[next] = 1
        stack.push(next)
      }
    }
    return wet
  }

  let wet = region(level, false)
  // An oversized flood is held lower, as a lake that has not yet filled its basin.
  if (wet.length * FINE * FINE > cap) {
    let lo = heights[start]! + 0.1
    let hi = level
    for (let k = 0; k < 14; k += 1) {
      const mid = (lo + hi) * 0.5
      if (region(mid, true).length * FINE * FINE > cap) hi = mid
      else lo = mid
    }
    level = lo
    wet = region(level, true)
  }
  if (wet.length * FINE * FINE < POOL.minArea * 0.6) return null

  // A basin that reaches the local grid's edge is a drainage, not a closed body.
  const depthGrid = new Float32Array(cols * rows)
  let sumX = 0
  let sumZ = 0
  let deepest = 0
  for (const index of wet) {
    const i = index % cols
    const j = (index - i) / cols
    if (i < 3 || j < 3 || i >= cols - 3 || j >= rows - 3) return null
    const wx = minX + i * FINE
    const wz = minZ + j * FINE
    // Water near the outline would meet the cliff and the shell; such basins drain over the edge instead.
    if (Math.hypot(wx, wz) > islandRadius(Math.atan2(wz, wx)) - (RIM_ZONE - 8)) return null
    const d = level - heights[index]!
    depthGrid[index] = d
    deepest = Math.max(deepest, d)
    sumX += minX + i * FINE
    sumZ += minZ + j * FINE
  }
  // Outlet: the lowest rim node touching the wet region.
  let outlet = { x: sumX / wet.length, z: sumZ / wet.length }
  let outletHeight = Infinity
  for (const index of wet) {
    const i = index % cols
    const j = (index - i) / cols
    for (const [dx, dz] of NEIGHBORS) {
      const next = (j + dz) * cols + (i + dx)
      if (depthGrid[next]! > 0) continue
      const h = heights[next]!
      if (h >= level - 0.001 && h < outletHeight) {
        outletHeight = h
        outlet = { x: minX + (i + dx) * FINE, z: minZ + (j + dz) * FINE }
      }
    }
  }
  return {
    x: sumX / wet.length,
    z: sumZ / wet.length,
    level,
    area: wet.length * FINE * FINE,
    depth: deepest,
    outlet,
    bounds: { minX, maxX: minX + (cols - 1) * FINE, minZ, maxZ: minZ + (rows - 1) * FINE },
    grid: { step: FINE, cols, rows, x0: minX, z0: minZ, wet: depthGrid },
  }
}

/** Finds the world's still water for the current terrain, deterministically from the world seed. */
export function createWater(seed: number): WaterSystem {
  const random = seededRandom(deriveSeed(seed, 'water'))
  const scored = findBasins()
    .filter((basin) => basin.area >= POOL.minArea * 0.6 && basin.depth >= POOL.minDepth)
    .filter((basin) => basin.catchment >= basin.area * (basin.area >= LAKE.minArea * 0.6 ? MIN_CATCHMENT.lake : MIN_CATCHMENT.pool))
    // A little seeded preference among similar basins, so the same terrain can still vary per world.
    .map((basin) => ({ basin, score: Math.sqrt(basin.area) * basin.depth ** 0.35 * (0.8 + 0.4 * random()) }))
    .sort((a, b) => b.score - a.score)
  const large = scored.filter(({ basin }) => basin.area >= LAKE.minArea * 0.6)
  const small = scored.filter(({ basin }) => basin.area < LAKE.minArea * 0.6)
  const basins = [...large.slice(0, CANDIDATES.lakes), ...small.slice(0, CANDIDATES.pools)]

  const lakes: WaterBody[] = []
  const pools: WaterBody[] = []
  for (const { basin } of basins) {
    const measured = measure(basin, LAKE.maxArea)
    if (!measured) continue
    if (measured.area >= LAKE.minArea && measured.depth >= LAKE.minDepth) {
      if (lakes.length < LAKE.count) lakes.push({ ...measured, id: 0, kind: 'lake' })
    } else if (measured.area >= POOL.minArea && measured.depth >= POOL.minDepth) {
      if (pools.length < POOL.count) pools.push({ ...measured, id: 0, kind: 'pool' })
    }
  }
  const bodies = [...lakes, ...pools]
  bodies.forEach((body, id) => {
    body.id = id
  })

  return {
    seed,
    bodies,
    depthAt: (x, z) => {
      for (const body of bodies) {
        const { bounds } = body
        if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) continue
        const { grid } = body
        const i = Math.round((x - grid.x0) / grid.step)
        const j = Math.round((z - grid.z0) / grid.step)
        if (grid.wet[j * grid.cols + i]! > 0) return Math.max(0, body.level - landscapeHeight(x, z))
      }
      return 0
    },
    surfaceAt: (x, z) => {
      for (const body of bodies) {
        const { bounds, grid } = body
        if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) continue
        const i = Math.round((x - grid.x0) / grid.step)
        const j = Math.round((z - grid.z0) / grid.step)
        if (grid.wet[j * grid.cols + i]! > 0) return body.level
      }
      return null
    },
    forEachWet: (visit) => {
      for (const body of bodies) {
        const { grid } = body
        for (let j = 0; j < grid.rows; j += 1) {
          for (let i = 0; i < grid.cols; i += 1) {
            const depth = grid.wet[j * grid.cols + i]!
            if (depth > 0) visit(grid.x0 + i * grid.step, grid.z0 + j * grid.step, depth, body)
          }
        }
      }
    },
  }
}

/**
 * One surface mesh for all bodies, cut from each body's fine grid. Nodes that
 * touch the water carry their true depth; the dry ring just outside carries
 * the (negative) height of the bank, so the outline falls on the ground's own
 * contour. The polygon reaches a little under the bank and the depth test
 * against the terrain mesh makes the visible shoreline at every level of detail.
 */
export function buildWaterGeometry(water: WaterSystem): BufferGeometry {
  const positions: number[] = []
  const depths: number[] = []
  for (const body of water.bodies) {
    const { grid, level } = body
    const { cols, rows, step, x0, z0, wet } = grid
    const value = new Float32Array(cols * rows).fill(SHORE_REACH - 2)
    // Dry nodes within two nodes of the water take the bank's height, so the contour lands on the shore.
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        if (wet[j * cols + i]! <= 0) continue
        for (let dj = -2; dj <= 2; dj += 1) {
          for (let di = -2; di <= 2; di += 1) {
            const ni = i + di
            const nj = j + dj
            if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue
            const index = nj * cols + ni
            if (wet[index]! > 0) continue
            if (value[index]! > SHORE_REACH - 2) continue
            const d = level - landscapeHeight(x0 + ni * step, z0 + nj * step)
            value[index] = Math.min(d, -0.02)
          }
        }
      }
    }
    for (let index = 0; index < value.length; index += 1) if (wet[index]! > 0) value[index] = wet[index]!
    for (let j = 0; j < rows - 1; j += 1) {
      for (let i = 0; i < cols - 1; i += 1) {
        const corners = [
          [i, j],
          [i + 1, j],
          [i + 1, j + 1],
          [i, j + 1],
        ] as const
        const values = corners.map(([ci, cj]) => value[cj * cols + ci]!)
        if (Math.max(...values) < SHORE_REACH) continue
        // Clip the cell's quad to value >= SHORE_REACH.
        const polygon: [number, number, number][] = []
        for (let k = 0; k < 4; k += 1) {
          const a = corners[k]!
          const b = corners[(k + 1) % 4]!
          const va = values[k]!
          const vb = values[(k + 1) % 4]!
          const inA = va >= SHORE_REACH
          const inB = vb >= SHORE_REACH
          if (inA) polygon.push([x0 + a[0] * step, z0 + a[1] * step, va])
          if (inA !== inB) {
            const t = (SHORE_REACH - va) / (vb - va)
            polygon.push([x0 + (a[0] + (b[0] - a[0]) * t) * step, z0 + (a[1] + (b[1] - a[1]) * t) * step, SHORE_REACH])
          }
        }
        for (let k = 1; k < polygon.length - 1; k += 1) {
          for (const p of [polygon[0]!, polygon[k]!, polygon[k + 1]!]) {
            positions.push(p[0], level, p[1])
            depths.push(Math.max(0, p[2]))
          }
        }
      }
    }
  }
  const geometry = new BufferGeometry()
  const count = positions.length / 3
  const normals = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) normals[i * 3 + 1] = 1
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('aDepth', new BufferAttribute(new Float32Array(depths), 1))
  // Winding: the quad runs +x then +z, which faces down; flip so the surface faces up.
  const index = new Uint32Array(count)
  for (let i = 0; i < count; i += 3) {
    index[i] = i
    index[i + 1] = i + 2
    index[i + 2] = i + 1
  }
  geometry.setIndex(new BufferAttribute(index, 1))
  geometry.computeBoundingSphere()
  return geometry
}
