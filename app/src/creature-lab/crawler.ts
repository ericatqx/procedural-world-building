import { MeshStandardMaterial, Vector3 } from 'three'
import { clamp, hex, lerp, mix, rng, smooth, type RGB, type V } from './geo.ts'
import { elder, maturity, stageName } from './growth.ts'
import { approach, Leg, Rig, turn, X_AXIS, Y_AXIS, Z_AXIS } from './rig.ts'
import type { Creature, CreatureParams, Frame, MotionInput } from './types.ts'

/**
 * Litter Crawler. A small, round, gentle detritivore of the ground under shelves, where Architecture's receded tissue and fallen
 * litter gather. A pangolin's rolling body and an armadillo's banded back are only references. What is its own:
 *   - a plump, soft body low on four short, sturdy legs, with a short blunt face, big dark eyes and small round ears
 *   - a back of overlapping bands of mineral that end in a skirt above the soft belly, and a stout tail of the same
 *   - a snuffling feeding habit: nose down in the litter, chewing
 *   - a defensive roll: the front and rear of the body curl under until the head, legs and belly are inside a ball of plates
 * MINERAL. The bands are the mineral. The animal lays it down a growth band at a time at the rear edge of each plate, from the
 * litter it eats: young plates are soft and dark; with age it adds bands, and with supply the plates thicken and pale, each showing
 * its newest band as a pale rim. A poor animal wears its rims thin. The belly, face and legs stay soft.
 * HABITAT is the depth of the litter it lives in: deeper litter makes a flatter body, shorter legs, a longer snout for rooting and
 * smaller eyes.
 */

const PAL = {
  soft: hex('#8d8878'),
  softDark: hex('#66625a'),
  belly: hex('#b4aea0'),
  plate: hex('#cdc7b4'),
  rim: hex('#ece7d6'),
  claw: hex('#ddd8c6'),
  dark: hex('#13120f'),
  nose: hex('#3a362f'),
  eye: hex('#14130f'),
}

const SPINE = { mid: 0.06, chest: 0.12, neck: 0.17, head: 0.205 }
/** The body profile in the pelvis frame: x, half height, half width. */
const PROF: [number, number, number][] = [
  [-0.085, 0.012, 0.014],
  [-0.055, 0.05, 0.054],
  [-0.01, 0.068, 0.072],
  [0.05, 0.072, 0.074],
  [0.11, 0.068, 0.07],
  [0.16, 0.052, 0.054],
  [0.205, 0.04, 0.042],
]

