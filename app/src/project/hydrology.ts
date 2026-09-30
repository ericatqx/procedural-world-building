import {
  CELL,
  cellCenter,
  forEachNeighbour,
  GRID_SIZE,
  MinHeap,
  smoothTrace,
  type TracePoint,
} from './grid.ts'
import { outlineRadius, surfaceHeight } from './terrain.ts'

/**
 * Shadow Ecology — water read from the terrain in one pass, not simulated.
 *
 * 1. Fill depressions (priority flood) so every cell drains to the rim.
 * 2. Each cell drains to its steepest lower neighbour; accumulating one unit
 *    of rain per cell downstream gives how much ground drains through it.
 * 3. Filled basins deep and large enough become lakes; cells draining
 *    enough ground become rivers; rivers reaching the rim spill as falls.
 *
 * Water reads the terrain alone; architecture keeps its footings clear of it.
 */
const FLAT_EPSILON = 1e-5
/** Cells nearer the outline than this (as a fraction of its radius) are not island. */
const ISLAND_LIMIT = 0.985

const LAKE_MIN_DEPTH = 0.012
const LAKE_MIN_CELLS = 25
const LAKE_MIN_MAX_DEPTH = 0.05

/** Cells of drained ground before a flow line counts as a river. */
export const RIVER_MIN_CELLS = 240
const RIVER_MIN_LENGTH = 0.2
const RIVER_SMOOTHING = 2
/** Water sits this far below the ground it runs over. */
const RIVER_LEVEL_DROP = 0.02

const MOISTURE_RANGE = 0.45
const VALLEY_MOISTURE = 0.3

export type RiverPoint = {
  x: number
  z: number
  /** Water surface height. */
  level: number
  halfWidth: number
  depth: number
  /** Distance along the river from its head. */
  distance: number
}

export type River = { points: RiverPoint[]; outlet: boolean }

export type Lake = { cells: number[]; level: number; maxDepth: number }

export type Hydrology = {
  inside: Uint8Array
  accumulation: Float32Array
  /** Index into `lakes`, or −1. */
  lakeId: Int16Array
  lakes: Lake[]
  rivers: River[]
  /** 1 where a river runs through the cell. */
  river: Uint8Array
  /** World distance to the nearest lake or river cell. */
  waterDistance: Float32Array
  /** 0…1: near water, or low in a valley. */
  moisture: Float32Array
}

export const riverHalfWidth = (cells: number) => 0.03 + 0.035 * Math.sqrt(cells * CELL * CELL)
export const riverDepth = (cells: number) => 0.03 + 0.015 * Math.sqrt(cells * CELL * CELL)

