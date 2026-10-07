import { BufferAttribute, BufferGeometry, Color } from 'three'
import { simplex2 } from '../../shared/noise/simplex.ts'
import {
  channelHalfWidth,
  PATH_COLORS,
  reachFlow,
  revealLine,
  type FlowReach,
  type Point2,
  type TimedLine,
} from './paths.ts'
import { STUDY_CELL, STUDY_HALF, studySurfaceBend, studySurfaceHeight } from './studyTerrain.ts'

/**
 * Week 06 Paths — meshes laid along the generated centrelines: the Flow
 * channels (ribbons laid on the rendered ground across their width) and the
 * Growth veins (tapered tubes resting on it). Widths and radii depend only on
 * distance along the full line and on what has arrived by the step shown, so
 * a progressive run ends on the same mesh as Instant.
 */

type Height = (x: number, z: number) => number

/** A revealed line, with the full line's length (for tapers measured against the whole). */
export type MeshLine = { points: readonly Point2[]; length: number; depth: number; index: number }

const STREAM = {
  /** Slow width wobble, ± share, per world unit. */
  wobble: 0.12,
  wobbleFrequency: 2.4,
  /** The first stretch below a source narrows to `sourceWidth` of its width. */
  sourceTaper: 0.3,
  sourceWidth: 0.35,
  /** Fast water runs narrower, slack water wider. */
  fastNarrow: 0.22,
  /**
   * Above the ground: each reach rides `liftStep` over the reaches flowing
   * into it (less if the network is deeper than `liftRange` allows), so where
   * reaches overlap at a confluence the receiving water covers. Kept under
   * the marks' lift so the downhill field reads over the water.
   */
  lift: 0.004,
  liftRange: 0.003,
  liftStep: 0.0005,
  /** Where a reach bends back over itself, the later water lies this much over the earlier. */
  liftOver: 0.0006,
} as const
/**
 * Laying water on the ground. The ground is drawn as flat grid triangles, so
 * the ribbon's vertices sit at most `spacing` of a grid cell apart, along and
 * across, at the drawn height. Lifts are measured along the ground's normal
 * (up to `normalMax` times the vertical lift on steep ground). No point of a
 * water face may come closer to the ground than `clear` of its lift; faces
 * that would are raised just enough.
 */
const SURFACE = { spacing: 0.75, normalMax: 3, clear: 0.6 } as const
const SPACING = SURFACE.spacing * STUDY_CELL
/** On a tight bend the inner edge comes no closer to the bend's centre than this share of its radius, so the ribbon never folds. */
const FOLD = 0.85
/** A turn sharper than this (cosine of the angle between steps, about 100°) breaks the ribbon at a round joint. */
const CORNER = -0.17
/** Below a confluence a tributary's end dips under the receiving water within this share of its half-width, so the two never cross. */
const JOIN = { share: 0.9, sink: 0.003 } as const
/** A hollow ends in a pool this many times the channel's half-width, `above` over the stream so it covers the stream's end. */
const POOL = { scale: 1.5, max: 0.22, segments: 28, speed: 0.12, above: 0.0006 } as const
const CAP_SEGMENTS = 10
/**
 * The wet bank beside the water: a fixed width plus a share of the
 * half-width, raised into a low tent so overlapping banks do not darken
 * twice. Under the water it follows the water's surface, `under` below it.
 */
const BANK = { width: 0.026, share: 0.55, lift: 0.0018, tent: 0.0016, under: 0.0012, clear: 0.5 } as const
/** Foam just below a confluence, and on fast water. */
const FOAM = { length: 0.22, fastFrom: 0.6, rapids: 0.35 } as const

/** Current from the stream's fall per unit length, as the Project's rivers. */
const CURRENT = { base: 0.4, perGrade: 2.5, max: 1.8 } as const

const VEIN = {
  /** Radius at the root, by depth: main line, branch, sub-branch. */
  radius: [0.022, 0.0135, 0.009],
  /** Radius lost from root to tip, as a share. */
  taper: 0.72,
  /** Lengths over which the tip, and a still-growing tip, close to a point. */
  tip: 0.16,
  growingTip: 0.07,
  /** Main lines flare at the root to seat on the ground. */
  flare: 0.4,
  flareLength: 0.09,
  minRadius: 0.0006,
  /** Share of the radius sunk below the ground. */
  sink: 0.3,
  radial: 8,
  /** Rings every this many dense samples. */
  every: 2,
} as const

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function arcLengths(points: readonly Point2[]): number[] {
  const s = [0]
  for (let i = 1; i < points.length; i += 1) {
    s.push(s[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z))
  }
  return s
}

