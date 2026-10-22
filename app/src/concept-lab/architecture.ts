import { BufferGeometry, Float32BufferAttribute } from 'three'
import { simplex2 } from '../shared/noise/simplex.ts'
import { clamp01, mulberry32, smoothstep } from './rng.ts'

/**
 * Concept Lab — Living Architecture.
 * Distances are meters. One organism grows where its roots are wet and its
 * tips are lit. Low shoots block the downhill flow. The crown casts shade,
 * and shade plants take the damp ground there. A few animals gather in that
 * shade, wet the roots, and stall a low shoot they stand on.
 * A step is a growth pulse, not a calendar day.
 */

export type ArchitectureSettings = {
  seed: number
}

export type ArchitectureWorld = {
  seed: number
  step: number
  heights: Float32Array
  water: Float32Array
  shade: Float32Array
  barrier: Float32Array
  feed: Float32Array
  organisms: Organism[]
  members: ArchMember[]
  tips: ArchTip[]
  plants: ShadePlant[]
  creatures: Creature[]
  springs: number[]
  rand: () => number
}

type Organism = { x: number; z: number }

type ArchMember = {
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
  r0: number
  r1: number
  blocks: boolean
}

type ArchTip = {
  organism: number
  x: number
  y: number
  z: number
  hx: number
  hy: number
  hz: number
  radius: number
  born: number
  credit: number
  kind: 'crown' | 'runner'
}

type ShadePlant = { x: number; z: number; size: number; age: number }

type Creature = { x: number; z: number; yaw: number }

/** Half-width of the patch, in meters. */
export const EXTENT = 7
const GRID = 44
const MAX_MEMBERS = 56
const MAX_TIPS = 10
const MAX_PLANTS = 36
const SIDES = 5

/** Direction toward the sun. Shadows fall the opposite way. */
export const SUN = normalize(0.68, 0.7, 0.18)

function normalize(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1
  return [x / length, y / length, z / length]
}

function vertex(i: number, j: number): [number, number] {
  return [-EXTENT + (i / (GRID - 1)) * EXTENT * 2, -EXTENT + (j / (GRID - 1)) * EXTENT * 2]
}

function sampleField(field: Float32Array, x: number, z: number): number {
  const u = clamp01((x + EXTENT) / (EXTENT * 2)) * (GRID - 1)
  const v = clamp01((z + EXTENT) / (EXTENT * 2)) * (GRID - 1)
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

export function sampleHeight(heights: Float32Array, x: number, z: number): number {
  return sampleField(heights, x, z)
}

function terrainHeight(x: number, z: number, seed: number): number {
  const shift = seed * 0.13
  const uphill = (z + EXTENT) / (EXTENT * 2)
  const valley = Math.exp(-(x * x) / 1.6) * 0.48
  const noise = simplex2(x * 0.55 + shift, z * 0.55 - shift) * 0.05
  return 0.15 + uphill * 2.05 - valley + noise
}

function inside(x: number, z: number): boolean {
  return Math.abs(x) < EXTENT * 0.96 && Math.abs(z) < EXTENT * 0.96
}

function splat(field: Float32Array, x: number, z: number, radius: number, amount: number) {
  const u0 = clamp01((x - radius + EXTENT) / (EXTENT * 2))
  const v0 = clamp01((z - radius + EXTENT) / (EXTENT * 2))
  const u1 = clamp01((x + radius + EXTENT) / (EXTENT * 2))
  const v1 = clamp01((z + radius + EXTENT) / (EXTENT * 2))
  const i0 = Math.max(0, Math.floor(u0 * (GRID - 1)) - 1)
  const j0 = Math.max(0, Math.floor(v0 * (GRID - 1)) - 1)
  const i1 = Math.min(GRID - 1, Math.ceil(u1 * (GRID - 1)) + 1)
  const j1 = Math.min(GRID - 1, Math.ceil(v1 * (GRID - 1)) + 1)
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const [cx, cz] = vertex(i, j)
      const dist = Math.hypot(cx - x, cz - z)
      if (dist >= radius) continue
      const weight = Math.exp(-((dist / radius) * (dist / radius)) * 2.2)
      const index = j * GRID + i
      field[index] = Math.min(1.2, (field[index] ?? 0) + amount * weight)
    }
  }
}

