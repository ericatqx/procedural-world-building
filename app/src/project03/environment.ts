import { sunAt } from '../project/sun.ts'
import { sunDirection } from '../shared/sun.ts'
import { clamp01, smoothstep } from '../project02/core.ts'
import { LIFECYCLE, OBSERVATION_START, worldYears } from './livingTime.ts'
import { landscapeHeight } from './terrain.ts'

/**
 * Shadow Ecology 0.3 — the environment: a day-based clock, the sun, the sky's weather and the wind, as one shared state.
 *
 * `controls` is what the simulation clock, the seed's weather timeline or the person has set; `state` is what every
 * system reads. State follows the controls smoothly, so a change of weather or wind is a transition, never a jump.
 * Nothing here draws anything: rendering (lights, haze, rain, water) and, later, vegetation and Living Architecture
 * read the same numbers, so sunlight, shade, humidity and wind mean the same thing everywhere.
 *
 * Years. Living Architecture lives on a longer clock (livingTime.ts): the world's year, which the day and the hour do
 * not change (the sun and the weather repeat each year, as they did before there were years). Grow plays the years
 * (to the reference year, or past it to the horizon); the year can also be set by hand, before or after it.
 *
 * Time. The world starts on Day 1 at 15:30. While playing, the clock advances at the chosen speed and drives both
 * the sun and the weather; the weather is a deterministic timeline of the seed over many days, so the same seed
 * always has the same weather at the same day and time. Anything done by hand (the time slider, a weather
 * condition, a customization) pauses the clock where it stands, and a weather combination chosen by hand holds
 * until Play, or a change of day, hands the weather back to the timeline.
 *
 * Weather. Overcast, rain, mist and wind are independent conditions that combine; each has one adjustment.
 * `Clear` is not a condition: it is the reset that turns all of them off.
 *
 * It is a module-level singleton because there is one world on screen.
 */
export type Condition = 'overcast' | 'rain' | 'mist' | 'wind'
export const CONDITIONS: readonly { value: Condition; label: string }[] = [
  { value: 'overcast', label: 'Overcast' },
  { value: 'rain', label: 'Rain' },
  { value: 'mist', label: 'Mist' },
  { value: 'wind', label: 'Wind' },
]

/** Simulation speeds, as multiples of the base pace (1×: one minute of world time per second; 60×: an hour per second). */
export const SPEEDS = [1, 5, 20, 60] as const
export type Speed = (typeof SPEEDS)[number]
/**
 * World Time has two modes over one clock. Daily Cycle: the time of day (the sun, the weather) runs or is set; the world year
 * barely moves (a day is 1/365 of a year). Evolution: the world year runs or is set (0 to the horizon), at the chosen number of
 * years per second (years, or decades a second); the sun and the weather hold the day and hour shown.
 */
export const TIME_SCALES = ['daily', 'evolution'] as const
export type TimeScale = (typeof TIME_SCALES)[number]
export const YEAR_SPEEDS = [2, 8, 20, 50] as const
const HOURS_PER_SECOND = 1 / 60

export type EnvironmentControls = {
  /** The world's year, for Living Architecture's lifecycle (fractional while the years play). */
  year: number
  /** What Play advances: the clock (days), or the years (years, decades). */
  scale: TimeScale
  /** Years per second while the years play. */
  yearSpeed: number
  /** Day 1, 2, 3… of the simulation. */
  day: number
  /** Hour of the day, 0–24. Sunrise is 06:00, noon due south (−Z), sunset 18:00. */
  hour: number
  playing: boolean
  speed: Speed
  /** `timeline`: the seed's weather for this day and time. `manual`: the combination chosen by hand holds. */
  weatherMode: 'timeline' | 'manual'
  conditions: Record<Condition, boolean>
  /** Each condition's one adjustment, 0.2–1: cloud cover, rainfall, mist density, wind strength. */
  adjust: Record<Condition, number>
  /** Heading the wind blows toward, in degrees from +X (east) turning toward +Z (south). */
  windDirection: number
  /** Noon sun height in degrees (the stand-in for season, as in 0.1 and 0.2). */
  noonElevation: number
  shadows: boolean
  /** Draw the wind as drifting streaks over the island. A display choice: it does not touch the simulation. */
  windField: boolean
}

