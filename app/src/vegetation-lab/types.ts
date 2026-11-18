import type { Geo } from './geo.ts'

export type LightStrategy = 'sun' | 'shade' | 'broad'
export const LIGHT_STRATEGY: Record<LightStrategy, { label: string; colour: string }> = {
  sun: { label: 'Sun specialist', colour: '#d9c79a' },
  shade: { label: 'Shade specialist', colour: '#86a9b8' },
  broad: { label: 'Broad tolerance', colour: '#a9a597' },
}
export type ArchetypeId = 'upland' | 'understory' | 'cover' | 'epiphyte' | 'flood' | 'shore' | 'submerged'

export type PlantParams = {
  seed: number
  /** 0 (young) to 1 (mature). */
  age: number
  /** 0 (deep shade) to 1 (open sun): the light that reaches the plant. */
  light: number
  moisture: number
  /** 0 (sheltered) to 1 (exposed): wind blows along +x. */
  wind: number
  /** Water depth over the base, meters (flood, shore, submerged). */
  depth: number
  /** What a clinging plant grows on. */
  surface: 'rock' | 'architecture'
  /** Grow on an invisible surface (the plant only): for placing plants on the island's own surfaces. */
  bare?: boolean
}

export type Candidate = {
  id: string
  archetype: ArchetypeId
  /** Its light strategy, which is species identity, not a response: a sun specialist, a shade specialist, or a plant of broad tolerance. */
  light?: LightStrategy
  name: string
  /** How it is grown. */
  strategy: string
  /** What it is adapted to, and what the controls change. */
  adaptation: string
  /** Typical mature height, meters: sets the camera. */
  size: number
  /** The real-world growth strategies it draws on, and which rules are approximations or abstractions. */
  basis?: string
  /** Which extra controls matter. */
  depth?: boolean
  surface?: boolean
  build: (g: Geo, p: PlantParams, r: () => number) => void
}

export const ARCHETYPES: { id: ArchetypeId; label: string; ecology: string }[] = [
  { id: 'upland', label: 'Upland trees', ecology: 'Sun-loving woody plants on open slopes' },
  { id: 'understory', label: 'Understory', ecology: 'Under groves and structures: the shade specialist and shade-tolerant shrubs' },
  { id: 'cover', label: 'Ground cover', ecology: 'Low mats and rosettes in soil and rock crevices' },
  { id: 'epiphyte', label: 'Clinging plants', ecology: 'Growth on Living Architecture and rock' },
  { id: 'flood', label: 'Flood-tolerant trees', ecology: 'Woody plants rooted in shallow fresh water' },
  { id: 'shore', label: 'Shoreline plants', ecology: 'Emergent clusters on wet lake margins' },
  { id: 'submerged', label: 'Submerged plants', ecology: 'Anchored aquatic plants in lit shallows' },
]
