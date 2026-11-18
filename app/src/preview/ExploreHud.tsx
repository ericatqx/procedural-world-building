import { Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react'
import type { SpeciesId } from '../creature-lab/types.ts'
import { creatureCam, useCreatureCam, type CreatureMode } from '../project03/creatureCam.ts'
import { CONDITIONS, SPEEDS, YEAR_SPEEDS, clearWeather, environment, restartObservation, setAdjust, setDay, setHour, setPlaying, setSpeed, setTimeScale, setWindDirection, setYear, setYearSpeed, toggleCondition, type Condition, type Speed } from '../project03/environment.ts'
import { setDiagSoft, type DiagSub, type DiagView } from '../project03/visualDiagnostics.ts'
import { setExperience, useExperience } from '../project03/experience.ts'
import { getExplore, setCard, setExplore, useExplore } from '../project03/exploreData.tsx'
import type { ViewMode } from '../project03/LandscapeView.tsx'
import { select } from '../project03/livingSelection.ts'
import { LIFECYCLE, OBSERVATION_START } from '../project03/livingTime.ts'
import { setVegetation, useVegetation } from '../project03/vegStore.ts'
import { worldActions } from '../project03/worldActions.ts'
import { formatHour, useClock } from './clock.ts'
import { PhotoMode } from './PhotoMode.tsx'
import { FieldExpedition, FieldNotes } from './FieldExpedition.tsx'
import { showOverview } from './homeScene.ts'
import type { WorldView } from './PreviewSite.tsx'

const VIEWS: { value: ViewMode; label: string; note: string }[] = [
  { value: 'overview', label: 'Island', note: 'The whole island from above. Drag to orbit, scroll to zoom. Open Vegetation on the rail to find and read the plants.' },
  { value: 'approach', label: 'Approach', note: 'One place, from above. Scroll out for the island, in for the ground. Open Vegetation on the rail to find and read the plants.' },
  { value: 'explore', label: 'Walk', note: 'On foot, eye at 1.75 m. WASD to move, mouse to look, Shift to hurry, Esc frees the cursor; click the scene to look again.' },
]

const SPECIES: { value: SpeciesId; label: string; where: string }[] = [
  { value: 'dweller', label: 'Hollow Dweller', where: 'lies up in shade by day' },
  { value: 'crawler', label: 'Litter Crawler', where: 'keeps to litter under trees' },
  { value: 'strider', label: 'Strider', where: 'works the lake shallows' },
  { value: 'glider', label: 'Veil Glider', where: 'hawks the woodland edge' },
]

const CAMERAS: { value: CreatureMode; label: string }[] = [
  { value: 'locate', label: 'Find' },
  { value: 'follow', label: 'Follow' },
  { value: 'pov', label: 'Its eyes' },
]

const ADJUSTMENT: Record<Condition, string> = { overcast: 'Cloud cover', rain: 'Rainfall', mist: 'Mist density', wind: 'Wind strength' }
const COMPASS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']
const heading = (degrees: number) => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]!

type Drawer = 'lenses' | 'creatures' | 'vegetation' | 'weather' | 'saved'
const DRAWERS: { key: Drawer; label: string }[] = [
  { key: 'lenses', label: 'Lenses' },
  { key: 'creatures', label: 'Creatures' },
  { key: 'vegetation', label: 'Vegetation' },
  { key: 'weather', label: 'Weather' },
  // (Not on the rail: opened from the account menu in the site's navigation, savedViews.ts.)
  { key: 'saved', label: 'Saved views · Explore' },
]
// (Firebase is loaded only when the Saved views drawer opens.)
const SavedDrawer = lazy(() => import('./SavedDrawer.tsx'))
import { onSavedViewsRequest, takeSavedViewsRequest } from './savedViews.ts'
import { findPlants, type Found } from './vegetationFind.ts'
import { SPECIES as PLANT_SPECIES, speciesInfo } from '../project03/worldPlants.ts'
import { inspectPlant } from '../project03/dataProbe.tsx'
import { useVegInspect, vegInspect } from '../project03/vegInspect.ts'

/**
 * THE LENSES: the island coloured by one quantity at a time, named for what they show (the data views behind them are the 0.3 page's own).
 * Grouped by what they are about; each says in a line what it shows. The objects drawn at all (plants, structures, water) are a separate matter.
 */
type Lens = { key: string; label: string; about: string; view: DiagView; sub: DiagSub }
/**
 * ALL PROPERTIES: the island as it is drawn (no lens), with the pointer reading what is at a place and a click opening everything known there:
 * terrain, rock, ground cover, habitat, water and light (dataProbe.tsx › inspectAt).
 */
