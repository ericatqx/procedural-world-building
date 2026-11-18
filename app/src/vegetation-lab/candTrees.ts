import { aim, grow, type Geo, type V } from './geo.ts'
import { barkColour, broadLeaf, pointAt, taper } from './parts.ts'
import { compact, condition, gapward, hardening, juvenile, mature, NEEDS, senescent, smooth, windward, type Condition } from './ecology.ts'
import type { Candidate, PlantParams } from './types.ts'

type R = () => number
/** A cluster of broad leaves hanging from a point: a veil. `spent` shortens and warms them without changing how many random draws the cluster takes. */
function veil(g: Geo, p: PlantParams, r: R, at: V, count: number, len: number, width: number, spent = 0) {
  for (let k = 0; k < count; k += 1) {
    const hd = r() * 6.283
    const hang = -0.15 - 0.95 * r()
    broadLeaf(g, at, aim(hd, hang), len * (0.7 + 0.5 * r()) * (1 - 0.62 * spent), width * (0.75 + 0.5 * r()), 1.05 + 0.35 * spent, r, { wind: p.wind, warm: 0.32 + 0.55 * spent })
  }
}

/** Shade stretches shoots most in moderate shade, and not at all in deep shade, where nothing is built. */
const etiolation = (c: Condition) => 1 + 0.45 * 4 * c.dim * (1 - c.dim)

/** Weeping tiers: long near-level branches, each hung with veils of broad leaves, shared by the veil tree and the flooded trees. */
function weepingTiers(g: Geo, p: PlantParams, r: R, trunk: V[], H: number, c: Condition, o: { count: number; reach: number; from: number; hang: number }) {
  const phase = r() * 6.283
  // A small tree carries small limbs and small veils: everything below is in proportion to the tree's own height (full size from about 4 m).
  const sc = Math.min(1, H / 4)
  for (let i = 0; i < o.count; i += 1) {
    const f = o.from + (0.92 - o.from) * (i / Math.max(1, o.count - 1))
    const at = pointAt(trunk, f)
    // (Round 15: four or five limbs a tier, not five or six: fewer, fuller limbs read as a crown rather than a frame of branches.)
    const k = 4 + Math.floor(r() * 2)
    for (let b = 0; b < k; b += 1) {
      const hd = phase + i * 1.3 + (b / k) * 6.283 + (r() - 0.5) * 0.4
      // Wind prunes the windward side for good; shade sends the crown toward the gap; poor conditions shorten every limb.
      const wp = windward(p, hd)
      const len = H * o.reach * (1 - f * 0.7) * (0.4 + 0.8 * p.light) * gapward(c, hd) * (1 - 0.9 * wp) * (0.55 + 0.45 * c.vigor) * (0.8 + 0.4 * r())
      if (len < 0.25 * sc) continue
      // Near-level at the trunk, then a long sag. Length is unchanged, so the same seed still hangs the same number of veils.
      const elev = 0.02 + 0.14 * ((b * 0.37) % 1) * (0.45 + 0.55 * p.light) - 0.05 * (i / Math.max(1, o.count))
      const path = grow(at, aim(hd, elev), len, 8, (t) => [p.wind * (0.006 + 0.018 * t), -0.008 - 0.11 * (0.4 + 0.6 * p.moisture) * t * t, 0])
      g.tube(path, (t) => (0.032 * Math.sqrt(Math.max(0.4, len)) * sc + 0.006 * (1 - sc)) * hardening(p) * (1 - t) ** 0.7 + 0.003, barkColour, 5)
      if (wp > 0.6) continue
      const stops = Math.max(2, Math.round(len / (0.32 * Math.max(0.3, sc))))
      const cover = (1 - 0.7 * c.drought) * (1 - 0.5 * c.waterlog)
      const sen = senescent(p.age)
      for (let s2 = 1; s2 <= stops; s2 += 1) {
        const t = 0.35 + 0.65 * (s2 / stops)
        const spent = sen > 0.4 && (s2 + b + i) % 4 === 0 ? sen : 0
        // (Round 15: five broader leaves a veil (three narrow ones left the crowns see-through and skeletal).)
        veil(g, p, r, pointAt(path, t), Math.max(2, Math.round(5 * cover)), o.hang * (0.45 + 0.55 * cover) * (1 - 0.3 * f) * (0.25 + 0.75 * sc), (0.1 + 0.06 * cover) * (0.4 + 0.6 * sc), spent)
      }
    }
  }
}

