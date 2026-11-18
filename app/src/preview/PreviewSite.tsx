import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PageReport } from '../project03/ShadowEcology03.tsx'
import { guideReturn, registerSite } from '../project03/worldActions.ts'
import { loading } from '../project03/loading.ts'
import { HomePage } from './HomePage.tsx'
import { ExploreHud } from './ExploreHud.tsx'
import { PresentPage, PresentationCue } from './Present.tsx'
import { SiteNav } from './SiteNav.tsx'
import { WorldVeil } from './WorldVeil.tsx'
import { drawn, enterHome, leaveHome, setFraming, showOverview, type FramePage } from './homeScene.ts'
import { go, href, useRoute } from './route.ts'
// The shared instrument styles (Learn cards, the organism card, the inspection card): the classic site gets them through its exercises.
import '../shared/ui/system.css'
import '../App.css'
import './preview.css'

// Loaded when first needed: the world (three.js and the 0.3 systems) after the site's own code, and Project and the archive only when opened.
const loadWorld = () => import('../project03/ShadowEcology03.tsx')
const ShadowEcology03 = lazy(() => loadWorld().then((m) => ({ default: m.ShadowEcology03 })))
const ProjectPage = lazy(() => import('./ProjectPage.tsx').then((m) => ({ default: m.ProjectPage })))
const OpenPage = lazy(() => import('./OpenPage.tsx').then((m) => ({ default: m.OpenPage })))

export type WorldView = PageReport

const INITIAL_VIEW: WorldView = {
  mode: 'overview',
  placing: false,
  picking: false,
  terrainSettled: false,
  guide: false,
  water: true,
  architecture: true,
  seed: 0,
  detail: 2,
  falls: [],
  readout: { ground: 0, camera: 0, triangles: 0, pending: 0 },
  hydro: { soil: 0, discharge: 0, lake: 0 },
}

// Plants that arrive after the island is shown grow in rather than appear at once (loading.ts).
loading.growIn = true

const frameOf = (page: string): FramePage | null => (page === 'home' ? 'home' : page === 'explore' ? 'explore' : page === 'project' ? 'formation' : null)

/**
 * The archive pages that are whole worlds of their own (the earlier versions, and 0.3's original instrument page, which shares this world's
 * modules) need the shared world gone. A Lab or an exercise does not: the world stays mounted behind it, hidden and not drawing, so coming back
 * to Project or Explore is immediate instead of a whole new island.
 */
const ownWorld = (id: string) => id === '0.1' || id === '0.2' || id === '0.3'

/**
 * The website prototype. Home, Explore and Project share ONE live world, mounted once and kept while moving between them: Home frames it as a still
 * scene beside its text, Explore hands it over with a camera move, Project's Formation replays how it is built (homeScene.ts keeps Explore's own
 * state aside meanwhile). Only the archive pages (a Lab, an exercise, an earlier version) unmount it. On Project the world stops drawing whenever
 * Formation is out of sight. Whenever the world mounts on Home or Explore, the whole page waits behind the loading screen and appears at once.
 */
