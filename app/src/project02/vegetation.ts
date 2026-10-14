import { cellCenter, CELL, GRID_SIZE, sampleGrid } from './grid.ts'
import { OVERSAMPLE, slopeFactor, SpacingGrid, type Candidate } from '../weeks/week06/distribution.ts'
import { exposureSuitability, shelterSuitability } from '../weeks/week07/historyWorld.ts'
import { clamp01, lensFactor, random, smoothstep, type Lens, type Rng } from './core.ts'
import { splat, type Fields } from './fields.ts'
import { VARIANTS, type PlantKind } from './plantForms.ts'
import type { Statics } from './statics.ts'

/**
 * Shadow Ecology 0.2 — vegetation as two strategies reading the same fields
 * (Week 07's suitability rules on 0.2's light, shelter and moisture):
 *
 *   exposure  light first, moisture second; open ground and fair slopes
 *   shelter   shade (architecture, terrain, other plants) with moisture; low
 *
 * Distribution is Week 06's: oversampled candidates — most dispersed from
 * standing plants, some anywhere — accepted by suitability, kept apart by a
 * spacing grid. Nothing is placed by hand; stands appear, thicken, thin and
 * die back as the fields move. Paths, rubble and disturbance keep them off;
 * abandoned paths and old rubble are taken back.
 *
 * Each plant has a lifecycle: YOUNG while its Week 07 form grows out along
 * its branches, MATURE at full form, then past its (seeded) lifespan it
 * DECAYS — the form recedes from its tips and dries — and dies, standing a
 * while as a snag before it disappears. Seedlings dispersed from the living
 * regenerate the stand where the ground still suits it, so the composition
 * follows the conditions.
 */
export type Plant = {
  id: number
  kind: PlantKind
  x: number
  z: number
  y: number
  variant: number
  scale: number
  turn: number
  /** 0…1 along the growth front. */
  growth: number
  /** Running condition: suitability smoothed over a day. */
  health: number
  born: number
  /** Hours from birth after which it decays. */
  life: number
  /** 0 until its lifespan is spent, rising to 1 as it decays. */
  decay: number
  /** Clock of death, or −1 while alive. Dead plants stand as grey snags for a while. */
  died: number
  /** Lean toward the light (exposure) or flattening in shade (shelter). */
  leanX: number
  leanZ: number
  flatten: number
}

export type Vegetation = {
  plants: Plant[]
  nextId: number
  clock: number
  exposureSuit: Float32Array
  shelterSuit: Float32Array
  version: number
}

const COUNT = GRID_SIZE * GRID_SIZE
const RULES = {
  /** Hours between establishment rounds. */
  every: 2,
  max: { exposure: 380, shelter: 440 },
  perRound: 12,
  spacing: { exposure: 0.11, shelter: 0.085 },
  dispersal: 0.38,
  /** Share of candidates dispersed from standing plants. */
  local: 0.65,
  maxSlope: { exposure: 36, shelter: 30 },
  /** Hours from seed to full form in full suitability: slow enough to watch the branches grow out. */
  growHours: 64,
  /** Lifespan range (hours) per strategy: exposure plants turn over faster than shelter plants. */
  life: { exposure: [150, 280], shelter: [220, 420] },
  /** Hours a spent plant takes to decay to nothing. */
  decayHours: 48,
  /** Health below this, held for about a day, kills. */
  death: 0.16,
  snagHours: 40,
} as const

export type LifeStage = 'young' | 'mature' | 'decaying' | 'dead'

export function lifeStage(p: Plant): LifeStage {
  if (p.died >= 0) return 'dead'
  if (p.decay > 0) return 'decaying'
  return p.growth < 1 ? 'young' : 'mature'
}

const lifespan = (kind: PlantKind, roll: number) => RULES.life[kind][0] + (RULES.life[kind][1] - RULES.life[kind][0]) * roll

export function createVegetation(): Vegetation {
  return {
    plants: [],
    nextId: 1,
    clock: 0,
    exposureSuit: new Float32Array(COUNT),
    shelterSuit: new Float32Array(COUNT),
    version: 0,
  }
}

/** Re-reads each strategy's suitability from the fields. */
export function readSuitability(veg: Vegetation, fields: Fields, statics: Statics) {
  for (let index = 0; index < COUNT; index += 1) {
    if (!statics.inside[index] || statics.water[index] || fields.footprint[index] || statics.rim[index]! > 0.95) {
      veg.exposureSuit[index] = 0
      veg.shelterSuit[index] = 0
      continue
    }
    const light = Math.min(1.2, fields.insolation[index]!)
    const moisture = fields.moisture[index]!
    const enclosure = statics.enclosure[index]!
    const slope = statics.slope[index]!
    const trodden = 1 - smoothstep(0.12, 0.5, fields.wear[index]!)
    const rubble = fields.rubble[index]!
    const calm = 1 - Math.min(1, fields.disturbance[index]! * 1.2)
    veg.exposureSuit[index] =
      exposureSuitability(light, moisture, enclosure) *
      slopeFactor(RULES.maxSlope.exposure, slope) *
      trodden *
      calm *
      (1 - smoothstep(0.02, 0.1, rubble))
    veg.shelterSuit[index] =
      shelterSuitability(fields.shelter[index]!, moisture, enclosure) *
      slopeFactor(RULES.maxSlope.shelter, slope) *
      trodden *
      calm *
      (1 - smoothstep(0.06, 0.16, rubble)) *
      (1 - 0.6 * smoothstep(0.85, 1.1, light))
  }
}

