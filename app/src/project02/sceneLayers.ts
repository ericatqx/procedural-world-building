import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Material,
} from 'three'
import { cellCenter, CELL, GRID_EXTENT, GRID_SIZE, sampleGrid } from './grid.ts'
import type { LodLevel } from '../weeks/week07/traceMesh.ts'
import { MEMBER, hash01, smoothstep, type Lens } from './core.ts'
import { tipCenter, type Architecture, type Tip } from './architecture.ts'
import { archLodFor, buildChunk, buildChunkMarching, chunkCentre, type ArchLod, type ArchRepresentation } from './archMesh.ts'
import { flyerHeading } from './creatures.ts'
import type { PlantForm } from './plantForms.ts'
import type { CreatureView, WayOfSeeing } from './perception.ts'
import type { Fragment, Runtime } from './runtime.ts'
import type { SurfaceMaterial } from '../shared/shaders/surfaceMaterial.ts'
import type { Statics } from './statics.ts'
import { windSpeed } from './weather.ts'
import { fieldAt, windField, type WindField } from './wind.ts'

/**
 * Shadow Ecology 0.2 — imperative scene layers. Each owns its three.js
 * objects, reads the Runtime once per frame (or less) and never writes the
 * simulation. Level of detail is chosen here, per chunk, plant and creature,
 * from camera distance: one state, several representations.
 */
const matrix = new Matrix4()
const quat = new Quaternion()
const pos = new Vector3()
const scl = new Vector3()
const UP = new Vector3(0, 1, 0)
const tint = new Color()

const LEVELS: readonly LodLevel[] = ['full', 'reduced', 'skeleton']

/** Distances (world units) where plants and creatures step down a level. */
export const LOD_DISTANCE = {
  plant: [13, 34],
  creature: [16, 40],
} as const

const levelFor = (distance: number, [near, far]: readonly [number, number], override: number | null) =>
  override ?? (distance < near ? 0 : distance < far ? 1 : 2)

/** Marks only the first `items` entries for upload instead of the whole buffer. */
const upload = (attribute: BufferAttribute, items: number) => {
  if (!items) return
  attribute.clearUpdateRanges()
  attribute.addUpdateRange(0, items * attribute.itemSize)
  attribute.needsUpdate = true
}

// ─── Architecture ─────────────────────────────────────────────────────────

type BuiltChunk = { mesh: Mesh | null; version: number; lod: ArchLod; representation: ArchRepresentation; triangles: number }

export class ArchChunks {
  readonly object = new Group()
  private built = new Map<number, BuiltChunk>()
  private arch: Architecture | null = null
  private representation: ArchRepresentation = 'blocks'
  private surface: SurfaceMaterial

  constructor(surface: SurfaceMaterial) {
    this.surface = surface
  }

  /** Rebuilds up to `budget` stale chunks, nearest first; returns telemetry. `lodScale` stretches the LOD distances. */
  update(arch: Architecture, camera: Vector3, override: ArchLod | null, budget: number, representation: ArchRepresentation, lodScale = 1) {
    if (arch !== this.arch) {
      this.clear()
      this.arch = arch
    }
    const across = arch.chunksAcross
    const stale: { c: number; d: number; lod: ArchLod; version: number }[] = []
    const chunks: [number, number, number] = [0, 0, 0]
    let triangles = 0
    this.representation = representation
    for (let c = 0; c < across * across; c += 1) {
      const version = arch.chunkVersion[c]!
      const built = this.built.get(c)
      if (!version && !built) continue
      const [x, z] = chunkCentre(arch, c % across, Math.floor(c / across))
      const d = Math.hypot(camera.x - x, camera.y - 0.1, camera.z - z)
      // Marching Cubes draws the voxels as they are, at one level.
      const lod = representation === 'marching' ? 1 : (override ?? archLodFor(d / lodScale, built?.lod ?? 1))
      if (!built || built.version !== version || built.lod !== lod || built.representation !== representation) stale.push({ c, d, lod, version })
      if (built?.mesh) {
        chunks[built.lod] += 1
        triangles += built.triangles
      }
    }
    stale.sort((a, b) => a.d - b.d)
    for (const s of stale.slice(0, budget)) this.rebuild(arch, s.c, s.lod, s.version)
    return { chunks, triangles, pending: Math.max(0, stale.length - budget) }
  }

  private rebuild(arch: Architecture, c: number, lod: ArchLod, version: number) {
    const across = arch.chunksAcross
    const old = this.built.get(c)
    const representation = this.representation
    const { geometry, triangles } =
      representation === 'marching'
        ? buildChunkMarching(arch, c % across, Math.floor(c / across))
        : buildChunk(arch, c % across, Math.floor(c / across), lod)
    if (old?.mesh) {
      this.object.remove(old.mesh)
      old.mesh.geometry.dispose()
    }
    let mesh: Mesh | null = null
    if (geometry) {
      mesh = new Mesh(geometry, this.surface.material)
      if (this.surface.depthMaterial) mesh.customDepthMaterial = this.surface.depthMaterial
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.object.add(mesh)
    }
    this.built.set(c, { mesh, version, lod, representation, triangles })
  }

  clear() {
    for (const b of this.built.values()) {
      if (b.mesh) {
        this.object.remove(b.mesh)
        b.mesh.geometry.dispose()
      }
    }
    this.built.clear()
  }

  dispose() {
    this.clear()
  }
}

// ─── Vegetation ───────────────────────────────────────────────────────────

const PLANT_CAPACITY = 420
/** Drawn size of a plant relative to its Week 07 form: about a member's height, readable from the orbit. */
const PLANT_SCALE = 1.7

type PlantBatch = { mesh: InstancedMesh; plant: InstancedBufferAttribute; lean: InstancedBufferAttribute; triangles: number }

export class PlantInstances {
  readonly object = new Group()
  /** [form index][level] */
  private batches: PlantBatch[][]
  private forms: PlantForm[]

