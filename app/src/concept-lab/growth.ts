import { BufferGeometry, Float32BufferAttribute } from 'three'
import { clamp01, mulberry32 } from './rng.ts'

/**
 * Concept Lab — one branching growth, read two ways.
 * `grid` 0 is the Biological study: members wander and lean toward a fixed
 * attractor. Raising `grid` is the Hybrid study: the same steps snap toward
 * the nearest axis and thicken, so the form reads as built.
 * Playback reveals members in the order they were laid.
 */

export type GrowthSettings = {
  seed: number
  /** Members laid by the end of playback. */
  steps: number
  /** 0…1 pull toward one fixed point. */
  attract: number
  /** 0 free, 1 fully axis-aligned. Biological passes 0. */
  grid: number
}

type Raw = {
  parent: number
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
}

/** Shared by both studies, so a Biological run and a Hybrid run aim at the same place. */
const ATTRACTOR = { x: 0.62, y: 1.7, z: -0.28 } as const

const SIDES = 5

function snapAxis(x: number, y: number, z: number): [number, number, number] {
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const az = Math.abs(z)
  if (ay >= ax && ay >= az) return [0, Math.sign(y) || 1, 0]
  if (ax >= az) return [Math.sign(x) || 1, 0, 0]
  return [0, 0, Math.sign(z) || 1]
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1
  return [x / length, y / length, z / length]
}

function branchHeading(dx: number, dy: number, dz: number, rand: () => number, grid: number): [number, number, number] {
  const yaw = (rand() - 0.5) * 1.5
  const lift = 0.25 + rand() * 0.7
  let x = dx * Math.cos(yaw) - dz * Math.sin(yaw)
  let z = dx * Math.sin(yaw) + dz * Math.cos(yaw)
  let y = dy * (1 - lift) + (rand() > 0.35 ? 0.35 : -0.05)
  const [sx, sy, sz] = snapAxis(x, y, z)
  x += (sx - x) * grid
  y += (sy - y) * grid
  z += (sz - z) * grid
  return normalize(x, y, z)
}

function layout(settings: GrowthSettings): Raw[] {
  const seed = Math.max(1, Math.round(settings.seed))
  const budget = Math.max(6, Math.round(settings.steps))
  const grid = clamp01(settings.grid)
  const attract = clamp01(settings.attract)
  const rand = mulberry32(seed * 97 + 13)
  const wander = 0.62 * (1 - grid * 0.88)

  const tilt = rand() * Math.PI * 2
  const lean = 0.16
  type Tip = {
    x: number
    y: number
    z: number
    hx: number
    hy: number
    hz: number
    order: number
    born: number
    parent: number
  }
  const tips: Tip[] = [
    {
      x: 0,
      y: 0,
      z: 0,
      hx: Math.cos(tilt) * lean,
      hy: Math.sqrt(1 - lean * lean),
      hz: Math.sin(tilt) * lean,
      order: 0,
      born: 0,
      parent: -1,
    },
  ]
  const raw: Raw[] = []

  while (raw.length < budget && tips.length) {
    const tip = tips.shift()!
    let x = tip.hx
    let y = tip.hy
    let z = tip.hz
    const ax = ATTRACTOR.x - tip.x
    const ay = ATTRACTOR.y - tip.y
    const az = ATTRACTOR.z - tip.z
    const reach = Math.hypot(ax, ay, az) || 1
    const pull = attract * (tip.order === 0 ? 0.9 : 0.5)
    x += (ax / reach) * pull + (rand() - 0.5) * wander
    y += (ay / reach) * pull + (rand() - 0.5) * wander * 0.4
    z += (az / reach) * pull + (rand() - 0.5) * wander
    ;[x, y, z] = normalize(x, y, z)
    if (grid > 0) {
      const [sx, sy, sz] = snapAxis(x, y, z)
      ;[x, y, z] = normalize(x + (sx - x) * grid, y + (sy - y) * grid, z + (sz - z) * grid)
    }
    if (tip.y < 0.06 && y < 0.2) [x, y, z] = normalize(x, 0.2, z)

    const step = (0.18 + 0.07 * grid) * 0.86 ** tip.order * (0.8 + rand() * 0.4)
    let x1 = tip.x + x * step
    let y1 = tip.y + y * step
    let z1 = tip.z + z * step
    if (y1 < 0) {
      y1 = 0
      y = Math.abs(y)
    }

    const index = raw.length
    raw.push({ parent: tip.parent, x0: tip.x, y0: tip.y, z0: tip.z, x1, y1, z1 })

    if (tip.born < 8 - tip.order * 2) {
      tips.push({ x: x1, y: y1, z: z1, hx: x, hy: y, hz: z, order: tip.order, born: tip.born + 1, parent: index })
    }
    const chance = tip.order === 0 ? 0.62 : 0.4
    if (tip.order < 2 && tip.born >= 1 && raw.length < budget && rand() < chance) {
      const [hx, hy, hz] = branchHeading(x, y, z, rand, grid)
      tips.push({ x: x1, y: y1, z: z1, hx, hy, hz, order: tip.order + 1, born: 0, parent: index })
    }
  }
  return raw
}