function nearestSpring(x: number, z: number): number {
  const u = clamp01((x + EXTENT) / (EXTENT * 2)) * (GRID - 1)
  const v = clamp01((z + EXTENT) / (EXTENT * 2)) * (GRID - 1)
  const i = Math.max(0, Math.min(GRID - 1, Math.round(u)))
  const j = Math.max(0, Math.min(GRID - 1, Math.round(v)))
  return j * GRID + i
}

/** Shade plants need damp ground in the shade, and they skip deep water and the organism itself. */
export function understorySuit(shade: number, water: number, barrier: number): number {
  const damp = smoothstep(0.012, 0.03, water) * (1 - smoothstep(0.11, 0.2, water))
  const shaded = smoothstep(0.2, 0.55, shade)
  const open = 1 - smoothstep(0.3, 0.75, barrier)
  return clamp01(shaded * damp * open)
}

function writeBodyFields(world: ArchitectureWorld) {
  world.barrier.fill(0)
  world.shade.fill(0)
  for (const member of world.members) {
    for (let s = 0; s <= 3; s += 1) {
      const t = s / 3
      const x = member.x0 + (member.x1 - member.x0) * t
      const y = member.y0 + (member.y1 - member.y0) * t
      const z = member.z0 + (member.z1 - member.z0) * t
      const ground = sampleHeight(world.heights, x, z)
      const rise = Math.max(0, y - ground)
      const sx = x - (SUN[0] / SUN[1]) * rise
      const sz = z - (SUN[2] / SUN[1]) * rise
      splat(world.shade, sx, sz, 0.42 + Math.min(0.55, rise * 0.18), 0.34)
      splat(world.shade, x, z, 0.28, 0.16)
      if (member.blocks && rise < 0.55) splat(world.barrier, x, z, 0.38, 1)
    }
  }
}

function evacuate(world: ArchitectureWorld) {
  const next = new Float32Array(world.water)
  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const index = j * GRID + i
      if ((world.barrier[index] ?? 0) < 0.45 || (world.water[index] ?? 0) <= 0) continue
      const held = world.water[index] ?? 0
      next[index] = 0
      let best = -1
      let bestH = Infinity
      for (let n = 0; n < 4; n += 1) {
        const ni = i + (n === 0 ? 1 : n === 1 ? -1 : 0)
        const nj = j + (n === 2 ? 1 : n === 3 ? -1 : 0)
        if (ni < 0 || nj < 0 || ni >= GRID || nj >= GRID) continue
        const neighbor = nj * GRID + ni
        if ((world.barrier[neighbor] ?? 0) > 0.45) continue
        const h = world.heights[neighbor] ?? 0
        if (h < bestH) {
          bestH = h
          best = neighbor
        }
      }
      if (best >= 0) next[best] = (next[best] ?? 0) + held
    }
  }
  world.water.set(next)
}

function flowOnce(world: ArchitectureWorld) {
  const next = new Float32Array(GRID * GRID)
  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const index = j * GRID + i
      const depth = world.water[index] ?? 0
      if (depth <= 0.0004 || (world.barrier[index] ?? 0) > 0.45) continue
      const here = world.heights[index] ?? 0
      let best = -1
      let bestDrop = 0
      for (let n = 0; n < 4; n += 1) {
        const ni = i + (n === 0 ? 1 : n === 1 ? -1 : 0)
        const nj = j + (n === 2 ? 1 : n === 3 ? -1 : 0)
        if (ni < 0 || nj < 0 || ni >= GRID || nj >= GRID) {
          if (j === 0 && n === 3 && depth + 0.2 > bestDrop) {
            bestDrop = depth + 0.2
            best = -2
          }
          continue
        }
        const neighbor = nj * GRID + ni
        if ((world.barrier[neighbor] ?? 0) > 0.45) continue
        const drop = here + depth - (world.heights[neighbor] ?? 0)
        if (drop > bestDrop) {
          bestDrop = drop
          best = neighbor
        }
      }
      if (best === -2) {
        next[index] = (next[index] ?? 0) + depth * 0.22
        continue
      }
      if (best < 0 || bestDrop <= 0.004) {
        next[index] = (next[index] ?? 0) + depth
        continue
      }
      const moved = Math.min(depth, bestDrop) * 0.78
      next[best] = (next[best] ?? 0) + moved
      next[index] = (next[index] ?? 0) + (depth - moved)
    }
  }
  // A little water wets the bank beside the thread.
  const spread = new Float32Array(next)
  for (let j = 1; j < GRID - 1; j += 1) {
    for (let i = 1; i < GRID - 1; i += 1) {
      const index = j * GRID + i
      const depth = next[index] ?? 0
      if (depth < 0.004) continue
      const leak = depth * 0.08
      spread[index] = (spread[index] ?? 0) - leak
      spread[index - 1] = (spread[index - 1] ?? 0) + leak * 0.5
      spread[index + 1] = (spread[index + 1] ?? 0) + leak * 0.5
    }
  }
  world.water.set(spread)
}

