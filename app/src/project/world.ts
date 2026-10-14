import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
  type BufferGeometry,
} from 'three'
import { DEFAULT_GRID, gridCellCenter, type AnalysisGrid } from './grid.ts'
import { createHydrology, type Hydrology } from './hydrology.ts'
import type { Ground } from './light.ts'
import { createLandmass, ISLAND_SHAPE, type Landmass, type TerrainShape } from './terrain.ts'
import { createChannels, createWaterGeometry, type WaterStats } from './water.ts'

/**
 * Shadow Ecology — the parts of the world that do not change while the
 * simulation runs, read from the terrain once:
 *
 *   terrain → water (drainage, lakes, rivers, channels, falls)
 *
 * Architecture, paths and vegetation live in the simulation (simulation.ts).
 */
export type BaseWorld = {
  landmass: Landmass
  hydrology: Hydrology
  /** Ground height after channels are cut. */
  groundHeight: (x: number, z: number) => number
  /** The same ground on the analysis grid, for tracing light. */
  ground: Ground
  water: BufferGeometry
  waterStats: WaterStats
  /**
   * Ground data for the terrain material, over [−extent, extent]² in xz:
   * R moisture, G vegetation region, B path proximity, A water proximity.
   * G and B are rewritten by the simulation.
   */
  field: DataTexture
  /**
   * Creature habitat suitability over the same extent, rewritten by the
   * simulation: R now, G as it stood before the last sunset (display only).
   */
  habitatField: DataTexture
  fieldExtent: number
}

const WATER_EDGE_RANGE = 0.12
/** Ground height given to cells off the island, so light passes them. */
const OFF_ISLAND = -10

export const byte = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255)

/** `fallBelow`: how far falls drop past the underside before they are gone. */
export function createBaseWorld(
  shape: TerrainShape = ISLAND_SHAPE,
  fallBelow?: number,
  grid: AnalysisGrid = DEFAULT_GRID,
): BaseWorld {
  const hydrology = createHydrology(shape, grid)
  const channels = createChannels(hydrology.rivers, shape, grid)
  const landmass = createLandmass(channels.carve, shape)
  const water = createWaterGeometry(hydrology, channels.groundHeight, landmass.lowest, fallBelow, grid)
  const count = grid.size * grid.size
  const at = (index: number) => gridCellCenter(grid, index)

  const heights = new Float32Array(count).fill(OFF_ISLAND)
  let top = -Infinity
  for (let index = 0; index < heights.length; index += 1) {
    if (hydrology.inside[index]) {
      const [x, z] = at(index)
      heights[index] = channels.groundHeight(x, z)
      top = Math.max(top, heights[index]!)
    }
  }

  const data = new Uint8Array(count * 4)
  for (let index = 0; index < count; index += 1) {
    data[index * 4] = byte(hydrology.moisture[index]!)
    data[index * 4 + 3] = byte(Math.exp(-hydrology.waterDistance[index]! / WATER_EDGE_RANGE))
  }
  return {
    landmass,
    hydrology,
    groundHeight: channels.groundHeight,
    ground: { heights, top },
    water: water.geometry,
    waterStats: water.stats,
    field: gridTexture(data, grid.size),
    habitatField: gridTexture(new Uint8Array(count * 4), grid.size),
    fieldExtent: grid.extent,
  }
}

function gridTexture(data: Uint8Array, size: number): DataTexture {
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}
