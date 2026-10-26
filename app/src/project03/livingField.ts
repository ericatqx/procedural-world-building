import { BufferAttribute, BufferGeometry } from 'three'
import { sunAt } from '../project/sun.ts'
import { clamp01, smoothstep } from '../project02/core.ts'
import { prevailingWind } from './environment.ts'
import { islandRadius, landscapeHeight } from './terrain.ts'
import { chooseSite, cross, dot, lerp, livingArchitecture, norm, skin, sub, waterDistance, type Colony, type V } from './livingArchitecture.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — Living Architecture, Volumetric P1: growth as a field.
 *
 * A representation test, not an ecology. There are no cells to choose, no strands and no economy. The organism is a smooth
 * density ρ (0 empty, 1 solid) on a 2 m grid, and the surface (ρ = 0.5) moves by the rule below for a fixed number of steps.
 *
 *   ∂ρ/∂t = F · 4ρ(1−ρ) + γ (mean of the six neighbours − ρ)
 *
 * The first term moves the surface outward at a speed F, and acts only on the interface (ρ between 0 and 1). The second is
 * diffusion: a surface tension. It rounds sharp corners and removes a protrusion thinner than a few cells, so γ sets the
 * smallest feature the organism can have (about 4–6 m here); it is the one place where a minimum feature scale is written down.
 *
 * The speed F at a point on the surface is the product of three fields, with one global rule and no site tuning:
 *
 *   orientation  by which way the surface faces (its outward normal n from −∇ρ): 1.0 for a top face, 0.55 for a side, 0.12 for an underside
 *   light        the day's sun arc on that face (n·s), shaded by the terrain and by the mass itself, plus a little sky
 *   moisture     exp(−d/λ), d the distance through the mass from the nearest ground contact (λ = 45 m): the ground feeds it, and
 *                the mass carries the supply, so growth thins out with distance from the ground along the mass
 *
 * Nothing grows below the ground. Three solid columns, 4 m wide and 6 m tall, stand at the Grown2 nuclei and start it.
 * A face in shadow does not advance, so what the mass shades stops growing: that is the only source of negative space.
 *
 * Options: `steps` (default 150), `yawDeg` (rotates the whole grid about the site, to check for alignment to the grid),
 * `variation` (shifts the starting columns and sizes them a little). The page reads them from the URL: ?steps=60&yaw=30&v=1.
 */

const C = 2
const HALF = 130
const TOP = 1.0
const SIDE = 0.55
const BOTTOM = 0.12
const LAMBDA = 45
const DT = 1.5
const GAMMA = 0.12

export type FieldOptions = { steps?: number; yawDeg?: number; variation?: number }
export type FieldGraph = { nx: number; ny: number; nz: number; rho: Float32Array; birth: Float32Array; yaw: number; pivot: [number, number]; oy: number; steps: number }
export type GrownField = Colony & { graph: FieldGraph }

export function fieldOptionsFromUrl(): FieldOptions {
  if (typeof location === 'undefined') return {}
  const q = new URLSearchParams(location.search)
  const num = (k: string) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : undefined)
  return { steps: num('steps'), yawDeg: num('yaw'), variation: num('v') }
}

