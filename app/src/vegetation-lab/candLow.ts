import { aim, Geo, grow, mix, v3, type V } from './geo.ts'
import { barkColour, broadLeaf, frond, leafColour, PAL, spray, tangentAt } from './parts.ts'
import { compact, condition, gapward, grownAt, hardening, juvenile, mature, NEEDS, ramp, senescent, windward } from './ecology.ts'
import type { Candidate, PlantParams } from './types.ts'

type R = () => number

// ------------------------------------------------------------------------------------------------ understory shrubs
const canes: Candidate['build'] = (g, p, r) => {
  const c = condition(p, NEEDS.understory!)
  const mt = mature(p.age)
  // A young plant has a few unbranched canes; basal canes are added as it matures (clonal renewal), fewer in poor conditions and
  // on the windward side.
  const n = Math.max(2, Math.round((2 + 8 * mt) * (0.4 + 0.6 * c.vigor) * (1 - 0.4 * c.waterlog)))
  for (let i = 0; i < n; i += 1) {
    const hd = (i / n) * 6.283 + (r() - 0.5) * 0.5
    if (windward(p, hd) > 0.55 && r() < 0.7) continue
    const start: V = [Math.cos(hd) * 0.1, 0, Math.sin(hd) * 0.1]
    // Moderate shade stretches canes toward the light and leans them to the gap; open sun keeps them short and stout.
    const stretch = 1 + 0.6 * 4 * c.dim * (1 - c.dim) + 0.3 * c.dim
    const len = (0.08 + 2.24 * grownAt(p.age)) * stretch * (0.5 + 0.5 * c.vigor) * compact(p) * gapward(c, hd) * (0.75 + 0.5 * r())
    const up = 1.3 - 0.5 * c.dim * (0.6 + 0.4 * r())
    const path = grow(start, aim(hd, up), len, 12, (t) => [p.wind * 0.01 * (0.6 + t) + Math.cos(hd) * 0.02 * t * t, -(0.012 + 0.09 * c.dim) * t * t - 0.018 * t, Math.sin(hd) * 0.015 * t * t])
    g.tube(path, (t) => 0.026 * hardening(p) * (1 - t) ** 0.7 * (1 - 0.2 * c.dim) + 0.004, barkColour, 5)
    // Leaves in alternating pairs. Drought and deep shade drop the lower ones; full sun adds second-order shoots.
    const pairs = Math.round(len / 0.09)
    const from = 3 + Math.round(pairs * 0.4 * (c.drought + 0.5 * c.dim))
    for (let k = from; k < pairs; k += 1) {
      const t = k / pairs
      const at = path[Math.min(path.length - 1, Math.floor(t * (path.length - 1)))]!
      const tan = tangentAt(path, t)
      const side = v3.norm(v3.cross(tan, [0, 1, 0]))
      for (const sd of [-1, 1]) {
        const d = v3.norm(v3.add(v3.add(v3.mul(side, sd), v3.mul(tan, 0.35)), [0, 0.1, 0]))
        const spent = senescent(p.age) > 0.45 && (k + i) % 5 === 0 ? 0.4 : 1
        const sideScale = sd < 0 ? 0.88 : 1.05
        broadLeaf(g, at, d, (0.22 + 0.18 * (1 - c.drought)) * (0.55 + 0.9 * Math.sin(Math.PI * t * 0.9)) * (1 + 0.25 * c.dim) * sideScale * (0.7 + 0.3 * mt) * spent, (0.07 + 0.05 * (1 - c.drought)) * (1 + 0.35 * c.dim) * sideScale, 0.85, r, { wind: p.wind, warm: spent < 1 ? 0.75 : 0.22 })
      }
    }
    const laterals = Math.round(3 * mt * (1 - c.dim) * c.vigor)
    for (let l = 0; l < laterals; l += 1) {
      const f = 0.45 + 0.4 * (l / Math.max(1, laterals))
      const at = path[Math.floor(f * (path.length - 1))]!
      const lp = grow(at, aim(hd + (l % 2 ? 1 : -1) * 1.2, 0.7), len * 0.3, 6, () => [p.wind * 0.01, -0.04, 0])
      g.tube(lp, (t) => 0.008 * (1 - t) + 0.002, barkColour, 4)
      for (let k = 1; k < 5; k += 1) broadLeaf(g, lp[k]!, aim(hd + k, 0.4), 0.2, 0.07, 0.8, r, { wind: p.wind })
    }
    spray(g, path[path.length - 1]!, tangentAt(path, 1), r, { count: 6, len: 0.38 * (1 - 0.3 * c.drought), spread: 0.8, droop: 1.0, width: 0.09, warm: 0.4, wind: p.wind })
  }
}

