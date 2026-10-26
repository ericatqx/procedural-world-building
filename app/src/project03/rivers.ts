import { BufferAttribute, BufferGeometry } from 'three'
import { smoothstep } from '../project02/core.ts'
import { LANDFORM_02 } from '../project02/landform.ts'
import { ISLAND_METERS_PER_UNIT, LANDSCAPE, islandRadius, landscapeHeight, type TerrainCarve } from './terrain.ts'
import { flood, type FloodTrace, type WaterSystem } from './water.ts'

/**
 * Shadow Ecology 0.3 — rivers, in meters.
 *
 * Read from the same ground the lakes are: the island is flooded once on a
 * coarse grid, every cell drains to the neighbour it was reached from, and the
 * cells that gather enough ground become streams. A stream starts where the
 * catchment is large enough, runs the way the ground drains, leaves a lake at
 * its outlet or ends in one, joins a larger stream, or runs to the island's rim.
 *
 * Width follows the catchment (hydraulic geometry, as in Week 06's flow study).
 * Each stream is cut into the ground: its surface never rises downstream and
 * never stands above its own banks, and the channel is lowered to meet it, so
 * the water sits in the land rather than on it. Pure function of the seed.
 */
/** `fall` is how steep the bed is here, 0 (flat water) to 1 (a cascade down bare rock). */
export type RiverNode = { x: number; z: number; level: number; halfWidth: number; depth: number; fall?: number }
/** Where a river leaves the island: the lip, the direction away from the land, and the width it pours at. */
export type RimFall = { x: number; z: number; level: number; halfWidth: number; outX: number; outZ: number }
/** A free fall inland: the water leaves the node `from` and lands in the channel at node `to`. */
export type Plunge = { from: number; to: number; /** Last node of the lowered plateau below. */ end: number; /** Channel surface above the wall, and below it, in meters. */ above: number; below: number }
export type River = { nodes: RiverNode[]; flow: number; rim: RimFall | null; plunge: Plunge | null }
export type RiverSystem = { rivers: River[]; carve: TerrainCarve | null }

const CELL = 16
/** Cells this close to the outline drain over the rim, so streams end there. */
const RIM_SINK = 36
/** Catchment, in m², that makes a stream; a smaller one is a trickle and not drawn. */
const STREAM_AREA = 120_000
/** A stream that only joins another must gather more, so tributaries stay few. */
const TRIBUTARY_AREA = 400_000
const MIN_CELLS = 16
const MIN_LAKE_CELLS = 10
const MAX_RIVERS = 8
const SUBDIVISIONS = 4
const HALF_WIDTH = { scale: 0.0036, exponent: 0.6, min: 4.5, max: 16 }
/** Channel depth below the surface at the centre, in meters. */
const depthFor = (halfWidth: number) => 0.7 + 0.1 * halfWidth
/** Beyond the water's edge the ground is cut back on this slope, to meet the bank. */
const BANK_SLOPE = 0.45
const BANK_BLEND = { start: 8, length: 64 }
/**
 * Steep water, read from the riverbed's own drops between nodes (about 4 m apart). A bed
 * that falls faster than `CASCADE_FROM` per meter is a cascade over rock (full from
 * `CASCADE_FULL`). Where the bed already drops fastest, `shapeKnickpoints` turns the descent
 * into a step: the channel above holds level, drops once, and holds level again below.
 */
const CASCADE_FROM = 0.3
const CASCADE_FULL = 0.8
/**
 * Inland falls (steps cut into the bed, walls, plunge pools and their sheets) are switched off for now:
 * with this off no river is shaped, so every bed and surface runs smoothly downhill as the routing left it.
 * The implementation stays for reuse; turn this on to bring it back.
 */
export const INLAND_FALLS = false
/** Steps: one prominent fall per island aims this tall, the smaller ones this tall; none is worth less than `STEP_MIN`. */
const STEP_MAJOR = 22
const STEP_MINOR = 10
const STEP_MIN = 7
const MAX_MINOR = 2
/** Nodes to keep clear at both ends of a river: it needs water above it, and a channel below to land in. */
const STEP_MARGIN = 10
/** Half-width in meters over which the wall is blended; the terrain mesh's own spacing decides how sharp it reads. */
const WALL_BLEND = 3
const MAX_RIM_FALLS = 2
/** A rim fall pours down part of the cliff face at its lip: about half of it, between these bounds, in meters. */
const RIM_FALL = { min: 90, max: 200 }
function rimFallHeight(lip: RimFall) {
  const face = LANDFORM_02.cliffDepth(Math.atan2(lip.z, lip.x)) * ISLAND_METERS_PER_UNIT
  return Math.max(RIM_FALL.min, Math.min(RIM_FALL.max, face * 0.5))
}
const BUCKET = 48

const halfWidthFor = (area: number) => Math.max(HALF_WIDTH.min, Math.min(HALF_WIDTH.max, HALF_WIDTH.scale * area ** HALF_WIDTH.exponent))

const NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
]

type Reach = { cells: number[]; end: 'lake' | 'sink' | 'join'; flow: number }

