import {
  BufferGeometry,
  DataTexture,
  DataUtils,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  RedFormat,
  Vector3,
} from 'three'
import { simplex2 } from '../../shared/noise/simplex.ts'
import { addSurfaceFields } from './fields.ts'
import { meshSdf, type Sdf } from './surfaceNets.ts'

/** Every specimen rests on the floor at world y = 0 and is exactly this tall. */
export const SPECIMEN_HEIGHT = 1.6

/** Side of the square floor area the footprint gap field covers, centred on the origin. */
export const FOOTPRINT_FIELD_SIZE = 6
/** Largest gap the field stores; above the top of the Contact distance range, so the gap never flattens within reach of d. */
export const FOOTPRINT_GAP_RANGE = 1.25
const FOOTPRINT_RES = 256
const FLOOR_EPSILON = 1e-3

export type SpecimenId = 'surface' | 'structure' | 'organism'

export type SpecimenInfo = {
  id: SpecimenId
  label: string
  note: string
}

export const SPECIMENS: readonly SpecimenInfo[] = [
  {
    id: 'surface',
    label: 'Surface',
    note: 'A terrain-like heightfield: one continuous skin rising from the floor into a massif, ridges and valleys.',
  },
  {
    id: 'structure',
    label: 'Structure',
    note: 'An architectural composition: flat planes, sharp edges, steps, a cantilever overhang and a portal void.',
  },
  {
    id: 'organism',
    label: 'Organism',
    note: 'A branching body on spreading roots: tapering limbs that face every direction, blended at the joints.',
  },
]

export type Specimen = {
  id: SpecimenId
  geometry: BufferGeometry
  /**
   * Horizontal distance from each floor point to the nearest point where the
   * form touches the floor, over FOOTPRINT_FIELD_SIZE, as 0…1 of
   * FOOTPRINT_GAP_RANGE. Read by the floor half of the Contact study.
   */
  footprintGap: DataTexture
}

