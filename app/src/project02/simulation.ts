import { SUNSET_HOUR, sunAt } from '../project/sun.ts'
import {
  createArchitecture,
  decayArchitecture,
  growArchitecture,
  resampleArchitecture,
  seedInitialSites,
  type Architecture,
  type GrowthContext,
} from './architecture.ts'
import { createRng, type Lens, type Resolution, type Rng } from './core.ts'
import {
  CREATURES_ENABLED,
  createCreatures,
  driveCreature,
  stepCreatures,
  type CreatureContext,
  type Creatures,
  type DriveInput,
} from './creatures.ts'
import {
  createFields,
  createLightTrace,
  depositRubble,
  scanArchitecture,
  splat,
  traceNow,
  updateFields,
  type Fields,
  type LightTrace,
} from './fields.ts'
import { createHistoryLog, followUp, logEvent, measurePlace, type HistoryLog } from './history.ts'
import { cellCenter } from './grid.ts'
import { wearPaths } from './paths.ts'
import type { Statics } from './statics.ts'
import { createVegetation, seedVegetation, stepVegetation, type Vegetation } from './vegetation.ts'
import { createWeather, stepWeather, weatherLight, type Weather, type WeatherKind } from './weather.ts'

/**
 * Shadow Ecology 0.2 — the whole changing world as one plain-data state, so
 * a branch is a structured clone. One state, many representations: every
 * view, level of detail and way of seeing draws from it and none changes it.
 */
export type Eco = {
  /** The seed its distributions were drawn from (the Seed control). */
  seed: number
  clock: number
  hour: number
  day: number
  noon: number
  rng: Rng
  arch: Architecture
  fields: Fields
  weather: Weather
  veg: Vegetation
  creatures: Creatures
  log: HistoryLog
  /** Where ground creatures' habitat was centred at the last sunset, to notice shelter moving. */
  habitatCentre: [number, number] | null
  /** Hours of environment not yet applied (fields update in small batches). */
  pendingHours: number
}

export type Settings = {
  growing: boolean
  decaying: boolean
  growthSpeed: number
  decaySpeed: number
  lens: Lens | null
  /** Creature under keyboard control, or 0. */
  controlled: number
  /** Plant density: multiplier on how many plants each strategy keeps. */
  density: number
}

export const START_HOUR = 9
export const START_NOON = 62
const SUBSTEP = 0.05
const FIELD_BATCH = 0.25
const SEED = 20260
/** The world's seed when none is chosen: the Seed control's starting value. */
export const DEFAULT_SEED = 1
/** Collapses smaller than this (world volume) are weathering, not events. */
const COLLAPSE_LOGGED = 0.0015
/** How far (world units) the habitat's centre must move between sunsets to count as a migration. */
const MIGRATION = 0.6

/** A new world; the same seed always gives the same sites, plants and history. */
export function createEco(statics: Statics, resolution: Resolution, seed = DEFAULT_SEED): Eco {
  const rng = createRng(SEED + seed * 7919)
  const arch = createArchitecture(statics, resolution)
  const fields = createFields(statics)
  const trace = createLightTrace()
  fields.insolation = traceNow(trace, statics, arch, START_NOON)
  fields.sunMemory.set(fields.insolation)
  const weather = createWeather()
  updateFields(fields, statics, weather, 0, 1)
  const veg = createVegetation()
  const eco: Eco = {
    seed,
    clock: 0,
    hour: START_HOUR,
    day: 1,
    noon: START_NOON,
    rng,
    arch,
    fields,
    weather,
    veg,
    creatures: createCreatures(statics, rng),
    log: createHistoryLog(),
    habitatCentre: null,
    pendingHours: 0,
  }
  seedInitialSites(arch, growthContext(eco, statics, defaultSettings()), 0)
  scanArchitecture(fields, statics, arch)
  seedVegetation(veg, statics, fields, rng)
  updateFields(fields, statics, weather, 0, 1)
  fields.habitatBefore.set(fields.habitat)
  return eco
}

export const defaultSettings = (): Settings => ({
  growing: true,
  decaying: true,
  growthSpeed: 1,
  decaySpeed: 1,
  lens: null,
  controlled: 0,
  density: 1,
})

