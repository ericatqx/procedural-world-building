import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { PROJECT_COLORS } from '../../project/materials.ts'
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
import {
  compassName,
  createWeatherField,
  DEFAULT_FIELD_SETTINGS,
  FIELD_RANGES,
  PARTICLE_KINDS,
  PARTICLE_PRESETS,
  type FieldSettings,
  type ParticleKind,
} from './fields.ts'
import { createFieldsLearnSteps, type FieldsLearnState } from './fieldsLearnSteps.tsx'
import { FieldsScene, type FieldOverlays } from './FieldsScene.tsx'
import { createStudyTerrain } from './studyTerrain.ts'
import '../../shared/ui/system.css'
import './week06.css'

const SCENE_BG = '#000000'
const AMBIENT_INTENSITY = 0.2
const SKY_FILL = { intensity: 0.12, sky: '#c9cfdc', ground: '#1a1917' } as const
const SUN_INTENSITY = 3
const SUN_COLOR = '#fff8ec'
const SUN_LIGHT_DISTANCE = 12
/** The same afternoon as Distribution and Paths. */
const SUN_HOUR = 15.5
const FLOOR_SIZE = 18
const FLOOR_GAP = 0.8
const SHADOW_OPACITY = 0.35
const SHADOW_EXTENT = 6
const CAMERA_POSITION: [number, number, number] = [4.9, 3.3, 5.9]
const ORBIT_TARGET: [number, number, number] = [0, -0.2, 0]

const ABOUT: ExerciseAbout = {
  text: 'A vector field over the study terrain, made visible by particles. The field is the air: a prevailing wind, turned along rising ground, faster over the crest and sheltered in its lee, with eddies carried downwind. Nothing draws the air itself; Wind, Rain, Snow and Mist each read the same field through their own fall, drag and influence, and the arrows show it directly. Rain landing on the lake now and then rings its surface, and a click on the lake does the same. Exposure reads the field at the ground, the first step toward weather-driven weathering in Shadow Ecology. The same seed and settings give the same weather.',
  terms: 'vector field · prevailing wind · steering · shelter · lee · curl noise · stream function · drag · terminal velocity · ripple · exposure',
  controls: '1–4 particles · click lake ripple · F wireframe · C contours · R auto rotate · drag orbit · scroll zoom',
}

const PARTICLE_OPTIONS = PARTICLE_KINDS.map(
  (kind): SegmentOption<ParticleKind> => ({ value: kind, label: PARTICLE_PRESETS[kind].label }),
)

/** How each preset reads the field, for How it works. */
const PARTICLE_NOTES: Record<ParticleKind, string> = {
  wind: 'a weightless tracer: it takes on all of the air at once, so its streaks draw the field itself, sliding over the ground.',
  rain: 'heavy: it falls fast and takes only half the wind, so it slants; it is reborn where it lands.',
  snow: 'light: it falls slowly and flutters, so the eddies carry it; it lies a moment where it lands.',
  mist: 'slow: it hovers just above the surface and drains down the slope, born mostly over low, wet ground, so it gathers in hollows and over the lake.',
}

const DEFAULT_OVERLAYS: FieldOverlays = { particles: true, arrows: false, exposure: false }
const OVERLAY_KEYS = Object.keys(DEFAULT_OVERLAYS) as (keyof FieldOverlays)[]

type SliderSpec = { key: keyof FieldSettings; label: string; display: (value: number) => string; tip: string }

const CONTROLS: readonly SliderSpec[] = [
  {
    key: 'direction',
    label: 'Direction',
    display: (v) => `from ${compassName(v)} · ${v}°`,
    tip: 'The compass bearing the prevailing wind blows from: 0° north, 90° east. The block’s back edge faces north.',
  },
  {
    key: 'strength',
    label: 'Strength',
    display: (v) => (v < 0.005 ? 'calm' : v.toFixed(2)),
    tip: 'Speed of the prevailing wind over open ground. At calm only the eddies move the air.',
  },
  {
    key: 'turbulence',
    label: 'Turbulence',
    display: (v) => (v < 0.005 ? 'steady' : v.toFixed(2)),
    tip: 'Strength of the eddies: swirls that drift downwind with the wind and slowly change, stronger in the lee.',
  },
  {
    key: 'terrain',
    label: 'Terrain response',
    display: (v) => (v < 0.005 ? 'off' : `${Math.round(v * 100)}%`),
    tip: 'How strongly the ground shapes the wind: turning it along rising ground ahead, speeding it over the high ground, and slowing it in the lee of higher ground upwind. At off the prevailing wind passes as if the ground were not there.',
  },
  {
    key: 'seed',
    label: 'Seed',
    display: (v) => `${v}`,
    tip: 'Starts the eddy pattern and the particles’ random sequence. The same seed and settings always give the same weather.',
  },
]

