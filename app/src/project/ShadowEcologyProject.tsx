import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BufferGeometry, Line, LineBasicMaterial, LineLoop, Vector3 } from 'three'
import { createVegetationForms, disposeVegetationForms } from './botany.ts'
import {
  DEFAULT_HABITAT_RULE,
  HABITAT_RULE_RANGE,
  MEMORY_DAYS,
  SUITABLE,
  suitableShare,
  type HabitatRule,
} from './habitat.ts'
import {
  advanceWaterTime,
  createArchitectureMaterial,
  createPathMaterial,
  createTerrainMaterial,
  createVegetationMaterial,
  createWaterMaterial,
  setArchitectureClock,
  setTerrainDisplay,
  setWaterContours,
} from './materials.ts'
import {
  advanceSimulation,
  createSimulation,
  fastForward,
  refreshEcology,
  restoreSimulation,
  snapshotSimulation,
  type Ecology,
  type Simulation,
  type SimulationArrays,
  type SimulationTotals,
} from './simulation.ts'
import { formatHour, sunAt, sunPath } from './sun.ts'
import { ISLAND_RADIUS } from './terrain.ts'
import { createBaseWorld, type BaseWorld } from './world.ts'
import {
  AUTO_ROTATE_SPEED,
  ControlField,
  ExerciseHeading,
  InfoLabel,
  InstrumentPanel,
  PanelSection,
  Segmented,
  Slider,
  Toggle,
  ViewTools,
  type ExerciseAbout,
  type SegmentOption,
} from '../shared/ui/instrument.tsx'
import { LearnToggle, LearnTour } from '../shared/ui/learn.tsx'
import { PageSnapshots, type PageSnapshotAdapter } from '../shared/ui/PageSnapshots.tsx'
import {
  bytesOf,
  payloadField,
  readFloat32,
  readInt16,
  readUint32,
  readUint8,
} from '../shared/persistence/codec.ts'
import { useShortcuts } from '../shared/ui/shortcuts.ts'
import { createProjectGuideSteps } from './guideSteps.tsx'
import { ObservationPlate, PlateFocus } from './ObservationPlate.tsx'
import '../shared/ui/system.css'
import './project.css'

const SCENE_BG = '#000000'
const AMBIENT_INTENSITY = 0.2
const SUN_INTENSITY = 3
const SUN_COLOR = '#fff8ec'
/**
 * Sky fill that rises as the sun sets, so form still reads at night. A
 * hemisphere light, not a second directional one: the habitat lights chunk
 * reads the sun as the only directional light.
 */
const SKY_FILL = { day: 0.12, night: 0.55, sky: '#c9cfdc', ground: '#1a1917' } as const
const SUN_LIGHT_DISTANCE = 12
const SUN_MARKER_RADIUS = 5
const GUIDE_COLOR = '#e9e6df'
const SUN_PATH_OPACITY = 0.22
/** A faint ring on the floor around the specimen, like a plate outline. */
const PLATE_RING_GAP = 0.6
const PLATE_RING_OPACITY = 0.18
const FLOOR_SIZE = 18
/** How far the floor sits below the underside, so the landmass reads as floating. */
const FLOOR_GAP = 0.8
const SHADOW_OPACITY = 0.35
const SHADOW_EXTENT = 6
const HOURS_PER_SECOND = 1
/** Longest step one frame may advance, so a stalled tab does not jump a day. */
const MAX_FRAME_SECONDS = 0.1
const START_HOUR = 15.5
const START_NOON = 60
/** Growth and decay rate multiplier range. */
const RATE = { min: 0.25, max: 4, step: 0.25, start: 1 } as const
/** Wait for the clock and noon slider to settle before re-tracing daily light. */
const SETTLE_MS = 250
const DAY_PRESETS = [1, 10, 50, 100] as const
const CAMERA_POSITION: [number, number, number] = [6.4, 3.1, 7.6]
const ORBIT_TARGET: [number, number, number] = [0, -0.5, 0]

