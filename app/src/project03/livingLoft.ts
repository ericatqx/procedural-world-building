import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three'
import { sunAt } from '../project/sun.ts'
import { clamp01, smoothstep } from '../project02/core.ts'
import { chooseSite, rng, skin, waterBearing, waterDistance, type V } from './livingArchitecture.ts'
import type { OrganismPlan, Population } from './livingEcology.ts'
import { landscapeHeight } from './terrain.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — LA-01's lofted growth, as ONE connected organism with a whole lifecycle (?architecture=growth).
 *
 * Structure. The organism is a skeleton of growth pathways (the foundation and roots, the keep, the masses, the shelves and
 * their branches, the props, the second body, the shoots of its renewal), each a tube along a centre-line of NODES with a
 * cross-section that swells and tapers. The parts are not drawn as separate solids. The vertex shader places each ring of each
 * part from its nodes and then SHRINK-WRAPS it onto the smooth union of all the parts' distance fields (a blend of a few
 * metres): a part's surface that lies in another is left inside it, a part's surface that meets another is drawn onto the
 * blended surface, so a branch thickens and merges into what it grows from, a prop flares into the shelf it carries, the roots
 * into the plinth, and every normal is the blended surface's. Strata are laid on afterwards by world height, across all the
 * parts alike, as the deposition of one tissue. Nothing is rebuilt: the mesh is made once, and every frame the CPU writes the
 * nodes' present radii (a few hundred numbers) for the age.
 *
 * Lifecycle (age 0 to 3: 1 is the reference form at World Year 120; see livingTime.ts):
 *   establishment   the foundation and roots take hold on the ground; the keep rises from the plinth
 *   growth          the shelves extend from the keep as it reaches their height; branches fork from them, props grow from a
 *                   shelf's underside when its tip passes, the second body roots at the end of the great shelf; each ring
 *                   swells with the age since it was laid down, so the base is stoutest
 *   maturity        localized accretion: loaded parts reinforce, strata deepen
 *   senescence      each node has its own vulnerability (thin, far from the base, high, lit and exposed tissue first; stout,
 *                   grounded, loaded tissue last) and so its own date: it thins by its own amount, shelf tips retract
 *   regeneration    where light and moisture allow, receded tissue is partly restored from the tissue that survived, and
 *                   shoots grow from surviving keep, shelf and base
 */

export const LOFT_NODES = 12
export const LOFT_MAX_PARTS = 24
/** Where the nodes lie along a part (finer toward the end, where it closes in a dome). */
export const NODE_T = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.88, 0.95, 1] as const
const K = LOFT_NODES
const RINGS = 56
const SIDES = 18

type Node = { c: V; rU: number; rV: number }
type Kind = 'plinth' | 'root' | 'keep' | 'mass' | 'shelf' | 'branch' | 'prop' | 'outlier' | 'shoot'
export type LoftPart = {
  name: string
  kind: Kind
  nodes: Node[]
  /** Exponent of the cross-section (1 an ellipse, lower more boxy), and the direction its width is turned from. */
  e: number
  ref: V
  /** The age it begins, how long its tip takes to reach its end, how long a ring takes to thicken, the tip's rounding (of its length). */
  start: number
  dur: number
  acc: number
  taper: number
  /** 0 to 1: how much it is loaded (it reinforces in maturity). */
  load: number
  /** Per node: how soon it weathers (0 stout and sheltered, 1 thin and exposed), and how well it renews. */
  vul: number[]
  rg: number[]
  bound: [number, number, number, number]
}
export type LoftPlan = { parts: LoftPart[]; site: [number, number]; ground: number; stats: Record<string, number | string> }

const dot2 = (a: [number, number], b: [number, number]) => a[0] * b[0] + a[1] * b[1]
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** A part's profile is not closed here: its end is closed by the dome the shader puts on its tip (the last 14% of its rings). */
const dome = (_t: number) => 1

