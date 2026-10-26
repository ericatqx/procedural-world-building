import { BufferAttribute, BufferGeometry, Color } from 'three'
import { sunAt } from '../project/sun.ts'
import { clamp01, smoothstep } from '../project02/core.ts'
import { prevailingWind } from './environment.ts'
import { islandRadius, landscapeHeight } from './terrain.ts'
import { BONE, Builder, GRAY, STAIN, add, chooseSite, cross, dot, footing, lerp, livingArchitecture, mul, norm, rng, skin, sub, waterBearing, waterDistance, type Colony, type V } from './livingArchitecture.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — Living Architecture, growth prototype.
 *
 * Nothing here is placed as a roof, a column or a room. A few founders are seeded on dry, lit ground and a
 * deterministic growth process runs for a fixed number of pulses. At each pulse every living tip senses its
 * surroundings and moves one step:
 *
 *   light       the day's sun arc, shaded by the terrain and by every structure already grown (a 3 m occupancy
 *               grid), plus a share of open sky. Tips steer toward light and away from mass: neighbours compete.
 *   moisture    nearness to water feeds the tip's vigor and bends stems toward the shore.
 *   wind        tips lean downwind with height, and height costs vigor, so exposed ground grows lower.
 *   terrain     tips keep clear of the ground, except supports, which seek it.
 *   vigor       light and water fill it, each step and height spend it, forks split it. A tip with none is finished.
 *
 * Three kinds of tip share these rules. A stem rises. When it is high enough and lit it puts out limbs toward the
 * brightest, emptiest bearing, and finally turns to a crown itself. A limb reaches outward and sags under its own
 * growing load. A support descends from a limb to the ground, but only where the load carried at that point has
 * outgrown what a limb of that weight can carry on its own, and only where no support stands close by. Where a tip
 * comes within reach of another structure, not its own recent lineage, the two fuse: the tip ends and the graph
 * gains a cross-link. Neighbouring founders meet in this way.
 *
 * After growth, loads flow down the graph (weight of everything carried, and its overturning moment, relieved by the
 * supports), and the loads set the thickness of every member. Where two limbs leave a fork, a membrane forms between
 * them if material reaches it: the supply thins with distance from the fork and with shade, and fails where the span
 * is too wide or the ground is too close. Openings are what the supply leaves out.
 *
 * Every node keeps what a later lifecycle will need: birth pulse, parent, children, fusion partner, kind, the light and
 * moisture it grew in, carried load, bending demand, thickness and accretion, and the support that relieves it.
 */

const STEM = 0
const LIMB = 1
const PROP = 2
type Kind = 0 | 1 | 2

export type GrowthNode = {
  id: number
  parent: number
  pos: V
  /** The pulse in which the node grew: the organism's clock, kept for timeline integration. */
  birth: number
  organism: number
  kind: Kind
  /** The founder stem this node descends from. */
  root: number
  children: number[]
  /** The node this tip fused with, or -1. */
  fused: number
  /** A support's foot, buried in the ground. */
  anchor: boolean
  light: number
  moisture: number
  vigor: number
  /** Carried weight, bending demand (m of thickness it asks for), thickness, and thickening by accretion. */
  load: number
  demand: number
  radius: number
  accretion: number
  /** The pulse's own weight, and for a support's first node the load it relieves from its limb. */
  weight: number
  shared: number
  /** The limb node a support relieves, or -1. */
  relieves: number
}

export type GrowthGraph = { nodes: GrowthNode[]; pulses: number; roots: number[]; fusions: [number, number, number][]; supports: [number, number][] }
export type GrownColony = Colony & { graph: GrowthGraph }

const PULSES = 62
const NODE_CAP = 3300
const STEP = { [STEM]: 3.0, [LIMB]: 3.3, [PROP]: 2.8 }
/** Pipe-model thickness (a power of the carried weight), and the stress the material is allowed per cubed meter. */
const pipe = (load: number) => 0.28 + 0.1 * load ** 0.42
const SIGMA = 1500
const CELL = 3

class Occupancy {
  readonly data: Float32Array
  readonly ox: number
  readonly oy: number
  readonly oz: number
  readonly nx: number
  readonly ny: number
  readonly nz: number
  constructor(ox: number, oy: number, oz: number, nx: number, ny: number, nz: number) {
    this.ox = ox
    this.oy = oy
    this.oz = oz
    this.nx = nx
    this.ny = ny
    this.nz = nz
    this.data = new Float32Array(nx * ny * nz)
  }
  cell(x: number, y: number, z: number): [number, number, number] {
    return [Math.floor((x - this.ox) / CELL), Math.floor((y - this.oy) / CELL), Math.floor((z - this.oz) / CELL)]
  }
  key(i: number, j: number, k: number): number {
    return i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz ? -1 : (j * this.nz + k) * this.nx + i
  }
  at(x: number, y: number, z: number): number {
    const [i, j, k] = this.cell(x, y, z)
    const key = this.key(i, j, k)
    return key < 0 ? 0 : this.data[key]!
  }
  add(x: number, y: number, z: number, m: number) {
    const [i, j, k] = this.cell(x, y, z)
    const key = this.key(i, j, k)
    if (key >= 0) this.data[key] = this.data[key]! + m
  }
}

type Organism = {
  id: number
  rand: () => number
  base: V
  stems: number
  vigor: number
  /** Height at which a stem begins to put out limbs, the height it stops, and how far a limb may reach (in steps). */
  reachH: number
  tierGap: number
  maxH: number
  maxReach: number
  tone: number
  nodes: number
  limbs: { az: number; y: number }[]
  water: V
}

type Tip = {
  node: number
  dir: V
  vigor: number
  kind: Kind
  org: number
  age: number
  sinceFork: number
  reach: number
  dark: number
  forks: number
  /** How many times this lineage of limb has forked: ribs fork a few times, not endlessly. */
  gen: number
  /** For a stem: the height at which its next whorl of limbs comes out. */
  tier: number
  target: V | null
  /** For a brace: the node it grows toward. */
  partner: number
}

const basis = (d: V): [V, V] => {
  const u = norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]))
  return [u, cross(d, u)]
}

