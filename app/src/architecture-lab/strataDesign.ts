import { bez, massAt, REFERENCE_PLAN, roofAt, type StrataPlan, type V3 } from './strataField.ts'

/**
 * The Strata family's morphology: a handful of controls, drawn from the seed (habitat adaptation comes in a later pass), turned into a plan
 * for strataField.ts. Mature form only.
 *
 *   reach    the blade's length (× the reference)                      a long gesture or a compact one
 *   rise     how far the blade lifts toward its tip (× the reference)   level or reaching up
 *   mass     the structure's height (× the reference); a taller mass is a little narrower, a lower one broader, and leans more or less
 *   support  where the leg meets the blade, along it (0 root to 1 tip)  where the great void opens, and how wide it is
 *   tiers    how many shelves grow in the undercroft (0 to 3)           an open hall or layered shade
 *   swing    the blade's curve in plan (1 the reference; negative curves the other way)
 *   crease   how strongly the roof is folded (1 the reference; 0 smooth)
 *
 * CONNECTIONS ARE DERIVED, NOT PLACED. Every joint is attached to a point on the part it grows from, and moves with that point:
 *   leg head     to the blade's underside at `support` (at the same fraction of the blade's width as in the reference), embedded as deep
 *   leg root     to the mass's face (its outline at the arch's height, toward the blade)
 *   root foot    midway between the two, on the ground
 *   mass shelves to the mass at their own heights (each is also a ledge ring, so a shelf always leaves the mass on a ledge)
 *   leg shelf    to the leg's sweep, at the same point along it
 * Each is written as the reference position plus how far its anchor moved (anchor now − anchor in the reference): with the reference controls
 * every movement is exactly zero, so `designStrata(REFERENCE_CONTROLS)` is the reference plan, number for number.
 * Shelves are then held within what the reference allows: a shelf whose tip would reach farther out of the blade's plan, or higher into the
 * blade's underside, than the reference's own does is shortened until it does not.
 */
export type StrataControls = { reach: number; rise: number; mass: number; support: number; tiers: number; swing: number; crease: number }

export const REFERENCE_CONTROLS: StrataControls = { reach: 1, rise: 1, mass: 1, support: 76 / 104, tiers: 3, swing: 1, crease: 1 }

export const CONTROL_SPEC: { key: keyof StrataControls; label: string; min: number; max: number; step: number; tip: string }[] = [
  { key: 'reach', label: 'Reach', min: 0.75, max: 1.25, step: 0.01, tip: 'The blade’s length, against the reference.' },
  { key: 'rise', label: 'Rise', min: 0, max: 2, step: 0.05, tip: 'How far the blade lifts toward its tip, against the reference (0 is level).' },
  { key: 'mass', label: 'Mass', min: 0.8, max: 1.25, step: 0.01, tip: 'The structure’s height, against the reference; a taller mass is narrower and leans more.' },
  { key: 'support', label: 'Support', min: 0.5, max: 0.85, step: 0.01, tip: 'Where the leg meets the blade, along it: nearer the mass closes the void, nearer the tip widens it.' },
  { key: 'tiers', label: 'Tiers', min: 0, max: 3, step: 1, tip: 'How many shelves grow in the undercroft.' },
  { key: 'swing', label: 'Swing', min: -1, max: 1.5, step: 0.05, tip: 'The blade’s curve in plan (1 the reference; negative curves it the other way).' },
  { key: 'crease', label: 'Crease', min: 0, max: 1.6, step: 0.05, tip: 'How strongly the roof is folded (0 smooth, 1 the reference).' },
]

const rv = (seed: number, a: number) => {
  const s = Math.sin(seed * 12.9898 + a * 78.233 + 41.7) * 43758.5453
  return s - Math.floor(s)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** The seed's controls: every seed a deterministic draw within the ranges, leaning toward the reference's proportions. */
export function seedControls(seed: number): StrataControls {
  const r = (k: number) => rv(seed, k)
  // Two draws averaged for the continuous controls: the middle of each range (the reference) is likelier than its ends.
  const mid = (k: number, lo: number, hi: number) => lerp(lo, hi, (r(k) + r(k + 50)) / 2)
  const t = r(5)
  return {
    reach: mid(1, 0.8, 1.22),
    rise: mid(2, 0.1, 1.9),
    mass: mid(3, 0.84, 1.2),
    support: mid(4, 0.56, 0.84),
    tiers: t < 0.12 ? 0 : t < 0.35 ? 1 : t < 0.65 ? 2 : 3,
    swing: (r(6) < 0.25 ? -1 : 1) * mid(7, 0.35, 1.35),
    crease: mid(8, 0.3, 1.45),
  }
}

export function controlsFor(seed: number, overrides: Partial<StrataControls> = {}): StrataControls {
  return { ...seedControls(seed), ...overrides }
}

// ------------------------------------------------------------------------------------------------------------- anchors

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const half = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]

