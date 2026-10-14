import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
  type Texture,
} from 'three'
import { smoothTrace } from '../../project/grid.ts'
import { setArchitectureClock } from '../../project/materials.ts'
import type { SurfaceMaterial } from '../../shared/shaders/surfaceMaterial.ts'
import { SUITABLE } from '../../project/habitat.ts'
import { MeshBuilder, type RibbonPoint } from '../../project/meshBuilder.ts'
import { HISTORY_COLORS } from './historyColors.ts'
import {
  archAtGround,
  CELL,
  CELLS,
  cellX,
  cellZ,
  GRID,
  HALF,
  HOME_MIN,
  LEVEL,
  LEVELS,
  reclaimedPath,
  SITE,
  type World,
} from './historyWorld.ts'
import { cellOf, groundHeight, isWaterAt, surfaceHeight, WATER_LEVEL } from './site.ts'

/**
 * Week 07 Branching Histories — the meshes and fields the scene draws a
 * world with. The block and its lake are Week 06's own meshes
 * (`createStudyTerrain`); everything placed on them stands on its rendered
 * surface. Per-cell state reaches the Project's terrain and architecture
 * materials as field textures over the lattice, so habitat, damp ground
 * and wear blend smoothly rather than by cell.
 */

/** The Project water material's attributes. */
const WATER_ATTRIBUTES = ['aDepth', 'aFlow', 'aAcross', 'aFall', 'aSpeed']

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

export const hash = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

/** Bilinear sample of a per-cell field at (x, z). */
export function sampleCells(field: ArrayLike<number>, x: number, z: number) {
  const fx = Math.min(GRID - 1, Math.max(0, (x + HALF) / CELL - 0.5))
  const fz = Math.min(GRID - 1, Math.max(0, (z + HALF) / CELL - 0.5))
  const i = Math.min(GRID - 2, Math.floor(fx))
  const j = Math.min(GRID - 2, Math.floor(fz))
  const tx = fx - i
  const tz = fz - j
  const at = (di: number, dj: number) => Number(field[(j + dj) * GRID + i + di])
  return (at(0, 0) * (1 - tx) + at(1, 0) * tx) * (1 - tz) + (at(0, 1) * (1 - tx) + at(1, 1) * tx) * tz
}

/** One edge of a triangle crossing the threshold, interpolated. */
function crossing(a: [number, number, number], b: [number, number, number], threshold: number): [number, number, number] {
  const t = (threshold - a[2]) / (b[2] - a[2])
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, threshold]
}

/** The part of triangle (x, z, value) where value ≥ threshold: a polygon of 0, 3 or 4 points. */
function clipTriangle(points: [number, number, number][], threshold: number) {
  const out: [number, number, number][] = []
  for (let k = 0; k < 3; k++) {
    const a = points[k]!
    const b = points[(k + 1) % 3]!
    const aIn = a[2] >= threshold
    const bIn = b[2] >= threshold
    if (aIn) {
      out.push(a)
    }
    if (aIn !== bIn) {
      out.push(crossing(a, b, threshold))
    }
  }
  return out
}

const FLOOD_SEGMENTS = 3
/** The flooded mask is softened before contouring, so neighbouring cells merge into one margin rather than reading as squares. */
const FLOOD_EDGE = 0.3

function softened(mask: Float32Array): Float32Array {
  const out = new Float32Array(CELLS)
  const weight = [1, 2, 1]
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      let sum = 0
      let total = 0
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di
          const jj = j + dj
          if (ii >= 0 && jj >= 0 && ii < GRID && jj < GRID) {
            const k = weight[di + 1]! * weight[dj + 1]!
            sum += k * mask[jj * GRID + ii]!
            total += k
          }
        }
      }
      out[j * GRID + i] = sum / total
    }
  }
  return out
}

/**
 * The ground where a per-cell field, softened, reaches `edge`: finely
 * contoured, clear of the lake, as triangles through `emit`.
 */
