import { useSyncExternalStore } from 'react'
import type { Population } from './livingEcology.ts'

/**
 * What the page knows of Living Architecture's population (the plan, once the worker has made it) and which organism, or
 * which connection between two, is selected for inspection. Shared by the scene (which picks) and the panel (which
 * shows); a small store, since the two live on either side of the canvas.
 */
export type Selection = { kind: 'organism'; index: number } | { kind: 'link'; index: number } | null

const store: { population: Population | null; selection: Selection; version: number } = { population: null, selection: null, version: 0 }
const listeners = new Set<() => void>()
const emit = () => {
  store.version += 1
  for (const listener of listeners) listener()
}

export function setPopulation(population: Population | null) {
  store.population = population
  store.selection = null
  emit()
}

export function select(selection: Selection) {
  store.selection = selection
  emit()
}

export function currentSelection(): Selection {
  return store.selection
}

/**
 * Where Approach looks: the selected organism (or the middle of the selected connection), how far around it to stand,
 * and from which side (yaw, as approachPose takes it): the side the camera is on now (`from`), turned as little as it
 * takes for no other organism to stand between the camera and the one in focus. Without a selection there is none: Approach
 * then looks at where the camera is already looking, not at any organism.
 */
export function focusPoint(from?: { x: number; z: number }): { x: number; z: number; radius: number; height: number; yaw: number | null } | null {
  const population = store.population
  if (!population) return null
  const s = store.selection
  if (!s) return null
  let point: { x: number; z: number; radius: number; height: number }
  let self = -1
  let other = -1
  if (s?.kind === 'link') {
    const l = population.links[s.index]!
    const a = population.organisms[l.a]!
    const b = population.organisms[l.b]!
    point = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, radius: l.distance / 2 + Math.max(a.radius, b.radius) * 0.5, height: Math.max(a.height, b.height) }
    self = l.a
    other = l.b
  } else {
    self = s.index
    const o = population.organisms[self]!
    point = { x: o.x, z: o.z, radius: o.radius, height: o.height }
  }
  if (!from) return { ...point, yaw: null }
  const dist = Math.max(110, Math.min(420, point.radius * 2.6 + point.height * 1.8 + 40))
  const toward = Math.atan2(from.x - point.x, from.z - point.z)
  const blocked = (yaw: number) => {
    const ux = Math.sin(yaw)
    const uz = Math.cos(yaw)
    return population.organisms.some((o, i) => {
      if (i === self || i === other) return false
      const along = (o.x - point.x) * ux + (o.z - point.z) * uz
      if (along < point.radius * 0.5 || along > dist) return false
      const side = Math.abs((o.x - point.x) * uz - (o.z - point.z) * ux)
      return side < o.radius + 8
    })
  }
  for (const turn of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.2, -2.2, Math.PI]) if (!blocked(toward + turn)) return { ...point, yaw: toward + turn }
  return { ...point, yaw: toward }
}

let lookRequested = false
/** "Look closer": the next time Approach is entered or restored, it turns about the selected organism. */
export function lookCloser() {
  lookRequested = true
}
/** Whether Approach was asked to look at the selection (read once: the request is spent). */
export function takeLookRequest(): boolean {
  const asked = lookRequested
  lookRequested = false
  return asked
}

/**
 * The selected organism's anchor on screen (its top, projected), written by the scene each frame and read by the card:
 * pixels within the canvas, and whether it is in front of the camera and in view.
 */
export const anchor = { x: 0, y: 0, visible: false }

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The population and the selection, re-rendering when either changes. */
export function useLiving(): { population: Population | null; selection: Selection } {
  useSyncExternalStore(subscribe, () => store.version)
  return { population: store.population, selection: store.selection }
}
