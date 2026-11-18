import { Vector3, type Bone } from 'three'
import { clamp, lerp, type RGB, type V } from './geo.ts'
import type { Mesher } from './geo.ts'
import { Rig, turn } from './rig.ts'

/**
 * A fan: slender rays that start at one point, each a short chain of bones that can bend, with a membrane between neighbours. It is
 * the glider's wing and tail, the strider's sail and tail. `axis` is the way a ray points; `fanAxis` is what the rays spread about;
 * `across` is what a ray bends about. `yaw` and `bend` are the signs that spread a ray toward the trailing edge and bend its tip
 * toward the ground (or, for an upright fan, to the side).
 */
export type Fan = {
  name: string
  ribs: Bone[][]
  seg: number[]
  axis: V
  fanAxis: V
  across: V
  yaw: number
  bend: number
  K: number
  betas: number[]
}

export function makeFan(rig: Rig, name: string, parent: Bone, o: { axis: V; fanAxis: V; across: V; yaw: number; bend: number; betas: number[]; lens: number[]; K: number }): Fan {
  const { axis, K } = o
  const ribs = o.betas.map((beta, r) => {
    const seg = o.lens[r]! / K
    const chain: Bone[] = []
    let up: Bone = parent
    for (let k = 0; k < K; k += 1) {
      const b = rig.bone(`${name}.${r}.${k}`, up, k === 0 ? [0, 0, 0] : [axis[0] * seg, axis[1] * seg, axis[2] * seg])
      chain.push(b)
      up = b
    }
    turn(chain[0]!, [o.fanAxis, o.yaw * beta])
    return chain
  })
  return { name, ribs, seg: o.lens.map((l) => l / K), axis, fanAxis: o.fanAxis, across: o.across, yaw: o.yaw, bend: o.bend, K, betas: o.betas }
}

export type FanPose = {
  /** 0 (folded, the rays together) to 1 (spread). */
  open: number
  /** How far the tips bend: negative up, positive down (radians). */
  bend: number
  /** A little life in the rays: spread (radians). */
  flutter?: number
  t: number
  /** Shear the rays toward one side (radians): a turning tail. */
  skew?: number
  /** 0 (soft) to 1 (stiff): how little a ray bends. */
  stiff?: (rib: number) => number
  /** A bend that travels out along the rays (radians). */
  ripple?: number
  rippleSpeed?: number
}

export function poseFan(fan: Fan, p: FanPose) {
  const lead = fan.betas[0]!
  const n = fan.ribs.length
  fan.ribs.forEach((chain, i) => {
    const beta = lead + (fan.betas[i]! - lead) * p.open + (p.skew ?? 0) * (i / (n - 1) - 0.5) + (p.flutter ?? 0) * Math.sin(p.t * 2.3 + i * 0.9)
    const flex = 1 - (p.stiff ? p.stiff(i) : 0)
    const g = p.bend * (0.6 + 0.4 * Math.sin((Math.PI * (i + 0.5)) / n)) * flex
    chain.forEach((b, k) => {
      const wave = (p.ripple ?? 0) * Math.sin(p.t * (p.rippleSpeed ?? 2.6) - i * 0.5 - k * 0.9) * flex
      const angle = fan.bend * (g * ((k + 1) / chain.length) * 1.4 + wave)
      if (k === 0) turn(b, [fan.fanAxis, fan.yaw * beta], [fan.across, angle])
      else turn(b, [fan.across, angle])
    })
  })
}

export type FanSkin = {
  /** Ray radius at a fraction along ray `rib`. */
  thick: (rib: number, f: number) => number
  colour: (rib: number, f: number) => RGB
  /** Length of the hooked tip of ray `rib` (0: none). */
  hook: (rib: number) => number
  tone: (rib: number, k: number) => RGB
  /** How much darker every other panel is (0 to 1). */
  parity: number
  hookColour: RGB
  /** 0 to 0.4: how deeply the trailing edge is notched between rays, so it reads as feathers and not a sheet. */
  scallop?: number
  /** Overlapping layers of short feather panels laid over the membrane near the root (`amounts`: how developed each layer is, 0 to 1). */
  coverts?: { amounts: number[]; tone: (layer: number, f: number) => RGB }
}

