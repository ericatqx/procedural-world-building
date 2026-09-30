import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo, useState } from 'react'
import { AUTO_ROTATE_SPEED, ViewTools } from '../../shared/ui/instrument.tsx'
import type { TerrainFogSettings } from './terrainConfig.ts'
import type { TerrainColorMode } from './terrainContours.ts'
import { NoiseExercise } from './NoiseExercise.tsx'
import { RainStreaks } from './RainStreaks.tsx'
import { WaterSurface } from './WaterSurface.tsx'

const TERRAIN_CAMERA = {
  position: [3.2, 2.4, 3.8] as [number, number, number],
  fov: 50,
}

const SCENE_BG = '#000000'

const TERRAIN_SIZE = 8

const KEY_LIGHT = {
  position: [-5.5, 2.6, 1.5] as [number, number, number],
  intensity: 3.4,
  color: '#fff8ec',
  shadowMapSize: 4096,
}

const AMBIENT_INTENSITY = 0.1

/** Distance below the lowest terrain vertex where the ground cue sits. */
const GROUND_GAP = 0.02

const MARK_COLOR = '#e9e6df'
const MARK_OPACITY = 0.32
/** Corner marks sit this far outside the terrain footprint. */
const MARK_MARGIN = 0.35
const MARK_LENGTH = 0.4

function lowestHeight(heightmap: Float32Array): number {
  let min = Infinity
  for (let i = 0; i < heightmap.length; i++) {
    if (heightmap[i]! < min) min = heightmap[i]!
  }
  return heightmap.length ? min : 0
}

/** L-shaped marks at the four corners of the terrain footprint. */
function cornerMarks(half: number, length: number): Float32Array {
  const points: number[] = []
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * half
      const z = sz * half
      points.push(x, 0, z, x - sx * length, 0, z)
      points.push(x, 0, z, x, 0, z - sz * length)
    }
  }
  return new Float32Array(points)
}

const CORNER_MARKS = cornerMarks(TERRAIN_SIZE / 2 + MARK_MARGIN, MARK_LENGTH)

type TerrainCanvasProps = {
  heightmap: Float32Array
  resolution: number
  amplitude: number
  wireframe: boolean
  onWireframeChange: (next: boolean) => void
  contours: boolean
  onContoursChange: (next: boolean) => void
  fog: TerrainFogSettings
  /** Simulation water buffer; when present, drawn as a surface over the terrain. */
  water?: Float32Array
  /** 0–1 rain streak density; rain is drawn only with `water` and above 0. */
  rainIntensity?: number
  colorMode?: TerrainColorMode
}

/** Week 03 3D view: height-field terrain, simulation water and rain, and the Wireframe / Contours / Auto rotate strip. */
export function TerrainCanvas({
  heightmap,
  resolution,
  amplitude,
  wireframe,
  onWireframeChange,
  contours,
  onContoursChange,
  fog,
  water,
  rainIntensity = 0,
  colorMode = 'neutral',
}: TerrainCanvasProps) {
  const [autoRotate, setAutoRotate] = useState(false)
  const groundY = useMemo(
    () => lowestHeight(heightmap) * amplitude - GROUND_GAP,
    [heightmap, amplitude],
  )

  return (
    <div className="world-canvas-wrap">
      <Canvas
        className="world-canvas"
        camera={TERRAIN_CAMERA}
        gl={{ antialias: true }}
        shadows="percentage"
      >
        <color attach="background" args={[SCENE_BG]} />
        {fog.enabled ? (
          <fog attach="fog" args={[SCENE_BG, fog.near, fog.far]} />
        ) : null}
        <ambientLight intensity={AMBIENT_INTENSITY} />
        <directionalLight
          position={KEY_LIGHT.position}
          intensity={KEY_LIGHT.intensity}
          color={KEY_LIGHT.color}
          castShadow
          shadow-mapSize={[KEY_LIGHT.shadowMapSize, KEY_LIGHT.shadowMapSize]}
          shadow-bias={-0.0005}
          shadow-normalBias={0.05}
          shadow-radius={2}
          shadow-camera-left={-6}
          shadow-camera-right={6}
          shadow-camera-top={6}
          shadow-camera-bottom={-6}
          shadow-camera-near={0.5}
          shadow-camera-far={30}
        />
        <NoiseExercise
          heightmap={heightmap}
          resolution={resolution}
          amplitude={amplitude}
          wireframe={wireframe}
          contours={contours}
          colorMode={colorMode}
          size={TERRAIN_SIZE}
        />
        {water ? (
          <WaterSurface
            heightmap={heightmap}
            water={water}
            resolution={resolution}
            amplitude={amplitude}
            size={TERRAIN_SIZE}
          />
        ) : null}
        {water && rainIntensity > 0 ? (
          <RainStreaks
            heightmap={heightmap}
            water={water}
            resolution={resolution}
            amplitude={amplitude}
            intensity={rainIntensity}
            size={TERRAIN_SIZE}
          />
        ) : null}
        <lineSegments position={[0, groundY, 0]}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[CORNER_MARKS, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={MARK_COLOR} transparent opacity={MARK_OPACITY} />
        </lineSegments>
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          autoRotate={autoRotate}
          autoRotateSpeed={AUTO_ROTATE_SPEED}
        />
      </Canvas>

      <ViewTools
        tools={[
          { label: 'Wireframe', key: 'F', on: wireframe, onChange: onWireframeChange },
          { label: 'Contours', key: 'C', on: contours, onChange: onContoursChange },
          { label: 'Auto rotate', key: 'R', on: autoRotate, onChange: setAutoRotate },
        ]}
      />
    </div>
  )
}
