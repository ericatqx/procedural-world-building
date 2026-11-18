import { landscapeHeight } from '../project03/terrain.ts'
import { adaptationOf, clamp, cross3, groundGrid, makeProbe, NEAR, norm3, smooth, type Carve, type PorousInputs, type PorousPlan, type Prim, type V3 } from './porousGrowth.ts'

/**
 * Architecture Lab: Porous Growth, ASCENDING. The second growth direction of the same organism (see porousGrowth.ts for the
 * field, the growth by arrival, the carving and the habitat adaptation, all shared); where Spreading grows along a spine on the
 * ground, Ascending grows up one axis, in layers:
 *   - the column: a stack of fused layers (tiers) that arrive from the ground upward, swelling and narrowing as it leans toward
 *     the light and curves; some levels also lay down a broad, frilled shelf that is cantilevered out in a turning direction
 *     (the balconies and ledges of an inhabited tower);
 *   - supports: buttress ribs that rise from a broad skirt, curve in and fuse into the column at mid height, so the arches under
 *     them are what is left between ribs and column (they are grown from the same mass, not attached);
 *   - space: a large void erodes into the column above each shelf, on a turning stair of azimuths, so the shelf is its floor and
 *     balcony; the voids are joined by a passage through the core, and windows run from the passage to the outside; a portal at
 *     the foot and one bore through the column open it from below and through; pits weather in around the voids.
 * Voids, passages and pits are sized to the thickness the column really has where they are, so none cuts through it.
 */
