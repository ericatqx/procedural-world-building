import { sunAt } from '../project/sun.ts'
import { clamp01, smoothstep } from '../project02/core.ts'
import { environmentField } from './livingEcology.ts'
import { LANDSCAPE, islandRadius, landscapeHeight } from './terrain.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — the environmental fields vegetation reads: elevation, slope, standing water, distance to water, approximate
 * light and moisture. Two kinds, from the same terrain, water and rivers the rest of 0.3 uses:
 *
 *   Region   a square of ground (a tile), on a 3 m grid, built on demand around the camera: for the plants you can see up close.
 *            Light is the day's sun arc past the terrain's horizon, taken from a coarser 6 m height grid that reaches 150 m out.
 *   Island   the whole island on a 16 m grid, built once in slices: for the ground colour in the overview and for the far plants.
 *            Its light and moisture come from livingEcology's 32 m environment field (the one the organisms grow on), so the two
 *            agree.
 *
 * Living Architecture's effect is not here: it comes in through vegHabitat.ts, so these fields do not change when it does.
 */
export type Region = { cx: number; cz: number; n: number; x0: number; z0: number; cell: number }

export type RegionFields = {
  region: Region
  height: Float32Array
  slope: Float32Array
  waterDepth: Float32Array
  waterDist: Float32Array
  light: Float32Array
  moisture: Float32Array
  /** Unit direction (x, z) toward the sun's day arc, and the sun directions used. */
  sunMean: [number, number]
  suns: [number, number, number][]
  ms: number
}

export const TILE = { size: 96, cell: 3, coarse: 6, reach: 150 }

export function makeRegion(cx: number, cz: number, size = TILE.size, cell = TILE.cell): Region {
  const n = Math.round(size / cell)
  return { cx, cz, n, x0: cx - size / 2, z0: cz - size / 2, cell }
}

/** Bilinear sample of a region array at a world position (clamped to the region). */
export function sampleField(region: Region, field: Float32Array, x: number, z: number): number {
  const u = Math.min(region.n - 1.001, Math.max(0, (x - region.x0) / region.cell - 0.5))
  const v = Math.min(region.n - 1.001, Math.max(0, (z - region.z0) / region.cell - 0.5))
  const i = Math.floor(u)
  const j = Math.floor(v)
  const fu = u - i
  const fv = v - j
  const n = region.n
  return (field[j * n + i]! * (1 - fu) + field[j * n + i + 1]! * fu) * (1 - fv) + (field[(j + 1) * n + i]! * (1 - fu) + field[(j + 1) * n + i + 1]! * fu) * fv
}

const SUN_HOURS = [8, 10, 12, 14, 16]
export const suns = (): { suns: [number, number, number][]; mean: [number, number] } => {
  const s = SUN_HOURS.map((h) => sunAt(h, 55).direction).filter((d) => d[1] > 0.05) as [number, number, number][]
  const x = s.reduce((a, d) => a + d[0], 0)
  const z = s.reduce((a, d) => a + d[2], 0)
  const l = Math.hypot(x, z) || 1
  return { suns: s, mean: [x / l, z / l] }
}

/** Distance to the nearest wet cell, on an m × m grid of `cell` meters: a two-pass chamfer transform. */
export function chamfer(wet: Uint8Array, m: number, cell: number): Float32Array {
  const dist = new Float32Array(m * m).fill(1e6)
  for (let k = 0; k < m * m; k += 1) if (wet[k]) dist[k] = 0
  const relax = (k: number, o: number, w: number) => {
    if (dist[o]! + w < dist[k]!) dist[k] = dist[o]! + w
  }
  const D = cell
  const DD = cell * Math.SQRT2
  for (let j = 0; j < m; j += 1) {
    for (let i = 0; i < m; i += 1) {
      const k = j * m + i
      if (i > 0) relax(k, k - 1, D)
      if (j > 0) relax(k, k - m, D)
      if (i > 0 && j > 0) relax(k, k - m - 1, DD)
      if (i < m - 1 && j > 0) relax(k, k - m + 1, DD)
    }
  }
  for (let j = m - 1; j >= 0; j -= 1) {
    for (let i = m - 1; i >= 0; i -= 1) {
      const k = j * m + i
      if (i < m - 1) relax(k, k + 1, D)
      if (j < m - 1) relax(k, k + m, D)
      if (i < m - 1 && j < m - 1) relax(k, k + m + 1, DD)
      if (i > 0 && j < m - 1) relax(k, k + m - 1, DD)
    }
  }
  return dist
}

