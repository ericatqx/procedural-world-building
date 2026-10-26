import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SHADOW_ECOLOGY_ABOUT } from '../project02/about.ts'
import { Disclosure, ExerciseHeading, InstrumentPanel, PanelSection, Segmented, Slider, Toggle, type SegmentOption } from '../shared/ui/instrument.tsx'
import { ExploreMap } from './ExploreMap.tsx'
import { OrganismPanel } from './OrganismPanel.tsx'
import { type Placement } from './PlacementCursor.tsx'
import { type ArchitectureVariant } from './LivingArchitecture.tsx'
import { prefetchArchitecture } from './livingOverhangAsync.ts'
import { LandscapeScene, type Navigation, type TerrainReadout, type ViewMode } from './LandscapeView.tsx'
import { NoiseLayers } from './NoiseLayers.tsx'
import { DEFAULT_TERRAIN_SEED, DETAIL_LEVELS, FEATURED_SEEDS, LANDSCAPE, overviewPose, setTerrainSeed, type DetailLevel } from './terrain.ts'
import {
  CONDITIONS,
  SPEEDS,
  YEAR_SPEEDS,
  clearWeather,
  environment,
  formatHour,
  resetEnvironment,
  setAdjust,
  setDay,
  setHour,
  setPlaying,
  setSpeed,
  setTimeScale,
  setYearSpeed,
  restartObservation,
  setWindDirection,
  setYear,
  toggleCondition,
  type Condition,
  type EnvironmentControls,
  type Speed,
  type TimeScale,
} from './environment.ts'
import { organismState } from './livingEcology.ts'
import { useLiving } from './livingSelection.ts'
import { LIFECYCLE, OBSERVATION_START, worldYears } from './livingTime.ts'
import { fallViews } from './rivers.ts'
import { worldFor } from './world.ts'
import '../project/project.css'
import '../project02/project02.css'
import './project03.css'

/** How long the world has been observed: from Day 1 of the opening year (negative: before observation began). */
function observed(year: number, day: number, hour: number): string {
  const years = year - OBSERVATION_START + ((day - 1) * 24 + hour - 15.5) / 24 / 365
  const sign = years < -0.0005 ? '−' : '+'
  const a = Math.abs(years)
  if (a < 1) {
    const days = Math.round(a * 365)
    return `Observed ${sign}${days} ${days === 1 ? 'day' : 'days'}`
  }
  return `Observed ${sign}${a.toFixed(a < 10 ? 1 : 0)} years`
}

const CAMERA_OPTIONS: SegmentOption<ViewMode>[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'approach', label: 'Approach' },
  { value: 'explore', label: 'Explore' },
]

const NOTE: Record<ViewMode, string> = {
  overview: 'The whole island from the far side. Drag to orbit around the ground, scroll to zoom.',
  approach: 'Closer to this place. Scroll out to see the whole island, or in to inspect the ground.',
  explore: 'Eye at 1.75 m on this ground.',
}

/** Overhang 3 is the default. The comparison builds stay reachable without a control: ?architecture=grown2, grown, composed, grown2x, grown3, grown3b, grown3c, network, field, strata, overhang, overhang2 or overhang3; ?architecture=growth, the lofted growth prototype (LA-01 alone, closed parts grown by the shader; &age=0.4 holds an age), and ?architecture=reveal, the first (the mature surface revealed). */
const ARCHITECTURE_DEFAULT: ArchitectureVariant = (() => {
  const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('architecture')
  return asked === 'grown2' || asked === 'grown' || asked === 'composed' || asked === 'grown2x' || asked === 'grown3' || asked === 'grown3b' || asked === 'grown3c' || asked === 'network' || asked === 'field' || asked === 'strata' || asked === 'overhang' || asked === 'overhang2' || asked === 'overhang3' || asked === 'growth' || asked === 'reveal' || asked === 'voxel' ? asked : 'overhang3'
})()

const DETAIL_LABEL = ['Low', 'Medium', 'High', 'Ultra']

/** The one adjustment a preset offers, where it has one (windy and clear are tuned by wind strength alone). */
/** What each condition's slider adjusts. */
const ADJUSTMENT: Record<Condition, string> = { overcast: 'Cloud cover', rain: 'Rainfall', mist: 'Mist density', wind: 'Wind strength' }

