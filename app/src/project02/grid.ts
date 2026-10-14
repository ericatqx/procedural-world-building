import { MinHeap, NEIGHBOURS, smoothTrace } from '../project/grid.ts'
import { WORLD_SCALE } from './core.ts'
import { LAND_EXTENT, LAND_GRID_SIZE } from './landform.ts'

/**
 * Shadow Ecology 0.2 — the analysis grid of the larger landmass, in world
 * units. Same indexing as the hydrology grid (landform.ts), each cell
 * covering WORLD_SCALE more ground. Cell (i, j) covers x along i and z
 * along j; index = i + j * GRID_SIZE.
 */
export { MinHeap, NEIGHBOURS, smoothTrace }

export const GRID_SIZE = LAND_GRID_SIZE
export const GRID_EXTENT = LAND_EXTENT * WORLD_SCALE
export const CELL = (2 * GRID_EXTENT) / GRID_SIZE

export const cellIndex = (i: number, j: number) => i + j * GRID_SIZE

export const cellX = (i: number) => -GRID_EXTENT + (i + 0.5) * CELL

export const cellCenter = (index: number): [number, number] => {
  const i = index % GRID_SIZE
  return [cellX(i), cellX((index - i) / GRID_SIZE)]
}

/** Bilinear sample of a per-cell field at world (x, z). */
export function sampleGrid(field: ArrayLike<number>, x: number, z: number): number {
  const fx = Math.min(GRID_SIZE - 1, Math.max(0, (x + GRID_EXTENT) / CELL - 0.5))
  const fz = Math.min(GRID_SIZE - 1, Math.max(0, (z + GRID_EXTENT) / CELL - 0.5))
  const i = Math.min(GRID_SIZE - 2, Math.floor(fx))
  const j = Math.min(GRID_SIZE - 2, Math.floor(fz))
  const tx = fx - i
  const tz = fz - j
  const a = field[cellIndex(i, j)]!
  const b = field[cellIndex(i + 1, j)]!
  const c = field[cellIndex(i, j + 1)]!
  const d = field[cellIndex(i + 1, j + 1)]!
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz
}

/** Grid cell holding (x, z), or −1 off the grid. */
export function cellOf(x: number, z: number): number {
  const i = Math.floor((x + GRID_EXTENT) / CELL)
  const j = Math.floor((z + GRID_EXTENT) / CELL)
  return i >= 0 && j >= 0 && i < GRID_SIZE && j < GRID_SIZE ? cellIndex(i, j) : -1
}
