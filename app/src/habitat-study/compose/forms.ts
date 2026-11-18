import { BufferAttribute, BufferGeometry } from 'three'
import { capsule, slab, smax, smin } from '../../project03/livingOverhang.ts'
import { overhangOptionsFromUrl } from '../../project03/livingOverhang.ts'
import { growOverhang3, type OrganismForm } from '../../project03/livingOverhang3.ts'
import { refinedSeed, refinedWorldForm } from '../../project03/livingRefined.ts'
import { architectureStyle } from '../../project03/livingStyle.ts'
import { landscapeHeight } from '../../project03/terrain.ts'
import { SITE, studySun, type StudySite } from '../site.ts'
import { meshField, type FieldBounds } from '../../architecture-lab/fieldMesh.ts'
import { strataField } from '../../architecture-lab/strataField.ts'
import { designStrata, REFERENCE_CONTROLS } from '../../architecture-lab/strataDesign.ts'
export { setCoarseToFine } from '../../architecture-lab/fieldMesh.ts'
export { setFieldBounds } from '../../architecture-lab/strataField.ts'
import { subjectOf } from './framings.ts'

/**
 * Style C, stage 2 — geometry explorations. Three new forms for the Reference Overhang, built in the study only (the world's generator is untouched),
 * each a different answer to the same programme: one dominant mass, a shelf reaching toward the light, an undercroft beneath it.
 *
 *   blade     a waisted, leaning mass that flares into one long, thin, rising cantilever on a single raking pier: horizontal reach, one great void
 *   brackets  a bent trunk carrying a cascade of shelf-fungus plates on its sun side, largest lowest: vertical rhythm, stacked layers of shade
 *   canopy    a broad, tilted, lens-thick plate on a cluster of leaning stems that flare into it like trumpets: a floating plane over a hall of shade
 *
 * Stage 4 adds two variants of Blade (Volume Study 02):
 *
 *   fold      Blade's gesture with a folded roof: a crease that drifts across the blade and a twist toward the tip, thick along the crease and thin,
 *             crisp lips at both edges; the pier replaced by one flared stem that opens into the underside as a vault (Canopy's junction)
 *   strata    Blade's silhouette with the support grown out of the mass (a swept leg from its foot, rising to meet the blade), a few asymmetric
 *             secondary shelves in the undercroft at different heights and headings, and partial ledges on the mass's shaded side only
 *
 * Each is a signed distance field in a local frame (u toward the sun at the hero hour, w across, y up from the ground at the centre), designed at
 * the ~120 m scale and evaluated at any scale S as S·f(p/S), then meshed with the world's own surface nets. Nothing grows below the ground.
 */
export type FormId = 'original' | 'blade' | 'brackets' | 'canopy' | 'fold' | 'strata' | 'originalRefined' | 'strataRefined'
export const FORMS: { id: FormId; label: string; note: string }[] = [
  { id: 'original', label: 'Original', note: 'The world’s Reference Overhang as it is: the baseline.' },
  { id: 'blade', label: 'Blade', note: 'A waisted mass flaring into one long, thin, rising cantilever on a single raking pier. Horizontal reach and one great void.' },
  { id: 'brackets', label: 'Brackets', note: 'A bent trunk carrying a cascade of shelf-fungus plates on its sun side, largest lowest. Vertical rhythm; layers of shade.' },
  { id: 'canopy', label: 'Canopy', note: 'A broad, tilted plate, lens-thick, on a cluster of leaning stems that flare into it. A floating plane over a hall of shade.' },
  { id: 'fold', label: 'Blade / Fold', note: 'Blade with a folded, twisting roof: a crease drifting across it, thick along the crease, thin crisp lips at the edges; one flared stem opening into the underside as a vault.' },
  { id: 'originalRefined', label: 'Original Refined', note: 'The world’s own generator with a composition override it already supports: stronger, warped, interrupted ledges; a clearer step down between the three masses; a slimmer great shelf; a finer grid for crisper edges. Same identity.' },
  { id: 'strataRefined', label: 'Blade / Strata Refined', note: 'Strata with shelves that grow out of interrupted ledge lines on the mass (lobed, crisp-lipped, filleted at the root), a leg that arches out of the mass onto a flared root foot, and a gently creased roof with thin lips. Same silhouette.' },
  { id: 'strata', label: 'Blade / Strata', note: 'Blade’s silhouette with its support grown from the mass (a swept leg), a few asymmetric shelves layering the undercroft, and partial ledges on the shaded side.' },
]
/** The forms offered in C · Compose. The others stay defined above (and in FORMS) for reference; nothing builds them unless chosen. */
export const ACTIVE_FORMS: FormId[] = ['original', 'strataRefined']
export type Scale = 120 | 60

/** The design subject the cameras frame: the same for every form at a scale, so the cameras are the same. */
export const DESIGN = { radius: 61, height: 42 }

// ------------------------------------------------------------------------------------------------------------- the frame

