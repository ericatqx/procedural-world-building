import { sunAt } from '../project/sun.ts'
import { clamp01, smoothstep } from '../project02/core.ts'
import { chooseSite, rng } from './livingArchitecture.ts'
import { riverEdgeField } from './vegRivers.ts'
import type { OrganismForm } from './livingOverhang3.ts'
import { LIFECYCLE, OBSERVATION_START } from './livingTime.ts'
import { lifeStateAt, lifeTrack, TK } from './livingLifecycle.ts'
import { architectureStyle } from './livingStyle.ts'
import { islandRadius, landscapeHeight } from './terrain.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — Living Architecture's ecology: the island's conditions, the population that grows on them, and
 * how each changes the other, year by year.
 *
 * ENVIRONMENT (a 32 m grid over the island, from the terrain, the water and the sun):
 *   light      the day's sun arc reaching the ground past the terrain's horizon, and the open sky (hollows see less)
 *   moisture   nearness to lakes and rivers, and hollows that gather water
 *   soil       footing: gentle slopes, sheltered hollows, not too high and exposed
 *   resource   what the ground can feed: moisture and soil together
 *   suitability where an organism can establish: lit, fed, on gentle dry ground, away from the water's edge
 *
 * POPULATION. The reference Overhang stands where it always has (its site is the seed's chosen site); the others
 * establish on the most suitable ground, spaced apart, the best ground taken first and longest ago. Each one's form
 * follows from where it stands (OrganismForm): its size from the resources, the keep's height from the shade (shaded
 * organisms reach up), the shelf's reach from the light, an outlier only where resources and room allow, a curtain only
 * where it is damp, the old shelf only on old organisms, the frame turned toward the better-lit, downhill opening.
 *
 * DYNAMICS (yearly, deterministic, each year from the year before, so the order of organisms does not matter):
 *   shade      a neighbour between an organism and the sun shades it, in proportion to its height and nearness
 *   draw       neighbours' roots draw on the same ground, in proportion to their mass and nearness
 *   shelter    shade keeps the ground damper; draw dries it
 *   vigor      light × resource × moisture, after all of that: it sets how fast an organism develops (its lifecycle age
 *              advances by vigor / its maturation time), and past maturity how much its lit fronts grow on, how much its
 *              shaded old tissue recedes (more as it ages: senescence), and whether receded tissue regenerates
 *   fusion     two mature, compatible neighbours close enough grow a root connection and share their resources
 * The reference organism's development is normalised so that it reaches its reference form exactly in the reference
 * year. Nothing is random at run time: the population is a pure function of the seed, and any year can be visited.
 */

const CELL = 32
const N = 128
const X0 = -N * CELL * 0.5
const SUN_HOURS = [8, 10, 12, 14, 16]
/**
 * The population, in colonies. Founders spread over the good ground (at least SPACING apart, farther preferred), as many
 * as the island has prime ground for (suitability PRIME or more: one per GOOD_PER_FOUNDER such cells, within FOUNDERS).
 * Each founder, and the reference, seeds a colony: recruits (clonal offspring) take root RECRUIT metres from a member,
 * decades after it, for up to GENERATIONS generations, as many as the ground around the founder can feed (its richness:
 * the ground above RICH within 240 m, one recruit per PER_RECRUIT of it, within COLONY). A few loners stand on middling
 * ground far from everyone. At most MAX_ORGANISMS in all.
 */
const FOUNDERS: [number, number] = [3, 17]
const PRIME = 0.6
const GOOD_PER_FOUNDER = 20
const RICH = 0.5
const PER_RECRUIT = 3.2
const SPACING = 250
// Recruits take root clear of their member's footprint: structures are 60 to 90 m across (see drawnSize).
const RECRUIT: [number, number] = [72, 130]
const RECRUIT_ROOM = 66
const COLONY: [number, number] = [1, 10]
const GENERATIONS = 3
const LONERS = 9
const MAX_ORGANISMS = 70
/**
 * Neighbours of one colony (kin: a parent and its recruit, or two recruits of one member) closer than this (and both mature)
 * can fuse, where a root can run between them over ground it can cross (see rootPath), and where they are not already
 * joined by another root through a third.
 */
/** The year the reference organism took root (it reaches its reference form in LIFECYCLE.reference). */
const REFERENCE_ESTABLISHED = 28
const FUSE_DISTANCE = 130
/** Each quantity kept per organism per year. */
const Q = { age: 0, vigor: 1, light: 2, moisture: 3, resource: 4, shade: 5, draw: 6, grow: 7, recede: 8, regen: 9 } as const
const K = 10
/** Later life starts a little after the reference form, so the reference year itself shows exactly the reference form. */
export const LATE_FROM = 1.01
/** Lifecycle ages at which senescence begins and is complete (configurable, provisional; not a death date). */
export const SENESCENCE: [number, number] = [1.8, 3.4]

export type EcoField = { light: Float32Array; moisture: Float32Array; soil: Float32Array; resource: Float32Array; suit: Float32Array; height: Float32Array; slope: Float32Array; waterDist: Float32Array }
export type Conditions = { light: number; moisture: number; soil: number; resource: number; suit: number; slope: number; waterDist: number; height: number }

export type OrganismPlan = {
  index: number
  id: string
  x: number
  z: number
  ground: number
  /** The year it germinated. The world opens on Day 1 of the reference year: most were already growing. */
  established: number
  /** Years it takes to mature at a vigor of 1. */
  maturity: number
  variation: number
  form: OrganismForm
  /** The ground's own conditions where it stands, before any organism changed them. */
  base: Conditions
  /** Height of its mature form, metres. */
  height: number
  /** Footprint radius, metres. */
  radius: number
  /**
   * Its size class: how large the ground lets it grow (about 0.25 poor to 1.25 rich), read by every ecological decision (its form's
   * dominance, its outlier and old shelf, fusion). Its drawn size (`form.size`) maps this into the world's final widths (drawnSize).
   */
  sizeClass: number
  /** The organism it was recruited from (a clonal offspring), or -1 for a founder or a loner. */
  parent: number
  /** Its colony (the founder's index), or -1 for a loner; and its generation in it (0 the founder). */
  colony: number
  generation: number
  /** The ground's exposure where it stands (ridge +1, hollow −1) and how crowded it is by neighbours (0 to 1): inputs to its stress (livingLifecycle.ts). */
  ridge: number
  crowding: number
  /** The world year it died (its reserve spent: livingLifecycle.ts), or −1 while it lives (or past the timeline's end). */
  died: number
}
export type Link = { a: number; b: number; since: number; distance: number }
export type Population = { seed: number; organisms: OrganismPlan[]; links: Link[]; from: number; to: number; series: Float32Array[]; /** Each organism's life track, a row per year from `from` (livingLifecycle.ts). */ track: Float32Array[]; sunH: [number, number]; fieldMs: number; simMs: number }

