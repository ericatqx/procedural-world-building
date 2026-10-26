import { BufferAttribute, BufferGeometry } from 'three'
import { sunAt } from '../project/sun.ts'
import { clamp01, smoothstep } from '../project02/core.ts'
import { prevailingWind } from './environment.ts'
import { islandRadius, landscapeHeight } from './terrain.ts'
import { BONE, GRAY, add, chooseSite, cross, dot, lerp, livingArchitecture, mul, norm, rng, skin, sub, waterDistance, type Colony, type V } from './livingArchitecture.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — Living Architecture, Grown2: sheets that pay their way.
 *
 * The body is a set of 2 m cells. A cell is a piece of sheet (a thin plate with a facing) or a piece of pillar. Each
 * organism starts as a few rooted cells on the ground and grows by one rule: the sheet's growing edge adds cells in the
 * plane of the sheet, wherever that will pay.
 *
 *   income     a sheet cell earns from the light that reaches its face (sun arc, shaded by terrain and every other
 *              cell), times the water at the root it is fed from, less what the path back to that root loses (each
 *              hop costs a little, so far growth is poor and short paths are good).
 *   upkeep     every cell costs to keep; a rolled edge and a thick seam cost more.
 *   funding    each organism has one reserve. Candidate cells are scored by expected return per cost, and only the best
 *              the reserve can afford are built. Growth stops where it stops paying, not at a cap.
 *   curl       a new cell's facing turns toward the light as the sheet climbs, and sags outward with its distance from
 *              a support, so a rising blade bends over into a canopy and its edge droops.
 *   supports   where a sheet reaches far from any root and carries a lot, a pillar descends from it, and roots.
 *   pruning    a cell that loses money for several settlements is shed, unless it carries other cells' income. Shaded
 *              lower sheets, thin necks and unpaid margins go; what is left has gaps where the economy said no.
 *   fusion     cells of different organisms that touch are connected; they share paths to the ground.
 *
 * The mesh is a smooth surface drawn around the living cells, thick where an edge has stalled and reinforced itself
 * (a rolled lip) and where a lot of income runs (a seam, drawn as a ridge on the underside).
 *
 * Every cell keeps its birth pulse, parent, connections, light, income, upkeep, balance, vitality, flow and stress, and
 * shed cells are logged with the pulse they went. Nothing decays here; the record is for the lifecycle to use.
 */

const C = 2
const SHEET = 0
const PILLAR = 1
const PULSES = 150
const INCOME = 1.15
const UPKEEP = 0.4
const LOSS = 0.012
const BUILD = 6
const PILLAR_BUILD = 9

export type Cell = {
  id: number
  org: number
  kind: 0 | 1
  i: number
  j: number
  k: number
  pos: V
  /** The sheet's facing: the side that takes the light. */
  n: V
  dir: V
  parent: number
  birth: number
  shedAt: number
  alive: boolean
  anchor: boolean
  hops: number
  /** Steps taken since the sheet levelled off: a canopy's distance from where it stood up. */
  flat: number
  root: number
  light: number
  income: number
  upkeep: number
  balance: number
  deficit: number
  vitality: number
  flow: number
  stress: number
  lip: number
  stalled: number
  /** Experiment 1: bending demand over capacity (above 1 the span is overloaded). */
  rho: number
  /** Material laid down over the cell's life: what it earned beyond its keep, summed. Old productive cells are thick. */
  deposit: number
  /** For a pillar cell: steps down from the sheet it hangs from. */
  depth: number
  /** Pulses in a row this cell had nowhere profitable to grow: it is checked less often. */
  quiet: number
  margin: boolean
}

export type Graph2 = { cells: Cell[]; pulses: number; shed: [number, number][]; fusions: [number, number][] }
export type GrownColony2 = Colony & { graph: Graph2 }

const OFFSETS: { e: [number, number, number]; u: V }[] = []
for (let x = -1; x <= 1; x += 1) for (let y = -1; y <= 1; y += 1) for (let z = -1; z <= 1; z += 1) {
  const l2 = x * x + y * y + z * z
  if (l2 === 0 || l2 > 2) continue
  OFFSETS.push({ e: [x, y, z], u: norm([x, y, z]) })
}

const rotateToward = (a: V, b: V, max: number): V => {
  const d = Math.min(1, Math.max(-1, dot(a, b)))
  const angle = Math.acos(d)
  if (angle <= max) return b
  const t = max / angle
  return norm([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)])
}

/**
 * Options for A/B runs on the same seed. `structural` is Experiment 1: every anchor has a finite water supply shared
 * across the network it feeds, and a sheet pays for the span it holds up (its moment about the nearest support, over a
 * capacity that grows with the thickness it has laid down and the curvature it has taken). Supports are then sent where
 * a sheet is overloaded or its roots run dry, not where a fixed run-length says. Everything else is the baseline.
 */
export type Grown2Options = { structural?: boolean; water?: boolean; span?: boolean }

const SUPPLY = 36
const CAPACITY = 25
const SPAN_COST = 0.12