/** Unit plan direction at vertex i, from its neighbours. */
function planTangent(points: readonly Point2[], i: number): [number, number] {
  const a = points[Math.max(0, i - 1)]!
  const b = points[Math.min(points.length - 1, i + 1)]!
  const dx = b.x - a.x
  const dz = b.z - a.z
  const length = Math.hypot(dx, dz) || 1
  return [dx / length, dz / length]
}

function build(positions: number[], indices: number[], attributes: Record<string, { values: number[]; size: number }>) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  for (const [name, { values, size }] of Object.entries(attributes)) {
    geometry.setAttribute(name, new BufferAttribute(new Float32Array(values), size))
  }
  geometry.setIndex(indices)
  return geometry
}

/**
 * Vertices with, for laying on the ground, the clearance each must keep
 * (−Infinity: none, as for water sunk under other water) and whether it may
 * be raised to keep it.
 */
type Buffers = {
  positions: number[]
  indices: number[]
  names: readonly string[]
  /** One list per attribute, in the order of `names`. */
  attributes: number[][]
  floor: number[]
  movable: boolean[]
  /** The lift of the water each face belongs to, set while laying it: higher faces are drawn first. */
  layer: number
  layers: number[]
}

const buffers = (names: readonly string[]): Buffers => ({
  positions: [],
  indices: [],
  names,
  attributes: names.map(() => []),
  floor: [],
  movable: [],
  layer: 0,
  layers: [],
})

/** A vertex with its attribute values in the order of the buffers' `names`. */
function vertex(
  b: Buffers,
  x: number,
  y: number,
  z: number,
  values: readonly number[],
  floor = -Infinity,
  movable = false,
): number {
  b.positions.push(x, y, z)
  for (let k = 0; k < values.length; k += 1) {
    b.attributes[k]!.push(values[k]!)
  }
  b.floor.push(floor)
  b.movable.push(movable)
  return b.positions.length / 3 - 1
}

/** A triangle wound to face up, whichever way round its corners come. */
function face(b: Buffers, i0: number, i1: number, i2: number) {
  const p = b.positions
  const ux = p[i1 * 3]! - p[i0 * 3]!
  const uz = p[i1 * 3 + 2]! - p[i0 * 3 + 2]!
  const vx = p[i2 * 3]! - p[i0 * 3]!
  const vz = p[i2 * 3 + 2]! - p[i0 * 3 + 2]!
  if (uz * vx - ux * vz >= 0) {
    b.indices.push(i0, i1, i2)
  } else {
    b.indices.push(i0, i2, i1)
  }
  b.layers.push(b.layer)
}

/** Quads between two rows of vertices. */
function strip(b: Buffers, previous: readonly number[], current: readonly number[]) {
  for (let m = 0; m < current.length - 1; m += 1) {
    face(b, previous[m]!, previous[m + 1]!, current[m]!)
    face(b, previous[m + 1]!, current[m + 1]!, current[m]!)
  }
}

/**
 * Geometry with its faces from the highest layer down: drawn first, the
 * upper water hides what lies under it rather than blending over it twice.
 */
function geometryOf(b: Buffers) {
  const levels = [...new Set(b.layers)].sort((p, q) => q - p)
  const rank = new Map(levels.map((level, k) => [level, k]))
  const buckets: number[][] = levels.map(() => [])
  b.layers.forEach((level, f) => buckets[rank.get(level)!]!.push(f))
  const indices: number[] = new Array(b.indices.length)
  let k = 0
  for (const bucket of buckets) {
    for (const f of bucket) {
      indices[k++] = b.indices[f * 3]!
      indices[k++] = b.indices[f * 3 + 1]!
      indices[k++] = b.indices[f * 3 + 2]!
    }
  }
  return build(
    b.positions,
    indices,
    Object.fromEntries(b.names.map((name, k) => [name, { values: b.attributes[k]!, size: 1 }])),
  )
}

type Section = {
  p: Point2
  tangent: [number, number]
  halfWidth: number
  /** Half-widths to the left (+) and right (−) of the centreline: held in on the inside of a tight bend. */
  left: number
  right: number
  /** How far anything may reach to each side before it would fold: the bend's radius on its inside. */
  leftMax: number
  rightMax: number
  along: number
  speed: number
  foam: number
  /** Under the receiving channel's water, where a tributary ends. */
  sunk: boolean
  /** Extra lift where this water lies over an earlier stretch of the same reach. */
  over: number
  /** Which piece of the reach, between sharp turns, it belongs to. */
  piece: number
}

/** How far the ground's normal tilts from vertical at (x, z), as 1 / cos: a lift along the normal is this much taller. */
function normalFactor(x: number, z: number): number {
  const e = STUDY_CELL * 1.5
  const gx = (studySurfaceHeight(x + e, z) - studySurfaceHeight(x - e, z)) / (2 * e)
  const gz = (studySurfaceHeight(x, z + e) - studySurfaceHeight(x, z - e)) / (2 * e)
  return Math.min(SURFACE.normalMax, Math.hypot(1, gx, gz))
}