  constructor(forms: PlantForm[], surface: SurfaceMaterial) {
    this.forms = forms
    this.batches = forms.map((form) =>
      LEVELS.map((level) => {
        const geometry = form.lods[level].geometry.clone()
        const plant = new InstancedBufferAttribute(new Float32Array(PLANT_CAPACITY * 4), 4)
        const lean = new InstancedBufferAttribute(new Float32Array(PLANT_CAPACITY * 3), 3)
        plant.setUsage(DynamicDrawUsage)
        lean.setUsage(DynamicDrawUsage)
        geometry.setAttribute('iPlant', plant)
        geometry.setAttribute('iLean', lean)
        const mesh = new InstancedMesh(geometry, surface.material, PLANT_CAPACITY)
        mesh.instanceMatrix.setUsage(DynamicDrawUsage)
        if (surface.depthMaterial) mesh.customDepthMaterial = surface.depthMaterial
        mesh.castShadow = level !== 'skeleton'
        mesh.receiveShadow = true
        mesh.frustumCulled = false
        mesh.count = 0
        this.object.add(mesh)
        return { mesh, plant, lean, triangles: form.lods[level].triangles }
      }),
    )
  }

  /** `visible`: which strategies are drawn; hiding one changes nothing in the simulation. */
  update(
    rt: Runtime,
    camera: Vector3,
    override: number | null,
    visible: { exposure: boolean; shelter: boolean },
    lodScale = 1,
    shadows = true,
  ) {
    const near = LOD_DISTANCE.plant[0] * lodScale
    const far = LOD_DISTANCE.plant[1] * lodScale
    const counts = this.batches.map((levels) => levels.map(() => 0))
    const { plants } = rt.eco.veg
    const { statics, eco } = rt
    const shown: [number, number, number] = [0, 0, 0]
    let triangles = 0
    for (const p of plants) {
      if (!visible[p.kind]) continue
      const formIndex = this.forms.findIndex((f) => f.kind === p.kind && f.variant === p.variant)
      if (formIndex < 0) continue
      const y = statics.groundAt(p.x, p.z)
      const level = levelFor(Math.hypot(camera.x - p.x, camera.y - y, camera.z - p.z), [near, far], override)
      const n = counts[formIndex]![level]!
      if (n >= PLANT_CAPACITY) continue
      counts[formIndex]![level] = n + 1
      const batch = this.batches[formIndex]![level]!
      const dead = p.died >= 0
      const sink = dead ? smoothstep(0, 48, eco.clock - p.died) : 0
      quat.setFromAxisAngle(UP, p.turn)
      scl.setScalar(p.scale * PLANT_SCALE * (1 - sink * 0.5))
      pos.set(p.x, y - sink * 0.02, p.z)
      matrix.compose(pos, quat, scl)
      batch.mesh.setMatrixAt(n, matrix)
      batch.plant.setXYZW(n, p.growth, dead ? 0 : p.health, hash01(p.id), dead ? 0 : 1)
      const c = Math.cos(-p.turn)
      const s = Math.sin(-p.turn)
      const lx = (p.leanX * c - p.leanZ * s) / (p.scale * PLANT_SCALE)
      const lz = (p.leanX * s + p.leanZ * c) / (p.scale * PLANT_SCALE)
      batch.lean.setXYZ(n, lx, lz, p.flatten)
      shown[level] += 1
      triangles += batch.triangles
    }
    this.batches.forEach((levels, f) =>
      levels.forEach((batch, l) => {
        const count = counts[f]![l]!
        batch.mesh.count = count
        batch.mesh.castShadow = shadows && LEVELS[l] !== 'skeleton'
        upload(batch.mesh.instanceMatrix, count)
        upload(batch.plant, count)
        upload(batch.lean, count)
      }),
    )
    return { plants: shown, triangles }
  }

  dispose() {
    for (const levels of this.batches) {
      for (const batch of levels) {
        batch.mesh.geometry.dispose()
        batch.mesh.dispose()
      }
    }
  }
}

// ─── Creatures ────────────────────────────────────────────────────────────

/** Concatenates non-indexed copies of simple geometries (position + normal). */
function combine(parts: BufferGeometry[]): BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g))
  const size = flat.reduce((s, g) => s + g.getAttribute('position').count, 0)
  const position = new Float32Array(size * 3)
  const normal = new Float32Array(size * 3)
  let at = 0
  for (const g of flat) {
    position.set(g.getAttribute('position').array as Float32Array, at * 3)
    normal.set(g.getAttribute('normal').array as Float32Array, at * 3)
    at += g.getAttribute('position').count
  }
  const out = new BufferGeometry()
  out.setAttribute('position', new BufferAttribute(position, 3))
  out.setAttribute('normal', new BufferAttribute(normal, 3))
  for (const g of [...parts, ...flat]) if (g !== out) g.dispose()
  return out
}

const placed = (g: BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rz = 0) =>
  g.applyMatrix4(new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rz), new Vector3(sx, sy, sz)))

const strut = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, radius: number) => {
  const a = new Vector3(ax, ay, az)
  const d = new Vector3(bx - ax, by - ay, bz - az)
  const length = d.length()
  const g = new CylinderGeometry(radius, radius * 0.7, length, 5)
  return g.applyMatrix4(
    new Matrix4().compose(a.addScaledVector(d, 0.5), new Quaternion().setFromUnitVectors(UP, d.normalize()), new Vector3(1, 1, 1)),
  )
}

const triangles = (points: number[]) => {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(points, 3))
  g.computeVertexNormals()
  return g
}

/** A forked fish tail in the body's vertical plane, its root at x. */
const fishTail = (x: number, y: number, span: number) =>
  triangles([x, y, 0, x - span * 1.2, y + span, 0, x - span * 0.7, y, 0, x, y, 0, x - span * 0.7, y, 0, x - span * 1.2, y - span, 0])

/** Spikes along a line from (x0, y) to (x1, y), leaning back; down = a belly fringe. */
const fringe = (x0: number, x1: number, y: number, count: number, height: number, down = false) =>
  Array.from({ length: count }, (_, k) => {
    const x = x0 + ((x1 - x0) * k) / Math.max(1, count - 1)
    const h = height * (0.7 + 0.3 * Math.sin((k / Math.max(1, count - 1)) * Math.PI))
    return placed(new ConeGeometry(height * 0.2, h, 4), x, y + (down ? -h / 2 : h / 2), 0, 1, 1, 1, down ? Math.PI - 0.45 : 0.45)
  })

