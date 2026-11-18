import type { LearnStep } from '../shared/ui/learn.tsx'
import { creatureCam } from './creatureCam.ts'
import { environment, type EnvironmentControls } from './environment.ts'
import { observe } from './livingEcology.ts'
import { currentPopulation } from './livingSelection.ts'
import { worldYears } from './livingTime.ts'
import { worldActions } from './worldActions.ts'

/**
 * Shadow Ecology 0.3 — the GUIDE: a five-step walkthrough for a short live presentation, laid over the real world. Each step's text is a script to read aloud
 * as it stands; each step sets up its own scene through worldActions.ts (the same actions the panel uses), so nothing here simulates or draws anything of its
 * own. The card is the shared Learn tour's (shared/ui/learn.tsx). Show → explain → inspect → connect:
 *
 *   1  World overview        the island from Overview at Year 120, 15:30
 *   2  Midterm iteration     Approach to a mature structure, selected, its observation card open
 *   3  Sunlight and shadow   the same structure while the sun sweeps from morning to late afternoon (then holds)
 *   4  Agents                a Hollow Dweller at the tallest standing structure, Locate camera, its card open
 *   5  Behind the world      back to Overview, with optional visits to the three Labs (Return to Guide comes back here)
 *
 * Nothing advances on its own. Entering the guide sets the world to the opening of the observation (Year 120, Day 1, 15:30, paused); leaving it puts the
 * time back as it was and returns to Overview (see ShadowEcology03.tsx). The regular panel stays on the right throughout, lit and usable.
 */
/** What stays lit while the guide is open: the world, and the regular panel beside it (it stays usable). */
const SCENE = [{ select: '.project03 .world-canvas-wrap', outline: false }, { select: '.project03 .instrument-panel', outline: false }] as const

/** The steps the guide stores the world's time from, so leaving it (even by way of a Lab) puts it back. */
let before: Pick<EnvironmentControls, 'scale' | 'year' | 'day' | 'hour' | 'playing' | 'speed' | 'yearSpeed'> | null = null

export function rememberTime() {
  if (before) return
  const c = environment.controls
  before = { scale: c.scale, year: c.year, day: c.day, hour: c.hour, playing: c.playing, speed: c.speed, yearSpeed: c.yearSpeed }
}

/** Puts back the time the guide found (the year, the day, the hour, and whether it was playing). */
export function restoreTime() {
  stopSweep()
  if (!before) return
  const b = before
  before = null
  worldActions.time.scale(b.scale)
  worldActions.time.year(b.year)
  worldActions.time.day(b.day)
  worldActions.time.hour(b.hour)
  worldActions.time.speed(b.speed)
  worldActions.time.yearSpeed(b.yearSpeed)
  worldActions.time.play(b.playing)
}

// ------------------------------------------------------------------------------------------------------------------- scene helpers

/** The sun's sweep in Step 3: the hour eased from one time to another over a few seconds, then held (the clock stays paused). */
let sweep = 0
let sweepStart = 0
function stopSweep() {
  cancelAnimationFrame(sweep)
  window.clearTimeout(sweepStart)
  sweep = 0
}

/** Which step's setup is current: a setup that waits (for a creature camera to close, for the morning light) is dropped if another step has begun since. */
let generation = 0
function sweepHour(from: number, to: number, seconds: number) {
  stopSweep()
  const t0 = performance.now()
  worldActions.time.hour(from)
  let set = from
  const tick = () => {
    // The person's hand wins: if the clock was moved or played from the panel since the last frame, the sweep stops where it is.
    const c = environment.controls
    if (c.playing || Math.abs(c.hour - set) > 0.01) {
      sweep = 0
      return
    }
    const k = Math.min(1, (performance.now() - t0) / (seconds * 1000))
    const e = k * k * (3 - 2 * k)
    set = from + (to - from) * e
    worldActions.time.hour(set)
    sweep = k < 1 ? requestAnimationFrame(tick) : 0
  }
  // A moment on the morning light before it moves.
  sweepStart = window.setTimeout(() => {
    sweep = requestAnimationFrame(tick)
  }, 900)
}

/**
 * Leaving a creature camera hands its pose back to the orbiting view on the scene's next frame; a new view asked for in the same moment would be overridden
 * by that hand-back. So the view waits a few frames after a creature camera is turned off.
 */