export type Frame = { cx: number; cz: number; g0: number; u: [number, number]; w: [number, number] }
const frames = new WeakMap<StudySite, Frame>()
/** u: toward the sun at 16:30 (horizontal); w: across it, turned so the hero side (where the Threshold camera stands) is −w. */
export function frameOf(site: StudySite, heroAz = 70): Frame {
  let f = frames.get(site)
  if (!f) {
    const s = subjectOf(site)
    const [sx, , sz] = studySun(16.5).direction
    const l = Math.hypot(sx, sz)
    const u: [number, number] = [sx / l, sz / l]
    let w: [number, number] = [-u[1], u[0]]
    const a = Math.atan2(u[1], u[0]) + (heroAz * Math.PI) / 180
    if (w[0] * Math.cos(a) + w[1] * Math.sin(a) > 0) w = [-w[0], -w[1]]
    f = { cx: s.center.x, cz: s.center.z, g0: landscapeHeight(s.center.x, s.center.z), u, w }
    frames.set(site, f)
  }
  return f
}
export const toWorld = (f: Frame, u: number, w: number): [number, number] => [f.cx + f.u[0] * u + f.w[0] * w, f.cz + f.u[1] * u + f.w[1] * w]

// ------------------------------------------------------------------------------------------------------------- the forms (design scale, metres)

type V3 = [number, number, number]
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
/** Approximate distance to an ellipse in plan (good enough for meshing: the sign is exact, the gradient close). */
const ellipse = (a: number, b: number, ra: number, rb: number) => (Math.hypot(a / ra, b / rb) - 1) * Math.min(ra, rb)

function blade(u: number, w: number, y: number): number {
  // The mass: leaning back from the light, gently waisted, its foot spread into the ground.
  const t = clamp01(y / 40)
  const f = 0.86 + 0.16 * t * t + 0.35 * Math.exp(-Math.max(y, 0) / 4)
  const uc = -40 - 0.18 * y
  let d = ellipse(u - uc, w - 2, 16 * f, 14 * f)
  // Its top falls toward the blade: the back is the highest point and the line runs on, unbroken, out along the blade (41 → 36 → 40.5 m).
  d = smax(d, y - (41 - 0.16 * (u - uc + 16)), 6)
  // The blade: a long leaf in plan, curving toward the hero side, thinning and rising toward a rounded tip.
  const s = clamp01((u + 40) / 104)
  const wc = -8 * Math.sin(Math.PI * s * 0.9)
  const hw = 18 * Math.pow(Math.max(0, 1 - Math.pow(s, 2.2)), 0.5) + 3
  const top = 36.5 + 4 * s * s
  const th = 9 * Math.pow(1 - s, 1.6) + 2
  const plan = Math.max(Math.abs(w - wc) - hw, -(u + 46), u - 64)
  d = smin(d, slab(plan, y, top - th, top, 1.5), 9)
  // One raking pier, bowed, thick at the ground and thinning as it rises to meet the blade's underside (≈35.5 m at u = 36).
  const P: V3 = [u, y, w]
  const pier = smin(capsule(P, [16, -8, 9], [27, 15, 5], 3.4, 2.4), capsule(P, [27, 15, 5], [36, 36.5, 0], 2.4, 1.6), 2)
  d = smin(d, pier, 4)
  // A low ledge on the hero side under the blade's root: a second, nearer layer of shade.
  return smin(d, slab(ellipse(u - (uc + 12), w + 12, 19, 9), y, 12, 15, 1), 5)
}

function brackets(u: number, w: number, y: number): number {
  // The trunk: bent back from the light as it rises, its foot flared; it ends in its top plate (no head above it).
  const t = clamp01(y / 38)
  const uc = -30 - 8 * t * t
  const r = 10 - 3.5 * t + 6 * Math.exp(-Math.max(y, 0) / 4)
  let d = smax(Math.hypot(u - uc, w - 3) - r, y - 35, 6)
  // A rib down the trunk's sun side joining the plates' roots: one body, not a pole carrying discs.
  d = smin(d, capsule([u, y, w], [-22, -4, 3], [-31, 30, 3], 5, 3), 5)
  // Three plates, cascading on the sun side, very unequal: a great low one (the hall), a middle one, a small high one.
  const P: [number, number, number][] = [
    // height, reach, turn from the sun (degrees, + toward the far side)
    [9, 64, -8],
    [22, 40, 26],
    [34, 24, -22],
  ]
  for (const [h, R, deg] of P) {
    const a0 = (deg * Math.PI) / 180
    const ca = Math.cos(a0)
    const sa = Math.sin(a0)
    const pu = u - uc
    const pw = w - 3
    const a = pu * ca + pw * sa
    const bb = -pu * sa + pw * ca
    const rho = Math.hypot(Math.max(a, 0) / R, bb / (R * 0.72))
    const plan = Math.max(ellipse(Math.max(a, 0), bb, R, R * 0.7), -a - r * 0.5)
    const top = h + 1.5 - 2.5 * rho * rho
    const th = 2 + 6 * Math.pow(Math.max(0, 1 - rho), 1.3)
    d = smin(d, slab(plan, y, top - th, top, 1), 6)
  }
  return d
}

