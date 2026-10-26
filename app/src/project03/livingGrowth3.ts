import { BufferAttribute, BufferGeometry } from 'three'
import { sunAt } from '../project/sun.ts'
import { clamp01, smoothstep } from '../project02/core.ts'
import { prevailingWind } from './environment.ts'
import { islandRadius, landscapeHeight } from './terrain.ts'
import { chooseSite, cross, dot, lerp, livingArchitecture, norm, rng, skin, sub, waterDistance, type Colony, type V } from './livingArchitecture.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — Living Architecture, Experiment 2a: growth on exposed faces.
 *
 * The body is solid. It is made of 2 m cells, each either skin (at least one face open to the air) or core (every face
 * against another cell). A cell earns only through its open faces, by the sun reaching that face (the day's arc, shaded by
 * the terrain and every other cell), less what the path back to the ground loses. It costs to keep, a little for being a
 * cell and a little for each open face. Growth is deposition: an empty cell beside an open face is a candidate, and it is
 * scored by what its own open faces would earn, less the earning faces it would bury, less its upkeep, per cost to build.
 * The best the organism's one reserve can afford are built.
 *
 * Direction is not chosen: a candidate above, beside or below a cell is simply whichever pays. Stacking on a lit top face
 * buries that face and shows another like it, so it gains only where the new face is better lit (out of shade, or higher
 * off the ground). Reaching sideways shows a new top face and costs only a side face, so it pays more. Below an overhang,
 * faces are dark and earn nothing. Whatever shape comes of that is the result.
 *
 * Structure: a cell may be built only where it is supported. Resting on the ground or on a supported cell, it inherits that
 * cell's overhang run; beside cells it extends the run by one; hanging below a cell it does too. How long a run may be
 * depends on how thick the mass carrying it is (a thin slab reaches one cell, a thick one several). Cells cut off from every
 * root die; cells that lose money for several settlements are shed, unless they carry other cells' income.
 *
 * From Grown2: the grid and terrain cache, the shared reserve and funding, the BFS paths to the roots and the loss along
 * them, flow, deficit pruning, contacts between organisms, the surface mesh (a box stamp per cell, blurred, surface-netted)
 * and the material's growth record. No runoff and no finite water: water is each root's moisture, as in the baseline.
 */

const C = 2
const PULSES = 150
const INCOME = 0.9
const U_CELL = 0.1
const U_FACE = 0.05
const LOSS = 0.012
const BUILD = 6

const DIRS: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

export type Cell3 = {
  id: number
  org: number
  i: number
  j: number
  k: number
  pos: V
  parent: number
  birth: number
  shedAt: number
  alive: boolean
  anchor: boolean
  hops: number
  root: number
  /** Open faces: 0 is core, more is skin. */
  faces: number
  /** Overhang run: cells of unsupported reach from the nearest support. */
  sup: number
  light: number
  income: number
  upkeep: number
  balance: number
  deficit: number
  vitality: number
  flow: number
  stress: number
  deposit: number
  quiet: number
  /** Matured, persistent tissue (Experiment 3a); false is harvest tissue. */
  structural: boolean
  maturedAt: number
}

export type Graph3 = { cells: Cell3[]; pulses: number; shed: [number, number][]; fusions: [number, number][] }
export type GrownColony3 = Colony & { graph: Graph3 }

/**
 * Experiment 2b (`slender`): a slenderness limit. A cell may be built only where its height above the ground, in cells, is
 * at most SLENDER × the width of what carries it: the larger of the minimum bounding side of its own layer's connected
 * component (as it would be with the new cell) and that of the component of the cell below it. Width is the bounding side,
 * not the area, so material spread out (a ring, two columns tied by a bridge) counts as wide, and the minimum side stops a
 * single wall counting as wide in both directions. One cell wide reaches 6 cells (about 12 m).
 *
 * As a structural proxy it is crude. Components are labelled at the start of each pulse, so cells built in the same pulse do
 * not see each other. It checks height at the top of a stack only: there is no wind, no load above, no buckling length and
 * no stiffness of joints, and a bounding box overstates the width of a sparse or L-shaped footprint. Cells already built are
 * not removed if pruning later splits a layer into narrower pieces.
 */
