import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three'
import { surfaceNets } from '../project03/livingMesh.ts'
import { landscapeHeight } from '../project03/terrain.ts'

/**
 * Architecture Lab: Porous Growth (experimental; lab only, not in the world).
 *
 * A continuous, asymmetric formation, not a figure on a trunk: a chain of massifs of different heights, fused along a curving
 * spine, with a broad skirt that melts into the ground. Space is made in three tiers, all of it carved out of the one mass:
 *   - large openings: a roofed gap where the spine is bridged (the roof grows out from one pier toward the other, and the
 *     material around the gap is its support), and one or two portals bored across the mass;
 *   - a connected chamber inside the tallest massif, entered by a portal and lit by windows;
 *   - small voids: pits weathered into old tissue, clustered around the openings and on the shaded side.
 *
 * Growth: each massif has a birth and a duration, and swells (wide first, then tall) from a seed mound at the tallest one
 * outward along the spine; the roof extends from its first pier; openings and chambers erode into old tissue only. The field at
 * an age contains only what has arrived, and every vertex keeps its arrival, so the lab's grown material draws youth and rings.
 *
 * Individual (seed): the number, size and height of the massifs, where the tall one stands, the curve of the spine, whether and
 * where it is bridged, where the portals fall and how they are skewed. Place (habitat): how the form is adapted (see
 * `adaptation`, documented where it is computed); a seed's random draws never depend on habitat, so one seed keeps its identity.
 *
 * Space: x, z are metres from the site, h is metres above the ground there (the formation follows the terrain), so floors of
 * openings and the skirt sit on the ground wherever it rises or falls. Distances are approximate (ellipsoids), then softly united.
 */
export type PorousInputs = {
  light: number
  moisture: number
  resource: number
  ridge: number
  crowding: number
  waterDist: number | null
  size: number
  sunAzimuth: number
  waterAzimuth: number | null
}

export type V3 = [number, number, number]
export type Prim = {
  kind: 'mass' | 'apron' | 'roof' | 'tier' | 'rib' | 'path' | 'blob'
  cx: number
  cz: number
  sin: number
  cos: number
  a: number
  b: number
  h: number
  /** Profile: how much it narrows toward the top (0 dome, 0.5 spire) and how flat the top is (0 round, 1 mesa). */
  taper: number
  flat: number
  leanX: number
  leanZ: number
  birth: number
  dur: number
  // roof: from (cx, cz) to (ex, ez), centre height hc, semi-thickness hv.
  ex: number
  ez: number
  hc: number
  hv: number
  /** rib: the height of its far end (hc is the near end's), and a tier's frilled edge (amplitude, phase). */
  hb: number
  frill: number
  ph: number
  /** path: the nodes of one growth path (see PathNode); it grows out along them from the first. */
  nodes?: PathNode[]
  /** blob: one lobe of a grown shoot: an ellipsoid with its own frame (see organismGrowth.ts). */
  bl?: Lobe
}
/** An ellipsoidal lobe: axis t (long, semi-length La), s (horizontal, semi rw) and n = t x s (semi rt). */
export type Lobe = { tx: number; th: number; tz: number; sx: number; sz: number; nx: number; nh: number; nz: number; La: number; rw: number; rt: number; /** a lobe where a grown void begins keeps no protected core */ nocore?: boolean; /** the centre of the lobe before it on its shoot (or of the body it leaves): the protected core runs from there */ prev?: [number, number, number] }
/** Tissue wear that opens the mass: through-porosity (anisotropic, domain-warped noise) and shallow pockets on undersides. */
export type Poro = {
  t0: number
  through?: { thr: number; depth: number; f: number; ay: number; minH: number }
  under?: { thr: number; depth: number; f: number }
  soil: number
}
/** A node of a growth path: its position (x, z, h above the ground), its girth r, its width factor w along its side axis (sx, sh, sz). */
export type PathNode = { x: number; h: number; z: number; r: number; w: number; sx: number; sh: number; sz: number }
export type Carve =
  | { kind: 'cyl'; role: 'portal' | 'gap'; c: V3; ax: V3; L: number; ww: number; hh: number; t0: number; span: number; k: number }
  | { kind: 'ell'; role: 'chamber' | 'pit' | 'void' | 'recess'; c: V3; ax: V3; ay: V3; az: V3; r: V3; t0: number; span: number; k: number }
  | { kind: 'tube'; role: 'window' | 'passage'; a: V3; b: V3; rad: number; t0: number; span: number; k: number }
export type PorousPlan = {
  site: [number, number]
  y0: number
  cell: number
  prims: Prim[]
  carves: Carve[]
  skirt: number
  moisture: number
  ground: { x0: number; z0: number; nx: number; nz: number; h: Float32Array }
  poro?: Poro
  /** What the generator made, in metres and counts: the same numbers the compare view explains differences with. */
  measure: Record<string, number>
  stats: Record<string, number | string>
}

export const K = 2.2
export const NEAR = 3 * K + 1
export const INF = 1e9

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
export const hash3 = (x: number, y: number, z: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return n - Math.floor(n)
}
export function vnoise(x: number, y: number, z: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const fx = x - xi
  const fy = y - yi
  const fz = z - zi
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const sz = fz * fz * (3 - 2 * fz)
  const l = (a: number, b: number, t: number) => a + (b - a) * t
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), sx), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), sx), sy),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), sx), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), sx), sy),
    sz,
  )
}
const smax = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.max(a, b) + h * h * k * 0.25
}
export const norm3 = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
export const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

// ---- the field of one primitive: approximate distance (negative inside) and the age at which that tissue arrives ----
let ARR = 0
const growth = (p: Prim, age: number) => smooth(0, 1, (age - p.birth) / p.dur)

