import { ClampToEdgeWrapping, DataTexture, LinearFilter, RGBAFormat, UnsignedByteType } from 'three'
import { archIndex, forEachOccupied, latticeX, latticeY, latticeZ, type Architecture } from './architecture.ts'
import { clamp01, smoothstep } from './core.ts'
import { GRID_EXTENT, sampleGrid } from './grid.ts'
import type { Statics } from './statics.ts'
import { windSpeed, type Weather } from './weather.ts'

/**
 * Shadow Ecology 0.2 — wind as a vector field. The prevailing heading and
 * strength (weather.ts) are reshaped by the terrain on a coarse grid:
 *
 *   valleys     turn the flow along their axis (channelling) and speed it a little
 *   slopes      deflect flow blowing uphill around the rise
 *   ridges      and high ground accelerate it
 *   lee & hollows  downwind of higher ground, and in enclosed ground, it weakens
 *   architecture   large structures turn the flow aside and leave a wind shadow behind
 *
 * The field depends on the terrain, a coarse map of how much architecture
 * stands in each cell, and the heading, so it is rebuilt when the heading
 * turns or the architecture has changed (at most every half hour of world
 * time), and scaled by the current speed when read. The
 * same field drives plant sway, wind on the water, the tracers that show
 * it, and the wind stress architecture can read.
 */
export const WIND_GRID = 40
const STEP = (2 * GRID_EXTENT) / WIND_GRID
/** Heading change (radians) before the field is rebuilt. */
const REBUILD = 0.03
/** Largest local speed-up the field holds; the texture encodes ±this. */
export const WIND_RANGE = 2.5

/** World hours between rereading the architecture into the wind field. */
const OBSTACLE_HOURS = 0.5

export type WindField = {
  heading: number
  /** Per coarse cell: direction × local speed factor for a prevailing speed of 1. */
  vx: Float32Array
  vz: Float32Array
  version: number
  obstacles: Obstacles | null
}

/** How much architecture blocks each coarse cell, 0…1, read from the voxels now and then. */
type Obstacles = { block: Float32Array; archVersion: number; clock: number }

const fields = new WeakMap<Statics, WindField>()
const obstacleMaps = new WeakMap<Architecture, Obstacles>()
let builds = 0

const cellX = (i: number) => -GRID_EXTENT + (i + 0.5) * STEP

/**
 * Mean height of architecture above the ground per coarse cell, so a broad
 * mass blocks more than a thin spire, eased into a 0…1 blocking share.
 */
function readObstacles(a: Architecture): Float32Array {
  const n = WIND_GRID
  const sum = new Float32Array(n * n)
  const top = Math.min(a.ny - 1, Math.ceil((a.top - latticeY(a, 0)) / a.voxel) + 1)
  forEachOccupied(a, (col, i, k) => {
    const base = Math.max(0, a.groundJ[col]!)
    for (let j = top; j > base; j -= 1) {
      if (!a.solid[archIndex(a, i, j, k)]) continue
      const ci = Math.floor((latticeX(a, i) + GRID_EXTENT) / STEP)
      const cj = Math.floor((latticeZ(a, k) + GRID_EXTENT) / STEP)
      if (ci >= 0 && cj >= 0 && ci < n && cj < n) sum[ci + cj * n]! += (j - base) * a.voxel
      break
    }
  })
  const perCell = (STEP / a.voxel) ** 2
  for (let c = 0; c < n * n; c += 1) sum[c] = smoothstep(0.08, 0.9, sum[c]! / perCell)
  return sum
}

function obstaclesOf(a: Architecture, clock: number): Obstacles {
  let map = obstacleMaps.get(a)
  if (!map || (map.archVersion !== a.version && Math.abs(clock - map.clock) >= OBSTACLE_HOURS)) {
    map = { block: readObstacles(a), archVersion: a.version, clock }
    obstacleMaps.set(a, map)
  }
  return map
}

