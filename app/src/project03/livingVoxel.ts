import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three'
import { sunAt } from '../project/sun.ts'
import { clamp01, smoothstep } from '../project02/core.ts'
import { chooseSite, skin, waterBearing, waterDistance } from './livingArchitecture.ts'
import type { Population } from './livingEcology.ts'
import { surfaceNets } from './livingMesh.ts'
import { landscapeHeight } from './terrain.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — LA-01 as a voxel organism (?architecture=voxel): a proof of concept for a growth that is connected at
 * every age by construction.
 *
 * Representation. Occupancy on a 1.5 m grid around the site (72 × 44 × 72 cells), grown once, from a plinth set into the ground,
 * in 96 ticks. Every cell remembers the tick it was added (birth), so the organism at any age is simply the cells born by
 * then: monotone, deterministic, scrubbable in either direction, and a cell is only ever added next to a cell that is there, so
 * each age is one connected body that begins in the ground (no floating tissue, no open shell). The surface is extracted
 * from the smoothed occupancy (surface nets, livingMesh.ts) for a set of ages once and kept; scrubbing and playback show the
 * nearest, and an age that has not been made yet shows the one before it, so the organism never blanks.
 *
 * Growth (the same few rules at every tick; each cell that touches the body is a candidate and the best are taken, in the
 * numbers the tick's budget allows):
 *   light       a cell is worth more the less of the body stands between it and the sun, and the more open sky is above it:
 *               the body rises and its shelves reach toward the light
 *   moisture    at the ground the body spreads, toward the water (roots, a broad base); low shelves lean that way
 *   load        each layer needs a footprint for the weight above it (the area grows with the mass above); the body only
 *               rises on a layer that has it, and a deficient layer thickens first: the base is stout
 *   strata      a shelf grows only in a stratum (a layer three cells thick, every seven), and a stratum opens when the body has
 *               risen past it: the layering
 *   overhang    a cell with nothing under it is only allowed within a run of a supported cell, the run longer for a thicker
 *               shelf; where a shelf runs far, cells beneath it are taken (a prop grows down to the ground, widening into
 *               a pier): the undercroft is what is left between the props and the keep
 *   competition a shelf does not reach toward near neighbours
 */

export const VOXEL = 1.5
export const NX = 72
export const NY = 44
export const NZ = 72
export const TICKS = 96

export type VoxelOrganism = {
  solid: Uint8Array
  birth: Int16Array
  ground: Int16Array
  /** World position of the grid's minimum corner. */
  origin: [number, number, number]
  site: [number, number]
  stats: Record<string, number | string>
}

const at = (i: number, j: number, k: number) => (k * NY + j) * NX + i
const hash = (a: number, b: number, c: number, d: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7 + d * 19.3) * 43758.5453
  return x - Math.floor(x)
}
const H4: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

