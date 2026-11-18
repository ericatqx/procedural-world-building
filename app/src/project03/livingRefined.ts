import { formFromHabitat, type OrganismPlan } from './livingEcology.ts'
import { waterBearing } from './livingArchitecture.ts'
import type { OrganismForm } from './livingOverhang3.ts'
import type { World } from './world.ts'
import { refinedForm } from '../architecture-lab/overhangRefined.ts'
import { terrainContext, waterSide } from '../architecture-lab/terrainContext.ts'
import type { Habitat } from '../architecture-lab/families.ts'

/**
 * The Architecture Lab's refined Overhang, for an organism of the world: the same function the Lab calls (overhangRefined.ts),
 * given the place the population gave the organism (its light, moisture and resources, its exposure and crowding, its distance to
 * the water, the ground's slope and rise at its site) in the Lab's own terms. Nothing is duplicated: the world's organism is the
 * Lab's organism for that habitat and terrain. The reference organism (LA-01) is the Lab's Seed 7.
 *
 * The world keeps what it already knew about the place: the frame turned toward the organism's own opening (yaw), its size and grid, and
 * which way the opening's more open side lies; the strata are made subtler and undulating (`layering`).
 */
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
/** What counts as no adaptation on the island: a gentle slope and a level reach. */
const WORLD_REF = { slope: 0.03, rise: 0 }
export const REFERENCE_SEED = 7

/** The generator's seed for an organism: the Lab's Seed 7 for the reference, its own number for the rest. */
export const refinedSeed = (index: number) => (index === 0 ? REFERENCE_SEED : index + 1)

export function refinedWorldForm(world: World, plan: OrganismPlan): OrganismForm {
  const b = plan.base
  const size = plan.form.size ?? 1
  // The habitat's size is the organism's class (what the ground lets it grow): its drawn size is only how large it is drawn.
  const sizeClass = plan.sizeClass ?? size
  const habitat: Habitat = { light: b.light, moisture: b.moisture, resource: b.resource, ridge: plan.ridge, crowding: plan.crowding, waterDist: b.waterDist < 400 ? b.waterDist : null, size: sizeClass }
  const lit = clamp((b.light - 0.55) / 0.25, -1, 1)
  // The reference organism has no form of its own (it is the reference): give it the one its habitat gives.
  const base: OrganismForm =
    plan.index === 0
      ? { anchored: true, site: [plan.x, plan.z], yaw: 0, size, step: 0.9, ...formFromHabitat({ lit, resource: b.resource, ridge: plan.ridge, crowding: plan.crowding, moisture: b.moisture, waterDist: b.waterDist, size: sizeClass }), outlier: b.resource > 0.42 && b.waterDist > 40, oldShelf: true }
      : { ...plan.form }
  const yaw = base.yaw ?? 0
  const wb = b.waterDist < 400 ? waterBearing(world, plan.x, plan.z) : null
  const cs = waterSide(wb ? [wb[0], wb[2]] : null, yaw)
  // The world already measures the rise of the ground along the opening (base.rise): count the rest of the terrain's effect only.
  const terrain = { ...terrainContext([plan.x, plan.z], cs, yaw, WORLD_REF), rise: 0 }
  const refined = refinedForm(refinedSeed(plan.index), habitat, base, terrain)
  // The side the opening is more open on (the world's own measure) decides which way the cantilever swings; the refined form decides how far.
  const swing = base.swing !== undefined && Math.abs(base.swing) > 0.3 ? Math.sign(base.swing) * Math.abs(refined.swing ?? 1) : refined.swing
  return { ...refined, swing, compose: { ...refined.compose, layering: { lip: 0.55, warp: 1.7 } }, grounded: true }
}
