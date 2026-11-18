import { useEffect, useMemo, useRef, useState } from 'react'
import { archGround, archShade } from '../../project03/archGround.ts'
import type { OrganismPlan } from '../../project03/livingEcology.ts'
import { currentPopulation } from '../../project03/livingSelection.ts'
import { LIFECYCLE } from '../../project03/livingTime.ts'
import { sunAt } from '../../project/sun.ts'
import { landscapeHeight } from '../../project03/terrain.ts'
import { Exhibit, INK, Key, Waiting, estimatedShade, fmt, pct, useLive } from './common.tsx'

/**
 * LIVING ARCHITECTURE — why does this structure take this form, and what does its form do? Two halves of one story, side by side:
 *   LEFT, what it does: one real structure in plan, large: its footprint as the world stamped it from its own mesh (archGround.ts) and the shade
 *   it keeps on the ground over the whole day (archShade.ts, the same data the plants and animals under it read), with the afternoon sun.
 *   RIGHT, why it is so: the habitat where it germinated (four readings) and the rule that turns them into its form (livingEcology.ts ›
 *   formFromHabitat, its terms exactly as written), each part of the form with the terms that raised or lowered it, in words and numbers.
 */
type In = 'light' | 'resource' | 'exposure' | 'crowding'
type Out = 'keep' | 'reach' | 'spread' | 'shelfLift'
const TERMS: { from: In; to: Out; w: number }[] = [
  { from: 'light', to: 'keep', w: 0.55 },
  { from: 'resource', to: 'keep', w: 0.7 },
  { from: 'exposure', to: 'keep', w: -0.18 },
  { from: 'crowding', to: 'keep', w: -0.28 },
  { from: 'light', to: 'reach', w: 0.45 },
  { from: 'resource', to: 'reach', w: 0.4 },
  { from: 'crowding', to: 'reach', w: -0.5 },
  { from: 'exposure', to: 'spread', w: 0.3 },
  { from: 'crowding', to: 'spread', w: 0.35 },
  { from: 'light', to: 'shelfLift', w: 0.5 },
  { from: 'crowding', to: 'shelfLift', w: -0.3 },
]
const INPUTS: { key: In; label: string; low: string; high: string }[] = [
  { key: 'light', label: 'Light', low: 'darker than the island’s average', high: 'brighter than the island’s average' },
  { key: 'resource', label: 'Soil and water', low: 'poor', high: 'rich' },
  { key: 'exposure', label: 'Exposure', low: 'in a hollow', high: 'on a rise' },
  { key: 'crowding', label: 'Crowding', low: 'alone', high: 'crowded by neighbours' },
]
const OUTPUTS: { key: Out; label: string; says: string }[] = [
  { key: 'keep', label: 'Tower', says: 'how tall it rises' },
  { key: 'reach', label: 'Overhang', says: 'how far its roof reaches out' },
  { key: 'spread', label: 'Base', says: 'how broad and low it sits' },
  { key: 'shelfLift', label: 'Shelf height', says: 'how high the roof is held' },
]
const WORD: Record<In, string> = { light: 'light', resource: 'soil', exposure: 'exposure', crowding: 'crowding' }

/** The world's footprint and shade rasters (4 m texels over the island) around a point. */
function raster(x: number, z: number, R: number) {
  const fp = archGround.texture.value.image as { data: Uint8Array; width: number }
  const sh = archShade.texture.value.image as { data: Uint8Array; width: number }
  const n = fp.width
  const cell = 4096 / n
  const read = (img: { data: Uint8Array; width: number }, stride: number, ch: number, wx: number, wz: number) => {
    const i = Math.floor((wx + 2048) / cell)
    const j = Math.floor((wz + 2048) / cell)
    if (i < 0 || j < 0 || i >= n || j >= n || !img.data) return 0
    return img.data[(j * n + i) * stride + ch]! / 255
  }
  const out: { x: number; z: number; foot: number; shade: number; h: number }[] = []
  for (let wz = z - R; wz < z + R; wz += cell)
    for (let wx = x - R; wx < x + R; wx += cell) out.push({ x: wx, z: wz, foot: read(fp, 1, 0, wx, wz), shade: Math.max(read(sh, 2, 0, wx, wz), read(sh, 2, 1, wx, wz)), h: landscapeHeight(wx, wz) })
  return { cells: out, cell }
}

const P = 440

