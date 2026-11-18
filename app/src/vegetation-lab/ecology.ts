import { clamp, type LeafForm } from './geo.ts'
import type { PlantParams } from './types.ts'

/**
 * Vegetation Morphology Lab — the shared ecological responses the generators read, so that a control changes how a plant is
 * built for a reason, not just how big it is. This is ecologically informed procedural growth, not physiology: each rule is
 * either an EVIDENCE-INFORMED APPROXIMATION of a well-described pattern (marked E), or an ARTISTIC ABSTRACTION chosen for the
 * island's look (marked A). None is calibrated to a species.
 *
 *   range response   (E) every plant has a moisture and a light range it does best in: it declines toward either end, and
 *                    only plants adapted to flooding do not decline when saturated. Vigor (0 to 1) then sets how much the
 *                    plant builds (stems, tiers, leaves), not just its size.
 *   stage            (E) juvenile and mature forms differ in structure: a young tree is a short leader with low branches that
 *                    are shed as the crown lifts; a young fern has few small fronds; a clonal plant spreads with age.
 *   shade response   (E) in moderate shade, shoots elongate toward light and branch less; in deep shade, they stop building.
 *                    A crown leans toward the gap (A: the lit side is +z in the lab).
 *   wind response    (E) persistent exposure prunes the windward side, shortens and thickens stems and compacts the plant, so
 *                    it is permanently asymmetric (A: wind blows toward +x; the strengths are exaggerated to read).
 */
export const ramp = (x: number, a: number, b: number) => clamp((x - a) / (b - a))
export const smooth = (t: number) => t * t * (3 - 2 * t)

/** Zero below [0], full between [1] and [2], falling to zero by [3]. */
export type Range4 = [number, number, number, number]
export const fit = (x: number, r: Range4, floor = 0) => floor + (1 - floor) * smooth(Math.min(ramp(x, r[0], r[1]), 1 - ramp(x, r[2], r[3])))

export type Needs = { moisture: Range4; light: Range4 }
export type Condition = {
  /** 0 to 1: how well the moisture and light suit it. */
  vigor: number
  /** 0 to 1: how dry for it, how saturated for it, how dim for it, how much glare for it. */
  drought: number
  waterlog: number
  dim: number
  glare: number
}

export function condition(p: PlantParams, n: Needs): Condition {
  const m = fit(p.moisture, n.moisture, 0.06)
  const l = fit(p.light, n.light, 0.06)
  return {
    vigor: Math.sqrt(m * l),
    drought: 1 - ramp(p.moisture, n.moisture[0], n.moisture[1]),
    waterlog: ramp(p.moisture, n.moisture[2], n.moisture[3]),
    dim: 1 - ramp(p.light, n.light[0], n.light[1]),
    glare: ramp(p.light, n.light[2], n.light[3]),
  }
}

/** The plants' needs, by archetype and habit. */
export const NEEDS: Record<string, Needs> = {
  upland: { moisture: [0.05, 0.3, 0.7, 1.05], light: [0.2, 0.6, 1.2, 1.3] },
  understory: { moisture: [0.12, 0.45, 0.85, 1.05], light: [0.02, 0.2, 0.7, 1.2] },
  /** The coppice: a sun-loving thicket of open ground and woodland edges (it was on the understory's needs, which let a sun specialist flourish in shade). */
  scrub: { moisture: [0.1, 0.4, 0.8, 1.05], light: [0.15, 0.55, 1.2, 1.3] },
  fern: { moisture: [0.3, 0.6, 0.95, 1.2], light: [0.05, 0.2, 0.65, 1.15] },
  mat: { moisture: [0.12, 0.4, 0.8, 1.05], light: [0.1, 0.4, 1.2, 1.3] },
  moss: { moisture: [0.2, 0.5, 0.95, 1.2], light: [0.03, 0.25, 0.8, 1.2] },
  vine: { moisture: [0.15, 0.4, 0.9, 1.2], light: [0.1, 0.4, 0.9, 1.2] },
  parasol: { moisture: [0.25, 0.5, 1, 1.25], light: [0, 0.03, 0.35, 0.75] },
  humid: { moisture: [0.3, 0.6, 1, 1.3], light: [0, 0.05, 0.5, 1.2] },
  tank: { moisture: [0.2, 0.5, 1, 1.3], light: [0.1, 0.35, 0.9, 1.2] },
  flood: { moisture: [0.35, 0.65, 1.2, 1.3], light: [0.2, 0.5, 1.2, 1.3] },
  shore: { moisture: [0.3, 0.6, 1.2, 1.3], light: [0.3, 0.6, 1.2, 1.3] },
}

