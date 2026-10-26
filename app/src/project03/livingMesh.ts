import { cross, dot, norm, sub, type V } from './livingArchitecture.ts'

/**
 * The surface nets mesher the Living Architecture prototypes share (Grown3, Network P0 and Field P1 each carry their own copy;
 * Strata uses this one). The field is sampled on a 1 m grid whose first sample sits at `origin`; a sample is inside where it
 * is above `iso`. One vertex per cell that the surface crosses (the mean of its edge crossings), one quad per crossed edge,
 * each wound so its face agrees with the field's gradient.
 */
export type NetSurface = { positions: number[]; normals: number[]; indices: number[] }

const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] as const
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as const

export function surfaceNets(field: Float32Array, dx: number, dy: number, dz: number, origin: V, iso = 0): NetSurface {
  const fidx = (x: number, y: number, z: number) => (z * dy + y) * dx + x
  const vertexOf = new Int32Array((dx - 1) * (dy - 1) * (dz - 1)).fill(-1)
  const vidx = (x: number, y: number, z: number) => (z * (dy - 1) + y) * (dx - 1) + x
  const positions: number[] = []
  const normals: number[] = []
  const cv = new Float32Array(8)
  for (let z = 0; z < dz - 1; z += 1) {
    for (let y = 0; y < dy - 1; y += 1) {
      for (let x = 0; x < dx - 1; x += 1) {
        let mask = 0
        for (let q = 0; q < 8; q += 1) {
          const cc = CORNERS[q]!
          const v = field[fidx(x + cc[0], y + cc[1], z + cc[2])]!
          cv[q] = v
          if (v > iso) mask |= 1 << q
        }
        if (mask === 0 || mask === 255) continue
        let px = 0
        let py = 0
        let pz = 0
        let count = 0
        for (const [a, b] of EDGES) {
          const va = cv[a]!
          const vb = cv[b]!
          if (va > iso === vb > iso) continue
          const t = (iso - va) / (vb - va)
          const ca = CORNERS[a]!
          const cb = CORNERS[b]!
          px += ca[0] + (cb[0] - ca[0]) * t
          py += ca[1] + (cb[1] - ca[1]) * t
          pz += ca[2] + (cb[2] - ca[2]) * t
          count += 1
        }
        const gx = (cv[1]! + cv[3]! + cv[5]! + cv[7]! - cv[0]! - cv[2]! - cv[4]! - cv[6]!) / 4
        const gy = (cv[2]! + cv[3]! + cv[6]! + cv[7]! - cv[0]! - cv[1]! - cv[4]! - cv[5]!) / 4
        const gz = (cv[4]! + cv[5]! + cv[6]! + cv[7]! - cv[0]! - cv[1]! - cv[2]! - cv[3]!) / 4
        const nrm = norm([-gx, -gy, -gz])
        vertexOf[vidx(x, y, z)] = positions.length / 3
        positions.push(origin[0] + x + px / count, origin[1] + y + py / count, origin[2] + z + pz / count)
        normals.push(nrm[0], nrm[1], nrm[2])
      }
    }
  }
  const indices: number[] = []
  const quad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    const pa: V = [positions[a * 3]!, positions[a * 3 + 1]!, positions[a * 3 + 2]!]
    const pb: V = [positions[b * 3]!, positions[b * 3 + 1]!, positions[b * 3 + 2]!]
    const pc: V = [positions[c * 3]!, positions[c * 3 + 1]!, positions[c * 3 + 2]!]
    const face = cross(sub(pb, pa), sub(pc, pa))
    const out: V = [normals[a * 3]!, normals[a * 3 + 1]!, normals[a * 3 + 2]!]
    if (dot(face, out) >= 0) indices.push(a, b, c, a, c, d)
    else indices.push(a, c, b, a, d, c)
  }
  for (let z = 1; z < dz - 1; z += 1) {
    for (let y = 1; y < dy - 1; y += 1) {
      for (let x = 1; x < dx - 1; x += 1) {
        const here = field[fidx(x, y, z)]! > iso
        if (field[fidx(x + 1, y, z)]! > iso !== here) quad(vertexOf[vidx(x, y - 1, z - 1)]!, vertexOf[vidx(x, y, z - 1)]!, vertexOf[vidx(x, y, z)]!, vertexOf[vidx(x, y - 1, z)]!)
        if (field[fidx(x, y + 1, z)]! > iso !== here) quad(vertexOf[vidx(x - 1, y, z - 1)]!, vertexOf[vidx(x - 1, y, z)]!, vertexOf[vidx(x, y, z)]!, vertexOf[vidx(x, y, z - 1)]!)
        if (field[fidx(x, y, z + 1)]! > iso !== here) quad(vertexOf[vidx(x - 1, y - 1, z)]!, vertexOf[vidx(x, y - 1, z)]!, vertexOf[vidx(x, y, z)]!, vertexOf[vidx(x - 1, y, z)]!)
      }
    }
  }
  return { positions, normals, indices }
}
