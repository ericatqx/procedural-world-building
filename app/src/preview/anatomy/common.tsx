import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react'
import { LANDSCAPE, islandRadius, landscapeHeight } from '../../project03/terrain.ts'
import { sunAt } from '../../project/sun.ts'

/**
 * WORLD ANATOMY's shared pieces: a plan of the island (a plain hill shade of the world's own height function, the sea left empty) that each
 * inspection draws its own data over, and a hook that waits for a piece of the live world (its data are built as the world loads).
 * Everything here reads; nothing generates or changes the world.
 */
export const HALF = LANDSCAPE.size / 2
const N = 180
let relief: HTMLCanvasElement | null = null

/** The hill shade, built once per page (the height function is the seed's). */
export function islandRelief(): HTMLCanvasElement {
  if (relief) return relief
  const h = new Float32Array(N * N)
  const land = new Uint8Array(N * N)
  for (let j = 0; j < N; j += 1)
    for (let i = 0; i < N; i += 1) {
      const x = -HALF + ((i + 0.5) / N) * LANDSCAPE.size
      const z = -HALF + ((j + 0.5) / N) * LANDSCAPE.size
      h[j * N + i] = landscapeHeight(x, z)
      land[j * N + i] = Math.hypot(x, z) < islandRadius(Math.atan2(z, x)) ? 1 : 0
    }
  const c = document.createElement('canvas')
  c.width = N
  c.height = N
  const g = c.getContext('2d')!
  const img = g.createImageData(N, N)
  const cell = LANDSCAPE.size / N
  for (let j = 0; j < N; j += 1)
    for (let i = 0; i < N; i += 1) {
      const k = j * N + i
      if (!land[k]) continue
      const dx = (h[j * N + Math.min(N - 1, i + 1)]! - h[j * N + Math.max(0, i - 1)]!) / (2 * cell)
      const dz = (h[Math.min(N - 1, j + 1) * N + i]! - h[Math.max(0, j - 1) * N + i]!) / (2 * cell)
      const shade = Math.max(0, Math.min(1, 0.62 + (-dx * 0.7 - dz * 0.7) * 1.6))
      const v = 46 + shade * 70
      img.data.set([v, v, v * 0.98, 255], k * 4)
    }
  g.putImageData(img, 0, 0)
  relief = c
  return c
}

export type Plan = { size: number; px: (w: number) => number; world: (p: number) => number; k: number }
export const planOf = (size: number, span = LANDSCAPE.size, centre: [number, number] = [0, 0]): Plan & { cx: number; cz: number } => {
  const k = size / span
  return { size, k, px: (w: number) => (w + span / 2) * k, world: (p: number) => p / k - span / 2, cx: centre[0], cz: centre[1] }
}

/**
 * A canvas of the island in plan: `draw` paints over the relief (in world metres through `plan.px`); a click or the pointer reports a world
 * position. Redrawn when `deps` change.
 */
export function PlanCanvas({
  size = 340,
  draw,
  deps,
  onPick,
  onHover,
  background = true,
  label,
}: {
  size?: number
  draw: (g: CanvasRenderingContext2D, plan: Plan) => void
  deps: unknown[]
  onPick?: (x: number, z: number) => void
  onHover?: (x: number, z: number) => void
  background?: boolean
  label: string
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const plan = planOf(size)
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    el.width = size * dpr
    el.height = size * dpr
    const g = el.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, size, size)
    if (background) {
      g.imageSmoothingEnabled = true
      g.drawImage(islandRelief(), 0, 0, size, size)
    }
    draw(g, plan)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  const at = (e: ReactMouseEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect()
    return [plan.world(((e.clientX - r.left) / r.width) * size), plan.world(((e.clientY - r.top) / r.height) * size)]
  }
  return (
    <canvas
      ref={canvas}
      className="pv-an-canvas"
      style={{ width: size, height: size, cursor: onPick ? 'crosshair' : undefined }}
      aria-label={label}
      onClick={onPick ? (e) => onPick(...at(e)) : undefined}
      onPointerMove={onHover ? (e) => onHover(...at(e)) : undefined}
    />
  )
}