/** The blade's underside at a fraction s along it, at a fraction q of its half-width from the centreline. */
function underside(r: StrataPlan['roof'], s: number, q: number): V3 {
  const u = r.u0 + r.len * s
  const c = roofAt(r, u, 0)
  const w = c.wc + q * c.hw
  const at = roofAt(r, u, w)
  return [u, at.top - at.th, w]
}
/** The mass's face toward the blade at height y. */
function massFace(m: StrataPlan['mass'], y: number): V3 {
  const a = massAt(m, y)
  return [a.uc + m.rx * a.f, y, m.wc]
}

// The reference's anchors, once: the leg head's fraction across the blade, and where each joint sits on its anchor.
const REF = REFERENCE_PLAN
const REF_S = REFERENCE_CONTROLS.support
const REF_Q = (() => {
  const u = REF.roof.u0 + REF.roof.len * REF_S
  const c = roofAt(REF.roof, u, 0)
  return (REF.leg.sweep[2][2] - c.wc) / c.hw
})()
/** Where along the leg's sweep the leg shelf is rooted (the sweep's point nearest the reference root, by a coarse search). */
const LEG_SHELF_T = (() => {
  const [u0, w0, , , , y0] = REF.shelves[2]!
  let best = 0
  let bd = Infinity
  for (let i = 0; i <= 200; i += 1) {
    const p = bez(REF.leg.sweep[0], REF.leg.sweep[1], REF.leg.sweep[2], i / 200)
    const d = Math.hypot(p[0] - u0, p[1] - y0, p[2] - w0)
    if (d < bd) {
      bd = d
      best = i / 200
    }
  }
  return best
})()

// ------------------------------------------------------------------------------------------------------------- the plan

export function designStrata(c: StrataControls): StrataPlan {
  const hs = c.mass
  const ws = 1 + (1 - hs) * 0.6
  const mass: StrataPlan['mass'] = { ...REF.mass, lean: REF.mass.lean * hs, rx: REF.mass.rx * ws, rz: REF.mass.rz * ws, hRef: REF.mass.hRef * hs, top: REF.mass.top * hs, topBack: REF.mass.topBack * ws }
  const roof: StrataPlan['roof'] = {
    ...REF.roof,
    len: REF.roof.len * c.reach,
    front: REF.roof.u0 + REF.roof.len * c.reach,
    swing: REF.roof.swing * c.swing,
    base: REF.roof.base * hs,
    rise: REF.roof.rise * c.rise,
    steep: REF.roof.steep * c.crease,
    gentle: REF.roof.gentle * c.crease,
  }

  // The leg: its head on the blade's underside at `support`, its root on the mass's face, its foot between them.
  const dHead = sub(underside(roof, c.support, REF_Q), underside(REF.roof, REF_S, REF_Q))
  const archY = REF.leg.arch[0][1]
  const dRoot = sub(massFace(mass, archY * hs), massFace(REF.mass, archY))
  const dFoot: V3 = [(dRoot[0] + dHead[0]) / 2, 0, (dRoot[2] + dHead[2]) / 2]
  const [a0, a1, a2] = REF.leg.arch
  const [, s1, s2] = REF.leg.sweep
  const arch: [V3, V3, V3] = [add(a0, dRoot), add(a1, [(dRoot[0] + dFoot[0]) / 2, a1[1] * hs - a1[1], (dRoot[2] + dFoot[2]) / 2]), add(a2, dFoot)]
  const sweep: [V3, V3, V3] = [arch[2], add(s1, half(dFoot, dHead)), add(s2, dHead)]
  const leg: StrataPlan['leg'] = { ...REF.leg, arch, sweep, foot: add(REF.leg.foot, dFoot) }

  // Shelves: the two from the mass keep their place on it at their own heights; the one from the leg moves with the leg.
  const mirror = c.swing < 0
  const fromMass = (i: number): StrataPlan['shelves'][number] => {
    const S0 = REF.shelves[i]!
    const y0 = S0[5] * hs
    const now = massAt(mass, y0)
    const ref = massAt(REF.mass, S0[5])
    // (Written as the reference plus movements, so with the reference controls it is the reference exactly.)
    const u = S0[0] + (now.uc - ref.uc) + (S0[0] - ref.uc) * (ws - 1)
    const w = S0[1] + (mass.wc - REF.mass.wc) + (S0[1] - REF.mass.wc) * (ws - 1)
    // A blade curving the other way: the shelf grows on the other side of the mass, mirrored, so it stays under the blade.
    if (mirror) return [u, 2 * mass.wc - w, -S0[2], S0[3], S0[4], y0, S0[6], S0[7], S0[8], S0[9], S0[10]]
    return [u, w, S0[2], S0[3], S0[4], y0, S0[6], S0[7], S0[8], S0[9], S0[10]]
  }
  const fromLeg = (): StrataPlan['shelves'][number] => {
    const S0 = REF.shelves[2]!
    const d = sub(bez(sweep[0], sweep[1], sweep[2], LEG_SHELF_T), bez(REF.leg.sweep[0], REF.leg.sweep[1], REF.leg.sweep[2], LEG_SHELF_T))
    return [S0[0] + d[0], S0[1] + d[2], mirror ? -S0[2] : S0[2], S0[3], S0[4], S0[5] + d[1], S0[6], S0[7], S0[8], S0[9], S0[10]]
  }
  const all = [fromMass(0), fromMass(1), fromLeg()].map((S, i) => holdShelf(S, REF.shelves[i]!, roof))
  // Which shelves grow, in order of importance: the great low one from the mass, then the leg's, then the small high one.
  const ORDER = [0, 2, 1]
  const keep = new Set(ORDER.slice(0, Math.max(0, Math.min(3, Math.round(c.tiers)))))
  const shelves = all.filter((_, i) => keep.has(i))

  // Rings: the lowest stays a plain ledge (its height scales with the mass); the other two are the mass shelves' own heights.
  const rings: StrataPlan['rings'] = [
    [REF.rings[0]![0] * hs, REF.rings[0]![1], REF.rings[0]![2]],
    [all[0]![5], REF.rings[1]![1], REF.rings[1]![2]],
    [all[1]![5], REF.rings[2]![1], REF.rings[2]![2]],
  ]
  return { mass, rings, roof, leg, shelves }
}

