import { volumeIndex, type DensityVolume } from './buildVolume.ts'
import { EDGE_TABLE, TRI_TABLE } from './marchingCubesTables.ts'
import type { MeshBuffers } from './meshBlocks.ts'

/** Corner offsets of a unit cube (Marching Cubes order). */
const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 0, 1],
  [0, 0, 1],
  [0, 1, 0],
  [1, 1, 0],
  [1, 1, 1],
  [0, 1, 1],
] as const

/** Edge endpoint corner indices. */
const EDGES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
] as const

function densityAt(
  volume: DensityVolume,
  ix: number,
  iy: number,
  iz: number,
): number {
  const r = volume.resolution
  if (ix < 0 || iy < 0 || iz < 0 || ix >= r || iy >= r || iz >= r) {
    return -1
  }
  return volume.densities[volumeIndex(ix, iy, iz, r)]!
}

function lerpEdge(da: number, db: number): number {
  if (Math.abs(da - db) < 1e-6) {
    return 0.5
  }
  return da / (da - db)
}

/**
 * Educational Marching Cubes: smooth isosurface where density crosses 0.
 */
export function meshMarchingCubes(volume: DensityVolume): MeshBuffers {
  const r = volume.resolution
  const denom = Math.max(1, r - 1)
  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []

  const toWorld = (gx: number, gy: number, gz: number) => [
    (gx / denom) * 2 - 1,
    (gy / denom) * 2 - 1,
    (gz / denom) * 2 - 1,
  ] as const

  for (let iz = 0; iz < r - 1; iz++) {
    for (let iy = 0; iy < r - 1; iy++) {
      for (let ix = 0; ix < r - 1; ix++) {
        let cubeIndex = 0
        const vals = new Array<number>(8)
        for (let c = 0; c < 8; c++) {
          const [cx, cy, cz] = CORNERS[c]!
          const d = densityAt(volume, ix + cx, iy + cy, iz + cz)
          vals[c] = d
          if (d > 0) {
            cubeIndex |= 1 << c
          }
        }

        const edgeMask = EDGE_TABLE[cubeIndex]!
        if (edgeMask === 0) {
          continue
        }

        const vertList: ([number, number, number] | null)[] = Array(12).fill(null)

        for (let e = 0; e < 12; e++) {
          if ((edgeMask & (1 << e)) === 0) {
            continue
          }
          const [a, b] = EDGES[e]!
          const [ax, ay, az] = CORNERS[a]!
          const [bx, by, bz] = CORNERS[b]!
          const t = lerpEdge(vals[a]!, vals[b]!)
          const gx = ix + ax + (bx - ax) * t
          const gy = iy + ay + (by - ay) * t
          const gz = iz + az + (bz - az) * t
          vertList[e] = [...toWorld(gx, gy, gz)]
        }

        const tri = TRI_TABLE[cubeIndex]!
        for (let i = 0; tri[i] !== -1; i += 3) {
          const va = vertList[tri[i]!]
          const vb = vertList[tri[i + 1]!]
          const vc = vertList[tri[i + 2]!]
          if (!va || !vb || !vc) {
            continue
          }

          const e1x = vb[0] - va[0]
          const e1y = vb[1] - va[1]
          const e1z = vb[2] - va[2]
          const e2x = vc[0] - va[0]
          const e2y = vc[1] - va[1]
          const e2z = vc[2] - va[2]
          let nx = e1y * e2z - e1z * e2y
          let ny = e1z * e2x - e1x * e2z
          let nz = e1x * e2y - e1y * e2x
          const len = Math.hypot(nx, ny, nz) || 1
          nx /= len
          ny /= len
          nz /= len

          const elev = (va[1] + vb[1] + vc[1]) / 3
          const cr = 0.45 + elev * 0.2
          const cg = 0.62 + elev * 0.15
          const cb = 0.78 - elev * 0.1

          for (const v of [va, vb, vc]) {
            positions.push(v[0], v[1], v[2])
            normals.push(nx, ny, nz)
            colors.push(cr, cg, cb)
          }
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
  }
}
