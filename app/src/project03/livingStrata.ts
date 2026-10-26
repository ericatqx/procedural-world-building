import { BufferAttribute, BufferGeometry } from 'three'
import { sunAt } from '../project/sun.ts'
import { clamp01, smoothstep } from '../project02/core.ts'
import { prevailingWind } from './environment.ts'
import { islandRadius, landscapeHeight } from './terrain.ts'
import { add, chooseSite, cross, dot, lerp, livingArchitecture, mul, norm, rng, skin, sub, waterDistance, type Colony, type V } from './livingArchitecture.ts'
import { surfaceNets } from './livingMesh.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — Living Architecture, Strata Stage 1: interlocking living strata.
 *
 * A morphology prototype. The organism is a set of thick tissue lobes (oriented, rounded, slightly tapering boxes) laid down
 * over epochs, each one grown out of a point on the surface of a living lobe. The surface is their distance field, fused in
 * birth order, so the field is the deposition history.
 *
 * FOUNDERS. One dominant founder (a large mass of two interpenetrating lobes) and two subordinate ones, smaller, 45–80 m
 * away, with smaller growth budgets. Everything inherits size from its parent, so the dominant mass stays dominant.
 *
 * Founders are smaller than the tissue their organism can grow: vigorous, well-supplied growth swells (a child up to 1.1×
 * its parent's thickness), up to the organism's cap (CAP), so the dominant mass is grown, not placed.
 *
 * GROWTH. Each epoch, every living lobe's exposed faces are sampled. A sample is scored by
 *
 *   light      the day's sun arc on that face (shaded by the terrain and all the mass so far), plus a little sky
 *   supply     exp(−d/λ), d the distance through the lobe graph to the nearest lobe on the ground: the ground feeds it
 *   facing     a top face grows a stratum, a side face grows an arm, an underside grows nothing
 *
 * and each organism builds its best few, within its budget. A stratum is a thinner slab laid on a top face and slid outward
 * toward the light past the edge (an overhang); an arm is a lobe grown out of a side face toward the best-lit heading, a
 * little upward. A stratum caps an arm or a founder, never another stratum, so strata and arms alternate. A child is usually thinner than its parent (more so where it is poorly lit or poorly supplied); below 3.4 m thick
 * nothing grows, so the form has a smallest scale and it is still massive.
 *
 * STRUCTURE. A lobe's unsupported run (horizontal reach past the support beneath, summed along the chain) may not exceed
 * REACH × its thickness. A child that would is shortened; if too short to be worth it, the organism instead grows a raking
 * buttress from the parent's underside to the ground, which roots there and resets the run.
 *
 * FUSION. A child whose tip lands in a lobe that is not a near relative (another organism, or a distant branch of its own)
 * fuses with it: they share a path to the ground. Tips are drawn a little toward such mass, because it is supply.
 *
 * RECESSION. From the third epoch, a lobe whose light × supply has stayed below a threshold for two epochs (later growth has
 * shaded it) recedes to a stump, if everything it carries still reaches the ground some other way. Shaded lower mass under
 * a fused bridge can go; that is where openings come from. Nothing is cut on purpose.
 *
 * FUSION IN THE FIELD. A lobe joins its own parent with a fillet proportional to its thickness (callus), and meets anything
 * else with a small one, so lobes of different epochs and organisms leave a crease: the strata. A gentle low-frequency
 * displacement keeps the planes from reading as machined.
 *
 * Options: `epochs` (default 9), `variation` (another draw of the same rules), and ablations `light`, `structure`, `recede`
 * (false turns each off). The page reads them from the URL: ?architecture=strata&epochs=6&v=1&light=0&structure=0&recede=0.
 */

const O = 2
const HALF = 150
const EPOCHS = 9
const LAMBDA = 70
const REACH = 3.2
const MIN_HV = 1.7
const K_SMALL = 1.0
const STARVE = 0.13
const BUDGET = [7, 3, 2]
/** The thickest tissue each organism can lay down (half-thickness, m): the dominant one is the largest. */
const CAP = [10, 5.5, 4]

const FOUNDER = 0
const ARM = 1
const STRATUM = 2
const BUTTRESS = 3
type Kind = 0 | 1 | 2 | 3

export type Lobe = {
  id: number
  org: number
  parent: number
  epoch: number
  kind: Kind
  /** Centre, frame (u is the growth axis, v its up, w across) and half-extents along u, v, w. */
  c: V
  u: V
  v: V
  w: V
  h: V
  r: number
  /** The fillet it makes with its parent, and how much it narrows toward its tip. */
  blend: number
  taper: number
  /** Where it grew out of its parent. */
  base: V
  alive: boolean
  receded: number
  light: number
  dark: number
  supply: number
  dist: number
  run: number
  ground: boolean
  links: number[]
}
export type StrataOptions = { epochs?: number; variation?: number; light?: boolean; structure?: boolean; recede?: boolean }
export type StrataGraph = { lobes: Lobe[]; fusions: number; epochs: number }
export type GrownStrata = Colony & { graph: StrataGraph }

export function strataOptionsFromUrl(): StrataOptions {
  if (typeof location === 'undefined') return {}
  const q = new URLSearchParams(location.search)
  const num = (k: string) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : undefined)
  const flag = (k: string) => (q.has(k) ? q.get(k) !== '0' && q.get(k) !== 'false' : undefined)
  return { epochs: num('epochs'), variation: num('v'), light: flag('light'), structure: flag('structure'), recede: flag('recede') }
}

