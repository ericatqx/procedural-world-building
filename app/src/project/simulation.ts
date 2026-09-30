import type { BufferGeometry } from 'three'
import {
  architectureFootprint,
  architectureSolid,
  clearanceAbove,
  createArchitecture,
  createArchitectureGeometry,
  growArchitecture,
  weatherArchitecture,
  type Architecture,
} from './architecture.ts'
import { GRID_SIZE } from './grid.ts'
import {
  groundSlopes,
  habitatSuitability,
  rememberSunlight,
  SUITABLE,
  type HabitatRule,
} from './habitat.ts'
import { dailyInsolation, sunVisible } from './light.ts'
import { createPaths, fieldPeaks, waterEdges, type PathLine } from './paths.ts'
import { SUNSET_HOUR, sunAt } from './sun.ts'
import { createVegetation, type Plant } from './vegetation.ts'
import { byte, type BaseWorld } from './world.ts'

/**
 * Shadow Ecology — the running world.
 *
 * Growth: every quarter hour of daylight the clock passes, played or
 * scrubbed, earns a voxel budget in proportion to the sun's strength, spent
 * on architecture growth moves chosen under the sun of that moment. New
 * blocks cast shadows at once (the current shadow).
 *
 * Decay: weather and time, not sunlight. Every tick, day and night,
 * weathering earns a budget in proportion to the standing volume, far below
 * growth while the structure is small, so growth wins at first and the two
 * meet over the long run: turnover, not collapse. It spends it on old, open,
 * high and poorly supported modules first.
 *
 * Age: every tick adds to the architecture clock; a voxel's age is the clock
 * time since it was placed, so blocks keep ageing while growth is paused.
 *
 * Ecology: at sunset, or when the page asks once the clock settles, daily
 * sunlight is traced again if the architecture changed, or the noon sun height
 * or habitat rule changed; paths and vegetation are rebuilt from it. Each
 * sunset passed going forward also blends the day's sunlight into a memory,
 * from which creature habitat is rebuilt, so habitat follows changing
 * shadow over days.
 *
 * Deterministic: after Reset, the same noon sun height and the same passage
 * of time give the same architecture.
 */
const TICK_HOURS = 0.25
const TICKS_PER_DAY = 24 / TICK_HOURS
/** Voxels per hour under a full, overhead sun. */
const GROWTH_RATE = 16
const MAX_VOXELS = 7000
/** Unspent growth carried over at most this far, so a stalled structure does not burst later. */
const MAX_BUDGET = 40
/** Voxels weathered per hour, per standing voxel. */
const DECAY_RATE = 0.0015
/** Weathering waits for at least this budget, about a module's two layers, so it removes whole steps. */
const DECAY_STEP = 8
const SEED = 20260929
const PATH_WEAR_RANGE = 0.08
/** Secondary path destinations: vegetation and habitat regions, and how far apart they must be. */
const REGION_DESTINATIONS = 3
const VEGETATION_PEAK = 0.5
const DESTINATION_SPACING = 0.9
const NO_PATHS = new Float32Array(GRID_SIZE * GRID_SIZE).fill(Infinity)

export type Ecology = {
  noonElevation: number
  rule: HabitatRule
  /** Daily direct sunlight per grid cell, relative to open flat ground. */
  insolation: Float32Array
  /** Creature habitat suitability per grid cell (0…1). */
  habitat: Float32Array
  paths: BufferGeometry
  pathLength: number
  pathLines: PathLine[]
  plants: Plant[]
}

export type Simulation = {
  base: BaseWorld
  architecture: Architecture
  geometry: BufferGeometry
  ecology: Ecology
  random: () => number
  /** The random stream's position, so a saved world continues the same draws. */
  rng: { state: number }
  /** Noon sun height at Reset, which placed the sites. */
  resetNoon: number
  budget: number
  decayBudget: number
  /** Voxels weathered away so far. */
  weathered: number
  days: number
  /** Architecture has grown or weathered since the ecology was last traced. */
  stale: boolean
  /** Daily sunlight remembered over the last few sunsets. */
  sunMemory: Float32Array
  slopes: Float32Array
}