export function createRivers(water: WaterSystem): RiverSystem {
  const half = LANDSCAPE.size * 0.5
  const n = LANDSCAPE.size / CELL
  const total = n * n
  const heights = new Float32Array(total)
  const sink = new Uint8Array(total)
  const skip = new Uint8Array(total)
  const lake = new Uint8Array(total)
  const lakeLevel = new Float32Array(total)
  const at = (i: number) => -half + (i + 0.5) * CELL
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const index = j * n + i
      const x = at(i)
      const z = at(j)
      const reach = islandRadius(Math.atan2(z, x))
      const r = Math.hypot(x, z)
      if (r > reach + CELL) {
        skip[index] = 1
        continue
      }
      heights[index] = landscapeHeight(x, z)
      if (r > reach - RIM_SINK) sink[index] = 1
      const surface = water.surfaceAt(x, z)
      if (surface !== null) {
        lake[index] = 1
        lakeLevel[index] = surface
      }
    }
  }
  const accumulation = new Float32Array(total)
  const trace: FloodTrace = { down: new Int32Array(0), order: [] }
  flood(heights, sink, n, n, skip, accumulation, trace)
  const { down, order } = trace
  const area = (cell: number) => accumulation[cell]! * CELL * CELL

  const stream = new Uint8Array(total)
  for (let c = 0; c < total; c += 1) {
    if (skip[c] || sink[c] || lake[c]) continue
    if (area(c) >= STREAM_AREA) stream[c] = 1
  }
  const upstream = new Int32Array(total)
  for (let c = 0; c < total; c += 1) {
    if (!stream[c]) continue
    const d = down[c]!
    if (d >= 0 && stream[d]) upstream[d]! += 1
  }

  // Follow each head downstream. The longest, largest course claims a shared stretch first.
  const walk = (head: number): Reach => {
    const cells = [head]
    let cur = head
    for (;;) {
      const d = down[cur]!
      if (d < 0) return { cells, end: 'sink', flow: area(cur) }
      if (stream[d]) {
        cells.push(d)
        cur = d
        continue
      }
      if (lake[d]) {
        cells.push(d)
        return { cells, end: 'lake', flow: area(cur) }
      }
      if (!skip[d]) cells.push(d)
      return { cells, end: 'sink', flow: area(cur) }
    }
  }
  const courses: Reach[] = []
  for (let c = 0; c < total; c += 1) if (stream[c] && upstream[c] === 0) courses.push(walk(c))
  courses.sort((a, b) => b.flow - a.flow || b.cells.length - a.cells.length || a.cells[0]! - b.cells[0]!)

  // A stream that leaves a lake is kept even when it is short: the lake is its source.
  const leavesLake = new Uint8Array(total)
  for (let c = 0; c < total; c += 1) {
    if (!lake[c]) continue
    const d = down[c]!
    if (d >= 0) leavesLake[d] = 1
  }
  const claimed = new Int32Array(total).fill(-1)
  const neighborClaimed = (cell: number, previous: number): number => {
    const ci = cell % n
    const cj = (cell - ci) / n
    for (const [dx, dz] of NEIGHBORS) {
      const ni = ci + dx
      const nj = cj + dz
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue
      const other = nj * n + ni
      if (other !== previous && claimed[other]! >= 0) return other
    }
    return -1
  }
  const reaches: Reach[] = []
  for (const course of courses) {
    if (reaches.length >= MAX_RIVERS) break
    const cells: number[] = []
    let joined = false
    for (const cell of course.cells) {
      if (claimed[cell]! >= 0) {
        cells.push(cell)
        joined = true
        break
      }
      // Running right beside another stream is joining it, not a second channel.
      const beside = cells.length > 2 ? neighborClaimed(cell, cells[cells.length - 1]!) : -1
      if (beside >= 0) {
        cells.push(cell, beside)
        joined = true
        break
      }
      cells.push(cell)
    }
    const own = cells.filter((cell) => stream[cell]).length
    const end = joined ? 'join' : course.end
    if (own < (leavesLake[course.cells[0]!] ? MIN_LAKE_CELLS : MIN_CELLS)) continue
    if (end === 'join' && course.flow < TRIBUTARY_AREA) continue
    const index = reaches.length
    reaches.push({ cells, end, flow: course.flow })
    for (const cell of cells) if (claimed[cell]! < 0 && stream[cell]) claimed[cell] = index
  }

  // Levels, upstream first: never above the banks, never above what flows in, a lake's surface at its outlet.
  const accepted = new Uint8Array(total)
  for (const reach of reaches) for (const cell of reach.cells) if (stream[cell]) accepted[cell] = 1
  const levelOf = new Float32Array(total).fill(Number.POSITIVE_INFINITY)
  const halfAt = new Float32Array(total)
  const fed = new Float32Array(total).fill(Number.POSITIVE_INFINITY)
  for (let c = 0; c < total; c += 1) {
    if (!lake[c]) continue
    const d = down[c]!
    if (d >= 0 && accepted[d]) fed[d] = Math.min(fed[d]!, lakeLevel[c]!)
  }
  for (let k = order.length - 1; k >= 0; k -= 1) {
    const c = order[k]!
    if (!accepted[c]) continue
    const d = down[c]!
    const hw = halfWidthFor(area(c))
    halfAt[c] = hw
    const x = at(c % n)
    const z = at((c - (c % n)) / n)
    let dx = 0
    let dz = 1
    if (d >= 0) {
      dx = at(d % n) - x
      dz = at((d - (d % n)) / n) - z
      const len = Math.hypot(dx, dz) || 1
      dx /= len
      dz /= len
    }
    const reach = hw * 1.1
    const bank = Math.min(landscapeHeight(x - dz * reach, z + dx * reach), landscapeHeight(x + dz * reach, z - dx * reach))
    levelOf[c] = Math.min(levelOf[c]!, bank - 0.2, fed[c]!)
    if (d >= 0 && accepted[d]) levelOf[d] = Math.min(levelOf[d]!, levelOf[c]!)
  }

  const rivers: River[] = []
  const toRim: River[] = []
  for (const reach of reaches) {
    const control: RiverNode[] = []
    const cells = reach.cells
    for (let k = 0; k < cells.length; k += 1) {
      const cell = cells[k]!
      const x = at(cell % n)
      const z = at((cell - (cell % n)) / n)
      if (stream[cell]) {
        const hw = halfAt[cell]!
        control.push({ x, z, level: levelOf[cell]!, halfWidth: hw, depth: depthFor(hw) })
      } else if (lake[cell] && control.length > 0) {
        // Ends on the shore: the lake takes the surface from here.
        const last = control[control.length - 1]!
        const lakeSurface = lakeLevel[cell]!
        control.push({ x: (x + last.x) * 0.5, z: (z + last.z) * 0.5, level: Math.min(last.level, lakeSurface), halfWidth: last.halfWidth, depth: last.depth })
      } else if (control.length > 0) {
        const last = control[control.length - 1]!
        control.push({ x, z, level: last.level, halfWidth: last.halfWidth * (reach.end === 'sink' ? 1 : 0.6), depth: last.depth * (reach.end === 'sink' ? 1 : 0.6) })
      }
    }
    if (control.length < 3) continue
    // Sources start narrow and open out; an outlet leaves its lake at the width the catchment gives it, with no pinch.
    const lead = Math.min(8, control.length)
    const fedByLake = fed[cells[0]!]! < Number.POSITIVE_INFINITY
    for (let k = 0; k < lead && !fedByLake; k += 1) {
      const node = control[k]!
      const t = 0.3 + 0.7 * smoothstep(0, lead, k)
      node.halfWidth *= t
      node.depth *= t
    }
    const nodes = seat(subdivide(control))
    smoothWidth(nodes)
    rivers.push({ nodes, flow: reach.flow, rim: null, plunge: null })
    if (reach.end === 'sink') toRim.push(rivers[rivers.length - 1]!)
  }
  // The largest of the rivers that run out at the rim pour over it; the rest end in a narrowing thread.
  toRim.sort((a, b) => b.flow - a.flow)
  toRim.forEach((river, index) => {
    if (index < MAX_RIM_FALLS) river.rim = extendToRim(river.nodes)
    else taperEnd(river.nodes)
  })
  shapeKnickpoints(rivers)
  markFalls(rivers)
  return { rivers, carve: rivers.length > 0 ? buildCarve(rivers) : null }
}

