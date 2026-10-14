import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  type ExerciseAbout,
  type SegmentOption,
} from '../../shared/ui/instrument.tsx'
import { LearnToggle, LearnTour } from '../../shared/ui/learn.tsx'
import { PageSnapshots, type PageSnapshotAdapter } from '../../shared/ui/PageSnapshots.tsx'
import { useShortcuts } from '../../shared/ui/shortcuts.ts'
import { SUN_DIRECTION } from './environment.ts'
import { createTraceLearnSteps, type TraceLearnState } from './learnSteps.tsx'
import { grammarText, TRACE_GRAMMAR } from './lsystem.ts'
import { FIELD_STYLES, TRACE_COLORS } from './traceMaterial.ts'
import { AUTO_LOD, LOD_LEVELS, LOD_SPECS, type LodLevel, type LodMode, type LodStats } from './traceMesh.ts'
import { TraceGrowthScene, type TraceOverlays } from './TraceGrowthScene.tsx'
import {
  DEFAULT_TRACE_SETTINGS,
  deriveTrace,
  GROWTH_RESPONSES,
  growTrace,
  TRACE_RANGES,
  type GrowthResponse,
  type TraceSettings,
} from './turtle.ts'
import { Week07ViewStrip, type Immersion } from './ViewStrip.tsx'
import '../../shared/ui/system.css'
import './week07.css'

const SCENE_BG = '#000000'
const AMBIENT_INTENSITY = 0.22
/** Brighter than Week 06's fill, so growth under the slab still reads in shade. */
const SKY_FILL = { intensity: 0.5, sky: '#c9cfdc', ground: '#1a1917' } as const
const SUN_INTENSITY = 3
const SUN_COLOR = '#fff8ec'
const SUN_LIGHT_DISTANCE = 8
const SHADOW_EXTENT = 3.4
const FOG = { near: 7, far: 16 } as const
/** From the south-west, high enough to read the growth on the ground, low enough to see under the cantilever. */
const CAMERA_POSITION: [number, number, number] = [-1.9, 2.5, 3.6]
const ORBIT_TARGET: [number, number, number] = [0.15, 0.2, 0.4]

/** Seed to fully grown at 1×, seconds, whatever the organism's size. */
const GROWTH_SECONDS = 9
const MAX_FRAME_SECONDS = 0.1

const ABOUT: ExerciseAbout = {
  text: 'A recursive L-system read by a 3D turtle, grown beside a cantilevered slab in a fixed afternoon sun. The grammar rewrites every apex into forks, alternating laterals, creeping runners or dormant buds; the turtle walks the resulting word and draws it in space, reading the environment as it goes. The growth response is a controlled experiment: the same word, seed and settings grown Free (the grammar alone), Seek light (bent toward the sun) or Seek shelter (bent toward the slab’s shade). In every response the ground and the mass deflect it. The organism keeps a record: fresh growth is pale, older growth weathers to grey, and growth that has stayed in shelter is colonised in lichen green. Not a tree: a trace of how growth answered its environment.',
  terms: 'L-system · axiom · production · stochastic rule · recursion · turtle · heading / left / up · push / pop · tropism · phototropism · pipe model · level of detail',
  controls: '1–3 growth response · Space play / pause · H hide UI · F wireframe · R auto rotate · drag orbit · scroll zoom (Auto LOD)',
}

type SliderSpec = { key: keyof TraceSettings; label: string; display: (value: number) => string; tip: string }

const GRAMMAR_CONTROLS: readonly SliderSpec[] = [
  {
    key: 'iterations',
    label: 'Iterations',
    display: (v) => `n = ${v}`,
    tip: 'How many times the rules rewrite the axiom. Each iteration roughly doubles the apexes, so the organism grows by generations.',
  },
  {
    key: 'angle',
    label: 'Branch angle',
    display: (v) => `${v}°`,
    tip: 'The turn of + − (yaw) and & ^ (pitch). Small angles give veins and runners; wide angles give coral and lichen fans.',
  },
  {
    key: 'step',
    label: 'Step length',
    display: (v) => v.toFixed(2),
    tip: 'The length of one F, one internode, in world units. Seek light and Seek shelter lengthen it in the condition they favour.',
  },
  {
    key: 'randomness',
    label: 'Randomness',
    display: (v) => (v < 0.005 ? 'strict' : v.toFixed(2)),
    tip: 'At strict, every apex splits in two and the form is an exact fractal. Raising it mixes in forks, runners and dormant buds, and jitters each turn and step.',
  },
  {
    key: 'seed',
    label: 'Seed',
    display: (v) => `${v}`,
    tip: 'Starts the rule choices and the jitter. The same seed and settings always grow the same organism.',
  },
]