/** What each kind of tissue is exposed to, and how well it renews. */
const KIND: Record<Kind, { expo: number; rg: number; vertical: boolean }> = {
  plinth: { expo: 0.1, rg: 0.3, vertical: false },
  root: { expo: 0.15, rg: 0.8, vertical: false },
  keep: { expo: 0.45, rg: 0.5, vertical: true },
  mass: { expo: 0.5, rg: 0.5, vertical: true },
  shelf: { expo: 0.8, rg: 0.5, vertical: false },
  branch: { expo: 0.9, rg: 0.45, vertical: false },
  prop: { expo: 0.25, rg: 0.5, vertical: false },
  outlier: { expo: 0.5, rg: 0.5, vertical: true },
  shoot: { expo: 0.3, rg: 0.9, vertical: false },
}

/** The skeleton of LA-01 from the conditions of its ground and its neighbours. */
export function planLoft(world: World, seed: number, population: Population | null): LoftPlan {
  const rand = rng((seed ^ 0x51ed270b) >>> 0)
  const jitter = (base: number, spread: number) => base * (1 + (rand() * 2 - 1) * spread)
  const [sx, sz] = chooseSite(world, seed)
  const g0 = landscapeHeight(sx, sz)
  const me: OrganismPlan | null = population ? population.organisms[0]! : null
  const base = me?.base ?? { light: 0.7, moisture: 0.5, resource: 0.6, soil: 0.5, suit: 0.6, slope: 0.08, waterDist: 90, height: g0 }
  const L = clamp01(base.light)
  const wet = clamp01(base.moisture)
  const rich = clamp01(base.resource)

  // The sun (the mean of the day's), the neighbours, the water.
  let mx = 0
  let mz = 0
  for (const h of [8, 10, 12, 14, 16]) {
    const d = sunAt(h, 55).direction
    mx += d[0]
    mz += d[2]
  }
  const ml = Math.hypot(mx, mz) || 1
  let crowdX = 0
  let crowdZ = 0
  const neighbours: { d: number; bearing: number; size: number }[] = []
  if (population) {
    for (const o of population.organisms.slice(1)) {
      const d = Math.hypot(o.x - sx, o.z - sz)
      if (d > 320) continue
      const w = Math.exp(-d / 110) * (o.form.size ?? 1)
      crowdX += ((o.x - sx) / d) * w
      crowdZ += ((o.z - sz) / d) * w
      neighbours.push({ d, bearing: Math.atan2(o.z - sz, o.x - sx), size: o.form.size ?? 1 })
    }
  }
  const crowd = Math.hypot(crowdX, crowdZ)
  const open: [number, number] = [mx / ml - crowdX * 0.9, mz / ml - crowdZ * 0.9]
  const ol = Math.hypot(open[0], open[1]) || 1
  const o: [number, number] = [open[0] / ol, open[1] / ol]
  const p: [number, number] = [-o[1], o[0]]
  const wb = waterBearing(world, sx, sz)
  const toWater: [number, number] = [wb[0], wb[2]]
  const cs = dot2(toWater, p) >= 0 ? 1 : -1
  const waterAngle = Math.atan2(dot2(toWater, p), dot2(toWater, o))
  const dirAt = (angle: number): [number, number] => [o[0] * Math.cos(angle) + p[0] * Math.sin(angle), o[1] * Math.cos(angle) + p[1] * Math.sin(angle)]
  const crowdAt = (angle: number) => {
    const [dx, dz] = dirAt(angle)
    return neighbours.reduce((acc, n) => acc + Math.exp(-n.d / 120) * Math.pow(Math.max(0, Math.cos(Math.atan2(dz, dx) - n.bearing)), 2) * n.size, 0)
  }
  const world3 = (u: number, w: number, y: number): V => [sx + o[0] * u + p[0] * w, g0 + y, sz + o[1] * u + p[1] * w]
  const groundAt = (x: number, z: number) => landscapeHeight(x, z)

  const parts: LoftPart[] = []
  const add = (kind: Kind, name: string, fn: (t: number) => Node, opts: { e: number; ref: V; start: number; dur: number; acc: number; taper: number; load?: number; flare?: number }): LoftPart => {
    const flare = opts.flare ?? 0
    const nodes = NODE_T.map((t) => {
      const n = fn(t)
      const f = 1 + flare * Math.exp(-8 * t)
      return { c: n.c, rU: n.rU * f, rV: n.rV * f }
    })
    const index = parts.length
    const vul = nodes.map((n, j) => {
      const thin = 1 - clamp01(Math.min(n.rU, n.rV) / 5)
      const up = clamp01((n.c[1] - g0) / 40)
      const where = KIND[kind].vertical ? up : NODE_T[j]!
      return clamp01(0.45 * KIND[kind].expo + 0.3 * thin + 0.25 * where + 0.12 * (hash(index, j) - 0.5))
    })
    const rg = nodes.map((_, j) => clamp01(KIND[kind].rg * (0.35 + 0.65 * (0.5 * wet + 0.5 * L)) * (1 - 0.5 * vul[j]!) + 0.1 * hash(j, index)))
    let cx = 0
    let cy = 0
    let cz = 0
    for (const n of nodes) {
      cx += n.c[0] / K
      cy += n.c[1] / K
      cz += n.c[2] / K
    }
    let r = 0
    for (const n of nodes) r = Math.max(r, Math.hypot(n.c[0] - cx, n.c[1] - cy, n.c[2] - cz) + Math.max(n.rU, n.rV))
    const part: LoftPart = { name, kind, nodes, e: opts.e, ref: opts.ref, start: opts.start, dur: opts.dur, acc: opts.acc, taper: opts.taper, load: opts.load ?? 0, vul, rg, bound: [cx, cy, cz, r] }
    parts.push(part)
    return part
  }

  // ------------------------------------------------------------------------------------------------ foundation
  // A broad plate set into the ground, broader where the ground is rich (more to gather), and the keep standing on it.
  const plinthU = rich * 6 + 15
  add('plinth', 'plinth', (t) => ({ c: world3(-16, 0, -5 + 11.5 * t), rU: (plinthU + 4) * dome(t), rV: (plinthU - 1) * dome(t) }), { e: 0.7, ref: [1, 0, 0], start: 0, dur: 0.24, acc: 0.5, taper: 0.3, load: 0.6 })

  // ------------------------------------------------------------------------------------------------ keep
  // Up toward the light: higher where it is bright and the ground is fed, leaning toward the opening.
  const H = jitter(27 + 13 * L + 7 * (rich - 0.4), 0.05)
  const lean = 0.1 * H
  const keepRadius = 11.5 * (0.9 + 0.15 * rich)
  const keepCentre = (y: number): [number, number] => [-16 + (lean * (y + 3)) / (H + 3), 0]
  const keep = add(
    'keep',
    'keep',
    (t) => {
      const y = -3 + (H + 3) * t
      const [u, w] = keepCentre(y)
      const r = dome(t) * (1 - 0.3 * t)
      return { c: world3(u, w, y), rU: keepRadius * r, rV: keepRadius * 1.04 * r }
    },
    { e: 0.62, ref: [1, 0, 0], start: 0.04, dur: 0.5, acc: 0.5, taper: 0.2, load: 1 },
  )
  const atKeep = (y: number) => keep.start + (keep.dur * (y + 3)) / (H + 3)

  const mass = (name: string, u: number, w: number, top: number, radius: number, start: number) =>
    add(
      'mass',
      name,
      (t) => {
        const y = -3 + (top + 3) * t
        const r = dome(t) * (1 - 0.25 * t)
        return { c: world3(u + 0.04 * y, w, y), rU: radius * r, rV: radius * 1.05 * r }
      },
      { e: 0.65, ref: [1, 0, 0], start, dur: 0.36, acc: 0.45, taper: 0.22, load: 0.5, flare: 0.5 },
    )
  mass('water-side mass', -9, cs * 11.5, 0.62 * H, 7.6 * (0.9 + 0.2 * wet), atKeep(0.25 * H))
  mass('mouth-side mass', -8, -cs * 12.5 * (1 - 0.2 * Math.min(1, crowd * 3)), 0.32 * H, 6.2, atKeep(0.35 * H))

  // ------------------------------------------------------------------------------------------------ shelves
  type Shelf = { part: LoftPart; length: number; at: (t: number) => { x: number; z: number; y: number; dx: number; dz: number; below: number; half: number } }
  const shelf = (name: string, h: number, theta0: number, length: number, half: [number, number, number], thick: [number, number], rise: number, droop: number, swing: number, start: number, dur: number, kind: Kind = 'shelf'): Shelf => {
    const [ku, kw] = keepCentre(h)
    // The path, integrated outward from inside the keep, turning with `swing`; its thick root is a bracket against the keep.
    const pts: { u: number; w: number; y: number; th: number }[] = []
    const M = 48
    let u = ku
    let w = kw
    for (let i = 0; i < M; i += 1) {
      const t = i / (M - 1)
      const th = theta0 + swing * Math.sin(t * Math.PI * 0.7)
      pts.push({ u, w, y: h + rise * t - droop * t * t, th })
      u += Math.cos(th) * (length / (M - 1))
      w += Math.sin(th) * (length / (M - 1))
    }
    const hw = (t: number) => (t < 0.45 ? lerp(half[0], half[1], smoothstep(0, 0.45, t)) : lerp(half[1], half[2], smoothstep(0.45, 1, t)))
    const hv = (t: number) => lerp(thick[0], thick[1], Math.pow(t, 0.8)) * (1 + 0.45 * Math.exp(-(((t - 0.5) / 0.14) ** 2)) + 1.1 * Math.exp(-t * 7))
    const q = (t: number) => pts[Math.min(M - 1, Math.max(0, Math.round(t * (M - 1))))]!
    const part = add(
      kind,
      name,
      (t) => {
        const s = q(t)
        const r = dome(t)
        const rim = 1 - 0.18 * smoothstep(0.85, 1, t)
        return { c: world3(s.u, s.w, s.y), rU: hw(t) * r, rV: hv(t) * r * rim }
      },
      { e: 0.55, ref: [0, 1, 0], start, dur, acc: 0.42, taper: 0.16, load: 0.8 },
    )
    const out: Shelf = {
      part,
      length,
      at: (t) => {
        const s = q(t)
        const n = q(Math.min(1, t + 0.04))
        const c = world3(s.u, s.w, s.y)
        const c2 = world3(n.u, n.w, n.y)
        const len = Math.hypot(c2[0] - c[0], c2[2] - c[2]) || 1
        return { x: c[0], z: c[2], y: c[1], dx: (c2[0] - c[0]) / len, dz: (c2[2] - c[2]) / len, below: hv(t) * 0.8, half: hw(t) }
      },
    }
    return out
  }
  const reachFree = 1 - 0.4 * Math.min(1, crowdAt(0))
  const greatLength = (34 + 24 * L) * reachFree
  const great = shelf('great shelf', 0.55 * H, 0, greatLength, [15, 10.5, 12.5], [3.5, 1.9], 3, 1.5 + 0.02 * greatLength, -cs * 0.22, atKeep(0.55 * H) + 0.03, 0.34)
  const openSide = crowdAt(0.7) < crowdAt(-0.7) ? 1 : -1
  shelf('upper shelf', 0.84 * H, openSide * 0.75, 0.52 * greatLength, [9, 7, 7.5], [2.3, 1.2], 1.5, 0.7, openSide * 0.18, atKeep(0.84 * H) + 0.03, 0.26)
  const lowLength = (22 + 18 * wet) * (1 - 0.4 * Math.min(1, crowdAt(waterAngle)))
  const low = shelf('low shelf', 0.28 * H, waterAngle * 0.8, lowLength, [17, 13, 14], [3.1, 1.7], -1, 2.2, cs * 0.12, atKeep(0.28 * H) + 0.03, 0.3)

  // Branches: a shelf forks where it has room, two lobes diverging from its middle.
  const branch = (sh: Shelf, t: number, turn: number, length: number, half: number, thick: number, start: number) => {
    const a = sh.at(t)
    const th = Math.atan2(a.dz, a.dx) + turn
    const dx = Math.cos(th)
    const dz = Math.sin(th)
    add(
      'branch',
      `branch of ${sh.part.name}`,
      (s) => {
        const r = dome(s) * (1 - 0.3 * s)
        const x = a.x + dx * length * s
        const z = a.z + dz * length * s
        return { c: [x, a.y - 0.4 * s * 3 + 0.8 * Math.sin(s * 3), z], rU: half * r, rV: thick * r }
      },
      { e: 0.58, ref: [0, 1, 0], start, dur: 0.24, acc: 0.4, taper: 0.2, load: 0.5, flare: 0.5 },
    )
  }
  const lobeLength = 0.42 * greatLength
  branch(great, 0.58, openSide * 0.55, lobeLength, 7.5, 2.1, great.part.start + great.part.dur * 0.58 + 0.02)
  branch(great, 0.58, -openSide * 0.5, lobeLength * 0.8, 6.5, 1.8, great.part.start + great.part.dur * 0.58 + 0.05)

  // ------------------------------------------------------------------------------------------------ the second body
  // The far end of the great shelf is carried by a body of its own: it grows down from the shelf's tip, once the tip is there, to
  // its own ground, stout and flaring where it meets it.
  const tip = great.at(0.97)
  const ox = tip.x + tip.dx * 3
  const oz = tip.z + tip.dz * 3
  const oground = groundAt(ox, oz)
  add(
    'outlier',
    'second body',
    (t) => {
      const x = lerp(tip.x, ox, t)
      const z = lerp(tip.z, oz, t)
      const y = lerp(tip.y - 0.5, oground - 2.2, t)
      const r = 1 + 0.35 * smoothstep(0.6, 1, t)
      return { c: [x, y, z], rU: 8 * r, rV: 8.4 * r }
    },
    { e: 0.66, ref: [1, 0, 0], start: great.part.start + great.part.dur * 0.93, dur: 0.3, acc: 0.45, taper: 0.22, load: 1, flare: 0.5 },
  )

  // ------------------------------------------------------------------------------------------------ props
  // A shelf that reaches far is carried: props grow from its underside to the ground, stouter for the load, when the tip has
  // passed the place they stand; near the ground a prop forks into two feet.
  const prop = (sh: Shelf, t: number, lean0: number, fork: boolean) => {
    const top = sh.at(t)
    const bx = top.x - top.dx * lean0
    const bz = top.z - top.dz * lean0
    const gy = groundAt(bx, bz)
    const topY = top.y - top.below
    const load = (sh.length * (top.half + 4)) / 100
    const r0 = 1.9 + 0.8 * load
    const start = sh.part.start + sh.part.dur * t + 0.015
    add(
      'prop',
      `prop of ${sh.part.name}`,
      (s) => {
        const x = lerp(top.x, bx, s)
        const z = lerp(top.z, bz, s)
        const y = lerp(topY + 1.5, gy - 1.4, s)
        const r = dome(s) * (1 + 0.9 * smoothstep(0.62, 1, s)) * (1 - 0.2 * s)
        return { c: [x, y, z], rU: r0 * r, rV: r0 * 0.9 * r }
      },
      { e: 0.78, ref: [1, 0, 0], start, dur: 0.2, acc: 0.35, taper: 0.22, load: 1, flare: 1.1 },
    )
    if (fork) {
      // A second foot, from two thirds down, splayed away.
      const sx2 = lerp(top.x, bx, 0.62)
      const sz2 = lerp(top.z, bz, 0.62)
      const sy2 = lerp(topY + 1.5, gy - 1.4, 0.62)
      const fx = bx + -top.dz * 5.5
      const fz = bz + top.dx * 5.5
      const fy = groundAt(fx, fz) - 1.4
      add(
        'prop',
        `foot of ${sh.part.name}`,
        (s) => ({ c: [lerp(sx2, fx, s), lerp(sy2, fy, s), lerp(sz2, fz, s)], rU: r0 * 0.7 * dome(s) * (1 + 0.8 * smoothstep(0.6, 1, s)), rV: r0 * 0.65 * dome(s) * (1 + 0.8 * smoothstep(0.6, 1, s)) }),
        { e: 0.78, ref: [1, 0, 0], start: start + 0.1, dur: 0.12, acc: 0.3, taper: 0.25, load: 0.8, flare: 0.5 },
      )
    }
  }
  prop(great, 0.46, 3.5, true)
  prop(low, 0.75, 2, false)

  // ------------------------------------------------------------------------------------------------ roots
  // Toward the water, longer where it is damp, shorter where a neighbour stands that way; half buried and flat.
  const root = (angle: number, length: number, radius: number, start: number) => {
    const [dx, dz] = dirAt(angle)
    add(
      'root',
      'root',
      (t) => {
        const wob = 0.12 * Math.sin(t * 7 + angle * 5)
        const x = sx + o[0] * -16 + dx * (plinthU * 0.6 + length * t) + -dz * wob * length * 0.2 * t
        const z = sz + o[1] * -16 + dz * (plinthU * 0.6 + length * t) + dx * wob * length * 0.2 * t
        const r = dome(t) * (1 - 0.65 * t)
        return { c: [x, groundAt(x, z) + 0.15 * radius * r - 0.2, z], rU: radius * r, rV: radius * 0.55 * r }
      },
      { e: 0.72, ref: [0, 1, 0], start, dur: 0.3, acc: 0.4, taper: 0.25, load: 0.3, flare: 0.6 },
    )
  }
  const rootLen = (angle: number, base0: number) => base0 * (1 - 0.5 * Math.min(1, crowdAt(angle)))
  root(waterAngle - 0.5, rootLen(waterAngle - 0.5, 24 + 34 * wet), 5.2, 0.03)
  root(waterAngle + 0.45, rootLen(waterAngle + 0.45, 20 + 30 * wet), 4.6, 0.05)
  root(waterAngle + 1.9 * cs, rootLen(waterAngle + 1.9 * cs, 18 + 12 * wet), 4, 0.08)
  root(Math.PI + 0.3, rootLen(Math.PI + 0.3, 22), 4.4, 0.06)

  // ------------------------------------------------------------------------------------------------ renewal
  // Shoots that grow in late life from tissue that survives, where light and moisture allow: a new tier at the keep's crown, a
  // lobe from the middle of the great shelf, and a broad lobe from the low shelf toward the water.
  const renew = L * 0.5 + wet * 0.5 + 0.15
  const shoot = (name: string, from: V, dir: V, length: number, radius: number, start: number) =>
    add(
      'shoot',
      name,
      (t) => {
        const r = dome(t) * (1 - 0.25 * t)
        return { c: [from[0] + dir[0] * length * t, from[1] + dir[1] * length * t, from[2] + dir[2] * length * t], rU: radius * r, rV: radius * 0.9 * r }
      },
      { e: 0.65, ref: Math.abs(dir[1]) > 0.7 ? [1, 0, 0] : [0, 1, 0], start, dur: 0.5, acc: 0.5, taper: 0.25, load: 0.2, flare: 0.8 },
    )
  if (renew > 0.4) {
    const crown = keep.nodes[K - 2]!
    shoot('crown shoot', [crown.c[0], crown.c[1] - 3, crown.c[2]], [lean * 0.02, 1, 0], 0.26 * H, 0.55 * keepRadius, 2.0)
    const mid = great.at(0.36)
    shoot('shelf shoot', [mid.x, mid.y + 0.5, mid.z], [mid.dx * 0.35, 0.93, mid.dz * 0.35], 0.3 * H, 4.8, 2.12)
    const lowMid = low.at(0.5)
    shoot('base shoot', [lowMid.x, lowMid.y + 0.4, lowMid.z], [lowMid.dx * 0.9, 0.3, lowMid.dz * 0.9], 0.55 * lowLength, 6.2, 2.0)
  }

  return {
    parts,
    site: [sx, sz],
    ground: g0,
    stats: {
      keepHeight: Math.round(H),
      light: +L.toFixed(2),
      moisture: +wet.toFixed(2),
      resource: +rich.toFixed(2),
      neighbours: neighbours.length,
      crowd: +crowd.toFixed(2),
      openingDegrees: Math.round((Math.atan2(o[1], o[0]) * 180) / Math.PI),
      waterAngleDegrees: Math.round((waterAngle * 180) / Math.PI),
      distanceToWater: Math.round(waterDistance(world, sx, sz)),
      greatShelf: Math.round(greatLength),
      lowShelf: Math.round(lowLength),
      parts: parts.length,
    },
  }
}