export const suitabilityAt = (veg: Vegetation, kind: PlantKind, x: number, z: number) =>
  sampleGrid(kind === 'exposure' ? veg.exposureSuit : veg.shelterSuit, x, z)

/** The light gradient, so exposure plants lean toward the brighter side. */
function lightLean(fields: Fields, x: number, z: number): [number, number] {
  const h = CELL * 2
  const gx = sampleGrid(fields.insolation, x + h, z) - sampleGrid(fields.insolation, x - h, z)
  const gz = sampleGrid(fields.insolation, x, z + h) - sampleGrid(fields.insolation, x, z - h)
  const l = Math.hypot(gx, gz)
  const amount = Math.min(1, l * 3)
  return l > 1e-5 ? [(gx / l) * amount, (gz / l) * amount] : [0, 0]
}

function establish(veg: Vegetation, kind: PlantKind, statics: Statics, fields: Fields, rng: Rng, clock: number, density = 1) {
  const alive = veg.plants.filter((p) => p.died < 0 && p.kind === kind)
  const room = Math.round(RULES.max[kind] * density) - alive.length
  if (room <= 0) return
  const wanted = Math.min(RULES.perRound, room)
  const spacing = new SpacingGrid(RULES.spacing[kind])
  for (const p of veg.plants) {
    if (p.died < 0 || clock - p.died < 6) {
      spacing.add({ x: p.x, z: p.z, weight: 1, status: 'accepted', scale: p.scale, turn: p.turn, variety: p.variant })
    }
  }
  const field = kind === 'exposure' ? veg.exposureSuit : veg.shelterSuit
  let placed = 0
  for (let n = 0; n < wanted * OVERSAMPLE && placed < wanted; n += 1) {
    let x: number
    let z: number
    if (alive.length && random(rng) < RULES.local) {
      const parent = alive[Math.floor(random(rng) * alive.length)]!
      const a = random(rng) * Math.PI * 2
      const r = RULES.dispersal * Math.sqrt(random(rng))
      x = parent.x + Math.cos(a) * r
      z = parent.z + Math.sin(a) * r
    } else {
      const index = Math.floor(random(rng) * COUNT)
      ;[x, z] = cellCenter(index)
      x += (random(rng) - 0.5) * CELL
      z += (random(rng) - 0.5) * CELL
    }
    const scaleRoll = random(rng)
    const turn = random(rng) * Math.PI * 2
    const variant = Math.floor(random(rng) * VARIANTS)
    const lifeRoll = random(rng)
    const draw = random(rng)
    const cell = statics.cellAt(x, z)
    if (cell < 0 || !statics.inside[cell]) continue
    const suit = sampleGrid(field, x, z)
    if (draw >= suit ** 1.5) continue
    const candidate: Candidate = { x, z, weight: suit, status: 'accepted', scale: 0.75 + 0.5 * scaleRoll, turn, variety: variant }
    if (!spacing.isClear(x, z)) continue
    spacing.add(candidate)
    const [leanX, leanZ] = kind === 'exposure' ? lightLean(fields, x, z) : [0, 0]
    veg.plants.push({
      id: veg.nextId,
      kind,
      x,
      z,
      y: statics.groundAt(x, z),
      variant,
      scale: candidate.scale * (0.7 + 0.5 * suit),
      turn,
      growth: 0.02,
      health: suit,
      born: clock,
      life: lifespan(kind, lifeRoll),
      decay: 0,
      died: -1,
      leanX,
      leanZ,
      flatten: kind === 'shelter' ? clamp01(fields.shelter[cell]!) : 0,
    })
    veg.nextId += 1
    placed += 1
  }
}

export type VegetationEvent = { kind: 'dieback' | 'colonise'; x: number; z: number; count: number; strategy: PlantKind }

/**
 * Grows, stresses and kills plants over `hours`; every few hours re-reads
 * suitability and establishes new plants. Returns notable changes.
 */
