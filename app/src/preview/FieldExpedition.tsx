import { useState } from 'react'
import { creaturePlaces } from '../project03/Creatures.tsx'
import { useCreatureCam } from '../project03/creatureCam.ts'
import { setHour, setPlaying } from '../project03/environment.ts'
import { currentPopulation } from '../project03/livingSelection.ts'
import { LIFECYCLE } from '../project03/livingTime.ts'
import { shared } from '../project03/vegShared.ts'
import { speciesInfo } from '../project03/worldPlants.ts'
import { worldActions } from '../project03/worldActions.ts'
import { noteFileName, useFieldNotes, type FieldNote } from './fieldNotes.ts'
import { findPlants } from './vegetationFind.ts'

/**
 * FIELD EXPEDITION: Explore as a field observer. Four observations, in any order, each a real place or animal on this island that the visitor is taken
 * to (by the systems Explore already has: the plants' own placement, the structures' population, Creature Follow) and asked to document with the
 * camera. Nothing here simulates anything: it points at what the island already is. The photographs are the visit's field notes (fieldNotes.ts).
 */
type Prompt = { key: string; title: string; ask: string; go: () => string | null }

function framePlant(id: Parameters<typeof findPlants>[0], dist: number): string | null {
  const p = findPlants(id)[0]
  if (!p) return null
  const h = Math.max(0.4, speciesInfo(id).height * p.s)
  worldActions.creatures.camera('off')
  worldActions.navigation.approach(p.x, p.z, dist, { aim: h * 0.5, glide: 1.6, elev: 0.28, arc: true })
  worldActions.navigation.view('approach', true)
  return speciesInfo(id).name
}

const PROMPTS: Prompt[] = [
  {
    key: 'sun',
    title: 'Sunlit ground',
    ask: 'Open ground the sun reaches most of the day: grasses and sedges, a sun-grown form. Notice the paler, warmer greens.',
    go: () => framePlant('grass', 26),
  },
  {
    key: 'shade',
    title: 'Lasting shade',
    ask: 'Ground the sun barely reaches: ferns and mats, a shade-grown form. Compare it with the sunlit ground: darker, cooler, lower.',
    go: () => framePlant('fern', 20),
  },
  {
    key: 'shadow',
    title: 'A structure’s shadow',
    ask: 'A living structure late in the afternoon, its lavender shadow long across the ground. The shade it casts is a habitat of its own.',
    go: () => {
      const pop = currentPopulation()
      const o = pop?.organisms.filter((m) => m.died < 0 || m.died > LIFECYCLE.reference).sort((a, b) => b.height * b.radius - a.height * a.radius)[0]
      if (!o) return null
      setPlaying(false)
      setHour(16.25)
      worldActions.creatures.camera('off')
      worldActions.navigation.approach(o.x, o.z, Math.max(140, o.radius * 2.4 + o.height * 1.7 + 50), { aim: o.height * 0.4, glide: 2, arc: true })
      worldActions.navigation.view('approach', true)
      return o.id
    },
  },
  {
    key: 'animal',
    title: 'An animal at work',
    ask: 'A Strider working the lake shallows by day. Follow it a while, then document what it is doing.',
    go: () => {
      const places = creaturePlaces.strider ?? []
      if (!places.length) return null
      const fx = shared.focus.x
      const fz = shared.focus.z
      let pick = 0
      places.forEach((p, i) => {
        if (Math.hypot(p.x - fx, p.z - fz) < Math.hypot(places[pick]!.x - fx, places[pick]!.z - fz)) pick = i
      })
      worldActions.creatures.species('strider')
      worldActions.creatures.choose('strider', pick)
      worldActions.creatures.camera('follow')
      return 'Strider'
    },
  },
]

