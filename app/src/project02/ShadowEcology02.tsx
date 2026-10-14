import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { formatHour } from '../project/sun.ts'
import type { SnapshotPayload, SnapshotState } from '../shared/persistence/snapshots.ts'
import {
  ControlField,
  Disclosure,
  ExerciseHeading,
  InfoLabel,
  InstrumentPanel,
  PanelSection,
  Segmented,
  Slider,
  Toggle,
  ViewTools,
  type SegmentOption,
} from '../shared/ui/instrument.tsx'
import { LearnToggle, LearnTour } from '../shared/ui/learn.tsx'
import { PageSnapshots, type PageSnapshotAdapter } from '../shared/ui/PageSnapshots.tsx'
import { useShortcuts } from '../shared/ui/shortcuts.ts'
import { SHADOW_ECOLOGY_ABOUT } from './about.ts'
import { ARCH_REPRESENTATION_LABELS, type ArchLod, type ArchRepresentation } from './archMesh.ts'
import { RESOLUTIONS, type Resolution } from './core.ts'
import { CREATURES_ENABLED, type DriveInput } from './creatures.ts'
import { EcoScene } from './EcoScene.tsx'
import { createGuide02Steps } from './guideSteps.tsx'
import type { HistoryEntry } from './history.ts'
import type { TraceAmount } from './materials.ts'
import { ALTERNATES, branchDone, planParallel, stepBranch, traitsOf, WORLD_TEXT, type ParallelPlan, type Traits, type WorldId } from './parallel.ts'
import { SENSE, senseKey, WAY_LABELS, WAYS, type CreatureView, type WayOfSeeing } from './perception.ts'
import { packEco, unpackEco } from './persist.ts'
import {
  beginJump,
  cancelJump,
  createRuntime,
  disposeRuntime,
  finishJump,
  focusTarget,
  keptDays,
  readStats,
  resetRuntime,
  restoreRuntime,
  returnToDay,
  setControlled,
  setDrive,
  setNoon,
  setPlayback,
  setProcesses,
  setResolution,
  setViewHour,
  setPlantDensity,
  setWay,
  setFogThickness,
  setWeatherAuto,
  setWeatherCondition,
  clearWeatherNow,
  setWindManual,
  stepJump,
  type DayJump,
  type FocusValue,
  type Playback,
  type Runtime,
  type Stats,
} from './runtime.ts'
import { useDriveKeys } from './sceneControl.ts'
import { DEFAULT_SEED, START_HOUR, START_NOON } from './simulation.ts'
import { CAMERA_POSITION, LENS, QUALITY, type ParallelView, type ParallelWorld, type Quality, type SceneView } from './view.ts'
import { FOG_DENSITY, type Condition } from './weather.ts'
import '../shared/ui/system.css'
import '../project/project.css'
import './project02.css'

const PLAYBACK_OPTIONS: SegmentOption<Playback>[] = [
  { value: 'pause', label: 'Pause' },
  { value: 'slow', label: 'Slow' },
  { value: '1x', label: '1×' },
  { value: '4x', label: '4×' },
]

const JUMPS = [
  { hours: 6, label: '+6 h' },
  { hours: 24, label: '+1 day' },
  { hours: 72, label: '+3 days' },
] as const

const DAY_JUMPS = [1, 10, 50, 100] as const

/** Milliseconds of simulation per slice of a jump, so the page stays responsive and shows progress. */
const JUMP_BUDGET = 60

type DensityChoice = '0.5' | '1' | '1.6'

const DENSITY_OPTIONS: SegmentOption<DensityChoice>[] = [
  { value: '0.5', label: 'Sparse' },
  { value: '1', label: 'Normal' },
  { value: '1.6', label: 'Dense' },
]

const WAY_OPTIONS: SegmentOption<WayOfSeeing>[] = WAYS.filter((value) => CREATURES_ENABLED || value !== 'creature').map((value) => ({
  value,
  label: WAY_LABELS[value],
}))

const CREATURE_OPTIONS: SegmentOption<CreatureView>[] = [
  { value: 'ground', label: 'Walker' },
  { value: 'wading', label: 'Wader' },
  { value: 'flying', label: 'Flyer' },
]

/** Each way's stance and the question it asks of the world. */
const WAY_TEXT: Record<Exclude<WayOfSeeing, 'creature'>, { line: string; question: string }> = {
  world: { line: 'The world as it stands.', question: 'What is here?' },
  architecture: { line: 'Architecture sees opportunity and risk.', question: 'Where can I grow and remain supported?' },
  habitat: { line: 'Habitat reveals the conditions life responds to. Stronger colour is more suitable.', question: 'Where can life persist?' },
}

/** What the marks in each creature view mean, beyond the ground tints. */
const MARKS: Record<CreatureView, string> = {
  ground: 'Walkers keep to dry ground, rubble and low ledges. Lines are routes coloured by what they seek; the dot is the goal. Dark ground is out of reach.',
  wading: 'Waders keep to the wet margins and wade the shallows. Lines are routes; dark ground is out of reach.',
  flying: 'Flyers soar over open high ground and perch on structures, ridges and cliff edges. Lines are flight trails; ticks mark perches, taller where better.',
}

const RESOLUTION_OPTIONS: SegmentOption<Resolution>[] = (['low', 'medium', 'high'] as const).map((value) => ({
  value,
  label: RESOLUTIONS[value].label,
}))

const REPRESENTATION_OPTIONS: SegmentOption<ArchRepresentation>[] = (['blocks', 'marching'] as const).map((value) => ({
  value,
  label: ARCH_REPRESENTATION_LABELS[value],
}))

type GrowthChoice = '0' | '0.1' | '0.35' | '1' | '2.5'

const GROWTH_OPTIONS: SegmentOption<GrowthChoice>[] = [
  { value: '0', label: 'Held' },
  { value: '0.1', label: 'Very slow' },
  { value: '0.35', label: 'Slow' },
  { value: '1', label: 'Normal' },
  { value: '2.5', label: 'Fast' },
]

type LodChoice = 'auto' | '0' | '1' | '2'

const LOD_OPTIONS: SegmentOption<LodChoice>[] = [
  { value: 'auto', label: 'Auto' },
  { value: '0', label: 'Full' },
  { value: '1', label: 'Reduced' },
  { value: '2', label: 'Skeleton' },
]

