import { landscapeHeight } from '../project03/terrain.ts'
import { adaptationOf, clamp, cross3, groundGrid, NEAR, norm3, type Carve, type Lobe, type PorousInputs, type PorousPlan, type Prim, type V3 } from './porousGrowth.ts'

/**
 * Architecture Lab: the first design-first Porous Growth (twisted column, arch wall, nested arches). Kept for the record; replaced by the vertical cluster in porousDesign.ts (its arches read as tubes and limbs).
 *
 * One family, three compositions taken from the references, each a handful of continuous RIBBONS (thick bands of tissue swept
 * along a curve, with their own width, thickness and twist) fused at their joints, with a few large OPENINGS cut where the design
 * wants them:
 *   column   a twisted, wall-like column that bulges and narrows as it climbs, windowed through its thin way at graded heights, with
 *            ribs that leave the column and rejoin it (or come down and root), and toes crawling out from its foot.
 *   wall     a band that rises from the ground, arches over a great opening and lands again: a crescent in plan, thick at one foot and
 *            slender at the other, windowed through its feet, braced by a buttress arch behind.
 *   nested   that arch repeated, smaller and further back, joined by thick webs: a sheltered, layered chamber with a swept ceiling.
 * The seed picks the composition and every proportion within it. The place does not pick it: vertical and lateral are one axis
 * (`vert`), set by the place (shade, shelter and crowding raise it; open, exposed ground lowers it), so the same composition rises on
 * a damp hollow's floor and spreads on an open ridge. Slope, water, light, crowding and wind set which way it faces and leans, how
 * far its toes crawl and where its roots land. Everything stands in the ground's own coordinates (h above the ground there), so feet
 * and toes follow the terrain. A seed's random draws never depend on the habitat.
 */
type Node = { x: number; h: number; z: number; W: number; D: number; ang: number }
type Lb = { x: number; h: number; z: number; t: V3; ang: number; W: number; D: number; La: number; arr: number; prev?: V3; nocore?: boolean }
type Ribbon = { name: string; lobes: Lb[] }
export type Archetype = 'column' | 'wall' | 'nested'
export const ARCHETYPE_LABEL: Record<Archetype, string> = { column: 'Twisted column', wall: 'Arch wall', nested: 'Nested arches' }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const cr = (a: number, b: number, c: number, d: number, f: number) => 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f)
/** The angle of the horizontal axis that is perpendicular to the plan direction (dx, dz). */
const perpAngle = (dx: number, dz: number) => Math.atan2(-dz, dx)

