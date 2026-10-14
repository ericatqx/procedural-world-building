import type { Ground, Solid } from '../project/light.ts'
import { GRID_EXTENT, sampleGrid } from './grid.ts'

/**
 * Shadow Ecology 0.2 — 0.1's sun ray (light.ts) on 0.2's scaled grid: marches
 * from (x, y, z) towards the sun over the ground heights and through any
 * solid, so growth and the light field see the shadows the scene draws.
 */
export { daySamples, type Ground, type Solid, type SunSample } from '../project/light.ts'

/** Finer than a Low voxel, so rays cannot step through a one-voxel wall. */
const RAY_STEP = 0.055
/** Rays start this far off the surface so they don't hit their own origin. */
const RAY_START = 0.03

/** True when nothing blocks the way from (x, y, z) towards `direction`. */
export function sunVisible(
  x: number,
  y: number,
  z: number,
  direction: readonly [number, number, number],
  ground: Ground,
  solid: Solid | null,
): boolean {
  const [dx, dy, dz] = direction
  const top = Math.max(ground.top, solid?.top ?? -Infinity)
  let px = x + dx * RAY_START
  let py = y + dy * RAY_START
  let pz = z + dz * RAY_START
  for (;;) {
    if (py > top || Math.abs(px) > GRID_EXTENT || Math.abs(pz) > GRID_EXTENT) {
      return true
    }
    if (py < sampleGrid(ground.heights, px, pz) || solid?.isSolid(px, py, pz)) {
      return false
    }
    px += dx * RAY_STEP
    py += dy * RAY_STEP
    pz += dz * RAY_STEP
  }
}

/**
 * The same ray against the solid alone: with the terrain's answer cached,
 * only the architecture's height band needs marching.
 */
export function clearOfSolid(x: number, y: number, z: number, direction: readonly [number, number, number], solid: Solid): boolean {
  const [dx, dy, dz] = direction
  let px = x + dx * RAY_START
  let py = y + dy * RAY_START
  let pz = z + dz * RAY_START
  for (;;) {
    if (py > solid.top || Math.abs(px) > GRID_EXTENT || Math.abs(pz) > GRID_EXTENT) return true
    if (solid.isSolid(px, py, pz)) return false
    px += dx * RAY_STEP
    py += dy * RAY_STEP
    pz += dz * RAY_STEP
  }
}