/** A piece of the live world, once it exists (polled while the world loads). */
export function useLive<T>(read: () => T | null): T | null {
  const [value, setValue] = useState<T | null>(read)
  useEffect(() => {
    if (value) return
    const id = window.setInterval(() => {
      const v = read()
      if (v) setValue(() => v)
    }, 500)
    return () => window.clearInterval(id)
  }, [value, read])
  return value
}

/** An inspection's notes: what the rule is, how the data are held, and what the reader can do. */
/**
 * Every exhibit's spine, across its top: what goes in, what the procedure does with it, and what comes out, each a few words (with live values
 * where there are any), numbered and joined by arrows. The diagram below shows the same three, marked the same way.
 */
export function Flow({ input, process, result }: { input: ReactNode; process: ReactNode; result: ReactNode }) {
  return (
    <ol className="pv-an-flow" aria-label="Input, process, result">
      <li>
        <span className="pv-an-flow-k">Input</span>
        <span className="pv-an-flow-v">{input}</span>
      </li>
      <li aria-hidden className="pv-an-flow-arrow">→</li>
      <li>
        <span className="pv-an-flow-k">Process</span>
        <span className="pv-an-flow-v">{process}</span>
      </li>
      <li aria-hidden className="pv-an-flow-arrow">→</li>
      <li data-result>
        <span className="pv-an-flow-k">Result</span>
        <span className="pv-an-flow-v">{result}</span>
      </li>
    </ol>
  )
}

/** The exhibit's side column: its question, then what the reader is pointing at (and any small map). */
export function Notes({ question, children }: { question?: string; rule?: ReactNode; data?: ReactNode; children?: ReactNode }) {
  return (
    <div className="pv-an-notes">
      {question ? <p className="pv-an-question">{question}</p> : null}
      {children}
    </div>
  )
}

export function Readout({ rows, title }: { rows: [string, ReactNode][]; title?: ReactNode }) {
  return (
    <div className="pv-an-readout">
      {title ? <p className="pv-an-readout-title">{title}</p> : null}
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function Waiting({ what }: { what: string }) {
  return <p className="pv-an-waiting">Waiting for the {what}…</p>
}

export const fmt = (v: number, d = 0) => v.toFixed(d)
export const pct = (v: number) => `${Math.round(v * 100)}%`
/** The site's colours, as the canvases need them (preview.css tokens). */
export const INK = { line: 'rgba(233, 230, 223, 0.85)', faint: 'rgba(233, 230, 223, 0.28)', mute: 'rgba(233, 230, 223, 0.55)', signal: '#FF1F1F', teal: '#3E7A7B', tealLight: '#9CC0BC', moss: '#7C9460', olive: '#9D9B62' }

/** The width a stage has to draw in (its container's, capped), kept current as the window changes. */
export function useWidth(max: number): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(max)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const take = () => setW(Math.max(280, Math.min(max, Math.floor(el.getBoundingClientRect().width))))
    take()
    const ro = new ResizeObserver(take)
    ro.observe(el)
    return () => ro.disconnect()
  }, [max])
  return [ref, w]
}

