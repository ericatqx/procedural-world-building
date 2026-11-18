import { BufferAttribute, BufferGeometry, Color, ExtrudeGeometry, Shape, Vector2 } from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { landscapeHeight } from '../../project03/terrain.ts'
import { STRIDE } from '../../project03/worldPlants.ts'
import { SITE, type StudySite } from '../site.ts'
import { PAL } from './palette.ts'

/**
 * Style A — the landform: the window's ground redesigned as a sculpted place, on the real terrain's large forms.
 *
 *   ground      the real height low-passed (no small bumps) and its large rolls exaggerated above the lake, kept true near every organism's footing
 *   plinth      the Reference Overhang rises from a stepped stone bench fitted to its footprint: the architecture's ground made deliberate
 *   benches     two tiered rock formations where the real ground is steepest, eroded and leaning uphill, and a low shelf of stone at the shore
 *   pedestal    the window ends in a cut, its strata showing: a diorama on its plinth
 *
 * The colour regions on the ground are the ecology's: sage-teal where the structures keep the sun off for much of the day (the shade habitat),
 * a warm meadow where the grasses gather, pale sand at the water. Nothing here changes where anything grows; it decides how the place is drawn.
 */
export type Poly = [number, number][]
type Tier = { poly: Poly; top: number; bottom: number; kind: 'rock' | 'plinth' }
export type Landform = {
  ground: BufferGeometry
  water: BufferGeometry | null
  rocks: BufferGeometry
  rocksOutline: BufferGeometry
  pedestal: BufferGeometry
  level: number | null
  /** The drawn height at a point: the ground, or the top of a bench or the plinth where one stands. */
  heightAt: (x: number, z: number) => number
  /** True inside a rock formation (nothing grows on the stone). */
  onRock: (x: number, z: number) => boolean
  plinth: Poly | null
}

const STEP = 2
const N = Math.round((SITE.half * 2) / STEP) + 1
const X0 = SITE.cx - SITE.half
const Z0 = SITE.cz - SITE.half

const hash = (a: number, b: number, c: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
  return x - Math.floor(x)
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export function inPoly(p: Poly, x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i]!
    const [xj, zj] = p[j]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

function hull(points: Poly): Poly {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Poly = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Poly = []
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

function chaikin(p: Poly, rounds: number): Poly {
  let out = p
  for (let r = 0; r < rounds; r += 1) {
    const next: Poly = []
    for (let i = 0; i < out.length; i += 1) {
      const a = out[i]!
      const b = out[(i + 1) % out.length]!
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
    }
    out = next
  }
  return out
}

function grow(p: Poly, by: number): Poly {
  const cx = p.reduce((s, q) => s + q[0], 0) / p.length
  const cz = p.reduce((s, q) => s + q[1], 0) / p.length
  return p.map(([x, z]) => {
    const d = Math.hypot(x - cx, z - cz) || 1
    return [x + ((x - cx) / d) * by, z + ((z - cz) / d) * by]
  })
}

/** An eroded outline: a lobed, elongated loop, smoothed. */
function blob(cx: number, cz: number, r: number, aspect: number, axis: number, seed: number): Poly {
  const p: Poly = []
  const k = 16
  for (let i = 0; i < k; i += 1) {
    const a = (i / k) * Math.PI * 2
    const rr = r * (1 + 0.16 * Math.sin(3 * a + seed * 5.1) + 0.09 * Math.sin(5 * a + seed * 2.3) + 0.06 * (hash(seed, i, 3) - 0.5))
    const lx = Math.cos(a) * rr * aspect
    const lz = Math.sin(a) * rr
    p.push([cx + lx * Math.cos(axis) - lz * Math.sin(axis), cz + lx * Math.sin(axis) + lz * Math.cos(axis)])
  }
  return chaikin(p, 2)
}

/**
 * A tier: the outline extruded with a bevelled lip, laid in world space (the shape's y is −z, so the extrusion axis becomes up without mirroring),
 * its top following `top(x, z)` and its foot sunk to `bottom`.
 */
function tierGeometry(poly: Poly, top: (x: number, z: number) => number, bottom: number): BufferGeometry {
  const shape = new Shape(poly.map(([x, z]) => new Vector2(x, -z)))
  const depth = 10
  const bevel = 0.45
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: 0.55, bevelSegments: 2, curveSegments: 4, steps: 1 }).toNonIndexed()
  g.deleteAttribute('uv')
  const pos = g.getAttribute('position')
  for (let v = 0; v < pos.count; v += 1) {
    const sx = pos.getX(v)
    const sy = pos.getY(v)
    const sz = pos.getZ(v)
    const x = sx
    const z = -sy
    const t = sz + bevel
    const span = depth + bevel * 2
    // The lip keeps its true size at the top (the last bevel's metres); the body stretches down to the foot.
    const fromTop = span - t
    const y = fromTop <= bevel * 2.2 ? top(x, z) - fromTop : top(x, z) - bevel * 2.2 - ((fromTop - bevel * 2.2) / (span - bevel * 2.2)) * (top(x, z) - bevel * 2.2 - bottom)
    pos.setXYZ(v, x, y, z)
  }
  g.computeVertexNormals()
  return g
}