export type OrganismState = {
  present: boolean
  age: number
  years: number
  vigor: number
  light: number
  moisture: number
  resource: number
  shade: number
  draw: number
  grow: number
  recede: number
  regen: number
  stage: string
  links: { other: number; since: number; progress: number }[]
}

// ------------------------------------------------------------------------------------------------ the environment
/** Metres a structure's centre keeps from a river's edge: its footing, and the flare of it, reach about this far. */
const RIVER_CLEAR = 34

export function environmentField(world: World): EcoField {
  const n = N * N
  // The rivers are ribbons laid on the ground that the lakes' `depthAt` does not know: this reads the ribbon itself, along its whole length.
  const riverEdge = riverEdgeField(world)
  const height = new Float32Array(n)
  const inside = new Uint8Array(n)
  const wet = new Uint8Array(n)
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const x = X0 + (i + 0.5) * CELL
      const z = X0 + (j + 0.5) * CELL
      const k = j * N + i
      height[k] = landscapeHeight(x, z)
      inside[k] = Math.hypot(x, z) < islandRadius(Math.atan2(z, x)) * 0.9 ? 1 : 0
      wet[k] = world.water.depthAt(x, z) > 0 ? 1 : 0
    }
  }
  for (const river of world.rivers.rivers) {
    for (const node of river.nodes) {
      const i = Math.floor((node.x - X0) / CELL)
      const j = Math.floor((node.z - X0) / CELL)
      if (i >= 0 && j >= 0 && i < N && j < N) wet[j * N + i] = 1
    }
  }
  // Distance to water: a two-pass chamfer transform.
  const waterDist = new Float32Array(n).fill(1e6)
  for (let k = 0; k < n; k += 1) if (wet[k]) waterDist[k] = 0
  const relax = (k: number, m: number, w: number) => {
    if (waterDist[m]! + w < waterDist[k]!) waterDist[k] = waterDist[m]! + w
  }
  const D = CELL
  const DD = CELL * Math.SQRT2
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const k = j * N + i
      if (i > 0) relax(k, k - 1, D)
      if (j > 0) relax(k, k - N, D)
      if (i > 0 && j > 0) relax(k, k - N - 1, DD)
      if (i < N - 1 && j > 0) relax(k, k - N + 1, DD)
    }
  }
  for (let j = N - 1; j >= 0; j -= 1) {
    for (let i = N - 1; i >= 0; i -= 1) {
      const k = j * N + i
      if (i < N - 1) relax(k, k + 1, D)
      if (j < N - 1) relax(k, k + N, D)
      if (i < N - 1 && j < N - 1) relax(k, k + N + 1, DD)
      if (i > 0 && j < N - 1) relax(k, k + N - 1, DD)
    }
  }
  const at = (x: number, z: number) => {
    const u = Math.min(N - 1.001, Math.max(0, (x - X0) / CELL - 0.5))
    const v = Math.min(N - 1.001, Math.max(0, (z - X0) / CELL - 0.5))
    const i = Math.floor(u)
    const j = Math.floor(v)
    const fu = u - i
    const fv = v - j
    const h = (a: number, b: number) => height[b * N + a]!
    return (h(i, j) * (1 - fu) + h(i + 1, j) * fu) * (1 - fv) + (h(i, j + 1) * (1 - fu) + h(i + 1, j + 1) * fu) * fv
  }
  const suns = SUN_HOURS.map((h) => sunAt(h, 55).direction).filter((d) => d[1] > 0.05)
  const sunMean = (() => {
    const x = suns.reduce((acc, d) => acc + d[0], 0)
    const z = suns.reduce((acc, d) => acc + d[2], 0)
    const l = Math.hypot(x, z) || 1
    return [x / l, z / l] as const
  })()
  const slope = new Float32Array(n)
  const light = new Float32Array(n)
  const moisture = new Float32Array(n)
  const soil = new Float32Array(n)
  const resource = new Float32Array(n)
  const suit = new Float32Array(n)
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const k = j * N + i
      const x = X0 + (i + 0.5) * CELL
      const z = X0 + (j + 0.5) * CELL
      const h = height[k]!
      const hx = (height[j * N + Math.min(N - 1, i + 1)]! - height[j * N + Math.max(0, i - 1)]!) / (2 * CELL)
      const hz = (height[Math.min(N - 1, j + 1) * N + i]! - height[Math.max(0, j - 1) * N + i]!) / (2 * CELL)
      slope[k] = Math.hypot(hx, hz)
      // Sun past the terrain's horizon, weighted by how high the sun stands.
      let sun = 0
      let weights = 0
      for (const d of suns) {
        const horiz = Math.hypot(d[0], d[2]) || 1
        const rise = d[1] / horiz
        let clear = 1
        for (let s = 1; s <= 24; s += 1) {
          const dist = s * 40
          if (at(x + (d[0] / horiz) * dist, z + (d[2] / horiz) * dist) > h + 3 + rise * dist) {
            clear = 0
            break
          }
        }
        sun += clear * d[1]
        weights += d[1]
      }
      // Hollows: how far the ground lies below its surroundings (about 160 m around).
      let mean = 0
      let count = 0
      for (let b = -2; b <= 2; b += 1) {
        for (let a = -2; a <= 2; a += 1) {
          const ii = Math.min(N - 1, Math.max(0, i + a * 2))
          const jj = Math.min(N - 1, Math.max(0, j + b * 2))
          mean += height[jj * N + ii]!
          count += 1
        }
      }
      const hollow = mean / count - h
      const sky = clamp01(1 - Math.max(0, hollow) / 60)
      // Slopes facing the day's sun take more of it, slopes turned away less.
      const facing = slope[k]! > 0.01 ? (-hx * sunMean[0] - hz * sunMean[1]) / Math.hypot(1, slope[k]!) : 0
      const aspect = 0.8 + 0.6 * Math.max(-0.33, Math.min(0.33, facing))
      light[k] = clamp01((0.8 * (weights > 0 ? sun / weights : 0) + 0.2 * sky) * aspect)
      moisture[k] = clamp01(0.68 * Math.exp(-waterDist[k]! / 120) + 0.32 * smoothstep(-4, 14, hollow))
      soil[k] = (1 - smoothstep(0.08, 0.42, slope[k]!)) * (0.5 + 0.5 * smoothstep(-6, 16, hollow)) * (1 - smoothstep(260, 440, h))
      resource[k] = clamp01(0.55 * moisture[k]! + 0.45 * soil[k]!)
      const ok = inside[k] && !wet[k] && waterDist[k]! > 28 && slope[k]! < 0.36 && riverEdge(x, z) > RIVER_CLEAR
      suit[k] = ok ? Math.pow(light[k]!, 0.7) * (0.35 + 0.65 * resource[k]!) * (1 - smoothstep(0.18, 0.36, slope[k]!)) : 0
    }
  }
  return { light, moisture, soil, resource, suit, height, slope, waterDist }
}

