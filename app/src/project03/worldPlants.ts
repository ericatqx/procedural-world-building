import { BufferAttribute, BufferGeometry } from 'three'
import { CANDIDATES } from '../vegetation-lab/catalog.ts'
import { Geo, hex, rng, type LodLevel } from '../vegetation-lab/geo.ts'
import type { PlantParams } from '../vegetation-lab/types.ts'
import { smoothstep } from '../project02/core.ts'
import { landscapeHeight } from './terrain.ts'
import { suns } from './vegFields.ts'
import { patch, zonesOf, type Archetype, type Conditions, type Zones } from './vegPlants.ts'

/**
 * Shadow Ecology 0.3 — the island's plants from the Vegetation Lab: which species grows where, and how each is drawn at three
 * distances. Placement is a preference, not a zone: each species has a suitability from the habitat zones (vegPlants.ts) and the
 * conditions at a point, a community patch field makes clumps and gaps, a larger "stand" field makes groves, edges and open
 * meadow, and a seeded site grid anchored to world coordinates decides the rest, so the same place always has the same plants.
 *
 *   open slopes         weeping veil tree, leafy shrub       shade (groves, structures, shaded slopes)   shade parasol, fern, mat ground cover
 *   lake margins        reed, sedge; flood tree on the bank  Living Architecture vine and hanging curtain (WorldPlants.tsx)
 * DRAWING. One site is one plant at every distance: the same position, height, canopy footprint and tint, never thinned by distance.
 * It is a Lab-grown variant (young, two mature, exposed/stressed), instanced, at one of three levels of detail (Full, Reduced,
 * Distant) that the same generator emits from the same seed (vegetation-lab/geo.ts), so a plant is the same individual at every
 * distance: WorldPlants.tsx picks the level from the camera's distance to it.
 */
export type SpeciesId = 'veil' | 'coppice' | 'tabular' | 'canes' | 'fern' | 'ground' | 'reed' | 'sedge' | 'broadleaf' | 'flood' | 'stilts' | 'grass' | 'vine' | 'curtain' | 'ribbons'

export type Species = {
  id: SpeciesId
  /** The Lab candidate it is drawn from. */
  cand: string
  /** Which community patch field it follows (trees, shrubs, ground cover). */
  group: Archetype
  tint: string
  /** Metres between candidate sites: the same at every distance, so a plant has one position. */
  spacing: number
  density: number
  life: { tau: number; life: number; gap: number }
  /** Drawn at every distance. Not drawn beyond the near range only for mats a few centimetres tall (the ground materials show them). */
  far: boolean
  /** Where it stands in the larger stand field: groves, edges, open ground, or anywhere. */
  stand: 'wood' | 'edge' | 'open' | 'any'
  /** `land`: dry ground, clear of the water's edge. `shallow`: may stand in shallow water. `submerged`: on the bed of the lit shallows, under the surface. */
  water: 'land' | 'shallow' | 'submerged'
  /** Metres from the camera at which it changes from Full to Reduced, and from Reduced to Distant (a mat, 0 beyond the second, is not drawn). */
  lod: [number, number]
  /** Most Lab-geometry plants of the species at once; any beyond are drawn as silhouettes, never dropped. */
  cap: number
  /** The conditions the bank is grown in. */
  env: Partial<PlantParams>
  rule: (c: Conditions, z: Zones) => number
}

/**
 * How shaded a point is for the plants, 0 to 1: a structure's shade or roof, or the terrain's own long-term shade (low day-averaged light: a north
 * face, a deep valley under its horizon). The terrain's shade was not counted before, so away from structures the shade plants followed moisture
 * alone; now a shaded slope is the shade plants' home too. Light below 0.3 is fully shaded ground, above 0.55 none.
 */
export function shadedAt(c: Conditions): number {
  const terrain = 1 - smoothstep(0.3, 0.55, c.light)
  return Math.max(smoothstep(0.2, 0.65, Math.max(c.shade, c.shelter)), terrain)
}
/** In shade, the shade plants are at home whatever the community, and the sun-seekers thin out. Shared by the placement and the Lab's island map. */
export function shadeAdjust(id: SpeciesId, fit: number, shaded: number): number {
  if (shaded <= 0) return fit
  const home = SHADE_HOME[id] ?? 0
  if (home > 0) return fit + (Math.max(fit, home) - fit) * shaded
  if (SUN_SEEKING.has(id)) return fit * (1 - 0.8 * smoothstep(0.3, 1, shaded))
  return fit
}

/** The light the shade-grown and sun-grown variants are grown at, and the local light (effective: terrain and structure shade) that divides them. */
const SHADE_GROWN = 0.22
const PART_GROWN = 0.5
const SUN_GROWN = 0.88
/**
 * Integration (round 12): THREE light forms, not two. With two, every plant below 55% light took the form grown at 22%, the Lab's deep-shade
 * response (sparse, etiolated), so moderate shade looked severely stressed. Now: below DEEP_SPLIT the deep-shade form, up to SUN_SPLIT the
 * partial-shade form (grown at 50%), above it the sun form. The forms are the Lab's own generator at those lights; nothing is decorative.
 */
const DEEP_SPLIT = 0.36
const SUN_SPLIT = 0.66
/** Unit (x, z) toward the day's mean sun: a shade-grown plant's crown leans this way (the Lab's lit side, +z, is turned to face it). */
let sunward: [number, number] | null = null
const sunYaw = () => {
  sunward ??= suns().mean
  return Math.atan2(sunward[0], sunward[1])
}

const bell = (x: number, mid: number, w: number) => Math.exp(-(((x - mid) / w) ** 2))
const free = (c: Conditions) => (c.footprint > 0.3 ? 0 : 1)

