import { BufferGeometry, Float32BufferAttribute } from 'three'
import { simplex2 } from '../shared/noise/simplex.ts'
import { clamp01, mulberry32, smoothstep } from './rng.ts'

/**
 * Concept Lab — one standing mass. Bedding is in the form from the start.
 * Playback opens gullies and lays the worn material back at the foot.
 * Seed moves the outline and the cuts.
 */

export type GeologicalSettings = {
  seed: number
  /** 0…1, how deep the cuts are once playback has finished. */
  erosion: number
  /** 0…1, how far soft beds step back. */
  bedding: number
}

const ANGLES = 72
const ROWS = 40
const HEIGHT = 1.45
const TAU = Math.PI * 2

type Gully = { at: number; width: number; depth: number }

function outline(angle: number, seed: number) {
  const n = simplex2(Math.cos(angle) * 1.25 + seed * 0.17, Math.sin(angle) * 1.25 - seed * 0.09)
  const fine = simplex2(Math.cos(angle) * 2.8 - seed * 0.04, Math.sin(angle) * 2.8 + 3.3)
  return 1 + 0.22 * n + 0.06 * fine
}

function gullyCut(angle: number, gullies: readonly Gully[]) {
  let peak = 0
  for (const gully of gullies) {
    const d = Math.abs(Math.atan2(Math.sin(angle - gully.at), Math.cos(angle - gully.at)))
    const band = Math.max(0, 1 - d / gully.width)
    peak = Math.max(peak, band * band * gully.depth)
  }
  return peak
}

export function geologicalGeometry(settings: GeologicalSettings, progress: number): BufferGeometry {
  const seed = Math.max(1, Math.round(settings.seed))
  const beds = clamp01(settings.bedding)
  const opened = clamp01(settings.erosion) * clamp01(progress)
  const rand = mulberry32(seed * 17 + 9)
  const gullies: Gully[] = Array.from({ length: 4 }, () => ({
    at: rand() * TAU,
    width: 0.18 + rand() * 0.2,
    depth: 0.5 + rand() * 0.5,
  }))

  const positions: number[] = []
  const indices: number[] = []
  const bandCount = 4

  for (let row = 0; row <= ROWS; row += 1) {
    const y = row / ROWS
    const foot = Math.max(0.35, smoothstep(0, 0.05, y))
    const cap = 1 - 0.06 * smoothstep(0.92, 1, y)
    const face = smoothstep(0.12, 0.3, y) * (1 - smoothstep(0.8, 0.96, y))
    const phase = y * bandCount
    const within = phase - Math.floor(phase)
    const soft = smoothstep(0.12, 0.48, within) * (1 - smoothstep(0.7, 0.9, within))

    for (let s = 0; s < ANGLES; s += 1) {
      const angle = (s / ANGLES) * TAU
      const plan = outline(angle, seed)
      let radius = 0.5 * plan * foot * cap
      radius -= (beds * 0.06 + opened * beds * 0.09) * soft
      radius -= opened * (1 - beds * 0.15) * gullyCut(angle, gullies) * 0.38 * Math.max(face, 0.15)
      radius = Math.max(0.12, radius)
      if (y < 0.22) {
        const t = y / 0.22
        const apron = 0.5 * plan + opened * 0.55
        radius = Math.max(radius, apron * (1 - t) + radius * t)
      }
      positions.push(Math.cos(angle) * radius, y * HEIGHT, Math.sin(angle) * radius)
    }
  }

  const topCenter = positions.length / 3
  positions.push(0, HEIGHT, 0)
  const bottomCenter = positions.length / 3
  positions.push(0, 0, 0)

  const next = (s: number) => (s + 1) % ANGLES
  for (let row = 0; row < ROWS; row += 1) {
    for (let s = 0; s < ANGLES; s += 1) {
      const a = row * ANGLES + s
      const b = row * ANGLES + next(s)
      const c = (row + 1) * ANGLES + s
      const d = (row + 1) * ANGLES + next(s)
      indices.push(a, c, b, b, c, d)
    }
  }
  const top = ROWS * ANGLES
  const bottom = 0
  for (let s = 0; s < ANGLES; s += 1) {
    indices.push(topCenter, top + next(s), top + s)
    indices.push(bottomCenter, bottom + s, bottom + next(s))
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}
