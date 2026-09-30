import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useCallback, useMemo, useState } from 'react'
import {
  defaultStudyValues,
  formatParam,
  getSpecimen,
  getSpecimenInfo,
  getStudy,
  GUIDED_STUDIES,
  SHADER_STUDIES,
  SPECIMEN_HEIGHT,
  SPECIMENS,
  STUDY_CONSTANTS,
  TERM_LEGEND,
  type ShaderStudy,
  type ShaderStudyId,
  type SpecimenId,
  type StudyGroup,
  type StudyParam,
  type StudyLegend,
  type StudyValues,
} from './index.ts'
import { sunDirection } from '../../shared/sun.ts'
import {
  AUTO_ROTATE_SPEED,
  ControlField,
  ExerciseHeading,
  InstrumentPanel,
  PanelSection,
  Segmented,
  Slider,
  ViewTools,
  type ExerciseAbout,
  type SegmentOption,
} from '../../shared/ui/instrument.tsx'
import { LearnToggle, LearnTour } from '../../shared/ui/learn.tsx'
import { PageSnapshots, type PageSnapshotAdapter } from '../../shared/ui/PageSnapshots.tsx'
import { useShortcuts } from '../../shared/ui/shortcuts.ts'
import { createShaderLearnSteps } from './learnSteps.tsx'
import { ShaderSpecimen } from './ShaderSpecimen.tsx'
import '../../shared/ui/system.css'
import './week05.css'

const SCENE_BG = '#000000'

const KEY_LIGHT = {
  position: [3.5, 4.5, -1] as [number, number, number],
  intensity: 3,
  color: '#fff8ec',
}

const AMBIENT_INTENSITY = 0.2
const SHADOW_OPACITY = 0.45
const GRID_CENTER_COLOR = '#3d3d3a'
const GRID_COLOR = '#262624'
const FLOOR_SIZE = 6
const ORBIT_TARGET: [number, number, number] = [0, 0.7, 0]

const SUN_MARKER_COLOR = '#fff8ec'
const SUN_MARKER_DISTANCE = 3

const ABOUT: ExerciseAbout = {
  text: 'Three specimens, ten rules. Foundations isolate one shader rule each; applications combine them toward the world: a procedural material, a habitat field read from shadow, a growth front replayed along the form, and weathering read from exposure. Change the study and only the rule changes what the surface tells you; change the geometry and the same rule reads a terrain, a structure or an organism. Read the panel top to bottom: study, the data it reads, the rule, its controls, and what it writes.',
  terms: 'vertex / fragment stage · varyings · uniforms · world position · normal · view vector · shadow map',
  controls: '1–9, 0 study · G geometry · F wireframe · R auto rotate · L guides · drag orbit · scroll zoom',
}

const GEOMETRY_TIP = `The same rules on three procedural forms, all ${SPECIMEN_HEIGHT.toFixed(2)} tall and resting on the floor. ${SPECIMENS.map((item) => `${item.label}: ${item.note}`).join(' ')} Switching geometry keeps the study and its controls.`

const GEOMETRY_OPTIONS = SPECIMENS.map(
  (item): SegmentOption<SpecimenId> => ({ value: item.id, label: item.label }),
)

const GROUP_LABELS: Record<StudyGroup, string> = {
  foundation: 'Foundations',
  application: 'Applications',
}

const STUDY_GROUPS = (Object.keys(GROUP_LABELS) as StudyGroup[]).map((group) => ({
  group,
  options: SHADER_STUDIES.filter((study) => study.group === group).map(
    (study): SegmentOption<ShaderStudyId> => ({ value: study.id, label: study.label }),
  ),
}))

function scaled(
  [x, y, z]: [number, number, number],
  distance: number,
): [number, number, number] {
  return [x * distance, y * distance, z * distance]
}

type OutputView = 'result' | 'term'

const VIEW_OPTIONS: SegmentOption<OutputView>[] = [
  { value: 'result', label: 'Result' },
  { value: 'term', label: 'Term only' },
]

