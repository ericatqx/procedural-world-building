import type { DataTexture } from 'three'
import { byte } from '../project/world.ts'
import { archIndex, architectureSolid, NO_GROUND, type Architecture } from './architecture.ts'
import { clamp01, LATTICE_BASE, LATTICE_X0, LATTICE_Z0, smoothstep } from './core.ts'
import { cellCenter, cellIndex, CELL, GRID_EXTENT, GRID_SIZE, sampleGrid } from './grid.ts'
import { clearOfSolid, daySamples, sunVisible, type Solid, type SunSample } from './light.ts'
import type { Statics } from './statics.ts'
import { windSpeed, type Weather } from './weather.ts'

/**
 * Shadow Ecology 0.2 — the environmental fields every system reads and
 * writes, on 0.1's 144² analysis grid. Following Week 06, distribution is
 * read off these fields rather than placed: light (traced through the
 * architecture), shelter (remembered shade), moisture (hydrology + weather),
 * wear (creature movement), rubble and disturbance (collapse), and the
 * traces they leave when they change.
 */
export type Fields = {
  /** Daily direct sunlight with the architecture as it stands, 1 ≈ open flat ground. */
  insolation: Float32Array
  /** Remembered sunlight: shelter lags shade by about a day and a half. */
  sunMemory: Float32Array
  shelter: Float32Array
  /** Surface water from rain, 0…1. */
  wetness: Float32Array
  /** Memory of being wet: rises over wet days, fades over a couple of weeks; a faint stain. */
  wetStain: Float32Array
  moisture: Float32Array
  /** Ground worn by creatures; peak remembers the most it was ever worn. */
  wear: Float32Array
  wearPeak: Float32Array
  /** Trace: once-worn ground no longer walked. */
  abandoned: Float32Array
  /** Recent upheaval (collapse), fades over a couple of days. */
  disturbance: Float32Array
  /** Fallen architecture lying on the ground, world height. */
  rubble: Float32Array
  /** Plant cover by strategy, and a trace where plants died back. */
  exposureCover: Float32Array
  shelterCover: Float32Array
  deadVegetation: Float32Array
  /** Ground creature habitat, now and at the last sunset. */
  habitat: Float32Array
  habitatBefore: Float32Array
  /** Where flyers have flown, fading. */
  flyway: Float32Array
  /** Architecture standing on the ground here. */
  footprint: Uint8Array
  /** Architecture overhead: roofs that keep rain off. */
  overhead: Float32Array
  /** Height of the architecture's top above the ground. */
  archHeight: Float32Array
  /** Lake level offset from rain and drought. */
  waterOffset: number
  /** The architecture's remembered wetness: soaks in over rain, dries over hours, faster in sun and wind. */
  archDamp: number
  /** Accumulated rain-and-wind exposure since Day 1 (hours × intensity); its mean rate weathers architecture. */
  weatherDose: number
  /** Lost shelter, a trace of collapse: shelter that was and is gone. */
  shelterPeak: Float32Array
  lostShelter: Float32Array
  /** Ground worn by repeated trips between places (paths.ts), 0…1, fading when unused. */
  trail: Float32Array
  /** Trips made so far, the hours toward the next, and the worn path length (world units). */
  trailTrips: number
  trailClock: number
  trailLength: number
}

const COUNT = GRID_SIZE * GRID_SIZE
const MEMORY_HOURS = 36
/** Wet-stain memory: builds over about two wet days, fades over about two weeks. */
const STAIN_RISE_HOURS = 48
const STAIN_FADE_HOURS = 320
const WATER_EDGE = 0.12
/** Rubble a cell keeps for good once it has weathered: a scatter of a few small stones. */
const RUBBLE_TRACE = 0.007
/** Weathering of rubble above the trace, per hour (about four days to half on bare ground). */
const RUBBLE_WEATHER = 0.003

