import { Vector3 } from 'three'

/**
 * Week 07 Trace Growth — the environment the organism reads: a cantilevered
 * slab on a narrow pier, a fixed afternoon sun, and the shelter field they
 * make. Shelter mixes blocked sun (shadow, with a soft penumbra) and blocked
 * sky (overhead cover), so it is deepest under the slab beside the pier.
 */

export type Box = { min: readonly [number, number, number]; max: readonly [number, number, number] }

export const SHELTER_BOXES: readonly Box[] = [
  /** Pier. */
  { min: [0.5, 0, -0.42], max: [0.68, 1.02, 0.42] },
  /** Slab, cantilevered west over the ground. */
  { min: [-1.05, 1.02, -0.82], max: [0.74, 1.1, 0.82] },
]

/** Toward the sun: east and a little north, so the shadow falls west and toward the viewer, under the slab. */
export const SUN_DIRECTION = new Vector3(0.7, 0.66, -0.18).normalize()

/** Where the organism starts: on open ground, in the sun, south-east of the pier. */
export const SEED_POSITION = new Vector3(1.0, 0, 1.25)

/** Shelter is this much blocked sun, the rest blocked sky. */
const SUN_SHARE = 0.65
/** Penumbra: rays this far off the sun direction, and the sky cone's tilt. */
const SUN_SPREAD = 0.09
const SKY_TILT = 0.45

/** Deep shelter, the target of the tropism: sampled on the ground. */
const DEEP_SHELTER = 0.8
const SAMPLE_EXTENT = 2.6
const SAMPLE_STEP = 0.1
const SAMPLE_HEIGHT = 0.03

function perpendicularBasis(d: Vector3): [Vector3, Vector3] {
  const ref = Math.abs(d.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)
  const a = new Vector3().crossVectors(d, ref).normalize()
  const b = new Vector3().crossVectors(d, a).normalize()
  return [a, b]
}

function rayCone(center: Vector3, spread: number): Vector3[] {
  const [a, b] = perpendicularBasis(center)
  const rays = [center.clone()]
  for (const [u, v] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    rays.push(center.clone().addScaledVector(a, u * spread).addScaledVector(b, v * spread).normalize())
  }
  return rays
}

const SUN_RAYS = rayCone(SUN_DIRECTION, SUN_SPREAD)
const SKY_RAYS = rayCone(new Vector3(0, 1, 0), SKY_TILT)

/** Slab test: does the ray from `o` along `d` hit the box? */
function hitsBox(o: Vector3, d: Vector3, box: Box): boolean {
  let near = 0
  let far = Infinity
  const origin = [o.x, o.y, o.z]
  const dir = [d.x, d.y, d.z]
  for (let axis = 0; axis < 3; axis++) {
    const od = dir[axis]!
    const oo = origin[axis]!
    if (Math.abs(od) < 1e-9) {
      if (oo < box.min[axis]! || oo > box.max[axis]!) {
        return false
      }
      continue
    }
    let t0 = (box.min[axis]! - oo) / od
    let t1 = (box.max[axis]! - oo) / od
    if (t0 > t1) {
      ;[t0, t1] = [t1, t0]
    }
    near = Math.max(near, t0)
    far = Math.min(far, t1)
    if (near > far) {
      return false
    }
  }
  return far > 0
}

const blockedShare = (p: Vector3, rays: readonly Vector3[]) =>
  rays.filter((ray) => SHELTER_BOXES.some((box) => hitsBox(p, ray, box))).length / rays.length

/** 0 open ground in full sun … 1 deep under the slab. */
export function shelterAt(p: Vector3): number {
  return SUN_SHARE * blockedShare(p, SUN_RAYS) + (1 - SUN_SHARE) * blockedShare(p, SKY_RAYS)
}

/** If `p` lies inside a box grown by `pad`, the outward normal of its nearest face. */
export function obstacleNormal(p: Vector3, pad: number): Vector3 | null {
  const coords = [p.x, p.y, p.z]
  for (const box of SHELTER_BOXES) {
    let inside = true
    let best = Infinity
    let normal: Vector3 | null = null
    for (let axis = 0; axis < 3 && inside; axis++) {
      const c = coords[axis]!
      const lo = box.min[axis]! - pad
      const hi = box.max[axis]! + pad
      if (c < lo || c > hi) {
        inside = false
        break
      }
      for (const [depth, sign] of [
        [c - lo, -1],
        [hi - c, 1],
      ] as const) {
        if (depth < best) {
          best = depth
          normal = new Vector3().setComponent(axis, sign)
        }
      }
    }
    if (inside && normal) {
      return normal
    }
  }
  return null
}

let deepSamples: Vector3[] | null = null

/** Ground points in deep shelter, computed once. */
function deepShelter(): Vector3[] {
  if (!deepSamples) {
    deepSamples = []
    for (let x = -SAMPLE_EXTENT; x <= SAMPLE_EXTENT; x += SAMPLE_STEP) {
      for (let z = -SAMPLE_EXTENT; z <= SAMPLE_EXTENT; z += SAMPLE_STEP) {
        const p = new Vector3(x, SAMPLE_HEIGHT, z)
        if (!obstacleNormal(p, 0.02) && shelterAt(p) >= DEEP_SHELTER) {
          deepSamples.push(p)
        }
      }
    }
  }
  return deepSamples
}

/** In full light, the pull toward the sun is this share of its strength in shade. */
const LIGHT_HOLD = 0.28

/**
 * Seek light's tropism vector: toward the sun, the classic phototropism. It
 * pulls hardest where the tip is shaded, and less once it stands in light.
 */
export function lightBias(shelter: number): Vector3 {
  return SUN_DIRECTION.clone().multiplyScalar(LIGHT_HOLD + (1 - LIGHT_HOLD) * shelter)
}

/**
 * Seek shelter's tropism vector at `p`: toward the nearest deep shelter, as strong as
 * the point is exposed. A tip already in shelter is barely pulled.
 */
export function shelterBias(p: Vector3, shelter: number): Vector3 {
  let nearest: Vector3 | null = null
  let best = Infinity
  for (const q of deepShelter()) {
    const d = q.distanceToSquared(p)
    if (d < best) {
      best = d
      nearest = q
    }
  }
  if (!nearest || best < 1e-6) {
    return new Vector3()
  }
  return nearest.clone().sub(p).normalize().multiplyScalar(1 - shelter)
}