// ---------------------------------------------------------------------------------------------------------- the age
/** What the shader reads (flat arrays, written in place each frame): the nodes' present radii and the parts' states. */
export type LoftUniforms = {
  nodeA: { value: Float32Array }
  nodeB: { value: Float32Array }
  info: { value: Float32Array }
  ref: { value: Float32Array }
  bound: { value: Float32Array }
  parts: { value: number }
  /** How strongly the strata are cut (they deepen with age and weathering). */
  strata: { value: number }
  ground: { value: number }
}

export function loftUniforms(plan: LoftPlan): LoftUniforms {
  const u: LoftUniforms = {
    nodeA: { value: new Float32Array(LOFT_MAX_PARTS * K * 4) },
    nodeB: { value: new Float32Array(LOFT_MAX_PARTS * K * 4) },
    info: { value: new Float32Array(LOFT_MAX_PARTS * 4) },
    ref: { value: new Float32Array(LOFT_MAX_PARTS * 4) },
    bound: { value: new Float32Array(LOFT_MAX_PARTS * 4) },
    parts: { value: plan.parts.length },
    strata: { value: 0.3 },
    ground: { value: plan.ground },
  }
  plan.parts.forEach((part, p) => {
    u.ref.value.set([part.ref[0], part.ref[1], part.ref[2], 0], p * 4)
    u.bound.value.set(part.bound, p * 4)
  })
  return u
}