export const SPECIES: Species[] = [
  {
    id: 'veil', cand: 'spar', group: 'tall', tint: '#4a6449', spacing: 9, density: 1, life: { tau: 35, life: 150, gap: 20 }, far: true, stand: 'wood', water: 'land', lod: [65, 200], cap: 900, env: { light: 0.8, moisture: 0.5, wind: 0.2 },
    rule: (c, z) => free(c) * bell(c.moisture, 0.42, 0.42) * smoothstep(0.4, 0.8, c.light) * (1 - z.shaded) * (1 - z.rock) * (1 - z.shore * 0.8) * (1 - 0.8 * z.alpine) * (1 - smoothstep(0.36, 0.6, c.slope)),
  },
  {
    id: 'coppice', cand: 'coppice', group: 'shrub', tint: '#56633f', spacing: 4.4, density: 1, life: { tau: 14, life: 90, gap: 10 }, far: true, stand: 'edge', water: 'land', lod: [45, 140], cap: 1600, env: { light: 0.7, moisture: 0.5, wind: 0.3 },
    rule: (c, z) => free(c) * Math.max(0.3, z.dry * 0.8, z.moist * 0.4) * smoothstep(0.25, 0.6, c.light) * (1 - 0.6 * z.shaded) * (1 - z.rock) ** 2 * (1 - 0.7 * z.alpine) * (1 - z.shore * 0.7),
  },
  {
    // The shade parasol (vegetation-lab/candShade.ts), the island's shade specialist. Its id stays 'tabular' because other views key on it.
    id: 'tabular', cand: 'parasol', group: 'shrub', tint: '#3d5a58', spacing: 5, density: 0.85, life: { tau: 14, life: 90, gap: 10 }, far: true, stand: 'wood', water: 'land', lod: [45, 130], cap: 700, env: { light: 0.2, moisture: 0.7, wind: 0.1 },
    rule: (c, z) => free(c) * Math.max(z.shaded, z.moist * 0.85) * smoothstep(0.35 - 0.15 * z.shaded, 0.7 - 0.15 * z.shaded, c.moisture) * (1 - 0.4 * smoothstep(0.75, 1, c.light)) * (1 - z.rock) * (1 - z.alpine) * (1 - z.dry * (1 - z.shaded)),
  },
  {
    id: 'fern', cand: 'rosette', group: 'cover', tint: '#3a6644', spacing: 2.2, density: 0.9, life: { tau: 4, life: 40, gap: 4 }, far: true, stand: 'wood', water: 'land', lod: [22, 80], cap: 900, env: { light: 0.3, moisture: 0.75, wind: 0.1 },
    // In a structure's shade the fern needs less of the ground's own moisture (the shade keeps what there is): its understory forms even on a dry ridge.
    rule: (c, z) => free(c) * Math.max(z.shaded * 0.9, z.moist * 0.7) * smoothstep(0.45 - 0.22 * z.shaded, 0.75 - 0.22 * z.shaded, c.moisture) * (1 - z.dry * (1 - z.shaded)) * (1 - z.rock),
  },
  {
    id: 'ground', cand: 'stolons', group: 'cover', tint: '#47694a', spacing: 2, density: 0.95, life: { tau: 4, life: 40, gap: 4 }, far: false, stand: 'any', water: 'land', lod: [28, 70], cap: 900, env: { light: 0.5, moisture: 0.65, wind: 0.1 },
    rule: (c, z) => free(c) * Math.max(z.moist, z.shore * 0.8, z.shaded * 0.8) * smoothstep(0.3 - 0.12 * z.shaded, 0.6 - 0.12 * z.shaded, c.moisture) * (1 - z.rock) * (1 - 0.5 * z.alpine),
  },
  {
    // Grass-like tussocks on open, damp ground and around the wetland margin: meadow rather than woodland floor.
    id: 'sedge', cand: 'sedge', group: 'cover', tint: '#6b7a58', spacing: 2.1, density: 0.9, life: { tau: 4, life: 40, gap: 4 }, far: true, stand: 'open', water: 'shallow', lod: [22, 80], cap: 900, env: { light: 0.85, moisture: 0.6, wind: 0.3, depth: 0.1 },
    rule: (c, z) => free(c) * Math.max(0.42 * (1 - z.rock), z.moist * 0.7, z.shore * 0.9) * smoothstep(0.2, 0.5, c.moisture) * smoothstep(0.45, 0.8, c.light) * (1 - z.rock) * (1 - z.alpine) * (1 - smoothstep(0.7, 0.9, c.waterDepth)) * (1 - 0.7 * z.dry),
  },
  {
    id: 'reed', cand: 'reed', group: 'cover', tint: '#7a8160', spacing: 3, density: 0.7, life: { tau: 6, life: 60, gap: 6 }, far: true, stand: 'any', water: 'shallow', lod: [35, 120], cap: 700, env: { light: 0.85, moisture: 0.75, wind: 0.35, depth: 0.25 },
    rule: (c) => free(c) * Math.exp(-Math.max(0, c.waterDist - 1) / 3.5) * (1 - smoothstep(0.55, 0.85, c.waterDepth)) * (1 - smoothstep(0.25, 0.5, c.slope)),
  },
  {
    // Wet banks and seasonally saturated ground only: never in open water or a channel.
    id: 'flood', cand: 'buttress', group: 'tall', tint: '#4a6650', spacing: 9, density: 0.95, life: { tau: 35, life: 150, gap: 20 }, far: true, stand: 'any', water: 'land', lod: [65, 200], cap: 500, env: { light: 0.7, moisture: 0.8, wind: 0.2, depth: 0.15 },
    rule: (c) => free(c) * (0.25 + 0.75 * Math.exp(-Math.max(0, c.waterDist - 3) / 14)) * smoothstep(0.5, 0.78, c.moisture) * (1 - smoothstep(0.2, 0.4, c.slope)) * (1 - smoothstep(35, 90, c.waterDist)),
  },
  {
    // Arching canes along the edges of woods and wet ground: the understory between trees and the ground cover.
    id: 'canes', cand: 'canes', group: 'shrub', tint: '#5b6842', spacing: 5, density: 0.85, life: { tau: 14, life: 90, gap: 10 }, far: true, stand: 'edge', water: 'land', lod: [45, 130], cap: 900, env: { light: 0.6, moisture: 0.55, wind: 0.2 },
    rule: (c, z) => free(c) * Math.max(0.22, z.moist * 0.8, z.shore * 0.5, z.shaded * 0.5) * smoothstep(0.2, 0.5, c.moisture) * smoothstep(0.2, 0.55, c.light) * (1 - z.rock) * (1 - 0.7 * z.alpine),
  },
  {
    // Broadleaf marginals on the wet edge, a step back from the reeds.
    id: 'broadleaf', cand: 'broadleaf', group: 'cover', tint: '#4f7a4b', spacing: 3.2, density: 0.7, life: { tau: 6, life: 60, gap: 6 }, far: true, stand: 'any', water: 'shallow', lod: [35, 110], cap: 500, env: { light: 0.7, moisture: 0.8, wind: 0.2, depth: 0.2 },
    rule: (c) => free(c) * Math.exp(-Math.max(0, c.waterDist - 2) / 7) * smoothstep(0.35, 0.6, c.moisture) * (1 - smoothstep(0.3, 0.5, c.waterDepth)) * (1 - smoothstep(0.3, 0.5, c.slope)),
  },
  {
    // Short, fine meadow grass in clumps: the near-field grass of the meadow community. Its geometry is built here (grassGeometry), a clump of thin tapering
    // blades, because the Lab has no grass. It stands only close to the walker (the level-of-detail distances), in patches with bare ground between, so from
    // a distance the meadow is the ground's own colour (vegGround.ts) and close up it has blades; it is placed on the same world-anchored grid as every plant, so
    // nothing is rebuilt as the camera moves.
    id: 'grass', cand: 'grass', group: 'cover', tint: '#6c7b56', spacing: 1.15, density: 0.7, life: { tau: 3, life: 30, gap: 3 }, far: false, stand: 'open', water: 'land', lod: [16, 42], cap: 3000, env: { light: 0.8, moisture: 0.5, wind: 0.3 },
    // (Integration round 13: a sun grass (grown at 0.8) needs light. From 0.3 up it carpeted partial shade too (60% of what grew there), so a
    // half-shaded community looked like a sunny meadow; now it thins through partial shade and the shade-tolerant mats and ferns take that ground.)
    rule: (c, z) => free(c) * smoothstep(0.18, 0.42, c.moisture) * smoothstep(0.45, 0.8, c.light) * (1 - z.rock) ** 2 * (1 - 0.85 * z.alpine) * (1 - 0.6 * z.dry) * (1 - smoothstep(0.3, 0.55, c.slope)) * (1 - z.shore * 0.5),
  },
  {
    // The ribbon meadow (the Lab's submerged candidate): anchored on the bed of the lit shallows, a metre or more under the surface, where the light
    // that reaches the bed (falling with depth) still feeds it. Seen through the transparent water, close up only.
    id: 'ribbons', cand: 'meadow', group: 'cover', tint: '#4f6e52', spacing: 2.4, density: 0.85, life: { tau: 3, life: 25, gap: 3 }, far: false, stand: 'any', water: 'submerged', lod: [40, 90], cap: 900, env: { light: 0.9, moisture: 0.6, wind: 0.3, depth: 0.9 },
    rule: (c) => smoothstep(0.95, 1.2, c.waterDepth) * (1 - smoothstep(2.2, 2.8, c.waterDepth)) * smoothstep(0.45, 0.75, c.light) * (1 - smoothstep(0.3, 0.6, c.slope)),
  },
  { id: 'vine', cand: 'vine', group: 'cover', tint: '#40623f', spacing: 0, density: 1, life: { tau: 4, life: 40, gap: 4 }, far: false, stand: 'any', water: 'land', lod: [0, 0], cap: 80, env: { light: 0.6, moisture: 0.6, wind: 0.2, surface: 'architecture', bare: true }, rule: () => 0 },
  { id: 'curtain', cand: 'curtain', group: 'cover', tint: '#6f8567', spacing: 0, density: 1, life: { tau: 4, life: 40, gap: 4 }, far: false, stand: 'any', water: 'land', lod: [0, 0], cap: 80, env: { light: 0.4, moisture: 0.7, wind: 0.2, surface: 'architecture', bare: true }, rule: () => 0 },
]

