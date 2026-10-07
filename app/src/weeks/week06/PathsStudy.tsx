import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { sunAt } from '../../project/sun.ts'
import {
  AUTO_ROTATE_SPEED,
  ControlField,
  Disclosure,
  ExerciseHeading,
  InstrumentPanel,
  PanelSection,
  Segmented,
  Slider,
  Toggle,
  ViewTools,
  type ExerciseAbout,
  type SegmentOption,
} from '../../shared/ui/instrument.tsx'
import { LearnToggle, LearnTour } from '../../shared/ui/learn.tsx'
import { PageSnapshots, type PageSnapshotAdapter } from '../../shared/ui/PageSnapshots.tsx'
import { useShortcuts } from '../../shared/ui/shortcuts.ts'
import { NOON_ELEVATION } from './distribution.ts'
import { COMPLETE, GENERATION_OPTIONS, useGenerationClock, type GenerationMode } from './generation.ts'
import {
  connectionStretch,
  DEFAULT_PATH_SETTINGS,
  generatePaths,
  IMPRINT_DEPTH,
  IMPRINT_RADIUS,
  PATH_COLORS,
  PATH_METHODS,
  PATH_RANGES,
  type PathMethod,
  type PathSettingsMap,
} from './paths.ts'
import { createPathsLearnSteps, type PathsLearnState } from './pathsLearnSteps.tsx'
import { PathsScene, type PathOverlays } from './PathsScene.tsx'
import { createStudyTerrain } from './studyTerrain.ts'
import '../../shared/ui/system.css'
import './week06.css'

const SCENE_BG = '#000000'
const AMBIENT_INTENSITY = 0.2
const SKY_FILL = { intensity: 0.12, sky: '#c9cfdc', ground: '#1a1917' } as const
const SUN_INTENSITY = 3
const SUN_COLOR = '#fff8ec'
const SUN_LIGHT_DISTANCE = 12
/** The same afternoon as Distribution. */
const SUN_HOUR = 15.5
const FLOOR_SIZE = 18
const FLOOR_GAP = 0.8
const SHADOW_OPACITY = 0.35
const SHADOW_EXTENT = 6
const CAMERA_POSITION: [number, number, number] = [4.9, 3.3, 5.9]
const ORBIT_TARGET: [number, number, number] = [0, -0.2, 0]

/** Generation steps per second at 1×; one step is a short stretch of path. */
const GENERATION_RATE = 15
type GenerationSpeed = '1' | '2' | '4' | '8'
const GENERATION_SPEEDS: SegmentOption<GenerationSpeed>[] = (['1', '2', '4', '8'] as const).map((speed) => ({
  value: speed,
  label: `${speed}×`,
}))
const DEFAULT_GENERATION_SPEED: GenerationSpeed = '2'

const ABOUT: ExerciseAbout = {
  text: 'Turning points into lines over the study terrain, shown bare: no lake, vegetation or structures, only the ground the lines read. Connection links seeded nodes into a network, trying the shortest links first and keeping one only where the network would otherwise detour too far; it stays a diagram of lines. Flow starts on high ground and steps downhill, turned by the slope, swung by meander, and stopping where it would have to climb; streams that meet merge into one channel, which widens with the flow gathered above it, so the lines read as a drainage network. Growth extends lines from anchors along a heading turned by coherent noise, sometimes branching; it is grown flat in 2D, projected onto the ground as a spline, and drawn as tapering veins. The Study section reveals what each line was built from, and an optional imprint lets the Growth splines press back into the terrain mesh. Every result is fixed by its seed and settings, and progressive generation replays the same run.',
  terms: 'node · network · spanner · stretch · gradient · downhill · meander · confluence · flow accumulation · heading · drift · branching · projection · spline · imprint',
  controls: '1–3 method · F wireframe · C contours · R auto rotate · drag orbit · scroll zoom',
}