export function buildLandform(site: StudySite): Landform {
  const { world, organisms } = site
  const ref = organisms.find((o) => o.index === 0) ?? null
  const depthAt = (x: number, z: number) => world.water.depthAt(x, z)

  // The lake's level, from the nearest wet ground.
  let level: number | null = null
  const dir = site.audit.water.dir
  if (dir && site.audit.water.nearest !== null) {
    for (let d = site.audit.water.nearest; d < site.audit.water.nearest + 30 && level === null; d += 2) {
      const x = SITE.cx + dir[0] * d
      const z = SITE.cz + dir[1] * d
      const w = depthAt(x, z)
      if (w > 0.3) level = landscapeHeight(x, z) + w
    }
  }

  // ---- the ground: low-passed, exaggerated, true at the footings
  const pad = 6
  const M = N + pad * 2
  const raw = new Float32Array(M * M)
  for (let j = 0; j < M; j += 1) for (let i = 0; i < M; i += 1) raw[j * M + i] = landscapeHeight(X0 + (i - pad) * STEP, Z0 + (j - pad) * STEP)
  const blur = (src: Float32Array, r: number) => {
    const tmp = new Float32Array(M * M)
    const out = new Float32Array(M * M)
    for (let j = 0; j < M; j += 1) {
      for (let i = 0; i < M; i += 1) {
        let s = 0
        let c = 0
        for (let k = -r; k <= r; k += 1) {
          const ii = Math.min(M - 1, Math.max(0, i + k))
          s += src[j * M + ii]!
          c += 1
        }
        tmp[j * M + i] = s / c
      }
    }
    for (let j = 0; j < M; j += 1) {
      for (let i = 0; i < M; i += 1) {
        let s = 0
        let c = 0
        for (let k = -r; k <= r; k += 1) {
          const jj = Math.min(M - 1, Math.max(0, j + k))
          s += tmp[jj * M + i]!
          c += 1
        }
        out[j * M + i] = s / c
      }
    }
    return out
  }
  const soft = blur(blur(raw, 3), 3)
  let mean = 0
  let count = 0
  for (let k = 0; k < M * M; k += 1) {
    if (level === null || soft[k]! > level + 1) {
      mean += soft[k]!
      count += 1
    }
  }
  mean /= Math.max(1, count)
  const ground = new Float32Array(N * N)
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const x = X0 + i * STEP
      const z = Z0 + j * STEP
      const k = (j + pad) * M + (i + pad)
      const s = soft[k]!
      const above = level === null ? 1 : smooth(level + 0.5, level + 3, s)
      let h = s + (s - mean) * 0.6 * above
      // Every organism stands on the ground it grew on: its footing and a margin keep the real height.
      for (const o of organisms) {
        const w = smooth(o.radius + 26, o.radius + 6, Math.hypot(x - o.x, z - o.z))
        h += (raw[k]! - h) * w
      }
      ground[j * N + i] = h
    }
  }
  const sampleGround = (x: number, z: number) => {
    const u = Math.min(N - 1.0001, Math.max(0, (x - X0) / STEP))
    const v = Math.min(N - 1.0001, Math.max(0, (z - Z0) / STEP))
    const i = Math.floor(u)
    const j = Math.floor(v)
    const fu = u - i
    const fv = v - j
    const g = (a: number, b: number) => ground[b * N + a]!
    return g(i, j) * (1 - fu) * (1 - fv) + g(i + 1, j) * fu * (1 - fv) + g(i, j + 1) * (1 - fu) * fv + g(i + 1, j + 1) * fu * fv
  }

  // ---- the plinth: two steps of stone fitted to the Reference Overhang's footprint, its top a plane through the real ground there
  const tiers: Tier[] = []
  let plinth: Poly | null = null
  let plane: ((x: number, z: number) => number) | null = null
  if (ref) {
    const foot: Poly = []
    for (const { fields, hab } of site.tiles) {
      const r = fields.region
      for (let j = 0; j < r.n; j += 1) {
        for (let i = 0; i < r.n; i += 1) {
          if (hab.footprint[j * r.n + i]! <= 0) continue
          const x = r.x0 + (i + 0.5) * r.cell
          const z = r.z0 + (j + 0.5) * r.cell
          if (Math.hypot(x - ref.x, z - ref.z) < ref.radius * 2.5) foot.push([x, z])
        }
      }
    }
    if (foot.length >= 3) {
      // Least squares: h = a + b·x + c·z over the footprint's real ground.
      let sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0
      for (const [x0, z0] of foot) {
        const x = x0 - ref.x
        const z = z0 - ref.z
        const h = landscapeHeight(x0, z0)
        sx += x; sz += z; sh += h; sxx += x * x; szz += z * z; sxz += x * z; sxh += x * h; szh += z * h
      }
      const n = foot.length
      const mx = sx / n, mz = sz / n, mh = sh / n
      const cxx = sxx / n - mx * mx, czz = szz / n - mz * mz, cxz = sxz / n - mx * mz, cxh = sxh / n - mx * mh, czh = szh / n - mz * mh
      const det = cxx * czz - cxz * cxz || 1
      const b = (cxh * czz - czh * cxz) / det
      const c = (czh * cxx - cxh * cxz) / det
      const a = mh - b * mx - c * mz
      plane = (x, z) => a + b * (x - ref.x) + c * (z - ref.z)
      const outline = hull(foot)
      const main = chaikin(grow(outline, 4), 3)
      const step = chaikin(grow(outline, 9), 3)
      plinth = step
      let low = Infinity
      for (const [x, z] of step) low = Math.min(low, landscapeHeight(x, z))
      const p = plane
      tiers.push({ poly: step, top: NaN, bottom: low - 4, kind: 'plinth' })
      tiers.push({ poly: main, top: NaN, bottom: low - 4, kind: 'plinth' })
      // The ground under the plinth is held below its top, so the stone is never pierced.
      for (let j = 0; j < N; j += 1) {
        for (let i = 0; i < N; i += 1) {
          const x = X0 + i * STEP
          const z = Z0 + j * STEP
          if (inPoly(step, x, z)) ground[j * N + i] = Math.min(ground[j * N + i]!, p(x, z) - 1.4)
        }
      }
    }
  }

  // ---- the benches: tiered rock where the real ground is steepest, away from the structures, the shade habitat and the water
  const formations: { x: number; z: number }[] = []
  const candidates: { x: number; z: number; score: number; shore: number }[] = []
  for (let z = Z0 + 22; z <= Z0 + SITE.half * 2 - 22; z += 6) {
    for (let x = X0 + 22; x <= X0 + SITE.half * 2 - 22; x += 6) {
      if (depthAt(x, z) > 0) continue
      if (organisms.some((o) => Math.hypot(x - o.x, z - o.z) < o.radius + 24)) continue
      if (site.shadeAt(x, z) > 0.1) continue
      if (plinth && inPoly(grow(plinth, 14), x, z)) continue
      let wet = Infinity
      for (let a = 0; a < 8; a += 1) {
        for (let d = 4; d <= 34; d += 6) {
          if (depthAt(x + Math.cos(a * 0.785) * d, z + Math.sin(a * 0.785) * d) > 0) {
            wet = Math.min(wet, d)
            break
          }
        }
      }
      if (wet < 10) continue
      const slope = Math.atan(Math.hypot(landscapeHeight(x + 3, z) - landscapeHeight(x - 3, z), landscapeHeight(x, z + 3) - landscapeHeight(x, z - 3)) / 6) * 57.3
      candidates.push({ x, z, score: slope + 0.2 * (sampleGround(x, z) - mean) + 3 * hash(x, z, 9), shore: wet })
    }
  }
  candidates.sort((p, q) => q.score - p.score)
  for (const c of candidates) {
    if (formations.length >= 2) break
    if (formations.some((f) => Math.hypot(f.x - c.x, f.z - c.z) < 70)) continue
    formations.push(c)
  }
  formations.forEach((f, fi) => {
    const seed = fi * 13 + 3
    const gx = sampleGround(f.x + 3, f.z) - sampleGround(f.x - 3, f.z)
    const gz = sampleGround(f.x, f.z + 3) - sampleGround(f.x, f.z - 3)
    const up = Math.atan2(gz, gx)
    const r0 = 10 + 5 * hash(seed, 1, 1)
    const heights = [3.4, 2.6, 3.8, 2.2]
    const n = fi === 0 ? 4 : 3
    let top = -Infinity
    for (const [x, z] of blob(f.x, f.z, r0 * 1.1, 1.35, up + 0.6, seed)) top = Math.max(top, sampleGround(x, z))
    for (let k = 0; k < n; k += 1) {
      // Each tier steps back toward the high side and turns a little, so the stack leans and its ledges are unequal: eroded, not turned on a lathe.
      const shrink = 1 - (0.17 + 0.08 * hash(seed, k, 7)) * k
      const lean = (0.32 + 0.1 * hash(seed, k, 8)) * r0 * k
      const side = (hash(seed, k, 6) - 0.5) * 0.5 * r0 * k
      const cx = f.x + Math.cos(up) * lean - Math.sin(up) * side
      const cz = f.z + Math.sin(up) * lean + Math.cos(up) * side
      const poly = blob(cx, cz, r0 * shrink, 1.7 - 0.12 * k, up + 0.6 + 0.35 * k, seed + k)
      top += heights[k]! * (0.85 + 0.3 * hash(seed, k, 5))
      tiers.push({ poly, top, bottom: top - heights[k]! - 30, kind: 'rock' })
    }
  })
  // A low shelf of stone at the shore, along the water's edge.
  if (level !== null && dir) {
    const shore = candidates.filter((c) => c.shore >= 10 && c.shore <= 22 && formations.every((f) => Math.hypot(f.x - c.x, f.z - c.z) > 45)).sort((p, q) => Math.abs(sampleGround(p.x, p.z) - level!) - Math.abs(sampleGround(q.x, q.z) - level!))[0]
    if (shore) {
      const along = Math.atan2(dir[0], -dir[1])
      let top = level + 0.9
      for (const [k, h] of [[0, 0], [1, 0.9]] as const) {
        const poly = blob(shore.x + dir[0] * 4 * k, shore.z + dir[1] * 4 * k, 9 - 2.5 * k, 2.2, along, 77 + k)
        top += h
        tiers.push({ poly, top, bottom: level - 6, kind: 'rock' })
      }
    }
  }

  // ---- geometry of the stone
  const rockParts: BufferGeometry[] = []
  const rockTop = new Color(PAL.rockTop)
  const plinthTop = new Color(PAL.plinthTop)
  const rockA = new Color(PAL.rock)
  const rockB = new Color(PAL.rockAlt)
  const band = new Color(PAL.rockBand)
  const stoneA = new Color(PAL.stone)
  const stoneB = new Color(PAL.stoneAlt)
  const shadeTop = new Color(PAL.shadeGround)
  for (const [ti, t] of tiers.entries()) {
    const topAt = t.kind === 'plinth' ? (x: number, z: number) => plane!(x, z) - (ti === 0 ? 1.1 : 0) : () => t.top
    if (t.kind === 'plinth' && !plane) continue
    const g = tierGeometry(t.poly, topAt, t.bottom)
    const pos = g.getAttribute('position')
    const nor = g.getAttribute('normal')
    const col = new Float32Array(pos.count * 3)
    const c = new Color()
    for (let v = 0; v < pos.count; v += 3) {
      // One colour per face: tops, the lip's band, the riser's strata.
      const y = (pos.getY(v) + pos.getY(v + 1) + pos.getY(v + 2)) / 3
      const x = (pos.getX(v) + pos.getX(v + 1) + pos.getX(v + 2)) / 3
      const z = (pos.getZ(v) + pos.getZ(v + 1) + pos.getZ(v + 2)) / 3
      const ny = (nor.getY(v) + nor.getY(v + 1) + nor.getY(v + 2)) / 3
      const fromTop = topAt(x, z) - y
      if (ny > 0.75) c.copy(t.kind === 'plinth' ? plinthTop : rockTop).lerp(shadeTop, smooth(0.25, 0.45, site.shadeAt(x, z)) * 0.8)
      else if (fromTop < 0.75) c.copy(band)
      else if (t.kind === 'plinth') c.copy(Math.floor((y - t.bottom) / 0.9) % 2 ? stoneA : stoneB)
      else c.copy(Math.floor((y + hash(ti, 0, 1) * 3) / 1.15) % 3 === 0 ? band : Math.floor(y / 1.15) % 2 ? rockA : rockB)
      for (let q = 0; q < 3; q += 1) col.set([c.r, c.g, c.b], (v + q) * 3)
    }
    g.setAttribute('color', new BufferAttribute(col, 3))
    rockParts.push(g)
  }
  const rocks = merge(rockParts)
  const outlineSrc = new BufferGeometry()
  outlineSrc.setAttribute('position', rocks.getAttribute('position').clone())
  const rocksOutline = mergeVertices(outlineSrc, 0.05)
  rocksOutline.computeVertexNormals()

  // ---- where things stand
  const rockTiers = tiers.filter((t) => t.kind === 'rock')
  const plinthTiers = tiers.filter((t) => t.kind === 'plinth')
  const heightAt = (x: number, z: number) => {
    let h = sampleGround(x, z)
    for (const t of rockTiers) if (inPoly(t.poly, x, z)) h = Math.max(h, t.top)
    if (plane) {
      plinthTiers.forEach((t, k) => {
        if (inPoly(t.poly, x, z)) h = Math.max(h, plane!(x, z) - (k === 0 ? 1.1 : 0))
      })
    }
    return h
  }
  const onRock = (x: number, z: number) => rockTiers.some((t) => inPoly(t.poly, x, z))

  // ---- the lake as drawn: the real lake's cells, and the drawn ground below its level that connects to them (a dry hollow elsewhere stays dry)
  const wet = new Uint8Array(N * N)
  const shoreDist = new Float32Array(N * N).fill(Infinity)
  if (level !== null) {
    const queue: number[] = []
    for (let j = 0; j < N; j += 1) {
      for (let i = 0; i < N; i += 1) {
        const k = j * N + i
        if (depthAt(X0 + i * STEP, Z0 + j * STEP) > 0.2 && ground[k]! < level) {
          wet[k] = 1
          queue.push(k)
        }
      }
    }
    for (let q = 0; q < queue.length; q += 1) {
      const k = queue[q]!
      const i = k % N
      for (const nk of [i > 0 ? k - 1 : -1, i + 1 < N ? k + 1 : -1, k - N, k + N]) {
        if (nk < 0 || nk >= N * N || wet[nk] || ground[nk]! >= level) continue
        wet[nk] = 1
        queue.push(nk)
      }
    }
    // Metres from the water, for the pale shore band.
    const ring: number[] = []
    for (let k = 0; k < N * N; k += 1) if (wet[k]) {
      shoreDist[k] = 0
      ring.push(k)
    }
    for (let q = 0; q < ring.length; q += 1) {
      const k = ring[q]!
      const d = shoreDist[k]! + STEP
      if (d > 12) continue
      const i = k % N
      for (const nk of [i > 0 ? k - 1 : -1, i + 1 < N ? k + 1 : -1, k - N, k + N]) {
        if (nk < 0 || nk >= N * N || shoreDist[nk]! <= d) continue
        shoreDist[nk] = d
        ring.push(nk)
      }
    }
  }

  // ---- the ground mesh and its colour regions
  const meadow = meadowField(site)
  const gpos = new Float32Array(N * N * 3)
  const gcol = new Float32Array(N * N * 3)
  const index: number[] = []
  const sand = new Color(PAL.sand)
  const mead = new Color(PAL.meadow)
  const sg = new Color(PAL.shadeGround)
  const deep = new Color(PAL.deepShade)
  const shoreC = new Color(PAL.shore)
  const c = new Color()
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const x = X0 + i * STEP
      const z = Z0 + j * STEP
      const k = j * N + i
      const h = ground[k]!
      gpos.set([x, h, z], k * 3)
      const shade = site.shadeAt(x, z)
      c.copy(sand).lerp(mead, smooth(0.35, 0.55, meadow(x, z)))
      c.lerp(sg, smooth(0.2, 0.3, shade)).lerp(deep, smooth(0.55, 0.7, shade))
      if (level !== null) c.lerp(shoreC, smooth(7, 3, shoreDist[k]!))
      gcol.set([c.r, c.g, c.b], k * 3)
      if (i + 1 < N && j + 1 < N) index.push(k, k + N, k + 1, k + 1, k + N, k + N + 1)
    }
  }
  const groundG = new BufferGeometry()
  groundG.setAttribute('position', new BufferAttribute(gpos, 3))
  groundG.setAttribute('color', new BufferAttribute(gcol, 3))
  groundG.setIndex(index)
  groundG.computeVertexNormals()

  // ---- the water: one flat sheet at the lake's level wherever the drawn ground dips under it
  let water: BufferGeometry | null = null
  if (level !== null) {
    const widx: number[] = []
    for (let j = 0; j + 1 < N; j += 1) {
      for (let i = 0; i + 1 < N; i += 1) {
        const k = j * N + i
        if (wet[k] || wet[k + 1] || wet[k + N] || wet[k + N + 1]) widx.push(k, k + N, k + 1, k + 1, k + N, k + N + 1)
      }
    }
    const wpos = new Float32Array(N * N * 3)
    for (let k = 0; k < N * N; k += 1) wpos.set([gpos[k * 3]!, level, gpos[k * 3 + 2]!], k * 3)
    water = new BufferGeometry()
    water.setAttribute('position', new BufferAttribute(wpos, 3))
    water.setIndex(widx)
    water.computeVertexNormals()
  }

  return { ground: groundG, water, rocks, rocksOutline, pedestal: pedestal(ground, level), level, heightAt, onRock, plinth }
}