const UP: V = [0, 1, 0]
const horiz = (a: V): V => {
  const l = Math.hypot(a[0], a[2])
  return l < 1e-6 ? [1, 0, 0] : [a[0] / l, 0, a[2] / l]
}
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}
const hash3 = (x: number, y: number, z: number) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440670441)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
export const vnoise = (x: number, y: number, z: number) => {
  const i = Math.floor(x)
  const j = Math.floor(y)
  const k = Math.floor(z)
  const f = (t: number) => t * t * (3 - 2 * t)
  const fx = f(x - i)
  const fy = f(y - j)
  const fz = f(z - k)
  const a = (jj: number, kk: number) => lerp(hash3(i, jj, kk), hash3(i + 1, jj, kk), fx)
  const b = (kk: number) => lerp(a(j, kk), a(j + 1, kk), fy)
  return lerp(b(k), b(k + 1), fz)
}

/** A frame whose first axis is u and whose second is as near to `up` as it can be. */
function frame(u: V, up: V = UP): [V, V, V] {
  const uu = norm(u)
  let v = sub(up, mul(uu, dot(up, uu)))
  if (Math.hypot(v[0], v[1], v[2]) < 1e-3) v = horiz(cross(uu, [0, 0, 1]))
  v = norm(v)
  return [uu, v, norm(cross(uu, v))]
}

/** Signed distance to a lobe: a rounded box in its own frame, narrowing toward its tip. */
function lobeSd(l: Lobe, x: number, y: number, z: number): number {
  const px = x - l.c[0]
  const py = y - l.c[1]
  const pz = z - l.c[2]
  const lu = px * l.u[0] + py * l.u[1] + pz * l.u[2]
  const lv = px * l.v[0] + py * l.v[1] + pz * l.v[2]
  const lw = px * l.w[0] + py * l.w[1] + pz * l.w[2]
  const s = clamp01((lu / l.h[0] + 1) / 2)
  const narrow = 1 - l.taper * s
  const a = Math.abs(lu) - (l.h[0] - l.r)
  const b = Math.abs(lv) - (l.h[1] * narrow - l.r)
  const c = Math.abs(lw) - (l.h[2] * narrow - l.r)
  return Math.hypot(Math.max(a, 0), Math.max(b, 0), Math.max(c, 0)) + Math.min(Math.max(a, b, c), 0) - l.r
}

/** How far a lobe reaches from its centre along a direction (the support function of its box). */
const extentAlong = (l: Lobe, d: V) => Math.abs(dot(d, l.u)) * l.h[0] + Math.abs(dot(d, l.v)) * l.h[1] + Math.abs(dot(d, l.w)) * l.h[2]
const lowest = (l: Lobe) => l.c[1] - extentAlong(l, UP)