export function PreviewSite() {
  const route = useRoute()
  const framePage = frameOf(route.page)
  // The camera's framing for this page is in place before the world reads it as it mounts (its opening pose), and for every later overview.
  if (framePage) setFraming(framePage)

  const [view, setView] = useState<WorldView>(INITIAL_VIEW)
  const [covered, setCovered] = useState(framePage !== null)
  // Project tells whether Formation (the only part of it that shows the world) is on screen.
  const [formationInView, setFormationInView] = useState(true)
  const aside = route.page === 'open' && !ownWorld(route.id)
  const paused = (route.page === 'project' && !formationInView) || aside

  // The Guide can open a Lab and come back to the step it left (worldActions.ts › guideReturn): here a Lab is a page of its own.
  useEffect(() => {
    registerSite((id) => go(id === '0.3' ? href({ page: 'explore' }) : href({ page: 'open', id })))
    return () => registerSite(null)
  }, [])
  // Choosing any page from the site's navigation leaves the Guide for good (as on the 0.3 page), except the way back to it.
  useEffect(() => {
    if (route.page !== 'open' && route.page !== 'explore') {
      guideReturn.step = null
      guideReturn.lab = null
    }
  }, [route.page])

  // Home's and Formation's scenes are set once the world is there to take them (the world resets its clock as it mounts), and on every return.
  const page = useRef(route.page)
  useLayoutEffect(() => {
    page.current = route.page
  }, [route.page])
  const worldAlive = useRef(false)
  const onView = useCallback((next: WorldView) => {
    setView(next)
    drawn.water = next.water
    drawn.architecture = next.architecture
    if (!worldAlive.current) {
      worldAlive.current = true
      // (Project's Formation takes the world itself: ProjectPage.tsx.)
      if (page.current === 'home') enterHome()
    }
  }, [])
  // (Only when the world itself unmounts: moving between Home, Explore and Project keeps it.)
  const worldOn = framePage !== null || aside
  useEffect(() => {
    if (!worldOn) return
    return () => {
      worldAlive.current = false
    }
  }, [worldOn])
  useEffect(() => {
    if (route.page === 'home') {
      if (worldAlive.current) enterHome()
      return () => leaveHome()
    }
    // Arriving in Explore from Home or Project: the camera moves from their framing to Explore's.
    if (route.page === 'explore' && worldAlive.current) showOverview('explore')
  }, [route.page])

  // A new window shape: the framing follows; Home's and Formation's still views are recomposed at once.
  useEffect(() => {
    if (!framePage) return
    let id = 0
    const resize = () => {
      window.clearTimeout(id)
      id = window.setTimeout(() => (framePage === 'explore' ? setFraming('explore') : showOverview(framePage)), 200)
    }
    window.addEventListener('resize', resize)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('resize', resize)
    }
  }, [framePage])

  useEffect(() => {
    document.title = route.page === 'home' ? 'Shadow Ecology' : route.page === 'explore' ? 'Explore — Shadow Ecology' : route.page === 'project' ? 'Project — Shadow Ecology' : 'Archive — Shadow Ecology'
  }, [route.page])

  // The loading screen covers Home and Explore; Project's own text is ready at once (Formation shows its own note until the island is).
  const loadingCover = covered && worldOn && route.page !== 'project' && !aside
  return (
    <div className={`pv-site pv-on-${route.page}`} data-loading={loadingCover}>
      {worldOn ? <WorldStage backdrop={route.page !== 'explore'} hidden={aside} paused={paused} terrainSettled={view.terrainSettled} onView={onView} onCovered={setCovered} /> : null}

      {route.page === 'home' ? <HomePage key="home" /> : null}
      {route.page === 'explore' ? <ExploreHud key="explore" view={view} ready={!covered} /> : null}
      <Suspense fallback={<div className="pv-pending" />}>
        {route.page === 'project' ? <ProjectPage key="project" worldReady={!covered} onFormationInView={setFormationInView} /> : null}
        {route.page === 'open' ? <OpenPage key={route.id} id={route.id} /> : null}
        {route.page === 'present' ? <PresentPage /> : null}
      </Suspense>

      {route.page === 'open' || route.page === 'present' ? null : <SiteNav page={route.page} />}
      {route.page === 'present' ? null : <PresentationCue page={route.page} />}
    </div>
  )
}

/** The world and its loading screen, mounted together: each time the world mounts, the cover is up until it is complete. */
function WorldStage({ backdrop, hidden, paused, terrainSettled, onView, onCovered }: { backdrop: boolean; hidden: boolean; paused: boolean; terrainSettled: boolean; onView: (v: WorldView) => void; onCovered: (on: boolean) => void }) {
  // Before the world mounts: it may build in bigger steps while nobody can see it (loading.ts).
  useState(() => {
    loading.covered = true
    loading.plantsPending = -1
    loading.plantTiles = -1
    return true
  })
  useEffect(() => {
    loading.covered = true
    onCovered(true)
    return () => {
      loading.covered = false
    }
  }, [onCovered])
  const lift = useCallback(() => {
    loading.covered = false
    onCovered(false)
  }, [onCovered])
  return (
    <>
      <div className={`pv-world${backdrop ? ' is-backdrop' : ''}${paused ? ' is-paused' : ''}${hidden ? ' is-aside' : ''}`}>
        <Suspense fallback={null}>
          <ShadowEcology03 onView={onView} paused={paused} />
        </Suspense>
      </div>
      <WorldVeil terrainSettled={terrainSettled} onDone={lift} />
    </>
  )
}
