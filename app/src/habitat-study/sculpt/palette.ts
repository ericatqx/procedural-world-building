import { Color } from 'three'

/**
 * Style A — The Ochre Benches: the palette. Every surface has one base colour; the ramp shader (ramp.ts) derives its turned and shadow tones, so
 * shadow is a hue of its own (violet, swinging with the sky) rather than a darker copy of the lit colour.
 */
export const PAL = {
  sand: '#efd9b0',
  meadow: '#dccd98',
  shadeGround: '#8fb3a0',
  deepShade: '#6f9e8f',
  shore: '#f6ebd2',
  rock: '#e59a6e',
  rockAlt: '#d98764',
  rockBand: '#c2664a',
  rockTop: '#efcfa4',
  plinthTop: '#ead6b8',
  chalk: '#f6f1e8',
  stone: '#e6d2b8',
  stoneAlt: '#dcc4a6',
  hollow: '#b8573e',
  youngTissue: '#dfe6d4',
  water: '#9ed8cc',
  waterEdge: '#7fc4b8',
  coral: '#e8604c',
  coralPale: '#f4d3bd',
  outlineArch: '#5e4673',
  outlineRock: '#8a4a58',
  // plants
  woodland: '#4e7f6f',
  woodlandAlt: '#5f8f78',
  shrub: '#86a06a',
  broadleaf: '#6f9a6a',
  tabular: '#4f8577',
  canes: '#97ab6e',
  fernShade: '#4f8e83',
  fernSun: '#93b07e',
  mat: '#7db39e',
  grass: '#cdbb84',
  sedge: '#bdb47e',
  reed: '#9fb07a',
} as const

/** The day's light, keyed by hour: the colour shadow swings to, how far, the light's tint, and the sky (top, horizon). */
type Key = { h: number; shadow: string; mix: number; light: string; top: string; horizon: string }
const KEYS: Key[] = [
  { h: 5.5, shadow: '#5f8d93', mix: 0.55, light: '#e9d6c0', top: '#7f98b8', horizon: '#e9c6b0' },
  { h: 7.5, shadow: '#6f9c9a', mix: 0.5, light: '#ffe7b8', top: '#a9c6d6', horizon: '#f7d9b5' },
  { h: 10.5, shadow: '#7c83b0', mix: 0.42, light: '#fff4dd', top: '#9ec0de', horizon: '#f1e6d2' },
  { h: 13, shadow: '#8178a8', mix: 0.4, light: '#ffffff', top: '#93b6da', horizon: '#ece6da' },
  { h: 16.5, shadow: '#7a6a9c', mix: 0.48, light: '#ffe9cf', top: '#b9a9d6', horizon: '#f6c9a3' },
  { h: 19, shadow: '#6a5b92', mix: 0.55, light: '#ffc9a0', top: '#8e7fb8', horizon: '#f2a98a' },
  { h: 21, shadow: '#4e4880', mix: 0.65, light: '#c9b6e0', top: '#3f3d6b', horizon: '#8f7aa8' },
]

const a = new Color()
const b = new Color()
export function lightAt(hour: number) {
  let i = 0
  while (i < KEYS.length - 2 && hour > KEYS[i + 1]!.h) i += 1
  const k0 = KEYS[i]!
  const k1 = KEYS[i + 1]!
  const t = Math.min(1, Math.max(0, (hour - k0.h) / (k1.h - k0.h)))
  const mixC = (x: string, y: string) => a.set(x).lerp(b.set(y), t).clone()
  return { shadow: mixC(k0.shadow, k1.shadow), mix: k0.mix + (k1.mix - k0.mix) * t, light: mixC(k0.light, k1.light), top: mixC(k0.top, k1.top), horizon: mixC(k0.horizon, k1.horizon) }
}
