import { useId, useState, type ReactNode } from 'react'
import { Chevron } from './shared/ui/instrument.tsx'
import './project-nav.css'

export type NavEntry = {
  id: string
  label: string
  /** A short tag after the label, such as "current". */
  note?: string
  /** One or two lines about this page, shown beneath the selector while it is open. */
  description?: string
  /** The page itself; it is handed the nav to draw in its left column. */
  render: (nav: ReactNode) => ReactNode
}

/**
 * The project's own navigation, in the left column of every project page: the versions as one compact row (newest first, the current
 * one tagged), a short description of the page that is open, then the labs in one collapsible group. A lab is a workspace for one
 * part of the world, not a version of it. To add a lab, add an entry to the `labs` list: they appear in the order given.
 */
export function ProjectNav({ versions, labs, active, onSelect }: { versions: readonly NavEntry[]; labs: readonly NavEntry[]; active: string; onSelect: (id: string) => void }) {
  const inLabs = labs.some((lab) => lab.id === active)
  // Arriving in a lab opens the menu, so the current page is always visible; the person can still close it (until the next page).
  const [manual, setManual] = useState<{ page: string; open: boolean } | null>(null)
  const open = manual?.page === active ? manual.open : inLabs
  const menu = useId()

  const choose = (entry: NavEntry, index?: number) => (
    <button key={entry.id} type="button" role="tab" aria-selected={entry.id === active} onClick={() => onSelect(entry.id)}>
      {index !== undefined ? <span className="project-nav-number">{String(index + 1).padStart(2, '0')}</span> : null}
      <span>{entry.label}</span>
      {entry.note ? <span className="project-nav-note">{entry.note}</span> : null}
    </button>
  )

  const current = [...versions, ...labs].find((entry) => entry.id === active)

  return (
    <nav className="project-nav" aria-label="Project">
      <div className="project-nav-versions" role="tablist" aria-label="Project versions">
        {versions.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={entry.id === active} onClick={() => onSelect(entry.id)}>
            <span>{entry.label}</span>
            {entry.note ? <span className="project-nav-note">{entry.note}</span> : null}
          </button>
        ))}
      </div>
      {current?.description ? <p className="project-nav-description">{current.description}</p> : null}
      <div className="project-nav-group">
        <button type="button" className="project-nav-toggle" aria-expanded={open} aria-controls={menu} data-active={inLabs} onClick={() => setManual({ page: active, open: !open })}>
          <span className="project-nav-title">Labs</span>
          <span className="project-nav-count">{labs.length}</span>
          <Chevron open={open} />
        </button>
        {open ? (
          <div id={menu} className="project-nav-menu" role="tablist" aria-label="Labs">
            {labs.map((entry, index) => choose(entry, index))}
          </div>
        ) : null}
      </div>
    </nav>
  )
}
