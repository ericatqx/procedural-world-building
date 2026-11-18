import { landscapeHeight } from '../project03/terrain.ts'
import { adaptationOf, clamp, cross3, groundGrid, NEAR, norm3, type Carve, type Lobe, type PorousInputs, type PorousPlan, type Prim, type V3 } from './porousGrowth.ts'

/**
 * Architecture Lab: Porous Growth as one vertical family (designed first, then grown).
 *
 * A VERTICAL CLUSTER: two to four tall, thick towers rise from one fused base, different in height and girth, each a wall-like column
 * whose width and thickness swell and narrow in tiers as it climbs (the wavy flank of reference image 4) and which twists a little.
 * They grow together: their feet merge in a shared plinth, and higher up they are joined by arched bridges and, at the foot, by a flying
 * buttress that comes down to root. Openings are cut where the design wants them, large and unequal, of three kinds: caves on the faces
 * (recessed rooms, never through), windows (through the thin way of a wall), and wide portals (a tower's whole width but its two
 * side walls). With age the openings enlarge (their growth continues past maturity); that is the hook for creatures' work later.
 *
 * Vertical and lateral are one axis (`vert`), set by the place: shade, shelter and crowding raise it (taller, fewer, more twisted
 * towers); open, exposed ground lowers it (shorter, broader, more towers, wider spaced, more bridges). A tower stays at least about
 * twice as tall as it is wide, so even the lateral end is a cluster of towers, never a low sprawl. The seed picks the number of
 * towers, which one is tallest, how they stand, every proportion, where the openings and bridges fall; the habitat never changes
 * a draw. Everything stands in the ground's own coordinates (h above the ground there), so feet and toes follow the terrain.
 */
type Node = { x: number; h: number; z: number; W: number; D: number; ang: number }
type Lb = { x: number; h: number; z: number; t: V3; ang: number; W: number; D: number; La: number; arr: number; prev?: V3; nocore?: boolean }
type Ribbon = { name: string; lobes: Lb[] }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const cr = (a: number, b: number, c: number, d: number, f: number) => 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f)
/** The angle of the horizontal axis that is perpendicular to the plan direction (dx, dz). */
const perpAngle = (dx: number, dz: number) => Math.atan2(-dz, dx)