function restoredSettings(saved: unknown): FieldSettings {
  const values = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(DEFAULT_FIELD_SETTINGS).map(([key, fallback]) => {
      const value = values[key]
      const range = FIELD_RANGES[key as keyof FieldSettings]
      return [
        key,
        typeof value === 'number' && Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : fallback,
      ]
    }),
  ) as FieldSettings
}

function restoredOverlays(saved: unknown): FieldOverlays {
  const values = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>
  return Object.fromEntries(
    OVERLAY_KEYS.map((key) => [key, typeof values[key] === 'boolean' ? values[key] : DEFAULT_OVERLAYS[key]]),
  ) as FieldOverlays
}

const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback

/** What each visible mark means, drawn like it. */
function MarkKey({ kind, overlays }: { kind: ParticleKind; overlays: FieldOverlays }) {
  const preset = PARTICLE_PRESETS[kind]
  return (
    <ul className="mark-key">
      {overlays.particles ? (
        <li>
          <span
            className={preset.draw === 'streak' ? 'mark is-line' : 'mark is-small'}
            style={{ color: preset.color }}
            aria-hidden="true"
          />
          {preset.label} {preset.draw === 'streak' ? 'streak, along its motion' : 'particle'}
        </li>
      ) : null}
      {overlays.arrows ? (
        <li>
          <span className="mark is-line" style={{ color: 'var(--ink)' }} aria-hidden="true" />
          Field near the ground, longer where faster
        </li>
      ) : null}
      {overlays.exposure ? (
        <li>
          <span className="mark is-area" style={{ color: 'var(--sediment)' }} aria-hidden="true" />
          Exposed: high, open, or facing the wind
        </li>
      ) : null}
      <li>
        <span className="mark is-ring" style={{ color: PROJECT_COLORS.waterLine }} aria-hidden="true" />
        Ripple: rain on the lake, or click it
      </li>
    </ul>
  )
}

