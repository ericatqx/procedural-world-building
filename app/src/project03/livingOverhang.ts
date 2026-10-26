import { BufferAttribute, BufferGeometry } from 'three'
import { sunAt } from '../project/sun.ts'
import { clamp01, smoothstep } from '../project02/core.ts'
import { prevailingWind } from './environment.ts'
import { landscapeHeight } from './terrain.ts'
import { chooseSite, livingArchitecture, norm, rng, skin, waterBearing, waterDistance, type Colony, type V } from './livingArchitecture.ts'
import { surfaceNets } from './livingMesh.ts'
import { vnoise } from './livingStrata.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — Living Architecture, the Overhang (Stage A): one monumental organism, form first.
 *
 * Not a growth simulation. The composition is set first, as a handful of tissue masses with parameters, and the seed and
 * the site vary them within ranges. Each mass has a developmental reason, and the reasons are what fix where it stands:
 *
 *   keep          the oldest mass, on the far side from the sun: horizontal strata laid down on firm, dry ground, each
 *                 one flaring at its top into a ledge and the next set back from it, so it steps down toward the sun
 *   great shelf   tissue grows where it is lit, so the keep's sun-facing flank has pushed out one long, thick slab toward
 *                 the day's sun arc. It is two strata (a thinner, set-back lower one), thick at the root, thinning toward
 *                 the tip, with a lip that thickens downward at its edge
 *   foot          where the shelf outgrew what its thickness could carry, its underside grew down and rooted: a splayed
 *                 trunk, flaring into the shelf above and into ridged roots below. One support was enough
 *   upper deck    a later, smaller shelf above the first, set back over the keep
 *   terraces      short ledges on the keep's lit faces, one of them crosswise
 *   curtain       on the side toward the water the shelf's rim grew down to the damp ground as two hanging walls; the gap
 *                 between them, where the tissue did not meet, is a fissure looking out to the water
 *   lower shelf   an earlier, shaded slab under the great shelf on the water side, ragged where it drew back: it steps the
 *                 ceiling down and pushes out through the curtain
 *   light slot    the shelf joined the keep at its flanks but not at its middle: a slit at the root drops high sun inside
 *   runner        a low, half-buried ridge that follows the moisture toward the water
 *
 * The undercroft (between the keep, the foot and the curtain, under the shelf) is never filled because the shelf shades
 * it from mid-morning to mid-afternoon and undersides do not grow: it is the by-product of the organism shading itself.
 *
 * Geometry: a signed distance field in the organism's own frame (u toward the sun, w across, y up from the site's
 * ground), sampled at 0.8 m. Strata within a mass meet with a small blend (a crease: the bands); masses fuse with a large
 * one (callus). Outlines carry a low-frequency irregularity and the whole a gentle 3D one: no fine erosion, no pores.
 * Option: `variation` (?v=1, 2, …) draws another set of proportions within the ranges.
 */

const STEP = 0.8

export type OverhangOptions = { variation?: number }

export function overhangOptionsFromUrl(): OverhangOptions {
  if (typeof location === 'undefined') return {}
  const q = new URLSearchParams(location.search)
  const v = Number(q.get('v'))
  return { variation: q.has('v') && Number.isFinite(v) ? v : undefined }
}

export const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}
export const smax = (a: number, b: number, k: number) => -smin(-a, -b, k)
/** A rounded rectangle in plan, centred at the origin, half-sizes hu × hw, corner radius r. */
export const rect2 = (u: number, w: number, hu: number, hw: number, r: number) => {
  const qu = Math.abs(u) - hu + r
  const qw = Math.abs(w) - hw + r
  return Math.hypot(Math.max(qu, 0), Math.max(qw, 0)) + Math.min(Math.max(qu, qw), 0) - r
}
/** A slab: a plan outline (d2) between a bottom and a top, its edges rounded by r. */
export const slab = (d2: number, y: number, bottom: number, top: number, r: number) => {
  const a = d2 + r
  const b = Math.max(bottom - y, y - top) + r
  return Math.hypot(Math.max(a, 0), Math.max(b, 0)) + Math.min(Math.max(a, b), 0) - r
}
/** A cone-capsule from a to b, radius r0 at a and r1 at b. */
export const capsule = (p: V, a: V, b: V, r0: number, r1: number) => {
  const ba: V = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const pa: V = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
  const t = clamp01((pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / (ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2]))
  return Math.hypot(pa[0] - ba[0] * t, pa[1] - ba[1] * t, pa[2] - ba[2] * t) - (r0 + (r1 - r0) * t)
}

