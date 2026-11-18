import { MeshStandardMaterial, Vector3 } from 'three'
import { makeFan, poseFan, skinFan } from './fan.ts'
import { clamp, hex, lerp, mix, rng, smooth, type RGB, type V } from './geo.ts'
import { elder, maturity, stageName } from './growth.ts'
import { readTraits, traitsOf } from './traits.ts'
import { approach, Leg, Rig, turn, X_AXIS, Y_AXIS, Z_AXIS } from './rig.ts'
import type { Creature, CreatureParams, Frame, MotionInput } from './types.ts'

/**
 * Strider. An amphibious wader: a fish-shaped swimmer that, in shallow water and on the shore, puts down four jointed limbs and
 * walks. A horse's springy, upright leg and a swan's grace are only references; the body is a fish's, with its
 * dorsal sail and tail fan. What is its own:
 *   - limbs that grow out of the body (a muscular hip, a thick thigh tapering to a slender cannon and a spreading toe), short
 *     enough to carry its weight and long enough to clear the water
 *   - two ways of moving: in deep water it tucks its limbs back along its flanks and swims with its body and tail; in the
 *     shallows and on land it extends them and walks, its weight passing from side to side
 *   - a head that is the front of the body, not a thing on a neck: it feeds deliberately (it looks, aims, strikes at the water and
 *     swallows) by tipping the whole front of the body, not by throwing it about
 * MINERAL. Wet ground is where the mineral is. The legs, its most stressed part, lay it down as growth nodes at the knee and ankle
 * (they thicken with age and supply, and brace the joints, as the nodes of a bamboo stem do) and as a pale crust that rises from the
 * feet as high as the water has stood on them. The body stays soft; a small gill-cover rim is the only mineral on it.
 * HABITAT is the depth of the water it wades: deeper water makes longer legs and a higher crust, a higher lift when it wades, and
 * the water in the scene rises with it.
 */

const PAL = {
  body: hex('#a9ada5'),
  bodyDark: hex('#7b7e78'),
  belly: hex('#c9cbc1'),
  leg: hex('#80827a'),
  crust: hex('#d9d6c6'),
  node: hex('#cfcbb9'),
  membraneRoot: hex('#a5a99f'),
  membraneEdge: hex('#e4e5da'),
  ray: hex('#6e716a'),
  dark: hex('#12130f'),
  eye: hex('#dcd8c4'),
}

