import { BufferAttribute, BufferGeometry, Color } from 'three'
import { createLightTrace, scanArchitecture, traceNow, type LightTrace } from './fields.ts'
import { CELL, cellIndex, GRID_EXTENT, GRID_SIZE } from './grid.ts'
import { ARCH_RUBBLE } from './materials.ts'
import { unpackEco } from './persist.ts'
import type { Runtime } from './runtime.ts'
import { advanceEco, type Eco, type Settings } from './simulation.ts'
import type { Statics } from './statics.ts'
import type { Quality } from './view.ts'

/**
 * Shadow Ecology 0.2 — parallel worlds. The live world is the only full
 * simulation. The others share its past up to a kept day-start (the
 * divergence), then run headless from that state under one disturbance,
 * applied only through existing systems (manual weather, decay speed), up to
 * the moment the field was opened. Each is drawn as a cheap proxy:
 * one low-resolution terrain mesh coloured by its fields and one instanced
 * mesh of architecture columns.
 *
 *   common past → disturbance → divergence → different traces
 */
export type Divergence = 'rain' | 'drought' | 'collapse' | 'wind'
export type WorldId = 'this' | Divergence

export const ALTERNATES: readonly Divergence[] = ['rain', 'drought', 'collapse', 'wind']

export const WORLD_TEXT: Record<WorldId, { label: string; note: string }> = {
  this: { label: 'This world', note: 'As lived: the weather that actually came. The only world simulated live.' },
  rain: { label: 'Prolonged rain', note: 'Rain without pause since the divergence: wet ground, high lakes, faster weathering.' },
  drought: { label: 'Drought', note: 'No rain since the divergence: the ground dries out, lakes drop, shade-seeking vegetation thins.' },
  collapse: { label: 'Structural collapse', note: 'Decay six times faster since the divergence: structures weather, fail and fall to rubble.' },
  wind: { label: 'Strong wind', note: 'A gale held since the divergence: the ground dries sooner and exposed faces weather.' },
}

/** Decay speed multiplier in the collapse branch. */
const COLLAPSE_DECAY = 6
/** Hours a branch advances per step; light is re-traced every `TRACE_HOURS`, as a day jump does. */
const STEP_HOURS = 0.5
const TRACE_HOURS = 6

export type Branch = {
  id: Divergence
  /** Unpacked on its first step, so no single tick inflates every fork. */
  work: Eco | null
  packed: Uint8Array
  noon: number
  trace: LightTrace
  settings: Settings
  untraced: number
}

export type ParallelPlan = {
  /** Day whose start all worlds share, and its clock. */
  fromDay: number
  fromClock: number
  /** Clock the branches run to: the live world's when the field was opened. */
  until: number
  epoch: number
  branches: Branch[]
}

/** Pushes a forked world off its course through the systems that already exist. */
function disturb(eco: Eco, settings: Settings, id: Divergence) {
  const w = eco.weather
  if (id === 'collapse') {
    settings.decaySpeed *= COLLAPSE_DECAY
    return
  }
  w.auto = false
  w.on = { rain: id === 'rain', fog: false, wind: id === 'wind' }
  if (id === 'wind') w.windPower = 1
  // Past the dry spell, so the ground starts drying at once.
  if (id === 'drought') w.held = Math.max(w.held, 40)
}

/** Forks the alternates from the latest kept day at least two days back (Day 1 early on). */
export function planParallel(rt: Runtime): ParallelPlan | null {
  const kept = [...rt.days.keys()].sort((a, b) => a - b)
  if (!kept.length) return null
  const back = kept.filter((d) => d <= rt.eco.day - 2)
  const fromDay = back.length ? back[back.length - 1]! : kept[0]!
  const packed = rt.days.get(fromDay)!
  const branches: Branch[] = ALTERNATES.map((id) => ({
    id,
    work: null,
    packed,
    noon: rt.eco.noon,
    trace: createLightTrace(),
    settings: { ...rt.settings, controlled: 0, lens: null },
    untraced: 0,
  }))
  const first = forkOf(branches[0]!)
  return { fromDay, fromClock: first.clock, until: rt.eco.clock, epoch: rt.epoch, branches }
}

