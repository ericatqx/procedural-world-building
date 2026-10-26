import { BufferAttribute, BufferGeometry } from 'three'
import { sunAt } from '../project/sun.ts'
import { clamp01, smoothstep } from '../project02/core.ts'
import { prevailingWind } from './environment.ts'
import { islandRadius, landscapeHeight } from './terrain.ts'
import { chooseSite, cross, dot, lerp, livingArchitecture, norm, skin, sub, waterDistance, type Colony, type V } from './livingArchitecture.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — Living Architecture, P0: a structural growth network with differential accretion.
 *
 * A geometry-first prototype. There is no resource economy, no weather, no decay and no structural solver: the aim is to see
 * what a different representation makes, before any ecology is attached to it.
 *
 * NETWORK. The organism is a graph in continuous space (metres), not a set of grid cells. A node has a position, a size, a
 * parent and, where a growing tip met another member and joined it, a second parent (so the graph has cycles). Tips grow in
 * rounds. Each round a tip looks at ten headings (eight level ones in the terrain's own frame, straight up, and straight on),
 * and takes the one that scores best on a few physical things:
 *
 *   light        the day's sun arc reaching the spot ahead, past terrain and the mass already grown
 *   crowding     the mass already there (the tip steers into space)
 *   gravity      a rooted primary member rises; a support descends; a lateral member prefers the level
 *   terrain      the contour and the fall line of the ground at the site give the level headings, and laterals favour the contour
 *   proximity    a tip is drawn a little toward another member that would give it a shorter way to the ground
 *
 * Members have a size that falls as they extend, so the spacing of nodes falls with it (large members step far, small ones
 * near): the network has several scales at once. A tip forks where it is well lit and there is room; a lateral that has
 * run farther than a member of its carrier's size can reach puts out a support that goes down to the ground; a tip that comes
 * within reach of another member's surface, where that gives it a shorter path to the ground (or reaches another root),
 * fuses with it and stops. A tip in the dark stops. Nothing else ends a member. Final member sizes come from the flow each
 * carries (the pipe model), so primaries are thick and tips are thin.
 *
 * ACCRETION. Each node is given a box aligned to its own heading (level) and to gravity, with six independent half-extents.
 * The network sets a floor: a node's box reaches back over its edge to its parent. Differential accretion then adds material
 * in shells, each face by what it faces:
 *
 *   top          in proportion to the light reaching it, so lit tops build thick slabs and shaded ones stay thin
 *   sides        by the low sun and the damp of the ground they face
 *   underside    little, except toward ground that is near, which it builds down to (a foot)
 *   gaps         a face that looks at another node's box across a gap under a bridging distance grows toward it, so near
 *                members merge into one mass and wider gaps stay open
 *
 * The shells' light is recomputed from the mass as it stands, so shading between members is part of it. The surface is the
 * hard union (max) of the boxes' signed distances: planes meet at creases and nothing is blended. The bridging distance,
 * the rates and the caps are the prototype's own numbers, not ecology.
 */

const O = 3
const HALF = 150
const SHELLS = 4
const ROUNDS = 36

type Role = 0 | 1 | 2
const PRIMARY: Role = 0
const LATERAL: Role = 1
const SUPPORT: Role = 2

export type NetNode = {
  id: number
  org: number
  pos: V
  size: number
  parent: number
  /** The member this node's tip fused with, or -1. */
  fused: number
  role: Role
  birth: number
  hops: number
  root: number
  flow: number
  yaw: number
  /** Half-extents along the box axes: heading ahead and behind, up and down, across each way. */
  ext: [number, number, number, number, number, number]
  light: number
}
export type NetGraph = { nodes: NetNode[]; fusions: number; roots: number }
export type GrownNetwork = Colony & { graph: NetGraph }

export function growNetwork(world: World, seed: number): GrownNetwork {
  const started = performance.now()
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
  const heading = (prevailingWind(seed) * Math.PI) / 180
  const wind: V = [Math.cos(heading), 0, Math.sin(heading)]

  // Occupancy of the mass so far (3 m cells), for shading and crowding.
  const NXo = (HALF * 2) / O
  const oy = Math.floor(minH) - 4
  const NYo = Math.ceil((cy + 130 - oy) / O)
  const ox = sx - HALF
  const oz = sz - HALF
  let occ = new Float32Array(NXo * NYo * NXo)
  const oi = (x: number, y: number, z: number) => {
    const i = Math.floor((x - ox) / O)
    const j = Math.floor((y - oy) / O)
    const k = Math.floor((z - oz) / O)
    return i < 0 || j < 0 || k < 0 || i >= NXo || j >= NYo || k >= NXo ? -1 : (j * NXo + k) * NXo + i
  }
  const occAt = (x: number, y: number, z: number) => {
    const idx = oi(x, y, z)
    return idx < 0 ? 0 : occ[idx]!
  }
  const occMark = (p: V, r: number) => {
    const i0 = Math.floor((p[0] - r - ox) / O)
    const i1 = Math.floor((p[0] + r - ox) / O)
    const j0 = Math.floor((p[1] - r - oy) / O)
    const j1 = Math.floor((p[1] + r - oy) / O)
    const k0 = Math.floor((p[2] - r - oz) / O)
    const k1 = Math.floor((p[2] + r - oz) / O)
    for (let k = Math.max(0, k0); k <= Math.min(NXo - 1, k1); k += 1) {
      for (let j = Math.max(0, j0); j <= Math.min(NYo - 1, j1); j += 1) {
        for (let i = Math.max(0, i0); i <= Math.min(NXo - 1, i1); i += 1) occ[(j * NXo + k) * NXo + i] = 1
      }
    }
  }
  /** Sky and sun on a surface facing n at p, past terrain and mass, skipping the first `skip` metres (the mass the point is in). */
  const irradiance = (p: V, n: V, skip: number): number => {
    let sum = 0
    let weights = 0
    for (const s of sun) {
      const face = n[0] * s.d[0] + n[1] * s.d[1] + n[2] * s.d[2]
      weights += s.w
      if (face < 0.02) continue
      let t = 1
      for (let q = 1; q <= 14; q += 1) {
        const d = skip + q * O
        const x = p[0] + s.d[0] * d
        const y = p[1] + s.d[1] * d
        const z = p[2] + s.d[2] * d
        if (hAt(x, z) > y) {
          t = 0
          break
        }
        if (occAt(x, y, z) > 0) t *= 0.35
        if (t < 0.05) break
      }
      sum += t * face * s.w
    }
    let sky = 1
    for (let q = 1; q <= 5; q += 1) if (occAt(p[0], p[1] + skip + q * O, p[2]) > 0) sky *= 0.35
    return clamp01(1.25 * 0.8 * (sum / weights) + 0.2 * sky * (0.5 + 0.5 * n[1]))
  }

  // ------------------------------------------------------------------------------------------------ organisms and frame
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
  /** The ground's own frame at a place: contour (level, across the slope), fall line (level, down the slope), and up. */
  const frameAt = (x: number, z: number) => {
    const gx = (hAt(x + 6, z) - hAt(x - 6, z)) / 12
    const gz = (hAt(x, z + 6) - hAt(x, z - 6)) / 12
    const fall: V = Math.hypot(gx, gz) > 1e-3 ? norm([-gx, 0, -gz]) : [0, 0, 1]
    const contour: V = [-fall[2], 0, fall[0]]
    return { fall, contour }
  }

  const nodes: NetNode[] = []
  const hashCell = 6
  const hash = new Map<number, number[]>()
  const hkey = (x: number, y: number, z: number) => (Math.floor(x / hashCell) + 512) * 1048576 + (Math.floor(y / hashCell) + 512) * 1024 + (Math.floor(z / hashCell) + 512)
  const addNode = (org: number, pos: V, size: number, parent: number, role: Role, round: number, yaw: number): NetNode => {
    const par = parent >= 0 ? nodes[parent]! : null
    const n: NetNode = { id: nodes.length, org, pos, size, parent, fused: -1, role, birth: round, hops: par ? par.hops + 1 : 0, root: par ? par.root : nodes.length, flow: 0, yaw, ext: [0, 0, 0, 0, 0, 0], light: 0 }
    nodes.push(n)
    const key = hkey(pos[0], pos[1], pos[2])
    ;(hash.get(key) ?? hash.set(key, []).get(key)!).push(n.id)
    occMark(pos, size * 1.3)
    return n
  }
  const near = (p: V, r: number, visit: (n: NetNode) => void) => {
    const c = Math.ceil(r / hashCell)
    const bx = Math.floor(p[0] / hashCell)
    const by = Math.floor(p[1] / hashCell)
    const bz = Math.floor(p[2] / hashCell)
    for (let i = -c; i <= c; i += 1) for (let j = -c; j <= c; j += 1) for (let k = -c; k <= c; k += 1) for (const id of hash.get((bx + i + 512) * 1048576 + (by + j + 512) * 1024 + (bz + k + 512)) ?? []) visit(nodes[id]!)
  }
  const ancestors = (id: number, depth: number): Set<number> => {
    const out = new Set<number>()
    for (let n = id, d = 0; n >= 0 && d < depth; n = nodes[n]!.parent, d += 1) {
      out.add(n)
      if (nodes[n]!.fused >= 0) out.add(nodes[n]!.fused)
    }
    return out
  }

  type Tip = { node: number; org: number; dir: V; size: number; role: Role; sinceFork: number; dark: number; run: number; alive: boolean }
  const tips: Tip[] = []
  let fusions = 0
  let rootCount = 0
  const frames = nuclei.map((f) => frameAt(f.x, f.z))
  nuclei.forEach((f, org) => {
    // Three rooted primaries around the nucleus, a little apart.
    for (let r = 0; r < 3; r += 1) {
      const a = r * 2.399963 + org
      const x = f.x + Math.cos(a) * 7
      const z = f.z + Math.sin(a) * 7
      const n = addNode(org, [x, hAt(x, z) - 1, z], 3.3, -1, PRIMARY, 0, Math.atan2(frames[org]!.contour[2], frames[org]!.contour[0]))
      n.root = n.id
      rootCount += 1
      tips.push({ node: n.id, org, dir: [0, 1, 0], size: 3.3, role: PRIMARY, sinceFork: 0, dark: 0, run: 0, alive: true })
    }
  })

  const headings = (org: number): V[] => {
    const { fall, contour } = frames[org]!
    const out: V[] = []
    for (let k = 0; k < 8; k += 1) {
      const a = (k * Math.PI) / 4
      out.push(norm([contour[0] * Math.cos(a) + fall[0] * Math.sin(a), 0, contour[2] * Math.cos(a) + fall[2] * Math.sin(a)]))
    }
    return out
  }
  const HCH = 60

  // ------------------------------------------------------------------------------------------------ growth
  for (let round = 1; round <= ROUNDS; round += 1) {
    const born: Tip[] = []
    for (const tip of tips) {
      if (!tip.alive || nodes.length > 2600) continue
      const node = nodes[tip.node]!
      const p = node.pos
      const len = 2.4 * tip.size
      const level = headings(tip.org)
      const cands: V[] = [...level, [0, 1, 0], tip.dir]
      if (tip.role === SUPPORT) cands.push([0, -1, 0])
      const h = p[1] - hAt(p[0], p[2])
      // The nearest member, not close kin, that would give a shorter way to the ground.
      let pull: V | null = null
      if (tip.role !== SUPPORT) {
        const kin = ancestors(tip.node, 8)
        let bd = Infinity
        near(p, 18, (o) => {
          if (kin.has(o.id) || o.org !== tip.org) return
          const d = Math.hypot(o.pos[0] - p[0], o.pos[1] - p[1], o.pos[2] - p[2])
          if (d < bd && d > 1 && o.hops + 2 < node.hops) {
            bd = d
            pull = norm(sub(o.pos, p))
          }
        })
      }
      let best: V = tip.dir
      let bestScore = -Infinity
      let bestLight = 0
      for (const c of cands) {
        const probe: V = [p[0] + c[0] * len, p[1] + c[1] * len, p[2] + c[2] * len]
        const clear = probe[1] - hAt(probe[0], probe[2])
        if (tip.role !== SUPPORT && clear < 1.5 * tip.size) continue
        if (Math.hypot(probe[0] - sx, probe[2] - sz) > HALF - 8) continue
        const light = irradiance(probe, [0, 1, 0], tip.size * 1.2)
        const crowd = occAt(probe[0], probe[1], probe[2])
        let score = 1.5 * light - 0.9 * crowd + 0.8 * dot(c, tip.dir)
        if (tip.role === PRIMARY) score += 1.1 * c[1] * (1 - h / HCH)
        else if (tip.role === LATERAL) score += 0.7 * (1 - Math.abs(c[1])) + 0.25 * Math.abs(c[0] * frames[tip.org]!.contour[0] + c[2] * frames[tip.org]!.contour[2])
        else score += 2.2 * -c[1] - 0.8 * light
        if (pull) score += 0.5 * dot(c, pull)
        if (score > bestScore) {
          bestScore = score
          best = c
          bestLight = light
        }
      }
      if (bestScore === -Infinity) {
        tip.alive = false
        continue
      }
      tip.dark = bestLight < 0.15 && tip.role !== SUPPORT ? tip.dark + 1 : 0
      if (tip.dark >= 2) {
        tip.alive = false
        continue
      }
      const dir = norm([best[0] * 0.65 + tip.dir[0] * 0.35, best[1] * 0.65 + tip.dir[1] * 0.35, best[2] * 0.65 + tip.dir[2] * 0.35])
      const next: V = [p[0] + dir[0] * len, p[1] + dir[1] * len, p[2] + dir[2] * len]
      const yaw = Math.abs(dir[1]) > 0.8 ? Math.atan2(frames[tip.org]!.contour[2], frames[tip.org]!.contour[0]) : Math.atan2(dir[2], dir[0])
      const g = hAt(next[0], next[2])
      const grounded = tip.role === SUPPORT && next[1] - g < 1.2 * tip.size
      if (grounded) next[1] = g - 1
      const child = addNode(tip.org, next, tip.size, tip.node, tip.role, round, yaw)
      if (grounded) {
        child.root = child.id
        child.hops = 0
        rootCount += 1
        tip.alive = false
        continue
      }
      // Fusion: the tip meets another member's surface that would shorten its path to a root (or reaches a different root).
      const kin = ancestors(child.id, 6)
      let fuse: NetNode | null = null
      let fd = Infinity
      near(next, 14, (o) => {
        if (kin.has(o.id) || o.id === child.id) return
        const d = Math.hypot(o.pos[0] - next[0], o.pos[1] - next[1], o.pos[2] - next[2])
        const reach = 0.9 * (child.size + o.size) + 2.5
        if (d < reach && d < fd && (o.hops + 1 < child.hops * 0.7 || o.root !== child.root)) {
          fd = d
          fuse = o
        }
      })
      if (fuse && tip.role !== SUPPORT) {
        child.fused = (fuse as NetNode).id
        fusions += 1
        tip.alive = false
        continue
      }
      tip.node = child.id
      tip.dir = dir
      tip.size *= tip.role === SUPPORT ? 0.97 : tip.role === PRIMARY ? 0.93 : 0.92
      tip.sinceFork += 1
      tip.run = tip.role === LATERAL ? tip.run + len : 0
      if (tip.size < 1.1 && tip.role !== SUPPORT) tip.alive = false
      // A support: a lateral that has run farther than a member of its size can reach goes down to the ground.
      if (tip.role === LATERAL && tip.run > 4.2 * tip.size + 6 && !born.some((b) => b.node === child.id)) {
        tip.run = 0
        born.push({ node: child.id, org: tip.org, dir: [0, -1, 0], size: Math.max(1.4, tip.size * 0.95), role: SUPPORT, sinceFork: 0, dark: 0, run: 0, alive: true })
      }
      // A fork: where the tip is well lit and there is room, a lateral leaves at a clear angle to its heading.
      const every = Math.max(2, Math.round(5.5 - tip.size))
      if (tip.role !== SUPPORT && tip.size > 1.4 && tip.sinceFork >= every && bestLight > 0.35) {
        let fork: V | null = null
        let fs = -Infinity
        for (const c of level) {
          if (dot(c, dir) > 0.5) continue
          const probe: V = [next[0] + c[0] * len, next[1], next[2] + c[2] * len]
          const s = 1.5 * irradiance(probe, [0, 1, 0], tip.size * 1.2) - 0.9 * occAt(probe[0], probe[1], probe[2])
          if (s > fs) {
            fs = s
            fork = c
          }
        }
        if (fork && fs > 0.4) {
          tip.sinceFork = 0
          born.push({ node: child.id, org: tip.org, dir: fork, size: tip.size * 0.78, role: LATERAL, sinceFork: 0, dark: 0, run: 0, alive: true })
        }
      }
    }
    tips.push(...born)
  }

  // ------------------------------------------------------------------------------------------------ flow and size
  const peakFlow = nodes.map(() => 0)
  const isTip = nodes.map(() => true)
  for (const n of nodes) if (n.parent >= 0) isTip[n.parent] = false
  const total: number[] = nodes.map((_, i) => (isTip[i] ? 1 : 0))
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const n = nodes[i]!
    peakFlow[i] = total[i]!
    if (n.parent >= 0) {
      if (n.fused >= 0) {
        total[n.parent] = total[n.parent]! + total[i]! * 0.5
        total[n.fused] = total[n.fused]! + total[i]! * 0.5
      } else total[n.parent] = total[n.parent]! + total[i]!
    }
  }
  for (const n of nodes) {
    n.flow = peakFlow[n.id]!
    n.size = Math.max(n.size * 0.8, 0.9 + 0.5 * Math.pow(n.flow, 0.42))
  }

  // ------------------------------------------------------------------------------------------------ differential accretion
  const wet = nodes.map((n) => moistureAt(n.pos[0], n.pos[2]))
  // The floor: a box reaches back over its edge to its parent and forward over a fusion, so members are continuous.
  for (const n of nodes) {
    const base = 0.6 * n.size
    n.ext = [base, base, base, base, base, base]
    if (n.parent >= 0) {
      const p = nodes[n.parent]!
      const dx = n.pos[0] - p.pos[0]
      const dy = n.pos[1] - p.pos[1]
      const dz = n.pos[2] - p.pos[2]
      const horiz = Math.hypot(dx, dz)
      if (horiz > 0.5 * Math.abs(dy)) n.ext[1] = Math.max(n.ext[1], 0.55 * horiz + 0.3)
      if (dy > 0) n.ext[3] = Math.max(n.ext[3], 0.55 * dy + 0.3)
      else n.ext[2] = Math.max(n.ext[2], 0.55 * -dy + 0.3)
      if (Math.abs(dy) > 0.7 * Math.hypot(dx, dy, dz)) n.ext[3] = Math.max(n.ext[3], 0.55 * Math.abs(dy) + 0.3)
    }
    if (n.fused >= 0) {
      const o = nodes[n.fused]!
      n.ext[0] = Math.max(n.ext[0], Math.hypot(o.pos[0] - n.pos[0], o.pos[2] - n.pos[2]) + 0.4)
      const dy = o.pos[1] - n.pos[1]
      if (dy > 0) n.ext[2] = Math.max(n.ext[2], dy + 0.4)
      else n.ext[3] = Math.max(n.ext[3], -dy + 0.4)
    }
  }
  const axes = (n: NetNode): { f: V; u: V; s: V } => {
    const f: V = [Math.cos(n.yaw), 0, Math.sin(n.yaw)]
    return { f, u: [0, 1, 0], s: [-f[2], 0, f[0]] }
  }
  const markAll = () => {
    occ = new Float32Array(NXo * NYo * NXo)
    for (const n of nodes) occMark(n.pos, Math.max(n.ext[0], n.ext[1], n.ext[4], n.ext[5], n.ext[2], n.ext[3]))
  }
  const CAP = 3.4
  for (let shell = 1; shell <= SHELLS; shell += 1) {
    markAll()
    const grow: number[][] = nodes.map(() => [0, 0, 0, 0, 0, 0])
    for (const n of nodes) {
      const { f, s } = axes(n)
      const unit = 0.35 * n.size
      const reach = Math.max(...n.ext)
      const topPoint: V = [n.pos[0], n.pos[1] + n.ext[2], n.pos[2]]
      const lTop = irradiance(topPoint, [0, 1, 0], reach)
      if (shell === 1) n.light = lTop
      grow[n.id]![2] = 0.9 * lTop * unit
      const dirs: [number, V][] = [[0, f], [1, [-f[0], 0, -f[2]]], [4, s], [5, [-s[0], 0, -s[2]]]]
      for (const [slot, d] of dirs) {
        const ext = n.ext[slot]!
        const point: V = [n.pos[0] + d[0] * ext, n.pos[1], n.pos[2] + d[2] * ext]
        const lSide = irradiance(point, [d[0], 0.15, d[2]], reach)
        grow[n.id]![slot] = 0.7 * (0.3 + lSide) * (0.6 + 0.8 * wet[n.id]!) * unit
      }
      // Underside: little, but down to ground that is near.
      const below = n.pos[1] - n.ext[3] - hAt(n.pos[0], n.pos[2])
      grow[n.id]![3] = below < 6 + n.size ? Math.max(0, below) * 0.6 : 0.08 * unit
    }
    // Gaps: a face looking at another box across less than the bridging distance grows toward it.
    for (const n of nodes) {
      const a = axes(n)
      const bridge = 3.5 + 0.8 * n.size
      const faces: [number, V][] = [[0, a.f], [1, [-a.f[0], 0, -a.f[2]]], [2, a.u], [3, [0, -1, 0]], [4, a.s], [5, [-a.s[0], 0, -a.s[2]]]]
      for (const [slot, d] of faces) {
        const here = n.ext[slot]!
        let gap = Infinity
        near(n.pos, bridge + 14, (o) => {
          if (o.id === n.id) return
          const rx = o.pos[0] - n.pos[0]
          const ry = o.pos[1] - n.pos[1]
          const rz = o.pos[2] - n.pos[2]
          const along = rx * d[0] + ry * d[1] + rz * d[2]
          if (along <= 0) return
          const lateral = Math.hypot(rx - d[0] * along, ry - d[1] * along, rz - d[2] * along)
          if (lateral > 0.8 * (n.size + o.size) + 1) return
          const other = Math.max(...o.ext) * 0.6
          const g = along - here - other
          if (g > 0 && g < gap) gap = g
        })
        if (gap <= bridge) grow[n.id]![slot] = Math.max(grow[n.id]![slot]!, 0.5 * gap)
      }
    }
    for (const n of nodes) {
      for (let k = 0; k < 6; k += 1) n.ext[k] = Math.min(CAP * n.size + 2, n.ext[k]! + grow[n.id]![k]!)
    }
  }

  // ------------------------------------------------------------------------------------------------ surface
  const grownAt = performance.now()
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const n of nodes) {
    const r = Math.max(...n.ext) + 2
    minX = Math.min(minX, n.pos[0] - r)
    minY = Math.min(minY, n.pos[1] - r)
    minZ = Math.min(minZ, n.pos[2] - r)
    maxX = Math.max(maxX, n.pos[0] + r)
    maxY = Math.max(maxY, n.pos[1] + r)
    maxZ = Math.max(maxZ, n.pos[2] + r)
  }
  const fx = Math.floor(minX)
  const fy = Math.floor(minY)
  const fz = Math.floor(minZ)
  const dx = Math.ceil(maxX - fx) + 2
  const dy = Math.ceil(maxY - fy) + 2
  const dz = Math.ceil(maxZ - fz) + 2
  const field = new Float32Array(dx * dy * dz).fill(-4)
  const fidx = (x: number, y: number, z: number) => (z * dy + y) * dx + x
  for (const n of nodes) {
    const c = Math.cos(n.yaw)
    const sn = Math.sin(n.yaw)
    // The box: ahead/behind along the heading, up/down, and across both ways.
    const hu = (n.ext[0] + n.ext[1]) / 2
    const cu = (n.ext[0] - n.ext[1]) / 2
    const hv = (n.ext[2] + n.ext[3]) / 2
    const cv = (n.ext[2] - n.ext[3]) / 2
    const hw = (n.ext[4] + n.ext[5]) / 2
    const cw = (n.ext[4] - n.ext[5]) / 2
    const radius = Math.hypot(Math.max(n.ext[0], n.ext[1]), Math.max(n.ext[4], n.ext[5])) + 2
    const x0 = Math.max(0, Math.floor(n.pos[0] - radius - fx))
    const x1 = Math.min(dx - 1, Math.ceil(n.pos[0] + radius - fx))
    const z0 = Math.max(0, Math.floor(n.pos[2] - radius - fz))
    const z1 = Math.min(dz - 1, Math.ceil(n.pos[2] + radius - fz))
    const y0 = Math.max(0, Math.floor(n.pos[1] - n.ext[3] - 2 - fy))
    const y1 = Math.min(dy - 1, Math.ceil(n.pos[1] + n.ext[2] + 2 - fy))
    for (let z = z0; z <= z1; z += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const rx = fx + x - n.pos[0]
          const ry = fy + y - n.pos[1]
          const rz = fz + z - n.pos[2]
          const lu = rx * c + rz * sn
          const lw = -rx * sn + rz * c
          const sd = Math.max(Math.abs(lu - cu) - hu, Math.abs(ry - cv) - hv, Math.abs(lw - cw) - hw)
          const v = Math.min(4, -sd)
          if (v > field[fidx(x, y, z)]!) field[fidx(x, y, z)] = v
        }
      }
    }
  }
  for (let z = 0; z < dz; z += 1) {
    for (let x = 0; x < dx; x += 1) {
      const g = hAt(fx + x, fz + z) - 1.2
      for (let y = 0; y < dy && fy + y < g; y += 1) field[fidx(x, y, z)] = -4
    }
  }

  const ISO = 0
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

  // The material's growth record per vertex, from the nearest nodes.
  const maxFlow = Math.max(1, ...nodes.map((n) => n.flow))
  const count = positions.length / 3
  const colours = new Float32Array(positions.length)
  const recordA = new Float32Array(count * 4)
  const recordB = new Float32Array(count * 4)
  const tones = [0.97, 1.0, 1.03]
  for (let v = 0; v < count; v += 1) {
    const p: V = [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!]
    let best: NetNode | null = null
    let bd = Infinity
    let wsum = 0
    let birth = 0
    let stress = 0
    let rib = 0
    let light = 0
    let dep = 0
    near(p, 9, (n) => {
      const dd = (n.pos[0] - p[0]) ** 2 + (n.pos[1] - p[1]) ** 2 + (n.pos[2] - p[2]) ** 2
      const w = 1 / (1 + dd / (n.size * n.size))
      wsum += w
      birth += w * n.birth
      stress += w * clamp01(n.flow / maxFlow)
      rib += w * clamp01(n.flow / maxFlow)
      light += w * n.light
      dep += w * clamp01((n.ext[0] + n.ext[2] + n.ext[4]) / (3 * CAP * n.size))
      if (dd < bd) {
        bd = dd
        best = n
      }
    })
    const k = wsum > 0 ? 1 / wsum : 0
    const org = best ? (best as NetNode).org : 0
    const up = p[1] - hAt(p[0], p[2])
    recordA.set([(birth * k) / ROUNDS, 0.6, stress * k, rib * k], v * 4)
    recordB.set([light * k, moistureAt(p[0], p[2]) * (1 - smoothstep(0, 8, up)), best ? (((best as NetNode).id * 2654435761) >>> 0) / 4294967296 : 0.5, dep * k], v * 4)
    const colour = skin(Math.max(0, up), 0.3, tones[org % 3]!, 0)
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

  // Solid volume and where it stands (for the report): inside cells, in 10 m height bands above the site.
  let inside = 0
  const bands: Record<number, number> = {}
  for (let z = 0; z < dz; z += 1) {
    for (let y = 0; y < dy; y += 1) {
      for (let x = 0; x < dx; x += 1) {
        if (field[fidx(x, y, z)]! > ISO) {
          inside += 1
          const b = Math.floor((fy + y - cy) / 10) * 10
          bands[b] = (bands[b] ?? 0) + 1
        }
      }
    }
  }
  let top = cy
  for (const n of nodes) top = Math.max(top, n.pos[1] + n.ext[2])
  const sizes = nodes.map((n) => n.size).sort((a, b) => a - b)
  const graph: NetGraph = { nodes, fusions, roots: rootCount }
  livingArchitecture.graph = graph
  livingArchitecture.version += 1
  const stats = {
    experiment: 5,
    nodes: nodes.length,
    edges: nodes.filter((n) => n.parent >= 0).length + fusions,
    fusions,
    roots: rootCount,
    primaries: nodes.filter((n) => n.role === PRIMARY).length,
    laterals: nodes.filter((n) => n.role === LATERAL).length,
    supports: nodes.filter((n) => n.role === SUPPORT).length,
    sizeMin: Math.round(sizes[0]! * 10) / 10,
    sizeMedian: Math.round(sizes[Math.floor(sizes.length / 2)]! * 10) / 10,
    sizeMax: Math.round(sizes[sizes.length - 1]! * 10) / 10,
    solidVolume: inside,
    ...Object.fromEntries(Object.entries(bands).map(([b, c]) => [`band${b}`, c])),
    vertices: count,
    triangles: indices.length / 3,
    height: Math.round(top - cy),
    growMs: Math.round(grownAt - started),
    milliseconds: Math.round(performance.now() - started),
  }
  return { geometry, site: [sx, sz], ground: cy, organisms: nuclei.length, height: top - cy, stats, graph }
}