function contourSheet(
  field: Float32Array,
  edge: number,
  builder: MeshBuilder,
  emit: (x: number, z: number) => number,
): BufferGeometry | null {
  let i0 = GRID
  let i1 = -1
  let j0 = GRID
  let j1 = -1
  for (let c = 0; c < CELLS; c++) {
    if (field[c]! > 0) {
      i0 = Math.min(i0, c % GRID)
      i1 = Math.max(i1, c % GRID)
      j0 = Math.min(j0, Math.floor(c / GRID))
      j1 = Math.max(j1, Math.floor(c / GRID))
    }
  }
  if (i1 < 0) {
    return null
  }
  const soft = softened(field)
  const x0 = -HALF + (i0 - 1) * CELL
  const z0 = -HALF + (j0 - 1) * CELL
  const step = CELL / FLOOD_SEGMENTS
  const ni = (i1 - i0 + 3) * FLOOD_SEGMENTS
  const nj = (j1 - j0 + 3) * FLOOD_SEGMENTS
  const corner = (i: number, j: number): [number, number, number] => {
    const x = x0 + i * step
    const z = z0 + j * step
    return [x, z, isWaterAt(x, z) ? 0 : sampleCells(soft, x, z)]
  }
  let any = false
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      const a = corner(i, j)
      const b = corner(i, j + 1)
      const c = corner(i + 1, j)
      const d = corner(i + 1, j + 1)
      for (const triangle of [
        [a, b, c],
        [c, b, d],
      ]) {
        const polygon = clipTriangle(triangle, edge)
        if (polygon.length < 3) {
          continue
        }
        const ids = polygon.map(([x, z]) => emit(x, z))
        for (let k = 1; k < ids.length - 1; k++) {
          builder.triangle(ids[0]!, ids[k]!, ids[k + 1]!)
        }
        any = true
      }
    }
  }
  return any ? builder.build() : null
}

/** Ground the dam has flooded: a shallow sheet over it, its edge a smooth contour of the flooded cells. */
export function floodGeometry(w: World): BufferGeometry | null {
  const flooded = new Float32Array(CELLS)
  for (let c = 0; c < CELLS; c++) {
    flooded[c] = w.water[c] && !SITE.water[c] ? 1 : 0
  }
  const builder = new MeshBuilder(WATER_ATTRIBUTES)
  return contourSheet(flooded, FLOOD_EDGE, builder, (x, z) =>
    builder.vertex(x, Math.max(WATER_LEVEL, surfaceHeight(x, z)) + 0.012, z, {
      aDepth: 0.015,
      aFlow: -1,
      aAcross: 0,
      aFall: 0,
      aSpeed: 0,
    }),
  )
}

/** Wear at which ground is trodden bare, and how far above the surface the bare sheet lies. */
export const TRODDEN = { from: 0.2, full: 0.55, edge: 0.35, lift: 0.005 } as const

/** Ground trodden bare by repeated walking: a sheet over it, its edge a smooth contour of the worn cells. */
export function troddenGeometry(w: World): BufferGeometry | null {
  const worn = new Float32Array(CELLS)
  for (let c = 0; c < CELLS; c++) {
    worn[c] = w.water[c] ? 0 : smooth(TRODDEN.from, TRODDEN.full, w.wear[c]!)
  }
  const builder = new MeshBuilder([])
  return contourSheet(worn, TRODDEN.edge, builder, (x, z) => builder.vertex(x, surfaceHeight(x, z) + TRODDEN.lift, z, {}))
}

const SHORE_STEP = 0.025
const SHORE_LIFT = 0.02