function forkOf(branch: Branch): Eco {
  if (branch.work) return branch.work
  const work = unpackEco(branch.packed)
  work.noon = branch.noon
  disturb(work, branch.settings, branch.id)
  branch.work = work
  return work
}

export const branchDone = (branch: Branch, until: number) => !!branch.work && until - branch.work.clock <= 1e-6

/** Unpacks a branch, or advances it a few hours; true once it has reached the plan's clock. */
export function stepBranch(branch: Branch, statics: Statics, until: number): boolean {
  if (!branch.work) {
    forkOf(branch)
    return false
  }
  const work = branch.work
  const left = until - work.clock
  if (left > 1e-6) {
    const hours = Math.min(STEP_HOURS, left)
    advanceEco(work, statics, branch.settings, hours)
    branch.untraced += hours
    if (branch.untraced >= TRACE_HOURS - 1e-6 || hours >= left - 1e-6) {
      scanArchitecture(work.fields, statics, work.arch)
      work.fields.insolation = traceNow(branch.trace, statics, work.arch, work.noon)
      branch.untraced = 0
    }
  }
  return branchDone(branch, until)
}

export type Traits = { voxels: number; fallen: number; light: number; shade: number; moisture: number; lake: number; paths: number }

/** The few state variables the worlds are compared by. */
export function traitsOf(eco: Eco, statics: Statics): Traits {
  let moisture = 0
  let n = 0
  for (let c = 0; c < GRID_SIZE * GRID_SIZE; c += 1) {
    if (!statics.inside[c] || statics.water[c]) continue
    moisture += eco.fields.moisture[c]!
    n += 1
  }
  let light = 0
  let shade = 0
  for (const p of eco.veg.plants) {
    if (p.died >= 0) continue
    if (p.kind === 'exposure') light += 1
    else shade += 1
  }
  return {
    voxels: eco.arch.count,
    fallen: eco.arch.collapsed + eco.arch.weathered,
    light,
    shade,
    moisture: n ? moisture / n : 0,
    lake: eco.fields.waterOffset,
    paths: eco.fields.trailLength ?? 0,
  }
}

/** Proxy terrain vertices across, per quality. */
export const PROXY_GRID: Record<Quality, number> = { low: 48, normal: 80, high: 128 }

export type Proxy = {
  terrain: BufferGeometry
  /** Per architecture column: x, z, ground, height. */
  columns: Float32Array
  /** Column footprint, world units. */
  width: number
}

