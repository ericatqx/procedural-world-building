import { creatureRelease, creatureCam } from '../project03/creatureCam.ts'
import { environment, restartObservation, setDay, setHour, setPlaying, setSpeed, setTimeScale, setYear, setYearSpeed, type EnvironmentControls } from '../project03/environment.ts'
import { getExperience, setExperience, type Experience } from '../project03/experience.ts'
import { getExplore, setCard, setExplore } from '../project03/exploreData.tsx'
import { loading } from '../project03/loading.ts'
import { LANDSCAPE, OVERVIEW_HEADING, overviewFraming } from '../project03/terrain.ts'
import { setVegetation, vegetationState, type VegOverlay } from '../project03/vegStore.ts'
import type { DiagSub, DiagView } from '../project03/visualDiagnostics.ts'
import { worldActions } from '../project03/worldActions.ts'

/**
 * THE FRAMINGS. Home, Explore and Project's Formation look at the same island through the same camera. Each sets how the overview frames it
 * (terrain.ts › overviewFraming): the distance, so the island fills the space the layout leaves, and a LENS SHIFT, so it sits where the layout
 * wants it while the camera still aims at, and orbits about, the island's own centre. The canvas always fills the window.
 */
export type FramePage = 'home' | 'explore' | 'formation' | 'anatomy'
/** The Home concepts being compared: A, the editorial column; B, the dark specimen plate. */
export type HomeConcept = 'a' | 'b'
// A is the site's Home. B is kept for reference only: nothing on the site switches to it.
export const home = { concept: 'a' as HomeConcept }
export function setHomeConcept(next: HomeConcept) {
  home.concept = next
}

const FOV = 46
const DEPRESSION = (37 * Math.PI) / 180
/** The island's reach from its centre, in meters (its outline runs about 1,300 to 1,750 m out). */
const REACH = 1700

/** How far the camera must stand (along its line of sight) for the island to fill `w` of the width and `h` of the height. */
function distanceFor(aspect: number, w: number, h: number): number {
  const v = (FOV * Math.PI) / 360
  const across = REACH / Math.tan(Math.atan(Math.tan(v) * aspect) * w)
  const deep = (REACH * Math.sin(DEPRESSION)) / Math.tan(v * h)
  return Math.max(across, deep)
}

type Frame = { fillW: number; fillH: number; shiftX: number; shiftY: number }

function frameFor(page: FramePage, width: number, height: number) {
  const aspect = width / Math.max(1, height)
  const tall = aspect < 1.05
  let f: Frame
  if (page === 'home') {
    // Home (the editorial column): close in, the island larger than the space beside the text and running off the right edge, so the
    // mountains and lakes at its centre fill the view. On a tall screen it sits below the text, cropped at both sides.
    if (home.concept === 'b') {
      // B, the specimen plate: the whole island near the centre (a little right and low), with room either side for its labels.
      f = tall ? { fillW: 0.95, fillH: 0.46, shiftX: 0, shiftY: 0.12 } : { fillW: 0.6, fillH: 0.7, shiftX: 0.04, shiftY: 0.05 }
    } else f = tall ? { fillW: 1.3, fillH: 0.62, shiftX: 0, shiftY: 0.2 } : { fillW: 0.86, fillH: 1.05, shiftX: 0.24, shiftY: 0.03 }
  } else if (page === 'formation') {
    // Formation: the island (and every close-up, which keeps this lens shift) in the visual area right of the text-safe third, above the transport.
    f = tall ? { fillW: 1.0, fillH: 0.5, shiftX: 0, shiftY: 0.16 } : { fillW: 0.54, fillH: 0.62, shiftX: 0.19, shiftY: -0.05 }
  } else if (page === 'anatomy') {
    // Project's World Anatomy: the whole island centred in the space right of its column (preview.css › .pv-anatomy, whose widths these
    // follow), never pushed under it. Narrow: the island in the upper part of the window, the column scrolling up over its lower part.
    const gutter = Math.max(56, Math.min(104, width * 0.064))
    const left = 64 + gutter + 400 + 40
    const right = width - gutter
    if (right - left < 480 || tall) f = { fillW: 0.94, fillH: 0.46, shiftX: 0, shiftY: 0.2 }
    else f = { fillW: ((right - left) / width) * 0.94, fillH: 0.74, shiftX: ((left + right) / 2 - width / 2) / width, shiftY: -0.02 }
  } else {
    // Explore: the whole island, centred in the space between the navigation and the rail. (The lens shift lifts it: seen from above at an
    // angle, the island's mass sits below the point the camera aims at, and the rail takes more of the bottom than the navigation of the top.)
    f = { fillW: tall ? 0.96 : 0.8, fillH: 0.62, shiftX: 0, shiftY: tall ? -0.1 : -0.125 }
  }
  const d = distanceFor(aspect, f.fillW, f.fillH)
  // A slower glide between the pages' framings than the 0.3 page's own (0.7 s), so a page change reads as one camera move.
  // (Formation's returns to the whole island are slower still: one unhurried pull back, never a snap.)
  return { height: (d * Math.sin(DEPRESSION)) / LANDSCAPE.size, heading: OVERVIEW_HEADING, across: 0, toward: 0, shiftX: f.shiftX, shiftY: f.shiftY, glide: page === 'formation' ? 3.2 : 1.6 }
}