export function growAscending(seed: number, site: [number, number], inputs: PorousInputs): PorousPlan {
  const rv = (a: number, b: number) => {
    const n = Math.sin(seed * 12.9898 + a * 78.233 + b * 37.719 + 1.7) * 43758.5453
    return n - Math.floor(n)
  }
  const y0 = landscapeHeight(site[0], site[1])
  const size = clamp(inputs.size, 0.55, 1.2)
  const light = clamp(inputs.light)
  const moist = clamp(inputs.moisture)
  const crowd = clamp(inputs.crowding)
  const ad = adaptationOf(inputs)
  const { ridgeP, hollowP, near } = ad

  // The column leans toward the light (and toward water that is close), and curves.
  // The lean is the seed's own direction, drawn toward the light.
  let leanAz = inputs.sunAzimuth + Math.atan2(Math.sin(rv(1, 0) * Math.PI * 2 - inputs.sunAzimuth), Math.cos(rv(1, 0) * Math.PI * 2 - inputs.sunAzimuth)) * 0.55
  if (inputs.waterAzimuth !== null && near > 0.3) {
    const dlt = Math.atan2(Math.sin(inputs.waterAzimuth - leanAz), Math.cos(inputs.waterAzimuth - leanAz))
    leanAz += dlt * 0.7 * near
  }
  const H = 56 * size * ad.height * (0.8 + 0.45 * rv(20, 0))
  const n = Math.max(6, Math.min(11, 8 + Math.floor(rv(20, 1) * 3) + (hollowP > 0.5 ? 1 : 0) - (ridgeP > 0.5 ? 1 : 0)))
  const sp = H / n
  const R0 = 7.2 * size * (0.78 + 0.5 * rv(20, 2)) * ad.width
  const ph1 = rv(20, 4) * Math.PI * 2
  const ph2 = rv(20, 5) * Math.PI * 2
  const lean = (0.05 + 0.25 * light) * H * (0.5 + 1.0 * rv(20, 3))
  const wob = 0.03 + 0.1 * rv(20, 6)
  const swell = 0.12 + 0.2 * rv(20, 7)
  const crowdDir = rv(1, 8) * Math.PI * 2
  const freeX = Math.sin(crowdDir + Math.PI)
  const freeZ = Math.cos(crowdDir + Math.PI)
  const Rat = (y: number) => R0 * (1 - 0.38 * Math.pow(clamp(y / H), 1.15)) * (1 + swell * Math.sin(2 * Math.PI * clamp(y / H) * 1.5 + ph1))
  const centre = (y: number): [number, number] => {
    const t = clamp(y / H)
    const m = wob * H * Math.sin(2 * Math.PI * t * 1.3 + ph2) * t
    const L = lean * Math.pow(t, 1.6)
    const cs = 0.12 * H * crowd * Math.pow(t, 1.5)
    return [Math.sin(leanAz) * L + Math.cos(leanAz) * m + freeX * cs, Math.cos(leanAz) * L - Math.sin(leanAz) * m + freeZ * cs]
  }
  const E = { ex: 0, ez: 0, hc: 0, hv: 0, taper: 0, flat: 0, hb: 0, frill: 0, ph: 0 }
  const prims: Prim[] = []

  // The foot: a low massif and a broad skirt that melts into the ground.
  prims.push({ ...E, kind: 'mass', cx: 0, cz: 0, sin: 0, cos: 1, a: R0 * 0.85, b: R0 * 0.85, h: 0.14 * H, taper: 0.15, leanX: 0, leanZ: 0, birth: 0.02, dur: 0.5 })
  prims.push({ ...E, kind: 'apron', cx: 0, cz: 0, sin: 0, cos: 1, a: R0 * 1.3, b: R0 * 1.3, h: 0, leanX: 0, leanZ: 0, birth: 0, dur: 0.4 })

  // The layers: every level lays a core tier; some also lay a shelf, cantilevered out in a turning direction.
  type Level = { y: number; birth: number; shelf: boolean; az: number; reach: number; R: number; c: [number, number] }
  const levels: Level[] = []
  const thr = 0.25 + 0.5 * rv(22, 99)
  const shelfAt: boolean[] = Array.from({ length: n }, (_, i) => i >= 1 && i < n - 1 && rv(22, i) < thr)
  if (shelfAt.filter(Boolean).length < 2) {
    shelfAt[2] = true
    shelfAt[n - 3] = true
  }
  const spiral = (0.55 + 0.9 * rv(24, 98)) * (rv(24, 97) < 0.5 ? 1 : -1)
  for (let i = 0; i < n; i += 1) {
    const y = Math.max(0.4 * sp, (H * (i + 0.55 + (rv(21, i) - 0.5) * 0.4)) / n)
    const R = Rat(y)
    const c = centre(y)
    const birth = 0.04 + 0.6 * Math.pow(i / (n - 1), 0.9)
    const dur = 0.34 + 0.05 * rv(23, i)
    const last = i === n - 1
    const rot = rv(23, i + 30) * Math.PI
    // Under a shelf the core is a little narrower and above it recessed (where its void will be), so shelves stand out from the column.
    const prevShelf = i >= 1 && shelfAt[i - 1]!
    const cf = prevShelf ? 0.84 : 1.02
    prims.push({ ...E, kind: 'tier', cx: c[0], cz: c[1], sin: Math.sin(rot), cos: Math.cos(rot), a: R * cf * (last ? 0.8 : 0.98 + 0.14 * rv(23, i)), b: R * cf * (last ? 0.8 : 0.98 + 0.14 * rv(23, i + 60)), h: 0, leanX: 0, leanZ: 0, birth, dur, hc: y, hv: sp * (last ? 1.1 : 0.78), flat: 0.15, frill: 0.05, ph: rv(23, i + 90) * 6.28 })
    const shelf = shelfAt[i]!
    const az = inputs.sunAzimuth + i * spiral + (rv(24, i) - 0.5) * 0.6
    let reach = 0
    if (shelf) {
      const dx = Math.sin(az)
      const dz = Math.cos(az)
      const crowded = Math.max(0, dx * -freeX + dz * -freeZ)
      const a = Math.min(R * 2.5, R * (1.5 + 0.9 * rv(25, i)) * (0.75 + 0.5 * ad.roof)) * (1 - 0.4 * crowd * crowded)
      const off = a * 0.5
      prims.push({ ...E, kind: 'tier', cx: c[0] + dx * off, cz: c[1] + dz * off, sin: dx, cos: dz, a, b: R * (1.2 + 0.4 * rv(25, i + 40)), h: 0, leanX: 0, leanZ: 0, birth: birth + 0.03, dur: 0.3, hc: y + sp * 0.2, hv: sp * 0.4, flat: 0.8, frill: 0.14, ph: rv(25, i + 70) * 6.28 })
      reach = off + a - R
    }
    levels.push({ y, birth, shelf, az, reach, R, c })
  }

  let branch: { y: number; dx: number; dz: number } | null = null
  // A side branch (seeded; less likely in a crowd): a second, smaller stack that leaves the column at mid height and rises away from
  // its lean, fused into it, as a branching tower does.
  if (rv(31, 0) < 0.7 - 0.3 * crowd + 0.15 * hollowP) {
    const bi = Math.max(2, Math.min(n - 4, Math.floor(n * (0.3 + 0.2 * rv(31, 1)))))
    const lb = levels[bi]!
    const thB = leanAz + Math.PI * (0.55 + 0.9 * rv(31, 2))
    const dx = Math.sin(thB)
    const dz = Math.cos(thB)
    const nb = 3 + Math.floor(rv(31, 3) * 3)
    branch = { y: lb.y, dx, dz }
    for (let k = 0; k <= nb; k += 1) {
      const d = k === 0 ? 0.5 * lb.R : 0.7 * lb.R + sp * 0.9 * k * (1 - 0.1 * k)
      const yk = lb.y + sp * (0.45 * k + 0.16 * k * k)
      const Rk = Math.max(0.38 * lb.R, lb.R * (k === 0 ? 0.85 : 0.76 - 0.08 * k))
      const rot = rv(31, k + 10) * Math.PI
      prims.push({ ...E, kind: 'tier', cx: lb.c[0] + dx * d, cz: lb.c[1] + dz * d, sin: Math.sin(rot), cos: Math.cos(rot), a: Rk, b: Rk * (0.9 + 0.2 * rv(31, k + 20)), h: 0, leanX: 0, leanZ: 0, birth: lb.birth + 0.06 + 0.07 * k, dur: 0.3, hc: yk, hv: sp * (0.5 + 0.18 * k + (k === nb ? 0.25 : 0)), flat: 0.1, frill: 0.05, ph: rv(31, k + 30) * 6.28 })
    }
  }

  // The supports: ribs that rise from the skirt, curve in and fuse into the column; one on the side it leans toward.
  const nRib = 2 + Math.floor(rv(26, 0) * 2.2) + (ridgeP > 0.5 ? 1 : 0)
  const ribs: { foot: number }[] = []
  for (let j = 0; j < nRib; j += 1) {
    const az = j === 0 ? leanAz + (rv(26, 1) - 0.5) * 0.5 : leanAz + (j * 2 * Math.PI) / nRib + (rv(26, j + 8) - 0.5) * 0.5
    const dF = R0 * (2.1 + 0.5 * rv(26, j + 4))
    const yR = H * (0.5 + 0.2 * rv(26, j + 12)) * (j === 0 ? 1.05 : 1)
    const cT = centre(yR)
    const RT = Rat(yR)
    const dx = Math.sin(az)
    const dz = Math.cos(az)
    const pts: { x: number; z: number; h: number; t: number }[] = []
    for (const t of [0, 0.33, 0.66, 1]) {
      const d = dF * Math.pow(1 - t, 1.2) + 0.3 * RT * t
      const base = t === 1 ? cT : [cT[0] * Math.pow(t, 1.5), cT[1] * Math.pow(t, 1.5)]
      pts.push({ x: base[0]! + dx * d, z: base[1]! + dz * d, h: yR * Math.pow(t, 1.15), t })
    }
    const rF = 4.4 * size * (0.9 + 0.1 * ad.skirt)
    const rT = 3.6 * size
    const b0 = 0.22 + 0.2 * rv(26, j + 16)
    for (let q = 0; q < 3; q += 1) {
      const A = pts[q]!
      const B = pts[q + 1]!
      prims.push({ ...E, kind: 'rib', cx: A.x, cz: A.z, hc: A.h, ex: B.x, ez: B.z, hb: B.h, sin: 0, cos: 1, a: rF + (rT - rF) * A.t, b: rF + (rT - rF) * B.t, h: 0, leanX: 0, leanZ: 0, birth: b0 + q * 0.1, dur: 0.22 })
    }
    ribs.push({ foot: dF })
  }

  const probe = makeProbe(prims, ad.skirt)
  const carves: Carve[] = []
  const up: V3 = [0, 1, 0]
  const shelves = levels.filter((l) => l.shelf)
  let voidN = 0
  let voidArea = 0
  let voidVol = 0
  let openW = 0
  let openH = 0
  const inner: { p: V3; t0: number; n: V3; T: number; c: V3 }[] = []
  // Voids: above each shelf, which is its floor; sized to the column's thickness there.
  for (let k = 0; k < Math.min(6, shelves.length); k += 1) {
    const l = shelves[k]!
    const nD: V3 = [Math.sin(l.az), 0, Math.cos(l.az)]
    const hV = l.y + sp * 0.78
    const cH = centre(hV)
    const o: V3 = [cH[0] + nD[0] * (l.R * 3.2), hV, cH[1] + nD[2] * (l.R * 3.2)]
    const t = probe.cast(o, [-nD[0], 0, -nD[2]], 60, true)
    if (t < 0) continue
    const Ep: V3 = [o[0] - nD[0] * t, hV, o[2] - nD[2] * t]
    const tt = probe.cast([Ep[0] - nD[0] * 0.8, hV, Ep[2] - nD[2] * 0.8], [-nD[0], 0, -nD[2]], 60, false)
    const T = tt < 0 ? 0 : tt + 0.8
    if (T < 6) continue
    const rho = Math.min(ad.opening * (0.5 + 0.15 * rv(27, k)) * T, 0.46 * T, 0.95 * sp, 6.5 * size * Math.sqrt(ad.opening))
    if (rho < 1.8) continue
    // Keep clear of the side branch's root, which a void there would cut off.
    const bTmp = branch as { y: number; dx: number; dz: number } | null
    if (bTmp && Math.abs(hV - bTmp.y) < 1.45 * rho + 0.6 * sp + 4 && nD[0] * bTmp.dx + nD[2] * bTmp.dz > 0.2) continue
    const c: V3 = [Ep[0] - nD[0] * 0.2 * rho, hV, Ep[2] - nD[2] * 0.2 * rho]
    const ax = norm3(cross3(up, nD))
    const birthTier = l.birth + 0.34
    const t0 = clamp(birthTier + 0.04 + 0.1 * rv(27, k + 20), 0.3, 0.78)
    carves.push({ kind: 'ell', role: 'void', c, ax, ay: up, az: nD, r: [rho, 1.45 * rho, rho], t0, span: 0.3, k: 1.6 })
    voidN += 1
    voidArea += Math.PI * rho * 1.45 * rho
    voidVol += (4 / 3) * Math.PI * rho * 1.45 * rho * rho
    if (rho * rho * 2.9 > openW * openH / 2) {
      openW = 2 * rho
      openH = 2.9 * rho
    }
    const pin: V3 = [Ep[0] - nD[0] * 0.55 * T, hV, Ep[2] - nD[2] * 0.55 * T]
    inner.push({ p: pin, t0, n: nD, T, c })
  }
  // The passage: through the core, from void to void up the stair, and from each void to it.
  let passageVol = 0
  const pr = clamp(0.5 * size * 2.2, 1.3, 2.3)
  for (let k = 0; k < inner.length; k += 1) {
    const a = inner[k]!
    carves.push({ kind: 'tube', role: 'passage', a: a.c, b: a.p, rad: pr, t0: a.t0 + 0.02, span: 0.2, k: 1.2 })
    if (k + 1 < inner.length) {
      const b = inner[k + 1]!
      carves.push({ kind: 'tube', role: 'passage', a: a.p, b: b.p, rad: pr, t0: Math.max(a.t0, b.t0) + 0.03, span: 0.2, k: 1.2 })
      passageVol += Math.PI * pr * pr * Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2])
    }
  }
  // Windows: from the passage out through the wall, on other azimuths than the voids, in varied sizes.
  let windows = 0
  const nW = Math.round(clamp(3 + 2 * hollowP - 2 * ridgeP + rv(28, 0) * 2, 2, 7))
  for (let w = 0; w < nW && inner.length > 0; w += 1) {
    const a = inner[w % inner.length]!
    const th = Math.atan2(a.n[0], a.n[2]) + (w % 2 ? 1 : -1) * (1.1 + 0.5 * rv(28, w + 1))
    const dir = norm3([Math.sin(th), (rv(28, w + 10) - 0.4) * 0.2, Math.cos(th)])
    const t = probe.cast(a.p, dir, 40, false)
    if (t < 0 || t > 16) continue
    const rad = Math.min((0.9 + 1.0 * rv(28, w + 20)) * size, 0.2 * a.T)
    carves.push({ kind: 'tube', role: 'window', a: a.p, b: [a.p[0] + dir[0] * (t + 3), a.p[1] + dir[1] * (t + 3), a.p[2] + dir[2] * (t + 3)], rad, t0: a.t0 + 0.08 + 0.04 * w, span: 0.25, k: 1.2 })
    windows += 1
  }
  // A portal across the foot, so the leaning tower stands over a way through, and one bore through the column higher up.
  let portals = 0
  let portalArea = 0
  const perp = leanAz + Math.PI / 2 + (rv(29, 0) - 0.5) * 0.6
  // The higher bore is set at the level farthest from every void, so the two never meet and cut the column in two.
  const voidYs = inner.map((a) => a.p[1])
  let yb = H * (0.5 + 0.08 * rv(29, 1))
  let bestGap = -1
  for (let d = -4; d <= 4; d += 1) {
    const y = H * (0.5 + 0.08 * rv(29, 1)) + d * sp * 0.8
    if (y < 0.3 * H || y > 0.8 * H) continue
    const gap = Math.min(99, ...voidYs.map((v) => Math.abs(v - y)))
    if (gap > bestGap) {
      bestGap = gap
      yb = y
    }
  }
  const bores: { y: number; ww: number; t0: number }[] = [{ y: 0, ww: clamp(0.3 * R0 * ad.opening, 2.2, 0.5 * R0), t0: 0.4 }]
  if (bestGap >= 1.6 * sp) bores.push({ y: yb, ww: 0.26 * Rat(yb) * Math.min(ad.opening, 1.2), t0: 0.68 })
  for (let q = 0; q < bores.length; q += 1) {
    const b = bores[q]!
    const cc = centre(b.y)
    const ax: V3 = [Math.sin(perp), 0, Math.cos(perp)]
    const side: V3 = [Math.cos(perp), 0, -Math.sin(perp)]
    let ww = b.ww
    let hh = ww * (q === 0 ? 1.6 : 1.3)
    const hMid = q === 0 ? 0 : b.y
    let ok = false
    for (let tries = 0; tries < 8 && ww > 2; tries += 1) {
      const hs = [hMid + 0.2 * hh, hMid + 0.6 * hh]
      ok = hs.every((hq) => probe.fieldFull(cc[0] + side[0] * (ww + 2.6), hq, cc[1] + side[2] * (ww + 2.6)) < -1.2 && probe.fieldFull(cc[0] - side[0] * (ww + 2.6), hq, cc[1] - side[2] * (ww + 2.6)) < -1.2) && probe.fieldFull(cc[0], hMid + hh + 3, cc[1]) < -0.5
      if (ok) break
      ww *= 0.88
      hh *= 0.92
    }
    if (!ok) continue
    const st: V3 = [cc[0], hMid + 0.3 * hh, cc[1]]
    const tp = probe.cast(st, ax, 60, false)
    const tn = probe.cast(st, [-ax[0], 0, -ax[2]], 60, false)
    if (tp < 0 || tn < 0) continue
    const shift = (tp - tn) / 2
    carves.push({ kind: 'cyl', role: 'portal', c: [cc[0] + ax[0] * shift, q === 0 ? -0.6 : hMid, cc[1] + ax[2] * shift], ax, L: (tp + tn) / 2 + 2.5, ww, hh, t0: b.t0, span: 0.35, k: 1.4 })
    portals += 1
    portalArea += (Math.PI * ww * hh) / (q === 0 ? 2 : 1)
    if (ww * hh * 4 > openW * openH) {
      openW = 2 * ww
      openH = q === 0 ? hh : 2 * hh
    }
  }
  // Pits: around the voids first, then on the shaded side; never larger than the wall behind them can bear.
  const nPit = Math.round((8 + 12 * moist) * (0.8 + 0.4 * size))
  let pits = 0
  for (let q = 0; q < nPit; q += 1) {
    let hP: number
    let th: number
    if (inner.length > 0 && rv(30, q) < 0.5) {
      const a = inner[Math.floor(rv(30, q + 40) * inner.length)]!
      hP = a.p[1] + (rv(30, q + 80) - 0.5) * 3.2 * sp
      th = Math.atan2(a.n[0], a.n[2]) + (rv(30, q + 120) - 0.5) * 2.4
    } else {
      hP = (0.15 + 0.8 * rv(30, q + 160)) * H
      th = inputs.sunAzimuth + Math.PI + (rv(30, q + 200) + rv(30, q + 240) - 1) * 2.2
    }
    if (hP < 0.14 * H) continue
    const nD: V3 = [Math.sin(th), 0, Math.cos(th)]
    const cH = centre(hP)
    const o: V3 = [cH[0] + nD[0] * (Rat(hP) * 3.2), hP, cH[1] + nD[2] * (Rat(hP) * 3.2)]
    const t = probe.cast(o, [-nD[0], 0, -nD[2]], 60, true)
    if (t < 0) continue
    const sp3: V3 = [o[0] - nD[0] * t, hP, o[2] - nD[2] * t]
    const nm = probe.normalAt(sp3)
    const tt = probe.cast([sp3[0] - nm[0] * 0.8, sp3[1] - nm[1] * 0.8, sp3[2] - nm[2] * 0.8], [-nm[0], -nm[1], -nm[2]], 40, false)
    const T = tt < 0 ? 0 : tt + 0.8
    const r = Math.min((1.1 + 2 * Math.pow(rv(30, q + 300), 1.8)) * size * (0.8 + 0.4 * moist), 0.3 * T, 3.4)
    if (r < 0.8) continue
    const c: V3 = [sp3[0] - nm[0] * 0.2 * r, sp3[1] - nm[1] * 0.2 * r, sp3[2] - nm[2] * 0.2 * r]
    const du = nm[1]
    let ay = norm3([-nm[0] * du, 1 - nm[1] * du, -nm[2] * du])
    if (Math.abs(du) > 0.95) ay = norm3(cross3(nm, [1, 0, 0]))
    carves.push({ kind: 'ell', role: 'pit', c, ax: norm3(cross3(ay, nm)), ay, az: nm, r: [r, r * 1.4, r * 1.05], t0: clamp(0.42 + 0.5 * rv(30, q + 330), 0, 1), span: 0.28, k: 1 })
    pits += 1
  }

  // ---- ground and measures ----
  const cell = 1.25 * clamp(size, 0.75, 1.2)
  let lox = 1e9
  let hix = -1e9
  let loz = 1e9
  let hiz = -1e9
  let minX = 1e9
  let maxX = -1e9
  let minZ = 1e9
  let maxZ = -1e9
  for (const p of prims) {
    const rr = p.kind === 'rib' ? Math.max(p.a, p.b) + Math.hypot(p.ex - p.cx, p.ez - p.cz) : Math.max(p.a, p.b) * (1 + p.frill) + (p.kind === 'apron' ? 0 : 0)
    const xs = p.kind === 'rib' ? [p.cx, p.ex] : [p.cx]
    const zs = p.kind === 'rib' ? [p.cz, p.ez] : [p.cz]
    lox = Math.min(lox, Math.min(...xs) - rr - NEAR - 4)
    hix = Math.max(hix, Math.max(...xs) + rr + NEAR + 4)
    loz = Math.min(loz, Math.min(...zs) - rr - NEAR - 4)
    hiz = Math.max(hiz, Math.max(...zs) + rr + NEAR + 4)
    if (p.kind === 'tier') {
      minX = Math.min(minX, p.cx - p.a)
      maxX = Math.max(maxX, p.cx + p.a)
      minZ = Math.min(minZ, p.cz - p.a)
      maxZ = Math.max(maxZ, p.cz + p.a)
    }
  }
  const measure: Record<string, number> = {
    length: Math.round(Math.max(maxX - minX, maxZ - minZ)),
    width: Math.round(Math.min(maxX - minX, maxZ - minZ)),
    height: Math.round(H),
    massifs: n,
    openings: voidN + portals,
    openingWidth: Math.round(openW * 10) / 10,
    openingHeight: Math.round(openH * 10) / 10,
    openingArea: Math.round(voidArea + portalArea),
    chamber: Math.round(voidVol + passageVol),
    windows,
    pits,
    skirt: Math.round(ad.skirt * 100) / 100,
    spineAzimuth: Math.round(((((leanAz * 180) / Math.PI) % 180) + 180) % 180),
    roof: Math.round(Math.max(0, ...levels.map((l) => l.reach))),
  }
  const stats: Record<string, number | string> = { height: measure.height!, openings: `${voidN} voids, ${portals} portals, ${windows} windows, ${pits} pits`, massifs: `${n} tiers, ${shelves.length} shelves, ${ribs.length} ribs` }
  return { site, y0, cell, prims, carves, skirt: ad.skirt, moisture: moist, ground: groundGrid(site, lox, hix, loz, hiz, cell), measure, stats }
}
void smooth
