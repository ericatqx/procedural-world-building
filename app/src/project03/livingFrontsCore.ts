/**
 * Shadow Ecology 0.3 — Living Architecture, the fronts prototype (?architecture=fronts): the pure growth and field code, with no
 * imports, so it can be run and checked on its own. See livingFronts.ts for the site, the surface and the material.
 *
 * ONE ORGANISM, FIVE RULES. A hub at the site sends out a few GROWTH FRONTS: tips that advance a fixed distance a tick, leaving a
 * member behind them (a chain of nodes). Nothing else is placed.
 *   1 anchor    the hub and a ring of root nodes thicken into a mound; every front starts from a root, so nothing floats
 *   2 rise      a front leaves the mound steeply, steered a little toward the light, and curls more the higher it gets, so each
 *               member climbs, turns over and comes back down: the height is what the curl allows, not a set value
 *   3 fuse      a front that has turned downward ends where it meets something: another member (it joins it), or the ground
 *               (it becomes a pier). An arch is simply a front that fused at both ends, and the space under it an opening
 *   4 fork      a front that is high and lit may send a lower, more lateral front off to one side, up to a small total; the
 *               new front fuses too, so side spans have supports
 *   5 thicken   thickness is taken from the load a member carries (the pipe model), so the roots and piers are stout and the
 *               free ends thin; adjacent members merge with a wide fillet, which makes a web wherever they run close
 * LATE LIFE. Thin members weather first and recede from their free ends; fused members hold. Nothing detaches.
 * INPUTS. `FrontsInputs` is the whole interface to the environment: light (how freely it climbs), moisture (a broader mound, more
 * forks), the sun's azimuth (which way it leans), the direction of water, and `activity` (a future hook: use of the shelter
 * thickens it). Shade it casts, vegetation under it and creature use are outputs the ecosystem can read from `frontsState`.
 */

export const FR_TICKS = 100
export const FR_NX = 56
export const FR_NY = 38
export const FR_NZ = 56
export const FR_CELL = 2
export const FR_LEVELS = 20
export const FR_MAX_AGE = 1.7

export type FrontsInputs = {
  /** 0 to 1: how freely light reaches the site. */
  light: number
  /** 0 to 1. */
  moisture: number
  /** The sun's azimuth in radians (0 = +z): the way growth leans. */
  sunAzimuth: number
  /** Bearing of the nearest water, radians. */
  waterAzimuth: number
  /** 0 to 1: how much the shelter is used (future: creature and plant activity). */
  activity: number
}

const K_HUB = 0
const K_ROOT = 1
const K_MEMBER = 2
const K_PIER = 3

export type Fronts = {
  n: number
  x: Float32Array
  y: Float32Array
  z: Float32Array
  parent: Int32Array
  /** A second node this one ends in (a fusion), or -1. */
  link: Int32Array
  born: Int16Array
  kind: Uint8Array
  mass: Float32Array
  vul: Float32Array
  site: [number, number]
  y0: number
  ground: Float32Array
  moisture: number
  stats: Record<string, number | string>
}

const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return x - Math.floor(x)
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

type Front = { node: number; x: number; y: number; z: number; az: number; pitch: number; arc: number; curl: number; speed: number; len: number; since: number; id: number; forks: number; done: boolean; birth: number }

