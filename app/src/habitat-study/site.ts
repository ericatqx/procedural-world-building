import { BufferGeometry, Group, Mesh } from 'three'
import { sunAt } from '../project/sun.ts'
import { environment } from '../project03/environment.ts'
import { needsRebuild } from '../architecture-lab/lifecycle.ts'
import { LATE_FROM, observe, organismState, type Population } from '../project03/livingEcology.ts'
import { lifeStateAt } from '../project03/livingLifecycle.ts'
import { buildOrganism, loadPopulation, organismAt } from '../project03/livingOverhangAsync.ts'
import { architectureStyle } from '../project03/livingStyle.ts'
import { OBSERVATION_START, worldYears } from '../project03/livingTime.ts'
import { DEFAULT_TERRAIN_SEED, landscapeHeight, setTerrainSeed } from '../project03/terrain.ts'
import { islandAt } from '../project03/Vegetation.tsx'
import { buildRegionFields, islandBuilder, TILE, type IslandFields, type RegionFields } from '../project03/vegFields.ts'
import { readHabitat, type Habitat } from '../project03/vegHabitat.ts'
import { riverEdgeField } from '../project03/vegRivers.ts'
import { withInfluence } from '../project03/WorldPlants.tsx'
import { plantsInTile, STRIDE, type SpeciesId, type Water } from '../project03/worldPlants.ts'
import { worldFor, type World } from '../project03/world.ts'

/**
 * Habitat Study — the one piece of the island the study draws: a square window around the Reference Overhang, read once from the world's own pure
 * functions and never written back. The same seed, the same population, the same organism meshes (the 0.3 world's worker and cache), the same 3 m
 * habitat raster and the same plant placement as the world draws there, at the opening of the observation (Year 120, Day 1).
 *
 * Nothing here is drawn; HabitatStudy.tsx draws it. Every style of the study seats its own visual geometry on these data, so the ecology is the same
 * in each.
 */
export const SITE = { seed: DEFAULT_TERRAIN_SEED, cx: 740, cz: -220, half: 130 }

export type StudyTile = { ti: number; tj: number; fields: RegionFields; hab: Habitat }
export type StudyOrganism = { index: number; id: string; x: number; z: number; height: number; radius: number; stage: string; geometry: BufferGeometry; /** Drawn at its own state (young or in later life), not its mature form. */ staged: boolean; dwellerHome: boolean }
export type StudyDweller = { x: number; z: number; home: string }
export type SiteAudit = {
  ground: { min: number; max: number; meanSlope: number; steepShare: number; maxSlope: number }
  water: { nearest: number | null; dir: [number, number] | null; share: number }
  organisms: { id: string; index: number; height: number; stage: string; dist: number; dwellerHome: boolean }[]
  plants: { id: SpeciesId; count: number; inShade: number }[]
  dwellers: number
  ms: { population: number; organisms: number; island: number; tiles: number; plants: number }
}
export type StudySite = {
  world: World
  population: Population
  organisms: StudyOrganism[]
  tiles: StudyTile[]
  plants: Map<SpeciesId, Float32Array>
  dwellers: StudyDweller[]
  /** The habitat raster at a point: the share of the day's sun the structures keep off it (0 to 1), and whether a structure stands on it. */
  shadeAt: (x: number, z: number) => number
  /** A place to stand under the Reference Overhang's roof, toward the water: open ground with the structure overhead (from the habitat's ceiling), or null. */
  underRoof: [number, number] | null
  /** Metres of clear air under a structure at a point (Infinity where nothing is overhead). */
  ceilingAt: (x: number, z: number) => number
  audit: SiteAudit
}

const inWindow = (x: number, z: number, pad = 0) => Math.abs(x - SITE.cx) <= SITE.half + pad && Math.abs(z - SITE.cz) <= SITE.half + pad

