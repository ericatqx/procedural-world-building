import { BufferAttribute, BufferGeometry } from 'three'
import { sunAt } from '../project/sun.ts'
import { clamp01, smoothstep } from '../project02/core.ts'
import { prevailingWind } from './environment.ts'
import { landscapeHeight } from './terrain.ts'
import { chooseSite, livingArchitecture, norm, rng, skin, waterBearing, waterDistance, type Colony, type V } from './livingArchitecture.ts'
import { surfaceNets } from './livingMesh.ts'
import { arrivalTimes, decayTimes, fieldAt, lateWeights, NEVER, type LateState, type LateWeights, type LifeGrid } from './livingLife.ts'
import { capsule, rect2, slab, smax, smin, type OverhangOptions } from './livingOverhang.ts'
import { vnoise } from './livingStrata.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — Living Architecture, the Overhang, revision 3: the base architecture, revised from Overhang 2 (which
 * stays for comparison). The organism is sessile and mineralising, closer to vegetation or a colony than to rock: living tissue
 * grows toward light and moisture, older tissue mineralises into a rigid frame, stress thickens it locally, and shaded,
 * depleted or ageing tissue recedes, leaving openings that other life moves into. The geometry is set by that lifecycle:
 *
 *   two bodies    the keep is the old, large body; out toward the light stands a younger body of the same tissue (the
 *                 outlier), sharing the keep's strata. The masses step down outward: keep, great shelf, outlier, lower
 *                 shelf, so the composition is a cascade of overlapping growths rather than one span between two ends.
 *   great shelf   grown along a trajectory, not laid as a plate: out from the keep toward the light, swinging a little
 *                 toward the mouth side, narrowing at its waist, settling and thickening where it comes to rest on the
 *                 outlier's shoulder. Its growth edge settles rather than lifts: a thick, rounded, slightly drooping rim.
 *                 Its shaded underside has receded into shallow pockets, its damp water-side edge has died back in a bite.
 *   lower shelf   grown from the outlier, lower, angled across the great shelf and offset toward the water: back just under
 *                 the great shelf's end, where the two have grown together at one knuckle, and well out past the outlier.
 *   old shelf     an earlier growth from high on the rear mass toward an earlier light, now ageing: it has crept and
 *                 sagged, thinned and frayed at its edges, been holed where tissue died, and broken; its outer part has
 *                 slumped onto the great shelf and fused there. It is not parallel to the great shelf.
 *   supports      directional reinforcement where the load goes: the outlier's keep-facing flank has grown a buttress fin
 *                 swept up under the great shelf; toes run out from its base; the pier is a raking blade whose head leans
 *                 back toward the keep. All thicken toward the ground, where the oldest tissue has mineralised. The rib
 *                 follows the great shelf's trajectory from the outlier back to the keep.
 *   keep          unchanged from Overhang 2: three fused masses on a mineral plinth, a cleft, interrupted strata.
 *   undercroft    one dominant open space under the great shelf, between the keep and the outlier, open through from
 *                 the mouth side; subordinate spaces off it (a short, sagging mezzanine near the keep, the grotto, the
 *                 light well, the curtain and fissure), and a lower space under the lower shelf beyond the outlier.
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

/**
 * One organism's form, from where it stands (livingEcology.ts); every field defaults to the reference Overhang, which
 * stands at the chosen site at full size, with every part.
 *   site      where it stands; yaw turns its frame from the day's mean sun (toward a better-lit opening)
 *   size      metres per organism unit: a smaller organism is the same tissue at a smaller scale; step, its grid in
 *             organism units, so a small one costs less to build and is still sampled about as finely in metres
 *   keep      the keep's height (shaded organisms reach up), reach the great shelf's (lit ones reach out)
 *   outlier   whether it has grown a second body (with the lower shelf and the buttress): only where resources allow
 *   oldShelf  whether it is old enough to have grown, and outlived, the old shelf; curtain, damp enough for the curtain
 */
export type OrganismForm = {
  site?: [number, number]
  yaw?: number
  size?: number
  step?: number
  keep?: number
  reach?: number
  outlier?: boolean
  oldShelf?: boolean
  curtain?: boolean
  /** The keep's footprint against its height: exposed ground grows broad and low (more than 1), sheltered narrow and tall. */
  spread?: number
  /** The great shelf's height (shaded organisms carry it higher, toward the light). */
  shelfLift?: number
  /** How far the shelf rises (or, negative, falls) along its reach, following the ground, in organism metres. */
  rise?: number
  /** The shelf's sideways swing, scaled and signed toward the more open side. */
  swing?: number
  /** Whether it grew the mezzanine (damp ground) and the low mouth-side mass (rich ground). */
  mezzanine?: boolean
  lowMass?: boolean
  /**
   * Anchored: tissue must stand on land or shallow ground, and nothing hangs unsupported. A body whose base hovers above
   * sloping ground grows down to it (shelves and arches are left open), and any part not joined to ground-fed tissue is
   * dropped. The reference organism is not anchored: its geometry is the fixed reference.
   */
  anchored?: boolean
  /** 0 to 1: how crowded, shaded or uneven the ground is, unbalancing the masses (lower, broader, leaning to one side). */
  asym?: number
  /** 0 to 1: how near the water's edge it stands: its roots and toes reach farther toward the water, and thicker. */
  shore?: number
  /** 0 to 1: how much a landmark it is: a taller, broader Keep and a longer, heavier Shelf. */
  dominance?: number
}
/** With `life`, the organism also carries its lifecycle (see livingLife.ts): its shape and growth record at any age. */
export type Overhang3Options = OverhangOptions & { life?: boolean; form?: OrganismForm }
export type OverhangLife = {
  /** The geometry at an exact age and, past maturity, a later-life state (see livingLife.ts); the caller owns it. */
  at: (age: number, late?: LateState) => BufferGeometry
  timing: { arrivalMs: number; decayMs: number; lastStageMs: number; lastFieldMs: number }
  /** Arrival ages by part: [earliest, latest]. */
  arrival: Record<string, [number, number]>
  decaySamples: number
  /**
   * The mature mesh itself (the reference form, vertex for vertex), carrying for each vertex when its tissue arrives (aArrival,
   * on the ecological order of emergence) and how far inside the surface the tissue's middle lies (aHalf). Drawn with the
   * growth shader it grows continuously with age, from this one mesh: nothing is rebuilt for an age.
   */
  grown: () => BufferGeometry
}
export type GrownOverhang3 = Colony & { life?: OverhangLife }

/** When the outlier starts growing from its own roots, in raw time (the keep starts at 0). */
/** Water deeper than this (metres) is too deep to root in. */
const SHALLOW = 0.8
/** A body's base may hang this far above the ground (organism metres) before it is read as an arch, and left open. */
const FOOTING_GAP = 8
const OUTLIER_START = 30
/**
 * Growth parts: the owners (0–7), with the outlier (9, part of the keep's field) and the lower shelf and knuckle (8,
 * part of the shelf's owner) told apart. Each part's speed, the delay with which it starts once reached, and the
 * crossings growth may not make (the great shelf grows out from the keep, not up from the outlier or back from the lower
 * shelf; the lower shelf grows from the outlier, not down from the great shelf).
 */
