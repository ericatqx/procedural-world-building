import type { BufferGeometry } from 'three'
import { CELL, cellCenter, forEachNeighbour, segmentDistance } from './grid.ts'
import type { Hydrology, River, RiverPoint } from './hydrology.ts'
import { MeshBuilder, type RibbonPoint } from './meshBuilder.ts'
import { surfaceHeight, type Carve } from './terrain.ts'

/**
 * Shadow Ecology — water geometry and the channels rivers cut.
 *
 * Channels: a flat bed below the water line, then banks rising at a fixed
 * slope until they meet the ground, so a river cuts through any rise in its way.
 * Water: flat lakes at their spill level, ribbons along each river, and a
 * sheet arcing off the rim wherever a river reaches the edge.
 */
const BED_BELOW_WATER = 0.6
const FLAT_BED = 0.6
const BANK_SLOPE = 1.6
const CHANNEL_REACH = 0.4
const BUCKET = 0.25
const BUCKET_ORIGIN = 3.8
const BUCKETS = Math.ceil((2 * BUCKET_ORIGIN) / BUCKET)

/** Ribbons reach a little past the flat bed so their edges tuck into the banks. */
const RIBBON_WIDTH = 1.15
const FALL_ROWS = 18
const FALL_BELOW_UNDERSIDE = 0.4
const FALL_THROW = 0.18
const FALL_SPREAD = 0.5
/** `aFlow` on lakes: negative marks still water (rivers count up from 0). */
const LAKE_FLOW = -1
/** River current (`aSpeed`) from its fall per unit length, within these bounds; falls run fastest. */
const SPEED_BASE = 0.4
const SPEED_PER_GRADE = 2.5
const SPEED_MAX = 1.8
const FALL_SPEED = 3

type ChannelSegment = {
  a: RiverPoint
  b: RiverPoint
}

export type Channels = {
  carve: Carve
  /** Ground height after channels are cut. */
  groundHeight: (x: number, z: number) => number
}

export function createChannels(rivers: River[]): Channels {
  const buckets: ChannelSegment[][] = Array.from({ length: BUCKETS * BUCKETS }, () => [])
  const bucketOf = (value: number) =>
    Math.min(BUCKETS - 1, Math.max(0, Math.floor((value + BUCKET_ORIGIN) / BUCKET)))
  for (const river of rivers) {
    for (let k = 0; k < river.points.length - 1; k += 1) {
      const a = river.points[k]!
      const b = river.points[k + 1]!
      const segment = { a, b }
      const i0 = bucketOf(Math.min(a.x, b.x) - CHANNEL_REACH)
      const i1 = bucketOf(Math.max(a.x, b.x) + CHANNEL_REACH)
      const j0 = bucketOf(Math.min(a.z, b.z) - CHANNEL_REACH)
      const j1 = bucketOf(Math.max(a.z, b.z) + CHANNEL_REACH)
      for (let j = j0; j <= j1; j += 1) {
        for (let i = i0; i <= i1; i += 1) {
          buckets[i + j * BUCKETS]!.push(segment)
        }
      }
    }
  }

  const channelFloor = (x: number, z: number) => {
    let floor = Infinity
    for (const { a, b } of buckets[bucketOf(x) + bucketOf(z) * BUCKETS]!) {
      const { distance, t } = segmentDistance(x, z, a.x, a.z, b.x, b.z)
      if (distance > CHANNEL_REACH) {
        continue
      }
      const level = a.level + (b.level - a.level) * t
      const depth = a.depth + (b.depth - a.depth) * t
      const halfWidth = a.halfWidth + (b.halfWidth - a.halfWidth) * t
      const bed = level - BED_BELOW_WATER * depth
      floor = Math.min(floor, bed + BANK_SLOPE * Math.max(0, distance - FLAT_BED * halfWidth))
    }
    return floor
  }

  const groundHeight = (x: number, z: number) => Math.min(surfaceHeight(x, z), channelFloor(x, z))
  const carve = (x: number, z: number) => Math.max(0, surfaceHeight(x, z) - channelFloor(x, z))
  return { carve, groundHeight }
}

export type WaterStats = { lakes: number; lakeArea: number; riverLength: number; falls: number }