export function conditionsAt(field: EcoField, x: number, z: number): Conditions {
  const i = Math.min(N - 1, Math.max(0, Math.floor((x - X0) / CELL)))
  const j = Math.min(N - 1, Math.max(0, Math.floor((z - X0) / CELL)))
  const k = j * N + i
  return { light: field.light[k]!, moisture: field.moisture[k]!, soil: field.soil[k]!, resource: field.resource[k]!, suit: field.suit[k]!, slope: field.slope[k]!, waterDist: field.waterDist[k]!, height: field.height[k]! }
}

// ------------------------------------------------------------------------------------------------ the population
/**
 * How a place shapes an organism (OrganismForm): from its light against the island's (`lit`, -1 to 1), its resource (soil and water),
 * how exposed the ground is (`ridge`, -1 hollow to 1 ridge), how crowded it is, how damp, how near water, and its size. Open, lit, fed ground
 * raises taller, more expansive structures; shaded or crowded ground lower, broader, denser and more lopsided ones; the water's edge
 * anchors it and sends its roots toward the water. The population plans from this, and so does the Architecture Lab's habitat.
 */
export function formFromHabitat(h: { lit: number; resource: number; ridge: number; crowding: number; moisture: number; waterDist: number; size: number }) {
  const { lit, resource, ridge, crowding } = h
  return {
    keep: Math.min(1.5, Math.max(0.6, 1 + 0.55 * lit + 0.7 * (resource - 0.45) - 0.18 * ridge - 0.28 * crowding)),
    reach: Math.min(1.5, Math.max(0.55, 1 + 0.45 * lit + 0.4 * (resource - 0.45) - 0.5 * crowding)),
    asym: Math.min(1, 0.6 * crowding + 0.5 * Math.max(0, -lit) + 0.25 * Math.abs(ridge)),
    shore: h.waterDist < 160 ? Math.min(1, Math.max(0, 1 - (h.waterDist - 28) / 130)) : 0,
    spread: Math.min(1.45, Math.max(0.8, 1 + 0.3 * ridge + 0.35 * crowding + 0.2 * Math.max(0, -lit))),
    shelfLift: Math.min(1.35, Math.max(0.75, 1 + 0.5 * lit - 0.3 * crowding)),
    dominance: Math.min(1, Math.max(0, (h.size - 0.62) / 0.5)),
    curtain: h.moisture > 0.32,
    mezzanine: h.moisture > 0.45,
    lowMass: resource > 0.4,
  }
}

/**
 * FINAL SCALE. An Overhang's drawn size from its size class: the world's structures are about 60 to 90 m across (the poorest ground the
 * smallest, the richest and the reference the largest), whatever the class's spread. Width per unit of size is about 90 m for the refined
 * forms and 122 m for the reference (measured on built meshes), so the drawn size is the target width over that. Height follows each form's
 * own proportions. Decisions read the class, never this.
 */
export const WIDTH_RANGE: [number, number] = [60, 90]
export function targetWidth(sizeClass: number): number {
  return WIDTH_RANGE[0] + (WIDTH_RANGE[1] - WIDTH_RANGE[0]) * smoothstep(0.25, 1, sizeClass)
}
export function drawnSize(sizeClass: number, reference = false): number {
  return targetWidth(sizeClass) / (reference ? 122 : 90)
}