export function growColony2(world: World, seed: number, options: Grown2Options = {}): GrownColony2 {
  const started = performance.now()
  // `water` and `span` can be switched on one at a time to attribute what each does; `structural` turns on both.
  const XW = options.water ?? options.structural === true
  const XS = options.span ?? options.structural === true
  const X = XW || XS
  const [sx, sz] = chooseSite(world, seed)
  const cy = landscapeHeight(sx, sz)

  // ------------------------------------------------------------------------------------------------ terrain and grid
  const HALF = 150
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

  const NX = (HALF * 2) / C
  const NZ = NX
  const ox = sx - HALF
  const oz = sz - HALF
  const oy = Math.floor(minH) - 4
  const NY = Math.ceil((cy + 110 - oy) / C)
  const grid = new Int32Array(NX * NY * NZ).fill(-1)
  const at = (i: number, j: number, k: number) => (i < 0 || j < 0 || k < 0 || i >= NX || j >= NY || k >= NZ ? -1 : (j * NZ + k) * NX + i)
  const centre = (i: number, j: number, k: number): V => [ox + (i + 0.5) * C, oy + (j + 0.5) * C, oz + (k + 0.5) * C]
  const cellAt = (p: V): [number, number, number] => [Math.floor((p[0] - ox) / C), Math.floor((p[1] - oy) / C), Math.floor((p[2] - oz) / C)]

  const sun = [8, 10.5, 13, 15.5].flatMap((h) => {
    const d = sunAt(h, 55).direction
    return d[1] > 0.12 ? [{ d: d as V, w: 0.4 + d[1] }] : []
  })
  let lx = 0
  let lz = 0
  for (const s of sun) {
    lx += s.d[0]
    lz += s.d[2]
  }
  const lean = norm([lx, 0, lz])
  const heading = (prevailingWind(seed) * Math.PI) / 180
  const wind: V = [Math.cos(heading), 0, Math.sin(heading)]

  /** Light on a sheet's face at a point: sun arc past terrain and every other cell, with a little open sky. */
  const lightAt = (p: V, n: V, self: number): number => {
    let sum = 0
    let weights = 0
    for (const s of sun) {
      const facing = n[0] * s.d[0] + n[1] * s.d[1] + n[2] * s.d[2]
      const face = facing > 0 ? facing : -0.3 * facing
      weights += s.w
      if (face < 0.02) continue
      let t = 1
      for (let k = 1; k <= 12; k += 1) {
        const x = p[0] + s.d[0] * k * C
        const y = p[1] + s.d[1] * k * C
        const z = p[2] + s.d[2] * k * C
        if (hAt(x, z) > y) {
          t = 0
          break
        }
        const idx = at(Math.floor((x - ox) / C), Math.floor((y - oy) / C), Math.floor((z - oz) / C))
        if (idx >= 0 && idx !== self && grid[idx]! >= 0) t *= 0.28
        if (t < 0.04) break
      }
      sum += t * face * s.w
    }
    let sky = 1
    const ci = Math.floor((p[0] - ox) / C)
    const cj = Math.floor((p[1] - oy) / C)
    const ck = Math.floor((p[2] - oz) / C)
    for (let k = 1; k <= 5; k += 1) {
      const idx = at(ci, cj + k, ck)
      if (idx >= 0 && idx !== self && grid[idx]! >= 0) sky *= 0.3
    }
    return clamp01(1.25 * 0.8 * (sum / weights) + 0.2 * sky * Math.max(0, n[1]))
  }

  // ------------------------------------------------------------------------------------------------ organisms
  type Organism = { id: number; rand: () => number; base: V; reserve: number; spent: number; tone: number; upkeep: number; build: number; anchors: number[]; peak: number }
  const nuclei = (() => {
    const found: { x: number; z: number; score: number }[] = []
    for (let dx = -110; dx <= 110; dx += 12) {
      for (let dz = -110; dz <= 110; dz += 12) {
        const x = sx + dx
        const z = sz + dz
        const away = Math.hypot(dx, dz)
        if (away > 118 || Math.hypot(x, z) > islandRadius(Math.atan2(z, x)) * 0.85 || world.water.depthAt(x, z) > 0) continue
        const slope = slopeAt(x, z)
        if (slope > 0.3) continue
        // Open sky toward the sun side, dry ground, shore nearby.
        let open = 0
        for (const s of sun) {
          let t = 1
          for (let k = 1; k <= 12; k += 1) if (hAt(x + s.d[0] * k * 6, z + s.d[2] * k * 6) > hAt(x, z) + 8 + s.d[1] * k * 6) t = 0
          open += t
        }
        found.push({ x, z, score: 1.3 * (open / sun.length) + 0.5 * moistureAt(x, z) - 2.2 * slope - away / 240 })
      }
    }
    found.sort((a, b) => b.score - a.score)
    const chosen: typeof found = []
    for (const f of found) if (chosen.length < 3 && chosen.every((c) => Math.hypot(c.x - f.x, c.z - f.z) >= 62)) chosen.push(f)
    return chosen
  })()
  const organisms: Organism[] = nuclei.map((f, id) => {
    const r = rng(seed ^ (0x7f4a * (id + 5)))
    return { id, rand: r, base: [f.x, hAt(f.x, f.z), f.z], reserve: 480, spent: 0, tone: 0.95 + 0.09 * r(), upkeep: 0.93 + 0.14 * r(), build: 0.93 + 0.14 * r(), anchors: [], peak: 0 }
  })

  const cells: Cell[] = []
  const shedLog: [number, number][] = []
  const fusions: [number, number][] = []
  const addCell = (org: Organism, kind: 0 | 1, i: number, j: number, k: number, n: V, dir: V, parent: number, pulse: number): number => {
    const id = cells.length
    cells.push({ id, org: org.id, kind, i, j, k, pos: centre(i, j, k), n, dir, parent, birth: pulse, shedAt: -1, alive: true, anchor: false, hops: 0, flat: 0, root: -1, light: 0, income: 0, upkeep: UPKEEP, balance: 0.2, deficit: 0, vitality: 0.6, flow: 0, stress: 0, lip: 0, stalled: 0, rho: 0, deposit: 0, depth: kind === PILLAR && parent >= 0 && cells[parent]!.kind === PILLAR ? cells[parent]!.depth + 1 : 0, quiet: 0, margin: true })
    grid[at(i, j, k)] = id
    return id
  }
  const above = (p: V) => p[1] - hAt(p[0], p[2])
  // Whether a column of cells stands on dry ground inside the site, looked up once.
  const dry = new Int8Array(NX * NZ)
  const dryColumn = (i: number, k: number): boolean => {
    const key = k * NX + i
    if (dry[key] === 0) {
      const x = ox + (i + 0.5) * C
      const z = oz + (k + 0.5) * C
      dry[key] = world.water.depthAt(x, z) <= 0 && Math.hypot(x - sx, z - sz) < HALF - 6 ? 1 : 2
    }
    return dry[key] === 1
  }
  const valid = (i: number, j: number, k: number): boolean => {
    const idx = at(i, j, k)
    if (idx < 0 || grid[idx]! >= 0 || !dryColumn(i, k)) return false
    return oy + (j + 0.5) * C - hAt(ox + (i + 0.5) * C, oz + (k + 0.5) * C) >= 0.45 * C
  }
  const rooted = (c: Cell) => above(c.pos) < 1.15 * C
  /** Sheet near the ground earns little: splash, fouling and grazers. It pays to be lifted clear. (Heuristic.) */
  const lifted = (p: V) => 0.3 + 0.7 * smoothstep(2.5, 10, above(p))

  // Each nucleus: a few rooted cells in a row on the ground and a facing that leans the blade toward the sun.
  for (const org of organisms) {
    const blades = 1 + Math.floor(org.rand() * 3)
    let used: number[] = []
    for (let b = 0; b < blades; b += 1) {
      let best = -1
      let bestScore = -Infinity
      for (let a = 0; a < 12; a += 1) {
        const az = (a / 12) * Math.PI * 2
        if (used.some((u) => Math.abs(Math.atan2(Math.sin(az - u), Math.cos(az - u))) < 1.7)) continue
        // The blade leans toward `toward` and shows its lit face to the sun, so it leans away from the sun: pick the bearing with light and room.
        const toward: V = [Math.cos(az), 0, Math.sin(az)]
        const p: V = [org.base[0] + toward[0] * 14, org.base[1] + 10, org.base[2] + toward[2] * 14]
        const open = lightAt(p, [0, 1, 0], -1)
        const score = open - 0.5 * dot(toward, lean) + 0.15 * org.rand() - (hAt(p[0], p[2]) > p[1] - 6 ? 1 : 0)
        if (score > bestScore) {
          bestScore = score
          best = az
        }
      }
      if (best < 0) break
      used = used.concat(best)
      const toward: V = [Math.cos(best), 0, Math.sin(best)]
      const n = norm([-toward[0] * 0.8, 0.6, -toward[2] * 0.8])
      const along: V = [-toward[2], 0, toward[0]]
      for (let s = -1; s <= 1; s += 1) {
        const x = org.base[0] + along[0] * s * C + toward[0] * b * 0
        const z = org.base[2] + along[2] * s * C
        const [ci, , ck] = cellAt([x, 0, z])
        const g = hAt(x, z)
        const j = Math.ceil((g + 0.5 * C - oy) / C - 0.5)
        if (!valid(ci, j, ck)) continue
        const id = addCell(org, SHEET, ci, j, ck, n, [toward[0], 0.4, toward[2]], -1, 0)
        cells[id]!.anchor = true
        org.anchors.push(id)
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ settlement
  const D0 = 14
  /** How much material the cell has laid down, 0 to 1. */
  const dep01 = (c: Cell) => clamp01(c.deposit / D0)
  let maxFlow: number[] = organisms.map(() => 1)
  const supplyOf = new Map<number, number>()
  const demandOf = new Map<number, number>()
  /** Connectivity, paths to the ground, income, upkeep and balance for every living cell. */
  const settle = (pulse: number, prune: boolean) => {
    const live = cells.filter((c) => c.alive)
    for (const c of live) c.hops = -1
    const queue: Cell[] = []
    for (const c of live) {
      if (c.anchor || rooted(c)) {
        c.anchor = true
        c.hops = 0
        c.root = c.id
        c.flow = 0
        queue.push(c)
      }
    }
    const via = new Map<number, number>()
    for (let q = 0; q < queue.length; q += 1) {
      const c = queue[q]!
      for (const o of OFFSETS) {
        const idx = at(c.i + o.e[0], c.j + o.e[1], c.k + o.e[2])
        if (idx < 0) continue
        const w = grid[idx]!
        if (w < 0) continue
        const next = cells[w]!
        if (next.hops >= 0) continue
        next.hops = c.hops + 1
        next.root = c.root
        via.set(next.id, c.id)
        queue.push(next)
      }
    }
    // Cells cut off from every root die.
    for (const c of live) {
      if (c.hops < 0) shed(c, pulse)
    }
    maxFlow = organisms.map(() => 1)
    if (XW) {
      // Each anchor draws a finite supply from its ground; every sheet cell it feeds shares it.
      supplyOf.clear()
      demandOf.clear()
      for (const c of queue) if (c.alive && c.anchor) supplyOf.set(c.id, SUPPLY * (0.5 + 0.9 * moistureAt(c.pos[0], c.pos[2])))
      for (const c of queue) if (c.alive && c.kind === SHEET) demandOf.set(c.root, (demandOf.get(c.root) ?? 0) + 1)
    }
    for (const c of queue) {
      if (!c.alive) continue
      const rootCell = cells[c.root]!
      const water = XW ? 1.15 * Math.min(1, (supplyOf.get(c.root) ?? 0) / Math.max(1, demandOf.get(c.root) ?? 1)) : 0.5 + 0.9 * moistureAt(rootCell.pos[0], rootCell.pos[2])
      c.light = c.kind === SHEET ? lightAt(c.pos, c.n, at(c.i, c.j, c.k)) : 0
      c.income = c.kind === SHEET ? INCOME * c.light * water * Math.pow(1 - LOSS, c.hops) * lifted(c.pos) : 0
      c.flow = c.income
    }
    for (let q = queue.length - 1; q >= 0; q -= 1) {
      const c = queue[q]!
      const p = via.get(c.id)
      if (p !== undefined && cells[p]!.alive && c.alive) cells[p]!.flow += c.flow
    }
    if (XS) {
      // The load each cell carries and where it acts: the subtree's mass and centroid, summed toward the roots.
      const mass = new Float64Array(cells.length)
      const mx = new Float64Array(cells.length)
      const mz = new Float64Array(cells.length)
      for (const c of queue) {
        if (!c.alive) continue
        const m = c.kind === SHEET ? 1 : 0.3
        mass[c.id] = m
        mx[c.id] = m * c.pos[0]
        mz[c.id] = m * c.pos[2]
      }
      for (let q = queue.length - 1; q >= 0; q -= 1) {
        const c = queue[q]!
        const p = via.get(c.id)
        if (p !== undefined && cells[p]!.alive && c.alive) {
          mass[p] = mass[p]! + mass[c.id]!
          mx[p] = mx[p]! + mx[c.id]!
          mz[p] = mz[p]! + mz[c.id]!
        }
      }
      for (const c of queue) {
        if (!c.alive) continue
        if (c.kind !== SHEET || c.anchor) {
          c.rho = 0
          continue
        }
        const m = mass[c.id]!
        const lever = Math.hypot(mx[c.id]! / m - c.pos[0], mz[c.id]! / m - c.pos[2])
        // The moment is carried across the sheet's width, taken as the root of the mass it holds up.
        const demand = Math.sqrt(m) * lever
        let bend = 0
        let near = 0
        for (const o of OFFSETS) {
          const idx = at(c.i + o.e[0], c.j + o.e[1], c.k + o.e[2])
          if (idx < 0 || grid[idx]! < 0) continue
          const q = cells[grid[idx]!]!
          if (q.kind !== SHEET) continue
          bend += Math.hypot(q.n[0] - c.n[0], q.n[1] - c.n[1], q.n[2] - c.n[2])
          near += 1
        }
        const curvature = near ? bend / near : 0
        const thickness = 0.5 + 1.4 * dep01(c)
        c.rho = demand / (CAPACITY * thickness * thickness * (1 + 5 * curvature))
      }
    }
    for (const c of queue) {
      if (!c.alive) continue
      const org = organisms[c.org]!
      maxFlow[c.org] = Math.max(maxFlow[c.org]!, c.flow)
      c.upkeep = (c.kind === SHEET ? UPKEEP * org.upkeep + 0.06 * c.lip + 0.03 * Math.sqrt(c.flow) : 0.18) + (XS ? Math.min(1, SPAN_COST * Math.max(0, c.rho - 1)) : 0)
      c.balance = c.income - c.upkeep
      c.vitality = clamp01(0.5 + c.balance / 0.7)
      // An overloaded span thickens as well as costing: it lays down more.
      if (c.kind === SHEET) c.deposit += Math.max(0, c.balance) * 3 + 0.2 + (XS ? 1.2 * Math.max(0, c.rho - 0.6) : 0)
      c.stress = XS ? clamp01(c.rho / 2.5) : clamp01((c.flow / 40) * (0.3 + c.hops / 40))
      if (prune && c.kind === SHEET && !c.anchor) {
        c.deficit = c.balance < 0 ? c.deficit + 1 : Math.max(0, c.deficit - 1)
        // A cell that carries other cells' income is not unproductive: it is the road.
        if (c.deficit >= 3 && pulse - c.birth >= 14 && c.flow < c.income + 3.2) shed(c, pulse)
      }
    }
    const counts = organisms.map(() => 0)
    for (const c of live) if (c.alive) counts[c.org]! += 1
    organisms.forEach((o, i) => (o.peak = Math.max(o.peak, counts[i]!)))
  }
  const shed = (c: Cell, pulse: number) => {
    if (!c.alive) return
    c.alive = false
    c.shedAt = pulse
    grid[at(c.i, c.j, c.k)] = -1
    shedLog.push([c.id, pulse])
  }

  // ------------------------------------------------------------------------------------------------ growth
  type Candidate = { org: number; parent: Cell; i: number; j: number; k: number; n: V; dir: V; score: number; cost: number; gain: number }
  type Tip = { cell: number; org: number }
  const tips: Tip[] = []
  settle(0, false)

  const droopTarget = (e: V, hops: number): V | null => {
    if (hops <= 3) return null
    const theta = Math.min(1.25, 0.1 * (hops - 3))
    const out = norm([e[0], 0, e[2]])
    return norm([out[0] * Math.sin(theta), Math.cos(theta), out[2] * Math.sin(theta)])
  }

  for (let pulse = 1; pulse <= PULSES; pulse += 1) {
    if (pulse % 3 === 0) settle(pulse, pulse > 36)

    // Reserve: each organism banks the balance of its cells.
    const livePerOrg = organisms.map(() => ({ n: 0, net: 0 }))
    for (const c of cells) if (c.alive) {
      livePerOrg[c.org]!.n += 1
      livePerOrg[c.org]!.net += c.balance
    }
    organisms.forEach((o, idx) => (o.reserve = Math.max(0, o.reserve + livePerOrg[idx]!.net * 0.9)))

    // Pillars: baseline sends one down from a sheet that has run level a long way; the experiment sends one where a span is
    // overloaded or the roots feeding it run short of water, as often as the reserve allows.
    if (pulse >= 14 && pulse % 3 === 1) {
      const supportsNow = cells.filter((q) => q.alive && (q.kind === PILLAR || q.anchor))
      for (const org of organisms) {
        let best: Cell | null = null
        let bestScore = 0
        for (const c of cells) {
          if (!c.alive || c.org !== org.id || c.kind !== SHEET) continue
          if (X ? above(c.pos) < 3 * C : c.flat < 12 || above(c.pos) < 5 * C) continue
          if (supportsNow.some((q) => Math.hypot(q.pos[0] - c.pos[0], q.pos[2] - c.pos[2]) < (X ? 5 : q.kind === PILLAR ? 8 : 5) * C && q.pos[1] < c.pos[1])) continue
          let score: number
          if (X) {
            const ratio = XW ? Math.min(1, (supplyOf.get(c.root) ?? 1) / Math.max(1, demandOf.get(c.root) ?? 1)) : 1
            score = Math.max(0, c.rho - 0.9) * 3 + Math.max(0, 0.85 - ratio) * 6
            score *= 0.5 + c.light
            if (score < 1.2) continue
          } else {
            score = c.flow * (0.5 + c.hops / 30) * (0.5 + c.light)
          }
          if (score > bestScore) {
            bestScore = score
            best = c
          }
        }
        const active = tips.filter((t) => t.org === org.id).length
        if (best && (X ? true : bestScore > 3) && active < (X ? 2 : 1)) {
          const j = best.j - 1
          if (valid(best.i, j, best.k) && org.reserve > PILLAR_BUILD) {
            const id = addCell(org, PILLAR, best.i, j, best.k, [0, 1, 0], [0, -1, 0], best.id, pulse)
            tips.push({ cell: id, org: org.id })
            org.reserve -= PILLAR_BUILD * org.build
          }
        }
      }
    }
    // Pillar tips descend one cell a pulse while they can afford it.
    for (let t = tips.length - 1; t >= 0; t -= 1) {
      const tip = tips[t]!
      const org = organisms[tip.org]!
      const cell = cells[tip.cell]!
      if (!cell.alive) {
        tips.splice(t, 1)
        continue
      }
      if (rooted(cell)) {
        cell.anchor = true
        tips.splice(t, 1)
        continue
      }
      const below = at(cell.i, cell.j - 1, cell.k)
      if (below < 0) {
        tips.splice(t, 1)
        continue
      }
      const other = grid[below]!
      if (other >= 0) {
        fusions.push([cell.id, other])
        tips.splice(t, 1)
        continue
      }
      if (!valid(cell.i, cell.j - 1, cell.k)) {
        if (above(cell.pos) - C < 0.45 * C && dryColumn(cell.i, cell.k)) cell.anchor = true
        else for (let q: Cell | undefined = cell; q && q.kind === PILLAR && !q.anchor; q = cells[q.parent]) shed(q, pulse)
        tips.splice(t, 1)
        continue
      }
      const id = addCell(org, PILLAR, cell.i, cell.j - 1, cell.k, [0, 1, 0], [0, -1, 0], cell.id, pulse)
      org.reserve -= PILLAR_BUILD * org.build
      tip.cell = id
    }

    // Sheet edges: every free place in the plane of a sheet is a candidate; the best the reserve can afford are built.
    const candidates = new Map<number, Candidate>()
    const lightCache = new Map<number, number>()
    const expanded = new Set<number>()
    for (const c of cells) {
      if (!c.alive || c.kind !== SHEET) continue
      if (c.quiet >= 3 && (pulse + c.id) % 6 !== 0) continue
      const org = organisms[c.org]!
      const water = XW ? 1.15 * Math.min(1, (supplyOf.get(c.root) ?? 1) / ((demandOf.get(c.root) ?? 1) + 1)) : 0.5 + 0.9 * moistureAt(cells[c.root < 0 ? c.id : c.root]!.pos[0], cells[c.root < 0 ? c.id : c.root]!.pos[2])
      let free = 0
      for (const o of OFFSETS) if (Math.abs(dot(o.u, c.n)) <= 0.5) {
        const fi = at(c.i + o.e[0], c.j + o.e[1], c.k + o.e[2])
        if (fi >= 0 && grid[fi]! < 0) free += 1
      }
      c.margin = free >= 4
      if (free === 0 || (!c.margin && (pulse + c.id) % 4 !== 0)) {
        c.quiet += 1
        continue
      }
      const establishingHere = c.hops < 12 && org.reserve > 40
      const effNext = Math.pow(1 - LOSS, c.hops + 1)
      for (const o of OFFSETS) {
        if (Math.abs(dot(o.u, c.n)) > 0.5) continue
        const i = c.i + o.e[0]
        const j = c.j + o.e[1]
        const k = c.k + o.e[2]
        if (!valid(i, j, k)) continue
        const key = at(i, j, k)
        // Cheap bound first: even in full light this place would not pay.
        const py = oy + (j + 0.5) * C
        const liftHere = 0.3 + 0.7 * smoothstep(2.5, 10, py - hAt(ox + (i + 0.5) * C, oz + (k + 0.5) * C))
        if (INCOME * water * effNext * liftHere - UPKEEP * org.upkeep < 0.1 && !(establishingHere && INCOME * water * effNext * liftHere - UPKEEP * org.upkeep > -0.6)) continue
        // Facing: turns toward the light as the edge climbs, sags with distance from a support.
        const climb = Math.abs(o.u[1])
        const light: V = norm([c.n[0] + lean[0] * 0.02, 1, c.n[2] + lean[2] * 0.02])
        const target = norm([light[0] * 0.5, 1, light[2] * 0.5])
        let n = rotateToward(c.n, target, 0.012 + 0.06 * climb)
        const flat = c.flat + (n[1] > 0.78 ? 1 : 0)
        const sag = droopTarget(o.u, flat)
        if (sag) n = rotateToward(n, sag, 0.04 + 0.05 * Math.min(1, (flat - 3) / 10))
        const p = centre(i, j, k)
        // A sheet is one cell thick: no growing directly against its own face.
        let stacked = false
        for (const sign of [1, -1]) {
          const si = at(i + Math.round(n[0] * 1.3 * sign), j + Math.round(n[1] * 1.3 * sign), k + Math.round(n[2] * 1.3 * sign))
          if (si >= 0 && grid[si]! >= 0 && cells[grid[si]!]!.kind === SHEET && grid[si]! !== c.id) stacked = true
        }
        if (stacked) continue
        // A sheet does not spread flat along the ground.
        if (above(p) < 1.6 * C && n[1] > 0.6) continue
        const eff = Math.pow(1 - LOSS, c.hops + 1)
        let Lc = lightCache.get(key)
        if (Lc === undefined) {
          Lc = lightAt(p, n, -1)
          lightCache.set(key, Lc)
        }
        // A new cell extends the span its parent already holds: an overloaded parent makes reaching further dearer.
        const gain = INCOME * Lc * water * eff * lifted(p) - UPKEEP * org.upkeep - (XS ? SPAN_COST * Math.max(0, c.rho - 0.8) : 0)
        // A young blade is paid for from the seed reserve until its canopy is in the light.
        const establishing = c.hops < 12 && org.reserve > 80
        if (gain < 0.1 && !(establishing && gain > -0.6)) continue
        const seam = clamp01(c.flow / Math.max(1, maxFlow[c.org]!))
        const cost = BUILD * org.build * (1 - 0.25 * seam) * (1 + 0.04 * Math.max(0, c.hops - 8))
        const score = (gain / cost) * (1 + 0.25 * Math.max(0, dot(o.u, c.dir)))
        const old = candidates.get(key)
        if (!old || old.score < score) candidates.set(key, { org: c.org, parent: c, i, j, k, n, dir: o.u, score, cost, gain })
        expanded.add(c.id)
      }
      c.quiet = expanded.has(c.id) ? 0 : c.quiet + 1
    }
    const byOrg = organisms.map(() => [] as Candidate[])
    for (const cand of candidates.values()) byOrg[cand.org]!.push(cand)
    const built = new Set<number>()
    for (const org of organisms) {
      const list = byOrg[org.id]!.sort((a, b) => b.score - a.score)
      let made = 0
      for (const cand of list) {
        if (made >= 40 || cells.length > 9000 || org.reserve < cand.cost + 4) break
        if (!valid(cand.i, cand.j, cand.k)) continue
        const id = addCell(org, SHEET, cand.i, cand.j, cand.k, cand.n, cand.dir, cand.parent.id, pulse)
        const child = cells[id]!
        child.income = cand.gain + UPKEEP
        child.balance = cand.gain
        child.hops = cand.parent.hops + 1
        child.flat = cand.parent.flat + (cand.n[1] > 0.78 ? 1 : 0)
        child.root = cand.parent.root
        org.reserve -= cand.cost
        built.add(cand.parent.id)
        made += 1
        // Touching another organism's body connects the two.
        for (const o of OFFSETS) {
          const idx = at(cand.i + o.e[0], cand.j + o.e[1], cand.k + o.e[2])
          if (idx >= 0 && grid[idx]! >= 0 && cells[grid[idx]!]!.org !== org.id && cells[grid[idx]!]!.alive) {
            fusions.push([id, grid[idx]!])
            break
          }
        }
      }
    }
    // An edge that could not grow, but is lit, reinforces itself into a rolled lip.
    for (const c of cells) {
      if (!c.alive || c.kind !== SHEET) continue
      if (built.has(c.id)) c.stalled = 0
      else c.stalled += 1
      if (c.stalled >= 6 && c.margin && c.light > 0.25 && c.lip < 1) c.lip = Math.min(1, c.lip + 0.08)
    }
  }
  settle(PULSES, false)
  for (const c of cells) {
    if (!c.alive) continue
    let free = 0
    for (const o of OFFSETS) {
      if (Math.abs(dot(o.u, c.n)) > 0.5) continue
      const idx = at(c.i + o.e[0], c.j + o.e[1], c.k + o.e[2])
      if (idx < 0 || grid[idx]! < 0) free += 1
    }
    c.margin = c.kind === SHEET && free >= 4
  }

  // ------------------------------------------------------------------------------------------------ surface
  const grownAt = performance.now()
  const living = cells.filter((c) => c.alive)
  if (!living.length) {
    return { geometry: new BufferGeometry(), site: [sx, sz], ground: cy, organisms: organisms.length, height: 0, stats: { cells: 0 }, graph: { cells, pulses: PULSES, shed: shedLog, fusions } }
  }
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const c of living) {
    minX = Math.min(minX, c.pos[0])
    minY = Math.min(minY, c.pos[1])
    minZ = Math.min(minZ, c.pos[2])
    maxX = Math.max(maxX, c.pos[0])
    maxY = Math.max(maxY, c.pos[1])
    maxZ = Math.max(maxZ, c.pos[2])
  }
  const G = 1
  const pad = 7
  const fx = Math.floor(minX - pad)
  const fy = Math.floor(minY - pad)
  const fz = Math.floor(minZ - pad)
  const dx = Math.ceil((maxX + pad - fx) / G) + 1
  const dy = Math.ceil((maxY + pad - fy) / G) + 1
  const dz = Math.ceil((maxZ + pad - fz) / G) + 1
  const field = new Float32Array(dx * dy * dz)
  const fidx = (x: number, y: number, z: number) => (z * dy + y) * dx + x
  const ribbed = (c: Cell) => smoothstep(0.3, 0.75, c.flow / Math.max(1, maxFlow[c.org]!))
  /** A pillar's top cell, the length of its run, and the way its sheet was growing where it hangs. */
  const pillarTop = (c: Cell): Cell => {
    let q = c
    while (q.depth > 0 && q.parent >= 0 && cells[q.parent]!.kind === PILLAR) q = cells[q.parent]!
    return q
  }
  const runLength = new Map<number, number>()
  for (const c of living) if (c.kind === PILLAR) runLength.set(pillarTop(c).id, Math.max(runLength.get(pillarTop(c).id) ?? 1, c.depth + 1))
  /** Where a cell has taken in clearly more than its neighbours, a mass builds up there. */
  const bulgeOf = (c: Cell): number => {
    let sum = 0
    let count = 0
    for (const o of OFFSETS) {
      const idx = at(c.i + o.e[0], c.j + o.e[1], c.k + o.e[2])
      if (idx < 0 || grid[idx]! < 0) continue
      const q = cells[grid[idx]!]!
      if (q.kind !== SHEET) continue
      sum += q.deposit
      count += 1
    }
    const mean = count ? sum / count : c.deposit
    return clamp01((c.deposit - 1.1 * mean) / (0.3 * D0)) * smoothstep(0.3, 0.65, dep01(c))
  }
  const frameOf = (n: V): [V, V] => {
    const u = norm(cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]))
    return [u, cross(n, u)]
  }
  /** Stamps a rounded-box mass of density into the field: a, b along u, v and cw along w. */
  const stamp = (p: V, u: V, v: V, w: V, a: number, b: number, cw: number) => {
    const rad = Math.max(a, b, cw) + 0.5
    const x0 = Math.max(0, Math.floor(p[0] - rad - fx))
    const x1 = Math.min(dx - 1, Math.ceil(p[0] + rad - fx))
    const y0 = Math.max(0, Math.floor(p[1] - rad - fy))
    const y1 = Math.min(dy - 1, Math.ceil(p[1] + rad - fy))
    const z0 = Math.max(0, Math.floor(p[2] - rad - fz))
    const z1 = Math.min(dz - 1, Math.ceil(p[2] + rad - fz))
    for (let z = z0; z <= z1; z += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const rx = fx + x - p[0]
          const ry = fy + y - p[1]
          const rz = fz + z - p[2]
          const pu = Math.abs(rx * u[0] + ry * u[1] + rz * u[2]) / a
          const pv = Math.abs(rx * v[0] + ry * v[1] + rz * v[2]) / b
          const pw = Math.abs(rx * w[0] + ry * w[1] + rz * w[2]) / cw
          const q = pu * pu * pu + pv * pv * pv + pw * pw * pw
          if (q < 1) {
            const k = 1 - q
            field[fidx(x, y, z)] = field[fidx(x, y, z)]! + k * k
          }
        }
      }
    }
  }
  const splat = (c: Cell, drop: number) => {
    const here: V = [c.pos[0], c.pos[1] - drop, c.pos[2]]
    if (c.kind === SHEET) {
      const n = c.n
      const [u, v] = frameOf(n)
      const rib = ribbed(c)
      const dep = dep01(c)
      // Thickness is what the cell has laid down; a lit edge rolls into a lip, a poor one stays thin and ragged.
      const edge = c.margin ? (0.75 + 0.45 * c.lip) * (0.6 + 0.4 * c.vitality) : 1
      const cn = (0.24 + 0.46 * Math.sqrt(dep)) * edge + 0.35 * rib
      const a = 1.45 * C * (c.margin ? 0.85 : 1) * (0.92 + 0.16 * dep)
      const under: V = [here[0] - n[0] * 0.3 * rib, here[1] - n[1] * 0.3 * rib, here[2] - n[2] * 0.3 * rib]
      stamp(under, u, v, n, a, a, cn)
      // The edge has stepped out in stages: a lip that has stood a while carries tiers beneath it.
      if (c.margin) {
        const tiers = 1 + Math.round(2 * c.lip)
        for (let k = 1; k <= tiers; k += 1) {
          const off = 0.7 * k + 0.4 * cn
          stamp([here[0] - n[0] * off, here[1] - n[1] * off, here[2] - n[2] * off], u, v, n, a * (1 - 0.17 * k), a * (1 - 0.17 * k), cn * 0.7)
        }
      }
      const bulge = bulgeOf(c)
      if (bulge > 0.05) stamp([here[0] + n[0] * cn * 0.5, here[1] + n[1] * cn * 0.5, here[2] + n[2] * cn * 0.5], u, v, n, a * 0.7, a * 0.7, cn * (0.6 + 0.9 * bulge))
    } else {
      const top = pillarTop(c)
      const len = runLength.get(top.id) ?? 1
      const t = len > 1 ? c.depth / (len - 1) : 0
      const r0 = 0.9 + 0.2 * Math.sqrt(top.flow + c.flow * 0.2)
      // Capital under the sheet, a waist, a spreading foot; heavier piers draw out into fins along the span.
      const prof = 0.8 * (1 + 0.9 * (1 - smoothstep(0, 0.3, t))) * (1 + 1.1 * smoothstep(0.7, 1, t) + (drop > 0 ? 0.4 : 0))
      const ratio = 1.3 + 1.1 * smoothstep(10, 45, top.flow)
      const sheet = top.parent >= 0 ? cells[top.parent]!.dir : ([1, 0, 0] as V)
      const turn = t * 0.5
      const h = norm([sheet[0], 0, sheet[2]])
      const ax: V = [h[0] * Math.cos(turn) - h[2] * Math.sin(turn), 0, h[0] * Math.sin(turn) + h[2] * Math.cos(turn)]
      const b = r0 * 1.5 * prof
      stamp(here, ax, [-ax[2], 0, ax[0]], [0, 1, 0], b * ratio, b, 3.4)
    }
  }
  for (const c of living) {
    splat(c, 0)
    // A rooted cell spreads into the ground: its foot is a second splat set down at the surface.
    if (c.anchor) splat(c, Math.max(0, above(c.pos)) + 0.8)
  }

  // Soften the stair-steps of the cell grid: the surface is drawn around a blurred density, so a climbing sheet is a
  // ramp and holes smaller than a few cells close. (Heuristic: it is how the discrete body becomes one smooth skin.)
  {
    const tmp = new Float32Array(field.length)
    const R = 1
    const pass = (src: Float32Array, out: Float32Array, stride: number, count: number, lines: (cb: (start: number) => void) => void) => {
      lines((start) => {
        let acc = 0
        for (let q = 0; q < count + R; q += 1) {
          if (q < count) acc += src[start + q * stride]!
          const drop = q - 2 * R - 1
          if (drop >= 0) acc -= src[start + drop * stride]!
          const centreIndex = q - R
          if (centreIndex >= 0 && centreIndex < count) out[start + centreIndex * stride] = acc / (2 * R + 1)
        }
      })
    }
    for (let it = 0; it < 1; it += 1) {
      pass(field, tmp, 1, dx, (cb) => { for (let z = 0; z < dz; z += 1) for (let y = 0; y < dy; y += 1) cb((z * dy + y) * dx) })
      pass(tmp, field, dx, dy, (cb) => { for (let z = 0; z < dz; z += 1) for (let x = 0; x < dx; x += 1) cb(z * dy * dx + x) })
      pass(field, tmp, dx * dy, dz, (cb) => { for (let y = 0; y < dy; y += 1) for (let x = 0; x < dx; x += 1) cb(y * dx + x) })
      field.set(tmp)
    }
    for (let q = 0; q < field.length; q += 1) field[q] = field[q]! * 1.0
  }
  // Nothing under the ground.
  for (let z = 0; z < dz; z += 1) for (let x = 0; x < dx; x += 1) {
    const g = hAt(fx + x, fz + z) - 1.2
    for (let y = 0; y < dy && fy + y < g; y += 1) field[fidx(x, y, z)] = 0
  }

  const ISO = 0.5
  const vertexOf = new Int32Array((dx - 1) * (dy - 1) * (dz - 1)).fill(-1)
  const cidx = (x: number, y: number, z: number) => (z * (dy - 1) + y) * (dx - 1) + x
  const positions: number[] = []
  const normals: number[] = []
  const owner: number[] = []
  const corners = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ]
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ]
  const cv = new Float32Array(8)
  for (let z = 0; z < dz - 1; z += 1) {
    for (let y = 0; y < dy - 1; y += 1) {
      for (let x = 0; x < dx - 1; x += 1) {
        let mask = 0
        for (let q = 0; q < 8; q += 1) {
          const cc = corners[q]!
          const v = field[fidx(x + cc[0]!, y + cc[1]!, z + cc[2]!)]!
          cv[q] = v
          if (v > ISO) mask |= 1 << q
        }
        if (mask === 0 || mask === 255) continue
        let px = 0
        let py = 0
        let pz = 0
        let count = 0
        for (const [a, b] of edges) {
          const va = cv[a!]!
          const vb = cv[b!]!
          if (va > ISO === vb > ISO) continue
          const t = (ISO - va) / (vb - va)
          const ca = corners[a!]!
          const cb = corners[b!]!
          px += ca[0]! + (cb[0]! - ca[0]!) * t
          py += ca[1]! + (cb[1]! - ca[1]!) * t
          pz += ca[2]! + (cb[2]! - ca[2]!) * t
          count += 1
        }
        const gx = (cv[1]! + cv[3]! + cv[5]! + cv[7]! - cv[0]! - cv[2]! - cv[4]! - cv[6]!) / 4
        const gy = (cv[2]! + cv[3]! + cv[6]! + cv[7]! - cv[0]! - cv[1]! - cv[4]! - cv[5]!) / 4
        const gz = (cv[4]! + cv[5]! + cv[6]! + cv[7]! - cv[0]! - cv[1]! - cv[2]! - cv[3]!) / 4
        const nrm = norm([-gx, -gy, -gz])
        vertexOf[cidx(x, y, z)] = positions.length / 3
        positions.push(fx + x + px / count, fy + y + py / count, fz + z + pz / count)
        normals.push(nrm[0], nrm[1], nrm[2])
      }
    }
  }
  const indices: number[] = []
  const quad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    const pa: V = [positions[a * 3]!, positions[a * 3 + 1]!, positions[a * 3 + 2]!]
    const pb: V = [positions[b * 3]!, positions[b * 3 + 1]!, positions[b * 3 + 2]!]
    const pc: V = [positions[c * 3]!, positions[c * 3 + 1]!, positions[c * 3 + 2]!]
    const face = cross(sub(pb, pa), sub(pc, pa))
    const out: V = [normals[a * 3]!, normals[a * 3 + 1]!, normals[a * 3 + 2]!]
    if (dot(face, out) >= 0) indices.push(a, b, c, a, c, d)
    else indices.push(a, c, b, a, d, c)
  }
  for (let z = 1; z < dz - 1; z += 1) {
    for (let y = 1; y < dy - 1; y += 1) {
      for (let x = 1; x < dx - 1; x += 1) {
        const here = field[fidx(x, y, z)]! > ISO
        if (field[fidx(x + 1, y, z)]! > ISO !== here) quad(vertexOf[cidx(x, y - 1, z - 1)]!, vertexOf[cidx(x, y, z - 1)]!, vertexOf[cidx(x, y, z)]!, vertexOf[cidx(x, y - 1, z)]!)
        if (field[fidx(x, y + 1, z)]! > ISO !== here) quad(vertexOf[cidx(x - 1, y, z - 1)]!, vertexOf[cidx(x - 1, y, z)]!, vertexOf[cidx(x, y, z)]!, vertexOf[cidx(x, y, z - 1)]!)
        if (field[fidx(x, y, z + 1)]! > ISO !== here) quad(vertexOf[cidx(x - 1, y - 1, z)]!, vertexOf[cidx(x, y - 1, z)]!, vertexOf[cidx(x, y, z)]!, vertexOf[cidx(x - 1, y, z)]!)
      }
    }
  }

  // Per-vertex growth record for the material: the nearby cells' birth, vitality, stress, seam, light and deposit, blended by
  // distance so the surface carries growth contours rather than the cell grid; the unit tone comes from the nearest cell.
  const count = positions.length / 3
  const colours = new Float32Array(positions.length)
  const recordA = new Float32Array(count * 4)
  const recordB = new Float32Array(count * 4)
  for (let v = 0; v < count; v += 1) {
    const p: V = [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!]
    const [ci, cj, ck] = cellAt(p)
    let best: Cell | null = null
    let bd = Infinity
    let wsum = 0
    let birth = 0
    let vital = 0
    let stress = 0
    let rib = 0
    let light = 0
    let dep = 0
    for (let a = -1; a <= 1; a += 1) for (let b = -1; b <= 1; b += 1) for (let d = -1; d <= 1; d += 1) {
      const idx = at(ci + a, cj + b, ck + d)
      if (idx < 0 || grid[idx]! < 0) continue
      const cell = cells[grid[idx]!]!
      const dd = (cell.pos[0] - p[0]) ** 2 + (cell.pos[1] - p[1]) ** 2 + (cell.pos[2] - p[2]) ** 2
      const w = 1 / (1 + dd)
      wsum += w
      birth += w * cell.birth
      vital += w * cell.vitality
      stress += w * cell.stress
      rib += w * ribbed(cell)
      light += w * cell.light
      dep += w * dep01(cell)
      if (dd < bd) {
        bd = dd
        best = cell
      }
    }
    const k = wsum > 0 ? 1 / wsum : 0
    const org = organisms[best?.org ?? 0]!
    const up = above(p)
    recordA.set([(birth * k) / PULSES, best ? vital * k : 0.6, stress * k, rib * k], v * 4)
    recordB.set([light * k, moistureAt(p[0], p[2]) * (1 - smoothstep(0, 8, up)), best ? ((best.id * 2654435761) >>> 0) / 4294967296 : 0.5, dep * k], v * 4)
    const colour = skin(Math.max(0, up), 0.3, org.tone, 0)
    const ny = normals[v * 3 + 1]!
    const nx = normals[v * 3]!
    const nz = normals[v * 3 + 2]!
    const shade = (ny < -0.4 ? 0.86 : 1) * (1 + 0.04 * (nx * wind[0] + nz * wind[2]))
    colours[v * 3] = colour.r * shade
    colours[v * 3 + 1] = colour.g * shade
    colours[v * 3 + 2] = colour.b * shade
  }
  void BONE
  void GRAY
  void add
  void mul
  void owner

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setAttribute('color', new BufferAttribute(colours, 3))
  geometry.setAttribute('aGrowthA', new BufferAttribute(recordA, 4))
  geometry.setAttribute('aGrowthB', new BufferAttribute(recordB, 4))
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1))
  geometry.computeBoundingSphere()

  let top = cy
  for (const c of living) top = Math.max(top, c.pos[1])
  const graph: Graph2 = { cells, pulses: PULSES, shed: shedLog, fusions }
  livingArchitecture.graph = graph
  livingArchitecture.version += 1
  const crossFusions = new Set(fusions.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`)).size
  const stats = {
    organisms: organisms.length,
    cellsBuilt: cells.length,
    cellsLiving: living.length,
    cellsShed: shedLog.length,
    sheetCells: living.filter((c) => c.kind === SHEET).length,
    pillarCells: living.filter((c) => c.kind === PILLAR).length,
    anchors: living.filter((c) => c.anchor).length,
    marginCells: living.filter((c) => c.margin).length,
    lippedCells: living.filter((c) => c.lip > 0.3).length,
    contacts: crossFusions,
    ...Object.fromEntries(organisms.map((o) => [`living${o.id}`, living.filter((c) => c.org === o.id).length])),
    ...Object.fromEntries(organisms.map((o) => [`peak${o.id}`, o.peak])),
    ...Object.fromEntries(organisms.map((o) => [`reserve${o.id}`, Math.round(o.reserve)])),
    vertices: positions.length / 3,
    triangles: indices.length / 3,
    experiment: X ? 1 : 0,
    overloaded: living.filter((c) => c.rho > 1).length,
    meanRho: Math.round((living.reduce((m, c) => m + c.rho, 0) / Math.max(1, living.length)) * 100) / 100,
    height: Math.round(top - cy),
    growMs: Math.round(grownAt - started),
    milliseconds: Math.round(performance.now() - started),
  }
  return { geometry, site: [sx, sz], ground: cy, organisms: organisms.length, height: top - cy, stats, graph }
}