export function designPorous(seed: number, site: [number, number], inputs: PorousInputs): PorousPlan {
  const rv = (a: number, b: number) => {
    const n = Math.sin(seed * 12.9898 + a * 78.233 + b * 37.719 + 5.3) * 43758.5453
    return n - Math.floor(n)
  }
  const r = (k: number) => rv(2, k)
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
  // Which way the cluster faces and leans: toward the light, downhill, away from neighbours, toward water, a little with the wind, and the seed's own way.
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
  let caves = 0
  let windows = 0
  let portals = 0
  let bridges = 0
  let reachMax = 0
  let openingArea = 0

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
    for (let guard = 0; guard < 500; guard += 1) {
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
    const rb: Ribbon = { name, lobes }
    ribbons.push(rb)
    return rb
  }
  const nearestLobe = (rb: Ribbon, h: number) => rb.lobes.reduce((best, l) => (Math.abs(l.h - h) < Math.abs(best.h - h) ? l : best), rb.lobes[0]!)
  /** The frame of a lobe: its tangent t, its horizontal side axis s, and its other axis n = t x s. */
  const frameOf = (l: Lb) => {
    const raw: V3 = [Math.sin(l.ang), 0, Math.cos(l.ang)]
    const d = raw[0] * l.t[0] + raw[1] * l.t[1] + raw[2] * l.t[2]
    const s = norm3([raw[0] - l.t[0] * d, raw[1] - l.t[1] * d, raw[2] - l.t[2] * d])
    return { t: l.t, s, n: norm3(cross3(l.t, s)) }
  }
  /** An opening: an ellipsoid with half-width along wa, half-height along ha, depth along `through`. Rooms ('chamber') keep enlarging past maturity. */
  const opening = (role: 'chamber' | 'recess', c: V3, wa: V3, ha: V3, through: V3, w: number, hgt: number, depth: number, birth: number) => {
    carves.push({ kind: 'ell', role, c, ax: wa, ay: ha, az: through, r: [w, hgt, depth], t0: clamp(birth + 0.1, 0.3, 0.85), span: 0.3, k: 2.4 })
  }
  /** Kinds of opening in a tower at height h: a cave on a face (recessed, never through), a window (through the thin way), or a portal (wide, through). */
  const cut = (kind: 'cave' | 'window' | 'portal', rb: Ribbon, h: number, sideSign: number, w: number, hgt: number, tilt: number) => {
    const l = nearestLobe(rb, h)
    const F = frameOf(l)
    const wa0 = F.s
    const th0 = F.n
    const wide: V3 = norm3([wa0[0] * Math.cos(tilt) - th0[0] * Math.sin(tilt), wa0[1] * Math.cos(tilt) - th0[1] * Math.sin(tilt), wa0[2] * Math.cos(tilt) - th0[2] * Math.sin(tilt)])
    const through: V3 = norm3([th0[0] * Math.cos(tilt) + wa0[0] * Math.sin(tilt), th0[1] * Math.cos(tilt) + wa0[1] * Math.sin(tilt), th0[2] * Math.cos(tilt) + wa0[2] * Math.sin(tilt)])
    if (kind === 'cave') {
      // A room dented into one face: centred on the face, deep enough to leave a back wall.
      const off = sideSign * l.D * 0.95
      const c: V3 = [l.x + F.n[0] * off, l.h + F.n[1] * off, l.z + F.n[2] * off]
      opening('chamber', c, F.s, F.t, F.n, w, hgt, l.D * 0.62, l.arr)
      caves += 1
    } else if (kind === 'window') {
      const c: V3 = [l.x + wide[0] * sideSign * 0.1 * l.W, l.h + wide[1] * sideSign * 0.1 * l.W, l.z + wide[2] * sideSign * 0.1 * l.W]
      opening('recess', c, wide, F.t, through, w, hgt, 2.4 * l.D + 3, l.arr)
      windows += 1
    } else {
      // A portal: the tower's width but for its two side walls; a second, smaller lobe makes its head irregular.
      const c: V3 = [l.x, l.h, l.z]
      opening('recess', c, F.s, F.t, F.n, w, hgt, 2.4 * l.D + 3, l.arr)
      opening('recess', [c[0] + F.t[0] * hgt * 0.55 + F.s[0] * w * 0.25 * sideSign, c[1] + F.t[1] * hgt * 0.55 + F.s[1] * w * 0.25 * sideSign, c[2] + F.t[2] * hgt * 0.55 + F.s[2] * w * 0.25 * sideSign], F.s, F.t, F.n, w * 0.6, hgt * 0.55, 2.4 * l.D + 3, l.arr + 0.03)
      portals += 1
    }
    openingArea += w * hgt * 3.14
  }
  /** A rib that leaves a ribbon and comes down to the ground to root, thickening toward its foot (a flying buttress). */
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

  // ---- the towers ----
  const nT = 2 + Math.floor(r(0) * 2.999)
  const tallest = Math.floor(r(1) * nT)
  const Hmax = (74 + 28 * r(2)) * S * Math.pow(ad.height, 0.3) * (0.95 + 0.25 * vert)
  const W0 = (8.4 + 2.4 * r(3)) * S * Math.sqrt(ad.width)
  // How far apart: the feet merge, the shafts part. Lateral places stand them wider apart.
  // (never so far apart that the cluster is wider than the tallest tower is high)
  const gap = Math.min(W0 * (2.8 + 0.8 * r(4) + 0.2 * (1 - vert)), (0.95 * Hmax) / Math.max(1, nT - 1))
  const bow = (r(5) - 0.5) * 0.9
  const align = r(6) // 0: all walls face the same way; 1: each turns its own way
  const ang0 = psi + Math.PI / 2
  const towerTiers: number[] = []
  const towers: { rb: Ribbon; H: number; W: number; D: number; x: number; z: number; ang: number }[] = []
  for (let i = 0; i < nT; i += 1) {
    const c = i - (nT - 1) / 2
    const Hi = i === tallest ? Hmax : Hmax * (0.5 + 0.38 * r(10 + i))
    const Wi = W0 * (i === tallest ? 1.08 : 0.82 + 0.25 * r(14 + i))
    const Di = Wi * (0.62 + 0.25 * r(18 + i))
    const bx = p2[0] * c * gap + f2[0] * (bow * c * c * gap * 0.35 + (r(22 + i) - 0.5) * 0.5 * W0)
    const bz = p2[1] * c * gap + f2[1] * (bow * c * c * gap * 0.35 + (r(22 + i) - 0.5) * 0.5 * W0)
    const lean = clamp(0.015 + 0.07 * (1 - vert) * r(26 + i) - 0.02 * r(30 + i), -0.02, 0.09)
    // Tiers: each is a broad lip that narrows toward the next one's lip, so the flank is scalloped and every lip roofs the room under it.
    const nTier = clamp(Math.round(Hi / (15 + 3 * r(34 + i))), 3, 7)
    const lip = 0.2 + 0.14 * r(38 + i)
    const ph = [r(46 + i) * 6.28, r(50 + i) * 6.28]
    const tw = (r(54 + i) < 0.5 ? 1 : -1) * (0.25 + 0.55 * r(58 + i)) * (0.7 + 0.6 * vert)
    const angI = ang0 + (r(62 + i) - 0.5) * 2 * 0.9 * align
    const nodes: Node[] = [{ x: bx, h: Di * 0.3, z: bz, W: Wi * 1.3, D: Di * 1.4, ang: angI }]
    const marks: [number, number, number][] = [[0.08, 1, 1], [0.24, 1 + lip, 1 + 0.55 * lip], [0.56, 0.9, 0.92], [0.92, 0.76, 0.82]]
    for (let j = 0; j < nTier; j += 1) {
      for (const [u, kw, kd] of marks) {
        if (j === 0 && u < 0.2) continue
        const t = (j + u) / nTier
        const taper = (1.1 - 0.4 * Math.pow(t, 1.1)) * (1 + 0.12 * Math.sin(6.28 * t * 1.7 + ph[0]!))
        const taperD = (1.1 - 0.38 * Math.pow(t, 1.1)) * (1 + 0.1 * Math.sin(6.28 * t * 1.3 + ph[1]!))
        const of = lean * Hi * Math.pow(t, 1.4) + (j % 2 === 0 ? 1 : -1) * 0.07 * Wi * Math.sin(Math.PI * u)
        nodes.push({ x: bx + f2[0] * of, h: Hi * t, z: bz + f2[1] * of, W: Wi * taper * kw, D: Di * taperD * kd, ang: angI + tw * t })
      }
    }
    const lastN = nodes[nodes.length - 1]!
    nodes.push({ x: lastN.x, h: Hi * 1.0 + 1.5, z: lastN.z, W: lastN.W * 0.75, D: lastN.D * 0.75, ang: lastN.ang })
    towerTiers.push(nTier)
    // The tallest rises first; the others start a little later.
    const t0 = 0.04 + (i === tallest ? 0 : 0.06 + 0.1 * r(66 + i))
    const rb = ribbon(`tower${i}`, nodes, t0, 0.78 - 0.06 * r(70 + i))
    towers.push({ rb, H: Hi, W: Wi, D: Di, x: bx, z: bz, ang: angI })
  }

  // ---- the shared plinth: a low, wide band under all the feet, so the towers stand on one body ----
  {
    const dirOf = (a: { x: number; z: number }, b: { x: number; z: number }): [number, number] => {
      const l = Math.hypot(a.x - b.x, a.z - b.z) || 1
      return [(a.x - b.x) / l, (a.z - b.z) / l]
    }
    const first = towers[0]!
    const last = towers[nT - 1]!
    const dA = dirOf(first, towers[1]!)
    const dB = dirOf(last, towers[nT - 2]!)
    const ns: Node[] = [{ x: first.x + dA[0] * 0.6 * gap, h: 2.6 * S, z: first.z + dA[1] * 0.6 * gap, W: first.D * 1.3, D: 4 * S, ang: perpAngle(p2[0], p2[1]) }]
    for (const T of towers) ns.push({ x: T.x, h: 2.8 * S, z: T.z, W: T.D * 1.7, D: 4.4 * S, ang: perpAngle(p2[0], p2[1]) })
    ns.push({ x: last.x + dB[0] * 0.6 * gap, h: 2.6 * S, z: last.z + dB[1] * 0.6 * gap, W: last.D * 1.3, D: 4 * S, ang: perpAngle(p2[0], p2[1]) })
    ribbon('plinth', ns, 0.02, 0.3)
  }

  // ---- openings: under every lip, a room (a cave on one face, or a wide portal); between lips, now and then, a window through the wall ----
  towers.forEach((T, i) => {
    const nTier = towerTiers[i]!
    const tierH = T.H / nTier
    let portalDone = false
    for (let j = 1; j < nTier; j += 1) {
      const t = (j - 0.2) / nTier
      const l = nearestLobe(T.rb, T.H * t)
      const sg = (j + i) % 2 === 0 ? 1 : -1
      const roll = r(80 + 6 * i + j)
      if (roll < 0.6 || j === 1) cut('cave', T.rb, T.H * t, sg, (0.68 + 0.14 * r(90 + 6 * i + j)) * l.W, tierH * (0.3 + 0.08 * r(100 + 6 * i + j)) * Math.sqrt(ad.opening), (r(110 + 6 * i + j) - 0.5) * 0.5)
      else if (roll < 0.8 && !portalDone) {
        portalDone = true
        cut('portal', T.rb, T.H * t, sg, 0.62 * l.W, tierH * 0.36 * Math.sqrt(ad.opening), 0)
      } else cut('window', T.rb, T.H * t, sg, 0.5 * l.W, tierH * 0.3 * Math.sqrt(ad.opening), (r(120 + 6 * i + j) - 0.5) * 0.9)
      if (r(130 + 6 * i + j) < 0.45) {
        const tm = (j - 1 + 0.58) / nTier
        const lm = nearestLobe(T.rb, T.H * tm)
        cut('window', T.rb, T.H * tm, -sg, 0.5 * lm.W, tierH * 0.22 * Math.sqrt(ad.opening), (r(140 + 6 * i + j) - 0.5) * 1.1)
      }
    }
  })

  // ---- bridges: arched, thick bands from one tower to the next, at heights both reach ----
  for (let i = 0; i + 1 < nT; i += 1) {
    const A = towers[i]!
    const B = towers[i + 1]!
    const nB = 1 + (r(140 + i) < 0.5 ? 1 : 0)
    const Hmin = Math.min(A.H, B.H)
    for (let k = 0; k < nB; k += 1) {
      const hb = Hmin * (k === 0 ? 0.3 + 0.18 * r(144 + i) : 0.62 + 0.18 * r(148 + i))
      const la = nearestLobe(A.rb, hb)
      const lb = nearestLobe(B.rb, hb * (0.9 + 0.2 * r(152 + i + k)))
      const dist = Math.hypot(lb.x - la.x, lb.z - la.z)
      const dirx = (lb.x - la.x) / (dist || 1)
      const dirz = (lb.z - la.z) / (dist || 1)
      const wb = (5 + 2 * r(156 + i + k)) * S
      const db = (4.2 + 1.4 * r(160 + i + k)) * S
      const ns: Node[] = []
      const M = 6
      for (let q = 0; q <= M; q += 1) {
        const u = q / M
        ns.push({ x: lerp(la.x, lb.x, u), h: lerp(la.h, lb.h, u) + 0.12 * dist * Math.sin(Math.PI * u), z: lerp(la.z, lb.z, u), W: wb, D: db * (1 + 0.25 * Math.sin(Math.PI * u)), ang: perpAngle(dirx, dirz) })
      }
      const arrBoth = Math.max(la.arr, lb.arr)
      ribbon('bridge', ns, clamp(arrBoth + 0.02, 0.25, 0.8), clamp(arrBoth + 0.2, 0.45, 0.92), [la.x, la.h, la.z])
      bridges += 1
      openingArea += dist * 0.1 * dist * 0.6
    }
  }

  // ---- a flying buttress from the outermost tower, coming down to root on the side away from the others ----
  {
    const k = r(170) < 0.5 ? 0 : nT - 1
    const T = towers[k]!
    const A = nearestLobe(T.rb, T.H * (0.4 + 0.15 * r(171)))
    const sgn = k === 0 ? -1 : 1
    const dir: [number, number] = [p2[0] * sgn * 0.85 + f2[0] * (r(172) - 0.5) * 0.7, p2[1] * sgn * 0.85 + f2[1] * (r(172) - 0.5) * 0.7]
    const dl = Math.hypot(dir[0], dir[1]) || 1
    rootArch('buttress', A, [dir[0] / dl, dir[1] / dl], (0.34 + 0.12 * r(173)) * T.H * (0.8 + 0.4 * (1 - vert)), 0.32 * T.W, clamp(A.arr + 0.04, 0.2, 0.7), clamp(A.arr + 0.3, 0.45, 0.92))
    openingArea += T.H * 0.25 * T.H * 0.2
  }

  // ---- toes: the foot crawls along the ground, longer downhill, toward water and on exposed ground ----
  const anchors: { x: number; z: number; arr: number; h: number; out: [number, number] }[] = []
  for (const kk of [0, nT - 1]) {
    const T = towers[kk]!
    const l0 = T.rb.lobes[0]!
    anchors.push({ x: l0.x, z: l0.z, arr: l0.arr, h: l0.h, out: [p2[0] * (kk === 0 ? -1 : 1), p2[1] * (kk === 0 ? -1 : 1)] })
  }
  anchors.push({ x: towers[tallest]!.x, z: towers[tallest]!.z, arr: towers[tallest]!.rb.lobes[0]!.arr, h: 2, out: [f2[0], f2[1]] })
  anchors.forEach((a, i) => {
    let az = Math.atan2(a.out[0], a.out[1]) + (rv(9, 10 + i) - 0.5) * 1.2
    if (down2 && rv(9, 20 + i) < 0.55) az = Math.atan2(down2[0], down2[1]) + (rv(9, 30 + i) - 0.5) * 0.9
    if (water2 && rv(9, 40 + i) < 0.35 * near + 0.1) az = Math.atan2(water2[0], water2[1]) + (rv(9, 50 + i) - 0.5) * 0.7
    const down = down2 ? Math.max(0, Math.sin(az) * down2[0] + Math.cos(az) * down2[1]) : 0
    const len = (12 + 12 * rv(9, 60 + i)) * S * (1 + 0.7 * down + 0.5 * near + 0.5 * ridgeP)
    const dir: [number, number] = [Math.sin(az), Math.cos(az)]
    const bowT = (rv(9, 70 + i) - 0.5) * 0.5 * len
    const ns: Node[] = []
    for (let k = 0; k <= 4; k += 1) {
      const q = k / 4
      ns.push({ x: a.x + dir[0] * len * q + -dir[1] * bowT * Math.sin(q * Math.PI), h: lerp(2.2, 1, q) * S, z: a.z + dir[1] * len * q + dir[0] * bowT * Math.sin(q * Math.PI), W: lerp(5.2, 1.6, q) * S, D: lerp(2.8, 1, q) * S, ang: perpAngle(dir[0], dir[1]) })
    }
    ribbon('toe', ns, clamp(a.arr + 0.02, 0.2, 0.8), clamp(a.arr + 0.25, 0.4, 0.95))
    reachMax = Math.max(reachMax, len)
  })

  // ---- lobes in an opening's reach keep no protected core, so the opening is clear ----
  for (const c of carves) {
    if (c.kind !== 'ell') continue
    for (const rb of ribbons) {
      for (const l of rb.lobes) {
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
  let minX = 1e9
  let maxX = -1e9
  let minZ = 1e9
  let maxZ = -1e9
  for (const rb of ribbons) {
    for (const l of rb.lobes) {
      const F = frameOf(l)
      const lobe: Lobe = { tx: F.t[0], th: F.t[1], tz: F.t[2], sx: F.s[0], sz: F.s[2], nx: F.n[0], nh: F.n[1], nz: F.n[2], La: l.La, rw: l.W, rt: l.D, prev: l.prev, nocore: l.nocore }
      prims.push({ ...E, kind: 'blob', cx: l.x, cz: l.z, hc: l.h, sin: 0, cos: 1, a: Math.max(l.La, l.W, l.D), b: Math.max(l.La, l.W, l.D), h: 0, leanX: 0, leanZ: 0, birth: l.arr, dur: 0.12, bl: lobe })
      const pad = Math.max(l.La, l.W, l.D) + NEAR + 4
      lox = Math.min(lox, l.x - pad)
      hix = Math.max(hix, l.x + pad)
      loz = Math.min(loz, l.z - pad)
      hiz = Math.max(hiz, l.z + pad)
      topH = Math.max(topH, l.h + Math.abs(F.t[1]) * l.La * 0.8 + 0.6 * Math.max(l.W, l.D) * Math.sqrt(Math.max(0, 1 - F.t[1] * F.t[1])))
      minX = Math.min(minX, l.x - l.W)
      maxX = Math.max(maxX, l.x + l.W)
      minZ = Math.min(minZ, l.z - l.W)
      maxZ = Math.max(maxZ, l.z + l.W)
    }
  }
  const cell = 1.55 * clamp(S, 0.75, 1.2)
  const spanX = maxX - minX
  const spanZ = maxZ - minZ
  const measure: Record<string, number> = {
    length: Math.round(Math.max(spanX, spanZ)),
    width: Math.round(Math.min(spanX, spanZ)),
    height: Math.round(topH),
    massifs: nT,
    openings: caves + windows + portals + bridges,
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
    openings: `${caves} caves, ${windows} windows, ${portals} portals, ${bridges} bridges`,
    massifs: `${nT} towers, ${Math.round(vert * 100)}% vertical`,
  }
  const poro: { t0: number; soil: number } = { t0: 0.5, soil: 0.6 }
  return { site, y0, cell, prims, carves, skirt: ad.skirt, moisture: clamp(inputs.moisture), ground: groundGrid(site, lox, hix, loz, hiz, cell), poro, measure, stats }
}
