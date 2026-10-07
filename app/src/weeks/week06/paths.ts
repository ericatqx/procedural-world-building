import { simplex2 } from '../../shared/noise/simplex.ts'
import { mulberry32 } from './distribution.ts'
import { STUDY_HALF, studyHeight } from './studyTerrain.ts'

/**
 * Week 06 — Paths: three ways of turning points into lines over the study
 * terrain. Each method builds its lines in plan (x, z) from a seed; the scene
 * then lays them on the ground. Every line vertex carries the step at which
 * it appears, so progressive generation can replay the finished run:
 *
 *   connection  seeded nodes → candidate links, shortest first → keep a link
 *               only when the network's detour is too long (a greedy spanner)
 *   flow        sources on high ground → step along the downhill direction,
 *               with inertia and meander, until it meets an earlier channel
 *               and joins it, pools in a hollow (even the downhill step would
 *               climb, or it stops descending), or runs off the edge → reaches
 *               between confluences, each carrying the summed flow of the
 *               sources above it
 *   growth      anchors → step along a heading turned by coherent noise,
 *               sometimes branching, in a flat 2D plane → projected onto the
 *               terrain as a spline
 *
 * The same seed and settings always give the same lines.
 */

export type PathMethod = 'connection' | 'flow' | 'growth'
export const PATH_METHODS: readonly PathMethod[] = ['connection', 'flow', 'growth']

export type Point2 = { x: number; z: number }

/** A line in plan; `times[i]` is the step at which vertex i appears. */
export type TimedLine = { points: Point2[]; times: number[]; depth: number }

export type PathNode = Point2 & { time: number; kind: 'node' | 'source' | 'confluence' | 'end' | 'anchor' }

export type PathStudy = {
  method: PathMethod
  /** The final lines, densely sampled. */
  paths: TimedLine[]
  /** What the lines came from: straight links (connection) or the 2D step lines (growth). */
  sources: TimedLine[]
  nodes: PathNode[]
  /** The step at which the run is complete. */
  total: number
  /** Total plan length of the final lines, world units. */
  length: number
  /** Growth: branches grown; flow: confluences. */
  extra: number
  /** Flow: the drainage network; `paths` are its reaches. */
  network?: FlowNetwork
}

export type ConnectionSettings = { nodes: number; seed: number; curvature: number; directness: number }
export type FlowSettings = { count: number; seed: number; downhill: number; meander: number }
export type GrowthSettings = { count: number; seed: number; length: number; drift: number; branching: number }
export type PathSettingsMap = { connection: ConnectionSettings; flow: FlowSettings; growth: GrowthSettings }

export const DEFAULT_PATH_SETTINGS: PathSettingsMap = {
  connection: { nodes: 12, seed: 5, curvature: 0.35, directness: 0.45 },
  flow: { count: 12, seed: 3, downhill: 0.75, meander: 0.3 },
  growth: { count: 5, seed: 9, length: 2.2, drift: 0.45, branching: 0.35 },
}

type Range = { min: number; max: number; step: number }
const SEED: Range = { min: 1, max: 999, step: 1 }
const UNIT: Range = { min: 0, max: 1, step: 0.05 }

export const PATH_RANGES = {
  connection: { nodes: { min: 3, max: 30, step: 1 }, seed: SEED, curvature: UNIT, directness: UNIT },
  flow: { count: { min: 1, max: 30, step: 1 }, seed: SEED, downhill: UNIT, meander: UNIT },
  growth: { count: { min: 1, max: 12, step: 1 }, seed: SEED, length: { min: 0.4, max: 4, step: 0.1 }, drift: UNIT, branching: UNIT },
} as const

export const PATH_COLORS = {
  /** Growth veins: a warm grey at the root to off-white at the tips. */
  vein: { root: '#d3cdc1', tip: '#f7f4ee' },
  source: '#e9e6df',
  projection: '#8d8981',
  link: '#1a1a19',
  tick: '#1a1a19',
  node: '#f4f1ea',
  nodeRing: '#1a1a19',
} as const

/** World units of path per generation step. */
export const STEP = 0.03
/** Lines stay inside this half-width, clear of the block's cut edge. */
const REACH = STUDY_HALF * 0.95
/** Spacing of the dense samples a final line is drawn with. */
const DENSE_SPACING = 0.02

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

const distance = (a: Point2, b: Point2) => Math.hypot(b.x - a.x, b.z - a.z)
const inside = (x: number, z: number, reach = REACH) => Math.abs(x) <= reach && Math.abs(z) <= reach

/** Downhill is −gradient; the gradient by central differences of the ground. */
export function gradient(x: number, z: number): [number, number] {
  const e = 0.02
  return [
    (studyHeight(x + e, z) - studyHeight(x - e, z)) / (2 * e),
    (studyHeight(x, z + e) - studyHeight(x, z - e)) / (2 * e),
  ]
}