function flowWater(world: ArchitectureWorld) {
  evacuate(world)
  for (const spring of world.springs) {
    if ((world.barrier[spring] ?? 0) > 0.45) continue
    world.water[spring] = (world.water[spring] ?? 0) + 0.16
  }
  for (let pass = 0; pass < 6; pass += 1) flowOnce(world)
  for (let index = 0; index < world.water.length; index += 1) {
    const held = world.water[index] ?? 0
    if (held <= 0) continue
    const keep = 0.93 + 0.06 * clamp01(world.shade[index] ?? 0)
    world.water[index] = Math.min(0.42, held * keep)
  }
}

function placeOrganism(world: ArchitectureWorld, x: number, z: number) {
  const y = sampleHeight(world.heights, x, z)
  const organism = world.organisms.length
  world.organisms.push({ x, z })
  const lift = 1.05
  world.members.push({
    x0: x,
    y0: y,
    z0: z,
    x1: x + 0.06,
    y1: y + lift,
    z1: z + 0.02,
    r0: 0.14,
    r1: 0.09,
    blocks: true,
  })
  const [hx, hy, hz] = normalize(0.08, 1, 0.04)
  world.tips.push({
    organism,
    x: x + 0.05,
    y: y + lift,
    z: z + 0.02,
    hx,
    hy,
    hz,
    radius: 0.08,
    born: 0,
    credit: 0,
    kind: 'crown',
  })
}

function growPlants(world: ArchitectureWorld) {
  for (let i = world.plants.length - 1; i >= 0; i -= 1) {
    const plant = world.plants[i]!
    const suit = understorySuit(
      sampleField(world.shade, plant.x, plant.z),
      sampleField(world.water, plant.x, plant.z),
      sampleField(world.barrier, plant.x, plant.z),
    )
    plant.size += (suit - plant.size) * 0.35
    plant.age += 1
    if (plant.size < 0.06 && plant.age > 3) world.plants.splice(i, 1)
  }
  let born = 0
  for (let attempt = 0; attempt < 16 && born < 2 && world.plants.length < MAX_PLANTS; attempt += 1) {
    let x: number
    let z: number
    const organism = world.organisms[Math.floor(world.rand() * world.organisms.length)]
    if (organism && world.rand() < 0.8) {
      const reach = 0.35 + world.rand() * 2.4
      x = organism.x - SUN[0] * reach + (world.rand() - 0.5) * 0.9
      z = organism.z - SUN[2] * reach + (world.rand() - 0.5) * 1.4
    } else {
      x = (world.rand() - 0.5) * EXTENT * 1.5
      z = (world.rand() - 0.5) * EXTENT * 1.5
    }
    if (!inside(x, z)) continue
    if (world.plants.some((plant) => Math.hypot(plant.x - x, plant.z - z) < 0.42)) continue
    const suit = understorySuit(
      sampleField(world.shade, x, z),
      sampleField(world.water, x, z),
      sampleField(world.barrier, x, z),
    )
    if (suit < 0.45 || world.rand() > suit) continue
    world.plants.push({ x, z, size: 0.28, age: 0 })
    born += 1
  }
}

