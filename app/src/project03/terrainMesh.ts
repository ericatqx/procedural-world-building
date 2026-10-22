import { BufferAttribute, BufferGeometry, Float32BufferAttribute } from 'three'
import { PROJECT_COLORS } from '../project/materials.ts'
import { clamp01, lerp, smoothstep } from '../project02/core.ts'
import { LANDFORM_02 } from '../project02/landform.ts'
import { perlin2 } from '../shared/noise/perlin.ts'
import { simplex2 } from '../shared/noise/simplex.ts'
import { ISLAND_METERS_PER_UNIT, LANDSCAPE, islandRadius, landscapeHeight, type LandscapeConfig } from './terrain.ts'

/** Spacings up to this use the apron samples for normals; coarser ones sample the surface directly. */
const APRON_STEP = 4
/** Skirt depth, in meters, before the spacing term. */
const SKIRT_BASE = 8

export type ChunkNeighbors = { e: number; w: number; n: number; s: number }

/** The 0.1 / 0.2 terrain palette, stored as linear albedo. */
function srgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return ([(value >> 16) & 255, (value >> 8) & 255, value & 255] as const).map((channel) => {
    const s = channel / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
}

const COLOR = {
  // Terrain stone: taupe in the basins, warm gray on the slopes, limestone on the crests.
  low: srgb('#5e5a54'),
  valley: srgb('#8a867d'),
  high: srgb('#bcb7aa'),
  slope: srgb('#85817a'),
  rock: srgb('#6c6863'),
  dust: srgb('#c8c3b6'),
  strata: srgb(PROJECT_COLORS.terrainStrata),
  deep: srgb(PROJECT_COLORS.terrainDeep),
}

/** Stone tones for the cliff and underside beds. */
const BEDS = ['#8f887c', '#a39c8b', '#7f776c', '#b0a896', '#6f6a63', '#8d8478', '#9b9486', '#756d64'].map(srgb)

/** Bed boundaries in meters of height, from deep to high, with uneven thickness. */
const BED_EDGES: number[] = (() => {
  const edges: number[] = []
  let at = -2400
  for (let n = 0; at < 800; n += 1) {
    edges.push(at)
    at += 4 + 38 * hash(n * 3.1 + 0.7) ** 1.7
  }
  return edges
})()

function bedIndex(height: number): number {
  let lo = 0
  let hi = BED_EDGES.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (BED_EDGES[mid]! <= height) lo = mid
    else hi = mid - 1
  }
  return lo
}

function mix(out: number[], a: readonly number[], b: readonly number[], t: number) {
  out[0] = a[0]! + (b[0]! - a[0]!) * t
  out[1] = a[1]! + (b[1]! - a[1]!) * t
  out[2] = a[2]! + (b[2]! - a[2]!) * t
}

/** How many of this chunk's segments one coarser-neighbor vertex spans. */
function edgeSpan(lod: number, neighborLod: number): number {
  return neighborLod > lod ? 1 << (neighborLod - lod) : 1
}

/**
 * One chunk of the height field. A coarser neighbor does not share the
 * extra edge vertices, so those are lowered onto the straight edge the
 * neighbor actually draws. Both sides then use the same line.
 */