export type EnvironmentState = {
  /** Sunlight: direction toward the sun, height above the horizon in degrees, 0 at night to 1 at full day, and the light that reaches the ground after cloud (0–1). */
  sun: { direction: [number, number, number]; elevation: number; daylight: number; direct: number }
  /** Sky: cloud cover 0–1, rain intensity 0–1 (precipitation), mist 0–1. */
  cloud: number
  rain: number
  mist: number
  /** Air and ground moisture, 0–1: rises with cloud, mist and rain. For vegetation and weathering later. */
  humidity: number
  /** The land's water, from the rain it has had (see `Hydrology`): soil moisture, river discharge and lake level, each 0–1 but the lake, in meters above normal. */
  hydro: Hydrology
  /** What the views draw, eased from `hydro`: river flow factor (0.15 dry to 1 in spate), and meters the lakes stand above normal. */
  flow: number
  lakeRise: number
  /** Exposure the sky asks of the renderer: a little dimmer under cloud and rain. */
  exposure: number
  /** Wind now: unit heading, speed in m/s at open ground, and the gust factor (around 1). */
  wind: { x: number; z: number; speed: number; gust: number }
  /** Wind's integrated push in meters, for surfaces that should drift with it (water). */
  windPhase: { x: number; z: number }
  /** Real seconds since the environment began, for animation. It keeps running while the simulation is paused. */
  time: number
}

/** Haze distances are scaled by these (1 = full haze; large = none, as in Clear weather), set each frame; the camera rig applies them to its own fog. */
export const fogScale = { near: 1, far: 1 }
/** How much the ground darkens when wet (0–1), for materials that want it. */
export const wetness = { value: 0 }
/** Shared by every 0.3 material that takes the mist (see mist.ts): how thick it lies, 0–1. */
export const mistUniform = { value: 0 }
/** How lit open water and falling water are by the sky, 0.1 (night) to 1 (day), set each frame. */
export const skyLit = { value: 1 }

/** Wind at strength 1, in m/s (a stiff breeze on open ground; this only scales motion). */
const WIND_MAX = 16

export const environment: { controls: EnvironmentControls; state: EnvironmentState; seed: number } = {
  seed: 0,
  controls: {
    year: OBSERVATION_START,
    scale: 'daily',
    yearSpeed: 8,
    day: 1,
    hour: 15.5,
    playing: false,
    speed: 5,
    weatherMode: 'timeline',
    conditions: { overcast: false, rain: false, mist: false, wind: false },
    adjust: { overcast: 0.85, rain: 0.5, mist: 0.7, wind: 0.6 },
    windDirection: 35,
    noonElevation: 55,
    shadows: true,
    windField: false,
  },
  state: {
    sun: { direction: [0, 1, 0], elevation: 45, daylight: 1, direct: 1 },
    cloud: 0.04,
    rain: 0,
    mist: 0.02,
    humidity: 0.3,
    hydro: { soil: 0.2, discharge: 0.15, lake: 0 },
    flow: 0.15,
    lakeRise: 0,
    exposure: 1.05,
    wind: { x: 1, z: 0, speed: 3, gust: 1 },
    windPhase: { x: 0, z: 0 },
    time: 0,
  },
}

