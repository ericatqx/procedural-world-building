import { BufferAttribute, BufferGeometry } from 'three'
import { sunAt } from '../project/sun.ts'
import { clamp01, smoothstep } from '../project02/core.ts'
import { prevailingWind } from './environment.ts'
import { landscapeHeight } from './terrain.ts'
import { chooseSite, livingArchitecture, norm, rng, skin, waterBearing, waterDistance, type Colony, type V } from './livingArchitecture.ts'
import { surfaceNets } from './livingMesh.ts'
import { capsule, rect2, slab, smax, smin, type OverhangOptions } from './livingOverhang.ts'
import { vnoise } from './livingStrata.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — Living Architecture, the Overhang, revision 2: one macro-form revision of the Overhang (which stays
 * as the baseline). The same organism and frame, with four growth tendencies made visible in the massing:
 *
 *   light → outward     strata only flare into ledges on lit faces, and only in runs (the ledge stops where its run of light
 *                       did); the shelf reaches toward the sun
 *   age → mineral mass  the oldest tissue is the low, broad plinth the keep stands on, and the root of the shelf, which
 *                       has thickened down into the keep as a haunch
 *   stress → reinforce  the shelf's load runs to the keep along a thickened rib on its underside; one pier stands where
 *                       the rib's load peaks; the foot is two leaning legs that fork where the load arrives, with heavier
 *                       roots on the side the cantilever pulls toward
 *   shade → recession   shaded faces carry recessed bands instead of ledges; shaded hollows in the keep have drawn back into
 *                       deep recesses; a cleft has opened between two of the keep's masses; the web the rib grew down
 *                       into has drawn back to a single pier; the rim only grew down near the keep (the curtain)
 *
 * KEEP. Three fused vertical masses of different height on one mineral plinth: a tall rear mass, a middling one on the
 * water side, and a low one on the mouth side that stays under the shelf. A cleft separates the rear mass from the
 * water-side mass above the plinth. Strata are interrupted, not stacked plates. The keep is kept lower than the shelf is
 * long, so the horizontal reads first; the shelf's upper stratum runs back through the keep as one continuous band.
 *
 * UNDERCROFT. One dominant open space under the shelf, read whole from the mouth side, with subordinate spaces off it: a
 * low aisle on the water side under the mezzanine (the earlier lower shelf), behind a single pier; a grotto recessed into
 * the keep at ground level; a light well through the shelf near its root; the fork of the foot framing the view out past
 * the tip; and on the water side, set back under the shelf near the keep, a short curtain split by a fissure. Beyond the
 * curtain the undercroft is open on both sides: from the mouth you look through it to the landscape.
 *
 * Geometry as the Overhang: a distance field in the organism's frame (u toward the sun, w across, y up), sampled at 0.8 m,
 * masses fused with wide blends, strata with narrow ones; the same material and growth record. Option: `variation` (?v=1…).
 */

const STEP = 0.8

const KEEP = 0
const SHELF = 1
const FOOT = 2
const DECK = 3
const SPINE = 4
const CURTAIN = 5
const MEZZANINE = 6
const RUNNER = 7

/** An ellipsoid's (approximate) signed distance. */
const ellipsoid = (u: number, y: number, w: number, c: V, r: V) => (Math.hypot((u - c[0]) / r[0], (y - c[1]) / r[1], (w - c[2]) / r[2]) - 1) * Math.min(r[0], r[1], r[2])