const ALL: Lens = { key: 'all', label: 'All properties', about: 'The island as it is. Hover a place for what it is; click it for everything known there: terrain, rock, plants, habitat, water and light.', view: 'final', sub: 0 }
const LENS_GROUPS: { label: string; lenses: Lens[] }[] = [
  {
    label: 'Land',
    lenses: [
      { key: 'rock', label: 'Rock & soil', about: 'What the ground is made of: rock beds, scree, and ground covered by soil and plants.', view: 'geology', sub: 0 },
      { key: 'slope', label: 'Steepness', about: 'How steep the ground is. Steep rock stays bare; plants settle on gentler ground.', view: 'geology', sub: 1 },
    ],
  },
  {
    label: 'Water',
    lenses: [
      { key: 'flow', label: 'Water flow', about: 'Where water runs and where it rests. Rivers are the bright teal, their evenly spaced marks moving downstream, faster where the river falls faster; steep falls are pale. Lakes are the deep teal and still: no marks.', view: 'water', sub: 0 },
      { key: 'moisture', label: 'Moisture', about: 'How damp the ground is: wetter near water and in hollows.', view: 'ground', sub: 2 },
    ],
  },
  {
    label: 'Life',
    lenses: [
      { key: 'cover', label: 'Plant cover', about: 'What the vegetation lays on the ground: woodland floor, moss, meadow, shore gravel, or bare rock where nothing grows.', view: 'ground', sub: 0 },
      { key: 'habitat', label: 'Habitat zones', about: 'How the ground sorts for plants: light, moisture, slope, height and distance to water make six zones, and each plant species has its own rule over them. (Animals and the Living Architecture read their own measures.)', view: 'ground', sub: 1 },
    ],
  },
  {
    label: 'Light & shade',
    lenses: [
      { key: 'shadow', label: 'Shadows now', about: 'Where the sun does not reach at this moment. It moves with the hour: immediate light, not yet ecology.', view: 'sun', sub: 0 },
      { key: 'shade', label: 'Lasting shade', about: 'Shade that lasts the whole day, of two kinds. The terrain’s: valleys and north faces the sun barely reaches (blue-grey). The structures’: the ground each one keeps in shade from morning to evening (lavender, worked out near where you look). Plants and animals answer to both: the moss edge marks where shade-tolerant ground cover takes over, and the Hollow Dweller lies up in it by day.', view: 'ecolight', sub: 0 },
    ],
  },
]
const ALL_LENSES = [ALL, ...LENS_GROUPS.flatMap((g) => g.lenses)]

/**
 * THE ENTRY CHOICE. Every time a visitor comes into Explore (by the site's navigation or by its address, and once the world has loaded), a small
 * card offers the two ways in: the guided exploration (the 0.3 Guide: a few places where light, structures and life meet) or exploring freely.
 * Either answer, or opening the camera or the Guide from the rail, puts it away for the rest of that visit (the overlay is mounted afresh on each
 * visit: PreviewSite.tsx); the rail's Guide button opens the guide again at any time. Nothing is remembered between visits.
 */
/**
 * EXPLORE. The world fills the window; the interface keeps to four fixed zones so nothing overlaps:
 *   the RAIL along the bottom      views, time (and where the sky comes from), and the entries to the drawers and the Guide
 *   the CARD SLOT low on the left   one thing at a time: the caption, the first-visit introduction, a creature's card, or a lens's legend
 *   the DRAWER on the right         one of Lenses, Creatures or Weather, opened from the rail; compact, so the island stays in view
 *   overlays on the world           the organism card beside its structure, the inspection card, the Guide's card, the Walk map (upper right)
 * Everything goes through the calls the 0.3 panel makes (worldActions, environment, creatureCam, exploreData), so no system is duplicated.
 * How the world is generated (seed, noise, terrain detail, morphology), the visual studies and the developer's readouts are not here: they belong
 * to the Project page and its Labs (and the full 0.3 instrument page in its archive).
 */