/**
 * The lowest a face comes above the drawn ground. Both are flat between their
 * own vertices, so that lies at a corner, where an edge crosses a grid line
 * or cell diagonal of the ground, or at a ground vertex inside the face.
 */
function lowestClearance(p: readonly number[], i0: number, i1: number, i2: number, corners: number): number {
  const ax = p[i0 * 3]!
  const ay = p[i0 * 3 + 1]!
  const az = p[i0 * 3 + 2]!
  const bx = p[i1 * 3]!
  const by = p[i1 * 3 + 1]!
  const bz = p[i1 * 3 + 2]!
  const cx = p[i2 * 3]!
  const cy = p[i2 * 3 + 1]!
  const cz = p[i2 * 3 + 2]!
  let low = corners
  // Along an edge, where it crosses lines `origin + k · cell` of the coordinate `from + t · delta`.
  const crossings = (x0: number, y0: number, z0: number, dx: number, dy: number, dz: number, from: number, delta: number, origin: number) => {
    if (Math.abs(delta) < 1e-12) {
      return
    }
    const k0 = Math.ceil((Math.min(from, from + delta) - origin) / STUDY_CELL)
    const k1 = Math.floor((Math.max(from, from + delta) - origin) / STUDY_CELL)
    for (let k = k0; k <= k1; k += 1) {
      const t = (origin + k * STUDY_CELL - from) / delta
      if (t > 0 && t < 1) {
        low = Math.min(low, y0 + dy * t - studySurfaceHeight(x0 + dx * t, z0 + dz * t))
      }
    }
  }
  const edge = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    const dx = x1 - x0
    const dy = y1 - y0
    const dz = z1 - z0
    crossings(x0, y0, z0, dx, dy, dz, x0, dx, -STUDY_HALF)
    crossings(x0, y0, z0, dx, dy, dz, z0, dz, -STUDY_HALF)
    // The cells' diagonals, x + z = const.
    crossings(x0, y0, z0, dx, dy, dz, x0 + z0, dx + dz, -2 * STUDY_HALF)
  }
  edge(ax, ay, az, bx, by, bz)
  edge(bx, by, bz, cx, cy, cz)
  edge(cx, cy, cz, ax, ay, az)

  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
  if (Math.abs(d) > 1e-12) {
    const i1x = Math.floor((Math.max(ax, bx, cx) + STUDY_HALF) / STUDY_CELL)
    const j0 = Math.ceil((Math.min(az, bz, cz) + STUDY_HALF) / STUDY_CELL)
    const j1 = Math.floor((Math.max(az, bz, cz) + STUDY_HALF) / STUDY_CELL)
    for (let i = Math.ceil((Math.min(ax, bx, cx) + STUDY_HALF) / STUDY_CELL); i <= i1x; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const x = -STUDY_HALF + i * STUDY_CELL
        const z = -STUDY_HALF + j * STUDY_CELL
        const l0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d
        const l1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d
        const l2 = 1 - l0 - l1
        if (l0 >= 0 && l1 >= 0 && l2 >= 0) {
          low = Math.min(low, l0 * ay + l1 * by + l2 * cy - studySurfaceHeight(x, z))
        }
      }
    }
  }
  return low
}

/**
 * Whether a face whose corners keep `corners` above the ground surely keeps
 * `need` without testing it closely: between its corners the ground rises
 * above the plane through their ground heights by at most half its slope's
 * spread times the face's longest edge.
 */
function clearOfBend(p: readonly number[], i0: number, i1: number, i2: number, corners: number, need: number): boolean {
  const ax = p[i0 * 3]!
  const az = p[i0 * 3 + 2]!
  const bx = p[i1 * 3]!
  const bz = p[i1 * 3 + 2]!
  const cx = p[i2 * 3]!
  const cz = p[i2 * 3 + 2]!
  const longest = Math.sqrt(
    Math.max((bx - ax) ** 2 + (bz - az) ** 2, (cx - bx) ** 2 + (cz - bz) ** 2, (ax - cx) ** 2 + (az - cz) ** 2),
  )
  const bend = studySurfaceBend(Math.min(ax, bx, cx), Math.min(az, bz, cz), Math.max(ax, bx, cx), Math.max(az, bz, cz))
  return corners - 0.5 * bend * longest >= need
}

/**
 * Raises every face that comes closer to the ground than its vertices'
 * floor allows, moving only movable vertices. A face of movable vertices is
 * cleared in one pass (raising its corners raises all of it); a face with a
 * fixed corner may take a few.
 */
