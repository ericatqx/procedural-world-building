import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type ComponentRef } from 'react'
import { Vector3, type BufferGeometry } from 'three'
import { AUTO_ROTATE_SPEED } from '../shared/ui/instrument.tsx'
import {
  architectureGeometry,
  creatureGeometry,
  EXTENT,
  groundGeometry,
  sampleHeight,
  SUN,
  understoryGeometry,
  waterGeometry,
  type ArchitectureWorld,
} from './architecture.ts'
import type { LivingView } from './LivingStage.tsx'

/**
 * Concept Lab — living-architecture stage. Overview and Explore are two rigs
 * on one canvas. Distances match the simulation: meters, with the eye at
 * the height of a person.
 */

const BACKGROUND = '#050608'
const FOG = '#11141a'
const TISSUE = '#d7e2c4'
const LEAF = '#5f7d4a'
const ANIMAL = '#c4a27a'
const SUN_COLOR = '#fff6e4'

const OVERVIEW_POSITION = new Vector3(-4.4, 4.6, 6.8)
const OVERVIEW_TARGET = new Vector3(0.45, 1.2, -0.35)

function CameraRig({ view, world, autoRotate }: { view: LivingView; world: ArchitectureWorld; autoRotate: boolean }) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const overview = useRef({
    px: OVERVIEW_POSITION.x,
    py: OVERVIEW_POSITION.y,
    pz: OVERVIEW_POSITION.z,
    tx: OVERVIEW_TARGET.x,
    ty: OVERVIEW_TARGET.y,
    tz: OVERVIEW_TARGET.z,
  })
  const explore = useRef({ x: 3.4, z: 1.0, yaw: 1.1, pitch: -0.24 })
  const keys = useRef({ forward: 0, strafe: 0 })
  const dragging = useRef(false)

  useLayoutEffect(() => {
    if (view !== 'overview') return
    const pose = overview.current
    camera.position.set(pose.px, pose.py, pose.pz)
    controls.current?.target.set(pose.tx, pose.ty, pose.tz)
    controls.current?.update()
  }, [camera, view])

  useEffect(() => {
    if (view !== 'explore') return
    const held = new Set<string>()
    const drive: Record<string, 'forward' | 'strafe'> = {
      w: 'forward',
      arrowup: 'forward',
      s: 'forward',
      arrowdown: 'forward',
      a: 'strafe',
      arrowleft: 'strafe',
      d: 'strafe',
      arrowright: 'strafe',
    }
    const negative = new Set(['s', 'arrowdown', 'a', 'arrowleft'])
    const emit = () => {
      let forward = 0
      let strafe = 0
      for (const key of held) {
        const axis = drive[key]
        const sign = negative.has(key) ? -1 : 1
        if (axis === 'forward') forward += sign
        if (axis === 'strafe') strafe += sign
      }
      keys.current.forward = Math.max(-1, Math.min(1, forward))
      keys.current.strafe = Math.max(-1, Math.min(1, strafe))
    }
    const editable = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (!(key in drive) || event.metaKey || event.ctrlKey || event.altKey || editable(event.target)) return
      event.preventDefault()
      held.add(key)
      emit()
    }
    const up = (event: KeyboardEvent) => {
      if (held.delete(event.key.toLowerCase())) emit()
    }
    const clear = () => {
      held.clear()
      emit()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
      keys.current.forward = 0
      keys.current.strafe = 0
    }
  }, [view])

  useEffect(() => {
    if (view !== 'explore') return
    const element = gl.domElement
    let lastX = 0
    let lastY = 0
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      dragging.current = true
      lastX = event.clientX
      lastY = event.clientY
    }
    const move = (event: PointerEvent) => {
      if (!dragging.current) return
      explore.current.yaw -= (event.clientX - lastX) * 0.005
      explore.current.pitch = Math.max(-0.55, Math.min(0.45, explore.current.pitch - (event.clientY - lastY) * 0.004))
      lastX = event.clientX
      lastY = event.clientY
    }
    const up = () => {
      dragging.current = false
    }
    element.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      element.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      dragging.current = false
    }
  }, [gl, view])

  useFrame((_, delta) => {
    const dt = Math.min(0.05, delta)
    if (viewRef.current === 'overview') {
      const orbit = controls.current
      if (!orbit) return
      overview.current.px = camera.position.x
      overview.current.py = camera.position.y
      overview.current.pz = camera.position.z
      overview.current.tx = orbit.target.x
      overview.current.ty = orbit.target.y
      overview.current.tz = orbit.target.z
      return
    }
    const pose = explore.current
    const fx = -Math.sin(pose.yaw)
    const fz = -Math.cos(pose.yaw)
    const rx = Math.cos(pose.yaw)
    const rz = -Math.sin(pose.yaw)
    const speed = 2.6 * dt
    pose.x = Math.max(-EXTENT * 0.9, Math.min(EXTENT * 0.9, pose.x + (fx * keys.current.forward + rx * keys.current.strafe) * speed))
    pose.z = Math.max(-EXTENT * 0.9, Math.min(EXTENT * 0.9, pose.z + (fz * keys.current.forward + rz * keys.current.strafe) * speed))
    const y = sampleHeight(world.heights, pose.x, pose.z) + 1.6
    const look = Math.cos(pose.pitch)
    camera.position.set(pose.x, y, pose.z)
    camera.up.set(0, 1, 0)
    camera.lookAt(pose.x + fx * look, y + Math.sin(pose.pitch), pose.z + fz * look)
  })

  return (
    <OrbitControls
      ref={controls}
      target={OVERVIEW_TARGET}
      enabled={view === 'overview'}
      autoRotate={view === 'overview' && autoRotate}
      autoRotateSpeed={AUTO_ROTATE_SPEED}
      enableDamping
      minDistance={3}
      maxDistance={26}
    />
  )
}