export function growOverhang2(world: World, seed: number, options: OverhangOptions = {}): Colony {
  const started = performance.now()
  const variation = options.variation ?? 0
  const rand = rng((seed ^ Math.imul(variation + 11, 0x5bd1e995)) >>> 0)
  const jitter = (base: number, spread: number) => base * (1 + (rand() * 2 - 1) * spread)
  const [sx, sz] = chooseSite(world, seed)
  const g0 = landscapeHeight(sx, sz)

  // ------------------------------------------------------------------------------------------------ frame
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
  const cw0 = (rand() - 0.5) * 3
  // The keep: three vertical masses on one plinth. Rear is tallest; the water-side one is middling; the mouth-side one low.
  const masses = [
    { cu: -27 * S, cw: cw0 - cs * jitter(3, 0.4), hu: jitter(11, 0.12) * S, hw: jitter(12.5, 0.12) * S, top: jitter(35, 0.06) * S, taper: jitter(0.2, 0.3) },
    { cu: -13 * S, cw: cw0 + cs * jitter(8, 0.25), hu: jitter(8.5, 0.15) * S, hw: jitter(8, 0.15) * S, top: jitter(25, 0.1) * S, taper: jitter(0.16, 0.3) },
    { cu: -12 * S, cw: cw0 - cs * jitter(10, 0.2), hu: jitter(8, 0.15) * S, hw: jitter(6.5, 0.15) * S, top: jitter(13, 0.12) * S, taper: jitter(0.1, 0.3) },
  ]
  const plinth = { cu: -19 * S, cw: cw0, hu: jitter(17, 0.08) * S, hw: jitter(20, 0.08) * S, top: jitter(5.5, 0.2) }
  const keepTop = Math.max(...masses.map((m) => m.top))
  const keepFace = Math.max(...masses.map((m) => m.cu + m.hu))
  // Strata bands: their heights vary; each band's ledge appears only on lit faces, in runs.
  const bands: { y0: number; y1: number; lip: number; phase: number }[] = []
  for (let y = plinth.top - 1; y < keepTop + 2; ) {
    const h = jitter(5.2, 0.35)
    bands.push({ y0: y, y1: y + h, lip: jitter(1.9, 0.35), phase: rand() * 40 })
    y += h
  }
  const cleft = { u: masses[0]!.cu + masses[0]!.hu - jitter(2, 0.4), w0: cw0 - 2, w1: cw0 + cs * 22, half: jitter(1.3, 0.2), from: plinth.top + jitter(11, 0.25) }
  // Shaded hollows in the keep that have drawn back: rear face, water side, a grotto off the nave, high under the deck.
  const recesses: { c: V; r: V }[] = [
    { c: [masses[0]!.cu - masses[0]!.hu, jitter(9, 0.3), masses[0]!.cw + (rand() - 0.5) * 6], r: [5, jitter(3.4, 0.2), jitter(9, 0.2)] },
    { c: [masses[2]!.cu + masses[2]!.hu * 0.4, 3.2, masses[2]!.cw - cs * masses[2]!.hw], r: [jitter(6, 0.2), 4.6, 5.5] },
  ]
  const shelf = {
    root: keepFace - 24 * S,
    tip: keepFace + jitter(54, 0.1) * S,
    top: jitter(19, 0.06) * S,
    rise: jitter(1.5, 0.5),
    thickRoot: jitter(6.5, 0.1),
    thickTip: jitter(3.8, 0.1),
    hwRoot: jitter(17, 0.1) * S,
    hwTip: jitter(13, 0.12) * S,
    cw: cw0 + (rand() - 0.5) * 3,
    droop: jitter(1.1, 0.3),
    haunch: jitter(3.5, 0.2),
  }
  const along = (u: number) => clamp01((u - keepFace) / (shelf.tip - keepFace))
  const shelfTopAt = (u: number) => shelf.top + shelf.rise * along(u)
  const shelfThickAt = (u: number) => shelf.thickRoot + (shelf.thickTip - shelf.thickRoot) * along(u)
  const shelfHwAt = (u: number) => shelf.hwRoot + (shelf.hwTip - shelf.hwRoot) * along(u)
  const shelfBottomAt = (u: number) => shelfTopAt(u) - shelfThickAt(u)
  // The foot: two leaning legs that fork from where the load arrives.
  const footU = shelf.tip - jitter(12, 0.2) * S
  const footW = shelf.cw - cs * jitter(2, 0.6)
  const crown: V = [footU - 3, shelfBottomAt(footU) + 0.5, footW]
  const legOuter = { g: [footU + jitter(7, 0.2), -1.5, footW - cs * jitter(4, 0.3)] as V, r0: jitter(5.4, 0.1), r1: jitter(4.2, 0.1) }
  const legInner = { g: [footU - jitter(9, 0.2), -1.5, footW + cs * jitter(5, 0.3)] as V, r0: jitter(3.8, 0.1), r1: jitter(3.4, 0.1) }
  const roots = Array.from({ length: 3 + Math.floor(rand() * 2) }, (_, k) => {
    const fromOuter = k % 2 === 0
    const base = fromOuter ? legOuter.g : legInner.g
    // Heavier toward the tip, where the cantilever pulls.
    const ang = (fromOuter ? 0 : Math.PI) + (rand() - 0.5) * 2.4
    const len = (fromOuter ? 9 : 5) * jitter(1, 0.25)
    return { p0: [base[0], 1, base[2]] as V, p1: [base[0] + Math.cos(ang) * len, -1.4, base[2] + Math.sin(ang) * len] as V, r0: fromOuter ? 2.6 : 2, r1: 0.7 }
  })
  // The load rib under the shelf, from the foot's crown to the keep.
  const ribW = shelf.cw + cs * jitter(1.5, 0.5)
  const rib = { p0: [crown[0], crown[1] - 0.5, ribW] as V, p1: [keepFace - 2, shelfBottomAt(keepFace) - 1.5, ribW] as V, r: jitter(2.8, 0.15) }
  // One subordinate pier where the rib's load peaks, toward the water side: what is left of the web the rib grew down
  // into once its shaded spans drew back. It leans toward the keep.
  const pier = {
    top: [keepFace + jitter(11, 0.2) * S, 0, ribW + cs * jitter(4, 0.3)] as V,
    foot: [0, -1.5, 0] as V,
    r0: jitter(3.4, 0.1),
    r1: jitter(2.4, 0.1),
  }
  pier.top[1] = shelf.top - shelf.thickRoot
  pier.foot = [pier.top[0] + jitter(3, 0.3), -1.5, pier.top[2] + cs * jitter(1.5, 0.4)]
  const deck = { cu: masses[0]!.cu + masses[0]!.hu * 0.6, hu: jitter(10, 0.2) * S, cw: cw0 + cs * jitter(4, 0.4), hw: jitter(9, 0.15) * S, top: jitter(30, 0.06) * S, thick: jitter(3.4, 0.15) }
  const mezz = {
    u0: masses[1]!.cu - 2,
    u1: keepFace + jitter(20, 0.2) * S,
    w0: ribW + cs * 0.5,
    w1: shelf.cw + cs * (shelf.hwRoot + jitter(3, 0.4)),
    top: jitter(9.5, 0.08) * S,
    thick: jitter(2.6, 0.15),
  }
  const well = { u: keepFace + jitter(5, 0.3), w: shelf.cw - cs * jitter(6, 0.25), hu: jitter(2.6, 0.2), hw: jitter(5, 0.2) }
  // Only near the keep, where it is dampest and most shaded, has the rim grown down: beyond it the undercroft looks through.
  const curtain = { u0: keepFace - 2, u1: keepFace + jitter(13, 0.15) * S, thick: jitter(1.5, 0.15), setback: jitter(6, 0.2) }
  const fissure = { u: keepFace + jitter(6, 0.15) * S, half: jitter(1.6, 0.15) }
  const runner = (() => {
    const start: V = [plinth.cu + waterLocal[0] * plinth.hu * 0.8, -0.8, plinth.cw + waterLocal[1] * plinth.hw * 0.8]
    const length = jitter(24, 0.2)
    const bend = (rand() - 0.5) * 0.6
    const pts: V[] = [start]
    for (let i = 1; i <= 5; i += 1) {
      const t = i / 5
      const ang = Math.atan2(waterLocal[1], waterLocal[0]) + bend * Math.sin(t * Math.PI)
      const prev = pts[i - 1]!
      pts.push([prev[0] + Math.cos(ang) * (length / 5), -0.8 - 0.6 * t, prev[2] + Math.sin(ang) * (length / 5)])
    }
    return pts
  })()

  // ------------------------------------------------------------------------------------------------ field
  const U0 = -48
  const U1 = Math.max(shelf.tip + 10, legOuter.g[0] + 20)
  const W0 = -36
  const W1 = 36
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

  const keepField = (u: number, w: number, y: number, np: number): number => {
    // The band this height is in, and where in it.
    let band = bands[0]!
    for (const B of bands) if (y >= B.y0) band = B
    const t = clamp01((y - band.y0) / (band.y1 - band.y0))
    let d = Infinity
    for (const m of masses) {
      const du = u - m.cu
      const dw = w - m.cw
      // Which way this point of the outline faces, in plan: light grows ledges, shade grows recessed bands.
      const l = Math.hypot(du / m.hu, dw / m.hw) || 1
      const lit = clamp01(0.45 + 0.75 * (du / m.hu / l))
      const run = smoothstep(0.42, 0.62, vnoise(Math.atan2(dw, du) * 2.2 + band.phase, band.phase, 0.3))
      const ledge = band.lip * smoothstep(0.55, 1, t) * lit * run
      const groove = 0.9 * (1 - lit) * (1 - smoothstep(0, 0.22, t))
      const shrink = 1 - m.taper * clamp01(y / m.top)
      const d2 = rect2(du, dw, m.hu * shrink, m.hw * shrink, Math.min(m.hu, m.hw) * 0.4) - ledge + groove - np * 0.6
      d = d === Infinity ? slab(d2, y, -8, m.top, 1.6) : smin(d, slab(d2, y, -8, m.top, 1.6), 1.6)
    }
    // The plinth: the oldest, mineral tissue, broad and battered toward the ground.
    const batter = 2.4 * (1 - smoothstep(-2, plinth.top, y))
    const pd = slab(rect2(u - plinth.cu, w - plinth.cw, plinth.hu, plinth.hw, 8) - batter - np * 1.2, y, -8, plinth.top, 1.4)
    d = smin(d, pd, 2.5)
    // The cleft between the rear and the water-side masses, above the plinth.
    const cleftD = slab(rect2(u - cleft.u, w - (cleft.w0 + cleft.w1) / 2, cleft.half + 0.4 * (vnoise(y / 4, nseed, 5) - 0.5), Math.abs(cleft.w1 - cleft.w0) / 2, 0.6), y, cleft.from, keepTop + 4, 1)
    d = smax(d, -cleftD, 1.2)
    for (const R of recesses) d = smax(d, -ellipsoid(u, y, w, R.c, R.r), 1.6)
    return d
  }

  const sample = (u: number, w: number, y: number): [number, number] => {
    const np = 2 * (vnoise(u / 17 + nseed, w / 17, 0.5) - 0.5) * 1.6 + 2 * (vnoise(u / 6.5, w / 6.5 + nseed, 3.1) - 0.5) * 0.45
    const n3 = 2 * (vnoise(u / 11 + 4.1, y / 8, w / 11 + nseed) - 0.5) * 0.3
    let best = Infinity
    let who = KEEP
    const put = (d: number, id: number, k: number) => {
      if (d < best) who = id
      best = best === Infinity ? d : smin(best, d, k)
    }

    put(keepField(u, w, y, np), KEEP, 1)

    // Shelf: two strata; the root has thickened down into the keep (the haunch); the lip thickens downward.
    {
      const cu = (shelf.root + shelf.tip) / 2
      const hu = (shelf.tip - shelf.root) / 2
      const hw = shelfHwAt(u)
      let d2 = rect2(u - cu, w - shelf.cw, hu, hw, Math.min(hw, 9)) - np * 0.8
      const top = shelfTopAt(u)
      const thick = shelfThickAt(u)
      const edge = 1 - smoothstep(-6, -0.5, d2)
      const haunch = shelf.haunch * Math.exp(-Math.max(0, u - keepFace) / 4) * smoothstep(-4, -10, d2)
      const split = top - thick * 0.45
      // The light well: near the root, on the mouth side, where the junction stayed thin.
      const wellD = rect2(u - well.u, w - well.w, well.hu, well.hw, Math.min(well.hu, well.hw) * 0.9) + 0.5 * (vnoise(u / 3, w / 3, nseed) - 0.5)
      d2 = smax(d2, -wellD, 1)
      const upper = slab(d2, y, split - 0.3, top, 1.2)
      const lowerS = slab(d2 + 1.6 - 1.1 * edge, y, top - thick - shelf.droop * edge - haunch, split, 1.2)
      put(smin(upper, lowerS, 0.8), SHELF, 2)
    }

    // The load rib under the shelf and the foot it arrives at: two legs forking from a crown.
    put(capsule([u, y, w], rib.p0, rib.p1, rib.r, rib.r * 0.75) * 0.9, SHELF, 2.4)
    {
      const crownD = ellipsoid(u, y, w, crown, [8.5, 3.6, 6.5])
      put(crownD, FOOT, 3)
      put(capsule([u, y, w], legOuter.g, crown, legOuter.r0, legOuter.r1) + 0.4 * np, FOOT, 3)
      put(capsule([u, y, w], legInner.g, crown, legInner.r0, legInner.r1) + 0.4 * np, FOOT, 2.6)
      // Ground flare at each leg.
      for (const L of [legOuter, legInner]) put(ellipsoid(u, y, w, [L.g[0], -1.5, L.g[2]], [L.r0 * 1.9, 3.2, L.r0 * 1.7]), FOOT, 3)
      for (const R of roots) put(capsule([u, y, w], R.p0, R.p1, R.r0, R.r1), FOOT, 2.4)
    }

    // The one subordinate pier, flaring a little at the ground.
    put(capsule([u, y, w], pier.foot, pier.top, pier.r0, pier.r1) + 0.3 * np, SPINE, 2.6)
    put(ellipsoid(u, y, w, [pier.foot[0], -1.5, pier.foot[2]], [pier.r0 * 1.7, 2.6, pier.r0 * 1.5]), SPINE, 2)

    // Upper deck over the keep.
    {
      const d2 = rect2(u - deck.cu, w - deck.cw, deck.hu, deck.hw, 6) - np
      const edge = 1 - smoothstep(-4, -0.5, d2)
      put(slab(d2, y, deck.top - deck.thick - 1.2 * edge, deck.top, 1.1), DECK, 2.6)
    }

    // Mezzanine: the earlier shelf on the water side; the aisle runs under it.
    {
      const cu = (mezz.u0 + mezz.u1) / 2
      const hu = (mezz.u1 - mezz.u0) / 2
      const cw = (mezz.w0 + mezz.w1) / 2
      const hw = Math.abs(mezz.w1 - mezz.w0) / 2
      const ragged = 2 * (vnoise(u / 4 + nseed, w / 4, 7.7) - 0.5) * 1.6
      const d2 = rect2(u - cu, w - cw, hu, hw, 4) - ragged - np * 0.6
      const edge = 1 - smoothstep(-3, -0.5, d2)
      put(slab(d2, y, mezz.top - mezz.thick - 0.8 * edge, mezz.top, 1), MEZZANINE, 2.4)
    }

    // Curtain: a short wing on the water side near the keep, set back under the shelf, split by the fissure.
    {
      const edgeW = shelf.cw + cs * (shelfHwAt(u) - curtain.setback)
      let d2 = rect2(u - (curtain.u0 + curtain.u1) / 2, w - edgeW, (curtain.u1 - curtain.u0) / 2, curtain.thick, curtain.thick * 0.95) - np * 0.6
      d2 -= 1.6 * Math.exp(-Math.max(0, y) / 2.2)
      const gap = Math.abs(u - fissure.u) - fissure.half - 0.6 * (vnoise(y / 3, nseed, 1) - 0.5)
      put(smax(slab(d2, y, -6, shelfTopAt(u) - shelfThickAt(u) * 0.5, 1), -gap, 0.8), CURTAIN, 2.6)
    }

    // The runner toward the water.
    for (let i = 0; i < runner.length - 1; i += 1) {
      const t0 = i / (runner.length - 1)
      const t1 = (i + 1) / (runner.length - 1)
      put(capsule([u, y, w], runner[i]!, runner[i + 1]!, 3.6 - 2.2 * t0, 3.6 - 2.2 * t1), RUNNER, 2.5)
    }
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
    positions.set(toWorld(u, w, y), v * 3)
    top = Math.max(top, y)
    const nu = net.normals[v * 3]!
    const ny = net.normals[v * 3 + 1]!
    const nw = net.normals[v * 3 + 2]!
    const n: V = [a[0] * nu + b[0] * nw, ny, a[2] * nu + b[2] * nw]
    normals.set(n, v * 3)
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
    const warp = 1.2 * (vnoise(u / 9 + nseed, w / 9, 2.2) - 0.5)
    const birth = clamp01((y + 8 + warp) / (keepTop + 10))
    const wet = clamp01(moisture * (1 - smoothstep(0, 7, above)) + 0.35 * Math.max(0, -ny) * (1 - openness))
    recordA.set([birth, 0.72 + 0.15 * openness, who === FOOT || who === SPINE ? 0.25 : 0.05, 0], v * 4)
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

  const headroomAt = (u: number, w: number) => {
    const x = Math.min(dx - 1, Math.max(0, Math.round((u - U0) / STEP)))
    const z = Math.min(dz - 1, Math.max(0, Math.round((w - W0) / STEP)))
    const g = groundLocal[z * dx + x]!
    for (let y = Math.ceil((g + 0.5 - Y0) / STEP); y < dy; y += 1) if (field[fidx(x, y, z)]! > 0) return Y0 + y * STEP - g
    return Infinity
  }
  const midU = (keepFace + footU - 6) / 2
  livingArchitecture.version += 1
  const stats = {
    experiment: 9,
    variation,
    keepHeight: Math.round(keepTop),
    keepRear: Math.round(masses[0]!.top),
    keepWaterSide: Math.round(masses[1]!.top),
    keepMouthSide: Math.round(masses[2]!.top),
    strataBands: bands.length,
    recesses: recesses.length,
    shelfReach: Math.round(shelf.tip - keepFace),
    shelfThickRoot: Math.round(shelf.thickRoot * 10) / 10,
    footFromKeep: Math.round(footU - keepFace),
    headroomNave: Math.round(headroomAt(midU, shelf.cw - cs * 7) * 10) / 10,
    headroomAisle: Math.round(headroomAt(midU, shelf.cw + cs * 7) * 10) / 10,
    fissureWidth: Math.round(fissure.half * 20) / 10,
    vertices: count,
    triangles: net.indices.length / 3,
    fieldMs: Math.round(grownAt - started),
    milliseconds: Math.round(performance.now() - started),
  }
  return { geometry, site: [sx, sz], ground: g0, organisms: 1, height: top, stats }
}