function canopy(u: number, w: number, y: number): number {
  // Two leaves of one plate: a great one tilted down toward the light, and a smaller one overlapping it lower on the hero side, so the roof's
  // edge is layered rather than one saucer rim. Each is lens-thick, thin at its edge.
  const leaf = (cu: number, cw: number, ra: number, rb: number, rot: number, h: number, tilt: number, lift: number) => {
    const c = Math.cos(rot)
    const s = Math.sin(rot)
    const a = (u - cu) * c + (w - cw) * s
    const b = -(u - cu) * s + (w - cw) * c
    const rho = clamp01(Math.hypot(a / ra, b / rb))
    const mid = h - tilt * (a / ra) - 2.5 * rho * rho + lift * (b / rb)
    const th = 2 + 4.5 * (1 - rho * rho)
    return slab(ellipse(a, b, ra, rb), y, mid - th * 0.65, mid + th * 0.35, 1)
  }
  let d = leaf(4, 6, 58, 34, 0.22, 28, 5, 2)
  d = smin(d, leaf(18, -22, 34, 20, -0.35, 19, 3, -1), 4)
  // The stems: thin at the ground, flaring into the leaves like trumpets; two clustered under the great leaf, one outrider raked under the small one.
  const S: [number, number, number, number, number][] = [
    // ground u, w → top u, w, height (inside the leaf's underside)
    [-30, 10, -12, 8, 25],
    [-22, -12, -4, -6, 24],
    [30, -32, 16, -22, 15.5],
  ]
  for (const [gu, gw, tu, tw, ty] of S) d = smin(d, capsule([u, y, w], [gu, -8, gw], [tu, ty, tw], 1.6, 4.8), 10)
  return d
}

/** Blade's mass, shared by its variants: leaning back from the light, gently waisted, its foot spread; its top falls toward the blade. */
function bladeMass(u: number, w: number, y: number, topK: number): { d: number; uc: number; f: number } {
  const t = clamp01(y / 40)
  const f = 0.86 + 0.16 * t * t + 0.35 * Math.exp(-Math.max(y, 0) / 4)
  const uc = -40 - 0.18 * y
  const d = smax(ellipse(u - uc, w - 2, 16 * f, 14 * f), y - (41 - 0.16 * (u - uc + 16)), topK)
  return { d, uc, f }
}

/** A leaf-shaped shelf growing from (u0, w0) along a heading: thick at its root, a thin lip at its edge, drooping a little; crisp, not pillowed. */
function shelf(u: number, w: number, y: number, u0: number, w0: number, deg: number, L: number, H: number, y0: number, root: number, lip: number, droop: number): number {
  const a0 = (deg * Math.PI) / 180
  const ca = Math.cos(a0)
  const sa = Math.sin(a0)
  const a = (u - u0) * ca + (w - w0) * sa
  const b = -(u - u0) * sa + (w - w0) * ca
  const s = clamp01(a / L)
  const plan = Math.max(ellipse(a - L / 2, b, L / 2, H), -a)
  const rim = clamp01(Math.hypot((a - L / 2) / (L / 2), b / H))
  const th = lip + (root - lip) * Math.pow(1 - Math.max(s, rim * rim), 1.2)
  const top = y0 - droop * s * s
  return Math.max(plan, Math.max(top - th - y, y - top))
}

function fold(u: number, w: number, y: number): number {
  let d = bladeMass(u, w, y, 2.5).d
  // The blade, folded. Across its width (q, −1 hero edge to +1 far edge) the top is two planes meeting at a crease; the crease drifts from the far
  // side at the root to the hero side at the tip, and the whole section banks (twists) toward the tip. Thickest along the crease, thin at both lips.
  const s = clamp01((u + 40) / 104)
  const wc = -8 * Math.sin(Math.PI * s * 0.9)
  const hw = 18 * Math.pow(Math.max(0, 1 - Math.pow(s, 2.2)), 0.5) + 3
  const q = Math.max(-1.2, Math.min(1.2, (w - wc) / hw))
  const qr = 0.4 - 0.75 * s
  const bank = 0.35 * s
  // A folded sheet: the hero side falls steeply from the crease (the underside follows it), the far side gently.
  const fall = q < qr ? 0.55 * (qr - q) : 0.16 * (q - qr)
  const top = 36.5 + 4 * s * s + bank * (w - wc) - fall * hw
  const thR = 9 * Math.pow(1 - s, 1.5) + 3.2
  const lip = 2
  const dq = Math.min(1, q < qr ? (qr - q) / (1 + qr) : (q - qr) / (1 - qr))
  const th = lip + (thR - lip) * Math.pow(1 - dq * dq, 0.9)
  const plan = Math.max(Math.abs(w - wc) - hw, -(u + 46), u - 64)
  d = smin(d, Math.max(plan, Math.max(top - th - y, y - top)), 7)
  // One stem, thin at the ground and flaring into the underside (Canopy's vault), leaning out toward the tip.
  return smin(d, capsule([u, y, w], [10, -8, 16], [36, 27, 0], 1.5, 4), 12)
}

