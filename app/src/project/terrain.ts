import { BufferAttribute, BufferGeometry } from 'three'
import { combineLayerValues, DEFAULT_NOISE_SETTINGS, sampleLayerValue } from '../shared/noise/index.ts'
import { perlin2 } from '../shared/noise/perlin.ts'

/**
 * Shadow Ecology 0.1 — a floating landmass: an irregular top surface with an
 * eroded rim, a layered cliff band that tapers inward (a notch under the cap
 * rock, soft beds recessed under hard lips, broken ledges, gullies and
 * fractures), and a hanging underside stepped in beds with spurs of rock.
 * World units, centred on the origin.
 */
export const ISLAND_RADIUS = 3

const TOP_RINGS = 96
const SEGMENTS = 384
const CLIFF_ROWS = 64
const UNDERSIDE_RINGS = 40

/** How far the underside rim is pulled in from the top rim: the landmass tapers downward. */
const UNDERCUT = 0.2
const UNDERSIDE_DEPTH = 1.3

/** Rock beds per world unit of height; each bed is harder or softer. */
const STRATA = 7
/** How far (world units) the softest bed weathers back from the harder ones. */
const SOFT_RECESS = 0.1
/** How far the hardest beds stand out as ledges, where they survive. */
const LEDGE = 0.035
const LEDGE_HARDNESS = 0.74
/** Depth of the gullies rain cuts down the cliff. */
const GULLY_DEPTH = 0.07
/** Depth of the narrow vertical fractures through the cliff. */
const FRACTURE_DEPTH = 0.06
/** Depth of the notch weathered back under the hard cap rock at the top of the cliff. */
const CAP_NOTCH = 0.07
/** The underside hangs in beds of this thickness. */
const UNDER_BED = 0.13
const SPUR_LENGTH = 0.35

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

const bump = (dx: number, dz: number, spread: number) =>
  Math.exp(-(dx * dx + dz * dz) / spread)

/** Periodic noise around the outline: the same value at 0 and 2π. */
const ringNoise = (angle: number, frequency: number, seed: number) =>
  perlin2(Math.cos(angle) * frequency + seed, Math.sin(angle) * frequency - seed)

/**
 * Outline radius by angle: broad lobes, then ridged bites that read as
 * fractured bays where the edge has broken away.
 */
export function outlineRadius(angle: number): number {
  const lobes = 0.1 * Math.sin(3 * angle + 0.7) + 0.09 * ringNoise(angle, 1.8, 3.1)
  const bites = -0.09 * Math.abs(ringNoise(angle, 6.5, 7.7))
  return ISLAND_RADIUS * (1 + lobes + bites)
}

const NOISE_LAYERS = DEFAULT_NOISE_SETTINGS.layers
const NOISE_WINDOW = { x: 0.15, z: 0.2, size: 0.9 }

function noiseAt(x: number, z: number): number {
  const nx = NOISE_WINDOW.x + (x / (2 * ISLAND_RADIUS) + 0.5) * NOISE_WINDOW.size
  const nz = NOISE_WINDOW.z + (z / (2 * ISLAND_RADIUS) + 0.5) * NOISE_WINDOW.size
  return combineLayerValues(
    NOISE_LAYERS.map((layer) => sampleLayerValue(nx, nz, layer)),
    NOISE_LAYERS,
  )
}

/** Thickness of the rock shelves the ground steps down in, where shelving shows. */
const SHELF = 0.12

/**
 * Landform before erosion, largest first: a curving ridge rising to the back
 * (−Z), a knoll front-right, a hollow front-left, and Week 03 noise. Then
 * smaller relief: sharp local ridges, shallow hollows, uneven ground, and
 * patches where the ground steps down in shelves (never fully flat, so water
 * still drains across them).
 */
function landform(x: number, z: number): number {
  const ridgeZ = z + 0.35 * Math.sin(x * 1.1 + 0.4)
  const ridge = 0.95 * smoothstep(0.5, -2.4, ridgeZ)
  const knoll = 0.38 * bump(x - 1.7, z - 1.0, 0.45)
  const hollow = -0.42 * bump(x + 1.35, z - 1.25, 0.7)
  const broad = ridge + knoll + hollow + noiseAt(x, z) * 0.3 - 0.2

  const crests = 0.08 * (1 - Math.abs(perlin2(x * 0.95 + 5.3, z * 0.95 - 2.1))) ** 4
  const dips = -0.06 * smoothstep(0.2, 0.6, perlin2(x * 1.4 + 13.1, z * 1.4 + 4.2))
  const uneven = 0.03 * perlin2(x * 2.7 - 7.7, z * 2.7 + 1.9)
  const height = broad + crests + dips + uneven
  const shelving = 0.55 * smoothstep(0, 0.35, perlin2(x * 0.7 - 3.9, z * 0.7 + 6.6))
  return height + shelving * (terrace(height, SHELF) - height)
}