/** The block's lowest and highest ground, from a regular sample. */
const HEIGHT_RANGE = (() => {
  let low = Infinity
  let high = -Infinity
  const n = 64
  for (let j = 0; j <= n; j += 1) {
    for (let i = 0; i <= n; i += 1) {
      const h = studyHeight(-STUDY_HALF + (2 * STUDY_HALF * i) / n, -STUDY_HALF + (2 * STUDY_HALF * j) / n)
      low = Math.min(low, h)
      high = Math.max(high, h)
    }
  }
  return { low, high }
})()

export const TERRAIN_TOP = HEIGHT_RANGE.high

/** 0 on the block's lowest ground, 1 on its highest. */
const elevation01 = (x: number, z: number) =>
  (studyHeight(x, z) - HEIGHT_RANGE.low) / (HEIGHT_RANGE.high - HEIGHT_RANGE.low)

/** A hash in 0…1 for per-item variety that should not shift the main random sequence. */
const hash = (...values: number[]) => mulberry32(values.reduce((a, v) => Math.imul(a ^ v, 0x9e3779b1) >>> 0, 0x2545f491))()

/**
 * Evenly spread points by best candidate: each new point is the farthest of
 * a few random tries from the points before it. Point k depends only on the
 * ones before, so raising the count only adds points.
 */
function spreadPoints(random: () => number, count: number, reach: number, tries: number): Point2[] {
  const points: Point2[] = []
  for (let k = 0; k < count; k += 1) {
    let best: Point2 = { x: 0, z: 0 }
    let bestDistance = -1
    for (let t = 0; t < tries; t += 1) {
      const candidate = { x: reach * (2 * random() - 1), z: reach * (2 * random() - 1) }
      const nearest = points.reduce((d, p) => Math.min(d, distance(p, candidate)), Infinity)
      if (nearest > bestDistance) {
        best = candidate
        bestDistance = nearest
      }
    }
    points.push(best)
  }
  return points
}

/** Length over the ground along the straight line from a to b. */
function surfaceLength(a: Point2, b: Point2): number {
  const samples = 12
  let total = 0
  let previous = { x: a.x, y: studyHeight(a.x, a.z), z: a.z }
  for (let s = 1; s <= samples; s += 1) {
    const t = s / samples
    const x = a.x + (b.x - a.x) * t
    const z = a.z + (b.z - a.z) * t
    const y = studyHeight(x, z)
    total += Math.hypot(x - previous.x, y - previous.y, z - previous.z)
    previous = { x, y, z }
  }
  return total
}

/** A coarse line through Catmull–Rom, resampled densely; times follow the parameter. */
function smoothLine(line: TimedLine): TimedLine {
  const { points, times } = line
  if (points.length < 2) {
    return line
  }
  const out: Point2[] = []
  const outTimes: number[] = []
  const n = points.length
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[Math.min(n - 1, i + 2)]!
    const m = Math.max(1, Math.ceil(distance(p1, p2) / DENSE_SPACING))
    for (let s = 0; s < m; s += 1) {
      const t = s / m
      const t2 = t * t
      const t3 = t2 * t
      const at = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push({ x: at(p0.x, p1.x, p2.x, p3.x), z: at(p0.z, p1.z, p2.z, p3.z) })
      outTimes.push(times[i]! + (times[i + 1]! - times[i]!) * t)
    }
  }
  out.push(points[n - 1]!)
  outTimes.push(times[n - 1]!)
  return { points: out, times: outTimes, depth: line.depth }
}

const lineLength = (line: TimedLine) =>
  line.points.reduce((sum, p, i) => (i === 0 ? 0 : sum + distance(line.points[i - 1]!, p)), 0)

const lastTime = (lines: readonly TimedLine[]) => lines.reduce((t, line) => Math.max(t, line.times.at(-1) ?? 0), 0)

// ── Connection ───────────────────────────────────────────────────────────────

const NODE_REACH = STUDY_HALF * 0.82
const NODE_TRIES = 12
/** Steps per node appearing, and per link being drawn. */
const NODE_STEPS = 3
const LINK_STEPS = 12
/** Stretch allowed at Directness 1: a link is added unless the network is within 15 % of direct. */
const MIN_STRETCH = 1.15
const STRETCH_SPAN = 1.6
/** Bow of a link at Curvature 1, as a share of its length. */
const MAX_BOW = 0.32

/** The shortest network distance from `from` to `to` (Dijkstra; the networks are small). */
function networkDistance(adjacency: readonly { to: number; cost: number }[][], from: number, to: number): number {
  const best = new Array<number>(adjacency.length).fill(Infinity)
  const done = new Array<boolean>(adjacency.length).fill(false)
  best[from] = 0
  for (;;) {
    let current = -1
    for (let i = 0; i < best.length; i += 1) {
      if (!done[i] && best[i]! < Infinity && (current < 0 || best[i]! < best[current]!)) {
        current = i
      }
    }
    if (current < 0 || current === to) {
      return best[to]!
    }
    done[current] = true
    for (const { to: next, cost } of adjacency[current]!) {
      best[next] = Math.min(best[next]!, best[current]! + cost)
    }
  }
}

/** The stretch a detour may reach before a direct link is added; Infinity keeps a tree. */
export const connectionStretch = (directness: number) =>
  directness <= 0 ? Infinity : MIN_STRETCH + (STRETCH_SPAN * (1 - directness)) / directness