function primD(p: Prim, x: number, h: number, z: number, s: number, skirt: number): number {
  if (p.kind === 'blob') {
    const b = p.bl!
    const g = 0.5 + 0.5 * Math.pow(s, 0.7)
    const dx = x - p.cx
    const dh = h - p.hc
    const dz = z - p.cz
    const La = b.La * g
    const rw = b.rw * g
    const rt = b.rt * g
    const qx = (dx * b.tx + dh * b.th + dz * b.tz) / La
    const qy = (dx * b.sx + dz * b.sz) / rw
    const qz = (dx * b.nx + dh * b.nh + dz * b.nz) / rt
    const k0 = Math.hypot(qx, qy, qz)
    const k1 = Math.hypot(qx / La, qy / rw, qz / rt)
    ARR = p.birth + p.dur * clamp(k0)
    return k1 > 1e-6 ? (k0 * (k0 - 1)) / k1 : -Math.min(La, rw, rt)
  }
  if (p.kind === 'path') {
    // One ribbon of tissue along a path: a single distance (no joints), its cross-section stretched along each node's side axis,
    // growing out from the first node, thickening behind the tip.
    const N = p.nodes!
    const n = N.length
    const tip = s * (n - 1)
    const lastSeg = Math.min(n - 2, Math.floor(tip))
    let best = 1e9
    let arr = 0
    for (let i = 0; i <= lastSeg; i += 1) {
      const A = N[i]!
      const B = N[i + 1]!
      const f = i === lastSeg ? clamp(tip - i, 0.0001, 1) : 1
      const bx = A.x + (B.x - A.x) * f
      const bh = A.h + (B.h - A.h) * f
      const bz = A.z + (B.z - A.z) * f
      const ex = bx - A.x
      const eh = bh - A.h
      const ez = bz - A.z
      const reach = Math.max(A.r * A.w, B.r * B.w) + 4
      const half = Math.hypot(ex, eh, ez) / 2
      if (Math.abs(x - A.x - ex / 2) > half + reach || Math.abs(h - A.h - eh / 2) > half + reach || Math.abs(z - A.z - ez / 2) > half + reach) continue
      const l2 = ex * ex + eh * eh + ez * ez
      const t = l2 > 1e-9 ? clamp(((x - A.x) * ex + (h - A.h) * eh + (z - A.z) * ez) / l2) : 0
      const ox = x - A.x - ex * t
      const oh = h - A.h - eh * t
      const oz = z - A.z - ez * t
      let sx = A.sx + (B.sx - A.sx) * t
      let sh = A.sh + (B.sh - A.sh) * t
      let sz = A.sz + (B.sz - A.sz) * t
      const sl = Math.hypot(sx, sh, sz) || 1
      sx /= sl
      sh /= sl
      sz /= sl
      const os = ox * sx + oh * sh + oz * sz
      const px = ox - os * sx
      const ph2 = oh - os * sh
      const pz = oz - os * sz
      const wd = A.w + (B.w - A.w) * t
      const thick = 0.45 + 0.55 * smooth(0, 3.5, tip - (i + t * f))
      const r = (A.r + (B.r - A.r) * t) * thick
      const d = Math.hypot(os / wd, Math.hypot(px, ph2, pz)) - r
      if (d < best) {
        best = d
        arr = (i + t * f) / (n - 1)
      }
    }
    ARR = p.birth + p.dur * arr
    return best
  }
  if (p.kind === 'rib') {
    // A buttress: a fat capsule from its foot (cx, hc, cz) toward its far end (ex, hb, ez), growing out from the foot.
    const bx = p.cx + (p.ex - p.cx) * s
    const bh = p.hc + (p.hb - p.hc) * s
    const bz = p.cz + (p.ez - p.cz) * s
    const abx = bx - p.cx
    const abh = bh - p.hc
    const abz = bz - p.cz
    const l2 = abx * abx + abh * abh + abz * abz
    const t = l2 > 1e-6 ? clamp(((x - p.cx) * abx + (h - p.hc) * abh + (z - p.cz) * abz) / l2) : 0
    const r = (p.a + (p.b - p.a) * t) * (0.5 + 0.5 * s)
    ARR = p.birth + p.dur * t
    return Math.hypot(x - p.cx - abx * t, h - p.hc - abh * t, z - p.cz - abz * t) - r
  }
  if (p.kind === 'tier') {
    // A layer of the column: a flat, possibly frilled ellipsoid, wide first and thick later.
    const g = 0.45 + 0.55 * Math.pow(s, 0.7)
    const hv = p.hv * Math.pow(s, 0.8)
    if (hv < 0.6) return 99
    const dx = x - p.cx
    const dz = z - p.cz
    const u = dx * p.sin + dz * p.cos
    const v = dx * p.cos - dz * p.sin
    const fr = 1 + p.frill * Math.cos(5 * Math.atan2(v, u) + p.ph)
    const ra = p.a * g * fr
    const rb = p.b * g * fr
    const qx = u / ra
    const qy = (h - p.hc) / hv
    const qz = v / rb
    const pw = 2 + 1.4 * p.flat
    const k0 = p.flat > 0.01 ? Math.pow(Math.pow(Math.hypot(qx, qz), pw) + Math.pow(Math.abs(qy), pw), 1 / pw) : Math.hypot(qx, qy, qz)
    const k1 = Math.hypot(qx / ra, qy / hv, qz / rb)
    ARR = p.birth + p.dur * clamp(0.5 * k0 + 0.2)
    return k1 > 1e-6 ? (k0 * (k0 - 1)) / k1 : -Math.min(ra, hv, rb)
  }
  if (p.kind === 'roof') {
    const ex = p.ex - p.cx
    const ez = p.ez - p.cz
    const len = Math.hypot(ex, ez)
    const ux = ex / len
    const uz = ez / len
    const half = 0.5 * len * s + 2 * s
    const mx = p.cx + ex * 0.5 * s
    const mz = p.cz + ez * 0.5 * s
    const dx = x - mx
    const dz = z - mz
    const u = dx * ux + dz * uz
    const v = -dx * uz + dz * ux
    const hv = p.hv * (0.5 + 0.5 * s)
    const bw = p.b * (0.5 + 0.5 * s)
    const qx = u / half
    const qy = (h - p.hc) / hv
    const qz = v / bw
    const k0 = Math.hypot(qx, qy, qz)
    const k1 = Math.hypot(qx / half, qy / hv, qz / bw)
    ARR = p.birth + p.dur * clamp(0.5 + 0.5 * qx)
    return k1 > 1e-6 ? (k0 * (k0 - 1)) / k1 : -Math.min(half, hv, bw)
  }
  const g = p.kind === 'apron' ? 0.86 + 0.14 * Math.pow(s, 0.7) : 0.5 + 0.5 * Math.pow(s, 0.7)
  let ra = p.a * g
  let rb = p.b * g
  let hv: number
  let hc: number
  let sh = 0
  let lx = 0
  let lz = 0
  if (p.kind === 'mass') {
    sh = p.h * Math.pow(s, 0.8)
    if (sh < 0.8) return 99
    hv = sh * 1.25
    hc = -0.25 * sh
    const t = clamp(h / sh, 0, 1.2) * (sh / p.h)
    lx = p.leanX * t
    lz = p.leanZ * t
    const sr = Math.max(0.28, 1 - p.taper * Math.pow(clamp(h / sh), 1.3))
    ra *= sr
    rb *= sr
  } else {
    hv = 4.4 * skirt
    hc = -1.5
  }
  const dx = x - p.cx - lx
  const dz = z - p.cz - lz
  const u = dx * p.sin + dz * p.cos
  const v = dx * p.cos - dz * p.sin
  const qx = u / ra
  const qy = (h - hc) / hv
  const qz = v / rb
  const pw = 2 + 1.4 * p.flat
  const k0 = p.flat > 0.01 ? Math.pow(Math.pow(Math.hypot(qx, qz), pw) + Math.pow(Math.abs(qy), pw), 1 / pw) : Math.hypot(qx, qy, qz)
  const k1 = Math.hypot(qx / ra, qy / hv, qz / rb)
  const hn = p.kind === 'mass' ? clamp(h / Math.max(1, sh)) : 0.2
  ARR = p.birth + p.dur * clamp(0.4 * k0 + 0.6 * hn)
  return k1 > 1e-6 ? (k0 * (k0 - 1)) / k1 : -Math.min(ra, hv, rb)
}

const NOISE_AMP = 2.6
const noiseAt = (x: number, h: number, z: number) => (vnoise(x * 0.075 + 11.3, h * 0.075, z * 0.075 - 4.1) - 0.5) * NOISE_AMP

function carveD(c: Carve, x: number, h: number, z: number, g: number): number {
  if (c.kind === 'cyl') {
    const dx = x - c.c[0]
    const dh = h - c.c[1]
    const dz = z - c.c[2]
    const t = dx * c.ax[0] + dz * c.ax[2]
    const du = -dx * c.ax[2] + dz * c.ax[0]
    const ww = c.ww * g
    const hh = c.hh * g
    const e = (Math.hypot(du / ww, dh / hh) - 1) * Math.min(ww, hh)
    return smax(e, Math.abs(t) - c.L, 1)
  }
  if (c.kind === 'tube') {
    const abx = c.b[0] - c.a[0]
    const aby = c.b[1] - c.a[1]
    const abz = c.b[2] - c.a[2]
    const apx = x - c.a[0]
    const apy = h - c.a[1]
    const apz = z - c.a[2]
    const t = clamp((apx * abx + apy * aby + apz * abz) / (abx * abx + aby * aby + abz * abz))
    return Math.hypot(apx - abx * t, apy - aby * t, apz - abz * t) - c.rad * g
  }
  const dx = x - c.c[0]
  const dh = h - c.c[1]
  const dz = z - c.c[2]
  const rx = c.r[0] * g
  const ry = c.r[1] * g
  const rz = c.r[2] * g
  const qx = (dx * c.ax[0] + dh * c.ax[1] + dz * c.ax[2]) / rx
  const qy = (dx * c.ay[0] + dh * c.ay[1] + dz * c.ay[2]) / ry
  const qz = (dx * c.az[0] + dh * c.az[1] + dz * c.az[2]) / rz
  return (Math.hypot(qx, qy, qz) - 1) * Math.min(rx, ry, rz)
}
const carveGrow = (c: Carve, age: number) => smooth(c.t0, c.t0 + c.span, age) * (c.role === 'pit' || c.role === 'chamber' || c.role === 'recess' ? 1 + 0.2 * clamp((age - 1) / 0.3) : 1)

