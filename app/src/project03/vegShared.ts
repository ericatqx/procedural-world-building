import type { IslandFields, RegionFields } from './vegFields.ts'
import type { Habitat } from './vegHabitat.ts'

/**
 * What the two vegetation renderers share, written by the ground-cover component (Vegetation.tsx) and read by the Lab-plant
 * renderer (WorldPlants.tsx): the island's fields, the near tiles (their 3 m fields and the architecture's habitat), where the
 * camera is looking, and a counter that changes whenever the architecture does.
 */
export type SharedTile = { key: string; ti: number; tj: number; fields: RegionFields; habitat: Habitat | null }

export const shared: { island: IslandFields | null; tiles: Map<string, SharedTile>; focus: { x: number; z: number; above: number; ready: boolean }; archVersion: number } = {
  island: null,
  tiles: new Map(),
  focus: { x: 0, z: 0, above: 1e5, ready: false },
  archVersion: 0,
}