export function ExploreHud({ view, ready }: { view: WorldView; ready: boolean }) {
  const [clock, refresh] = useClock()
  const creatures = useCreatureCam()
  const explore = useExplore()
  const veg = useVegetation()
  const [drawer, setDrawer] = useState<Drawer | null>(null)
  // Photography: composing a black-and-white photograph of the island (PhotoMode.tsx).
  const [photo, setPhoto] = useState(false)
  const closePhoto = useCallback(() => setPhoto(false), [])
  // The Field Expedition (FieldExpedition.tsx): its card, what the camera is asked to document, and the visit's field notes.
  const [expedition, setExpedition] = useState(false)
  const [photoSubject, setPhotoSubject] = useState('')
  const [notesOpen, setNotesOpen] = useState(false)
  const [intro, setIntro] = useState(true)
  const daily = clock.scale === 'daily'
  const lensOn = explore.view !== 'final'
  // (All properties: the plain island, read by the pointer.)
  const experience = useExperience()
  const allOn = !lensOn && experience === 'made'
  const guiding = view.guide
  const manualSky = environment.controls.weatherMode === 'manual'

  // Explore's lenses are drawn on the island (tinted, with contours), not in place of it: the flat technical drawing is World Anatomy's (Project).
  useEffect(() => {
    setDiagSoft(true)
    return () => setDiagSoft(false)
  }, [])
  // A link from Project may name a lens (?lens=habitat) or a species (?creature=dweller): it is put on once the world is shown, and the address is tidied.
  useEffect(() => {
    if (!ready) return
    const params = new URLSearchParams(window.location.search)
    const asked = params.get('lens')
    // …or a species (?creature=strider): the camera finds one of them.
    const species = params.get('creature')
    if (!asked && !species) {
      // An ordinary arrival opens on Explore's own default presentation (round 18), not what a previous visit or another page left: the plain island,
      // every layer drawn, the seed's own weather. (The overview itself is PreviewSite's on arrival; a saved view, asked for, is applied after this.)
      plainWorld()
      setVegetation({ show: true })
      worldActions.world.layer('water', true)
      worldActions.world.layer('architecture', true)
      environment.controls.weatherMode = 'timeline'
      return
    }
    const lens = ALL_LENSES.find((l) => l.key === asked)
    if (lens) applyLens(lens)
    if (species && SPECIES.some((s) => s.value === species)) {
      worldActions.creatures.species(species as SpeciesId)
      worldActions.creatures.camera('locate')
    }
    window.history.replaceState(null, '', window.location.pathname)
  }, [ready])
  // Saved views, asked for from the account menu: at once here, or on arrival from another page once the island is there.
  useEffect(() => {
    if (!ready) return
    const open = () => {
      if (takeSavedViewsRequest()) {
        setIntro(false)
        setDrawer('saved')
      }
    }
    open()
    return onSavedViewsRequest(open)
  }, [ready])
  // The first-visit introduction arrives a moment after the island does, rather than with it.
  const [introDue, setIntroDue] = useState(false)
  useEffect(() => {
    if (!ready || !intro) return
    const id = window.setTimeout(() => setIntroDue(true), 1400)
    return () => window.clearTimeout(id)
  }, [ready, intro])

  // C opens or closes the camera (not while typing in a field).
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'c' || event.metaKey || event.ctrlKey || event.altKey) return
      const t = event.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      setPhoto((p) => !p)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  // Esc closes the drawer (the world also uses Esc: it releases the walking cursor and cancels a pending choice of place).
  useEffect(() => {
    if (!drawer) return
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setDrawer(null)
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [drawer])

  const act = (change: () => void) => {
    change()
    refresh()
  }
  const toggle = (next: Drawer) => setDrawer((current) => (current === next ? null : next))
  /** The Guide starts from the plain world: no lens, no drawer (it sets its own views, time and creature camera as it goes). */
  const startGuide = () => {
    setDrawer(null)
    plainWorld()
    worldActions.guide.open(true)
  }
  const closeIntro = (start: boolean) => {
    setIntro(false)
    if (start) startGuide()
  }
  // SAVED VIEWS (SavedDrawer.tsx): the view a visitor has made, as plain data; never the island, which its seed generates.
  const captureView = () => {
    const e = getExplore()
    const lens = e.view === 'final' ? null : (ALL_LENSES.find((l) => l.view === e.view && l.sub === e.sub) ?? null)
    const c = environment.controls
    return { day: c.day, hour: c.hour, lens: lens?.key ?? '', plants: veg.show, water: view.water, structures: view.architecture, weatherMode: c.weatherMode, overcast: c.conditions.overcast, rain: c.conditions.rain, mist: c.conditions.mist, wind: c.conditions.wind }
  }
  const viewSummary = () => {
    const v = captureView()
    const lens = ALL_LENSES.find((l) => l.key === v.lens)
    return `Day ${v.day} · ${String(Math.floor(v.hour)).padStart(2, '0')}:${String(Math.round((v.hour % 1) * 60)).padStart(2, '0')} · ${lens ? lens.label : 'the island as it is'} · ${v.weatherMode === 'manual' ? 'weather set by hand' : "the seed's weather"}`
  }
  const applyView = (s: Record<string, unknown>) => {
    setPlaying(false)
    setDay(Math.max(1, Number(s.day) || 1))
    setHour(Math.max(0, Math.min(23.99, Number(s.hour) || 12)))
    applyLens(ALL_LENSES.find((l) => l.key === s.lens) ?? null)
    setVegetation({ show: s.plants !== false })
    worldActions.world.layer('water', s.water !== false)
    worldActions.world.layer('architecture', s.structures !== false)
    const c = environment.controls
    if (s.weatherMode === 'manual') {
      c.weatherMode = 'manual'
      c.conditions = { overcast: !!s.overcast, rain: !!s.rain, mist: !!s.mist, wind: !!s.wind }
    } else c.weatherMode = 'timeline'
    setHour(environment.controls.hour)
    refresh()
  }
  // What differs from the world as it first appears (time aside: the clock has its own reset).
  const changed = lensOn || allOn || !veg.show || !view.water || !view.architecture || creatures.mode !== 'off' || manualSky
  const restore = () => {
    plainWorld()
    setVegetation({ show: true })
    if (!view.water) worldActions.world.layer('water', true)
    if (!view.architecture) worldActions.world.layer('architecture', true)
    // The sky back to the seed's forecast for this moment (the clock stays as it is).
    environment.controls.weatherMode = 'timeline'
    setHour(environment.controls.hour)
    setDrawer(null)
    showOverview('explore')
    refresh()
  }

  const current = view.placing ? 'explore' : view.picking ? 'approach' : view.mode
  const note = view.placing ? 'Click the ground where you want to stand. Esc to cancel.' : view.picking ? 'Click a place on the island to look at it from above. Esc to cancel.' : VIEWS.find((v) => v.value === current)!.note
  // The card slot holds one thing: a creature's card or a lens's legend (both drawn by the world) take it from the caption.
  const slotTaken = creatures.mode !== 'off' || lensOn
  // (The introduction comes first on arrival, whatever lens or creature view was left on: those step back while it is open.)
  const showIntro = ready && intro && introDue && !guiding

  return (
    <div className="pv-explore" data-intro={showIntro || undefined} data-guide={guiding} data-creature={creatures.mode !== 'off'} data-lens={lensOn} data-photo={photo}>
      {photo ? (
        <PhotoMode
          onClose={closePhoto}
          subject={photoSubject}
          onNotes={() => {
            setPhoto(false)
            setNotesOpen(true)
          }}
        />
      ) : null}
      {notesOpen ? <FieldNotes onClose={() => setNotesOpen(false)} /> : null}
      {expedition && !guiding && !photo ? (
        <FieldExpedition
          onDocument={(subject) => {
            setPhotoSubject(subject)
            setDrawer(null)
            setPhoto(true)
          }}
          onNotes={() => setNotesOpen(true)}
          onEnd={() => setExpedition(false)}
        />
      ) : null}
      {guiding || expedition ? null : showIntro ? (
        <section className="pv-card pv-intro" aria-label="Introduction">
          <p className="pv-card-label">Three ways in</p>
          <p className="pv-card-title">An island shaped by shadow. Take the guided tour, set out on a field expedition, or explore it freely.</p>
          <p className="pv-card-text">The guide visits a few places where light, structures and life meet: about two minutes, and you can leave it at any step. It stays under Guide on the rail.</p>
          <p className="pv-card-text">On the field expedition you arrive as a lone observer on an island without people, where life grew up under sun and lasting shadow: four observations to find and document, nothing to change.</p>
          <p className="pv-card-text">Exploring freely: click a structure, follow an animal under Creatures, or open Vegetation to find a plant and read why it grows where it does.</p>
          <div className="pv-card-actions">
            <button type="button" className="pv-card-primary" onClick={() => closeIntro(true)}>
              Start guided exploration →
            </button>
            <button
              type="button"
              className="pv-card-primary"
              onClick={() => {
                closeIntro(false)
                setExpedition(true)
              }}
            >
              Field expedition →
            </button>
            <button type="button" className="pv-card-secondary" onClick={() => closeIntro(false)}>
              Explore freely
            </button>
          </div>
        </section>
      ) : slotTaken ? null : (
        <div className="pv-caption">
          <p className="pv-caption-mode">{VIEWS.find((v) => v.value === current)!.label}</p>
          <p className="pv-caption-note">{note}</p>
          <button type="button" className="pv-caption-expedition" onClick={() => setExpedition(true)}>
            Field expedition · observe the island →
          </button>
        </div>
      )}

      {drawer && !guiding ? (
        <aside className="pv-drawer" aria-label={drawer} data-annotation-anchor>
          <header className="pv-drawer-head">
            <span>{DRAWERS.find((d) => d.key === drawer)!.label}</span>
            <button type="button" className="pv-text" onClick={() => setDrawer(null)}>
              Close
            </button>
          </header>
          <div className="pv-drawer-body">
            {drawer === 'lenses' ? <LensesDrawer view={view} /> : null}
            {drawer === 'creatures' ? <CreaturesDrawer /> : null}
            {drawer === 'vegetation' ? <VegetationDrawer /> : null}
            {drawer === 'weather' ? <WeatherDrawer onChange={refresh} /> : null}
            {drawer === 'saved' ? (
              <Suspense fallback={<p className="pv-saved-note">Loading…</p>}>
                <SavedDrawer capture={captureView} apply={applyView} reset={restore} summary={viewSummary} />
              </Suspense>
            ) : null}
          </div>
        </aside>
      ) : null}

      <nav className="pv-rail" aria-label="World">
        <div className="pv-rail-group" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              className="pv-rail-button"
              aria-pressed={creatures.mode === 'off' && current === v.value}
              onClick={() =>
                // From Walk, Approach looks at the ground you were walking (no new place to pick); elsewhere it asks for one, as it always has.
                worldActions.navigation.view(v.value, v.value === 'approach' && view.mode === 'explore' && !view.placing)
              }
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="pv-rail-group pv-time">
          <button type="button" className="pv-play" aria-label={clock.playing ? 'Pause' : 'Play'} title={clock.playing ? 'Pause' : 'Play: time runs, and the sky follows the forecast'} onClick={() => act(() => setPlaying(!clock.playing))}>
            {clock.playing ? <PauseGlyph /> : <PlayGlyph />}
          </button>
          <div className="pv-scrub" data-scale={clock.scale}>
            {daily ? <span className="pv-daylight" aria-hidden /> : <span className="pv-lifecycle" aria-hidden style={{ ['--ref' as string]: `${(OBSERVATION_START / LIFECYCLE.horizon) * 100}%` }} />}
            <input
              type="range"
              aria-label={daily ? 'Time of day' : 'World year'}
              min={0}
              max={daily ? 24 : LIFECYCLE.horizon}
              step={daily ? 0.25 : 1}
              value={daily ? clock.hour : clock.year}
              style={{ ['--at' as string]: `${((daily ? clock.hour / 24 : clock.year / LIFECYCLE.horizon) * 100).toFixed(2)}%` }}
              onChange={(event) => act(() => (daily ? setHour(Number(event.target.value)) : setYear(Number(event.target.value))))}
            />
            <div className="pv-scrub-ticks" aria-hidden>
              {daily ? ['00', '06', '12', '18', '24'].map((t) => <span key={t}>{t}</span>) : ['0', '100', '200', '300'].map((t) => <span key={t}>{t}</span>)}
            </div>
          </div>
          <div className="pv-time-read">
            <span className="pv-time-big">{daily ? formatHour(clock.hour) : Math.floor(clock.year)}</span>
            <span className="pv-time-small">
              {daily ? (
                <>
                  <button type="button" aria-label="Previous day" disabled={clock.day <= 1} onClick={() => act(() => setDay(clock.day - 1))}>
                    ‹
                  </button>
                  <span>Day {clock.day}</span>
                  <button type="button" aria-label="Next day" onClick={() => act(() => setDay(clock.day + 1))}>
                    ›
                  </button>
                </>
              ) : (
                <span>Year, of {LIFECYCLE.horizon}</span>
              )}
            </span>
          </div>
          <div className="pv-time-tools">
            <div className="pv-scale" role="group" aria-label="Time scale">
              <button type="button" className="pv-rail-button" aria-pressed={daily} title="One day: the sun crosses the sky" onClick={() => act(() => setTimeScale('daily'))}>
                Day
              </button>
              <button type="button" className="pv-rail-button" aria-pressed={!daily} title="The years: structures grow, age and fall" onClick={() => act(() => setTimeScale('evolution'))}>
                Years
              </button>
            </div>
            <span className="pv-time-meta">
              <button
                type="button"
                className="pv-speed"
                title="Playback speed: click to change"
                onClick={() =>
                  act(() => {
                    if (daily) setSpeed(SPEEDS[(SPEEDS.indexOf(clock.speed) + 1) % SPEEDS.length] as Speed)
                    else setYearSpeed(YEAR_SPEEDS[(YEAR_SPEEDS.indexOf(clock.yearSpeed as (typeof YEAR_SPEEDS)[number]) + 1) % YEAR_SPEEDS.length]!)
                  })
                }
              >
                {daily ? `${clock.speed}×` : `${clock.yearSpeed} y/s`}
              </button>
              <button type="button" className="pv-speed" title={`Back to Year ${OBSERVATION_START}, Day 1, 15:30`} onClick={() => act(restartObservation)}>
                ↺ start
              </button>
            </span>
          </div>
        </div>

        <div className="pv-rail-group pv-rail-end">
          {/* Always in place (only hidden when there is nothing to restore), so the rail never shifts. */}
          <button type="button" className="pv-rail-button pv-restore" data-hidden={!changed || guiding} tabIndex={changed && !guiding ? 0 : -1} title="No lens, everything shown, the sky back to auto, the island from above" onClick={restore}>
            ↺ Default view
          </button>
          {DRAWERS.filter((d) => d.key !== 'saved').map((d) => (
            <button key={d.key} type="button" className="pv-rail-button" aria-expanded={drawer === d.key} disabled={guiding} onClick={() => toggle(d.key)}>
              {d.label}
              {d.key === 'lenses' && (lensOn || allOn) ? <i className="pv-dot" aria-hidden /> : null}
              {d.key === 'creatures' && creatures.mode !== 'off' ? <i className="pv-dot" aria-hidden /> : null}
              {d.key === 'weather' ? (
                <span className="pv-rail-status" data-held={manualSky} title={`${clock.weather}: ${manualSky ? 'set by hand' : 'automatic, following the seed’s forecast'}`}>
                  {manualSky ? 'manual' : 'auto'}
                </span>
              ) : null}
            </button>
          ))}
          <button
            type="button"
            className="pv-rail-button pv-rail-camera"
            title="Camera: compose and keep a photograph (C)"
            aria-pressed={photo}
            onClick={() => {
              setIntro(false)
              setDrawer(null)
              setCard(null)
              setPhotoSubject('')
              setPhoto((p) => !p)
            }}
          >
            <svg width="14" height="11" viewBox="0 0 14 11" aria-hidden>
              <rect x="0.5" y="2.5" width="13" height="8" rx="1" fill="none" stroke="currentColor" />
              <path d="M4.5 2.5 L5.5 0.5 H8.5 L9.5 2.5" fill="none" stroke="currentColor" />
              <circle cx="7" cy="6.5" r="2.2" fill="none" stroke="currentColor" />
            </svg>
            Camera
          </button>
          <button
            type="button"
            className="pv-rail-button pv-guide"
            aria-pressed={guiding}
            onClick={() => {
              setIntro(false)
              if (guiding) worldActions.guide.open(false)
              else startGuide()
            }}
          >
            {guiding ? 'Leave guide' : 'Guide'}
          </button>
        </div>
      </nav>
    </div>
  )
}

