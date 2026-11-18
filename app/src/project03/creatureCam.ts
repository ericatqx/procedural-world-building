import { useSyncExternalStore } from 'react'
import type { SpeciesId } from '../creature-lab/types.ts'

/**
 * Which creature the page is looking for, and how the camera takes it. A small shared store, because the panel (which chooses) and the scene (which
 * moves the camera) are on either side of the canvas.
 *   locate   the camera glides to the creature and then hands back to the orbiting view, turning about it
 *   follow   third-person: the camera keeps behind and a little above it, the animal in view
 *   pov      first person: the camera is at the creature's head, looking where it looks
 *   off      the ordinary navigation
 */
export type CreatureMode = 'off' | 'locate' | 'follow' | 'pov'
/** What the panel shows of the creature the camera is on: the state it is in, why, and the habitat it reads. */
/**
 * Each species' ecology in four lines, written from the rules the island runs (Creatures.tsx: its thresholds, food sets, ranges and resting
 * places), so the card says what the animal does and why, not an invented natural history. A species may tolerate sun without seeking it.
 */
export const CREATURE_PROFILE: Record<string, [string, string][]> = {
  'Hollow Dweller': [
    ['Light', 'Seeks deep shade by day: rests where its structure roofs or shades the ground, and moves round the structure as the shadow moves.'],
    ['Active', 'Dusk and night (daylight under 45%); by day only when hungry.'],
    ['Feeds', 'On fern, ground mats and shade parasols within about 45 m of its structure.'],
    ['Shelter', 'Its home structure: the roof or the shadow of the moment.'],
  ],
  'Litter Crawler': [
    ['Light', 'Answers to the sun on its own patch of ground, not to daylight: feeds while it is under 35%, curls up over 45%, leaves for cover over 50%.'],
    ['Active', 'Whenever its ground is shaded and it is hungry, day or night.'],
    ['Feeds', 'On fern, ground mats, parasols and canes within about 14 m.'],
    ['Shelter', 'The most covered, dampest litter near by: under a canopy or a structure.'],
  ],
  Strider: [
    ['Light', 'Tolerates full sun; shade plays no part in its rules.'],
    ['Active', 'By day (daylight over 15%); at night it stands still in its shallow.'],
    ['Feeds', 'In water 0.08 to 0.45 m deep, within about 32 m along the shore.'],
    ['Shelter', 'None: it rests standing in its shallow.'],
  ],
  'Veil Glider': [
    ['Light', 'Flies in sun or shade alike while there is daylight (over 12%).'],
    ['Active', 'By day and at dusk; away at night.'],
    ['Feeds', 'Hawks insects low over the woodland edge at dusk (daylight under 45%).'],
    ['Shelter', 'Away at night (its roost is not on the island).'],
  ],
}
export type CreatureInfo = { species: string; stage: string; state: string; why: string; habitat: string; detail: string }
export type CreatureCamState = { species: SpeciesId; index: number; mode: CreatureMode; counts: Record<SpeciesId, number>; /** Each individual's home structure, by species and index ('' where it has none). */ homes: Record<SpeciesId, string[]>; info: CreatureInfo | null; /** A framing asked for by a walkthrough (distance as a multiple of the usual, elevation in radians, and whether to look from the far side of the animal from its home structure, toward it), taken when a creature camera next starts; null: the usual. */ framing: { scale: number; elevation: number; awayFromHome?: boolean } | null; /** A walkthrough asks the chosen Dweller to walk a set loop over open ground (Step 4 of the guide). */ patrol: boolean }

let state: CreatureCamState = { species: 'dweller', index: 0, mode: 'off', counts: { dweller: 0, crawler: 0, strider: 0, glider: 0 }, homes: { dweller: [], crawler: [], strider: [], glider: [] }, info: null, framing: null, patrol: false }
const listeners = new Set<() => void>()
const set = (patch: Partial<CreatureCamState>) => {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

/**
 * A creature camera switched off but not yet released (round 18): the scene hands its last pose back to navigation on its next frame
 * (Creatures.tsx › trackCamera), and a page that sets its own view meanwhile (Home's hero, Explore's overview) must wait for that, or the hand-back
 * lands after it and the page opens on the old close-up.
 */
export const creatureRelease = { pending: false }

export const creatureCam = {
  get: () => state,
  setSpecies: (species: SpeciesId) => set({ species, index: 0, info: null }),
  step: (by: number) => {
    const n = state.counts[state.species]
    if (n > 0) set({ index: (((state.index + by) % n) + n) % n, info: null })
  },
  setMode: (mode: CreatureMode) => {
    // (Switching an active creature camera off is not done until the scene has handed its pose back to ordinary navigation, a frame or more later.)
    if (mode === 'off' && state.mode !== 'off') creatureRelease.pending = true
    set({ mode })
  },
  setCounts: (counts: Record<SpeciesId, number>, homes?: Record<SpeciesId, string[]>) => set(homes ? { counts, homes } : { counts }),
  /** Chooses one individual of a species directly. */
  choose: (species: SpeciesId, index: number) => set({ species, index: Math.max(0, Math.min(index, Math.max(0, state.counts[species] - 1))), info: null }),
  setInfo: (info: CreatureInfo | null) => set({ info }),
  setFraming: (framing: CreatureCamState['framing']) => set({ framing }),
  setPatrol: (patrol: boolean) => set({ patrol }),
}

/** Where the camera is looking while a creature camera is on (the ground there is what the terrain and plants stream for): written by the scene each frame. */
export const creatureFocus = { x: 0, z: 0 }

export function useCreatureCam(): CreatureCamState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