export function ArchitectureInspection() {
  const pop = useLive(currentPopulation)
  // The structures alive at the reference year: those whose footprint and shade the world has already worked out first (it does so only for the ones it
  // has drawn close: Formation's, and wherever Explore has been), then the rest; the largest first within each.
  const choices = useMemo(() => {
    if (!pop) return []
    const alive = pop.organisms.filter((o) => o.established <= LIFECYCLE.reference && (o.died < 0 || o.died > LIFECYCLE.reference))
    const known = (o: OrganismPlan) => raster(o.x, o.z, o.radius * 0.6).cells.some((c) => c.foot > 0.25)
    const size = (o: OrganismPlan) => o.height * o.radius
    return alive.map((o) => ({ o, k: known(o) })).sort((a, b) => Number(b.k) - Number(a.k) || size(b.o) - size(a.o)).map((x) => x.o)
  }, [pop])
  const [pick, setPick] = useState(0)
  const o: OrganismPlan | undefined = choices[pick]
  const meanLight = useMemo(() => (pop ? pop.organisms.reduce((a, m) => a + m.base.light, 0) / Math.max(1, pop.organisms.length) : 0.5), [pop])
  const R = o ? Math.max(90, o.radius * 2.6) : 120
  // The measured footprint and shade where the world has worked them out; elsewhere an ESTIMATE from its size and the day's sun (common.tsx ›
  // estimatedShade), said to be one, so the exhibit is never empty and never presents an estimate as a measurement.
  const plan = useMemo(() => {
    if (!o) return null
    const r = raster(o.x, o.z, R)
    if (r.cells.some((c) => c.foot > 0.25)) return { ...r, estimated: false }
    return { cell: r.cell, estimated: true, cells: r.cells.map((c) => ({ ...c, foot: Math.hypot(c.x - o.x, c.z - o.z) < o.radius * 0.4 ? 1 : 0, shade: estimatedShade(o, c.x, c.z) })) }
  }, [o, R])
  const canvas = useRef<HTMLCanvasElement>(null)
  const sun = useMemo(() => sunAt(15.3, 55).direction, [])

  useEffect(() => {
    const el = canvas.current
    if (!el || !o || !plan) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    el.width = P * dpr
    el.height = P * dpr
    const g = el.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, P, P)
    const k = P / (2 * R)
    const hs = plan.cells.map((c) => c.h)
    const lo = Math.min(...hs)
    const hi = Math.max(...hs)
    for (const c of plan.cells) {
      const x = (c.x - (o.x - R)) * k
      const y = (c.z - (o.z - R)) * k
      const w = plan.cell * k + 0.6
      const l = Math.round(34 + ((c.h - lo) / Math.max(1, hi - lo)) * 46)
      g.fillStyle = `rgb(${l}, ${l}, ${l})`
      g.fillRect(x, y, w, w)
      if (c.shade > 0.03) {
        g.fillStyle = `rgba(108, 100, 153, ${(0.25 + 0.7 * c.shade).toFixed(3)})`
        g.fillRect(x, y, w, w)
      }
      if (c.foot > 0.25) {
        g.fillStyle = `rgba(243, 239, 229, ${Math.min(1, 0.4 + c.foot * 0.6).toFixed(3)})`
        g.fillRect(x, y, w, w)
      }
    }
    if (plan.estimated) {
      g.fillStyle = INK.mute
      g.font = '11px ui-monospace, monospace'
      g.fillText('ESTIMATED FROM ITS SIZE · NOT YET MEASURED', 16, 22)
    }
    // The afternoon sun: its direction, from the edge toward the structure.
    const sl = Math.hypot(sun[0], sun[2]) || 1
    const ux = sun[0] / sl
    const uz = sun[2] / sl
    g.strokeStyle = '#F2E4C4'
    g.fillStyle = '#F2E4C4'
    g.lineWidth = 1.5
    g.beginPath()
    g.moveTo(P / 2 + ux * (P / 2 - 18), P / 2 + uz * (P / 2 - 18))
    g.lineTo(P / 2 + ux * (P / 2 - 70), P / 2 + uz * (P / 2 - 70))
    g.stroke()
    g.beginPath()
    g.arc(P / 2 + ux * (P / 2 - 18), P / 2 + uz * (P / 2 - 18), 6, 0, Math.PI * 2)
    g.fill()
    g.font = '10px ui-monospace, monospace'
    g.fillText('SUN, 15:20', Math.min(P - 70, Math.max(6, P / 2 + ux * (P / 2 - 18) - 30)), Math.min(P - 6, Math.max(14, P / 2 + uz * (P / 2 - 18) + (uz > 0 ? -12 : 20))))
    // Scale: 50 m.
    g.fillStyle = INK.line
    g.fillRect(16, P - 20, 50 * k, 2)
    g.fillText('50 m', 16, P - 26)
  }, [o, plan, R, sun])

  if (!pop || !o || !plan) return <Waiting what="population" />
  const f = o.form as Record<string, number | boolean | undefined>
  const inputs: Record<In, number> = {
    light: Math.max(-1, Math.min(1, (o.base.light - meanLight) / 0.25)),
    resource: o.base.resource - 0.45,
    exposure: o.ridge,
    crowding: o.crowding,
  }
  const shadeSeen = plan.cells.some((c) => c.shade > 0.03)
  const lasting = plan.cells.filter((c) => c.shade > 0.5 && c.foot < 0.25).length * plan.cell * plan.cell
  const value = (key: Out) => Number(f[key] ?? 1)
  const ranked = OUTPUTS.map((x) => ({ ...x, v: value(x.key) }))
  const biggest = ranked.reduce((a, b) => (Math.abs(b.v - 1) > Math.abs(a.v - 1) ? b : a))
  const lead = (key: Out) =>
    TERMS.filter((t) => t.to === key)
      .map((t) => ({ t, c: t.w * inputs[t.from] }))
      .sort((a, b) => Math.abs(b.c) - Math.abs(a.c))[0]
  const bl = lead(biggest.key)
  return (
    <Exhibit
      controls={
        <div className="pv-an-chooser" role="group" aria-label="Structure">
          <button type="button" onClick={() => setPick((p) => (p + choices.length - 1) % choices.length)} aria-label="Previous structure">
            ←
          </button>
          <span className="pv-an-chooser-name">
            Structure {pick + 1} of {choices.length} <em>{plan.estimated ? '· shade estimated ' : '· shade measured '}· {fmt(o.height)} m tall · {fmt(o.radius * 2)} m across · germinated in year {o.established}</em>
          </span>
          <button type="button" onClick={() => setPick((p) => (p + 1) % choices.length)} aria-label="Next structure">
            →
          </button>
        </div>
      }
      stage={
        <div className="pv-ex-split" data-even>
          <figure className="pv-ex-fig">
            <canvas ref={canvas} className="pv-an-canvas" style={{ width: P, height: P }} aria-label="The structure in plan: its footprint and the shade it keeps over the day" />
            <figcaption>
              {plan.estimated
                ? `Seen from above, estimated: its roof taken as a disc at four fifths of its height, its shadow swept with the sun from 7:00 to 18:00. About ${Math.round(lasting / 100) * 100} m² stays shaded more than half the day. (The world measures the real shade from the structure's own form once it has been seen close.)`
                : `Seen from above, measured from its own form: over a whole day it keeps about ${Math.round(lasting / 100) * 100} m² of ground in lasting shade (more than half the day).`}
            </figcaption>
          </figure>
          <div className="pv-ex-rule">
            <p className="pv-ex-aside-k">Where it germinated</p>
            <ul className="pv-ex-inputs">
              {INPUTS.map((x) => {
                const v = inputs[x.key]
                return (
                  <li key={x.key}>
                    <span>{x.label}</span>
                    <i className="pv-ex-dial" aria-hidden>
                      <b style={{ left: v >= 0 ? '50%' : `${50 + v * 50}%`, width: `${Math.min(50, Math.abs(v) * 50)}%` }} />
                    </i>
                    <em>{Math.abs(v) < 0.08 ? 'typical' : v > 0 ? x.high : x.low}</em>
                  </li>
                )
              })}
            </ul>
            <p className="pv-ex-aside-k">So it grew</p>
            <ul className="pv-ex-outputs">
              {ranked.map((x) => {
                const parts = TERMS.filter((t) => t.to === x.key)
                  .map((t) => ({ from: t.from, c: t.w * inputs[t.from] }))
                  .filter((p) => Math.abs(p.c) >= 0.02)
                  .sort((a, b) => Math.abs(b.c) - Math.abs(a.c))
                return (
                  <li key={x.key}>
                    <span>
                      {x.label} <em>{x.says}</em>
                    </span>
                    <b data-up={x.v > 1.02 || undefined} data-down={x.v < 0.98 || undefined}>
                      ×{fmt(x.v, 2)}
                    </b>
                    <p>
                      {parts.length
                        ? parts.map((p) => (
                            <i key={p.from} data-up={p.c > 0 || undefined}>
                              {p.c > 0 ? '▲' : '▼'} {WORD[p.from]}
                            </i>
                          ))
                        : 'as typical'}
                    </p>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      }
      legend={
        <>
          <Key swatch="#F3EFE5">footprint (from its own mesh)</Key>
          <Key swatch="#6C6499">shade over the day: deeper where it lasts longer</Key>
          <Key swatch="#F2E4C4">afternoon sun</Key>
          <Key swatch={INK.signal}>▲ raised · ▼ lowered by</Key>
        </>
      }
      chain={{
        input: <>Light {pct(o.base.light)} of the day’s sun, soil and water {pct(o.base.resource)}, {o.crowding > 0.2 ? 'crowded' : 'little crowded'}, {o.ridge > 0.2 ? 'on a rise' : o.ridge < -0.2 ? 'in a hollow' : 'on even ground'}.</>,
        rule: 'Light and rich soil raise a taller tower and a longer overhang; crowding and exposure hold it lower and broader.',
        result: <>Its {biggest.label.toLowerCase()} most of all (×{fmt(biggest.v, 2)}){bl ? `, mainly from ${WORD[bl.t.from]}` : ''}. Its form decides its shade{shadeSeen ? `, about ${Math.round(lasting / 100) * 100} m² that lasts` : ''}, and the shade decides what lives beneath it.</>,
      }}
    />
  )
}
