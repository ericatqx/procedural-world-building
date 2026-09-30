/**
 * Shadow Ecology — the square analysis grid the world's derived layers
 * (water, paths, vegetation) are computed on. Cell (i, j) covers x along i
 * and z along j; index = i + j * GRID_SIZE.
 */
export const GRID_SIZE = 144
export const GRID_EXTENT = 3.4
export const CELL = (2 * GRID_EXTENT) / GRID_SIZE

export const cellX = (i: number) => -GRID_EXTENT + (i + 0.5) * CELL
export const cellIndex = (i: number, j: number) => i + j * GRID_SIZE

/** 8-neighbour offsets with their step lengths in cells. */
export const NEIGHBOURS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
]

export function forEachNeighbour(
  index: number,
  visit: (neighbour: number, stepCells: number) => void,
) {
  const i = index % GRID_SIZE
  const j = (index - i) / GRID_SIZE
  for (const [di, dj, step] of NEIGHBOURS) {
    const ni = i + di
    const nj = j + dj
    if (ni >= 0 && nj >= 0 && ni < GRID_SIZE && nj < GRID_SIZE) {
      visit(cellIndex(ni, nj), step)
    }
  }
}

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

/** Binary min-heap of cell indices keyed by a number. */
export class MinHeap {
  private keys: number[] = []
  private items: number[] = []

  get size() {
    return this.items.length
  }

  push(item: number, key: number) {
    this.keys.push(key)
    this.items.push(item)
    let n = this.items.length - 1
    while (n > 0) {
      const parent = (n - 1) >> 1
      if (this.keys[parent]! <= key) {
        break
      }
      this.swap(n, parent)
      n = parent
    }
  }

  pop(): number {
    const top = this.items[0]!
    const lastKey = this.keys.pop()!
    const lastItem = this.items.pop()!
    if (this.items.length > 0) {
      this.keys[0] = lastKey
      this.items[0] = lastItem
      let n = 0
      for (;;) {
        const left = 2 * n + 1
        const right = left + 1
        let smallest = n
        if (left < this.items.length && this.keys[left]! < this.keys[smallest]!) {
          smallest = left
        }
        if (right < this.items.length && this.keys[right]! < this.keys[smallest]!) {
          smallest = right
        }
        if (smallest === n) {
          break
        }
        this.swap(n, smallest)
        n = smallest
      }
    }
    return top
  }

  private swap(a: number, b: number) {
    ;[this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!]
    ;[this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!]
  }
}

/** A polyline point carrying one extra value (e.g. flow) that smooths with it. */
export type TracePoint = { x: number; z: number; value: number }

/** Chaikin corner cutting; endpoints stay fixed. */
export function smoothTrace(points: TracePoint[], iterations: number): TracePoint[] {
  let current = points
  for (let n = 0; n < iterations && current.length > 2; n += 1) {
    const next: TracePoint[] = [current[0]!]
    for (let k = 0; k < current.length - 1; k += 1) {
      const a = current[k]!
      const b = current[k + 1]!
      const lerp = (t: number): TracePoint => ({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        value: a.value + (b.value - a.value) * t,
      })
      next.push(lerp(0.25), lerp(0.75))
    }
    next.push(current[current.length - 1]!)
    current = next
  }
  return current
}

/** Distance from (x, z) to segment a→b, and the parameter t of the closest point. */
export function segmentDistance(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { distance: number; t: number } {
  const dx = bx - ax
  const dz = bz - az
  const lengthSq = dx * dx + dz * dz
  const t = lengthSq > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSq)) : 0
  return { distance: Math.hypot(x - ax - dx * t, z - az - dz * t), t }
}
