import { useEffect, useMemo, useRef, useState } from 'react'
import type { BufferGeometry } from 'three'
import {
  architecturePlan,
  architectureSolid,
  LATTICE_ORIGIN,
  VOXEL_SIZE,
  type Architecture,
  type PlanColumn,
} from './architecture.ts'
import { cellCenter, cellIndex, CELL, GRID_EXTENT, GRID_SIZE, sampleGrid } from './grid.ts'
import { SUITABLE } from './habitat.ts'
import { sunVisible } from './light.ts'
import { PROJECT_COLORS } from './materials.ts'
import type { Ecology } from './simulation.ts'
import { SUNRISE_HOUR, SUNSET_HOUR, sunAt } from './sun.ts'
import { ISLAND_RADIUS, outlineRadius } from './terrain.ts'
import type { BaseWorld } from './world.ts'

/**
 * Shadow Ecology — the plan. The same live world drawn as a field plate,
 * north (+Z) up, in three orders:
 *
 *   figure   architecture as poché (brighter where taller, stepped massing
 *            lines, overhangs dashed), water in cobalt with a crisp shoreline
 *            and depth lines, the island rim
 *   notation habitat as field notation (hatched where suitable inside its
 *            edge, stippled where colonies are only emerging, over a faint
 *            lichen tint), vegetation as canopy circles, paths as a worn
 *            route line (spurs dashed)
 *   ground   a near-black island with a restrained contour hierarchy, the
 *            shade the sun casts now as a soft wash
 *
 * The sun sits on a chart ring around the island: the ring is the horizon,
 * the centre the zenith. Line weights grow a little with the drawing's size.
 */

const PLAN = {
  /** World radius the sheet fits, around the island and its sun ring. */
  fit: ISLAND_RADIUS * 1.32,
  ringRadius: ISLAND_RADIUS * 1.16,
  contourInterval: 0.1,
  indexEvery: 5,
  /** Shade is traced on every `stride`-th cell and drawn as a smoothed wash; every cell once cells span `fineCell` pixels. */
  stride: 2,
  fineCell: 3,
  groundOffset: 0.02,
  normalStep: 0.05,
  shadeOpacity: 0.55,
  nightOpacity: 0.3,
  /** Lake depth lines, every this much below the lake level. */
  depthInterval: 0.05,
  /** Habitat range over which the lichen tint fades in, and its opacity in World and Field only. */
  tintFrom: 0.12,
  tintTo: 0.5,
  tintOpacity: 0.3,
  fieldTintOpacity: 0.55,
  /** Habitat range over which the tint goes from greyed sage to full moss green. */
  deepFrom: 0.35,
  deepTo: 0.8,
  /** Emerging colonies: stipple below SUITABLE, from this habitat up, at most this share of cells. */
  stippleFloor: 0.18,
  stippleDensity: 0.4,
  stippleOpacity: 0.75,
  /** Target stipple pitch in pixels; the cell stride follows the drawing's scale. */
  stipplePitch: 3.2,
  /** Suitable ground: hatch pitch in world units, clamped in pixels. */
  hatchSpacing: 0.09,
  hatchMin: 3,
  hatchMax: 7,
  hatchOpacity: 0.7,
  /** Architecture: a massing line where neighbouring columns differ by more than this. */
  stepHeight: VOXEL_SIZE * 1.5,
} as const

/** Shortest interval between redraws while the world changes continuously. */
const REDRAW_MS = 120

const INK = '#e9e6df'
const ink = (alpha: number) => `rgba(233, 230, 223, ${alpha})`
/** Island ground greys, lowest to highest: kept near black so every mark reads on it. */
const GROUND_LOW = 18
const GROUND_HIGH = 32
const CONTOUR = ink(0.11)
const CONTOUR_INDEX = ink(0.26)
const RIM = ink(0.75)
const RING = ink(0.2)
/** Paths as worn ground: a faint band, then the route line (world width, opacity). */
const PATH_BAND = { width: 0.08, opacity: 0.1 } as const
const PATH_LINE = { primary: 0.8, spur: 0.55 } as const

type Size = { width: number; height: number }

type Segment = { level: number; points: [number, number, number, number] }

/** A closed polygon in world x, z pairs. */
type Polygon = number[]

