import type { MotionId, SpeciesId } from '../types.ts'
import type { Goal } from './space.ts'

/**
 * The agent layer's contract with the world. `Env` is what a creature can sense about the place it is in, as plain 0–1 numbers; in
 * the lab they are sliders, and in the island they would be read from the terrain, the water, the vegetation and Living Architecture
 * (light from the sun and shade, water from the hydrology, shelter from the habitat raster, and so on). `Intent` is what an agent
 * asks its body to do, in the vocabulary the animation layer already has. Nothing here knows about three.js.
 */
export type Env = {
  /** 0 shade to 1 full sun. */
  light: number
  /** 0 dry land to 1 deep water, where the creature stands. */
  water: number
  /** 0 open ground to 1 inside a shelter. */
  shelter: number
  /** 0 none to 1 something dangerous is on top of it. */
  threat: number
  /** 0 none to 1 plenty of what this species eats nearby (litter, shallows food). */
  food: number
  /** 0 still air to 1 strong wind. */
  wind: number
  /** 0 nowhere to land to 1 a good elevated perch is close. */
  perch: number
  /**
   * 0 night to 1 full day: the sun's daylight, as the island's Sky gives it (environment.state.sun.daylight). Not the same as `light`: light is the
   * shade or sun where the creature stands NOW; daylight is the hour. A shade-loving animal is not therefore nocturnal: the Crawler follows shade at
   * any hour, while the Dweller lies up by day and goes out at dusk, and the Strider and the Glider are day animals. These are the island's rhythms.
   */
  daylight: number
}
export type EnvKey = keyof Env

export const DEFAULT_ENV: Record<SpeciesId, Env> = {
  dweller: { light: 0.3, water: 0, shelter: 0.95, threat: 0, food: 0.5, wind: 0.3, perch: 0.5, daylight: 0.3 },
  glider: { light: 0.7, water: 0, shelter: 0.3, threat: 0, food: 0.6, wind: 0.6, perch: 0.7, daylight: 0.85 },
  strider: { light: 0.6, water: 0.3, shelter: 0.3, threat: 0, food: 0.7, wind: 0.3, perch: 0.5, daylight: 0.85 },
  crawler: { light: 0.25, water: 0, shelter: 0.6, threat: 0, food: 0.7, wind: 0.2, perch: 0.5, daylight: 0.85 },
}

/** The environment controls each species reads, with what each means for it. */
export const ENV_FIELDS: Record<SpeciesId, { key: EnvKey; label: string; tip: string }[]> = {
  dweller: [
    { key: 'daylight', label: 'Time of day', tip: 'Night to full day (the island’s daylight). By day it lies up in cover, as on the island under a structure; at dusk and night, rested, it goes out.' },
    { key: 'light', label: 'Light', tip: 'Shade to open sun. The Dweller avoids open light and wants cover when it is bright.' },
    { key: 'food', label: 'Food underfoot', tip: 'Fungi and fallen seed on the forest floor where it is. Hungry at dusk or night (or starving by day), it eats here if there is food, and goes out to look if not.' },
    { key: 'shelter', label: 'Shelter near', tip: 'Open ground (0) to inside a shelter (0.9 and over). It rests and hides only inside cover; below that it goes looking for it.' },
    { key: 'threat', label: 'Threat', tip: 'None to close. Some makes it alert; a lot makes it hide, if cover is close, or run for it.' },
  ],
  glider: [
    { key: 'daylight', label: 'Time of day', tip: 'Night to full day. On the wing by day and at dusk, along the woodland edge; at night it roosts (on the island it is away).' },
    { key: 'food', label: 'Canopy insects', tip: 'None to plenty, over the canopy edge where it flies. Hungry, it hawks them in tight banked turns; with none, it glides on.' },
    { key: 'wind', label: 'Wind', tip: 'Still to strong. Wind lets it soar cheaply; in still air it spends energy.' },
    { key: 'perch', label: 'Perch near', tip: 'Nowhere to land to a good high perch close by. Tired, it lands if there is one and circles to look if not.' },
    { key: 'threat', label: 'Threat', tip: 'None to close. A threat sends it into the air from its perch.' },
  ],
  strider: [
    { key: 'daylight', label: 'Time of day', tip: 'Night to full day. It works the shallows by day and stands still in its shallow at night, as on the island.' },
    { key: 'water', label: 'Water depth', tip: 'Dry land, shallows, deep water: where it stands now. It walks on land, wades and forages in shallows, and swims in deep water.' },
    { key: 'food', label: 'Food in shallows', tip: 'None to plenty. Hungry, it forages only where the shallows have food, and goes looking if they do not.' },
    { key: 'threat', label: 'Threat', tip: 'None to close. It flees to deeper water, swimming if the water is deep enough.' },
  ],
  crawler: [
    { key: 'light', label: 'Light', tip: 'Shade to open sun, where it is now. Open light dries it out, so it shuffles for shade. It keeps no clock: in shade it feeds at any hour (shade-loving, not nocturnal).' },
    { key: 'food', label: 'Litter here', tip: 'Bare ground to deep litter. Hungry, it roots and eats where there is litter, and goes searching where there is none.' },
    { key: 'threat', label: 'Threat', tip: 'None to close. A threat makes it roll up and stay rolled until the danger is gone.' },
  ],
}

/** What an agent asks of its body. */
export type Intent = {
  behaviour: string
  motion: MotionId
  /** Walking, wading, swimming or shuffling pace. */
  pace: number
  /** The most it rolls into a turn (gliders). */
  bank: number
  /** The water depth it is standing in, 0–1 (striders). */
  water?: number
  /** How hard it is feeding, 0–1 (crawlers). */
  feed?: number
  /** Where it wants to go, for the spatial layer. */
  goal: Goal
}

export type BrainDebug = {
  state: string
  /** Seconds in this state. */
  time: number
  /** Why the tree chose what it did. */
  why: string
  /** What it is trying to reach or do, in space. */
  goal?: string
  /** A state the tree wants but the state machine is still getting to (it goes through intermediate states). */
  heading?: string
  /** The branch of the tree that ran. */
  trace: string[]
  needs: [string, number][]
  recent: string[]
  extra: string[]
  /** What the current state is doing to its needs (the outcome of its action), e.g. 'hunger falling'. */
  effect: string[]
  /** The state machine: which state can follow which (for the Lab's diagram). */
  edges: Record<string, string[]>
  /** What it sensed this frame (the environment as it takes it in). */
  senses: Env
}

export type Brain = {
  update: (dt: number, env: Env) => { intent: Intent; debug: BrainDebug }
  reset: () => void
}
