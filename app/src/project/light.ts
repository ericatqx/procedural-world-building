import { cellCenter, cellIndex, GRID_EXTENT, GRID_SIZE, sampleGrid } from './grid.ts'
import { SUNRISE_HOUR, SUNSET_HOUR, sunAt } from './sun.ts'

/**
 * Shadow Ecology — the light field on the CPU, from the same sun model the
 * scene lights with. Rays march towards the sun over the ground grid and
 * through the architecture voxels, so the simulation sees the same shadows
 * the shadow map draws (at grid resolution).
 */
/** Finer than a voxel, so rays cannot step through a one-voxel wall. */
const RAY_STEP = 0.055
/** Rays start this far off the surface so they don't hit their own origin. */
const RAY_START = 0.03
const DAY_SAMPLES = 10
const GROUND_OFFSET = 0.02
const NORMAL_STEP = 0.05

/** Solid matter other than the terrain, e.g. architecture. */
export type Solid = {
  isSolid: (x: number, y: number, z: number) => boolean
  /** Nothing is solid above this height. */
  top: number
}

/** Ground heights per grid cell; very low outside the island so rays pass. */
export type Ground = { heights: Float32Array; top: number }

export type SunSample = { direction: [number, number, number]; weight: number }

/** The sun across one day, sampled evenly between sunrise and sunset. */
export function daySamples(noonElevation: number): SunSample[] {
  const samples: SunSample[] = []
  for (let k = 0; k < DAY_SAMPLES; k += 1) {
    const hour = SUNRISE_HOUR + ((k + 0.5) * (SUNSET_HOUR - SUNRISE_HOUR)) / DAY_SAMPLES
    const sun = sunAt(hour, noonElevation)
    if (sun.daylight > 0) {
      samples.push({ direction: sun.direction, weight: sun.daylight })
    }
  }
  return samples
}

/** True when nothing blocks the way from (x, y, z) towards the sun. */
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
 * Daily direct sunlight on the ground per grid cell, relative to open flat
 * ground: Σ visible · max(n·l, 0) · daylight over the day's samples. 0 under
 * cover or in shade all day; about 1 in the open; above 1 on slopes facing
 * the sun. Traced on every other cell and filled in between.
 */
export function dailyInsolation(
  ground: Ground,
  inside: Uint8Array,
  solid: Solid | null,
  noonElevation: number,
): Float32Array {
  const samples = daySamples(noonElevation)
  const reference = samples.reduce((sum, s) => sum + s.weight * Math.max(s.direction[1], 0), 0)
  const field = new Float32Array(GRID_SIZE * GRID_SIZE)
  const traced = new Uint8Array(GRID_SIZE * GRID_SIZE)
  if (reference <= 0) {
    return field
  }

  for (let j = 0; j < GRID_SIZE; j += 2) {
    for (let i = 0; i < GRID_SIZE; i += 2) {
      const index = cellIndex(i, j)
      traced[index] = 1
      if (!inside[index]) {
        continue
      }
      const [x, z] = cellCenter(index)
      const h = (px: number, pz: number) => sampleGrid(ground.heights, px, pz)
      const y = h(x, z) + GROUND_OFFSET
      if (solid?.isSolid(x, y + GROUND_OFFSET, z)) {
        continue
      }
      const gx = (h(x + NORMAL_STEP, z) - h(x - NORMAL_STEP, z)) / (2 * NORMAL_STEP)
      const gz = (h(x, z + NORMAL_STEP) - h(x, z - NORMAL_STEP)) / (2 * NORMAL_STEP)
      const length = Math.hypot(gx, 1, gz)
      const nx = -gx / length
      const ny = 1 / length
      const nz = -gz / length
      let sum = 0
      for (const { direction, weight } of samples) {
        const facing = nx * direction[0] + ny * direction[1] + nz * direction[2]
        if (facing > 0 && sunVisible(x, y, z, direction, ground, solid)) {
          sum += weight * facing
        }
      }
      field[index] = sum / reference
    }
  }

  for (let j = 0; j < GRID_SIZE; j += 1) {
    for (let i = 0; i < GRID_SIZE; i += 1) {
      const index = cellIndex(i, j)
      if (traced[index] || !inside[index]) {
        continue
      }
      let sum = 0
      let count = 0
      for (let dj = -1; dj <= 1; dj += 1) {
        for (let di = -1; di <= 1; di += 1) {
          const ni = i + di
          const nj = j + dj
          if (ni >= 0 && nj >= 0 && ni < GRID_SIZE && nj < GRID_SIZE && traced[cellIndex(ni, nj)]) {
            sum += field[cellIndex(ni, nj)]!
            count += 1
          }
        }
      }
      field[index] = count > 0 ? sum / count : 0
    }
  }
  return field
}
