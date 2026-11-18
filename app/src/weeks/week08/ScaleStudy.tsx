import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
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
import { useShortcuts } from '../../shared/ui/shortcuts.ts'
import { createScaleLearnSteps, type ScaleLearnState } from './learnSteps.tsx'
import { ScaleScene, type CameraRequest, type ViewReport } from './ScaleScene.tsx'
import {
  angularSize,
  apparentPixels,
  cellLegibility,
  framingDistance,
  legibleFeature,
  MESH_LEVELS,
  meshDeviation,
  meshTriangles,
  DEPTH,
  OBJECTS,
  PROJECT_FOV,
  PROJECT_SCALE,
  sizeOf,
  VIEWPOINTS,
  type MeshLevel,
  voxelise,
} from './scale.ts'
import '../../shared/ui/system.css'
import './week08.css'

const ABOUT: ExerciseAbout = {
  text: 'One working scale for the whole study: 1 unit is 1 metre. A person, a creature, two plants and a Living Architecture organism stand side by side at true proportion, and you change what decides how big they feel: the object, the camera’s distance and field of view, and the resolution of the grid that holds them. A person is always there to read against. The Shadow Ecology 0.3 numbers (a 4.1 km island, an eye at 1.75 m, a 38 m reference organism, 1.5 m voxels) are copied into the study as constants, not imported, so the three camera distances of the project can be tried on any object.',
  terms: 'working scale · true proportion · apparent size · field of view · dolly zoom · resolution · cell size · legibility',
  controls: '1–5 object · V voxels · F wireframe · R auto rotate · drag orbit · scroll zoom',
}

const FOV_RANGE = { min: 20, max: 90 }
const DEFAULT_FOV = 42
const FOV_PRESETS = [
  { label: 'Telephoto', fov: 20 },
  { label: '0.3 camera', fov: PROJECT_FOV },
  { label: 'Wide', fov: 90 },
] as const
const DISTANCE_LOG = { min: Math.log10(1.5), max: Math.log10(3500) }

type Form = 'smooth' | 'voxels' | 'mesh'
const FORM_OPTIONS: SegmentOption<Form>[] = [
  { value: 'smooth', label: 'Smooth' },
  { value: 'voxels', label: 'Cells' },
  { value: 'mesh', label: 'Mesh' },
]
const MESH_OPTIONS: SegmentOption<MeshLevel>[] = (Object.keys(MESH_LEVELS) as MeshLevel[]).map((value) => ({ value, label: MESH_LEVELS[value].label }))

const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : m >= 100 ? `${Math.round(m)} m` : m >= 10 ? `${m.toFixed(1)} m` : m >= 1 ? `${m.toFixed(2)} m` : `${(m * 100).toFixed(m < 0.1 ? 1 : 0)} cm`)

const LADDER = { lo: -1, hi: 4, width: 300, height: 92 }
const ladderX = (m: number) => ((Math.log10(Math.max(0.1, Math.min(10000, m))) - LADDER.lo) / (LADDER.hi - LADDER.lo)) * (LADDER.width - 20) + 10

