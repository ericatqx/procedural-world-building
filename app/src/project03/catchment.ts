import type { Statics } from '../project02/statics.ts'

/**
 * Shadow Ecology 0.3 — one drainage, in meters (0.2 world units).
 * The north shore of the lower basin: open water lies inland-opposite,
 * the bank rises inland, and a person stands 1.6 m above the ground.
 */
export const CATCHMENT = { x: 2.48, z: 9.32 }
export const EYE_HEIGHT = 1.6

export type ShoreFrame = {
  x: number
  z: number
  y: number
  /** Points away from the water, up the bank. */
  inland: [number, number]
  /** Runs along the shore. */
  along: [number, number]
}

export function shoreFrame(statics: Statics, x = CATCHMENT.x, z = CATCHMENT.z): ShoreFrame {
  const distance = (px: number, pz: number) => {
    const cell = statics.cellAt(px, pz)
    return cell >= 0 && statics.inside[cell] ? statics.waterDistance[cell]! : 8
  }
  const step = 0.45
  let ix = distance(x + step, z) - distance(x - step, z)
  let iz = distance(x, z + step) - distance(x, z - step)
  const len = Math.hypot(ix, iz)
  if (len < 1e-4) {
    ix = 0
    iz = 1
  } else {
    ix /= len
    iz /= len
  }
  return { x, z, y: statics.groundAt(x, z), inland: [ix, iz], along: [-iz, ix] }
}

/** Walks inland until the point is dry land. */
export function dryLand(statics: Statics, x: number, z: number, inland: [number, number]): { x: number; z: number } {
  let px = x
  let pz = z
  for (let n = 0; n < 10; n += 1) {
    const cell = statics.cellAt(px, pz)
    if (cell >= 0 && statics.inside[cell] && !statics.water[cell]) return { x: px, z: pz }
    px += inland[0] * 0.35
    pz += inland[1] * 0.35
  }
  return { x: px, z: pz }
}

export function overviewPose(statics: Statics): { position: [number, number, number]; target: [number, number, number] } {
  const frame = shoreFrame(statics)
  // Steep view from above the open bank, so the fold, the water, and the
  // plants fill the frame.
  const spot = dryLand(
    statics,
    frame.x + frame.inland[0] * 2.4,
    frame.z + frame.inland[1] * 2.4,
    frame.inland,
  )
  const ground = statics.groundAt(spot.x, spot.z)
  return {
    position: [spot.x, Math.max(ground, frame.y) + 5.6, spot.z],
    target: [frame.x - frame.inland[0] * 0.7, frame.y + 0.35, frame.z - frame.inland[1] * 0.7],
  }
}

/** Stands on the bank, looking across the fold toward the water. */
export function explorePose(statics: Statics): { x: number; z: number; yaw: number; pitch: number } {
  const frame = shoreFrame(statics)
  const stand = dryLand(
    statics,
    frame.x + frame.along[0] * 2.2 + frame.inland[0] * 2.6,
    frame.z + frame.along[1] * 2.2 + frame.inland[1] * 2.6,
    frame.inland,
  )
  const lookX = frame.x - frame.inland[0] * 1.4
  const lookZ = frame.z - frame.inland[1] * 1.4
  return { x: stand.x, z: stand.z, yaw: Math.atan2(-(lookX - stand.x), -(lookZ - stand.z)), pitch: -0.06 }
}
