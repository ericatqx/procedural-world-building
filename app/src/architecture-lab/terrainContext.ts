import { landscapeHeight } from '../project03/terrain.ts'
import { sunAt } from '../project/sun.ts'
import { SPECIMEN_SITE } from './families.ts'

/**
 * What the ground under a specimen gives it, measured against the ground under the Lab's reference site (so the reference form, Seed 7
 * under the Reference habitat at that site, is the protected baseline and every other site adapts relative to it). In the organism's own
 * frame: its u axis is the day's mean sun, its w axis across it (positive toward the water side, `cs`).
 *   slope       how much steeper the ground is than at the reference site (0 where it is not)
 *   rise        how much more the ground rises along the sun axis over a cantilever's reach (metres; negative: it falls away)
 *   downAng     the downhill direction as a cantilever angle (0 toward the sun, positive toward the water side)
 */
export type Terrain = { slope: number; rise: number; downAng: number }
const REACH = 40
const E = 14
export const meanSunDir = (): readonly [number, number] => meanSun
const meanSun = (() => {
  let lx = 0
  let lz = 0
  for (const h of [8, 10, 12, 14, 16]) {
    const d = sunAt(h, 55).direction
    lx += d[0]
    lz += d[2]
  }
  const l = Math.hypot(lx, lz) || 1
  return [lx / l, lz / l] as const
})()

function measure(site: [number, number], yaw = 0) {
  const gx = (landscapeHeight(site[0] + E, site[1]) - landscapeHeight(site[0] - E, site[1])) / (2 * E)
  const gz = (landscapeHeight(site[0], site[1] + E) - landscapeHeight(site[0], site[1] - E)) / (2 * E)
  // The organism's frame, as the generator makes it: the mean sun turned by the organism's yaw.
  const m = meanSun
  const a: [number, number] = yaw === 0 ? [m[0], m[1]] : [m[0] * Math.cos(yaw) - m[1] * Math.sin(yaw), m[0] * Math.sin(yaw) + m[1] * Math.cos(yaw)]
  const b: [number, number] = [-a[1], a[0]]
  const rise = landscapeHeight(site[0] + a[0] * REACH, site[1] + a[1] * REACH) - landscapeHeight(site[0], site[1])
  return { slope: Math.hypot(gx, gz), rise, downU: -(gx * a[0] + gz * a[1]), downW: -(gx * b[0] + gz * b[1]), a, b }
}

/**
 * `ref` is what counts as no adaptation: by default the Lab's reference site; a world places its own (a gentle slope and a level reach).
 * `yaw` is the organism's frame turned from the mean sun (the world turns its organisms toward their own opening).
 */
export function terrainContext(site: [number, number], cs: number, yaw = 0, ref: { slope: number; rise: number } | null = null): Terrain {
  const here = measure(site, yaw)
  const r = ref ?? (() => {
    const m = measure(SPECIMEN_SITE)
    return { slope: m.slope, rise: m.rise }
  })()
  return { slope: Math.max(0, here.slope - r.slope), rise: here.rise - r.rise, downAng: Math.atan2(cs * here.downW, here.downU) }
}
/** The side of the organism's frame that is toward the water (+1) or away (-1), given the bearing to it (x, z). */
export function waterSide(bearing: readonly [number, number] | null, yaw = 0): number {
  if (!bearing) return 1
  const m = meanSun
  const a: [number, number] = yaw === 0 ? [m[0], m[1]] : [m[0] * Math.cos(yaw) - m[1] * Math.sin(yaw), m[0] * Math.sin(yaw) + m[1] * Math.cos(yaw)]
  return bearing[0] * -a[1] + bearing[1] * a[0] < 0 ? -1 : 1
}
