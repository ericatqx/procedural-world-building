import type { CsgOp } from './types.ts'

/** Combine densities. Convention: density > 0 is solid. */
export function applyCsg(a: number, b: number, op: CsgOp): number {
  switch (op) {
    case 'replace':
      return b
    case 'union':
      return Math.max(a, b)
    case 'subtract':
      return Math.min(a, -b)
    case 'intersect':
      return Math.min(a, b)
  }
}