export function growField(world: World, seed: number, options: FieldOptions = {}): GrownField {
  const started = performance.now()
  const STEPS = Math.max(5, Math.min(400, Math.round(options.steps ?? 150)))
  const yaw = ((options.yawDeg ?? 0) * Math.PI) / 180
  const variation = options.variation ?? 0
  const [sx, sz] = chooseSite(world, seed)
  const cy = landscapeHeight(sx, sz)
  const cs = Math.cos(yaw)
  const sn = Math.sin(yaw)
  const toWorld = (lx: number, lz: number): [number, number] => [sx + cs * lx - sn * lz, sz + sn * lx + cs * lz]
  const toLocal = (wx: number, wz: number): [number, number] => [cs * (wx - sx) + sn * (wz - sz), -sn * (wx - sx) + cs * (wz - sz)]

  // ------------------------------------------------------------------------------------------------ terrain
  const TS = 4
  const hOrigin = 192
  const side = (hOrigin * 2) / TS + 1
  const heights = new Float32Array(side * side)
  let minH = Infinity
  for (let i = 0; i < side; i += 1) {
    for (let j = 0; j < side; j += 1) {
      const h = landscapeHeight(sx - hOrigin + j * TS, sz - hOrigin + i * TS)
      heights[i * side + j] = h
      minH = Math.min(minH, h)
    }
  }
  const hAt = (x: number, z: number): number => {
    const u = (x - (sx - hOrigin)) / TS
    const w = (z - (sz - hOrigin)) / TS
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
    return d[1] > 0.12 ? [{ w: 0.4 + d[1], world: d as V, local: [cs * d[0] + sn * d[2], d[1], -sn * d[0] + cs * d[2]] as V }] : []
  })
  const heading = (prevailingWind(seed) * Math.PI) / 180
  const wind: V = [Math.cos(heading), 0, Math.sin(heading)]

  // ------------------------------------------------------------------------------------------------ grid
  const NX = (HALF * 2) / C
  const NZ = NX
  const oy = Math.floor(minH) - 4
  const NY = Math.ceil((cy + 110 - oy) / C)
  const N = NX * NY * NZ
  const lox = -HALF
  const loz = -HALF
  const at = (i: number, j: number, k: number) => (j * NZ + k) * NX + i
  const cxl = (i: number) => lox + (i + 0.5) * C
  const czl = (k: number) => loz + (k + 0.5) * C
  const cyw = (j: number) => oy + (j + 0.5) * C
  // Ground height under each column's centre.
  const gH = new Float32Array(NX * NZ)
  for (let k = 0; k < NZ; k += 1) {
    for (let i = 0; i < NX; i += 1) {
      const [wx, wz] = toWorld(cxl(i), czl(k))
      gH[k * NX + i] = hAt(wx, wz)
    }
  }
  const airAt = (i: number, j: number, k: number) => cyw(j) >= gH[k * NX + i]! + 0.2 * C
  const rho = new Float32Array(N)
  const next = new Float32Array(N)
  const birth = new Float32Array(N).fill(-1)
  const lightF = new Float32Array(N)
  const dist = new Float32Array(N).fill(1e6)

  // ------------------------------------------------------------------------------------------------ nuclei
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
          for (let q = 1; q <= 12; q += 1) if (hAt(x + s.world[0] * q * 6, z + s.world[2] * q * 6) > hAt(x, z) + 8 + s.world[1] * q * 6) t = 0
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
  const r0 = 4 + 0.5 * variation
  const regions = nuclei.map((f, idx) => {
    const [lx, lz] = toLocal(f.x + variation * 7 * (idx + 1), f.z + variation * 11 * (idx - 1))
    const ci = Math.floor((lx - lox) / C)
    const ck = Math.floor((lz - loz) / C)
    const r = Math.ceil((2.5 * r0) / C)
    for (let k = ck - r; k <= ck + r; k += 1) {
      for (let i = ci - r; i <= ci + r; i += 1) {
        if (i < 1 || k < 1 || i >= NX - 1 || k >= NZ - 1) continue
        const d = Math.hypot(cxl(i) - lx, czl(k) - lz)
        const prof = 1 / (1 + Math.exp(-(r0 - d) / 1.2))
        for (let j = 1; j < NY - 1; j += 1) {
          const h = cyw(j) - gH[k * NX + i]!
          if (h < 0.2 * C || h > 9) continue
          const cap = 1 / (1 + Math.exp((h - 6) / 1.0))
          rho[at(i, j, k)] = Math.max(rho[at(i, j, k)]!, prof * cap)
        }
      }
    }
    return { i0: ci - r - 3, i1: ci + r + 3, j0: 1, j1: NY - 2, k0: ck - r - 3, k1: ck + r + 3 }
  })
  for (let q = 0; q < N; q += 1) if (rho[q]! > 0.5) birth[q] = 0

  // ------------------------------------------------------------------------------------------------ stepping
  const lightAt = (i: number, j: number, k: number, n: V): number => {
    const px = i + 0.5
    const py = j + 0.5
    const pz = k + 0.5
    let sum = 0
    let weights = 0
    for (const s of sun) {
      const facing = n[0] * s.local[0] + n[1] * s.local[1] + n[2] * s.local[2]
      weights += s.w
      if (facing < 0.02) continue
      let t = 1
      for (let q = 2; q <= 24; q += 1) {
        const x = px + s.local[0] * q
        const y = py + s.local[1] * q
        const z = pz + s.local[2] * q
        const ii = Math.floor(x)
        const jj = Math.floor(y)
        const kk = Math.floor(z)
        if (ii < 0 || kk < 0 || jj < 0 || ii >= NX || kk >= NZ || jj >= NY) break
        if (cyw(jj) < gH[kk * NX + ii]!) {
          t = 0
          break
        }
        if (rho[at(ii, jj, kk)]! > 0.5) t *= 0.3
        if (t < 0.05) break
      }
      sum += t * facing * s.w
    }
    let sky = 1
    for (let q = 2; q <= 10; q += 1) if (j + q < NY && rho[at(i, j + q, k)]! > 0.5) sky *= 0.3
    return clamp01(1.25 * 0.8 * (sum / weights) + 0.2 * sky * (0.5 + 0.5 * n[1]))
  }
  const queue = new Int32Array(N)
  const refreshDistance = () => {
    // Distance, in metres, through the solid from the nearest ground contact.
    let head = 0
    let tail = 0
    for (const r of regions) {
      for (let k = r.k0; k <= r.k1; k += 1) {
        for (let j = r.j0; j <= r.j1; j += 1) {
          for (let i = r.i0; i <= r.i1; i += 1) {
            const q = at(i, j, k)
            dist[q] = 1e6
            if (rho[q]! > 0.5 && cyw(j) - gH[k * NX + i]! < 1.15 * C) {
              dist[q] = 0
              queue[tail++] = q
            }
          }
        }
      }
    }
    while (head < tail) {
      const q = queue[head++]!
      const i = q % NX
      const k = Math.floor(q / NX) % NZ
      const j = Math.floor(q / (NX * NZ))
      const d = dist[q]! + C
      for (let n = 0; n < 6; n += 1) {
        const ni = i + (n === 0 ? 1 : n === 1 ? -1 : 0)
        const nj = j + (n === 2 ? 1 : n === 3 ? -1 : 0)
        const nk = k + (n === 4 ? 1 : n === 5 ? -1 : 0)
        if (ni < 1 || nk < 1 || nj < 1 || ni >= NX - 1 || nk >= NZ - 1 || nj >= NY - 1) continue
        const m = at(ni, nj, nk)
        if (rho[m]! > 0.5 && dist[m]! > d) {
          dist[m] = d
          queue[tail++] = m
        }
      }
    }
  }

  const stageEvery = Math.max(1, Math.floor(STEPS / 5))
  const stageSolid: number[] = []
  for (let step = 1; step <= STEPS; step += 1) {
    if (step % 4 === 1) refreshDistance()
    const relight = step % 3 === 1
    for (const r of regions) {
      let ni0 = Infinity
      let ni1 = -Infinity
      let nj0 = Infinity
      let nj1 = -Infinity
      let nk0 = Infinity
      let nk1 = -Infinity
      const bi0 = Math.max(1, r.i0)
      const bi1 = Math.min(NX - 2, r.i1)
      const bj0 = Math.max(1, r.j0)
      const bj1 = Math.min(NY - 2, r.j1)
      const bk0 = Math.max(1, r.k0)
      const bk1 = Math.min(NZ - 2, r.k1)
      for (let k = bk0; k <= bk1; k += 1) {
        for (let j = bj0; j <= bj1; j += 1) {
          for (let i = bi0; i <= bi1; i += 1) {
            const q = at(i, j, k)
            const v = rho[q]!
            const xm = rho[q - 1]!
            const xp = rho[q + 1]!
            const ym = rho[q - NX * NZ]!
            const yp = rho[q + NX * NZ]!
            const zm = rho[q - NX]!
            const zp = rho[q + NX]!
            let out = v + GAMMA * ((xm + xp + ym + yp + zm + zp) / 6 - v)
            if (v > 0.02 && v < 0.98 && airAt(i, j, k)) {
              const gx = (xp - xm) * 0.5
              const gy = (yp - ym) * 0.5
              const gz = (zp - zm) * 0.5
              const g = Math.hypot(gx, gy, gz)
              if (g > 0.02) {
                const n: V = [-gx / g, -gy / g, -gz / g]
                if (relight) lightF[q] = lightAt(i, j, k, n)
                const top = Math.max(0, n[1])
                const bottom = Math.max(0, -n[1])
                const ori = TOP * top + BOTTOM * bottom + SIDE * (1 - Math.abs(n[1]))
                // Supply: through the solid beside this cell from the ground.
                let d = 1e6
                const around = [q - 1, q + 1, q - NX * NZ, q + NX * NZ, q - NX, q + NX]
                for (const m of around) if (dist[m]! < d) d = dist[m]!
                const moist = Math.exp(-(d + C) / LAMBDA)
                out += DT * ori * lightF[q]! * moist * 4 * v * (1 - v)
              }
            }
            if (!airAt(i, j, k)) out = 0
            if (out < 0) out = 0
            else if (out > 1) out = 1
            next[q] = out
            if (out > 0.5 && birth[q]! < 0) birth[q] = step
            if (out > 0.01) {
              if (i < ni0) ni0 = i
              if (i > ni1) ni1 = i
              if (j < nj0) nj0 = j
              if (j > nj1) nj1 = j
              if (k < nk0) nk0 = k
              if (k > nk1) nk1 = k
            }
          }
        }
      }
      for (let k = bk0; k <= bk1; k += 1) {
        for (let j = bj0; j <= bj1; j += 1) {
          const row = at(0, j, k)
          for (let i = bi0; i <= bi1; i += 1) rho[row + i] = next[row + i]!
        }
      }
      if (ni0 <= ni1) {
        r.i0 = ni0 - 3
        r.i1 = ni1 + 3
        r.j0 = Math.max(1, nj0 - 3)
        r.j1 = Math.min(NY - 2, nj1 + 3)
        r.k0 = nk0 - 3
        r.k1 = nk1 + 3
      }
    }
    if (step % stageEvery === 0 || step === STEPS) {
      let solid = 0
      for (const r of regions) for (let k = Math.max(1, r.k0); k <= Math.min(NZ - 2, r.k1); k += 1) for (let j = Math.max(1, r.j0); j <= Math.min(NY - 2, r.j1); j += 1) for (let i = Math.max(1, r.i0); i <= Math.min(NX - 2, r.i1); i += 1) if (rho[at(i, j, k)]! > 0.5) solid += 1
      stageSolid.push(solid)
    }
  }

  // ------------------------------------------------------------------------------------------------ surface
  const grownAt = performance.now()
  let bi0 = Infinity
  let bi1 = -Infinity
  let bj0 = Infinity
  let bj1 = -Infinity
  let bk0 = Infinity
  let bk1 = -Infinity
  let solidCells = 0
  for (let k = 0; k < NZ; k += 1) {
    for (let j = 0; j < NY; j += 1) {
      for (let i = 0; i < NX; i += 1) {
        const v = rho[at(i, j, k)]!
        if (v > 0.2) {
          if (i < bi0) bi0 = i
          if (i > bi1) bi1 = i
          if (j < bj0) bj0 = j
          if (j > bj1) bj1 = j
          if (k < bk0) bk0 = k
          if (k > bk1) bk1 = k
        }
        if (v > 0.5) solidCells += 1
      }
    }
  }
  if (bi0 > bi1) return { geometry: new BufferGeometry(), site: [sx, sz], ground: cy, organisms: nuclei.length, height: 0, stats: { cells: 0 }, graph: { nx: NX, ny: NY, nz: NZ, rho, birth, yaw, pivot: [sx, sz], oy, steps: STEPS } }
  // Fine grid at 1 m in the local frame, the density interpolated trilinearly from the 2 m grid.
  const FX = lox + (bi0 - 1) * C
  const FY = oy + (bj0 - 1) * C
  const FZ = loz + (bk0 - 1) * C
  const dx = (bi1 - bi0 + 3) * C + 1
  const dy = (bj1 - bj0 + 3) * C + 1
  const dz = (bk1 - bk0 + 3) * C + 1
  const field = new Float32Array(dx * dy * dz)
  const fidx = (x: number, y: number, z: number) => (z * dy + y) * dx + x
  const sample = (lx: number, ly: number, lz: number): number => {
    const u = (lx - lox) / C - 0.5
    const v = (ly - oy) / C - 0.5
    const w = (lz - loz) / C - 0.5
    const i = Math.floor(u)
    const j = Math.floor(v)
    const k = Math.floor(w)
    if (i < 0 || j < 0 || k < 0 || i >= NX - 1 || j >= NY - 1 || k >= NZ - 1) return 0
    const fu = u - i
    const fv = v - j
    const fw = w - k
    const a = (jj: number, kk: number) => lerp(rho[at(i, jj, kk)]!, rho[at(i + 1, jj, kk)]!, fu)
    const b = (jj: number) => lerp(a(jj, k), a(jj, k + 1), fw)
    return lerp(b(j), b(j + 1), fv)
  }
  for (let z = 0; z < dz; z += 1) {
    for (let y = 0; y < dy; y += 1) {
      for (let x = 0; x < dx; x += 1) {
        const lx = FX + x
        const ly = FY + y
        const lz = FZ + z
        const [wx, wz] = toWorld(lx, lz)
        field[fidx(x, y, z)] = ly < hAt(wx, wz) - 1.2 ? 0 : sample(lx, ly, lz)
      }
    }
  }
  const ISO = 0.5
  const vertexOf = new Int32Array((dx - 1) * (dy - 1) * (dz - 1)).fill(-1)
  const vidx = (x: number, y: number, z: number) => (z * (dy - 1) + y) * (dx - 1) + x
  const positions: number[] = []
  const normals: number[] = []
  const locals: number[] = []
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
        const nl = norm([-gx, -gy, -gz])
        const lx = FX + x + px / count
        const ly = FY + y + py / count
        const lz = FZ + z + pz / count
        const [wx, wz] = toWorld(lx, lz)
        vertexOf[vidx(x, y, z)] = positions.length / 3
        positions.push(wx, ly, wz)
        locals.push(lx, ly, lz)
        normals.push(cs * nl[0] - sn * nl[2], nl[1], sn * nl[0] + cs * nl[2])
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

  // The material's growth record: when the nearest cell turned solid, and the light on the face as it grew.
  const count = positions.length / 3
  const colours = new Float32Array(positions.length)
  const recordA = new Float32Array(count * 4)
  const recordB = new Float32Array(count * 4)
  for (let v = 0; v < count; v += 1) {
    const lx = locals[v * 3]!
    const ly = locals[v * 3 + 1]!
    const lz = locals[v * 3 + 2]!
    // Search the 3 × 3 × 3 cells around for the nearest solid, born cell.
    const ci = Math.floor((lx - lox) / C)
    const cj = Math.floor((ly - oy) / C)
    const ck = Math.floor((lz - loz) / C)
    let b = 0
    let l = 0.5
    let bd = Infinity
    for (let a = -1; a <= 1; a += 1) {
      for (let c = -1; c <= 1; c += 1) {
        for (let d = -1; d <= 1; d += 1) {
          const ii = ci + a
          const jj = cj + c
          const kk = ck + d
          if (ii < 0 || jj < 0 || kk < 0 || ii >= NX || jj >= NY || kk >= NZ) continue
          const q = at(ii, jj, kk)
          if (birth[q]! < 0) continue
          const dd = (cxl(ii) - lx) ** 2 + (cyw(jj) - ly) ** 2 + (czl(kk) - lz) ** 2
          if (dd < bd) {
            bd = dd
            b = birth[q]!
            l = lightF[q]! > 0 ? lightF[q]! : l
          }
        }
      }
    }
    const up = ly - hAt(positions[v * 3]!, positions[v * 3 + 2]!)
    recordA.set([b / STEPS, 0.6, 0, 0], v * 4)
    recordB.set([l, moistureAt(positions[v * 3]!, positions[v * 3 + 2]!) * (1 - smoothstep(0, 8, up)), (((ci * 73856093) ^ (cj * 19349663) ^ (ck * 83492791)) >>> 0) / 4294967296, 0.5], v * 4)
    const colour = skin(Math.max(0, up), 0.3, 1, 0)
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
  for (let q = 0; q < positions.length; q += 3) top = Math.max(top, positions[q + 1]!)
  const graph: FieldGraph = { nx: NX, ny: NY, nz: NZ, rho, birth, yaw, pivot: [sx, sz], oy, steps: STEPS }
  livingArchitecture.graph = graph
  livingArchitecture.version += 1
  const stats = {
    experiment: 6,
    steps: STEPS,
    yawDeg: Math.round((yaw * 180) / Math.PI),
    variation,
    solidCells,
    solidVolume: solidCells * C * C * C,
    ...Object.fromEntries(stageSolid.map((s, i) => [`stage${i}`, s])),
    vertices: count,
    triangles: indices.length / 3,
    height: Math.round(top - cy),
    growMs: Math.round(grownAt - started),
    milliseconds: Math.round(performance.now() - started),
  }
  return { geometry, site: [sx, sz], ground: cy, organisms: nuclei.length, height: top - cy, stats, graph }
}