export function planPopulation(world: World, seed: number): Population {
  const started = performance.now()
  const field = environmentField(world)
  const fieldMs = performance.now() - started
  const rand = rng((seed ^ 0x6c8e9cf5) >>> 0)
  let mx = 0
  let mz = 0
  for (const h of SUN_HOURS) {
    const d = sunAt(h, 55).direction
    mx += d[0]
    mz += d[2]
  }
  const ml = Math.hypot(mx, mz) || 1
  const sunH: [number, number] = [mx / ml, mz / ml]

  // Sites: the reference first; founders over the suitable ground, spread out (suitability × room); loners; colonies.
  const [rx, rz] = chooseSite(world, seed)
  type Site = { x: number; z: number; suit: number; parent: number; colony: number; generation: number }
  const sites: Site[] = [{ x: rx, z: rz, suit: conditionsAt(field, rx, rz).suit, parent: -1, colony: 0, generation: 0 }]
  const cells: { x: number; z: number; suit: number }[] = []
  let best = 0
  for (let k = 0; k < N * N; k += 1) best = Math.max(best, field.suit[k]!)
  for (let k = 0; k < N * N; k += 1) {
    if (field.suit[k]! < best * 0.35) continue
    const i = k % N
    const j = Math.floor(k / N)
    cells.push({ x: X0 + (i + 0.5) * CELL, z: X0 + (j + 0.5) * CELL, suit: field.suit[k]! })
  }
  const nearest = (c: { x: number; z: number }) => Math.min(...sites.map((s) => Math.hypot(s.x - c.x, s.z - c.z)))
  // Judged on the ground's own terms (not against this island's best), so a poorer island holds fewer.
  const goodCells = cells.filter((c) => c.suit >= PRIME).length
  const founders = Math.max(FOUNDERS[0], Math.min(FOUNDERS[1], Math.round(goodCells / GOOD_PER_FOUNDER)))
  for (let f = 0; f < founders && cells.length; f += 1) {
    let pick: { x: number; z: number; suit: number } | null = null
    let score = 0
    for (const c of cells) {
      if (c.suit < PRIME) continue
      const room = nearest(c)
      if (room < SPACING) continue
      const v = (c.suit / best) * Math.min(1, room / 800)
      if (v > score) {
        score = v
        pick = c
      }
    }
    if (!pick) break
    sites.push({ ...pick, parent: -1, colony: sites.length, generation: 0 })
  }
  // Loners: on middling ground, as far from everyone as they can be.
  for (let l = 0; l < LONERS; l += 1) {
    let pick: { x: number; z: number; suit: number } | null = null
    let score = 0
    for (const c of cells) {
      if (c.suit > best * 0.55) continue
      const room = nearest(c)
      if (room < 170) continue
      const v = room * c.suit
      if (v > score) {
        score = v
        pick = c
      }
    }
    if (!pick) break
    sites.push({ ...pick, parent: -1, colony: -1, generation: 0 })
  }
  // The best ground was taken first: founders establish from the most suitable (longest ago) to the least.
  const order = sites
    .map((s, index) => ({ index, suit: s.suit }))
    .slice(1)
    .sort((p, q) => q.suit - p.suit)
  const rank = new Map(order.map((o, r) => [o.index, order.length > 1 ? r / (order.length - 1) : 0]))
  // World Year 0 is the beginning of architectural life: no one is older than the world. The best ground is taken first (from
  // year 0), the poorest decades later; the reference organism took root in year 28 and reaches its reference form in year 120.
  const foundedAt = (index: number) => (index === 0 ? REFERENCE_ESTABLISHED : Math.max(0, Math.round(75 * Math.pow(rank.get(index) ?? 0.5, 0.9) + (rand() - 0.5) * 14)))
  const founded = sites.map((_, index) => foundedAt(index))
  // Colonies: each founder's ground can feed so many (its richness, the good ground within 240 m); recruits take root at
  // runner's reach from a member, decades after it, generation by generation, more readily in the member's lee (away from
  // the sun: damper, sheltered, and shaded by it). Some take root after the world opens: the population goes on.
  const richness = (s: Site) => cells.reduce((acc, c) => acc + (Math.hypot(c.x - s.x, c.z - s.z) < 240 && c.suit >= RICH ? (c.suit - RICH) / (1 - RICH) : 0), 0)
  const capacity = sites.map((s) => (s.colony < 0 ? 1 : Math.max(COLONY[0], Math.min(COLONY[1], Math.round(1 + richness(s) / PER_RECRUIT)))))
  for (let generation = 1; generation <= GENERATIONS; generation += 1) {
    const parents = sites.map((s, index) => ({ s, index })).filter(({ s }) => s.generation === generation - 1 && s.colony >= 0)
    parents.sort((p, q) => founded[p.index]! - founded[q.index]!)
    for (const { s: p, index: parent } of parents) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (sites.length >= MAX_ORGANISMS) break
        if (sites.filter((s) => s.colony === p.colony).length >= capacity[p.colony]!) break
        let pick: { x: number; z: number; suit: number } | null = null
        let score = 0
        for (const c of cells) {
          if (c.suit < best * 0.45) continue
          const d = Math.hypot(c.x - p.x, c.z - p.z)
          if (d < RECRUIT[0] || d > RECRUIT[1] || nearest(c) < RECRUIT_ROOM) continue
          const lee = Math.max(0, -((c.x - p.x) * sunH[0] + (c.z - p.z) * sunH[1]) / d)
          const v = c.suit * (1 + 0.8 * lee)
          if (v > score) {
            score = v
            pick = c
          }
        }
        if (!pick) break
        sites.push({ ...pick, parent, colony: p.colony, generation })
        // Most recruits follow their member by decades; some take root long after the world is first observed.
        const after = founded[parent]! + 30 + Math.round(rand() * 35)
        founded.push(Math.min(LIFECYCLE.horizon - 40, rand() < 0.22 ? Math.max(after, OBSERVATION_START + 8 + Math.round(rand() * 130)) : after))
      }
    }
  }

  // Light relative to the island's own: shaded organisms reach up (a taller keep), lit ones reach out (a longer shelf).
  const meanLight = sites.reduce((acc, s) => acc + conditionsAt(field, s.x, s.z).light, 0) / sites.length
  const ridgeAt = (x: number, z: number, ground: number) => {
    let around = 0
    for (let k = 0; k < 8; k += 1) around += landscapeHeight(x + Math.cos(k * 0.785) * 160, z + Math.sin(k * 0.785) * 160)
    return Math.max(-1, Math.min(1, (ground - around / 8) / 25))
  }
  const crowdingAt = (index: number) => Math.min(1, sites.reduce((acc, o, i) => (i === index ? acc : acc + (Math.hypot(o.x - sites[index]!.x, o.z - sites[index]!.z) < 260 ? Math.exp(-Math.hypot(o.x - sites[index]!.x, o.z - sites[index]!.z) / 110) : 0)), 0))
  const organisms: OrganismPlan[] = sites.map((s, index) => {
    const base = conditionsAt(field, s.x, s.z)
    const ground = landscapeHeight(s.x, s.z)
    const id = `LA-${String(index + 1).padStart(2, '0')}`
    if (index === 0) {
      // The reference: size class 1 (its form is the reference one), drawn at the top of the range.
      const ds = drawnSize(1, true)
      return { index, id, x: s.x, z: s.z, ground, established: founded[0]!, maturity: LIFECYCLE.reference, variation: 0, form: { size: ds }, base, height: 34 * ds, radius: 48 * ds, sizeClass: 1, parent: -1, colony: 0, generation: 0, ridge: ridgeAt(s.x, s.z, ground), crowding: crowdingAt(0), died: -1 }
    }
    const space = Math.min(...sites.filter((_, o) => o !== index).map((o) => Math.hypot(o.x - s.x, o.z - s.z)))
    // Size follows what the ground can feed, steeply: the richest ground raises organisms as large as the reference, the poorest
    // only small ones (and a recruit is smaller than the member it grew from).
    const fit = 0.55 * smoothstep(0.3, 0.78, base.resource) + 0.3 * smoothstep(0.35, 0.8, base.light) + 0.15 * smoothstep(120, 320, space)
    const size = Math.min(1.25, Math.max(0.28, 0.28 + 1.0 * Math.pow(fit, 1.7) + 0.08 * (rand() - 0.5))) * Math.min(1, 0.5 + space / 320) * Math.pow(0.9, s.generation)
    // What it is drawn at (decisions below read `size`, the class; geometry reads `ds`).
    const ds = drawnSize(size)
    const established = founded[index]!
    // Which way it opens: toward the lowest horizon near the sun's side (the most light and the least ground in the way),
    // within a wide arc; downhill helps.
    const sunward = Math.atan2(sunH[1], sunH[0])
    const horizon = (angle: number) => {
      let rise = -1
      for (let d = 30; d <= 420; d += 30) rise = Math.max(rise, (landscapeHeight(s.x + Math.cos(angle) * d, s.z + Math.sin(angle) * d) - ground) / d)
      return rise
    }
    // Neighbours close by take the room and the light on their side: the opening turns away from them, and (for a recruit) a
    // little toward the member it grew from, so a shelf reaches where a root can join.
    const near = sites
      .map((o, i) => ({ d: Math.hypot(o.x - s.x, o.z - s.z), bearing: Math.atan2(o.z - s.z, o.x - s.x), i }))
      .filter((n) => n.i !== index && n.d < 260)
    const crowd = (angle: number) => near.reduce((acc, n) => acc + Math.exp(-n.d / 110) * Math.pow(Math.max(0, Math.cos(angle - n.bearing)), 2), 0)
    const crowding = Math.min(1, near.reduce((acc, n) => acc + Math.exp(-n.d / 110), 0))
    const kin = s.parent >= 0 ? sites[s.parent]! : null
    const toKin = kin ? Math.atan2(kin.z - s.z, kin.x - s.x) : 0
    let yaw = 0
    let opening = Infinity
    for (let k = -6; k <= 6; k += 1) {
      const turn = (k / 6) * 1.9
      const v = horizon(sunward + turn) + 0.12 * (1 - Math.cos(turn)) + 0.45 * crowd(sunward + turn) - (kin ? 0.1 * Math.max(0, Math.cos(sunward + turn - toKin)) : 0)
      if (v < opening) {
        opening = v
        yaw = turn
      }
    }
    yaw += (rand() - 0.5) * 0.2
    // Ridge or hollow (the ground against its surroundings, about 160 m around): exposed ground grows broad and low, sheltered
    // ground narrow and tall.
    let around = 0
    for (let k = 0; k < 8; k += 1) around += landscapeHeight(s.x + Math.cos(k * 0.785) * 160, s.z + Math.sin(k * 0.785) * 160)
    const ridge = Math.max(-1, Math.min(1, (ground - around / 8) / 25))
    // Which side of the opening is more open: the shelf swings toward it.
    const side = horizon(sunward + yaw - 0.9) - horizon(sunward + yaw + 0.9)
    // The ground under the shelf's reach: it follows the slope down (or climbs it).
    const along = sunward + yaw
    const drop = landscapeHeight(s.x + Math.cos(along) * 40 * ds, s.z + Math.sin(along) * 40 * ds) - ground
    // How the ground shapes it. Open, lit, fed ground raises taller and more expansive structures; shaded or crowded ground lower,
    // broader, denser and more lopsided ones; the water's edge anchors it and sends its roots out toward the water.
    const lit = Math.max(-1, Math.min(1, (base.light - meanLight) / 0.25))
    const shape = formFromHabitat({ lit, resource: base.resource, ridge, crowding, moisture: base.moisture, waterDist: base.waterDist, size })
    const keep = shape.keep
    const reach = shape.reach
    // The outlier is a second body some way out along the opening: only where its ground is dry or shallow all round.
    const wantsOuter = base.resource > 0.42 && space > 110 && size > 0.55
    const ax = sunH[0] * Math.cos(yaw) - sunH[1] * Math.sin(yaw)
    const az = sunH[0] * Math.sin(yaw) + sunH[1] * Math.cos(yaw)
    const dry = (u: number, w: number) => world.water.depthAt(s.x + (ax * u - az * w) * ds, s.z + (az * u + ax * w) * ds) <= 0.6
    const outerOk = wantsOuter && [-10, 0, 10].every((w) => [-1, 0, 1].every((e) => dry(1 + 38 * reach + e * 9, w)))
    const form: OrganismForm = {
      anchored: true,
      site: [s.x, s.z],
      yaw,
      size: ds,
      step: Math.min(2.6, (s.generation > 0 ? 1.15 : 1) / ds),
      ...shape,
      rise: Math.max(-6, Math.min(6, (drop / ds) * 0.6)),
      swing: Math.max(-1.8, Math.min(1.8, side * 14)),
      outlier: outerOk,
      oldShelf: established < 35 && size >= 0.6,
    }
    return { index, id, x: s.x, z: s.z, ground, established, maturity: 1.2 * (14 + 26 * size) * (1.3 - 0.45 * (0.6 * base.resource + 0.4 * base.light)) * (0.9 + 0.2 * rand()), variation: index + 1, form, base, height: 34 * ds * keep / Math.sqrt(form.spread!), radius: 48 * ds * (0.7 + 0.3 * reach) * (form.spread ?? 1), sizeClass: size, parent: s.parent, colony: s.colony, generation: s.generation, ridge, crowding, died: -1 }
  })
  const sim = simulate(organisms, sunH, (a, b) => rootPath(world, organisms, a, b))
  // Life and death (livingLifecycle.ts): stress, health and the reserve a year at a time, from the conditions the simulation gave each organism.
  const years = sim.to - sim.from + 1
  const track = organisms.map((o) => {
    const row = sim.series[o.index]!
    const made = lifeTrack(o.index, years, sim.from, (y) => ({ age: row[y * K + Q.age]!, vigor: row[y * K + Q.vigor]!, light: row[y * K + Q.light]!, moisture: row[y * K + Q.moisture]!, resource: row[y * K + Q.resource]!, shade: row[y * K + Q.shade]!, draw: row[y * K + Q.draw]! }), { ridge: o.ridge, crowding: o.crowding })
    o.died = made.died
    return made.track
  })
  void TK
  return { seed, organisms, links: sim.links, from: sim.from, to: sim.to, series: sim.series, track, sunH, fieldMs: Math.round(fieldMs), simMs: Math.round(performance.now() - started - fieldMs) }
}