const TROPISM_TIP =
  'How strongly the response bends growth. Each internode turns toward the pull T by up to gain · |H × T|, and internodes in the favoured condition grow up to 45% longer, the others as much shorter. At 0, light and shelter grow as Free does. Unused in Free.'

const RESPONSE_TIP =
  'One experiment, three responses: the word, seed and settings stay the same, only how growth reads the environment changes. Collisions with the ground and the slab apply in all three.'

const RESPONSE_OPTIONS: SegmentOption<GrowthResponse>[] = [
  { value: 'free', label: 'Free' },
  { value: 'light', label: 'Seek light' },
  { value: 'shelter', label: 'Seek shelter' },
]

const RESPONSE_LABELS: Record<GrowthResponse, string> = { free: 'Free', light: 'Seek light', shelter: 'Seek shelter' }

const RESPONSE_NOTES: Record<GrowthResponse, string> = {
  free: 'No tropism: the grammar and its jitter alone.',
  light: 'Turns toward the sun, hardest where shaded; lit internodes grow longer.',
  shelter: 'Turns toward the nearest deep shade, hardest where exposed, then spreads over surfaces; sheltered internodes grow longer.',
}

const FIELD_NOTES: Record<GrowthResponse, string> = {
  free: 'Shelter contours, not read by Free',
  light: 'Light field; contours at 0.5 and 0.8',
  shelter: 'Shelter field; contours at 0.5 and 0.8',
}

const BIAS_NOTES: Record<GrowthResponse, string> = {
  free: 'No pull in Free',
  light: 'Pull toward the sun, longer where shaded',
  shelter: 'Pull toward shelter, longer where exposed',
}

const LOD_MODE_OPTIONS: SegmentOption<LodMode>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'manual', label: 'Manual' },
]

const LOD_LEVEL_OPTIONS: SegmentOption<LodLevel>[] = LOD_LEVELS.map((level) => ({
  value: level,
  label: `${LOD_SPECS[level].index} ${LOD_SPECS[level].label}`,
}))

const lodName = (level: LodLevel) => `${LOD_SPECS[level].index} · ${LOD_SPECS[level].label}`

const LOD_NOTES: Record<LodLevel, string> = {
  full: `Every internode, in ${LOD_SPECS.full.radial}-sided tubes, with a bud on every apex.`,
  reduced: `Major limbs and selected secondary branches: twigs off the main limbs are dropped, each limb's leading twig kept. ${LOD_SPECS.reduced.radial}-sided tubes, runs under ${LOD_SPECS.reduced.mergeAngle}° merged, low-poly buds on the kept tips.`,
  skeleton: `Only the dominant structural limbs, each still running out along its leaders to its final tip, so the form keeps its lean and reach. ${LOD_SPECS.skeleton.radial}-sided tubes, runs under ${LOD_SPECS.skeleton.mergeAngle}° merged, no buds.`,
}

const LOD_TIP = `One grown organism, three representations built from the same internodes; changing level never regrows it. Branches are ranked by Strahler order: a twig is 1, and a limb rises an order where two limbs of equal order meet. Auto chooses by camera distance: Full nearer than ${AUTO_LOD.reduced}, Reduced to ${AUTO_LOD.skeleton}, Skeleton beyond.`

type Speed = '0.5' | '1' | '2'
const SPEED_OPTIONS: SegmentOption<Speed>[] = [
  { value: '0.5', label: '0.5×' },
  { value: '1', label: '1×' },
  { value: '2', label: '2×' },
]

const DEFAULT_OVERLAYS: TraceOverlays = { field: false, bias: false }
/** Saves before Auto / Manual stored a single mode, a level name or 'auto'. */
const LEGACY_LEVELS: Record<string, LodLevel> = { high: 'full', medium: 'reduced', low: 'skeleton' }

