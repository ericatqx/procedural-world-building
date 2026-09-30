export type HydraulicErosionParams = {
  /** Water added to every cell each step. */
  rain: number
  /** Fraction of water removed each step (0–1). */
  evaporation: number
  /** How quickly terrain erodes when capacity exceeds sediment. */
  erosionRate: number
  /** How quickly excess sediment deposits onto terrain. */
  depositionRate: number
  /** Multiplier for carrying capacity (slope × moving water × capacity). */
  sedimentCapacity: number
  /** Fraction of cell water that can flow to lower neighbours per flow pass (0–1). */
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

/** Height units of water depth per unit of water. */
export const WATER_DEPTH_SCALE = 0.1

/** Flow passes per step, so water settles much faster than the terrain changes. */
const FLOW_PASSES = 4

/**
 * Share of a full step's rain, flow and evaporation applied per step. Scaling
 * all three together stretches the water timeline (rain → streams → pools)
 * over several seconds without changing where the water settles.
 */
const WATER_PACE = 0.1

/**
 * Scales every terrain change (erosion and deposition), keeping the generated
 * terrain recognisable while water runs over it.
 */
const TERRAIN_RATE = 0.006

/**
 * Outflow per pass is capped at this fraction of the largest surface drop,
 * so neighbouring water levels settle instead of sloshing back and forth.
 */
const LEVELING = 0.25

type ScratchBuffers = {
  waterDelta: Float32Array
  sedimentDelta: Float32Array
  outflow: Float32Array
  surfaces: Float32Array
}

let scratch: ScratchBuffers | null = null

/** Per-step working arrays, reused while the grid size stays the same. */
function scratchBuffers(count: number): ScratchBuffers {
  if (!scratch || scratch.outflow.length !== count) {
    scratch = {
      waterDelta: new Float32Array(count),
      sedimentDelta: new Float32Array(count),
      outflow: new Float32Array(count),
      surfaces: new Float32Array(count),
    }
  }
  return scratch
}

/** 4-neighbour offsets: left, right, up, down. */
const NEIGHBOR_DX = [-1, 1, 0, 0] as const
const NEIGHBOR_DY = [0, 0, -1, 1] as const

/**
 * One grid step: rain → several flow passes → erosion/deposition → evaporation.
 * Water moves by water *surface* (terrain + depth) and spreads over every
 * lower 4-neighbour, so it fills depressions into pools and joins into
 * streams. Water and sediment leave through edges that slope outward.
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
  const { waterDelta, sedimentDelta, outflow, surfaces } = scratchBuffers(count)
  outflow.fill(0)
  const drops = [0, 0, 0, 0]

  for (let i = 0; i < count; i++) {
    water[i] += params.rain * WATER_PACE
  }

  for (let pass = 0; pass < FLOW_PASSES; pass++) {
    waterDelta.fill(0)
    sedimentDelta.fill(0)
    for (let i = 0; i < count; i++) {
      surfaces[i] = height[i]! + water[i]! * WATER_DEPTH_SCALE
    }

    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const i = y * resolution + x
        const cellWater = water[i]!
        if (cellWater <= 0) {
          continue
        }

        const surface = surfaces[i]!
        let totalDrop = 0
        let maxDrop = 0

        for (let k = 0; k < 4; k++) {
          const dx = NEIGHBOR_DX[k]!
          const dy = NEIGHBOR_DY[k]!
          const nx = x + dx
          const ny = y + dy
          let neighborSurface: number
          if (nx < 0 || ny < 0 || nx >= resolution || ny >= resolution) {
            // Off-grid: continue the terrain's slope outward, with no water.
            const ix = x - dx
            const iy = y - dy
            if (ix < 0 || iy < 0 || ix >= resolution || iy >= resolution) {
              drops[k] = 0
              continue
            }
            neighborSurface = 2 * height[i]! - height[iy * resolution + ix]!
          } else {
            neighborSurface = surfaces[ny * resolution + nx]!
          }
          const drop = Math.max(0, surface - neighborSurface)
          drops[k] = drop
          totalDrop += drop
          maxDrop = Math.max(maxDrop, drop)
        }

        if (totalDrop <= 0) {
          continue
        }

        const flow =
          Math.min(cellWater * params.flowRate, (maxDrop / WATER_DEPTH_SCALE) * LEVELING) *
          WATER_PACE
        const sedimentMove = (sediment[i]! / cellWater) * flow
        waterDelta[i]! -= flow
        sedimentDelta[i]! -= sedimentMove
        outflow[i]! += flow

        for (let k = 0; k < 4; k++) {
          const drop = drops[k]!
          if (drop <= 0) {
            continue
          }
          const nx = x + NEIGHBOR_DX[k]!
          const ny = y + NEIGHBOR_DY[k]!
          if (nx < 0 || ny < 0 || nx >= resolution || ny >= resolution) {
            continue
          }
          const j = ny * resolution + nx
          const share = drop / totalDrop
          waterDelta[j]! += flow * share
          sedimentDelta[j]! += sedimentMove * share
        }
      }
    }

    for (let i = 0; i < count; i++) {
      water[i] = Math.max(0, water[i]! + waterDelta[i]!)
      sediment[i] = Math.max(0, sediment[i]! + sedimentDelta[i]!)
    }
  }

  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const i = y * resolution + x
      const surface = height[i]! + water[i]! * WATER_DEPTH_SCALE
      let surfaceSlope = 0
      let terrainSlope = 0

      for (let k = 0; k < 4; k++) {
        const nx = x + NEIGHBOR_DX[k]!
        const ny = y + NEIGHBOR_DY[k]!
        if (nx < 0 || ny < 0 || nx >= resolution || ny >= resolution) {
          continue
        }
        const j = ny * resolution + nx
        surfaceSlope = Math.max(surfaceSlope, surface - height[j]! - water[j]! * WATER_DEPTH_SCALE)
        terrainSlope = Math.max(terrainSlope, height[i]! - height[j]!)
      }

      // Still water (pools) carries little; fast water on slopes carries more.
      const movingWater = outflow[i]! / (FLOW_PASSES * WATER_PACE)
      const capacity = surfaceSlope * movingWater * params.sedimentCapacity
      const cellSediment = sediment[i]!

      if (cellSediment < capacity) {
        const erode =
          Math.min(
            params.erosionRate * (capacity - cellSediment),
            terrainSlope * params.erosionRate,
          ) * TERRAIN_RATE
        height[i] = height[i]! - erode
        sediment[i] = cellSediment + erode
      } else {
        const deposit = params.depositionRate * (cellSediment - capacity) * TERRAIN_RATE
        height[i] = height[i]! + deposit
        sediment[i] = cellSediment - deposit
      }
    }
  }

  for (let i = 0; i < count; i++) {
    water[i] = water[i]! * (1 - params.evaporation * WATER_PACE)
  }
}
