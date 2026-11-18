import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from 'react'
import { Segmented, Toggle } from '../shared/ui/instrument.tsx'
import { DIAG_COLOUR, DIAG_LEGENDS, DIAG_VIEWS, LENS_LEGENDS, LENS_RAMPS, diagUniforms, setDiagFocus, setDiagnostics, type DiagSub, type DiagView, type Legend } from './visualDiagnostics.ts'
import { setVegetation, type VegOverlay } from './vegStore.ts'
import { useExperience } from './experience.ts'

/**
 * Shadow Ecology 0.3 — EXPLORE DATA, the interface of the diagnostic views (visualDiagnostics.ts), Round 08C: a debugging tool, not an essay.
 *   panel     which view and data layer, one line on what it is, and the layers
 *   legend    a compact overlay low left in the viewport (DataLegend): categories, or a ramp with its real range
 *   card      what is under the pointer (DataTooltip, read by dataProbe.tsx), in the Living Architecture card's style
 * and the two directions of highlight: a legend entry (hover, or click to pin) keeps its part of the island and dims the rest; the island under the
 * pointer lights its legend entry (or its place on the ramp) and its region. All of it is one small store, so a view stays on while the panel is folded.
 */
type Focus = { cat: number } | { band: [number, number] }
type ExploreState = { view: DiagView; sub: DiagSub; pinned: Focus | null; legendHover: Focus | null }
/** Point & Inspect's card (dataProbe.tsx › inspectAt): where it was clicked (canvas pixels and world), and its sections. */
export type CardSection = { head: string; rows: [string, string][] }
export type Card = { sx: number; sy: number; w: number; h: number; x: number; y: number; z: number; title: string; tag: string; sections: CardSection[]; summary: [string, string][]; /** Opened with its sections showing (a click's detailed reading). */ full?: boolean } | null
/** Where the clicked place is on screen now (dataProbe.tsx projects it each frame). */
export const calloutAnchor = { x: 0, y: 0, visible: false }

/**
 * Inspect's PROBE MARKER (Round 08H): a small crosshair at the pointer where a reading is taken, a DOM mark of its own (Explore's place cursor
 * and Approach's area ring are drawn by the ground's shader, visualStyle.ts › pickMarker; Inspect no longer borrows them). dataProbe.tsx moves,
 * shows and hides it directly, without a React render per pointer move.
 */
let markerEl: HTMLDivElement | null = null
const markerAt = { x: 0, y: 0, on: false }
export const probeMarker = {
  move(x: number, y: number) {
    markerAt.x = x
    markerAt.y = y
    if (markerEl) markerEl.style.transform = `translate(${(x - 9).toFixed(1)}px, ${(y - 9).toFixed(1)}px)`
  },
  show() {
    markerAt.on = true
    if (markerEl) markerEl.style.opacity = '1'
  },
  hide() {
    markerAt.on = false
    if (markerEl) markerEl.style.opacity = '0'
  },
}
export function ProbeMarker() {
  return (
    <div
      className="probe-mark"
      aria-hidden="true"
      ref={(el) => {
        markerEl = el
        if (el) {
          el.style.transform = `translate(${(markerAt.x - 9).toFixed(1)}px, ${(markerAt.y - 9).toFixed(1)}px)`
          el.style.opacity = markerAt.on ? '1' : '0'
        }
      }}
    />
  )
}
/** What the pointer reads (dataProbe.tsx): where (canvas pixels), the card's contents, and the category and value as the view drew them. */
export type Inspect = { sx: number; sy: number; w: number; h: number; title: string; tag: string; rows: [string, string][]; cat: number; val: number } | null

let state: ExploreState = { view: 'final', sub: 0, pinned: null, legendHover: null }
let card: Card = null
const cardListeners = new Set<() => void>()
export const getCard = () => card
/** The hover reading now (a click keeps it as the detailed reading: dataProbe.tsx). */
export const getInspect = () => inspect
export function setCard(next: Card) {
  card = next
  for (const l of cardListeners) l()
}
function useCard(): Card {
  return useSyncExternalStore(
    (l) => {
      cardListeners.add(l)
      return () => cardListeners.delete(l)
    },
    () => card,
  )
}
let inspect: Inspect = null
const listeners = new Set<() => void>()
const inspectListeners = new Set<() => void>()

