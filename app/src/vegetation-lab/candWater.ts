import { aim, grow, mix, type V } from './geo.ts'
import { barkColour, leafColour, PAL } from './parts.ts'
import { compact, condition, fit, grownAt, hardening, juvenile, mature, NEEDS, ramp } from './ecology.ts'
import type { Candidate } from './types.ts'

const reed: Candidate['build'] = (g, p, r) => {
  const c = condition(p, NEEDS.shore!)
  const mt = mature(p.age)
  // Emergent wetland reeds do best in shallow standing water and thin out as it deepens past what they can emerge from. A clone
  // spreads by rhizome with age: a young plant is a few stems, a mature stand a dense one. Exposure makes stems shorter and
  // stiffer, and lodges them downwind for good; flower spikes need light and maturity.
  const depthFit = fit(p.depth, [-0.2, 0.05, 0.5, 1.0], 0.05)
  const n = Math.round((4 + 60 * mt) * (0.35 + 0.65 * c.vigor) * (0.2 + 0.8 * depthFit))
  const spread = (0.1 + 0.4 * p.age) * (0.7 + 0.5 * p.moisture)
  for (let i = 0; i < n; i += 1) {
    const a = r() * 6.283
    const rad = spread * Math.sqrt(r())
    const start: V = [Math.cos(a) * rad, -0.05, Math.sin(a) * rad]
    const H = (0.1 + 1.85 * grownAt(p.age)) * (0.55 + 0.45 * c.vigor) * (0.6 + 0.4 * depthFit) * (1 + 0.25 * Math.min(p.depth, 0.6)) * (0.6 + 0.6 * r()) * compact(p)
    const face: V = [Math.cos(a + 1), 0.05, Math.sin(a + 1)]
    const path = grow(start, [p.wind * 0.3 + (r() - 0.5) * 0.12, 1, (r() - 0.5) * 0.12], H, 9, (t) => [p.wind * 0.08 * t * t + (r() - 0.5) * 0.01, -0.012 * t - 0.05 * t * t, 0])
    g.ribbon(path, (t) => (0.026 * (1 - t) ** 0.8 + 0.002) * hardening(p) * (0.5 + 0.5 * c.vigor), (t) => mix(PAL.leaf, PAL.leafPale, t * 0.8), face, (t) => t * 0.7)
    if (p.light > 0.5 && mt > 0.4 && r() < 0.45) {
      const tip = path[path.length - 1]!
      const head = grow(tip, [0.15, 1, 0], 0.13 + 0.06 * p.age, 3, () => [p.wind * 0.1, 0, 0])
      g.tube(head, (t) => 0.012 * Math.sin(Math.PI * (0.15 + 0.85 * (1 - t))) + 0.002, () => PAL.clay, 5)
    }
  }
}

const sedge: Candidate['build'] = (g, p, r) => {
  const c = condition(p, NEEDS.shore!)
  const mt = mature(p.age)
  // Tussock sedges widen as a tuft with age and stand on a mound that rises with water depth; past about half a metre of water
  // the blades are overtopped and fewer. Exposure shortens and stiffens the blades.
  // A seedling is one small tuft; tufts are added, and spread from the centre, as the clump grows.
  const gr = grownAt(p.age)
  const tufts = 1 + Math.round(1 + 3 * mt) * (gr > 0.25 ? 1 : 0)
  const drown = 1 - 0.6 * ramp(p.depth, 0.4, 0.8)
  for (let t = 0; t < tufts; t += 1) {
    const a = (t / tufts) * 6.283 + r() * 0.8
    const cx = Math.cos(a) * (0.35 + 0.4 * r()) * gr
    const cz = Math.sin(a) * (0.35 + 0.4 * r()) * gr
    const mound = (Math.min(p.depth * 0.6, 0.35) + 0.04) * (0.3 + 0.7 * gr)
    for (let q = 0; q < 7; q += 1) {
      const qa = (q / 7) * 6.283 + r()
      g.tube(grow([cx, -0.05, cz], [Math.cos(qa) * 0.5, 0.9, Math.sin(qa) * 0.5], mound + 0.12 * gr, 4, () => [Math.cos(qa) * 0.12 * gr, -0.05 * gr, Math.sin(qa) * 0.12 * gr]), (u) => (0.045 * (1 - u * 0.6)) * (0.3 + 0.7 * gr) + 0.004, (u) => barkColour(0.2 + 0.5 * u), 5)
    }
    const n = Math.max(4, Math.round((5 + 18 * mt) * (0.4 + 0.6 * c.vigor) * drown))
    for (let k = 0; k < n; k += 1) {
      const hd = r() * 6.283
      const len = (0.08 + 1.0 * grownAt(p.age)) * (0.6 + 0.6 * r()) * (0.55 + 0.45 * c.vigor) * compact(p)
      const path = grow([cx, mound, cz], aim(hd, 1.15), len, 9, (u, d) => [Math.cos(hd) * (0.03 + 0.12 * u * u) + p.wind * 0.03, -(0.02 + 0.16 * u * u) * (0.65 + 0.7 * p.wind) * (d[1] > -0.2 ? 1 : 0.35), Math.sin(hd) * (0.03 + 0.12 * u * u)])
      g.ribbon(path, (u) => (0.016 * (1 - u) ** 0.7 + 0.0015) * hardening(p), (u) => mix(PAL.leafDeep, PAL.leafPale, u), [Math.cos(hd), 0.3, Math.sin(hd)], (u) => u * 1.2)
    }
  }
}

