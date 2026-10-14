import { clamp01, random, type Rng } from './core.ts'

/**
 * Shadow Ecology 0.2 — weather. Rain, fog and wind are independent
 * conditions that can overlap; each eases in and out over a few hours, and
 * spells accumulate: a long dry spell keeps drying the ground after the
 * sky clears, a wet spell keeps the lakes high.
 *
 *   rain  → wetness, moisture, higher water, faster weathering, creatures shelter
 *   fog   → depth haze, shorter sight for creatures, flyers stay low, softer light
 *   wind  → the prevailing wind blows (wind.ts shapes it over terrain and architecture)
 *   long spells without rain dry the ground (drought), faster in wind
 *
 * The seeded cycle flips each condition on its own timer, so the sky may
 * hold none, one, two or now and then all three. It keeps running
 * underneath manual control: setting a condition by hand, or clearing them
 * all, turns AUTO off; choosing AUTO again drops the manual choice and the
 * sky takes up whatever the cycle holds at that moment.
 */
export type Condition = 'rain' | 'fog' | 'wind'
export const CONDITIONS: readonly Condition[] = ['rain', 'fog', 'wind']
/** What the history records: a condition beginning, or the sky clearing. */
export type WeatherKind = 'clear' | Condition

export type Weather = {
  /** The automatic cycle runs; false while conditions are set by hand. */
  auto: boolean
  /** Unused since manual choices hold until AUTO; kept for saved worlds. */
  forced: number
  /** Conditions in force now: the cycle's under AUTO, otherwise the manual choice. None is a clear sky. */
  on: Record<Condition, boolean>
  /** What the seeded cycle holds, running even while conditions are set by hand. */
  cycle: Record<Condition, boolean>
  /** Hours until the cycle next flips each condition. */
  timers: Record<Condition, number>
  /** Heading (radians) and strength the cycle's current or last wind blows with. */
  cycleWind: { aim: number; power: number }
  rain: number
  fog: number
  /** How far the wind has blown up, 0…1. */
  wind: number
  drought: number
  /** Long-running balance: +1 after a long wet spell, −1 after a long dry one. */
  spell: number
  /** Hours since rain last fell. */
  held: number
  /** Prevailing wind heading (radians, toward +x at 0, +z at π/2), and where it is turning to. */
  windDir: number
  windAim: number
  /** Strength of the wind when it blows, 0…1. */
  windPower: number
  /** How thick fog is when it lies, 0…1. */
  fogDensity: number
}

const EASE_HOURS = { rain: 1.5, fog: 2, wind: 1.5, drought: 8, turn: 3 } as const
/** Hours without rain after which the ground starts to dry out (sooner in wind). */
const DRY_AFTER = 30
const SPELL_HOURS = 30
/** Automatic cycle: how long each condition lasts once on, and stays away once off (hours). */
const CYCLE: Record<Condition, { on: [number, number]; off: [number, number] }> = {
  rain: { on: [5, 12], off: [20, 44] },
  fog: { on: [4, 9], off: [22, 52] },
  wind: { on: [6, 14], off: [14, 34] },
}
/** The prevailing heading every world's wind swings around. */
const PREVAILING = 0.6
export const FOG_DENSITY = 0.25

export function createWeather(): Weather {
  return {
    auto: true,
    forced: 0,
    on: { rain: false, fog: false, wind: false },
    cycle: { rain: false, fog: false, wind: false },
    timers: { rain: 20, fog: 30, wind: 10 },
    cycleWind: { aim: PREVAILING, power: 0.7 },
    rain: 0,
    fog: 0,
    wind: 0,
    drought: 0,
    spell: 0,
    held: 0,
    windDir: PREVAILING,
    windAim: PREVAILING,
    windPower: 0.7,
    fogDensity: FOG_DENSITY,
  }
}

/** Fills in what worlds saved before combinable weather lack. */
export function upgradeWeather(w: Weather) {
  if (!w.on) {
    const target = (w as { target?: string }).target
    w.on = { rain: target === 'rain', fog: target === 'fog', wind: target === 'wind' }
  }
  w.cycle ??= { ...w.on }
  w.timers ??= { rain: 20, fog: 30, wind: 10 }
  w.wind ??= 0
  w.windDir ??= PREVAILING
  w.windAim ??= w.windDir
  w.windPower ??= 0.7
  w.cycleWind ??= { aim: w.windAim, power: w.windPower }
  w.fogDensity ??= FOG_DENSITY
}

const spellHours = (rng: Rng, [lo, hi]: [number, number]) => lo + random(rng) * (hi - lo)

/** Flips a condition in the cycle; under AUTO a wind that rises picks its heading and strength. */
function flip(weather: Weather, c: Condition, rng: Rng) {
  const on = !weather.cycle[c]
  weather.cycle[c] = on
  weather.timers[c] = spellHours(rng, CYCLE[c][on ? 'on' : 'off'])
  if (c === 'wind' && on) {
    weather.cycleWind = { aim: PREVAILING + (random(rng) - 0.5) * 2.2, power: 0.55 + 0.45 * random(rng) }
    if (weather.auto) followCycleWind(weather)
  }
}