/** Sets the framing the overview will use for this page (read by the world as it mounts, and by every later overview). */
export function setFraming(page: FramePage) {
  Object.assign(overviewFraming, frameFor(page, window.innerWidth, window.innerHeight))
}

/**
 * Brings the camera to the page's overview: any creature camera is released first and given a few frames to let go (as the 0.3 Guide does),
 * so its release cannot carry the camera back to where it was; then the overview glides to the framing (and the lens shift eases with it).
 */
let generation = 0
/** The framing last asked for (Project switches between Formation's and Anatomy's: a resize keeps the one in use). */
export let framedFor: FramePage = 'home'
export function showOverview(page: FramePage) {
  framedFor = page
  const mine = ++generation
  setFraming(page)
  const go = () => {
    if (mine !== generation) return
    worldActions.navigation.view('overview', true)
  }
  if (creatureCam.get().mode === 'off' && !creatureRelease.pending) {
    go()
    return
  }
  worldActions.creatures.camera('off')
  // Until the creature camera has handed its pose back (creatureCam.ts › creatureRelease): that hand-back, landing after this page's view, left Home on
  // Formation's close-up. (At most about a second, if the scene is not drawing.)
  let frames = 0
  const wait = () => {
    if (mine !== generation) return
    frames += 1
    if ((creatureRelease.pending || frames < 2) && frames < 60) requestAnimationFrame(wait)
    else go()
  }
  requestAnimationFrame(wait)
}

/**
 * KEEPING EXPLORE'S WORLD. Home and Formation each show the world in a state of their own; what Explore had (time, what is drawn, the lens) is kept
 * aside as they take over and put back as they leave, so Explore continues exactly where it was.
 */
type Kept = Pick<EnvironmentControls, 'scale' | 'year' | 'day' | 'hour' | 'playing' | 'speed' | 'yearSpeed' | 'weatherMode'> & {
  overlay: VegOverlay
  plants: boolean
  water: boolean
  architecture: boolean
  lens: { view: DiagView; sub: DiagSub }
  experience: Experience
}
let kept: Kept | null = null
/** What the page last reported is drawn (water, structures): those switches live in the 0.3 page's own state. */
export const drawn = { water: true, architecture: true }
/**
 * Sets one of those switches. Always passed on (the page's own state ignores a value it already has), and noted here at once: the page reports
 * its switches back only after React has drawn it, and a check against that late report could skip a change made just before it (so water
 * could stay off in Explore, or stay on where a page had hidden it).
 */