export function createFields(statics: Statics): Fields {
  const f = () => new Float32Array(COUNT)
  const moisture = f()
  moisture.set(statics.base.hydrology.moisture)
  return {
    insolation: f(),
    sunMemory: f(),
    shelter: f(),
    wetness: f(),
    wetStain: f(),
    moisture,
    wear: f(),
    wearPeak: f(),
    abandoned: f(),
    disturbance: f(),
    rubble: f(),
    exposureCover: f(),
    shelterCover: f(),
    deadVegetation: f(),
    habitat: f(),
    habitatBefore: f(),
    flyway: f(),
    footprint: new Uint8Array(COUNT),
    overhead: f(),
    archHeight: f(),
    waterOffset: 0,
    archDamp: 0,
    weatherDose: 0,
    shelterPeak: f(),
    lostShelter: f(),
    trail: f(),
    trailTrips: 0,
    trailClock: 0,
    trailLength: 0,
  }
}

/**
 * Daily sunlight traced a few rows at a time, so the field follows the
 * architecture without a long frame: a pass starts when the structure or the
 * noon height changed, runs over many frames, then replaces the field.
 */
export type LightTrace = {
  next: Float32Array
  traced: Uint8Array
  cursor: number
  samples: SunSample[]
  reference: number
  archVersion: number
  noon: number
  running: boolean
}

export function createLightTrace(): LightTrace {
  return {
    next: new Float32Array(COUNT),
    traced: new Uint8Array(COUNT),
    cursor: 0,
    samples: [],
    reference: 1,
    archVersion: -1,
    noon: -1,
    running: false,
  }
}

const TRACE_CELLS = (GRID_SIZE / 2) * (GRID_SIZE / 2)
const UNKNOWN = 2

/** Whether the terrain alone lets each cell see each sun sample: fixed for a noon height, so worked out once. */
const terrainSight = new WeakMap<Statics, { noon: number; samples: number; seen: Uint8Array }>()

function terrainSightFor(statics: Statics, noon: number, samples: number) {
  let sight = terrainSight.get(statics)
  if (!sight || sight.noon !== noon || sight.samples !== samples) {
    sight = { noon, samples, seen: new Uint8Array(COUNT * samples).fill(UNKNOWN) }
    terrainSight.set(statics, sight)
  }
  return sight.seen
}

function traceCell(statics: Statics, solid: Solid, trace: LightTrace, n: number, seen: Uint8Array) {
  const i = (n % (GRID_SIZE / 2)) * 2
  const j = Math.floor(n / (GRID_SIZE / 2)) * 2
  const index = cellIndex(i, j)
  trace.traced[index] = 1
  if (!statics.inside[index]) return
  const ground = statics.ground
  const [x, z] = cellCenter(index)
  const h = (px: number, pz: number) => sampleGrid(ground.heights, px, pz)
  const y = h(x, z) + 0.02
  if (solid.isSolid(x, y + 0.02, z)) {
    trace.next[index] = 0
    return
  }
  const step = 0.075
  const gx = (h(x + step, z) - h(x - step, z)) / (2 * step)
  const gz = (h(x, z + step) - h(x, z - step)) / (2 * step)
  const length = Math.hypot(gx, 1, gz)
  let sum = 0
  trace.samples.forEach(({ direction, weight }, s) => {
    const facing = (-gx * direction[0] + direction[1] - gz * direction[2]) / length
    if (facing <= 0) return
    const at = index * trace.samples.length + s
    if (seen[at] === UNKNOWN) seen[at] = sunVisible(x, y, z, direction, ground, null) ? 1 : 0
    if (seen[at] && clearOfSolid(x, y, z, direction, solid)) sum += weight * facing
  })
  trace.next[index] = sum / trace.reference
}

function fillUntraced(trace: LightTrace, inside: Uint8Array, out: Float32Array) {
  for (let j = 0; j < GRID_SIZE; j += 1) {
    for (let i = 0; i < GRID_SIZE; i += 1) {
      const index = cellIndex(i, j)
      if (!inside[index]) {
        out[index] = 0
        continue
      }
      if (trace.traced[index] && i % 2 === 0 && j % 2 === 0) {
        out[index] = trace.next[index]!
        continue
      }
      let sum = 0
      let count = 0
      for (let dj = -1; dj <= 1; dj += 1) {
        for (let di = -1; di <= 1; di += 1) {
          const ni = i + di
          const nj = j + dj
          if (ni >= 0 && nj >= 0 && ni < GRID_SIZE && nj < GRID_SIZE && ni % 2 === 0 && nj % 2 === 0) {
            sum += trace.next[cellIndex(ni, nj)]!
            count += 1
          }
        }
      }
      out[index] = count ? sum / count : 0
    }
  }
}

