import { useEffect, useRef } from 'react'
import { observe, type Population } from './livingEcology.ts'
import { anchor, lookCloser, select, selectionStamp, useLiving, type Selection } from './livingSelection.ts'
import { worldYears } from './livingTime.ts'
import { useOrganismSize } from './organismSize.ts'
import { useExperience } from './experience.ts'
import type { ViewMode } from './LandscapeView.tsx'

/**
 * The observation card for the selected organism (or the root connection between two): who it is, how old, what is
 * happening to it, and what around it explains that, in plain words read from the simulation's state now.
 *
 * In Overview and Approach it stands beside the organism (a small ring and a leader mark which one), kept inside the view
 * and clear of the panel and the page's heading; in Explore it keeps one place, low on the right, out of the walker's way.
 * Close it with ×; "Look closer" turns Approach to the organism.
 */
export function OrganismPanel({ year, hours, mode, onApproach }: { year: number; hours: number; mode: ViewMode; onApproach: () => void }) {
  const { population, selection } = useLiving()
  const card = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const leader = useRef<SVGLineElement>(null)
  useEffect(() => {
    if (!selection) return
    let frame = 0
    // The card stands beside its organism's anchor (a fixed point of the organism: see AnchorTracker). Nothing it does is a jump: the anchor
    // and the card both ease toward where they should be; while the anchor is out of view or briefly unavailable the card holds where it was,
    // and only if that lasts does it ease away to its resting place, low on the right, and ease back when the anchor returns.
    const state = { sx: 0, sy: 0, x: NaN, y: NaN, known: false, lost: 0, last: performance.now() }
    const place = () => {
      frame = requestAnimationFrame(place)
      const el = card.current
      const wrap = el?.offsetParent as HTMLElement | null
      if (!el || !wrap) return
      const now = performance.now()
      const k = 1 - Math.exp(-Math.min(0.1, (now - state.last) / 1000) * 9)
      state.last = now
      const box = wrap.getBoundingClientRect()
      const panel = [...document.querySelectorAll('[data-annotation-anchor]')].map((el) => el.getBoundingClientRect()).find((r) => r.width > 0)
      let right = (panel && panel.left > box.left + 200 ? Math.min(box.right, panel.left) : box.right) - box.left - 14
      // The guide's card (upper left while the guide is open) is kept clear: the card stays to its right.
      const guide = document.querySelector('.learn-card.guide03')?.getBoundingClientRect()
      const left = guide && guide.right < box.left + box.width / 2 ? guide.right - box.left + 14 : 14
      if (guide && guide.left > box.left + 200) right = Math.min(right, guide.left - box.left - 14)
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (anchor.visible) {
        if (!state.known) {
          state.sx = anchor.x
          state.sy = anchor.y
        } else {
          state.sx += (anchor.x - state.sx) * k
          state.sy += (anchor.y - state.sy) * k
        }
        state.known = true
        state.lost = 0
      } else if (!state.lost) state.lost = now
      const resting = !state.known || (state.lost > 0 && now - state.lost > 1500)
      let tx: number
      let ty: number
      if (resting) {
        const hint = wrap.querySelector('.eco-steer-hint')?.getBoundingClientRect()
        tx = right - w
        ty = (hint ? hint.top - box.top - 10 : box.height - 18) - h
      } else {
        tx = state.sx + 26
        if (tx + w > right) tx = state.sx - 26 - w
        if (tx < left) tx = state.sx + 26
        tx = Math.max(left, Math.min(right - w, tx))
        // The page's heading and notes sit at the top left: below them there, anywhere else up to the top.
        const top = tx < 440 ? 136 : 14
        ty = Math.max(top, Math.min(box.height - h - 14, state.sy - h * 0.3))
      }
      if (Number.isNaN(state.x)) {
        state.x = tx
        state.y = ty
      } else {
        state.x += (tx - state.x) * k
        state.y += (ty - state.y) * k
      }
      el.style.transform = `translate(${state.x.toFixed(1)}px, ${state.y.toFixed(1)}px)`
      // (Hidden until this first placement, so a new card never shows at the corner before it reaches its place.)
      el.style.visibility = 'visible'
      const r = ring.current
      const l = leader.current
      const tied = !resting
      if (r) r.style.display = tied ? 'block' : 'none'
      if (r && tied) r.style.transform = `translate(${(state.sx - 7).toFixed(1)}px, ${(state.sy - 7).toFixed(1)}px)`
      if (l) {
        l.style.display = tied ? 'inline' : 'none'
        if (tied) {
          const ex = state.sx < state.x ? state.x : state.x + w
          const ey = Math.max(state.y + 10, Math.min(state.y + h - 10, state.sy))
          l.setAttribute('x1', state.sx.toFixed(1))
          l.setAttribute('y1', state.sy.toFixed(1))
          l.setAttribute('x2', ex.toFixed(1))
          l.setAttribute('y2', ey.toFixed(1))
        }
      }
    }
    frame = requestAnimationFrame(place)
    return () => cancelAnimationFrame(frame)
  }, [selection, mode])
  // A click that is not a drag, anywhere outside the card, puts it away: on the page, the panel, the world or empty ground. A click
  // that picked an organism or connection has already set the selection by the time this hears the release (the picker listens
  // first), so it is left alone, and a drag (the camera) never counts.
  useEffect(() => {
    if (!selection) return
    let down: { x: number; y: number; stamp: number; inside: boolean } | null = null
    const press = (event: PointerEvent) => {
      if (event.button !== 0) return
      const target = event.target as Node | null
      down = { x: event.clientX, y: event.clientY, stamp: selectionStamp(), inside: !!(target && card.current?.contains(target)) }
    }
    const release = (event: PointerEvent) => {
      const start = down
      down = null
      if (!start || start.inside || event.button !== 0) return
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return
      if (selectionStamp() !== start.stamp) return
      select(null)
    }
    window.addEventListener('pointerdown', press, true)
    window.addEventListener('pointerup', release)
    return () => {
      window.removeEventListener('pointerdown', press, true)
      window.removeEventListener('pointerup', release)
    }
  }, [selection])
  // Round 08I: the original card belongs to Explore World only (How It's Made inspects structures with Inspect's card).
  const experience = useExperience()
  const shown = experience === 'explore' ? selection : null
  if (!population || !shown) return null
  const time = worldYears(year, hours)
  return (
    <>
      <svg className="organism-leader" aria-hidden="true" key={`l${JSON.stringify(shown)}`}>
        <line ref={leader} />
      </svg>
      <div ref={ring} key={`r${JSON.stringify(shown)}`} className="organism-ring" aria-hidden="true" />
      {/* Keyed by what it shows (with its ring and leader): every new selection mounts afresh and takes the one fade-in (Round 08I). */}
      <div key={JSON.stringify(shown)} ref={card} className="organism-card" role="dialog" aria-label="Living architecture" style={{ visibility: 'hidden' }}>
        {shown.kind === 'organism' ? <OrganismBody population={population} index={shown.index} time={time} /> : <LinkBody population={population} selection={shown} time={time} />}
        <div className="organism-card-actions">
          <button
            type="button"
            className="text-button"
            onClick={() => {
              lookCloser()
              onApproach()
            }}
          >
            Look closer
          </button>
          <button type="button" className="text-button organism-card-close" aria-label="Close" onClick={() => select(null)}>
            ×
          </button>
        </div>
      </div>
    </>
  )
}

