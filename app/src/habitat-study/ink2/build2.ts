import { BufferAttribute, Color, type BufferGeometry } from 'three'
import { inkOf } from '../ink/build.ts'
import { Pen } from '../ink/paper.ts'
import type { StudySite } from '../site.ts'
import { COBALT } from './graphite.ts'

/**
 * Style B v2 — what the Charcoal Notebook adds to v1's material (ink/build.ts, read only): the ground with its occlusion and its shade habitat as
 * attributes, each organism with a baked occlusion, and v1's lines regraded to neutral graphite, those in the shade habitat and at the water's edge
 * drawn in cobalt pencil.
 */
export type Ink2Built = {
  ground: BufferGeometry
  organisms: Map<string, BufferGeometry>
  pens: { medium: Pen; fine: Pen; faint: Pen }
}

const cache = new WeakMap<StudySite, Ink2Built>()
export function ink2Of(site: StudySite): Ink2Built {
  let b = cache.get(site)
  if (!b) {
    const started = performance.now()
    b = build(site)
    console.info('[habitat study] ink2 built', { ms: Math.round(performance.now() - started) })
    cache.set(site, b)
  }
  return b
}

function build(site: StudySite): Ink2Built {
  const v1 = inkOf(site)
  // The ground: charcoal under a roof (the habitat's ceiling: the lower the roof, the deeper), and the shade habitat for the cobalt.
  const ground = v1.ground.clone()
  const pos = ground.getAttribute('position')
  const ao = new Float32Array(pos.count)
  const hab = new Float32Array(pos.count)
  for (let v = 0; v < pos.count; v += 1) {
    const x = pos.getX(v)
    const z = pos.getZ(v)
    const ceiling = site.ceilingAt(x, z)
    ao[v] = Number.isFinite(ceiling) ? 0.95 * (1 - Math.min(1, Math.max(0, (ceiling - 2) / 14))) : 0
    hab[v] = site.shadeAt(x, z)
  }
  // The habitat raster is 3 m cells: softened over a few metres, so the pigment follows the shade's shape, not its grid.
  const n = v1.grid.n
  let soft = hab
  for (let pass = 0; pass < 3; pass += 1) {
    const next = new Float32Array(soft.length)
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        let sum = 0
        let c = 0
        for (let b = -1; b <= 1; b += 1) {
          for (let a = -1; a <= 1; a += 1) {
            const ii = Math.min(n - 1, Math.max(0, i + a))
            const jj = Math.min(n - 1, Math.max(0, j + b))
            sum += soft[jj * n + ii]!
            c += 1
          }
        }
        next[j * n + i] = sum / c
      }
    }
    soft = next
  }
  ground.setAttribute('ao', new BufferAttribute(ao, 1))
  ground.setAttribute('habitat', new BufferAttribute(soft, 1))

  const organisms = new Map<string, BufferGeometry>()
  for (const o of site.organisms) {
    const g = o.geometry.clone()
    g.setAttribute('ao', new BufferAttribute(bakeOcclusion(g, v1.heightAt), 1))
    organisms.set(o.id, g)
  }

  // v1's lines, regraded: neutral greys by their value; cobalt where they lie low in the shade habitat (its plants and its hatching) or on the shore.
  const cobalt = new Color(COBALT)
  const regrade = (pen: Pen) => {
    const out = new Pen(pen.name)
    const c = new Color()
    for (let s = 0; s < pen.pos.length; s += 6) {
      const mx = (pen.pos[s]! + pen.pos[s + 3]!) / 2
      const my = (pen.pos[s + 1]! + pen.pos[s + 4]!) / 2
      const mz = (pen.pos[s + 2]! + pen.pos[s + 5]!) / 2
      const low = my - v1.heightAt(mx, mz) < 2.6
      const shore = v1.level !== null && Math.abs(my - v1.level) < 0.12
      const blue = shore || (low && site.shadeAt(mx, mz) > 0.3)
      for (let q = 0; q < 2; q += 1) {
        const r = pen.col[s + q * 3]!
        const g = pen.col[s + q * 3 + 1]!
        const b = pen.col[s + q * 3 + 2]!
        const l = Math.min(1, (0.3 * r + 0.59 * g + 0.11 * b) * 0.82)
        if (blue) c.copy(cobalt).lerp(new Color(r, g, b), Math.max(0, l - 0.35))
        else c.setRGB(l, l, l)
        out.col.push(c.r, c.g, c.b)
      }
      out.pos.push(...pen.pos.slice(s, s + 6))
    }
    return out
  }
  return { ground, organisms, pens: { medium: regrade(v1.pens.medium), fine: regrade(v1.pens.fine), faint: regrade(v1.pens.faint) } }
}

