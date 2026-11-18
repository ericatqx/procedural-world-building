import { useSyncExternalStore } from 'react'

/**
 * Shadow Ecology 0.3 — THE TWO EXPERIENCES (Round 08I), one world: EXPLORE WORLD (the piece: exploration, creatures, Living Architecture
 * cards, the Guide) and HOW IT'S MADE (the process: data layers and inspection; later system walkthroughs and Build Replay). The world, the
 * camera and the time are shared; only what is layered over the world and what the panel holds change. A tiny store, read outside React too
 * (the Living Architecture picker and Inspect's probe consult it on every click).
 */
export type Experience = 'explore' | 'made'

let current: Experience = 'explore'
const listeners = new Set<() => void>()

export const getExperience = () => current

export function setExperience(next: Experience) {
  if (next === current) return
  current = next
  for (const l of listeners) l()
}

export function useExperience(): Experience {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