export type Grown3Options = { slender?: boolean; scaffold?: boolean }
const SLENDER = 6

/**
 * Experiment 3a (`scaffold`): persistent structural tissue, one dry spell, regrowth. Three phases in the same 150 pulses.
 *
 *   growth        Grown3 as it is.
 *   maturation    from pulse 30, a cell older than 20 pulses that carries flow of 5 or more (it is on a load or transport path:
 *                 the road the BFS already marks) matures into structural tissue. Structural tissue earns nothing, costs 0.02
 *                 to keep, is not pruned for losing money, and is cut off only by losing its path to a root.
 *   shortage      pulses 84–103: every harvesting cell earns 12% of its income, a deterministic dry spell. Harvest tissue that
 *                 cannot pay is shed by the usual deficit rule; the scaffold stays.
 *   regrowth      from pulse 104 income is restored. Structural tissue holds stored resource: each structural cell hands the
 *                 organism 2 units of reserve when the shortage ends (so it can start again at all). New harvest tissue
 *                 deposited from a structural cell costs 60% as much, loses no earning face under it (structure earned
 *                 nothing), and a cell carried by structure may reach one cell further.
 *
 * The reuse advantage is bounded to those three terms. Nothing else about the economy, site or budget changes.
 */
const MATURE_FROM = 30
const MATURE_AGE = 20
const MATURE_FLOW = 5
const DRY_FROM = 84
const DRY_TO = 104
const DRY_INCOME = 0.12
const STORE_PER_CELL = 2
const STRUCT_UPKEEP = 0.02
const REUSE_COST = 0.6

