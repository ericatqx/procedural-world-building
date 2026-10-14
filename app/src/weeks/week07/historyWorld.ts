import { sunAt } from '../../project/sun.ts'
import { ARCH_CENTRE, GROWTH_NOON, LEVELS, ORIGIN_VOXELS } from './architecture.ts'
import {
  CELL,
  CELLS,
  cellAt,
  cellOf,
  cellX,
  cellZ,
  GRID,
  LEVEL,
  LOWLAND_MOISTURE,
  MOISTURE_RANGE,
  SITE,
  WATER_LEVEL,
} from './site.ts'

export { CELL, CELLS, cellX, cellZ, GRID, HALF, LEVEL, SITE } from './site.ts'
export { LEVELS } from './architecture.ts'

/**
 * Week 07 Branching Histories — a small Shadow Ecology site on a grid, and
 * the one set of ecological rules every history runs.
 *
 * Environment: terrain (the Week 06 study block: its massif, escarpment,
 * basin lake and outlet), water (that lake), light and shadow (the day's
 * sun, blocked by architecture).
 * Entities: architecture (grown by the Project's system, see
 * `architecture.ts`), vegetation in two strategies, creatures.
 * Habitat is a suitability field derived each step, never an entity.
 * Traces are what the processes leave behind: rubble, former shelter,
 * worn and overgrown paths, dead vegetation, flooded ground.
 *
 * Histories differ only in the events applied to a world (how fast the
 * structure fails, whether rubble dams the water, how creatures use the
 * ground); everything else follows from `stepEcology`.
 */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

function mulberry32(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NEIGHBOURS_8: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
]

function forNeighbours(c: number, visit: (n: number, length: number) => void) {
  const i = c % GRID
  const j = Math.floor(c / GRID)
  for (const [di, dj, length] of NEIGHBOURS_8) {
    const n = cellAt(i + di, j + dj)
    if (n >= 0) {
      visit(n, length)
    }
  }
}

/* ─── Light: the day's sun, blocked by architecture ───────────────────── */

/** The Project's day, sampled through daylight hours and weighted by elevation: the sun the structure grew under. */
const SUN_SAMPLES = [7.5, 9, 10.5, 12, 13.5, 15, 16.5].map((hour) => {
  const sun = sunAt(hour, GROWTH_NOON)
  return { dir: sun.direction, weight: Math.sin((sun.elevation * Math.PI) / 180) }
})
const SUN_WEIGHT = SUN_SAMPLES.reduce((sum, s) => sum + s.weight, 0)
const RAY_STEP = CELL * 0.5
const TOP = () => SITE.base + LEVELS * LEVEL

const voxelAt = (vox: Uint8Array, c: number, l: number) => (c >= 0 && l >= 0 && l < LEVELS ? vox[c * LEVELS + l]! : 0)

/** Fraction of the day's light reaching a point. */
function daylight(vox: Uint8Array, x: number, y: number, z: number) {
  let lit = 0
  for (const { dir, weight } of SUN_SAMPLES) {
    let blocked = false
    for (let t = RAY_STEP; ; t += RAY_STEP) {
      const py = y + dir[1] * t
      if (py >= TOP()) {
        break
      }
      const c = cellOf(x + dir[0] * t, z + dir[2] * t)
      if (c < 0) {
        break
      }
      if (voxelAt(vox, c, Math.floor((py - SITE.base) / LEVEL))) {
        blocked = true
        break
      }
    }
    if (!blocked) {
      lit += weight
    }
  }
  return lit / SUN_WEIGHT
}

/* ─── Architecture ──────────────────────────────────────────────────── */

function voxelNeighbours(v: number): number[] {
  const c = Math.floor(v / LEVELS)
  const l = v % LEVELS
  const i = c % GRID
  const j = Math.floor(c / GRID)
  const out: number[] = []
  for (const [di, dj] of NEIGHBOURS_8.slice(0, 4)) {
    const n = cellAt(i + di, j + dj)
    if (n >= 0) {
      out.push(n * LEVELS + l)
    }
  }
  if (l > 0) {
    out.push(v - 1)
  }
  if (l < LEVELS - 1) {
    out.push(v + 1)
  }
  return out
}

