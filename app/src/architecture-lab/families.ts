/**
 * Architecture Lab: the two morphology families, and what each one's generator genuinely takes.
 *
 * The lab is a standalone workspace: specimens on a small stage. Two families (see docs/analysis/living-architecture-visual-grammar.md):
 *   Overhang        the world's own generator (livingOverhang3.ts), refined: the same keep, cantilevered shelves, supports and undercroft,
 *                   with the seed choosing the arrangement (overhangRefined.ts). The original stays selectable beside it.
 *   Porous Growth   designed first (porousDesign.ts): one vertical family, a cluster of tiered towers grown together, with bridges, a
 *                   buttress and large openings; the place sets how vertical it is, where it faces, and where its roots land.
 *   Strata          Blade / Strata Refined from the Habitat Study, made procedural (strataDesign.ts, strataField.ts): a leaning mass, one
 *                   long blade reaching toward the light, a leg grown from the mass that sweeps up into the blade, lobed shelves in the
 *                   undercroft. The seed draws its morphology controls; habitat adaptation and growth stages are not modelled yet.
 * The earlier generators are kept in the code (organismGrowth.ts, porousGrowth.ts, ascendingGrowth.ts, hybridGrowth.ts) but are not offered.
 */
export type FamilyId = 'overhang' | 'porous' | 'strata'
/** The Overhang family's form: the world's own generator as it is, or refined (the same generator with a seed-chosen composition). */
export type OverhangVariant = 'original' | 'refined'

/** The one place every specimen stands: the reference organism's site on the default terrain (the island itself is not loaded). */
export const TERRAIN_SEED = 909387746
export const SPECIMEN_SITE: [number, number] = [740, -220]

/** Where the specimens of a view stand: one at the centre, two either side of it, more on a grid (all on the terrain's own height). */
export const LAYOUT_GAP = 125
export function layoutSites(count: number): [number, number][] {
  if (count <= 1) return [SPECIMEN_SITE]
  if (count === 2) return [[SPECIMEN_SITE[0] - 55, SPECIMEN_SITE[1]], [SPECIMEN_SITE[0] + 55, SPECIMEN_SITE[1]]]
  const cols = 3
  return Array.from({ length: count }, (_, i) => [SPECIMEN_SITE[0] + ((i % cols) - 1) * LAYOUT_GAP, SPECIMEN_SITE[1] + (Math.floor(i / cols) - 0.5) * LAYOUT_GAP] as [number, number])
}

/** What a place gives an organism. */
export type Habitat = {
  /** 0 shaded to 1 open (the island's mean is about 0.55). */
  light: number
  moisture: number
  /** Soil and water supply: 0 poor to 1 rich. */
  resource: number
  /** -1 hollow to 1 ridge: how exposed the ground is. */
  ridge: number
  /** 0 to 1: how crowded, shaded or uneven by neighbours. */
  crowding: number
  /** Metres from the specimen to the nearest water, or null for none near. A lake is placed there for the generator to sense. */
  waterDist: number | null
  /** Metres of organism per unit (1 is the reference organism's size). */
  size: number
}

export const NEUTRAL: Habitat = { light: 0.6, moisture: 0.5, resource: 0.6, ridge: 0, crowding: 0, waterDist: 90, size: 1 }

export type HabitatKey = Exclude<keyof Habitat, 'waterDist'> | 'waterDist'

export const PRESETS: { id: string; label: string; habitat: Partial<Habitat>; note: string; /** What both families do with it. */ rule: string }[] = [
  { id: 'reference', label: 'Reference', habitat: NEUTRAL, note: 'The conditions the reference organism stands in.', rule: 'The baseline: the seed’s own shoots and shelves, with no adaptation.' },
  { id: 'ridge', label: 'Open ridge', habitat: { light: 0.9, moisture: 0.3, resource: 0.45, ridge: 0.9, crowding: 0, waterDist: null }, note: 'Lit, dry, exposed: broad and low, reaching out.', rule: 'Exposure and wind keep shoots lower and thicker with a heavier skirt and less wear; the strong light lengthens what reaches sideways, so growth is mostly lateral and low.' },
  { id: 'hollow', label: 'Sheltered hollow', habitat: { light: 0.3, moisture: 0.65, resource: 0.7, ridge: -0.8, crowding: 0.2, waterDist: 140 }, note: 'Shaded and damp: narrower, taller, reaching up toward the light.', rule: 'Shade and shelter push growth up toward the light (more of it vertical), damp wears the tissue more, and shoots are longer.' },
  { id: 'shore', label: 'Damp shore', habitat: { light: 0.65, moisture: 0.85, resource: 0.85, ridge: -0.2, crowding: 0, waterDist: 35 }, note: 'Rich and wet: anchored at the water, roots toward it.', rule: 'Water close by sends toes toward it and broadens the base; damp wears the tissue open.' },
  { id: 'crowded', label: 'Crowded', habitat: { light: 0.35, moisture: 0.5, resource: 0.5, ridge: 0.2, crowding: 0.9, waterDist: 110 }, note: 'Shaded by neighbours: low, dense and lopsided.', rule: 'Neighbours turn shoots away from them and shorten what reaches their way, so the form leans to the free side.' },
]

