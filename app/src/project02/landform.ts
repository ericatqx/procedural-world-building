import type { AnalysisGrid } from '../project/grid.ts'
import type { TerrainShape } from '../project/terrain.ts'
import { perlin2 } from '../shared/noise/perlin.ts'
import { applyShaping, makeSampleFn } from '../shared/noise/shaping.ts'
import { simplex2 } from '../shared/noise/simplex.ts'
import { clamp01, smoothstep } from './core.ts'
import { composeWaterways } from './waterways.ts'

/**
 * Shadow Ecology 0.2 — a floating landmass composed by scale, in the sense
 * of the Terrain/Noise week: each scale has its own noise and shaping, and
 * finer scales are weighted by coarser ones rather than averaged with them.
 *
 *   macro    a few dominant formations, each a different kind of relief and
 *            warped by low simplex: a high steep range across the back, a
 *            lower range down the west joined to it by a saddle, a tilted
 *            tableland in the east that breaks off as an escarpment toward
 *            the basin, broad rolling and level open ground between them,
 *            and an off-centre basin
 *   meso     a ridged multifractal (Week 03's ridged shaping, octave upon
 *            octave): each finer octave grows only where the one above
 *            stands high, so ridges branch off the masses into spurs and
 *            the ground between them falls away as valleys. Crests are
 *            softened so ridges are rounded, not blades
 *   fine     a very faint simplex grain only
 *
 * Water is composed over this (waterways.ts), which reshapes the ground
 * only locally to hold it: a valley along each river, a bowl under each lake.
 *
 * Authored larger than 0.1's island (radius ≈ 3) and drawn at WORLD_SCALE,
 * so the extra ground is new landform, not a stretched copy of the old one.
 * The sun crosses −Z at noon, so faces turned toward the viewer (+Z) are
 * the sheltered ones.
 */

/** Mean outline radius, in landform units (0.1's island is about 3). */
export const LAND_RADIUS = 6
/** Analysis half-extent. Stays outside the most extended outline. */
export const LAND_EXTENT = 7.8
export const LAND_GRID_SIZE = 256
export const LAND_GRID: AnalysisGrid = {
  size: LAND_GRID_SIZE,
  extent: LAND_EXTENT,
  cell: (2 * LAND_EXTENT) / LAND_GRID_SIZE,
}

const simplex = makeSampleFn('simplex')

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** Periodic noise around the outline: the same value at 0 and 2π. */
const ringNoise = (angle: number, frequency: number, seed: number) =>
  perlin2(Math.cos(angle) * frequency + seed, Math.sin(angle) * frequency - seed)

/** Week 03 shaping, sampled in landform units with its own offset. */
function shaped(
  sample: (x: number, y: number) => number,
  x: number,
  z: number,
  frequency: number,
  ox: number,
  oz: number,
  shaping: 'none' | 'domainWarp' | 'turbulence' = 'none',
  param = 0,
) {
  return applyShaping((x + ox) * frequency, (z + oz) * frequency, sample, shaping, param)
}

/**
 * Ridged multifractal: Week 03's ridge (1 − |noise|, squared) summed over
 * octaves, each weighted by the octave before it. Fine ridges appear only
 * on coarse ones, so the field is a hierarchy — ranges, ridges, spurs —
 * with valleys between, instead of an even scatter of peaks. |noise| is
 * softened so crests are rounded; each octave is rotated so crest lines
 * don't line up into a grid. Returns roughly 0 (valley) … 1 (crest).
 */
function ridgedMultifractal(x: number, z: number, frequency: number, octaves: number) {
  const wx = simplex2(x * 0.06 + 3.1, z * 0.06 - 7.7) * 2.4
  const wz = simplex2(x * 0.06 - 5.4, z * 0.06 + 2.2) * 2.4
  let px = (x + wx) * frequency
  let pz = (z + wz) * frequency
  let sum = 0
  let norm = 0
  let amplitude = 1
  let weight = 1
  let crest = 1
  for (let i = 0; i < octaves; i++) {
    // Perlin rarely leaves ±0.6, so it is scaled up a little for valleys as clear as the crests.
    const n = perlin2(px + i * 17.3, pz - i * 9.1) * 1.3
    // Raised to 1.5 rather than squared: crests stay rounded, not blades.
    let signal = Math.max(0, 1 - Math.sqrt(n * n + 0.02)) ** 1.5
    signal *= weight
    // A floor, so finer ridges still reach into the valleys as low spurs.
    weight = clamp01(0.3 + signal * 1.6)
    if (i === 0) crest = smoothstep(0.35, 0.8, signal)
    // Off the main crests, finer octaves are held at their mean (≈0.49): the
    // same overall height, but slopes and valley floors without rounded bumps.
    const detail = i === 0 ? signal : 0.49 + (signal - 0.49) * crest
    sum += detail * amplitude
    norm += amplitude
    amplitude *= 0.7
    const rx = px * 0.8 - pz * 0.6
    pz = (px * 0.6 + pz * 0.8) * 2.03
    px = rx * 2.03
  }
  return sum / norm
}

