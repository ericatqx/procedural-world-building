import { useEffect, useRef, useState } from 'react'
import { loading } from '../project03/loading.ts'
import { useVegetation } from '../project03/vegStore.ts'

/** How long every part must have been in place before the cover lifts (a part that flickers back restarts it), and the most it waits. */
const SETTLE_MS = 350
const GIVE_UP_MS = 20000

/**
 * THE LOADING SCREEN: the whole page waits behind it, and appears at once when the world is complete: the terrain drawn, the ground's fields
 * built, every plant the view needs standing, and the Living Architecture's first appearance made. Readiness is only read, from what the world
 * reports. While the cover is up the world may build in bigger steps (loading.ts): nothing it draws is seen yet.
 *
 * What it shows is the project's idea in one figure: a structure on bare ground, a sun crossing above it, and the shade it casts moving beneath.
 * The structure grows as the world loads.
 */
export function WorldVeil({ terrainSettled, onDone }: { terrainSettled: boolean; onDone: () => void }) {
  const veg = useVegetation()
  const [architecture, setArchitecture] = useState(false)
  const [plantsSettled, setPlantsSettled] = useState(false)
  const [done, setDone] = useState(false)
  const [gone, setGone] = useState(false)

  // The architecture's reveal and the plants' pending count live in the world's own modules; they are polled, as the world polls them.
  useEffect(() => {
    let live = true
    let id = 0
    import('../project03/LivingArchitecture.tsx').then(({ architectureRevealed }) => {
      if (!live) return
      // The plants count as standing once their Distant shapes are grown and the first tiles are in. The island's full scatter takes much longer
      // to place (tens of seconds); what arrives after the reveal grows in gently instead of appearing at once (loading.ts › growIn).
      let firstTiles = 0
      id = window.setInterval(() => {
        setArchitecture(architectureRevealed())
        if (loading.plantTiles >= 0) firstTiles += 1
        setPlantsSettled(loading.plantsPending === 0 && firstTiles >= 5)
      }, 100)
    })
    return () => {
      live = false
      window.clearInterval(id)
    }
  }, [])

  const plants = veg.ready && plantsSettled && veg.plants.near + veg.plants.mid + veg.plants.far + veg.far > 0
  const parts = [terrainSettled, veg.ready, plants, architecture]
  const ready = parts.every(Boolean)

  useEffect(() => {
    if (done || !ready) return
    const id = window.setTimeout(() => setDone(true), SETTLE_MS)
    return () => window.clearTimeout(id)
  }, [ready, done])

  useEffect(() => {
    const id = window.setTimeout(() => setDone(true), GIVE_UP_MS)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    if (done) onDone()
  }, [done, onDone])

  const progress = parts.filter(Boolean).length / parts.length
  if (gone) return null
  const label = !terrainSettled ? 'Raising the terrain' : !veg.ready ? 'Reading the ground' : !plants ? 'Growing the plants' : !architecture ? 'Growing the structures' : 'Ready'
  return (
    <div className="pv-veil" data-done={done} aria-hidden={done} onTransitionEnd={(event) => event.target === event.currentTarget && done && setGone(true)}>
      <div className="pv-veil-centre">
        <ShadeFigure progress={done ? 1 : progress} />
        <p className="pv-veil-status" role="status">
          <span className="pv-veil-bar">
            <i style={{ transform: `scaleX(${Math.max(0.05, done ? 1 : progress)})` }} />
          </span>
          <span>{label}</span>
        </p>
      </div>
    </div>
  )
}

const W = 280
const H = 132
const GROUND = 112
const BASE_X = 128
/** One crossing of the sun, in seconds. */
const DAY = 5.2

/**
 * A structure on the ground under a crossing sun. Its roof reaches out over the ground; the shade beneath it is the region the roof hides from
 * the sun, so it swings from one side to the other as the day passes. Drawn with a few SVG attributes per frame; the structure's height and
 * reach follow the loading's progress (eased, so it grows rather than jumps).
 */
export function ShadeFigure({ progress }: { progress: number }) {
  const svg = useRef<SVGSVGElement>(null)
  const target = useRef(progress)
  useEffect(() => {
    target.current = progress
  }, [progress])

  useEffect(() => {
    const root = svg.current
    if (!root) return
    const sun = root.querySelector<SVGCircleElement>('.pv-fig-sun')!
    const shade = root.querySelector<SVGPolygonElement>('.pv-fig-shade')!
    const column = root.querySelector<SVGRectElement>('.pv-fig-column')!
    const roof = root.querySelector<SVGRectElement>('.pv-fig-roof')!
    const arc = root.querySelector<SVGPathElement>('.pv-fig-arc')!
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let grown = 0.15
    let raf = 0
    const start = performance.now()
    const cx = W / 2
    const R = 96
    arc.setAttribute('d', `M ${cx - R} ${GROUND} A ${R} ${R * 0.9} 0 0 1 ${cx + R} ${GROUND}`)
    const frame = (now: number) => {
      grown += (Math.max(0.15, target.current) - grown) * 0.06
      const t = reduce ? 0.35 : (((now - start) / 1000) % DAY) / DAY
      // The sun rises on the left and sets on the right, along the drawn arc.
      const a = Math.PI * (1 - (0.08 + 0.84 * t))
      const sx = cx + Math.cos(a) * R
      const sy = GROUND - Math.sin(a) * R * 0.9
      sun.setAttribute('cx', sx.toFixed(2))
      sun.setAttribute('cy', sy.toFixed(2))
      // The structure: a column, and a roof that reaches out to the right of it, both growing with the load.
      const height = 18 + 46 * grown
      const top = GROUND - height
      const reach = 16 + 44 * grown
      column.setAttribute('y', top.toFixed(2))
      column.setAttribute('height', height.toFixed(2))
      roof.setAttribute('y', top.toFixed(2))
      roof.setAttribute('width', (reach + 14).toFixed(2))
      // The shade: the roof's underside cast along the sun's rays to the ground.
      const under = top + 4
      const x1 = BASE_X - 6
      const x2 = BASE_X + 8 + reach
      const cast = (x: number) => x + ((GROUND - under) * (x - sx)) / Math.max(4, under - sy)
      const g1 = Math.max(-40, Math.min(W + 40, cast(x1)))
      const g2 = Math.max(-40, Math.min(W + 40, cast(x2)))
      shade.setAttribute('points', `${x1},${under} ${x2},${under} ${g2.toFixed(2)},${GROUND} ${g1.toFixed(2)},${GROUND}`)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <svg ref={svg} className="pv-fig" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
      <path className="pv-fig-arc" fill="none" />
      <polygon className="pv-fig-shade" />
      <line className="pv-fig-ground" x1={0} y1={GROUND} x2={W} y2={GROUND} />
      <rect className="pv-fig-column" x={BASE_X - 6} width={10} />
      <rect className="pv-fig-roof" x={BASE_X - 6} height={4} />
      <circle className="pv-fig-sun" r={4} />
    </svg>
  )
}