const count = (n: number) => n.toLocaleString('en')
const kiloTris = (n: number) => `${(n / 1000).toFixed(1)}k`

function restoredSettings(saved: unknown): TraceSettings {
  const values = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(DEFAULT_TRACE_SETTINGS).map(([key, fallback]) => {
      const value = values[key]
      const range = TRACE_RANGES[key as keyof TraceSettings]
      return [
        key,
        typeof value === 'number' && Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : fallback,
      ]
    }),
  ) as TraceSettings
}

/** What each tone and mark means, drawn like it. */
function MarkKey({ overlays, response }: { overlays: TraceOverlays; response: GrowthResponse }) {
  return (
    <ul className="mark-key">
      <li>
        <span className="mark is-line" style={{ color: TRACE_COLORS.fresh }} aria-hidden="true" />
        Fresh growth, toward the tips
      </li>
      <li>
        <span className="mark is-line" style={{ color: TRACE_COLORS.aged }} aria-hidden="true" />
        Older growth, weathered
      </li>
      <li>
        <span className="mark is-line" style={{ color: TRACE_COLORS.lichen }} aria-hidden="true" />
        Long in shelter: colonised
      </li>
      <li>
        <span className="mark is-small" style={{ color: 'var(--signal)' }} aria-hidden="true" />
        Growth front, while growing
      </li>
      {overlays.bias ? (
        <li>
          <span className="mark is-line" style={{ color: 'var(--signal)', opacity: 0.7 }} aria-hidden="true" />
          {BIAS_NOTES[response]}
        </li>
      ) : null}
      {overlays.field ? (
        <li>
          <span className="mark is-area" style={{ color: FIELD_STYLES[response].color }} aria-hidden="true" />
          {FIELD_NOTES[response]}
        </li>
      ) : null}
    </ul>
  )
}

