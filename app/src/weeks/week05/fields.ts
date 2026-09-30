import { BufferAttribute, type BufferGeometry } from 'three'

/** Vertex attribute: path length along the surface from the floor contact, 0…1. */
export const GROWTH_AGE_ATTRIBUTE = 'aGrowthAge'
/** Vertex attribute: 0 in crevices, 0.5 on flat or straight faces, 1 on ridges, edges and tips. */
export const CONVEXITY_ATTRIBUTE = 'aConvexity'

const FLOOR_EPSILON = 1e-3
/** Laplacian passes for the smoothed copy; more passes measure convexity at a larger scale. */
const CONVEXITY_SMOOTHING = 24
/** Passes over the convexity values themselves, to settle single-vertex noise. */
const CONVEXITY_SETTLE = 3
/** Convexity that maps to 0 and 1, as a percentile of |convexity|. */
const CONVEXITY_PERCENTILE = 0.95

/** Vertex neighbours from the triangle index, in compressed rows. */
type Adjacency = { start: Int32Array; neighbours: Int32Array }

function buildAdjacency(geometry: BufferGeometry): Adjacency {
  const count = geometry.getAttribute('position').count
  const index = geometry.getIndex()!.array
  const degree = new Int32Array(count)
  for (let t = 0; t < index.length; t += 3) {
    for (let e = 0; e < 3; e += 1) {
      degree[index[t + e]!]! += 2
    }
  }
  const start = new Int32Array(count + 1)
  for (let i = 0; i < count; i += 1) {
    start[i + 1] = start[i]! + degree[i]!
  }
  const fill = start.slice(0, count)
  const neighbours = new Int32Array(start[count]!)
  for (let t = 0; t < index.length; t += 3) {
    for (let e = 0; e < 3; e += 1) {
      const a = index[t + e]!
      const b = index[t + ((e + 1) % 3)]!
      neighbours[fill[a]!++] = b
      neighbours[fill[b]!++] = a
    }
  }
  return { start, neighbours }
}

/**
 * Growth age: Dijkstra over mesh edges from every vertex resting on the
 * floor, so growth climbs the form the way a surface process would, never
 * jumping through the air. Normalised so the last vertex reached is 1.
 */
function computeGrowthAge(geometry: BufferGeometry, { start, neighbours }: Adjacency): Float32Array {
  const position = geometry.getAttribute('position')
  const count = position.count
  const distance = new Float64Array(count).fill(Infinity)
  const heap: number[] = []
  const heapKey: number[] = []

  const push = (vertex: number, key: number) => {
    let i = heap.length
    heap.push(vertex)
    heapKey.push(key)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (heapKey[parent]! <= key) {
        break
      }
      heap[i] = heap[parent]!
      heapKey[i] = heapKey[parent]!
      i = parent
    }
    heap[i] = vertex
    heapKey[i] = key
  }
  const pop = (): number => {
    const top = heap[0]!
    const lastVertex = heap.pop()!
    const lastKey = heapKey.pop()!
    if (heap.length > 0) {
      let i = 0
      for (;;) {
        const left = 2 * i + 1
        if (left >= heap.length) {
          break
        }
        const right = left + 1
        const child = right < heap.length && heapKey[right]! < heapKey[left]! ? right : left
        if (heapKey[child]! >= lastKey) {
          break
        }
        heap[i] = heap[child]!
        heapKey[i] = heapKey[child]!
        i = child
      }
      heap[i] = lastVertex
      heapKey[i] = lastKey
    }
    return top
  }

  for (let i = 0; i < count; i += 1) {
    if (position.getY(i) <= FLOOR_EPSILON) {
      distance[i] = 0
      push(i, 0)
    }
  }
  while (heap.length > 0) {
    const key = heapKey[0]!
    const vertex = pop()
    if (key > distance[vertex]!) {
      continue
    }
    const x = position.getX(vertex)
    const y = position.getY(vertex)
    const z = position.getZ(vertex)
    for (let k = start[vertex]!; k < start[vertex + 1]!; k += 1) {
      const next = neighbours[k]!
      const dx = position.getX(next) - x
      const dy = position.getY(next) - y
      const dz = position.getZ(next) - z
      const candidate = key + Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (candidate < distance[next]!) {
        distance[next] = candidate
        push(next, candidate)
      }
    }
  }

  let longest = 0
  for (let i = 0; i < count; i += 1) {
    if (Number.isFinite(distance[i]!)) {
      longest = Math.max(longest, distance[i]!)
    }
  }
  const age = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    age[i] = Number.isFinite(distance[i]!) ? distance[i]! / Math.max(longest, 1e-6) : 1
  }
  return age
}

function smoothScalar(values: Float32Array, { start, neighbours }: Adjacency, passes: number) {
  const next = new Float32Array(values.length)
  for (let pass = 0; pass < passes; pass += 1) {
    for (let i = 0; i < values.length; i += 1) {
      let sum = 0
      for (let k = start[i]!; k < start[i + 1]!; k += 1) {
        sum += values[neighbours[k]!]!
      }
      const n = start[i + 1]! - start[i]!
      next[i] = n > 0 ? 0.5 * values[i]! + (0.5 * sum) / n : values[i]!
    }
    values.set(next)
  }
}

/**
 * Convexity: how far each vertex stands out from a smoothed copy of the form,
 * measured along its normal. Smoothing pulls ridges in and pushes hollows
 * out, so the offset is positive on convex parts and negative in crevices.
 */
function computeConvexity(geometry: BufferGeometry, adjacency: Adjacency): Float32Array {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const count = position.count
  const channels = [0, 1, 2].map((axis) => {
    const values = new Float32Array(count)
    for (let i = 0; i < count; i += 1) {
      values[i] = position.getComponent(i, axis)
    }
    smoothScalar(values, adjacency, CONVEXITY_SMOOTHING)
    return values
  })
  const offset = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    offset[i] =
      (position.getX(i) - channels[0]![i]!) * normal.getX(i) +
      (position.getY(i) - channels[1]![i]!) * normal.getY(i) +
      (position.getZ(i) - channels[2]![i]!) * normal.getZ(i)
  }
  smoothScalar(offset, adjacency, CONVEXITY_SETTLE)
  const magnitudes = Array.from(offset, Math.abs).sort((a, b) => a - b)
  const scale = Math.max(magnitudes[Math.floor((magnitudes.length - 1) * CONVEXITY_PERCENTILE)] ?? 0, 1e-6)
  const convexity = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    convexity[i] = Math.min(1, Math.max(0, 0.5 + (0.5 * offset[i]!) / scale))
  }
  return convexity
}

/** Adds the per-vertex fields the Growth and Exposure studies read. */
export function addSurfaceFields(geometry: BufferGeometry) {
  const adjacency = buildAdjacency(geometry)
  geometry.setAttribute(GROWTH_AGE_ATTRIBUTE, new BufferAttribute(computeGrowthAge(geometry, adjacency), 1))
  geometry.setAttribute(CONVEXITY_ATTRIBUTE, new BufferAttribute(computeConvexity(geometry, adjacency), 1))
}
