import { clamp, Geo, grow, hex, mix, rotate, v3, type RGB, type V } from './geo.ts'

/** The lab's palette: pale, restrained, a little otherworldly. */
export const PAL = {
  barkDark: hex('#5f594e'),
  bark: hex('#8c8576'),
  barkPale: hex('#c4bba7'),
  leafDeep: hex('#4f6d5c'),
  leaf: hex('#8A9D91'),
  leafPale: hex('#b7c4b2'),
  clay: hex('#B69A80'),
  bone: hex('#cfc9bb'),
  rock: hex('#7a766c'),
  rockPale: hex('#a39e92'),
  water: hex('#7fa89a'),
}

export const leafColour = (t: number, warm = 0): RGB => mix(mix(PAL.leafDeep, PAL.leafPale, t), PAL.clay, warm * t * t)
export const barkColour = (t: number): RGB => mix(PAL.barkDark, PAL.bark, Math.min(1, t * 1.4))

export const pointAt = (path: V[], f: number): V => {
  const x = clamp(f) * (path.length - 1)
  const i = Math.min(path.length - 2, Math.floor(x))
  return v3.lerp(path[i]!, path[i + 1]!, x - i)
}
export const tangentAt = (path: V[], f: number): V => {
  const x = clamp(f) * (path.length - 1)
  const i = Math.min(path.length - 2, Math.floor(x))
  return v3.norm(v3.sub(path[i + 1]!, path[i]!))
}

/** Width of a simple blade: narrow at the petiole, fullest before the middle, drawn out to a drip tip. */
export const bladeWidth = (width: number, t: number) => {
  const u = Math.min(1, Math.max(0, t))
  const body = Math.sin(Math.PI * u ** 0.58) ** 0.66
  const tip = 1 - 0.62 * Math.max(0, (u - 0.7) / 0.3) ** 1.35
  return width * body * tip + 0.0015
}

/** A fan of drooping blades from a point: a spray of foliage with no sphere or cone about it. */
export function spray(g: Geo, at: V, dir: V, r: () => number, o: { count: number; len: number; spread: number; droop: number; width: number; warm?: number; wind?: number }) {
  const d = v3.norm(dir)
  const side = v3.norm(v3.cross(d, [0.3, 1, 0.2]))
  for (let k = 0; k < o.count; k += 1) {
    const a = (k / o.count) * Math.PI * 2 + r() * 0.6
    const tilt = o.spread * (0.25 + 0.95 * r())
    let dd = rotate(d, side, tilt)
    dd = rotate(dd, d, a)
    const len = o.len * (0.65 + 0.5 * r()) * (0.72 + 0.4 * ((k * 0.618) % 1)) * g.leaf.size
    const droop = o.droop * (0.7 + 0.55 * ((k * 0.37) % 1)) * g.leaf.droop
    const path = grow(at, dd, len, 5, (t) => [(o.wind ?? 0) * 0.06 * t * t, -droop * (0.08 * t + 0.28 * t * t), 0])
    g.ribbon(path, (t) => bladeWidth(o.width * (0.85 + 0.3 * ((k + 1) % 3) / 2), t), (t) => leafColour(0.25 + 0.75 * t, o.warm ?? 0.3), [0, 1, 0], () => (r() - 0.5) * 0.55, 'leaf')
  }
}

/** A pinnate frond: a curving rachis with paired leaflets that shorten toward the tip. The two sides of a pair are staggered. */
export function frond(g: Geo, at: V, dir: V, len: number, droop: number, leaflet: number, r: () => number, wind = 0, warm = 0.15) {
  const path = grow(at, dir, len, 10, (t) => [wind * 0.04 * t, -droop * (0.01 + 0.12 * t * t), wind * 0.02 * Math.sin(t * 3.1)])
  g.tube(path, (t) => 0.0045 * (1 - t) ** 0.8 + 0.0009, (t) => mix(PAL.barkPale, PAL.leaf, t), 4)
  for (let i = 2; i < path.length - 1; i += 1) {
    const t = i / (path.length - 1)
    const tan = v3.norm(v3.sub(path[Math.min(path.length - 1, i + 1)]!, path[i - 1]!))
    const side = v3.norm(v3.cross(tan, [0, 1, 0]))
    const l = leaflet * g.leaf.size * Math.sin(Math.PI * Math.min(1, t * 0.85 + 0.12)) ** 0.85 * (0.8 + 0.4 * r())
    for (const s of [-1, 1]) {
      const shift = s < 0 ? 0 : 0.42
      const atP = i + 1 < path.length ? v3.lerp(path[i]!, path[i + 1]!, shift) : path[i]!
      const d = v3.norm(v3.add(v3.add(v3.mul(side, s * (0.85 + 0.2 * (i % 2))), v3.mul(tan, 0.28)), [0, -droop * 0.12, 0]))
      const p = grow(atP, d, l * (s < 0 ? 1 : 0.9), 4, (u) => [0, -0.06 - 0.16 * u, s * 0.04 * u])
      g.ribbon(p, (u) => bladeWidth(l * 0.34, u), (u) => leafColour(0.22 + 0.7 * t * (0.4 + 0.6 * u), warm), [0, 1, 0], () => 0, 'leaf')
    }
  }
}

/** Root flare and bark ridges: a tube whose radius swells toward the ground. */
export const taper = (base: number, top: number, flare = 0, flareLen = 0.25) => (t: number) => top + (base - top) * (1 - t) ** 1.4 + flare * Math.exp(-t / flareLen)

/** One broad leaf: a blade that lifts, then arches, widest before the middle and drawn to a drip tip. */
export function broadLeaf(g: Geo, at: V, dir: V, len: number, width: number, droop: number, r: () => number, o: { wind?: number; warm?: number; face?: V; lift?: number } = {}) {
  len *= g.leaf.size
  droop *= g.leaf.droop
  const path = grow(at, dir, len, 6, (t) => [(o.wind ?? 0) * 0.05 * t * t, -droop * (0.02 + 0.26 * t * t) + (o.lift ?? 0) * 0.09 * (1 - t), 0])
  g.ribbon(path, (t) => bladeWidth(width, t), (t) => leafColour(0.12 + 0.88 * t, o.warm ?? 0.3), o.face ?? [0, 1, 0], (t) => (r() - 0.5) * 0.08 + t * 0.42, 'leaf')
}