function radii(raw: readonly Raw[], grid: number) {
  const supported = new Array<number>(raw.length).fill(0)
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    if (supported[i] === 0) supported[i] = 1
    const parent = raw[i]!.parent
    if (parent >= 0) supported[parent] = (supported[parent] ?? 0) + supported[i]!
  }
  const peak = Math.max(1, ...supported)
  const girth = (load: number) => (0.016 + 0.075 * Math.sqrt(load / peak)) * (1 + 0.9 * grid)
  return raw.map((_, i) => {
    const here = girth(supported[i]!)
    const next = girth(Math.max(1, supported[i]! - 1))
    return { r0: here, r1: Math.min(here, next) }
  })
}

function addSegment(
  positions: number[],
  indices: number[],
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  r0: number,
  r1: number,
) {
  const dx = x1 - x0
  const dy = y1 - y0
  const dz = z1 - z0
  const length = Math.hypot(dx, dy, dz)
  if (length < 1e-4) return
  const ux = dx / length
  const uy = dy / length
  const uz = dz / length
  const ax = Math.abs(uy) > 0.92 ? 1 : 0
  const ay = Math.abs(uy) > 0.92 ? 0 : 1
  let sx = uy * 0 - uz * ay
  let sy = uz * ax - ux * 0
  let sz = ux * ay - uy * ax
  const sl = Math.hypot(sx, sy, sz) || 1
  sx /= sl
  sy /= sl
  sz /= sl
  const tx = uy * sz - uz * sy
  const ty = uz * sx - ux * sz
  const tz = ux * sy - uy * sx
  const base = positions.length / 3
  for (let ring = 0; ring < 2; ring += 1) {
    const x = ring ? x1 : x0
    const y = ring ? y1 : y0
    const z = ring ? z1 : z0
    const radius = Math.max(0.012, ring ? r1 : r0)
    for (let s = 0; s < SIDES; s += 1) {
      const angle = (s / SIDES) * Math.PI * 2
      const c = Math.cos(angle)
      const n = Math.sin(angle)
      positions.push(x + (sx * c + tx * n) * radius, y + (sy * c + ty * n) * radius, z + (sz * c + tz * n) * radius)
    }
  }
  for (let s = 0; s < SIDES; s += 1) {
    const s2 = (s + 1) % SIDES
    const a = base + s
    const b = base + s2
    const c = base + SIDES + s
    const d = base + SIDES + s2
    indices.push(a, c, b, b, c, d)
  }
}

export function growthGeometry(settings: GrowthSettings, progress: number): BufferGeometry {
  const raw = layout(settings)
  const radius = radii(raw, clamp01(settings.grid))
  const shown = clamp01(progress) * raw.length
  const full = Math.min(raw.length, Math.floor(shown))
  const fraction = shown - full
  const positions: number[] = []
  const indices: number[] = []
  const count = Math.min(raw.length, full + (fraction > 0.02 ? 1 : 0))
  for (let i = 0; i < count; i += 1) {
    const segment = raw[i]!
    const part = i < full ? 1 : fraction
    const girth = radius[i]!
    addSegment(
      positions,
      indices,
      segment.x0,
      segment.y0,
      segment.z0,
      segment.x0 + (segment.x1 - segment.x0) * part,
      segment.y0 + (segment.y1 - segment.y0) * part,
      segment.z0 + (segment.z1 - segment.z0) * part,
      girth.r0,
      girth.r0 + (girth.r1 - girth.r0) * part,
    )
  }
  const geometry = new BufferGeometry()
  if (!positions.length) {
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0.02, 0, 0, 0, 0, 0.02, 0, 0], 3))
    geometry.setIndex([0, 1, 2])
  } else {
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setIndex(indices)
  }
  geometry.computeVertexNormals()
  return geometry
}