export function growFrontsCore(site: [number, number], inputs: FrontsInputs, seed: number, groundAt: (x: number, z: number) => number): Fronts {
  const started = Date.now()
  const [sx, sz] = site
  const g0 = groundAt(sx, sz)
  const y0 = g0 - 6
  const L = clamp01(inputs.light)
  const wet = clamp01(inputs.moisture)
  const r = (k: number) => hash(seed * 0.001 + k, k * 1.7 + 3)
  const xs: number[] = []
  const ys: number[] = []
  const zs: number[] = []
  const parent: number[] = []
  const link: number[] = []
  const born: number[] = []
  const kinds: number[] = []
  const owner: number[] = []
  const push = (x: number, y: number, z: number, p: number, t: number, kind: number, who: number) => {
    xs.push(x)
    ys.push(y)
    zs.push(z)
    parent.push(p)
    link.push(-1)
    born.push(t)
    kinds.push(kind)
    owner.push(who)
    return xs.length - 1
  }
  // 1 anchor: the hub and a ring of roots.
  const hub = push(sx, g0 - 1, sz, -1, 0, K_HUB, -1)
  const ringR = 5 + 4 * wet + 2 * r(1)
  const nFronts0 = 3 + (r(2) > 0.5 ? 1 : 0)
  const lean = inputs.sunAzimuth + (r(3) - 0.5) * 0.8
  const fronts: Front[] = []
  const phase = r(4) * Math.PI * 2
  const roots = 6
  for (let i = 0; i < roots; i += 1) {
    const a = phase + (i / roots) * Math.PI * 2 + (r(10 + i) - 0.5) * 0.3
    const rx = sx + Math.sin(a) * ringR
    const rz = sz + Math.cos(a) * ringR
    push(rx, groundAt(rx, rz) - 0.5, rz, hub, Math.floor(i * 2), K_ROOT, -1)
  }
  // Fronts leave roots spread around the ring (the first of each pair), steeply.
  for (let f = 0; f < nFronts0; f += 1) {
    const rootNode = 1 + Math.round((f / nFronts0) * roots) % roots
    const a = Math.atan2(xs[rootNode]! - sx, zs[rootNode]! - sz)
    const start = Math.floor(2 + f * 5 + r(20 + f) * 6)
    fronts.push({
      node: rootNode, x: xs[rootNode]!, y: ys[rootNode]!, z: zs[rootNode]!,
      az: a + (r(30 + f) - 0.5) * 0.5, pitch: 1.2 + 0.25 * L + (r(40 + f) - 0.5) * 0.2,
      arc: 0.006 + 0.004 * r(50 + f), curl: (r(60 + f) < 0.5 ? -1 : 1) * (0.012 + 0.016 * r(70 + f)),
      speed: 0.82 + 0.12 * r(80 + f), len: 0, since: 0, id: f, forks: 0, done: false, birth: start,
    })
  }
  let nextId = nFronts0
  const maxFronts = 5 + Math.round(2 * wet + r(5))
  const HEIGHT = 30 + 10 * L
  let fusedPairs = 0
  let piers = 0
  const target = (f: Front) => {
    // Fusion target: the nearest member node of another chain, or none.
    let best = -1
    let bd = 6
    for (let j = 0; j < xs.length; j += 1) {
      if (kinds[j] !== K_MEMBER) continue
      if (owner[j] === f.id && f.len - 0 < 1e9 && j > f.node - 10) continue
      const d = Math.hypot(xs[j]! - f.x, ys[j]! - f.y, zs[j]! - f.z)
      if (d < bd) {
        bd = d
        best = j
      }
    }
    return best
  }
  for (let tick = 1; tick <= FR_TICKS; tick += 1) {
    for (const f of fronts) {
      if (f.done || tick < f.birth) continue
      // 2 rise and curl: the higher it is, the more it turns over.
      const rel = Math.max(0, f.y - g0)
      const turn = f.arc + 0.05 * (rel / HEIGHT) ** 2.2
      f.pitch -= turn
      f.az += f.curl + 0.012 * Math.sin(lean - f.az) * (f.pitch > 0 ? 1 : 0.3)
      const cp = Math.cos(f.pitch)
      f.x += Math.sin(f.az) * cp * f.speed
      f.y += Math.sin(f.pitch) * f.speed
      f.z += Math.cos(f.az) * cp * f.speed
      f.len += f.speed
      f.since += f.speed
      const gy = groundAt(f.x, f.z)
      const tipY = f.y
      if (f.since < 2.2 && tipY > gy + 1.5) continue
      f.since = 0
      const node = push(f.x, Math.max(f.y, gy - 0.4), f.z, f.node, tick, K_MEMBER, f.id)
      f.node = node
      // 4 fork.
      if (f.forks < 1 && f.len > 16 && f.pitch > 0.2 && f.y - g0 > 8 && fronts.length < maxFronts && r(f.id * 7 + 90 + tick) < 0.12 + 0.1 * L + 0.1 * wet) {
        f.forks += 1
        const side = r(f.id * 3 + 91) < 0.5 ? -1 : 1
        fronts.push({
          node, x: f.x, y: f.y, z: f.z, az: f.az + side * (1.05 + 0.4 * r(f.id + 92)), pitch: 0.3 + 0.2 * r(f.id + 93),
          arc: f.arc * 1.5 + 0.004, curl: side * 0.01, speed: f.speed * 0.9, len: 0, since: 0, id: nextId, forks: 1, done: false, birth: tick,
        })
        nextId += 1
      }
      // 3 fuse: once turned downward (or far from the start), end at a member or at the ground.
      if (f.pitch < 0.15 && f.len > 12) {
        const t = target(f)
        if (t >= 0) {
          link[node] = t
          f.done = true
          fusedPairs += 1
        } else if (f.y <= gy + 1.6) {
          kinds[node] = K_PIER
          ys[node] = gy - 0.8
          f.done = true
          piers += 1
        }
      }
      if (f.len > 95 || f.y > g0 + 46) f.done = true
    }
  }
  // Tips that never met anything are left as free ends (they weather first).
  const n = xs.length
  const mass = new Float32Array(n)
  const vul = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const high = clamp01((ys[i]! - g0) / 36)
    mass[i] = kinds[i] === K_MEMBER ? 1 + 0.5 * high : 0.4
    vul[i] = clamp01(0.2 + 0.7 * high + 0.1 * (hash(i, 5) - 0.5))
  }
  // Fused ends carry load into both chains: the far chain's load is added to the linked node.
  const ground = new Float32Array(FR_NX * FR_NZ)
  const x0 = sx - (FR_NX * FR_CELL) / 2
  const z0 = sz - (FR_NZ * FR_CELL) / 2
  for (let k = 0; k < FR_NZ; k += 1) for (let i = 0; i < FR_NX; i += 1) ground[k * FR_NX + i] = groundAt(x0 + (i + 0.5) * FR_CELL, z0 + (k + 0.5) * FR_CELL)
  let top = 0
  for (let i = 0; i < n; i += 1) top = Math.max(top, ys[i]! - g0)
  return {
    n, x: Float32Array.from(xs), y: Float32Array.from(ys), z: Float32Array.from(zs), parent: Int32Array.from(parent), link: Int32Array.from(link),
    born: Int16Array.from(born), kind: Uint8Array.from(kinds), mass, vul, site, y0, ground, moisture: wet,
    stats: { nodes: n, fronts: fronts.length, arches: fusedPairs, piers, height: Math.round(top), ms: Date.now() - started },
  }
}