/** Week 06 → 03 Fields. `tabs` is the Spatial Systems subtab row. */
export function FieldsStudy({ tabs }: { tabs: ReactNode }) {
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

  const [kind, setKind] = useState<ParticleKind>('wind')
  const [settings, setSettings] = useState<FieldSettings>(DEFAULT_FIELD_SETTINGS)
  const [overlays, setOverlays] = useState<FieldOverlays>(DEFAULT_OVERLAYS)
  const [wireframe, setWireframe] = useState(false)
  const [contours, setContours] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [learning, setLearning] = useState(false)
  const exitLearning = useCallback(() => setLearning(false), [])

  const field = useMemo(() => createWeatherField(settings), [settings])
  const preset = PARTICLE_PRESETS[kind]

  const learnSteps = useMemo(
    () =>
      createFieldsLearnSteps({
        show: (state: FieldsLearnState) => {
          if (state.kind) {
            setKind(state.kind)
          }
          if (state.overlays) {
            setOverlays((current) => ({ ...current, ...state.overlays }))
          }
        },
      }),
    [],
  )

  const sun = sunAt(SUN_HOUR, NOON_ELEVATION)
  const [dx, dy, dz] = sun.direction
  const floorHeight = terrain.lowest - FLOOR_GAP

  const setOverlay = (key: keyof FieldOverlays) => (on: boolean) => setOverlays((current) => ({ ...current, [key]: on }))
  const setSetting = (key: keyof FieldSettings) => (value: number) => setSettings((current) => ({ ...current, [key]: value }))

  const wind = settings.strength < 0.005 ? 'Calm' : `From ${compassName(settings.direction)} ${settings.direction}° · ${settings.strength.toFixed(2)}`

  const snapshots: PageSnapshotAdapter = {
    page: 'week06fields',
    schema: 1,
    reset: () => {
      setKind('wind')
      setSettings(DEFAULT_FIELD_SETTINGS)
      setOverlays(DEFAULT_OVERLAYS)
      setWireframe(false)
      setContours(false)
      setAutoRotate(false)
    },
    capture: () => ({
      summary: `${preset.label} · ${wind}`,
      state: { kind, settings, overlays, wireframe, contours },
    }),
    restore: (state) => {
      setKind(pick(state.kind, PARTICLE_KINDS, 'wind'))
      setSettings(restoredSettings(state.settings))
      setOverlays(restoredOverlays(state.overlays))
      setWireframe(state.wireframe === true)
      setContours(state.contours === true)
    },
  }

  useShortcuts((key) => {
    const next = /^[1-4]$/.test(key) ? PARTICLE_KINDS[Number(key) - 1] : undefined
    if (next) {
      setKind(next)
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
            <FieldsScene
              terrain={terrain}
              field={field}
              kind={kind}
              overlays={overlays}
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
                Particles <strong>{preset.label}</strong>
              </span>
              <span>{preset.count.toLocaleString('en')}</span>
              <span>{wind}</span>
              <span>Turbulence {settings.turbulence.toFixed(2)}</span>
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

        <InstrumentPanel label="Fields" utilities={<PageSnapshots adapter={snapshots} />}>
          <PanelSection
            index="01"
            title="Particles"
            tip="What makes the field visible. Every preset reads the same field; they differ only in how they answer it."
          >
            <div data-learn="particles">
              <ControlField label="Particles" value="keys 1–4">
                <Segmented label="Particles" options={PARTICLE_OPTIONS} value={kind} onChange={setKind} />
              </ControlField>
            </div>
            <Disclosure label="How it works">
              <div className="study-block">
                <code className="explain-eq">
                  v_air = s · steer(d, ∇h) · lee · crest · profile(y) + τ · curl ψ(x − U t)
                </code>
                <p className="explain-text">
                  The field is the system; the particles only make it visible. At every point it gives the air’s
                  velocity: the prevailing wind from Direction at Strength, turned along rising ground ahead of it,
                  faster over the high ground, and slowed near the surface wherever higher ground stands upwind (the
                  lee). Terrain response scales all three: at off the wind is one direction and speed everywhere; at
                  full it turns by up to about 60°, runs up to nearly twice as fast over the massif and plateau, and
                  drops below half speed in the lee. Close to the ground it also rides up and over the slope. Turbulence adds eddies, the curl of a
                  noise stream function ψ, so the air swirls without piling up anywhere; they drift downwind with the
                  wind (U) as they slowly change, and are stronger in the lee.
                </p>
                <code className="explain-eq">v ← v + (k · v_air − fall · ŷ − v) · (1 − e^(−r·Δt))</code>
                <p className="explain-text">
                  Each particle relaxes toward a target velocity: the air where it is, scaled by its influence k,
                  plus its own fall. Its response r, drag over mass, sets how quickly. The same field, read through
                  different k, r and fall, gives four weathers.
                </p>
                <dl className="preset-table">
                  <dt />
                  <dd>fall</dd>
                  <dd>response</dd>
                  <dd>influence</dd>
                  {PARTICLE_KINDS.map((id) => {
                    const p = PARTICLE_PRESETS[id]
                    return (
                      <div key={id} className={id === kind ? 'is-current' : undefined}>
                        <dt>{p.label}</dt>
                        <dd>{p.fall.toFixed(2)}</dd>
                        <dd>{p.response.toFixed(1)}</dd>
                        <dd>{Math.round(p.influence * 100)}%</dd>
                      </div>
                    )
                  })}
                </dl>
                <p className="explain-text">
                  {preset.label} is {PARTICLE_NOTES[kind]}
                </p>
                <p className="explain-text">
                  Ripples belong to the water, not the air: now and then a raindrop landing on the lake starts two thin
                  rings, and a click on the lake starts three, spreading and fading over a second or two. They are
                  drawn on the surface, not simulated, and do not move the wind. Clicking land does nothing.
                </p>
                <p className="explain-text">
                  Toward Shadow Ecology: Exposure reads the same field at the ground, high, open to the wind, or
                  facing into it. The Project weathers its architecture by form alone (age, openness, height,
                  support); a field like this is the missing weather term: weather field → exposure and shelter →
                  accumulated weathering → decay. Decay is not modelled here.
                </p>
                <p className="explain-text">
                  The field is a function of position, time and settings. Particles step 60 times a
                  second and are reborn from a seeded sequence, so the same seed and settings give the same weather.
                </p>
              </div>
            </Disclosure>
          </PanelSection>

          <PanelSection index="02" title="Field" tip="The properties of the air itself. Particles in flight answer every change.">
            {CONTROLS.map((spec) => (
              <div key={spec.key} data-control={`field-${spec.key}`}>
                <ControlField label={spec.label} value={spec.display(settings[spec.key])} tip={spec.tip}>
                  <Slider
                    label={spec.label}
                    min={FIELD_RANGES[spec.key].min}
                    max={FIELD_RANGES[spec.key].max}
                    step={FIELD_RANGES[spec.key].step}
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
                onClick={() => setSetting('seed')(1 + Math.floor(Math.random() * FIELD_RANGES.seed.max))}
              >
                New seed
              </button>
              <button type="button" className="text-button" onClick={() => setSettings(DEFAULT_FIELD_SETTINGS)}>
                Reset field
              </button>
            </div>
          </PanelSection>

          <PanelSection
            index="03"
            title="Study"
            tip="Reveal the field behind the particles, and what it does at the ground."
          >
            <div data-learn="study" className="study-block">
              <Toggle label="Particles" checked={overlays.particles} onChange={setOverlay('particles')} />
              <Toggle label="Field arrows" checked={overlays.arrows} onChange={setOverlay('arrows')} />
              <Toggle label="Exposure" checked={overlays.exposure} onChange={setOverlay('exposure')} />
              <MarkKey kind={kind} overlays={overlays} />
            </div>
          </PanelSection>
        </InstrumentPanel>
      </div>

      {learning ? <LearnTour steps={learnSteps} label="Learn · Spatial Systems · Fields" onExit={exitLearning} /> : null}
    </div>
  )
}
