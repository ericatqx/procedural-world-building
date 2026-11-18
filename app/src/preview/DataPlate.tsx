import { useEffect, useRef, useState } from 'react'
import { currentPopulation } from '../project03/livingSelection.ts'
import { LANDSCAPE, islandRadius, landscapeHeight } from '../project03/terrain.ts'
import { currentWorld } from '../project03/world.ts'

/**
 * THE DATA PLATE: a technical view of the live world's own data, in plan (read only: nothing here generates or changes anything). The relief is the
 * height function the terrain is meshed from; the layers are the structures the world holds: the terrain's chunk grid, the lakes' wet nodes and the
 * rivers at their width, the river graph's nodes, and the Living Architecture's organisms with the links between them. These are debugging views of
 * how the world is stored, not ecological lenses (those are in Explore, drawn on the world itself).
 */
export type Layer = 'chunks' | 'water' | 'graph' | 'organisms'
const LAYERS: { key: Layer; label: string; note: string }[] = [
  { key: 'chunks', label: 'Chunk grid', note: `${LANDSCAPE.size / LANDSCAPE.chunkSize}² chunks of ${LANDSCAPE.chunkSize} m, meshed at their own detail` },
  { key: 'water', label: 'Water bodies', note: 'wet nodes of each lake and pool; rivers at their own width' },
  { key: 'graph', label: 'River graph', note: 'the node chains rivers are built from; rings at lake outlets' },
  { key: 'organisms', label: 'Organisms', note: 'Living Architecture: each organism’s footprint, and the root links between them' },
]

const N = 200
const HALF = LANDSCAPE.size / 2
/** The relief, once per page load (the height function is the seed's: the same for every plate drawn). */
let reliefCache: HTMLCanvasElement | null = null

