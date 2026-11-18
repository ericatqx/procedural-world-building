import { landscapeHeight } from '../project03/terrain.ts'
import { adaptationOf, clamp, cross3, groundGrid, makeProbe, NEAR, norm3, smooth, type Carve, type PathNode, type PorousInputs, type PorousPlan, type Prim, type V3 } from './porousGrowth.ts'

/**
 * Architecture Lab: Porous Growth, HYBRID (experimental). A third growth direction on the same field, growth and carving, built from
 * growth PATHS instead of massifs or tiers. Vertical and lateral growth are not stages: a stem rises and sheds lateral bridges
 * while it is still rising; a reaching arm leaves it early, droops under its own load and roots again, and sends a shoot up
 * while it is still reaching; their balance comes from the seed, the place and the wind, and age only decides how much of each has
 * arrived. Space is what the fused parts leave, not what is cut from a mass:
 *   - stems: two or three paths that rise around a shared hollow, twisting, and part where the hollow swells and fuse where it
 *     waists: the hollow they enclose is open to the outside between them;
 *   - bridges: paths that leave one stem, arc across or around, and fuse into the next: each frames a window between itself and
 *     the stems it joins, and its cross-section stands on edge, so it reads as a vault, not a shelf;
 *   - a reaching arm (and a prop where it does not meet the ground): lateral extension, whose section turns from broad at its
 *     root to upright at its foot, so it comes down as a pier;
 *   - recession: the tissue that is thick and exposed (to the wind, and to shade) wears into scoops with age: a geometric change,
 *     which opens the wide ribbons into windows.
 * Every path is one distance field along its nodes (a ribbon of tissue, wider than it is thick), so there are no chain joints.
 * Wind is fixed inside (it blows from a set azimuth to the sun's) but it acts: stems and arms lean and reach to the lee, the windward
 * stem stays shorter and thicker, and the scoops open on the windward face. Habitat adaptation is the shared one (adaptationOf).
 */