export function stepVegetation(
  veg: Vegetation,
  statics: Statics,
  fields: Fields,
  hours: number,
  clock: number,
  weatherLight: number,
  lens: Lens | null,
  rng: Rng,
  density = 1,
): VegetationEvent[] {
  const events: VegetationEvent[] = []
  let died = 0
  let shelterDied = 0
  let dx = 0
  let dz = 0
  for (const p of veg.plants) {
    if (p.died >= 0) continue
    const local = hours * lensFactor(lens, p.x, p.z)
    // Past its lifespan a plant decays: it dries and its form recedes from the tips.
    const age = clock - p.born
    const life = p.life || RULES.life[p.kind][0]
    if (age > life) p.decay = Math.min(1, (p.decay || 0) + local / RULES.decayHours)
    const suit = suitabilityAt(veg, p.kind, p.x, p.z) * (1 - (p.decay || 0))
    p.health += (suit - p.health) * (1 - Math.exp(-local / 24))
    const vigour = p.kind === 'exposure' ? 0.4 + 0.6 * weatherLight : 1
    if (p.decay > 0) p.growth = Math.max(0.25, p.growth - (local / RULES.decayHours) * 0.6)
    else p.growth = Math.min(1, p.growth + (local / RULES.growHours) * Math.max(0, p.health - 0.1) * vigour * 1.4)
    if (p.kind === 'exposure') {
      const [lx, lz] = lightLean(fields, p.x, p.z)
      const k = 1 - Math.exp(-local / 30)
      p.leanX += (lx - p.leanX) * k
      p.leanZ += (lz - p.leanZ) * k
    } else {
      const cell = statics.cellAt(p.x, p.z)
      if (cell >= 0) p.flatten += (fields.shelter[cell]! - p.flatten) * (1 - Math.exp(-local / 30))
    }
    if ((p.health < RULES.death && age > 12) || p.decay >= 1) {
      p.died = clock
      died += 1
      if (p.kind === 'shelter') shelterDied += 1
      dx += p.x
      dz += p.z
      splat(fields.deadVegetation, p.x, p.z, 0.12, 0.6, 1)
    }
  }
  if (died >= 3) events.push({ kind: 'dieback', x: dx / died, z: dz / died, count: died, strategy: shelterDied * 2 >= died ? 'shelter' : 'exposure' })
  veg.plants = veg.plants.filter((p) => p.died < 0 || clock - p.died < RULES.snagHours)

  veg.clock += hours
  if (veg.clock >= RULES.every) {
    veg.clock = 0
    readSuitability(veg, fields, statics)
    const before = veg.plants.length
    establish(veg, 'exposure', statics, fields, rng, clock, density)
    establish(veg, 'shelter', statics, fields, rng, clock, density)
    const added = veg.plants.length - before
    if (added >= 6) {
      const fresh = veg.plants.slice(-added)
      events.push({
        kind: 'colonise',
        x: fresh.reduce((s, p) => s + p.x, 0) / added,
        z: fresh.reduce((s, p) => s + p.z, 0) / added,
        count: added,
        strategy: fresh.filter((p) => p.kind === 'shelter').length > added / 2 ? 'shelter' : 'exposure',
      })
    }
    coverFields(veg, fields)
  }
  veg.version += 1
  return events
}

/**
 * Brings each strategy down to its cap for `density` at once, keeping a
 * stable (id-hashed) share so the same plants stay at each density.
 */
export function thinVegetation(veg: Vegetation, density: number) {
  const hash = (id: number) => ((Math.imul(id, 2654435761) >>> 0) / 4294967296)
  const keep = new Set<Plant>()
  for (const kind of ['exposure', 'shelter'] as const) {
    const alive = veg.plants.filter((p) => p.died < 0 && p.kind === kind)
    const cap = Math.round(RULES.max[kind] * density)
    alive.sort((p, q) => hash(p.id) - hash(q.id))
    alive.slice(0, cap).forEach((p) => keep.add(p))
  }
  const before = veg.plants.length
  veg.plants = veg.plants.filter((p) => p.died >= 0 || keep.has(p))
  if (veg.plants.length !== before) veg.version += 1
}

/** Plant canopy into the fields: shelter plants give cover to the ground beneath them. */
export function coverFields(veg: Vegetation, fields: Fields) {
  fields.exposureCover.fill(0)
  fields.shelterCover.fill(0)
  for (const p of veg.plants) {
    if (p.died >= 0) continue
    const r = (p.kind === 'shelter' ? 0.12 : 0.08) * p.scale
    splat(p.kind === 'shelter' ? fields.shelterCover : fields.exposureCover, p.x, p.z, r, 0.5 * p.growth, 1)
  }
}

/**
 * Seeds an initial distribution by running establishment rounds on the
 * starting fields, with mixed ages: some seedlings still growing out, some
 * mature, a few already near the end of their life.
 */
export function seedVegetation(veg: Vegetation, statics: Statics, fields: Fields, rng: Rng) {
  readSuitability(veg, fields, statics)
  for (let round = 0; round < 10; round += 1) {
    establish(veg, 'exposure', statics, fields, rng, 0)
    establish(veg, 'shelter', statics, fields, rng, 0)
  }
  for (const p of veg.plants) {
    const age = random(rng) * p.life * 0.95
    p.born = -age
    p.growth = clamp01(0.08 + (age / RULES.growHours) * (0.5 + 0.5 * p.health))
  }
  coverFields(veg, fields)
}
