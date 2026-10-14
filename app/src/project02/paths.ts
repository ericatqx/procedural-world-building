import type { Architecture } from './architecture.ts'
import { CELL, GRID_EXTENT, GRID_SIZE, cellIndex } from './grid.ts'
import type { Fields } from './fields.ts'
import type { Statics } from './statics.ts'

/**
 * Shadow Ecology 0.2 — paths as traces of use, after Week 06's connection
 * method. Nothing is laid down in advance: every few world hours a seeded trip
 * goes between two meaningful places (standing architecture, reachable shore,
 * sheltered hollows), choosing nearer and more useful pairs more often, along
 * a least-cost route over the terrain (gentle slopes cheap; cliffs and the rim
 * impassable; lakes and structures walked around, streams forded only where
 * there is no other way). Each trip wears its route a
 * little, and worn ground is cheaper to walk, so use converges onto a few
 * lines that darken over days — and fade again once nothing goes that way.
 *
 * Routes run on a coarse grid (one cell per 2×2 field cells) and only when a
 * trip is due, never per frame. Trips draw from a hash of the world seed and
 * the trip count, not the world's random stream, so the same seed always
 * wears the same network.
 */

const R = 2
const N = GRID_SIZE / R
const ROUTE_CELL = (2 * GRID_EXTENT) / N
/** World hours between trips. */
const TRIP_HOURS = 3
/** Wear a trip leaves on a fresh cell, and how long an unused trace takes to fade. */
const WEAR = 0.16
const FADE_HOURS = 360
/** Slope (degrees) beyond which ground can't be walked; below it the cost climbs steeply. */
const MAX_SLOPE = 48
/** Share of the cost worn ground saves, so routes converge. */
const REUSE = 0.7
/**
 * Cost of a water cell: high enough that lakes are walked around, low enough
 * that a narrow stream is forded where no other way exists. Banks cost a little extra.
 */
const FORD = 30
const BANK = 4
/** Extra cost of crossing a structure's footprint (it is walked around, but its door can be reached). */
const FOOTPRINT_COST = 4
/** World distance over which a destination's pull halves. */
const REACH = 5
/** Trail level that counts as a worn path, for the length readout. */
const WORN = 0.25

type Place = { cell: number; weight: number }
type Terrain = { cost: Float32Array; shore: Place[]; shelter: Place[] }

const terrainCache = new WeakMap<Statics, Map<number, Terrain>>()

