import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, DoubleSide, Group, Quaternion, Raycaster, Vector2, Vector3 } from 'three'
import { islandRadius, landscapeHeight } from './terrain.ts'
import { WADE_DEPTH, type WaterSystem } from './water.ts'

/**
 * Choosing where to stand. While `active`, the pointer is followed over the terrain: a ray from the camera is
 * marched down to the ground (ground height is a function, so there is no mesh to raycast), and a marker rings the
 * spot. A click that is not a drag places the walker there, facing the way the camera was looking. The marker is part
 * of this component only: it exists while placing and is gone after. Orbit controls stay live, so the view can be
 * changed first; a drag orbits, a click places.
 */
export type Placement = { x: number; z: number; yaw: number }

const VALID = new Color('#e6ebf7')
const INVALID = new Color('#c9605a')
const EDGE_MARGIN = 10

/** Where the ray meets the ground, or null (sky, or beyond the island). */
function groundHit(origin: Vector3, direction: Vector3): Vector3 | null {
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

export function PlacementCursor({ active, water, onPlace }: { active: boolean; water: WaterSystem; onPlace: (placement: Placement) => void }) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const group = useRef<Group>(null)
  const hover = useRef<{ point: Vector3; valid: boolean } | null>(null)
  const onPlaceRef = useRef(onPlace)
  onPlaceRef.current = onPlace

  const material = useMemo(() => ({ color: VALID.clone() }), [])

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
      const point = groundHit(ray.ray.origin, ray.ray.direction)
      if (!point) return null
      const standable = Math.hypot(point.x, point.z) <= islandRadius(Math.atan2(point.z, point.x)) - EDGE_MARGIN && water.depthAt(point.x, point.z) <= WADE_DEPTH
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
      try {
        void (element.requestPointerLock() as Promise<void> | undefined)?.catch(() => {})
      } catch {
        // Unavailable here: Explore falls back to dragging to look.
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
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerdown', press)
      element.removeEventListener('pointerup', release)
      element.removeEventListener('pointerleave', leave)
      hover.current = null
    }
  }, [active, camera, gl, water])

  const up = useMemo(() => new Vector3(0, 1, 0), [])
  const tilt = useMemo(() => new Quaternion(), [])
  const normal = useMemo(() => new Vector3(), [])
  useFrame(() => {
    const marker = group.current
    if (!marker) return
    const h = hover.current
    marker.visible = active && h !== null
    if (!active || !h) return
    const { point, valid } = h
    // Sits on the ground, leaning with its slope, and grows with distance so it reads from Overview as from nearby.
    const dx = (landscapeHeight(point.x + 2, point.z) - landscapeHeight(point.x - 2, point.z)) / 4
    const dz = (landscapeHeight(point.x, point.z + 2) - landscapeHeight(point.x, point.z - 2)) / 4
    normal.set(-dx, 1, -dz).normalize()
    tilt.setFromUnitVectors(up, normal)
    marker.quaternion.copy(tilt)
    // Over a lake the ring rides the water's surface, in the warning colour, so it can be seen where one cannot stand.
    const surface = Math.max(point.y, water.surfaceAt(point.x, point.z) ?? point.y)
    marker.position.set(point.x, surface + 0.15 + point.distanceTo(camera.position) * 0.0015, point.z)
    const size = Math.min(80, Math.max(1.1, point.distanceTo(camera.position) * 0.022))
    marker.scale.setScalar(size)
    material.color.copy(valid ? VALID : INVALID)
    for (const child of marker.children) ((child as unknown as { material: { color: Color } }).material.color as Color).copy(material.color)
  })

  if (!active) return null
  return (
    <group ref={group} visible={false} renderOrder={20}>
      {/* A ring, a dot at its centre, and a faint disc: where the eyes will be, a little over a meter and a half above the ground. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={20}>
        <ringGeometry args={[0.78, 1, 40]} />
        <meshBasicMaterial transparent opacity={0.9} depthWrite={false} side={DoubleSide} fog={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={20}>
        <circleGeometry args={[0.1, 16]} />
        <meshBasicMaterial transparent opacity={0.95} depthWrite={false} side={DoubleSide} fog={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={19}>
        <circleGeometry args={[0.78, 40]} />
        <meshBasicMaterial transparent opacity={0.1} depthWrite={false} side={DoubleSide} fog={false} />
      </mesh>
    </group>
  )
}
