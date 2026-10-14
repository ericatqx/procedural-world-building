import { PROJECT_COLORS } from '../../project/materials.ts'

/**
 * Week 07 Branching Histories — the Shadow Ecology palette, taken from the
 * Project: neutral for terrain and architecture, cobalt for water, olive
 * for vegetation, lichen green for habitat, bone for creatures and paths.
 * Traces take paler, quieter versions over a dimmed ground.
 */
export const HISTORY_COLORS = {
  cliff: PROJECT_COLORS.terrainDeep,
  architecture: PROJECT_COLORS.archFresh,
  water: PROJECT_COLORS.waterShallow,
  waterDeep: PROJECT_COLORS.waterDeep,
  habitat: PROJECT_COLORS.habitat,
  exposureVegetation: PROJECT_COLORS.vegetationTip,
  shelterVegetation: PROJECT_COLORS.vegetationBase,
  creature: '#f4efe6',
  path: PROJECT_COLORS.path,
  pathWorn: PROJECT_COLORS.pathWorn,
  /** Ground walked so often it has been trodden bare. */
  trodden: PROJECT_COLORS.pathWorn,
  rubble: PROJECT_COLORS.archWeathered,
  tracesGround: '#2e2d2b',
  ghost: PROJECT_COLORS.archDust,
  formerStructure: PROJECT_COLORS.terrainHigh,
  rubbleTrace: PROJECT_COLORS.terrainHigh,
  formerShelter: PROJECT_COLORS.habitatThin,
  deadVegetation: PROJECT_COLORS.vegetationDry,
  /** Former routes vegetation has grown back over. */
  reclaimedPath: PROJECT_COLORS.vegetationTip,
  /** Ground the water has spread over since the origin. */
  newWater: PROJECT_COLORS.waterShallow,
  formerShore: PROJECT_COLORS.waterLine,
  vegetationDim: '#3a3c31',
} as const
