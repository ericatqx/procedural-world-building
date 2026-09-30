import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { createTerrainContours, type TerrainColorMode } from './terrainContours.ts'

type NoiseExerciseProps = {
  heightmap: Float32Array
  resolution: number
  amplitude: number
  wireframe: boolean
  contours: boolean
  colorMode?: TerrainColorMode
  size?: number
}

const SURFACE_COLOR = '#e4e0d8'
const SURFACE_ROUGHNESS = 0.94

/**
 * Subdivided plane whose height matches the shared heightmap.
 * Neutral matte surface; form is read through light and cast shadow.
 */
export function NoiseExercise({
  heightmap,
  resolution,
  amplitude,
  wireframe,
  contours,
  colorMode = 'neutral',
  size = 8,
}: NoiseExerciseProps) {
  const meshRef = useRef<Mesh>(null)
  const segments = Math.max(1, resolution - 1)
  const contourShader = useMemo(() => createTerrainContours(), [])

  useEffect(() => {
    contourShader.setContoursVisible(contours)
  }, [contourShader, contours])

  useEffect(() => {
    contourShader.setColorMode(colorMode, amplitude)
  }, [contourShader, colorMode, amplitude])

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

    // Flip V so row 0 matches the top of the 2D canvas preview.
    for (let i = 0; i < positions.count; i++) {
      const row = Math.floor(i / resolution)
      const col = i % resolution
      const src = (resolution - 1 - row) * resolution + col
      positions.setZ(i, heightmap[src]! * amplitude)
    }

    positions.needsUpdate = true
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
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
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
      <planeGeometry key={`${size}-${segments}`} args={[size, size, segments, segments]} />
      <meshStandardMaterial
        color={SURFACE_COLOR}
        wireframe={wireframe}
        metalness={0}
        roughness={SURFACE_ROUGHNESS}
        onBeforeCompile={contourShader.onBeforeCompile}
        customProgramCacheKey={contourShader.customProgramCacheKey}
      />
    </mesh>
  )
}
