import { smax, smin } from '../project03/livingOverhang.ts'
import type { DesignField, FieldBounds } from './fieldMesh.ts'

/**
 * The Strata family's field: Blade / Strata Refined (first designed in the Habitat Study) as a function of a plan. Every number that
 * shaped the reference form is a field of the plan; `REFERENCE_PLAN` holds the reference values, and `strataField(REFERENCE_PLAN)` is the
 * reference form exactly (the same arithmetic, in the same order). strataDesign.ts makes plans from controls and seeds.
 *
 * Design frame (reference size, metres): u along the blade (toward the light), w across it, y up from the ground at the centre.
 *   mass     a waisted mass leaning back from the light, its top falling toward the blade
 *   rings    thin interrupted ledge lines around the mass (they come and go around its outline)
 *   roof     the blade: a long leaf in plan, curving, rising toward its tip, creased, thinning to lips
 *   leg      a low arch out of the mass to a flared root foot, then a sweep up into the blade's underside
 *   shelves  lobed ledges grown from the mass (at ring heights) and from the leg
 */
export type V3 = [number, number, number]
export type StrataPlan = {
  mass: { uc0: number; lean: number; wc: number; rx: number; rz: number; hRef: number; top: number; topSlope: number; topBack: number; topK: number }
  /** height, phase, how far the ring grows out */
  rings: [number, number, number][]
  roof: {
    u0: number
    len: number
    back: number
    front: number
    swing: number
    hw: number
    hw0: number
    base: number
    rise: number
    bank: number
    qr0: number
    qr1: number
    steep: number
    gentle: number
    th: number
    thTip: number
    lip: number
    k: number
  }
  leg: { arch: [V3, V3, V3]; sweep: [V3, V3, V3]; r: [number, number, number]; foot: V3; footR: V3 }
  /** u0, w0, heading (degrees), length, half-width, top height, root thickness, lip, droop, lobe phase, smooth-union radius */
  shelves: [number, number, number, number, number, number, number, number, number, number, number][]
}