function strata(u: number, w: number, y: number): number {
  const m = bladeMass(u, w, y, 6)
  let d = m.d
  // Partial ledges on the mass's shaded (hero) side only, at two heights and of different reach: the Original's layering, not its stacking.
  const L1 = Math.max(ellipse(u - m.uc, w - 2, 16 * m.f + 7, 14 * m.f + 7), w - 4 + 0.3 * (u - m.uc))
  d = smin(d, Math.max(L1, Math.max(12 - y, y - 14.2)), 2)
  const L2 = Math.max(ellipse(u - m.uc, w - 2, 16 * m.f + 4.5, 14 * m.f + 4.5), w + 2 - 0.5 * (u - m.uc))
  d = smin(d, Math.max(L2, Math.max(23.5 - y, y - 25.2)), 2)
  // The blade (as Blade, its edge a little crisper).
  const s = clamp01((u + 40) / 104)
  const wc = -8 * Math.sin(Math.PI * s * 0.9)
  const hw = 18 * Math.pow(Math.max(0, 1 - Math.pow(s, 2.2)), 0.5) + 3
  const top = 36.5 + 4 * s * s
  const th = 9 * Math.pow(1 - s, 1.6) + 2
  d = smin(d, slab(Math.max(Math.abs(w - wc) - hw, -(u + 46), u - 64), y, top - th, top, 0.6), 9)
  // The support grown from the mass: a leg swept out of its foot, low across the ground, rising to meet the blade (a quadratic curve of tapering
  // capsules), so mass, leg and blade are one continuous loop around the void.
  const P0: V3 = [-28, -4, 4]
  const P1: V3 = [12, 3, 10]
  const P2: V3 = [36, 34, 0]
  const at = (t: number): V3 => {
    const a = (1 - t) * (1 - t)
    const b = 2 * t * (1 - t)
    const c = t * t
    return [a * P0[0] + b * P1[0] + c * P2[0], a * P0[1] + b * P1[1] + c * P2[1], a * P0[2] + b * P1[2] + c * P2[2]]
  }
  const P: V3 = [u, y, w]
  let leg = Infinity
  const N = 10
  for (let k = 0; k < N; k += 1) {
    const t0 = k / N
    const t1 = (k + 1) / N
    const seg = capsule(P, at(t0), at(t1), 7 - 4.6 * t0, 7 - 4.6 * t1)
    leg = leg === Infinity ? seg : smin(leg, seg, 1.5)
  }
  d = smin(d, leg, 6)
  // The undercroft's shelves: three, unequal, at different heights and headings, two from the mass and one from the leg, overlapping in plan.
  d = smin(d, shelf(u, w, y, -26, -8, -22, 38, 10, 20, 4, 1.6, 2), 3)
  d = smin(d, shelf(u, w, y, 22, 7, 168, 30, 9, 12.5, 3.5, 1.6, 1.5), 3)
  d = smin(d, shelf(u, w, y, -28, 10, 14, 24, 8, 28, 3, 1.6, 1), 3)
  return d
}

// ------------------------------------------------------------------------------------------------------------- Blade / Strata Refined

const strataRefined = strataField(designStrata(REFERENCE_CONTROLS))

let SDF: Record<Exclude<FormId, 'original' | 'originalRefined'>, (u: number, w: number, y: number) => number> = { blade, brackets, canopy, fold, strata, strataRefined }
/** Mesh resolution (design metres): finer for the forms with thin lips and crisp folds. */
const STEP: Partial<Record<FormId, number>> = { fold: 0.8, strata: 0.8, strataRefined: 0.7 }

// ------------------------------------------------------------------------------------------------------------- meshing

const BOUNDS: FieldBounds = { u: [-80, 82], w: [-52, 52], y: [-14, 58] }

function mesh(site: StudySite, id: Exclude<FormId, 'original' | 'originalRefined'>, S: number): BufferGeometry {
  return meshField(SDF[id], frameOf(site), S, (STEP[id] ?? 1) * S, BOUNDS)
}

