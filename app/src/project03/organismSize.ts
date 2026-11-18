import { useEffect, useState } from 'react'
import { Vector3, type BufferGeometry, type Mesh } from 'three'

/**
 * Shadow Ecology 0.3 — an organism's size as it stands now, measured from the mesh actually drawn (its current lifecycle stage), not from the plan.
 * Living Architecture registers each organism's front mesh here; the card asks for its size.
 *
 *   height  the vertical extent of the drawn geometry, in world metres (any scale the mesh carries included)
 *   length  the horizontal extent along the form's own main axis (the principal axis of its footprint), so a long, angled form is not overstated
 *   width   the horizontal extent across that axis
 */
export const organismMeshes = new Map<number, Mesh>()

export type OrganismSize = { length: number; width: number; height: number }

const cache = new WeakMap<BufferGeometry, { key: string; size: OrganismSize }>()
const v = new Vector3()

export function measureMesh(mesh: Mesh): OrganismSize | null {
  const geometry = mesh.geometry
  const position = geometry?.getAttribute('position')
  if (!position || position.count < 3) return null
  mesh.updateWorldMatrix(true, false)
  const key = mesh.matrixWorld.elements.map((e) => e.toFixed(3)).join(',')
  const hit = cache.get(geometry)
  if (hit && hit.key === key) return hit.size
  // Up to about 8,000 vertices, in world space.
  const stride = Math.max(1, Math.floor(position.count / 8000))
  const xs: number[] = []
  const zs: number[] = []
  let yMin = Infinity
  let yMax = -Infinity
  let mx = 0
  let mz = 0
  for (let i = 0; i < position.count; i += stride) {
    v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)
    xs.push(v.x)
    zs.push(v.z)
    mx += v.x
    mz += v.z
    if (v.y < yMin) yMin = v.y
    if (v.y > yMax) yMax = v.y
  }
  const n = xs.length
  mx /= n
  mz /= n
  // The footprint's principal axis (2×2 covariance).
  let sxx = 0
  let szz = 0
  let sxz = 0
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - mx
    const dz = zs[i]! - mz
    sxx += dx * dx
    szz += dz * dz
    sxz += dx * dz
  }
  const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz)
  const ax = Math.cos(angle)
  const az = Math.sin(angle)
  let aMin = Infinity
  let aMax = -Infinity
  let bMin = Infinity
  let bMax = -Infinity
  for (let i = 0; i < n; i += 1) {
    const a = xs[i]! * ax + zs[i]! * az
    const b = -xs[i]! * az + zs[i]! * ax
    if (a < aMin) aMin = a
    if (a > aMax) aMax = a
    if (b < bMin) bMin = b
    if (b > bMax) bMax = b
  }
  const along = aMax - aMin
  const across = bMax - bMin
  const size = { length: Math.max(along, across), width: Math.min(along, across), height: yMax - yMin }
  cache.set(geometry, { key, size })
  return size
}

/** The selected organism's size, re-measured twice a second while it is shown (its mesh changes as it grows, ages or is rebuilt). */
export function useOrganismSize(index: number): OrganismSize | null {
  const [size, setSize] = useState<OrganismSize | null>(null)
  useEffect(() => {
    const read = () => {
      const mesh = organismMeshes.get(index)
      const next = mesh && mesh.visible ? measureMesh(mesh) : null
      setSize((prev) => (prev && next && prev.length === next.length && prev.width === next.width && prev.height === next.height ? prev : next))
    }
    read()
    const timer = window.setInterval(read, 500)
    return () => window.clearInterval(timer)
  }, [index])
  return size
}