/**
 * Walker: a blocky, cat-like body on short legs, dorsal spines and a
 * segmented tail curled up behind. +x forward, feet at y = 0.
 */
function walkerBody(level: number): BufferGeometry {
  if (level === 2) return combine([placed(new BoxGeometry(0.2, 0.09, 0.09), 0, 0.075, 0), placed(new BoxGeometry(0.05, 0.08, 0.04), -0.12, 0.14, 0)])
  const segments = level === 0 ? 9 : 4
  const tail = Array.from({ length: segments }, (_, k) => {
    const t = k / segments
    const phi = -1.04 - t * 4.6
    const r = 0.075 * (1 - 0.45 * t)
    const size = 0.028 * (1 - 0.45 * t) * (level === 0 ? 1 : 1.4)
    return placed(new BoxGeometry(size, size, size), -0.125 + Math.cos(phi) * r, 0.16 + Math.sin(phi) * r, 0, 1, 1, 1, phi)
  })
  const legs = [-1, 1].flatMap((end) => [-1, 1].map((side) => placed(new BoxGeometry(0.028, 0.05, 0.028), end * 0.06, 0.025, side * 0.033)))
  const core = [
    placed(new BoxGeometry(0.17, 0.085, 0.095), 0, 0.085, 0),
    placed(new BoxGeometry(0.07, 0.1, 0.1), 0.055, 0.095, 0),
    placed(new BoxGeometry(0.065, 0.06, 0.07), 0.115, 0.13, 0, 1, 1, 1, -0.15),
    ...legs,
    ...tail,
  ]
  if (level === 1) return combine(core)
  return combine([
    ...core,
    placed(new ConeGeometry(0.012, 0.032, 4), 0.112, 0.175, 0.024),
    placed(new ConeGeometry(0.012, 0.032, 4), 0.112, 0.175, -0.024),
    ...fringe(-0.065, 0.045, 0.125, 5, 0.045),
  ])
}

/**
 * Wader: a fish body carried high on four stilt legs, spines at the head
 * and a forked tail. +x forward, feet at y = 0.
 */
const WADER_BODY = 0.24
function waderBody(level: number): BufferGeometry {
  const y = WADER_BODY
  if (level === 2) return combine([placed(new OctahedronGeometry(0.035, 0), 0, y, 0, 2.2, 0.8, 0.8), strut(0, y, 0, 0, 0, 0, 0.008)])
  const legs =
    level === 0
      ? [-1, 1].flatMap((end) => [-1, 1].map((side) => strut(end * 0.03, y - 0.015, side * 0.018, end * 0.05, 0, side * 0.045, 0.0045)))
      : [-1, 1].map((side) => strut(0, y - 0.015, side * 0.018, 0, 0, side * 0.045, 0.006))
  const core = [placed(new SphereGeometry(0.03, level === 0 ? 10 : 6, level === 0 ? 7 : 4), 0, y, 0, 2.5, 1, 0.8), fishTail(-0.07, y, 0.04), ...legs]
  if (level === 1) return combine(core)
  return combine([
    ...core,
    placed(new ConeGeometry(0.005, 0.045, 4), 0.07, y + 0.022, 0.008, 1, 1, 1, -0.9),
    placed(new ConeGeometry(0.005, 0.04, 4), 0.066, y + 0.028, -0.008, 1, 1, 1, -0.7),
    placed(new ConeGeometry(0.005, 0.035, 4), 0.06, y + 0.032, 0, 1, 1, 1, -0.5),
    ...fringe(-0.045, 0.02, y + 0.025, 4, 0.028),
  ])
}

/** Flyer: a fish body with a spiky fringe above and below; its fan wings are separate instances. +x forward. */
function flyerBody(level: number): BufferGeometry {
  if (level === 2) {
    const v = triangles([0.02, 0, 0, -0.05, 0.02, 0.14, -0.01, 0, 0, 0.02, 0, 0, -0.01, 0, 0, -0.05, 0.02, -0.14])
    return combine([placed(new OctahedronGeometry(0.03, 0), 0, 0, 0, 2.4, 0.8, 0.8), v])
  }
  const core = [placed(new SphereGeometry(0.03, level === 0 ? 10 : 6, level === 0 ? 7 : 4), 0, 0, 0, 2.6, 1, 0.8), fishTail(-0.072, 0, 0.045)]
  if (level === 1) return combine(core)
  return combine([...core, ...fringe(-0.04, 0.045, 0.022, 5, 0.035), ...fringe(-0.045, 0.03, -0.02, 4, 0.03, true)])
}

/** One fan wing hinged on the body's x axis, spreading +z: ribs of alternating length, a spiked edge. */
function fanWing(): BufferGeometry {
  const ribs = 9
  const hinge = [0.012, 0, 0.018]
  const points: number[][] = []
  for (let k = 0; k < ribs; k += 1) {
    const t = k / (ribs - 1)
    const a = 0.1 + t * 1.25
    const r = (k % 2 ? 0.115 : 0.165) * (1 - 0.25 * t)
    points.push([hinge[0]! - Math.sin(a) * r, 0, hinge[2]! + Math.cos(a) * r])
  }
  const out: number[] = []
  for (let k = 0; k < ribs - 1; k += 1) out.push(...hinge, ...points[k]!, ...points[k + 1]!)
  return triangles(out)
}

const COLORS = {
  walker: '#efe8d8',
  wader: '#d3dde3',
  flyer: '#e4ebf5',
  focus: '#ffb347',
  controlled: '#ff6a3d',
  resting: '#b9b2a4',
} as const
const CREATURE_CAPACITY = 32
/** Drawn size relative to the model, so creatures read at orbit distance without changing their behaviour. */
const DRAWN = { walker: 1.15, wader: 1.1, flyer: 1.2 } as const
/** Wings held slightly up in a dihedral, so flyers read even edge-on. */
const DIHEDRAL = -0.3

function instanced(geometry: BufferGeometry, material: Material, shadow: boolean, capacity = CREATURE_CAPACITY) {
  const mesh = new InstancedMesh(geometry, material, capacity)
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.castShadow = shadow
  mesh.frustumCulled = false
  mesh.count = 0
  mesh.setColorAt(0, tint.set('#ffffff'))
  return mesh
}