function conform(b: Buffers) {
  const { positions, indices, floor, movable } = b
  const raise = new Float64Array(floor.length)
  const raised = new Float64Array(floor.length)
  const clearance = new Float64Array(floor.length)
  let faces: number[] | null = null
  for (let pass = 0; pass < 4 && (faces === null || faces.length > 0); pass += 1) {
    raise.fill(0)
    for (let i = 0; i < clearance.length; i += 1) {
      clearance[i] = positions[i * 3 + 1]! - studySurfaceHeight(positions[i * 3]!, positions[i * 3 + 2]!)
    }
    const again: number[] = []
    const count = faces ? faces.length : indices.length / 3
    for (let f = 0; f < count; f += 1) {
      const t = faces ? faces[f]! : f
      const i0 = indices[t * 3]!
      const i1 = indices[t * 3 + 1]!
      const i2 = indices[t * 3 + 2]!
      const need = Math.min(floor[i0]!, floor[i1]!, floor[i2]!)
      const moving = Number(movable[i0]) + Number(movable[i1]) + Number(movable[i2])
      if (need === -Infinity || moving === 0) {
        continue
      }
      const corners = Math.min(clearance[i0]!, clearance[i1]!, clearance[i2]!)
      if (clearOfBend(positions, i0, i1, i2, corners, need)) {
        continue
      }
      const deficit = need - lowestClearance(positions, i0, i1, i2, corners)
      if (deficit <= 1e-6) {
        continue
      }
      for (const i of [i0, i1, i2]) {
        if (movable[i]) {
          raise[i] = Math.max(raise[i]!, deficit)
        }
      }
      if (moving < 3) {
        again.push(t)
      }
    }
    for (let i = 0; i < raise.length; i += 1) {
      positions[i * 3 + 1]! += raise[i]!
      raised[i]! += raise[i]!
    }
    faces = again
  }

  // Each grid point of the ground takes the largest raise in the cells
  // around it, and every movable vertex rises by that field where it stands
  // (never less than its own raise), so water laid in layers at one place
  // rises together and keeps its order.
  const n = Math.round((2 * STUDY_HALF) / STUDY_CELL)
  const field = new Float64Array((n + 1) * (n + 1))
  const cellOf = (v: number) => Math.min(n - 1, Math.max(0, Math.floor((v + STUDY_HALF) / STUDY_CELL)))
  let any = false
  for (let v = 0; v < raised.length; v += 1) {
    if (raised[v]! > 0) {
      any = true
      const i = cellOf(positions[v * 3]!)
      const j = cellOf(positions[v * 3 + 2]!)
      for (const g of [i + j * (n + 1), i + 1 + j * (n + 1), i + (j + 1) * (n + 1), i + 1 + (j + 1) * (n + 1)]) {
        field[g] = Math.max(field[g]!, raised[v]!)
      }
    }
  }
  if (!any) {
    return
  }
  for (let v = 0; v < raised.length; v += 1) {
    if (!movable[v]) {
      continue
    }
    const x = positions[v * 3]!
    const z = positions[v * 3 + 2]!
    const i = cellOf(x)
    const j = cellOf(z)
    const fu = Math.min(1, Math.max(0, (x + STUDY_HALF) / STUDY_CELL - i))
    const fv = Math.min(1, Math.max(0, (z + STUDY_HALF) / STUDY_CELL - j))
    const at =
      (1 - fu) * (1 - fv) * field[i + j * (n + 1)]! +
      fu * (1 - fv) * field[i + 1 + j * (n + 1)]! +
      (1 - fu) * fv * field[i + (j + 1) * (n + 1)]! +
      fu * fv * field[i + 1 + (j + 1) * (n + 1)]!
    positions[v * 3 + 1]! += Math.max(0, at - raised[v]!)
  }
}

/**
 * The drainage network at generation step `time`: each reach a ribbon whose
 * width follows its accumulated flow, a pool where it ends in a hollow,
 * running off the block's cut edge, and a wet bank beneath. Water attributes: `aFlow`
 * distance along the channel, `aAcross` −1 → 1, `aSpeed` the current from the
 * local fall, `aFoam` 0 → 1. Bank: `aBank` 0 at the water, 1 at its edge.
 */