function growthContext(eco: Eco, statics: Statics, settings: Settings): GrowthContext {
  const sun = sunAt(eco.hour, eco.noon)
  return {
    statics,
    insolation: eco.fields.insolation,
    rubble: eco.fields.rubble,
    noon: eco.noon,
    sunDirection: sun.direction,
    daylight: sun.daylight,
    weatherLight: weatherLight(eco.weather),
    rain: eco.weather.rain,
    fog: eco.weather.fog,
    drought: eco.weather.drought,
    growthSpeed: settings.growthSpeed,
    decaySpeed: settings.decaySpeed,
    growing: settings.growing,
    decaying: settings.decaying,
    lens: settings.lens,
    rng: eco.rng,
  }
}

function creatureContext(eco: Eco, statics: Statics, settings: Settings): CreatureContext {
  return {
    statics,
    fields: eco.fields,
    veg: eco.veg,
    arch: eco.arch,
    weather: eco.weather,
    lens: settings.lens,
    rng: eco.rng,
    daylight: sunAt(eco.hour, eco.noon).daylight,
    controlled: settings.controlled,
  }
}

/** Turns what the architecture reported into history entries and field changes. */
function absorbArchitecture(eco: Eco, statics: Statics) {
  const { arch, fields, veg, log } = eco
  for (const e of arch.events) {
    if (e.kind === 'collapse') {
      const volume = e.voxels * arch.voxel ** 3
      splat(fields.disturbance, e.x, e.z, 0.5 + Math.min(0.5, volume * 4), 0.9, 1)
      if (volume > COLLAPSE_LOGGED) {
        logEvent(log, 'collapse', e.clock, e.x, e.z, 0.7, '', measurePlace(statics, fields, veg, e.x, e.z, 0.7), volume)
      }
    } else if (e.kind === 'seed') {
      logEvent(log, 'seed', e.clock, e.x, e.z, 0.6, e.ruin ? 'on the rubble of an older structure' : '', measurePlace(statics, fields, veg, e.x, e.z, 0.6))
    } else if (e.kind === 'brace') {
      continue
    } else {
      logEvent(log, 'bridge', e.clock, e.x, e.z, 0.6, '', measurePlace(statics, fields, veg, e.x, e.z, 0.6))
    }
  }
  arch.events = []
  depositRubble(fields, arch)
}

function applyEnvironment(eco: Eco, statics: Statics, settings: Settings, hours: number) {
  const sun = sunAt(eco.hour, eco.noon)
  updateFields(eco.fields, statics, eco.weather, hours, sun.daylight)
  wearPaths(eco.fields, statics, eco.arch, eco.seed, hours)
  const events = stepVegetation(eco.veg, statics, eco.fields, hours, eco.clock, weatherLight(eco.weather), settings.lens, eco.rng, settings.density)
  for (const e of events) {
    const detail = `${e.count} ${e.strategy === 'exposure' ? 'light-seeking' : 'shadow-seeking'}`
    if (e.kind === 'dieback' && e.count >= 4) {
      logEvent(eco.log, 'dieback', eco.clock, e.x, e.z, 0.8, detail, measurePlace(statics, eco.fields, eco.veg, e.x, e.z, 0.8), e.count)
    } else if (e.kind === 'colonise' && e.count >= 8) {
      logEvent(eco.log, 'colonise', eco.clock, e.x, e.z, 0.8, detail, measurePlace(statics, eco.fields, eco.veg, e.x, e.z, 0.8), e.count)
    }
  }
  followUp(eco.log, eco.clock, statics, eco.fields, eco.veg)
}

/** Habitat-weighted centre of the good ground, or null when there is little. */
function habitatCentre(statics: Statics, habitat: Float32Array): [number, number] | null {
  let x = 0
  let z = 0
  let w = 0
  for (let index = 0; index < habitat.length; index += 1) {
    const h = habitat[index]! - 0.35
    if (h <= 0 || !statics.inside[index]) continue
    const [cx, cz] = cellCenter(index)
    x += cx * h
    z += cz * h
    w += h
  }
  return w > 2 ? [x / w, z / w] : null
}