/** Every size in the study on one logarithmic ruler, with the camera's distance and the smallest feature it can still show. */
function ScaleLadder({ distance, feature, selected }: { distance: number; feature: number; selected: string }) {
  const marks = [
    ...OBJECTS.map((o) => ({ id: o.id, label: o.label, size: Math.max(...sizeOf(o.parts)) })),
    { id: 'island', label: 'Island', size: PROJECT_SCALE.island },
  ]
  return (
    <svg className="scale-ladder" viewBox={`0 0 ${LADDER.width} ${LADDER.height}`} role="img" aria-label="Sizes on a logarithmic ruler, from 10 centimetres to 10 kilometres">
      <line x1={10} x2={LADDER.width - 10} y1={52} y2={52} className="ladder-axis" />
      {[0.1, 1, 10, 100, 1000, 10000].map((m) => (
        <g key={m}>
          <line x1={ladderX(m)} x2={ladderX(m)} y1={48} y2={56} className="ladder-axis" />
          <text x={ladderX(m)} y={68} className="ladder-tick" textAnchor="middle">
            {m >= 1000 ? `${m / 1000} km` : `${m} m`}
          </text>
        </g>
      ))}
      {marks.map((m, i) => (
        <g key={m.id} className={m.id === selected ? 'ladder-mark is-selected' : 'ladder-mark'}>
          <circle cx={ladderX(m.size)} cy={52} r={m.id === selected ? 4 : 3} />
          <text x={ladderX(m.size)} y={i % 2 === 0 ? 38 : 26} textAnchor="middle">
            {m.label}
          </text>
        </g>
      ))}
      <g className="ladder-camera">
        <line x1={ladderX(distance)} x2={ladderX(distance)} y1={14} y2={82} />
        <text x={ladderX(distance)} y={90} textAnchor="middle">
          camera
        </text>
      </g>
      <g className="ladder-feature">
        <line x1={ladderX(feature)} x2={ladderX(feature)} y1={44} y2={60} />
        <text x={ladderX(feature)} y={80} textAnchor="middle">
          3 px
        </text>
      </g>
    </svg>
  )
}

function Tag({ kind }: { kind: 'computed' | 'provisional' | 'project' }) {
  return <span className={`scale-tag is-${kind}`}>{kind === 'computed' ? 'Computed' : kind === 'provisional' ? 'Provisional' : 'From 0.3'}</span>
}

/** How big a pole looks as a share of the view's height, from its depth. */
const poleShare = (height: number, depth: number, fov: number, heightPx: number) => apparentPixels(height, depth, fov, heightPx) / Math.max(1, heightPx)

function Note({ children }: { children: ReactNode }) {
  return <p className="explain-text">{children}</p>
}

