import { smoothstep } from '../project02/core.ts'
import { vnoise } from './livingStrata.ts'

/**
 * Shadow Ecology 0.3 — Living Architecture's lifecycle, as time fields over the organism's distance field.
 *
 * Nothing is simulated frame by frame. Every sample of the grid is given, once, the age at which tissue arrives there
 * (`arrival`) and, where tissue later recedes, the age at which it goes (`decay`). The surface at any age is then a pure
 * function of that age, so the lifecycle is deterministic and reversible, and the mature reference (age 1) is exactly
 * the organism's own distance field.
 *
 *   arrival   a shortest-path spread through the tissue from where it roots (the ground under its oldest bodies), each
 *             part with its own speed and the delay with which it starts once reached, the speed modulated by a gentle
 *             noise so the fronts are lobed. Growth therefore spreads from tissue that already exists. The per-sample
 *             speed is where light, moisture and creatures can act later.
 *   decay     tissue present in the full field (`dFull`, no recession) but not in the reference (`dRef`) has receded:
 *             each feature in its own window of ages, from the exposed surface inward.
 *   shape     at age a: decay blends each receding sample from dFull to dRef over its window; tissue not yet arrived is
 *             cut away by a front (smooth max with the arrival time, as a distance); young tissue is a little leaner,
 *             thickening as it matures. Once everything has arrived, matured and receded, the shape is dRef exactly.
 *
 * Fields are signed distances, positive outside, on the grid the organism was sampled on.
 */

export type LifeGrid = { dx: number; dy: number; dz: number; step: number }

/** Normalised age by which all growth has arrived; the rest of the lifecycle (maturing, receding) finishes before 1. */
export const GROWN_BY = 0.85
/** How long, in age, young tissue takes to mature (to reach its full thickness and colour). */
export const YOUTH = 0.12
/** How much leaner fresh tissue is than mature tissue, in metres. */
const LEAN = 0.5
/** The front's rounding, in metres. */
const FRONT_K = 1.2
/** How long one sample takes to recede, in age. */
export const DECAY_SPAN = 0.04
/** No decay here. */
export const NEVER = 9

export type GrowthSpec = {
  /** Growth speed of each part (by the `part` id of each sample), in metres per unit of raw time. */
  speed: number[]
  /** Raw time a part waits before growing once tissue reaches it. */
  delay: number[]
  /** Crossings from one part into another that growth may not make. */
  barred?: [number, number][]
  /** Where growth starts, as grid indices, and the raw time each starts. */
  seeds: { index: number; time: number }[]
  /** Samples farther outside than this (metres) are not tissue and are not part of the spread. */
  shell: number
  noiseSeed: number
  /** A per-sample multiplier on the speed (growth toward light), 1 where absent. */
  boost?: Float32Array
}

export type Arrival = { time: Float32Array; scale: number; rawMax: number; ms: number }

const NEIGHBOURS: [number, number, number, number][] = (() => {
  const out: [number, number, number, number][] = []
  for (let z = -1; z <= 1; z += 1) for (let y = -1; y <= 1; y += 1) for (let x = -1; x <= 1; x += 1) if (x || y || z) out.push([x, y, z, Math.hypot(x, y, z)])
  return out
})()