/** Catmull–Rom through the control nodes; level, width and depth follow linearly, so the surface stays monotone. */
function subdivide(control: RiverNode[]): RiverNode[] {
  const out: RiverNode[] = []
  const last = control.length - 1
  for (let k = 0; k < last; k += 1) {
    const p0 = control[Math.max(0, k - 1)]!
    const p1 = control[k]!
    const p2 = control[k + 1]!
    const p3 = control[Math.min(last, k + 2)]!
    for (let s = 0; s < SUBDIVISIONS; s += 1) {
      const t = s / SUBDIVISIONS
      const t2 = t * t
      const t3 = t2 * t
      const spline = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push({
        x: spline(p0.x, p1.x, p2.x, p3.x),
        z: spline(p0.z, p1.z, p2.z, p3.z),
        level: p1.level + (p2.level - p1.level) * t,
        halfWidth: p1.halfWidth + (p2.halfWidth - p1.halfWidth) * t,
        depth: p1.depth + (p2.depth - p1.depth) * t,
      })
    }
  }
  out.push(control[last]!)
  return out
}

/** Between the control nodes the curve can stray from the thalweg: lower the surface wherever a bank would otherwise stand below it. */
function seat(nodes: RiverNode[]): RiverNode[] {
  for (let k = 0; k < nodes.length; k += 1) {
    const node = nodes[k]!
    const prev = nodes[Math.max(0, k - 1)]!
    const next = nodes[Math.min(nodes.length - 1, k + 1)]!
    let tx = next.x - prev.x
    let tz = next.z - prev.z
    const len = Math.hypot(tx, tz) || 1
    tx /= len
    tz /= len
    const reach = node.halfWidth * 1.15
    const bank = Math.min(landscapeHeight(node.x - tz * reach, node.z + tx * reach), landscapeHeight(node.x + tz * reach, node.z - tx * reach))
    node.level = Math.min(node.level, bank - 0.2)
    if (k > 0) node.level = Math.min(node.level, prev.level)
  }
  return nodes
}

/** Widths change slowly along a river, so no bank steps out between two nodes. */
function smoothWidth(nodes: RiverNode[]) {
  for (let pass = 0; pass < 3; pass += 1) {
    const width = nodes.map((node) => node.halfWidth)
    for (let k = 1; k < nodes.length - 1; k += 1) {
      let sum = 0
      let count = 0
      for (let d = -3; d <= 3; d += 1) {
        const j = Math.max(0, Math.min(nodes.length - 1, k + d))
        sum += width[j]!
        count += 1
      }
      nodes[k]!.halfWidth = sum / count
      nodes[k]!.depth = depthFor(nodes[k]!.halfWidth)
    }
  }
}

function taperEnd(nodes: RiverNode[]) {
  const span = Math.min(8, nodes.length - 1)
  for (let k = 0; k < span; k += 1) {
    const node = nodes[nodes.length - 1 - k]!
    const t = 0.35 + 0.65 * smoothstep(0, span, k)
    node.halfWidth *= t
    node.depth *= t
  }
}

/** Carries a river on to the island's lip, down the ground as it falls away, ready to pour over. */
function extendToRim(nodes: RiverNode[]): RimFall | null {
  const last = nodes[nodes.length - 1]!
  const before = nodes[Math.max(0, nodes.length - 5)]!
  let hx = last.x - before.x
  let hz = last.z - before.z
  const hl = Math.hypot(hx, hz) || 1
  hx /= hl
  hz /= hl
  let x = last.x
  let z = last.z
  let level = last.level
  for (let step = 0; step < 40; step += 1) {
    const r = Math.hypot(x, z)
    const reach = islandRadius(Math.atan2(z, x))
    if (r >= reach - 3) break
    hx = hx * 0.85 + (x / r) * 0.15
    hz = hz * 0.85 + (z / r) * 0.15
    const len = Math.hypot(hx, hz) || 1
    hx /= len
    hz /= len
    x += hx * 4
    z += hz * 4
    const bankReach = last.halfWidth * 1.15
    const bank = Math.min(landscapeHeight(x - hz * bankReach, z + hx * bankReach), landscapeHeight(x + hz * bankReach, z - hx * bankReach))
    level = Math.min(level, bank - 0.2)
    nodes.push({ x, z, level, halfWidth: last.halfWidth, depth: last.depth })
  }
  const lip = nodes[nodes.length - 1]!
  const r = Math.hypot(lip.x, lip.z)
  if (r < islandRadius(Math.atan2(lip.z, lip.x)) - 12) return null
  return { x: lip.x, z: lip.z, level: lip.level, halfWidth: lip.halfWidth, outX: lip.x / r, outZ: lip.z / r }
}