/**
 * The variants grown for each species: young, two mature, and one exposed or stressed. The two mature variants are LIGHT-CONDITIONED: one grown in
 * shade, one in sun, at the light given here rather than the species' own, so the Lab's sun and shade forms (vegetation-lab/ecology.ts, leafForm and
 * the shade responses) stand where the island's stable, day-averaged light puts them. Still four banks per species: no more geometry, no more draw calls.
 */
export const VARIANTS: { age: number; seed: number; stress: boolean; light?: number }[] = [
  { age: 0.25, seed: 1, stress: false },
  { age: 0.85, seed: 2, stress: false, light: SHADE_GROWN },
  { age: 0.85, seed: 3, stress: false, light: SUN_GROWN },
  { age: 0.85, seed: 4, stress: true },
  // Old: the generator's own senescence (thinned, spent veils; frayed dishes; spent outer fronds), for the last part of a plant's life.
  { age: 0.99, seed: 5, stress: false },
  // Partial shade (round 12): grown at half light, between the deep-shade and sun forms. (Appended, so the other indices keep their meaning.)
  { age: 0.85, seed: 6, stress: false, light: PART_GROWN },
]
/** The partial-shade mature form's index. */
export const PART_VARIANT = 5
/** The variant drawn for a plant in the last part of its life. */
export const OLD_VARIANT = 4
/** A plant is drawn old from this share of its own lifespan. */
const OLD_FROM = 0.85

/** A species' seed offset is its own, not its place in the list, so adding or removing a species never moves the others' plants. */
const SEED_INDEX: Partial<Record<SpeciesId, number>> = { veil: 0, coppice: 1, tabular: 2, fern: 3, ground: 4, sedge: 5, reed: 6, flood: 7, canes: 9, broadleaf: 10, stilts: 11, grass: 12, ribbons: 13 }

/**
 * SCALE. The Lab grows each candidate at its own size; the World sets a size for each species against a 1.75 m walker. Measured mature heights of the
 * Lab plants (before this factor and the per-plant variation of about 0.45 to 1.2): veil tree 6.6 m, buttress tree 8.4, stilt-root tree 6.3, tabular shrub 2.5,
 * canes 2.8, coppice 1.3, reed 2.2, broadleaf 1.6, fern 0.7, sedge 0.95 (and 2.5 m wide), stolon mat 0.07 (and 2.5 m wide). Trees are brought up to
 * tree size, the grass-like plants down to tussock and patch size.
 */
// (Round 16: the shade understory, fern, ground mat and shade parasol, a little larger, so a shade community reads from a middle distance.)
const SIZE: Partial<Record<SpeciesId, number>> = { veil: 1.7, flood: 1.6, stilts: 1.55, coppice: 1.1, tabular: 1.12, canes: 0.85, fern: 1.1, ground: 0.6, sedge: 0.4, reed: 0.95, broadleaf: 0.9, grass: 1, ribbons: 1 }

/** How tall each species grows (metres at full size): what must fit under a structure's roof. */
const HEIGHT = new Map(SPECIES.map((sp) => [sp.id, (CANDIDATES.find((c) => c.id === sp.cand)?.size ?? 0.4) * (SIZE[sp.id] ?? 1)] as const))

/** What Explore's plant card says of a species, from the Vegetation Lab's own catalogue: its name, its light strategy, its layer and height. */
export function speciesInfo(id: SpeciesId): { name: string; light: string; group: string; height: number; grownAt: number; form: string } {
  const sp = SPECIES.find((s) => s.id === id)!
  const cand = CANDIDATES.find((c) => c.id === sp.cand) as { name?: string; light?: string; strategy?: string } | undefined
  // Its form, as the Lab's catalogue describes the generator: its first sentence.
  const form = (cand?.strategy ?? '').split(/(?<=\.)\s/)[0] ?? ''
  return { name: cand?.name ?? id, light: cand?.light ?? 'broad', group: sp.group, height: HEIGHT.get(id) ?? 0.4, grownAt: sp.env.light ?? 0.7, form }
}