function connection(s: ConnectionSettings): PathStudy {
  const random = mulberry32(s.seed * 7919 + 101)
  const points = spreadPoints(random, s.nodes, NODE_REACH, NODE_TRIES)
  const pairs: { i: number; j: number; cost: number }[] = []
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      pairs.push({ i, j, cost: surfaceLength(points[i]!, points[j]!) })
    }
  }
  pairs.sort((a, b) => a.cost - b.cost)

  // Greedy spanner: shortest candidates first; a link is kept only when the
  // network so far is missing or detours by more than the stretch.
  const stretch = connectionStretch(s.directness)
  const adjacency = points.map((): { to: number; cost: number }[] => [])
  const links: typeof pairs = []
  for (const pair of pairs) {
    const through = networkDistance(adjacency, pair.i, pair.j)
    if (!Number.isFinite(through) || through > stretch * pair.cost) {
      adjacency[pair.i]!.push({ to: pair.j, cost: pair.cost })
      adjacency[pair.j]!.push({ to: pair.i, cost: pair.cost })
      links.push(pair)
    }
  }

  const linksStart = points.length * NODE_STEPS
  const paths: TimedLine[] = []
  const sources: TimedLine[] = []
  links.forEach(({ i, j }, k) => {
    const a = points[i]!
    const b = points[j]!
    const length = distance(a, b)
    const side = hash(s.seed, i, j) < 0.5 ? -1 : 1
    const bow = s.curvature * MAX_BOW * length * side * (0.6 + 0.4 * hash(j, s.seed, i))
    const control = {
      x: (a.x + b.x) / 2 + (-(b.z - a.z) / length) * bow,
      z: (a.z + b.z) / 2 + ((b.x - a.x) / length) * bow,
    }
    const start = linksStart + k * LINK_STEPS
    const m = Math.max(8, Math.ceil(length / DENSE_SPACING))
    const curve: Point2[] = []
    const times: number[] = []
    for (let q = 0; q <= m; q += 1) {
      const t = q / m
      const u = 1 - t
      curve.push({
        x: Math.max(-REACH, Math.min(REACH, u * u * a.x + 2 * u * t * control.x + t * t * b.x)),
        z: Math.max(-REACH, Math.min(REACH, u * u * a.z + 2 * u * t * control.z + t * t * b.z)),
      })
      times.push(start + LINK_STEPS * t)
    }
    paths.push({ points: curve, times, depth: 0 })
    sources.push({ points: [a, b], times: [start, start + LINK_STEPS], depth: 0 })
  })

  const study = {
    method: 'connection' as const,
    paths,
    sources,
    nodes: points.map((p, k): PathNode => ({ ...p, time: k * NODE_STEPS, kind: 'node' })),
    total: linksStart + links.length * LINK_STEPS,
    extra: 0,
  }
  return { ...study, length: paths.reduce((sum, line) => sum + lineLength(line), 0) }
}

// ── Flow ─────────────────────────────────────────────────────────────────────

const SOURCE_REACH = STUDY_HALF * 0.9
/** Candidate sources drawn per path; the highest sloping ones, spaced apart, are tried first. */
const SOURCE_CANDIDATES = 14
const SOURCE_SPACING = 0.45
/** How fast the heading turns downhill at Downhill strength 1, per step. */
const DOWNHILL_TURN = 0.25
/** Gradient at which the downhill pull is full; flatter ground pulls less, so inertia carries on. */
const SLOPE_REF = 0.15
/** The heading swings up to this far either side of its course at Meander 1, radians. */
const MEANDER_ANGLE = 1
/** Meander swings per world unit of path. */
const MEANDER_FREQUENCY = 1.4
/** A path ends when the next step would stand this far above the lowest ground it has reached. */
const POOL_RISE = 0.02
/** …or when it has fallen less than this over its last `STALL_STEPS` steps: it is circling a hollow. */
const STALL_DROP = 0.004
const STALL_STEPS = 10
/**
 * Channel half-width for an accumulated flow: hydraulic geometry, a little
 * faster than √flow, capped. Shared by the merge test and the drawn ribbons.
 */
export const CHANNEL = { halfWidth: 0.058, exponent: 0.6, maxHalfWidth: 0.15 } as const
export const channelHalfWidth = (q: number) => Math.min(CHANNEL.maxHalfWidth, CHANNEL.halfWidth * q ** CHANNEL.exponent)
/**
 * A stream joins a channel once their ribbons would nearly touch: centrelines
 * closer than `share` × their summed half-widths plus `gap`, and never
 * farther than `min` apart without joining.
 */
const MERGE = { share: 1.3, gap: 0.02, min: 0.14 } as const
const MERGE_MAX = MERGE.share * 2 * CHANNEL.maxHalfWidth + MERGE.gap
const GRID_CELL = 0.2
/**
 * A tributary meets its channel `JOIN_AHEAD` × its approach distance
 * downstream, at the first point there no higher than itself, searched up to
 * `JOIN_SEARCH` along: water never climbs to join.
 */
