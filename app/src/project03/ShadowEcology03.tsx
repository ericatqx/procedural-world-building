import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SHADOW_ECOLOGY_ABOUT } from '../project02/about.ts'
import { Disclosure, ExerciseHeading, InstrumentPanel, PanelSection, Segmented, Slider, Toggle, type SegmentOption } from '../shared/ui/instrument.tsx'
import { ExploreMap } from './ExploreMap.tsx'
import { LandscapeScene, type Navigation, type TerrainReadout, type ViewMode } from './LandscapeView.tsx'
import { NoiseLayers } from './NoiseLayers.tsx'
import { DEFAULT_TERRAIN_SEED, DETAIL_LEVELS, FAST_WALK_FACTOR, LANDSCAPE, WALK_SPEED, overviewPose, setTerrainSeed, type DetailLevel } from './terrain.ts'
import { createWorld } from './world.ts'
import '../project/project.css'
import '../project02/project02.css'

const CAMERA_OPTIONS: SegmentOption<ViewMode>[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'approach', label: 'Approach' },
  { value: 'explore', label: 'Explore' },
]

const NOTE: Record<ViewMode, string> = {
  overview: 'The whole island from the far side. Drag to orbit around the ground, scroll to zoom.',
  approach: 'Closer to this place. Scroll out to see the whole island, or in to inspect the ground.',
  explore: 'Eye at 1.6 m on this ground. Drag to look. WASD or arrows to walk.',
}

type Pace = 'normal' | 'fast'

const PACE_OPTIONS: SegmentOption<Pace>[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' },
]

const DETAIL_LABEL = ['Low', 'Medium', 'High', 'Ultra']

export function ShadowEcology03({ tabs }: { tabs?: ReactNode }) {
  const opening = useMemo(() => overviewPose(0, 0), [])
  const readout = useRef<TerrainReadout>({ ground: 0, camera: 0, triangles: 0, pending: 0 })
  const rush = useRef(false)
  const speed = useRef(1)
  const nav = useRef<Navigation>({ x: 0, z: 0, yaw: 0, teleport: null, water: null })
  const [pace, setPace] = useState<Pace>('normal')
  const detail = useRef<DetailLevel>('high')
  const [mode, setMode] = useState<ViewMode>('overview')
  const [detailIndex, setDetailIndex] = useState(2)
  const [seed, setSeed] = useState(DEFAULT_TERRAIN_SEED)
  const [showWater, setShowWater] = useState(true)
  // Everything placed on the land derives from the seed and the ground, so a new seed is a new world.
  const world = useMemo(() => createWorld(seed), [seed])
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
    rush.current = true
    setSeed(next)
  }

  const choose = (next: ViewMode) => {
    rush.current = true
    setMode(next)
  }

  const choosePace = (next: Pace) => {
    speed.current = next === 'fast' ? FAST_WALK_FACTOR : 1
    setPace(next)
  }

  const teleport = (x: number, z: number) => {
    nav.current.teleport = { x, z }
    rush.current = true
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
    const id = window.setInterval(() => setShown({ ...readout.current }), 250)
    return () => window.clearInterval(id)
  }, [])

  const above = shown.camera - shown.ground

  return (
    <div className="app-shell ui-system project project02">
      <div className="viz-stage">
        <div className="world-canvas-wrap">
          <Canvas
            className="world-canvas"
            camera={{ position: opening.position, fov: 46, near: 40, far: 80000 }}
            gl={{ antialias: true, logarithmicDepthBuffer: true }}
            dpr={[1, 1.5]}
          >
            <LandscapeScene mode={mode} readout={readout.current} rush={rush} detail={detail} seed={seed} speed={speed} nav={nav} world={world} showWater={showWater} />
          </Canvas>
          {mode === 'explore' ? <p className="eco-steer-hint">Eye at 1.6 m · drag to look · WASD or arrows to walk</p> : null}
          {mode === 'explore' ? <ExploreMap seed={seed} nav={nav} water={showWater ? world.water : null} onTeleport={teleport} /> : null}
        </div>
      </div>

      <div className="app-chrome">
        <div className="region-left">
          <ExerciseHeading title="Shadow Ecology" about={SHADOW_ECOLOGY_ABOUT} />
          {tabs}
          <p className="project-tag">A {(LANDSCAPE.size / 1000).toFixed(1)} km landscape, in meters. Ranges, valleys, and the ground underfoot.</p>
        </div>

        <InstrumentPanel label="Shadow Ecology 0.3">
          <PanelSection index="01" title="View">
            <Segmented label="Camera" options={CAMERA_OPTIONS} value={mode} onChange={choose} />
            <p className="eco-note">{NOTE[mode]}</p>
          </PanelSection>

          <PanelSection index="02" title="Navigation">
            <Segmented label="Movement speed" options={PACE_OPTIONS} value={pace} onChange={choosePace} />
            <p className="eco-note">
              Walking in Explore: {(WALK_SPEED * (pace === 'fast' ? FAST_WALK_FACTOR : 1)).toFixed(1)} m/s.
              {mode === 'explore' ? ' Click the map to jump to a spot on the island.' : ' The map appears in Explore.'}
            </p>
            <p className="readout">
              Ground {Math.round(shown.ground)} m · {Math.round(above)} m above it
            </p>
          </PanelSection>

          <PanelSection index="03" title="World">
            <button
              type="button"
              className="text-button"
              onClick={() => applySeed(String(Math.floor(Math.random() * 1_000_000_000)))}
            >
              Randomize
            </button>
            <p className="eco-note">A new world each time: land and water together. The same seed always rebuilds the same world.</p>
          </PanelSection>

          <PanelSection index="04" title="Display">
            <div className="control-field">
              <div className="control-row">
                <span className="control-label">Terrain detail</span>
                <span className="control-value">{DETAIL_LABEL[detailIndex]}</span>
              </div>
              <Slider value={detailIndex} min={0} max={3} step={1} label="Terrain detail" onChange={chooseDetail} />
            </div>
            <p className="eco-note">Detail changes how finely the ground is drawn.</p>
            <Toggle label="Water" checked={showWater} onChange={setShowWater} />
            <p className="eco-note">
              {world.water.bodies.filter((body) => body.kind === 'lake').length} lakes and{' '}
              {world.water.bodies.filter((body) => body.kind === 'pool').length} pools, set in this land's hollows.
            </p>
          </PanelSection>

          <PanelSection index="05" title="Advanced">
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
                Camera {Math.round(shown.camera)} m · chunks {LANDSCAPE.chunkSize} m · field {LANDSCAPE.size} m
              </p>
            </Disclosure>
          </PanelSection>
        </InstrumentPanel>
      </div>
    </div>
  )
}
