import { clamp01, smoothstep } from '../project02/core.ts'
import { landscapeHeight } from './terrain.ts'

/**
 * Shadow Ecology 0.3 — procedural vegetation: habitats, three archetypes, and how each ages. Nothing is placed by hand.
 *
 * HABITAT. The conditions at a point (elevation, slope, water, light, moisture, and what a structure does to the ground) are
 * read as soft ZONES, each 0 to 1 and overlapping, so habitats grade into one another:
 *   rock      steep ground: bare             alpine   high ground: thin, low
 *   shore     within a few tens of metres of water      moist    damp lowland, away from the edge
 *   dry       exposed, dry, lit ground      shaded   under or in the lee of a structure: roofed, shaded, kept damp
 * ARCHETYPES (their suitability is a mix of zones, so composition changes with habitat):
 *   cover   ground cover: lush in moist lowland, on the shore and in shade; thin on dry ground; mats persist high up
 *   shrub   broad, shade-tolerant: thick in sheltered ground, present on dry margins and moist ground; avoids the water's edge
 *   tall    light-seeking spire: groves on open, lit, moist ground and the shore; none in shade, on dry ground or high up
 * COMMUNITIES. A seeded patch field (about 45 m across) gates each archetype, so the same habitat holds lush clumps and bare
 * gaps instead of an even scatter; suitability sets how dense and how large.
 * INDIVIDUALS. Candidate sites are a jittered grid per archetype; each has seeded draws for its offset, chance, size, yaw, tint
 * and the phase of its life, so a site is the same plant every time and only its conditions change.
 * LIFE. A site cycles: a plant grows (1 − e^(−age/τ)), thins in its last years, dies, and the site is bare before the next.
 */
export type Archetype = 'cover' | 'shrub' | 'tall'
export const ARCHETYPES: readonly Archetype[] = ['cover', 'shrub', 'tall']

export type Spec = { label: string; spacing: number; density: number; radius: number; height: number; tau: number; life: number; gap: number; colour: string; tint: number }

export const SPECS: Record<Archetype, Spec> = {
  cover: { label: 'Ground cover', spacing: 2.4, density: 1, radius: 1.0, height: 0.45, tau: 4, life: 40, gap: 4, colour: '#476e52', tint: 0.12 },
  shrub: { label: 'Shrub', spacing: 5, density: 0.8, radius: 2.2, height: 1.8, tau: 14, life: 90, gap: 10, colour: '#7b8754', tint: 0.14 },
  tall: { label: 'Tall plant', spacing: 8, density: 0.7, radius: 0.9, height: 7.5, tau: 35, life: 150, gap: 20, colour: '#a9a47e', tint: 0.08 },
}

export type Conditions = { height: number; slope: number; waterDepth: number; waterDist: number; light: number; moisture: number; footprint: number; shade: number; shelter: number; x: number; z: number; /** Clear air under a structure at this point, and the least of it within a crown's reach (metres; absent away from architecture). */ ceiling?: number; crown?: number }

export type Zones = { rock: number; alpine: number; shore: number; moist: number; dry: number; shaded: number }
export const ZONE_KEYS: readonly (keyof Zones)[] = ['moist', 'shore', 'dry', 'shaded', 'alpine', 'rock']
export const ZONE_LABEL: Record<keyof Zones, string> = { moist: 'Moist lowland', shore: 'Shore', dry: 'Dry, exposed', shaded: 'Sheltered, shaded', alpine: 'High ground', rock: 'Rock, steep' }
export const ZONE_COLOUR: Record<keyof Zones, string> = { moist: '#4fa05a', shore: '#2fa6a0', dry: '#d2a850', shaded: '#8a72c8', alpine: '#8fb0d4', rock: '#8c8a86' }

/** Effective light and moisture: a structure's shade takes light, and shade and shelter keep the ground damper. */
export function effective(light0: number, moisture0: number, shade: number, shelter: number) {
  return { light: light0 * (1 - 0.85 * shade), moisture: clamp01(moisture0 + 0.4 * Math.max(shade, shelter) * (1 - moisture0)) }
}

export function zonesOf(c: Conditions): Zones {
  const shore = Math.exp(-Math.max(0, c.waterDist - 2) / 18)
  return {
    rock: smoothstep(0.34, 0.7, c.slope),
    alpine: smoothstep(200, 420, c.height),
    shore,
    moist: smoothstep(0.36, 0.7, c.moisture) * (1 - shore),
    dry: (1 - smoothstep(0.14, 0.4, c.moisture)) * (1 - smoothstep(200, 420, c.height)) * smoothstep(0.35, 0.8, c.light),
    shaded: Math.max(c.shelter, c.shade * 1.3 > 1 ? 1 : c.shade * 1.3),
  }
}

