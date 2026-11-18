import { BufferAttribute, BufferGeometry } from 'three'

/**
 * Vegetation Morphology Lab — the small geometry toolkit every candidate shares: swept tubes (stems, roots), flexible ribbons
 * (blades, fronds, strands) and a seeded random source. Everything is built straight into typed arrays, with no voxels and no
 * marching: a plant of a few thousand vertices builds in a millisecond or two, so a slider can regrow it as it moves.
 * Units are meters; y is up; the wind blows along +x.
 */
export type V = [number, number, number]
export type RGB = [number, number, number]

export const v3 = {
  add: (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: V) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V): V => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1
    return [a[0] / l, a[1] / l, a[2] / l]
  },
  lerp: (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
}

export function rng(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
export const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))

/** Rotates `v` about the unit axis `k` by `a` radians. */
export function rotate(v: V, k: V, a: number): V {
  const c = Math.cos(a)
  const s = Math.sin(a)
  const kv = v3.cross(k, v)
  const kd = v3.dot(k, v) * (1 - c)
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd]
}

/** A direction from a heading (around y, 0 = +x) and an elevation (radians above the horizon). */
export const aim = (heading: number, elevation: number): V => [Math.cos(elevation) * Math.cos(heading), Math.sin(elevation), Math.cos(elevation) * Math.sin(heading)]

/**
 * Level of detail: how much of a plant is emitted, from the same generator run. 0 Full is every stem and leaf. 1 Reduced and 2 Distant
 * are the same plant (every limb and leaf is still generated, in the same random sequence, so it has the same proportions, branching
 * directions and foliage distribution), drawn with less geometry:
 *   tubes     fewer sides and path segments; twigs thinner than `dropTube` are left out; the rest are at least `minTube` thick, so a
 *             limb stays a visible line at the distance it is drawn from instead of shimmering as a sub-pixel sliver
 *   leaves    ribbons that start in the same cell (`cluster` x the plant's size) and hang the same way are merged into one tapered
 *             mass along their mean path, so foliage stays where it was. A mass keeps the group's own length and direction, and is
 *             as thick as the group's leaf area needs: its surface area is about the leaves' (so a veil of 11 hanging leaves is a
 *             thin hanging strand, not a block). A lone leaf at Reduced stays a (shorter, wider) leaf
 *
 * Skeleton is not a fourth LodLevel. The island's distant drawing is level 2 and must stay a mass of foliage. Skeleton is a
 * lab-only drawing of the same growth (`structure` on the constructor): dominant tubes and the ribbons that are the body, fine leaves left out.
 * Week 07's Strahler mesher does not apply — these plants are not trace internodes — but a skeleton tube uses that study's
 * four sides, and runs are resampled down to a few segments.
 */
export type LodLevel = 0 | 1 | 2

/**
 * The leaf phenotype a plant's leaves are drawn with: sun leaves or shade leaves (set once per plant from its light; see
 * `leafForm` in ecology.ts). `k` runs from -1 (grown in deep shade) to +1 (grown in open sun). Every leaf ribbon takes its
 * width and colour from it here, and the leaf builders in parts.ts take its length and angle, so all candidates respond alike.
 */
export type LeafForm = { k: number; size: number; width: number; droop: number; sheen?: number }
export const NEUTRAL_LEAF: LeafForm = { k: 0, size: 1, width: 1, droop: 1 }
/** Shade leaves darker and cooler (more chlorophyll per area, no glare); sun leaves paler and warmer (thicker, waxier). */
export function leafTone(c: RGB, k: number): RGB {
  if (k < 0) {
    const a = -k
    return [c[0] * (1 - 0.3 * a), c[1] * (1 - 0.18 * a), c[2] * (1 - 0.12 * a)]
  }
  return mix(c, [0.86, 0.82, 0.66], 0.24 * k)
}
export type RibbonRole = 'organ' | 'leaf'
/** What the lab lines up to compare. Full and Reduced are levels 0 and 1. Skeleton is the structure drawing, not level 2. */
export const LAB_REPRESENTATIONS: readonly { id: string; label: string; level: LodLevel; structure: boolean }[] = [
  { id: 'full', label: 'Full', level: 0, structure: false },
  { id: 'reduced', label: 'Reduced', level: 1, structure: false },
  { id: 'skeleton', label: 'Skeleton', level: 0, structure: true },
]
/** A tube is kept in the skeleton when it is at least this share of the plant's thickest tube. */
const SKELETON_RADIUS = 0.12
const LOD = [
  { sides: 99, tubeSegs: 99, minTube: 0, dropTube: 0, minLeaf: 0, cluster: 0 },
  { sides: 5, tubeSegs: 4, minTube: 0.02, dropTube: 0.006, minLeaf: 0.03, cluster: 0.09 },
  { sides: 3, tubeSegs: 2, minTube: 0.06, dropTube: 0.06, minLeaf: 0.08, cluster: 0.22 },
] as const
/** A leaf mass's radius along its length, as a share of its cell: narrow at the root, fullest a third out, tapering to the tip. */
const MASS_PROFILE = [0.3, 1, 0.8, 0.15]

