import type { Group, Skeleton, SkinnedMesh } from 'three'

export type SpeciesId = 'dweller' | 'glider' | 'strider' | 'crawler'
export type MotionId = 'idle' | 'walk' | 'crouch' | 'perch' | 'glide' | 'bank' | 'stand' | 'wade' | 'forage' | 'scuttle' | 'curl' | 'run' | 'swim'

/**
 * What a creature is built from. These are the numbers a later ecology can set: a place's year-by-year state would become an age,
 * a condition, a mineral load and a habitat. In the lab they are sliders; each one means something different for each species,
 * and species.ts says what.
 */
export type CreatureParams = {
  seed: number
  /** Override an individual's linked body-plan axes (traits.ts), -1 to 1, for comparisons. Absent: the seed decides. */
  traits?: Record<string, number>
  /**
   * The species' BASE BODY PLAN, as multipliers on its proportions (1 = the species as designed): torso length, girth, leg length, the
   * upper : lower leg ratio at the knee (the leg's total length is kept, so the body stays at the same height and the feet stay planted),
   * head size, and tail or sail. The Builder's controls; absent everywhere else.
   */
  plan?: BodyPlan
  /** 0 (young) to 1 (mature): size, proportions, and how far mineral has been laid down. */
  age: number
  /** 0 (poor) to 1 (thriving): body reserves (girth), and wear on the delicate parts. */
  condition: number
  /** 0 to 1: how much mineral it has taken up from where it lives. Where it goes depends on the species. */
  mineral: number
  /** 0 to 1: the place it lives in, as the species reads it (hollow depth, wind, water depth, litter depth). */
  habitat: number
}

export type BodyPlan = {
  torso?: number; girth?: number; leg?: number; knee?: number; head?: number; tail?: number
  /** Glider: wing span (arm and ray length) and wing breadth (how wide the rays fan, front to back). */
  wing?: number; chord?: number
  /** Crawler: shell bands added or removed, and the shell's dome (flat to high). */
  bands?: number; dome?: number
}

export type MotionInput = {
  motion: MotionId
  /** Walking, wading or scuttling pace, 0.3 (slow) to 1.5 (brisk). */
  pace: number
  /** The most a glider rolls into a turn, in degrees. */
  bank: number
  /** The depth of the water the strider stands in, 0 to 1, when something other than the habitat control sets it (Auto Behavior). */
  water?: number
  /** How hard a crawler is feeding, 0 to 1 (Auto Behavior): it roots in the litter. */
  feed?: number
}

/** What the scene needs from a creature each frame: how the ground moves past it, and what to read out. */
export type Frame = {
  /** Metres per second the world moves backward past the creature. */
  speed: number
  /** Radians per second the world turns around it (a banked turn). */
  yawRate: number
  /** The pose it is in, in words. */
  state: string
  /** The fastest a planted foot slid over the ground this frame, in metres per second (walkers only). */
  slip: number
  /** The height of the water at this moment, in metres in the world, if the creature has water (strider). */
  water?: number
  /** Notes for the readout: label then value. */
  notes: [string, string][]
}

export type Creature = {
  root: Group
  skeleton: Skeleton
  meshes: SkinnedMesh[]
  update: (dt: number, input: MotionInput) => Frame
  setWireframe: (on: boolean) => void
  dispose: () => void
  stats: { triangles: number; vertices: number; bones: number; drawCalls: number; buildMs: number; features: string }
  /** Where the camera looks and how far back it stands, for this individual. */
  frame: { target: [number, number, number]; distance: number }
  /** Body size in metres: length, height or wingspan, as the species measures it. */
  size: { length: number; height: number; span: number }
  /** The height of the water the creature stands in, in metres, if it has any (strider). */
  water?: number
  /** The individual's linked body-plan axes and what each one moved (traits.ts), for species that have them. */
  traits?: import('./traits.ts').TraitReading[]
  /** The walk this body makes, in metres and steps: leg length (hip to ground), stride, and cycles per second at pace 1. */
  gait?: { leg: number; stride: number; cadence: number }
  /** Measured anatomy for the Builder's readout: label, then metres. */
  anatomy?: [string, number][]
}