export const REFERENCE_PLAN: StrataPlan = {
  mass: { uc0: -40, lean: 0.18, wc: 2, rx: 16, rz: 14, hRef: 40, top: 41, topSlope: 0.16, topBack: 16, topK: 5 },
  rings: [
    [10.5, 0.7, 3.2],
    [19.5, 2.1, 3.6],
    [27.5, 4.4, 3.0],
  ],
  roof: { u0: -40, len: 104, back: -46, front: 64, swing: -8, hw: 18, hw0: 3, base: 36.5, rise: 4, bank: 0.1, qr0: 0.15, qr1: -0.45, steep: 0.42, gentle: 0.12, th: 9, thTip: 2.6, lip: 2.2, k: 9 },
  leg: {
    arch: [
      [-24, 12, 6],
      [-8, 10, 10],
      [4, -1, 10],
    ],
    sweep: [
      [4, -1, 10],
      [24, 4, 8],
      [36, 33.5, 0],
    ],
    r: [4.2, 5.6, 2.4],
    foot: [4, -1, 10],
    footR: [9, 2.4, 7.5],
  },
  shelves: [
    [-27, -6, -20, 38, 17, 19.5, 4.6, 1.5, 1.6, 0.4, 4.5],
    [-29, 9, 18, 24, 12, 27.5, 3.8, 1.5, 1, 2.2, 4],
    [19, 7, 158, 28, 13, 12, 4, 1.5, 1.2, 4.1, 4],
  ],
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
/** Approximate distance to an ellipse in plan (good enough for meshing: the sign is exact, the gradient close). */
export const ellipse = (a: number, b: number, ra: number, rb: number) => (Math.hypot(a / ra, b / rb) - 1) * Math.min(ra, rb)
const smoothstep01 = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

// ------------------------------------------------------------------------------------------------------------- parts, as functions

/** The mass at height y: its centre in u, and its waist factor (the outline's radii are rx·f and rz·f). */
export function massAt(m: StrataPlan['mass'], y: number): { uc: number; f: number } {
  const t = clamp01(y / m.hRef)
  const f = 0.86 + 0.16 * t * t + 0.35 * Math.exp(-Math.max(y, 0) / 4)
  return { uc: m.uc0 - m.lean * y, f }
}
/** The blade at a point: its centreline, half-width, top and thickness there (s along it, 0 at u0 to 1 at its tip). */
export function roofAt(r: StrataPlan['roof'], u: number, w: number): { s: number; wc: number; hw: number; top: number; th: number } {
  const s = clamp01((u - r.u0) / r.len)
  const wc = r.swing * Math.sin(Math.PI * s * 0.9)
  const hw = r.hw * Math.pow(Math.max(0, 1 - Math.pow(s, 2.2)), 0.5) + r.hw0
  const q = Math.max(-1.2, Math.min(1.2, (w - wc) / hw))
  const qr = r.qr0 + r.qr1 * s
  const fall = q > qr ? r.steep * (q - qr) : r.gentle * (qr - q)
  const top = r.base + r.rise * s * s + r.bank * s * (wc - w) - fall * hw
  const thR = r.th * Math.pow(1 - s, 1.6) + r.thTip
  const dq = Math.min(1, q > qr ? (q - qr) / (1 - qr) : (qr - q) / (1 + qr))
  const th = r.lip + (thR - r.lip) * Math.pow(1 - dq * dq, 0.8)
  return { s, wc, hw, top, th }
}
/** A point on a quadratic curve. */
export const bez = (P0: V3, P1: V3, P2: V3, t: number): V3 => {
  const a = (1 - t) * (1 - t)
  const b = 2 * t * (1 - t)
  const c = t * t
  return [a * P0[0] + b * P1[0] + c * P2[0], a * P0[1] + b * P1[1] + c * P2[1], a * P0[2] + b * P1[2] + c * P2[2]]
}

/**
 * A grown ledge: rooted in a mass (or a limb) at (u0, w0), reaching along a heading (given as its cosine and sine). Its plan is lobed (its
 * rim's radius is modulated around it, so it bulges and bites); it is thickest at the root, thins to a crisp lip, and a fillet joins it to
 * what it grew from.
 */
function grownLedge(u: number, w: number, y: number, u0: number, w0: number, ca: number, sa: number, L: number, H: number, y0: number, root: number, lip: number, droop: number, phase: number): number {
  const a = (u - u0) * ca + (w - w0) * sa
  const b = -(u - u0) * sa + (w - w0) * ca
  // Polar about a point a little out from the root: the lobes are measured around it.
  const cx = L * 0.42
  const pa = (a - cx) / (L * 0.58)
  const pb = b / H
  const th = Math.atan2(pb, pa)
  // Three broad lobes and one bite; only a faint finer ripple (a strong one reads as gear teeth from above).
  const R = 1 + 0.26 * Math.sin(3 * th + phase) + 0.045 * Math.sin(7 * th + phase * 2.3) - 0.22 * Math.pow(Math.max(0, Math.cos(th - 0.6 - phase)), 3)
  const rho = Math.hypot(pa, pb)
  const plan = Math.max((rho - R) * Math.min(L * 0.58, H), -(a + 6))
  const s = clamp01(a / L)
  const edge = clamp01(rho / R)
  // The lip's thickness wanders a little along the rim, so the edge is not a machined line.
  const thick = (lip + (root - lip) * Math.pow(1 - Math.max(s, edge * edge), 1.3)) * (0.85 + 0.3 * (0.5 + 0.5 * Math.sin(5 * th + phase * 3.1)))
  const top = y0 - droop * s * s
  return Math.max(plan, Math.max(top - thick - y, y - top))
}

// ------------------------------------------------------------------------------------------------------------- the field

type Shelf = [number, number, number, number, number, number, number, number, number, number, number, number, number, number]
/** A lower bound of grownLedge's value: its lobed radius is at most 1.305, its thickness at most 1.15 × root, its top between y0 − droop and y0. */
function ledgeLB(u: number, w: number, y: number, L: Shelf): number {
  const a = (u - L[0]) * L[10] + (w - L[1]) * L[11]
  const b = -(u - L[0]) * L[11] + (w - L[1]) * L[10]
  const rho = Math.hypot((a - L[3] * 0.42) / (L[3] * 0.58), b / L[4])
  return Math.max((rho - 1.305) * L[12], -(a + 6), y - L[5], L[5] - L[8] - 1.15 * L[6] - y)
}
type Curve = { c: V3; r: number }
/** The sphere around a curve's control points (which contains the curve). */
const sphereOf = (p0: V3, p1: V3, p2: V3): Curve => {
  const c: V3 = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3]
  const r = Math.max(...[p0, p1, p2].map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])))
  return { c, r }
}
const sphereLB = (P: V3, C: Curve, pad: number) => Math.hypot(P[0] - C.c[0], P[1] - C.c[1], P[2] - C.c[2]) - C.r - pad
/** A limb's segments along a quadratic curve, computed once: start, direction, its squared length, and the two radii. */
function limbSegs(P0: V3, P1: V3, P2: V3, r0: number, r1: number, n: number): Float64Array {
  const out = new Float64Array(n * 9)
  for (let k = 0; k < n; k += 1) {
    const t0 = k / n
    const t1 = (k + 1) / n
    const a = bez(P0, P1, P2, t0)
    const b = bez(P0, P1, P2, t1)
    const ba0 = b[0] - a[0]
    const ba1 = b[1] - a[1]
    const ba2 = b[2] - a[2]
    out.set([a[0], a[1], a[2], ba0, ba1, ba2, ba0 * ba0 + ba1 * ba1 + ba2 * ba2, r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1], k * 9)
  }
  return out
}
/** A tapering capsule chain (smooth-unioned, k 1.2), as `capsule` evaluates each segment, without allocating. */
function limb(p0: number, p1: number, p2: number, S: Float64Array): number {
  let d = Infinity
  for (let o = 0; o < S.length; o += 9) {
    const pa0 = p0 - S[o]!
    const pa1 = p1 - S[o + 1]!
    const pa2 = p2 - S[o + 2]!
    const ba0 = S[o + 3]!
    const ba1 = S[o + 4]!
    const ba2 = S[o + 5]!
    const t = Math.min(1, Math.max(0, (pa0 * ba0 + pa1 * ba1 + pa2 * ba2) / S[o + 6]!))
    const ra = S[o + 7]!
    const seg = Math.hypot(pa0 - ba0 * t, pa1 - ba1 * t, pa2 - ba2 * t) - (ra + (S[o + 8]! - ra) * t)
    d = d === Infinity ? seg : smin(d, seg, 1.2)
  }
  return d
}
/** Development: turn the exact early-outs off, to check that the field is unchanged with them. */
let BOUNDED = true
export function setFieldBounds(on: boolean) {
  BOUNDED = on
}