export function growStrata(world: World, seed: number, options: StrataOptions = {}): GrownStrata {
  const started = performance.now()
  const E = Math.max(1, Math.min(16, Math.round(options.epochs ?? EPOCHS)))
  const variation = options.variation ?? 0
  const useLight = options.light ?? true
  const useStructure = options.structure ?? true
  const useRecede = options.recede ?? true
  const rand = rng((seed ^ Math.imul(variation + 1, 0x9e3779b1)) >>> 0)
  const [sx, sz] = chooseSite(world, seed)
  const cy = landscapeHeight(sx, sz)

  // ------------------------------------------------------------------------------------------------ terrain and light
  const TS = 4
  const side = (HALF * 2) / TS + 1
  const heights = new Float32Array(side * side)
  let minH = Infinity
  for (let i = 0; i < side; i += 1) {
    for (let j = 0; j < side; j += 1) {
      const h = landscapeHeight(sx - HALF + j * TS, sz - HALF + i * TS)
      heights[i * side + j] = h
      minH = Math.min(minH, h)
    }
  }
  const hAt = (x: number, z: number): number => {
    const u = (x - (sx - HALF)) / TS
    const w = (z - (sz - HALF)) / TS
    if (u < 0 || w < 0 || u >= side - 1 || w >= side - 1) return landscapeHeight(x, z)
    const j = Math.floor(u)
    const i = Math.floor(w)
    const fu = u - j
    const fw = w - i
    return lerp(lerp(heights[i * side + j]!, heights[i * side + j + 1]!, fu), lerp(heights[(i + 1) * side + j]!, heights[(i + 1) * side + j + 1]!, fu), fw)
  }
  const slopeAt = (x: number, z: number) => Math.hypot((hAt(x + 5, z) - hAt(x - 5, z)) / 10, (hAt(x, z + 5) - hAt(x, z - 5)) / 10)
  const wetCache = new Map<number, number>()
  const moistureAt = (x: number, z: number): number => {
    const key = Math.round(x / 16) * 4096 + Math.round(z / 16)
    let m = wetCache.get(key)
    if (m === undefined) {
      m = Math.exp(-waterDistance(world, Math.round(x / 16) * 16, Math.round(z / 16) * 16) / 110)
      wetCache.set(key, m)
    }
    return m
  }
  const sun = [8, 10.5, 13, 15.5].flatMap((h) => {
    const d = sunAt(h, 55).direction
    return d[1] > 0.12 ? [{ d: d as V, w: 0.4 + d[1] }] : []
  })
  // The mean of the day's sun, level: the way growth leans to find light.
  const sunH = horiz(sun.reduce<V>((acc, s) => add(acc, mul(s.d, s.w)), [0, 0, 0]))
  const heading = (prevailingWind(seed) * Math.PI) / 180
  const wind: V = [Math.cos(heading), 0, Math.sin(heading)]

  // Occupancy of the mass (2 m cells): which lobe owns each cell, for shading, crowding and fusion.
  const NXo = (HALF * 2) / O
  const oy = Math.floor(minH) - 4
  const NYo = Math.ceil((cy + 150 - oy) / O)
  const ox = sx - HALF
  const oz = sz - HALF
  const occ = new Int32Array(NXo * NYo * NXo)
  const occAt = (x: number, y: number, z: number) => {
    const i = Math.floor((x - ox) / O)
    const j = Math.floor((y - oy) / O)
    const k = Math.floor((z - oz) / O)
    return i < 0 || j < 0 || k < 0 || i >= NXo || j >= NYo || k >= NXo ? 0 : occ[(j * NXo + k) * NXo + i]!
  }
  const lobes: Lobe[] = []
  const occMark = (l: Lobe) => {
    const ex = extentAlong(l, [1, 0, 0])
    const ey = extentAlong(l, UP)
    const ez = extentAlong(l, [0, 0, 1])
    const i0 = Math.max(0, Math.floor((l.c[0] - ex - ox) / O))
    const i1 = Math.min(NXo - 1, Math.floor((l.c[0] + ex - ox) / O))
    const j0 = Math.max(0, Math.floor((l.c[1] - ey - oy) / O))
    const j1 = Math.min(NYo - 1, Math.floor((l.c[1] + ey - oy) / O))
    const k0 = Math.max(0, Math.floor((l.c[2] - ez - oz) / O))
    const k1 = Math.min(NXo - 1, Math.floor((l.c[2] + ez - oz) / O))
    for (let k = k0; k <= k1; k += 1) {
      for (let j = j0; j <= j1; j += 1) {
        for (let i = i0; i <= i1; i += 1) {
          const q = (j * NXo + k) * NXo + i
          if (occ[q] !== 0) continue
          if (lobeSd(l, ox + (i + 0.5) * O, oy + (j + 0.5) * O, oz + (k + 0.5) * O) < 0.4) occ[q] = l.id + 1
        }
      }
    }
  }
  const rebuildOcc = () => {
    occ.fill(0)
    for (const l of lobes) occMark(l)
  }
  /** Sun and sky on a surface facing n at p, past terrain and mass. */
  const lightAt = (p: V, n: V): number => {
    if (!useLight) return 0.6
    let sum = 0
    let weights = 0
    for (const s of sun) {
      const face = dot(n, s.d)
      weights += s.w
      if (face < 0.02) continue
      let t = 1
      for (let q = 1; q <= 26; q += 1) {
        const d = 1 + q * 2.4
        const x = p[0] + s.d[0] * d
        const y = p[1] + s.d[1] * d
        const z = p[2] + s.d[2] * d
        if (hAt(x, z) > y) {
          t = 0
          break
        }
        if (occAt(x, y, z) > 0) t *= 0.3
        if (t < 0.05) break
      }
      sum += t * face * s.w
    }
    let sky = 1
    for (let q = 1; q <= 8; q += 1) if (occAt(p[0], p[1] + 1 + q * 3, p[2]) > 0) sky *= 0.35
    return clamp01(1.25 * 0.8 * (sum / weights) + 0.2 * sky * (0.5 + 0.5 * n[1]))
  }

  // ------------------------------------------------------------------------------------------------ the lobe graph
  const isRelative = (a: Lobe, b: Lobe) => {
    if (a.id === b.id) return true
    const up = (l: Lobe) => {
      const out = new Set<number>()
      let p = l.parent
      for (let q = 0; q < 3 && p >= 0; q += 1) {
        out.add(p)
        p = lobes[p]!.parent
      }
      return out
    }
    const ua = up(a)
    const ub = up(b)
    return ua.has(b.id) || ub.has(a.id) || (a.parent >= 0 && a.parent === b.parent)
  }
  const neighbours = (l: Lobe, alive: (m: Lobe) => boolean): Lobe[] => {
    const out: Lobe[] = []
    if (l.parent >= 0 && alive(lobes[l.parent]!)) out.push(lobes[l.parent]!)
    for (const id of l.links) if (alive(lobes[id]!)) out.push(lobes[id]!)
    return out
  }
  const children = new Map<number, number[]>()
  const adjacency = (alive: (m: Lobe) => boolean) => {
    const adj = new Map<number, Lobe[]>()
    for (const l of lobes) if (alive(l)) adj.set(l.id, neighbours(l, alive))
    for (const l of lobes) {
      if (!alive(l)) continue
      for (const m of neighbours(l, alive)) adj.get(m.id)!.push(l)
    }
    return adj
  }
  const computeSupply = () => {
    const live = (m: Lobe) => m.alive
    const adj = adjacency(live)
    const queue: Lobe[] = []
    for (const l of lobes) {
      l.dist = Infinity
      if (l.alive && l.ground) {
        l.dist = 0
        queue.push(l)
      }
    }
    for (let head = 0; head < queue.length; head += 1) {
      const l = queue[head]!
      for (const m of adj.get(l.id) ?? []) {
        const d = l.dist + Math.hypot(m.c[0] - l.c[0], m.c[1] - l.c[1], m.c[2] - l.c[2])
        if (d < m.dist - 0.01) {
          m.dist = d
          queue.push(m)
        }
      }
    }
    for (const l of lobes) l.supply = Number.isFinite(l.dist) ? Math.exp(-l.dist / LAMBDA) * (0.7 + 0.3 * moistureAt(l.c[0], l.c[2])) : 0
  }
  /** Whether every other living lobe still reaches the ground with this one gone. */
  const removable = (gone: Lobe) => {
    const alive = (m: Lobe) => m.alive && m.id !== gone.id
    const adj = adjacency(alive)
    const seen = new Set<number>()
    const queue: Lobe[] = []
    let total = 0
    for (const l of lobes) {
      if (!alive(l)) continue
      total += 1
      if (l.ground) {
        seen.add(l.id)
        queue.push(l)
      }
    }
    for (let head = 0; head < queue.length; head += 1) {
      for (const m of adj.get(queue[head]!.id) ?? []) {
        if (seen.has(m.id)) continue
        seen.add(m.id)
        queue.push(m)
      }
    }
    return seen.size === total
  }
  const allowedRun = (l: Lobe) => (useStructure ? REACH * 2 * l.h[1] : Infinity)
  const touchesGround = (l: Lobe) => lowest(l) <= hAt(l.c[0], l.c[2]) + 1.2

  const addLobe = (spec: Omit<Lobe, 'id' | 'alive' | 'receded' | 'light' | 'dark' | 'supply' | 'dist' | 'links'>): Lobe => {
    const l: Lobe = { ...spec, id: lobes.length, alive: true, receded: -1, light: 0.5, dark: 0, supply: 1, dist: 0, links: [] }
    lobes.push(l)
    if (l.parent >= 0) {
      const list = children.get(l.parent) ?? []
      list.push(l.id)
      children.set(l.parent, list)
    }
    occMark(l)
    return l
  }

  // ------------------------------------------------------------------------------------------------ founders
  const sites = (() => {
    const found: { x: number; z: number; score: number }[] = []
    for (let dx = -110; dx <= 110; dx += 10) {
      for (let dz = -110; dz <= 110; dz += 10) {
        const x = sx + dx
        const z = sz + dz
        const away = Math.hypot(dx, dz)
        if (away > 118 || Math.hypot(x, z) > islandRadius(Math.atan2(z, x)) * 0.85 || world.water.depthAt(x, z) > 0) continue
        const slope = slopeAt(x, z)
        if (slope > 0.3) continue
        let openSky = 0
        for (const s of sun) {
          let t = 1
          for (let q = 1; q <= 12; q += 1) if (hAt(x + s.d[0] * q * 6, z + s.d[2] * q * 6) > hAt(x, z) + 8 + s.d[1] * q * 6) t = 0
          openSky += t
        }
        found.push({ x, z, score: 1.3 * (openSky / sun.length) + 0.5 * moistureAt(x, z) - 2.2 * slope - away / 240 + 0.15 * rand() * Math.min(1, variation) })
      }
    }
    found.sort((a, b) => b.score - a.score)
    const dominant = found[0] ?? { x: sx, z: sz, score: 0 }
    const chosen = [dominant]
    for (const [near, far] of [
      [45, 80],
      [35, 95],
    ] as const) {
      for (const f of found) {
        if (chosen.length >= 3) break
        const d = Math.hypot(f.x - dominant.x, f.z - dominant.z)
        if (d >= near && d <= far && chosen.every((c) => Math.hypot(c.x - f.x, c.z - f.z) >= 35)) chosen.push(f)
      }
    }
    return chosen
  })()
  const founderSizes: V[] = [
    [12, 7, 9.5],
    [6.5, 4.2, 5.2],
    [5, 3.4, 4.2],
  ]
  sites.forEach((f, org) => {
    // Lie along the contour where the ground has a fall, otherwise at random.
    const gx = hAt(f.x + 6, f.z) - hAt(f.x - 6, f.z)
    const gz = hAt(f.x, f.z + 6) - hAt(f.x, f.z - 6)
    const yaw = Math.hypot(gx, gz) > 0.4 ? Math.atan2(gx, -gz) + (rand() - 0.5) * 0.5 : rand() * Math.PI * 2
    const [u, v, w] = frame([Math.cos(yaw), 0, Math.sin(yaw)])
    const h = founderSizes[org]!
    const g = hAt(f.x, f.z)
    const main = addLobe({ org, parent: -1, epoch: 0, kind: FOUNDER, c: [f.x, g + h[1] * 0.85, f.z], u, v, w, h: [...h], r: 0.3 * h[1], blend: 1.2, taper: 0, base: [f.x, g, f.z], run: 0, ground: true })
    if (org === 0) {
      // The dominant founder is two masses grown through each other, one long and low, one shorter and taller.
      const turn = yaw + (rand() < 0.5 ? -1 : 1) * (0.55 + 0.25 * rand())
      const [u2, v2, w2] = frame([Math.cos(turn), 0, Math.sin(turn)])
      const off = add(mul(u, h[0] * (0.45 + 0.2 * rand())), mul(w, h[2] * (rand() - 0.5) * 0.6))
      const h2: V = [h[0] * 0.6, h[1] * 1.35, h[2] * 0.65]
      const gc = hAt(f.x + off[0], f.z + off[2])
      addLobe({ org, parent: main.id, epoch: 0, kind: FOUNDER, c: [f.x + off[0], gc + h2[1] * 0.85, f.z + off[2]], u: u2, v: v2, w: w2, h: h2, r: 0.3 * h2[2], blend: 1.4, taper: 0, base: [f.x + off[0], gc, f.z + off[2]], run: 0, ground: true })
    }
  })

  // ------------------------------------------------------------------------------------------------ growth
  type Candidate = { l: Lobe; p: V; n: V; light: number; top: boolean; score: number }
  let fusions = 0
  let buttresses = 0
  let rejectedStructure = 0
  let shortened = 0
  const stage: number[] = []

  /** Points on a lobe's exposed faces, with their facing. */
  const faceSamples = (l: Lobe): { p: V; n: V; tip: boolean }[] => {
    const out: { p: V; n: V; tip: boolean }[] = []
    const faces: [V, number, V, number, V, number][] = [
      [l.v, l.h[1], l.u, l.h[0], l.w, l.h[2]],
      [l.u, l.h[0] * (1 - 0.5 * l.taper), l.v, l.h[1] * (1 - l.taper), l.w, l.h[2] * (1 - l.taper)],
      [mul(l.w, 1), l.h[2], l.u, l.h[0], l.v, l.h[1]],
      [mul(l.w, -1), l.h[2], l.u, l.h[0], l.v, l.h[1]],
    ]
    if (l.kind === FOUNDER) faces.push([mul(l.u, -1), l.h[0], l.v, l.h[1], l.w, l.h[2]])
    faces.forEach(([n, e, t1, e1, t2, e2], f) => {
      if (n[1] < -0.3) return
      for (const [a, b] of [
        [0, 0],
        [rand() * 2 - 1, rand() * 2 - 1],
        [rand() * 2 - 1, rand() * 2 - 1],
      ] as const) {
        const p = add(add(add(l.c, mul(n, e)), mul(t1, a * e1 * 0.6)), mul(t2, b * e2 * 0.6))
        if (p[1] < hAt(p[0], p[2]) + 0.8) continue
        const out1 = add(p, mul(n, 2.2))
        if (occAt(out1[0], out1[1], out1[2]) > 0) continue
        out.push({ p, n, tip: f === 1 && l.kind !== FOUNDER })
      }
    })
    return out
  }

  /** Mass that is not a near relative within reach of a heading: fusion would give it another way to the ground. */
  const pull = (l: Lobe, from: V, dir: V) => {
    for (let q = 1; q <= 5; q += 1) {
      const p = add(from, mul(dir, q * 4))
      const o = occAt(p[0], p[1], p[2])
      if (o > 0 && !isRelative(l, lobes[o - 1]!)) return 0.3 * (1 - (q - 1) / 5)
    }
    return 0
  }

  const tryGrow = (cand: Candidate, epoch: number): boolean => {
    const P = cand.l
    const vigour = clamp01((cand.light * P.supply) / 0.55)
    const cap = CAP[P.org]! * Math.pow(P.supply, 0.6)
    let kind: Kind
    let u: V
    let v: V
    let w: V
    let h: V
    let c: V
    if (cand.top) {
      // A stratum: a thinner slab on the top face, slid outward toward the best-lit heading.
      const hv = Math.min(cap, P.h[1] * (0.55 + 0.2 * vigour))
      if (hv < MIN_HV) return false
      const hu0 = hv * (1.3 + 0.7 * rand())
      const out = horiz(sub(cand.p, P.c))
      let best = -1
      let dir: V = out
      const turn = rand() * Math.PI * 2
      for (let q = 0; q < 8; q += 1) {
        const a = turn + (q / 8) * Math.PI * 2
        const d: V = [Math.cos(a), 0, Math.sin(a)]
        const tip = add(add(cand.p, mul(UP, hv * 1.4)), mul(d, hu0 * 1.4))
        if (occAt(tip[0], tip[1], tip[2]) > 0 && isRelative(P, lobes[occAt(tip[0], tip[1], tip[2]) - 1]!)) continue
        const s = lightAt(tip, UP) * (0.5 + 0.5 * Math.max(0, dot(d, out))) + pull(P, tip, d)
        if (s > best) {
          best = s
          dir = d
        }
      }
      if (best <= 0.05) return false
      kind = STRATUM
      const tilt = (rand() - 0.7) * 0.22
      ;[u, v, w] = frame(norm(add(dir, [0, tilt, 0])))
      h = [hu0, hv, hv * (1.1 + 0.6 * rand())]
      c = add(add(cand.p, mul(v, hv * 0.45)), mul(u, hu0 * 0.7))
    } else {
      // An arm: grown out of a side face toward the best-lit heading, a little upward.
      const hv = Math.min(cap, P.h[1] * (0.68 + 0.42 * vigour))
      if (hv < MIN_HV) return false
      const hu0 = hv * (1.1 + 0.6 * rand())
      const nh = horiz(cand.n)
      const across = norm(cross(UP, nh))
      const dirs: V[] = [norm(add(nh, [0, 0.1, 0])), norm(add(nh, [0, 0.35, 0])), norm(add(nh, [0, 0.6, 0])), norm(add(nh, mul(sunH, 0.6))), norm(add(add(nh, mul(across, 0.55)), [0, 0.1, 0])), norm(add(add(nh, mul(across, -0.55)), [0, 0.1, 0]))]
      let best = -1
      let dir = dirs[0]!
      for (const d of dirs) {
        const tip = add(cand.p, mul(d, hu0 * 1.5))
        const o = occAt(tip[0], tip[1], tip[2])
        if (o > 0 && isRelative(P, lobes[o - 1]!)) continue
        if (tip[1] < hAt(tip[0], tip[2]) + 0.5) continue
        const s = lightAt(tip, norm(add(d, UP))) * (1 + 0.35 * d[1]) + pull(P, tip, d)
        if (s > best) {
          best = s
          dir = d
        }
      }
      if (best <= 0.05) return false
      kind = ARM
      ;[u, v, w] = frame(dir)
      h = [hu0, hv, hv * (1.4 + 0.8 * rand())]
      c = add(cand.p, mul(u, hu0 * 0.35))
    }

    // Structure: the run past the parent's support, summed along the chain.
    const reachOf = (cc: V, hu: number) => {
      const tip = add(cc, mul(u, hu))
      const off = sub(tip, P.c)
      const dirH = horiz(off)
      return { dirH, beyond: Math.max(0, dot([off[0], 0, off[2]], dirH) - extentAlong(P, dirH)) }
    }
    let { dirH, beyond } = reachOf(c, h[0])
    let run = P.run + beyond
    const limit = useStructure ? REACH * 2 * Math.min(h[1], P.h[1]) : Infinity
    if (run > limit) {
      const horizU = Math.hypot(u[0], u[2])
      const cut = (run - limit) / Math.max(0.2, 1.45 * horizU)
      const hu = h[0] - cut
      if (hu >= 0.9 * h[1]) {
        c = sub(c, mul(u, cut * 0.45))
        h = [hu, h[1], h[2]]
        ;({ dirH, beyond } = reachOf(c, h[0]))
        run = P.run + beyond
        shortened += 1
      } else {
        rejectedStructure += 1
        return P.kind !== BUTTRESS && growButtress(P, dirH, epoch)
      }
    }

    // Crowding and fusion.
    const tip = add(c, mul(u, h[0] * 0.8))
    const mid = c
    const oMid = occAt(mid[0], mid[1], mid[2])
    if (oMid > 0 && oMid - 1 !== P.id && isRelative(P, lobes[oMid - 1]!) && lobes[oMid - 1]!.id !== P.parent) return false
    if (Math.hypot(c[0] - sx, c[2] - sz) > HALF - 25) return false
    if (c[1] + h[1] < hAt(c[0], c[2]) + 1) return false
    const oTip = occAt(tip[0], tip[1], tip[2])
    const child = addLobe({
      org: P.org,
      parent: P.id,
      epoch,
      kind,
      c,
      u,
      v,
      w,
      h,
      r: (kind === STRATUM ? 0.26 : 0.32) * Math.min(h[1], h[2]),
      blend: (kind === STRATUM ? 0.45 : 0.65) * h[1],
      taper: kind === STRATUM ? 0.1 : 0.22,
      base: cand.p,
      run,
      ground: false,
    })
    child.ground = touchesGround(child)
    if (child.ground) child.run = 0
    for (const o of [oTip, oMid]) {
      if (o <= 0) continue
      const other = lobes[o - 1]!
      if (other.id === child.id || isRelative(child, other) || child.links.includes(other.id)) continue
      child.links.push(other.id)
      other.links.push(child.id)
      fusions += 1
    }
    return true
  }

  /** A raking buttress from a parent's underside, toward where it was asked to reach, down to the ground. */
  const growButtress = (P: Lobe, dirH: V, epoch: number): boolean => {
    if ((children.get(P.id) ?? []).some((id) => lobes[id]!.kind === BUTTRESS)) return false
    const edge = extentAlong(P, dirH) * 0.4
    const q = add(add(P.c, mul(dirH, edge)), mul(UP, -extentAlong(P, UP) * 0.8))
    const u = norm(add(mul(dirH, 0.55), [0, -1, 0]))
    let drop = q[1] - hAt(q[0], q[2])
    for (let t = 0; t < 3; t += 1) {
      const along = drop / -u[1]
      const end = add(q, mul(u, along))
      drop = q[1] - hAt(end[0], end[2])
    }
    // Only a short spur: a long one would stand apart as a column.
    if (drop < 2.5 || drop > 4.5 * P.h[1]) return false
    const len = drop / -u[1]
    const [, v0, w0] = frame(u, dirH)
    const h: V = [len / 2 + 1.6, Math.max(2.4, P.h[1] * 0.9), Math.max(3, P.h[2] * 1.1)]
    if (h[1] < MIN_HV) return false
    const c = add(q, mul(u, h[0] - 1.6))
    addLobe({ org: P.org, parent: P.id, epoch, kind: BUTTRESS, c, u, v: v0, w: w0, h, r: 0.4 * Math.min(h[1], h[2]), blend: 0.55 * h[1], taper: -0.5, base: q, run: 0, ground: true })
    P.run = 0
    buttresses += 1
    return true
  }

  let recededCount = 0
  for (let epoch = 1; epoch <= E; epoch += 1) {
    rebuildOcc()
    computeSupply()
    const cands: Candidate[] = []
    for (const l of lobes) {
      if (!l.alive) continue
      let lit = 0
      for (const s of faceSamples(l)) {
        const light = lightAt(s.p, s.n)
        lit = Math.max(lit, light)
        if (l.kind === BUTTRESS) continue
        const top = s.n[1] > 0.7
        // A stratum caps an arm, a buttress or a founder, never another stratum: strata alternate with arms, they do not stack.
        if (top && l.kind === STRATUM) continue
        // Faces close to the ground are crowded by it: growth there spreads rather than rises.
        // Growth from a lobe's tip is discounted: tissue thickens beside itself rather than running out in a chain.
        const chain = s.tip ? 0.55 : 1
        const lift = 0.45 + 0.55 * smoothstep(0, 10, s.p[1] - hAt(s.p[0], s.p[2]))
        cands.push({ l, p: s.p, n: s.n, light, top, score: light * l.supply * lift * chain * (top ? 0.9 : 0.8) })
      }
      l.light = lit
    }
    // Recession: what later growth has starved, if what it carries reaches the ground another way.
    if (useRecede && epoch >= 3) {
      const live = lobes.filter((l) => l.alive && l.kind !== FOUNDER)
      for (const l of live) l.dark = l.light * l.supply < STARVE ? l.dark + 1 : 0
      const starving = live.filter((l) => l.dark >= 2).sort((a, b) => a.light * a.supply - b.light * b.supply)
      let budget = Math.max(2, Math.round(live.length * 0.12))
      let any = false
      for (const l of starving) {
        if (budget <= 0) break
        if (!removable(l)) continue
        // A stump: drawn back toward where it grew from, a little thinner.
        const rear = sub(l.c, mul(l.u, l.h[0]))
        const hu = l.h[0] * 0.42
        l.c = add(rear, mul(l.u, hu))
        l.h = [hu, l.h[1] * 0.72, l.h[2] * 0.72]
        l.r = Math.min(l.r, 0.3 * Math.min(l.h[1], l.h[2]))
        l.alive = false
        l.receded = epoch
        recededCount += 1
        budget -= 1
        any = true
      }
      if (any) {
        rebuildOcc()
        computeSupply()
      }
    }
    // Growth: each organism builds its best-scoring faces, within its budget.
    for (let org = 0; org < sites.length; org += 1) {
      const mine = cands.filter((cd) => cd.l.org === org && cd.l.alive && cd.score > 0.1).sort((a, b) => b.score - a.score)
      const used: V[] = []
      const perParent = new Map<number, number>()
      let built = 0
      for (const cd of mine) {
        if (built >= BUDGET[org]!) break
        if ((perParent.get(cd.l.id) ?? 0) >= (cd.top ? 1 : 2)) continue
        const spacing = cd.l.h[1] * 2.4
        if (used.some((p) => Math.hypot(p[0] - cd.p[0], p[1] - cd.p[1], p[2] - cd.p[2]) < spacing)) continue
        if (!tryGrow(cd, epoch)) continue
        used.push(cd.p)
        perParent.set(cd.l.id, (perParent.get(cd.l.id) ?? 0) + 1)
        built += 1
      }
    }
    stage.push(lobes.filter((l) => l.alive).length)
  }
  rebuildOcc()
  computeSupply()
  for (const l of lobes) if (l.alive) l.light = Math.max(0, ...faceSamples(l).map((s) => lightAt(s.p, s.n)))

  // ------------------------------------------------------------------------------------------------ surface
  const grownAt = performance.now()
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  const box = (l: Lobe) => {
    const m = l.blend + 2
    return [extentAlong(l, [1, 0, 0]) + m, extentAlong(l, UP) + m, extentAlong(l, [0, 0, 1]) + m] as const
  }
  for (const l of lobes) {
    const [ex, ey, ez] = box(l)
    minX = Math.min(minX, l.c[0] - ex)
    minY = Math.min(minY, l.c[1] - ey)
    minZ = Math.min(minZ, l.c[2] - ez)
    maxX = Math.max(maxX, l.c[0] + ex)
    maxY = Math.max(maxY, l.c[1] + ey)
    maxZ = Math.max(maxZ, l.c[2] + ez)
  }
  const fx = Math.floor(minX)
  const fy = Math.floor(Math.max(minY, oy))
  const fz = Math.floor(minZ)
  const dx = Math.ceil(maxX - fx) + 2
  const dy = Math.ceil(maxY - fy) + 2
  const dz = Math.ceil(maxZ - fz) + 2
  const FAR = 6
  const field = new Float32Array(dx * dy * dz).fill(FAR)
  const owner = new Int32Array(dx * dy * dz).fill(-1)
  const fidx = (x: number, y: number, z: number) => (z * dy + y) * dx + x
  const grain = new Float32Array(dx * dy * dz)
  for (let z = 0; z < dz; z += 1) {
    for (let y = 0; y < dy; y += 1) {
      for (let x = 0; x < dx; x += 1) {
        const X = fx + x
        const Y = fy + y
        const Z = fz + z
        grain[fidx(x, y, z)] = 0.65 * (vnoise(X / 11, Y / 7, Z / 11) - 0.5) + 0.35 * (vnoise(X / 4.2 + 9, Y / 3.1, Z / 4.2) - 0.5)
      }
    }
  }
  // Fused in birth order: a lobe makes a fillet with its parent and a crease with anything else.
  for (const l of lobes) {
    const P = l.parent >= 0 ? lobes[l.parent]! : null
    const amp = Math.min(1.6, 0.4 + 0.1 * l.h[1])
    const [ex, ey, ez] = box(l)
    const x0 = Math.max(0, Math.floor(l.c[0] - ex - fx))
    const x1 = Math.min(dx - 1, Math.ceil(l.c[0] + ex - fx))
    const y0 = Math.max(0, Math.floor(l.c[1] - ey - fy))
    const y1 = Math.min(dy - 1, Math.ceil(l.c[1] + ey - fy))
    const z0 = Math.max(0, Math.floor(l.c[2] - ez - fz))
    const z1 = Math.min(dz - 1, Math.ceil(l.c[2] + ez - fz))
    for (let z = z0; z <= z1; z += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const q = fidx(x, y, z)
          const X = fx + x
          const Y = fy + y
          const Z = fz + z
          const d = Math.min(FAR, lobeSd(l, X, Y, Z) + amp * grain[q]!)
          const old = field[q]!
          let k = K_SMALL
          if (P) {
            const dp = lobeSd(P, X, Y, Z)
            k = K_SMALL + (l.blend - K_SMALL) * clamp01(1 - Math.max(0, dp) / (1.5 * l.blend))
          }
          field[q] = smin(old, d, Math.max(0.05, k))
          if (d < old) owner[q] = l.id
        }
      }
    }
  }
  // Nothing below the ground.
  for (let z = 0; z < dz; z += 1) {
    for (let x = 0; x < dx; x += 1) {
      const g = hAt(fx + x, fz + z) - 1.2
      for (let y = 0; y < dy && fy + y < g; y += 1) field[fidx(x, y, z)] = Math.max(field[fidx(x, y, z)]!, g - (fy + y))
    }
  }

  // Sheltered ground (headroom of 3 m under mass) and footprint, and solid by organism, before the field is flipped.
  let covered = 0
  let footprint = 0
  let inside = 0
  const orgVolume = [0, 0, 0]
  for (let z = 0; z < dz; z += 1) {
    for (let x = 0; x < dx; x += 1) {
      const g = hAt(fx + x, fz + z)
      let any = false
      let above = false
      let headroom = true
      for (let y = 0; y < dy; y += 1) {
        const q = field[fidx(x, y, z)]!
        const Y = fy + y
        if (q < 0) {
          inside += 1
          any = true
          const o = owner[fidx(x, y, z)]!
          if (o >= 0) orgVolume[lobes[o]!.org] = (orgVolume[lobes[o]!.org] ?? 0) + 1
          if (Y > g + 0.5 && Y <= g + 3) headroom = false
          if (Y > g + 3) above = true
        }
      }
      if (any) footprint += 1
      if (above && headroom) covered += 1
    }
  }
  for (let q = 0; q < field.length; q += 1) field[q] = -field[q]!
  const { positions, normals, indices } = surfaceNets(field, dx, dy, dz, [fx, fy, fz])

  // The material's growth record: birth runs along each lobe from where it grew to its tip, so the rings are growth fronts.
  const count = positions.length / 3
  const colours = new Float32Array(positions.length)
  const recordA = new Float32Array(count * 4)
  const recordB = new Float32Array(count * 4)
  const tones = [1.0, 0.97, 1.03]
  for (let v = 0; v < count; v += 1) {
    const p: V = [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!]
    const gx = Math.min(dx - 1, Math.max(0, Math.round(p[0] - fx)))
    const gy = Math.min(dy - 1, Math.max(0, Math.round(p[1] - fy)))
    const gz = Math.min(dz - 1, Math.max(0, Math.round(p[2] - fz)))
    let o = owner[fidx(gx, gy, gz)]!
    if (o < 0) {
      for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const xx = gx + a
        const yy = gy + b
        const zz = gz + c
        if (xx < 0 || yy < 0 || zz < 0 || xx >= dx || yy >= dy || zz >= dz) continue
        if (owner[fidx(xx, yy, zz)]! >= 0) {
          o = owner[fidx(xx, yy, zz)]!
          break
        }
      }
    }
    const l = lobes[Math.max(0, o)]!
    const along = l.kind === FOUNDER ? clamp01((p[1] - lowest(l)) / (2 * extentAlong(l, UP))) : clamp01(dot(sub(p, sub(l.c, mul(l.u, l.h[0]))), l.u) / (2 * l.h[0]))
    const birth = (l.epoch + 0.9 * along) / (E + 1)
    const vitality = l.receded >= 0 ? 0.12 : l.dark > 0 ? 0.42 : 0.58 + 0.34 * clamp01(l.light * l.supply * 1.8)
    const stress = clamp01(l.run / Math.max(1, allowedRun(l)))
    const up = p[1] - hAt(p[0], p[2])
    recordA.set([birth, vitality, stress, 0], v * 4)
    recordB.set([l.light, moistureAt(p[0], p[2]) * (1 - smoothstep(0, 8, up)), ((l.id * 2654435761) >>> 0) / 4294967296, l.kind === STRATUM ? 0.8 : 0.45], v * 4)
    const colour = skin(Math.max(0, up), 0.3 * along, tones[l.org]!, 0)
    const shade = (normals[v * 3 + 1]! < -0.4 ? 0.86 : 1) * (1 + 0.04 * (normals[v * 3]! * wind[0] + normals[v * 3 + 2]! * wind[2]))
    colours[v * 3] = colour.r * shade
    colours[v * 3 + 1] = colour.g * shade
    colours[v * 3 + 2] = colour.b * shade
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setAttribute('color', new BufferAttribute(colours, 3))
  geometry.setAttribute('aGrowthA', new BufferAttribute(recordA, 4))
  geometry.setAttribute('aGrowthB', new BufferAttribute(recordB, 4))
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1))
  geometry.computeBoundingSphere()

  let top = cy
  for (let q = 1; q < positions.length; q += 3) top = Math.max(top, positions[q]!)
  const graph: StrataGraph = { lobes, fusions, epochs: E }
  livingArchitecture.graph = graph
  livingArchitecture.version += 1
  const alive = lobes.filter((l) => l.alive)
  const thick = alive.map((l) => 2 * l.h[1]).sort((a, b) => a - b)
  const stats = {
    experiment: 7,
    epochs: E,
    variation,
    light: useLight ? 1 : 0,
    structure: useStructure ? 1 : 0,
    recede: useRecede ? 1 : 0,
    lobes: lobes.length,
    alive: alive.length,
    receded: recededCount,
    founders: lobes.filter((l) => l.kind === FOUNDER).length,
    strata: lobes.filter((l) => l.kind === STRATUM).length,
    arms: lobes.filter((l) => l.kind === ARM).length,
    buttresses,
    shortened,
    rejectedStructure,
    fusions,
    lobesDominant: lobes.filter((l) => l.org === 0).length,
    lobesSub1: lobes.filter((l) => l.org === 1).length,
    lobesSub2: lobes.filter((l) => l.org === 2).length,
    volumeDominant: orgVolume[0]!,
    volumeSub1: orgVolume[1]!,
    volumeSub2: orgVolume[2]!,
    thicknessMin: Math.round((thick[0] ?? 0) * 10) / 10,
    thicknessMedian: Math.round((thick[Math.floor(thick.length / 2)] ?? 0) * 10) / 10,
    thicknessMax: Math.round((thick[thick.length - 1] ?? 0) * 10) / 10,
    maxRun: Math.round(Math.max(0, ...lobes.map((l) => l.run)) * 10) / 10,
    solidVolume: inside,
    footprint,
    covered,
    ...Object.fromEntries(stage.map((s, i) => [`alive${i + 1}`, s])),
    vertices: count,
    triangles: indices.length / 3,
    height: Math.round(top - cy),
    growMs: Math.round(grownAt - started),
    milliseconds: Math.round(performance.now() - started),
  }
  return { geometry, site: [sx, sz], ground: cy, organisms: sites.length, height: top - cy, stats, graph }
}
