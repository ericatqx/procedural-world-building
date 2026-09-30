/** Week 02 visual experiment: warm off-white, kept matte. */
const CUBE_COLOR = '#ece6da'

export function CubeExercise() {
  return (
    <mesh castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={CUBE_COLOR} metalness={0} roughness={0.9} />
    </mesh>
  )
}
