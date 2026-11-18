import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { LANDSCAPE } from '../project03/terrain.ts'
import { COMPLETE, END, STAGES, applyFormation, endFormation, holdFormation, resetFormation, stageAt } from './formation.ts'
import { enterFormation, leaveFormation } from './homeScene.ts'
import { ArchitecturePreview, CreaturePreview, ExerciseMark, HabitatPreview, VegetationPreview } from './projectFigures.tsx'
import { follow, href } from './route.ts'
import { WorldAnatomy, type SystemKey } from './WorldAnatomy.tsx'

const open = (id: string) => href({ page: 'open', id })
const lensIn = (lens: string) => `${href({ page: 'explore' })}?lens=${lens}`

/** The page's three sections, in order, for the chapter rail. */
const SECTIONS = [
  { id: 'formation', n: '01', label: 'Formation' },
  { id: 'anatomy', n: '02', label: 'Anatomy' },
  { id: 'process', n: '03', label: 'Process' },
]

/* ───────── 03 Process & experiments ───────── */

/** The weeks, the technique each taught, and the systems of the world it went into (each opens in World Anatomy). */
const EXERCISES: { id: string; n: string; name: string; technique: string; systems: SystemKey[] }[] = [
  { id: 'week02', n: '02', name: 'Basics', technique: 'A scene, a camera, geometry, a material and a light: how light meets form.', systems: ['terrain'] },
  { id: 'week03', n: '03', name: 'Noise & Terrain', technique: 'Layered noise heightfields, and an erosion simulation of water and sediment.', systems: ['terrain', 'water'] },
  { id: 'week04', n: '04', name: 'Voxels', technique: 'Density volumes built by CSG steps, meshed as blocks or marching cubes, in chunks.', systems: ['architecture'] },
  { id: 'week05', n: '05', name: 'Shaders', technique: 'Surface rules in GLSL: height bands, slope thresholds and contours.', systems: ['terrain'] },
  { id: 'week06', n: '06', name: 'Spatial Systems', technique: 'Scattering by suitability, paths across terrain, and scalar fields over space.', systems: ['vegetation'] },
  { id: 'week07', n: '07', name: 'Branching Systems', technique: 'L-systems and turtle-traced growth, and the branching histories of a site.', systems: ['vegetation', 'architecture'] },
  { id: 'week08', n: '08', name: 'Agents & Scale', technique: 'Agents that sense and steer, and how a world holds up at scale.', systems: ['creatures'] },
]
const SYSTEM_NAME: Record<SystemKey, string> = { terrain: 'Terrain', water: 'Water', architecture: 'Living Architecture', vegetation: 'Vegetation', creatures: 'Creatures' }

const LABS: { id: string; name: string; text: string; tries: string[]; preview: ReactNode }[] = [
  { id: 'architecture-lab', name: 'Architecture Lab', text: 'One Living Architecture organism on a small stage.', tries: ['Change light, moisture, crowding, exposure', 'Compare morphology families'], preview: <ArchitecturePreview /> },
  { id: 'vegetation-lab', name: 'Vegetation Lab', text: 'The island’s plants as growth strategies.', tries: ['Switch archetypes', 'Compare levels of detail'], preview: <VegetationPreview /> },
  { id: 'creature-lab', name: 'Creature Lab', text: 'The four species as procedural bodies.', tries: ['Line up the species', 'Skeleton and gait in the arena'], preview: <CreaturePreview /> },
  { id: 'habitat-study', name: 'Habitat Study', text: 'A window of the island, for comparing visual styles.', tries: ['Sculptural, Ink, Charcoal, Compose', 'Data, values and silhouette'], preview: <HabitatPreview /> },
]

const HISTORY = [
  { id: '0.1', date: 'Sep 2026', title: 'The chain', text: 'One small world sets up the idea: light → growth → shadow → habitat.' },
  { id: '0.2', date: 'Oct 2026', title: 'An ecology', text: 'The chain runs on its own: growth competes, plants spread, creatures wear paths.' },
  { id: '0.3', date: 'Nov 2026', title: 'An island', text: `A ${(LANDSCAPE.size / 1000).toFixed(1)} km island under a moving sun: the world on this site.`, current: true },
]

const REPO = 'https://github.com/ericatqx/procedural-world-building'
const REFERENCES = [
  { name: 'Shadow Ecology plan', to: `${REPO}/blob/main/docs/planning/shadow-ecology.md` },
  { name: 'Living Architecture experiments', to: `${REPO}/blob/main/docs/analysis/living-architecture-experiments.md` },
  { name: 'Studies and analysis', to: `${REPO}/tree/main/docs/analysis` },
  { name: 'Style guide', to: `${REPO}/blob/main/STYLE-GUIDE.md` },
]