/* ─── World state ──────────────────────────────────────────────────────── */

export type PathSegment = { a: number; b: number; weight: number; last: number; migration: boolean }

export type World = {
  step: number
  /** Standing architecture, `cell * LEVELS + level`. */
  voxels: Uint8Array
  /** Every voxel that ever stood: the former structure. */
  built: Uint8Array
  water: Uint8Array
  waterLevel: number
  rubble: Float32Array
  /** Ground freshly struck by falling material; fades within a few steps. */
  fresh: Float32Array
  vegShelter: Float32Array
  vegExposure: Float32Array
  creatures: number[]
  /** Each creature's current route, home to water. */
  routes: number[][]
  wear: Float32Array
  /** The heaviest wear each cell has carried: a former path, even once overgrown. */
  wearPeak: Float32Array
  segments: Map<number, PathSegment>
  /** Fields, rederived each step. */
  light: Float32Array
  proximity: Float32Array
  shelter: Float32Array
  moisture: Float32Array
  habitat: Float32Array
  /** Traces. */
  shelterPeak: Float32Array
  deadVegetation: Float32Array
  decayDebt: number
}

/** How a history treats its world: the rate structure fails at, and how creatures use their routes. */
export type Regime = {
  /** Voxels failing per step. */
  decay: number
  /** Voxels failing at once on the stage's first step. */
  burst: number
  /** How far fallen material travels; faster failure throws it further. */
  scatter: number
  /** 0–1: how strongly creatures keep their previous homes. */
  fidelity: number
  /** 0–1: how strongly routes follow worn ground. */
  followWear: number
  /** Wear each walk leaves, relative to a single passage; above 1 it also tramples the ground beside the route. */
  trample: number
  /** Whether creatures spread over every separate habitat pocket before crowding the best one. */
  disperse: boolean
  present: boolean
}

export const BASE_REGIME: Regime = {
  decay: 0,
  burst: 0,
  scatter: 0.4,
  fidelity: 0.5,
  followWear: 0.5,
  trample: 1,
  disperse: false,
  present: true,
}

function proximityOf(water: Uint8Array) {
  const sources: number[] = []
  for (let c = 0; c < CELLS; c++) {
    if (water[c]) {
      sources.push(c)
    }
  }
  const out = new Float32Array(CELLS)
  for (let c = 0; c < CELLS; c++) {
    if (!SITE.land[c]) {
      continue
    }
    if (water[c]) {
      out[c] = 1
      continue
    }
    let d = Infinity
    for (const s of sources) {
      d = Math.min(d, Math.hypot(cellX(c) - cellX(s), cellZ(c) - cellZ(s)))
    }
    out[c] = Math.min(1, Math.exp(-d / MOISTURE_RANGE) + LOWLAND_MOISTURE * SITE.lowland[c]! ** 2)
  }
  return out
}

function lightOf(vox: Uint8Array) {
  const out = new Float32Array(CELLS)
  for (let c = 0; c < CELLS; c++) {
    if (SITE.land[c] && !voxelAt(vox, c, 0)) {
      out[c] = daylight(vox, cellX(c), SITE.ground[c]! + 0.02, cellZ(c))
    }
  }
  return out
}

export function cloneWorld(w: World): World {
  const segments = new Map<number, PathSegment>()
  w.segments.forEach((s, key) => segments.set(key, { ...s }))
  return {
    ...w,
    voxels: w.voxels.slice(),
    built: w.built.slice(),
    water: w.water.slice(),
    rubble: w.rubble.slice(),
    fresh: w.fresh.slice(),
    vegShelter: w.vegShelter.slice(),
    vegExposure: w.vegExposure.slice(),
    creatures: w.creatures.slice(),
    routes: w.routes.map((r) => r.slice()),
    wear: w.wear.slice(),
    wearPeak: w.wearPeak.slice(),
    segments,
    light: w.light.slice(),
    proximity: w.proximity.slice(),
    shelter: w.shelter.slice(),
    moisture: w.moisture.slice(),
    habitat: w.habitat.slice(),
    shelterPeak: w.shelterPeak.slice(),
    deadVegetation: w.deadVegetation.slice(),
  }
}

