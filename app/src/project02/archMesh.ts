import { BufferGeometry, Float32BufferAttribute } from 'three'
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js'
import { archIndex, NO_GROUND, openFaces, SUPPORT_UNSOLVED, voxelStress, type Architecture } from './architecture.ts'
import { hash01, LATTICE_BASE, LATTICE_X0, LATTICE_Z0 } from './core.ts'

/**
 * Shadow Ecology 0.2 — the architecture drawn three ways from one lattice.
 * LOD never touches the simulation: each chunk column picks a level from
 * its distance to the camera and is rebuilt from the same voxels.
 *
 *   0 Detail  every exposed voxel face, its rim's normals tilted outward so
 *             each block reads as a chamfered stone (shading only, no gaps)
 *   1 Voxel   every exposed voxel face, flat
 *   2 Mass    2×2×2 voxels merged into one block where most are solid
 *
 * Vertices carry the voxel's birth (age), stress and exposure, which the
 * material turns into patina, cracking and wear.
 *
 * The same voxels can instead be drawn as a Marching Cubes surface through
 * the voxel centres. Switching only rebuilds meshes, never the structure.
 */
export type ArchLod = 0 | 1 | 2
export const ARCH_LODS: readonly ArchLod[] = [0, 1, 2]
export const ARCH_LOD_LABELS = ['Detail', 'Voxel', 'Mass'] as const

export type ArchRepresentation = 'blocks' | 'marching'
export const ARCH_REPRESENTATION_LABELS: Record<ArchRepresentation, string> = { blocks: 'Blocks', marching: 'Marching Cubes' }

/** Camera distances (world units) where a chunk steps down a level, with hysteresis. */
export const ARCH_LOD_DISTANCE = { detail: 13, mass: 40, hysteresis: 0.6 } as const

export function archLodFor(distance: number, current: ArchLod): ArchLod {
  const h = ARCH_LOD_DISTANCE.hysteresis
  const toVoxel = current === 0 ? ARCH_LOD_DISTANCE.detail + h : ARCH_LOD_DISTANCE.detail - h
  const toMass = current === 2 ? ARCH_LOD_DISTANCE.mass - h : ARCH_LOD_DISTANCE.mass + h
  return distance >= toMass ? 2 : distance >= toVoxel ? 1 : 0
}

type Face = { normal: [number, number, number]; corners: [number, number, number][] }