type Props = {
  base: BaseWorld
  architecture: Architecture
  /** Changes whenever the architecture grows. */
  geometry: BufferGeometry
  ecology: Ecology
  hour: number
  noonElevation: number
  layers: { water: boolean; paths: boolean; vegetation: boolean; habitat: boolean }
  /** Field only: as in the 3D view, paths and vegetation clear and habitat strengthens. */
  fieldOnly: boolean
}

const hexToRgb = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)) as [number, number, number]

const ramp = (value: number, from: number, to: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/** A stable pseudo-random value in [0, 1) per grid cell. */
function cellHash(i: number, j: number, salt: number): number {
  const s = Math.sin(i * 127.1 + j * 311.7 + salt * 74.7) * 43758.5453
  return s - Math.floor(s)
}

/** A grid-sized canvas painted one pixel per cell, north up. */
function gridCanvas(size: number, paint: (i: number, j: number) => readonly number[] | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')!
  const image = context.createImageData(size, size)
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const rgba = paint(i, j)
      if (rgba) {
        image.data.set(rgba, (i + (size - 1 - j) * size) * 4)
      }
    }
  }
  context.putImageData(image, 0, 0)
  return canvas
}

/** Island ground, a narrow grey ramp by height. */
function paintGround(base: BaseWorld): HTMLCanvasElement {
  const { heights } = base.ground
  const { inside } = base.hydrology
  let low = Infinity
  let high = -Infinity
  for (let index = 0; index < heights.length; index += 1) {
    if (inside[index]) {
      low = Math.min(low, heights[index]!)
      high = Math.max(high, heights[index]!)
    }
  }
  return gridCanvas(GRID_SIZE, (i, j) => {
    const index = cellIndex(i, j)
    if (!inside[index]) {
      return null
    }
    const t = (heights[index]! - low) / Math.max(1e-6, high - low)
    const grey = Math.round(GROUND_LOW + (GROUND_HIGH - GROUND_LOW) * t)
    return [grey, grey, grey, 255]
  })
}

/** Habitat as a faint lichen tint, patchy rather than smooth; opacity is applied when drawn. */
function paintHabitat(base: BaseWorld, habitat: Float32Array): HTMLCanvasElement {
  const { inside, lakeId, river } = base.hydrology
  const thin = hexToRgb(PROJECT_COLORS.habitatThin)
  const dense = hexToRgb(PROJECT_COLORS.habitat)
  return gridCanvas(GRID_SIZE, (i, j) => {
    const index = cellIndex(i, j)
    if (!inside[index] || lakeId[index]! >= 0 || river[index] === 1) {
      return null
    }
    const value = habitat[index]!
    const blot = (cellHash(i >> 2, j >> 2, 7) - 0.5) * 0.12
    const strength = ramp(value + blot, PLAN.tintFrom, PLAN.tintTo)
    const depth = ramp(value, PLAN.deepFrom, PLAN.deepTo)
    const rgb = thin.map((c, k) => Math.round(c + (dense[k]! - c) * depth))
    return [...rgb, Math.round(255 * strength)]
  })
}

/**
 * A 3 × 3 box average on the island: drawing generalisation, so iso lines
 * run smooth and single-cell specks do not each get an outline.
 */
function smoothed(base: BaseWorld, value: (index: number) => number): Float32Array {
  const { inside } = base.hydrology
  const out = new Float32Array(GRID_SIZE * GRID_SIZE)
  for (let j = 0; j < GRID_SIZE; j += 1) {
    for (let i = 0; i < GRID_SIZE; i += 1) {
      const index = cellIndex(i, j)
      if (!inside[index]) {
        continue
      }
      let sum = 0
      for (let dj = -1; dj <= 1; dj += 1) {
        for (let di = -1; di <= 1; di += 1) {
          const ni = Math.min(GRID_SIZE - 1, Math.max(0, i + di))
          const nj = Math.min(GRID_SIZE - 1, Math.max(0, j + dj))
          sum += value(cellIndex(ni, nj))
        }
      }
      out[index] = sum / 9
    }
  }
  return out
}

/** Depth below the lake level on lake cells; slightly negative elsewhere, so no line runs on land. */
function lakeDepth(base: BaseWorld): Float32Array {
  const { heights } = base.ground
  const { lakeId, lakes } = base.hydrology
  const depth = new Float32Array(GRID_SIZE * GRID_SIZE).fill(-0.01)
  for (let index = 0; index < depth.length; index += 1) {
    const lake = lakeId[index]!
    if (lake >= 0) {
      depth[index] = lakes[lake]!.level - heights[index]!
    }
  }
  return depth
}