export function growPorous(seed: number, site: [number, number], inputs: PorousInputs): PorousPlan {
  const rv = (a: number, b: number) => {
    const n = Math.sin(seed * 12.9898 + a * 78.233 + b * 37.719 + 1.7) * 43758.5453
    return n - Math.floor(n)
  }
  const y0 = landscapeHeight(site[0], site[1])
  const size = clamp(inputs.size, 0.55, 1.2)
  const light = clamp(inputs.light)
  const moist = clamp(inputs.moisture)
  const res = clamp(inputs.resource)
  const crowd = clamp(inputs.crowding)
  const ridgeP = Math.max(0, clamp(inputs.ridge, -1, 1))
  const hollowP = Math.max(0, -clamp(inputs.ridge, -1, 1))
  const near = inputs.waterDist === null ? 0 : 1 - smooth(25, 120, inputs.waterDist)

  // ---- adaptation: how the place changes the form (each is a multiplier on what the seed drew; none changes a draw) ----
  //  exposure (ridge): compact, low and reinforced: shorter and lower massifs, broader, a heavier skirt, smaller and fewer openings.
  //  sheltered hollow: taller and longer, larger protected chambers and openings, more windows.
  //  damp shore (water close): a broader grounded skirt, a longer form that aligns with the water and sends a low apron toward it.
  //  crowding: constrained across the spine, and the whole form shifts to the free side, with the crowded side lower.
  //  light: lean and a longer roof (shelf) toward the sun; shade makes the massifs a little taller.
  //  moisture: more and larger pits and a larger chamber. Soil and water supply (resource): broader, thicker massifs.
  const adaptation = {
    height: (1 - 0.42 * ridgeP) * (1 + 0.38 * hollowP) * (1 + 0.14 * (1 - light)) * (1 + 0.1 * crowd),
    length: (1 - 0.28 * ridgeP) * (1 + 0.22 * hollowP) * (1 - 0.24 * crowd) * (1 + 0.14 * near),
    width: (1 + 0.25 * ridgeP) * (1 - 0.3 * crowd) * (1 + 0.32 * near) * (0.9 + 0.2 * res),
    opening: (1 - 0.45 * ridgeP) * (1 + 0.55 * hollowP) * (1 + 0.2 * moist) * (1 - 0.12 * res),
    chamber: (1 - 0.45 * ridgeP) * (1 + 0.7 * hollowP) * (0.8 + 0.4 * moist),
    skirt: 1 + 1.1 * ridgeP + 1.2 * near + 0.2 * res,
    roof: 0.45 + 1.0 * light,
  }

  // ---- the spine and its massifs ----
  const phi0 = rv(1, 0) * Math.PI * 2
  let phi = phi0
  if (inputs.waterAzimuth !== null && near > 0) {
    let dlt = wrapPi(inputs.waterAzimuth - phi0)
    if (Math.abs(dlt) > Math.PI / 2) dlt -= Math.sign(dlt) * Math.PI
    phi = phi0 + dlt * 0.85 * near
  }
  const e1: [number, number] = [Math.sin(phi), Math.cos(phi)]
  const e2: [number, number] = [Math.cos(phi), -Math.sin(phi)]
  const nL = 4 + Math.floor(rv(1, 3) * 3)
  const dom = Math.floor(rv(1, 4) * nL)
  const gapAt = Math.floor(rv(1, 5) * (nL - 1))
  const hasRoof = rv(1, 6) < 0.8 - 0.3 * ridgeP
  const H0 = 31 * size * adaptation.height * (0.85 + 0.3 * rv(1, 7))
  const A: number[] = []
  const B: number[] = []
  const Hs: number[] = []
  const shapes: { taper: number; flat: number }[] = []
  for (let i = 0; i < nL; i += 1) {
    const d = i === dom ? 1.15 : 1
    // The profile of each massif: a tall one is a spire or a dome; the others are domes, spires, crests (long, narrow, flat-topped) or low shelves.
    const typ = rv(12, i)
    const kind = i === dom ? (typ < 0.55 ? 'spire' : 'dome') : typ < 0.28 ? 'dome' : typ < 0.52 ? 'spire' : typ < 0.78 ? 'crest' : 'shelf'
    const am = kind === 'crest' ? 1.35 : kind === 'spire' ? 0.85 : 1
    const bm = kind === 'crest' ? 0.75 : kind === 'spire' ? 0.8 : kind === 'shelf' ? 1.15 : 1
    const hm = kind === 'shelf' ? 0.55 : kind === 'spire' ? 1.1 : 1
    shapes.push({ taper: kind === 'spire' ? 0.3 : kind === 'crest' ? 0.2 : kind === 'dome' ? 0.12 : 0.08, flat: kind === 'spire' ? 0.1 : kind === 'crest' ? 0.8 : kind === 'shelf' ? 0.6 : 0 })
    A.push(9 * size * (0.8 + 0.5 * rv(2, i)) * (0.9 + 0.2 * res) * d * am)
    B.push(8.5 * size * (0.75 + 0.5 * rv(3, i)) * adaptation.width * d * bm)
    Hs.push((i === dom ? H0 : H0 * (0.34 + 0.42 * rv(4, i))) * hm)
  }
  const S: number[] = [0]
  for (let i = 0; i + 1 < nL; i += 1) {
    const sum = A[i]! + A[i + 1]!
    const f = hasRoof && i === gapAt ? Math.max(1.4, (1.5 + 0.25 * hollowP - 0.15 * ridgeP) * (0.8 + 0.2 * adaptation.length)) : Math.min(0.88, (0.55 + 0.2 * rv(5, i)) * adaptation.length)
    S.push(S[i]! + sum * f)
  }
  const sMean = (S[0]! + S[nL - 1]!) / 2
  const sLen = S[nL - 1]! - S[0]!
  const mAmp = (0.08 + 0.14 * rv(1, 1)) * sLen
  const mPh = rv(1, 2) * Math.PI * 2
  const crowdDir = rv(1, 8) * Math.PI * 2
  const freeX = Math.sin(crowdDir + Math.PI)
  const freeZ = Math.cos(crowdDir + Math.PI)
  const prims: Prim[] = []
  const centers: [number, number][] = []
  const bigDist = Math.max(1, ...S.map((s) => Math.abs(s - S[dom]!)))
  const empty = { ex: 0, ez: 0, hc: 0, hv: 0, taper: 0, flat: 0, hb: 0, frill: 0, ph: 0 }
  // The spine's sideways meander, never more than neighbours can bear: adjacent massifs always overlap across it.
  const W: number[] = []
  for (let i = 0; i < nL; i += 1) {
    let w = mAmp * Math.sin((2 * Math.PI * (S[i]! - S[0]!)) / Math.max(20, sLen) + mPh) + (rv(6, i) - 0.5) * 0.3 * B[i]!
    if (i > 0) {
      const lim = 0.4 * (B[i]! + B[i - 1]!)
      w = Math.max(W[i - 1]! - lim, Math.min(W[i - 1]! + lim, w))
    }
    W.push(w)
  }
  for (let i = 0; i < nL; i += 1) {
    const s = S[i]! - sMean
    const w = W[i]!
    const cx = e1[0] * s + e2[0] * w + freeX * 0.22 * sLen * crowd
    const cz = e1[1] * s + e2[1] * w + freeZ * 0.22 * sLen * crowd
    // The crowded side is lower and narrower.
    const side = (cx * -freeX + cz * -freeZ) / Math.max(10, sLen / 2)
    const press = 1 - 0.45 * crowd * clamp(side + 0.3)
    const h = Hs[i]! * press
    const rot = phi + (rv(6, i + 10) - 0.5) * 0.5
    const sigma = inputs.sunAzimuth + (rv(7, i + 10) - 0.5) * 0.8
    const mag = h * (0.06 + 0.3 * light) * (0.6 + 0.9 * rv(7, i)) * (i === dom ? 1.3 : 1)
    const birth = 0.03 + 0.4 * Math.pow(Math.abs(S[i]! - S[dom]!) / bigDist, 0.85)
    const dur = 0.5 + 0.1 * rv(8, i)
    centers.push([cx, cz])
    prims.push({ kind: 'mass', cx, cz, sin: Math.sin(rot), cos: Math.cos(rot), a: A[i]!, b: B[i]! * press, h, leanX: Math.sin(sigma) * mag, leanZ: Math.cos(sigma) * mag, birth, dur, ...empty, taper: shapes[i]!.taper, flat: shapes[i]!.flat })
    prims.push({ kind: 'apron', cx, cz, sin: Math.sin(rot), cos: Math.cos(rot), a: A[i]! * 1.3, b: B[i]! * press * 1.3, h: 0, leanX: 0, leanZ: 0, birth: Math.max(0.02, birth - 0.12), dur: 0.35, ...empty })
  }
  const massOf = (i: number) => prims[i * 2]!
  // A low apron toward the water, when there is some close.
  if (inputs.waterAzimuth !== null && near > 0.3) {
    let best = 0
    let bestDot = -9999
    for (let i = 0; i < nL; i += 1) {
      const dd = centers[i]![0] * Math.sin(inputs.waterAzimuth) + centers[i]![1] * Math.cos(inputs.waterAzimuth)
      if (dd > bestDot) {
        bestDot = dd
        best = i
      }
    }
    const m = massOf(best)
    const off = m.b + 5
    const wx = Math.sin(inputs.waterAzimuth)
    const wz = Math.cos(inputs.waterAzimuth)
    const rot = Math.atan2(wx, wz) + Math.PI / 2
    prims.push({ kind: 'mass', cx: m.cx + wx * off, cz: m.cz + wz * off, sin: Math.sin(rot), cos: Math.cos(rot), a: 9 * size * (0.8 + 0.5 * near), b: 6 * size, h: 4.2 * size, leanX: 0, leanZ: 0, birth: 0.25, dur: 0.5, ...empty })
    prims.push({ kind: 'apron', cx: m.cx + wx * off, cz: m.cz + wz * off, sin: Math.sin(rot), cos: Math.cos(rot), a: 12 * size, b: 8 * size, h: 0, leanX: 0, leanZ: 0, birth: 0.25, dur: 0.5, ...empty })
  }
  // The roof: grows out from the taller pier toward the other, over the gap, and a little past it toward the light.
  let roofSpan = 0
  let gapCut: Carve | null = null
  if (hasRoof) {
    const pi = massOf(gapAt)
    const pj = massOf(gapAt + 1)
    const from = pi.h >= pj.h ? pi : pj
    const to = from === pi ? pj : pi
    const minH = Math.min(pi.h, pj.h)
    const dx = to.cx - from.cx
    const dz = to.cz - from.cz
    const len = Math.hypot(dx, dz)
    const over = adaptation.roof * 0.14 * len
    const ex = to.cx + (dx / len) * over
    const ez = to.cz + (dz / len) * over
    const hc = 0.62 * minH + 1
    const hv = 0.16 * minH + 1.6
    const bw = 0.75 * Math.min(pi.b, pj.b) * (0.85 + 0.3 * adaptation.roof)
    const birth = Math.max(pi.birth, pj.birth) + 0.12
    prims.push({ kind: 'roof', cx: from.cx, cz: from.cz, sin: 0, cos: 1, a: 0, b: bw, h: 0, leanX: 0, leanZ: 0, birth, dur: 0.36, ex, ez, hc, hv, taper: 0, flat: 0, hb: 0, frill: 0, ph: 0 })
    roofSpan = Math.hypot(ex - from.cx, ez - from.cz)
    // Before the roof closes, a low plinth joins the two piers at the ground; the gap is opened through it later.
    prims.push({ kind: 'apron', cx: (pi.cx + pj.cx) / 2, cz: (pi.cz + pj.cz) / 2, sin: dx / len, cos: dz / len, a: len / 2 + 3, b: 0.85 * Math.min(pi.b, pj.b), h: 0, leanX: 0, leanZ: 0, birth: Math.max(pi.birth, pj.birth), dur: 0.3, ...empty })
    // The gap is opened under the roof, floor on the ground: the piers on either side are what holds it up.
    const gapW = Math.max(4, len - pi.a * 0.9 - pj.a * 0.9)
    const under = hc - hv - 0.6
    gapCut = { kind: 'cyl', role: 'gap', c: [(pi.cx + pj.cx) / 2, -0.6, (pi.cz + pj.cz) / 2], ax: norm3([e2[0], 0, e2[1]]), L: Math.max(pi.b, pj.b) + 8, ww: clamp(gapW * 0.55, 3, 11 * adaptation.opening), hh: Math.max(3.2, under + 0.6), t0: birth + 0.2, span: 0.25, k: 1.4 }
  }

  // ---- plan-time field at maturity, to place things on the real surface ----
  const fieldFull = (x: number, h: number, z: number) => {
    let sum = 0
    for (const p of prims) {
      let d = primD(p, x, h, z, 1, adaptation.skirt)
      if (d < 8) d += noiseAt(x, h, z)
      sum += Math.exp(-d / K)
    }
    return sum > 1e-9 ? -K * Math.log(sum) : 8
  }
  const topAt = (x: number, z: number) => {
    for (let h = 70; h > 0; h -= 0.6) if (fieldFull(x, h, z) < 0) return h
    return 0
  }
  const cast = (o: V3, d: V3, max: number, inside: boolean) => {
    for (let t = 0; t < max; t += 0.7) if ((fieldFull(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t) < 0) === inside) return t
    return -1
  }
  const normalAt = (p: V3): V3 => {
    const e = 0.9
    return norm3([fieldFull(p[0] + e, p[1], p[2]) - fieldFull(p[0] - e, p[1], p[2]), fieldFull(p[0], p[1] + e, p[2]) - fieldFull(p[0], p[1] - e, p[2]), fieldFull(p[0], p[1], p[2] + e) - fieldFull(p[0], p[1], p[2] - e)])
  }

  const carves: Carve[] = []
  if (gapCut) carves.push(gapCut)
  // Portals: bored across the mass, skewed from the spine's perpendicular, the second sometimes raised.
  const portals: { c: V3; ax: V3; L: number; ww: number; hh: number; ch: number }[] = []
  const wantPortals = hasRoof ? 1 + (rv(9, 6) < 0.6 ? 1 : 0) : 2
  const portalLobes = [dom, (dom + 1 + Math.floor(rv(9, 0) * (nL - 1))) % nL]
  const dm = massOf(dom)
  const topDom = topAt(dm.cx, dm.cz)
  // The chamber's centre is fixed first: the first portal is bored through it, so the two are one connected space.
  const chamberC: V3 = [dm.cx + e1[0] * (rv(10, 20) - 0.5) * 0.3 * dm.a, 0.28 * topDom, dm.cz + e1[1] * (rv(10, 20) - 0.5) * 0.3 * dm.a]
  for (let p = 0; p < wantPortals; p += 1) {
    const m = massOf(portalLobes[p]!)
    const off = (rv(9, 1 + p) - 0.5) * 0.4 * m.a
    const cx = p === 0 ? chamberC[0] : m.cx + e1[0] * off
    const cz = p === 0 ? chamberC[2] : m.cz + e1[1] * off
    const yaw = (rv(9, 3 + p) - 0.5) * 1.0
    const ax = norm3([e2[0] * Math.cos(yaw) + e1[0] * Math.sin(yaw), 0, e2[1] * Math.cos(yaw) + e1[1] * Math.sin(yaw)])
    const top = topAt(cx, cz)
    if (top < 8) continue
    const start: V3 = [cx, 0.3 * top, cz]
    if (fieldFull(...start) > 0) continue
    const tp = cast(start, ax, 70, false)
    const tn = cast(start, [-ax[0], 0, -ax[2]], 70, false)
    if (tp < 0 || tn < 0) continue
    let hh = Math.min(adaptation.opening * (7 + 6 * rv(9, 8 + p)) * size, 0.56 * top + 0.6)
    let ww = clamp(hh / (1.25 + 0.6 * rv(9, 10 + p)), 2.4, 8.5 * adaptation.opening * size)
    // Fit the opening to the mass around it: solid must remain on both sides along the spine and in a roof above it, so it can
    // never cut a massif in two (a larger opening is only as large as the massif can bear).
    for (let tries = 0; tries < 9; tries += 1) {
      const sp: V3 = [e1[0] * (ww + 3), 0, e1[1] * (ww + 3)]
      const hs = [0.25 * hh, 0.6 * hh]
      const solid = hs.every((hq) => fieldFull(cx + sp[0], hq, cz + sp[2]) < -1.2 && fieldFull(cx - sp[0], hq, cz - sp[2]) < -1.2) && fieldFull(cx, hh + 3, cz) < -0.5
      if (solid) break
      ww *= 0.88
      hh *= 0.92
    }
    if (ww < 2.2) continue
    const raise = p === 1 && rv(9, 12) < 0.5 ? 0.35 * hh : 0
    const L = (tp + tn) / 2 + 2.5
    const shift = (tp - tn) / 2
    const c: V3 = [cx + ax[0] * shift, -0.6 + raise, cz + ax[2] * shift]
    carves.push({ kind: 'cyl', role: 'portal', c, ax, L, ww, hh, t0: 0.34 + 0.28 * rv(9, 14 + p), span: 0.35, k: 1.4 })
    portals.push({ c, ax, L, ww, hh, ch: -0.6 + raise })
  }
  // The chamber inside the tallest massif, lit by windows through its end walls.
  let chamberVol = 0
  let windows = 0
  if (portals.length > 0) {
    const ra = Math.min(0.5 * dm.a * adaptation.chamber, 0.64 * dm.a)
    const rh = clamp(0.19 * topDom * Math.pow(adaptation.chamber, 0.7), 2.2, 0.27 * topDom)
    const rb = Math.min(0.5 * dm.b * Math.pow(adaptation.chamber, 0.5), 0.58 * dm.b)
    carves.push({ kind: 'ell', role: 'chamber', c: chamberC, ax: [e1[0], 0, e1[1]], ay: [0, 1, 0], az: [e2[0], 0, e2[1]], r: [ra, rh, rb], t0: 0.6 + 0.1 * rv(10, 21), span: 0.3, k: 1.6 })
    chamberVol = (4 / 3) * Math.PI * ra * rh * rb
    const nW = Math.round(clamp(2 + 2 * hollowP - 1.5 * ridgeP + rv(10, 9) * 2, 1, 5))
    for (let k = 0; k < nW; k += 1) {
      const th = phi + (k % 2) * Math.PI + (rv(10, k) - 0.5) * 1.1 + (k >= 2 ? (k % 2 ? 0.7 : -0.7) : 0)
      const dir = norm3([Math.sin(th), 0.08 + 0.25 * rv(10, k + 40), Math.cos(th)])
      const o: V3 = [chamberC[0], chamberC[1] + (rv(10, k + 50) - 0.4) * rh * 0.7, chamberC[2]]
      const t = cast(o, dir, 40, false)
      if (t < 0 || t > ra + 14) continue
      const rad = Math.min((1.2 + 1.3 * rv(10, k + 4)) * size * (0.85 + 0.3 * hollowP + 0.2 * moist), 0.34 * rh + 1.2)
      carves.push({ kind: 'tube', role: 'window', a: o, b: [o[0] + dir[0] * (t + 3), o[1] + dir[1] * (t + 3), o[2] + dir[2] * (t + 3)], rad, t0: 0.66 + 0.04 * k, span: 0.25, k: 1.2 })
      windows += 1
    }
  }
  // Pits: a few mid-sized and many small, around the openings (the rims) and on the shaded side.
  const nPit = Math.round((8 + 12 * moist) * (0.8 + 0.4 * size))
  const shadeAz = inputs.sunAzimuth + Math.PI
  let pits = 0
  for (let q = 0; q < nPit; q += 1) {
    let o: V3
    let dir: V3
    if (rv(11, q) < 0.4 && portals.length > 0) {
      const pr = portals[Math.floor(rv(11, q + 30) * portals.length)]!
      const al = rv(11, q + 60) * Math.PI * 2
      const side = rv(11, q + 90) > 0.5 ? 1 : -1
      const lateral = pr.ww * (1.3 + 0.5 * rv(11, q + 120)) * Math.cos(al)
      const hgt = pr.ch + pr.hh * (0.9 + 0.5 * rv(11, q + 150)) * (0.4 + 0.6 * Math.abs(Math.sin(al)))
      const sv: V3 = [-pr.ax[2], 0, pr.ax[0]]
      o = [pr.c[0] + pr.ax[0] * side * (pr.L + 8) + sv[0] * lateral, hgt, pr.c[2] + pr.ax[2] * side * (pr.L + 8) + sv[2] * lateral]
      dir = [-pr.ax[0] * side, 0, -pr.ax[2] * side]
    } else {
      const m = massOf(Math.floor(rv(11, q + 180) * nL))
      const th = shadeAz + (rv(11, q + 210) + rv(11, q + 240) - 1) * 2.2
      const dH: V3 = [Math.sin(th), 0, Math.cos(th)]
      o = [m.cx + dH[0] * (Math.max(m.a, m.b) + 8), (0.2 + 0.6 * rv(11, q + 270)) * m.h, m.cz + dH[2] * (Math.max(m.a, m.b) + 8)]
      dir = [-dH[0], 0, -dH[2]]
    }
    const t = cast(o, dir, 60, true)
    if (t < 0) continue
    const sp: V3 = [o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t]
    if (sp[1] < 2.5) continue
    const n = normalAt(sp)
    const r = Math.min((1.1 + 2 * Math.pow(rv(11, q + 300), 1.8)) * size * (0.8 + 0.4 * moist), 3.4)
    const c: V3 = [sp[0] - n[0] * 0.2 * r, sp[1] - n[1] * 0.2 * r, sp[2] - n[2] * 0.2 * r]
    const du = n[1]
    let ay = norm3([-n[0] * du, 1 - n[1] * du, -n[2] * du])
    if (Math.abs(du) > 0.95) ay = norm3(cross3(n, [1, 0, 0]))
    carves.push({ kind: 'ell', role: 'pit', c, ax: norm3(cross3(ay, n)), ay, az: n, r: [r, r * 1.4, r * 1.05], t0: clamp(0.42 + 0.5 * rv(11, q + 330), 0, 1), span: 0.28, k: 1 })
    pits += 1
  }

  // ---- ground under the whole formation: the terrain's own height on the grid the meshes use ----
  const cell = 1.0 * clamp(size, 0.75, 1.2)
  let lox = INF
  let hix = -INF
  let loz = INF
  let hiz = -INF
  for (const p of prims) {
    const r = Math.max(p.a, p.b) * 1.4 + Math.hypot(p.leanX, p.leanZ) + (p.kind === 'roof' ? Math.hypot(p.ex - p.cx, p.ez - p.cz) : 0) + NEAR + 4
    lox = Math.min(lox, p.cx - r)
    hix = Math.max(hix, p.cx + r)
    loz = Math.min(loz, p.cz - r)
    hiz = Math.max(hiz, p.cz + r)
  }
  const nx = Math.ceil((hix - lox) / cell) + 1
  const nz = Math.ceil((hiz - loz) / cell) + 1
  const gh = new Float32Array(nx * nz)
  for (let k = 0; k < nz; k += 1) for (let i = 0; i < nx; i += 1) gh[k * nx + i] = landscapeHeight(site[0] + lox + i * cell, site[1] + loz + k * cell)

  // ---- measures: the generator's own numbers ----
  const proj1 = (cx: number, cz: number) => cx * e1[0] + cz * e1[1]
  const proj2 = (cx: number, cz: number) => cx * e2[0] + cz * e2[1]
  const masses = prims.filter((p) => p.kind === 'mass')
  const lenLo = Math.min(...masses.map((p) => proj1(p.cx, p.cz) - p.a))
  const lenHi = Math.max(...masses.map((p) => proj1(p.cx, p.cz) + p.a))
  const widLo = Math.min(...masses.map((p) => proj2(p.cx, p.cz) - p.b))
  const widHi = Math.max(...masses.map((p) => proj2(p.cx, p.cz) + p.b))
  const largeOpenings = carves.filter((c) => c.kind === 'cyl')
  let openW = 0
  let openH = 0
  let openArea = 0
  for (const c of largeOpenings) {
    if (c.kind !== 'cyl') continue
    const w = 2 * c.ww
    const hgt = c.hh + c.c[1]
    openArea += (Math.PI * c.ww * c.hh) / 2
    if (w * hgt > openW * openH) {
      openW = w
      openH = hgt
    }
  }
  const measure: Record<string, number> = {
    length: Math.round(lenHi - lenLo),
    width: Math.round(widHi - widLo),
    height: Math.round(Math.max(...masses.map((p) => p.h))),
    massifs: nL,
    openings: largeOpenings.length,
    openingWidth: Math.round(openW * 10) / 10,
    openingHeight: Math.round(openH * 10) / 10,
    openingArea: Math.round(openArea),
    chamber: Math.round(chamberVol),
    windows,
    pits,
    skirt: Math.round(adaptation.skirt * 100) / 100,
    spineAzimuth: Math.round(((((phi * 180) / Math.PI) % 180) + 180) % 180),
    roof: Math.round(roofSpan),
  }
  const stats: Record<string, number | string> = { height: measure.height!, openings: `${largeOpenings.length} large, ${windows} windows, ${pits} pits`, massifs: `${nL}${hasRoof ? ', bridged' : ''}` }
  return { site, y0, cell, prims, carves, skirt: adaptation.skirt, moisture: moist, ground: { x0: lox, z0: loz, nx, nz, h: gh }, measure, stats }
}

