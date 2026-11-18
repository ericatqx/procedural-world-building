import { useSyncExternalStore } from 'react'
import type { Archetype, Zones } from './vegPlants.ts'

/**
 * Shadow Ecology 0.3 — the vegetation's controls and what it reports, as one small shared store: the panel sets the controls
 * and reads the numbers; the scene reads the controls and writes the numbers. (A store because the panel and the scene are in
 * different React trees, as with the environment.)
 */
export type VegOverlay = 'off' | 'habitat' | 'light' | 'moisture' | 'architecture'

export type VegHere = { zones: Zones; light: number; moisture: number; slope: number; height: number; shade: number; shelter: number }

export type VegState = {
  show: boolean
  /** `world`: plants from the Vegetation Lab, at three levels of detail. `previous`: the earlier primitive plants, kept for comparison. */
  renderer: 'world' | 'previous'
  /** Whether Living Architecture's footprint, shade and shelter act on the plants. */
  influence: boolean
  overlay: VegOverlay
  /** Draw the ecological coverage (habitat ground colour) on the terrain. An analysis overlay: off by default. */
  coverage: boolean
  /** The island's fields are built (the ground colour is on). */
  ready: boolean
  /** Plants standing in the detailed tiles, and what the count would be with the architecture's influence the other way. */
  counts: Record<Archetype, { now: number; other: number }>
  /** Far plants drawn as clumps. */
  far: number
  ms: { island: number; tile: number; habitat: number; update: number }
  tiles: number
  year: number
  here: VegHere | null
  /** The Lab-plant renderer's instance counts by distance, and what it cost. */
  plants: { near: number; mid: number; far: number; attached: number; ms: number; banks: number }
}

let state: VegState = {
  show: true,
  renderer: 'world',
  influence: true,
  overlay: 'off',
  coverage: false,
  ready: false,
  counts: { cover: { now: 0, other: 0 }, shrub: { now: 0, other: 0 }, tall: { now: 0, other: 0 } },
  far: 0,
  ms: { island: 0, tile: 0, habitat: 0, update: 0 },
  tiles: 0,
  year: 0,
  here: null,
  plants: { near: 0, mid: 0, far: 0, attached: 0, ms: 0, banks: 0 },
}
const listeners = new Set<() => void>()

export const vegetationState = () => state
export function setVegetation(patch: Partial<VegState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}
export function useVegetation(): VegState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    vegetationState,
    vegetationState,
  )
}