/** 0 to 1: how well the ground suits each archetype. */
export function suitability(a: Archetype, c: Conditions, z: Zones = zonesOf(c)): number {
  if (c.footprint > 0.3 || c.waterDepth > 0.05 || c.waterDist < 1.5) return 0
  const bare = 1 - z.rock
  if (a === 'cover') {
    const base = 0.12 + 0.88 * Math.max(z.moist, z.shore * 0.95, z.shaded * 0.85)
    return base * (1 - 0.82 * z.dry) * (1 - 0.5 * z.alpine) * bare
  }
  if (a === 'shrub') {
    const base = Math.max(z.shaded * 1.05, z.moist * 0.6, z.dry * 0.5, z.shore * 0.25, 0.08)
    return base * (1 - 0.6 * z.alpine) * bare * bare
  }
  const lit = smoothstep(0.45, 0.85, c.light)
  return Math.max(z.moist * 0.95, z.shore * 0.8) * lit * (1 - z.shaded) * (1 - z.dry) * (1 - z.alpine) * bare * bare
}

const hash = (a: number, b: number, c: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
  return x - Math.floor(x)
}
const sm = (t: number) => t * t * (3 - 2 * t)
function vnoise(x: number, z: number, s: number) {
  const i = Math.floor(x)
  const j = Math.floor(z)
  const fx = sm(x - i)
  const fz = sm(z - j)
  const h = (a: number, b: number) => hash(i + a, j + b, s)
  return h(0, 0) * (1 - fx) * (1 - fz) + h(1, 0) * fx * (1 - fz) + h(0, 1) * (1 - fx) * fz + h(1, 1) * fx * fz
}
/** The community patch field, 0 to 1, about 45 m across with finer variation, for one archetype. */
export function patch(arch: Archetype, seed: number, x: number, z: number): number {
  const s = (seed % 9973) + ARCHETYPES.indexOf(arch) * 131
  const p = 0.65 * vnoise(x / 45, z / 45, s) + 0.35 * vnoise(x / 17, z / 17, s + 7)
  return smoothstep(arch === 'tall' ? 0.5 : 0.36, arch === 'tall' ? 0.7 : 0.62, p)
}

/** How many plants per site the community patch and habitat allow: the chance a candidate is taken. */
export function chance(a: Archetype, c: Conditions, seed: number, z?: Zones): number {
  const s = suitability(a, c, z)
  if (s <= 0) return 0
  const community = a === 'tall' ? 0.04 + 0.96 * patch(a, seed, c.x, c.z) : 0.1 + 0.9 * patch(a, seed, c.x, c.z)
  return Math.min(1, SPECS[a].density * s ** 1.4 * community * (a === 'cover' ? 1.3 : 1))
}

export type Plan = { arch: Archetype; count: number; x: Float32Array; z: Float32Array; y: Float32Array; draw: Float32Array }
const DRAWS = 6

/** Candidate sites for one archetype over a square (a tile), as a jittered grid with seeded draws. Deterministic per tile. */
export function planTile(arch: Archetype, seed: number, x0: number, z0: number, size: number, spacing = SPECS[arch].spacing): Plan {
  const cols = Math.floor(size / spacing)
  const count = cols * cols
  const ai = ARCHETYPES.indexOf(arch)
  const x = new Float32Array(count)
  const z = new Float32Array(count)
  const y = new Float32Array(count)
  const draw = new Float32Array(count * DRAWS)
  const tx = Math.round(x0 / size)
  const tz = Math.round(z0 / size)
  for (let k = 0; k < count; k += 1) {
    const i = k % cols
    const j = Math.floor(k / cols)
    for (let d = 0; d < DRAWS; d += 1) draw[k * DRAWS + d] = hash(seed * 0.001 + ai + tx * 0.37, k + tz * 7919, d)
    x[k] = x0 + (i + 0.1 + 0.8 * draw[k * DRAWS]!) * spacing
    z[k] = z0 + (j + 0.1 + 0.8 * draw[k * DRAWS + 1]!) * spacing
    y[k] = landscapeHeight(x[k]!, z[k]!)
  }
  return { arch, count, x, z, y, draw }
}

