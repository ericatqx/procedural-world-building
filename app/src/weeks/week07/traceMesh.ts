import { BufferGeometry, Float32BufferAttribute, IcosahedronGeometry, Vector3 } from 'three'
import type { TraceModel } from './turtle.ts'

/**
 * Week 07 Trace Growth — one grown organism, three render representations.
 * The turtle's segments are never regrown for detail: each level is a
 * subset of the same internodes, drawn as tubes with fewer sides. Every
 * vertex carries the centre of its ring and the path length at which the
 * growth front reaches it, so the material reveals any level of the
 * organism the same way while it grows.
 *
 * Which internodes a level keeps follows the branching structure, by
 * Horton–Strahler order: a twig is order 1, and a limb rises an order where
 * two limbs of equal order meet, so order measures how much branching a limb
 * carries. A kept limb always continues along its leader (the child
 * carrying the most tips) to its final tip, so the organism's reach — where
 * it leaned, how far it ran — survives at every level.
 *
 *   LOD 0 Full      every internode, 8-sided tubes, a bud on every apex
 *   LOD 1 Reduced   limbs of order ≥ 2 and their leaders: major limbs and
 *                   selected secondary branches; 5 sides, near-straight runs
 *                   merged, low-poly buds on the tips it keeps
 *   LOD 2 Skeleton  only the dominant limbs (the top orders) and their
 *                   leaders; 4 sides, straighter runs merged, no buds
 */

export type LodLevel = 'full' | 'reduced' | 'skeleton'
export const LOD_LEVELS: readonly LodLevel[] = ['full', 'reduced', 'skeleton']
/** Auto picks the level by camera distance; Manual holds the one chosen. */
export type LodMode = 'auto' | 'manual'

type LodSpec = {
  index: number
  label: string
  radial: number
  /** Runs of single-child internodes turning less than this (degrees) become one segment. */
  mergeAngle: number
  /** Icosahedron detail for buds, or null for none. */
  budDetail: number | null
  /** Lowest Strahler order drawn, counted down from the organism's highest; null draws every internode. */
  belowTop: number | null
  /** Lowest Strahler order drawn whatever the organism's highest. */
  minOrder: number
}

export const LOD_SPECS: Record<LodLevel, LodSpec> = {
  full: { index: 0, label: 'Full', radial: 8, mergeAngle: 0, budDetail: 1, belowTop: null, minOrder: 1 },
  reduced: { index: 1, label: 'Reduced', radial: 5, mergeAngle: 12, budDetail: 0, belowTop: null, minOrder: 2 },
  skeleton: { index: 2, label: 'Skeleton', radial: 4, mergeAngle: 25, budDetail: null, belowTop: 3, minOrder: 3 },
}

/**
 * Auto: camera distance to the orbit target (world units) beyond which each
 * level takes over. The opening view sits at about 4.4, so it starts Full;
 * a level holds for `hysteresis` past its threshold so it never flickers.
 */
export const AUTO_LOD = { reduced: 6, skeleton: 9, hysteresis: 0.3 } as const

export function levelForDistance(distance: number, current: LodLevel): LodLevel {
  const h = AUTO_LOD.hysteresis
  const toReduced = current === 'full' ? AUTO_LOD.reduced + h : AUTO_LOD.reduced - h
  const toSkeleton = current === 'skeleton' ? AUTO_LOD.skeleton - h : AUTO_LOD.skeleton + h
  return distance >= toSkeleton ? 'skeleton' : distance >= toReduced ? 'reduced' : 'full'
}

export type LodStats = { triangles: number; internodes: number; pieces: number }

/** Pipe model: radius = tip radius · (tips carried)^exponent. */
const TIP_RADIUS = 0.0036
const PIPE_EXPONENT = 0.3
/** A terminal internode closes to this share of its radius. */
const TIP_CLOSE = 0.3
/** Each tube reaches back this share of its radius, so bends leave no gap. */
const OVERLAP = 0.9
const BUD_RADIUS = 0.0065

export const radiusFor = (tips: number) => TIP_RADIUS * Math.pow(tips, PIPE_EXPONENT)

type Piece = {
  start: Vector3
  end: Vector3
  r0: number
  r1: number
  a0: number
  a1: number
  shelter: number
  tips: number
}

export type TraceGeometry = {
  tubes: BufferGeometry
  triangles: number
  /** Internodes of the organism this level draws. */
  internodes: number
  /** Drawn segments after merging. */
  pieces: number
}