/**
 * Turns the steepest short descents on a few rivers into steps (knickpoints). One is the
 * island's prominent fall, aimed at `STEP_MAJOR` meters; up to `MAX_MINOR` smaller ones, on
 * other rivers, aim at `STEP_MINOR`. The channel is evened out above and below the step
 * (levels are only ever lowered, so water never rises above its banks), and `buildCarve`
 * turns the step into a wall: the ground on each side is cut to its own channel level, with a
 * plunge pool dug at the foot. The routes, lakes and the rest of the terrain are not touched.
 */
function shapeKnickpoints(rivers: River[]) {
  if (!INLAND_FALLS) return
  type Step = { river: River; s: number; e: number; drop: number; sharp: number }
  const best = (river: River, target: number): Step | null => {
    const nodes = river.nodes
    let found: Step | null = null
    for (let s = STEP_MARGIN; s + 8 < nodes.length - STEP_MARGIN; s += 1) {
      if (nodes[s]!.halfWidth < 2.5) continue
      // The landing node that gives a drop nearest the target, and how sharply the bed drops to it.
      let e = -1
      for (let j = s + 1; j <= s + 8; j += 1) {
        const drop = nodes[s]!.level - nodes[j]!.level
        if (drop >= STEP_MIN && (e < 0 || Math.abs(drop - target) < Math.abs(nodes[s]!.level - nodes[e]!.level - target))) e = j
      }
      if (e < 0) continue
      const drop = nodes[s]!.level - nodes[e]!.level
      const sharp = drop / (e - s)
      if (!found || sharp > found.sharp) found = { river, s, e, drop, sharp }
    }
    return found
  }
  const apply = ({ river, s, e, drop }: Step) => {
    const nodes = river.nodes
    const above = nodes[s]!.level
    const below = nodes[e]!.level
    // The channel above the wall comes down to it gently (about 0.12 m per meter), so there is no second step and no flat shelf before it.
    for (let j = Math.max(0, s - 14); j <= s; j += 1) nodes[j]!.level = Math.min(nodes[j]!.level, above + (s - j) * 0.5)
    for (let j = s + 1; j <= e; j += 1) nodes[j]!.level = Math.min(nodes[j]!.level, below)
    // A plunge pool: the channel widens and deepens for a few nodes below the wall.
    for (let j = s + 1; j <= Math.min(nodes.length - 1, s + 8); j += 1) {
      const bump = Math.sin(((j - s) / 9) * Math.PI) * Math.min(1, drop / 12)
      nodes[j]!.halfWidth *= 1 + 0.3 * bump
      nodes[j]!.depth *= 1 + 0.4 * bump
    }
    river.plunge = { from: s, to: s + 1, end: e, above, below }
  }
  // The prominent fall: the tallest candidate nearest the major target. The rest are minor falls, one per river.
  const majors = rivers.map((river) => best(river, STEP_MAJOR)).filter((step): step is Step => step !== null)
  if (majors.length === 0) return
  majors.sort((a, b) => b.drop * b.river.nodes[b.s]!.halfWidth - a.drop * a.river.nodes[a.s]!.halfWidth)
  const major = majors[0]!
  apply(major)
  const minors = rivers
    .filter((river) => river !== major.river)
    .map((river) => best(river, STEP_MINOR))
    .filter((step): step is Step => step !== null)
    .sort((a, b) => b.sharp - a.sharp)
  for (const step of minors.slice(0, MAX_MINOR)) apply(step)
}

/** Classifies each river's steep reaches from its bed: how much of it is a cascade over rock. */
function markFalls(rivers: River[]) {
  for (const river of rivers) {
    const nodes = river.nodes
    const slope = nodes.map((node, k) => {
      const next = nodes[Math.min(nodes.length - 1, k + 1)]!
      const run = Math.hypot(next.x - node.x, next.z - node.z)
      return run > 0 ? (node.level - next.level) / run : 0
    })
    for (let k = 0; k < nodes.length; k += 1) {
      let sum = 0
      let count = 0
      for (let d = -2; d <= 2; d += 1) {
        const j = k + d
        if (j < 0 || j >= nodes.length - 1) continue
        sum += slope[j]!
        count += 1
      }
      nodes[k]!.fall = smoothstep(CASCADE_FROM, CASCADE_FULL, count > 0 ? sum / count : 0)
    }
  }
}

