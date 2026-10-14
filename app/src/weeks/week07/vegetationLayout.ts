import { MIN_POOL, mulberry32, OVERSAMPLE, SpacingGrid, type Candidate } from '../week06/distribution.ts'
import { archAtGround, CELLS, exposureSuitability, shelterSuitability, SITE, type World } from './historyWorld.ts'
import { PLANT_FORMS, type PlantFormName } from './plantForms.ts'
import { cellOf, groundHeight, isWaterAt, STUDY_HALF, surfaceHeight } from './site.ts'
import { sampleCells, TRODDEN, type Placement } from './worldMeshes.ts'

/**
 * Week 07 Branching Histories — where the two vegetation strategies stand,
 * by Week 06 Distribution's Environment pipeline run over the simulated
 * world's own fields:
 *
 *   seeded candidates → valid ground? → weight = suitability × soft factors,
 *   scaled so the best ground is 1 → accept if u < weight, clear of spacing
 *   → until the count is reached
 *
 * The simulation decides how much of each strategy a world holds (its cover
 * field); this decides where plants stand, by the same suitability the
 * simulation grows them by (`exposureSuitability`, `shelterSuitability`):
 * exposure follows the sun, with moisture only a secondary preference, so
 * it stands across sunny plateaus, open ground and ridges; shelter follows
 * architecture shadow, terrain enclosure and moisture together. Slope thins
 * both gradually, and both avoid disturbed and trodden ground. Only water,
 * standing architecture and near-vertical ground are refused outright.
 *
 * The weight is sharpened at the edge of suitable ground, so stands thin out
 * and leave gaps rather than carpeting it. Every history uses the same
 * seeds, so the same candidate points are weighed in every world: where two
 * histories agree, plants stand in the same places; where water, shade or
 * wear changed, the fields move them.
 */

type Strategy = {
  /** The simulated cover this strategy's plants stand in. */
  cover: (w: World) => Float32Array
  seed: number
  /** Clumps per unit of total cover: how many stands a world's cover supports. */
  clumpsPerCover: number
  /** Minimum distance between two clump centres, world units. */
  spacing: number
  /** Slope (degrees) at which the weight has fallen by half; it keeps falling gradually beyond. */
  halfSlope: number
  /** The strategy's suitability at a point, from the simulated fields. */
  suit: (light: number, shelter: number, moisture: number, enclosure: number) => number
  /** Rubble this strategy cannot root on, as a share of the weight it loses on a full heap. */
  rubbleLoss: number
  clump: { companions: number; minScale: number; maxScale: number; minReach: number; maxReach: number }
  size: { base: number; vigour: number }
}

const STRATEGIES = {
  exposure: {
    cover: (w) => w.vegExposure,
    seed: 37,
    clumpsPerCover: 0.12,
    spacing: 0.16,
    halfSlope: 38,
    suit: (light, _shelter, moisture, enclosure) => exposureSuitability(light, moisture, enclosure),
    rubbleLoss: 0.8,
    clump: { companions: 2, minScale: 0.45, maxScale: 0.85, minReach: 0.025, maxReach: 0.06 },
    size: { base: 0.13, vigour: 0.15 },
  },
  shelter: {
    cover: (w) => w.vegShelter,
    seed: 53,
    clumpsPerCover: 0.28,
    spacing: 0.14,
    halfSlope: 26,
    suit: (_light, shelter, moisture, enclosure) => shelterSuitability(shelter, moisture, enclosure),
    rubbleLoss: 0.3,
    clump: { companions: 3, minScale: 0.5, maxScale: 0.85, minReach: 0.04, maxReach: 0.1 },
    size: { base: 0.12, vigour: 0.12 },
  },
} satisfies Record<string, Strategy>

/** Cover below which the simulation holds no stand of a strategy on a cell (flooded, crushed, trampled): presence, not weight. */
const COVER = { from: 0.03, full: 0.15 } as const
/** Ground steeper than this (degrees) is cliff: refused outright. */
const CLIFF = 60
/** Normalised weight below which ground is left empty, and above which it is fully suitable: the stands' edge. */
const EDGE = { from: 0.12, to: 0.6 } as const
/** Candidates stay inside this share of the block's half-width, clear of the cut edge (as Week 06). */
const RIM = 0.97
const SCALE_VARIATION = 0.35
const SLOPE_STEP = 0.04
/** Rubble depth that covers the ground, as the simulation's rubble cover reads it. */
const RUBBLE_HEAP = 0.9

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Ground slope in degrees, from central differences of the Week 06 height, as Week 06 Distribution reads it. */
function slopeAt(x: number, z: number) {
  const dx = (groundHeight(x + SLOPE_STEP, z) - groundHeight(x - SLOPE_STEP, z)) / (2 * SLOPE_STEP)
  const dz = (groundHeight(x, z + SLOPE_STEP) - groundHeight(x, z - SLOPE_STEP)) / (2 * SLOPE_STEP)
  return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI
}

/** Hard rule before any weight: dry, open ground on the block, not under standing architecture. */
function isValid(w: World, x: number, z: number) {
  const c = cellOf(x, z)
  return c >= 0 && SITE.land[c] === 1 && !w.water[c] && !archAtGround(w, c) && !isWaterAt(x, z)
}

/** How undisturbed the ground is: wear toward trodden bare and fresh impact both clear it. */
const undisturbed = (w: World, x: number, z: number) =>
  (1 - smooth(TRODDEN.from, TRODDEN.full, sampleCells(w.wear, x, z))) * (1 - clamp01(sampleCells(w.fresh, x, z)))

