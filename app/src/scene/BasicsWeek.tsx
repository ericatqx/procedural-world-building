import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { CubeExercise } from './exercises/CubeExercise.tsx'

const SCENE_BG = '#0e1118'

/** Week 02 — basic Three.js scene with a cube. */
export function BasicsWeek() {
  return (
    <div className="app-shell">
      <div className="viz-stage">
        <div className="world-canvas-wrap">
          <Canvas
            className="world-canvas"
            camera={{ position: [2.4, 1.8, 2.8], fov: 50 }}
            gl={{ antialias: true }}
          >
            <color attach="background" args={[SCENE_BG]} />
            <ambientLight intensity={0.55} />
            <hemisphereLight args={['#d7e3ff', '#1a1d26', 0.45]} />
            <directionalLight position={[6, 8, 4]} intensity={1.2} />
            <CubeExercise />
            <gridHelper args={[8, 8, '#3d4a63', '#252a36']} />
            <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
          </Canvas>
        </div>
      </div>

      <div className="app-chrome">
        <header className="app-title-bar">
          <p className="app-kicker">Week 02</p>
          <h1 className="app-title">Basics</h1>
        </header>

        <aside className="side-panel" aria-label="Basics notes">
          <h2 className="panel-title">Scene basics</h2>
          <p className="panel-hint">
            A single mesh in a Three.js canvas. Drag to orbit. Later weeks build
            on this same render loop with noise, simulation, and voxels.
          </p>
        </aside>
      </div>
    </div>
  )
}