const ABOUT: ExerciseAbout = {
  text: 'Shadow Ecology, prototype 0.1: shadow slowly reshapes where future shade-dependent creatures could live. Under a moving sun, architecture seeds on well-lit ground by the water and grows toward the light, and every block casts new shadow. Far more slowly, weather wears old blocks away, most where the form is open, high or overhanging, so structures turn over rather than grow forever. Habitat lags the shadow: each sunset a full day’s sunlight is estimated from the structure as it stands and blended into a few days’ sunlight memory, weighed with moisture and footing. Vegetation favours sunlit, moist, gentle ground, while habitat favours accumulated shelter; the two may overlap. Water drains into lakes and falls off the rim; paths wear routes between the sites, water, vegetation and habitat. Click a layer name for its rule; the observation plate draws the same world in plan, and enlarges when clicked.',
  terms: 'light → growth → shadow → habitat · drainage · least-cost path · suitability · procedural material',
  controls: 'P play day · G grow · drag orbit · scroll zoom · Esc leaves the plate',
}

type View = 'world' | 'field'

/** Multiplies world time while playing. */
type Speed = '1' | '2' | '4' | '8'

const SPEED_OPTIONS: SegmentOption<Speed>[] = [
  { value: '1', label: '1×' },
  { value: '2', label: '2×' },
  { value: '4', label: '4×' },
  { value: '8', label: '8×' },
]

const VIEW_OPTIONS: SegmentOption<View>[] = [
  { value: 'world', label: 'World' },
  { value: 'field', label: 'Field only' },
]

type Layers = { water: boolean; paths: boolean; vegetation: boolean; habitat: boolean }

/** Terrain drawing options in the view strip, as in Week 03. */
type TerrainView = { contours: boolean; wireframe: boolean }

const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/**
 * The world: terrain (carrying the habitat marks), architecture, water, paths
 * and vegetation, each with its own material. `fieldOnly` strengthens the
 * habitat field and clears paths and vegetation off it.
 */
function ProjectWorld({
  base,
  architecture,
  clock,
  ecology,
  fieldOnly,
  layers,
  terrainView,
}: {
  base: BaseWorld
  architecture: BufferGeometry
  /** Simulated hours since Reset; the architecture material ages blocks against it. */
  clock: number
  ecology: Ecology
  fieldOnly: boolean
  layers: Layers
  terrainView: TerrainView
}) {
  const surfaces = useMemo(
    () => ({
      terrain: createTerrainMaterial(base.field, base.habitatField, base.fieldExtent),
      architecture: createArchitectureMaterial(base.field, base.fieldExtent),
    }),
    [base],
  )
  const water = useMemo(() => createWaterMaterial(), [])
  const pathMaterial = useMemo(() => createPathMaterial(), [])
  const vegetationMaterial = useMemo(() => createVegetationMaterial(), [])
  const { plants, paths } = ecology
  const vegetation = useMemo(
    () => createVegetationForms(plants, vegetationMaterial, base.hydrology, base.groundHeight),
    [plants, vegetationMaterial, base],
  )

  useEffect(
    () => () => {
      for (const surface of Object.values(surfaces)) {
        surface.material.dispose()
      }
    },
    [surfaces],
  )
  useEffect(
    () => () => {
      water.material.dispose()
      pathMaterial.dispose()
      vegetationMaterial.dispose()
    },
    [water, pathMaterial, vegetationMaterial],
  )
  useEffect(() => () => disposeVegetationForms(vegetation), [vegetation])
  useEffect(() => () => architecture.dispose(), [architecture])
  useEffect(() => () => paths.dispose(), [paths])

  useLayoutEffect(() => setArchitectureClock(surfaces.architecture, clock), [surfaces, clock])

  useLayoutEffect(
    () =>
      setTerrainDisplay(surfaces.terrain, {
        habitat: layers.habitat,
        fieldOnly,
        contours: terrainView.contours,
        wireframe: terrainView.wireframe,
      }),
    [surfaces, layers.habitat, fieldOnly, terrainView.contours, terrainView.wireframe],
  )

  useLayoutEffect(() => setWaterContours(water, terrainView.contours), [water, terrainView.contours])

  useFrame((_, delta) => advanceWaterTime(water, delta))

  return (
    <>
      <mesh
        geometry={base.landmass.geometry}
        material={surfaces.terrain.material}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={architecture}
        material={surfaces.architecture.material}
        castShadow
        receiveShadow
      />
      {layers.water ? <mesh geometry={base.water} material={water.material} receiveShadow /> : null}
      {layers.paths && !fieldOnly ? <mesh geometry={paths} material={pathMaterial} receiveShadow /> : null}
      {layers.vegetation && !fieldOnly ? <primitive object={vegetation} /> : null}
    </>
  )
}

