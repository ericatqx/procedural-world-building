import { Grid, Html, Line, OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, InstancedMesh, Object3D, Vector3, type PerspectiveCamera } from 'three'
import { AUTO_ROTATE_SPEED } from '../../shared/ui/instrument.tsx'
import { boundsOf, DEPTH, MESH_LEVELS, OBJECTS, ringFor, type MeshLevel, type Part, type ScaleObject } from './scale.ts'

const BONE = '#cfc9bb'
const DIM_BONE = '#8c877b'
const GHOST = '#7fa6d6'
const LINE = '#e8e4d8'

export type CameraRequest = { id: number; distance: number; elevation?: number }
/** What the camera sees: its distance to the subject, the view's height, and the depth (along the view axis) of the two poles. */
export type ViewReport = { distance: number; heightPx: number; front: number; back: number }

const FRONT_POLE = '#8A9D91'
const BACK_POLE = '#B69A80'

type PoleSpec = { front: [number, number]; back: [number, number]; height: number; radius: number }

/** Where the depth poles stand: one in front of the subject (nearer the starting camera) and one well behind, off to opposite sides. */
function polesFor(object: ScaleObject): PoleSpec {
  const b = boundsOf(object.parts)
  const longest = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
  const cx = object.at + (b.min[0] + b.max[0]) / 2
  return {
    front: [cx - longest * 0.32, b.max[2] + longest * DEPTH.front],
    back: [cx + longest * 0.32, b.min[2] - longest * DEPTH.back],
    height: longest * DEPTH.height,
    radius: Math.max(0.02, longest * 0.012),
  }
}

/** Two slim poles to judge depth by: blue in front of the subject, amber behind it. */
function DepthPoles({ spec }: { spec: PoleSpec }) {
  const pole = (at: [number, number], color: string) => (
    <mesh position={[at[0], spec.height / 2, at[1]]}>
      <cylinderGeometry args={[spec.radius, spec.radius, spec.height, 12]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} roughness={0.8} />
    </mesh>
  )
  return (
    <group>
      {pole(spec.front, FRONT_POLE)}
      {pole(spec.back, BACK_POLE)}
    </group>
  )
}

/** One solid of an object, drawn smooth at its true size. */
function PartMesh({ part, color, wireframe, opacity = 1 }: { part: Part; color: string; wireframe: boolean; opacity?: number }) {
  const geometry =
    part.shape === 'box' ? (
      <boxGeometry args={[1, 1, 1]} />
    ) : part.shape === 'ellipsoid' ? (
      <sphereGeometry args={[0.5, 24, 16]} />
    ) : part.shape === 'cylinder' ? (
      <cylinderGeometry args={[0.5, 0.5, 1, 24]} />
    ) : (
      <coneGeometry args={[0.5, 1, 24]} />
    )
  return (
    <mesh position={part.c} scale={part.s}>
      {geometry}
      <meshStandardMaterial color={color} roughness={0.9} metalness={0} wireframe={wireframe} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  )
}

function SmoothObject({ object, color, wireframe, opacity }: { object: ScaleObject; color: string; wireframe: boolean; opacity?: number }) {
  return (
    <group position={[object.at, 0, 0]}>
      {object.parts.map((part, i) => (
        <PartMesh key={i} part={part} color={color} wireframe={wireframe} opacity={opacity} />
      ))}
    </group>
  )
}

/** The selected object as cells of one size: what a grid of that resolution keeps of it. */
function VoxelObject({ object, cells, cell, height, wireframe }: { object: ScaleObject; cells: Float32Array; cell: number; height: number; wireframe: boolean }) {
  const mesh = useRef<InstancedMesh>(null)
  const count = cells.length / 3
  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const dummy = new Object3D()
    const low = new Color('#9b9588')
    const high = new Color('#efe9d8')
    const colour = new Color()
    for (let i = 0; i < count; i += 1) {
      dummy.position.set(cells[i * 3]!, cells[i * 3 + 1]!, cells[i * 3 + 2]!)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      colour.copy(low).lerp(high, Math.min(1, cells[i * 3 + 1]! / Math.max(1e-6, height)))
      m.setColorAt(i, colour)
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [cells, count, height])
  return (
    <group position={[object.at, 0, 0]}>
      <instancedMesh key={count} ref={mesh} args={[undefined, undefined, Math.max(1, count)]} frustumCulled={false}>
        <boxGeometry args={[cell * 0.96, cell * 0.96, cell * 0.96]} />
        <meshStandardMaterial roughness={0.9} metalness={0} wireframe={wireframe} />
      </instancedMesh>
    </group>
  )
}