export function buildChunkGeometry(
  originX: number,
  originZ: number,
  lod: number,
  neighbors: ChunkNeighbors,
  config: LandscapeConfig = LANDSCAPE,
): BufferGeometry {
  const step = config.lodStep[lod]!
  const segs = Math.round(config.chunkSize / step)
  const verts = segs + 1
  // One sample outside the chunk so an edge normal matches the neighbor's.
  const span = verts + 2
  const field = new Float32Array(span * span)
  for (let j = -1; j <= segs + 1; j += 1) {
    const z = originZ + j * step
    for (let i = -1; i <= segs + 1; i += 1) {
      field[(j + 1) * span + (i + 1)] = landscapeHeight(originX + i * step, z, config)
    }
  }
  const heights = new Float32Array(verts * verts)
  for (let j = 0; j < verts; j += 1) {
    for (let i = 0; i < verts; i += 1) heights[j * verts + i] = field[(j + 1) * span + (i + 1)]!
  }
  conformEdge(heights, segs, verts, edgeSpan(lod, neighbors.s), 's')
  conformEdge(heights, segs, verts, edgeSpan(lod, neighbors.n), 'n')
  conformEdge(heights, segs, verts, edgeSpan(lod, neighbors.w), 'w')
  conformEdge(heights, segs, verts, edgeSpan(lod, neighbors.e), 'e')
  const neighborStep = {
    e: config.lodStep[neighbors.e]!,
    w: config.lodStep[neighbors.w]!,
    n: config.lodStep[neighbors.n]!,
    s: config.lodStep[neighbors.s]!,
  }
  const gridCount = verts * verts
  const positions = new Float32Array(gridCount * 3)
  const normals = new Float32Array(gridCount * 3)
  const colors = new Float32Array(gridCount * 3)
  const outside = new Uint8Array(gridCount)
  const scratch = [0, 0, 0]
  for (let j = 0; j < verts; j += 1) {
    for (let i = 0; i < verts; i += 1) {
      const index = j * verts + i
      const x = originX + i * step
      const z = originZ + j * step
      const y = heights[index]!
      if (Math.hypot(x, z) > islandRadius(Math.atan2(z, x))) outside[index] = 1
      positions[index * 3] = x
      positions[index * 3 + 1] = y
      positions[index * 3 + 2] = z
      // Normal and color come from the true surface, never the conformed edge
      // or this lod's spacing, so both sides of a seam and every lod agree.
      const trueY = field[(j + 1) * span + (i + 1)]!
      // The stencil spans about one cell, so the lighting matches what the mesh
      // can draw instead of aliasing detail it cannot. Edge vertices use the
      // coarser of the two chunks' spacings, so both sides of a seam agree.
      let reach: number = step
      if (i === 0) reach = Math.max(reach, neighborStep.w)
      if (i === segs) reach = Math.max(reach, neighborStep.e)
      if (j === 0) reach = Math.max(reach, neighborStep.s)
      if (j === segs) reach = Math.max(reach, neighborStep.n)
      let dx: number
      let dz: number
      if (reach === step && step <= APRON_STEP) {
        dx = field[(j + 1) * span + (i + 2)]! - field[(j + 1) * span + i]!
        dz = field[(j + 2) * span + (i + 1)]! - field[j * span + (i + 1)]!
      } else {
        dx = landscapeHeight(x + reach, z, config) - landscapeHeight(x - reach, z, config)
        dz = landscapeHeight(x, z + reach, config) - landscapeHeight(x, z - reach, config)
      }
      const run = reach
      const nx = -dx
      const ny = 2 * run
      const nz = -dz
      const len = Math.hypot(nx, ny, nz) || 1
      normals[index * 3] = nx / len
      normals[index * 3 + 1] = ny / len
      normals[index * 3 + 2] = nz / len
      const slope = (Math.acos(clamp01(ny / len)) * 180) / Math.PI
      shade(scratch, trueY, slope, x, z)
      colors[index * 3] = scratch[0]!
      colors[index * 3 + 1] = scratch[1]!
      colors[index * 3 + 2] = scratch[2]!
    }
  }

  // Grid vertices stay on the lattice so neighboring chunks, including
  // coarser ones, share an edge. Cells that cross the outline are clipped
  // to it. Projecting those vertices inward folds a concave shore.
  const extra: number[] = []
  const clipAt = new Map<number, number>()
  const indices: number[] = []
  const onIsland = (x: number, z: number) => Math.hypot(x, z) <= islandRadius(Math.atan2(z, x))
  const clipBetween = (from: number, to: number) => {
    const key = from < to ? from * gridCount + to : to * gridCount + from
    const cached = clipAt.get(key)
    if (cached !== undefined) return cached
    const ax = positions[from * 3]!
    const az = positions[from * 3 + 2]!
    const bx = positions[to * 3]!
    const bz = positions[to * 3 + 2]!
    let lo = 0
    let hi = 1
    const fromIn = onIsland(ax, az)
    for (let n = 0; n < 16; n += 1) {
      const t = (lo + hi) * 0.5
      const x = ax + (bx - ax) * t
      const z = az + (bz - az) * t
      if (onIsland(x, z) === fromIn) lo = t
      else hi = t
    }
    const t = (lo + hi) * 0.5
    const x = ax + (bx - ax) * t
    const z = az + (bz - az) * t
    const y = landscapeHeight(x, z, config)
    const index = gridCount + extra.length / 9
    const nx = normals[from * 3]! + (normals[to * 3]! - normals[from * 3]!) * t
    const ny = normals[from * 3 + 1]! + (normals[to * 3 + 1]! - normals[from * 3 + 1]!) * t
    const nz = normals[from * 3 + 2]! + (normals[to * 3 + 2]! - normals[from * 3 + 2]!) * t
    const len = Math.hypot(nx, ny, nz) || 1
    shade(scratch, y, (Math.acos(clamp01(ny / len)) * 180) / Math.PI, x, z)
    extra.push(x, y, z, nx / len, ny / len, nz / len, scratch[0]!, scratch[1]!, scratch[2]!)
    clipAt.set(key, index)
    return index
  }
  const emit = (poly: number[]) => {
    for (let k = 1; k < poly.length - 1; k += 1) indices.push(poly[0]!, poly[k]!, poly[k + 1]!)
  }

  for (let j = 0; j < segs; j += 1) {
    for (let i = 0; i < segs; i += 1) {
      const a = j * verts + i
      const b = a + 1
      const c = a + verts
      const d = c + 1
      const outA = outside[a]!
      const outB = outside[b]!
      const outC = outside[c]!
      const outD = outside[d]!
      if (outA && outB && outC && outD) continue
      if (!outA && !outB && !outC && !outD) {
        const ridge = Math.abs(heights[a]! - heights[d]!)
        const valley = Math.abs(heights[b]! - heights[c]!)
        if (ridge <= valley) indices.push(a, c, d, a, d, b)
        else indices.push(a, c, b, b, c, d)
        continue
      }
      const corners = [a, c, d, b]
      const flags = [outA, outC, outD, outB]
      const poly: number[] = []
      for (let k = 0; k < 4; k += 1) {
        const cur = corners[k]!
        const prev = corners[(k + 3) % 4]!
        const curIn = flags[k] === 0
        const prevIn = flags[(k + 3) % 4] === 0
        if (curIn) {
          if (!prevIn) poly.push(clipBetween(prev, cur))
          poly.push(cur)
        } else if (prevIn) poly.push(clipBetween(prev, cur))
      }
      emit(poly)
    }
  }

  // Skirts: a short wall under each inland edge vertex. When a neighbor is
  // rebuilt a frame later, or its coarser edge cuts across ours, the sliver
  // between the two edges shows this wall, and the background stays hidden.
  const skirtDepth = SKIRT_BASE + step * 0.8
  const lowered = new Map<number, number>()
  const drop = (v: number) => {
    const cached = lowered.get(v)
    if (cached !== undefined) return cached
    const index = gridCount + extra.length / 9
    extra.push(
      positions[v * 3]!,
      positions[v * 3 + 1]! - skirtDepth,
      positions[v * 3 + 2]!,
      normals[v * 3]!,
      normals[v * 3 + 1]!,
      normals[v * 3 + 2]!,
      colors[v * 3]! * 0.8,
      colors[v * 3 + 1]! * 0.8,
      colors[v * 3 + 2]! * 0.8,
    )
    lowered.set(v, index)
    return index
  }
  // Each edge lists its vertices in increasing x (south, north) or z (west, east).
  const wall = (a: number, b: number, outward: boolean) => {
    if (outside[a] || outside[b]) return
    const low = drop(a)
    const lowB = drop(b)
    if (outward) indices.push(a, b, low, b, lowB, low)
    else indices.push(a, low, b, b, low, lowB)
  }
  for (let k = 0; k < segs; k += 1) {
    wall(k, k + 1, true)
    wall(segs * verts + k, segs * verts + k + 1, false)
    wall(k * verts, (k + 1) * verts, false)
    wall(k * verts + segs, (k + 1) * verts + segs, true)
  }

  const count = gridCount + extra.length / 9
  const packedP = new Float32Array(count * 3)
  const packedN = new Float32Array(count * 3)
  const packedC = new Float32Array(count * 3)
  packedP.set(positions)
  packedN.set(normals)
  packedC.set(colors)
  for (let e = 0; e < extra.length; e += 9) {
    const index = gridCount + e / 9
    packedP[index * 3] = extra[e]!
    packedP[index * 3 + 1] = extra[e + 1]!
    packedP[index * 3 + 2] = extra[e + 2]!
    packedN[index * 3] = extra[e + 3]!
    packedN[index * 3 + 1] = extra[e + 4]!
    packedN[index * 3 + 2] = extra[e + 5]!
    packedC[index * 3] = extra[e + 6]!
    packedC[index * 3 + 1] = extra[e + 7]!
    packedC[index * 3 + 2] = extra[e + 8]!
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(packedP, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(packedN, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(packedC, 3))
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1))
  geometry.computeBoundingSphere()
  return geometry
}

