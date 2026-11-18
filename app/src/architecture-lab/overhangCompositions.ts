import type { Arm, OrganismForm, OverhangCompose } from '../project03/livingOverhang3.ts'
import type { Habitat } from './families.ts'

/**
 * (Kept, not offered: the four-composition version of the refined Overhang. The offered one is overhangRefined.ts.)
 * The refined Overhang: the world's own generator (livingOverhang3.ts), unchanged in its parts, with a COMPOSITION chosen from the seed.
 * Four compositions, all built from the Overhang's own vocabulary (masses on a plinth, cantilevers, raking piers, an undercroft), and
 * each with its own structural logic:
 *   tower     one tall, upright mass with one long free cantilever, braced by two or three raking piers, and sometimes a short counter-arm behind.
 *   twin      two towers of unequal height standing apart, joined by a bridge shelf, with a cantilever out from the taller and an arm from the other.
 *   hub       a central cluster of masses with three cantilevers in different directions, at different heights and lengths, on piers.
 *   terrace   lower and broader: squat masses with a low cantilever, a lower outlier body and two stepped platforms at different levels.
 * The seed picks the composition (consecutive seeds cycle through them) and, inside it, sets every proportion (heights, widths, lengths, directions, thicknesses, where the piers stand). Main
 * towers stay upright (a lean of a few hundredths at most). The habitat acts on top, as in the world (formFromHabitat) and through
 * `base`: it changes proportion and emphasis, never the composition. Draws are by seed alone, so one seed keeps its composition.
 */