/** The mesh-detail test piece: a ring standing on the ground, as tall as the selected object, built from few or many triangles. */
function MeshObject({ object, level, wireframe }: { object: ScaleObject; level: MeshLevel; wireframe: boolean }) {
  const b = boundsOf(object.parts)
  const { major, minor } = ringFor(b.max[1])
  const { radial, tubular } = MESH_LEVELS[level]
  return (
    <group position={[object.at + (b.min[0] + b.max[0]) / 2, major + minor, (b.min[2] + b.max[2]) / 2]}>
      <mesh>
        <torusGeometry args={[major, minor, radial, tubular]} />
        <meshStandardMaterial color={BONE} roughness={0.9} metalness={0} flatShading wireframe={wireframe} />
      </mesh>
    </group>
  )
}

/** A height line beside the selected object, and its width along the ground, in metres. */
function Dimensions({ object }: { object: ScaleObject }) {
  const b = boundsOf(object.parts)
  const x = object.at + b.max[0] + 0.6
  const z = b.max[2] + 0.6
  const h = b.max[1]
  const w = b.max[0] - b.min[0]
  const d = b.max[2] - b.min[2]
  const label = (m: number) => (m >= 100 ? `${Math.round(m)} m` : m >= 10 ? `${m.toFixed(1)} m` : `${m.toFixed(2)} m`)
  return (
    <group>
      <Line points={[[x, 0, z], [x, h, z]]} color={LINE} lineWidth={1} />
      <Html position={[x, h, z]} center zIndexRange={[10, 0]}>
        <span className="scale-label">{label(h)}</span>
      </Html>
      <Line points={[[object.at + b.min[0], 0.02, z], [object.at + b.max[0], 0.02, z]]} color={LINE} lineWidth={1} />
      <Html position={[object.at + (b.min[0] + b.max[0]) / 2, 0.02, z]} center zIndexRange={[10, 0]}>
        <span className="scale-label">{label(w)} wide</span>
      </Html>
      <Html position={[object.at + b.max[0], 0.02, (b.min[2] + b.max[2]) / 2]} center zIndexRange={[10, 0]}>
        <span className="scale-label is-faint">{label(d)} deep</span>
      </Html>
    </group>
  )
}

/** Puts the camera where the page asks (a distance and, for a viewpoint, an elevation), and reports the view back. */
function CameraRig({ target, request, fov, dolly, poles, onView }: { target: [number, number, number]; request: CameraRequest; fov: number; dolly: boolean; poles: PoleSpec; onView: (report: ViewReport) => void }) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera
  const controls = useThree((state) => state.controls) as unknown as { target: Vector3; update: () => void } | null
  const size = useThree((state) => state.size)
  const handled = useRef(-1)
  const lastReport = useRef(0)
  useFrame((_, delta) => {
    if (!controls) return
    if (camera.fov !== fov) {
      // Dolly zoom: keep distance × tan(fov / 2) constant, so the subject holds its size while the lens changes.
      if (dolly) {
        const offset = camera.position.clone().sub(controls.target)
        const k = Math.tan((camera.fov * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360)
        camera.position.copy(controls.target).addScaledVector(offset, k)
      }
      camera.fov = fov
      camera.updateProjectionMatrix()
      controls.update()
    }
    if (handled.current !== request.id) {
      handled.current = request.id
      const offset = camera.position.clone().sub(controls.target)
      const azimuth = Math.atan2(offset.x, offset.z)
      const currentElevation = Math.asin(Math.max(-1, Math.min(1, offset.y / Math.max(1e-6, offset.length()))))
      const elevation = request.elevation !== undefined ? (request.elevation * Math.PI) / 180 : currentElevation
      const az = request.elevation !== undefined && Math.abs(offset.length()) < 1e-3 ? 0.35 : azimuth
      controls.target.set(...target)
      camera.position.set(
        target[0] + Math.sin(az) * Math.cos(elevation) * request.distance,
        Math.max(0.5, target[1] + Math.sin(elevation) * request.distance),
        target[2] + Math.cos(az) * Math.cos(elevation) * request.distance,
      )
      controls.update()
    }
    lastReport.current += delta
    if (lastReport.current > 0.1) {
      lastReport.current = 0
      const forward = new Vector3()
      camera.getWorldDirection(forward)
      const depth = (at: [number, number]) => Math.max(0.05, new Vector3(at[0], poles.height / 2, at[1]).sub(camera.position).dot(forward))
      onView({ distance: camera.position.distanceTo(controls.target), heightPx: size.height, front: depth(poles.front), back: depth(poles.back) })
    }
  })
  return null
}

