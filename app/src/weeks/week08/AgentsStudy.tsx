import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { createAgentLearnSteps, type AgentLearnState } from './agentLearn.tsx'
import { compareRuns, DEFAULT_PARAMS, MAX_AGENTS, Sim, SPECIES, SPECIES_LABEL, STATE_NAME, STATES, type Counts, type Inspection, type Metrics, type Params, type RunSummary } from './agents.ts'
import { AgentsScene, STATE_COLOR } from './AgentsScene.tsx'
import '../../shared/ui/system.css'
import './week08.css'

const ABOUT: ExerciseAbout = {
  text: 'A small multi-species ecosystem on one seeded patch, built from three behavioural archetypes: terrestrial (walks, follows trails, rests in shade), aerial (flies above everything, sees far, perches on the slabs) and aquatic (confined to its own lake, grazes algae, takes refuge in deep water). Each is the same four-state machine with different triggers and perception. They interact through shared food sites and through a nutrient field that their own activity writes and that, in turn, speeds food regrowth, shelter recovery and algae. Ground agents also leave stigmergic trails. The study is independent of Shadow Ecology 0.3; species are archetypes, not designs.',
  terms: 'finite state machine · perception · stigmergy · shared resources · nutrient feedback · habitat quality · same-seed comparison',
  controls: 'P pause · T trails · H habitat · E perception ring · R auto rotate · X reset · click an agent to inspect · drag orbit · scroll zoom',
}

const SPEEDS = ['0.5', '1', '2', '4', '8']
const SPEED_OPTIONS: SegmentOption<string>[] = SPEEDS.map((value) => ({ value, label: `${value}×` }))
type Run = 'mixed' | 'ground' | 'air' | 'water'
const RUN_OPTIONS: SegmentOption<Run>[] = [
  { value: 'mixed', label: 'Mixed' },
  { value: 'ground', label: 'Land' },
  { value: 'air', label: 'Air' },
  { value: 'water', label: 'Water' },
]
const COMPARE_SECONDS = 120

const pct = (v: number) => `${Math.round(v * 100)}%`
const pctOrDash = (v: number | null) => (v === null ? '—' : pct(v))
const top5 = (m: Metrics) => (m.trailMass > 20 ? pct(m.concentration) : '—')

