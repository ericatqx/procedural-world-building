import {
  DEFAULT_GRID,
  gridCellCenter,
  gridForEachNeighbour,
  MinHeap,
  smoothTrace,
  type AnalysisGrid,
  type TracePoint,
} from './grid.ts'
import { ISLAND_SHAPE, surfaceHeightOf, type TerrainShape, type WaterLayout } from './terrain.ts'

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

export const riverHalfWidth = (cells: number, cell = DEFAULT_GRID.cell) => 0.03 + 0.035 * Math.sqrt(cells * cell * cell)
export const riverDepth = (cells: number, cell = DEFAULT_GRID.cell) => 0.03 + 0.015 * Math.sqrt(cells * cell * cell)

export function createHydrology(shape: TerrainShape = ISLAND_SHAPE, grid: AnalysisGrid = DEFAULT_GRID): Hydrology {
  const { outlineRadius } = shape
  const surfaceHeight = surfaceHeightOf(shape)
  const riverMinCells = shape.water?.riverMinCells ?? RIVER_MIN_CELLS
  const lakeMinCells = shape.water?.lakeMinCells ?? LAKE_MIN_CELLS
  const lakeMinMaxDepth = shape.water?.lakeMinMaxDepth ?? LAKE_MIN_MAX_DEPTH
  const count = grid.size * grid.size
  const at = (index: number) => gridCellCenter(grid, index)
  const neighboursOf = (index: number, visit: (neighbour: number, stepCells: number) => void) =>
    gridForEachNeighbour(grid, index, visit)
  const inside = new Uint8Array(count)
  const height = new Float32Array(count)
  /** Rim cells: water reaching them spills off the edge. */
  const boundary = new Uint8Array(count)
  for (let index = 0; index < count; index += 1) {
    const [x, z] = at(index)
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
    neighboursOf(index, (n) => {
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
    neighboursOf(c, (n) => {
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
    neighboursOf(index, (n, step) => {
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
      neighboursOf(c, (n) => {
        if (!seen[n] && isBasin(n)) {
          seen[n] = 1
          stack.push(n)
        }
      })
    }
    const maxDepth = Math.max(...cells.map((c) => filled[c]! - height[c]!))
    if (cells.length >= lakeMinCells && maxDepth >= lakeMinMaxDepth) {
      const level = Math.max(...cells.map((c) => filled[c]!))
      for (const c of cells) {
        lakeId[c] = lakes.length
      }
      lakes.push({ cells, level, maxDepth })
    }
  }

  // 3a′. Authored lakes replace the ones read from the basins.
  const layout = shape.water?.layout
  if (layout) {
    lakeId.fill(-1)
    lakes.length = 0
    for (const spec of layout.lakes) {
      const cells: number[] = []
      for (let index = 0; index < count; index += 1) {
        const [x, z] = at(index)
        if (inside[index] && !boundary[index] && height[index]! < spec.level && spec.contains(x, z)) {
          lakeId[index] = lakes.length
          cells.push(index)
        }
      }
      const maxDepth = Math.max(0, ...cells.map((c) => spec.level - height[c]!))
      lakes.push({ cells, level: spec.level, maxDepth })
    }
  }

  // 3b. Rivers.
  const isRiver = (index: number) =>
    inside[index] === 1 && lakeId[index]! < 0 && accumulation[index]! >= riverMinCells
  const upstreamOf = (index: number) => {
    const sources: number[] = []
    neighboursOf(index, (n) => {
      if (down[n] === index) {
        sources.push(n)
      }
    })
    return sources
  }
  const rivers: River[] = []
  /** 1 under a drawn river. */
  const river = new Uint8Array(count)
  const addRiver = (cells: number[], outlet: boolean) => {
    const built = buildRiver(cells, outlet, accumulation, lakes, lakeId, shape, grid)
    if (built.points[built.points.length - 1]!.distance < RIVER_MIN_LENGTH) {
      return
    }
    rivers.push(built)
  }

  if (layout) {
    for (const spec of layout.rivers) {
      const built = layoutRiver(spec, lakes, lakeId, shape, grid)
      rivers.push(built)
      // Every cell the ribbon covers is river.
      for (const point of built.points) {
        const reach = Math.ceil((point.halfWidth + grid.cell) / grid.cell)
        const ci = Math.floor((point.x + grid.extent) / grid.cell)
        const cj = Math.floor((point.z + grid.extent) / grid.cell)
        for (let j = cj - reach; j <= cj + reach; j += 1) {
          for (let i = ci - reach; i <= ci + reach; i += 1) {
            if (i < 0 || j < 0 || i >= grid.size || j >= grid.size) continue
            const index = i + j * grid.size
            const [x, z] = at(index)
            if (inside[index] && lakeId[index]! < 0 && Math.hypot(x - point.x, z - point.z) < point.halfWidth + grid.cell / 2) {
              river[index] = 1
            }
          }
        }
      }
    }
    joinTributaries(rivers)
  } else {
    // Every chain draining enough ground, traced downstream from each head.
    const traced = new Uint8Array(count)
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
      addRiver(cells, outlet)
    }
    for (let index = 0; index < count; index += 1) {
      river[index] = isRiver(index) ? 1 : 0
    }
  }

  // Moisture: distance to water (chamfer transform), plus valley floors.
  // Flow lines not drawn as rivers still count here, as drainage.
  const distance = new Float32Array(count).fill(Infinity)
  for (let index = 0; index < count; index += 1) {
    if (lakeId[index]! >= 0 || isRiver(index) || river[index]) {
      distance[index] = 0
    }
  }
  const relax = (index: number) => {
    neighboursOf(index, (n, step) => {
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
  const logRiver = Math.log(riverMinCells)
  const moisture = new Float32Array(count)
  const waterDistance = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    waterDistance[index] = distance[index]! * grid.cell
    if (inside[index]) {
      const near = Math.exp(-waterDistance[index]! / MOISTURE_RANGE)
      const valley = Math.min(1, Math.log(accumulation[index]!) / logRiver) ** 2
      moisture[index] = Math.min(1, near + VALLEY_MOISTURE * valley)
    }
  }

  return { inside, accumulation, lakeId, lakes, rivers, river, waterDistance, moisture }
}

/** Authored rivers sit this far into the ground, so their edges tuck into the channel banks. */
const LAYOUT_LEVEL_DROP = 0.045
/** Authored rivers always fall at least this much per unit, so no stretch reads as a flat sheet. */
const LAYOUT_MIN_GRADE = 0.06
/** Under a lake's surface, so a river crossing into or out of it never shows above it. */
const UNDER_LAKE = 0.004
/** How far upstream of a lake's shore a river's descent may stretch to meet its surface. */
const ARRIVAL_REACH = 1

/**
 * An authored river: its surface leaves its lake at the lake's level, then
 * falls continuously (cutting its channel through any rise) and passes
 * under the surface of any lake it reaches.
 */
function layoutRiver(
  spec: WaterLayout['rivers'][number],
  lakes: Lake[],
  lakeId: Int16Array,
  shape: TerrainShape,
  grid: AnalysisGrid,
): River {
  const surfaceHeight = surfaceHeightOf(shape)
  const trace = [...spec.points]
  if (spec.outlet) {
    const last = trace[trace.length - 1]!
    const angle = Math.atan2(last.z, last.x)
    const rim = shape.outlineRadius(angle)
    trace.push({ x: rim * Math.cos(angle), z: rim * Math.sin(angle), flow: last.flow })
  }
  const col = (v: number) => Math.min(grid.size - 1, Math.max(0, Math.floor((v + grid.extent) / grid.cell)))
  const lakeAt = (x: number, z: number) => lakeId[col(x) + col(z) * grid.size]!
  const startLake = lakeAt(trace[0]!.x, trace[0]!.z)
  let inStart = startLake >= 0
  let level = Infinity
  let distance = 0
  const points = trace.map((point, k) => {
    const step = k > 0 ? Math.hypot(point.x - trace[k - 1]!.x, point.z - trace[k - 1]!.z) : 0
    distance += step
    const lake = lakeAt(point.x, point.z)
    inStart &&= lake === startLake
    if (inStart) {
      level = lakes[startLake]!.level - UNDER_LAKE
    } else {
      level = Math.min(level - LAYOUT_MIN_GRADE * step, surfaceHeight(point.x, point.z) - LAYOUT_LEVEL_DROP)
      if (lake >= 0) level = Math.min(level, lakes[lake]!.level - UNDER_LAKE)
    }
    return {
      x: point.x,
      z: point.z,
      level,
      halfWidth: riverHalfWidth(point.flow, grid.cell) * (shape.riverScale ?? 1),
      depth: riverDepth(point.flow, grid.cell) * (shape.riverScale ?? 1),
      distance,
    }
  })
  // Arriving at a lake, the river comes down to its surface, never below it.
  const last = trace[trace.length - 1]!
  const endLake = lakeAt(last.x, last.z)
  const entry = points.findIndex((point) => endLake >= 0 && lakeAt(point.x, point.z) === endLake)
  const floor = endLake >= 0 ? lakes[endLake]!.level - UNDER_LAKE : -Infinity
  const exit = Math.max(0, points.findIndex((point) => lakeAt(point.x, point.z) !== startLake))
  const anchor = entry > 0 ? points.findIndex((point, k) => k >= exit && point.distance >= points[entry]!.distance - ARRIVAL_REACH) : -1
  const top = anchor >= 0 ? points[anchor]!.level : floor
  const arrive = entry > 0 ? points[entry - 1]!.level : floor
  if (endLake !== startLake && anchor >= 0 && anchor < entry && arrive < floor && top > floor) {
    // Stretch the last of the descent so it lands on the lake's surface at the shore.
    const scale = (top - floor) / (top - arrive)
    for (let k = anchor; k < entry; k += 1) {
      const stretched = floor + (points[k]!.level - arrive) * scale
      points[k]!.level = Math.min(stretched, surfaceHeight(trace[k]!.x, trace[k]!.z) - UNDER_LAKE)
    }
  }
  return { points, outlet: spec.outlet }
}

/** How steeply a tributary's tail may drop to meet the river it joins. */
const JOIN_GRADE = 0.5

/**
 * A river that ends on another river ramps its tail down to that river's
 * surface, so the two meet instead of one ending above the other.
 */
function joinTributaries(rivers: River[]) {
  for (const tributary of rivers) {
    if (tributary.outlet) continue
    const end = tributary.points[tributary.points.length - 1]!
    let target = Infinity
    let best = Infinity
    for (const other of rivers) {
      if (other === tributary) continue
      for (const point of other.points) {
        const gap = Math.hypot(point.x - end.x, point.z - end.z)
        if (gap < best && gap < point.halfWidth * 1.5) {
          best = gap
          target = point.level
        }
      }
    }
    if (target >= end.level) continue
    for (const point of tributary.points) {
      point.level = Math.min(point.level, target + JOIN_GRADE * (end.distance - point.distance))
    }
  }
}

function buildRiver(
  cells: number[],
  outlet: boolean,
  accumulation: Float32Array,
  lakes: Lake[],
  lakeId: Int16Array,
  shape: TerrainShape,
  grid: AnalysisGrid,
): River {
  const { outlineRadius } = shape
  const surfaceHeight = surfaceHeightOf(shape)
  const trace: TracePoint[] = cells.map((c) => {
    const [x, z] = gridCellCenter(grid, c)
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
      halfWidth: riverHalfWidth(point.value, grid.cell) * (shape.riverScale ?? 1),
      depth: riverDepth(point.value, grid.cell) * (shape.riverScale ?? 1),
      distance,
    }
  })
  return { points, outlet }
}
