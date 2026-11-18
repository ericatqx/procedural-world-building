import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Raycaster, Vector2, Vector3 } from 'three'
import { islandRadius, landscapeHeight } from './terrain.ts'
import { pickUniforms } from './visualStyle.ts'
import { WADE_DEPTH, type WaterSystem } from './water.ts'

/**
 * ONE MARKER for Explore and Approach, drawn by the terrain's and the water's own shaders (visualStyle.ts › pickMarker), so it lies on the ground
 * wherever the ground goes and on the water surface where the pointer meets water. The same line, dot, fill and colours in both modes; the rings
 * differ in size only (Round 06): Explore's small (a place to stand), Approach's larger (an area to look at), with the same stroke on screen.
 */
export const APPROACH_SCALE = 1.5
const EXPLORE_SCALE = 0.6
const LINE_SCALE = 0.16
/** The ring's radius at a given distance from the camera, metres: a near-constant size on screen, within limits. */
const markerSize = (distance: number) => Math.min(80, Math.max(1.1, distance * 0.022))

/**
 * Choosing where to stand. While `active`, the pointer is followed over the terrain: a ray from the camera is
 * marched down to the ground (ground height is a function, so there is no mesh to raycast), and a marker rings the
 * spot. A click that is not a drag places the walker there, facing the way the camera was looking. The marker is part
 * of this component only: it exists while placing and is gone after. Orbit controls stay live, so the view can be
 * changed first; a drag orbits, a click places.
 */
export type Placement = { x: number; z: number; yaw: number }

const EDGE_MARGIN = 10

/** Where the ray meets the ground, or null (sky, or beyond the island). */
export function groundHit(origin: Vector3, direction: Vector3): Vector3 | null {
  const reach = 40000
  let t = 1
  let previous = 1
  let wasAbove = origin.y > landscapeHeight(origin.x, origin.z)
  while (t < reach) {
    const x = origin.x + direction.x * t
    const y = origin.y + direction.y * t
    const z = origin.z + direction.z * t
    const inside = Math.hypot(x, z) < islandRadius(Math.atan2(z, x)) * 1.05
    if (inside) {
      const above = y > landscapeHeight(x, z)
      if (wasAbove && !above) {
        // Crossed the ground between `previous` and `t`: bisect to the surface.
        let lo = previous
        let hi = t
        for (let i = 0; i < 14; i += 1) {
          const mid = (lo + hi) * 0.5
          const mx = origin.x + direction.x * mid
          const mz = origin.z + direction.z * mid
          if (origin.y + direction.y * mid > landscapeHeight(mx, mz)) lo = mid
          else hi = mid
        }
        const hx = origin.x + direction.x * hi
        const hz = origin.z + direction.z * hi
        return new Vector3(hx, landscapeHeight(hx, hz), hz)
      }
      wasAbove = above
    } else wasAbove = true
    previous = t
    // Fine near the camera, coarser far away, never so coarse that a ridge is stepped over.
    t += Math.min(60, Math.max(1.5, t * 0.02))
  }
  return null
}

/**
 * `kind` 'stand' (Explore): the marker rings where the eyes will be, red where one cannot stand. 'look' (Approach): the same marker, a little larger,
 * rings the area to look at; a click picks it and asks for no pointer lock.
 */
export function PlacementCursor({ active, water, onPlace, kind = 'stand' }: { active: boolean; water: WaterSystem; onPlace: (placement: Placement) => void; kind?: 'stand' | 'look' }) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const hover = useRef<{ point: Vector3; valid: boolean } | null>(null)
  const onPlaceRef = useRef(onPlace)
  onPlaceRef.current = onPlace

  useEffect(() => {
    if (!active) {
      hover.current = null
      return
    }
    const element = gl.domElement
    const ray = new Raycaster()
    let down: { x: number; y: number } | null = null
    const aim = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect()
      const ndc = new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1))
      ray.setFromCamera(ndc, camera)
      const ground = groundHit(ray.ray.origin, ray.ray.direction)
      if (!ground) return null
      // Over water the pointer meets the water's surface first: the marker is placed there, where it is seen (the ground hit lies further along the
      // ray, under the water). Approach may look at water; Explore cannot stand in water deeper than wading depth.
      let point = ground
      const surface = water.surfaceAt(ground.x, ground.z)
      if (surface !== null && surface > ground.y && ray.ray.direction.y < -1e-3) {
        const t = (surface - ray.ray.origin.y) / ray.ray.direction.y
        if (t > 0) point = ray.ray.origin.clone().addScaledVector(ray.ray.direction, t)
      }
      const inside = Math.hypot(point.x, point.z) <= islandRadius(Math.atan2(point.z, point.x)) - EDGE_MARGIN
      const standable = inside && (kind === 'look' || water.depthAt(point.x, point.z) <= WADE_DEPTH)
      return { point, valid: standable }
    }
    const move = (event: PointerEvent) => {
      hover.current = aim(event)
    }
    const press = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY }
    }
    const release = (event: PointerEvent) => {
      const start = down
      down = null
      // A drag orbits the view; only a click places.
      if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return
      const target = aim(event)
      if (!target || !target.valid) return
      const forward = new Vector3()
      camera.getWorldDirection(forward)
      // Confirming a place is the click that asks for mouse-look: the lock must be requested inside the gesture.
      if (kind === 'stand') {
        try {
          void (element.requestPointerLock() as Promise<void> | undefined)?.catch(() => {})
        } catch {
          // Unavailable here: Explore falls back to dragging to look.
        }
      }
      onPlaceRef.current({ x: target.point.x, z: target.point.z, yaw: Math.atan2(-forward.x, -forward.z) })
    }
    const leave = () => {
      hover.current = null
    }
    const previous = element.style.cursor
    element.style.cursor = 'crosshair'
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerdown', press)
    element.addEventListener('pointerup', release)
    element.addEventListener('pointerleave', leave)
    return () => {
      element.style.cursor = previous
      pickUniforms.uPickOn.value = 0
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerdown', press)
      element.removeEventListener('pointerup', release)
      element.removeEventListener('pointerleave', leave)
      hover.current = null
    }
  }, [active, camera, gl, water, kind])

  // The marker follows the pointer while this mode is choosing (only the active one writes it; its effect's cleanup hides it).
  useFrame(() => {
    if (!active) return
    const h = hover.current
    pickUniforms.uPickOn.value = h ? (h.valid ? 1 : 2) : 0
    if (h) {
      const base = markerSize(h.point.distanceTo(camera.position))
      pickUniforms.uPick.value.set(h.point.x, h.point.z, base * (kind === 'look' ? APPROACH_SCALE : EXPLORE_SCALE), base * LINE_SCALE)
    }
  })
  return null
}