/** Unit-cube faces: outward normal and corners (counter-clockwise seen from outside). */
const FACES: readonly Face[] = [
  { normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { normal: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { normal: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
]

const INSET = 0.16
const TILT = 0.55

/** Stress as drawn: a voxel placed since support was last solved has none known yet, so it reads as sound. */
const shownStress = (a: Architecture, index: number) => (a.support[index] === SUPPORT_UNSOLVED ? 0 : voxelStress(a, index))

class Builder {
  position: number[] = []
  normal: number[] = []
  birth: number[] = []
  stress: number[] = []
  exposure: number[] = []
  seed: number[] = []
  /** Growth anchor per vertex: xyz the axis toward the face a block grew from, w that face's plane (dot(point, axis)). */
  grow: number[] = []
  index: number[] = []
  /** Anchor for the vertices added next; zero means drawn as built, with no growth reveal. */
  anchor: [number, number, number, number] = [0, 0, 0, 0]

  vertex(p: number[], n: number[], birth: number, stress: number, exposure: number, seed: number) {
    this.position.push(p[0]!, p[1]!, p[2]!)
    this.normal.push(n[0]!, n[1]!, n[2]!)
    this.birth.push(birth)
    this.stress.push(stress)
    this.exposure.push(exposure)
    this.seed.push(seed)
    this.grow.push(...this.anchor)
    return this.position.length / 3 - 1
  }

  quad(a: number, b: number, c: number, d: number) {
    this.index.push(a, b, c, a, c, d)
  }

  /** A triangle wound so it faces along its vertices' normals. */
  facing(a: number, b: number, c: number) {
    const p = this.position
    const ux = p[b * 3]! - p[a * 3]!
    const uy = p[b * 3 + 1]! - p[a * 3 + 1]!
    const uz = p[b * 3 + 2]! - p[a * 3 + 2]!
    const vx = p[c * 3]! - p[a * 3]!
    const vy = p[c * 3 + 1]! - p[a * 3 + 1]!
    const vz = p[c * 3 + 2]! - p[a * 3 + 2]!
    const m = this.normal
    const nx = m[a * 3]! + m[b * 3]! + m[c * 3]!
    const ny = m[a * 3 + 1]! + m[b * 3 + 1]! + m[c * 3 + 1]!
    const nz = m[a * 3 + 2]! + m[b * 3 + 2]! + m[c * 3 + 2]!
    const along = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz
    if (along >= 0) this.index.push(a, b, c)
    else this.index.push(a, c, b)
  }

  geometry(): BufferGeometry | null {
    if (!this.index.length) return null
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(this.position, 3))
    g.setAttribute('normal', new Float32BufferAttribute(this.normal, 3))
    g.setAttribute('aBirth', new Float32BufferAttribute(this.birth, 1))
    g.setAttribute('aStress', new Float32BufferAttribute(this.stress, 1))
    g.setAttribute('aExposure', new Float32BufferAttribute(this.exposure, 1))
    g.setAttribute('aSeed', new Float32BufferAttribute(this.seed, 1))
    g.setAttribute('aGrow', new Float32BufferAttribute(this.grow, 4))
    g.setIndex(this.index)
    g.computeBoundingSphere()
    return g
  }
}

function face(
  b: Builder,
  f: Face,
  origin: [number, number, number],
  size: number,
  detail: boolean,
  birth: number,
  stress: number,
  exposure: number,
  seed: number,
) {
  const p = (c: [number, number, number]) => [origin[0] + c[0] * size, origin[1] + c[1] * size, origin[2] + c[2] * size]
  if (!detail) {
    const v = f.corners.map((c) => b.vertex(p(c), f.normal, birth, stress, exposure, seed))
    b.quad(v[0]!, v[1]!, v[2]!, v[3]!)
    return
  }
  // Inner quad keeps the face normal; the rim leans outward toward each edge.
  const centre = [0.5, 0.5, 0.5].map((m, axis) => (f.normal[axis] !== 0 ? (f.normal[axis]! > 0 ? 1 : 0) : m)) as [number, number, number]
  const inner = f.corners.map((c) => c.map((v, axis) => v + (centre[axis]! - v) * INSET * 2) as [number, number, number])
  const outerIds: number[] = []
  const innerIds: number[] = []
  for (let n = 0; n < 4; n += 1) {
    const c = f.corners[n]!
    const lean = c.map((v, axis) => (f.normal[axis] !== 0 ? 0 : (v - 0.5) * 2))
    const tilted = f.normal.map((v, axis) => v + lean[axis]! * TILT)
    const l = Math.hypot(tilted[0]!, tilted[1]!, tilted[2]!)
    outerIds.push(b.vertex(p(c), tilted.map((v) => v / l), birth, stress, exposure, seed))
    innerIds.push(b.vertex(p(inner[n]!), f.normal, birth, stress, exposure, seed))
  }
  b.quad(innerIds[0]!, innerIds[1]!, innerIds[2]!, innerIds[3]!)
  for (let n = 0; n < 4; n += 1) {
    const m = (n + 1) % 4
    b.quad(outerIds[n]!, outerIds[m]!, innerIds[m]!, innerIds[n]!)
  }
}

/** Neighbour steps in archIndex order: +x, −x, +y, −y, +z, −z. */
const NEIGHBOURS: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

/**
 * The face a block grew out of: toward its oldest solid neighbour that was
 * there before it (below first on ties), else the ground beneath. The shader
 * extrudes the block from that face, so the face it shares stays closed.
 */
function growthAnchor(a: Architecture, index: number, above: boolean, origin: [number, number, number], v: number): [number, number, number, number] {
  const { solid, birth, n, cols } = a
  const born = birth[index]!
  const step = [1, -1, cols, -cols, n, -n]
  let best = above ? -1 : 3
  let oldest = above ? born : -Infinity
  for (let s = 0; s < 6; s += 1) {
    const m = index + step[s]!
    if (m < 0 || m >= solid.length || !solid[m]) continue
    const b = birth[m]!
    if (b < oldest || (b === oldest && s === 3)) {
      oldest = b
      best = s
    }
  }
  const axis = NEIGHBOURS[best < 0 ? 3 : best]!
  const plane = axis.reduce((sum, d, k) => sum + d * (origin[k]! + (d > 0 ? v : 0)), 0)
  return [axis[0], axis[1], axis[2], plane]
}

/** Chunk column (ci, ck) at a level, or null when it holds nothing. */
export function buildChunk(a: Architecture, ci: number, ck: number, lod: ArchLod): { geometry: BufferGeometry | null; triangles: number } {
  const b = new Builder()
  const i0 = ci * a.chunk
  const k0 = ck * a.chunk
  const i1 = Math.min(a.n, i0 + a.chunk)
  const k1 = Math.min(a.n, k0 + a.chunk)
  const { solid, birth, n, ny, cols } = a
  if (lod < 2) {
    const v = a.voxel
    for (let k = k0; k < k1; k += 1) {
      for (let i = i0; i < i1; i += 1) {
        const g = a.groundJ[i + n * k]!
        if (g === NO_GROUND) continue
        for (let j = Math.max(0, g); j < ny; j += 1) {
          const index = archIndex(a, i, j, k)
          if (!solid[index]) continue
          const open = [
            i === n - 1 || !solid[index + 1],
            i === 0 || !solid[index - 1],
            j === ny - 1 || !solid[index + cols],
            j > g && (j === 0 || !solid[index - cols]),
            k === n - 1 || !solid[index + n],
            k === 0 || !solid[index - n],
          ]
          if (!open.some(Boolean)) continue
          const exposure = open.filter(Boolean).length / 6
          const stress = shownStress(a, index)
          const seed = hash01(index)
          const origin: [number, number, number] = [LATTICE_X0 + i * v, LATTICE_BASE + j * v, LATTICE_Z0 + k * v]
          b.anchor = growthAnchor(a, index, j > g, origin, v)
          FACES.forEach((f, side) => {
            if (open[side]) face(b, f, origin, v, lod === 0, birth[index]!, stress, exposure, seed)
          })
        }
      }
    }
    b.anchor = [0, 0, 0, 0]
  } else {
    const v = a.voxel * 2
    const solidCoarse = (ci2: number, cj2: number, ck2: number) => {
      let count = 0
      let born = Infinity
      let stress = 0
      for (let dj = 0; dj < 2; dj += 1) {
        for (let dk = 0; dk < 2; dk += 1) {
          for (let di = 0; di < 2; di += 1) {
            const i = ci2 * 2 + di
            const j = cj2 * 2 + dj
            const k = ck2 * 2 + dk
            if (i >= n || k >= n || j >= ny) continue
            const index = archIndex(a, i, j, k)
            if (solid[index]) {
              count += 1
              born = Math.min(born, birth[index]!)
              stress = Math.max(stress, shownStress(a, index))
            }
          }
        }
      }
      return { on: count >= 3, born, stress }
    }
    const cn = Math.ceil(n / 2)
    const cny = Math.ceil(ny / 2)
    for (let ck2 = Math.floor(k0 / 2); ck2 < Math.ceil(k1 / 2); ck2 += 1) {
      for (let ci2 = Math.floor(i0 / 2); ci2 < Math.ceil(i1 / 2); ci2 += 1) {
        const g = Math.max(0, a.groundJ[Math.min(n - 1, ci2 * 2) + n * Math.min(n - 1, ck2 * 2)]!)
        const gc = Math.floor(g / 2)
        for (let cj2 = gc; cj2 < cny; cj2 += 1) {
          const cell = solidCoarse(ci2, cj2, ck2)
          if (!cell.on) continue
          const neighbour = (di: number, dj: number, dk: number) => {
            const x = ci2 + di
            const y = cj2 + dj
            const z = ck2 + dk
            if (x < 0 || z < 0 || y < 0 || x >= cn || z >= cn || y >= cny) return false
            return solidCoarse(x, y, z).on
          }
          const open = [
            !neighbour(1, 0, 0),
            !neighbour(-1, 0, 0),
            !neighbour(0, 1, 0),
            cj2 > gc && !neighbour(0, -1, 0),
            !neighbour(0, 0, 1),
            !neighbour(0, 0, -1),
          ]
          if (!open.some(Boolean)) continue
          const exposure = open.filter(Boolean).length / 6
          const origin: [number, number, number] = [LATTICE_X0 + ci2 * v, LATTICE_BASE + cj2 * v, LATTICE_Z0 + ck2 * v]
          const seed = hash01(ci2 * 7919 + cj2 * 104729 + ck2)
          FACES.forEach((f, side) => {
            if (open[side]) face(b, f, origin, v, false, cell.born, cell.stress, exposure, seed)
          })
        }
      }
    }
  }
  const geometry = b.geometry()
  return { geometry, triangles: b.index.length / 3 }
}

/** Cube corners in the Marching Cubes tables' order. */
const MC_CORNERS: readonly [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
]
/** The corners each cube edge joins, in the tables' order. */
const MC_EDGES: readonly [number, number][] = [
  [0, 1],
  [1, 2],
  [3, 2],
  [0, 3],
  [4, 5],
  [5, 6],
  [7, 6],
  [4, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
]

/**
 * Chunk column (ci, ck) as a Marching Cubes surface through the voxel
 * centres. The chunk owns the cubes whose low corner lies in it; footings
 * run a little into the ground so their base is closed out of sight.
 */
export function buildChunkMarching(a: Architecture, ci: number, ck: number): { geometry: BufferGeometry | null; triangles: number } {
  const { solid, birth, n, ny, groundJ } = a
  const i0 = ci * a.chunk
  const k0 = ck * a.chunk
  const i1 = Math.min(n, i0 + a.chunk)
  const k1 = Math.min(n, k0 + a.chunk)
  let jLo = ny
  let jHi = -1
  for (let k = Math.max(0, k0 - 1); k <= Math.min(n - 1, k1); k += 1) {
    for (let i = Math.max(0, i0 - 1); i <= Math.min(n - 1, i1); i += 1) {
      const g = groundJ[i + n * k]!
      if (g === NO_GROUND) continue
      for (let j = Math.max(0, g); j < ny; j += 1) {
        if (!solid[archIndex(a, i, j, k)]) continue
        jLo = Math.min(jLo, j)
        jHi = Math.max(jHi, j)
      }
    }
  }
  if (jHi < 0) return { geometry: null, triangles: 0 }

  // The field over the chunk plus a one-voxel border: 1 solid, with the voxel carrying its attributes.
  const bi0 = i0 - 1
  const bk0 = k0 - 1
  const bj0 = jLo - 4
  const sx = i1 - i0 + 3
  const sz = k1 - k0 + 3
  const sy = jHi - bj0 + 3
  const at = (x: number, y: number, z: number) => x + sx * (z + sz * y)
  const field = new Uint8Array(sx * sy * sz)
  const owner = new Int32Array(sx * sy * sz)
  for (let z = 0; z < sz; z += 1) {
    for (let x = 0; x < sx; x += 1) {
      const i = bi0 + x
      const k = bk0 + z
      if (i < 0 || k < 0 || i >= n || k >= n) continue
      const g = groundJ[i + n * k]!
      if (g === NO_GROUND) continue
      for (let y = 0; y < sy; y += 1) {
        const j = bj0 + y
        if (j < 0 || j >= ny) continue
        const index = g >= 0 && j < g ? (j >= g - 2 ? archIndex(a, i, g, k) : -1) : archIndex(a, i, j, k)
        if (index >= 0 && solid[index]) {
          field[at(x, y, z)] = 1
          owner[at(x, y, z)] = index
        }
      }
    }
  }

  const b = new Builder()
  const v = a.voxel
  const attributes = new Map<number, [number, number, number, number]>()
  const attributesOf = (index: number) => {
    let found = attributes.get(index)
    if (!found) {
      found = [birth[index]!, shownStress(a, index), openFaces(a, index) / 6, hash01(index)]
      attributes.set(index, found)
    }
    return found
  }
  const F = (x: number, y: number, z: number) => field[at(x, y, z)]!
  const gradient = (x: number, y: number, z: number): [number, number, number] => [
    F(x - 1, y, z) - F(x + 1, y, z),
    F(x, y - 1, z) - F(x, y + 1, z),
    F(x, y, z - 1) - F(x, y, z + 1),
  ]
  const ids = new Array<number>(12)
  for (let y = 1; y < sy - 2; y += 1) {
    for (let z = 1; z < sz - 2; z += 1) {
      for (let x = 1; x < sx - 2; x += 1) {
        let cube = 0
        for (let c = 0; c < 8; c += 1) {
          const [cx, cy, cz] = MC_CORNERS[c]!
          if (!F(x + cx, y + cy, z + cz)) cube |= 1 << c
        }
        const bits = edgeTable[cube]!
        if (!bits) continue
        for (let e = 0; e < 12; e += 1) {
          if (!(bits & (1 << e))) continue
          const [p, q] = MC_EDGES[e]!
          const A = MC_CORNERS[p]!
          const B = MC_CORNERS[q]!
          const ax = x + A[0]
          const ay = y + A[1]
          const az = z + A[2]
          const bx = x + B[0]
          const by = y + B[1]
          const bz = z + B[2]
          const ga = gradient(ax, ay, az)
          const gb = gradient(bx, by, bz)
          let normal = [ga[0] + gb[0], ga[1] + gb[1], ga[2] + gb[2]]
          const solidA = F(ax, ay, az) === 1
          let length = Math.hypot(normal[0]!, normal[1]!, normal[2]!)
          if (length < 1e-6) {
            // Flat across the edge: face from the solid corner toward the empty one.
            const s = solidA ? 1 : -1
            normal = [(B[0] - A[0]) * s, (B[1] - A[1]) * s, (B[2] - A[2]) * s]
            length = 1
          }
          const [born, stress, exposure, seed] = attributesOf(owner[solidA ? at(ax, ay, az) : at(bx, by, bz)]!)
          const position = [
            LATTICE_X0 + (bi0 + (ax + bx) / 2 + 0.5) * v,
            LATTICE_BASE + (bj0 + (ay + by) / 2 + 0.5) * v,
            LATTICE_Z0 + (bk0 + (az + bz) / 2 + 0.5) * v,
          ]
          ids[e] = b.vertex(position, normal.map((c) => c / length), born, stress, exposure, seed)
        }
        for (let t = cube * 16; triTable[t] !== -1; t += 3) {
          b.facing(ids[triTable[t]!]!, ids[triTable[t + 1]!]!, ids[triTable[t + 2]!]!)
        }
      }
    }
  }
  const geometry = b.geometry()
  return { geometry, triangles: b.index.length / 3 }
}

/** World-space centre of a chunk column at ground level, for its LOD distance. */
export function chunkCentre(a: Architecture, ci: number, ck: number): [number, number] {
  const half = (a.chunk * a.voxel) / 2
  return [LATTICE_X0 + ci * a.chunk * a.voxel + half, LATTICE_Z0 + ck * a.chunk * a.voxel + half]
}