export function ScaleScene({
  selected,
  form,
  meshLevel,
  cells,
  cell,
  wireframe,
  autoRotate,
  reference,
  dimensions,
  grid,
  fov,
  dolly,
  poles,
  request,
  onView,
}: {
  selected: ScaleObject
  form: 'smooth' | 'voxels' | 'mesh'
  meshLevel: MeshLevel
  cells: Float32Array
  cell: number
  wireframe: boolean
  autoRotate: boolean
  reference: boolean
  dimensions: boolean
  grid: boolean
  fov: number
  dolly: boolean
  poles: boolean
  request: CameraRequest
  onView: (report: ViewReport) => void
}) {
  const b = useMemo(() => boundsOf(selected.parts), [selected])
  const target: [number, number, number] = [selected.at + (b.min[0] + b.max[0]) / 2, b.max[1] / 2, (b.min[2] + b.max[2]) / 2]
  const person = OBJECTS[0]!
  const pole = useMemo(() => polesFor(selected), [selected])
  // The person stands in front of the object's near face, at the same depth, so the two can be read against each other.
  const ghostAt = selected.id === person.id ? null : { ...person, at: selected.at + b.min[0] + 3, parts: person.parts.map((p) => ({ ...p, c: [p.c[0], p.c[1], p.c[2] + b.max[2] + 1.5] as [number, number, number] })) }
  return (
    <>
      <color attach="background" args={['#000000']} />
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#c9cfdc', '#1a1917', 0.6]} />
      <directionalLight position={[60, 120, 80]} intensity={2.2} color="#fff8ec" />
      {grid ? (
        <Grid
          position={[0, 0.004, 0]}
          args={[10, 10]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#3a3935"
          sectionSize={10}
          sectionThickness={1}
          sectionColor="#66635b"
          fadeDistance={260}
          fadeStrength={1.4}
          infiniteGrid
        />
      ) : (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <planeGeometry args={[20000, 20000]} />
          <meshStandardMaterial color="#1c1b19" roughness={1} />
        </mesh>
      )}
      {OBJECTS.map((object) =>
        object.id === selected.id && form === 'voxels' ? (
          <VoxelObject key={object.id} object={object} cells={cells} cell={cell} height={b.max[1]} wireframe={wireframe} />
        ) : object.id === selected.id && form === 'mesh' ? (
          <MeshObject key={object.id} object={object} level={meshLevel} wireframe={wireframe} />
        ) : (
          <SmoothObject key={object.id} object={object} color={object.id === selected.id ? BONE : DIM_BONE} wireframe={wireframe} />
        ),
      )}
      {reference && ghostAt ? <SmoothObject object={ghostAt} color={GHOST} wireframe={false} opacity={0.75} /> : null}
      {dimensions && form !== 'mesh' ? <Dimensions object={selected} /> : null}
      {poles ? <DepthPoles spec={pole} /> : null}
      <CameraRig target={target} request={request} fov={fov} dolly={dolly} poles={pole} onView={onView} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={0.6} maxDistance={6000} maxPolarAngle={Math.PI * 0.495} autoRotate={autoRotate} autoRotateSpeed={AUTO_ROTATE_SPEED} />
    </>
  )
}