function perpendicularBasis(d: Vector3): [Vector3, Vector3] {
  const ref = Math.abs(d.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)
  const a = new Vector3().crossVectors(d, ref).normalize()
  const b = new Vector3().crossVectors(d, a).normalize()
  return [a, b]
}

/** The branching structure: each internode's children, Strahler order and leader child. */
type Structure = { order: Int32Array; leader: Int32Array; top: number }

function branchStructure(model: TraceModel): Structure {
  const { segments } = model
  const children: number[][] = segments.map(() => [])
  segments.forEach((s, i) => {
    if (s.parent >= 0) {
      children[s.parent]!.push(i)
    }
  })
  const order = new Int32Array(segments.length)
  const leader = new Int32Array(segments.length).fill(-1)
  let top = 1
  // Children always follow their parent in the walk, so a backward pass sees every child first.
  for (let i = segments.length - 1; i >= 0; i--) {
    const kids = children[i]!
    if (kids.length === 0) {
      order[i] = 1
      continue
    }
    let highest = 0
    let count = 0
    let lead = kids[0]!
    for (const k of kids) {
      if (order[k]! > highest) {
        highest = order[k]!
        count = 1
      } else if (order[k] === highest) {
        count += 1
      }
      if (segments[k]!.tips > segments[lead]!.tips) {
        lead = k
      }
    }
    order[i] = count >= 2 ? highest + 1 : highest
    leader[i] = lead
    top = Math.max(top, order[i]!)
  }
  return { order, leader, top }
}

/** The internodes a level draws: limbs of high enough order, each continued along its leaders to the tip. */
function keptInternodes(model: TraceModel, structure: Structure, spec: LodSpec): Uint8Array {
  const { segments } = model
  const kept = new Uint8Array(segments.length)
  const lowest = spec.belowTop === null ? spec.minOrder : Math.max(spec.minOrder, structure.top - spec.belowTop)
  segments.forEach((s, i) => {
    const parentKept = s.parent < 0 || kept[s.parent] === 1
    if (parentKept && (structure.order[i]! >= Math.min(lowest, structure.top) || (s.parent >= 0 && structure.leader[s.parent] === i))) {
      kept[i] = 1
    }
  })
  return kept
}

/** The kept internodes, after merging near-straight single-child runs. Radii stay those of the full organism. */
function mergePieces(model: TraceModel, kept: Uint8Array, mergeAngle: number): Piece[] {
  const { segments } = model
  const children = new Array<number>(segments.length).fill(0)
  segments.forEach((s, i) => {
    if (kept[i] && s.parent >= 0) {
      children[s.parent]! += 1
    }
  })
  const cosLimit = Math.cos((mergeAngle * Math.PI) / 180)
  const pieceOf = new Array<number>(segments.length).fill(-1)
  const pieces: Piece[] = []

  segments.forEach((s, i) => {
    if (!kept[i]) {
      return
    }
    const r = radiusFor(s.tips)
    const r1 = children[i] === 0 ? r * TIP_CLOSE : r
    const host = s.parent >= 0 && children[s.parent] === 1 ? pieces[pieceOf[s.parent]!] : undefined
    if (mergeAngle > 0 && host) {
      const chord = host.end.clone().sub(host.start).normalize()
      const dir = s.end.clone().sub(s.start).normalize()
      if (chord.dot(dir) >= cosLimit) {
        host.end = s.end.clone()
        host.a1 = s.arrival1
        host.r1 = r1
        host.shelter = s.shelter
        pieceOf[i] = pieceOf[s.parent]!
        return
      }
    }
    pieces.push({
      start: s.start.clone(),
      end: s.end.clone(),
      r0: r,
      r1,
      a0: s.arrival0,
      a1: s.arrival1,
      shelter: s.shelter,
      tips: s.tips,
    })
    pieceOf[i] = pieces.length - 1
  })
  return pieces
}

class Builder {
  position: number[] = []
  normal: number[] = []
  center: number[] = []
  arrival: number[] = []
  shelter: number[] = []
  index: number[] = []

  get count() {
    return this.position.length / 3
  }

