import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three'
import { sunAt } from '../project/sun.ts'
import { clamp01, smoothstep } from '../project02/core.ts'
import { chooseSite, skin, waterBearing } from './livingArchitecture.ts'
import type { Population } from './livingEcology.ts'
import { surfaceNets } from './livingMesh.ts'
import { landscapeHeight } from './terrain.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — Living Architecture, the skeleton experiment (?architecture=skeleton): a structural growth network with
 * volumetric accretion, built to test whether growth that depends on its parent, with thickness taken from load, can make a
 * connected organism that is not a tower, a disc or a scaffold. One organism (LA-01's site), one file, no new dependencies.
 *
 * NETWORK. A tree of nodes grown tick by tick (100 ticks = age 1, the reference form; ages up to 3). Tips, not parts, make it:
 *   trunk   rises, steered by light (the sun's rays through the nodes already grown), crowding and a lean of its own; forks limbs
 *           toward the more open side when it has energy; stops at the height the light and ground allow
 *   limb    leaves a fork outward, away from the axis it left, steered by light and open space, sagging as it lengthens; forks
 *           again when well lit; sets a support (a prop) down to the ground where its unsupported run has outgrown what its
 *           vigour can carry, so props appear where the structure asks for them, not at a spacing
 *   root    follows the ground toward the water
 *   prop    descends from a limb to the ground
 * Every node has a parent, so nothing exists that did not grow from something that exists. Nothing here is placed by its
 * shape; the tips' headings come from the environment and what has been grown.
 *
 * ACCRETION. At any age the nodes born by then are given a thickness by the pipe model: the load a node carries (its own mass,
 * more where it is lit, plus everything beyond it) sets its radius, so trunks and limb roots are stout and tips thin, and a base
 * thickens as the structure grows on it. A limb is wider than it is tall (light-fed deposition from above). Each member's
 * distance field is a capsule; the union is smooth, so members merge with fillets, and strata are cut by height. The surface is
 * extracted by surface nets, for a set of ages, once each, and cached.
 *
 * LATE LIFE. Each node has a weathering date from how thin, high and exposed it is; it thins by its own amount; a node that falls
 * below a minimum thickness takes everything beyond it (except a prop standing on the ground), so decay is uneven and cannot
 * detach anything from its source. Where light and moisture allow, receded tissue is partly restored and shoots grow from
 * surviving nodes.
 */

export const SK_TICKS = 100
export const SK_NX = 72
export const SK_NY = 44
export const SK_NZ = 72
export const SK_CELL = 1.5
export const SK_LEVELS = 48
export const SK_MAX_AGE = 3

const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return x - Math.floor(x)
}
const K_ROOT = 0
const K_TRUNK = 1
const K_LIMB = 2
const K_PROP = 3
const K_SHOOT = 4

export type Skeleton = {
  n: number
  x: Float32Array
  y: Float32Array
  z: Float32Array
  parent: Int32Array
  born: Int16Array
  kind: Uint8Array
  mass: Float32Array
  vul: Float32Array
  rg: Float32Array
  site: [number, number]
  y0: number
  ground: Float32Array
  moisture: number
  stats: Record<string, number | string>
}

type Tip = {
  node: number
  x: number
  y: number
  z: number
  dx: number
  dy: number
  dz: number
  kind: number
  energy: number
  start: number
  done: boolean
  len: number
  maxLen: number
  run: number
  lean: [number, number]
  axis: [number, number]
  forks: number
  sinceFork: number
  id: number
}

export function growSkeleton(world: World, seed: number, population: Population | null): Skeleton {
  const started = performance.now()
  const [sx, sz] = chooseSite(world, seed)
  const g0 = landscapeHeight(sx, sz)
  const base = population?.organisms[0]?.base ?? { light: 0.7, moisture: 0.5, resource: 0.6, waterDist: 90 }
  const L = clamp01(base.light)
  const wet = clamp01(base.moisture)
  const rich = clamp01(base.resource)
  const y0 = g0 - 6
  const x0 = sx - (SK_NX * SK_CELL) / 2
  const z0 = sz - (SK_NZ * SK_CELL) / 2
  const ground = new Float32Array(SK_NX * SK_NZ)
  for (let k = 0; k < SK_NZ; k += 1) for (let i = 0; i < SK_NX; i += 1) ground[k * SK_NX + i] = landscapeHeight(x0 + (i + 0.5) * SK_CELL, z0 + (k + 0.5) * SK_CELL)
  const gY = (x: number, z: number) => landscapeHeight(x, z)

  let mx = 0
  let my = 0
  let mz = 0
  for (const h of [8, 10, 12, 14, 16]) {
    const d = sunAt(h, 55).direction
    mx += d[0]
    my += d[1]
    mz += d[2]
  }
  const ml = Math.hypot(mx, mz) || 1
  const sun: [number, number, number] = [mx / ml, Math.min(1.2, Math.max(0.4, my / ml)), mz / ml]
  const sl = Math.hypot(...sun)
  const sunV: [number, number, number] = [sun[0] / sl, sun[1] / sl, sun[2] / sl]
  const wb = waterBearing(world, sx, sz)
  const toWater: [number, number] = [wb[0], wb[2]]
  const neighbours: { d: number; bx: number; bz: number; size: number }[] = []
  if (population) {
    for (const o of population.organisms.slice(1)) {
      const d = Math.hypot(o.x - sx, o.z - sz)
      if (d > 320) continue
      neighbours.push({ d, bx: (o.x - sx) / d, bz: (o.z - sz) / d, size: o.form.size ?? 1 })
    }
  }
  const crowdAt = (dx: number, dz: number) => {
    const l = Math.hypot(dx, dz) || 1
    return Math.min(1, neighbours.reduce((acc, n) => acc + Math.exp(-n.d / 120) * Math.pow(Math.max(0, (dx / l) * n.bx + (dz / l) * n.bz), 2) * n.size, 0))
  }

  // Density of what has been grown (3 m cells), for shade and crowding.
  const DC = 3
  const DX = 48
  const DY = 28
  const DZ = 48
  const dens = new Float32Array(DX * DY * DZ)
  const di = (x: number, y: number, z: number) => {
    const i = Math.floor((x - sx) / DC) + DX / 2
    const j = Math.floor((y - y0) / DC)
    const k = Math.floor((z - sz) / DC) + DZ / 2
    if (i < 0 || j < 0 || k < 0 || i >= DX || j >= DY || k >= DZ) return -1
    return (k * DY + j) * DX + i
  }
  const densAt = (x: number, y: number, z: number) => {
    const id = di(x, y, z)
    return id < 0 ? 0 : dens[id]!
  }
  const lightAt = (x: number, y: number, z: number) => {
    let shade = 0
    for (let s = 1; s <= 9; s += 1) shade += densAt(x + sunV[0] * s * 3, y + sunV[1] * s * 3, z + sunV[2] * s * 3)
    return Math.exp(-0.22 * shade)
  }

  const xs: number[] = []
  const ys: number[] = []
  const zs: number[] = []
  const parent: number[] = []
  const born: number[] = []
  const kinds: number[] = []
  const mass: number[] = []
  const push = (x: number, y: number, z: number, p: number, t: number, kind: number, m: number) => {
    xs.push(x)
    ys.push(y)
    zs.push(z)
    parent.push(p)
    born.push(t)
    kinds.push(kind)
    mass.push(m)
    const id = di(x, y, z)
    if (id >= 0) dens[id] = dens[id]! + 0.55
    return xs.length - 1
  }

  const founder = push(sx, g0 - 1, sz, -1, 0, K_ROOT, 4)
  const tips: Tip[] = []
  let serial = 0
  const norm = (a: number, b: number, c: number): [number, number, number] => {
    const l = Math.hypot(a, b, c) || 1
    return [a / l, b / l, c / l]
  }
  const addTip = (from: number, kind: number, dir: [number, number, number], energy: number, start: number, maxLen: number, lean: [number, number] = [0, 0], axis: [number, number] = [0, 0]) => {
    const [dx, dy, dz] = norm(...dir)
    tips.push({ node: from, x: xs[from]!, y: ys[from]!, z: zs[from]!, dx, dy, dz, kind, energy, start, done: false, len: 0, maxLen, run: 0, lean, axis, forks: 0, sinceFork: 0, id: serial++ })
  }
  const Hmax = 27 + 13 * L + 7 * (rich - 0.4)
  const up = (a: number, b: number): [number, number, number] => [a, 1, b]
  // Three rising trunks of different lean (toward the light, toward the water, away from both), and roots along the ground.
  addTip(founder, K_TRUNK, up(sunV[0] * 0.35, sunV[2] * 0.35), 1.2, 0, Hmax, [sunV[0], sunV[2]])
  addTip(founder, K_TRUNK, up(toWater[0] * 0.3, toWater[1] * 0.3), 1.0, 6, Hmax * 0.78, [toWater[0], toWater[1]])
  addTip(founder, K_TRUNK, up(-sunV[0] * 0.2 - toWater[0] * 0.15, -sunV[2] * 0.2 - toWater[1] * 0.15), 0.9, 12, Hmax * 0.6, [-sunV[0], -sunV[2]])
  const rootAngle = Math.atan2(toWater[1], toWater[0])
  for (const [turn, len, start] of [[-0.55, 22 + 30 * wet, 0], [0.5, 18 + 26 * wet, 4], [2.1, 14 + 10 * wet, 8], [-2.3, 14, 10]] as const) {
    addTip(founder, K_ROOT, [Math.cos(rootAngle + turn), 0, Math.sin(rootAngle + turn)], 2, start, len)
  }

  const STEP = 0.6
  const COMMIT = 4
  const MAXN = 2600
  const GROW_END = 100
  const CANDS: [number, number][] = [
    [0, 0],
    [0.5, 0],
    [-0.5, 0],
    [1.0, 0],
    [-1.0, 0],
    [0, 0.4],
    [0, -0.4],
    [0.6, 0.3],
    [-0.6, 0.3],
  ]
  const rotate = (d: [number, number, number], yaw: number, pitch: number): [number, number, number] => {
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    const nx = d[0] * c - d[2] * s
    const nz = d[0] * s + d[2] * c
    return norm(nx, d[1] + pitch, nz)
  }
  let steps = 0
  for (let t = 0; t < 300; t += 1) {
    if (t === 200) {
      // Renewal: shoots from tissue that is still there and well placed (decided from the network as it stands).
      const alive: number[] = []
      for (let i = 0; i < xs.length; i += 1) if (kinds[i] !== K_PROP && kinds[i] !== K_ROOT && born[i]! < 100) alive.push(i)
      alive.sort((a, b) => lightAt(xs[b]!, ys[b]!, zs[b]!) * (0.5 + hash(b, 7)) - lightAt(xs[a]!, ys[a]!, zs[a]!) * (0.5 + hash(a, 7)))
      let made = 0
      for (const i of alive) {
        if (made >= 3) break
        if (ys[i]! - g0 < 6) continue
        if (lightAt(xs[i]!, ys[i]!, zs[i]!) < 0.45 * (0.6 + 0.6 * wet)) continue
        addTip(i, K_SHOOT, norm((hash(i, 1) - 0.5) * 1.2, 1, (hash(i, 2) - 0.5) * 1.2), 1.0, 200 + made * 10, 8 + 10 * L)
        made += 1
      }
    }
    for (const tip of tips) {
      if (tip.done || t < tip.start || xs.length >= MAXN) continue
      if (t >= GROW_END && tip.kind !== K_SHOOT) {
        tip.done = true
        continue
      }
      steps += 1
      const d: [number, number, number] = [tip.dx, tip.dy, tip.dz]
      let best = d
      if (tip.kind !== K_PROP) {
        let bestScore = -Infinity
        for (const [yaw, pitch] of CANDS) {
          const c = rotate(d, yaw, pitch)
          const px = tip.x + c[0] * 2.4
          const py = tip.y + c[1] * 2.4
          const pz = tip.z + c[2] * 2.4
          const gd = gY(px, pz)
          let s = 0.9 * lightAt(px, py, pz) - 0.4 * densAt(px, py, pz) + 1.3 * (c[0] * d[0] + c[1] * d[1] + c[2] * d[2]) - 1.0 * crowdAt(c[0], c[2])
          if (tip.kind === K_ROOT) {
            s += 1.1 * (c[0] * toWater[0] + c[2] * toWater[1]) - 2.5 * Math.abs(py - (gd + 0.3))
          } else {
            if (py < gd + 1.2) s -= 3
            if (tip.kind === K_TRUNK || tip.kind === K_SHOOT) {
              const over = Math.max(0, (tip.y - g0) / Hmax - 0.75)
              s += (1.2 - 2.5 * over) * c[1] + 0.5 * (c[0] * tip.lean[0] + c[2] * tip.lean[1])
            } else {
              // A limb goes out from the axis it left, toward open ground.
              s += 1.0 * (c[0] * tip.axis[0] + c[2] * tip.axis[1]) + 0.4 * (c[0] * sunV[0] + c[2] * sunV[2])
            }
          }
          if (s > bestScore) {
            bestScore = s
            best = c
          }
        }
        const k = tip.kind === K_ROOT ? 0.4 : 0.5
        const m = norm(d[0] * (1 - k) + best[0] * k, d[1] * (1 - k) + best[1] * k, d[2] * (1 - k) + best[2] * k)
        tip.dx = m[0]
        tip.dy = m[1]
        tip.dz = m[2]
        if (tip.kind === K_LIMB) {
          // A limb sags under its own growing load.
          const sag = norm(tip.dx, tip.dy - 0.012 * (1 + tip.len / 14), tip.dz)
          tip.dx = sag[0]
          tip.dy = sag[1]
          tip.dz = sag[2]
        }
      } else {
        tip.dy = -1
        tip.dx *= 0.9
        tip.dz *= 0.9
      }
      tip.x += tip.dx * STEP
      tip.y += tip.dy * STEP
      tip.z += tip.dz * STEP
      tip.len += STEP
      if (tip.kind === K_ROOT) tip.y = gY(tip.x, tip.z) + 0.2
      const gnow = gY(tip.x, tip.z)
      if (tip.kind === K_PROP && tip.y <= gnow - 0.4) {
        tip.y = gnow - 1.2
        tip.done = true
      }
      if ((t - tip.start) % COMMIT === 0 || tip.done) {
        const light = lightAt(tip.x, tip.y, tip.z)
        const m = 1 + 2.4 * light
        tip.node = push(tip.x, tip.y, tip.z, tip.node, t, tip.kind, m)
        tip.energy += 0.3 * light - 0.1
        tip.sinceFork += 1
        tip.run += STEP * COMMIT
        // Forking: a trunk puts out a limb toward its more open side; a limb forks again where it is well lit.
        const room = xs.length < MAXN - 200
        if (room && (tip.kind === K_TRUNK || tip.kind === K_LIMB) && tip.energy > (tip.kind === K_TRUNK ? 1.15 : 1.35) && tip.sinceFork >= (tip.kind === K_TRUNK ? 5 : 6) && tip.forks < (tip.kind === K_TRUNK ? 5 : 3) && tip.y - g0 > (tip.kind === K_TRUNK ? 7 : 3)) {
          const h = [rotate([tip.dx, 0, tip.dz], 0.9 + 0.5 * hash(tip.id, tip.forks), 0), rotate([tip.dx, 0, tip.dz], -0.9 - 0.5 * hash(tip.id, tip.forks + 9), 0)]
          const a = lightAt(tip.x + h[0]![0] * 6, tip.y, tip.z + h[0]![2] * 6) * (1 - crowdAt(h[0]![0], h[0]![2]))
          const b = lightAt(tip.x + h[1]![0] * 6, tip.y, tip.z + h[1]![2] * 6) * (1 - crowdAt(h[1]![0], h[1]![2]))
          const pick = a >= b ? h[0]! : h[1]!
          const openness = Math.max(a, b)
          if (openness > 0.3) {
            const give = tip.energy * 0.5
            const axisL = norm(tip.x - sx, 0, tip.z - sz)
            const out: [number, number] = tip.kind === K_TRUNK ? [pick[0], pick[2]] : tip.axis
            addTip(tip.node, K_LIMB, [pick[0] + (tip.kind === K_LIMB ? 0 : 0), 0.12, pick[2]], give, t + 1, (22 + 22 * L) * (1 - 0.45 * crowdAt(pick[0], pick[2])) * (tip.kind === K_LIMB ? 0.7 : 1), [0, 0], tip.kind === K_TRUNK ? out : [axisL[0] * 0.3 + pick[0] * 0.7, axisL[2] * 0.3 + pick[2] * 0.7])
            tip.energy -= give
            tip.forks += 1
            tip.sinceFork = 0
          }
        }
        // Support: a limb whose unsupported run has outgrown what its vigour can carry sets a prop down to the ground.
        if (room && tip.kind === K_LIMB && tip.y - gnow > 5) {
          const capacity = 10 + 9 * Math.max(0, Math.min(1.5, tip.energy)) + 6 * hash(tip.id, Math.floor(tip.len))
          if (tip.run > capacity) {
            addTip(tip.node, K_PROP, [0, -1, 0], 1, t + 1, 60)
            tip.run = 0
          }
        }
        if (tip.kind === K_TRUNK || tip.kind === K_SHOOT) {
          if (tip.y - g0 >= tip.maxLen || tip.energy < -0.2 || (tip.kind === K_SHOOT && tip.len > tip.maxLen)) tip.done = true
        } else if (tip.kind === K_LIMB) {
          if (tip.len > tip.maxLen || tip.energy < -0.25) tip.done = true
        } else if (tip.kind === K_ROOT && tip.len > tip.maxLen) tip.done = true
      }
    }
  }
  const n = xs.length
  // Weathering vulnerability and renewal potential per node.
  const vul = new Float32Array(n)
  const rg = new Float32Array(n)
  const depthOf = new Int16Array(n)
  for (let i = 1; i < n; i += 1) depthOf[i] = depthOf[parent[i]!]! + 1
  const maxDepth = Math.max(...depthOf)
  for (let i = 0; i < n; i += 1) {
    const kindExpo = kinds[i] === K_LIMB || kinds[i] === K_SHOOT ? 0.85 : kinds[i] === K_TRUNK ? 0.45 : kinds[i] === K_PROP ? 0.25 : 0.15
    const high = clamp01((ys[i]! - g0) / 40)
    vul[i] = clamp01(0.5 * kindExpo + 0.3 * (depthOf[i]! / (maxDepth || 1)) + 0.2 * high + 0.12 * (hash(i, 3) - 0.5))
    rg[i] = clamp01((kinds[i] === K_ROOT ? 0.8 : 0.45) * (0.35 + 0.65 * (0.5 * wet + 0.5 * L)) * (1 - 0.5 * vul[i]!) + 0.1 * hash(i, 5))
  }
  const count = (k: number) => kinds.filter((x) => x === k).length
  return {
    n,
    x: Float32Array.from(xs),
    y: Float32Array.from(ys),
    z: Float32Array.from(zs),
    parent: Int32Array.from(parent),
    born: Int16Array.from(born),
    kind: Uint8Array.from(kinds),
    mass: Float32Array.from(mass),
    vul,
    rg,
    site: [sx, sz],
    y0,
    ground,
    moisture: wet,
    stats: { nodes: n, trunk: count(K_TRUNK), limb: count(K_LIMB), prop: count(K_PROP), root: count(K_ROOT), shoot: count(K_SHOOT), maxDepth, height: Math.round(Hmax), tipSteps: steps, growMs: Math.round(performance.now() - started) },
  }
}

// -------------------------------------------------------------------------------------------------------------- the age
/** Each node's present radius and whether it is alive, at an age (0 to 3; 1 is the reference form). */
export function skeletonState(sk: Skeleton, age: number) {
  const tick = age * SK_TICKS
  const n = sk.n
  const present = new Uint8Array(n)
  const load = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    if (sk.born[i]! <= tick) {
      present[i] = 1
      load[i] = sk.mass[i]!
    }
  }
  for (let i = n - 1; i > 0; i -= 1) if (present[i]) load[sk.parent[i]!]! += load[i]!
  const radius = new Float32Array(n)
  const alive = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) {
    if (!present[i]) continue
    const g = 0.45 + 0.55 * smoothstep(0, 28, tick - sk.born[i]!)
    const date = 1.45 + 1.1 * (1 - sk.vul[i]!) + 0.15 * (hash(i, 11) - 0.5)
    const rho = smoothstep(date, date + 0.55, age)
    const depth = 0.2 + 0.6 * sk.vul[i]!
    const restored = smoothstep(2.0, 2.9, age) * sk.rg[i]! * 0.75
    const recede = depth * rho * (1 - restored)
    const kindK = sk.kind[i] === K_ROOT || sk.kind[i] === K_PROP ? 0.9 : 1
    radius[i] = Math.max(1.4, 0.3 * Math.pow(load[i]!, 0.46)) * kindK * g * (1 - 0.8 * recede)
  }
  for (let i = 0; i < n; i += 1) {
    if (!present[i]) continue
    const ok = radius[i]! >= 0.95
    if (i === 0) alive[i] = ok ? 1 : 0
    else alive[i] = ok && (alive[sk.parent[i]!] || sk.kind[i] === K_PROP) ? 1 : 0
  }
  return { present, alive, radius }
}