type ValuesById = Record<ShaderStudyId, StudyValues>

function initialValues(): ValuesById {
  return Object.fromEntries(
    SHADER_STUDIES.map((study) => [study.id, defaultStudyValues(study)]),
  ) as ValuesById
}

/** Saved values over the defaults: unknown or missing params fall back per study. */
function restoredValues(saved: unknown): ValuesById {
  const byId = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>
  return Object.fromEntries(
    SHADER_STUDIES.map((study) => {
      const values = (byId[study.id] && typeof byId[study.id] === 'object' ? byId[study.id] : {}) as Record<string, unknown>
      return [
        study.id,
        Object.fromEntries(
          study.params.map((param) => {
            const value = values[param.uniform]
            return [param.uniform, typeof value === 'number' && Number.isFinite(value) ? value : param.default]
          }),
        ),
      ]
    }),
  ) as ValuesById
}

const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback

/** Where the rule runs in the pipeline: the active stage is filled. */
function StageTrack({ stage }: { stage: ShaderStudy['stage'] }) {
  return (
    <div className="stage-track" aria-label={`Runs in the ${stage} stage`}>
      <span className={stage === 'vertex' ? 'stage is-active' : 'stage'}>Vertex</span>
      <span aria-hidden="true">→</span>
      <span className="stage">Raster</span>
      <span aria-hidden="true">→</span>
      <span className={stage === 'fragment' ? 'stage is-active' : 'stage'}>Fragment</span>
    </div>
  )
}

/** A slider, or a segmented choice when the param lists options. */
function ParamControl({
  param,
  value,
  onChange,
}: {
  param: StudyParam
  value: number
  onChange: (next: number) => void
}) {
  return (
    <div data-param={param.uniform}>
      <ControlField
        label={param.label}
        value={param.options ? undefined : formatParam(param, value)}
        tip={param.tip}
        tone={param.tone}
      >
        {param.options ? (
          <Segmented
            label={param.label}
            options={param.options.map((option) => ({
              value: String(option.value),
              label: option.label,
            }))}
            value={String(value)}
            onChange={(next) => onChange(Number(next))}
          />
        ) : (
          <Slider
            label={param.label}
            min={param.min}
            max={param.max}
            step={param.step}
            value={value}
            onChange={onChange}
          />
        )}
      </ControlField>
    </div>
  )
}

function Legend({ legend }: { legend: StudyLegend }) {
  return (
    <div className="legend">
      <div className="legend-bar" style={{ background: legend.gradient }} />
      <div className="legend-labels">
        <span>{legend.start}</span>
        <span>{legend.end}</span>
      </div>
    </div>
  )
}

