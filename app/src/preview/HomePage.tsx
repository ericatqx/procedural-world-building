import { useState, type MouseEvent } from 'react'
import { LANDSCAPE } from '../project03/terrain.ts'
import { formatHour, useClock } from './clock.ts'
import { follow, go, href } from './route.ts'

/** The chain the world runs on, each link in one line: the explanation Home offers before anything else. */
const CHAIN = [
  { word: 'Light', line: 'A sun crosses the island every day.' },
  { word: 'Growth', line: 'Living structures rise toward it.' },
  { word: 'Shadow', line: 'Their shade cools and dampens the ground.' },
  { word: 'Habitat', line: 'Plants and creatures settle where it lasts.' },
] as const

/**
 * HOME: an editorial column on the left (the title, a line on the idea, the chain it runs on, the way in) and the island close up on the right
 * (homeScene.ts frames it, in a still afternoon whose sun drifts slowly), captioned like a specimen plate: what it shows, as the system reports it.
 * (Concept B, the dark specimen, is kept in SpecimenHome.tsx for reference but no longer reachable from the site.)
 */
export function HomePage() {
  return <EditorialHome />
}

function useEnter() {
  const [leaving, setLeaving] = useState(false)
  const enter = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    setLeaving(true)
    window.setTimeout(() => go(href({ page: 'explore' })), 420)
  }
  return { leaving, enter }
}

/** CONCEPT A · THE EDITORIAL COLUMN (the current Home). */
function EditorialHome() {
  const { leaving, enter } = useEnter()

  return (
    <main className={`pv-home is-column${leaving ? ' is-leaving' : ''}`}>
      <div className="pv-home-shade" aria-hidden />

      <section className="pv-column">
        <header className="pv-column-head">
          <p className="pv-kicker">
            <span>A living island</span>
            <span>{(LANDSCAPE.size / 1000).toFixed(1)} km across</span>
            <span>grown from one seed</span>
          </p>
          <h1 className="pv-column-title">
            Shadow
            <br />
            Ecology.
          </h1>
          <p className="pv-column-lede">An island under a moving sun. Structures grow toward the light, and the shade they cast decides who can live where.</p>
        </header>
        <ol className="pv-column-chain">
          {CHAIN.map((c, i) => (
            <li key={c.word}>
              <span className="pv-column-word">
                <span className="pv-column-n">{String(i + 1).padStart(2, '0')}</span>
                {c.word}
              </span>
              <span className="pv-column-line">{c.line}</span>
            </li>
          ))}
        </ol>
        <div className="pv-column-actions">
          <a className="pv-enter" href={href({ page: 'explore' })} onClick={enter}>
            <span>Enter the island</span>
            <i aria-hidden />
          </a>
          <a className="pv-quiet-link" href={href({ page: 'project' })} onClick={follow(href({ page: 'project' }))}>
            How it is made
          </a>
        </div>
      </section>

      <PlateCaption />
    </main>
  )
}

/** The plate's caption, at the island's foot: the figure, and the scene's own state as the system reports it. */
function PlateCaption() {
  const [clock] = useClock()
  return (
    <figure className="pv-home-plate">
      <figcaption>
        <span className="pv-home-plate-head">
          <span className="pv-home-plate-fig">Fig. 01</span>
          <span className="pv-home-plate-sep" aria-hidden>
            ·
          </span>
          <span className="pv-home-plate-title">The island, this afternoon</span>
        </span>
        <span className="pv-home-plate-data">
          Year {Math.floor(clock.year)} · {formatHour(clock.hour)} · {clock.weather}
        </span>
      </figcaption>
    </figure>
  )
}