/**
 * COMMUNITIES. Where each kind of plant community stands is decided from the habitat and a few large fields, and each species is given a share in
 * each community: a dominant species where its community is, companions in smaller numbers, and a trace elsewhere (so edges blend and a plant
 * now and then stands outside its community, but not every species is everywhere).
 *   grove      woodland: the stand field, on ground that is not dry or bare rock      veil tree, with tabular shrub, canes and ferns beneath it
 *   scrub      open ground in swells of about 80 m                                    coppice, a few trees
 *   meadow     what is left: open, not wet                                            sedge tussocks and ground mats, a little coppice
 *   riparian   banks and the ground near water                                        buttress and stilt-root trees, canes, ferns, broadleaf
 *   wetland    the shore, where it is damp                                            reeds, sedge, broadleaf
 */
type Community = 'grove' | 'scrub' | 'meadow' | 'riparian' | 'wetland'
const ROLE: Partial<Record<SpeciesId, Partial<Record<Community, number>>>> = {
  veil: { grove: 1, scrub: 0.15, meadow: 0.05, riparian: 0.2 },
  flood: { riparian: 1, wetland: 0.25, grove: 0.08 },
  stilts: { riparian: 0.8, wetland: 0.55 },
  coppice: { scrub: 1, grove: 0.3, meadow: 0.22, riparian: 0.25 },
  tabular: { grove: 0.85, riparian: 0.3, scrub: 0.1 },
  canes: { riparian: 0.7, grove: 0.4, scrub: 0.2 },
  fern: { grove: 0.8, riparian: 0.5, scrub: 0.1 },
  ground: { meadow: 0.55, grove: 0.5, riparian: 0.3, scrub: 0.3 },
  sedge: { meadow: 1, wetland: 0.9, riparian: 0.45, scrub: 0.2, grove: 0.04 },
  reed: { wetland: 1, riparian: 0.3 },
  broadleaf: { wetland: 0.8, riparian: 0.6 },
  grass: { meadow: 1, scrub: 0.45, riparian: 0.2, wetland: 0.12, grove: 0.06 },
}

/** How at home each shade plant is in a structure's long-term shade (a share like ROLE's): the fern understory and moss mats first, the tabular shrub and canes at its edge. */
export const SHADE_HOME: Partial<Record<SpeciesId, number>> = { tabular: 1, fern: 1, ground: 0.85, canes: 0.35 }
/**
 * SHADE SPECIALISTS keep to shade: the parasol and the fern grow only where the light that reaches the ground is low. That light is the
 * day-averaged light (less a structure's shade, already in `c.light`), less a GROVE'S OWN CANOPY (the veil trees shade their floor, which the
 * fields do not know), or under a roof. Before, they followed moisture and appeared on open, sunny, damp ground. Shared with the Lab's map.
 */
export const SHADE_SPECIALIST = new Set<SpeciesId>(['tabular', 'fern'])
export function floorLight(c: Conditions, grove: number) {
  return c.light * (1 - 0.55 * grove)
}
export function specialistGate(id: SpeciesId, c: Conditions, grove: number) {
  if (!SHADE_SPECIALIST.has(id)) return 1
  return Math.max(1 - smoothstep(0.4, 0.62, floorLight(c, grove)), smoothstep(0.3, 0.7, c.shelter))
}

/** The grove's trees, its understory shrub and the scrub's coppice, whose rules decide where woodland floor lies (groundWeights). */
const GROVE_TREES = (['veil', 'flood', 'tabular', 'coppice'] as const).map((id) => SPECIES.find((sp) => sp.id === id)!)

/** Under a roof lower than this (metres above the ground) the air is shaded and sheltered: only the shade-tolerant low plants grow there. */
const ROOFED = 20
const SHADE_OK = new Set<SpeciesId>(['fern', 'ground', 'tabular'])

/** The share of each community at a point, summing to 1, sharpened so one dominates and the others blend in at its edges. */
export function communityAt(c: Conditions, z: Zones, st: number, seed: number, x: number, zz: number): Record<Community, number> {
  const r = Math.exp(-Math.max(0, c.waterDist - 3) / 25)
  const w = z.shore * smoothstep(0.5, 0.8, c.moisture)
  const g = smoothstep(0.28, 0.58, st) * (0.35 + 0.65 * smoothstep(0.25, 0.6, c.moisture)) * (1 - 0.8 * z.rock) * (1 - 0.6 * r)
  const s = smoothstep(0.45, 0.7, vnoise(x / 80, zz / 80, (seed % 9973) + 303)) * (1 - 0.8 * g) * (1 - 0.5 * z.rock)
  const m = Math.max(0.15, 1 - Math.max(g, s)) * (1 - 0.5 * r)
  const e = (v: number) => v ** 2.2
  const a = [e(g), e(s), e(m), e(r), e(w)]
  const sum = a[0]! + a[1]! + a[2]! + a[3]! + a[4]! || 1
  return { grove: a[0]! / sum, scrub: a[1]! / sum, meadow: a[2]! / sum, riparian: a[3]! / sum, wetland: a[4]! / sum }
}

const BASE: PlantParams = { seed: 1, age: 0.8, light: 0.7, moisture: 0.6, wind: 0.2, depth: 0, surface: 'rock' }

/**
 * A clump of fine grass: thin blades fanning from a point, each a tapering strip that leans outward and bends, dark at the root and paler toward the
 * tip, in sage and olive. Variants: young (short), two mature, and a drier, lower, paler one for exposed ground. Level 0 has more blades of more segments, level 1
 * fewer and wider (seen from farther off). A clump is about 0.4 m tall and 0.35 m across; the placement scales it, and the clumps stand apart with ground between.
 */