export function ShadersWeek() {
  const [specimenId, setSpecimenId] = useState<SpecimenId>('surface')
  const [studyId, setStudyId] = useState<ShaderStudyId>('height')
  const [valuesById, setValuesById] = useState<ValuesById>(initialValues)
  const [view, setView] = useState<OutputView>('result')
  const [wireframe, setWireframe] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [guides, setGuides] = useState(true)
  const [learning, setLearning] = useState(false)
  const exitLearning = useCallback(() => setLearning(false), [])
  const learnSteps = useMemo(
    () =>
      createShaderLearnSteps({
        showStudy: (id) => {
          setStudyId(id)
          setView('result')
        },
      }),
    [],
  )

  const specimen = useMemo(() => getSpecimen(specimenId), [specimenId])
  const specimenInfo = getSpecimenInfo(specimenId)
  const study = getStudy(studyId)
  const values = valuesById[studyId]
  const showTerm = view === 'term'
  const sun =
    studyId === 'habitat' ? sunDirection(values.uSunAzimuth, values.uSunElevation) : null
  const lightPosition = sun ? scaled(sun, STUDY_CONSTANTS.sunDistance) : KEY_LIGHT.position

  const setValue = (uniform: string, value: number) =>
    setValuesById((current) => ({
      ...current,
      [studyId]: { ...current[studyId], [uniform]: value },
    }))

  const resetStudy = () =>
    setValuesById((current) => ({ ...current, [studyId]: defaultStudyValues(study) }))

  const snapshots: PageSnapshotAdapter = {
    page: 'week05',
    schema: 1,
    reset: () => {
      setSpecimenId('surface')
      setStudyId('height')
      setValuesById(initialValues())
      setView('result')
      setWireframe(false)
      setAutoRotate(false)
      setGuides(true)
    },
    capture: () => ({
      summary: `${study.label} · ${specimenInfo.label} · ${showTerm ? 'Term only' : 'Result'}`,
      state: { specimenId, studyId, valuesById, view, guides, wireframe },
    }),
    restore: (state) => {
      setSpecimenId(pick(state.specimenId, SPECIMENS.map((item) => item.id), 'surface'))
      setStudyId(pick(state.studyId, SHADER_STUDIES.map((item) => item.id), 'height'))
      setValuesById(restoredValues(state.valuesById))
      setView(pick(state.view, VIEW_OPTIONS.map((option) => option.value), 'result'))
      setGuides(state.guides !== false)
      setWireframe(state.wireframe === true)
    },
  }

  useShortcuts((key) => {
    if (key === 'g' || key === 'G') {
      setSpecimenId((current) => {
        const index = SPECIMENS.findIndex((item) => item.id === current)
        return SPECIMENS[(index + 1) % SPECIMENS.length]!.id
      })
      return true
    }
    const next = /^[0-9]$/.test(key) ? SHADER_STUDIES[(Number(key) + 9) % 10] : undefined
    if (next) {
      setStudyId(next.id)
    }
    return next !== undefined
  })

  return (
    <div className="app-shell ui-system week05">
      <div className="viz-stage">
        <div className="world-canvas-wrap">
          <Canvas
            className="world-canvas"
            camera={{ position: [3.4, 2.4, 3.8], fov: 50 }}
            gl={{ antialias: true }}
            shadows="percentage"
          >
            <color attach="background" args={[SCENE_BG]} />
            <ambientLight intensity={AMBIENT_INTENSITY} />
            <directionalLight
              position={lightPosition}
              intensity={KEY_LIGHT.intensity}
              color={KEY_LIGHT.color}
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-bias={-0.0005}
              shadow-normalBias={0.02}
              shadow-radius={2}
              shadow-camera-left={-3}
              shadow-camera-right={3}
              shadow-camera-top={3}
              shadow-camera-bottom={-3}
              shadow-camera-near={0.5}
              shadow-camera-far={15}
            />
            <ShaderSpecimen
              specimen={specimen}
              studyId={studyId}
              values={values}
              showTerm={showTerm}
              guides={guides}
              wireframe={wireframe}
            />
            {sun ? (
              <mesh position={scaled(sun, SUN_MARKER_DISTANCE)}>
                <sphereGeometry args={[0.06, 16, 12]} />
                <meshBasicMaterial color={SUN_MARKER_COLOR} toneMapped={false} />
              </mesh>
            ) : null}
            {showTerm ? null : (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
                <planeGeometry args={[FLOOR_SIZE, FLOOR_SIZE]} />
                <shadowMaterial transparent opacity={SHADOW_OPACITY} />
              </mesh>
            )}
            <gridHelper args={[FLOOR_SIZE, 12, GRID_CENTER_COLOR, GRID_COLOR]} />
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
              { label: 'Auto rotate', key: 'R', on: autoRotate, onChange: setAutoRotate },
              ...(GUIDED_STUDIES.has(studyId)
                ? [{ label: 'Guides', key: 'L', on: guides, onChange: setGuides }]
                : []),
            ]}
          >
            <p className="readout" aria-live="polite">
              <span>
                Study <strong>{study.label}</strong>
              </span>
              <span>Geometry {specimenInfo.label}</span>
              <span>{study.stage} stage</span>
              {study.stage === 'vertex' ? (
                <span>{specimen.geometry.getAttribute('position').count.toLocaleString('en-US')} vertices</span>
              ) : null}
              {sun ? (
                <span>
                  Sun {values.uSunAzimuth}° az · {values.uSunElevation}° el
                </span>
              ) : null}
              <span>{showTerm ? `Term · ${study.output.term}` : 'Result'}</span>
            </p>
          </ViewTools>
        </div>
      </div>

      <div className="app-chrome">
        <div className="region-left">
          <ExerciseHeading
            title="Shaders"
            about={ABOUT}
            actions={<LearnToggle active={learning} onChange={setLearning} />}
          />
        </div>

        <InstrumentPanel label="Shaders" utilities={<PageSnapshots adapter={snapshots} />}>
          <PanelSection index="01" title="Study">
            <ControlField label="Geometry" value="key G" tip={GEOMETRY_TIP}>
              <Segmented
                label="Specimen geometry"
                options={GEOMETRY_OPTIONS}
                value={specimenId}
                onChange={setSpecimenId}
              />
            </ControlField>
            {STUDY_GROUPS.map(({ group, options }) => (
              <ControlField
                key={group}
                label={GROUP_LABELS[group]}
                value={group === 'foundation' ? 'keys 1–6' : 'keys 7–9, 0'}
                tip={
                  group === 'foundation'
                    ? 'Each foundation isolates one shader rule on the same specimen, light and camera.'
                    : 'Applications combine foundation rules toward the world: a procedural material, a habitat field read from light and shadow, a growth front along a precomputed age field, and weathering read from exposure.'
                }
              >
                <div className="study-select" data-group={group}>
                  <Segmented
                    label={`${GROUP_LABELS[group]} shader study`}
                    options={options}
                    value={studyId}
                    onChange={setStudyId}
                  />
                </div>
              </ControlField>
            ))}
          </PanelSection>

          <PanelSection index="02" title="Input">
            <div className="study-block">
              <StageTrack stage={study.stage} />
              <p className="input-name">{study.input.name}</p>
              <code className="explain-eq">{study.input.source}</code>
              <p className="explain-text">{study.input.note}</p>
            </div>
          </PanelSection>

          <PanelSection index="03" title="Rule">
            <div className="study-block">
              <code className="explain-eq">{study.rule.formula}</code>
              <p className="explain-text">{study.rule.summary}</p>
            </div>
          </PanelSection>

          <PanelSection
            index="04"
            title="Controls"
            action={
              <button type="button" className="text-button" onClick={resetStudy}>
                Reset study
              </button>
            }
          >
            {study.params.map((param) => (
              <ParamControl
                key={param.uniform}
                param={param}
                value={values[param.uniform]}
                onChange={(next) => setValue(param.uniform, next)}
              />
            ))}
          </PanelSection>

          <PanelSection index="05" title="Output">
            <div className="study-block">
              <p className="output-writes">
                <span className="control-label">Writes</span>
                <code className="explain-eq">{study.output.writes}</code>
              </p>
              <p className="explain-text">{study.output.note}</p>
            </div>
            <div data-learn="output-view">
              <ControlField
                label="View"
                tip="Result is the shaded specimen. Term only shows the scalar the rule computes, unlit: 0 is black, 1 is white."
              >
                <Segmented label="Output view" options={VIEW_OPTIONS} value={view} onChange={setView} />
              </ControlField>
            </div>
            <div className="study-block">
              <Legend legend={showTerm ? TERM_LEGEND : study.legend(values)} />
              {showTerm ? <p className="explain-text">{study.output.term}</p> : null}
            </div>
          </PanelSection>
        </InstrumentPanel>
      </div>

      {learning ? (
        <LearnTour steps={learnSteps} label="Learn · Shaders" onExit={exitLearning} />
      ) : null}
    </div>
  )
}