/** The vegetation overlay a view reads (vegCoverage.ts › overlayTexture, or the architecture's map in Vegetation.tsx). */
const overlayFor = ({ view, sub }: ExploreState): VegOverlay =>
  view === 'ground' && sub === 1 ? 'habitat' : view === 'ground' && sub === 2 ? 'moisture' : view === 'ecolight' ? (sub === 0 ? 'light' : 'architecture') : 'off'

/** Whether the views are drawn as Explore's lenses (their own palette) or as the technical drawing: the legend shows the colours actually drawn. */
const lensMode = () => diagUniforms.uDiagSoft.value > 0.5
const legendOf = (s: ExploreState): Legend | undefined => (s.view === 'final' ? undefined : (lensMode() ? LENS_LEGENDS : DIAG_LEGENDS)[`${s.view}-${s.sub}`])
const rampOf = (s: ExploreState) => {
  const stops = lensMode() ? LENS_RAMPS[`${s.view}-${s.sub}`] : undefined
  const [a, b, c] = stops ?? [DIAG_COLOUR.rampLow, DIAG_COLOUR.rampMid, DIAG_COLOUR.rampHigh]
  return `linear-gradient(90deg, ${a} 0%, ${b} 50%, ${c} 100%)`
}

/**
 * The island's highlight, in three clearly different states:
 *   pinned          a legend entry (or range) clicked: the rest of the island steps well back, and stays so until it is clicked again
 *   legend hover    a light preview of the same, only while the pointer is on the legend
 *   island hover    nothing on the island changes: the readout beside the pointer and the legend's own entry (or its place on the ramp) answer it,
 *                   so moving over the island never recolours it
 */
function applyFocus() {
  const focus: Focus | null = state.pinned ?? state.legendHover
  setDiagFocus(state.view === 'final' ? null : focus, state.pinned ? 0.82 : 0.45)
}

const emit = () => {
  for (const l of listeners) l()
}

export function setExplore(patch: Partial<ExploreState>) {
  const viewChanged = (patch.view && patch.view !== state.view) || (patch.sub !== undefined && patch.sub !== state.sub)
  state = { ...state, ...patch }
  if (patch.view && patch.sub === undefined && viewChanged) state = { ...state, sub: 0 }
  if (viewChanged) {
    state = { ...state, pinned: null, legendHover: null }
    inspect = null
    for (const l of inspectListeners) l()
  }

  setDiagnostics(state.view, state.sub)
  setVegetation({ overlay: overlayFor(state) })
  applyFocus()
  emit()
}

export const getExplore = () => state

export function setInspect(next: Inspect) {
  if (next === null && inspect === null) return
  inspect = next
  applyFocus()
  for (const l of inspectListeners) l()
}

export function useExplore(): ExploreState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

function useInspect(): Inspect {
  return useSyncExternalStore(
    (l) => {
      inspectListeners.add(l)
      return () => inspectListeners.delete(l)
    },
    () => inspect,
  )
}

/** One line per view: what the colour is, and where it comes from. */
export const NOTE: Record<string, string> = {
  'final-0': 'The world as drawn. Hover to read a place; click to pin its card. Pick a layer to see one kind of data.',
  'ground-0': 'Raw ground weights from the ecology, 16 m cells (vegCoverage › groundTexture).',
  'ground-1': 'Strongest habitat-zone membership per 16 m cell (vegPlants › zonesOf).',
  'ground-2': 'Soil moisture field, 0–1, per 16 m cell (island fields).',
  'geology-0': 'Rock class as the Black Stage rules decide it (stageGeology).',
  'geology-1': 'Slope the rock rules read (geology map, 16 m). Lines: rule thresholds.',
  'sun-0': 'Cast shadows NOW: the shadow map at this hour, and which way surfaces face the sun. Changes by the minute.',
  'ecolight-0': "Light over the WHOLE DAY: the share of the day's sun each place receives, what plants grow on. Does not change with the hour.",
  'ecolight-1': 'What each structure does to the ground: FOOTPRINT (it stands there), SHELTER (roofed or overhung), SHADE (its shade over the day). Worked out near the camera only.',
  'water-0': 'Rivers and lakes from the hydrology; chevrons point downstream.',
}

