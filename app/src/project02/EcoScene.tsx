import { Hud, OrbitControls, OrthographicCamera, useFBO } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef, type RefObject } from 'react'
import {
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
  type DirectionalLight,
  type Group,
  type HemisphereLight,
  type Mesh,
} from 'three'
import { advanceWaterTime } from '../project/materials.ts'
import { sunAt } from '../project/sun.ts'
import { AUTO_ROTATE_SPEED } from '../shared/ui/instrument.tsx'
import { WORLD_SCALE } from './core.ts'
import { CREATURES_ENABLED } from './creatures.ts'
import { senseKey } from './perception.ts'
import {
  addImpact,
  ARCH_RUBBLE,
  createCreatureMaterial,
  createEcoArchitecture,
  createEcoTerrain,
  createEcoVegetation,
  createEcoWater,
  createMarkerMaterial,
  setEcoArchitecture,
  setEcoTerrain,
  setEcoVegetation,
  setEcoWater,
  setWindUniforms,
} from './materials.ts'
import { ParallelWorlds } from './ParallelScene.tsx'
import { createPlantForms, disposePlantForms } from './plantForms.ts'
import { focusTarget, setLens, setLensScreen, setLodTelemetry, stepRuntime, takeImpacts, type Runtime } from './runtime.ts'
import { aimLensCamera, applySky, clearSky, createRig, lensWorldRadius, LIGHTING, renderLens, skyAt, stepRig } from './sceneControl.ts'
import {
  ArchChunks,
  CreatureInstances,
  FragmentInstances,
  Overlays,
  PlantInstances,
  RainField,
  RubbleInstances,
  WindTracers,
} from './sceneLayers.ts'
import { windSpeed } from './weather.ts'
import { windField, writeWindTexture } from './wind.ts'
import {
  disposeLine,
  LENS,
  ORBIT_DISTANCE,
  ORBIT_TARGET,
  QUALITY,
  SUN_MARKER_RADIUS,
  sunArc,
  type Quality,
  type SceneView,
} from './view.ts'

/** Architecture chunks rebuilt per frame at most; the rest wait their turn. */
const CHUNK_BUDGET = 4

/** Advances the world once per frame, before anything draws it. */
function SimDriver({ runtime }: { runtime: Runtime }) {
  useFrame((_, delta) => stepRuntime(runtime, delta), -2)
  return null
}

