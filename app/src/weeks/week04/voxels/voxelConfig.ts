import { DEFAULT_VOXEL_SETTINGS, type VoxelSettings } from './types.ts'

/**
 * Legacy Cloud Config documents (`users/{uid}/configs/{id}`), read only so an
 * old save can still be restored: `week04`, then the first `default` slot.
 */
export const LEGACY_VOXEL_CONFIG_IDS = ['week04', 'default'] as const

/**
 * Stored `VoxelSettings` back into current settings, or null when there are
 * no steps. Configs saved before per-axis offsets only stored offsetY.
 */
export function parseVoxelSettings(settings: object): VoxelSettings | null {
  const loaded = settings as Partial<VoxelSettings>
  if (!Array.isArray(loaded.steps) || loaded.steps.length === 0) {
    return null
  }
  return {
    ...DEFAULT_VOXEL_SETTINGS,
    ...loaded,
    steps: loaded.steps.map((step) => ({
      ...step,
      offsetX: step.offsetX ?? 0,
      offsetZ: step.offsetZ ?? 0,
    })),
  }
}