function simulate(organisms: OrganismPlan[], sunH: [number, number], canRoot: (a: number, b: number) => boolean) {
  const from = Math.min(...organisms.map((o) => o.established)) - 1
  const to = LIFECYCLE.horizon + 1
  const years = to - from + 1
  const n = organisms.length
  const series = organisms.map(() => new Float32Array(years * K))
  const state = organisms.map(() => ({ age: -1, grow: 0, recede: 0, regen: 0 }))
  const links: Link[] = []
  const linked = (a: number, b: number) => links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))
  const distance = (a: OrganismPlan, b: OrganismPlan) => Math.hypot(a.x - b.x, a.z - b.z)
  // The reference: its development scale, refined so it reaches the reference form in the reference year.
  const VREF = 0.6
  for (let y = 0; y < years; y += 1) {
    const year = from + y
    const previous = state.map((s) => ({ ...s }))
    const mass = (j: number) => {
      const o = organisms[j]!
      const p = previous[j]!
      if (p.age < 0) return 0
      return (o.form.size ?? 1) ** 2 * (Math.min(p.age, 1) ** 1.5 + 0.05 * p.grow - 0.04 * p.recede)
    }
    for (let i = 0; i < n; i += 1) {
      const o = organisms[i]!
      const row = series[i]!
      const s = state[i]!
      if (year < o.established) {
        row[y * K + Q.age] = -1
        continue
      }
      let unshaded = 1
      let draw = 0
      let support = 0
      for (let j = 0; j < n; j += 1) {
        if (j === i) continue
        const p = organisms[j]!
        const pa = previous[j]!.age
        if (pa < 0) continue
        const d = distance(o, p)
        const dir: [number, number] = [(p.x - o.x) / d, (p.z - o.z) / d]
        // A neighbour toward the sun shades: by its height and nearness.
        const towardSun = Math.max(0, dir[0] * sunH[0] + dir[1] * sunH[1])
        const tall = p.height * smoothstep(0, 0.8, pa)
        const reach = tall * 3 + p.radius
        unshaded *= 1 - 0.75 * towardSun * clamp01(1 - d / reach) - 0.15 * clamp01(1 - d / (p.radius * 2.2))
        draw += mass(j) * Math.exp(-d / 120) * 0.45
        const l = linked(i, j)
        if (l) support += clamp01((year - l.since) / 18) * 0.3
      }
      const shade = clamp01(1 - unshaded)
      const light = o.base.light * (1 - shade)
      const moisture = clamp01(o.base.moisture + 0.18 * shade - 0.12 * draw)
      let resource = Math.min(1, Math.max(0.03, o.base.resource - draw))
      resource = Math.min(1, resource + support * (1 - resource) * 0.5)
      const vigor = Math.min(1.4, (Math.pow(light, 0.6) * (0.25 + 0.75 * resource) * (0.45 + 0.55 * moisture)) / VREF)
      s.age = s.age < 0 ? 0 : s.age + vigor / o.maturity
      if (s.age >= LATE_FROM) lateYear(s, vigor)
      row.set([s.age, vigor, light, moisture, resource, shade, draw, s.grow, s.recede, s.regen], y * K)
    }
    // Fusion: mature, compatible neighbours close enough (each at most two connections).
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        if (linked(i, j) || state[i]!.age < 0.85 || state[j]!.age < 0.85) continue
        const a = organisms[i]!
        const b = organisms[j]!
        const d = distance(a, b)
        if (d > FUSE_DISTANCE) continue
        if (Math.abs(a.sizeClass - b.sizeClass) > 0.5) continue
        // Kin only: a root runs from a member to its recruit, or between recruits of one member.
        const kin = a.parent === j || b.parent === i || (a.parent >= 0 && a.parent === b.parent)
        if (!kin) continue
        // A connection is a substantial thing: only between organisms big enough to bear one, one each (two for the largest).
        if (Math.min(a.sizeClass, b.sizeClass) < 0.4) continue
        const room = (k: number, o: OrganismPlan) => links.filter((l) => l.a === k || l.b === k).length < (o.sizeClass >= 0.8 ? 2 : 1)
        if (!room(i, a) || !room(j, b)) continue
        // Not a second route between two that are already joined through a third.
        if (links.some((l) => (l.a === i || l.b === i) && links.some((m) => (m.a === j || m.b === j) && (l.a === m.a || l.a === m.b || l.b === m.a || l.b === m.b)))) continue
        if (!canRoot(i, j)) continue
        links.push({ a: i, b: j, since: year, distance: d })
      }
    }
  }
  // The reference reaches its reference form exactly in the reference year: its development, normalised, and its later
  // life, recomputed from its vigor on that schedule.
  const ref = series[0]!
  const yRef = LIFECYCLE.reference - from
  const scale = ref[yRef * K + Q.age]!
  const s = { age: 0, grow: 0, recede: 0, regen: 0 }
  for (let y = 0; y < years; y += 1) {
    const raw = ref[y * K + Q.age]!
    if (raw < 0) continue
    const age = y === yRef ? 1 : raw / scale
    ref[y * K + Q.age] = age
    s.age = age
    if (age >= LATE_FROM) lateYear(s, ref[y * K + Q.vigor]!)
    ref[y * K + Q.grow] = s.grow
    ref[y * K + Q.recede] = s.recede
    ref[y * K + Q.regen] = s.regen
  }
  return { from, to, series, links }
}