/** Each node's radius and whether it stands, at an age (0 to FR_MAX_AGE; 1 is the reference form). */
export function frontsState(fr: Fronts, age: number, activity = 0) {
  const tick = age * FR_TICKS
  const n = fr.n
  const present = new Uint8Array(n)
  const load = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    if (fr.born[i]! <= tick) {
      present[i] = 1
      load[i] = fr.mass[i]!
    }
  }
  // Load flows down the chains (parents come before children), and a fusion hands its load to the member it joined.
  for (let i = n - 1; i > 0; i -= 1) {
    if (!present[i]) continue
    load[fr.parent[i]!]! += load[i]!
    const l = fr.link[i]!
    if (l >= 0 && present[l]) load[l]! += load[i]! * 0.5
  }
  const radius = new Float32Array(n)
  const alive = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) {
    if (!present[i]) continue
    const g = 0.4 + 0.6 * smoothstep(0, 22, tick - fr.born[i]!)
    const date = 1.05 + 0.5 * (1 - fr.vul[i]!)
    const rho = smoothstep(date, date + 0.5, age)
    const fused = fr.link[i]! >= 0 || fr.kind[i] === K_PIER
    const recede = (fused ? 0.1 : 0.6) * rho * (0.3 + fr.vul[i]!)
    const base = fr.kind[i] === K_HUB ? 3 + 7 * smoothstep(0, 60, tick) * (0.7 + 0.5 * fr.moisture) : fr.kind[i] === K_ROOT ? 2.2 + 3 * smoothstep(0, 70, tick) : Math.max(1.1, 0.62 * Math.pow(load[i]!, 0.42))
    radius[i] = base * g * (1 + 0.15 * activity) * (1 - recede) * (fr.kind[i] === K_PIER ? 1.3 : 1)
  }
  for (let i = 0; i < n; i += 1) {
    if (!present[i]) continue
    const ok = radius[i]! >= 0.85
    if (i === 0) alive[i] = ok ? 1 : 0
    else alive[i] = ok && alive[fr.parent[i]!] ? 1 : 0
  }
  return { present, alive, radius }
}

