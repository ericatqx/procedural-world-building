/**
 * Week 08 — Scale. One working scale for the whole study: 1 unit = 1 metre. Everything below is in metres, and the numbers that
 * come from Shadow Ecology 0.3 are copied here as documented constants (the exercise does not import the project).
 *
 * The pure maths: how big a thing looks from a distance (pixels, angle), the smallest feature that stays visible, how to hold an
 * object's apparent size while the field of view changes (the dolly zoom), and how to turn a set of simple solids into cells
 * at a chosen resolution.
 */

/** From Shadow Ecology 0.3 (for reference, not imported). */
export const PROJECT_SCALE = {
  /** The island's width, metres. */
  island: 4096,
  /** The walker's eye height in Explore. */
  eye: 1.75,
  /** LA-01, the reference Living Architecture organism, about this tall. */
  la01: 38,
  /** A voxel of the 0.3 occupancy experiment, and the finest field of the reference form. */
  voxel: 1.5,
  field: 0.8,
} as const

export type Shape = 'box' | 'ellipsoid' | 'cylinder' | 'cone'
/** A solid: centre (y up, the object stands on y = 0) and full size. Cylinders and cones are upright (x and z are the diameter). */
export type Part = { shape: Shape; c: [number, number, number]; s: [number, number, number] }

export type ScaleObject = {
  id: string
  label: string
  /** What it stands for in Shadow Ecology. */
  role: string
  /** Where its group sits along the lineup, metres. */
  at: number
  /** Whether its size is only an assumption so far (nothing in Shadow Ecology 0.3 fixes it yet). */
  provisional: boolean
  /** Where the size comes from, or why it is only a placeholder. */
  basis: string
  /** For vegetation: how it lives, and so what shape it takes. */
  habit?: string
  parts: Part[]
}

/** Placeholders at true proportion, made of a few solids each: a study of size, not of form. */
export const OBJECTS: readonly ScaleObject[] = [
  {
    id: 'person',
    label: 'Person',
    role: 'The Explore camera: eye height 1.75 m',
    at: -7,
    provisional: false,
    basis: 'The walker’s eye height in Shadow Ecology 0.3 (1.75 m); the body is a stand-in.',
    parts: [
      { shape: 'cylinder', c: [0, 0.4, 0], s: [0.32, 0.8, 0.32] },
      { shape: 'ellipsoid', c: [0, 1.15, 0], s: [0.44, 0.72, 0.26] },
      { shape: 'ellipsoid', c: [0, 1.63, 0], s: [0.22, 0.24, 0.22] },
    ],
  },
  {
    id: 'creature',
    label: 'Creature',
    role: 'A light-fin creature, perched: body 0.9 m, wings 3.3 m across, 3 cm thin',
    at: -2,
    provisional: true,
    basis: 'No creature exists in 0.3 yet: these sizes are a guess from the concept art.',
    parts: [
      { shape: 'ellipsoid', c: [0, 0.25, 0], s: [0.9, 0.5, 0.4] },
      { shape: 'box', c: [-1.0, 0.5, 0], s: [1.5, 0.03, 0.7] },
      { shape: 'box', c: [1.0, 0.5, 0], s: [1.5, 0.03, 0.7] },
    ],
  },
  {
    id: 'shrub',
    label: 'Shade shrub',
    role: 'Vegetation under shelter: about 2 m',
    at: 4,
    provisional: true,
    basis: 'No 0.3 vegetation yet: a plausible size for a low, shade-living plant.',
    habit: 'Shade-tolerant and spreading: low and wider than tall, it fills the shelter under a structure.',
    parts: [
      { shape: 'cylinder', c: [0, 0.4, 0], s: [0.25, 0.8, 0.25] },
      { shape: 'ellipsoid', c: [0, 1.0, 0], s: [2.2, 1.5, 2.2] },
      { shape: 'ellipsoid', c: [0, 1.9, 0], s: [1.2, 1.0, 1.2] },
    ],
  },
  {
    id: 'spire',
    label: 'Spire plant',
    role: 'Light-seeking vegetation: a 9 m spire',
    at: 11,
    provisional: true,
    basis: 'No 0.3 vegetation yet: a plausible size for a tall plant reaching for light.',
    habit: 'Light-seeking and vertical: tall and narrow, it climbs out of shade on open, sunlit ground.',
    parts: [{ shape: 'cone', c: [0, 4.5, 0], s: [2.4, 9, 2.4] }],
  },
  {
    id: 'la01',
    label: 'Living Architecture',
    role: 'LA-01, the reference organism: a keep, a shelf and props, about 38 m',
    at: 42,
    provisional: true,
    basis: 'A box-and-prop silhouette at about the reference organism’s height; the real form is still under evaluation.',
    parts: [
      { shape: 'box', c: [-8, 2.5, 0], s: [26, 5, 28] },
      { shape: 'box', c: [-8, 19, 0], s: [20, 38, 22] },
      { shape: 'box', c: [10, 20, 0], s: [40, 4.5, 18] },
      { shape: 'cylinder', c: [22, 9, 0], s: [5, 18, 5] },
      { shape: 'cylinder', c: [15, 9, -6], s: [4, 18, 4] },
    ],
  },
]