const ROLL_AXIS = new Vector3(1, 0, 0)
const roll = new Quaternion()
const hinge = new Quaternion()
const wingQuat = new Quaternion()

export class CreatureInstances {
  readonly object = new Group()
  private walkers: InstancedMesh[]
  private waders: InstancedMesh[]
  private flyers: InstancedMesh[]
  private wings: InstancedMesh
  private triangles: { walkers: number[]; waders: number[]; flyers: number[]; wing: number }

  constructor(material: Material) {
    this.walkers = [0, 1, 2].map((l) => instanced(walkerBody(l), material, l < 2))
    this.waders = [0, 1, 2].map((l) => instanced(waderBody(l), material, l < 2))
    this.flyers = [0, 1, 2].map((l) => instanced(flyerBody(l), material, l < 2))
    this.wings = instanced(fanWing(), material, true, CREATURE_CAPACITY * 2)
    const tris = (m: InstancedMesh) => m.geometry.getAttribute('position').count / 3
    this.triangles = { walkers: this.walkers.map(tris), waders: this.waders.map(tris), flyers: this.flyers.map(tris), wing: tris(this.wings) }
    for (const m of [...this.walkers, ...this.waders, ...this.flyers, this.wings]) this.object.add(m)
  }

  update(rt: Runtime, camera: Vector3, override: number | null, focusId: number | null) {
    const { eco } = rt
    const counts = { walkers: [0, 0, 0], waders: [0, 0, 0], flyers: [0, 0, 0], wings: 0 }
    const shown: [number, number, number] = [0, 0, 0]
    let triangles = 0
    const colour = (id: number, base: string) =>
      tint.set(id === rt.settings.controlled ? COLORS.controlled : id === focusId ? COLORS.focus : base)
    for (const c of eco.creatures.ground) {
      const level = levelFor(Math.hypot(camera.x - c.x, camera.y - c.y, camera.z - c.z), LOD_DISTANCE.creature, override)
      const wader = c.niche === 'wader'
      const meshes = wader ? this.waders : this.walkers
      const mesh = meshes[level]!
      const n = (wader ? counts.waders : counts.walkers)[level]!++
      const moving = c.state === 'travelling' || c.id === rt.settings.controlled
      const bob = moving ? Math.abs(Math.sin(rt.realTime * (wader ? 5 : 9) + c.id)) * (wader ? 0.012 : 0.008) : 0
      const size = wader ? DRAWN.wader : DRAWN.walker
      quat.setFromAxisAngle(UP, -c.heading)
      scl.set(size, size * (c.state === 'resting' && !wader ? 0.8 : 1), size)
      pos.set(c.x, c.y + bob, c.z)
      mesh.setMatrixAt(n, matrix.compose(pos, quat, scl))
      mesh.setColorAt(n, colour(c.id, c.state === 'resting' ? COLORS.resting : wader ? COLORS.wader : COLORS.walker))
      shown[level] += 1
      triangles += (wader ? this.triangles.waders : this.triangles.walkers)[level]!
    }
    for (const f of eco.creatures.flyers) {
      const level = levelFor(Math.hypot(camera.x - f.x, camera.y - f.y, camera.z - f.z), LOD_DISTANCE.creature, override)
      const mesh = this.flyers[level]!
      const n = counts.flyers[level]!++
      const heading = flyerHeading(f)
      const bank = f.state === 'soaring' ? 0.4 : 0
      quat.setFromAxisAngle(UP, -heading).multiply(roll.setFromAxisAngle(ROLL_AXIS, bank))
      pos.set(f.x, f.y + (f.state === 'perched' ? 0.03 : 0), f.z)
      scl.setScalar(DRAWN.flyer)
      mesh.setMatrixAt(n, matrix.compose(pos, quat, scl))
      mesh.setColorAt(n, colour(f.id, COLORS.flyer))
      shown[level] += 1
      triangles += this.triangles.flyers[level]!
      if (level < 2) {
        const flap =
          f.state === 'perched' ? 1.2 : f.state === 'soaring' ? DIHEDRAL * 0.5 + Math.sin(rt.realTime * 1.5 + f.id) * 0.08 : DIHEDRAL + Math.sin(rt.realTime * 9 + f.id * 2) * 0.55
        for (const side of [1, -1]) {
          const w = counts.wings++
          wingQuat.copy(quat).multiply(hinge.setFromAxisAngle(ROLL_AXIS, side * flap))
          scl.set(DRAWN.flyer, DRAWN.flyer, side * DRAWN.flyer)
          this.wings.setMatrixAt(w, matrix.compose(pos, wingQuat, scl))
          this.wings.setColorAt(w, colour(f.id, COLORS.flyer))
          triangles += this.triangles.wing
        }
      }
    }
    const finish = (mesh: InstancedMesh, count: number) => {
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    this.walkers.forEach((m, l) => finish(m, counts.walkers[l]!))
    this.waders.forEach((m, l) => finish(m, counts.waders[l]!))
    this.flyers.forEach((m, l) => finish(m, counts.flyers[l]!))
    finish(this.wings, counts.wings)
    return { creatures: shown, triangles }
  }

  dispose() {
    for (const m of [...this.walkers, ...this.waders, ...this.flyers, this.wings]) {
      m.geometry.dispose()
      m.dispose()
    }
  }
}

// ─── Rubble and falling fragments ─────────────────────────────────────────

const RUBBLE_CAPACITY = 5000

export class RubbleInstances {
  readonly mesh: InstancedMesh
  private signature = -1

  constructor(material: Material) {
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, RUBBLE_CAPACITY)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    this.mesh.frustumCulled = false
    this.mesh.count = 0
  }

