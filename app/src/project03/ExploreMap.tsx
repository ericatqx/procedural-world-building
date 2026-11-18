import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { LANDSCAPE, islandRadius, landscapeHeight } from './terrain.ts'
import type { Navigation } from './LandscapeView.tsx'
import type { RiverSystem } from './rivers.ts'
import { WADE_DEPTH, type WaterSystem } from './water.ts'

const COMPACT = 150
const EXPANDED = 300
/** Heights the ramp spans, in meters. */
const LOW = 0
const HIGH = 430
/** Teleports stay this far inside the shoreline, in meters. */
const EDGE_MARGIN = 10

/**
 * The map's palette follows the main visual (Graphic Diorama, Black Stage): olive on the low, vegetated ground, sand on the slopes, cream on the
 * high bare rock, with thin ochre bands at fixed heights (as the rock beds are drawn), and the deep teal of its water.
 */
const RAMP: readonly (readonly [number, number, number])[] = [
  [96, 104, 66],
  [128, 134, 86],
  [176, 168, 128],
  [214, 196, 160],
  [232, 218, 192],
  [240, 230, 208],
]
/** Heights (meters) of the ochre bands, and their half-width. */
const BANDS = [140, 230, 320]
const BAND_HALF = 5
const OCHRE: readonly [number, number, number] = [196, 104, 62]

function ramp(t: number): [number, number, number] {
  const scaled = Math.min(0.9999, Math.max(0, t)) * (RAMP.length - 1)
  const i = Math.floor(scaled)
  const f = scaled - i
  const a = RAMP[i]!
  const b = RAMP[i + 1]!
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

/** The island from above, colored by height from the terrain field, with the outline as its edge. */
function paintTerrain(canvas: HTMLCanvasElement, size: number, water: WaterSystem | null, rivers: RiverSystem | null) {
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const image = ctx.createImageData(size, size)
  const half = LANDSCAPE.size * 0.5
  const cell = LANDSCAPE.size / size
  const heights = new Float32Array(size * size)
  const land = new Uint8Array(size * size)
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const x = -half + (i + 0.5) * cell
      const z = -half + (j + 0.5) * cell
      const index = j * size + i
      heights[index] = landscapeHeight(x, z)
      land[index] = Math.hypot(x, z) <= islandRadius(Math.atan2(z, x)) ? 1 : 0
    }
  }
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const index = j * size + i
      const o = index * 4
      if (!land[index]) {
        image.data[o + 3] = 0
        continue
      }
      const h = heights[index]!
      const east = heights[j * size + Math.min(size - 1, i + 1)]!
      const west = heights[j * size + Math.max(0, i - 1)]!
      const south = heights[Math.min(size - 1, j + 1) * size + i]!
      const north = heights[Math.max(0, j - 1) * size + i]!
      // Light from the upper left, the way the island is lit.
      const shade = Math.max(0.55, Math.min(1.35, 1 + ((east - west) * 0.5 + (south - north) * 0.5) / (cell * 1.6)))
      let [r, g, b] = ramp((h - LOW) / (HIGH - LOW))
      const band = BANDS.reduce((k, level) => Math.max(k, 1 - Math.abs(h - level) / BAND_HALF), 0)
      if (band > 0) {
        r += (OCHRE[0] - r) * band * 0.8
        g += (OCHRE[1] - g) * band * 0.8
        b += (OCHRE[2] - b) * band * 0.8
      }
      image.data[o] = Math.min(255, r * shade)
      image.data[o + 1] = Math.min(255, g * shade)
      image.data[o + 2] = Math.min(255, b * shade)
      image.data[o + 3] = 255
    }
  }
  if (water) paintWater(image, land, size, water)
  ctx.putImageData(image, 0, 0)
  if (rivers) paintRivers(ctx, size, rivers)
}