function mulberry32(rng: { state: number }): () => number {
  return () => {
    rng.state = (rng.state + 0x6d2b79f5) >>> 0
    let t = rng.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const traceSunlight = (base: BaseWorld, architecture: Architecture, noonElevation: number) =>
  dailyInsolation(base.ground, base.hydrology.inside, architectureSolid(architecture), noonElevation)

/** Writes habitat into the texture: R for now, or G for the habitat before the last sunset. */
function writeHabitat(base: BaseWorld, habitat: Float32Array, channel: 0 | 1 = 0) {
  const data = base.habitatField.image.data as Uint8Array
  for (let index = 0; index < habitat.length; index += 1) {
    data[index * 4 + channel] = byte(habitat[index]!)
  }
  base.habitatField.needsUpdate = true
}

/**
 * Display only: the habitat the terrain compares against, to mark what the
 * last sunset gained and lost. Set at each sunset passed forward; reset to
 * the current habitat after Reset, a day jump or a change of settings, so
 * only the passage of days shows as change.
 */
const setHabitatBefore = (base: BaseWorld, habitat: Float32Array) => writeHabitat(base, habitat, 1)

/** What the ecology is read from. */
type EcologySource = Pick<Simulation, 'base' | 'architecture' | 'sunMemory' | 'slopes'>

function habitatOf(source: EcologySource, rule: HabitatRule): Float32Array {
  const { base, architecture } = source
  const habitat = habitatSuitability(
    base.hydrology,
    source.slopes,
    source.sunMemory,
    architectureFootprint(architecture),
    rule,
  )
  writeHabitat(base, habitat)
  return habitat
}

function computeEcology(
  source: EcologySource,
  noonElevation: number,
  rule: HabitatRule,
  insolation: Float32Array,
): Ecology {
  const { base, architecture } = source
  const { hydrology, groundHeight, field } = base
  const footprint = architectureFootprint(architecture)
  const clearance = (x: number, z: number, ground: number) => clearanceAbove(architecture, x, z, ground)
  const habitat = habitatOf(source, rule)

  const { sites } = architecture
  const centre = {
    x: sites.reduce((sum, site) => sum + site.x, 0) / Math.max(1, sites.length),
    z: sites.reduce((sum, site) => sum + site.z, 0) / Math.max(1, sites.length),
  }
  const unpathed = createVegetation(hydrology, groundHeight, insolation, NO_PATHS, footprint, clearance)
  const destinations = [
    ...waterEdges(hydrology, centre),
    ...fieldPeaks(unpathed.region, REGION_DESTINATIONS, VEGETATION_PEAK, DESTINATION_SPACING),
    ...fieldPeaks(habitat, REGION_DESTINATIONS, SUITABLE, DESTINATION_SPACING),
  ]
  const paths = createPaths(hydrology, groundHeight, footprint, sites, destinations)
  const vegetation = createVegetation(hydrology, groundHeight, insolation, paths.distance, footprint, clearance)

  const data = field.image.data as Uint8Array
  for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 1) {
    data[index * 4 + 1] = byte(vegetation.region[index]!)
    data[index * 4 + 2] = byte(Math.exp(-paths.distance[index]! / PATH_WEAR_RANGE))
  }
  field.needsUpdate = true

  return {
    noonElevation,
    rule,
    insolation,
    habitat,
    paths: paths.geometry,
    pathLength: paths.length,
    pathLines: paths.lines,
    plants: vegetation.plants,
  }
}

/** Sites emerge where the bare terrain is best lit, flattest, driest and highest. */
export function createSimulation(base: BaseWorld, noonElevation: number, rule: HabitatRule): Simulation {
  const bare = dailyInsolation(base.ground, base.hydrology.inside, null, noonElevation)
  const architecture = createArchitecture(base.hydrology, base.groundHeight, bare)
  const insolation = traceSunlight(base, architecture, noonElevation)
  const source: EcologySource = {
    base,
    architecture,
    sunMemory: insolation.slice(),
    slopes: groundSlopes(base.hydrology, base.groundHeight),
  }
  const ecology = computeEcology(source, noonElevation, rule, insolation)
  setHabitatBefore(base, ecology.habitat)
  const rng = { state: SEED >>> 0 }
  return {
    ...source,
    geometry: createArchitectureGeometry(architecture),
    ecology,
    random: mulberry32(rng),
    rng,
    resetNoon: noonElevation,
    budget: 0,
    decayBudget: 0,
    weathered: 0,
    days: 0,
    stale: false,
  }
}

/** Scalars of a saved world; its arrays travel alongside as a payload. */
export type SimulationTotals = {
  resetNoon: number
  randomState: number
  clock: number
  count: number
  /** Null while nothing stands (−Infinity). */
  top: number | null
  siteVolume: number[]
  budget: number
  decayBudget: number
  weathered: number
  days: number
}

export type SimulationArrays = {
  /** Filled voxel indices, with each one's site and placement hour. */
  voxels: Uint32Array
  voxelSites: Uint8Array
  voxelBirths: Float32Array
  moduleTop: Int16Array
  moduleBottom: Int16Array
  moduleSite: Uint8Array
  moduleSupport: Uint8Array
  moduleCut: Uint8Array
  sunMemory: Float32Array
}

/**
 * Everything that changes as the world runs. With the base world, the reset
 * noon (which places the sites) and these, growth continues exactly as it
 * would have; the ecology is traced again on restore.
 */
export function snapshotSimulation(simulation: Simulation): { totals: SimulationTotals; arrays: SimulationArrays } {
  const { architecture } = simulation
  const { solid, birth } = architecture
  let filled = 0
  for (let index = 0; index < solid.length; index += 1) {
    if (solid[index]) filled += 1
  }
  const voxels = new Uint32Array(filled)
  const voxelSites = new Uint8Array(filled)
  const voxelBirths = new Float32Array(filled)
  for (let index = 0, next = 0; index < solid.length; index += 1) {
    if (solid[index]) {
      voxels[next] = index
      voxelSites[next] = solid[index]!
      voxelBirths[next] = birth[index]!
      next += 1
    }
  }
  return {
    totals: {
      resetNoon: simulation.resetNoon,
      randomState: simulation.rng.state,
      clock: architecture.clock,
      count: architecture.count,
      top: Number.isFinite(architecture.top) ? architecture.top : null,
      siteVolume: [...architecture.siteVolume],
      budget: simulation.budget,
      decayBudget: simulation.decayBudget,
      weathered: simulation.weathered,
      days: simulation.days,
    },
    arrays: {
      voxels,
      voxelSites,
      voxelBirths,
      moduleTop: architecture.moduleTop.slice(),
      moduleBottom: architecture.moduleBottom.slice(),
      moduleSite: architecture.moduleSite.slice(),
      moduleSupport: architecture.moduleSupport.slice(),
      moduleCut: architecture.moduleCut.slice(),
      sunMemory: simulation.sunMemory.slice(),
    },
  }
}

/**
 * A saved world on this base: Reset at its noon, then its dynamic state laid
 * over. Throws if the arrays do not fit this build of the world.
 */
export function restoreSimulation(
  base: BaseWorld,
  totals: SimulationTotals,
  arrays: SimulationArrays,
  noonElevation: number,
  rule: HabitatRule,
): Simulation {
  const simulation = createSimulation(base, totals.resetNoon, rule)
  const { architecture } = simulation
  const modules = architecture.moduleTop.length
  const fits =
    arrays.voxelSites.length === arrays.voxels.length &&
    arrays.voxelBirths.length === arrays.voxels.length &&
    [arrays.moduleTop, arrays.moduleBottom, arrays.moduleSite, arrays.moduleSupport, arrays.moduleCut].every(
      (array) => array.length === modules,
    ) &&
    arrays.sunMemory.length === simulation.sunMemory.length &&
    Array.isArray(totals.siteVolume) &&
    totals.siteVolume.length === architecture.sites.length &&
    arrays.voxels.every((index) => index < architecture.solid.length)
  if (!fits) {
    throw new Error('This snapshot does not match the current world.')
  }

  architecture.solid.fill(0)
  architecture.birth.fill(0)
  arrays.voxels.forEach((index, i) => {
    architecture.solid[index] = arrays.voxelSites[i]!
    architecture.birth[index] = arrays.voxelBirths[i]!
  })
  architecture.moduleTop.set(arrays.moduleTop)
  architecture.moduleBottom.set(arrays.moduleBottom)
  architecture.moduleSite.set(arrays.moduleSite)
  architecture.moduleSupport.set(arrays.moduleSupport)
  architecture.moduleCut.set(arrays.moduleCut)
  architecture.clock = totals.clock
  architecture.count = totals.count
  architecture.top = totals.top ?? -Infinity
  architecture.siteVolume = [...totals.siteVolume]
  simulation.sunMemory.set(arrays.sunMemory)
  simulation.rng.state = totals.randomState >>> 0
  simulation.budget = totals.budget
  simulation.decayBudget = totals.decayBudget
  simulation.weathered = totals.weathered
  simulation.days = totals.days

  simulation.geometry = createArchitectureGeometry(architecture)
  const insolation = traceSunlight(base, architecture, noonElevation)
  simulation.ecology = computeEcology(simulation, noonElevation, rule, insolation)
  simulation.stale = false
  setHabitatBefore(base, simulation.ecology.habitat)
  return simulation
}

const sameRule = (a: HabitatRule, b: HabitatRule) =>
  a.sunlightLimit === b.sunlightLimit && a.maxSlope === b.maxSlope

const ecologyCurrent = (simulation: Simulation, noonElevation: number, rule: HabitatRule) =>
  !simulation.stale &&
  simulation.ecology.noonElevation === noonElevation &&
  sameRule(simulation.ecology.rule, rule)

/**
 * Re-traces daily light and rebuilds habitat, paths and vegetation if the
 * noon sun height or habitat rule changed or the architecture changed since;
 * false if already current. The sunlight memory is left as it is.
 */
export function refreshEcology(simulation: Simulation, noonElevation: number, rule: HabitatRule): boolean {
  if (ecologyCurrent(simulation, noonElevation, rule)) {
    return false
  }
  const resettled = simulation.ecology.noonElevation !== noonElevation || !sameRule(simulation.ecology.rule, rule)
  const insolation = traceSunlight(simulation.base, simulation.architecture, noonElevation)
  simulation.ecology = computeEcology(simulation, noonElevation, rule, insolation)
  simulation.stale = false
  if (resettled) {
    setHabitatBefore(simulation.base, simulation.ecology.habitat)
  }
  return true
}

/**
 * At sunset: going forward, the day's sunlight joins the memory and habitat
 * follows; paths and vegetation are rebuilt only if the ecology is out of date.
 */
function passSunset(simulation: Simulation, noonElevation: number, rule: HabitatRule, forward: boolean): boolean {
  const current = ecologyCurrent(simulation, noonElevation, rule)
  if (current && !forward) {
    return false
  }
  const insolation = current
    ? simulation.ecology.insolation
    : traceSunlight(simulation.base, simulation.architecture, noonElevation)
  if (forward) {
    rememberSunlight(simulation.sunMemory, insolation)
    setHabitatBefore(simulation.base, simulation.ecology.habitat)
  }
  simulation.ecology = current
    ? { ...simulation.ecology, habitat: habitatOf(simulation, rule) }
    : computeEcology(simulation, noonElevation, rule, insolation)
  simulation.stale = false
  return true
}

/**
 * At sunset while fast-forwarding: the day's sunlight joins the memory, but
 * habitat, paths and vegetation wait for `fastForward` to finish. Nothing
 * that grows or weathers reads them, so the outcome is the same.
 */
function rememberDay(simulation: Simulation, noonElevation: number) {
  if (simulation.stale || simulation.ecology.noonElevation !== noonElevation) {
    const insolation = traceSunlight(simulation.base, simulation.architecture, noonElevation)
    simulation.ecology = { ...simulation.ecology, noonElevation, insolation }
    simulation.stale = false
  }
  rememberSunlight(simulation.sunMemory, simulation.ecology.insolation)
}

/** Which architecture processes run, and their rate multipliers. */
export type Processes = { growing: boolean; growthRate: number; decaying: boolean; decayRate: number }

/**
 * Runs the ticks the clock passes going from `fromHour` by `hours`, which is
 * negative when the time is scrubbed back; the sun of each tick drives growth
 * (and time drives decay and age) either way, but only forward time counts days.
 * Returns true when anything visible changed (architecture or ecology).
 */
export function advanceSimulation(
  simulation: Simulation,
  fromHour: number,
  hours: number,
  noonElevation: number,
  rule: HabitatRule,
  { growing, growthRate, decaying, decayRate }: Processes,
  deferEcology = false,
): boolean {
  const { architecture, base } = simulation
  let reshaped = false
  let refreshed = false
  const ticks: number[] = []
  if (hours >= 0) {
    for (let tick = Math.floor(fromHour / TICK_HOURS) + 1; tick <= Math.floor((fromHour + hours) / TICK_HOURS); tick += 1) {
      ticks.push(tick)
    }
  } else {
    for (let tick = Math.ceil(fromHour / TICK_HOURS) - 1; tick >= Math.ceil((fromHour + hours) / TICK_HOURS); tick -= 1) {
      ticks.push(tick)
    }
  }
  for (const tick of ticks) {
    architecture.clock += TICK_HOURS
    const tickOfDay = ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY
    if (tickOfDay === 0 && hours > 0) {
      simulation.days += 1
    }
    const sun = sunAt(tickOfDay * TICK_HOURS, noonElevation)
    if (growing && sun.daylight > 0 && architecture.count < MAX_VOXELS) {
      simulation.budget = Math.min(
        MAX_BUDGET,
        simulation.budget + TICK_HOURS * GROWTH_RATE * growthRate * sun.daylight * Math.max(0, sun.direction[1]),
      )
      if (simulation.budget > 0) {
        const solid = architectureSolid(architecture)
        const spent = growArchitecture(
          architecture,
          Math.min(simulation.budget, MAX_VOXELS - architecture.count),
          sun.direction,
          (x, y, z) => sunVisible(x, y, z, sun.direction, base.ground, solid),
          simulation.random,
        )
        simulation.budget -= spent
        reshaped ||= spent > 0
        simulation.stale ||= spent > 0
      }
    }
    if (decaying) {
      simulation.decayBudget += TICK_HOURS * DECAY_RATE * decayRate * architecture.count
      if (simulation.decayBudget >= DECAY_STEP) {
        const removed = weatherArchitecture(architecture, simulation.decayBudget, simulation.random)
        simulation.decayBudget -= removed
        simulation.weathered += removed
        reshaped ||= removed > 0
        simulation.stale ||= removed > 0
      }
    }
    if (tickOfDay === SUNSET_HOUR / TICK_HOURS) {
      if (!deferEcology) {
        refreshed = passSunset(simulation, noonElevation, rule, hours > 0) || refreshed
      } else if (hours > 0) {
        rememberDay(simulation, noonElevation)
      }
    }
  }
  if (reshaped) {
    simulation.geometry = createArchitectureGeometry(architecture)
  }
  return reshaped || refreshed
}

/**
 * Runs whole days forward as `advanceSimulation` would, tick for tick, but
 * rebuilds habitat, paths and vegetation only once `finish` is true (the last
 * slice of a jump). Slicing a jump does not change its outcome.
 */
export function fastForward(
  simulation: Simulation,
  fromHour: number,
  days: number,
  noonElevation: number,
  rule: HabitatRule,
  processes: Processes,
  finish: boolean,
) {
  advanceSimulation(simulation, fromHour, days * 24, noonElevation, rule, processes, true)
  if (!finish) {
    return
  }
  const insolation =
    simulation.stale || simulation.ecology.noonElevation !== noonElevation
      ? traceSunlight(simulation.base, simulation.architecture, noonElevation)
      : simulation.ecology.insolation
  simulation.ecology = computeEcology(simulation, noonElevation, rule, insolation)
  simulation.stale = false
  setHabitatBefore(simulation.base, simulation.ecology.habitat)
}
