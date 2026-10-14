import { ClampToEdgeWrapping, DataTexture, LinearFilter, RGBAFormat, UnsignedByteType } from 'three'
import { byte } from '../project/world.ts'
import { smoothstep } from './core.ts'
import { stepCost, waterDepth } from './creatures.ts'
import type { Fields } from './fields.ts'
import { GRID_SIZE } from './grid.ts'
import type { Statics } from './statics.ts'

/**
 * Shadow Ecology 0.2 — ways of seeing. Each re-weights what the same world
 * shows (Perceptual Reality) and, when embodied, where the camera stands
 * (Embodied Perspective):
 *
 *   World         the world as it is: matter, light, weather, plants
 *   Architecture  opportunity and risk: daily light, where growth could
 *                 root, collapse; on the structure pale where supported,
 *                 gold where sunlit, red as it nears failure; the fronts
 *   Habitat       the conditions life responds to, from the existing
 *                 suitability fields: warm where exposed conditions favour
 *                 light-seeking life, cool where sheltered conditions favour
 *                 shadow-seeking life, stronger where more suitable
 *   Creature      what the selected niche reads: shelter, water access and
 *                 routes (walkers), shallows, wet margins and routes
 *                 (waders), or open air, flyways and perches (flyers);
 *                 ground the niche cannot cross is darkened
 *
 * The ground overlay is three channels (R, G, B of the perception texture),
 * drawn as quiet tints and contour lines over a dimmed world rather than as
 * a heatmap; A darkens what is out of reach.
 */
export type WayOfSeeing = 'world' | 'architecture' | 'habitat' | 'creature'
export const WAYS: readonly WayOfSeeing[] = ['world', 'architecture', 'habitat', 'creature']

/** A creature way of seeing reads the world as a walker, a wader or a flyer. */
export type CreatureView = 'ground' | 'wading' | 'flying'

export const WAY_LABELS: Record<WayOfSeeing, string> = {
  world: 'World',
  architecture: 'Architecture',
  habitat: 'Habitat',
  creature: 'Creature',
}

/** The three overlay channels of a view: colour, fill strength, and whether a contour marks it. */
export type SenseChannel = { label: string; color: string; fill: number; line: boolean }
export type SenseKey = 'world' | 'architecture' | 'habitat' | CreatureView

export const SENSE: Record<SenseKey, readonly SenseChannel[]> = {
  world: [],
  architecture: [
    { label: 'Light · opportunity', color: '#ffd27a', fill: 0.28, line: false },
    { label: 'Supported', color: '#f4efe2', fill: 0, line: true },
    { label: 'Stress · failure', color: '#ff6a3d', fill: 0.4, line: false },
  ],
  habitat: [
    { label: 'Exposed · light-favouring', color: '#f0a35e', fill: 0.62, line: false },
    { label: 'Sheltered · shadow-favouring', color: '#6fa8d6', fill: 0.62, line: false },
  ],
  ground: [
    { label: 'Shelter', color: '#7fc29b', fill: 0.5, line: true },
    { label: 'Water access', color: '#6f8cff', fill: 0.45, line: false },
    { label: 'Routes', color: '#f1ece2', fill: 0.6, line: false },
  ],
  wading: [
    { label: 'Shallows', color: '#6f8cff', fill: 0.5, line: true },
    { label: 'Wet margins', color: '#7fc29b', fill: 0.4, line: false },
    { label: 'Routes', color: '#f1ece2', fill: 0.6, line: false },
  ],
  flying: [
    { label: 'Open air', color: '#dfe7f2', fill: 0.3, line: true },
    { label: 'Flyways', color: '#ffffff', fill: 0.6, line: false },
  ],
}

export const senseKey = (way: WayOfSeeing, creature: CreatureView): SenseKey => (way === 'creature' ? creature : way)

export function createPerceptionTexture(): DataTexture {
  const texture = new DataTexture(new Uint8Array(GRID_SIZE * GRID_SIZE * 4), GRID_SIZE, GRID_SIZE, RGBAFormat, UnsignedByteType)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

/** Writes the view's channels from the fields. */
export function writePerception(
  texture: DataTexture,
  key: SenseKey,
  statics: Statics,
  fields: Fields,
  seedable: Float32Array | null,
  suitability: { exposureSuit: Float32Array; shelterSuit: Float32Array },
) {
  const data = texture.image.data as Uint8Array
  const top = statics.ground.top
  for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 1) {
    const o = index * 4
    data[o + 3] = 0
    if (!statics.inside[index] || key === 'world') {
      data[o] = data[o + 1] = data[o + 2] = 0
      continue
    }
    if (key === 'architecture') {
      data[o] = byte(smoothstep(0.55, 1.1, fields.insolation[index]!))
      data[o + 1] = byte(seedable ? Math.min(1, seedable[index]! * 1.8) : 0)
      data[o + 2] = byte(Math.max(fields.rubble[index]! / 0.06, fields.disturbance[index]! * 0.6))
    } else if (key === 'habitat') {
      // Light, shelter, moisture, slope and calm, as the suitability fields already combine them;
      // where both are possible the leading condition keeps its strength and the other recedes.
      const exposed = suitability.exposureSuit[index]!
      const sheltered = suitability.shelterSuit[index]!
      const lead = smoothstep(-0.15, 0.15, exposed - sheltered)
      data[o] = byte(exposed * (0.35 + 0.65 * lead) * 1.25)
      data[o + 1] = byte(sheltered * (0.35 + 0.65 * (1 - lead)) * 1.25)
      data[o + 2] = 0
    } else if (key === 'ground') {
      const waterNear = Math.exp(-statics.base.hydrology.waterDistance[index]! / 0.1)
      data[o] = byte(fields.habitat[index]! * 1.4)
      data[o + 1] = byte(statics.water[index] ? 0 : waterNear)
      data[o + 2] = byte(Math.max(fields.wear[index]! * 1.5, fields.abandoned[index]! * 0.4))
      data[o + 3] = Number.isFinite(stepCost(statics, fields, index, 'walker')) ? 0 : 255
    } else if (key === 'wading') {
      const depth = waterDepth(statics, fields, index)
      data[o] = byte(statics.water[index] ? 1 - smoothstep(0.1, 0.32, depth) : 0)
      data[o + 1] = byte(statics.water[index] ? 0 : 1 - smoothstep(0.08, 0.45, statics.base.hydrology.waterDistance[index]!))
      data[o + 2] = byte(Math.max(fields.wear[index]! * 1.5, fields.abandoned[index]! * 0.4))
      data[o + 3] = Number.isFinite(stepCost(statics, fields, index, 'wader')) ? 0 : 255
    } else {
      const ground = statics.ground.heights[index]!
      const altitude = smoothstep(-1, top + 0.3, ground + fields.archHeight[index]!)
      const open = 1 - statics.enclosure[index]!
      data[o] = byte(altitude * open)
      data[o + 1] = byte(fields.flyway[index]! * 2.5)
      data[o + 2] = 0
    }
  }
  texture.needsUpdate = true
}