/** Inspect's five topics, each a group of the data views (visualDiagnostics.ts) with its layers; "Normal" is the final render. */
export type Topic = { key: string; label: string; layers: { label: string; view: DiagView; sub: DiagSub }[] }
export const TOPICS: Topic[] = [
  { key: 'none', label: 'Normal', layers: [{ label: 'Final render', view: 'final', sub: 0 }] },
  { key: 'terrain', label: 'Terrain', layers: [{ label: 'Rock & strata', view: 'geology', sub: 0 }, { label: 'Slope', view: 'geology', sub: 1 }] },
  { key: 'water', label: 'Water', layers: [{ label: 'Flow', view: 'water', sub: 0 }] },
  { key: 'veg', label: 'Vegetation', layers: [{ label: 'Ground cover', view: 'ground', sub: 0 }, { label: 'Habitat', view: 'ground', sub: 1 }, { label: 'Moisture', view: 'ground', sub: 2 }] },
  // (Round 08H: the Architecture layer is withdrawn for now. Its map exists only in the tiles worked out near the camera, so it read as an
  // incomplete patchwork; the card's Light section still reports each place's structure shade, which is island-wide. See the roadmap.)
  { key: 'light', label: 'Light', layers: [{ label: 'Cast shadows now', view: 'sun', sub: 0 }, { label: "Day's light (ecology)", view: 'ecolight', sub: 0 }] },
]
export const topicOf = (view: DiagView, sub: DiagSub) => TOPICS.find((t) => t.layers.some((l) => l.view === view && l.sub === sub)) ?? TOPICS[0]!

/**
 * HOW IT'S MADE's panel (Round 08I). Two kinds of content, kept apart:
 *   DATA LAYERS   what the world's data says at each place, now (the four inspection layers over the shared world: hover to read, click to pin)
 *   SYSTEMS       how each system makes it, step by step (walkthroughs, later; and Build Replay across all of them). A layer is not a walkthrough:
 *                 Water's layer shows the hydrology's result (rivers, lakes, flow), the walkthrough will also show the particles that trace it.
 */
const SYSTEMS: [string, string][] = [
  ['Terrain', 'landform, uplift, erosion, the rock stack'],
  ['Water', 'flow particles, rivers, lakes, falls'],
  ['Vegetation', 'fields, habitat zones, communities, plants'],
  ['Architecture', 'growth, fusion, lifecycle, shade and shelter'],
  ['Creatures', 'habitat, needs, movement'],
]
export function ExploreData({ layers }: { layers: { label: string; checked: boolean; onChange: (on: boolean) => void }[] }) {
  const { view, sub } = useExplore()
  const topic = topicOf(view, sub)
  const layerIndex = topic.layers.findIndex((l) => l.view === view && l.sub === sub)
  return (
    <>
      <span className="eco-detail-head">Data layers</span>
      <div className="eco-visuals eco-studies">
        <Segmented
          label="Show"
          options={TOPICS.map((t) => ({ value: t.key, label: t.label }))}
          value={topic.key}
          onChange={(key) => {
            const t = TOPICS.find((x) => x.key === key)!
            setExplore({ view: t.layers[0]!.view, sub: t.layers[0]!.sub })
          }}
        />
      </div>
      {topic.layers.length > 1 ? (
        <Segmented
          label="Layer"
          options={topic.layers.map((l, i) => ({ value: String(i), label: l.label }))}
          value={String(Math.max(0, layerIndex))}
          onChange={(i) => {
            const l = topic.layers[Number(i)]!
            setExplore({ view: l.view, sub: l.sub })
          }}
        />
      ) : null}
      <p className="eco-note data-note">{NOTE[`${view}-${sub}`] ?? NOTE['final-0']}</p>
      <div className="eco-detail">
        <span className="eco-detail-head">Show in the world</span>
        {layers.map((l) => (
          <Toggle key={l.label} label={l.label} checked={l.checked} onChange={l.onChange} />
        ))}
      </div>
      <div className="eco-detail made-systems">
        <span className="eco-detail-head">Systems · coming</span>
        {SYSTEMS.map(([name, what]) => (
          <p key={name} className="eco-note">
            <b>{name}</b> {what}
          </p>
        ))}
        <p className="eco-note">
          <b>Build Replay</b> the island built stage by stage: terrain → water → vegetation → architecture → creatures
        </p>
      </div>
    </>
  )
}

