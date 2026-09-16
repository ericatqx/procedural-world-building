import { useEffect, useLayoutEffect, useRef } from 'react'
import { Color, Float32BufferAttribute, type Mesh } from 'three'

type NoiseExerciseProps = {
  heightmap: Float32Array
  resolution: number
  amplitude: number
  wireframe: boolean
  size?: number
}

/** Elevation stops in roughly [-1, 1] height space. */
const HEIGHT_STOPS = [
  { t: -1.0, color: new Color('#1f4d7a') }, // deep low
  { t: -0.35, color: new Color('#3d7a4a') }, // low / greenery
  { t: 0.15, color: new Color('#8a7a4a') }, // mid / earth
  { t: 0.55, color: new Color('#9a8f86') }, // high / rock
  { t: 1.0, color: new Color('#f2f4f7') }, // peaks
]

const scratchColor = new Color()

function colorForHeight(height: number, target: Color): Color {
  const h = Math.max(-1, Math.min(1, height))

  for (let i = 0; i < HEIGHT_STOPS.length - 1; i++) {
    const a = HEIGHT_STOPS[i]!
    const b = HEIGHT_STOPS[i + 1]!
    if (h <= b.t) {
      const span = b.t - a.t || 1
      const u = (h - a.t) / span
      return target.copy(a.color).lerp(b.color, u)
    }
  }

  return target.copy(HEIGHT_STOPS[HEIGHT_STOPS.length - 1]!.color)
}

/**
 * Subdivided plane whose height matches the shared heightmap.
 * Vertex colors follow elevation so erosion stays readable in solid mode.
 */
export function NoiseExercise({
  heightmap,
  resolution,
  amplitude,
  wireframe,
  size = 8,
}: NoiseExerciseProps) {
  const meshRef = useRef<Mesh>(null)
  const segments = Math.max(1, resolution - 1)

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) {
      return
    }

    const geometry = mesh.geometry
    const positions = geometry.attributes.position
    if (!positions || positions.count !== heightmap.length) {
      return
    }

    let colors = geometry.getAttribute('color') as Float32BufferAttribute | null
    if (!colors || colors.count !== positions.count) {
      colors = new Float32BufferAttribute(new Float32Array(positions.count * 3), 3)
      geometry.setAttribute('color', colors)
    }

    // Flip V so row 0 matches the top of the 2D canvas preview.
    for (let i = 0; i < positions.count; i++) {
      const row = Math.floor(i / resolution)
      const col = i % resolution
      const src = (resolution - 1 - row) * resolution + col
      const height = heightmap[src]!
      positions.setZ(i, height * amplitude)
      colorForHeight(height, scratchColor)
      colors.setXYZ(i, scratchColor.r, scratchColor.g, scratchColor.b)
    }

    positions.needsUpdate = true
    colors.needsUpdate = true
    geometry.computeVertexNormals()
  }, [heightmap, amplitude, resolution, segments, size])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) {
      return
    }
    const material = mesh.material
    if (!Array.isArray(material) && 'wireframe' in material) {
      material.wireframe = wireframe
      material.needsUpdate = true
    }
  }, [wireframe])

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry key={`${size}-${segments}`} args={[size, size, segments, segments]} />
      <meshStandardMaterial
        vertexColors
        wireframe={wireframe}
        metalness={0.08}
        roughness={0.72}
      />
    </mesh>
  )
}