/**
 * Original Refined: the world's own generator (growOverhang3, unchanged and only called here), grown exactly as the world grows the Reference
 * Overhang (in the refined architecture style: seed 7, the coarse field, its form from refinedWorldForm), with that form's composition adjusted
 * through options the generator already has. Untouched, this reproduces the reference vertex for vertex (33,051 vertices); adjusted:
 *   layering   the interrupted ledges stand out more (lip ×1.7) and their bands undulate (+1.4 m warp), so they read as geological strata
 *              rather than level, stacked courses
 *   tops       hierarchy: the middle mass, which stood almost exactly as tall as the rear one (1.16 against 1.12), steps down 10% so the rear
 *              mass leads; the low mouth-side mass steps down a little more
 *   shelfThick the great shelf ×0.82, so it reads as a shelf rather than a slab against the masses
 *   step       a finer grid (×0.72), which tightens the edges the coarser sampling had softened
 * Every change keeps the bounding box and the random choices of the reference: the same organism, refined.
 */
export function refineOriginalForm(base: OrganismForm): OrganismForm {
  const c = base.compose ?? {}
  return {
    ...base,
    step: (base.step ?? 0.9) * 0.72,
    compose: {
      ...c,
      layering: { lip: (c.layering?.lip ?? 1) * 1.7, warp: (c.layering?.warp ?? 0) + 1.4 },
      tops: [c.tops?.[0] ?? 1, (c.tops?.[1] ?? 1) * 0.9, (c.tops?.[2] ?? 1) * 0.88],
      shelfThick: (c.shelfThick ?? 1) * 0.82,
    },
  }
}
function refinedOriginal(site: StudySite, S: number): BufferGeometry {
  const refined = architectureStyle() === 'refined'
  const plan = site.population.organisms.find((o) => o.index === 0) ?? site.population.organisms[0]!
  const base: OrganismForm = refined ? refinedWorldForm(site.world, plan) : {}
  const grown = refined
    ? growOverhang3(site.world, refinedSeed(0), { variation: 0, coarse: true, outlierStart: 1e5, form: refineOriginalForm(base) })
    : growOverhang3(site.world, SITE.seed, { variation: overhangOptionsFromUrl().variation ?? 0, form: refineOriginalForm(base) })
  return scaleAboutFrame(site, grown.geometry, S)
}

function scaleAboutFrame(site: StudySite, source: BufferGeometry, S: number): BufferGeometry {
  const f = frameOf(site)
  const g = source.clone()
  g.translate(-f.cx, -f.g0, -f.cz)
  g.scale(S, S, S)
  g.translate(f.cx, f.g0 - 2 * (S < 1 ? 1 : 0), f.cz)
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

/** The original, scaled about its footing (sunk a little so a smaller copy still meets the ground). */
function scaledOriginal(site: StudySite, S: number): BufferGeometry {
  const ref = site.organisms.find((o) => o.index === 0) ?? site.organisms[0]!
  if (S === 1) return ref.geometry
  const f = frameOf(site)
  const g = ref.geometry.clone()
  g.translate(-f.cx, -f.g0, -f.cz)
  g.scale(S, S, S)
  g.translate(f.cx, f.g0 - 2, f.cz)
  g.computeBoundingSphere()
  return g
}

// ------------------------------------------------------------------------------------------------------------- occlusion (for the clay view)

/**
 * What the occlusion bake reads: a true distance field (the forms built here), or, for the Original (a mesh with no field), a binary occupancy
 * (−1 inside, +1 outside) marched at a fixed step.
 */
export type Field = { d: (x: number, y: number, z: number) => number; binary: boolean; step: number }

/** A mesh made solid on a grid: for each vertical column, where the surface crosses it; a point is inside when an odd number lie below it. */
function occupancy(g: BufferGeometry, cell: number): Field {
  g.computeBoundingBox()
  const box = g.boundingBox!
  const x0 = box.min.x
  const z0 = box.min.z
  const nx = Math.ceil((box.max.x - x0) / cell) + 1
  const nz = Math.ceil((box.max.z - z0) / cell) + 1
  const cols: number[][] = Array.from({ length: nx * nz }, () => [])
  const pos = g.getAttribute('position')
  const idx = g.index
  const tri = idx ? idx.count / 3 : pos.count / 3
  const vi = (k: number) => (idx ? idx.getX(k) : k)
  for (let t = 0; t < tri; t += 1) {
    const a = vi(t * 3)
    const b = vi(t * 3 + 1)
    const c = vi(t * 3 + 2)
    const ax = pos.getX(a), az = pos.getZ(a), bx = pos.getX(b), bz = pos.getZ(b), cx = pos.getX(c), cz = pos.getZ(c)
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if (Math.abs(den) < 1e-9) continue
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - x0) / cell - 0.5))
    const i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - x0) / cell - 0.5))
    const j0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - z0) / cell - 0.5))
    const j1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - z0) / cell - 0.5))
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const px = x0 + (i + 0.5) * cell
        const pz = z0 + (j + 0.5) * cell
        const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den
        const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den
        const l3 = 1 - l1 - l2
        if (l1 < 0 || l2 < 0 || l3 < 0) continue
        cols[j * nx + i]!.push(l1 * pos.getY(a) + l2 * pos.getY(b) + l3 * pos.getY(c))
      }
    }
  }
  for (const c of cols) c.sort((p, q) => p - q)
  return {
    binary: true,
    step: cell * 0.9,
    d: (x, y, z) => {
      const i = Math.floor((x - x0) / cell)
      const j = Math.floor((z - z0) / cell)
      if (i < 0 || j < 0 || i >= nx || j >= nz) return 1
      const c = cols[j * nx + i]!
      let below = 0
      while (below < c.length && c[below]! < y) below += 1
      return below % 2 === 1 ? -1 : 1
    },
  }
}

