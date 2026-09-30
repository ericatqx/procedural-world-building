import { useLayoutEffect, useRef } from 'react'
import { BufferAttribute, Color, type Mesh } from 'three'
import { WATER_DEPTH_SCALE } from './hydraulicErosion.ts'

type WaterSurfaceProps = {
  /** Current (eroded) terrain heights, same grid as the terrain mesh. */
  heightmap: Float32Array
  /** Simulation water amounts per cell. */
  water: Float32Array
  resolution: number
  amplitude: number
  size?: number
}

const WATER_COLOR = new Color('#64dcff')
const WATER_LIFT = 0.004
const MAX_ALPHA = 0.85
/**
 * Opacity follows depth on a log scale: the thin sheet rain leaves on slopes
 * stays invisible, streams read faintly, and pools read solid.
 */
const VISIBLE_DEPTH = 0.003
const FULL_DEPTH = 0.08
const LOG_SPAN = Math.log(FULL_DEPTH / VISIBLE_DEPTH)

/**
 * Water surface over the terrain, drawn from the erosion simulation's water
 * buffer: terrain height plus water depth, so pools lie level in depressions.
 * Rendering only — it never writes to the fields.
 */
export function WaterSurface({
  heightmap,
  water,
  resolution,
  amplitude,
  size = 8,
}: WaterSurfaceProps) {
  const meshRef = useRef<Mesh>(null)
  const segments = Math.max(1, resolution - 1)

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) {
      return
    }

    const geometry = mesh.geometry
    const positions = geometry.attributes.position
    if (
      !positions ||
      positions.count !== heightmap.length ||
      water.length !== heightmap.length
    ) {
      return
    }

    let colors = geometry.getAttribute('color') as BufferAttribute | undefined
    if (!colors || colors.count !== positions.count || colors.itemSize !== 4) {
      colors = new BufferAttribute(new Float32Array(positions.count * 4), 4)
      geometry.setAttribute('color', colors)
    }

    // Same V flip as the terrain mesh.
    for (let i = 0; i < positions.count; i++) {
      const row = Math.floor(i / resolution)
      const col = i % resolution
      const src = (resolution - 1 - row) * resolution + col
      const depth = water[src]! * WATER_DEPTH_SCALE
      positions.setZ(i, (heightmap[src]! + depth) * amplitude + WATER_LIFT)

      const t =
        depth > VISIBLE_DEPTH ? Math.min(1, Math.log(depth / VISIBLE_DEPTH) / LOG_SPAN) : 0
      colors.setXYZW(i, WATER_COLOR.r, WATER_COLOR.g, WATER_COLOR.b, t * MAX_ALPHA)
    }

    positions.needsUpdate = true
    colors.needsUpdate = true
    geometry.computeBoundingSphere()
  }, [heightmap, water, amplitude, resolution, segments, size])

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      <planeGeometry key={`${size}-${segments}`} args={[size, size, segments, segments]} />
      <meshBasicMaterial
        vertexColors
        transparent
        depthWrite={false}
        toneMapped={false}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  )
}