const JOIN_AHEAD = 0.8
const JOIN_SEARCH = 0.45
/**
 * Safety bound on a stream's course, twice across the block. Every stream
 * ends naturally well before it (circling is already caught as a stall); the
 * bound only guards against a pathological trace.
 */
const TRACE_LIMIT = 4 * STUDY_HALF
/** Streams run to the block's cut edge. */
const EDGE = STUDY_HALF - 0.002
/**
 * Shortest isolated stream kept, world units: one that dies in a hollow or
 * runs off the edge sooner is rejected. A tributary needs only to be more
 * than a source sitting on its channel.
 */
const MIN_STREAM = 0.45
const MIN_TRIBUTARY = 2 * STEP

/**
 * Flow accumulation. A source's own flow starts at `start` and grows slowly,
 * linearly to 1 over `growOver`, as its catchment does; a channel carries the
 * sum of every source upstream, so confluences, more than length, widen it.
 * In progressive generation a source's flow reaches a point over `arrival`
 * steps after its water does; below a confluence the joining flow blends in
 * over `joinBlend`.
 */
export const FLOW = { start: 0.35, growOver: 5, arrival: 5, joinBlend: 0.16 } as const

/** 'limit': stopped by the safety bound, which a natural course never reaches. */
export type FlowMouth = 'hollow' | 'edge' | 'limit'
/** A source whose water passes through a reach: its distance to the reach's start, and how far back it entered the reach's channel (Infinity: the channel's own source). */
export type FlowSource = { offset: number; joined: number }
/** A stretch of channel between confluences. Its line in `PathStudy.paths` has the same index. */
export type FlowReach = {
  /** The stream whose course it follows. */
  channel: number
  /** Distance from that stream's source to the reach's start. */
  along: number
  length: number
  /** Reaches that flow into its start. */
  inputs: number[]
  upstream: FlowSource[]
  /** Whether a tributary joins at its start. */
  confluence: boolean
  /** How the network ends here; null where the water flows on. */
  mouth: FlowMouth | null
}
export type FlowNetwork = {
  reaches: FlowReach[]
  streams: number
  confluences: number
  rejected: number
}

/** A source's own flow after running `d`. */
export const sourceFlow = (d: number) => FLOW.start + (1 - FLOW.start) * Math.min(1, d / FLOW.growOver)

/**
 * Accumulated flow `s` along a reach at generation step `time` (Infinity:
 * the finished run). `blend` eases flow joining at a confluence in.
 */
export function reachFlow(reach: FlowReach, s: number, time: number, blend = true): number {
  let q = 0
  for (const { offset, joined } of reach.upstream) {
    const d = offset + s
    const arrived = time === Infinity ? 1 : smoothstep(0, FLOW.arrival, time - d / STEP)
    q += sourceFlow(d) * arrived * (blend ? smoothstep(0, FLOW.joinBlend, joined + s) : 1)
  }
  return q
}

/** A traced stream: it ends in a mouth, or joins `receiver` at one of its points. */
type Channel = {
  points: Point2[]
  heights: number[]
  receiver: { channel: number; index: number } | null
  mouth: FlowMouth | null
  /** Flow gathered at each point so far, for the merge test; set once accepted. */
  flow: number[]
}
type ChannelGrid = Map<number, [number, number][]>

const gridCell = (v: number) => Math.floor(v / GRID_CELL)
const gridKey = (i: number, j: number) => (i + 1024) * 2048 + j + 1024

const polylineLength = (points: readonly Point2[]) =>
  points.reduce((sum, p, i) => (i === 0 ? 0 : sum + distance(points[i - 1]!, p)), 0)

const arcLengthsOf = (points: readonly Point2[]) => {
  const s = [0]
  for (let i = 1; i < points.length; i += 1) {
    s.push(s[i - 1]! + distance(points[i - 1]!, points[i]!))
  }
  return s
}

/** Where on `channel` a stream at height h, `d` from its point k, meets it: the first point a little downstream no higher than the stream; −1 if none. */
function joinTarget(channel: Channel, k: number, d: number, h: number): number {
  const last = channel.points.length - 1
  const from = Math.min(last, k + Math.round((d * JOIN_AHEAD) / STEP))
  const to = Math.max(from, Math.min(last, k + Math.round(JOIN_SEARCH / STEP)))
  for (let j = from; j <= to; j += 1) {
    if (channel.heights[j]! <= h + POOL_RISE) {
      return j
    }
  }
  return -1
}