/** Puts a lens on (or, with null, takes it off): a pending choice of place (Approach, Walk) is dropped first, so the next click pins a reading
 * rather than moving the camera; the organism selection steps aside while a lens is on. */
function applyLens(lens: Lens | null) {
  if (!lens) {
    plainWorld()
    return
  }
  worldActions.navigation.cancelPick()
  select(null)
  setCard(null)
  setExplore({ view: lens.view, sub: lens.sub })
  setExperience('made')
}

/** Back to the world as it is: no lens, no inspection card, organisms selectable again. */
function plainWorld() {
  setExplore({ view: 'final', sub: 0 })
  setCard(null)
  setExperience('explore')
}

/** One labelled group in a drawer: a mono label over its content, separated by a hairline. */
export function Group({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="pv-group">
      <p className="pv-group-label">{label}</p>
      {children}
      {note ? <p className="pv-drawer-note">{note}</p> : null}
    </section>
  )
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="pv-check" onClick={() => onChange(!checked)}>
      <i aria-hidden />
      {label}
    </button>
  )
}

export function Range({ label, value, min, max, step, shown, onChange }: { label: string; value: number; min: number; max: number; step: number; shown: string; onChange: (v: number) => void }) {
  return (
    <label className="pv-range">
      <span className="pv-range-row">
        <span>{label}</span>
        <span className="pv-range-value">{shown}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} style={{ ['--at' as string]: `${(((value - min) / (max - min)) * 100).toFixed(2)}%` }} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}

