import { applyCsg } from './csg.ts'
import { sampleDensityShape } from './density.ts'
import type { DensityStep } from './types.ts'

export type DensityVolume = {
  resolution: number
  /** length = resolution³, density > 0 = solid */
  densities: Float32Array
}

/**
 * Sample sequential density/CSG steps onto a regular grid in [-1, 1]³.
 */
export function buildDensityVolume(
  resolution: number,
  steps: DensityStep[],
): DensityVolume {
  const count = resolution * resolution * resolution
  const densities = new Float32Array(count)
  const active = steps.filter((step) => step.enabled)
  const denom = Math.max(1, resolution - 1)

  for (let iz = 0; iz < resolution; iz++) {
    for (let iy = 0; iy < resolution; iy++) {
      for (let ix = 0; ix < resolution; ix++) {
        const x = (ix / denom) * 2 - 1
        const y = (iy / denom) * 2 - 1
        const z = (iz / denom) * 2 - 1
        let d = -1

        for (let s = 0; s < active.length; s++) {
          const step = active[s]!
          const shapeD = sampleDensityShape(
            x,
            y,
            z,
            step.shape,
            step.size,
            step.offsetY,
            step.detail,
          )
          d = s === 0 ? shapeD : applyCsg(d, shapeD, step.op)
        }

        const i = ix + iy * resolution + iz * resolution * resolution
        densities[i] = d
      }
    }
  }

  return { resolution, densities }
}

export function volumeIndex(
  ix: number,
  iy: number,
  iz: number,
  resolution: number,
): number {
  return ix + iy * resolution + iz * resolution * resolution
}