/** A stable value in [0, 1) from a seed and a block number. */
function hash01(seed: number, block: number, salt: number): number {
  let h = (seed ^ Math.imul(block + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) | 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** The wind heading (degrees from +X toward +Z) the seed favours: what the timeline swings around, and what anything built to last should be built for. */
export const prevailingWind = (seed: number) => hash01(seed, 0, 77) * 360

/** Smooth value noise in [0, 1): a slowly wandering number for each seed and salt. */
function wander(seed: number, salt: number, x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return hash01(seed, i, salt) * (1 - u) + hash01(seed, i + 1, salt) * u
}

/** How often each condition comes round (hours per swing) and how high its noise must rise to be on. */
const TIMELINE: Record<Condition, { period: number; threshold: number; salt: number }> = {
  overcast: { period: 22, threshold: 0.58, salt: 11 },
  rain: { period: 14, threshold: 0.7, salt: 23 },
  mist: { period: 16, threshold: 0.64, salt: 37 },
  wind: { period: 18, threshold: 0.6, salt: 41 },
}

/**
 * The weather the seed holds at an absolute number of hours since Day 1, 00:00: which conditions are on, how strongly,
 * and which way the wind blows. A pure function of the seed and the time, so every day is the same every time it is
 * visited, and neighbouring hours are alike: each condition swings on its own slow cycle, so spells last many hours
 * and overlap (rain brings its own cloud; mist favours the early morning). The first day opens fair.
 */
export function timelineAt(seed: number, hours: number): { conditions: Record<Condition, boolean>; adjust: Record<Condition, number>; windDirection: number } {
  const calm = smoothstep(18, 44, hours)
  const hour = ((hours % 24) + 24) % 24
  const conditions = { overcast: false, rain: false, mist: false, wind: false }
  const adjust = { overcast: 0.85, rain: 0.5, mist: 0.7, wind: 0.6 }
  for (const { value } of CONDITIONS) {
    const spec = TIMELINE[value]
    let v = wander(seed, spec.salt, hours / spec.period)
    if (value === 'mist') v += 0.18 * Math.max(0, Math.cos((2 * Math.PI * (hour - 6)) / 24))
    v *= calm
    if (v > spec.threshold) {
      conditions[value] = true
      adjust[value] = 0.2 + 0.8 * smoothstep(spec.threshold, spec.threshold + 0.25, v)
    }
  }
  if (conditions.rain && !conditions.overcast) {
    conditions.overcast = true
    adjust.overcast = 0.8
  }
  const windDirection = (((hash01(seed, 0, 77) * 360 + 55 * Math.sin(hours / 9)) % 360) + 360) % 360
  return { conditions, adjust, windDirection }
}

/** Restarts the environment for a seed: Day 1, 15:30, paused, the weather the seed holds then. */
export function resetEnvironment(seed: number) {
  const { controls, state } = environment
  environment.seed = seed
  state.time = 0
  state.windPhase.x = 0
  state.windPhase.z = 0
  hydroClock.at = Number.NaN
  hydroClock.carry = 0
  state.hydro = { ...HYDRO_START }
  state.flow = HYDRO_START.discharge
  state.lakeRise = 0
  controls.year = OBSERVATION_START
  controls.scale = 'daily'
  controls.yearSpeed = 8
  controls.day = 1
  controls.hour = 15.5
  controls.playing = false
  controls.weatherMode = 'timeline'
  applyTimeline()
}

/** Hours since Day 1, 00:00. */
export const simHours = () => (environment.controls.day - 1) * 24 + environment.controls.hour

/** World time in years, for Living Architecture (the year, with the day and hour as a fraction of it). */
export const worldTime = () => worldYears(environment.controls.year, simHours())

/** A year set by hand (0 to the horizon): the clock pauses. The day, the hour and the weather stay. */
export function setYear(year: number) {
  const { controls } = environment
  controls.playing = false
  controls.year = Math.min(LIFECYCLE.horizon, Math.max(0, year))
}

/** Changes what Play advances (the day's clock or the world year); it goes on playing if it was. */
export function setTimeScale(scale: TimeScale) {
  const { controls } = environment
  controls.scale = scale
}

export function setYearSpeed(yearsPerSecond: number) {
  environment.controls.yearSpeed = yearsPerSecond
}

/** Back to where observation began: Day 1 at 15:30 of the opening year, paused, with the seed's weather for it. */
export function restartObservation() {
  const { controls } = environment
  controls.playing = false
  controls.year = OBSERVATION_START
  controls.day = 1
  controls.hour = 15.5
  controls.weatherMode = 'timeline'
  hydroClock.at = Number.NaN
  applyTimeline()
}

/** Puts the seed's weather for this day and time into the controls, so the panel shows exactly what the sky is doing. */
function applyTimeline() {
  const { controls, seed } = environment
  const t = timelineAt(seed, simHours())
  controls.conditions = t.conditions
  controls.adjust = t.adjust
  controls.windDirection = t.windDirection
}

/** Play hands the weather back to the timeline from the day and time now selected; Pause freezes the clock where it is. */
export function setPlaying(playing: boolean) {
  const { controls } = environment
  controls.playing = playing
  // Playing the years from the last year begins again where observation began.
  if (playing && controls.scale === 'evolution' && controls.year >= LIFECYCLE.horizon) controls.year = OBSERVATION_START
  if (playing) {
    controls.weatherMode = 'timeline'
    hydroClock.at = Number.NaN
    applyTimeline()
  }
}

export function setSpeed(speed: Speed) {
  environment.controls.speed = speed
}

/** Moving the time by hand pauses the clock; the day stays, and the weather is the timeline's for the new time unless set by hand. */
export function setHour(hour: number) {
  const { controls } = environment
  controls.playing = false
  controls.hour = Math.min(23.999, Math.max(0, hour))
  if (controls.weatherMode === 'timeline') applyTimeline()
}

/** Previous or next day (never before Day 1): the same time of day, and the weather the timeline holds then. */
export function setDay(day: number) {
  const { controls } = environment
  controls.day = Math.max(1, Math.round(day))
  controls.weatherMode = 'timeline'
  hydroClock.at = Number.NaN
  applyTimeline()
}

/** A weather change by hand: the clock pauses where it stands, and this combination holds. */
function manual() {
  const { controls } = environment
  controls.playing = false
  controls.weatherMode = 'manual'
}

export function toggleCondition(condition: Condition) {
  manual()
  environment.controls.conditions[condition] = !environment.controls.conditions[condition]
}

/** Clear is a reset, not a condition: every condition off. */
export function clearWeather() {
  manual()
  const { conditions } = environment.controls
  conditions.overcast = conditions.rain = conditions.mist = conditions.wind = false
}

export function setAdjust(condition: Condition, value: number) {
  manual()
  environment.controls.adjust[condition] = Math.min(1, Math.max(0.2, value))
}

export function setWindDirection(degrees: number) {
  manual()
  environment.controls.windDirection = degrees
}

/**
 * Hydrology: rain becomes soil moisture, then runoff, then river flow and lake level, and all of it recedes when the rain stops.
 * Three stores with their own pace, stepped in half-hour chunks of world time:
 *   soil       wets with rain (the wetter, the slower) and dries by drainage and evaporation (faster in sun and dry air);
 *   discharge  the rivers' flow: groundwater from the soil, plus the runoff that rain on wet ground sheds. Rises in hours, falls in about nine;
 *   lake       the lakes' rise in meters, following discharge slowly (about eight hours up, a day down).
 * A lumped model on purpose: it does not move water over the terrain; the views read it and draw their own response
 * (wet ground, quicker and fuller rivers, higher lakes), and the drainage network the world already has stays as it is.
 *
 * Under the seed's timeline it is a pure function of the seed and the time: the state at any moment is the chunks stepped
 * from four days earlier on the timeline's own rain, so playback at any speed, a jump to another day, or a drag of the
 * slider all arrive at the same numbers. Weather set by hand has no timeline to replay: the stores step in real time
 * (a world-hour every four seconds) for as long as the weather holds, and Play or a day change replays the timeline.
 */
export type Hydrology = { soil: number; discharge: number; lake: number }
const HYDRO_START: Hydrology = { soil: 0.2, discharge: 0.15, lake: 0 }
const CHUNK = 0.5
const MEMORY_HOURS = 96
/** World hours that pass per real second while the weather is set by hand. */
const MANUAL_HOURS_PER_SECOND = 0.25
const LAKE_MAX = 2.2

function hydroStep(h: Hydrology, rain: number, daylight: number, humidity: number) {
  h.soil = clamp01(h.soil + CHUNK * (0.28 * rain * (1 - h.soil) - h.soil * (0.008 + 0.02 * daylight * (1 - humidity))))
  const runoff = rain * smoothstep(0.3, 0.85, h.soil)
  const flow = clamp01(0.12 + 0.25 * Math.max(0, h.soil - 0.2) + 0.9 * runoff)
  h.discharge += (flow - h.discharge) * (1 - Math.exp(-CHUNK / (flow > h.discharge ? 2.5 : 9)))
  const lake = LAKE_MAX * clamp01((h.discharge - 0.12) / 0.8)
  h.lake += (lake - h.lake) * (1 - Math.exp(-CHUNK / (lake > h.lake ? 8 : 24)))
}

/** The rain, humidity and daylight the seed's timeline gives at a moment, for stepping the hydrology. */
function timelineForcing(seed: number, hours: number) {
  const t = timelineAt(seed, hours)
  const rain = t.conditions.rain ? t.adjust.rain : 0
  const humidity = t.conditions.rain ? 0.85 : t.conditions.mist ? 0.8 : t.conditions.overcast ? 0.6 : 0.3
  const daylight = sunAt((((hours % 24) + 24) % 24), environment.controls.noonElevation).daylight
  return { rain, humidity: t.conditions.overcast || t.conditions.rain ? Math.max(humidity, 0.6) : humidity, daylight }
}

/** The hydrology the timeline holds at `hours`, replayed from four days before (or from the start). Deterministic. */
export function hydrologyAt(seed: number, hours: number): Hydrology {
  const target = Math.floor(hours / CHUNK) * CHUNK
  const h = { ...HYDRO_START }
  for (let t = Math.max(0, Math.floor((target - MEMORY_HOURS) / CHUNK) * CHUNK); t < target; t += CHUNK) {
    const f = timelineForcing(seed, t + CHUNK / 2)
    hydroStep(h, f.rain, f.daylight, f.humidity)
  }
  return h
}

/** Where the hydrology has been brought to: the aligned time it holds for under the timeline, and the real-time remainder under manual weather. */
const hydroClock = { at: Number.NaN, carry: 0 }

/** Brings the hydrology up to date with the clock and the weather. Called once per frame. */
function stepHydrology(dt: number, manualRain: number, manualHumidity: number) {
  const { controls, state, seed } = environment
  const target = Math.floor(simHours() / CHUNK) * CHUNK
  if (controls.weatherMode === 'timeline') {
    hydroClock.carry = 0
    if (Number.isNaN(hydroClock.at) || target < hydroClock.at || target - hydroClock.at > 120) {
      // A jump (a day, the slider, Play after weather by hand): arrive at what the timeline holds.
      state.hydro = hydrologyAt(seed, target)
      hydroClock.at = target
    } else {
      // Playback: step the chunks the clock has crossed, on the timeline's own rain, so it matches a replay exactly.
      while (hydroClock.at < target) {
        const f = timelineForcing(seed, hydroClock.at + CHUNK / 2)
        hydroStep(state.hydro, f.rain, f.daylight, f.humidity)
        hydroClock.at += CHUNK
      }
    }
  } else {
    // Weather by hand: the clock is paused, but the water keeps going at its own pace while the weather holds.
    hydroClock.at = Number.NaN
    hydroClock.carry += dt * MANUAL_HOURS_PER_SECOND
    while (hydroClock.carry >= CHUNK) {
      hydroStep(state.hydro, manualRain, state.sun.daylight, manualHumidity)
      hydroClock.carry -= CHUNK
    }
  }
}

const approach = (value: number, target: number, rate: number) => value + (target - value) * rate

/** The lowest the sunlight's direction goes (degrees): below it the light only fades (see where the sun is set, below). */
const SUNSET_LIGHT = 6

/** What the active conditions ask of the sky: each adds to a shared cloud, rain, mist and humidity, taking the strongest where they overlap. */
function skyFor(controls: EnvironmentControls) {
  const { conditions: c, adjust: a } = controls
  let cloud = 0.04
  let rain = 0
  let mist = 0.02
  let humidity = 0.3
  if (c.overcast) {
    // (Round 09: a light overcast was already 0.4 of full cloud, enough to take half the cast shadows and blur the rest, so a hazy day read as a
    // day without shadows. Now it rises from 0.15: thin cloud keeps the shadows, a heavy one still takes them, as before.)
    cloud = 0.15 + 0.85 * a.overcast
    mist += 0.04
    humidity = Math.max(humidity, 0.5 + 0.2 * a.overcast)
  }
  if (c.rain) {
    cloud = Math.max(cloud, 0.75 + 0.25 * a.rain)
    rain = a.rain
    mist += 0.06 + 0.06 * a.rain
    humidity = Math.max(humidity, 0.7 + 0.28 * a.rain)
  }
  if (c.mist) {
    cloud = Math.max(cloud, 0.2)
    mist = Math.max(mist, a.mist)
    humidity = Math.max(humidity, 0.6 + 0.35 * a.mist)
  }
  if (c.wind) cloud = Math.max(cloud, 0.12)
  // The wind: the Wind condition's own strength, or what the other weather brings with it.
  const wind = c.wind ? a.wind : c.rain ? 0.3 : c.mist ? 0.08 : 0.2
  return { cloud, rain, mist: Math.min(1, mist), humidity, wind, exposure: 1.05 - 0.1 * cloud }
}

/** Advances the environment by `dt` real seconds. Called once per frame. */
export function stepEnvironment(dt: number) {
  const { controls, state, seed } = environment
  dt = Math.min(dt, 0.1)
  state.time += dt
  if (controls.playing) {
    if (controls.scale === 'daily') {
      controls.hour += dt * controls.speed * HOURS_PER_SECOND
      while (controls.hour >= 24) {
        controls.hour -= 24
        controls.day += 1
      }
    } else {
      controls.year += dt * controls.yearSpeed
      if (controls.year >= LIFECYCLE.horizon) {
        controls.year = LIFECYCLE.horizon
        controls.playing = false
      }
    }
  }
  if (controls.weatherMode === 'timeline') {
    const t = timelineAt(seed, simHours())
    controls.conditions = t.conditions
    controls.adjust = t.adjust
    controls.windDirection = t.windDirection
  }
  // Quick when the weather is set by hand or the clock is still, a little slower while time runs.
  const rate = 1 - Math.exp(-dt / (controls.playing ? 1.5 : 0.7))
  const target = skyFor(controls)
  state.cloud = approach(state.cloud, target.cloud, rate)
  state.rain = approach(state.rain, target.rain, rate)
  state.mist = approach(state.mist, target.mist, rate)
  state.humidity = approach(state.humidity, target.humidity, rate)
  state.exposure = approach(state.exposure, target.exposure, rate)

  const sun = sunAt(controls.hour, controls.noonElevation)
  const daylight = sun.daylight
  // Round 09: the light's direction stops lowering at SUNSET_LIGHT degrees; its strength still fades with the true elevation (daylight, and the
  // stage's own fade of the sun's share). Lower than that, level ground turned from the sun all at once (every face under the lit threshold),
  // so the cast shadows vanished into one shade while the land stayed bright. Now they keep their shape and fade out with the light.
  state.sun.direction = sun.elevation >= SUNSET_LIGHT ? sun.direction : sunDirection(sun.azimuth, SUNSET_LIGHT)
  state.sun.elevation = sun.elevation
  state.sun.daylight = daylight
  state.sun.direct = daylight * (1 - 0.8 * state.cloud) * (1 - 0.35 * state.mist)

  // Wind: the heading eases to the setting, the strength to the weather's, and gusts roll through slowly.
  const heading = (controls.windDirection * Math.PI) / 180
  const wx = approach(state.wind.x, Math.cos(heading), rate)
  const wz = approach(state.wind.z, Math.sin(heading), rate)
  const length = Math.hypot(wx, wz) || 1
  state.wind.x = wx / length
  state.wind.z = wz / length
  state.wind.speed = approach(state.wind.speed, clamp01(target.wind) * WIND_MAX, rate)
  state.wind.gust = 1 + 0.28 * Math.sin(state.time * 0.7) * Math.sin(state.time * 0.23 + 1.3)
  const push = state.wind.speed * state.wind.gust * dt * 0.2
  state.windPhase.x += state.wind.x * push
  state.windPhase.z += state.wind.z * push

  // Mist arrives as a low, valley-held haze (mist.ts); the distance fog only draws in a little.
  // Distance fog belongs to the weather: in Clear (and Overcast, Wind) the air is clear at every distance and the terrain keeps its own colour.
  // Mist and rain bring it in, in step with their strength; at full strength it is what it always was. The haze is pushed out by 1/weight.
  const hazy = Math.min(1, state.mist + state.rain)
  const reach = hazy < 0.002 ? 1e4 : 1 / hazy
  fogScale.near = (1 - 0.2 * state.mist - 0.1 * state.rain) * reach
  fogScale.far = (1 - 0.15 * state.mist - 0.15 * state.rain) * reach
  mistUniform.value = state.mist
  skyLit.value = 0.1 + 0.9 * daylight * (1 - 0.25 * state.cloud)
  // The water: the hydrology is stepped on the clock (or, for weather by hand, on real time), and what is drawn eases to it.
  stepHydrology(dt, target.rain, target.humidity)
  const settle = 1 - Math.exp(-dt / 1.2)
  state.flow = approach(state.flow, state.hydro.discharge, settle)
  state.lakeRise = approach(state.lakeRise, state.hydro.lake, settle)
  // Wet ground is the soil's moisture above what is normal, with the rain falling on it; mist leaves it a little damp.
  const soaked = clamp01(((state.hydro.soil - HYDRO_START.soil) / (1 - HYDRO_START.soil)) * 0.9 + state.rain * 0.25 + state.mist * 0.1)
  wetness.value = approach(wetness.value, soaked, 1 - Math.exp(-dt / 1.5))
}

/**
 * Wind at a point of the island, in m/s as (x, z). The open-ground wind, quickened over high ground,
 * slowed in the lee of a ridge to windward, and gusting. Cheap and deterministic: for the vegetation
 * and Living Architecture to read, not a fluid simulation.
 */
export function windAt(x: number, z: number): [number, number] {
  const [bx, bz] = windBaseAt(x, z)
  const { time } = environment.state
  const gust = 1 + 0.28 * Math.sin(time * 0.7 + x * 0.004) * Math.sin(time * 0.23 + z * 0.003 + 1.3)
  return [bx * gust, bz * gust]
}

/** The wind at a point without its gusting: what the terrain does to it. Steady, so it can be tabulated. */
export function windBaseAt(x: number, z: number): [number, number] {
  const { wind } = environment.state
  const here = landscapeHeight(x, z)
  const upwind = landscapeHeight(x - wind.x * 160, z - wind.z * 160)
  const height = 1 + 0.35 * clamp01((here - 60) / 500)
  const lee = 1 - 0.4 * smoothstep(20, 120, upwind - here)
  const speed = wind.speed * height * lee
  return [wind.x * speed, wind.z * speed]
}

export function formatHour(hour: number): string {
  const minutes = Math.round((((hour % 24) + 24) % 24) * 60) % 1440
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
