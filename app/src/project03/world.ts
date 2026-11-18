import { createRivers, type RiverSystem } from './rivers.ts'
import { setTerrainCarve } from './terrain.ts'
import { createWater, type WaterSystem } from './water.ts'

/**
 * One coherent world from one seed. The terrain is a function of the seed
 * (terrain.ts); every system placed on it is a function of the seed and the
 * terrain, drawing from its own named channel (`deriveSeed(seed, 'water')`),
 * so adding a system never reshuffles the ones before it.
 *
 * Order is the dependency order: water reads the ground; rivers read the ground
 * and the lakes, then cut their channels into it; vegetation will read the water's depth and the ground;
 * architecture will read all three. Each is added here as a field.
 */
export type World = {
  seed: number
  water: WaterSystem
  rivers: RiverSystem
}

/** The terrain seed must already be set (`setTerrainSeed(seed)`). */
export function createWorld(seed: number): World {
  // Lakes and rivers are read from the uncut ground; the rivers then cut their channels into it.
  setTerrainCarve(null)
  const water = createWater(seed)
  const rivers = createRivers(water)
  setTerrainCarve(rivers.carve)
  return { seed, water, rivers }
}

let last: World | null = null

/**
 * The world for a seed, made once: asking again for the same seed (a remount, React's strict double render) returns
 * the same world, with its rivers' carve put back on the terrain, instead of making the water and rivers again.
 */
export function worldFor(seed: number): World {
  if (last?.seed === seed) {
    setTerrainCarve(last.rivers.carve)
    return last
  }
  last = createWorld(seed)
  return last
}

/** The world last made (the one the 3D view is showing), or null before any: for read-only views of its data (the Project page's data plate). */
export function currentWorld(): World | null {
  return last
}
