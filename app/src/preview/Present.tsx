import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { go, href } from './route.ts'

/**
 * PRESENTER NOTES. /present is an opening screen with one action, Start, which turns Presentation Mode on and opens Home. From then on a small
 * notes panel sits over the live site: the section's words to say, a short reminder of what to do, Previous / Next through the notes, and a "Go to"
 * link to the section's page. Changing notes never moves the site; only "Go to" (and Start) navigates. The panel folds to a small tab, can be dragged
 * by its top edge, and Exit turns Presentation Mode off. The note, the fold and the position are kept in this tab's session, so they follow the
 * presenter across pages. Outside Presentation Mode nothing of this renders, and nothing here moves the camera or the simulation.
 */
type Stop = { title: string; say: string; tip?: string; to: string; anchor?: string; place: string }

const STOPS: Stop[] = [
  {
    title: 'Home / Opening',
    say: "So, this is Shadow Ecology. Since my last check-in, I've mainly been working on the website structure and the visuals of the island. I now have three main pages: Home, Project, and Explore. I'll start with how the world is generated.",
    tip: 'Let the island drift on Home; then open Project.',
    to: href({ page: 'home' }),
    place: 'Home',
  },
  {
    title: 'World Formation',
    say: "Here is a replay of how the island is generated, starting with terrain and water, then sunlight and shadows, living architecture, vegetation, and finally creatures. These different systems come together to form the island.",
    tip: 'Press play on Formation, or click a stage in the stage bar.',
    to: href({ page: 'project' }),
    anchor: 'formation',
    place: 'Formation',
  },
  {
    title: 'World Anatomy',
    say: "I'm also working on this World Anatomy section. Basically, I want users to understand why things are the way they are. Like, why does the architecture take this form? Why does vegetation grow in some areas but not others? I've also included my weekly exercises and labs below as an archive of my process.",
    tip: 'Click the Living Architecture or Vegetation tab; then scroll down to the Labs.',
    to: href({ page: 'project' }),
    anchor: 'anatomy',
    place: 'Anatomy',
  },
  {
    title: 'Explore / Introduction',
    say: "For Explore, I wanted the experience to be less intrusive, with less information shown unless users want to know more. They can start with a guided exploration, go on a field expedition, or just explore freely.",
    tip: 'Point to the three choices on the arrival card.',
    to: href({ page: 'explore' }),
    place: 'Explore',
  },
  {
    title: 'Field Expedition / Camera',
    say: "For example, I can choose to look more closely at a structure's shadow. One thing I'm exploring is how users can interact with the world. They can take a photo, adjust the framing or filter, and save it to Field Notes as a little memory of what they've explored.",
    tip: 'Field expedition → “A structure’s shadow” → Document it → shutter → Field notes.',
    to: href({ page: 'explore' }),
    place: 'Explore',
  },
  {
    title: 'Free Exploration',
    say: "Users can also explore freely. They can zoom in and out, approach a location, or walk around the island with a small map for navigation. I'm still working on making the visual differences between sunlit and shaded areas more distinct.",
    tip: 'End the expedition; scroll to zoom, try Approach, then Walk.',
    to: href({ page: 'explore' }),
    place: 'Explore',
  },
  {
    title: 'Lenses / Closing',
    say: "I've also added Lenses to show the environmental data behind what users are seeing, like plant cover and habitat zones. Overall, I've been focusing on making the world more coherent, both visually and in how users experience it. My next step is to make the ecological differences more visible in the world itself.",
    tip: 'Lenses → Plant cover, then Habitat zones.',
    to: href({ page: 'explore' }),
    place: 'Explore',
  },
]

