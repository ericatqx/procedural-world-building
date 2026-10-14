import type { WaterLayout } from '../project/terrain.ts'
import { simplex2 } from '../shared/noise/simplex.ts'
import { smoothstep } from './core.ts'

/**
 * Shadow Ecology 0.2 — water composed rather than read off the drainage.
 *
 * Two lakes of different size and shape sit in separate basins: a smaller
 * upper lake under the high range, fed from the range and its east end, and
 * a larger lower lake toward the front, fed down the west valley. A winding
 * channel joins them. The lower lake drains to a fall on the south-west rim;
 * a stream off the tableland falls from the east rim, on the opposite side.
 *
 * The landform is reshaped only where the water needs it: a worn valley
 * along each river and a bowl under each lake, whose shore is wherever the
 * bowl meets the ground at the lake's level. Each lake's level is the lowest
 * ground around its outline, so the bowl never has to raise anything.
 */

type LakeSpec = {
  x: number
  z: number
  radius: number
  /** Elongation along `axis`. */
  stretch: number
  axis: number
  seed: number
  depth: number
  /** A broad, smooth hollow the lake sits in, where the ground stands too high for it. */
  hollow?: { depth: number; radius: number }
  /** Stands at least this far below the lake it is fed from. */
  below?: { lake: number; by: number }
}

type RiverSpec = {
  /** Control points, head to mouth; the river winds between them. */
  through: [number, number][]
  /** Drained cells at the head and at the mouth: width grows downstream. */
  flow: [number, number]
  meander: number
  valley: { depth: number; width: number }
  outlet?: boolean
  /** Ends on this (earlier) river, wherever its winding course passes nearest. */
  joins?: number
  seed: number
}

const LAKES: LakeSpec[] = [
  { x: 2.15, z: -0.45, radius: 0.78, stretch: 1.45, axis: 2.08, seed: 1.3, depth: 0.3 },
  {
    x: -1.2,
    z: 2.15,
    radius: 1.1,
    stretch: 1.25,
    axis: -0.35,
    seed: 4.1,
    depth: 0.4,
    hollow: { depth: 0.3, radius: 1.9 },
    below: { lake: 0, by: 0.12 },
  },
]

const RIVERS: RiverSpec[] = [
  // Down the valley off the high range's east end into the upper lake.
  {
    through: [[3.9, -2.4], [3.3, -1.95], [2.85, -1.55], [2.5, -1.05]],
    flow: [160, 1400],
    meander: 0.14,
    valley: { depth: 0.16, width: 0.5 },
    seed: 7.7,
  },
  // Down the west valley into the lower lake…
  {
    through: [[-1.6, -2.6], [-1.5, -1.8], [-1.3, -1.0], [-1.2, -0.2], [-1.3, 0.6], [-1.3, 1.25]],
    flow: [200, 1500],
    meander: 0.2,
    valley: { depth: 0.2, width: 0.6 },
    seed: 5.3,
  },
  // …joined by a stream off the west range.
  {
    through: [[-2.75, -1.6], [-2.2, -1.15], [-1.4, -0.9]],
    flow: [120, 350],
    meander: 0.06,
    valley: { depth: 0.1, width: 0.35 },
    joins: 1,
    seed: 9.2,
  },
  // The channel from the upper lake to the lower.
  {
    through: [[1.75, 0.25], [1.2, 0.85], [0.5, 1.15], [-0.1, 1.5], [-0.35, 1.75]],
    flow: [2400, 2700],
    meander: 0.22,
    valley: { depth: 0.16, width: 0.6 },
    seed: 3.6,
  },
  // The lower lake's outflow to the south-west fall.
  {
    through: [[-2.05, 2.75], [-2.35, 3.2], [-2.6, 3.6]],
    flow: [4800, 5000],
    meander: 0.1,
    valley: { depth: 0.18, width: 0.6 },
    outlet: true,
    seed: 6.4,
  },
  // Off the tableland to the east fall.
  {
    through: [[4.0, 0.15], [4.55, 0.75], [5.1, 1.25], [5.55, 1.45]],
    flow: [150, 1100],
    meander: 0.14,
    valley: { depth: 0.16, width: 0.5 },
    outlet: true,
    seed: 8.8,
  },
]