/** Where the water has spread, the shore it had before: the Week 06 lake's edge contoured around the flooded ground. */
export function formerShore(w: World): BufferGeometry | null {
  const flooded = new Float32Array(CELLS)
  let any = false
  for (let c = 0; c < CELLS; c++) {
    if (w.water[c] && !SITE.water[c]) {
      flooded[c] = 1
      any = true
    }
  }
  if (!any) {
    return null
  }
  const near = softened(softened(flooded))
  const position: number[] = []
  const n = Math.ceil((2 * HALF) / SHORE_STEP)
  const point = (i: number, j: number): [number, number, number] => {
    const x = -HALF + i * SHORE_STEP
    const z = -HALF + j * SHORE_STEP
    return [x, z, groundHeight(x, z) - WATER_LEVEL]
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = point(i, j)
      if (sampleCells(near, a[0], a[1]) < 0.02) {
        continue
      }
      const b = point(i, j + 1)
      const c = point(i + 1, j)
      const d = point(i + 1, j + 1)
      for (const triangle of [
        [a, b, c],
        [c, b, d],
      ]) {
        const polygon = clipTriangle(triangle, 0)
        const ends = polygon.filter(([, , value]) => value === 0)
        if (ends.length === 2) {
          for (const [x, z] of ends) {
            position.push(x, WATER_LEVEL + SHORE_LIFT, z)
          }
        }
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3))
  return geometry
}

/* ─── Fields for the Project's materials ─────────────────────────────── */

function gridTexture(data: Uint8Array): DataTexture {
  const texture = new DataTexture(data, GRID, GRID, RGBAFormat, UnsignedByteType)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

const byte = (value: number) => Math.round(clamp01(value) * 255)
/** Water-proximity falloff for the materials' bank darkening and damp foot. */
const WATER_EDGE_RANGE = 0.12
/** Habitat reaches the Project's suitable level where a creature could make its home here. */
const HABITAT_SCALE = SUITABLE / HOME_MIN

function waterDistance(w: World) {
  const distance = new Float32Array(CELLS).fill(Infinity)
  for (let c = 0; c < CELLS; c++) {
    if (w.water[c]) {
      distance[c] = 0
    }
  }
  const relax = (c: number) => {
    const i = c % GRID
    const j = Math.floor(c / GRID)
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ni = i + di
        const nj = j + dj
        if ((di || dj) && ni >= 0 && nj >= 0 && ni < GRID && nj < GRID) {
          distance[c] = Math.min(distance[c]!, distance[nj * GRID + ni]! + Math.hypot(di, dj) * CELL)
        }
      }
    }
  }
  for (let c = 0; c < CELLS; c++) {
    relax(c)
  }
  for (let c = CELLS - 1; c >= 0; c--) {
    relax(c)
  }
  return distance
}

/** Points the Project's terrain and architecture materials at a history's fields. */
export function setWorldFields(
  terrain: SurfaceMaterial,
  architecture: SurfaceMaterial,
  field: Texture,
  habitat: Texture,
  clock: number,
) {
  terrain.uniforms.uWorldField!.value = field
  terrain.uniforms.uHabitatField!.value = habitat
  architecture.uniforms.uWorldField!.value = field
  setArchitectureClock(architecture, clock)
}

/** An empty field, until a world's own is set. */
export const blankField = () => gridTexture(new Uint8Array(CELLS * 4))

/** R moisture, G vegetation cover, B path wear, A water proximity: the Project's world field. */
export function worldField(w: World): DataTexture {
  const distance = waterDistance(w)
  const data = new Uint8Array(CELLS * 4)
  for (let c = 0; c < CELLS; c++) {
    if (!SITE.land[c]) {
      continue
    }
    data[c * 4] = byte(w.moisture[c]!)
    data[c * 4 + 1] = byte(0.8 * (w.vegShelter[c]! + w.vegExposure[c]!))
    data[c * 4 + 2] = byte(1.2 * w.wear[c]!)
    data[c * 4 + 3] = byte(Math.exp(-distance[c]! / WATER_EDGE_RANGE))
  }
  return gridTexture(data)
}

