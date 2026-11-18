import { Canvas } from '@react-three/fiber'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { SHADOW_ECOLOGY_ABOUT } from '../project02/about.ts'
import { Chevron, ControlField, Disclosure, ExerciseHeading, InstrumentPanel, PanelSection, Segmented, Slider, Toggle, type SegmentOption } from '../shared/ui/instrument.tsx'
import { ExploreMap } from './ExploreMap.tsx'
import { CREATURE_PROFILE, creatureCam, creatureRelease, useCreatureCam, type CreatureMode } from './creatureCam.ts'
import type { SpeciesId } from '../creature-lab/types.ts'
import { OrganismPanel } from './OrganismPanel.tsx'
import { type Placement } from './PlacementCursor.tsx'
import { type ArchitectureVariant } from './LivingArchitecture.tsx'
import { prefetchArchitecture } from './livingOverhangAsync.ts'
import { LandscapeScene, type Navigation, type TerrainReadout, type ViewMode } from './LandscapeView.tsx'
import { NoiseLayers } from './NoiseLayers.tsx'
import { setVegetation, useVegetation } from './vegStore.ts'
import { ARCHETYPES, SPECS, ZONE_KEYS, ZONE_LABEL, type Zones } from './vegPlants.ts'
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
import { select, useLiving } from './livingSelection.ts'
import { setExperience, useExperience, type Experience } from './experience.ts'
import { setPreviewMode, usePreview, type PreviewMode } from './livingPreview.ts'
import { LIFECYCLE, OBSERVATION_START, worldYears } from './livingTime.ts'
import { fallViews } from './rivers.ts'
import { guideReturn, registerPage, worldActions, type PanelPart } from './worldActions.ts'
import { useVisualPreset } from './visualStyle.ts'
import { setStudy02, useStudy02 } from './visualStudy02.ts'
import { MAIN_VISUAL, VisualFilters } from './visualFilters.tsx'
import { DataLegend, DataTooltip, ExploreData, InspectCard, ProbeMarker, setCard, setExplore } from './exploreData.tsx'
import { DataProbe } from './dataProbe.tsx'

import { GUIDE03_STEPS, GuideLabLinks, leaveGuideScene, rememberTime, restoreTime } from './guide03.tsx'
import { LearnToggle, LearnTour } from '../shared/ui/learn.tsx'
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

const ZONE_RULE: Record<keyof Zones, string> = {
  moist: 'Moist lowland: lush cover, tall groves where the light is open, thin shrubs.',
  shore: 'Shore: dense cover and tall plants in the light; no shrubs at the very edge.',
  dry: 'Dry and exposed: sparse, bleached shrubs, little cover, no tall plants.',
  shaded: 'Sheltered and shaded: shrubs and cover thrive, deepest green; tall plants are shaded out.',
  alpine: 'High ground: thin cover and low shrubs only.',
  rock: 'Steep rock: bare.',
}
const hereLabel = (z: Zones) => ZONE_KEYS.filter((k) => z[k] > 0.3).sort((a, b) => z[b] - z[a]).slice(0, 2).map((k) => ZONE_LABEL[k].toLowerCase()).join(' and ') || 'open ground'
const hereRules = (z: Zones) => ZONE_KEYS.filter((k) => z[k] > 0.35).sort((a, b) => z[b] - z[a]).slice(0, 2).map((k) => ZONE_RULE[k])

const PREVIEW_OPTIONS: SegmentOption<PreviewMode>[] = [
  { value: 'off', label: 'Overhang' },
  { value: 'spreading', label: 'Spreading' },
  { value: 'ascending', label: 'Ascending' },
  { value: 'compare', label: 'Compare' },
]
const CAMERA_OPTIONS: SegmentOption<ViewMode>[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'approach', label: 'Approach' },
  // (Round 08J: "Walk", so the camera mode is not confused with the Explore World experience; its value is unchanged.)
  { value: 'explore', label: 'Walk' },
]

/** The bottom line in Explore: the keys, and the speed the walker is actually making, read ten times a second. */
function ExploreHint({ nav }: { nav: MutableRefObject<Navigation> }) {
  const [speed, setSpeed] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setSpeed(nav.current.speed), 100)
    return () => {
      window.clearInterval(id)
      nav.current.speed = 0
    }
  }, [nav])
  return (
    <p className="eco-steer-hint">
      WASD · Move{'\u2003\u2003'}Mouse · Look{'\u2003\u2003'}Shift · Move faster{'\u2003\u2003'}Esc · Release cursor
      {speed > 0.05 ? `\u2003\u2003Speed · ${speed.toFixed(1)} m/s` : ''}
    </p>
  )
}

const SPECIES_OPTIONS: SegmentOption<SpeciesId>[] = [
  { value: 'dweller', label: 'Dweller' },
  { value: 'crawler', label: 'Crawler' },
  { value: 'strider', label: 'Strider' },
  { value: 'glider', label: 'Glider' },
]
const CREATURE_CAMERA: SegmentOption<CreatureMode>[] = [
  { value: 'off', label: 'Normal' },
  { value: 'locate', label: 'Locate' },
  { value: 'follow', label: 'Follow' },
  { value: 'pov', label: 'POV' },
]

const NOTE: Record<ViewMode, string> = {
  overview: 'The whole island. Drag to orbit, scroll to zoom.',
  approach: 'One place, from above. Scroll out for the island, in for the ground.',
  explore: 'On foot, eye at 1.75 m. WASD to walk, mouse to look.',
}