export type Bounds = { min: [number, number, number]; max: [number, number, number] }

export function boundsOf(parts: readonly Part[]): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const p of parts) {
    for (let a = 0; a < 3; a += 1) {
      min[a] = Math.min(min[a]!, p.c[a]! - p.s[a]! / 2)
      max[a] = Math.max(max[a]!, p.c[a]! + p.s[a]! / 2)
    }
  }
  return { min, max }
}

export function sizeOf(parts: readonly Part[]): [number, number, number] {
  const b = boundsOf(parts)
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]
}

/** Whether a point (the object's own frame, metres) lies inside any of its solids. */
export function inside(parts: readonly Part[], x: number, y: number, z: number): boolean {
  for (const p of parts) {
    const dx = x - p.c[0]
    const dy = y - p.c[1]
    const dz = z - p.c[2]
    const hx = p.s[0] / 2
    const hy = p.s[1] / 2
    const hz = p.s[2] / 2
    if (Math.abs(dy) > hy) continue
    if (p.shape === 'box') {
      if (Math.abs(dx) <= hx && Math.abs(dz) <= hz) return true
    } else if (p.shape === 'ellipsoid') {
      if ((dx / hx) ** 2 + (dy / hy) ** 2 + (dz / hz) ** 2 <= 1) return true
    } else if (p.shape === 'cylinder') {
      if ((dx / hx) ** 2 + (dz / hz) ** 2 <= 1) return true
    } else {
      const t = (dy + hy) / p.s[1]
      const k = 1 - t
      if ((dx / (hx * k || 1e-6)) ** 2 + (dz / (hz * k || 1e-6)) ** 2 <= 1) return true
    }
  }
  return false
}

/** A cell centre inside the object, in its own frame: the object as it survives at this resolution. */
export function voxelise(parts: readonly Part[], cell: number, limit = 70000): Float32Array {
  const b = boundsOf(parts)
  const out: number[] = []
  const x0 = Math.floor(b.min[0] / cell) * cell
  const y0 = 0
  const z0 = Math.floor(b.min[2] / cell) * cell
  for (let x = x0; x < b.max[0]; x += cell) {
    for (let y = y0; y < b.max[1]; y += cell) {
      for (let z = z0; z < b.max[2]; z += cell) {
        // A cell is solid if its centre is inside: a feature thinner than a cell is lost, as in a real grid.
        if (inside(parts, x + cell / 2, y + cell / 2, z + cell / 2)) {
          out.push(x + cell / 2, y + cell / 2, z + cell / 2)
          if (out.length / 3 >= limit) return Float32Array.from(out)
        }
      }
    }
  }
  return Float32Array.from(out)
}