export const archAtGround = (w: World, c: number) => voxelAt(w.voxels, c, 0) === 1
export const rubbleCover = (w: World, c: number) => Math.min(1, w.rubble[c]! / 0.9)

/* ─── The ecological rules ─────────────────────────────────────────────── */

/**
 * Habitat and vegetation suitability from the environment:
 *   shelter  = shade from architecture, plus micro-shelter from rubble (on a
 *              cell and in the lee of heaps beside it) and cover
 *   moisture = nearness to water and low ground (Week 06's moisture), held
 *              longer under shade and cover, and under rubble
 *   habitat  = shelter × moisture, none on buried ground, less where disturbed
 */
function deriveFields(w: World) {
  for (let c = 0; c < CELLS; c++) {
    if (!SITE.land[c] || w.water[c] || archAtGround(w, c)) {
      w.shelter[c] = archAtGround(w, c) ? 1 : 0
      w.moisture[c] = w.water[c] ? 1 : 0
      w.habitat[c] = 0
      continue
    }
    const shade = 1 - w.light[c]!
    const rc = rubbleShelter(w, c)
    const cover = w.vegShelter[c]! + w.vegExposure[c]!
    w.shelter[c] = 1 - (1 - shade) * (1 - 0.75 * rc) * (1 - 0.35 * w.vegShelter[c]! - 0.1 * w.vegExposure[c]!)
    w.moisture[c] = clamp01(w.proximity[c]! * (0.7 + 0.25 * shade + 0.3 * cover) + 0.3 * rubbleCover(w, c))
    const open = 1 - smooth(HEAP.from, HEAP.buried, w.rubble[c]!)
    w.habitat[c] = w.shelter[c]! * w.moisture[c]! * open * (1 - 0.4 * disturbance(w, c))
  }
}

/** Rubble deep enough to bury the ground: nothing lives on a heap, only in its lee. */
const HEAP = { from: 0.9, buried: 1.6 } as const

/** Micro-shelter from rubble on a cell and in the lee of heaps beside it. */
function rubbleShelter(w: World, c: number) {
  let lee = 0
  forNeighbours(c, (n) => {
    lee = Math.max(lee, rubbleCover(w, n))
  })
  return Math.max(rubbleCover(w, c), 0.8 * lee)
}

const disturbance = (w: World, c: number) => clamp01(0.85 * w.wear[c]! + w.fresh[c]!)

/**
 * Vegetation suitability, by strategy, before disturbance. Each strategy
 * has primary drivers and secondary preferences, blended by weight rather
 * than multiplied, so no secondary factor alone empties otherwise good ground.
 *
 *   exposure = sun · (0.6 + 0.4 · moisture)
 *              sun = smooth(0.45, 0.85, light · (1 − 0.5 · enclosure))
 *              Sunlight leads: dry, open plateaus and ridges keep 60% of
 *              the suitability of a sunny shore.
 *   shelter  = 0.5 · cover + 0.25 · moisture + 0.25 · cover · moisture
 *              cover = smooth(0.3, 0.75, 1 − (1 − shelter)(1 − 0.6 · enclosure))
 *              Shelter and moisture lead together: deep architecture shadow
 *              alone gives half, a sunny shore a quarter, a shaded moist
 *              hollow all of it. The terrain shelters less than a roof, so
 *              what the histories build and break still moves the stands.
 *
 * Enclosure is the terrain's own shelter (`SITE.enclosure`): the foot of the
 * escarpment, hollows, the base of the hill.
 */
export const VEGETATION_WEIGHTS = {
  exposure: { sun: [0.45, 0.85], terrainShade: 0.5, dry: 0.6, moisture: 0.4 },
  shelter: { cover: [0.3, 0.75], terrain: 0.6, shelter: 0.5, moisture: 0.25, both: 0.25 },
} as const

export function exposureSuitability(light: number, moisture: number, enclosure: number) {
  const k = VEGETATION_WEIGHTS.exposure
  const sun = smooth(k.sun[0], k.sun[1], light * (1 - k.terrainShade * enclosure))
  return sun * (k.dry + k.moisture * clamp01(moisture))
}