export function AgentsStudy({ tabs }: { tabs: ReactNode }) {
  const [seed, setSeed] = useState(7)
  const [nGround, setNGround] = useState(30)
  const [nAir, setNAir] = useState(16)
  const [nWater, setNWater] = useState(18)
  const [run, setRun] = useState<Run>('mixed')
  const [resets, setResets] = useState(0)
  const [perception, setPerception] = useState(DEFAULT_PARAMS.perception)
  const [speed, setSpeed] = useState(DEFAULT_PARAMS.speed)
  const [halfLife, setHalfLife] = useState(DEFAULT_PARAMS.halfLife)
  const [pull, setPull] = useState(DEFAULT_PARAMS.pull)
  const [simSpeed, setSimSpeed] = useState('2')
  const [paused, setPaused] = useState(false)
  const [showTrails, setShowTrails] = useState(true)
  const [showHabitat, setShowHabitat] = useState(true)
  const [rings, setRings] = useState(true)
  const [autoRotate, setAutoRotate] = useState(false)
  const [selected, setSelected] = useState(0)
  const [learning, setLearning] = useState(false)
  const exitLearning = useCallback(() => setLearning(false), [])

  // The run chooses which species are present; the world and every species' own random stream stay the same.
  const counts: Counts = run === 'mixed' ? [nGround, nAir, nWater] : run === 'ground' ? [nGround, 0, 0] : run === 'air' ? [0, nAir, 0] : [0, 0, nWater]
  const sim = useMemo(() => new Sim(seed, counts), [seed, counts[0], counts[1], counts[2], resets]) // eslint-disable-line react-hooks/exhaustive-deps
  const params = useMemo<Params>(() => ({ perception, speed, halfLife, pull }), [perception, speed, halfLife, pull])
  const paramsRef = useRef<Params>(params)
  useLayoutEffect(() => {
    paramsRef.current = params
  }, [params])
  const pick = Math.min(selected, Math.max(0, sim.count - 1))

  const [stats, setStats] = useState<Metrics>(() => sim.metrics())
  const [inspected, setInspected] = useState<Inspection | null>(null)
  const pickRef = useRef(pick)
  useEffect(() => {
    pickRef.current = pick
  }, [pick])
  const onStats = useCallback(
    (m: Metrics) => {
      setStats(m)
      setInspected(sim.count ? sim.inspect(pickRef.current, paramsRef.current) : null)
    },
    [sim],
  )

  const reset = useCallback(() => setResets((n) => n + 1), [])

  // Same seed, four runs headless: everyone together, then each species alone. Fast enough to run on a click.
  const compareKey = `${seed}|${nGround},${nAir},${nWater}|${perception},${speed},${halfLife},${pull}`
  const [comparison, setComparison] = useState<{ key: string; rows: RunSummary[] } | null>(null)
  const [comparing, setComparing] = useState(false)
  const runComparison = useCallback(() => {
    setComparing(true)
    window.setTimeout(() => {
      setComparison({ key: compareKey, rows: compareRuns(seed, [nGround, nAir, nWater], paramsRef.current, COMPARE_SECONDS) })
      setComparing(false)
    }, 30)
  }, [compareKey, seed, nGround, nAir, nWater])
  const compareRef = useRef(runComparison)
  useEffect(() => {
    compareRef.current = runComparison
  }, [runComparison])

  const learnSteps = useMemo(
    () =>
      createAgentLearnSteps({
        show: (s: AgentLearnState) => {
          if (s.ground !== undefined) setNGround(s.ground)
          if (s.air !== undefined) setNAir(s.air)
          if (s.water !== undefined) setNWater(s.water)
          if (s.run !== undefined) setRun(s.run)
          if (s.perception !== undefined) setPerception(s.perception)
          if (s.speed !== undefined) setSpeed(s.speed)
          if (s.halfLife !== undefined) setHalfLife(s.halfLife)
          if (s.pull !== undefined) setPull(s.pull)
          if (s.simSpeed !== undefined) setSimSpeed(String(s.simSpeed))
          if (s.trails !== undefined) setShowTrails(s.trails)
          if (s.habitat !== undefined) setShowHabitat(s.habitat)
          if (s.rings !== undefined) setRings(s.rings)
          if (s.seed !== undefined) setSeed(s.seed)
          setPaused(false)
          if (s.reset) setResets((n) => n + 1)
          if (s.compare) window.setTimeout(() => compareRef.current(), 120)
        },
      }),
    [],
  )

  const stale = comparison !== null && comparison.key !== compareKey
  const rows = comparison?.rows ?? []
  const find = (label: string) => rows.find((r) => r.label === label)
  const mixed = find('Mixed')
  const findings: string[] = []
  if (comparison && mixed) {
    const t = find('Terrestrial only')
    const w = find('Aquatic only')
    if (t) findings.push(`Food left: ${pct(mixed.food)} mixed, ${pct(t.food)} terrestrial alone${mixed.food < t.food - 0.02 ? ': birds share the same food sites.' : ': little competition here.'}`)
    if (t) findings.push(`Habitat near the slabs: ${mixed.habitat.toFixed(2)} mixed, ${t.habitat.toFixed(2)} terrestrial alone${mixed.habitat > t.habitat + 0.03 ? ': perched birds add nutrient.' : '.'}`)
    if (w && mixed.energy[2] !== null && w.energy[2] !== null) findings.push(`Aquatic energy: ${pct(mixed.energy[2])} mixed, ${pct(w.energy[2])} alone${mixed.energy[2] > w.energy[2] + 0.05 ? ': nutrient from land and air feeds the algae.' : ': no clear gain.'}`)
  }

  const present = SPECIES.map((sp, i) => ({ sp, i, n: sim.counts[i]! })).filter((r) => r.n > 0)
  const missingLake = run !== 'ground' && run !== 'air' && nWater > 0 && sim.counts[2] === 0
  return (
    <div className="app-shell ui-system week08">
      <div className="viz-stage">
        <div className="world-canvas-wrap" data-learn="world">
          <Canvas className="world-canvas" camera={{ position: [0, 78, 92], fov: 42, near: 0.5, far: 1200 }} gl={{ antialias: true }}>
            <AgentsScene
              key={`${seed}-${counts.join('-')}-${resets}`}
              sim={sim}
              paramsRef={paramsRef}
              speed={Number(simSpeed)}
              paused={paused}
              showTrails={showTrails}
              showHabitat={showHabitat}
              showPerception={rings}
              autoRotate={autoRotate}
              selected={pick}
              onSelect={setSelected}
              onStats={onStats}
            />
          </Canvas>
          <ViewTools
            tools={[
              { label: 'Pause', key: 'P', on: paused, onChange: setPaused },
              { label: 'Trails', key: 'T', on: showTrails, onChange: setShowTrails },
              { label: 'Habitat', key: 'H', on: showHabitat, onChange: setShowHabitat },
              { label: 'Perception', key: 'E', on: rings, onChange: setRings },
              { label: 'Auto rotate', key: 'R', on: autoRotate, onChange: setAutoRotate },
              { label: 'Reset', key: 'X', on: false, onChange: reset },
            ]}
          >
            <p className="readout" aria-live="polite">
              <span>{sim.count} agents</span>
              <span>t {Math.round(stats.time)} s</span>
              <span>seed {seed}</span>
              <span>habitat {stats.habitat.toFixed(2)}</span>
              <span>food {pct(stats.food)}</span>
            </p>
          </ViewTools>
        </div>
      </div>

      <div className="app-chrome">
        <div className="region-left">
          <ExerciseHeading title="Agents & Scale" about={ABOUT} actions={<LearnToggle active={learning} onChange={setLearning} />} />
          {tabs}
        </div>

        <InstrumentPanel label="Agents">
          <PanelSection index="01" title="Species" tip="Three archetypes on one patch: terrestrial (cones on the ground), aerial (kites above it, with shadows) and aquatic (fish under the water). Run shows them together or one at a time on the same seed." status={<span className="section-status">seed {seed}</span>}>
            <div data-learn="species">
              <ControlField label="Terrestrial" value={`${nGround}`} tip="Walkers: ground-bound, avoid water and rocks, follow trails, rest in the shade of the slabs.">
                <Slider label="Terrestrial" min={0} max={80} step={2} value={nGround} onChange={setNGround} />
              </ControlField>
              <ControlField label="Aerial" value={`${nAir}`} tip="Fliers: cross water and rocks, see farther, ignore trails, perch on the slabs.">
                <Slider label="Aerial" min={0} max={80} step={2} value={nAir} onChange={setNAir} />
              </ControlField>
              <ControlField label="Aquatic" value={`${nWater}`} tip="Fish: each stays in its own connected body of water, grazes algae, takes refuge in the deep. Needs a lake on the seed.">
                <Slider label="Aquatic" min={0} max={80} step={2} value={nWater} onChange={setNWater} />
              </ControlField>
              <ControlField label="Run" tip="Mixed shows all three. A single type runs alone with the same number of agents, on the same seed, so any difference comes from the others being there.">
                <Segmented label="Run" options={RUN_OPTIONS} value={run} onChange={setRun} />
              </ControlField>
              <ControlField label="Seed" value={`${seed}`} tip="Chooses the patch: terrain, lakes, rocks, shade and food sites. Each species has its own random stream.">
                <Slider label="Seed" min={1} max={99} step={1} value={seed} onChange={setSeed} />
              </ControlField>
              <div className="viewpoints">
                <button type="button" className="text-button" onClick={reset}>
                  Reset run
                </button>
                <button type="button" className="text-button" onClick={() => setSeed(1 + Math.floor(Math.random() * 99))}>
                  Random seed
                </button>
              </div>
              {missingLake ? <p className="explain-text">This seed has no lake big enough for fish. Try another seed.</p> : null}
              {sim.count >= MAX_AGENTS ? <p className="explain-text">At most {MAX_AGENTS} agents.</p> : null}
            </div>
          </PanelSection>

          <PanelSection index="02" title="Perception & movement" tip="The Perception setting is for walkers. Fliers see 2.5× as far (up to 50 m); fish see 0.75× as far, through water. Fliers move 2.2× as fast, fish 0.8×.">
            <div data-learn="perception">
              <ControlField label="Perception" value={`${perception} m`} tip="Radius around a walker inside which it senses food, shade, water and rocks, neighbours, and trail ahead.">
                <Slider label="Perception" min={2} max={20} step={1} value={perception} onChange={setPerception} />
              </ControlField>
              <ControlField label="Movement speed" value={`${speed.toFixed(1)} m/s`} tip="Walking speed on level ground. Slopes, tiredness and hunger slow it.">
                <Slider label="Movement speed" min={0.5} max={4} step={0.1} value={speed} onChange={setSpeed} />
              </ControlField>
              <p className="explain-text">The ring around the inspected agent is its whole knowledge. Click any agent, in any layer.</p>
            </div>
          </PanelSection>

          <PanelSection index="03" title="Trails" tip="Stigmergy: coordination through the environment. Walkers write to the ground and read from it. Trails fade over time and spread a little to neighbouring cells. Fliers and fish ignore them.">
            <div data-learn="trails">
              <ControlField label="Trail persistence" value={`${halfLife} s`} tip="Seconds for a trail to fade to half. Long persistence keeps paths; short lets them vanish unless walked.">
                <Slider label="Trail persistence" min={5} max={120} step={5} value={halfLife} onChange={setHalfLife} />
              </ControlField>
              <ControlField label="Trail attraction" value={pull.toFixed(2)} tip="How strongly a wandering walker turns toward stronger trail. At 0 walkers ignore trails: the control case.">
                <Slider label="Trail attraction" min={0} max={1} step={0.05} value={pull} onChange={setPull} />
              </ControlField>
              <Toggle label="Show trails" checked={showTrails} onChange={setShowTrails} />
              <p className="explain-text">Walkers only. “Trail in top 5%” is how much of all trail lies on the strongest 5% of ground: about 12% when spread evenly, higher where paths form.</p>
            </div>
          </PanelSection>

          <PanelSection index="04" title="Habitat feedback" tip="Collective activity writes a nutrient field; the field changes what the agents can do. Green on land is nutrient, green in water is algae.">
            <div data-learn="habitat">
              <Toggle label="Show habitat" checked={showHabitat} onChange={setShowHabitat} />
              <p className="explain-text">Every agent leaves nutrient where it is, most where it rests, perches or feeds. It spreads, runs off into the lakes, and slowly fades. Where it is rich, food regrows faster, shelters restore tiredness faster, and algae, the fishes’ food, grows thicker.</p>
              <code className="explain-eq is-quiet">
                habitat near slabs {stats.habitat.toFixed(2)} · dry ground {stats.nutrient.toFixed(3)} · algae {stats.algae === null ? '—' : stats.algae.toFixed(2)}
              </code>
            </div>
          </PanelSection>

          <PanelSection index="05" title="Time" tip="Speeds the simulation up without changing it: the run is the same at any speed.">
            <div data-learn="time">
              <ControlField label="Simulation speed" value={`${simSpeed}×`}>
                <Segmented label="Simulation speed" options={SPEED_OPTIONS} value={simSpeed} onChange={setSimSpeed} />
              </ControlField>
              <Toggle label="Pause" checked={paused} onChange={setPaused} />
            </div>
          </PanelSection>

          <PanelSection index="06" title="Readouts" tip="What each species is doing now, and what the inspected agent senses. Columns are the four states, named for each species in the inspector.">
            <div className="species-table" data-learn="states" role="group" aria-label="Agents in each state, by species">
              <div className="species-row is-head">
                <span />
                {STATES.map((s) => (
                  <span key={s} style={{ color: STATE_COLOR[s] }}>
                    {s === 'wander' ? 'Roam' : s === 'seek' ? 'Seek' : s === 'forage' ? 'Feed' : 'Rest'}
                  </span>
                ))}
                <span>energy</span>
              </div>
              {present.map(({ sp, i, n }) => (
                <div key={sp} className="species-row">
                  <span>
                    {SPECIES_LABEL[sp]} <i>{n}</i>
                  </span>
                  {STATES.map((s) => (
                    <span key={s}>{stats.bySpecies[i]![s]}</span>
                  ))}
                  <span>{pctOrDash(stats.energyBy[i] ?? null)}</span>
                </div>
              ))}
            </div>
            <code className="explain-eq is-quiet">
              trail top 5%: {top5(stats)} · food {pct(stats.food)} · habitat {stats.habitat.toFixed(2)}
            </code>
            {inspected ? (
              <div className="inspect">
                <p className="depth-title">
                  {SPECIES_LABEL[inspected.species]} {pick + 1}: <span style={{ color: STATE_COLOR[inspected.state] }}>{STATE_NAME[inspected.species][inspected.state]}</span>
                </p>
                <code className="explain-eq is-quiet">
                  energy {pct(inspected.energy)} · {inspected.species === 'water' ? 'stress' : 'tired'} {pct(inspected.fatigue)} · heading for {inspected.target}
                </code>
                <code className="explain-eq is-quiet">
                  senses: {inspected.species === 'water' ? 'algae' : 'food'} {inspected.food === null ? 'none' : `${inspected.food.toFixed(0)} m`} · {inspected.species === 'water' ? 'deep water' : inspected.species === 'air' ? 'perch' : 'shade'} {inspected.shelter === null ? 'none' : `${inspected.shelter.toFixed(0)} m`} · {inspected.neighbours} of its kind near
                  {inspected.species === 'ground' ? ` · trail ${inspected.trail.toFixed(1)}` : ''}
                </code>
              </div>
            ) : null}
          </PanelSection>

          <PanelSection index="07" title="Compare" tip="Runs the same seed four times without drawing it, each for 120 s: everyone together, then each species alone with the same number of agents. Each species has its own random stream, so a difference comes from the others being present." status={<span className="section-status">{comparing ? 'running…' : stale ? 'out of date' : comparison ? 'done' : ''}</span>}>
            <div data-learn="compare">
              <div className="viewpoints">
                <button type="button" className="text-button" onClick={runComparison} disabled={comparing}>
                  Run comparison · {COMPARE_SECONDS} s
                </button>
              </div>
              {comparison ? (
                <div className={stale ? 'compare-table is-stale' : 'compare-table'} role="table" aria-label="Same-seed comparison">
                  <div className="compare-row is-head">
                    <span>Run</span>
                    <span>Terr.</span>
                    <span>Air</span>
                    <span>Aqua.</span>
                    <span>Food</span>
                    <span>Habitat</span>
                  </div>
                  {rows.map((r) => (
                    <div key={r.label} className="compare-row">
                      <span>{r.label.replace(' only', '')}</span>
                      <span>{pctOrDash(r.energy[0] ?? null)}</span>
                      <span>{pctOrDash(r.energy[1] ?? null)}</span>
                      <span>{pctOrDash(r.energy[2] ?? null)}</span>
                      <span>{pct(r.food)}</span>
                      <span>{r.habitat.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="explain-text">Compares mixed and single-species runs on this seed: mean energy of each species, food left and habitat near the slabs.</p>
              )}
              {comparison ? <p className="explain-text">Energy is the mean over the second half of each run.</p> : null}
              {findings.map((f) => (
                <p key={f} className="explain-text">
                  {f}
                </p>
              ))}
            </div>
          </PanelSection>

          <PanelSection index="08" title="Toward 0.3" tip="How these mechanisms could later inform Shadow Ecology. Nothing here is connected to 0.3 yet.">
            <Disclosure label="What could carry over">
              <p className="explain-text">Creatures could be archetypes (ground, air, water) sharing one four-state machine driven by 0.3’s own fields: shade and shelter from Living Architecture, light, moisture and terrain.</p>
              <p className="explain-text">Collective activity could write a habitat field that feeds back on vegetation and on the shelter the architecture makes.</p>
              <p className="explain-text">Trails could mark habitual routes that wear the ground or steer where vegetation and shelter do well.</p>
            </Disclosure>
          </PanelSection>
        </InstrumentPanel>
      </div>
      {learning ? <LearnTour steps={learnSteps} label="Learn · Agents" onExit={exitLearning} /> : null}
    </div>
  )
}
