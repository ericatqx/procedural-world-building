import { useEffect, useMemo, useRef, useState } from 'react'
import { LANDSCAPE, islandRadius, terrainBreakdown } from '../../project03/terrain.ts'
import { Exhibit, HALF, INK, Key, Seg, fmt, hillshade, useWidth } from './common.tsx'

/**
 * TERRAIN — why does the island have this shape? The height is a sum of five noise layers, largest first (terrain.ts). The exhibit builds it up
 * one layer at a time, along a line across the real island (A to B) and over the whole island in plan: each step shows the ground as it stands
 * with the layers so far, and, in red, exactly what the newest layer changed. The values are the world's own (terrain.ts › terrainBreakdown, the
 * same evaluation as the height function). Light is left out here on purpose: it is a result of this shape, shown where it acts (water, plants,
 * structures, creatures).
 */
type Step = 'massifs' | 'ridges' | 'hills' | 'drainage' | 'grain'
const STEPS: { key: Step; name: string; does: string; noise: string }[] = [
  { key: 'massifs', name: 'Massifs', does: 'Raises a few broad mountain masses, each its own height and width, on a low basement.', noise: 'a handful of soft-edged ellipses, warped by broad noise' },
  { key: 'ridges', name: 'Ridges', does: 'Carves branching spines and the gullies between them into the massifs’ flanks.', noise: 'ridged noise, cut into the mountains only' },
  { key: 'hills', name: 'Hills', does: 'Rolls the lower ground into foothills, strongest where the mountains fall away.', noise: 'layered (fractal) noise at a middle scale' },
  { key: 'drainage', name: 'Drainage', does: 'Cuts branching valleys into the lowland: the lines the water will later follow. Calm hollows sink into basins.', noise: 'a second ridged field, cut downward' },
  { key: 'grain', name: 'Grain', does: 'Adds a few metres of surface texture.', noise: 'fine fractal noise' },
]
const upTo = (b: ReturnType<typeof terrainBreakdown>, k: number) => {
  let h = b.base + b.massifs
  if (k >= 1) h += b.ridges
  if (k >= 2) h += b.hills
  if (k >= 3) h += b.drainage
  if (k >= 4) h += b.grain
  return h
}

/** The island in plan at each step (hill-shaded), built once per page. */
const N = 150
let plans: HTMLCanvasElement[] | null = null
function planAt(k: number): HTMLCanvasElement {
  if (!plans) {
    const grids = STEPS.map(() => new Float32Array(N * N))
    const cell = LANDSCAPE.size / N
    for (let j = 0; j < N; j += 1)
      for (let i = 0; i < N; i += 1) {
        const x = -HALF + (i + 0.5) * cell
        const z = -HALF + (j + 0.5) * cell
        const land = Math.hypot(x, z) < islandRadius(Math.atan2(z, x))
        const b = land ? terrainBreakdown(x, z) : null
        grids.forEach((g, s) => (g[j * N + i] = b ? upTo(b, s) : NaN))
      }
    plans = grids.map((g) => hillshade(g, N, cell))
  }
  return plans[k]!
}

const SPAN = 1500
const H = 360
const MAP = 300

