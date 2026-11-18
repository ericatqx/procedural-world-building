import { useSyncExternalStore } from 'react'
import type { OrganismPlan, Population } from './livingEcology.ts'

/**
 * A reversible, visual-only preview of the Architecture Lab's Porous Growth morphologies on existing Living Architecture sites
 * (livingMorphPreview.tsx). Off by default: the world is then exactly as it was. The preview never changes the population, its
 * positions, the terrain, the vegetation or the ecology: it only draws extra meshes, and (in the single-morphology modes) hides the
 * Overhang at the few preview sites while it is on.
 *
 *   off         the world's own Overhang population (nothing is drawn)
 *   spreading   at each preview site, the Overhang is hidden and a Spreading specimen stands in its place
 *   ascending   likewise, Ascending
 *   compare     the Overhang stays, with a Spreading and an Ascending specimen on either side of it, on the terrain there
 * `?morphology=spreading|ascending|compare` sets the starting mode.
 */
export type PreviewMode = 'off' | 'spreading' | 'ascending' | 'compare'
export type PreviewStatus = { built: number; total: number; ms: number }

const initial = (): PreviewMode => {
  if (typeof location === 'undefined') return 'off'
  const m = new URLSearchParams(location.search).get('morphology')
  return m === 'spreading' || m === 'ascending' || m === 'compare' ? m : 'off'
}
const store: { mode: PreviewMode; status: PreviewStatus; version: number } = { mode: initial(), status: { built: 0, total: 0, ms: 0 }, version: 0 }
const listeners = new Set<() => void>()
const emit = () => {
  store.version += 1
  for (const l of listeners) l()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export function setPreviewMode(mode: PreviewMode) {
  store.mode = mode
  emit()
}
export function setPreviewStatus(status: PreviewStatus) {
  store.status = status
  emit()
}
export function usePreview(): { mode: PreviewMode; status: PreviewStatus } {
  useSyncExternalStore(subscribe, () => store.version)
  return { mode: store.mode, status: store.status }
}

/** The few sites previewed: the reference organism first, then the largest others that stand well apart. */
export function previewSites(population: Population, count = 3): number[] {
  const chosen: OrganismPlan[] = [population.organisms[0]!]
  const rest = population.organisms.slice(1).sort((a, b) => (b.form.size ?? 0) - (a.form.size ?? 0))
  for (const o of rest) {
    if (chosen.length >= count) break
    if (chosen.every((c) => Math.hypot(c.x - o.x, c.z - o.z) > 250)) chosen.push(o)
  }
  return chosen.map((o) => o.index)
}