/** The ground lowered to each channel: a trough under the water, a cut back to the bank, blended out smoothly. */
function buildCarve(rivers: River[]): TerrainCarve {
  const size = LANDSCAPE.size
  const cols = Math.ceil(size / BUCKET)
  const buckets: number[][] = new Array(cols * cols)
  const segments: number[] = []
  const reachOf = (v: number) => Math.min(cols - 1, Math.max(0, Math.floor((v + size * 0.5) / BUCKET)))
  /** A step's wall: across the flow at its lip, wherever the channel runs there; ground on either side is cut to that side's own level. */
  type Wall = { x: number; z: number; dx: number; dz: number; r2: number; above: number; below: number; run: number; hw: number; height: number; from: number }
  const walls: Wall[] = []
  /** Segment id → the wall whose plateau it belongs to, and the segment's own node index. */
  const wallOf = new Map<number, { wall: Wall; k: number }>()
  for (const river of rivers) {
    let wall: Wall | null = null
    const plunge = river.plunge
    if (plunge) {
      const a = river.nodes[plunge.from]!
      const b = river.nodes[plunge.to]!
      const run = Math.hypot(b.x - a.x, b.z - a.z) || 1
      const reach = Math.max(a.halfWidth, b.halfWidth) + BANK_BLEND.start + BANK_BLEND.length + 20
      wall = { x: a.x, z: a.z, dx: (b.x - a.x) / run, dz: (b.z - a.z) / run, r2: reach * reach, above: plunge.above, below: plunge.below, run, hw: b.halfWidth, height: plunge.above - plunge.below, from: plunge.from }
      walls.push(wall)
    }
    for (let k = 0; k < river.nodes.length - 1; k += 1) {
      const a = river.nodes[k]!
      const b = river.nodes[k + 1]!
      const id = segments.length / 8
      segments.push(a.x, a.z, b.x, b.z, a.level, b.level, a.halfWidth, b.halfWidth)
      if (wall && plunge && k >= plunge.from - 14 && k < plunge.end) wallOf.set(id, { wall, k })
      const radius = Math.max(a.halfWidth, b.halfWidth) + BANK_BLEND.start + BANK_BLEND.length
      const i0 = reachOf(Math.min(a.x, b.x) - radius)
      const i1 = reachOf(Math.max(a.x, b.x) + radius)
      const j0 = reachOf(Math.min(a.z, b.z) - radius)
      const j1 = reachOf(Math.max(a.z, b.z) + radius)
      for (let j = j0; j <= j1; j += 1) {
        for (let i = i0; i <= i1; i += 1) {
          const slot = j * cols + i
          ;(buckets[slot] ??= []).push(id)
        }
      }
    }
  }
  type Pick = { dist: number; width: number; level: number; t: number; reach: number; member: { wall: Wall; k: number } }
  const cut = (x: number, z: number, height: number) => {
    const list = buckets[reachOf(z) * cols + reachOf(x)]
    if (!list) return height
    // Only the nearest reach shapes the ground here, so a bend never cuts into the bank of its own upstream water.
    let near = Number.POSITIVE_INFINITY
    let level = 0
    let hw = 0
    let d = 0
    let step: { wall: Wall; k: number } | undefined
    let along = 0
    // Within a step, the nearest reach above and the nearest below, by plain distance to the channel's line.
    let up: Pick | null = null
    let down: Pick | null = null
    for (const id of list) {
      const o = id * 8
      const ax = segments[o]!
      const az = segments[o + 1]!
      const abx = segments[o + 2]! - ax
      const abz = segments[o + 3]! - az
      const len2 = abx * abx + abz * abz || 1
      const t = Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / len2))
      const dist = Math.hypot(x - (ax + abx * t), z - (az + abz * t))
      const width = segments[o + 6]! + (segments[o + 7]! - segments[o + 6]!) * t
      const at = segments[o + 4]! + (segments[o + 5]! - segments[o + 4]!) * t
      const member = wallOf.get(id)
      if (member) {
        const pick: Pick = { dist, width, level: at, t, reach: Math.sqrt(len2), member }
        if (member.k < member.wall.from) {
          if (!up || dist < up.dist) up = pick
        } else if (!down || dist < down.dist) down = pick
      }
      if (dist - width >= near) continue
      near = dist - width
      d = dist
      hw = width
      level = at
      step = member
      if (member) along = (member.k + t - member.wall.from) * Math.sqrt(len2)
    }
    // A wide pool below the wall would otherwise out-reach the narrower channel above it, and cut its banks down.
    // Whichever side's channel is truly nearer owns the point.
    if (step && up && down) {
      const owner: Pick = up.dist <= down.dist ? up : down
      d = owner.dist
      hw = owner.width
      level = owner.level
      step = owner.member
      along = (owner.member.k + owner.t - owner.member.wall.from) * owner.reach
      near = d - hw
    }
    if (near > BANK_BLEND.start + BANK_BLEND.length) return height
    const groundAt = (surface: number) => {
      const trough = d <= hw ? surface - depthFor(hw) * (1 - (d / hw) * (d / hw)) : surface + (d - hw) * BANK_SLOPE
      const lower = height - trough
      if (lower <= 0) return height
      const weight = 1 - smoothstep(hw + BANK_BLEND.start, hw + BANK_BLEND.start + BANK_BLEND.length, d)
      return height - lower * weight
    }
    if (!step) return groundAt(level)
    const { above, below } = step.wall
    if (along <= -WALL_BLEND) return groundAt(above)
    if (along >= WALL_BLEND) return groundAt(below)
    // The wall itself: both cuts, joined over a couple of meters, so the mesh draws it as a near-vertical face.
    const upper = groundAt(above)
    return upper + (groundAt(below) - upper) * smoothstep(-WALL_BLEND, WALL_BLEND, along)
  }
  return (x, z, height) => {
    let ground = cut(x, z, height)
    for (const wall of walls) {
      const ox = x - wall.x
      const oz = z - wall.z
      if (ox * ox + oz * oz > wall.r2) continue
      // The plunge pool, dug where the water lands, a little beyond the foot of the wall: u is meters past the wall along the fall, v across it.
      const u = ox * wall.dx + oz * wall.dz
      if (u <= 0) continue
      const v = -ox * wall.dz + oz * wall.dx
      const landing = Math.max(wall.run, 1.6 * Math.sqrt(wall.height))
      ground -= (1.2 + 0.09 * wall.height) * Math.exp(-(((u - landing * 0.8) / (landing * 0.9)) ** 2 + (v / (wall.hw * 1.1)) ** 2))
    }
    return ground
  }
}

/** Where the water meets the bank on one side of a node, found on the carved ground itself. */
function shoreDistance(node: RiverNode, px: number, pz: number): number {
  const limit = node.halfWidth * 2.4 + 6
  const step = Math.max(0.8, node.halfWidth * 0.2)
  let previous = 0
  for (let d = step; d <= limit; d += step) {
    if (landscapeHeight(node.x + px * d, node.z + pz * d) >= node.level) {
      let lo = previous
      let hi = d
      for (let i = 0; i < 4; i += 1) {
        const mid = (lo + hi) * 0.5
        if (landscapeHeight(node.x + px * mid, node.z + pz * mid) >= node.level) hi = mid
        else lo = mid
      }
      return Math.max(node.halfWidth * 0.5, (lo + hi) * 0.5)
    }
    previous = d
  }
  return node.halfWidth
}