/** The rim wears down: height falls away over the outer band, unevenly. */
function rimErosion(t: number, angle: number): number {
  const band = smoothstep(0.8, 1, t)
  return 0.32 * band * band * (0.65 + 0.35 * ringNoise(angle, 4, 1.3))
}

/** Top-surface height anywhere on the island (erosion included). */
export function surfaceHeight(x: number, z: number): number {
  const angle = Math.atan2(z, x)
  const t = Math.min(1, Math.hypot(x, z) / outlineRadius(angle))
  return landform(x, z) - rimErosion(t, angle)
}

/** Cliff height by angle: deeper under the ridge, uneven all round. */
const cliffDepth = (angle: number) => 0.5 + 0.18 * ringNoise(angle, 2.6, 5.2) + 0.2 * Math.max(0, -Math.sin(angle))

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/**
 * How far the cliff face has weathered back (world units; negative stands
 * out): beds dip gently around the island; soft ones recess under hard lips,
 * and the hardest survive in broken runs as ledges. A notch undercuts the cap
 * rock; gullies and narrow fractures run down the face; the rest is broken rock.
 */
const cliffErosion = (angle: number, y: number, k: number) => {
  const coord = y * STRATA + 0.6 * ringNoise(angle, 3, 9.1)
  const bed = Math.floor(coord)
  const profileOf = (b: number) => {
    const hardness = hash(b)
    const recess = SOFT_RECESS * (1 - hardness) * (0.6 + 0.4 * ringNoise(angle, 5, b * 1.7))
    const ledge = hardness > LEDGE_HARDNESS ? LEDGE * smoothstep(0.05, 0.35, ringNoise(angle, 4, b * 2.9)) : 0
    return recess - ledge
  }
  const lip = smoothstep(0.82, 1, coord - bed)
  const beds = profileOf(bed) + (profileOf(bed + 1) - profileOf(bed)) * lip
  const notch = CAP_NOTCH * smoothstep(0.1, 0.2, k) * (1 - smoothstep(0.26, 0.42, k)) * (0.55 + 0.45 * ringNoise(angle, 3, 12.2))
  const gully = GULLY_DEPTH * (1 - Math.abs(ringNoise(angle, 18, 2.2))) ** 6 * (0.4 + 0.6 * k)
  const fracture = FRACTURE_DEPTH * (1 - Math.abs(ringNoise(angle, 9, 6.6))) ** 14
  const broken = 0.03 * Math.abs(perlin2(Math.cos(angle) * 9 + bed * 3.1, Math.sin(angle) * 9 - bed * 2.3))
  return beds + notch + gully + fracture + broken
}

/** Rounds `value` into beds of `thickness`, each ending in a short, steep step. */
const terrace = (value: number, thickness: number) => {
  const beds = value / thickness
  return thickness * (Math.floor(beds) + smoothstep(0.7, 1, beds - Math.floor(beds)))
}

/** `geometry` carries `aBelow`: depth below the top rim (0 on the top surface), for the material. */
export type Landmass = {
  geometry: BufferGeometry
  /** Lowest point of the underside. */
  lowest: number
}

/** How far a channel lowers the top surface at (x, z); 0 away from water. */
export type Carve = (x: number, z: number) => number

