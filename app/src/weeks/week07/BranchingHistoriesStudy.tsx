import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  AUTO_ROTATE_SPEED,
  Chevron,
  ControlField,
  Disclosure,
  ExerciseHeading,
  InstrumentPanel,
  PanelSection,
  Segmented,
  type ExerciseAbout,
  type SegmentOption,
} from '../../shared/ui/instrument.tsx'
import { LearnToggle, LearnTour } from '../../shared/ui/learn.tsx'
import { useShortcuts } from '../../shared/ui/shortcuts.ts'
import { sunDirection } from '../../shared/sun.ts'
import '../../shared/ui/system.css'
import {
  allNodes,
  HISTORY_RULES,
  historyTree,
  leavesOf,
  pathOf,
  STAGE_LABELS,
  type HistoryNode,
} from './histories.ts'
import { HISTORY_COLORS } from './historyColors.ts'
import { createHistoryLearnSteps, type HistoryLearnState } from './historyLearnSteps.tsx'
import type { Metrics } from './historyWorld.ts'
import { HistoryTree } from './HistoryTree.tsx'
import { HistoryWorldScene, type HistoryView } from './HistoryWorldScene.tsx'
import { Week07ViewStrip, type Immersion } from './ViewStrip.tsx'
import './week07.css'

const SCENE_BG = '#000000'
/** The Project's daytime light, so its materials read here as they do there. */
const AMBIENT_INTENSITY = 0.2
const SKY_FILL = { intensity: 0.12, sky: '#c9cfdc', ground: '#1a1917' } as const
const SUN_INTENSITY = 3
const SUN_COLOR = '#fff8ec'
const SUN_LIGHT_DISTANCE = 9
/** Early afternoon, from the south-west, as in the Project's day (south is −Z). */
const SUN = sunDirection(210, 42)
/** Covers the Week 06 block, corner to corner. */
const SHADOW_EXTENT = 3.8
const FOG = { near: 12, far: 26 } as const
/** The Week 06 studies' view of the block, drawn in toward the structure and the lake's south shore. */
const CAMERA_POSITION: [number, number, number] = [-2.6, 4.6, 4.9]
const ORBIT_TARGET: [number, number, number] = [0.05, -0.25, 0.15]
const CAMERA_FOV = 42

const ABOUT: ExerciseAbout = {
  text: 'One established ecology on the Week 06 study terrain: its lake, plain and massif, and the light an architecture lets through; shelter and exposure vegetation, and creatures that live where shelter, water and footing meet. Every history runs the same ecological rules from the same origin. The first divergence is only the rate at which the structure fails; later events exist only where the world their parent left allows them. Each node is its own simulated world: WORLD shows what exists now, TRACES the evidence of how it came to be.',
  terms: 'branching history · possibility space · disturbance rate · habitat field · shelter · exposure · trace · inheritance',
  controls: 'click or hover a node · ← → parent / child · ↑ ↓ sibling · H hide UI · R auto rotate · W world · T traces · drag orbit · scroll zoom',
}

const VIEW_OPTIONS: SegmentOption<HistoryView>[] = [
  { value: 'world', label: 'World' },
  { value: 'traces', label: 'Traces' },
]

const VIEW_NOTES: Record<HistoryView, string> = {
  world: 'What stands now. Shadow is the light itself.',
  traces: 'What earlier states left behind. The present is dimmed.',
}

const historyLabel = (node: HistoryNode) =>
  pathOf(node)
    .slice(1)
    .map((n) => n.rule!.label)
    .join(' → ') || 'Origin'

type Bar = { label: string; key: keyof Metrics }

const LIVE_BARS: readonly Bar[] = [
  { label: 'Architecture', key: 'structure' },
  { label: 'Shade', key: 'shade' },
  { label: 'Habitat', key: 'habitat' },
  { label: 'Creatures', key: 'creatures' },
  { label: 'Worn paths', key: 'paths' },
  { label: 'Trodden bare', key: 'trodden' },
  { label: 'Water', key: 'water' },
]

