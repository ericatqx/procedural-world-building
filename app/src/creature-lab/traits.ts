import { rng } from './geo.ts'
import type { SpeciesId } from './types.ts'

/**
 * Individual variation as a few LINKED body-plan axes, not independent jitter. Each axis is one number from -1 to 1 per individual, and each
 * moves several parts of the anatomy together in the direction an animal's body actually trades them off (a lither body has longer legs AND a
 * slimmer trunk AND a longer tail; a wading body has longer legs AND a smaller swimming fan). Most individuals sit near the middle: each axis
 * is the mean of two draws, a triangular spread, so extremes are rare.
 *
 * The axes come from their own random stream (seeded from the seed and the species), separate from the stream the builder draws counts and
 * small asymmetries from, so adding an axis never reshuffles the rest of an individual. Age, condition, mineral and habitat still act on top:
 * an axis is what the individual is born with; the controls are what its life has done to it.
 */
export type TraitAxis = { key: string; label: string; low: string; high: string; drives: string }
export type Traits = Record<string, number>
export type TraitReading = TraitAxis & { value: number }

export const AXES: Partial<Record<SpeciesId, TraitAxis[]>> = {
  dweller: [
    { key: 'build', label: 'Build', low: 'stocky', high: 'lithe', drives: 'leg length +/-12%, girth -/+9%, tail segment length +/-10%; the walk stride follows the legs' },
    { key: 'head', label: 'Head : body', low: 'small head', high: 'large head', drives: 'skull +/-13%, muzzle +/-8%, ears +/-10%' },
    { key: 'fore', label: 'Forelimbs', low: 'runner', high: 'digger', drives: 'digger: foreleg +9% against hind leg -4%; forelimb thickness +/-18%, claws +/-35%' },
  ],
  strider: [
    { key: 'legs', label: 'Legs : fan', low: 'swimmer', high: 'wader', drives: 'leg length +/-14% against tail fan -/+18%; deeper water reach, longer stride' },
    { key: 'sail', label: 'Sail', low: 'low, few rays', high: 'tall, many rays', drives: 'dorsal rays -/+2, ray length +/-16%' },
    { key: 'body', label: 'Body', low: 'deep', high: 'slender', drives: 'girth -/+10%, body depth' },
  ],
}

export function traitsOf(species: SpeciesId, seed: number): Traits {
  const r = rng(seed * 7919 + species.length * 101 + species.charCodeAt(0))
  const out: Traits = {}
  for (const a of AXES[species] ?? []) out[a.key] = r() + r() - 1
  return out
}

export const readTraits = (species: SpeciesId, t: Traits): TraitReading[] => (AXES[species] ?? []).map((a) => ({ ...a, value: t[a.key] ?? 0 }))