  /** Rebuilds from the rubble field when it has changed noticeably. */
  update(rt: Runtime) {
    const { rubble } = rt.eco.fields
    let total = 0
    for (let i = 0; i < rubble.length; i += 1) total += rubble[i]!
    const signature = Math.round(total * 400)
    if (signature === this.signature) return
    this.signature = signature
    let n = 0
    for (let index = 0; index < GRID_SIZE * GRID_SIZE && n < RUBBLE_CAPACITY; index += 1) {
      const amount = rubble[index]!
      if (amount < 0.006 || rt.statics.water[index]) continue
      const pieces = Math.min(4, Math.ceil(amount / 0.025))
      const [cx, cz] = cellCenter(index)
      for (let k = 0; k < pieces && n < RUBBLE_CAPACITY; k += 1) {
        const seed = index * 7 + k
        const x = cx + (hash01(seed) - 0.5) * CELL
        const z = cz + (hash01(seed + 3.1) - 0.5) * CELL
        const size = Math.min(0.04, 0.01 + amount * 0.25) * (0.6 + 0.6 * hash01(seed + 5.3))
        quat.setFromAxisAngle(UP, hash01(seed + 1.7) * Math.PI)
        quat.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (hash01(seed + 2.9) - 0.5) * 0.8))
        pos.set(x, rt.statics.groundAt(x, z) + size * 0.3, z)
        scl.set(size, size * 0.7, size * (0.8 + 0.4 * hash01(seed + 8.1)))
        this.mesh.setMatrixAt(n, matrix.compose(pos, quat, scl))
        n += 1
      }
    }
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
  }

  reset() {
    this.signature = -1
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.dispose()
  }
}

const FRAGMENT_GRAVITY = 3.2

export class FragmentInstances {
  readonly mesh: InstancedMesh

  constructor(material: Material) {
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, 600)
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.castShadow = true
    this.mesh.frustumCulled = false
    this.mesh.count = 0
  }

  /** Animates falling blocks; reports first contact with water as ripples. */
  update(rt: Runtime) {
    let n = 0
    const keep: Fragment[] = []
    for (const f of rt.fragments) {
      const t = rt.motionTime - f.start
      const y = f.y - 0.5 * FRAGMENT_GRAVITY * t * t
      const landed = y <= f.ground
      if (landed && !f.landed) {
        f.landed = true
        if (f.water) rt.impacts.push({ x: f.x, z: f.z, strength: Math.min(1, f.size * 12) })
      }
      const landedFor = landed ? t - Math.sqrt((2 * Math.max(0, f.y - f.ground)) / FRAGMENT_GRAVITY) : 0
      if (landedFor > 0.5) continue
      keep.push(f)
      quat.setFromAxisAngle(UP, t * 3 + f.x * 10)
      pos.set(f.x, Math.max(y, f.ground - landedFor * 0.05), f.z)
      scl.setScalar(f.size * (landed ? 1 - landedFor * 1.6 : 1))
      this.mesh.setMatrixAt(n, matrix.compose(pos, quat, scl))
      n += 1
    }
    rt.fragments = keep
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.dispose()
  }
}

// ─── Overlays: what each way of seeing attends to ────────────────────────

class Lines {
  readonly object: LineSegments
  private position: Float32Array
  private color: Float32Array
  private n = 0
  private capacity: number

  constructor(capacity: number, opacity: number) {
    this.capacity = capacity
    this.position = new Float32Array(capacity * 6)
    this.color = new Float32Array(capacity * 6)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(this.position, 3).setUsage(DynamicDrawUsage))
    geometry.setAttribute('color', new BufferAttribute(this.color, 3).setUsage(DynamicDrawUsage))
    this.object = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false }))
    this.object.frustumCulled = false
  }

  begin() {
    this.n = 0
  }

  segment(ax: number, ay: number, az: number, bx: number, by: number, bz: number, c: Color, fade = 1) {
    if (this.n >= this.capacity) return
    const o = this.n * 6
    this.position.set([ax, ay, az, bx, by, bz], o)
    this.color.set([c.r * fade, c.g * fade, c.b * fade, c.r * fade, c.g * fade, c.b * fade], o)
    this.n += 1
  }

  end() {
    const geometry = this.object.geometry
    geometry.setDrawRange(0, this.n * 2)
    geometry.getAttribute('position').needsUpdate = true
    geometry.getAttribute('color').needsUpdate = true
  }

  dispose() {
    this.object.geometry.dispose()
    ;(this.object.material as Material).dispose()
  }
}

const INK = {
  candidateLow: new Color('#5a5650'),
  candidateHigh: new Color('#ffd27a'),
  chosen: new Color('#ffffff'),
  risk: new Color('#ff6a3d'),
  reach: new Color('#ffd27a'),
  spread: new Color('#f4efe2'),
  support: new Color('#9fb6e0'),
  focus: new Color('#ffb347'),
  route: new Color('#f1ece2'),
  trail: new Color('#7fc29b'),
  water: new Color('#6f8cff'),
  shelter: new Color('#7fc29b'),
  flight: new Color('#dfe7f2'),
  perch: new Color('#ffffff'),
  altitude: new Color('#8f9aaa'),
} as const

type GroundCreature = Runtime['eco']['creatures']['ground'][number]
type Flyer = Runtime['eco']['creatures']['flyers'][number]

/**
 * The marks each way of seeing attends to, kept sparse: ARCHITECTURE shows
 * every growth front, the move it is making and the next-best moves it
 * weighed (gold where the light is, red where the move would overhang too
 * far); CREATURE shows routes and goals (walkers, waders) or flight trails
 * and perches (flyers). Inside the lens — and for the focused entity — the
 * fine causes appear in any way: every candidate a front weighed, a
 * creature's whole trail, a flyer's height.
 */
export class Overlays {
  readonly object = new Group()
  private lines = new Lines(9000, 0.85)
  private boxes: InstancedMesh
  private heads: InstancedMesh
  private nBoxes = 0
  private nHeads = 0
  private beaconShown = true

  constructor(markerMaterial: Material) {
    this.boxes = new InstancedMesh(new BoxGeometry(1, 1, 1), markerMaterial, 260)
    this.boxes.frustumCulled = false
    this.boxes.count = 0
    this.boxes.setColorAt(0, tint.set('#ffffff'))
    this.heads = new InstancedMesh(new OctahedronGeometry(1, 0), markerMaterial, 96)
    this.heads.frustumCulled = false
    this.heads.count = 0
    this.heads.setColorAt(0, tint.set('#ffffff'))
    this.object.add(this.lines.object, this.boxes, this.heads)
  }

