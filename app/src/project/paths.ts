import type { BufferGeometry } from 'three'
import {
  CELL,
  cellCenter,
  cellIndex,
  forEachNeighbour,
  GRID_EXTENT,
  GRID_SIZE,
  MinHeap,
  smoothTrace,
  type TracePoint,
} from './grid.ts'
import type { Hydrology } from './hydrology.ts'
import { MeshBuilder, type RibbonPoint } from './meshBuilder.ts'
import { outlineRadius } from './terrain.ts'

/**
 * Shadow Ecology — paths as least-cost routes over the ground: climbing is
 * expensive, crossing a river costs a ford, lakes and architecture cannot be
 * crossed. The primary network links the architecture sites by a minimum
 * spanning tree, shortest links first, and the nearest site to the falls.
 * Secondary spurs then reach out to destinations (water edges, vegetation
 * and habitat regions), each joining the nearest path already laid, nearest
 * first. Each route makes the ground it uses cheaper for the next, so later
 * routes join earlier ones and trunks form.
 */
const SLOPE_COST = 40
const FORD_COST = 0.6
const REUSE_DISCOUNT = 0.45
const RIM_LIMIT = 0.93
const SMOOTHING = 3
const SAMPLE_SPACING = 0.03
const PATH_HALF_WIDTH = 0.042
const SPUR_HALF_WIDTH = 0.03
const PATH_LIFT = 0.01
/** How far a fall's viewpoint sits back from the rim. */
const VIEWPOINT_INSET = 0.3
/** Destinations already this close to a path need no spur. */
const SPUR_MIN = 0.2

export type Destination = { x: number; z: number }

export type PathLine = { points: { x: number; z: number }[]; primary: boolean }

export type Paths = {
  geometry: BufferGeometry
  /** World distance from each cell to the nearest path. */
  distance: Float32Array
  length: number
  /** Each route's smoothed centre line, in xz; primary routes link sites, the rest are spurs. */
  lines: PathLine[]
}

/** Up to `count` peaks of `field` at or above `threshold`, at least `spacing` apart, highest first. */
export function fieldPeaks(field: Float32Array, count: number, threshold: number, spacing: number): Destination[] {
  const candidates: number[] = []
  for (let index = 0; index < field.length; index += 1) {
    if (field[index]! >= threshold) {
      candidates.push(index)
    }
  }
  candidates.sort((a, b) => field[b]! - field[a]!)
  const peaks: Destination[] = []
  for (const index of candidates) {
    const [x, z] = cellCenter(index)
    if (peaks.every((peak) => Math.hypot(peak.x - x, peak.z - z) >= spacing)) {
      peaks.push({ x, z })
      if (peaks.length === count) {
        break
      }
    }
  }
  return peaks
}

/** A shore point on each lake nearest to `near`, and the middle of the longest rivers. */
export function waterEdges(hydrology: Hydrology, near: Destination, rivers = 2): Destination[] {
  const edges: Destination[] = []
  for (const lake of hydrology.lakes) {
    let best: Destination | null = null
    let bestGap = Infinity
    for (const cell of lake.cells) {
      forEachNeighbour(cell, (n) => {
        if (hydrology.inside[n] && hydrology.lakeId[n]! < 0 && !hydrology.river[n]) {
          const [x, z] = cellCenter(n)
          const gap = Math.hypot(x - near.x, z - near.z)
          if (gap < bestGap) {
            bestGap = gap
            best = { x, z }
          }
        }
      })
    }
    if (best) {
      edges.push(best)
    }
  }
  const longest = [...hydrology.rivers].sort((a, b) => b.points.length - a.points.length).slice(0, rivers)
  for (const river of longest) {
    const middle = river.points[Math.floor(river.points.length / 2)]!
    edges.push({ x: middle.x, z: middle.z })
  }
  return edges
}