export function growHybrid(seed: number, site: [number, number], inputs: PorousInputs): PorousPlan {
  const rv = (a: number, b: number) => {
    const n = Math.sin(seed * 12.9898 + a * 78.233 + b * 37.719 + 1.7) * 43758.5453
    return n - Math.floor(n)
  }
  const y0 = landscapeHeight(site[0], site[1])
  const S = clamp(inputs.size, 0.55, 1.2)
  const light = clamp(inputs.light)
  const moist = clamp(inputs.moisture)
  const crowd = clamp(inputs.crowding)
  const ad = adaptationOf(inputs)
  const { ridgeP, hollowP, near } = ad

  // ---- the fixed wind, and what the place and the sun give ----
  const windAz = inputs.sunAzimuth + 2.2
  const windK = 0.45 + 0.5 * ridgeP + 0.1 * (1 - crowd)
  const lee: [number, number] = [Math.sin(windAz), Math.cos(windAz)]
  const sun: [number, number] = [Math.sin(inputs.sunAzimuth), Math.cos(inputs.sunAzimuth)]
  const freeAz = rv(1, 8) * Math.PI * 2 + Math.PI
  const free: [number, number] = [Math.sin(freeAz), Math.cos(freeAz)]
  const leanRaw: [number, number] = [sun[0] * 0.7 + lee[0] * windK * 0.7, sun[1] * 0.7 + lee[1] * windK * 0.7]
  const leanLen = Math.hypot(leanRaw[0], leanRaw[1]) || 1
  const leanDir: [number, number] = [leanRaw[0] / leanLen, leanRaw[1] / leanLen]

  const H = 42 * S * ad.height * (0.8 + 0.4 * rv(40, 0))
  const nS = rv(40, 1) < 0.68 ? 3 : 2
  const Rc = 8.5 * S * (0.85 + 0.4 * rv(40, 2)) * ad.width
  const bulge = 0.45 + 0.6 * rv(40, 4)
  const turns = (rv(40, 3) - 0.5) * 1.6
  const a0 = rv(40, 5) * Math.PI * 2
  const tall = Math.floor(rv(40, 6) * nS)
  const lean = (0.05 + 0.22 * light) * H * (0.5 + rv(40, 7))
  const r0 = 3 * S * (0.85 + 0.4 * rv(40, 8)) * Math.sqrt(ad.width)
  const w0 = 1.35 + 0.3 * rv(40, 9)
  const cShift: [number, number] = [free[0] * 0.12 * H * crowd, free[1] * 0.12 * H * crowd]
  const E = { ex: 0, ez: 0, hc: 0, hv: 0, taper: 0, flat: 0, hb: 0, frill: 0, ph: 0 }
  const prims: Prim[] = []
  type P = { nodes: PathNode[]; birth: number; dur: number; kind: 'stem' | 'bridge' | 'reach' | 'prop' | 'shoot'; landed?: boolean }
  const paths: P[] = []
  const add = (nodes: PathNode[], birth: number, dur: number, kind: P['kind'], landed?: boolean) => {
    paths.push({ nodes, birth, dur, kind, landed })
    prims.push({ ...E, kind: 'path', cx: nodes[0]!.x, cz: nodes[0]!.z, hc: nodes[0]!.h, sin: 0, cos: 1, a: 0, b: 0, h: 0, leanX: 0, leanZ: 0, birth, dur, nodes })
  }
  const unit = (x: number, h: number, z: number): [number, number, number] => {
    const l = Math.hypot(x, h, z) || 1
    return [x / l, h / l, z / l]
  }

  // ---- stems: rise around a shared hollow, twisting; the hollow swells between them and waists where they fuse ----
  const Rof = (t: number) => Rc * (0.85 + bulge * Math.sin(Math.PI * clamp(t) * 0.78))
  const stems: { H: number; birth: number; dur: number; pos: (t: number) => V3; r: (t: number) => number; a: number; windward: number }[] = []
  const M = 15
  for (let j = 0; j < nS; j += 1) {
    const aj = a0 + (2 * Math.PI * j) / nS + (rv(43, j) - 0.5) * 0.4
    const windward = Math.max(0, -(Math.cos(aj) * lee[0] + Math.sin(aj) * lee[1]))
    const Hj = H * (j === tall ? 1 : 0.62 + 0.3 * rv(44, j)) * (1 - 0.22 * windK * windward)
    const rj = r0 * (1 + 0.25 * windK * windward)
    const pos = (t: number): V3 => {
      const a = aj + 2 * Math.PI * turns * Math.pow(t, 1.2)
      const R = Rof(t)
      return [cShift[0] + Math.cos(a) * R + leanDir[0] * lean * Math.pow(t, 1.7), Hj * Math.pow(t, 0.92), cShift[1] + Math.sin(a) * R + leanDir[1] * lean * Math.pow(t, 1.7)]
    }
    const rr = (t: number) => rj * (1 - 0.3 * Math.pow(t, 1.3)) * (0.92 + 0.16 * Math.sin(5 * t + rv(43, j + 9) * 6))
    const nodes: PathNode[] = []
    for (let k = 0; k < M; k += 1) {
      const t = k / (M - 1)
      const p = pos(t)
      const a = aj + 2 * Math.PI * turns * Math.pow(t, 1.2)
      nodes.push({ x: p[0], h: p[1], z: p[2], r: rr(t) * (k === M - 1 ? 0.8 : 1), w: w0 * (1 - 0.1 * t), sx: -Math.sin(a), sh: 0, sz: Math.cos(a) })
    }
    const birth = 0.03 + 0.05 * j
    const dur = 0.88 + 0.06 * rv(43, j + 20)
    add(nodes, birth, dur, 'stem')
    stems.push({ H: Hj, birth, dur, pos, r: rr, a: aj, windward })
  }
  const tAt = (st: (typeof stems)[number], y: number) => clamp(Math.pow(clamp(y / st.H), 1 / 0.92))
  const arrAt = (st: (typeof stems)[number], y: number) => st.birth + st.dur * tAt(st, y)

  // ---- bridges: leave one stem, arc across or around, fuse into the next; unevenly spaced ----
  const fr: number[] = Array.from({ length: 9 }, (_, i) => 0.1 + 0.75 * rv(41, i)).sort((p, q) => p - q)
  const picked: number[] = []
  for (const f of fr) if (picked.every((q) => Math.abs(q - f) > 0.1)) picked.push(f)
  const nB = Math.min(picked.length, 3 + Math.floor(rv(41, 9) * 3 + 1.5 * hollowP))
  let bridges = 0
  for (let q = 0; q < nB; q += 1) {
    const iA = Math.floor(rv(41, q + 20) * nS)
    const A = stems[iA]!
    const B = stems[(iA + 1) % nS]!
    const yA = Math.min(picked[q]! * A.H, 0.95 * A.H)
    const yB = Math.min(yA * (0.9 + 0.3 * rv(41, q + 30)), 0.95 * B.H)
    const pA = A.pos(tAt(A, yA))
    const pB = B.pos(tAt(B, yB))
    const mid: V3 = [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2, (pA[2] + pB[2]) / 2]
    const out = unit(mid[0] - cShift[0], 0, mid[2] - cShift[1])
    const chord = Math.hypot(pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2])
    const sgn = rv(41, q + 40) < 0.4 ? -1 : 1
    const push = sgn * chord * (0.06 + 0.16 * rv(41, q + 50))
    const ctl: V3 = [mid[0] + out[0] * push, mid[1] + 0.07 * H, mid[2] + out[2] * push]
    const rb = A.r(tAt(A, yA)) * (0.8 + 0.25 * rv(41, q + 60))
    const wb = 2.2 + 0.8 * rv(41, q + 70)
    const nodes: PathNode[] = []
    for (let k = 0; k <= 9; k += 1) {
      const t = k / 9
      const u = 1 - t
      nodes.push({ x: u * u * pA[0] + 2 * u * t * ctl[0] + t * t * pB[0], h: u * u * pA[1] + 2 * u * t * ctl[1] + t * t * pB[1], z: u * u * pA[2] + 2 * u * t * ctl[2] + t * t * pB[2], r: rb * (0.85 + 0.3 * Math.sin(Math.PI * t)), w: wb, sx: 0, sh: 1, sz: 0 })
    }
    add(nodes, Math.max(arrAt(A, yA), arrAt(B, yB)) + 0.03, 0.28, 'bridge')
    bridges += 1
  }

  // ---- reaching arms: lateral extension that starts early, droops under its load and roots, or is propped ----
  const nR = Math.max(1, Math.min(3, 1 + (light > 0.5 ? 1 : 0) + (rv(42, 0) < 0.4 ? 1 : 0) - (crowd > 0.6 ? 1 : 0)))
  let arches = 0
  let reachMax = 0
  for (let i = 0; i < nR; i += 1) {
    const st = i === 0 ? stems[tall]! : stems[Math.floor(rv(42, i + 10) * nS)]!
    const yA = st.H * (0.28 + 0.25 * rv(42, i + 1))
    const tA = tAt(st, yA)
    const p0 = st.pos(tA)
    let base = Math.atan2(sun[0] + lee[0] * windK * 0.8, sun[1] + lee[1] * windK * 0.8)
    // Close water draws the arm toward it (the damp shore).
    if (inputs.waterAzimuth !== null && near > 0.3) base += Math.atan2(Math.sin(inputs.waterAzimuth - base), Math.cos(inputs.waterAzimuth - base)) * 0.6 * near
    let az = base + (rv(42, i + 5) - 0.5) * 1.2 + i * 2.0
    if (crowd > 0.4 && Math.sin(az) * free[0] + Math.cos(az) * free[1] < 0) az += Math.PI * 0.8
    const step = 2.4 * S
    const Lreach = 13 * S * (0.6 + 0.8 * ad.roof) * ad.length * (1 + 0.3 * windK * Math.max(0, Math.sin(az) * lee[0] + Math.cos(az) * lee[1]))
    const maxN = Math.max(6, Math.round(Lreach / step))
    let e = 0.05 + 0.25 * rv(42, i + 20)
    const d0 = (0.08 + 0.04 * rv(42, i + 30)) * (1 + 0.4 * (1 - light))
    const pts: V3[] = [p0]
    let landed = false
    let c: V3 = p0
    for (let k = 1; k <= maxN; k += 1) {
      e = Math.max(-1.3, e - d0 - 0.012 * k)
      const ce = Math.cos(e)
      c = [c[0] + Math.sin(az + 0.12 * Math.sin(k * 0.6 + i)) * ce * step, c[1] + Math.sin(e) * step, c[2] + Math.cos(az + 0.12 * Math.sin(k * 0.6 + i)) * ce * step]
      if (k > 2 && c[1] <= 0.8) {
        pts.push([c[0], -1.5, c[2]])
        landed = true
        break
      }
      pts.push(c)
    }
    const n = pts.length
    const rA = st.r(tA)
    const hp: [number, number] = [Math.cos(az), -Math.sin(az)]
    const nodes: PathNode[] = pts.map((q, k) => {
      const t = k / Math.max(1, n - 1)
      const sd = norm3([hp[0] * (1 - smooth(0.25, 0.9, t)), smooth(0.25, 0.9, t), hp[1] * (1 - smooth(0.25, 0.9, t))])
      const foot = landed ? 1 + 0.5 * smooth(0.75, 1, t) : 1
      return { x: q[0], h: q[1], z: q[2], r: rA * (1.0 - 0.3 * smooth(0, 0.6, t)) * foot, w: 3 - 1.1 * t, sx: sd[0], sh: sd[1], sz: sd[2] }
    })
    const birth = arrAt(st, yA) + 0.03
    add(nodes, birth, 0.5, 'reach', landed)
    reachMax = Math.max(reachMax, Math.hypot(pts[n - 1]![0] - p0[0], pts[n - 1]![2] - p0[2]))
    if (landed) arches += 1
    else {
      // A prop where it does not meet the ground: from under it, straight down, fused at its foot.
      const m = Math.floor(0.62 * (n - 1))
      const top = pts[m]!
      const pn: PathNode[] = []
      for (let k = 0; k <= 7; k += 1) {
        const t = k / 7
        pn.push({ x: top[0] - Math.sin(az) * 2 * t, h: top[1] * (1 - t) - 1.5 * t, z: top[2] - Math.cos(az) * 2 * t, r: rA * (0.5 + 0.35 * smooth(0.7, 1, t)), w: 1.5, sx: Math.cos(az), sh: 0, sz: -Math.sin(az) })
      }
      add(pn, birth + 0.3, 0.25, 'prop', true)
    }
    // A shoot rising from the arm while it is still reaching: vertical growth on the lateral path.
    if (rv(42, i + 40) < 0 && n > 5) {
      const m = Math.floor(0.45 * (n - 1))
      const top = pts[m]!
      const sn: PathNode[] = []
      const len = 0.18 * H * (0.6 + 0.6 * rv(42, i + 50))
      for (let k = 0; k <= 6; k += 1) {
        const t = k / 6
        sn.push({ x: top[0] + sun[0] * len * 0.25 * t * t, h: top[1] + len * t, z: top[2] + sun[1] * len * 0.25 * t * t, r: rA * 0.75 * (1 - 0.6 * t), w: 2.2, sx: Math.cos(az), sh: 0, sz: -Math.sin(az) })
      }
      add(sn, birth + 0.25, 0.3, 'shoot')
    }
  }

  // The ground the stems stand on: a broad skirt that joins their feet, and a floor inside the hollow.
  for (const st of stems) {
    const p = st.pos(0)
    prims.push({ ...E, kind: 'apron', cx: p[0], cz: p[2], sin: 0, cos: 1, a: r0 * 2.1 * Math.sqrt(ad.skirt), b: r0 * 2.1 * Math.sqrt(ad.skirt), h: 0, leanX: 0, leanZ: 0, birth: 0, dur: 0.35 })
  }

  // ---- recession: thick, exposed tissue wears into scoops with age: on the windward face and in the shade ----
  const probe = makeProbe(prims, ad.skirt)
  const carves: Carve[] = []
  const nRec = 2 + Math.round(1.5 * moist + 1.5 * windK)
  const worn = paths.filter((p) => p.kind === 'stem' || p.kind === 'reach')
  let recessArea = 0
  let recessN = 0
  let big = 0
  for (let q = 0; q < nRec && worn.length > 0; q += 1) {
    const pa = worn[Math.floor(rv(45, q) * worn.length)]!
    const j = Math.floor((0.25 + 0.55 * rv(45, q + 40)) * (pa.nodes.length - 1))
    const nd = pa.nodes[j]!
    if (nd.h < 0.12 * H && pa.kind === 'stem') continue
    const az = (rv(45, q + 80) < 0.55 ? windAz + Math.PI : inputs.sunAzimuth + Math.PI) + (rv(45, q + 120) - 0.5) * 1.4
    const nD: V3 = [Math.sin(az), 0, Math.cos(az)]
    const far = nd.r * nd.w + 12
    const o: V3 = [nd.x + nD[0] * far, nd.h, nd.z + nD[2] * far]
    const t = probe.cast(o, [-nD[0], 0, -nD[2]], 50, true)
    if (t < 0) continue
    const E0: V3 = [o[0] - nD[0] * t, nd.h, o[2] - nD[2] * t]
    const nm = probe.normalAt(E0)
    const tt = probe.cast([E0[0] - nm[0] * 0.8, E0[1] - nm[1] * 0.8, E0[2] - nm[2] * 0.8], [-nm[0], -nm[1], -nm[2]], 40, false)
    const T = tt < 0 ? 0 : tt + 0.8
    if (T < 5) continue
    const rho = Math.min(ad.opening * (0.45 + 0.2 * rv(45, q + 160)) * T, 0.42 * T, 5.5 * S)
    if (rho < 1.6) continue
    const c: V3 = [E0[0] - nm[0] * 0.2 * rho, E0[1] - nm[1] * 0.2 * rho, E0[2] - nm[2] * 0.2 * rho]
    const du = nm[1]
    let ay = norm3([-nm[0] * du, 1 - nm[1] * du, -nm[2] * du])
    if (Math.abs(du) > 0.95) ay = norm3(cross3(nm, [1, 0, 0]))
    const arrival = pa.birth + pa.dur * (j / (pa.nodes.length - 1))
    carves.push({ kind: 'ell', role: 'recess', c, ax: norm3(cross3(ay, nm)), ay, az: nm, r: [rho, rho * 1.5, rho], t0: clamp(arrival + 0.22 + 0.12 * rv(45, q + 200), 0.35, 0.88), span: 0.3, k: 1.5 })
    recessN += 1
    recessArea += Math.PI * rho * rho * 1.5
    big = Math.max(big, rho)
  }
  // A few small pits, where the tissue is old.
  let pits = 0
  const nPit = Math.round((3 + 5 * moist) * (0.8 + 0.4 * S))
  for (let q = 0; q < nPit && worn.length > 0; q += 1) {
    const pa = worn[Math.floor(rv(46, q) * worn.length)]!
    const j = Math.floor((0.2 + 0.7 * rv(46, q + 30)) * (pa.nodes.length - 1))
    const nd = pa.nodes[j]!
    const az = rv(46, q + 60) * Math.PI * 2
    const nD: V3 = [Math.sin(az), 0, Math.cos(az)]
    const far = nd.r * nd.w + 12
    const o: V3 = [nd.x + nD[0] * far, nd.h, nd.z + nD[2] * far]
    const t = probe.cast(o, [-nD[0], 0, -nD[2]], 50, true)
    if (t < 0) continue
    const E0: V3 = [o[0] - nD[0] * t, nd.h, o[2] - nD[2] * t]
    if (E0[1] < 2.5) continue
    const nm = probe.normalAt(E0)
    const tt = probe.cast([E0[0] - nm[0] * 0.8, E0[1] - nm[1] * 0.8, E0[2] - nm[2] * 0.8], [-nm[0], -nm[1], -nm[2]], 40, false)
    const T = tt < 0 ? 0 : tt + 0.8
    const r = Math.min((1 + 1.6 * rv(46, q + 90)) * S, 0.3 * T)
    if (r < 0.8) continue
    const du = nm[1]
    let ay = norm3([-nm[0] * du, 1 - nm[1] * du, -nm[2] * du])
    if (Math.abs(du) > 0.95) ay = norm3(cross3(nm, [1, 0, 0]))
    carves.push({ kind: 'ell', role: 'pit', c: [E0[0] - nm[0] * 0.2 * r, E0[1] - nm[1] * 0.2 * r, E0[2] - nm[2] * 0.2 * r], ax: norm3(cross3(ay, nm)), ay, az: nm, r: [r, r * 1.4, r * 1.05], t0: clamp(0.5 + 0.4 * rv(46, q + 120), 0, 1), span: 0.28, k: 1 })
    pits += 1
  }

  // ---- ground and measures ----
  const cell = 1.2 * clamp(S, 0.75, 1.2)
  let lox = 1e9
  let hix = -1e9
  let loz = 1e9
  let hiz = -1e9
  let topH = 0
  for (const p of prims) {
    if (p.kind === 'path') {
      for (const q of p.nodes!) {
        const pad = q.r * q.w + NEAR + 4
        lox = Math.min(lox, q.x - pad)
        hix = Math.max(hix, q.x + pad)
        loz = Math.min(loz, q.z - pad)
        hiz = Math.max(hiz, q.z + pad)
        topH = Math.max(topH, q.h)
      }
    } else {
      const pad = Math.max(p.a, p.b) + NEAR + 4
      lox = Math.min(lox, p.cx - pad)
      hix = Math.max(hix, p.cx + pad)
      loz = Math.min(loz, p.cz - pad)
      hiz = Math.max(hiz, p.cz + pad)
    }
  }
  let minX = 1e9
  let maxX = -1e9
  let minZ = 1e9
  let maxZ = -1e9
  for (const p of paths) {
    for (const q of p.nodes) {
      minX = Math.min(minX, q.x)
      maxX = Math.max(maxX, q.x)
      minZ = Math.min(minZ, q.z)
      maxZ = Math.max(maxZ, q.z)
    }
  }
  const hollowR = Math.max(0, Rof(0.45) - r0 * w0)
  const measure: Record<string, number> = {
    length: Math.round(Math.max(maxX - minX, maxZ - minZ)),
    width: Math.round(Math.min(maxX - minX, maxZ - minZ)),
    height: Math.round(topH),
    massifs: nS,
    openings: bridges + arches + recessN,
    openingWidth: Math.round(2 * big * 10) / 10,
    openingHeight: Math.round(3 * big * 10) / 10,
    openingArea: Math.round(recessArea),
    chamber: Math.round(Math.PI * hollowR * hollowR * 0.45 * H),
    windows: bridges,
    pits,
    skirt: Math.round(ad.skirt * 100) / 100,
    spineAzimuth: Math.round(((((Math.atan2(leanDir[0], leanDir[1]) * 180) / Math.PI) % 180) + 180) % 180),
    roof: Math.round(reachMax),
  }
  const stats: Record<string, number | string> = { height: measure.height!, openings: `${bridges} bridges, ${arches} rooted arms, ${recessN} scoops, ${pits} pits`, massifs: `${nS} stems, ${nR} arms` }
  return { site, y0, cell, prims, carves, skirt: ad.skirt, moisture: moist, ground: groundGrid(site, lox, hix, loz, hiz, cell), measure, stats }
}