const PALETTE = {
  low: new Color('#a39d93'),
  high: new Color('#d3cbbd'),
  exposure: new Color('#a3a078'),
  shelter: new Color('#56655f'),
  dead: new Color('#8d877a'),
  trail: new Color('#6f5c48'),
  rubble: new Color(ARCH_RUBBLE),
  water: new Color('#3155e4'),
  bed: new Color('#857a6c'),
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** A low-resolution stand-in for a world: its ground coloured by water, vegetation, paths and rubble. */
export function buildProxy(eco: Eco, statics: Statics, n: number): Proxy {
  const G = GRID_SIZE
  const step = (G - 1) / (n - 1)
  const half = Math.max(0, Math.floor(step / 2))
  const heights = statics.ground.heights
  const f = eco.fields
  const position = new Float32Array(n * n * 3)
  const color = new Float32Array(n * n * 3)
  const inside = new Uint8Array(n * n)
  const columns: number[] = []
  const rgb = [0, 0, 0]
  const mix = (c: Color, t: number) => {
    rgb[0] += (c.r - rgb[0]!) * t
    rgb[1] += (c.g - rgb[1]!) * t
    rgb[2] += (c.b - rgb[2]!) * t
  }
  for (let vj = 0; vj < n; vj += 1) {
    for (let vi = 0; vi < n; vi += 1) {
      const ci = Math.round(vi * step)
      const cj = Math.round(vj * step)
      const centre = cellIndex(ci, cj)
      const v = vi + vj * n
      const x = -GRID_EXTENT + (ci + 0.5) * CELL
      const z = -GRID_EXTENT + (cj + 0.5) * CELL
      let h = 0
      let moisture = 0
      let wet = 0
      let exposure = 0
      let shelter = 0
      let dead = 0
      let trail = 0
      let rubble = 0
      let top = 0
      let count = 0
      for (let dj = -half; dj <= half; dj += 1) {
        for (let di = -half; di <= half; di += 1) {
          const i = ci + di
          const j = cj + dj
          if (i < 0 || j < 0 || i >= G || j >= G) continue
          const c = cellIndex(i, j)
          if (!statics.inside[c]) continue
          count += 1
          h += heights[c]!
          moisture += f.moisture[c]!
          wet += f.wetness[c]!
          exposure += f.exposureCover[c]!
          shelter += f.shelterCover[c]!
          dead += f.deadVegetation[c]!
          trail = Math.max(trail, f.trail[c]!)
          rubble = Math.max(rubble, f.rubble[c]!)
          top = Math.max(top, f.archHeight[c]!)
        }
      }
      position[v * 3] = x
      position[v * 3 + 2] = z
      if (!count || !statics.inside[centre]) {
        position[v * 3 + 1] = heights[centre]!
        continue
      }
      inside[v] = 1
      h /= count
      moisture /= count
      wet /= count
      exposure /= count
      shelter /= count
      dead /= count
      let y = h
      const e = statics.elevation[centre]!
      rgb[0] = PALETTE.low.r + (PALETTE.high.r - PALETTE.low.r) * e
      rgb[1] = PALETTE.low.g + (PALETTE.high.g - PALETTE.low.g) * e
      rgb[2] = PALETTE.low.b + (PALETTE.high.b - PALETTE.low.b) * e
      const darken = (1 - 0.22 * smooth(25, 55, statics.slope[centre]!)) * (1 - 0.3 * moisture - 0.3 * wet)
      rgb[0] *= darken
      rgb[1] *= darken
      rgb[2] *= darken * (1 + 0.08 * wet)
      mix(PALETTE.exposure, smooth(0.02, 0.35, exposure) * 0.85)
      mix(PALETTE.shelter, smooth(0.02, 0.35, shelter) * 0.85)
      mix(PALETTE.dead, smooth(0.02, 0.3, dead) * 0.6)
      const worn = smooth(0.05, 0.3, trail) * 0.75
      rgb[0] *= 1 + (PALETTE.trail.r - 1) * worn
      rgb[1] *= 1 + (PALETTE.trail.g - 1) * worn
      rgb[2] *= 1 + (PALETTE.trail.b - 1) * worn
      mix(PALETTE.rubble, smooth(0.0, 0.04, rubble) * 0.9)
      if (statics.water[centre]) {
        const surface = statics.waterLevel[centre]! + f.waterOffset
        if (surface > h - 0.005) {
          y = surface
          rgb[0] = PALETTE.water.r
          rgb[1] = PALETTE.water.g
          rgb[2] = PALETTE.water.b
        } else mix(PALETTE.bed, 0.8)
      }
      position[v * 3 + 1] = y
      color[v * 3] = rgb[0]!
      color[v * 3 + 1] = rgb[1]!
      color[v * 3 + 2] = rgb[2]!
      if (top > 0.06) columns.push(x, z, h, top)
    }
  }
  const index: number[] = []
  for (let vj = 0; vj < n - 1; vj += 1) {
    for (let vi = 0; vi < n - 1; vi += 1) {
      const a = vi + vj * n
      const b = a + 1
      const c = a + n
      const d = c + 1
      if (inside[a] && inside[b] && inside[c] && inside[d]) index.push(a, c, b, b, c, d)
    }
  }
  const terrain = new BufferGeometry()
  terrain.setAttribute('position', new BufferAttribute(position, 3))
  terrain.setAttribute('color', new BufferAttribute(color, 3))
  terrain.setIndex(index)
  terrain.computeVertexNormals()
  return { terrain, columns: Float32Array.from(columns), width: step * CELL * 0.92 }
}