const broadleaf: Candidate['build'] = (g, p, r) => {
  const c = condition(p, NEEDS.shore!)
  const mt = mature(p.age)
  // A marginal herb: a young plant has a few small leaves; a mature clump has many large ones. Leaves are held upright in light and
  // droop in shade; exposure makes them smaller and turns them downwind; deeper water raises the stems.
  const depthFit = fit(p.depth, [-0.2, 0.05, 0.6, 1.1], 0.1)
  const n = Math.max(3, Math.round((3 + 9 * mt) * (0.4 + 0.6 * c.vigor) * (0.4 + 0.6 * depthFit)))
  for (let i = 0; i < n; i += 1) {
    const a = r() * 6.283
    const rad = (0.1 + 0.4 * Math.sqrt(r())) * (0.5 + 0.6 * p.age)
    const H = (0.12 + 1.08 * grownAt(p.age) + 0.4 * Math.min(p.depth, 0.8) * grownAt(p.age)) * (0.7 + 0.5 * r()) * (0.6 + 0.4 * c.vigor) * compact(p)
    const stem = grow([Math.cos(a) * rad, -0.05, Math.sin(a) * rad], [Math.cos(a) * 0.1, 1, Math.sin(a) * 0.1], H, 6, () => [p.wind * 0.02, 0, 0])
    g.tube(stem, (t) => (0.007 * (1 - 0.3 * t) + 0.002) * hardening(p), (t) => barkColour(0.1 + 0.4 * t), 4)
    const top = stem[stem.length - 1]!
    const tilt = 0.5 + 0.7 * p.light
    const hd = a + (r() - 0.5) * 0.6
    const lp = grow(top, aim(hd + p.wind * (Math.cos(hd) > 0 ? -0.3 : 0.5), tilt), (0.25 + 0.3 * p.moisture) * (0.4 + 0.6 * p.age) * (1 - 0.35 * p.wind), 8, (t) => [p.wind * 0.03, -(0.12 + 0.1 * (1 - p.light)) * t, 0])
    const W = (0.1 + 0.15 * p.moisture) * (0.5 + 0.5 * c.vigor) * (1 - 0.3 * p.wind)
    g.ribbon(lp, (t) => W * Math.sin(Math.PI * Math.min(1, t ** 0.55 * 0.9 + 0.06)) ** 0.7 * (t > 0.8 ? 1 - ((t - 0.8) / 0.2) * 0.65 : 1) + 0.004, (t) => leafColour(0.18 + 0.75 * t, 0.18), [0, 1, 0], (t) => (r() - 0.5) * 0.05 + t * 0.3, 'leaf')
  }
}

const meadow: Candidate['build'] = (g, p, r) => {
  // Submerged meadows are limited by the light that reaches the bed, which falls with depth: no light, no leaves. A seedling is a short
  // basal tuft; mature plants have long blades and many clumps. Current (wind) shears the blades short, narrow and leaning.
  const L = p.light * Math.exp(-0.45 * p.depth)
  const lit = ramp(L, 0.04, 0.3)
  const mt = mature(p.age)
  const clumps = Math.max(2, Math.round((4 + 24 * mt) * (0.25 + 0.75 * lit)))
  for (let c = 0; c < clumps; c += 1) {
    const a = r() * 6.283
    const rad = (0.15 + 0.4 * p.age) * Math.sqrt(r())
    const root: V = [Math.cos(a) * rad, -0.02, Math.sin(a) * rad]
    const k = 3 + Math.floor(r() * 4)
    for (let b = 0; b < k; b += 1) {
      const len = Math.min(0.12 + 1.2 * p.age * (0.3 + 0.7 * lit) * (1 - 0.4 * p.wind), Math.max(0.2, p.depth * 1.15)) * (0.6 + 0.6 * r())
      const ph = r() * 6.283
      const path = grow(root, [(r() - 0.5) * 0.4, 1, (r() - 0.5) * 0.4], len, 12, (t) => [p.wind * 0.09 * t + 0.05 * Math.sin(t * 4 + ph) * (0.3 + p.wind), 0, 0.05 * Math.cos(t * 3 + ph) * (0.3 + p.wind)])
      g.ribbon(path, (t) => (0.05 * Math.sin(Math.PI * Math.min(1, t * 0.8 + 0.2)) ** 0.7 + 0.006) * (1 - 0.35 * p.wind), (t) => mix(PAL.leafDeep, PAL.leafPale, 0.2 + 0.8 * t), [Math.cos(ph), 0, Math.sin(ph)], (t) => t * 2.2 + ph)
    }
  }
}