export function ScaleStudy({ tabs }: { tabs: ReactNode }) {
  const [selectedId, setSelectedId] = useState('la01')
  const selected = OBJECTS.find((o) => o.id === selectedId) ?? OBJECTS[0]!
  const [form, setForm] = useState<Form>('smooth')
  const [meshLevel, setMeshLevel] = useState<MeshLevel>('medium')
  const [wireframe, setWireframe] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [reference, setReference] = useState(true)
  const [dimensions, setDimensions] = useState(true)
  const [grid, setGrid] = useState(true)
  const [fov, setFov] = useState(DEFAULT_FOV)
  const [dolly, setDolly] = useState(false)
  const [poles, setPoles] = useState(true)
  const [sweep, setSweep] = useState(false)
  const [learning, setLearning] = useState(false)
  const exitLearning = useCallback(() => setLearning(false), [])
  const [view, setView] = useState<ViewReport>({ distance: 90, heightPx: 700, front: 60, back: 160 })
  const serial = useRef(1)
  const [request, setRequest] = useState<CameraRequest>({ id: 0, distance: framingDistance(Math.max(...sizeOf(selected.parts)), DEFAULT_FOV), elevation: 10 })
  const ask = useCallback((distance: number, elevation?: number) => {
    serial.current += 1
    setRequest({ id: serial.current, distance, elevation })
  }, [])

  const size = useMemo(() => sizeOf(selected.parts), [selected])
  const longest = Math.max(...size)
  const cellMin = Math.max(0.03, longest / 48)
  const cellMax = Math.max(cellMin * 2, longest / 3)
  const [cellLog, setCellLog] = useState(() => Math.log10(Math.max(1, longest / 24)))
  const cell = Math.min(cellMax, Math.max(cellMin, 10 ** cellLog))
  const cells = useMemo(() => (form === 'voxels' ? voxelise(selected.parts, cell) : new Float32Array(0)), [form, selected, cell])

  const choose = useCallback(
    (id: string) => {
      const next = OBJECTS.find((o) => o.id === id)
      if (!next) return
      const nextLongest = Math.max(...sizeOf(next.parts))
      setSelectedId(id)
      setCellLog(Math.log10(Math.max(0.03, nextLongest / 24)))
      ask(framingDistance(nextLongest, fov), 10)
    },
    [ask, fov],
  )
  useShortcuts((key) => {
    const index = /^[1-5]$/.test(key) ? Number(key) - 1 : -1
    if (index >= 0 && OBJECTS[index]) {
      choose(OBJECTS[index]!.id)
      return true
    }
    if (key.toLowerCase() === 'v') {
      setForm((f) => (f === 'voxels' ? 'smooth' : 'voxels'))
      return true
    }
    return false
  })

  // The field of view moves by hand or by the sweep; the camera rig does the dolly when the lens changes.
  const changeFov = (next: number) => {
    setSweep(false)
    setFov(next)
  }
  useEffect(() => {
    if (!sweep) return
    const start = performance.now()
    const id = window.setInterval(() => {
      const t = (performance.now() - start) / 1000
      setFov(Math.round(55 + 35 * Math.sin(t * 0.9 - Math.PI / 2 + 0.8)))
    }, 40)
    return () => window.clearInterval(id)
  }, [sweep])

  const learnSteps = useMemo(
    () =>
      createScaleLearnSteps({
        show: (state: ScaleLearnState) => {
          setSweep(false)
          const next = state.object ? OBJECTS.find((o) => o.id === state.object) : undefined
          if (next) {
            setSelectedId(next.id)
            setCellLog(Math.log10(Math.max(0.03, Math.max(...sizeOf(next.parts)) / 24)))
          }
          if (state.form) setForm(state.form)
          if (state.mesh) setMeshLevel(state.mesh)
          if (state.cell !== undefined) setCellLog(Math.log10(state.cell))
          if (state.fov !== undefined) setFov(state.fov)
          if (state.dolly !== undefined) setDolly(state.dolly)
          if (state.poles !== undefined) setPoles(state.poles)
          if (state.reference !== undefined) setReference(state.reference)
          if (state.dimensions !== undefined) setDimensions(state.dimensions)
          if (state.distance !== undefined) ask(state.distance, state.elevation)
        },
      }),
    [ask],
  )

  const heightPx = apparentPixels(size[1], view.distance, fov, view.heightPx)
  const share = heightPx / view.heightPx
  const feature = legibleFeature(view.distance, fov, view.heightPx)
  const cellPx = apparentPixels(cell, view.distance, fov, view.heightPx)
  const legibility = cellLegibility(cellPx)
  const poleHeight = longest * DEPTH.height
  const depthRows = [
    { id: 'front', label: 'Foreground pole', depth: view.front, share: poleShare(poleHeight, view.front, fov, view.heightPx) },
    { id: 'subject', label: selected.label, depth: view.distance, share },
    { id: 'back', label: 'Background pole', depth: view.back, share: poleShare(poleHeight, view.back, fov, view.heightPx) },
  ]
  const depthRatio = depthRows[0]!.share / Math.max(1e-6, depthRows[2]!.share)
  const meshErrPx = apparentPixels(meshDeviation(meshLevel, size[1]), view.distance, fov, view.heightPx)
  const people = size[1] / OBJECTS[0]!.parts.reduce((m, p) => Math.max(m, p.c[1] + p.s[1] / 2), 0)

  return (
    <div className="app-shell ui-system week08">
      <div className="viz-stage">
        <div className="world-canvas-wrap">
          <Canvas className="world-canvas" camera={{ position: [0, 12, 80], fov: DEFAULT_FOV, near: 0.05, far: 40000 }} gl={{ antialias: true, logarithmicDepthBuffer: true }}>
            <ScaleScene
              selected={selected}
              form={form}
              meshLevel={meshLevel}
              cells={cells}
              cell={cell}
              wireframe={wireframe}
              autoRotate={autoRotate}
              reference={reference}
              dimensions={dimensions}
              grid={grid}
              fov={fov}
              dolly={dolly}
              poles={poles}
              request={request}
              onView={setView}
            />
          </Canvas>
          <ViewTools
            tools={[
              { label: 'Wireframe', key: 'F', on: wireframe, onChange: setWireframe },
              { label: 'Auto rotate', key: 'R', on: autoRotate, onChange: setAutoRotate },
            ]}
          >
            <p className="readout" aria-live="polite">
              <span>
                {selected.label} {fmtM(size[1])}
              </span>
              <span>camera {fmtM(view.distance)}</span>
              <span>
                {Math.round(heightPx)} px · {Math.round(share * 100)}%
              </span>
              <span>{angularSize(size[1], view.distance).toFixed(1)}°</span>
              <span>lost: {'<'} {fmtM(feature)}</span>
            </p>
          </ViewTools>
        </div>
      </div>

      <div className="app-chrome">
        <div className="region-left">
          <ExerciseHeading title="Agents & Scale" about={ABOUT} actions={<LearnToggle active={learning} onChange={setLearning} />} />
          {tabs}
        </div>

        <InstrumentPanel label="Scale">
          <PanelSection index="01" title="Object" tip="What stands in the study, each at true size. The selected one is bright; the rest keep their place for comparison.">
            <div className="object-grid" data-control="scale-object">
              {OBJECTS.map((o, i) => (
                <button key={o.id} type="button" className="object-button" aria-pressed={o.id === selectedId} onClick={() => choose(o.id)}>
                  <span className="tab-index">{i + 1}</span>
                  {o.label}
                </button>
              ))}
            </div>
            <Note>{selected.role}.</Note>
            <Note>
              <Tag kind={selected.provisional ? 'provisional' : 'project'} /> {selected.basis}
            </Note>
            {selected.habit ? <Note>{selected.habit}</Note> : null}
            <code className="explain-eq is-quiet">
              {fmtM(size[0])} × {fmtM(size[1])} × {fmtM(size[2])} · {people >= 1.5 ? `${people.toFixed(1)} × a person` : 'a person’s height or less'}
            </code>
          </PanelSection>

          <PanelSection
            index="02"
            title="Camera"
            tip="Where the camera stands and how wide it sees decide how big a thing looks, not how big it is. The three viewpoints are Shadow Ecology’s: a walker, an approach, the whole island."
            status={<span className="section-status">{fov}°</span>}
          >
            <div data-learn="camera">
              <ControlField label="Viewpoint" value="Shadow Ecology 0.3" tip="The distances the project's Explore, Approach and Overview cameras keep from a subject, tried on whichever object is selected.">
                <div className="viewpoints">
                  {VIEWPOINTS.map((v) => (
                    <button key={v.id} type="button" className="text-button" title={v.note} onClick={() => ask(v.distance, v.elevation)}>
                      {v.label}
                    </button>
                  ))}
                </div>
              </ControlField>
              <ControlField label="Distance" value={fmtM(view.distance)} tip="Metres from the subject, on a logarithmic scale so a walker's and an island's distances fit one slider. Dragging and scrolling in the view moves it too.">
                <Slider
                  label="Distance"
                  min={DISTANCE_LOG.min}
                  max={DISTANCE_LOG.max}
                  step={0.005}
                  value={Math.min(DISTANCE_LOG.max, Math.max(DISTANCE_LOG.min, Math.log10(view.distance)))}
                  onChange={(v) => ask(10 ** v)}
                />
              </ControlField>
              <Note>Twice as far looks half as big. Distance changes how big a thing looks, never how big it is.</Note>
            </div>
            <div data-learn="fov">
              <ControlField label="Field of view" value={`${Math.round(fov)}°`} tip="How much the lens sees. A narrow one magnifies and flattens depth; a wide one shrinks the subject and stretches depth. The camera does not move, and the object does not change.">
                <Slider label="Field of view" min={FOV_RANGE.min} max={FOV_RANGE.max} step={1} value={fov} onChange={changeFov} />
              </ControlField>
              <div className="viewpoints">
                {FOV_PRESETS.map((p) => (
                  <button key={p.label} type="button" className="text-button" aria-pressed={Math.round(fov) === p.fov} onClick={() => changeFov(p.fov)}>
                    {p.label} {p.fov}°
                  </button>
                ))}
              </div>
              <Note>A narrower lens magnifies the subject; it is the same camera, not a nearer one. The project’s camera is {PROJECT_FOV}°.</Note>
            </div>
            <Toggle label="Dolly zoom: keep the subject's size" checked={dolly} onChange={setDolly} />
            <Toggle label="Sweep field of view" checked={sweep} onChange={setSweep} />
            <Toggle label="Depth poles" checked={poles} onChange={setPoles} />
            <div className="depth-meter" data-learn="depth" role="group" aria-label="Size on screen, as a share of the view's height">
              <p className="depth-title">Height as a share of the view</p>
              {depthRows.map((r) => (
                <div key={r.id} className={`depth-row is-${r.id}`}>
                  <span className="depth-name">{r.label}</span>
                  <span className="depth-bar">
                    <i style={{ width: `${Math.min(100, r.share * 100)}%` }} />
                  </span>
                  <span className="depth-value">
                    {r.share >= 9.99 ? '>999' : Math.round(r.share * 100)}% · {fmtM(r.depth)}
                  </span>
                </div>
              ))}
              <code className="explain-eq is-quiet">foreground ÷ background: {depthRatio >= 100 ? Math.round(depthRatio) : depthRatio.toFixed(1)}×</code>
            </div>
            <Note>
              {dolly
                ? `Dolly zoom on: the camera slides to ${fmtM(view.distance)} as the lens changes, so the subject keeps its size and the poles change instead. Wider pushes the camera in and stretches the depth; narrower pulls it back and flattens it.`
                : 'Dolly zoom off: the camera stays put, so the subject grows and shrinks with the lens while the poles keep their relation to it. Turn it on and sweep the field of view to see the difference.'}
            </Note>
          </PanelSection>

          <PanelSection
            index="03"
            title="Resolution"
            tip="Three different things are called resolution here. Cells: how finely a grid samples the object. Mesh: how many triangles describe a curve. Screen: how many pixels any of it gets from where the camera is."
            status={<span className="section-status">{form === 'voxels' ? `${Math.round(longest / cell)} across` : form === 'mesh' ? `${meshTriangles(meshLevel)} tris` : 'smooth'}</span>}
          >
            <div data-learn="resolution">
              <ControlField label="Form" value="V" tip="Smooth is the geometric reference: the object as modelled, finely tessellated, not infinite resolution. Cells samples it on a grid. Mesh swaps it for a ring built from few or many triangles.">
                <Segmented label="Form" options={FORM_OPTIONS} value={form} onChange={setForm} />
              </ControlField>
              <Note>
                {form === 'smooth'
                  ? 'Smooth is a reference, not infinite resolution: it is the model’s own geometry, drawn with enough triangles that none show here.'
                  : form === 'voxels'
                    ? 'Cells is sampling resolution: a grid keeps a cell if its centre is inside, so anything thinner than a cell is lost.'
                    : 'Mesh is geometric resolution: the same ring built from few or many triangles. Facets show on the silhouette until they shrink below a pixel.'}
              </Note>
              <ControlField label="Cell size" value={fmtM(cell)} tip="The size of one cell. The Shadow Ecology 0.3 grids use 1.5 m (occupancy) and 0.8 m (the reference form).">
                <Slider label="Cell size" min={Math.log10(cellMin)} max={Math.log10(cellMax)} step={0.005} value={Math.log10(cell)} disabled={form !== 'voxels'} onChange={setCellLog} />
              </ControlField>
              <div className="viewpoints">
                <button type="button" className="text-button" onClick={() => setCellLog(Math.log10(PROJECT_SCALE.voxel))}>
                  1.5 m (0.3 voxel)
                </button>
                <button type="button" className="text-button" onClick={() => setCellLog(Math.log10(PROJECT_SCALE.field))}>
                  0.8 m (0.3 field)
                </button>
              </div>
              <code className="explain-eq is-quiet">
                {form === 'voxels' ? `${(cells.length / 3).toLocaleString()} cells · a cell spans ${cellPx < 10 ? cellPx.toFixed(1) : Math.round(cellPx)} px here` : 'switch to Cells to see the grid'}
              </code>
              {form === 'voxels' ? (
                <Note>
                  {legibility === 'blocky'
                    ? 'From here the cells read as blocks: the grid is the first thing you see.'
                    : legibility === 'grainy'
                      ? 'Cells are a few pixels: the grid reads as grain on the surface.'
                      : 'Cells are under two pixels: at this distance the grid cannot be seen, and a coarser one would do.'}
                </Note>
              ) : null}
            </div>
            <div data-learn="mesh">
              <ControlField label="Mesh detail" value={`${meshTriangles(meshLevel).toLocaleString()} triangles`} tip="A ring as tall as the selected object, built from few or many triangles. Its hole and curves make the facets easy to see. Choose Mesh in Form to show it.">
                <Segmented label="Mesh detail" options={MESH_OPTIONS} value={meshLevel} onChange={(v) => { setMeshLevel(v); setForm('mesh') }} />
              </ControlField>
              <div className="mesh-table" role="group" aria-label="Edge error of each mesh level at this distance">
                {(Object.keys(MESH_LEVELS) as MeshLevel[]).map((level) => {
                  const err = apparentPixels(meshDeviation(level, size[1]), view.distance, fov, view.heightPx)
                  return (
                    <div key={level} className={level === meshLevel ? 'mesh-row is-current' : 'mesh-row'}>
                      <span>{MESH_LEVELS[level].label}</span>
                      <span>{meshTriangles(level).toLocaleString()} tris</span>
                      <span>{err < 0.1 ? '<0.1' : err < 10 ? err.toFixed(1) : Math.round(err)} px off</span>
                    </div>
                  )
                })}
              </div>
              <Note>
                {meshErrPx < 1
                  ? 'From here the edge is under a pixel off: this level is as good as the finest, and more triangles are wasted.'
                  : meshErrPx < 3
                    ? 'The silhouette is a pixel or two off: facets are just visible on the edge.'
                    : 'The facets show: the edge is several pixels from the true curve.'}
              </Note>
            </div>
            <Disclosure label="Three kinds of resolution">
              <Note>Sampling resolution is the cell size of a grid, set by the data. Mesh resolution is the triangle count, set by the geometry. Screen resolution is how many pixels a feature gets, set by the camera’s distance and lens.</Note>
              <Note>Only the third decides what is seen, so it should decide the other two: cells and triangles finer than a pixel at the distance they are used cost without showing. That is level of detail.</Note>
            </Disclosure>
          </PanelSection>

          <PanelSection index="04" title="Reference" tip="Aids for reading size. The person is the project's walker; the grid has 1 m cells and 10 m lines.">
            <Toggle label="Person for scale" checked={reference} onChange={setReference} />
            <Toggle label="Dimension lines" checked={dimensions} onChange={setDimensions} />
            <Toggle label="1 m grid" checked={grid} onChange={setGrid} />
          </PanelSection>

          <PanelSection index="05" title="Sizes on one ruler" tip="Every size in the study on a logarithmic ruler from 10 cm to 10 km. The line marks the camera's distance; the short mark is the smallest feature still 3 px across from there.">
            <div data-learn="ladder">
              <ScaleLadder distance={view.distance} feature={feature} selected={selected.id} />
              <Note>Creature, plant and Living Architecture sizes are provisional.</Note>
            </div>
            <Disclosure label="Reading it">
              <Note>
                A creature’s wing is 3 cm thin; LA-01 is 38 m tall; the island is 4.1 km across. Four orders of magnitude fit on one ruler, but no single camera shows them all: from Overview a person is below a pixel, and from Explore an island is a horizon. Where the camera line passes a mark, that thing is about as far away as it is big.
              </Note>
              <Note>
                What survives is set by the pair of camera and grid. At the Approach distance a 1.5 m cell is {Math.max(0.1, apparentPixels(1.5, 220, fov, view.heightPx)).toFixed(1)} px; at Overview, {Math.max(0.01, apparentPixels(1.5, 2600, fov, view.heightPx)).toFixed(2)} px. This is the measure for choosing a resolution for each view in Shadow Ecology.
              </Note>
            </Disclosure>
          </PanelSection>
                </InstrumentPanel>
      </div>
      {learning ? <LearnTour steps={learnSteps} label="Learn · Scale" onExit={exitLearning} /> : null}
    </div>
  )
}
