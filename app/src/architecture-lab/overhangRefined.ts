import type { Arm, OrganismForm, OverhangCompose } from '../project03/livingOverhang3.ts'
import type { Habitat } from './families.ts'
import type { Terrain } from './terrainContext.ts'

/**
 * The refined Overhang: the world's own generator (livingOverhang3.ts), unchanged in its parts, with a composition chosen from
 * the seed within its identity. A keep of masses on a plinth, a great shelf that cantilevers from it, supports where the load
 * goes, an undercroft beneath: these stay, and so does the strong primary tower (nearly upright: a lean of a few hundredths at most).
 * What the seed now decides is how they are arranged:
 *   masses        how tall and wide each of the keep's three masses is, where the middle and mouth-side ones stand, and whether a fourth,
 *                 secondary tower stands behind
 *   cantilever    its length, thickness, width, rise, and the direction it swings (toward the water side or away)
 *   supports      whether the outlier body takes the shelf's end or it is a free cantilever (then braced by more piers),
 *                 how many raking piers stand under it, and where
 *   outline       how loose the outlines are
 * The habitat acts through the organism's resource budget (see `biology` in docs/planning/shadow-ecology.md): light gives energy through
 * its photosynthetic symbionts, water and dissolved minerals/nutrients give the material for the skeleton, and wind and crowding shape
 * what that budget can safely build. Each rule below is a continuous function of the habitat (never a preset), and each is 1 (no change)
 * at the reference habitat, so the approved reference form is the baseline:
 *   exposure (open ridge)     wind-resistant: shorter reach, thicker and wider cantilever, wider and slightly lower masses, more piers, less swing
 *   shade and shelter         light competition: the tower is taller, the cantilever carried higher, the masses narrower
 *   water and minerals near   (damp shore) broader attachment, a second mass more often, a heavier (mineral-accumulating) cantilever where resources permit
 *   crowding                  lateral growth is redirected (a stronger swing), the reach shortens, the tower races for light
 *   resources                 every extension (height, reach, thickness) scales with the supply of minerals and nutrients: a poor place builds less
 * The ground adds to this (`terrain`, measured against the Lab's reference ground, so the reference stays the baseline): on steeper ground the
 * footing broadens, a buttress mass stands on the uphill side, the cantilever swings and a branch reaches downhill (where the open space and
 * light are), the cantilever follows the rise or fall of the ground, and the piers are more numerous and longer on the downhill side.
 * A rich, well-lit place also grows a second, lower cantilever.
 * Draws are by seed alone, so the same seed under another habitat keeps its arrangement; the tower and the cantilever are floored (the
 * keep never below 0.85 of the reference, the reach never below 0.95), so no place removes them.
 *
 * (The later four-composition version is kept in overhangCompositions.ts, not offered.)
 */