const METHOD_INFO: Record<PathMethod, { label: string; title: string; formula: string; summary: string }> = {
  connection: {
    label: 'Connection',
    title: 'Network',
    formula: 'keep link ab if  d_network(a, b) > stretch × |ab|',
    summary: 'Seeded nodes spread over the block. Every pair is a candidate link, costed by its length over the ground and tried shortest first. A link is kept when the network so far cannot reach between its ends, or only by a detour longer than the stretch: a greedy spanner. Each kept link is then drawn as a quadratic curve bowed to one side.',
  },
  flow: {
    label: 'Flow',
    title: 'Flow',
    formula: 'd ← normalize(d + strength · pull(slope) · −∇h);  p ← p + rotate(d, meander · noise(s)) · Δ;  Q = Σ q(source);  w ∝ Q^0.6',
    summary: 'Sources are the highest of a set of seeded candidates, kept apart, traced highest first. Each stream steps forward along its heading, which turns toward −∇h, the steepest way down; flat ground pulls less, so it carries on by inertia. Meander swings each step either side of the heading. Water never climbs: where a step would rise, it turns straight downhill instead. The same rule runs the whole course, and a stream ends only where the water would: joining an earlier channel, in a hollow where even the downhill step would rise or it has stopped descending (it pools at the lowest point it reached), or off the edge; no stream stops on open ground. (An internal bound, twice across the block, guards against a runaway trace; no natural course reaches it.) A stream whose ribbon would come near an earlier channel curves in and joins it at the first point downstream no higher than itself, however soon after its source, and ends there: below a confluence the two run on as one channel, never side by side. An isolated stream that dies within a few steps is rejected and the next candidate tried. Each channel carries the summed flow of every source above it, each growing slowly as its catchment does, and is drawn as a ribbon on the ground whose width grows with that flow (as Q^0.6, the hydraulic-geometry rule): narrow at the source, wider below each confluence, ending in a pool where it reaches a hollow. Its streaks move at a current set by the fall.',
  },
  growth: {
    label: 'Growth',
    title: 'Growth',
    formula: 'θ ← θ + drift · noise(s);  p ← p + (cos θ, sin θ) · Δ;  branch if u < p_branch · rate',
    summary: 'Anchors spread over the block, each with a seeded heading. Every step moves forward and turns the heading by coherent noise along the line; near the edge it bends back in. A tip may branch at an angle, taking part of the remaining length. The line is grown in a flat 2D plane and never reads the terrain; projection lays it on the ground, where it is drawn as a tube: thickest on main lines, thinner on branches, tapering to a point at every tip.',
  },
}

const METHOD_OPTIONS = PATH_METHODS.map(
  (method): SegmentOption<PathMethod> => ({ value: method, label: METHOD_INFO[method].label }),
)

const DEFAULT_OVERLAYS: PathOverlays = {
  nodes: true,
  links: false,
  field: false,
  source: false,
  projection: false,
  spline: true,
}
const OVERLAY_KEYS = Object.keys(DEFAULT_OVERLAYS) as (keyof PathOverlays)[]

const PROJECTION = 'P(x, z) = (x, h(x, z), z)'

type SliderSpec = {
  key: string
  label: string
  display: (value: number) => string
  tip: string
}

const percent = (value: number) => `${Math.round(value * 100)}%`
const SEED_TIP = 'Starts this method’s random sequence. The same seed and settings always give the same lines.'

const CONTROLS: { [M in PathMethod]: (SliderSpec & { key: keyof PathSettingsMap[M] & string })[] } = {
  connection: [
    {
      key: 'nodes',
      label: 'Nodes',
      display: (v) => `${v}`,
      tip: 'How many nodes to connect. Each new node is the farthest of a few random tries from those before it, so raising the count only adds nodes.',
    },
    { key: 'seed', label: 'Seed', display: (v) => `${v}`, tip: SEED_TIP },
    {
      key: 'curvature',
      label: 'Curvature',
      display: (v) => (v < 0.005 ? 'straight' : v.toFixed(2)),
      tip: 'How far each link bows from its straight line, up to a third of its length. Drawing only: which nodes connect does not change.',
    },
    {
      key: 'directness',
      label: 'Directness',
      display: (v) => {
        const stretch = connectionStretch(v)
        return Number.isFinite(stretch) ? `${v.toFixed(2)} · stretch ${stretch.toFixed(2)}` : '0 · tree'
      },
      tip: 'How direct routes through the network must be. At 0 every node is reached once: a tree with no loops, where trips reuse the same winding routes. Higher values add a direct link wherever the network detours by more than the stretch.',
    },
  ],
  flow: [
    {
      key: 'count',
      label: 'Paths',
      display: (v) => `${v}`,
      tip: 'How many streams. Sources are the highest of a set of seeded candidates, kept apart from each other. A short tributary that soon meets a channel is kept; a source whose stream would die on its own within a few steps is skipped for the next candidate.',
    },
    { key: 'seed', label: 'Seed', display: (v) => `${v}`, tip: SEED_TIP },
    {
      key: 'downhill',
      label: 'Downhill strength',
      display: percent,
      tip: 'How fast the heading turns toward the steepest way down. Low values keep the path’s momentum, so it cuts across slopes; at 0 it runs straight on, turning downhill only where the ground ahead rises.',
    },
    {
      key: 'meander',
      label: 'Meander',
      display: (v) => (v < 0.005 ? 'none' : v.toFixed(2)),
      tip: 'Swings each step either side of the heading by coherent noise, up to about 57°. The course itself still follows the ground.',
    },
  ],
  growth: [
    {
      key: 'count',
      label: 'Anchors',
      display: (v) => `${v}`,
      tip: 'How many lines start, each from an anchor spread over the block with its own heading.',
    },
    { key: 'seed', label: 'Seed', display: (v) => `${v}`, tip: SEED_TIP },
    {
      key: 'length',
      label: 'Length',
      display: (v) => v.toFixed(1),
      tip: 'The length each anchor’s line grows, in world units. A branch takes part of what its parent has left.',
    },
    {
      key: 'drift',
      label: 'Drift',
      display: (v) => (v < 0.005 ? 'straight' : v.toFixed(2)),
      tip: 'How much the heading turns along the line, by coherent noise, so curves are long and smooth rather than jittery.',
    },
    {
      key: 'branching',
      label: 'Branch probability',
      display: (v) => (v < 0.005 ? 'off' : percent(v)),
      tip: 'The chance per step that a tip splits. Branches can branch once more, and are drawn thinner.',
    },
  ],
}

