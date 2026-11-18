import { BufferAttribute, BufferGeometry } from 'three'
import { surfaceNets } from '../project03/livingMesh.ts'
import { landscapeHeight } from '../project03/terrain.ts'

/**
 * Meshing a signed distance field that is designed in its own frame, shared by the Architecture Lab's worker (the Strata family) and the
 * Habitat Study. Pure: no DOM, safe in a worker.
 *
 * The frame: a point (cx, cz) on the ground at height g0, `u` the field's long axis and `w` its cross axis in plan (unit vectors in x, z),
 * y up. A field designed at a reference size is evaluated at scale S as S · f(p / S).
 */
export type FieldFrame = { cx: number; cz: number; g0: number; u: [number, number]; w: [number, number] }
export type FieldBounds = { u: [number, number]; w: [number, number]; y: [number, number] }
export type DesignField = (u: number, w: number, y: number) => number

export const toWorld = (f: FieldFrame, u: number, w: number): [number, number] => [f.cx + f.u[0] * u + f.w[0] * w, f.cz + f.u[1] * u + f.w[1] * w]

/** Coarse block size (in grid steps) and the field's assumed steepness (value change per metre), with room to spare. */
const BLOCK = 4
const LIPSCHITZ = 2.5
/** Development: evaluate every grid point instead (to check that the mesh is unchanged). */
let COARSE_TO_FINE = true
export function setCoarseToFine(on: boolean) {
  COARSE_TO_FINE = on
}

/**
 * Fills the grid from `at` (the field at a grid point), coarse to fine. The field is evaluated at the corners of BLOCK-sized blocks first.
 * A block whose corners all lie farther from the surface than the block can span (its diagonal × LIPSCHITZ) cannot contain the surface, so
 * its inner points are interpolated from the corners (same sign, no crossing); every other block is evaluated exactly, point by point, after
 * the interpolated ones (so shared faces end up exact). Every cell the mesher uses (a sign change) lies in an exact block: the mesh is
 * the same as from a full evaluation, for a fraction of the evaluations.
 */
export function fillField(field: Float32Array, dx: number, dy: number, dz: number, step: number, at: (i: number, j: number, k: number) => number) {
  const idx = (i: number, j: number, k: number) => (k * dy + j) * dx + i
  if (!COARSE_TO_FINE) {
    for (let k = 0; k < dz; k += 1) for (let j = 0; j < dy; j += 1) for (let i = 0; i < dx; i += 1) field[idx(i, j, k)] = at(i, j, k)
    return
  }
  const bx = Math.ceil((dx - 1) / BLOCK)
  const by = Math.ceil((dy - 1) / BLOCK)
  const bz = Math.ceil((dz - 1) / BLOCK)
  const cx = (c: number) => Math.min(c * BLOCK, dx - 1)
  const cy = (c: number) => Math.min(c * BLOCK, dy - 1)
  const cz = (c: number) => Math.min(c * BLOCK, dz - 1)
  // Coarse corners.
  const corner = new Float32Array((bx + 1) * (by + 1) * (bz + 1))
  const cidx = (a: number, b: number, c: number) => (c * (by + 1) + b) * (bx + 1) + a
  for (let c = 0; c <= bz; c += 1) for (let b = 0; b <= by; b += 1) for (let a = 0; a <= bx; a += 1) corner[cidx(a, b, c)] = at(cx(a), cy(b), cz(c))
  const margin = BLOCK * step * Math.sqrt(3) * LIPSCHITZ
  const exact: [number, number, number][] = []
  for (let c = 0; c < bz; c += 1) {
    for (let b = 0; b < by; b += 1) {
      for (let a = 0; a < bx; a += 1) {
        const v = [corner[cidx(a, b, c)]!, corner[cidx(a + 1, b, c)]!, corner[cidx(a, b + 1, c)]!, corner[cidx(a + 1, b + 1, c)]!, corner[cidx(a, b, c + 1)]!, corner[cidx(a + 1, b, c + 1)]!, corner[cidx(a, b + 1, c + 1)]!, corner[cidx(a + 1, b + 1, c + 1)]!]
        if (Math.min(...v.map(Math.abs)) < margin || Math.min(...v) < 0 !== Math.max(...v) < 0) {
          exact.push([a, b, c])
          continue
        }
        // Far from the surface: trilinear between the corners.
        const i0 = cx(a), i1 = cx(a + 1), j0 = cy(b), j1 = cy(b + 1), k0 = cz(c), k1 = cz(c + 1)
        for (let k = k0; k <= k1; k += 1) {
          const tz = (k - k0) / (k1 - k0)
          for (let j = j0; j <= j1; j += 1) {
            const ty = (j - j0) / (j1 - j0)
            for (let i = i0; i <= i1; i += 1) {
              const tx = (i - i0) / (i1 - i0)
              const x00 = v[0]! + (v[1]! - v[0]!) * tx
              const x10 = v[2]! + (v[3]! - v[2]!) * tx
              const x01 = v[4]! + (v[5]! - v[4]!) * tx
              const x11 = v[6]! + (v[7]! - v[6]!) * tx
              const y0 = x00 + (x10 - x00) * ty
              const y1 = x01 + (x11 - x01) * ty
              field[idx(i, j, k)] = y0 + (y1 - y0) * tz
            }
          }
        }
      }
    }
  }
  // Exact blocks share faces with each other, and their corners are already known: each point is evaluated once.
  const done = new Uint8Array(dx * dy * dz)
  for (let c = 0; c <= bz; c += 1) {
    for (let b = 0; b <= by; b += 1) {
      for (let a = 0; a <= bx; a += 1) {
        const n = idx(cx(a), cy(b), cz(c))
        done[n] = 1
        field[n] = corner[cidx(a, b, c)]!
      }
    }
  }
  for (const [a, b, c] of exact) {
    for (let k = cz(c); k <= cz(c + 1); k += 1) {
      for (let j = cy(b); j <= cy(b + 1); j += 1) {
        for (let i = cx(a); i <= cx(a + 1); i += 1) {
          const n = idx(i, j, k)
          if (done[n]) continue
          done[n] = 1
          field[n] = at(i, j, k)
        }
      }
    }
  }
}