/** A system's rule at a glance: what it reads, what it does, what it makes, and its state now. */
function SystemCard({
  inputs,
  rule,
  output,
  now,
}: {
  inputs: string
  rule: string
  output: string
  now: string
}) {
  return (
    <span className="system-card">
      {(
        [
          ['Inputs', inputs],
          ['→ Rule', rule],
          ['→ Output', output],
          ['Now', now],
        ] as const
      ).map(([key, text]) => (
        <span key={key} className="system-card-row">
          <span className="system-card-key">{key}</span>
          <span>{text}</span>
        </span>
      ))}
    </span>
  )
}

/** A layer row: the name opens the system card; the checkbox, when given, shows or hides it. */
function SystemRow({
  title,
  summary,
  card,
  tone,
  checked,
  onChange,
}: {
  title: string
  summary: string
  card: ReactNode
  tone?: 'water'
  checked?: boolean
  onChange?: (next: boolean) => void
}) {
  return (
    <div className="system-row" data-tone={tone}>
      <InfoLabel title={title} tip={card} className="system-row-title" />
      <span className="system-row-summary">{summary}</span>
      {onChange ? (
        <input
          type="checkbox"
          className="system-row-toggle"
          aria-label={`Show ${title}`}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
      ) : null}
    </div>
  )
}

/** A thin neutral line through `points`; closed into a loop when `loop` is set. */
function GuideLine({
  points,
  opacity,
  loop = false,
}: {
  points: [number, number, number][]
  opacity: number
  loop?: boolean
}) {
  const line = useMemo(() => {
    const geometry = new BufferGeometry().setFromPoints(
      points.map(([x, y, z]) => new Vector3(x, y, z)),
    )
    const material = new LineBasicMaterial({ color: GUIDE_COLOR, transparent: true, opacity })
    return loop ? new LineLoop(geometry, material) : new Line(geometry, material)
  }, [points, opacity, loop])

  useEffect(
    () => () => {
      line.geometry.dispose()
      line.material.dispose()
    },
    [line],
  )

  return <primitive object={line} />
}

function circlePoints(radius: number, y: number, samples = 128): [number, number, number][] {
  return Array.from({ length: samples }, (_, i) => {
    const angle = (2 * Math.PI * i) / samples
    return [radius * Math.cos(angle), y, radius * Math.sin(angle)]
  })
}

/**
 * Calls `onAdvance` with the world hours each animation frame adds while
 * `playing`, `speed` times faster than 1×. Everything downstream (sun,
 * growth ticks, shadow, habitat, sunset refresh) runs on those hours, so it
 * stays in step at any speed.
 */
function usePlayClock(playing: boolean, speed: number, onAdvance: (hours: number) => void) {
  const advanceRef = useRef(onAdvance)
  useLayoutEffect(() => {
    advanceRef.current = onAdvance
  })
  useEffect(() => {
    if (!playing) {
      return
    }
    let last = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const seconds = Math.min((now - last) / 1000, MAX_FRAME_SECONDS)
      last = now
      advanceRef.current(seconds * HOURS_PER_SECOND * speed)
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, speed])
}