/** Arrival ages, normalised so the last of the tissue (of the full field) arrives at GROWN_BY. Outside the shell: 0 (never cut). */
export function arrivalTimes(grid: LifeGrid, dFull: Float32Array, part: Uint8Array, spec: GrowthSpec): Arrival {
  const started = performance.now()
  const { dx, dy, dz, step } = grid
  const n = dx * dy * dz
  const raw = new Float32Array(n).fill(Infinity)
  const pace = new Float32Array(n)
  for (let z = 0; z < dz; z += 1) {
    for (let y = 0; y < dy; y += 1) {
      for (let x = 0; x < dx; x += 1) {
        const i = (z * dy + y) * dx + x
        if (dFull[i]! >= spec.shell) continue
        const lobed = 0.75 + 0.5 * vnoise(x / 7 + spec.noiseSeed, y / 7, z / 7)
        pace[i] = step / (spec.speed[part[i]!]! * lobed * (spec.boost ? spec.boost[i]! : 1))
      }
    }
  }
  // A binary heap of (raw time, index), with lazy deletion.
  let heapT = new Float64Array(1 << 16)
  let heapI = new Int32Array(1 << 16)
  let size = 0
  const push = (t: number, i: number) => {
    if (size === heapT.length) {
      const nt = new Float64Array(size * 2)
      nt.set(heapT)
      heapT = nt
      const ni = new Int32Array(size * 2)
      ni.set(heapI)
      heapI = ni
    }
    let k = size++
    while (k > 0) {
      const p = (k - 1) >> 1
      if (heapT[p]! <= t) break
      heapT[k] = heapT[p]!
      heapI[k] = heapI[p]!
      k = p
    }
    heapT[k] = t
    heapI[k] = i
  }
  const pop = () => {
    const t = heapT[0]!
    const i = heapI[0]!
    size -= 1
    const lt = heapT[size]!
    const li = heapI[size]!
    let k = 0
    for (;;) {
      let c = 2 * k + 1
      if (c >= size) break
      if (c + 1 < size && heapT[c + 1]! < heapT[c]!) c += 1
      if (heapT[c]! >= lt) break
      heapT[k] = heapT[c]!
      heapI[k] = heapI[c]!
      k = c
    }
    heapT[k] = lt
    heapI[k] = li
    return [t, i] as const
  }
  for (const s of spec.seeds) {
    if (pace[s.index]! > 0 && s.time < raw[s.index]!) {
      raw[s.index] = s.time
      push(s.time, s.index)
    }
  }
  const barred = new Set((spec.barred ?? []).map(([a, b]) => a * 256 + b))
  const sx = 1
  const sy = dx
  const sz = dx * dy
  while (size > 0) {
    const [t, i] = pop()
    if (t > raw[i]!) continue
    const x = i % dx
    const y = Math.floor(i / dx) % dy
    const z = Math.floor(i / (dx * dy))
    const from = part[i]!
    for (const [ox, oy, oz, len] of NEIGHBOURS) {
      const nx = x + ox
      const ny = y + oy
      const nz = z + oz
      if (nx < 0 || ny < 0 || nz < 0 || nx >= dx || ny >= dy || nz >= dz) continue
      const j = i + ox * sx + oy * sy + oz * sz
      const p = pace[j]!
      if (p === 0) continue
      const to = part[j]!
      if (to !== from && barred.has(from * 256 + to)) continue
      const nt = t + len * p + (to !== from ? spec.delay[to]! : 0)
      if (nt < raw[j]!) {
        raw[j] = nt
        push(nt, j)
      }
    }
  }
  let rawMax = 0
  for (let i = 0; i < n; i += 1) if (dFull[i]! < 0 && raw[i]! < Infinity && raw[i]! > rawMax) rawMax = raw[i]!
  rawMax = Math.max(1, rawMax)
  const time = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    if (pace[i] === 0) continue
    // Tissue the spread never reached (cut off by the grid) arrives with the last of it.
    time[i] = Math.min(GROWN_BY, (raw[i]! === Infinity ? rawMax : raw[i]!) * (GROWN_BY / rawMax))
  }
  return { time, scale: rawMax / GROWN_BY, rawMax, ms: Math.round(performance.now() - started) }
}

/**
 * Decay ages for tissue that has receded (in dFull, not in dRef): per feature (`cut`, 1…), within its window of ages,
 * from the exposed surface inward. Never before the tissue has arrived and matured a little. Elsewhere NEVER.
 */