/** The nearest earlier channel that a stream at `p` (height h, flow q) reaches, and where it joins it. */
function findJoin(
  p: Point2,
  h: number,
  q: number,
  channels: readonly Channel[],
  grid: ChannelGrid,
): { channel: number; index: number } | null {
  const halfWidth = channelHalfWidth(q)
  const range = Math.ceil(MERGE_MAX / GRID_CELL)
  const ci = gridCell(p.x)
  const cj = gridCell(p.z)
  let best: { channel: number; index: number } | null = null
  let bestDistance = Infinity
  for (let j = -range; j <= range; j += 1) {
    for (let i = -range; i <= range; i += 1) {
      for (const [c, k] of grid.get(gridKey(ci + i, cj + j)) ?? []) {
        const channel = channels[c]!
        const d = distance(p, channel.points[k]!)
        const reach = Math.max(MERGE.min, MERGE.share * (halfWidth + channelHalfWidth(channel.flow[k]!)) + MERGE.gap)
        if (d >= reach || d >= bestDistance) {
          continue
        }
        const index = joinTarget(channel, k, d, h)
        if (index >= 0) {
          best = { channel: c, index }
          bestDistance = d
        }
      }
    }
  }
  return best
}

/** From p, curving off its heading onto the target: points about a step apart, ending exactly on it. */
function joinCurve(p: Point2, dx: number, dz: number, target: Point2): Point2[] {
  const chord = distance(p, target)
  if (chord < 1e-4) {
    return []
  }
  // Bend along the heading only while it points toward the target; otherwise run straight in.
  const toward = Math.max(0, (dx * (target.x - p.x) + dz * (target.z - p.z)) / chord)
  const control = { x: p.x + dx * chord * 0.5 * toward, z: p.z + dz * chord * 0.5 * toward }
  const n = Math.max(1, Math.ceil((chord * 1.15) / STEP))
  return Array.from({ length: n }, (_, q) => {
    if (q === n - 1) {
      return target
    }
    const t = (q + 1) / n
    const u = 1 - t
    return { x: u * u * p.x + 2 * u * t * control.x + t * t * target.x, z: u * u * p.z + 2 * u * t * control.z + t * t * target.z }
  })
}

/**
 * One stream: steps downhill from its source until it meets an earlier
 * channel and joins it, pools in a hollow, or leaves the block, following
 * Downhill strength and Meander the whole way.
 */
function traceStream(source: Point2, salt: number, s: FlowSettings, channels: readonly Channel[], grid: ChannelGrid): Channel {
  const limit = Math.round(TRACE_LIMIT / STEP)
  const [gx, gz] = gradient(source.x, source.z)
  const slope = Math.hypot(gx, gz)
  const angle = hash(s.seed, salt) * 2 * Math.PI
  let dx = slope > 1e-6 ? -gx / slope : Math.cos(angle)
  let dz = slope > 1e-6 ? -gz / slope : Math.sin(angle)
  let p = source
  let lowest = studyHeight(p.x, p.z)
  let travelled = 0
  const points = [p]
  const heights = [lowest]
  const end = (mouth: FlowMouth): Channel => {
    if (mouth === 'hollow') {
      // Pool at the bottom of the hollow, not partway up its far side.
      const bottom = heights.lastIndexOf(Math.min(...heights)) + 1
      points.length = bottom
      heights.length = bottom
    }
    return { points, heights, receiver: null, mouth, flow: [] }
  }
  const join = (): Channel | null => {
    const receiver = findJoin(p, heights.at(-1)!, sourceFlow(travelled), channels, grid)
    if (!receiver) {
      return null
    }
    for (const q of joinCurve(p, dx, dz, channels[receiver.channel]!.points[receiver.index]!)) {
      points.push(q)
      heights.push(studyHeight(q.x, q.z))
    }
    return { points, heights, receiver, mouth: null, flow: [] }
  }

  const atSource = join()
  if (atSource) {
    return atSource
  }
  for (let k = 1; k <= limit; k += 1) {
    const [hx, hz] = gradient(p.x, p.z)
    const fall = Math.hypot(hx, hz)
    if (fall > 1e-6) {
      const pull = s.downhill * DOWNHILL_TURN * smoothstep(0, SLOPE_REF, fall)
      dx += (-hx / fall) * pull
      dz += (-hz / fall) * pull
      const norm = Math.hypot(dx, dz)
      dx /= norm
      dz /= norm
    }
    // Meander swings the step either side of the course, without turning the course itself.
    const swing = s.meander * MEANDER_ANGLE * simplex2(k * STEP * MEANDER_FREQUENCY, salt * 7.31 + s.seed * 0.13)
    const cos = Math.cos(swing)
    const sin = Math.sin(swing)
    let next = { x: p.x + (dx * cos - dz * sin) * STEP, z: p.z + (dx * sin + dz * cos) * STEP }
    // Water cannot climb: where its step would, it turns straight downhill, and pools only if that climbs too.
    if (fall > 1e-6 && studyHeight(next.x, next.z) > lowest + POOL_RISE) {
      const down = { x: p.x - (hx / fall) * STEP, z: p.z - (hz / fall) * STEP }
      if (studyHeight(down.x, down.z) <= lowest + POOL_RISE) {
        next = down
        dx = -hx / fall
        dz = -hz / fall
      }
    }
    if (Math.abs(next.x) > EDGE || Math.abs(next.z) > EDGE) {
      // Run out to the cut edge itself.
      let t = 1
      for (const [a, b] of [
        [p.x, next.x],
        [p.z, next.z],
      ] as const) {
        if (Math.abs(b) > EDGE) {
          t = Math.min(t, (Math.sign(b) * EDGE - a) / (b - a))
        }
      }
      if (t * STEP > 1e-4) {
        const q = { x: p.x + (next.x - p.x) * t, z: p.z + (next.z - p.z) * t }
        points.push(q)
        heights.push(studyHeight(q.x, q.z))
      }
      return end('edge')
    }
    const h = studyHeight(next.x, next.z)
    const stalled = heights.length > STALL_STEPS && heights.at(-STALL_STEPS - 1)! - h < STALL_DROP
    if (h > lowest + POOL_RISE || stalled) {
      return end('hollow')
    }
    lowest = Math.min(lowest, h)
    p = next
    travelled += STEP
    points.push(p)
    heights.push(h)
    const joined = join()
    if (joined) {
      return joined
    }
  }
  return end('limit')
}

