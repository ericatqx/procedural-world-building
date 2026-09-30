import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { ExerciseHeading } from '../../shared/ui/instrument.tsx'
import { CubeExercise } from './CubeExercise.tsx'
import '../../shared/ui/system.css'

const SCENE_BG = '#000000'

const KEY_LIGHT = {
  position: [4, 5, -1] as [number, number, number],
  intensity: 3,
  color: '#fff8ec',
}

const AMBIENT_INTENSITY = 0.2

/** The cube is a unit box at the origin; the grid and shadow sit at its base. */
const FLOOR_Y = -0.5
const GRID_CENTER_COLOR = '#3d3d3a'
const GRID_COLOR = '#262624'
const SHADOW_OPACITY = 0.5

const ABOUT = {
  text: 'The smallest complete world: one object, one camera, one light. Every later exercise — noise terrain, erosion, voxels — runs on this same render loop. Here the only variable is how light meets form.',
  terms: 'Scene · Camera · Geometry · Material · Light',
  controls: 'Drag — Orbit · Scroll — Zoom',
}

/** Week 02 — basic Three.js scene with a cube. */
export function BasicsWeek() {
  return (
    <div className="app-shell ui-system week02">
      <div className="viz-stage">
        <div className="world-canvas-wrap">
          <Canvas
            className="world-canvas"
            camera={{ position: [2.4, 1.8, 2.8], fov: 50 }}
            gl={{ antialias: true }}
            shadows="percentage"
          >
            <color attach="background" args={[SCENE_BG]} />
            <ambientLight intensity={AMBIENT_INTENSITY} />
            <directionalLight
              position={KEY_LIGHT.position}
              intensity={KEY_LIGHT.intensity}
              color={KEY_LIGHT.color}
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-bias={-0.0005}
              shadow-normalBias={0.02}
              shadow-radius={2}
              shadow-camera-left={-4}
              shadow-camera-right={4}
              shadow-camera-top={4}
              shadow-camera-bottom={-4}
              shadow-camera-near={0.5}
              shadow-camera-far={20}
            />
            <CubeExercise />
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 0.001, 0]} receiveShadow>
              <planeGeometry args={[8, 8]} />
              <shadowMaterial transparent opacity={SHADOW_OPACITY} />
            </mesh>
            <gridHelper
              args={[8, 8, GRID_CENTER_COLOR, GRID_COLOR]}
              position={[0, FLOOR_Y, 0]}
            />
            <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
          </Canvas>
        </div>
      </div>

      <div className="app-chrome">
        <div className="region-left">
          <ExerciseHeading title="Basics" about={ABOUT} />
        </div>
      </div>
    </div>
  )
}