/** The senescence date of a node: from 1.45 (the thinnest, most exposed) to 2.55 (the stoutest and most sheltered). */
export const weatherDate = (vul: number, noise: number) => 1.45 + 1.1 * (1 - vul) + 0.15 * (noise - 0.5)

/** Writes the nodes' radii and the parts' states for an age (the age of LA-01: 0 to 3, 1 the reference form). */
export function loftAt(plan: LoftPlan, age: number, u: LoftUniforms) {
  const A = u.nodeA.value
  const B = u.nodeB.value
  const info = u.info.value
  const along = (arr: number[], t: number) => {
    let j = 0
    while (j < K - 2 && t > NODE_T[j + 1]!) j += 1
    return lerp(arr[j]!, arr[j + 1]!, (t - NODE_T[j]!) / (NODE_T[j + 1]! - NODE_T[j]!))
  }
  plan.parts.forEach((part, p) => {
    const front = clamp01((age - part.start) / part.dur)
    // Late life: the tip of a part retracts where it is vulnerable, and is regained (in part) where it renews.
    const endVul = part.vul[K - 1]!
    const endRg = part.rg[K - 1]!
    const retire = smoothstep(weatherDate(endVul, hash(p, 99)), weatherDate(endVul, hash(p, 99)) + 0.6, age)
    const regained = smoothstep(2.0, 2.9, age) * endRg * 0.8
    const endMax = clamp01(1 - 0.42 * endVul * retire * (1 - regained))
    // Where the tip has reached (along the part). A growing tip is a blunt dome (the shader closes it), not a point: it is thin
    // when new and thickens as it ages.
    const tipPos = Math.min(front, endMax)
    info[p * 4 + 0] = 2 / part.e
    info[p * 4 + 1] = 0
    info[p * 4 + 2] = tipPos
    info[p * 4 + 3] = tipPos > 0.002 ? 1 : 0
    const reinforce = 1 + 0.12 * part.load * smoothstep(0.9, 1.6, age)
    const rUs = part.nodes.map((n) => n.rU)
    const rVs = part.nodes.map((n) => n.rV)
    for (let j = 0; j < K; j += 1) {
      // A node past the tip lies on it (a zero-length segment: the round end of the part's distance field).
      const s = Math.min(NODE_T[j]!, tipPos)
      const at = (p * K + j) * 4
      let j0 = 0
      while (j0 < K - 2 && s > NODE_T[j0 + 1]!) j0 += 1
      const t0 = (s - NODE_T[j0]!) / (NODE_T[j0 + 1]! - NODE_T[j0]!)
      const a = part.nodes[j0]!.c
      const b = part.nodes[j0 + 1]!.c
      // Accretion: each ring swells with the age since it was laid down.
      const born = part.start + s * part.dur
      const thick = 0.4 + 0.6 * smoothstep(0, part.acc, age - born)
      // Senescence at its own date, by its own amount; regeneration restores part of it where it renews.
      const date = weatherDate(along(part.vul, s), hash(p, j))
      const rho = smoothstep(date, date + 0.55, age)
      const depth = 0.2 + 0.6 * along(part.vul, s)
      const restored = smoothstep(2.0, 2.9, age) * along(part.rg, s) * 0.75
      const recede = depth * rho * (1 - restored)
      const k = thick * reinforce * (1 - 0.8 * recede)
      A[at] = lerp(a[0], b[0], t0)
      A[at + 1] = lerp(a[1], b[1], t0)
      A[at + 2] = lerp(a[2], b[2], t0)
      A[at + 3] = along(rUs, s) * k
      B[at] = along(rVs, s) * k
      B[at + 1] = date
      B[at + 2] = 0
      B[at + 3] = 0
    }
  })
  // The strata: laid down with the organism, cut deeper as the softer layers weather.
  u.strata.value = 0.3 * smoothstep(0.15, 0.9, age) + 0.45 * smoothstep(1.4, 2.6, age)
}