export function growColony(world: World, seed: number): GrownColony {
  const started = performance.now()
  const [sx, sz] = chooseSite(world, seed)
  const ground = landscapeHeight
  const cy = ground(sx, sz)

  // The terrain near the colony, sampled once: tips and sun rays read it many thousand times.
  const HALF = 150
  const GRID = 4
  const side = (HALF * 2) / GRID + 1
  const heights = new Float32Array(side * side)
  for (let i = 0; i < side; i += 1) for (let j = 0; j < side; j += 1) heights[i * side + j] = ground(sx - HALF + j * GRID, sz - HALF + i * GRID)
  const hAt = (x: number, z: number): number => {
    const u = (x - (sx - HALF)) / GRID
    const w = (z - (sz - HALF)) / GRID
    if (u < 0 || w < 0 || u >= side - 1 || w >= side - 1) return ground(x, z)
    const j = Math.floor(u)
    const i = Math.floor(w)
    const fu = u - j
    const fw = w - i
    const a = heights[i * side + j]!
    const b = heights[i * side + j + 1]!
    const c = heights[(i + 1) * side + j]!
    const d = heights[(i + 1) * side + j + 1]!
    return lerp(lerp(a, b, fu), lerp(c, d, fu), fw)
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

  const occ = new Occupancy(sx - HALF, cy - 40, sz - HALF, Math.ceil((HALF * 2) / CELL), 44, Math.ceil((HALF * 2) / CELL))
  const sun = [8, 10.5, 13, 15.5].flatMap((h) => {
    const d = sunAt(h, 55).direction
    return d[1] > 0.12 ? [{ d: d as V, w: 0.4 + d[1] }] : []
  })
  const heading = (prevailingWind(seed) * Math.PI) / 180
  const wind: V = [Math.cos(heading), 0, Math.sin(heading)]

  /** Light at a point: the share of the sun's day that reaches it past terrain and grown mass, with a little open sky. */
  const lightAt = (p: V): number => {
    let sum = 0
    let weights = 0
    for (const s of sun) {
      let t = 1
      for (let k = 1; k <= 8; k += 1) {
        const d = k * 6
        const x = p[0] + s.d[0] * d
        const y = p[1] + s.d[1] * d
        const z = p[2] + s.d[2] * d
        if (hAt(x, z) > y) {
          t = 0
          break
        }
        t *= Math.exp(-0.3 * occ.at(x, y, z))
        if (t < 0.03) break
      }
      sum += t * s.w
      weights += s.w
    }
    let sky = 1
    for (let k = 1; k <= 4; k += 1) sky *= Math.exp(-0.22 * occ.at(p[0], p[1] + k * 5, p[2]))
    return 0.78 * (sum / weights) + 0.22 * sky
  }

  // ------------------------------------------------------------------------------------------------ founders
  const founderSpots = (() => {
    const found: { x: number; z: number; score: number }[] = []
    for (let dx = -100; dx <= 100; dx += 12) {
      for (let dz = -100; dz <= 100; dz += 12) {
        const x = sx + dx
        const z = sz + dz
        const away = Math.hypot(dx, dz)
        if (away > 104 || Math.hypot(x, z) > islandRadius(Math.atan2(z, x)) * 0.85 || world.water.depthAt(x, z) > 0) continue
        const slope = slopeAt(x, z)
        if (slope > 0.3) continue
        const score = 1.3 * lightAt([x, hAt(x, z) + 14, z]) + 0.5 * moistureAt(x, z) - 2.2 * slope - away / 240
        found.push({ x, z, score })
      }
    }
    found.sort((a, b) => b.score - a.score)
    const chosen: { x: number; z: number; score: number }[] = []
    for (const f of found) {
      if (chosen.length < 3 && chosen.every((c) => Math.hypot(c.x - f.x, c.z - f.z) >= 46)) chosen.push(f)
    }
    return chosen
  })()

  const nodes: GrowthNode[] = []
  const hash = new Map<number, number[]>()
  const supportsList: [number, number][] = []
  const fusions: [number, number, number][] = []
  const organisms: Organism[] = founderSpots.map((f, id) => {
    const r = rng(seed ^ (0x9e37 * (id + 3)))
    const base: V = [f.x, hAt(f.x, f.z), f.z]
    return {
      id,
      rand: r,
      base,
      stems: 2 + Math.floor(r() * 3),
      vigor: 0.9 + 0.35 * r(),
      reachH: 9 + 10 * r(),
      tierGap: 8 + 5 * r(),
      maxH: 36 + 30 * r() * (1 - 0.4 * clamp01((base[1] - 60) / 260)),
      maxReach: 12 + 9 * r(),
      tone: 0.95 + 0.09 * r(),
      nodes: 0,
      limbs: [],
      water: waterBearing(world, f.x, f.z),
    }
  })

  const addNode = (parent: number, pos: V, pulse: number, org: Organism, kind: Kind, vigor: number, light: number): number => {
    const id = nodes.length
    const segment = parent >= 0 ? Math.hypot(...sub(pos, nodes[parent]!.pos)) : 1
    nodes.push({
      id,
      parent,
      pos,
      birth: pulse,
      organism: org.id,
      kind,
      root: parent >= 0 ? nodes[parent]!.root : id,
      children: [],
      fused: -1,
      anchor: false,
      light,
      moisture: moistureAt(pos[0], pos[2]),
      vigor,
      load: 0,
      demand: 0,
      radius: 0.2,
      accretion: 0,
      // A limb stands for the membrane it will carry: three times a stem's weight per meter.
      weight: segment * (kind === LIMB ? 3.2 : 1),
      shared: 0,
      relieves: -1,
    })
    if (parent >= 0) nodes[parent]!.children.push(id)
    occ.add(pos[0], pos[1], pos[2], kind === LIMB ? 2.4 : kind === STEM ? 1 : 0.8)
    const [i, j, k] = occ.cell(pos[0], pos[1], pos[2])
    const key = occ.key(i, j, k)
    if (key >= 0) (hash.get(key) ?? hash.set(key, []).get(key)!).push(id)
    if (kind !== PROP) {
      const ck = ckey(Math.floor(pos[0] / FAR), Math.floor(pos[1] / FAR), Math.floor(pos[2] / FAR))
      ;(coarse.get(ck) ?? coarse.set(ck, []).get(ck)!).push(id)
    }
    org.nodes += 1
    return id
  }

  const coarse = new Map<number, number[]>()
  const ckey = (i: number, j: number, k: number) => (i + 1024) * 4194304 + (j + 1024) * 2048 + (k + 1024)
  const FAR = 8
  /** The nearest structure of a different stem within a limb's sight: what it may reach toward and fuse with. */
  const nearestForeign = (p: V, root: number): V | null => {
    const ci = Math.floor(p[0] / FAR)
    const cj = Math.floor(p[1] / FAR)
    const ck = Math.floor(p[2] / FAR)
    let best: V | null = null
    let bd = 26 * 26
    for (let i = ci - 1; i <= ci + 1; i += 1) for (let j = cj - 1; j <= cj + 1; j += 1) for (let k = ck - 1; k <= ck + 1; k += 1) {
      const list = coarse.get(ckey(i, j, k))
      if (!list) continue
      for (const o of list) {
        const nd = nodes[o]!
        if (nd.root === root || Math.abs(nd.pos[1] - p[1]) > 8) continue
        const d2 = (nd.pos[0] - p[0]) ** 2 + (nd.pos[1] - p[1]) ** 2 + (nd.pos[2] - p[2]) ** 2
        if (d2 < bd && d2 > 12) {
          bd = d2
          best = nd.pos
        }
      }
    }
    return best
  }

  /** How far the nearest limb of a different lineage stands from a limb node, at about its height: the gap beside a rib. */
  const gapBeside = (id: number): number => {
    const p = nodes[id]!.pos
    const mine = new Set<number>()
    for (let n = id, d = 0; n >= 0 && d < 8; n = nodes[n]!.parent, d += 1) mine.add(n)
    const ci = Math.floor(p[0] / FAR)
    const cj = Math.floor(p[1] / FAR)
    const ck = Math.floor(p[2] / FAR)
    let best = 99
    for (let i = ci - 1; i <= ci + 1; i += 1) for (let j = cj - 1; j <= cj + 1; j += 1) for (let k = ck - 1; k <= ck + 1; k += 1) {
      for (const o of coarse.get(ckey(i, j, k)) ?? []) {
        const q = nodes[o]!
        if (q.kind !== LIMB || Math.abs(q.pos[1] - p[1]) > 5) continue
        const d = Math.hypot(q.pos[0] - p[0], q.pos[1] - p[1], q.pos[2] - p[2])
        if (d >= best) continue
        let kin = false
        for (let n = o, depth = 0; n >= 0 && depth < 8; n = nodes[n]!.parent, depth += 1) if (mine.has(n)) kin = true
        if (!kin) best = d
      }
    }
    return best
  }

  const ancestors = (id: number, depth: number): Set<number> => {
    const out = new Set<number>()
    for (let n = id, d = 0; n >= 0 && d < depth; n = nodes[n]!.parent, d += 1) out.add(n)
    return out
  }
  /** The nearest node within reach that is not close kin: the thing a tip would fuse with. */
  const fuseTarget = (id: number): number => {
    const p = nodes[id]!.pos
    const [ci, cj, ck] = occ.cell(p[0], p[1], p[2])
    const mine = ancestors(id, 16)
    let best = -1
    let bd = 3.0 * 3.0
    for (let i = ci - 1; i <= ci + 1; i += 1) {
      for (let j = cj - 1; j <= cj + 1; j += 1) {
        for (let k = ck - 1; k <= ck + 1; k += 1) {
          const list = hash.get(occ.key(i, j, k))
          if (!list) continue
          for (const o of list) {
            if (o === id) continue
            const q = nodes[o]!.pos
            const d2 = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2
            if (d2 >= bd || nodes[o]!.fused === id) continue
            let kin = false
            for (let n = o, d = 0; n >= 0 && d < 16; n = nodes[n]!.parent, d += 1) if (mine.has(n)) kin = true
            if (!kin) {
              best = o
              bd = d2
            }
          }
        }
      }
    }
    return best
  }

  /** Where a support could stand: dry, moderate ground below a limb, away from other feet. */
  const anchors: V[] = []
  const footFor = (from: V, org: Organism, reach: number): V | null => {
    let best: V | null = null
    let bestScore = -Infinity
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2 + org.rand() * 0.4
      for (const d of [0, reach * 0.4, reach * 0.8]) {
        const x = from[0] + Math.cos(a) * d
        const z = from[2] + Math.sin(a) * d
        if (world.water.depthAt(x, z) > 0) continue
        const slope = slopeAt(x, z)
        if (slope > 0.45) continue
        if (anchors.some((q) => Math.hypot(q[0] - x, q[2] - z) < 11)) continue
        const score = -3 * slope - 0.05 * d + 0.3 * moistureAt(x, z) + 0.2 * org.rand()
        if (score > bestScore) {
          bestScore = score
          best = [x, hAt(x, z), z]
        }
      }
    }
    return best
  }

  let tips: Tip[] = []
  const newTip = (node: number, dir: V, vigor: number, kind: Kind, org: Organism, target: V | null = null): Tip => ({ node, dir, vigor, kind, org: org.id, age: 0, sinceFork: 0, reach: 0, dark: 0, forks: 0, gen: 0, tier: 0, target, partner: -1 })

  const roots: number[] = []
  for (const org of organisms) {
    for (let s = 0; s < org.stems; s += 1) {
      const a = (s / org.stems) * Math.PI * 2 + org.rand() * 0.9
      const x = org.base[0] + Math.cos(a) * 6
      const z = org.base[2] + Math.sin(a) * 6
      const root = addNode(-1, [x, hAt(x, z) - 1.4, z], 0, org, STEM, org.vigor, 1)
      roots.push(root)
      const stem = newTip(root, norm([Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3]), org.vigor, STEM, org)
      stem.tier = org.reachH
      tips.push(stem)
    }
  }

  /** The bearing, level with a point, with the most light and room: where a limb should go. */
  const bestBearing = (p: V, org: Organism, skip: number): V => {
    let best: V = [1, 0, 0]
    let bestScore = -Infinity
    const toKin = organisms.filter((o) => o !== org).map((o) => Math.atan2(o.base[2] - p[2], o.base[0] - p[0]))
    for (let k = 0; k < 10; k += 1) {
      const a = (k / 10) * Math.PI * 2 + skip * 0.31
      const dir: V = [Math.cos(a), 0, Math.sin(a)]
      const q: V = [p[0] + dir[0] * 10, p[1] + 2, p[2] + dir[2] * 10]
      let crowd = 0
      for (const l of org.limbs) if (Math.abs(l.y - p[1]) < 8) crowd += Math.max(0, Math.cos(a - l.az)) ** 2
      const kin = toKin.reduce((m, t) => Math.max(m, Math.cos(a - t)), -1)
      const score = 1.7 * lightAt(q) - 0.5 * occ.at(q[0], q[1], q[2]) - 0.9 * crowd + 0.18 * kin + 0.1 * org.rand() + (hAt(q[0], q[2]) > q[1] - 3 ? -1 : 0)
      if (score > bestScore) {
        bestScore = score
        best = dir
      }
    }
    org.limbs.push({ az: Math.atan2(best[2], best[0]), y: p[1] })
    return best
  }

  const OFFSETS: [number, number][] = [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4], [0.35, 0.35], [-0.35, 0.35], [0.35, -0.35], [-0.35, -0.35]]

  const spawn: Tip[] = []
  /** Advances one tip by one step. Returns false when the tip is finished. */
  const stepTip = (tip: Tip, pulse: number): boolean => {
    const org = organisms[tip.org]!
    const node = nodes[tip.node]!
    const p = node.pos
    const g = hAt(p[0], p[2])
    const h = p[1] - g
    tip.age += 1
    tip.sinceFork += 1

    if (tip.kind === PROP) {
      const target = tip.target!
      const to = sub(target, p)
      const dist = Math.hypot(...to)
      if (dist <= STEP[PROP] + 0.5) {
        const id = addNode(tip.node, [target[0], target[1] - 1.0, target[2]], pulse, org, PROP, tip.vigor, 1)
        nodes[id]!.anchor = true
        anchors.push(target)
        return false
      }
      const dir = norm(add(mul(norm(to), 0.7), mul(tip.dir, 0.3)))
      const next: V = add(p, mul(dir, STEP[PROP]))
      tip.dir = dir
      const id = addNode(tip.node, next, pulse, org, PROP, tip.vigor, 1)
      tip.node = id
      if (dist > 5) {
        const other = fuseTarget(id)
        if (other >= 0 && nodes[other]!.pos[1] < next[1] + 1) {
          nodes[id]!.fused = other
          fusions.push([id, other, pulse])
          return false
        }
      }
      return true
    }

    // A brace grows straight across to the limb it was sent toward and joins it.
    if (tip.partner >= 0) {
      const target = nodes[tip.partner]!.pos
      const to = sub(target, p)
      const dist = Math.hypot(...to)
      tip.dir = norm(add(mul(norm(to), 0.8), mul(tip.dir, 0.2)))
      const joined = dist <= STEP[LIMB] + 0.5
      const next: V = joined ? target : add(p, mul(tip.dir, STEP[LIMB] * 0.9))
      const id = addNode(tip.node, joined ? [target[0], target[1] - 0.2, target[2]] : next, pulse, org, LIMB, tip.vigor, 1)
      if (joined) {
        nodes[id]!.fused = tip.partner
        fusions.push([id, tip.partner, pulse])
        return false
      }
      tip.node = id
      return tip.age < 8
    }

    const light = lightAt(p)
    const wet = moistureAt(p[0], p[2])
    node.light = light
    // Vigor: light and water fill it; each step, and height, spend it.
    tip.vigor = Math.min(1.5, tip.vigor + 0.05 * light * (0.55 + 0.8 * wet) - 0.016 * (1 + h / 45) - (tip.kind === LIMB ? 0.003 : 0))
    tip.dark = light < 0.16 ? tip.dark + 1 : 0
    if (tip.vigor <= 0 || tip.dark >= 5) return false

    const crowdedOrg = org.nodes >= NODE_CAP / Math.max(1, organisms.length)
    let dir = tip.dir

    // Stems put out limbs, then turn to a crown.
    if (tip.kind === STEM) {
      // A whorl of limbs leaves the stem at each tier: they take the bearings with the most light and room.
      if (!crowdedOrg && h >= tip.tier && tip.vigor > 0.35 && light > 0.45) {
        const count = Math.max(2, 4 - tip.forks + (org.rand() < 0.4 ? 1 : 0))
        const first = bestBearing(p, org, tip.age)
        const turn0 = Math.atan2(first[2], first[0])
        for (let k = 0; k < count; k += 1) {
          const a = turn0 + (k / count) * Math.PI * 2 + (org.rand() - 0.5) * 0.4
          const flat = norm([Math.cos(a), 0, Math.sin(a)])
          org.limbs.push({ az: a, y: p[1] })
          spawn.push(newTip(tip.node, norm([flat[0], 0.2 + 0.12 * org.rand(), flat[2]]), tip.vigor * 0.6, LIMB, org))
        }
        tip.vigor *= 0.85
        tip.forks += 1
        tip.tier += org.tierGap
      }
      if (h >= org.maxH || (light > 0.8 && h > org.reachH * 2.3 && org.rand() < 0.25)) {
        tip.kind = LIMB
        tip.reach = 0
        const bearing = bestBearing(p, org, tip.age)
        dir = norm([bearing[0], 0.25, bearing[2]])
      }
    } else if (tip.kind === LIMB) {
      tip.reach += 1
      if (tip.reach > org.maxReach) return false
      // Ribs keep an even spacing: a rib forks where the gap beside it is open to the light, and a crowded rib thins.
      const gap = tip.reach >= 2 ? gapBeside(tip.node) : 99
      if (gap < 3.4 && tip.reach > 3) tip.vigor -= 0.1
      if (!crowdedOrg && tip.gen < 3 && tip.sinceFork >= 3 && tip.reach >= 3 && tip.reach < org.maxReach - 3 && tip.vigor > 0.3 && light > 0.55 && gap > 8) {
        const turn = 0.3 + 0.12 * org.rand()
        const rotate = (d: V, a: number): V => [d[0] * Math.cos(a) - d[2] * Math.sin(a), d[1], d[0] * Math.sin(a) + d[2] * Math.cos(a)]
        const child = newTip(tip.node, rotate(dir, -turn), tip.vigor * 0.75, LIMB, org)
        child.reach = tip.reach
        tip.gen += 1
        child.gen = tip.gen
        spawn.push(child)
        dir = rotate(dir, turn)
        tip.vigor *= 0.75
        tip.sinceFork = 0
      }
      // A limb that sags to a person's reach of the ground ends there: roots come from load, not from drooping.
      if (h < 3.5 && tip.reach > 3) return false
    }

    // Steering: score nine headings by the light and room ahead.
    const [u, v] = basis(dir)
    let best = dir
    let bestScore = -Infinity
    const exposure = clamp01(h / 40)
    const foreign = tip.kind === LIMB || (tip.kind === STEM && h > org.reachH * 0.8) ? nearestForeign(p, node.root) : null
    const pull = foreign ? norm(sub(foreign, p)) : null
    for (const [a, b] of OFFSETS) {
      const c = norm(add(dir, add(mul(u, a), mul(v, b))))
      if (tip.kind === STEM && c[1] < 0.3) continue
      if (tip.kind === LIMB && c[1] > 0.5) continue
      const q: V = add(p, mul(c, 5))
      const clear = q[1] - hAt(q[0], q[2])
      const up = tip.kind === STEM ? 0.7 : h < 6 ? 0.6 : 0
      const score =
        1.6 * lightAt(q) + 0.9 * dot(c, dir) + up * c[1] - 0.5 * occ.at(q[0], q[1], q[2]) + 0.3 * exposure * dot(c, wind) + (pull ? 0.25 * dot(c, pull) : 0) + (tip.kind === STEM ? 0.15 * dot(c, org.water) : 0) - (clear < 2.4 ? (2.4 - clear) * 1.2 : 0)
      if (score > bestScore) {
        bestScore = score
        best = c
      }
    }
    dir = norm(add(mul(dir, 0.55), mul(best, 0.45)))
    if (tip.kind === LIMB) dir = norm([dir[0], Math.max(-0.22, dir[1] - 0.02 * Math.min(tip.reach, 10)), dir[2]])
    tip.dir = dir

    let next: V = add(p, mul(dir, STEP[tip.kind]))
    const floor = hAt(next[0], next[2]) + 1.0
    if (next[1] < floor) next = [next[0], floor, next[2]]
    const id = addNode(tip.node, next, pulse, org, tip.kind, tip.vigor, light)
    tip.node = id
    if (tip.age >= 4) {
      const other = fuseTarget(id)
      if (other >= 0) {
        nodes[id]!.fused = other
        fusions.push([id, other, pulse])
        return false
      }
    }
    return true
  }

  /** Loads: weight carried by each node, the bending it demands, and the supports' relief. Supports hold up a limb, so their load runs the other way. */
  const computeLoads = () => {
    const n = nodes.length
    const W = new Float64Array(n)
    const PX = new Float64Array(n)
    const PY = new Float64Array(n)
    const PZ = new Float64Array(n)
    const props: number[][] = []
    for (let i = n - 1; i >= 0; i -= 1) {
      const node = nodes[i]!
      W[i] += node.weight
      PX[i] += node.weight * node.pos[0]
      PY[i] += node.weight * node.pos[1]
      PZ[i] += node.weight * node.pos[2]
      const kids = props[i]
      if (kids && kids.length) {
        const phi = Math.min(0.7, 0.4 * kids.length)
        for (const c of kids) nodes[c]!.shared = (W[i]! * phi) / kids.length
        W[i] = W[i]! * (1 - phi)
        PX[i] = PX[i]! * (1 - phi)
        PY[i] = PY[i]! * (1 - phi)
        PZ[i] = PZ[i]! * (1 - phi)
      }
      const w = Math.max(1e-6, W[i]!)
      const off = Math.hypot(PX[i]! / w - node.pos[0], PZ[i]! / w - node.pos[2])
      const lever = Math.max(0, PY[i]! / w - node.pos[1])
      node.load = w
      node.demand = Math.cbrt((w * (off + 0.12 * lever)) / SIGMA)
      if (node.parent >= 0) {
        const parent = nodes[node.parent]!
        if (node.kind === PROP && parent.kind !== PROP) {
          ;(props[node.parent] ??= []).push(i)
          node.relieves = node.parent
        } else {
          W[node.parent] = W[node.parent]! + w
          PX[node.parent] = PX[node.parent]! + PX[i]!
          PY[node.parent] = PY[node.parent]! + PY[i]!
          PZ[node.parent] = PZ[node.parent]! + PZ[i]!
        }
      }
    }
    let carried = new Float64Array(n)
    for (const node of nodes) {
      if (node.kind === PROP) {
        const parent = nodes[node.parent]!
        carried[node.id] = (parent.kind === PROP ? carried[parent.id]! : node.shared) + node.weight
        node.radius = 0.9 * pipe(carried[node.id]!)
      } else {
        node.radius = Math.min(6.5, Math.max(pipe(node.load), node.demand))
      }
    }
    carried = new Float64Array(0)
  }

  // ------------------------------------------------------------------------------------------------ growth
  /** Supports appear where a limb's bending demand exceeds what it can bear unaided and no support stands near. */
  const addSupports = (pulse: number) => {
    computeLoads()
    const candidates = nodes
      .filter((nd) => nd.kind === LIMB && nd.children.every((c) => nodes[c]!.kind !== PROP) && nd.demand > 1.3 && nd.pos[1] - hAt(nd.pos[0], nd.pos[2]) > 6)
      .sort((a, b) => b.demand - a.demand)
    const made = new Map<number, number>()
    for (const nd of candidates) {
      const org = organisms[nd.organism]!
      if ((made.get(org.id) ?? 0) >= 1) continue
      const near = anchors.some((q) => Math.hypot(q[0] - nd.pos[0], q[2] - nd.pos[2]) < 16) || supportsList.some(([, at]) => Math.hypot(nodes[at]!.pos[0] - nd.pos[0], nodes[at]!.pos[1] - nd.pos[1], nodes[at]!.pos[2] - nd.pos[2]) < 16) || org.base && Math.hypot(org.base[0] - nd.pos[0], org.base[2] - nd.pos[2]) < 8
      if (near) continue
      const foot = footFor(nd.pos, org, (nd.pos[1] - hAt(nd.pos[0], nd.pos[2])) * 0.5)
      if (!foot) continue
      const tip = newTip(nd.id, norm(sub(foot, nd.pos)), 1, PROP, org, foot)
      spawn.push(tip)
      supportsList.push([nd.id, nd.id])
      made.set(org.id, (made.get(org.id) ?? 0) + 1)
    }
    void pulse
  }

  /** A limb that runs long and slender is braced: a tie grows from it across to the nearest limb of another lineage. */
  const braced = new Set<number>()
  const addBraces = () => {
    computeLoads()
    const made = new Map<number, number>()
    for (const nd of nodes) {
      if (nd.kind !== LIMB || braced.has(nd.id) || nd.children.length !== 1 || nodes[nd.children[0]!]!.kind !== LIMB) continue
      if ((made.get(nd.organism) ?? 0) >= 8) continue
      let run = 0
      for (let n = nd.id; n >= 0 && nodes[n]!.kind === LIMB && (n === nd.id || nodes[n]!.children.length === 1); n = nodes[n]!.parent) run += 1
      if (run < 4 || (run * STEP[LIMB]) / Math.max(0.2, nd.radius) < 11) continue
      if (nd.pos[1] - hAt(nd.pos[0], nd.pos[2]) < 6) continue
      const mine = ancestors(nd.id, 8)
      const ci = Math.floor(nd.pos[0] / FAR)
      const cj = Math.floor(nd.pos[1] / FAR)
      const ck = Math.floor(nd.pos[2] / FAR)
      let best = -1
      let bd = 15 * 15
      for (let i = ci - 2; i <= ci + 2; i += 1) for (let j = cj - 1; j <= cj + 1; j += 1) for (let k = ck - 2; k <= ck + 2; k += 1) {
        for (const o of coarse.get(ckey(i, j, k)) ?? []) {
          const q = nodes[o]!
          if (q.kind !== LIMB || Math.abs(q.pos[1] - nd.pos[1]) > 4 || mine.has(o)) continue
          const d2 = (q.pos[0] - nd.pos[0]) ** 2 + (q.pos[1] - nd.pos[1]) ** 2 + (q.pos[2] - nd.pos[2]) ** 2
          if (d2 < bd && d2 > 5 * 5 && !ancestors(o, 8).has(nd.id)) {
            bd = d2
            best = o
          }
        }
      }
      if (best < 0) continue
      braced.add(nd.id)
      made.set(nd.organism, (made.get(nd.organism) ?? 0) + 1)
      const tip = newTip(nd.id, norm(sub(nodes[best]!.pos, nd.pos)), 0.8, LIMB, organisms[nd.organism]!)
      tip.partner = best
      tip.gen = 9
      spawn.push(tip)
    }
  }

  for (const org of organisms) for (const root of roots) if (nodes[root]!.organism === org.id) anchors.push([nodes[root]!.pos[0], nodes[root]!.pos[1], nodes[root]!.pos[2]])

  for (let pulse = 1; pulse <= PULSES; pulse += 1) {
    spawn.length = 0
    if (pulse >= 12 && pulse % 3 === 0) addSupports(pulse)
    if (pulse >= 10 && pulse % 4 === 2) addBraces()
    const alive: Tip[] = []
    for (const tip of tips) if (nodes.length < NODE_CAP && stepTip(tip, pulse)) alive.push(tip)
    tips = alive.concat(spawn)
    if (!tips.length) break
  }

  computeLoads()
  // Support tips that were spawned by a limb need their attach point; their first node already hangs from it.
  for (const node of nodes) if (node.kind === PROP && node.parent >= 0 && nodes[node.parent]!.kind !== PROP) supportsList.push([node.parent, node.id])

  // ------------------------------------------------------------------------------------------------ accretion
  // Material gathers where the structure is asked for more: at forks and fusions, where bending outgrows the pipe,
  // at the foot, and a little where the air is wet. It spreads along the members it is on.
  const above = (nd: GrowthNode) => nd.pos[1] - hAt(nd.pos[0], nd.pos[2])
  for (const nd of nodes) {
    const joint = nd.children.length + (nd.fused >= 0 ? 1 : 0) > 1 ? 1 : 0
    const bending = clamp01(nd.demand / Math.max(0.3, pipe(nd.load)) - 0.6)
    nd.accretion = 0.55 * joint + 0.5 * bending + 0.5 * Math.exp(-Math.max(0, above(nd)) / 2.4) + 0.12 * nd.moisture
  }
  for (let pass = 0; pass < 3; pass += 1) {
    const next = nodes.map((nd) => nd.accretion)
    for (const nd of nodes) {
      if (nd.parent >= 0) next[nd.id] = Math.max(next[nd.id]!, nodes[nd.parent]!.accretion * 0.62)
      for (const c of nd.children) next[nd.id] = Math.max(next[nd.id]!, nodes[c]!.accretion * 0.62)
    }
    nodes.forEach((nd, i) => (nd.accretion = next[i]!))
  }
  // Free tips taper to a point rather than stopping: the last two nodes of a member thin out.
  for (const nd of nodes) {
    if (nd.children.length === 0 && nd.fused < 0 && !nd.anchor) {
      nd.radius *= 0.6
      if (nd.parent >= 0 && nodes[nd.parent]!.children.length === 1) {
        nodes[nd.parent]!.radius *= 0.75
      }
    }
  }
  for (const nd of nodes) nd.radius *= 1 + 0.4 * nd.accretion + (nd.kind === PROP || nd.kind === STEM ? 0.9 * Math.exp(-Math.max(0, above(nd)) / 2.0) : 0)

  // ------------------------------------------------------------------------------------------------ geometry
  const b = new Builder()
  const orgTone = (id: number) => organisms[id]?.tone ?? 1
  const mainChild = (nd: GrowthNode): number => {
    let best = -1
    let bw = -1
    for (const c of nd.children) {
      const k = nodes[c]!
      if ((k.kind === PROP) !== (nd.kind === PROP)) continue
      if (k.load > bw) {
        bw = k.load
        best = c
      }
    }
    return best
  }

  type ChainPoint = { p: V; r: number; light: number; moist: number; id: number }
  const tubeAlong = (pts: ChainPoint[], organism: number, parity: number) => {
    // Smooth the path: one Catmull–Rom midpoint per span where the member is stout enough to show it.
    let path = pts
    if (Math.max(...pts.map((q) => q.r)) > 1.0 && pts.length > 2) {
      path = []
      for (let i = 0; i < pts.length - 1; i += 1) {
        const p0 = pts[Math.max(0, i - 1)]!.p
        const p1 = pts[i]!.p
        const p2 = pts[i + 1]!.p
        const p3 = pts[Math.min(pts.length - 1, i + 2)]!.p
        path.push(pts[i]!)
        path.push({ p: [0, 1, 2].map((k) => -0.0625 * p0[k]! + 0.5625 * p1[k]! + 0.5625 * p2[k]! - 0.0625 * p3[k]!) as V, r: (pts[i]!.r + pts[i + 1]!.r) / 2, light: (pts[i]!.light + pts[i + 1]!.light) / 2, moist: pts[i]!.moist, id: pts[i]!.id })
      }
      path.push(pts[pts.length - 1]!)
    }
    const rMax = Math.max(...path.map((q) => q.r))
    const sides = rMax > 2.2 ? 16 : rMax > 0.9 ? 10 : 6
    const flutes = rMax > 0.9 ? (sides >= 16 ? 5 : 3) : 0
    const twist = (parity ? 1 : -1) * 0.06
    const rings: number[][] = []
    let w: V = [0, 0, 0]
    let along = 0
    for (let i = 0; i < path.length; i += 1) {
      const a = path[Math.max(0, i - 1)]!.p
      const c = path[Math.min(path.length - 1, i + 1)]!.p
      const t = norm(sub(c, a))
      if (i === 0) w = norm(cross(t, Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]))
      else w = norm(sub(w, mul(t, dot(w, t))))
      const n = norm(cross(t, w))
      if (i > 0) along += Math.hypot(...sub(path[i]!.p, path[i - 1]!.p))
      const q = path[i]!
      const ring: number[] = []
      const heightAbove = Math.max(0, q.p[1] - hAt(q.p[0], q.p[2]))
      for (let s = 0; s < sides; s += 1) {
        const ang = (s / sides) * Math.PI * 2
        const ridge = flutes ? Math.cos(flutes * ang + twist * along * 6) : 0
        const k = q.r * (1 + 0.09 * ridge * smoothstep(0.55, 1.2, q.r))
        // Fibres: the ridges are a little paler than the troughs between them.
        const tone = orgTone(organism) * (0.94 + 0.06 * ridge * (flutes ? 1 : 0)) * (0.82 + 0.2 * q.light)
        const colour = skin(heightAbove, 0.25 + 0.5 * (1 - clamp01(q.r / 3)), tone, q.moist)
        ring.push(b.vertex(add(add(q.p, mul(w, Math.cos(ang) * k)), mul(n, Math.sin(ang) * k)), colour))
      }
      rings.push(ring)
    }
    for (let i = 0; i < rings.length - 1; i += 1) for (let s = 0; s < sides; s += 1) b.quad(rings[i]![s]!, rings[i]![(s + 1) % sides]!, rings[i + 1]![(s + 1) % sides]!, rings[i + 1]![s]!)
    // Close the tip with a short taper.
    const last = path[path.length - 1]!
    const prev = path[Math.max(0, path.length - 2)]!
    const end = add(last.p, mul(norm(sub(last.p, prev.p)), Math.min(1.4, last.r * 1.1 + 0.15)))
    const cap = b.vertex(end, skin(Math.max(0, last.p[1] - hAt(last.p[0], last.p[2])), 0.8, orgTone(organism), last.moist))
    const ring = rings[rings.length - 1]!
    for (let s = 0; s < sides; s += 1) b.tri(cap, ring[s]!, ring[(s + 1) % sides]!)
  }

  const starts: { prefix: number; first: number }[] = roots.map((r) => ({ prefix: -1, first: r }))
  for (const nd of nodes) {
    const main = mainChild(nd)
    for (const c of nd.children) if (c !== main) starts.push({ prefix: nd.id, first: c })
  }
  let chainCount = 0
  for (const s of starts) {
    const ids: number[] = []
    for (let n = s.first; n >= 0; n = mainChild(nodes[n]!)) ids.push(n)
    const pts: ChainPoint[] = ids.map((id) => {
      const nd = nodes[id]!
      return { p: nd.pos, r: nd.radius, light: nd.light, moist: nd.moisture, id }
    })
    if (s.prefix >= 0) {
      const from = nodes[s.prefix]!
      pts.unshift({ p: from.pos, r: Math.min(from.radius, nodes[s.first]!.radius) * 0.95, light: from.light, moist: from.moisture, id: from.id })
    }
    const tail = nodes[ids[ids.length - 1]!]!
    if (tail.fused >= 0) {
      const partner = nodes[tail.fused]!
      pts.push({ p: partner.pos, r: Math.min(tail.radius, partner.radius) * 0.7, light: partner.light, moist: partner.moisture, id: partner.id })
    }
    if (pts.length < 2) continue
    tubeAlong(pts, nodes[s.first]!.organism, chainCount % 2)
    chainCount += 1
  }
  // Feet: where a member enters the ground, the root mass spreads into a mound.
  const footRand = rng(seed ^ 0x77)
  for (const nd of nodes) {
    if (nd.anchor || (nd.parent < 0)) {
      const foot: V = [nd.pos[0], hAt(nd.pos[0], nd.pos[2]), nd.pos[2]]
      const r = Math.min(9, nd.radius * 2.1 + 1.2)
      footing(b, foot, [r, r * 0.8], norm([footRand() - 0.5, 0, footRand() - 0.5]), footRand, nd.moisture, nd.parent < 0 ? 0.8 : 0.6)
    }
  }

  // ------------------------------------------------------------------------------------------------ membranes
  /**
   * Panels between neighbouring limbs. A limb is linked to the nearest limb of another lineage within reach, and where
   * two limbs run side by side, linked at both ends of a segment, a panel spans between them. A rib can span only so
   * far for its thickness (the thickness comes from the load it carries), so slender or distant ribs leave openings, and
   * the ground's nearness and the shade a panel would sit in leave openings too.
   */
  let sheets = 0
  let cells = 0
  let skipped = 0
  const limbIds = nodes.filter((nd) => nd.kind === LIMB).map((nd) => nd.id)
  const PC = 7
  const panelCells = new Map<number, number[]>()
  const pkey = (i: number, j: number, k: number) => (i + 1024) * 4194304 + (j + 1024) * 2048 + (k + 1024)
  for (const id of limbIds) {
    const p = nodes[id]!.pos
    const key = pkey(Math.floor(p[0] / PC), Math.floor(p[1] / PC), Math.floor(p[2] / PC))
    ;(panelCells.get(key) ?? panelCells.set(key, []).get(key)!).push(id)
  }
  const kinCache = new Map<number, Set<number>>()
  const kin = (id: number) => kinCache.get(id) ?? kinCache.set(id, ancestors(id, 5)).get(id)!
  const link = new Map<number, number>()
  const SPAN = 24
  for (const id of limbIds) {
    const n = nodes[id]!
    const p = n.pos
    const ci = Math.floor(p[0] / PC)
    const cj = Math.floor(p[1] / PC)
    const ck = Math.floor(p[2] / PC)
    let best = -1
    let bd = Infinity
    for (let i = ci - 2; i <= ci + 2; i += 1) for (let j = cj - 1; j <= cj + 1; j += 1) for (let k = ck - 2; k <= ck + 2; k += 1) {
      for (const m of panelCells.get(pkey(i, j, k)) ?? []) {
        if (m === id) continue
        const q = nodes[m]!.pos
        const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])
        if (d < 3.2 || d > 19 || Math.abs(q[1] - p[1]) > 5 || d >= bd) continue
        if (kin(id).has(m) || kin(m).has(id)) continue
        best = m
        bd = d
      }
    }
    if (best >= 0 && bd <= SPAN * (n.radius + nodes[best]!.radius) * 0.5) link.set(id, best)
    else if (best >= 0) skipped += 1
  }
  const quads: [number, number, number, number][] = []
  const seen = new Set<string>()
  /** The node on a's limb, a few steps either side of it, nearest to a point: where the next rung of a panel lands. */
  const alongLimb = (a: number, from: V, heading: V, avoid: number): number => {
    const cands: number[] = [a]
    for (let n = a, s = 0; s < 3 && nodes[n]!.parent >= 0 && nodes[nodes[n]!.parent]!.kind === LIMB; s += 1) {
      n = nodes[n]!.parent
      cands.push(n)
    }
    for (let n = a, s = 0; s < 3; s += 1) {
      const m = mainChild(nodes[n]!)
      if (m < 0 || nodes[m]!.kind !== LIMB) break
      n = m
      cands.push(n)
    }
    let best = -1
    let bd = Infinity
    for (const k of cands) {
      if (k === a || k === avoid) continue
      const q = nodes[k]!.pos
      if (dot(sub(q, nodes[a]!.pos), heading) <= 0) continue
      const d = Math.hypot(q[0] - from[0], q[1] - from[1], q[2] - from[2])
      if (d < bd && d < 16) {
        bd = d
        best = k
      }
    }
    return best
  }
  for (const id of limbIds) {
    const n = nodes[id]!
    let c = -1
    let cw = -1
    for (const k of n.children) if (nodes[k]!.kind === LIMB && nodes[k]!.load > cw) { cw = nodes[k]!.load; c = k }
    const a = link.get(id)
    if (c < 0 || a === undefined) continue
    const d = alongLimb(a, nodes[c]!.pos, sub(nodes[c]!.pos, n.pos), id)
    if (d < 0 || d === c || a === c) continue
    const ids = [id, c, d, a]
    const clear = Math.min(...ids.map((k) => nodes[k]!.pos[1] - hAt(nodes[k]!.pos[0], nodes[k]!.pos[2])))
    const lit = Math.max(...ids.map((k) => nodes[k]!.light))
    const wide = Math.hypot(...sub(nodes[d]!.pos, nodes[c]!.pos))
    if (clear < 3.2 || lit < 0.2 || wide > 19) {
      skipped += 1
      continue
    }
    const key = [...new Set(ids)].sort((x, y) => x - y).join(',')
    if (seen.has(key)) continue
    seen.add(key)
    quads.push([id, c, d, a])
  }
  const edgeKey = (u: number, v: number) => (u < v ? u * 100000 + v : v * 100000 + u)
  const edgeUse = new Map<number, number>()
  for (const [A, C, D, B] of quads) for (const [u, v] of [[A, C], [C, D], [D, B], [B, A]] as [number, number][]) if (u !== v) edgeUse.set(edgeKey(u, v), (edgeUse.get(edgeKey(u, v)) ?? 0) + 1)
  const G = 2
  for (const [A, C, D, B] of quads) {
    const nA = nodes[A]!
    const P00 = nA.pos
    const P10 = nodes[C]!.pos
    const P01 = nodes[B]!.pos
    const P11 = nodes[D]!.pos
    let nrm = norm(cross(sub(P10, P00), sub(P01, P00)))
    if (Math.hypot(...nrm) < 0.5 || Math.abs(nrm[1]) < 0.2) nrm = [0, 1, 0]
    if (nrm[1] < 0) nrm = mul(nrm, -1)
    const rMean = (nodes[A]!.radius + nodes[B]!.radius + nodes[C]!.radius + nodes[D]!.radius) / 4
    const thick = Math.min(1.6, Math.max(0.8, 0.6 + 0.3 * rMean))
    const tone = orgTone(nA.organism) * (0.97 + 0.05 * nA.light)
    const topIds: number[][] = []
    const botIds: number[][] = []
    for (let i = 0; i <= G; i += 1) {
      topIds.push([])
      botIds.push([])
      for (let j = 0; j <= G; j += 1) {
        const fi = i / G
        const fj = j / G
        const base: V = [0, 1, 2].map((k) => (P00[k]! * (1 - fj) + P01[k]! * fj) * (1 - fi) + (P10[k]! * (1 - fj) + P11[k]! * fj) * fi) as V
        const width = Math.hypot(...sub(P01, P00)) * (1 - fi) + Math.hypot(...sub(P11, P10)) * fi
        const arch = 0.09 * width * Math.sin(Math.PI * fj)
        const t = thick * (1.2 - 0.5 * Math.sin(Math.PI * fj))
        const q: V = [base[0], base[1] + arch - 0.3, base[2]]
        const topColor = skin(q[1] - hAt(q[0], q[2]), 0.55, tone, nA.moisture * 0.5)
        topIds[i]!.push(b.vertex(add(q, mul(nrm, t * 0.5)), topColor))
        botIds[i]!.push(b.vertex(add(q, mul(nrm, -t * 0.5)), topColor.clone().multiplyScalar(0.9)))
      }
    }
    for (let i = 0; i < G; i += 1) for (let j = 0; j < G; j += 1) {
      b.quad(topIds[i]![j]!, topIds[i + 1]![j]!, topIds[i + 1]![j + 1]!, topIds[i]![j + 1]!)
      b.quad(botIds[i]![j]!, botIds[i]![j + 1]!, botIds[i + 1]![j + 1]!, botIds[i + 1]![j]!)
      cells += 1
    }
    const rim = (u: number, v: number, pairs: [number, number][]) => {
      if (u === v || edgeUse.get(edgeKey(u, v)) !== 1) return
      for (const [p, q] of pairs) b.quad(topIds[Math.floor(p / (G + 1))]![p % (G + 1)]!, topIds[Math.floor(q / (G + 1))]![q % (G + 1)]!, botIds[Math.floor(q / (G + 1))]![q % (G + 1)]!, botIds[Math.floor(p / (G + 1))]![p % (G + 1)]!)
    }
    const at = (i: number, j: number) => i * (G + 1) + j
    const side = (from: [number, number], to: [number, number]) =>
      Array.from({ length: G }, (_, s) => {
        const f = (k: number) => [Math.round(from[0] + ((to[0] - from[0]) * k) / G), Math.round(from[1] + ((to[1] - from[1]) * k) / G)] as [number, number]
        const p = f(s)
        const q = f(s + 1)
        return [at(p[0], p[1]), at(q[0], q[1])] as [number, number]
      })
    rim(A, C, side([0, 0], [G, 0]))
    rim(C, D, side([G, 0], [G, G]))
    rim(D, B, side([0, G], [G, G]))
    rim(B, A, side([0, 0], [0, G]))
    sheets += 1
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(b.positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(b.colors), 3))
  geometry.setIndex(new BufferAttribute(new Uint32Array(b.indices), 1))
  geometry.computeVertexNormals()
  const normal = geometry.getAttribute('normal') as BufferAttribute
  const color = geometry.getAttribute('color') as BufferAttribute
  for (let i = 0; i < color.count; i += 1) {
    const ny = normal.getY(i)
    const toWind = normal.getX(i) * wind[0] + normal.getZ(i) * wind[2]
    const k = (ny < -0.4 ? 0.86 : 1) * (1 + 0.04 * toWind)
    color.setXYZ(i, color.getX(i) * k, color.getY(i) * k, color.getZ(i) * k)
  }
  geometry.computeBoundingSphere()

  let top = cy
  for (const nd of nodes) top = Math.max(top, nd.pos[1])
  const graph: GrowthGraph = { nodes, pulses: PULSES, roots, fusions, supports: supportsList }
  livingArchitecture.graph = graph
  livingArchitecture.version += 1
  void BONE
  void GRAY
  void STAIN
  void Color
  const stats = {
    organisms: organisms.length,
    nodes: nodes.length,
    stems: nodes.filter((n) => n.kind === STEM).length,
    limbs: nodes.filter((n) => n.kind === LIMB).length,
    supportNodes: nodes.filter((n) => n.kind === PROP).length,
    feet: nodes.filter((n) => n.anchor).length,
    fusions: fusions.length,
    crossFusions: fusions.filter(([a, c]) => nodes[a]!.organism !== nodes[c]!.organism).length,
    sheets,
    sheetCells: cells,
    cellsWithheld: skipped,
    vertices: color.count,
    triangles: b.indices.length / 3,
    height: Math.round(top - cy),
    milliseconds: Math.round(performance.now() - started),
  }
  return { geometry, site: [sx, sz], ground: cy, organisms: organisms.length, height: top - cy, stats, graph }
}