/** The plan's field, design metres in and out. The plan's parts are prepared once (segments, bounds, headings). */
export function strataField(plan: StrataPlan): DesignField {
  const M = plan.mass
  const Rf = plan.roof
  const G = plan.leg
  const rings = plan.rings
  const ARCH_SEGS = limbSegs(G.arch[0], G.arch[1], G.arch[2], G.r[0], G.r[1], 8)
  const SWEEP_SEGS = limbSegs(G.sweep[0], G.sweep[1], G.sweep[2], G.r[1], G.r[2], 10)
  const ARCH = sphereOf(G.arch[0], G.arch[1], G.arch[2])
  const SWEEP = sphereOf(G.sweep[0], G.sweep[1], G.sweep[2])
  const archPad = Math.max(G.r[0], G.r[1]) + 8 * 0.3
  const sweepPad = Math.max(G.r[1], G.r[2]) + 10 * 0.3
  const [fx, fy, fz] = G.foot
  const [frx, fry, frz] = G.footR
  const SHELVES: Shelf[] = plan.shelves.map(([u0, w0, deg, L, H, y0, root, lip, droop, phase, k]) => [
    u0, w0, deg, L, H, y0, root, lip, droop, phase, Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180), Math.min(L * 0.58, H), k,
  ])
  return (u, w, y) => {
    const m = massAt(M, y)
    let d = smax(ellipse(u - m.uc, w - M.wc, M.rx * m.f, M.rz * m.f), y - (M.top - M.topSlope * (u - m.uc + M.topBack)), M.topK)
    // Interrupted ledge lines: thin lips around the mass that appear only along runs of its outline (a noise around the angle).
    let ang = NaN
    for (const [h, ph, grow] of rings) {
      // Skip (exactly): the ledge's value is at least its vertical distance, and smin(d, x, k) is d whenever x ≥ d + k.
      if (BOUNDED && Math.max(h - 1.1 - y, y - h) >= d + 0.8) continue
      if (Number.isNaN(ang)) ang = Math.atan2(w - M.wc, u - m.uc)
      const run = smoothstep01(0.1, 0.5, Math.sin(ang * 2 + ph) * 0.6 + Math.sin(ang * 5 + ph * 1.7) * 0.4)
      if (run <= 0) continue
      const ring = ellipse(u - m.uc, w - M.wc, M.rx * m.f + grow * run, M.rz * m.f + grow * run)
      d = smin(d, Math.max(ring, Math.max(h - 1.1 - y, y - h)), 0.8)
    }
    // The roof: a long leaf, gently creased (the steep side away from the hero view), thin lips.
    const r = roofAt(Rf, u, w)
    const planD = Math.max(Math.abs(w - r.wc) - r.hw, -(u - Rf.back), u - Rf.front)
    d = smin(d, Math.max(planD, Math.max(r.top - r.th - y, y - r.top)), Rf.k)
    // The leg: a low arch out of the mass's flank, down to a flared root foot, then a long sweep up into the blade.
    const P: V3 = [u, y, w]
    const rootFoot = (Math.hypot((u - fx) / frx, (y - fy) / fry, (w - fz) / frz) - 1) * fry
    // Skip the whole leg (exactly) when a lower bound of its value is at least d + 8: each limb's value is at least the distance to the sphere
    // around its curve's control points, less its widest radius and what its smooth unions can take off (n × k/4); the leg's two unions
    // take off at most 0.75 + 1 more.
    const legLB = Math.min(sphereLB(P, ARCH, archPad), sphereLB(P, SWEEP, sweepPad), rootFoot) - 1.75
    if (!BOUNDED || legLB < d + 8) {
      let leg = limb(u, y, w, ARCH_SEGS)
      leg = smin(leg, limb(u, y, w, SWEEP_SEGS), 3)
      leg = smin(leg, rootFoot, 4)
      d = smin(d, leg, 8)
    }
    // The shelves.
    for (const L of SHELVES) {
      if (BOUNDED && ledgeLB(u, w, y, L) >= d + L[13]) continue
      d = smin(d, grownLedge(u, w, y, L[0], L[1], L[10], L[11], L[3], L[4], L[5], L[6], L[7], L[8], L[9]), L[13])
    }
    return d
  }
}

/** A grid box (design metres) that holds the plan's form with a margin. */
export function strataBounds(plan: StrataPlan): FieldBounds {
  const R = plan.roof
  const top = Math.max(plan.mass.top, R.base + R.rise + 6, plan.leg.sweep[2][1] + 4)
  return { u: [Math.min(R.back, plan.mass.uc0 - plan.mass.rx * 1.5) - 10, R.front + 12], w: [-52, 52], y: [-14, top + 12] }
}