export type Family = {
  id: FamilyId
  label: string
  /** One line: what makes this morphology distinct. */
  summary: string
  /** How it grows, in plain words. */
  growth: string
  /** What age means for this family, and its range. */
  age: { label: string; min: number; max: number; step: number; initial: number; unit: string; stages: [number, string][] }
  /** The habitat inputs this family's generator reads. */
  habitat: HabitatKey[]
  /** Where it stands in the design record. */
  status: string
}

const ALL_HABITAT: HabitatKey[] = ['light', 'moisture', 'resource', 'ridge', 'crowding', 'waterDist', 'size']

export const FAMILIES: Family[] = [
  {
    id: 'overhang',
    label: 'Overhang',
    summary: 'A stout keep, cantilevered shelves that reach where the light and the ground allow, supports where the load is, and sheltered space beneath.',
    growth: 'The world’s own Overhang: a keep of masses on a plinth, a great shelf that cantilevers toward the light and rests on an outlier body (or hangs free), piers and fins beneath, a shaded undercroft. Refined: the same, with the seed choosing how tall and wide each mass is, where the middle and mouth-side masses stand, whether a second tower stands behind, how long, thick and which way the cantilever reaches, and how many piers brace it. The primary tower stays nearly upright; no habitat removes the tower or the cantilever.',
    age: {
      label: 'Lifecycle',
      min: 0,
      max: 1,
      step: 0.01,
      initial: 0.54,
      unit: 'life',
      stages: [
        [0.08, 'Establishment: a small anchored organism'],
        [0.22, 'Juvenile: early vertical growth'],
        [0.5, 'Growing: the tower rises, the cantilever extends, the supports develop'],
        [0.58, 'Maturity: the full form'],
        [0.74, 'Senescence: the living surface deteriorates, the skeleton shows'],
        [0.88, 'Death: living tissue gone; weathering and the first failures'],
        [1.01, 'Remains: mineral ruins, collapsed fragments, mineral on the ground'],
      ],
    },
    habitat: ALL_HABITAT,
    status: 'Refined in the lab (not in the world). The original generator is unchanged and selectable.',
  },
  {
    id: 'porous',
    label: 'Porous Growth',
    summary: 'A vertical cluster: two to four tall, thick towers grown together on one base, joined by arched bridges and a flying buttress, with large caves, windows and portals cut under their tiered lips.',
    growth: 'Each tower rises in tiers (a broad lip, then a narrower waist) and twists a little; the feet merge in a shared plinth. Under every lip is a room: a cave on one face, or a wide portal; windows go through the walls between. The place sets how vertical it is (shade, shelter and crowding make it taller and more twisted; open ground shorter, wider-spaced, more bridged), which way it faces, and where the toes and the buttress root. Openings keep enlarging past maturity.',
    age: {
      label: 'Growth',
      min: 0.05,
      max: 1.3,
      step: 0.01,
      initial: 1,
      unit: 'age',
      stages: [
        [0.3, 'Young: a body and short shoots, still closed'],
        [0.55, 'Shoots lengthen together; the first arches droop toward the ground'],
        [0.8, 'Tips fuse into loops and roots set'],
        [1.01, 'Mature: the tissue has begun to wear open'],
        [1.3, 'Late: the openings widen'],
      ],
    },
    habitat: ALL_HABITAT,
    status: 'Redesigned in the lab (design first). Not in the world.',
  },
  {
    id: 'strata',
    label: 'Strata',
    summary: 'A leaning mass and one long blade reaching toward the light, carried by a leg that arches out of the mass and sweeps up into the blade, over a great void layered by lobed shelves.',
    growth: 'Designed first (Blade / Strata Refined, from the Habitat Study), then made procedural: the seed draws its reach, rise, height, where the leg meets the blade, how many shelves, the blade’s curve and its crease, and every joint is derived from the parts it joins, so supports and shelves stay attached. Mature form only: growth and decay stages, and adaptation to the habitat, come later.',
    age: { label: 'Form', min: 1, max: 1, step: 0.01, initial: 1, unit: 'age', stages: [[1.01, 'Mature form (growth and decay are not modelled yet)']] },
    habitat: ['size'],
    status: 'New in the lab (design first). Not in the world. Reads only Size from the habitat for now.',
  },
]

/** What is kept in the code but not offered here, and why. `?architecture=` still opens the world's own variants on the project page. */
export const EXCLUDED: { variants: string; why: string }[] = [
  { variants: 'Spreading, Ascending, Hybrid, the shoot-growth engine, and the first design-first arches (porousGrowth.ts, ascendingGrowth.ts, hybridGrowth.ts, organismGrowth.ts, porousArches.ts)', why: 'Their forms read as mushrooms, limbs, platters, worms and bones. Replaced by one vertical cluster (porousDesign.ts) for Porous Growth, and by the world’s own generator, refined, for Overhang.' },
  { variants: 'fronts, skeleton, strata', why: 'Retired from the lab earlier. Their generators and the project page’s variants are unchanged.' },
  { variants: 'overhang, overhang2', why: 'Predecessors of Overhang 3 (the world’s own form).' },
  { variants: 'reveal, growth (loft), voxel, grown*, network, field, composed', why: 'Rejected or superseded representations and experiments; kept for the record.' },
]