const rv = (seed: number, a: number, b: number) => {
  const s = Math.sin(seed * 12.9898 + a * 78.233 + b * 37.719 + 3.1) * 43758.5453
  return s - Math.floor(s)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export function refinedForm(seed: number, h: Habitat, base: OrganismForm, terrain?: Terrain): OrganismForm {
  const r = (k: number) => rv(seed, 400, k)
  const wet = h.moisture
  const exposed = clamp(h.ridge, -1, 1)
  // The habitat's terms, each zero at the reference habitat.
  const exp = Math.max(0, exposed) // open ridge: wind
  const shelter = Math.max(0, -exposed) // hollow
  const shadeComp = Math.max(0, 0.55 - h.light) * 2 // competition for light
  const vertical = clamp(0.7 * shelter + 1.4 * shadeComp - exp, 0, 1)
  const nearWater = h.waterDist === null ? 0 : clamp((1 - (h.waterDist - 28) / 130 - 0.55) / 0.45, 0, 1)
  const crowd = clamp(h.crowding, 0, 1)
  const supply = 1 + 0.4 * (h.resource - 0.6) // minerals and nutrients: 1 at the reference supply
  const sx = terrain ? clamp(terrain.slope / 0.12, 0, 1) : 0 // steeper ground than the reference
  const downSign = terrain && terrain.downAng > 0 ? 1 : -1 // downhill toward the water side (+) or away from it (-)
  const mineralShore = nearWater * clamp((h.resource - 0.4) / 0.4, 0, 1) // minerals accumulate only where the supply allows
  // Which arrangement this seed leans toward, as continuous numbers rather than a menu.
  const stepped = r(1)
  const lateral = r(3)

  const climb = supply * (1 - 0.12 * exp) * (1 + 0.3 * vertical) * (1 + 0.08 * crowd)
  const tops: [number, number, number] = [lerp(0.8, 1.3, r(4)) * (1 - 0.1 * stepped) * climb, lerp(0.6, 1.35, r(5)) * (1 + 0.1 * stepped) * supply * (1 - 0.1 * exp), lerp(0.6, 1.9, r(6)) * (0.8 + 0.4 * stepped) * supply]
  const broad = (1 + 0.12 * exp) * (1 + 0.18 * mineralShore) * (1 - 0.1 * vertical)
  const widths: [number, number, number] = [lerp(0.85, 1.25, r(7)) * broad, lerp(0.8, 1.3, r(8)) * broad, lerp(0.8, 1.35, r(9)) * broad]
  const shifts: [[number, number], [number, number]] = [
    [lerp(-5, 4, r(10)), lerp(-6, 7, r(11))],
    [lerp(-4, 7, r(12)), lerp(-7, 8, r(13))],
  ]
  // The primary tower stays nearly upright.
  const lean: [number, number, number] = [lerp(-0.03, 0.03, r(14)), lerp(-0.05, 0.06, r(15)), lerp(-0.04, 0.05, r(16))]
  const side = r(17) < 0.5 ? 1 : -1
  const extra =
    r(18) < 0.55 + 0.4 * mineralShore || sx > 0.25
      ? {
          cu: lerp(-34, -23, r(19)),
          // On a slope the second mass stands on the uphill side, as a buttress.
          cw: (sx > 0.25 ? -downSign : side) * lerp(11, 17, r(20)),
          hu: lerp(5, 8, r(21)),
          hw: lerp(5, 8, r(22)),
          top: lerp(14, 30, r(23)) * (base.keep ?? 1) ** 0.5 * (sx > 0.25 ? 0.8 : 1),
          taper: lerp(0.15, 0.32, r(24)),
          lean: lerp(-0.04, 0.05, r(25)),
        }
      : undefined

  // The cantilever: how far, which way, how heavy. A longer reach is thicker; a free one is braced.
  const outlier = (base.outlier ?? true) && r(26) > 0.3
  const reachScale = lerp(0.85, 1.5, r(27)) * (outlier ? 1 : 0.85) * supply * (1 - 0.22 * exp) * (1 - 0.15 * crowd)
  const swing0 = (r(28) < 0.5 ? 1 : -0.7) * lerp(0.4, 3.2, r(29)) * (0.6 + 0.8 * lateral) * (1 - 0.5 * exp) * (1 + 1.2 * crowd)
  // On a slope the cantilever swings toward the downhill side (a negative swing goes toward the water side).
  const swing = lerp(swing0, -downSign * Math.abs(swing0), sx)
  const shelfThick = clamp(lerp(0.82, 1.3, r(30)) * (0.9 + 0.2 * reachScale) * (1 + 0.25 * exp) * (1 + 0.2 * mineralShore) * (0.9 + 0.2 * (supply - 0.84) / 0.32), 0.8, 1.7)
  const shelfWidth = lerp(0.8, 1.2, r(31))
  const rise = lerp(-3, 5, r(32)) + (terrain ? clamp(terrain.rise * 0.7, -7, 7) : 0)

  // Supports: raking piers under the shelf. A free cantilever needs more.
  const pierCount = clamp(Math.round(lerp(0, 2.4, r(33)) + (outlier ? 0 : 1) + (reachScale > 1.2 ? 0.5 : 0) + 1.3 * exp + 1.6 * sx), 0, 5)
  const piers = Array.from({ length: pierCount }, (_, i) => ({
    u: lerp(0.26, 0.78, (i + r(34 + i)) / pierCount),
    side: (i % 2 === 0 ? 1 : -1) * lerp(0.2, 0.9, r(40 + i)) * (r(44 + i) < 0.5 ? 1 : -1),
    len: lerp(8, 14, r(48 + i)) * (1 + 0.4 * sx),
    lean: lerp(0.5, 2.6, r(52 + i)),
  }))

  // Branches: a second, lower cantilever where the place is rich and well lit; one reaching downhill on a slope.
  const arms: Arm[] = []
  const branch = clamp((h.resource - 0.62) * 3, 0, 1) * clamp((h.light - 0.55) * 5, 0, 1)
  if (branch > 0.25) arms.push({ mass: 0, ang: side * lerp(1, 1.6, r(60)), len: 14 + 16 * branch, hw: [6.5, 4.8], thick: [4, 2.6], top: lerp(12, 16, r(61)), sag: 1.5, piers: [{ at: 0.6, len: 10, lean: 1 }] })
  if (terrain && sx > 0.35) arms.push({ mass: 0, ang: clamp(terrain.downAng, -1.3, 1.3), len: 16 + 14 * sx, hw: [6, 4.5], thick: [4, 2.6], top: lerp(11, 14, r(62)), sag: 1.5, piers: [{ at: 0.6, len: 10, lean: 1 }] })
  const compose: OverhangCompose = {
    tops,
    widths,
    shifts,
    lean,
    extra,
    shelfThick,
    shelfWidth,
    piers,
    keepPier: r(56) > 0.2,
    soft: clamp(lerp(0.2, 0.65, r(57)) + 0.2 * wet, 0, 0.9),
    ...(arms.length > 0 ? { arms } : {}),
  }
  return {
    ...base,
    keep: clamp((base.keep ?? 1) * (1 + 0.75 * vertical), 0.85, 1.4),
    ...(sx > 0 ? { spread: (base.spread ?? 1) * (1 + 0.35 * sx) } : {}),
    reach: Math.max((base.reach ?? 1) * reachScale, 0.95),
    shelfLift: clamp((base.shelfLift ?? 1) * lerp(0.9, 1.22, r(58)) * (1 + 0.2 * vertical), 0.75, 1.5),
    swing,
    rise: (base.rise ?? 0) + rise,
    outlier,
    oldShelf: (base.oldShelf ?? true) && r(59) > 0.3,
    compose,
  }
}
