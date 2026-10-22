import { BufferGeometry, Float32BufferAttribute } from 'three'
import { simplex2 } from '../shared/noise/simplex.ts'
import { clamp01, mulberry32 } from './rng.ts'

/**
 * Concept Lab — one small patch where plants and structures change each other.
 * Structures write shade. Plants write cover. Each reads the other with a
 * unimodal response: a middle amount speeds growth, and a high amount slows
 * or removes it. Nothing here aims at a target shape.
 */

export type LivingSettings = {
  seed: number
  /** How strongly plants answer structure shade. 0 ignores it. */
  plants: number
  /** How strongly structures answer plant cover. 0 ignores it. */
  structures: number
}

export type LivingWorld = {
  seed: number
  step: number
  heights: Float32Array
  cover: Float32Array
  shade: Float32Array
  foot: Float32Array
  plants: Plant[]
  members: Member[]
  tips: Tip[]
  rand: () => number
}

type Plant = { x: number; z: number; size: number; age: number }

type Member = {
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
  r0: number
  r1: number
}

type Tip = {
  x: number
  y: number
  z: number
  hx: number
  hy: number
  hz: number
  radius: number
  born: number
  credit: number
}

/** Half-width of the patch, in the same units as the other lab studies. */
export const PATCH = 2.35
const GRID = 36
const MAX_PLANTS = 36
const MAX_MEMBERS = 70
const MAX_TIPS = 12
const SIDES = 5

const hump = (value: number, center: number, width: number) => {
  const d = (value - center) / width
  return Math.exp(-d * d)
}

/** Plants keep a modest rate on their own. Structure shade raises that rate in a middle band and removes it when the shade or the footprint is high. */
export function plantSuitability(shade: number, cover: number, foot: number, response: number): number {
  const room = 1 - smooth(0.55, 0.92, cover)
  const helped = hump(shade, 0.42, 0.2)
  const buried = smooth(0.72, 1, shade)
  const occupied = smooth(0.3, 0.75, foot)
  const suit = (0.36 * room + response * 0.85 * helped) * (1 - response * buried) * (1 - response * occupied)
  return clamp01(suit)
}

/** Structures extend faster in a middle amount of plant cover and stall when that cover is thick. */
export function structureVigor(shade: number, cover: number, response: number): number {
  const help = hump(cover, 0.36, 0.18)
  const choke = smooth(0.5, 0.82, cover)
  const gloom = smooth(0.78, 1, shade)
  return (0.62 + response * 1.15 * help) * (1 - response * 0.9 * choke) * (1 - 0.45 * gloom)
}

function smooth(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function vertex(i: number, j: number): [number, number] {
  const x = -PATCH + (i / (GRID - 1)) * PATCH * 2
  const z = -PATCH + (j / (GRID - 1)) * PATCH * 2
  return [x, z]
}

export function sampleHeight(heights: Float32Array, x: number, z: number): number {
  return sampleField(heights, x, z)
}

function sampleField(field: Float32Array, x: number, z: number): number {
  const u = clamp01((x + PATCH) / (PATCH * 2)) * (GRID - 1)
  const v = clamp01((z + PATCH) / (PATCH * 2)) * (GRID - 1)
  const i = Math.min(GRID - 2, Math.floor(u))
  const j = Math.min(GRID - 2, Math.floor(v))
  const tx = u - i
  const tz = v - j
  const a = field[j * GRID + i] ?? 0
  const b = field[j * GRID + i + 1] ?? 0
  const c = field[(j + 1) * GRID + i] ?? 0
  const d = field[(j + 1) * GRID + i + 1] ?? 0
  return a * (1 - tx) * (1 - tz) + b * tx * (1 - tz) + c * (1 - tx) * tz + d * tx * tz
}

function terrainHeight(x: number, z: number, seed: number): number {
  const shift = seed * 0.17
  const broad = simplex2(x * 0.55 + shift, z * 0.55 - shift)
  const fine = simplex2(x * 1.45 + 4.2 + shift, z * 1.45)
  const edge = Math.min(1, Math.hypot(x, z) / PATCH)
  return 0.04 + (broad * 0.5 + 0.5) * 0.46 + (fine * 0.5 + 0.5) * 0.07 - edge * edge * 0.16
}

function inside(x: number, z: number): boolean {
  return Math.abs(x) < PATCH * 0.94 && Math.abs(z) < PATCH * 0.94
}

function splat(field: Float32Array, x: number, z: number, radius: number, amount: number) {
  const reach = radius
  const u0 = clamp01((x - reach + PATCH) / (PATCH * 2))
  const v0 = clamp01((z - reach + PATCH) / (PATCH * 2))
  const u1 = clamp01((x + reach + PATCH) / (PATCH * 2))
  const v1 = clamp01((z + reach + PATCH) / (PATCH * 2))
  const i0 = Math.max(0, Math.floor(u0 * (GRID - 1)) - 1)
  const j0 = Math.max(0, Math.floor(v0 * (GRID - 1)) - 1)
  const i1 = Math.min(GRID - 1, Math.ceil(u1 * (GRID - 1)) + 1)
  const j1 = Math.min(GRID - 1, Math.ceil(v1 * (GRID - 1)) + 1)
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const [cx, cz] = vertex(i, j)
      const dist = Math.hypot(cx - x, cz - z)
      if (dist >= radius) continue
      const weight = Math.exp(-(dist / radius) * (dist / radius) * 2.4)
      const index = j * GRID + i
      field[index] = Math.min(1, (field[index] ?? 0) + amount * weight)
    }
  }
}