/** Marks the cells a river's channel covers, on a grid of `cell` meters whose origin is (ox, oz). */
export function markRivers(world: World, wet: Uint8Array, m: number, cell: number, ox: number, oz: number) {
  for (const river of world.rivers.rivers) {
    for (let k = 0; k < river.nodes.length; k += 1) {
      const a = river.nodes[k]!
      const b = river.nodes[Math.min(river.nodes.length - 1, k + 1)]!
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / cell))
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps
        const i0 = Math.floor((a.x + (b.x - a.x) * t - ox) / cell)
        const j0 = Math.floor((a.z + (b.z - a.z) * t - oz) / cell)
        const r = Math.max(0, Math.round(a.halfWidth / cell))
        for (let dj = -r; dj <= r; dj += 1) {
          for (let di = -r; di <= r; di += 1) {
            const i = i0 + di
            const j = j0 + dj
            if (i >= 0 && j >= 0 && i < m && j < m) wet[j * m + i] = 1
          }
        }
      }
    }
  }
}

export function buildRegionFields(world: World, cx: number, cz: number): RegionFields {
  const started = performance.now()
  const region = makeRegion(cx, cz)
  const { n, cell } = region
  // The coarse grid: heights and water over the tile and the margin the horizon needs.
  const cc = TILE.coarse
  const pad = Math.ceil(TILE.reach / cc)
  const m = Math.round(TILE.size / cc) + 2 * pad
  const mx0 = cx - TILE.size / 2 - pad * cc
  const mz0 = cz - TILE.size / 2 - pad * cc
  const hm = new Float32Array(m * m)
  const wet = new Uint8Array(m * m)
  for (let j = 0; j < m; j += 1) {
    for (let i = 0; i < m; i += 1) {
      const x = mx0 + (i + 0.5) * cc
      const z = mz0 + (j + 0.5) * cc
      hm[j * m + i] = landscapeHeight(x, z)
      if (world.water.depthAt(x, z) > 0) wet[j * m + i] = 1
    }
  }
  markRivers(world, wet, m, cc, mx0, mz0)
  const distM = chamfer(wet, m, cc)
  const distAt = (x: number, z: number) => distM[Math.min(m - 1, Math.max(0, Math.floor((z - mz0) / cc))) * m + Math.min(m - 1, Math.max(0, Math.floor((x - mx0) / cc)))]!
  const hAt = (x: number, z: number) => hm[Math.min(m - 1, Math.max(0, Math.floor((z - mz0) / cc))) * m + Math.min(m - 1, Math.max(0, Math.floor((x - mx0) / cc)))]!
  const { suns: sunDirs, mean: sunMean } = suns()
  const height = new Float32Array(n * n)
  const slope = new Float32Array(n * n)
  const waterDepth = new Float32Array(n * n)
  const waterDist = new Float32Array(n * n)
  const light = new Float32Array(n * n)
  const moisture = new Float32Array(n * n)
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i
      const x = region.x0 + (i + 0.5) * cell
      const z = region.z0 + (j + 0.5) * cell
      const h = landscapeHeight(x, z)
      height[k] = h
      const hx = (landscapeHeight(x + cell, z) - landscapeHeight(x - cell, z)) / (2 * cell)
      const hz = (landscapeHeight(x, z + cell) - landscapeHeight(x, z - cell)) / (2 * cell)
      slope[k] = Math.hypot(hx, hz)
      waterDepth[k] = world.water.depthAt(x, z)
      waterDist[k] = waterDepth[k]! > 0 ? 0 : distAt(x, z)
      let sun = 0
      let weights = 0
      for (const d of sunDirs) {
        const horiz = Math.hypot(d[0], d[2]) || 1
        const rise = d[1] / horiz
        let clear = 1
        for (let s = 1; s <= 24; s += 1) {
          const t = s * cc
          if (hAt(x + (d[0] / horiz) * t, z + (d[2] / horiz) * t) > h + 1.5 + rise * t) {
            clear = 0
            break
          }
        }
        sun += clear * d[1]
        weights += d[1]
      }
      const facing = slope[k]! > 0.01 ? (-hx * sunMean[0] - hz * sunMean[1]) / Math.hypot(1, slope[k]!) : 0
      light[k] = clamp01((weights > 0 ? sun / weights : 0) * (0.8 + 0.6 * Math.max(-0.33, Math.min(0.33, facing))))
      // Hollows: how far the ground lies below its surroundings (about 24 m around), from the coarse grid.
      let mean = 0
      let count = 0
      for (let b = -2; b <= 2; b += 1) {
        for (let a = -2; a <= 2; a += 1) {
          mean += hAt(x + a * cc, z + b * cc)
          count += 1
        }
      }
      moisture[k] = clamp01(0.7 * Math.exp(-waterDist[k]! / 110) + 0.3 * smoothstep(-0.5, 5, mean / count - h))
    }
  }
  return { region, height, slope, waterDepth, waterDist, light, moisture, sunMean, suns: sunDirs, ms: performance.now() - started }
}