export function TerrainInspection() {
  const [step, setStep] = useState<Step>('massifs')
  const [z, setZ] = useState(140)
  const [hover, setHover] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const k = STEPS.findIndex((s) => s.key === step)
  const [wrap, width] = useWidth(1120 - MAP - 40)
  const W = width

  // Walking through the five, one every two seconds, once.
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      setStep((s) => {
        const i = STEPS.findIndex((x) => x.key === s)
        if (i >= STEPS.length - 1) {
          setPlaying(false)
          return s
        }
        return STEPS[i + 1]!.key
      })
    }, 2000)
    return () => window.clearInterval(id)
  }, [playing])

  const line = useMemo(() => {
    const xs: number[] = []
    const parts: (ReturnType<typeof terrainBreakdown> | null)[] = []
    for (let x = -SPAN; x <= SPAN; x += 6) {
      xs.push(x)
      parts.push(Math.hypot(x, z) < islandRadius(Math.atan2(z, x)) ? { ...terrainBreakdown(x, z) } : null)
    }
    return { xs, parts }
  }, [z])

  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    el.width = W * dpr
    el.height = H * dpr
    const g = el.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, H)
    const now = line.parts.map((b) => (b ? upTo(b, k) : NaN))
    const before = line.parts.map((b) => (b ? (k ? upTo(b, k - 1) : b.base) : NaN))
    const full = line.parts.map((b) => (b ? upTo(b, 4) : NaN))
    const top = Math.max(120, ...full.filter((v) => !Number.isNaN(v)), ...now.filter((v) => !Number.isNaN(v))) * 1.08
    const X = (i: number) => 40 + (i / (line.xs.length - 1)) * (W - 64)
    const base = H - 36
    const Y = (v: number) => base - (v / top) * (base - 24)
    // Height marks.
    g.font = '10px ui-monospace, monospace'
    g.fillStyle = INK.mute
    g.strokeStyle = 'rgba(233, 230, 223, 0.08)'
    for (let m = 100; m < top; m += 100) {
      g.beginPath()
      g.moveTo(40, Y(m))
      g.lineTo(W - 24, Y(m))
      g.stroke()
      g.fillText(`${m}`, 6, Y(m) + 3)
    }
    const runs: number[][] = []
    let run: number[] = []
    now.forEach((v, i) => {
      if (Number.isNaN(v)) {
        if (run.length) runs.push(run)
        run = []
      } else run.push(i)
    })
    if (run.length) runs.push(run)
    for (const r of runs) {
      // The ground as it stands with the layers so far.
      g.fillStyle = 'rgba(215, 194, 155, 0.24)'
      g.beginPath()
      g.moveTo(X(r[0]!), Y(0))
      for (const i of r) g.lineTo(X(i), Y(now[i]!))
      g.lineTo(X(r[r.length - 1]!), Y(0))
      g.fill()
      // What the newest layer changed: the band between before and now, in red.
      g.fillStyle = 'rgba(255, 31, 31, 0.42)'
      g.beginPath()
      r.forEach((i, n) => (n ? g.lineTo(X(i), Y(now[i]!)) : g.moveTo(X(i), Y(now[i]!))))
      for (let n = r.length - 1; n >= 0; n -= 1) g.lineTo(X(r[n]!), Y(before[r[n]!]!))
      g.closePath()
      g.fill()
      g.strokeStyle = INK.line
      g.lineWidth = 1.4
      g.beginPath()
      r.forEach((i, n) => (n ? g.lineTo(X(i), Y(now[i]!)) : g.moveTo(X(i), Y(now[i]!))))
      g.stroke()
      // The finished island, faint, for where this is going.
      if (k < 4) {
        g.strokeStyle = 'rgba(233, 230, 223, 0.28)'
        g.setLineDash([2, 3])
        g.lineWidth = 1
        g.beginPath()
        r.forEach((i, n) => (n ? g.lineTo(X(i), Y(full[i]!)) : g.moveTo(X(i), Y(full[i]!))))
        g.stroke()
        g.setLineDash([])
      }
    }
    g.strokeStyle = 'rgba(62, 122, 123, 0.9)'
    g.setLineDash([4, 4])
    g.beginPath()
    g.moveTo(40, Y(0))
    g.lineTo(W - 24, Y(0))
    g.stroke()
    g.setLineDash([])
    g.fillStyle = INK.signal
    g.font = '12px ui-monospace, monospace'
    g.fillText('A', 26, Y(0) + 18)
    g.fillText('B', W - 30, Y(0) + 18)
    if (hover !== null) {
      g.strokeStyle = 'rgba(233, 230, 223, 0.55)'
      g.beginPath()
      g.moveTo(X(hover), 16)
      g.lineTo(X(hover), base)
      g.stroke()
    }
  }, [line, k, hover, W])

  const s = STEPS[k]!
  const at = hover ?? null
  const b = at !== null ? line.parts[at] : null
  // What this layer did along the whole line: its largest raise and cut.
  const delta = line.parts.filter(Boolean).map((p) => [p!.massifs, p!.ridges, p!.hills, p!.drainage, p!.grain][k]!)
  const most = delta.length ? Math.max(...delta) : 0
  const least = delta.length ? Math.min(...delta) : 0
  return (
    <Exhibit
      controls={
        <>
          <Seg label="Layers summed so far" step items={STEPS.map((x) => ({ key: x.key, label: x.name }))} value={step} onChange={(v) => { setPlaying(false); setStep(v) }} />
          <button type="button" className="pv-ex-play" onClick={() => { setStep('massifs'); setPlaying(true) }} aria-pressed={playing}>
            {playing ? 'Building…' : '▶ Build it up'}
          </button>
        </>
      }
      stage={
        <div className="pv-ex-split">
          <div ref={wrap} className="pv-ex-fill">
            <canvas
              ref={canvas}
              className="pv-an-canvas"
              style={{ width: W, height: H }}
              aria-label={`The island in section from A to B with layers 1 to ${k + 1}; in red, what ${s.name.toLowerCase()} changed`}
              onPointerMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                const t = (e.clientX - r.left - 40) / (r.width - 64)
                setHover(t >= 0 && t <= 1 ? Math.round(t * (line.xs.length - 1)) : null)
              }}
              onPointerLeave={() => setHover(null)}
            />
            <p className="pv-ex-hover" data-on={b ? true : undefined}>
              {b
                ? `Here: ${fmt(b.base + b.massifs)} m massif and basement · ${b.ridges >= 0 ? '+' : ''}${fmt(b.ridges)} ridges · ${b.hills >= 0 ? '+' : ''}${fmt(b.hills)} hills · ${fmt(b.drainage)} drainage · ${b.grain >= 0 ? '+' : ''}${fmt(b.grain)} grain = ${fmt(upTo(b, 4))} m`
                : 'Point along the section to take the height apart.'}
            </p>
          </div>
          <figure className="pv-ex-map">
            <canvas
              className="pv-an-canvas"
              style={{ width: MAP, height: MAP, cursor: 'crosshair' }}
              aria-label="The island in plan with the same layers; click to move the line A–B"
              ref={(el) => {
                if (!el) return
                const dpr = Math.min(2, window.devicePixelRatio || 1)
                el.width = MAP * dpr
                el.height = MAP * dpr
                const g = el.getContext('2d')!
                g.setTransform(dpr, 0, 0, dpr, 0, 0)
                g.imageSmoothingEnabled = true
                g.drawImage(planAt(k), 0, 0, MAP, MAP)
                const px = (w: number) => ((w + HALF) / LANDSCAPE.size) * MAP
                g.strokeStyle = INK.signal
                g.lineWidth = 1.5
                g.beginPath()
                g.moveTo(px(-SPAN), px(z))
                g.lineTo(px(SPAN), px(z))
                g.stroke()
                g.fillStyle = INK.signal
                g.font = '11px ui-monospace, monospace'
                g.fillText('A', px(-SPAN) - 12, px(z) + 4)
                g.fillText('B', px(SPAN) + 4, px(z) + 4)
              }}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setZ(Math.round(((e.clientY - r.top) / r.height) * LANDSCAPE.size - HALF))
              }}
            />
            <figcaption>The whole island with layers 1–{k + 1}. Click to move the line A–B.</figcaption>
          </figure>
        </div>
      }
      legend={
        <>
          <Key swatch="rgba(215,194,155,0.5)">the ground with layers 1–{k + 1}</Key>
          <Key swatch="rgba(255,31,31,0.6)">what {s.name.toLowerCase()} changed</Key>
          {k < 4 ? <Key line="dash rgba(233,230,223,0.5)">the finished island</Key> : null}
          <Key line="dash #3E7A7B">sea level</Key>
        </>
      }
      chain={{
        input: <>Layer {k + 1} of 5, {s.name}: {s.noise}.</>,
        rule: s.does,
        result: <>Along this line it {[most > 0.5 ? `raises the ground by up to ${fmt(most)} m` : '', least < -0.5 ? `cuts it by up to ${fmt(-least)} m` : ''].filter(Boolean).join(' and ') || 'changes almost nothing'}. {k < 4 ? 'The faint dashed line is where all five end up.' : 'This is the finished height every other system stands on.'}</>,
      }}
    />
  )
}