function rngFrom(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const fine = (cell: number) => cellIndex((cell % N) * R, Math.floor(cell / N) * R)

/** Seeded, spread-out picks from the candidates (greedy farthest point). */
function spread(candidates: number[], count: number, rng: () => number, weight: number): Place[] {
  if (!candidates.length) return []
  const picks = [candidates[Math.floor(rng() * candidates.length)]!]
  while (picks.length < Math.min(count, candidates.length)) {
    let best = -1
    let bestGap = -1
    for (let k = 0; k < 160; k += 1) {
      const c = candidates[Math.floor(rng() * candidates.length)]!
      let gap = Infinity
      for (const p of picks) gap = Math.min(gap, (c % N - (p % N)) ** 2 + (Math.floor(c / N) - Math.floor(p / N)) ** 2)
      if (gap > bestGap) {
        bestGap = gap
        best = c
      }
    }
    picks.push(best)
  }
  return picks.map((cell) => ({ cell, weight }))
}

/** Walking cost per coarse cell (Infinity where impassable) and the seed's fixed destinations. */
function terrainFor(statics: Statics, seed: number): Terrain {
  let bySeed = terrainCache.get(statics)
  if (!bySeed) terrainCache.set(statics, (bySeed = new Map()))
  const cached = bySeed.get(seed)
  if (cached) return cached
  const cost = new Float32Array(N * N)
  const shoreCells: number[] = []
  const shelterCells: number[] = []
  for (let cell = 0; cell < N * N; cell += 1) {
    const index = fine(cell)
    const slope = statics.slope[index]!
    if (!statics.inside[index] || statics.rim[index]! > 0.96) {
      cost[cell] = Infinity
      continue
    }
    if (statics.water[index]) {
      cost[cell] = FORD
      continue
    }
    if (slope > MAX_SLOPE) {
      cost[cell] = Infinity
      continue
    }
    cost[cell] = 1 + (slope / 14) ** 2 + 0.6 * statics.edge[index]! + (statics.waterDistance[index]! < 0.12 ? BANK : 0)
  }
  // Keep only the largest connected walkable region, so every pair of places can reach each other.
  const region = new Int32Array(N * N).fill(-1)
  const sizes: number[] = []
  for (let cell = 0; cell < N * N; cell += 1) {
    if (cost[cell] === Infinity || region[cell]! >= 0) continue
    const id = sizes.length
    let size = 0
    const stack = [cell]
    region[cell] = id
    while (stack.length) {
      const c = stack.pop()!
      size += 1
      for (const [di, dj] of STEPS) {
        const i = (c % N) + di
        const j = Math.floor(c / N) + dj
        if (i < 0 || j < 0 || i >= N || j >= N) continue
        const next = i + j * N
        if (cost[next] === Infinity || region[next]! >= 0) continue
        region[next] = id
        stack.push(next)
      }
    }
    sizes.push(size)
  }
  const main = sizes.indexOf(Math.max(...sizes))
  for (let cell = 0; cell < N * N; cell += 1) {
    if (region[cell] !== main) {
      cost[cell] = Infinity
      continue
    }
    const index = fine(cell)
    if (statics.water[index]) continue
    const slope = statics.slope[index]!
    if (slope < 18 && statics.waterDistance[index]! < 0.6) shoreCells.push(cell)
    if (slope < 20 && statics.enclosure[index]! > 0.45 && statics.waterDistance[index]! > 1) shelterCells.push(cell)
  }
  const rng = rngFrom(seed * 7919 + 17)
  const terrain = { cost, shore: spread(shoreCells, 6, rng, 1.5), shelter: spread(shelterCells, 4, rng, 1) }
  bySeed.set(seed, terrain)
  return terrain
}

/** Nearest walkable land cell (in the connected region) to a world point, or −1. */
function walkableNear(cost: Float32Array, x: number, z: number): number {
  const ci = Math.floor((x + GRID_EXTENT) / ROUTE_CELL)
  const cj = Math.floor((z + GRID_EXTENT) / ROUTE_CELL)
  for (let r = 0; r <= 8; r += 1) {
    for (let dj = -r; dj <= r; dj += 1) {
      for (let di = -r; di <= r; di += 1) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue
        const i = ci + di
        const j = cj + dj
        if (i < 0 || j < 0 || i >= N || j >= N) continue
        if (cost[i + j * N]! < FORD) return i + j * N
      }
    }
  }
  return -1
}

const g = new Float32Array(N * N)
const from = new Int32Array(N * N)
const stamp = new Uint32Array(N * N)
let search = 0
const STEPS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const

/** A* over the coarse grid; worn ground and open slopes are cheap. Returns cells from goal back to start. */
function route(terrain: Terrain, fields: Fields, trail: Float32Array, start: number, goal: number): number[] | null {
  search += 1
  const heap: number[] = []
  const score: number[] = []
  const push = (cell: number, f: number) => {
    let n = heap.length
    heap.push(cell)
    score.push(f)
    while (n > 0) {
      const parent = (n - 1) >> 1
      if (score[parent]! <= f) break
      heap[n] = heap[parent]!
      score[n] = score[parent]!
      n = parent
    }
    heap[n] = cell
    score[n] = f
  }
  const pop = () => {
    const top = heap[0]!
    const lastCell = heap.pop()!
    const lastScore = score.pop()!
    if (heap.length) {
      let n = 0
      for (;;) {
        const a = 2 * n + 1
        if (a >= heap.length) break
        const b = a + 1
        const child = b < heap.length && score[b]! < score[a]! ? b : a
        if (score[child]! >= lastScore) break
        heap[n] = heap[child]!
        score[n] = score[child]!
        n = child
      }
      heap[n] = lastCell
      score[n] = lastScore
    }
    return top
  }
  const gx = goal % N
  const gz = Math.floor(goal / N)
  const h = (cell: number) => Math.hypot((cell % N) - gx, Math.floor(cell / N) - gz) * (1 - REUSE)
  stamp[start] = search
  g[start] = 0
  from[start] = -1
  push(start, h(start))
  while (heap.length) {
    const cell = pop()
    if (cell === goal) {
      const path: number[] = []
      for (let c = goal; c >= 0; c = from[c]!) path.push(c)
      return path
    }
    const ci = cell % N
    const cj = Math.floor(cell / N)
    for (const [di, dj, length] of STEPS) {
      const i = ci + di
      const j = cj + dj
      if (i < 0 || j < 0 || i >= N || j >= N) continue
      const next = i + j * N
      const base = terrain.cost[next]!
      if (base === Infinity) continue
      const index = fine(next)
      const walk = (base + (fields.footprint[index] ? FOOTPRINT_COST : 0)) * (1 - REUSE * Math.min(1, trail[index]! * 2.5))
      const total = g[cell]! + walk * length
      if (stamp[next] === search && total >= g[next]!) continue
      stamp[next] = search
      g[next] = total
      from[next] = cell
      push(next, total + h(next))
    }
  }
  return null
}