/** The signed field (positive inside, in metres) and the node that made each cell, at an age. */
export function skeletonField(sk: Skeleton, age: number) {
  const NX = SK_NX
  const NY = SK_NY
  const NZ = SK_NZ
  const field = new Float32Array(NX * NY * NZ).fill(-50)
  const owner = new Int16Array(NX * NY * NZ).fill(-1)
  const { alive, radius } = skeletonState(sk, age)
  const x0 = sk.site[0] - (NX * SK_CELL) / 2
  const z0 = sk.site[1] - (NZ * SK_CELL) / 2
  const K = 2.6
  const cellAt = (v: number, o: number) => (v - o) / SK_CELL - 0.5
  for (let s = 0; s < sk.n; s += 1) {
    if (!alive[s]) continue
    const p = s === 0 ? 0 : sk.parent[s]!
    const ax = sk.x[p]!
    const ay = sk.y[p]!
    const az = sk.z[p]!
    const bx = sk.x[s]!
    const by = sk.y[s]!
    const bz = sk.z[s]!
    const rA = s === 0 ? radius[s]! : radius[p]!
    const rB = radius[s]!
    const lateral = sk.kind[s] === K_LIMB || sk.kind[s] === K_SHOOT
    const flat = lateral ? 1.9 : 1
    const thin = lateral ? 0.7 : 1
    const rmax = Math.max(rA, rB) * flat + K + 1.5
    const i0 = Math.max(0, Math.floor(cellAt(Math.min(ax, bx) - rmax, x0)))
    const i1 = Math.min(NX - 1, Math.ceil(cellAt(Math.max(ax, bx) + rmax, x0)))
    const j0 = Math.max(0, Math.floor(cellAt(Math.min(ay, by) - rmax, sk.y0)))
    const j1 = Math.min(NY - 1, Math.ceil(cellAt(Math.max(ay, by) + rmax, sk.y0)))
    const k0 = Math.max(0, Math.floor(cellAt(Math.min(az, bz) - rmax, z0)))
    const k1 = Math.min(NZ - 1, Math.ceil(cellAt(Math.max(az, bz) + rmax, z0)))
    const abx = bx - ax
    const aby = by - ay
    const abz = bz - az
    const ll = abx * abx + aby * aby + abz * abz
    const len = Math.sqrt(ll) || 1
    const tx = abx / len
    const ty = aby / len
    const tz = abz / len
    // Frame for a flat member: side across (horizontal), and the vertical-ish axis.
    let sdx = ty * 0 - tz * 1
    let sdz = tx * 1 - ty * 0
    const sl = Math.hypot(sdx, sdz) || 1
    sdx /= sl
    sdz /= sl
    const flatOk = lateral && Math.abs(ty) < 0.7
    for (let k = k0; k <= k1; k += 1) {
      const wz = z0 + (k + 0.5) * SK_CELL
      for (let j = j0; j <= j1; j += 1) {
        const wy = sk.y0 + (j + 0.5) * SK_CELL
        for (let i = i0; i <= i1; i += 1) {
          const wx = x0 + (i + 0.5) * SK_CELL
          const qx = wx - ax
          const qy = wy - ay
          const qz = wz - az
          const h = ll > 1e-6 ? Math.max(0, Math.min(1, (qx * abx + qy * aby + qz * abz) / ll)) : 0
          const r = rA + (rB - rA) * h
          const ex = qx - abx * h
          const ey = qy - aby * h
          const ez = qz - abz * h
          let v: number
          if (flatOk) {
            const across = Math.abs(ex * sdx + ez * sdz)
            const vert = Math.abs(ey - (ex * tx + ez * tz) * 0)
            const q = Math.sqrt((across / (r * flat)) ** 2 + (vert / (r * thin)) ** 2)
            v = (1 - q) * Math.min(r * flat, r * thin)
          } else v = r - Math.hypot(ex, ey, ez)
          const id = (k * NY + j) * NX + i
          const cur = field[id]!
          // Smooth maximum: members merge with a fillet.
          const dd = Math.abs(v - cur)
          const hh = Math.max(K - dd, 0) / K
          const out = Math.max(v, cur) + hh * hh * K * 0.25
          if (v > cur) owner[id] = s
          field[id] = out
        }
      }
    }
  }
  // The ground: nothing below a little under it, so the surface closes inside the terrain; the grid's edge is empty.
  for (let k = 0; k < NZ; k += 1) {
    for (let i = 0; i < NX; i += 1) {
      const g = sk.ground[k * NX + i]!
      for (let j = 0; j < NY; j += 1) {
        const id = (k * NY + j) * NX + i
        const wy = sk.y0 + (j + 0.5) * SK_CELL
        if (wy < g - 2.5) field[id] = Math.min(field[id]!, -1)
        if (i === 0 || k === 0 || j === 0 || i === NX - 1 || k === NZ - 1 || j === NY - 1) field[id] = -1
      }
    }
  }
  // Strata: laid down with the organism, cut deeper as the softer layers weather.
  const amp = 0.35 * smoothstep(0.15, 0.9, age) + 0.5 * smoothstep(1.4, 2.6, age)
  if (amp > 0.01) {
    for (let k = 1; k < NZ - 1; k += 1) {
      for (let j = 1; j < NY - 1; j += 1) {
        const yy = (sk.y0 + (j + 0.5) * SK_CELL - sk.y0) / 4.4
        for (let i = 1; i < NX - 1; i += 1) {
          const id = (k * NY + j) * NX + i
          const f = field[id]!
          if (f > -1.6 && f < 1.6) field[id] = f + amp * (0.5 - (yy - Math.floor(yy)))
        }
      }
    }
  }
  return { field, owner }
}

