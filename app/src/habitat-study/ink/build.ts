import { BufferAttribute, BufferGeometry, Color, CylinderGeometry, IcosahedronGeometry } from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { landscapeHeight } from '../../project03/terrain.ts'
import { SITE, type StudySite } from '../site.ts'
import { composePlants, dwellerSpot, type Placed } from '../sculpt/forms.ts'
import type { Landform } from '../sculpt/landform.ts'
import { INK, Pen, wobble, type V3 } from './paper.ts'

/**
 * Style B — the drawing's material, made once per site:
 *
 *   ground     the real height low-passed (its large forms, none of its bumps), true at every organism's footing; blank paper, with the shade
 *              habitat's faint wash (the accent) where the structures keep the sun off for much of the day
 *   lines      the shoreline twice (a hand goes over it), a few ripples, sparse slope strokes, light hatching laid only in the deep shade habitat,
 *              the architecture's strata, its hollows drawn closer, and the plants as strokes
 *   solids     the trees' and shrubs' crowns, paper-filled so they hide what is behind them, outlined by the pen (InkScene.tsx)
 *
 * The plants are the Sculptural style's composition (the world's placement, grouped), drawn far more sparsely: a drawing implies a mass with a few marks.
 */
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

export type InkSolids = 'crown' | 'dome' | 'mesa'
export type InkBuilt = {
  ground: BufferGeometry
  water: BufferGeometry | null
  heightAt: (x: number, z: number) => number
  level: number | null
  /** The ground's vertices and normals on its grid, for the silhouettes drawn from wherever the camera is. */
  grid: { n: number; pos: Float32Array; nor: Float32Array }
  pens: { medium: Pen; fine: Pen; faint: Pen }
  solids: { kind: InkSolids; x: number; y: number; z: number; s: number; yaw: number }[]
  shapes: Record<InkSolids, BufferGeometry>
  dweller: [number, number] | null
}

const cache = new WeakMap<StudySite, InkBuilt>()
export function inkOf(site: StudySite): InkBuilt {
  let b = cache.get(site)
  if (!b) {
    const started = performance.now()
    b = build(site)
    console.info('[habitat study] ink built', { ms: Math.round(performance.now() - started), solids: b.solids.length })
    cache.set(site, b)
  }
  return b
}