function moveCreatures(world: ArchitectureWorld) {
  world.feed.fill(0)
  for (const creature of world.creatures) {
    const probe = 0.7
    const shadeHere = sampleField(world.shade, creature.x, creature.z)
    const gx = sampleField(world.shade, creature.x + probe, creature.z) - sampleField(world.shade, creature.x - probe, creature.z)
    const gz = sampleField(world.shade, creature.x, creature.z + probe) - sampleField(world.shade, creature.x, creature.z - probe)
    const wx = sampleField(world.water, creature.x + probe, creature.z) - sampleField(world.water, creature.x - probe, creature.z)
    const wz = sampleField(world.water, creature.x, creature.z + probe) - sampleField(world.water, creature.x, creature.z - probe)
    const shadeWeight = shadeHere > 0.18 ? 2.4 : 0.4
    const waterWeight = shadeHere > 0.18 ? 0.2 : 1.3
    let hx = gx * shadeWeight + wx * waterWeight + (world.rand() - 0.5) * 0.12
    let hz = gz * shadeWeight + wz * waterWeight + (world.rand() - 0.5) * 0.12
    if (Math.hypot(creature.x, creature.z) > 3.4 && shadeHere < 0.2) {
      hx -= creature.x * 0.45
      hz -= creature.z * 0.45
    }
    if (Math.hypot(hx, hz) < 0.05) {
      hx = Math.cos(creature.yaw)
      hz = Math.sin(creature.yaw)
    }
    const speed = shadeHere > 0.45 ? 0.28 : 0.95
    const length = Math.hypot(hx, hz) || 1
    creature.x = Math.max(-EXTENT * 0.9, Math.min(EXTENT * 0.9, creature.x + (hx / length) * speed))
    creature.z = Math.max(-EXTENT * 0.9, Math.min(EXTENT * 0.9, creature.z + (hz / length) * speed))
    creature.yaw = Math.atan2(hz, hx)
    splat(world.feed, creature.x, creature.z, 0.85, 0.045)
  }
}

function rootMoisture(world: ArchitectureWorld, organism: Organism): number {
  return sampleField(world.water, organism.x, organism.z) + sampleField(world.feed, organism.x, organism.z)
}

function browsed(world: ArchitectureWorld, x: number, z: number): boolean {
  return world.creatures.some((creature) => Math.hypot(creature.x - x, creature.z - z) < 0.42)
}

