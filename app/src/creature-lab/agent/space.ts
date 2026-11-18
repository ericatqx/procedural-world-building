import type { Env } from './types.ts'

/**
 * Spatial layer for the agents: a small world on the ground plane (x, z in metres), what an agent perceives of it from where it
 * stands, how it picks a target for what it wants, and how it steers there. Pure maths, no rendering, independent of three.js.
 *
 * It follows Week 8 (Agents & Scale): perception is a radius (`sense`, as in `senseRadius`), a target is the nearest sensed thing of
 * the kind that is wanted, and steering turns the heading toward it at a limited rate (`turnToward`) and slows to arrive; wandering
 * follows a smooth noise, as there. Week 8's Sim itself is a 240-agent typed-array population tied to its own terrain and trail field,
 * so it is not imported; this is the single-agent version of the same ideas.
 *
 * `senseEnv` is the seam for the island: it turns "where the agent is" into the same `Env` numbers the behaviour tree already reads.
 * On the island, the zones would come from the habitat raster (shelter and shade), the hydrology (water depth) and the litter and
 * shallows (food); the rest of this file would not change.
 */
/** The hour in the test arena, set by the Lab's Time of day control (the arena has no sky of its own). */
export const arenaClock = { daylight: 0.85 }

export type Zone = { x: number; z: number; r: number }
export type Pose = { x: number; z: number; heading: number }
export type Goal = 'stay' | 'wander' | 'shelter' | 'shade' | 'water' | 'shallows' | 'deep' | 'food' | 'flee'

export type Arena = {
  /** Metres per lab metre: the crawler's world is a tenth the size of the dweller's. */
  unit: number
  /** Half the width of the playable circle. */
  radius: number
  /** Light in the open, 0 to 1. Shade and shelters reduce it. */
  sun: number
  /** How far the agent perceives. */
  sense: number
  shelters: Zone[]
  shade: Zone[]
  food: Zone[]
  /** Water: depth 0 at the shore (radius `r`), 1 in the middle. */
  pool?: Zone
  start: Pose
  /** The fastest it can turn, radians per second. */
  turn: number
  threatRange: number
  hazardSpeed: number
}

export const ARENAS: Record<'dweller' | 'strider' | 'crawler', Arena> = {
  dweller: {
    unit: 1, radius: 8, sun: 0.65, sense: 9,
    shelters: [{ x: -4.5, z: 2.5, r: 1.5 }, { x: 4, z: -4, r: 1.5 }],
    shade: [{ x: -1, z: -5, r: 2.2 }],
    // Forest-floor food (fungi and fallen seed) lies in the damp shade, away from its shelters: it has to go out to it.
    food: [{ x: -1.2, z: -5.2, r: 1.1 }, { x: 5.6, z: 3.4, r: 0.9 }], start: { x: 0, z: 0, heading: 0 }, turn: 2.2, threatRange: 7, hazardSpeed: 1.4,
  },
  strider: {
    unit: 1, radius: 9, sun: 0.6, sense: 10,
    shelters: [], shade: [],
    pool: { x: 4, z: 0, r: 4.6 },
    food: [{ x: 6.2, z: 2.2, r: 0.9 }, { x: 2.2, z: -2.4, r: 0.9 }],
    start: { x: -3.5, z: 0, heading: 0 }, turn: 1.2, threatRange: 7, hazardSpeed: 1.2,
  },
  crawler: {
    unit: 0.1, radius: 0.9, sun: 0.9, sense: 0.8,
    shelters: [], shade: [{ x: -0.45, z: 0.4, r: 0.35 }, { x: 0.45, z: -0.3, r: 0.35 }],
    food: [{ x: -0.45, z: 0.4, r: 0.2 }, { x: 0.45, z: -0.3, r: 0.2 }],
    start: { x: 0, z: 0, heading: 0 }, turn: 1.6, threatRange: 0.8, hazardSpeed: 0.14,
  },
}

/** Something dangerous that closes in on the agent for a while and then goes: a stand-in for a predator or a falling shelf. */
export type Hazard = { active: boolean; x: number; z: number; age: number }
export const newHazard = (): Hazard => ({ active: false, x: 0, z: 0, age: 0 })

export function spawnHazard(h: Hazard, arena: Arena, at: Pose) {
  const a = at.heading + 0.9
  h.active = true
  h.age = 0
  h.x = at.x + Math.cos(a) * arena.threatRange * 0.95
  h.z = at.z + Math.sin(a) * arena.threatRange * 0.95
}

export function stepHazard(h: Hazard, arena: Arena, agent: Pose, dt: number) {
  if (!h.active) return
  h.age += dt
  const dx = agent.x - h.x
  const dz = agent.z - h.z
  const d = Math.hypot(dx, dz)
  if (d > arena.threatRange * 0.3) {
    h.x += (dx / d) * arena.hazardSpeed * dt
    h.z += (dz / d) * arena.hazardSpeed * dt
  }
  if (h.age > 9) h.active = false
}

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const smooth = (t: number) => t * t * (3 - 2 * t)
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const dist = (p: { x: number; z: number }, z: { x: number; z: number }) => Math.hypot(p.x - z.x, p.z - z.z)

export const depthAt = (pool: Zone | undefined, x: number, z: number) => (pool ? smooth(clamp((pool.r - Math.hypot(x - pool.x, z - pool.z)) / (0.7 * pool.r))) : 0)