function build(site: StudySite): InkBuilt {
  const { world, organisms } = site
  const depthAt = (x: number, z: number) => world.water.depthAt(x, z)

  // ---- the ground: low-passed real height, true at the footings
  const raw = new Float32Array(N * N)
  for (let j = 0; j < N; j += 1) for (let i = 0; i < N; i += 1) raw[j * N + i] = landscapeHeight(X0 + i * STEP, Z0 + j * STEP)
  let soft: Float32Array = raw
  for (let pass = 0; pass < 2; pass += 1) {
    const out = new Float32Array(N * N)
    for (let j = 0; j < N; j += 1) {
      for (let i = 0; i < N; i += 1) {
        let s = 0
        let c = 0
        for (let b = -3; b <= 3; b += 1) {
          for (let a = -3; a <= 3; a += 1) {
            s += soft[Math.min(N - 1, Math.max(0, j + b)) * N + Math.min(N - 1, Math.max(0, i + a))]!
            c += 1
          }
        }
        out[j * N + i] = s / c
      }
    }
    soft = out
  }
  const ground = new Float32Array(N * N)
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const x = X0 + i * STEP
      const z = Z0 + j * STEP
      const k = j * N + i
      let h = soft[k]!
      for (const o of organisms) h += (raw[k]! - h) * smooth(o.radius + 24, o.radius + 6, Math.hypot(x - o.x, z - o.z))
      ground[k] = h
    }
  }
  const heightAt = (x: number, z: number) => {
    const u = Math.min(N - 1.0001, Math.max(0, (x - X0) / STEP))
    const v = Math.min(N - 1.0001, Math.max(0, (z - Z0) / STEP))
    const i = Math.floor(u)
    const j = Math.floor(v)
    const fu = u - i
    const fv = v - j
    const g = (a: number, b: number) => ground[b * N + a]!
    return g(i, j) * (1 - fu) * (1 - fv) + g(i + 1, j) * fu * (1 - fv) + g(i, j + 1) * (1 - fu) * fv + g(i + 1, j + 1) * fu * fv
  }

  // ---- the lake: its level, and the drawn ground under it that connects to the real lake
  let level: number | null = null
  const dir = site.audit.water.dir
  if (dir && site.audit.water.nearest !== null) {
    for (let d = site.audit.water.nearest; d < site.audit.water.nearest + 30 && level === null; d += 2) {
      const x = SITE.cx + dir[0] * d
      const z = SITE.cz + dir[1] * d
      if (depthAt(x, z) > 0.3) level = landscapeHeight(x, z) + depthAt(x, z)
    }
  }
  const wet = new Uint8Array(N * N)
  if (level !== null) {
    const queue: number[] = []
    for (let k = 0; k < N * N; k += 1) {
      if (depthAt(X0 + (k % N) * STEP, Z0 + Math.floor(k / N) * STEP) > 0.2 && ground[k]! < level) {
        wet[k] = 1
        queue.push(k)
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
  }

  // ---- ground mesh: paper, with the shade habitat's wash in its vertex colour
  const gpos = new Float32Array(N * N * 3)
  const gcol = new Float32Array(N * N * 3)
  const index: number[] = []
  const paper = new Color(INK.paper)
  const wash = new Color(INK.wash)
  const c = new Color()
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const x = X0 + i * STEP
      const z = Z0 + j * STEP
      const k = j * N + i
      gpos.set([x, ground[k]!, z], k * 3)
      // A watercolour's edge: the wash's threshold wanders, and it pools a little deeper at its margin.
      const sh = site.shadeAt(x, z) + wobble(x * 0.25, 0, z * 0.25) * 0.06
      const body = smooth(0.24, 0.34, sh)
      c.copy(paper).lerp(wash, body * 0.3 + smooth(0.24, 0.3, sh) * (1 - smooth(0.3, 0.42, sh)) * 0.12)
      gcol.set([c.r, c.g, c.b], k * 3)
      if (i + 1 < N && j + 1 < N) index.push(k, k + N, k + 1, k + 1, k + N, k + N + 1)
    }
  }
  const groundG = new BufferGeometry()
  groundG.setAttribute('position', new BufferAttribute(gpos, 3))
  groundG.setAttribute('color', new BufferAttribute(gcol, 3))
  groundG.setIndex(index)
  groundG.computeVertexNormals()

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

  const pens = { medium: new Pen('medium'), fine: new Pen('fine'), faint: new Pen('faint') }
  const ink = new Color(INK.ink)
  const sepia = new Color(INK.sepia)
  const graphite = new Color(INK.graphite)
  const faint = new Color(INK.faint)
  const drape = (x: number, z: number, lift = 0.08): V3 => [x, heightAt(x, z) + lift, z]

  // ---- the shore: the water's edge drawn twice, the second a little inland and lighter; then a few ripples on the open water
  if (level !== null) {
    const lv = level
    const contour = (at: number, pen: Pen, col: Color, lift: number) => {
      // Marching squares on the drawn ground, at the given height.
      for (let j = 0; j + 1 < N; j += 1) {
        for (let i = 0; i + 1 < N; i += 1) {
          const k = j * N + i
          const corners = [k, k + 1, k + N + 1, k + N]
          const pts: V3[] = []
          for (let e = 0; e < 4; e += 1) {
            const a = corners[e]!
            const b = corners[(e + 1) % 4]!
            const ha = ground[a]! - at
            const hb = ground[b]! - at
            if (ha < 0 === hb < 0) continue
            const t = ha / (ha - hb)
            const x = gpos[a * 3]! + (gpos[b * 3]! - gpos[a * 3]!) * t
            const z = gpos[a * 3 + 2]! + (gpos[b * 3 + 2]! - gpos[a * 3 + 2]!) * t
            pts.push([x + wobble(x, 0, z) * 0.25, Math.max(lv, at) + 0.05, z + wobble(z, 1, x) * 0.25])
          }
          if (pts.length >= 2 && wobble(pts[0]![0] * 0.4, 2, pts[0]![2] * 0.4) > -1 + lift * 2) pen.seg(pts[0]!, pts[1]!, col)
        }
      }
    }
    contour(lv, pens.medium, sepia, 0.06)
    contour(lv + 0.5, pens.faint, faint, 0.45)
    if (dir) {
      const along: [number, number] = [-dir[1], dir[0]]
      let made = 0
      for (let t = 0; t < 400 && made < 9; t += 1) {
        const x = X0 + hash(t, 1, 7) * SITE.half * 2
        const z = Z0 + hash(t, 2, 7) * SITE.half * 2
        const i = Math.round((x - X0) / STEP)
        const j = Math.round((z - Z0) / STEP)
        if (!wet[j * N + i] || ground[j * N + i]! > lv - 0.8) continue
        const len = 4 + 7 * hash(t, 3, 7)
        const pts: V3[] = []
        for (let s = 0; s <= 6; s += 1) {
          const u = (s / 6 - 0.5) * len
          const px = x + along[0] * u
          const pz = z + along[1] * u
          pts.push([px, lv + 0.04 + Math.sin(s * 1.7 + t) * 0.03, pz + Math.sin(s * 1.3 + t) * 0.15])
        }
        pens.faint.poly(pts, graphite, 0.12)
        made += 1
      }
    }
  }

  // ---- slope strokes: short marks down the steeper ground, sparse, the pen following the fall
  for (let z = Z0 + 4; z < Z0 + SITE.half * 2 - 4; z += 6.5) {
    for (let x = X0 + 4; x < X0 + SITE.half * 2 - 4; x += 6.5) {
      const px = x + (hash(x, z, 1) - 0.5) * 5
      const pz = z + (hash(x, z, 2) - 0.5) * 5
      const gx = heightAt(px + 1, pz) - heightAt(px - 1, pz)
      const gz = heightAt(px, pz + 1) - heightAt(px, pz - 1)
      const slope = Math.atan(Math.hypot(gx, gz) / 2) * 57.3
      if (slope < 11 || hash(px, pz, 3) > 0.55 + (slope - 11) * 0.04) continue
      if (level !== null && heightAt(px, pz) < level + 0.3) continue
      const g = Math.hypot(gx, gz) || 1
      const len = 1.8 + 2.4 * hash(px, pz, 4)
      const pts: V3[] = []
      for (let s = 0; s <= 3; s += 1) {
        const u = (s / 3) * len
        pts.push(drape(px - (gx / g) * u + wobble(px, s, pz) * 0.12, pz - (gz / g) * u))
      }
      pens.faint.poly(pts, faint)
    }
  }

  // ---- hatching in the deep shade habitat: light, parallel, a second direction only where the shade is deepest; never a fill
  for (let z = Z0 + 2; z < Z0 + SITE.half * 2 - 2; z += 1.7) {
    for (let x = X0 + 2; x < X0 + SITE.half * 2 - 2; x += 1.7) {
      const px = x + (hash(x, z, 5) - 0.5) * 1.2
      const pz = z + (hash(x, z, 6) - 0.5) * 1.2
      const sh = site.shadeAt(px, pz)
      if (sh < 0.42 || hash(px, pz, 7) > 0.35 + sh * 0.4) continue
      if (level !== null && heightAt(px, pz) < level + 0.2) continue
      const len = 0.9 + 1.4 * sh
      const a = 0.72 + (hash(px, pz, 8) - 0.5) * 0.12
      pens.faint.seg(drape(px - Math.cos(a) * len * 0.5, pz - Math.sin(a) * len * 0.5), drape(px + Math.cos(a) * len * 0.5, pz + Math.sin(a) * len * 0.5), graphite)
      if (sh > 0.72 && hash(px, pz, 9) < 0.5) {
        const b = a + 1.25
        pens.faint.seg(drape(px - Math.cos(b) * len * 0.4, pz - Math.sin(b) * len * 0.4), drape(px + Math.cos(b) * len * 0.4, pz + Math.sin(b) * len * 0.4), graphite)
      }
    }
  }

  // ---- the plants: the composed groups, thinned; the shade lovers in the shade habitat all kept
  const adapter = { heightAt, onRock: () => false, level } as unknown as Landform
  const placed = composePlants(site, adapter).filter((p) => (p.arch === 'fern' || p.arch === 'mat' ? site.shadeAt(p.x, p.z) > 0.22 || hash(p.x, p.z, 11) < 0.4 : hash(p.x, p.z, 11) < 0.62))
  const solids: InkBuilt['solids'] = []
  for (const p of placed) drawPlant(p, pens, solids, { ink, sepia, graphite, faint }, site.shadeAt(p.x, p.z))

  return {
    ground: groundG,
    water,
    heightAt,
    level,
    grid: { n: N, pos: gpos, nor: groundG.getAttribute('normal').array as Float32Array },
    pens,
    solids,
    shapes: shapes(),
    dweller: dwellerSpot(site, adapter),
  }
}