/**
 * Splits the streams into reaches at their confluences and sums the flow
 * through each. A tributary is traced after its receiver, so working from
 * the last stream back meets every input before the reach it feeds.
 */
function drainageNetwork(channels: readonly Channel[]): { reaches: FlowReach[]; lines: TimedLine[] } {
  const cuts = channels.map((channel) => new Set([0, channel.points.length - 1]))
  const tributaries = channels.map(() => new Map<number, number[]>())
  channels.forEach((channel, t) => {
    if (channel.receiver) {
      const { channel: c, index } = channel.receiver
      cuts[c]!.add(index)
      tributaries[c]!.set(index, [...(tributaries[c]!.get(index) ?? []), t])
    }
  })

  const reaches: FlowReach[] = []
  const lines: TimedLine[] = []
  const finalReach: number[] = []
  for (let c = channels.length - 1; c >= 0; c -= 1) {
    const channel = channels[c]!
    const last = channel.points.length - 1
    const marks = [...cuts[c]!].sort((a, b) => a - b)
    const ranges = marks.slice(0, -1).map((a, k): [number, number] => [a, marks[k + 1]!])
    // Tributaries that join at the very end meet in a reach of one point: the pool they share.
    if (tributaries[c]!.has(last)) {
      ranges.push([last, last])
    }
    let previous = -1
    ranges.forEach(([a, b], r) => {
      const points = channel.points.slice(a, b + 1)
      const s = arcLengthsOf(points)
      const inputs: number[] = []
      const upstream: FlowSource[] = []
      let along = 0
      if (previous < 0) {
        upstream.push({ offset: 0, joined: Infinity })
      } else {
        const before = reaches[previous]!
        inputs.push(previous)
        along = before.along + before.length
        upstream.push(...before.upstream.map((u) => ({ offset: u.offset + before.length, joined: u.joined + before.length })))
      }
      const joining = tributaries[c]!.get(a) ?? []
      for (const t of joining) {
        const input = reaches[finalReach[t]!]!
        inputs.push(finalReach[t]!)
        upstream.push(...input.upstream.map((u) => ({ offset: u.offset + input.length, joined: 0 })))
      }
      const start = Math.min(...upstream.map((u) => u.offset))
      reaches.push({
        channel: c,
        along,
        length: s.at(-1)!,
        inputs,
        upstream,
        confluence: joining.length > 0,
        mouth: r === ranges.length - 1 && !channel.receiver ? channel.mouth : null,
      })
      lines.push({ points, times: s.map((v) => (start + v) / STEP), depth: 0 })
      previous = reaches.length - 1
    })
    finalReach[c] = previous
  }
  return { reaches, lines }
}