  private head(x: number, y: number, z: number, size: number, color: Color) {
    if (this.nHeads >= 96) return
    quat.identity()
    pos.set(x, y, z)
    scl.setScalar(size)
    this.heads.setMatrixAt(this.nHeads, matrix.compose(pos, quat, scl))
    this.heads.setColorAt(this.nHeads, color)
    this.nHeads += 1
  }

  private box(x: number, y: number, z: number, size: number, color: Color) {
    if (this.nBoxes >= 260) return
    quat.identity()
    pos.set(x, y, z)
    scl.setScalar(size)
    this.boxes.setMatrixAt(this.nBoxes, matrix.compose(pos, quat, scl))
    this.boxes.setColorAt(this.nBoxes, color)
    this.nBoxes += 1
  }

  private tip(arch: Architecture, tip: Tip, detail: boolean, focused: boolean) {
    const [cx, cy, cz] = tipCenter(arch, tip)
    const ink = focused ? INK.focus : tip.role === 'reach' ? INK.reach : tip.role === 'spread' ? INK.spread : INK.support
    const chosen = tip.candidates.find((c) => c.chosen)
    tint.copy(ink)
    if (!focused && chosen) tint.lerp(INK.risk, smoothstep(0.35, 0.8, chosen.risk))
    this.head(cx, cy + MEMBER * 0.9, cz, focused ? 0.07 : 0.045, tint)
    if (!detail) {
      if (chosen) this.lines.segment(cx, cy, cz, chosen.x, chosen.y, chosen.z, ink, 0.9)
      const others = tip.candidates.filter((c) => !c.chosen).sort((a, b) => b.score - a.score).slice(0, 2)
      for (const c of others) {
        tint.copy(INK.candidateLow).lerp(c.risk > 0.45 ? INK.risk : INK.candidateHigh, 0.5)
        this.lines.segment(cx, cy, cz, c.x, c.y, c.z, tint, 0.45)
      }
      return
    }
    const best = tip.candidates.reduce((m, c) => Math.max(m, c.score), 0.001)
    const ranked = [...tip.candidates].sort((a, b) => b.score - a.score)
    ranked.forEach((c, rank) => {
      const share = Math.max(0, c.score / best)
      tint.copy(INK.candidateLow).lerp(INK.candidateHigh, share)
      if (c.chosen) tint.copy(INK.chosen)
      else if (c.risk > 0.45) tint.lerp(INK.risk, 0.6)
      this.lines.segment(cx, cy, cz, c.x, c.y, c.z, tint, c.chosen ? 1 : 0.35 + 0.5 * share)
      if (c.chosen || rank < 3) this.box(c.x, c.y, c.z, MEMBER * (0.15 + 0.3 * share), tint)
    })
  }

  /** A plumb line and head over the focused creature, so it can be found from afar. */
  private beacon(x: number, y: number, z: number) {
    if (!this.beaconShown) return
    this.lines.segment(x, y + 0.3, z, x, y + 1.1, z, INK.focus, 0.9)
    this.head(x, y + 1.18, z, 0.07, INK.focus)
  }

  private walker(rt: Runtime, c: GroundCreature, detail: boolean, focused: boolean) {
    const ground = (x: number, z: number) => rt.statics.groundAt(x, z) + 0.03
    const L = this.lines
    if (focused && c.id !== rt.settings.controlled) this.beacon(c.x, c.y, c.z)
    if (detail) {
      const t = c.trail
      for (let k = 2; k < t.length; k += 2) {
        L.segment(t[k - 2]!, ground(t[k - 2]!, t[k - 1]!), t[k - 1]!, t[k]!, ground(t[k]!, t[k + 1]!), t[k + 1]!, INK.trail, (k / t.length) * 0.8)
      }
    }
    if (c.state !== 'travelling') return
    const r = c.route
    const ink = c.reason === 'water' ? INK.water : c.reason === 'shelter' ? INK.shelter : INK.route
    for (let k = Math.max(2, c.routeAt * 2); k < r.length; k += 2) {
      L.segment(r[k - 2]!, ground(r[k - 2]!, r[k - 1]!), r[k - 1]!, r[k]!, ground(r[k]!, r[k + 1]!), r[k + 1]!, ink, detail ? 0.95 : 0.45)
    }
    this.head(c.goalX, ground(c.goalX, c.goalZ) + 0.04, c.goalZ, focused ? 0.06 : detail ? 0.045 : 0.03, ink)
  }

  private flyer(rt: Runtime, f: Flyer, detail: boolean, focused: boolean) {
    const L = this.lines
    if (focused && f.id !== rt.settings.controlled) this.beacon(f.x, f.y, f.z)
    const t = f.trail
    for (let k = 3; k < t.length; k += 3) {
      L.segment(t[k - 3]!, t[k - 2]!, t[k - 1]!, t[k]!, t[k + 1]!, t[k + 2]!, INK.flight, (k / t.length) * (detail ? 1 : 0.45))
    }
    if (detail && f.state !== 'perched') L.segment(f.x, f.y, f.z, f.x, rt.statics.groundAt(f.x, f.z), f.z, INK.altitude, 0.6)
  }

