import { useSyncExternalStore } from 'react'

/**
 * PLANT INSPECTION, ON PURPOSE (round 17). Plants are identified only while Explore's Vegetation drawer is open (`on`): free exploration is never
 * interrupted by plant readouts. The plant being read (found by the drawer, or clicked in the world while the drawer is open) is `card`, which the
 * drawer shows in full.
 */
export type PlantCard = { title: string; tag: string; summary: [string, string][] }
let state: { on: boolean; card: PlantCard | null } = { on: false, card: null }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** A click a plant has claimed (dataProbe.tsx sets it before the world's own window handlers hear the release): structure selection leaves it alone. */
export const plantClick = { claimed: false }

export const vegInspect = {
  get: () => state,
  setOn(on: boolean) {
    if (state.on === on) return
    state = { on, card: on ? state.card : null }
    emit()
  },
  show(card: PlantCard | null) {
    state = { ...state, card }
    emit()
  },
}

export function useVegInspect() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