type Mass = { n: number; sum: V[]; w: number[]; c: RGB[]; area: number; len: number; first: { path: V[]; width: (t: number) => number; color: (t: number) => RGB; face: V; tw: number[] } }
type PendingTube = { path: V[]; radius: (t: number) => number; color: (t: number) => RGB; maxR: number }
type PendingRibbon = { path: V[]; width: (t: number) => number; color: (t: number) => RGB; face: V; tw: number[]; role: RibbonRole; len: number; wide: number }

export class Geo {
  pos: number[] = []
  col: number[] = []
  idx: number[] = []
  private masses = new Map<string, Mass>()
  private wood: PendingTube[] = []
  private blades: PendingRibbon[] = []
  /** `level` is the level of detail; `size` the plant's typical height (meters), which sets how coarse a leaf mass is. */
  readonly level: LodLevel
  /** Lab skeleton: record the same growth, then emit structure only. Never set by the island. */
  readonly structure: boolean
  private readonly size: number
  /** Sun or shade leaves: set by the catalog from the plant's light before it is built. */
  leaf: LeafForm = NEUTRAL_LEAF
  constructor(level: LodLevel = 0, size = 1, structure = false) {
    this.level = level
    this.structure = structure
    this.size = size
  }

  /** Minimum thicknesses scale with the plant: a mat a few centimetres tall is not given a tree's limbs. */
  private spec() {
    const k = Math.min(1, this.size / 2)
    const b = LOD[this.level]
    return { ...b, minTube: b.minTube * k, dropTube: b.dropTube * k, minLeaf: b.minLeaf * k }
  }

  private vertex(p: V, c: RGB) {
    this.pos.push(p[0], p[1], p[2])
    this.col.push(c[0], c[1], c[2])
    return this.pos.length / 3 - 1
  }

  /** A swept tube through `pts` (with `radius` and `color` already taken at each point's own parameter). */
  private sweep(pts: V[], radii: number[], colors: RGB[], sides: number) {
    const n = pts.length
    if (n < 2) return
    let u: V = Math.abs(pts[1]![1] - pts[0]![1]) < 0.9 * v3.len(v3.sub(pts[1]!, pts[0]!)) ? [0, 1, 0] : [1, 0, 0]
    const base = this.pos.length / 3
    for (let i = 0; i < n; i += 1) {
      const a = pts[Math.max(0, i - 1)]!
      const b = pts[Math.min(n - 1, i + 1)]!
      const tan = v3.norm(v3.sub(b, a))
      u = v3.norm(v3.sub(u, v3.mul(tan, v3.dot(u, tan))))
      const w = v3.cross(tan, u)
      const r = radii[i]!
      const c = colors[i]!
      for (let s = 0; s < sides; s += 1) {
        const ang = (s / sides) * Math.PI * 2
        const p = pts[i]!
        this.vertex([p[0] + (u[0] * Math.cos(ang) + w[0] * Math.sin(ang)) * r, p[1] + (u[1] * Math.cos(ang) + w[1] * Math.sin(ang)) * r, p[2] + (u[2] * Math.cos(ang) + w[2] * Math.sin(ang)) * r], c)
      }
    }
    for (let i = 0; i < n - 1; i += 1) {
      for (let s = 0; s < sides; s += 1) {
        const a = base + i * sides + s
        const b = base + i * sides + ((s + 1) % sides)
        this.idx.push(a, b, a + sides, b, b + sides, a + sides)
      }
    }
  }