/**
 * The one mesh: every part as a closed grid of rings and sides. Its vertices carry only where they belong on the loft (s, phi,
 * part); the shader places them. Each carries when its tissue arrived (aArrival) and when it weathers (aDecay), for the colour.
 */
export function loftGeometry(plan: LoftPlan, moisture: number): BufferGeometry {
  const parts = plan.parts
  const count = parts.length * RINGS * SIDES
  const loft = new Float32Array(count * 4)
  const colours = new Float32Array(count * 3)
  const recordA = new Float32Array(count * 4)
  const recordB = new Float32Array(count * 4)
  const arrival = new Float32Array(count)
  const decay = new Float32Array(count)
  const index: number[] = []
  const position = new Float32Array(count * 3)
  parts.forEach((part, p) => {
    for (let r = 0; r < RINGS; r += 1) {
      const sRaw = r / (RINGS - 1)
      const s = Math.min(1, sRaw / 0.86)
      let j = 0
      while (j < K - 2 && s > NODE_T[j + 1]!) j += 1
      const t = (s - NODE_T[j]!) / (NODE_T[j + 1]! - NODE_T[j]!)
      const a = part.nodes[j]!
      const b = part.nodes[j + 1]!
      const born = part.start + s * part.dur
      const date = weatherDate(lerp(part.vul[j]!, part.vul[j + 1]!, t), hash(p, j))
      const cy = lerp(a.c[1], b.c[1], t)
      for (let k = 0; k < SIDES; k += 1) {
        const v = (p * RINGS + r) * SIDES + k
        const phi = (k / SIDES) * Math.PI * 2
        const sn = Math.sin(phi)
        loft.set([sRaw, phi, p, 0], v * 4)
        const above = Math.max(0, cy - plan.ground + sn * lerp(a.rV, b.rV, t))
        const colour = skin(above, 0.3 + 0.3 * s, 1, moisture)
        colours.set([colour.r, colour.g, colour.b], v * 3)
        recordA.set([clamp01(born), 0.8, part.kind === 'prop' || part.kind === 'plinth' || part.kind === 'root' ? 0.25 : 0.05, 0], v * 4)
        recordB.set([clamp01(0.3 + 0.55 * Math.max(0, sn)), clamp01(moisture * (1 - smoothstep(0, 7, above))), ((p * 2654435761) >>> 0) / 4294967296, part.kind === 'shelf' ? 0.75 : 0.5], v * 4)
        arrival[v] = born
        decay[v] = date
        position[v * 3] = lerp(a.c[0], b.c[0], t)
        position[v * 3 + 1] = cy
        position[v * 3 + 2] = lerp(a.c[2], b.c[2], t)
      }
    }
    const base = p * RINGS * SIDES
    for (let r = 0; r < RINGS - 1; r += 1) {
      for (let k = 0; k < SIDES; k += 1) {
        const a = base + r * SIDES + k
        const b = base + r * SIDES + ((k + 1) % SIDES)
        index.push(a, a + SIDES, b, b, a + SIDES, b + SIDES)
      }
    }
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('aLoft', new BufferAttribute(loft, 4))
  geometry.setAttribute('color', new BufferAttribute(colours, 3))
  geometry.setAttribute('aGrowthA', new BufferAttribute(recordA, 4))
  geometry.setAttribute('aGrowthB', new BufferAttribute(recordB, 4))
  geometry.setAttribute('aArrival', new BufferAttribute(arrival, 1))
  geometry.setAttribute('aDecay', new BufferAttribute(decay, 1))
  geometry.setIndex(index)
  geometry.boundingSphere = new Sphere(new Vector3(plan.site[0], plan.ground + 20, plan.site[1]), 140)
  return geometry
}
