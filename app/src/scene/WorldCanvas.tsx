import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { NoiseExercise } from './exercises/NoiseExercise.tsx'

export type TerrainFogSettings = {
  enabled: boolean
  near: number
  far: number
}

export const DEFAULT_TERRAIN_FOG: TerrainFogSettings = {
  enabled: true,
  near: 4,
  far: 18,
}

const SCENE_BG = '#0e1118'

type WorldCanvasProps = {
  heightmap: Float32Array
  resolution: number
  amplitude: number
  wireframe: boolean
  fog: TerrainFogSettings
  onFogChange: (next: TerrainFogSettings) => void
}

export function WorldCanvas({
  heightmap,
  resolution,
  amplitude,
  wireframe,
  fog,
  onFogChange,
}: WorldCanvasProps) {
  return (
    <div className="world-canvas-wrap">
      <Canvas
        className="world-canvas"
        camera={{ position: [3.2, 2.4, 3.8], fov: 50 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={[SCENE_BG]} />
        {fog.enabled ? (
          <fog attach="fog" args={[SCENE_BG, fog.near, fog.far]} />
        ) : null}
        <ambientLight intensity={0.55} />
        <hemisphereLight args={['#d7e3ff', '#1a1d26', 0.45]} />
        <directionalLight position={[6, 8, 4]} intensity={1.2} />
        <NoiseExercise
          heightmap={heightmap}
          resolution={resolution}
          amplitude={amplitude}
          wireframe={wireframe}
        />
        <gridHelper args={[12, 12, '#3d4a63', '#252a36']} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
      </Canvas>

      <div className="terrain-overlays">
        <div className="fog-panel">
          <label className="fog-toggle">
            <input
              type="checkbox"
              checked={fog.enabled}
              onChange={(event) =>
                onFogChange({ ...fog, enabled: event.target.checked })
              }
            />
            <span>Fog</span>
          </label>
          <label className="fog-slider">
            <span>Near ({fog.near.toFixed(1)})</span>
            <input
              type="range"
              min={0.5}
              max={12}
              step={0.1}
              value={fog.near}
              disabled={!fog.enabled}
              onChange={(event) => {
                const near = Number(event.target.value)
                onFogChange({
                  ...fog,
                  near,
                  far: Math.max(fog.far, near + 0.5),
                })
              }}
            />
          </label>
          <label className="fog-slider">
            <span>Far ({fog.far.toFixed(1)})</span>
            <input
              type="range"
              min={2}
              max={40}
              step={0.5}
              value={fog.far}
              disabled={!fog.enabled}
              onChange={(event) => {
                const far = Number(event.target.value)
                onFogChange({
                  ...fog,
                  far,
                  near: Math.min(fog.near, far - 0.5),
                })
              }}
            />
          </label>
        </div>
        <p className="wireframe-hint" aria-live="polite">
          <kbd>F</kbd> — Wireframe {wireframe ? '(on)' : '(off)'}
        </p>
      </div>
    </div>
  )
}