const stonewort: Candidate['build'] = (g, p, r) => {
  // A stonewort-like alga: whorls only form once the stem is a little tall, and sit closer where there is more light; the stem is
  // capped by the water above it, and current tilts it.
  const L = p.light * Math.exp(-0.45 * p.depth)
  const lit = ramp(L, 0.04, 0.3)
  const jv = juvenile(p.age)
  const n = Math.max(3, Math.round((3 + 10 * mature(p.age)) * (0.3 + 0.7 * lit)))
  for (let i = 0; i < n; i += 1) {
    const a = r() * 6.283
    const rad = (0.1 + 0.35 * p.age) * Math.sqrt(r())
    const H = Math.min(0.12 + 1.1 * p.age * (0.3 + 0.7 * lit), Math.max(0.3, p.depth * 0.95)) * (0.7 + 0.5 * r())
    const stem = grow([Math.cos(a) * rad, -0.02, Math.sin(a) * rad], [0, 1, 0], H, 12, (t) => [p.wind * 0.1 * t, 0, 0])
    g.tube(stem, (t) => 0.012 * (1 - 0.5 * t) + 0.003, (t) => mix(PAL.leafDeep, PAL.water, t), 5)
    const gap = 0.12 - 0.06 * lit
    const whorls = H < 0.15 ? 0 : Math.floor(H / gap)
    for (let w = 1; w <= whorls; w += 1) {
      const t = (w * gap) / H
      const at = stem[Math.min(stem.length - 1, Math.round(t * (stem.length - 1)))]!
      const m = 6 + Math.floor(r() * 3)
      for (let q = 0; q < m; q += 1) {
        const hd = (q / m) * 6.283 + w * 0.5
        const bl = (0.12 + 0.1 * lit) * (1 - 0.3 * t) * (1 - 0.5 * jv)
        const bp = grow(at, aim(hd, 0.3), bl, 3, () => [0, 0.25, 0])
        g.ribbon(bp, (u) => 0.014 * (1 - u * 0.55), (u) => mix(PAL.leaf, PAL.leafPale, u), [0, 1, 0], () => 0, 'leaf')
      }
    }
  }
}

export const WATER: Candidate[] = [
  { id: 'reed', light: 'sun', archetype: 'shore', name: 'Reed clump', size: 2.2, depth: true, strategy: 'A tight cluster of tapering, slightly twisted blades from one stand, some topped by dense seed spikes.', adaptation: 'Age: a few stems, then a dense clone spreading by rhizome. Depth: best in shallow water, thinning as it deepens. Exposure: shorter, stiffer stems that lean downwind for good. Seed spikes need light and maturity.', build: reed },
  { id: 'sedge', light: 'sun', archetype: 'shore', name: 'Sedge fountain', size: 1.2, depth: true, strategy: 'Separate tussocks, each a fountain of narrow blades that rise and arch over under their own weight.', adaptation: 'Age: small tufts, then wider tussocks. Depth lifts the tussock on a mound and overtops the blades past about half a metre. Exposure shortens and stiffens the blades.', build: sedge },
  { id: 'broadleaf', light: 'sun', archetype: 'shore', name: 'Broadleaf marginal', size: 1.6, depth: true, strategy: 'Stems topped by large paddle leaves that lean outward, giving a layered, flat-leaved stand.', adaptation: 'Age: a few small leaves, then a large clump. Depth raises the stems; shade lets leaves droop; exposure shrinks them and turns them downwind.', build: broadleaf },
  { id: 'meadow', archetype: 'submerged', name: 'Ribbon meadow', size: 1.5, depth: true, strategy: 'Clumps of long, flexible strap blades anchored in the bed, swaying and twisting in the current.', adaptation: 'Light at the bed (falling with depth) limits growth: no light, no leaves. A seedling is a short tuft. Current shears blades short and narrow and leans them downstream. Moisture does not apply to a plant that is fully underwater.', build: meadow },
  { id: 'stonewort', archetype: 'submerged', name: 'Whorled stonewort', size: 1.4, depth: true, strategy: 'Slim upright stems with regular whorls of fine branchlets, like a stonewort or hornwort.', adaptation: 'Whorls form only once the stem is tall enough and sit closer in more light. The stem is capped by the water above it; current tilts it. Moisture does not apply underwater.', build: stonewort },
]