export function growVoxel(world: World, seed: number, population: Population | null): VoxelOrganism {
  const started = performance.now()
  const [sx, sz] = chooseSite(world, seed)
  const g0 = landscapeHeight(sx, sz)
  const base = population?.organisms[0]?.base ?? { light: 0.7, moisture: 0.5, resource: 0.6, waterDist: 90 }
  const L = clamp01(base.light)
  const wet = clamp01(base.moisture)
  const rich = clamp01(base.resource)
  const x0 = sx - (NX * VOXEL) / 2
  const z0 = sz - (NZ * VOXEL) / 2
  const y0 = g0 - 8

  // The sun's mean heading and height, the water's bearing, the neighbours'.
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
  const sun: [number, number] = [mx / ml, mz / ml]
  const sunRise = Math.min(1.2, Math.max(0.4, my / ml))
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

  const solid = new Uint8Array(NX * NY * NZ)
  const birth = new Int16Array(NX * NY * NZ).fill(-1)
  const run = new Uint8Array(NX * NY * NZ)
  /** Cells that stand on the ground in an unbroken column (the keep, and what a prop has carried down). */
  const core = new Uint8Array(NX * NY * NZ)
  /** How thick the supported tissue is where a cantilever begins: the run a shelf may reach is set by this, not by its own thinning tip. */
  const anchor = new Uint8Array(NX * NY * NZ).fill(6)
  const ground = new Int16Array(NX * NZ)
  for (let k = 0; k < NZ; k += 1) {
    for (let i = 0; i < NX; i += 1) {
      const h = landscapeHeight(x0 + (i + 0.5) * VOXEL, z0 + (k + 0.5) * VOXEL)
      ground[k * NX + i] = Math.max(2, Math.min(NY - 12, Math.floor((h - y0) / VOXEL)))
    }
  }
  const gAt = (i: number, k: number) => ground[k * NX + i]!
  const ci = NX >> 1
  const ck = NZ >> 1
  const gc = gAt(ci, ck)
  // Strata: a layer three cells thick every seven, the first above the plinth.
  const J0 = gc + 6
  const PERIOD = 8
  const KEEP_R = 10
  /** Which stratum a cell at height j and distance d (cells) from the axis lies in, or -1. A shelf is thickest at the keep (it
   *  reaches two cells lower there, a bracket) and thinner toward its tip, whose underside rises: the clearance under it grows. */
  const stratumAt = (j: number, d: number) => {
    for (let k = 0; k < 6; k += 1) {
      const offs = j - (J0 + k * PERIOD)
      const bottom = d <= KEEP_R + 3 ? -2 : Math.round(Math.max(0, Math.min(2, (d - (KEEP_R + 4)) / 6)))
      if (offs >= bottom && offs < 4) return k
    }
    return -1
  }
  const stratumBase = (k: number) => J0 + k * PERIOD
  // How high the body may rise: higher where the light is good and the ground is fed.
  const cap = gc + Math.round((27 + 13 * L + 7 * (rich - 0.4)) / VOXEL)
  const reachCells = 8 + 10 * wet

  const bbox = [ci, ci, ck, ck]
  const add = (i: number, j: number, k: number, t: number) => {
    if (solid[at(i, j, k)]) return
    solid[at(i, j, k)] = 1
    birth[at(i, j, k)] = t
    if (i < bbox[0]!) bbox[0] = i
    if (i > bbox[1]!) bbox[1] = i
    if (k < bbox[2]!) bbox[2] = k
    if (k > bbox[3]!) bbox[3] = k
  }
  // The plinth: set into the ground.
  const R0 = 5.2 + 1.5 * rich
  for (let k = 0; k < NZ; k += 1) {
    for (let i = 0; i < NX; i += 1) {
      const d = Math.hypot((i - ci) / 1.15, k - ck)
      if (d > R0) continue
      const g = gAt(i, k)
      for (let j = g - 2; j <= g + 1; j += 1) add(i, j, k, 0)
    }
  }

  const area = new Int32Array(NY)
  const above = new Int32Array(NY + 1)
  const bucket: number[][] = Array.from({ length: 64 }, () => [])
  const budgetAt = (t: number) => Math.round(40 + 120 * Math.pow(Math.sin(Math.PI * Math.min(1, (t + 4) / (TICKS + 4))), 1.2))
  // The body's rise is paced by what the ground can feed: it reaches its height over the first part of its life.
  const allowedTop = (t: number) => gc + 2 + Math.round((cap - gc - 2) * smoothstep(0, 0.6, t / TICKS))
  const sunAngle = Math.atan2(sun[1], sun[0])
  const waterAngle = Math.atan2(toWater[1], toWater[0])
  const preferred = [waterAngle, sunAngle - 0.3, sunAngle + 0.85, sunAngle - 0.95, sunAngle + 0.3, sunAngle + 1.4]
  type Front = { i: number; k: number; j: number; r: number; done: boolean }
  const fronts: Front[] = []
  let top = gc + 1
  let voxels = 0
  let lastKeepTop = top

  for (let t = 1; t < TICKS; t += 1) {
    // How far each solid cell is from a supported one (0: stands on the ground or on solid), through horizontal neighbours
    // (+1 each) and down through hanging cells (+0).
    run.fill(255)
    for (const b of bucket) b.length = 0
    area.fill(0)
    voxels = 0
    for (let k = 1; k < NZ - 1; k += 1) {
      for (let j = 0; j < NY - 1; j += 1) {
        for (let i = 1; i < NX - 1; i += 1) {
          if (!solid[at(i, j, k)]) continue
          voxels += 1
          area[j]! += 1
          if (j <= gAt(i, k) + 1 || (j > 0 && solid[at(i, j - 1, k)])) {
            run[at(i, j, k)] = 0
            bucket[0]!.push(at(i, j, k))
          }
        }
      }
    }
    for (let level = 0; level < bucket.length; level += 1) {
      const list = bucket[level]!
      for (let n = 0; n < list.length; n += 1) {
        const id = list[n]!
        if (run[id]! !== level) continue
        const i = id % NX
        const j = Math.floor(id / NX) % NY
        const k = Math.floor(id / (NX * NY))
        for (const [di, dk] of H4) {
          const ni = i + di
          const nk = k + dk
          if (ni < 0 || nk < 0 || ni >= NX || nk >= NZ) continue
          const nid = at(ni, j, nk)
          if (solid[nid] && run[nid]! > level + 1 && level + 1 < bucket.length) {
            run[nid] = level + 1
            bucket[level + 1]!.push(nid)
          }
        }
        if (j > 0 && solid[id - NX] && run[id - NX]! > level) {
          run[id - NX] = level
          list.push(id - NX)
        }
      }
    }
    core.fill(0)
    for (let k = 1; k < NZ - 1; k += 1) {
      for (let i = 1; i < NX - 1; i += 1) {
        for (let j = Math.max(1, gAt(i, k) - 2); j < NY - 1; j += 1) {
          if (!solid[at(i, j, k)]) break
          core[at(i, j, k)] = 1
        }
      }
    }
    above[NY] = 0
    for (let j = NY - 1; j >= 0; j -= 1) above[j] = above[j + 1]! + area[j]!
    // What each layer needs to stand under what is above it: the footprint grows with the mass it carries.
    const deficit = (j: number) => {
      if (j <= gc + 1) return 0
      const need = 20 + 0.9 * Math.pow(above[j + 1]!, 0.55)
      return Math.max(0, Math.min(1, (need - area[j]!) / need))
    }
    const keepTop = (() => {
      let h = gc + 1
      for (let j = gc + 1; j < NY - 1; j += 1) if (area[j]! >= 30) h = j
      return h
    })()
    lastKeepTop = keepTop
    const open = (k: number) => keepTop >= stratumBase(k) + 4

    // Candidates: every empty cell that touches the body.
    type Cand = { id: number; score: number; anch: number }
    const cands: Cand[] = []
    const budget = budgetAt(t)
    const bi0 = Math.max(2, bbox[0] - 2)
    const bi1 = Math.min(NX - 3, bbox[1] + 2)
    const bk0 = Math.max(2, bbox[2] - 2)
    const bk1 = Math.min(NZ - 3, bbox[3] + 2)
    for (let k = bk0; k <= bk1; k += 1) {
      for (let j = 2; j < Math.min(NY - 4, top + 3); j += 1) {
        for (let i = bi0; i <= bi1; i += 1) {
          const id = at(i, j, k)
          if (solid[id]) continue
          const below = solid[id - NX] === 1
          const aboveSolid = solid[id + NX] === 1
          let side = 0
          let nBest = -1
          for (const [di, dk] of H4) {
            const nid = at(i + di, j, k + dk)
            if (solid[nid]) {
              side += 1
              if (nBest < 0 || run[nid]! < run[nBest]!) nBest = nid
            }
          }
          if (!below && !aboveSolid && side === 0) continue
          const g = gAt(i, k)
          const grounded = j <= g + 1
          if (j < g - 1) continue
          const dx = (i - ci) * VOXEL
          const dz = (k - ck) * VOXEL
          const dist = Math.hypot(dx, dz)
          const dl = dist || 1
          const waterward = (dx / dl) * toWater[0] + (dz / dl) * toWater[1]
          // Light: how much of the body stands between this cell and the sun, and the open sky above it.
          let shade = 0
          for (let s = 1; s <= 9; s += 1) {
            const si = Math.round(i + sun[0] * s)
            const sj = Math.round(j + sunRise * s * 1.1)
            const sk = Math.round(k + sun[1] * s)
            if (si < 0 || sk < 0 || si >= NX || sk >= NZ || sj >= NY) break
            if (solid[at(si, sj, sk)]) shade += 1
          }
          let sky = 1
          for (let s = 1; s <= 6 && j + s < NY; s += 1) if (solid[id + s * NX]) sky -= 1 / 6
          const light = Math.exp(-0.32 * shade) * (0.4 + 0.6 * sky)
          const noise = 0.18 * hash(i, j, k, t)
          let score = -Infinity
          if (grounded && (below || side > 0 || j <= g + 1)) {
            // Spreading over the ground (roots and a broad base), toward the water, within the base's reach.
            if (side > 0 && j <= g + 1) {
              const reach = reachCells * (0.7 + 0.5 * Math.max(0, waterward))
              if (dist / VOXEL <= reach) score = 0.42 + 0.9 * Math.max(0, waterward) * wet - 0.05 * (dist / VOXEL) + 0.3 * (side / 4) + 0.25 * deficit(j) - 0.4 * crowdAt(dx, dz)
            }
          }
          if (below && core[id - NX] && j > g + 1 && dist / VOXEL <= (10 + 3 * deficit(j - 1)) * (1 - 0.45 * Math.max(0, (j - gc) / (cap - gc)))) {
            // Rising, or filling a layer: only on a broad footing, and only when the layer under it can carry the load.
            let broad = 0
            for (let di = -1; di <= 1; di += 1) for (let dk = -1; dk <= 1; dk += 1) if (solid[at(i + di, j - 1, k + dk)]) broad += 1
            const rising = !solid[id - NX * 0] && side === 0
            if (broad >= 5 || side >= 2) {
              if (j > cap || j > allowedTop(t)) continue
              const heightPenalty = 1.2 * smoothstep(cap - 6, cap, j)
              const load = deficit(j - 1)
              let s = 0.35 + 1.0 * light - heightPenalty + 0.5 * (side / 4) + 0.9 * deficit(j) - (rising ? 1.1 * load : 0)
              if (side === 0) s -= 0.15
              score = Math.max(score, s)
            }
          }
          const stratum = !below && !grounded && side > 0 ? stratumAt(j, dist / VOXEL) : -1
          if (stratum >= 0 && open(stratum)) {
            // A shelf: out from a cell that is supported or nearly so, within the run its thickness allows, in the sector this
            // stratum reaches (the first toward the water, the others toward the light, each turned a little from the last).
            const r = run[nBest]! + 1
            const maxRun = 2 + 1.5 * anchor[nBest]!
            const ang = preferred[stratum % preferred.length]!
            const sector = Math.max(0, (dx / dl) * Math.cos(ang) + (dz / dl) * Math.sin(ang))
            // How far a stratum may reach: the light it can use and the ground that feeds it; the higher, the shorter.
            const reachMax = (17 + 10 * L) * (stratum === 0 ? 1.1 : 1) * (1 - 0.1 * stratum)
            if (r <= maxRun && sector > 0.4 && dist > 3 * VOXEL && dist / VOXEL <= reachMax) {
              const crowd = crowdAt(dx, dz)
              const s = 0.3 + 1.1 * sector * sector + 0.7 * light - 1.0 * crowd - 0.05 * r + 0.12 * (side / 4) + (side >= 2 ? 0.35 : 0)
              score = Math.max(score, s)
            }
          }
          if (score > -Infinity) cands.push({ id, score: score + noise, anch: !below && !grounded && nBest >= 0 ? anchor[nBest]! : 6 })
        }
      }
    }
    cands.sort((a, b) => b.score - a.score)
    const take = Math.min(budget, cands.length)
    for (let n = 0; n < take; n += 1) {
      const c = cands[n]!
      if (c.score < 0.15) break
      const i = c.id % NX
      const j = Math.floor(c.id / NX) % NY
      const k = Math.floor(c.id / (NX * NY))
      add(i, j, k, t)
      anchor[c.id] = c.anch
      top = Math.max(top, j)
    }
    // Props. Where a shelf overhangs far (a run of five cells or more) a front is set there, no nearer than six cells to another,
    // and grows straight down, two layers a tick, to the ground or the solid below; the farther the overhang, the stouter.
    if (fronts.filter((f) => !f.done).length < 3 && fronts.length < 8) {
      let pick = -1
      let farthest = 4
      for (let id = 0; id < solid.length; id += 1) {
        if (!solid[id] || run[id]! < 5 || run[id]! === 255 || solid[id - NX]) continue
        const i = id % NX
        const k = Math.floor(id / (NX * NY))
        if (fronts.some((f) => Math.hypot(f.i - i, f.k - k) < 6)) continue
        if (run[id]! > farthest) {
          farthest = run[id]!
          pick = id
        }
      }
      if (pick >= 0) fronts.push({ i: pick % NX, k: Math.floor(pick / (NX * NY)), j: Math.floor(pick / NX) % NY, r: farthest >= 8 ? 2 : 1, done: false })
    }
    for (const f of fronts) {
      for (let step = 0; step < 2 && !f.done; step += 1) {
        const nj = f.j - 1
        let landed = false
        for (let di = -f.r; di <= f.r; di += 1) {
          for (let dk = -f.r; dk <= f.r; dk += 1) {
            if (Math.abs(di) + Math.abs(dk) > f.r + 1) continue
            const ii = f.i + di
            const kk = f.k + dk
            if (ii < 1 || kk < 1 || ii >= NX - 1 || kk >= NZ - 1) continue
            if (nj < gAt(ii, kk) - 1) continue
            add(ii, nj, kk, t)
            if (nj - 1 <= gAt(ii, kk) + 1 || solid[at(ii, nj - 1, kk)]) landed = true
          }
        }
        f.j = nj
        if (landed) {
          // The foot flares into the ground.
          for (let di = -f.r - 1; di <= f.r + 1; di += 1) {
            for (let dk = -f.r - 1; dk <= f.r + 1; dk += 1) {
              if (Math.abs(di) + Math.abs(dk) > f.r + 2) continue
              const ii = f.i + di
              const kk = f.k + dk
              if (ii < 1 || kk < 1 || ii >= NX - 1 || kk >= NZ - 1) continue
              add(ii, Math.max(gAt(ii, kk) - 1, nj), kk, t)
            }
          }
          f.done = true
        }
      }
    }
  }
  // Counts for the report.
  let total = 0
  let maxRun = 0
  for (let id = 0; id < solid.length; id += 1) {
    if (!solid[id]) continue
    total += 1
    if (run[id]! < 255) maxRun = Math.max(maxRun, run[id]!)
  }
  return {
    solid,
    birth,
    ground,
    origin: [x0, y0, z0],
    site: [sx, sz],
    stats: {
      voxels: total,
      keepTop: lastKeepTop,
      top,
      cap,
      maxOverhangRun: maxRun,
      props: fronts.length,
      growMs: Math.round(performance.now() - started),
      distanceToWater: Math.round(waterDistance(world, sx, sz)),
    },
  }
}

