import { useEffect, useRef } from 'react'
import { observe, type Population } from './livingEcology.ts'
import { anchor, lookCloser, select, useLiving, type Selection } from './livingSelection.ts'
import { worldYears } from './livingTime.ts'
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
    const place = () => {
      frame = requestAnimationFrame(place)
      const el = card.current
      const wrap = el?.offsetParent as HTMLElement | null
      if (!el || !wrap) return
      const box = wrap.getBoundingClientRect()
      const panel = document.querySelector('[data-annotation-anchor]')?.getBoundingClientRect()
      const right = (panel && panel.left > box.left + 200 ? Math.min(box.right, panel.left) : box.right) - box.left - 14
      const w = el.offsetWidth
      const h = el.offsetHeight
      const pinned = mode === 'explore' || !anchor.visible
      let x: number
      let y: number
      if (pinned) {
        // Low on the right, above the walking instructions along the bottom.
        const hint = wrap.querySelector('.eco-steer-hint')?.getBoundingClientRect()
        x = right - w
        y = (hint ? hint.top - box.top - 10 : box.height - 18) - h
      } else {
        x = anchor.x + 26
        if (x + w > right) x = anchor.x - 26 - w
        x = Math.max(14, Math.min(right - w, x))
        // The page's heading and notes sit at the top left: below them there, anywhere else up to the top.
        const top = x < 440 ? 136 : 14
        y = Math.max(top, Math.min(box.height - h - 14, anchor.y - h * 0.3))
      }
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
      const r = ring.current
      const l = leader.current
      if (r) r.style.display = pinned ? 'none' : 'block'
      if (r && !pinned) r.style.transform = `translate(${Math.round(anchor.x - 7)}px, ${Math.round(anchor.y - 7)}px)`
      if (l) {
        l.style.display = pinned ? 'none' : 'inline'
        const ex = anchor.x < x ? x : x + w
        const ey = Math.max(y + 10, Math.min(y + h - 10, anchor.y))
        l.setAttribute('x1', String(anchor.x))
        l.setAttribute('y1', String(anchor.y))
        l.setAttribute('x2', String(ex))
        l.setAttribute('y2', String(ey))
      }
    }
    frame = requestAnimationFrame(place)
    return () => cancelAnimationFrame(frame)
  }, [selection, mode])
  if (!population || !selection) return null
  const time = worldYears(year, hours)
  return (
    <>
      <svg className="organism-leader" aria-hidden="true">
        <line ref={leader} />
      </svg>
      <div ref={ring} className="organism-ring" aria-hidden="true" />
      <div ref={card} className="organism-card" role="dialog" aria-label="Living architecture">
        {selection.kind === 'organism' ? <OrganismBody population={population} index={selection.index} time={time} /> : <LinkBody population={population} selection={selection} time={time} />}
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