const QUALITY_OPTIONS: SegmentOption<Quality>[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
]
const TRACE_OPTIONS: SegmentOption<TraceAmount>[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
]

const RATE = { min: 0.25, max: 4, step: 0.25 } as const

const pad = (n: number) => String(n).padStart(2, '0')
const dayOf = (clock: number) => Math.floor((START_HOUR + clock) / 24) + 1
/** Simulation clock just past the start of `day` (Day 1 starts when the world does). */
const clockOfDay = (day: number) => Math.max(0, (day - 1) * 24 - START_HOUR + 0.01)

const SCHEMA = 1

type Jump = { label: string; done: number; total: number }

function SenseKeyRow({ way, creature }: { way: WayOfSeeing; creature: CreatureView }) {
  const channels = SENSE[senseKey(way, creature)]
  const text = way === 'creature' ? null : WAY_TEXT[way]
  return (
    <div className="eco-sense-key">
      {text ? (
        <p className="eco-note">
          {text.line} <span className="eco-question">{text.question}</span>
        </p>
      ) : null}
      {channels.length ? (
        <ul>
          {channels.map((c) => (
            <li key={c.label}>
              <span className="eco-swatch" data-line={c.line ? '' : undefined} style={{ background: c.fill ? c.color : undefined, borderColor: c.color }} />
              {c.label}
            </li>
          ))}
          {way === 'architecture' ? (
            <li>
              <span className="eco-swatch" data-mark="" />
              Growth front
            </li>
          ) : null}
        </ul>
      ) : null}
      {way === 'creature' ? <p className="eco-note">{MARKS[creature]}</p> : null}
    </div>
  )
}

/** Waits for the camera to pull back before the alternates are computed, so the move stays smooth. */
const PARALLEL_DELAY_MS = 1900

const GUIDE_CUES = { try: 'Demo' }

type ParallelMeta = { fromDay: number; fromClock: number; until: number; branches: number }

const hourOf = (clock: number) => (START_HOUR + clock) % 24
const signed = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '±0')

function TraitRows({ traits, base }: { traits: Traits; base: Traits | null }) {
  const delta = (key: keyof Traits, scale = 1) => (base ? ` (${signed(Math.round((traits[key] - base[key]) * scale))})` : '')
  return (
    <p className="readout eco-traits">
      <span>
        Architecture <Count>{traits.voxels}</Count> voxels{delta('voxels')} · <Count>{traits.fallen}</Count> fallen{delta('fallen')}
      </span>
      <span>
        Vegetation <Count>{traits.light}</Count> light-seeking{delta('light')} · <Count>{traits.shade}</Count> shadow-seeking{delta('shade')}
      </span>
      <span>
        Ground moisture <Count>{Math.round(traits.moisture * 100)}%</Count>
        {delta('moisture', 100)} · lakes <Count>{signed(Math.round(traits.lake * 100))} cm</Count> · paths <Count>{Math.round(traits.paths)} m</Count>
        {delta('paths')}
      </span>
    </p>
  )
}

/** The shared past, the worlds to pick from, and how the picked one differs from the live world. */
function ParallelPanel({
  runtime,
  meta,
  worlds,
  selected,
  onSelect,
  onReturn,
}: {
  runtime: Runtime
  /** `undefined` while the camera pulls back and the worlds are not yet forked. */
  meta: ParallelMeta | null | undefined
  worlds: ParallelWorld[]
  selected: WorldId
  onSelect: (id: WorldId) => void
  onReturn: () => void
}) {
  if (meta === undefined) return <p className="eco-note">Pulling back to the shared past…</p>
  if (!meta) return <p className="eco-note">No kept day to branch from yet.</p>
  const hours = Math.max(0, meta.until - meta.fromClock)
  const picked = selected === 'this' ? runtime.eco : worlds.find((w) => w.id === selected)?.eco
  const base = traitsOf(runtime.eco, runtime.statics)
  const traits = picked ? (selected === 'this' ? base : traitsOf(picked, runtime.statics)) : null
  return (
    <div className="eco-parallel-body">
      <p className="readout eco-parallel-past">
        <span>
          Common past · Day {pad(1)} → Day {pad(meta.fromDay)} {formatHour(hourOf(meta.fromClock))}
        </span>
        <span>
          Disturbance → {Math.round(hours)} h of divergence → compared at Day {pad(dayOf(meta.until))} {formatHour(hourOf(meta.until))}
        </span>
      </p>
      <div className="eco-worlds">
        {(['this', ...ALTERNATES] as WorldId[]).map((id) => {
          const ready = id === 'this' || worlds.some((w) => w.id === id)
          return (
            <button key={id} type="button" className="text-button" aria-pressed={selected === id} disabled={!ready} onClick={() => onSelect(id)}>
              {WORLD_TEXT[id].label}
            </button>
          )
        })}
      </div>
      {worlds.length < meta.branches ? (
        <p className="eco-note">
          Tracing world {worlds.length + 1} of {meta.branches} from the shared past…
        </p>
      ) : null}
      {hours < 12 ? <p className="eco-note">Only a few hours of divergence so far; let time run for the worlds to drift apart.</p> : null}
      <p className="eco-note">
        <span className="eco-question">{WORLD_TEXT[selected].label}.</span> {WORLD_TEXT[selected].note}
      </p>
      {traits ? <TraitRows traits={traits} base={selected === 'this' ? null : base} /> : null}
      <button type="button" className="text-button" onClick={onReturn}>
        Return to this world
      </button>
    </div>
  )
}