/** Crowns at unit height: lumpy, rounded masses (a hull outline makes their silhouette, so their normals are kept smooth). */
function shapes(): Record<InkSolids, BufferGeometry> {
  const lumpy = (detail: number, sx: number, sy: number, sz: number, cy: number, seed: number) => {
    const g = mergeVertices(new IcosahedronGeometry(1, detail).deleteAttribute('normal').deleteAttribute('uv'))
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i += 1) {
      const k = 0.88 + 0.2 * Math.abs(Math.sin(p.getX(i) * 5.3 + p.getZ(i) * 4.1 + p.getY(i) * 3.7 + seed))
      p.setXYZ(i, p.getX(i) * sx * k, p.getY(i) * sy * k + cy, p.getZ(i) * sz * k)
    }
    g.computeVertexNormals()
    return g
  }
  const disc = (r: number, y: number, dx: number) => mergeVertices(new CylinderGeometry(r, r * 1.04, 0.07, 9).deleteAttribute('uv').deleteAttribute('normal').translate(dx, y, 0))
  const mesa = mergeGeometries([disc(0.5, 0.58, 0), disc(0.34, 0.8, 0.06)])
  mesa.computeVertexNormals()
  return { crown: lumpy(1, 0.26, 0.36, 0.26, 0.62, 1), dome: lumpy(1, 0.5, 0.36, 0.5, 0.42, 2), mesa }
}