export function buildCrawler(p: CreatureParams): Creature {
  const t0 = performance.now()
  const r = rng(p.seed * 53 + 5)
  const vary = (a: number, b: number) => a + (b - a) * r()
  const age = clamp(p.age)
  const litter = clamp(p.habitat)
  const m = maturity(age)
  const el = elder(age)
  // A hatchling is a round, soft little animal with a few bands of plate, longer legs for its size and a big head. As it grows it
  // adds bands to the shell one at a time, goes longer and flatter, its legs shorten under the shell, its snout lengthens for rooting,
  // and its plates harden. In old age the plates are worn and a few ridges have chipped away.
  const size = 0.6 + 0.4 * m
  const plan = p.plan ?? {}
  // Shell bands: the body plan adds or removes whole bands (each band is a joint of the shell, so a longer shell rolls into a rounder ball).
  const bandsF = Math.max(3, lerp(4, 8.4, m) + (r() < 0.3 ? 0.5 : 0) + Math.round(plan.bands ?? 0))
  const bands = Math.ceil(bandsF)
  /** How far the newest band has grown (0 to 1): bands are added continuously, not all at once. */
  const newest = bandsF - (bands - 1)
  const girth = (0.92 + 0.16 * clamp(p.condition)) * (1.08 - 0.1 * m) * (plan.girth ?? 1)
  const dev = clamp(p.mineral) * smooth(clamp((age - 0.15) / 0.6))
  const wearK = clamp(p.condition)
  const flat = (1 - 0.25 * litter) * (0.92 - 0.14 * m) * (plan.dome ?? 1)
  const legK = (1 - 0.2 * litter) * vary(0.95, 1.06) * (1.0 - 0.06 * m) * (plan.leg ?? 1)
  const snout = (1 + 0.4 * litter) * vary(0.92, 1.08) * (0.7 + 0.3 * m) * (plan.head ?? 1)
  const eyeK = (1 - 0.25 * litter) * (1 + 0.3 * (1 - m))
  const headK = 1 + 0.3 * (1 - m)

  const rig = new Rig()
  const body = rig.bone('body', null, [0, 0.12, 0])
  const pelvis = rig.bone('pelvis', body, [0, 0, 0])
  const mid = rig.bone('mid', pelvis, [SPINE.mid, 0, 0])
  const chest = rig.bone('chest', mid, [SPINE.chest - SPINE.mid, 0, 0])
  const neck = rig.bone('neck', chest, [SPINE.neck - SPINE.chest, 0, 0])
  const head = rig.bone('head', neck, [SPINE.head - SPINE.neck, 0, 0])
  const tail0 = rig.bone('tail0', pelvis, [-0.07, 0, 0])
  const tail1 = rig.bone('tail1', tail0, [-0.045, 0, 0])
  const tail2 = rig.bone('tail2', tail1, [-0.04, 0, 0])
  const earR = rig.bone('ear.R', head, [-0.004, 0.036 * headK, 0.03 * headK])
  const earL = rig.bone('ear.L', head, [-0.004, 0.036 * headK, -0.03 * headK])

  // Four short, sturdy legs: the forelimbs a little heavier, for digging.
  const foreLen = [0.04 * legK, 0.037 * legK, 0.016 * legK, 0.022 * legK]
  const hindLen = [0.042 * legK, 0.037 * legK, 0.016 * legK, 0.02 * legK]
  const LEAN = 0.2
  const hindH = 0.9 * (hindLen[0]! + hindLen[1]!) + hindLen[2]! * Math.cos(LEAN)
  const HIP_Y = -0.042 * flat
  const legs = {
    hindR: new Leg(rig, pelvis, 'hindR', [-0.012, HIP_Y, 0.052 * girth], hindLen, 1),
    hindL: new Leg(rig, pelvis, 'hindL', [-0.012, HIP_Y, -0.052 * girth], hindLen, 1),
    foreR: new Leg(rig, chest, 'foreR', [-0.01, HIP_Y, 0.05 * girth], foreLen, -1),
    foreL: new Leg(rig, chest, 'foreL', [-0.01, HIP_Y, -0.05 * girth], foreLen, -1),
  }
  const bodyY = hindH - HIP_Y + 0.004
  body.position.set(0, bodyY, 0)
  rig.settle()

  const soft = rig.mesher(false)
  const hard = rig.mesher(true)
  const ix = (b: Parameters<Rig['index']>[0]) => rig.index(b)
  const prof = (x: number) => {
    let i = 0
    while (i < PROF.length - 2 && x > PROF[i + 1]![0]) i += 1
    const a = PROF[i]!
    const b = PROF[i + 1]!
    const t = smooth(clamp((x - a[0]) / (b[0] - a[0])))
    return { ry: lerp(a[1], b[1], t) * girth * flat, rz: lerp(a[2], b[2], t) * girth }
  }
  const bodyAt = (x: number) => (_t: number, up: number): RGB => mix(mix(PAL.softDark, PAL.soft, 0.55 + 0.3 * clamp((x + 0.08) / 0.3)), PAL.belly, clamp(0.4 - up) * 0.85)

  // The soft body, in the four bones of the spine.
  const origin: Record<string, number> = { pelvis: 0, mid: SPINE.mid, chest: SPINE.chest, neck: SPINE.neck }
  const cuts: [string, string | null, string | null, number, number][] = [
    ['pelvis', null, 'mid', -0.085, SPINE.mid],
    ['mid', 'pelvis', 'chest', SPINE.mid, SPINE.chest],
    ['chest', 'mid', 'neck', SPINE.chest, SPINE.neck],
    ['neck', 'chest', 'head', SPINE.neck, SPINE.head],
  ]
  for (const [name, prev, next, x0, x1] of cuts) {
    const sections = Array.from({ length: 6 }, (_, k) => {
      const X = lerp(x0, x1, k / 5)
      const s = prof(X)
      return { x: X - origin[name]!, ry: s.ry, rz: s.rz, n: 2.1 }
    })
    soft.part(ix(name), prev ? ix(prev) : -1, next ? ix(next) : -1).loft(sections, bodyAt((x0 + x1) / 2), 12, { open: name !== 'pelvis' })
  }

  // The head: a low, flattened wedge made for rooting: wide behind, narrowing to a blunt, shovel-like snout, with tiny dark eyes high on
  // the sides, no ears, two short palps underneath, and a shield of mineral over the top.
  {
    const nose = 0.085 * snout
    const hy = (v: number) => v * headK * flat
    const headColour = (t: number, up: number): RGB => mix(bodyAt(0.2)(t, up), PAL.softDark, t > 0.85 ? 0.3 : 0)
    soft.part(ix(head), ix(neck), -1).loft([
      { x: -0.03, y: -0.002, ry: hy(0.036), rz: 0.044 * headK, n: 2.3 },
      { x: 0.008, y: -0.004, ry: hy(0.037), rz: 0.05 * headK, n: 2.3 },
      { x: 0.04, y: -0.008, ry: hy(0.028), rz: 0.044 * headK, n: 2.3 },
      { x: nose - 0.012, y: -0.012, ry: hy(0.018), rz: 0.034 * headK, n: 2.3 },
      { x: nose, y: -0.014, ry: hy(0.011), rz: 0.022 * headK, n: 2.3 },
    ], headColour, 12)
    soft.loft([
      { x: nose - 0.008, y: -0.013, ry: 0.004, rz: 0.006 },
      { x: nose + 0.004, y: -0.014, ry: 0.008, rz: 0.012, n: 2 },
      { x: nose + 0.01, y: -0.014, ry: 0.004, rz: 0.006 },
    ], () => PAL.nose, 8)
    for (const side of [1, -1]) {
      const e = 0.0055 * eyeK
      const ez = 0.041 * headK * side
      soft.loft([
        { x: 0.004, y: 0.011, z: ez, ry: 0.001, rz: 0.001 },
        { x: 0.015, y: 0.012, z: ez, ry: e, rz: e, n: 2 },
        { x: 0.026, y: 0.011, z: ez, ry: 0.001, rz: 0.001 },
      ], () => PAL.eye, 6)
      soft.tube([[nose - 0.02, -0.02, side * 0.01], [nose - 0.005, -0.03, side * 0.016], [nose + 0.004, -0.034, side * 0.014]], (t) => 0.0028 * (1 - t) + 0.0008, () => PAL.softDark, 4, { open: true })
    }
    const shield = clamp(dev * 1.25 + 0.15)
    const stone = mix(mix(PAL.softDark, PAL.soft, 0.45), PAL.plate, 0.1 + 0.62 * shield)
    hard.part(ix(head), ix(neck), -1).loft([
      { x: -0.034, y: 0.004, ry: hy(0.036) + 0.004, rz: 0.044 * headK + 0.004 },
      { x: 0.0, y: 0.006, ry: hy(0.04) + 0.005, rz: 0.05 * headK + 0.005 },
      { x: 0.04, y: 0.0, ry: hy(0.03) + 0.004, rz: 0.045 * headK + 0.004 },
      { x: nose - 0.02, y: -0.006, ry: hy(0.018) + 0.003, rz: 0.032 * headK + 0.003 },
    ], (t) => (t > 0.7 ? mix(stone, PAL.rim, 0.3 * shield) : stone), 10, { blend: 0, floor: -0.2 })
  }

  // The plates: bands of mineral over the back, each a short arched ring cut off above the belly, overlapping the next.
  {
    const x0 = -0.062
    const x1 = 0.162
    const spacing = (x1 - x0) / (bands - 1)
    for (let k = 0; k < bands; k += 1) {
      const grownBand = k === bands - 1 ? 0.35 + 0.65 * newest : 1
      const X = lerp(x1, x0, k / (bands - 1)) // from the shoulders back
      const name = X < SPINE.mid ? 'pelvis' : X < SPINE.chest ? 'mid' : X < SPINE.neck ? 'chest' : 'neck'
      const prev = name === 'pelvis' ? -1 : ix(name === 'mid' ? 'pelvis' : name === 'chest' ? 'mid' : 'chest')
      const next = name === 'pelvis' ? ix('mid') : name === 'mid' ? ix('chest') : name === 'chest' ? ix('neck') : ix('head')
      const ox = origin[name]!
      const s = prof(X)
      const f = k / (bands - 1) // 0 at the shoulders (oldest) to 1 at the rump (newest)
      const harden = clamp(dev * 1.25 - 0.3 * f + 0.1 * el) * (0.5 + 0.5 * grownBand)
      const thick = (0.0015 + 0.0045 * harden) * (0.85 + 0.3 * m)
      const tone = mix(mix(PAL.softDark, PAL.soft, 0.45), PAL.plate, 0.1 + 0.62 * harden)
      // Condition brightens or dulls the growth rim; old age wears it down, whatever the condition.
      const rim = mix(tone, PAL.rim, (0.45 + 0.55 * harden) * (0.3 + 0.7 * wearK) * (1 - 0.55 * el))
      const a = spacing
      const top = (v: number) => ({ ry: s.ry * v * (0.8 + 0.2 * grownBand) + thick, rz: s.rz * v * (0.8 + 0.2 * grownBand) + thick })
      hard.part(ix(name), prev, next).loft([
        { x: X - ox + 0.5 * a, y: 0.003, ...top(0.9) },
        { x: X - ox + 0.1 * a, y: 0.006, ...top(1.07) },
        { x: X - ox - 0.7 * a, y: 0.006, ...top(1.08) },
        { x: X - ox - 1.1 * a, y: 0.004, ...top(1.0) },
        { x: X - ox - 1.3 * a, y: 0.0, ...top(0.9) },
      ], (t) => (t > 0.62 ? rim : mix(tone, PAL.softDark, 0.35 * (1 - t))), 10, { blend: 0, floor: -0.5 })
      // An axial ridge on each band, like the keel of a trilobite: the segmentation that reads from above. Some have chipped in old age.
      const chipped = el > 0.3 && (k * 5 + 2) % 7 === 0
      if (harden > 0.12 && !chipped) {
        hard.slab([X - ox - 0.35 * a, s.ry * 1.07 * (0.8 + 0.2 * grownBand) + thick, 0], [0.42 * a, 0, 0], [0, 0.004 + 0.009 * harden, 0], [0, 0, 0.0065], () => mix(tone, PAL.rim, 0.35), 0.35, -0.7)
      }
    }
  }
  // The tail: stout and tapered, with two rings of the same plate.
  const tails = [tail0, tail1, tail2]
  const tailLen = [0.045, 0.04, 0.036]
  tails.forEach((b, i) => {
    const seg = tailLen[i]!
    const r0 = lerp(0.032, 0.013, i / 3) * girth
    const r1 = lerp(0.032, 0.013, (i + 1) / 3) * girth
    soft.part(ix(b), i === 0 ? ix(pelvis) : ix(tails[i - 1]!), i === 2 ? -1 : ix(tails[i + 1]!)).tube([[0, 0, 0], [-seg * 0.5, 0, 0], [-seg, 0, 0]], (t) => lerp(r0, r1, t), (t) => mix(PAL.softDark, PAL.soft, 0.5 + 0.2 * t), 8)
    if (i < 2) {
      const h = clamp(dev * 1.25 - 0.4)
      const rm = (r0 + r1) / 2 + 0.003 + 0.003 * h
      hard.part(ix(b), -1, -1).loft([
        { x: -seg * 0.1, ry: rm * 0.8, rz: rm * 0.8 },
        { x: -seg * 0.25, ry: rm, rz: rm },
        { x: -seg * 0.85, ry: rm * 0.97, rz: rm * 0.97 },
        { x: -seg * 1.0, ry: rm * 0.82, rz: rm * 0.82 },
      ], (t) => (t > 0.55 ? mix(PAL.plate, PAL.rim, 0.5 * h) : mix(PAL.soft, PAL.plate, 0.3 + 0.6 * h)), 8, { blend: 0 })
    }
  })

  // Legs: thick, short, with a round paw and short claws (longer on the forepaws, for digging).
  const limb = (leg: Leg, kind: 'fore' | 'hind') => {
    const L = leg.lengths
    const [s0, s1, s2, s3] = leg.segs.map((b) => ix(b)) as [number, number, number, number]
    const torso = kind === 'fore' ? chest : pelvis
    const heavy = kind === 'fore' ? 1.15 : 1
    const down = (len: number, n = 5): V[] => Array.from({ length: n }, (_, i) => [0, (-len * i) / (n - 1), 0])
    const col = (t: number): RGB => mix(PAL.softDark, PAL.soft, 0.5 + 0.3 * t)
    soft.part(s0, ix(torso), s1).tube(down(L[0]!), (t) => (lerp(0.024, 0.0145, t) + 0.004 * Math.sin(Math.PI * t)) * heavy, col, 8)
    soft.part(s1, s0, s2).tube(down(L[1]!), (t) => lerp(0.0145, 0.0105, t) * heavy, col, 7)
    soft.part(s2, s1, s3).tube(down(L[2]!), (t) => lerp(0.0105, 0.0095, t) * heavy, col, 6)
    soft.part(s3, s2, -1)
    const claw = (kind === 'fore' ? 0.012 : 0.007) * (0.85 + 0.3 * age)
    for (const off of [0, 0.011, -0.011]) {
      const d = L[3]! * (off === 0 ? 1.1 : 0.9)
      soft.tube([[0, 0, off * 0.3], [off * 0.1, -d * 0.5, off * 0.8], [off * 0.2, -d, off * 1.4]], (t) => lerp(0.0105, 0.0075, t) * heavy, () => PAL.softDark, 6, { blend: 0.15 })
      hard.part(s3).tube([[off * 0.2, -d, off * 1.4], [-0.002, -d - claw * 0.5, off * 1.5], [-0.006, -d - claw, off * 1.6]], (t) => 0.0024 * (1 - t) + 0.0004, () => PAL.claw, 4)
    }
  }
  limb(legs.hindR, 'hind')
  limb(legs.hindL, 'hind')
  limb(legs.foreR, 'fore')
  limb(legs.foreL, 'fore')

  const matSoft = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: 2 })
  const matHard = new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.03, side: 2 })
  const geoSoft = soft.build()
  const geoHard = hard.build()
  const { skeleton, meshes } = rig.skin(geoSoft, geoHard, { soft: matSoft, hard: matHard })
  rig.root.scale.setScalar(size)
  const triangles = (geoSoft.index ? geoSoft.index.count : geoSoft.attributes.position!.count) / 3 + geoHard.attributes.position!.count / 3

  // ---------------------------------------------------------------------------------------------- motion
  // The stride follows the legs (a longer leg reaches farther at the same rhythm), so the feet stay planted whatever the body plan.
  const WALK = { v: 0.12 * (plan.leg ?? 1), stride: 0.044 * (plan.leg ?? 1), duty: 0.76 }
  const FEET: { leg: Leg; kind: 'fore' | 'hind'; phase: number; x0: number; side: number }[] = [
    { leg: legs.hindL, kind: 'hind', phase: 0, x0: -0.012, side: -1 },
    { leg: legs.foreL, kind: 'fore', phase: 0.25, x0: SPINE.chest + 0.016, side: -1 },
    { leg: legs.hindR, kind: 'hind', phase: 0.5, x0: -0.012, side: 1 },
    { leg: legs.foreR, kind: 'fore', phase: 0.75, x0: SPINE.chest + 0.016, side: 1 },
  ]
  const PAD = 0.012
  const state = { t: 0, w: 0, c: 0, phase: 0, prevFoot: new Map<Leg, number>(), stanced: new Map<Leg, number>(), seed: r() * 10 }
  const v3 = new Vector3()
  const foot = new Vector3()
  const tuck = new Vector3()

  const update = (dt: number, input: MotionInput): Frame => {
    dt = Math.min(dt, 0.05)
    rig.root.updateMatrixWorld(true)
    state.t += dt
    const tt = state.t
    state.w = approach(state.w, input.motion === 'scuttle' ? 1 : 0, 3, dt)
    state.c = approach(state.c, input.motion === 'curl' ? 1 : 0, 2.6, dt)
    const w = state.w
    const c = state.c
    const free = 1 - c
    const wb = smooth(clamp(w * 1.1))
    const vWalk = WALK.v * input.pace
    const period = WALK.stride / (WALK.duty * vWalk)
    state.phase = (state.phase + (dt / period) * w) % 1
    const ph = state.phase
    const TAU = Math.PI * 2
    const speed = vWalk * w * size * free

    // Idle: it roots in the litter, nose down and chewing, every so often, and looks up between.
    const rootBase = Math.max(0, Math.sin(tt * 0.45 + state.seed)) ** 2
    const root = (input.feed !== undefined ? Math.max(input.feed, 0.15 * rootBase) : rootBase) * (1 - w) * free
    const chew = Math.sin(tt * 11) * root

    // The shell stays low. A crawl is a small rise and a slight lean onto the feet that are down, not a twist of the bands.
    body.position.set(0, lerp(bodyY, 0.141, c) + 0.0045 * w * Math.cos(2 * TAU * ph) + 0.001 * Math.sin(tt * 1.7) - 0.006 * root * free, 0.0028 * w * Math.sin(TAU * ph + 0.35) * free)
    body.rotation.set(0.016 * w * Math.sin(TAU * ph) * free, 0, 0.012 * w * Math.sin(2 * TAU * ph) * free)
    const wave = TAU * ph + 0.3
    // In a roll the front curls under and the tail curls under the other way. Walking barely yaws the trunk.
    turn(pelvis, [Y_AXIS, 0.028 * w * Math.sin(wave) * free], [Z_AXIS, 0.01 * Math.sin(tt * 1.7) * free + 0.03 * root])
    turn(mid, [Y_AXIS, -0.012 * w * Math.sin(wave) * free], [Z_AXIS, -0.75 * c - 0.04 * root])
    turn(chest, [Y_AXIS, -0.018 * w * Math.sin(wave) * free], [Z_AXIS, -0.9 * c - 0.06 * root])
    turn(neck, [Y_AXIS, 0.35 * (1 - w) * free * (1 - root) * Math.sin(tt * 0.5 + state.seed)], [Z_AXIS, -1.3 * c - 0.3 * root + 0.025 * w * Math.sin(2 * wave)])
    turn(head, [Y_AXIS, 0.02 * w * Math.sin(wave)], [Z_AXIS, -1.5 * c - 0.2 * root + 0.1 * chew + 0.05 * Math.sin(tt * 0.9) * free])
    turn(earR, [X_AXIS, 0.3 - 0.4 * c + 0.1 * Math.sin(tt * 0.8)])
    turn(earL, [X_AXIS, -0.3 + 0.4 * c - 0.1 * Math.sin(tt * 0.8 + 1)])
    turn(tail0, [Y_AXIS, 0.2 * Math.sin(tt * 0.9 + state.seed) * free + 0.045 * w * Math.sin(wave - 0.5)], [Z_AXIS, 0.08 + 0.95 * c])
    turn(tail1, [Y_AXIS, 0.16 * Math.sin(tt * 0.9 + state.seed - 0.6) * free], [Z_AXIS, 0.05 + 1.0 * c])
    turn(tail2, [Y_AXIS, 0.18 * Math.sin(tt * 0.9 + state.seed - 1.2) * free], [Z_AXIS, 0.05 + 0.9 * c])

    // Feet: a short four-beat step; in a roll they are drawn up inside the body.
    rig.root.updateMatrixWorld(true)
    let slip = 0
    let reach = 0
    for (const ft of FEET) {
      const hind = ft.kind === 'hind'
      const lean0 = hind ? 0.22 : 0.15
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
        lean = lean0 + lerp(0.15, -0.2, k)
        toe = 0
        stance = true
      } else {
        const k = (p0 - WALK.duty) / (1 - WALK.duty)
        dx = WALK.stride * (-0.5 + smooth(k))
        dy = 0.013 * Math.sin(Math.PI * Math.pow(k, 0.85))
        lean = lean0 + lerp(-0.2, 0.15, smooth(k)) + 0.12 * Math.sin(Math.PI * k)
        toe = 0.45 * Math.sin(Math.PI * k)
      }
      const swingOut = p0 < WALK.duty ? 0 : Math.sin(Math.PI * ((p0 - WALK.duty) / (1 - WALK.duty)))
      foot.set(ft.x0 + dx * wb, PAD + dy * wb, ft.side * (hind ? 0.056 : 0.054) * girth + ft.side * 0.0032 * swingOut * wb)
      rig.root.localToWorld(foot)
      const torso = hind ? pelvis : chest
      tuck.set(0.0, 0.0, ft.side * 0.025)
      torso.localToWorld(tuck)
      foot.lerp(tuck, c)
      ft.leg.solve(foot, lean, toe)
      reach = Math.max(reach, ft.leg.miss)
      // In a roll the legs are drawn up into the body.
      ft.leg.abd.scale.setScalar(lerp(1, 0.1, smooth(clamp(c * 1.3))))
      const seg = ft.leg.segs[3]!
      seg.getWorldPosition(v3)
      const prevX = state.prevFoot.get(ft.leg)
      if (stance && (state.stanced.get(ft.leg) ?? 0) >= 3 && w > 0.98 && c < 0.02 && prevX !== undefined && dt > 0.002) slip = Math.max(slip, Math.abs((v3.x - prevX) / dt + speed))
      state.prevFoot.set(ft.leg, v3.x)
      state.stanced.set(ft.leg, stance ? (state.stanced.get(ft.leg) ?? 0) + 1 : 0)
    }

    const label = c > 0.5 ? 'rolled' : w > 0.5 ? 'shuffle' : root > 0.4 ? 'rooting' : 'idle'
    return { speed, yawRate: 0, state: label, slip, notes: [['reach short', `${(reach * size * 100).toFixed(1)} cm`], ['bands', `${bands}`], ['gait', w > 0.5 ? `${(1 / period).toFixed(1)} Hz` : 'still']] }
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
    stats: { triangles, vertices: geoSoft.attributes.position!.count + geoHard.attributes.position!.count, bones: rig.bones.length, drawCalls: 2, buildMs: performance.now() - t0, features: `${stageName(age)} · ${bands} shell bands · 4 legs` },
    frame: { target: [0.08 * size, 0.06 * size, 0], distance: 0.7 * size + 0.18 },
    size: { length: (SPINE.head + 0.07 * snout + 0.085 + 0.12) * size, height: 0.15 * size, span: 0 },
    gait: { leg: hindH * size, stride: WALK.stride * size, cadence: WALK.v / WALK.stride },
    anatomy: [['shell bands', bands], ['shell height', 0.15 * size / Math.max(0.5, flat / 0.86)], ['leg', hindH * size], ['snout', 0.07 * snout * size], ['stride', WALK.stride * size]],
  }
}