/** How far a shelf's tip stands out of the blade's plan (positive: outside) and up into its underside (positive: into it). */
function tipStanding(S: StrataPlan['shelves'][number], roof: StrataPlan['roof'], L: number): { out: number; up: number } {
  const a = (S[2] * Math.PI) / 180
  const u = S[0] + Math.cos(a) * L
  const w = S[1] + Math.sin(a) * L
  const r = roofAt(roof, u, w)
  const out = Math.max(Math.abs(w - r.wc) - r.hw, u - roof.front)
  return { out, up: S[5] - S[8] - (r.top - r.th) }
}
/** Shortens a shelf (to at most 5 steps of ×0.88) while its tip stands farther out of the blade, or higher into it, than the reference's. */
function holdShelf(S: StrataPlan['shelves'][number], ref: StrataPlan['shelves'][number], roof: StrataPlan['roof']): StrataPlan['shelves'][number] {
  const allowed = tipStanding(ref, REF.roof, ref[3])
  const ok = (L: number) => {
    const t = tipStanding(S, roof, L)
    return t.out <= Math.max(allowed.out, 0) + 1e-9 && t.up <= Math.max(allowed.up, -2) + 1e-9
  }
  let L = S[3]
  for (let i = 0; i < 5 && !ok(L); i += 1) L *= 0.88
  if (L === S[3]) return S
  // A shorter shelf is also narrower, in proportion.
  return [S[0], S[1], S[2], L, S[4] * (L / S[3]), S[5], S[6], S[7], S[8], S[9], S[10]]
}

/** The plan's checks, in design metres: the void under the blade between the mass and the leg, and the headroom there. */
export function planChecks(plan: StrataPlan, field: (u: number, w: number, y: number) => number) {
  const head = plan.leg.sweep[2]
  const face = massFace(plan.mass, 8)
  const u = (face[0] + head[0]) / 2
  const r = roofAt(plan.roof, u, 0)
  const w = r.wc
  const under = r.top - r.th
  // Along a vertical line in the middle of the void, from the ground to the blade's underside: the tallest clear run (the shelves cross it,
  // so this is the largest open space between layers), and how many layers it crosses. A collapsed opening has no tall clear run.
  let run = 0
  let tallest = 0
  let layers = 0
  let inside = false
  for (let y = 0.5; y <= under; y += 0.5) {
    const solid = field(u, w, y) < 0
    if (solid && !inside) layers += 1
    inside = solid
    run = solid ? 0 : run + 0.5
    tallest = Math.max(tallest, run)
  }
  return { voidWidth: Math.round(head[0] - face[0]), headroom: Math.round(under), openRun: tallest, layers }
}