  vertex(p: Vector3, n: Vector3, c: Vector3, arrival: number, shelter: number) {
    this.position.push(p.x, p.y, p.z)
    this.normal.push(n.x, n.y, n.z)
    this.center.push(c.x, c.y, c.z)
    this.arrival.push(arrival)
    this.shelter.push(shelter)
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(this.position, 3))
    g.setAttribute('normal', new Float32BufferAttribute(this.normal, 3))
    g.setAttribute('aCenter', new Float32BufferAttribute(this.center, 3))
    g.setAttribute('aArrival', new Float32BufferAttribute(this.arrival, 1))
    g.setAttribute('aShelter', new Float32BufferAttribute(this.shelter, 1))
    g.setIndex(this.index)
    g.computeBoundingSphere()
    return g
  }
}

function addTube(b: Builder, piece: Piece, radial: number) {
  const axis = piece.end.clone().sub(piece.start)
  const length = axis.length()
  if (length < 1e-6) {
    return
  }
  const d = axis.divideScalar(length)
  const [u, v] = perpendicularBasis(d)
  const start = piece.start.clone().addScaledVector(d, -Math.min(piece.r0 * OVERLAP, length * 0.4))
  const base = b.count
  const n = new Vector3()
  const p = new Vector3()
  for (const [c, r, a] of [
    [start, piece.r0, piece.a0],
    [piece.end, piece.r1, piece.a1],
  ] as const) {
    for (let k = 0; k < radial; k++) {
      const theta = (k / radial) * Math.PI * 2
      n.copy(u).multiplyScalar(Math.cos(theta)).addScaledVector(v, Math.sin(theta))
      p.copy(c).addScaledVector(n, r)
      b.vertex(p, n, c, a, piece.shelter)
    }
  }
  for (let k = 0; k < radial; k++) {
    const i0 = base + k
    const i1 = base + ((k + 1) % radial)
    const j0 = i0 + radial
    const j1 = i1 + radial
    b.index.push(i0, i1, j0, i1, j1, j0)
  }
}

/** Stable 0…1 per index, so bud sizes do not flicker between rebuilds. */
const hash01 = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function buildLevel(model: TraceModel, structure: Structure, level: LodLevel): TraceGeometry {
  const spec = LOD_SPECS[level]
  const kept = keptInternodes(model, structure, spec)
  const pieces = mergePieces(model, kept, spec.mergeAngle)
  const tubes = new Builder()
  for (const piece of pieces) {
    addTube(tubes, piece, spec.radial)
  }

  if (spec.budDetail !== null) {
    const unit = new IcosahedronGeometry(1, spec.budDetail)
    const shape = unit.getAttribute('position')
    const n = new Vector3()
    const p = new Vector3()
    model.buds.forEach((bud, i) => {
      if (bud.parent >= 0 && !kept[bud.parent]) {
        return
      }
      const r = BUD_RADIUS * (0.6 + 0.8 * hash01(i))
      const base = tubes.count
      for (let k = 0; k < shape.count; k++) {
        n.fromBufferAttribute(shape, k).normalize()
        p.copy(bud.position).addScaledVector(n, r)
        tubes.vertex(p, n, bud.position, bud.arrival, bud.shelter)
        tubes.index.push(base + k)
      }
    })
    unit.dispose()
  }

  return {
    tubes: tubes.geometry(),
    triangles: tubes.index.length / 3,
    internodes: kept.reduce((sum, k) => sum + k, 0),
    pieces: pieces.length,
  }
}

/** All three representations of one grown organism, built together from the same internodes. */
export function buildTraceLods(model: TraceModel): Record<LodLevel, TraceGeometry> {
  const structure = branchStructure(model)
  return {
    full: buildLevel(model, structure, 'full'),
    reduced: buildLevel(model, structure, 'reduced'),
    skeleton: buildLevel(model, structure, 'skeleton'),
  }
}

/** The tropism applied at each internode, as a short line from its midpoint (study overlay). */
export function buildBiasGeometry(model: TraceModel, scale: number): BufferGeometry {
  const position: number[] = []
  const arrival: number[] = []
  const shelter: number[] = []
  for (const s of model.segments) {
    if (s.bias.lengthSq() < 1e-4) {
      continue
    }
    const mid = s.start.clone().add(s.end).multiplyScalar(0.5)
    const tip = mid.clone().addScaledVector(s.bias, scale)
    position.push(mid.x, mid.y, mid.z, tip.x, tip.y, tip.z)
    arrival.push(s.arrival0, s.arrival0)
    shelter.push(s.shelter, s.shelter)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(position, 3))
  g.setAttribute('aArrival', new Float32BufferAttribute(arrival, 1))
  g.setAttribute('aShelter', new Float32BufferAttribute(shelter, 1))
  return g
}