/** The four corners of grid cell (i, j), in marching-squares order, or null off the island. */
function cellCorners(base: BaseWorld, i: number, j: number): number[] | null {
  const corners = [cellIndex(i, j), cellIndex(i + 1, j), cellIndex(i + 1, j + 1), cellIndex(i, j + 1)]
  return corners.some((c) => !base.hydrology.inside[c]) ? null : corners
}

const crossing = (corners: number[], values: ArrayLike<number>, k: number, level: number): [number, number] => {
  const a = corners[k]!
  const b = corners[(k + 1) % 4]!
  const t = (level - values[a]!) / (values[b]! - values[a]!)
  const [ax, az] = cellCenter(a)
  const [bx, bz] = cellCenter(b)
  return [ax + (bx - ax) * t, az + (bz - az) * t]
}

/**
 * Iso-line segments of `values` by marching squares, over cells whose four
 * corners are all on the island. `levelsBetween` lists the levels crossing a
 * cell's value range.
 */
function isoSegments(
  base: BaseWorld,
  values: ArrayLike<number>,
  levelsBetween: (low: number, high: number) => number[],
): Segment[] {
  const segments: Segment[] = []
  for (let j = 0; j < GRID_SIZE - 1; j += 1) {
    for (let i = 0; i < GRID_SIZE - 1; i += 1) {
      const corners = cellCorners(base, i, j)
      if (!corners) {
        continue
      }
      const h = corners.map((c) => values[c]!)
      for (const level of levelsBetween(Math.min(...h), Math.max(...h))) {
        const crossings: [number, number][] = []
        for (let k = 0; k < 4; k += 1) {
          if ((h[k]! < level) !== (h[(k + 1) % 4]! < level)) {
            crossings.push(crossing(corners, values, k, level))
          }
        }
        for (let k = 0; k + 1 < crossings.length; k += 2) {
          segments.push({
            level,
            points: [crossings[k]![0], crossings[k]![1], crossings[k + 1]![0], crossings[k + 1]![1]],
          })
        }
      }
    }
  }
  return segments
}

/**
 * The region where `values` ≥ `level`, as one polygon per grid cell (the
 * marching-squares inside part). Filled or clipped in a single path, the
 * pieces join without seams.
 */
function isoPolygons(base: BaseWorld, values: ArrayLike<number>, level: number): Polygon[] {
  const polygons: Polygon[] = []
  for (let j = 0; j < GRID_SIZE - 1; j += 1) {
    for (let i = 0; i < GRID_SIZE - 1; i += 1) {
      const corners = cellCorners(base, i, j)
      if (!corners) {
        continue
      }
      const above = corners.map((c) => values[c]! >= level)
      if (!above.some(Boolean)) {
        continue
      }
      const polygon: Polygon = []
      for (let k = 0; k < 4; k += 1) {
        if (above[k]) {
          polygon.push(...cellCenter(corners[k]!))
        }
        if (above[k] !== above[(k + 1) % 4]) {
          polygon.push(...crossing(corners, values, k, level))
        }
      }
      polygons.push(polygon)
    }
  }
  return polygons
}

const heightLevels = (low: number, high: number) => {
  const levels: number[] = []
  for (let level = Math.ceil(low / PLAN.contourInterval); level <= Math.floor(high / PLAN.contourInterval); level += 1) {
    levels.push(level * PLAN.contourInterval)
  }
  return levels
}

const depthLevels = (low: number, high: number) => {
  const levels: number[] = []
  for (let k = Math.max(1, Math.ceil(low / PLAN.depthInterval)); k * PLAN.depthInterval <= high; k += 1) {
    levels.push(k * PLAN.depthInterval)
  }
  return levels
}

const shoreLevel = (low: number, high: number) => (low < 0.5 && 0.5 <= high ? [0.5] : [])
const suitableLevel = (low: number, high: number) => (low < SUITABLE && SUITABLE <= high ? [SUITABLE] : [])

