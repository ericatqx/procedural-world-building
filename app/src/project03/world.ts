import { createWater, type WaterSystem } from './water.ts'

/**
 * One coherent world from one seed. The terrain is a function of the seed
 * (terrain.ts); every system placed on it is a function of the seed and the
 * terrain, drawing from its own named channel (`deriveSeed(seed, 'water')`),
 * so adding a system never reshuffles the ones before it.
 *
 * Order is the dependency order: water reads the ground; rivers will read the
 * water's outlets; vegetation will read the water's depth and the ground;
 * architecture will read all three. Each is added here as a field.
 */
export type World = {
  seed: number
  water: WaterSystem
}

/** The terrain seed must already be set (`setTerrainSeed(seed)`). */
export function createWorld(seed: number): World {
  return { seed, water: createWater(seed) }
}