/**
 * Advances the rolling trace by up to `budget` cells. Returns a fresh
 * insolation array when a pass completes (callers swap it in), else null.
 */
export function stepLightTrace(
  trace: LightTrace,
  statics: Statics,
  arch: Architecture,
  noon: number,
  budget: number,
): Float32Array | null {
  if (!trace.running) {
    if (trace.archVersion === arch.version && trace.noon === noon) return null
    trace.samples = daySamples(noon)
    trace.reference = trace.samples.reduce((s, x) => s + x.weight * Math.max(x.direction[1], 0), 0) || 1
    trace.archVersion = arch.version
    trace.noon = noon
    trace.cursor = 0
    trace.traced.fill(0)
    trace.running = true
  }
  const solid = architectureSolid(arch)
  const seen = terrainSightFor(statics, trace.noon, trace.samples.length)
  const end = Math.min(TRACE_CELLS, trace.cursor + budget)
  for (let n = trace.cursor; n < end; n += 1) traceCell(statics, solid, trace, n, seen)
  trace.cursor = end
  if (end < TRACE_CELLS) return null
  trace.running = false
  const out = new Float32Array(COUNT)
  fillUntraced(trace, statics.inside, out)
  return out
}

/** A full trace in one go (start, reset, branch restore). */
export function traceNow(trace: LightTrace, statics: Statics, arch: Architecture, noon: number): Float32Array {
  trace.running = false
  trace.archVersion = -1
  return stepLightTrace(trace, statics, arch, noon, TRACE_CELLS) ?? new Float32Array(COUNT)
}

/** Adds `amount` around (x, z) with a soft falloff of `radius`. */
export function splat(field: Float32Array, x: number, z: number, radius: number, amount: number, max = Infinity) {
  const r = Math.ceil(radius / CELL)
  const ci = Math.floor((x + GRID_EXTENT) / CELL)
  const cj = Math.floor((z + GRID_EXTENT) / CELL)
  for (let dj = -r; dj <= r; dj += 1) {
    for (let di = -r; di <= r; di += 1) {
      const i = ci + di
      const j = cj + dj
      if (i < 0 || j < 0 || i >= GRID_SIZE || j >= GRID_SIZE) continue
      const d = (Math.hypot(di, dj) * CELL) / radius
      if (d > 1) continue
      const index = cellIndex(i, j)
      field[index] = Math.min(max, field[index]! + amount * (1 - d * d))
    }
  }
}

/** Reads the architecture into the grid: footprint, roofs overhead, height of the top. */
export function scanArchitecture(fields: Fields, statics: Statics, arch: Architecture) {
  const { footprint, overhead, archHeight } = fields
  footprint.fill(0)
  overhead.fill(0)
  archHeight.fill(0)
  for (let index = 0; index < COUNT; index += 1) {
    if (!statics.inside[index]) continue
    const [x, z] = cellCenter(index)
    const i = Math.floor((x - LATTICE_X0) / arch.voxel)
    const k = Math.floor((z - LATTICE_Z0) / arch.voxel)
    if (i < 0 || k < 0 || i >= arch.n || k >= arch.n) continue
    if (!arch.occupied[Math.floor(i / arch.chunk) + arch.chunksAcross * Math.floor(k / arch.chunk)]) continue
    const g = arch.groundJ[i + arch.n * k]!
    if (g === NO_GROUND) continue
    let top = -1
    let roof = 0
    for (let j = Math.max(0, g); j < arch.ny; j += 1) {
      if (!arch.solid[archIndex(arch, i, j, k)]) continue
      top = j
      if (g >= 0 && j <= g + 1) footprint[index] = 1
      else roof = 1
    }
    if (top >= 0) {
      const ground = g >= 0 ? g : (statics.groundAt(x, z) - LATTICE_BASE) / arch.voxel
      archHeight[index] = (top + 1 - ground) * arch.voxel
      overhead[index] = footprint[index] ? 0 : roof
    }
  }
}