/** Where the grasses gather (grass, sedge), as a smooth 0–1 field: the meadow's colour region. */
function meadowField(site: StudySite) {
  const C = 6
  const n = Math.ceil((SITE.half * 2) / C) + 1
  const f = new Float32Array(n * n)
  for (const id of ['grass', 'sedge'] as const) {
    const arr = site.plants.get(id)
    if (!arr) continue
    for (let o = 0; o < arr.length; o += STRIDE) {
      const i = Math.floor((arr[o]! - X0) / C)
      const j = Math.floor((arr[o + 2]! - Z0) / C)
      if (i >= 0 && j >= 0 && i < n && j < n) f[j * n + i]! += 1
    }
  }
  const g = new Float32Array(n * n)
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      let s = 0
      for (let b = -2; b <= 2; b += 1) for (let a = -2; a <= 2; a += 1) s += f[Math.min(n - 1, Math.max(0, j + b)) * n + Math.min(n - 1, Math.max(0, i + a))]!
      g[j * n + i] = Math.min(1, s / 25 / 5)
    }
  }
  return (x: number, z: number) => {
    const u = Math.min(n - 1.001, Math.max(0, (x - X0) / C - 0.5))
    const v = Math.min(n - 1.001, Math.max(0, (z - Z0) / C - 0.5))
    const i = Math.floor(u)
    const j = Math.floor(v)
    const fu = u - i
    const fv = v - j
    return g[j * n + i]! * (1 - fu) * (1 - fv) + g[j * n + i + 1]! * fu * (1 - fv) + g[(j + 1) * n + i]! * (1 - fu) * fv + g[(j + 1) * n + i + 1]! * fu * fv
  }
}

