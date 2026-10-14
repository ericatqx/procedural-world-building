import { BufferGeometry, Float32BufferAttribute, OctahedronGeometry, Vector3 } from 'three'
import { buildTraceLods, type LodLevel } from '../weeks/week07/traceMesh.ts'
import type { TraceBud, TraceModel, TraceSegment } from '../weeks/week07/turtle.ts'
import { mulberry32 } from '../weeks/week06/distribution.ts'

/**
 * Shadow Ecology 0.2 — plant morphology. Each strategy grows by branching
 * with an environmental response, using Week 07's trace model:
 *
 *   exposure  apical: a leader climbs toward the light, short laterals,
 *             tall and upright (phototropism)
 *   shelter   plagiotropic: a few long shoots arch out toward the
 *             horizontal, held just above the ground, with sparse laterals
 *
 * A few variants per strategy are grown once; Week 07's `buildTraceLods`
 * draws each in three representations (full, reduced, skeleton) from the
 * same internodes, and the far level gains foliage clumps so a distant
 * stand still reads as mass. Per plant, the vertex shader reveals the form
 * along its arrival as it grows, leans it toward its light and flattens it
 * in deep shelter: one form, many responses.
 */
export type PlantKind = 'exposure' | 'shelter'

export type PlantForm = {
  kind: PlantKind
  variant: number
  /** Per level: geometry with aArrival normalised to 0…1 (the growth front). */
  lods: Record<LodLevel, { geometry: BufferGeometry; triangles: number }>
  height: number
}

type Grammar = {
  segments: [number, number]
  length: number
  shrink: number
  branchChance: number
  branchAngle: number
  maxOrder: number
  /** Pull toward up (exposure) or toward the horizontal (shelter). */
  tropism: number
  horizontal: boolean
  wander: number
  start: number
}

const GRAMMARS: Record<PlantKind, Grammar> = {
  exposure: {
    segments: [9, 12],
    length: 0.06,
    shrink: 0.68,
    branchChance: 0.5,
    branchAngle: 40,
    maxOrder: 2,
    tropism: 0.28,
    horizontal: false,
    wander: 0.18,
    start: 88,
  },
  shelter: {
    segments: [7, 9],
    length: 0.055,
    shrink: 0.66,
    branchChance: 0.38,
    branchAngle: 48,
    maxOrder: 2,
    tropism: 0.3,
    horizontal: true,
    wander: 0.16,
    start: 34,
  },
}

export const VARIANTS = 3
const SHELTER_MARK = { exposure: 0.15, shelter: 0.85 } as const
/** Buds carry shelter + 2 so the material can tell foliage from stem. */
const BUD_MARK = 2
const ROLL = (137.5 * Math.PI) / 180

function rotateAround(v: Vector3, axis: Vector3, angle: number) {
  return v.clone().applyAxisAngle(axis, angle)
}

function growModel(kind: PlantKind, seed: number): TraceModel {
  const g = GRAMMARS[kind]
  const rand = mulberry32(seed)
  const segments: TraceSegment[] = []
  const buds: TraceBud[] = []
  const shelter = SHELTER_MARK[kind]
  let branches = 0

  const axis = (start: Vector3, heading: Vector3, order: number, arrival: number, parent: number, roll: number) => {
    branches += 1
    const [lo, hi] = g.segments
    const count = Math.max(2, Math.round((lo + rand() * (hi - lo)) * Math.pow(g.shrink, order)))
    let position = start.clone()
    let h = heading.clone().normalize()
    let at = arrival
    let from = parent
    let r = roll
    for (let s = 0; s < count; s += 1) {
      // Shelter shoots arch out low, held a little above the ground rather than lying on it.
      const target = g.horizontal
        ? new Vector3(h.x, 0.22, h.z).normalize()
        : new Vector3(0, 1, 0)
      const bias = target.clone().sub(h).multiplyScalar(g.tropism)
      h.add(bias)
      h.add(new Vector3(rand() - 0.5, (rand() - 0.5) * 0.4, rand() - 0.5).multiplyScalar(g.wander))
      h.normalize()
      if (g.horizontal && position.y < 0.004 && h.y < 0) h.y = Math.abs(h.y)
      const length = g.length * Math.pow(g.shrink, order) * (0.75 + 0.5 * rand())
      const end = position.clone().addScaledVector(h, length)
      segments.push({
        start: position.clone(),
        end: end.clone(),
        parent: from,
        order,
        arrival0: at,
        arrival1: at + length,
        shelter,
        bias,
        tips: 0,
      })
      const index = segments.length - 1
      at += length
      if (order < g.maxOrder && s > 0 && rand() < g.branchChance) {
        r += ROLL
        const side = new Vector3(Math.cos(r), 0, Math.sin(r))
        const pivot = new Vector3().crossVectors(h, side).normalize()
        const childHeading = rotateAround(h, pivot.lengthSq() > 0 ? pivot : new Vector3(1, 0, 0), (g.branchAngle * Math.PI) / 180)
        axis(end, childHeading, order + 1, at, index, r)
      }
      position = end
      from = index
    }
    buds.push({ position, arrival: at, parent: from, shelter: shelter + BUD_MARK })
  }

  const base = new Vector3(0, 0, 0)
  const startTilt = ((90 - g.start) * Math.PI) / 180
  const stems = kind === 'shelter' ? 3 : 1
  for (let n = 0; n < stems; n += 1) {
    const a = (n / stems) * Math.PI * 2 + rand()
    const heading = new Vector3(Math.cos(a) * Math.sin(startTilt), Math.cos(startTilt), Math.sin(a) * Math.sin(startTilt))
    axis(base, heading, 0, 0, -1, a)
  }

  // Pipe model: each internode carries the tips above it.
  const tips = new Array<number>(segments.length).fill(0)
  const children = new Array<number>(segments.length).fill(0)
  segments.forEach((s) => {
    if (s.parent >= 0) children[s.parent]! += 1
  })
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (children[i] === 0) tips[i] = 1
    const p = segments[i]!.parent
    if (p >= 0) tips[p]! += tips[i]!
  }
  segments.forEach((s, i) => {
    s.tips = tips[i]!
  })
  const maxArrival = Math.max(...segments.map((s) => s.arrival1), ...buds.map((b) => b.arrival))
  return {
    segments,
    buds,
    branches,
    symbols: segments.length,
    capped: false,
    fired: {},
    maxArrival,
    maxOrder: Math.max(...segments.map((s) => s.order)),
    sheltered: kind === 'shelter' ? 1 : 0,
  }
}

