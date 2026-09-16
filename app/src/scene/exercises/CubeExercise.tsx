export function CubeExercise() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#7eb8ff" metalness={0.15} roughness={0.35} />
    </mesh>
  )
}