export type Instances = { count: number; dry: Float32Array; deep: Float32Array; x: Float32Array; y: Float32Array; z: Float32Array; sx: Float32Array; sy: Float32Array; yaw: Float32Array; leanX: Float32Array; leanZ: Float32Array; tint: Float32Array }
export const emptyInstances = (cap: number): Instances => ({ count: 0, dry: new Float32Array(cap), deep: new Float32Array(cap), x: new Float32Array(cap), y: new Float32Array(cap), z: new Float32Array(cap), sx: new Float32Array(cap), sy: new Float32Array(cap), yaw: new Float32Array(cap), leanX: new Float32Array(cap), leanZ: new Float32Array(cap), tint: new Float32Array(cap) })

/**
 * Appends to `out` the plants that stand at a world year. `at` gives the conditions at a site; `scale` makes individuals larger
 * (the far layer draws clumps, not plants); `skip` drops sites (those a nearer layer already draws). With `out` null, only counts.
 */
export function plantsAt(plan: Plan, at: (x: number, z: number, y: number) => Conditions, sunMean: [number, number], seed: number, year: number, out: Instances | null, scale = 1, skip?: (x: number, z: number) => boolean): number {
  const spec = SPECS[plan.arch]
  const cycle = spec.life + spec.gap
  let n = 0
  for (let k = 0; k < plan.count; k += 1) {
    const d = k * DRAWS
    const age = (year + plan.draw[d + 5]! * cycle) % cycle
    if (age > spec.life) continue
    if (skip && skip(plan.x[k]!, plan.z[k]!)) continue
    const c = at(plan.x[k]!, plan.z[k]!, plan.y[k]!)
    const z = zonesOf(c)
    const s = suitability(plan.arch, c, z)
    if (s <= 0) continue
    if (plan.draw[d + 2]! >= chance(plan.arch, c, seed, z)) continue
    const grow = 1 - Math.exp(-age / spec.tau)
    const old = 1 - 0.55 * smoothstep(spec.life * 0.85, spec.life, age)
    const vary = 0.7 + 0.6 * plan.draw[d + 3]!
    // Thriving plants are fuller; poor ground gives small ones.
    const vigor = 0.4 + 0.6 * Math.min(1, s * 1.5)
    const size = grow * old * vary * vigor * scale
    if (size < 0.04) continue
    n += 1
    if (!out) continue
    const i = out.count
    out.x[i] = plan.x[k]!
    out.y[i] = plan.y[k]! - 0.08
    out.z[i] = plan.z[k]!
    out.sx[i] = Math.max(0.05, spec.radius * size)
    out.sy[i] = Math.max(0.05, spec.height * size * (plan.arch === 'shrub' ? 0.8 + 0.4 * plan.draw[d + 4]! : 1))
    out.yaw[i] = plan.draw[d + 4]! * Math.PI * 2
    const lean = plan.arch === 'tall' ? 0.06 + 0.22 * c.shade : 0
    out.leanX[i] = lean * sunMean[0]
    out.leanZ[i] = lean * sunMean[1]
    out.tint[i] = plan.draw[d + 3]!
    out.dry[i] = z.dry
    out.deep[i] = Math.max(z.shaded, z.shore * 0.6)
    out.count += 1
  }
  return n
}

/** The colour of the habitat at a point: its zones' colours, blended by weight, over a neutral ground. */
export function habitatColour(z: Zones, out: [number, number, number]) {
  const hex = (h: string) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255] as const
  let r = 0.46
  let g = 0.46
  let b = 0.44
  let w = 0.35
  r *= w
  g *= w
  b *= w
  for (const k of ZONE_KEYS) {
    const c = HEX[k] ?? hex(ZONE_COLOUR[k])
    // Rock and high ground count for more where they are, so steep faces read as grey, not green.
    const wt = z[k] ** 1.2
    r += c[0] * wt
    g += c[1] * wt
    b += c[2] * wt
    w += wt
  }
  out[0] = r / w
  out[1] = g / w
  out[2] = b / w
}
const HEX: Partial<Record<keyof Zones, readonly [number, number, number]>> = Object.fromEntries(ZONE_KEYS.map((k) => [k, [parseInt(ZONE_COLOUR[k].slice(1, 3), 16) / 255, parseInt(ZONE_COLOUR[k].slice(3, 5), 16) / 255, parseInt(ZONE_COLOUR[k].slice(5, 7), 16) / 255] as const]))