/** At sunset: has the shelter creatures live in moved since the last one? */
function noticeMigration(eco: Eco, statics: Statics) {
  const centre = habitatCentre(statics, eco.fields.habitat)
  const last = eco.habitatCentre
  eco.habitatCentre = centre
  if (!centre || !last) return
  const moved = Math.hypot(centre[0] - last[0], centre[1] - last[1])
  if (moved < MIGRATION) return
  logEvent(
    eco.log,
    'migration',
    eco.clock,
    centre[0],
    centre[1],
    1.2,
    `habitat centre moved ${moved.toFixed(1)} m`,
    measurePlace(statics, eco.fields, eco.veg, centre[0], centre[1], 1.2),
  )
}

/** Logs a weather change, from the cycle or set by hand. */
export function logWeather(eco: Eco, statics: Statics, kind: WeatherKind, forced: boolean) {
  const detail = forced ? 'set by hand' : ''
  logEvent(eco.log, kind, eco.clock, 0, 0, 9, detail, measurePlace(statics, eco.fields, eco.veg, 0, 0, 9), 0, forced)
}

/**
 * Advances the world by `hours` of simulated time: sun and weather,
 * architecture growth and decay, creatures (sub-stepped so they never
 * jump), then fields, vegetation and the history log in small batches.
 */
export function advanceEco(eco: Eco, statics: Statics, settings: Settings, hours: number) {
  let left = hours
  const plans = { left: 0 }
  while (left > 1e-6) {
    const dt = Math.min(SUBSTEP, left)
    plans.left = 2
    left -= dt
    const before = eco.hour
    eco.hour += dt
    eco.clock += dt
    if (before < SUNSET_HOUR && eco.hour >= SUNSET_HOUR) {
      eco.fields.habitatBefore.set(eco.fields.habitat)
      noticeMigration(eco, statics)
    }
    if (eco.hour >= 24) {
      eco.hour -= 24
      eco.day += 1
    }
    for (const began of stepWeather(eco.weather, dt, eco.rng)) logWeather(eco, statics, began, false)
    const growth = growthContext(eco, statics, settings)
    growArchitecture(eco.arch, growth, dt, eco.clock)
    decayArchitecture(eco.arch, growth, dt, eco.clock)
    if (CREATURES_ENABLED) stepCreatures(eco.creatures, creatureContext(eco, statics, settings), dt, plans)
    eco.pendingHours += dt
    if (eco.pendingHours >= FIELD_BATCH) {
      absorbArchitecture(eco, statics)
      applyEnvironment(eco, statics, settings, eco.pendingHours)
      eco.pendingHours = 0
    }
  }
}

/** Keyboard-driven creature, in real seconds. */
export function driveEco(eco: Eco, statics: Statics, settings: Settings, input: DriveInput, seconds: number) {
  if (!settings.controlled) return
  driveCreature(eco.creatures, settings.controlled, input, seconds, creatureContext(eco, statics, settings))
}

/** Reads the architecture into the grid (footprint, roofs) after it changed. */
export function rescan(eco: Eco, statics: Statics) {
  scanArchitecture(eco.fields, statics, eco.arch)
}

/**
 * Fast-forwards whole hours headless. Light is re-traced every few hours so
 * growth and shelter keep seeing the structure as it changes.
 */
export function fastForward(eco: Eco, statics: Statics, settings: Settings, hours: number, trace: LightTrace, chunk = hours > 24 ? 6 : 3) {
  for (let done = 0; done < hours; done += chunk) {
    advanceEco(eco, statics, settings, Math.min(chunk, hours - done))
    scanArchitecture(eco.fields, statics, eco.arch)
    eco.fields.insolation = traceNow(trace, statics, eco.arch, eco.noon)
  }
}

export function changeResolution(eco: Eco, statics: Statics, resolution: Resolution) {
  if (eco.arch.resolution === resolution) return
  eco.arch = resampleArchitecture(eco.arch, statics, resolution)
  scanArchitecture(eco.fields, statics, eco.arch)
}

/** A branch point: the whole changing world, cloned. */
export const snapshotEco = (eco: Eco): Eco => structuredClone(eco)

export function ecoSummary(eco: Eco): string {
  const plants = eco.veg.plants.filter((p) => p.died < 0).length
  return `Day ${eco.day} · ${eco.arch.count} voxels · ${plants} vegetation`
}