// ---------------------------------------------------------------------------------------------------------- the surface
/** The surface of the organism at a tick: the occupancy born by then, smoothed once, extracted by surface nets. */
export function voxelMesh(org: VoxelOrganism, tick: number, moisture: number): BufferGeometry {
  const dx = NX + 2
  const dy = NY + 2
  const dz = NZ + 2
  const f = new Float32Array(dx * dy * dz)
  const fidx = (x: number, y: number, z: number) => (z * dy + y) * dx + x
  for (let k = 0; k < NZ; k += 1) {
    for (let j = 0; j < NY; j += 1) {
      for (let i = 0; i < NX; i += 1) {
        const id = at(i, j, k)
        if (org.solid[id] && org.birth[id]! <= tick) f[fidx(i + 1, j + 1, k + 1)] = 1
      }
    }
  }
  // A [1 2 1] blur on each axis: rounded, and the stairs of the grid softened; layers pick out the strata a little.
  const g = new Float32Array(f.length)
  const h = new Float32Array(f.length)
  for (let z = 0; z < dz; z += 1) for (let y = 0; y < dy; y += 1) for (let x = 1; x < dx - 1; x += 1) g[fidx(x, y, z)] = 0.25 * f[fidx(x - 1, y, z)]! + 0.5 * f[fidx(x, y, z)]! + 0.25 * f[fidx(x + 1, y, z)]!
  for (let z = 0; z < dz; z += 1) for (let y = 1; y < dy - 1; y += 1) for (let x = 0; x < dx; x += 1) h[fidx(x, y, z)] = 0.25 * g[fidx(x, y - 1, z)]! + 0.5 * g[fidx(x, y, z)]! + 0.25 * g[fidx(x, y + 1, z)]!
  for (let z = 1; z < dz - 1; z += 1) for (let y = 0; y < dy; y += 1) for (let x = 0; x < dx; x += 1) g[fidx(x, y, z)] = 0.25 * h[fidx(x, y, z - 1)]! + 0.5 * h[fidx(x, y, z)]! + 0.25 * h[fidx(x, y, z + 1)]!
  const strata = new Float32Array(g.length)
  for (let z = 1; z < dz - 1; z += 1) {
    for (let y = 1; y < dy - 1; y += 1) {
      const w = 0.06 * Math.cos(((y - 1 - 1) / 7) * Math.PI * 2)
      for (let x = 1; x < dx - 1; x += 1) {
        const p = fidx(x, y, z)
        strata[p] = g[p]! - 0.4 + (g[p]! > 0.05 && g[p]! < 0.95 ? w : 0)
      }
    }
  }
  const net = surfaceNets(strata, dx, dy, dz, [0, 0, 0])
  const count = net.positions.length / 3
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const colours = new Float32Array(count * 3)
  const recordA = new Float32Array(count * 4)
  const recordB = new Float32Array(count * 4)
  const arrival = new Float32Array(count)
  const decay = new Float32Array(count).fill(9)
  for (let v = 0; v < count; v += 1) {
    const gx = net.positions[v * 3]! - 1
    const gy = net.positions[v * 3 + 1]! - 1
    const gz = net.positions[v * 3 + 2]! - 1
    positions[v * 3] = org.origin[0] + gx * VOXEL
    positions[v * 3 + 1] = org.origin[1] + gy * VOXEL
    positions[v * 3 + 2] = org.origin[2] + gz * VOXEL
    normals[v * 3] = net.normals[v * 3]!
    normals[v * 3 + 1] = net.normals[v * 3 + 1]!
    normals[v * 3 + 2] = net.normals[v * 3 + 2]!
    // The tick the nearest cell was born, for the colour of young and old tissue.
    let born = 0
    let best = 9
    const ci = Math.round(gx)
    const cj = Math.round(gy)
    const ck = Math.round(gz)
    for (let a = -1; a <= 1; a += 1) {
      for (let b = -1; b <= 1; b += 1) {
        for (let c = -1; c <= 1; c += 1) {
          const i = ci + a
          const j = cj + b
          const k = ck + c
          if (i < 0 || j < 0 || k < 0 || i >= NX || j >= NY || k >= NZ) continue
          const id = at(i, j, k)
          const d = a * a + b * b + c * c
          if (org.solid[id] && org.birth[id]! <= tick && d < best) {
            best = d
            born = org.birth[id]!
          }
        }
      }
    }
    const ground = org.ground[Math.max(0, Math.min(NZ - 1, ck)) * NX + Math.max(0, Math.min(NX - 1, ci))]!
    const above = Math.max(0, (gy - ground) * VOXEL)
    const ny = normals[v * 3 + 1]!
    const colour = skin(above, 0.3 + 0.3 * (1 - Math.abs(ny)), 1, moisture)
    colours.set([colour.r, colour.g, colour.b], v * 3)
    const age = born / TICKS
    recordA.set([clamp01(age), 0.8, above < 3 ? 0.25 : 0.05, 0], v * 4)
    recordB.set([clamp01(0.3 + 0.55 * Math.max(0, ny)), clamp01(moisture * (1 - smoothstep(0, 7, above))), ((ci * 73856093) ^ (ck * 19349663)) % 1000 / 1000, 0.5], v * 4)
    arrival[v] = age
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
  geometry.boundingSphere = new Sphere(new Vector3(org.site[0], org.origin[1] + 30, org.site[1]), 120)
  return geometry
}