const STEP = 0.06
/** Rise of the ground beyond a lake's shore, per unit outward. */
const BANK = 1.3

/** Normalised distance from a lake's centre to its lobed outline (1 on the shore). */
function lakeShape(lake: LakeSpec) {
  const c = Math.cos(lake.axis)
  const s = Math.sin(lake.axis)
  const radiusAt = (theta: number) =>
    lake.radius *
    (1 +
      0.14 * Math.sin(2 * theta + lake.seed) +
      0.12 * Math.sin(3 * theta + 2.3 * lake.seed) +
      0.08 * Math.sin(5 * theta - 1.7 * lake.seed) +
      0.05 * Math.sin(7 * theta + 4.1 * lake.seed))
  const rho = (x: number, z: number) => {
    const dx = x - lake.x
    const dz = z - lake.z
    const u = (dx * c + dz * s) / lake.stretch
    const v = -dx * s + dz * c
    return Math.hypot(u, v) / radiusAt(Math.atan2(v, u))
  }
  /** A point at normalised distance `r` in direction `theta` (in the lake's frame). */
  const point = (theta: number, r: number): [number, number] => {
    const u = Math.cos(theta) * radiusAt(theta) * r * lake.stretch
    const v = Math.sin(theta) * radiusAt(theta) * r
    return [lake.x + u * c - v * s, lake.z + u * s + v * c]
  }
  return { rho, point }
}

