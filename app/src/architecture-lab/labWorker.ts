import { BufferAttribute, type BufferGeometry } from 'three'
import { sunAt } from '../project/sun.ts'
import { pinSite, waterBearing } from '../project03/livingArchitecture.ts'
import { formFromHabitat } from '../project03/livingEcology.ts'
import { growOverhang3, type OrganismForm } from '../project03/livingOverhang3.ts'
import { refinedForm } from './overhangRefined.ts'
import { applyOverrides, type OverhangOverrides } from './overhangControls.ts'
import { setTerrainCarve, setTerrainSeed } from '../project03/terrain.ts'
import type { World } from '../project03/world.ts'
import { lifeAt, needsRebuild } from './lifecycle.ts'
import { meanSunDir, terrainContext } from './terrainContext.ts'
import { designPorous } from './porousDesign.ts'
import { fieldNormals, meshField, pieces, worldOf } from './fieldMesh.ts'
import { controlsFor, designStrata, planChecks, type StrataControls } from './strataDesign.ts'
import { strataBounds, strataField } from './strataField.ts'
import { landscapeHeight } from '../project03/terrain.ts'
import { porousMesh, type PorousPlan } from './porousGrowth.ts'
import { TERRAIN_SEED, type FamilyId, type Habitat, type OverhangVariant } from './families.ts'

/**
 * The Architecture Lab's worker: grows its specimens (one, two to compare, or six for a contact sheet) on a stand-in world (no terrain
 * meshes, lakes or rivers: only the height field the generators sample, and one lake placed where the water-distance control says),
 * and answers with meshes at ages. It never builds the island. Messages are answered in order; a new `grow` replaces the specimens.
 *
 * One of several (see labPool.ts): each worker grows the specs it is given, by `slot` (a spec's place in the whole view), and keeps what it
 * has grown (by spec) so a view that comes back, or a spec that stays, is not grown again.
 *
 * In:  { type: 'grow', id, specs, slots }   { type: 'mesh', id, req, ages }   (one age per slot of the whole view)
 * Out: { type: 'grown', id, ms, ground, slots, stats, measures }   { type: 'mesh', id, req, ages, slots, meshes, ms }   { type: 'error', id, message }
 */
export type Spec = { family: FamilyId; variant: OverhangVariant; seed: number; habitat: Habitat; site: [number, number]; /** Strata only: controls set by hand (the rest come from the seed). */ morph?: Partial<StrataControls>; /** Overhang only: morphology set by hand (overhangControls.ts). */ overhang?: OverhangOverrides }
export type LabIn = { type: 'grow'; id: number; specs: Spec[]; slots: number[] } | { type: 'mesh'; id: number; req: number; ages: number[] }
export type PackedMesh = { attributes: Record<string, { array: Float32Array; itemSize: number }>; index: Uint32Array | null }
export type LabOut =
  | { type: 'grown'; id: number; ms: number; ground: number; slots: number[]; stats: Record<string, number | string>[]; measures: (Record<string, number> | null)[] }
  | { type: 'mesh'; id: number; req: number; ages: number[]; slots: number[]; meshes: PackedMesh[]; ms: number }
  | { type: 'error'; id: number; message: string }

const post = (message: LabOut, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer)

/** Removes the triangles of connected pieces smaller than `min` vertices (what was cut off from the body). */
function dropSmall(g: BufferGeometry, min: number): BufferGeometry {
  const ix = g.index!.array as Uint32Array
  const n = g.getAttribute('position').count
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i += 1) parent[i] = i
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!
      x = parent[x]!
    }
    return x
  }
  for (let i = 0; i < ix.length; i += 3) {
    const a = find(ix[i]!)
    parent[find(ix[i + 1]!)] = a
    parent[find(ix[i + 2]!)] = a
  }
  const size = new Map<number, number>()
  for (let i = 0; i < n; i += 1) {
    const r = find(i)
    size.set(r, (size.get(r) ?? 0) + 1)
  }
  const keep: number[] = []
  for (let i = 0; i < ix.length; i += 3) if ((size.get(find(ix[i]!)) ?? 0) >= min) keep.push(ix[i]!, ix[i + 1]!, ix[i + 2]!)
  if (keep.length === ix.length) return g
  g.setIndex(new BufferAttribute(new Uint32Array(keep), 1))
  return g
}

