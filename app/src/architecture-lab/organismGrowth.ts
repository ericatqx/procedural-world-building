import { landscapeHeight } from '../project03/terrain.ts'
import { adaptationOf, clamp, cross3, groundGrid, makeProbe, NEAR, norm3, smooth, type Carve, type Lobe, type Poro, type PorousInputs, type PorousPlan, type Prim, type V3 } from './porousGrowth.ts'

/**
 * Architecture Lab: the grown organism, for both morphology families. One growth engine (this file) and two rule sets.
 *
 * The body is a set of SHOOTS, each a chain of overlapping lobes laid down as its tip advances. At every step the tip's direction is
 * steered by a few forces (its own persistence, a pull up, a pull toward the light, the lee of the wind, away from crowding, along the
 * contour of the slope), and, for a shoot that reaches out sideways, by its LOAD: reach divided by what its girth can carry. Beyond
 * that limit it droops, so a long reach arcs down and lands (a rooted arch) rather than hanging out straight. A tip that comes within
 * a girth of another shoot FUSES with it and stops: a bridge is laid, so loops and the spaces inside them come from the growth, not
 * from a cut. A tip that reaches the ground ROOTS: it flares into a foot. Branches leave shoots at intervals, and toes crawl along the
 * ground (longer downhill and toward water). Every lobe has an arrival age, so age is real growth: shoots lengthen together, thicken
 * behind their tips, and shoots that began later are younger.
 *
 * Space is made two ways. First, by structure: the room under a cantilever, between a keep and a pier, inside a loop. Second, by WEAR
 * (see Poro in porousGrowth.ts): with age, tissue opens where weathering is strong (domain-warped noise, stretched along the way the
 * organism grows: tall slots in a tall body, long ones in a wide one), and, for the Overhang, as pockets on shaded undersides. The
 * core of every shoot is protected, so supports and spines are never worn away.
 *
 * OVERHANG: stout keeps; shelves that are lateral shoots, flattened and thick at the root, aimed where the light, the ground and the
 * neighbours leave room; supports where the load is, placed by the load (a long reach is propped by piers under it, a short one is not);
 * a lower shelf that cascades from a shelf's end; an outlier body that a shelf may come to rest on. POROUS GROWTH: no keep and no
 * shelf, just shoots whose pull to the light and to the sky is each its own, from the seed and the place, so one organism can rise,
 * reach, arch and root at once.
 */
export type Family = 'overhang' | 'porous'

type B = { x: number; h: number; z: number; r: number; t: V3; wid: number; thick: number; elong: number; arr: number; shoot: number; idx: number; sa?: [number, number]; prev?: B }
type Shoot = { id: number; parent: number; parentIdx: number; chain: { shoot: number; idx: number }[]; blobs: B[]; landed: boolean; fused: boolean; t0: number; t1: number; kind: string; lenMax: number }
type Spec = { up: number; light: number; lat: number; contour: number; limit: number; taper: number; rmin: number; wid: number; thick: number; elong: number; maxLen: number; hmax: number; branch: number; every: number; childUp: number; crawl?: boolean; pier?: boolean; sfix?: [number, number]; seekW?: number; seekMax?: number }