export function setLayer(kind: 'water' | 'architecture', on: boolean) {
  drawn[kind] = on
  worldActions.world.layer(kind, on)
}

function keep() {
  if (kept) return
  const c = environment.controls
  const e = getExplore()
  kept = { scale: c.scale, year: c.year, day: c.day, hour: c.hour, playing: c.playing, speed: c.speed, yearSpeed: c.yearSpeed, weatherMode: c.weatherMode, overlay: vegetationState().overlay, plants: vegetationState().show, water: drawn.water, architecture: drawn.architecture, lens: { view: e.view, sub: e.sub }, experience: getExperience() }
}

/** Puts back what Explore had. */
export function restoreExplore() {
  stopDrift()
  loading.creatureMarks = false
  if (!kept) return
  const k = kept
  kept = null
  if (creatureCam.get().mode !== 'off') worldActions.creatures.camera('off')
  setTimeScale(k.scale)
  setYear(k.year)
  setDay(k.day)
  setHour(k.hour)
  setSpeed(k.speed)
  setYearSpeed(k.yearSpeed)
  environment.controls.weatherMode = k.weatherMode
  // (Back on the timeline, the sky is the seed's forecast for this moment again, whatever a page set by hand.)
  if (k.weatherMode === 'timeline') setHour(k.hour)
  setPlaying(k.playing)
  setVegetation({ overlay: k.overlay, show: k.plants })
  setLayer('water', k.water)
  setLayer('architecture', k.architecture)
  setCard(null)
  setExplore({ view: k.lens.view, sub: k.lens.sub })
  setExperience(k.experience)
}

/** The world as it first appears: no lens, no card, everything drawn. */
export function plainScene() {
  setExplore({ view: 'final', sub: 0 })
  setCard(null)
  setExperience('explore')
  setVegetation({ overlay: 'off', show: true })
  setLayer('water', true)
  setLayer('architecture', true)
  worldActions.architecture.select(null)
}

/**
 * HOME'S SCENE: the opening day of observation (its own weather from the seed's forecast), the whole island from the north-west, nothing selected,
 * and the afternoon sun drifting slowly back and forth between 15:00 and 16:30, so the shadows are always gently moving and never leave the
 * afternoon. One swing takes about a minute and a half.
 */
const DRIFT = { from: 15, to: 16.5, seconds: 90 }
let drift = 0
function startDrift() {
  stopDrift()
  let last = 0
  let begunAt = -1
  const tick = (now: number) => {
    drift = requestAnimationFrame(tick)
    // Not while the loading screen is up: each step of the sun redraws the shadows, work better spent on loading. It starts once the island shows.
    if (loading.covered) return
    if (begunAt < 0) begunAt = now
    if (now - last < 100) return
    last = now
    const phase = ((now - begunAt) / 1000 / DRIFT.seconds) * Math.PI * 2
    // Starts at the middle of the range, rising.
    setHour(DRIFT.from + ((DRIFT.to - DRIFT.from) * (1 + Math.sin(phase))) / 2)
  }
  drift = requestAnimationFrame(tick)
}
function stopDrift() {
  if (drift) cancelAnimationFrame(drift)
  drift = 0
}

export function enterHome() {
  keep()
  // (No creature marks on Home: the animals live on, simply too small to see from here.)
  loading.creatureMarks = false
  plainScene()
  restartObservation()
  setTimeScale('daily')
  setPlaying(false)
  startDrift()
  showOverview('home')
}

export function leaveHome() {
  restoreExplore()
}

/** FORMATION takes the world over the same way (ProjectPage › Formation drives its stages). */
export function enterFormation() {
  keep()
  stopDrift()
  plainScene()
  restartObservation()
  setPlaying(false)
  showOverview('formation')
}

export function leaveFormation() {
  restoreExplore()
}
