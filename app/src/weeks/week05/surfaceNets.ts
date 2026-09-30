import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three'

/** Signed distance: negative inside the form, positive outside. */
export type Sdf = (x: number, y: number, z: number) => number

/**
 * Surface nets: one vertex per grid cell the surface passes through, placed at
 * the mean of the cell's edge crossings, and one quad per grid edge with a
 * sign change. The result is a single welded, closed mesh, so displacement
 * along the normal cannot open cracks. `min` / `max` must leave the form
 * fully inside, with a margin of at least one cell.
 */
export function meshSdf(sdf: Sdf, min: Vector3, max: Vector3, cell: number): BufferGeometry {
  const nx = Math.ceil((max.x - min.x) / cell) + 1
  const ny = Math.ceil((max.y - min.y) / cell) + 1
  const nz = Math.ceil((max.z - min.z) / cell) + 1
  const field = new Float32Array(nx * ny * nz)
  const sample = (x: number, y: number, z: number) => x + nx * (y + ny * z)

  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        field[sample(x, y, z)] = sdf(min.x + x * cell, min.y + y * cell, min.z + z * cell)
      }
    }
  }

  const cx = nx - 1
  const cy = ny - 1
  const cz = nz - 1
  const cellVertex = new Int32Array(cx * cy * cz).fill(-1)
  const cellIndex = (x: number, y: number, z: number) => x + cx * (y + cy * z)
  const positions: number[] = []
  const corner = new Float32Array(8)

  for (let z = 0; z < cz; z += 1) {
    for (let y = 0; y < cy; y += 1) {
      for (let x = 0; x < cx; x += 1) {
        let mask = 0
        for (let i = 0; i < 8; i += 1) {
          const value = field[sample(x + (i & 1), y + ((i >> 1) & 1), z + ((i >> 2) & 1))]!
          corner[i] = value
          if (value < 0) {
            mask |= 1 << i
          }
        }
        if (mask === 0 || mask === 255) {
          continue
        }
        let sx = 0
        let sy = 0
        let sz = 0
        let crossings = 0
        for (let i = 0; i < 8; i += 1) {
          for (let axis = 0; axis < 3; axis += 1) {
            const bit = 1 << axis
            if (i & bit) {
              continue
            }
            const j = i | bit
            const a = corner[i]!
            const b = corner[j]!
            if (a < 0 === b < 0) {
              continue
            }
            const t = a / (a - b)
            sx += (i & 1) + (axis === 0 ? t : 0)
            sy += ((i >> 1) & 1) + (axis === 1 ? t : 0)
            sz += ((i >> 2) & 1) + (axis === 2 ? t : 0)
            crossings += 1
          }
        }
        cellVertex[cellIndex(x, y, z)] = positions.length / 3
        positions.push(
          min.x + (x + sx / crossings) * cell,
          min.y + (y + sy / crossings) * cell,
          min.z + (z + sz / crossings) * cell,
        )
      }
    }
  }

  const indices: number[] = []
  const sampleStride = [1, nx, nx * ny]
  const cellStride = [1, cx, cx * cy]
  // Interior samples only: every edge below has four cells around it, and p + 1 stays in the grid.
  for (let z = 1; z < nz - 1; z += 1) {
    for (let y = 1; y < ny - 1; y += 1) {
      for (let x = 1; x < nx - 1; x += 1) {
        const s = sample(x, y, z)
        const home = cellIndex(x, y, z)
        const inside = field[s]! < 0
        for (let a = 0; a < 3; a += 1) {
          if (inside === field[s + sampleStride[a]!]! < 0) {
            continue
          }
          // (a, b, c) is cyclic, so the quad A → B → C → D is counter-clockwise seen from +a.
          const sb = cellStride[(a + 1) % 3]!
          const sc = cellStride[(a + 2) % 3]!
          const A = cellVertex[home - sb - sc]!
          const B = cellVertex[home - sc]!
          const C = cellVertex[home]!
          const D = cellVertex[home - sb]!
          if (A < 0 || B < 0 || C < 0 || D < 0) {
            continue
          }
          if (inside) {
            indices.push(A, B, C, A, C, D)
          } else {
            indices.push(A, C, B, A, D, C)
          }
        }
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  return geometry
}