/** The form's field in world coordinates (for the Original, its occupancy). */
const fields = new WeakMap<StudySite, Map<string, Field>>()
export function worldField(site: StudySite, id: FormId, scale: Scale): Field {
  let m = fields.get(site)
  if (!m) fields.set(site, (m = new Map()))
  const key = `${id}-${scale}`
  let fd = m.get(key)
  if (!fd) {
    if (id === 'original' || id === 'originalRefined') fd = occupancy(formGeometry(site, id, scale), 0.7 * (scale / 120) * 2)
    else {
      const f = frameOf(site)
      const S = scale / 120
      const sdf = SDF[id]
      fd = {
        binary: false,
        step: 0,
        d: (x, y, z) => {
          const dx = x - f.cx
          const dz = z - f.cz
          return sdf((dx * f.u[0] + dz * f.u[1]) / S, (dx * f.w[0] + dz * f.w[1]) / S, (y - f.g0) / S) * S
        },
      }
    }
    m.set(key, fd)
  }
  return fd
}

/** Twelve directions over the upper hemisphere (+z), cosine-weighted (more of them near the normal, as light arrives). */
const HEMI: V3[] = Array.from({ length: 12 }, (_, k) => {
  const r = Math.sqrt((k + 0.5) / 12)
  const a = k * 2.39996
  return [r * Math.cos(a), r * Math.sin(a), Math.sqrt(1 - r * r)]
})

/**
 * Ambient occlusion at each vertex, 0 open to 1 enclosed, from the form's own field: how much of the sky the point sees past the form (rays
 * marched through the field), deepened by a short cavity term that also counts the ground (so footings and the hollow under a low roof darken).
 */
export function bakeOcclusion(pos: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number }, nor: { getX(i: number): number; getY(i: number): number; getZ(i: number): number } | null, field: Field, reach: number, only?: (i: number) => boolean): Float32Array {
  const out = new Float32Array(pos.count)
  const sdf = field.d
  const ground = (x: number, y: number, z: number) => (y - landscapeHeight(x, z)) * 0.9
  for (let i = 0; i < pos.count; i += 1) {
    if (only && !only(i)) continue
    const px = pos.getX(i)
    const py = pos.getY(i)
    const pz = pos.getZ(i)
    let nx = nor ? nor.getX(i) : 0
    let ny = nor ? nor.getY(i) : 1
    let nz = nor ? nor.getZ(i) : 0
    const nl = Math.hypot(nx, ny, nz) || 1
    nx /= nl
    ny /= nl
    nz /= nl
    // A frame around the normal.
    let tx = Math.abs(ny) < 0.9 ? -nz : 1
    let ty = 0
    let tz = Math.abs(ny) < 0.9 ? nx : 0
    if (Math.abs(ny) >= 0.9) {
      tx = 1
      tz = 0
    }
    const tl = Math.hypot(tx, ty, tz) || 1
    tx /= tl
    ty /= tl
    tz /= tl
    const bx = ny * tz - nz * ty
    const by = nz * tx - nx * tz
    const bz = nx * ty - ny * tx
    // Cavity: a few steps out along the normal; the nearer the surroundings, the more enclosed.
    let cav = 0
    let wsum = 0
    for (let k = 1; k <= 5; k += 1) {
      const h = 0.8 * k
      const f = sdf(px + nx * h, py + ny * h, pz + nz * h)
      // (Occupancy knows only inside or out: outside counts as clear at this distance.)
      const d = Math.min(field.binary ? (f < 0 ? 0 : h) : f, ground(px + nx * h, py + ny * h, pz + nz * h))
      const wk = Math.pow(0.7, k)
      cav += Math.max(0, (h - d) / h) * wk
      wsum += wk
    }
    cav = Math.min(1, cav / wsum)
    // Sky: the share of rays that leave the form's reach.
    let open = 0
    for (const [a, b, c] of HEMI) {
      const dx = tx * a + bx * b + nx * c
      const dy = ty * a + by * b + ny * c
      const dz = tz * a + bz * b + nz * c
      // Start clear of the surface itself (a near-tangent ray would otherwise "hit" the face it leaves).
      let t = 1.5
      let hit = false
      while (t < reach) {
        const d = sdf(px + dx * t, py + dy * t, pz + dz * t)
        if (d < 0.15) {
          hit = true
          break
        }
        t += field.binary ? field.step : Math.max(d * 0.9, 0.4)
      }
      if (!hit) open += 1
    }
    const sky = open / HEMI.length
    out[i] = 1 - sky * (1 - 0.6 * cav)
  }
  return out
}

