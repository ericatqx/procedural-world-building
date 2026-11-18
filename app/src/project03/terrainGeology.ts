import type { IslandFields } from './vegFields.ts'

/**
 * Shadow Ecology 0.3 — THE GEOLOGY MAP: what the rock's colour is read from on the Black Stage (visualStudyWorlds.ts › stageGeology). The island's
 * landforms (terrain.ts) are uplifted massifs cut by ridges and drainage; read geologically, a flat-lying stack of sedimentary rock, raised and eroded.
 * Which rock shows at a place, and how weathered it is, follows from where it sits in that stack and from the surface processes there, all of which
 * depend on the shape of the ground. This map holds the shape, on the island's own 16 m grid (vegFields.ts › IslandFields), so the rules read the same
 * values at every camera distance (the mesh's normals change with its level of detail; these do not):
 *
 *   R  slope            rise over run across 32 m, a little smoothed; stored / 3
 *   G  convexity        the ground against its ring 32 m around (metres): crests and spurs stand out (> 0.5), hollows and footslopes sink (< 0.5); ±12 m
 *   B  cliff above      how steep the steepest ground within 48 m and well above a place is: where rock falling from a scarp comes to rest
 *   A  near water       1 at a lake or river's edge, fading to 0 by about 28 m from it: where shoreline sediment lies
 *
 * and a second map, the RELIEF: the ground's smoothed slope direction (rise per metre along x and z, over about 48 m), from which the Black
 * Stage decides which way the terrain faces the sun, so its light and shade no longer follow the mesh's facets as its level of detail changes.
 *
 * Built once, when the island's fields are (Vegetation.tsx), from heights only: the terrain and the ecology are unchanged.
 */
export function geologyTexture(f: IslandFields): { geology: Uint8Array; relief: Uint8Array } {
  const { n, height, slope, waterDist } = f
  const out = new Uint8Array(n * n * 4)
  const relief = new Uint8Array(n * n * 4)
  const at = (a: Float32Array, i: number, j: number) => a[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))]!
  // Slope, smoothed over the 3 x 3 cells around (a single 16 m cell is noisy on the ridged flanks).
  const smooth = new Float32Array(n * n)
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) {
      let s = 0
      for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) s += at(slope, i + di, j + dj) * (di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1)
      smooth[j * n + i] = s / 16
    }
  const RING: [number, number][] = [[2, 0], [-2, 0], [0, 2], [0, -2], [1.414, 1.414], [-1.414, 1.414], [1.414, -1.414], [-1.414, -1.414]]
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i
      const h = height[k]!
      let ring = 0
      for (const [di, dj] of RING) ring += at(height, Math.round(i + di), Math.round(j + dj))
      const convex = h - ring / RING.length
      // The cliff above: the steepest cell within three cells that stands at least 8 m higher.
      let above = 0
      for (let dj = -3; dj <= 3; dj += 1)
        for (let di = -3; di <= 3; di += 1) {
          if (di * di + dj * dj > 9 || (di === 0 && dj === 0)) continue
          if (at(height, i + di, j + dj) > h + 8) above = Math.max(above, at(smooth, i + di, j + dj))
        }
      out[k * 4] = Math.round(Math.min(1, smooth[k]! / 3) * 255)
      out[k * 4 + 1] = Math.round(Math.min(1, Math.max(0, 0.5 + convex / 24)) * 255)
      out[k * 4 + 2] = Math.round(Math.min(1, Math.max(0, (above - 1.0) / 1.5)) * 255)
      out[k * 4 + 3] = Math.round((1 - Math.min(1, Math.max(0, (waterDist[k]! - 4) / 24))) * 255)
    }
  // The relief: the height gradient across 32 m, smoothed over the 3 x 3 cells around; stored as 0.5 + gradient / 6 (gradients to ±3).
  const gx = new Float32Array(n * n)
  const gz = new Float32Array(n * n)
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) {
      gx[j * n + i] = (at(height, i + 1, j) - at(height, i - 1, j)) / (2 * f.cell)
      gz[j * n + i] = (at(height, i, j + 1) - at(height, i, j - 1)) / (2 * f.cell)
    }
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) {
      let sx = 0
      let sz = 0
      for (let dj = -1; dj <= 1; dj += 1)
        for (let di = -1; di <= 1; di += 1) {
          const w = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1
          sx += at(gx, i + di, j + dj) * w
          sz += at(gz, i + di, j + dj) * w
        }
      const k = (j * n + i) * 4
      relief[k] = Math.round(Math.min(1, Math.max(0, 0.5 + sx / 16 / 6)) * 255)
      relief[k + 1] = Math.round(Math.min(1, Math.max(0, 0.5 + sz / 16 / 6)) * 255)
      relief[k + 2] = 0
      relief[k + 3] = 255
    }
  return { geology: out, relief }
}