// ----------------------------------------------------------------------------------------------------------------------

/** The surface of the organism at an age, with its growth record. */
export function porousMesh(plan: PorousPlan, age: number): BufferGeometry {
  const { cell, ground: G } = plan
  type Act = { p: Prim; s: number; lox: number; hix: number; loz: number; hiz: number; lo: number; hi: number }
  const acts: Act[] = []
  let hTop = 6
  for (const p of plan.prims) {
    const s = growth(p, age)
    if (s < 0.04) continue
    let cx: number
    let cz: number
    let r: number
    let lo = -6
    let hi: number
    if (p.kind === 'blob') {
      const b = p.bl!
      cx = p.cx
      cz = p.cz
      r = Math.max(b.La, b.rw, b.rt) + NEAR + 2 + (b.prev ? Math.hypot(b.prev[0] - p.cx, b.prev[1] - p.hc, b.prev[2] - p.cz) : 0)
      lo = p.hc - r
      hi = p.hc + r
    } else if (p.kind === 'path') {
      const N = p.nodes!
      const upto = Math.min(N.length - 1, Math.ceil(s * (N.length - 1)) + 1)
      let x0 = 1e9
      let x1 = -1e9
      let z0 = 1e9
      let z1 = -1e9
      let h0 = 1e9
      let h1 = -1e9
      for (let i = 0; i <= upto; i += 1) {
        const q = N[i]!
        const pad = q.r * q.w + NEAR + 2
        x0 = Math.min(x0, q.x - pad)
        x1 = Math.max(x1, q.x + pad)
        z0 = Math.min(z0, q.z - pad)
        z1 = Math.max(z1, q.z + pad)
        h0 = Math.min(h0, q.h - pad)
        h1 = Math.max(h1, q.h + pad)
      }
      cx = (x0 + x1) / 2
      cz = (z0 + z1) / 2
      r = Math.max(x1 - x0, z1 - z0) / 2
      lo = h0
      hi = h1
    } else if (p.kind === 'tier') {
      cx = p.cx
      cz = p.cz
      r = Math.max(p.a, p.b) * (1 + p.frill) + NEAR + 2
      lo = p.hc - p.hv - NEAR
      hi = p.hc + p.hv + NEAR
    } else if (p.kind === 'rib') {
      const bx = p.cx + (p.ex - p.cx) * s
      const bz = p.cz + (p.ez - p.cz) * s
      const bh = p.hc + (p.hb - p.hc) * s
      cx = (p.cx + bx) / 2
      cz = (p.cz + bz) / 2
      r = Math.hypot(bx - p.cx, bz - p.cz) / 2 + Math.max(p.a, p.b) + NEAR
      lo = Math.min(p.hc, bh) - Math.max(p.a, p.b) - NEAR
      hi = Math.max(p.hc, bh) + Math.max(p.a, p.b) + NEAR
    } else if (p.kind === 'roof') {
      const ex = p.ex - p.cx
      const ez = p.ez - p.cz
      cx = p.cx + ex * 0.5 * s
      cz = p.cz + ez * 0.5 * s
      r = 0.5 * Math.hypot(ex, ez) * s + 2 + p.b + NEAR
      lo = p.hc - p.hv - NEAR
      hi = p.hc + p.hv + NEAR
    } else {
      const g = p.kind === 'apron' ? 1 : 0.5 + 0.5 * Math.pow(s, 0.7)
      cx = p.cx
      cz = p.cz
      r = Math.max(p.a, p.b) * g * 1.02 + Math.hypot(p.leanX, p.leanZ) * 1.3 + NEAR + 2
      hi = p.kind === 'mass' ? p.h * Math.pow(s, 0.8) + NEAR + 2 : 9
    }
    hTop = Math.max(hTop, hi)
    acts.push({ p, s, lox: cx - r, hix: cx + r, loz: cz - r, hiz: cz + r, lo, hi })
  }
  let lox = INF
  let hix = -INF
  let loz = INF
  let hiz = -INF
  for (const a of acts) {
    lox = Math.min(lox, a.lox)
    hix = Math.max(hix, a.hix)
    loz = Math.min(loz, a.loz)
    hiz = Math.max(hiz, a.hiz)
  }
  const clampI = (v: number, n: number) => Math.max(0, Math.min(n - 1, v))
  const gi0 = clampI(Math.floor((lox - G.x0) / cell), G.nx)
  const gi1 = clampI(Math.ceil((hix - G.x0) / cell), G.nx)
  const gk0 = clampI(Math.floor((loz - G.z0) / cell), G.nz)
  const gk1 = clampI(Math.ceil((hiz - G.z0) / cell), G.nz)
  const nx = gi1 - gi0 + 1
  const nz = gk1 - gk0 + 1
  const oy = -4
  const ny = Math.ceil((hTop - oy) / cell) + 1
  const ox = G.x0 + gi0 * cell
  const oz = G.z0 + gk0 * cell
  const total = nx * ny * nz
  const Ssum = new Float32Array(total)
  const wsum = new Float32Array(total)
  // The core: a protected shaft along every grown shoot, which weathering may not remove (so supports and spines always stay).
  const core = new Float32Array(total).fill(INF)
  const idx = (i: number, j: number, k: number) => (k * ny + j) * nx + i

  for (const a of acts) {
    const i0 = clampI(Math.floor((a.lox - ox) / cell), nx)
    const i1 = clampI(Math.ceil((a.hix - ox) / cell), nx)
    const k0 = clampI(Math.floor((a.loz - oz) / cell), nz)
    const k1 = clampI(Math.ceil((a.hiz - oz) / cell), nz)
    const j0 = clampI(Math.floor((a.lo - oy) / cell), ny)
    const j1 = clampI(Math.ceil((a.hi - oy) / cell), ny)
    for (let k = k0; k <= k1; k += 1) {
      const z = oz + k * cell
      for (let j = j0; j <= j1; j += 1) {
        const h = oy + j * cell
        for (let i = i0; i <= i1; i += 1) {
          const x = ox + i * cell
          let d = primD(a.p, x, h, z, a.s, plan.skirt)
          if (d > NEAR) continue
          if (d < 8 && a.p.kind !== 'apron') d += noiseAt(x, h, z)
          const w = Math.exp(-d / K)
          const id = idx(i, j, k)
          if (a.p.kind === 'blob' && !a.p.bl!.nocore) {
            const bl = a.p.bl!
            let cd: number
            if (bl.prev) {
              const ex = bl.prev[0] - a.p.cx
              const eh = bl.prev[1] - a.p.hc
              const ez = bl.prev[2] - a.p.cz
              const l2 = ex * ex + eh * eh + ez * ez
              const tt = l2 > 1e-6 ? clamp(((x - a.p.cx) * ex + (h - a.p.hc) * eh + (z - a.p.cz) * ez) / l2) : 0
              cd = Math.hypot(x - a.p.cx - ex * tt, h - a.p.hc - eh * tt, z - a.p.cz - ez * tt) - 0.25 * Math.min(bl.rw, bl.rt)
            } else cd = Math.hypot(x - a.p.cx, h - a.p.hc, z - a.p.cz) - 0.25 * Math.min(bl.rw, bl.rt)
            if (cd < core[id]!) core[id] = cd
          }
          Ssum[id] = Ssum[id]! + w
          wsum[id] = wsum[id]! + w * ARR
        }
      }
    }
  }

  const d = new Float32Array(total)
  const d0 = new Float32Array(total)
  const birth = new Float32Array(total)
  for (let id = 0; id < total; id += 1) {
    const sm = Ssum[id]!
    if (sm > 1e-9) {
      d[id] = Math.min(8, -K * Math.log(sm))
      birth[id] = wsum[id]! / sm
    } else d[id] = 8
    d0[id] = d[id]!
  }
  // Openings, as old tissue weathers: each grows from nothing; a smooth subtraction keeps rims round.
  let carved = 0
  for (const c of plan.carves) {
    const g = carveGrow(c, age)
    const minR = c.kind === 'cyl' ? Math.min(c.ww, c.hh) : c.kind === 'tube' ? c.rad : Math.min(...c.r)
    if (g * minR < 0.7) continue
    carved += 1
    let cx: number
    let ch: number
    let cz: number
    let reach: number
    if (c.kind === 'cyl') {
      cx = c.c[0]
      ch = c.c[1]
      cz = c.c[2]
      reach = c.L + Math.max(c.ww, c.hh) * g + c.k + 2
    } else if (c.kind === 'tube') {
      cx = (c.a[0] + c.b[0]) / 2
      ch = (c.a[1] + c.b[1]) / 2
      cz = (c.a[2] + c.b[2]) / 2
      reach = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]) / 2 + c.rad * g + c.k + 2
    } else {
      cx = c.c[0]
      ch = c.c[1]
      cz = c.c[2]
      reach = Math.max(...c.r) * g + c.k + 2
    }
    const i0 = clampI(Math.floor((cx - reach - ox) / cell), nx)
    const i1 = clampI(Math.ceil((cx + reach - ox) / cell), nx)
    const j0 = clampI(Math.floor((ch - reach - oy) / cell), ny)
    const j1 = clampI(Math.ceil((ch + reach - oy) / cell), ny)
    const k0 = clampI(Math.floor((cz - reach - oz) / cell), nz)
    const k1 = clampI(Math.ceil((cz + reach - oz) / cell), nz)
    for (let k = k0; k <= k1; k += 1) {
      for (let j = j0; j <= j1; j += 1) {
        for (let i = i0; i <= i1; i += 1) {
          const dc = carveD(c, ox + i * cell, oy + j * cell, oz + k * cell, g)
          const id = idx(i, j, k)
          d[id] = smax(d[id]!, -dc, c.k)
        }
      }
    }
  }
  // Grown voids may not sever a shoot: its core stays.
  if (plan.carves.length > 0 && plan.poro) for (let id = 0; id < total; id += 1) if (core[id]! < 0 && d[id]! > core[id]!) d[id] = core[id]!
  // Wear: the tissue opens where weathering is strong and wears through (anisotropic, domain-warped noise: irregular, connected openings
  // of every size, not placed holes), and on the shaded undersides as shallow pockets; never in the shoots' cores, and not at the ground.
  const po = plan.poro
  if (po) {
    const amt = smooth(po.t0, po.t0 + 0.5, age) * (1 + 0.1 * clamp((age - 1) / 0.3))
    if (amt > 0.02) {
      const d1 = Float32Array.from(d)
      const T = po.through
      const U = po.under
      for (let k = 1; k < nz - 1; k += 1) {
        const z = oz + k * cell
        for (let j = 1; j < ny - 1; j += 1) {
          const h = oy + j * cell
          for (let i = 1; i < nx - 1; i += 1) {
            const id = idx(i, j, k)
            const dd = d1[id]!
            if (dd > 1.2) continue
            const x = ox + i * cell
            if (T && h > T.minH + 3 * (vnoise(x * 0.15, 0, z * 0.15) - 0.5)) {
              const wx = x + 6 * (vnoise(x * 0.04, h * 0.04, z * 0.04 + 3.1) - 0.5)
              const wz = z + 6 * (vnoise(x * 0.04 + 9, h * 0.04, z * 0.04) - 0.5)
              const wh = h + 4 * (vnoise(x * 0.05, h * 0.05 + 5, z * 0.05) - 0.5)
              const n = 0.62 * vnoise(wx * T.f, wh * T.f * T.ay, wz * T.f) + 0.38 * vnoise(wx * T.f * 2.3 + 13, wh * T.f * T.ay * 2.3, wz * T.f * 2.3)
              const c = n - (T.thr + 0.2 * (1 - amt))
              if (c > 0) d[id] = smax(d[id]!, c * T.depth, 1.6)
            }
            if (U && dd > -4) {
              const ny = d1[id + nx]! - d1[id - nx]!
              if (ny < -0.55) {
                const n = 0.6 * vnoise(x * U.f, h * U.f, z * U.f) + 0.4 * vnoise(x * U.f * 2.4 + 5, h * U.f * 2.4, z * U.f * 2.4)
                const c = n - (U.thr + 0.2 * (1 - amt))
                if (c > 0) d[id] = smax(d[id]!, c * U.depth, 1.2)
              }
            }
          }
        }
      }
      for (let id = 0; id < total; id += 1) if (core[id]! < 0 && d[id]! > core[id]!) d[id] = core[id]!
    }
  }
  // Nothing sealed: air that cannot reach the outside is solid.
  {
    const seen = new Uint8Array(total)
    const stack = new Int32Array(total)
    let top = 0
    const push = (id: number) => {
      if (!seen[id] && d[id]! > 0) {
        seen[id] = 1
        stack[top++] = id
      }
    }
    for (let k = 0; k < nz; k += 1) for (let i = 0; i < nx; i += 1) push(idx(i, ny - 1, k))
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        push(idx(i, j, 0))
        push(idx(i, j, nz - 1))
      }
      for (let k = 0; k < nz; k += 1) {
        push(idx(0, j, k))
        push(idx(nx - 1, j, k))
      }
    }
    while (top > 0) {
      const id = stack[--top]!
      const i = id % nx
      const j = Math.floor(id / nx) % ny
      const k = Math.floor(id / (nx * ny))
      if (i > 0) push(id - 1)
      if (i < nx - 1) push(id + 1)
      if (j > 0) push(id - nx)
      if (j < ny - 1) push(id + nx)
      if (k > 0) push(id - nx * ny)
      if (k < nz - 1) push(id + nx * ny)
    }
    for (let id = 0; id < total; id += 1) if (d[id]! > 0 && !seen[id]) d[id] = -0.4
    // Nothing floating: bits of solid that are not part of the formation (slivers left by noise and carving) are dropped.
    const label = new Int32Array(total)
    const sizes: number[] = [0]
    for (let start = 0; start < total; start += 1) {
      if (d[start]! >= 0 || label[start]) continue
      const lab = sizes.length
      let count = 0
      top = 0
      stack[top++] = start
      label[start] = lab
      while (top > 0) {
        const id = stack[--top]!
        count += 1
        const i = id % nx
        const j = Math.floor(id / nx) % ny
        const k = Math.floor(id / (nx * ny))
        const visit = (n: number) => {
          if (!label[n] && d[n]! < 0) {
            label[n] = lab
            stack[top++] = n
          }
        }
        if (i > 0) visit(id - 1)
        if (i < nx - 1) visit(id + 1)
        if (j > 0) visit(id - nx)
        if (j < ny - 1) visit(id + nx)
        if (k > 0) visit(id - nx * ny)
        if (k < nz - 1) visit(id + nx * ny)
      }
      sizes.push(count)
    }
    const keep = Math.max(450, 0.06 * Math.max(...sizes))
    for (let id = 0; id < total; id += 1) if (label[id] && sizes[label[id]!]! < keep) d[id] = 0.6
  }

  const field = new Float32Array(total)
  for (let id = 0; id < total; id += 1) field[id] = -d[id]!
  const net = surfaceNets(field, nx, ny, nz, [0, 0, 0], 0)
  const count = net.positions.length / 3
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const colours = new Float32Array(count * 3)
  const recordA = new Float32Array(count * 4)
  const recordB = new Float32Array(count * 4)
  const arrival = new Float32Array(count)
  const decay = new Float32Array(count).fill(9)
  const sample = (f: Float32Array, gx: number, gy: number, gz: number) => {
    const x0 = clampI(Math.floor(gx), nx)
    const y0 = clampI(Math.floor(gy), ny)
    const z0 = clampI(Math.floor(gz), nz)
    const x1 = clampI(x0 + 1, nx)
    const y1 = clampI(y0 + 1, ny)
    const z1 = clampI(z0 + 1, nz)
    const fx = clamp(gx - x0)
    const fy = clamp(gy - y0)
    const fz = clamp(gz - z0)
    const at = (i: number, j: number, k: number) => f[idx(i, j, k)]!
    const l = (p: number, q: number, t: number) => p + (q - p) * t
    return l(l(l(at(x0, y0, z0), at(x1, y0, z0), fx), l(at(x0, y1, z0), at(x1, y1, z0), fx), fy), l(l(at(x0, y0, z1), at(x1, y0, z1), fx), l(at(x0, y1, z1), at(x1, y1, z1), fx), fy), fz)
  }
  const groundAt = (x: number, z: number) => {
    const fi = clamp((x - G.x0) / cell, 0, G.nx - 1.001)
    const fk = clamp((z - G.z0) / cell, 0, G.nz - 1.001)
    const i = Math.floor(fi)
    const k = Math.floor(fk)
    const tx = fi - i
    const tz = fk - k
    const a = G.h[k * G.nx + i]!
    const b = G.h[k * G.nx + i + 1]!
    const c = G.h[(k + 1) * G.nx + i]!
    const e = G.h[(k + 1) * G.nx + i + 1]!
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + e) * tx * tz
  }
  const wx = plan.site[0]
  const wz = plan.site[1]
  for (let v = 0; v < count; v += 1) {
    const gx = net.positions[v * 3]!
    const gy = net.positions[v * 3 + 1]!
    const gz = net.positions[v * 3 + 2]!
    const lx = ox + gx * cell
    const lh = oy + gy * cell
    const lz = oz + gz * cell
    positions[v * 3] = wx + lx
    positions[v * 3 + 1] = groundAt(lx, lz) + lh
    positions[v * 3 + 2] = wz + lz
    const nyv = net.normals[v * 3 + 1]!
    normals[v * 3] = net.normals[v * 3]!
    normals[v * 3 + 1] = nyv
    normals[v * 3 + 2] = net.normals[v * 3 + 2]!
    const b = sample(birth, gx, gy, gz)
    const wall = clamp(-sample(d0, gx, gy, gz) / 2.6)
    // Bone, chalk and mineral tones laid down in bands of arrival; darker and warmer inside what has eroded.
    const s = b * 5
    const kb = Math.floor(s)
    const fb = smooth(0.3, 0.7, s - kb)
    const c1 = PALETTE[PICK[Math.floor(hash3(kb, 1.7, 0.3) * PICK.length)]!]!
    const c2 = PALETTE[PICK[Math.floor(hash3(kb + 1, 1.7, 0.3) * PICK.length)]!]!
    const mott = 0.94 + 0.12 * (0.6 * vnoise(lx * 0.12, lh * 0.12, lz * 0.12) + 0.4 * vnoise(lx * 0.4, lh * 0.4, lz * 0.4))
    const up = 0.96 + 0.06 * nyv
    const low = 1 - 0.12 * (1 - smooth(0, 3, lh))
    const inner = smooth(0.3, 0.95, wall)
    // Where it meets the ground the tissue takes the soil's dust and damp, with an irregular edge.
    const contact = plan.poro ? (1 - smooth(0.4, 4, lh + 1.8 * (vnoise(lx * 0.28, lh * 0.2, lz * 0.28) - 0.5))) * plan.poro.soil : 0
    for (let c = 0; c < 3; c += 1) {
      const raw = (c1[c]! + (c2[c]! - c1[c]!) * fb) * mott * up * low
      const base = raw + (SOIL[c]! - raw) * contact
      colours[v * 3 + c] = base + (CAVITY[c]! * (0.85 + 0.3 * mott) - base) * inner * 0.8
    }
    recordA[v * 4] = clamp(b * 0.2)
    recordA[v * 4 + 1] = 0.88
    recordB[v * 4] = clamp(0.5 + 0.5 * Math.max(0, nyv)) * (1 - 0.85 * inner)
    recordB[v * 4 + 1] = clamp(1 - lh / 4) * 0.5 * plan.moisture
    recordB[v * 4 + 2] = hash3(kb, 4.1, 1.3)
    recordB[v * 4 + 3] = 0.15
    arrival[v] = b
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('color', new BufferAttribute(colours, 3))
  geometry.setAttribute('aGrowthA', new BufferAttribute(recordA, 4))
  geometry.setAttribute('aGrowthB', new BufferAttribute(recordB, 4))
  geometry.setAttribute('aArrival', new BufferAttribute(arrival, 1))
  geometry.setAttribute('aDecay', new BufferAttribute(decay, 1))
  geometry.setIndex(new BufferAttribute(new Uint32Array(net.indices), 1))
  geometry.boundingSphere = new Sphere(new Vector3(wx + ox + (nx * cell) / 2, plan.y0 + 12, wz + oz + (nz * cell) / 2), Math.hypot(nx, nz) * cell * 0.5 + 40)
  geometry.userData.carved = carved
  return geometry
}