/**
 * LENSES. Two different things, kept apart: READ THE ISLAND (colour it by one quantity: an observation of the ecology) and SHOW ON THE ISLAND
 * (whether plants, structures and water are drawn at all).
 */
function LensesDrawer({ view }: { view: WorldView }) {
  const explore = useExplore()
  const veg = useVegetation()
  const experience = useExperience()
  // (All properties is the plain island with inspection on: the plain island without it is no lens at all.)
  const active = explore.view === 'final' ? (experience === 'made' ? ALL : null) : (ALL_LENSES.find((l) => l.view === explore.view && l.sub === explore.sub) ?? null)
  const choose = (lens: Lens | null) => applyLens(lens === active ? null : lens)
  return (
    <>
      <Group label="Read the island">
        <p className="pv-drawer-note">One property of the island at a time. Hover a place to read it; click it to keep a detailed reading.</p>
        <div className="pv-lens-group">
          <span className="pv-lens-head">Overview</span>
          <div className="pv-lens-row">
            <button type="button" className="pv-lens" aria-pressed={active?.key === 'all'} onClick={() => choose(ALL)}>
              {ALL.label}
            </button>
          </div>
        </div>
        {LENS_GROUPS.map((g) => (
          <div key={g.label} className="pv-lens-group">
            <span className="pv-lens-head">{g.label}</span>
            <div className="pv-lens-row">
              {g.lenses.map((l) => (
                <button key={l.key} type="button" className="pv-lens" aria-pressed={active?.key === l.key} onClick={() => choose(l)}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        {active ? (
          <div className="pv-lens-about">
            <p>{active.about}</p>
            <button type="button" className="pv-text" onClick={() => choose(null)}>
              Back to the plain island
            </button>
          </div>
        ) : null}
      </Group>
      <Group label="Show on the island">
        <div className="pv-lens-row">
          <button type="button" className="pv-lens" aria-pressed={veg.show} onClick={() => setVegetation({ show: !veg.show })}>
            Plants
          </button>
          <button type="button" className="pv-lens" aria-pressed={view.architecture} onClick={() => worldActions.world.layer('architecture', !view.architecture)}>
            Structures
          </button>
          <button type="button" className="pv-lens" aria-pressed={view.water} onClick={() => worldActions.world.layer('water', !view.water)}>
            Water
          </button>
        </div>
      </Group>
    </>
  )
}

/** CREATURES: who lives here, and a camera that finds, follows or sees as one of them (its card takes the card slot). */
function CreaturesDrawer() {
  const creatures = useCreatureCam()
  return (
    <>
      <Group label="Species">
        <ul className="pv-species">
          {SPECIES.map((s) => (
            <li key={s.value}>
              <button type="button" aria-pressed={creatures.species === s.value} onClick={() => creatureCam.setSpecies(s.value)}>
                <span className="pv-species-name">{s.label}</span>
                <span className="pv-species-where">{s.where}</span>
                <span className="pv-species-count">{creatures.counts[s.value] || '–'}</span>
              </button>
            </li>
          ))}
        </ul>
      </Group>
      <Group label="Watch one" note={creatures.mode !== 'off' && creatures.info ? creatures.info.state : 'Find frames the animal; Follow keeps behind it; Its eyes sees what it sees. Esc returns.'}>
        <div className="pv-row">
          {CAMERAS.map((c) => (
            <button key={c.value} type="button" className="pv-lens" aria-pressed={creatures.mode === c.value} onClick={() => worldActions.creatures.camera(c.value)}>
              {c.label}
            </button>
          ))}
          <span className="pv-stepper">
            <button type="button" className="pv-text" aria-label="Previous individual" onClick={() => creatureCam.step(-1)}>
              ‹
            </button>
            <span>{creatures.counts[creatures.species] ? `${creatures.index + 1} of ${creatures.counts[creatures.species]}` : 'none yet'}</span>
            <button type="button" className="pv-text" aria-label="Next individual" onClick={() => creatureCam.step(1)}>
              ›
            </button>
          </span>
        </div>
        {creatures.mode !== 'off' ? (
          <button type="button" className="pv-text" onClick={() => worldActions.creatures.camera('off')}>
            Let go
          </button>
        ) : null}
      </Group>
    </>
  )
}

/**
 * VEGETATION, as Creatures is for the animals: the island's species (the World's own, worldPlants.ts, named as the Vegetation Lab names them), each with
 * its layer and light strategy. Choosing one finds a real individual near where you are looking (vegetationFind.ts: the species' own rule over the
 * island's fields, then the very plants the renderer draws there), frames it, and opens its card: its form, the light where it stands and whose
 * shade that is, what it prefers, its habitat and why it grows there. "Another" steps to the next one found.
 */
const PLANT_LIST = PLANT_SPECIES.filter((p) => p.id !== 'vine' && p.id !== 'curtain' && p.id !== 'ribbons').map((p) => ({ id: p.id, ...speciesInfo(p.id) }))
const LIGHT_WORD: Record<string, string> = { sun: 'sun', shade: 'shade', broad: 'sun or shade' }
const LAYER_WORD: Record<string, string> = { tall: 'Tree', shrub: 'Shrub', cover: 'Ground' }
function VegetationDrawer() {
  const [chosen, setChosen] = useState<string | null>(null)
  const [found, setFound] = useState<Found[]>([])
  const [at, setAt] = useState(0)
  const [note, setNote] = useState('Choose a species: a real plant of it near where you are looking is framed and explained here. While this panel is open you can also click any plant in the island to read it.')
  // Plants are identified only while this panel is open (vegInspect.ts); the plant being read is shown in full below.
  const inspect = useVegInspect()
  useEffect(() => {
    vegInspect.setOn(true)
    return () => vegInspect.setOn(false)
  }, [])
  const show = (list: Found[], i: number) => {
    const p = list[i]
    if (!p) return
    const info = speciesInfo(p.id)
    const h = Math.max(0.4, info.height * p.s)
    // (A short, straight glide to it; no arc. The plant's card is in this panel at once, and stays: no world callout, which hid the hover readout.)
    worldActions.navigation.approach(p.x, p.z, Math.max(9, Math.min(55, h * 3.4)), { aim: h * 0.45, glide: 1.1, elev: 0.3 })
    worldActions.navigation.view('approach', true)
    const read = inspectPlant(p)
    vegInspect.show(read ? { title: read.title, tag: read.tag, summary: read.summary } : null)
    setNote(`${i + 1} of ${list.length} found near your view. Point at any plant to name it; click it to read it here.`)
  }
  const choose = (id: string) => {
    setChosen(id)
    const list = findPlants(id as Found['id'])
    setFound(list)
    setAt(0)
    if (list.length) show(list, 0)
    else setNote('None near where you are looking: its habitat is elsewhere on the island. Look at another part of the island and try again.')
  }
  return (
    <>
      <Group label="Species">
        <ul className="pv-species">
          {PLANT_LIST.map((p) => (
            <li key={p.id}>
              <button type="button" aria-pressed={chosen === p.id} onClick={() => choose(p.id)}>
                <span className="pv-species-name">{p.name}</span>
                <span className="pv-species-where">
                  {LAYER_WORD[p.group]} · {LIGHT_WORD[p.light] ?? p.light}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Group>
      <Group label="Find one" note={note}>
        {found.length > 1 ? (
          <span className="pv-stepper">
            <button type="button" className="pv-text" aria-label="Previous plant" onClick={() => { const i = (at + found.length - 1) % found.length; setAt(i); show(found, i) }}>
              ‹
            </button>
            <span>{`${at + 1} of ${found.length}`}</span>
            <button type="button" className="pv-text" aria-label="Another plant" onClick={() => { const i = (at + 1) % found.length; setAt(i); show(found, i) }}>
              ›
            </button>
          </span>
        ) : null}
      </Group>
      {inspect.card ? (
        <section className="pv-plant-card" aria-live="polite">
          <p className="pv-plant-card-tag">{inspect.card.tag}</p>
          <h3 className="pv-plant-card-title">{inspect.card.title}</h3>
          <dl>
            {inspect.card.summary.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </>
  )
}

/**
 * WEATHER. The sky has two sources: the seed's own FORECAST, which the sky follows whenever time plays, and a sky HELD BY HAND here. Choosing a sky
 * pauses the clock and holds it (environment.ts); Play hands it back to the forecast.
 */
function WeatherDrawer({ onChange }: { onChange: () => void }) {
  const [, setTick] = useState(0)
  const c = environment.controls
  const act = (change: () => void) => {
    change()
    setTick((t) => t + 1)
    onChange()
  }
  const clear = !CONDITIONS.some(({ value }) => c.conditions[value])
  const held = c.weatherMode === 'manual'
  return (
    <>
      <Group label={held ? 'Sky · manual' : 'Sky · auto'}>
        <p className="pv-drawer-note">
          {held ? 'Set by hand: the clock is paused and this sky holds. Play, or Back to auto, returns it to the seed’s forecast.' : 'Auto: while time plays, the sky follows this seed’s own forecast. Choosing a sky sets it by hand (the clock pauses).'}
        </p>
        <div className="pv-lens-row" role="group" aria-label="Weather">
          <button type="button" className="pv-lens" aria-pressed={clear} onClick={() => act(clearWeather)}>
            Clear
          </button>
          {CONDITIONS.map(({ value, label }) => (
            <button key={value} type="button" className="pv-lens" aria-pressed={c.conditions[value]} onClick={() => act(() => toggleCondition(value))}>
              {label}
            </button>
          ))}
        </div>
        {CONDITIONS.filter(({ value }) => c.conditions[value]).map(({ value }) => (
          <Range key={value} label={ADJUSTMENT[value]} value={c.adjust[value]} min={0.2} max={1} step={0.05} shown={`${Math.round(c.adjust[value] * 100)}%`} onChange={(v) => act(() => setAdjust(value, v))} />
        ))}
        {c.conditions.wind ? (
          <>
            <Range label="Wind blows toward" value={c.windDirection} min={0} max={355} step={5} shown={heading(c.windDirection)} onChange={(v) => act(() => setWindDirection(v))} />
            <Check label="Show the wind" checked={c.windField} onChange={(on) => act(() => (environment.controls.windField = on))} />
          </>
        ) : null}
        {held ? (
          <button
            type="button"
            className="pv-text"
            onClick={() =>
              act(() => {
                environment.controls.weatherMode = 'timeline'
                setHour(environment.controls.hour)
              })
            }
          >
            Back to auto
          </button>
        ) : null}
        <p className="pv-drawer-hint">The sky settles over a few seconds; ground wetness after rain takes longer. Rain is drawn around what you are looking at.</p>
      </Group>
      <Group label="Sun" note="Stands in for the season: a higher sun casts shorter shadows.">
        <Range label="Height at noon" value={c.noonElevation} min={20} max={85} step={1} shown={`${Math.round(c.noonElevation)}°`} onChange={(v) => act(() => (environment.controls.noonElevation = v))} />
      </Group>
    </>
  )
}

function PlayGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
      <path d="M3 1.5 L10.5 6 L3 10.5 Z" fill="currentColor" />
    </svg>
  )
}

function PauseGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
      <rect x="2.5" y="1.5" width="2.4" height="9" fill="currentColor" />
      <rect x="7.1" y="1.5" width="2.4" height="9" fill="currentColor" />
    </svg>
  )
}
