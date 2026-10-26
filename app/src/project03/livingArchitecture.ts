import { BufferAttribute, BufferGeometry, Color } from 'three'
import { sunAt } from '../project/sun.ts'
import { clamp01, smoothstep } from '../project02/core.ts'
import { prevailingWind } from './environment.ts'
import { islandRadius, landscapeHeight } from './terrain.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — Living Architecture, morphology prototype: one small colony of three organisms.
 *
 * An exploratory form, not the final visual language. Every organism is grown by the same rules, so the three are
 * kin, but each takes them to a different place:
 *
 *   mast      a buttressed column rises from a root mound, leaning to the sun's arc;
 *   plate     it holds out canopy plates (thin shells, each with an oculus where the mast passes, dished and tilted
 *             to the sun, set back toward the lee so the shade falls where the wind shelters);
 *   support   plates are carried by struts from the mast and by flying buttresses that splay to the ground, placed
 *             where the ground is firmest, so the gaps between them are thresholds;
 *   fringe    a plate's rim sheds hanging ribs that close the space under it to a few openings, a person's height and more;
 *   runner    a low root wall creeps toward the nearest water.
 *
 *   The Hall      tallest (about 50 m): a mast with three plates dwindling upward, a ground hall under the first,
 *                 a spire and crest. The one vertical landmark, and the shelter you walk into.
 *   The Gate      two piers of unequal height leaning together, tied by lintels at two heights, a shed roof raised on
 *                 the sun side, and a curved back wall: a portal into a recess.
 *   The Pavilion  broad and low: a dozen stilts carry one warped roof that follows the ground's slope, each stilt
 *                 flaring into a capital; light falls through an oculus. The place you move through.
 *
 * Tied together by a high span from the Hall's second plate to the Gate's pier, a beam from the Gate down to the
 * Pavilion's roof, and a low arcade between their feet.
 *
 * Nothing is simulated. The forms are informed once, at build, by the world the way growth would be:
 *   sunlight  masts and plates lean toward the day's sun arc; plates reach back from it;
 *   slope     feet follow the ground; flying buttresses root at the firmest foot; the Pavilion's roof follows the slope;
 *   moisture  nearer the water, thicker and lower, stained toward the foot; runner and openings face the water;
 *   wind      higher ground is lower; the windward buttress is the heaviest; the spire leans to the lee.
 * Everything is a pure function of the seed and the terrain.
 *
 * One mesh in world meters, vertex-coloured bone to pale gray, drawn by a standard material.
 */
export const livingArchitecture: { version: number; graph?: unknown } = { version: 0 }

export type V = [number, number, number]
export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k]
export const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const norm = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const lerp3 = (a: V, b: V, t: number): V => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const UP: V = [0, 1, 0]
const ground = (x: number, z: number) => landscapeHeight(x, z)
const onGround = (x: number, z: number): V => [x, ground(x, z), z]

export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Where the colony stands for a seed. The default seed's is chosen by hand (sunlit, 5° ground, 90 m from the east lake); others are searched for. */
const SITES: Record<number, [number, number]> = { 909387746: [740, -220] }

export function chooseSite(world: World, seed: number): [number, number] {
  const fixed = SITES[seed]
  if (fixed) return fixed
  const dirs = [8, 10, 12, 14, 16].map((h) => sunAt(h, 55).direction)
  const lit = (x: number, z: number, y: number, d: V) => {
    for (let s = 12; s < 1400; s += 12) if (ground(x + d[0] * s, z + d[2] * s) > y + d[1] * s) return false
    return true
  }
  let best: { x: number; z: number; score: number } | null = null
  for (let x = -1900; x <= 1900; x += 64) {
    for (let z = -1900; z <= 1900; z += 64) {
      if (Math.hypot(x, z) > islandRadius(Math.atan2(z, x)) * 0.8 || world.water.depthAt(x, z) > 0) continue
      const h = ground(x, z)
      const gx = (ground(x + 8, z) - ground(x - 8, z)) / 16
      const gz = (ground(x, z + 8) - ground(x, z - 8)) / 16
      const slope = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI
      if (slope > 9) continue
      const wd = waterDistance(world, x, z)
      if (wd > 240) continue
      let relief = 0
      for (let k = 0; k < 8; k += 1) relief = Math.max(relief, Math.abs(ground(x + Math.cos(k * 0.785) * 60, z + Math.sin(k * 0.785) * 60) - h))
      if (relief > 16) continue
      const light = dirs.filter((d) => lit(x, z, h + 12, d)).length / dirs.length
      const score = 2 * light - relief / 20 - Math.abs(wd - 90) / 200 - slope / 20
      if (!best || score > best.score) best = { x, z, score }
    }
  }
  return best ? [best.x, best.z] : [0, 0]
}

export function waterDistance(world: World, x: number, z: number): number {
  for (const d of [30, 60, 90, 130, 180, 240, 320]) {
    for (let k = 0; k < 12; k += 1) if (world.water.depthAt(x + Math.cos((k * Math.PI) / 6) * d, z + Math.sin((k * Math.PI) / 6) * d) > 0) return d
  }
  return 400
}