/** The geometry of a fan, authored in the bind pose: ray tubes, a membrane between neighbouring rays, and a hooked tip where asked. */
export function skinFan(rig: Rig, soft: Mesher, hard: Mesher, fan: Fan, o: FanSkin) {
  const { K, axis } = fan
  const grid: number[][] = []
  const pts: V[][] = []
  const v = new Vector3()
  fan.ribs.forEach((chain, i) => {
    const seg = fan.seg[i]!
    const row: number[] = []
    const prow: V[] = []
    for (let k = 0; k <= K; k += 1) {
      if (k < K) chain[k]!.getWorldPosition(v)
      else chain[K - 1]!.localToWorld(v.set(axis[0] * seg, axis[1] * seg, axis[2] * seg))
      const bones: [number, number][] = k === 0 ? [[rig.index(chain[0]!), 1]] : k === K ? [[rig.index(chain[K - 1]!), 1]] : [[rig.index(chain[k - 1]!), 0.5], [rig.index(chain[k]!), 0.5]]
      const tone = o.tone(i, k)
      const shade = i % 2 === 0 ? 1 : 1 - o.parity
      row.push(soft.world([v.x, v.y, v.z], [tone[0] * shade, tone[1] * shade, tone[2] * shade], bones))
      prow.push([v.x, v.y, v.z])
    }
    grid.push(row)
    pts.push(prow)
    for (let k = 0; k < K; k += 1) {
      const path: V[] = [0, 0.5, 1].map((f) => [axis[0] * seg * f, axis[1] * seg * f, axis[2] * seg * f] as V)
      soft
        .part(rig.index(chain[k]!), k > 0 ? rig.index(chain[k - 1]!) : -1, k < K - 1 ? rig.index(chain[k + 1]!) : -1)
        .tube(path, (t) => o.thick(i, (k + t) / K), (t) => o.colour(i, (k + t) / K), 5, { open: k > 0 })
    }
    const h = o.hook(i)
    if (h > 0) {
      const tip: V = [axis[0] * seg, axis[1] * seg, axis[2] * seg]
      const up: V = fan.across
      hard.part(rig.index(chain[K - 1]!)).tube(
        [tip, [tip[0] + axis[0] * h * 0.55 - up[0] * h * 0.1, tip[1] + axis[1] * h * 0.55 - up[1] * h * 0.1, tip[2] + axis[2] * h * 0.55 - up[2] * h * 0.1], [tip[0] + axis[0] * h * 0.85 - up[0] * h * 0.4, tip[1] + axis[1] * h * 0.85 - up[1] * h * 0.4, tip[2] + axis[2] * h * 0.85 - up[2] * h * 0.4]],
        (t) => lerp(0.0036, 0.0005, t),
        () => o.hookColour,
        4,
      )
    }
  })
  const scallop = o.scallop ?? 0
  for (let i = 0; i < grid.length - 1; i += 1) {
    for (let k = 0; k < K - (scallop > 0 ? 1 : 0); k += 1) soft.quad(grid[i]![k]!, grid[i + 1]![k]!, grid[i + 1]![k + 1]!, grid[i]![k + 1]!)
    if (scallop > 0) {
      // The outermost panel ends in a point between two ray tips instead of a straight edge.
      const a = pts[i]![K]!
      const b = pts[i + 1]![K]!
      const c = pts[i]![K - 1]!
      const d = pts[i + 1]![K - 1]!
      const pull = scallop * 2.2
      const mid: V = [(a[0] + b[0]) / 2 + ((c[0] + d[0]) / 2 - (a[0] + b[0]) / 2) * pull, (a[1] + b[1]) / 2 + ((c[1] + d[1]) / 2 - (a[1] + b[1]) / 2) * pull, (a[2] + b[2]) / 2 + ((c[2] + d[2]) / 2 - (a[2] + b[2]) / 2) * pull]
      const tone = o.tone(i, K)
      const bi = rig.index(fan.ribs[i]![K - 1]!)
      const bj = rig.index(fan.ribs[i + 1]![K - 1]!)
      const m = soft.world(mid, [tone[0] * 1.04, tone[1] * 1.04, tone[2] * 1.04], [[bi, 0.5], [bj, 0.5]])
      soft.tri(grid[i]![K - 1]!, grid[i + 1]![K - 1]!, m)
      soft.tri(grid[i]![K - 1]!, m, grid[i]![K]!)
      soft.tri(grid[i + 1]![K - 1]!, grid[i + 1]![K]!, m)
    }
  }
  // Covert feathers: short panels laid over the membrane near the root, one layer on another, each pointed at its free end.
  const cov = o.coverts
  if (cov && cov.amounts.some((a) => a > 0.03)) {
    const up = fan.fanAxis
    const at = (rib: number, f: number): { p: V; bone: number } => {
      const x = clamp(f, 0, 0.999) * K
      const k0 = Math.floor(x)
      const t = x - k0
      const a = pts[rib]![k0]!
      const b = pts[rib]![k0 + 1]!
      return { p: [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)], bone: rig.index(fan.ribs[rib]![Math.min(k0, K - 1)]!) }
    }
    for (let L = 0; L < cov.amounts.length; L += 1) {
      const amount = cov.amounts[L]!
      if (amount < 0.03) continue
      const lift = 0.0042 * (L + 1)
      const f0 = 0.16 + 0.1 * L
      const f1 = Math.min(0.9, f0 + (0.28 + 0.1 * L) * amount)
      for (let i = 0; i < grid.length - 1; i += 1) {
        const corner = (rib: number, f: number) => {
          const c = at(rib, f)
          return soft.world([c.p[0] + up[0] * lift, c.p[1] + up[1] * lift, c.p[2] + up[2] * lift], cov.tone(L, f), [[c.bone, 1]])
        }
        const a = corner(i, f0)
        const b = corner(i + 1, f0)
        const c = corner(i + 1, f1)
        const d = corner(i, f1)
        // The free end: a point halfway between the rays, a little farther out than the corners.
        const tip = f1 + 0.1 * amount
        const ta = at(i, tip)
        const tb = at(i + 1, tip)
        const mid: V = [(ta.p[0] + tb.p[0]) / 2 + up[0] * lift, (ta.p[1] + tb.p[1]) / 2 + up[1] * lift, (ta.p[2] + tb.p[2]) / 2 + up[2] * lift]
        const e = soft.world(mid, cov.tone(L, 1), [[ta.bone, 0.5], [tb.bone, 0.5]])
        soft.quad(a, b, c, d)
        soft.tri(d, c, e)
      }
    }
  }
}