export function growOrganism(family: Family, seed: number, site: [number, number], inputs: PorousInputs): PorousPlan {
  const rv = (a: number, b: number) => {
    const n = Math.sin(seed * 12.9898 + a * 78.233 + b * 37.719 + 1.7) * 43758.5453
    return n - Math.floor(n)
  }
  const y0 = landscapeHeight(site[0], site[1])
  const S = clamp(inputs.size, 0.55, 1.2)
  const light = clamp(inputs.light)
  const moist = clamp(inputs.moisture)
  const res = clamp(inputs.resource)
  const crowd = clamp(inputs.crowding)
  const ad = adaptationOf(inputs)
  const { ridgeP, hollowP, near } = ad

  // ---- what the place gives ----
  const sunAz = inputs.sunAzimuth
  const sun2: [number, number] = [Math.sin(sunAz), Math.cos(sunAz)]
  const windAz = sunAz + 2.2
  const windK = 0.45 + 0.5 * ridgeP + 0.1 * (1 - crowd)
  const lee2: [number, number] = [Math.sin(windAz), Math.cos(windAz)]
  const freeAz = rv(1, 8) * Math.PI * 2 + Math.PI
  const free2: [number, number] = [Math.sin(freeAz), Math.cos(freeAz)]
  const e = 18
  const gx = (landscapeHeight(site[0] + e, site[1]) - landscapeHeight(site[0] - e, site[1])) / (2 * e)
  const gz = (landscapeHeight(site[0], site[1] + e) - landscapeHeight(site[0], site[1] - e)) / (2 * e)
  const slopeMag = Math.hypot(gx, gz)
  const down2: [number, number] | null = slopeMag > 0.03 ? [-gx / slopeMag, -gz / slopeMag] : null
  const contour2: [number, number] = down2 ? [-down2[1], down2[0]] : [-sun2[1], sun2[0]]
  const water2: [number, number] | null = inputs.waterAzimuth !== null && near > 0.05 ? [Math.sin(inputs.waterAzimuth), Math.cos(inputs.waterAzimuth)] : null

  const blobs: B[] = []
  const shoots: Shoot[] = []
  const pending: { root?: B | null; spec: Spec; x: number; h: number; z: number; d: V3; r: number; parent: number; parentIdx: number; t0: number; t1: number; kind: string }[] = []
  let fusions = 0
  let feet = 0
  const founders: B[] = []

  const pushFounder = (b: Omit<B, 'shoot' | 'idx'>) => {
    const f: B = { ...b, shoot: -1, idx: 0 }
    blobs.push(f)
    founders.push(f)
  }

  /** One shoot: its tip advances, steered and loaded; it roots, fuses, branches or ends. */
  const growShoot = (spec: Spec, x0: number, h0: number, z0: number, d0: V3, r0: number, parent: number, parentIdx: number, t0: number, t1: number, kind: string, depth: number, root: B | null = null) => {
    const sh: Shoot = { id: shoots.length, parent, parentIdx, chain: parent >= 0 ? [{ shoot: parent, idx: parentIdx }, ...shoots[parent]!.chain] : [], blobs: [], landed: false, fused: false, t0, t1, kind, lenMax: spec.maxLen }
    shoots.push(sh)
    let x = x0
    let h = h0
    let z = z0
    let d: V3 = norm3(d0)
    let r = r0
    let length = 0
    let k = 0
    const jit = (a: number) => rv(70 + sh.id * 5, k * 3 + a) - 0.5
    while (length < spec.maxLen && k < 90) {
      k += 1
      const step = Math.max(1.7, 0.6 * r)
      const reach = Math.hypot(x - x0, z - z0)
      const load = spec.limit > 90 ? 0 : reach / (spec.limit * r)
      const droop = Math.max(0, load - 0.55)
      let vx = d[0]
      let vh = d[1]
      let vz = d[2]
      if (spec.crawl) {
        vx += jit(0) * 0.25
        vz += jit(2) * 0.25
        vh = 0
      } else {
        vh += spec.up * 0.2
        vx += sun2[0] * spec.light * 0.2 * (1 - 0.4 * spec.up)
        vz += sun2[1] * spec.light * 0.2 * (1 - 0.4 * spec.up)
        vh += spec.light * 0.03
        vx += lee2[0] * windK * spec.lat * 0.07
        vz += lee2[1] * windK * spec.lat * 0.07
        vx += free2[0] * crowd * 0.12
        vz += free2[1] * crowd * 0.12
        if (down2) {
          const sgn = Math.sign(d[0] * contour2[0] + d[2] * contour2[1]) || 1
          vx += contour2[0] * sgn * slopeMag * spec.contour * 0.9
          vz += contour2[1] * sgn * slopeMag * spec.contour * 0.9
        }
        vh -= droop * 1.5
        // Reaching shoots lean toward other shoots near their height, so what they leave between them closes into loops.
        if (spec.up < 0.7 && k > 6) {
          let best = 1e9
          let tx = 0
          let th = 0
          let tz = 0
          for (const o of blobs) {
            if (o.shoot === sh.id) continue
            const ch = sh.chain.find((c) => c.shoot === o.shoot)
            if (ch && Math.abs(o.idx - ch.idx) < 14) continue
            const dx = o.x - x
            const dh = o.h - h
            const dz = o.z - z
            const dist = Math.hypot(dx, dh, dz)
            if (dist < 1.1 * r || dist > (spec.seekMax ?? 5.5) * r || dist > best) continue
            if ((dx * d[0] + dh * d[1] + dz * d[2]) / dist < 0.15) continue
            best = dist
            tx = dx / dist
            th = dh / dist
            tz = dz / dist
          }
          if (best < 1e8) {
            const w = (spec.seekW ?? 0.34) * (1 - best / ((spec.seekMax ?? 5.5) * r + 2))
            vx += tx * w
            vh += th * w
            vz += tz * w
          }
        }
        if (h > spec.hmax) vh -= 0.5
        vx += jit(0) * 0.12
        vh += jit(1) * 0.08
        vz += jit(2) * 0.12
      }
      const vn = norm3([vx, vh, vz])
      const blend = spec.crawl ? 0.5 : 0.22
      d = norm3([d[0] * (1 - blend) + vn[0] * blend, d[1] * (1 - blend) + vn[1] * blend, d[2] * (1 - blend) + vn[2] * blend])
      x += d[0] * step
      h += d[1] * step
      z += d[2] * step
      length += step
      r = Math.max(spec.rmin, r * Math.pow(spec.taper, step))
      if (spec.crawl) h = r * spec.thick * 0.75
      const bottom = h - r * spec.thick * 0.9
      // Roots: a tip heading down that reaches the ground flares into a foot and stops.
      if (!spec.crawl && k > 3 && bottom <= 0 && d[1] < 0.2) {
        const hf = r * 0.5
        const fb: B = { x, h: hf, z, r: r * 1.5, t: norm3([d[0], 0, d[2]]), wid: 1.35, thick: 0.62, elong: 1.2, arr: 0, shoot: sh.id, idx: k, prev: sh.blobs[sh.blobs.length - 1] ?? root ?? undefined }
        sh.blobs.push(fb)
        blobs.push(fb)
        sh.landed = true
        feet += 1
        break
      }
      if (!spec.crawl && bottom < 0) {
        h = r * spec.thick * 0.9
        d = norm3([d[0], Math.max(d[1], 0.08), d[2]])
      }
      // Fusion: coming within a girth of another shoot's tissue joins the two and ends this one.
      let fuseWith: B | null = null
      if (!spec.crawl && k > 4) {
        for (const o of blobs) {
          if (o.shoot === sh.id) continue
          const ch = sh.chain.find((c) => c.shoot === o.shoot)
          if (ch && Math.abs(o.idx - ch.idx) < 9) continue
          if (o.shoot === -1 && k < 9) continue
          if (Math.hypot(o.x - x, o.h - h, o.z - z) < 0.72 * (r + o.r)) {
            fuseWith = o
            break
          }
        }
      }
      const b: B = { x, h, z, r, t: d, wid: spec.wid, thick: spec.thick, elong: spec.elong, arr: 0, shoot: sh.id, idx: k, sa: spec.sfix, prev: sh.blobs.length > 0 ? sh.blobs[sh.blobs.length - 1] : (root ?? undefined) }
      sh.blobs.push(b)
      blobs.push(b)
      if (fuseWith) {
        const bt = norm3([fuseWith.x - x, fuseWith.h - h, fuseWith.z - z])
        const bridge: B = { x: (x + fuseWith.x) / 2, h: (h + fuseWith.h) / 2, z: (z + fuseWith.z) / 2, r: Math.max(r, fuseWith.r) * 0.95, t: bt, wid: 1.15, thick: 1, elong: 1.3, arr: 0, shoot: sh.id, idx: k + 1, prev: b }
        sh.blobs.push(bridge)
        blobs.push(bridge)
        sh.fused = true
        fusions += 1
        break
      }
      // Branches leave at intervals, to either side and rising.
      if (!spec.crawl && depth < 2 && shoots.length + pending.length < 11 && k >= 5 && (k - 5) % spec.every === 0 && rv(80 + sh.id, k) < spec.branch && r > spec.rmin * 1.25) {
        const side: V3 = [-d[2], 0, d[0]]
        const sg = rv(81 + sh.id, k) < 0.5 ? 1 : -1
        const cd = norm3([d[0] * 0.5 + side[0] * 0.8 * sg, spec.childUp + 0.15, d[2] * 0.5 + side[2] * 0.8 * sg])
        pending.push({ root: b, spec: { ...spec, up: clamp(spec.up + spec.childUp * 0.5 + (rv(82 + sh.id, k) - 0.5) * 0.6), maxLen: spec.maxLen * 0.55, branch: spec.branch * 0.6, hmax: spec.hmax }, x, h, z, d: cd, r: r * 0.72, parent: sh.id, parentIdx: k, t0: 0, t1: 0, kind: 'branch' })
      }
    }
    if (sh.blobs.length > 0 && !sh.landed && !sh.fused) {
      const last = sh.blobs[sh.blobs.length - 1]!
      last.r *= 1.0
    }
    return sh
  }
  const drain = (depth0: number) => {
    let guard = 0
    while (pending.length > 0 && guard < 20) {
      guard += 1
      const p = pending.shift()!
      growShoot(p.spec, p.x, p.h, p.z, p.d, p.r, p.parent, p.parentIdx, p.t0, p.t1, p.kind, depth0 + 1, p.root ?? null)
    }
  }

  // ---- founders: the body the shoots leave ----
  const base = (6.5 + 2.5 * rv(2, 0)) * S * Math.sqrt(ad.width)
  const keepTop: B[] = []
  type Body = { blobs: B[]; r: number; x: number; z: number; top: number }
  const bodies: Body[] = []
  if (family === 'overhang') {
    // One to three bodies of different height and girth along the contour: a tall keep with lower ones beside it, two towers, one broad mass.
    // How many, how tall and how far apart come from the seed and the place (richer ground and open ground raise more and taller bodies).
    const nBody = 1 + (rv(2, 10) < 0.35 + 0.4 * res ? 1 : 0) + (rv(2, 11) < 0.15 + 0.2 * res * (1 - crowd) ? 1 : 0)
    let cursor = 0
    for (let b = 0; b < nBody; b += 1) {
      const hf = b === 0 ? 1 : 0.4 + 0.5 * rv(2, 12 + b)
      const rb = base * (0.9 + 0.5 * rv(2, 15 + b)) * (b === 0 ? 1.15 : 1) * Math.sqrt(ad.width)
      const nK = Math.max(2, Math.round((2.2 + 3.2 * hf) * (0.85 + 0.3 * ad.height)))
      if (b > 0) cursor += (bodies[b - 1]!.r + rb) * (1 + 0.8 * rv(2, 18 + b)) * (b % 2 === 1 ? 1 : -1.2)
      const stack: B[] = []
      let hPrev = 0
      let rPrev = 0
      for (let k = 0; k < nK; k += 1) {
        const rk = rb * (1.15 - 0.2 * k * (4 / nK)) * (0.9 + 0.2 * rv(2, 20 + b * 7 + k))
        const lean = 0.3 * k * k * S * (0.5 + rv(2, 40 + b))
        const hk = k === 0 ? rk * 0.9 : hPrev + 0.62 * (rPrev + rk)
        hPrev = hk
        rPrev = rk
        const wob = (rv(2, 60 + b * 9 + k) - 0.5) * 1.1 * rk * (k === 0 ? 0.3 : 1)
        const wob2 = (rv(2, 70 + b * 9 + k) - 0.5) * 0.9 * rk * (k === 0 ? 0.3 : 1)
        const f: B = { x: contour2[0] * (cursor + wob) + sun2[0] * (lean + wob2), h: hk, z: contour2[1] * (cursor + wob) + sun2[1] * (lean + wob2), r: rk, t: [0, 1, 0] as V3, wid: 1.05, thick: 1, elong: 1.05, arr: 0.04 + 0.34 * Math.pow(k / Math.max(1, nK - 1), 0.9) + 0.04 * b, shoot: -1, idx: 0 }
        if (k > 0) f.prev = stack[stack.length - 1]
        blobs.push(f)
        founders.push(f)
        stack.push(f)
      }
      bodies.push({ blobs: stack, r: rb, x: contour2[0] * cursor, z: contour2[1] * cursor, top: stack[stack.length - 1]!.h })
      keepTop.push(...stack)
    }
  } else {
    // A compact, asymmetric cluster of thick bodies of different heights, fused where they meet: the mass the openings are grown through.
    // How many, and how tall each, come from the seed and the place (shelter and shade raise them; exposure and crowding keep them low).
    const nBody = 3 + (rv(2, 1) < 0.5 ? 1 : 0) + (res > 0.6 && rv(2, 4) < 0.4 ? 1 : 0)
    const vig = clamp(0.5 + 0.35 * (1 - light) + 0.3 * hollowP - 0.4 * ridgeP + (rv(2, 5) - 0.5) * 0.4)
    const placed: { x: number; z: number; r: number }[] = []
    for (let b = 0; b < nBody; b += 1) {
      const rb = base * (1.0 + 0.55 * rv(2, 15 + b)) * Math.sqrt(ad.width)
      let cx = 0
      let cz = 0
      if (b > 0) {
        // Each new body grows against one already there, on a side that is not crowded and not uphill, so the cluster is lopsided.
        const anchor = placed[Math.floor(rv(2, 30 + b) * placed.length)]!
        let az = rv(2, 40 + b) * Math.PI * 2
        for (let t = 0; t < 6; t += 1) {
          const a2 = rv(2, 50 + b * 6 + t) * Math.PI * 2
          const dx = Math.sin(a2)
          const dz = Math.cos(a2)
          const sc = (dx * free2[0] + dz * free2[1]) * crowd + (down2 ? (dx * down2[0] + dz * down2[1]) * slopeMag * 2 : 0) + rv(2, 56 + b * 6 + t)
          if (t === 0 || sc > ((Math.sin(az) * free2[0] + Math.cos(az) * free2[1]) * crowd + (down2 ? (Math.sin(az) * down2[0] + Math.cos(az) * down2[1]) * slopeMag * 2 : 0) + rv(2, 55 + b * 6 + t))) az = a2
        }
        const gap = (anchor.r + rb) * (0.62 + 0.2 * rv(2, 80 + b))
        cx = anchor.x + Math.sin(az) * gap
        cz = anchor.z + Math.cos(az) * gap
      }
      placed.push({ x: cx, z: cz, r: rb })
      const hf = clamp(vig * (0.55 + 0.9 * rv(2, 12 + b)) + 0.1 * (b === 0 ? 1 : 0))
      const nK = Math.max(1, Math.round((1 + 2.2 * Math.min(1, hf)) * (0.85 + 0.3 * ad.height)))
      let hPrev = 0
      let rPrev = 0
      for (let k = 0; k < nK; k += 1) {
        const rk = rb * (1.1 - 0.2 * k * (3 / Math.max(2, nK))) * (0.9 + 0.2 * rv(2, 20 + b * 7 + k))
        const hk = k === 0 ? rk * 0.62 : hPrev + 0.6 * (rPrev + rk)
        hPrev = hk
        rPrev = rk
        const wob = (rv(2, 60 + b * 9 + k) - 0.5) * 0.9 * rk
        const wob2 = (rv(2, 70 + b * 9 + k) - 0.5) * 0.9 * rk
        const f: B = { x: cx + contour2[0] * wob + sun2[0] * wob2 * 0.6, h: hk, z: cz + contour2[1] * wob + sun2[1] * wob2 * 0.6, r: rk, t: k === 0 ? [contour2[0], 0, contour2[1]] : ([0, 1, 0] as V3), wid: 1.1, thick: k === 0 ? 0.85 : 1, elong: k === 0 ? 1.4 : 1.05, arr: 0.03 + 0.3 * Math.pow(k / Math.max(1, nK - 1), 0.9) + 0.05 * b, shoot: -1, idx: 0 }
        if (k > 0) f.prev = founders[founders.length - 1]
        blobs.push(f)
        founders.push(f)
      }
    }
  }
  const founderPoint = (az: number, hFrac: number): { x: number; h: number; z: number; arr: number; f: B } => {
    // The founder surface point nearest the direction az, at a height fraction.
    let best = founders[0]!
    let bs = -1e9
    for (const f of founders) {
      const sc = (f.x * Math.sin(az) + f.z * Math.cos(az)) + 0.2 * f.h * hFrac
      if (sc > bs) {
        bs = sc
        best = f
      }
    }
    return { x: best.x + Math.sin(az) * best.r * 0.8, h: best.h * (0.5 + hFrac), z: best.z + Math.cos(az) * best.r * 0.8, arr: best.arr, f: best }
  }

  let lateralShare = 0
  if (family === 'porous') {
    // Shoots: each has its own pull up and to the light, from the seed and the place, so rising, reaching, arching and rooting coexist.
    const vigor = clamp(0.5 + 0.35 * (1 - light) + 0.3 * hollowP - 0.4 * ridgeP - 0.15 * windK + (rv(3, 0) - 0.5) * 0.5)
    const nS = 2 + Math.floor(rv(3, 1) * 2)
    const az0 = rv(3, 2) * Math.PI * 2
    for (let i = 0; i < nS; i += 1) {
      const up = clamp(vigor + (rv(3, 10 + i) - 0.5) * 0.9)
      const lt = clamp(0.25 + 0.75 * (1 - up) * (0.4 + 0.6 * light) + 0.25 * rv(3, 20 + i))
      let az = az0 + (i / nS) * Math.PI * 1.5 + (rv(3, 30 + i) - 0.5) * 0.7
      // Lateral shoots turn to the light; none grows into a crowd or uphill into the slope.
      az += Math.atan2(Math.sin(sunAz - az), Math.cos(sunAz - az)) * 0.35 * (1 - up) * lt
      if (crowd > 0.3 && Math.sin(az) * free2[0] + Math.cos(az) * free2[1] < -0.2) az += Math.PI * 0.6 * crowd
      const Hv = (20 + 22 * up) * S * ad.height
      const Lh = (18 + 14 * lt) * S * ad.length * (0.6 + 0.6 * ad.roof)
      const spec: Spec = { up, light: lt, lat: 1 - up, contour: 0.6, limit: 7.5, taper: 0.9965, rmin: 3.8 * S, wid: 1 + 0.12 * (1 - up), thick: 1 - 0.08 * (1 - up), elong: 1.15, maxLen: up * Hv + (1 - up) * Lh, hmax: 54 * S * ad.height, branch: 0.3, every: 3, childUp: 0.5 * up }
      const dir: V3 = norm3([Math.sin(az) * (1 - 0.65 * up), 0.3 + 0.9 * up, Math.cos(az) * (1 - 0.65 * up)])
      const p = founderPoint(az, 0.5 + 0.4 * up)
      growShoot(spec, p.x, p.h, p.z, dir, (6.4 + 1.6 * up) * S * Math.sqrt(ad.width), -1, 0, Math.max(0.06 + 0.1 * rv(3, 40 + i), p.arr + 0.03), 0.9 + 0.06 * rv(3, 50 + i), up > 0.6 ? 'rise' : up < 0.35 ? 'reach' : 'arch', 0, p.f)
      drain(0)
    }
  } else {
    // Shelves: lateral shoots from the bodies, aimed where the light, the ground and the neighbours leave room, never opposite one another.
    const nSh = Math.max(1, 1 + (light > 0.45 ? 1 : 0) + (rv(3, 0) < 0.35 ? 1 : 0) - (crowd > 0.7 ? 1 : 0))
    const used: number[] = []
    const tallest = bodies.reduce((m, b) => (b.top > m.top ? b : m), bodies[0]!)
    for (let i = 0; i < nSh; i += 1) {
      const body = i === 0 ? tallest : bodies[Math.floor(rv(3, 80 + i) * bodies.length)]!
      let bestAz = sunAz
      let bestScore = -1e9
      for (let c = 0; c < 16; c += 1) {
        const az = (c / 16) * Math.PI * 2 + rv(3, 60 + i) * 0.4
        const dx = Math.sin(az)
        const dz = Math.cos(az)
        let sc = (dx * sun2[0] + dz * sun2[1]) * 1.0 - Math.max(0, dx * free2[0] * -1 + dz * free2[1] * -1) * crowd * 1.2 + (rv(3, 70 + i * 20 + c) - 0.5) * 0.9
        if (down2) sc += (dx * down2[0] + dz * down2[1]) * slopeMag * 3
        for (const u of used) {
          const da = Math.abs(Math.atan2(Math.sin(az - u), Math.cos(az - u)))
          sc += da > 2.5 ? -1.6 : da > 0.8 ? 0.5 : -1
        }
        // A shelf that would run into another body must span to it (see below), so otherwise it keeps clear.
        for (const ob of bodies) {
          if (ob === body) continue
          const ox = ob.x - body.x
          const oz = ob.z - body.z
          const od = Math.hypot(ox, oz) || 1
          if ((dx * ox + dz * oz) / od > 0.8) sc -= 0.9
        }
        if (sc > bestScore) {
          bestScore = sc
          bestAz = az
        }
      }
      // With another body near, the first shelf may span to it: a bridge, fused where it arrives, propped by what the span needs.
      let span = false
      if (i === 0 && bodies.length > 1 && rv(3, 140) < 0.55) {
        const ob = bodies[(bodies.indexOf(body) + 1) % bodies.length]!
        bestAz = Math.atan2(ob.x - body.x, ob.z - body.z)
        span = true
      }
      used.push(bestAz)
      // The shelf leaves the body's side below its crown, so the body rises above it: an overhang, not a cap.
      const lo = Math.max(1, Math.floor(body.blobs.length * 0.25))
      const hi = Math.max(lo, body.blobs.length - 2)
      const kb = body.blobs[lo + Math.floor(rv(3, 2 + i) * (hi - lo + 1))]!
      const Lsh = (26 + 30 * rv(3, 90 + i)) * S * ad.length * (0.7 + 0.5 * ad.roof) * (i === 0 ? 1 : 0.8)
      const thick = 0.42 + 0.2 * rv(3, 150 + i)
      const spec: Spec = { up: 0.05, light: span ? 0 : 0.9, lat: 0.6, contour: 0.4, limit: 8 + 4 * rv(3, 151 + i), taper: 0.9965 + 0.002 * rv(3, 152 + i), rmin: 2.5 * S, wid: 1.5 + 0.8 * rv(3, 153 + i), thick, elong: 1.35, maxLen: span ? Math.hypot(bodies[(bodies.indexOf(body) + 1) % bodies.length]!.x - body.x, bodies[(bodies.indexOf(body) + 1) % bodies.length]!.z - body.z) * 1.3 : Lsh, hmax: 70 * S, branch: 0.16, every: 5, childUp: 0.1, seekW: span ? 0.9 : undefined, seekMax: span ? 9 : undefined }
      const dir: V3 = norm3([Math.sin(bestAz), 0.1, Math.cos(bestAz)])
      const sh = growShoot(spec, kb.x + dir[0] * kb.r * 0.75, kb.h, kb.z + dir[2] * kb.r * 0.75, dir, kb.r * (0.5 + 0.2 * rv(3, 154 + i)), -1, 0, 0.1 + 0.08 * i, 0.85 + 0.05 * rv(3, 95 + i), 'shelf', 0, kb)
      drain(0)
      // Supports where the load is: piers under a long reach, set by how far it carries.
      let piers = 0
      let lastPier = -99
      for (const b of sh.blobs) {
        const reach = Math.hypot(b.x - sh.blobs[0]!.x, b.z - sh.blobs[0]!.z)
        const load = reach / (spec.limit * b.r)
        if (load > 0.5 && piers < 3 && reach - lastPier > 13 + 5 * rv(3, 100 + piers) && b.h > 6) {
          lastPier = reach
          piers += 1
          const hd = norm3([b.t[0], 0, b.t[2]])
          const ps: Spec = { up: 0, light: 0, lat: 0, contour: 0, limit: 99, taper: 1.003, rmin: 1.8 * S, wid: 1.45, thick: 0.8, elong: 1.4, sfix: [hd[0], hd[2]], maxLen: b.h * 1.9, hmax: 99, branch: 0, every: 99, childUp: 0 }
          // A support leans back toward the body it holds the shelf out from (a brace), more steeply the nearer it stands.
          const tb = norm3([body.x - b.x, 0, body.z - b.z])
          const lean = 0.35 + 0.55 * rv(3, 110 + piers)
          const toward: V3 = norm3([tb[0] * lean, -1, tb[2] * lean])
          const rp = Math.max(2.1 * S, b.r * (0.42 + 0.3 * load))
          const ph = growShoot(ps, b.x, b.h - b.r * 0.4, b.z, toward, rp, sh.id, b.idx, 0, 0, 'pier', 1, b)
          ph.kind = 'pier'
        }
      }
      // A lower shelf can cascade from the end of this one.
      const end = sh.blobs[sh.blobs.length - 1]!
      if (!sh.fused && !sh.landed && rv(3, 120 + i) < 0.4) {
        const dd: V3 = norm3([Math.sin(bestAz + 0.5 * (rv(3, 125) < 0.5 ? 1 : -1)), -0.2, Math.cos(bestAz + 0.5)])
        pending.push({ root: end, spec: { ...spec, maxLen: spec.maxLen * 0.5, branch: 0.1 }, x: end.x, h: end.h, z: end.z, d: dd, r: end.r * 0.85, parent: sh.id, parentIdx: sh.blobs.length, t0: 0, t1: 0, kind: 'cascade' })
        drain(0)
      }
    }
    // An outlier: a lower second body, where a shelf can come to rest on it.
    if (res > 0.4 && rv(3, 130) < 0.7) {
      const az = used[0]! + (rv(3, 131) - 0.5) * 0.7
      const dist = (36 + 24 * rv(3, 132)) * S
      const ro = base * (0.6 + 0.2 * rv(3, 133))
      for (let k = 0; k < 2; k += 1) pushFounder({ x: Math.sin(az) * dist, h: ro * (0.9 + 1.1 * k), z: Math.cos(az) * dist, r: ro * (1 - 0.2 * k), t: [0, 1, 0], wid: 1.05, thick: 1, elong: 1.1, arr: 0.35 + 0.2 * k })
    }
  }

  // ---- bridges (porous): a reaching shoot leaves one shoot aimed at a neighbouring shoot and fuses with it, closing a loop ----
  if (family === 'porous') {
    const nB = 1 + Math.floor(rv(6, 0) * 2) + (moist > 0.5 ? 1 : 0)
    const used = new Set<number>()
    for (let q = 0; q < nB; q += 1) {
      let best: { a: B; b: B; score: number } | null = null
      for (const a of blobs) {
        if (a.shoot < 0 || a.h < a.r * 1.4 || used.has(a.shoot)) continue
        for (const b of blobs) {
          if (b.shoot < 0 || b.shoot === a.shoot) continue
          const ch = shoots[a.shoot]!.chain.find((c) => c.shoot === b.shoot)
          const chb = shoots[b.shoot]!.chain.find((c) => c.shoot === a.shoot)
          if (ch || chb) continue
          const dist = Math.hypot(a.x - b.x, a.h - b.h, a.z - b.z)
          const rr = (a.r + b.r) / 2
          if (dist < 2.6 * rr || dist > 7.5 * rr || Math.abs(a.h - b.h) > 0.7 * dist) continue
          const score = -Math.abs(dist - 4.6 * rr) / rr + rv(6, 10 + q) * 0.8 + 0.02 * Math.min(a.h, b.h)
          if (!best || score > best.score) best = { a, b, score }
        }
      }
      if (!best) break
      const { a, b } = best
      used.add(a.shoot)
      used.add(b.shoot)
      const dir = norm3([b.x - a.x, b.h - a.h + 0.2 * Math.hypot(b.x - a.x, b.z - a.z), b.z - a.z])
      const spec: Spec = { up: 0.2, light: 0, lat: 0, contour: 0, limit: 7.5, taper: 0.998, rmin: 3.4 * S, wid: 1.1, thick: 0.95, elong: 1.2, maxLen: 9 * Math.hypot(a.x - b.x, a.h - b.h, a.z - b.z), hmax: 99, branch: 0, every: 99, childUp: 0, seekW: 0.9, seekMax: 9 }
      growShoot(spec, a.x, a.h, a.z, dir, Math.min(a.r, b.r) * 0.85, a.shoot, a.idx, 0, 0, 'bridge', 1, a)
    }
  }

  // ---- toes: roots that crawl along the ground, longer downhill and toward water, so the base is never one flat edge ----
  const nT = 3 + Math.floor(2 * rv(4, 0) + 6 * slopeMag + 2 * near)
  for (let i = 0; i < nT; i += 1) {
    let az = rv(4, 10 + i) * Math.PI * 2
    if (down2 && rv(4, 20 + i) < 0.5) az = Math.atan2(down2[0], down2[1]) + (rv(4, 30 + i) - 0.5) * 1.2
    if (water2 && rv(4, 40 + i) < 0.4 * near + 0.1) az = Math.atan2(water2[0], water2[1]) + (rv(4, 50 + i) - 0.5) * 0.8
    const f = founders[Math.floor(rv(4, 60 + i) * founders.length)]!
    const down = down2 ? Math.max(0, Math.sin(az) * down2[0] + Math.cos(az) * down2[1]) : 0
    const len = (9 + 12 * rv(4, 70 + i)) * S * (1 + 0.7 * down + 0.5 * near + 0.5 * ridgeP)
    const spec: Spec = { up: 0, light: 0, lat: 0, contour: 0, limit: 99, taper: 0.975, rmin: 1.5 * S, wid: 1.45, thick: 0.55, elong: 1.35, maxLen: len, hmax: 99, branch: 0, every: 99, childUp: 0, crawl: true }
    growShoot(spec, f.x + Math.sin(az) * f.r * 0.8, 1, f.z + Math.cos(az) * f.r * 0.8, [Math.sin(az), 0, Math.cos(az)], (3 + 1.6 * rv(4, 80 + i)) * S, -1, 0, Math.max(0.05 + 0.2 * rv(4, 90 + i), f.arr + 0.02), Math.max(0.5 + 0.2 * rv(4, 100 + i), f.arr + 0.3), 'toe', 0, f)
  }

  // ---- arrival ages: shoots lengthen together; a branch begins when the place it leaves has arrived ----
  const arrOf = (sh: Shoot, i: number) => sh.t0 + (sh.t1 - sh.t0) * Math.pow(i / Math.max(1, sh.blobs.length - 1), 0.85)
  for (const sh of shoots) {
    if (sh.parent >= 0) {
      const P = shoots[sh.parent]!
      const pb = P.blobs[Math.min(P.blobs.length - 1, Math.max(0, sh.parentIdx - 1))]!
      const t0 = pb.arr + 0.02
      sh.t0 = sh.kind === 'pier' ? Math.min(0.9, t0 + 0.08) : t0
      sh.t1 = Math.min(0.98, sh.t0 + 0.12 + 0.55 * (sh.lenMax / 50))
    }
    sh.blobs.forEach((b, i) => (b.arr = arrOf(sh, i)))
  }

  // ---- prims ----
  const prims: Prim[] = []
  const E = { ex: 0, ez: 0, hc: 0, hv: 0, taper: 0, flat: 0, hb: 0, frill: 0, ph: 0 }
  let lox = 1e9
  let hix = -1e9
  let loz = 1e9
  let hiz = -1e9
  let topH = 0
  let vsum = 0
  let rsum = 0
  for (const b of blobs) {
    const t = norm3(b.t)
    // The flat axis: fixed for a fin, else across the heading; a rising shoot turns its own way (so rising shoots are not parallel panels).
    const rawS: V3 = b.sa ? [b.sa[0], 0, b.sa[1]] : Math.abs(t[1]) > 0.85 ? [Math.cos(rv(90, b.shoot + 7) * 6.283), 0, Math.sin(rv(90, b.shoot + 7) * 6.283)] : [-t[2], 0, t[0]]
    const dts = rawS[0] * t[0] + rawS[1] * t[1] + rawS[2] * t[2]
    const sv = norm3([rawS[0] - t[0] * dts, rawS[1] - t[1] * dts, rawS[2] - t[2] * dts])
    const nn = norm3(cross3(t, sv))
    const lobe: Lobe = { tx: t[0], th: t[1], tz: t[2], sx: sv[0], sz: sv[2], nx: nn[0], nh: nn[1], nz: nn[2], La: b.r * b.elong, rw: b.r * b.wid, rt: b.r * b.thick, prev: b.prev ? [b.prev.x, b.prev.h, b.prev.z] : undefined }
    prims.push({ ...E, kind: 'blob', cx: b.x, cz: b.z, hc: b.h, sin: 0, cos: 1, a: b.r, b: b.r, h: 0, leanX: 0, leanZ: 0, birth: b.arr, dur: 0.12, bl: lobe })
    const pad = Math.max(lobe.La, lobe.rw, lobe.rt) + NEAR + 4
    lox = Math.min(lox, b.x - pad)
    hix = Math.max(hix, b.x + pad)
    loz = Math.min(loz, b.z - pad)
    hiz = Math.max(hiz, b.z + pad)
    topH = Math.max(topH, b.h + b.r * b.thick)
    vsum += Math.abs(t[1]) * b.r * b.r
    rsum += b.r * b.r
  }
  const vertical = rsum > 0 ? vsum / rsum : 0.5

  // ---- grown space: void shoots. Each starts as a chamber in thick tissue and runs outward, steered toward the light and downhill and
  // toward a wall thin enough to open; where the body is thick on the other side too it opens there as well (a through passage). ----
  const carves: Carve[] = []
  let mouths = 0
  let passages = 0
  {
    const probe = makeProbe(prims, ad.skirt)
    const nV = family === 'porous' ? 3 + Math.floor(rv(7, 0) * 3 + 2 * moist) : 1 + Math.floor(rv(7, 0) * 2)
    const cand = blobs.filter((b) => b.r > 4.2 && b.h > 3.4 && b.shoot <= 1000).sort((a, b) => b.r - a.r)
    const seeds: B[] = []
    for (let v = 0; v < nV && cand.length > 0; v += 1) {
      const pool = cand.filter((c) => seeds.every((q) => Math.hypot(q.x - c.x, q.h - c.h, q.z - c.z) > 13)).slice(0, 10)
      if (pool.length === 0) break
      const b = pool[Math.floor(rv(7, 10 + v) * pool.length)]!
      const c0: V3 = [b.x, Math.max(b.h, 3.6), b.z]
      if (probe.fieldFull(...c0) > -1.8) continue
      type Exit = { dir: V3; t: number; e: V3; score: number }
      const exits: Exit[] = []
      for (let k = 0; k < 24; k += 1) {
        const az = (k / 24) * Math.PI * 2 + rv(7, 20 + v) * 0.3
        const el = (rv(7, 30 + v * 24 + k) - 0.5) * 0.7
        const dir = norm3([Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)])
        const t = probe.cast(c0, dir, 38, false)
        if (t < 0) continue
        const e: V3 = [c0[0] + dir[0] * t, c0[1] + dir[1] * t, c0[2] + dir[2] * t]
        if (e[1] < 2.6) continue
        const score = 0.9 * (dir[0] * sun2[0] + dir[2] * sun2[1]) + (down2 ? 2 * slopeMag * (dir[0] * down2[0] + dir[2] * down2[1]) : 0) + 1.3 * (1 - Math.abs(t - 8) / 14) + 0.5 * rv(7, 60 + v * 24 + k)
        exits.push({ dir, t, e, score })
      }
      if (exits.length === 0) continue
      exits.sort((p, q) => q.score - p.score)
      const A = exits[0]!
      const Bx = rv(7, 90 + v) < 0.65 ? exits.find((x) => x.dir[0] * A.dir[0] + x.dir[1] * A.dir[1] + x.dir[2] * A.dir[2] < -0.45) : undefined
      const rho = clamp(b.r * 0.6, 3.2, 6.6) * (0.85 + 0.3 * moist) * (0.9 + 0.2 * ad.opening / 1.2)
      const t0 = clamp(b.arr + 0.18 + 0.12 * rv(8, v), 0.34, 0.8)
      seeds.push(b)
      const pi = blobs.indexOf(b)
      if (prims[pi]?.bl) prims[pi]!.bl!.nocore = true
      carves.push({ kind: 'ell', role: 'void', c: c0, ax: [1, 0, 0], ay: [0, 1, 0], az: [0, 0, 1], r: [rho, rho * 0.85, rho], t0, span: 0.35, k: 2 })
      for (const X of Bx ? [A, Bx] : [A]) {
        const rt = Math.min(0.62 * rho, 0.38 * X.t + 0.8, 0.45 * b.r)
        carves.push({ kind: 'tube', role: 'passage', a: c0, b: [X.e[0] + X.dir[0] * 4, X.e[1] + X.dir[1] * 4, X.e[2] + X.dir[2] * 4], rad: rt, t0, span: 0.35, k: 1.8 })
        // The mouth flares: the opening is rounded where it meets the surface, like the rim of a worn cavity.
        carves.push({ kind: 'ell', role: 'void', c: [X.e[0] - X.dir[0] * 0.6 * rt, X.e[1] - X.dir[1] * 0.6 * rt, X.e[2] - X.dir[2] * 0.6 * rt], ax: [1, 0, 0], ay: [0, 1, 0], az: [0, 0, 1], r: [rt * 1.35, rt * 1.25, rt * 1.35], t0: t0 + 0.05, span: 0.3, k: 1.6 })
        mouths += 1
      }
      passages += 1
    }
  }
  lateralShare = 1 - vertical
  void lateralShare

  // ---- wear: how, and how much, the tissue opens ----
  const wob = 0.02 * (rv(5, 0) - 0.5)
  const poro: Poro =
    family === 'porous'
      ? { t0: 0.4 + 0.15 * rv(5, 1), soil: 0.6, through: { thr: 0.585 - 0.05 * moist - 0.03 * (1 - light) + 0.05 * ridgeP - 0.02 * hollowP + wob, depth: 7, f: 0.06 + 0.02 * rv(5, 2), ay: 0.5 + 0.9 * (1 - vertical), minH: 3 + 4 * ridgeP + 2 * slopeMag * 4 } }
      : { t0: 0.45 + 0.1 * rv(5, 1), soil: 0.6, under: { thr: 0.54 - 0.05 * moist + 0.04 * ridgeP + wob, depth: 6, f: 0.1 + 0.03 * rv(5, 2) } }
  const thrEff = poro.through?.thr ?? 0.7
  const porosity = Math.round(100 * (1 - 0.5 * (1 + erf((thrEff - 0.5) / (0.11 * Math.SQRT2)))))

  // ---- ground and measures ----
  const cell = 1.55 * clamp(S, 0.75, 1.2)
  let minX = 1e9
  let maxX = -1e9
  let minZ = 1e9
  let maxZ = -1e9
  let reachMax = 0
  for (const sh of shoots) {
    for (const b of sh.blobs) {
      minX = Math.min(minX, b.x - b.r)
      maxX = Math.max(maxX, b.x + b.r)
      minZ = Math.min(minZ, b.z - b.r)
      maxZ = Math.max(maxZ, b.z + b.r)
    }
    if (sh.kind === 'shelf' || sh.kind === 'reach' || sh.kind === 'arch') {
      const a = sh.blobs[0]!
      const z = sh.blobs[sh.blobs.length - 1]!
      reachMax = Math.max(reachMax, Math.hypot(z.x - a.x, z.z - a.z))
    }
  }
  const piersN = shoots.filter((s) => s.kind === 'pier').length
  const measure: Record<string, number> = {
    length: Math.round(Math.max(maxX - minX, maxZ - minZ)),
    width: Math.round(Math.min(maxX - minX, maxZ - minZ)),
    height: Math.round(topH),
    massifs: shoots.filter((s) => s.kind !== 'toe').length,
    openings: fusions + feet + mouths,
    openingWidth: 0,
    openingHeight: 0,
    openingArea: porosity,
    chamber: Math.round(vertical * 100),
    windows: fusions,
    pits: piersN,
    skirt: Math.round(ad.skirt * 100) / 100,
    spineAzimuth: Math.round(((((Math.atan2(sun2[0], sun2[1]) * 180) / Math.PI) % 180) + 180) % 180),
    roof: Math.round(reachMax),
  }
  const stats: Record<string, number | string> = { height: measure.height!, openings: `${fusions} fusions, ${passages} grown passages (${mouths} mouths), ${feet} roots, ${piersN} piers`, massifs: `${shoots.filter((s) => s.kind !== 'toe').length} shoots, ${Math.round(vertical * 100)}% vertical` }
  return { site, y0, cell, prims, carves, skirt: ad.skirt, moisture: moist, ground: groundGrid(site, lox, hix, loz, hiz, cell), poro, measure, stats }
}

function erf(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return x >= 0 ? y : -y
}
void smooth