/** The direction (unit, horizontal) toward the nearest water from a point, by probing a ring at two distances. */
export function waterBearing(world: World, x: number, z: number): V {
  let best: V = [0, 0, 1]
  let near = Infinity
  for (let k = 0; k < 16; k += 1) {
    const a = (k / 16) * Math.PI * 2
    for (const d of [40, 80, 140, 220]) {
      if (world.water.depthAt(x + Math.cos(a) * d, z + Math.sin(a) * d) > 0 && d < near) {
        near = d
        best = [Math.cos(a), 0, Math.sin(a)]
        break
      }
    }
  }
  return best
}

export class Builder {
  positions: number[] = []
  colors: number[] = []
  indices: number[] = []
  vertex(p: V, c: Color): number {
    this.positions.push(p[0], p[1], p[2])
    this.colors.push(c.r, c.g, c.b)
    return this.positions.length / 3 - 1
  }
  quad(a: number, b: number, c: number, d: number) {
    this.indices.push(a, b, c, a, c, d)
  }
  tri(a: number, b: number, c: number) {
    this.indices.push(a, b, c)
  }
}

/** The palette: bone to pale gray, never white, with a cool stain toward the foot. */
export const BONE = new Color('#b9b4a6')
export const GRAY = new Color('#aaa9a3')
export const STAIN = new Color('#7d7a70')
const scratch = new Color()

/** The colour of a member at a height above the ground and a place along its length (0 foot, 1 tip). */
export const skin = (above: number, along: number, tone: number, moisture: number, face = 0): Color => {
  const stain = (1 - smoothstep(0, 6, above)) * (0.3 + 0.55 * moisture)
  return scratch
    .copy(BONE)
    .lerp(GRAY, 0.2 + 0.45 * along)
    .multiplyScalar(tone * (face === 2 ? 0.9 : 1))
    .lerp(STAIN, stain)
}

type Frame = { c: V; w: V; n: V; hw: number; ht: number }

function frameAt(points: V[], i: number, wDir: V, hw: number, ht: number): Frame {
  const a = points[Math.max(0, i - 1)]!
  const b = points[Math.min(points.length - 1, i + 1)]!
  const t = norm(sub(b, a))
  let w = sub(wDir, mul(t, dot(wDir, t)))
  if (Math.hypot(w[0], w[1], w[2]) < 0.2) w = cross(t, [1, 0, 0])
  w = norm(w)
  return { c: points[i]!, w, n: norm(cross(t, w)), hw, ht }
}

/** A blade swept along frames: four flat faces joined smoothly along the length. Both sides are drawn. */
function sweep(b: Builder, frames: Frame[], tint: (i: number, face: number) => Color, cap: boolean) {
  const corners = (f: Frame): V[] => [
    add(add(f.c, mul(f.w, f.hw)), mul(f.n, f.ht)),
    add(add(f.c, mul(f.w, -f.hw)), mul(f.n, f.ht)),
    add(add(f.c, mul(f.w, -f.hw)), mul(f.n, -f.ht)),
    add(add(f.c, mul(f.w, f.hw)), mul(f.n, -f.ht)),
  ]
  const rings = frames.map((f) => corners(f))
  for (let face = 0; face < 4; face += 1) {
    let previous: [number, number] | null = null
    for (let i = 0; i < rings.length; i += 1) {
      const color = tint(i, face)
      const pair: [number, number] = [b.vertex(rings[i]![face]!, color), b.vertex(rings[i]![(face + 1) % 4]!, color)]
      if (previous) b.quad(previous[0], previous[1], pair[1], pair[0])
      previous = pair
    }
  }
  if (cap && rings.length > 0) {
    const last = rings[rings.length - 1]!
    const color = tint(rings.length - 1, 0)
    const ids = last.map((p) => b.vertex(p, color))
    b.quad(ids[0]!, ids[1]!, ids[2]!, ids[3]!)
  }
}

/** A round-sectioned member (an ellipse of semi-axes (rw, rn) swept along a path), smooth all round, closed at the tip. */
function tube(b: Builder, pts: V[], radii: (t: number) => [number, number], wHint: V, tint: (t: number) => Color, cap: boolean, sides = 10) {
  const rings: number[][] = []
  for (let i = 0; i < pts.length; i += 1) {
    const t = i / (pts.length - 1)
    const tangent = norm(sub(pts[Math.min(pts.length - 1, i + 1)]!, pts[Math.max(0, i - 1)]!))
    let w = sub(wHint, mul(tangent, dot(wHint, tangent)))
    if (Math.hypot(w[0], w[1], w[2]) < 0.2) w = cross(tangent, [1, 0, 0])
    w = norm(w)
    const n = norm(cross(tangent, w))
    const [rw, rn] = radii(t)
    const color = tint(t)
    const ring: number[] = []
    for (let s = 0; s < sides; s += 1) {
      const a = (s / sides) * Math.PI * 2
      ring.push(b.vertex(add(add(pts[i]!, mul(w, Math.cos(a) * rw)), mul(n, Math.sin(a) * rn)), color))
    }
    rings.push(ring)
  }
  for (let i = 0; i < rings.length - 1; i += 1) for (let s = 0; s < sides; s += 1) b.quad(rings[i]![s]!, rings[i]![(s + 1) % sides]!, rings[i + 1]![(s + 1) % sides]!, rings[i + 1]![s]!)
  if (cap) {
    const centre = b.vertex(pts[pts.length - 1]!, tint(1))
    const last = rings[rings.length - 1]!
    for (let s = 0; s < sides; s += 1) b.tri(centre, last[s]!, last[(s + 1) % sides]!)
  }
}