const smooth = (values: number[], passes: number) => {
  for (let pass = 0; pass < passes; pass += 1) {
    const copy = values.slice()
    for (let k = 1; k < values.length - 1; k += 1) values[k] = (copy[k - 1]! + copy[k]! * 2 + copy[k + 1]!) * 0.25
  }
}

/** Each node's tangent and its smoothed distances to the left and right banks, found on the carved ground itself. */
function riverEdges(nodes: RiverNode[]) {
  const left: number[] = []
  const right: number[] = []
  const tangent: [number, number][] = []
  for (let k = 0; k < nodes.length; k += 1) {
    const prev = nodes[Math.max(0, k - 1)]!
    const next = nodes[Math.min(nodes.length - 1, k + 1)]!
    let tx = next.x - prev.x
    let tz = next.z - prev.z
    const len = Math.hypot(tx, tz) || 1
    tx /= len
    tz /= len
    tangent.push([tx, tz])
    left.push(shoreDistance(nodes[k]!, tz, -tx))
    right.push(shoreDistance(nodes[k]!, -tz, tx))
  }
  smooth(left, 3)
  smooth(right, 3)
  return { left, right, tangent }
}

/**
 * Lateral columns: a share of the way to the shore on that side, how far past the shore
 * (meters) and how far dipped under the bank. The outer edge runs past the shore, below it,
 * so the ground, not the polygon, cuts the shoreline.
 */
const COLUMNS = [
  { share: -1, past: 1.1, dip: 0.45, depth: 0 },
  { share: -1, past: 0, dip: 0, depth: 0 },
  { share: -0.5, past: 0, dip: 0, depth: 0.68 },
  { share: 0, past: 0, dip: 0, depth: 1 },
  { share: 0.5, past: 0, dip: 0, depth: 0.68 },
  { share: 1, past: 0, dip: 0, depth: 0 },
  { share: 1, past: 1.1, dip: 0.45, depth: 0 },
] as const
/** Rivers are shallow, but read in the lakes' tones: their shading depth is a few times the channel's. */
const SHADE_DEPTH = 2.6
/** The falling sheet's grid: dense enough for the shader to bend it smoothly. */
const FALL_COLUMNS = 19

/**
 * One ribbon per river at its surface level, its edges set on the carved ground's own
 * shoreline and smoothed along the river. Depth is read across the channel, deepest in the
 * middle and nothing at the shore (rim falls are `buildFallGeometry`). Attributes: `aDepth` (shading), `aFall` (0 river, 1 falling
 * water), `aAlong` (meters along the flow or down the fall), `aAcross` (−1 to 1).
 */
export function buildRiverGeometry(system: RiverSystem): BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const depths: number[] = []
  const falls: number[] = []
  const alongs: number[] = []
  const acrosses: number[] = []
  const indices: number[] = []
  const vertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number, depth: number, fall: number, along: number, across: number) => {
    positions.push(x, y, z)
    normals.push(nx, ny, nz)
    depths.push(depth)
    falls.push(fall)
    alongs.push(along)
    acrosses.push(across)
  }
  // Both ribbons and sheets are wound so the front face is the one the normal points out of.
  const strips = (base: number, rows: number, stride: number, skip?: Plunge | null) => {
    for (let k = 0; k < rows - 1; k += 1) {
      // The bed under a free fall is dry rock: the water is in the air there.
      if (skip && k >= skip.from && k < skip.to) continue
      for (let c = 0; c < stride - 1; c += 1) {
        const a = base + k * stride + c
        indices.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride)
      }
    }
  }
  for (const river of system.rivers) {
    const nodes = river.nodes
    const { left, right, tangent } = riverEdges(nodes)
    const base = positions.length / 3
    let along = 0
    const alongAt: number[] = []
    for (let k = 0; k < nodes.length; k += 1) {
      const node = nodes[k]!
      if (k > 0) along += Math.hypot(node.x - nodes[k - 1]!.x, node.z - nodes[k - 1]!.z)
      alongAt.push(along)
      const [tx, tz] = tangent[k]!
      const fall = node.fall ?? 0
      for (const column of COLUMNS) {
        const side = column.share < 0 ? left[k]! : right[k]!
        const lateral = column.share * (side + column.past)
        vertex(node.x - tz * lateral, node.level - column.dip, node.z + tx * lateral, 0, 1, 0, node.depth * SHADE_DEPTH * column.depth, fall, along, column.share)
      }
    }
    strips(base, nodes.length, COLUMNS.length, river.plunge)
    const plunge = river.plunge
    if (plunge) {
      // The pool under the wall: the lower channel's water, from the foot of the wall to where the ribbon takes up again.
      const pool = positions.length / 3
      const [tx, tz] = tangent[plunge.to]!
      const low = nodes[plunge.to]!
      for (const k of [plunge.from, plunge.to]) {
        for (const column of COLUMNS) {
          const side = column.share < 0 ? left[plunge.to]! : right[plunge.to]!
          const lateral = column.share * (side + column.past)
          vertex(nodes[k]!.x - tz * lateral, low.level - column.dip, nodes[k]!.z + tx * lateral, 0, 1, 0, low.depth * SHADE_DEPTH * column.depth * 1.3, 0, alongAt[k]!, column.share)
        }
      }
      strips(pool, 2, COLUMNS.length)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setAttribute('aDepth', new BufferAttribute(new Float32Array(depths), 1))
  geometry.setAttribute('aFall', new BufferAttribute(new Float32Array(falls), 1))
  geometry.setAttribute('aAlong', new BufferAttribute(new Float32Array(alongs), 1))
  geometry.setAttribute('aAcross', new BufferAttribute(new Float32Array(acrosses), 1))
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1))
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * Every free-falling sheet: the river's rim falls and its inland plunges, one mesh. Each sheet
 * starts exactly where the river ribbon ends, with the river's width. The water leaves the
 * lip nearly level and is pulled down (the drop grows with the square of the way down).
 * It fans out a little as it falls, as falling water does, and its section is a rounded
 * column, not a plane. A rim fall keeps going far below the island; a plunge lands in its
 * own channel, where the ribbon takes the water up again. Attributes: `aAlong` (meters from
 * the river's head, continuing the river's), `aAcross` (−1 to 1), `aDrop` (0 at the lip
 * to 1 at the foot), `aFall` (height in meters, half-width in meters, 1 for a rim fall, shading depth).
 */
