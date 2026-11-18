import { LOW } from './candLow.ts'
import { TREES } from './candTrees.ts'
import { WATER } from './candWater.ts'
import { SHADE } from './candShade.ts'
import { BASIS } from './basis.ts'
import { leafForm } from './ecology.ts'
import { NEUTRAL_LEAF } from './geo.ts'
import type { ArchetypeId, Candidate } from './types.ts'

/**
 * Every candidate is built with its leaf phenotype set from the plant's light (ecology.ts, leafForm), here, once, so the Lab and
 * the island grow sun and shade leaves by the same rule. Submerged plants keep neutral leaves: their light is set by depth.
 */
export const CANDIDATES: Candidate[] = [...TREES, ...SHADE, ...LOW, ...WATER].map((c) => ({
  ...c,
  basis: BASIS[c.id],
  build: (g, p, r) => {
    g.leaf = c.archetype === 'submerged' ? NEUTRAL_LEAF : leafForm(p.light, c.light === 'shade')
    c.build(g, p, r)
  },
}))
export const candidatesOf = (a: ArchetypeId) => CANDIDATES.filter((c) => c.archetype === a)