const LOWER = 8
const OUTLIER = 9
const SPEED = [1.0, 1.6, 1.0, 2.0, 1.0, 1.0, 1.2, 0.8, 1.4, 1.0]
const DELAY = [0, 18, 26, 0, 20, 35, 4, 2, 14, 0]
const BARRED: [number, number][] = [
  [OUTLIER, 1],
  [LOWER, 1],
  [1, LOWER],
]
/** The recessions, and the window of ages in which each recedes (see livingLife.ts decayTimes). */
const CLEFT = 1
const RECESS = 2
const WELL = 3
const POCKET = 4
const BITE = 5
const OLD_HOLE = 6
const OLD_GAP = 7
const RECEDES: Record<number, [number, number]> = {
  [CLEFT]: [0.5, 0.62],
  [RECESS]: [0.55, 0.7],
  [WELL]: [0.62, 0.72],
  [POCKET]: [0.66, 0.8],
  [BITE]: [0.7, 0.82],
  [OLD_HOLE]: [0.74, 0.84],
  [OLD_GAP]: [0.78, 0.86],
}
const PART = ['keep', 'shelf', 'foot', 'oldShelf', 'pier', 'curtain', 'mezzanine', 'runner', 'lowerShelf', 'outlier']

export function growOverhang3(world: World, seed: number, options: Overhang3Options = {}): GrownOverhang3 {
  const started = performance.now()
  const variation = options.variation ?? 0
  const rand = rng((seed ^ Math.imul(variation + 11, 0x5bd1e995)) >>> 0)
  const jitter = (base: number, spread: number) => base * (1 + (rand() * 2 - 1) * spread)
  const form = options.form ?? {}
  const size = form.size ?? 1
  const step = form.step ?? STEP
  const [sx, sz] = form.site ?? chooseSite(world, seed)
  const g0 = landscapeHeight(sx, sz)

  // ------------------------------------------------------------------------------------------------ frame
  let lx = 0
  let lz = 0
  for (const h of [8, 10, 12, 14, 16]) {
    const d = sunAt(h, 55).direction
    lx += d[0]
    lz += d[2]
  }
  const mean = norm([lx, 0, lz])
  const yaw = form.yaw ?? 0
  const a: V = yaw === 0 ? mean : [mean[0] * Math.cos(yaw) - mean[2] * Math.sin(yaw), 0, mean[0] * Math.sin(yaw) + mean[2] * Math.cos(yaw)]
  const b: V = [-a[2], 0, a[0]]
  const toWorld = (u: number, w: number, y: number): V =>
    size === 1 ? [sx + a[0] * u + b[0] * w, g0 + y, sz + a[2] * u + b[2] * w] : [sx + (a[0] * u + b[0] * w) * size, g0 + y * size, sz + (a[2] * u + b[2] * w) * size]
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
  if (form.keep !== undefined && form.keep !== 1) for (const m of masses) m.top *= form.keep
  if (form.spread !== undefined && form.spread !== 1) {
    for (const m of masses) {
      m.hu *= form.spread
      m.hw *= form.spread
      m.top /= Math.sqrt(form.spread)
    }
    plinth.hu *= form.spread
    plinth.hw *= form.spread
  }
  // Crowded or shaded ground unbalances the masses: the rear one lowers, the water-side one narrows, the mouth-side one and the
  // plinth shift to one side.
  const asym = form.asym ?? 0
  if (asym > 0) {
    masses[0]!.top *= 1 - 0.12 * asym
    masses[1]!.hw *= 1 - 0.3 * asym
    masses[1]!.cw += cs * asym * 4
    masses[2]!.cw -= cs * asym * 5
    masses[2]!.hu *= 1 + 0.25 * asym
    plinth.cw += cs * asym * 3
    plinth.hw *= 1 + 0.12 * asym
  }
  const dominance = form.dominance ?? 0
  if (dominance > 0) {
    masses[0]!.top *= 1 + 0.2 * dominance
    masses[0]!.hu *= 1 + 0.1 * dominance
    masses[0]!.hw *= 1 + 0.1 * dominance
    masses[1]!.top *= 1 + 0.1 * dominance
  }
  const shore = form.shore ?? 0
  // Without the low mass the mouth side is only the plinth.
  if (form.lowMass === false) masses[2]!.top = Math.min(masses[2]!.top, plinth.top)
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
  // Shaded hollows in the keep that have drawn back: the rear face, and a grotto off the undercroft.
  const recesses: { c: V; r: V }[] = [
    { c: [masses[0]!.cu - masses[0]!.hu, jitter(9, 0.3), masses[0]!.cw + (rand() - 0.5) * 6], r: [5, jitter(3.4, 0.2), jitter(9, 0.2)] },
    { c: [masses[2]!.cu + masses[2]!.hu * 0.4, 3.2, masses[2]!.cw - cs * masses[2]!.hw], r: [jitter(6, 0.2), 4.6, 5.5] },
  ]
  // Two bodies, not a bridge. The keep is the old, large body; out toward the light stands a second, younger body of the
  // same tissue (the outlier), rooted where the ground is moist. The great shelf grows from the keep toward the light and
  // comes to rest on the outlier's shoulder; a second, lower shelf grows from the outlier back under the great shelf's end
  // and out past it, offset toward the water. The two shelves overlap, at different heights and depths, touching at one
  // knuckle where load passes between them.
  //
  // The great shelf: out from the keep, swinging a little toward the mouth side, narrowing at its waist, settling and
  // thickening where it bears on the outlier. Its growth edge settles rather than lifts: a thick, rounded, slightly
  // drooping rim, the lower, older stratum stopping short of it.
  const shelf = {
    root: keepFace - 24 * S,
    tip: keepFace + jitter(38, 0.08) * S,
    top: jitter(19, 0.06) * S,
    thickRoot: jitter(6.8, 0.1),
    thickTip: jitter(3.8, 0.1),
    hwRoot: jitter(16, 0.1) * S,
    hwWaist: jitter(11.5, 0.1) * S,
    hwTip: jitter(12.5, 0.1) * S,
    cw: cw0 + (rand() - 0.5) * 3,
    swing: -cs * jitter(4.5, 0.3) * S,
    settle: jitter(1.2, 0.3),
    reinforce: jitter(2, 0.25),
    droop: jitter(1.3, 0.3),
    haunch: jitter(3.5, 0.2),
  }
  if (form.reach !== undefined && form.reach !== 1) shelf.tip = keepFace + (shelf.tip - keepFace) * form.reach
  if (form.shelfLift !== undefined && form.shelfLift !== 1) shelf.top *= form.shelfLift
  if (dominance > 0) {
    shelf.tip = keepFace + (shelf.tip - keepFace) * (1 + 0.22 * dominance)
    shelf.thickRoot *= 1 + 0.2 * dominance
    shelf.hwRoot *= 1 + 0.08 * dominance
  }
  if (form.swing !== undefined && form.swing !== 1) shelf.swing *= form.swing
  const rise = 1 + (form.rise ?? 0)
  const footT = jitter(0.86, 0.03)
  const along = (u: number) => clamp01((u - keepFace) / (shelf.tip - keepFace))
  const bump = (t: number, c: number, width: number) => Math.exp(-(((t - c) / width) ** 2))
  const shelfCwAt = (u: number) => shelf.cw + shelf.swing * Math.sin(along(u) * Math.PI * 0.7)
  const shelfTopAt = (u: number) => {
    const t = along(u)
    return shelf.top + rise * t - shelf.settle * bump(t, footT, 0.25) - 0.9 * smoothstep(0.85, 1, t)
  }
  const shelfThickAt = (u: number) => {
    const t = along(u)
    return shelf.thickRoot + (shelf.thickTip - shelf.thickRoot) * t ** 0.8 + shelf.reinforce * bump(t, footT, 0.14)
  }
  const shelfHwAt = (u: number) => {
    const t = along(u)
    return t < 0.45 ? shelf.hwRoot + (shelf.hwWaist - shelf.hwRoot) * smoothstep(0, 0.45, t) : shelf.hwWaist + (shelf.hwTip - shelf.hwWaist) * smoothstep(0.45, 1, t)
  }
  const shelfBottomAt = (u: number) => shelfTopAt(u) - shelfThickAt(u)
  // Local recession: shallow pockets in the shaded underside, and bites out of the shaded, damp water-side edge.
  const pockets = [0.2, 0.42, 0.62].map((t) => {
    const u = keepFace + t * (shelf.tip - keepFace)
    return { u, w: shelfCwAt(u) + (rand() - 0.5) * 6, r: [jitter(5, 0.2), jitter(1.8, 0.2), jitter(4, 0.2)] as V }
  })
  const bites = [0.32].map((t) => {
    const u = keepFace + jitter(t, 0.1) * (shelf.tip - keepFace)
    return { u, r: [jitter(4.5, 0.2), 6, jitter(3.4, 0.2)] as V }
  })
  const tangent = (u: number): [number, number] => {
    const s = (shelfCwAt(u + 2) - shelfCwAt(u - 2)) / 4
    const l = Math.hypot(1, s)
    return [1 / l, s / l]
  }
  // The outlier: the second body, with the keep's own strata (it is one of the keep's masses, so it shares their bands,
  // ledges and recessed grooves), set toward the water side so the great shelf's end lands on its shoulder.
  const outlier = {
    cu: shelf.tip + jitter(4, 0.3) * S,
    cw: shelfCwAt(shelf.tip) + cs * jitter(6, 0.2) * S,
    hu: jitter(8.5, 0.12) * S,
    hw: jitter(8, 0.12) * S,
    top: shelfBottomAt(shelf.tip) + jitter(1.5, 0.3),
    taper: jitter(0.16, 0.3),
  }
  const hasOutlier = form.outlier ?? true
  if (hasOutlier) masses.push(outlier)
  // The lower shelf, grown from the outlier: back just under the great shelf's end (not into the undercroft), and well out
  // past the outlier toward the light, so the masses step down outward: keep, great shelf, outlier, lower shelf. It is angled across the great shelf, not parallel to it, and rises a little toward the outlier.
  const lobe = {
    u0: outlier.cu - outlier.hu - jitter(5, 0.2),
    u1: outlier.cu + outlier.hu + jitter(13, 0.15) * S,
    cw: outlier.cw + cs * jitter(2, 0.4),
    skew: cs * jitter(0.16, 0.25),
    hw: jitter(9.5, 0.12) * S,
    top: jitter(10.5, 0.06) * S,
    rise: jitter(1, 0.3),
    thick: jitter(3.6, 0.1),
  }
  const lobeMid = (lobe.u0 + lobe.u1) / 2
  const lobeCwAt = (u: number) => lobe.cw + (u - lobeMid) * lobe.skew
  const lobeTopAt = (u: number) => lobe.top + lobe.rise * clamp01((u - lobe.u0) / (lobe.u1 - lobe.u0)) ** 0.7
  // The knuckle: where the two shelves overlap, the one place they have grown together and pass load.
  const knuckle = (() => {
    const u = lobe.u0 + jitter(4, 0.2)
    const aLo = shelfCwAt(u) - shelfHwAt(u)
    const aHi = shelfCwAt(u) + shelfHwAt(u)
    const bLo = lobeCwAt(u) - lobe.hw
    const bHi = lobeCwAt(u) + lobe.hw
    const w = (Math.max(aLo, bLo) + Math.min(aHi, bHi)) / 2
    const yTop = shelfBottomAt(u)
    const yBottom = lobeTopAt(u)
    return { c: [u, (yTop + yBottom) / 2, w] as V, r: [jitter(3.6, 0.2), Math.max(2, (yTop - yBottom) / 2 + 1.4), jitter(3, 0.2)] as V }
  })()
  type Fin = { o: [number, number]; dir: [number, number]; top: number; g: [number, number]; t: [number, number]; h: [number, number]; lean: number; pg: number; pt: number }
  // The outlier's buttress: a fin from its keep-facing flank, swept up under the great shelf toward the keep, where the
  // shelf's load comes down on it. Toes run out from the outlier's base away from the keep.
  const finO: [number, number] = [outlier.cu - outlier.hu + 1, shelfCwAt(outlier.cu - outlier.hu)]
  const toKeep: [number, number] = [-tangent(finO[0])[0], -tangent(finO[0])[1]]
  const fins: Fin[] = [{ o: finO, dir: toKeep, top: shelfBottomAt(finO[0]) + 1.5, g: [-1, jitter(3, 0.2)], t: [-2, jitter(8, 0.15)], h: [jitter(4.2, 0.1), 2.8], lean: -cs * jitter(1.5, 0.4), pg: 1, pt: 1.7 }]
  const toes = [0.4, -0.5].map((turn) => {
    const ang = Math.atan2(waterLocal[1], waterLocal[0]) * 0.3 + turn
    const p0: V = [outlier.cu + Math.cos(ang) * outlier.hu * 0.8, 0.5, outlier.cw + Math.sin(ang) * outlier.hw * 0.8]
    return { p0, p1: [p0[0] + Math.cos(ang) * jitter(9, 0.2) * (1 + 1.1 * shore), -1.4, p0[2] + Math.sin(ang) * jitter(9, 0.2) * (1 + 1.1 * shore)] as V, r0: 2.8 * (1 + 0.5 * shore), r1: 0.8 }
  })
  // The load rib under the great shelf, along its trajectory, from the outlier back to the keep.
  const ribOff = cs * jitter(1.5, 0.5)
  const rib: V[] = Array.from({ length: 7 }, (_, i) => {
    const u = finO[0] - 6 - ((finO[0] - 6 - (keepFace - 2)) * i) / 6
    return [u, shelfBottomAt(u) - 0.4, shelfCwAt(u) + ribOff]
  })
  const ribR = jitter(2.4, 0.15)
  // The one subordinate pier: a raking blade on the water side whose head leans toward the keep (it carries the rib's
  // load back toward the oldest support), its foot thrust away from it.
  const pierU = keepFace + jitter(13, 0.2) * S
  const pierFin: Fin = {
    o: [pierU, shelfCwAt(pierU) + cs * jitter(4, 0.3)],
    dir: [-tangent(pierU)[0], -tangent(pierU)[1]],
    top: shelfBottomAt(pierU) + 1.2,
    g: [-jitter(3.5, 0.2), jitter(1.5, 0.3)],
    t: [jitter(1.5, 0.3), jitter(8, 0.2)],
    h: [jitter(2.3, 0.1), 1.5],
    lean: cs * jitter(1.2, 0.4),
    pg: 1,
    pt: 1.3,
  }
  // The old shelf: an earlier growth from high on the rear mass, toward an earlier light, now ageing. It has crept and
  // sagged, thinned and frayed at its edges, been holed where tissue died, and broken: its outer part has slumped onto the
  // great shelf below and fused there.
  const oldS = {
    o: [masses[0]!.cu + masses[0]!.hu * 0.45, masses[0]!.cw - cs * 2] as [number, number],
    yaw: -cs * jitter(0.5, 0.25),
    len: jitter(25, 0.12) * S,
    top: Math.min(masses[0]!.top - 4, jitter(29, 0.05) * S),
    sag: jitter(3.2, 0.25),
    thick: [jitter(3.8, 0.1), jitter(1.6, 0.15)] as [number, number],
    hw: [jitter(8, 0.12), jitter(5, 0.15)] as [number, number],
    breakAt: jitter(0.6, 0.08),
    gap: jitter(2.6, 0.2),
    holes: [
      { s: jitter(0.28, 0.15), q: (rand() - 0.5) * 6, r: jitter(1.5, 0.2) },
      { s: jitter(0.46, 0.1), q: (rand() - 0.5) * 5, r: jitter(1.1, 0.2) },
    ],
  }
  const oldDir: [number, number] = [Math.cos(oldS.yaw), Math.sin(oldS.yaw)]
  const oldEnd = [oldS.o[0] + oldDir[0] * oldS.len, oldS.o[1] + oldDir[1] * oldS.len]
  const oldRestTop = shelfTopAt(oldEnd[0]!) + oldS.thick[1] + 0.2
  const mezz = {
    u0: masses[1]!.cu - 2,
    u1: keepFace + jitter(10, 0.2) * S,
    w0: shelf.cw + cs * 2,
    w1: shelf.cw + cs * (shelf.hwRoot + jitter(3, 0.4)),
    top: jitter(9.5, 0.08) * S,
    thick: jitter(2.6, 0.15),
    sag: jitter(1.6, 0.3),
  }
  const well = { u: keepFace + jitter(5, 0.3), dw: -cs * jitter(6, 0.25), hu: jitter(2.6, 0.2), hw: jitter(5, 0.2) }
  // Only near the keep, where it is dampest and most shaded, has the rim grown down: beyond it the undercroft looks through.
  const curtain = { u0: keepFace - 2, u1: keepFace + jitter(13, 0.15) * S, thick: jitter(1.5, 0.15), setback: jitter(6, 0.2) }
  const fissure = { u: keepFace + jitter(6, 0.15) * S, half: jitter(1.6, 0.15) }
  const runner = (() => {
    const start: V = [plinth.cu + waterLocal[0] * plinth.hu * 0.8, -0.8, plinth.cw + waterLocal[1] * plinth.hw * 0.8]
    const length = jitter(24, 0.2) * (1 + 0.9 * shore)
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
  const U1 = hasOutlier ? Math.max(lobe.u1 + 12, outlier.cu + outlier.hu + 22) : shelf.tip + 14
  const W0 = -36
  const W1 = 36
  const Y0 = -10
  const Y1 = keepTop + 6
  const dx = Math.ceil((U1 - U0) / step) + 1
  const dy = Math.ceil((Y1 - Y0) / step) + 1
  const dz = Math.ceil((W1 - W0) / step) + 1
  const field = new Float32Array(dx * dy * dz)
  const owner = new Uint8Array(dx * dy * dz)
  /** Which part's growth each sample belongs to: the owners, with the outlier and the lower shelf told apart. */
  const part = new Uint8Array(dx * dy * dz)
  // With the lifecycle: the field before anything receded (signed distance, positive outside), and which recession
  // (cleft, recess, well, pocket, bite, hole, break) took each sample, the one it lies deepest in.
  const fullField = options.life ? new Float32Array(dx * dy * dz) : null
  const recessionOf = new Uint8Array(options.life ? dx * dy * dz : 0)
  let recession = 0
  let recessionDepth = Infinity
  const recede = (cutSd: number, id: number) => {
    if (cutSd < recessionDepth) {
      recessionDepth = cutSd
      recession = id
    }
  }
  const fidx = (x: number, y: number, z: number) => (z * dy + y) * dx + x
  const groundLocal = new Float32Array(dx * dz)
  /** Columns whose ground lies under more than a shallow depth of water: no root or footing may take hold there. */
  const deepLocal = new Uint8Array(dx * dz)
  const anchored = form.anchored === true
  for (let z = 0; z < dz; z += 1) {
    for (let x = 0; x < dx; x += 1) {
      const p = toWorld(U0 + x * step, W0 + z * step, 0)
      groundLocal[z * dx + x] = (landscapeHeight(p[0], p[2]) - g0) / size
      if (anchored && world.water.depthAt(p[0], p[2]) > SHALLOW) deepLocal[z * dx + x] = 1
    }
  }
  const nseed = (seed % 997) + variation * 13.7

  /** A directional fin: a blade along `dir` whose span along it runs from g (at the ground) to t (at its top), curving
   *  between (the exponents), thickening toward the ground, leaning across by `lean` at the top. */
  const fin = (u: number, y: number, w: number, F: Fin) => {
    const pu = u - F.o[0]
    const pw = w - F.o[1]
    const s = pu * F.dir[0] + pw * F.dir[1]
    const q = -pu * F.dir[1] + pw * F.dir[0]
    const t = clamp01(y / F.top)
    const lo = F.g[0] + (F.t[0] - F.g[0]) * t ** F.pg
    const hi = F.g[1] + (F.t[1] - F.g[1]) * t ** F.pt
    const along = Math.max(lo - s, s - hi) * 0.75
    const across = Math.abs(q - F.lean * t) - (F.h[0] + (F.h[1] - F.h[0]) * t)
    const r = 1.4
    const a2 = Math.hypot(Math.max(along + r, 0), Math.max(across + r, 0)) + Math.min(Math.max(along + r, across + r), 0) - r
    return slab(a2, y, -4, F.top, 1)
  }

  /**
   * The keep's field; `keepOutlier` is set when the outlier is the nearest of its masses (the growth part, not the owner),
   * and `keepFull` is the field before its recessions (the cleft and the recesses) were cut.
   */
  let keepOutlier = false
  let keepFull = 0
  const keepField = (u: number, w: number, y: number, np: number): number => {
    // The band this height is in, and where in it.
    let band = bands[0]!
    for (const B of bands) if (y >= B.y0) band = B
    const t = clamp01((y - band.y0) / (band.y1 - band.y0))
    let d = Infinity
    let nearest = Infinity
    keepOutlier = false
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
      const dm = slab(d2, y, -8, m.top, 1.6)
      if (dm < nearest) {
        nearest = dm
        keepOutlier = m === outlier
      }
      d = d === Infinity ? dm : smin(d, dm, 1.6)
    }
    // The plinth: the oldest, mineral tissue, broad and battered toward the ground.
    const batter = 2.4 * (1 - smoothstep(-2, plinth.top, y))
    const pd = slab(rect2(u - plinth.cu, w - plinth.cw, plinth.hu, plinth.hw, 8) - batter - np * 1.2, y, -8, plinth.top, 1.4)
    d = smin(d, pd, 2.5)
    keepFull = d
    // The cleft between the rear and the water-side masses, above the plinth.
    const cleftD = slab(rect2(u - cleft.u, w - (cleft.w0 + cleft.w1) / 2, cleft.half + 0.4 * (vnoise(y / 4, nseed, 5) - 0.5), Math.abs(cleft.w1 - cleft.w0) / 2, 0.6), y, cleft.from, keepTop + 4, 1)
    d = smax(d, -cleftD, 1.2)
    recede(cleftD, CLEFT)
    for (const R of recesses) {
      const e = ellipsoid(u, y, w, R.c, R.r)
      d = smax(d, -e, 1.6)
      recede(e, RECESS)
    }
    return d
  }

  const sample = (u: number, w: number, y: number): [number, number, number, number] => {
    const np = 2 * (vnoise(u / 17 + nseed, w / 17, 0.5) - 0.5) * 1.6 + 2 * (vnoise(u / 6.5, w / 6.5 + nseed, 3.1) - 0.5) * 0.45
    const n3 = 2 * (vnoise(u / 11 + 4.1, y / 8, w / 11 + nseed) - 0.5) * 0.3
    let best = Infinity
    let full = Infinity
    let who = KEEP
    let part: number = KEEP
    recession = 0
    recessionDepth = Infinity
    // Each part is put twice over: as it is (the reference) and as it was before anything receded (the full field).
    const put = (d: number, id: number, k: number, grows: number = id, dFull: number = d) => {
      if (d < best) {
        who = id
        part = grows
      }
      best = best === Infinity ? d : smin(best, d, k)
      full = full === Infinity ? dFull : smin(full, dFull, k)
    }

    const dk = keepField(u, w, y, np)
    put(dk, KEEP, 1, keepOutlier ? OUTLIER : KEEP, keepFull)

    // Great shelf: a plan that follows its trajectory, two strata (the lower, older one stops short of the growth front),
    // a haunch at the root, a lip that thickens downward, and local recession.
    {
      const cwu = shelfCwAt(u)
      const slope = (shelfCwAt(u + 1) - shelfCwAt(u - 1)) / 2
      const hw = shelfHwAt(u)
      const R = Math.min(hw, 9)
      const qa = (Math.abs(w - cwu) - hw) / Math.hypot(1, slope) + R
      const qb = Math.max(shelf.root - u, u - shelf.tip) + R
      let d2 = Math.hypot(Math.max(qa, 0), Math.max(qb, 0)) + Math.min(Math.max(qa, qb), 0) - R - np * 0.8
      const d2Full = d2
      for (const B of bites) {
        const e = ellipsoid(u, 0, w, [B.u, 0, shelfCwAt(B.u) + cs * shelfHwAt(B.u)], [B.r[0], 1, B.r[2]])
        d2 = smax(d2, -e, 1.4)
        recede(e, BITE)
      }
      const wellD = rect2(u - well.u, w - (shelfCwAt(well.u) + well.dw), well.hu, well.hw, Math.min(well.hu, well.hw) * 0.9) + 0.5 * (vnoise(u / 3, w / 3, nseed) - 0.5)
      d2 = smax(d2, -wellD, 1)
      recede(wellD, WELL)
      const t = along(u)
      const top = shelfTopAt(u)
      const thick = shelfThickAt(u)
      const split = top - thick * 0.45
      const front = 1.6 * smoothstep(0.8, 1, t)
      const shelfOf = (plan: number) => {
        const edge = 1 - smoothstep(-6, -0.5, plan)
        const haunch = shelf.haunch * Math.exp(-Math.max(0, u - keepFace) / 4) * smoothstep(-4, -10, plan)
        return [slab(plan, y, split - 0.3, top, 1.2), slab(plan + 1.6 + front - 1.1 * edge, y, top - thick - shelf.droop * edge - haunch, split, 1.2)] as const
      }
      const [upper, lowerFresh] = shelfOf(d2)
      let lowerS = lowerFresh
      for (const P of pockets) {
        const e = ellipsoid(u, y, w, [P.u, shelfBottomAt(P.u), P.w], P.r)
        lowerS = smax(lowerS, -e, 1.2)
        recede(e, POCKET)
      }
      const [upperFull, lowerFull] = d2Full === d2 ? [upper, lowerFresh] : shelfOf(d2Full)
      put(smin(upper, lowerS, 0.8), SHELF, 2, SHELF, smin(upperFull, lowerFull, 0.8))
    }

    // The load rib, along the shelf's trajectory.
    for (let i = 0; i < rib.length - 1; i += 1) put(capsule([u, y, w], rib[i]!, rib[i + 1]!, ribR * (1 - 0.04 * i), ribR * (1 - 0.04 * (i + 1))) * 0.9, SHELF, 2.4)

    // The foot's fins and toes, and the pier.
    if (hasOutlier) for (const F of fins) put(fin(u, y, w, F) + 0.35 * np, FOOT, 2.6)
    if (hasOutlier) for (const T of toes) put(capsule([u, y, w], T.p0, T.p1, T.r0, T.r1), FOOT, 2.2)

    // The lower shelf, grown from the outlier, and the knuckle where it meets the great shelf.
    if (hasOutlier) {
      const cwu = lobeCwAt(u)
      const R = 6
      const qa = (Math.abs(w - cwu) - lobe.hw) / Math.hypot(1, lobe.skew) + R
      const qb = Math.max(lobe.u0 - u, u - lobe.u1) + R
      const d2 = Math.hypot(Math.max(qa, 0), Math.max(qb, 0)) + Math.min(Math.max(qa, qb), 0) - R - np * 0.8
      const top = lobeTopAt(u)
      const edge = 1 - smoothstep(-5, -0.5, d2)
      const split = top - lobe.thick * 0.5
      const upper = slab(d2, y, split - 0.3, top, 1.1)
      const lower = slab(d2 + 1.4 - 0.9 * edge, y, top - lobe.thick - 1.1 * edge, split, 1.1)
      put(smin(upper, lower, 0.7), SHELF, 2.2, LOWER)
      put(ellipsoid(u, y, w, knuckle.c, knuckle.r), SHELF, 2.6, LOWER)
    }
    put(fin(u, y, w, pierFin) + 0.3 * np, SPINE, 2.2)

    // The old shelf: sagging, frayed, holed, broken, its outer part slumped onto the great shelf.
    if (form.oldShelf ?? true) {
      const pu = u - oldS.o[0]
      const pw = w - oldS.o[1]
      const s = pu * oldDir[0] + pw * oldDir[1]
      const q = -pu * oldDir[1] + pw * oldDir[0]
      const t = clamp01(s / oldS.len)
      const fray = 2 * (vnoise(s / 3.5 + nseed, q / 3.5, 4.4) - 0.5) * (0.6 + 1.4 * t)
      const hw = oldS.hw[0] + (oldS.hw[1] - oldS.hw[0]) * t - fray
      const breakS = oldS.breakAt * oldS.len
      const thick = oldS.thick[0] + (oldS.thick[1] - oldS.thick[0]) * t
      const topIn = oldS.top - oldS.sag * t ** 1.6
      // Beyond the break the fragment tilts down from where it broke to where it came to rest on the great shelf.
      const f = clamp01((s - breakS - oldS.gap) / Math.max(1, oldS.len - breakS - oldS.gap))
      const topAtBreak = oldS.top - oldS.sag * oldS.breakAt ** 1.6 - 0.8
      const top = s > breakS + oldS.gap ? topAtBreak + (oldRestTop - topAtBreak) * f : topIn
      const d2 = Math.max(Math.abs(q) - hw, Math.max(-s - 6, s - oldS.len))
      let d = slab(d2, y, top - thick - 0.8 * (1 - smoothstep(-3, -0.5, d2)), top, 0.9)
      const dFull = d
      const gap = Math.abs(s - (breakS + oldS.gap / 2)) - oldS.gap / 2 - 0.8 * (vnoise(q / 2 + nseed, y / 2, 6.6) - 0.5)
      d = smax(d, -gap, 0.6)
      recede(gap, OLD_GAP)
      for (const H of oldS.holes) {
        const hole = Math.hypot(s - H.s * oldS.len, q - H.q) - H.r - 0.3 * (vnoise(y, s / 2, nseed) - 0.5)
        d = smax(d, -hole, 0.6)
        recede(hole, OLD_HOLE)
      }
      put(d, DECK, 1.8, DECK, dFull)
    }

    // Mezzanine: the earlier low shelf on the water side, sagging toward its free end; the aisle runs under it.
    if (form.mezzanine ?? true) {
      const cu = (mezz.u0 + mezz.u1) / 2
      const hu = (mezz.u1 - mezz.u0) / 2
      const cw = (mezz.w0 + mezz.w1) / 2
      const hw = Math.abs(mezz.w1 - mezz.w0) / 2
      const ragged = 2 * (vnoise(u / 4 + nseed, w / 4, 7.7) - 0.5) * 1.6
      const d2 = rect2(u - cu, w - cw, hu, hw, 4) - ragged - np * 0.6
      const edge = 1 - smoothstep(-3, -0.5, d2)
      const top = mezz.top - mezz.sag * clamp01((u - mezz.u0) / (mezz.u1 - mezz.u0)) ** 1.5
      put(slab(d2, y, top - mezz.thick - 0.8 * edge, top, 1), MEZZANINE, 2.4)
    }

    // Curtain: a short wing on the water side near the keep, set back under the shelf, split by the fissure.
    if (form.curtain ?? true) {
      const edgeW = shelfCwAt(u) + cs * (shelfHwAt(u) - curtain.setback)
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
    return [best + n3, who, part, full + n3]
  }

  for (let z = 0; z < dz; z += 1) {
    const w = W0 + z * step
    for (let x = 0; x < dx; x += 1) {
      const u = U0 + x * step
      const g = groundLocal[z * dx + x]!
      for (let y = 0; y < dy; y += 1) {
        const yy = Y0 + y * step
        let [d, who, grows, df] = sample(u, w, yy)
        if (yy < g - 1.2) {
          d = Math.max(d, g - 1.2 - yy)
          df = Math.max(df, g - 1.2 - yy)
        }
        field[fidx(x, y, z)] = -d
        owner[fidx(x, y, z)] = who
        part[fidx(x, y, z)] = grows
        if (fullField) {
          fullField[fidx(x, y, z)] = df
          recessionOf[fidx(x, y, z)] = recession
        }
      }
    }
  }
  // Anchoring (organisms other than the reference): a body hovering over sloping ground grows down to it, then whatever is
  // not joined to tissue standing on land (or in shallows) is dropped.
  let anchoredAway = 0
  const columnsOf = { dx, dy, dz, Y0, step }
  if (anchored) {
    for (let z = 0; z < dz; z += 1) {
      for (let x = 0; x < dx; x += 1) {
        if (deepLocal[z * dx + x]) continue
        const g = groundLocal[z * dx + x]!
        const first = Math.max(0, Math.ceil((g - 1.2 - Y0) / step))
        let low = -1
        for (let y = first; y < dy; y += 1) {
          if (field[fidx(x, y, z)]! > 0) {
            low = y
            break
          }
        }
        if (low <= first) continue
        const who = owner[fidx(x, low, z)]!
        const kind = part[fidx(x, low, z)]!
        if (kind !== KEEP && kind !== FOOT && kind !== OUTLIER) continue
        if (Y0 + low * step - g > FOOTING_GAP) continue
        for (let y = first; y < low; y += 1) {
          const i = fidx(x, y, z)
          field[i] = 0.5
          owner[i] = who
          part[i] = kind
          if (fullField) fullField[i] = -0.5
        }
      }
    }
    anchoredAway = anchorField(field, fullField, columnsOf, groundLocal, deepLocal)
  }
  const grownAt = performance.now()

  // ------------------------------------------------------------------------------------------------ surface and record
  const heading = (prevailingWind(seed) * Math.PI) / 180
  const wind: V = [Math.cos(heading), 0, Math.sin(heading)]
  /**
   * The mesh and its growth record for a field (the mesher's sign: inside positive). With `life`, each vertex also carries
   * when its tissue arrived (aArrival) and, where it later recedes, when it goes (aDecay), from the cell it lies in.
   */
  const buildGeometry = (f: Float32Array, life?: { arrival: Float32Array; decay: Float32Array | null; late?: { state: LateState; weights: LateWeights; age: number }; half?: boolean }) => {
    const net = surfaceNets(f, dx, dy, dz, [0, 0, 0])
    const count = net.positions.length / 3
    const positions = new Float32Array(count * 3)
    const normals = new Float32Array(count * 3)
    const colours = new Float32Array(count * 3)
    const recordA = new Float32Array(count * 4)
    const recordB = new Float32Array(count * 4)
    const inside = (gx: number, gy: number, gz: number) => {
      const x = Math.round(gx)
      const y = Math.round(gy)
      const z = Math.round(gz)
      if (x < 0 || y < 0 || z < 0 || x >= dx || y >= dy || z >= dz) return 0
      return f[fidx(x, y, z)]! > 0 ? 1 : 0
    }
    let top = 0
    for (let v = 0; v < count; v += 1) {
      const gx = net.positions[v * 3]!
      const gy = net.positions[v * 3 + 1]!
      const gz = net.positions[v * 3 + 2]!
      const u = U0 + gx * step
      const y = Y0 + gy * step
      const w = W0 + gz * step
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
          open += 1 - inside(gx + (ou * s) / step, gy + (oy * s) / step, gz + (ow * s) / step)
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
    if (life) {
      const arrivalAttr = new Float32Array(count)
      const decayAttr = new Float32Array(count).fill(NEVER)
      for (let v = 0; v < count; v += 1) {
        const x0 = Math.min(dx - 2, Math.max(0, Math.floor(net.positions[v * 3]!)))
        const y0 = Math.min(dy - 2, Math.max(0, Math.floor(net.positions[v * 3 + 1]!)))
        const z0 = Math.min(dz - 2, Math.max(0, Math.floor(net.positions[v * 3 + 2]!)))
        let sum = 0
        let k = 0
        let td = NEVER
        for (let c = 0; c < 8; c += 1) {
          const i = fidx(x0 + (c & 1), y0 + ((c >> 1) & 1), z0 + ((c >> 2) & 1))
          const t = life.arrival[i]!
          if (t > 0) {
            sum += t
            k += 1
          }
          if (life.decay) td = Math.min(td, life.decay[i]!)
        }
        arrivalAttr[v] = k > 0 ? sum / k : 0
        decayAttr[v] = td
        if (life.late) {
          // Later life on the surface: new growth at the tips reads young; eroding tissue weathers (its vitality falls, so
          // it turns chalky, and charcoal where the erosion has gone deepest), less where it is healing.
          const { state, weights } = life.late
          let grow = 0
          let wear = 0
          for (let c = 0; c < 8; c += 1) {
            const i = fidx(x0 + (c & 1), y0 + ((c >> 1) & 1), z0 + ((c >> 2) & 1))
            grow = Math.max(grow, weights.grow[i]!)
            wear = Math.max(wear, weights.recede[i]! * (1 - state.regen * weights.regen[i]!))
          }
          if (grow * state.grow > 0.3) arrivalAttr[v] = Math.max(arrivalAttr[v]!, life.late.age - 0.06)
          recordA[v * 4 + 1] = Math.max(0.05, recordA[v * 4 + 1]! - 0.75 * clamp01((wear * state.recede) / 4))
        }
      }
      geometry.setAttribute('aArrival', new BufferAttribute(arrivalAttr, 1))
      geometry.setAttribute('aDecay', new BufferAttribute(decayAttr, 1))
      if (life.half) {
        // How far in the tissue's middle lies: march in along the inward normal to the far side of the tissue; half of that.
        const half = new Float32Array(count)
        const stride = 0.5
        for (let v = 0; v < count; v += 1) {
          const gx = net.positions[v * 3]!
          const gy = net.positions[v * 3 + 1]!
          const gz = net.positions[v * 3 + 2]!
          const nu = net.normals[v * 3]!
          const ny = net.normals[v * 3 + 1]!
          const nw = net.normals[v * 3 + 2]!
          let s = 1
          for (; s < 36 / (step * size); s += stride) if (!inside(gx - nu * s, gy - ny * s, gz - nw * s)) break
          half[v] = Math.min(16, 0.5 * s * step * size)
        }
        geometry.setAttribute('aHalf', new BufferAttribute(half, 1))
      }
    }
    return { geometry, top, count, triangles: net.indices.length / 3 }
  }
  const built = buildGeometry(field)
  const geometry = built.geometry
  const top = built.top
  const count = built.count

  const headroomAt = (u: number, w: number) => {
    const x = Math.min(dx - 1, Math.max(0, Math.round((u - U0) / step)))
    const z = Math.min(dz - 1, Math.max(0, Math.round((w - W0) / step)))
    const g = groundLocal[z * dx + x]!
    for (let y = Math.ceil((g + 0.5 - Y0) / step); y < dy; y += 1) if (field[fidx(x, y, z)]! > 0) return Y0 + y * step - g
    return Infinity
  }
  const midU = (keepFace + outlier.cu - outlier.hu) / 2
  livingArchitecture.version += 1
  const stats = {
    experiment: 10,
    variation,
    keepHeight: Math.round(keepTop),
    keepRear: Math.round(masses[0]!.top),
    keepWaterSide: Math.round(masses[1]!.top),
    keepMouthSide: Math.round(masses[2]!.top),
    strataBands: bands.length,
    recesses: recesses.length,
    shelfReach: Math.round(shelf.tip - keepFace),
    shelfThickRoot: Math.round(shelf.thickRoot * 10) / 10,
    outlierFromKeep: Math.round(outlier.cu - keepFace),
    outlierHeight: Math.round(outlier.top),
    lowerShelfTop: Math.round(lobe.top),
    lowerShelfSkewDeg: Math.round((Math.atan(lobe.skew) * 180) / Math.PI),
    headroomUndercroft: Math.round(headroomAt(midU, shelfCwAt(midU) - cs * 5) * 10) / 10,
    headroomUnderLowerShelf: Math.round(headroomAt(outlier.cu + outlier.hu + 5, lobeCwAt(outlier.cu + outlier.hu + 5)) * 10) / 10,
    shelfSwing: Math.round(shelf.swing * 10) / 10,
    oldShelfYawDeg: Math.round((oldS.yaw * 180) / Math.PI),
    fissureWidth: Math.round(fissure.half * 20) / 10,
    anchoredAway,
    vertices: count,
    triangles: built.triangles,
    fieldMs: Math.round(grownAt - started),
    milliseconds: Math.round(performance.now() - started),
  }
  return { geometry, site: [sx, sz], ground: g0, organisms: 1, height: top * size, stats, life: options.life ? lifecycle() : undefined }

  function lifecycle(): OverhangLife {
    const grid: LifeGrid = { dx, dy, dz, step }
    const dRef = new Float32Array(field.length)
    for (let i = 0; i < field.length; i += 1) dRef[i] = -field[i]!
    // Growth roots in the ground under the keep's plinth (age 0) and, later, under the outlier.
    const seeds: { index: number; time: number }[] = []
    for (let z = 0; z < dz; z += 1) {
      for (let x = 0; x < dx; x += 1) {
        const u = U0 + x * step
        const g = groundLocal[z * dx + x]!
        for (let y = 0; Y0 + y * step <= g + 1.5; y += 1) {
          const i = fidx(x, y, z)
          if (dRef[i]! >= 0) continue
          if (part[i] === KEEP && u < keepFace + 4) seeds.push({ index: i, time: 0 })
          else if (part[i] === OUTLIER) seeds.push({ index: i, time: OUTLIER_START })
        }
      }
    }
    const dFull = fullField!
    // How much sun reaches each sample near the surface, through the organism's own mass: growth goes faster toward it.
    const sunGrid: V = [sunLocal[0], sunLocal[1], sunLocal[2]]
    const lit = new Float32Array(field.length)
    for (let z = 1; z < dz - 1; z += 1) {
      for (let y = 1; y < dy - 1; y += 1) {
        for (let x = 1; x < dx - 1; x += 1) {
          const i = fidx(x, y, z)
          const d = dRef[i]!
          if (d < -4 || d > 4) continue
          let sun = 1
          for (let k = 3; k <= 30; k += 3) {
            const xx = Math.round(x + (sunGrid[0] * k) / step)
            const yy = Math.round(y + (sunGrid[1] * k) / step)
            const zz = Math.round(z + (sunGrid[2] * k) / step)
            if (xx < 0 || yy < 0 || zz < 0 || xx >= dx || yy >= dy || zz >= dz) break
            if (dRef[fidx(xx, yy, zz)]! < 0) {
              sun = 0.15
              break
            }
          }
          let sky = 1
          for (let k = 3; k <= 15; k += 3) {
            const yy = Math.round(y + k / step)
            if (yy >= dy) break
            if (dRef[fidx(x, yy, z)]! < 0) {
              sky = 0.5
              break
            }
          }
          lit[i] = clamp01(0.8 * sun + 0.2 * sky)
        }
      }
    }
    const boost = new Float32Array(field.length).fill(1)
    for (let i = 0; i < field.length; i += 1) if (lit[i]! > 0) boost[i] = 0.8 + 0.4 * lit[i]!
    const arrival = arrivalTimes(grid, dFull, part, { speed: SPEED, delay: DELAY, barred: BARRED, seeds, shell: 2 * step, noiseSeed: nseed, boost })
    const ranges: Record<string, [number, number]> = {}
    for (let i = 0; i < field.length; i += 1) {
      if (dFull[i]! >= 0) continue
      const name = PART[part[i]!]!
      const t = arrival.time[i]!
      const r = ranges[name] ?? [Infinity, -Infinity]
      ranges[name] = [Math.min(r[0], t), Math.max(r[1], t)]
    }
    for (const k of Object.keys(ranges)) ranges[k] = [Math.round(ranges[k]![0] * 100) / 100, Math.round(ranges[k]![1] * 100) / 100]
    const decay = decayTimes(grid, dFull, dRef, recessionOf, arrival.time, RECEDES)
    // Later life: lit young tissue (the growth fronts) grows on, shaded old tissue recedes, lit recessions refill a little.
    const aboveGround = new Float32Array(field.length)
    for (let z = 0; z < dz; z += 1) for (let x = 0; x < dx; x += 1) for (let y = 0; y < dy; y += 1) aboveGround[fidx(x, y, z)] = Y0 + y * step - groundLocal[z * dx + x]!
    const weights = lateWeights(grid, dRef, arrival.time, decay.time, lit, aboveGround, nseed)
    const work = new Float32Array(field.length)
    const timing = { arrivalMs: arrival.ms, decayMs: decay.ms, lastStageMs: 0, lastFieldMs: 0 }
    const at = (age: number, late?: LateState) => {
      const t0 = performance.now()
      fieldAt(age, dRef, dFull, arrival, decay.time, work, late && (late.grow > 0 || late.recede > 0 || late.regen > 0) ? { state: late, weights } : undefined)
      if (anchored) anchorField(work, null, columnsOf, groundLocal, deepLocal)
      const t1 = performance.now()
      const g = buildGeometry(work, { arrival: arrival.time, decay: decay.time, late: late && (late.grow > 0 || late.recede > 0) ? { state: late, weights, age } : undefined }).geometry
      timing.lastFieldMs = Math.round(t1 - t0)
      timing.lastStageMs = Math.round(performance.now() - t0)
      return g
    }
    // The ecological order of emergence, for the continuous-growth path: the roots and foundations take hold first; the keep
    // rises from them toward the light; the shelves reach out once the keep stands (the light is up there); the piers thicken
    // under a shelf as it extends (the load they carry); the lower shelf and the second body follow; and the curtain and the
    // shaded undercroft come last, as a consequence of what has grown above them.
    const ECO_SPEED = [1.0, 1.5, 1.8, 1.4, 1.0, 0.9, 1.1, 2.4, 1.3, 1.0]
    const ECO_DELAY = [0, 24, 0, 8, 30, 44, 12, 0, 34, 0]
    let grownMesh: BufferGeometry | null = null
    const grown = () => {
      if (!grownMesh) {
        const eco = arrivalTimes(grid, dFull, part, { speed: ECO_SPEED, delay: ECO_DELAY, barred: BARRED, seeds, shell: 2 * step, noiseSeed: nseed, boost })
        grownMesh = buildGeometry(field, { arrival: eco.time, decay: null, half: true }).geometry
      }
      return grownMesh
    }
    return { at, timing, arrival: ranges, decaySamples: decay.samples, grown }
  }
}

/**
 * Drops the tissue (inside is positive) not joined, by faces, to tissue standing on the ground: a sample within 1.5 m of the
 * ground, in a column that is not under deep water. Whatever is joined to it stays, so a shelf, an arch or an undercroft that
 * hangs from a body is kept; a piece cut off from every footing is not. Returns how many samples were dropped.
 */
function anchorField(field: Float32Array, full: Float32Array | null, grid: { dx: number; dy: number; dz: number; Y0: number; step: number }, ground: Float32Array, deep: Uint8Array): number {
  const { dx, dy, dz, Y0, step } = grid
  const seen = new Uint8Array(field.length)
  const queue = new Int32Array(field.length)
  let head = 0
  let tail = 0
  const plane = dx * dy
  for (let z = 0; z < dz; z += 1) {
    for (let x = 0; x < dx; x += 1) {
      const c = z * dx + x
      if (deep[c]) continue
      const top = ground[c]! + 1.5
      for (let y = 0; y < dy && Y0 + y * step <= top; y += 1) {
        const i = z * plane + y * dx + x
        if (field[i]! > 0 && !seen[i]) {
          seen[i] = 1
          queue[tail++] = i
        }
      }
    }
  }
  const visit = (j: number) => {
    if (field[j]! > 0 && !seen[j]) {
      seen[j] = 1
      queue[tail++] = j
    }
  }
  while (head < tail) {
    const i = queue[head++]!
    const x = i % dx
    const y = Math.floor(i / dx) % dy
    const z = Math.floor(i / plane)
    if (x > 0) visit(i - 1)
    if (x < dx - 1) visit(i + 1)
    if (y > 0) visit(i - dx)
    if (y < dy - 1) visit(i + dx)
    if (z > 0) visit(i - plane)
    if (z < dz - 1) visit(i + plane)
  }
  let dropped = 0
  for (let i = 0; i < field.length; i += 1) {
    if (field[i]! > 0 && !seen[i]) {
      field[i] = -0.5
      if (full) full[i] = 0.5
      dropped += 1
    }
  }
  return dropped
}