const veilTree: Candidate['build'] = (g, p, r) => {
  const c = condition(p, NEEDS.upland!)
  const mt = mature(p.age)
  const jv = juvenile(p.age)
  // GROWTH FROM THE GROUND. `grown` runs from 0 at germination to 1 at full size (age 0.85): the leader lengthens from a few centimetres, the
  // trunk thickens with it, and tiers are added as the leader passes each one, so a seedling is a leafy shoot and a sapling a short leader with
  // its first low tiers. Later the crown lifts: the lowest tiers are shed (`from` rises with maturity).
  const grown = smooth(Math.min(1, p.age / 0.85))
  const H = (0.12 + 8.1 * grown ** 1.1) * (0.45 + 0.55 * c.vigor) * etiolation(c) * compact(p)
  const trunk = grow([0, 0, 0], [0.1 * p.wind, 1, 0], H, 14, () => [(r() - 0.5) * 0.05, 0, (r() - 0.5) * 0.05])
  const r0 = (0.006 + 0.26 * grown) * hardening(p)
  g.tube(trunk, taper(r0, Math.max(0.004, 0.02 * grown), r0 * 0.9 * (0.4 + 0.6 * mt), 0.12), barkColour, 8)
  // A sun-grown crown builds more tiers (multilayer); a shade-grown one fewer, flatter ones (monolayer). Tiers appear as the leader grows past them.
  const tiers = Math.round((0.2 + 4.8 * grown) * (0.5 + 0.5 * c.vigor) * (1 + 0.22 * g.leaf.k))
  weepingTiers(g, p, r, trunk, H, c, { count: tiers, reach: 0.5 - 0.08 * jv, from: 0.12 + 0.38 * mt, hang: 1.0 })
  const sen = senescent(p.age)
  const sc = Math.min(1, H / 4)
  veil(g, p, r, trunk[trunk.length - 1]!, Math.round(4 + 5 * mt * c.vigor), (0.55 + 0.55 * mt) * (1 - 0.35 * sen) * (0.3 + 0.7 * sc), 0.13 * (0.5 + 0.5 * sc), sen)
  // A young leader still carries leaves low on the stem: on a seedling, these ARE its leaves.
  if (jv > 0.5) {
    for (let s = 0; s < 4; s += 1) {
      broadLeaf(g, pointAt(trunk, 0.3 + s * 0.15), aim(s * 1.7, 0.15), (0.26 + 0.06 * s) * (0.3 + 0.7 * sc), 0.055 * (0.5 + 0.5 * sc), 0.7, r, { wind: p.wind, warm: 0.12 })
    }
  }
}

const buttress: Candidate['build'] = (g, p, r) => {
  const c = condition(p, NEEDS.flood!)
  // Growth from the ground, as for the veil tree; the buttresses and knees form only as the trunk thickens.
  const grown = smooth(Math.min(1, p.age / 0.85))
  const H = (0.15 + 10 * grown ** 1.1) * (0.55 + 0.45 * c.vigor) * compact(p)
  const trunk = grow([0, 0, 0], [0.05 * p.wind, 1, 0], H, 14, () => [(r() - 0.5) * 0.02, 0, (r() - 0.5) * 0.02])
  const r0 = (0.008 + 0.3 * grown) * hardening(p)
  const flare = (0.12 + 0.5 * p.depth) * grown ** 1.5
  g.tube(trunk, taper(r0, 0.03, flare, 0.08), barkColour, 9)
  const fins = 5 + Math.floor(r() * 3)
  const hb = (0.6 + 1.6 * p.depth) * grown ** 1.5
  for (let i = 0; i < (hb > 0.05 ? fins : 0); i += 1) {
    const a = (i / fins) * 6.283 + r() * 0.4
    const dir: V = [Math.cos(a), 0, Math.sin(a)]
    const tang: V = [-Math.sin(a), 0, Math.cos(a)]
    const R0 = r0 + flare * (1.2 + 0.8 * r())
    const path: V[] = []
    for (let s = 0; s <= 8; s += 1) {
      const t = s / 8
      const w = (R0 - r0) * (1 - t) ** 1.6
      path.push([dir[0] * (r0 * 0.8 + w * 0.5), t * hb, dir[2] * (r0 * 0.8 + w * 0.5)])
    }
    g.ribbon(path, (t) => ((R0 - r0) * (1 - t) ** 1.5 + 0.012) * (0.88 + 0.12 * Math.sin(t * 7 + a)), (t) => barkColour(0.15 + 0.75 * t), tang)
  }
  const knees = Math.round((3 + 16 * Math.min(1, p.depth)) * Math.max(0, grown - 0.3) / 0.7)
  for (let k = 0; k < knees; k += 1) {
    const a = r() * 6.283
    const rad = r0 + flare + 0.3 + r() * (0.8 + 1.4 * p.depth)
    const h = 0.12 + (0.15 + 0.5 * p.depth) * (0.4 + 0.6 * r())
    const path = grow([Math.cos(a) * rad, -0.02, Math.sin(a) * rad], [0, 1, 0], h, 4, () => [(r() - 0.5) * 0.15, 0, (r() - 0.5) * 0.15])
    g.tube(path, (t) => 0.05 * (1 - t) ** 0.7 + 0.008, (t) => barkColour(0.3 + 0.7 * t), 5)
  }
  weepingTiers(g, p, r, trunk, H, c, { count: Math.round((0.2 + 3.8 * grown) * (0.5 + 0.5 * c.vigor)), reach: 0.55, from: 0.3 + 0.25 * mature(p.age), hang: 1.3 })
  const sc = Math.min(1, H / 4)
  veil(g, p, r, trunk[trunk.length - 1]!, Math.round(3 + 4 * c.vigor), 1.0 * (0.3 + 0.7 * sc), 0.1 * (0.5 + 0.5 * sc))
}

export const TREES: Candidate[] = [
  { id: 'spar', archetype: 'upland', light: 'sun', name: 'Weeping veil tree', size: 9, strategy: 'A monopodial leader with a few long tiers that leave the trunk near level and sag, each hung with veils of broad pendant leaves (apical dominance; branch length set by crown light).', adaptation: 'Age: a short leafy leader becomes a tall trunk as the lower tiers are shed. Near the end of the range the veils thin and warm, and some limbs carry only short spent leaves. Light: moderate shade stretches it, deep shade stops it building; the crown leans toward the gap. Moisture: best in the middle; drought thins the veils, saturation shortens the tiers. Wind prunes the windward side for good.', build: veilTree },
  { id: 'buttress', archetype: 'flood', light: 'broad', name: 'Buttress and knees', size: 10, strategy: 'A flared trunk with radial buttress fins, a ring of knees rising through the water, and a weeping crown of veils.', adaptation: 'Water depth raises the buttresses and adds knees. Tolerates saturation; drought thins the crown. Age: lower tiers are shed as it matures; shade and wind shape the crown as for the veil tree.', depth: true, build: buttress },
]