function Arrow({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a className="pv-arrow-link" href={to} onClick={follow(to)}>
      {children}
    </a>
  )
}

function SectionHead({ n, title, intro }: { n: string; title: string; intro: string }) {
  return (
    <header className="pv-sec-head">
      <p className="pv-sec-n">{n}</p>
      <h2 className="pv-sec-title">{title}</h2>
      <p className="pv-sec-intro">{intro}</p>
    </header>
  )
}

/* ───────── The page ───────── */

/**
 * WHERE THE READER WAS. Kept as the page is read (the scroll, Formation's position, whether it was playing) and as it is left (where to): coming
 * back from a page opened from Project (a Lab, an exercise, a version), by its Back link or the browser's own back, the page returns to where it
 * was, with Formation held where it stood rather than replayed. Arriving any other way (from the navigation, Home or Explore) it opens fresh.
 */
const memory: { scroll: number; position: number; leftTo: string } = { scroll: 0, position: -1, leftTo: '' }
const returning = () => memory.position >= 0 && memory.leftTo.startsWith('/preview/open/')

const SPEEDS = [0.5, 1, 1.5, 2] as const

/**
 * PROJECT, in three sections, all about one island (the same world as Home and Explore, fixed behind the page):
 *   01 WORLD FORMATION builds it stage by stage;
 *   02 WORLD ANATOMY takes it apart, one system at a time, as a gallery of technical inspections drawn from its data (WorldAnatomy.tsx);
 *   03 PROCESS & EXPERIMENTS runs from the weekly exercises through the Labs to the versions.
 * A thin numbered rail at the left follows the reader.
 *
 * The world is fixed behind the page and is moved up with Formation as the page scrolls, so the section leaves as one; below it the page is
 * solid, and the world stops drawing once Formation is out of view.
 *
 * Formation's playback runs outside React: each frame moves the world (formation.ts) and the timeline's fill directly, and the page itself is
 * re-rendered only a few times a second, for the caption.
 */