/** Ground in the sun's shadow now, one pixel per `stride` cells (opaque where shaded). */
function traceShade(
  base: BaseWorld,
  architecture: Architecture,
  sun: ReturnType<typeof sunAt>,
  stride: number,
): HTMLCanvasElement | null {
  if (sun.daylight === 0) {
    return null
  }
  const { ground } = base
  const { inside } = base.hydrology
  const solid = architectureSolid(architecture)
  const h = (x: number, z: number) => sampleGrid(ground.heights, x, z)
  return gridCanvas(Math.ceil(GRID_SIZE / stride), (si, sj) => {
    const index = cellIndex(si * stride, sj * stride)
    if (!inside[index]) {
      return null
    }
    const [x, z] = cellCenter(index)
    const y = h(x, z) + PLAN.groundOffset
    if (solid.isSolid(x, y + PLAN.groundOffset, z)) {
      return null
    }
    const gx = (h(x + PLAN.normalStep, z) - h(x - PLAN.normalStep, z)) / (2 * PLAN.normalStep)
    const gz = (h(x, z + PLAN.normalStep) - h(x, z - PLAN.normalStep)) / (2 * PLAN.normalStep)
    const facing = -gx * sun.direction[0] + sun.direction[1] - gz * sun.direction[2]
    return facing <= 0 || !sunVisible(x, y, z, sun.direction, ground, solid) ? [0, 0, 0, 255] : null
  })
}

const latticeKey = (x: number, z: number) =>
  `${Math.floor((x - LATTICE_ORIGIN) / VOXEL_SIZE)},${Math.floor((z - LATTICE_ORIGIN) / VOXEL_SIZE)}`

/** The four footprint edges of a column: neighbour offset in world units, and the edge's end points. */
const EDGES = [
  [1, 0, [0.5, -0.5, 0.5, 0.5]],
  [-1, 0, [-0.5, -0.5, -0.5, 0.5]],
  [0, 1, [-0.5, 0.5, 0.5, 0.5]],
  [0, -1, [-0.5, -0.5, 0.5, -0.5]],
] as const

/** World → sheet mapping for a drawing of `size`. */
type Frame = {
  size: Size
  scale: number
  /** Line weights: 1 on the inset plate, up to 1.5 on a large one. */
  weight: number
  cx: number
  cy: number
  sx: (x: number) => number
  sy: (z: number) => number
}

function planFrame(size: Size): Frame {
  const scale = Math.min(size.width, size.height) / (2 * PLAN.fit)
  const cx = size.width / 2
  const cy = size.height / 2
  return {
    size,
    scale,
    weight: Math.min(1.5, Math.max(1, scale / 60)),
    cx,
    cy,
    sx: (x) => cx + x * scale,
    sy: (z) => cy - z * scale,
  }
}

/** A sheet-sized offscreen layer at the screen's pixel ratio, drawn in sheet units. */
function paintLayer(size: Size, paint: (context: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const ratio = window.devicePixelRatio || 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(size.width * ratio))
  canvas.height = Math.max(1, Math.round(size.height * ratio))
  const context = canvas.getContext('2d')!
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  paint(context)
  return canvas
}

type Outline = readonly (readonly [number, number])[]

function traceOutline(context: CanvasRenderingContext2D, { sx, sy }: Frame, outline: Outline) {
  context.beginPath()
  outline.forEach(([x, z], k) => (k === 0 ? context.moveTo(sx(x), sy(z)) : context.lineTo(sx(x), sy(z))))
  context.closePath()
}

function strokeSegments(
  context: CanvasRenderingContext2D,
  { sx, sy }: Frame,
  segments: Segment[],
  keep: (segment: Segment) => boolean = () => true,
) {
  context.beginPath()
  for (const segment of segments) {
    if (keep(segment)) {
      const [ax, az, bx, bz] = segment.points
      context.moveTo(sx(ax), sy(az))
      context.lineTo(sx(bx), sy(bz))
    }
  }
  context.stroke()
}

function polygonPath({ sx, sy }: Frame, polygons: Polygon[]): Path2D {
  const path = new Path2D()
  for (const polygon of polygons) {
    path.moveTo(sx(polygon[0]!), sy(polygon[1]!))
    for (let k = 2; k < polygon.length; k += 2) {
      path.lineTo(sx(polygon[k]!), sy(polygon[k + 1]!))
    }
    path.closePath()
  }
  return path
}

function drawGrid(context: CanvasRenderingContext2D, { sx, sy, scale }: Frame, image: HTMLCanvasElement) {
  context.drawImage(image, sx(-GRID_EXTENT), sy(GRID_EXTENT), 2 * GRID_EXTENT * scale, 2 * GRID_EXTENT * scale)
}

type WaterNotation = { fill: Polygon[]; shore: Segment[]; depth: Segment[] }