export function ArchitectureStage({
  world,
  revision,
  wireframe,
  autoRotate,
  view,
}: {
  world: ArchitectureWorld
  revision: number
  wireframe: boolean
  autoRotate: boolean
  view: LivingView
}) {
  const ground = useMemo(() => groundGeometry(world), [world, revision])
  const water = useMemo(() => waterGeometry(world), [world, revision])
  const plants = useMemo(() => understoryGeometry(world), [world, revision])
  const organisms = useMemo(() => architectureGeometry(world), [world, revision])
  const creatures = useMemo(() => creatureGeometry(world), [world, revision])

  useEffect(
    () => () => {
      ground.dispose()
      water.dispose()
      plants.dispose()
      organisms.dispose()
      creatures.dispose()
    },
    [ground, water, plants, organisms, creatures],
  )

  return (
    <Canvas
      className="world-canvas"
      camera={{ position: [OVERVIEW_POSITION.x, OVERVIEW_POSITION.y, OVERVIEW_POSITION.z], fov: 40, near: 0.08, far: 80 }}
      gl={{ antialias: true }}
      dpr={[1, 1.5]}
      shadows
    >
      <color attach="background" args={[BACKGROUND]} />
      <fog attach="fog" args={[FOG, 16, 42]} />
      <ambientLight intensity={0.22} />
      <hemisphereLight args={['#d5dbe6', '#2a241c', 0.32]} />
      <directionalLight
        position={[SUN[0] * 18, SUN[1] * 18, SUN[2] * 18]}
        intensity={2.8}
        color={SUN_COLOR}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={2}
        shadow-camera-far={40}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      <mesh geometry={ground} castShadow receiveShadow>
        <meshStandardMaterial color="#ffffff" roughness={1} metalness={0} wireframe={wireframe} vertexColors />
      </mesh>
      <mesh geometry={water} renderOrder={2}>
        <meshStandardMaterial color="#9ec4cc" transparent opacity={0.88} roughness={0.12} metalness={0.02} depthWrite={false} wireframe={wireframe} />
      </mesh>
      <Body geometry={plants} color={LEAF} wireframe={wireframe} />
      <Body geometry={organisms} color={TISSUE} wireframe={wireframe} />
      <Body geometry={creatures} color={ANIMAL} wireframe={wireframe} />
      <CameraRig view={view} world={world} autoRotate={autoRotate} />
    </Canvas>
  )
}

function Body({ geometry, color, wireframe }: { geometry: BufferGeometry; color: string; wireframe: boolean }) {
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={0.82} metalness={0} wireframe={wireframe} />
    </mesh>
  )
}