const KEEP = 0
const SHELF = 1
const FOOT = 2
const DECK = 3
const TERRACE = 4
const CURTAIN = 5
const LOWER = 6
const RUNNER = 7

export function growOverhang(world: World, seed: number, options: OverhangOptions = {}): Colony {
  const started = performance.now()
  const variation = options.variation ?? 0
  const rand = rng((seed ^ Math.imul(variation + 7, 0x2c1b3c6d)) >>> 0)
  const jitter = (base: number, spread: number) => base * (1 + (rand() * 2 - 1) * spread)
  const [sx, sz] = chooseSite(world, seed)
  const g0 = landscapeHeight(sx, sz)

  // ------------------------------------------------------------------------------------------------ frame
  // u: toward the day's mean sun (the way the shelf reaches); w: across; y: up from the site's ground.
  let lx = 0
  let lz = 0
  for (const h of [8, 10, 12, 14, 16]) {
    const d = sunAt(h, 55).direction
    lx += d[0]
    lz += d[2]
  }
  const a = norm([lx, 0, lz])
  const b: V = [-a[2], 0, a[0]]
  const toWorld = (u: number, w: number, y: number): V => [sx + a[0] * u + b[0] * w, g0 + y, sz + a[2] * u + b[2] * w]
  const water = waterBearing(world, sx, sz)
  // The curtain and the fissure are on the side that faces the water; the open mouth on the other.
  const cs = water[0] * b[0] + water[2] * b[2] >= 0 ? 1 : -1
  const waterLocal: [number, number] = (() => {
    const wu = water[0] * a[0] + water[2] * a[2]
    const ww = water[0] * b[0] + water[2] * b[2]
    const l = Math.hypot(wu, ww) || 1
    return [wu / l, ww / l]
  })()
  const moisture = Math.exp(-waterDistance(world, sx, sz) / 110)
  const sunLocal: V = (() => {
    const d = sunAt(12, 55).direction
    return norm([d[0] * a[0] + d[2] * a[2], d[1], d[0] * b[0] + d[2] * b[2]])
  })()

  // ------------------------------------------------------------------------------------------------ parameters
  const S = jitter(1, 0.08)
  const keep = {
    cu: -22 * S,
    cw: (rand() - 0.5) * 4,
    hu: jitter(14, 0.12) * S,
    hw: jitter(17, 0.12) * S,
    layers: [] as { y0: number; y1: number; du: number; dw: number; shrinkU: number; shrinkW: number; lip: number }[],
  }
  {
    const height = jitter(38, 0.1) * S
    const count = 6 + Math.floor(rand() * 2)
    const weights = Array.from({ length: count }, (_, i) => (i === 0 ? 1.5 : 1) * jitter(1, 0.25))
    const total = weights.reduce((s, x) => s + x, 0)
    let y = -8
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1)
      const y1 = i === 0 ? (weights[0]! / total) * height : y + (weights[i]! / total) * height
      keep.layers.push({
        y0: y,
        y1,
        // Each stratum is set back from the one below, toward the rear (away from the sun), and wanders a little.
        du: -t * jitter(9, 0.3) * S + (rand() - 0.5) * 2.5,
        dw: (rand() - 0.5) * 4 * S,
        shrinkU: 1 - t * jitter(0.32, 0.3),
        shrinkW: 1 - t * jitter(0.28, 0.3),
        lip: jitter(1.6, 0.35),
      })
      y = y1
    }
  }
  const keepTop = keep.layers[keep.layers.length - 1]!.y1
  const keepFace = keep.cu + keep.hu
  const shelf = {
    root: keepFace - 7 * S,
    tip: keepFace + jitter(46, 0.12) * S,
    top: jitter(18, 0.08) * S,
    rise: jitter(2, 0.5),
    thickRoot: jitter(6.5, 0.1),
    thickTip: jitter(3.4, 0.12),
    hwRoot: jitter(15, 0.1) * S,
    hwTip: jitter(11, 0.15) * S,
    cw: (rand() - 0.5) * 3,
    droop: jitter(1.8, 0.3),
  }
  const shelfTopAt = (u: number) => shelf.top + shelf.rise * clamp01((u - shelf.root) / (shelf.tip - shelf.root))
  const shelfThickAt = (u: number) => shelf.thickRoot + (shelf.thickTip - shelf.thickRoot) * clamp01((u - shelf.root) / (shelf.tip - shelf.root))
  const shelfHwAt = (u: number) => shelf.hwRoot + (shelf.hwTip - shelf.hwRoot) * clamp01((u - shelf.root) / (shelf.tip - shelf.root))
  const foot = {
    u: shelf.tip - jitter(12, 0.2) * S,
    w: shelf.cw - cs * jitter(2.5, 0.6),
    waist: jitter(4.2, 0.12) * S,
    roots: 4 + Math.floor(rand() * 3),
    rootTurn: rand() * Math.PI * 2,
  }
  const footBottomOfShelf = shelfTopAt(foot.u) - shelfThickAt(foot.u)
  const deck = {
    cu: keepFace - jitter(9, 0.25) * S,
    hu: jitter(12, 0.2) * S,
    cw: shelf.cw + cs * jitter(5, 0.4),
    hw: jitter(10, 0.15) * S,
    top: jitter(29, 0.06) * S,
    thick: jitter(3.6, 0.15),
  }
  const terraces = [
    // Crosswise, on the mouth side of the keep, under the shelf's level.
    { cu: keep.cu + keep.hu * 0.15, cw: keep.cw - cs * (keep.hw + 4), hu: jitter(9, 0.2), hw: jitter(6, 0.2), top: jitter(11.5, 0.1) * S, thick: 3 },
    // High on the sun face of the keep, above the deck.
    { cu: keepFace - 6 * S, cw: keep.cw + (rand() - 0.5) * 6, hu: jitter(6, 0.2), hw: jitter(8, 0.2), top: Math.min(keepTop - 2, jitter(35, 0.06) * S), thick: 2.8 },
  ]
  const fissure = {
    u: jitter(keepFace + 16 * S, 0.1),
    half: jitter(1.9, 0.15),
  }
  const curtain = {
    u0: keepFace - 2,
    u1: foot.u - foot.waist - jitter(6, 0.3),
    thick: jitter(1.5, 0.15),
  }
  const lower = {
    u0: keep.cu,
    u1: keepFace + jitter(14, 0.2) * S,
    w0: shelf.cw + cs * 2,
    w1: shelf.cw + cs * (shelf.hwRoot + jitter(4, 0.3)),
    top: jitter(10.5, 0.08) * S,
    thick: jitter(2.8, 0.15),
  }
  const slot = { u: keepFace - jitter(2.5, 0.2), w: shelf.cw - cs * jitter(4, 0.3), hu: 1.1, hw: jitter(3.5, 0.2) }
  const runner = (() => {
    const start: V = [keep.cu + waterLocal[0] * keep.hu * 0.8, -0.8, keep.cw + waterLocal[1] * keep.hw * 0.8]
    const length = jitter(26, 0.2)
    const bend = (rand() - 0.5) * 0.6
    const pts: V[] = []
    for (let i = 0; i <= 5; i += 1) {
      const t = i / 5
      const ang = Math.atan2(waterLocal[1], waterLocal[0]) + bend * Math.sin(t * Math.PI)
      const prev = pts[i - 1] ?? start
      pts.push(i === 0 ? start : [prev[0] + Math.cos(ang) * (length / 5), -0.8 - 0.6 * t, prev[2] + Math.sin(ang) * (length / 5)])
    }
    return pts
  })()

  // ------------------------------------------------------------------------------------------------ field
  const U0 = -46
  const U1 = Math.max(shelf.tip + 10, foot.u + 18)
  const W0 = -34
  const W1 = 34
  const Y0 = -10
  const Y1 = keepTop + 6
  const dx = Math.ceil((U1 - U0) / STEP) + 1
  const dy = Math.ceil((Y1 - Y0) / STEP) + 1
  const dz = Math.ceil((W1 - W0) / STEP) + 1
  const field = new Float32Array(dx * dy * dz)
  const owner = new Uint8Array(dx * dy * dz)
  const fidx = (x: number, y: number, z: number) => (z * dy + y) * dx + x
  const groundLocal = new Float32Array(dx * dz)
  for (let z = 0; z < dz; z += 1) {
    for (let x = 0; x < dx; x += 1) {
      const p = toWorld(U0 + x * STEP, W0 + z * STEP, 0)
      groundLocal[z * dx + x] = landscapeHeight(p[0], p[2]) - g0
    }
  }
  const nseed = (seed % 997) + variation * 13.7

  const sample = (u: number, w: number, y: number): [number, number] => {
    // Outlines wander at the scale of the masses; the whole surface undulates gently. Nothing finer.
    const np = 2 * (vnoise(u / 17 + nseed, w / 17, 0.5) - 0.5) * 1.7 + 2 * (vnoise(u / 6.5, w / 6.5 + nseed, 3.1) - 0.5) * 0.45
    const n3 = 2 * (vnoise(u / 11 + 4.1, y / 8, w / 11 + nseed) - 0.5) * 0.6
    let best = Infinity
    let who = KEEP
    const put = (d: number, id: number, k: number) => {
      if (d < best) who = id
      best = best === Infinity ? d : smin(best, d, k)
    }

    // Keep: strata, each flaring at its top into a ledge; strata meet with a crease.
    let dKeep = Infinity
    for (const L of keep.layers) {
      const t = clamp01((y - L.y0) / Math.max(0.1, L.y1 - L.y0))
      const flare = L.lip * smoothstep(0.5, 1, t) - 0.6 * (1 - smoothstep(0, 0.25, t))
      const d2 = rect2(u - (keep.cu + L.du), w - (keep.cw + L.dw), keep.hu * L.shrinkU, keep.hw * L.shrinkW, 5) - flare - np
      const d = slab(d2, y, L.y0, L.y1, 1.3)
      dKeep = dKeep === Infinity ? d : smin(dKeep, d, 0.9)
    }
    put(dKeep, KEEP, 1)

    // Great shelf: an upper stratum and a set-back lower one; the lip thickens downward at the edge.
    {
      const cu = (shelf.root + shelf.tip) / 2
      const hu = (shelf.tip - shelf.root) / 2
      const hw = shelfHwAt(u)
      const d2 = rect2(u - cu, w - shelf.cw, hu, hw, Math.min(hw, 9)) - np * 1.3
      const top = shelfTopAt(u)
      const thick = shelfThickAt(u)
      const edge = 1 - smoothstep(-6, -0.5, d2)
      const split = top - thick * 0.45
      const upper = slab(d2, y, split - 0.3, top, 1.2)
      const lowerS = slab(d2 + 1.8 - 1.2 * edge, y, top - thick - shelf.droop * edge, split, 1.2)
      put(smin(upper, lowerS, 0.8), SHELF, 2.6)
    }

    // Upper deck: a later, smaller shelf over the keep.
    {
      const d2 = rect2(u - deck.cu, w - deck.cw, deck.hu, deck.hw, 6) - np
      const edge = 1 - smoothstep(-4, -0.5, d2)
      put(slab(d2, y, deck.top - deck.thick - 1.2 * edge, deck.top, 1.1), DECK, 2.2)
    }

    // Terraces.
    for (const T of terraces) {
      const d2 = rect2(u - T.cu, w - T.cw, T.hu, T.hw, 3.5) - np * 0.8
      const edge = 1 - smoothstep(-3, -0.5, d2)
      put(slab(d2, y, T.top - T.thick - 0.9 * edge, T.top, 1), TERRACE, 2.2)
    }

    // Foot: a splayed trunk, flaring into the shelf above and into ridged roots below.
    {
      const du = u - foot.u
      const dw = (w - foot.w) / 1.35
      const yy = Math.max(0, y)
      const r = foot.waist + 6 * Math.exp(-yy / 3.2) + 4.5 * Math.exp(-Math.max(0, footBottomOfShelf - y) / 3.2) + np * 0.5
      let d = (Math.hypot(du, dw) - r) * 0.8
      d = Math.max(d, y - footBottomOfShelf - 2)
      put(d, FOOT, 3)
      for (let k = 0; k < foot.roots; k += 1) {
        const ang = foot.rootTurn + (k / foot.roots) * Math.PI * 2 + 0.3 * Math.sin(k * 2.3)
        const len = 9 + 4 * Math.sin(k * 1.7 + nseed)
        const p0: V = [foot.u + Math.cos(ang) * foot.waist * 0.8, 1.2, foot.w + Math.sin(ang) * foot.waist * 1.1]
        const p1: V = [foot.u + Math.cos(ang) * (foot.waist + len), -1.2, foot.w + Math.sin(ang) * (foot.waist + len) * 1.1]
        put(capsule([u, y, w], p0, p1, 2.2, 0.7), FOOT, 2.2)
      }
    }

    // Curtain: the shelf's rim on the water side grown down to the ground, in two walls with a fissure between.
    {
      const edgeW = shelf.cw + cs * (shelfHwAt(u) - 1.4)
      const cu = (curtain.u0 + curtain.u1) / 2
      const hu = (curtain.u1 - curtain.u0) / 2
      let d2 = rect2(u - cu, w - edgeW, hu, curtain.thick, curtain.thick * 0.95) - np * 0.6
      d2 -= 1.6 * Math.exp(-Math.max(0, y) / 2.2)
      // The fissure: where the two walls did not meet. Tall and narrow, open to the ground.
      const gap = Math.abs(u - fissure.u) - fissure.half - 0.6 * (vnoise(y / 3, nseed, 1) - 0.5)
      const wall = smax(slab(d2, y, -6, shelfTopAt(u) - shelfThickAt(u) * 0.5, 1), -gap, 0.8)
      put(wall, CURTAIN, 2.4)
    }

    // Lower shelf: an earlier slab under the great shelf on the water side, ragged where it drew back.
    {
      const cu = (lower.u0 + lower.u1) / 2
      const hu = (lower.u1 - lower.u0) / 2
      const cw = (lower.w0 + lower.w1) / 2
      const hw = Math.abs(lower.w1 - lower.w0) / 2
      const ragged = 2 * (vnoise(u / 4 + nseed, w / 4, 7.7) - 0.5) * 1.6
      const d2 = rect2(u - cu, w - cw, hu, hw, 4) - ragged - np * 0.6
      const edge = 1 - smoothstep(-3, -0.5, d2)
      put(slab(d2, y, lower.top - lower.thick - 0.8 * edge, lower.top, 1), LOWER, 2)
    }

    // Runner: half buried, toward the water.
    for (let i = 0; i < runner.length - 1; i += 1) {
      const t0 = i / (runner.length - 1)
      const t1 = (i + 1) / (runner.length - 1)
      const p0 = runner[i]!
      const p1 = runner[i + 1]!
      put(capsule([u, y, w], [p0[0], p0[1], p0[2]], [p1[0], p1[1], p1[2]], 3.6 - 2.2 * t0, 3.6 - 2.2 * t1), RUNNER, 2.5)
    }

    // The light slot at the shelf's root.
    const dSlot = slab(rect2(u - slot.u, w - slot.w, slot.hu, slot.hw, 1), y, shelfTopAt(slot.u) - shelfThickAt(slot.u) - 3, shelfTopAt(slot.u) + 3, 0.6)
    best = smax(best, -dSlot, 0.7)
    return [best + n3, who]
  }

  for (let z = 0; z < dz; z += 1) {
    const w = W0 + z * STEP
    for (let x = 0; x < dx; x += 1) {
      const u = U0 + x * STEP
      const g = groundLocal[z * dx + x]!
      for (let y = 0; y < dy; y += 1) {
        const yy = Y0 + y * STEP
        let [d, who] = sample(u, w, yy)
        // Nothing below the ground.
        if (yy < g - 1.2) d = Math.max(d, g - 1.2 - yy)
        field[fidx(x, y, z)] = -d
        owner[fidx(x, y, z)] = who
      }
    }
  }
  const grownAt = performance.now()
  const net = surfaceNets(field, dx, dy, dz, [0, 0, 0])

  // ------------------------------------------------------------------------------------------------ surface and record
  const count = net.positions.length / 3
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const colours = new Float32Array(count * 3)
  const recordA = new Float32Array(count * 4)
  const recordB = new Float32Array(count * 4)
  const heading = (prevailingWind(seed) * Math.PI) / 180
  const wind: V = [Math.cos(heading), 0, Math.sin(heading)]
  const inside = (gx: number, gy: number, gz: number) => {
    const x = Math.round(gx)
    const y = Math.round(gy)
    const z = Math.round(gz)
    if (x < 0 || y < 0 || z < 0 || x >= dx || y >= dy || z >= dz) return 0
    return field[fidx(x, y, z)]! > 0 ? 1 : 0
  }
  let top = 0
  for (let v = 0; v < count; v += 1) {
    const gx = net.positions[v * 3]!
    const gy = net.positions[v * 3 + 1]!
    const gz = net.positions[v * 3 + 2]!
    const u = U0 + gx * STEP
    const y = Y0 + gy * STEP
    const w = W0 + gz * STEP
    const p = toWorld(u, w, y)
    positions.set(p, v * 3)
    top = Math.max(top, y)
    // The grid's axes are (u, y, w); the world's are (a, up, b).
    const nu = net.normals[v * 3]!
    const ny = net.normals[v * 3 + 1]!
    const nw = net.normals[v * 3 + 2]!
    const n: V = [a[0] * nu + b[0] * nw, ny, a[2] * nu + b[2] * nw]
    normals.set(n, v * 3)
    // Openness: how much of the space just outside the surface is clear (a cheap ambient term), and sun on the face.
    let open = 0
    let tests = 0
    for (const s of [2, 4, 7, 11]) {
      for (const [ou, oy, ow] of [
        [nu, ny, nw],
        [nu * 0.6, 0.8, nw * 0.6],
      ] as const) {
        open += 1 - inside(gx + (ou * s) / STEP, gy + (oy * s) / STEP, gz + (ow * s) / STEP)
        tests += 1
      }
    }
    const openness = open / tests
    const sunFace = Math.max(0, nu * sunLocal[0] + ny * sunLocal[1] + nw * sunLocal[2])
    const light = clamp01(0.15 + 0.85 * sunFace * openness)
    const above = y - groundLocal[Math.min(dz - 1, Math.max(0, Math.round(gz))) * dx + Math.min(dx - 1, Math.max(0, Math.round(gx)))]!
    const who = owner[fidx(Math.min(dx - 1, Math.round(gx)), Math.min(dy - 1, Math.round(gy)), Math.min(dz - 1, Math.round(gz)))]!
    // Growth record: strata are horizontal bands of age (older low), gently warped; the shelf's are its own.
    const warp = 1.2 * (vnoise(u / 9 + nseed, w / 9, 2.2) - 0.5)
    const birth = clamp01((y + 8 + warp) / (keepTop + 10))
    const wet = clamp01(moisture * (1 - smoothstep(0, 7, above)) + 0.35 * Math.max(0, -ny) * (1 - openness))
    recordA.set([birth, 0.72 + 0.15 * openness, who === FOOT ? 0.25 : 0.05, 0], v * 4)
    recordB.set([light, wet, ((who * 2654435761) >>> 0) / 4294967296, who === SHELF || who === DECK ? 0.75 : 0.5], v * 4)
    const colour = skin(Math.max(0, above), 0.25 + 0.3 * (1 - openness), 1, moisture)
    const shade = (ny < -0.4 ? 0.84 : 1) * (0.9 + 0.1 * openness) * (1 + 0.04 * (n[0] * wind[0] + n[2] * wind[2]))
    colours[v * 3] = colour.r * shade
    colours[v * 3 + 1] = colour.g * shade
    colours[v * 3 + 2] = colour.b * shade
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('color', new BufferAttribute(colours, 3))
  geometry.setAttribute('aGrowthA', new BufferAttribute(recordA, 4))
  geometry.setAttribute('aGrowthB', new BufferAttribute(recordB, 4))
  geometry.setIndex(new BufferAttribute(new Uint32Array(net.indices), 1))
  geometry.computeBoundingSphere()

  // Headroom of the undercroft: the clear height under the shelf, midway between the keep and the foot.
  const headroomAt = (u: number, w: number) => {
    const x = Math.round((u - U0) / STEP)
    const z = Math.round((w - W0) / STEP)
    const g = groundLocal[z * dx + x]!
    for (let y = Math.ceil((g + 0.5 - Y0) / STEP); y < dy; y += 1) if (field[fidx(x, y, z)]! > 0) return Y0 + y * STEP - g
    return Infinity
  }
  const midU = (keepFace + foot.u - foot.waist) / 2
  livingArchitecture.version += 1
  const stats = {
    experiment: 8,
    variation,
    keepHeight: Math.round(keepTop),
    keepStrata: keep.layers.length,
    shelfReach: Math.round(shelf.tip - keepFace),
    shelfThickRoot: Math.round(shelf.thickRoot * 10) / 10,
    shelfThickTip: Math.round(shelf.thickTip * 10) / 10,
    shelfTop: Math.round(shelf.top),
    footFromKeep: Math.round(foot.u - keepFace),
    footRoots: foot.roots,
    headroomMouthSide: Math.round(headroomAt(midU, shelf.cw - cs * 6) * 10) / 10,
    headroomMiddle: Math.round(headroomAt(midU, shelf.cw) * 10) / 10,
    headroomWaterSide: Math.round(headroomAt(midU, shelf.cw + cs * 7) * 10) / 10,
    fissureWidth: Math.round(fissure.half * 20) / 10,
    length: Math.round(U1 - U0),
    vertices: count,
    triangles: net.indices.length / 3,
    fieldMs: Math.round(grownAt - started),
    milliseconds: Math.round(performance.now() - started),
  }
  return { geometry, site: [sx, sz], ground: g0, organisms: 1, height: top, stats }
}