/** Ground order, which changes only with the world or the Water layer: relief, contours, water. */
function drawGroundLayer(
  context: CanvasRenderingContext2D,
  frame: Frame,
  { base, ground, contours, water, showWater, outline }: {
    base: BaseWorld
    ground: HTMLCanvasElement
    contours: Segment[]
    water: WaterNotation
    showWater: boolean
    outline: Outline
  },
) {
  const { sx, sy, scale, weight } = frame
  traceOutline(context, frame, outline)
  context.clip()
  context.imageSmoothingEnabled = true
  drawGrid(context, frame, ground)
  const indexStep = PLAN.contourInterval * PLAN.indexEvery
  const isIndex = (segment: Segment) =>
    Math.abs(segment.level / indexStep - Math.round(segment.level / indexStep)) < 1e-3
  context.lineWidth = 0.6 * weight
  context.strokeStyle = CONTOUR
  strokeSegments(context, frame, contours, (segment) => !isIndex(segment))
  context.lineWidth = 0.9 * weight
  context.strokeStyle = CONTOUR_INDEX
  strokeSegments(context, frame, contours, isIndex)

  // Water: cobalt lakes with depth lines and a crisp shoreline, then rivers.
  if (!showWater) {
    return
  }
  context.fillStyle = PROJECT_COLORS.waterShallow
  context.fill(polygonPath(frame, water.fill))
  context.globalAlpha = 0.35
  context.strokeStyle = PROJECT_COLORS.waterLine
  context.lineWidth = 0.6 * weight
  strokeSegments(context, frame, water.depth)
  context.globalAlpha = 0.85
  context.lineWidth = 0.8 * weight
  strokeSegments(context, frame, water.shore)
  context.globalAlpha = 1
  context.strokeStyle = PROJECT_COLORS.waterShallow
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (const river of base.hydrology.rivers) {
    for (let k = 1; k < river.points.length; k += 1) {
      const a = river.points[k - 1]!
      const b = river.points[k]!
      context.lineWidth = Math.max(1.2 * weight, (a.halfWidth + b.halfWidth) * scale)
      context.beginPath()
      context.moveTo(sx(a.x), sy(a.z))
      context.lineTo(sx(b.x), sy(b.z))
      context.stroke()
    }
  }
}

type HabitatNotation = { tint: HTMLCanvasElement; suitable: Polygon[]; edge: Segment[] }