function grassGeometry(variant: number, level: LodLevel): BufferGeometry {
  const r = rng(variant * 313 + 17)
  const blades = level === 0 ? 15 : 6
  const segs = level === 0 ? 3 : 2
  const heightK = variant === 0 ? 0.6 : variant === 3 ? 0.8 : variant === 4 ? 0.85 : 1
  const dry = variant === 3 ? 0.4 : variant === 4 ? 0.3 : 0
  const base: [number, number, number] = [0.15, 0.19, 0.12]
  const tip: [number, number, number] = [0.5 + 0.1 * dry, 0.54, 0.36 - 0.1 * dry]
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  for (let b = 0; b < blades; b += 1) {
    const ang = r() * 6.283
    const ca = Math.cos(ang)
    const sa = Math.sin(ang)
    const rad = 0.02 + 0.12 * Math.sqrt(r())
    const h = (0.2 + 0.26 * r()) * heightK * (level === 0 ? 1 : 1.1)
    const lean = 0.25 + 0.45 * r()
    const w = (level === 0 ? 0.011 : 0.02) * (0.8 + 0.5 * r())
    const tone = 0.9 + 0.2 * r()
    const first = pos.length / 3
    for (let s = 0; s <= segs; s += 1) {
      const t = s / segs
      const out = rad + lean * h * t * t
      const width = w * (1 - t * 0.92)
      const y = h * t
      const k = Math.pow(t, 0.8)
      for (const side of [-1, 1]) {
        pos.push(ca * out - sa * width * side, y, sa * out + ca * width * side)
        col.push((base[0] + (tip[0] - base[0]) * k) * tone, (base[1] + (tip[1] - base[1]) * k) * tone, (base[2] + (tip[2] - base[2]) * k) * tone)
      }
    }
    for (let s = 0; s < segs; s += 1) {
      const a = first + s * 2
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  g.computeBoundingBox()
  return g
}

/** Grows one variant of a species with the Lab's own generator, at the conditions that variant stands for. */
export function growVariant(sp: Species, variant: number, level: LodLevel = 0): BufferGeometry {
  if (sp.cand === 'grass') return grassGeometry(variant, level)
  const v = VARIANTS[variant]!
  const cand = CANDIDATES.find((c) => c.id === sp.cand)!
  const p: PlantParams = { ...BASE, ...sp.env, seed: v.seed, age: v.age }
  if (v.light !== undefined) p.light = v.light
  // Exposed or stressed: drier, brighter, windier than the species likes.
  if (v.stress) Object.assign(p, { moisture: Math.max(0.15, (sp.env.moisture ?? 0.6) - 0.3), wind: 0.4, light: Math.min(1, (sp.env.light ?? 0.7) + 0.2) })
  // The same generator and seed at every level: only what is emitted differs (see Geo).
  const g = new Geo(level, cand.size)
  cand.build(g, p, rng(v.seed * 101 + sp.id.length * 17))
  return g.build()
}

// ----------------------------------------------------------------------------------------------------------- placement
export type TileInstances = Map<SpeciesId, Float32Array>
/** x, y, z, scale, yaw, variant, tint r, g, b. */
export const STRIDE = 9

const hash = (a: number, b: number, c: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
  return x - Math.floor(x)
}
const sm = (t: number) => t * t * (3 - 2 * t)
function vnoise(x: number, z: number, s: number) {
  const i = Math.floor(x)
  const j = Math.floor(z)
  const fx = sm(x - i)
  const fz = sm(z - j)
  return hash(i, j, s) * (1 - fx) * (1 - fz) + hash(i + 1, j, s) * fx * (1 - fz) + hash(i, j + 1, s) * (1 - fx) * fz + hash(i + 1, j + 1, s) * fx * fz
}
/** The stand field, 0 (open ground) to 1 (woodland), in swells a few hundred metres across. */
export function stand(seed: number, x: number, z: number) {
  const s = (seed % 9973) + 401
  return smoothstep(0.3, 0.7, 0.62 * vnoise(x / 260, z / 260, s) + 0.38 * vnoise(x / 90, z / 90, s + 5))
}
/** A stable 0-to-1 rank per site: it only moves where a plant changes its drawing (near to silhouette), never whether it exists. */
export const rankOf = (x: number, z: number) => hash(x * 0.131, z * 0.173, 5)

const rgbOf = (h: string): [number, number, number] => hex(h)

/**
 * THE WORLD'S FOLIAGE PALETTE. The Vegetation Lab gives each plant its form and its own vertex colouring; on the island every plant is re-tinted relative to
 * that (WorldPlants.tsx), from these, so the Lab is untouched and the island's plants share one related, muted range with the ground and the light:
 *   common     the sage-olive every species is drawn a fifth of the way toward
 *   straw      dry, exposed ground bleaches toward it
 *   deep       shade, roof and damp ground deepen toward it: cool, dark green-gray
 * Tonal hierarchy before hue: a tree's crown is the darkest mass, shrubs a step lighter, the low cover lightest, so groves, scrub and meadow separate by
 * value from far off; sun-seeking species are lighter and warmer, shade-seeking ones darker and cooler, so the edge of a structure's shade reads as a change
 * of community and of tone, not of saturation.
 */
export const WORLD_FOLIAGE = {
  common: rgbOf('#506449'),
  straw: rgbOf('#93885c'),
  deep: rgbOf('#22403a'),
  /** Value of each layer of the community, relative to its species' own tint. */
  layer: { tall: 0.86, shrub: 0.95, cover: 1.07 } as Record<Archetype, number>,
  sun: [1.12, 1.08, 0.9] as [number, number, number],
  shade: [0.8, 0.9, 0.98] as [number, number, number],
}

/** Sun-seeking plants are lighter and slightly warmer, yellower sage; shade-seeking ones darker and cooler green. */
export const SUN_SEEKING = new Set<SpeciesId>(['veil', 'coppice', 'sedge', 'reed', 'grass', 'broadleaf'])
const SHADE_SEEKING = new Set<SpeciesId>(['tabular', 'fern', 'canes', 'ground', 'flood', 'stilts'])

/** `under`: 0 to 1, how shaded the light this plant grew in was (its floor light under a canopy, or a structure's long shade): shade-grown plants are a step deeper and cooler, so a shaded community reads apart from a sunny one by tone as well as by form and species. */
export function tint(sp: Species, z: Zones, h: number, under = 0): [number, number, number] {
  const P = WORLD_FOLIAGE
  const own = rgbOf(sp.tint)
  const lean: [number, number, number] = SUN_SEEKING.has(sp.id) ? P.sun : SHADE_SEEKING.has(sp.id) ? P.shade : [1, 1, 1]
  const layer = P.layer[sp.group]
  const base = [0, 1, 2].map((i) => (own[i]! * 0.8 + P.common[i]! * 0.2) * lean[i]! * layer) as [number, number, number]
  const dry = 0.4 * z.dry
  // (Round 15: the light it grew in counts for more: a shade-grown community is a clear step deeper and cooler than a sunlit one.)
  const deep = Math.min(0.66, 0.46 * z.shaded + 0.12 * z.moist + 0.32 * under)
  // Natural variation is in value: one plant a little lighter or darker than the next.
  const jitter = 0.9 + 0.2 * h
  return [0, 1, 2].map((i) => (base[i]! * (1 - dry - deep) + P.straw[i]! * dry + P.deep[i]! * deep) * jitter) as [number, number, number]
}

/** The island species a Lab candidate is drawn as, if any. */
export const speciesOfCandidate = (cand: string): Species | undefined => SPECIES.find((sp) => sp.cand === cand)

/**
 * What the island does to a Lab plant's colour: the tint its species takes at a given light and moisture, on otherwise ordinary ground (not dry, not
 * alpine), for the middle individual of the natural variation. The Labs' World look multiplies by it as the island does (relColour, worldMaterials.ts),
 * so the Lab shows the plant in the colours it has on the island. Null for a candidate the island does not place.
 */
export function islandTint(cand: string, light: number, moisture: number): [number, number, number] | null {
  const sp = speciesOfCandidate(cand)
  if (!sp) return null
  const z = { dry: 0, moist: smoothstep(0.55, 0.85, moisture), shaded: 1 - smoothstep(0.25, 0.6, light) } as unknown as Zones
  return tint(sp, z, 0.5)
}

/** Metres of dry ground a tree or shrub keeps clear of the water's edge (checked against the exact water surface). */
const CLEAR = 4

/**
 * The plants of one tile. A plant's identity (site, species, age, size, colour) is decided here from the island's fields and the
 * world seed and year alone, on a site grid anchored to world coordinates, so it is the same whatever the tile size, the camera,
 * or the distance. `scope` 'island' is every species that is drawn at a distance, 'mat' the ground mats drawn only close up, 'all' both.
 * `at` gives the conditions, `water` the drawn water, `skip` drops sites.
 */
export type Water = { depth: (x: number, z: number) => number; edge: (x: number, z: number) => number }

/** The species whose habitat is the water's edge, which look for the lake exactly. */
const LAKE_EXACT = new Set<SpeciesId>(['reed', 'sedge', 'broadleaf', 'flood', 'stilts'])
const RINGS = [1.5, 3, 5, 8, 12, 17, 24]
/** Metres from a point to the nearest standing water (a lake), found by looking outward in eight directions; 99 when there is none within 24 m. */
function lakeDistance(water: Water, x: number, z: number): number {
  for (const r of RINGS) {
    for (let k = 0; k < 8; k += 1) {
      const a = k * 0.785398
      if (water.depth(x + Math.cos(a) * r, z + Math.sin(a) * r) > 0) return r
    }
  }
  return 99
}

/**
 * WHETHER A SITE CARRIES A PLANT: the island's placement rule for one species at one site, as a chance (plantsInTile draws against it with the
 * site's own hash). `suit` is the species' own rule (where it CAN grow: light, moisture, slope, water, zones); `chance` is that after the community
 * it belongs to, its patches and clumps, the clearings and the shade adjustments thin it (where it DOES grow). Shared with the Vegetation Lab's
 * island map, so the map shows the island's placement, not a copy of it.
 */
export function placementChance(sp: Species, c: Conditions, x: number, z: number, seed: number, sseed = seed + (SEED_INDEX[sp.id] ?? SPECIES.indexOf(sp)) * 977) {
  const zn = zonesOf(c)
  const s = sp.rule(c, zn)
  if (s <= 0.02) return { suit: s, chance: 0, zones: zn, s, clumpRaw: 0, fit: 0, community: 0 }
  const st = stand(seed, x, z)
  const standMul = sp.stand === 'wood' ? 0.14 + 0.86 * smoothstep(0.28, 0.55, st) : sp.stand === 'open' ? 0.15 + 0.85 * (1 - smoothstep(0.4, 0.7, st)) : sp.stand === 'edge' ? 0.3 + 0.7 * bell(st, 0.5, 0.32) : 1
  // Communities: the plants of one group share their patches (a grove, a thicket, a meadow), the understory gathers under the grove, each species has
  // its own swell within them, and inside a patch the plants come in clumps of a few with gaps between, not on an even grid.
  const tall = sp.group === 'tall'
  const grove = tall ? 0 : patch('tall', seed % 9973, x, z)
  const swell = 0.7 + 0.6 * vnoise(x / 28, z / 28, sseed % 9973)
  const clumpRaw = smoothstep(0.32, 0.68, vnoise(x / (tall ? 15 : sp.group === 'cover' ? 5 : 7), z / (tall ? 15 : sp.group === 'cover' ? 5 : 7), sseed % 9973 + 3))
  // Ground cover comes in patches with open ground between them (negative space), not as an even scatter of tufts; trees and shrubs in looser clumps.
  // (Round 15: trees gather harder into stands (a closer grid, sharper clumps), so a grove reads as a grove and the ground between stays open.)
  const clump = sp.group === 'cover' ? 0.03 + 2.3 * clumpRaw ** 1.6 : tall ? 0.12 + 2.0 * clumpRaw ** 1.5 : 0.3 + 1.5 * clumpRaw
  // Clearings: open ground a few dozen metres across where trees and shrubs give way (the wetland and the ground cover run through them).
  const clearing = sp.water === 'land' && sp.group !== 'cover' ? 1 - 0.85 * smoothstep(0.58, 0.74, vnoise(x / 95, z / 95, seed % 9973 + 91)) : 1
  const community = ((tall ? 0.1 : 0.32) + (tall ? 0.9 : 0.68) * patch(sp.group, seed % 9973, x, z)) * swell * (1 + 0.5 * grove) * clearing
  const comm = communityAt(c, zn, st, seed, x, z)
  const role = ROLE[sp.id]
  let fit = role ? comm.grove * (role.grove ?? 0) + comm.scrub * (role.scrub ?? 0) + comm.meadow * (role.meadow ?? 0) + comm.riparian * (role.riparian ?? 0) + comm.wetland * (role.wetland ?? 0) : 1
  // ARCHITECTURE'S SHADE MAKES ITS OWN COMMUNITY. Where a structure keeps the sun off the ground for much of the day, or roofs it, the shade plants are
  // at home whatever the surrounding community is (a fern understory and moss mats in a meadow's structure), and the sun-seekers thin out. Before, the
  // surrounding community's share (a fern's is nearly nothing in a meadow) outweighed the shade, so a structure's shadow changed little of what grew.
  const shaded = shadedAt(c)
  fit = shadeAdjust(sp.id, fit, shaded)
  const together = shaded > 0 && (SHADE_HOME[sp.id] ?? 0) > 0 ? Math.max(clump * community, 0.75 * shaded) : clump * community
  const gate = specialistGate(sp.id, c, comm.grove)
  return { suit: s, chance: Math.min(1, gate * sp.density * s ** 1.1 * together * standMul * (0.08 + 1.6 * fit)), zones: zn, s, clumpRaw, fit, community: comm.grove }
}

export function plantsInTile(scope: 'island' | 'mat' | 'all', x0: number, z0: number, size: number, seed: number, year: number, at: (x: number, z: number, y: number) => Conditions, water: Water, skip?: (x: number, z: number) => boolean): TileInstances {
  const out: TileInstances = new Map()
  SPECIES.forEach((sp, si) => {
    if (!sp.spacing || (scope === 'island' && !sp.far) || (scope === 'mat' && sp.far)) return
    const sp0 = sp.spacing
    const sseed = seed + (SEED_INDEX[sp.id] ?? si) * 977
    const buf: number[] = []
    // A site's cycle: the longest life a plant there can have (a tenth over the species' own), then the gap before the next comes up.
    const cycle = sp.life.life * 1.1 + sp.life.gap
    const i0 = Math.floor(x0 / sp0) - 1
    const i1 = Math.ceil((x0 + size) / sp0) + 1
    const j0 = Math.floor(z0 / sp0) - 1
    const j1 = Math.ceil((z0 + size) / sp0) + 1
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const q = [0, 1, 2, 3, 4, 5].map((d) => hash(i + sseed * 0.00137, j, d + 1))
        const x = (i + 0.1 + 0.8 * q[0]!) * sp0
        const z = (j + 0.1 + 0.8 * q[1]!) * sp0
        if (x < x0 || x >= x0 + size || z < z0 || z >= z0 + size) continue
        // LIFE. Each site's plant has its own lifespan (the species' life, varied by a tenth either way by the site's seed), and the sites
        // are out of step (q[5]), so at any year the island holds every age: seedlings, mature plants, old ones, and gaps where one has died and
        // the next has not yet come up. The year moves them through it: they grow, mature, age and die, and the site regenerates after the gap.
        const life = sp.life.life * (0.9 + 0.2 * hash(i + sseed * 0.00137, j, 9))
        const age = (year + q[5]! * cycle) % cycle
        if (age > life) continue
        if (skip && skip(x, z)) continue
        // Water: what is drawn decides (lake depth, river ribbon), not the coarse habitat fields.
        const depth = water.depth(x, z)
        const edge = water.edge(x, z)
        const inWater = depth > 0 || edge < 0
        if (sp.water === 'land') {
          if (inWater || edge < (sp.group === 'cover' ? 0.4 : CLEAR)) continue
        } else if (sp.water === 'submerged') {
          if (depth < 0.95 || depth > 2.8) continue
        } else if (depth > (sp.id === 'reed' ? 0.8 : 0.45) || edge < -0.3) continue
        const y = landscapeHeight(x, z)
        const c = at(x, z, y)
        c.waterDepth = depth > 0 ? depth : edge < 0 ? 0.15 : 0
        if (inWater) c.waterDist = 0
        else c.waterDist = Math.min(c.waterDist, Math.max(0, edge))
        if (sp.water === 'land' && sp.group !== 'cover') {
          // Trees and shrubs also keep clear of a lake's edge: dry ground all round.
          if (water.depth(x + CLEAR, z) > 0 || water.depth(x - CLEAR, z) > 0 || water.depth(x, z + CLEAR) > 0 || water.depth(x, z - CLEAR) > 0) continue
        }
        // Large plants do not stand in a structure's solid or under its roof: what is taller than the air there, or whose crown would reach it, is not placed. Low plants stay.
        if (c.ceiling !== undefined) {
          // Nothing grows under a low roof (a ledge, a den's mouth); under any roof of the structure (a shelf, an undercroft: out of the sun and the rain) only the
          // low, shade-tolerant plants do: ferns and the moist ground mats. Trees, shrubs, tussocks and the sun-lovers keep out.
          if (c.ceiling < 5) continue
          if (c.ceiling < ROOFED && !SHADE_OK.has(sp.id)) continue
          const h = HEIGHT.get(sp.id)! * 1.1
          if (c.ceiling < h + 0.4 || (h >= 3 && (c.crown ?? Infinity) < h * 0.8)) continue
        }
        // The island's distance-to-water field is on a 16 m grid and the rivers have their own exact one, but a lake's shore is known only by `depth` at a point:
        // so for the plants of the shore and the banks the distance to the lake is found by looking outward (rings of eight directions). Without it the reeds,
        // broadleaf and the tree of the bank found water only inside the 16 m cell of the lake itself: a few metres of shore, and barely any plants.
        if (!inWater && LAKE_EXACT.has(sp.id) && c.waterDist < 40) c.waterDist = Math.min(c.waterDist, lakeDistance(water, x, z))
        const pc = placementChance(sp, c, x, z, seed, sseed)
        if (pc.suit <= 0.02) continue
        if (q[2]! >= pc.chance) continue
        const { zones: zn, s, clumpRaw } = pc
        const tall = sp.group === 'tall'
        const gr = 1 - Math.exp(-age / sp.life.tau)
        const juvenile = age / life < 0.22 || gr < 0.35
        const exposed = (zn.alpine > 0.4 || zn.dry > 0.55) && c.shelter < 0.3
        // The mature form follows the light where the plant stands (day-averaged sun past the terrain, less a structure's shade): shade-grown or
        // sun-grown, with a dithered edge so the change across a shadow's boundary is a gradient of individuals, not a line.
        const aged = age > life * OLD_FROM
        // The light it grew in: for a shrub or ground plant under a grove, what the grove's canopy lets through to the floor (the same floor light the
        // shade specialists are placed by), so the understory of a wood takes its shade-grown form even where the open-sky light is high.
        const grewIn = sp.group === 'tall' ? c.light : floorLight(c, pc.community)
        const lit = grewIn + (q[3]! - 0.5) * 0.18
        const variant = juvenile ? 0 : aged ? OLD_VARIANT : exposed ? 3 : lit < DEEP_SPLIT ? 1 : lit < SUN_SPLIT ? PART_VARIANT : 2
        // Old age is drawn by the old variant's own form; size eases off only a little more at the very end.
        const old = 1 - 0.2 * smoothstep(life * 0.9, life, age)
        const vigor = 0.65 + 0.35 * Math.min(1, s * 1.6)
        // A size hierarchy among the trees: a few landmarks (about one in fourteen), most of medium canopy, and a good share of smaller, lower ones.
        const rank = hash(x * 0.37, z * 0.59, 17)
        const landmark = tall ? (rank > 0.93 ? 1.4 : rank < 0.32 ? 0.78 : 1) : 1
        const scale = (0.78 + 0.44 * q[4]!) * (0.88 + 0.24 * clumpRaw) * landmark * (variant === 0 ? 0.55 + 0.45 * gr : 1) * old * vigor
        const t = tint(sp, zn, q[3]!, 1 - smoothstep(0.25, 0.6, grewIn))
        // Rooted: the trunk's flare and a shrub's crown sit a little below the ground, so nothing stands on it like a prop.
        // A shade-grown plant's crown reaches toward the light (the Lab grows that lean toward +z): turn it to face the day's mean sun, within about
        // 30 degrees. That direction is reliable (it is the sun's own arc); the direction of a structure's shadow edge is not known, so it is not used.
        const yaw = variant === 1 ? sunYaw() + (q[1]! - 0.5) * 1.0 : variant === PART_VARIANT ? sunYaw() + (q[1]! - 0.5) * 2.4 : q[1]! * 6.283
        buf.push(x, y - (sp.group === 'tall' ? 0.3 : sp.group === 'shrub' ? 0.14 : 0.05), z, scale * (SIZE[sp.id] ?? 1), yaw, variant, t[0], t[1], t[2])
      }
    }
    out.set(sp.id, Float32Array.from(buf))
  })
  return out
}

