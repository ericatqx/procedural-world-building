import { simplex2 } from '../../shared/noise/simplex.ts'
import { mulberry32 } from './distribution.ts'
import { STUDY_HALF, studyHeight, WATER_LEVEL } from './studyTerrain.ts'

/**
 * Week 06 → 03 Fields: an atmospheric vector field over the study terrain,
 * made visible by particles that each answer the same field in their own way.
 *
 *   field      prevailing wind (direction, strength) → turned along rising
 *              ground, faster over the crest and slowed in the lee of higher
 *              ground upwind (terrain response) → plus curl-noise eddies
 *              carried downwind (turbulence)
 *   particles  each relaxes toward a target velocity, the air it sits in
 *              scaled by its influence plus its own fall; its response (drag
 *              over mass) sets how quickly
 *
 * The field is a pure function of position, time and settings, so the same
 * seed and settings give the same field. Particles step at a fixed rate and
 * respawn from a seeded sequence.
 */

export type FieldSettings = {
  /** Compass degrees the wind blows from: 0° north (+z), 90° east (+x). */
  direction: number
  strength: number
  turbulence: number
  /** How strongly the ground steers and shelters the wind, 0…1. */
  terrain: number
  seed: number
}

export const DEFAULT_FIELD_SETTINGS: FieldSettings = { direction: 250, strength: 0.8, turbulence: 0.45, terrain: 0.75, seed: 6 }

export const FIELD_RANGES = {
  direction: { min: 0, max: 355, step: 5 },
  strength: { min: 0, max: 1.5, step: 0.05 },
  turbulence: { min: 0, max: 1, step: 0.05 },
  terrain: { min: 0, max: 1, step: 0.05 },
  seed: { min: 1, max: 999, step: 1 },
} as const

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
export const compassName = (degrees: number) => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16]!

/** Wind speed at strength 1 over open ground, world units per second. */
const WIND_SPEED = 0.9
/**
 * Shelter: the steepest rise of the ground upwind, as rise over distance,
 * looked for up to `reach` away; `from`…`to` maps it to 0…1. Exposure reads
 * this shelter.
 */
const SHELTER = { reach: 1.2, samples: 12, from: 0.1, to: 0.7 } as const
/**
 * The lee the wind feels: the same rise, looked for farther upwind and mapped
 * more steeply. Full lee slows the wind by `slow` at the ground, fading out by
 * `height` above it.
 */
const LEE = { reach: 1.6, samples: 16, from: 0.05, to: 0.42, slow: 0.92, height: 0.9 } as const
/**
 * Wind running into rising ground loses this share of its uphill part on
 * slopes of `slope` and steeper. The slope is read across `span`, so the wind
 * starts turning before it reaches the foot of the rise.
 */
const STEER = { share: 0.96, slope: 0.22, span: 0.22 } as const
/** Speed-up over the high ground, as a share, from elevation `from` (0…1) to the top. */
const CREST = { gain: 0.9, from: 0.3 } as const
/** Speed at the ground as a share of the free wind, reaching full speed `height` above it. */
const PROFILE = { ground: 0.45, height: 0.8 } as const
/** Near the ground the wind rides over it, fading out by this height. */
const FOLLOW = 0.5
/**
 * Eddies: the curl of two octaves of noise, a stream function, so they swirl
 * without sources or sinks. They drift with the prevailing wind (frozen
 * turbulence) while slowly changing, and are stronger in the lee.
 */
const EDDY = { scales: [0.85, 2.1], weights: [1, 0.45], speed: 0.24, evolve: [0.06, 0.15], lee: 0.9, lift: 0.22 } as const
const CURL_STEP = 0.02

/** Air velocity at a point. */
export type AirSample = { x: number; y: number; z: number }

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

// ── Ground ───────────────────────────────────────────────────────────────────

const HEIGHT_CELLS = 160
const SPAN = 2 * STUDY_HALF

