export type TerrainFogSettings = {
  enabled: boolean
  near: number
  far: number
}

export const DEFAULT_TERRAIN_FOG: TerrainFogSettings = {
  enabled: false,
  near: 4,
  far: 18,
}