function clearField(field: Float32Array) {
  field.fill(0)
}

function writeFields(world: LivingWorld) {
  clearField(world.cover)
  clearField(world.shade)
  clearField(world.foot)
  for (const plant of world.plants) {
    splat(world.cover, plant.x, plant.z, 0.24 + plant.size * 0.3, 0.5 * plant.size)
  }
  for (const member of world.members) {
    const ground0 = sampleHeight(world.heights, member.x0, member.z0)
    const rise = Math.max(0, (member.y0 + member.y1) * 0.5 - ground0)
    const radius = 0.4 + Math.min(0.22, rise * 0.12)
    const x = (member.x0 + member.x1) * 0.5
    const z = (member.z0 + member.z1) * 0.5
    splat(world.shade, x, z, radius, 0.16)
    const y = (member.y0 + member.y1) * 0.5
    if (y - ground0 < 0.16) splat(world.foot, x, z, 0.1, 1)
  }
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1
  return [x / length, y / length, z / length]
}

function placeRoot(world: LivingWorld, x: number, z: number) {
  const y = sampleHeight(world.heights, x, z)
  const lift = 0.24
  world.members.push({
    x0: x,
    y0: y,
    z0: z,
    x1: x + (world.rand() - 0.5) * 0.04,
    y1: y + lift,
    z1: z + (world.rand() - 0.5) * 0.04,
    r0: 0.055,
    r1: 0.042,
  })
  const tip = world.members[world.members.length - 1]!
  const [hx, hy, hz] = normalize(tip.x1 - tip.x0, tip.y1 - tip.y0, tip.z1 - tip.z0)
  world.tips.push({ x: tip.x1, y: tip.y1, z: tip.z1, hx, hy, hz, radius: 0.042, born: 0, credit: 0 })
}

function tryPlant(world: LivingWorld, x: number, z: number, size: number): boolean {
  if (!inside(x, z) || world.plants.length >= MAX_PLANTS) return false
  for (const plant of world.plants) {
    if (Math.hypot(plant.x - x, plant.z - z) < 0.14) return false
  }
  world.plants.push({ x, z, size, age: 0 })
  return true
}

export function createWorld(settings: LivingSettings): LivingWorld {
  const seed = Math.max(1, Math.round(settings.seed))
  const count = GRID * GRID
  const world: LivingWorld = {
    seed,
    step: 0,
    heights: new Float32Array(count),
    cover: new Float32Array(count),
    shade: new Float32Array(count),
    foot: new Float32Array(count),
    plants: [],
    members: [],
    tips: [],
    rand: mulberry32(seed * 10007 + 19),
  }
  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const [x, z] = vertex(i, j)
      world.heights[j * GRID + i] = terrainHeight(x, z, seed)
    }
  }
  const roots: [number, number][] = []
  let guard = 0
  while (roots.length < 3 && guard < 40) {
    guard += 1
    const x = (world.rand() - 0.5) * PATCH * 1.15
    const z = (world.rand() - 0.5) * PATCH * 1.15
    if (roots.some(([rx, rz]) => Math.hypot(rx - x, rz - z) < 0.85)) continue
    roots.push([x, z])
    placeRoot(world, x, z)
  }
  guard = 0
  while (world.plants.length < 8 && guard < 50) {
    guard += 1
    tryPlant(world, (world.rand() - 0.5) * PATCH * 1.5, (world.rand() - 0.5) * PATCH * 1.5, 0.35 + world.rand() * 0.3)
  }
  writeFields(world)
  return world
}

