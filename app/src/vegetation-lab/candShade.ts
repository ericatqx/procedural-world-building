import { aim, grow, hex, mix, v3, type RGB, type V } from './geo.ts'
import { condition, compact, NEEDS, senescent, smooth } from './ecology.ts'
import { pointAt, taper, PAL } from './parts.ts'
import type { Candidate } from './types.ts'

/**
 * Shadow Ecology's shade specialist: the SHADE PARASOL. Not a shrub with leaves but a stalk that holds thin light-dishes out into the dim
 * air, one above another, each turned from the last by the golden angle so that no dish sits in the shadow of the one above it.
 *
 *   phyllotaxis      (E) the golden angle (137.5°) between successive organs minimises self-shading; here it is the whole body plan.
 *   monolayer        (E) shade plants hold one wide, thin, horizontal layer of leaf; here each dish is that layer, and the LOWER dishes are
 *                    the WIDER ones, because what reaches them has already passed the upper ones.
 *   iridescent sheen (E) some deep-shade plants (Begonia pavonina, Selaginella willdenowii) have blue-iridescent leaves whose layered cells
 *                    boost light capture in dim, green-filtered light; the dishes take a blue sheen at the rim, strongest in deep shade.
 *   light avoidance  (E) in strong light, leaves fold or turn edge-on (paraheliotropism); here the dishes cup upward, shrink and bleach.
 *   A: the dish form, the stalk, the stacked tiers and the colours are this world's own.
 */
const DISH: { deep: RGB; rim: RGB; bleached: RGB; stalk: RGB; stalkTop: RGB } = {
  deep: hex('#3c5752'),
  rim: hex('#86a9b8'),
  bleached: hex('#c8c3a2'),
  stalk: hex('#6f6a5c'),
  stalkTop: PAL.barkPale,
}
const GOLDEN = 2.39996

const parasol: Candidate['build'] = (g, p, r) => {
  const c = condition(p, NEEDS.parasol!)
  const sen = senescent(p.age)
  // How deep the shade is for it (0 at its brightest tolerable light) and how much glare it suffers.
  const deep = 1 - Math.min(1, p.light / 0.4)
  // Growth: the stalk lengthens and a dish is added at each step, from the first year (a parasol builds tier by tier all its life; it does not wait
  // for maturity). `grown` runs from 0 at germination to 1 at full size.
  const grown = smooth(Math.min(1, p.age / 0.85))
  const H = (0.25 + 1.55 * grown) * (0.6 + 0.4 * c.vigor) * compact(p)
  // A slender, pale, slightly arching stalk: it leans a little toward the gap (+z), as the Lab's other plants do.
  const stalk = grow([0, 0, 0], [0.04 + 0.06 * p.wind, 1, 0.03], H, 14, (t) => [(r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.03 + 0.03 * c.dim * t])
  g.tube(stalk, taper(0.03 * (0.6 + 0.5 * p.age), 0.006, 0.018, 0.08), (t) => mix(DISH.stalk, DISH.stalkTop, t), 6)

  const tiers = Math.max(1, Math.round(1 + 5 * grown * (0.6 + 0.4 * c.vigor) * (1 - 0.35 * c.drought)))
  for (let i = 0; i < tiers; i += 1) {
    // From low on the stalk to its tip; a seedling has one dish, at the top.
    const f = tiers === 1 ? 1 : 0.22 + 0.78 * (i / (tiers - 1))
    const at = pointAt(stalk, f)
    const hd = i * GOLDEN + r() * 0.25
    // Lower dishes stand farther out on longer petioles, and are wider: the monolayer, stacked.
    const pet = (0.05 + 0.2 * (1 - f)) * (0.6 + 0.4 * grown)
    const petiole = grow(at, aim(hd, 0.18 - 0.25 * (1 - f)), pet, 4, (t) => [0, -0.01 * t, 0])
    g.tube(petiole, (t) => 0.007 * (1 - 0.5 * t) + 0.002, (t) => mix(DISH.stalk, DISH.stalkTop, 0.5 + 0.5 * t), 4)
    const centre = petiole[petiole.length - 1]!
    const R = (0.2 + 0.3 * (1 - f)) * (0.5 + 0.5 * grown) * (0.55 + 0.45 * c.vigor) * (1 + 0.3 * deep) * (1 - 0.35 * c.glare) * (0.85 + 0.3 * r())
    // Glare cups the dish upward (it turns its face from the light); deep shade lets the rim sag slightly, flat to the sky.
    const cup = 0.75 * c.glare - 0.1 * deep
    const tilt: V = v3.norm([Math.cos(hd) * 0.08, 1, Math.sin(hd) * 0.08])
    const wedges = 12 + Math.floor(r() * 4)
    for (let w = 0; w < wedges; w += 1) {
      const a = (w / wedges) * Math.PI * 2 + r() * 0.08
      // Old dishes fray: a few wedges are shorter and paler.
      const spent = sen > 0.3 && (w + i) % 3 === 0 ? sen : 0
      const len = R * (0.9 + 0.2 * r()) * (1 - 0.45 * spent)
      const dir: V = v3.norm(v3.add([Math.cos(a), 0, Math.sin(a)], v3.mul(tilt, 0.02)))
      const path = grow(centre, dir, len, 5, (t) => [0, cup * 0.35 * t, 0])
      // Each wedge is a little wider than its share of the circle, so neighbours overlap into one continuous dish with a softly scalloped rim.
      const chord = Math.sin(Math.PI / wedges) * 2.3
      g.ribbon(
        path,
        (t) => len * chord * (0.06 + 0.94 * Math.sqrt(t)) * (t > 0.92 ? 1 - (t - 0.92) * 2.2 : 1) + 0.002,
        (t) => {
          // Deep teal at the centre, a blue sheen toward the rim in deep shade, bleached where the light is too strong.
          const base = mix(DISH.deep, DISH.rim, t * (0.25 + 0.75 * deep))
          return mix(base, DISH.bleached, Math.min(1, 0.85 * c.glare + 0.5 * spent))
        },
        [0, 1, 0],
        () => 0,
        'leaf',
      )
    }
  }
}

export const SHADE: Candidate[] = [
  {
    id: 'parasol',
    archetype: 'understory',
    light: 'shade',
    name: 'Shade parasol',
    size: 2.4,
    strategy: 'A slender stalk holds thin light-dishes out into dim air, each turned from the last by the golden angle so none shades another; the lowest are the widest.',
    adaptation: 'Deep shade: wide, flat dishes with a blue sheen at the rim. More light: smaller dishes that cup upward and bleach. Age adds tiers; drought removes them.',
    build: parasol,
  },
]