function fieldNormals(g: BufferGeometry, field: Field) {
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal') as BufferAttribute
  const e = 0.15
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const nx = field.d(x + e, y, z) - field.d(x - e, y, z)
    const ny = field.d(x, y + e, z) - field.d(x, y - e, z)
    const nz = field.d(x, y, z + e) - field.d(x, y, z - e)
    const l = Math.hypot(nx, ny, nz)
    if (l > 1e-6) nor.setXYZ(i, nx / l, ny / l, nz / l)
  }
  nor.needsUpdate = true
}

const groundOcc = new WeakMap<StudySite, Map<string, Float32Array>>()
/** The occlusion the form casts on the window's ground (only near the form; elsewhere open). */
export function groundOcclusion(site: StudySite, id: FormId, scale: Scale, ground: BufferGeometry): Float32Array | null {
  const field = worldField(site, id, scale)
  const geometry = formGeometry(site, id, scale)
  geometry.computeBoundingSphere()
  const sphere = geometry.boundingSphere!
  let m = groundOcc.get(site)
  if (!m) groundOcc.set(site, (m = new Map()))
  const key = `${id}-${scale}`
  let a = m.get(key)
  if (!a) {
    const pos = ground.getAttribute('position')
    const reach = 60 * (scale / 120) + 10
    // Only the ground near the form (its bounding sphere grown by the reach) can be occluded by it.
    const r = sphere.radius + reach * 0.5
    a = bakeOcclusion(pos, ground.getAttribute('normal'), field, reach, (i) => Math.hypot(pos.getX(i) - sphere.center.x, pos.getZ(i) - sphere.center.z) < r)
    m.set(key, a)
  }
  return a
}

/**
 * Development only: one uncached build of a field-based form, stage by stage, with the number of distance-field evaluations in each.
 * Run from the console: (await import('/src/habitat-study/compose/forms.ts')).profileForm(site, 'strataRefined', 60).
 */
export function profileForm(site: StudySite, id: Exclude<FormId, 'original' | 'originalRefined'>, scale: Scale, ground?: BufferGeometry, meshOnly = false) {
  const S = scale / 120
  const raw = SDF[id]
  let calls = 0
  SDF[id] = (u, w, y) => {
    calls += 1
    return raw(u, w, y)
  }
  const out: Record<string, number> = {}
  const lap = (name: string, t0: number, c0: number) => {
    out[`${name}Ms`] = Math.round(performance.now() - t0)
    out[`${name}Calls`] = calls - c0
  }
  try {
    let t = performance.now()
    let c = calls
    const g = mesh(site, id, S)
    lap('meshTotal', t, c)
    out.vertices = g.getAttribute('position').count
    // A checksum of every vertex position, to compare two builds exactly.
    const pa = g.getAttribute('position').array as Float32Array
    let sum = 0
    for (let i = 0; i < pa.length; i += 1) sum += pa[i]! * ((i % 7) + 1)
    out.checksum = sum
    if (meshOnly) {
      g.dispose()
      return out
    }
    // An uncached field over the counting function (worldField's is cached and holds the plain one).
    const f = frameOf(site)
    const count = SDF[id]
    const field: Field = {
      binary: false,
      step: 0,
      d: (x, y, z) => {
        const dx = x - f.cx
        const dz = z - f.cz
        return count((dx * f.u[0] + dz * f.u[1]) / S, (dx * f.w[0] + dz * f.w[1]) / S, (y - f.g0) / S) * S
      },
    }
    t = performance.now()
    c = calls
    fieldNormals(g, field)
    lap('fieldNormals', t, c)
    t = performance.now()
    c = calls
    bakeOcclusion(g.getAttribute('position'), g.getAttribute('normal'), field, 60 * S + 10)
    lap('formAO', t, c)
    if (ground) {
      g.computeBoundingSphere()
      const sphere = g.boundingSphere!
      const pos = ground.getAttribute('position')
      const reach = 60 * S + 10
      const r = sphere.radius + reach * 0.5
      t = performance.now()
      c = calls
      bakeOcclusion(pos, ground.getAttribute('normal'), field, reach, (i) => Math.hypot(pos.getX(i) - sphere.center.x, pos.getZ(i) - sphere.center.z) < r)
      lap('groundAO', t, c)
    }
    g.dispose()
  } finally {
    SDF[id] = raw
  }
  return out
}