/** R habitat now, G habitat in the history before it: the Project stains gains fresh and keeps a ghost of losses. */
export function habitatField(w: World, before: World | null): DataTexture {
  const data = new Uint8Array(CELLS * 4)
  for (let c = 0; c < CELLS; c++) {
    data[c * 4] = byte(w.habitat[c]! * HABITAT_SCALE)
    data[c * 4 + 1] = byte((before ?? w).habitat[c]! * HABITAT_SCALE)
  }
  return gridTexture(data)
}

/* ─── Traces: the ground recoloured by what happened to it ───────────── */

const T = {
  ground: new Color(HISTORY_COLORS.tracesGround),
  cliff: new Color(HISTORY_COLORS.cliff).multiplyScalar(0.6),
  formerShelter: new Color(HISTORY_COLORS.formerShelter),
  dead: new Color(HISTORY_COLORS.deadVegetation),
  reclaimed: new Color(HISTORY_COLORS.reclaimedPath),
  path: new Color(HISTORY_COLORS.path),
}

/** A copy of the block toned by what this history's ground has lost. */
export function tracesBlock(block: BufferGeometry, w: World): BufferGeometry {
  const geometry = block.clone()
  geometry.setAttribute('color', new BufferAttribute(tracesColors(block, w), 3))
  return geometry
}

/**
 * Per-vertex colour of the block in TRACES: dimmed ground, pale where
 * shelter was lost, dead vegetation stained in, overgrown former paths
 * olive.
 */
function tracesColors(block: BufferGeometry, w: World): Float32Array {
  const position = block.getAttribute('position')
  const below = block.getAttribute('aBelow')
  const out = new Float32Array(position.count * 3)
  const lost = new Float32Array(CELLS)
  const reclaimed = new Float32Array(CELLS)
  for (let c = 0; c < CELLS; c++) {
    lost[c] = clamp01((w.shelterPeak[c]! - w.shelter[c]!) / 0.5)
    reclaimed[c] = reclaimedPath(w, c) ? 1 : 0
  }
  const tone = new Color()
  for (let v = 0; v < position.count; v++) {
    if (below.getX(v) > 1e-3) {
      tone.copy(T.cliff)
    } else {
      const x = position.getX(v)
      const z = position.getZ(v)
      tone.copy(T.ground).multiplyScalar(0.8 + 0.5 * clamp01((position.getY(v) - WATER_LEVEL) / 1.0))
      tone.lerp(T.formerShelter, 0.75 * smooth(0.15, 1, sampleCells(lost, x, z)))
      tone.lerp(T.dead, 0.45 * clamp01(sampleCells(w.deadVegetation, x, z) * 0.8))
      tone.lerp(T.reclaimed, 0.55 * smooth(0.2, 0.7, sampleCells(reclaimed, x, z)))
    }
    out[v * 3] = tone.r
    out[v * 3 + 1] = tone.g
    out[v * 3 + 2] = tone.b
  }
  return out
}

/* ─── Routes and paths ────────────────────────────────────────────────── */

const ROUTE_SMOOTHING = 3
const ROUTE_SPACING = 0.03
const PATH_HALF_WIDTH = 0.034
const PATH_LIFT = 0.008

export type RouteLine = { x: Float32Array; y: Float32Array; z: Float32Array; along: Float32Array; length: number }

/** A creature's route as a smooth line over the ground: the cell path corner-cut, as the Project's paths are, and resampled. */
export function routeLine(route: readonly number[]): RouteLine {
  const smoothed = smoothTrace(
    route.map((c) => ({ x: cellX(c), z: cellZ(c), value: 0 })),
    ROUTE_SMOOTHING,
  )
  const xs: number[] = [smoothed[0]!.x]
  const zs: number[] = [smoothed[0]!.z]
  for (let k = 1; k < smoothed.length; k++) {
    const a = smoothed[k - 1]!
    const b = smoothed[k]!
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / ROUTE_SPACING))
    for (let s = 1; s <= steps; s++) {
      xs.push(a.x + ((b.x - a.x) * s) / steps)
      zs.push(a.z + ((b.z - a.z) * s) / steps)
    }
  }
  const count = xs.length
  const line: RouteLine = {
    x: new Float32Array(xs),
    y: new Float32Array(count),
    z: new Float32Array(zs),
    along: new Float32Array(count),
    length: 0,
  }
  for (let k = 0; k < count; k++) {
    line.y[k] = Math.max(WATER_LEVEL, surfaceHeight(xs[k]!, zs[k]!))
    if (k > 0) {
      line.along[k] = line.along[k - 1]! + Math.hypot(xs[k]! - xs[k - 1]!, zs[k]! - zs[k - 1]!)
    }
  }
  line.length = line.along[count - 1]!
  return line
}