function flow(s: FlowSettings): PathStudy {
  const random = mulberry32(s.seed * 7919 + 202)
  // High ground that falls away: level tops would hold a source in place.
  const candidates = Array.from({ length: s.count * SOURCE_CANDIDATES }, () => {
    const p = { x: SOURCE_REACH * (2 * random() - 1), z: SOURCE_REACH * (2 * random() - 1) }
    const [gx, gz] = gradient(p.x, p.z)
    return { ...p, score: elevation01(p.x, p.z) * (0.25 + 0.75 * smoothstep(0, SLOPE_REF, Math.hypot(gx, gz))) }
  }).sort((a, b) => b.score - a.score)

  // Highest first, each stream traced against those before it: it joins the
  // first it reaches, however soon. Only an isolated stream that dies within
  // a few steps is rejected.
  const channels: Channel[] = []
  const grid: ChannelGrid = new Map()
  const tried = new Set<number>()
  let rejected = 0
  for (let spacing = SOURCE_SPACING; channels.length < s.count && spacing > 0.01; spacing /= 2) {
    candidates.forEach((candidate, n) => {
      if (
        channels.length >= s.count ||
        tried.has(n) ||
        !channels.every((channel) => distance(channel.points[0]!, candidate) >= spacing)
      ) {
        return
      }
      tried.add(n)
      const channel = traceStream({ x: candidate.x, z: candidate.z }, channels.length, s, channels, grid)
      const own = polylineLength(channel.points)
      if (own < (channel.receiver ? MIN_TRIBUTARY : MIN_STREAM)) {
        rejected += 1
        return
      }
      channel.flow = arcLengthsOf(channel.points).map(sourceFlow)
      channel.points.forEach((p, k) => {
        const key = gridKey(gridCell(p.x), gridCell(p.z))
        grid.set(key, [...(grid.get(key) ?? []), [channels.length, k]])
      })
      channels.push(channel)
      // Its flow joins every channel downstream of where it meets the network.
      const gathered = channel.flow.at(-1)!
      for (let at = channel.receiver; at; at = channels[at.channel]!.receiver) {
        const downstream = channels[at.channel]!.flow
        for (let k = at.index; k < downstream.length; k += 1) {
          downstream[k]! += gathered
        }
      }
    })
  }

  const { reaches, lines } = drainageNetwork(channels)
  const nodes: PathNode[] = channels.map((channel) => ({ ...channel.points[0]!, time: 0, kind: 'source' }))
  reaches.forEach((reach, r) => {
    const line = lines[r]!
    if (reach.confluence) {
      nodes.push({ ...line.points[0]!, time: line.times[0]!, kind: 'confluence' })
    }
    if (reach.mouth) {
      nodes.push({ ...line.points.at(-1)!, time: line.times.at(-1)!, kind: 'end' })
    }
  })
  const confluences = reaches.filter((reach) => reach.confluence).length
  return {
    method: 'flow',
    paths: lines,
    sources: [],
    nodes,
    // The run lasts until the last source's water has fully arrived, so it ends on the finished widths.
    total: reaches.reduce((t, reach) => Math.max(t, (reach.length + Math.max(...reach.upstream.map((u) => u.offset))) / STEP), 0) + FLOW.arrival,
    length: reaches.reduce((sum, reach) => sum + reach.length, 0),
    extra: confluences,
    network: {
      reaches,
      streams: channels.length,
      confluences,
      rejected,
    },
  }
}

// ── Growth ───────────────────────────────────────────────────────────────────

const ANCHOR_REACH = STUDY_HALF * 0.7
const ANCHOR_TRIES = 10
/** Length of one growth step in the 2D plane; the spline is drawn through these points. */
export const GROW_STEP = 0.09
/** Heading turn per step at Drift 1, radians, scaled by coherent noise along the path. */
const DRIFT_TURN = 0.4
/** Drift changes direction about this often per world unit. */
const DRIFT_FREQUENCY = 0.9
/** Within this distance of the edge, the heading bends back toward the block. */
const RIM_STEER = 0.35
const RIM_TURN = 0.35
/** Branch chance per step at Branch probability 1. */
const BRANCH_RATE = 0.16
const BRANCH_ANGLE = { min: 0.45, span: 0.5 } as const
/** A branch takes this share of its parent's remaining length. */
const BRANCH_SHARE = 0.6
const MAX_DEPTH = 2
const MAX_BRANCHES = 48
const MIN_BRANCH_STEPS = 4

type Tip = { x: number; z: number; heading: number; steps: number; depth: number; time: number; salt: number }

function growth(s: GrowthSettings): PathStudy {
  const random = mulberry32(s.seed * 7919 + 303)
  const anchors = spreadPoints(random, s.count, ANCHOR_REACH, ANCHOR_TRIES)
  const steps = Math.round(s.length / GROW_STEP)
  const queue: Tip[] = anchors.map((a, i) => ({ ...a, heading: random() * 2 * Math.PI, steps, depth: 0, time: 0, salt: i + 1 }))
  const stepTime = GROW_STEP / STEP
  const sources: TimedLine[] = []
  let salt = queue.length
  let branches = 0

  // Tips are grown one after another in a fixed order, each drawing the same
  // random numbers per step whatever happens, so the run is reproducible.
  for (let tip = queue.shift(); tip; tip = queue.shift()) {
    let { x, z, heading, time } = tip
    const points: Point2[] = [{ x, z }]
    const times = [time]
    for (let k = 1; k <= tip.steps; k += 1) {
      heading += s.drift * DRIFT_TURN * simplex2(k * GROW_STEP * DRIFT_FREQUENCY + tip.salt * 7.1, tip.salt * 3.3)
      const rim = REACH - Math.max(Math.abs(x), Math.abs(z))
      if (rim < RIM_STEER) {
        const inward = Math.atan2(-z, -x)
        const offset = Math.atan2(Math.sin(inward - heading), Math.cos(inward - heading))
        heading += offset * RIM_TURN * (1 - rim / RIM_STEER)
      }
      const nx = x + Math.cos(heading) * GROW_STEP
      const nz = z + Math.sin(heading) * GROW_STEP
      const roll = random()
      const side = random()
      if (!inside(nx, nz)) {
        break
      }
      x = nx
      z = nz
      time += stepTime
      points.push({ x, z })
      times.push(time)
      const left = tip.steps - k
      if (
        roll < s.branching * BRANCH_RATE &&
        tip.depth < MAX_DEPTH &&
        branches < MAX_BRANCHES &&
        left * BRANCH_SHARE >= MIN_BRANCH_STEPS
      ) {
        const turn = (side < 0.5 ? -1 : 1) * (BRANCH_ANGLE.min + BRANCH_ANGLE.span * ((side * 2) % 1))
        salt += 1
        branches += 1
        queue.push({ x, z, heading: heading + turn, steps: Math.round(left * BRANCH_SHARE), depth: tip.depth + 1, time, salt })
      }
    }
    if (points.length > 1) {
      sources.push({ points, times, depth: tip.depth })
    }
  }

  const paths = sources.map(smoothLine)
  return {
    method: 'growth',
    paths,
    sources,
    nodes: anchors.map((p): PathNode => ({ ...p, time: 0, kind: 'anchor' })),
    total: lastTime(paths),
    length: paths.reduce((sum, line) => sum + lineLength(line), 0),
    extra: branches,
  }
}