function afterCreatureCamera(then: () => void) {
  if (creatureCam.get().mode === 'off') {
    then()
    return
  }
  const mine = generation
  worldActions.creatures.camera('off')
  let frames = 0
  const wait = () => {
    if (mine !== generation) return
    frames += 1
    if (frames < 4) requestAnimationFrame(wait)
    else then()
  }
  requestAnimationFrame(wait)
}

const yearsNow = () => worldYears(environment.controls.year, (environment.controls.day - 1) * 24 + environment.controls.hour)

/** The structure the guide shows: LA-01 (the reference organism, mature at Year 120 on the featured seed), or else the largest mature one, or else the largest standing. */
function showcase(): number | null {
  const population = currentPopulation()
  if (!population) return null
  const time = yearsNow()
  const stage = (i: number) => observe(population, i, time).stage
  const reference = population.organisms.findIndex((o) => o.id === 'LA-01')
  if (reference >= 0 && stage(reference) === 'Maturity') return reference
  const by = (ok: (s: string) => boolean) =>
    population.organisms.map((o, i) => ({ i, r: o.radius, s: stage(i) })).filter((o) => ok(o.s)).sort((a, b) => b.r - a.r)[0]?.i ?? null
  return by((s) => s === 'Maturity') ?? by((s) => s !== 'Death' && s !== 'Not yet here') ?? 0
}

/**
 * The animal the guide shows: the Hollow Dweller at the tallest structure that stands (alive, or as remains), since the tallest casts the most shade for it to
 * lie up in; or else the first Dweller; or else a Litter Crawler.
 */
function showcaseCreature(): { species: 'dweller' | 'crawler'; index: number } {
  const cam = creatureCam.get()
  // Before the creatures are placed every count is 0: ask for the first Dweller (its camera finds it when it is built). A Crawler only if there are none.
  const placed = cam.counts.dweller + cam.counts.crawler + cam.counts.strider + cam.counts.glider
  if (placed > 0 && cam.counts.dweller === 0) return { species: 'crawler', index: 0 }
  const population = currentPopulation()
  if (population) {
    const time = yearsNow()
    let best = -1
    let tallest = -1
    cam.homes.dweller.forEach((home, k) => {
      const i = population.organisms.findIndex((o) => o.id === home)
      if (i < 0 || observe(population, i, time).stage === 'Not yet here') return
      const h = population.organisms[i]!.height ?? 0
      if (h > tallest) {
        tallest = h
        best = k
      }
    })
    if (best >= 0) return { species: 'dweller', index: best }
  }
  return { species: 'dweller', index: 0 }
}

/**
 * What every step starts from: nothing drawn on the ground, the sun's sweep stopped. A step sets its scene once, as it opens; after that the panel is the
 * person's, and nothing the guide does overrides it until the next step.
 */
function common() {
  generation += 1
  stopSweep()
  worldActions.ground.map('off')
  worldActions.creatures.framing(null)
  worldActions.creatures.patrol(false)
}

// ------------------------------------------------------------------------------------------------------------------- the steps