function pack(geometry: BufferGeometry): [PackedMesh, Transferable[]] {
  const attributes: PackedMesh['attributes'] = {}
  const transfer: Transferable[] = []
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const array = attribute.array as Float32Array
    attributes[name] = { array, itemSize: attribute.itemSize }
    transfer.push(array.buffer)
  }
  const index = (geometry.index?.array as Uint32Array | undefined) ?? null
  if (index) transfer.push(index.buffer)
  return [{ attributes, index }, transfer]
}

/** A stand-in for the world: the generators ask it only where there is water. A lake sits `waterDist` metres from the site, on the +x, -z side. */
function standIn(seed: number, waterDist: number | null, site: [number, number]): World {
  const R = 60
  const len = Math.hypot(0.6, 0.8)
  const cx = site[0] + (0.6 / len) * ((waterDist ?? 0) + R)
  const cz = site[1] - (0.8 / len) * ((waterDist ?? 0) + R)
  const depthAt = (x: number, z: number) => (waterDist !== null && Math.hypot(x - cx, z - cz) < R ? 1.2 : 0)
  return { seed, water: { depthAt } } as unknown as World
}

function plan(spec: Spec): PorousPlan {
  const h = spec.habitat
  const sun = sunAt(12, 55).direction
  const wb = h.waterDist === null ? null : waterBearing(standIn(spec.seed, h.waterDist, spec.site), spec.site[0], spec.site[1])
  return designPorous(spec.seed, spec.site, { light: h.light, moisture: h.moisture, resource: h.resource, ridge: h.ridge, crowding: h.crowding, waterDist: h.waterDist, size: h.size, sunAzimuth: Math.atan2(sun[0], sun[2]), waterAzimuth: wb ? Math.atan2(wb[0], wb[2]) : null })
}

type Built = { mesh: (age: number) => BufferGeometry; stats: Record<string, number | string>; measure: Record<string, number> | null; ground: number }
let specimens: { id: number; slots: number[]; built: Built[] } | null = null
/** What this worker has grown, by spec (the newest last): a spec that comes again is not grown again. */
const kept = new Map<string, Built>()
const KEEP = 6

/**
 * Strata: the seed's controls (with any set by hand), the plan with its derived joints, the field meshed in the frame of the site: the blade
 * along the day's mean sun, at half the reference organism's size (the 60 m working scale) times the habitat's Size. Mature form only: every
 * age is the same mesh. The stats report the checks: how many pieces the mesh is in (1 is whole), the void and its clearance.
 */
function growStrata(spec: Spec): Built {
  const started = performance.now()
  const controls = controlsFor(spec.seed, spec.morph)
  const plan = designStrata(controls)
  const sdf = strataField(plan)
  const S = 0.5 * spec.habitat.size
  const sun = meanSunDir()
  const l = Math.hypot(sun[0], sun[1]) || 1
  const u: [number, number] = [sun[0] / l, sun[1] / l]
  const frame = { cx: spec.site[0], cz: spec.site[1], g0: landscapeHeight(spec.site[0], spec.site[1]), u, w: [-u[1], u[0]] as [number, number] }
  const g = meshField(sdf, frame, S, 0.7 * S, strataBounds(plan))
  fieldNormals(g, worldOf(sdf, frame, S))
  const p = pieces(g)
  const checks = planChecks(plan, sdf)
  const r2 = (v: number) => Math.round(v * 100) / 100
  const stats: Record<string, number | string> = {
    reach: r2(controls.reach), rise: r2(controls.rise), mass: r2(controls.mass), support: r2(controls.support), tiers: plan.shelves.length, swing: r2(controls.swing), crease: r2(controls.crease),
    pieces: p.length, detachedVertices: p.slice(1).reduce((a, b) => a + b, 0), voidWidth: Math.round(checks.voidWidth * S), headroom: Math.round(checks.headroom * S), openRun: r2(checks.openRun * S), layers: checks.layers,
    vertices: g.getAttribute('position').count, buildMs: Math.round(performance.now() - started),
  }
  g.computeBoundingBox()
  return { mesh: () => g.clone(), stats: { ...stats, height: Math.round(g.boundingBox!.max.y - frame.g0) }, measure: null, ground: frame.g0 }
}

