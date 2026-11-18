import { useEffect, useState } from 'react'
import { getExplore } from '../project03/exploreData.tsx'
import { formatHour, useClock } from './clock.ts'
import { fieldNotes } from './fieldNotes.ts'

/**
 * THE CAMERA in Explore: a field camera for composing and keeping a photograph of the island (in its own colours, or in black and white), the first half of what is meant to become a
 * creative camera and an observation journal (each photograph kept with the moment it records). The approach is the Habitat Study's compose
 * view (habitat-study/HabitatStudy.tsx › ComposeOverlay): a plate of a chosen proportion over the live world, its thirds drawn faintly (here in
 * the signal red), and nothing else in the way. The world is previewed in black and white (a filter on its canvas: nothing in the world changes)
 * and stays live: the visitor moves the camera as usual (orbit, Approach, Walk, the hour) to compose.
 *
 * Capture → review → keep or retake: the shutter copies the frame the world has just drawn, crops it to the plate and tones it to black and
 * white; the review shows it with the moment it records (day, hour, weather, view) and offers it to download as a PNG.
 */
type Film = 'colour' | 'mono'
type Aspect = { key: string; label: string; ratio: number }
const ASPECTS: Aspect[] = [
  { key: '3:2', label: '3:2', ratio: 3 / 2 },
  { key: '4:5', label: '4:5', ratio: 4 / 5 },
  { key: '1:1', label: '1:1', ratio: 1 },
]
/** Room the plate keeps from the window's edges (the navigation and the moment above, the camera's controls and the rail below). */
const MARGIN = { top: 96, bottom: 150, side: 64 }

function plateRect(ratio: number, w: number, h: number) {
  const aw = w - MARGIN.side * 2
  const ah = h - MARGIN.top - MARGIN.bottom
  const width = Math.min(aw, ah * ratio)
  const height = width / ratio
  return { x: (w - width) / 2, y: MARGIN.top + (ah - height) / 2, w: width, h: height }
}

/** The world's next drawn frame, cropped to the plate and toned to black and white. */
function capture(plate: { x: number; y: number; w: number; h: number }, film: Film): Promise<string> {
  return new Promise((resolve, reject) => {
    // (Read in an animation frame, after the world's own render of that frame: its drawing buffer still holds the picture then.)
    requestAnimationFrame(() => {
      const src = document.querySelector<HTMLCanvasElement>('.pv-world canvas')
      if (!src) {
        reject(new Error('no world'))
        return
      }
      const rect = src.getBoundingClientRect()
      const sx = src.width / rect.width
      const sy = src.height / rect.height
      const out = document.createElement('canvas')
      out.width = Math.round(plate.w * sx)
      out.height = Math.round(plate.h * sy)
      const g = out.getContext('2d')!
      g.drawImage(src, (plate.x - rect.left) * sx, (plate.y - rect.top) * sy, plate.w * sx, plate.h * sy, 0, 0, out.width, out.height)
      if (film === 'colour') {
        // The world's own colours, as drawn.
        resolve(out.toDataURL('image/png'))
        return
      }
      const img = g.getImageData(0, 0, out.width, out.height)
      const d = img.data
      for (let i = 0; i < d.length; i += 4) {
        const l = (0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) / 255
        // A strong S-curve, a printer's: shadows pressed down to near black, highlights held, the greys between kept rich.
        const c = l < 0.5 ? 2 * l * l : 1 - 2 * (1 - l) * (1 - l)
        const t = Math.pow(0.7 * c + 0.3 * l, 1.12)
        const v = Math.round(Math.min(1, Math.max(0, t)) * 255)
        d[i] = v
        d[i + 1] = v
        d[i + 2] = v
      }
      g.putImageData(img, 0, 0)
      resolve(out.toDataURL('image/png'))
    })
  })
}

const VIEW_LABEL: Record<string, string> = { final: 'the island as it is', geology: 'rock and slope', water: 'water flow', ground: 'ground and habitat', sun: 'shadows now', ecolight: 'sun exposure' }

