import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { sunAt } from '../../project/sun.ts'
import {
  AUTO_ROTATE_SPEED,
  CollapsibleRow,
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
import { DistributionScene, type DistributionView } from './DistributionScene.tsx'
import {
  ANALYSIS_COLORS,
  createEnvironment,
  DEFAULT_LAYERS,
  fieldValues,
  FIELDS,
  LAYER_FACTORS,
  LAYER_INFO,
  LAYERS,
  METHODS,
  MIN_POOL,
  NOON_ELEVATION,
  OVERSAMPLE,
  placeLayer,
  placementAt,
  PREFERENCE_FLOOR,
  processedCount,
  SHARED_RANGES,
  shadedLight,
  SLOPE_DISPLAY_MAX,
  structureBlockers,
  type Candidate,
  type CandidateStatus,
  type FieldId,
  type LayerId,
  type LayerSettings,
  type LayerSettingsMap,
  type Method,
  type Placement,
  type PreferenceKey,
} from './distribution.ts'
import { COMPLETE, GENERATION_OPTIONS, useGenerationClock, type GenerationMode } from './generation.ts'
import { createDistributionLearnSteps, type DistributionLearnState } from './learnSteps.tsx'
import '../../shared/ui/system.css'
import './week06.css'

const SCENE_BG = '#000000'
const AMBIENT_INTENSITY = 0.2
const SKY_FILL = { intensity: 0.12, sky: '#c9cfdc', ground: '#1a1917' } as const
const SUN_INTENSITY = 3
const SUN_COLOR = '#fff8ec'
const SUN_LIGHT_DISTANCE = 12
/** The Project's opening afternoon, so shade falls the same way in both. */
const SUN_HOUR = 15.5
const FLOOR_SIZE = 18
const FLOOR_GAP = 0.8
const SHADOW_OPACITY = 0.35
const SHADOW_EXTENT = 6
const CAMERA_POSITION: [number, number, number] = [4.9, 3.3, 5.9]
const ORBIT_TARGET: [number, number, number] = [0, -0.2, 0]

const NO_STRUCTURES: readonly Candidate[] = []

/** Candidates worked through per second at 1×. */
const GENERATION_RATE = 60
type GenerationSpeed = '1' | '4' | '16' | '64'
const GENERATION_SPEEDS: SegmentOption<GenerationSpeed>[] = (['1', '4', '16', '64'] as const).map((speed) => ({
  value: speed,
  label: `${speed}×`,
}))
const DEFAULT_GENERATION_SPEED: GenerationSpeed = '4'

const ABOUT: ExerciseAbout = {
  text: 'Scattering three asset layers over a study terrain: a block of ground with a high massif, an open plain, a plateau ending in a steep escarpment, and a lake with its outlet. Every layer runs one pipeline: seeded candidate points, a check for valid ground, a weight for each, a weighted draw, and a spacing check, until its count is reached. The method only changes the weight. Random gives every place the same odds; Noise gathers points into coherent patches; Environment reads the ground’s elevation, slope, moisture, light and nearness to water through each layer’s preferences. Preferences are soft, so unlikely ground stays possible; valid ground is a hard rule, and water is not valid unless a layer allows it. World shows the result; Analysis shows the candidates, the fields and the weight behind it. Progressive generation replays the same run candidate by candidate.',
  terms: 'scattering · candidates · seed · determinism · coherent noise · environmental field · suitability · weighted draw · spacing',
  controls: '1–3 method · V view · F wireframe · C contours · R auto rotate · drag orbit · scroll zoom',
}

const METHOD_INFO: Record<Method, { label: string; formula: string; summary: string }> = {
  random: {
    label: 'Random',
    formula: 'w = 1',
    summary: 'Every candidate has the same odds. Only the seed and the spacing shape the layout.',
  },
  noise: {
    label: 'Noise',
    formula: 'w = smoothstep(1 − coverage ± edge, rank(fbm(p / cluster + seed)))',
    summary: 'Coherent noise rises and falls smoothly, so neighbouring candidates share their odds. Ranked over the valid ground, its top share (coverage) becomes the patches; everywhere else weighs 0 and stays empty.',
  },
  environment: {
    label: 'Environment',
    formula: 'w = elevation × slope × moisture × light × waterside ÷ best',
    summary: 'Each layer reads the fields that matter to it through its preferences; a factor it does not read stays 1. The factors multiply, then scale so the best valid ground on the block is 1.',
  },
}

const PIPELINE = 'candidate p → valid ground? → w(p) → accept if u < w and clear of spacing'
const VALIDITY =
  'Valid ground is a hard rule for every method: on the block, off the lake and its channel unless the layer allows water, and outside structure footprints for vegetation and colonies. A structure also needs footing under its whole footprint, not just its anchor point: nothing past the block’s edge, its grounded modules on dry ground without a cliff beneath them. The method only weighs the valid ground.'

const METHOD_OPTIONS = METHODS.map(
  (method): SegmentOption<Method> => ({ value: method, label: METHOD_INFO[method].label }),
)

const VIEW_OPTIONS: SegmentOption<DistributionView>[] = [
  { value: 'world', label: 'World' },
  { value: 'analysis', label: 'Analysis' },
]

const LAYER_OPTIONS = LAYERS.map(
  (layer): SegmentOption<LayerId> => ({ value: layer, label: LAYER_INFO[layer].label }),
)

const FIELD_INFO: Record<FieldId, { label: string; low: string; high: string }> = {
  elevation: { label: 'Elevation', low: 'low', high: 'high' },
  slope: { label: 'Slope', low: '0°', high: `${SLOPE_DISPLAY_MAX}°+` },
  moisture: { label: 'Moisture', low: 'dry', high: 'wet' },
  light: { label: 'Light', low: 'shade', high: 'full sun' },
  waterside: { label: 'Waterside', low: 'inland', high: 'shore' },
  weight: { label: 'Weight', low: '0', high: '1' },
}

const FIELD_OPTIONS = FIELDS.map(
  (field): SegmentOption<FieldId> => ({ value: field, label: FIELD_INFO[field].label }),
)

function fieldNote(field: FieldId, method: Method, layer: LayerId): string {
  switch (field) {
    case 'elevation':
      return 'Ground height, from the block’s lowest point (0) to its highest (1).'
    case 'slope':
      return `Steepness of the ground, from flat to ${SLOPE_DISPLAY_MAX}° and steeper.`
    case 'moisture':
      return 'High beside the lake and its channel, and on low ground.'
    case 'light':
      return layer === 'structures'
        ? 'Daily sunlight relative to open flat ground, with the terrain’s own shadows.'
        : 'Daily sunlight relative to open flat ground, after the terrain’s and the structures’ shade.'
    case 'waterside':
      return 'Nearness to the lake or its channel: 1 at the shore, fading inland. A preference, separate from whether water itself is valid ground.'
    case 'weight':
      return method === 'random'
        ? 'Random: 1 on all valid ground. Every candidate has the same odds.'
        : method === 'noise'
          ? 'Noise: the layer’s patches at 1, the ground between them at 0.'
          : 'Suitability: this layer’s preference factors multiplied, the best valid ground scaled to 1.'
  }
}

const PREFERENCES: Record<PreferenceKey, { label: string; low: string; high: string; tip: string }> = {
  elevation: {
    label: 'Elevation',
    low: 'low',
    high: 'high',
    tip: 'Toward low or high ground, relative to the block’s lowest and highest points. 0 ignores height.',
  },
  moisture: {
    label: 'Moisture',
    low: 'dry',
    high: 'wet',
    tip: 'The moisture field, high beside water and on low ground. 0 ignores it.',
  },
  light: {
    label: 'Light',
    low: 'shade',
    high: 'sun',
    tip: 'Daily sunlight. Vegetation and colonies read it after the structures’ shade, so shade-seekers gather beside them.',
  },
  waterside: {
    label: 'Waterside',
    low: 'inland',
    high: 'shore',
    tip: 'Toward the shores of the lake and channel, or away from them. Whether the water itself is valid ground is the separate Allow on water rule.',
  },
}

const PREFERENCE_ORDER: readonly PreferenceKey[] = ['elevation', 'moisture', 'waterside', 'light']

/** Why each layer reads the factors it does; the ones it does not read have no control. */
const FACTOR_NOTES: Record<LayerId, string> = {
  structures: 'Structures read footing, height, the water’s edge and sunlight, as the Project’s architecture seeks well-lit ground by the water.',
  vegetation: 'Vegetation reads moisture, the shore and sunlight, on ground gentle enough to hold soil.',
  colonies: 'Colonies read only shelter and damp. They cling to any slope, so slope is not read.',
}

const PREFERENCE_TIP = `A preference scales the weight, never to zero: at full strength the opposite end still keeps ${Math.round(PREFERENCE_FLOOR * 100)}% of it.`

function formatPreference(value: number, low: string, high: string): string {
  if (Math.abs(value) < 0.005) {
    return 'neutral'
  }
  return `${value > 0 ? high : low} ${Math.abs(value).toFixed(2)}`
}

const STATUS_LABELS: Record<CandidateStatus, string> = {
  accepted: 'accepted',
  rejected: 'lost draw',
  spacing: 'too close',
  invalid: 'on water',
  unsupported: 'no footing',
  blocked: 'blocked',
  unused: 'unused',
}
const STATUS_ORDER: readonly CandidateStatus[] = [
  'accepted',
  'rejected',
  'spacing',
  'invalid',
  'unsupported',
  'blocked',
  'unused',
]

function statusCounts(placement: Placement): Record<CandidateStatus, number> {
  const counts: Record<CandidateStatus, number> = {
    accepted: 0,
    rejected: 0,
    spacing: 0,
    invalid: 0,
    unsupported: 0,
    blocked: 0,
    unused: 0,
  }
  for (const candidate of placement.candidates) {
    counts[candidate.status] += 1
  }
  return counts
}

/** Saved layer settings over the defaults: missing or mistyped values fall back. */
function restoredLayers(saved: unknown): LayerSettingsMap {
  const byId = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>
  return Object.fromEntries(
    LAYERS.map((layer) => {
      const values = (byId[layer] && typeof byId[layer] === 'object' ? byId[layer] : {}) as Record<string, unknown>
      return [
        layer,
        Object.fromEntries(
          Object.entries(DEFAULT_LAYERS[layer]).map(([key, fallback]) => {
            const value = values[key]
            const valid = typeof value === typeof fallback && (typeof value !== 'number' || Number.isFinite(value))
            return [key, valid ? value : fallback]
          }),
        ),
      ]
    }),
  ) as LayerSettingsMap
}

const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback

/** A slider bound to one layer setting, targetable by LEARN as `[data-control="layer-key"]`. */
function SettingSlider({
  control,
  label,
  value,
  display,
  tip,
  range,
  onChange,
}: {
  control: string
  label: string
  value: number
  display: string
  tip?: string
  range: { min: number; max: number; step: number }
  onChange: (next: number) => void
}) {
  return (
    <div data-control={control}>
      <ControlField label={label} value={display} tip={tip}>
        <Slider label={label} min={range.min} max={range.max} step={range.step} value={value} onChange={onChange} />
      </ControlField>
    </div>
  )
}

function LayerRow({
  layer,
  settings,
  placement,
  method,
  expanded,
  onToggle,
  onChange,
}: {
  layer: LayerId
  settings: LayerSettings
  placement: Placement
  method: Method
  expanded: boolean
  onToggle: () => void
  onChange: (next: LayerSettings) => void
}) {
  const info = LAYER_INFO[layer]
  const factors = { ...LAYER_FACTORS[layer], note: FACTOR_NOTES[layer] }
  const placed = placement.accepted.length
  const set = (key: keyof LayerSettings) => (value: number) => onChange({ ...settings, [key]: value })
  const id = (key: keyof LayerSettings) => `${layer}-${key}`

  return (
    <CollapsibleRow
      title={info.label}
      summary={`${placed}/${settings.count} · seed ${settings.seed}`}
      expanded={expanded}
      enabled={settings.enabled}
      onToggle={onToggle}
      onEnabledChange={(enabled) => onChange({ ...settings, enabled })}
    >
      <p className="explain-text">{info.note}</p>

      <SettingSlider
        control={id('count')}
        label="Count"
        value={settings.count}
        display={placed < settings.count ? `${placed} of ${settings.count}` : `${settings.count}`}
        tip={`How many points to place. ${OVERSAMPLE} candidates are drawn per point (at least ${MIN_POOL}); when the weights are selective or the spacing tight, fewer may fit.`}
        range={info.count}
        onChange={set('count')}
      />
      <SettingSlider
        control={id('seed')}
        label="Seed"
        value={settings.seed}
        display={`${settings.seed}`}
        tip="Starts this layer’s random sequence. The same seed and settings always give the same points."
        range={SHARED_RANGES.seed}
        onChange={set('seed')}
      />
      <SettingSlider
        control={id('spacing')}
        label="Spacing"
        value={settings.spacing}
        display={settings.spacing.toFixed(2)}
        tip="The closest two points of this layer may stand, in world units. A hard limit."
        range={info.spacing}
        onChange={set('spacing')}
      />
      <SettingSlider
        control={id('scaleVariation')}
        label="Scale variation"
        value={settings.scaleVariation}
        display={`± ${Math.round(settings.scaleVariation * 100)}%`}
        tip="Each point draws a size within 1 ± this share."
        range={SHARED_RANGES.scaleVariation}
        onChange={set('scaleVariation')}
      />
      <div data-control={id('onWater')}>
        <Toggle
          label="Allow on water"
          checked={settings.onWater}
          onChange={(onWater) => onChange({ ...settings, onWater })}
        />
      </div>

      {method === 'noise' ? (
        <>
          <SettingSlider
            control={id('clusterSize')}
            label="Cluster size"
            value={settings.clusterSize}
            display={settings.clusterSize.toFixed(2)}
            tip="The noise wavelength in world units: how large the patches are."
            range={SHARED_RANGES.clusterSize}
            onChange={set('clusterSize')}
          />
          <SettingSlider
            control={id('coverage')}
            label="Coverage"
            value={settings.coverage}
            display={`${Math.round(settings.coverage * 100)}%`}
            tip="The share of the layer’s valid ground inside the patches; the rest stays empty."
            range={SHARED_RANGES.coverage}
            onChange={set('coverage')}
          />
          <SettingSlider
            control={id('edge')}
            label="Edge"
            value={settings.edge}
            display={settings.edge < 0.005 ? 'hard' : settings.edge.toFixed(2)}
            tip="How the patches end: 0 is a hard edge, higher values thin out gradually into the empty ground."
            range={SHARED_RANGES.edge}
            onChange={set('edge')}
          />
        </>
      ) : null}

      {method === 'environment' ? (
        <>
          <p className="explain-text">{factors.note}</p>
          {factors.slope ? (
            <SettingSlider
              control={id('maxSlope')}
              label="Max slope"
              value={settings.maxSlope}
              display={`${settings.maxSlope}°`}
              tip="The weight eases off from half this slope and keeps a tenth of itself beyond it: steep ground is unlikely, not forbidden."
              range={SHARED_RANGES.maxSlope}
              onChange={set('maxSlope')}
            />
          ) : null}
          {PREFERENCE_ORDER.filter((key) => factors.preferences.includes(key)).map((key) => (
            <SettingSlider
              key={key}
              control={id(key)}
              label={PREFERENCES[key].label}
              value={settings[key]}
              display={formatPreference(settings[key], PREFERENCES[key].low, PREFERENCES[key].high)}
              tip={`${PREFERENCES[key].tip} ${PREFERENCE_TIP}`}
              range={SHARED_RANGES.preference}
              onChange={set(key)}
            />
          ))}
        </>
      ) : null}

      <div className="row-foot">
        <button
          type="button"
          className="text-button"
          onClick={() => onChange({ ...settings, seed: 1 + Math.floor(Math.random() * SHARED_RANGES.seed.max) })}
        >
          New seed
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => onChange({ ...DEFAULT_LAYERS[layer], enabled: settings.enabled })}
        >
          Reset layer
        </button>
      </div>
    </CollapsibleRow>
  )
}

