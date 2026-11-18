import type { SpeciesId } from '../creature-lab/types.ts'
import { creatureCam, type CreatureMode } from './creatureCam.ts'
import { restartObservation, setDay, setHour, setPlaying, setSpeed, setTimeScale, setYear, setYearSpeed, type Speed, type TimeScale } from './environment.ts'
import type { ViewMode } from './LandscapeView.tsx'
import { lookCloser, select, type Selection } from './livingSelection.ts'
import { setVegetation, type VegOverlay } from './vegStore.ts'

/**
 * Shadow Ecology 0.3 — every action the page's panel offers, in one place, so a guided walkthrough (or anything else) can drive the world exactly as the panel
 * does, through the same code: the camera views, time, the living architecture's selection, the creatures and the panel itself. Most of these are the shared
 * modules' own functions; the few that live in the page's React state (the camera view, the panel's open sections) are registered by the page when it mounts
 * (ShadowEcology03.tsx) and do nothing until then.
 *
 * Each time function behaves as its control does (moving the clock by hand pauses it, as the panel says). The panel reads the shared state back, so a change
 * made here shows in the panel at once.
 */
export type PanelPart = 'details' | 'advanced'

type PageHandlers = {
  /** Overview, Approach, or Explore, as their buttons do (Explore asks where to stand, Approach where to look); `direct` goes straight to the view. */
  view: (mode: ViewMode, direct?: boolean) => void
  /** Approach a place on the island: the elevated camera glides to look at it. */
  /** (`dist`, optional: how far the camera stands, in meters; the usual Approach distance otherwise.) */
  approach: (x: number, z: number, dist?: number, shot?: { yaw?: number; aim?: number; glide?: number; arc?: boolean; elev?: number }) => void
  /** Drops a pending choice of where to stand (Walk) or where to look (Approach), as Esc does; the camera stays where it is. */
  cancelPick: () => void
  /** A creature camera: Normal, Locate, Follow or POV (one leaves Explore, or a pending choice of place, first). */
  creatureCamera: (mode: CreatureMode) => void
  /** Shows or hides the whole panel (the world unobstructed). */
  panel: (open: boolean) => void
  /** Opens or closes World details or Advanced settings. */
  section: (part: PanelPart, open: boolean) => void
  /** Opens or leaves the Guide, as its toggle does. */
  guide: (on: boolean) => void
  /** Shows or hides the water or the Living Architecture, as the panel's layer switches do. */
  layer: (kind: 'water' | 'architecture', on: boolean) => void
  /** A new world from this seed, as the seed field does. */
  seed: (seed: number) => void
  /** Terrain detail, 0 (Low) to 3 (Ultra). */
  detail: (index: number) => void
  /** The Waterfall Locator: a side view of the generated fall at this index. */
  fall: (index: number) => void
}

const page: { handlers: PageHandlers | null } = { handlers: null }

/** The site's page switcher (ShadowEcologyVersions.tsx), so the guide can open a Lab and come back. */
const site: { open: ((pageId: string) => void) | null } = { open: null }
export function registerSite(open: ((pageId: string) => void) | null) {
  site.open = open
}

/**
 * A guide that has stepped out to a Lab: the step to reopen on return, and the Lab it went to. The Lab page shows Return to Guide while this is set;
 * choosing any page from the site's own navigation clears it (the walkthrough was left, not paused).
 */
export const guideReturn: { step: number | null; lab: string | null } = { step: null, lab: null }

/** Called by the page as it mounts (and with null as it unmounts). */
export function registerPage(handlers: PageHandlers | null) {
  page.handlers = handlers
}

export const worldActions = {
  navigation: {
    view: (mode: ViewMode, direct = false) => page.handlers?.view(mode, direct),
    approach: (x: number, z: number, dist?: number, shot?: { yaw?: number; aim?: number; glide?: number; arc?: boolean; elev?: number }) => page.handlers?.approach(x, z, dist, shot),
    cancelPick: () => page.handlers?.cancelPick(),
  },
  time: {
    /** 'daily' (one day of sun and shadow) or 'evolution' (the years, structures growing and dying). */
    scale: (scale: TimeScale) => setTimeScale(scale),
    hour: (hour: number) => setHour(hour),
    day: (day: number) => setDay(day),
    year: (year: number) => setYear(year),
    play: (playing: boolean) => setPlaying(playing),
    speed: (speed: Speed) => setSpeed(speed),
    yearSpeed: (yearsPerSecond: number) => setYearSpeed(yearsPerSecond),
    /** Back to the opening of the observation (Year 120, Day 1). */
    restart: () => restartObservation(),
  },
  architecture: {
    /** Selects an organism (its card opens beside it), a root connection, or nothing. */
    select: (selection: Selection) => select(selection),
    /** Approach turns to the selected organism (the card's Look closer). */
    lookCloser: () => {
      lookCloser()
      page.handlers?.view('approach', true)
    },
  },
  creatures: {
    species: (species: SpeciesId) => creatureCam.setSpecies(species),
    step: (by: number) => creatureCam.step(by),
    /** The framing the next creature camera starts with (a multiple of the usual distance, and an elevation in radians); null for the usual. */
    framing: (framing: { scale: number; elevation: number; awayFromHome?: boolean } | null) => creatureCam.setFraming(framing),
    /** The chosen Dweller walks a set loop over open ground beside its structure (on), or goes back to its ordinary life (off). */
    patrol: (on: boolean) => creatureCam.setPatrol(on),
    /** One individual directly, by its index within its species. */
    choose: (species: SpeciesId, index: number) => creatureCam.choose(species, index),
    /** Normal, Locate, Follow or POV (a creature camera leaves Explore first, as the panel does). */
    camera: (mode: CreatureMode) => (page.handlers ? page.handlers.creatureCamera(mode) : creatureCam.setMode(mode)),
  },
  ground: {
    /** What the ground shows: off, or the habitat, light, moisture or architecture map. */
    map: (overlay: VegOverlay) => setVegetation({ overlay }),
  },
  labs: {
    /** Opens a Lab from the guide (the world's page closes while it is open); returning reopens the guide at `resumeStep`. */
    visit: (lab: string, resumeStep: number) => {
      guideReturn.step = resumeStep
      guideReturn.lab = lab
      site.open?.(lab)
    },
    /** Back from the Lab to the world, where the guide picks up at the step it left. */
    back: () => site.open?.('0.3'),
  },
  guide: {
    open: (on: boolean) => page.handlers?.guide(on),
  },
  world: {
    layer: (kind: 'water' | 'architecture', on: boolean) => page.handlers?.layer(kind, on),
    seed: (seed: number) => page.handlers?.seed(seed),
    detail: (index: number) => page.handlers?.detail(index),
    fall: (index: number) => page.handlers?.fall(index),
  },
  panel: {
    show: (open: boolean) => page.handlers?.panel(open),
    section: (part: PanelPart, open: boolean) => page.handlers?.section(part, open),
  },
}
