import { useEffect, useRef, useState } from 'react'
import { LANDSCAPE, islandRadius, landscapeHeight } from '../project03/terrain.ts'

/**
 * A contour plate of the island, drawn from the world's own height function (read only: nothing is generated or changed here).
 * Sampled a few rows at a time so the page stays responsive while it draws.
 */
export function IslandPlate({ size = 520, bands = 22 }: { size?: number; bands?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const n = 200
    const heights = new Float32Array(n * n)
    const half = LANDSCAPE.size * 0.5
    let row = 0
    let lo = Infinity
    let hi = -Infinity
    let cancelled = false
    const step = () => {
      if (cancelled) return
      const until = Math.min(n, row + 12)
      for (; row < until; row++) {
        for (let i = 0; i < n; i++) {
          const x = -half + ((i + 0.5) / n) * LANDSCAPE.size
          const z = -half + ((row + 0.5) / n) * LANDSCAPE.size
          // Beyond the island's outline is sea: left undrawn.
          if (Math.hypot(x, z) > islandRadius(Math.atan2(z, x))) {
            heights[row * n + i] = Number.NaN
            continue
          }
          const h = landscapeHeight(x, z)
          heights[row * n + i] = h
          if (h < lo) lo = h
          if (h > hi) hi = h
        }
      }
      if (row < n) window.setTimeout(step, 0)
      else draw()
    }
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      el.width = size * dpr
      el.height = size * dpr
      const ctx = el.getContext('2d')!
      ctx.scale(dpr, dpr)
      const cell = size / n
      const band = (h: number) => (Number.isNaN(h) ? -1 : Math.floor(((h - lo) / (hi - lo + 1e-6)) * bands))
      // The ground: denser stipple higher up.
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const b = band(heights[j * n + i]!)
          if (b < 0) continue
          ctx.fillStyle = `rgba(233, 226, 210, ${0.015 + (b / bands) * 0.07})`
          ctx.fillRect(i * cell, j * cell, cell, cell)
        }
      }
      // Contours: an edge wherever the band changes between neighbours; the coast in the accent.
      for (let j = 0; j < n - 1; j++) {
        for (let i = 0; i < n - 1; i++) {
          const a = band(heights[j * n + i]!)
          const r = band(heights[j * n + i + 1]!)
          const d = band(heights[(j + 1) * n + i]!)
          if (a === r && a === d) continue
          const coast = Math.min(a, r, d) < 0
          const level = Math.max(a, r, d) / bands
          ctx.fillStyle = coast ? 'rgba(201, 132, 104, 0.95)' : `rgba(240, 234, 220, ${0.25 + level * 0.55})`
          ctx.fillRect(i * cell + cell * 0.25, j * cell + cell * 0.25, cell * (coast ? 0.8 : 0.55), cell * (coast ? 0.8 : 0.55))
        }
      }
      setReady(true)
    }
    window.setTimeout(step, 60)
    return () => {
      cancelled = true
    }
  }, [size, bands])

  return (
    <figure className="pv-plate" data-ready={ready}>
      <canvas ref={canvas} style={{ width: size, height: size }} />
      <figcaption>
        <span>Plate I</span>
        <span>The island, {bands} height bands, drawn from the terrain function · {(LANDSCAPE.size / 1000).toFixed(1)} km square</span>
      </figcaption>
    </figure>
  )
}