// ---------------------------------------------------------------------------------------------------------------- the island
export const ISLAND = { n: 256, cell: LANDSCAPE.size / 256, x0: -LANDSCAPE.size / 2 }
export type IslandFields = { n: number; cell: number; x0: number; height: Float32Array; slope: Float32Array; waterDist: Float32Array; waterDepth: Float32Array; light: Float32Array; moisture: Float32Array; land: Uint8Array; sunMean: [number, number] }

/** The island's fields on a 16 m grid, built in slices (one `step()` is a few milliseconds) so the page never stalls. */
export function islandBuilder(world: World): { step: () => boolean; fields: IslandFields } {
  const { n, cell, x0 } = ISLAND
  const f: IslandFields = {
    n, cell, x0,
    height: new Float32Array(n * n), slope: new Float32Array(n * n), waterDist: new Float32Array(n * n), waterDepth: new Float32Array(n * n),
    light: new Float32Array(n * n), moisture: new Float32Array(n * n), land: new Uint8Array(n * n), sunMean: suns().mean,
  }
  const wet = new Uint8Array(n * n)
  let stage = 0
  let row = 0
  const ROWS = 24
  let eco: ReturnType<typeof environmentField> | null = null
  const ecoAt = (a: Float32Array, x: number, z: number) => {
    const N = 128
    const c = LANDSCAPE.size / N
    const u = Math.min(N - 1.001, Math.max(0, (x - x0) / c - 0.5))
    const v = Math.min(N - 1.001, Math.max(0, (z - x0) / c - 0.5))
    const i = Math.floor(u)
    const j = Math.floor(v)
    const fu = u - i
    const fv = v - j
    return (a[j * N + i]! * (1 - fu) + a[j * N + i + 1]! * fu) * (1 - fv) + (a[(j + 1) * N + i]! * (1 - fu) + a[(j + 1) * N + i + 1]! * fu) * fv
  }
  const step = () => {
    if (stage === 0) {
      // Heights, water and the land mask, a slice of rows at a time.
      for (let j = row; j < Math.min(n, row + ROWS); j += 1) {
        for (let i = 0; i < n; i += 1) {
          const x = x0 + (i + 0.5) * cell
          const z = x0 + (j + 0.5) * cell
          const k = j * n + i
          f.height[k] = landscapeHeight(x, z)
          f.waterDepth[k] = world.water.depthAt(x, z)
          if (f.waterDepth[k]! > 0) wet[k] = 1
          f.land[k] = Math.hypot(x, z) < islandRadius(Math.atan2(z, x)) * 0.97 ? 1 : 0
        }
      }
      row += ROWS
      if (row >= n) {
        markRivers(world, wet, n, cell, x0, x0)
        f.waterDist.set(chamfer(wet, n, cell))
        stage = 1
        row = 0
      }
      return false
    }
    if (stage === 1) {
      eco = environmentField(world)
      stage = 2
      return false
    }
    for (let j = row; j < Math.min(n, row + ROWS * 2); j += 1) {
      for (let i = 0; i < n; i += 1) {
        const k = j * n + i
        const x = x0 + (i + 0.5) * cell
        const z = x0 + (j + 0.5) * cell
        const hx = (f.height[j * n + Math.min(n - 1, i + 1)]! - f.height[j * n + Math.max(0, i - 1)]!) / (2 * cell)
        const hz = (f.height[Math.min(n - 1, j + 1) * n + i]! - f.height[Math.max(0, j - 1) * n + i]!) / (2 * cell)
        f.slope[k] = Math.hypot(hx, hz)
        f.light[k] = ecoAt(eco!.light, x, z)
        f.moisture[k] = ecoAt(eco!.moisture, x, z)
      }
    }
    row += ROWS * 2
    return row >= n
  }
  return { step, fields: f }
}

export function islandSample(f: IslandFields, a: Float32Array, x: number, z: number): number {
  const u = Math.min(f.n - 1.001, Math.max(0, (x - f.x0) / f.cell - 0.5))
  const v = Math.min(f.n - 1.001, Math.max(0, (z - f.x0) / f.cell - 0.5))
  const i = Math.floor(u)
  const j = Math.floor(v)
  const fu = u - i
  const fv = v - j
  return (a[j * f.n + i]! * (1 - fu) + a[j * f.n + i + 1]! * fu) * (1 - fv) + (a[(j + 1) * f.n + i]! * (1 - fu) + a[(j + 1) * f.n + i + 1]! * fu) * fv
}