  update(rt: Runtime, way: WayOfSeeing, creatureView: CreatureView, focusId: number | null, visible: boolean, beacon = true) {
    this.beaconShown = beacon
    this.lines.begin()
    this.nBoxes = 0
    this.nHeads = 0
    const lens: Lens | null = rt.settings.lens
    const inLens = (x: number, z: number) => lens !== null && Math.hypot(x - lens.x, z - lens.z) < lens.radius
    if (visible) {
      const { arch } = rt.eco
      const { ground, flyers, perches } = rt.eco.creatures
      const archWay = way === 'architecture'
      const groundNiche = way !== 'creature' ? null : creatureView === 'ground' ? 'walker' : creatureView === 'wading' ? 'wader' : null
      const flyingWay = way === 'creature' && creatureView === 'flying'
      for (const tip of arch.tips) {
        const [cx, , cz] = tipCenter(arch, tip)
        const focused = archWay && tip.id === focusId
        const detail = focused || inLens(cx, cz)
        if (archWay || detail) this.tip(arch, tip, detail, focused)
      }
      for (const c of ground) {
        const mine = c.niche === groundNiche
        const focused = mine && c.id === focusId
        const detail = focused || inLens(c.x, c.z)
        if (mine || detail) this.walker(rt, c, detail, focused)
      }
      for (const f of flyers) {
        const focused = flyingWay && f.id === focusId
        const detail = focused || inLens(f.x, f.z)
        if (flyingWay || detail) this.flyer(rt, f, detail, focused)
      }
      if (flyingWay) {
        for (const p of perches) {
          const h = 0.08 + 0.2 * p.score
          this.lines.segment(p.x, p.y, p.z, p.x, p.y + h, p.z, INK.perch, 0.7)
          this.lines.segment(p.x - 0.04, p.y + h, p.z, p.x + 0.04, p.y + h, p.z, INK.perch, 0.7)
        }
      }
    }
    this.lines.end()
    for (const [mesh, count] of [
      [this.boxes, this.nBoxes],
      [this.heads, this.nHeads],
    ] as const) {
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  dispose() {
    this.lines.dispose()
    this.boxes.geometry.dispose()
    this.heads.geometry.dispose()
    this.boxes.dispose()
    this.heads.dispose()
  }
}

// ─── Rain ─────────────────────────────────────────────────────────────────

/** Enough drops that rain over the whole terrain square stays dense. */
const DROPS = 24000
/** Drops start above the highest ridges so they reach every part of the ground. */
const RAIN_TOP = 7.6
const RAIN_SPREAD = 1.4

/** Rain falls over a disc around the island with a ragged edge, so no emitter box shows from afar. */
const RAIN_RADIUS = GRID_EXTENT * 1.08
const RAIN_COLOR = [0.78, 0.82, 0.89] as const

/** Ragged outline of the rain: radius factor by angle. */
const rainEdge = (angle: number) => 0.8 + 0.2 * (0.5 + 0.5 * Math.sin(3 * angle + 1.3) * Math.cos(5 * angle - 0.4))

export class RainField {
  readonly object: LineSegments
  /** Per drop: x, y, z, fall speed, the outline radius where it fell. */
  private drops = new Float32Array(DROPS * 5)

  constructor() {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(DROPS * 6), 3).setUsage(DynamicDrawUsage))
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(DROPS * 8), 4).setUsage(DynamicDrawUsage))
    this.object = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false }))
    this.object.frustumCulled = false
    for (let k = 0; k < DROPS; k += 1) this.respawn(k, -1 + Math.random() * (RAIN_TOP + RAIN_SPREAD + 1))
  }

  /** Anywhere within the ragged disc over the island, denser toward the middle. */
  private respawn(k: number, height: number) {
    const angle = Math.random() * Math.PI * 2
    const edge = RAIN_RADIUS * rainEdge(angle)
    const r = edge * Math.sqrt(Math.random())
    const d = this.drops
    const o = k * 5
    d[o] = Math.cos(angle) * r
    d[o + 1] = height
    d[o + 2] = Math.sin(angle) * r
    d[o + 3] = 0.8 + Math.random() * 0.4
    d[o + 4] = edge
  }

  private drawn = -1

  /**
   * Falls drops in real seconds, carried by the prevailing wind; drops hitting open water become ripples.
   * `share` is the fraction of drops drawn (rendering quality).
   */
  update(rt: Runtime, seconds: number, share = 1) {
    const rain = rt.eco.weather.rain
    const active = Math.floor(DROPS * rain * share)
    this.object.visible = active > 0
    ;(this.object.material as LineBasicMaterial).opacity = 0.2 + 0.25 * rain
    // Paused with the same drops: the buffers already hold this frame.
    if (!active || (seconds === 0 && active === this.drawn)) return
    this.drawn = active
    const position = this.object.geometry.getAttribute('position') as BufferAttribute
    const color = this.object.geometry.getAttribute('color') as BufferAttribute
    const out = position.array as Float32Array
    const tint = color.array as Float32Array
    const { statics } = rt
    const blow = windSpeed(rt.eco.weather) * 1.6
    const wx = Math.cos(rt.eco.weather.windDir ?? 0) * blow
    const wz = Math.sin(rt.eco.weather.windDir ?? 0) * blow
    const [cr, cg, cb] = RAIN_COLOR
    const d = this.drops
    const waterOffset = rt.eco.fields.waterOffset
    for (let k = 0; k < active; k += 1) {
      const o = k * 5
      d[o + 1]! -= seconds * 4.6 * d[o + 3]!
      d[o]! += seconds * wx
      d[o + 2]! += seconds * wz
      let x = d[o]!
      let z = d[o + 2]!
      let reach = Math.hypot(x, z) / d[o + 4]!
      const cell = statics.cellAt(x, z)
      const inside = cell >= 0 && statics.inside[cell]
      const floor = inside ? (statics.water[cell] ? statics.waterLevel[cell]! + waterOffset : statics.groundAt(x, z)) : statics.cloud
      if (d[o + 1]! < floor || reach > 1.05) {
        if (inside && statics.water[cell] && Math.random() < 0.004) rt.impacts.push({ x, z, strength: 0.25 })
        this.respawn(k, RAIN_TOP + Math.random() * RAIN_SPREAD)
        x = d[o]!
        z = d[o + 2]!
        reach = Math.hypot(x, z) / d[o + 4]!
      }
      const y = d[o + 1]!
      const p = k * 6
      out[p] = x
      out[p + 1] = y
      out[p + 2] = z
      out[p + 3] = x + 0.014 - wx * 0.024
      out[p + 4] = y + 0.11
      out[p + 5] = z + 0.006 - wz * 0.024
      // Soft boundary: drops thin out toward the ragged edge and fade in as they fall from the top.
      const fade = (1 - smoothstep(0.55, 1.0, reach)) * (1 - smoothstep(RAIN_TOP - 1.6, RAIN_TOP + RAIN_SPREAD, y))
      const t = k * 8
      tint[t] = cr
      tint[t + 1] = cg
      tint[t + 2] = cb
      tint[t + 3] = fade
      tint[t + 4] = cr
      tint[t + 5] = cg
      tint[t + 6] = cb
      tint[t + 7] = fade * 0.35
    }
    this.object.geometry.setDrawRange(0, active * 2)
    upload(position, active * 2)
    upload(color, active * 2)
  }

  dispose() {
    this.object.geometry.dispose()
    ;(this.object.material as Material).dispose()
  }
}