/** How many pixels a length of `size` metres spans, at `distance` metres, with a vertical field of view, on a viewport `heightPx` tall. */
export function apparentPixels(size: number, distance: number, fovDeg: number, heightPx: number): number {
  const view = 2 * distance * Math.tan((fovDeg * Math.PI) / 360)
  return (size / view) * heightPx
}

/** The angle a length subtends, in degrees. */
export function angularSize(size: number, distance: number): number {
  return (2 * Math.atan(size / 2 / Math.max(1e-6, distance)) * 180) / Math.PI
}

/** The smallest length that still spans `px` pixels: below it a feature is lost. */
export function legibleFeature(distance: number, fovDeg: number, heightPx: number, px = 3): number {
  return (px * 2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, heightPx)
}

/** The distance that keeps an object's apparent size when the field of view changes (the dolly zoom). */
export function dollyDistance(distance: number, fromFov: number, toFov: number): number {
  return (distance * Math.tan((fromFov * Math.PI) / 360)) / Math.tan((toFov * Math.PI) / 360)
}

/** The farthest distance at which a length still spans `px` pixels. */
export function visibleRange(size: number, fovDeg: number, heightPx: number, px = 3): number {
  return (size * Math.max(1, heightPx)) / (px * 2 * Math.tan((fovDeg * Math.PI) / 360))
}

/** The distance at which a size just fills a share of the view's height. */
export function framingDistance(size: number, fovDeg: number, share = 0.7): number {
  return size / share / (2 * Math.tan((fovDeg * Math.PI) / 360))
}

export type Legibility = 'smooth' | 'grainy' | 'blocky'
/** What a cell looks like on screen: under 2 px it is invisible, under 6 px it is grain, beyond that the grid shows. */
export function cellLegibility(cellPx: number): Legibility {
  return cellPx < 2 ? 'smooth' : cellPx < 6 ? 'grainy' : 'blocky'
}

/** The three camera distances of Shadow Ecology 0.3 as working viewpoints (metres from the subject; elevation in degrees). */
export const VIEWPOINTS = [
  { id: 'explore', label: 'Explore', distance: 22, elevation: 3, note: 'Eye at 1.75 m, a walker looking' },
  { id: 'approach', label: 'Approach', distance: 220, elevation: 24, note: 'A few hundred metres out and above' },
  { id: 'overview', label: 'Overview', distance: 2600, elevation: 38, note: 'The whole island from the far side' },
] as const

/** The camera the 0.3 page uses, for reference: one field of view for every view. */
export const PROJECT_FOV = 46

/** Poles for judging depth: how far in front of, and behind, the subject they stand, as multiples of its longest side. */
export const DEPTH = { front: 0.9, back: 2.2, height: 0.5 } as const

export type MeshLevel = 'low' | 'medium' | 'high'
/** A ring (a torus: curved, and perforated by its hole) built at three levels of geometric detail. */
export const MESH_LEVELS: Record<MeshLevel, { label: string; radial: number; tubular: number }> = {
  low: { label: 'Low', radial: 5, tubular: 8 },
  medium: { label: 'Medium', radial: 10, tubular: 24 },
  high: { label: 'High', radial: 24, tubular: 96 },
}

/** The ring's proportions for a given overall height: a hole through the middle, a tube about a quarter as thick as the hole is wide. */
export function ringFor(height: number) {
  return { major: height * 0.38, minor: height * 0.12 }
}

export const meshTriangles = (level: MeshLevel) => 2 * MESH_LEVELS[level].radial * MESH_LEVELS[level].tubular

/** How far the faceted silhouette strays from the true curve, metres: the sagitta of the coarser of its two curves. */
export function meshDeviation(level: MeshLevel, height: number): number {
  const { major, minor } = ringFor(height)
  const { radial, tubular } = MESH_LEVELS[level]
  return Math.max((major + minor) * (1 - Math.cos(Math.PI / tubular)), minor * (1 - Math.cos(Math.PI / radial)))
}