export function designPorousArches(seed: number, site: [number, number], inputs: PorousInputs): PorousPlan {
  const rv = (a: number, b: number) => {
    const n = Math.sin(seed * 12.9898 + a * 78.233 + b * 37.719 + 5.3) * 43758.5453
    return n - Math.floor(n)
  }
  const y0 = landscapeHeight(site[0], site[1])
  const S = clamp(inputs.size, 0.55, 1.2)
  const light = clamp(inputs.light)
  const crowd = clamp(inputs.crowding)
  const ad = adaptationOf(inputs)
  const { ridgeP, hollowP, near } = ad

  // ---- what the place gives ----
  const sun2: [number, number] = [Math.sin(inputs.sunAzimuth), Math.cos(inputs.sunAzimuth)]
  const windAz = inputs.sunAzimuth + 2.2
  const windK = 0.35 + 0.6 * ridgeP
  const lee2: [number, number] = [Math.sin(windAz), Math.cos(windAz)]
  const e = 18
  const gx = (landscapeHeight(site[0] + e, site[1]) - landscapeHeight(site[0] - e, site[1])) / (2 * e)
  const gz = (landscapeHeight(site[0], site[1] + e) - landscapeHeight(site[0], site[1] - e)) / (2 * e)
  const slopeMag = Math.hypot(gx, gz)
  const down2: [number, number] | null = slopeMag > 0.03 ? [-gx / slopeMag, -gz / slopeMag] : null
  const water2: [number, number] | null = inputs.waterAzimuth !== null && near > 0.05 ? [Math.sin(inputs.waterAzimuth), Math.cos(inputs.waterAzimuth)] : null
  const freeAz = rv(1, 8) * Math.PI * 2 + Math.PI
  const free2: [number, number] = [Math.sin(freeAz), Math.cos(freeAz)]

  /** Vertical (1) to lateral (0): shade, shelter and crowding climb; open, exposed ground spreads. */
  const vert = clamp(0.52 + 0.3 * hollowP - 0.42 * ridgeP + 0.24 * crowd + 0.3 * (0.55 - light) + 0.1 * (rv(1, 1) - 0.5))
  // Which way it faces and leans: toward the light, downhill, away from neighbours, toward water, a little with the wind, and the seed's own way.
  const sl = down2 ? clamp(slopeMag * 8) : 0
  const fv: [number, number] = [
    sun2[0] * (0.25 + 0.7 * light) + (down2 ? down2[0] * sl : 0) + free2[0] * crowd * 1.1 + (water2 ? water2[0] * near * 0.9 : 0) + lee2[0] * windK * 0.35 + (rv(1, 2) - 0.5) * 1.3,
    sun2[1] * (0.25 + 0.7 * light) + (down2 ? down2[1] * sl : 0) + free2[1] * crowd * 1.1 + (water2 ? water2[1] * near * 0.9 : 0) + lee2[1] * windK * 0.35 + (rv(1, 3) - 0.5) * 1.3,
  ]
  const psi = Math.atan2(fv[0], fv[1])
  const f2: [number, number] = [Math.sin(psi), Math.cos(psi)]
  const p2: [number, number] = [f2[1], -f2[0]]

  const ribbons: Ribbon[] = []
  const carves: Carve[] = []
  let windows = 0
  let loops = 0
  let reachMax = 0

  /** A band of tissue swept along a curve: lobes laid down along it, each with the band's width (along s) and thickness (along n) there. */
  const ribbon = (name: string, nodes: Node[], t0: number, t1: number, root?: V3): Ribbon => {
    const n = nodes.length
    const dense: Node[] = []
    for (let i = 0; i < n - 1; i += 1) {
      const a = nodes[Math.max(0, i - 1)]!
      const b = nodes[i]!
      const c = nodes[i + 1]!
      const d = nodes[Math.min(n - 1, i + 2)]!
      for (let k = 0; k < 8; k += 1) {
        const f = k / 8
        dense.push({ x: cr(a.x, b.x, c.x, d.x, f), h: cr(a.h, b.h, c.h, d.h, f), z: cr(a.z, b.z, c.z, d.z, f), W: lerp(b.W, c.W, f), D: lerp(b.D, c.D, f), ang: lerp(b.ang, c.ang, f) })
      }
    }
    dense.push(nodes[n - 1]!)
    const cum: number[] = [0]
    for (let i = 1; i < dense.length; i += 1) cum.push(cum[i - 1]! + Math.hypot(dense[i]!.x - dense[i - 1]!.x, dense[i]!.h - dense[i - 1]!.h, dense[i]!.z - dense[i - 1]!.z))
    const total = cum[cum.length - 1]!
    const at = (s: number): Node => {
      let i = 1
      while (i < cum.length - 1 && cum[i]! < s) i += 1
      const f = clamp((s - cum[i - 1]!) / Math.max(1e-6, cum[i]! - cum[i - 1]!))
      const A = dense[i - 1]!
      const B = dense[i]!
      return { x: lerp(A.x, B.x, f), h: lerp(A.h, B.h, f), z: lerp(A.z, B.z, f), W: lerp(A.W, B.W, f), D: lerp(A.D, B.D, f), ang: lerp(A.ang, B.ang, f) }
    }
    const lobes: Lb[] = []
    let s = 0
    let prev: V3 | undefined = root
    for (let guard = 0; guard < 400; guard += 1) {
      const P = at(s)
      const step = clamp(0.5 * Math.min(P.W, P.D), 1.5, 4.2)
      const A = at(Math.max(0, s - step))
      const B = at(Math.min(total, s + step))
      const t = norm3([B.x - A.x, B.h - A.h, B.z - A.z])
      lobes.push({ x: P.x, h: P.h, z: P.z, t, ang: P.ang, W: P.W, D: P.D, La: step * 1.3, arr: t0 + (t1 - t0) * Math.pow(total > 0 ? s / total : 0, 0.85), prev })
      prev = [P.x, P.h, P.z]
      if (s >= total) break
      s = Math.min(total, s + step)
    }
    const r: Ribbon = { name, lobes }
    ribbons.push(r)
    return r
  }
  const nearestLobe = (r: Ribbon, h: number) => r.lobes.reduce((best, l) => (Math.abs(l.h - h) < Math.abs(best.h - h) ? l : best), r.lobes[0]!)
  /** The frame of a lobe: its tangent t, its horizontal side axis s, and its other axis n = t x s. */
  const frameOf = (l: Lb) => {
    const raw: V3 = [Math.sin(l.ang), 0, Math.cos(l.ang)]
    const d = raw[0] * l.t[0] + raw[1] * l.t[1] + raw[2] * l.t[2]
    const s = norm3([raw[0] - l.t[0] * d, raw[1] - l.t[1] * d, raw[2] - l.t[2] * d])
    return { t: l.t, s, n: norm3(cross3(l.t, s)) }
  }
  /** An opening cut through tissue: an ellipsoid with half-width along wa, half-height along ha, and depth along `through`. */
  const opening = (c: V3, wa: V3, ha: V3, through: V3, w: number, hgt: number, depth: number, birth: number) => {
    carves.push({ kind: 'ell', role: 'void', c, ax: wa, ay: ha, az: through, r: [w, hgt, depth], t0: clamp(birth + 0.1, 0.3, 0.85), span: 0.3, k: 2.2 })
  }
  /** A window through a ribbon near height h: through its thin way (n or s), offset across it; sometimes a second, smaller lobe makes it irregular. */
  const windowAt = (r: Ribbon, h: number, off: number, w: number, hgt: number, thin: 'n' | 's', k: number, tilt = 0) => {
    const l = nearestLobe(r, h)
    const F = frameOf(l)
    const wide0 = thin === 'n' ? F.s : F.n
    const through0 = thin === 'n' ? F.n : F.s
    // Turned a little about the band's own axis, so the opening is not only seen through from one side.
    const wide: V3 = norm3([wide0[0] * Math.cos(tilt) - through0[0] * Math.sin(tilt), wide0[1] * Math.cos(tilt) - through0[1] * Math.sin(tilt), wide0[2] * Math.cos(tilt) - through0[2] * Math.sin(tilt)])
    const through: V3 = norm3([through0[0] * Math.cos(tilt) + wide0[0] * Math.sin(tilt), through0[1] * Math.cos(tilt) + wide0[1] * Math.sin(tilt), through0[2] * Math.cos(tilt) + wide0[2] * Math.sin(tilt)])
    const depth = 2.4 * (thin === 'n' ? l.D : l.W) + 3
    const c: V3 = [l.x + wide[0] * off, l.h + wide[1] * off, l.z + wide[2] * off]
    opening(c, wide, F.t, through, w, hgt, depth, l.arr)
    if (rv(30, k) < 0.6) {
      const sg = rv(31, k) < 0.5 ? 1 : -1
      opening([c[0] + wide[0] * w * 0.5 * sg + F.t[0] * hgt * 0.6, c[1] + wide[1] * w * 0.5 * sg + F.t[1] * hgt * 0.6, c[2] + wide[2] * w * 0.5 * sg + F.t[2] * hgt * 0.6], wide, F.t, through, w * 0.62, hgt * 0.5, depth, l.arr + 0.04)
    }
    windows += 1
  }
  /** A rib that leaves a ribbon and comes down to the ground to root, thickening toward its foot. */
  const rootArch = (name: string, A: Lb, dir: [number, number], reach: number, rib: number, t0: number, t1: number) => {
    const ns: Node[] = []
    const M = 7
    for (let k = 0; k <= M; k += 1) {
      const q = k / M
      const wr = rib * (0.85 + 0.65 * q)
      ns.push({
        x: A.x + dir[0] * reach * Math.sin(q * Math.PI * 0.5),
        h: Math.max(wr * 0.5, A.h * Math.pow(Math.cos(q * Math.PI * 0.5), 0.75) + 0.28 * reach * Math.sin(q * Math.PI)),
        z: A.z + dir[1] * reach * Math.sin(q * Math.PI * 0.5),
        W: wr * 1.05,
        D: wr * 0.92,
        ang: perpAngle(dir[0], dir[1]),
      })
    }
    ribbon(name, ns, t0, t1, [A.x, A.h, A.z])
    reachMax = Math.max(reachMax, reach)
  }

  const archetypes: Archetype[] = ['column', 'wall', 'nested']
  const arch = archetypes[Math.min(2, Math.floor(rv(2, 0) * 3))]!
  const W0 = (9.5 + 3 * rv(2, 1)) * S * Math.sqrt(ad.width)
  const anchors: { l: Lb; out: [number, number] }[] = []
  let H = 0
  let openingArea = 0

  if (arch === 'column') {
    // ---- the twisted column ----
    H = (44 + 22 * rv(2, 2)) * S * ad.height * (0.78 + 0.46 * vert)
    const D0 = W0 * (0.45 + 0.13 * rv(2, 3))
    const lean = (0.07 + 0.4 * (1 - vert)) * (0.6 + 0.8 * rv(2, 4))
    const ph = [rv(2, 5) * 6.28, rv(2, 6) * 6.28, rv(2, 7) * 6.28]
    const tw = (rv(2, 8) < 0.5 ? 1 : -1) * (0.8 + 0.9 * rv(2, 9)) * (0.8 + 0.4 * hollowP)
    const ang0 = psi + Math.PI / 2 + (rv(2, 10) - 0.5) * 0.8
    const N = 9
    const nodes: Node[] = []
    for (let k = 0; k <= N; k += 1) {
      const t = k / N
      const of = lean * H * Math.pow(t, 1.5) + 0.06 * H * Math.sin(6.28 * (0.9 * t + ph[0]!)) * t
      const op = 0.09 * H * Math.sin(6.28 * (1.1 * t + ph[1]!)) * t
      const bulge = 1 + 0.24 * Math.sin(6.28 * (1.5 * t + ph[2]!))
      nodes.push({
        x: f2[0] * of + p2[0] * op,
        h: k === 0 ? D0 * 0.4 : H * t,
        z: f2[1] * of + p2[1] * op,
        W: W0 * (k === 0 ? 1.4 : (1.08 - 0.44 * Math.pow(t, 0.9)) * bulge),
        D: D0 * (k === 0 ? 1.7 : (1.05 - 0.42 * t) * (0.92 + 0.16 * Math.sin(6.28 * (1.2 * t + ph[0]!)))),
        ang: ang0 + tw * t,
      })
    }
    const spine = ribbon('spine', nodes, 0.04, 0.8)
    anchors.push({ l: spine.lobes[0]!, out: [-f2[0], -f2[1]] })
    // Windows: graded in size from the lowest, offset across the wall, through its thin way.
    const nW = 2 + (rv(3, 0) < 0.55 ? 1 : 0)
    const tw0 = [0.27, 0.5, 0.72]
    for (let i = 0; i < nW; i += 1) {
      const t = tw0[i]! + (rv(3, 1 + i) - 0.5) * 0.08
      const l = nearestLobe(spine, H * t)
      const grade = [1, 0.8, 0.6][i]!
      const hgt = (0.1 + 0.06 * rv(3, 8 + i)) * H * grade * Math.sqrt(ad.opening)
      const w = 0.55 * l.W
      windowAt(spine, H * t, (i % 2 === 0 ? 1 : -1) * 0.12 * l.W * (rv(3, 5 + i) < 0.3 ? -1 : 1), w, hgt, 'n', 10 + i, (rv(3, 14 + i) - 0.5) * 1.1)
      openingArea += w * hgt * 3.14
    }
    // Ribs: leave the wall's side at one height and rejoin it higher (a loop), or come down to the ground and root (an arch).
    const nL = 1 + (rv(4, 0) < 0.5 ? 1 : 0)
    for (let j = 0; j < nL; j += 1) {
      const ta = 0.16 + 0.3 * rv(4, 1 + j) + j * 0.3
      const tb = Math.min(0.92, ta + 0.24 + 0.1 * rv(4, 3 + j))
      const sg = rv(4, 5 + j) < 0.5 ? 1 : -1
      const A = nearestLobe(spine, H * ta)
      const B = nearestLobe(spine, H * tb)
      const FA = frameOf(A)
      const rib = (0.34 + 0.07 * rv(4, 7 + j)) * W0
      const reach = (0.16 + 0.12 * rv(4, 9 + j)) * H * (0.7 + 0.5 * (1 - vert)) + 0.8 * A.W
      if (rv(4, 11 + j) < 0.2 + 0.6 * (1 - vert)) {
        const dir: [number, number] = [FA.s[0] * sg, FA.s[2] * sg]
        const dl = Math.hypot(dir[0], dir[1]) || 1
        rootArch('root-arch', A, [dir[0] / dl, dir[1] / dl], reach * 1.3, rib, clamp(A.arr + 0.03, 0.15, 0.7), clamp(A.arr + 0.3, 0.4, 0.92))
        anchors.push({ l: ribbons[ribbons.length - 1]!.lobes[ribbons[ribbons.length - 1]!.lobes.length - 1]!, out: [dir[0] / dl, dir[1] / dl] })
      } else {
        const ns: Node[] = []
        const M = 7
        for (let k = 0; k <= M; k += 1) {
          const q = k / M
          const out = Math.pow(Math.sin(q * Math.PI), 0.8) * reach
          const wr = rib * (1 - 0.28 * Math.sin(q * Math.PI))
          ns.push({ x: lerp(A.x, B.x, q) + FA.s[0] * sg * out, h: lerp(A.h, B.h, q) + 0.15 * out, z: lerp(A.z, B.z, q) + FA.s[2] * sg * out, W: wr * 1.05, D: wr * 0.92, ang: perpAngle(FA.s[0] * sg, FA.s[2] * sg) })
        }
        ribbon('loop', ns, clamp(A.arr + 0.03, 0.15, 0.7), clamp(A.arr + 0.3, 0.4, 0.92), [A.x, A.h, A.z])
        reachMax = Math.max(reachMax, reach)
        openingArea += reach * (B.h - A.h) * 0.8
      }
      loops += 1
    }
  } else {
    // ---- the arch wall, and the nested arches ----
    const Lw = (64 + 30 * rv(5, 0)) * S * ad.length * (0.78 + 0.5 * (1 - vert))
    const Hc = (34 + 18 * rv(5, 1)) * S * ad.height * (0.68 + 0.55 * vert)
    H = Hc + 6
    const bend = (rv(5, 2) < 0.5 ? 1 : -1) * (0.1 + 0.2 * rv(5, 3))
    const asym = (rv(5, 4) - 0.5) * 0.8
    const Wf0 = (16 + 4 * rv(5, 5)) * S * Math.sqrt(ad.width)
    const Wf1 = (9 + 3 * rv(5, 6)) * S
    const Wc = (9.5 + 3 * rv(5, 7)) * S
    const Dout = (4.2 + 1.4 * rv(5, 8)) * S
    const layers = arch === 'nested' ? 2 + (rv(5, 9) < 0.5 ? 1 : 0) : 1
    const layerRibbons: Ribbon[] = []
    for (let j = 0; j < layers; j += 1) {
      const sc = 1 - 0.27 * j
      const off = -j * (8 + 3 * rv(5, 10)) * S
      const nodes: Node[] = []
      const M = 10
      for (let k = 0; k <= M; k += 1) {
        const u = k / M
        const hump = Math.pow(Math.sin(Math.PI * u), 0.85)
        const a = (u - 0.5) * Lw * sc
        const fw = bend * Lw * sc * Math.sin(Math.PI * u) + off
        const win = (lerp(Wf0, Wf1, u) * (1 - 0.5 * hump) + 0.45 * Wc * hump) * sc
        const dx = p2[0] * Lw * sc + f2[0] * bend * Lw * sc * Math.PI * Math.cos(Math.PI * u)
        const dz = p2[1] * Lw * sc + f2[1] * bend * Lw * sc * Math.PI * Math.cos(Math.PI * u)
        nodes.push({
          x: p2[0] * a + f2[0] * fw,
          h: k === 0 || k === M ? win * 0.3 : Hc * sc * hump * (1 + asym * (u - 0.5)),
          z: p2[1] * a + f2[1] * fw,
          W: Dout * Math.pow(0.88, j) * (1 + 0.35 * (1 - hump)) * (1 + 0.18 * Math.sin(6.28 * (1.3 * u + rv(5, 11)))),
          D: win,
          ang: perpAngle(dx, dz),
        })
      }
      const band = ribbon(`arch${j}`, nodes, 0.04 + 0.05 * j, 0.8 - 0.04 * j)
      layerRibbons.push(band)
      anchors.push({ l: band.lobes[0]!, out: [-p2[0], -p2[1]] }, { l: band.lobes[band.lobes.length - 1]!, out: [p2[0], p2[1]] })
      if (j === 0) {
        // Windows through the thick foot, and through the slender one if it is thick enough.
        const lo = nearestLobe(band, Hc * 0.3)
        const w0 = 0.3 * lo.D
        const h0 = (0.22 + 0.08 * rv(6, 0)) * Hc * Math.sqrt(ad.opening)
        windowAt(band, Hc * 0.28, 0, w0, h0, 's', 20)
        openingArea += w0 * h0 * 3.14
        if (rv(6, 1) < 0.6) {
          const hi = band.lobes.slice(Math.floor(band.lobes.length * 0.6)).reduce((b, l) => (Math.abs(l.h - Hc * 0.3) < Math.abs(b.h - Hc * 0.3) ? l : b))
          if (hi.D > 9) {
            windowAt({ name: 'foot2', lobes: band.lobes.slice(Math.floor(band.lobes.length * 0.6)) }, Hc * 0.3, 0, 0.26 * hi.D, 0.13 * Hc, 's', 21)
            openingArea += 0.26 * hi.D * 0.13 * Hc * 3.14
          }
        }
      }
    }
    // The span itself is the great opening.
    const mid = layerRibbons[0]!.lobes[Math.floor(layerRibbons[0]!.lobes.length / 2)]!
    openingArea += (Lw * 0.7 * Math.max(0, mid.h - mid.D * 0.5)) * 0.7
    if (arch === 'wall') {
      // A buttress arch behind the thick foot: from the leg's upper part back and down to the ground.
      const leg = layerRibbons[0]!
      const A = nearestLobe({ name: 'leg', lobes: leg.lobes.slice(0, Math.floor(leg.lobes.length * 0.45)) }, Hc * (0.55 + 0.15 * rv(7, 0)))
      const back: [number, number] = [-f2[0] * 0.9 + p2[0] * (rv(7, 1) - 0.5), -f2[1] * 0.9 + p2[1] * (rv(7, 1) - 0.5)]
      const bl = Math.hypot(back[0], back[1])
      rootArch('buttress', A, [back[0] / bl, back[1] / bl], (0.28 + 0.14 * rv(7, 2)) * Lw, 0.28 * Wf0, clamp(A.arr + 0.04, 0.2, 0.7), clamp(A.arr + 0.3, 0.45, 0.92))
      anchors.push({ l: ribbons[ribbons.length - 1]!.lobes[ribbons[ribbons.length - 1]!.lobes.length - 1]!, out: [back[0] / bl, back[1] / bl] })
    } else {
      // Thick webs join each arch to the next, behind it: at the feet, and over the crown.
      for (let j = 0; j + 1 < layers; j += 1) {
        const A = layerRibbons[j]!
        const B = layerRibbons[j + 1]!
        for (const [u, prob] of [[0.12, 0.95], [0.5, 0.75], [0.88, 0.9]] as const) {
          if (rv(8, j * 3 + Math.round(u * 10)) > prob) continue
          const a = A.lobes[Math.min(A.lobes.length - 1, Math.round(u * (A.lobes.length - 1)))]!
          const b = B.lobes[Math.min(B.lobes.length - 1, Math.round(u * (B.lobes.length - 1)))]!
          const wr = 0.3 * Math.min(a.D, b.D) + 1.6
          const ang = perpAngle(b.x - a.x, b.z - a.z)
          ribbon('web', [
            { x: a.x, h: a.h, z: a.z, W: wr, D: wr, ang },
            { x: (a.x + b.x) / 2, h: (a.h + b.h) / 2, z: (a.z + b.z) / 2, W: wr * 1.1, D: wr * 1.1, ang },
            { x: b.x, h: b.h, z: b.z, W: wr, D: wr, ang },
          ], clamp(Math.max(a.arr, b.arr) + 0.02, 0.2, 0.8), 0.9, [a.x, a.h, a.z])
        }
      }
    }
  }

  // ---- toes: the foot crawls along the ground, longer downhill, toward water and on exposed ground ----
  const nT = Math.min(anchors.length, 4)
  for (let i = 0; i < nT; i += 1) {
    const { l, out } = anchors[i]!
    let az = Math.atan2(out[0], out[1]) + (rv(9, 10 + i) - 0.5) * 1.2
    if (down2 && rv(9, 20 + i) < 0.55) az = Math.atan2(down2[0], down2[1]) + (rv(9, 30 + i) - 0.5) * 0.9
    if (water2 && rv(9, 40 + i) < 0.35 * near + 0.1) az = Math.atan2(water2[0], water2[1]) + (rv(9, 50 + i) - 0.5) * 0.7
    const down = down2 ? Math.max(0, Math.sin(az) * down2[0] + Math.cos(az) * down2[1]) : 0
    const len = (10 + 12 * rv(9, 60 + i)) * S * (1 + 0.7 * down + 0.5 * near + 0.5 * ridgeP)
    const dir: [number, number] = [Math.sin(az), Math.cos(az)]
    const bow = (rv(9, 70 + i) - 0.5) * 0.5 * len
    const ns: Node[] = []
    for (let k = 0; k <= 4; k += 1) {
      const q = k / 4
      ns.push({ x: l.x + dir[0] * len * q + -dir[1] * bow * Math.sin(q * Math.PI), h: lerp(1.9, 0.9, q) * S, z: l.z + dir[1] * len * q + dir[0] * bow * Math.sin(q * Math.PI), W: lerp(4.4, 1.5, q) * S, D: lerp(2.4, 0.95, q) * S, ang: perpAngle(dir[0], dir[1]) })
    }
    ribbon('toe', ns, clamp(l.arr + 0.02, 0.2, 0.8), clamp(l.arr + 0.25, 0.4, 0.95), [l.x, l.h, l.z])
    reachMax = Math.max(reachMax, len)
  }

  // ---- lobes in a window's reach keep no protected core, so the opening is clear ----
  for (const c of carves) {
    if (c.kind !== 'ell') continue
    for (const r of ribbons) {
      for (const l of r.lobes) {
        const dx = l.x - c.c[0]
        const dh = l.h - c.c[1]
        const dz = l.z - c.c[2]
        const qx = (dx * c.ax[0] + dh * c.ax[1] + dz * c.ax[2]) / c.r[0]
        const qy = (dx * c.ay[0] + dh * c.ay[1] + dz * c.ay[2]) / c.r[1]
        const qz = (dx * c.az[0] + dh * c.az[1] + dz * c.az[2]) / c.r[2]
        if (qx * qx + qy * qy + qz * qz < 1.4 * 1.4) l.nocore = true
      }
    }
  }

  // ---- prims ----
  const prims: Prim[] = []
  const E = { ex: 0, ez: 0, hc: 0, hv: 0, taper: 0, flat: 0, hb: 0, frill: 0, ph: 0 }
  let lox = 1e9
  let hix = -1e9
  let loz = 1e9
  let hiz = -1e9
  let topH = 0
  for (const r of ribbons) {
    for (const l of r.lobes) {
      const F = frameOf(l)
      const lobe: Lobe = { tx: F.t[0], th: F.t[1], tz: F.t[2], sx: F.s[0], sz: F.s[2], nx: F.n[0], nh: F.n[1], nz: F.n[2], La: l.La, rw: l.W, rt: l.D, prev: l.prev, nocore: l.nocore }
      prims.push({ ...E, kind: 'blob', cx: l.x, cz: l.z, hc: l.h, sin: 0, cos: 1, a: Math.max(l.La, l.W, l.D), b: Math.max(l.La, l.W, l.D), h: 0, leanX: 0, leanZ: 0, birth: l.arr, dur: 0.12, bl: lobe })
      const pad = Math.max(l.La, l.W, l.D) + NEAR + 4
      lox = Math.min(lox, l.x - pad)
      hix = Math.max(hix, l.x + pad)
      loz = Math.min(loz, l.z - pad)
      hiz = Math.max(hiz, l.z + pad)
      topH = Math.max(topH, l.h + Math.abs(F.t[1]) * l.La * 0.8 + 0.6 * Math.max(l.W, l.D) * Math.sqrt(Math.max(0, 1 - F.t[1] * F.t[1])))
    }
  }
  const cell = 1.55 * clamp(S, 0.75, 1.2)
  let minX = 1e9
  let maxX = -1e9
  let minZ = 1e9
  let maxZ = -1e9
  for (const r of ribbons) {
    for (const l of r.lobes) {
      minX = Math.min(minX, l.x - l.W)
      maxX = Math.max(maxX, l.x + l.W)
      minZ = Math.min(minZ, l.z - l.W)
      maxZ = Math.max(maxZ, l.z + l.W)
    }
  }
  const body = ribbons.filter((r) => r.name !== 'toe')
  const spanX = maxX - minX
  const spanZ = maxZ - minZ
  const measure: Record<string, number> = {
    length: Math.round(Math.max(spanX, spanZ)),
    width: Math.round(Math.min(spanX, spanZ)),
    height: Math.round(topH),
    massifs: body.length,
    openings: windows + loops + (arch === 'column' ? 0 : 1),
    openingWidth: 0,
    openingHeight: 0,
    openingArea: Math.round(clamp((100 * openingArea) / Math.max(1, Math.max(spanX, spanZ) * topH), 0, 90)),
    chamber: Math.round(vert * 100),
    windows,
    pits: 0,
    skirt: Math.round(ad.skirt * 100) / 100,
    spineAzimuth: Math.round(((((psi * 180) / Math.PI) % 180) + 180) % 180),
    roof: Math.round(reachMax),
  }
  const stats: Record<string, number | string> = {
    height: measure.height!,
    openings: `${windows} windows, ${loops} ribs${arch === 'column' ? '' : ', a great span'}`,
    massifs: `${ARCHETYPE_LABEL[arch]}, ${Math.round(vert * 100)}% vertical`,
  }
  const poro: { t0: number; soil: number } = { t0: 0.5, soil: 0.6 }
  return { site, y0, cell, prims, carves, skirt: ad.skirt, moisture: clamp(inputs.moisture), ground: groundGrid(site, lox, hix, loz, hiz, cell), poro, measure, stats }
}