export function shelterSuitability(shelter: number, moisture: number, enclosure: number) {
  const k = VEGETATION_WEIGHTS.shelter
  const cover = smooth(k.cover[0], k.cover[1], 1 - (1 - shelter) * (1 - k.terrain * enclosure))
  const m = clamp01(moisture)
  return k.shelter * cover + k.moisture * m + k.both * cover * m
}

/** Each strategy grows toward its suitability on undisturbed ground and spreads from neighbours. */
function growVegetation(w: World) {
  const shelterBefore = w.vegShelter.slice()
  const exposureBefore = w.vegExposure.slice()
  for (let c = 0; c < CELLS; c++) {
    if (!SITE.land[c] || w.water[c] || archAtGround(w, c)) {
      const lost = w.vegShelter[c]! + w.vegExposure[c]!
      w.deadVegetation[c]! += lost
      w.vegShelter[c] = 0
      w.vegExposure[c] = 0
      continue
    }
    const undisturbed = 1 - disturbance(w, c)
    const enclosure = SITE.enclosure[c]!
    const suitShelter = shelterSuitability(w.shelter[c]!, w.moisture[c]!, enclosure) * undisturbed
    const suitExposure =
      exposureSuitability(w.light[c]!, w.moisture[c]!, enclosure) * undisturbed * (1 - 0.8 * rubbleCover(w, c))
    let nearShelter = 0
    let nearExposure = 0
    forNeighbours(c, (n) => {
      nearShelter = Math.max(nearShelter, shelterBefore[n]!)
      nearExposure = Math.max(nearExposure, exposureBefore[n]!)
    })
    w.vegShelter[c] = settleTowards(w, c, shelterBefore[c]!, suitShelter, Math.max(shelterBefore[c]!, 0.7 * nearShelter, 0.02), 0.3, 0.5)
    w.vegExposure[c] = settleTowards(w, c, exposureBefore[c]!, suitExposure, Math.max(exposureBefore[c]!, 0.7 * nearExposure, 0.02), 0.22, 0.35)
    const total = w.vegShelter[c]! + w.vegExposure[c]!
    if (total > 1) {
      w.vegShelter[c]! /= total
      w.vegExposure[c]! /= total
    }
  }
}

/** Growth is limited by a seed source nearby; loss is quicker, and leaves dead vegetation. */
function settleTowards(w: World, c: number, value: number, suit: number, seed: number, grow: number, die: number) {
  if (suit >= value) {
    return value + grow * (suit - value) * Math.min(1, seed * 3)
  }
  const loss = die * (value - suit)
  w.deadVegetation[c]! += loss
  return value - loss
}

/* Creatures: homes in the best habitat, routes to water, wear where they walk. */

const MAX_CREATURES = 12
export const HOME_MIN = 0.22
const WEAR_PER_WALK = 0.1
const WEAR_FADE = 0.85

function chebyshev(a: number, b: number) {
  return Math.max(Math.abs((a % GRID) - (b % GRID)), Math.abs(Math.floor(a / GRID) - Math.floor(b / GRID)))
}

function pickHomes(w: World, regime: Regime): number[] {
  const candidates: { c: number; score: number }[] = []
  for (let c = 0; c < CELLS; c++) {
    const h = w.habitat[c]!
    if (h >= HOME_MIN) {
      const kept = w.creatures.some((home) => chebyshev(home, c) <= 2) ? 1 : 0
      candidates.push({ c, score: h + regime.fidelity * 0.3 * kept })
    }
  }
  const count = Math.min(MAX_CREATURES, Math.round(candidates.length / 3))
  candidates.sort((a, b) => b.score - a.score)
  const homes: number[] = []
  const settle = (c: number) => {
    if (homes.length < count && homes.every((h) => chebyshev(h, c) >= 2)) {
      homes.push(c)
    }
  }
  if (regime.disperse) {
    const { label } = habitatPockets(w)
    const claimed = new Set<number>()
    for (const { c } of candidates) {
      if (label[c]! > 0 && !claimed.has(label[c]!)) {
        claimed.add(label[c]!)
        settle(c)
      }
    }
  }
  candidates.forEach(({ c }) => settle(c))
  return homes
}