/**
 * One geometry for all water. Attributes: `aFlow` (distance downstream, for
 * flow lines; −1 on lakes), `aDepth` (water depth), `aFall` (0 at the rim →
 * 1 at the bottom of a fall; 0 elsewhere), `aAcross` (−1 → 1 across a river
 * or fall) and `aSpeed` (current: from the river's grade; 0 on lakes).
 */
export function createWaterGeometry(
  hydrology: Hydrology,
  groundHeight: (x: number, z: number) => number,
  lowest: number,
): { geometry: BufferGeometry; stats: WaterStats } {
  const builder = new MeshBuilder(['aFlow', 'aDepth', 'aFall', 'aAcross', 'aSpeed'])

  // Lakes: a flat quad per basin cell plus one ring of shore cells; the
  // terrain hides whatever lies above the water line.
  let lakeArea = 0
  for (const [id, lake] of hydrology.lakes.entries()) {
    lakeArea += lake.cells.length * CELL * CELL
    const cells = new Set(lake.cells)
    for (const c of lake.cells) {
      forEachNeighbour(c, (n) => {
        if (hydrology.inside[n] && hydrology.lakeId[n]! < 0) {
          cells.add(n)
        }
      })
    }
    for (const c of cells) {
      if (hydrology.lakeId[c]! >= 0 && hydrology.lakeId[c] !== id) {
        continue
      }
      const [x, z] = cellCenter(c)
      const h = CELL / 2
      const corner = (dx: number, dz: number) =>
        builder.vertex(x + dx, lake.level, z + dz, {
          aFlow: LAKE_FLOW,
          aDepth: Math.max(0, lake.level - groundHeight(x + dx, z + dz)),
        })
      const a = corner(-h, -h)
      const b = corner(h, -h)
      const d = corner(h, h)
      const e = corner(-h, h)
      builder.triangle(a, e, b)
      builder.triangle(b, e, d)
    }
  }

  // Rivers: ribbons at the water line.
  let riverLength = 0
  let falls = 0
  for (const river of hydrology.rivers) {
    riverLength += river.points[river.points.length - 1]!.distance
    const points = river.points
    builder.ribbon(
      points.map((point, k) => {
        const before = points[Math.max(0, k - 1)]!
        const after = points[Math.min(points.length - 1, k + 1)]!
        const grade = (before.level - after.level) / Math.max(1e-3, after.distance - before.distance)
        const speed = Math.min(SPEED_MAX, SPEED_BASE + SPEED_PER_GRADE * Math.max(0, grade))
        return {
          x: point.x,
          y: point.level,
          z: point.z,
          halfWidth: point.halfWidth * RIBBON_WIDTH,
          values: { aFlow: point.distance, aDepth: point.depth, aSpeed: speed },
        }
      }),
    )

    if (river.outlet && river.points.length >= 2) {
      falls += 1
      appendFall(builder, river, lowest)
    }
  }

  return {
    geometry: builder.build(),
    stats: { lakes: hydrology.lakes.length, lakeArea, riverLength, falls },
  }
}

/** A sheet thrown out from the rim and falling past the underside. */
function appendFall(builder: MeshBuilder, river: River, lowest: number) {
  const last = river.points[river.points.length - 1]!
  const before = river.points[river.points.length - 2]!
  let ox = last.x - before.x
  let oz = last.z - before.z
  const length = Math.hypot(ox, oz) || 1
  ox /= length
  oz /= length
  const height = last.level - (lowest - FALL_BELOW_UNDERSIDE)
  const rows: RibbonPoint[] = []
  for (let row = 0; row <= FALL_ROWS; row += 1) {
    const s = row / FALL_ROWS
    const drop = s * height
    const out = FALL_THROW * Math.sqrt(drop) + 0.02
    rows.push({
      x: last.x + ox * out,
      y: last.level - drop,
      z: last.z + oz * out,
      halfWidth: last.halfWidth * RIBBON_WIDTH * (1 + FALL_SPREAD * s),
      values: { aFlow: last.distance + drop, aDepth: last.depth, aFall: s, aSpeed: FALL_SPEED },
    })
  }
  builder.ribbon(rows, () => [-oz, ox])
}
