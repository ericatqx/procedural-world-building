import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { LANDSCAPE, islandRadius, landscapeHeight } from './terrain.ts'
import type { Navigation } from './LandscapeView.tsx'
import { WADE_DEPTH, type WaterSystem } from './water.ts'
import { WATER_02 } from '../project02/materials.ts'

const COMPACT = 150
const EXPANDED = 300
/** Heights the ramp spans, in meters. */
const LOW = 0
const HIGH = 430
/** Teleports stay this far inside the shoreline, in meters. */
const EDGE_MARGIN = 10

const RAMP: readonly (readonly [number, number, number])[] = [
  [48, 46, 43],
  [92, 88, 80],
  [150, 144, 131],
  [205, 199, 184],
]

function ramp(t: number): [number, number, number] {
  const scaled = Math.min(0.9999, Math.max(0, t)) * (RAMP.length - 1)
  const i = Math.floor(scaled)
  const f = scaled - i
  const a = RAMP[i]!
  const b = RAMP[i + 1]!
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

/** The island from above, colored by height from the terrain field, with the outline as its edge. */
function paintTerrain(canvas: HTMLCanvasElement, size: number, water: WaterSystem | null) {
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
      const [r, g, b] = ramp((h - LOW) / (HIGH - LOW))
      image.data[o] = Math.min(255, r * shade)
      image.data[o + 1] = Math.min(255, g * shade)
      image.data[o + 2] = Math.min(255, b * shade)
      image.data[o + 3] = 255
    }
  }
  if (water) paintWater(image, land, size, water)
  ctx.putImageData(image, 0, 0)
}

const hex = (value: string): [number, number, number] => [
  Number.parseInt(value.slice(1, 3), 16),
  Number.parseInt(value.slice(3, 5), 16),
  Number.parseInt(value.slice(5, 7), 16),
]
const MAP_SHALLOW = hex(WATER_02.uWaterShallow)
const MAP_DEEP = hex(WATER_02.uWaterDeep)

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
  onTeleport,
}: {
  seed: number
  water: WaterSystem | null
  nav: MutableRefObject<Navigation>
  onTeleport: (x: number, z: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [hover, setHover] = useState<string>('')
  const terrain = useRef<HTMLCanvasElement>(null)
  const marker = useRef<HTMLCanvasElement>(null)
  const size = expanded ? EXPANDED : COMPACT

  useEffect(() => {
    if (terrain.current) paintTerrain(terrain.current, size, water)
  }, [seed, size, water])

  useEffect(() => {
    const canvas = marker.current
    if (!canvas) return
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const draw = () => {
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
  }, [size, nav])

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
        <span className="explore-map-title">Map</span>
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
            if (at.land) onTeleport(at.x, at.z)
          }}
        />
      </div>
    </div>
  )
}
