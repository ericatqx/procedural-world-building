import { BufferGeometry, Float32BufferAttribute, Matrix4, Uint16BufferAttribute, Vector3, type Object3D } from 'three'

export type V = [number, number, number]
export type RGB = [number, number, number]

export const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
export const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smooth = (t: number) => t * t * (3 - 2 * t)

/** A small seeded random stream (mulberry32): the same seed always gives the same creature. */
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

export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k]
export const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = (a: V) => Math.hypot(a[0], a[1], a[2])
export const norm = (a: V): V => {
  const l = len(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/**
 * Geometry for a rigged creature. Everything is authored in the local frame of a bone (`part`), then placed in the bind pose, so a
 * limb is written as "a tube that hangs along -Y" and the rig puts it where the bone stands. Each vertex is skinned to its bone
 * and, near a joint, shared with the neighbouring bone so the surface bends instead of cracking.
 *
 * `flat` meshes (plates, claws, crystalline parts) get one normal per face, which is what makes them read as faceted mineral
 * against the smooth tissue around them.
 */
export class Mesher {
  pos: number[] = []
  col: number[] = []
  idx: number[] = []
  skinIndex: number[] = []
  skinWeight: number[] = []
  private m = new Matrix4()
  private p = new Vector3()
  private bone = 0
  private prev = -1
  private next = -1
  private readonly flat: boolean
  private readonly bones: readonly Object3D[]
  constructor(flat: boolean, bones: readonly Object3D[]) {
    this.flat = flat
    this.bones = bones
  }

  /** Author in `bone`'s local frame. `prev` and `next` share the surface near the joints at either end of a tube. */
  part(bone: number, prev = -1, next = -1): this {
    this.bone = bone
    this.prev = prev
    this.next = next
    this.m.copy(this.bones[bone]!.matrixWorld)
    return this
  }

  get count() {
    return this.pos.length / 3
  }

  /** A vertex at a point in the current bone's frame; `wn` and `wp` are the shares given to the next and previous bone. */
  vertex(local: V, c: RGB, wn = 0, wp = 0): number {
    this.p.set(local[0], local[1], local[2]).applyMatrix4(this.m)
    this.pos.push(this.p.x, this.p.y, this.p.z)
    this.col.push(c[0], c[1], c[2])
    const n = this.next >= 0 ? wn : 0
    const q = this.prev >= 0 ? wp : 0
    this.skinIndex.push(this.bone, n > 0 ? this.next : 0, q > 0 ? this.prev : 0, 0)
    this.skinWeight.push(1 - n - q, n, q, 0)
    return this.count - 1
  }

  /** A vertex at a point in the bind pose, shared by several bones (`bones`: [index, weight]). */
  world(p: V, c: RGB, bones: readonly [number, number][]): number {
    this.pos.push(p[0], p[1], p[2])
    this.col.push(c[0], c[1], c[2])
    const si = [0, 0, 0, 0]
    const sw = [0, 0, 0, 0]
    bones.slice(0, 4).forEach(([b, w], i) => {
      si[i] = b
      sw[i] = w
    })
    this.skinIndex.push(...si)
    this.skinWeight.push(...sw)
    return this.count - 1
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c)
  }

  quad(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d)
  }

  /** The skin shares near the ends of a tube (0 to 1 along it): half to the neighbour at the joint, fading over `blend`. */
  private shares(t: number, blend: number): [number, number] {
    const wn = t > 1 - blend ? (0.5 * (t - (1 - blend))) / blend : 0
    const wp = t < blend ? (0.5 * (1 - t / blend)) : 0
    return [wn, wp]
  }

  /** A tube along a path in the bone's frame. `radius` and `color` take 0 at the start and 1 at the end. Both ends close to a point unless `open`. */
  tube(path: V[], radius: (t: number) => number, color: (t: number) => RGB, sides = 7, o: { blend?: number; open?: boolean } = {}) {
    const n = path.length
    if (n < 2) return
    const blend = o.blend ?? 0.28
    const base = this.count
    let u: V = Math.abs(path[1]![1] - path[0]![1]) < 0.9 * len(sub(path[1]!, path[0]!)) ? [0, 1, 0] : [1, 0, 0]
    for (let i = 0; i < n; i += 1) {
      const t = i / (n - 1)
      const a = path[Math.max(0, i - 1)]!
      const b = path[Math.min(n - 1, i + 1)]!
      const tan = norm(sub(b, a))
      u = norm(sub(u, mul(tan, dot(u, tan))))
      const w = cross(tan, u)
      const r = radius(t)
      const c = color(t)
      const [wn, wp] = this.shares(t, blend)
      const p = path[i]!
      for (let s = 0; s < sides; s += 1) {
        const ang = (s / sides) * Math.PI * 2
        const cu = Math.cos(ang) * r
        const cw = Math.sin(ang) * r
        this.vertex([p[0] + u[0] * cu + w[0] * cw, p[1] + u[1] * cu + w[1] * cw, p[2] + u[2] * cu + w[2] * cw], c, wn, wp)
      }
    }
    for (let i = 0; i < n - 1; i += 1) {
      for (let s = 0; s < sides; s += 1) {
        const a = base + i * sides + s
        const b = base + i * sides + ((s + 1) % sides)
        this.idx.push(a, b, a + sides, b, b + sides, a + sides)
      }
    }
    if (!o.open) {
      for (const [at, ring, flip] of [[0, base, false], [n - 1, base + (n - 1) * sides, true]] as const) {
        const t = at / (n - 1)
        const [wn, wp] = this.shares(t, blend)
        const apex = this.vertex(path[at]!, color(t), wn, wp)
        for (let s = 0; s < sides; s += 1) {
          const a = ring + s
          const b = ring + ((s + 1) % sides)
          if (flip) this.idx.push(a, apex, b)
          else this.idx.push(a, b, apex)
        }
      }
    }
  }

  /**
   * A body of cross-sections along the local X axis, each a superellipse (`n` 2 is an ellipse, higher is boxier): the torso, neck,
   * head and tail segments of a creature. `color` takes the position along it and the height on the section (-1 belly to 1 back).
   */
  loft(sections: { x: number; y?: number; z?: number; ry: number; rz: number; n?: number }[], color: (t: number, up: number) => RGB, sides = 12, o: { blend?: number; open?: boolean; floor?: number } = {}) {
    const m = sections.length
    const blend = o.blend ?? 0.3
    const base = this.count
    for (let i = 0; i < m; i += 1) {
      const t = i / (m - 1)
      const sec = sections[i]!
      const e = 2 / (sec.n ?? 2.4)
      const [wn, wp] = this.shares(t, blend)
      for (let s = 0; s < sides; s += 1) {
        const ang = (s / sides) * Math.PI * 2 + Math.PI / sides
        const sy = Math.sin(ang)
        const sz = Math.cos(ang)
        // `floor` cuts the underside flat at that fraction of the half height (a shell that does not close under the belly).
        const yy = (sec.y ?? 0) + Math.sign(sy) * Math.abs(sy) ** e * sec.ry
        this.vertex([sec.x, o.floor === undefined ? yy : Math.max(yy, (sec.y ?? 0) + o.floor * sec.ry), (sec.z ?? 0) + Math.sign(sz) * Math.abs(sz) ** e * sec.rz], color(t, sy), wn, wp)
      }
    }
    for (let i = 0; i < m - 1; i += 1) {
      for (let s = 0; s < sides; s += 1) {
        const a = base + i * sides + s
        const b = base + i * sides + ((s + 1) % sides)
        this.idx.push(a, b, a + sides, b, b + sides, a + sides)
      }
    }
    if (!o.open) {
      for (const [at, flip] of [[0, false], [m - 1, true]] as const) {
        const sec = sections[at]!
        const t = at / (m - 1)
        const [wn, wp] = this.shares(t, blend)
        const apex = this.vertex([sec.x, sec.y ?? 0, sec.z ?? 0], color(t, 0), wn, wp)
        const ring = base + at * sides
        for (let s = 0; s < sides; s += 1) {
          const a = ring + s
          const b = ring + ((s + 1) % sides)
          if (flip) this.idx.push(a, apex, b)
          else this.idx.push(a, b, apex)
        }
      }
    }
  }

  /**
   * A faceted block: a box from a centre and three half-axis vectors, with its top face (along `hy`) narrowed to `taper` and
   * pulled back by `lean`. Plates, scutes and crystalline shards are made from it.
   */
  slab(c: V, hx: V, hy: V, hz: V, color: (face: number) => RGB, taper = 1, lean = 0) {
    const corner = (sx: number, sy: number, sz: number): V => {
      const k = sy > 0 ? taper : 1
      return [
        c[0] + hx[0] * sx * k + hy[0] * sy + hz[0] * sz * k + (sy > 0 ? hx[0] * lean : 0),
        c[1] + hx[1] * sx * k + hy[1] * sy + hz[1] * sz * k + (sy > 0 ? hx[1] * lean : 0),
        c[2] + hx[2] * sx * k + hy[2] * sy + hz[2] * sz * k + (sy > 0 ? hx[2] * lean : 0),
      ]
    }
    const faces: [number, number, number][][] = [
      [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
      [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]],
      [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]],
      [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
      [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
      [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]],
    ]
    faces.forEach((f, face) => {
      const col = color(face)
      const ids = f.map((k) => this.vertex(corner(k[0], k[1], k[2]), col))
      this.quad(ids[0]!, ids[1]!, ids[2]!, ids[3]!)
    })
  }

  build(): BufferGeometry {
    let g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3))
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3))
    g.setAttribute('skinIndex', new Uint16BufferAttribute(this.skinIndex, 4))
    g.setAttribute('skinWeight', new Float32BufferAttribute(this.skinWeight, 4))
    g.setIndex(this.idx)
    if (this.flat) g = g.toNonIndexed()
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  }
}
