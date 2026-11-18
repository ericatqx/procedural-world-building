import { clamp01, smoothstep } from '../project02/core.ts'
import { lifeAt, stageOf, type LifePhase, type Stage } from '../architecture-lab/lifecycle.ts'

/**
 * Shadow Ecology 0.3 — Living Architecture's life and death: a lightweight ecological state for each organism, kept apart from
 * how it is drawn (nothing here knows about meshes, materials or the camera).
 *
 * Each year, from the conditions the population simulation (livingEcology.ts) already gives an organism, three numbers:
 *   stress   how hard the place is on it: little light, little water, poor ground (soil and minerals), open exposure (wind), and
 *            crowding (its neighbours' shade and the draw of their roots). 0 (easy) to 1 (hard)
 *   health   its condition, which follows what the place allows (1 − stress, steeply) a few years behind
 *   growth   its growth rate, the simulation's vigor (light × resources × moisture): how fast its age advances
 * and one store:
 *   reserve  its remaining vitality, 1 until it has matured, then spent each year: a little for being old, more for stress, more again
 *            for poor health. When it is spent the organism dies. So its LIFESPAN is not set: a hard place spends it faster.
 *
 * From these, one number places it in the seven-stage lifecycle the Architecture Lab draws (architecture-lab/lifecycle.ts):
 *   L        0 to 0.5: establishment, juvenile and growing (its age, 0 to 1, is half of L); 0.5 to 0.58 maturity; 0.58 to 0.74
 *            senescence (as the reserve runs from SENESCENCE to 0); 0.74 to 0.88 death (the first DEATH_YEARS after the reserve is spent);
 *            0.88 to 1 remains (weathering over REMAINS_YEARS, and then they stay: remains persist)
 * The stage is therefore derived from age and conditions, never assigned. Everything is a pure function of the population's
 * series, so any year can be visited in any order and shows the same organism.
 *
 * What the living and the dead give to others (shelter, minerals, litter) is `lifeInfluence`: the interface for the creatures
 * and the vegetation (not used by them yet).
 */
export const ECOLOGY = {
  /** How much each condition adds to stress (they sum to about 1). */
  stress: { light: 0.3, moisture: 0.22, resource: 0.22, exposure: 0.12, crowding: 0.14 },
  /** Health follows 1.15 − 1.3 × stress, this much of the gap each year. */
  health: { rate: 0.25, ceiling: 1.15, slope: 1.3 },
  /** Reserve spent per year after maturity = (base + stress × stress + health × (1 − health)) / (years × the organism's own factor). */
  reserve: { base: 0.6, stress: 1.6, health: 0.8, years: 75, spread: 0.25 },
  /** The reserve at which senescence begins. */
  senescence: 0.55,
  /** Years from the end of the reserve to the end of the collapse, and over which the remains weather. */
  deathYears: 36,
  remainsYears: 120,
}

/** Columns of an organism's life track, per year. */
export const T = { health: 0, stress: 1, growth: 2, reserve: 3, L: 4 } as const
export const TK = 5

export type LifeInputs = {
  light: number
  moisture: number
  resource: number
  /** The ground's own exposure: ridge (+1) or hollow (−1). */
  ridge: number
  /** Neighbours close by, 0 to 1. */
  crowding: number
  shade: number
  draw: number
}

export function stressOf(c: LifeInputs): number {
  const w = ECOLOGY.stress
  const exposure = Math.max(0, c.ridge)
  const crowd = clamp01(Math.max(c.crowding, c.shade + c.draw))
  return clamp01(w.light * (1 - c.light) + w.moisture * (1 - c.moisture) + w.resource * (1 - c.resource) + w.exposure * exposure + w.crowding * crowd)
}

/** The lifecycle coordinate L from age (0 to 1+, before death), the reserve, and the years since death (−1 while alive). */
export function lifeCoordinate(age: number, reserve: number, sinceDeath: number): number {
  if (sinceDeath >= 0) {
    if (sinceDeath < ECOLOGY.deathYears) return 0.74 + 0.14 * (sinceDeath / ECOLOGY.deathYears)
    return 0.88 + 0.12 * clamp01((sinceDeath - ECOLOGY.deathYears) / ECOLOGY.remainsYears)
  }
  if (age < 1) return 0.5 * Math.max(0, age)
  const sen = ECOLOGY.senescence
  if (reserve > sen) return 0.5 + 0.08 * (1 - (reserve - sen) / (1 - sen))
  return 0.58 + 0.16 * (1 - reserve / sen)
}

/** A deterministic factor near 1 for each organism: its own constitution. */
export const constitution = (index: number) => 1 + ECOLOGY.reserve.spread * (Math.sin(index * 12.9898 + 4.1) * 43758.5453 - Math.floor(Math.sin(index * 12.9898 + 4.1) * 43758.5453) - 0.5)