/** `only`: the layers drawn, fixed (World Anatomy shows the ones of the system in view); without it, the reader toggles them. */
export function DataPlate({ only, size: SIZE = 440 }: { only?: Layer[]; size?: number } = {}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const relief = useRef<HTMLCanvasElement | null>(reliefCache)
  const [ready, setReady] = useState(reliefCache !== null)
  const [chosen, setOn] = useState<Record<Layer, boolean>>({ chunks: false, water: true, graph: false, organisms: true })
  const on: Record<Layer, boolean> = only ? { chunks: only.includes('chunks'), water: only.includes('water'), graph: only.includes('graph'), organisms: only.includes('organisms') } : chosen
  const onKey = `${on.chunks}${on.water}${on.graph}${on.organisms}`
  const [counts, setCounts] = useState('')

  // The relief, sampled a few rows at a time so the page stays responsive: a plain hill shade of the height function, the sea left empty.
  useEffect(() => {
    if (reliefCache) return
    const h = new Float32Array(N * N)
    const land = new Uint8Array(N * N)
    let row = 0
    let cancelled = false
    let id = 0
    const step = () => {
      if (cancelled) return
      const until = Math.min(N, row + 14)
      for (; row < until; row += 1)
        for (let i = 0; i < N; i += 1) {
          const x = -HALF + ((i + 0.5) / N) * LANDSCAPE.size
          const z = -HALF + ((row + 0.5) / N) * LANDSCAPE.size
          h[row * N + i] = landscapeHeight(x, z)
          land[row * N + i] = Math.hypot(x, z) < islandRadius(Math.atan2(z, x)) ? 1 : 0
        }
      if (row < N) {
        id = requestAnimationFrame(step)
        return
      }
      const off = document.createElement('canvas')
      off.width = N
      off.height = N
      const g = off.getContext('2d')!
      const img = g.createImageData(N, N)
      const cell = LANDSCAPE.size / N
      for (let j = 0; j < N; j += 1)
        for (let i = 0; i < N; i += 1) {
          const k = j * N + i
          if (!land[k]) continue
          const dx = (h[j * N + Math.min(N - 1, i + 1)]! - h[j * N + Math.max(0, i - 1)]!) / (2 * cell)
          const dz = (h[Math.min(N - 1, j + 1) * N + i]! - h[Math.max(0, j - 1) * N + i]!) / (2 * cell)
          // Light from the north-west, high: the form reads without any colour.
          const shade = Math.max(0, Math.min(1, 0.62 + (-dx * 0.7 - dz * 0.7) * 1.6))
          const v = 70 + shade * 120
          img.data.set([v, v * 0.99, v * 0.96, 255], k * 4)
        }
      g.putImageData(img, 0, 0)
      relief.current = off
      reliefCache = off
      setReady(true)
    }
    id = requestAnimationFrame(step)
    return () => {
      cancelled = true
      cancelAnimationFrame(id)
    }
  }, [])

  useEffect(() => {
    const el = canvas.current
    if (!el || !ready || !relief.current) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    el.width = SIZE * dpr
    el.height = SIZE * dpr
    const g = el.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, SIZE, SIZE)
    g.imageSmoothingEnabled = true
    g.drawImage(relief.current, 0, 0, SIZE, SIZE)
    const k = SIZE / LANDSCAPE.size
    const px = (x: number) => (x + HALF) * k
    const world = currentWorld()
    const population = currentPopulation()
    const parts: string[] = []

    if (on.chunks) {
      g.strokeStyle = 'rgba(10, 10, 10, 0.55)'
      g.lineWidth = 0.6
      const across = LANDSCAPE.size / LANDSCAPE.chunkSize
      g.beginPath()
      for (let i = 0; i <= across; i += 1) {
        const p = i * LANDSCAPE.chunkSize * k
        g.moveTo(p, 0)
        g.lineTo(p, SIZE)
        g.moveTo(0, p)
        g.lineTo(SIZE, p)
      }
      g.stroke()
      parts.push(`${across * across} chunks`)
    }
    if (world && on.water) {
      g.fillStyle = '#3F8286'
      let wet = 0
      world.water.forEachWet((x, z) => {
        wet += 1
        g.fillRect(px(x) - 0.8, px(z) - 0.8, 1.6, 1.6)
      })
      g.strokeStyle = '#4E9A9E'
      g.lineCap = 'round'
      for (const river of world.rivers.rivers) {
        for (let i = 1; i < river.nodes.length; i += 1) {
          const a = river.nodes[i - 1]!
          const b = river.nodes[i]!
          g.lineWidth = Math.max(0.7, (a.halfWidth + b.halfWidth) * k)
          g.beginPath()
          g.moveTo(px(a.x), px(a.z))
          g.lineTo(px(b.x), px(b.z))
          g.stroke()
        }
      }
      parts.push(`${world.water.bodies.length} water bodies`, `${world.rivers.rivers.length} rivers`)
    }
    if (world && on.graph) {
      g.fillStyle = 'rgba(233, 230, 223, 0.9)'
      let nodes = 0
      for (const river of world.rivers.rivers)
        for (const n of river.nodes) {
          nodes += 1
          g.fillRect(px(n.x) - 0.9, px(n.z) - 0.9, 1.8, 1.8)
        }
      g.strokeStyle = 'rgba(233, 230, 223, 0.9)'
      g.lineWidth = 0.8
      for (const b of world.water.bodies) {
        if (b.kind !== 'lake') continue
        g.beginPath()
        g.arc(px(b.outlet.x), px(b.outlet.z), 3.2, 0, Math.PI * 2)
        g.stroke()
      }
      parts.push(`${nodes} river nodes`)
    }
    if (population && on.organisms) {
      g.strokeStyle = 'rgba(255, 31, 31, 0.55)'
      g.lineWidth = 0.7
      g.beginPath()
      for (const l of population.links) {
        const a = population.organisms[l.a]!
        const b = population.organisms[l.b]!
        g.moveTo(px(a.x), px(a.z))
        g.lineTo(px(b.x), px(b.z))
      }
      g.stroke()
      g.strokeStyle = '#ff1f1f'
      g.fillStyle = 'rgba(255, 31, 31, 0.18)'
      g.lineWidth = 1
      for (const o of population.organisms) {
        g.beginPath()
        g.arc(px(o.x), px(o.z), Math.max(1.6, o.radius * k), 0, Math.PI * 2)
        g.fill()
        g.stroke()
      }
      parts.push(`${population.organisms.length} organisms`, `${population.links.length} links`)
    }
    setCounts(parts.join(' · '))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, onKey, SIZE])

  return (
    <figure className="pv-dataplate">
      <div className="pv-dataplate-canvas" data-ready={ready}>
        <canvas ref={canvas} style={{ width: SIZE, height: SIZE }} aria-label="The island in plan, with the world's data layers" />
        {ready ? null : <span>Sampling the height function…</span>}
      </div>
      <figcaption>
        {only ? null : <p className="pv-dataplate-kind">Technical view · the world’s stored data, in plan</p>}
        {only ? null : (
        <ul className="pv-dataplate-layers">
          {LAYERS.map((l) => (
            <li key={l.key}>
              <button type="button" aria-pressed={on[l.key]} onClick={() => setOn((o) => ({ ...o, [l.key]: !o[l.key] }))}>
                <span>{l.label}</span>
                {l.note}
              </button>
            </li>
          ))}
        </ul>
        )}
        <p className="pv-dataplate-count">{counts || 'Relief: the height function the terrain is meshed from'}</p>
      </figcaption>
    </figure>
  )
}