/** Whites, chalks and mineral tones (linear): bone, chalk, warm grey, sand, cool slate, clay-grey. Not the geological colours. */
const PALETTE: V3[] = [
  [0.6, 0.585, 0.55],
  [0.64, 0.635, 0.62],
  [0.5, 0.49, 0.47],
  [0.58, 0.53, 0.43],
  [0.47, 0.49, 0.5],
  [0.57, 0.5, 0.46],
]
const PICK = [0, 0, 0, 1, 1, 2, 3, 4, 5]
const CAVITY: V3 = [0.32, 0.29, 0.26]
const SOIL: V3 = [0.3, 0.27, 0.22]

// ---- helpers the other growth direction shares ----

/** The same adaptation of form to place for both directions (see growPorous for the rules). */
export type Adaptation = { height: number; length: number; width: number; opening: number; chamber: number; skirt: number; roof: number }
export function adaptationOf(i: { light: number; moisture: number; resource: number; ridge: number; crowding: number; waterDist: number | null }): Adaptation & { near: number; ridgeP: number; hollowP: number } {
  const light = clamp(i.light)
  const moist = clamp(i.moisture)
  const res = clamp(i.resource)
  const crowd = clamp(i.crowding)
  const ridgeP = Math.max(0, clamp(i.ridge, -1, 1))
  const hollowP = Math.max(0, -clamp(i.ridge, -1, 1))
  const near = i.waterDist === null ? 0 : 1 - smooth(25, 120, i.waterDist)
  return {
    height: (1 - 0.42 * ridgeP) * (1 + 0.38 * hollowP) * (1 + 0.14 * (1 - light)) * (1 + 0.1 * crowd),
    length: (1 - 0.28 * ridgeP) * (1 + 0.22 * hollowP) * (1 - 0.24 * crowd) * (1 + 0.14 * near),
    width: (1 + 0.25 * ridgeP) * (1 - 0.3 * crowd) * (1 + 0.32 * near) * (0.9 + 0.2 * res),
    opening: (1 - 0.45 * ridgeP) * (1 + 0.55 * hollowP) * (1 + 0.2 * moist) * (1 - 0.12 * res),
    chamber: (1 - 0.45 * ridgeP) * (1 + 0.7 * hollowP) * (0.8 + 0.4 * moist),
    skirt: 1 + 1.1 * ridgeP + 1.2 * near + 0.2 * res,
    roof: 0.45 + 1.0 * light,
    near,
    ridgeP,
    hollowP,
  }
}

