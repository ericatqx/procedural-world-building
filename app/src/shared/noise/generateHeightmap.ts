import { applyShaping, makeSampleFn } from './shaping.ts'
import type { NoiseLayer, NoiseSettings } from './types.ts'

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

export function sampleLayerValue(
  x: number,
  y: number,
  layer: NoiseLayer,
): number {
  const sample = makeSampleFn(layer.noiseType)
  const nx = x * layer.frequency
  const ny = y * layer.frequency
  const shaped = applyShaping(nx, ny, sample, layer.shaping, layer.shapingParam)
  return shaped * layer.amplitude
}

export function combineLayerValues(values: number[], layers: NoiseLayer[]): number {
  let totalWeight = 0
  let sum = 0

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    if (!layer || !layer.enabled) {
      continue
    }

    const weight = Math.max(0, layer.weight)
    sum += values[i]! * weight
    totalWeight += weight
  }

  if (totalWeight === 0) {
    return 0
  }

  return clampUnit(sum / totalWeight)
}

export type WorldOffset = {
  x: number
  z: number
}

/**
 * Build a resolution×resolution heightmap in roughly [-1, 1].
 * Each layer contributes its own shaped, weighted value.
 * `worldOffset` shifts sampling in the infinite noise domain (X/Z).
 */
export function generateHeightmap(
  settings: NoiseSettings,
  worldOffset: WorldOffset = { x: 0, z: 0 },
): Float32Array {
  const { resolution, layers } = settings
  const values = new Float32Array(resolution * resolution)
  const denom = Math.max(1, resolution - 1)

  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const nx = worldOffset.x + x / denom
      const nz = worldOffset.z + y / denom
      const layerValues = layers.map((layer) => sampleLayerValue(nx, nz, layer))
      values[y * resolution + x] = combineLayerValues(layerValues, layers)
    }
  }

  return values
}
