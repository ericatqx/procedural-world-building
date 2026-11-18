import { useEffect, useMemo, useRef, useState } from 'react'
import { riverNetwork, type RiverNetwork } from '../../project03/riverNetwork.ts'
import { LANDSCAPE, islandRadius, landscapeHeight } from '../../project03/terrain.ts'
import { currentWorld, type World } from '../../project03/world.ts'
import { Exhibit, HALF, INK, Key, Seg, Waiting, fmt, hillshade, useWidth } from './common.tsx'

/**
 * WATER — why does water flow here? Three steps over one map of the real island, each adding to the last:
 *   1 SLOPE: the ground (hill-shaded) and, on a grid, which way is downhill and how steeply (the arrows).
 *   2 DRAINAGE: following those arrows from every place, how much of the island drains through each point (worked out here from the same
 *     heights, each cell passing its water to its lowest neighbour). The lines where a great deal gathers are the valleys' floors.
 *   3 RIVERS AND LAKES: the world's own network (riverNetwork.ts) on those lines: rivers drawn at their width with marks moving downstream at a
 *     pace set by their fall, lakes still and flat, filled to the lowest point of their rim.
 * Clicking a river follows its water to where it leaves the island; beside the map, that way as a profile (height against distance), where the
 * lakes are the flat steps.
 */
const N = 140
const cell = LANDSCAPE.size / N
type Ground = { h: Float32Array; shade: HTMLCanvasElement; down: Int32Array; acc: Float32Array }
let built: Ground | null = null
function ground(): Ground {
  if (built) return built
  const h = new Float32Array(N * N)
  for (let j = 0; j < N; j += 1)
    for (let i = 0; i < N; i += 1) {
      const x = -HALF + (i + 0.5) * cell
      const z = -HALF + (j + 0.5) * cell
      h[j * N + i] = Math.hypot(x, z) < islandRadius(Math.atan2(z, x)) ? landscapeHeight(x, z) : NaN
    }
  // Each place's lowest neighbour (−1: a hollow, or the sea).
  const down = new Int32Array(N * N).fill(-1)
  for (let j = 0; j < N; j += 1)
    for (let i = 0; i < N; i += 1) {
      const k = j * N + i
      if (Number.isNaN(h[k]!)) continue
      let steepest = 0
      for (let dj = -1; dj <= 1; dj += 1)
        for (let di = -1; di <= 1; di += 1) {
          const ii = i + di
          const jj = j + dj
          if ((!di && !dj) || ii < 0 || jj < 0 || ii >= N || jj >= N) continue
          const n = jj * N + ii
          const sea = Number.isNaN(h[n]!)
          const drop = (h[k]! - (sea ? -1 : h[n]!)) / Math.hypot(di, dj)
          if (drop > steepest) {
            steepest = drop
            down[k] = sea ? -2 : n
          }
        }
    }
  // Drainage area: from the highest place down, each passes what it has gathered (itself and all above it) to its lowest neighbour.
  const order = [...h.keys()].filter((k) => !Number.isNaN(h[k]!)).sort((a, b) => h[b]! - h[a]!)
  const acc = new Float32Array(N * N)
  for (const k of order) {
    acc[k]! += 1
    const d = down[k]!
    if (d >= 0) acc[d]! += acc[k]!
  }
  built = { h, shade: hillshade(h, N, cell), down, acc }
  return built
}

function downstream(net: RiverNetwork, start: number) {
  const path: number[] = []
  const lakes: number[] = []
  const seen = new Set<number>()
  let at: number | null = start
  let end = 'ends inland'
  while (at !== null && !seen.has(at)) {
    seen.add(at)
    path.push(at)
    const n: RiverNetwork['next'][number] = net.next[at]!
    if (n.kind === 'join') at = n.river
    else if (n.kind === 'lake') {
      lakes.push(n.body)
      const out: number | undefined = net.outflow[n.body]![0]
      at = out ?? null
      if (out === undefined) end = 'stays in the lake: it has no outflow'
    } else {
      end = n.kind === 'rim' ? 'leaves over the island’s edge to the sea' : 'ends inland'
      at = null
    }
  }
  return { path, lakes, end }
}

type Step = 'slope' | 'drainage' | 'rivers'