/** Probes of the full-grown formation, to place voids and pits on its real surface. */
export function makeProbe(prims: Prim[], skirt: number) {
  const fieldFull = (x: number, h: number, z: number) => {
    let sum = 0
    for (const p of prims) {
      let d = primD(p, x, h, z, 1, skirt)
      if (d < 8) d += noiseAt(x, h, z)
      sum += Math.exp(-d / K)
    }
    return sum > 1e-9 ? -K * Math.log(sum) : 8
  }
  const cast = (o: V3, d: V3, max: number, inside: boolean) => {
    for (let t = 0; t < max; t += 0.7) if ((fieldFull(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t) < 0) === inside) return t
    return -1
  }
  const normalAt = (p: V3): V3 => {
    const e = 0.9
    return norm3([fieldFull(p[0] + e, p[1], p[2]) - fieldFull(p[0] - e, p[1], p[2]), fieldFull(p[0], p[1] + e, p[2]) - fieldFull(p[0], p[1] - e, p[2]), fieldFull(p[0], p[1], p[2] + e) - fieldFull(p[0], p[1], p[2] - e)])
  }
  return { fieldFull, cast, normalAt }
}

/** The terrain's own height on the grid the meshes use, over the formation's extent. */
export function groundGrid(site: [number, number], lox: number, hix: number, loz: number, hiz: number, cell: number): PorousPlan['ground'] {
  const nx = Math.ceil((hix - lox) / cell) + 1
  const nz = Math.ceil((hiz - loz) / cell) + 1
  const h = new Float32Array(nx * nz)
  for (let k = 0; k < nz; k += 1) for (let i = 0; i < nx; i += 1) h[k * nx + i] = landscapeHeight(site[0] + lox + i * cell, site[1] + loz + k * cell)
  return { x0: lox, z0: loz, nx, nz, h }
}