const HEIGHTS = (() => {
  const n = HEIGHT_CELLS
  const grid = new Float32Array((n + 1) * (n + 1))
  for (let j = 0; j <= n; j += 1) {
    for (let i = 0; i <= n; i += 1) {
      grid[j * (n + 1) + i] = studyHeight(-STUDY_HALF + (SPAN * i) / n, -STUDY_HALF + (SPAN * j) / n)
    }
  }
  return grid
})()

const HEIGHT_RANGE = HEIGHTS.reduce(
  (range, h) => ({ low: Math.min(range.low, h), high: Math.max(range.high, h) }),
  { low: Infinity, high: -Infinity },
)

/** The highest ground on the block. */
export const GROUND_TOP = HEIGHT_RANGE.high

/** Ground height, bilinear from a dense sample of the study terrain. */
export function groundAt(x: number, z: number): number {
  const n = HEIGHT_CELLS
  const u = Math.min(n - 1e-6, Math.max(0, ((x + STUDY_HALF) / SPAN) * n))
  const v = Math.min(n - 1e-6, Math.max(0, ((z + STUDY_HALF) / SPAN) * n))
  const i = Math.floor(u)
  const j = Math.floor(v)
  const fx = u - i
  const fz = v - j
  const a = j * (n + 1) + i
  const c = a + n + 1
  const top = HEIGHTS[a]! + (HEIGHTS[a + 1]! - HEIGHTS[a]!) * fx
  const bottom = HEIGHTS[c]! + (HEIGHTS[c + 1]! - HEIGHTS[c]!) * fx
  return top + (bottom - top) * fz
}

/** The surface the air meets: the ground, or the lake over it. */
export const surfaceAt = (x: number, z: number) => Math.max(groundAt(x, z), WATER_LEVEL)

const inBlock = (x: number, z: number, margin = 0) => Math.abs(x) <= STUDY_HALF + margin && Math.abs(z) <= STUDY_HALF + margin

// ── Field ────────────────────────────────────────────────────────────────────

const FIELD_CELLS = 72
/** Per grid node: steered direction x, z; lee 0…1; crest 0…1; surface gradient x, z. */
const STRIDE = 6

export type WeatherField = {
  settings: FieldSettings
  /** Unit vector the prevailing wind blows toward, in plan. */
  toward: [number, number]
  /** 0…1 at the surface: open to the wind, high, or facing into it. */
  exposureAt: (x: number, z: number) => number
  /** Air velocity at (x, y, z) at time t, written into `out`. */
  sample: (x: number, y: number, z: number, t: number, out: AirSample) => AirSample
}