/** A thick shell through a grid of points, with edges: a plate. */
function shell(b: Builder, grid: V[][], thick: number, tint: (u: number, v: number) => Color) {
  const rows = grid.length
  const cols = grid[0]!.length
  const normalAt = (i: number, j: number): V => {
    const du = sub(grid[Math.min(rows - 1, i + 1)]![j]!, grid[Math.max(0, i - 1)]![j]!)
    const dv = sub(grid[i]![Math.min(cols - 1, j + 1)]!, grid[i]![Math.max(0, j - 1)]!)
    const n = norm(cross(du, dv))
    return n[1] < 0 ? mul(n, -1) : n
  }
  const face = (sign: number) => {
    const ids: number[][] = []
    for (let i = 0; i < rows; i += 1) {
      ids.push([])
      for (let j = 0; j < cols; j += 1) ids[i]!.push(b.vertex(add(grid[i]![j]!, mul(normalAt(i, j), sign * thick * 0.5)), tint(i / (rows - 1), j / (cols - 1))))
    }
    for (let i = 0; i < rows - 1; i += 1) for (let j = 0; j < cols - 1; j += 1) b.quad(ids[i]![j]!, ids[i + 1]![j]!, ids[i + 1]![j + 1]!, ids[i]![j + 1]!)
  }
  face(1)
  face(-1)
  const edge = (cells: [number, number][]) => {
    const top: number[] = []
    const bottom: number[] = []
    for (const [i, j] of cells) {
      const n = normalAt(i, j)
      const color = tint(i / (rows - 1), j / (cols - 1))
      top.push(b.vertex(add(grid[i]![j]!, mul(n, thick * 0.5)), color))
      bottom.push(b.vertex(add(grid[i]![j]!, mul(n, -thick * 0.5)), color))
    }
    for (let k = 0; k < top.length - 1; k += 1) b.quad(top[k]!, top[k + 1]!, bottom[k + 1]!, bottom[k]!)
  }
  edge(Array.from({ length: cols }, (_, j) => [0, j] as [number, number]))
  edge(Array.from({ length: cols }, (_, j) => [rows - 1, j] as [number, number]))
}

type Site = { lean: V; perp: V; wind: V; sun: number }
type Fields = { moisture: number; exposure: number; water: V }

type PlateSpec = {
  centre: V
  /** Radii along the (perp, lean) axes: an oval when they differ. */
  radius: [number, number]
  /** Rises toward this direction (the sun): radians of tilt. */
  lean: V
  tilt: number
  /** Meters the middle stands above the rim. */
  dome: number
  oculus: number
  thick: number
  seed: number
  tone: number
  moisture: number
  /** The oval's long axis. */
  axis: V
}

/** A canopy plate: a lobed, dished shell with a hole where the mast passes; the rim curls down. Returns the rim's heights at each bearing. */
function plate(b: Builder, p: PlateSpec) {
  const rand = rng(p.seed)
  const lobes = [1, 2, 3].map((k) => ({ k: k + 1, amp: 0.05 + 0.1 * rand() / k, phase: rand() * 6.28 }))
  const perp: V = [-p.axis[2], 0, p.axis[0]]
  const rows = 8
  const cols = 40
  const grid: V[][] = []
  const rim: V[] = []
  for (let i = 0; i <= rows; i += 1) {
    const s = i / rows
    const row: V[] = []
    for (let j = 0; j <= cols; j += 1) {
      const a = (j / cols) * Math.PI * 2
      let k = 1
      for (const lobe of lobes) k += lobe.amp * Math.sin(lobe.k * a + lobe.phase)
      const lx = Math.cos(a) * p.radius[0] * k
      const lz = Math.sin(a) * p.radius[1] * k
      const r = lerp(p.oculus / Math.max(p.radius[0], p.radius[1]), 1, s)
      const dx = lx * r
      const dz = lz * r
      const offset = add(mul(p.axis, dx), mul(perp, dz))
      const rise = dot(offset, p.lean) * Math.tan(p.tilt)
      const dish = p.dome * (1 - s * s) - 1.2 * smoothstep(0.78, 1, s)
      const point: V = [p.centre[0] + offset[0], p.centre[1] + rise + dish, p.centre[2] + offset[2]]
      row.push(point)
      if (i === rows) rim.push(point)
    }
    grid.push(row)
  }
  shell(b, grid, p.thick, (u, v) => skin(grid[Math.round(u * rows)]![Math.round(v * cols)]![1] - ground(grid[Math.round(u * rows)]![Math.round(v * cols)]![0], grid[Math.round(u * rows)]![Math.round(v * cols)]![2]), 0.7 + 0.3 * u, p.tone * (0.96 + 0.05 * Math.sin(v * 9)), p.moisture))
  return rim
}

/** A flying buttress or hanging rib: a tapered blade along a path, its broad face across the path's horizontal bearing. */
function blade(b: Builder, pts: V[], hw: (t: number) => number, ht: (t: number) => number, wHint: V, tone: number, moisture: number, cap: boolean) {
  const frames = pts.map((_, i) => frameAt(pts, i, wHint, hw(i / (pts.length - 1)), ht(i / (pts.length - 1))))
  sweep(b, frames, (i, face) => skin(Math.max(0, pts[i]![1] - ground(pts[i]![0], pts[i]![2])), i / (pts.length - 1), tone, moisture, face), cap)
}