function FocusValues({ values }: { values: FocusValue[] }) {
  if (!values.length) return null
  return (
    <ul className="eco-values">
      {values.map((v) => (
        <li key={v.label}>
          <span>{v.label}</span>
          <span className="eco-bar">
            <span style={{ width: `${Math.round(v.value * 100)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  )
}

const CHAIN = [
  ['Event', 'detail'],
  ['Change', 'change'],
  ['Response', 'response'],
  ['Trace', 'trace'],
] as const

function Milestone({ entry }: { entry: HistoryEntry }) {
  const [open, setOpen] = useState(false)
  const text = (key: (typeof CHAIN)[number][1]) => {
    if (key === 'response' && entry.response && entry.reorganisation) return `${entry.response} ${entry.reorganisation}`
    return entry[key]
  }
  return (
    <li data-minor={entry.milestone ? undefined : ''}>
      <button type="button" className="eco-milestone" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="eco-milestone-day">Day {pad(dayOf(entry.clock))}</span>
        <span className="eco-milestone-title">
          {entry.title}
          {entry.count > 1 ? <span className="eco-milestone-count"> ×{entry.count}</span> : null}
        </span>
      </button>
      {open ? (
        <ol className="eco-chain">
          {CHAIN.map(([label, key]) => {
            const value = text(key)
            return (
              <li key={label} data-pending={value ? undefined : ''}>
                <span>{label}</span>
                {value || 'still unfolding…'}
              </li>
            )
          })}
        </ol>
      ) : null}
    </li>
  )
}

function History({ log }: { log: HistoryEntry[] }) {
  const milestones = log.filter((e) => e.milestone).slice(0, 6)
  return (
    <div className="eco-history-wrap">
      {milestones.length ? (
        <ol className="eco-history">
          {milestones.map((entry) => (
            <Milestone key={entry.id} entry={entry} />
          ))}
        </ol>
      ) : (
        <p className="eco-note">The history begins with the first structure and the first stand of vegetation.</p>
      )}
      {log.length ? (
        <Disclosure label={`All events (${log.length})`}>
          <ol className="eco-history">
            {log.slice(0, 20).map((entry) => (
              <Milestone key={entry.id} entry={entry} />
            ))}
          </ol>
        </Disclosure>
      ) : null}
    </div>
  )
}

/** The lens's label, following it on screen: how fast time runs inside, and which hand is which. */
function LensLabel({ runtime }: { runtime: Runtime }) {
  const label = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let frame = 0
    const follow = () => {
      const screen = runtime.lensScreen
      const node = label.current
      if (node) {
        node.hidden = !screen
        if (screen) node.style.transform = `translate(${Math.round(screen.x)}px, ${Math.round(screen.y + screen.size / 2 + 10)}px) translateX(-50%)`
      }
      frame = requestAnimationFrame(follow)
    }
    frame = requestAnimationFrame(follow)
    return () => cancelAnimationFrame(frame)
  }, [runtime])
  return (
    <div ref={label} className="eco-lens-label" hidden>
      <strong>Time inside ×{LENS.slow}</strong>
      <span>
        1 h outside = {Math.round(60 * LENS.slow)} min inside · <i data-hand="outside" /> outside <i data-hand="inside" /> inside
      </span>
    </div>
  )
}

const Count = ({ children }: { children: ReactNode }) => <span className="eco-count">{children}</span>

const DEFAULTS = {
  quality: 'normal' as Quality,
  playback: '1x' as Playback,
  growth: '1' as GrowthChoice,
  decaying: true,
  decaySpeed: 1,
  way: 'world' as WayOfSeeing,
  creature: 'ground' as CreatureView,
  overlays: true,
  layers: { exposure: true, shelter: true, creatures: true },
  paths: true,
  trace: 'normal' as TraceAmount,
  terrain: { contours: false, wireframe: false },
  lod: 'auto' as LodChoice,
  representation: 'blocks' as ArchRepresentation,
  density: '1' as DensityChoice,
  windField: false,
  windDegrees: 34,
  windStrength: 0.75,
}

const oneOf = <T extends string>(value: unknown, options: readonly SegmentOption<T>[], fallback: T): T =>
  options.some((o) => o.value === value) ? (value as T) : fallback

export function ShadowEcology02({ tabs }: { tabs?: ReactNode }) {
  const [runtime] = useState(() => createRuntime())
  const [stats, setStats] = useState<Stats>(() => readStats(runtime))
  const [quality, setQuality] = useState<Quality>(DEFAULTS.quality)
  const [playback, setPlaybackState] = useState<Playback>(DEFAULTS.playback)
  const [resume, setResume] = useState<Exclude<Playback, 'pause'>>('1x')
  const [noon, setNoonState] = useState(runtime.eco.noon)
  const [growth, setGrowth] = useState<GrowthChoice>(DEFAULTS.growth)
  const [decaying, setDecaying] = useState(DEFAULTS.decaying)
  const [decaySpeed, setDecaySpeed] = useState(DEFAULTS.decaySpeed)
  const [density, setDensity] = useState<DensityChoice>(DEFAULTS.density)
  const [showWind, setShowWind] = useState(DEFAULTS.windField)
  const [windDegrees, setWindDegrees] = useState(DEFAULTS.windDegrees)
  const [windStrength, setWindStrength] = useState(DEFAULTS.windStrength)
  const [fogDensity, setFogDensityState] = useState(FOG_DENSITY)
  const [way, setWayState] = useState<WayOfSeeing>(DEFAULTS.way)
  const [creature, setCreature] = useState<CreatureView>(DEFAULTS.creature)
  const [focus, setFocus] = useState(0)
  const [embodied, setEmbodied] = useState(false)
  const [controlling, setControlling] = useState(false)
  const [overlays, setOverlays] = useState(DEFAULTS.overlays)
  const [layers, setLayers] = useState(DEFAULTS.layers)
  const [paths, setPaths] = useState(DEFAULTS.paths)
  const [trace, setTrace] = useState<TraceAmount>(DEFAULTS.trace)
  const [terrain, setTerrain] = useState(DEFAULTS.terrain)
  const [lod, setLod] = useState<LodChoice>(DEFAULTS.lod)
  const [representation, setRepresentation] = useState<ArchRepresentation>(DEFAULTS.representation)
  const [seed, setSeed] = useState(DEFAULT_SEED)
  const seedTimer = useRef(0)
  const [lens, setLensOn] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [jump, setJump] = useState<Jump | null>(null)
  const jumpTimer = useRef(0)
  const jumpJob = useRef<DayJump | null>(null)
  const [guiding, setGuiding] = useState(false)
  const [parallelOpen, setParallelOpen] = useState(false)
  const [worlds, setWorlds] = useState<ParallelWorld[]>([])
  const [worldId, setWorldId] = useState<WorldId>('this')
  const [parallelMeta, setParallelMeta] = useState<ParallelMeta | null | undefined>(null)
  const parallelPlan = useRef<ParallelPlan | null>(null)
  const parallelTimer = useRef(0)

  useEffect(() => () => disposeRuntime(runtime), [runtime])
  useEffect(() => () => window.clearTimeout(parallelTimer.current), [])
  useEffect(() => {
    const timer = window.setInterval(() => setStats(readStats(runtime)), 250)
    return () => window.clearInterval(timer)
  }, [runtime])
  useEffect(() => () => window.clearTimeout(jumpTimer.current), [])
  useEffect(() => () => window.clearTimeout(seedTimer.current), [])

  const growthSpeed = Number(growth)
  useEffect(() => setPlayback(runtime, playback), [runtime, playback])
  useEffect(() => setNoon(runtime, noon), [runtime, noon])
  useEffect(
    () => setProcesses(runtime, { growing: growthSpeed > 0, decaying, growthSpeed: growthSpeed || 1, decaySpeed }),
    [runtime, growthSpeed, decaying, decaySpeed],
  )
  useEffect(() => setWay(runtime, way, creature, focus), [runtime, way, creature, focus])

  const refresh = () => setStats(readStats(runtime))
  const viewHour = stats.viewHour
  const chooseViewHour = (hour: number) => {
    setViewHour(runtime, hour)
    refresh()
  }
  const choosePlayback = (next: Playback) => {
    if (next !== 'pause') setResume(next)
    setPlaybackState(next)
  }
  const togglePause = () => choosePlayback(playback === 'pause' ? resume : 'pause')
  const chooseAuto = (auto: boolean) => {
    setWeatherAuto(runtime, auto)
    refresh()
  }
  const chooseCondition = (condition: Condition, on: boolean) => {
    setWeatherCondition(runtime, condition, on)
    if (condition === 'wind' && on) setWindManual(runtime, windDegrees, windStrength)
    refresh()
  }
  const clearSky = () => {
    clearWeatherNow(runtime)
    refresh()
  }
  const chooseFogDensity = (value: number) => {
    setFogDensityState(value)
    setFogThickness(runtime, value)
  }
  const steerWind = (degrees: number, strength: number) => {
    setWindDegrees(degrees)
    setWindStrength(strength)
    setWindManual(runtime, degrees, strength)
  }
  const chooseDensity = (next: DensityChoice) => {
    setDensity(next)
    setPlantDensity(runtime, Number(next))
    refresh()
  }

  const release = useCallback(() => {
    setControlling(false)
    setControlled(runtime, 0)
  }, [runtime])

  const chooseWay = useCallback(
    (next: WayOfSeeing, view?: CreatureView) => {
      release()
      setWayState(!CREATURES_ENABLED && next === 'creature' ? 'world' : next)
      if (view) setCreature(view)
      setFocus(0)
      if (next === 'world' || next === 'habitat') setEmbodied(false)
    },
    [release],
  )
  const chooseCreature = (view: CreatureView) => {
    release()
    setCreature(view)
    setFocus(0)
  }
  const nextFocus = () => {
    release()
    setFocus((current) => current + 1)
  }
  /** Ways with a subject to focus on, step through and embody. */
  const focusable = way === 'architecture' || way === 'creature'
  const toggleEmbodied = (next: boolean) => {
    if (!focusable || parallelOpen) return
    if (!next) release()
    setEmbodied(next)
  }
  const leave = () => {
    release()
    setEmbodied(false)
  }

  // Embodied in a creature, the arrow keys take it over; Esc hands it back to the ecology.
  const steerable = embodied && way === 'creature'
  const onDrive = useCallback(
    (input: DriveInput) => {
      const moving = input.forward !== 0 || input.turn !== 0 || input.lift !== 0
      if (moving && !runtime.settings.controlled) {
        const target = focusTarget(runtime)
        if (!target) return
        setControlled(runtime, target.id)
        setControlling(true)
      }
      setDrive(runtime, input)
    },
    [runtime],
  )
  useDriveKeys(steerable, onDrive)

  /** Back to the live world; alternates still being traced (or all, with `discard`) are dropped. */
  const closeParallel = (discard = false) => {
    window.clearTimeout(parallelTimer.current)
    setParallelOpen(false)
    const plan = parallelPlan.current
    if (discard || !plan || plan.branches.some((b) => !branchDone(b, plan.until))) {
      parallelPlan.current = null
      setWorlds([])
      setParallelMeta(null)
    }
  }
  /**
   * Pulls back to the field of worlds. The alternates fork from the shared
   * past and are traced headless one after another, a few hours per tick;
   * each surfaces as it is done. Reopened soon after, the last field is reused.
   */
  const openParallel = () => {
    if (jumpJob.current) return
    leave()
    setWorldId('this')
    setParallelOpen(true)
    const cached = parallelPlan.current
    if (cached && cached.epoch === runtime.epoch && Math.abs(runtime.eco.clock - cached.until) < 1) return
    parallelPlan.current = null
    setWorlds([])
    setParallelMeta(undefined)
    // Forked only once the camera has pulled back, so the move itself stays smooth.
    parallelTimer.current = window.setTimeout(() => {
      const plan = planParallel(runtime)
      parallelPlan.current = plan
      setParallelMeta(plan ? { fromDay: plan.fromDay, fromClock: plan.fromClock, until: plan.until, branches: plan.branches.length } : null)
      if (!plan) return
      let b = 0
      const tick = () => {
        if (parallelPlan.current !== plan) return
        const branch = plan.branches[b]!
        const began = performance.now()
        let done = false
        while (!done && performance.now() - began < 12) done = stepBranch(branch, runtime.statics, plan.until)
        if (done) {
          setWorlds((list) => [...list, { id: branch.id, eco: branch.work! }])
          b += 1
        }
        if (b < plan.branches.length) parallelTimer.current = window.setTimeout(tick, 16)
      }
      parallelTimer.current = window.setTimeout(tick, 16)
    }, PARALLEL_DELAY_MS)
  }

  /** Drops a running jump; the shown world was never touched. */
  const stopJump = () => {
    closeParallel(true)
    window.clearTimeout(jumpTimer.current)
    jumpJob.current = null
    cancelJump(runtime)
    setJump(null)
    refresh()
  }
  /** Simulates up to clock `until` on a detached copy in slices, showing progress only, then swaps the result in. */
  const runJump = (until: number, label: string) => {
    if (jumpJob.current) return
    release()
    closeParallel(true)
    const job = beginJump(runtime, until)
    jumpJob.current = job
    const start = job.work.clock
    const total = Math.max(until - start, 1e-6)
    const slice = () => {
      if (jumpJob.current !== job) return
      const began = performance.now()
      let done = false
      while (!done && performance.now() - began < JUMP_BUDGET) done = stepJump(runtime, job)
      if (done) {
        finishJump(runtime, job)
        jumpJob.current = null
        setJump(null)
        refresh()
        return
      }
      setJump({ label, done: job.work.clock - start, total })
      jumpTimer.current = window.setTimeout(slice, 0)
    }
    setJump({ label, done: 0, total })
    jumpTimer.current = window.setTimeout(slice, 30)
  }
  const goToDay = (day: number) => {
    if (day === 1 && keptDays(runtime).includes(1)) {
      release()
      closeParallel(true)
      returnToDay(runtime, 1)
      setNoon(runtime, noon)
      refresh()
      return
    }
    runJump(clockOfDay(day), `To Day ${pad(day)}`)
  }

  const changeResolution = (resolution: Resolution) => {
    setResolution(runtime, resolution)
    refresh()
  }

  const chooseSeed = (next: number) => {
    setSeed(next)
    window.clearTimeout(seedTimer.current)
    seedTimer.current = window.setTimeout(() => {
      if (next === runtime.eco.seed) return
      stopJump()
      resetRuntime(runtime, runtime.eco.arch.resolution, next)
      setFogDensityState(FOG_DENSITY)
      refresh()
    }, 250)
  }

  useShortcuts((key) => {
    const lower = key.toLowerCase()
    if (lower === 'p') togglePause()
    else if (lower === 'v') toggleEmbodied(!embodied)
    else if (lower === 'n' && focusable) nextFocus()
    else if (lower === 'l') setLensOn((current) => !current)
    else if (key === 'Escape' && (embodied || controlling)) leave()
    else if (/^[1-3]$/.test(key)) {
      const next = WAY_OPTIONS[Number(key) - 1]?.value
      if (!next) return false
      chooseWay(next)
    }
    else return false
    return true
  })

  const parallel: ParallelView = useMemo(
    () => ({ open: parallelOpen, worlds, selected: worldId, select: setWorldId }),
    [parallelOpen, worlds, worldId, setWorldId],
  )

  const view: SceneView = useMemo(
    () => ({
      way,
      creatureView: creature,
      embodied: embodied && focusable,
      overlays,
      layers: { ...layers, creatures: CREATURES_ENABLED && layers.creatures },
      terrain,
      lod: lod === 'auto' ? 'auto' : (Number(lod) as ArchLod),
      representation,
      lens,
      autoRotate,
      windField: showWind,
      trail: paths ? trace : 'off',
      quality,
      parallel,
    }),
    [way, creature, embodied, focusable, overlays, layers, terrain, lod, representation, lens, autoRotate, showWind, paths, trace, quality, parallel],
  )

  const guideSteps = useMemo(
    () => createGuide02Steps({ setWay: chooseWay, setLens: setLensOn, release: () => setEmbodied(false) }),
    [chooseWay],
  )
  const exitGuide = useCallback(() => setGuiding(false), [])

  const snapshots: PageSnapshotAdapter = {
    page: 'project02',
    schema: SCHEMA,
    saveBlocked: jump ? 'Wait for the day jump to finish before saving.' : null,
    reset: () => {
      stopJump()
      leave()
      window.clearTimeout(seedTimer.current)
      resetRuntime(runtime, 'medium', DEFAULT_SEED)
      setSeed(DEFAULT_SEED)
      setQuality(DEFAULTS.quality)
      setPlaybackState(DEFAULTS.playback)
      setResume('1x')
      setNoonState(START_NOON)
      setGrowth(DEFAULTS.growth)
      setDecaying(DEFAULTS.decaying)
      setDecaySpeed(DEFAULTS.decaySpeed)
      setWayState(DEFAULTS.way)
      setCreature(DEFAULTS.creature)
      setFocus(0)
      setOverlays(DEFAULTS.overlays)
      setLayers(DEFAULTS.layers)
      setPaths(DEFAULTS.paths)
      setTrace(DEFAULTS.trace)
      setTerrain(DEFAULTS.terrain)
      setLod(DEFAULTS.lod)
      setRepresentation(DEFAULTS.representation)
      setDensity(DEFAULTS.density)
      setPlantDensity(runtime, Number(DEFAULTS.density))
      setShowWind(DEFAULTS.windField)
      setWindDegrees(DEFAULTS.windDegrees)
      setWindStrength(DEFAULTS.windStrength)
      setFogDensityState(FOG_DENSITY)
      setLensOn(false)
      refresh()
    },
    capture: () => ({
      summary: `Day ${pad(dayOf(runtime.eco.clock))} · ${formatHour(viewHour)} · ${runtime.eco.arch.count} voxels · ${RESOLUTIONS[runtime.eco.arch.resolution].label}`,
      state: { quality, growth, decaying, decaySpeed, way, creature, overlays, layers, paths, trace, terrain, lod, representation, viewHour },
      payload: { world: packEco(runtime.eco, 6) },
    }),
    restore: (state: SnapshotState, payload: SnapshotPayload | null) => {
      if (!payload?.world) throw new Error('This snapshot is missing its world.')
      const eco = unpackEco(payload.world)
      stopJump()
      leave()
      window.clearTimeout(seedTimer.current)
      eco.seed ??= DEFAULT_SEED
      restoreRuntime(runtime, eco)
      setFogDensityState(runtime.eco.weather.fogDensity)
      setSeed(eco.seed)
      setPlaybackState('pause')
      setQuality(oneOf(state.quality, QUALITY_OPTIONS, DEFAULTS.quality))
      setNoonState(eco.noon)
      setGrowth(oneOf(state.growth, GROWTH_OPTIONS, DEFAULTS.growth))
      setDecaying(state.decaying !== false)
      setDecaySpeed(typeof state.decaySpeed === 'number' ? state.decaySpeed : DEFAULTS.decaySpeed)
      setWayState(oneOf(state.way, WAY_OPTIONS, DEFAULTS.way))
      setCreature(oneOf(state.creature, CREATURE_OPTIONS, DEFAULTS.creature))
      setFocus(0)
      setOverlays(state.overlays !== false)
      if (state.layers && typeof state.layers === 'object') setLayers({ ...DEFAULTS.layers, ...(state.layers as typeof DEFAULTS.layers) })
      setPaths(state.paths !== false)
      setTrace(oneOf(state.trace, TRACE_OPTIONS, DEFAULTS.trace))
      if (state.terrain && typeof state.terrain === 'object') setTerrain({ ...DEFAULTS.terrain, ...(state.terrain as typeof DEFAULTS.terrain) })
      setLod(oneOf(state.lod, LOD_OPTIONS, DEFAULTS.lod))
      setRepresentation(oneOf(state.representation, REPRESENTATION_OPTIONS, DEFAULTS.representation))
      refresh()
    },
  }

  const on = stats.weatherOn
  const weatherNote = `Now ${stats.weather}${stats.windSpeed > 0.02 ? ` · wind ${Math.round(stats.windHeading)}° at ${Math.round(stats.windSpeed * 100)}%` : ''}`
  const lodNote = (counts: [number, number, number]) => counts.join(' / ')
  const day = dayOf(stats.clock)

  return (
    <div className="app-shell ui-system project project02" data-lens={lens ? '' : undefined}>
      <div className="viz-stage">
        <div className="world-canvas-wrap">
          <Canvas
            className="world-canvas"
            camera={{ position: CAMERA_POSITION, fov: 42, near: 0.08, far: 260 }}
            gl={{ antialias: true }}
            dpr={[1, QUALITY[quality].dpr]}
            shadows="percentage"
          >
            <EcoScene runtime={runtime} view={view} noon={noon} />
          </Canvas>
          {lens ? <LensLabel runtime={runtime} /> : null}
          {steerable ? (
            <p className="eco-steer-hint">{controlling ? 'Steering · arrow keys move' + (creature === 'flying' ? ', Q E height' : '') + ' · Esc hands it back' : 'Arrow keys take control · Esc leaves'}</p>
          ) : null}

          <ViewTools
            tools={[
              { label: 'Wireframe', key: 'F', on: terrain.wireframe, onChange: (wireframe) => setTerrain((t) => ({ ...t, wireframe })) },
              { label: 'Contours', key: 'C', on: terrain.contours, onChange: (contours) => setTerrain((t) => ({ ...t, contours })) },
              { label: 'Overlays', key: 'O', on: overlays, onChange: setOverlays },
              { label: 'Auto rotate', key: 'R', on: autoRotate, onChange: setAutoRotate },
            ]}
          />
        </div>
      </div>

      <div className="app-chrome">
        <div className="region-left">
          <ExerciseHeading
            title="Shadow Ecology"
            about={SHADOW_ECOLOGY_ABOUT}
            actions={<LearnToggle label="Guide" active={guiding} onChange={setGuiding} />}
          />
          {tabs}
          <p className="project-tag">
            Terrain → light, weather, water → architecture, vegetation → shelter, habitat → creatures, movement → traces → what grows next
          </p>
        </div>

        <InstrumentPanel label="Shadow Ecology 0.2" utilities={<PageSnapshots adapter={snapshots} />}>
          <div className="eco-quality">
            <ControlField
              label="Quality"
              tip="Rendering cost only: pixel density, shadow detail and refresh, how far architecture and vegetation keep their detail, vegetation shadows, rain and wind particles. The world and its simulation are the same at every level."
            >
              <Segmented label="Quality" options={QUALITY_OPTIONS} value={quality} onChange={setQuality} />
            </ControlField>
          </div>
          <PanelSection index="01" title="Time">
            <div data-learn="time" className="eco-time">
              <div className="eco-time-row">
                <span className="eco-clock">
                  <span className="eco-day">Day {pad(day)}</span> {formatHour(viewHour)}
                </span>
                <Segmented label="Playback" options={PLAYBACK_OPTIONS} value={playback} onChange={choosePlayback} />
              </div>
              <ControlField
                label="Time of day"
                value={formatHour(viewHour)}
                tip="Sets the simulation's time of day; playback continues from there."
              >
                <Slider label="Time of day" min={0} max={24} step={0.05} value={viewHour} onChange={chooseViewHour} />
              </ControlField>
              <div className="eco-jumps" aria-label="Day jump">
                {DAY_JUMPS.map((target) => (
                  <button key={target} type="button" className="text-button" aria-pressed={day === target} disabled={jump !== null} onClick={() => goToDay(target)}>
                    Day {target}
                  </button>
                ))}
              </div>
              <div className="eco-jumps">
                {JUMPS.map(({ hours, label }) => (
                  <button key={hours} type="button" className="text-button" disabled={jump !== null} onClick={() => runJump(runtime.eco.clock + hours, label)}>
                    {label}
                  </button>
                ))}
              </div>
              {jump ? (
                <div className="eco-progress">
                  <span className="eco-bar">
                    <span style={{ width: `${Math.round((jump.done / jump.total) * 100)}%` }} />
                  </span>
                  <span className="readout">
                    {jump.label} · computing {Math.round((jump.done / jump.total) * 100)}%
                  </span>
                  <button type="button" className="text-button" onClick={stopJump}>
                    Stop
                  </button>
                </div>
              ) : null}
              <ControlField label="Noon sun height" value={`${noon}°`} tip="A stand-in for season: a lower sun casts longer shadows and lights the island less.">
                <Slider label="Noon sun height" min={20} max={85} step={1} value={noon} onChange={setNoonState} />
              </ControlField>
            </div>
          </PanelSection>

          <PanelSection
            index="02"
            title="Architecture"
            action={
              <InfoLabel
                title="Rules"
                heading="Architecture rules"
                className="eco-rules"
                tip={
                  <>
                    <span className="eco-rule">
                      <b>Suitable site</b> Lit, gentle ground (full footing under 14°, none past 32°), firm — off the rim, cliff lips and wet ground — and open to the sky.
                    </span>
                    <span className="eco-rule">
                      <b>Factors</b> Light first, then slope, support and open sky; nearness to water pulls weakly and the highest peaks ease off.
                    </span>
                    <span className="eco-rule">
                      <b>Seed {seed}</b> Draws which suitable sites are taken, kept apart with a weak pull to group. The same seed grows the same world.
                    </span>
                    <span className="eco-rule">
                      <b>Growth</b> Fronts on a block lattice climb toward the sun, spread level to join neighbours and drop supports under long reaches, spending energy gathered from light.
                    </span>
                    <span className="eco-rule">
                      <b>Decay</b> Voxels age and weather with exposure, stress, rain and wind; whatever loses its path to the ground falls as rubble, and old sites re-sprout from what survives.
                    </span>
                  </>
                }
              />
            }
          >
            <div data-learn="growth" className="eco-arch">
              <ControlField
                label="Growth"
                tip="Architecture's growth rate relative to world time; the Time speed runs the whole world. Held stops new building while time, weather and vegetation go on."
              >
                <Segmented label="Growth" options={GROWTH_OPTIONS} value={growth} onChange={setGrowth} />
              </ControlField>
              <ControlField
                label="Resolution"
                value={`${RESOLUTIONS[stats.resolution].brush}³ blocks per member`}
                tip="Block size on the lattice. A member keeps its thickness in the world; finer resolutions build it from smaller blocks."
              >
                <Segmented label="Resolution" options={RESOLUTION_OPTIONS} value={stats.resolution} onChange={changeResolution} />
              </ControlField>
              <ControlField label="Representation" tip="How the voxels are drawn: as blocks, or as a Marching Cubes surface through them. The structure itself does not change.">
                <Segmented label="Representation" options={REPRESENTATION_OPTIONS} value={representation} onChange={setRepresentation} />
              </ControlField>
              <ControlField label="Seed" value={String(seed)} tip="Which sites, vegetation and paths the world draws within its suitable regions. The same seed always gives the same world; changing it starts again from Day 1.">
                <Slider label="Seed" min={1} max={999} step={1} value={seed} onChange={chooseSeed} />
              </ControlField>
              <div className="eco-pair">
                <Toggle label="Decay" checked={decaying} onChange={setDecaying} />
                <Slider label="Decay speed" {...RATE} value={decaySpeed} disabled={!decaying} onChange={setDecaySpeed} />
                <span className="readout">{decaySpeed.toFixed(2)}×</span>
              </div>
              <p className="readout">
                <Count>{stats.voxels}</Count> voxels · <Count>{stats.structures}</Count> structures · <Count>{stats.fronts}</Count> fronts · <Count>{stats.collapsed}</Count> fallen
              </p>
            </div>
          </PanelSection>

          <PanelSection
            index="03"
            title="Vegetation"
            action={
              <InfoLabel
                title="Rules"
                heading="Vegetation rules"
                className="eco-rules"
                tip={
                  <>
                    <span className="eco-rule">
                      <b>Light-seeking</b> Warm, tall and upright. Needs direct sun first, moisture second; takes open ground on fair slopes and leans toward the light.
                    </span>
                    <span className="eco-rule">
                      <b>Shadow-seeking</b> Cool, low and spreading. Needs shade — from architecture, terrain or other vegetation — together with moisture.
                    </span>
                    <span className="eco-rule">
                      Both spread from standing vegetation where the ground suits them, kept apart by spacing; rubble and disturbance keep them off, and they grow, age and die back as light and shelter move.
                    </span>
                  </>
                }
              />
            }
          >
            <div data-learn="vegetation" className="eco-veg">
              <div className="eco-veg-kinds">
                <Toggle label="Light-seeking" checked={layers.exposure} onChange={(exposure) => setLayers((l) => ({ ...l, exposure }))} />
                <Toggle label="Shadow-seeking" checked={layers.shelter} onChange={(shelter) => setLayers((l) => ({ ...l, shelter }))} />
              </div>
              <Segmented label="Density" options={DENSITY_OPTIONS} value={density} onChange={chooseDensity} />
              <p className="readout">
                <Count>{stats.exposurePlants}</Count> light-seeking (warm, tall, open) · <Count>{stats.shelterPlants}</Count> shadow-seeking (cool, low, spreading)
              </p>
            </div>
          </PanelSection>

          <PanelSection
            index="04"
            title="Paths"
            action={
              <InfoLabel
                title="Rules"
                heading="Path rules"
                className="eco-rules"
                tip={
                  <>
                    <span className="eco-rule">
                      Paths are traces of use, not roads laid down first. Every few hours a trip goes between meaningful places — standing architecture, reachable shore, sheltered hollows — nearer and more useful pairs more often.
                    </span>
                    <span className="eco-rule">
                      Each takes the cheapest route over the terrain: gentle slopes are easy, structures are walked around, water, cliffs and the rim are never crossed.
                    </span>
                    <span className="eco-rule">
                      Every trip wears its route a little and worn ground is easier to walk, so repeated routes darken into paths; unused ones fade. The same seed wears the same network.
                    </span>
                  </>
                }
              />
            }
          >
            <div data-learn="paths" className="eco-paths">
              <Toggle label="Paths" checked={paths} onChange={setPaths} />
              <ControlField label="Trace amount" tip="How readily worn ground shows as a trace. The routes and how often they are used are the same at every amount.">
                <Segmented label="Trace amount" options={TRACE_OPTIONS} value={trace} onChange={setTrace} />
              </ControlField>
              <p className="readout">
                <Count>{stats.trips}</Count> trips · <Count>{Math.round(stats.pathLength)}</Count> m worn into paths
              </p>
            </div>
          </PanelSection>

          <PanelSection index="05" title="Creatures">
            {CREATURES_ENABLED ? (
              <div className="eco-creatures">
                <Toggle label="Creatures" checked={layers.creatures} onChange={(creatures) => setLayers((l) => ({ ...l, creatures }))} />
                <p className="readout">
                  <Count>{stats.ground}</Count> on the ground · <Count>{stats.flyers}</Count> flyers
                </p>
              </div>
            ) : (
              <p className="eco-note">Not active in this version.</p>
            )}
          </PanelSection>

          <PanelSection index="06" title="Weather">
            <div data-learn="weather" className="eco-weather">
              <div className="eco-weather-row">
                <Toggle label="Auto" checked={stats.weatherAuto} onChange={chooseAuto} />
                <button type="button" className="text-button" onClick={clearSky}>
                  Clear
                </button>
              </div>
              <p className="readout eco-weather-source" data-forcing={stats.weatherAuto ? undefined : ''}>
                {stats.weatherAuto ? 'Auto controls Rain / Fog / Wind' : 'Manual — turn Auto on to resume the cycle'}
              </p>
              <div className="eco-weather-conditions" data-source={stats.weatherAuto ? 'auto' : 'manual'}>
                <Toggle label="Rain" tone="water" checked={on.rain} onChange={(v) => chooseCondition('rain', v)} />
                <Toggle label="Fog" checked={on.fog} onChange={(v) => chooseCondition('fog', v)} />
                {on.fog && (
                  <ControlField label="Fog density" value={fogDensity.toFixed(2)}>
                    <Slider label="Fog density" min={0} max={1} step={0.01} value={fogDensity} onChange={chooseFogDensity} />
                  </ControlField>
                )}
                <Toggle label="Wind" checked={on.wind} onChange={(v) => chooseCondition('wind', v)} />
                <div className="eco-weather-sub">
                  {on.wind && !stats.weatherAuto && (
                    <>
                      <ControlField label="Direction" value={`${windDegrees}°`}>
                        <Slider label="Direction" min={0} max={359} step={1} value={windDegrees} onChange={(d) => steerWind(d, windStrength)} />
                      </ControlField>
                      <ControlField label="Strength" value={windStrength.toFixed(2)}>
                        <Slider label="Strength" min={0} max={1} step={0.01} value={windStrength} onChange={(s) => steerWind(windDegrees, s)} />
                      </ControlField>
                    </>
                  )}
                  <Toggle label="Show Wind Field" checked={showWind} disabled={!on.wind} onChange={setShowWind} />
                </div>
              </div>
              <p className="readout">{weatherNote}</p>
            </div>
          </PanelSection>

          <PanelSection index="07" title="Ways of Seeing">
            <div data-learn="ways" className="eco-ways">
              <Segmented label="Way of seeing" options={WAY_OPTIONS} value={way} onChange={(next) => chooseWay(next)} />
              {CREATURES_ENABLED && way === 'creature' ? (
                <Segmented label="Creature" options={CREATURE_OPTIONS} value={creature} onChange={chooseCreature} />
              ) : null}
              <SenseKeyRow way={way} creature={creature} />
            </div>
            {focusable ? (
              <div data-learn="embody" className="eco-embody">
                <Toggle label="Embody (V)" checked={embodied} onChange={toggleEmbodied} />
                <button type="button" className="text-button" onClick={nextFocus}>
                  Next (N)
                </button>
              </div>
            ) : null}
            {focusable && stats.focus ? (
              <div className="eco-focus-card">
                <p className="eco-focus">{stats.focus}</p>
                <FocusValues values={stats.focusValues} />
                {CREATURES_ENABLED && way === 'creature' ? (
                  <p className="eco-note">
                    {embodied ? 'Arrow keys steer it; Esc hands it back to the ecology.' : 'Embody (V) to see from it and steer it with the arrow keys.'}
                  </p>
                ) : null}
              </div>
            ) : null}
          </PanelSection>

          <PanelSection index="08" title="Observation / History">
            <div data-learn="lens" className="eco-lens">
              <Toggle label="Lens (L)" checked={lens} onChange={setLensOn} />
              <p className="eco-note">
                {lens
                  ? `Move over the world to look closer; click to pin or unpin. Inside, time runs ×${LENS.slow}: the dial's pale hand is outside time, the amber hand inside.`
                  : 'A magnifier that slows time where it rests.'}
              </p>
            </div>
            <div data-learn="parallel" className="eco-parallel">
              <Toggle label="Parallel Worlds" checked={parallelOpen} disabled={!!jump} onChange={(on) => (on ? openParallel() : closeParallel())} />
              {parallelOpen ? (
                <ParallelPanel
                  runtime={runtime}
                  meta={parallelMeta}
                  worlds={worlds}
                  selected={worldId}
                  onSelect={setWorldId}
                  onReturn={() => closeParallel()}
                />
              ) : (
                <p className="eco-note">Pull back: this world is one possible history among several.</p>
              )}
            </div>
            <div data-learn="history">
              <History log={stats.log} />
            </div>
            <div data-learn="detail">
              <Disclosure label="Level of detail">
                <div className="eco-settings">
                  <ControlField
                    label="Detail"
                    value={lod === 'auto' ? 'by distance' : 'held for comparison'}
                    tip="Auto draws each architecture chunk and plant from its distance to the camera: full near, reduced further out, a skeleton far away. Full, Reduced and Skeleton hold everything at one level to compare. The simulation is the same at every level."
                  >
                    <Segmented label="Level of detail" options={LOD_OPTIONS} value={lod} onChange={setLod} />
                  </ControlField>
                  <p className="readout eco-lod">
                    <span>full / reduced / skeleton</span>
                    <span>
                      Architecture {lodNote(stats.lod.archChunks)} chunks · {(stats.lod.archTriangles / 1000).toFixed(0)}k tris
                    </span>
                    <span>
                      Vegetation {lodNote(stats.lod.plants)} · {(stats.lod.plantTriangles / 1000).toFixed(0)}k tris
                    </span>
                    {CREATURES_ENABLED ? (
                      <span>
                        Creatures {lodNote(stats.lod.creatures)} · {(stats.lod.creatureTriangles / 1000).toFixed(1)}k tris
                      </span>
                    ) : null}
                  </p>
                </div>
              </Disclosure>
            </div>
          </PanelSection>
        </InstrumentPanel>
      </div>

      {guiding ? <LearnTour steps={guideSteps} label="Guide · Shadow Ecology 0.2" cues={GUIDE_CUES} onExit={exitGuide} /> : null}
    </div>
  )
}