function extendTips(world: ArchitectureWorld) {
  if (world.members.length >= MAX_MEMBERS) return
  const next: ArchTip[] = []
  for (const tip of world.tips) {
    const organism = world.organisms[tip.organism]
    if (!organism || world.members.length >= MAX_MEMBERS) {
      next.push(tip)
      continue
    }
    const moist = rootMoisture(world, organism)
    const wet = smoothstep(0.01, 0.028, moist)
    // The ground directly under a tip is in its own shadow. Light is read on the sunward side.
    const shade = sampleField(world.shade, tip.x + SUN[0] * 0.6, tip.z + SUN[2] * 0.6)
    const lit = 1 - smoothstep(0.25, 0.85, shade)
    const energy = tip.kind === 'runner' ? wet : wet * lit
    const slowed = tip.kind === 'runner' && tip.born > 1 && browsed(world, tip.x, tip.z)
    tip.credit += energy * (slowed ? 0.35 : 1.05)
    if (energy < 0.08 || tip.credit < 1 || (tip.kind === 'runner' && tip.born > 8)) {
      if (tip.kind === 'crown' || tip.born <= 8) next.push(tip)
      continue
    }
    tip.credit -= 1
    const ground = sampleHeight(world.heights, tip.x, tip.z)
    let hx = tip.hx
    let hy = tip.hy
    let hz = tip.hz
    if (tip.kind === 'runner') {
      const probe = 0.55
      const gx = sampleField(world.water, tip.x + probe, tip.z) - sampleField(world.water, tip.x - probe, tip.z)
      const gz = sampleField(world.water, tip.x, tip.z + probe) - sampleField(world.water, tip.x, tip.z - probe)
      hx = gx * 2.2 + (world.rand() - 0.5) * 0.2
      hz = gz * 2.2 - 0.28 + (world.rand() - 0.5) * 0.2
      hy = 0.04
    } else {
      hx = SUN[0] * (0.45 + shade) + (world.rand() - 0.5) * 0.22
      hy = 0.42 + lit * 0.35
      hz = SUN[2] * (0.45 + shade) + (world.rand() - 0.5) * 0.22
      if (tip.y - ground > 3.6) hy -= 0.45
    }
    ;[hx, hy, hz] = normalize(hx, hy, hz)
    const length = (tip.kind === 'runner' ? 0.38 : 0.46) * Math.max(0.45, Math.min(1, energy + 0.35))
    let x1 = tip.x + hx * length
    let z1 = tip.z + hz * length
    let y1 = tip.y + hy * length
    if (!inside(x1, z1)) {
      tip.credit += 1
      next.push(tip)
      continue
    }
    const floor = sampleHeight(world.heights, x1, z1)
    if (tip.kind === 'runner') y1 = floor + 0.16
    else if (y1 < floor + 0.2) y1 = floor + 0.2
    const radius = Math.max(0.02, tip.radius * (tip.kind === 'runner' ? 0.97 : 0.94))
    world.members.push({
      x0: tip.x,
      y0: tip.y,
      z0: tip.z,
      x1,
      y1,
      z1,
      r0: tip.radius,
      r1: radius,
      blocks: tip.kind === 'runner' || tip.y - ground < 0.7,
    })
    const grown: ArchTip = { ...tip, x: x1, y: y1, z: z1, hx, hy, hz, radius, born: tip.born + 1 }
    next.push(grown)
    const crowns = next.filter((item) => item.kind === 'crown').length
    if (
      tip.kind === 'crown' &&
      grown.born > 2 &&
      grown.y - floor > 1.3 &&
      lit > 0.45 &&
      wet > 0.4 &&
      crowns < 6 &&
      world.members.length < MAX_MEMBERS &&
      world.rand() < 0.22
    ) {
      const yaw = (world.rand() > 0.5 ? 1 : -1) * (0.5 + world.rand() * 0.5)
      const [bx, by, bz] = normalize(SUN[0] * Math.cos(yaw) - SUN[2] * Math.sin(yaw), 0.55, SUN[0] * Math.sin(yaw) + SUN[2] * Math.cos(yaw))
      next.push({
        organism: tip.organism,
        x: x1,
        y: y1,
        z: z1,
        hx: bx,
        hy: by,
        hz: bz,
        radius: radius * 0.82,
        born: 0,
        credit: 0,
        kind: 'crown',
      })
    }
  }
  for (let index = 0; index < world.organisms.length && next.length < MAX_TIPS; index += 1) {
    const organism = world.organisms[index]!
    const runners = next.filter((tip) => tip.organism === index && tip.kind === 'runner').length
    if (runners >= 1) continue
    if (smoothstep(0.012, 0.04, rootMoisture(world, organism)) < 0.35) continue
    if (world.rand() > 0.45) continue
    const y = sampleHeight(world.heights, organism.x, organism.z) + 0.16
    const probe = 0.55
    const gx = sampleField(world.water, organism.x + probe, organism.z) - sampleField(world.water, organism.x - probe, organism.z)
    const gz = sampleField(world.water, organism.x, organism.z + probe) - sampleField(world.water, organism.x, organism.z - probe)
    const [hx, hy, hz] = normalize(gx, 0.02, gz - 0.2)
    next.push({
      organism: index,
      x: organism.x,
      y,
      z: organism.z,
      hx,
      hy,
      hz,
      radius: 0.13,
      born: 0,
      credit: 0.4,
      kind: 'runner',
    })
  }
  world.tips = next.slice(0, MAX_TIPS)
}

export function createWorld(settings: ArchitectureSettings): ArchitectureWorld {
  const seed = Math.max(1, Math.round(settings.seed))
  const count = GRID * GRID
  const world: ArchitectureWorld = {
    seed,
    step: 0,
    heights: new Float32Array(count),
    water: new Float32Array(count),
    shade: new Float32Array(count),
    barrier: new Float32Array(count),
    feed: new Float32Array(count),
    organisms: [],
    members: [],
    tips: [],
    plants: [],
    creatures: [],
    springs: [],
    rand: mulberry32(seed * 9133 + 11),
  }
  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const [x, z] = vertex(i, j)
      world.heights[j * GRID + i] = terrainHeight(x, z, seed)
    }
  }
  world.springs = [nearestSpring(0.1, 5.1), nearestSpring(-0.35, 4.5), nearestSpring(0.45, 3.8)]
  for (let warm = 0; warm < 18; warm += 1) flowWater(world)
  placeOrganism(world, 0.22, 1.35)
  placeOrganism(world, 0.3, -0.85)
  world.creatures = [
    { x: -0.4, z: -1.6, yaw: 0.4 },
    { x: 0.3, z: -3.4, yaw: 1.1 },
    { x: -1.1, z: 0.2, yaw: -0.6 },
  ]
  writeBodyFields(world)
  return world
}