/** An arched beam between two points, rising by `rise`: broad and level, thick at its springing, slimmer at its crown. */
function lintel(b: Builder, a: V, c: V, rise: number, width: number, thick: number, tone: number, wobble: number, moisture: number) {
  const steps = 20
  const axis = norm(sub(c, a))
  const side = norm(cross(axis, UP))
  const pts: V[] = Array.from({ length: steps + 1 }, (_, i) => {
    const u = i / steps
    return add(add(add(a, mul(sub(c, a), u)), [0, rise * Math.sin(Math.PI * u) ** 0.85, 0]), mul(side, wobble * Math.sin(u * Math.PI * 2)))
  })
  const frames: Frame[] = pts.map((_, i) => {
    const u = i / steps
    const arch = Math.sin(Math.PI * u)
    return frameAt(pts, i, side, width * 0.5 * (1.15 - 0.3 * arch), thick * 0.5 * (1.2 - 0.5 * arch))
  })
  sweep(b, frames, (i, face) => skin(Math.max(0, pts[i]![1] - ground(pts[i]![0], pts[i]![2])), 0.6, tone, moisture, face), false)
}

/** A root mound that grades into the ground: its crown a little over a meter, its rim buried. */
export function footing(b: Builder, centre: V, radius: [number, number], axis: V, rand: () => number, moisture: number, skirt = 1) {
  const lobes = Array.from({ length: 4 }, () => ({ amp: 0.07 + rand() * 0.1, phase: rand() * 6.28, freq: 2 + Math.floor(rand() * 3) }))
  const perp: V = [-axis[2], 0, axis[0]]
  const rings = 5
  const around = 36
  const ids: number[][] = []
  for (let r = 0; r <= rings; r += 1) {
    ids.push([])
    for (let a = 0; a < around; a += 1) {
      const angle = (a / around) * Math.PI * 2
      let k = 1
      for (const lobe of lobes) k += lobe.amp * Math.sin(lobe.freq * angle + lobe.phase)
      const t = r / rings
      const along = Math.cos(angle) * radius[0] * k * t
      const across = Math.sin(angle) * radius[1] * k * t
      const x = centre[0] + axis[0] * along + perp[0] * across
      const z = centre[2] + axis[2] * along + perp[2] * across
      const mound = ((1 - t * t) * 1.3 - smoothstep(0.82, 1, t) * 1.9) * skirt
      ids[r]!.push(b.vertex([x, ground(x, z) + mound, z], scratch.copy(BONE).lerp(STAIN, 0.5 + 0.2 * t + 0.15 * moisture)))
    }
  }
  for (let r = 0; r < rings; r += 1) for (let a = 0; a < around; a += 1) b.quad(ids[r]![a]!, ids[r]![(a + 1) % around]!, ids[r + 1]![(a + 1) % around]!, ids[r + 1]![a]!)
}

/** The foot of a mast's flying buttress: from a ground point out in the plan, arching up and inward to a point on a plate or mast. */
function buttress(b: Builder, foot: V, head: V, bow: number, w0: number, w1: number, t0: number, t1: number, tone: number, moisture: number, cap = true) {
  const steps = 14
  const out = norm([foot[0] - head[0], 0, foot[2] - head[2]])
  const pts: V[] = Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    const e = t * t * (3 - 2 * t)
    return add(add([foot[0], foot[1] - 1.4, foot[2]], mul(sub(head, [foot[0], foot[1] - 1.4, foot[2]]), e)), mul(out, bow * Math.sin(Math.PI * t) ** 1.2))
  })
  const tangent: V = norm([-out[2], 0, out[0]])
  blade(b, pts, (t) => lerp(w0, w1, t ** 0.7) * 0.5, (t) => lerp(t0, t1, t) * 0.5, tangent, tone, moisture, cap)
}

type Hall = { plate2Edge: (toward: V) => V; plates: number[]; height: number }