function growPlants(world: LivingWorld, response: number) {
  for (let i = world.plants.length - 1; i >= 0; i -= 1) {
    const plant = world.plants[i]!
    const suit = plantSuitability(
      sampleField(world.shade, plant.x, plant.z),
      sampleField(world.cover, plant.x, plant.z),
      sampleField(world.foot, plant.x, plant.z),
      response,
    )
    plant.size += (suit - plant.size) * 0.38
    plant.age += 1
    if (plant.size < 0.05 && plant.age > 2) world.plants.splice(i, 1)
  }
}

function establishPlants(world: LivingWorld, response: number) {
  let born = 0
  for (let attempt = 0; attempt < 2 && born < 1 && world.plants.length < MAX_PLANTS; attempt += 1) {
    let x: number
    let z: number
    if (world.plants.length && world.rand() < 0.72) {
      const parent = world.plants[Math.floor(world.rand() * world.plants.length)]!
      const angle = world.rand() * Math.PI * 2
      const dist = 0.18 + world.rand() * 0.42
      x = parent.x + Math.cos(angle) * dist
      z = parent.z + Math.sin(angle) * dist
    } else {
      x = (world.rand() - 0.5) * PATCH * 1.7
      z = (world.rand() - 0.5) * PATCH * 1.7
    }
    if (!inside(x, z)) continue
    const suit = plantSuitability(
      sampleField(world.shade, x, z),
      sampleField(world.cover, x, z),
      sampleField(world.foot, x, z),
      response,
    )
    if (world.rand() > suit ** 1.25) continue
    if (tryPlant(world, x, z, 0.16)) born += 1
  }
}

function extendTips(world: LivingWorld, response: number) {
  if (world.members.length >= MAX_MEMBERS) return
  const next: Tip[] = []
  for (const tip of world.tips) {
    if (world.members.length >= MAX_MEMBERS) {
      next.push(tip)
      continue
    }
    const cover = sampleField(world.cover, tip.x, tip.z)
    const shade = sampleField(world.shade, tip.x, tip.z)
    const vigor = structureVigor(shade, cover, response)
    tip.credit += vigor * 0.48
    if (vigor < 0.2 || tip.credit < 1) {
      next.push(tip)
      continue
    }
    tip.credit -= 1
    const help = hump(cover, 0.36, 0.18)
    const probe = 0.16
    const gx = hump(sampleField(world.cover, tip.x + probe, tip.z), 0.36, 0.18) - hump(sampleField(world.cover, tip.x - probe, tip.z), 0.36, 0.18)
    const gz = hump(sampleField(world.cover, tip.x, tip.z + probe), 0.36, 0.18) - hump(sampleField(world.cover, tip.x, tip.z - probe), 0.36, 0.18)
    let hx = tip.hx + (world.rand() - 0.5) * 0.42 + gx * response * 0.9
    let hy = tip.hy + (world.rand() - 0.5) * 0.22 + 0.16
    let hz = tip.hz + (world.rand() - 0.5) * 0.42 + gz * response * 0.9
    const margin = PATCH * 0.78
    if (Math.abs(tip.x) > margin) hx -= Math.sign(tip.x) * 0.95
    if (Math.abs(tip.z) > margin) hz -= Math.sign(tip.z) * 0.95
    const ground = sampleHeight(world.heights, tip.x, tip.z)
    if (tip.y - ground > 1.25) hy -= 0.65
    ;[hx, hy, hz] = normalize(hx, hy, hz)
    const length = 0.1 * Math.min(1.65, vigor)
    let x1 = tip.x + hx * length
    let z1 = tip.z + hz * length
    let y1 = tip.y + hy * length
    if (!inside(x1, z1)) {
      tip.credit += 1
      next.push(tip)
      continue
    }
    const floor = sampleHeight(world.heights, x1, z1) + 0.03
    if (y1 < floor) y1 = floor
    const radius = Math.max(0.016, tip.radius * 0.96)
    world.members.push({
      x0: tip.x,
      y0: tip.y,
      z0: tip.z,
      x1,
      y1,
      z1,
      r0: tip.radius,
      r1: radius,
    })
    const grown: Tip = { x: x1, y: y1, z: z1, hx, hy, hz, radius, born: tip.born + 1, credit: tip.credit }
    next.push(grown)
    if (
      response > 0.05 &&
      help > 0.42 &&
      grown.born > 1 &&
      next.length < MAX_TIPS &&
      world.members.length < MAX_MEMBERS &&
      world.rand() < 0.28 * response
    ) {
      const yaw = (world.rand() - 0.5) * 1.4
      const [bx, by, bz] = normalize(
        hx * Math.cos(yaw) - hz * Math.sin(yaw),
        hy * 0.35 + 0.4,
        hx * Math.sin(yaw) + hz * Math.cos(yaw),
      )
      next.push({ x: x1, y: y1, z: z1, hx: bx, hy: by, hz: bz, radius: radius * 0.85, born: 0, credit: 0 })
    }
  }
  world.tips = next.slice(0, MAX_TIPS)
}