function conformEdge(heights: Float32Array, segs: number, verts: number, span: number, edge: 'n' | 's' | 'e' | 'w') {
  if (span <= 1) return
  const vertical = edge === 'e' || edge === 'w'
  const fixed = edge === 'e' || edge === 'n' ? segs : 0
  const count = segs
  for (let i = 1; i < count; i += 1) {
    if (i % span === 0) continue
    const i0 = i - (i % span)
    const i1 = Math.min(segs, i0 + span)
    const t = (i - i0) / (i1 - i0)
    const h0 = sample(heights, verts, fixed, i0, vertical)
    const h1 = sample(heights, verts, fixed, i1, vertical)
    write(heights, verts, fixed, i, vertical, lerp(h0, h1, t))
  }
}

function sample(heights: Float32Array, verts: number, fixed: number, along: number, vertical: boolean): number {
  return heights[vertical ? along * verts + fixed : fixed * verts + along]!
}

function write(heights: Float32Array, verts: number, fixed: number, along: number, vertical: boolean, value: number) {
  heights[vertical ? along * verts + fixed : fixed * verts + along] = value
}

/**
 * Same stacking as the 0.1 terrain shader: low ground into the valley gray,
 * pale on the crests, cooler on the slope, rock on the steep face, dust
 * where the crest is gentle. A broad mottle keeps a face from reading flat.
 */