/** The Hall: a buttressed mast, three plates dwindling upward, a ground hall under the first, a spire and a crest. */
function hall(b: Builder, site: Site, fields: Fields, centre: V, seed: number): Hall {
  const rand = rng(seed)
  const { lean, perp, wind } = site
  const lee = mul(lean, -1)
  const exposureScale = 1 - 0.14 * fields.exposure
  const height = 52 * exposureScale
  const levels = [14.5, 27, 39].map((y) => y * exposureScale)
  const radii: [number, number][] = [
    [17, 14],
    [11.5, 9.5],
    [7, 5.5],
  ]
  footing(b, centre, [17, 13], perp, rng(seed ^ 11), fields.moisture)
  const mastLean = 5.5 * (1 + 0.3 * fields.exposure)
  const mastAt = (y: number): V => {
    // Below the ground (the buried root) the mast stands straight.
    const t = Math.max(0, y / height)
    return add(add([centre[0], centre[1] + y, centre[2]], mul(lean, mastLean * t ** 1.6)), mul(perp, 1.2 * Math.sin(t * 3.1)))
  }
  const steps = 26
  const mast: V[] = Array.from({ length: steps + 1 }, (_, i) => mastAt(-2.2 + ((height + 2.2) * i) / steps))
  const thick = 1 + 0.28 * fields.moisture
  tube(
    b,
    mast,
    (t) => {
      const r = lerp(4.6, 1.15, t ** 0.7) * thick
      return [r * 1.25 + 1.4 * Math.max(0, 1 - t * 7) ** 2, r]
    },
    perp,
    (t) => skin(t * height, t, 1.0, fields.moisture),
    true,
    14,
  )
  // The tip: a thin crest fin, leaning to the lee.
  const crestBase = mastAt(height - 2)
  blade(b, Array.from({ length: 8 }, (_, i) => add(crestBase, add(mul(lee, 3.2 * (i / 7) ** 1.6), [0, 8 * (i / 7), 0]))), (t) => lerp(0.9, 0.12, t), (t) => lerp(0.35, 0.1, t), perp, 1.02, 0, true)
  const plateSpecs: PlateSpec[] = []
  levels.forEach((y, i) => {
    const m = mastAt(y)
    const [rx, rz] = radii[i]!
    const mr = lerp(4.6, 1.15, (y / height) ** 0.7) * thick
    plateSpecs.push({
      centre: add(m, mul(lee, rx * 0.26)),
      radius: [rx * (1 + 0.1 * rand()), rz * (1 + 0.1 * rand())],
      lean,
      tilt: 0.1 + 0.03 * rand(),
      dome: 1.6 - 0.2 * i,
      oculus: mr * 1.25 + 0.5,
      thick: lerp(1.1, 0.7, i / 2),
      seed: seed ^ (101 * (i + 1)),
      tone: 0.97 + 0.03 * i,
      moisture: fields.moisture * (1 - 0.3 * i),
      axis: perp,
    })
  })
  const rims = plateSpecs.map((p) => plate(b, p))
  // Struts: the mast puts out four arms under each plate, bowed upward.
  plateSpecs.forEach((p, i) => {
    const y = levels[i]!
    for (let k = 0; k < 4; k += 1) {
      const angle = (k / 4) * Math.PI * 2 + 0.5 + i * 0.4 + (rand() - 0.5) * 0.4
      const dir: V = add(mul(perp, Math.cos(angle)), mul(lean, Math.sin(angle)))
      const from = add(mastAt(y - 3.8), mul(dir, 1.1))
      const to = add(p.centre, add(mul(dir, Math.min(p.radius[0], p.radius[1]) * 0.7), [0, -0.5, 0]))
      const pts: V[] = Array.from({ length: 9 }, (_, q) => {
        const t = q / 8
        return add(lerp3(from, to, t), [0, 1.6 * Math.sin(Math.PI * t) ** 1.2 - 0.6 * t, 0])
      })
      tube(b, pts, (t) => [lerp(1.0, 0.45, t), lerp(0.85, 0.4, t)], dir, (t) => skin(y, 0.4 + 0.4 * t, 1, 0), false, 8)
    }
  })
  // Flying buttresses to the ground at the firmest feet; the openings between them are the hall's thresholds.
  const first = plateSpecs[0]!
  const candidates = Array.from({ length: 14 }, (_, k) => {
    const angle = (k / 14) * Math.PI * 2
    const foot = (reach: number): V => {
      const x = first.centre[0] + Math.cos(angle) * first.radius[0] * reach
      const z = first.centre[2] + Math.sin(angle) * first.radius[1] * reach
      return onGround(x, z)
    }
    const f = foot(1.18)
    const gx = (ground(f[0] + 5, f[2]) - ground(f[0] - 5, f[2])) / 10
    const gz = (ground(f[0], f[2] + 5) - ground(f[0], f[2] - 5)) / 10
    return { angle, foot: f, slope: Math.hypot(gx, gz), windward: Math.cos(angle) * wind[0] + Math.sin(angle) * wind[2] }
  })
  // Four legs, spaced around the rim, at the best feet of each quarter; one quarter is left open toward the water.
  const waterAngle = Math.atan2(fields.water[2], fields.water[0])
  const chosen: typeof candidates = []
  for (let q = 0; q < 4; q += 1) {
    const quarter = candidates.filter((_, k) => Math.floor((k / 14) * 4) === q)
    quarter.sort((a, c) => a.slope - c.slope)
    if (quarter[0]) chosen.push(quarter[0])
  }
  const legs = chosen.filter((c) => Math.abs(Math.atan2(Math.sin(c.angle - waterAngle), Math.cos(c.angle - waterAngle))) > 0.35)
  for (const leg of legs) {
    const rimPoint = add(first.centre, add(mul(add(mul(perp, Math.cos(leg.angle) * first.radius[0] * 0.86), mul(lean, Math.sin(leg.angle) * first.radius[1] * 0.86)), 1), [0, -1.3, 0]))
    const heavy = 1 + 0.55 * Math.max(0, leg.windward)
    buttress(b, leg.foot, rimPoint, 3.2, 3.4 * heavy, 1.5, 1.7 * heavy, 0.9, 0.99, fields.moisture)
  }
  // The fringe: ribs hang from the first plate's rim, leaving the thresholds open.
  const fringeAngles: number[] = []
  const rim = rims[0]!
  for (let k = 0; k < rim.length - 1; k += 2) {
    const angle = (k / (rim.length - 1)) * Math.PI * 2
    const bearing = (target: number) => Math.abs(Math.atan2(Math.sin(angle - target), Math.cos(angle - target)))
    const nearLeg = legs.some((l) => Math.abs(Math.atan2(Math.sin(angle - l.angle), Math.cos(angle - l.angle))) < 0.17)
    // Doorways: toward the sun, toward the water, and downhill.
    const open = bearing(Math.atan2(lean[2], lean[0])) < 0.34 || bearing(waterAngle) < 0.4
    if (!nearLeg && !open) fringeAngles.push(k)
  }
  for (const k of fringeAngles) {
    const top = rim[k]!
    const outward = norm([top[0] - first.centre[0], 0, top[2] - first.centre[2]])
    const g = ground(top[0], top[2])
    const length = top[1] - g - 3.6 - 1.2 * rand()
    if (length < 3) continue
    const pts: V[] = Array.from({ length: 9 }, (_, q) => {
      const t = q / 8
      return add(add(top, [0, -length * t, 0]), mul(outward, -1.6 * Math.sin(Math.PI * t * 0.8)))
    })
    blade(b, pts, (t) => lerp(0.95, 0.3, t), (t) => lerp(0.4, 0.16, t), [-outward[2], 0, outward[0]], 1.0, fields.moisture * 0.5, true)
  }
  // The root runner: a low wall creeping toward the water, stepping down into the ground.
  const runnerLength = 20 + 8 * fields.moisture
  const base = add(centre, mul(fields.water, 12))
  const runner: V[] = Array.from({ length: 12 }, (_, q) => {
    const t = q / 11
    const x = base[0] + fields.water[0] * runnerLength * t + perp[0] * Math.sin(t * 3) * 2
    const z = base[2] + fields.water[2] * runnerLength * t + perp[2] * Math.sin(t * 3) * 2
    return [x, ground(x, z) + 3.6 * (1 - t) ** 1.5 - 0.5, z]
  })
  blade(b, runner, (t) => lerp(1.3, 0.7, t), (t) => lerp(0.6, 0.3, t), [-fields.water[2], 0, fields.water[0]], 0.95, fields.moisture, true)
  return {
    height,
    plates: levels,
    plate2Edge: (toward) => {
      const p = plateSpecs[1]!
      const dir = norm([toward[0] - p.centre[0], 0, toward[2] - p.centre[2]])
      return add(p.centre, add(mul(dir, Math.max(p.radius[0], p.radius[1]) * 0.92), [0, 0.2, 0]))
    },
  }
}