export function growColony3(world: World, seed: number, options: Grown3Options = {}): GrownColony3 {
  const started = performance.now()
  const X = options.slender === true
  const S = options.scaffold === true
  const resourcesAt = (pulse: number) => (S && pulse >= DRY_FROM && pulse < DRY_TO ? DRY_INCOME : 1)
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
  const cx = (i: number) => ox + (i + 0.5) * C
  const cyw = (j: number) => oy + (j + 0.5) * C
  const cz = (k: number) => oz + (k + 0.5) * C
  const above = (x: number, y: number, z: number) => y - hAt(x, z)

  const sun = [8, 10.5, 13, 15.5].flatMap((h) => {
    const d = sunAt(h, 55).direction
    return d[1] > 0.12 ? [{ d: d as V, w: 0.4 + d[1] }] : []
  })
  const heading = (prevailingWind(seed) * Math.PI) / 180
  const wind: V = [Math.cos(heading), 0, Math.sin(heading)]

  const dry = new Int8Array(NX * NZ)
  const dryColumn = (i: number, k: number): boolean => {
    const key = k * NX + i
    if (dry[key] === 0) dry[key] = world.water.depthAt(cx(i), cz(k)) <= 0 && Math.hypot(cx(i) - sx, cz(k) - sz) < HALF - 6 ? 1 : 2
    return dry[key] === 1
  }
  /** Air a cell could be built in: inside the grid, empty, and above the ground. */
  const open = (i: number, j: number, k: number): boolean => {
    const idx = at(i, j, k)
    return idx >= 0 && grid[idx]! < 0 && above(cx(i), cyw(j), cz(k)) > 0.2 * C
  }
  const buildable = (i: number, j: number, k: number): boolean => open(i, j, k) && dryColumn(i, k) && above(cx(i), cyw(j), cz(k)) >= 0.45 * C
  /** Sheet near the ground earns little (splash, fouling, grazers), as in Grown2: the one inherited heuristic. */
  const lifted = (h: number) => 0.3 + 0.7 * smoothstep(2.5, 10, h)

  // ------------------------------------------------------------------------------------------------ light on a face
  let faceCache = new Map<number, Float32Array>()
  /** Irradiance (0–1) on the face of cell (i,j,k) looking along direction d: the sun arc past terrain and cells, and a little sky. */
  const faceLight = (i: number, j: number, k: number, d: number): number => {
    const idx = at(i, j, k)
    let arr = faceCache.get(idx)
    if (!arr) {
      arr = new Float32Array(6).fill(-1)
      faceCache.set(idx, arr)
    }
    if (arr[d]! >= 0) return arr[d]!
    const n = DIRS[d]!
    const px = cx(i) + n[0] * 0.5 * C
    const py = cyw(j) + n[1] * 0.5 * C
    const pz = cz(k) + n[2] * 0.5 * C
    let sum = 0
    let weights = 0
    for (const s of sun) {
      const facing = n[0] * s.d[0] + n[1] * s.d[1] + n[2] * s.d[2]
      weights += s.w
      if (facing < 0.02) continue
      let t = 1
      for (let q = 1; q <= 12; q += 1) {
        const x = px + s.d[0] * q * C
        const y = py + s.d[1] * q * C
        const z = pz + s.d[2] * q * C
        if (hAt(x, z) > y) {
          t = 0
          break
        }
        const o = at(Math.floor((x - ox) / C), Math.floor((y - oy) / C), Math.floor((z - oz) / C))
        if (o >= 0 && o !== idx && grid[o]! >= 0) t *= 0.28
        if (t < 0.04) break
      }
      sum += t * facing * s.w
    }
    let sky = 1
    for (let q = 1; q <= 5; q += 1) {
      const o = at(i, j + q, k)
      if (o >= 0 && grid[o]! >= 0 && o !== idx) sky *= 0.3
    }
    const value = clamp01(1.25 * 0.8 * (sum / weights) + 0.2 * sky * (0.5 + 0.5 * n[1]) * (d === 3 ? 0 : 1))
    arr[d] = value
    return value
  }

  // ------------------------------------------------------------------------------------------------ organisms
  type Organism = { id: number; rand: () => number; base: V; reserve: number; tone: number; peak: number }
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
        let openSky = 0
        for (const s of sun) {
          let t = 1
          for (let q = 1; q <= 12; q += 1) if (hAt(x + s.d[0] * q * 6, z + s.d[2] * q * 6) > hAt(x, z) + 8 + s.d[1] * q * 6) t = 0
          openSky += t
        }
        found.push({ x, z, score: 1.3 * (openSky / sun.length) + 0.5 * moistureAt(x, z) - 2.2 * slope - away / 240 })
      }
    }
    found.sort((a, b) => b.score - a.score)
    const chosen: typeof found = []
    for (const f of found) if (chosen.length < 3 && chosen.every((c) => Math.hypot(c.x - f.x, c.z - f.z) >= 62)) chosen.push(f)
    return chosen
  })()
  const organisms: Organism[] = nuclei.map((f, id) => {
    const r = rng(seed ^ (0x7f4a * (id + 5)))
    return { id, rand: r, base: [f.x, hAt(f.x, f.z), f.z], reserve: 480, tone: 0.95 + 0.09 * r(), peak: 0 }
  })

  const cells: Cell3[] = []
  const shedLog: [number, number][] = []
  const fusions: [number, number][] = []
  const cellAt = (i: number, j: number, k: number): Cell3 | null => {
    const idx = at(i, j, k)
    return idx >= 0 && grid[idx]! >= 0 ? cells[grid[idx]!]! : null
  }
  const countFaces = (c: Cell3) => {
    let n = 0
    for (const d of DIRS) if (open(c.i + d[0], c.j + d[1], c.k + d[2])) n += 1
    c.faces = n
  }
  const refresh = (c: Cell3) => {
    countFaces(c)
    for (const d of DIRS) {
      const o = cellAt(c.i + d[0], c.j + d[1], c.k + d[2])
      if (o) countFaces(o)
    }
  }
  const addCell = (org: Organism, i: number, j: number, k: number, parent: number, sup: number, pulse: number): Cell3 => {
    const c: Cell3 = { id: cells.length, org: org.id, i, j, k, pos: [cx(i), cyw(j), cz(k)], parent, birth: pulse, shedAt: -1, alive: true, anchor: false, hops: 0, root: -1, faces: 0, sup, light: 0, income: 0, upkeep: U_CELL, balance: 0.2, deficit: 0, vitality: 0.6, flow: 0, stress: 0, deposit: 0, quiet: 0, structural: false, maturedAt: -1 }
    cells.push(c)
    grid[at(i, j, k)] = c.id
    refresh(c)
    return c
  }
  const shed = (c: Cell3, pulse: number) => {
    if (!c.alive) return
    c.alive = false
    c.shedAt = pulse
    grid[at(c.i, c.j, c.k)] = -1
    shedLog.push([c.id, pulse])
    for (const d of DIRS) {
      const o = cellAt(c.i + d[0], c.j + d[1], c.k + d[2])
      if (o) countFaces(o)
    }
  }
  const rooted = (c: Cell3) => above(c.pos[0], c.pos[1], c.pos[2]) < 1.15 * C

  // Each nucleus: a 2 × 2 column, three cells tall, standing on the ground.
  for (const org of organisms) {
    const i0 = Math.floor((org.base[0] - ox) / C)
    const k0 = Math.floor((org.base[2] - oz) / C)
    const j0 = Math.ceil((hAt(org.base[0], org.base[2]) + 0.5 * C - oy) / C - 0.5)
    for (let di = 0; di < 2; di += 1) {
      for (let dk = 0; dk < 2; dk += 1) {
        for (let dj = 0; dj < 3; dj += 1) {
          if (buildable(i0 + di, j0 + dj, k0 + dk)) addCell(org, i0 + di, j0 + dj, k0 + dk, -1, 0, 0)
        }
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ settlement
  let maxFlow: number[] = organisms.map(() => 1)
  const depositOf = (c: Cell3) => clamp01(c.deposit / 14)
  const settle = (pulse: number, prune: boolean) => {
    faceCache = new Map()
    const live = cells.filter((c) => c.alive)
    for (const c of live) {
      c.hops = -1
      countFaces(c)
    }
    const queue: Cell3[] = []
    for (const c of live) {
      if (c.anchor || rooted(c)) {
        c.anchor = true
        c.hops = 0
        c.root = c.id
        queue.push(c)
      }
    }
    const via = new Map<number, number>()
    for (let q = 0; q < queue.length; q += 1) {
      const c = queue[q]!
      for (const d of DIRS) {
        const next = cellAt(c.i + d[0], c.j + d[1], c.k + d[2])
        if (!next || next.hops >= 0) continue
        next.hops = c.hops + 1
        next.root = c.root
        via.set(next.id, c.id)
        queue.push(next)
      }
    }
    for (const c of live) if (c.hops < 0) shed(c, pulse)
    maxFlow = organisms.map(() => 1)
    for (const c of queue) {
      if (!c.alive) continue
      const rootCell = cells[c.root]!
      const water = 0.5 + 0.9 * moistureAt(rootCell.pos[0], rootCell.pos[2])
      let sum = 0
      let top = 0
      for (let d = 0; d < 6; d += 1) {
        const n = DIRS[d]!
        if (!open(c.i + n[0], c.j + n[1], c.k + n[2])) continue
        const e = faceLight(c.i, c.j, c.k, d)
        sum += e
        if (d === 2) top = e
      }
      c.light = Math.max(top, sum / Math.max(1, c.faces))
      c.income = c.structural ? 0 : INCOME * sum * water * Math.pow(1 - LOSS, c.hops) * lifted(above(c.pos[0], c.pos[1], c.pos[2])) * resourcesAt(pulse)
      c.flow = c.income
    }
    for (let q = queue.length - 1; q >= 0; q -= 1) {
      const c = queue[q]!
      const p = via.get(c.id)
      if (p !== undefined && cells[p]!.alive && c.alive) cells[p]!.flow += c.flow
    }
    for (const c of queue) {
      if (!c.alive) continue
      maxFlow[c.org] = Math.max(maxFlow[c.org]!, c.flow)
      if (S && !c.structural && pulse >= MATURE_FROM && pulse < DRY_FROM && pulse - c.birth >= MATURE_AGE && c.flow >= MATURE_FLOW) {
        c.structural = true
        c.maturedAt = pulse
      }
      c.upkeep = c.structural ? STRUCT_UPKEEP : U_CELL + U_FACE * c.faces
      c.balance = c.income - c.upkeep
      c.vitality = c.structural ? 0.3 : clamp01(0.5 + c.balance / 0.7)
      c.deposit += Math.max(0, c.balance) * 3 + 0.2
      c.stress = clamp01(c.sup / 6)
      if (prune && !c.anchor) {
        c.deficit = c.balance < 0 ? c.deficit + 1 : Math.max(0, c.deficit - 1)
        // Buried core is structure, not earning; it goes only if it is cut off. Skin that costs more than it earns is shed.
        if (!c.structural && c.faces > 0 && c.deficit >= 3 && pulse - c.birth >= 14 && c.flow < c.income + 3.2) shed(c, pulse)
      }
    }
    const counts = organisms.map(() => 0)
    for (const c of live) if (c.alive) counts[c.org]! += 1
    organisms.forEach((o, i) => (o.peak = Math.max(o.peak, counts[i]!)))
  }

  // ------------------------------------------------------------------------------------------------ growth
  /** Contiguous solid cells in the column through (i,j,k), counting it: how thick the mass carrying a cell is. */
  const thickness = (i: number, j: number, k: number): number => {
    let n = 1
    for (let q = 1; q <= 5 && cellAt(i, j + q, k); q += 1) n += 1
    for (let q = 1; q <= 5 && cellAt(i, j - q, k); q += 1) n += 1
    return n
  }
  type Candidate = { org: number; parent: Cell3; i: number; j: number; k: number; score: number; cost: number; gain: number; sup: number }
  const built: { up: number; level: number; down: number } = { up: 0, level: 0, down: 0 }
  let gated = 0

  settle(0, false)
  for (let pulse = 1; pulse <= PULSES; pulse += 1) {
    if (pulse % 3 === 0) settle(pulse, pulse > 36)
    if (S && pulse === DRY_TO) {
      // Structural tissue held stored resource through the shortage; it is released as income returns.
      for (const o of organisms) o.reserve += STORE_PER_CELL * cells.filter((c) => c.alive && c.org === o.id && c.structural).length
    }
    const net = organisms.map(() => 0)
    for (const c of cells) if (c.alive) net[c.org]! += c.balance
    organisms.forEach((o, idx) => (o.reserve = Math.max(0, o.reserve + net[idx]! * 0.9)))

    const seen = new Map<number, Cell3>()
    for (const c of cells) {
      if (!c.alive || c.faces === 0) continue
      if (c.quiet >= 3 && (pulse + c.id) % 6 !== 0) continue
      let any = false
      for (const d of DIRS) {
        const i = c.i + d[0]
        const j = c.j + d[1]
        const k = c.k + d[2]
        if (!buildable(i, j, k)) continue
        const idx = at(i, j, k)
        const old = seen.get(idx)
        if (!old || c.hops < old.hops) seen.set(idx, c)
        any = true
      }
      c.quiet = any ? 0 : c.quiet + 1
    }
    // 2b: connected components of each layer (4-neighbours), with their bounding boxes, as the pulse begins.
    let label: Int32Array | null = null
    const box: { i0: number; i1: number; k0: number; k1: number }[] = []
    if (X) {
      label = new Int32Array(cells.length).fill(-1)
      for (const c of cells) {
        if (!c.alive || label[c.id]! >= 0) continue
        const id = box.length
        const b = { i0: c.i, i1: c.i, k0: c.k, k1: c.k }
        box.push(b)
        const stack = [c]
        label[c.id] = id
        while (stack.length) {
          const q = stack.pop()!
          if (q.i < b.i0) b.i0 = q.i
          if (q.i > b.i1) b.i1 = q.i
          if (q.k < b.k0) b.k0 = q.k
          if (q.k > b.k1) b.k1 = q.k
          for (const d of [DIRS[0]!, DIRS[1]!, DIRS[4]!, DIRS[5]!]) {
            const n = cellAt(q.i + d[0], q.j, q.k + d[2])
            if (n && label[n.id]! < 0) {
              label[n.id] = id
              stack.push(n)
            }
          }
        }
      }
    }
    const byOrg: Candidate[][] = organisms.map(() => [])
    for (const [idx, parent] of seen) {
      const k = Math.floor(idx / NX) % NZ
      const j = Math.floor(idx / (NX * NZ))
      const i = idx % NX
      const x = cx(i)
      const y = cyw(j)
      const z = cz(k)
      const org = organisms[parent.org]!
      // Support: what this cell would rest on, hang from, or reach out from.
      let sup: number
      const below = cellAt(i, j - 1, k)
      if (above(x, y - C, z) < 0.45 * C) sup = 0
      else if (below) sup = below.sup
      else {
        sup = Infinity
        for (const d of [DIRS[0]!, DIRS[1]!, DIRS[4]!, DIRS[5]!]) {
          const n = cellAt(i + d[0], j, k + d[2])
          if (n) sup = Math.min(sup, n.sup + 1)
        }
        const over = cellAt(i, j + 1, k)
        if (over) sup = Math.min(sup, over.sup + 1)
      }
      if (!Number.isFinite(sup)) continue
      const carrier = below ?? cellAt(i, j + 1, k) ?? parent
      const reach = 1 + Math.floor(1.5 * (thickness(carrier.i, carrier.j, carrier.k) - 1)) + (S && carrier.structural ? 1 : 0)
      if (sup > reach) continue
      if (X && label) {
        // Width of what carries the cell: its layer's component with it added, or the component below, whichever is wider.
        let i0 = i
        let i1 = i
        let k0 = k
        let k1 = k
        for (const d of [DIRS[0]!, DIRS[1]!, DIRS[4]!, DIRS[5]!]) {
          const n = cellAt(i + d[0], j, k + d[2])
          if (!n) continue
          const b = box[label[n.id]!]!
          i0 = Math.min(i0, b.i0)
          i1 = Math.max(i1, b.i1)
          k0 = Math.min(k0, b.k0)
          k1 = Math.max(k1, b.k1)
        }
        let width = Math.min(i1 - i0 + 1, k1 - k0 + 1)
        const under = below ?? cellAt(i, j + 1, k)
        if (under) {
          const b = box[label[under.id]!]!
          width = Math.max(width, Math.min(b.i1 - b.i0 + 1, b.k1 - b.k0 + 1))
        }
        const heightCells = (above(x, y, z) + 0.5 * C) / C
        if (heightCells > SLENDER * width) {
          gated += 1
          continue
        }
      }
      let exposed = 0
      let exposedCount = 0
      let lost = 0
      let buried = 0
      for (let d = 0; d < 6; d += 1) {
        const n = DIRS[d]!
        const o = cellAt(i + n[0], j + n[1], k + n[2])
        if (o) {
          // Its face toward this cell is covered: what that face earned is lost.
          if (!(S && o.structural)) lost += faceLight(o.i, o.j, o.k, d ^ 1)
          buried += 1
        } else if (open(i + n[0], j + n[1], k + n[2])) {
          exposed += faceLight(i, j, k, d)
          exposedCount += 1
        }
      }
      const water = 0.5 + 0.9 * moistureAt(cells[parent.root]!.pos[0], cells[parent.root]!.pos[2])
      const eff = Math.pow(1 - LOSS, parent.hops + 1)
      const gain = INCOME * water * eff * lifted(above(x, y, z)) * resourcesAt(pulse) * (exposed - lost) - (U_CELL + U_FACE * (exposedCount - buried))
      if (gain < 0.08) continue
      const cost = BUILD * (1 + 0.04 * Math.max(0, parent.hops - 8)) * (S && (parent.structural || carrier.structural) ? REUSE_COST : 1)
      byOrg[org.id]!.push({ org: org.id, parent, i, j, k, score: gain / cost, cost, gain, sup })
    }
    for (const org of organisms) {
      const list = byOrg[org.id]!.sort((a, b) => b.score - a.score)
      let made = 0
      for (const cand of list) {
        if (made >= 40 || cells.length > 14000 || org.reserve < cand.cost + 4) break
        if (!buildable(cand.i, cand.j, cand.k)) continue
        const c = addCell(org, cand.i, cand.j, cand.k, cand.parent.id, cand.sup, pulse)
        c.income = cand.gain + U_CELL
        c.balance = cand.gain
        c.hops = cand.parent.hops + 1
        c.root = cand.parent.root
        org.reserve -= cand.cost
        made += 1
        if (c.j > cand.parent.j) built.up += 1
        else if (c.j < cand.parent.j) built.down += 1
        else built.level += 1
        for (const d of DIRS) {
          const o = cellAt(c.i + d[0], c.j + d[1], c.k + d[2])
          if (o && o.org !== org.id) {
            fusions.push([c.id, o.id])
            break
          }
        }
      }
    }
  }
  settle(PULSES, false)

  // ------------------------------------------------------------------------------------------------ surface
  const grownAt = performance.now()
  const living = cells.filter((c) => c.alive)
  const graph: Graph3 = { cells, pulses: PULSES, shed: shedLog, fusions }
  livingArchitecture.graph = graph
  livingArchitecture.version += 1
  if (!living.length) return { geometry: new BufferGeometry(), site: [sx, sz], ground: cy, organisms: organisms.length, height: 0, stats: { cells: 0 }, graph }
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
  const pad = 7
  const fx = Math.floor(minX - pad)
  const fy = Math.floor(minY - pad)
  const fz = Math.floor(minZ - pad)
  const dx = Math.ceil(maxX + pad - fx) + 1
  const dy = Math.ceil(maxY + pad - fy) + 1
  const dz = Math.ceil(maxZ + pad - fz) + 1
  const field = new Float32Array(dx * dy * dz)
  const fidx = (x: number, y: number, z: number) => (z * dy + y) * dx + x
  const HALF_BOX = 1.35 * C
  for (const c of living) {
    const rad = HALF_BOX + 0.5
    const x0 = Math.max(0, Math.floor(c.pos[0] - rad - fx))
    const x1 = Math.min(dx - 1, Math.ceil(c.pos[0] + rad - fx))
    const y0 = Math.max(0, Math.floor(c.pos[1] - rad - fy))
    const y1 = Math.min(dy - 1, Math.ceil(c.pos[1] + rad - fy))
    const z0 = Math.max(0, Math.floor(c.pos[2] - rad - fz))
    const z1 = Math.min(dz - 1, Math.ceil(c.pos[2] + rad - fz))
    for (let z = z0; z <= z1; z += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const ax = Math.abs(fx + x - c.pos[0]) / HALF_BOX
          const ay = Math.abs(fy + y - c.pos[1]) / HALF_BOX
          const az = Math.abs(fz + z - c.pos[2]) / HALF_BOX
          const q = ax * ax * ax + ay * ay * ay + az * az * az
          if (q < 1) {
            const k = 1 - q
            field[fidx(x, y, z)] = field[fidx(x, y, z)]! + k * k
          }
        }
      }
    }
  }
  // A light blur closes cell-sized creases; the surface follows the blurred density.
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
          const mid = q - R
          if (mid >= 0 && mid < count) out[start + mid * stride] = acc / (2 * R + 1)
        }
      })
    }
    pass(field, tmp, 1, dx, (cb) => { for (let z = 0; z < dz; z += 1) for (let y = 0; y < dy; y += 1) cb((z * dy + y) * dx) })
    pass(tmp, field, dx, dy, (cb) => { for (let z = 0; z < dz; z += 1) for (let x = 0; x < dx; x += 1) cb(z * dy * dx + x) })
    pass(field, tmp, dx * dy, dz, (cb) => { for (let y = 0; y < dy; y += 1) for (let x = 0; x < dx; x += 1) cb(y * dx + x) })
    field.set(tmp)
  }
  for (let z = 0; z < dz; z += 1) {
    for (let x = 0; x < dx; x += 1) {
      const g = hAt(fx + x, fz + z) - 1.2
      for (let y = 0; y < dy && fy + y < g; y += 1) field[fidx(x, y, z)] = 0
    }
  }

  const ISO = 0.5
  const vertexOf = new Int32Array((dx - 1) * (dy - 1) * (dz - 1)).fill(-1)
  const vidx = (x: number, y: number, z: number) => (z * (dy - 1) + y) * (dx - 1) + x
  const positions: number[] = []
  const normals: number[] = []
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]
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
        vertexOf[vidx(x, y, z)] = positions.length / 3
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
        if (field[fidx(x + 1, y, z)]! > ISO !== here) quad(vertexOf[vidx(x, y - 1, z - 1)]!, vertexOf[vidx(x, y, z - 1)]!, vertexOf[vidx(x, y, z)]!, vertexOf[vidx(x, y - 1, z)]!)
        if (field[fidx(x, y + 1, z)]! > ISO !== here) quad(vertexOf[vidx(x - 1, y, z - 1)]!, vertexOf[vidx(x - 1, y, z)]!, vertexOf[vidx(x, y, z)]!, vertexOf[vidx(x, y, z - 1)]!)
        if (field[fidx(x, y, z + 1)]! > ISO !== here) quad(vertexOf[vidx(x - 1, y - 1, z)]!, vertexOf[vidx(x, y - 1, z)]!, vertexOf[vidx(x, y, z)]!, vertexOf[vidx(x - 1, y, z)]!)
      }
    }
  }

  // The material's growth record per vertex, from the nearby cells.
  const count = positions.length / 3
  const colours = new Float32Array(positions.length)
  const recordA = new Float32Array(count * 4)
  const recordB = new Float32Array(count * 4)
  for (let v = 0; v < count; v += 1) {
    const p: V = [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!]
    const ci = Math.floor((p[0] - ox) / C)
    const cj = Math.floor((p[1] - oy) / C)
    const ck = Math.floor((p[2] - oz) / C)
    let best: Cell3 | null = null
    let bd = Infinity
    let wsum = 0
    let birth = 0
    let vital = 0
    let stress = 0
    let rib = 0
    let light = 0
    let dep = 0
    for (let a = -1; a <= 1; a += 1) {
      for (let b = -1; b <= 1; b += 1) {
        for (let d = -1; d <= 1; d += 1) {
          const cell = cellAt(ci + a, cj + b, ck + d)
          if (!cell) continue
          const dd = (cell.pos[0] - p[0]) ** 2 + (cell.pos[1] - p[1]) ** 2 + (cell.pos[2] - p[2]) ** 2
          const w = 1 / (1 + dd)
          wsum += w
          birth += w * cell.birth
          vital += w * cell.vitality
          stress += w * cell.stress
          rib += w * clamp01(cell.flow / Math.max(1, maxFlow[cell.org]!))
          light += w * cell.light
          dep += w * depositOf(cell)
          if (dd < bd) {
            bd = dd
            best = cell
          }
        }
      }
    }
    const k = wsum > 0 ? 1 / wsum : 0
    const org = organisms[best?.org ?? 0]!
    const up = above(p[0], p[1], p[2])
    recordA.set([(birth * k) / PULSES, best ? vital * k : 0.6, stress * k, rib * k], v * 4)
    recordB.set([light * k, moistureAt(p[0], p[2]) * (1 - smoothstep(0, 8, up)), best ? ((best.id * 2654435761) >>> 0) / 4294967296 : 0.5, dep * k], v * 4)
    const colour = skin(Math.max(0, up), 0.3, org.tone, 0)
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
  for (const c of living) top = Math.max(top, c.pos[1])
  const stats = {
    experiment: S ? 4 : X ? 3 : 2,
    structural: living.filter((c) => c.structural).length,
    gatedCandidates: gated,
    organisms: organisms.length,
    cellsBuilt: cells.length,
    cellsLiving: living.length,
    cellsShed: shedLog.length,
    skin: living.filter((c) => c.faces > 0).length,
    core: living.filter((c) => c.faces === 0).length,
    anchors: living.filter((c) => c.anchor).length,
    builtUp: built.up,
    builtLevel: built.level,
    builtDown: built.down,
    ...Object.fromEntries(organisms.map((o) => [`living${o.id}`, living.filter((c) => c.org === o.id).length])),
    ...Object.fromEntries(organisms.map((o) => [`reserve${o.id}`, Math.round(o.reserve)])),
    vertices: count,
    triangles: indices.length / 3,
    height: Math.round(top - cy),
    growMs: Math.round(grownAt - started),
    milliseconds: Math.round(performance.now() - started),
  }
  return { geometry, site: [sx, sz], ground: cy, organisms: organisms.length, height: top - cy, stats, graph }
}