class Heap {
  private items: [number, number][] = []
  get size() {
    return this.items.length
  }
  push(item: [number, number]) {
    const a = this.items
    a.push(item)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p]![0] <= a[i]![0]) {
        break
      }
      ;[a[p], a[i]] = [a[i]!, a[p]!]
      i = p
    }
  }
  pop(): [number, number] {
    const a = this.items
    const top = a[0]!
    const last = a.pop()!
    if (a.length > 0) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l]![0] < a[m]![0]) m = l
        if (r < a.length && a[r]![0] < a[m]![0]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i]!, a[m]!]
        i = m
      }
    }
    return top
  }
}

const traversable = (w: World, c: number) => SITE.land[c] === 1 && !w.water[c] && !archAtGround(w, c)

/** Least-cost walking from `sources`: rubble is hard going; worn ground is easier, as much as the regime follows it. */
function walk(w: World, sources: number[], regime: Regime) {
  const dist = new Float32Array(CELLS).fill(Infinity)
  const prev = new Int32Array(CELLS).fill(-1)
  const heap = new Heap()
  for (const s of sources) {
    dist[s] = 0
    heap.push([0, s])
  }
  while (heap.size > 0) {
    const [d, c] = heap.pop()
    if (d > dist[c]!) {
      continue
    }
    forNeighbours(c, (n, length) => {
      if (!traversable(w, n)) {
        return
      }
      const cost =
        length * (1 + 2.5 * rubbleCover(w, n)) * (1 - 0.6 * regime.followWear * Math.min(1, w.wear[n]! * 1.5))
      if (d + cost < dist[n]!) {
        dist[n] = d + cost
        prev[n] = c
        heap.push([d + cost, n])
      }
    })
  }
  return { dist, prev }
}

function trace(prev: Int32Array, from: number): number[] {
  const path = [from]
  let c = from
  while (prev[c]! >= 0) {
    c = prev[c]!
    path.push(c)
  }
  return path
}

function wearRoute(w: World, path: readonly number[], migration: boolean, trample = 1) {
  const worn = WEAR_PER_WALK * trample
  const beside = WEAR_PER_WALK * Math.max(0, trample - 1) * 0.5
  for (let k = 0; k < path.length; k++) {
    const c = path[k]!
    w.wear[c] = Math.min(1.2, w.wear[c]! + worn)
    if (beside > 0) {
      for (const d of [1, -1, GRID, -GRID]) {
        if (traversable(w, c + d) && chebyshev(c, c + d) === 1) {
          w.wear[c + d] = Math.min(1.2, w.wear[c + d]! + beside)
        }
      }
    }
    if (k > 0) {
      const a = Math.min(c, path[k - 1]!)
      const b = Math.max(c, path[k - 1]!)
      const key = a * CELLS + b
      const segment = w.segments.get(key) ?? { a, b, weight: 0, last: 0, migration: false }
      segment.weight += worn
      segment.last = w.step
      segment.migration ||= migration
      w.segments.set(key, segment)
    }
  }
}

/** Unwalked wear fades, faster where vegetation grows back over it. */
const OVERGROWTH = 0.35

function moveCreatures(w: World, regime: Regime) {
  for (let c = 0; c < CELLS; c++) {
    w.wear[c]! *= WEAR_FADE * (1 - OVERGROWTH * Math.min(1, w.vegShelter[c]! + w.vegExposure[c]!))
  }
  const previous = w.creatures
  if (!regime.present) {
    if (previous.length > 0) {
      const rim: number[] = []
      for (let c = 0; c < CELLS; c++) {
        if (traversable(w, c) && [1, -1, GRID, -GRID].some((d) => !SITE.land[c + d])) {
          rim.push(c)
        }
      }
      const { prev } = walk(w, rim, regime)
      previous.forEach((home) => wearRoute(w, trace(prev, home), true))
    }
    w.creatures = []
    w.routes = []
    return
  }
  const homes = pickHomes(w, regime)
  for (const home of homes) {
    const from = previous.reduce((best, h) => (best < 0 || chebyshev(h, home) < chebyshev(best, home) ? h : best), -1)
    if (from >= 0 && chebyshev(from, home) > 4 && traversable(w, from)) {
      const { prev } = walk(w, [home], regime)
      if (prev[from]! >= 0) {
        wearRoute(w, trace(prev, from), true)
      }
    }
  }
  const shore: number[] = []
  for (let c = 0; c < CELLS; c++) {
    if (traversable(w, c)) {
      let wet = false
      forNeighbours(c, (n) => {
        wet ||= w.water[n] === 1
      })
      if (wet) {
        shore.push(c)
      }
    }
  }
  const { prev } = walk(w, shore, regime)
  w.routes = homes.map((home) => trace(prev, home))
  w.routes.forEach((route) => wearRoute(w, route, false, regime.trample))
  w.creatures = homes
}