/** Saved settings over the defaults: missing or mistyped values fall back, numbers are clamped to range. */
function restoredSettings(saved: unknown): PathSettingsMap {
  const byMethod = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>
  return Object.fromEntries(
    PATH_METHODS.map((method) => {
      const values = (byMethod[method] && typeof byMethod[method] === 'object' ? byMethod[method] : {}) as Record<
        string,
        unknown
      >
      const ranges = PATH_RANGES[method] as Record<string, { min: number; max: number }>
      return [
        method,
        Object.fromEntries(
          Object.entries(DEFAULT_PATH_SETTINGS[method]).map(([key, fallback]) => {
            const value = values[key]
            const range = ranges[key]!
            return [
              key,
              typeof value === 'number' && Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : fallback,
            ]
          }),
        ),
      ]
    }),
  ) as PathSettingsMap
}

function restoredOverlays(saved: unknown): PathOverlays {
  const values = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>
  return Object.fromEntries(
    OVERLAY_KEYS.map((key) => [key, typeof values[key] === 'boolean' ? values[key] : DEFAULT_OVERLAYS[key]]),
  ) as PathOverlays
}

const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback

/** What each visible line and mark means, drawn like it. */
function LineKey({ method, overlays }: { method: PathMethod; overlays: PathOverlays }) {
  const pathVisible = method !== 'growth' || overlays.spline
  return (
    <ul className="mark-key">
      {pathVisible && method === 'connection' ? (
        <li>
          <span className="mark is-line" style={{ color: 'var(--signal)' }} aria-hidden="true" />
          Link, drawn as a curve
        </li>
      ) : null}
      {method === 'flow' ? (
        <li>
          <span className="mark is-stream" aria-hidden="true" />
          Channel, wider with the flow gathered above it; streaks run downstream
        </li>
      ) : null}
      {pathVisible && method === 'growth' ? (
        <li>
          <span className="mark is-vein" style={{ color: PATH_COLORS.vein.tip }} aria-hidden="true" />
          Terrain spline as a vein; branches thinner, tips tapered
        </li>
      ) : null}
      {overlays.nodes ? (
        <li>
          <span className="mark is-node" aria-hidden="true" />
          {method === 'connection'
            ? 'Node'
            : method === 'flow'
              ? 'Source; small, a confluence; open ring, a mouth'
              : 'Anchor'}
        </li>
      ) : null}
      {method === 'connection' && overlays.links ? (
        <li>
          <span className="mark is-line is-dashed" style={{ color: 'var(--ink)' }} aria-hidden="true" />
          Straight link, as chosen
        </li>
      ) : null}
      {method === 'flow' && overlays.field ? (
        <li>
          <span className="mark is-line" style={{ color: 'var(--ink)' }} aria-hidden="true" />
          Downhill, longer where steeper
        </li>
      ) : null}
      {method === 'growth' && overlays.source ? (
        <li>
          <span className="mark is-line" style={{ color: PATH_COLORS.source }} aria-hidden="true" />
          2D source line, in its plane
        </li>
      ) : null}
      {method === 'growth' && overlays.projection ? (
        <li>
          <span className="mark is-line is-dashed" style={{ color: PATH_COLORS.projection }} aria-hidden="true" />
          Projection to the ground
        </li>
      ) : null}
    </ul>
  )
}