export function generatePaths(method: PathMethod, settings: PathSettingsMap): PathStudy {
  switch (method) {
    case 'connection':
      return connection(settings.connection)
    case 'flow':
      return flow(settings.flow)
    case 'growth':
      return growth(settings.growth)
  }
}

/** The part of a line that has appeared by `time`, ending at an interpolated tip; null before it starts. */
export function revealLine(line: TimedLine, time: number): Point2[] | null {
  const { points, times } = line
  if (time >= times.at(-1)!) {
    return points
  }
  if (time <= times[0]!) {
    return null
  }
  const out: Point2[] = []
  for (let i = 0; i < points.length; i += 1) {
    if (times[i]! <= time) {
      out.push(points[i]!)
      continue
    }
    const t = (time - times[i - 1]!) / (times[i]! - times[i - 1]!)
    const a = points[i - 1]!
    const b = points[i]!
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })
    break
  }
  return out.length > 1 ? out : null
}

// ── Spline ↔ mesh: a shallow imprint ─────────────────────────────────────────

/** Half-width of the groove a line presses into the ground. */
export const IMPRINT_RADIUS = 0.06
/** A low shoulder either side of the groove, as a share of its depth. */
const BERM = { at: 1.3, width: 0.6, height: 0.3 } as const
const IMPRINT_REACH = IMPRINT_RADIUS * (BERM.at + BERM.width)
export const IMPRINT_DEPTH = { min: 0.005, max: 0.05, step: 0.005, default: 0.02 } as const

const bump = (u: number) => (u < 1 ? 0.5 * (1 + Math.cos(Math.PI * u)) : 0)

/**
 * The ground's offset under a set of lines: a soft groove `depth` deep along
 * each, with a low shoulder either side, read from the distance to the
 * nearest line. Overlapping lines take the nearest, so crossings do not dig
 * deeper.
 */
export function createImprint(lines: readonly (readonly Point2[])[], depth: number): (x: number, z: number) => number {
  const cell = IMPRINT_REACH
  const key = (i: number, j: number) => (i + 1024) * 2048 + j + 1024
  const buckets = new Map<number, [Point2, Point2][]>()
  for (const line of lines) {
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1]!
      const b = line[i]!
      const i0 = Math.floor((Math.min(a.x, b.x) - cell) / cell)
      const i1 = Math.floor((Math.max(a.x, b.x) + cell) / cell)
      const j0 = Math.floor((Math.min(a.z, b.z) - cell) / cell)
      const j1 = Math.floor((Math.max(a.z, b.z) + cell) / cell)
      for (let j = j0; j <= j1; j += 1) {
        for (let k = i0; k <= i1; k += 1) {
          const list = buckets.get(key(k, j)) ?? []
          list.push([a, b])
          buckets.set(key(k, j), list)
        }
      }
    }
  }
  return (x, z) => {
    const segments = buckets.get(key(Math.floor(x / cell), Math.floor(z / cell)))
    if (!segments) {
      return 0
    }
    let nearest = Infinity
    for (const [a, b] of segments) {
      const lx = b.x - a.x
      const lz = b.z - a.z
      const t = Math.min(1, Math.max(0, ((x - a.x) * lx + (z - a.z) * lz) / (lx * lx + lz * lz || 1)))
      nearest = Math.min(nearest, Math.hypot(x - a.x - t * lx, z - a.z - t * lz))
    }
    const groove = bump(nearest / IMPRINT_RADIUS)
    const shoulder = bump(Math.abs(nearest / IMPRINT_RADIUS - BERM.at) / BERM.width)
    return depth * (BERM.height * shoulder - groove)
  }
}

/** Downhill ticks on a regular grid for the Flow analysis: direction and steepness. */
export function downhillField(resolution: number): { x: number; z: number; dx: number; dz: number; slope: number }[] {
  const ticks = []
  const reach = STUDY_HALF * 0.94
  for (let j = 0; j < resolution; j += 1) {
    for (let i = 0; i < resolution; i += 1) {
      const x = -reach + ((i + 0.5) * 2 * reach) / resolution
      const z = -reach + ((j + 0.5) * 2 * reach) / resolution
      const [gx, gz] = gradient(x, z)
      const slope = Math.hypot(gx, gz)
      if (slope > 1e-4) {
        ticks.push({ x, z, dx: -gx / slope, dz: -gz / slope, slope })
      }
    }
  }
  return ticks
}