  /** A swept tube along `path`; `radius(t)` and `color(t)` take 0 at the start, 1 at the end. */
  tube(path: V[], radius: (t: number) => number, color: (t: number) => RGB, sides = 6) {
    const n = path.length
    if (n < 2) return
    if (this.structure) {
      let widest = 0
      for (let i = 0; i < n; i += 1) widest = Math.max(widest, radius(i / (n - 1)))
      this.wood.push({ path, radius, color, maxR: widest })
      return
    }
    const spec = this.spec()
    const segs = Math.min(n - 1, spec.tubeSegs)
    const pts: V[] = []
    const radii: number[] = []
    const colors: RGB[] = []
    if (this.level > 0) {
      let widest = 0
      for (let i = 0; i < n; i += 1) widest = Math.max(widest, radius(i / (n - 1)))
      if (widest < spec.dropTube) return
    }
    for (let k = 0; k <= segs; k += 1) {
      const i = Math.round((k * (n - 1)) / segs)
      const t = i / (n - 1)
      pts.push(path[i]!)
      radii.push(Math.max(0.0005, spec.minTube, radius(t)))
      colors.push(color(t))
    }
    this.sweep(pts, radii, colors, Math.min(sides, spec.sides))
  }

  /**
   * A flat ribbon along `path`: `width(t)` across, turned about its own length by `twist(t)`. `face` is the direction its
   * surface leans toward (default up), which orients the ribbon's side: a blade lying flat, an upright strap, a curl.
   */
  ribbon(path: V[], width: (t: number) => number, color: (t: number) => RGB, face: V = [0, 1, 0], twist: (t: number) => number = () => 0, role: RibbonRole = 'organ') {
    const n = path.length
    if (n < 2) return
    if (role === 'leaf' && this.leaf !== NEUTRAL_LEAF) {
      const lf = this.leaf
      const w0 = width
      const c0 = color
      width = (t) => w0(t) * lf.width
      const sheen = lf.sheen ?? 0
      // A shade specialist's sheen is a blue iridescence toward the tip of each leaf (see ecology.ts, leafForm).
      color = (t) => (sheen > 0 ? mix(leafTone(c0(t), lf.k), [0.5, 0.66, 0.74], 0.42 * sheen * t) : leafTone(c0(t), lf.k))
    }
    // The twist may draw from the plant's random sequence, so it is taken at every point, in order, at every level: the plant's
    // later limbs and leaves are the same whatever is emitted.
    const tw: number[] = []
    for (let i = 0; i < n; i += 1) tw.push(twist(i / (n - 1)))
    if (this.structure) {
      let len = 0
      let wide = 0
      for (let i = 0; i < n; i += 1) {
        wide = Math.max(wide, width(i / (n - 1)))
        if (i < n - 1) len += v3.len(v3.sub(path[i + 1]!, path[i]!))
      }
      this.blades.push({ path, width, color, face, tw, role, len, wide })
      return
    }
    if (this.level === 0) {
      this.flatRibbon(path, width, color, face, tw, 0)
      return
    }
    const cell = Math.max(0.02, this.size * LOD[this.level].cluster)
    const at = (u: number): V => {
      const x = u * (n - 1)
      const i = Math.min(n - 2, Math.floor(x))
      return v3.lerp(path[i]!, path[i + 1]!, x - i)
    }
    const root = path[0]!
    const tip = path[n - 1]!
    const d = v3.sub(tip, root)
    const key = `${Math.floor(root[0] / cell)},${Math.floor(root[1] / cell)},${Math.floor(root[2] / cell)}|${d[0] < 0 ? 0 : 1}${d[1] < 0 ? 0 : 1}${d[2] < 0 ? 0 : 1}`
    let m = this.masses.get(key)
    if (!m) {
      m = { n: 0, sum: [0, 1, 2, 3].map(() => [0, 0, 0] as V), w: [0, 0, 0, 0], c: [0, 1, 2, 3].map(() => [0, 0, 0] as RGB), area: 0, len: 0, first: { path, width, color, face, tw } }
      this.masses.set(key, m)
    }
    m.n += 1
    // The leaf's own length and area (its width along its length), which the mass has to stand for.
    for (let i = 0; i < n - 1; i += 1) {
      const dl = v3.len(v3.sub(path[i + 1]!, path[i]!))
      m.len += dl
      m.area += width((i + 0.5) / (n - 1)) * dl
    }
    for (let k = 0; k < 4; k += 1) {
      const u = k / 3
      const p = at(u)
      const c = color(u)
      m.sum[k]![0] += p[0]
      m.sum[k]![1] += p[1]
      m.sum[k]![2] += p[2]
      m.w[k]! += width(u)
      m.c[k]![0] += c[0]
      m.c[k]![1] += c[1]
      m.c[k]![2] += c[2]
    }
  }