export function createWeatherField(settings: FieldSettings): WeatherField {
  const { strength, turbulence, terrain, seed } = settings
  const azimuth = (settings.direction * Math.PI) / 180
  const tx = -Math.sin(azimuth)
  const tz = -Math.cos(azimuth)
  const n = FIELD_CELLS
  const grid = new Float32Array((n + 1) * (n + 1) * STRIDE)
  const exposure = new Float32Array((n + 1) * (n + 1))
  const e = SPAN / n

  for (let j = 0; j <= n; j += 1) {
    for (let i = 0; i <= n; i += 1) {
      const x = -STUDY_HALF + i * e
      const z = -STUDY_HALF + j * e
      const h = surfaceAt(x, z)
      const gx = (surfaceAt(x + e, z) - surfaceAt(x - e, z)) / (2 * e)
      const gz = (surfaceAt(x, z + e) - surfaceAt(x, z - e)) / (2 * e)
      let rise = 0
      for (let k = 1; k <= SHELTER.samples; k += 1) {
        const d = (SHELTER.reach * k) / SHELTER.samples
        rise = Math.max(rise, (surfaceAt(x - tx * d, z - tz * d) - h) / d)
      }
      let leeRise = 0
      for (let k = 1; k <= LEE.samples; k += 1) {
        const d = (LEE.reach * k) / LEE.samples
        leeRise = Math.max(leeRise, (surfaceAt(x - tx * d, z - tz * d) - h) / d)
      }
      const shelter = smoothstep(SHELTER.from, SHELTER.to, rise)
      const elevation = (h - HEIGHT_RANGE.low) / (HEIGHT_RANGE.high - HEIGHT_RANGE.low)

      // Into rising ground the wind gives up part of its uphill component, turning along the slope.
      const s = STEER.span
      const sx = (surfaceAt(x + s, z) - surfaceAt(x - s, z)) / (2 * s)
      const sz = (surfaceAt(x, z + s) - surfaceAt(x, z - s)) / (2 * s)
      let dx = tx
      let dz = tz
      const uphill = dx * sx + dz * sz
      const slope2 = sx * sx + sz * sz
      if (uphill > 0 && slope2 > 1e-8) {
        const share = terrain * STEER.share * smoothstep(0, STEER.slope, Math.sqrt(slope2))
        dx -= (share * uphill * sx) / slope2
        dz -= (share * uphill * sz) / slope2
        const norm = Math.hypot(dx, dz) || 1
        dx /= norm
        dz /= norm
      }
      const index = (j * (n + 1) + i) * STRIDE
      grid[index] = dx
      grid[index + 1] = dz
      grid[index + 2] = smoothstep(LEE.from, LEE.to, leeRise)
      grid[index + 3] = smoothstep(CREST.from, 1, elevation)
      grid[index + 4] = gx
      grid[index + 5] = gz
      exposure[j * (n + 1) + i] = Math.min(
        1,
        (1 - shelter) * (0.2 + 0.65 * elevation + 0.5 * smoothstep(0.02, 0.35, tx * gx + tz * gz)),
      )
    }
  }

  const random = mulberry32(seed * 7919 + 404)
  const offsets = EDDY.scales.map(() => [random() * 200 - 100, random() * 200 - 100] as const)
  const drift = strength * WIND_SPEED
  const weightSum = EDDY.weights.reduce((sum, w) => sum + w, 0)

  const cell = (x: number, z: number) => {
    const u = Math.min(n - 1e-6, Math.max(0, ((x + STUDY_HALF) / SPAN) * n))
    const v = Math.min(n - 1e-6, Math.max(0, ((z + STUDY_HALF) / SPAN) * n))
    const i = Math.floor(u)
    const j = Math.floor(v)
    return { a: j * (n + 1) + i, fx: u - i, fz: v - j }
  }
  const lerpAt = (values: Float32Array, stride: number, k: number, a: number, fx: number, fz: number) => {
    const b = a + 1
    const c = a + n + 1
    const d = c + 1
    const top = values[a * stride + k]! + (values[b * stride + k]! - values[a * stride + k]!) * fx
    const bottom = values[c * stride + k]! + (values[d * stride + k]! - values[c * stride + k]!) * fx
    return top + (bottom - top) * fz
  }

  return {
    settings,
    toward: [tx, tz],
    exposureAt: (x, z) => {
      const { a, fx, fz } = cell(x, z)
      return lerpAt(exposure, 1, 0, a, fx, fz)
    },
    sample: (x, y, z, t, out) => {
      const { a, fx, fz } = cell(x, z)
      const dx = lerpAt(grid, STRIDE, 0, a, fx, fz)
      const dz = lerpAt(grid, STRIDE, 1, a, fx, fz)
      const shelter = lerpAt(grid, STRIDE, 2, a, fx, fz)
      const crest = lerpAt(grid, STRIDE, 3, a, fx, fz)
      const gx = lerpAt(grid, STRIDE, 4, a, fx, fz)
      const gz = lerpAt(grid, STRIDE, 5, a, fx, fz)
      const above = Math.max(0, y - surfaceAt(x, z))

      // The prevailing wind, steered, sheltered near the ground, faster over the crest.
      const lee = terrain * LEE.slow * shelter * (1 - smoothstep(0, LEE.height, above))
      const profile = PROFILE.ground + (1 - PROFILE.ground) * smoothstep(0, PROFILE.height, above)
      const speed = strength * WIND_SPEED * (1 - lee) * (1 + terrain * CREST.gain * crest) * profile
      let vx = dx * speed
      let vz = dz * speed
      let vy = (vx * gx + vz * gz) * terrain * (1 - smoothstep(0, FOLLOW, above))

      // Eddies carried downwind: the curl of a drifting stream function.
      if (turbulence > 0) {
        let cx = 0
        let cz = 0
        let psi = 0
        const sx = x - tx * drift * t
        const sz = z - tz * drift * t
        EDDY.scales.forEach((scale, o) => {
          const [ox, oz] = offsets[o]!
          const px = sx * scale + ox
          const pz = sz * scale + oz + t * EDDY.evolve[o]!
          const p0 = simplex2(px, pz)
          const w = EDDY.weights[o]! / weightSum
          cx += (w * (simplex2(px, pz + CURL_STEP) - p0)) / CURL_STEP
          cz -= (w * (simplex2(px + CURL_STEP, pz) - p0)) / CURL_STEP
          psi += w * p0
        })
        const amount = turbulence * EDDY.speed * (1 + EDDY.lee * terrain * shelter)
        vx += cx * amount
        vz += cz * amount
        vy += psi * turbulence * EDDY.lift
      }

      out.x = vx
      out.y = vy
      out.z = vz
      return out
    },
  }
}

