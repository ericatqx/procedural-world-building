import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Color, type DirectionalLight, type MeshStandardMaterial } from 'three'
import { sunAt } from '../project/sun.ts'
import { syncStyleSwitches } from '../project03/visualStyle.ts'
import { setStudy02, study02Now } from '../project03/visualStudy02.ts'
import { MAIN_VISUAL } from '../project03/visualFilters.tsx'
import { worldsUniforms } from '../project03/visualStudyWorlds.ts'
import { worldPlantMaterial } from '../project03/worldMaterials.ts'
import type { SegmentOption } from './ui/instrument.tsx'

/**
 * THE LABS' WORLD LOOK. By default a Lab draws its organisms as the island draws them: the island's own materials (worldMaterials.ts) under the
 * island's main visual (the Graphic Diorama on its Black Stage) and the island's light, worked out the way Sky.tsx works it out for an hour of the
 * day. So the colours, the form shading, the lavender of a CAST shadow (only where the sun is blocked: here, by the plant or animal itself and on
 * the ground under it) and the cool, dim night are the island's, not a studio's. Studio is the neutral technical view (the old Lab light).
 *
 * What is shared and what is not: the material, the shader finish and the light model are the island's code. The ground here is a plain disc of
 * meadow, not the island's terrain (which needs the island's ground textures), and there is no fog, cloud or mist.
 */
export type Look = 'world' | 'studio'
export type Hour = 'day' | 'golden' | 'night'

export const LOOKS: SegmentOption<Look>[] = [
  { value: 'world', label: 'World' },
  { value: 'studio', label: 'Studio' },
]
export const HOURS: SegmentOption<Hour>[] = [
  { value: 'day', label: 'Day' },
  { value: 'golden', label: 'Golden' },
  { value: 'night', label: 'Night' },
]
const HOUR: Record<Hour, number> = { day: 10.5, golden: 17.6, night: 22.5 }
/** The island's noon sun height (environment.ts, its default). */
const NOON = 55
/** The Labs face the subject from +z. The sun stands to the camera's left and a little in front (the azimuth is the Lab's; the height is the hour's). */
const AZIMUTH = -0.85

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** The sun of an hour, as the island has it (height, daylight), placed at the Lab's azimuth. */
function labSun(hour: Hour) {
  const s = sunAt(HOUR[hour], NOON)
  const el = (s.elevation * Math.PI) / 180
  const y = Math.sin(el)
  const flat = Math.cos(el)
  return { elevation: s.elevation, daylight: s.daylight, direction: [Math.sin(AZIMUTH) * flat, y, Math.cos(AZIMUTH) * flat] as [number, number, number] }
}

/**
 * The island's light for one hour, on a Lab's stage: the key (the sun, casting the shadows the island's finish reads), the fill, the moon and the
 * sky, at the intensities Sky.tsx gives them for that hour on a clear day; and the main visual switched on for the island's materials.
 */
export function WorldLight({ hour, reach, centre = [0, 0, 0] }: { hour: Hour; reach: number; centre?: [number, number, number] }) {
  const gl = useThree((s) => s.gl)
  const key = useRef<DirectionalLight>(null)
  const sun = useMemo(() => labSun(hour), [hour])

  useLayoutEffect(() => {
    // (The switch is the island's too, module-wide: what was set when the Lab opened is given back when it closes. Setting 'original' here left the
    // island, which picks its main visual only once on its first mount, drawn in the unstyled look after a visit to a Lab.)
    const was = study02Now()
    setStudy02(MAIN_VISUAL)
    syncStyleSwitches()
    const before = gl.toneMappingExposure
    gl.toneMappingExposure = 1.05
    return () => {
      setStudy02(was)
      syncStyleSwitches()
      gl.toneMappingExposure = before
    }
  }, [gl])

  useEffect(() => {
    const [dx, dy, dz] = sun.direction
    worldsUniforms.uWDay.value = sun.daylight
    worldsUniforms.uWElev.value = sun.elevation
    worldsUniforms.uWCloud.value = 0
    const lift = Math.max(dy, Math.sin((2 * Math.PI) / 180))
    const h = Math.hypot(dx, dz) || 1
    const flat = Math.sqrt(1 - lift * lift)
    worldsUniforms.uWSun.value.set((dx / h) * flat, lift, (dz / h) * flat)
  }, [sun])

  useFrame(() => {
    syncStyleSwitches()
    const light = key.current
    if (!light) return
    const [dx, dy, dz] = sun.direction
    const d = Math.max(4, reach * 4)
    light.position.set(centre[0] + dx * d, centre[1] + Math.max(0.05, dy) * d, centre[2] + dz * d)
    light.target.position.set(centre[0], centre[1], centre[2])
    light.target.updateMatrixWorld()
  })

  const e = sun.elevation
  const direct = sun.daylight
  const keyI = Math.PI * 1.06 * direct * (1 - 0.14 * smoothstep(30, 58, e))
  const fillI = Math.PI * 0.32 * (0.1 + 0.9 * sun.daylight) * (1 - 0.55 * smoothstep(28, 58, e))
  const moonI = Math.PI * 0.14 * (1 - sun.daylight)
  const skyI = 0.3 - 0.2 * sun.daylight
  const r = Math.max(1, reach)
  return (
    <>
      <color attach="background" args={['#000000']} />
      <directionalLight
        ref={key}
        color="#fff8ee"
        intensity={keyI}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-r}
        shadow-camera-right={r}
        shadow-camera-top={r}
        shadow-camera-bottom={-r}
        shadow-camera-near={0.1}
        shadow-camera-far={r * 12}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-intensity={0.96}
      />
      <directionalLight position={[-0.42, 0.75, 0.51]} color="#c6cede" intensity={moonI} />
      <directionalLight position={[0.72, 0.36, 0.53]} color="#bcbfc0" intensity={fillI} />
      <hemisphereLight args={['#c2c0ba', '#3f3a33', skyI]} />
    </>
  )
}

/** The studio light the Labs had: neutral, even, for reading form and geometry. */
export function StudioLight({ reach }: { reach: number }) {
  const r = Math.max(1, reach)
  return (
    <>
      <color attach="background" args={['#000000']} />
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#c9cfdc', '#1a1917', 0.65]} />
      <directionalLight position={[4, 9, 5]} intensity={2.3} color="#fff8ec" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-r} shadow-camera-right={r} shadow-camera-top={r} shadow-camera-bottom={-r} shadow-camera-near={0.1} shadow-camera-far={r * 12} shadow-bias={-0.0004} shadow-normalBias={0.02} />
      <directionalLight position={[-6, 3, -4]} intensity={0.55} color="#aeb8cf" />
    </>
  )
}

/**
 * The ground under a Lab's subject. World: a disc of the island's meadow, drawn with the island's plant finish so it takes the same palette, light
 * and lavender cast shadow as the plants on it. Studio: the dark neutral floor.
 */
export function LabGround({ look, radius = 40 }: { look: Look; radius?: number }) {
  const meadow = useMemo(() => {
    const m = worldPlantMaterial(false)
    m.vertexColors = false
    m.color = new Color('#6c7b52')
    m.side = 0
    return m
  }, [])
  useEffect(() => () => meadow.dispose(), [meadow])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
      <circleGeometry args={[radius, 96]} />
      {look === 'world' ? <primitive object={meadow as MeshStandardMaterial} attach="material" /> : <meshStandardMaterial color="#1c1b19" roughness={1} />}
    </mesh>
  )
}