export function createHydrology(): Hydrology {
  const count = GRID_SIZE * GRID_SIZE
  const inside = new Uint8Array(count)
  const height = new Float32Array(count)
  /** Rim cells: water reaching them spills off the edge. */
  const boundary = new Uint8Array(count)
  for (let index = 0; index < count; index += 1) {
    const [x, z] = cellCenter(index)
    if (Math.hypot(x, z) < outlineRadius(Math.atan2(z, x)) * ISLAND_LIMIT) {
      inside[index] = 1
      height[index] = surfaceHeight(x, z)
    }
  }
  for (let index = 0; index < count; index += 1) {
    if (!inside[index]) {
      continue
    }
    let neighbours = 0
    forEachNeighbour(index, (n) => {
      neighbours += inside[n]!
    })
    if (neighbours < 8) {
      boundary[index] = 1
    }
  }

  // 1. Priority flood from the rim inward.
  const filled = new Float32Array(height)
  const done = new Uint8Array(count)
  const heap = new MinHeap()
  for (let index = 0; index < count; index += 1) {
    if (boundary[index]) {
      done[index] = 1
      heap.push(index, filled[index]!)
    }
  }
  while (heap.size > 0) {
    const c = heap.pop()
    forEachNeighbour(c, (n) => {
      if (inside[n] && !done[n]) {
        done[n] = 1
        filled[n] = Math.max(height[n]!, filled[c]! + FLAT_EPSILON)
        heap.push(n, filled[n]!)
      }
    })
  }

  // 2. Steepest descent and accumulation, highest cells first.
  const down = new Int32Array(count).fill(-1)
  const order: number[] = []
  for (let index = 0; index < count; index += 1) {
    if (!inside[index]) {
      continue
    }
    order.push(index)
    if (boundary[index]) {
      continue
    }
    let steepest = 0
    forEachNeighbour(index, (n, step) => {
      const drop = (filled[index]! - filled[n]!) / step
      if (inside[n] && drop > steepest) {
        steepest = drop
        down[index] = n
      }
    })
  }
  order.sort((a, b) => filled[b]! - filled[a]!)
  const accumulation = new Float32Array(count)
  for (const index of order) {
    accumulation[index] += 1
    if (down[index] >= 0) {
      accumulation[down[index]!] += accumulation[index]!
    }
  }

  // 3a. Lakes: connected filled basins, deep and large enough.
  const lakeId = new Int16Array(count).fill(-1)
  const lakes: Lake[] = []
  const isBasin = (index: number) =>
    inside[index] === 1 && filled[index]! - height[index]! > LAKE_MIN_DEPTH
  const seen = new Uint8Array(count)
  for (const start of order) {
    if (seen[start] || !isBasin(start)) {
      continue
    }
    const cells: number[] = []
    const stack = [start]
    seen[start] = 1
    while (stack.length > 0) {
      const c = stack.pop()!
      cells.push(c)
      forEachNeighbour(c, (n) => {
        if (!seen[n] && isBasin(n)) {
          seen[n] = 1
          stack.push(n)
        }
      })
    }
    const maxDepth = Math.max(...cells.map((c) => filled[c]! - height[c]!))
    if (cells.length >= LAKE_MIN_CELLS && maxDepth >= LAKE_MIN_MAX_DEPTH) {
      const level = Math.max(...cells.map((c) => filled[c]!))
      for (const c of cells) {
        lakeId[c] = lakes.length
      }
      lakes.push({ cells, level, maxDepth })
    }
  }

  // 3b. Rivers: trace chains downstream from each head.
  const isRiver = (index: number) =>
    inside[index] === 1 && lakeId[index]! < 0 && accumulation[index]! >= RIVER_MIN_CELLS
  const upstreamOf = (index: number) => {
    const sources: number[] = []
    forEachNeighbour(index, (n) => {
      if (down[n] === index) {
        sources.push(n)
      }
    })
    return sources
  }
  const traced = new Uint8Array(count)
  const rivers: River[] = []
  for (const head of order) {
    if (!isRiver(head) || traced[head] || upstreamOf(head).some(isRiver)) {
      continue
    }
    const cells: number[] = []
    const fromLake = upstreamOf(head).find((n) => lakeId[n]! >= 0)
    if (fromLake !== undefined) {
      cells.push(fromLake)
    }
    let c = head
    let outlet = false
    for (;;) {
      cells.push(c)
      traced[c] = 1
      const d = down[c]!
      if (d < 0) {
        outlet = true
        break
      }
      if (lakeId[d]! >= 0 || traced[d]) {
        cells.push(d)
        break
      }
      c = d
    }
    const river = buildRiver(cells, outlet, accumulation, lakes, lakeId)
    if (river.points[river.points.length - 1]!.distance >= RIVER_MIN_LENGTH) {
      rivers.push(river)
    }
  }

  // Moisture: distance to water (chamfer transform), plus valley floors.
  const river = new Uint8Array(count)
  const distance = new Float32Array(count).fill(Infinity)
  for (let index = 0; index < count; index += 1) {
    if (isRiver(index)) {
      river[index] = 1
    }
    if (lakeId[index]! >= 0 || river[index]) {
      distance[index] = 0
    }
  }
  const relax = (index: number) => {
    forEachNeighbour(index, (n, step) => {
      if (distance[n]! + step < distance[index]!) {
        distance[index] = distance[n]! + step
      }
    })
  }
  for (let index = 0; index < count; index += 1) {
    relax(index)
  }
  for (let index = count - 1; index >= 0; index -= 1) {
    relax(index)
  }
  const logRiver = Math.log(RIVER_MIN_CELLS)
  const moisture = new Float32Array(count)
  const waterDistance = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    waterDistance[index] = distance[index]! * CELL
    if (inside[index]) {
      const near = Math.exp(-waterDistance[index]! / MOISTURE_RANGE)
      const valley = Math.min(1, Math.log(accumulation[index]!) / logRiver) ** 2
      moisture[index] = Math.min(1, near + VALLEY_MOISTURE * valley)
    }
  }

  return { inside, accumulation, lakeId, lakes, rivers, river, waterDistance, moisture }
}

function buildRiver(
  cells: number[],
  outlet: boolean,
  accumulation: Float32Array,
  lakes: Lake[],
  lakeId: Int16Array,
): River {
  const trace: TracePoint[] = cells.map((c) => {
    const [x, z] = cellCenter(c)
    return { x, z, value: accumulation[c]! }
  })
  if (outlet) {
    const last = trace[trace.length - 1]!
    const angle = Math.atan2(last.z, last.x)
    const rim = outlineRadius(angle)
    trace.push({ x: rim * Math.cos(angle), z: rim * Math.sin(angle), value: last.value })
  }
  const smooth = smoothTrace(trace, RIVER_SMOOTHING)
  const startLake = lakeId[cells[0]!]!
  let level = startLake >= 0 ? lakes[startLake]!.level : Infinity
  let distance = 0
  const points = smooth.map((point, k) => {
    if (k > 0) {
      distance += Math.hypot(point.x - smooth[k - 1]!.x, point.z - smooth[k - 1]!.z)
    }
    level = Math.min(level, surfaceHeight(point.x, point.z) - RIVER_LEVEL_DROP)
    return {
      x: point.x,
      z: point.z,
      level,
      halfWidth: riverHalfWidth(point.value),
      depth: riverDepth(point.value),
      distance,
    }
  })
  return { points, outlet }
}