function build(statics: Statics, heading: number, obstacles: Obstacles | null): WindField {
  const n = WIND_GRID
  const px = Math.cos(heading)
  const pz = Math.sin(heading)
  const vx = new Float32Array(n * n)
  const vz = new Float32Array(n * n)
  const h = (x: number, z: number) => sampleGrid(statics.ground.heights, x, z)
  const block = obstacles?.block ?? null
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const x = cellX(i)
      const z = cellX(j)
      const index = i + j * n
      const cell = statics.cellAt(x, z)
      if (cell < 0 || !statics.inside[cell]) {
        vx[index] = px
        vz[index] = pz
        continue
      }
      const h0 = h(x, z)
      const gx = (h(x + STEP, z) - h(x - STEP, z)) / (2 * STEP)
      const gz = (h(x, z + STEP) - h(x, z - STEP)) / (2 * STEP)
      const g = Math.hypot(gx, gz)
      let dx = px
      let dz = pz
      if (g > 1e-4) {
        const ux = gx / g
        const uz = gz / g
        // Blowing uphill, part of the flow turns aside around the rise.
        const up = dx * ux + dz * uz
        if (up > 0) {
          const deflect = 0.75 * smoothstep(0.08, 0.6, g)
          dx -= ux * up * deflect
          dz -= uz * up * deflect
        }
        // In a valley the flow runs along its axis, the way the contours go.
        let tx = -uz
        let tz = ux
        if (tx * px + tz * pz < 0) {
          tx = -tx
          tz = -tz
        }
        const channel = 0.85 * clamp01(sampleGrid(statics.valley, x, z) * 1.6)
        dx += (tx - dx) * channel
        dz += (tz - dz) * channel
      }
      // Architecture: the flow turns aside around a structure, slows inside it and drops in its shadow.
      let built = 1
      if (block) {
        const bx = (sample(block, x + STEP, z) - sample(block, x - STEP, z)) / 2
        const bz = (sample(block, x, z + STEP) - sample(block, x, z - STEP)) / 2
        const b = Math.hypot(bx, bz)
        if (b > 1e-3) {
          const into = (dx * bx + dz * bz) / b
          if (into > 0) {
            const deflect = 0.9 * smoothstep(0.02, 0.3, b)
            dx -= (bx / b) * into * deflect
            dz -= (bz / b) * into * deflect
          }
        }
        let shadow = 0
        for (let s = 1; s <= 5; s += 1) shadow = Math.max(shadow, sample(block, x - px * s * STEP, z - pz * s * STEP) * (1 - s / 6.5))
        built = (1 - 0.45 * sample(block, x, z)) * (1 - 0.75 * shadow)
      }
      const length = Math.hypot(dx, dz) || 1
      // Higher ground upwind casts a wind shadow.
      let lee = 0
      for (const d of [0.7, 1.4, 2.1]) lee = Math.max(lee, h(x - px * d, z - pz * d) - h0 - d * 0.18)
      const speed =
        (1 + 0.7 * sampleGrid(statics.ridge, x, z) + 0.35 * smoothstep(0.45, 1, sampleGrid(statics.elevation, x, z)) + 0.25 * sampleGrid(statics.valley, x, z)) *
        (1 - 0.55 * clamp01(sampleGrid(statics.enclosure, x, z))) *
        (1 - 0.65 * smoothstep(0.05, 0.7, lee)) *
        built
      vx[index] = (dx / length) * speed
      vz[index] = (dz / length) * speed
    }
  }
  // One smoothing pass so the flow turns gradually between cells.
  const sx = new Float32Array(n * n)
  const sz = new Float32Array(n * n)
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      let ax = 0
      let az = 0
      let w = 0
      for (let dj = -1; dj <= 1; dj += 1) {
        for (let di = -1; di <= 1; di += 1) {
          const ii = i + di
          const jj = j + dj
          if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue
          const k = di === 0 && dj === 0 ? 2 : 1
          ax += vx[ii + jj * n]! * k
          az += vz[ii + jj * n]! * k
          w += k
        }
      }
      sx[i + j * n] = ax / w
      sz[i + j * n] = az / w
    }
  }
  builds += 1
  return { heading, vx: sx, vz: sz, version: builds, obstacles }
}