/** Week 06 → 02 Paths. `tabs` is the Spatial Systems subtab row. */
export function PathsStudy({ tabs }: { tabs: ReactNode }) {
  const [terrain] = useState(createStudyTerrain)
  useEffect(
    () => () => {
      terrain.geometry.dispose()
      terrain.water.dispose()
      terrain.field.dispose()
      terrain.habitatField.dispose()
    },
    [terrain],
  )

  const [method, setMethod] = useState<PathMethod>('connection')
  const [settings, setSettings] = useState<PathSettingsMap>(DEFAULT_PATH_SETTINGS)
  const [overlays, setOverlays] = useState<PathOverlays>(DEFAULT_OVERLAYS)
  const [imprint, setImprint] = useState(false)
  const [imprintDepth, setImprintDepth] = useState<number>(IMPRINT_DEPTH.default)
  const [wireframe, setWireframe] = useState(false)
  const [contours, setContours] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [generationMode, setGenerationMode] = useState<GenerationMode>('instant')
  const [step, setStep] = useState(COMPLETE)
  const [playing, setPlaying] = useState(false)
  const [generationSpeed, setGenerationSpeed] = useState<GenerationSpeed>(DEFAULT_GENERATION_SPEED)
  const generationRate = GENERATION_RATE * Number(generationSpeed)
  const [learning, setLearning] = useState(false)
  const exitLearning = useCallback(() => setLearning(false), [])

  const study = useMemo(() => generatePaths(method, settings), [method, settings])
  const total = study.total
  const shown = generationMode === 'progressive' ? step : COMPLETE
  const generating = shown < total

  useGenerationClock(playing, generationRate, (steps) => {
    const next = step + steps
    if (next >= total) {
      setStep(COMPLETE)
      setPlaying(false)
    } else {
      setStep(next)
    }
  })
  const chooseGenerationMode = (mode: GenerationMode) => {
    setGenerationMode(mode)
    setStep(mode === 'progressive' ? 0 : COMPLETE)
    setPlaying(mode === 'progressive')
  }
  const togglePlaying = () => {
    if (playing) {
      setPlaying(false)
      return
    }
    if (!generating) {
      setStep(0)
    }
    setPlaying(true)
  }
  const resetGeneration = () => {
    setStep(0)
    setPlaying(false)
  }

  const learnSteps = useMemo(
    () =>
      createPathsLearnSteps({
        show: (state: PathsLearnState) => {
          if (state.method) {
            setMethod(state.method)
          }
          if (state.overlays) {
            setOverlays((current) => ({ ...current, ...state.overlays }))
          }
          if (state.imprint !== undefined) {
            setImprint(state.imprint)
          }
          if (state.progressive) {
            setGenerationMode('progressive')
            setStep(0)
            setPlaying(true)
          }
        },
      }),
    [],
  )

  const sun = sunAt(SUN_HOUR, NOON_ELEVATION)
  const [dx, dy, dz] = sun.direction
  const floorHeight = terrain.lowest - FLOOR_GAP
  const info = METHOD_INFO[method]

  const setOverlay = (key: keyof PathOverlays) => (on: boolean) => setOverlays((current) => ({ ...current, [key]: on }))
  const setSetting = (key: string) => (value: number) =>
    setSettings((current) => ({ ...current, [method]: { ...current[method], [key]: value } }))
  const values = settings[method] as Record<string, number>
  const ranges = PATH_RANGES[method] as Record<string, { min: number; max: number; step: number }>

  const lineCount = study.paths.filter((line) => line.depth === 0).length
  const network = study.network
  const stats =
    method === 'connection'
      ? `${study.nodes.length} nodes · ${study.paths.length} links`
      : network
        ? `${network.streams} streams · ${network.confluences} confluences${network.rejected > 0 ? ` · ${network.rejected} short rejected` : ''}`
        : `${lineCount} lines · ${study.extra} branches`

  const snapshots: PageSnapshotAdapter = {
    page: 'week06paths',
    schema: 1,
    reset: () => {
      setMethod('connection')
      setSettings(DEFAULT_PATH_SETTINGS)
      setOverlays(DEFAULT_OVERLAYS)
      setImprint(false)
      setImprintDepth(IMPRINT_DEPTH.default)
      setWireframe(false)
      setContours(false)
      setAutoRotate(false)
      chooseGenerationMode('instant')
    },
    capture: () => ({
      summary: `${info.label} · ${stats}`,
      state: { method, settings, overlays, imprint, imprintDepth, wireframe, contours },
    }),
    restore: (state) => {
      setMethod(pick(state.method, PATH_METHODS, 'connection'))
      setSettings(restoredSettings(state.settings))
      setOverlays(restoredOverlays(state.overlays))
      setImprint(state.imprint === true)
      setImprintDepth(
        typeof state.imprintDepth === 'number' && Number.isFinite(state.imprintDepth)
          ? Math.min(IMPRINT_DEPTH.max, Math.max(IMPRINT_DEPTH.min, state.imprintDepth))
          : IMPRINT_DEPTH.default,
      )
      setWireframe(state.wireframe === true)
      setContours(state.contours === true)
      chooseGenerationMode('instant')
    },
  }

  useShortcuts((key) => {
    const next = /^[1-3]$/.test(key) ? PATH_METHODS[Number(key) - 1] : undefined
    if (next) {
      setMethod(next)
    }
    return next !== undefined
  })

  return (
    <div className="app-shell ui-system week06">
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
            <hemisphereLight args={[SKY_FILL.sky, SKY_FILL.ground]} intensity={SKY_FILL.intensity} />
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
            <PathsScene
              terrain={terrain}
              dryField={terrain.habitatField}
              study={study}
              time={shown}
              overlays={overlays}
              imprint={imprint}
              imprintDepth={imprintDepth}
              contours={contours}
              wireframe={wireframe}
            />
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floorHeight - 0.002, 0]} receiveShadow>
              <planeGeometry args={[FLOOR_SIZE, FLOOR_SIZE]} />
              <shadowMaterial transparent opacity={SHADOW_OPACITY} />
            </mesh>
            <OrbitControls
              makeDefault
              enableDamping
              dampingFactor={0.08}
              target={ORBIT_TARGET}
              autoRotate={autoRotate}
              autoRotateSpeed={AUTO_ROTATE_SPEED}
            />
          </Canvas>

          <ViewTools
            tools={[
              { label: 'Wireframe', key: 'F', on: wireframe, onChange: setWireframe },
              { label: 'Contours', key: 'C', on: contours, onChange: setContours },
              { label: 'Auto rotate', key: 'R', on: autoRotate, onChange: setAutoRotate },
            ]}
          >
            <p className="readout" aria-live="polite">
              <span>
                Method <strong>{info.label}</strong>
              </span>
              <span>{stats}</span>
              <span>Length {study.length.toFixed(1)}</span>
              {generating ? <span>Generating {Math.round((100 * Math.min(step, total)) / total)}%</span> : null}
            </p>
          </ViewTools>
        </div>
      </div>

      <div className="app-chrome">
        <div className="region-left">
          <ExerciseHeading
            title="Spatial Systems"
            about={ABOUT}
            actions={<LearnToggle active={learning} onChange={setLearning} />}
          />

          {tabs}
        </div>

        <InstrumentPanel label="Paths" utilities={<PageSnapshots adapter={snapshots} />}>
          <PanelSection
            index="01"
            title="Method"
            tip="How points become lines. Each method starts from its own points and builds its lines in plan, then lays them on the terrain."
            status={
              generating ? (
                <span className="section-status">
                  {Math.floor(Math.min(step, total))} / {Math.ceil(total)}
                </span>
              ) : undefined
            }
          >
            <div data-learn="method">
              <ControlField label="Lines from" value="keys 1–3">
                <Segmented label="Path method" options={METHOD_OPTIONS} value={method} onChange={setMethod} />
              </ControlField>
            </div>
            <div data-learn="generation">
              <ControlField
                label="Generation"
                tip="Instant shows the finished lines. Progressive replays the same run step by step, and always ends on the same lines for the same seed and settings."
              >
                <Segmented
                  label="Generation"
                  options={GENERATION_OPTIONS}
                  value={generationMode}
                  onChange={chooseGenerationMode}
                />
              </ControlField>
              {generationMode === 'progressive' ? (
                <ControlField label="Generation speed" value={`${generationRate} steps / s`} tip="Path steps drawn per second.">
                  <div className="generation-transport">
                    <button type="button" className="text-button" onClick={togglePlaying}>
                      {playing ? 'Pause' : 'Play'}
                    </button>
                    <button type="button" className="text-button" onClick={resetGeneration}>
                      Reset
                    </button>
                    <Segmented
                      label="Generation speed"
                      options={GENERATION_SPEEDS}
                      value={generationSpeed}
                      onChange={setGenerationSpeed}
                    />
                  </div>
                </ControlField>
              ) : null}
            </div>
            <Disclosure label="How it works">
              <div className="study-block">
                <code className="explain-eq">{info.formula}</code>
                <p className="explain-text">{info.summary}</p>
              </div>
            </Disclosure>
          </PanelSection>

          <PanelSection index="02" title={info.title}>
            {CONTROLS[method].map((spec) => (
              <div key={`${method}-${spec.key}`} data-control={`${method}-${spec.key}`}>
                <ControlField label={spec.label} value={spec.display(values[spec.key]!)} tip={spec.tip}>
                  <Slider
                    label={spec.label}
                    min={ranges[spec.key]!.min}
                    max={ranges[spec.key]!.max}
                    step={ranges[spec.key]!.step}
                    value={values[spec.key]!}
                    onChange={setSetting(spec.key)}
                  />
                </ControlField>
              </div>
            ))}
            <div className="row-foot">
              <button
                type="button"
                className="text-button"
                onClick={() => setSetting('seed')(1 + Math.floor(Math.random() * PATH_RANGES[method].seed.max))}
              >
                New seed
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setSettings((current) => ({ ...current, [method]: DEFAULT_PATH_SETTINGS[method] }))}
              >
                Reset method
              </button>
            </div>
          </PanelSection>

          <PanelSection
            index="03"
            title="Study"
            tip="Reveal what the lines were built from. Off by default, so the lines read on their own."
          >
            <div data-learn="study" className="study-block">
              {method === 'connection' ? (
                <>
                  <Toggle label="Nodes" checked={overlays.nodes} onChange={setOverlay('nodes')} />
                  <Toggle label="Straight links" checked={overlays.links} onChange={setOverlay('links')} />
                </>
              ) : null}
              {method === 'flow' ? (
                <>
                  <Toggle label="Sources, confluences, mouths" checked={overlays.nodes} onChange={setOverlay('nodes')} />
                  <Toggle label="Downhill field" checked={overlays.field} onChange={setOverlay('field')} />
                </>
              ) : null}
              {method === 'growth' ? (
                <>
                  <Toggle label="Anchors" checked={overlays.nodes} onChange={setOverlay('nodes')} />
                  <Toggle label="2D source line" checked={overlays.source} onChange={setOverlay('source')} />
                  <Toggle label="Projection" checked={overlays.projection} onChange={setOverlay('projection')} />
                  <Toggle label="Terrain spline" checked={overlays.spline} onChange={setOverlay('spline')} />
                </>
              ) : null}
              <LineKey method={method} overlays={overlays} />
              {method === 'growth' && (overlays.source || overlays.projection) ? (
                <>
                  <code className="explain-eq is-quiet">{PROJECTION}</code>
                  <p className="explain-text">
                    The line is grown flat in a plane above the block and never reads the ground. Each of its points
                    drops straight down to the ground height h; the spline is smoothed through them in plan and laid on
                    the ground.
                  </p>
                </>
              ) : null}
            </div>

            {method === 'growth' ? (
              <div data-learn="imprint" className="study-block">
                <Toggle label="Imprint on terrain" checked={imprint} onChange={setImprint} />
                {imprint ? (
                  <>
                    <ControlField
                      label="Imprint depth"
                      value={imprintDepth.toFixed(3)}
                      tip={`How deep the splines press into the terrain mesh, in world units. The groove is ${(2 * IMPRINT_RADIUS).toFixed(2)} wide with a low shoulder either side.`}
                    >
                      <Slider
                        label="Imprint depth"
                        min={IMPRINT_DEPTH.min}
                        max={IMPRINT_DEPTH.max}
                        step={IMPRINT_DEPTH.step}
                        value={imprintDepth}
                        onChange={setImprintDepth}
                      />
                    </ControlField>
                    <p className="explain-text">
                      Spline to mesh: every terrain vertex near a spline sinks by a smooth groove, then the spline rides
                      in it. Contours (C) show the pressed ground.
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}
          </PanelSection>
        </InstrumentPanel>
      </div>

      {learning ? <LearnTour steps={learnSteps} label="Learn · Spatial Systems · Paths" onExit={exitLearning} /> : null}
    </div>
  )
}
