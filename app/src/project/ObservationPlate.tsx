import { useEffect, useId, useState, type ComponentProps, type ReactNode } from 'react'
import { Chevron, Segmented, type SegmentOption } from '../shared/ui/instrument.tsx'
import { PROJECT_COLORS } from './materials.ts'
import { PlanView } from './PlanView.tsx'

/**
 * A fold-out observation plate in the left column: the live world drawn in
 * an abstract projection beside the 3D view. Each projection reads the same
 * world state; Plan is the only one so far. Clicking the sheet enlarges it
 * into a field plate over the scene (PlateFocus).
 */
type Projection = 'plan'

const PROJECTIONS: (SegmentOption<Projection> & { title: string })[] = [
  { value: 'plan', label: 'Plan', title: 'Plan · north up' },
]

type WorldProps = ComponentProps<typeof PlanView>

export function ObservationPlate({
  expanded,
  onExpandedChange,
  ...world
}: WorldProps & { expanded: boolean; onExpandedChange: (next: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const [projection, setProjection] = useState<Projection>('plan')
  const bodyId = useId()
  const current = PROJECTIONS.find((option) => option.value === projection)!

  return (
    <section className="observation-plate" aria-label="Observation plate">
      <header className="observation-plate-head">
        <button
          type="button"
          className="observation-plate-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
        >
          <Chevron open={open} />
          <span className="observation-plate-label">Observation plate</span>
          <span className="observation-plate-projection">{expanded ? 'Enlarged' : current.label}</span>
        </button>
      </header>
      {open && !expanded ? (
        <div id={bodyId} className="observation-plate-body">
          {PROJECTIONS.length > 1 ? (
            <Segmented label="Projection" options={PROJECTIONS} value={projection} onChange={setProjection} />
          ) : null}
          <button
            type="button"
            className="observation-plate-sheet"
            aria-label="Enlarge the observation plate"
            onClick={() => onExpandedChange(true)}
          >
            {projection === 'plan' ? <PlanView {...world} /> : null}
            <span className="observation-plate-enlarge" aria-hidden="true">
              Enlarge
            </span>
          </button>
          <p className="observation-plate-caption">{current.title}</p>
        </div>
      ) : null}
    </section>
  )
}

/** Key swatches, drawn in the plate's own notation (22 × 12). */
function Swatch({ children }: { children: ReactNode }) {
  return (
    <svg className="plate-key-swatch" viewBox="0 0 22 12" aria-hidden="true">
      {children}
    </svg>
  )
}

const INK = '#e9e6df'

type KeyEntry = {
  label: string
  note: string
  swatch: ReactNode
  /** The layer or view that hides it, if any. */
  shown?: (world: WorldProps) => boolean
}

const KEY: readonly KeyEntry[] = [
  {
    label: 'Terrain',
    note: 'contours, every fifth heavier',
    swatch: (
      <Swatch>
        <path d="M1 9 C 6 5 14 5 21 8" fill="none" stroke={INK} strokeOpacity="0.3" />
        <path d="M1 5 C 7 1 15 2 21 4" fill="none" stroke={INK} strokeOpacity="0.14" />
      </Swatch>
    ),
  },
  {
    label: 'Water',
    note: 'lakes, depth lines, rivers, falls',
    swatch: (
      <Swatch>
        <rect x="1" y="2" width="20" height="8" fill={PROJECT_COLORS.waterShallow} />
        <rect x="1" y="2" width="20" height="8" fill="none" stroke={PROJECT_COLORS.waterLine} strokeOpacity="0.85" />
      </Swatch>
    ),
    shown: (world) => world.layers.water,
  },
  {
    label: 'Architecture',
    note: 'mass, brighter where taller; overhang dashed',
    swatch: (
      <Swatch>
        <rect x="1.5" y="2.5" width="9" height="7" fill="#d8d4cc" stroke={INK} />
        <rect x="12.5" y="2.5" width="8" height="7" fill="none" stroke={INK} strokeOpacity="0.7" strokeDasharray="2 2" />
      </Swatch>
    ),
  },
  {
    label: 'Shade',
    note: 'cast by the sun now',
    swatch: (
      <Swatch>
        <rect x="1" y="2" width="20" height="8" fill="#000000" fillOpacity="0.9" stroke={INK} strokeOpacity="0.14" />
      </Swatch>
    ),
  },
  {
    label: 'Habitat',
    note: 'hatched where suitable, stippled where emerging',
    swatch: (
      <Swatch>
        <path d="M2 10 L8 2 M6 10 L12 2 M10 10 L14 4.7" stroke={PROJECT_COLORS.habitat} />
        <path d="M14 2 V10" stroke={PROJECT_COLORS.habitat} strokeWidth="1.2" />
        {[
          [17, 4],
          [19.5, 7.5],
          [16.5, 9],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="0.7" fill={PROJECT_COLORS.habitatThin} />
        ))}
      </Swatch>
    ),
    shown: (world) => world.layers.habitat,
  },
  {
    label: 'Vegetation',
    note: 'canopies, by height and vigour',
    swatch: (
      <Swatch>
        <circle cx="6" cy="6" r="3.5" fill="none" stroke={PROJECT_COLORS.vegetationTip} />
        <circle cx="14.5" cy="6.5" r="2.5" fill="none" stroke={PROJECT_COLORS.vegetationTip} strokeOpacity="0.6" />
      </Swatch>
    ),
    shown: (world) => world.layers.vegetation && !world.fieldOnly,
  },
  {
    label: 'Paths',
    note: 'worn routes; spurs dashed',
    swatch: (
      <Swatch>
        <path d="M1 4 H21" stroke={PROJECT_COLORS.path} strokeOpacity="0.8" strokeWidth="1.1" />
        <path d="M1 9 H21" stroke={PROJECT_COLORS.path} strokeOpacity="0.55" strokeDasharray="2.5 2.5" />
      </Swatch>
    ),
    shown: (world) => world.layers.paths && !world.fieldOnly,
  },
  {
    label: 'Sun',
    note: 'now, on today’s path; ring = horizon',
    swatch: (
      <Swatch>
        <path d="M1 10 Q 11 -2 21 10" fill="none" stroke={INK} strokeOpacity="0.3" strokeDasharray="2 2" />
        <circle cx="14" cy="4.6" r="2.6" fill={INK} />
      </Swatch>
    ),
  },
]

/**
 * The plate enlarged over the scene for close reading: title block, the live
 * plan, and its key. The instrument panel stays usable beside it, so time
 * and layers can be changed while the drawing updates. Esc, a click outside
 * the sheet or Return to world goes back.
 */
export function PlateFocus({
  meta,
  onClose,
  ...world
}: WorldProps & { meta: string; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="plate-focus"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <figure className="plate-focus-sheet" aria-label="Observation plate, enlarged">
        <header className="plate-focus-head">
          <span className="plate-focus-label">Observation plate · Plan</span>
          <span className="plate-focus-meta">{meta}</span>
          <button type="button" className="plate-focus-return" onClick={onClose}>
            Return to world <kbd>Esc</kbd>
          </button>
        </header>
        <div className="plate-focus-drawing">
          <PlanView {...world} />
        </div>
        <figcaption className="plate-key">
          {KEY.map((entry) => (
            <span
              key={entry.label}
              className="plate-key-entry"
              data-off={entry.shown && !entry.shown(world) ? '' : undefined}
            >
              {entry.swatch}
              <span className="plate-key-label">{entry.label}</span>
              <span className="plate-key-note">{entry.note}</span>
            </span>
          ))}
        </figcaption>
      </figure>
    </div>
  )
}