export function streamGeometry(
  lines: readonly TimedLine[],
  reaches: readonly FlowReach[],
  time: number,
): { water: BufferGeometry; bank: BufferGeometry } {
  const water = buffers(['aFlow', 'aAcross', 'aSpeed', 'aFoam'])
  const bank = buffers(['aBank'])
  const ground = studySurfaceHeight
  const width = channelHalfWidth
  const onBlock = (v: number) => Math.min(STUDY_HALF, Math.max(-STUDY_HALF, v))
  const bankWidth = (halfWidth: number) => BANK.width + BANK.share * halfWidth
  const poolRadius = (reach: FlowReach) => Math.min(POOL.max, POOL.scale * width(reachFlow(reach, reach.length, time, false)))
  /** How far the receiving water spreads around a reach's start. */
  const receiverRadius = (reach: FlowReach) =>
    reach.mouth === 'hollow' && reach.length < 1e-9 ? poolRadius(reach) : width(reachFlow(reach, 0, time))

  /** Water on the ground, lifted along its normal; sunk water lies just under it, hidden. */
  const waterVertex = (x: number, z: number, lift: number, sunk: boolean, values: readonly number[]) =>
    sunk
      ? vertex(water, x, ground(x, z) - JOIN.sink, z, values)
      : vertex(water, x, ground(x, z) + lift * normalFactor(x, z), z, values, lift * SURFACE.clear, true)
  /** Bank under the water follows it, `BANK.under` below, once the water is laid: [bank, water] vertex pairs. */
  const under: [number, number][] = []
  const bankUnder = (waterIndex: number, x: number, z: number, sunk: boolean) => {
    const index = vertex(bank, x, 0, z, [0], sunk ? -Infinity : BANK.lift * BANK.clear, false)
    under.push([index, waterIndex])
    return index
  }
  const bankBeside = (x: number, z: number, out: number, sunk: boolean) =>
    sunk
      ? vertex(bank, x, ground(x, z) - JOIN.sink - BANK.under, z, [out])
      : vertex(
          bank,
          x,
          ground(x, z) + (BANK.lift + BANK.tent * (1 - out)) * normalFactor(x, z),
          z,
          [out],
          BANK.lift * BANK.clear,
          true,
        )

  // Larger reaches first: drawn first, they hide what lies under them.
  const finals = reaches.map((reach) => reachFlow(reach, reach.length, Infinity, false))
  const order = reaches.map((_, r) => r).sort((a, b) => finals[b]! - finals[a]! || a - b)
  const levels: number[] = []
  const levelOf = (r: number): number =>
    (levels[r] ??= reaches[r]!.inputs.reduce((level, input) => Math.max(level, levelOf(input) + 1), 0))
  const liftStep = Math.min(STREAM.liftStep, STREAM.liftRange / Math.max(1, ...reaches.map((_, r) => levelOf(r))))

  // A tributary ends on its receiving channel's centreline: where that water is drawn, its end dips under it.
  const receivers = new Map<number, { at: Point2; radius: number }>()
  reaches.forEach((reach, r) => {
    if (!revealLine(lines[r]!, time) && lines[r]!.points.length > 1) {
      return
    }
    for (const input of reach.inputs) {
      if (reaches[input]!.channel !== reach.channel) {
        receivers.set(input, { at: lines[r]!.points[0]!, radius: receiverRadius(reach) })
      }
    }
  })

  /** Sections along a revealed reach, at most `SPACING` apart. */
  const sectionsOf = (reach: FlowReach, points: readonly Point2[], receiver: { at: Point2; radius: number } | undefined) => {
    const s = arcLengths(points)
    const total = s.at(-1)!
    const heights = points.map((p) => ground(p.x, p.z))
    const speeds = points.map((_, i) => {
      const before = Math.max(0, i - 1)
      const after = Math.min(points.length - 1, i + 1)
      const grade = (heights[before]! - heights[after]!) / Math.max(1e-3, s[after]! - s[before]!)
      return Math.min(CURRENT.max, CURRENT.base + CURRENT.perGrade * Math.max(0, grade))
    })
    const locate = (d: number): [number, number] => {
      const clamped = Math.min(total, Math.max(0, d))
      let lo = 0
      let hi = s.length - 1
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (s[mid]! <= clamped) {
          lo = mid
        } else {
          hi = mid
        }
      }
      const span = s[hi]! - s[lo]!
      return [lo, span > 0 ? (clamped - s[lo]!) / span : 0]
    }
    const pointAt = (d: number): Point2 => {
      const [i, f] = locate(d)
      const a = points[i]!
      const b = points[Math.min(points.length - 1, i + 1)]!
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f }
    }

    // Where the centreline turns sharply the ribbon breaks into pieces, each
    // keeping its own heading, and a round joint covers the turn.
    const stops = [0]
    for (let i = 1; i < points.length - 1; i += 1) {
      const ax = points[i]!.x - points[i - 1]!.x
      const az = points[i]!.z - points[i - 1]!.z
      const bx = points[i + 1]!.x - points[i]!.x
      const bz = points[i + 1]!.z - points[i]!.z
      const turned = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) + 1e-12) < CORNER
      if (turned && s[i]! - stops.at(-1)! > SPACING && total - s[i]! > SPACING) {
        stops.push(s[i]!)
      }
    }
    stops.push(total)
    const samples: { d: number; piece: number; from: number; to: number }[] = []
    if (points.length > 1) {
      for (let piece = 0; piece < stops.length - 1; piece += 1) {
        const from = stops[piece]!
        const to = stops[piece + 1]!
        const n = Math.max(1, Math.ceil((to - from) / SPACING))
        for (let k = 0; k <= n; k += 1) {
          samples.push({ d: from + ((to - from) * k) / n, piece, from, to })
        }
      }
    } else {
      samples.push({ d: 0, piece: 0, from: 0, to: 0 })
    }
    const raw = samples.map(({ d, piece, from, to }) => {
      const p = pointAt(d)
      const [i, f] = locate(d)
      const speed = speeds[i]! + (speeds[Math.min(points.length - 1, i + 1)]! - speeds[i]!) * f
      const fast = (speed - CURRENT.base) / (CURRENT.max - CURRENT.base)
      const along = reach.along + d
      const halfWidth =
        width(reachFlow(reach, d, time)) *
        (1 + STREAM.wobble * simplex2(along * STREAM.wobbleFrequency, reach.channel * 5.3)) *
        (1 + STREAM.fastNarrow * (0.5 - fast)) *
        (STREAM.sourceWidth + (1 - STREAM.sourceWidth) * smoothstep(0, STREAM.sourceTaper, along))
      const foam = Math.max(
        reach.confluence ? 1 - smoothstep(0, FOAM.length, d) : 0,
        FOAM.rapids * smoothstep(FOAM.fastFrom, 1, fast),
      )
      // Heading over about the channel's width, so a sharp kink in the centreline turns the rows gradually.
      const reachBack = Math.max(2 * SPACING, halfWidth)
      const a = pointAt(Math.max(from, d - reachBack))
      const b = pointAt(Math.min(to, d + reachBack))
      const length = Math.hypot(b.x - a.x, b.z - a.z)
      const tangent: [number, number] = length > 1e-9 ? [(b.x - a.x) / length, (b.z - a.z) / length] : planTangent(points, i)
      const sunk = receiver !== undefined && Math.hypot(p.x - receiver.at.x, p.z - receiver.at.z) < receiver.radius * JOIN.share
      return { p, tangent, halfWidth, along, speed, foam, sunk, d, piece }
    })
    // Water lying over an earlier piece, or bending back over its own, rides over it.
    const over = new Float64Array(raw.length)
    raw.forEach((section, k) => {
      for (let j = 0; j < k; j += 1) {
        const earlier = raw[j]!
        const apart = Math.hypot(section.p.x - earlier.p.x, section.p.z - earlier.p.z)
        const later = earlier.piece !== section.piece || section.d - earlier.d > 1.5 * apart + 0.5 * SPACING
        if (apart < section.halfWidth + earlier.halfWidth && later) {
          over[k] = Math.max(over[k]!, over[j]! + STREAM.liftOver)
        }
      }
    })
    return raw.map((section, k): Section => {
      const before = raw[k - 1]?.piece === section.piece ? raw[k - 1]! : section
      const after = raw[k + 1]?.piece === section.piece ? raw[k + 1]! : section
      const ds = after.d - before.d
      const turn = before.tangent[0] * after.tangent[1] - before.tangent[1] * after.tangent[0]
      const curvature = ds > 0 ? turn / ds : 0
      const radius = Math.abs(curvature) > 1e-9 ? FOLD / Math.abs(curvature) : Infinity
      const leftMax = curvature > 0 ? radius : Infinity
      const rightMax = curvature < 0 ? radius : Infinity
      return {
        ...section,
        left: Math.min(section.halfWidth, leftMax),
        right: Math.min(section.halfWidth, rightMax),
        leftMax,
        rightMax,
        over: over[k]!,
      }
    })
  }

  /** A disc, or part of one from angle `from` to `to`, of water over a ring of bank: rings at most `SPACING` apart. */
  const disc = (center: Point2, radius: number, from: number, to: number, segments: number, lift: number, end: Section, speed: number) => {
    const full = to - from >= 2 * Math.PI - 1e-6
    const rings = Math.max(1, Math.ceil(radius / SPACING))
    const spokes = Math.max(segments, Math.ceil((radius * (to - from)) / SPACING))
    const outer = bankWidth(radius)
    const bankRings = Math.max(1, Math.ceil(outer / SPACING))
    const values = (across: number) => [end.along, across, speed, 0]
    water.layer = lift
    bank.layer = lift
    const middle = waterVertex(center.x, center.z, lift, false, values(0))
    const bankMiddle = bankUnder(middle, center.x, center.z, false)
    let previous: { water: number[]; bank: number[] } | null = null
    for (let k = 1; k <= rings + bankRings; k += 1) {
      const wet = k <= rings
      const r = wet ? (radius * k) / rings : radius + (outer * (k - rings)) / bankRings
      const waterRow: number[] = []
      const bankRow: number[] = []
      for (let q = 0; q <= spokes; q += 1) {
        const share = q / spokes
        const angle = from + (to - from) * share
        const x = onBlock(center.x + Math.cos(angle) * r)
        const z = onBlock(center.z + Math.sin(angle) * r)
        if (wet) {
          const side = !full && share < 0.5 ? -1 : 1
          const index = waterVertex(x, z, lift, false, values((side * k) / rings))
          waterRow.push(index)
          bankRow.push(bankUnder(index, x, z, false))
        } else {
          bankRow.push(bankBeside(x, z, (k - rings) / bankRings, false))
        }
      }
      if (previous) {
        if (wet) {
          strip(water, previous.water, waterRow)
        }
        strip(bank, previous.bank, bankRow)
      } else {
        for (let q = 0; q < spokes; q += 1) {
          face(water, middle, waterRow[q]!, waterRow[q + 1]!)
          face(bank, bankMiddle, bankRow[q]!, bankRow[q + 1]!)
        }
      }
      previous = { water: waterRow, bank: bankRow }
    }
  }

  const revealed = lines.map((line) => revealLine(line, time))
  const sectionsByReach = reaches.map((reach, r) => {
    const points = revealed[r]
    return points ? sectionsOf(reach, points, receivers.get(r)) : []
  })
  // Each reach rides over every reach flowing into it, and the reach carrying a
  // channel on rides over the tributaries joining it there.
  const receiving = new Map<number, number>()
  reaches.forEach((reach, r) => reach.inputs.forEach((input) => receiving.set(input, r)))
  const lifts: number[] = []
  const topOf = (r: number) => liftOf(r) + Math.max(0, ...sectionsByReach[r]!.map((section) => section.over))
  const liftOf = (r: number): number => {
    if (lifts[r] === undefined) {
      const below = [...reaches[r]!.inputs]
      const into = receiving.get(r)
      if (into !== undefined && reaches[into]!.channel === reaches[r]!.channel) {
        below.push(...reaches[into]!.inputs.filter((input) => reaches[input]!.channel !== reaches[r]!.channel))
      }
      lifts[r] = below.reduce((lift, other) => Math.max(lift, topOf(other) + liftStep), STREAM.lift)
    }
    return lifts[r]
  }

  order.forEach((r) => {
    const reach = reaches[r]!
    const line = lines[r]!
    const points = revealed[r]
    if (!points) {
      return
    }
    const lift = liftOf(r)
    const sections = sectionsByReach[r]!
    const widest = Math.max(...sections.map((section) => section.halfWidth))
    const across = Math.max(2, Math.ceil(widest / SPACING))
    const beside = Math.max(1, Math.ceil(bankWidth(widest) / SPACING))

    // Where the reach carries a channel on from the reach above, a round joint
    // between the two covers the change of heading and the tributary's sunk end.
    const first = sections[0]!
    if (points.length > 1 && reach.inputs.some((input) => reaches[input]!.channel === reach.channel)) {
      const radius = Math.max(first.halfWidth, receiverRadius(reach))
      disc(first.p, radius, 0, 2 * Math.PI, 2 * CAP_SEGMENTS, lift - liftStep / 2, first, first.speed)
    }

    let previous: { water: number[]; bank: number[] } | null = null
    let last: Section | null = null
    for (const section of points.length > 1 ? sections : []) {
      const { p, left, right, halfWidth, along, speed, foam, sunk } = section
      if (last && last.piece !== section.piece) {
        previous = null
        if (!sunk && !last.sunk) {
          const joint = lift + (last.over + section.over) / 2
          disc(p, halfWidth, 0, 2 * Math.PI, 2 * CAP_SEGMENTS, joint, section, speed)
        }
      }
      last = section
      const [tx, tz] = section.tangent
      const at = (offset: number): [number, number] => [onBlock(p.x - tz * offset), onBlock(p.z + tx * offset)]
      const values = (a: number) => [along, a, speed, foam]
      const bankRight = Math.max(right, Math.min(right + bankWidth(halfWidth), section.rightMax))
      const bankLeft = Math.max(left, Math.min(left + bankWidth(halfWidth), section.leftMax))
      const row: number[] = []
      const bankRow: number[] = []
      for (let q = beside; q >= 1; q -= 1) {
        const [x, z] = at(-(right + ((bankRight - right) * q) / beside))
        bankRow.push(bankBeside(x, z, q / beside, sunk))
      }
      for (let m = -across; m <= across; m += 1) {
        const a = m / across
        const [x, z] = at(a * (a < 0 ? right : left))
        const index = waterVertex(x, z, lift + section.over, sunk, values(a))
        row.push(index)
        bankRow.push(bankUnder(index, x, z, sunk))
      }
      for (let q = 1; q <= beside; q += 1) {
        const [x, z] = at(left + ((bankLeft - left) * q) / beside)
        bankRow.push(bankBeside(x, z, q / beside, sunk))
      }
      if (previous) {
        water.layer = lift + section.over
        bank.layer = water.layer
        strip(water, previous.water, row)
        strip(bank, previous.bank, bankRow)
      }
      previous = { water: row, bank: bankRow }
    }

    // An edge mouth runs off the cut as it is; a hollow pools; only a stream
    // stopped by the safety limit gets a rounded end.
    if (!reach.mouth || reach.mouth === 'edge' || time < line.times.at(-1)!) {
      return
    }
    const end = sections.at(-1)!
    const endLift = lift + end.over
    if (reach.mouth === 'hollow') {
      const radius = Math.min(POOL.max, POOL.scale * width(reachFlow(reach, reach.length, time, false)))
      disc(end.p, radius, 0, 2 * Math.PI, POOL.segments, topOf(r) + POOL.above, end, POOL.speed)
    } else if (points.length > 1) {
      // A rounded end, from the left bank through straight ahead to the right.
      const [tx, tz] = end.tangent
      const left = Math.atan2(-tx, tz)
      disc(end.p, end.halfWidth, left, left + Math.PI, CAP_SEGMENTS, endLift, end, end.speed)
    } else {
      disc(end.p, end.halfWidth, 0, 2 * Math.PI, POOL.segments, endLift, end, end.speed)
    }
  })

  conform(water)
  for (const [index, waterIndex] of under) {
    bank.positions[index * 3 + 1] = water.positions[waterIndex * 3 + 1]! - BANK.under
  }
  conform(bank)

  const waterGeometry = geometryOf(water)
  waterGeometry.computeVertexNormals()
  return { water: waterGeometry, bank: geometryOf(bank) }
}