export function ShadowEcologyProject() {
  const [hour, setHour] = useState(START_HOUR)
  const hourRef = useRef(START_HOUR)
  const [noonElevation, setNoonElevation] = useState(START_NOON)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>('1')
  const [growing, setGrowing] = useState(true)
  const [rate, setRate] = useState<number>(RATE.start)
  const [decaying, setDecaying] = useState(true)
  const [decayRate, setDecayRate] = useState<number>(RATE.start)
  const [rule, setRule] = useState<HabitatRule>(DEFAULT_HABITAT_RULE)
  const [view, setView] = useState<View>('world')
  const [terrainView, setTerrainView] = useState<TerrainView>({ contours: false, wireframe: false })
  const [autoRotate, setAutoRotate] = useState(false)
  const [plateExpanded, setPlateExpanded] = useState(false)
  const closePlate = useCallback(() => setPlateExpanded(false), [])
  const [guiding, setGuiding] = useState(false)
  const exitGuide = useCallback(() => setGuiding(false), [])
  const guideSteps = useMemo(
    () => createProjectGuideSteps({ setPlate: setPlateExpanded, showWorld: () => setView('world') }),
    [setView],
  )
  const [layers, setLayers] = useState<Layers>({
    water: true,
    paths: true,
    vegetation: true,
    habitat: true,
  })
  const setLayer = (layer: keyof Layers) => (next: boolean) =>
    setLayers((current) => ({ ...current, [layer]: next }))

  const sun = sunAt(hour, noonElevation)
  const isNight = sun.daylight === 0
  const phase = isNight ? 'Night' : sun.daylight < 1 ? 'Twilight' : 'Day'
  const [dx, dy, dz] = sun.direction

  const [base] = useState(createBaseWorld)
  useEffect(
    () => () => {
      base.landmass.geometry.dispose()
      base.water.dispose()
      base.field.dispose()
      base.habitatField.dispose()
    },
    [base],
  )
  const [simulation, setSimulation] = useState(() =>
    createSimulation(base, START_NOON, DEFAULT_HABITAT_RULE),
  )
  const [, setVersion] = useState(0)
  const { architecture, ecology, days } = simulation
  const { waterStats } = base

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (refreshEcology(simulation, noonElevation, rule)) {
        setVersion((version) => version + 1)
      }
    }, SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [simulation, noonElevation, rule, hour])

  /** A day jump in progress: its target and the day reached so far. */
  const [jump, setJump] = useState<{ target: number; day: number } | null>(null)
  const jumpTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(jumpTimer.current), [])

  /**
   * Fast-forwards to the start of day `target` at the current time of day,
   * one day per timeout so the panel can show progress. Later days continue
   * the running world; the current or an earlier day replays from Reset, so
   * a preset always gives the same world for the same settings and hour.
   */
  const jumpToDay = (target: number) => {
    if (jump) {
      return
    }
    setPlaying(false)
    setJump({ target, day: days + 1 })
    const from = hourRef.current
    const processes = { growing, growthRate: rate, decaying, decayRate }
    const step = (running: Simulation) => {
      const remaining = target - 1 - running.days
      if (remaining > 0) {
        fastForward(running, from, 1, noonElevation, rule, processes, remaining === 1)
        setJump({ target, day: running.days + 1 })
        jumpTimer.current = window.setTimeout(() => step(running))
        return
      }
      setJump(null)
      if (running === simulation) {
        setVersion((version) => version + 1)
      } else {
        setSimulation(running)
      }
    }
    jumpTimer.current = window.setTimeout(() =>
      step(target <= days + 1 ? createSimulation(base, noonElevation, rule) : simulation),
    )
  }

  /** Moves the clock by `hours` (negative when scrubbed back); the sun it passes drives growth. */
  const advance = (hours: number) => {
    if (jump) {
      return
    }
    const from = hourRef.current
    const processes = { growing, growthRate: rate, decaying, decayRate }
    if (advanceSimulation(simulation, from, hours, noonElevation, rule, processes)) {
      setVersion((version) => version + 1)
    }
    const raw = from + hours
    const next = raw < 0 || raw > 24 ? ((raw % 24) + 24) % 24 : raw
    hourRef.current = next
    setHour(next)
  }
  const scrub = (next: number) => advance(next - hourRef.current)
  const setRuleValue = (key: keyof HabitatRule) => (next: number) =>
    setRule((current) => ({ ...current, [key]: next }))

  const snapshots: PageSnapshotAdapter = {
    page: 'project',
    schema: 1,
    saveBlocked: jump ? 'Wait for the day jump to finish before saving.' : null,
    reset: () => {
      window.clearTimeout(jumpTimer.current)
      setJump(null)
      setPlaying(false)
      hourRef.current = START_HOUR
      setHour(START_HOUR)
      setNoonElevation(START_NOON)
      setSpeed('1')
      setGrowing(true)
      setRate(RATE.start)
      setDecaying(true)
      setDecayRate(RATE.start)
      setRule(DEFAULT_HABITAT_RULE)
      setView('world')
      setTerrainView({ contours: false, wireframe: false })
      setAutoRotate(false)
      setLayers({ water: true, paths: true, vegetation: true, habitat: true })
      setSimulation(createSimulation(base, START_NOON, DEFAULT_HABITAT_RULE))
    },
    capture: () => {
      const { totals, arrays } = snapshotSimulation(simulation)
      return {
        summary: `Day ${days + 1} · ${formatHour(hour)} · ${architecture.count} voxels · noon ${noonElevation}°`,
        state: {
          hour,
          noonElevation,
          speed,
          growing,
          rate,
          decaying,
          decayRate,
          rule,
          view,
          terrainView,
          layers,
          world: totals,
        },
        payload: Object.fromEntries(Object.entries(arrays).map(([name, array]) => [name, bytesOf(array)])),
      }
    },
    restore: (state, payload) => {
      if (!payload || !state.world || typeof state.world !== 'object') {
        throw new Error('This snapshot is missing its world state.')
      }
      const nextHour = finite(state.hour, START_HOUR)
      const nextNoon = finite(state.noonElevation, START_NOON)
      const saved = state.rule as Partial<HabitatRule> | undefined
      const nextRule = {
        sunlightLimit: finite(saved?.sunlightLimit, DEFAULT_HABITAT_RULE.sunlightLimit),
        maxSlope: finite(saved?.maxSlope, DEFAULT_HABITAT_RULE.maxSlope),
      }
      const arrays: SimulationArrays = {
        voxels: payloadField(payload, 'voxels', readUint32),
        voxelSites: payloadField(payload, 'voxelSites', readUint8),
        voxelBirths: payloadField(payload, 'voxelBirths', readFloat32),
        moduleTop: payloadField(payload, 'moduleTop', readInt16),
        moduleBottom: payloadField(payload, 'moduleBottom', readInt16),
        moduleSite: payloadField(payload, 'moduleSite', readUint8),
        moduleSupport: payloadField(payload, 'moduleSupport', readUint8),
        moduleCut: payloadField(payload, 'moduleCut', readUint8),
        sunMemory: payloadField(payload, 'sunMemory', readFloat32),
      }
      const restored = restoreSimulation(base, state.world as SimulationTotals, arrays, nextNoon, nextRule)
      const savedLayers = state.layers as Partial<Layers> | undefined
      const savedTerrain = state.terrainView as Partial<TerrainView> | undefined
      window.clearTimeout(jumpTimer.current)
      setJump(null)
      setPlaying(false)
      hourRef.current = nextHour
      setHour(nextHour)
      setNoonElevation(nextNoon)
      setSpeed(SPEED_OPTIONS.find((option) => option.value === state.speed)?.value ?? '1')
      setGrowing(state.growing !== false)
      setRate(finite(state.rate, RATE.start))
      setDecaying(state.decaying !== false)
      setDecayRate(finite(state.decayRate, RATE.start))
      setRule(nextRule)
      setView(state.view === 'field' ? 'field' : 'world')
      setTerrainView({ contours: savedTerrain?.contours === true, wireframe: savedTerrain?.wireframe === true })
      setLayers({
        water: savedLayers?.water !== false,
        paths: savedLayers?.paths !== false,
        vegetation: savedLayers?.vegetation !== false,
        habitat: savedLayers?.habitat !== false,
      })
      setSimulation(restored)
    },
  }

  const routes = ecology.pathLines.filter((line) => line.primary).length
  const spurs = ecology.pathLines.length - routes
  const suitable = Math.round(100 * suitableShare(base.hydrology, ecology.habitat))
  usePlayClock(playing, Number(speed), advance)

  const plateWorld = {
    base,
    architecture,
    geometry: simulation.geometry,
    ecology,
    hour,
    noonElevation,
    layers,
    fieldOnly: view === 'field',
  }

  const floorHeight = base.landmass.lowest - FLOOR_GAP
  const sunArc = useMemo(() => sunPath(noonElevation, SUN_MARKER_RADIUS), [noonElevation])
  const plateRing = useMemo(
    () => circlePoints(ISLAND_RADIUS + PLATE_RING_GAP, floorHeight + 0.001),
    [floorHeight],
  )

  useShortcuts((key) => {
    if (key === 'p' || key === 'P') {
      setPlaying((current) => !current)
      return true
    }
    if (key === 'g' || key === 'G') {
      setGrowing((current) => !current)
      return true
    }
    return false
  })

  return (
    <div className="app-shell ui-system project">
      <div className="viz-stage">
        <div className="world-canvas-wrap">
          <Canvas
            className="world-canvas"
            camera={{ position: CAMERA_POSITION, fov: 45 }}
            gl={{ antialias: true }}
            shadows="percentage"
          >
            <color attach="background" args={[SCENE_BG]} />
            <ambientLight intensity={AMBIENT_INTENSITY} />
            <hemisphereLight
              args={[SKY_FILL.sky, SKY_FILL.ground]}
              intensity={SKY_FILL.day + (SKY_FILL.night - SKY_FILL.day) * (1 - sun.daylight)}
            />
            <directionalLight
              position={[dx * SUN_LIGHT_DISTANCE, dy * SUN_LIGHT_DISTANCE, dz * SUN_LIGHT_DISTANCE]}
              intensity={SUN_INTENSITY * sun.daylight}
              color={SUN_COLOR}
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-bias={-0.0005}
              shadow-normalBias={0.03}
              shadow-radius={2}
              shadow-camera-left={-SHADOW_EXTENT}
              shadow-camera-right={SHADOW_EXTENT}
              shadow-camera-top={SHADOW_EXTENT}
              shadow-camera-bottom={-SHADOW_EXTENT}
              shadow-camera-near={0.5}
              shadow-camera-far={30}
            />
            <ProjectWorld
              base={base}
              architecture={simulation.geometry}
              clock={architecture.clock}
              ecology={ecology}
              fieldOnly={view === 'field'}
              layers={layers}
              terrainView={terrainView}
            />
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, floorHeight - 0.002, 0]}
              receiveShadow
            >
              <planeGeometry args={[FLOOR_SIZE, FLOOR_SIZE]} />
              <shadowMaterial transparent opacity={SHADOW_OPACITY} />
            </mesh>
            <GuideLine points={plateRing} opacity={PLATE_RING_OPACITY} loop />
            <GuideLine points={sunArc} opacity={SUN_PATH_OPACITY} />
            {isNight ? null : (
              <mesh
                position={[
                  dx * SUN_MARKER_RADIUS,
                  dy * SUN_MARKER_RADIUS,
                  dz * SUN_MARKER_RADIUS,
                ]}
              >
                <sphereGeometry args={[0.07, 16, 12]} />
                <meshBasicMaterial color={SUN_COLOR} toneMapped={false} />
              </mesh>
            )}
            <OrbitControls
              makeDefault
              enableDamping
              dampingFactor={0.08}
              target={ORBIT_TARGET}
              autoRotate={autoRotate}
              autoRotateSpeed={AUTO_ROTATE_SPEED}
            />
          </Canvas>

          {plateExpanded ? (
            <PlateFocus
              {...plateWorld}
              meta={`Day ${days + 1} · ${formatHour(hour)} · ${view === 'field' ? 'Field only' : 'World'} · north up`}
              onClose={closePlate}
            />
          ) : null}

          <ViewTools
            tools={[
              {
                label: 'Wireframe',
                key: 'F',
                on: terrainView.wireframe,
                onChange: (wireframe) => setTerrainView((current) => ({ ...current, wireframe })),
              },
              {
                label: 'Contours',
                key: 'C',
                on: terrainView.contours,
                onChange: (contours) => setTerrainView((current) => ({ ...current, contours })),
              },
              { label: 'Auto rotate', key: 'R', on: autoRotate, onChange: setAutoRotate },
            ]}
          />
        </div>
      </div>

      <div className="app-chrome">
        <div className="region-left">
          <ExerciseHeading
            title="Shadow Ecology"
            about={ABOUT}
            actions={<LearnToggle label="Guide" active={guiding} onChange={setGuiding} />}
          />
          <p className="project-tag">Prototype 0.1 · light → growth → shadow → habitat</p>
          <ObservationPlate {...plateWorld} expanded={plateExpanded} onExpandedChange={setPlateExpanded} />
        </div>

        <InstrumentPanel label="Shadow Ecology 0.1" utilities={<PageSnapshots adapter={snapshots} />}>
          <PanelSection
            index="01"
            title="Time"
            status={<span className="section-status">Day {days + 1} · {phase}</span>}
          >
            <div className="project-transport">
              <button type="button" className="text-button" onClick={() => setPlaying((current) => !current)}>
                {playing ? 'Pause' : 'Play'}
              </button>
              <Segmented label="Simulation speed" options={SPEED_OPTIONS} value={speed} onChange={setSpeed} />
            </div>
            <div data-learn="day-jump">
              <ControlField
                label="Day jump"
                value={jump ? `Simulating… ${jump.day}/${jump.target}` : undefined}
                tip="Fast-forwards growth, decay and habitat to the start of that day, keeping the time of day. Later days continue the running world; the current or an earlier day replays from Reset."
              >
                <div className="segmented project-day-jump" role="group" aria-label="Jump to day">
                  {DAY_PRESETS.map((day) => (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={jump?.target === day}
                      disabled={jump !== null}
                      onClick={() => jumpToDay(day)}
                    >
                      Day {day}
                    </button>
                  ))}
                </div>
              </ControlField>
            </div>
            <div data-learn="time">
              <ControlField
                label="Time of day"
                value={formatHour(hour)}
                tip="Sunrise 06:00 in the east, noon in the south, sunset 18:00 in the west. P plays the day."
              >
                <Slider label="Time of day" min={0} max={24} step={0.05} value={hour} onChange={scrub} />
              </ControlField>
            </div>
            <div data-learn="noon">
              <ControlField
                label="Noon sun height"
                value={`${noonElevation}°`}
                tip="A stand-in for season: a lower sun casts longer shadows."
              >
                <Slider
                  label="Noon sun height"
                  min={20}
                  max={85}
                  step={1}
                  value={noonElevation}
                  onChange={setNoonElevation}
                />
              </ControlField>
            </div>
            <p className="readout">
              Sun az {Math.round(sun.azimuth)}° · el {Math.round(Math.max(0, sun.elevation))}°
            </p>
          </PanelSection>

          <PanelSection
            index="02"
            title="Growth"
          >
            <div data-learn="growth">
              <Toggle label="Architecture growth (G)" checked={growing} onChange={setGrowing} />
              <ControlField
                label="Growth rate"
                value={`${rate.toFixed(2)}×`}
                tip="Voxels the sun pays for per hour. Playing or scrubbing the time both grow."
              >
                <Slider
                  label="Growth rate"
                  min={RATE.min}
                  max={RATE.max}
                  step={RATE.step}
                  value={rate}
                  disabled={!growing}
                  onChange={setRate}
                />
              </ControlField>
            </div>
            <Toggle label="Decay" checked={decaying} onChange={setDecaying} />
            <ControlField
              label="Decay rate"
              value={`${decayRate.toFixed(2)}×`}
              tip="Weather and time wear the structure down, day and night, far slower than growth. Sunlight plays no part: old blocks go first, most where the form is open, stands high or overhangs. Unloaded slabs fall, masses wear down from the top and edges to plinths, and growth can rebuild the ground they free."
            >
              <Slider
                label="Decay rate"
                min={RATE.min}
                max={RATE.max}
                step={RATE.step}
                value={decayRate}
                disabled={!decaying}
                onChange={setDecayRate}
              />
            </ControlField>
            <p className="readout growth-status">
              <span>{architecture.sites.length} sites</span> <span>· {architecture.count} voxels</span>{' '}
              <span>· {simulation.weathered} weathered</span>
            </p>
          </PanelSection>

          <PanelSection
            index="03"
            title="Habitat"
            status={<span className="section-status">{suitable}% suitable</span>}
          >
            <div data-learn="habitat">
              <ControlField
                label="Sunlight limit"
                value={rule.sunlightLimit.toFixed(2)}
                tip="Remembered daily sunlight, as a share of open flat ground, that shelter gives way at: half gone here, gone by 1.5×. Lower asks for deeper shade."
              >
                <Slider
                  label="Sunlight limit"
                  {...HABITAT_RULE_RANGE.sunlightLimit}
                  value={rule.sunlightLimit}
                  onChange={setRuleValue('sunlightLimit')}
                />
              </ControlField>
              <ControlField
                label="Max slope"
                value={`${rule.maxSlope}°`}
                tip="Ground steeper than this gives no footing."
              >
                <Slider
                  label="Max slope"
                  {...HABITAT_RULE_RANGE.maxSlope}
                  value={rule.maxSlope}
                  onChange={setRuleValue('maxSlope')}
                />
              </ControlField>
            </div>
          </PanelSection>

          <PanelSection index="04" title="Layers">
            <SystemRow
              title="Architecture"
              summary={`${architecture.count} voxels`}
              card={
                <SystemCard
                  inputs="Growth: sunlight on buildable ground by the water. Weathering: time, and how open, high and supported the form is."
                  rule="Each lit hour pays voxels; masses grow toward the sun on their own support. Slowly, weather and time wear old blocks away, open, high and overhanging ones first."
                  output="Stepped masses that turn over, and the shadow they cast, which shifts habitat over the days. Blocks show their wear before they go: graphite leaches to a mottled mineral grey, then turns pale and friable, eaten into dark pockets."
                  now={`${architecture.count} voxels · ${architecture.sites.length} sites · ${growing ? `growing ${rate.toFixed(2)}×` : 'growth paused'} · ${decaying ? `decay ${decayRate.toFixed(2)}×, ${simulation.weathered} weathered` : 'decay off'}`}
                />
              }
            />
            <SystemRow
              title="Water"
              summary={`${waterStats.lakes} lakes · ${waterStats.falls} falls`}
              tone="water"
              card={
                <SystemCard
                  inputs="Terrain height."
                  rule="Water drains downhill; basins fill into lakes; channels that reach the rim fall off."
                  output="Lakes, rivers, falls and the moisture around them."
                  now={`${waterStats.lakes} lakes · ${waterStats.riverLength.toFixed(1)} river length · ${waterStats.falls} falls`}
                />
              }
              checked={layers.water}
              onChange={setLayer('water')}
            />
            <SystemRow
              title="Paths"
              summary={`${routes} routes · ${spurs} spurs`}
              card={
                <SystemCard
                  inputs="Slope, water, architecture; sites, water edges, vegetation and habitat regions."
                  rule="Least-cost routes join the sites; spurs branch off to each nearest destination."
                  output="Worn ground traces, wider on trunk routes. Re-routed at sunset."
                  now={`${routes} routes · ${spurs} spurs · ${ecology.pathLength.toFixed(1)} length`}
                />
              }
              checked={layers.paths}
              onChange={setLayer('paths')}
            />
            <SystemRow
              title="Vegetation"
              summary={`${ecology.plants.length} plants`}
              card={
                <SystemCard
                  inputs="Daily sunlight, moisture, slope."
                  rule="Stands where the ground is sunlit, moist and not steep; kept off water, paths and architecture."
                  output="Clustered plants, their form set by light and moisture. Re-grown at sunset."
                  now={`${ecology.plants.length} plants`}
                />
              }
              checked={layers.vegetation}
              onChange={setLayer('vegetation')}
            />
            <SystemRow
              title="Habitat"
              summary={`${suitable}% suitable`}
              card={
                <SystemCard
                  inputs="Daylight shelter (night excluded), moisture, slope."
                  rule={`Each sunset a full day’s sunlight is estimated from the current structure and blended into a ${MEMORY_DAYS}-day memory; remembered shelter × moisture × footing.`}
                  output={`Suitability for future shade-dependent creatures: ground colonised by lichen, scattered where thin and coalescing into a mottled moss crust where it turns suitable (≥ ${SUITABLE}). Ground the last sunset gained pales to fresh lichen; ground it lost keeps a faint ghost of hatching. Field only adds hatching and the suitable edge.`}
                  now={`${suitable}% of the ground suitable · sunlight limit ${rule.sunlightLimit.toFixed(2)} · slope ≤ ${rule.maxSlope}°`}
                />
              }
              checked={layers.habitat}
              onChange={setLayer('habitat')}
            />
          </PanelSection>

          <PanelSection index="05" title="View">
            <div data-learn="view">
              <Segmented label="Show" options={VIEW_OPTIONS} value={view} onChange={setView} />
            </div>
          </PanelSection>
        </InstrumentPanel>
      </div>

      {guiding ? <LearnTour steps={guideSteps} label="Guide · Shadow Ecology" onExit={exitGuide} /> : null}
    </div>
  )
}
