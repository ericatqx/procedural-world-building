import type { BufferGeometry } from 'three'
import { planPopulation, type Population } from './livingEcology.ts'
import type { LateState } from './livingLife.ts'
import { growOverhang3, type OrganismForm, type OverhangLife } from './livingOverhang3.ts'
import { refinedSeed, refinedWorldForm } from './livingRefined.ts'
import { growVoxel } from './livingVoxel.ts'
import { setTerrainSeed } from './terrain.ts'
import { createWorld, type World } from './world.ts'

/**
 * Living Architecture, built off the main thread. The worker makes its own world from the seed (the terrain, the lakes
 * and the rivers that cut it: the same pure functions of the seed, so the same ground), plans the population on it
 * (livingEcology.ts), grows each organism with its lifecycle, and answers with its mature mesh; it then keeps each
 * lifecycle and answers each request for an organism's mesh at an age and a later-life state. Meshes travel as typed
 * arrays, transferred (not copied). Messages are answered in the order they arrive.
 *
 * Messages in:  { type: 'population', seed }   { type: 'coarse', key, seed, index, variation }   { type: 'build', key, seed, index, variation }
 *               { type: 'stage', key, id, age, late }   { type: 'view', x, z }
 * Messages out: { type: 'population', seed, population }   { type: 'coarse', key, mesh, site, ground, height }
 *               { type: 'built', key, mesh, stats, site, ground, height }   { type: 'stage', key, id, mesh }
 *
 * Work is queued and taken in order of need, not of arrival: an organism's state (a stage) first, then the fine builds,
 * nearest the view first (`view` says where it is). A coarse stand-in is not queued for the scene: a young organism stays
 * hidden until the mesh for its age exists.
 */

export type PackedMesh = { attributes: Record<string, { array: Float32Array; itemSize: number }>; index: Uint32Array }
export type WorkerIn =
  | { type: 'population'; seed: number }
  | { type: 'build'; key: string; seed: number; index: number; variation: number; style?: 'refined' | 'classic' }
  | { type: 'coarse'; key: string; seed: number; index: number; variation: number; style?: 'refined' | 'classic' }
  | { type: 'view'; x: number; z: number }
  | { type: 'grown'; key: string; seed: number; variation: number }
  | { type: 'voxel'; key: string; seed: number }
  | { type: 'stage'; key: string; id: number; age: number; late?: LateState; near?: number }
export type WorkerOut =
  | { type: 'population'; seed: number; population: Population }
  | { type: 'grown'; key: string; mesh: PackedMesh; stats: Record<string, number> }
  | { type: 'voxel'; key: string; solid: Uint8Array; birth: Int16Array; ground: Int16Array; origin: [number, number, number]; site: [number, number]; stats: Record<string, number | string> }
  | { type: 'coarse'; key: string; mesh: PackedMesh; site: [number, number]; ground: number; height: number }
  | { type: 'built'; key: string; mesh: PackedMesh; stats: Record<string, number>; site: [number, number]; ground: number; height: number }
  | { type: 'stage'; key: string; id: number; mesh: PackedMesh }

const post = (message: WorkerOut, transfer: Transferable[]) => (self as unknown as Worker).postMessage(message, transfer)

function pack(geometry: BufferGeometry): [PackedMesh, Transferable[]] {
  const attributes: PackedMesh['attributes'] = {}
  const transfer: Transferable[] = []
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const array = attribute.array as Float32Array
    attributes[name] = { array, itemSize: attribute.itemSize }
    transfer.push(array.buffer)
  }
  const index = geometry.index!.array as Uint32Array
  transfer.push(index.buffer)
  return [{ attributes, index }, transfer]
}

let world: World | null = null
let population: Population | null = null
const lives = new Map<string, OverhangLife>()

function worldFor(seed: number): World {
  if (world?.seed === seed) return world
  setTerrainSeed(seed)
  world = createWorld(seed)
  population = null
  lives.clear()
  return world
}

function populationFor(seed: number): Population {
  const w = worldFor(seed)
  if (!population || population.seed !== seed) population = planPopulation(w, seed)
  return population
}

/** The refined Overhang's form for an organism (the Architecture Lab's, in the world's terms), made once. */
const refinedForms = new Map<string, OrganismForm>()
function refinedFor(seed: number, index: number): OrganismForm {
  const key = `${seed}:${index}`
  let form = refinedForms.get(key)
  if (!form) {
    form = refinedWorldForm(worldFor(seed), populationFor(seed).organisms[index]!)
    refinedForms.set(key, form)
  }
  return form
}

/** How much coarser the first form of an organism is sampled than its fine one. */
const COARSE = 2.8

/** `ready`: whether it can run yet (a request for a stage waits for the build that makes its lifecycle). */
type Job = { rank: () => number; run: () => void; ready?: () => boolean }
const queue: Job[] = []
let draining = false
let view: { x: number; z: number } | null = null

function enqueue(job: Job) {
  queue.push(job)
  if (draining) return
  draining = true
  setTimeout(drain, 0)
}

function drain() {
  if (!queue.length) {
    draining = false
    return
  }
  let best = -1
  let rank = Infinity
  for (let i = 0; i < queue.length; i += 1) {
    const job = queue[i]!
    if (job.ready && !job.ready()) continue
    const r = job.rank()
    if (r < rank) {
      rank = r
      best = i
    }
  }
  if (best < 0) {
    // Everything left is waiting on something else: look again shortly.
    setTimeout(drain, 20)
    return
  }
  const [job] = queue.splice(best, 1)
  job!.run()
  setTimeout(drain, 0)
}

/** Keys with a stage request waiting: their builds go first, so the age mesh can be made. The cached mature mesh is not shown in its place. */
const wanted = new Set<string>()