export function buildStrider(p: CreatureParams): Creature {
  const t0 = performance.now()
  const r = rng(p.seed * 97 + 21)
  const vary = (a: number, b: number) => a + (b - a) * r()
  const age = clamp(p.age)
  const depth = clamp(p.habitat)
  const m = maturity(age)
  const el = elder(age)
  // A young Strider is a swimmer first: short, stout limbs, a small sail, a short fan tail, and a big head. The adult has long, slim
  // legs, a tall sail of many rays and a wider-spread tail; the old one has a stiffened, bleached, frayed sail.
  const size = 0.85 * (0.55 + 0.45 * m)
  // Linked body-plan axes (traits.ts): legs : fan (swimmer to wader), sail, body (deep to slender).
  const T = { ...traitsOf('strider', p.seed), ...p.traits }
  // The Builder's base body plan: the trunk (from the tail root to the head) stretched by `torso`, the head carried forward unchanged.
  const plan = p.plan ?? {}
  const TL = plan.torso ?? 1
  const w = (x: number) => (x <= 0.42 ? x * TL : x + 0.42 * (TL - 1))
  const tl = T.legs ?? 0
  const ts = T.sail ?? 0
  const tbd = T.body ?? 0
  const legK = (0.74 + 0.26 * m) * (0.86 + 0.28 * depth) * vary(0.95, 1.06) * (1 + 0.14 * tl) * (plan.leg ?? 1)
  const girth = (0.9 + 0.2 * clamp(p.condition)) * (1.06 - 0.08 * m) * (1 - 0.1 * tbd) * (plan.girth ?? 1)
  const wear = 1 - clamp(p.condition)
  const finK = vary(0.9, 1.15) * (0.45 + 0.55 * m) * (1 + 0.16 * ts) * (plan.tail ?? 1)
  // A wader trades swimming fan for leg: the tail fan shrinks as the legs lengthen.
  const fanK = 1 - 0.18 * tl
  const dev = clamp(p.mineral) * smooth(clamp((age - 0.18) / 0.62))
  const RDfull = 8 + Math.floor(r() * 3) + Math.round(2 * ts)
  const RD = Math.max(4, Math.round(lerp(4, RDfull, m)))

  const rig = new Rig()
  const body = rig.bone('body', null, [0, 1.1, 0])
  const torso1 = rig.bone('torso1', body, [0, 0, 0])
  const torso2 = rig.bone('torso2', torso1, [w(-0.38), 0, 0])
  const head = rig.bone('head', torso1, [w(0.42), 0.01, 0])
  const tail0 = rig.bone('tail0', torso2, [w(-0.72) - w(-0.38), 0, 0])
  const tail1 = rig.bone('tail1', tail0, [-0.13, 0, 0])
  const tail2 = rig.bone('tail2', tail1, [-0.12, 0, 0])

  const dorsal = rig.bone('dorsal', torso1, [-0.04, 0.17 * girth, 0])
  const dBetas = Array.from({ length: RD }, (_, i) => lerp(-0.2, 1.1, i / (RD - 1)))
  const dLens = dBetas.map((_, i) => {
    const u = i / (RD - 1)
    const base = u < 0.5 ? lerp(0.5, 1, u / 0.5) : lerp(1, 0.4, (u - 0.5) / 0.5)
    return 0.42 * finK * base * (1 - wear * 0.45 * rng(p.seed * 5 + i * 11)() - el * 0.22 * rng(p.seed * 3 + i * 17)() * (i / (RD - 1)))
  })
  const dorsalFan = makeFan(rig, 'dorsal', dorsal, { axis: [0, 1, 0], fanAxis: Z_AXIS, across: X_AXIS, yaw: 1, bend: 1, betas: dBetas, lens: dLens, K: 3 })
  const nC = Math.max(3, Math.round(lerp(3, 7, m)))
  const cBetas = Array.from({ length: nC }, (_, i) => lerp(-0.9, 0.9, i / (nC - 1)))
  const caudal = makeFan(rig, 'caudal', tail2, { axis: [-1, 0, 0], fanAxis: Z_AXIS, across: Y_AXIS, yaw: 1, bend: 1, betas: cBetas, lens: cBetas.map((b) => 0.28 * fanK * Math.cos(b * 1.25) * (1 - wear * 0.2) * (finK / (0.45 + 0.55 * m)) * (1.12 - 0.12 * m)), K: 2 })

  // Limbs: a thick thigh, a slender cannon, a spreading foot; short enough to carry the weight.
  // The knee moves along the leg; the leg's total length (and so the body's height) is kept.
  const kn = plan.knee ?? 1
  const split = (a: number, b: number): [number, number] => {
    const s = a + b
    const a2 = (s * a * kn) / (a * kn + b)
    return [a2, s - a2]
  }
  const [fU, fL] = split(0.25, 0.28)
  const [hU, hL] = split(0.27, 0.3)
  const foreLen = [fU * legK, fL * legK, 0.19 * legK, 0.1 * legK]
  const hindLen = [hU * legK, hL * legK, 0.2 * legK, 0.1 * legK]
  const LEAN = 0.2
  const standH = (l: number[]) => 0.9 * (l[0]! + l[1]!) + l[2]! * Math.cos(LEAN)
  const hindH = standH(hindLen)
  const HIP_Y = -0.11
  const legs = {
    hindR: new Leg(rig, torso2, 'hindR', [0.02, HIP_Y, 0.082], hindLen, 1),
    hindL: new Leg(rig, torso2, 'hindL', [0.02, HIP_Y, -0.082], hindLen, 1),
    foreR: new Leg(rig, torso1, 'foreR', [w(0.12), HIP_Y, 0.085], foreLen, 1),
    foreL: new Leg(rig, torso1, 'foreL', [w(0.12), HIP_Y, -0.085], foreLen, 1),
  }
  const bodyY = hindH + 0.11
  body.position.set(0, bodyY, 0)
  rig.settle()

  const soft = rig.mesher(false)
  const hard = rig.mesher(true)
  const ix = (b: Parameters<Rig['index']>[0]) => rig.index(b)
  const bodyAt = (t: number, up: number): RGB => mix(mix(PAL.bodyDark, PAL.body, clamp(0.4 + 0.45 * t)), PAL.belly, clamp(0.45 - up * 1.0) * 0.9)

  // Body: a flat teardrop, deep and narrow, tapering to a peduncle.
  const prof0: [number, number, number, number][] = [
    [-0.72, 0.034, 0.022, 0],
    [-0.55, 0.07, 0.04, 0],
    [-0.38, 0.135, 0.08, 0.005],
    [-0.15, 0.172, 0.098, 0.01],
    [0.05, 0.175, 0.102, 0.01],
    [0.2, 0.15, 0.09, 0.005],
    [0.3, 0.108, 0.078, 0.006],
    [0.42, 0.074, 0.056, 0.008],
    [0.5, 0.046, 0.034, 0.006],
    [0.57, 0.024, 0.018, 0.004],
    [0.62, 0.008, 0.007, 0.002],
  ]
  const prof = prof0.map((q) => [w(q[0]), q[1], q[2], q[3]] as [number, number, number, number])
  const at = (x: number) => {
    let i = 0
    while (i < prof.length - 2 && x > prof[i + 1]![0]) i += 1
    const a = prof[i]!
    const b = prof[i + 1]!
    const t = smooth(clamp((x - a[0]) / (b[0] - a[0])))
    return { ry: lerp(a[1], b[1], t) * girth, rz: lerp(a[2], b[2], t) * girth, cy: lerp(a[3], b[3], t) }
  }
  const cut = (name: string, prev: string | null, next: string | null, ox: number, x0: number, x1: number) => {
    const sections = Array.from({ length: 7 }, (_, k) => {
      const X = lerp(x0, x1, k / 6)
      const s = at(X)
      return { x: X - ox, y: s.cy, ry: s.ry, rz: s.rz, n: 2.1 }
    })
    soft.part(ix(name), prev ? ix(prev) : -1, next ? ix(next) : -1).loft(sections, (t, up) => bodyAt(0.2 + 0.8 * t, up), 12)
  }
  cut('torso2', 'torso1', 'tail0', w(-0.38), w(-0.72), w(-0.38))
  cut('torso1', 'torso2', 'head', 0, w(-0.38), w(0.42))

  // The head is the front of the body: one continuous profile tapers from the shoulders to the snout, sharing its skin with the torso
  // across the join, so there is no neck and nothing attached. The head bone only lets the snout dip and turn.
  {
    const sections = Array.from({ length: 6 }, (_, k) => {
      const X = lerp(w(0.42), w(0.62), k / 5)
      const sp = at(X)
      return { x: X - w(0.42), y: sp.cy - 0.008, ry: sp.ry, rz: sp.rz, n: 2.1 }
    })
    soft.part(ix(head), ix('torso1'), -1).loft(sections, (t, up) => mix(bodyAt(0.65, up), PAL.bodyDark, t > 0.9 ? 0.5 : 0), 12)
    for (const side of [-1, 1]) {
      // A flush, pale eye with a dark pupil, set on the side of the taper.
      const ez = 0.047 * side
      const e = 0.02
      soft.loft([
        { x: 0.05, y: 0.016, z: ez, ry: 0.003, rz: 0.003 },
        { x: 0.075, y: 0.016, z: ez * 1.08, ry: e, rz: e, n: 2 },
        { x: 0.1, y: 0.016, z: ez, ry: 0.003, rz: 0.003 },
      ], () => PAL.eye, 10)
      soft.loft([
        { x: 0.07, y: 0.016, z: ez * 1.2, ry: 0.001, rz: 0.001 },
        { x: 0.082, y: 0.016, z: ez * 1.22, ry: e * 0.55, rz: e * 0.55, n: 2 },
        { x: 0.092, y: 0.016, z: ez * 1.2, ry: 0.001, rz: 0.001 },
      ], () => PAL.dark, 8)
      if (dev > 0.08) {
        // The gill-cover rim, at the front of the body, behind the eye.
        const rim = 0.003 + 0.004 * dev
        hard.part(ix('torso1'), ix('torso2'), ix(head)).tube([[0.31, 0.088, side * 0.074], [0.3, 0.03, side * 0.083], [0.3, -0.03, side * 0.083], [0.315, -0.082, side * 0.07]], () => rim, () => mix(PAL.node, PAL.body, 0.3), 5, { open: true })
      }
    }
  }
  soft.part(ix(tail0), ix('torso2'), ix(tail1)).tube([[0, 0, 0], [-0.065, 0, 0], [-0.13, 0, 0]], (t) => lerp(0.034, 0.022, t) * girth, (t) => bodyAt(0.3 + 0.2 * t, 0), 8)
  soft.part(ix(tail1), ix(tail0), ix(tail2)).tube([[0, 0, 0], [-0.06, 0, 0], [-0.12, 0, 0]], (t) => lerp(0.022, 0.014, t), () => bodyAt(0.4, 0), 8)
  soft.part(ix(tail2), ix(tail1), -1).tube([[0, 0, 0], [-0.05, 0, 0], [-0.1, 0, 0]], (t) => lerp(0.014, 0.01, t), () => PAL.bodyDark, 7)

  // The sail grows out of a low ridge along the back, and the tail fan out of a flattened blade, so neither is stuck on.
  soft.part(ix('torso1'), ix('torso2'), ix(head)).loft(
    Array.from({ length: 6 }, (_, k) => {
      const X = lerp(-0.22, 0.16, k / 5)
      const sp = at(X)
      return { x: X, y: sp.cy + sp.ry * 0.96, ry: 0.016 * Math.sin(Math.PI * (0.1 + 0.8 * (k / 5))) + 0.004, rz: 0.022 * girth, n: 2 }
    }),
    (t, up) => bodyAt(0.5 + 0.2 * t, up),
    8,
  )
  soft.part(ix(tail2), ix(tail1), -1).loft([
    { x: -0.02, ry: 0.012, rz: 0.01, n: 2 },
    { x: -0.07, ry: 0.03 * (1.1 - 0.1 * m), rz: 0.006, n: 2 },
    { x: -0.11, ry: 0.034 * (1.1 - 0.1 * m), rz: 0.004, n: 2 },
  ], () => PAL.bodyDark, 8, { open: true })
  skinFan(rig, soft, hard, dorsalFan, {
    thick: (_i, f) => lerp(0.0045, 0.0015, f),
    colour: (_i, f) => mix(PAL.ray, PAL.bodyDark, f),
    hook: () => 0,
    tone: (_i, k) => mix(mix(PAL.membraneRoot, PAL.membraneEdge, Math.pow(k / 3, 0.7)), PAL.belly, 0.3 * el),
    parity: 0.1,
    hookColour: PAL.node,
  })
  skinFan(rig, soft, hard, caudal, {
    thick: (_i, f) => lerp(0.0035, 0.0014, f),
    colour: (_i, f) => mix(PAL.ray, PAL.bodyDark, f),
    hook: () => 0,
    tone: (_i, k) => mix(PAL.membraneRoot, PAL.membraneEdge, Math.pow(k / 2, 0.7)),
    parity: 0.08,
    hookColour: PAL.node,
  })

  // Limbs. Each grows out of a muscular hip on the body; the thigh shares its skin with the torso, so there is no seam.
  const crustTo = (0.12 + 0.55 * depth) * hindH * dev // metres above the ground
  const limb = (leg: Leg, kind: 'fore' | 'hind', side: number) => {
    const L = leg.lengths
    const [s0, s1, s2, s3] = leg.segs.map((b) => ix(b)) as [number, number, number, number]
    const torso = kind === 'fore' ? torso1 : torso2
    const hx = kind === 'fore' ? 0.12 : 0.02
    // The hip: a rounded mass of muscle on the flank.
    soft.part(ix(torso), -1, -1).loft([
      { x: hx - 0.09, y: HIP_Y + 0.05, z: side * 0.066, ry: 0.025, rz: 0.022, n: 2 },
      { x: hx, y: HIP_Y + 0.04, z: side * 0.076, ry: 0.056, rz: 0.035, n: 2 },
      { x: hx + 0.09, y: HIP_Y + 0.05, z: side * 0.066, ry: 0.025, rz: 0.022, n: 2 },
    ], (t, up) => bodyAt(0.5 + 0.2 * t, up), 10)
    const down = (len: number, n = 7): V[] => Array.from({ length: n }, (_, i) => [0, (-len * i) / (n - 1), 0])
    const below = (seg: number, f: number) => {
      let h = 0.02
      for (let k = seg + 1; k < 4; k += 1) h += L[k]! * 0.92
      return h + L[seg]! * 0.92 * (1 - f)
    }
    const colourOf = (seg: number) => (t: number): RGB => (below(seg, t) < crustTo ? mix(PAL.crust, PAL.leg, clamp((below(seg, t) / Math.max(crustTo, 0.01)) * 0.5)) : mix(PAL.leg, PAL.bodyDark, 0.2 * t))
    // Thigh: thick at the hip, a swell of muscle, tapering to the knee. Shank: a calf swell, then a slender cannon.
    soft.part(s0, ix(torso), s1).tube(down(L[0]!), (t) => (lerp(0.056, 0.026, Math.pow(t, 0.8)) + 0.008 * Math.sin(Math.PI * Math.min(1, t * 1.1))) * girth, colourOf(0), 9)
    soft.part(s1, s0, s2).tube(down(L[1]!), (t) => lerp(0.026, 0.0155, t) + 0.006 * Math.sin(Math.PI * Math.min(1, t * 1.3)), colourOf(1), 8)
    soft.part(s2, s1, s3).tube(down(L[2]!), (t) => lerp(0.0155, 0.013, t), colourOf(2), 7)
    soft.part(s3, s2, -1)
    for (const off of [0, 0.04, -0.04]) {
      const d = L[3]! * (off === 0 ? 1.15 : 1)
      const sp = off * 1.1
      soft.tube([[0, 0, off * 0.2], [sp * 0.1, -d * 0.45, off * 0.7], [sp * 0.2, -d, off + sp]], (t) => lerp(0.012, 0.0065, t), (t) => mix(PAL.crust, PAL.leg, dev > 0.12 ? 0.2 + 0.4 * t : 0.7 + 0.2 * t), 6, { blend: 0.15 })
    }
    // Growth nodes: a low faceted swelling at the knee and the ankle, thicker with age and supply.
    if (dev > 0.05) {
      const grow = 0.003 + 0.012 * dev
      for (const [bone, prev, next, rad] of [[s1, s0, s2, 0.026], [s2, s1, s3, 0.0155]] as const) {
        hard.part(bone, prev, next).tube([[0, 0.03, 0], [0, 0.0, 0], [0, -0.03, 0]], (t) => (rad + grow) * (0.62 + 0.38 * Math.sin(Math.PI * t)), () => mix(PAL.node, PAL.leg, 0.2), 8)
      }
    }
  }
  limb(legs.hindR, 'hind', 1)
  limb(legs.hindL, 'hind', -1)
  limb(legs.foreR, 'fore', 1)
  limb(legs.foreL, 'fore', -1)

  const matSoft = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: 2 })
  const matHard = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.02, side: 2 })
  const geoSoft = soft.build()
  const geoHard = hard.build()
  const { skeleton, meshes } = rig.skin(geoSoft, geoHard, { soft: matSoft, hard: matHard })
  rig.root.scale.setScalar(size)
  const triangles = (geoSoft.index ? geoSoft.index.count : geoSoft.attributes.position!.count) / 3 + geoHard.attributes.position!.count / 3

  // ---------------------------------------------------------------------------------------------- motion
  const waterWade = hindH * (0.04 + 0.55 * depth)
  const SWIM_Y = 0.42
  const SWIM_WATER = 0.46
  // A young Strider's legs are shorter, so its steps are too.
  // Stride follows the leg (it did follow age alone): a long-legged wader steps farther at the same rhythm, a short-legged one shorter.
  const WALK = { v: 0.38 * legK, stride: 0.34 * legK, duty: 0.7 }
  const SWIM_V = 0.7
  const FEET: { leg: Leg; kind: 'fore' | 'hind'; phase: number; x0: number; side: number }[] = [
    { leg: legs.hindL, kind: 'hind', phase: 0, x0: w(-0.36), side: -1 },
    { leg: legs.foreL, kind: 'fore', phase: 0.25, x0: w(0.14), side: -1 },
    { leg: legs.hindR, kind: 'hind', phase: 0.5, x0: w(-0.36), side: 1 },
    { leg: legs.foreR, kind: 'fore', phase: 0.75, x0: w(0.14), side: 1 },
  ]
  const PAD = 0.02
  const state = { t: 0, w: 0, s: 0, f: 0, phase: 0, tail: 0, prevFoot: new Map<Leg, number>(), stanced: new Map<Leg, number>(), seed: r() * 10 }
  const v3 = new Vector3()
  const foot = new Vector3()
  const tuck = new Vector3()

  const update = (dt: number, input: MotionInput): Frame => {
    dt = Math.min(dt, 0.05)
    rig.root.updateMatrixWorld(true)
    const { motion } = input
    state.t += dt
    state.w = approach(state.w, motion === 'wade' ? 1 : 0, 2.2, dt)
    state.s = approach(state.s, motion === 'swim' ? 1 : 0, 1.5, dt)
    state.f = approach(state.f, motion === 'forage' ? 1 : 0, 1.8, dt)
    // The depth it stands in: the habitat control, unless something else (the agent's environment) says.
    const waterNow = hindH * (0.04 + 0.55 * clamp(input.water ?? depth))
    const lift = Math.min(0.2, 0.06 + 0.6 * waterNow)
    const land = 1 - state.s
    const w = state.w * land
    const sw = state.s
    const f = state.f * land
    const wb = smooth(clamp(w * 1.1))
    const vWalk = WALK.v * input.pace
    const period = WALK.stride / (WALK.duty * vWalk)
    state.phase = (state.phase + (dt / period) * w) % 1
    const ph = state.phase
    const tt = state.t
    const TAU = Math.PI * 2
    state.tail += dt * TAU * (0.35 * (1 - w) * (1 - sw) + (w / period) * 1 + sw * 1.1 * input.pace)
    const speed = (vWalk * w + SWIM_V * input.pace * sw) * size
    const breath = Math.sin(tt * 1.3)

    // Foraging, as a sequence: lower the head and look about, hold, strike, swallow.
    const u = ((tt + state.seed) / 5) % 1
    const rise = smooth(clamp(u / 0.22)) * (1 - smooth(clamp((u - 0.72) / 0.22)))
    const strike = Math.exp(-(((u - 0.55) / 0.03) ** 2))
    const look = Math.sin(tt * 1.7) * (u > 0.22 && u < 0.5 ? 1 : 0.25)
    const fl = f * rise

    // The body: it sways over the feet that carry it, with the shoulders and hips counter-rolling; afloat, it rides the water.
    const sway = w * Math.sin(TAU * ph + 0.3)
    const landY = bodyY - 0.2 * fl + 0.006 * w * Math.cos(2 * TAU * ph) + 0.004 * breath
    body.position.set(0, lerp(landY, SWIM_Y + 0.012 * Math.sin(state.tail), sw), 0.045 * sway * (1 - sw))
    body.rotation.set(-0.06 * sway * (1 - sw) + 0.01 * (1 - w) * Math.sin(tt * 0.35) + 0.03 * sw * Math.sin(state.tail), 0, 0)
    const wave = state.tail
    turn(torso1, [Y_AXIS, -0.05 * w * Math.sin(TAU * ph + 0.5) + sw * 0.08 * Math.sin(wave)], [X_AXIS, 0.04 * sway], [Z_AXIS, -0.5 * fl + 0.01 * breath])
    turn(torso2, [Y_AXIS, 0.07 * w * Math.sin(TAU * ph + 0.5) + 0.03 * (1 - w) * (1 - sw) * Math.sin(tt * 0.5) + sw * 0.16 * Math.sin(wave - 0.9)], [X_AXIS, -0.05 * sway], [Z_AXIS, 0.1 * fl])
    // The snout: it thrusts a little with each step; the feeding sequence is here.
    turn(head, [Y_AXIS, 0.2 * (1 - w) * (1 - f) * (1 - sw) * Math.sin(tt * 0.3 + state.seed) + 0.08 * look * fl + 0.06 * w * Math.sin(TAU * ph + 0.5) - 0.07 * sw * Math.sin(wave)], [Z_AXIS, lerp(0.03, 0, sw) + 0.04 * w * Math.sin(TAU * ph + 0.6) - 0.5 * fl - 0.3 * strike * f + 0.02 * breath])

    // Sail and tail: the sail breathes, lies back to swim, folds to forage; the tail sweeps hard when swimming.
    turn(tail0, [Y_AXIS, 0.2 * Math.sin(state.tail) * (1 - 0.4 * w) + sw * 0.3 * Math.sin(state.tail - 0.9)], [Z_AXIS, -0.18 * fl])
    turn(tail1, [Y_AXIS, 0.26 * Math.sin(state.tail - 0.7) + sw * 0.3 * Math.sin(state.tail - 1.6)])
    turn(tail2, [Y_AXIS, 0.3 * Math.sin(state.tail - 1.4) + sw * 0.3 * Math.sin(state.tail - 2.3)])
    poseFan(dorsalFan, { open: lerp(0.88 + 0.12 * breath, 0.3, Math.max(sw * 0.8, fl)), bend: 0.05 + 0.05 * w, flutter: 0.02, t: tt, ripple: 0.07 + 0.05 * w + 0.1 * sw, rippleSpeed: 2.2, stiff: () => 0.3 * dev + 0.4 * el })
    poseFan(caudal, { open: 1, bend: 0, flutter: 0.03, t: tt, ripple: 0.14 + 0.08 * w + 0.2 * sw, rippleSpeed: 3 })

    // Limbs: a slow lateral-sequence walk with a deep, high step; afloat, tucked back along the flanks.
    rig.root.updateMatrixWorld(true)
    let slip = 0
    let reach = 0
    for (const ft of FEET) {
      const hind = ft.kind === 'hind'
      const lean0 = LEAN + (hind ? 0.05 : 0)
      const p0 = (ph + ft.phase) % 1
      let dx: number
      let dy: number
      let lean: number
      let toe: number
      let stance = false
      if (p0 < WALK.duty) {
        const k = p0 / WALK.duty
        dx = WALK.stride * (0.5 - k)
        dy = 0
        lean = lean0 + lerp(0.2, -0.3, k)
        toe = 0
        stance = true
      } else {
        const k = (p0 - WALK.duty) / (1 - WALK.duty)
        dx = WALK.stride * (-0.5 + smooth(k))
        dy = lift * Math.sin(Math.PI * Math.pow(k, 0.8))
        lean = lean0 + lerp(-0.3, 0.2, smooth(k)) + 0.55 * Math.sin(Math.PI * k)
        toe = 0.9 * Math.sin(Math.PI * k)
      }
      // A foot that stopped mid-swing (standing, foraging) is set down flat: the swing's toe and lean fade with the walk, and the toes
      // point down only as far as the foot is lifted.
      lean = lean0 + (lean - lean0) * wb
      toe = Math.min(toe * wb, Math.asin(clamp((dy * wb) / Math.max(0.05, ft.leg.lengths[3]!), 0, 1)))
      const x = ft.x0 + (hind ? -0.03 : 0.07) * fl + dx * wb
      const y = PAD + dy * wb
      // Feet are set down on a narrower line than the hips, and swing out a little to clear the other leg.
      foot.set(x, y, ft.side * (0.07 + 0.02 * (stance ? 0 : Math.sin(Math.PI * ((p0 - WALK.duty) / (1 - WALK.duty))))))
      rig.root.localToWorld(foot)
      // Afloat, the foot goes back along the flank instead.
      const torso = hind ? torso2 : torso1
      tuck.set(hind ? -0.56 : -0.62, hind ? -0.025 : -0.035, ft.side * (hind ? 0.098 : 0.112))
      torso.localToWorld(tuck)
      foot.lerp(tuck, sw)
      ft.leg.solve(foot, lerp(lean, -1.3, sw), lerp(toe, 0.1, sw))
      reach = Math.max(reach, ft.leg.miss)
      const seg = ft.leg.segs[3]!
      seg.getWorldPosition(v3)
      const prevX = state.prevFoot.get(ft.leg)
      if (stance && (state.stanced.get(ft.leg) ?? 0) >= 3 && w > 0.98 && sw < 0.02 && f < 0.02 && prevX !== undefined && dt > 0.002) slip = Math.max(slip, Math.abs((v3.x - prevX) / dt + speed))
      state.prevFoot.set(ft.leg, v3.x)
      state.stanced.set(ft.leg, stance ? (state.stanced.get(ft.leg) ?? 0) + 1 : 0)
    }

    const water = lerp(waterNow, SWIM_WATER, sw) * size
    const label = sw > 0.5 ? 'swim' : f > 0.5 ? (strike > 0.4 ? 'strike' : rise > 0.6 ? 'search' : 'forage') : w > 0.5 ? 'wade' : 'stand'
    return { speed, yawRate: 0, state: label, slip, water, notes: [['reach short', `${(reach * size * 100).toFixed(1)} cm`], ['water', `${(water * 100).toFixed(0)} cm`], ['lift', `${(lift * size * 100).toFixed(0)} cm`]] }
  }

  const high = (bodyY + 0.17 + 0.42 * finK) * size
  return {
    root: rig.root,
    skeleton,
    meshes,
    update,
    setWireframe: (on) => {
      matSoft.wireframe = on
      matHard.wireframe = on
    },
    dispose: () => {
      geoSoft.dispose()
      geoHard.dispose()
      matSoft.dispose()
      matHard.dispose()
      skeleton.dispose()
    },
    traits: readTraits('strider', T),
    anatomy: [
      ['trunk', (w(0.42) - w(-0.72)) * size],
      ['thigh', hindLen[0]! * size],
      ['shank', hindLen[1]! * size],
      ['foot', (hindLen[2]! + hindLen[3]!) * size],
      ['sail', 0.42 * finK * size],
    ],
    gait: { leg: hindH * size, stride: WALK.stride * size, cadence: (WALK.duty * WALK.v) / WALK.stride },
    stats: { triangles, vertices: geoSoft.attributes.position!.count + geoHard.attributes.position!.count, bones: rig.bones.length, drawCalls: 2, buildMs: performance.now() - t0, features: `${stageName(age)} · ${RD} sail rays · ${nC} tail rays · knee and ankle nodes ${dev > 0.05 ? 'grown' : 'not yet'} · crust to ${(crustTo * size * 100).toFixed(0)} cm` },
    frame: { target: [0.1 * size, 0.5 * high, 0], distance: 1.6 * high + 1.2 },
    size: { length: 1.4 * size + 0.5 * finK * size, height: high, span: 0 },
    water: waterWade * size,
  }
}