/** The surface at an age. */
export function skeletonMesh(sk: Skeleton, age: number): BufferGeometry {
  const { field, owner } = skeletonField(sk, age)
  const net = surfaceNets(field, SK_NX, SK_NY, SK_NZ, [0, 0, 0], 0)
  const count = net.positions.length / 3
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const colours = new Float32Array(count * 3)
  const recordA = new Float32Array(count * 4)
  const recordB = new Float32Array(count * 4)
  const arrival = new Float32Array(count)
  const decay = new Float32Array(count).fill(9)
  const x0 = sk.site[0] - (SK_NX * SK_CELL) / 2
  const z0 = sk.site[1] - (SK_NZ * SK_CELL) / 2
  for (let v = 0; v < count; v += 1) {
    const gx = net.positions[v * 3]!
    const gy = net.positions[v * 3 + 1]!
    const gz = net.positions[v * 3 + 2]!
    positions[v * 3] = x0 + (gx + 0.5) * SK_CELL
    positions[v * 3 + 1] = sk.y0 + (gy + 0.5) * SK_CELL
    positions[v * 3 + 2] = z0 + (gz + 0.5) * SK_CELL
    normals[v * 3] = net.normals[v * 3]!
    normals[v * 3 + 1] = net.normals[v * 3 + 1]!
    normals[v * 3 + 2] = net.normals[v * 3 + 2]!
    const ci = Math.max(0, Math.min(SK_NX - 1, Math.round(gx)))
    const cj = Math.max(0, Math.min(SK_NY - 1, Math.round(gy)))
    const ck = Math.max(0, Math.min(SK_NZ - 1, Math.round(gz)))
    const who = owner[(ck * SK_NY + cj) * SK_NX + ci]!
    const bornAge = who >= 0 ? sk.born[who]! / SK_TICKS : 0
    const ground = sk.ground[ck * SK_NX + ci]!
    const above = Math.max(0, positions[v * 3 + 1]! - ground)
    const ny = normals[v * 3 + 1]!
    const colour = skin(above, 0.3 + 0.3 * (1 - Math.abs(ny)), 1, sk.moisture)
    colours.set([colour.r, colour.g, colour.b], v * 3)
    recordA.set([clamp01(bornAge), 0.8, above < 3 ? 0.25 : 0.05, 0], v * 4)
    recordB.set([clamp01(0.3 + 0.55 * Math.max(0, ny)), clamp01(sk.moisture * (1 - smoothstep(0, 7, above))), who >= 0 ? hash(who, 1) : 0.5, 0.5], v * 4)
    arrival[v] = bornAge
    if (who >= 0) decay[v] = 1.45 + 1.1 * (1 - sk.vul[who]!)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('color', new BufferAttribute(colours, 3))
  geometry.setAttribute('aGrowthA', new BufferAttribute(recordA, 4))
  geometry.setAttribute('aGrowthB', new BufferAttribute(recordB, 4))
  geometry.setAttribute('aArrival', new BufferAttribute(arrival, 1))
  geometry.setAttribute('aDecay', new BufferAttribute(decay, 1))
  geometry.setIndex(new BufferAttribute(new Uint32Array(net.indices), 1))
  geometry.boundingSphere = new Sphere(new Vector3(sk.site[0], sk.y0 + 30, sk.site[1]), 120)
  return geometry
}