const ROOT = new Color(PATH_COLORS.vein.root)
const TIP = new Color(PATH_COLORS.vein.tip)

/** Tapered tubes along the Growth lines: thick main lines, thinner branches, closing to points. */
export function veinGeometry(lines: readonly MeshLine[], ground: Height): BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const n = VEIN.radial
  const color = new Color()

  for (const line of lines) {
    const dense = line.points
    if (dense.length < 2) {
      continue
    }
    const keep = dense.map((_, i) => i).filter((i) => i % VEIN.every === 0 || i === dense.length - 1)
    const points = keep.map((i) => dense[i]!)
    const s = arcLengths(points)
    const revealed = s.at(-1)!
    const root = VEIN.radius[Math.min(line.depth, VEIN.radius.length - 1)]!
    const rings = points.map((p, i) => {
      const u = Math.min(1, s[i]! / line.length)
      const tip = Math.sqrt(smoothstep(0, VEIN.tip, line.length - s[i]!))
      const growing = Math.sqrt(smoothstep(0, VEIN.growingTip, revealed - s[i]!))
      const flare = line.depth === 0 ? 1 + VEIN.flare * (1 - smoothstep(0, VEIN.flareLength, s[i]!)) : 1
      const radius = Math.max(VEIN.minRadius, root * (1 - VEIN.taper * u) * Math.min(tip, growing) * flare)
      return { x: p.x, y: ground(p.x, p.z) + radius * (1 - VEIN.sink), z: p.z, radius, u }
    })

    const base = positions.length / 3
    rings.forEach((ring, i) => {
      const a = rings[Math.max(0, i - 1)]!
      const b = rings[Math.min(rings.length - 1, i + 1)]!
      let tx = b.x - a.x
      let ty = b.y - a.y
      let tz = b.z - a.z
      const tl = Math.hypot(tx, ty, tz) || 1
      tx /= tl
      ty /= tl
      tz /= tl
      // side = tangent × up, then a normal perpendicular to both.
      let sx = -tz
      let sz = tx
      const sl = Math.hypot(sx, sz) || 1
      sx /= sl
      sz /= sl
      const ux = -sz * ty
      const uy = sz * tx - sx * tz
      const uz = sx * ty
      color.copy(ROOT).lerp(TIP, ring.u)
      for (let k = 0; k < n; k += 1) {
        const angle = (2 * Math.PI * k) / n
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const nx = sx * cos + ux * sin
        const ny = uy * sin
        const nz = sz * cos + uz * sin
        positions.push(ring.x + nx * ring.radius, ring.y + ny * ring.radius, ring.z + nz * ring.radius)
        normals.push(nx, ny, nz)
        colors.push(color.r, color.g, color.b)
      }
      if (i > 0) {
        const previous = base + (i - 1) * n
        const current = base + i * n
        for (let k = 0; k < n; k += 1) {
          const k1 = (k + 1) % n
          indices.push(previous + k, current + k, previous + k1, previous + k1, current + k, current + k1)
        }
      }
    })
  }

  return build(positions, indices, {
    normal: { values: normals, size: 3 },
    color: { values: colors, size: 3 },
  })
}