/**
 * One organism's life track over the years of the population simulation: for each year [health, stress, growth, reserve, L], and the
 * year it died (or −1). `rows` gives, for a year index, its age, vigor, light, moisture, resource, shade and draw (the simulation's series).
 */
export function lifeTrack(index: number, years: number, from: number, row: (y: number) => { age: number; vigor: number; light: number; moisture: number; resource: number; shade: number; draw: number }, site: { ridge: number; crowding: number }): { track: Float32Array; died: number } {
  const track = new Float32Array(years * TK)
  let health = 1
  let reserve = 1
  let died = -1
  const R = ECOLOGY.reserve
  const own = constitution(index)
  for (let y = 0; y < years; y += 1) {
    const r = row(y)
    if (r.age < 0) {
      track[y * TK + T.L] = -1
      continue
    }
    const stress = stressOf({ light: r.light, moisture: r.moisture, resource: r.resource, ridge: site.ridge, crowding: site.crowding, shade: r.shade, draw: r.draw })
    health += ECOLOGY.health.rate * (clamp01(ECOLOGY.health.ceiling - ECOLOGY.health.slope * stress) - health)
    if (died < 0 && r.age >= 1) {
      reserve = Math.max(0, reserve - (R.base + R.stress * stress + R.health * (1 - health)) / (R.years * own))
      if (reserve <= 0) died = from + y
    }
    const since = died >= 0 ? from + y - died : -1
    track.set([health, stress, r.vigor, reserve, lifeCoordinate(r.age, reserve, since)], y * TK)
  }
  return { track, died }
}

export type LifeState = {
  present: boolean
  /** The lifecycle coordinate the Lab's slider uses. */
  L: number
  stage: Stage
  phase: LifePhase
  health: number
  stress: number
  growth: number
  reserve: number
  /** Years since it took root; the year it died (or null) and how long it lived (or null). */
  years: number
  died: number | null
  lifespan: number | null
  /** The year it will die on its present course (while alive), or null (past the timeline). */
  expectedDeath: number | null
  /** Years since death (0 while alive) and how far the remains have weathered, 0 to 1. */
  sinceDeath: number
  weathered: number
}

/** The life state of organism `index` at a world time (a fractional year), read from its track (a row per year from `from`). */
export function lifeStateAt(track: Float32Array, from: number, established: number, died: number, time: number): LifeState {
  const years = track.length / TK
  const t = Math.min(years - 1.0001, Math.max(0, time - from))
  const y = Math.floor(t)
  const f = t - y
  const a = track[y * TK + T.L]!
  const b = track[Math.min(years - 1, y + 1) * TK + T.L]!
  const present = a >= 0 || (b >= 0 && f > 0)
  const mix = (c: number) => track[y * TK + c]! * (1 - f) + track[Math.min(years - 1, y + 1) * TK + c]! * f
  // L is monotone in time, so interpolation between years is safe; the first year (−1) is not present.
  const L = present ? (a < 0 ? b * f : mix(T.L)) : 0
  const dead = died >= 0 && time >= died
  const phase = lifeAt(L)
  const sinceDeath = dead ? time - died : 0
  return {
    present,
    L,
    stage: stageOf(L),
    phase,
    health: present ? mix(T.health) : 0,
    stress: present ? mix(T.stress) : 0,
    growth: present ? mix(T.growth) : 0,
    reserve: present ? mix(T.reserve) : 0,
    years: time - established,
    died: dead ? died : null,
    lifespan: dead ? died - established : null,
    expectedDeath: !dead && died >= 0 ? died : null,
    sinceDeath,
    weathered: dead ? clamp01((sinceDeath - ECOLOGY.deathYears) / ECOLOGY.remainsYears) : 0,
  }
}

/**
 * What an organism gives to its surroundings at a stage: for the creatures and the vegetation to read later.
 *   shelter   hollows and shade a creature can use: an undercroft while it stands, then rubble (less as it weathers)
 *   minerals  dissolved mineral returned to the ground: some from living wear, most as it dies and its skeleton weathers
 *   litter    organic matter shed: the dying skin, then little
 */
export function lifeInfluence(s: LifeState): { shelter: number; minerals: number; litter: number } {
  const L = s.L
  if (!s.present) return { shelter: 0, minerals: 0, litter: 0 }
  const standing = smoothstep(0.1, 0.5, L) * (1 - smoothstep(0.74, 0.88, L))
  const rubble = smoothstep(0.78, 0.9, L) * (1 - 0.5 * s.weathered)
  return {
    shelter: clamp01(standing + 0.45 * rubble),
    minerals: clamp01(0.1 * smoothstep(0.5, 0.74, L) + 0.8 * smoothstep(0.74, 0.9, L) * (1 - 0.4 * s.weathered)),
    litter: clamp01(smoothstep(0.58, 0.74, L) * (1 - smoothstep(0.74, 0.9, L)) + 0.3 * smoothstep(0.74, 0.8, L) * (1 - smoothstep(0.8, 0.95, L))),
  }
}
