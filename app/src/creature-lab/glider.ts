import { MeshStandardMaterial, Vector3 } from 'three'
import { makeFan, poseFan, skinFan } from './fan.ts'
import { elder, maturity, stageName } from './growth.ts'
import { clamp, hex, lerp, mix, rng, smooth, type RGB, type V } from './geo.ts'
import { approach, Leg, Rig, turn, X_AXIS, Y_AXIS, Z_AXIS } from './rig.ts'
import type { Creature, CreatureParams, Frame, MotionInput } from './types.ts'

/**
 * Veil Glider. A round-bodied, big-eyed glider of the high shelves. A gliding vertebrate is only the anatomical reference: a
 * forelimb (shoulder, elbow, wrist) whose wrist carries a fan of slender rays with a membrane between them, as a bat's hand
 * carries its wing and a flying fish's rays carry its fin. What is its own:
 *   - a hand-fan wing that folds like a fan against the flank, and a smaller fan on a short tail boom
 *   - a soft plume of filaments from the brow (sensing the air), and large eyes
 * MINERAL. Mineral is the glider's stiffening, not decoration. It is laid down in the rays from their roots outward, the leading
 * rays first: a calcified ray is thicker, paler and does not bend, a soft ray is thin, dark and flexes. A young or poor-
 * supply glider has soft, rippling wings; a mature one has a stiff leading edge. The hooked tips (which catch the propagules
 * that Architecture sheds) are the ends of the stiffest rays, so only the leading rays carry them.
 * HABITAT is exposure to wind: windy, open places make long, narrow wings (more rays, a long reach, a smaller tail); sheltered
 * ones make short, broad wings and a large tail for manoeuvring.
 */

const PAL = {
  body: hex('#a8a292'),
  bodyDark: hex('#76716a'),
  belly: hex('#cdc7b6'),
  membrane: hex('#d6d0bf'),
  membraneEdge: hex('#ebe6d6'),
  membraneRoot: hex('#9f9989'),
  rayDark: hex('#6a655a'),
  bone: hex('#e0dac8'),
  claw: hex('#e4dfd0'),
  dark: hex('#14130f'),
}