// ─── Wind ─────────────────────────────────────────────────────────────────

const TRACERS = 900
/** Points along each tracer's streak, traced back upwind through the field. */
const TRAIL = 10
/** World units a tracer travels per real second per unit of wind. */
const TRACER_PACE = 1.5

/**
 * Tracers carried by the wind field (wind.ts): each head moves with the
 * local wind and draws its streak back along the field, so the lines bend
 * where valleys channel the flow, thin out in the lee and stretch over
 * ridges. Shown in full with Show Wind Field; a lighter set during a wind spell.
 */
export class WindTracers {
  readonly object: LineSegments
  private x = new Float32Array(TRACERS)
  private z = new Float32Array(TRACERS)
  private lift = new Float32Array(TRACERS)
  private age = new Float32Array(TRACERS)
  private life = new Float32Array(TRACERS)
  private surface: Float32Array | null = null
  private seeded = false
  private drawn = -1
  private amount = 0

  constructor() {
    const segments = TRACERS * (TRAIL - 1)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(segments * 6), 3).setUsage(DynamicDrawUsage))
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(segments * 8), 4).setUsage(DynamicDrawUsage))
    this.object = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }))
    this.object.frustumCulled = false
    this.object.renderOrder = 3
  }

  /** Ground or water surface per grid cell, so tracers ride over lakes rather than under them. */
  private surfaceOf(statics: Statics) {
    if (!this.surface) {
      const heights = statics.ground.heights
      this.surface = new Float32Array(heights.length)
      for (let i = 0; i < heights.length; i += 1) this.surface[i] = statics.water[i] ? Math.max(heights[i]!, statics.waterLevel[i]!) : heights[i]!
    }
    return this.surface
  }

  private respawn(statics: Statics, k: number, age = 0) {
    for (let tries = 0; tries < 16; tries += 1) {
      const x = (Math.random() * 2 - 1) * GRID_EXTENT * 0.92
      const z = (Math.random() * 2 - 1) * GRID_EXTENT * 0.92
      const cell = statics.cellAt(x, z)
      if (cell < 0 || !statics.inside[cell]) continue
      this.x[k] = x
      this.z[k] = z
      break
    }
    this.lift[k] = 0.15 + Math.random() * 0.55
    this.life[k] = 2.5 + Math.random() * 3
    this.age[k] = age
  }

  /**
   * Moves the tracers by `seconds` (0 while paused) and redraws them. Only
   * drawn with Show Wind Field on and while the wind blows.
   */
  update(rt: Runtime, seconds: number, show: boolean, share = 1) {
    const { statics, eco } = rt
    const weather = eco.weather
    const speed = windSpeed(weather)
    const amount = show ? smoothstep(0.02, 0.15, speed) : 0
    this.object.visible = amount > 0.01
    if (!this.object.visible) {
      this.drawn = -1
      return
    }
    if (!this.seeded) {
      for (let k = 0; k < TRACERS; k += 1) this.respawn(statics, k, Math.random() * 4)
      this.seeded = true
    }
    const count = Math.round(TRACERS * share)
    // Paused with nothing changed: the buffers already hold this frame.
    if (seconds === 0 && count === this.drawn && amount === this.amount) return
    this.drawn = count
    this.amount = amount
    const field: WindField = windField(statics, weather, eco.arch, eco.clock)
    const surface = this.surfaceOf(statics)
    const position = this.object.geometry.getAttribute('position') as BufferAttribute
    const color = this.object.geometry.getAttribute('color') as BufferAttribute
    const p = position.array as Float32Array
    const c = color.array as Float32Array
    const step = 0.04 + 0.12 * speed
    let n = 0
    for (let k = 0; k < count; k += 1) {
      if (seconds > 0) {
        const [vx, vz] = fieldAt(field, this.x[k]!, this.z[k]!)
        this.x[k]! += vx * speed * seconds * TRACER_PACE
        this.z[k]! += vz * speed * seconds * TRACER_PACE
        this.age[k]! += seconds
        const cell = statics.cellAt(this.x[k]!, this.z[k]!)
        if (this.age[k]! > this.life[k]! || cell < 0 || !statics.inside[cell]) this.respawn(statics, k)
      }
      const t = this.age[k]! / this.life[k]!
      const fade = amount * smoothstep(0, 0.15, t) * (1 - smoothstep(0.75, 1, t))
      let px = this.x[k]!
      let pz = this.z[k]!
      let py = sampleGrid(surface, px, pz) + this.lift[k]!
      for (let s = 0; s < TRAIL - 1; s += 1) {
        const [vx, vz] = fieldAt(field, px, pz)
        const length = Math.hypot(vx, vz) || 1
        const reach = step * Math.min(2, length)
        const nx = px - (vx / length) * reach
        const nz = pz - (vz / length) * reach
        const next = statics.cellAt(nx, nz)
        if (next < 0 || !statics.inside[next]) break
        const ny = sampleGrid(surface, nx, nz) + this.lift[k]!
        const a0 = fade * (1 - s / (TRAIL - 1))
        const a1 = fade * (1 - (s + 1) / (TRAIL - 1))
        const bright = 0.75 + 0.25 * Math.min(1, length / 1.5)
        const o = n * 6
        p[o] = px
        p[o + 1] = py
        p[o + 2] = pz
        p[o + 3] = nx
        p[o + 4] = ny
        p[o + 5] = nz
        const q = n * 8
        c[q] = bright
        c[q + 1] = bright
        c[q + 2] = bright * 1.04
        c[q + 3] = a0
        c[q + 4] = bright
        c[q + 5] = bright
        c[q + 6] = bright * 1.04
        c[q + 7] = a1
        n += 1
        px = nx
        pz = nz
        py = ny
      }
    }
    this.object.geometry.setDrawRange(0, n * 2)
    upload(position, n * 2)
    upload(color, n * 2)
  }

  dispose() {
    this.object.geometry.dispose()
    ;(this.object.material as Material).dispose()
  }
}