/** Point and heading at distance `s` along a route. */
export function pointOnRoute(line: RouteLine, s: number, out: { x: number; y: number; z: number; dx: number; dz: number }) {
  const count = line.along.length
  const target = Math.min(line.length, Math.max(0, s))
  let lo = 0
  let hi = count - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (line.along[mid]! <= target) {
      lo = mid
    } else {
      hi = mid
    }
  }
  const span = line.along[hi]! - line.along[lo]!
  const t = span > 0 ? (target - line.along[lo]!) / span : 0
  out.x = line.x[lo]! + (line.x[hi]! - line.x[lo]!) * t
  out.y = line.y[lo]! + (line.y[hi]! - line.y[lo]!) * t
  out.z = line.z[lo]! + (line.z[hi]! - line.z[lo]!) * t
  const a = Math.max(0, lo - 2)
  const b = Math.min(count - 1, hi + 2)
  out.dx = line.x[b]! - line.x[a]!
  out.dz = line.z[b]! - line.z[a]!
  return out
}

/** Current routes as bands of worn ground, for the Project's path material; shared trunks overlap and read darker. */
export function routeBands(lines: readonly RouteLine[]): BufferGeometry {
  const builder = new MeshBuilder(['aFlow', 'aAcross'])
  for (const line of lines) {
    const points: RibbonPoint[] = []
    for (let k = 0; k < line.x.length; k++) {
      points.push({
        x: line.x[k]!,
        y: line.y[k]! + PATH_LIFT,
        z: line.z[k]!,
        halfWidth: PATH_HALF_WIDTH,
        values: { aFlow: line.along[k]! },
      })
    }
    builder.ribbon(points)
  }
  return builder.build()
}

const GRAPH = { divisions: 5, lift: 0.012, minHalfWidth: 0.007, maxHalfWidth: 0.022, corridor: 1.6 } as const

/**
 * Every route segment ever walked, as a strip draped on the ground: wider
 * where heavier, brighter where more recent, migrations brightest. Routes
 * still trodden bare are drawn widest; routes vegetation has grown back
 * over are drawn in its colour.
 */
export function routeGraph(w: World): BufferGeometry {
  const position: number[] = []
  const color: number[] = []
  const index: number[] = []
  const surface = (x: number, z: number) =>
    Math.max(isWaterAt(x, z) || w.water[cellOf(x, z)] ? w.waterLevel : -Infinity, surfaceHeight(x, z)) + GRAPH.lift
  const tint = new Color()
  w.segments.forEach((s) => {
    const recency = clamp01(1 - (w.step - s.last) / 30)
    const weight = clamp01(s.weight / 1.2)
    const trodden = Math.min(w.wear[s.a]!, w.wear[s.b]!) >= 0.6
    const overgrown = reclaimedPath(w, s.a) || reclaimedPath(w, s.b)
    let tone = (0.2 + 0.55 * weight) * (0.55 + 0.45 * recency)
    tone = s.migration || trodden ? Math.max(tone, 0.9) : tone
    if (overgrown && !s.migration) {
      tint.copy(T.reclaimed).multiplyScalar(0.6 + 0.6 * weight)
    } else {
      tint.copy(T.path).multiplyScalar(tone)
    }
    const half = (GRAPH.minHalfWidth + (GRAPH.maxHalfWidth - GRAPH.minHalfWidth) * weight) * (trodden ? GRAPH.corridor : 1)
    const ax = cellX(s.a)
    const az = cellZ(s.a)
    const dx = cellX(s.b) - ax
    const dz = cellZ(s.b) - az
    const length = Math.hypot(dx, dz) || 1
    const sx = (-dz / length) * half
    const sz = (dx / length) * half
    const base = position.length / 3
    for (let k = 0; k <= GRAPH.divisions; k++) {
      const t = k / GRAPH.divisions
      const x = ax + dx * t
      const z = az + dz * t
      const y = surface(x, z)
      position.push(x - sx, y, z - sz, x + sx, y, z + sz)
      color.push(tint.r, tint.g, tint.b, tint.r, tint.g, tint.b)
      if (k > 0) {
        const v = base + (k - 1) * 2
        index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2)
      }
    }
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(color, 3))
  geometry.setIndex(index)
  return geometry
}