/** One year of later life: lit fronts grow on with vigor; shaded old tissue recedes with weakness and with age; receded tissue regenerates where vigor allows. */
function lateYear(s: { age: number; grow: number; recede: number; regen: number }, vigor: number) {
  const senescence = smoothstep(SENESCENCE[0], SENESCENCE[1], s.age)
  // Growth at the tips slows and stops with age; erosion goes on all the while, faster when weak and as it ages; lit
  // eroded tissue regenerates while vigor allows. Erosion saturates (its patches deepen, they do not spread): an old
  // organism is worn and holed, not gone.
  s.grow += 0.045 * Math.min(1, vigor) * (1 - senescence) * (1 - s.grow / 2.5)
  s.recede += 0.06 * (0.6 * (1 - Math.min(1, vigor)) + 0.35 + 1.3 * senescence) * (1 - s.recede / 8)
  if (s.recede > 1 && vigor > 0.65) s.regen = Math.min(0.5, s.regen + 0.01 * (vigor - 0.65))
}

// ------------------------------------------------------------------------------------------------ reading it
/** An organism's state at a time (a fractional year), interpolated between years. */
export function organismState(pop: Population, index: number, time: number): OrganismState {
  const o = pop.organisms[index]!
  const row = pop.series[index]!
  const t = Math.min(pop.to - 0.0001, Math.max(pop.from, time)) - pop.from
  const y = Math.floor(t)
  const f = t - y
  const get = (q: number) => row[y * K + q]! * (1 - f) + row[Math.min(pop.to - pop.from, y + 1) * K + q]! * f
  const a0 = row[y * K + Q.age]!
  const a1 = row[Math.min(pop.to - pop.from, y + 1) * K + Q.age]!
  const present = a0 >= 0 || (a1 >= 0 && f > 0)
  const age = a0 < 0 ? Math.max(0, a1) * f : get(Q.age)
  const late = age >= LATE_FROM
  const st = {
    present,
    age,
    years: time - o.established,
    vigor: get(Q.vigor),
    light: get(Q.light),
    moisture: get(Q.moisture),
    resource: get(Q.resource),
    shade: get(Q.shade),
    draw: get(Q.draw),
    grow: late ? get(Q.grow) : 0,
    recede: late ? get(Q.recede) : 0,
    regen: late ? get(Q.regen) : 0,
    stage: '',
    links: pop.links.filter((l) => l.a === index || l.b === index).filter((l) => time >= l.since).map((l) => ({ other: l.a === index ? l.b : l.a, since: l.since, progress: clamp01((time - l.since) / 18) })),
  }
  const next = Math.min(pop.to - pop.from, y + 1)
  st.stage = stageOf(st, index === 0, row[next * K + Q.regen]! - row[y * K + Q.regen]! > 0.001, row[next * K + Q.recede]! - row[y * K + Q.recede]!)
  return st
}