/** The window's cut: its four faces in strata, down to a common foot, with the lake's section where the water reaches the edge. */
function pedestal(ground: Float32Array, level: number | null): BufferGeometry {
  let low = Infinity
  for (const h of ground) low = Math.min(low, h)
  const foot = low - 16
  const pos: number[] = []
  const col: number[] = []
  const bands = [new Color(PAL.rock), new Color(PAL.rockBand), new Color(PAL.rockAlt), new Color(PAL.stoneAlt), new Color('#a85a55')]
  const waterC = new Color(PAL.waterEdge)
  const edges: [number, number, number, number][] = [
    [0, 0, 1, 0],
    [N - 1, 0, 0, 1],
    [N - 1, N - 1, -1, 0],
    [0, N - 1, 0, -1],
  ]
  // Each face's outward side: its quads are wound so they face out of the window.
  for (const [i0, j0, di, dj] of edges) {
    for (let s = 0; s + 1 < N; s += 1) {
      const ia = i0 + di * s
      const ja = j0 + dj * s
      const ib = ia + di
      const jb = ja + dj
      const xa = X0 + ia * STEP
      const za = Z0 + ja * STEP
      const xb = X0 + ib * STEP
      const zb = Z0 + jb * STEP
      const ha = ground[ja * N + ia]!
      const hb = ground[jb * N + ib]!
      const quad = (ya0: number, ya1: number, yb0: number, yb1: number, c: Color) => {
        pos.push(xa, ya0, za, xb, yb0, zb, xa, ya1, za, xa, ya1, za, xb, yb0, zb, xb, yb1, zb)
        for (let q = 0; q < 6; q += 1) col.push(c.r, c.g, c.b)
      }
      const H = 2.4
      for (let y = foot; y < Math.max(ha, hb); y += H) {
        const c = bands[Math.floor((y - foot) / H + 0.5) % bands.length]!
        quad(y, Math.min(y + H, ha), y, Math.min(y + H, hb), c)
      }
      if (level !== null && (ha < level || hb < level)) quad(Math.min(ha, level), level, Math.min(hb, level), level, waterC)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  g.computeVertexNormals()
  return g
}

export function merge(parts: BufferGeometry[]): BufferGeometry {
  let total = 0
  for (const p of parts) total += p.getAttribute('position').count
  const pos = new Float32Array(total * 3)
  const nor = new Float32Array(total * 3)
  const col = new Float32Array(total * 3)
  let o = 0
  for (const p of parts) {
    const n = p.getAttribute('position').count
    pos.set(p.getAttribute('position').array as Float32Array, o * 3)
    nor.set(p.getAttribute('normal').array as Float32Array, o * 3)
    const c = p.getAttribute('color')
    if (c) col.set(c.array as Float32Array, o * 3)
    else col.fill(1, o * 3, (o + n) * 3)
    o += n
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('normal', new BufferAttribute(nor, 3))
  g.setAttribute('color', new BufferAttribute(col, 3))
  return g
}