export function WaterInspection() {
  const world = useLive()
  const net = useMemo(() => (world ? riverNetwork(world) : null), [world])
  const [step, setStep] = useState<Step>('rivers')
  const [chosen, setChosen] = useState<number | null>(null)
  const pick = chosen ?? (net ? net.length.indexOf(Math.max(...net.length)) : 0)
  const way = useMemo(() => (net ? downstream(net, pick) : null), [net, pick])
  const canvas = useRef<HTMLCanvasElement>(null)
  const [wrap, width] = useWidth(1120 - 340)
  const S = Math.min(width, 640)

  useEffect(() => {
    const el = canvas.current
    if (!el || !world || !net || !way) return
    const G = ground()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    el.width = S * dpr
    el.height = S * dpr
    const g = el.getContext('2d')!
    const k = S / LANDSCAPE.size
    const px = (w: number) => (w + HALF) * k
    const onWay = new Set(way.path)
    const cs = S / N
    // The drainage, once per size: blue-green where much of the island gathers, by the logarithm of the area.
    const drain = document.createElement('canvas')
    drain.width = N
    drain.height = N
    {
      const dg = drain.getContext('2d')!
      const img = dg.createImageData(N, N)
      const top = Math.log(Math.max(...G.acc))
      for (let q = 0; q < N * N; q += 1) {
        if (Number.isNaN(G.h[q]!) || G.acc[q]! < 3) continue
        const t = Math.log(G.acc[q]!) / top
        img.data.set([150, 214, 208, Math.round(255 * Math.min(1, Math.max(0, (t - 0.3) * 2.6)))], q * 4)
      }
      dg.putImageData(img, 0, 0)
    }
    const lakes = document.createElement('canvas')
    lakes.width = S
    lakes.height = S
    const lg = lakes.getContext('2d')!
    const index = new Map(world.water.bodies.map((b, bi) => [b, bi]))
    world.water.forEachWet((x, z, _d, body) => {
      lg.fillStyle = way.lakes.includes(index.get(body) ?? -1) ? '#3E7A7B' : '#1F4D52'
      lg.fillRect(px(x) - 1.2, px(z) - 1.2, 2.4, 2.4)
    })
    let raf = 0
    const draw = (now: number) => {
      if (step === 'rivers') raf = requestAnimationFrame(draw)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, S, S)
      g.imageSmoothingEnabled = true
      g.globalAlpha = step === 'drainage' ? 0.5 : 1
      g.drawImage(G.shade, 0, 0, S, S)
      g.globalAlpha = 1
      if (step === 'slope') {
        // Downhill arrows: every fifth place, pointing the way water would go, longer where it is steeper.
        g.strokeStyle = 'rgba(243, 239, 229, 0.85)'
        g.fillStyle = 'rgba(243, 239, 229, 0.85)'
        g.lineWidth = 1
        for (let j = 2; j < N; j += 5)
          for (let i = 2; i < N; i += 5) {
            const q = j * N + i
            const v = G.h[q]!
            if (Number.isNaN(v)) continue
            const e = G.h[q + 1]!
            const w = G.h[q - 1]!
            const s = G.h[q + N]!
            const n = G.h[q - N]!
            if ([e, w, s, n].some(Number.isNaN)) continue
            const dx = -(e - w) / (2 * cell)
            const dz = -(s - n) / (2 * cell)
            const m = Math.hypot(dx, dz)
            if (m < 0.004) {
              g.beginPath()
              g.arc((i + 0.5) * cs, (j + 0.5) * cs, 1.2, 0, Math.PI * 2)
              g.fill()
              continue
            }
            const len = 4 + Math.min(1, m / 0.35) * 10
            const ux = dx / m
            const uz = dz / m
            const cx = (i + 0.5) * cs
            const cz = (j + 0.5) * cs
            const tx = cx + ux * len * 0.5
            const tz = cz + uz * len * 0.5
            g.beginPath()
            g.moveTo(cx - ux * len * 0.5, cz - uz * len * 0.5)
            g.lineTo(tx, tz)
            g.stroke()
            g.beginPath()
            g.moveTo(tx + ux * 3, tz + uz * 3)
            g.lineTo(tx - uz * 2.4, tz + ux * 2.4)
            g.lineTo(tx + uz * 2.4, tz - ux * 2.4)
            g.closePath()
            g.fill()
          }
        return
      }
      g.globalAlpha = step === 'drainage' ? 1 : 0.3
      g.drawImage(drain, 0, 0, S, S)
      g.globalAlpha = 1
      if (step === 'drainage') return
      g.drawImage(lakes, 0, 0)
      g.lineCap = 'round'
      net.rivers.forEach((rv, ri) => {
        const lit = onWay.has(ri)
        const along = net.along[ri]!
        g.strokeStyle = lit ? '#7FB0AE' : '#3E7A7B'
        for (let i = 1; i < rv.nodes.length; i += 1) {
          const a = rv.nodes[i - 1]!
          const b = rv.nodes[i]!
          g.lineWidth = Math.max(lit ? 2.6 : 1.8, (a.halfWidth + b.halfWidth) * k * 2)
          g.beginPath()
          g.moveTo(px(a.x), px(a.z))
          g.lineTo(px(b.x), px(b.z))
          g.stroke()
        }
        // Chevrons moving down it, every 70 m, faster where it falls faster: the direction at a glance.
        const drop = rv.nodes[0]!.level - rv.nodes[rv.nodes.length - 1]!.level
        const pace = 22 + Math.min(55, (drop / Math.max(1, net.length[ri]!)) * 2400)
        const shift = ((now / 1000) * pace) % 70
        g.strokeStyle = lit ? '#FFFFFF' : 'rgba(10, 24, 25, 0.9)'
        g.lineWidth = 1.5
        for (let d = shift; d < net.length[ri]!; d += 70) {
          let i = 1
          while (i < along.length - 1 && along[i]! < d) i += 1
          const a = rv.nodes[i - 1]!
          const b = rv.nodes[i]!
          const t = (d - along[i - 1]!) / Math.max(0.001, along[i]! - along[i - 1]!)
          g.save()
          g.translate(px(a.x + (b.x - a.x) * t), px(a.z + (b.z - a.z) * t))
          g.rotate(Math.atan2(b.z - a.z, b.x - a.x))
          g.beginPath()
          g.moveTo(-2.5, -3)
          g.lineTo(2, 0)
          g.lineTo(-2.5, 3)
          g.stroke()
          g.restore()
        }
      })
      const s = net.rivers[pick]!.nodes[0]!
      g.fillStyle = INK.signal
      g.beginPath()
      g.arc(px(s.x), px(s.z), 4.5, 0, Math.PI * 2)
      g.fill()
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [world, net, way, pick, step, S])

  if (!world || !net || !way) return <Waiting what="water network" />
  const nearest = (x: number, z: number) => {
    let best = { d: Infinity, r: -1 }
    net.rivers.forEach((rv, ri) =>
      rv.nodes.forEach((n) => {
        const d = Math.hypot(n.x - x, n.z - z) - n.halfWidth
        if (d < best.d) best = { d, r: ri }
      }),
    )
    return best.d < 70 ? best.r : null
  }
  const source = net.rivers[pick]!.nodes[0]!
  return (
    <Exhibit
      controls={<Seg label="Step" step items={[{ key: 'slope' as Step, label: 'Slope' }, { key: 'drainage' as Step, label: 'Drainage' }, { key: 'rivers' as Step, label: 'Rivers and lakes' }]} value={step} onChange={setStep} />}
      stage={
        <div ref={wrap} className="pv-ex-fill">
          <canvas
            ref={canvas}
            className="pv-an-canvas"
            style={{ width: S, height: S, cursor: step === 'rivers' ? 'pointer' : undefined }}
            aria-label="The island's ground, its drainage and its rivers and lakes"
            onClick={(e) => {
              if (step !== 'rivers') return
              const r = e.currentTarget.getBoundingClientRect()
              const hit = nearest(((e.clientX - r.left) / r.width) * LANDSCAPE.size - HALF, ((e.clientY - r.top) / r.height) * LANDSCAPE.size - HALF)
              if (hit !== null) setChosen(hit)
            }}
          />
        </div>
      }
      legend={
        step === 'slope' ? (
          <>
            <Key swatch="linear-gradient(90deg,#2a2a29,#9a9995)">ground, lit from the north-west</Key>
            <Key line="rgba(243,239,229,0.85)">downhill: longer where steeper</Key>
          </>
        ) : step === 'drainage' ? (
          <Key swatch="linear-gradient(90deg,rgba(127,176,174,0.1),#7FB0AE)">how much of the island drains through here</Key>
        ) : (
          <>
            <Key swatch="#3E7A7B">river, chevrons moving downstream</Key>
            <Key swatch="#1F4D52">lake: still, level</Key>
            <Key swatch={INK.signal}>the chosen river’s source</Key>
          </>
        )
      }
      aside={
        step === 'rivers' ? (
          <>
            <p className="pv-ex-aside-k">The chosen water · click any river</p>
            <Profile world={world} net={net} way={way} />
            <Descent world={world} net={net} way={way} />
          </>
        ) : (
          <p className="pv-ex-aside-say">
            {step === 'slope'
              ? 'Every place on the island tilts one way. Water on it runs that way, toward its lowest neighbour, and keeps going until it reaches a hollow or the sea.'
              : 'Follow the arrows from every place at once and count what passes each point. Most places carry only their own rain; along a few branching lines, the rain of whole slopes gathers.'}
          </p>
        )
      }
      chain={
        step === 'slope'
          ? { input: 'The height of the ground, the sum of the terrain’s five layers.', rule: 'Water moves downhill, toward the steepest fall.', result: 'A direction at every place: the arrows. Flat ground, the dots, holds it.' }
          : step === 'drainage'
            ? { input: 'The downhill direction at every place.', rule: 'Each place passes all the water it has gathered to its lowest neighbour.', result: 'Branching lines of gathered water: the floors of the valleys the drainage layer carved.' }
            : { input: 'The lines where the most water gathers.', rule: 'Enough water makes a river, as wide as its flow; a hollow fills until it spills at the lowest point of its rim.', result: `River ${pick + 1} rises at ${fmt(source.level)} m, passes ${way.lakes.length} lake${way.lakes.length === 1 ? '' : 's'}, and ${way.end}.` }
      }
    />
  )
}

function useLive(): World | null {
  const [w, setW] = useState<World | null>(currentWorld)
  useEffect(() => {
    if (w) return
    const id = window.setInterval(() => {
      const v = currentWorld()
      if (v) setW(v)
    }, 500)
    return () => window.clearInterval(id)
  }, [w])
  return w
}

/** The chosen water's way in profile: its height against the distance it has run, rivers sloping, lakes flat. */
function Profile({ world, net, way }: { world: World; net: RiverNetwork; way: ReturnType<typeof downstream> }) {
  const pts: { d: number; h: number; lake?: boolean }[] = []
  let d = 0
  way.path.forEach((ri, i) => {
    const r = net.rivers[ri]!
    // A river joined part way down is entered at the point the last one met it.
    let from = 0
    if (i > 0) {
      const n = net.next[way.path[i - 1]!]!
      if (n.kind === 'join') from = n.node
    }
    for (let k = from; k < r.nodes.length; k += 1) {
      if (k > from) d += Math.hypot(r.nodes[k]!.x - r.nodes[k - 1]!.x, r.nodes[k]!.z - r.nodes[k - 1]!.z)
      pts.push({ d, h: r.nodes[k]!.level })
    }
    const n = net.next[ri]!
    if (n.kind === 'lake') {
      const b = world.water.bodies[n.body]!
      pts.push({ d, h: b.level, lake: true })
      d += 120
      pts.push({ d, h: b.level, lake: true })
    }
  })
  const W = 300
  const H = 150
  const top = Math.max(...pts.map((p) => p.h), 10)
  const X = (v: number) => 6 + (v / Math.max(1, d)) * (W - 12)
  const Y = (v: number) => 10 + (1 - v / top) * (H - 30)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="pv-ex-profile" role="img" aria-label="The chosen water's height along its way">
      <line x1={6} x2={W - 6} y1={Y(0)} y2={Y(0)} stroke="rgba(62,122,123,0.8)" strokeDasharray="3 3" />
      <polyline points={pts.map((p) => `${X(p.d).toFixed(1)},${Y(p.h).toFixed(1)}`).join(' ')} fill="none" stroke="#7FB0AE" strokeWidth={1.6} />
      {pts.map((p, i) => (p.lake && pts[i + 1]?.lake ? <line key={i} x1={X(p.d)} x2={X(pts[i + 1]!.d)} y1={Y(p.h)} y2={Y(p.h)} stroke="#1F4D52" strokeWidth={6} /> : null))}
      <circle cx={X(0)} cy={Y(pts[0]?.h ?? 0)} r={4} fill={INK.signal} />
      <text x={8} y={H - 4} fontSize="10" fill={INK.mute}>
        source
      </text>
      <text x={W - 8} y={H - 4} fontSize="10" fill={INK.mute} textAnchor="end">
        {fmt(d / 1000, 1)} km · sea level
      </text>
    </svg>
  )
}

function Descent({ world, net, way }: { world: World; net: RiverNetwork; way: ReturnType<typeof downstream> }) {
  const steps: { what: string; at: string; red?: boolean }[] = []
  way.path.forEach((ri, i) => {
    const r = net.rivers[ri]!
    steps.push({ what: i === 0 ? `River ${ri + 1} rises` : `joins river ${ri + 1}`, at: i === 0 ? `${fmt(r.nodes[0]!.level)} m` : `to ${fmt(r.nodes[r.nodes.length - 1]!.level)} m`, red: i === 0 })
    const n = net.next[ri]!
    if (n.kind === 'lake') {
      const b = world.water.bodies[n.body]!
      steps.push({ what: `fills lake ${n.body + 1}, ${fmt(b.depth)} m deep`, at: `${fmt(b.level)} m` })
    }
  })
  return (
    <ol className="pv-an-descent">
      {steps.map((s, i) => (
        <li key={i} data-red={s.red}>
          <span>{s.what}</span>
          <em>{s.at}</em>
        </li>
      ))}
      <li>
        <span>then {way.end}</span>
        <em />
      </li>
    </ol>
  )
}