export function getSpecimenInfo(id: SpecimenId): SpecimenInfo {
  return SPECIMENS.find((item) => item.id === id)!
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Deterministic 0…1 sequence, so each specimen is the same on every load. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ── Surface ─────────────────────────────────────────────────────────────── */

const SURFACE_RADIUS = 1.6
const SURFACE_GRID = 180

/**
 * A broad massif offset from centre, a lower shoulder across a saddle, ridged
 * spurs down the flanks and fbm detail, fading to the floor at the rim.
 */
function surfaceHeight(x: number, z: number): number {
  const r = Math.sqrt(x * x + z * z) / SURFACE_RADIUS
  const rim = 1 - smoothstep(0.2, 1, r)
  let fbm = 0
  let amplitude = 0.5
  let frequency = 1.1
  let total = 0
  for (let i = 0; i < 4; i += 1) {
    fbm += amplitude * simplex2(x * frequency + 3.1, z * frequency - 1.7)
    total += amplitude
    frequency *= 2.1
    amplitude *= 0.45
  }
  fbm = fbm / total
  const ridge = 1 - Math.abs(simplex2(x * 1.4 + 7.2, z * 1.4 + 2.4))
  const massif = Math.exp(-((x - 0.25) ** 2 + (z + 0.15) ** 2) / 1.2)
  const shoulder = Math.exp(-((x + 0.6) ** 2 + (z - 0.55) ** 2) / 0.35)
  const body = massif + 0.45 * shoulder
  return Math.max(0, rim * (body * (0.8 + 0.25 * ridge * ridge) + 0.05 * fbm))
}

/**
 * Square grid squeezed onto a disc, so the rim is round and cells stay even.
 * Heights are stretched to SPECIMEN_HEIGHT here so the footprint keeps its radius.
 */
function createSurfaceGeometry(): BufferGeometry {
  const n = SURFACE_GRID
  const positions = new Float32Array((n + 1) * (n + 1) * 3)
  let peak = 0
  for (let j = 0; j <= n; j += 1) {
    for (let i = 0; i <= n; i += 1) {
      const u = (i / n) * 2 - 1
      const v = (j / n) * 2 - 1
      const x = u * Math.sqrt(1 - (v * v) / 2) * SURFACE_RADIUS
      const z = v * Math.sqrt(1 - (u * u) / 2) * SURFACE_RADIUS
      const k = (j * (n + 1) + i) * 3
      const y = surfaceHeight(x, z)
      peak = Math.max(peak, y)
      positions[k] = x
      positions[k + 1] = y
      positions[k + 2] = z
    }
  }
  for (let k = 1; k < positions.length; k += 3) {
    positions[k]! *= SPECIMEN_HEIGHT / peak
  }
  const indices: number[] = []
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = j * (n + 1) + i
      const b = a + 1
      const c = a + n + 1
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  return geometry
}

/* ── Structure ───────────────────────────────────────────────────────────── */

const STRUCTURE_CELL = 0.02

/** [centre x, centre z, width x, depth z, bottom y, top y] */
type Block = readonly [number, number, number, number, number, number]

const STRUCTURE_BLOCKS: readonly Block[] = [
  [0, 0, 2.2, 1.6, 0, 0.16], // plinth
  [-0.35, 0.05, 1.2, 1.2, 0.16, 0.56], // lower terrace
  [-0.5, 0.15, 0.8, 0.8, 0.56, 0.92], // upper terrace
  [0.55, -0.4, 0.36, 0.36, 0.16, 1.6], // tower
  [0.1, -0.35, 1.3, 0.5, 1.06, 1.14], // cantilever
  [0.35, 0.6, 0.12, 0.12, 0.16, 0.75], // portal post
  [0.85, 0.6, 0.12, 0.12, 0.16, 0.75], // portal post
  [0.6, 0.6, 0.64, 0.14, 0.75, 0.87], // lintel
]

/** Blocks as centre + half extents, flat, for the ~10⁶ samples of the distance field. */
const BOX_DATA = new Float64Array(
  STRUCTURE_BLOCKS.flatMap(([cx, cz, w, d, y0, y1]) => [cx, (y0 + y1) / 2, cz, w / 2, (y1 - y0) / 2, d / 2]),
)

/** Union of exact box distances, cut at the floor. */
const structureSdf: Sdf = (x, y, z) => {
  let d = Infinity
  for (let i = 0; i < BOX_DATA.length; i += 6) {
    const qx = Math.abs(x - BOX_DATA[i]!) - BOX_DATA[i + 3]!
    const qy = Math.abs(y - BOX_DATA[i + 1]!) - BOX_DATA[i + 4]!
    const qz = Math.abs(z - BOX_DATA[i + 2]!) - BOX_DATA[i + 5]!
    const ox = qx > 0 ? qx : 0
    const oy = qy > 0 ? qy : 0
    const oz = qz > 0 ? qz : 0
    const inner = Math.max(qx, qy, qz)
    const box = Math.sqrt(ox * ox + oy * oy + oz * oz) + (inner < 0 ? inner : 0)
    if (box < d) {
      d = box
    }
  }
  return d > -y ? d : -y
}

/* ── Organism ────────────────────────────────────────────────────────────── */

const ORGANISM_CELL = 0.022
const ORGANISM_BLEND = 0.09
const ORGANISM_SEED = 7

type Limb = {
  a: Vector3
  b: Vector3
  ra: number
  rb: number
  /** Bounding sphere, for skipping limbs that cannot change the blend. */
  centre: Vector3
  reach: number
}

function limb(a: Vector3, b: Vector3, ra: number, rb: number): Limb {
  return {
    a,
    b,
    ra,
    rb,
    centre: a.clone().add(b).multiplyScalar(0.5),
    reach: a.distanceTo(b) / 2 + Math.max(ra, rb),
  }
}

/** Each limb forks into two or three, turning away from its parent, leaning up and out. */
function growLimbs(
  limbs: Limb[],
  start: Vector3,
  direction: Vector3,
  length: number,
  radius: number,
  depth: number,
  random: () => number,
) {
  const end = start.clone().addScaledVector(direction, length)
  const tip = radius * 0.76
  limbs.push(limb(start, end, radius, tip))
  if (depth === 0) {
    return
  }
  const forks = depth === 3 ? 3 : random() > 0.55 ? 3 : 2
  const spin = random() * Math.PI * 2
  const side = new Vector3(0, 1, 0).cross(direction)
  if (side.lengthSq() < 1e-6) {
    side.set(1, 0, 0)
  }
  side.normalize()
  for (let i = 0; i < forks; i += 1) {
    const turn = 0.6 + random() * 0.35
    const child = direction
      .clone()
      .applyAxisAngle(side, turn)
      .applyAxisAngle(direction, spin + (i / forks) * Math.PI * 2)
    const outward = Math.hypot(end.x, end.z)
    if (outward > 0.15) {
      child.x += (end.x / outward) * 0.35
      child.z += (end.z / outward) * 0.35
    }
    child.y += 0.2
    child.normalize()
    growLimbs(limbs, end, child, length * (0.76 + random() * 0.1), tip, depth - 1, random)
  }
}

function createOrganismLimbs(): Limb[] {
  const random = mulberry32(ORGANISM_SEED)
  const limbs: Limb[] = []
  const trunkTop = new Vector3(0.04, 0.4, -0.02)
  limbs.push(limb(new Vector3(0, 0, 0), trunkTop, 0.18, 0.14))
  const roots = 5
  for (let i = 0; i < roots; i += 1) {
    const angle = (i / roots) * Math.PI * 2 + random() * 0.6
    const reach = 0.45 + random() * 0.2
    const end = new Vector3(Math.cos(angle) * reach, -0.05, Math.sin(angle) * reach)
    limbs.push(limb(new Vector3(0, 0.2, 0), end, 0.09, 0.04))
  }
  growLimbs(limbs, trunkTop, new Vector3(0.1, 1, 0).normalize(), 0.45, 0.14, 3, random)
  return limbs
}

/** Tapered capsule: distance to the segment minus a radius that runs from ra to rb. */
function limbDistance(x: number, y: number, z: number, item: Limb): number {
  const { a, b } = item
  const px = x - a.x
  const py = y - a.y
  const pz = z - a.z
  const bx = b.x - a.x
  const by = b.y - a.y
  const bz = b.z - a.z
  const h = Math.min(1, Math.max(0, (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz)))
  const dx = px - bx * h
  const dy = py - by * h
  const dz = pz - bz * h
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (item.ra + (item.rb - item.ra) * h)
}

function smoothMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

function organismSdf(limbs: readonly Limb[]): Sdf {
  return (x, y, z) => {
    let d = Infinity
    for (const item of limbs) {
      const cx = x - item.centre.x
      const cy = y - item.centre.y
      const cz = z - item.centre.z
      if (Math.sqrt(cx * cx + cy * cy + cz * cz) - item.reach > d + ORGANISM_BLEND) {
        continue
      }
      d = d === Infinity ? limbDistance(x, y, z, item) : smoothMin(d, limbDistance(x, y, z, item), ORGANISM_BLEND)
    }
    return Math.max(d, -y)
  }
}

/* ── Shared ──────────────────────────────────────────────────────────────── */

/** Grid bounds around the form, offset by half a cell so no sample lies on the floor plane. */
function meshBounds(min: Vector3, max: Vector3, cell: number): [Vector3, Vector3] {
  const pad = cell * 2
  return [
    new Vector3(min.x - pad, -1.5 * cell, min.z - pad),
    new Vector3(max.x + pad, max.y + pad, max.z + pad),
  ]
}

function createStructureGeometry(): BufferGeometry {
  const min = new Vector3(Infinity, 0, Infinity)
  const max = new Vector3(-Infinity, 0, -Infinity)
  for (const [cx, cz, w, d, , y1] of STRUCTURE_BLOCKS) {
    min.set(Math.min(min.x, cx - w / 2), 0, Math.min(min.z, cz - d / 2))
    max.set(Math.max(max.x, cx + w / 2), Math.max(max.y, y1), Math.max(max.z, cz + d / 2))
  }
  return meshSdf(structureSdf, ...meshBounds(min, max, STRUCTURE_CELL), STRUCTURE_CELL)
}

function createOrganismGeometry(): BufferGeometry {
  const limbs = createOrganismLimbs()
  const min = new Vector3(Infinity, 0, Infinity)
  const max = new Vector3(-Infinity, 0, -Infinity)
  for (const item of limbs) {
    min.min(item.centre.clone().subScalar(item.reach))
    max.max(item.centre.clone().addScalar(item.reach))
  }
  min.y = 0
  return meshSdf(organismSdf(limbs), ...meshBounds(min, max, ORGANISM_CELL), ORGANISM_CELL)
}

/** Base on the floor, SPECIMEN_HEIGHT tall, smooth normals. */
function normalizeHeight(geometry: BufferGeometry): BufferGeometry {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const scale = SPECIMEN_HEIGHT / (box.max.y - box.min.y)
  geometry.translate(0, -box.min.y, 0)
  geometry.scale(scale, scale, scale)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/** Squared texel distance standing in for "no floor contact"; finite so the parabolas stay exact. */
const FAR = 1e12

/** Exact 1D squared distance transform (Felzenszwalb & Huttenlocher), in place. */
function distanceTransform1d(f: Float64Array, offset: number, stride: number, n: number) {
  const values = new Float64Array(n)
  const hull = new Int32Array(n)
  const bounds = new Float64Array(n + 1)
  for (let i = 0; i < n; i += 1) {
    values[i] = f[offset + i * stride]!
  }
  const intersect = (q: number, r: number) =>
    (values[q]! + q * q - (values[r]! + r * r)) / (2 * (q - r))
  let k = 0
  hull[0] = 0
  bounds[0] = -Infinity
  bounds[1] = Infinity
  for (let q = 1; q < n; q += 1) {
    let s = intersect(q, hull[k]!)
    while (k > 0 && s <= bounds[k]!) {
      k -= 1
      s = intersect(q, hull[k]!)
    }
    k += 1
    hull[k] = q
    bounds[k] = s
    bounds[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q += 1) {
    while (bounds[k + 1]! < q) {
      k += 1
    }
    const r = hull[k]!
    f[offset + q * stride] = (q - r) * (q - r) + values[r]!
  }
}

/** Distance from every floor texel to the nearest vertex resting on the floor. */
function createFootprintGap(geometry: BufferGeometry): DataTexture {
  const n = FOOTPRINT_RES
  const texel = FOOTPRINT_FIELD_SIZE / n
  const field = new Float64Array(n * n).fill(FAR)
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i += 1) {
    if (position.getY(i) > FLOOR_EPSILON) {
      continue
    }
    const u = Math.floor((position.getX(i) + FOOTPRINT_FIELD_SIZE / 2) / texel)
    const v = Math.floor((position.getZ(i) + FOOTPRINT_FIELD_SIZE / 2) / texel)
    if (u >= 0 && u < n && v >= 0 && v < n) {
      field[v * n + u] = 0
    }
  }
  for (let v = 0; v < n; v += 1) {
    distanceTransform1d(field, v * n, 1, n)
  }
  for (let u = 0; u < n; u += 1) {
    distanceTransform1d(field, u, n, n)
  }
  // Half float, not bytes: 1/255 steps are about a pixel up close, and the floor's falloff steps on them.
  const data = new Uint16Array(n * n)
  for (let i = 0; i < n * n; i += 1) {
    const gap = Math.sqrt(field[i]!) * texel
    data[i] = DataUtils.toHalfFloat(Math.min(gap / FOOTPRINT_GAP_RANGE, 1))
  }
  const texture = new DataTexture(data, n, n, RedFormat, HalfFloatType)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}

const BUILDERS: Record<SpecimenId, () => BufferGeometry> = {
  surface: createSurfaceGeometry,
  structure: createStructureGeometry,
  organism: createOrganismGeometry,
}

const cache = new Map<SpecimenId, Specimen>()

/** Built on first use and kept; switching back to a geometry is instant. */
export function getSpecimen(id: SpecimenId): Specimen {
  let specimen = cache.get(id)
  if (!specimen) {
    const geometry = normalizeHeight(BUILDERS[id]())
    addSurfaceFields(geometry)
    specimen = { id, geometry, footprintGap: createFootprintGap(geometry) }
    cache.set(id, specimen)
  }
  return specimen
}