export const juvenile = (age: number) => 1 - smooth(ramp(age, 0.1, 0.5))
export const mature = (age: number) => smooth(ramp(age, 0.4, 0.85))
/**
 * Late decline, and only past a mature crown. At 0.85 — the mature individual the island instances — this is still zero,
 * so aging appears at the top of the lab's age range and does not rewrite a mature plant.
 */
/** Size growth from germination (0) to full size at age 0.85 (1): every species' height and spread follow it, so a seedling starts at ground level. */
export const grownAt = (age: number) => smooth(Math.min(1, age / 0.85))
export const senescent = (age: number) => smooth(ramp(age, 0.9, 1))

/** How much a branch heading `hd` (0 = downwind, +x) is pruned by persistent wind: 0 downwind, up to 1 into the wind. */
export const windward = (p: PlantParams, hd: number) => clamp(-Math.cos(hd) * 1.15) * p.wind ** 1.2
/** Shorter internodes, a lower and denser plant. */
export const compact = (p: PlantParams) => 1 - 0.42 * p.wind
/** Stems and trunks thicken where they are exposed (wind hardening). */
export const hardening = (p: PlantParams) => 1 + 0.7 * p.wind
/** Toward the lit side (+z): shade makes a crown reach for the gap. */
export const gapward = (c: Condition, hd: number) => 1 + 0.7 * c.dim * Math.sin(hd)

/**
 * SUN AND SHADE LEAVES (E). The same plant grown in shade and in sun makes different leaves: shade leaves are larger, broader,
 * thinner and darker, held flat to catch what light there is (a single layer); sun leaves are smaller, narrower, paler and
 * held at a steeper angle, which spreads strong light down through several layers. Shoots follow the same split: in sun a crown
 * builds more tiers (a multilayer crown); in shade, fewer and flatter (a monolayer). A: the exact amounts, chosen to read.
 * Light 0.15 or less is fully shade-grown, 0.9 or more fully sun-grown.
 */
export function leafForm(light: number, specialist = false): LeafForm {
  const k = 2 * smooth(ramp(light, 0.15, 0.9)) - 1
  // Shade SPECIALISTS add the blue iridescent sheen of deep-shade leaves (identity, not response: a generalist in shade does not get it).
  return { k, size: 1 - 0.24 * k, width: 1 - 0.3 * k, droop: 1 + 0.45 * k, sheen: specialist ? Math.max(0, -k) : 0 }
}
/** In words, for the Lab's readouts. */
export const leafLabel = (f: LeafForm) => (f.k < -0.35 ? 'shade leaves' : f.k > 0.35 ? 'sun leaves' : 'intermediate leaves')

/** Which needs each Lab candidate grows by (its generator's own call to `condition`). */
export const NEEDS_OF: Record<string, string> = {
  spar: 'upland', buttress: 'flood', parasol: 'parasol', canes: 'understory', coppice: 'scrub', rosette: 'fern', stolons: 'mat', cushion: 'moss',
  vine: 'vine', curtain: 'humid', brackets: 'tank', reed: 'shore', sedge: 'shore', broadleaf: 'shore',
}

/** How a species does at a light (the same rule its generator uses): its vigor there, and a word for it. */
export function lightResponse(cand: string, light: number): { vigor: number; word: string } | null {
  const n = NEEDS[NEEDS_OF[cand] ?? '']
  if (!n) return null
  const v = fit(light, n.light, 0.06)
  return { vigor: v, word: v > 0.75 ? 'thrives' : v > 0.35 ? 'tolerates' : 'struggles' }
}