function shade(out: number[], height: number, slope: number, x: number, z: number) {
  const heightT = smoothstep(30, 170, height)
  const topT = smoothstep(210, 390, height)
  const slopeT = smoothstep(7, 26, slope)
  const rockT = smoothstep(22, 40, slope)
  const dustT = smoothstep(300, 430, height) * (1 - smoothstep(10, 28, slope))
  mix(out, COLOR.low, COLOR.valley, heightT)
  mix(out, out, COLOR.high, topT * 0.8)
  mix(out, out, COLOR.slope, slopeT * 0.6)
  mix(out, out, COLOR.rock, rockT * (1 - topT * 0.35))
  mix(out, out, COLOR.dust, dustT * 0.8)

  const mottle = simplex2(x * 0.0011 + 1.3, z * 0.0011 + 4.2)
  const grain = simplex2(x * 0.02 + 2.2, z * 0.02 - 1.4)
  const scale = (1 + mottle * 0.07 + grain * 0.028)
  out[0] *= scale
  out[1] *= scale
  out[2] *= scale * (1 + mottle * 0.012)
}

/** Cliff and underside constants from the shared landmass builder, in 0.2 landform units. */
const UNDERCUT = 0.2
const CLIFF_ROWS = 64
const UNDERSIDE_RINGS = 40
const STRATA = 7
const SOFT_RECESS = 0.1
const LEDGE = 0.035
const LEDGE_HARDNESS = 0.74
const GULLY_DEPTH = 0.07
const FRACTURE_DEPTH = 0.06
const CAP_NOTCH = 0.07
const UNDER_BED = 0.13
const SPUR_LENGTH = 0.35
/** How far inside the lip the ledge sits, and how far below the ground the face stays. */
const CAP_METERS = 14
const COVER_METERS = 1.5