/** The signed field (positive inside, in metres) and the node that made each cell, at an age. */
export function frontsField(fr: Fronts, age: number, activity = 0) {
  const NX = FR_NX
  const NY = FR_NY
  const NZ = FR_NZ
  const field = new Float32Array(NX * NY * NZ).fill(-50)
  const owner = new Int16Array(NX * NY * NZ).fill(-1)
  const { alive, radius } = frontsState(fr, age, activity)
  const x0 = fr.site[0] - (NX * FR_CELL) / 2
  const z0 = fr.site[1] - (NZ * FR_CELL) / 2
  const K = 3.4
  const cellAt = (v: number, o: number) => (v - o) / FR_CELL - 0.5
  const segment = (s: number, p: number, rA: number, rB: number) => {
    const ax = fr.x[p]!
    const ay = fr.y[p]!
    const az = fr.z[p]!
    const bx = fr.x[s]!
    const by = fr.y[s]!
    const bz = fr.z[s]!
    const rmax = Math.max(rA, rB) + K + 1.5
    const i0 = Math.max(0, Math.floor(cellAt(Math.min(ax, bx) - rmax, x0)))
    const i1 = Math.min(NX - 1, Math.ceil(cellAt(Math.max(ax, bx) + rmax, x0)))
    const j0 = Math.max(0, Math.floor(cellAt(Math.min(ay, by) - rmax, fr.y0)))
    const j1 = Math.min(NY - 1, Math.ceil(cellAt(Math.max(ay, by) + rmax, fr.y0)))
    const k0 = Math.max(0, Math.floor(cellAt(Math.min(az, bz) - rmax, z0)))
    const k1 = Math.min(NZ - 1, Math.ceil(cellAt(Math.max(az, bz) + rmax, z0)))
    const abx = bx - ax
    const aby = by - ay
    const abz = bz - az
    const ll = abx * abx + aby * aby + abz * abz
    for (let k = k0; k <= k1; k += 1) {
      const wz = z0 + (k + 0.5) * FR_CELL
      for (let j = j0; j <= j1; j += 1) {
        const wy = fr.y0 + (j + 0.5) * FR_CELL
        for (let i = i0; i <= i1; i += 1) {
          const wx = x0 + (i + 0.5) * FR_CELL
          const qx = wx - ax
          const qy = wy - ay
          const qz = wz - az
          const h = ll > 1e-6 ? Math.max(0, Math.min(1, (qx * abx + qy * aby + qz * abz) / ll)) : 0
          const r = rA + (rB - rA) * h
          const v = r - Math.hypot(qx - abx * h, qy - aby * h, qz - abz * h)
          const id = (k * NY + j) * NX + i
          const cur = field[id]!
          const dd = Math.abs(v - cur)
          const hh = Math.max(K - dd, 0) / K
          field[id] = Math.max(v, cur) + hh * hh * K * 0.25
          if (v > cur) owner[id] = s
        }
      }
    }
  }
  for (let s = 0; s < fr.n; s += 1) {
    if (!alive[s]) continue
    const p = s === 0 ? 0 : fr.parent[s]!
    segment(s, p, s === 0 ? radius[s]! : radius[p]!, radius[s]!)
    const l = fr.link[s]!
    if (l >= 0 && alive[l]) segment(s, l, radius[s]!, radius[l]!)
  }
  // The ground: nothing below a little under it, so the surface closes inside the terrain; the grid's edge is empty.
  for (let k = 0; k < NZ; k += 1) {
    for (let i = 0; i < NX; i += 1) {
      const g = fr.ground[k * NX + i]!
      for (let j = 0; j < NY; j += 1) {
        const id = (k * NY + j) * NX + i
        const wy = fr.y0 + (j + 0.5) * FR_CELL
        if (wy < g - 3) field[id] = Math.min(field[id]!, -1)
        if (i === 0 || k === 0 || j === 0 || i === NX - 1 || k === NZ - 1 || j === NY - 1) field[id] = -1
      }
    }
  }
  return { field, owner }
}