/**
 * The field's surface in the world: sampled on a grid of `step` world metres over `bounds` (design metres), clipped to the terrain (nothing
 * below the ground at each column), meshed with the world's surface nets, and turned into world positions with outward winding.
 */
export function meshField(sdf: DesignField, f: FieldFrame, S: number, step: number, bounds: FieldBounds): BufferGeometry {
  const u0 = bounds.u[0] * S
  const w0 = bounds.w[0] * S
  const y0 = bounds.y[0] * S
  const dx = Math.ceil(((bounds.u[1] - bounds.u[0]) * S) / step) + 1
  const dz = Math.ceil(((bounds.w[1] - bounds.w[0]) * S) / step) + 1
  const dy = Math.ceil(((bounds.y[1] - bounds.y[0]) * S) / step) + 1
  const field = new Float32Array(dx * dy * dz)
  // The ground under each column, relative to the frame's origin: the form's foot follows the land, nothing below it.
  const ground = new Float64Array(dx * dz)
  for (let k = 0; k < dz; k += 1) {
    for (let i = 0; i < dx; i += 1) {
      const [x, z] = toWorld(f, u0 + i * step, w0 + k * step)
      ground[k * dx + i] = landscapeHeight(x, z) - f.g0
    }
  }
  const at = (i: number, j: number, k: number) => {
    const y = y0 + j * step
    let d = sdf((u0 + i * step) / S, (w0 + k * step) / S, y / S) * S
    const g = ground[k * dx + i]!
    if (y < g - 1.5) d = Math.max(d, g - 1.5 - y)
    return -d
  }
  fillField(field, dx, dy, dz, step, at)
  const net = surfaceNets(field, dx, dy, dz, [0, 0, 0])
  const pos = new Float32Array(net.positions.length)
  for (let v = 0; v < net.positions.length; v += 3) {
    const u = u0 + net.positions[v]! * step
    const y = y0 + net.positions[v + 1]! * step
    const w = w0 + net.positions[v + 2]! * step
    const [x, z] = toWorld(f, u, w)
    pos[v] = x
    pos[v + 1] = f.g0 + y
    pos[v + 2] = z
  }
  // The grid's axes (u, y, w) map to the world through the frame; when that map mirrors (u × up is −w), the triangles' winding flips with it,
  // so flip it back or every normal points inward.
  const mirrored = -f.u[1] * f.w[0] + f.u[0] * f.w[1] < 0
  const indices = net.indices.slice()
  if (mirrored) for (let t = 0; t < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2]!, indices[t + 1]!]
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setIndex(indices)
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

/** The field in world coordinates (x, y, z), for normals and occlusion. */
export function worldOf(sdf: DesignField, f: FieldFrame, S: number) {
  return (x: number, y: number, z: number) => {
    const dx = x - f.cx
    const dz = z - f.cz
    return sdf((dx * f.u[0] + dz * f.u[1]) / S, (dx * f.w[0] + dz * f.w[1]) / S, (y - f.g0) / S) * S
  }
}

/** Normals from the field's gradient rather than the mesh, so thin lips shade smoothly instead of beading at the grid. */
export function fieldNormals(g: BufferGeometry, d: (x: number, y: number, z: number) => number) {
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal') as BufferAttribute
  const e = 0.15
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const nx = d(x + e, y, z) - d(x - e, y, z)
    const ny = d(x, y + e, z) - d(x, y - e, z)
    const nz = d(x, y, z + e) - d(x, y, z - e)
    const l = Math.hypot(nx, ny, nz)
    if (l > 1e-6) nor.setXYZ(i, nx / l, ny / l, nz / l)
  }
  nor.needsUpdate = true
}

/** The mesh's connected pieces, largest first, by vertex count (a detached support or a floating shelf is a second piece). */
export function pieces(g: BufferGeometry): number[] {
  const ix = g.index!.array as Uint32Array | Uint16Array
  const n = g.getAttribute('position').count
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i += 1) parent[i] = i
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!
      x = parent[x]!
    }
    return x
  }
  for (let i = 0; i < ix.length; i += 3) {
    const a = find(ix[i]!)
    parent[find(ix[i + 1]!)] = a
    parent[find(ix[i + 2]!)] = a
  }
  const size = new Map<number, number>()
  for (let i = 0; i < n; i += 1) {
    const r = find(i)
    size.set(r, (size.get(r) ?? 0) + 1)
  }
  return [...size.values()].sort((a, b) => b - a)
}