/** Low-poly foliage clumps at every `every`-th bud. */
function clumps(model: TraceModel, radius: number, every: number): BufferGeometry {
  const unit = new OctahedronGeometry(1, 0)
  const shape = unit.getAttribute('position')
  const position: number[] = []
  const normal: number[] = []
  const center: number[] = []
  const arrival: number[] = []
  const shelter: number[] = []
  const n = new Vector3()
  model.buds.forEach((bud, i) => {
    if (i % every) return
    for (let k = 0; k < shape.count; k += 1) {
      n.fromBufferAttribute(shape, k).normalize()
      position.push(bud.position.x + n.x * radius, bud.position.y + n.y * radius * 0.7, bud.position.z + n.z * radius)
      normal.push(n.x, n.y, n.z)
      center.push(bud.position.x, bud.position.y, bud.position.z)
      arrival.push(bud.arrival)
      shelter.push(bud.shelter)
    }
  })
  unit.dispose()
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(position, 3))
  g.setAttribute('normal', new Float32BufferAttribute(normal, 3))
  g.setAttribute('aCenter', new Float32BufferAttribute(center, 3))
  g.setAttribute('aArrival', new Float32BufferAttribute(arrival, 1))
  g.setAttribute('aShelter', new Float32BufferAttribute(shelter, 1))
  return g
}

/** Concatenates geometries with the trace attributes into one indexed geometry. */
function merge(parts: BufferGeometry[]): BufferGeometry {
  const names = ['position', 'normal', 'aCenter', 'aArrival', 'aShelter'] as const
  const data: Record<string, number[]> = Object.fromEntries(names.map((name) => [name, []]))
  const index: number[] = []
  let offset = 0
  for (const part of parts) {
    const count = part.getAttribute('position').count
    for (const name of names) {
      const attribute = part.getAttribute(name)
      data[name]!.push(...(attribute.array as Float32Array))
    }
    const source = part.getIndex()
    if (source) {
      for (let i = 0; i < source.count; i += 1) index.push(source.getX(i) + offset)
    } else {
      for (let i = 0; i < count; i += 1) index.push(i + offset)
    }
    offset += count
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(data.position!, 3))
  g.setAttribute('normal', new Float32BufferAttribute(data.normal!, 3))
  g.setAttribute('aCenter', new Float32BufferAttribute(data.aCenter!, 3))
  g.setAttribute('aArrival', new Float32BufferAttribute(data.aArrival!, 1))
  g.setAttribute('aShelter', new Float32BufferAttribute(data.aShelter!, 1))
  g.setIndex(index)
  g.computeBoundingSphere()
  return g
}

function normaliseArrival(geometry: BufferGeometry, maxArrival: number) {
  const arrival = geometry.getAttribute('aArrival')
  for (let i = 0; i < arrival.count; i += 1) arrival.setX(i, arrival.getX(i) / maxArrival)
  arrival.needsUpdate = true
}

export function createPlantForms(): PlantForm[] {
  const forms: PlantForm[] = []
  for (const kind of ['exposure', 'shelter'] as const) {
    for (let variant = 0; variant < VARIANTS; variant += 1) {
      const model = growModel(kind, 101 + variant * 37 + (kind === 'shelter' ? 500 : 0))
      const lods = buildTraceLods(model)
      const leaf = kind === 'shelter' ? 0.022 : 0.028
      // Shelter keeps foliage to every other tip so its branches read rather than a heap of leaves.
      const sparse = kind === 'shelter' ? 2 : 1
      const withFoliage = (tubes: BufferGeometry, radius: number, every: number) => {
        const merged = merge([tubes, clumps(model, radius, every)])
        tubes.dispose()
        return { geometry: merged, triangles: (merged.getIndex()?.count ?? 0) / 3 }
      }
      const levels = {
        full: withFoliage(lods.full.tubes, leaf * 0.75, sparse),
        reduced: withFoliage(lods.reduced.tubes, leaf, 2 * sparse),
        skeleton: withFoliage(lods.skeleton.tubes, leaf * 1.2, 2 * sparse),
      }
      for (const level of Object.values(levels)) normaliseArrival(level.geometry, model.maxArrival)
      const height = Math.max(...model.segments.map((s) => s.end.y), ...model.buds.map((b) => b.position.y))
      forms.push({ kind, variant, lods: levels, height })
    }
  }
  return forms
}

export function disposePlantForms(forms: PlantForm[]) {
  for (const form of forms) {
    for (const level of Object.values(form.lods)) level.geometry.dispose()
  }
}