const coppice: Candidate['build'] = (g, p, r) => {
  const c = condition(p, NEEDS.scrub!)
  const mt = mature(p.age)
  // A coppicing shrub adds shoots from its base as it ages. Shade gives fewer, longer, sparser shoots; sun gives short, leafy,
  // many-branched ones; wind compacts and thickens them.
  const n = Math.max(3, Math.round((3 + 22 * mt) * (0.4 + 0.6 * c.vigor) * (1 - 0.35 * c.waterlog)))
  for (let i = 0; i < n; i += 1) {
    const hd = r() * 6.283
    if (windward(p, hd) > 0.6 && r() < 0.6) continue
    const reachOut = 0.15 + 0.35 * r()
    const len = (0.06 + 1.1 * grownAt(p.age)) * (0.55 + 0.8 * r()) * compact(p) * (1 + 0.5 * 4 * c.dim * (1 - c.dim)) * (0.5 + 0.5 * c.vigor)
    const path = grow([Math.cos(hd) * 0.05, 0, Math.sin(hd) * 0.05], v3.norm([Math.cos(hd) * reachOut, 1, Math.sin(hd) * reachOut]), len, 8, (t) => [p.wind * 0.025 * t + Math.cos(hd) * 0.045 * t * t, 0.02 * p.light * (1 - t) - 0.055 * t * t, Math.sin(hd) * 0.045 * t * t])
    g.tube(path, (t) => 0.014 * hardening(p) * (1 - 0.7 * t) * (1 - 0.3 * c.dim) + 0.003, barkColour, 5)
    const whorls = Math.round(len / 0.07)
    const density = (0.25 + 0.75 * p.light) * (1 - 0.7 * c.drought) * (0.5 + 0.5 * c.vigor)
    for (let k = 2; k < whorls; k += 1) {
      if (r() > density) continue
      const t = k / whorls
      const at = path[Math.min(path.length - 1, Math.floor(t * (path.length - 1)))]!
      const m = 3 + Math.floor(r() * 2)
      const ph = r() * 6.283
      const sen = senescent(p.age)
      const spent = sen > 0.45 && i % 5 === 0 ? 0.35 : 1
      for (let q = 0; q < m; q += 1) {
        const a = ph + (q / m) * 6.283 + 0.2 * Math.sin(q + i)
        const lift = 0.22 + 0.75 * r()
        broadLeaf(g, at, v3.norm([Math.cos(a) * (0.85 + 0.25 * (q % 2)), lift * (q % 2 === 0 ? 0.65 : 1.1), Math.sin(a)]), (0.16 + 0.12 * (1 - c.drought)) * (0.65 + 0.55 * r()) * (0.82 + 0.3 * ((q + i) % 3) / 2) * spent, 0.075, 0.8, r, { wind: p.wind, warm: spent < 1 ? 0.7 : 0.12 })
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------ ground cover
const rosette: Candidate['build'] = (g, p, r) => {
  const c = condition(p, NEEDS.fern!)
  const jv = juvenile(p.age)
  // A young fern has a few small fronds with short, simple pinnae; a mature crown has many large ones. Drought drops and shortens
  // the outer fronds; shade lays them out flat; wind keeps the whole crown low.
  const n = Math.max(3, Math.round((3 + 16 * p.age) * (0.4 + 0.6 * c.vigor)))
  for (let i = 0; i < n; i += 1) {
    const hd = (i / n) * 6.283 * 2.4 + r() * 0.3
    const outer = i / n
    const lift = 1.35 - 0.6 * c.dim - 0.4 * p.wind
    const len = (0.12 + 0.55 * p.age) * (0.5 + 0.5 * c.vigor) * (0.55 + 0.7 * outer) * (0.8 + 0.4 * r()) * (1 - 0.35 * c.drought * outer) * (1 + 0.3 * c.dim)
    const sen = senescent(p.age)
    const spent = sen > 0.4 && outer > 0.55
    frond(g, [Math.cos(hd) * 0.012, 0.012, Math.sin(hd) * 0.012], aim(hd, lift * (0.65 + 0.35 * r())), len * (spent ? 0.6 : 1) * (0.92 + 0.16 * Math.sin(i * 1.3)), spent ? 0.95 + 0.35 * c.drought : 0.65 + 0.75 * c.dim + 0.4 * c.drought, (0.11 + 0.08 * (1 - c.drought)) * (1 - 0.45 * jv), r, p.wind, spent ? 0.72 : 0.12)
  }
}

const stolons: Candidate['build'] = (g, p, r) => {
  const c = condition(p, NEEDS.mat!)
  const mt = mature(p.age)
  // Foraging growth: on good ground a stolon plant packs short internodes and branches often (it stays and exploits); on poor
  // ground it sends out long sparse runners to find better. Age adds runners and a second order of branching.
  const rich = c.vigor
  const spacing = 0.05 + 0.1 * (1 - rich)
  const runners = Math.max(2, Math.round((2 + 5 * p.age) * (0.5 + 0.5 * rich)))
  const run = (start: V, hd: number, len: number, depth: number) => {
    let phi = hd
    let at = start
    const steps = Math.max(3, Math.round(len / spacing))
    const pts: V[] = [at]
    for (let s = 0; s < steps; s += 1) {
      phi += (r() - 0.5) * 0.75
      at = v3.add(at, [Math.cos(phi) * spacing, 0, Math.sin(phi) * spacing])
      pts.push([at[0], 0.01 + 0.012 * Math.sin(s * 1.7 + phi), at[2]])
      if (s % 2 === 1 && rich > 0.15) {
        const a = phi + (s % 4 === 1 ? 1 : -1) * (0.7 + 0.4 * r())
        const spent = senescent(p.age) > 0.45 && s % 4 === 1 ? 0.45 : 1
        const R = (0.045 + 0.08 * rich) * (0.7 + 0.55 * r()) * (1 - 0.3 * c.drought) * spent
        const ctr = v3.add(pts[pts.length - 1]!, [Math.cos(a) * R * 0.45, 0.018, Math.sin(a) * R * 0.45])
        g.tube([pts[pts.length - 1]!, ctr], () => 0.0022, () => PAL.barkPale, 3)
        const pads = 5
        for (let k = 0; k < pads; k += 1) {
          const q = (k / pads) * 6.283 + 0.5 * Math.sin(k * 1.7 + s)
          const reach = R * (0.5 + 0.55 * Math.abs(Math.sin(k * 2.2 + 0.4)))
          const tip: V = [ctr[0] + Math.cos(q) * reach, ctr[1] + 0.008 + 0.02 * ((k % 3) / 2), ctr[2] + Math.sin(q) * reach]
          const mid = v3.lerp(ctr, tip, 0.42)
          mid[1] += 0.008 + 0.012 * (k % 2)
          g.ribbon([ctr, mid, tip], (u) => reach * (0.38 + 0.16 * (k % 2)) * Math.sin(Math.PI * Math.min(1, u * 0.85 + 0.14)) ** 0.75, (u) => leafColour(0.18 + 0.7 * u, spent < 1 ? 0.55 : 0.12 + 0.08 * ((s + k) % 3)), [0, 1, 0], () => 0, 'leaf')
        }
      }
      if (depth > 0 && r() < (0.03 + 0.2 * rich * p.light) * (0.4 + 0.6 * mt)) run(pts[pts.length - 1]!, phi + (r() < 0.5 ? 1 : -1) * (0.7 + 0.5 * r()), len * 0.5, depth - 1)
    }
    g.tube(pts, () => 0.004, () => PAL.barkPale, 4)
  }
  for (let i = 0; i < runners; i += 1) run([0, 0.014, 0], (i / runners) * 6.283 + r() * 0.4, (0.2 + 0.9 * p.age) * (1 + 0.8 * (1 - rich)) * (0.7 + 0.5 * r()), p.age > 0.5 ? 1 : 0)
}

/** A weathered slab with a crevice running along z: the ground the cushion grows on. Returns its surface height. */
function crevice(g: Geo, r: R): (x: number, z: number) => number {
  const phase = r() * 10
  const top = (x: number, z: number) => 0.12 + 0.025 * Math.sin(x * 9 + phase) * Math.cos(z * 7 - phase) + 0.03 * Math.sin(x * 3 + z * 4 + phase) - 0.07 * Math.exp(-(((x - 0.02 * Math.sin(z * 5)) / 0.035) ** 2))
  const N = 28
  const base = g.pos.length / 3
  for (let j = 0; j <= N; j += 1) {
    for (let i = 0; i <= N; i += 1) {
      const x = -0.45 + (0.9 * i) / N
      const z = -0.45 + (0.9 * j) / N
      g.pos.push(x, top(x, z), z)
      const c = mix(PAL.rock, PAL.rockPale, 0.15 + 0.2 * Math.sin(x * 11 + z * 9 + phase)).map((v) => v * 0.4) as [number, number, number]
      g.col.push(c[0], c[1], c[2])
    }
  }
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const a = base + j * (N + 1) + i
      g.idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2)
    }
  }
  return top
}

/** Crustose patches on the rock: lobed, pale, sharing the crevice with the moss. Drawn after the cushion so it does not reshuffle the shoots. */
function lichen(g: Geo, r: R, top: (x: number, z: number) => number) {
  const patches = 3 + Math.floor(r() * 3)
  for (let p = 0; p < patches; p += 1) {
    const cx = (r() - 0.5) * 0.62
    const cz = (r() - 0.5) * 0.62
    const lobes = 5 + Math.floor(r() * 4)
    const R = 0.028 + r() * 0.055
    const tint = mix(mix(PAL.bone, PAL.clay, 0.2 + 0.45 * r()), PAL.leafPale, 0.12 * r())
    for (let k = 0; k < lobes; k += 1) {
      const a = (k / lobes) * 6.283 + 0.45 * Math.sin(k * 2.1 + p)
      const reach = R * (0.4 + 0.75 * Math.abs(Math.sin(k * 1.8 + p)))
      const x2 = cx + Math.cos(a) * reach
      const z2 = cz + Math.sin(a) * reach * (0.75 + 0.35 * (k % 2))
      const y0 = top(cx, cz) + 0.003
      const y1 = top(x2, z2) + 0.003
      g.ribbon([[cx, y0, cz], [(cx + x2) / 2, (y0 + y1) / 2 + 0.002, (cz + z2) / 2], [x2, y1, z2]], (t) => reach * (0.5 + 0.15 * Math.sin(k)) * (1 - 0.25 * t), (t) => mix(tint, PAL.barkPale, 0.15 * t), [0, 1, 0], () => 0, 'leaf')
    }
  }
}

const cushion: Candidate['build'] = (g, p, r) => {
  const c = condition(p, NEEDS.moss!)
  const top = crevice(g, r)
  const sen = senescent(p.age)
  // A moss cushion grows outward from where it started as it ages, and merges with its neighbours. The outline is lobed, not a disc.
  // Dry, it flattens and thins; damp and shaded, it domes; wind keeps it low and dense. Late in life the shoots shorten and warm.
  const clumps = 2 + Math.round(4 * p.age * (0.5 + 0.5 * c.vigor))
  for (let k = 0; k < clumps; k += 1) {
    const along = k / Math.max(1, clumps - 1)
    const cz0 = -0.3 + 0.6 * along + (r() - 0.5) * 0.12
    const cx0 = Math.sin(k * 2.15 + 0.4) * (0.06 + 0.12 * p.age)
    const R = (0.045 + 0.2 * p.age) * (0.4 + 0.6 * c.vigor) * (0.72 + 0.5 * r())
    const hmax = (0.04 + 0.12 * p.light) * (1 - 0.55 * c.drought) * (1 - 0.5 * p.wind) * (0.4 + 0.6 * p.age) * (1 - 0.4 * sen)
    const n = Math.round((50 + 220 * p.age) * (0.3 + 0.7 * c.vigor) * (sen > 0.2 ? 1 - 0.35 * sen : 1))
    for (let i = 0; i < n; i += 1) {
      const a = r() * 6.283
      const lobe = 0.72 + 0.32 * Math.sin(a * 3 + k * 1.4)
      const rad = R * Math.sqrt(r()) * lobe
      const x = cx0 + Math.cos(a) * rad * (0.7 + 0.12 * Math.sin(a * 2))
      const z = cz0 + Math.sin(a) * rad * (1.05 + 0.2 * Math.cos(a * 2.4))
      const d = Math.min(1, (rad / Math.max(0.02, R)) ** 2)
      const dir = v3.norm([(x - cx0) * 2.4 + 0.35 * Math.sin(a * 5), 0.9 - 0.62 * d, (z - cz0) * 1.15])
      const base: V = [x, top(x, z), z]
      const len = hmax * (1 - 0.72 * d) * (0.55 + 0.7 * r()) + 0.02
      const width = 0.012 + 0.012 * ((i * 0.37) % 1)
      const path = grow(base, dir, len, 3, () => [p.wind * 0.06, -0.06 - 0.14 * c.drought - 0.05 * sen, 0])
      g.ribbon(path, (t) => width * (1 - t * 0.7), (t) => mix(mix(PAL.leafDeep, PAL.leafPale, 0.2 + 0.75 * t * (1 - d * 0.35)), PAL.clay, 0.45 * c.drought * t + 0.4 * sen * (0.25 + 0.75 * d)), [0, 1, 0], () => r() * 6)
    }
  }
  lichen(g, r, top)
}

// ------------------------------------------------------------------------------------------------ clinging plants
const WALL = { w: 1.3, h: 1.4 }
/** A wall of rock or of Living Architecture, facing +z. Returns the surface's depth at (x, y). */
function wall(g: Geo, p: PlantParams, r: R): (x: number, y: number) => number {
  const phase = r() * 10
  if (p.bare) return () => 0
  const z = (x: number, y: number) =>
    p.surface === 'rock'
      ? 0.06 * Math.sin(x * 5 + phase) * Math.cos(y * 4 - phase) + 0.03 * Math.sin(x * 13 + y * 9 + phase) - 0.05 * Math.exp(-(((x - 0.1 - 0.05 * Math.sin(y * 4)) / 0.03) ** 2))
      : 0.03 * Math.sin(y * 14 + Math.sin(x * 3 + phase) * 1.3) + 0.07 * Math.cos(x * 2.2 + phase * 0.3)
  const NX = 30
  const NY = 36
  const base = g.pos.length / 3
  for (let j = 0; j <= NY; j += 1) {
    for (let i = 0; i <= NX; i += 1) {
      const x = -WALL.w / 2 + (WALL.w * i) / NX
      const y = (WALL.h * j) / NY
      g.pos.push(x, y, z(x, y))
      const c = (p.surface === 'rock' ? mix(PAL.rock, PAL.rockPale, 0.2 + 0.15 * Math.sin(x * 9 + y * 7 + phase)) : mix(PAL.bone, PAL.barkPale, 0.3 + 0.2 * Math.sin(y * 14 + phase))).map((v) => v * (p.surface === 'rock' ? 0.55 : 0.62)) as [number, number, number]
      g.col.push(c[0], c[1], c[2])
    }
  }
  for (let j = 0; j < NY; j += 1) {
    for (let i = 0; i < NX; i += 1) {
      const a = base + j * (NX + 1) + i
      g.idx.push(a, a + 1, a + NX + 1, a + 1, a + NX + 2, a + NX + 1)
    }
  }
  return z
}

const vine: Candidate['build'] = (g, p, r) => {
  const zAt = wall(g, p, r)
  const c = condition(p, NEEDS.vine!)
  const jv = juvenile(p.age)
  const mt = mature(p.age)
  // Ivy-like heteroblasty: the juvenile is a slender climber with small leaves pressed flat to the surface; the adult has larger
  // leaves held off it, and side shoots. Light and moisture set how far it climbs; on rock it follows the crevice, where there is
  // water; on smooth architecture it needs more adhesive roots.
  const climb = (0.2 + 1.0 * p.light * c.vigor) * (0.3 + 0.7 * p.age) * (WALL.h / 1.4)
  const rootEvery = p.surface === 'architecture' ? 1 : 3
  const crevX = 0.1
  const run = (x0: number, y0: number, phi0: number, steps: number, depth: number) => {
    let x = x0
    let y = y0
    let phi = phi0
    const pts: V[] = []
    for (let s = 0; s <= steps; s += 1) {
      pts.push([x, y, zAt(x, y) + 0.012])
      phi += (r() - 0.5) * 0.7 + 0.05 * (phi0 - phi) + (p.surface === 'rock' ? 0.25 * Math.sign(crevX - x) * Math.min(1, Math.abs(crevX - x) * 3) * Math.cos(phi) : 0)
      x = Math.max(-WALL.w / 2 + 0.05, Math.min(WALL.w / 2 - 0.05, x + Math.sin(phi) * 0.04))
      y += Math.cos(phi) * 0.04
      if (y > climb || y < 0) break
      const here = pts[pts.length - 1]!
      if (s % rootEvery === 0 && s > 0) g.tube([here, [here[0], here[1] - 0.01, here[2] - 0.012]], () => 0.003, () => PAL.barkPale, 3)
      if (s % 3 === 1) {
        const a = (s % 2 ? 1 : -1) * (0.9 + 0.5 * r())
        const dirv: V = [Math.sin(phi + a), Math.cos(phi + a), 0.03 + 0.25 * mt]
        const size = (0.07 + 0.1 * mt) * (0.5 + 0.5 * c.vigor) * (1 - 0.35 * c.drought)
        const lp = grow(here, dirv, size + 0.04 * p.moisture, 4, (t) => [0, 0, 0.02 + (0.03 * mt + p.wind * 0.12) * t])
        g.ribbon(lp, (u) => 1.15 * size * Math.sin(Math.PI * Math.min(1, u ** 0.7 * 0.95 + 0.08)) ** 0.75 + 0.005, (u) => leafColour(0.2 + 0.7 * u, 0.2), [0, 0, 1], () => 0, 'leaf')
      }
      if (depth > 0 && s > 3 && mt > 0.3 && r() < (0.05 + 0.18 * p.light) * mt) run(x, y, phi + (r() < 0.5 ? 1 : -1) * (0.8 + 0.5 * r()), Math.round(steps * 0.6), depth - 1)
    }
    if (pts.length > 1) g.tube(pts, () => 0.0055 + 0.003 * mt, (t) => barkColour(0.3 + 0.6 * t), 5)
  }
  const stems = 1 + Math.round(2 * mt)
  for (let i = 0; i < stems; i += 1) run((p.surface === 'rock' ? crevX : -0.3) + (stems > 1 ? 0.3 * (i / (stems - 1) - 0.5) : 0) + (r() - 0.5) * 0.1, 0.02, (r() - 0.5) * 0.4, 60, 2)
  void jv
}

const curtain: Candidate['build'] = (g, p, r) => {
  const zAt = wall(g, p, r)
  const c = condition(p, NEEDS.humid!)
  // A pendant epiphyte lives on atmospheric moisture: below a threshold it does not grow at all, and strands lengthen slowly with
  // age and humidity. It is a shade plant: glare thins it.
  const humid = ramp(p.moisture, 0.2, 0.8)
  const n = Math.round((8 + 90 * humid * (0.2 + 0.8 * p.age)) * (0.4 + 0.6 * c.vigor))
  for (let i = 0; i < n; i += 1) {
    const x = -WALL.w / 2 + 0.04 + (WALL.w - 0.08) * r()
    const len = (0.06 + 1.2 * humid * p.age) * (0.5 + 0.8 * r()) * (0.5 + 0.5 * c.vigor) * (WALL.h / 1.4)
    const start: V = [x, WALL.h, zAt(x, WALL.h) + 0.03]
    const path = grow(start, [0.1, -1, 0.15], len, 10, (t) => [p.wind * 0.06 * t, 0, 0.03 * (r() - 0.3)])
    g.ribbon(path, (t) => 0.014 * (1 - 0.5 * t), (t) => mix(PAL.leaf, PAL.leafPale, t), [0, 0, 1], (t) => t * 2)
    for (let k = 2; k < path.length; k += 2) {
      const lp = grow(path[k]!, [(r() - 0.5) * 2, -0.4, 0.5 + r()], 0.08 + 0.05 * humid, 2, () => [p.wind * 0.04, -0.1, 0])
      g.ribbon(lp, (u) => 0.03 * (1 - u * 0.45), (u) => leafColour(0.3 + 0.6 * u, 0.3), [0, 0, 1], () => 0, 'leaf')
    }
  }
}

const brackets: Candidate['build'] = (g, p, r) => {
  const zAt = wall(g, p, r)
  const c = condition(p, NEEDS.tank!)
  const mt = mature(p.age)
  // Tank-rosette habit: a young plant is a single rosette; a mature one has made offsets beside it. In dry air the leaves fold
  // upright and narrow to hold water; in wet air they open out. Rock: the first rosette lodges in the crevice; architecture: on a ridge.
  const sites = 1 + Math.round(6 * mt * (0.4 + 0.6 * c.vigor))
  const rosette = (x: number, y: number, size: number) => {
    const at: V = [x, y, zAt(x, y) + 0.01]
    const n = 8 + Math.round(5 * p.moisture)
    for (let k = 0; k < n; k += 1) {
      const a = (k / n) * 6.283 + r() * 0.3
      const open = 0.35 + 0.65 * p.moisture
      const len = size * (0.8 + 0.5 * r())
      const path = grow(at, [Math.cos(a) * open, Math.sin(a) * open - 0.1, 0.65 + 0.9 * (1 - p.moisture)], len, 6, (t, d) => [p.wind * 0.05 * t, -0.14 * (1 - d[2] * 0.3), -0.12 * t])
      g.ribbon(path, (t) => (0.028 + 0.048 * p.moisture) * Math.sin(Math.PI * Math.min(1, t ** 0.65 * 0.95 + 0.08)) ** 0.72 + 0.004, (t) => leafColour(0.2 + 0.75 * t, 0.35), [0, 0, 1], () => 0, 'leaf')
    }
  }
  const x0 = p.surface === 'rock' ? 0.1 + (r() - 0.5) * 0.2 : -0.3 + 0.6 * r()
  const y0 = p.surface === 'rock' ? 0.3 + 0.5 * r() : Math.min(WALL.h - 0.3, (Math.round((0.3 + 0.4 * r()) * 14 / 6.283) * 6.283 + 1.57) / 14)
  const size0 = (0.14 + 0.2 * p.moisture * (0.4 + 0.6 * p.age)) * (0.6 + 0.4 * c.vigor)
  rosette(x0, y0, size0)
  for (let k = 1; k < sites; k += 1) {
    const a = r() * 6.283
    const d = size0 * (0.9 + 0.8 * r())
    rosette(Math.max(-WALL.w / 2 + 0.1, Math.min(WALL.w / 2 - 0.1, x0 + Math.cos(a) * d * 1.2)), Math.max(0.08, Math.min(WALL.h - 0.1, y0 + Math.sin(a) * d)), size0 * (0.5 + 0.4 * r()))
  }
}

export const LOW: Candidate[] = [
  { id: 'canes', light: 'broad', archetype: 'understory', name: 'Arching canes', size: 2.5, strategy: 'Many canes from one crown, each arching under its own weight and shedding uneven paired leaves, ending in a drooping tuft.', adaptation: 'Age: a few unbranched canes with small leaves, then basal renewal and side shoots. Near the end of the range some leaves shorten and warm. Light: moderate shade stretches and arches them, full sun makes them stout and branched. Drought drops lower leaves; saturation kills canes; the windward side is pruned.', build: canes },
  { id: 'coppice', light: 'sun', archetype: 'understory', name: 'Coppice thicket', size: 2.2, strategy: 'A fan of slim shoots from the base, bowing outward, each sleeved in irregular leaves rather than a regular whorl.', adaptation: 'Age: a few shoots, then many from the base. Near the end of the range some shoots keep only short warm leaves. Shade: fewer, longer, sparser shoots; sun: short and leafy; drought thins the leaves; wind compacts and thickens.', build: coppice },
  { id: 'rosette', light: 'shade', archetype: 'cover', name: 'Fern rosette', size: 0.8, strategy: 'A radial rosette of arching pinnate fronds whose leaflets shorten toward the tip and are staggered along the rachis.', adaptation: 'Age: a few small fronds, then a full crown. Near the end of the range the outer fronds shorten and warm. Drought: fewer, shorter, curling outer fronds; shade lays them flat; wind keeps the crown low.', build: rosette },
  { id: 'stolons', light: 'broad', archetype: 'cover', name: 'Creeping stolon mat', size: 0.6, strategy: 'Meandering runners root and put out uneven pads of overlapping leaves at a node, and occasionally branch.', adaptation: 'Foraging growth: on rich ground, short internodes and frequent branching; on poor or dry ground, fewer, longer, sparser runners. Age adds runners and a second order of branches. Late, some pads shrink and warm.', build: stolons },
  { id: 'cushion', light: 'shade', archetype: 'cover', name: 'Crevice cushion', size: 0.5, strategy: 'Hundreds of short curving shoots form lobed domes along a rock crevice, with pale crustose patches on the stone.', adaptation: 'Age: the cushion spreads outward and clumps merge; late, it thins and warms. Dry: flat and thin; damp: domed and dense; wind keeps it low.', build: cushion },
  { id: 'vine', light: 'broad', archetype: 'epiphyte', name: 'Adhering vine', size: 1.8, surface: true, strategy: 'A stem that follows the surface, leaving flat leaves and adhesive roots, and branching into side runners.', adaptation: 'Age: a slender juvenile with small flat leaves, then an adult with larger leaves held off the surface and side shoots. On rock it follows the crevice; on architecture it needs more adhesive roots. Light and moisture set how far it climbs.', build: vine },
  { id: 'curtain', light: 'shade', archetype: 'epiphyte', name: 'Hanging curtain', size: 1.8, surface: true, strategy: 'Thin strands hang from an edge, each carrying tiny beaded leaves, like a pendant lichen or moss.', adaptation: 'Needs humid air: below a threshold it barely grows, and strands lengthen slowly with age. Glare thins it; wind sways it.', build: curtain },
  { id: 'brackets', light: 'broad', archetype: 'epiphyte', name: 'Bracket rosettes', size: 1.8, surface: true, strategy: 'Separate rosettes of strap leaves grip the wall and curl outward, then droop under their weight.', adaptation: 'Age: a single rosette, then offsets beside it. Dry air: narrow, upright leaves; wet air: open leaves. On rock it lodges in the crevice; on architecture, on a ridge.', build: brackets },
]