export function decayTimes(grid: LifeGrid, dFull: Float32Array, dRef: Float32Array, cut: Uint8Array, arrival: Float32Array, windows: Record<number, [number, number]>): { time: Float32Array; samples: number; ms: number } {
  const started = performance.now()
  const { dx, dy, dz } = grid
  const n = dx * dy * dz
  const time = new Float32Array(n).fill(NEVER)
  const depth = new Int32Array(n).fill(-1)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0
  let samples = 0
  const region = (i: number) => dRef[i]! - dFull[i]! > 0.02 && cut[i]! > 0
  for (let i = 0; i < n; i += 1) {
    if (!region(i)) continue
    samples += 1
    if (dFull[i]! > -0.8) {
      depth[i] = 0
      queue[tail++] = i
    }
  }
  const steps = [1, -1, dx, -dx, dx * dy, -dx * dy]
  while (head < tail) {
    const i = queue[head++]!
    for (const s of steps) {
      const j = i + s
      if (j < 0 || j >= n || depth[j]! >= 0 || !region(j)) continue
      depth[j] = depth[i]! + 1
      queue[tail++] = j
    }
  }
  const deepest: Record<number, number> = {}
  for (let i = 0; i < n; i += 1) if (depth[i]! >= 0) deepest[cut[i]!] = Math.max(deepest[cut[i]!] ?? 0, depth[i]!)
  for (let i = 0; i < n; i += 1) {
    if (!region(i)) continue
    const w = windows[cut[i]!] ?? [0.7, 0.85]
    const d = depth[i]! < 0 ? 1 : depth[i]! / Math.max(1, deepest[cut[i]!] ?? 1)
    const start = Math.max(w[0], arrival[i]! + 0.06)
    // Done by 0.86, so that what it leaves has weathered to the mature colour by age 1 (see livingMaterial.ts).
    time[i] = Math.min(0.86, start + (Math.max(w[1], start + 0.04) - start) * d)
  }
  return { time, samples, ms: Math.round(performance.now() - started) }
}

/**
 * Later life, past the reference form: how far, in organism units, the lit growth fronts have grown on (`grow`) and the
 * shaded old tissue has receded (`recede`), and how far lit recessions have refilled (`regen`, 0…1). The amounts come from
 * the population's history (livingEcology.ts); where they act comes from the organism's own shape (`lateWeights`).
 */
export type LateState = { grow: number; recede: number; regen: number; /** The lab's lifecycle past death, 0 to 1: structural failure, rubble and a mineral apron (livingOverhang3.ts). */ ruin?: number }
export type LateWeights = { grow: Float32Array; recede: Float32Array; regen: Float32Array; historical: Float32Array }

/** A separable box blur of a field over its 3×3×3 neighbourhood, in place. */
function blur(grid: LifeGrid, f: Float32Array) {
  const { dx, dy, dz } = grid
  const tmp = new Float32Array(f.length)
  const strides = [1, dx, dx * dy]
  const sizes = [dx, dy, dz]
  for (let axis = 0; axis < 3; axis += 1) {
    const st = strides[axis]!
    const n = sizes[axis]!
    for (let i = 0; i < f.length; i += 1) {
      const c = Math.floor(i / st) % n
      const a = c > 0 ? f[i - st]! : f[i]!
      const b = c < n - 1 ? f[i + st]! : f[i]!
      tmp[i] = (a + f[i]! + b) / 3
    }
    f.set(tmp)
  }
}

/**
 * Where later life acts: weights 0…1 per sample, smoothed so the surface moves as tissue, not as voxels.
 *   grow    the youngest lit tissue (the tips of the last growth), in lobes
 *   recede  erosion in patches (a 3D noise at about 7 m, so cavities, not a uniform thinning), stronger where shaded and
 *           on old tissue, reaching up to 10 m in so it can open holes through thin shelves; never at the footing
 *   regen   how lit each sample is: lit erosion heals (partly), and lit historical recessions refill (a little)
 */