/** Notation order, which changes at sunset or with the layers and view: habitat, vegetation, paths. */
function drawEcologyLayer(
  context: CanvasRenderingContext2D,
  frame: Frame,
  { base, ecology, habitatField, showHabitat, showVegetation, showPaths, fieldOnly, outline }: {
    base: BaseWorld
    ecology: Ecology
    habitatField: HabitatNotation
    showHabitat: boolean
    showVegetation: boolean
    showPaths: boolean
    fieldOnly: boolean
    outline: Outline
  },
) {
  const { size, sx, sy, scale, weight } = frame
  traceOutline(context, frame, outline)
  context.clip()
  context.imageSmoothingEnabled = true

  // Habitat as field notation: tint, emerging stipple, suitable hatching inside its edge.
  if (showHabitat) {
    const { habitat } = ecology
    const { inside, lakeId, river } = base.hydrology
    context.globalAlpha = fieldOnly ? PLAN.fieldTintOpacity : PLAN.tintOpacity
    drawGrid(context, frame, habitatField.tint)

    context.globalAlpha = PLAN.stippleOpacity
    context.fillStyle = PROJECT_COLORS.habitat
    const stride = Math.max(1, Math.round(PLAN.stipplePitch / (CELL * scale)))
    const dot = 0.6 * weight
    context.beginPath()
    for (let j = 0; j < GRID_SIZE; j += stride) {
      for (let i = 0; i < GRID_SIZE; i += stride) {
        const index = cellIndex(i, j)
        const value = habitat[index]!
        if (!inside[index] || lakeId[index]! >= 0 || river[index] === 1) {
          continue
        }
        if (value < PLAN.stippleFloor || value >= SUITABLE) {
          continue
        }
        if (cellHash(i, j, 1) > PLAN.stippleDensity * ramp(value, PLAN.stippleFloor, SUITABLE)) {
          continue
        }
        const [x, z] = cellCenter(index)
        const jitter = CELL * stride * 0.4
        const px = sx(x + (cellHash(i, j, 4) - 0.5) * jitter)
        const py = sy(z + (cellHash(i, j, 5) - 0.5) * jitter)
        context.moveTo(px + dot, py)
        context.arc(px, py, dot, 0, 2 * Math.PI)
      }
    }
    context.fill()

    const pitch = Math.min(PLAN.hatchMax, Math.max(PLAN.hatchMin, PLAN.hatchSpacing * scale))
    context.save()
    context.clip(polygonPath(frame, habitatField.suitable))
    context.strokeStyle = PROJECT_COLORS.habitat
    context.globalAlpha = PLAN.hatchOpacity
    context.lineWidth = 0.75 * weight
    context.beginPath()
    for (let d = -size.height; d < size.width; d += pitch) {
      context.moveTo(d, size.height)
      context.lineTo(d + size.height, 0)
    }
    context.stroke()
    context.restore()

    context.globalAlpha = 0.95
    context.strokeStyle = PROJECT_COLORS.habitat
    context.lineWidth = 1.1 * weight
    strokeSegments(context, frame, habitatField.edge)
    context.globalAlpha = 1
  }

  // Vegetation: canopy circles, sized by height, firmer where vigorous.
  if (showVegetation) {
    context.strokeStyle = PROJECT_COLORS.vegetationTip
    context.fillStyle = PROJECT_COLORS.vegetationTip
    context.lineWidth = 0.75 * weight
    for (const plant of ecology.plants) {
      const radius = Math.max(1.3, (0.022 + plant.height * 0.12) * scale)
      context.globalAlpha = 0.35 + 0.4 * plant.vigour
      context.beginPath()
      context.arc(sx(plant.x), sy(plant.z), radius, 0, 2 * Math.PI)
      context.stroke()
      if (radius > 2.5) {
        context.fillRect(sx(plant.x) - 0.5, sy(plant.z) - 0.5, 1, 1)
      }
    }
    context.globalAlpha = 1
  }

  // Paths: a faint worn band under a thin route line; spurs dashed.
  if (showPaths) {
    context.strokeStyle = PROJECT_COLORS.path
    context.lineCap = 'round'
    context.lineJoin = 'round'
    const tracePath = (points: { x: number; z: number }[]) => {
      context.beginPath()
      points.forEach(({ x, z }, k) => (k === 0 ? context.moveTo(sx(x), sy(z)) : context.lineTo(sx(x), sy(z))))
      context.stroke()
    }
    context.globalAlpha = PATH_BAND.opacity
    context.lineWidth = Math.max(2, PATH_BAND.width * scale)
    for (const line of ecology.pathLines) {
      if (line.primary) {
        tracePath(line.points)
      }
    }
    for (const line of ecology.pathLines) {
      context.globalAlpha = line.primary ? PATH_LINE.primary : PATH_LINE.spur
      context.lineWidth = (line.primary ? 1.1 : 0.8) * weight
      context.setLineDash(line.primary ? [] : [2.5 * weight, 2.5 * weight])
      tracePath(line.points)
    }
    context.setLineDash([])
    context.globalAlpha = 1
  }
}