function growOne(spec: Spec): Built {
  if (spec.family === 'strata') return growStrata(spec)
  if (spec.family === 'overhang') {
    // The world's own Overhang generator: as it is ('original'), or with the lab's seed-chosen composition ('refined').
    const h = spec.habitat
    const world = standIn(spec.seed, h.waterDist, spec.site)
    pinSite(spec.seed, spec.site)
    const base: OrganismForm = {
      anchored: true,
      site: spec.site,
      size: h.size,
      step: Math.min(2.6, 1 / h.size),
      ...formFromHabitat({ lit: Math.max(-1, Math.min(1, (h.light - 0.55) / 0.25)), resource: h.resource, ridge: h.ridge, crowding: h.crowding, moisture: h.moisture, waterDist: h.waterDist ?? 400, size: h.size }),
      outlier: h.resource > 0.42 && h.size > 0.55,
      oldShelf: h.size >= 0.6,
    }
    // The ground at this site, against the reference site's (the lab's one lake lies on the +x, -z side, so the water side is the same everywhere).
    const wb = h.waterDist === null ? null : waterBearing(world, spec.site[0], spec.site[1])
    const b: [number, number] = [-meanSunDir()[1], meanSunDir()[0]]
    const cs = wb && wb[0] * b[0] + wb[2] * b[1] < 0 ? -1 : 1
    // Morphology set by hand applies last, to what the habitat and the seed made (none set: the form is untouched).
    const form = applyOverrides(spec.variant === 'refined' ? refinedForm(spec.seed, h, base, terrainContext(spec.site, cs)) : base, spec.overhang)
    // The outlier body arrives through the shelf that reaches it (never standing apart while the tower is young).
    const o = growOverhang3(world, spec.seed, { variation: 0, life: true, coarse: true, outlierStart: 1e5, form })
    const mature = o.life!.grown()
    const life = o.life!
    // The mature mesh is drawn with the growth shader at every age before its end; a new mesh is built only where the lifecycle changes the geometry.
    const mesh = (L: number) => {
      if (!needsRebuild(L)) return mature.clone()
      const p = lifeAt(L)
      // Before maturity, the organism as it is at that age: a closed solid of the tissue that has arrived. After it, weathered and ruined.
      const g = life.at(Math.round(p.age * 50) / 50, { grow: 0, recede: p.recede, regen: 0, ruin: p.ruin })
      // While the structure stands (before death), tissue cut off by weathering or by the growth front is not kept as separate fragments.
      return L < 0.74 ? dropSmall(g, 150) : g
    }
    return { mesh, stats: { ...(o.stats ?? {}), height: Math.round(o.height) }, measure: null, ground: o.ground }
  }
  const p = plan(spec)
  return { mesh: (age) => porousMesh(p, age), stats: p.stats, measure: p.measure, ground: p.y0 }
}

function grow(message: Extract<LabIn, { type: 'grow' }>) {
  setTerrainSeed(TERRAIN_SEED)
  setTerrainCarve(null)
  const started = performance.now()
  const built: Built[] = message.specs.map((spec) => {
    const key = JSON.stringify(spec)
    let b = kept.get(key)
    if (b) kept.delete(key)
    else b = growOne(spec)
    kept.set(key, b)
    while (kept.size > KEEP) kept.delete(kept.keys().next().value!)
    return b
  })
  specimens = { id: message.id, slots: message.slots, built }
  post({ type: 'grown', id: message.id, ms: Math.round(performance.now() - started), ground: built[0]?.ground ?? 0, slots: message.slots, stats: built.map((b) => b.stats), measures: built.map((b) => b.measure) })
}

self.onmessage = (event: MessageEvent<LabIn>) => {
  const message = event.data
  try {
    if (message.type === 'grow') {
      grow(message)
      return
    }
    if (!specimens || specimens.id !== message.id) return
    const started = performance.now()
    const meshes: PackedMesh[] = []
    const transfer: Transferable[] = []
    specimens.built.forEach((b, i) => {
      const [m, t] = pack(b.mesh(message.ages[specimens!.slots[i]!] ?? message.ages[0]!))
      meshes.push(m)
      transfer.push(...t)
    })
    post({ type: 'mesh', id: message.id, req: message.req, ages: message.ages, slots: specimens.slots, meshes, ms: Math.round(performance.now() - started) }, transfer)
  } catch (error) {
    post({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) })
  }
}