/** Neutral greys for any of v1's architecture pens (no cobalt on the stone). */
export function grey(pen: Pen): Pen {
  const out = new Pen(pen.name)
  out.pos = pen.pos
  for (let s = 0; s < pen.col.length; s += 3) {
    const l = Math.min(1, (0.3 * pen.col[s]! + 0.59 * pen.col[s + 1]! + 0.11 * pen.col[s + 2]!) * 0.8)
    out.col.push(l, l, l)
  }
  return out
}

/**
 * Occlusion, baked once: the organism's surface marked on a 1 m lattice, and from each vertex a few rays (out along its normal, up, and around)
 * marched through it. The share of rays that meet the organism again, or the ground, is how enclosed the surface is: the undercroft, the shelves'
 * undersides and the clefts come out deep.
 */
function bakeOcclusion(g: BufferGeometry, groundAt: (x: number, z: number) => number): Float32Array {
  const pos = g.getAttribute('position')
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  const nor = g.getAttribute('normal')
  g.computeBoundingBox()
  const box = g.boundingBox!
  const C = 1
  const nx = Math.ceil((box.max.x - box.min.x) / C) + 2
  const ny = Math.ceil((box.max.y - box.min.y) / C) + 2
  const nz = Math.ceil((box.max.z - box.min.z) / C) + 2
  const grid = new Uint8Array(nx * ny * nz)
  const cell = (x: number, y: number, z: number) => {
    const i = Math.floor((x - box.min.x) / C) + 1
    const j = Math.floor((y - box.min.y) / C) + 1
    const k = Math.floor((z - box.min.z) / C) + 1
    return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : (k * ny + j) * nx + i
  }
  for (let v = 0; v < pos.count; v += 1) {
    const c = cell(pos.getX(v), pos.getY(v), pos.getZ(v))
    if (c >= 0) grid[c] = 1
  }
  const dirs: [number, number, number][] = [
    [0, 1, 0],
    [0.7, 0.7, 0],
    [-0.7, 0.7, 0],
    [0, 0.7, 0.7],
    [0, 0.7, -0.7],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, -1, 0],
    [0.7, -0.7, 0],
    [-0.7, -0.7, 0],
    [0, -0.7, 0.7],
    [0, -0.7, -0.7],
  ]
  const out = new Float32Array(pos.count)
  for (let v = 0; v < pos.count; v += 1) {
    const px = pos.getX(v)
    const py = pos.getY(v)
    const pz = pos.getZ(v)
    const n0 = nor.getX(v)
    const n1 = nor.getY(v)
    const n2 = nor.getZ(v)
    let hits = 0
    let rays = 0
    for (const [dx, dy, dz] of [[n0, n1, n2] as [number, number, number], ...dirs]) {
      if (dx * n0 + dy * n1 + dz * n2 < 0.15) continue
      rays += 1
      // Rays reach further toward the ground (a high shelf still roofs what is under it), counting less the further they go.
      for (let t = 1.6; t < (dy < -0.5 ? 32 : 14); t += 1) {
        const x = px + n0 * 0.6 + dx * t
        const y = py + n1 * 0.6 + dy * t
        const z = pz + n2 * 0.6 + dz * t
        if (y < groundAt(x, z)) {
          hits += Math.min(1, Math.max(0.35, (34 - t) / 22))
          break
        }
        const c = cell(x, y, z)
        if (c < 0) break
        if (grid[c]) {
          hits += 1
          break
        }
      }
    }
    out[v] = rays ? hits / rays : 0
  }
  return out
}
