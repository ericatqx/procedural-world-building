import { useEffect, useSyncExternalStore } from 'react'
import { go, href } from './route.ts'

/**
 * LIVE PRESENTATION MODE. /present is an opening screen with one action, Start. From then on the presentation lives on the real site: a
 * small cue panel over each page (its stop, one idea, a line of narration for the room, what to show), with Previous / Next that take the site to
 * the stop's page or section, a collapse to a small marker, and Exit. The stop and the collapse are kept in this tab's session, so they follow the
 * presenter across pages and Labs. Outside Presentation Mode nothing of this renders and no navigation is touched; inside it, nothing moves the
 * camera or the simulation beyond each page's own normal entry.
 */
type Stop = { title: string; idea: string; say: string; show: string; to: string; anchor?: string }

const STOPS: Stop[] = [
  {
    title: 'The idea',
    idea: 'A living island, shaped by light and lasting shade.',
    say: 'Every landform, plant, creature and structure here grows from one seed. Where sunlight falls and where shade persists decides what can grow and survive.',
    show: 'Let the island drift; point to sunlit slopes against shaded valleys.',
    to: href({ page: 'home' }),
  },
  {
    title: 'Building the world',
    idea: 'Six systems, each setting the conditions for the next.',
    say: 'Terrain shapes the water; terrain and sun decide where shade lasts. Structures grow toward the light, plants settle by habitat, and creatures live by all of it.',
    show: 'Play Formation, or scrub the stage bar.',
    to: href({ page: 'project' }),
    anchor: 'formation',
  },
  {
    title: 'The rules underneath',
    idea: 'Every visible feature comes from a rule you can inspect.',
    say: 'Each exhibit shows what goes in, the rule that acts on it, and what comes out on the island.',
    show: 'Terrain: press “Build it up”. Then Living Architecture.',
    to: href({ page: 'project' }),
    anchor: 'anatomy',
  },
  {
    title: 'From form to behaviour',
    idea: 'Procedural generation reaches living agents.',
    say: 'A creature’s body is grown from parameters on a rig of bones. Its behaviour reads light, hunger and shelter: the Hollow Dweller keeps to deep shade by day.',
    show: 'Change a body-plan slider, then open Behaviour.',
    to: href({ page: 'open', id: 'creature-lab' }),
  },
  {
    title: 'Experiencing the world',
    idea: 'A world to investigate, not only to watch.',
    say: 'Time moves the shadows and the communities beneath them. The Field Expedition, still taking shape, lets a lone observer document what they find.',
    show: 'Move the time slider, open Vegetation, then start the Field Expedition and take one photograph.',
    to: href({ page: 'explore' }),
  },
  {
    title: 'Reflection and next steps',
    idea: 'From separate exercises to one connected, explorable ecosystem.',
    say: 'Feedback pushed the world to be more coherent and readable, through new work on vegetation, creature form, perception and behaviour. Ecological differentiation, behaviour and the observer’s story are still being refined.',
    show: 'Take questions, or exit the presentation.',
    to: href({ page: 'explore' }),
  },
]

// ── The presentation's state: which stop (null: not presenting), and whether the cue is folded away. Kept in this tab's session. ──
const KEY = 'pv-present-stop'
const FOLD = 'pv-present-folded'
const read = (k: string) => {
  try {
    return window.sessionStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k: string, v: string | null) => {
  try {
    if (v === null) window.sessionStorage.removeItem(k)
    else window.sessionStorage.setItem(k, v)
  } catch {
    // (storage blocked: the presentation lasts until the page reloads)
  }
}
let state: { at: number | null; folded: boolean } = { at: read(KEY) === null ? null : Math.max(0, Math.min(STOPS.length - 1, Number(read(KEY)) || 0)), folded: read(FOLD) === '1' }
const listeners = new Set<() => void>()
const set = (next: Partial<typeof state>) => {
  state = { ...state, ...next }
  write(KEY, state.at === null ? null : String(state.at))
  write(FOLD, state.folded ? '1' : null)
  listeners.forEach((l) => l())
}
const usePresentation = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )

/** Takes the site to a stop: its page, and its section on that page once it is there. */
function visit(i: number) {
  const stop = STOPS[i]!
  set({ at: i, folded: false })
  go(stop.to)
  if (!stop.anchor) return
  let tries = 0
  const scroll = () => {
    const el = document.getElementById(stop.anchor!)
    if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' })
    else if (tries++ < 40) window.setTimeout(scroll, 100)
  }
  window.setTimeout(scroll, 60)
}

/** /present: the opening screen. */
export function PresentPage() {
  return (
    <main className="pv-present">
      <section className="pv-present-intro">
        <p className="pv-present-kicker">A live presentation</p>
        <h1>Shadow Ecology</h1>
        <p className="pv-present-lede">A procedurally generated island where light and lasting shade decide what grows, lives and survives. Six stops through the living world itself.</p>
        <button type="button" className="pv-present-start" onClick={() => visit(0)}>
          Start presentation →
        </button>
        <p className="pv-present-note">The cues stay with you on every page; fold them away at any time, and exit to return the site to normal.</p>
      </section>
    </main>
  )
}

/** The cue over the live site while presenting (nothing at all otherwise). `page`: the page shown, for placing it clear of that page's own controls. */
export function PresentationCue({ page }: { page: string }) {
  const { at, folded } = usePresentation()
  // (The arrow keys step the presentation only while it is on, and never while typing.)
  useEffect(() => {
    if (at === null) return
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'PageDown' || (e.key === 'ArrowRight' && e.altKey)) visit(Math.min(STOPS.length - 1, at + 1))
      if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && e.altKey)) visit(Math.max(0, at - 1))
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [at])
  if (at === null) return null
  const stop = STOPS[at]!
  const n = (i: number) => String(i + 1).padStart(2, '0')
  if (folded)
    return (
      <button type="button" className="pv-cue-folded" data-page={page} onClick={() => set({ folded: false })} aria-label="Show the presentation cue">
        <b>{n(at)}</b> / {n(STOPS.length - 1)} · {stop.title}
      </button>
    )
  return (
    <aside className="pv-cue" data-page={page} aria-label="Presentation">
      <header className="pv-cue-head">
        <span>
          <b>{n(at)}</b> / {n(STOPS.length - 1)} · {stop.title}
        </span>
        <span className="pv-cue-tools">
          <button type="button" onClick={() => set({ folded: true })} aria-label="Fold the cue away">
            –
          </button>
          <button type="button" onClick={() => set({ at: null, folded: false })} aria-label="Exit the presentation">
            Exit
          </button>
        </span>
      </header>
      <p className="pv-cue-idea">{stop.idea}</p>
      <p className="pv-cue-say">{stop.say}</p>
      <p className="pv-cue-show">
        <span>Show</span>
        {stop.show}
      </p>
      <footer className="pv-cue-nav">
        <button type="button" disabled={at === 0} onClick={() => visit(at - 1)}>
          ← {at > 0 ? STOPS[at - 1]!.title : ''}
        </button>
        <span className="pv-cue-dots" aria-hidden>
          {STOPS.map((_, i) => (
            <i key={i} data-on={i === at || undefined} data-done={i < at || undefined} />
          ))}
        </span>
        <button type="button" disabled={at === STOPS.length - 1} onClick={() => visit(at + 1)}>
          {at < STOPS.length - 1 ? STOPS[at + 1]!.title : ''} →
        </button>
      </footer>
    </aside>
  )
}