/**
 * The ground under the plants, from the same fields that place them (zones, the stand field, the community patches): the share of
 * `floor` (forest floor: soil and leaf litter, under woodland and shrub stands), `moss` (shaded, damp ground and rock),
 * `meadow` (low vegetation on open, damp ground) and `gravel` (water margins, scree). What is left is exposed rock. These are
 * materials, not a map of habitat: the terrain shader (vegGround.ts) draws them as colour and breaks their edges with noise.
 */
export function groundWeights(c: Conditions, z: Zones, seed: number): [number, number, number, number] {
  // WHAT THE TERRAIN'S GROUND COLOURS ARE (vegGround.ts draws them from these four weights, and what is left is the bare rock colour of terrainMesh.ts):
  //   floor   brown       soil and leaf litter under woodland and shrub: the ground of the grove, the scrub and the wooded bank
  //   meadow  pale green  low grass on open ground: the meadow, and the open ground between scrub
  //   moss    dark green  shaded, damp ground: the wooded bank, the wetland and the shaded hollows
  //   gravel  pale tan    the shoreline and scree: the margin of the water and the loose ground of the steep slopes
  //   (gray)  rock        steep ground, the crests and the cliffs: no plants
  // They come from the same community fields the plants are placed by (communityAt), so the colour under a grove is the grove's, a meadow's is the
  // meadow's, and a green patch has the plants of its community standing on it (the sedge tussocks and ground mats are those of the meadow community).
  const st = stand(seed, c.x, c.z)
  const comm = communityAt(c, z, st, seed, c.x, c.z)
  const wetLand = c.waterDepth > 0.05 ? 0 : 1
  const open = (1 - z.rock) * (1 - 0.7 * z.alpine)
  // The forest floor lies where the trees and shrubs actually stand: the grove's share, thinned by the same clearings and tree patches that thin the trees (plantsInTile).
  const clearing = 1 - 0.85 * smoothstep(0.58, 0.74, vnoise(c.x / 95, c.z / 95, seed % 9973 + 91))
  const stood = 0.45 + 0.55 * patch('tall', seed % 9973, c.x, c.z)
  // THE GROUND FOLLOWS WHERE TREES CAN STAND, not the community field alone. The community shares are mostly large noise fields (the stand, the scrub
  // swells), so on their own they paint woodland floor where no tree could grow (too steep, too dry, too lit for the grove's trees). Here each share is
  // weighed by the trees' own rules (the same species rules that place them, read at this point): woodland floor where the grove's trees are suited, with
  // clearings left; where the community says grove but the ground does not suit trees, it is open ground (meadow) instead. The plants are unchanged.
  // (The stilt-root tree that was third in this list is gone: veil, flood, then the parasol at 0.7.)
  const woody = Math.max(GROVE_TREES[0]!.rule(c, z), GROVE_TREES[1]!.rule(c, z), 0.7 * GROVE_TREES[2]!.rule(c, z))
  const treeFit = smoothstep(0.02, 0.22, woody)
  // Scrub's floor (the litter under the coppice thickets) only where the coppice can stand.
  const shrubFit = smoothstep(0.05, 0.3, GROVE_TREES[3]!.rule(c, z))
  // Gentle ground carries meadow; steeper ground thins it toward the bare slope.
  const gentle = 1 - smoothstep(0.22, 0.5, c.slope)
  const damp = smoothstep(0.3, 0.6, c.moisture)
  const floorRaw = (comm.grove * 0.95 * stood * (0.5 + 0.5 * treeFit) + comm.scrub * 0.35 * (0.45 + 0.55 * shrubFit) + comm.riparian * 0.4 * (0.5 + 0.5 * treeFit)) * (0.3 + 0.7 * clearing) * (0.85 + 0.15 * damp)
  // A wider ramp than before (0.07 to 0.44), so the floor gives way to the open ground over a band rather than at a line.
  const floor = wetLand * smoothstep(0.07, 0.44, floorRaw) * open
  const openGrove = comm.grove * (1 - treeFit)
  const lit = smoothstep(0.3, 0.65, c.light)
  const meadow = wetLand * smoothstep(0.06, 0.42, comm.meadow * 0.95 + comm.scrub * (0.5 + 0.2 * (1 - shrubFit)) + comm.wetland * 0.25 + openGrove * 0.45) * open * (0.55 + 0.45 * gentle) * (0.75 + 0.25 * lit) * (1 - 0.35 * z.dry) * (1 - 0.5 * comm.grove * treeFit)
  // Moss: damp and shaded ground: the wooded bank, the wetland, and the dim, damp floor under suitable trees.
  const moss = wetLand * Math.min(1, z.shaded * 0.7 + comm.riparian * 0.5 + comm.wetland * 0.55 + 0.4 * comm.grove * treeFit * (1 - smoothstep(0.45, 0.8, c.light))) * smoothstep(0.35, 0.65, c.moisture) * (1 - smoothstep(0.7, 0.95, c.light)) * (0.5 + 0.5 * (1 - z.alpine)) * (1 - z.rock)
  // Gravel: the shoreline, the loose ground of steep slopes, and dry, exposed ground on the slope below the high ground.
  const gravel = wetLand * Math.max(smoothstep(16, 1.5, c.waterDist) * 0.9, z.rock * (1 - z.alpine) * 0.28, z.dry * smoothstep(0.25, 0.5, c.slope) * (1 - z.alpine) * 0.3)
  const w: [number, number, number, number] = [floor, moss, meadow, gravel]
  const sum = w[0] + w[1] + w[2] + w[3]
  if (sum > 1) for (let i = 0; i < 4; i += 1) w[i] = w[i]! / sum
  return w
}
