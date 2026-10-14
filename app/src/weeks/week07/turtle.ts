import { Quaternion, Vector3 } from 'three'
import { lightBias, obstacleNormal, SEED_POSITION, shelterAt, shelterBias } from './environment.ts'
import { derive, mulberry32, TRACE_GRAMMAR, type Derivation } from './lsystem.ts'

/**
 * Week 07 Trace Growth — the 3D turtle. It reads the derived word left to
 * right, carrying a position and an orthonormal frame (heading H, left L,
 * up U). Rotation symbols turn the frame; F moves forward and records a
 * segment; brackets save and restore the whole state, so a branch returns to
 * its fork. While it draws, it reads the environment through the growth
 * response: the tropism bends H toward light or toward shelter, and the
 * favoured condition lengthens internodes. In every response the ground and
 * the shelter mass deflect it, so runners creep along surfaces instead of
 * passing through them.
 */

/**
 * How growth answers the environment. The word and the turtle's random
 * sequence do not depend on it, so the three responses walk the same grammar.
 */
export type GrowthResponse = 'free' | 'light' | 'shelter'
export const GROWTH_RESPONSES: readonly GrowthResponse[] = ['free', 'light', 'shelter']

export type TraceSettings = {
  iterations: number
  /** Branch angle, degrees. */
  angle: number
  /** Internode length, world units. */
  step: number
  randomness: number
  /** Tropism strength of the growth response: 0 the grammar alone … 1 strongly drawn. Unused in Free. */
  tropism: number
  seed: number
}

export const DEFAULT_TRACE_SETTINGS: TraceSettings = {
  iterations: 7,
  angle: 30,
  step: 0.15,
  randomness: 0.55,
  tropism: 0.6,
  seed: 7,
}

export const TRACE_RANGES: Record<keyof TraceSettings, { min: number; max: number; step: number }> = {
  iterations: { min: 1, max: 8, step: 1 },
  angle: { min: 5, max: 70, step: 1 },
  step: { min: 0.05, max: 0.3, step: 0.01 },
  randomness: { min: 0, max: 1, step: 0.01 },
  tropism: { min: 0, max: 1, step: 0.01 },
  seed: { min: 1, max: 999, step: 1 },
}

export type TraceSegment = {
  start: Vector3
  end: Vector3
  /** Segment this one grows from, or −1 at the seed. */
  parent: number
  /** Branch order: brackets entered on the way here. */
  order: number
  /** Path length from the seed at each end: the growth front reaches it then. */
  arrival0: number
  arrival1: number
  /** Shelter where the segment ends, 0…1. */
  shelter: number
  /** The tropism vector applied, scaled by its strength (for the study overlay). */
  bias: Vector3
  /** Tips carried above this segment (pipe model), filled after the walk. */
  tips: number
}

/** An apex left unrewritten at the last iteration: drawn as a bud. */
export type TraceBud = { position: Vector3; arrival: number; parent: number; shelter: number }

export type TraceModel = {
  segments: TraceSegment[]
  buds: TraceBud[]
  /** Branches that grew at least one internode (a bracket holding only a bud does not count). */
  branches: number
  symbols: number
  capped: boolean
  fired: Record<string, number>
  maxArrival: number
  maxOrder: number
  /** Share of internodes ending in shelter (≥ 0.6). */
  sheltered: number
}

/** Golden angle: successive rolls never line up, so forks spread in 3D. */
const ROLL = (137.5 * Math.PI) / 180
/** Randomness: ± share on each turn and step, and the wander per internode, radians. */
const JITTER_ANGLE = 0.45
const JITTER_STEP = 0.35
const WANDER = 0.32
/** Turn toward the bias: angle = gain · |H × T|, at most `maxTurn` per internode. */
const TROPISM_GAIN = 1.2
const TROPISM_MAX_TURN = 0.75
/** Once in shelter, tips are drawn down onto surfaces and spread over them, as lichen does. */
const SPREAD = 0.25
const DOWN = new Vector3(0, -1, 0)
/** Internodes in the favoured condition (light or shelter) grow up to this share longer, the others as much shorter. */
const THRIVE = 0.9
/** Height kept above the ground, and the slope a deflected runner keeps. */
const GROUND_CLEAR = 0.006
const CREEP_RISE = 0.04
/** Clearance from the shelter mass, and the push off a face when sliding along it. */
const OBSTACLE_PAD = 0.012
const OBSTACLE_PUSH = 0.08

type Turtle = {
  position: Vector3
  heading: Vector3
  left: Vector3
  up: Vector3
  arrival: number
  order: number
  parent: number
}

const cloneTurtle = (t: Turtle): Turtle => ({
  position: t.position.clone(),
  heading: t.heading.clone(),
  left: t.left.clone(),
  up: t.up.clone(),
  arrival: t.arrival,
  order: t.order,
  parent: t.parent,
})

function rotateFrame(t: Turtle, axis: Vector3, angle: number) {
  t.heading.applyAxisAngle(axis, angle)
  t.left.applyAxisAngle(axis, angle)
  t.up.applyAxisAngle(axis, angle)
}

/** Turns the whole frame so the heading becomes `next` (unit). */
function turnTo(t: Turtle, next: Vector3) {
  const q = new Quaternion().setFromUnitVectors(t.heading, next)
  t.heading.applyQuaternion(q).normalize()
  t.left.applyQuaternion(q).normalize()
  t.up.applyQuaternion(q).normalize()
}

/** The grammar's word: depends only on iterations, randomness and seed, never on the growth response. */
export function deriveTrace(iterations: number, randomness: number, seed: number): Derivation {
  return derive(TRACE_GRAMMAR, iterations, randomness, seed)
}