// ── Particles ────────────────────────────────────────────────────────────────

export type ParticleKind = 'wind' | 'rain' | 'snow' | 'mist'
export const PARTICLE_KINDS: readonly ParticleKind[] = ['wind', 'rain', 'snow', 'mist']

export type ParticlePreset = {
  label: string
  count: number
  /** Own fall speed in still air, units per second: its terminal velocity. */
  fall: number
  /** How quickly it takes up its target velocity, per second: drag over mass. */
  response: number
  /** Share of the air's velocity it takes on. */
  influence: number
  /** Own side-to-side wobble, units per second. */
  flutter: number
  /** Drift down the slope, units per second: cold, damp air draining into hollows. */
  settle: number
  /** Pull back toward its own height above the surface, per second; 0 for none. Keeps air in its layer. */
  hold: number
  /** Born `band` above the surface ('ground') or above the highest ground ('sky'). */
  spawn: 'ground' | 'sky'
  band: readonly [number, number]
  /** Seconds before it fades and is reborn. */
  life: readonly [number, number]
  /** At the surface: slide along it, be reborn, lie for a moment, or hover over it. */
  landing: 'glide' | 'respawn' | 'settle' | 'hover'
  draw: 'streak' | 'point'
  /** Streaks: tail length, as seconds of motion. */
  streak: number
  /** Points: world size. */
  size: number
  color: string
  opacity: number
}

export const PARTICLE_PRESETS: Record<ParticleKind, ParticlePreset> = {
  wind: {
    label: 'Wind',
    count: 1300,
    fall: 0,
    response: 5,
    influence: 1,
    flutter: 0,
    settle: 0,
    hold: 1.2,
    spawn: 'ground',
    band: [0.02, 0.3],
    life: [2.2, 4],
    landing: 'glide',
    draw: 'streak',
    streak: 0.3,
    size: 0,
    color: '#ece9e2',
    opacity: 0.85,
  },
  rain: {
    label: 'Rain',
    count: 1700,
    fall: 3.4,
    response: 2.2,
    influence: 0.55,
    flutter: 0,
    settle: 0,
    hold: 0,
    spawn: 'sky',
    band: [0.2, 1.1],
    life: [30, 30],
    landing: 'respawn',
    draw: 'streak',
    streak: 0.05,
    size: 0,
    color: '#b9c8ff',
    opacity: 0.6,
  },
  snow: {
    label: 'Snow',
    count: 1500,
    fall: 0.32,
    response: 2.6,
    influence: 0.85,
    flutter: 0.2,
    settle: 0,
    hold: 0,
    spawn: 'sky',
    band: [0.1, 1.0],
    life: [40, 40],
    landing: 'settle',
    draw: 'point',
    streak: 0,
    size: 0.09,
    color: '#f6f4ef',
    opacity: 0.92,
  },
  mist: {
    label: 'Mist',
    count: 420,
    fall: 0,
    response: 0.9,
    influence: 0.4,
    flutter: 0.03,
    settle: 0.08,
    hold: 1.5,
    spawn: 'ground',
    band: [0.03, 0.2],
    life: [7, 12],
    landing: 'hover',
    draw: 'point',
    streak: 0,
    size: 0.55,
    color: '#eef1f6',
    opacity: 0.2,
  },
}