/** The structure that once stood and no longer does, as module outlines. */
export function formerStructure(w: World): BufferGeometry {
  const position: number[] = []
  const sx = CELL * 0.48
  const sy = LEVEL * 0.48
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ] as const
  for (let v = 0; v < w.built.length; v++) {
    if (!w.built[v] || w.voxels[v]) {
      continue
    }
    const c = Math.floor(v / LEVELS)
    const x = cellX(c)
    const y = SITE.base + ((v % LEVELS) + 0.5) * LEVEL
    const z = cellZ(c)
    const corners = [-1, 1].flatMap((a) => [-1, 1].flatMap((b) => [-1, 1].map((d) => [x + a * sx, y + b * sy, z + d * sx])))
    for (const [a, b] of edges) {
      position.push(...corners[a]!, ...corners[b]!)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3))
  return geometry
}

/* ─── Placed things ───────────────────────────────────────────────────── */

export type Placement = { p: [number, number, number]; s: [number, number, number]; yaw?: number; tilt?: number }

/** `count` deterministic spots inside a cell, clear of water. */
function spots(c: number, count: number, salt: number): [number, number, number][] {
  const out: [number, number, number][] = []
  for (let k = 0; k < count; k++) {
    const x = cellX(c) + (hash(c * 17 + k * 13 + salt) - 0.5) * CELL * 0.9
    const z = cellZ(c) + (hash(c * 23 + k * 5 + salt) - 0.5) * CELL * 0.9
    if (!isWaterAt(x, z)) {
      out.push([x, z, hash(c * 31 + k * 7 + salt)])
    }
  }
  return out
}

export function rubblePlacements(w: World): Placement[] {
  const out: Placement[] = []
  for (let c = 0; c < CELLS; c++) {
    const r = w.rubble[c]!
    if (r < 0.15 || archAtGround(w, c)) {
      continue
    }
    for (const [x, z, h] of spots(c, Math.min(6, Math.ceil(r * 3.5)), 1)) {
      const size = 0.03 + 0.04 * h
      const y = Math.max(w.waterLevel - size * 0.3, surfaceHeight(x, z))
      out.push({ p: [x, y + size * 0.3, z], s: [size, size * 0.7, size * 1.2], yaw: h * 6.3, tilt: (h - 0.5) * 0.8 })
    }
  }
  return out
}

export function deadPlacements(w: World): Placement[] {
  const out: Placement[] = []
  for (let c = 0; c < CELLS; c++) {
    const d = w.deadVegetation[c]!
    if (d < 0.2 || !SITE.land[c] || w.water[c]) {
      continue
    }
    for (const [x, z, h] of spots(c, Math.min(3, Math.ceil(d * 2)), 4)) {
      out.push({ p: [x, surfaceHeight(x, z) + 0.006, z], s: [0.07 * (0.7 + 0.5 * h), 0.008, 0.008], yaw: h * 6.3 })
    }
  }
  return out
}
