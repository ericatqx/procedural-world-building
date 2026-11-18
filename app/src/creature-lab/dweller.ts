import { MeshStandardMaterial, Vector3, type Bone } from 'three'
import { clamp, hex, lerp, mix, rng, smooth, type RGB, type V } from './geo.ts'
import { elder, maturity, stageName } from './growth.ts'
import { readTraits, traitsOf } from './traits.ts'
import { approach, Leg, Rig, turn, X_AXIS, Y_AXIS, Z_AXIS } from './rig.ts'
import type { Creature, CreatureParams, Frame, MotionInput } from './types.ts'

/**
 * Hollow Dweller. A low, deep-bodied, hunched digitigrade animal of the hollows under Living Architecture. A badger-and-anteater
 * posture and a cat's three-bone leg are only anatomical references. What is its own:
 *   - short legs under a deep, arched body, so it moves like something that lives under a ceiling
 *   - great shovel forepaws with long scraping claws (the tools of an animal that works a cavity), and a low-slung head
 *   - big, independent ear vanes that swivel (a hollow is read by sound and draught); dark almond eyes, deep-set under the brow
 *   - a long soft tail carried low, curled at the tip
 * MINERAL. The island's hollows weep dissolved mineral. The Dweller takes it up and lays it down as thickened skin where its
 * back rubs the ceiling: a saddle of overlapping, flat scutes that begins at the withers and spreads back toward the rump as it
 * ages, and bands around the base of the tail. They are skin, not attachments: low, wide, flush with the back, pale where
 * they are oldest. How many, and how far back, is `mineral` (supply) gated by `age` (time to lay it down). The claws are
 * the same material, which is why they wear and regrow.
 * HABITAT is the depth of the hollow it lives in: deeper hollows make shorter legs and a lower body, bigger ears, smaller eyes,
 * paler skin and longer claws.
 */

const PAL = {
  hide: hex('#8a8476'),
  hideDark: hex('#68645a'),
  belly: hex('#b9b3a4'),
  pale: hex('#cdc7b6'),
  plate: hex('#d6d0bf'),
  plateTop: hex('#e8e3d3'),
  claw: hex('#e4dfd0'),
  dark: hex('#14130f'),
  nose: hex('#3a362f'),
}

/** The body profile from haunch to head, in the pelvis frame: x, half height, half width, centre height. */
const STATIONS0: [number, number, number, number][] = [
  [-0.16, 0.05, 0.045, -0.005],
  [-0.09, 0.115, 0.095, -0.005],
  [0.0, 0.14, 0.11, 0],
  [0.12, 0.13, 0.1, 0.01],
  [0.25, 0.115, 0.09, 0.02],
  [0.38, 0.135, 0.1, 0.01],
  [0.5, 0.165, 0.125, -0.025],
  [0.62, 0.17, 0.125, -0.055],
  [0.7, 0.14, 0.105, -0.075],
  [0.77, 0.1, 0.085, -0.095],
  [0.84, 0.085, 0.08, -0.11],
]
const BONES_AT0 = { waist: 0.25, chest: 0.5, neck1: 0.7, neck2: 0.77, head: 0.84 }
/**
 * TORSO LENGTH (the Builder's body plan) stretches the trunk between the haunch (x = 0) and the chest (x = 0.5) and carries the neck and head
 * forward unchanged. The profile and the spine bones are re-made for each build from the canonical ones above, so the body, the bones that
 * carry it and every part placed along it move together. Builds are synchronous, so module state set at the start of a build is safe.
 */
const torsoWarp = (t: number) => (x: number) => (x <= 0 ? x : x <= 0.5 ? x * t : x + 0.5 * (t - 1))
let STATIONS = STATIONS0
let BONES_AT = BONES_AT0
/** Keeps a leg's total length and moves its knee: `k` > 1 a longer upper segment, < 1 a longer lower one. */
export function kneeSplit(a: number, b: number, k: number): [number, number] {
  const s = a + b
  const a2 = (s * a * k) / (a * k + b)
  return [a2, s - a2]
}

/** The most a claw curls below the pad (the foot bone stands 2 cm up): long claws curl, but their tips rest on the ground, not in it. */
const PAD_CURL = 0.017

function station(x: number, girth: number, muscle = 1) {
  let i = 0
  while (i < STATIONS.length - 2 && x > STATIONS[i + 1]![0]) i += 1
  const a = STATIONS[i]!
  const b = STATIONS[i + 1]!
  const l = clamp((x - a[0]) / (b[0] - a[0]))
  const t = smooth(l)
  // Muscle fills out the haunch and the shoulder as it matures; a pup is smoother there.
  const bulk = 1 + 0.12 * muscle * (Math.exp(-(((x - 0.0) / 0.18) ** 2)) + Math.exp(-(((x - 0.55) / 0.15) ** 2)))
  return { ry: lerp(a[1], b[1], t) * girth * bulk, rz: lerp(a[2], b[2], t) * girth * bulk, cy: lerp(a[3], b[3], l) }
}