function OrganismBody({ population, index, time }: { population: Population; index: number; time: number }) {
  const o = population.organisms[index]!
  const seen = observe(population, index, time)
  const size = useOrganismSize(index)
  return (
    <>
      <div className="organism-card-head">
        <span className="organism-card-title">{o.id}</span>
        <span className="organism-card-stage">{seen.stage}</span>
      </div>
      <p className="organism-card-meta">
        {seen.age}
        <br />
        {seen.origin}
        {size ? (
          <>
            <br />
            {`Now about ${Math.round(size.length)} m long × ${Math.round(size.width)} m wide × ${Math.round(size.height)} m tall`}
          </>
        ) : null}
      </p>
      <p className="organism-card-now">{seen.happening}</p>
      {seen.notes.length ? (
        <ul className="organism-card-notes">
          {seen.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

function LinkBody({ population, selection, time }: { population: Population; selection: Exclude<Selection, null>; time: number }) {
  const l = population.links[selection.index]!
  const a = population.organisms[l.a]!
  const b = population.organisms[l.b]!
  const grown = Math.min(1, Math.max(0, (time - l.since) / 18))
  return (
    <>
      <div className="organism-card-head">
        <span className="organism-card-title">Root connection</span>
        <span className="organism-card-stage">{grown < 1 ? 'Growing' : 'Established'}</span>
      </div>
      <p className="organism-card-meta">
        Between {a.id} and {b.id} · since year {l.since}
      </p>
      <p className="organism-card-now">
        {grown < 1 ? 'A runner is growing from each toward the other along the ground.' : 'The two are joined underground.'} Through it they share water and soil: the
        better-fed one supports the other.
      </p>
    </>
  )
}