export function createLandmass(carve: Carve = () => 0): Landmass {
  const positions: number[] = []
  const below: number[] = []
  const indices: number[] = []
  const push = (x: number, y: number, z: number, depth = 0) => {
    positions.push(x, y, z)
    below.push(depth)
    return positions.length / 3 - 1
  }
  const angleOf = (s: number) => (2 * Math.PI * s) / SEGMENTS

  const rimTop: number[] = []
  const rimBottom: number[] = []
  const radii: number[] = []
  for (let s = 0; s < SEGMENTS; s += 1) {
    const angle = angleOf(s)
    const radius = outlineRadius(angle)
    radii.push(radius)
    const x = radius * Math.cos(angle)
    const z = radius * Math.sin(angle)
    rimTop.push(landform(x, z) - rimErosion(1, angle) - carve(x, z))
    rimBottom.push(rimTop[s]! - cliffDepth(angle))
  }

  // Top: centre fan plus rings out to the outline.
  const topCenter = push(0, surfaceHeight(0, 0) - carve(0, 0), 0)
  const topRings: number[][] = []
  for (let ring = 1; ring <= TOP_RINGS; ring += 1) {
    const t = ring / TOP_RINGS
    topRings.push(
      radii.map((radius, s) => {
        const angle = angleOf(s)
        const x = t * radius * Math.cos(angle)
        const z = t * radius * Math.sin(angle)
        return push(x, landform(x, z) - rimErosion(t, angle) - carve(x, z), z)
      }),
    )
  }
  const next = (s: number) => (s + 1) % SEGMENTS
  for (let s = 0; s < SEGMENTS; s += 1) {
    indices.push(topCenter, topRings[0]![next(s)]!, topRings[0]![s]!)
  }
  for (let ring = 0; ring < TOP_RINGS - 1; ring += 1) {
    const inner = topRings[ring]!
    const outer = topRings[ring + 1]!
    for (let s = 0; s < SEGMENTS; s += 1) {
      const a = inner[s]!
      const b = inner[next(s)]!
      const c = outer[s]!
      const d = outer[next(s)]!
      indices.push(a, b, c, b, d, c)
    }
  }

  // Cliff: rows from the top rim down to the undercut underside rim.
  const cliffRows: number[][] = []
  for (let row = 0; row <= CLIFF_ROWS; row += 1) {
    const k = row / CLIFF_ROWS
    cliffRows.push(
      radii.map((radius, s) => {
        const angle = angleOf(s)
        const y = rimTop[s]! + (rimBottom[s]! - rimTop[s]!) * k
        const inset = 1 - UNDERCUT * k ** 1.5
        // Zero at both seams, so the face meets the top rim and the underside exactly.
        const envelope = smoothstep(0, 0.12, k) * (1 - smoothstep(0.9, 1, k))
        const r = radius * inset - envelope * cliffErosion(angle, y, k)
        return push(r * Math.cos(angle), y, r * Math.sin(angle), rimTop[s]! - y)
      }),
    )
  }
  for (let row = 0; row < CLIFF_ROWS; row += 1) {
    const upper = cliffRows[row]!
    const lower = cliffRows[row + 1]!
    for (let s = 0; s < SEGMENTS; s += 1) {
      indices.push(upper[s]!, upper[next(s)]!, lower[s]!, upper[next(s)]!, lower[next(s)]!, lower[s]!)
    }
  }

  // Underside: from the undercut rim in to a hanging keel, deepest under the
  // centre, with ridged noise for fractured, dripping rock.
  let lowest = Infinity
  const undersideCenterY = (() => {
    const meanRim = rimBottom.reduce((sum, y) => sum + y, 0) / SEGMENTS
    return meanRim - UNDERSIDE_DEPTH
  })()
  const undersideRings: number[][] = []
  for (let ring = UNDERSIDE_RINGS; ring >= 1; ring -= 1) {
    const t = ring / UNDERSIDE_RINGS
    undersideRings.push(
      radii.map((radius, s) => {
        const angle = angleOf(s)
        const ragged = 1 - 0.05 * Math.abs(ringNoise(angle, 7, 4.4 + t * 3)) * (1 - t)
        const r = t * radius * (1 - UNDERCUT) * ragged
        const x = r * Math.cos(angle)
        const z = r * Math.sin(angle)
        const hang = UNDERSIDE_DEPTH * (1 - t * t) ** 0.8
        const layered = hang + 0.7 * (terrace(hang, UNDER_BED) - hang)
        const ridges = 0.45 * Math.abs(perlin2(x * 1.4 + 11.3, z * 1.4 - 4.7)) * (1 - t) ** 0.6
        const drip = 0.18 * perlin2(x * 3.2 - 2.1, z * 3.2 + 8.4) * (1 - t)
        const spur = SPUR_LENGTH * Math.max(0, perlin2(x * 4.5 + 3.3, z * 4.5 - 1.9) - 0.3) ** 1.5 * (1 - t) ** 0.4
        const y = ring === UNDERSIDE_RINGS ? rimBottom[s]! : rimBottom[s]! - layered - ridges + drip - spur
        lowest = Math.min(lowest, y)
        return push(x, y, z, rimTop[s]! - y)
      }),
    )
  }
  const meanTop = rimTop.reduce((sum, y) => sum + y, 0) / SEGMENTS
  const keel = push(0, undersideCenterY - 0.2, 0, meanTop - (undersideCenterY - 0.2))
  lowest = Math.min(lowest, undersideCenterY - 0.2)
  for (let ring = 0; ring < UNDERSIDE_RINGS - 1; ring += 1) {
    const outer = undersideRings[ring]!
    const inner = undersideRings[ring + 1]!
    for (let s = 0; s < SEGMENTS; s += 1) {
      const a = inner[s]!
      const b = inner[next(s)]!
      const c = outer[s]!
      const d = outer[next(s)]!
      indices.push(a, c, b, b, c, d)
    }
  }
  const innermost = undersideRings[UNDERSIDE_RINGS - 1]!
  for (let s = 0; s < SEGMENTS; s += 1) {
    indices.push(keel, innermost[s]!, innermost[next(s)]!)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('aBelow', new BufferAttribute(new Float32Array(below), 1))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return { geometry, lowest }
}
