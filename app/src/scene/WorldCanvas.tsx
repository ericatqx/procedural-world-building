import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'

function CenterCube() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#7eb8ff" metalness={0.15} roughness={0.35} />
    </mesh>
  )
}

export function WorldCanvas() {
  return (
    <Canvas
      className="world-canvas"
      camera={{ position: [3.2, 2.4, 3.8], fov: 50 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#0e1118']} />
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#d7e3ff', '#1a1d26', 0.4]} />
      <directionalLight position={[6, 8, 4]} intensity={1.15} />
      <CenterCube />
      <gridHelper args={[12, 12, '#3d4a63', '#252a36']} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
    </Canvas>
  )
}
