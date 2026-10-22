import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ControlField,
  ExerciseHeading,
  InstrumentPanel,
  PanelSection,
  Segmented,
  Slider,
  ViewTools,
  type ExerciseAbout,
} from '../shared/ui/instrument.tsx'
import { useShortcuts } from '../shared/ui/shortcuts.ts'
import { createWorld as createArchitecture, stepWorld as stepArchitecture, type ArchitectureSettings, type ArchitectureWorld } from './architecture.ts'
import { ArchitectureStage } from './ArchitectureStage.tsx'
import { geologicalGeometry, type GeologicalSettings } from './geological.ts'
import { growthGeometry, type GrowthSettings } from './growth.ts'
import { createWorld, stepWorld, type LivingSettings, type LivingWorld } from './living.ts'
import { LivingStage, type LivingView } from './LivingStage.tsx'
import { SpecimenStage } from './SpecimenStage.tsx'
import '../shared/ui/system.css'
import './concept-lab.css'

export type LabDirection = 'geological' | 'biological' | 'hybrid' | 'living' | 'architecture'

const PLAY_SECONDS = 9
const STEP_SECONDS = 0.32
const ARCH_STEP_SECONDS = 0.4
/** A settled living-ground patch: plants at the cap, structures near it. */
const LIVING_DEVELOPED = 64
/** Past the step where the organism, shade plants, and animals stop changing. */
const ARCHITECTURE_DEVELOPED = 36

const SPEEDS = [1, 5, 20] as const
type Speed = (typeof SPEEDS)[number]

const landscape = (direction: LabDirection) => direction === 'living' || direction === 'architecture'

const ABOUT: ExerciseAbout = {
  text: 'Concept Lab is an open workspace inside Shadow Ecology. Geological is one mass, worn by erosion and stepped by bedding. Biological and Hybrid grow from the same branching process toward the same point; Hybrid adds a pull onto the grid. Living ground is a small patch where plants and structures change the conditions the other grows by. Living architecture is one organism on a slope: it grows on sun and water, and its body bends the flow and the shade. These are studies, not a settled version.',
  terms: 'erosion · bedding · branching · attractor · grid · shade · cover · water',
  controls: 'Space play / pause · 1× 5× 20× · Instant Generate · F wireframe · R auto rotate · drag orbit · scroll zoom · Landscape studies: Overview / Explore, WASD or arrows, drag to look',
}

const GEO_DEFAULT: GeologicalSettings = { seed: 2, erosion: 0.75, bedding: 0.7 }
const GROWTH_DEFAULT: GrowthSettings = { seed: 4, steps: 34, attract: 0.62, grid: 0.82 }
const LIVING_DEFAULT: LivingSettings = { seed: 3, plants: 0.75, structures: 0.75 }
const ARCH_DEFAULT: ArchitectureSettings = { seed: 5 }

type DirectionTab = { id: LabDirection; index: string; label: string }

const DIRECTIONS: readonly DirectionTab[] = [
  { id: 'geological', index: '01', label: 'Geological' },
  { id: 'biological', index: '02', label: 'Biological' },
  { id: 'hybrid', index: '03', label: 'Hybrid' },
  { id: 'living', index: '04', label: 'Living ground' },
  { id: 'architecture', index: '05', label: 'Living architecture' },
]

function DirectionTabs({ active, onSelect }: { active: LabDirection; onSelect: (direction: LabDirection) => void }) {
  return (
    <div className="view-tabs" role="tablist" aria-label="Concept Lab direction">
      {DIRECTIONS.map((direction) => (
        <button
          key={direction.id}
          type="button"
          role="tab"
          aria-selected={direction.id === active}
          onClick={() => onSelect(direction.id)}
        >
          <span className="tab-index">{direction.index}</span>
          {direction.label}
        </button>
      ))}
    </div>
  )
}

function Percent({ value }: { value: number }) {
  return <span className="section-status">{Math.round(value * 100)}%</span>
}