type Gate = { pier1: (y: number) => V; pier2: (y: number) => V }

/** The Gate: two piers of unequal height leaning together, lintels at two heights, a raised shed roof and a curved back wall. */
function gate(b: Builder, site: Site, fields: Fields, centre: V, seed: number): Gate {
  const rand = rng(seed)
  const { lean, perp, wind } = site
  const lee = mul(lean, -1)
  const exposureScale = 1 - 0.14 * fields.exposure
  const gap = 12
  footing(b, centre, [15, 11], perp, rng(seed ^ 7), fields.moisture)
  const base1: V = onGround(centre[0] - perp[0] * gap * 0.5, centre[2] - perp[2] * gap * 0.5)
  const base2: V = onGround(centre[0] + perp[0] * gap * 0.5, centre[2] + perp[2] * gap * 0.5)
  const h1 = 36 * exposureScale
  const h2 = 26 * exposureScale
  const pier = (base: V, h: number, toward: V, sway: number) => {
    const at = (y: number): V => {
      const t = Math.max(0, y / h)
      return add(add(add([base[0], base[1] + y, base[2]], mul(toward, 4.2 * t ** 1.5)), mul(lean, 0.22 * h * t ** 1.7)), mul(perp, sway * Math.sin(t * Math.PI)))
    }
    const pts: V[] = Array.from({ length: 24 }, (_, i) => at(-2 + ((h + 2) * i) / 23))
    const thick = 1 + 0.3 * fields.moisture
    tube(b, pts, (t) => [lerp(2.9, 1.05, t ** 0.8) * thick * 1.15, lerp(2.5, 0.9, t ** 0.8) * thick], perp, (t) => skin(t * h, t, 1.0, fields.moisture), true, 12)
    return at
  }
  const p1 = pier(base1, h1, perp, 0.8)
  const p2 = pier(base2, h2, mul(perp, -1), -0.6)
  // Lintels at two heights: a heavy one that makes the portal, and a slender one above.
  lintel(b, p1(21 * exposureScale), p2(19 * exposureScale), 3.4, 2.8, 1.5, 1.0, 0.4, fields.moisture)
  lintel(b, p1(31 * exposureScale), p2(24.5 * exposureScale), 1.6, 1.3, 0.7, 1.02, -0.5, fields.moisture * 0.4)
  // The raised shed roof: set back to the lee, rising toward the sun.
  const mid = lerp3(p1(0), p2(0), 0.5)
  const roofCentre = add(mid, add(mul(lee, 8.5), [0, 17 * exposureScale, 0]))
  plate(b, {
    centre: roofCentre,
    radius: [14, 11.5],
    lean,
    tilt: 0.2,
    dome: 1.2,
    oculus: 0.4,
    thick: 0.9,
    seed: seed ^ 33,
    tone: 0.98,
    moisture: fields.moisture * 0.6,
    axis: perp,
  })
  // Two flying buttresses carry it to the ground at the lee, at the firmest feet.
  for (const sign of [-1, 1]) {
    const foot = onGround(roofCentre[0] + perp[0] * sign * 10 - lean[0] * 6, roofCentre[2] + perp[2] * sign * 10 - lean[2] * 6)
    const head = add(roofCentre, add(mul(perp, sign * 8.6), [0, -1.1, 0]))
    buttress(b, foot, head, 2.4, 2.6 * (1 + 0.5 * Math.max(0, dot(wind, perp) * sign)), 1.2, 1.4, 0.8, 0.99, fields.moisture)
  }
  // The back wall: curved, with a doorway.
  for (const sign of [-1, 1]) {
    const pts: V[] = Array.from({ length: 12 }, (_, q) => {
      const t = q / 11
      const a = (0.28 + 0.62 * t) * Math.PI * sign
      const x = mid[0] + lee[0] * Math.cos(a) * 12 + perp[0] * Math.sin(a) * 15
      const z = mid[2] + lee[2] * Math.cos(a) * 12 + perp[2] * Math.sin(a) * 15
      return [x, ground(x, z) + 7.6 * (1 - 0.35 * t) - 0.8, z]
    })
    blade(b, pts, (t) => lerp(1.6, 1.1, t) * 0.5 * 1.4, (t) => lerp(0.7, 0.45, t), [lee[0], 0, lee[2]], 0.97, fields.moisture, true)
  }
  void rand
  return { pier1: p1, pier2: p2 }
}