  private flatRibbon(path: V[], width: (t: number) => number, color: (t: number) => RGB, face: V, tw: number[], minWidth: number, segs = path.length - 1) {
    const n = path.length
    const base = this.pos.length / 3
    const m = segs + 1
    for (let k = 0; k < m; k += 1) {
      const i = Math.round((k * (n - 1)) / segs)
      const t = i / (n - 1)
      const a = path[Math.max(0, i - 1)]!
      const b = path[Math.min(n - 1, i + 1)]!
      const tan = v3.norm(v3.sub(b, a))
      let side = v3.cross(tan, face)
      if (v3.len(side) < 1e-4) side = v3.cross(tan, [1, 0, 0])
      side = v3.norm(side)
      if (tw[i] !== 0) side = rotate(side, tan, tw[i]!)
      const w = Math.max(0.0004, minWidth, width(t)) / 2
      const c = color(t)
      const p = path[i]!
      this.vertex([p[0] - side[0] * w, p[1] - side[1] * w, p[2] - side[2] * w], c)
      this.vertex([p[0] + side[0] * w, p[1] + side[1] * w, p[2] + side[2] * w], c)
    }
    for (let k = 0; k < m - 1; k += 1) {
      const a = base + k * 2
      this.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }

  /** Dominant limbs as 4-sided tubes, long organs kept, fine leaves omitted or gathered into a few spines. */
  private flushStructure() {
    let maxR = 0
    for (const w of this.wood) maxR = Math.max(maxR, w.maxR)
    let keptWood = 0
    for (const w of this.wood) {
      if (maxR > 0 && w.maxR < maxR * SKELETON_RADIUS) continue
      keptWood += 1
      const n = w.path.length
      const segs = Math.min(4, n - 1)
      const pts: V[] = []
      const radii: number[] = []
      const colors: RGB[] = []
      for (let k = 0; k <= segs; k += 1) {
        const i = Math.round((k * (n - 1)) / segs)
        const t = i / (n - 1)
        pts.push(w.path[i]!)
        radii.push(Math.max(0.0008, w.radius(t)))
        colors.push(w.color(t))
      }
      this.sweep(pts, radii, colors, 4)
    }
    const organs = this.blades.filter((b) => b.role === 'organ')
    const leaves = this.blades.filter((b) => b.role === 'leaf')
    let maxL = 0
    for (const b of organs) maxL = Math.max(maxL, b.len)
    // Only a moss-like body — hundreds of shoots a few centimetres long — is gathered into spines.
    // A reed, a curtain or a fin is the plant, so each of those ribbons stays, simplified.
    const fineMat = organs.length > 48 && maxL < 0.2
    if (fineMat) this.clusterSpines(organs, 0.2)
    else for (const b of organs) this.flatRibbon(b.path, b.width, b.color, b.face, b.tw, 0.001, Math.min(4, b.path.length - 1))
    if (keptWood === 0 && organs.length === 0) this.clusterSpines(leaves, 0.08)
    this.wood = []
    this.blades = []
  }

  /** One thin spine per cell: the envelope of many short shoots or of a leaf-only plant, not each leaf. */
  private clusterSpines(items: PendingRibbon[], cellScale: number) {
    if (items.length === 0) return
    const cell = Math.max(0.03, this.size * cellScale)
    type Acc = { n: number; sum: V[]; w: number; c: RGB; face: V }
    const groups = new Map<string, Acc>()
    for (const b of items) {
      const root = b.path[0]!
      const key = `${Math.floor(root[0] / cell)},${Math.floor(root[1] / cell)},${Math.floor(root[2] / cell)}`
      let group = groups.get(key)
      if (!group) {
        group = { n: 0, sum: [0, 1, 2, 3].map(() => [0, 0, 0] as V), w: 0, c: [0, 0, 0], face: b.face }
        groups.set(key, group)
      }
      group.n += 1
      group.w += b.wide
      const sample = b.color(0.55)
      group.c[0] += sample[0]
      group.c[1] += sample[1]
      group.c[2] += sample[2]
      const n = b.path.length
      for (let k = 0; k < 4; k += 1) {
        const x = (k / 3) * (n - 1)
        const i = Math.min(n - 2, Math.floor(x))
        const p = v3.lerp(b.path[i]!, b.path[i + 1]!, x - i)
        group.sum[k]![0] += p[0]
        group.sum[k]![1] += p[1]
        group.sum[k]![2] += p[2]
      }
    }
    for (const group of groups.values()) {
      const pts = group.sum.map((p) => v3.mul(p, 1 / group.n))
      const width = Math.max(0.0035, Math.min(cell * 0.22, (group.w / group.n) * 0.42))
      const col: RGB = [group.c[0] / group.n, group.c[1] / group.n, group.c[2] / group.n]
      this.flatRibbon(pts, () => width, () => col, group.face, [0, 0, 0, 0], 0.003, 3)
    }
  }

  /** Emits the leaf masses gathered at Reduced and Distant. */
  private flush() {
    const spec = this.spec()
    const cell = Math.max(0.02, this.size * spec.cluster)
    for (const m of this.masses.values()) {
      if (m.n === 1 && this.level === 1) {
        // A lone leaf stays a leaf: fewer segments, and wide enough to be seen.
        const f = m.first
        this.flatRibbon(f.path, f.width, f.color, f.face, f.tw, spec.minLeaf, Math.min(f.path.length - 1, 2))
        continue
      }
      const mean = m.sum.map((p) => v3.mul(p, 1 / m.n))
      // Averaging the leaves' paths shortens them; the mass keeps the group's mean leaf length along the same curve.
      let meanLen = 0
      for (let k = 0; k < 3; k += 1) meanLen += v3.len(v3.sub(mean[k + 1]!, mean[k]!))
      const grow = meanLen > 1e-6 ? Math.min(1.8, Math.max(1, m.len / m.n / meanLen)) : 1
      const pts = mean.map((p, k) => (k === 0 ? p : v3.add(mean[0]!, v3.mul(v3.sub(p, mean[0]!), grow))))
      // A 3-sided prism of radius r has a surface of about 5.2 r per metre: take r so the mass has about the leaves' area.
      const avg = Math.min(cell * 0.35, (1.0 * m.area) / (5.2 * Math.max(0.05, meanLen * grow)))
      const radii = MASS_PROFILE.map((k) => Math.max(spec.minLeaf / 2, (avg * k) / 0.5625))
      const colors = m.c.map((c): RGB => [c[0] / m.n, c[1] / m.n, c[2] / m.n])
      this.sweep(pts, radii, colors, 3)
    }
    this.masses.clear()
  }

  build(): BufferGeometry {
    if (this.structure) this.flushStructure()
    else if (this.level > 0) this.flush()
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3))
    g.setIndex(this.idx)
    g.computeVertexNormals()
    g.computeBoundingBox()
    return g
  }
}

/**
 * A path grown step by step from `start` along `dir`: at each step the direction is turned by `steer(t, dir)`, a vector that is
 * added to it (gravity, light, wind, noise), so a stem's form is the sum of what acts on it.
 */
export function grow(start: V, dir: V, length: number, steps: number, steer: (t: number, d: V, p: V) => V): V[] {
  const out: V[] = [start]
  let d = v3.norm(dir)
  let p = start
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    d = v3.norm(v3.add(d, steer(t, d, p)))
    p = v3.add(p, v3.mul(d, length / steps))
    out.push(p)
  }
  return out
}