export function buildFallGeometry(system: RiverSystem): BufferGeometry | null {
  const positions: number[] = []
  const alongs: number[] = []
  const acrosses: number[] = []
  const drops: number[] = []
  const sizes: number[] = []
  const indices: number[] = []
  /** Where the middle of the sheet is at `t` (0 to 1), the flow's direction there and the river's two banks, in meters. */
  type Frame = { x: number; z: number; dx: number; dz: number; left: number; right: number }
  type Sheet = {
    level: number
    height: number
    frame: (t: number) => Frame
    /** Fan-out of the width at `t`, 1 at the lip. */
    fan: (t: number) => number
    rim: boolean
    /** Shading depth of the river at the lip, so the water leaves in the colour it arrived in. */
    depth: number
    head: number
    rows: number
  }
  const addSheet = (sheet: Sheet) => {
    const { level, height, frame, fan, rim, depth, head, rows } = sheet
    const lip = frame(0)
    const w0 = (lip.left + lip.right) * 0.5
    // Smooth, deterministic wobble from where the fall sits: each fall hangs a little differently.
    const seed = lip.x * 0.071 + lip.z * 0.113
    const wobble = (t: number, freq: number, phase: number) => 0.6 * Math.sin(t * freq + seed + phase) + 0.4 * Math.sin(t * freq * 2.3 + seed * 1.7 + phase)
    const length = rim ? Math.max(1, height / 150) : 1
    const base = positions.length / 3
    let arc = 0
    let px = lip.x
    let py = level
    let pz = lip.z
    for (let j = 0; j <= rows; j += 1) {
      const t = j / rows
      const f = frame(t)
      // A fall as tall as the cliff wobbles in proportion to its length, not once over the whole drop.
      const sway = w0 * (rim ? 0.15 : 0.45) * wobble(t, 5 * length, 2) * smoothstep(0, 0.35 / length, t)
      const grow = fan(t) * (1 + (rim ? 0.03 : 0.1) * wobble(t, 8 * length, 0))
      const thick = w0 * (rim ? 0.2 : 0.07) * smoothstep(0.02, 0.2, t)
      const cx = f.x - f.dz * sway
      const cz = f.z + f.dx * sway
      const cy = level - height * t * t
      if (j > 0) arc += Math.hypot(cx - px, cy - py, cz - pz)
      px = cx
      py = cy
      pz = cz
      for (let c = 0; c < FALL_COLUMNS; c += 1) {
        const share = -1 + (2 * c) / (FALL_COLUMNS - 1)
        const bulge = thick * Math.sqrt(Math.max(0, 1 - share * share))
        // Left of the flow is the negative side (as in the ribbon), so each bank keeps its own width.
        const half = (share < 0 ? f.left : f.right) * grow
        positions.push(cx - f.dz * share * half + f.dx * bulge, cy, cz + f.dx * share * half + f.dz * bulge)
        alongs.push(head + arc)
        acrosses.push(share)
        drops.push(t)
        sizes.push(height, w0, rim ? 1 : 0, depth)
      }
    }
    for (let k = 0; k < rows; k += 1) {
      for (let c = 0; c < FALL_COLUMNS - 1; c += 1) {
        const a = base + k * FALL_COLUMNS + c
        indices.push(a, a + 1, a + FALL_COLUMNS, a + 1, a + FALL_COLUMNS + 1, a + FALL_COLUMNS)
      }
    }
  }
  for (const river of system.rivers) {
    const nodes = river.nodes
    const headTo = (to: number) => {
      let head = 0
      for (let k = 1; k <= to; k += 1) head += Math.hypot(nodes[k]!.x - nodes[k - 1]!.x, nodes[k]!.z - nodes[k - 1]!.z)
      return head
    }
    const lip = river.rim
    if (lip) {
      const edges = riverEdges(nodes)
      const end = nodes.length - 1
      const height = rimFallHeight(lip)
      const reach = (t: number) => 14 * (1 - Math.exp(-3 * t)) + 0.06 * Math.min(height, 200) * t * t
      addSheet({
        level: lip.level,
        height,
        // Pours clear of the lip along the direction away from the land, then hangs close to the cliff.
        frame: (t) => ({ x: lip.x + lip.outX * reach(t), z: lip.z + lip.outZ * reach(t), dx: lip.outX, dz: lip.outZ, left: edges.left[end]!, right: edges.right[end]! }),
        // Falling water spreads only a little: a fifth wider by the foot.
        fan: (t) => 1 + 0.2 * smoothstep(0.1, 0.9, t),
        rim: true,
        // The river's tone across its whole width, not its darkest middle: the ribbon is shallow toward its banks.
        depth: nodes[end]!.depth * SHADE_DEPTH * 0.5,
        head: headTo(nodes.length - 1),
        rows: 90,
      })
    }
    const plunge = river.plunge
    if (plunge) {
      const edges = riverEdges(nodes)
      const a = nodes[plunge.from]!
      const height = a.level - nodes[plunge.to]!.level
      const landing = Math.max(Math.hypot(nodes[plunge.to]!.x - a.x, nodes[plunge.to]!.z - a.z), 1.6 * Math.sqrt(height))
      // The sheet follows the channel's own line below the lip, so its banks, its direction and its landing are the river's.
      const last = Math.min(nodes.length - 1, plunge.from + 8)
      const reachAt: number[] = [0]
      for (let k = plunge.from + 1; k <= last; k += 1) reachAt.push(reachAt[reachAt.length - 1]! + Math.hypot(nodes[k]!.x - nodes[k - 1]!.x, nodes[k]!.z - nodes[k - 1]!.z))
      const along = (t: number): Frame => {
        const d = Math.min(landing * t, reachAt[reachAt.length - 1]!)
        let i = 0
        while (i < reachAt.length - 2 && reachAt[i + 1]! < d) i += 1
        const span = reachAt[i + 1]! - reachAt[i]! || 1
        const f = Math.max(0, Math.min(1, (d - reachAt[i]!) / span))
        const j = plunge.from + i
        const mix = (u: number, v: number) => u + (v - u) * f
        let dx = mix(edges.tangent[j]![0], edges.tangent[j + 1]![0])
        let dz = mix(edges.tangent[j]![1], edges.tangent[j + 1]![1])
        const l = Math.hypot(dx, dz) || 1
        dx /= l
        dz /= l
        // Past the last node of the path the line carries straight on.
        const over = landing * t - d
        return {
          x: mix(nodes[j]!.x, nodes[j + 1]!.x) + dx * over,
          z: mix(nodes[j]!.z, nodes[j + 1]!.z) + dz * over,
          dx,
          dz,
          left: mix(edges.left[j]!, edges.left[j + 1]!),
          right: mix(edges.right[j]!, edges.right[j + 1]!),
        }
      }
      addSheet({
        level: a.level,
        height,
        frame: along,
        fan: () => 1,
        rim: false,
        depth: a.depth * SHADE_DEPTH,
        head: headTo(plunge.from),
        rows: 28,
      })
    }
  }
  if (indices.length === 0) return null
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('aAlong', new BufferAttribute(new Float32Array(alongs), 1))
  geometry.setAttribute('aAcross', new BufferAttribute(new Float32Array(acrosses), 1))
  geometry.setAttribute('aDrop', new BufferAttribute(new Float32Array(drops), 1))
  geometry.setAttribute('aFall', new BufferAttribute(new Float32Array(sizes), 4))
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

/** A generated fall and a camera pose that shows it from the side, for the Waterfall Locator. */
export type FallView = { label: string; kind: 'inland' | 'rim'; height: number; x: number; z: number; position: [number, number, number]; target: [number, number, number] }

/**
 * Every fall in the system, tallest inland falls first, each with a deterministic viewing pose:
 * the middle of the drop is the target, and the camera stands off to whichever side the ground is
 * lower (inland) or out in the air beside the lip (rim), far enough to see the whole drop.
 */
export function fallViews(system: RiverSystem): FallView[] {
  const views: FallView[] = []
  for (const river of system.rivers) {
    const plunge = river.plunge
    if (plunge) {
      const a = river.nodes[plunge.from]!
      const b = river.nodes[plunge.to]!
      const run = Math.hypot(b.x - a.x, b.z - a.z) || 1
      const dx = (b.x - a.x) / run
      const dz = (b.z - a.z) / run
      const height = plunge.above - plunge.below
      const reach = Math.max(run, 1.6 * Math.sqrt(height))
      const target: [number, number, number] = [a.x + dx * reach * 0.5, plunge.above - height * 0.55, a.z + dz * reach * 0.5]
      // The nearest side view with a clear line to the drop: either bank, a few distances and heights, the first that does not look through the ground.
      const clear = (p: [number, number, number]) => {
        for (let i = 1; i < 12; i += 1) {
          const f = i / 12
          const x = p[0] + (target[0] - p[0]) * f
          const z = p[2] + (target[2] - p[2]) * f
          if (landscapeHeight(x, z) + 3 > p[1] + (target[1] - p[1]) * f) return false
        }
        return true
      }
      const base = Math.max(70, height * 3.2)
      let position: [number, number, number] | null = null
      for (const stretch of [1, 1.5, 2.2, 3.2]) {
        for (const lift of [height * 0.9 + 12, height * 1.6 + 40, height * 2.6 + 80]) {
          for (const side of [1, -1]) {
            const stand = base * stretch
            const x = target[0] - dz * side * stand + dx * stand * 0.45
            const z = target[2] + dx * side * stand + dz * stand * 0.45
            const candidate: [number, number, number] = [x, Math.max(target[1] + lift, landscapeHeight(x, z) + 8), z]
            if (!position && clear(candidate)) position = candidate
          }
        }
      }
      position ??= [target[0], target[1] + height * 3 + 120, target[2]]
      views.push({ label: '', kind: 'inland', height, x: a.x, z: a.z, position, target })
    }
    const lip = river.rim
    if (lip) {
      const height = rimFallHeight(lip)
      const target: [number, number, number] = [lip.x + lip.outX * 12, lip.level - height * 0.45, lip.z + lip.outZ * 12]
      const stand = height * 1.7
      views.push({
        label: '',
        kind: 'rim',
        height,
        x: lip.x,
        z: lip.z,
        position: [target[0] + lip.outX * stand - lip.outZ * stand * 0.55, target[1] + height * 0.1, target[2] + lip.outZ * stand + lip.outX * stand * 0.55],
        target,
      })
    }
  }
  views.sort((a, b) => (a.kind === b.kind ? b.height - a.height : a.kind === 'inland' ? -1 : 1))
  let inland = 0
  let rim = 0
  for (const view of views) {
    const n = view.kind === 'inland' ? (inland += 1) : (rim += 1)
    view.label = `${view.kind === 'inland' ? (n === 1 ? 'Inland fall 1 (prominent)' : `Inland fall ${n}`) : `Rim fall ${n}`} · ${Math.round(view.height)} m · ${Math.round(view.x)}, ${Math.round(view.z)}`
  }
  return views
}