/** Where an organism stands from the view, for the order of fine builds (the reference's own site until the view is known). */
function nearness(seed: number, index: number): number {
  const o = populationFor(seed).organisms[index]!
  const at = view ?? { x: populationFor(seed).organisms[0]!.x, z: populationFor(seed).organisms[0]!.z }
  return Math.hypot(o.x - at.x, o.z - at.z)
}

self.onmessage = (event: MessageEvent<WorkerIn>) => {
  const message = event.data
  if (message.type === 'population') {
    // A copy goes to the page (its series are transferred); the worker keeps its own.
    const own = populationFor(message.seed)
    const copy: Population = { ...own, series: own.series.map((s) => s.slice()), track: own.track.map((s) => s.slice()) }
    post({ type: 'population', seed: message.seed, population: copy }, [...copy.series.map((s) => s.buffer), ...copy.track.map((s) => s.buffer)])
    return
  }
  if (message.type === 'view') {
    view = { x: message.x, z: message.z }
    return
  }
  if (message.type === 'voxel') {
    // The voxel growth prototype: grown here (about a second), sent as three typed arrays; the page makes the meshes.
    enqueue({
      rank: () => 0.95,
      run: () => {
        const w = worldFor(message.seed)
        const org = growVoxel(w, message.seed, populationFor(message.seed))
        post({ type: 'voxel', key: message.key, solid: org.solid, birth: org.birth, ground: org.ground, origin: org.origin, site: org.site, stats: org.stats }, [org.solid.buffer, org.birth.buffer, org.ground.buffer])
      },
    })
    return
  }
  if (message.type === 'grown') {
    // The continuous-growth prototype (LA-01 only): the mature mesh with its growth attributes, nothing else.
    enqueue({
      rank: () => 0.95,
      run: () => {
        const w = worldFor(message.seed)
        const t0 = performance.now()
        const built = growOverhang3(w, message.seed, { variation: message.variation, life: true })
        const t1 = performance.now()
        const mesh = built.life!.grown()
        const t2 = performance.now()
        const [packed, transfer] = pack(mesh)
        post({ type: 'grown', key: message.key, mesh: packed, stats: { growMs: Math.round(t1 - t0), growthAttributesMs: Math.round(t2 - t1), vertices: mesh.getAttribute('position').count, triangles: mesh.index!.count / 3 } }, transfer)
      },
    })
    return
  }
  if (message.type === 'coarse') {
    enqueue({
      rank: () => 1 + message.index * 1e-4,
      run: () => {
        const w = worldFor(message.seed)
        if (message.style === 'refined') {
          const refined = refinedFor(message.seed, message.index)
          const rough = growOverhang3(w, refinedSeed(message.index), { variation: 0, coarse: true, outlierStart: 1e5, form: { ...refined, step: (refined.step ?? 0.9) * COARSE } })
          const [mesh, transfer] = pack(rough.geometry)
          post({ type: 'coarse', key: message.key, mesh, site: rough.site, ground: rough.ground, height: rough.height }, transfer)
          return
        }
        const plan = message.index === 0 ? null : populationFor(message.seed).organisms[message.index]!
        const form = plan ? { ...plan.form, step: (plan.form.step ?? 0.8) * COARSE } : { step: 0.8 * COARSE }
        const built = growOverhang3(w, message.seed, { variation: plan ? plan.variation : message.variation, form })
        const [mesh, transfer] = pack(built.geometry)
        post({ type: 'coarse', key: message.key, mesh, site: built.site, ground: built.ground, height: built.height }, transfer)
      },
    })
    return
  }
  if (message.type === 'build') {
    enqueue({
      rank: () => (wanted.has(message.key) ? 2 : 10 + nearness(message.seed, message.index)),
      run: () => {
        const w = worldFor(message.seed)
        if (message.style === 'refined') {
          // The Architecture Lab's refined Overhang, in this organism's habitat and terrain: its life is read at any lifecycle stage.
          const refined = refinedFor(message.seed, message.index)
          const grown = growOverhang3(w, refinedSeed(message.index), { variation: 0, life: true, coarse: true, outlierStart: 1e5, form: refined })
          lives.set(message.key, grown.life!)
          const [mesh, transfer] = pack(grown.life!.grown())
          post({ type: 'built', key: message.key, mesh, stats: { ...grown.stats, ...grown.life!.timing }, site: grown.site, ground: grown.ground, height: grown.height }, transfer)
          return
        }
        // The reference organism (index 0) is grown exactly as it always was; the others from the form their ground gives.
        const plan = message.index === 0 ? null : populationFor(message.seed).organisms[message.index]!
        const built = growOverhang3(w, message.seed, plan ? { variation: plan.variation, life: true, form: plan.form } : { variation: message.variation, life: true })
        lives.set(message.key, built.life!)
        const [mesh, transfer] = pack(built.geometry)
        post({ type: 'built', key: message.key, mesh, stats: { ...built.stats, ...built.life!.timing }, site: built.site, ground: built.ground, height: built.height }, transfer)
      },
    })
    return
  }
  // A stage request can arrive before the build that makes its lifecycle: it waits, and the organism stays hidden until it can run.
  wanted.add(message.key)
  // Nearest the view first among stage requests (distance in metres, scaled to stay under every other kind of job).
  enqueue({
    rank: () => Math.min(0.9, (message.near ?? 0) / 1e5),
    ready: () => lives.has(message.key),
    run: () => {
      const life = lives.get(message.key)
      if (!life) return
      const [mesh, transfer] = pack(life.at(message.age, message.late))
      post({ type: 'stage', key: message.key, id: message.id, mesh }, transfer)
    },
  })
}
