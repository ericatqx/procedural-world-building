import { BufferAttribute, BufferGeometry } from 'three'
import { fieldAt } from './livingLife.ts'
import { chooseSite, skin, waterBearing, waterDistance } from './livingArchitecture.ts'
import { surfaceNets } from './livingMesh.ts'
import { capsule, overhangOptionsFromUrl, rect2, slab, smin } from './livingOverhang.ts'
import { growOverhang3 } from './livingOverhang3.ts'
import { vnoise } from './livingStrata.ts'
import { landscapeHeight } from './terrain.ts'
import type { OrganismPlan, Population } from './livingEcology.ts'
import type { LateState } from './livingLife.ts'
import type { PackedMesh, WorkerIn, WorkerOut } from './livingWorker.ts'
import type { VoxelOrganism } from './livingVoxel.ts'
import type { World } from './world.ts'

/**
 * The main thread's side of Living Architecture's worker (livingWorker.ts).
 *
 *   population  one plan per seed (livingEcology.ts), computed in the worker first, before any organism is grown.
 *   builds      one per organism: asking again (a remount, React's strict double render, toggling the architecture
 *               off and on) returns the same promise and the same mature mesh. Only the latest seed's are kept.
 *   cache       each organism's mature mesh is kept in the browser (IndexedDB), so a refresh shows it at once while the
 *               worker grows its lifecycle in the background. Its key is a fingerprint of everything the mesh depends
 *               on: the source of the code that makes it, the ground and the water around its site, the seed, the
 *               variation and its form. Change any of them and the key changes, so a stale mesh is never shown.
 */
export type OverhangBuilt = { key: string; geometry: BufferGeometry; stats: Record<string, number>; site: [number, number]; ground: number; height: number; cached: boolean }
type Stored = { mesh: PackedMesh; stats: Record<string, number>; site: [number, number]; ground: number; height: number }

let worker: Worker | null = null
export type CoarseBuilt = { geometry: BufferGeometry; site: [number, number]; ground: number; height: number }
let current: { seed: number; population: Promise<Population>; builds: Map<number, Promise<OverhangBuilt>>; coarse: Map<number, Promise<CoarseBuilt>> } | null = null
const waitingVoxel = new Map<string, (message: Extract<WorkerOut, { type: 'voxel' }>) => void>()
const waitingGrown = new Map<string, (message: Extract<WorkerOut, { type: 'grown' }>) => void>()
const waitingCoarse = new Map<string, (message: Extract<WorkerOut, { type: 'coarse' }>) => void>()
const waitingPopulation = new Map<number, (population: Population) => void>()
const waitingBuilds = new Map<string, (message: Extract<WorkerOut, { type: 'built' }>) => void>()
const stages = new Map<number, (geometry: BufferGeometry) => void>()
let nextId = 0

function unpack(mesh: PackedMesh): BufferGeometry {
  const geometry = new BufferGeometry()
  for (const [name, { array, itemSize }] of Object.entries(mesh.attributes)) geometry.setAttribute(name, new BufferAttribute(array, itemSize))
  geometry.setIndex(new BufferAttribute(mesh.index, 1))
  geometry.computeBoundingSphere()
  return geometry
}

function connect(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./livingWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<WorkerOut>) => {
    const message = event.data
    if (message.type === 'population') {
      waitingPopulation.get(message.seed)?.(message.population)
      waitingPopulation.delete(message.seed)
      return
    }
    if (message.type === 'voxel') {
      waitingVoxel.get(message.key)?.(message)
      waitingVoxel.delete(message.key)
      return
    }
    if (message.type === 'grown') {
      waitingGrown.get(message.key)?.(message)
      waitingGrown.delete(message.key)
      return
    }
    if (message.type === 'coarse') {
      waitingCoarse.get(message.key)?.(message)
      waitingCoarse.delete(message.key)
      return
    }
    if (message.type === 'built') {
      waitingBuilds.get(message.key)?.(message)
      waitingBuilds.delete(message.key)
      return
    }
    const done = stages.get(message.id)
    stages.delete(message.id)
    if (done) done(unpack(message.mesh))
  }
  return worker
}

