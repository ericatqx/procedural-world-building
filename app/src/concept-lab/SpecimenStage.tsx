import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { DoubleSide, type BufferGeometry } from 'three'
import { AUTO_ROTATE_SPEED } from '../shared/ui/instrument.tsx'

/**
 * Concept Lab — one stage for every study. Dark field, one warm key light,
 * the same pale material, so only the silhouette changes.
 */

const BACKGROUND = '#050608'
const FOG = '#11141a'
const STONE = '#e2dac9'
const GROUND = '#101114'
const SUN = '#fff8ec'

export function SpecimenStage({
  geometry,
  wireframe,
  autoRotate,
}: {
  geometry: BufferGeometry
  wireframe: boolean
  autoRotate: boolean
}) {
  return (
    <Canvas
      className="world-canvas"
      camera={{ position: [2.7, 2.05, 3.6], fov: 40, near: 0.05, far: 40 }}
      gl={{ antialias: true }}
      dpr={[1, 1.5]}
      shadows
    >
      <color attach="background" args={[BACKGROUND]} />
      <fog attach="fog" args={[FOG, 5.2, 12.5]} />
      <ambientLight intensity={0.18} />
      <hemisphereLight args={['#c9cfdc', '#1a1917', 0.26]} />
      <directionalLight
        position={[3.4, 5.6, 2.1]}
        intensity={2.7}
        color={SUN}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.4}
        shadow-camera-far={14}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.012, 0]} receiveShadow>
        <circleGeometry args={[7, 64]} />
        <meshStandardMaterial color={GROUND} roughness={1} metalness={0} />
      </mesh>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color={STONE} roughness={0.92} metalness={0} wireframe={wireframe} side={DoubleSide} />
      </mesh>
      <OrbitControls
        target={[0, 0.72, 0]}
        autoRotate={autoRotate}
        autoRotateSpeed={AUTO_ROTATE_SPEED}
        enableDamping
        minDistance={1.15}
        maxDistance={8}
      />
    </Canvas>
  )
}