function FieldLegend({ field }: { field: FieldId }) {
  const info = FIELD_INFO[field]
  return (
    <div className="legend">
      <div
        className="legend-bar"
        style={{ background: `linear-gradient(90deg, ${ANALYSIS_COLORS.fieldLow}, ${ANALYSIS_COLORS.fieldHigh})` }}
      />
      <div className="legend-labels">
        <span>{info.low}</span>
        <span>{info.high}</span>
      </div>
    </div>
  )
}

/** What the analysis marks mean, drawn like the marks themselves. */
function MarkKey({ waterInvalid }: { waterInvalid: boolean }) {
  return (
    <ul className="mark-key">
      <li>
        <span className="mark is-ring" style={{ color: ANALYSIS_COLORS.rejected }} aria-hidden="true" />
        Candidate, sized by weight: lost the draw or too close
      </li>
      <li>
        <span className="mark is-ring" style={{ color: ANALYSIS_COLORS.inactive }} aria-hidden="true" />
        Candidate on invalid ground, without footing, in a structure footprint, or not needed
      </li>
      {waterInvalid ? (
        <li>
          <span className="mark is-area" style={{ color: ANALYSIS_COLORS.invalid }} aria-hidden="true" />
          Not valid ground: water
        </li>
      ) : null}
      <li>
        <span className="mark" style={{ color: ANALYSIS_COLORS.accepted }} aria-hidden="true" />
        Accepted, this layer
      </li>
      <li>
        <span className="mark is-small" style={{ color: ANALYSIS_COLORS.otherAccepted }} aria-hidden="true" />
        Accepted, other layers
      </li>
    </ul>
  )
}