const VEG_BARS: readonly Bar[] = [
  { label: 'Shelter', key: 'vegShelter' },
  { label: 'Exposure', key: 'vegExposure' },
]

const TRACE_BARS: readonly Bar[] = [
  { label: 'Rubble', key: 'rubble' },
  { label: 'Lost shelter', key: 'formerShelter' },
  { label: 'Overgrown', key: 'reclaimed' },
  { label: 'Dead veg', key: 'deadVegetation' },
]

/** Shown in the summary only when this history changed them. Vegetation is split so the two strategies stay distinct. */
const CHANGE_ROWS: readonly (Bar & { group?: 'veg' })[] = [
  { label: 'Architecture', key: 'structure' },
  { label: 'Shade', key: 'shade' },
  { label: 'Habitat', key: 'habitat' },
  { label: 'Patches', key: 'patches' },
  { label: 'Creatures', key: 'creatures' },
  { label: 'Pockets', key: 'occupied' },
  { label: 'Shelter', key: 'vegShelter', group: 'veg' },
  { label: 'Exposure', key: 'vegExposure', group: 'veg' },
  { label: 'Worn paths', key: 'paths' },
  { label: 'Trodden bare', key: 'trodden' },
  { label: 'Overgrown', key: 'reclaimed' },
  { label: 'Rubble', key: 'rubble' },
  { label: 'Lost shelter', key: 'formerShelter' },
  { label: 'Dead veg', key: 'deadVegetation' },
  { label: 'Water', key: 'water' },
]

const round = (n: number) => Math.round(n)
const changed = (delta: number) => Math.abs(delta) >= 0.5