type Pavilion = { roofEdge: (toward: V) => V }

/** The Pavilion: a dozen stilts carry one warped roof that follows the ground's slope, each flaring into a capital, with an oculus. */
function pavilion(b: Builder, site: Site, fields: Fields, centre: V, seed: number): Pavilion {
  const rand = rng(seed)
  const { lean, perp } = site
  footing(b, centre, [16, 11], perp, rng(seed ^ 3), fields.moisture, 0.7)
  // The roof's plane: the ground's own slope under the footprint, kept a person's several heights above it.
  const gx = (ground(centre[0] + 8, centre[2]) - ground(centre[0] - 8, centre[2])) / 16
  const gz = (ground(centre[0], centre[2] + 8) - ground(centre[0], centre[2] - 8)) / 16
  const roofAt = (x: number, z: number) => centre[1] + 8.6 + gx * (x - centre[0]) + gz * (z - centre[2]) + 0.7 * Math.sin((x - centre[0]) * 0.31) * Math.cos((z - centre[2]) * 0.27)
  const stilts: V[] = []
  for (let tries = 0; tries < 80 && stilts.length < 11; tries += 1) {
    const u = (rand() * 2 - 1) * 0.92
    const v = (rand() * 2 - 1) * 0.92
    if (u * u + v * v > 1) continue
    const x = centre[0] + perp[0] * u * 13.5 + lean[0] * v * 9
    const z = centre[2] + perp[2] * u * 13.5 + lean[2] * v * 9
    if (stilts.some((s) => Math.hypot(s[0] - x, s[2] - z) < 4.6)) continue
    stilts.push(onGround(x, z))
  }
  const radius = [15, 10.2]
  plate(b, {
    centre: [centre[0] + lean[0] * -1.5, roofAt(centre[0], centre[2]), centre[2] + lean[2] * -1.5],
    radius: [radius[0]!, radius[1]!],
    lean: [-gx, 0, -gz],
    tilt: Math.atan(Math.hypot(gx, gz)) * 0.9,
    dome: 1.5,
    oculus: 2.2,
    thick: 0.85,
    seed: seed ^ 55,
    tone: 0.99,
    moisture: fields.moisture * 0.5,
    axis: perp,
  })
  for (const s of stilts) {
    const top = roofAt(s[0], s[2]) - 0.4
    const height = top - s[1]
    const sway = (rand() - 0.5) * 1.2
    const pts: V[] = Array.from({ length: 10 }, (_, q) => {
      const t = q / 9
      return add([s[0], s[1] - 1.2 + (height + 1.2) * t, s[2]], mul(perp, sway * t))
    })
    tube(b, pts, (t) => [lerp(1.05, 0.58, t) * (1 + 0.25 * fields.moisture), lerp(1.0, 0.55, t) * (1 + 0.25 * fields.moisture)], perp, (t) => skin(t * height, t, 0.99, fields.moisture), false, 9)
    // The capital: three short arms spreading from the stilt's head to the roof.
    const head = pts[pts.length - 1]!
    for (let k = 0; k < 3; k += 1) {
      const angle = (k / 3) * Math.PI * 2 + rand()
      const dir: V = [Math.cos(angle), 0, Math.sin(angle)]
      const arm: V[] = Array.from({ length: 6 }, (_, q) => {
        const t = q / 5
        return add(add(head, mul(dir, 2.6 * t)), [0, -1.2 * (1 - t) ** 2 + 1.0 * t, 0])
      })
      tube(b, arm, (t) => [lerp(0.55, 0.22, t), lerp(0.5, 0.2, t)], dir, () => skin(height, 0.7, 1, 0), false, 6)
    }
  }
  return {
    roofEdge: (toward) => {
      const dir = norm([toward[0] - centre[0], 0, toward[2] - centre[2]])
      const x = centre[0] + dir[0] * radius[0]! * 0.86
      const z = centre[2] + dir[2] * radius[1]! * 0.9
      return [x, roofAt(x, z), z]
    },
  }
}