export function createPaths(
  hydrology: Hydrology,
  groundHeight: (x: number, z: number) => number,
  footprint: Uint8Array,
  sites: { x: number; z: number }[],
  destinations: Destination[] = [],
): Paths {
  const count = GRID_SIZE * GRID_SIZE
  const blocked = new Uint8Array(count)
  const height = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    const [x, z] = cellCenter(index)
    const rim = Math.hypot(x, z) / outlineRadius(Math.atan2(z, x))
    blocked[index] =
      !hydrology.inside[index] || hydrology.lakeId[index]! >= 0 || rim > RIM_LIMIT || footprint[index]
        ? 1
        : 0
    height[index] = blocked[index] ? 0 : groundHeight(x, z)
  }

  const nearestOpen = (x: number, z: number) => {
    const clamp = (v: number) =>
      Math.min(GRID_SIZE - 1, Math.max(0, Math.floor((v + GRID_EXTENT) / CELL)))
    const start = cellIndex(clamp(x), clamp(z))
    const queue = [start]
    const seen = new Set(queue)
    while (queue.length > 0) {
      const c = queue.shift()!
      if (!blocked[c]) {
        return c
      }
      forEachNeighbour(c, (n) => {
        if (!seen.has(n)) {
          seen.add(n)
          queue.push(n)
        }
      })
    }
    return start
  }

  const routes: [number, number][] = []
  const nodes = sites.map((site) => ({ ...site, cell: nearestOpen(site.x, site.z) }))
  const gap = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    Math.hypot(a.x - b.x, a.z - b.z)
  // Prim's minimum spanning tree over the sites.
  const linked = nodes.length > 0 ? [nodes[0]!] : []
  const links: { from: number; to: number; length: number }[] = []
  while (linked.length < nodes.length) {
    let best: { from: (typeof nodes)[number]; to: (typeof nodes)[number]; length: number } | null = null
    for (const from of linked) {
      for (const to of nodes) {
        if (!linked.includes(to) && (!best || gap(from, to) < best.length)) {
          best = { from, to, length: gap(from, to) }
        }
      }
    }
    linked.push(best!.to)
    links.push({ from: best!.from.cell, to: best!.to.cell, length: best!.length })
  }
  const fall = hydrology.rivers.find((river) => river.outlet)
  if (fall && nodes.length > 0) {
    const rim = fall.points[fall.points.length - 1]!
    const scale = 1 - VIEWPOINT_INSET / Math.hypot(rim.x, rim.z)
    const viewpoint = { x: rim.x * scale, z: rim.z * scale }
    const nearest = nodes.reduce((a, b) => (gap(a, viewpoint) <= gap(b, viewpoint) ? a : b))
    links.push({
      from: nearest.cell,
      to: nearestOpen(viewpoint.x, viewpoint.z),
      length: gap(nearest, viewpoint),
    })
  }
  links.sort((a, b) => a.length - b.length)
  for (const link of links) {
    routes.push([link.from, link.to])
  }

  const onPath = new Uint8Array(count)
  const network: number[] = nodes.map((node) => node.cell)
  const builder = new MeshBuilder(['aFlow', 'aAcross'])
  const lines: Paths['lines'] = []
  let length = 0
  const lay = (from: number, to: number, primary: boolean) => {
    const cells = leastCostRoute(from, to, blocked, height, hydrology.river, onPath)
    if (cells.length < 2) {
      return
    }
    for (const c of cells) {
      if (!onPath[c]) {
        onPath[c] = 1
        network.push(c)
      }
    }
    const trace: TracePoint[] = cells.map((c) => {
      const [x, z] = cellCenter(c)
      return { x, z, value: 0 }
    })
    const points = resample(smoothTrace(trace, SMOOTHING))
    let distance = 0
    const ribbon: RibbonPoint[] = points.map((point, k) => {
      if (k > 0) {
        distance += Math.hypot(point.x - points[k - 1]!.x, point.z - points[k - 1]!.z)
      }
      return {
        x: point.x,
        y: groundHeight(point.x, point.z) + PATH_LIFT,
        z: point.z,
        halfWidth: primary ? PATH_HALF_WIDTH : SPUR_HALF_WIDTH,
        values: { aFlow: distance },
      }
    })
    builder.ribbon(ribbon)
    lines.push({ points: points.map(({ x, z }) => ({ x, z })), primary })
    length += distance
  }
  for (const [from, to] of routes) {
    lay(from, to, true)
  }

  const nearestOnNetwork = (x: number, z: number) => {
    let best = -1
    let bestGap = Infinity
    for (const c of network) {
      const [cx, cz] = cellCenter(c)
      const gap = Math.hypot(cx - x, cz - z)
      if (gap < bestGap) {
        bestGap = gap
        best = c
      }
    }
    return { cell: best, gap: bestGap }
  }
  const pending = destinations.map((d) => nearestOpen(d.x, d.z)).filter((c) => !blocked[c])
  while (pending.length > 0 && network.length > 0) {
    const reach = pending.map((c) => {
      const [x, z] = cellCenter(c)
      return nearestOnNetwork(x, z)
    })
    let next = 0
    for (let k = 1; k < pending.length; k += 1) {
      if (reach[k]!.gap < reach[next]!.gap) {
        next = k
      }
    }
    const from = pending.splice(next, 1)[0]!
    if (reach[next]!.gap >= SPUR_MIN) {
      lay(from, reach[next]!.cell, false)
    }
  }

  return { geometry: builder.build(), distance: distanceField(onPath), length, lines }
}

function leastCostRoute(
  from: number,
  to: number,
  blocked: Uint8Array,
  height: Float32Array,
  river: Uint8Array,
  onPath: Uint8Array,
): number[] {
  const cost = new Float32Array(blocked.length).fill(Infinity)
  const previous = new Int32Array(blocked.length).fill(-1)
  const done = new Uint8Array(blocked.length)
  const heap = new MinHeap()
  cost[from] = 0
  heap.push(from, 0)
  while (heap.size > 0) {
    const c = heap.pop()
    if (c === to) {
      break
    }
    if (done[c]) {
      continue
    }
    done[c] = 1
    forEachNeighbour(c, (n, step) => {
      if (blocked[n] || done[n]) {
        return
      }
      const run = step * CELL
      const grade = (height[n]! - height[c]!) / run
      let stepCost = run * (1 + SLOPE_COST * grade * grade) + (river[n] ? FORD_COST : 0)
      if (onPath[n]) {
        stepCost *= REUSE_DISCOUNT
      }
      if (cost[c]! + stepCost < cost[n]!) {
        cost[n] = cost[c]! + stepCost
        previous[n] = c
        heap.push(n, cost[n]!)
      }
    })
  }
  const cells = [to]
  while (previous[cells[cells.length - 1]!]! >= 0) {
    cells.push(previous[cells[cells.length - 1]!]!)
  }
  return cells.reverse()
}

function resample(points: TracePoint[]): TracePoint[] {
  const out: TracePoint[] = [points[0]!]
  for (let k = 1; k < points.length; k += 1) {
    const a = points[k - 1]!
    const b = points[k]!
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / SAMPLE_SPACING))
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, value: 0 })
    }
  }
  return out
}

function distanceField(onPath: Uint8Array): Float32Array {
  const distance = new Float32Array(onPath.length).fill(Infinity)
  for (let index = 0; index < onPath.length; index += 1) {
    if (onPath[index]) {
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
  for (let index = 0; index < onPath.length; index += 1) {
    relax(index)
  }
  for (let index = onPath.length - 1; index >= 0; index -= 1) {
    relax(index)
  }
  return distance.map((cells) => cells * CELL)
}