/** Sun, sky fill, background and fog from the hour and the weather. */
function SkyAndSun({ runtime, quality, wide }: { runtime: Runtime; quality: Quality; wide: boolean }) {
  const sun = useRef<DirectionalLight>(null)
  const hemi = useRef<HemisphereLight>(null)
  const marker = useRef<Mesh>(null)
  const scene = useThree((state) => state.scene)
  const get = useThree((state) => state.get)
  const frame = useRef(0)
  const { shadowMap, shadowEvery } = QUALITY[quality]
  useEffect(() => () => clearSky(scene), [scene])
  // The shadow map is redrawn every `shadowEvery` frames instead of on every render.
  useEffect(() => {
    const shadows = get().gl.shadowMap
    shadows.autoUpdate = false
    shadows.needsUpdate = true
    return () => {
      shadows.autoUpdate = true
    }
  }, [get])
  useEffect(() => {
    const shadow = sun.current?.shadow
    if (!shadow) return
    shadow.mapSize.set(shadowMap, shadowMap)
    shadow.map?.dispose()
    shadow.map = null
    get().gl.shadowMap.needsUpdate = true
  }, [get, shadowMap])
  useFrame((state) => {
    frame.current += 1
    if (frame.current % shadowEvery === 0) state.gl.shadowMap.needsUpdate = true
    const sky = skyAt(runtime)
    // Pulled back over the parallel worlds, fog keeps the depth it has at orbit distance.
    if (wide) sky.fogDensity *= Math.min(1, 40 / state.camera.position.length())
    applySky(scene, sky)
    const [dx, dy, dz] = sky.sun
    if (sun.current) {
      sun.current.position.set(dx * LIGHTING.sunDistance, dy * LIGHTING.sunDistance, dz * LIGHTING.sunDistance)
      sun.current.intensity = sky.sunIntensity
      sun.current.color.copy(sky.sunColor)
    }
    if (hemi.current) hemi.current.intensity = sky.sky
    if (marker.current) {
      marker.current.visible = sky.daylight > 0
      marker.current.position.set(dx * SUN_MARKER_RADIUS, dy * SUN_MARKER_RADIUS, dz * SUN_MARKER_RADIUS)
    }
  })
  return (
    <>
      <ambientLight intensity={LIGHTING.ambient} />
      <hemisphereLight ref={hemi} args={[LIGHTING.sky, LIGHTING.ground]} />
      <directionalLight
        ref={sun}
        castShadow
        shadow-mapSize={[shadowMap, shadowMap]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
        shadow-radius={2}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-camera-near={1}
        shadow-camera-far={120}
      />
      <mesh ref={marker}>
        <sphereGeometry args={[0.07, 16, 12]} />
        <meshBasicMaterial color={LIGHTING.sunDay} toneMapped={false} fog={false} />
      </mesh>
    </>
  )
}

/** The 0.2 landform, drawn at WORLD_SCALE (uniform, so slopes are unchanged). */
function Ground({ runtime, view, mesh }: { runtime: Runtime; view: SceneView; mesh: RefObject<Mesh | null> }) {
  const terrain = useMemo(
    () => createEcoTerrain(runtime.statics.base, runtime.textures.state, runtime.textures.perception),
    [runtime],
  )
  useEffect(() => () => terrain.material.dispose(), [terrain])
  useFrame(() =>
    setEcoTerrain(terrain, {
      sense: senseKey(view.way, view.creatureView),
      overlay: view.overlays,
      rain: runtime.eco.weather.rain,
      drought: runtime.eco.weather.drought,
      contours: view.terrain.contours,
      wireframe: view.terrain.wireframe,
      trail: view.trail,
      daylight: sunAt(runtime.viewHour, runtime.eco.noon).daylight,
    }),
  )
  return (
    <mesh
      ref={mesh}
      geometry={runtime.statics.base.landmass.geometry}
      material={terrain.material}
      scale={WORLD_SCALE}
      castShadow
      receiveShadow
    />
  )
}

/** 0.1's cobalt water, lifted by rain and lowered by drought, rippled by rain and falling blocks. */
function Water({ runtime, visible, contours }: { runtime: Runtime; visible: boolean; contours: boolean }) {
  const water = useMemo(() => createEcoWater(), [])
  const mesh = useRef<Mesh>(null)
  useEffect(() => () => water.material.dispose(), [water])
  useFrame((_, delta) => {
    advanceWaterTime(water, runtime.playing && !runtime.jumping ? delta : 0)
    setEcoWater(water, runtime.eco.weather.rain, contours)
    setWindUniforms(water.extra, runtime.textures.wind, windSpeed(runtime.eco.weather), runtime.eco.weather.windDir, runtime.motionTime)
    for (const impact of takeImpacts(runtime)) addImpact(water, impact.x, impact.z, impact.strength)
    if (mesh.current) mesh.current.position.y = runtime.eco.fields.waterOffset
  })
  return (
    <mesh ref={mesh} visible={visible} geometry={runtime.statics.base.water} material={water.material} scale={WORLD_SCALE} receiveShadow />
  )
}

function Architecture({ runtime, view }: { runtime: Runtime; view: SceneView }) {
  const surface = useMemo(() => createEcoArchitecture(), [])
  const chunks = useMemo(() => new ArchChunks(surface), [surface])
  const stone = useMemo(() => new MeshStandardMaterial({ color: ARCH_RUBBLE, roughness: 0.95 }), [])
  const rubble = useMemo(() => new RubbleInstances(stone), [stone])
  const fragments = useMemo(() => new FragmentInstances(stone), [stone])
  useEffect(
    () => () => {
      chunks.dispose()
      surface.material.dispose()
      surface.depthMaterial?.dispose()
    },
    [chunks, surface],
  )
  useEffect(
    () => () => {
      rubble.dispose()
      fragments.dispose()
      stone.dispose()
    },
    [rubble, fragments, stone],
  )
  useFrame(({ camera }) => {
    const { eco } = runtime
    setEcoArchitecture(
      surface,
      eco.clock,
      eco.arch.voxel,
      Math.min(1, eco.fields.archDamp + eco.weather.fog * 0.15),
      eco.fields.weatherDose / Math.max(24, eco.clock),
      senseKey(view.way, view.creatureView),
    )
    const built = chunks.update(
      eco.arch,
      camera.position,
      view.lod === 'auto' ? null : view.lod,
      CHUNK_BUDGET,
      view.representation,
      QUALITY[view.quality].lodScale,
    )
    setLodTelemetry(runtime, { archChunks: built.chunks, archTriangles: built.triangles })
    rubble.update(runtime)
    fragments.update(runtime)
  })
  return (
    <>
      <primitive object={chunks.object} />
      <primitive object={rubble.mesh} />
      <primitive object={fragments.mesh} />
    </>
  )
}

/** Plants, creatures and the marks each way of seeing attends to. */
function Life({ runtime, view }: { runtime: Runtime; view: SceneView }) {
  const forms = useMemo(() => createPlantForms(), [])
  const vegetation = useMemo(() => createEcoVegetation(), [])
  const plants = useMemo(() => new PlantInstances(forms, vegetation), [forms, vegetation])
  const body = useMemo(() => createCreatureMaterial(), [])
  const creatures = useMemo(() => new CreatureInstances(body), [body])
  const marker = useMemo(() => createMarkerMaterial(), [])
  const overlays = useMemo(() => new Overlays(marker), [marker])
  const frame = useRef(0)
  useEffect(
    () => () => {
      plants.dispose()
      disposePlantForms(forms)
      vegetation.material.dispose()
      vegetation.depthMaterial?.dispose()
    },
    [plants, forms, vegetation],
  )
  useEffect(
    () => () => {
      creatures.dispose()
      body.dispose()
      overlays.dispose()
      marker.dispose()
    },
    [creatures, body, overlays, marker],
  )
  useFrame(({ camera }) => {
    frame.current += 1
    const override = view.lod === 'auto' ? null : view.lod
    const target = view.way === 'world' ? null : focusTarget(runtime)
    const focus = target?.id ?? null
    const creatureFocus = target && (target.kind === 'ground' || target.kind === 'wader' || target.kind === 'flyer') ? target.id : null
    setEcoVegetation(vegetation, senseKey(view.way, view.creatureView))
    setWindUniforms(vegetation.uniforms, runtime.textures.wind, windSpeed(runtime.eco.weather), runtime.eco.weather.windDir, runtime.motionTime)
    if (frame.current % 3 === 0) {
      const { lodScale, plantShadows } = QUALITY[view.quality]
      const shown = plants.update(runtime, camera.position, override, view.layers, lodScale, plantShadows)
      setLodTelemetry(runtime, { plants: shown.plants, plantTriangles: shown.triangles })
    }
    const moving = CREATURES_ENABLED
      ? creatures.update(runtime, camera.position, override, creatureFocus)
      : { creatures: [0, 0, 0] as [number, number, number], triangles: 0 }
    setLodTelemetry(runtime, { creatures: moving.creatures, creatureTriangles: moving.triangles })
    overlays.update(runtime, view.way, view.creatureView, focus, view.overlays, !view.embodied)
  })
  return (
    <>
      <primitive object={plants.object} />
      {CREATURES_ENABLED ? <primitive object={creatures.object} visible={view.layers.creatures} /> : null}
      <primitive object={overlays.object} />
    </>
  )
}

/** Rain streaks and wind tracers; fog itself is the scene's depth fog set by SkyAndSun. */
function Weather({ runtime, showWind, quality }: { runtime: Runtime; showWind: boolean; quality: Quality }) {
  const rain = useMemo(() => new RainField(), [])
  const tracers = useMemo(() => new WindTracers(), [])
  useEffect(() => () => rain.dispose(), [rain])
  useEffect(() => () => tracers.dispose(), [tracers])
  useFrame((_, delta) => {
    // Weather stands still with the world while paused.
    const step = runtime.playing && !runtime.jumping ? Math.min(delta, 0.1) : 0
    const { eco } = runtime
    writeWindTexture(runtime.textures.wind, windField(runtime.statics, eco.weather, eco.arch, eco.clock))
    rain.update(runtime, step, QUALITY[quality].rain)
    tracers.update(runtime, step, showWind, QUALITY[quality].tracers)
  })
  return (
    <>
      <primitive object={rain.object} />
      <primitive object={tracers.object} />
    </>
  )
}

/** The sun's arc. The falls drop into the dark void below; nothing is drawn under the island. */
function SunArcLine({ noon }: { noon: number }) {
  const arc = useMemo(() => sunArc(noon), [noon])
  useEffect(() => () => disposeLine(arc), [arc])
  return <primitive object={arc} />
}

/** Embodied perspective: carries the camera into the focused entity's view. */
function CameraRig({ runtime, embodied }: { runtime: Runtime; embodied: boolean }) {
  const rig = useRef(createRig())
  const controls = useThree((state) => state.controls) as unknown as Parameters<typeof stepRig>[3]
  useFrame(({ camera }, delta) => stepRig(rig.current, runtime, camera, controls, embodied, Math.min(delta, 0.1)))
  return null
}

type LensPointer = {
  hover: boolean
  x: number
  y: number
  moved: boolean
  down: { x: number; y: number } | null
  hit: Vector3 | null
  pinned: Vector3 | null
}

/** Hours of world time per turn of the lens dial's hands. */
const DIAL_HOURS = 6

/**
 * The observation lens: a magnifier at the cursor. It shows the same view
 * magnified, and tells the runtime where it rests so the world inside runs
 * slow and the overlays draw their fine detail there. A dial on its rim
 * shows the difference: the pale hand turns with the world's time, the
 * amber hand with the time inside. Click pins it to the ground; click again
 * to let it follow the cursor.
 */
function Loupe({ runtime, ground, quality }: { runtime: Runtime; ground: RefObject<Mesh | null>; quality: Quality }) {
  const gl = useThree((state) => state.gl)
  const size = useThree((state) => state.size)
  const dpr = useThree((state) => state.viewport.dpr)
  const target = useFBO(Math.round(LENS.size * dpr), Math.round(LENS.size * dpr))
  const camera = useMemo(() => new PerspectiveCamera(), [])
  const raycaster = useMemo(() => new Raycaster(), [])
  const group = useRef<Group>(null)
  const outside = useRef<Group>(null)
  const inside = useRef<Group>(null)
  const dial = useRef({ last: -1, inside: 0 })
  const pointer = useRef<LensPointer>({ hover: false, x: 0, y: 0, moved: false, down: null, hit: null, pinned: null })
  const frame = useRef(0)

  useEffect(() => {
    const el = gl.domElement
    const p = pointer.current
    const local = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    const move = (event: PointerEvent) => {
      const at = local(event)
      p.hover = true
      p.x = at.x
      p.y = at.y
      p.moved = true
    }
    const leave = () => {
      p.hover = false
    }
    const down = (event: PointerEvent) => {
      p.down = local(event)
    }
    const up = (event: PointerEvent) => {
      const at = local(event)
      if (p.down && Math.hypot(at.x - p.down.x, at.y - p.down.y) < 5) p.pinned = p.pinned ? null : (p.hit?.clone() ?? null)
      p.down = null
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointerup', up)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointerup', up)
      setLens(runtime, null)
      setLensScreen(runtime, null)
    }
  }, [gl, runtime])

  useFrame(({ gl: renderer, scene, camera: main }) => {
    frame.current += 1
    const p = pointer.current
    const view = main as PerspectiveCamera
    if (p.hover && !p.pinned && (p.moved || frame.current % 4 === 0) && ground.current) {
      p.moved = false
      raycaster.setFromCamera(ndc.set((p.x / size.width) * 2 - 1, 1 - (p.y / size.height) * 2), view)
      p.hit = raycaster.intersectObject(ground.current, false)[0]?.point.clone() ?? null
    }
    const anchor = p.pinned ?? (p.hover ? p.hit : null)
    const shown = p.pinned !== null || p.hover
    if (group.current) group.current.visible = shown
    if (!shown) {
      setLens(runtime, null)
      setLensScreen(runtime, null)
      return
    }
    if (p.pinned) {
      projected.copy(p.pinned).project(view)
      cursor.x = ((projected.x + 1) / 2) * size.width
      cursor.y = ((1 - projected.y) / 2) * size.height
    } else {
      cursor.x = p.x
      cursor.y = p.y
    }
    if (anchor) {
      const radius = lensWorldRadius(view, view.position.distanceTo(anchor), size.height, LENS.zoom, LENS.size)
      setLens(runtime, { x: anchor.x, z: anchor.z, radius: Math.min(LENS.maxRadius, Math.max(LENS.minRadius, radius)), slow: LENS.slow })
    } else setLens(runtime, null)
    group.current?.position.set(cursor.x - size.width / 2, size.height / 2 - cursor.y, 0)
    setLensScreen(runtime, { x: cursor.x, y: cursor.y, size: LENS.size, pinned: p.pinned !== null })
    const clock = runtime.eco.clock
    const d = dial.current
    if (d.last >= 0) d.inside += Math.max(0, clock - d.last) * (anchor ? LENS.slow : 1)
    d.last = clock
    if (outside.current) outside.current.rotation.z = -((clock % DIAL_HOURS) / DIAL_HOURS) * Math.PI * 2
    if (inside.current) inside.current.rotation.z = -((d.inside % DIAL_HOURS) / DIAL_HOURS) * Math.PI * 2
    if (frame.current % QUALITY[quality].lensEvery) return
    aimLensCamera(camera, view, cursor, size, LENS.zoom, LENS.size)
    renderLens(renderer, scene, camera, target)
  })

  const r = LENS.size / 2
  return (
    <Hud renderPriority={1}>
      <OrthographicCamera makeDefault position={[0, 0, 10]} />
      <group ref={group} visible={false}>
        <mesh>
          <circleGeometry args={[r, 72]} />
          <meshBasicMaterial map={target.texture} />
        </mesh>
        <mesh>
          <ringGeometry args={[r, r + 1.5, 72]} />
          <meshBasicMaterial color="#f4efe2" toneMapped={false} />
        </mesh>
        <group position={[r * 0.7, r * 0.7, 0]}>
          <mesh>
            <circleGeometry args={[DIAL.radius, 40]} />
            <meshBasicMaterial color="#07080a" transparent opacity={0.72} />
          </mesh>
          <mesh>
            <ringGeometry args={[DIAL.radius, DIAL.radius + 1.2, 40]} />
            <meshBasicMaterial color="#f4efe2" toneMapped={false} />
          </mesh>
          <group ref={outside}>
            <mesh position={[0, DIAL.radius * 0.42, 0]}>
              <planeGeometry args={[1.6, DIAL.radius * 0.84]} />
              <meshBasicMaterial color="#f4efe2" toneMapped={false} />
            </mesh>
          </group>
          <group ref={inside}>
            <mesh position={[0, DIAL.radius * 0.32, 0]}>
              <planeGeometry args={[2.6, DIAL.radius * 0.64]} />
              <meshBasicMaterial color="#ffb347" toneMapped={false} />
            </mesh>
          </group>
        </group>
      </group>
    </Hud>
  )
}