export function buildGlider(p: CreatureParams): Creature {
  const t0 = performance.now()
  const r = rng(p.seed * 211 + 13)
  const vary = (a: number, b: number) => a + (b - a) * r()
  const age = clamp(p.age)
  const exposure = clamp(p.habitat)
  const m = maturity(age)
  const el = elder(age)
  // A young glider is round and big-headed, with short wings of few rays, no layered feathers and a short, plain tail; the adult is
  // slimmer, long in the wing, with many rays, layers of covert feathers and long outer tail feathers. Old gliders keep it, worn.
  const size = 0.55 + 0.45 * m
  const plan = p.plan ?? {}
  const headK = (1 + 0.35 * (1 - m)) * 1.1 * (plan.head ?? 1)
  const girth = (0.9 + 0.2 * clamp(p.condition)) * (1.06 - 0.12 * m) * (plan.girth ?? 1)
  const spanK = (0.62 + 0.38 * m) * vary(0.95, 1.06) * (0.9 + 0.25 * exposure) * (plan.wing ?? 1)
  // Wing breadth: how far the rays fan back from the leading edge. Broad wings (low aspect) for slow flight among trees, narrow ones for open air.
  const betaMax = lerp(1.5, 1.15, exposure) * (plan.chord ?? 1)
  const tailK = (1.15 - 0.3 * exposure) * (0.55 + 0.45 * m) * (plan.tail ?? 1)
  const Rfull = 9 + Math.floor(r() * 2) + (exposure < 0.35 ? 1 : 0)
  const R = Math.max(5, Math.round(lerp(5, Rfull, m)))
  const wear = 1 - clamp(p.condition)
  // Mineral is laid down over the years: what it has taken up, and the time it has had.
  const dev = clamp(p.mineral) * smooth(clamp((age - 0.18) / 0.62))
  /** How much of ray `i` is calcified, from its root (0 to 1): the leading rays first. */
  const calc = (i: number) => clamp(dev * 1.4 - 0.55 * (i / (R - 1)))
  const K = 3

  const rig = new Rig()
  const body = rig.bone('body', null, [0, 1.5, 0])
  const torso1 = rig.bone('torso1', body, [0, 0, 0])
  const torso2 = rig.bone('torso2', torso1, [-0.15, -0.008, 0])
  const neck = rig.bone('neck', torso1, [0.17, 0.014, 0])
  const head = rig.bone('head', neck, [0.08, 0.012, 0])
  const tail0 = rig.bone('tail0', torso2, [-0.12, 0, 0])
  const tail1 = rig.bone('tail1', tail0, [-0.13, 0, 0])
  const tail2 = rig.bone('tail2', tail1, [-0.11, 0, 0])

  const ribAngles = Array.from({ length: R }, (_, i) => lerp(-0.4, betaMax, i / (R - 1)))
  const ribLens = (side: number) =>
    ribAngles.map((_, i) => {
      const u = i / (R - 1)
      const base = u < 0.3 ? lerp(0.8, 1, u / 0.3) : u < 0.65 ? lerp(1, 0.88, (u - 0.3) / 0.35) : lerp(0.88, 0.55, (u - 0.65) / 0.35)
      const tear = (wear * 0.4 + el * 0.12 * (i / (R - 1))) * rng(p.seed * 7 + i * 13 + (side > 0 ? 0 : 5))()
      return 0.5 * spanK * base * (1 - tear) * (0.97 + 0.06 * r())
    })
  const wings = [1, -1].map((s) => {
    const side = s > 0 ? 'R' : 'L'
    const shoulder = rig.bone(`shoulder.${side}`, torso1, [0.05, 0.04, s * 0.05])
    const elbow = rig.bone(`elbow.${side}`, shoulder, [0, 0, s * 0.17 * spanK])
    const wrist = rig.bone(`wrist.${side}`, elbow, [0, 0, s * 0.2 * spanK])
    const fan = makeFan(rig, `wing.${side}`, wrist, { axis: [0, 0, s], fanAxis: Y_AXIS, across: X_AXIS, yaw: -s, bend: s, betas: ribAngles, lens: ribLens(s), K })
    return { s, shoulder, elbow, wrist, fan }
  })
  // The tail: three short rays in the young, seven in the adult, of which the outer two grow into long streamers.
  const tailN = Math.max(3, Math.round(lerp(3, 7, m)))
  const stream = smooth(clamp((m - 0.5) / 0.4))
  const tailBetas = Array.from({ length: tailN }, (_, i) => lerp(-0.66, 0.66, tailN === 1 ? 0.5 : i / (tailN - 1)))
  const tailLens = tailBetas.map((b, i) => {
    const edge = i === 0 || i === tailN - 1
    return (0.24 * Math.cos(b * 1.1) ** 1.5 + (edge ? 0.16 * stream : 0)) * tailK
  })
  const tailFan = makeFan(rig, 'tailfan', tail2, { axis: [-1, 0, 0], fanAxis: Y_AXIS, across: Z_AXIS, yaw: 1, bend: 1, betas: tailBetas, lens: tailLens, K: 2 })

  const legLen = [0.08, 0.09, 0.05, 0.045]
  const hip: V = [-0.06, -0.055, 0.042]
  const legR = new Leg(rig, torso2, 'legR', hip, legLen, 1)
  const legL = new Leg(rig, torso2, 'legL', [hip[0], hip[1], -hip[2]], legLen, 1)

  rig.settle()
  const soft = rig.mesher(false)
  const hard = rig.mesher(true)
  const ix = (b: Parameters<Rig['index']>[0]) => rig.index(b)
  const bodyAt = (t: number, up: number): RGB => mix(mix(PAL.bodyDark, PAL.body, clamp(0.4 + 0.4 * t)), PAL.belly, clamp(0.5 - up * 0.9) * 0.9)

  // Body: a round little spindle with a deep chest.
  const prof: [number, number, number, number][] = [
    [-0.28, 0.012, 0.012, 0],
    [-0.22, 0.045, 0.04, 0.002],
    [-0.14, 0.072, 0.062, 0],
    [-0.04, 0.092, 0.078, -0.004],
    [0.06, 0.098, 0.082, -0.006],
    [0.14, 0.082, 0.07, 0],
    [0.19, 0.062, 0.052, 0.006],
    [0.25, 0.05, 0.045, 0.012],
  ]
  const at = (x: number) => {
    let i = 0
    while (i < prof.length - 2 && x > prof[i + 1]![0]) i += 1
    const a = prof[i]!
    const b = prof[i + 1]!
    const t = smooth(clamp((x - a[0]) / (b[0] - a[0])))
    return { ry: lerp(a[1], b[1], t) * girth, rz: lerp(a[2], b[2], t) * girth, cy: lerp(a[3], b[3], t) }
  }
  const cut = (name: string, prev: string | null, next: string | null, ox: number, oy: number, x0: number, x1: number) => {
    const sections = Array.from({ length: 6 }, (_, k) => {
      const X = lerp(x0, x1, k / 5)
      const s = at(X)
      return { x: X - ox, y: s.cy - oy, ry: s.ry, rz: s.rz, n: 2.1 }
    })
    soft.part(ix(name), prev ? ix(prev) : -1, next ? ix(next) : -1).loft(sections, bodyAt, 10)
  }
  cut('torso2', 'torso1', null, -0.15, -0.008, -0.28, -0.15)
  cut('torso1', null, 'neck', 0, 0, -0.15, 0.17)
  cut('neck', 'torso1', 'head', 0.17, 0.014, 0.17, 0.25)

  // Head: a big round skull, a short beak, and large eyes. A plume of soft filaments grows from the brow.
  {
    const sk = [
      { x: -0.035, ry: 0.04, rz: 0.04 },
      { x: 0.015, ry: 0.058, rz: 0.056 },
      { x: 0.065, ry: 0.048, rz: 0.044 },
      { x: 0.115, ry: 0.03, rz: 0.026 },
      { x: 0.155, ry: 0.01, rz: 0.01 },
    ].map((s) => ({ ...s, ry: s.ry * headK, rz: s.rz * headK, n: 2.2 }))
    soft.part(ix(head), ix(neck), -1).loft(sk, (t, up) => mix(bodyAt(0.6, up), PAL.bodyDark, t > 0.88 ? 0.55 : 0), 10)
    for (const side of [-1, 1]) {
      const ez = 0.044 * headK * side
      const e = 0.02 * headK
      soft.loft([
        { x: 0.02, y: 0.012 * headK, z: ez, ry: 0.003, rz: 0.003 },
        { x: 0.045, y: 0.012 * headK, z: ez * 1.08, ry: e, rz: e, n: 2 },
        { x: 0.07, y: 0.012 * headK, z: ez * 1.02, ry: 0.003, rz: 0.003 },
      ], () => PAL.dark, 8)
    }
    // A plume of fine filaments from the brow: two in the young, five in the adult, a little thinner in the old.
    const fil = Math.max(2, Math.round(lerp(2, 5, m) - (el > 0.6 ? 1 : 0)))
    for (let k = 0; k < fil; k += 1) {
      const z = (k - (fil - 1) / 2) * 0.011
      const len = (0.09 + 0.05 * m) * (1 + 0.28 * (fil - 1 - Math.abs(k - (fil - 1) / 2) * 2) / Math.max(1, fil - 1))
      const path: V[] = [0, 0.25, 0.55, 1].map((f) => [0.01 - f * len * 0.9, 0.05 * headK + Math.sin(f * 2.4) * len * 0.5, z * (1 + f * 1.8)] as V)
      soft.tube(path, (t) => 0.0028 * (1 - t) * (1 - 0.3 * el) + 0.0005, () => mix(PAL.belly, PAL.membraneEdge, 0.5), 4, { open: true })
    }
  }

  // Wing arms and fans. Rays are soft where they are young and calcified (thick, pale, stiff) from the root out.
  for (const w of wings) {
    const s = w.s
    const sh = ix(w.shoulder)
    const el = ix(w.elbow)
    const wr = ix(w.wrist)
    const humerus = 0.17 * spanK
    const forearm = 0.2 * spanK
    soft.part(sh, -1, el).tube([[0, 0, 0], [0, 0, s * humerus * 0.5], [0, 0, s * humerus]], (t) => lerp(0.024, 0.014, t) * girth, (t) => bodyAt(0.6, 0.2 + t * 0.3), 8)
    soft.part(el, sh, wr).tube([[0, 0, 0], [0, 0, s * forearm * 0.5], [0, 0, s * forearm]], (t) => lerp(0.015, 0.011, t), () => PAL.bodyDark, 7)
    soft.part(wr, el, -1).loft([{ x: -0.012, ry: 0.003, rz: 0.003 }, { x: 0, ry: 0.014, rz: 0.014, n: 2 }, { x: 0.012, ry: 0.003, rz: 0.003 }], () => PAL.bodyDark, 7)
    skinFan(rig, soft, hard, w.fan, {
      thick: (i, f) => {
        const c = calc(i)
        const base = lerp(0.0055, 0.0018, f) * (i === 0 ? 1.5 : 1)
        return f < c ? base * (1.3 + 0.9 * c) : base
      },
      colour: (i, f) => (f < calc(i) ? mix(PAL.bone, PAL.membraneEdge, f) : PAL.rayDark),
      hook: (i) => (i < 4 ? (0.01 + 0.032 * calc(i) * (calc(i) > 0.5 ? 1 : 0)) * (1 - 0.45 * el) : 0),
      tone: (_i, k) => mix(PAL.membraneRoot, PAL.membraneEdge, Math.pow(k / K, 0.7)),
      parity: 0.1,
      hookColour: PAL.bone,
      scallop: 0.05 + 0.14 * m,
      coverts: { amounts: [clamp((m - 0.12) / 0.45) * (1 - 0.3 * el), clamp((m - 0.45) / 0.4) * (1 - 0.4 * el)], tone: (L, f) => mix(mix(PAL.membrane, PAL.membraneEdge, 0.3 + 0.4 * f), PAL.belly, 0.2 * L + 0.25 * el) },
    })
  }
  skinFan(rig, soft, hard, tailFan, {
    thick: (_i, f) => lerp(0.004, 0.0015, f),
    colour: (_i, f) => mix(PAL.rayDark, PAL.bodyDark, f),
    hook: () => 0,
    tone: (_i, k) => mix(PAL.membraneRoot, PAL.membraneEdge, Math.pow(k / 2, 0.7)),
    parity: 0.08,
    hookColour: PAL.bone,
    scallop: 0.12 * m + 0.04,
    coverts: { amounts: [clamp((m - 0.35) / 0.5) * (1 - 0.35 * el)], tone: (_L, f) => mix(PAL.membrane, PAL.membraneEdge, 0.3 + 0.5 * f) },
  })
  soft.part(ix(tail0), ix(torso2), ix(tail1)).tube([[0, 0, 0], [-0.065, 0, 0], [-0.13, 0, 0]], (t) => lerp(0.03, 0.019, t) * girth, (t) => bodyAt(0.5 + 0.2 * t, 0), 8)
  soft.part(ix(tail1), ix(tail0), ix(tail2)).tube([[0, 0, 0], [-0.065, 0, 0], [-0.11, 0, 0]], (t) => lerp(0.019, 0.011, t), () => bodyAt(0.5, 0), 8)
  soft.part(ix(tail2), ix(tail1), -1).tube([[0, 0, 0], [-0.055, 0, 0], [-0.09, 0, 0]], (t) => lerp(0.011, 0.008, t), () => PAL.bodyDark, 7)

  // Legs: slight, with grasping toes.
  for (const leg of [legR, legL]) {
    const [s0, s1, s2, s3] = leg.segs.map((b) => ix(b)) as [number, number, number, number]
    const down = (len: number, n = 4): V[] => Array.from({ length: n }, (_, i) => [0, (-len * i) / (n - 1), 0])
    soft.part(s0, -1, s1).tube(down(legLen[0]!), (t) => lerp(0.021, 0.013, t) + 0.005 * Math.sin(Math.PI * t), (t) => bodyAt(0.5, 0.1 + 0.2 * t), 7)
    soft.part(s1, s0, s2).tube(down(legLen[1]!), (t) => lerp(0.013, 0.009, t), () => PAL.bodyDark, 6)
    soft.part(s2, s1, s3).tube(down(legLen[2]!), (t) => lerp(0.009, 0.008, t), () => PAL.bodyDark, 5)
    soft.part(s3, s2, -1)
    for (const off of [0, 0.011, -0.011]) {
      soft.tube([[0, 0, off * 0.4], [0, -legLen[3]! * 0.55, off], [0, -legLen[3]!, off * 1.3]], (t) => lerp(0.008, 0.005, t), () => PAL.bodyDark, 5, { blend: 0.15 })
      hard.part(s3).tube([[0, -legLen[3]!, off * 1.3], [-0.006, -legLen[3]! - 0.012, off * 1.3], [-0.016, -legLen[3]! - 0.018, off * 1.3]], (t) => 0.0042 * (1 - t) + 0.0007, () => PAL.claw, 4)
    }
  }

  const matSoft = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: 2 })
  const matHard = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.02, side: 2 })
  const geoSoft = soft.build()
  const geoHard = hard.build()
  const { skeleton, meshes } = rig.skin(geoSoft, geoHard, { soft: matSoft, hard: matHard })
  rig.root.scale.setScalar(size)
  const triangles = (geoSoft.index ? geoSoft.index.count : geoSoft.attributes.position!.count) / 3 + geoHard.attributes.position!.count / 3

  // ---------------------------------------------------------------------------------------------- motion
  // GLIDE SPEED FROM WING LOADING. A glider's steady speed grows with the square root of its weight per unit of wing (W/S): a heavier body or a
  // smaller wing glides faster and turns wider; a broad, long wing on a slim body glides slowly and turns tight. Weight goes with girth squared
  // (the body's cross-section; its length is fixed), wing area with span times breadth, both relative to the species as designed.
  const loading = (girth / (0.9 + 0.2 * 0.7) / 0.94) ** 2 / ((plan.wing ?? 1) * (plan.chord ?? 1))
  const GLIDE_V = 6 * Math.sqrt(loading)
  const PERCH = { y: 1.38, x: 0.04 }
  const BAR_TOP = 1.14
  const GLIDE_Y = 2.15
  const state = { t: 0, p: 1, b: 0, bankT: 0, look: r() * 6 }
  const foot = new Vector3()
  const stiffness = (i: number) => 0.8 * calc(i)

  const update = (dt: number, input: MotionInput): Frame => {
    dt = Math.min(dt, 0.05)
    rig.root.updateMatrixWorld(true)
    const { motion } = input
    state.t += dt
    const tt = state.t
    state.p = approach(state.p, motion === 'perch' ? 1 : 0, 1.5, dt)
    if (motion === 'bank') state.bankT += (dt * Math.PI * 2) / 9
    state.b = approach(state.b, motion === 'bank' ? Math.sin(state.bankT) : 0, 1.7, dt)
    const p = state.p
    const fly = 1 - p
    const b = state.b
    const roll = b * ((input.bank * Math.PI) / 180)
    const load = 1 / Math.cos(roll)
    const speed = GLIDE_V * size * fly
    const yawRate = (fly * 9.81 * Math.tan(roll)) / (GLIDE_V * size)

    // Whole body: perched upright on the ledge, or flat in the air with a slow rise and fall (a long, gentle swing).
    const phug = Math.sin(tt * 1.05)
    const breath = Math.sin(tt * 2.2)
    body.position.set(lerp(0, PERCH.x, p), lerp(GLIDE_Y + 0.14 * phug, PERCH.y + 0.004 * breath, p), 0)
    const pitch = lerp(-0.07 + 0.045 * Math.sin(tt * 1.05 + 0.6) - 0.07 * Math.abs(b), 0.62, p)
    turn(body, [Y_AXIS, 0], [Z_AXIS, pitch], [X_AXIS, roll + 0.025 * fly * Math.sin(tt * 0.7) + 0.02 * p * Math.sin(tt * 0.5)])
    turn(torso2, [Y_AXIS, -0.1 * b * fly], [Z_AXIS, lerp(0.03, -0.12, p)])
    // The head looks about; in flight it looks into the turn and holds the horizon.
    turn(neck, [Y_AXIS, -0.25 * b * fly + 0.15 * fly * Math.sin(tt * 0.8 + state.look) + p * (0.5 * Math.sin(tt * 0.4 + state.look) + 0.15 * Math.sin(tt * 1.1))], [Z_AXIS, lerp(0.08 * phug, -0.45, p) - 0.1 * Math.abs(b)])
    turn(head, [Y_AXIS, 0.2 * p * Math.sin(tt * 0.7 + 1)], [Z_AXIS, -pitch * 0.45 + 0.05 * Math.sin(tt * 0.9)], [X_AXIS, -roll * 0.7])

    // Wings: folded against the flank when perched, a fan spread flat when gliding. The leading rays are stiff; the rest ripple.
    const ruffle = p * Math.max(0, Math.sin(tt * 0.43 + state.look)) ** 14 * 0.3
    const fold = clamp(p - ruffle - 0.03 * p * Math.sin(tt * 0.6))
    const open = lerp(1, 0.05, smooth(fold))
    for (const w of wings) {
      const s = w.s
      const outer = -s * b // the wing that rises in a bank
      const f = smooth(fold)
      turn(w.shoulder, [X_AXIS, s * lerp(-0.1 - 0.05 * outer, 0.18, f)], [Y_AXIS, -s * lerp(0.32 + 0.1 * outer, 1.45, f)], [Z_AXIS, lerp(0.1 + 0.18 * outer, 0, f)])
      turn(w.elbow, [Y_AXIS, -s * lerp(-0.12, -2.85, f)])
      turn(w.wrist, [Y_AXIS, -s * lerp(-0.1, 3.0, f)])
      poseFan(w.fan, { open: open * (1 + 0.06 * outer), bend: lerp(-(0.1 + 0.3 * (load - 1) + 0.04 * outer), 0.1, f), flutter: 0.012 * fly, t: tt, stiff: stiffness, ripple: 0.05 * fly * (1 + 0.5 * Math.abs(b)) })
    }
    // Tail: the fan spreads in flight, steers into a turn, and hangs closed when perched.
    turn(tail0, [Y_AXIS, -0.12 * b * fly], [Z_AXIS, lerp(0.02 * Math.sin(tt * 1.05), 0.5, p)], [X_AXIS, -0.1 * b * fly])
    turn(tail1, [Y_AXIS, -0.18 * b * fly + 0.05 * p * Math.sin(tt * 0.8) + 0.04 * fly * Math.sin(tt * 1.3)], [Z_AXIS, lerp(0.03, 0.3, p)])
    turn(tail2, [Y_AXIS, -0.2 * b * fly], [Z_AXIS, lerp(0.04 * phug, 0.2, p)])
    poseFan(tailFan, { open: lerp(1, 0.28, p), bend: lerp(-0.06, 0.1, p), flutter: 0.02 * fly, t: tt, skew: 0.15 * b * fly, ripple: 0.04 * fly })

    // Feet: gripping the bar when perched, tucked back under the body in flight.
    rig.root.updateMatrixWorld(true)
    for (const [leg, side] of [[legR, 1], [legL, -1]] as const) {
      const bar = new Vector3(0, BAR_TOP + 0.02, side * 0.045)
      const tuck = new Vector3(-0.17, -0.025, side * 0.03)
      torso2.localToWorld(tuck)
      rig.root.worldToLocal(tuck)
      foot.copy(bar).lerp(tuck, 1 - p)
      rig.root.localToWorld(foot)
      leg.solve(foot, lerp(0.9, 1.1, p), lerp(0.6, 1.15, p))
    }

    const deg = (roll * 180) / Math.PI
    const label = p > 0.5 ? 'perched' : Math.abs(b) > 0.25 && motion === 'bank' ? `bank ${deg > 0 ? 'right' : 'left'}` : 'glide'
    return { speed, yawRate, state: label, slip: 0, notes: [['speed', `${speed.toFixed(1)} m/s`], ['roll', `${deg.toFixed(0)}°`], ['load', `${load.toFixed(2)} g`]] }
  }

  const spanOpen = (0.05 + 0.17 * spanK + 0.2 * spanK + Math.max(...ribLens(1))) * 2 * size
  const stiffRays = Array.from({ length: R }, (_, i) => calc(i)).filter((c) => c > 0.5).length
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
    stats: { triangles, vertices: geoSoft.attributes.position!.count + geoHard.attributes.position!.count, bones: rig.bones.length, drawCalls: 2, buildMs: performance.now() - t0, features: `${stageName(age)} · ${R} wing rays (${stiffRays} stiff) · ${tailN} tail rays` },
    frame: { target: [0, 1.85 * size, 0], distance: 3.6 * size + 0.9 },
    size: { length: 0.62 * size, height: 0.3 * size, span: spanOpen },
    anatomy: [['span', spanOpen], ['arm', (0.17 + 0.2) * spanK * size], ['longest ray', Math.max(...ribLens(1)) * size], ['tail fan', Math.max(...tailLens) * size], ['glide speed', GLIDE_V * size], ['wing loading ×', loading]],
  }
}