/** Particles step at this fixed rate, so a run does not depend on the frame rate. */
export const PARTICLE_STEP = 1 / 60
/** Settled snow lies this long, then fades. */
const REST = 1.6
const FADE_IN = 0.3
const FADE_OUT = 0.6
/** Born farther upwind, falling particles may start this far off the block. */
const UPWIND_MARGIN = STUDY_HALF
const GLIDE = 0.01

export type ParticleSystem = {
  kind: ParticleKind
  preset: ParticlePreset
  count: number
  position: Float32Array
  velocity: Float32Array
  age: Float32Array
  life: Float32Array
  /** Per particle: phase for its flutter, and its hover height above the surface. */
  phase: Float32Array
  hover: Float32Array
  /** Time it has lain on the ground; 0 while moving. */
  rest: Float32Array
  random: () => number
}

export function createParticles(kind: ParticleKind, seed: number, field: WeatherField): ParticleSystem {
  const preset = PARTICLE_PRESETS[kind]
  const count = preset.count
  const system: ParticleSystem = {
    kind,
    preset,
    count,
    position: new Float32Array(count * 3),
    velocity: new Float32Array(count * 3),
    age: new Float32Array(count),
    life: new Float32Array(count),
    phase: new Float32Array(count),
    hover: new Float32Array(count),
    rest: new Float32Array(count),
    random: mulberry32(seed * 7919 + 505 + PARTICLE_KINDS.indexOf(kind) * 104729),
  }
  for (let i = 0; i < count; i += 1) {
    spawn(system, field, i, true)
  }
  return system
}

/** Where falling particles start: farther upwind by about the drift over their fall. */
function upwindOffset(system: ParticleSystem, field: WeatherField, height: number): [number, number] {
  const { fall, influence } = system.preset
  if (fall <= 0) {
    return [0, 0]
  }
  const drift = Math.min(UPWIND_MARGIN, (field.settings.strength * WIND_SPEED * influence * height) / fall)
  return [-field.toward[0] * drift, -field.toward[1] * drift]
}

/** (Re)births particle i; at the start of a run its age is spread, so particles do not fade in together. */
function spawn(system: ParticleSystem, field: WeatherField, i: number, initial: boolean) {
  const { preset, random } = system
  let x = (2 * random() - 1) * STUDY_HALF
  let z = (2 * random() - 1) * STUDY_HALF
  if (preset.settle > 0) {
    // Mist is born mostly over low and wet ground.
    for (let tries = 0; tries < 5; tries += 1) {
      const low = 1 - (surfaceAt(x, z) - HEIGHT_RANGE.low) / (HEIGHT_RANGE.high - HEIGHT_RANGE.low)
      if (random() < low * low) {
        break
      }
      x = (2 * random() - 1) * STUDY_HALF
      z = (2 * random() - 1) * STUDY_HALF
    }
  }
  const lift = preset.band[0] + (preset.band[1] - preset.band[0]) * random()
  let y: number
  if (preset.spawn === 'sky') {
    const base = GROUND_TOP + lift
    // At the start of a run falling particles are spread through the whole fall.
    y = initial ? surfaceAt(x, z) + (base - surfaceAt(x, z)) * random() : base
    const [ox, oz] = upwindOffset(system, field, y - surfaceAt(x, z))
    x += ox * (initial ? random() : 1)
    z += oz * (initial ? random() : 1)
  } else {
    y = surfaceAt(x, z) + lift
  }
  const p = i * 3
  system.position[p] = x
  system.position[p + 1] = y
  system.position[p + 2] = z
  system.velocity[p] = 0
  system.velocity[p + 1] = -preset.fall
  system.velocity[p + 2] = 0
  system.life[i] = preset.life[0] + (preset.life[1] - preset.life[0]) * random()
  system.age[i] = initial && preset.spawn === 'ground' ? random() * system.life[i]! : 0
  system.phase[i] = random()
  system.hover[i] = lift
  system.rest[i] = 0
}