function weightedPick<T>(items: T[], weights: number[], rng: () => number): T | null {
  let sum = 0
  for (const w of weights) sum += w
  if (sum <= 0) return null
  let r = rng() * sum
  for (let k = 0; k < items.length; k += 1) {
    r -= weights[k]!
    if (r <= 0) return items[k]!
  }
  return items[items.length - 1]!
}

/** One seeded trip: pick a useful pair of places, route between them, wear the route. */
function trip(fields: Fields, statics: Statics, arch: Architecture, seed: number, terrain: Terrain) {
  const rng = rngFrom(Math.imul(seed + 1, 0x9e3779b1) ^ Math.imul(fields.trailTrips + 1, 0x85ebca6b))
  fields.trailTrips += 1
  const places: Place[] = [...terrain.shore, ...terrain.shelter]
  for (const site of arch.sites) {
    if (site.voxels < 12) continue
    const cell = walkableNear(terrain.cost, site.x, site.z)
    if (cell >= 0) places.push({ cell, weight: 1 + Math.sqrt(site.voxels) / 4 })
  }
  if (places.length < 2) return
  const origin = weightedPick(places, places.map((p) => p.weight), rng)!
  const others = places.filter((p) => p.cell !== origin.cell)
  const pull = others.map((p) => {
    const d = Math.hypot((p.cell % N) - (origin.cell % N), Math.floor(p.cell / N) - Math.floor(origin.cell / N)) * ROUTE_CELL
    return p.weight / (1 + d / REACH) ** 2
  })
  const goal = weightedPick(others, pull, rng)
  if (!goal) return
  const path = route(terrain, fields, fields.trail, origin.cell, goal.cell)
  if (!path) return
  for (const cell of path) {
    const i0 = (cell % N) * R
    const j0 = Math.floor(cell / N) * R
    for (let dj = 0; dj < R; dj += 1) {
      for (let di = 0; di < R; di += 1) {
        const index = cellIndex(i0 + di, j0 + dj)
        if (!statics.inside[index] || statics.water[index]) continue
        fields.trail[index] = fields.trail[index]! + WEAR * (1 - fields.trail[index]!)
      }
    }
  }
}

/** Advances use over `hours`: fades every trace a little, then makes the trips that fell due. */
export function wearPaths(fields: Fields, statics: Statics, arch: Architecture, seed: number, hours: number) {
  fields.trail ??= new Float32Array(GRID_SIZE * GRID_SIZE)
  fields.trailTrips ??= 0
  fields.trailClock ??= 0
  const fade = Math.exp(-hours / FADE_HOURS)
  for (let index = 0; index < fields.trail.length; index += 1) fields.trail[index] = fields.trail[index]! * fade
  fields.trailClock += hours
  if (fields.trailClock < TRIP_HOURS) return
  const terrain = terrainFor(statics, seed)
  while (fields.trailClock >= TRIP_HOURS) {
    fields.trailClock -= TRIP_HOURS
    trip(fields, statics, arch, seed, terrain)
  }
  let worn = 0
  for (let index = 0; index < fields.trail.length; index += 1) if (fields.trail[index]! > WORN) worn += 1
  fields.trailLength = (worn / R) * CELL
}