function outlineRadius(angle: number): number {
  const lobes = 0.1 * Math.sin(2 * angle + 0.35) + 0.06 * Math.sin(5 * angle - 0.8) + 0.08 * ringNoise(angle, 1.35, 4.2)
  const bites = -0.1 * Math.abs(ringNoise(angle, 4.8, 8.1))
  const bayA = -0.16 * Math.exp(-(wrapAngle(angle - 0.85) ** 2) / 0.045)
  const bayB = -0.09 * Math.exp(-(wrapAngle(angle - 2.55) ** 2) / 0.028)
  return LAND_RADIUS * (1 + lobes + bites + bayA + bayB)
}

/**
 * Normalised distance from a formation's centre along its own axes: 0 at
 * the centre, 1 at its edge. Elongated formations read as ranges.
 */
function formation(x: number, z: number, cx: number, cz: number, axis: number, length: number, width: number) {
  const dx = x - cx
  const dz = z - cz
  const c = Math.cos(axis)
  const s = Math.sin(axis)
  return { d: Math.hypot((dx * c + dz * s) / length, (-dx * s + dz * c) / width), u: (dx * c + dz * s) / length }
}

/**
 * A ridge system: distance from a long spine that wanders sideways (low
 * simplex along its length) and tapers at both ends, plus a crest height
 * that rises and falls along it, so the range reads as peaks and saddles
 * on one connected ridge rather than a single smooth summit.
 */
function ridgeSystem(x: number, z: number, cx: number, cz: number, axis: number, length: number, width: number, seed: number) {
  const dx = x - cx
  const dz = z - cz
  const c = Math.cos(axis)
  const s = Math.sin(axis)
  const along = dx * c + dz * s
  // Kept gentle: a meander steeper than this folds the spine into zigzags.
  const side = -dx * s + dz * c - simplex2(along * 0.16 + seed, seed * 0.7) * width * 0.8
  const beyond = Math.max(0, Math.abs(along) - length * 0.55) / (length * 0.45)
  const d = Math.hypot(beyond, side / width)
  const crest = 0.78 + 0.22 * simplex2(along * 0.45 - seed, seed + 3.1)
  return { d, crest }
}

/**
 * Valley lines: 1 along the zero line of a low warped field, 0 a valley-width
 * away. The profile is smooth at both the floor and the shoulders, so valleys
 * are worn troughs, not creased scoops.
 */
function valleyLines(x: number, z: number, frequency: number, ox: number, oz: number, width: number) {
  const n = shaped(simplex, x, z, frequency, ox, oz, 'domainWarp', 0.12)
  const t = smoothstep(0, 1, Math.abs(n) / width)
  return (1 - t) ** 1.4
}