/* Structure: the same failure rule at any rate. */

function failVoxels(w: World, count: number, scatter: number, rng: () => number) {
  const standing: { v: number; score: number }[] = []
  for (let v = 0; v < w.voxels.length; v++) {
    if (!w.voxels[v]) {
      continue
    }
    const l = v % LEVELS
    const open = voxelNeighbours(v).filter((n) => !w.voxels[n]).length + (l === LEVELS - 1 ? 1 : 0)
    const unsupported = l > 0 && !w.voxels[v - 1] ? 1 : 0
    standing.push({ v, score: 0.45 * (open / 6) + 0.3 * (l / LEVELS) + 0.4 * unsupported + 0.35 * rng() })
  }
  standing.sort((a, b) => b.score - a.score)
  const fallen = standing.slice(0, count).map((s) => s.v)
  fallen.forEach((v) => (w.voxels[v] = 0))

  const grounded = new Uint8Array(w.voxels.length)
  const queue: number[] = []
  for (let c = 0; c < CELLS; c++) {
    if (w.voxels[c * LEVELS]) {
      grounded[c * LEVELS] = 1
      queue.push(c * LEVELS)
    }
  }
  while (queue.length > 0) {
    for (const n of voxelNeighbours(queue.pop()!)) {
      if (w.voxels[n] && !grounded[n]) {
        grounded[n] = 1
        queue.push(n)
      }
    }
  }
  for (let v = 0; v < w.voxels.length; v++) {
    if (w.voxels[v] && !grounded[v]) {
      w.voxels[v] = 0
      fallen.push(v)
    }
  }
  fallen.forEach((v) => deposit(w, v, scatter, rng))
  if (fallen.length > 0) {
    w.light = lightOf(w.voxels)
  }
}

/** Fallen material lands outward from the structure, further the higher it fell and the faster the failure. */
function deposit(w: World, v: number, scatter: number, rng: () => number) {
  const c = Math.floor(v / LEVELS)
  const l = v % LEVELS
  const [cx, cz] = ARCH_CENTRE
  let dx = cellX(c) - cx
  let dz = cellZ(c) - cz
  const length = Math.hypot(dx, dz)
  if (length < 1e-3) {
    const angle = rng() * Math.PI * 2
    dx = Math.cos(angle)
    dz = Math.sin(angle)
  } else {
    dx /= length
    dz /= length
  }
  const reach = (0.6 + scatter * (0.5 + 0.35 * l) * (0.5 + rng())) * CELL
  let target = -1
  for (let tries = 0; tries < 5 && target < 0; tries++) {
    const r = reach * (1 + 0.5 * tries)
    const t = cellOf(
      cellX(c) + dx * r + (rng() - 0.5) * scatter * CELL * 1.5,
      cellZ(c) + dz * r + (rng() - 0.5) * scatter * CELL * 1.5,
    )
    if (t >= 0 && SITE.land[t] && !archAtGround(w, t)) {
      target = t
    }
  }
  if (target < 0) {
    return
  }
  w.rubble[target]! += 0.7
  w.fresh[target] = Math.min(1, w.fresh[target]! + 0.5 + 0.3 * scatter)
  forNeighbours(target, (n) => {
    if (SITE.land[n]) {
      w.rubble[n]! += 0.04
    }
  })
  const crushed = w.vegShelter[target]! + w.vegExposure[target]!
  w.deadVegetation[target]! += 0.8 * crushed
  w.vegShelter[target]! *= 0.2
  w.vegExposure[target]! *= 0.2
}