export function PlanView({ base, architecture, geometry, ecology, hour, noonElevation, layers, fieldOnly }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) {
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect
      setSize({ width, height })
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  const groundImage = useMemo(() => paintGround(base), [base])
  const contours = useMemo(() => isoSegments(base, base.ground.heights, heightLevels), [base])
  const water = useMemo(() => {
    const { lakeId } = base.hydrology
    const mask = smoothed(base, (index) => (lakeId[index]! >= 0 ? 1 : 0))
    return {
      fill: isoPolygons(base, mask, 0.5),
      shore: isoSegments(base, mask, shoreLevel),
      depth: isoSegments(base, lakeDepth(base), depthLevels),
    }
  }, [base])
  const { habitat } = ecology
  const habitatField = useMemo(() => {
    const general = smoothed(base, (index) => habitat[index]!)
    return {
      tint: paintHabitat(base, habitat),
      suitable: isoPolygons(base, general, SUITABLE),
      edge: isoSegments(base, general, suitableLevel),
    }
  }, [base, habitat])
  const outline = useMemo(
    () =>
      Array.from({ length: 256 }, (_, k) => {
        const angle = (2 * Math.PI * k) / 256
        const r = outlineRadius(angle)
        return [r * Math.cos(angle), r * Math.sin(angle)] as const
      }),
    [],
  )

  const frame = useMemo(() => planFrame(size), [size])
  const showWater = layers.water
  const showHabitat = layers.habitat
  const showVegetation = layers.vegetation && !fieldOnly
  const showPaths = layers.paths && !fieldOnly
  // The slow-changing orders are painted once into offscreen layers; each redraw only composites them.
  const groundLayer = useMemo(
    () =>
      size.width > 0 && size.height > 0
        ? paintLayer(size, (context) =>
            drawGroundLayer(context, frame, { base, ground: groundImage, contours, water, showWater, outline }),
          )
        : null,
    [size, frame, base, groundImage, contours, water, showWater, outline],
  )
  const ecologyLayer = useMemo(
    () =>
      size.width > 0 && size.height > 0
        ? paintLayer(size, (context) =>
            drawEcologyLayer(context, frame, {
              base,
              ecology,
              habitatField,
              showHabitat,
              showVegetation,
              showPaths,
              fieldOnly,
              outline,
            }),
          )
        : null,
    [size, frame, base, ecology, habitatField, showHabitat, showVegetation, showPaths, fieldOnly, outline],
  )

  /**
   * When the sheet last drew. Playing changes the hour every frame; redrawing
   * at most every REDRAW_MS keeps the scene smooth, and the last change always
   * draws once it settles.
   */
  const lastDraw = useRef(0)

  // The architecture is mutated in place; `geometry` is replaced whenever it grows, so it triggers the redraw.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !groundLayer || !ecologyLayer) {
      return
    }
    const draw = () => {
      lastDraw.current = performance.now()
      const { size: sheet, scale, weight, cx, cy, sx, sy } = frame
      const sun = sunAt(hour, noonElevation)
      const plan = architecturePlan(architecture)
      const shade = traceShade(base, architecture, sun, CELL * scale >= PLAN.fineCell ? 1 : PLAN.stride)
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(sheet.width * ratio)
      canvas.height = Math.round(sheet.height * ratio)
      const context = canvas.getContext('2d')!
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, sheet.width, sheet.height)

      context.drawImage(groundLayer, 0, 0, sheet.width, sheet.height)
      context.save()
      traceOutline(context, frame, outline)
      context.clip()
      context.imageSmoothingEnabled = true

      // The shade cast now, a smoothed wash; the night dims the whole island.
      if (shade) {
        context.globalAlpha = PLAN.shadeOpacity
        drawGrid(context, frame, shade)
        context.globalAlpha = 1
      }
      if (sun.daylight < 1) {
        context.fillStyle = '#000000'
        context.globalAlpha = (1 - sun.daylight) * PLAN.nightOpacity
        context.fillRect(0, 0, sheet.width, sheet.height)
        context.globalAlpha = 1
      }
      context.drawImage(ecologyLayer, 0, 0, sheet.width, sheet.height)

      // Architecture as poché: filled footprints, stepped massing lines, outer edge; overhangs dashed.
      const cellSize = VOXEL_SIZE * scale
      const columns = new Map<string, PlanColumn>()
      for (const column of plan) {
        columns.set(latticeKey(column.x, column.z), column)
      }
      const neighbour = (column: PlanColumn, dx: number, dz: number) =>
        columns.get(latticeKey(column.x + dx * VOXEL_SIZE, column.z + dz * VOXEL_SIZE))
      const tone = (column: PlanColumn) =>
        Math.round(150 + 95 * Math.min(1, column.height / 1.5) - 40 * column.age)
      for (const column of plan) {
        const t = tone(column)
        context.fillStyle = column.grounded ? `rgb(${t}, ${t - 3}, ${t - 8})` : `rgba(${t}, ${t - 3}, ${t - 8}, 0.18)`
        context.fillRect(sx(column.x) - cellSize / 2, sy(column.z) - cellSize / 2, cellSize + 0.5, cellSize + 0.5)
      }
      const edgePath = (keep: (column: PlanColumn, other: PlanColumn | undefined) => boolean) => {
        context.beginPath()
        for (const column of plan) {
          for (const [dx, dz, [ax, az, bx, bz]] of EDGES) {
            if (keep(column, neighbour(column, dx, dz))) {
              context.moveTo(sx(column.x + ax * VOXEL_SIZE), sy(column.z + az * VOXEL_SIZE))
              context.lineTo(sx(column.x + bx * VOXEL_SIZE), sy(column.z + bz * VOXEL_SIZE))
            }
          }
        }
        context.stroke()
      }
      context.lineCap = 'butt'
      context.strokeStyle = 'rgba(0, 0, 0, 0.45)'
      context.lineWidth = 0.75 * weight
      edgePath(
        (column, other) =>
          column.grounded &&
          other !== undefined &&
          other.grounded &&
          column.height - other.height > PLAN.stepHeight,
      )
      context.strokeStyle = INK
      context.lineWidth = 1 * weight
      edgePath((column, other) => column.grounded && !other?.grounded)
      context.strokeStyle = ink(0.7)
      context.lineWidth = 0.75 * weight
      context.setLineDash([2 * weight, 2 * weight])
      edgePath((column, other) => !column.grounded && other === undefined)
      context.setLineDash([])
      context.restore()

      context.strokeStyle = RIM
      context.lineWidth = 1 * weight
      traceOutline(context, frame, outline)
      context.stroke()

      // Falls: a small cobalt tick past the rim where a river leaves the island.
      if (showWater) {
        context.strokeStyle = PROJECT_COLORS.waterShallow
        context.lineWidth = 1.5 * weight
        context.lineCap = 'round'
        for (const river of base.hydrology.rivers) {
          if (!river.outlet) {
            continue
          }
          const end = river.points[river.points.length - 1]!
          const angle = Math.atan2(end.z, end.x)
          const reach = Math.max(6, 0.14 * scale)
          context.beginPath()
          context.moveTo(sx(end.x), sy(end.z))
          context.lineTo(sx(end.x + Math.cos(angle) * (reach / scale)), sy(end.z + Math.sin(angle) * (reach / scale)))
          context.stroke()
        }
      }

      // Sun chart: horizon ring with ticks every 30°, compass letters, today's path, the sun now.
      const ring = PLAN.ringRadius * scale
      context.strokeStyle = RING
      context.lineWidth = 0.75 * weight
      context.beginPath()
      context.arc(cx, cy, ring, 0, 2 * Math.PI)
      for (let k = 0; k < 12; k += 1) {
        const a = (k * Math.PI) / 6
        const inner = ring - (k % 3 === 0 ? 5 : 3) * weight
        context.moveTo(cx + Math.sin(a) * inner, cy - Math.cos(a) * inner)
        context.lineTo(cx + Math.sin(a) * ring, cy - Math.cos(a) * ring)
      }
      context.stroke()
      context.fillStyle = ink(0.56)
      context.font = `${Math.round(10 * weight)}px ${getComputedStyle(canvas).getPropertyValue('--mono')}`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      for (const [label, x, z] of [
        ['N', 0, 1],
        ['E', 1, 0],
        ['S', 0, -1],
        ['W', -1, 0],
      ] as const) {
        context.fillText(label, sx(x * (PLAN.ringRadius + 0.16)), sy(z * (PLAN.ringRadius + 0.16)))
      }
      const chart = (azimuth: number, elevation: number) => {
        const r = ring * (1 - Math.max(0, elevation) / 90)
        const a = (azimuth * Math.PI) / 180
        return [cx + Math.sin(a) * r, cy - Math.cos(a) * r] as const
      }
      context.strokeStyle = ink(0.3)
      context.setLineDash([2 * weight, 3 * weight])
      context.beginPath()
      for (let k = 0; k <= 48; k += 1) {
        const state = sunAt(SUNRISE_HOUR + ((SUNSET_HOUR - SUNRISE_HOUR) * k) / 48, noonElevation)
        const [px, py] = chart(state.azimuth, state.elevation)
        if (k === 0) {
          context.moveTo(px, py)
        } else {
          context.lineTo(px, py)
        }
      }
      context.stroke()
      context.setLineDash([])
      const [px, py] = chart(sun.azimuth, sun.elevation)
      context.beginPath()
      context.arc(px, py, 4.5 * weight, 0, 2 * Math.PI)
      if (sun.daylight > 0) {
        context.fillStyle = INK
        context.fill()
        context.strokeStyle = '#000000'
        context.lineWidth = 1.5
        context.stroke()
      } else {
        context.strokeStyle = ink(0.4)
        context.lineWidth = 1
        context.stroke()
      }
    }
    const timer = window.setTimeout(draw, Math.max(0, lastDraw.current + REDRAW_MS - performance.now()))
    return () => window.clearTimeout(timer)
  }, [frame, groundLayer, ecologyLayer, outline, base, architecture, geometry, hour, noonElevation, showWater])

  return (
    <div ref={wrapRef} className="plan-view">
      <canvas ref={canvasRef} className="plan-canvas" aria-label="Plan of the world" />
    </div>
  )
}