/** What the agent can tell about where it is standing, as the numbers the behaviour tree reads. */
export function senseEnv(arena: Arena, p: Pose, h: Hazard): Env {
  let shelter = 0
  for (const z of arena.shelters) {
    const d = dist(p, z)
    // Inside the shelter's footprint is 1; the cover value falls away quickly outside it.
    shelter = Math.max(shelter, d < z.r * 0.8 ? 1 : clamp(1 - (d - z.r * 0.8) / (arena.sense * 0.15)))
  }
  let shade = 0
  for (const z of [...arena.shade, ...arena.shelters]) shade = Math.max(shade, clamp(1 - dist(p, z) / z.r))
  let food = 0
  for (const z of arena.food) food = Math.max(food, clamp(1.25 * (1 - dist(p, z) / z.r)))
  const threat = h.active ? clamp(1 - dist(p, h) / arena.threatRange) * Math.min(1, h.age) : 0
  return { light: arena.sun * (1 - 0.85 * smooth(shade)), water: depthAt(arena.pool, p.x, p.z), shelter, threat, food, wind: 0.3, perch: 0.5, daylight: arenaClock.daylight }
}

export type Target = { x: number; z: number; kind: string; dist: number; stop: number }

/** The nearest sensed thing of the kind the goal wants, or nothing if none is within perception. */
export function pickTarget(arena: Arena, p: Pose, goal: Goal, h: Hazard): Target | null {
  const nearest = (zones: Zone[], kind: string, stopK: number): Target | null => {
    let best: Target | null = null
    for (const z of zones) {
      const d = dist(p, z)
      if (d - z.r <= arena.sense && (!best || d < best.dist)) best = { x: z.x, z: z.z, kind, dist: d, stop: z.r * stopK }
    }
    return best
  }
  const poolPoint = (k: number, kind: string, stop: number): Target | null => {
    const pool = arena.pool
    if (!pool) return null
    const d = dist(p, pool)
    if (d - pool.r > arena.sense) return null
    const dx = d < 1e-6 ? 1 : (p.x - pool.x) / d
    const dz = d < 1e-6 ? 0 : (p.z - pool.z) / d
    const x = k === 0 ? pool.x : pool.x + dx * pool.r * k
    const z = k === 0 ? pool.z : pool.z + dz * pool.r * k
    return { x, z, kind, dist: Math.hypot(p.x - x, p.z - z), stop }
  }
  switch (goal) {
    case 'shelter': return nearest(arena.shelters, 'shelter', 0.35)
    case 'shade': return nearest([...arena.shade, ...arena.shelters], 'shade', 0.4)
    case 'food': return nearest(arena.food, 'food', 0.3)
    case 'water': return poolPoint(0.88, 'shore', arena.pool ? arena.pool.r * 0.1 : 0.3)
    case 'shallows': return poolPoint(0.72, 'shallows', arena.pool ? arena.pool.r * 0.12 : 0.3)
    case 'deep': return poolPoint(0, 'deep water', arena.pool ? arena.pool.r * 0.2 : 0.3)
    case 'flee': {
      if (!h.active) return null
      const d = Math.max(1e-6, dist(p, h))
      const far = arena.radius
      return { x: p.x + ((p.x - h.x) / d) * far, z: p.z + ((p.z - h.z) / d) * far, kind: 'away', dist: far, stop: 0 }
    }
    default: return null
  }
}

/** A smooth value noise in -1..1, deterministic from a seed. */
function noise1(t: number, seed: number) {
  const hash = (i: number) => {
    let x = Math.imul(i + seed * 374761393, 668265263) ^ (i << 13)
    x = Math.imul(x ^ (x >>> 15), 2246822519)
    return ((x ^ (x >>> 13)) >>> 0) / 4294967296
  }
  const i = Math.floor(t)
  const f = smooth(t - i)
  return (hash(i) + (hash(i + 1) - hash(i)) * f) * 2 - 1
}

export type Steer = { turn: number; speed: number; mode: string; arrived: boolean }
export type SteerState = { t: number; seed: number }

/**
 * Steering: head for the target at a limited turn rate, slowing as it arrives and when it is not facing it; wander on a smooth noise;
 * keep inside the arena. `speed` is 0 to 1 of its full pace; `turn` is radians per second.
 */
export function steer(arena: Arena, p: Pose, goal: Goal, target: Target | null, h: Hazard, st: SteerState, dt: number): Steer {
  st.t += dt
  if (goal === 'stay') return { turn: 0, speed: 0, mode: 'stay', arrived: false }
  let desired: number
  let speed: number
  let mode: string
  let arrived = false
  const home = Math.hypot(p.x, p.z)
  if (target) {
    const d = target.dist
    if (d <= target.stop) return { turn: 0, speed: 0, mode: 'arrived', arrived: true }
    desired = Math.atan2(target.z - p.z, target.x - p.x)
    const err = wrap(desired - p.heading)
    const align = Math.cos(err)
    speed = clamp((d - target.stop) / (arena.unit * 2.5)) ** 0.6 * (align > 0 ? 0.3 + 0.7 * align : 0.18)
    speed = Math.max(speed, 0.2)
    mode = target.kind === 'away' ? 'flee' : 'seek'
  } else if (goal === 'flee' || (h.active && goal !== 'wander')) {
    desired = Math.atan2(p.z - h.z, p.x - h.x)
    speed = 1
    mode = 'flee'
  } else {
    // Wander: the heading drifts on a slow noise, so it explores without darting.
    desired = p.heading + noise1(st.t * 0.35, st.seed) * 1.3
    speed = 0.85
    mode = target === null && goal !== 'wander' ? 'search' : 'wander'
  }
  if (home > arena.radius * 0.82) {
    desired = Math.atan2(-p.z, -p.x)
    speed = Math.min(speed, 0.6)
    mode = 'turn back'
  }
  const turn = clamp(wrap(desired - p.heading) * 3, -arena.turn, arena.turn)
  return { turn, speed, mode, arrived }
}