/** Counts that moved against the parent. The origin has no parent, so it has no rows. */
function ChangeSummary({ node }: { node: HistoryNode }) {
  const parent = node.parent
  if (!parent) {
    return null
  }
  const rows = CHANGE_ROWS.filter(({ key }) => changed(node.metrics[key] - parent.metrics[key]))
  if (rows.length === 0) {
    return <p className="explain-text">Unchanged from its parent.</p>
  }
  const firstVeg = rows.findIndex((row) => row.group === 'veg')
  const lastVeg = rows.reduce((last, row, index) => (row.group === 'veg' ? index : last), -1)
  const afterVeg = lastVeg >= 0 ? rows.findIndex((row, index) => index > lastVeg && row.group !== 'veg') : -1
  return (
    <ul className="change-rows">
      {rows.map(({ label, key }, index) => {
        const value = round(node.metrics[key])
        const delta = value - round(parent.metrics[key])
        const rowClass = [index === firstVeg ? 'is-veg' : '', index === afterVeg ? 'is-after-veg' : ''].filter(Boolean).join(' ')
        return (
          <li key={key} className={rowClass || undefined}>
            {index === firstVeg ? <span className="change-kicker">Vegetation</span> : null}
            <span className="change-label">{label}</span>
            <span className="change-value">{value}</span>
            <span className={delta > 0 ? 'change-delta is-up' : 'change-delta is-down'}>
              {delta > 0 ? '+' : '−'}
              {Math.abs(delta)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** Each value against the largest any history reaches; the tick marks the parent's. */
function StateBars({ node, bars, max }: { node: HistoryNode; bars: readonly Bar[]; max: Metrics }) {
  return (
    <ul className="state-bars">
      {bars.map(({ label, key }) => {
        const value = round(node.metrics[key])
        const previous = node.parent ? round(node.parent.metrics[key]) : null
        const delta = previous === null ? 0 : value - previous
        const scale = (n: number) => `${(100 * n) / Math.max(1, max[key])}%`
        return (
          <li key={label}>
            <span className="state-label">{label}</span>
            <span className="state-track" aria-hidden="true">
              <span className="state-fill" style={{ width: scale(node.metrics[key]) }} />
              {node.parent ? <span className="state-was" style={{ left: scale(node.parent.metrics[key]) }} /> : null}
            </span>
            <span className="state-value">
              {value}
              {Math.abs(delta) >= 1 ? (
                <span className={delta > 0 ? 'is-up' : 'is-down'}>
                  {delta > 0 ? ' +' : ' −'}
                  {Math.abs(delta)}
                </span>
              ) : null}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

type KeyItem = [shape: string, color: string, label: string]

const VIEW_KEYS: Record<HistoryView, KeyItem[]> = {
  world: [
    ['', HISTORY_COLORS.architecture, 'Architecture'],
    ['is-area', HISTORY_COLORS.water, 'Water'],
    ['is-area', HISTORY_COLORS.habitat, 'Habitat'],
    ['', HISTORY_COLORS.shelterVegetation, 'Shelter vegetation'],
    ['is-line', HISTORY_COLORS.exposureVegetation, 'Exposure vegetation'],
    ['', HISTORY_COLORS.creature, 'Creatures'],
    ['is-line', HISTORY_COLORS.path, 'Paths'],
    ['is-area', HISTORY_COLORS.trodden, 'Trodden bare'],
    ['', HISTORY_COLORS.rubble, 'Rubble'],
  ],
  traces: [
    ['is-line', HISTORY_COLORS.formerStructure, 'Former structure'],
    ['', HISTORY_COLORS.rubbleTrace, 'Rubble'],
    ['is-area', HISTORY_COLORS.formerShelter, 'Lost shelter'],
    ['is-line', HISTORY_COLORS.path, 'Routes walked'],
    ['is-line', HISTORY_COLORS.reclaimedPath, 'Overgrown routes'],
    ['is-area', HISTORY_COLORS.newWater, 'Spread water'],
    ['is-line', HISTORY_COLORS.formerShore, 'Former shore'],
    ['is-line', HISTORY_COLORS.deadVegetation, 'Dead vegetation'],
  ],
}

function ViewKey({ view }: { view: HistoryView }) {
  return (
    <ul className="mark-key">
      {VIEW_KEYS[view].map(([shape, color, label]) => (
        <li key={label}>
          <span className={`mark ${shape}`} style={{ color }} aria-hidden="true" />
          <span className="mark-label">{label}</span>
        </li>
      ))}
    </ul>
  )
}

const ECOLOGY_RULES: readonly [string, string][] = [
  ['Architecture', 'grown by the Project’s rules; casts shade across the day; shade + rubble + cover = shelter'],
  ['Water', 'moisture: near water or low ground (Week 06), held under shade, cover and rubble'],
  ['Rubble', 'fallen architecture; shelters its lee, keeps ground damp, buries what it piles on'],
  ['Habitat', 'shelter × moisture, none on buried ground, less where disturbed'],
  ['Shelter veg', 'grows toward shade, terrain enclosure and moisture together, on undisturbed ground'],
  ['Exposure veg', 'grows toward sunlight, moisture secondary; off rubble and paths'],
  ['Vegetation', 'spreads only from neighbours; adds cover, holds moisture, grows over unwalked paths'],
  ['Creatures', 'home in the best habitat, walk to water; walking wears paths, trampling keeps them bare'],
  ['Structure', 'exposed, high, unsupported voxels fail first; unheld mass follows'],
]

/** Week 07 → 02 Branching Histories. `tabs` is the Branching Systems subtab row. */
export function BranchingHistoriesStudy({ tabs, immersion }: { tabs: ReactNode; immersion: Immersion }) {
  const root = useMemo(() => historyTree(), [])
  const nodes = useMemo(() => allNodes(root), [root])
  const presents = useMemo(() => leavesOf(root).length, [root])
  const max = useMemo(() => {
    const out = { ...root.metrics }
    for (const n of nodes) {
      for (const key of Object.keys(out) as (keyof Metrics)[]) {
        out[key] = Math.max(out[key], n.metrics[key])
      }
    }
    return out
  }, [root, nodes])

  const [selected, setSelected] = useState<HistoryNode>(() => root.children[2] ?? root)
  const [hovered, setHovered] = useState<HistoryNode | null>(null)
  const [view, setView] = useState<HistoryView>('world')
  const [autoRotate, setAutoRotate] = useState(false)
  const [treeOpen, setTreeOpen] = useState(true)
  const [learning, setLearning] = useState(false)
  const exitLearning = useCallback(() => setLearning(false), [])

  const learnSteps = useMemo(
    () =>
      createHistoryLearnSteps({
        show: (state: HistoryLearnState) => {
          const node = nodes.find((n) => n.id === state.node)
          if (node) {
            setSelected(node)
            setHovered(null)
          }
          if (state.view) {
            setView(state.view)
          }
          setTreeOpen(true)
        },
      }),
    [nodes],
  )

  const read = hovered ?? selected

  useShortcuts((key) => {
    let next: HistoryNode | undefined
    if (key === 'ArrowLeft') {
      next = selected.parent ?? undefined
    } else if (key === 'ArrowRight') {
      next = selected.children[0]
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      const column = nodes.filter((n) => n.stage === selected.stage)
      next = column[column.indexOf(selected) + (key === 'ArrowUp' ? -1 : 1)]
    }
    if (next) {
      setSelected(next)
      setHovered(null)
    }
    return key.startsWith('Arrow')
  })

  const sunPosition: [number, number, number] = [SUN[0] * SUN_LIGHT_DISTANCE, SUN[1] * SUN_LIGHT_DISTANCE, SUN[2] * SUN_LIGHT_DISTANCE]
  const framing = { tree: treeOpen && !immersion.hidden, panel: !immersion.hidden }

  return (
    <div className="app-shell ui-system week07 week07-histories">
      <div className="viz-stage">
        <div className="world-canvas-wrap">
          <Canvas
            className="world-canvas"
            camera={{ position: CAMERA_POSITION, fov: CAMERA_FOV }}
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
              shadow-normalBias={0.02}
              shadow-radius={2}
              shadow-camera-left={-SHADOW_EXTENT}
              shadow-camera-right={SHADOW_EXTENT}
              shadow-camera-top={SHADOW_EXTENT}
              shadow-camera-bottom={-SHADOW_EXTENT}
              shadow-camera-near={0.5}
              shadow-camera-far={22}
            />
            <HistoryWorldScene
              world={selected.world}
              before={selected.parent?.world ?? null}
              view={view}
              framing={framing}
            />
            <OrbitControls
              makeDefault
              enableDamping
              dampingFactor={0.08}
              target={ORBIT_TARGET}
              minDistance={1.5}
              maxDistance={14}
              maxPolarAngle={Math.PI * 0.49}
              autoRotate={autoRotate}
              autoRotateSpeed={AUTO_ROTATE_SPEED}
            />
          </Canvas>

          <Week07ViewStrip
            immersion={immersion}
            tools={[
              { label: 'Auto rotate', key: 'R', on: autoRotate, onChange: setAutoRotate },
              { label: 'World', key: 'W', on: view === 'world', onChange: () => setView('world') },
              { label: 'Traces', key: 'T', on: view === 'traces', onChange: () => setView('traces') },
            ]}
          >
            <p className="readout" aria-live="polite">
              <span>
                <strong>{historyLabel(selected)}</strong>
              </span>
              <span>{view === 'world' ? 'World' : 'Traces'}</span>
              <span>
                {selected.metrics.creatures} creatures · {selected.metrics.habitat} habitat cells
              </span>
              <span>
                {nodes.length} states · {presents} presents
              </span>
            </p>
          </Week07ViewStrip>
        </div>
      </div>

      <div className="app-chrome">
        <div className="region-left is-wide">
          <ExerciseHeading
            title="Branching Systems"
            about={ABOUT}
            actions={<LearnToggle active={learning} onChange={setLearning} />}
          />
          {tabs}
          <section className={treeOpen ? 'history-map' : 'history-map is-collapsed'} aria-label="History tree">
            <div className="instrument-head">
              <span className="instrument-label">
                Histories · {presents} presents
              </span>
              <button
                type="button"
                className="icon-button"
                aria-expanded={treeOpen}
                aria-label={treeOpen ? 'Hide history tree' : 'Show history tree'}
                onClick={() => setTreeOpen((open) => !open)}
              >
                <Chevron open={treeOpen} />
              </button>
            </div>
            <div className="history-map-body" hidden={!treeOpen}>
              <HistoryTree root={root} selected={selected} hovered={hovered} onSelect={setSelected} onHover={setHovered} />
              <p className="history-caption">
                <span className="ht-legend-path" aria-hidden="true" /> selected history · every state is its own simulated world
              </p>
            </div>
          </section>
        </div>

        <InstrumentPanel label="Branching Histories">
          <PanelSection
            index="01"
            title="History"
            tip="Hover a node to read it; click to select it and build its world."
            status={
              <span className="section-status">
                {read.stage === 0 ? 'Origin' : `Stage ${read.stage}`}
                {hovered && hovered !== selected ? ' · preview' : ''}
              </span>
            }
          >
            <div data-learn="history" className="study-block">
              <ol className="history-path">
                {pathOf(read).map((n) => (
                  <li key={n.id}>{n.rule?.label ?? 'Origin'}</li>
                ))}
              </ol>
              <p className="explain-text">
                {read.rule?.effect ??
                  'The shared start: an established structure on the plain south of the lake, shading its shore; shelter vegetation and creatures in its shade, exposure vegetation across the sunlit plain, plateau and ridges.'}
              </p>
            </div>
            <div data-learn="state" className="study-block">
              <ChangeSummary node={read} />
              <Disclosure label="Measures">
                <p className="explain-text">Against the most any history reaches. The tick is the parent’s value.</p>
                <div className="metric-stack">
                  <StateBars node={read} bars={LIVE_BARS} max={max} />
                  <div className="metric-veg">
                    <p className="metric-kicker">Vegetation</p>
                    <StateBars node={read} bars={VEG_BARS} max={max} />
                  </div>
                  <StateBars node={read} bars={TRACE_BARS} max={max} />
                </div>
              </Disclosure>
            </div>
          </PanelSection>

          <PanelSection index="02" title="View" tip="Every node is built from its own simulated state. W world, T traces.">
            <div data-learn="view" className="study-block">
              <ControlField label="View" value="W · T">
                <Segmented label="World view" options={VIEW_OPTIONS} value={view} onChange={setView} />
              </ControlField>
              <p className="explain-text">{VIEW_NOTES[view]}</p>
              <Disclosure label="Marks">
                <ViewKey view={view} />
              </Disclosure>
            </div>
          </PanelSection>

          <PanelSection index="03" title="Rules" tip="One set of ecological rules runs every history; events only change what they act on.">
            <div data-learn="rules">
              <Disclosure label="How it works">
                <div className="study-block">
                  <div className="rule-list">
                    <p className="rule-stage">Every season, every history</p>
                    <ul>
                      {ECOLOGY_RULES.map(([name, rule]) => (
                        <li key={name}>
                          <span>{name}</span>
                          <code>{rule}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {([1, 2, 3] as const).map((stage) => (
                    <div key={stage} className="rule-list">
                      <p className="rule-stage">
                        0{stage} {STAGE_LABELS[stage]}
                      </p>
                      <ul>
                        {HISTORY_RULES.filter((r) => r.stage === stage).map((rule) => (
                          <li key={rule.id}>
                            <span>{rule.label}</span>
                            <code>{rule.condition}</code>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <p className="explain-text">
                    Slow decay and sudden collapse are the same failure rule at different rates. An event becomes a branch only where its
                    condition holds on the world its parent left; each outcome then runs the same rules on that world.
                  </p>
                </div>
              </Disclosure>
            </div>
          </PanelSection>
        </InstrumentPanel>
      </div>

      {learning ? (
        <LearnTour steps={learnSteps} label="Learn · Branching Histories" onExit={exitLearning} />
      ) : null}
    </div>
  )
}