const DIAL = { radius: 28 } as const
const ndc = new Vector2()
const projected = new Vector3()
const cursor = { x: 0, y: 0 }

/** Memoised: the panel's stats refresh re-renders the page several times a second; the scene only needs its props. */
export const EcoScene = memo(function EcoScene({ runtime, view, noon }: { runtime: Runtime; view: SceneView; noon: number }) {
  const ground = useRef<Mesh>(null)
  return (
    <>
      <SimDriver runtime={runtime} />
      <SkyAndSun runtime={runtime} quality={view.quality} wide={view.parallel.open || view.parallel.worlds.length > 0} />
      <Ground runtime={runtime} view={view} mesh={ground} />
      <Water runtime={runtime} visible contours={view.terrain.contours} />
      <Architecture runtime={runtime} view={view} />
      <Life runtime={runtime} view={view} />
      <Weather runtime={runtime} showWind={view.windField} quality={view.quality} />
      <SunArcLine noon={noon} />
      <CameraRig runtime={runtime} embodied={view.embodied} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        target={ORBIT_TARGET}
        minDistance={ORBIT_DISTANCE.min}
        maxDistance={view.parallel.open ? ORBIT_DISTANCE.parallel : ORBIT_DISTANCE.max}
        autoRotate={view.autoRotate && !view.embodied}
        autoRotateSpeed={AUTO_ROTATE_SPEED}
      />
      <ParallelWorlds runtime={runtime} parallel={view.parallel} quality={view.quality} />
      {view.lens ? <Loupe runtime={runtime} ground={ground} quality={view.quality} /> : null}
    </>
  )
})