/** One plant, drawn: crowns as paper solids (outlined later) with a trunk and a few marks on their shaded side; low plants as strokes only. */
function drawPlant(p: Placed, pens: InkBuilt['pens'], solids: InkBuilt['solids'], c: { ink: Color; sepia: Color; graphite: Color; faint: Color }, shade: number) {
  const { x, y, z, s, yaw } = p
  const h = (k: number) => hash(x, z, k)
  switch (p.arch) {
    case 'spire':
    case 'dome':
    case 'mesa': {
      const kind: InkSolids = p.arch === 'spire' ? 'crown' : p.arch
      solids.push({ kind, x, y, z, s, yaw })
      const base = kind === 'crown' ? 0.34 : kind === 'dome' ? 0.16 : 0.55
      const lean = (h(1) - 0.5) * 0.08 * s
      pens.fine.poly([[x - 0.05 * s * 0.12, y, z], [x + lean * 0.5, y + base * s * 0.6, z], [x + lean, y + base * s, z]], c.sepia)
      pens.fine.poly([[x + 0.05 * s * 0.12, y, z], [x + lean * 0.5 + 0.03 * s, y + base * s * 0.6, z], [x + lean + 0.02 * s, y + base * s, z]], c.sepia, 0.15)
      // A few marks of leaf on the crown's lower, shaded side: small arcs, not a texture.
      const r = (kind === 'crown' ? 0.26 : 0.5) * s
      const cy = y + (kind === 'crown' ? 0.62 : kind === 'dome' ? 0.42 : 0.58) * s
      const marks = kind === 'mesa' ? 0 : 5
      for (let m = 0; m < marks; m += 1) {
        const a = yaw + h(10 + m) * 6.28
        const el = -0.2 - 0.4 * h(20 + m)
        const pts: V3[] = []
        for (let q = 0; q <= 3; q += 1) {
          const aa = a + (q / 3 - 0.5) * 0.7
          const rr = r * 1.04
          pts.push([x + Math.cos(aa) * Math.cos(el) * rr, cy + Math.sin(el) * (kind === 'crown' ? 0.36 : 0.36) * s * 1.02 + q * 0.02 * s, z + Math.sin(aa) * Math.cos(el) * rr])
        }
        pens.fine.poly(pts, c.graphite, 0.1)
      }
      return
    }
    case 'fern': {
      // Fronds arching out from the crown, a rachis and its leaflets as ticks; in deep shade one still curled (a fiddlehead).
      const fronds = 5 + Math.floor(h(1) * 3)
      for (let f = 0; f < fronds; f += 1) {
        const a = yaw + (f / fronds) * 6.28 + (h(2 + f) - 0.5) * 0.5
        const len = s * (0.7 + 0.3 * h(9 + f))
        const pts: V3[] = []
        for (let q = 0; q <= 5; q += 1) {
          const t = q / 5
          pts.push([x + Math.cos(a) * len * t, y + 0.05 + len * 0.55 * Math.sin(t * Math.PI * 0.8), z + Math.sin(a) * len * t])
        }
        pens.fine.poly(pts, c.sepia)
        for (let q = 1; q < 5; q += 1) {
          const [px, py, pz] = pts[q]!
          const w = len * 0.16 * (1 - q / 6)
          pens.faint.seg([px, py, pz], [px - Math.sin(a) * w + Math.cos(a) * w * 0.4, py - w * 0.3, pz + Math.cos(a) * w + Math.sin(a) * w * 0.4], c.graphite)
          pens.faint.seg([px, py, pz], [px + Math.sin(a) * w + Math.cos(a) * w * 0.4, py - w * 0.3, pz - Math.cos(a) * w + Math.sin(a) * w * 0.4], c.graphite)
        }
      }
      if (shade > 0.55) {
        const pts: V3[] = []
        for (let q = 0; q <= 10; q += 1) {
          const t = q / 10
          const r = 0.16 * s * (1 - t * 0.8)
          pts.push([x + Math.cos(t * 9) * r, y + 0.1 + s * 0.45 * Math.min(1, t * 2) , z + Math.sin(t * 9) * r])
        }
        pens.fine.poly(pts, c.sepia)
      }
      return
    }
    case 'mat': {
      // Ground mats: a few small loops, close to the ground.
      for (let m = 0; m < 3; m += 1) {
        const cx = x + (h(m) - 0.5) * s * 1.2
        const cz = z + (h(m + 5) - 0.5) * s * 1.2
        const r = s * (0.25 + 0.2 * h(m + 9))
        const pts: V3[] = []
        for (let q = 0; q <= 7; q += 1) pts.push([cx + Math.cos(q * 0.9 + m) * r, y + 0.06, cz + Math.sin(q * 0.9 + m) * r * 0.8])
        pens.faint.poly(pts, c.graphite)
      }
      return
    }
    case 'tuft':
    case 'reed': {
      const blades = p.arch === 'reed' ? 4 : 3
      for (let b = 0; b < blades; b += 1) {
        const a = yaw + b * 2.1 + h(b) * 0.6
        const lean = p.arch === 'reed' ? 0.12 : 0.45
        pens.faint.poly(
          [
            [x, y, z],
            [x + Math.cos(a) * s * lean * 0.4, y + s * 0.6, z + Math.sin(a) * s * lean * 0.4],
            [x + Math.cos(a) * s * lean, y + s * (0.9 + 0.2 * h(b + 4)), z + Math.sin(a) * s * lean],
          ],
          c.graphite,
        )
      }
      return
    }
    case 'canes': {
      for (let b = 0; b < 4; b += 1) {
        const dx = (h(b) - 0.5) * 0.4
        const dz = (h(b + 3) - 0.5) * 0.4
        pens.fine.poly([[x + dx, y, z + dz], [x + dx * 1.6, y + s * (0.7 + 0.3 * h(b + 6)), z + dz * 1.6]], c.sepia)
      }
      return
    }
  }
}