function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

const ringNoise = (angle: number, frequency: number, seed: number) =>
  perlin2(Math.cos(angle) * frequency + seed, Math.sin(angle) * frequency - seed)

/** Same face weathering as the shared landmass: beds, a cap notch, gullies, fractures. */
function cliffErosion(angle: number, y: number, k: number) {
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

const terrace = (value: number, thickness: number) => {
  const beds = value / thickness
  const whole = Math.floor(beds)
  return thickness * (whole + smoothstep(0.7, 1, beds - whole))
}

/**
 * 0.2's cliff and underside, in meters. Horizontal distances and the shell's
 * vertical distances use the landform scale. The lip height is the 0.3 surface
 * at that outline point, so the chunked ground meets the face.
 */
export function buildIslandShell(config: LandscapeConfig = LANDSCAPE): BufferGeometry {
  const segments = LANDFORM_02.tessellation?.segments ?? 560
  const scale = ISLAND_METERS_PER_UNIT
  const underDepth = LANDFORM_02.undersideDepth
  const angleOf = (s: number) => (2 * Math.PI * s) / segments
  const next = (s: number) => (s + 1) % segments

  const radii: number[] = []
  const rimTop: number[] = []
  const rimBottom: number[] = []
  for (let s = 0; s < segments; s += 1) {
    const angle = angleOf(s)
    const radius = LANDFORM_02.outlineRadius(angle)
    radii.push(radius)
    const x = radius * Math.cos(angle) * scale
    const z = radius * Math.sin(angle) * scale
    const top = landscapeHeight(x, z, config)
    rimTop.push(top)
    rimBottom.push(top - LANDFORM_02.cliffDepth(angle) * scale)
  }

  const cliffCount = (CLIFF_ROWS + 1) * segments
  const underCount = UNDERSIDE_RINGS * segments
  const total = cliffCount + underCount + 1 + segments
  const positions = new Float32Array(total * 3)
  const colors = new Float32Array(total * 3)
  const scratch = [0, 0, 0]
  let cursor = 0

  const put = (x: number, y: number, z: number, below: number, underside = false) => {
    const index = cursor
    cursor += 1
    positions[index * 3] = x
    positions[index * 3 + 1] = y
    positions[index * 3 + 2] = z
    const depth = Math.max(0, below / scale)
    // Beds are thin and thick in no fixed rhythm, and each wanders with the
    // angle around the island, so no two faces repeat. Tones stay close to
    // gray, with a faint warm or cool lean.
    const angle = Math.atan2(z, x)
    const warped = y + 16 * ringNoise(angle, 2.4, 5.5) + 6 * ringNoise(angle, 6.2, 1.3) + 3 * ringNoise(angle * 3, 11, 8.1)
    const bedNo = bedIndex(warped)
    const stone = BEDS[Math.floor(hash(bedNo * 1.9 + 0.4) * BEDS.length) % BEDS.length]!
    mix(scratch, COLOR.rock, stone, 0.7)
    mix(scratch, scratch, COLOR.deep, smoothstep(0.5, 2.6, depth) * 0.22)
    const bed = 0.92 + 0.14 * hash(bedNo * 2.3 + 8.2)
    const stain = underside ? 0.92 : 1
    colors[index * 3] = scratch[0]! * bed * stain
    colors[index * 3 + 1] = scratch[1]! * bed * stain
    colors[index * 3 + 2] = scratch[2]! * bed * stain
    return index
  }

  // A ledge just inside the lip, kept under the ground. The ground stops at
  // the outline within a meter or two, and this closes whatever is left.
  const capInset = CAP_METERS / scale
  const capRow = radii.map((radius, s) => {
    const angle = angleOf(s)
    const x = (radius - capInset) * Math.cos(angle) * scale
    const z = (radius - capInset) * Math.sin(angle) * scale
    const y = Math.min(rimTop[s]!, landscapeHeight(x, z, config) - 1)
    return put(x, y, z, rimTop[s]! - y)
  })

  const cliffRows: number[][] = []
  for (let row = 0; row <= CLIFF_ROWS; row += 1) {
    const k = row / CLIFF_ROWS
    cliffRows.push(
      radii.map((radius, s) => {
        const angle = angleOf(s)
        const y = rimTop[s]! + (rimBottom[s]! - rimTop[s]!) * k
        const inset = 1 - UNDERCUT * k ** 1.5
        const envelope = smoothstep(0, 0.12, k) * (1 - smoothstep(0.9, 1, k))
        let r = radius * inset - envelope * cliffErosion(angle, y / scale, k)
        if (row > 0) {
          // The face leans in as it falls. Where the ground falls away inward
          // faster than that, the face would come up through it, so it stays
          // out toward the lip until the ground is above it.
          const covered = (reach: number) =>
            landscapeHeight(reach * Math.cos(angle) * scale, reach * Math.sin(angle) * scale, config) - COVER_METERS >= y
          if (!covered(r)) {
            let near = 0
            let far = 1
            for (let step = 0; step < 9; step += 1) {
              const mid = (near + far) * 0.5
              if (covered(r + (radius - r) * mid)) far = mid
              else near = mid
            }
            r += (radius - r) * far
          }
        }
        return put(r * Math.cos(angle) * scale, y, r * Math.sin(angle) * scale, rimTop[s]! - y)
      }),
    )
  }

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
        const hang = underDepth * (1 - t * t) ** 0.8
        const layered = hang + 0.7 * (terrace(hang, UNDER_BED) - hang)
        const ridges = 0.45 * Math.abs(perlin2(x * 1.4 + 11.3, z * 1.4 - 4.7)) * (1 - t) ** 0.6
        const drip = 0.18 * perlin2(x * 3.2 - 2.1, z * 3.2 + 8.4) * (1 - t)
        const spur = SPUR_LENGTH * Math.max(0, perlin2(x * 4.5 + 3.3, z * 4.5 - 1.9) - 0.3) ** 1.5 * (1 - t) ** 0.4
        const yUnit = ring === UNDERSIDE_RINGS ? rimBottom[s]! / scale : rimBottom[s]! / scale - layered - ridges + drip - spur
        const y = yUnit * scale
        return put(x * scale, y, z * scale, rimTop[s]! - y, true)
      }),
    )
  }
  const meanFoot = rimBottom.reduce((sum, y) => sum + y, 0) / segments
  const keel = put(0, meanFoot - underDepth * scale - 0.2 * scale, 0, rimTop[0]! - (meanFoot - underDepth * scale), true)

  const indices: number[] = []
  const lip = cliffRows[0]!
  for (let s = 0; s < segments; s += 1) {
    indices.push(capRow[s]!, capRow[next(s)]!, lip[s]!, capRow[next(s)]!, lip[next(s)]!, lip[s]!)
  }
  for (let row = 0; row < CLIFF_ROWS; row += 1) {
    const upper = cliffRows[row]!
    const lower = cliffRows[row + 1]!
    for (let s = 0; s < segments; s += 1) {
      indices.push(upper[s]!, upper[next(s)]!, lower[s]!, upper[next(s)]!, lower[next(s)]!, lower[s]!)
    }
  }
  for (let ring = 0; ring < UNDERSIDE_RINGS - 1; ring += 1) {
    const outer = undersideRings[ring]!
    const inner = undersideRings[ring + 1]!
    for (let s = 0; s < segments; s += 1) {
      const a = inner[s]!
      const b = inner[next(s)]!
      const c = outer[s]!
      const d = outer[next(s)]!
      indices.push(a, c, b, b, c, d)
    }
  }
  const innermost = undersideRings[UNDERSIDE_RINGS - 1]!
  for (let s = 0; s < segments; s += 1) indices.push(keel, innermost[s]!, innermost[next(s)]!)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}