/** A winding centreline through the control points, about STEP apart. */
function windingPath(river: RiverSpec) {
  const p = river.through
  const raw: [number, number][] = []
  for (let k = 0; k < p.length - 1; k += 1) {
    const p0 = p[Math.max(0, k - 1)]!
    const p1 = p[k]!
    const p2 = p[k + 1]!
    const p3 = p[Math.min(p.length - 1, k + 2)]!
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / STEP))
    for (let i = 0; i < n; i += 1) {
      const t = i / n
      const t2 = t * t
      const t3 = t2 * t
      const at = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3)
      raw.push([at(p0[0], p1[0], p2[0], p3[0]), at(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  raw.push(p[p.length - 1]!)
  const along = [0]
  for (let k = 1; k < raw.length; k += 1) {
    along.push(along[k - 1]! + Math.hypot(raw[k]![0] - raw[k - 1]![0], raw[k]![1] - raw[k - 1]![1]))
  }
  const length = along[along.length - 1]!
  // Meanders swing to either side, held still at both ends.
  const wound = raw.map(([x, z], k) => {
    const a = raw[Math.max(0, k - 1)]!
    const b = raw[Math.min(raw.length - 1, k + 1)]!
    const tx = b[0] - a[0]
    const tz = b[1] - a[1]
    const tl = Math.hypot(tx, tz) || 1
    const s = along[k]!
    const hold = smoothstep(0, 0.45, s) * smoothstep(0, 0.45, length - s)
    const swing =
      river.meander * hold * (simplex2(s * 1.1 + river.seed * 7.1, river.seed) + 0.25 * simplex2(s * 2 - river.seed, river.seed * 3.3))
    return [x - (tz / tl) * swing, z + (tx / tl) * swing] as [number, number]
  })
  for (let pass = 0; pass < 3; pass += 1) {
    for (let k = 1; k < wound.length - 1; k += 1) {
      wound[k] = [
        (wound[k - 1]![0] + 2 * wound[k]![0] + wound[k + 1]![0]) / 4,
        (wound[k - 1]![1] + 2 * wound[k]![1] + wound[k + 1]![1]) / 4,
      ]
    }
  }
  const points: { x: number; z: number; s: number }[] = []
  let s = 0
  for (const [k, [x, z]] of wound.entries()) {
    if (k > 0) s += Math.hypot(x - wound[k - 1]![0], z - wound[k - 1]![1])
    points.push({ x, z, s })
  }
  return { points, length: s }
}

/** Reshapes `natural` to hold the water, and returns the water it holds. */
export function composeWaterways(natural: (x: number, z: number) => number) {
  type Path = ReturnType<typeof windingPath> & { river: RiverSpec; reach: number; box: readonly [number, number, number, number] }
  const paths: Path[] = []
  for (const spec of RIVERS) {
    let river = spec
    if (spec.joins !== undefined) {
      const [ex, ez] = spec.through[spec.through.length - 1]!
      const parent = paths[spec.joins]!.points
      const meet = parent.reduce((a, b) => (Math.hypot(b.x - ex, b.z - ez) < Math.hypot(a.x - ex, a.z - ez) ? b : a))
      river = { ...spec, through: [...spec.through.slice(0, -1), [meet.x, meet.z]] }
    }
    const { points, length } = windingPath(river)
    const reach = river.valley.width * 1.6
    const xs = points.map((p) => p.x)
    const zs = points.map((p) => p.z)
    const box = [Math.min(...xs) - reach, Math.max(...xs) + reach, Math.min(...zs) - reach, Math.max(...zs) + reach] as const
    paths.push({ river, points, length, reach, box })
  }

  // A worn valley along each river (a smooth trough, fading in at its head
  // and out at its mouth); where valleys meet, the deeper one counts.
  const valleyCut = (x: number, z: number) => {
    let cut = 0
    for (const { river, points, length, reach, box } of paths) {
      if (x < box[0] || x > box[1] || z < box[2] || z > box[3]) continue
      let best = Infinity
      let bestS = 0
      for (let k = 0; k < points.length - 1; k += 1) {
        const a = points[k]!
        const b = points[k + 1]!
        const ex = b.x - a.x
        const ez = b.z - a.z
        const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez)))
        const d = Math.hypot(x - a.x - ex * t, z - a.z - ez * t)
        if (d < best) {
          best = d
          bestS = a.s + (b.s - a.s) * t
        }
      }
      if (best > reach) continue
      const ends = smoothstep(0, 0.7, bestS) * smoothstep(0, 0.5, length - bestS)
      const depth = river.valley.depth * ends
      cut = Math.max(cut, depth * Math.exp(-2.6 * (best / river.valley.width) ** 2))
    }
    return cut
  }
  const hollows = (x: number, z: number) => {
    let cut = 0
    for (const { x: cx, z: cz, hollow } of LAKES) {
      if (hollow) cut += hollow.depth * Math.exp(-(((x - cx) ** 2 + (z - cz) ** 2) / hollow.radius ** 2))
    }
    return cut
  }
  const valleyed = (x: number, z: number) => natural(x, z) - hollows(x, z) - valleyCut(x, z)

  const shapes = LAKES.map(lakeShape)
  const levels: number[] = []
  for (const [k, lake] of LAKES.entries()) {
    let lowest = Infinity
    for (let i = 0; i < 128; i += 1) {
      const [x, z] = shapes[k]!.point((i / 128) * 2 * Math.PI, 1.04)
      lowest = Math.min(lowest, valleyed(x, z))
    }
    let level = lowest - 0.015
    if (lake.below) level = Math.min(level, levels[lake.below.lake]! - lake.below.by)
    levels.push(level)
  }

  // Each lake's bowl: below its level inside the outline, and beyond it a
  // short steep bank, so where the ground stands higher the shore is a low
  // bluff rather than a wide cut. Blended into the ground by a smooth minimum.
  const landform = (x: number, z: number) => {
    let h = valleyed(x, z)
    for (const [k, lake] of LAKES.entries()) {
      const rho = shapes[k]!.rho(x, z)
      if (rho > 1.8) continue
      const bowl = levels[k]! + (rho < 1 ? lake.depth * (rho * rho - 1) : BANK * (rho - 1) * lake.radius)
      const blend = 0.05
      const gap = Math.max(0, blend - Math.abs(h - bowl)) / blend
      h = Math.min(h, bowl) - gap * gap * blend * 0.25
    }
    return h
  }

  const layout: WaterLayout = {
    lakes: LAKES.map((_, k) => ({ level: levels[k]!, contains: (x: number, z: number) => shapes[k]!.rho(x, z) < 1.3 })),
    rivers: paths.map(({ river, points, length }) => ({
      outlet: river.outlet ?? false,
      points: points.map((p) => ({
        x: p.x,
        z: p.z,
        flow: river.flow[0] + (river.flow[1] - river.flow[0]) * (p.s / length) ** 0.8,
      })),
    })),
  }
  return { landform, layout }
}