// ------------------------------------------------------------------------------------------------ the fingerprint
const SOURCES = [growOverhang3, fieldAt, surfaceNets, capsule, rect2, slab, smin, vnoise, skin, chooseSite, waterBearing, waterDistance, landscapeHeight].map((f) => f.toString()).join('\n')

function fnv(text: string, h = 0x811c9dc5): number {
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/** Everything an organism's mature mesh depends on, as one key: the code, the ground and the water it stands in, its form. */
function fingerprint(world: World, seed: number, variation: number, organism?: OrganismPlan): string {
  const [sx, sz] = organism?.form.site ?? chooseSite(world, seed)
  const samples: number[] = []
  for (let i = -6; i <= 6; i += 1) {
    for (let j = -6; j <= 6; j += 1) {
      const x = sx + i * 16
      const z = sz + j * 16
      samples.push(landscapeHeight(x, z), world.water.depthAt(x, z))
    }
  }
  samples.push(waterDistance(world, sx, sz), ...waterBearing(world, sx, sz))
  const ground = fnv(samples.map((v) => v.toFixed(4)).join(','))
  const base = `overhang3:${seed}:${variation}:${fnv(SOURCES).toString(36)}:${ground.toString(36)}`
  return organism ? `${base}:${organism.index}:${fnv(JSON.stringify(organism.form)).toString(36)}` : base
}

// ------------------------------------------------------------------------------------------------ the browser cache
const DB = 'shadow-ecology'
const STORE = 'living-architecture'
/** How many meshes are kept (the reference about 2 MB, the others much less): about the population of two seeds. */
const KEEP = 72

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function read(key: string): Promise<Stored | null> {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      request.onsuccess = () => resolve((request.result as Stored | undefined) ?? null)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function write(key: string, value: Stored) {
  const db = await open()
  if (!db) return
  try {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
    const keys = store.getAllKeys()
    keys.onsuccess = () => {
      const others = (keys.result as string[]).filter((k) => k !== key)
      for (const k of others.slice(0, Math.max(0, others.length - (KEEP - 1)))) store.delete(k)
      store.put(value, key)
    }
  } catch {
    // A browser without storage (or with it blocked) builds every time.
  }
}

// ------------------------------------------------------------------------------------------------ the population, builds and stages
function forSeed(seed: number) {
  if (current?.seed === seed) return current
  for (const build of current?.builds.values() ?? []) void build.then((built) => built.geometry.dispose())
  for (const rough of current?.coarse.values() ?? []) void rough.then((built) => built.geometry.dispose())
  const population = new Promise<Population>((resolve) => waitingPopulation.set(seed, resolve))
  const message: WorkerIn = { type: 'population', seed }
  connect().postMessage(message)
  current = { seed, population, builds: new Map(), coarse: new Map() }
  return current
}

/** The population planned for a seed (computed once, in the worker). */
export function loadPopulation(seed: number): Promise<Population> {
  return forSeed(seed).population
}

// Starting an organism's build takes its fingerprint (a few hundred samples of the ground and the water): done for the whole
// population at once, that would hold the page for a moment, so the starts are taken one to a turn of the event loop.
const starts: (() => void)[] = []
let starting = false
function later(task: () => void) {
  starts.push(task)
  if (starting) return
  starting = true
  const next = () => {
    const run = starts.shift()
    if (!run) {
      starting = false
      return
    }
    run()
    setTimeout(next, 0)
  }
  setTimeout(next, 0)
}

/** An organism's mature mesh: from the browser's cache at once when it has it, otherwise when the worker has grown it. */
export function buildOrganism(world: World, seed: number, population: Population | null, index: number): Promise<OverhangBuilt> {
  const own = forSeed(seed)
  const existing = own.builds.get(index)
  if (existing) return existing
  const variation = overhangOptionsFromUrl().variation ?? 0
  const promise = new Promise<OverhangBuilt>((resolve) => {
    later(() => {
      const key = index === 0 ? fingerprint(world, seed, variation) : fingerprint(world, seed, variation, population!.organisms[index]!)
      let done = false
      const finish = (stored: Stored, cached: boolean) => {
        if (done) return
        done = true
        resolve({ key, geometry: unpack(stored.mesh), stats: stored.stats, site: stored.site, ground: stored.ground, height: stored.height, cached })
      }
      // The worker always grows the organism (its lifecycle is needed for every state but the mature one); the cache, when
      // it has the mesh, only lets it be shown before the worker is done.
      waitingBuilds.set(key, (message) => {
        const stored: Stored = { mesh: message.mesh, stats: message.stats, site: message.site, ground: message.ground, height: message.height }
        // Stored only when it was not already: the browser copies it when it writes it, after this.
        if (!done) void write(key, stored)
        finish(stored, false)
      })
      const message: WorkerIn = { type: 'build', key, seed, index, variation }
      connect().postMessage(message)
      void read(key).then((stored) => {
        if (stored) finish(stored, true)
      })
    })
  })
  own.builds.set(index, promise)
  return promise
}

/**
 * An organism's coarse form: the same organism, grown on a grid about three times coarser, so it costs a few milliseconds
 * and every organism can stand in its place at once. It is shown until the fine mesh (buildOrganism) arrives.
 */
export function buildCoarse(seed: number, index: number): Promise<CoarseBuilt> {
  const own = forSeed(seed)
  const existing = own.coarse.get(index)
  if (existing) return existing
  const key = `coarse:${seed}:${index}`
  const promise = new Promise<CoarseBuilt>((resolve) => {
    waitingCoarse.set(key, (message) => resolve({ geometry: unpack(message.mesh), site: message.site, ground: message.ground, height: message.height }))
    const message: WorkerIn = { type: 'coarse', key, seed, index, variation: overhangOptionsFromUrl().variation ?? 0 }
    connect().postMessage(message)
  })
  own.coarse.set(index, promise)
  return promise
}

/** The voxel growth prototype's organism (livingVoxel.ts), grown in the worker. */
export function buildVoxel(seed: number): Promise<VoxelOrganism> {
  const key = `voxel:${seed}`
  return new Promise((resolve) => {
    waitingVoxel.set(key, (m) => resolve({ solid: m.solid, birth: m.birth, ground: m.ground, origin: m.origin, site: m.site, stats: m.stats }))
    const message: WorkerIn = { type: 'voxel', key, seed }
    connect().postMessage(message)
  })
}

/**
 * The continuous-growth prototype's organism: LA-01's mature mesh with the growth attributes (when each vertex's tissue arrives,
 * and how far in its middle lies), made once in the worker. The same mesh is drawn at every age by the growth shader.
 */
export function buildGrown(seed: number): Promise<{ geometry: BufferGeometry; stats: Record<string, number> }> {
  const key = `grown:${seed}`
  return new Promise((resolve) => {
    waitingGrown.set(key, (message) => resolve({ geometry: unpack(message.mesh), stats: message.stats }))
    const message: WorkerIn = { type: 'grown', key, seed, variation: overhangOptionsFromUrl().variation ?? 0 }
    connect().postMessage(message)
  })
}

/** Tells the worker where the view is, so the fine builds still waiting are taken nearest first. */
export function setViewpoint(x: number, z: number) {
  const message: WorkerIn = { type: 'view', x, z }
  connect().postMessage(message)
}

/** An organism's mesh at a lifecycle age and later-life state (the caller owns it). Answered in order, after its build. */
export function organismAt(key: string, age: number, late?: LateState, near = 0): Promise<BufferGeometry> {
  const id = nextId++
  const promise = new Promise<BufferGeometry>((resolve) => stages.set(id, resolve))
  const message: WorkerIn = { type: 'stage', key, id, age, late, near }
  connect().postMessage(message)
  return promise
}

/**
 * Starts Living Architecture as soon as the world exists, before the scene mounts: the population plan first, then the
 * reference organism, then the others (nearest the reference first). The scene shares these builds.
 */
export function prefetchArchitecture(world: World, variant: string) {
  if (variant !== 'overhang3' || typeof Worker === 'undefined') return
  const seed = world.seed
  void loadPopulation(seed).then((population) => {
    // The whole population first, coarse; then the fine builds, which the worker takes nearest the view first.
    for (const o of population.organisms) void buildCoarse(seed, o.index)
    for (const o of population.organisms) void buildOrganism(world, seed, population, o.index)
  })
}
