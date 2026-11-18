import { Box3, PerspectiveCamera, Vector3 } from 'three'
import { landscapeHeight } from '../../project03/terrain.ts'
import { groundEye, studySun, type StudySite } from '../site.ts'

/**
 * Style C's cameras. Every framing is described against the subject (the Reference Overhang's bounds) and the sun, not in world coordinates, so a
 * framing keeps its meaning when the hour or the geometry changes:
 *
 *   az     where the camera stands around the subject, in degrees from the sun's side (0: the sun behind the camera, flat light; 90: side light;
 *          180: looking into the sun, contre-jour). Positive turns counter-clockwise seen from above.
 *   elev   the camera's angle above the subject's aim point (negative looks up at it)
 *   dist   distance in subject radii
 *   fov    vertical field of view of the 16:9 plate (a long lens is a small number)
 *   lift   the aim point's height on the subject, 0 at its foot to 1 at its top
 *   shift  where the subject sits in the frame: [-1, 1] from the centre to the edge, x to the right and y up (thirds are ±0.33)
 */
export type Framing = { id: string; label: string; note: string; az: number; elev: number; dist: number; fov: number; lift: number; shift: [number, number] }

export const HEROES: Framing[] = [
  { id: 'h1', label: 'H1 · Profile', note: 'Low and close, half into the sun: the shelves as horizontal layers in their own shadow, against the mountain and a bright band of horizon.', az: 130, elev: 1, dist: 3.2, fov: 30, lift: 0.55, shift: [-0.15, -0.15] },
  { id: 'h2', label: 'H2 · Side light', note: 'The sun from the side: lit tops, turned walls, the undercroft and the shadow pool beside it, the structure on the right third.', az: 85, elev: 5, dist: 4.6, fov: 22, lift: 0.45, shift: [0.2, 0.05] },
  { id: 'h4', label: 'H4 · Threshold', note: 'Low on the hero side, the sun over the left shoulder: the lit top and flank of the structure and, under it, the undercroft opening toward us.', az: 70, elev: 4, dist: 3.4, fov: 24, lift: 0.42, shift: [0, -0.05] },
  { id: 'q', label: 'Q · Three-quarter', note: 'A classic three-quarter from the hero side, a little above: top, flank and underside together, the sun over the shoulder.', az: 35, elev: 18, dist: 2.9, fov: 26, lift: 0.35, shift: [0, -0.04] },
  { id: 't', label: 'T · Top-down', note: 'From (almost) straight above: the plan, its footprint against its cast shadow, and the roof’s surface as a shape.', az: 60, elev: 88, dist: 5.2, fov: 30, lift: 0.2, shift: [0, 0] },
  { id: 'h3', label: 'H3 · Elevated', note: 'High and far on a very long lens: near-isometric, the structure as a figure on its ground, its shadow a shape of its own.', az: 100, elev: 28, dist: 11, fov: 12, lift: 0.3, shift: [0.12, -0.04] },
]

export const SHEET_ELEVATIONS = { low: 3, mid: 14, high: 32 } as const
export type SheetElevation = keyof typeof SHEET_ELEVATIONS
/** The contact sheet: the subject from twelve sides at one elevation, the same lens and distance. */
export function sheetFramings(elev: SheetElevation): Framing[] {
  return Array.from({ length: 12 }, (_, k) => ({ id: `ring${k}`, label: `${k * 30}°`, note: '', az: k * 30, elev: SHEET_ELEVATIONS[elev], dist: 4.2, fov: 24, lift: 0.4, shift: [0, 0] }))
}

export type Subject = { center: Vector3; base: number; height: number; radius: number }
const subjects = new WeakMap<StudySite, Subject>()
export function subjectOf(site: StudySite): Subject {
  let s = subjects.get(site)
  if (!s) {
    const ref = site.organisms.find((o) => o.index === 0) ?? site.organisms[0]!
    ref.geometry.computeBoundingBox()
    const box = new Box3().copy(ref.geometry.boundingBox!)
    const center = box.getCenter(new Vector3())
    const size = box.getSize(new Vector3())
    s = { center, base: box.min.y, height: size.y, radius: Math.max(size.x, size.z, size.y) * 0.5 }
    console.info('[habitat study] compose subject', { size: size.toArray().map(Math.round), radius: Math.round(s.radius), sun1630: studySun(16.5).direction.map((v) => +v.toFixed(2)) })
    subjects.set(site, s)
  }
  return s
}

const tmp = new Vector3()
/** Poses a camera for a framing at an hour (the plate's aspect is 16:9). Returns the orbit target to hand to the controls. */
export function pose(camera: PerspectiveCamera, site: StudySite, f: Framing, hour: number, aspect = 16 / 9, subject?: Subject): Vector3 {
  const s = subject ?? subjectOf(site)
  const [sx, , sz] = studySun(hour).direction
  const sunAng = Math.atan2(sz, sx)
  const a = sunAng + (f.az * Math.PI) / 180
  const e = (f.elev * Math.PI) / 180
  const d = f.dist * s.radius
  const target = new Vector3(s.center.x, s.base + s.height * f.lift, s.center.z)
  const eye = new Vector3(target.x + Math.cos(a) * Math.cos(e) * d, target.y + Math.sin(e) * d, target.z + Math.sin(a) * Math.cos(e) * d)
  eye.y = Math.max(eye.y, landscapeHeight(eye.x, eye.z) + 1.7)
  camera.fov = f.fov
  camera.aspect = aspect
  camera.position.copy(eye)
  camera.up.set(0, 1, 0)
  camera.lookAt(target)
  // Place the subject off-centre by turning the camera, not by moving it: the perspective stays the framing's.
  const tv = Math.tan((f.fov * Math.PI) / 360)
  camera.rotateY(Math.atan(f.shift[0] * tv * aspect))
  camera.rotateX(-Math.atan(f.shift[1] * tv))
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  return camera.getWorldDirection(tmp).multiplyScalar(eye.distanceTo(target)).add(eye).clone()
}

/** The enclosure plate: standing in the shade habitat at the roof's edge, looking back in under the great shelf (the study's Ground plate). */
export function poseUnder(camera: PerspectiveCamera, site: StudySite, aspect = 16 / 9): Vector3 | null {
  const eye = groundEye(site)
  if (!eye) return null
  camera.fov = 52
  camera.aspect = aspect
  camera.position.set(eye.x, landscapeHeight(eye.x, eye.z) + 1.6, eye.z)
  const target = new Vector3(eye.tx, landscapeHeight(eye.tx, eye.tz) + 7, eye.tz)
  camera.lookAt(target)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  return target
}