/** Slope thins a stand gradually: half the weight at `half`, a third at 1.4 × `half`, never a sharp edge. */
const slopeTolerance = (half: number, slope: number) => 1 / (1 + (slope / half) ** 2)

/** Raw suitability: the strategy's own, thinned by slope, disturbance and rubble, where the simulation holds a stand. */
function suitability(s: Strategy, w: World, x: number, z: number) {
  const present = smooth(COVER.from, COVER.full, sampleCells(s.cover(w), x, z))
  const slope = slopeAt(x, z)
  if (present <= 0 || slope >= CLIFF) {
    return 0
  }
  const suit = s.suit(
    sampleCells(w.light, x, z),
    sampleCells(w.shelter, x, z),
    sampleCells(w.moisture, x, z),
    sampleCells(SITE.enclosure, x, z),
  )
  return (
    present *
    suit *
    slopeTolerance(s.halfSlope, slope) *
    undisturbed(w, x, z) *
    (1 - s.rubbleLoss * clamp01(sampleCells(w.rubble, x, z) / RUBBLE_HEAP))
  )
}

export type PlantSet = { items: Placement[]; plant: Float32Array }

type Lists = Record<PlantFormName, { items: Placement[]; plant: number[] }>

/** One strategy's stands: Week 06's weighted draw with spacing, each accepted point a clump. */
function placeStrategy(name: keyof typeof STRATEGIES, w: World, add: (form: PlantFormName, x: number, z: number, scale: number, seed: number, vigour: number) => void) {
  const s: Strategy = STRATEGIES[name]
  const coverField = s.cover(w)
  let total = 0
  let covered = 0
  for (let c = 0; c < CELLS; c++) {
    total += coverField[c]!
    covered += coverField[c]! > COVER.from ? 1 : 0
  }
  const count = Math.round(total * s.clumpsPerCover)
  if (count === 0) {
    return
  }
  const reach = STUDY_HALF * RIM
  // Week 06 oversamples per point over the whole block; most of this block holds no cover, so the pool grows until the covered ground gets as many.
  const pool = Math.max(MIN_POOL, Math.round((count * OVERSAMPLE * CELLS) / covered))
  const draws = new Float32Array(pool)
  const random = mulberry32(s.seed * 7919)
  const candidates: Candidate[] = []
  let best = 0
  for (let k = 0; k < pool; k++) {
    const x = reach * (2 * random() - 1)
    const z = reach * (2 * random() - 1)
    draws[k] = random()
    const scale = 1 + SCALE_VARIATION * (2 * random() - 1)
    const turn = random() * 2 * Math.PI
    const variety = random()
    const weight = isValid(w, x, z) ? suitability(s, w, x, z) : 0
    best = Math.max(best, weight)
    candidates.push({ x, z, weight, status: 'unused', scale, turn, variety })
  }
  if (best <= 0) {
    return
  }
  const spacing = new SpacingGrid(s.spacing)
  let placed = 0
  for (let k = 0; k < pool && placed < count; k++) {
    const candidate = candidates[k]!
    const weight = smooth(EDGE.from, EDGE.to, candidate.weight / best)
    if (draws[k]! >= weight || !spacing.isClear(candidate.x, candidate.z)) {
      continue
    }
    spacing.add(candidate)
    placed++
    const { x, z, variety } = candidate
    const vigour = sampleCells(coverField, x, z)
    const size = (s.size.base + s.size.vigour * vigour) * candidate.scale
    add(name === 'exposure' ? (variety < 0.45 ? 'spire' : 'tier') : 'frond', x, z, size, variety, vigour)
    const companions = Math.round(s.clump.companions * weight * (0.5 + variety))
    for (let m = 0; m < companions; m++) {
      const g = (variety * 7.31 + m * 0.618) % 1
      const angle = candidate.turn + (m / companions) * 2 * Math.PI + g
      const r = s.clump.minReach + (s.clump.maxReach - s.clump.minReach) * ((g * 3.7) % 1)
      const cx = x + Math.cos(angle) * r
      const cz = z + Math.sin(angle) * r
      if (isValid(w, cx, cz) && undisturbed(w, cx, cz) > 0.5) {
        const relative = s.clump.minScale + (s.clump.maxScale - s.clump.minScale) * g
        add(name === 'exposure' ? (g < 0.6 ? 'spire' : 'tier') : 'frond', cx, cz, size * relative, g, vigour)
      }
    }
  }
}

/**
 * Both strategies as the Project's plant forms, each carrying (moisture,
 * light, vigour, seed) for the vegetation material. Shelter vegetation
 * spreads low and broad in clumps; exposure vegetation stands upright in
 * stands of mixed height, a tall branching plant among smaller ones.
 */
export function plantPlacements(w: World): Record<PlantFormName, PlantSet> {
  const lists = Object.fromEntries(Object.keys(PLANT_FORMS).map((name) => [name, { items: [], plant: [] }])) as unknown as Lists
  const add = (form: PlantFormName, x: number, z: number, scale: number, seed: number, vigour: number) => {
    lists[form].items.push({ p: [x, surfaceHeight(x, z) - 0.01, z], s: [scale, scale, scale], yaw: seed * 2 * Math.PI })
    lists[form].plant.push(sampleCells(w.moisture, x, z), sampleCells(w.light, x, z), vigour, seed)
  }
  placeStrategy('shelter', w, add)
  placeStrategy('exposure', w, add)
  return Object.fromEntries(
    Object.entries(lists).map(([name, { items, plant }]) => [name, { items, plant: new Float32Array(plant) }]),
  ) as Record<PlantFormName, PlantSet>
}