export function stepWorld(world: LivingWorld, settings: LivingSettings) {
  const plants = clamp01(settings.plants)
  const structures = clamp01(settings.structures)
  writeFields(world)
  growPlants(world, plants)
  establishPlants(world, plants)
  extendTips(world, structures)
  world.step += 1
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
    const radius = Math.max(0.01, ring ? r1 : r0)
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

function geometryFrom(positions: number[], indices: number[]): BufferGeometry {
  const geometry = new BufferGeometry()
  if (!positions.length) {
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0.01, 0, 0.01, 0, 0], 3))
    geometry.setIndex([0, 1, 2])
  } else {
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setIndex(indices)
  }
  geometry.computeVertexNormals()
  return geometry
}

export function groundGeometry(world: LivingWorld): BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const index = j * GRID + i
      const [x, z] = vertex(i, j)
      positions.push(x, world.heights[index] ?? 0, z)
      const shade = clamp01(world.shade[index] ?? 0)
      const cover = clamp01(world.cover[index] ?? 0)
      const dark = 1 - shade * 0.62
      colors.push((0.07 + cover * 0.045) * dark, (0.078 + cover * 0.07) * dark, (0.062 + shade * 0.015) * dark)
    }
  }
  for (let j = 0; j < GRID - 1; j += 1) {
    for (let i = 0; i < GRID - 1; i += 1) {
      const a = j * GRID + i
      const b = a + 1
      const c = a + GRID
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export function plantGeometry(world: LivingWorld): BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  for (const plant of world.plants) {
    const y = sampleHeight(world.heights, plant.x, plant.z)
    const height = 0.05 + plant.size * 0.52
    const radius = 0.014 + plant.size * 0.04
    const angle = plant.x * 12.3 + plant.z * 4.7
    const lean = 0.05 + plant.size * 0.1
    const x1 = plant.x + Math.cos(angle) * lean
    const z1 = plant.z + Math.sin(angle) * lean
    addSegment(positions, indices, plant.x, y, plant.z, x1, y + height, z1, radius, radius * 0.42)
    if (plant.size > 0.34) {
      addSegment(
        positions,
        indices,
        plant.x + Math.cos(angle) * lean * 0.55,
        y + height * 0.58,
        plant.z + Math.sin(angle) * lean * 0.55,
        plant.x + Math.cos(angle + 1.15) * lean * 1.5,
        y + height * 0.9,
        plant.z + Math.sin(angle + 1.15) * lean * 1.5,
        radius * 0.55,
        radius * 0.2,
      )
    }
  }
  return geometryFrom(positions, indices)
}

export function structureGeometry(world: LivingWorld): BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  for (const member of world.members) {
    addSegment(positions, indices, member.x0, member.y0, member.z0, member.x1, member.y1, member.z1, member.r0, member.r1)
  }
  return geometryFrom(positions, indices)
}