function followCycleWind(weather: Weather) {
  weather.windAim = weather.cycleWind.aim
  weather.windPower = weather.cycleWind.power
}

const ease = (value: number, target: number, hours: number, span: number) =>
  value + (target - value) * (1 - Math.exp(-hours / span))

/** Shortest signed turn from heading a to heading b. */
const turn = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a))

const anyOn = (w: Weather) => w.on.rain || w.on.fog || w.on.wind

/** Advances the weather; returns what began (conditions, or 'clear' when the last one ended). */
export function stepWeather(weather: Weather, hours: number, rng: Rng): WeatherKind[] {
  upgradeWeather(weather)
  const began: WeatherKind[] = []
  for (const c of CONDITIONS) {
    weather.timers[c] -= hours
    if (weather.timers[c] <= 0) flip(weather, c, rng)
  }
  if (weather.auto) {
    const before = anyOn(weather)
    for (const c of CONDITIONS) {
      if (weather.cycle[c] && !weather.on[c]) began.push(c)
      weather.on[c] = weather.cycle[c]
    }
    if (before && !anyOn(weather)) began.push('clear')
  }
  const { on } = weather
  weather.held = on.rain ? 0 : weather.held + hours
  weather.rain = ease(weather.rain, on.rain ? 1 : 0, hours, EASE_HOURS.rain)
  weather.fog = ease(weather.fog, on.fog ? 1 : 0, hours, EASE_HOURS.fog)
  weather.wind = ease(weather.wind, on.wind ? 1 : 0, hours, EASE_HOURS.wind)
  const dry = weather.held > DRY_AFTER * (on.wind ? 0.6 : 1) ? 0.7 : 0
  weather.drought = ease(weather.drought, dry, hours, EASE_HOURS.drought)
  weather.windDir += turn(weather.windDir, weather.windAim) * (1 - Math.exp(-hours / EASE_HOURS.turn))
  const push = weather.rain - weather.drought
  weather.spell = Math.max(-1, Math.min(1, weather.spell + (push - weather.spell * 0.15) * (hours / SPELL_HOURS)))
  return began
}

/**
 * AUTO on drops the manual choice: the conditions jump at once to what the
 * cycle holds now. Returns the conditions that began, for the history.
 */
export function setAuto(weather: Weather, auto: boolean): WeatherKind[] {
  upgradeWeather(weather)
  if (weather.auto === auto) return []
  weather.auto = auto
  if (!auto) return []
  followCycleWind(weather)
  const began: WeatherKind[] = []
  for (const c of CONDITIONS) {
    if (weather.cycle[c] && !weather.on[c]) began.push(c)
    weather.on[c] = weather.cycle[c]
    weather[c] = weather.cycle[c] ? 1 : 0
  }
  return began
}

/**
 * Sets one condition by hand: AUTO turns off and the change shows at once.
 * Returns the condition if it began, for the history.
 */
export function setCondition(weather: Weather, c: Condition, on: boolean): Condition | null {
  upgradeWeather(weather)
  weather.auto = false
  weather.forced = 0
  const began = on && !weather.on[c]
  weather.on[c] = on
  weather[c] = on ? 1 : 0
  return began ? c : null
}

/** Clear: AUTO off, rain, fog and wind gone at once. Returns 'clear' if anything was on. */
export function clearWeather(weather: Weather): 'clear' | null {
  upgradeWeather(weather)
  const was = anyOn(weather)
  weather.auto = false
  for (const c of CONDITIONS) {
    weather.on[c] = false
    weather[c] = 0
  }
  return was ? 'clear' : null
}

/** A manual wind: heading (radians) and strength 0…1, applied at once. */
export function setWind(weather: Weather, heading: number, strength: number) {
  upgradeWeather(weather)
  weather.windDir = heading
  weather.windAim = heading
  weather.windPower = clamp01(strength)
}

export function setFogDensity(weather: Weather, density: number) {
  upgradeWeather(weather)
  weather.fogDensity = clamp01(density)
}

/** Prevailing wind speed 0…1 before terrain and architecture shape it: still air unless the wind blows. */
export const windSpeed = (w: Weather) => clamp01((w.wind ?? 0) * (w.windPower ?? 0.7) * (1 + 0.15 * w.rain))

/** Share of direct sun reaching the ground: clouds in rain, haze in fog. */
export const weatherLight = (w: Weather) => clamp01(1 - 0.55 * w.rain - 0.4 * w.fog)

/** Creatures' sight as a share of clear-day range. */
export const visibility = (w: Weather) => clamp01(1 - 0.6 * w.fog - 0.25 * w.rain)

export function weatherLabel(w: Weather): string {
  const now = (
    [
      ['Rain', w.rain],
      ['Fog', w.fog],
      ['Wind', w.wind ?? 0],
    ] as const
  )
    .filter(([, v]) => v > 0.3)
    .map(([name]) => name)
  return now.length ? now.join(' + ') : 'Clear'
}
