import { volumeIndex, type DensityVolume } from './buildVolume.ts'

export type MeshBuffers = {
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
}

const FACE_DEFS = [
  // dir, corners of face in local cell space (0/1), normal
  {
    dx: 1,
    dy: 0,
    dz: 0,
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
    normal: [1, 0, 0],
    color: [0.55, 0.72, 0.9],
  },
  {
    dx: -1,
    dy: 0,
    dz: 0,
    corners: [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
    normal: [-1, 0, 0],
    color: [0.45, 0.62, 0.82],
  },
  {
    dx: 0,
    dy: 1,
    dz: 0,
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
    normal: [0, 1, 0],
    color: [0.7, 0.85, 0.65],
  },
  {
    dx: 0,
    dy: -1,
    dz: 0,
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    normal: [0, -1, 0],
    color: [0.4, 0.35, 0.3],
  },
  {
    dx: 0,
    dy: 0,
    dz: 1,
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
    normal: [0, 0, 1],
    color: [0.5, 0.68, 0.88],
  },
  {
    dx: 0,
    dy: 0,
    dz: -1,
    corners: [
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
      [0, 0, 0],
    ],
    normal: [0, 0, -1],
    color: [0.48, 0.65, 0.85],
  },
] as const

function isSolid(volume: DensityVolume, ix: number, iy: number, iz: number): boolean {
  const r = volume.resolution
  if (ix < 0 || iy < 0 || iz < 0 || ix >= r || iy >= r || iz >= r) {
    return false
  }
  return volume.densities[volumeIndex(ix, iy, iz, r)]! > 0
}

/**
 * Minecraft-style meshing: emit faces of solid cells that touch empty space.
 * Cell (ix,iy,iz) occupies the cube from grid point to +1 in each axis.
 */
export function meshBlocks(volume: DensityVolume): MeshBuffers {
  const r = volume.resolution
  const denom = Math.max(1, r - 1)
  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []

  const pushVert = (
    px: number,
    py: number,
    pz: number,
    nx: number,
    ny: number,
    nz: number,
    cr: number,
    cg: number,
    cb: number,
  ) => {
    positions.push(px, py, pz)
    normals.push(nx, ny, nz)
    colors.push(cr, cg, cb)
  }

  const pushQuad = (
    verts: [number, number, number][],
    normal: readonly [number, number, number],
    color: readonly [number, number, number],
  ) => {
    const [a, b, c, d] = verts
    const order = [a, b, c, a, c, d]
    for (const v of order) {
      pushVert(v[0]!, v[1]!, v[2]!, normal[0], normal[1], normal[2], color[0], color[1], color[2])
    }
  }

  // Use cells 0..r-2 so each cell has a +1 neighbor corner in-grid.
  for (let iz = 0; iz < r - 1; iz++) {
    for (let iy = 0; iy < r - 1; iy++) {
      for (let ix = 0; ix < r - 1; ix++) {
        if (!isSolid(volume, ix, iy, iz)) {
          continue
        }

        for (const face of FACE_DEFS) {
          const nx = ix + face.dx
          const ny = iy + face.dy
          const nz = iz + face.dz
          if (isSolid(volume, nx, ny, nz)) {
            continue
          }

          const verts = face.corners.map(([cx, cy, cz]) => {
            const gx = ix + cx
            const gy = iy + cy
            const gz = iz + cz
            return [
              (gx / denom) * 2 - 1,
              (gy / denom) * 2 - 1,
              (gz / denom) * 2 - 1,
            ] as [number, number, number]
          })
          pushQuad(verts, face.normal, face.color)
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