export function stepWorld(world: ArchitectureWorld) {
  writeBodyFields(world)
  flowWater(world)
  moveCreatures(world)
  growPlants(world)
  extendTips(world)
  writeBodyFields(world)
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
  let sx = -uz * ay
  let sy = uz * ax - ux * 0
  let sz = ux * ay
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
    const radius = Math.max(0.015, ring ? r1 : r0)
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

export function groundGeometry(world: ArchitectureWorld): BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const index = j * GRID + i
      const [x, z] = vertex(i, j)
      positions.push(x, world.heights[index] ?? 0, z)
      const shade = clamp01(world.shade[index] ?? 0)
      const wet = clamp01((world.water[index] ?? 0) * 14 + (world.feed[index] ?? 0) * 6)
      const dark = 1 - shade * 0.58
      const r = (0.2 * (1 - wet) + 0.07 * wet) * dark
      const g = (0.17 * (1 - wet) + 0.16 * wet) * dark
      const b = (0.12 * (1 - wet) + 0.18 * wet) * dark
      colors.push(r, g, b)
    }
  }
  for (let j = 0; j < GRID - 1; j += 1) {
    for (let i = 0; i < GRID - 1; i += 1) {
      const a = j * GRID + i
      const b = a + 1
      const c = a + GRID
      indices.push(a, c, b, b, c, c + 1)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export function waterGeometry(world: ArchitectureWorld): BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  for (let j = 0; j < GRID - 1; j += 1) {
    for (let i = 0; i < GRID - 1; i += 1) {
      const corners = [j * GRID + i, j * GRID + i + 1, (j + 1) * GRID + i, (j + 1) * GRID + i + 1]
      const depth = corners.reduce((sum, index) => sum + (world.water[index] ?? 0), 0) / 4
      if (depth < 0.012) continue
      const base = positions.length / 3
      for (const index of corners) {
        const [x, z] = vertex(index % GRID, Math.floor(index / GRID))
        const film = Math.min(0.22, world.water[index] ?? 0)
        positions.push(x, (world.heights[index] ?? 0) + 0.045 + film, z)
      }
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
    }
  }
  return geometryFrom(positions, indices)
}

export function architectureGeometry(world: ArchitectureWorld): BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  for (const member of world.members) {
    addSegment(positions, indices, member.x0, member.y0, member.z0, member.x1, member.y1, member.z1, member.r0, member.r1)
  }
  return geometryFrom(positions, indices)
}

export function understoryGeometry(world: ArchitectureWorld): BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  for (const plant of world.plants) {
    const y = sampleHeight(world.heights, plant.x, plant.z)
    const height = 0.16 + plant.size * 0.7
    const radius = 0.03 + plant.size * 0.05
    const angle = plant.x * 1.7 + plant.z * 0.8
    const lean = 0.04 + plant.size * 0.08
    addSegment(
      positions,
      indices,
      plant.x,
      y,
      plant.z,
      plant.x + Math.cos(angle) * lean,
      y + height,
      plant.z + Math.sin(angle) * lean,
      radius,
      radius * 0.35,
    )
  }
  return geometryFrom(positions, indices)
}

export function creatureGeometry(world: ArchitectureWorld): BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  for (const creature of world.creatures) {
    const y = sampleHeight(world.heights, creature.x, creature.z)
    const fx = Math.cos(creature.yaw)
    const fz = Math.sin(creature.yaw)
    const length = 0.52
    const radius = 0.11
    addSegment(
      positions,
      indices,
      creature.x - fx * length * 0.35,
      y + 0.14,
      creature.z - fz * length * 0.35,
      creature.x + fx * length * 0.45,
      y + 0.18,
      creature.z + fz * length * 0.45,
      radius,
      radius * 0.55,
    )
  }
  return geometryFrom(positions, indices)
}
