import type { OrganismForm, OverhangCompose } from '../project03/livingOverhang3.ts'

/**
 * Architecture Lab: direct morphology controls for the Overhang (lab only; the world never applies them).
 *
 * Applied to the OrganismForm after the habitat (formFromHabitat) and the seed (refinedForm) have made it, before growOverhang3 grows it,
 * so every lifecycle stage (life.at) regrows from the overridden form. The three continuous controls are multipliers on what the seed and
 * habitat produced (1 leaves it exactly as it was: the form is returned untouched), clamped to the ranges the generator already sees:
 *   height      × form.keep       every mass's height                       (0.6–1.5)
 *   reach       × form.reach      the cantilever's length from the keep face (0.55–1.6)
 *   undercroft  × form.shelfLift  the great shelf's height: the open, shaded space beneath it (0.75–1.5)
 * Supports is a choice, absent until set (the seed decides):
 *   carried     the outlier body takes the shelf's end; the seed's piers stay
 *   braced      no outlier; at least three raking piers (the seed's, plus evenly spaced ones if it had fewer)
 *   free        no outlier and no extra piers: the cantilever on its one reference pier
 * Note: the generator draws its strata bands up to the tallest mass from its one random stream, so Height (and the outlier's presence) can
 * shift later random detail (bands, the cleft, recesses). The arrangement chosen by the seed is kept.
 */
export type Supports = 'carried' | 'braced' | 'free'
export type OverhangOverrides = { height?: number; reach?: number; undercroft?: number; supports?: Supports }

export const OVERHANG_SLIDERS: { key: 'height' | 'reach' | 'undercroft'; label: string; min: number; max: number; tip: string }[] = [
  { key: 'height', label: 'Height', min: 0.7, max: 1.4, tip: 'Every mass’s height, against what the seed and habitat grew (1 = as grown). Changing it can re-roll small detail (strata bands, cleft).' },
  { key: 'reach', label: 'Reach', min: 0.7, max: 1.5, tip: 'The cantilever’s length from the keep, against what the seed and habitat grew.' },
  { key: 'undercroft', label: 'Undercroft', min: 0.8, max: 1.4, tip: 'The great shelf’s height: how tall and open the shaded space beneath it is.' },
]
export const SUPPORTS: { value: Supports; label: string; tip: string }[] = [
  { value: 'carried', label: 'Carried', tip: 'The outlier body takes the shelf’s end.' },
  { value: 'braced', label: 'Braced', tip: 'No outlier: at least three raking piers.' },
  { value: 'free', label: 'Free', tip: 'No outlier, no extra piers: one reference pier.' },
]

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const scaled = (base: number | undefined, k: number | undefined, lo: number, hi: number) => (k === undefined || k === 1 ? base : clamp((base ?? 1) * k, lo, hi))

export function applyOverrides(form: OrganismForm, o: OverhangOverrides | undefined): OrganismForm {
  if (!o) return form
  const changed = (o.height !== undefined && o.height !== 1) || (o.reach !== undefined && o.reach !== 1) || (o.undercroft !== undefined && o.undercroft !== 1) || o.supports !== undefined
  if (!changed) return form
  const out: OrganismForm = { ...form }
  if (o.height !== undefined && o.height !== 1) out.keep = scaled(form.keep, o.height, 0.6, 1.5)
  if (o.reach !== undefined && o.reach !== 1) out.reach = scaled(form.reach, o.reach, 0.55, 1.6)
  if (o.undercroft !== undefined && o.undercroft !== 1) out.shelfLift = scaled(form.shelfLift, o.undercroft, 0.75, 1.5)
  if (o.supports === 'carried') out.outlier = true
  else if (o.supports === 'braced' || o.supports === 'free') {
    out.outlier = false
    const seedPiers = form.compose?.piers ?? []
    let piers: NonNullable<OverhangCompose['piers']> = []
    if (o.supports === 'braced') {
      piers = [...seedPiers]
      // Evenly spaced along the shelf, alternating sides, for those the seed did not grow.
      for (let i = piers.length; i < 3; i += 1) piers.push({ u: 0.3 + 0.22 * i, side: i % 2 === 0 ? 0.6 : -0.6, len: 11, lean: 1.4 })
    }
    out.compose = { ...(form.compose ?? {}), piers, keepPier: true }
  }
  return out
}