export const GUIDE03_STEPS: readonly LearnStep[] = [
  {
    title: 'What is Shadow Ecology?',
    points: [
      'Shadow Ecology is a fictional island, about four kilometers across, ==generated from a single seed==.',
      'It has mountains, lakes, rivers, different plant communities, living architecture, and creatures.',
      '==The colors represent different environments==. Dark green is woodland, pale green is meadow, and the gray-beige areas are mostly bare rock.',
      'And none of these elements are placed completely at random. They ==follow rules== based on things like sunlight, moisture, slope, and water.',
    ],
    notice: 'The whole island from Overview, Year 120, mid-afternoon.',
    target: SCENE,
    enter: () => {
      common()
      afterCreatureCamera(() => {
        worldActions.architecture.select(null)
        worldActions.time.hour(15.5)
        worldActions.navigation.view('overview', true)
      })
    },
  },
  {
    title: 'Midterm iteration: Living Architecture',
    points: [
      'At the midterm, the feedback I got was that my architecture’s ==form, scale, and purpose weren’t very clear==. It was also hard to tell how it related to the surrounding environment.',
      'So I redesigned it.',
      'Each structure now grows from a small base into a tower, then develops an overhang supported by columns. It goes through ==a full life cycle==, from growth and maturity to decline and eventually ruin.',
      'This one is fully grown, and it’s tens of meters tall.',
      'And the card next to it shows ==live information==, like its age, growth stage, and health.',
    ],
    notice: 'The selected structure and its card.',
    target: SCENE,
    enter: () => {
      common()
      afterCreatureCamera(() => {
        worldActions.time.hour(15.5)
        const index = showcase()
        if (index === null) return
        worldActions.architecture.select({ kind: 'organism', index })
        worldActions.architecture.lookCloser()
      })
    },
  },
  {
    title: 'Sunlight, shadow and habitat',
    points: [
      'As the sun moves, ==the shadows move with it==.',
      'And that affects where plants and animals live. Some plants, like ==ferns, prefer cooler, shaded areas==, while others, like ==grasses, do better in the sun==.',
      'Animals respond to these changes too. And that’s what we’ll look at next.',
    ],
    notice: 'The sun sweeps from 08:00 to 17:00, then holds.',
    target: SCENE,
    enter: () => {
      common()
      afterCreatureCamera(() => {
        const index = showcase()
        if (index !== null) {
          worldActions.architecture.select({ kind: 'organism', index })
          worldActions.architecture.lookCloser()
        }
        sweepHour(8, 17, 9)
      })
    },
  },
  {
    title: 'Agents: creatures and behaviour',
    points: [
      'I also added ==four different types of creatures==. Some live around the structures, some stay close to the ground, some prefer shallow water, and others can fly.',
      'Each one has its own behavior. They move around, look for food, and rest depending on things like ==daylight, shade, and their energy==.',
      'This one is called a Hollow Dweller. And the card in the lower left shows what it’s doing, why it’s doing it, and ==how much shade it’s getting right now==.',
    ],
    notice: 'The creature card, lower left: Why, Where, Body.',
    target: SCENE,
    enter: () => {
      common()
      worldActions.architecture.select(null)
      // Always the same moment, whatever was done before: Year 120, Day 1, 14:00, on the day cycle (the Dweller lies up by day in its structure's shade).
      worldActions.time.scale('daily')
      worldActions.time.year(120)
      worldActions.time.day(1)
      worldActions.time.hour(14)
      const pick = showcaseCreature()
      worldActions.creatures.choose(pick.species, pick.index)
      // Wider than usual, from the open side, looking past the Dweller at its structure: the fern understory it rests among would fill a close view, and from
      // above the overhang's roof would hide it.
      worldActions.creatures.framing({ scale: 2.2, elevation: 0.55, awayFromHome: true })
      worldActions.creatures.camera('locate')
      // It walks a set loop over open ground beside its structure, so its walk can be seen throughout the step.
      worldActions.creatures.patrol(true)
    },
  },
  {
    title: 'Behind the world: Labs and exploration',
    points: [
      'I built different parts of the world ==separately in three Labs==, then brought them together.',
      'You can ==explore the world==, inspect the structures, and follow the creatures.',
      'Right now, the influence mostly goes from sunlight and architecture to plants and animals. In the future, I’d like to add ==two-way feedback==, where creatures also change their surroundings.',
    ],
    target: SCENE,
    enter: () => {
      common()
      afterCreatureCamera(() => {
        worldActions.architecture.select(null)
        worldActions.time.hour(15.5)
        worldActions.navigation.view('overview', true)
      })
    },
  },
]

/** The optional Lab visits on the last step: each opens the Lab; Return to Guide comes back to this step. */
const LABS = [
  { id: 'architecture-lab', label: 'Architecture Lab' },
  { id: 'vegetation-lab', label: 'Vegetation Lab' },
  { id: 'creature-lab', label: 'Creature Lab' },
]

export function GuideLabLinks({ step }: { step: number }) {
  return (
    <div className="guide-labs">
      <span className="guide-labs-label">Optional · open a Lab</span>
      <div className="guide-labs-row">
        {LABS.map((lab) => (
          <button key={lab.id} type="button" className="text-button" onClick={() => worldActions.labs.visit(lab.id, step)}>
            {lab.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Leaving the guide: the sun's sweep stops and creature cameras close (the page then restores the time, the view and the panel). */
export function leaveGuideScene(then: () => void) {
  generation += 1
  stopSweep()
  worldActions.creatures.framing(null)
  worldActions.creatures.patrol(false)
  afterCreatureCamera(then)
}