const rv = (seed: number, a: number, b: number) => {
  const s = Math.sin(seed * 12.9898 + a * 78.233 + b * 37.719 + 3.1) * 43758.5453
  return s - Math.floor(s)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export type Composition = 'tower' | 'twin' | 'hub' | 'terrace'
export const COMPOSITIONS: Composition[] = ['tower', 'twin', 'hub', 'terrace']
/** Consecutive seeds take the four compositions in turn, so a sheet of seeds shows them all (each seed's proportions are its own). */
export const compositionOf = (seed: number): Composition => COMPOSITIONS[((Math.floor(seed) % 4) + 4) % 4]!

export function refinedForm(seed: number, h: Habitat, base: OrganismForm): OrganismForm {
  const r = (k: number) => rv(seed, 400, k)
  const L = (a: number, b: number, k: number) => lerp(a, b, r(k))
  const side = r(2) < 0.5 ? 1 : -1
  const comp = compositionOf(seed)
  const wet = h.moisture
  const exposed = clamp(h.ridge, -1, 1)
  const tinyLean = side * L(0, 0.03, 3)
  const pierRun = (n: number, from: number, to: number, k: number) => Array.from({ length: n }, (_, i) => ({ u: lerp(from, to, (i + r(k + i) * 0.5) / Math.max(1, n)), side: (i % 2 === 0 ? 1 : -1) * L(0.2, 0.8, k + 10 + i), len: L(11, 16, k + 20 + i), lean: L(0.8, 2.4, k + 30 + i) }))

  let compose: OverhangCompose
  let form: OrganismForm = { ...base }

  if (comp === 'tower') {
    // One upright tower, one long free cantilever, braced.
    const arms: Arm[] = []
    if (r(10) < 0.55) arms.push({ mass: 0, ang: Math.PI * side * L(0.62, 0.85, 11), len: L(18, 26, 12), hw: [6, 4.5], thick: [4.2, 2.6], top: L(15, 19, 13), sag: 1.5, piers: [{ at: 0.55, len: 11, lean: 1 }] })
    compose = {
      tops: [L(1.1, 1.3, 14), L(0.45, 0.6, 15), L(0.4, 0.7, 16)],
      widths: [L(1, 1.15, 17) * (1 + 0.06 * exposed), 0.9, 0.9],
      shifts: [[-2, 0], [-2, 0]],
      lean: [tinyLean, 0, 0],
      extra: r(18) < 0.3 ? { cu: L(-32, -24, 19), cw: side * L(12, 17, 20), hu: L(6, 8, 21), hw: L(6, 8, 22), top: L(10, 14, 23), taper: 0.2, lean: 0 } : undefined,
      shelfThick: L(1.25, 1.45, 24),
      shelfWidth: L(0.9, 1.1, 25),
      piers: pierRun(2 + (r(26) < 0.5 ? 1 : 0), 0.38, 0.84, 27),
      keepPier: true,
      arms,
      soft: clamp(L(0.15, 0.4, 28) + 0.15 * wet, 0, 0.7),
    }
    form = { ...form, reach: (base.reach ?? 1) * L(1.35, 1.7, 29), shelfLift: clamp((base.shelfLift ?? 1) * L(1.12, 1.3, 30), 0.75, 1.5), swing: L(-1.2, 1.8, 31), rise: (base.rise ?? 0) + L(-2, 3, 32), outlier: false, oldShelf: (base.oldShelf ?? true) && r(33) < 0.25 }
  } else if (comp === 'twin') {
    // Two towers apart, a bridge between them, a cantilever from the taller one and an arm from the other.
    const arms: Arm[] = [
      { mass: 0, to: 1, ang: 0, len: 0, hw: [5.4, 5], top: L(13, 17, 11), thick: [3.8, 3.4], sag: 1.2, piers: r(12) < 0.6 ? [{ at: 0.5, len: 11, lean: 0 }] : [] },
      { mass: 1, ang: side * L(0.9, 1.6, 13), len: L(20, 28, 14), hw: [6, 4.5], thick: [4.2, 2.8], top: L(18, 23, 15), sag: 2, piers: [{ at: 0.55, len: 13, lean: 1.4 }] },
    ]
    const outlier = (base.outlier ?? true) && r(16) < 0.5
    compose = {
      tops: [L(0.95, 1.1, 17), L(1.05, 1.3, 18), L(0.4, 0.6, 19)],
      widths: [1, L(0.95, 1.1, 20), 0.9],
      shifts: [[L(0, 6, 21), L(9, 14, 22)], [-1, -2]],
      lean: [tinyLean, -tinyLean, 0],
      noCleft: true,
      shelfThick: L(1, 1.2, 23),
      shelfWidth: L(0.9, 1.05, 24),
      piers: outlier ? [] : pierRun(2, 0.4, 0.8, 25),
      keepPier: r(26) < 0.7,
      arms,
      soft: clamp(L(0.15, 0.45, 27) + 0.15 * wet, 0, 0.7),
    }
    form = { ...form, reach: (base.reach ?? 1) * L(0.8, 1.1, 28), shelfLift: clamp((base.shelfLift ?? 1) * L(0.9, 1.1, 29), 0.75, 1.4), swing: L(-0.8, 1.2, 30), outlier, oldShelf: false }
  } else if (comp === 'hub') {
    // A central cluster with three cantilevers in different directions.
    const th = L(-0.4, 0.4, 10)
    const arms: Arm[] = [
      { mass: 0, ang: th, len: L(30, 38, 11), hw: [8, 6], thick: [5, 3.2], top: L(20, 24, 12), sag: 2.5, piers: [{ at: 0.5, len: 14, lean: 1.5 }, { at: 0.8, len: 16, lean: 2 }] },
      { mass: 0, ang: th + side * L(1.9, 2.4, 13), len: L(22, 28, 14), hw: [7, 5], thick: [4.6, 3], top: L(15, 18, 15), sag: 2, piers: [{ at: 0.6, len: 12, lean: 1 }] },
      { mass: 1, ang: th - side * L(2.1, 2.7, 16), len: L(18, 24, 17), hw: [6.5, 5], thick: [4.4, 3], top: L(10, 13, 18), sag: 1.5, piers: r(19) < 0.6 ? [{ at: 0.65, len: 10, lean: 1 }] : [] },
    ]
    compose = {
      tops: [L(0.95, 1.1, 20), L(0.7, 0.9, 21), L(0.55, 0.8, 22)],
      widths: [L(1.2, 1.4, 23), L(1.2, 1.4, 24), L(1.1, 1.3, 25)],
      shifts: [[L(-8, -4, 26), L(-6, 0, 27)], [L(-8, -5, 28), L(2, 8, 29)]],
      lean: [tinyLean, 0, 0],
      noShelf: true,
      keepPier: false,
      arms,
      soft: clamp(L(0.2, 0.5, 30) + 0.15 * wet, 0, 0.75),
    }
    form = { ...form, outlier: false, mezzanine: false, curtain: false, oldShelf: (base.oldShelf ?? true) && r(31) < 0.4, lowMass: true }
  } else {
    // Lower and broader: squat masses, a low cantilever, a lower outlier, stepped platforms.
    const arms: Arm[] = [
      { mass: 0, ang: side * L(0.9, 1.4, 10), len: L(24, 30, 11), hw: [9, 7], thick: [5.2, 3.6], top: L(10, 13, 12), sag: 1.5, piers: [{ at: 0.6, len: 10, lean: 1 }] },
      { mass: 1, ang: -side * L(0.9, 1.5, 13), len: L(20, 26, 14), hw: [8, 6.5], thick: [4.8, 3.4], top: L(6, 8, 15), sag: 1, piers: [{ at: 0.55, len: 8, lean: 1 }] },
    ]
    compose = {
      tops: [L(0.5, 0.65, 16), L(0.55, 0.75, 17), L(0.5, 0.8, 18)],
      widths: [L(1.2, 1.4, 19), L(1.2, 1.4, 20), L(1.15, 1.35, 21)],
      shifts: [[L(-3, 3, 22), L(-3, 3, 23)], [L(-3, 3, 24), L(-3, 3, 25)]],
      lean: [0, 0, 0],
      extra: r(26) < 0.65 ? { cu: L(-32, -22, 27), cw: -side * L(12, 18, 28), hu: L(8, 11, 29), hw: L(8, 11, 30), top: L(10, 16, 31), taper: 0.12, lean: 0 } : undefined,
      shelfThick: L(1.2, 1.4, 32),
      shelfWidth: L(1.1, 1.25, 33),
      piers: pierRun(1, 0.5, 0.75, 34),
      keepPier: true,
      arms,
      soft: clamp(L(0.2, 0.5, 35) + 0.15 * wet, 0, 0.75),
    }
    form = { ...form, reach: (base.reach ?? 1) * L(0.85, 1.15, 36), shelfLift: L(0.5, 0.62, 37), swing: L(-0.8, 1, 38), rise: L(-1, 2, 39), outlier: base.outlier ?? true, oldShelf: false }
  }
  return { ...form, compose }
}