const SPECIES_NAME: Record<SpeciesId, string> = { dweller: 'Hollow Dweller', crawler: 'Litter Crawler', strider: 'Strider', glider: 'Veil Glider' }
const CREATURE_HINT: Record<CreatureMode, string> = {
  off: 'Choose Locate, Follow or POV to find this animal and read what it is doing.',
  locate: 'Framed and still: drag to turn about it, scroll to zoom. Esc returns.',
  follow: 'Keeping behind it as it moves: drag to turn, scroll to zoom. Esc returns.',
  pov: 'Its own eyes. Esc returns.',
}

/** A section the panel keeps folded until asked (World details, Advanced settings): its title opens it. */
function FoldSection({ index, title, open, onToggle, children }: { index: string; title: string; open: boolean; onToggle: (open: boolean) => void; children: ReactNode }) {
  return (
    <section className="panel-section eco-fold">
      <header className="panel-section-head">
        <span className="panel-section-index">{index}</span>
        <button type="button" className="eco-fold-toggle" aria-expanded={open} onClick={() => onToggle(!open)}>
          <span className="panel-section-title">{title}</span>
          <Chevron open={open} />
        </button>
      </header>
      {open ? <div className="panel-section-body">{children}</div> : null}
    </section>
  )
}

/** Overhang 3 is the default. The comparison builds stay reachable without a control: ?architecture=grown2, grown, composed, grown2x, grown3, grown3b, grown3c, network, field, strata, overhang, overhang2 or overhang3; ?architecture=growth, the lofted growth prototype (LA-01 alone, closed parts grown by the shader; &age=0.4 holds an age), and ?architecture=reveal, the first (the mature surface revealed), ?architecture=voxel (connected occupancy growth), and ?architecture=skeleton (a parent-dependent growth network with load-based accretion; &age=1.8 holds an age, 0 to 3), and ?architecture=fronts (growth fronts that rise, curl and fuse; &age=0.6 holds an age, 0 to 1.7). */
const ARCHITECTURE_DEFAULT: ArchitectureVariant = (() => {
  const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('architecture')
  return asked === 'grown2' || asked === 'grown' || asked === 'composed' || asked === 'grown2x' || asked === 'grown3' || asked === 'grown3b' || asked === 'grown3c' || asked === 'network' || asked === 'field' || asked === 'strata' || asked === 'overhang' || asked === 'overhang2' || asked === 'overhang3' || asked === 'growth' || asked === 'reveal' || asked === 'voxel' || asked === 'skeleton' || asked === 'fronts' ? asked : 'overhang3'
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

/**
 * `variant` and `title` are for the Architecture Lab, which opens this same page on any Architecture variant. By default the page
 * is the project: the variant comes from the address (above) and the heading is the project's.
 */
/** The main visual (Graphic Diorama — Black Stage) is the look 0.3 opens in. Set once per page load, on the first visit, and only over Original, so a
 * filter chosen later in the session is kept. */
let mainVisualDefaulted = false

/** What the page reports to `onView` (the /preview site, which draws its own controls over the world and drives it through worldActions.ts). */
export type PageReport = {
  mode: ViewMode
  /** Waiting for a place to stand (Walk) or to look at (Approach). */
  placing: boolean
  picking: boolean
  /** The terrain has drawn and no chunk is waiting. */
  terrainSettled: boolean
  guide: boolean
  water: boolean
  architecture: boolean
  seed: number
  detail: number
  falls: string[]
  readout: TerrainReadout
  hydro: { soil: number; discharge: number; lake: number }
}

/** `onView` (optional, used by the /preview site): told what the page shows whenever it changes (PageReport). */
/** `paused` (optional, /preview): the 3D view stops drawing (the world stays as it is, ready to resume at once), for when it is out of sight. */
export function ShadowEcology03({ tabs, variant = ARCHITECTURE_DEFAULT, title = 'Shadow Ecology', onView, paused = false }: { tabs?: ReactNode; variant?: ArchitectureVariant; title?: string; onView?: (report: PageReport) => void; paused?: boolean }) {
  const opening = useMemo(() => overviewPose(0, 0), [])
  const readout = useRef<TerrainReadout>({ ground: 0, camera: 0, triangles: 0, pending: 0 })
  const rush = useRef(false)
  const nav = useRef<Navigation>({ x: 0, z: 0, yaw: 0, teleport: null, water: null, view: null, approach: null, speed: 0 })
  const detail = useRef<DetailLevel>('high')
  const [mode, setMode] = useState<ViewMode>('overview')
  const [detailIndex, setDetailIndex] = useState(2)
  const [seed, setSeed] = useState(DEFAULT_TERRAIN_SEED)
  const [showWater, setShowWater] = useState(true)
  const [showArchitecture, setShowArchitecture] = useState(true)
  const veg = useVegetation()
  const architecture: ArchitectureVariant = showArchitecture ? variant : 'off'
  // Everything placed on the land derives from the seed and the ground, so a new seed is a new world.
  const world = useMemo(() => {
    const made = worldFor(seed)
    // The architecture grows off the main thread from now, while the scene below is being made.
    prefetchArchitecture(made, variant)
    return made
  }, [seed, variant])
  const falls = useMemo(() => fallViews(world.rivers), [world])
  const [sky, setSky] = useState<EnvironmentControls>(snapshot)
  const { population, selection } = useLiving()
  const visualPreset = useVisualPreset()
  const study02 = useStudy02()
  // A pale background (Illustrated World — Stylized by day) reaches under the site header too (App.tsx): the text drawn straight on it turns to ink.
  const lightStage = study02 === 'stylized' && sky.hour > 6.2 && sky.hour < 17.9
  useEffect(() => {
    const root = document.documentElement
    if (lightStage) root.dataset.stage = 'light'
    else delete root.dataset.stage
    return () => {
      delete root.dataset.stage
    }
  }, [lightStage])
  useLayoutEffect(() => {
    if (mainVisualDefaulted) return
    mainVisualDefaulted = true
    if (study02 === 'original' && visualPreset === 'original') setStudy02(MAIN_VISUAL)
    // Once, on the first mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const preview = usePreview()
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
  const creatures = useCreatureCam()
  /** Approach asks where to look first, as Explore asks where to stand: the camera does not move until a spot is picked on the map. */
  const [pickingApproach, setPickingApproach] = useState(false)
  const [presetKey, setPresetKey] = useState(0)
  const choose = (next: ViewMode, direct = false) => {
    // A new view releases a creature camera first, and is taken only once the release has handed its pose back (creatureCam.ts › creatureRelease):
    // while a creature camera is on, the rig ignores every view and the orbit rests, and a hand-back landing after the new view cancelled it. (Round
    // 19: Island and Approach did nothing after following an animal.)
    if (creatureCam.get().mode !== 'off' || creatureRelease.pending) {
      creatureCam.setMode('off')
      let frames = 0
      const wait = () => {
        frames += 1
        if (creatureRelease.pending && frames < 60) requestAnimationFrame(wait)
        else handlers.current.choose(next, direct)
      }
      requestAnimationFrame(wait)
      return
    }
    if (next === 'explore' && mode !== 'explore') {
      setPickingApproach(false)
      setPlacing(true)
      return
    }
    setPlacing(false)
    // Approach from another view waits for a destination (the organism card's "Look closer" names its own, so it goes straight there).
    if (next === 'approach' && mode !== 'approach' && !direct) {
      // Selection is made from the elevated view of the whole island: leaving Explore returns to Overview first.
      if (mode === 'explore') {
        rush.current = true
        setMode('overview')
      }
      setPickingApproach(true)
      return
    }
    setPickingApproach(false)
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
    if (!placing && !pickingApproach) return
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPlacing(false)
        setPickingApproach(false)
      }
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [placing, pickingApproach])


  /** Zooming out of Explore (cursor free) continues in the orbiting view from where the camera is, with no preset applied. */
  const leaveExplore = () => {
    rush.current = true
    setMode('approach')
  }

  const teleport = (x: number, z: number) => {
    nav.current.teleport = { x, z }
    rush.current = true
  }

  /** Approach: a spot picked on the map becomes the place the elevated, orbiting camera looks at (the same pose Approach always takes, there). */
  const goApproach = (x: number, z: number, dist?: number, shot?: { yaw?: number; aim?: number; glide?: number; arc?: boolean; elev?: number }) => {
    nav.current.approach = { x, z, dist, ...shot }
    rush.current = true
    if (pickingApproach) {
      setPickingApproach(false)
      setMode('approach')
    }
  }

  /** The Waterfall Locator: moves the orbiting camera to a side view of a generated fall (Explore switches to Approach first). */
  const showFall = (index: number) => {
    const view = falls[index]
    if (!view) return
    nav.current.view = { position: view.position, target: view.target }
    rush.current = true
    if (mode === 'explore') setMode('approach')
  }

  /**
   * THE GUIDE (guide03.tsx): a five-step walkthrough over the live world. Opening it keeps the time the world had and sets it to the opening of the
   * observation; leaving it puts that time back, closes any creature camera and the selection, and returns to Overview with the panel open. Coming back
   * from a Lab it opened, it picks up at the step it left (worldActions.ts › guideReturn).
   */
  const [guide, setGuide] = useState<{ on: boolean; start: number }>(() => {
    if (guideReturn.step === null) return { on: false, start: 0 }
    const start = guideReturn.step
    guideReturn.step = null
    guideReturn.lab = null
    return { on: true, start }
  })
  const openGuide = () => {
    rememberTime()
    worldActions.time.restart()
    worldActions.time.scale('daily')
    setGuide({ on: true, start: 0 })
  }
  const exitGuide = useCallback(() => {
    setGuide({ on: false, start: 0 })
    leaveGuideScene(() => {
      restoreTime()
      worldActions.architecture.select(null)
      worldActions.panel.show(true)
      worldActions.navigation.view('overview', true)
      setSky(snapshot())
    })
  }, [])

  // The guide's card sits in the upper left, directly under the page's title (the rest of the heading is put away while the guide is open).
  const shell = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!guide.on) return
    const place = () => {
      const root = shell.current
      const heading = root?.querySelector('.region-left')
      if (!root || !heading) return
      const bottom = Math.max(...Array.from(heading.children, (c) => c.getBoundingClientRect().bottom))
      // The same spacing the heading keeps between its own rows: the card reads as the next row under the title.
      root.style.setProperty('--guide-top', `${Math.round(bottom + 14)}px`)
      // Room kept below the card: down to the creature's card when one is open in the lower left, with the same spacing.
      const below = root.querySelector('.creature-card')?.getBoundingClientRect()
      root.style.setProperty('--guide-bottom', `${Math.round(below ? window.innerHeight - below.top + 16 : 24)}px`)
    }
    place()
    const id = window.setInterval(place, 300)
    return () => window.clearInterval(id)
  }, [guide.on])

  /** The panel itself: hidden for an unobstructed view of the world, and its two folded sections. */
  const [panelHidden, setPanelHidden] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [dataOpen, setDataOpen] = useState(false)
  // THE TWO EXPERIENCES (Round 08I, experience.ts): Explore World, the piece; How It's Made, the process. Same world, camera and time; switching
  // clears what belongs to the other (Explore's selection and card; How It's Made's layer, readout and pinned card).
  const experience = useExperience()
  const chooseExperience = (next: Experience) => {
    setArchive(false)
    if (next === 'made') {
      select(null)
      setDataOpen(true)
    } else {
      setExplore({ view: 'final' })
      setCard(null)
    }
    setExperience(next)
  }
  const [devOpen, setDevOpen] = useState(false)
  // Round 08J: the panel's third view, Archive & tools (older versions, Labs, visual studies, developer tools), opened from beside the switch.
  const [archive, setArchive] = useState(false)
  const [creaturesOpen, setCreaturesOpen] = useState(true)
  const [versionsOpen, setVersionsOpen] = useState(true)

  /** A creature camera works from the orbiting views: it leaves Explore (or a pending choice of where to stand or look) first. */
  const creatureCamera = (next: CreatureMode) => {
    if (next !== 'off') {
      setPickingApproach(false)
      setPlacing(false)
      if (mode === 'explore') {
        rush.current = true
        setMode('overview')
      }
    }
    creatureCam.setMode(next)
  }

  // The page's own actions, for anything that drives the world as the panel does (worldActions.ts: a guided walkthrough). The latest closures are read
  // through a ref, so the registration is made once and never goes stale.
  const handlers = useRef({ choose, goApproach, creatureCamera, openGuide, exitGuide, applySeed, chooseDetail: (i: number) => chooseDetail(i), showFall: (i: number) => showFall(i) })
  handlers.current = { choose, goApproach, creatureCamera, openGuide, exitGuide, applySeed, chooseDetail: (i: number) => chooseDetail(i), showFall: (i: number) => showFall(i) }
  useEffect(() => {
    registerPage({
      view: (next, direct) => handlers.current.choose(next, direct),
      approach: (x, z, dist, shot) => handlers.current.goApproach(x, z, dist, shot),
      cancelPick: () => {
        setPlacing(false)
        setPickingApproach(false)
      },
      creatureCamera: (next) => handlers.current.creatureCamera(next),
      panel: (open) => setPanelHidden(!open),
      section: (part: PanelPart, open) => (part === 'details' ? setDetailsOpen(open) : setAdvancedOpen(open)),
      guide: (on) => (on ? handlers.current.openGuide() : handlers.current.exitGuide()),
      layer: (kind, on) => (kind === 'water' ? setShowWater(on) : setShowArchitecture(on)),
      seed: (next) => handlers.current.applySeed(String(next)),
      detail: (index) => handlers.current.chooseDetail(index),
      fall: (index) => handlers.current.showFall(index),
    })
    return () => registerPage(null)
  }, [])

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
      // Round 03: only when what the panel shows has changed (to the precision it shows). A new object every 250 ms re-rendered the page four times a second
      // even with nothing to show, a regular 13 ms block on the main thread: a dropped frame four times a second while moving.
      setShown((current) => {
        const next = readout.current
        const same = Math.round(current.camera) === Math.round(next.camera) && Math.round(current.ground) === Math.round(next.ground) && Math.round(current.triangles / 1000) === Math.round(next.triangles / 1000) && current.pending === next.pending
        return same ? current : { ...next }
      })
      setWater((current) => {
        const next = environment.state.hydro
        const same = Math.round(current.soil * 100) === Math.round(next.soil * 100) && Math.round(current.discharge * 100) === Math.round(next.discharge * 100) && current.lake.toFixed(2) === next.lake.toFixed(2)
        return same ? current : { ...next }
      })
      // The cycle moves the clock and the weather on its own: the panel mirrors the shared state whenever it differs.
      setSky((current) => {
        const live = snapshot()
        return JSON.stringify(current) === JSON.stringify(live) ? current : live
      })
    }, 250)
    return () => window.clearInterval(id)
  }, [])

  // The 3D scene is memoised (LandscapeView.tsx): its callbacks are stable, reading the latest closures through a ref, so a panel update does not re-render it.
  const sceneActs = useRef({ place, goApproach, leaveExplore })
  sceneActs.current = { place, goApproach, leaveExplore }
  const onScenePlace = useCallback((p: Placement) => sceneActs.current.place(p), [])
  const onScenePick = useCallback((x: number, z: number) => sceneActs.current.goApproach(x, z), [])
  const onSceneOrbit = useCallback(() => sceneActs.current.leaveExplore(), [])

  // The terrain has drawn and no chunk is waiting (for a loading screen, /preview).
  const terrainSettled = shown.triangles > 0 && shown.pending === 0
  const fallLabels = useMemo(() => falls.map((f) => f.label), [falls])
  useEffect(() => {
    onView?.({ mode, placing, picking: pickingApproach, terrainSettled, guide: guide.on, water: showWater, architecture: showArchitecture, seed, detail: detailIndex, falls: fallLabels, readout: shown, hydro: water })
  }, [onView, mode, placing, pickingApproach, terrainSettled, guide.on, showWater, showArchitecture, seed, detailIndex, fallLabels, shown, water])

  const above = shown.camera - shown.ground
  const livingCount = population ? population.organisms.filter((_, i) => organismState(population, i, worldYears(sky.year, (sky.day - 1) * 24 + sky.hour)).present).length : 0

  return (
    <div ref={shell} className={`app-shell ui-system project project02 project03${guide.on ? ' is-guiding' : ''}${lightStage ? ' is-light-stage' : ''}`}>
      <div className="viz-stage">
        <div className="world-canvas-wrap">
          <Canvas
            className="world-canvas"
            camera={{ position: opening.position, fov: 46, near: 40, far: 80000 }}
            gl={{ antialias: true, logarithmicDepthBuffer: true }}
            dpr={[1, 1.5]}
            shadows="percentage"
            frameloop={paused ? 'never' : 'always'}
          >
            <LandscapeScene mode={mode} readout={readout.current} rush={rush} detail={detail} seed={seed} nav={nav} world={world} showWater={showWater} architecture={architecture} placing={placing} onPlace={onScenePlace} picking={pickingApproach} onPick={onScenePick} onOrbit={onSceneOrbit} presetKey={presetKey} />
            <DataProbe world={world} blocked={placing || pickingApproach} mode={mode} />
          </Canvas>
          {/* Explore Data: the active view's legend, low left, and the card for what the pointer is over (dataProbe.tsx). */}
          <DataLegend />
          <DataTooltip />
          <InspectCard />
          <ProbeMarker />
          {placing ? <p className="eco-steer-hint">Click the ground to stand there · drag to look around first · Esc to cancel</p> : null}
          {creatures.mode !== 'off' && creatures.info ? (
            <div className="creature-card" role="status" aria-label="Creature">
              <div className="creature-card-head">
                <span className="organism-card-title">{creatures.info.species}</span>
                <span className="organism-card-stage">{creatures.info.stage}</span>
              </div>
              <p className="creature-card-state">{creatures.info.state}</p>
              <dl className="creature-card-rows">
                {/* Now: what it is doing and the reason the rules give; here: the conditions where it is. */}
                <dt>Why now</dt>
                <dd>{creatures.info.why}</dd>
                <dt>Here</dt>
                <dd>{creatures.info.habitat}</dd>
              </dl>
              {CREATURE_PROFILE[creatures.info.species] ? (
                <dl className="creature-card-rows creature-card-profile">
                  {CREATURE_PROFILE[creatures.info.species]!.map(([k, v]) => (
                    <Fragment key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </Fragment>
                  ))}
                </dl>
              ) : null}
            </div>
          ) : null}
          {pickingApproach ? <p className="eco-steer-hint">Move over the island to choose an area, then click it to look at it from above · Esc to cancel</p> : null}
          {mode === 'explore' && !placing ? <ExploreHint nav={nav} /> : null}
          <OrganismPanel year={sky.year} hours={(sky.day - 1) * 24 + sky.hour} mode={placing ? 'overview' : mode} onApproach={() => choose('approach', true)} />
          {/* The mini map belongs to ground-level Explore only, once a place to stand has been chosen: not in Overview or Approach (nor while choosing a
              target or a starting point), not under a creature camera, and not during the Guide, whose card fills the left column it would sit in. */}
          {mode === 'explore' && !placing && !pickingApproach && creatures.mode === 'off' && !guide.on ? <ExploreMap key="explore" kind="explore" seed={seed} nav={nav} water={showWater ? world.water : null} rivers={showWater ? world.rivers : null} onTeleport={teleport} /> : null}
        </div>
      </div>

      <div className="app-chrome">
        <div className="region-left">
          <ExerciseHeading title={title} about={SHADOW_ECOLOGY_ABOUT} actions={title === 'Shadow Ecology' ? <LearnToggle label="Guide" active={guide.on} onChange={(on) => (on ? openGuide() : exitGuide())} /> : undefined} />
          {/* (Round 08J: the version tabs and Labs moved to the panel's Archive & tools view.) */}
          {title === 'Shadow Ecology' ? null : tabs}
          {title === 'Shadow Ecology' ? (
            <div className="experience-bar">
            <div className="experience-switch" role="group" aria-label="Experience">
              {(
                [
                  ['explore', 'Explore World'],
                  ['made', "How It's Made"],
                ] as [Experience, string][]
              ).map(([key, label]) => (
                <button key={key} type="button" aria-pressed={!archive && experience === key} onClick={() => chooseExperience(key)}>
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="text-button archive-toggle" aria-pressed={archive} onClick={() => setArchive(!archive)}>
              {archive ? 'Close archive & tools' : 'Archive & tools'}
            </button>
            </div>
          ) : null}
          {tabs ? null : <p className="project-tag">A {(LANDSCAPE.size / 1000).toFixed(1)} km landscape, in meters. Ranges, valleys, and the ground underfoot.</p>}
        </div>

        <InstrumentPanel label={title === 'Shadow Ecology' ? 'Shadow Ecology 0.3' : title} collapsed={panelHidden} onCollapsedChange={setPanelHidden}>
          {/* THE PANEL follows how the world is met, not how it was built: where to look from, when, and who lives there; then, folded away, what
              explains what you see (World details) and what configures and debugs it (Advanced settings). Every control is the one it always was. */}
          {/* THE PANEL, in the order the world is met: what you control (where to look from, when, who), what explains it (World details), how it is
              drawn (Visual filters), the data behind it (Explore data), and, folded away, what configures it (Advanced settings) and what measures it
              (Developer tools). */}
          <PanelSection
            index="01"
            title="World controls"
            tip="Camera: where you look from. Time: Day cycle turns the sun through one day (light and shadow move, the world itself holds almost still); Evolution runs the years (structures grow, age and fall, and the plants and habitats follow them). Moving the time or changing the weather by hand pauses the clock; Play hands the weather back to the seed's timeline."
            status={<span className="section-status">Year {Math.floor(sky.year)}{sky.scale === 'daily' ? ` · ${formatHour(sky.hour)}` : ''}{/* The weather, when it is not fair: from Overview rain and mist show only in the light, so the panel says so. */}{sky.conditions.rain ? ' · Rain' : sky.conditions.mist ? ' · Mist' : sky.conditions.overcast ? ' · Overcast' : ''}</span>}
          >
            <div className="eco-detail">
              <span className="eco-detail-head">Camera</span>
              <Segmented label="Camera" options={CAMERA_OPTIONS} value={placing ? 'explore' : pickingApproach ? 'approach' : mode} onChange={(next) => choose(next)} />
              <p className="eco-note">{placing ? 'Click the ground to stand there.' : pickingApproach ? 'Click a place on the island or the map to look at it.' : NOTE[mode]}</p>
            </div>
            <div className="eco-detail">
              <span className="eco-detail-head">Time</span>
              <Segmented
                label="Time scale"
                options={[
                  { value: 'daily', label: 'Day cycle' },
                  { value: 'evolution', label: 'Evolution' },
                ]}
                value={sky.scale}
                onChange={(next) => act(() => setTimeScale(next as TimeScale))}
              />
              {sky.scale === 'daily' ? (
                <div className="control-field">
                  <div className="control-row">
                    <span className="control-label">Time of day</span>
                    <span className="control-value eco-big">{formatHour(sky.hour)}</span>
                  </div>
                  <Slider value={sky.hour} min={0} max={24} step={0.25} label="Time of day" onChange={(next) => act(() => setHour(next))} />
                  <div className="control-row eco-ends">
                    <span>00:00</span>
                    <span>12:00</span>
                    <span>24:00</span>
                  </div>
                </div>
              ) : (
                <div className="control-field">
                  <div className="control-row">
                    <span className="control-label">World year</span>
                    <span className="control-value eco-big">
                      {Math.floor(sky.year)} <span className="eco-of">of {LIFECYCLE.horizon}</span>
                    </span>
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
                  <Segmented label="Simulation speed" options={SPEEDS.map((value) => ({ value: String(value), label: `${value}×` }))} value={String(sky.speed)} onChange={(next) => act(() => setSpeed(Number(next) as Speed))} />
                ) : (
                  <Segmented label="Years per second" options={YEAR_SPEEDS.map((value) => ({ value: String(value), label: `${value} y/s` }))} value={String(sky.yearSpeed)} onChange={(next) => act(() => setYearSpeed(Number(next)))} />
                )}
              </div>
              <div className="eco-timefoot">
                {sky.scale === 'daily' ? (
                  <span className="eco-stepper">
                    <button type="button" className="text-button" aria-label="Previous day" disabled={sky.day <= 1} onClick={() => act(() => setDay(sky.day - 1))}>
                      ‹
                    </button>
                    <span className="control-value">Day {sky.day}</span>
                    <button type="button" className="text-button" aria-label="Next day" onClick={() => act(() => setDay(sky.day + 1))}>
                      ›
                    </button>
                  </span>
                ) : (
                  <span className="control-value">{observed(sky.year, sky.day, sky.hour)}</span>
                )}
                <button type="button" className="text-button" onClick={() => act(restartObservation)}>
                  Back to Year {OBSERVATION_START}
                </button>
              </div>
            </div>
          </PanelSection>

          {/* EXPLORE WORLD: who lives here, and what the world means (Round 08J). */}
          {!archive && experience === 'explore' ? (
          <FoldSection index="02" title="Creatures" open={creaturesOpen} onToggle={setCreaturesOpen}>
            <div className="eco-detail">
              <Segmented label="Species" options={SPECIES_OPTIONS} value={creatures.species} onChange={(next) => creatureCam.setSpecies(next)} />
              <div className="eco-subrow">
                <span className="eco-subrow-label">
                  {SPECIES_NAME[creatures.species]}
                  <span className="control-value">{creatures.counts[creatures.species] > 0 ? ` ${creatures.index + 1} of ${creatures.counts[creatures.species]}` : ' none placed yet'}</span>
                </span>
                <span className="eco-stepper">
                  <button type="button" className="text-button" aria-label="Previous individual" onClick={() => creatureCam.step(-1)}>
                    ‹
                  </button>
                  <button type="button" className="text-button" aria-label="Next individual" onClick={() => creatureCam.step(1)}>
                    ›
                  </button>
                </span>
              </div>
              <ControlField label="Camera">
                <Segmented label="Creature camera" options={CREATURE_CAMERA} value={creatures.mode} onChange={(next) => creatureCamera(next)} />
              </ControlField>
              <p className="eco-note">{CREATURE_HINT[creatures.mode]}</p>
            </div>
          </FoldSection>
          ) : null}
          {!archive && experience === 'explore' ? (
          <FoldSection index="03" title="About this world" open={detailsOpen} onToggle={setDetailsOpen}>
            <div className="eco-detail">
              <span className="eco-detail-head">Reading the main visual</span>
              <p className="eco-note">
                Cream is bare rock: parchment where it is gentle, sandstone on slopes. Terracotta marks three rock beds at fixed heights and the great cliff
                walls (drawn geology, not simulated). Olive is meadow; dark green is woodland floor and moss, the shaded, damp ground (both from the ecology).
                Pale sand is the shore; teal is water, deeper where darker. Lilac is shade: faces turned from the sun and cast shadows, which move with the
                hour. Explore data shows each of these layers on its own.
              </p>
            </div>
            <div className="eco-detail">
              <span className="eco-detail-head">Living architecture</span>
              <p className="eco-note">
                {population ? `${livingCount} of ${population.organisms.length} organisms living at year ${Math.floor(sky.year)}` : 'The population is being planned'}
                {selection?.kind === 'organism' && population ? `; ${population.organisms[selection.index]?.id ?? 'one'} is selected (its card is open on the island).` : '. Click one on the island to read its life: age, stage, health and what around it explains them.'}
              </p>
            </div>
            <div className="eco-detail">
              <span className="eco-detail-head">How the parts meet</span>
              <p className="eco-note">
                Structures cast shade. Ground they shade for much of the day stays cooler and damper, and grows a fern and moss-mat understory where open ground has grass and sedge. Hollow Dwellers lie up in that shade by day; Litter Crawlers keep to litter under tree cover; Striders work the lake shallows; Veil Gliders hawk along the woodland edge.
              </p>
            </div>
            {veg.here ? (
              <div className="eco-detail">
                <span className="eco-detail-head">Where you are looking</span>
                <dl className="eco-facts">
                  <dt>Habitat</dt>
                  <dd>{hereLabel(veg.here.zones)}</dd>
                  <dt>Light</dt>
                  <dd>{Math.round(veg.here.light * 100)}% of the day's sun</dd>
                  <dt>Moisture</dt>
                  <dd>{Math.round(veg.here.moisture * 100)}%</dd>
                  <dt>Slope</dt>
                  <dd>{Math.round(Math.atan(veg.here.slope) * (180 / Math.PI))}°</dd>
                  {veg.here.shade > 0.05 || veg.here.shelter > 0 ? (
                    <>
                      <dt>Architecture</dt>
                      <dd>{veg.here.shelter > 0 ? 'roofed (sheltered)' : `shades ${Math.round(veg.here.shade * 100)}% of the day`}</dd>
                    </>
                  ) : null}
                </dl>
                {hereRules(veg.here.zones).map((r) => (
                  <p key={r} className="eco-note">{r}</p>
                ))}
              </div>
            ) : null}
          </FoldSection>

          ) : null}
          {/* ARCHIVE & TOOLS: older versions and Labs, the visual studies, the developer's readouts and switches. Nothing removed, only moved. */}
          {archive ? (
          <FoldSection index="02" title="Versions & labs" open={versionsOpen} onToggle={setVersionsOpen}>
            <div className="archive-versions">{tabs}</div>
          </FoldSection>
          ) : null}
          {archive ? (
          <FoldSection index="03" title="Visual studies" open={filtersOpen} onToggle={setFiltersOpen}>
            <VisualFilters />
          </FoldSection>
          ) : null}

          {/* HOW IT'S MADE: the data, the systems, and the world's parameters. */}
          {!archive && experience === 'made' ? (
          <FoldSection index="02" title="How it's made" open={dataOpen} onToggle={setDataOpen}>
            <ExploreData
              layers={[
                { label: 'Plants', checked: veg.show, onChange: (on) => setVegetation({ show: on }) },
                { label: variant === 'overhang3' ? 'Living architecture' : `Living architecture (${variant})`, checked: showArchitecture, onChange: setShowArchitecture },
                { label: 'Water', checked: showWater, onChange: setShowWater },
              ]}
            />
          </FoldSection>
          ) : null}

          {!archive && experience === 'made' ? (
          <FoldSection index="03" title="World parameters" open={advancedOpen} onToggle={setAdvancedOpen}>
            <Disclosure label="World seed">
              <div className="eco-world-actions">
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
                <div className="control-row">
                  <label className="control-label" htmlFor="featured-seed">
                    Featured seeds
                  </label>
                  <select id="featured-seed" className="terrain-seed" style={{ width: 'auto' }} value={FEATURED_SEEDS.includes(seed) ? String(seed) : ''} onChange={(event) => event.target.value && applySeed(event.target.value)}>
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
                <button type="button" className="text-button" onClick={() => applySeed(String(Math.floor(Math.random() * 1_000_000_000)))}>
                  Randomize
                </button>
              </div>
              <NoiseLayers seed={seed} />
            </Disclosure>

            <Disclosure label="Weather and sun">
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
                <div key={value} className="control-field">
                  <div className="control-row">
                    <span className="control-label">{ADJUSTMENT[value]}</span>
                    <span className="control-value">{Math.round(sky.adjust[value] * 100)}%</span>
                  </div>
                  <Slider value={sky.adjust[value]} min={0.2} max={1} step={0.05} label={`${label}: ${ADJUSTMENT[value]}`} onChange={(next) => act(() => setAdjust(value, next))} />
                  {value === 'wind' ? (
                    <>
                      <div className="control-row">
                        <span className="control-label">Wind blows toward</span>
                        <span className="control-value">{heading(sky.windDirection)}</span>
                      </div>
                      <Slider value={sky.windDirection} min={0} max={355} step={5} label="Wind direction" onChange={(next) => act(() => setWindDirection(next))} />
                      <Toggle label="Show wind field" checked={sky.windField} onChange={(next) => setSkyControl('windField', next)} />
                    </>
                  ) : null}
                </div>
              ))}
              <div className="control-field">
                <div className="control-row">
                  <span className="control-label">Sun height at noon</span>
                  <span className="control-value">{Math.round(sky.noonElevation)}°</span>
                </div>
                <Slider value={sky.noonElevation} min={20} max={85} step={1} label="Sun height at noon" onChange={(next) => setSkyControl('noonElevation', next)} />
              </div>
              <p className="eco-note">Changing the weather by hand pauses the clock; Play hands it back to the seed's timeline.</p>
            </Disclosure>

            <Disclosure label="Terrain and water">
              <div className="control-field">
                <div className="control-row">
                  <span className="control-label">Terrain detail</span>
                  <span className="control-value">{DETAIL_LABEL[detailIndex]}</span>
                </div>
                <Slider value={detailIndex} min={0} max={3} step={1} label="Terrain detail" onChange={chooseDetail} />
              </div>
              <p className="eco-note">
                {world.water.bodies.filter((body) => body.kind === 'lake').length} lakes and {world.water.bodies.filter((body) => body.kind === 'pool').length} pools, set in this land's hollows.
              </p>
            </Disclosure>

            <Disclosure label="Living architecture">
              {showArchitecture && variant === 'overhang3' ? (
                <>
                  <Segmented label="Architecture morphology preview" options={PREVIEW_OPTIONS} value={preview.mode} onChange={(m) => setPreviewMode(m)} />
                  <p className="eco-note">
                    {preview.mode === 'off'
                      ? 'Morphology preview: off (the world’s own Overhang population). Spreading and Ascending are Architecture Lab morphologies shown at three sites; Compare shows all three at each.'
                      : `Preview of 3 sites (visual only; the population, plants and ecology are unchanged). ${preview.mode === 'compare' ? 'The Overhang stays; Spreading and Ascending stand on either side.' : 'The Overhang is hidden there.'} ${preview.status.built}/${preview.status.total} built${preview.status.ms ? ` · ${preview.status.ms} ms` : ''}.`}
                  </p>
                </>
              ) : null}
            </Disclosure>

            <Disclosure label="Vegetation">
              <Toggle label="Architecture influence" checked={veg.influence} onChange={(on) => setVegetation({ influence: on })} />
              <p className="eco-note">Off: the plants are placed as if no structure stood on the island (a comparison; the ecology itself is unchanged).</p>
            </Disclosure>
          </FoldSection>
          ) : null}

          {archive ? (
          <FoldSection index="04" title="Developer tools" open={devOpen} onToggle={setDevOpen}>
            <p className="readout">
              Ground {Math.round(shown.ground)} m · camera {Math.round(above)} m above it
            </p>
            <p className="readout">
              {(shown.triangles / 1000).toFixed(0)}k triangles
              {shown.pending > 0 ? ` · ${shown.pending} chunks updating` : ' · chunks current'}
            </p>
            <p className="readout">
              Soil {Math.round(water.soil * 100)}% · rivers {Math.round(water.discharge * 100)}% · lakes +{water.lake.toFixed(2)} m
            </p>
            <p className="readout">
              Camera {Math.round(shown.camera)} m · chunks {LANDSCAPE.chunkSize} m · field {LANDSCAPE.size} m
            </p>
            <div className="control-row">
              <label className="control-label" htmlFor="fall-locator">
                Waterfall locator
              </label>
              <select id="fall-locator" className="terrain-seed" style={{ width: 'auto' }} value="" disabled={falls.length === 0} onChange={(event) => event.target.value !== '' && showFall(Number(event.target.value))}>
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
            <Toggle label="Cast shadows" checked={sky.shadows} onChange={(next) => setSkyControl('shadows', next)} />
            <Toggle label="Coverage tint (analysis, Original look)" checked={veg.coverage} onChange={(on) => setVegetation({ coverage: on })} />
            <Toggle label="Lab plants (off: earlier plants)" checked={veg.renderer === 'world'} onChange={(on) => setVegetation({ renderer: on ? 'world' : 'previous' })} />
            <div className="eco-note veg-counts">
              {ARCHETYPES.map((a) => (
                <p key={a}>
                  <i style={{ background: SPECS[a].colour }} />
                  {SPECS[a].label} {veg.counts[a].now.toLocaleString()}
                  {veg.counts[a].other !== veg.counts[a].now ? ` (${veg.influence ? 'without' : 'with'} architecture ${veg.counts[a].other.toLocaleString()})` : ''}
                </p>
              ))}
              {veg.renderer === 'world' ? <p>{`Plants: near ${veg.plants.near.toLocaleString()} · middle ${veg.plants.mid.toLocaleString()} · far ${veg.plants.far.toLocaleString()} · on architecture ${veg.plants.attached} · ${Math.round(veg.plants.ms)} ms`}</p> : null}
              <p>{veg.ready ? `Far clumps ${veg.far.toLocaleString()} · ${veg.tiles} tiles (${Math.round(veg.ms.tile)} ms each) · year ${veg.year}` : 'Growing the island’s ground cover…'}</p>
            </div>
          </FoldSection>
          ) : null}
        </InstrumentPanel>
      </div>
      {guide.on ? (
        <LearnTour
          key={`guide-${guide.start}`}
          steps={GUIDE03_STEPS}
          label="Guide · Shadow Ecology 0.3"
          cues={{ notice: 'On screen' }}
          buttons={{ back: 'Previous', done: 'Finish' }}
          className="guide03"
          collapsible
          start={guide.start}
          extra={(index) => (index === GUIDE03_STEPS.length - 1 ? <GuideLabLinks step={index} /> : null)}
          onExit={exitGuide}
        />
      ) : null}
    </div>
  )
}
