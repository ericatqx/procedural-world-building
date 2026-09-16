import { cellular2 } from './cellular.ts'
import { perlin2 } from './perlin.ts'
import { simplex2 } from './simplex.ts'
import type { NoiseType } from './types.ts'
import { value2 } from './value.ts'

/** Sample one noise function at (x, y). Output roughly [-1, 1]. */
export function sampleNoise(x: number, y: number, type: NoiseType): number {
  switch (type) {
    case 'perlin':
      return perlin2(x, y)
    case 'simplex':
      return simplex2(x, y)
    case 'value':
      return value2(x, y)
    case 'cellular':
      return cellular2(x, y)
  }
}