const hex = (value: string): [number, number, number] => [
  Number.parseInt(value.slice(1, 3), 16),
  Number.parseInt(value.slice(3, 5), 16),
  Number.parseInt(value.slice(5, 7), 16),
]
// The main visual's deep teal (its water is not the 0.2 cobalt).
const MAP_SHALLOW = hex('#2f6a72')
const MAP_DEEP = hex('#173f47')

/** Rivers as lines in the same teal, at least a pixel and a half wide so the narrow ones still read. */
function paintRivers(ctx: CanvasRenderingContext2D, size: number, rivers: RiverSystem) {
  const cell = LANDSCAPE.size / size
  const half = LANDSCAPE.size * 0.5
  const mid = hex('#2a6068')
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = `rgb(${mid[0]}, ${mid[1]}, ${mid[2]})`
  for (const river of rivers.rivers) {
    const nodes = river.nodes
    for (let k = 0; k + 4 < nodes.length + 4; k += 4) {
      const a = nodes[Math.min(k, nodes.length - 1)]!
      const b = nodes[Math.min(k + 4, nodes.length - 1)]!
      ctx.lineWidth = Math.max(1.5, (a.halfWidth * 2) / cell)
      ctx.beginPath()
      ctx.moveTo((a.x + half) / cell, (a.z + half) / cell)
      ctx.lineTo((b.x + half) / cell, (b.z + half) / cell)
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** Water in the cobalt it has in the world, deepening with depth. Each wet node adds its share of a map pixel, so small pools still show. */
function paintWater(image: ImageData, land: Uint8Array, size: number, water: WaterSystem) {
  const cell = LANDSCAPE.size / size
  const half = LANDSCAPE.size * 0.5
  const share = new Float32Array(size * size)
  const depth = new Float32Array(size * size)
  water.forEachWet((x, z, d, body) => {
    const i = Math.floor((x + half) / cell)
    const j = Math.floor((z + half) / cell)
    if (i < 0 || j < 0 || i >= size || j >= size) return
    const index = j * size + i
    share[index]! += (body.grid.step * body.grid.step) / (cell * cell)
    depth[index]! += d * ((body.grid.step * body.grid.step) / (cell * cell))
  })
  for (let index = 0; index < share.length; index += 1) {
    const amount = Math.min(1, share[index]! * 1.6)
    if (amount <= 0.04 || !land[index]) continue
    const mean = depth[index]! / Math.max(share[index]!, 1e-6)
    const t = Math.min(1, mean / 14)
    const o = index * 4
    for (let c = 0; c < 3; c += 1) {
      const water = MAP_SHALLOW[c]! + (MAP_DEEP[c]! - MAP_SHALLOW[c]!) * t
      image.data[o + c] = image.data[o + c]! * (1 - amount) + water * amount
    }
  }
}

/**
 * A top-down height map for Explore. A click on land teleports the walker
 * there, 1.6 m above the ground; a click on the water does nothing.
 */
export function ExploreMap({
  seed,
  nav,
  water,
  rivers,
  onTeleport,
  kind = 'explore',
}: {
  seed: number
  water: WaterSystem | null
  rivers: RiverSystem | null
  nav: MutableRefObject<Navigation>
  onTeleport: (x: number, z: number) => void
  /** `explore`: a click stands the walker there (a small wedge marks where it is). `approach`: a click sends the elevated camera there (a large, soft disc marks the area it looks at). */
  kind?: 'explore' | 'approach'
}) {
  const [expanded, setExpanded] = useState(false)
  const [hover, setHover] = useState<string>('')
  const terrain = useRef<HTMLCanvasElement>(null)
  const marker = useRef<HTMLCanvasElement>(null)
  const target = useRef<{ x: number; z: number } | null>(null)
  const size = expanded ? EXPANDED : COMPACT

  useEffect(() => {
    if (terrain.current) paintTerrain(terrain.current, size, water, rivers)
  }, [seed, size, water, rivers])

  useEffect(() => {
    const canvas = marker.current
    if (!canvas) return
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const draw = () => {
      if (kind === 'approach') {
        ctx.clearRect(0, 0, size, size)
        const t = target.current
        if (!t) return
        const scale = size / LANDSCAPE.size
        const cx = (t.x + LANDSCAPE.size * 0.5) * scale
        const cy = (t.z + LANDSCAPE.size * 0.5) * scale
        // The area the camera looks at: a wide disc, soft at its edge, well larger than Explore's landing wedge.
        const radius = Math.max(10, 320 * scale)
        const fill = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
        fill.addColorStop(0, 'rgba(242,237,226,0.34)')
        fill.addColorStop(0.7, 'rgba(242,237,226,0.2)')
        fill.addColorStop(1, 'rgba(242,237,226,0)')
        ctx.fillStyle = fill
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.fill()
        ctx.lineWidth = 1
        ctx.strokeStyle = 'rgba(242,237,226,0.55)'
        ctx.beginPath()
        ctx.arc(cx, cy, radius * 0.72, 0, Math.PI * 2)
        ctx.stroke()
        return
      }
      const { x, z, yaw } = nav.current
      const scale = size / LANDSCAPE.size
      const px = (x + LANDSCAPE.size * 0.5) * scale
      const py = (z + LANDSCAPE.size * 0.5) * scale
      const fx = -Math.sin(yaw)
      const fz = -Math.cos(yaw)
      ctx.clearRect(0, 0, size, size)
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(8,8,8,0.8)'
      ctx.fillStyle = '#f2ede2'
      // Heading: a wedge pointing the way the eye faces.
      const tip = [px + fx * 11, py + fz * 11] as const
      const left = [px - fx * 4 - fz * 5, py - fz * 4 + fx * 5] as const
      const right = [px - fx * 4 + fz * 5, py - fz * 4 - fx * 5] as const
      ctx.beginPath()
      ctx.moveTo(tip[0], tip[1])
      ctx.lineTo(left[0], left[1])
      ctx.lineTo(right[0], right[1])
      ctx.closePath()
      ctx.stroke()
      ctx.fill()
    }
    draw()
    const id = window.setInterval(draw, 80)
    return () => window.clearInterval(id)
  }, [size, nav, kind])

  const worldAt = (event: { clientX: number; clientY: number }) => {
    const rect = marker.current!.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * LANDSCAPE.size - LANDSCAPE.size * 0.5
    const z = ((event.clientY - rect.top) / rect.height) * LANDSCAPE.size - LANDSCAPE.size * 0.5
    const deep = water ? water.depthAt(x, z) : 0
    const land = Math.hypot(x, z) <= islandRadius(Math.atan2(z, x)) - EDGE_MARGIN && deep <= WADE_DEPTH
    return { x, z, land, deep }
  }

  return (
    <div className="explore-map" data-expanded={expanded}>
      <div className="explore-map-head">
        <span className="explore-map-title">{kind === 'approach' ? 'Map · Approach' : 'Map'}</span>
        <span className="explore-map-hover">{hover}</span>
        <button
          type="button"
          className="text-button"
          aria-expanded={expanded}
          aria-label={expanded ? 'Shrink map' : 'Expand map'}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Shrink' : 'Expand'}
        </button>
      </div>
      <div className="explore-map-body" style={{ width: size, height: size }}>
        <canvas ref={terrain} className="explore-map-layer" />
        <canvas
          ref={marker}
          className="explore-map-layer explore-map-click"
          data-testid="explore-map"
          onPointerMove={(event) => {
            const at = worldAt(event)
            const inside = Math.hypot(at.x, at.z) <= islandRadius(Math.atan2(at.z, at.x)) - EDGE_MARGIN
            setHover(!inside ? '' : at.deep > 0.05 ? `water ${at.deep.toFixed(1)} m deep` : `${Math.round(landscapeHeight(at.x, at.z))} m`)
          }}
          onPointerLeave={() => setHover('')}
          onClick={(event) => {
            const at = worldAt(event)
            if (!at.land) return
            if (kind === 'approach') target.current = { x: at.x, z: at.z }
            onTeleport(at.x, at.z)
          }}
        />
      </div>
    </div>
  )
}