/** One step (a season) of the shared rules. */
function stepEcology(w: World, regime: Regime, rng: () => number) {
  w.step += 1
  w.decayDebt += regime.decay
  const failing = Math.floor(w.decayDebt)
  if (failing > 0) {
    w.decayDebt -= failing
    failVoxels(w, failing, regime.scatter, rng)
  }
  deriveFields(w)
  growVegetation(w)
  deriveFields(w)
  moveCreatures(w, regime)
  for (let c = 0; c < CELLS; c++) {
    w.shelterPeak[c] = Math.max(w.shelterPeak[c]!, w.shelter[c]!)
    w.wearPeak[c] = Math.max(w.wearPeak[c]!, w.wear[c]!)
    w.deadVegetation[c]! *= 0.985
    w.fresh[c]! *= 0.55
  }
}

/** Runs a stage: an optional burst of failure on its first step, then the shared rules. */
export function runStage(w: World, regime: Regime, steps: number, seed: number) {
  const rng = mulberry32(seed)
  if (regime.burst > 0) {
    failVoxels(w, regime.burst, regime.scatter, rng)
  }
  for (let s = 0; s < steps; s++) {
    stepEcology(w, regime, rng)
  }
  deriveFields(w)
}

const wetEdge = (w: World, c: number) => {
  let wet = w.water[c] === 1
  forNeighbours(c, (n) => {
    wet ||= w.water[n] === 1
  })
  return wet
}

/** Rubble lying in or beside the water holds it back: pools spread over the low ground around it. */
export function damWater(w: World) {
  const dams: number[] = []
  for (let c = 0; c < CELLS; c++) {
    if (w.rubble[c]! >= 0.3 && wetEdge(w, c)) {
      dams.push(c)
    }
  }
  const queue = dams.filter((c) => w.water[c])
  dams.forEach((c) =>
    forNeighbours(c, (n) => {
      if (w.water[n]) {
        queue.push(n)
      }
    }),
  )
  const level = w.waterLevel + 0.15
  let flooded = 0
  while (queue.length > 0 && flooded < 24) {
    const c = queue.shift()!
    forNeighbours(c, (n, length) => {
      const nearDam = dams.some((d) => chebyshev(d, n) <= 2)
      if (length > 1 || flooded >= 24 || !nearDam || w.water[n] || !SITE.land[n] || archAtGround(w, n) || SITE.ground[n]! >= level) {
        return
      }
      w.water[n] = 1
      w.deadVegetation[n]! += w.vegShelter[n]! + w.vegExposure[n]!
      w.vegShelter[n] = 0
      w.vegExposure[n] = 0
      flooded++
      queue.push(n)
    })
  }
  w.proximity = proximityOf(w.water)
  deriveFields(w)
}

/** Rubble cells lying in water or on its edge. */
export function rubbleAtWater(w: World) {
  let count = 0
  for (let c = 0; c < CELLS; c++) {
    if (w.rubble[c]! >= 0.3 && wetEdge(w, c)) {
      count++
    }
  }
  return count
}

/** The established ecology every history starts from. */
export function originWorld(): World {
  const voxels = ORIGIN_VOXELS.slice()
  const water = SITE.water.slice()
  const w: World = {
    step: 0,
    voxels,
    built: voxels.slice(),
    water,
    waterLevel: WATER_LEVEL,
    rubble: new Float32Array(CELLS),
    fresh: new Float32Array(CELLS),
    vegShelter: new Float32Array(CELLS),
    vegExposure: new Float32Array(CELLS),
    creatures: [],
    routes: [],
    wear: new Float32Array(CELLS),
    wearPeak: new Float32Array(CELLS),
    segments: new Map(),
    light: lightOf(voxels),
    proximity: proximityOf(water),
    shelter: new Float32Array(CELLS),
    moisture: new Float32Array(CELLS),
    habitat: new Float32Array(CELLS),
    shelterPeak: new Float32Array(CELLS),
    deadVegetation: new Float32Array(CELLS),
    decayDebt: 0,
  }
  deriveFields(w)
  for (let c = 0; c < CELLS; c++) {
    if (!traversable(w, c)) {
      continue
    }
    w.vegShelter[c] = 0.9 * shelterSuitability(w.shelter[c]!, w.moisture[c]!, SITE.enclosure[c]!)
    w.vegExposure[c] = 0.9 * exposureSuitability(w.light[c]!, w.moisture[c]!, SITE.enclosure[c]!)
  }
  runStage(w, BASE_REGIME, 10, 1)
  w.deadVegetation.fill(0)
  return w
}