/** A row of mutually exclusive choices; `step` numbers them (a sequence the reader walks through). */
export function Seg<T extends string>({ items, value, onChange, label, step }: { items: { key: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string; step?: boolean }) {
  return (
    <div className="pv-ex-seg" role="group" aria-label={label} data-step={step || undefined}>
      {items.map((it, i) => (
        <button key={it.key} type="button" aria-pressed={it.key === value} onClick={() => onChange(it.key)}>
          {step ? <span>{i + 1}</span> : null}
          {it.label}
        </button>
      ))}
    </div>
  )
}

/**
 * EVERY EXHIBIT'S LAYOUT. One control row; one large stage (the exhibit's single visualization, with its legend under it) and, beside it where
 * the exhibit needs one, a narrow column for what the reader is pointing at; then the causal chain, read left to right: what goes in, the rule,
 * what comes out, each a sentence about what is on the stage now.
 */
export function Exhibit({ controls, stage, legend, aside, chain }: { controls?: ReactNode; stage: ReactNode; legend?: ReactNode; aside?: ReactNode; chain: { input: ReactNode; rule: ReactNode; result: ReactNode } }) {
  return (
    <div className="pv-ex">
      {controls ? <div className="pv-ex-controls">{controls}</div> : null}
      <div className="pv-ex-body" data-aside={aside ? true : undefined}>
        <div className="pv-ex-stage">
          {stage}
          {legend ? <p className="pv-ex-legend">{legend}</p> : null}
        </div>
        {aside ? <aside className="pv-ex-aside">{aside}</aside> : null}
      </div>
      <ol className="pv-ex-chain" aria-label="Input, rule, result">
        <li>
          <span>Input</span>
          <p>{chain.input}</p>
        </li>
        <li>
          <span>Rule</span>
          <p>{chain.rule}</p>
        </li>
        <li data-result>
          <span>Result</span>
          <p>{chain.result}</p>
        </li>
      </ol>
    </div>
  )
}

/** A legend entry: a swatch (any CSS background, or a line) and its words. */
export function Key({ swatch, line, children }: { swatch?: string; line?: string; children: ReactNode }) {
  return (
    <span className="pv-ex-key">
      <i style={line ? { borderTop: `2px ${line.includes('dash') ? 'dashed' : 'solid'} ${line.replace('dash ', '')}`, height: 0, background: 'none' } : { background: swatch }} />
      {children}
    </span>
  )
}

/** Hill-shading of a height grid (n × n, `cell` metres apart; NaN = sea), lit from the north-west, toned light-high. */
export function hillshade(h: Float32Array, n: number, cell: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = n
  c.height = n
  const g = c.getContext('2d')!
  const img = g.createImageData(n, n)
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i
      const v = h[k]!
      if (Number.isNaN(v)) continue
      const e = h[Math.min(n - 1, i + 1) + j * n]!
      const w = h[Math.max(0, i - 1) + j * n]!
      const s = h[i + Math.min(n - 1, j + 1) * n]!
      const nn = h[i + Math.max(0, j - 1) * n]!
      const dx = ((Number.isNaN(e) ? v : e) - (Number.isNaN(w) ? v : w)) / (2 * cell)
      const dz = ((Number.isNaN(s) ? v : s) - (Number.isNaN(nn) ? v : nn)) / (2 * cell)
      const lit = Math.max(0, Math.min(1, 0.62 - (dx + dz) * 1.6))
      const l = 26 + Math.min(1, Math.max(0, v / 460)) * 60 + lit * 70
      // (Toned to the island's sandstone, the World's ground colour, rather than a neutral grey.)
      img.data.set([l, l * 0.92, l * 0.78, 255], k * 4)
    }
  g.putImageData(img, 0, 0)
  return c
}

/**
 * A STRUCTURE'S SHADE, ESTIMATED (for the exhibits, where the world has not yet worked out the real shade: it does so only around structures it has
 * drawn close). The structure's roof taken as a disc of its radius at four fifths of its height, projected along the island's sun from 7:00 to 18:00:
 * the share of those hours each point lies in that projected disc. Deterministic and labelled as an estimate; never mixed with measured shade.
 */
const EST_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
let estSuns: [number, number, number][] | null = null
export function estimatedShade(o: { x: number; z: number; radius: number; height: number }, x: number, z: number): number {
  estSuns ??= EST_HOURS.map((h) => sunAt(h, 55).direction).filter((d) => d[1] > 0.06)
  const roof = o.height * 0.8
  const r = o.radius * 0.9
  let n = 0
  for (const d of estSuns) {
    // Where the roof's shadow falls on level ground: the roof's centre moved away from the sun by roof height × (horizontal / vertical).
    const sx = o.x - (d[0] / d[1]) * roof
    const sz = o.z - (d[2] / d[1]) * roof
    if (Math.hypot(x - sx, z - sz) < r) n += 1
  }
  return n / estSuns.length
}