/** Mirrors the Dweller placement of Creatures.tsx (`populate`): two at the foot of each of the first four structures whose index is 1 in 6. */
const hash = (a: number, b: number, c: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
  return x - Math.floor(x)
}
function dwellerHomes(world: World, population: Population): { homes: Set<number>; dwellers: StudyDweller[] } {
  const seed = world.seed
  const slope = (x: number, z: number) => Math.hypot(landscapeHeight(x + 3, z) - landscapeHeight(x - 3, z), landscapeHeight(x, z + 3) - landscapeHeight(x, z - 3)) / 6
  const dry = (x: number, z: number) => world.water.depthAt(x, z) <= 0
  const inside = (x: number, z: number) => Math.hypot(x, z) < 1700
  const homes = new Set<number>()
  const dwellers: StudyDweller[] = []
  let n = 0
  for (const o of population.organisms) {
    if (n >= 4 || o.index % 6 !== 1) continue
    for (let k = 0; k < 10; k += 1) {
      const a = hash(seed, o.index, k) * 6.283
      const r = o.radius + 5
      const x = o.x + Math.cos(a) * r
      const z = o.z + Math.sin(a) * r
      if (!dry(x, z) || slope(x, z) > 0.45 || !inside(x, z)) continue
      homes.add(o.index)
      dwellers.push({ x, z, home: o.id })
      for (let j = 0; j < 8; j += 1) {
        const b = hash(seed, o.index, 40 + j) * 6.283
        const x2 = x + Math.cos(b) * (4 + 3 * hash(seed, o.index, 60 + j))
        const z2 = z + Math.sin(b) * (4 + 3 * hash(seed, o.index, 60 + j))
        if (dry(x2, z2) && slope(x2, z2) < 0.45 && Math.hypot(x2 - o.x, z2 - o.z) > o.radius + 2) {
          dwellers.push({ x: x2, z: z2, home: o.id })
          break
        }
      }
      n += 1
      break
    }
  }
  return { homes, dwellers }
}

/**
 * An organism's mesh at its state at `time`, as the world's LivingArchitecture.tsx asks it of the worker (the same rule: the refined lifecycle's
 * phase when there is one, else the ecology's age; the mature form needs no mesh of its own). Null when the mature mesh is the right one.
 */
async function stagedGeometry(population: Population, index: number, key: string, time: number): Promise<BufferGeometry | null> {
  const o = population.organisms[index]!
  const st = organismState(population, index, time)
  const ls = architectureStyle() === 'refined' ? lifeStateAt(population.track[index]!, population.from, o.established, o.died, time) : null
  const ph = ls ? ls.phase : null
  const late = !ph && st.age >= LATE_FROM
  const mature = ph ? !needsRebuild(ls!.L) : st.age >= 1 && !late
  if (mature) return null
  const age = Math.min(ph ? ph.age : st.age, 1.5)
  const state = ph ? { grow: 0, recede: ph.recede, regen: 0, ruin: ph.ruin } : late ? { grow: st.grow, recede: st.recede, regen: st.regen } : undefined
  const geometry = await organismAt(key, age, state, 0)
  return (geometry.getAttribute('position')?.count ?? 0) < 24 ? null : geometry
}

/** The island's fields, built in slices as the world's vegetation does, so the page never stalls. */
function buildIsland(world: World): Promise<IslandFields> {
  const built = islandBuilder(world)
  return new Promise((resolve) => {
    const run = () => {
      const until = performance.now() + 12
      while (performance.now() < until) {
        if (built.step()) {
          resolve(built.fields)
          return
        }
      }
      window.setTimeout(run, 0)
    }
    run()
  })
}

const yieldFrame = () => new Promise<void>((r) => window.setTimeout(r, 0))

let loading: Promise<StudySite> | null = null

/** The site, made once per page load (the world, the population and the organisms' meshes are the 0.3 world's own, and cached the same way). */
export function loadSite(progress: (step: string) => void): Promise<StudySite> {
  loading ??= build(progress)
  return loading
}