/* ─── Reading a world ──────────────────────────────────────────────────── */

export type Metrics = {
  structure: number
  /** Ground in architectural shade for most of the day. */
  shade: number
  habitat: number
  patches: number
  creatures: number
  /** Habitat pockets with at least one creature living in them. */
  occupied: number
  vegShelter: number
  vegExposure: number
  paths: number
  /** Ground trodden bare: wear heavy enough to keep vegetation off. */
  trodden: number
  /** Former paths now grown over. */
  reclaimed: number
  rubble: number
  formerShelter: number
  deadVegetation: number
  water: number
}

/** Fewest cells a group of habitat needs to count as a pocket rather than a speck. */
const POCKET_MIN = 3

/** Connected groups of habitat a creature could live in: each pocket's cells labelled 1…count, specks 0. */
export function habitatPockets(w: World) {
  const label = new Int32Array(CELLS)
  const seen = new Uint8Array(CELLS)
  let count = 0
  for (let c = 0; c < CELLS; c++) {
    if (seen[c] || w.habitat[c]! < HOME_MIN) {
      continue
    }
    const cells = [c]
    seen[c] = 1
    for (let k = 0; k < cells.length; k++) {
      forNeighbours(cells[k]!, (n) => {
        if (!seen[n] && w.habitat[n]! >= HOME_MIN) {
          seen[n] = 1
          cells.push(n)
        }
      })
    }
    if (cells.length >= POCKET_MIN) {
      count++
      cells.forEach((at) => (label[at] = count))
    }
  }
  return { label, count }
}

/** Whether a cell was once a path and is now grown over. */
export const reclaimedPath = (w: World, c: number) =>
  w.wearPeak[c]! >= 0.3 && w.wear[c]! < 0.1 && w.vegShelter[c]! + w.vegExposure[c]! >= 0.25

export function measure(w: World): Metrics {
  const pockets = habitatPockets(w)
  const m: Metrics = {
    structure: 0,
    shade: 0,
    habitat: 0,
    patches: pockets.count,
    creatures: w.creatures.length,
    occupied: new Set(w.creatures.map((c) => pockets.label[c]!).filter((l) => l > 0)).size,
    vegShelter: 0,
    vegExposure: 0,
    paths: 0,
    trodden: 0,
    reclaimed: 0,
    rubble: 0,
    formerShelter: 0,
    deadVegetation: 0,
    water: 0,
  }
  w.voxels.forEach((v) => (m.structure += v))
  for (let c = 0; c < CELLS; c++) {
    if (!SITE.land[c]) {
      continue
    }
    m.water += w.water[c]!
    if (w.water[c] || archAtGround(w, c)) {
      continue
    }
    m.shade += w.light[c]! <= 0.5 ? 1 : 0
    m.habitat += w.habitat[c]! >= HOME_MIN ? 1 : 0
    m.vegShelter += w.vegShelter[c]!
    m.vegExposure += w.vegExposure[c]!
    m.paths += w.wear[c]! >= 0.18 ? 1 : 0
    m.trodden += w.wear[c]! >= 0.6 ? 1 : 0
    m.reclaimed += reclaimedPath(w, c) ? 1 : 0
    m.rubble += w.rubble[c]! >= 0.3 ? 1 : 0
    m.formerShelter += w.shelterPeak[c]! - w.shelter[c]! >= 0.25 ? 1 : 0
    m.deadVegetation += w.deadVegetation[c]!
  }
  return m
}