/**
 * The environment's pull on a tip, before strength: toward the sun (Seek
 * light), toward deep shelter and then down onto surfaces (Seek shelter), or
 * nothing (Free).
 */
function responseBias(response: GrowthResponse, position: Vector3, shelter: number): Vector3 {
  if (response === 'light') {
    return lightBias(shelter)
  }
  if (response === 'shelter') {
    return shelterBias(position, shelter).addScaledVector(DOWN, SPREAD * shelter)
  }
  return new Vector3()
}

/** How much the favoured condition lengthens an internode, −0.5 … 0.5. */
function thriveFor(response: GrowthResponse, shelter: number): number {
  return response === 'shelter' ? shelter - 0.5 : response === 'light' ? 0.5 - shelter : 0
}

export function growTrace(derivation: Derivation, settings: TraceSettings, response: GrowthResponse): TraceModel {
  const { word, fired, capped } = derivation
  const rng = mulberry32(settings.seed * 104729 + 3)
  const jitter = () => (rng() * 2 - 1) * settings.randomness
  const angle = (settings.angle * Math.PI) / 180

  const segments: TraceSegment[] = []
  const buds: TraceBud[] = []
  const stack: Turtle[] = []
  let maxOrder = 0

  let turtle: Turtle = {
    position: SEED_POSITION.clone(),
    heading: new Vector3(0, 1, 0),
    left: new Vector3(-1, 0, 0),
    up: new Vector3(0, 0, 1),
    arrival: 0,
    order: 0,
    parent: -1,
  }
  rotateFrame(turtle, turtle.heading.clone(), rng() * Math.PI * 2)

  const turn = (axis: Vector3, sign: number) => {
    rotateFrame(turtle, axis.clone(), sign * angle * (1 + JITTER_ANGLE * jitter()))
  }

  for (const symbol of word) {
    switch (symbol) {
      case '+':
      case '-':
        turn(turtle.up, symbol === '+' ? 1 : -1)
        break
      case '&':
      case '^':
        turn(turtle.left, symbol === '&' ? 1 : -1)
        break
      case '/':
      case '\\':
        rotateFrame(turtle, turtle.heading.clone(), (symbol === '/' ? 1 : -1) * ROLL * (1 + 0.2 * jitter()))
        break
      case '[':
        stack.push(cloneTurtle(turtle))
        turtle.order += 1
        maxOrder = Math.max(maxOrder, turtle.order)
        break
      case ']':
        turtle = stack.pop() ?? turtle
        break
      case 'X':
        buds.push({
          position: turtle.position.clone(),
          arrival: turtle.arrival,
          parent: turtle.parent,
          shelter: shelterAt(turtle.position),
        })
        break
      case 'F': {
        const shelter = shelterAt(turtle.position)

        const bias = responseBias(response, turtle.position, shelter).multiplyScalar(settings.tropism)
        if (bias.lengthSq() > 0) {
          const axis = new Vector3().crossVectors(turtle.heading, bias)
          const strength = axis.length()
          if (strength > 1e-5) {
            rotateFrame(turtle, axis.divideScalar(strength), Math.min(TROPISM_GAIN * strength, TROPISM_MAX_TURN))
          }
        }

        if (settings.randomness > 0) {
          const phi = rng() * Math.PI * 2
          const axis = turtle.left.clone().multiplyScalar(Math.cos(phi)).addScaledVector(turtle.up, Math.sin(phi))
          rotateFrame(turtle, axis.normalize(), WANDER * settings.randomness * rng())
        }

        const length =
          settings.step * (1 + JITTER_STEP * jitter()) * (1 + THRIVE * settings.tropism * thriveFor(response, shelter))
        const end = turtle.position.clone().addScaledVector(turtle.heading, length)

        if (end.y < GROUND_CLEAR) {
          const creep = new Vector3(turtle.heading.x, 0, turtle.heading.z)
          if (creep.lengthSq() < 1e-6) {
            creep.set(turtle.up.x, 0, turtle.up.z)
          }
          creep.normalize().setY(CREEP_RISE).normalize()
          turnTo(turtle, creep)
          end.copy(turtle.position).addScaledVector(turtle.heading, length)
          end.y = Math.max(end.y, GROUND_CLEAR)
        }

        const normal = obstacleNormal(end, OBSTACLE_PAD)
        if (normal) {
          const slide = turtle.heading.clone().addScaledVector(normal, -turtle.heading.dot(normal))
          slide.addScaledVector(normal, OBSTACLE_PUSH).normalize()
          turnTo(turtle, slide)
          end.copy(turtle.position).addScaledVector(turtle.heading, length)
          end.y = Math.max(end.y, GROUND_CLEAR)
        }

        segments.push({
          start: turtle.position.clone(),
          end,
          parent: turtle.parent,
          order: turtle.order,
          arrival0: turtle.arrival,
          arrival1: turtle.arrival + length,
          shelter: shelterAt(end),
          bias,
          tips: 0,
        })
        turtle.parent = segments.length - 1
        turtle.position.copy(end)
        turtle.arrival += length
        break
      }
      default:
        break
    }
  }

  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]!
    if (segment.tips === 0) {
      segment.tips = 1
    }
    if (segment.parent >= 0) {
      segments[segment.parent]!.tips += segment.tips
    }
  }

  const branches = segments.filter((s) => s.parent < 0 || segments[s.parent]!.order < s.order).length
  const maxArrival = segments.reduce((max, s) => Math.max(max, s.arrival1), 0)
  const sheltered = segments.length ? segments.filter((s) => s.shelter >= 0.6).length / segments.length : 0
  return { segments, buds, branches, symbols: word.length, capped, fired, maxArrival, maxOrder, sheltered }
}
