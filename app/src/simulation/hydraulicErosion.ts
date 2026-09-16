export type HydraulicErosionParams = {
  /** Water added to every cell each step. */
  rain: number
  /** Fraction of water removed each step (0–1). */
  evaporation: number
  /** How quickly terrain erodes when capacity exceeds sediment. */
  erosionRate: number
  /** How quickly excess sediment deposits onto terrain. */
  depositionRate: number
  /** Multiplier for carrying capacity (slope × water × capacity). */
  sedimentCapacity: number
  /** Fraction of cell water that flows downhill each step (0–1). */
  flowRate: number
  /** Simulation steps run per animation frame while active. */
  stepsPerFrame: number
}

export const DEFAULT_HYDRAULIC_EROSION_PARAMS: HydraulicErosionParams = {
  rain: 0.012,
  evaporation: 0.03,
  erosionRate: 0.35,
  depositionRate: 0.35,
  sedimentCapacity: 4,
  flowRate: 0.4,
  stepsPerFrame: 2,
}

const NEIGHBOR_OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const

/**
 * One grid step: rain → flow (4-neighbors) → erosion/deposition → evaporation.
 * Mutates height, water, and sediment in place.
 */
export function stepHydraulicErosion(
  height: Float32Array,
  water: Float32Array,
  sediment: Float32Array,
  resolution: number,
  params: HydraulicErosionParams,
): void {
  const count = resolution * resolution
  const waterDelta = new Float32Array(count)
  const sedimentDelta = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    water[i] += params.rain
  }

  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const i = y * resolution + x
      const cellWater = water[i]!
      if (cellWater <= 0) {
        continue
      }

      let steepestNeighbor = -1
      let steepestSlope = 0

      for (const [dx, dy] of NEIGHBOR_OFFSETS) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= resolution || ny >= resolution) {
          continue
        }

        const j = ny * resolution + nx
        const slope = height[i]! - height[j]!
        if (slope > steepestSlope) {
          steepestSlope = slope
          steepestNeighbor = j
        }
      }

      if (steepestNeighbor === -1 || steepestSlope <= 0) {
        continue
      }

      const capacity = steepestSlope * cellWater * params.sedimentCapacity
      let cellSediment = sediment[i]!

      if (cellSediment < capacity) {
        const erode = Math.min(
          params.erosionRate * (capacity - cellSediment),
          steepestSlope * params.erosionRate,
        )
        height[i] = height[i]! - erode
        cellSediment += erode
        sediment[i] = cellSediment
      } else {
        const deposit = Math.min(
          params.depositionRate * (cellSediment - capacity),
          cellSediment * params.depositionRate,
        )
        height[i] = height[i]! + deposit
        cellSediment -= deposit
        sediment[i] = cellSediment
      }

      const flow = Math.min(cellWater, cellWater * params.flowRate)
      const sedimentMove = (cellSediment / cellWater) * flow

      waterDelta[i]! -= flow
      waterDelta[steepestNeighbor]! += flow
      sedimentDelta[i]! -= sedimentMove
      sedimentDelta[steepestNeighbor]! += sedimentMove
    }
  }

  for (let i = 0; i < count; i++) {
    water[i] = Math.max(0, water[i]! + waterDelta[i]!)
    sediment[i] = Math.max(0, sediment[i]! + sedimentDelta[i]!)
    water[i] = water[i]! * (1 - params.evaporation)
  }
}