export function buildDweller(p: CreatureParams): Creature {
  const t0 = performance.now()
  const r = rng(p.seed * 131 + 7)
  const vary = (a: number, b: number) => a + (b - a) * r()
  const age = clamp(p.age)
  const hollow = clamp(p.habitat)
  const m = maturity(age)
  const el = elder(age)
  const size = 0.82 * (0.55 + 0.45 * m)
  // Linked body-plan axes (traits.ts): build (stocky to lithe), head : body, forelimbs (runner to digger).
  const T = { ...traitsOf('dweller', p.seed), ...p.traits }
  const plan = p.plan ?? {}
  const warp = torsoWarp(plan.torso ?? 1)
  STATIONS = STATIONS0.map((s) => [warp(s[0]), s[1], s[2], s[3]])
  BONES_AT = { waist: warp(BONES_AT0.waist), chest: warp(BONES_AT0.chest), neck1: warp(BONES_AT0.neck1), neck2: warp(BONES_AT0.neck2), head: warp(BONES_AT0.head) }
  const tb = T.build ?? 0
  const th = T.head ?? 0
  const tf = T.fore ?? 0
  // A pup has a rounder, larger head, a shorter muzzle, shorter limbs and a shorter tail; the adult is longer in all of them.
  const headK = (1 + 0.3 * (1 - m)) * 1.1 * (1 + 0.13 * th) * (plan.head ?? 1)
  const legK = (0.82 + 0.18 * m) * vary(0.95, 1.06) * (1 - 0.14 * hollow) * (1 + 0.12 * tb) * (plan.leg ?? 1)
  const girth = (0.9 + 0.2 * clamp(p.condition)) * (1.06 - 0.08 * m) * (1 - 0.09 * tb) * (plan.girth ?? 1)
  const snout = vary(0.94, 1.1) * (0.72 + 0.28 * m) * (1 + 0.08 * th)
  const earK = vary(0.9, 1.1) * (1 + 0.3 * (1 - m)) * (1 + 0.25 * hollow) * (1 + 0.1 * th)
  const eyeK = (1 - 0.35 * hollow) * (1 + 0.25 * (1 - m))
  // Claws grow in with age and wear down in old age.
  const clawK = (0.5 + 0.5 * m) * (1 - 0.25 * el) * (1 + 0.45 * hollow) * (1 + 0.35 * tf)
  const tailN = Math.max(6, Math.round(lerp(6, 9 + Math.floor(r() * 3), m)))
  // Mineral is laid down over the years: what it has taken up, and the time it has had.
  const dev = clamp(p.mineral) * smooth(clamp((age - 0.18) / 0.62))
  const pale = 0.12 + 0.4 * hollow + 0.22 * el
  const scutes = Math.round(dev * 10 + (dev > 0.04 ? 1 : 0))

  const rig = new Rig()
  const body = rig.bone('body', null, [0, 0, 0])
  const pelvis = rig.bone('pelvis', body, [0, 0, 0])
  const at = (key: keyof typeof BONES_AT) => ({ x: BONES_AT[key], y: station(BONES_AT[key], 1).cy })
  const waistAt = at('waist')
  const chestAt = at('chest')
  const n1At = at('neck1')
  const n2At = at('neck2')
  const headAt = at('head')
  const waist = rig.bone('waist', pelvis, [waistAt.x, waistAt.y, 0])
  const chest = rig.bone('chest', waist, [chestAt.x - waistAt.x, chestAt.y - waistAt.y, 0])
  const neck1 = rig.bone('neck1', chest, [n1At.x - chestAt.x, n1At.y - chestAt.y, 0])
  const neck2 = rig.bone('neck2', neck1, [n2At.x - n1At.x, n2At.y - n1At.y, 0])
  const head = rig.bone('head', neck2, [headAt.x - n2At.x, headAt.y - n2At.y, 0])
  const earR = rig.bone('ear.R', head, [-0.016, 0.07 * headK, 0.06 * headK])
  const earL = rig.bone('ear.L', head, [-0.016, 0.07 * headK, -0.06 * headK])

  // Legs: short, with heavy forelimbs that end in shovels.
  // A digger's forelimbs are longer (the hind a little shorter); a runner's are as long but slimmer, with smaller claws. Shortening the
  // forelimbs instead left the fore paws short of the ground (the body's height is set from the hind legs): the gait probe showed it.
  const hk = 1 - 0.04 * Math.max(0, tf)
  const fk = 1 + 0.09 * Math.max(0, tf)
  const kn = plan.knee ?? 1
  const [hThigh, hShin] = kneeSplit(0.2, 0.22, kn)
  const [fUpper, fLower] = kneeSplit(0.2, 0.2, kn)
  const hindLen = [hThigh * legK * hk, hShin * legK * hk, 0.13 * legK * hk, 0.085 * legK]
  const foreLen = [fUpper * legK * fk, fLower * legK * fk, 0.1 * legK * fk, 0.1 * legK]
  const LEAN = { hind: 0.38, fore: 0.18 }
  const standH = (l: number[], lean: number) => 0.9 * (l[0]! + l[1]!) + l[2]! * Math.cos(lean)
  const hindH = standH(hindLen, LEAN.hind)
  const HIP = { hind: [-0.03, -0.03, 0.088], fore: [0.03, -0.05, 0.102] }
  const legs = {
    hindR: new Leg(rig, pelvis, 'hindR', [HIP.hind[0]!, HIP.hind[1]!, HIP.hind[2]!], hindLen, 1),
    hindL: new Leg(rig, pelvis, 'hindL', [HIP.hind[0]!, HIP.hind[1]!, -HIP.hind[2]!], hindLen, 1),
    foreR: new Leg(rig, chest, 'foreR', [HIP.fore[0]!, HIP.fore[1]!, HIP.fore[2]!], foreLen, -1),
    foreL: new Leg(rig, chest, 'foreL', [HIP.fore[0]!, HIP.fore[1]!, -HIP.fore[2]!], foreLen, -1),
  }

  // The tail: soft, a bone per segment so it can follow the spine with a delay.
  const tailSeg = Array.from({ length: tailN }, (_, i) => 0.088 * (0.8 + 0.2 * m) * (1 - 0.03 * i) * (1 + 0.1 * tb) * (plan.tail ?? 1))
  const tail: ReturnType<Rig['bone']>[] = []
  let tailParent = pelvis
  tailSeg.forEach((_, i) => {
    const b = rig.bone(`tail.${i}`, tailParent, [i === 0 ? -0.15 : -tailSeg[i - 1]!, i === 0 ? 0.0 : 0, 0])
    tail.push(b)
    tailParent = b
  })

  const pelvisY = hindH + 0.03
  body.position.set(0, pelvisY, 0)
  rig.settle()

  const soft = rig.mesher(false)
  const hard = rig.mesher(true)
  const ix = (b: Parameters<Rig['index']>[0]) => rig.index(b)
  const hideAt = (t: number, up: number): RGB => mix(mix(mix(PAL.hideDark, PAL.hide, clamp(0.35 + 0.5 * t)), PAL.belly, clamp(0.5 - up * 0.9) * 0.8), PAL.pale, pale)
  const spineColour = (x0: number, x1: number) => (t: number, up: number) => hideAt(clamp((lerp(x0, x1, t) + 0.16) / 1.0), up)

  // Spine: one body profile cut into the bones that carry it.
  const spineOrigin: Record<string, number> = { pelvis: 0, waist: BONES_AT.waist, chest: BONES_AT.chest, neck1: BONES_AT.neck1, neck2: BONES_AT.neck2 }
  const spine: [string, string | null, string | null, number, number][] = [
    ['pelvis', null, 'waist', -0.16, BONES_AT.waist],
    ['waist', 'pelvis', 'chest', BONES_AT.waist, BONES_AT.chest],
    ['chest', 'waist', 'neck1', BONES_AT.chest, BONES_AT.neck1],
    ['neck1', 'chest', 'neck2', BONES_AT.neck1, BONES_AT.neck2],
    ['neck2', 'neck1', 'head', BONES_AT.neck2, BONES_AT.head],
  ]
  const originY = (name: string) => station(spineOrigin[name]!, 1).cy
  for (const [name, prev, next, x0, x1] of spine) {
    const sections = Array.from({ length: 7 }, (_, k) => {
      const X = lerp(x0, x1, k / 6)
      const s = station(X, girth, m)
      return { x: X - spineOrigin[name]!, y: s.cy - originY(name), ry: s.ry, rz: s.rz, n: name === 'chest' ? 2.3 : 2.1 }
    })
    soft.part(ix(name), prev ? ix(prev) : -1, next ? ix(next) : -1).loft(sections, spineColour(x0, x1), 12, { open: name !== 'pelvis' && name !== 'neck2' })
  }

  // The head: a wild cat's. A domed skull and wide cheekbones, a nose bridge that slopes to a short, strong muzzle with whisker pads,
  // a brow that is part of the forehead over almond eyes, a dark tear line down the cheek, small rounded ears with a tuft, and a ruff at the jaw.
  {
    const nose = 0.17 * snout
    const raw = [
      { x: -0.05, y: 0.004, ry: 0.062, rz: 0.068 },
      { x: 0.0, y: 0.007, ry: 0.083, rz: 0.09 },
      { x: 0.05, y: 0.0, ry: 0.079, rz: 0.093 },
      { x: 0.1, y: -0.009, ry: 0.058, rz: 0.07 },
      { x: nose - 0.022, y: -0.017, ry: 0.04, rz: 0.05 },
      { x: nose, y: -0.021, ry: 0.027, rz: 0.033 },
    ]
    const sk = raw.map((s2) => ({ ...s2, y: s2.y * headK, ry: s2.ry * headK, rz: s2.rz * headK, n: 2.4 }))
    // Lateral reach of the skull at a point, so the eye and the brow can sit in the cheek instead of floating in front of it.
    const cheekZ = (x: number, y: number) => {
      let i = 0
      while (i < raw.length - 2 && x > raw[i + 1]!.x) i += 1
      const a = raw[i]!
      const b = raw[i + 1]!
      const u = clamp((x - a.x) / (b.x - a.x || 1))
      const ry = lerp(a.ry, b.ry, u) * headK
      const rz = lerp(a.rz, b.rz, u) * headK
      const cy = lerp(a.y, b.y, u) * headK
      const h = clamp(Math.abs(y - cy) / Math.max(ry, 1e-4), 0, 0.98)
      const e = 2 / 2.4
      const s = h ** (1 / e)
      const c = Math.sqrt(Math.max(0, 1 - s * s))
      return c ** e * rz
    }
    soft.part(ix(head), ix(neck2), -1).loft(sk, (t, up) => mix(hideAt(0.62, up), PAL.hideDark, t > 0.9 ? 0.45 : 0), 16)
    soft.loft([
      { x: 0.02, y: -0.056 * headK, ry: 0.018 * headK, rz: 0.042 * headK, n: 2.4 },
      { x: 0.09, y: -0.054 * headK, ry: 0.017 * headK, rz: 0.036 * headK, n: 2.4 },
      { x: nose - 0.026, y: -0.041 * headK, ry: 0.011 * headK, rz: 0.022 * headK, n: 2.4 },
    ], () => mix(PAL.hideDark, PAL.belly, 0.35), 10)
    for (const side of [-1, 1]) {
      // Whisker pads: the muzzle's full, soft sides.
      soft.loft([
        { x: nose - 0.055, y: -0.027 * headK, z: side * 0.027 * headK, ry: 0.006, rz: 0.008 },
        { x: nose - 0.032, y: -0.027 * headK, z: side * 0.028 * headK, ry: 0.019 * headK, rz: 0.021 * headK, n: 2 },
        { x: nose - 0.008, y: -0.026 * headK, z: side * 0.022 * headK, ry: 0.007, rz: 0.009 },
      ], () => mix(PAL.hide, PAL.pale, 0.25), 8)
      // A dark almond in the cheek. Most of the lens sits just outside the skull, so the outline is the eye's own edge.
      const eyeX = 0.056
      const eyeY = 0.009 * headK
      const ew = 0.04 * eyeK
      const eh = 0.0165 * eyeK * headK
      const ed = 0.0046 * eyeK
      // The lens sits on the cheek, following it, so the skull does not slice the eye into a hole.
      const eyeAt = (x: number, y: number, ry: number, rz: number) => ({ x, y, z: side * (cheekZ(x, y) + rz * 0.85), ry, rz, n: 2 })
      soft.loft([
        eyeAt(eyeX - ew * 0.92, eyeY, eh * 0.45, ed * 0.42),
        eyeAt(eyeX - ew * 0.2, eyeY + eh * 0.03, eh * 0.92, ed),
        eyeAt(eyeX + ew * 0.22, eyeY + eh * 0.01, eh, ed * 0.92),
        eyeAt(eyeX + ew * 0.72, eyeY - eh * 0.05, eh * 0.42, ed * 0.36),
      ], () => hex('#1c1916'), 14)
      // The brow is the skull's own shelf: it rises out of the forehead, crests over the eye, and thins away into the bridge.
      // There is no separate lid. The old lid cord and the old ridge tube both ended as lumps stuck to the face.
      const browAt = (x: number, y0: number, rise: number, proud: number) => {
        const y = y0 * headK
        const embed = 0.007 * headK
        const rz = embed + proud * headK
        return { x, y, z: side * (cheekZ(x, y) - embed), ry: rise * headK, rz, n: 2 }
      }
      soft.loft([
        browAt(0.018, 0.02, 0.001, 0),
        browAt(0.04, 0.028, 0.0028, 0.0012),
        browAt(0.058, 0.024, 0.0032, 0.0014),
        browAt(0.076, 0.012, 0.0012, 0),
        browAt(0.094, 0.0, 0.0005, 0),
      ], () => mix(PAL.hide, PAL.hideDark, 0.2), 8)
      // The tear line, a thin marking from the front corner of the eye down beside the muzzle.
      const tearX = eyeX + ew * 0.55
      const tearY = eyeY - eh * 0.25
      soft.tube([[tearX, tearY, side * (cheekZ(tearX, tearY) - 0.001)], [0.112, -0.001 * headK, side * 0.052 * headK], [nose - 0.034, -0.02 * headK, side * 0.04 * headK]], (t) => 0.00105 * (1 - 0.5 * t) + 0.0003, () => PAL.hideDark, 4, { open: true })
      // A ruff along the jaw, swept back.
      for (let k = 0; k < 3; k += 1) {
        soft.tube([[0.0 - 0.012 * k, -0.02 * headK - 0.012 * k, side * (0.093 - 0.006 * k) * headK], [-0.03 - 0.012 * k, -0.034 * headK - 0.014 * k, side * (0.088 - 0.008 * k) * headK], [-0.058 - 0.014 * k, -0.04 * headK - 0.018 * k, side * (0.078 - 0.01 * k) * headK]], (t) => 0.0042 * (1 - t) + 0.0006, () => mix(PAL.hide, PAL.pale, 0.4), 4, { open: true })
      }
      // Whiskers leave the pad outward and a little forward, the way the first fan did, with a few more and a light curve.
      const whiskers = 6
      for (let k = 0; k < whiskers; k += 1) {
        const u0 = k / (whiskers - 1)
        const flick = Math.sin(p.seed * 0.17 + k * 1.7 + side)
        const u = clamp(u0 + flick * 0.015)
        const a2 = (u - 0.5) * 0.48
        const reach = (0.9 + 0.18 * Math.sin(Math.PI * u0)) * (1 + 0.06 * flick)
        const root: V = [nose - 0.046 + (k % 2) * 0.005, (-0.011 + (0.5 - u) * 0.006) * headK, side * (0.03 + (k % 2) * 0.003) * headK]
        const path: V[] = [0, 0.35, 0.7, 1].map((f) => {
          const bow = Math.sin(Math.PI * f) * 0.007 * reach
          return [
            root[0] + (f * 0.032 + bow * 0.25) * reach,
            root[1] - f * 0.04 * Math.sin(a2) * reach - bow * 0.35,
            root[2] + side * (f * 0.135 * reach + bow),
          ] as V
        })
        soft.tube(path, (t) => 0.00062 * (1 - t) ** 0.7 + 0.00014, () => mix(PAL.pale, PAL.hide, 0.2), 4, { open: true })
      }
      soft.tube([[nose - 0.012, -0.018 * headK, side * 0.003], [nose - 0.028, -0.034 * headK, side * 0.014], [nose - 0.06, -0.037 * headK, side * 0.03]], () => 0.0012, () => PAL.dark, 3, { open: true })
    }
    // The nose: a small dark pad at the end of the bridge.
    soft.loft([
      { x: nose - 0.012, y: -0.019 * headK, ry: 0.005, rz: 0.005 },
      { x: nose + 0.002, y: -0.019 * headK, ry: 0.011, rz: 0.015, n: 2 },
      { x: nose + 0.009, y: -0.02 * headK, ry: 0.005, rz: 0.006 },
    ], () => PAL.nose, 8)
  }
  // Ears: small, rounded triangles set high and apart, paler inside, each with a short dark tuft.
  for (const [bone, side] of [[earR, 1], [earL, -1]] as const) {
    const len = 0.058 * earK
    soft.part(ix(bone)).slab([0, len, 0], [0.04 * earK, 0, 0], [-0.006, len, 0], [0, 0, 0.0065], () => mix(PAL.hide, PAL.hideDark, 0.3), 0.32, -0.15)
    soft.slab([0.004, len * 0.9, side * 0.007], [0.026 * earK, 0, 0], [-0.004, len * 0.78, 0], [0, 0, 0.002], () => PAL.belly, 0.3, -0.15)
    for (const dz of [-0.004, 0, 0.004]) soft.tube([[0, len * 2 - 0.005, dz], [-0.004, len * 2 + 0.014, dz * 1.4], [-0.009, len * 2 + 0.03, dz * 1.8]], (t) => 0.0022 * (1 - t) + 0.0004, () => PAL.dark, 3, { open: true })
  }

  // Legs.
  const limb = (leg: Leg, kind: 'fore' | 'hind') => {
    const L = leg.lengths
    const heavy = (kind === 'fore' ? 1.25 * (1 + 0.18 * tf) : 1) * (0.88 + 0.12 * m)
    const [s0, s1, s2, s3] = leg.segs.map((b) => ix(b)) as [number, number, number, number]
    const limbColour = (t: number): RGB => mix(mix(PAL.hideDark, PAL.hide, 0.5 + 0.3 * t), PAL.pale, pale * 0.7)
    const down = (len: number, n = 6): V[] => Array.from({ length: n }, (_, i) => [0, (-len * i) / (n - 1), 0])
    soft.part(s0, -1, s1).tube(down(L[0]!), (t) => (lerp(kind === 'fore' ? 0.062 : 0.062, 0.034, t) + 0.014 * Math.sin(Math.PI * Math.min(1, t * 1.1))) * heavy * girth, limbColour, 8)
    soft.part(s1, s0, s2).tube(down(L[1]!), (t) => (lerp(0.034, 0.024, t) + 0.007 * Math.sin(Math.PI * t)) * heavy, limbColour, 7)
    soft.part(s2, s1, s3).tube(down(L[2]!), (t) => lerp(0.022, 0.018, t) * heavy, limbColour, 6)
    soft.part(s3, s2, -1)
    const offs = kind === 'fore' ? [0.034, 0.012, -0.012, -0.034] : [0, 0.022, -0.022]
    const claw = (kind === 'fore' ? 0.075 : 0.032) * clawK
    offs.forEach((off, k) => {
      const d = L[3]! * (1 - 0.1 * Math.abs(k - (offs.length - 1) / 2))
      const splay = off * 0.8
      soft.tube([[0, 0, off * 0.3], [splay * 0.2, -d * 0.5, off * 0.8], [splay * 0.3, -d, off + splay]], (t) => lerp(0.02, 0.012, t) * heavy, () => PAL.hideDark, 6, { blend: 0.15 })
      hard.part(s3).tube([[splay * 0.3, -d, off + splay], [-0.006, -d - claw * 0.55, off + splay * 1.1], [-Math.min(0.024 * (claw / 0.07 + 0.5), PAD_CURL), -d - claw, off + splay * 1.2]], (t) => 0.008 * (1 - t) + 0.0012, () => mix(PAL.claw, PAL.hideDark, 0.15), 4)
    })
  }
  limb(legs.hindR, 'hind')
  limb(legs.hindL, 'hind')
  limb(legs.foreR, 'fore')
  limb(legs.foreL, 'fore')

  // The saddle: flat, overlapping scutes of thickened skin from the withers back. The oldest (pale, and wide) are at the withers.
  {
    const rp = rng(p.seed * 17 + 3)
    for (let k = 0; k < scutes; k += 1) {
      const f = scutes === 1 ? 0 : k / (scutes - 1)
      const X = lerp(warp(0.6), -0.02, f)
      const s = station(X, girth, m)
      const name = X < BONES_AT.waist ? 'pelvis' : X < BONES_AT.chest ? 'waist' : 'chest'
      const prev = name === 'pelvis' ? -1 : ix(name === 'waist' ? 'pelvis' : 'waist')
      const next = name === 'pelvis' ? ix('waist') : name === 'waist' ? ix('chest') : ix('neck1')
      const grown = clamp(dev * 1.5 - f * 0.55 + 0.12 * el) // newer scutes, farther back, are thinner; old animals have thicker ones
      if (grown <= 0.02) continue
      // In old age some scutes have chipped away, and the rest are worn lower.
      const chip = rp()
      if (el > 0.25 && chip < 0.22 * el) continue
      const tone = mix(PAL.plate, PAL.hide, 0.55 * (1 - grown) + 0.28 * f + 0.1 * rp())
      hard.part(ix(name), prev, next).slab(
        [X - spineOrigin[name]!, s.cy - originY(name) + s.ry * 0.93, 0],
        [0.04 + 0.01 * grown, 0, 0], [0, (0.006 + 0.011 * grown) * (1 - 0.3 * el * chip), 0], [0, 0, s.rz * (0.4 + 0.16 * grown)],
        (face) => (face === 1 ? mix(PAL.plateTop, tone, 0.7) : mix(tone, PAL.hideDark, face === 0 ? 0.4 : 0.2)),
        0.8, -0.3,
      )
    }
  }

  // Tail: a soft core; at its base, bands of the same mineral, as many as it has grown.
  const bands = Math.round(dev * 4)
  tail.forEach((b, i) => {
    const seg = tailSeg[i]!
    const r0 = (0.042 * Math.pow(1 - i / tailN, 0.8) + 0.008) * girth
    const r1 = (0.042 * Math.pow(1 - (i + 1) / tailN, 0.8) + 0.008) * girth
    const prev = i === 0 ? ix(pelvis) : ix(tail[i - 1]!)
    const next = i === tailN - 1 ? -1 : ix(tail[i + 1]!)
    soft.part(ix(b), prev, next).tube([[0, 0, 0], [-seg * 0.5, 0, 0], [-seg, 0, 0]], (t) => lerp(r0, r1, t), (t) => mix(mix(PAL.hideDark, PAL.hide, 0.45 + 0.25 * t), PAL.pale, pale * 0.7), 8)
    if (i < bands) {
      const rm = (r0 + r1) * 0.5 + 0.004
      hard.part(ix(b), -1, -1).loft([
        { x: -seg * 0.12, ry: rm * 0.8, rz: rm * 0.8 },
        { x: -seg * 0.25, ry: rm, rz: rm },
        { x: -seg * 0.75, ry: rm, rz: rm },
        { x: -seg * 0.88, ry: rm * 0.8, rz: rm * 0.8 },
      ], () => mix(PAL.plate, PAL.hide, 0.2 + 0.5 * (i / Math.max(1, bands))), 8, { blend: 0 })
    }
  })

  const matSoft = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: 2 })
  const matHard = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.02, side: 2 })
  const geoSoft = soft.build()
  const geoHard = hard.build()
  const { skeleton, meshes } = rig.skin(geoSoft, geoHard, { soft: matSoft, hard: matHard })
  rig.root.scale.setScalar(size)
  const triangles = (geoSoft.index ? geoSoft.index.count : geoSoft.attributes.position!.count) / 3 + geoHard.attributes.position!.count / 3

  // ---------------------------------------------------------------------------------------------- motion
  // A planted foot travels one stride backward in the time `stride / v`, which is exactly how far the body moves, so the
  // foot stays with the ground. The walk stride is as long as the standing leg can reach. A run drops the body slightly —
  // that shortens the vertical distance and frees a longer reach — and the duty factor falls, so one gathered flight
  // carries the body farther than the feet themselves travel. Shorter legs (young, or a deep hollow) take a shorter step
  // at the same rhythm, which keeps the paws on the ground instead of skating.
  const runDuty = 0.32
  const runStride = 0.4 * legK
  // Cadence in cycles per second at pace 1. Body speed is stride × cadence / duty, so a planted foot's
  // backward travel matches the body's forward travel.
  const runRate = 1.5
  // The walk's stride is set by the legs too (0.3 for a mature leg), at the same cadence: a lither individual covers more ground per step.
  const gait = (b: number) => ({ v: lerp(0.5 * legK, runStride * (runRate / runDuty), b), stride: lerp(0.3 * legK, runStride, b), duty: lerp(0.66, runDuty, b) })
  // Walk is an even four-beat. The run is a rotary gallop, the sequence a cat uses: trailing hind, leading hind,
  // then the fore on the leading side, then the other fore, and one short gathered flight between the hinds and the fores.
  // `run` is the phase offset; a foot touches down when the cycle phase equals one minus that offset.
  // Touchdowns: hindL 0.00, hindR 0.20, foreR 0.59, foreL 0.79. Within each pair the lead lands a fifth of a cycle later,
  // so the two paws are never in the same part of the step.
  const FEET: { leg: Leg; kind: 'fore' | 'hind'; phase: number; run: number; x0: number; side: number; lift: number; bias: number }[] = [
    { leg: legs.hindL, kind: 'hind', phase: 0, run: 0, x0: 0, side: -1, lift: 0.06, bias: -0.02 },
    { leg: legs.foreL, kind: 'fore', phase: 0.25, run: 0.21, x0: chestAt.x + 0.05, side: -1, lift: 0.075, bias: 0.016 },
    { leg: legs.hindR, kind: 'hind', phase: 0.5, run: 0.8, x0: 0, side: 1, lift: 0.06, bias: -0.008 },
    { leg: legs.foreR, kind: 'fore', phase: 0.75, run: 0.41, x0: chestAt.x + 0.05, side: 1, lift: 0.075, bias: 0.006 },
  ]
  const PAD = 0.02
  const legsTip = { fore: legs.foreL.lengths[3]! + 0.075 * clawK, hind: legs.hindL.lengths[3]! + 0.032 * clawK }
  // GROUND CLEARANCE. The underside of the trunk, neck and head as points in their own bones' frames (the bottom of each profile station), so
  // after a pose (above all the crouch, which drops the body and pitches the chest down) the body can be lifted just enough that nothing passes
  // through the ground. A heavier, longer-bodied or bigger-headed individual crouches a little higher: its own anatomy decides, not one number.
  const spineOf = (x: number): [Bone, number] => (x < BONES_AT.waist ? [pelvis, 0] : x < BONES_AT.chest ? [waist, BONES_AT.waist] : x < BONES_AT.neck1 ? [chest, BONES_AT.chest] : x < BONES_AT.neck2 ? [neck1, BONES_AT.neck1] : [neck2, BONES_AT.neck2])
  const UNDER = STATIONS.map(([x]) => {
    const [bone, x0] = spineOf(x)
    const s = station(x, girth, m)
    return { bone, p: new Vector3(x - x0, s.cy - station(x0, 1).cy - s.ry, 0) }
  })
  UNDER.push({ bone: head, p: new Vector3(0.05, -0.079 * headK, 0) }, { bone: head, p: new Vector3(0.17 * snout, -0.048 * headK, 0) })
  const CLEAR = 0.012
  const state = { t: 0, w: 0, c: 0, b: 0, phase: 0, tail: 0, prevFoot: new Map<Leg, number>(), stanced: new Map<Leg, number>(), footPhase: new Map<Leg, number>(), seed: r() * 10 }
  const v3 = new Vector3()
  const foot = new Vector3()

  const update = (dt: number, input: MotionInput): Frame => {
    dt = Math.min(dt, 0.05)
    rig.root.updateMatrixWorld(true)
    const { motion } = input
    state.t += dt
    state.w = approach(state.w, motion === 'walk' || motion === 'run' ? 1 : 0, 2.4, dt)
    state.b = approach(state.b, motion === 'run' ? 1 : 0, 3, dt)
    state.c = approach(state.c, motion === 'crouch' ? 1 : 0, 2.6, dt)
    const w = state.w
    const c = state.c
    const wb = smooth(clamp(w * 1.1))
    const bd = state.b
    const WALK = gait(bd)
    const vWalk = WALK.v * input.pace
    const period = WALK.stride / (WALK.duty * vWalk)
    state.phase = (state.phase + (dt / period) * w) % 1
    const ph = state.phase
    const tt = state.t
    const TAU = Math.PI * 2
    const speed = vWalk * w * size

    // A sniff now and then, when standing: the head drops and the ears reach forward.
    const sn = Math.max(0, Math.sin(tt * 0.31 + state.seed)) ** 6 * (1 - w) * (1 - c)

    const breath = Math.sin(tt * 1.9) * (1 - 0.5 * w)
    const bob = 0.012 * w * Math.cos(2 * TAU * ph)
    // One gentle wave per cycle: the back rounds and the body is a little higher in the gathered flight (phase ~0.55),
    // and it settles as the hind feet push. Not a bounce for each pair.
    const flight = Math.sin(TAU * (ph - 0.305))
    const gallop = bd * (0.09 * pelvisY + 0.007 * (1 - flight))
    const support = (at: number) => {
      const u = ((ph - at) % 1 + 1) % 1
      return u < runDuty ? Math.sin((Math.PI * u) / runDuty) : 0
    }
    const leanRight = bd * 0.012 * (support(0.2) + support(0.59) - support(0) - support(0.79))
    body.position.y = pelvisY * (1 - 0.56 * c) - gallop + bob * (1 - bd) + 0.003 * breath - 0.01 * sn
    body.rotation.set((0.045 * w * Math.sin(TAU * ph) + 0.012 * (1 - w) * Math.sin(tt * 0.4)) * (1 - 0.85 * bd) + leanRight, 0, bd * 0.016 * -flight)

    // The spine rolls with the stride, shoulder against hip; the chest drops in a crouch. In the gallop that roll gives
    // way to a small sagittal flex, extended on the hind push and gathered in the flight.
    const wave = TAU * ph + 0.4
    const flex = flight
    turn(pelvis, [Y_AXIS, 0.07 * w * (1 - 0.85 * bd) * Math.sin(wave)], [Z_AXIS, -0.12 * c + 0.012 * w * Math.sin(2 * wave) + 0.03 * sn + bd * 0.05 * flex])
    turn(waist, [Y_AXIS, -0.03 * w * (1 - 0.4 * bd) * Math.sin(wave)], [Z_AXIS, -0.03 * c + 0.01 * breath - 0.05 * el + bd * 0.02 * flex])
    turn(chest, [Y_AXIS, -0.09 * w * (1 - 0.85 * bd) * Math.sin(wave)], [Z_AXIS, -0.16 * c - bd * 0.045 * flex + 0.02 * w * Math.sin(2 * wave + 0.8) + 0.008 * breath - 0.1 * sn])
    const idleYaw = (0.36 * Math.sin(tt * 0.33 + state.seed) + 0.14 * Math.sin(tt * 0.87 + 1.3) + 0.2 * sn * Math.sin(tt * 9)) * (1 - 0.8 * c) * (1 - w)
    turn(neck1, [Y_AXIS, idleYaw * 0.45 + 0.05 * w * Math.sin(wave) * (1 - 0.6 * bd)], [Z_AXIS, 0.2 * c - 0.18 * sn + 0.06 * w * Math.sin(2 * wave + 1) * (1 - bd) + bd * 0.045 * flex])
    turn(neck2, [Y_AXIS, idleYaw * 0.55 + 0.05 * w * Math.sin(wave) * (1 - 0.6 * bd)], [Z_AXIS, 0.22 * c - 0.2 * sn + 0.05 * w * Math.sin(2 * wave + 1.3) * (1 - bd) + bd * 0.03 * flex])
    turn(head, [Y_AXIS, 0], [Z_AXIS, 0.18 * c - 0.05 * w * Math.sin(2 * wave + 1.6) * (1 - bd) + 0.03 * Math.sin(tt * 0.7) + 0.1 * sn - 0.06 * el + bd * 0.04 * flex])
    {
      // Lift the body by whatever the lowest point of the underside is below the clearance (in the body's own units: the root's scale cancels).
      rig.root.updateMatrixWorld(true)
      let low = Infinity
      for (const u of UNDER) low = Math.min(low, rig.root.worldToLocal(u.bone.localToWorld(v3.copy(u.p))).y)
      if (low < CLEAR) body.position.y += CLEAR - low
    }

    // Ears swivel on their own: one listens ahead while the other listens behind; flat in a crouch, forward on a sniff.
    const flick = (k: number) => Math.max(0, Math.sin(tt * 1.1 + k) * Math.sin(tt * 0.37 + k * 2)) ** 4
    turn(earR, [X_AXIS, 0.38 + 0.25 * flick(1) - 0.35 * c - 0.2 * bd], [Y_AXIS, 0.3 * Math.sin(tt * 0.31 + 1) * (1 - c) * (1 - bd) + 0.25 * sn], [Z_AXIS, -0.05 + 0.1 * flick(2) - 0.45 * c - 0.4 * bd])
    turn(earL, [X_AXIS, -0.38 - 0.25 * flick(3) + 0.35 * c + 0.2 * bd], [Y_AXIS, -0.3 * Math.sin(tt * 0.27 + 4) * (1 - c) * (1 - bd) - 0.25 * sn], [Z_AXIS, -0.05 + 0.1 * flick(4) - 0.45 * c - 0.4 * bd])

    // The tail follows the spine with a delay down its length, held low and curled at the tip.
    state.tail += dt * TAU * (0.3 * (1 - w) + w / period)
    tail.forEach((b, i) => {
      const f = i / (tailN - 1)
      const curl = i < tailN * 0.55 ? 0.04 : -0.2
      const curlCrouch = i < tailN * 0.6 ? 0.08 : -0.3
      const amp = (0.1 + 0.1 * w) * (0.4 + 0.9 * f)
      turn(b, [Y_AXIS, amp * Math.sin(state.tail - i * 0.5) + 0.03 * Math.sin(tt * 0.9 - i * 0.7)], [Z_AXIS, lerp(curl, curlCrouch, c) - 0.25 * bd + 0.04 * Math.sin(state.tail * 2 - i * 0.55) * (0.3 + w) - 0.05 * sn * f])
    })

    // Feet. Each follows the stride cycle: stance (carried back at the ground's speed, so it does not slide), then swing.
    let slip = 0
    let reach = 0
    for (const f of FEET) {
      const hind = f.kind === 'hind'
      const lean0 = (hind ? LEAN.hind : LEAN.fore) + 0.5 * c
      // The timing offset moves only while the paw is in the air, so a walk-to-run change retimes the next step instead of dragging a planted foot.
      const targetPhase = lerp(f.phase, f.run, bd)
      let offset = state.footPhase.get(f.leg) ?? f.phase
      let p0 = (ph + offset) % 1
      if (p0 >= WALK.duty) {
        const delta = ((targetPhase - offset + 1.5) % 1) - 0.5
        offset = (offset + delta * (1 - Math.exp(-8 * dt)) + 1) % 1
        state.footPhase.set(f.leg, offset)
        p0 = (ph + offset) % 1
      }
      // Hind feet set down a little behind the hip and push; fore feet reach ahead. A constant offset does not change
      // the speed of the planted foot, so it does not add slip.
      const place = bd * legK * f.bias
      let dx: number
      let dy: number
      let lean: number
      let toe: number
      let stance = false
      if (p0 < WALK.duty) {
        const u = p0 / WALK.duty
        dx = WALK.stride * (0.5 - u) + place
        dy = 0
        lean = lean0 + lerp(lerp(0.18, 0.05, bd), lerp(-0.26, hind ? -0.3 : -0.12, bd), u) * wb
        // Long fore claws point along the ground. A downward paw at this speed reads as digging.
        toe = -bd * (hind ? 0.04 : 0.18) * Math.sin(Math.PI * u)
        stance = true
      } else {
        const s = (p0 - WALK.duty) / (1 - WALK.duty)
        const shaped = lerp(smooth(s), smooth(Math.min(1, s * 1.22)), bd)
        dx = WALK.stride * (-0.5 + shaped) + place
        // The walk uses a rounded lift. The gallop holds the paw up through the short gathered flight, then sets it down.
        const bell = Math.sin(Math.PI * Math.pow(s, lerp(0.85, 0.72, bd)))
        const held = Math.sin((Math.PI / 2) * Math.min(1, s / 0.16)) * Math.sin((Math.PI / 2) * Math.min(1, (1 - s) / 0.14))
        dy = f.lift * lerp(1, hind ? 1.45 : 1.75, bd) * lerp(bell, held, bd)
        lean = lean0 + lerp(lerp(-0.26, -0.14, bd), lerp(0.18, 0.05, bd), shaped) + Math.sin(Math.PI * s) * lerp(0.32, 0.02, bd)
        // Swing dorsiflexes: the paw reaches forward and the claws lift clear, instead of stabbing down.
        toe = Math.sin(Math.PI * s) * lerp(0.75, hind ? -0.2 : -0.5, bd) * wb
        lean = lean0 + (lean - lean0) * wb
      }
      const x0 = f.x0 + (hind ? 0.1 : -0.03) * c
      const x = x0 + dx * wb
      // (A crouch splays the heavy forearm onto the paw: the paw is set a little higher so its pad rests on the ground rather than in it.)
      const y = PAD + (hind ? 0 : 0.014 * c) + dy * wb
      // The toes may point down in the swing only as far as the paw is lifted: the claw tips clear the ground (toes plus claws, at most).
      const tipLen = legsTip[f.kind]
      toe = Math.min(toe, Math.asin(clamp((y - PAD_CURL * 0.8) / tipLen, 0, 1)))
      const z = (hind ? HIP.hind[2]! : HIP.fore[2]!) * f.side + f.side * (hind ? 0.03 : 0.06) * c
      foot.set(x, y, z)
      rig.root.localToWorld(foot)
      f.leg.solve(foot, lean, toe)
      reach = Math.max(reach, f.leg.miss)
      const seg = f.leg.segs[3]!
      seg.getWorldPosition(v3)
      const prevX = state.prevFoot.get(f.leg)
      // Slip is how fast a planted foot moves over the ground: measured only once the gait is steady, and only after a foot has been
      // down for a few frames (the frames around a landing mix in the end of its swing, which is not sliding).
      const steady = (bd < 0.02 || bd > 0.98) && w > 0.98 && c < 0.02
      if (stance && (state.stanced.get(f.leg) ?? 0) >= 3 && steady && prevX !== undefined && dt > 0.002) slip = Math.max(slip, Math.abs((v3.x - prevX) / dt + speed))
      state.prevFoot.set(f.leg, v3.x)
      state.stanced.set(f.leg, stance ? (state.stanced.get(f.leg) ?? 0) + 1 : 0)
    }

    const label = bd > 0.5 ? 'run' : c > 0.5 && w > 0.5 ? 'stalk' : c > 0.5 ? 'crouch' : w > 0.5 ? 'walk' : sn > 0.3 ? 'sniff' : 'idle'
    return {
      speed,
      yawRate: 0,
      state: label,
      slip,
      notes: [
        ['gait', w > 0.5 ? `${(1 / period).toFixed(2)} cycles/s` : 'standing'],
        ['stride', `${(gait(state.b).stride * size).toFixed(2)} m`],
        ['reach short', `${(reach * size * 100).toFixed(1)} cm`],
      ],
    }
  }

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
    stats: { triangles, vertices: geoSoft.attributes.position!.count + geoHard.attributes.position!.count, bones: rig.bones.length, drawCalls: 2, buildMs: performance.now() - t0, features: `${stageName(age)} · ${scutes} dorsal scutes · ${bands} tail bands · ${tailN} tail segments` },
    traits: readTraits('dweller', T),
    anatomy: [
      ['torso', (BONES_AT.chest + 0.16) * size],
      ['thigh', hindLen[0]! * size],
      ['shin', hindLen[1]! * size],
      ['foot', (hindLen[2]! + hindLen[3]!) * size],
      ['head', (0.17 * snout + 0.06) * headK * size],
      ['tail', tailSeg.reduce((a, b) => a + b, 0) * size],
    ],
    gait: { leg: hindH * size, stride: gait(0).stride * size, cadence: (gait(0).duty * gait(0).v) / gait(0).stride },
    frame: { target: [0.35 * size, 0.3 * size, 0], distance: 2.4 * size + 0.7 },
    size: { length: (headAt.x + 0.17 * snout + 0.15 + tailSeg.reduce((a, b) => a + b, 0)) * size, height: (hindH + 0.2) * size, span: 0 },
  }
}