export function ConceptLab({ tabs }: { tabs?: ReactNode }) {
  const [direction, setDirection] = useState<LabDirection>('geological')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(1)
  const [progress, setProgress] = useState(1)
  const progressRef = useRef(progress)
  const [wireframe, setWireframe] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [view, setView] = useState<LivingView>('overview')
  const [geological, setGeological] = useState(GEO_DEFAULT)
  const [growth, setGrowth] = useState(GROWTH_DEFAULT)
  const [living, setLiving] = useState(LIVING_DEFAULT)
  const [architecture, setArchitecture] = useState(ARCH_DEFAULT)
  const worldRef = useRef<LivingWorld>(createWorld(LIVING_DEFAULT))
  const archRef = useRef<ArchitectureWorld>(createArchitecture(ARCH_DEFAULT))
  const livingRef = useRef(living)
  const architectureRef = useRef(architecture)
  const speedRef = useRef(speed)
  const haltRef = useRef(0)
  livingRef.current = living
  architectureRef.current = architecture
  speedRef.current = speed
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!playing || landscape(direction)) return
    const token = haltRef.current
    let frame = 0
    let last = performance.now()
    let painted = 0
    const tick = (now: number) => {
      if (haltRef.current !== token) return
      const dt = Math.max(0, Math.min(0.25, (now - last) / 1000))
      last = now
      const rate = speedRef.current
      progressRef.current = Math.min(1, Math.max(0, progressRef.current + (dt * rate) / PLAY_SECONDS))
      if (rate === 1 || now - painted >= 100 || progressRef.current >= 1) {
        painted = now
        setProgress(progressRef.current)
      }
      if (progressRef.current < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      setProgress(progressRef.current)
    }
  }, [playing, direction])

  useEffect(() => {
    if (!playing || direction !== 'living') return
    const token = haltRef.current
    let frame = 0
    let acc = 0
    let last = performance.now()
    let painted = 0
    const tick = (now: number) => {
      if (haltRef.current !== token) return
      const dt = Math.max(0, Math.min(0.25, (now - last) / 1000))
      last = now
      const rate = speedRef.current
      acc += dt * rate
      let stepped = false
      while (acc >= STEP_SECONDS) {
        acc -= STEP_SECONDS
        stepWorld(worldRef.current, livingRef.current)
        stepped = true
      }
      if (stepped && (rate === 1 || now - painted >= 100)) {
        painted = now
        setRevision((current) => current + 1)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      setRevision((current) => current + 1)
    }
  }, [playing, direction])

  useEffect(() => {
    if (!playing || direction !== 'architecture') return
    const token = haltRef.current
    let frame = 0
    let acc = 0
    let last = performance.now()
    let painted = 0
    const tick = (now: number) => {
      if (haltRef.current !== token) return
      const dt = Math.max(0, Math.min(0.25, (now - last) / 1000))
      last = now
      const rate = speedRef.current
      acc += dt * rate
      let stepped = false
      while (acc >= ARCH_STEP_SECONDS) {
        acc -= ARCH_STEP_SECONDS
        stepArchitecture(archRef.current)
        stepped = true
      }
      if (stepped && (rate === 1 || now - painted >= 100)) {
        painted = now
        setRevision((current) => current + 1)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      setRevision((current) => current + 1)
    }
  }, [playing, direction])

  useEffect(() => {
    if (landscape(direction)) return
    if (playing && progress >= 1) setPlaying(false)
  }, [playing, progress, direction])

  const play = () => {
    if (!landscape(direction) && progress >= 1) {
      progressRef.current = 0
      setProgress(0)
    }
    setPlaying(true)
  }
  const reset = () => {
    if (direction === 'living') {
      worldRef.current = createWorld(livingRef.current)
      setRevision((current) => current + 1)
      setPlaying(true)
      return
    }
    if (direction === 'architecture') {
      archRef.current = createArchitecture(architectureRef.current)
      setRevision((current) => current + 1)
      setPlaying(true)
      return
    }
    progressRef.current = 0
    setProgress(0)
    setPlaying(true)
  }
  const generate = () => {
    haltRef.current += 1
    if (direction === 'living') {
      const world = worldRef.current
      while (world.step < LIVING_DEVELOPED) stepWorld(world, livingRef.current)
      setRevision((current) => current + 1)
      setPlaying(false)
      return
    }
    if (direction === 'architecture') {
      const world = archRef.current
      while (world.step < ARCHITECTURE_DEVELOPED) stepArchitecture(world)
      setRevision((current) => current + 1)
      setPlaying(false)
      return
    }
    progressRef.current = 1
    setProgress(1)
    setPlaying(false)
  }

  useShortcuts((key) => {
    if (key !== ' ') return false
    if (playing) setPlaying(false)
    else play()
    return true
  })

  const geometry = useMemo(() => {
    if (landscape(direction)) return null
    if (direction === 'geological') return geologicalGeometry(geological, progress)
    return growthGeometry({ ...growth, grid: direction === 'hybrid' ? growth.grid : 0 }, progress)
  }, [direction, geological, growth, progress])

  useEffect(() => () => geometry?.dispose(), [geometry])

  const tag =
    direction === 'geological'
      ? 'One mass · bedding, then gullies and a skirt of what was worn off'
      : direction === 'biological'
        ? 'Branching growth · the same rules as Hybrid, with no grid'
        : direction === 'hybrid'
          ? 'The same growth · members pulled onto the axes'
          : direction === 'architecture'
            ? view === 'explore'
              ? '14 m patch · eye height of a person · drag to look, WASD or arrows'
              : 'One organism · sun and water, then shade, plants, and the animals in that shade'
            : view === 'explore'
              ? 'One patch · drag to look, WASD or arrows to move'
              : 'One patch · plants and structures change each other’s conditions'

  const counts = worldRef.current
  const arch = archRef.current
  const developed =
    direction === 'living' ? counts.step >= LIVING_DEVELOPED : direction === 'architecture' ? arch.step >= ARCHITECTURE_DEVELOPED : progress >= 1

  return (
    <div className="app-shell ui-system concept-lab">
      <div className="viz-stage">
        <div className="world-canvas-wrap">
          {direction === 'living' ? (
            <LivingStage world={worldRef.current} revision={revision} wireframe={wireframe} autoRotate={autoRotate} view={view} />
          ) : direction === 'architecture' ? (
            <ArchitectureStage world={archRef.current} revision={revision} wireframe={wireframe} autoRotate={autoRotate} view={view} />
          ) : geometry ? (
            <SpecimenStage geometry={geometry} wireframe={wireframe} autoRotate={autoRotate} />
          ) : null}
          <ViewTools
            tools={[
              { label: 'Wireframe', key: 'F', on: wireframe, onChange: setWireframe },
              { label: 'Auto rotate', key: 'R', on: autoRotate, onChange: setAutoRotate },
            ]}
            actions={
              landscape(direction) ? (
                <span className="lab-view-mode">
                  <Segmented
                    label="Camera"
                    value={view}
                    onChange={setView}
                    options={[
                      { value: 'overview', label: 'Overview' },
                      { value: 'explore', label: 'Explore' },
                    ]}
                  />
                </span>
              ) : null
            }
          />
        </div>
      </div>

      <div className="app-chrome">
        <div className="region-left">
          <ExerciseHeading title="Shadow Ecology" about={ABOUT} />
          {tabs}
          <DirectionTabs active={direction} onSelect={setDirection} />
          <p className="lab-tag">{tag}</p>
        </div>

        <InstrumentPanel label="Concept Lab">
          <PanelSection
            index="01"
            title="Time"
            tip={
              direction === 'living'
                ? 'Each step lets plants and structures answer the shade and cover already on the patch. Speed runs those same steps faster and draws once per frame. Instant Generate advances the patch to step 64. Reset rebuilds it from the seed. Overview and Explore use the same patch.'
                : direction === 'architecture'
                  ? 'Each step runs the flow, then the organism, the shade plants, and the animals. Speed runs those same steps faster and draws once per frame. Instant Generate advances the patch to step 36. Reset rebuilds it from the seed. Overview and Explore keep the same patch. A step is a growth pulse, and the sizes are in meters.'
                  : 'Playback reveals the study from its start to the form set below. Speed uses that same reveal, faster. Instant Generate shows the finished form. Reset runs it again.'
            }
            status={direction === 'living' ? <span className="section-status">{counts.step}</span> : direction === 'architecture' ? <span className="section-status">{arch.step}</span> : <Percent value={progress} />}
          >
            <div className="lab-transport">
              <div className="button-row">
                <button type="button" className={playing ? 'btn' : 'btn btn-primary'} onClick={play} disabled={playing}>
                  Play
                </button>
                <button type="button" className={playing ? 'btn btn-primary' : 'btn'} onClick={() => setPlaying(false)} disabled={!playing}>
                  Pause
                </button>
                <button type="button" className="btn" onClick={reset}>
                  Reset
                </button>
              </div>
              <Segmented
                label="Simulation speed"
                value={String(speed)}
                onChange={(next) => setSpeed(Number(next) as Speed)}
                options={SPEEDS.map((rate) => ({ value: String(rate), label: `${rate}×` }))}
              />
              <div className="button-row">
                <button type="button" className="btn" onClick={generate} disabled={developed}>
                  Instant Generate
                </button>
              </div>
            </div>
          </PanelSection>

          {direction === 'geological' ? (
            <PanelSection
              index="02"
              title="Mass"
              tip="Bedding is in the mass from the start. Erosion is what playback opens: vertical cuts, deeper soft beds, and a skirt of the material that came off."
            >
              <ControlField label="Seed" value={`${Math.round(geological.seed)}`} tip="Moves the outline and where the four gullies cut. The same seed is the same mass.">
                <Slider label="Seed" min={1} max={24} step={1} value={geological.seed} onChange={(seed) => setGeological((current) => ({ ...current, seed }))} />
              </ControlField>
              <ControlField label="Erosion" value={geological.erosion.toFixed(2)} tip="Depth of the cuts and the skirt once playback finishes. At the start of playback this has not happened yet.">
                <Slider
                  label="Erosion"
                  min={0}
                  max={1}
                  step={0.01}
                  value={geological.erosion}
                  onChange={(erosion) => setGeological((current) => ({ ...current, erosion }))}
                />
              </ControlField>
              <ControlField label="Bedding" value={geological.bedding.toFixed(2)} tip="How far the softer beds step back. Visible before playback, and cut further as erosion opens.">
                <Slider
                  label="Bedding"
                  min={0}
                  max={1}
                  step={0.01}
                  value={geological.bedding}
                  onChange={(bedding) => setGeological((current) => ({ ...current, bedding }))}
                />
              </ControlField>
            </PanelSection>
          ) : direction === 'living' ? (
            <PanelSection
              index="02"
              title="Living ground"
              tip="Both responses include a middle band that helps and a high band that hinders. At 0, that population ignores the other."
              status={
                <span className="section-status">
                  {counts.plants.length} plants · {counts.members.length} members
                </span>
              }
            >
              <ControlField label="Seed" value={`${Math.round(living.seed)}`} tip="Rebuilds the ground, the first plants, and the first structures. The same seed is the same start.">
                <Slider
                  label="Seed"
                  min={1}
                  max={24}
                  step={1}
                  value={living.seed}
                  onChange={(seed) => {
                    const next = { ...livingRef.current, seed }
                    livingRef.current = next
                    worldRef.current = createWorld(next)
                    setLiving(next)
                    setRevision((current) => current + 1)
                  }}
                />
              </ControlField>
              <ControlField
                label="Plants"
                value={living.plants.toFixed(2)}
                tip="How strongly plants answer structure shade. Higher favors a middle amount of shade, and removes plants under deep shade or on a structure."
              >
                <Slider label="Plants" min={0} max={1} step={0.01} value={living.plants} onChange={(plants) => setLiving((current) => ({ ...current, plants }))} />
              </ControlField>
              <ControlField
                label="Structures"
                value={living.structures.toFixed(2)}
                tip="How strongly structures answer plant cover. Higher extends and branches them in a middle amount of cover, and stalls a tip where cover is thick."
              >
                <Slider
                  label="Structures"
                  min={0}
                  max={1}
                  step={0.01}
                  value={living.structures}
                  onChange={(structures) => setLiving((current) => ({ ...current, structures }))}
                />
              </ControlField>
            </PanelSection>
          ) : direction === 'architecture' ? (
            <PanelSection
              index="02"
              title="Living architecture"
              tip="The organism extends where its roots are wet and its tips are in the sun. Low shoots lie across the flow. Shade plants take the damp ground in the shadow. Animals gather there and wet the roots; a low shoot slows while an animal stands on it."
              status={
                <span className="section-status">
                  {arch.members.length} members · {arch.plants.length} plants · {arch.creatures.length} animals
                </span>
              }
            >
              <ControlField label="Seed" value={`${Math.round(architecture.seed)}`} tip="Rebuilds the slope, the stream, and the two young organisms. The same seed is the same start.">
                <Slider
                  label="Seed"
                  min={1}
                  max={24}
                  step={1}
                  value={architecture.seed}
                  onChange={(seed) => {
                    const next = { seed }
                    architectureRef.current = next
                    archRef.current = createArchitecture(next)
                    setArchitecture(next)
                    setRevision((current) => current + 1)
                  }}
                />
              </ControlField>
            </PanelSection>
          ) : (
            <PanelSection
              index="02"
              title="Growth"
              tip={
                direction === 'hybrid'
                  ? 'Same seed, steps and attractor as Biological. Grid is the extra pull: 0 matches Biological, 1 keeps every member on an axis and thickens it.'
                  : 'Members are laid in order. The attractor is one fixed point; Hybrid uses these same three settings and adds the grid.'
              }
            >
              <ControlField label="Seed" value={`${Math.round(growth.seed)}`} tip="Starts the wander and the branches. Shared with the other growth study.">
                <Slider label="Seed" min={1} max={24} step={1} value={growth.seed} onChange={(seed) => setGrowth((current) => ({ ...current, seed }))} />
              </ControlField>
              <ControlField label="Steps" value={`${Math.round(growth.steps)}`} tip="How many members exist once playback finishes.">
                <Slider label="Steps" min={8} max={56} step={1} value={growth.steps} onChange={(steps) => setGrowth((current) => ({ ...current, steps }))} />
              </ControlField>
              <ControlField
                label="Attractor"
                value={growth.attract.toFixed(2)}
                tip="How hard each member bends toward one point above and to the side. At 0, growth only wanders."
              >
                <Slider
                  label="Attractor"
                  min={0}
                  max={1}
                  step={0.01}
                  value={growth.attract}
                  onChange={(attract) => setGrowth((current) => ({ ...current, attract }))}
                />
              </ControlField>
              {direction === 'hybrid' ? (
                <ControlField label="Grid" value={growth.grid.toFixed(2)} tip="0 is the Biological form. 1 snaps every heading to the nearest axis and thickens the members.">
                  <Slider label="Grid" min={0} max={1} step={0.01} value={growth.grid} onChange={(grid) => setGrowth((current) => ({ ...current, grid }))} />
                </ControlField>
              ) : null}
            </PanelSection>
          )}
        </InstrumentPanel>
      </div>
    </div>
  )
}