/**
 * What its neighbours are doing to an organism now: how much each shades it, and how much each draws on its ground. The
 * same rules as the yearly simulation (`simulate`), at the neighbours' state now.
 */
export function neighbourEffects(pop: Population, index: number, time: number): { index: number; shade: number; draw: number }[] {
  const o = pop.organisms[index]!
  const out: { index: number; shade: number; draw: number }[] = []
  for (const p of pop.organisms) {
    if (p.index === index) continue
    const s = organismState(pop, p.index, time)
    if (!s.present) continue
    const d = Math.hypot(p.x - o.x, p.z - o.z)
    const towardSun = Math.max(0, ((p.x - o.x) * pop.sunH[0] + (p.z - o.z) * pop.sunH[1]) / d)
    const tall = p.height * smoothstep(0, 0.8, s.age)
    const shade = 0.75 * towardSun * clamp01(1 - d / (tall * 3 + p.radius)) + 0.15 * clamp01(1 - d / (p.radius * 2.2))
    const mass = (p.form.size ?? 1) ** 2 * (Math.min(s.age, 1) ** 1.5 + 0.05 * s.grow - 0.04 * s.recede)
    out.push({ index: p.index, shade, draw: mass * Math.exp(-d / 120) * 0.45 })
  }
  return out
}

/** An observation of one organism, in plain words, every one of them read from the simulation's state now. */
export type Observation = { stage: string; age: string; origin: string; happening: string; notes: string[] }