/**
 * The field for the current heading and architecture, rebuilt only when the
 * heading has turned or the obstacle map was reread.
 */
export function windField(statics: Statics, weather: Weather, arch: Architecture | null = null, clock = 0): WindField {
  const heading = weather.windDir ?? 0
  const obstacles = arch ? obstaclesOf(arch, clock) : null
  let field = fields.get(statics)
  if (
    !field ||
    field.obstacles !== obstacles ||
    Math.abs(Math.atan2(Math.sin(heading - field.heading), Math.cos(heading - field.heading))) > REBUILD
  ) {
    field = build(statics, heading, obstacles)
    fields.set(statics, field)
  }
  return field
}

/** The field at (x, z) for a prevailing speed of 1: direction × local speed factor. */
export function fieldAt(field: WindField, x: number, z: number): [number, number] {
  return [sample(field.vx, x, z), sample(field.vz, x, z)]
}

function sample(values: Float32Array, x: number, z: number) {
  const n = WIND_GRID
  const fx = Math.min(n - 1, Math.max(0, (x + GRID_EXTENT) / STEP - 0.5))
  const fz = Math.min(n - 1, Math.max(0, (z + GRID_EXTENT) / STEP - 0.5))
  const i = Math.min(n - 2, Math.floor(fx))
  const j = Math.min(n - 2, Math.floor(fz))
  const tx = fx - i
  const tz = fz - j
  const a = values[i + j * n]!
  const b = values[i + 1 + j * n]!
  const c = values[i + (j + 1) * n]!
  const d = values[i + 1 + (j + 1) * n]!
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz
}

/** Wind at world (x, z), world units per hour-ish scale: direction × local speed × prevailing speed. */
export function windAt(statics: Statics, weather: Weather, x: number, z: number, arch: Architecture | null = null, clock = 0): [number, number] {
  const field = windField(statics, weather, arch, clock)
  const s = windSpeed(weather)
  return [sample(field.vx, x, z) * s, sample(field.vz, x, z) * s]
}

/**
 * Wind stress 0…1 on something standing at (x, y, z): local wind, more the
 * higher it stands above the ground. For architecture to read later.
 */
export function windStress(statics: Statics, weather: Weather, x: number, y: number, z: number, arch: Architecture | null = null, clock = 0): number {
  const [wx, wz] = windAt(statics, weather, x, z, arch, clock)
  const above = Math.max(0, y - statics.groundAt(x, z))
  return clamp01((Math.hypot(wx, wz) / WIND_RANGE) * (1 + 0.25 * Math.min(4, above)))
}

/** The field as a texture for the shaders: rg = direction × local speed (±WIND_RANGE). */
export function createWindTexture(): DataTexture {
  const texture = new DataTexture(new Uint8Array(WIND_GRID * WIND_GRID * 4), WIND_GRID, WIND_GRID, RGBAFormat, UnsignedByteType)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.userData.version = -1
  return texture
}

export function writeWindTexture(texture: DataTexture, field: WindField) {
  if (texture.userData.version === field.version) return
  const data = texture.image.data as Uint8Array
  const enc = (v: number) => Math.round(clamp01(0.5 + (0.5 * v) / WIND_RANGE) * 255)
  for (let k = 0; k < WIND_GRID * WIND_GRID; k += 1) {
    data[k * 4] = enc(field.vx[k]!)
    data[k * 4 + 1] = enc(field.vz[k]!)
    data[k * 4 + 2] = 0
    data[k * 4 + 3] = 255
  }
  texture.userData.version = field.version
  texture.needsUpdate = true
}
