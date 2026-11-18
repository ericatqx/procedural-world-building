import { clamp01, smoothstep } from '../project02/core.ts'
import type { IslandFields } from './vegFields.ts'
import { ARCHETYPES, effective, patch, suitability, ZONE_KEYS, zonesOf, type Conditions, type Zones } from './vegPlants.ts'
import type { VegOverlay } from './vegStore.ts'
import { groundWeights } from './worldPlants.ts'

/**
 * Shadow Ecology 0.3 — the island's vegetation as colour: for every 16 m texel, the habitat there (vegPlants zones), how lush it
 * is (the best of the archetypes' chances, with their community patches), and so the colour and strength of the ground cover that
 * the terrain shows. Without the architecture's influence (that is local, and handled by the plants themselves).
 */
export function islandConditions(f: IslandFields, i: number, j: number): Conditions {
  const k = j * f.n + i
  const e = effective(f.light[k]!, f.moisture[k]!, 0, 0)
  return {
    height: f.height[k]!, slope: f.slope[k]!, waterDepth: f.waterDepth[k]!, waterDist: f.waterDist[k]!, light: e.light, moisture: e.moisture,
    footprint: 0, shade: 0, shelter: 0, x: f.x0 + (i + 0.5) * f.cell, z: f.x0 + (j + 0.5) * f.cell,
  }
}

/** Natural ground colours of each habitat, for the ground cover. */
const GROUND: Record<keyof Zones, [number, number, number]> = {
  moist: [0.2, 0.42, 0.24], shore: [0.16, 0.38, 0.33], dry: [0.62, 0.55, 0.34], shaded: [0.15, 0.3, 0.24], alpine: [0.46, 0.52, 0.48], rock: [0.4, 0.38, 0.36],
}

export function coverageTexture(f: IslandFields, seed: number): Uint8Array {
  const n = f.n
  const out = new Uint8Array(n * n * 4)
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i
      if (!f.land[k]) continue
      const c = islandConditions(f, i, j)
      const z = zonesOf(c)
      let lush = 0
      for (const a of ARCHETYPES) lush = Math.max(lush, suitability(a, c, z) * (0.45 + 0.55 * patch(a, seed, c.x, c.z)))
      const alpha = 0.92 * smoothstep(0.03, 0.32, lush) * (1 - z.rock * 0.9)
      if (alpha <= 0.01) continue
      let r = 0.1
      let g = 0.1
      let b = 0.1
      let w = 0.1
      for (const key of Object.keys(GROUND) as (keyof Zones)[]) {
        const wt = z[key] ** 1.3
        r += GROUND[key][0] * wt
        g += GROUND[key][1] * wt
        b += GROUND[key][2] * wt
        w += wt
      }
      const shade = 0.7 + 0.45 * clamp01(lush)
      out[k * 4] = Math.round(clamp01((r / w) * shade) * 255)
      out[k * 4 + 1] = Math.round(clamp01((g / w) * shade) * 255)
      out[k * 4 + 2] = Math.round(clamp01((b / w) * shade) * 255)
      out[k * 4 + 3] = Math.round(alpha * 255)
    }
  }
  return out
}

/** The colour map for an overlay mode over the island (habitat, light or moisture); empty for the others. */
/**
 * The island's data maps for Explore Data (Round 08C: written as DATA, not colour; the data views colour them with their one palette,
 * visualDiagnostics.ts, and the pointer reads them back): per 16 m cell, R the value (moisture, or the day's light, 0 to 1), G the dominant habitat
 * zone (index into ZONE_KEYS, 6 where no plant archetype is suited, times 32), B that zone's membership (0 to 1), A 1 where there is land to show.
 */
export function overlayTexture(f: IslandFields, mode: VegOverlay): Uint8Array {
  const n = f.n
  const out = new Uint8Array(n * n * 4)
  if (mode !== 'habitat' && mode !== 'light' && mode !== 'moisture') return out
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i
      if (!f.land[k]) continue
      const z = habitatAt(f, i, j)
      out[k * 4] = Math.round(clamp01(mode === 'light' ? f.light[k]! : f.moisture[k]!) * 255)
      out[k * 4 + 1] = z.index * 32
      out[k * 4 + 2] = Math.round(clamp01(z.strength) * 255)
      out[k * 4 + 3] = mode === 'habitat' && z.water ? 0 : 255
    }
  }
  return out
}

/** A cell's habitat as the data views show it: the dominant zone (6: nothing suited), its membership, every membership, and whether it is water. */
export function habitatAt(f: IslandFields, i: number, j: number): { index: number; strength: number; zones: Zones; water: boolean; suited: number } {
  const c = islandConditions(f, i, j)
  const zones = zonesOf(c)
  let suited = 0
  for (const arch of ARCHETYPES) suited = Math.max(suited, suitability(arch, c, zones))
  let index = 0
  let strength = -1
  ZONE_KEYS.forEach((key, m) => {
    if (zones[key] > strength) {
      strength = zones[key]
      index = m
    }
  })
  if (suited < 0.06) index = 6
  return { index, strength: Math.max(0, strength), zones, water: c.waterDepth > 0.05, suited }
}

/** The ground materials (forest floor, moss, meadow, gravel; rock is what is left) for the terrain shader: 16 m texels. */
export function groundTexture(f: IslandFields, seed: number): Uint8Array {
  const n = f.n
  const out = new Uint8Array(n * n * 4)
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i
      if (!f.land[k]) continue
      const c = islandConditions(f, i, j)
      const w = groundWeights(c, zonesOf(c), seed)
      for (let m = 0; m < 4; m += 1) out[k * 4 + m] = Math.round(clamp01(w[m]!) * 255)
    }
  }
  return out
}