async function build(progress: (step: string) => void): Promise<StudySite> {
  const ms = { population: 0, organisms: 0, island: 0, tiles: 0, plants: 0 }
  let t = performance.now()
  const lap = (key: keyof typeof ms) => {
    const now = performance.now()
    ms[key] = Math.round(now - t)
    t = now
  }
  setTerrainSeed(SITE.seed)
  const world = worldFor(SITE.seed)

  progress('Planning the population')
  const population = await loadPopulation(SITE.seed)
  lap('population')

  // Every organism whose footprint or shadow can reach the window (a shadow falls up to ~90 m at the day's lowest working sun).
  const time = worldYears(OBSERVATION_START, 12)
  const { homes, dwellers } = dwellerHomes(world, population)
  const near = population.organisms.filter((o) => inWindow(o.x, o.z, o.radius + 90))
  progress(`Growing ${near.length} organism${near.length === 1 ? '' : 's'}`)
  const organisms: StudyOrganism[] = []
  for (const o of near) {
    const stage = observe(population, o.index, time).stage
    if (stage === 'Not yet here') continue
    const built = await buildOrganism(world, SITE.seed, population, o.index)
    const geometry = (await stagedGeometry(population, o.index, built.key, time)) ?? built.geometry
    organisms.push({ index: o.index, id: o.id, x: o.x, z: o.z, height: o.height, radius: o.radius, stage, geometry, staged: geometry !== built.geometry, dwellerHome: homes.has(o.index) })
  }
  lap('organisms')

  progress('Reading the island’s fields')
  const island = await buildIsland(world)
  lap('island')

  // The habitat is read from the organisms' meshes, exactly as the world reads it from what it draws (vegHabitat.ts).
  progress('Reading shade and shelter')
  const root = new Group()
  for (const o of organisms) root.add(new Mesh(o.geometry))
  const tiles: StudyTile[] = []
  const t0 = Math.floor((SITE.cx - SITE.half) / TILE.size)
  const t1 = Math.floor((SITE.cx + SITE.half) / TILE.size)
  const u0 = Math.floor((SITE.cz - SITE.half) / TILE.size)
  const u1 = Math.floor((SITE.cz + SITE.half) / TILE.size)
  for (let tj = u0; tj <= u1; tj += 1) {
    for (let ti = t0; ti <= t1; ti += 1) {
      const fields = buildRegionFields(world, (ti + 0.5) * TILE.size, (tj + 0.5) * TILE.size)
      tiles.push({ ti, tj, fields, hab: readHabitat(root, fields) })
      await yieldFrame()
    }
  }
  lap('tiles')

  // The plants, from the same placement as WorldPlants.tsx's architecture tiles: the island's conditions with the structures' influence.
  progress('Placing the plants')
  const atIsland = islandAt(island)
  const water: Water = { depth: (x, z) => world.water.depthAt(x, z), edge: riverEdgeField(world) }
  const isLand = (x: number, z: number) => {
    const i = Math.floor((x - island.x0) / island.cell)
    const j = Math.floor((z - island.x0) / island.cell)
    return i >= 0 && j >= 0 && i < island.n && j < island.n && island.land[j * island.n + i] === 1
  }
  // The opening year, whatever the 0.3 clock was last left at: the study is one fixed moment of the world.
  const year = Math.floor(OBSERVATION_START / 10) * 10
  const parts = new Map<SpeciesId, Float32Array[]>()
  for (const tile of tiles) {
    const r = tile.fields.region
    const found = plantsInTile('all', r.x0, r.z0, TILE.size, SITE.seed, year, withInfluence(atIsland, tile.fields, tile.hab), water, (x, z) => !isLand(x, z) || !inWindow(x, z))
    for (const [id, arr] of found) {
      if (!parts.has(id)) parts.set(id, [])
      parts.get(id)!.push(arr)
    }
    await yieldFrame()
  }
  const plants = new Map<SpeciesId, Float32Array>()
  for (const [id, list] of parts) {
    const all = new Float32Array(list.reduce((a, l) => a + l.length, 0))
    let o = 0
    for (const l of list) {
      all.set(l, o)
      o += l.length
    }
    if (all.length) plants.set(id, all)
  }
  lap('plants')

  const tileAt = (x: number, z: number) => tiles.find((tl) => tl.ti === Math.floor(x / TILE.size) && tl.tj === Math.floor(z / TILE.size))
  const shadeAt = (x: number, z: number) => {
    const tl = tileAt(x, z)
    if (!tl) return 0
    const r = tl.fields.region
    const i = Math.min(r.n - 1, Math.max(0, Math.floor((x - r.x0) / r.cell)))
    const j = Math.min(r.n - 1, Math.max(0, Math.floor((z - r.z0) / r.cell)))
    return tl.hab.shade[j * r.n + i]!
  }
  const ceilingAt = (x: number, z: number) => {
    const tl = tileAt(x, z)
    if (!tl) return Infinity
    const r = tl.fields.region
    const i = Math.min(r.n - 1, Math.max(0, Math.floor((x - r.x0) / r.cell)))
    const j = Math.min(r.n - 1, Math.max(0, Math.floor((z - r.z0) / r.cell)))
    return tl.hab.ceiling[j * r.n + i]!
  }

  const report = audit(world, organisms, plants, shadeAt, dwellers, ms)
  const site: StudySite = { world, population, organisms, tiles, plants, dwellers: dwellers.filter((d) => inWindow(d.x, d.z)), shadeAt, underRoof: underRoof(organisms, tiles, report.water.dir), ceilingAt, audit: report }
  console.info('[habitat study] site', site.audit)
  return site
}