export function ProjectPage({ worldReady, onFormationInView }: { worldReady: boolean; onFormationInView: (inView: boolean) => void }) {
  const scroller = useRef<HTMLElement>(null)
  const formation = useRef<HTMLElement>(null)
  const rail = useRef<HTMLElement>(null)
  const track = useRef<HTMLOListElement>(null)
  const scrub = useRef<HTMLInputElement>(null)
  const pos = useRef(0)
  // Whether this is a return from a page opened here, decided once as the page first renders (before any effect: in development React runs
  // the mount effects twice, and the first run's cleanup would otherwise record this page itself as where the reader left to).
  const back = useRef<{ scroll: number; position: number } | null>(returning() ? { scroll: memory.scroll, position: memory.position } : null)
  const speedRef = useRef<(typeof SPEEDS)[number]>(1)
  const shownAt = useRef({ at: 0, index: -1, step: '', done: false })
  const [shown, setShown] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1)
  const [active, setActive] = useState('formation')
  const [details, setDetails] = useState(false)
  const [asked, setAsked] = useState<{ system: SystemKey; at: number } | null>(null)
  const { index, t } = stageAt(shown)
  const stage = STAGES[index]!

  /** Puts the formation at a point: the world, the timeline's fill and handle at once; the caption when its text changes, or a few times a second. */
  const show = useCallback(
    (p: number, force = false) => {
      pos.current = p
      memory.position = p
      if (worldReady) applyFormation(p)
      const at = stageAt(p)
      const items = track.current?.children
      if (items)
        for (let i = 0; i < items.length; i += 1) {
          const li = items[i] as HTMLElement
          li.style.setProperty('--fill', `${i < at.index ? 100 : i === at.index ? (at.t * 100).toFixed(1) : 0}%`)
          li.dataset.state = i < at.index ? 'done' : i === at.index ? 'now' : 'next'
        }
      if (scrub.current && document.activeElement !== scrub.current) scrub.current.value = String(p)
      const now = performance.now()
      const step = STAGES[at.index]!.step(at.t)
      const last = shownAt.current
      const done = p >= COMPLETE
      if (force || at.index !== last.index || done !== last.done || (step !== last.step && now - last.at > 140)) {
        shownAt.current = { at: now, index: at.index, step, done }
        setShown(p)
      }
    },
    [worldReady],
  )

  // Formation takes the world (before any stage is applied) and gives it back as the page closes, as Anatomy does if it holds it then.
  useEffect(() => {
    enterFormation()
    holdFormation()
    return () => {
      memory.leftTo = window.location.pathname
      endFormation()
      leaveFormation()
    }
  }, [])
  // Once the island is there: played from the bare land, or (arriving at a later section, as back from a Lab) held on the complete island.
  useEffect(() => {
    if (!worldReady) return
    resetFormation()
    // Back from a page opened here: Formation where it stood, paused. Arriving at a later section: the complete island. Otherwise it plays.
    if (back.current) {
      show(back.current.position, true)
      setPlaying(false)
      return
    }
    const later = window.location.hash && window.location.hash !== '#formation'
    show(later ? COMPLETE : 0, true)
    setPlaying(!later)
  }, [worldReady, show])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      // Real time, so a slow frame rate does not slow the formation down (a long stall, such as a hidden tab, is cut short).
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      const p = pos.current
      // Each stage plays for its own length.
      const next = Math.min(END, p + (dt * speedRef.current) / STAGES[stageAt(p).index]!.seconds)
      show(next)
      if (next >= END) setPlaying(false)
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, show])

  // The world draws only while Formation is on screen; the rail follows the section in view; sections rise in; a #hash scrolls to its section.
  useEffect(() => {
    const root = scroller.current
    const stageEl = formation.current
    if (!root || !stageEl) return
    // (The navigation's band at the top does not count: Formation is out of sight once it has scrolled under it.)
    const seen = new IntersectionObserver((entries) => entries.forEach((e) => onFormationInView(e.isIntersecting)), { root, threshold: 0, rootMargin: '-80px 0px 0px 0px' })
    seen.observe(stageEl)
    // The world stays fixed behind the page (shared with Home and Explore) and is never moved by script: the solid page below Formation scrolls
    // up over it, in the browser's own scrolling. (Moving it to follow the scroll lagged a frame behind the page and staggered.) The section
    // offsets are read once, and again on resize.
    const world = document.querySelector<HTMLElement>('.pv-world')
    let tops: { id: string; top: number }[] = []
    const measure = () => {
      // (Measured against the scroller itself, not offsetTop: the sections sit inside a positioned body, which offsetTop would count from.)
      const base = root.getBoundingClientRect().top - root.scrollTop
      tops = SECTIONS.map((s) => ({ id: s.id, top: (root.querySelector<HTMLElement>(`#${s.id}`)?.getBoundingClientRect().top ?? base) - base }))
    }
    measure()
    let frame = 0
    let current = ''
    const follow = () => {
      frame = 0
      const top = root.scrollTop
      memory.scroll = top
      // Formation ends cleanly: the island fades into the page's black over the first three quarters of a screen of scrolling (an opacity on
      // the world's canvas, which no frame of lag can make jump), and the page below rises over black, not over the island.
      if (world) world.style.setProperty('--fm-fade', Math.max(0, 1 - top / (root.clientHeight * 0.75)).toFixed(3))
      rail.current?.style.setProperty('--progress', (top / Math.max(1, root.scrollHeight - root.clientHeight)).toFixed(3))
      const line = top + root.clientHeight * 0.4
      let at = SECTIONS[0]!.id
      for (const s of tops) if (s.top <= line) at = s.id
      if (at !== current) {
        current = at
        setActive(at)
      }
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(follow)
    }
    const onResize = () => {
      measure()
      onScroll()
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    const reveal = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('is-in')), { root, threshold: 0.06 })
    root.querySelectorAll('.pv-reveal').forEach((el) => reveal.observe(el))
    const target = window.location.hash && root.querySelector(window.location.hash)
    // Back from a page opened here: where the reader was (not the section's top). Otherwise the #hash's section.
    if (back.current) root.scrollTo({ top: back.current.scroll, behavior: 'instant' })
    else if (target) target.scrollIntoView()
    // (Sections that reveal change no layout, but fonts and figures may: measure again once they have settled.)
    const settle = window.setTimeout(onResize, 600)
    follow()
    return () => {
      seen.disconnect()
      reveal.disconnect()
      root.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      window.clearTimeout(settle)
      cancelAnimationFrame(frame)
      world?.style.removeProperty('--fm-fade')
      onFormationInView(true)
    }
  }, [onFormationInView])

  const goTo = (id: string) => {
    scroller.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth' })
    window.history.replaceState(null, '', `${window.location.pathname}#${id}`)
  }
  /** A stage chosen: its construction plays from its beginning. */
  const showStage = (i: number) => {
    show(i, true)
    setPlaying(true)
    goTo('formation')
  }
  const togglePlay = () => {
    if (playing) setPlaying(false)
    else {
      if (pos.current >= END - 0.01) {
        resetFormation()
        show(0, true)
      }
      setPlaying(true)
    }
  }
  const restart = () => {
    resetFormation()
    show(0, true)
    setPlaying(true)
  }
  const chooseSpeed = (s: (typeof SPEEDS)[number]) => {
    speedRef.current = s
    setSpeed(s)
  }
  /** A system named elsewhere on the page (an exercise): World Anatomy shows it. */
  const openSystem = (system: SystemKey) => {
    setAsked({ system, at: performance.now() })
    goTo('anatomy')
  }
  const complete = shown >= COMPLETE

  return (
    <main ref={scroller} className="pv-project">
      <nav ref={rail} className="pv-index" aria-label="Sections">
        <ol>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={active === s.id ? 'true' : undefined}
                onClick={(ev) => {
                  ev.preventDefault()
                  goTo(s.id)
                }}
              >
                <span className="pv-index-n">{s.n}</span>
                <span className="pv-index-label">{s.label}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* ───── 01 WORLD FORMATION ───── */}
      <section ref={formation} id="formation" className="pv-formation" aria-label="World formation">
        <div className="pv-fm-text">
          <header className="pv-fm-head">
            <p className="pv-kicker">
              <span>01</span>
              <span>World formation</span>
            </p>
            <h1 className="pv-fm-title">How the island is generated</h1>
          </header>

          <div className="pv-fm-caption" aria-live="polite">
            <p className="pv-fm-count">
              <span>{String(index + 1).padStart(2, '0')}</span> / {String(STAGES.length).padStart(2, '0')} · {stage.because}
            </p>
            <h2 className="pv-fm-stage" key={stage.key}>
              {stage.title}
            </h2>
            <p className="pv-fm-step">{stage.step(t)}</p>
            <p className="pv-fm-text-body">{stage.text}</p>
            <button type="button" className="pv-fm-more" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
              {details ? 'Hide how it works' : 'How it works'}
              <span aria-hidden>{details ? '−' : '+'}</span>
            </button>
            {details ? (
              <div className="pv-fm-details" key={stage.key}>
                <dl className="pv-fm-io">
                  {(
                    [
                      ['Reads', stage.inputs],
                      ['Rules', stage.rules],
                      ['Gives', stage.outputs],
                    ] as const
                  ).map(([label, items]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>
                        <ul>
                          {items.map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="pv-inspect-links">
                  {stage.lens ? <Arrow to={lensIn(stage.lens)}>Explore lens →</Arrow> : null}
                  {stage.lab ? <Arrow to={open(stage.lab)}>Open Lab →</Arrow> : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="pv-transport">
          <div className="pv-transport-buttons">
            <button type="button" className="pv-play" aria-label="Restart" title="Restart" disabled={!worldReady} onClick={restart}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path d="M2.2 6 A3.8 3.8 0 1 0 3.4 3.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
                <path d="M1.4 1.4 L3.8 3.4 L1.2 4.6 Z" fill="currentColor" />
              </svg>
            </button>
            <button type="button" className="pv-play is-main" aria-label={playing ? 'Pause' : 'Play'} disabled={!worldReady} onClick={togglePlay}>
              {playing ? (
                <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
                  <rect x="2.5" y="1.5" width="2.4" height="9" fill="currentColor" />
                  <rect x="7.1" y="1.5" width="2.4" height="9" fill="currentColor" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
                  <path d="M3 1.5 L10.5 6 L3 10.5 Z" fill="currentColor" />
                </svg>
              )}
            </button>
            <div className="pv-speeds" role="group" aria-label="Playback speed">
              {SPEEDS.map((s) => (
                <button key={s} type="button" aria-pressed={speed === s} onClick={() => chooseSpeed(s)}>
                  {s}×
                </button>
              ))}
            </div>
          </div>
          <div className="pv-track">
            <ol ref={track} className="pv-track-stages">
              {STAGES.map((s, i) => (
                <li key={s.key}>
                  <button type="button" disabled={!worldReady} onClick={() => showStage(i)}>
                    <span>{String(i + 1).padStart(2, '0')}</span>
                    {s.title}
                  </button>
                  <i aria-hidden />
                </li>
              ))}
            </ol>
            <input
              ref={scrub}
              className="pv-track-scrub"
              type="range"
              aria-label="Formation timeline"
              min={0}
              max={END}
              step={0.001}
              defaultValue={0}
              disabled={!worldReady}
              onChange={(event) => {
                setPlaying(false)
                show(Number(event.target.value), true)
              }}
            />
          </div>
          <a className="pv-fm-explore" data-on={complete} tabIndex={complete ? 0 : -1} aria-hidden={!complete} href={href({ page: 'explore' })} onClick={follow(href({ page: 'explore' }))}>
            Explore the island <span aria-hidden>→</span>
          </a>
        </div>

        {worldReady ? null : <p className="pv-formation-wait">Growing the island…</p>}
      </section>

      <div className="pv-project-body">
        {/* ───── 02 WORLD ANATOMY ───── */}
        <section id="anatomy" className="pv-sec pv-anatomy pv-reveal">
          <WorldAnatomy asked={asked} />
        </section>

        {/* ───── 03 PROCESS & EXPERIMENTS ───── */}
        <section id="process" className="pv-sec pv-reveal">
          <SectionHead n="03" title="Process & experiments" intro="How the island was made: a technique learned each week, each part of the world then worked out on its own stage in a Lab, and three versions, each built on the last." />

          <div className="pv-sub" id="exercises">
            <h3 className="pv-sub-title">
              <span>A</span>Weekly exercises
            </h3>
            <p className="pv-sub-note">Weeks 02–08: the technique each week taught, and the systems of the island it went into.</p>
            <ol className="pv-weekline">
              {EXERCISES.map((w) => (
                <li key={w.id}>
                  <span className="pv-wk-n">{w.n}</span>
                  <ExerciseMark week={w.id} />
                  <a className="pv-wk-body" href={open(w.id)} onClick={follow(open(w.id))}>
                    <span className="pv-wk-name">
                      {w.name} <em aria-hidden>→</em>
                    </span>
                    <span className="pv-wk-technique">{w.technique}</span>
                  </a>
                  <span className="pv-wk-led">
                    {w.systems.map((k) => (
                      <button key={k} type="button" onClick={() => openSystem(k)} title={`${SYSTEM_NAME[k]} in World Anatomy`}>
                        {SYSTEM_NAME[k]}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="pv-sub" id="labs">
            <h3 className="pv-sub-title">
              <span>B</span>Labs
            </h3>
            <p className="pv-sub-note">One part of the world at a time, on its own stage, with its parameters in reach.</p>
            <ul className="pv-lab-cards">
              {LABS.map((lab) => (
                <li key={lab.id}>
                  <a href={open(lab.id)} onClick={follow(open(lab.id))}>
                    <div className="pv-lab-preview">{lab.preview}</div>
                    <span className="pv-lab-name">{lab.name}</span>
                    <span className="pv-lab-text">{lab.text}</span>
                    <ul className="pv-lab-tries">
                      {lab.tries.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                    <span className="pv-lab-go">Open the Lab <span aria-hidden>→</span></span>
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="pv-sub" id="archive">
            <h3 className="pv-sub-title">
              <span>C</span>Versions
            </h3>
            <p className="pv-sub-note">Each version as it was, opened on its own page. 0.3 is the island on this site; its original page keeps the full instrument panel.</p>
            <ol className="pv-versions">
              {HISTORY.map((h) => (
                <li key={h.id} data-current={'current' in h}>
                  <span className="pv-version-n">{h.id}</span>
                  <span className="pv-version-date">{h.date}</span>
                  <span className="pv-version-body">
                    <strong>{h.title}</strong> {h.text}
                  </span>
                  <span className="pv-version-links">
                    <Arrow to={open(h.id)}>{h.id === '0.3' ? 'Original page →' : 'Open →'}</Arrow>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="pv-sub pv-notes-src">
            <h3 className="pv-sub-title">
              <span>D</span>Notes &amp; source
            </h3>
            <ul className="pv-refs">
              {REFERENCES.map((r) => (
                <li key={r.name}>
                  <a href={r.to} target="_blank" rel="noreferrer">
                    {r.name} <span aria-hidden>↗</span>
                  </a>
                </li>
              ))}
              <li>
                <a href="/">
                  The classic site <span aria-hidden>↗</span>
                </a>
              </li>
            </ul>
          </div>
        </section>

        <footer className="pv-project-foot">
          <span className="pv-wordmark-name">Shadow Ecology</span>
          <span>Procedural World Building</span>
        </footer>
      </div>
    </main>
  )
}