export function observe(pop: Population, index: number, time: number): Observation {
  const o = pop.organisms[index]!
  const s = organismState(pop, index, time)
  const name = (i: number) => pop.organisms[i]!.id
  const children = pop.organisms.filter((c) => c.parent === index)
  const origin =
    o.parent >= 0
      ? `Offshoot of ${name(o.parent)}${o.generation > 1 ? ` (generation ${o.generation + 1})` : ''}`
      : o.colony < 0
        ? 'A lone organism, far from any colony'
        : `Founder of a colony of ${pop.organisms.filter((c) => c.colony === o.colony).length}`
  if (!s.present) return { stage: 'Not yet here', age: `Takes root in year ${o.established}`, origin, happening: o.parent >= 0 ? `${name(o.parent)} will send out a runner that roots here.` : 'Its ground is still bare.', notes: [] }
  const later = organismState(pop, index, time + 5)
  const dGrow = later.grow - s.grow
  const dRecede = later.recede - s.recede
  const dRegen = later.regen - s.regen
  let stage: string
  let happening: string
  if (s.age < 0.05) [stage, happening] = ['Germinating', 'A low mound of new tissue is spreading over its footing.']
  else if (s.age < 0.45) [stage, happening] = ['Growing', 'Its keep is rising: new tissue is laid down from the base up.']
  else if (s.age < 0.75) [stage, happening] = ['Growing', 'Its keep stands; the great shelf is now reaching out toward the light.']
  else if (s.age < 1) [stage, happening] = ['Maturing', 'Nearly full grown: its last shelves and supports are filling in.']
  else if (s.age < LATE_FROM) [stage, happening] = index === 0 ? ['Reference form', 'Fully grown: the form the others are measured against.'] : ['Mature', 'Fully grown.']
  else if (s.age > SENESCENCE[0] + 0.4 && dRegen <= 0.001) [stage, happening] = ['Senescent', 'Old: shaded tissue is wearing away into cavities and holes faster than anything grows back.']
  else if (dRegen > 0.001) [stage, happening] = ['Regenerating', 'Eroded tissue in the light is growing back over its cavities, while shaded parts go on wearing away.']
  else if (dGrow > dRecede * 0.6 && dGrow > 0.01) [stage, happening] = ['Mature, still growing', 'Its sunlit tips are still extending; shaded hollows are slowly wearing into cavities.']
  else [stage, happening] = ['Weathering', 'Growth has slowed; shaded tissue is wearing away into cavities.']

  const notes: string[] = []
  // The refined Overhang's lifecycle (livingLifecycle.ts): its stage, health and stress, and its death, from its age and conditions.
  if (architectureStyle() === 'refined') {
    const ls = lifeStateAt(pop.track[index]!, pop.from, o.established, o.died, time)
    const pct = (v: number) => `${Math.round(100 * v)}%`
    const yrs = Math.floor(ls.sinceDeath)
    const text: Record<string, string> = {
      establishment: 'A small anchored footing is spreading over its ground.',
      juvenile: 'Early vertical growth: its tower is rising toward the light.',
      growing: 'Its tower stands; the cantilever is extending and its supports are forming.',
      maturity: 'Fully grown: tower, cantilever and supports at their full form.',
      senescence: 'Its living skin is decaying and mineralising, the shaded tissue first; the skeleton still stands and is weathering.',
      death: `Dead ${yrs} ${yrs === 1 ? 'year' : 'years'}: its life has ended; the cantilever is breaking back and its supports are failing.`,
      remains: `Remains, dead ${yrs} years: low rubble and a mineral deposit on the ground, weathered ${pct(ls.weathered)} of the way to settling.`,
    }
    stage = ls.stage.label
    happening = text[ls.stage.id]!
    notes.push(`Health ${pct(ls.health)}, environmental stress ${pct(ls.stress)}, growth ${ls.growth.toFixed(2)}.`)
    if (ls.lifespan !== null) notes.push(`Lived ${ls.lifespan} years (it died in year ${ls.died}).`)
    else if (ls.expectedDeath !== null) notes.push(`On its present course it will die in about year ${ls.expectedDeath}${ls.stage.id === 'senescence' ? ` (its reserve is ${pct(ls.reserve)} left)` : ''}.`)
  }
  const effects = neighbourEffects(pop, index, time)
  const shader = effects.reduce((a, b) => (b.shade > a.shade ? b : a), { index: -1, shade: 0, draw: 0 })
  const drawer = effects.reduce((a, b) => (b.draw > a.draw ? b : a), { index: -1, shade: 0, draw: 0 })
  if (shader.shade > 0.05 && s.age < 1) notes.push(`In the shade of ${name(shader.index)}, so it grows more slowly.`)
  else if (shader.shade > 0.05) notes.push(`In the shade of ${name(shader.index)}: its shaded side wears away faster.`)
  if (drawer.draw > 0.04 && drawer.index !== shader.index) notes.push(`Competes with ${name(drawer.index)} for the water and soil underground.`)
  else if (drawer.draw > 0.04) notes.push(`${name(drawer.index)} also draws on the same ground underground.`)
  const keep = o.form.keep ?? 1
  const reach = o.form.reach ?? 1
  if (index !== 0 && keep > 1.08) notes.push('Limited sunlight here: it grew a taller keep to reach the light.')
  else if (index !== 0 && reach > 1.08 && shader.shade <= 0.05) notes.push('Open to the sun: its shelf reaches farther than most.')
  else if (index !== 0 && reach > 1.08) notes.push('Its site faces the sun, so its shelf reaches farther than most.')
  if (index !== 0 && (o.form.spread ?? 1) > 1.08) notes.push('On exposed high ground it grew low and broad.')
  else if (index !== 0 && (o.form.spread ?? 1) < 0.92) notes.push('In a sheltered hollow it grew narrow and tall.')
  if (index !== 0 && o.base.resource < 0.45 && o.sizeClass < 0.5) notes.push('Thin, dry ground has kept it small.')
  for (const l of s.links) notes.push(`Joined to ${name(l.other)} by a root since year ${l.since}${l.progress < 1 ? ' (still growing)' : ''}: they share water and soil.`)
  if (children.length) notes.push(`Parent of ${children.map((c) => c.id).join(', ')}.`)
  const years = Math.floor(s.years)
  const rooted = o.established < 0 ? `rooted ${-o.established} ${o.established === -1 ? 'year' : 'years'} before year 0` : `rooted in year ${o.established}`
  return { stage, age: `${years} ${years === 1 ? 'year' : 'years'} old · ${rooted}`, origin, happening, notes: notes.slice(0, 5) }
}

function stageOf(s: OrganismState, reference: boolean, regenerating: boolean, receding: number): string {
  if (!s.present) return 'not yet established'
  if (s.age < 0.05) return 'germinating'
  if (s.age < 0.85) return 'growing'
  if (s.age < 1) return 'maturing'
  if (s.age < LATE_FROM) return reference ? 'reference form' : 'mature'
  if (s.age > SENESCENCE[0] + 0.4) return regenerating ? 'senescent, regenerating' : 'senescent'
  if (regenerating) return 'regenerating'
  if (receding > 0.05 && s.vigor < 0.75) return 'receding'
  return s.vigor > 0.8 ? 'mature, still growing' : 'mature'
}

/**
 * Whether a root can run between two organisms over the ground between them: the ground is continuous and gentle (no
 * cliff or gully), dry (a root does not cross water), and no third organism stands on the way. The root itself is laid
 * along this ground (see Connection in LivingArchitecture.tsx), so what is checked here is what is drawn.
 */
export function rootPath(world: World, organisms: OrganismPlan[], i: number, j: number): boolean {
  const a = organisms[i]!
  const b = organisms[j]!
  const d = Math.hypot(b.x - a.x, b.z - a.z)
  const steps = Math.max(6, Math.ceil(d / 8))
  let previous = landscapeHeight(a.x, a.z)
  for (let k = 1; k <= steps; k += 1) {
    const t = k / steps
    const x = a.x + (b.x - a.x) * t
    const z = a.z + (b.z - a.z) * t
    const h = landscapeHeight(x, z)
    if (Math.abs(h - previous) / (d / steps) > 0.45) return false
    if (world.water.depthAt(x, z) > 0.2) return false
    previous = h
  }
  for (let k = 0; k < organisms.length; k += 1) {
    if (k === i || k === j) continue
    const o = organisms[k]!
    const along = ((o.x - a.x) * (b.x - a.x) + (o.z - a.z) * (b.z - a.z)) / (d * d)
    if (along < 0.05 || along > 0.95) continue
    const side = Math.hypot(o.x - (a.x + (b.x - a.x) * along), o.z - (a.z + (b.z - a.z) * along))
    if (side < o.radius * 0.7) return false
  }
  return true
}