const air: AirSample = { x: 0, y: 0, z: 0 }

/** Advances every particle by one fixed step to time t. `landed` hears where reborn-on-landing particles (rain) hit the surface. */
export function stepParticles(
  system: ParticleSystem,
  field: WeatherField,
  t: number,
  landed?: (x: number, z: number) => void,
) {
  const { preset, position, velocity } = system
  const dt = PARTICLE_STEP
  const take = 1 - Math.exp(-preset.response * dt)
  const margin = preset.spawn === 'sky' ? UPWIND_MARGIN + 0.1 : 0
  for (let i = 0; i < system.count; i += 1) {
    const p = i * 3
    let x = position[p]!
    let y = position[p + 1]!
    let z = position[p + 2]!
    system.age[i]! += dt

    if (system.rest[i]! > 0) {
      system.rest[i]! += dt
      if (system.rest[i]! > REST) {
        spawn(system, field, i, false)
      }
      continue
    }

    field.sample(x, y, z, t, air)
    let targetX = preset.influence * air.x
    let targetY = preset.influence * air.y - preset.fall
    let targetZ = preset.influence * air.z
    if (preset.flutter > 0) {
      const phase = system.phase[i]! * 2 * Math.PI
      targetX += preset.flutter * Math.sin(t * 2.3 + phase)
      targetZ += preset.flutter * Math.cos(t * 1.9 + phase * 1.7)
    }
    const surface = surfaceAt(x, z)
    if (preset.settle > 0) {
      const e = 0.04
      const gx = (surfaceAt(x + e, z) - surfaceAt(x - e, z)) / (2 * e)
      const gz = (surfaceAt(x, z + e) - surfaceAt(x, z - e)) / (2 * e)
      const g = Math.hypot(gx, gz)
      if (g > 1e-4) {
        const pull = (preset.settle * Math.min(1, g / 0.2)) / g
        targetX -= gx * pull
        targetZ -= gz * pull
      }
    }
    if (preset.hold > 0) {
      targetY += (surface + system.hover[i]! - y) * preset.hold
    }

    velocity[p]! += (targetX - velocity[p]!) * take
    velocity[p + 1]! += (targetY - velocity[p + 1]!) * take
    velocity[p + 2]! += (targetZ - velocity[p + 2]!) * take
    x += velocity[p]! * dt
    y += velocity[p + 1]! * dt
    z += velocity[p + 2]! * dt

    if (!inBlock(x, z, margin) || system.age[i]! > system.life[i]!) {
      spawn(system, field, i, false)
      continue
    }
    const ground = surfaceAt(x, z)
    if (y < ground + GLIDE && inBlock(x, z)) {
      if (preset.landing === 'respawn') {
        landed?.(x, z)
        spawn(system, field, i, false)
        continue
      }
      if (preset.landing === 'settle') {
        system.rest[i] = dt
        velocity[p] = 0
        velocity[p + 1] = 0
        velocity[p + 2] = 0
        y = ground + 0.004
      } else {
        y = ground + GLIDE
        velocity[p + 1] = Math.max(0, velocity[p + 1]!)
      }
    }
    position[p] = x
    position[p + 1] = y
    position[p + 2] = z
  }
}

/** 0…1: how visible particle i is now. Off the block it is hidden; it fades in at birth and out at the end. */
export function particleAlpha(system: ParticleSystem, i: number): number {
  const p = i * 3
  if (!inBlock(system.position[p]!, system.position[p + 2]!)) {
    return 0
  }
  const age = system.age[i]!
  const rest = system.rest[i]!
  const fadeIn = smoothstep(0, FADE_IN, age)
  const fadeOut = rest > 0 ? 1 - smoothstep(REST * 0.4, REST, rest) : 1 - smoothstep(system.life[i]! - FADE_OUT, system.life[i]!, age)
  return fadeIn * fadeOut
}