/** `subject`: what an expedition asked to document (kept with the photograph); `onNotes`: opens the visit's field notes. */
export function PhotoMode({ onClose, subject = '', onNotes }: { onClose: () => void; subject?: string; onNotes?: () => void }) {
  const [clock] = useClock()
  const [aspect, setAspect] = useState(ASPECTS[0]!)
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [shot, setShot] = useState<{ src: string; moment: string; id: number } | null>(null)
  const [flash, setFlash] = useState(0)
  const [film, setFilm] = useState<Film>('colour')
  const [grid, setGrid] = useState(true)
  useEffect(() => {
    const resize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', resize)
    document.documentElement.dataset.photo = 'on'
    return () => {
      window.removeEventListener('resize', resize)
      delete document.documentElement.dataset.photo
    }
  }, [])
  // Esc: away from the review back to the viewfinder, then out of the camera.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === ' ' && !shot && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        take()
        return
      }
      if (e.key !== 'Escape') return
      if (shot) setShot(null)
      else onClose()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  })
  const plate = plateRect(aspect.ratio, size.w, size.h)
  const moment = `Day ${clock.day} · ${formatHour(clock.hour)} · ${clock.weather.toLowerCase()} · ${VIEW_LABEL[getExplore().view] ?? 'the island'}`
  const take = () => {
    setFlash((f) => f + 1)
    capture(plate, film).then(
      // Every photograph goes into the visit's field notes at once (fieldNotes.ts); Discard takes it out again.
      (src) => setShot({ src, moment, id: fieldNotes.add(src, moment, subject || 'Free observation').id }),
      () => setShot(null),
    )
  }
  // (Black and white previews the world through a filter on its canvas: nothing in the world changes.)
  useEffect(() => {
    document.documentElement.dataset.photoFilm = film
    return () => {
      delete document.documentElement.dataset.photoFilm
    }
  }, [film])
  const name = `shadow-ecology-day${clock.day}-${formatHour(clock.hour).replace(':', '')}.png`
  return (
    <div className="pv-photo" aria-label="Camera">
      {/* The plate: what lies outside it dimmed, its thirds and corners marked; the pointer passes through to the world. */}
      <div className="pv-photo-plate" style={{ left: plate.x, top: plate.y, width: plate.w, height: plate.h }} aria-hidden>
        {grid ? (
          <>
            <span className="pv-photo-third v" style={{ left: '33.333%' }} />
            <span className="pv-photo-third v" style={{ left: '66.667%' }} />
            <span className="pv-photo-third h" style={{ top: '33.333%' }} />
            <span className="pv-photo-third h" style={{ top: '66.667%' }} />
          </>
        ) : null}
        <span className="pv-photo-focus" />
        <i className="pv-photo-corner tl" />
        <i className="pv-photo-corner tr" />
        <i className="pv-photo-corner bl" />
        <i className="pv-photo-corner br" />
        {flash ? <span key={flash} className="pv-photo-flash" /> : null}
      </div>
      <p className="pv-photo-moment" style={{ left: plate.x, top: plate.y - 26 }}>
        {moment}
      </p>
      <div className="pv-photo-bar" style={{ top: plate.y + plate.h + 18 }}>
        <div className="pv-photo-settings">
          <div className="pv-photo-aspects" role="group" aria-label="Proportion">
            {ASPECTS.map((a) => (
              <button key={a.key} type="button" aria-pressed={a.key === aspect.key} onClick={() => setAspect(a)}>
                {a.label}
              </button>
            ))}
          </div>
          <div className="pv-photo-aspects" role="group" aria-label="Film">
            <button type="button" aria-pressed={film === 'colour'} onClick={() => setFilm('colour')}>
              Colour
            </button>
            <button type="button" aria-pressed={film === 'mono'} onClick={() => setFilm('mono')}>
              B&amp;W
            </button>
          </div>
          <div className="pv-photo-aspects" role="group" aria-label="Guides">
            <button type="button" aria-pressed={grid} onClick={() => setGrid((v) => !v)}>
              Grid
            </button>
          </div>
        </div>
        <button type="button" className="pv-photo-shutter" aria-label="Take the photograph" onClick={take}>
          <i aria-hidden />
        </button>
        <button type="button" className="pv-photo-close" onClick={onClose}>
          Leave camera
        </button>
      </div>
      {/* Entering: what the camera is for, for a moment. */}
      <p className="pv-photo-intro" aria-hidden>
        Field camera · frame what you found, then press the shutter or Space
      </p>
      {shot ? (
        <div className="pv-photo-result" role="dialog" aria-label="Your photograph">
          <figure>
            <img src={shot.src} alt={`Your photograph of the island${film === 'mono' ? ', in black and white' : ''}`} />
            <figcaption>{shot.moment}</figcaption>
          </figure>
          <div className="pv-photo-result-actions">
            <a className="pv-photo-keep" href={shot.src} download={name}>
              Download photograph
            </a>
            <button
              type="button"
              className="pv-photo-retake"
              onClick={() => {
                fieldNotes.remove(shot.id)
                setShot(null)
              }}
            >
              Discard
            </button>
            {onNotes ? (
              <button type="button" className="pv-photo-retake" onClick={onNotes}>
                Field notes
              </button>
            ) : null}
            {subject ? (
              <button type="button" className="pv-photo-retake" onClick={onClose}>
                Back to the expedition
              </button>
            ) : null}
          </div>
          <p className="pv-photo-note">Kept in this visit’s field notes{subject ? ` as “${subject}”` : ''} (this tab only, never uploaded). Download keeps a copy; Discard removes it.</p>
        </div>
      ) : null}
    </div>
  )
}