/** Week 06 → 01 Distribution. `tabs` is the Spatial Systems subtab row. */
export function DistributionStudy({ tabs }: { tabs: ReactNode }) {
  const [env] = useState(createEnvironment)
  useEffect(
    () => () => {
      env.terrain.geometry.dispose()
      env.terrain.water.dispose()
      env.terrain.field.dispose()
      env.terrain.habitatField.dispose()
    },
    [env],
  )

  const [method, setMethod] = useState<Method>('environment')
  const [layers, setLayers] = useState<LayerSettingsMap>(DEFAULT_LAYERS)
  const [expanded, setExpanded] = useState<LayerId | null>(null)
  const [view, setView] = useState<DistributionView>('world')
  const [field, setField] = useState<FieldId>('weight')
  const [focus, setFocus] = useState<LayerId>('vegetation')
  const [showCandidates, setShowCandidates] = useState(true)
  const [showAccepted, setShowAccepted] = useState(true)
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

  const learnSteps = useMemo(
    () =>
      createDistributionLearnSteps({
        show: (state: DistributionLearnState) => {
          if (state.method) {
            setMethod(state.method)
          }
          if (state.view) {
            setView(state.view)
          }
          if (state.field) {
            setField(state.field)
          }
          if (state.layer) {
            setExpanded(state.layer)
            setFocus(state.layer)
          }
        },
      }),
    [],
  )

  const structures = useMemo(
    () => placeLayer(env, 'structures', layers.structures, method, env.light, []),
    [env, layers.structures, method],
  )
  const placedStructures = layers.structures.enabled ? structures.accepted : NO_STRUCTURES
  const light = useMemo(() => shadedLight(env, placedStructures), [env, placedStructures])
  const blockers = useMemo(() => structureBlockers(env, placedStructures), [env, placedStructures])
  const vegetation = useMemo(
    () => placeLayer(env, 'vegetation', layers.vegetation, method, light, blockers),
    [env, layers.vegetation, method, light, blockers],
  )
  const colonies = useMemo(
    () => placeLayer(env, 'colonies', layers.colonies, method, light, blockers),
    [env, layers.colonies, method, light, blockers],
  )
  const finished = useMemo(
    () => ({ structures, vegetation, colonies }),
    [structures, vegetation, colonies],
  )

  // Progressive generation steps through the finished run in placement order,
  // layer by layer; what is shown is always that run stopped after `shown` candidates.
  const total = LAYERS.reduce((sum, layer) => sum + (layers[layer].enabled ? processedCount(finished[layer]) : 0), 0)
  const shown = generationMode === 'progressive' ? step : COMPLETE
  const generating = shown < total
  const placements = useMemo(() => {
    if (shown === COMPLETE) {
      return finished
    }
    let remaining = shown
    const partial = { ...finished }
    for (const layer of LAYERS) {
      if (layers[layer].enabled) {
        partial[layer] = placementAt(finished[layer], remaining)
        remaining = Math.max(0, remaining - processedCount(finished[layer]))
      }
    }
    return partial
  }, [finished, layers, shown])

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

  const values = useMemo(
    () => fieldValues(env, field, placements[focus]),
    [env, field, placements, focus],
  )
  const counts = useMemo(() => statusCounts(placements[focus]), [placements, focus])

  const sun = sunAt(SUN_HOUR, NOON_ELEVATION)
  const [dx, dy, dz] = sun.direction
  const floorHeight = env.terrain.lowest - FLOOR_GAP
  const methodInfo = METHOD_INFO[method]

  const setLayer = (layer: LayerId) => (next: LayerSettings) =>
    setLayers((current) => ({ ...current, [layer]: next }))
  const toggleRow = (layer: LayerId) => {
    setExpanded((current) => (current === layer ? null : layer))
    setFocus(layer)
  }

  const placedSummary = LAYERS.filter((layer) => layers[layer].enabled)
    .map((layer) => `${LAYER_INFO[layer].label} ${placements[layer].accepted.length}`)
    .join(' · ')

  const snapshots: PageSnapshotAdapter = {
    page: 'week06',
    schema: 1,
    reset: () => {
      setMethod('environment')
      setLayers(DEFAULT_LAYERS)
      setExpanded(null)
      setView('world')
      setField('weight')
      setFocus('vegetation')
      setShowCandidates(true)
      setShowAccepted(true)
      setWireframe(false)
      setContours(false)
      setAutoRotate(false)
      chooseGenerationMode('instant')
    },
    capture: () => ({
      summary: `${methodInfo.label} · ${placedSummary || 'no layers'}`,
      state: { method, layers, view, field, focus, showCandidates, showAccepted, wireframe, contours },
    }),
    restore: (state) => {
      setMethod(pick(state.method, METHODS, 'environment'))
      setLayers(restoredLayers(state.layers))
      setView(pick(state.view, VIEW_OPTIONS.map((option) => option.value), 'world'))
      setField(pick(state.field, FIELDS, 'weight'))
      setFocus(pick(state.focus, LAYERS, 'vegetation'))
      setShowCandidates(state.showCandidates !== false)
      setShowAccepted(state.showAccepted !== false)
      setWireframe(state.wireframe === true)
      setContours(state.contours === true)
      chooseGenerationMode('instant')
    },
  }

  useShortcuts((key) => {
    if (key === 'v' || key === 'V') {
      setView((current) => (current === 'world' ? 'analysis' : 'world'))
      return true
    }
    const next = /^[1-3]$/.test(key) ? METHODS[Number(key) - 1] : undefined
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
            <DistributionScene
              env={env}
              view={view}
              placements={placements}
              layers={layers}
              focus={focus}
              fieldValues={values}
              showCandidates={showCandidates}
              showAccepted={showAccepted}
              contours={contours}
              wireframe={wireframe}
            />
            {view === 'world' ? (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floorHeight - 0.002, 0]} receiveShadow>
                <planeGeometry args={[FLOOR_SIZE, FLOOR_SIZE]} />
                <shadowMaterial transparent opacity={SHADOW_OPACITY} />
              </mesh>
            ) : null}
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
              ...(view === 'world'
                ? [{ label: 'Contours', key: 'C', on: contours, onChange: setContours }]
                : []),
              { label: 'Auto rotate', key: 'R', on: autoRotate, onChange: setAutoRotate },
            ]}
          >
            <p className="readout" aria-live="polite">
              <span>
                Method <strong>{methodInfo.label}</strong>
              </span>
              {LAYERS.filter((layer) => layers[layer].enabled).map((layer) => (
                <span key={layer}>
                  {LAYER_INFO[layer].label} {placements[layer].accepted.length}/{layers[layer].count}
                </span>
              ))}
              {generating ? <span>Generating {Math.round((100 * Math.min(step, total)) / total)}%</span> : null}
              <span>
                {view === 'world'
                  ? 'World'
                  : `Analysis · ${LAYER_INFO[focus].label} · ${FIELD_INFO[field].label}`}
              </span>
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

        <InstrumentPanel label="Distribution" utilities={<PageSnapshots adapter={snapshots} />}>
          <PanelSection
            index="01"
            title="Method"
            tip="How each candidate gets its weight. The rest of the pipeline is the same for every method, and the method applies to all three layers so they can be compared."
            status={
              generating ? (
                <span className="section-status">
                  {Math.min(step, total)} / {total}
                </span>
              ) : undefined
            }
          >
            <div data-learn="method">
              <ControlField label="Weight from" value="keys 1–3">
                <Segmented label="Distribution method" options={METHOD_OPTIONS} value={method} onChange={setMethod} />
              </ControlField>
            </div>
            <ControlField
              label="Generation"
              tip="Instant shows the finished placement. Progressive replays the same run candidate by candidate — structures, then vegetation, then colonies — and always ends on the same result for the same seed and settings."
            >
              <Segmented
                label="Generation"
                options={GENERATION_OPTIONS}
                value={generationMode}
                onChange={chooseGenerationMode}
              />
            </ControlField>
            {generationMode === 'progressive' ? (
              <ControlField
                label="Generation speed"
                value={`${generationRate} / s`}
                tip="Candidates worked through per second."
              >
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
            <Disclosure label="How it works">
              <div className="study-block">
                <code className="explain-eq">{methodInfo.formula}</code>
                <p className="explain-text">{methodInfo.summary}</p>
                <code className="explain-eq is-quiet">{PIPELINE}</code>
                <p className="explain-text">{VALIDITY}</p>
              </div>
            </Disclosure>
          </PanelSection>

          <PanelSection
            index="02"
            title="Layers"
            tip="Placed in order: structures first, then vegetation and colonies, which cannot stand in structure footprints and read the light after the structures’ shade. Untick a layer to hide it and lift its influence."
          >
            <div className="row-list">
              {LAYERS.map((layer) => (
                <LayerRow
                  key={layer}
                  layer={layer}
                  settings={layers[layer]}
                  placement={placements[layer]}
                  method={method}
                  expanded={expanded === layer}
                  onToggle={() => toggleRow(layer)}
                  onChange={setLayer(layer)}
                />
              ))}
            </div>
          </PanelSection>

          <PanelSection index="03" title="View">
            <div data-learn="view">
              <ControlField
                label="View"
                value="key V"
                tip="World is the distribution on the study terrain. Analysis draws one layer’s candidates over a field, so the logic behind the placement is visible."
              >
                <Segmented label="View" options={VIEW_OPTIONS} value={view} onChange={setView} />
              </ControlField>
            </div>

            {view === 'analysis' ? (
              <>
                <ControlField
                  label="Layer"
                  tip="The layer whose candidates and weight are drawn. Opening a layer’s row also selects it."
                >
                  <Segmented label="Analysed layer" options={LAYER_OPTIONS} value={focus} onChange={setFocus} />
                </ControlField>
                <div data-learn="field">
                  <ControlField
                    label="Field"
                    tip="The value drawn on the ground: one of the environmental fields, or the weight the method gives this layer."
                  >
                    <div className="field-select">
                      <Segmented label="Analysis field" options={FIELD_OPTIONS} value={field} onChange={setField} />
                    </div>
                  </ControlField>
                </div>
                <div className="study-block">
                  <FieldLegend field={field} />
                  <p className="explain-text">{fieldNote(field, method, focus)}</p>
                </div>
                <div data-learn="marks" className="study-block">
                  <Toggle label="Candidates" checked={showCandidates} onChange={setShowCandidates} />
                  <Toggle label="Accepted points" checked={showAccepted} onChange={setShowAccepted} />
                  <MarkKey waterInvalid={!layers[focus].onWater} />
                  <p className="readout">
                    {STATUS_ORDER.map((status) => (
                      <span key={status}>
                        {status === 'accepted' ? <strong>{counts[status]}</strong> : counts[status]}{' '}
                        {STATUS_LABELS[status]}
                      </span>
                    ))}
                  </p>
                </div>
              </>
            ) : null}
          </PanelSection>
        </InstrumentPanel>
      </div>

      {learning ? (
        <LearnTour steps={learnSteps} label="Learn · Spatial Systems" onExit={exitLearning} />
      ) : null}
    </div>
  )
}