/** Consumes rubble and collapse events left by the architecture. */
export function depositRubble(fields: Fields, arch: Architecture) {
  const r = arch.rubble
  for (let n = 0; n + 2 < r.length; n += 3) {
    splat(fields.rubble, r[n]!, r[n + 1]!, 0.2, (r[n + 2]! / (CELL * CELL)) * 0.2, 0.25)
  }
  arch.rubble = []
}

/**
 * One step of the environment over `hours`: shelter follows remembered
 * shade, rain wets and drought dries the ground, wear and disturbance fade,
 * and habitat is re-read from all of them.
 */
const flows = new WeakMap<Statics, Float32Array>()

/** How much drainage gathers at each cell, 0…1: fixed by the terrain. */
function flowOf(statics: Statics) {
  let flow = flows.get(statics)
  if (!flow) {
    const { accumulation } = statics.base.hydrology
    flow = new Float32Array(COUNT)
    for (let index = 0; index < COUNT; index += 1) flow[index] = Math.min(1, Math.log1p(accumulation[index]!) / 6)
    flows.set(statics, flow)
  }
  return flow
}

export function updateFields(fields: Fields, statics: Statics, weather: Weather, hours: number, daylight: number) {
  const { hydrology } = statics.base
  const flows = flowOf(statics)
  const memory = 1 - Math.exp(-hours / MEMORY_HOURS)
  const wearFade = Math.exp(-hours / 170)
  const peakFade = Math.exp(-hours / 900)
  const disturbanceFade = Math.exp(-hours / 40)
  const deadFade = Math.exp(-hours / 120)
  const flyFade = Math.exp(-hours / 30)
  const dryness = Math.max(0, -weather.spell)
  const wetSpell = Math.max(0, weather.spell)
  fields.waterOffset += (0.03 * wetSpell + 0.012 * weather.rain - 0.055 * dryness - fields.waterOffset) * (1 - Math.exp(-hours / 6))
  const rainIn = weather.rain * 0.35 * hours
  const breeze = windSpeed(weather)
  fields.wetStain ??= new Float32Array(COUNT)
  const dampSpan = weather.rain > (fields.archDamp ?? 0) ? 1.5 : 10 / (1 + 1.5 * daylight + 2 * breeze)
  fields.archDamp = (fields.archDamp ?? 0) + (weather.rain - (fields.archDamp ?? 0)) * (1 - Math.exp(-hours / dampSpan))
  fields.weatherDose = (fields.weatherDose ?? 0) + (0.05 + 0.6 * weather.rain + 0.4 * breeze) * hours
  const stainUp = 1 - Math.exp(-hours / STAIN_RISE_HOURS)
  const stainDown = 1 - Math.exp(-hours / STAIN_FADE_HOURS)
  for (let index = 0; index < COUNT; index += 1) {
    if (!statics.inside[index]) continue
    const sun = fields.insolation[index]!
    fields.sunMemory[index] = fields.sunMemory[index]! + (sun - fields.sunMemory[index]!) * memory
    const shade = 1 - smoothstep(0.2, 0.85, fields.sunMemory[index]!)
    const shelter = Math.max(shade, 0.55 * fields.shelterCover[index]!, 0.8 * fields.overhead[index]!, 0.6 * statics.enclosure[index]!)
    fields.shelter[index] = shelter
    fields.shelterPeak[index] = Math.max(fields.shelterPeak[index]! * peakFade, shelter)
    fields.lostShelter[index] = Math.max(0, fields.shelterPeak[index]! - shelter - 0.15)

    const flow = flows[index]!
    const roof = fields.overhead[index]!
    // Drying: a slow base rate, faster in sun and in wind, slower under shelter.
    const evaporate = (0.025 + 0.12 * sun * daylight * (1 + weather.drought) + 0.06 * breeze * (1 - 0.6 * statics.enclosure[index]!)) * hours
    let wet = fields.wetness[index]! + rainIn * (0.6 + 0.4 * flow) * (1 - roof)
    wet -= wet * Math.min(1, evaporate * (1 - 0.5 * shelter))
    fields.wetness[index] = clamp01(wet)
    const stain = fields.wetStain[index]!
    fields.wetStain[index] = stain + (wet - stain) * (wet > stain ? stainUp : stainDown)
    const shore = Math.exp(-Math.max(0, hydrology.waterDistance[index]! - fields.waterOffset * 3) / 0.3)
    fields.moisture[index] = clamp01(
      hydrology.moisture[index]! * (1 - 0.5 * dryness - 0.25 * weather.drought) + 0.5 * fields.wetness[index]! + 0.2 * shore * (1 - dryness),
    )

    const wear = fields.wear[index]! * wearFade
    fields.wear[index] = wear
    fields.wearPeak[index] = Math.max(fields.wearPeak[index]! * peakFade, wear)
    fields.abandoned[index] = clamp01((fields.wearPeak[index]! - wear - 0.12) * 2)
    fields.disturbance[index] = fields.disturbance[index]! * disturbanceFade
    fields.deadVegetation[index] = fields.deadVegetation[index]! * deadFade
    fields.flyway[index] = fields.flyway[index]! * flyFade
    // Rubble weathers away over days, faster under plants, down to a small trace that stays.
    const cover = fields.exposureCover[index]! + fields.shelterCover[index]!
    const rubble = fields.rubble[index]!
    if (rubble > RUBBLE_TRACE) {
      fields.rubble[index] = RUBBLE_TRACE + (rubble - RUBBLE_TRACE) * Math.exp(-hours * RUBBLE_WEATHER * (0.6 + cover))
    }

    if (fields.footprint[index] || statics.water[index] || statics.rim[index]! > 0.96) {
      fields.habitat[index] = 0
      continue
    }
    const footing = 1 - smoothstep(20, 40, statics.slope[index]!)
    const calm = 1 - Math.min(1, fields.disturbance[index]! * 1.5)
    fields.habitat[index] = footing * calm * (0.6 * shelter + 0.4 * fields.moisture[index]!) * (0.5 + 0.5 * shelter)
  }
}

