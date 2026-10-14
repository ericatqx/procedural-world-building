/**
 * Shadow Ecology 0.2 — shared constants and small helpers. The landmass is
 * its own larger terrain (landform.ts), drawn at WORLD_SCALE; everything
 * that changes while the simulation runs lives in plain data, so a whole
 * state can be cloned for history branches.
 */

export type Resolution = 'low' | 'medium' | 'high'

/**
 * The landform is authored in its own units — a wider island than 0.1, with
 * more ridges and valleys in the noise, not a scaled copy — and drawn at
 * WORLD_SCALE. Slopes are unchanged by that draw scale. Members and plants
 * keep their world size.
 */
export const WORLD_SCALE = 2.2

/** World-space thickness of a grown member, the same at every resolution. */
export const MEMBER = 0.2

/**
 * Voxel size per resolution. `brush` voxels make one member, so the form
 * keeps its world-space scale: finer resolutions step more finely and
 * crumble more finely, but grow the same structure.
 */
export const RESOLUTIONS: Record<Resolution, { voxel: number; brush: number; label: string }> = {
  low: { voxel: MEMBER, brush: 1, label: 'Low' },
  medium: { voxel: MEMBER / 2, brush: 2, label: 'Medium' },
  high: { voxel: MEMBER / 3, brush: 3, label: 'High' },
}

/**
 * The architecture lattice: a square of side SPAN from (X0, Z0) in xz, and
 * BASE…BASE + HEIGHT in y. It spans the whole island, a little past the
 * rim so members can cantilever over the edge; its vertical range starts
 * just under the lake shores (ground below BASE carries no footing), and the
 * simulation only visits chunks that hold voxels, so the cost follows the
 * architecture rather than the area. The span covers the larger landmass.
 */
export const LATTICE_SPAN = 36
export const LATTICE_X0 = -18
export const LATTICE_Z0 = -18
export const LATTICE_BASE = -1.4
export const LATTICE_HEIGHT = 7.4

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

export const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Serialisable random state (mulberry32), so a branch replays exactly. */
export type Rng = { s: number }

export const createRng = (seed: number): Rng => ({ s: seed >>> 0 })

export function random(rng: Rng): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0
  let t = rng.s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Stable 0…1 hash of an integer. */
export const hash01 = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

export type Vec3 = [number, number, number]

/** The observation lens: inside its radius growth, movement and decay slow to `slow`. */
export type Lens = { x: number; z: number; radius: number; slow: number }

/** Local time multiplier at (x, z): `slow` inside the lens, easing to 1 across its rim. */
export function lensFactor(lens: Lens | null, x: number, z: number): number {
  if (!lens) {
    return 1
  }
  const d = Math.hypot(x - lens.x, z - lens.z)
  return lerp(lens.slow, 1, smoothstep(lens.radius * 0.8, lens.radius, d))
}