function underRoof(organisms: StudyOrganism[], tiles: StudyTile[], dir: [number, number] | null): [number, number] | null {
  const ref = organisms.find((o) => o.index === 0)
  if (!ref) return null
  const [dx, dz] = dir ?? [1, 0]
  let best: [number, number] | null = null
  let score = -Infinity
  for (const { fields, hab } of tiles) {
    const r = fields.region
    for (let j = 0; j < r.n; j += 1) {
      for (let i = 0; i < r.n; i += 1) {
        const k = j * r.n + i
        // Roofed, with headroom to stand and see out, and not on the structure's own footing.
        const ceiling = hab.ceiling[k]!
        if (!(ceiling > 4 && ceiling < 30) || hab.footprint[k]! > 0) continue
        const x = r.x0 + (i + 0.5) * r.cell
        const z = r.z0 + (j + 0.5) * r.cell
        if (Math.hypot(x - ref.x, z - ref.z) > ref.radius * 2.5) continue
        const s = (x - ref.x) * dx + (z - ref.z) * dz - Math.abs(ceiling - 10) * 0.5
        if (s > score) {
          score = s
          best = [x, z]
        }
      }
    }
  }
  return best
}

function audit(world: World, organisms: StudyOrganism[], plants: Map<SpeciesId, Float32Array>, shadeAt: (x: number, z: number) => number, dwellers: StudyDweller[], ms: SiteAudit['ms']): SiteAudit {
  let min = Infinity
  let max = -Infinity
  let slopeSum = 0
  let steep = 0
  let maxSlope = 0
  let wet = 0
  let count = 0
  let nearest: number | null = null
  let dir: [number, number] | null = null
  const step = 4
  for (let z = SITE.cz - SITE.half; z <= SITE.cz + SITE.half; z += step) {
    for (let x = SITE.cx - SITE.half; x <= SITE.cx + SITE.half; x += step) {
      count += 1
      if (world.water.depthAt(x, z) > 0) {
        wet += 1
        const d = Math.hypot(x - SITE.cx, z - SITE.cz)
        if (nearest === null || d < nearest) {
          nearest = d
          dir = [(x - SITE.cx) / d, (z - SITE.cz) / d]
        }
        continue
      }
      const h = landscapeHeight(x, z)
      min = Math.min(min, h)
      max = Math.max(max, h)
      const s = Math.atan(Math.hypot(landscapeHeight(x + 2, z) - landscapeHeight(x - 2, z), landscapeHeight(x, z + 2) - landscapeHeight(x, z - 2)) / 4) * (180 / Math.PI)
      slopeSum += s
      if (s > 18) steep += 1
      maxSlope = Math.max(maxSlope, s)
    }
  }
  const dry = count - wet
  return {
    ground: { min: Math.round(min), max: Math.round(max), meanSlope: Math.round((slopeSum / Math.max(1, dry)) * 10) / 10, steepShare: Math.round((steep / Math.max(1, dry)) * 100) / 100, maxSlope: Math.round(maxSlope) },
    water: { nearest: nearest === null ? null : Math.round(nearest), dir, share: Math.round((wet / count) * 100) / 100 },
    organisms: organisms.map((o) => ({ id: o.id, index: o.index, height: Math.round(o.height), stage: o.stage, dist: Math.round(Math.hypot(o.x - SITE.cx, o.z - SITE.cz)), dwellerHome: o.dwellerHome })),
    plants: [...plants].map(([id, arr]) => {
      let inShade = 0
      for (let o = 0; o < arr.length; o += STRIDE) if (shadeAt(arr[o]!, arr[o + 2]!) > 0.3) inShade += 1
      return { id, count: arr.length / STRIDE, inShade }
    }).sort((a, b) => b.count - a.count),
    dwellers: dwellers.filter((d) => inWindow(d.x, d.z)).length,
    ms,
  }
}

/**
 * The Ground plate: in the shade habitat beyond the roof's edge, low, looking back in under the great shelf: its edge overhead, the shade plants and the
 * hollow beneath it. Found from the roofed spot nearest the water (`underRoof`), out from under the roof toward the water, then some metres more.
 */
export function groundEye(site: StudySite): { x: number; z: number; tx: number; tz: number; side: [number, number] } | null {
  const ref = site.organisms.find((o) => o.index === 0)
  if (!ref) return null
  const [dx, dz] = site.audit.water.dir ?? [1, 0]
  const [sx, sz] = site.underRoof ?? [ref.x + dx * (ref.radius + 6), ref.z + dz * (ref.radius + 6)]
  let back = 2
  while (back < 60 && site.ceilingAt(sx + dx * back, sz + dz * back) < Infinity) back += 2
  back += 24
  while (back > 4 && site.world.water.depthAt(sx + dx * back, sz + dz * back) > 0) back -= 2
  return { x: sx + dx * back - dz * 7, z: sz + dz * back + dx * 7, tx: sx - dx * 4, tz: sz - dz * 4, side: [-dz, dx] }
}

/** The sun at an hour of the study's day (the world's own sun, at its noon elevation). */
export const studySun = (hour: number) => sunAt(hour, environment.controls.noonElevation)