/** A low arcade of three piers and two arches between two feet: the colony's ground-level link. */
function arcade(b: Builder, from: V, to: V, bulge: V, rand: () => number, moisture: number) {
  const count = 4
  const piers: V[] = []
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1)
    const p = add(add(from, mul(sub(to, from), t)), mul(bulge, Math.sin(Math.PI * t)))
    piers.push(onGround(p[0] + (rand() - 0.5) * 2, p[2] + (rand() - 0.5) * 2))
  }
  const along = norm(sub(to, from))
  const wDir: V = [-along[2], 0, along[0]]
  piers.forEach((base, i) => {
    const height = (4.2 + 1.8 * rand()) * (i === 0 || i === count - 1 ? 1.4 : 1)
    const pts: V[] = Array.from({ length: 8 }, (_, k) => add([base[0], base[1] - 1.2, base[2]], [0, (height + 1.2) * (k / 7), 0]))
    tube(b, pts, (t) => [lerp(1.0, 0.65, t), lerp(0.8, 0.55, t)], wDir, (t) => skin(t * height, t, 1, moisture), true, 8)
    if (i < count - 1) {
      const next = piers[i + 1]!
      lintel(b, add(base, [0, height * 0.9, 0]), add(next, [0, height * 0.86, 0]), 1.2 + rand() * 0.9, 1.6, 0.8, 0.98, (rand() - 0.5) * 0.8, moisture)
    }
  })
}

export type Colony = { geometry: BufferGeometry; site: [number, number]; ground: number; organisms: number; height: number; stats?: Record<string, number> }

/** Builds the colony for a world. Deterministic: the same seed and terrain give the same colony. */
export function buildColony(world: World, seed: number): Colony {
  const [sx, sz] = chooseSite(world, seed)
  const rand = rng(seed ^ 0x51ed270b)
  // The day's sun, averaged: structures lean toward it, and shade falls the other way.
  let lx = 0
  let lz = 0
  for (const h of [8, 10, 12, 14, 16]) {
    const d = sunAt(h, 55).direction
    lx += d[0]
    lz += d[2]
  }
  const lean = norm([lx, 0, lz])
  const perp: V = [-lean[2], 0, lean[0]]
  const heading = (prevailingWind(seed) * Math.PI) / 180
  const wind: V = [Math.cos(heading), 0, Math.sin(heading)]
  const site: Site = { lean, perp, wind, sun: 55 }

  const place = (x: number, z: number): V => {
    // Keep each organism on dry, moderate ground: slide toward the Hall until it is.
    let px = x
    let pz = z
    for (let tries = 0; tries < 8; tries += 1) {
      const gx = (ground(px + 8, pz) - ground(px - 8, pz)) / 16
      const gz = (ground(px, pz + 8) - ground(px, pz - 8)) / 16
      if (world.water.depthAt(px, pz) <= 0 && Math.hypot(gx, gz) < 0.32) break
      px = lerp(px, sx, 0.15)
      pz = lerp(pz, sz, 0.15)
    }
    return onGround(px, pz)
  }
  const fieldsAt = (p: V): Fields => ({
    moisture: Math.exp(-waterDistance(world, p[0], p[2]) / 110),
    exposure: clamp01((p[1] - 60) / 260),
    water: waterBearing(world, p[0], p[2]),
  })

  const hallAt = place(sx, sz)
  const gateAt = place(sx + perp[0] * 50 - lean[0] * 8, sz + perp[2] * 50 - lean[2] * 8)
  const pavilionAt = place(sx - perp[0] * 52 + lean[0] * 8, sz - perp[2] * 52 + lean[2] * 8)

  const b = new Builder()
  const mainHall = hall(b, site, fieldsAt(hallAt), hallAt, seed ^ 0x1a2b)
  const mainGate = gate(b, site, fieldsAt(gateAt), gateAt, seed ^ 0x3c4d)
  const mainPavilion = pavilion(b, site, fieldsAt(pavilionAt), pavilionAt, seed ^ 0x5e6f)
  // Ties: a high span from the Hall's second plate to the Gate's taller pier, and a beam from the Gate's lower pier
  // down to the Pavilion's roof; between the Hall and the Pavilion, a low arcade at the feet.
  lintel(b, mainHall.plate2Edge(gateAt), mainGate.pier1(23), 4.2, 2.6, 1.2, 1.0, 1.4, 0.3)
  lintel(b, mainGate.pier2(15.5), mainPavilion.roofEdge(gateAt), -1.6, 1.8, 0.9, 1.0, -1.2, 0.3)
  arcade(b, add(hallAt, mul(perp, -9)), add(pavilionAt, mul(perp, 9)), mul(lean, 5 + rand() * 3), rng(seed ^ 0x77), 0.5)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(b.positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(b.colors), 3))
  geometry.setIndex(new BufferAttribute(new Uint32Array(b.indices), 1))
  geometry.computeVertexNormals()
  // Undersides sit in their own shade, and the lee face is a little darker than the windward one.
  const normal = geometry.getAttribute('normal') as BufferAttribute
  const color = geometry.getAttribute('color') as BufferAttribute
  for (let i = 0; i < color.count; i += 1) {
    const ny = normal.getY(i)
    const toWind = normal.getX(i) * wind[0] + normal.getZ(i) * wind[2]
    const k = (ny < -0.4 ? 0.86 : 1) * (1 + 0.04 * toWind)
    color.setXYZ(i, color.getX(i) * k, color.getY(i) * k, color.getZ(i) * k)
  }
  geometry.computeBoundingSphere()
  livingArchitecture.version += 1
  return { geometry, site: [hallAt[0], hallAt[2]], ground: hallAt[1], organisms: 3, height: mainHall.height }
}