// ── Presentation Mode's state: which note (null: off), whether the panel is folded, and where it has been moved to. Kept in this tab's session. ──
const KEY = 'pv-present-stop'
const FOLD = 'pv-present-folded'
const POS = 'pv-present-pos'
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
    // (storage blocked: Presentation Mode lasts until the page reloads)
  }
}
const savedPos = (): { x: number; y: number } | null => {
  try {
    const p = JSON.parse(read(POS) ?? 'null') as { x: number; y: number } | null
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null
  } catch {
    return null
  }
}
type State = { at: number | null; folded: boolean; pos: { x: number; y: number } | null }
let state: State = { at: read(KEY) === null ? null : Math.max(0, Math.min(STOPS.length - 1, Number(read(KEY)) || 0)), folded: read(FOLD) === '1', pos: savedPos() }
const listeners = new Set<() => void>()
const set = (next: Partial<State>) => {
  state = { ...state, ...next }
  write(KEY, state.at === null ? null : String(state.at))
  write(FOLD, state.folded ? '1' : null)
  write(POS, state.pos ? JSON.stringify(state.pos) : null)
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

/** Takes the site to a note's page, and its section there: only when asked (Start, or a note's "Go to"). */
function goTo(i: number) {
  const stop = STOPS[i]!
  go(stop.to)
  if (!stop.anchor) return
  let tries = 0
  const scroll = () => {
    const el = document.getElementById(stop.anchor!)
    if (el) el.scrollIntoView({ block: 'start' })
    else if (tries++ < 40) window.setTimeout(scroll, 100)
  }
  window.setTimeout(scroll, 60)
}

/** /present: the opening screen. */
export function PresentPage() {
  return (
    <main className="pv-present">
      <section className="pv-present-intro">
        <p className="pv-present-kicker">Presentation mode</p>
        <h1>Shadow Ecology</h1>
        <p className="pv-present-lede">A procedurally generated island where light and lasting shade decide what grows, lives and survives.</p>
        <button
          type="button"
          className="pv-present-start"
          onClick={() => {
            set({ at: 0, folded: false })
            goTo(0)
          }}
        >
          Start presentation →
        </button>
        <p className="pv-present-note">
          Presenter notes stay with you on every page in a small panel you can drag and fold away. Turning to the next note never changes the page; each
          note offers its page when you want it. Exit turns the notes off.
        </p>
      </section>
    </main>
  )
}

/**
 * WHERE THE NOTES SIT (round 23): one preset per context, read from the page as it actually is (measured at 1440 × 900): Home's text keeps to the
 * left, so bottom right; Formation's text column ends well above its stage bar, so under that column, beside the replay; the rest of Project (Anatomy
 * fills the width) the bottom-right corner; Explore keeps its caption and cards bottom left, its drawers bottom right and its rail low, so top right,
 * or top left while the Walk / Approach map holds the top right; with the Camera open, a narrow strip right of its frame; with Field Notes open, a
 * narrow strip beside it. `avoid`: what a manually placed panel must not cover there, or it goes back to the preset.
 */
type Spot = { key: string; style: CSSProperties; avoid: string[] }
const NAV = 76
function spotFor(page: string): Spot {
  const q = (sel: string) => {
    const e = document.querySelector(sel)
    const r = e?.getBoundingClientRect()
    return r && r.width > 0 && r.height > 0 ? r : null
  }
  const H = window.innerHeight
  if (page === 'explore') {
    if (q('.pv-photo-plate')) return { key: 'camera', style: { right: 8, top: 96, width: 210, maxHeight: H - 96 - 160 }, avoid: ['.pv-photo-plate', '.pv-photo-bar'] }
    if (q('.pv-notes')) return { key: 'notes', style: { right: 16, top: NAV, width: 220, maxHeight: H - NAV - 100 }, avoid: ['.pv-notes'] }
    const map = q('.explore-map')
    if (map) {
      const exp = q('.pv-expedition')
      return exp
        ? { key: 'map+exp', style: { right: 40, top: map.bottom + 12, maxHeight: H - map.bottom - 120 }, avoid: ['.explore-map', '.pv-expedition', '.pv-drawer'] }
        : { key: 'map', style: { left: 40, top: NAV, maxHeight: H - NAV - 200 }, avoid: ['.explore-map', '.pv-caption', '.pv-card'] }
    }
    return { key: q('.pv-expedition') ? 'explore+exp' : 'explore', style: { right: 40, top: NAV, maxHeight: Math.max(160, (q('.pv-drawer')?.top ?? H - 100) - NAV - 12) }, avoid: ['.pv-drawer', '.pv-expedition', '.pv-caption', '.pv-card', '.pv-rail'] }
  }
  if (page === 'project') {
    const text = q('.pv-fm-text')
    const track = q('.pv-track-stages')
    if (text && track && text.top > -40 && text.bottom < H * 0.75) {
      const top = text.bottom + 24
      const room = track.top - top - 16
      if (room > 170) return { key: 'formation', style: { left: text.left, top, width: Math.min(320, Math.max(260, text.width)), maxHeight: room }, avoid: ['.pv-fm-text', '.pv-track-stages'] }
    }
    return { key: 'project', style: { right: 16, bottom: 16, maxHeight: H - NAV - 16 }, avoid: [] }
  }
  if (page === 'home') return { key: 'home', style: { right: 24, bottom: 24, maxHeight: H - NAV - 24 }, avoid: ['.pv-column-title', '.pv-column-lede'] }
  return { key: page, style: { right: 16, top: NAV, maxHeight: H - NAV - 16 }, avoid: [] }
}
const overlaps = (a: DOMRect, sel: string) => {
  const b = document.querySelector(sel)?.getBoundingClientRect()
  return !!b && b.width > 0 && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/** The presenter's notes over the live site (nothing at all unless Presentation Mode is on). `page` places it by default clear of that page's controls. */
export function PresentationCue({ page }: { page: string }) {
  const { at, folded, pos } = usePresentation()
  const panel = useRef<HTMLElement>(null)
  const dragging = useRef(false)
  const [spot, setSpot] = useState<Spot>(() => spotFor(page))
  // The context is checked twice a second; the panel moves only when it has changed (a page, a section in view, an overlay opened or closed), never
  // during a drag. A manual place that would now cover what this context needs clear is given up for the preset.
  useEffect(() => {
    if (at === null) return
    const check = () => {
      if (dragging.current) return
      const next = spotFor(page)
      setSpot((was) => {
        if (was.key === next.key) return was
        const r = panel.current?.getBoundingClientRect()
        if (state.pos && r && next.avoid.some((sel) => overlaps(r, sel))) set({ pos: null })
        return next
      })
    }
    check()
    const id = window.setInterval(check, 500)
    return () => window.clearInterval(id)
  }, [page, at])
  // (Presenting is marked on the document, for the one overlay that makes room: Field Notes.)
  useEffect(() => {
    if (at === null) return
    document.documentElement.dataset.presenting = ''
    return () => {
      delete document.documentElement.dataset.presenting
    }
  }, [at])
  // (On a smaller window a moved panel is brought back inside it.)
  useEffect(() => {
    const fit = () => {
      if (state.pos) set({ pos: { x: Math.min(state.pos.x, window.innerWidth - 120), y: Math.min(state.pos.y, window.innerHeight - 40) } })
    }
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])
  if (at === null) return null
  const stop = STOPS[at]!
  const n = `${at + 1} / ${STOPS.length}`
  const style: CSSProperties = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto', maxHeight: window.innerHeight - pos.y - 8, width: spot.style.width } : spot.style
  // Moved by dragging its top edge; where it is put is kept for the rest of the presentation, always on screen.
  const drag = (e: ReactPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button') || e.button !== 0) return
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    const dx = e.clientX - box.left
    const dy = e.clientY - box.top
    dragging.current = true
    const move = (ev: PointerEvent) => {
      set({ pos: { x: Math.max(4, Math.min(window.innerWidth - box.width - 4, ev.clientX - dx)), y: Math.max(4, Math.min(window.innerHeight - 36, ev.clientY - dy)) } })
    }
    const up = () => {
      dragging.current = false
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  if (folded)
    return (
      <div className="pv-notes-panel is-folded" data-page={page} style={style} ref={panel as React.RefObject<HTMLDivElement>}>
        <header className="pv-notes-bar" onPointerDown={drag} title="Drag to move">
          <button type="button" onClick={() => set({ folded: false })} aria-label="Open the notes">
            Notes · {n}
          </button>
        </header>
      </div>
    )
  return (
    <aside className="pv-notes-panel" data-page={page} data-spot={spot.key} style={style} ref={panel} aria-label="Presenter notes">
      <header className="pv-notes-bar" onPointerDown={drag} title="Drag to move">
        <span>
          {n} · {stop.title}
        </span>
        <span className="pv-notes-tools">
          <button type="button" onClick={() => set({ folded: true })} aria-label="Fold the notes">
            –
          </button>
          <button type="button" onClick={() => set({ at: null, folded: false })} aria-label="Exit Presentation Mode">
            Exit
          </button>
        </span>
      </header>
      <p className="pv-notes-say">{stop.say}</p>
      {stop.tip ? <p className="pv-notes-tip">{stop.tip}</p> : null}
      <footer className="pv-notes-nav">
        <button type="button" disabled={at === 0} onClick={() => set({ at: at - 1 })}>
          ← Prev
        </button>
        <button type="button" className="pv-notes-go" onClick={() => goTo(at)}>
          Go to {stop.place}
        </button>
        <button type="button" disabled={at === STOPS.length - 1} onClick={() => set({ at: at + 1 })}>
          Next →
        </button>
      </footer>
    </aside>
  )
}