/** Writes the fields into the textures the materials read. */
export function writeFieldTextures(
  fields: Fields,
  statics: Statics,
  textures: { field: DataTexture; habitat: DataTexture; state: DataTexture },
) {
  const field = textures.field.image.data as Uint8Array
  const habitat = textures.habitat.image.data as Uint8Array
  const state = textures.state.image.data as Uint8Array
  const { hydrology } = statics.base
  for (let index = 0; index < COUNT; index += 1) {
    const o = index * 4
    field[o] = byte(fields.moisture[index]!)
    field[o + 1] = byte(Math.min(1, (fields.exposureCover[index]! + fields.shelterCover[index]!) * 0.8))
    field[o + 2] = byte(Math.min(1, fields.wear[index]! * 1.6))
    field[o + 3] = byte(Math.exp(-Math.max(0, hydrology.waterDistance[index]! - fields.waterOffset * 2) / WATER_EDGE))
    habitat[o] = byte(fields.habitat[index]!)
    habitat[o + 1] = byte(fields.habitatBefore[index]!)
    habitat[o + 2] = byte((fields.wetStain?.[index] ?? 0) * 2.5)
    habitat[o + 3] = byte(fields.trail?.[index] ?? 0)
    state[o] = byte(fields.wetness[index]!)
    state[o + 1] = byte(fields.rubble[index]! / 0.12)
    state[o + 2] = byte(fields.abandoned[index]!)
    state[o + 3] = byte(Math.max(fields.deadVegetation[index]!, fields.lostShelter[index]! * 0.6))
  }
  textures.field.needsUpdate = true
  textures.habitat.needsUpdate = true
  textures.state.needsUpdate = true
}

export function shareAbove(statics: Statics, field: Float32Array, level: number): number {
  let inside = 0
  let above = 0
  for (let index = 0; index < COUNT; index += 1) {
    if (statics.inside[index] && !statics.water[index]) {
      inside += 1
      if (field[index]! >= level) above += 1
    }
  }
  return inside ? above / inside : 0
}