export function lateWeights(grid: LifeGrid, dRef: Float32Array, arrival: Float32Array, decay: Float32Array, lit: Float32Array, aboveGround: Float32Array, noiseSeed: number): LateWeights {
  const n = dRef.length
  const grow = new Float32Array(n)
  const recede = new Float32Array(n)
  const regen = new Float32Array(n)
  // The youngest tissue nearby (the arrival field only reaches a little way outside the surface: carry it outward).
  const young = new Float32Array(arrival)
  const { dx, dy } = grid
  for (let pass = 0; pass < 4; pass += 1) {
    for (let i = 0; i < n; i += 1) {
      if (young[i]! > 0 || dRef[i]! > 5) continue
      const m = Math.max(young[i - 1] ?? 0, young[i + 1] ?? 0, young[i - dx] ?? 0, young[i + dx] ?? 0, young[i - dx * dy] ?? 0, young[i + dx * dy] ?? 0)
      if (m > 0) young[i] = m
    }
  }
  const step = grid.step
  for (let i = 0; i < n; i += 1) {
    const d = dRef[i]!
    if (d < -10 || d > 4.5) continue
    const light = lit[i]!
    const footing = smoothstep(2, 7, aboveGround[i]!)
    const x = (i % dx) * step
    const y = (Math.floor(i / dx) % dy) * step
    const z = Math.floor(i / (dx * dy)) * step
    const lobe = vnoise(x / 5 + noiseSeed, y / 5, z / 5 + 3.3)
    const patch = vnoise(x / 7.5 + 11.1, y / 6 + noiseSeed, z / 7.5)
    if (d > -1) grow[i] = light * smoothstep(0.6, 0.88, young[i]!) * smoothstep(0.42, 0.62, lobe) * footing
    if (d < 1.5) {
      const old = 1 - smoothstep(0.25, 0.75, arrival[i]! > 0 ? arrival[i]! : young[i]!)
      recede[i] = smoothstep(0.44, 0.7, patch) * (0.35 + 0.65 * (1 - light)) * (0.45 + 0.55 * old) * footing
    }
    regen[i] = light * (decay[i]! < NEVER ? 1 : 0.85)
  }
  blur(grid, grow)
  blur(grid, recede)
  return { grow, recede, regen, historical: decay }
}

/** The organism's field at an age, written into `out` with the mesher's sign (inside positive). */
export function fieldAt(
  age: number,
  dRef: Float32Array,
  dFull: Float32Array | null,
  arrival: Arrival,
  decay: Float32Array | null,
  out: Float32Array,
  late?: { state: LateState; weights: LateWeights },
) {
  const n = dRef.length
  const t = arrival.time
  const scale = arrival.scale
  for (let i = 0; i < n; i += 1) {
    const r = dRef[i]!
    let d = r
    if (decay && dFull) {
      const td = decay[i]!
      if (td < NEVER) {
        const s = smoothstep(td, td + DECAY_SPAN, age)
        if (s < 1) d = s <= 0 ? dFull[i]! : dFull[i]! + (r - dFull[i]!) * s
      }
    }
    if (late) {
      const { state, weights } = late
      // Grown on at the lit tips; eroded in patches (a positive distance is outside), the lit erosion healing as it
      // regenerates; the lit historical recessions refilled a little.
      const heal = state.regen * weights.regen[i]!
      d += state.recede * weights.recede[i]! * (1 - heal) - state.grow * weights.grow[i]!
      if (heal > 0 && dFull && weights.historical[i]! < NEVER) d += (dFull[i]! - d) * heal * 0.5
    }
    const tb = t[i]!
    const since = age - tb
    if (since < YOUTH) d += LEAN * (1 - smoothstep(0, YOUTH, since))
    const g = (tb - age) * scale
    // Smooth max with the front; exact (no change) where the front is far behind.
    const h = Math.max(FRONT_K - Math.abs(d - g), 0) / FRONT_K
    if (h > 0 || g > d) d = Math.max(d, g) + h * h * FRONT_K * 0.25
    out[i] = -d
  }
  return out
}