export function FieldExpedition({ onDocument, onNotes, onEnd }: { onDocument: (subject: string) => void; onNotes: () => void; onEnd: () => void }) {
  const notes = useFieldNotes()
  const creatures = useCreatureCam()
  const [at, setAt] = useState<string | null>(null)
  const [miss, setMiss] = useState<string | null>(null)
  const done = (p: Prompt) => notes.some((n) => n.subject === p.title)
  const count = PROMPTS.filter(done).length
  const current = PROMPTS.find((p) => p.key === at) ?? null
  return (
    <section className="pv-card pv-expedition" aria-label="Field Expedition">
      <p className="pv-card-label">Field Expedition · {count} of {PROMPTS.length} observed</p>
      <p className="pv-card-title">{current ? current.title : 'You are the only person on this island.'}</p>
      <p className="pv-card-text">{current ? current.ask : 'No one else has walked here. Life on it grew up under two lights: open sun, and shadows that never quite lift. You have come to watch, not to change anything. Four observations, in any order: find each, look closely, and document what you see.'}</p>
      {miss ? <p className="pv-card-text pv-expedition-miss">{miss}</p> : null}
      <ol className="pv-expedition-list">
        {PROMPTS.map((p) => (
          <li key={p.key} data-done={done(p) || undefined} data-at={at === p.key || undefined}>
            <button
              type="button"
              onClick={() => {
                const found = p.go()
                setAt(p.key)
                setMiss(found ? null : 'Nothing of that near where you are looking. Turn to another part of the island and try again.')
              }}
            >
              <span>{done(p) ? '●' : '○'}</span>
              {p.title}
            </button>
          </li>
        ))}
      </ol>
      <div className="pv-card-actions">
        {current ? (
          <button type="button" className="pv-card-primary" onClick={() => onDocument(current.title)}>
            Document it →
          </button>
        ) : null}
        <button type="button" className="pv-card-secondary" onClick={onNotes}>
          Field notes ({notes.length})
        </button>
        {creatures.mode !== 'off' ? (
          <button type="button" className="pv-card-secondary" onClick={() => worldActions.creatures.camera('off')}>
            Let go
          </button>
        ) : null}
        <button
          type="button"
          className="pv-card-secondary"
          onClick={() => {
            worldActions.creatures.camera('off')
            onEnd()
          }}
        >
          End
        </button>
      </div>
    </section>
  )
}

/** The visit's field notes: thumbnails, newest first; one opened large with its moment and subject, to download or remove. */
export function FieldNotes({ onClose }: { onClose: () => void }) {
  const notes = useFieldNotes()
  const [open, setOpen] = useState<FieldNote | null>(null)
  return (
    <div className="pv-notes" role="dialog" aria-label="Field notes">
      <header className="pv-notes-head">
        <p>Field notes · {notes.length} photograph{notes.length === 1 ? '' : 's'} this visit</p>
        <button type="button" className="pv-text" onClick={onClose}>
          Close
        </button>
      </header>
      {open ? (
        <figure className="pv-notes-large">
          <img src={open.src} alt={`${open.subject}: ${open.moment}`} />
          <figcaption>
            <b>{open.subject}</b> · {open.moment}
          </figcaption>
          <div className="pv-card-actions">
            <a className="pv-card-primary" href={open.src} download={noteFileName(open)}>
              Download
            </a>
            <button type="button" className="pv-card-secondary" onClick={() => setOpen(null)}>
              All notes
            </button>
          </div>
        </figure>
      ) : notes.length ? (
        <ul className="pv-notes-grid">
          {notes.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => setOpen(n)}>
                <img src={n.src} alt={n.subject} />
                <span>{n.subject}</span>
                <em>{n.moment.split(' · ').slice(0, 2).join(' · ')}</em>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pv-card-text">No photographs yet. Open the camera from the expedition (Document it) or the rail, and press the shutter.</p>
      )}
      <p className="pv-photo-note">Kept in this tab only, never uploaded; closing the tab clears them. Download keeps one.</p>
    </div>
  )
}
