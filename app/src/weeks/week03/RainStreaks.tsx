import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  type LineSegments,
} from 'three'
import { WATER_DEPTH_SCALE } from './hydraulicErosion.ts'

type RainStreaksProps = {
  /** Current terrain heights, same grid as the terrain mesh. */
  heightmap: Float32Array
  /** Simulation water amounts; drops end on the water surface. */
  water: Float32Array
  resolution: number
  amplitude: number
  /** 0–1 share of the heaviest rain the simulation allows. */
  intensity: number
  size?: number
}

const MAX_DROPS = 1500
const RAIN_TOP = 3.2
const FALL_SPEED = 5.5
const STREAK_LENGTH = 0.14
const RAIN_COLOR = '#cfefff'
const RAIN_OPACITY = 0.4
/** Long frames (e.g. after a hidden tab) would otherwise teleport every drop. */
const MAX_FRAME_SECONDS = 0.05

type DropField = {
  x: Float32Array
  z: Float32Array
  /** Height of the streak's lower end. */
  y: Float32Array
  /** Surface height where this drop lands. */
  landing: Float32Array
}

/**
 * Rain falling onto the terrain while the erosion simulation runs. Drops are
 * spread evenly, like the simulation's rain, and end on the terrain or water
 * surface beneath them. Rendering only.
 */
export function RainStreaks({
  heightmap,
  water,
  resolution,
  amplitude,
  intensity,
  size = 8,
}: RainStreaksProps) {
  const linesRef = useRef<LineSegments>(null)
  const dropsRef = useRef<DropField | null>(null)
  const fieldsRef = useRef({ heightmap, water, resolution, amplitude })

  useLayoutEffect(() => {
    fieldsRef.current = { heightmap, water, resolution, amplitude }
  }, [heightmap, water, resolution, amplitude])

  useLayoutEffect(() => {
    const lines = linesRef.current
    if (!lines) {
      return
    }
    const geometry = new BufferGeometry()
    const positions = new BufferAttribute(new Float32Array(MAX_DROPS * 6), 3)
    positions.setUsage(DynamicDrawUsage)
    geometry.setAttribute('position', positions)
    const previous = lines.geometry
    lines.geometry = geometry
    previous.dispose()
    return () => geometry.dispose()
  }, [])

  useFrame((_, delta) => {
    const lines = linesRef.current
    if (!lines) {
      return
    }
    const fields = fieldsRef.current

    const surfaceAt = (x: number, z: number) => {
      const res = fields.resolution
      const col = Math.round((x / size + 0.5) * (res - 1))
      const row = Math.round((z / size + 0.5) * (res - 1))
      const src = (res - 1 - row) * res + col
      const terrain = fields.heightmap[src] ?? 0
      const depth = (fields.water[src] ?? 0) * WATER_DEPTH_SCALE
      return (terrain + depth) * fields.amplitude
    }

    let drops = dropsRef.current
    if (!drops) {
      drops = {
        x: new Float32Array(MAX_DROPS),
        z: new Float32Array(MAX_DROPS),
        y: new Float32Array(MAX_DROPS),
        landing: new Float32Array(MAX_DROPS),
      }
      for (let i = 0; i < MAX_DROPS; i++) {
        drops.x[i] = (Math.random() - 0.5) * size
        drops.z[i] = (Math.random() - 0.5) * size
        drops.landing[i] = surfaceAt(drops.x[i]!, drops.z[i]!)
        // Start spread through the column so rain lands from the first frame.
        drops.y[i] = drops.landing[i]! + Math.random() * (RAIN_TOP - drops.landing[i]!)
      }
      dropsRef.current = drops
    }

    const count = Math.round(MAX_DROPS * Math.min(1, Math.max(0, intensity)))
    const fall = FALL_SPEED * Math.min(delta, MAX_FRAME_SECONDS)
    const positions = lines.geometry.getAttribute('position') as BufferAttribute
    const array = positions.array as Float32Array

    for (let i = 0; i < count; i++) {
      let y = drops.y[i]! - fall
      if (y <= drops.landing[i]!) {
        drops.x[i] = (Math.random() - 0.5) * size
        drops.z[i] = (Math.random() - 0.5) * size
        drops.landing[i] = surfaceAt(drops.x[i]!, drops.z[i]!)
        y = RAIN_TOP + Math.random() * STREAK_LENGTH * 4
      }
      drops.y[i] = y
      const x = drops.x[i]!
      const z = drops.z[i]!
      const o = i * 6
      array[o] = x
      array[o + 1] = y
      array[o + 2] = z
      array[o + 3] = x
      array[o + 4] = y + STREAK_LENGTH
      array[o + 5] = z
    }

    lines.geometry.setDrawRange(0, count * 2)
    positions.needsUpdate = true
  })

  return (
    <lineSegments ref={linesRef} frustumCulled={false} renderOrder={2}>
      <lineBasicMaterial
        color={RAIN_COLOR}
        transparent
        opacity={RAIN_OPACITY}
        depthWrite={false}
      />
    </lineSegments>
  )
}