const cache = new WeakMap<StudySite, Map<string, BufferGeometry>>()
export function formGeometry(site: StudySite, id: FormId, scale: Scale): BufferGeometry {
  let m = cache.get(site)
  if (!m) cache.set(site, (m = new Map()))
  const key = `${id}-${scale}`
  let g = m.get(key)
  if (!g) {
    const started = performance.now()
    const S = scale / 120
    g = id === 'original' ? scaledOriginal(site, S) : id === 'originalRefined' ? refinedOriginal(site, S) : mesh(site, id, S)
    m.set(key, g)
    // (Set before the bake: the Original's occupancy field is built from this geometry.)
    // Strata Refined: normals from the field's gradient rather than the mesh, so thin lips shade smoothly instead of beading at the grid.
    if (id === 'strataRefined') fieldNormals(g, worldField(site, id, scale))
    if (!g.getAttribute('aOcc')) g.setAttribute('aOcc', new BufferAttribute(bakeOcclusion(g.getAttribute('position'), g.getAttribute('normal'), worldField(site, id, scale), 60 * S + 10), 1))
    console.info('[habitat study] form built', { id, scale, ms: Math.round(performance.now() - started), vertices: g.getAttribute('position').count })
    m.set(key, g)
  }
  return g
}

// ------------------------------------------------------------------------------------------------------------- what the form does to the ground

export type Cover = { n: number; x0: number; z0: number; step: number; ceiling: Float32Array }
/**
 * Metres of clear air under the form at each 2 m cell of the study window (Infinity where nothing is overhead), from the form's own vertices.
 * Drives the ground's deep shade (under a roof) and which plants a form displaces.
 */
export function coverOf(geometry: BufferGeometry, x0: number, z0: number, n: number, step: number): Cover {
  const ceiling = new Float32Array(n * n).fill(Infinity)
  const pos = geometry.getAttribute('position')
  for (let v = 0; v < pos.count; v += 1) {
    const x = pos.getX(v)
    const z = pos.getZ(v)
    const i = Math.round((x - x0) / step)
    const j = Math.round((z - z0) / step)
    if (i < 0 || j < 0 || i >= n || j >= n) continue
    const h = pos.getY(v) - landscapeHeight(x, z)
    const k = j * n + i
    if (h < ceiling[k]!) ceiling[k] = Math.max(0, h)
  }
  return { n, x0, z0, step, ceiling }
}
export function ceilingAt(c: Cover, x: number, z: number): number {
  const i = Math.round((x - c.x0) / c.step)
  const j = Math.round((z - c.z0) / c.step)
  if (i < 0 || j < 0 || i >= c.n || j >= c.n) return Infinity
  return c.ceiling[j * c.n + i]!
}

/**
 * Close views of where the roof meets its supports, in each form's local frame at design scale: eye (u, w, height above the frame's ground),
 * the point looked at (u, w, height), and the lens. Two per form.
 */
export type Detail = { label: string; eye: V3; at: V3; fov: number }
export const DETAIL: Partial<Record<FormId, [Detail, Detail]>> = {
  blade: [
    { label: 'Pier joint', eye: [8, -46, 8], at: [34, 0, 31], fov: 30 },
    { label: 'Mass to blade', eye: [4, -30, 6], at: [-26, 0, 28], fov: 40 },
  ],
  canopy: [
    { label: 'Stems to roof', eye: [44, 6, 4], at: [-12, 0, 20], fov: 34 },
    { label: 'Outrider', eye: [72, -66, 8], at: [18, -22, 15], fov: 32 },
  ],
  fold: [
    { label: 'Stem to blade', eye: [58, 34, 4], at: [32, 2, 24], fov: 36 },
    { label: 'Fold and tip', eye: [86, -36, 34], at: [40, -6, 37], fov: 34 },
  ],
  strataRefined: [
    { label: 'Leg to blade', eye: [8, -46, 8], at: [30, 2, 26], fov: 32 },
    { label: 'Shelf roots', eye: [6, -44, 6], at: [-20, 0, 19], fov: 40 },
  ],
  strata: [
    { label: 'Leg to blade', eye: [8, -46, 8], at: [30, 2, 26], fov: 32 },
    { label: 'Shelves', eye: [6, -44, 6], at: [-14, 0, 19], fov: 40 },
  ],
  brackets: [
    { label: 'Plate roots', eye: [10, -30, 8], at: [-24, 0, 20], fov: 40 },
    { label: 'Great plate rim', eye: [50, -40, 4], at: [30, -6, 8], fov: 36 },
  ],
}

/** Where to stand under each form's roof, in its local frame at design scale: eye (u, w) and the point looked at (u, w, height). */
export const UNDER: Record<Exclude<FormId, 'original' | 'originalRefined'>, { eye: [number, number]; at: [number, number, number] }> = {
  // Each stands in the form's deepest shade and looks out past its edge, so the roof, its supports and the light beyond are in one frame.
  blade: { eye: [-6, 8], at: [60, -10, 16] },
  brackets: { eye: [22, 4], at: [80, -14, 4] },
  canopy: { eye: [-10, 2], at: [60, -36, 9] },
  fold: { eye: [-6, 8], at: [60, -10, 16] },
  strata: { eye: [0, -14], at: [60, -10, 13] },
  strataRefined: { eye: [0, -14], at: [60, -10, 13] },
}