/**
 * Point & Inspect's CALLOUT (Round 08G): a diamond marker on the place clicked (distinct from the Living Architecture ring), a fine leader line,
 * and a compact card: what is drawn there and why, the ground and the light at a glance, with the full sections behind "Details". The card
 * keeps beside its marker as the camera moves, clear of the panel and the page's heading, and fades in and out as the architecture card does.
 */
export function InspectCard() {
  const live = useCard()
  const experience = useExperience()
  // (Round 08I: one fade-in on mount, keyed by the place; no exit delay. A new click replaces the card, and it fades in like the first.)
  const c = experience === 'made' ? live : null
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const mark = useRef<HTMLDivElement>(null)
  const line = useRef<SVGLineElement>(null)
  useEffect(() => setOpen(!!live?.full), [live])
  // Esc puts the reading away (as the × does; a click elsewhere on the island replaces it, one off the island clears it).
  useEffect(() => {
    if (!c) return
    // (First, and alone: the key is not passed on, so Esc puts the reading away without also closing a drawer or leaving a view.)
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      setCard(null)
    }
    window.addEventListener('keydown', close, { capture: true })
    return () => window.removeEventListener('keydown', close, { capture: true })
  }, [c])
  useEffect(() => {
    if (!c) return
    let frame = 0
    const place = () => {
      frame = requestAnimationFrame(place)
      const el = box.current
      const wrap = el?.offsetParent as HTMLElement | null
      if (!el || !wrap) return
      const rect = wrap.getBoundingClientRect()
      const panel = [...document.querySelectorAll('[data-annotation-anchor]')].map((el) => el.getBoundingClientRect()).find((r) => r.width > 0)
      const right = (panel && panel.left > rect.left + 200 ? Math.min(rect.right, panel.left) : rect.right) - rect.left - 14
      const w = el.offsetWidth
      const h = el.offsetHeight
      // The page around the world may reserve room at the top and bottom (its navigation, its controls): the card stays between them.
      const css = getComputedStyle(el)
      const reserveTop = parseFloat(css.getPropertyValue('--inspect-top')) || 0
      const reserveBottom = parseFloat(css.getPropertyValue('--inspect-bottom')) || 0
      const ax = calloutAnchor.x
      const ay = calloutAnchor.y
      // Beside the anchor (right, else left); where neither side has room (between the panel and the left edge), below it, else above:
      // the card never covers its own anchor.
      // Beside the anchor, on whichever side stays clear of the lens panel, the rail and the legend (overlayRoom), never over its own anchor.
      const room = overlayRoom(rect, el)
      room.bounds.t = Math.max(room.bounds.t, reserveTop + 14)
      room.bounds.b = Math.min(room.bounds.b, rect.height - 14 - reserveBottom)
      room.bounds.r = Math.min(room.bounds.r, right)
      const [x, y] = placeBeside(ax, ay, w, h, room, 34)
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
      el.style.visibility = 'visible'
      const m = mark.current
      if (m) {
        m.style.display = calloutAnchor.visible ? 'block' : 'none'
        m.style.visibility = 'visible'
        m.style.transform = `translate(${(ax - 7).toFixed(1)}px, ${(ay - 7).toFixed(1)}px) rotate(45deg)`
      }
      const l = line.current
      if (l) {
        l.style.display = calloutAnchor.visible ? 'inline' : 'none'
        // To the card's near side edge; when the card is above or below the anchor, straight to its near top or bottom edge.
        const over = ax >= x && ax <= x + w
        const ex = over ? ax : ax < x ? x : x + w
        const ey = over ? (ay < y ? y : y + h) : Math.max(y + 12, Math.min(y + h - 12, ay))
        l.setAttribute('x1', ax.toFixed(1))
        l.setAttribute('y1', ay.toFixed(1))
        l.setAttribute('x2', ex.toFixed(1))
        l.setAttribute('y2', ey.toFixed(1))
      }
    }
    frame = requestAnimationFrame(place)
    return () => cancelAnimationFrame(frame)
  }, [c])
  if (!c) return null
  return (
    <>
      <svg key={`l${c.x},${c.z}`} className="organism-leader inspect-leader" aria-hidden="true">
        <line ref={line} />
      </svg>
      <div key={`m${c.x},${c.z}`} ref={mark} className="inspect-mark" aria-hidden="true" style={{ visibility: 'hidden' }} />
      <div key={`c${c.x},${c.z}`} ref={box} className="organism-card inspect-card" role="dialog" aria-label="Inspect" style={{ visibility: 'hidden' }}>
        <div className="organism-card-head">
          <span className="organism-card-title">{c.title}</span>
          <span className="organism-card-stage">{c.tag}</span>
        </div>
        <dl className="organism-card-rows">
          {c.summary.map(([k, v]) => (
            <div key={k} className="organism-card-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {open
          ? c.sections.map((sec) => (
              <div key={sec.head} className="inspect-section">
                <span className="inspect-head">{sec.head}</span>
                <dl className="organism-card-rows">
                  {sec.rows.map(([k, v]) => (
                    <div key={k} className="organism-card-row">
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))
          : null}
        <div className="organism-card-actions">
          <button type="button" className="text-button" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Less' : 'Details'}
          </button>
          <button type="button" className="text-button organism-card-close" aria-label="Close" onClick={() => setCard(null)}>
            ×
          </button>
        </div>
      </div>
    </>
  )
}

const same = (a: Focus | null, b: Focus | null) => !!a && !!b && ('cat' in a ? 'cat' in b && a.cat === b.cat : 'band' in b && a.band[0] === b.band[0])

const fmt = (v: number, legend: Extract<Legend, { kind: 'ramp' }>) => `${legend.max - legend.min >= 10 ? Math.round(v) : v.toFixed(2)}${legend.unit}`

/** The active view's legend, low left over the viewport. Hover an entry to highlight it on the island; click to pin it (click again to release). */
export function DataLegend() {
  const s = useExplore()
  const now = useInspect()
  const legend = legendOf(s)
  if (!legend) return null
  const setHover = (focus: Focus | null) => {
    state = { ...state, legendHover: focus }
    applyFocus()
    emit()
  }
  const pin = (focus: Focus) => {
    state = { ...state, pinned: same(state.pinned, focus) ? null : focus }
    applyFocus()
    emit()
  }
  const active = s.pinned ?? s.legendHover
  const rampCss = rampOf(s)
  if (legend.kind === 'cat' && legend.fixed) {
    // A map drawn by its own overlay (the structures' map): its entries are a key only, not a highlight (it cannot be isolated on the island).
    return (
      <div className="data-legend" role="group" aria-label={`Legend: ${legend.title}`}>
        <span className="data-legend-title">{legend.title}</span>
        {legend.items.map((item) => (
          <span key={item.label} className="data-legend-extra">
            <i style={{ background: item.colour }} />
            {item.label}
          </span>
        ))}
        <span className="data-legend-hint">Drawn near the camera only</span>
      </div>
    )
  }
  if (legend.kind === 'cat') {
    // The entry being looked at: pinned or hovered on the legend (the others step back, as on the island), or only marked for what the pointer is
    // over on the island (nothing else changes).
    const lit = active && 'cat' in active ? active.cat : now && now.cat >= 0 ? now.cat : null
    const focused = active && 'cat' in active ? active.cat : null
    return (
      <div className="data-legend" role="group" aria-label={`Legend: ${legend.title}`} data-pinned={s.pinned ? 'true' : undefined}>
        <span className="data-legend-title">{legend.title}</span>
        {legend.items.map((item, i) => (
          <button
            key={item.label}
            type="button"
            className="data-legend-item"
            data-lit={lit === i ? 'true' : undefined}
            data-dim={focused !== null && focused !== i ? 'true' : undefined}
            aria-pressed={s.pinned !== null && 'cat' in s.pinned && s.pinned.cat === i}
            onPointerEnter={() => setHover({ cat: i })}
            onPointerLeave={() => setHover(null)}
            onClick={() => pin({ cat: i })}
          >
            <i style={{ background: item.colour }} />
            {item.label}
          </button>
        ))}
        <span className="data-legend-hint">{s.pinned ? 'Pinned: click again to release' : 'Hover to highlight · click to pin'}</span>
      </div>
    )
  }
  // A continuous measurement: the ramp with its real range; the band under the pointer (on the ramp or the island) is marked on it.
  const measured = now && now.cat >= 0 ? now : null
  const band = active && 'band' in active ? active.band : measured ? [measured.val - 0.035, measured.val + 0.035] : null
  const at = (event: ReactMouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const t = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    return [Math.max(0, t - 0.06), Math.min(1, t + 0.06)] as [number, number]
  }
  const value = (t: number) => legend.min + t * (legend.max - legend.min)
  return (
    <div className="data-legend" role="group" aria-label={`Legend: ${legend.title}`}>
      <span className="data-legend-title">
        {legend.title}
        {measured ? <b>{fmt(value(measured.val), legend)}</b> : null}
      </span>
      <div
        className="data-ramp"
        onPointerMove={(event) => setHover({ band: at(event) })}
        onPointerLeave={() => setHover(null)}
        onClick={(event) => pin({ band: at(event) })}
        role="button"
        tabIndex={0}
        aria-label={`${legend.title}: hover to highlight a range`}
      >
        <div className="data-ramp-bar" style={{ background: rampCss }} />
        {(legend.ticks ?? []).map((t) => (
          <span key={t} className="data-ramp-tick" style={{ left: `${((t - legend.min) / (legend.max - legend.min)) * 100}%` }} />
        ))}
        {band ? <span className="data-ramp-band" data-kind={s.pinned ? 'pinned' : s.legendHover ? 'preview' : 'reading'} style={{ left: `${Math.max(0, band[0]) * 100}%`, width: `${(Math.min(1, band[1]) - Math.max(0, band[0])) * 100}%` }} /> : null}
      </div>
      <div className="data-ramp-ends">
        <span>
          {fmt(legend.min, legend)} {legend.low}
        </span>
        {band && (s.pinned || s.legendHover) ? <span>{`${fmt(value(Math.max(0, band[0])), legend)}–${fmt(value(Math.min(1, band[1])), legend)}`}</span> : null}
        <span>
          {legend.high} {fmt(legend.max, legend)}
        </span>
      </div>
      {legend.extras?.map((item) => (
        <span key={item.label} className="data-legend-extra">
          <i style={{ background: item.colour }} />
          {item.label}
        </span>
      ))}
      <span className="data-legend-hint">{s.pinned ? 'Pinned: click again to release' : 'Hover the ramp to highlight a range'}</span>
    </div>
  )
}

/**
 * The rectangles a floating readout must keep clear of, in the world's own coordinates: the page's side panel (the lens drawer), its bottom rail,
 * the legend, the pinned card and the guide's card; and the room left between the navigation and the rail.
 */
export function overlayRoom(wrap: DOMRect, self?: Element | null): { bounds: { l: number; t: number; r: number; b: number }; avoid: { l: number; t: number; r: number; b: number }[] } {
  const rel = (r: DOMRect) => ({ l: r.left - wrap.left, t: r.top - wrap.top, r: r.right - wrap.left, b: r.bottom - wrap.top })
  const seen = (sel: string) => [...document.querySelectorAll(sel)].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
  const panel = seen('[data-annotation-anchor]').find((r) => r.left > wrap.left + 200)
  const rail = seen('.pv-rail')[0]
  const nav = seen('.pv-nav, .pv-sitenav')[0]
  const bounds = {
    l: 12,
    t: Math.max(12, nav ? nav.bottom - wrap.top + 8 : 12),
    r: (panel ? Math.min(wrap.right, panel.left) : wrap.right) - wrap.left - 12,
    b: (rail ? Math.min(wrap.bottom, rail.top) : wrap.bottom) - wrap.top - 12,
  }
  const avoid = [...document.querySelectorAll('.project03 .data-legend, .project03 .inspect-card, .learn-card.guide03, .pv-photo-bar')].filter((el) => el !== self).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0).map(rel)
  return { bounds, avoid }
}

/** Where a box of w × h goes beside a point: the side (of four) that stays in bounds and covers the least of what it must avoid. */
export function placeBeside(px: number, py: number, w: number, h: number, room: ReturnType<typeof overlayRoom>, gap = 16): [number, number] {
  const { bounds: B, avoid } = room
  const options: [number, number][] = [
    [px + gap, py + gap],
    [px - gap - w, py + gap],
    [px + gap, py - gap - h],
    [px - gap - w, py - gap - h],
  ]
  let best: [number, number] = options[0]!
  let bestCost = Infinity
  options.forEach(([x0, y0], i) => {
    const x = Math.max(B.l, Math.min(B.r - w, x0))
    const y = Math.max(B.t, Math.min(B.b - h, y0))
    // Covered: what it overlaps of the things to keep clear, and of its own pointer (it must never hide what is read).
    let cost = i * 0.5
    for (const a of avoid) cost += Math.max(0, Math.min(x + w, a.r) - Math.max(x, a.l)) * Math.max(0, Math.min(y + h, a.b) - Math.max(y, a.t))
    if (px > x - 4 && px < x + w + 4 && py > y - 4 && py < y + h + 4) cost += 1e6
    if (cost < bestCost) {
      bestCost = cost
      best = [x, y]
    }
  })
  return best
}

/** What the pointer is over, beside it: on the side that stays clear of the lens panel, the rail, the legend and any card. */
export function DataTooltip() {
  const now = useInspect()
  const open = useCard()
  const el = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const box = el.current
    const wrap = box?.offsetParent as HTMLElement | null
    if (!box || !wrap || !now) return
    const [x, y] = placeBeside(now.sx, now.sy, box.offsetWidth, box.offsetHeight, overlayRoom(wrap.getBoundingClientRect()))
    box.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    box.style.visibility = 'visible'
  })
  // (Hidden while a pinned card is open, so there is one readout on screen at a time.)
  if (!now || open) return null
  return (
    <div ref={el} className="organism-card data-tip" style={{ visibility: 'hidden' }} role="status" aria-live="polite">
      <div className="organism-card-head">
        <span className="organism-card-title">{now.title}</span>
        {now.tag ? <span className="organism-card-stage">{now.tag}</span> : null}
      </div>
      {now.rows.length ? (
        <dl className="organism-card-rows">
          {/* Concise while hovering: the first two readings; a click keeps the whole reading. */}
          {now.rows.slice(0, 2).map(([k, v]) => (
            <div key={k} className="organism-card-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

/** A short label for the section's status when a data view is on. */
export const exploreStatus = (view: DiagView) => DIAG_VIEWS.find((v) => v.value === view)?.label ?? ''
