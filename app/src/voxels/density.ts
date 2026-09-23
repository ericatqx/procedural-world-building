import type { DensityShapeKind } from './types.ts'

/** Volume coords are roughly in [-1, 1] on each axis. Density > 0 = solid. */

export function sampleDensityShape(
  x: number,
  y: number,
  z: number,
  shape: DensityShapeKind,
  size: number,
  offsetY: number,
  detail: number,
): number {
  const py = y - offsetY

  switch (shape) {
    case 'sphere': {
      const r = Math.max(0.05, size)
      return r - Math.sqrt(x * x + py * py + z * z)
    }
    case 'box': {
      const half = Math.max(0.05, size)
      const dx = Math.abs(x) - half
      const dy = Math.abs(py) - half * 0.7
      const dz = Math.abs(z) - half
      const outside = Math.sqrt(
        Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2 + Math.max(dz, 0) ** 2,
      )
      const inside = Math.min(Math.max(dx, dy, dz), 0)
      return -(outside + inside)
    }
    case 'plane': {
      // Thick slab near y = offsetY.
      const thickness = Math.max(0.05, detail)
      return thickness - Math.abs(py)
    }
    case 'torus': {
      const major = Math.max(0.1, size)
      const minor = Math.max(0.04, detail)
      const q = Math.sqrt(x * x + z * z) - major
      return minor - Math.sqrt(q * q + py * py)
    }
    case 'noiseBlob': {
      // Soft blob modulated by cheap value-ish noise (not the Week 3 stack).
      const freq = 1.5 + detail * 6
      const n =
        Math.sin(x * freq) * Math.cos(py * freq * 1.1) * Math.sin(z * freq * 0.9)
      const base = Math.max(0.15, size) - Math.sqrt(x * x + py * py + z * z)
      return base + n * 0.18
    }
  }
}