function naturalLandform(x: number, z: number): number {

  // ── Macro: a few dominant formations, each its own kind of relief, placed
  // asymmetrically and warped by low simplex so their outlines are natural.
  // Warp kept gentle: strong warp at this scale folds the field into a straight cliff.
  const wx = x + simplex2(x * 0.09 + 1.3, z * 0.09 - 4.1) * 1.3
  const wz = z + simplex2(x * 0.09 - 7.2, z * 0.09 + 2.6) * 1.3

  // The high ridge system: long and wandering across the back of the island
  // (away from the default view, so it is the skyline), with peaks and
  // saddles along its crest. Steep near the spine, then long shoulders.
  const a = ridgeSystem(wx, wz, 1.2, -3.2, 0.42, 7.2, 1.35, 4.7)
  const rangeCore = smoothstep(0.1, 1, 1 - a.d) * a.crest
  const rangeHalo = smoothstep(-1.6, 0.4, 1 - a.d)

  // A lower ridge system down the west side, its north end running into the
  // high one at a saddle.
  const b = ridgeSystem(wx, wz, -3.3, -0.6, -1.25, 5.6, 1.05, -2.3)
  const westCore = smoothstep(0.1, 1, 1 - b.d) * b.crest
  const westHalo = smoothstep(-1.4, 0.4, 1 - b.d)

  // A tableland to the east: a tilted plateau whose inner end (facing the
  // basin) breaks off as an escarpment, while its outer side slopes away.
  // The outline is fixed; only how fast the edge rises changes around it.
  const p = formation(wx, wz, 3.3, 1.9, 0.6, 2.2, 1.7)
  const scarp = smoothstep(0.3, -0.6, p.u)
  // Steep at the scarp, but never a one-cell step.
  const edgeWidth = 0.1 + 0.55 * (1 - scarp)
  const outline = 1 - p.d + simplex2(x * 0.32 + 2.2, z * 0.32 - 6.6) * 0.16 + simplex2(x * 0.9 - 4.1, z * 0.9 + 1.7) * 0.05
  const table = smoothstep(0.2, 0.2 + edgeWidth, outline)
  // The top is not level: it sags in the middle and tilts up toward the scarp.
  const tableTop = table * (0.3 + 0.24 * scarp - 0.12 * smoothstep(0.5, 0.9, outline))
  // Below the escarpment a talus slope runs down into the lowland, not a vertical step onto flat ground.
  const talus = smoothstep(-0.55, 0.24, outline) * (1 - table) * scarp * 0.18
  // Gullies cut back into the plateau's edge zone, so the rim is notched;
  // they fade in and out of the zone gradually rather than ending in a wall.
  const edgeZone = smoothstep(-0.05, 0.25, outline) * (1 - smoothstep(0.3, 0.7, outline))
  const gullies = valleyLines(x, z, 0.42, 3.7, -8.2, 0.36) * edgeZone * 0.22

  // Open ground: broad rolling swells across the lowlands, flattened to
  // near-level patches where a second low field says so.
  const upland = Math.max(rangeHalo, westHalo, table)
  const swell = shaped(simplex, x, z, 0.13, 6.1, -2.4) * 0.26
  const level = smoothstep(0.1, 0.5, shaped(simplex, x, z, 0.12, -3.3, 9.7))
  const rolling = swell * (1 - level * 0.75) * (1 - upland)

  // The basin, off-centre between the formations: broad low ground the lakes are set into (waterways.ts).
  const bx = x - 0.5 + simplex2(x * 0.11 + 4.4, z * 0.11 - 1.3) * 1.4
  const bz = z - 0.5 + simplex2(x * 0.11 - 6.2, z * 0.11 + 8.1) * 1.4
  const basinDistance = Math.hypot(bx, bz) / LAND_RADIUS
  const basin = 1 - smoothstep(0.05, 0.4, basinDistance)
  // The whole island falls toward the basin, so it sits clearly below its surroundings and valleys drain into it.
  const tilt = smoothstep(0.1, 0.85, basinDistance) * 0.32

  // ── Low terrain: a connected network of valleys carved along the zero
  // lines of a low field, deep through the lowlands and between shoulders,
  // shallow on the plateau, never through the ridge spines.
  const core = Math.max(smoothstep(0.1, 0.7, 1 - a.d), smoothstep(0.1, 0.7, 1 - b.d))
  const valleys = valleyLines(x, z, 0.13, 11.3, -4.7, 0.36) * 0.42 * (1 - 0.9 * core) * (1 - 0.6 * table)

  const base = 0.12 + tilt + rangeCore * 1.75 + rangeHalo * 0.32 + westCore * 0.85 + westHalo * 0.16 + tableTop + talus + rolling
  const low = basin * 0.3 + valleys + gullies

  // ── Meso: the ridge hierarchy is strong on the ranges and their halos, so
  // spurs run down from them as long shoulders with valleys between, and
  // fades to almost nothing on the plateau top and the open ground.
  const ridges = ridgedMultifractal(x, z, 0.21, 4)
  const ridgeStrength = 0.08 + 1.4 * rangeHalo + 0.9 * westHalo + 0.3 * table
  // Near the spines the ridges only build up: their valleys would cut the
  // spine into separate peaks (or hollow the summits into craters).
  const spine = Math.max(smoothstep(-0.2, 0.6, 1 - a.d), smoothstep(-0.2, 0.6, 1 - b.d))
  // Blended across zero rather than switched, so there is no crease where the ridges meet the spine.
  const lift = ridges - 0.35
  const keep = 1 - 0.85 * spine * (1 - smoothstep(-0.12, 0.12, lift))
  const relief = lift * keep * ridgeStrength * (1 - 0.6 * basin)

  // ── Fine: a very faint grain so surfaces are rock, not a spline.
  const grain = shaped(simplex, x, z, 1.1, 2.1, 8.6) * 0.004

  return base - low + relief + grain
}

function rimErosion(t: number, angle: number): number {
  const band = smoothstep(0.84, 1, t)
  return 0.5 * band * band * (0.55 + 0.45 * ringNoise(angle, 3.1, 1.3))
}

/** Deeper under the high back of the island, so the slab has a real edge. */
const cliffDepth = (angle: number) => 1.5 + 0.45 * ringNoise(angle, 2.1, 5.2) + 0.4 * Math.max(0, -Math.sin(angle * 0.85 + 0.4))

const waterways = composeWaterways(naturalLandform)

export const LANDFORM_02: TerrainShape = {
  outlineRadius,
  landform: waterways.landform,
  rimErosion,
  cliffDepth,
  undersideDepth: 3,
  riverScale: 1.2,
  tessellation: { rings: 150, segments: 560 },
  water: { riverMinCells: 460, layout: waterways.layout },
}
