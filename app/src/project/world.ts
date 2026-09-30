import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
  type BufferGeometry,
} from 'three'
import { cellCenter, GRID_EXTENT, GRID_SIZE } from './grid.ts'
import { createHydrology, type Hydrology } from './hydrology.ts'
import type { Ground } from './light.ts'
import { createLandmass, type Landmass } from './terrain.ts'
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

export function createBaseWorld(): BaseWorld {
  const hydrology = createHydrology()
  const channels = createChannels(hydrology.rivers)
  const landmass = createLandmass(channels.carve)
  const water = createWaterGeometry(hydrology, channels.groundHeight, landmass.lowest)

  const heights = new Float32Array(GRID_SIZE * GRID_SIZE).fill(OFF_ISLAND)
  let top = -Infinity
  for (let index = 0; index < heights.length; index += 1) {
    if (hydrology.inside[index]) {
      const [x, z] = cellCenter(index)
      heights[index] = channels.groundHeight(x, z)
      top = Math.max(top, heights[index]!)
    }
  }

  const data = new Uint8Array(GRID_SIZE * GRID_SIZE * 4)
  for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 1) {
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
    field: gridTexture(data),
    habitatField: gridTexture(new Uint8Array(GRID_SIZE * GRID_SIZE * 4)),
    fieldExtent: GRID_EXTENT,
  }
}

function gridTexture(data: Uint8Array): DataTexture {
  const texture = new DataTexture(data, GRID_SIZE, GRID_SIZE, RGBAFormat, UnsignedByteType)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}