/** Week 07 → 01 Trace Growth. `tabs` is the Branching Systems subtab row. */
export function TraceGrowthStudy({ tabs, immersion }: { tabs: ReactNode; immersion: Immersion }) {
  const [settings, setSettings] = useState<TraceSettings>(DEFAULT_TRACE_SETTINGS)
  const [lodMode, setLodMode] = useState<LodMode>('auto')
  const [manualLevel, setManualLevel] = useState<LodLevel>('full')
  const [level, setLevel] = useState<LodLevel>('full')
  const [stats, setStats] = useState<Record<LodLevel, LodStats> | null>(null)
  const [overlays, setOverlays] = useState<TraceOverlays>(DEFAULT_OVERLAYS)
  const [wireframe, setWireframe] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(true)
  /** Bumped by Replay so the clock restarts even while already playing. */
  const [run, setRun] = useState(0)
  const [speed, setSpeed] = useState<Speed>('1')
  const [response, setResponse] = useState<GrowthResponse>('shelter')
  const [learning, setLearning] = useState(false)
  const exitLearning = useCallback(() => setLearning(false), [])

  const { iterations, randomness, seed } = settings
  const derivation = useMemo(() => deriveTrace(iterations, randomness, seed), [iterations, randomness, seed])
  const model = useMemo(() => growTrace(derivation, settings, response), [derivation, settings, response])

  const progressRef = useRef(progress)
  useLayoutEffect(() => {
    progressRef.current = progress
  })
  useEffect(() => {
    if (!playing) {
      return
    }
    const rate = Number(speed) / GROWTH_SECONDS
    let last = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const seconds = Math.min((now - last) / 1000, MAX_FRAME_SECONDS)
      last = now
      const next = Math.min(1, progressRef.current + seconds * rate)
      progressRef.current = next
      setProgress(next)
      if (next >= 1) {
        setPlaying(false)
        return
      }
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, run])

  const togglePlaying = useCallback(() => {
    if (!playing && progressRef.current >= 1) {
      setProgress(0)
      progressRef.current = 0
    }
    setPlaying(!playing)
  }, [playing])
  const replay = useCallback(() => {
    setProgress(0)
    setPlaying(true)
    setRun((current) => current + 1)
  }, [])
  const scrub = (value: number) => {
    setPlaying(false)
    setProgress(value)
  }

  const learnSteps = useMemo(
    () =>
      createTraceLearnSteps({
        defaults: DEFAULT_TRACE_SETTINGS,
        show: (state: TraceLearnState) => {
          if (state.settings) {
            const next = state.settings
            setSettings((current) => ({ ...current, ...next }))
          }
          if (state.response) {
            setResponse(state.response)
          }
          if (state.overlays) {
            const next = state.overlays
            setOverlays((current) => ({ ...current, ...next }))
          }
          if (state.lod) {
            setLodMode(state.lod)
          }
          if (state.level) {
            setManualLevel(state.level)
          }
          if (state.replay) {
            replay()
          }
        },
      }),
    [replay],
  )

  useShortcuts((key) => {
    if (key === ' ') {
      togglePlaying()
      return true
    }
    const next = /^[1-3]$/.test(key) ? GROWTH_RESPONSES[Number(key) - 1] : undefined
    if (next) {
      setResponse(next)
    }
    return next !== undefined
  })

  const setSetting = (key: keyof TraceSettings) => (value: number) => setSettings((current) => ({ ...current, [key]: value }))
  const setOverlay = (key: keyof TraceOverlays) => (on: boolean) => setOverlays((current) => ({ ...current, [key]: on }))
  const onGeometry = useCallback((next: Record<LodLevel, LodStats>) => setStats(next), [])
  const chooseLevel = (next: LodLevel) => {
    setManualLevel(next)
    setLodMode('manual')
  }
  const chooseMode = (next: LodMode) => {
    if (next === 'manual') {
      setManualLevel(level)
    }
    setLodMode(next)
  }

  const sunPosition: [number, number, number] = [
    SUN_DIRECTION.x * SUN_LIGHT_DISTANCE,
    SUN_DIRECTION.y * SUN_LIGHT_DISTANCE,
    SUN_DIRECTION.z * SUN_LIGHT_DISTANCE,
  ]
  const growing = progress < 1
  const tips = model.buds.length
  const drawn = stats?.[level]
  const full = stats?.full
  const fired = Object.entries(model.fired)
    .map(([name, n]) => `${name} ${n}`)
    .join(' · ')

  const snapshots: PageSnapshotAdapter = {
    page: 'week07trace',
    schema: 1,
    reset: () => {
      setSettings(DEFAULT_TRACE_SETTINGS)
      setResponse('shelter')
      setLodMode('auto')
      setManualLevel('full')
      setOverlays(DEFAULT_OVERLAYS)
      setWireframe(false)
      setAutoRotate(false)
      replay()
    },
    capture: () => ({
      summary: `${RESPONSE_LABELS[response]} · n ${settings.iterations} · ${settings.angle}° · tropism ${settings.tropism.toFixed(2)} · seed ${settings.seed}`,
      state: { settings, response, lodMode, lodLevel: manualLevel, overlays, wireframe },
    }),
    restore: (state) => {
      setSettings(restoredSettings(state.settings))
      // Saves without a response predate the modes; they grew toward shelter.
      setResponse(GROWTH_RESPONSES.includes(state.response as GrowthResponse) ? (state.response as GrowthResponse) : 'shelter')
      const legacy = typeof state.lodMode === 'string' ? LEGACY_LEVELS[state.lodMode] : undefined
      const savedLevel = LOD_LEVELS.includes(state.lodLevel as LodLevel) ? (state.lodLevel as LodLevel) : undefined
      setLodMode(state.lodMode === 'manual' || legacy ? 'manual' : 'auto')
      setManualLevel(savedLevel ?? legacy ?? 'full')
      const saved = (state.overlays && typeof state.overlays === 'object' ? state.overlays : {}) as Record<string, unknown>
      setOverlays({ field: saved.field === true, bias: saved.bias === true })
      setWireframe(state.wireframe === true)
      setPlaying(false)
      setProgress(1)
    },
  }

  return (
    <div className="app-shell ui-system week07">
      <div className="viz-stage">
        <div className="world-canvas-wrap">
          <Canvas
            className="world-canvas"
            camera={{ position: CAMERA_POSITION, fov: 42 }}
            gl={{ antialias: true }}
            shadows="percentage"
          >
            <color attach="background" args={[SCENE_BG]} />
            <fog attach="fog" args={[SCENE_BG, FOG.near, FOG.far]} />
            <ambientLight intensity={AMBIENT_INTENSITY} />
            <hemisphereLight args={[SKY_FILL.sky, SKY_FILL.ground]} intensity={SKY_FILL.intensity} />
            <directionalLight
              position={sunPosition}
              intensity={SUN_INTENSITY}
              color={SUN_COLOR}
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-bias={-0.0004}
              shadow-normalBias={0.01}
              shadow-radius={2}
              shadow-camera-left={-SHADOW_EXTENT}
              shadow-camera-right={SHADOW_EXTENT}
              shadow-camera-top={SHADOW_EXTENT}
              shadow-camera-bottom={-SHADOW_EXTENT}
              shadow-camera-near={0.5}
              shadow-camera-far={20}
            />
            <TraceGrowthScene
              model={model}
              response={response}
              step={settings.step}
              lodMode={lodMode}
              manualLevel={manualLevel}
              progress={progress}
              growing={growing}
              overlays={overlays}
              wireframe={wireframe}
              onLevel={setLevel}
              onGeometry={onGeometry}
            />
            <OrbitControls
              makeDefault
              enableDamping
              dampingFactor={0.08}
              target={ORBIT_TARGET}
              minDistance={1.2}
              maxDistance={14}
              maxPolarAngle={Math.PI * 0.49}
              autoRotate={autoRotate}
              autoRotateSpeed={AUTO_ROTATE_SPEED}
            />
          </Canvas>

          <Week07ViewStrip
            immersion={immersion}
            tools={[
              { label: 'Wireframe', key: 'F', on: wireframe, onChange: setWireframe },
              { label: 'Auto rotate', key: 'R', on: autoRotate, onChange: setAutoRotate },
            ]}
          >
            <p className="readout" aria-live="polite">
              <span>
                Response <strong>{RESPONSE_LABELS[response]}</strong>
              </span>
              <span>{Math.round(model.sheltered * 100)}% sheltered</span>
              <span>
                LOD <strong>{lodName(level)}</strong> · {lodMode}
              </span>
              <span>{count(model.branches)} branches</span>
              <span>{count(tips)} tips</span>
              {drawn && full ? (
                <>
                  <span>
                    {count(drawn.internodes)} / {count(full.internodes)} segments
                  </span>
                  <span>
                    {kiloTris(drawn.triangles)} tris · {Math.round((drawn.triangles / full.triangles) * 100)}% of full
                  </span>
                </>
              ) : null}
              <span>Growth {Math.round(progress * 100)}%</span>
            </p>
          </Week07ViewStrip>
        </div>
      </div>

      <div className="app-chrome">
        <div className="region-left">
          <ExerciseHeading
            title="Branching Systems"
            about={ABOUT}
            actions={<LearnToggle active={learning} onChange={setLearning} />}
          />
          {tabs}
        </div>

        <InstrumentPanel label="Trace Growth" utilities={<PageSnapshots adapter={snapshots} />}>
          <PanelSection
            index="01"
            title="Grammar"
            tip="The L-system: an axiom and stochastic rules, rewritten recursively. These controls change the word, and how the turtle reads it."
          >
            {GRAMMAR_CONTROLS.map((spec) => (
              <div key={spec.key} data-control={`trace-${spec.key}`}>
                <ControlField label={spec.label} value={spec.display(settings[spec.key])} tip={spec.tip}>
                  <Slider
                    label={spec.label}
                    min={TRACE_RANGES[spec.key].min}
                    max={TRACE_RANGES[spec.key].max}
                    step={TRACE_RANGES[spec.key].step}
                    value={settings[spec.key]}
                    onChange={setSetting(spec.key)}
                  />
                </ControlField>
              </div>
            ))}
            <div className="row-foot">
              <button
                type="button"
                className="text-button"
                onClick={() => setSetting('seed')(1 + Math.floor(Math.random() * TRACE_RANGES.seed.max))}
              >
                New seed
              </button>
              <button type="button" className="text-button" onClick={() => setSettings(DEFAULT_TRACE_SETTINGS)}>
                Reset grammar
              </button>
            </div>
            <Disclosure label="How it works">
              <div className="study-block">
                <code className="explain-eq">{grammarText(TRACE_GRAMMAR, settings.randomness)}</code>
                <p className="explain-text">
                  F draws an internode; X is an apex. + − yaw, &amp; ^ pitch by the branch angle, / rolls by the golden
                  angle so forks spiral; [ ] save and restore the turtle. Each X is expanded recursively, depth first, n
                  times: a rule is drawn by weight and every symbol of its successor is expanded with n − 1.
                </p>
                <code className="explain-eq is-quiet">
                  {count(model.symbols)} symbols{model.capped ? ' (capped)' : ''} · {fired}
                </code>
              </div>
            </Disclosure>
          </PanelSection>

          <PanelSection
            index="02"
            title="Environment"
            tip="The slab and pier cast a shelter field: blocked sun and blocked sky; light is its complement. The growth response decides what the turtle reads at every internode."
          >
            <div data-learn="response" className="study-block">
              <ControlField label="Growth response" value="keys 1–3" tip={RESPONSE_TIP}>
                <Segmented label="Growth response" options={RESPONSE_OPTIONS} value={response} onChange={setResponse} />
              </ControlField>
              <p className="explain-text lod-note">{RESPONSE_NOTES[response]}</p>
              <div data-control="trace-tropism">
                <ControlField
                  label="Tropism strength"
                  value={response === 'free' ? '—' : settings.tropism < 0.005 ? 'off' : settings.tropism.toFixed(2)}
                  tip={TROPISM_TIP}
                >
                  <Slider
                    label="Tropism strength"
                    min={TRACE_RANGES.tropism.min}
                    max={TRACE_RANGES.tropism.max}
                    step={TRACE_RANGES.tropism.step}
                    value={settings.tropism}
                    disabled={response === 'free'}
                    onChange={setSetting('tropism')}
                  />
                </ControlField>
              </div>
            </div>
            <div className="study-block">
              <Toggle
                label={response === 'light' ? 'Light field' : 'Shelter field'}
                checked={overlays.field}
                onChange={setOverlay('field')}
              />
              <Toggle label="Tropism vectors" checked={overlays.bias} onChange={setOverlay('bias')} />
              <MarkKey overlays={overlays} response={response} />
            </div>
          </PanelSection>

          <PanelSection
            index="03"
            title="Growth"
            tip="The finished organism revealed along its paths from the seed: the front reaches each point at its path length."
            status={<span className="section-status">{Math.round(progress * 100)}%</span>}
          >
            <div data-learn="growth" className="study-block">
              <ControlField label="Front" value="space">
                <div className="generation-transport">
                  <button type="button" className="text-button" onClick={togglePlaying}>
                    {playing ? 'Pause' : 'Play'}
                  </button>
                  <button type="button" className="text-button" onClick={replay}>
                    Replay
                  </button>
                  <Segmented label="Growth speed" options={SPEED_OPTIONS} value={speed} onChange={setSpeed} />
                </div>
              </ControlField>
              <Slider label="Growth" min={0} max={1} step={0.001} value={progress} onChange={scrub} />
            </div>
          </PanelSection>

          <PanelSection
            index="04"
            title="Detail"
            tip={LOD_TIP}
            status={<span className="section-status">LOD {LOD_SPECS[level].index}</span>}
          >
            <div data-learn="detail" className="study-block">
              <ControlField label="Choose" value={lodMode === 'auto' ? 'by distance' : 'held'}>
                <Segmented label="Level of detail mode" options={LOD_MODE_OPTIONS} value={lodMode} onChange={chooseMode} />
              </ControlField>
              <ControlField label="Level" value={lodName(level)}>
                <Segmented label="Level of detail" options={LOD_LEVEL_OPTIONS} value={level} onChange={chooseLevel} />
              </ControlField>
              <p className="explain-text lod-note">{LOD_NOTES[level]}</p>
              {stats ? (
                <code className="explain-eq is-quiet">
                  {LOD_LEVELS.map((l) => `${LOD_SPECS[l].index} ${kiloTris(stats[l].triangles)}`).join(' · ')} tris ·
                  auto {AUTO_LOD.reduced} / {AUTO_LOD.skeleton}
                </code>
              ) : null}
            </div>
          </PanelSection>
        </InstrumentPanel>
      </div>
      {learning ? (
        <LearnTour steps={learnSteps} label="Learn · Trace Growth" onExit={exitLearning} />
      ) : null}
    </div>
  )
}