/** Where the wind blows toward: 0° is east, turning clockwise (toward south) on the map. */
/** A copy of the shared controls for the panel, so React sees changes the simulation makes on its own. */
const snapshot = (): EnvironmentControls => ({ ...environment.controls, conditions: { ...environment.controls.conditions }, adjust: { ...environment.controls.adjust } })

const COMPASS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']
const heading = (degrees: number) => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]!

export function ShadowEcology03({ tabs }: { tabs?: ReactNode }) {
  const opening = useMemo(() => overviewPose(0, 0), [])
  const readout = useRef<TerrainReadout>({ ground: 0, camera: 0, triangles: 0, pending: 0 })
  const rush = useRef(false)
  const nav = useRef<Navigation>({ x: 0, z: 0, yaw: 0, teleport: null, water: null, view: null })
  const detail = useRef<DetailLevel>('high')
  const [mode, setMode] = useState<ViewMode>('overview')
  const [detailIndex, setDetailIndex] = useState(2)
  const [seed, setSeed] = useState(DEFAULT_TERRAIN_SEED)
  const [showWater, setShowWater] = useState(true)
  const [showArchitecture, setShowArchitecture] = useState(true)
  const architecture: ArchitectureVariant = showArchitecture ? ARCHITECTURE_DEFAULT : 'off'
  // Everything placed on the land derives from the seed and the ground, so a new seed is a new world.
  const world = useMemo(() => {
    const made = worldFor(seed)
    // The architecture grows off the main thread from now, while the scene below is being made.
    prefetchArchitecture(made, ARCHITECTURE_DEFAULT)
    return made
  }, [seed])
  const falls = useMemo(() => fallViews(world.rivers), [world])
  const [sky, setSky] = useState<EnvironmentControls>(snapshot)
  const { population } = useLiving()
  const [water, setWater] = useState(environment.state.hydro)
  const [draft, setDraft] = useState(String(DEFAULT_TERRAIN_SEED))
  const [shown, setShown] = useState<TerrainReadout>({ ground: 0, camera: 0, triangles: 0, pending: 0 })

  const applySeed = (text: string) => {
    const parsed = Number.parseInt(text.trim(), 10)
    if (!Number.isFinite(parsed)) {
      setDraft(String(seed))
      return
    }
    const next = parsed | 0
    setDraft(String(next))
    if (next === seed) return
    setTerrainSeed(next)
    resetEnvironment(next)
    rush.current = true
    setSeed(next)
  }

  /** Explore asks where to stand first; any other camera, or Esc, cancels that. */
  const [placing, setPlacing] = useState(false)
  const [presetKey, setPresetKey] = useState(0)
  const choose = (next: ViewMode) => {
    if (next === 'explore' && mode !== 'explore') {
      setPlacing(true)
      return
    }
    setPlacing(false)
    rush.current = true
    // Clicking the preset already shown brings its view back, as it does from any other mode.
    if (next === mode && next !== 'explore') setPresetKey((key) => key + 1)
    setMode(next)
  }
  const place = ({ x, z, yaw }: Placement) => {
    nav.current.teleport = { x, z, yaw, glide: true }
    rush.current = true
    setPlacing(false)
    setMode('explore')
  }
  useEffect(() => {
    if (!placing) return
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPlacing(false)
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [placing])

  /** Zooming out of Explore (cursor free) continues in the orbiting view from where the camera is, with no preset applied. */
  const leaveExplore = () => {
    rush.current = true
    setMode('approach')
  }

  const teleport = (x: number, z: number) => {
    nav.current.teleport = { x, z }
    rush.current = true
  }

  /** The Waterfall Locator: moves the orbiting camera to a side view of a generated fall (Explore switches to Approach first). */
  const showFall = (index: number) => {
    const view = falls[index]
    if (!view) return
    nav.current.view = { position: view.position, target: view.target }
    rush.current = true
    if (mode === 'explore') setMode('approach')
  }

  /** The panel mirrors the shared state: after any action it reads it back, so no control can disagree with the simulation. */
  const act = (change: () => void) => {
    change()
    setSky(snapshot())
  }
  /** Display choices that are not part of the simulation (sun height, shadows, wind field). */
  const setSkyControl = <K extends 'noonElevation' | 'shadows' | 'windField'>(key: K, value: EnvironmentControls[K]) => {
    environment.controls[key] = value
    setSky(snapshot())
  }

  const chooseDetail = (next: number) => {
    detail.current = DETAIL_LEVELS[next] ?? 'high'
    rush.current = true
    setDetailIndex(next)
  }

  useEffect(() => {
    nav.current.water = showWater ? world.water : null
  }, [world, showWater])

  useEffect(() => {
    resetEnvironment(seed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      setShown({ ...readout.current })
      setWater({ ...environment.state.hydro })
      // The cycle moves the clock and the weather on its own: the panel mirrors the shared state whenever it differs.
      setSky((current) => {
        const live = snapshot()
        return JSON.stringify(current) === JSON.stringify(live) ? current : live
      })
    }, 250)
    return () => window.clearInterval(id)
  }, [])

  const above = shown.camera - shown.ground

  return (
    <div className="app-shell ui-system project project02 project03">
      <div className="viz-stage">
        <div className="world-canvas-wrap">
          <Canvas
            className="world-canvas"
            camera={{ position: opening.position, fov: 46, near: 40, far: 80000 }}
            gl={{ antialias: true, logarithmicDepthBuffer: true }}
            dpr={[1, 1.5]}
            shadows="soft"
          >
            <LandscapeScene mode={mode} readout={readout.current} rush={rush} detail={detail} seed={seed} nav={nav} world={world} showWater={showWater} architecture={architecture} placing={placing} onPlace={place} onOrbit={leaveExplore} presetKey={presetKey} />
          </Canvas>
          {placing ? <p className="eco-steer-hint">Click the ground to stand there · drag to look around first · Esc to cancel</p> : null}
          {mode === 'explore' && !placing ? <p className="eco-steer-hint">WASD · Move{'\u2003\u2003'}Mouse · Look{'\u2003\u2003'}Shift · Move faster{'\u2003\u2003'}Esc · Release cursor</p> : null}
          <OrganismPanel year={sky.year} hours={(sky.day - 1) * 24 + sky.hour} mode={placing ? 'overview' : mode} onApproach={() => choose('approach')} />
          {mode === 'explore' ? <ExploreMap seed={seed} nav={nav} water={showWater ? world.water : null} rivers={showWater ? world.rivers : null} onTeleport={teleport} /> : null}
        </div>
      </div>

      <div className="app-chrome">
        <div className="region-left">
          <ExerciseHeading title="Shadow Ecology" about={SHADOW_ECOLOGY_ABOUT} />
          {tabs}
          <p className="project-tag">A {(LANDSCAPE.size / 1000).toFixed(1)} km landscape, in meters. Ranges, valleys, and the ground underfoot.</p>
        </div>

        <InstrumentPanel label="Shadow Ecology 0.3" utilities={
          <div className="eco-world-actions">
            <button type="button" className="text-button" onClick={() => applySeed(String(Math.floor(Math.random() * 1_000_000_000)))}>
              Randomize
            </button>
            <div className="control-row">
              <label className="control-label" htmlFor="featured-seed">
                Featured seeds
              </label>
              <select
                id="featured-seed"
                className="terrain-seed"
                style={{ width: 'auto' }}
                value={FEATURED_SEEDS.includes(seed) ? String(seed) : ''}
                onChange={(event) => event.target.value && applySeed(event.target.value)}
              >
                <option value="" disabled>
                  Choose
                </option>
                {FEATURED_SEEDS.map((featured) => (
                  <option key={featured} value={String(featured)}>
                    {featured}
                  </option>
                ))}
              </select>
            </div>
          </div>
        }>
          <PanelSection index="01" title="View and navigation">
            <Segmented label="Camera" options={CAMERA_OPTIONS} value={placing ? 'explore' : mode} onChange={choose} />
            <p className="eco-note">{NOTE[mode]}</p>
            <p className="eco-note">
              {mode === 'explore' ? 'Click the map to jump to a spot on the island.' : 'The map appears in Explore.'}
            </p>
            <p className="readout">
              Ground {Math.round(shown.ground)} m · {Math.round(above)} m above it
            </p>
          </PanelSection>

          <PanelSection index="02" title="Environment">
            <div className="control-field">
              <div className="control-row">
                <span className="control-label">World time</span>
                <span className="control-value">World year {Math.floor(sky.year)}</span>
              </div>
              <Segmented
                label="Time mode"
                options={[
                  { value: 'daily', label: 'Daily cycle' },
                  { value: 'evolution', label: 'Evolution' },
                ]}
                value={sky.scale}
                onChange={(next) => act(() => setTimeScale(next as TimeScale))}
              />
            </div>
            {sky.scale === 'daily' ? (
              <>
                <div className="eco-daybar">
                  <button type="button" className="text-button" disabled={sky.day <= 1} onClick={() => act(() => setDay(sky.day - 1))}>
                    ‹ Previous
                  </button>
                  <span className="control-value eco-day">Day {sky.day}</span>
                  <button type="button" className="text-button" onClick={() => act(() => setDay(sky.day + 1))}>
                    Next ›
                  </button>
                </div>
                <div className="control-field">
                  <div className="control-row">
                    <span className="control-label">Time of day</span>
                    <span className="control-value">{formatHour(sky.hour)}</span>
                  </div>
                  <Slider value={sky.hour} min={0} max={24} step={0.25} label="Time of day" onChange={(next) => act(() => setHour(next))} />
                  <div className="control-row eco-ends">
                    <span>00:00</span>
                    <span>24:00</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="control-field">
                <div className="control-row">
                  <span className="control-label">World year</span>
                  <span className="control-value">{Math.floor(sky.year)} of {LIFECYCLE.horizon}</span>
                </div>
                <Slider value={sky.year} min={0} max={LIFECYCLE.horizon} step={1} label="World year" onChange={(next) => act(() => setYear(next))} />
                <div className="control-row eco-ends">
                  <span>0</span>
                  <span>{LIFECYCLE.horizon}</span>
                </div>
              </div>
            )}
            <div className="eco-playback">
              <button type="button" className="text-button eco-play" aria-pressed={sky.playing} onClick={() => act(() => setPlaying(!sky.playing))}>
                {sky.playing ? 'Pause' : 'Play'}
              </button>
              {sky.scale === 'daily' ? (
                <Segmented
                  label="Simulation speed"
                  options={SPEEDS.map((value) => ({ value: String(value), label: `${value}×` }))}
                  value={String(sky.speed)}
                  onChange={(next) => act(() => setSpeed(Number(next) as Speed))}
                />
              ) : (
                <Segmented
                  label="Years per second"
                  options={YEAR_SPEEDS.map((value) => ({ value: String(value), label: `${value} y/s` }))}
                  value={String(sky.yearSpeed)}
                  onChange={(next) => act(() => setYearSpeed(Number(next)))}
                />
              )}
            </div>
            <div className="eco-daybar">
              <span className="control-value">{observed(sky.year, sky.day, sky.hour)}</span>
              <span />
              <button type="button" className="text-button" onClick={() => act(restartObservation)}>
                Back to Year {OBSERVATION_START}
              </button>
            </div>
            <p className="eco-note">
              {population ? `${population.organisms.filter((_, i) => organismState(population, i, worldYears(sky.year, (sky.day - 1) * 24 + sky.hour)).present).length} organisms living` : 'Organisms living'} at world year {Math.floor(sky.year)}, each at its own age (see Inspection). A day is 1/365 of a year of growth.
            </p>
            <div className="control-field">
              <div className="control-row">
                <span className="control-label">Weather</span>
                <span className="control-value">{sky.weatherMode === 'timeline' ? 'Timeline' : 'Set by hand'}</span>
              </div>
              <div className="segmented eco-conditions" role="group" aria-label="Weather">
                <button type="button" role="checkbox" aria-checked={!CONDITIONS.some(({ value }) => sky.conditions[value])} onClick={() => act(clearWeather)}>
                  Clear
                </button>
                {CONDITIONS.map(({ value, label }) => (
                  <button key={value} type="button" role="checkbox" aria-checked={sky.conditions[value]} onClick={() => act(() => toggleCondition(value))}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {CONDITIONS.filter(({ value }) => sky.conditions[value]).map(({ value, label }) => (
              <Disclosure key={value} label={`Customize ${label.toLowerCase()}`}>
                <div className="control-field">
                  <div className="control-row">
                    <span className="control-label">{ADJUSTMENT[value]}</span>
                    <span className="control-value">{Math.round(sky.adjust[value] * 100)}%</span>
                  </div>
                  <Slider value={sky.adjust[value]} min={0.2} max={1} step={0.05} label={ADJUSTMENT[value]} onChange={(next) => act(() => setAdjust(value, next))} />
                </div>
                {value === 'wind' ? (
                  <>
                    <div className="control-field">
                      <div className="control-row">
                        <span className="control-label">Wind blows toward</span>
                        <span className="control-value">{heading(sky.windDirection)}</span>
                      </div>
                      <Slider value={sky.windDirection} min={0} max={355} step={5} label="Wind direction" onChange={(next) => act(() => setWindDirection(next))} />
                    </div>
                    <Toggle label="Show wind field" checked={sky.windField} onChange={(next) => setSkyControl('windField', next)} />
                  </>
                ) : null}
              </Disclosure>
            ))}
            <p className="eco-note">Moving the time or changing the weather by hand pauses the clock. Play hands the weather back to the seed's timeline.</p>
          </PanelSection>

          <PanelSection index="03" title="Terrain and water">
            <div className="control-field">
              <div className="control-row">
                <span className="control-label">Terrain detail</span>
                <span className="control-value">{DETAIL_LABEL[detailIndex]}</span>
              </div>
              <Slider value={detailIndex} min={0} max={3} step={1} label="Terrain detail" onChange={chooseDetail} />
            </div>
            <p className="eco-note">Detail changes how finely the ground is drawn.</p>
            <Toggle label="Water" checked={showWater} onChange={setShowWater} />
            <Toggle label={ARCHITECTURE_DEFAULT === 'overhang3' ? 'Living architecture (prototype)' : `Living architecture (${ARCHITECTURE_DEFAULT})`} checked={showArchitecture} onChange={setShowArchitecture} />
            <p className="eco-note">
              {world.water.bodies.filter((body) => body.kind === 'lake').length} lakes and{' '}
              {world.water.bodies.filter((body) => body.kind === 'pool').length} pools, set in this land's hollows.
            </p>
          </PanelSection>

          <PanelSection index="04" title="Advanced">
            <Disclosure label="Sun">
              <div className="control-field">
                <div className="control-row">
                  <span className="control-label">Sun height at noon</span>
                  <span className="control-value">{Math.round(sky.noonElevation)}°</span>
                </div>
                <Slider value={sky.noonElevation} min={20} max={85} step={1} label="Sun height at noon" onChange={(next) => setSkyControl('noonElevation', next)} />
              </div>
            </Disclosure>
            <Disclosure label="Seed and noise">
              <div className="control-field">
                <div className="control-row">
                  <label className="control-label" htmlFor="terrain-seed">
                    Seed
                  </label>
                  <input
                    id="terrain-seed"
                    className="terrain-seed"
                    value={draft}
                    inputMode="numeric"
                    spellCheck={false}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => applySeed(draft)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') applySeed(draft)
                    }}
                  />
                </div>
              </div>
              <NoiseLayers seed={seed} />
            </Disclosure>
            <Disclosure label="Debug">
              <p className="readout">
                {(shown.triangles / 1000).toFixed(0)}k triangles
                {shown.pending > 0 ? ` · ${shown.pending} chunks updating` : ' · chunks current'}
              </p>
              <p className="readout">
                Soil {Math.round(water.soil * 100)}% · rivers {Math.round(water.discharge * 100)}% · lakes +{water.lake.toFixed(2)} m
              </p>
              <Toggle label="Cast shadows (debug)" checked={sky.shadows} onChange={(next) => setSkyControl('shadows', next)} />
              <p className="readout">
                Camera {Math.round(shown.camera)} m · chunks {LANDSCAPE.chunkSize} m · field {LANDSCAPE.size} m
              </p>
              <div className="control-row">
                <label className="control-label" htmlFor="fall-locator">
                  Waterfall locator
                </label>
                <select
                  id="fall-locator"
                  className="terrain-seed"
                  style={{ width: 'auto' }}
                  value=""
                  disabled={falls.length === 0}
                  onChange={(event) => event.target.value !== '' && showFall(Number(event.target.value))}
                >
                  <option value="" disabled>
                    {falls.length === 0 ? 'None here' : 'Go to a fall'}
                  </option>
                  {falls.map((view, index) => (
                    <option key={view.label} value={String(index)}>
                      {view.label}
                    </option>
                  ))}
                </select>
              </div>
            </Disclosure>
          </PanelSection>
        </InstrumentPanel>
      </div>
    </div>
  )
}
