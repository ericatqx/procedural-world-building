import { Color } from 'three'

/**
 * Shadow Ecology 0.3 — the time of day as colour, for the World Visual Studies that draw their own sky (StudySky.tsx) and light (Illustrated World — Stylized,
 * Atmospheric Painting). Each study has a few keyframes over the day (sRGB hex, mixed in linear light), eased between, so morning, midday, sunset and night
 * each have a mood of their own and the hours between move smoothly from one to the next.
 *
 *   zenith, horizon   the sky above, top and bottom
 *   below             the void under the horizon, around and beneath the island (it is seen from Overview more than the sky is)
 *   cloud             a soft layer of air under the island: its lit tone (unused by the simplified skies; kept for later)
 *   key, shade        the light the land takes from the sun (or moon) and what its shade is filled with (Painting)
 *   haze              distance: what far land and the air turn toward
 *   night             0 by day, 1 in full night
 */
type Frame = { h: number; zenith: string; horizon: string; below: string; cloud: string; ink: string; key: string; shade: string; haze: string; night: number }
export type SkyColours = { zenith: Color; horizon: Color; below: Color; cloud: Color; ink: Color; key: Color; shade: Color; haze: Color; night: number }

// Illustrated World — Stylized: a pale teal and ivory sky over a dusty-jade void by day (the ochre and wine island's complement), coral and violet at
// sunset, a cool navy night with a pale moon light. `key` and `shade` light its island: the shade is violet by day, slate-blue by night.
const STYL: Frame[] = [
  { h: 0, zenith: '#060B16', horizon: '#15233A', below: '#0A1220', cloud: '#1E2C44', ink: '#000000', key: '#7F95BC', shade: '#2F3E5E', haze: '#0E1828', night: 1 },
  { h: 5.0, zenith: '#131B33', horizon: '#454868', below: '#171D31', cloud: '#3E4260', ink: '#000000', key: '#8E92B6', shade: '#2A3048', haze: '#262B44', night: 0.7 },
  { h: 6.4, zenith: '#A3B9CC', horizon: '#F5D7BA', below: '#A2A2BC', cloud: '#F3DCC8', ink: '#000000', key: '#FFE5C6', shade: '#7D77A8', haze: '#ADA6BC', night: 0 },
  { h: 8.6, zenith: '#B6CDD0', horizon: '#F6E5CC', below: '#9CB4B2', cloud: '#F4EADC', ink: '#000000', key: '#FFF0DA', shade: '#7F7BA6', haze: '#A6B8B4', night: 0 },
  { h: 12, zenith: '#C3D7D3', horizon: '#F6EAD5', below: '#96B4B0', cloud: '#F6EEE2', ink: '#000000', key: '#FFF6E8', shade: '#817EA8', haze: '#A3BAB6', night: 0 },
  { h: 15.4, zenith: '#BCCFCB', horizon: '#F5E2C4', below: '#9CAFAA', cloud: '#F4E4D2', ink: '#000000', key: '#FFEDD2', shade: '#7E78A4', haze: '#A9B4AE', night: 0 },
  { h: 17.6, zenith: '#3E376A', horizon: '#F0A070', below: '#5E4878', cloud: '#E89A80', ink: '#000000', key: '#FFBE8C', shade: '#5E4A8C', haze: '#7E5E86', night: 0.08 },
  { h: 18.7, zenith: '#141A36', horizon: '#4A3A5E', below: '#181A30', cloud: '#3E3456', ink: '#000000', key: '#7A76A2', shade: '#252A44', haze: '#22223A', night: 0.75 },
  { h: 19.8, zenith: '#060B16', horizon: '#15233A', below: '#0A1220', cloud: '#1E2C44', ink: '#000000', key: '#7F95BC', shade: '#2F3E5E', haze: '#0E1828', night: 1 },
]

const PAINT: Frame[] = [
  { h: 0, zenith: '#03050C', horizon: '#121A33', below: '#04060D', cloud: '#1A2444', ink: '#000000', key: '#3C4E86', shade: '#070B1A', haze: '#0E1630', night: 1 },
  { h: 5.0, zenith: '#121A3C', horizon: '#6A5486', below: '#100E22', cloud: '#5E4E80', ink: '#000000', key: '#8A72A8', shade: '#221C44', haze: '#4A3E6C', night: 0.7 },
  { h: 6.4, zenith: '#4F76B4', horizon: '#FFC390', below: '#4A4A78', cloud: '#FFD3AE', ink: '#000000', key: '#FFD2A0', shade: '#5E6CB0', haze: '#F0B993', night: 0 },
  { h: 8.6, zenith: '#3F7FCF', horizon: '#CFE4F2', below: '#5A7CB0', cloud: '#F4F7FA', ink: '#000000', key: '#FFF1DA', shade: '#5F7AB8', haze: '#B9D5EC', night: 0 },
  { h: 12, zenith: '#2F78D4', horizon: '#BFDDF2', below: '#4F78B4', cloud: '#FAFCFE', ink: '#000000', key: '#FFF8EA', shade: '#5C77B2', haze: '#AFD0EE', night: 0 },
  { h: 15.4, zenith: '#3C70C4', horizon: '#F5DCB4', below: '#5E6898', cloud: '#FBEAD2', ink: '#000000', key: '#FFE4BC', shade: '#626EAE', haze: '#EBD3B2', night: 0 },
  { h: 17.6, zenith: '#283A7C', horizon: '#FF9258', below: '#5A3A6A', cloud: '#FFB07C', ink: '#000000', key: '#FFA060', shade: '#5E4690', haze: '#EE8C66', night: 0.08 },
  { h: 18.7, zenith: '#0C1236', horizon: '#73406A', below: '#140E26', cloud: '#4E3058', ink: '#000000', key: '#7A5480', shade: '#1C1438', haze: '#40284E', night: 0.75 },
  { h: 19.8, zenith: '#03050C', horizon: '#121A33', below: '#04060D', cloud: '#1A2444', ink: '#000000', key: '#3C4E86', shade: '#070B1A', haze: '#0E1630', night: 1 },
]

const make = (frames: Frame[]) => frames.map((f) => ({ h: f.h, night: f.night, c: { zenith: new Color(f.zenith), horizon: new Color(f.horizon), below: new Color(f.below), cloud: new Color(f.cloud), ink: new Color(f.ink), key: new Color(f.key), shade: new Color(f.shade), haze: new Color(f.haze) } }))
const KEYS = { stylized: make(STYL), paint: make(PAINT) }
const blank = (): SkyColours => ({ zenith: new Color(), horizon: new Color(), below: new Color(), cloud: new Color(), ink: new Color(), key: new Color(), shade: new Color(), haze: new Color(), night: 0 })

/** The current colours of each study, written by skyAt (called once a frame by Sky.tsx). */
export const studySky = { stylized: blank(), paint: blank() }

const ease = (t: number) => t * t * (3 - 2 * t)

/** Sets a study's colours for an hour (0–24). */
export function skyAt(study: 'stylized' | 'paint', hour: number): SkyColours {
  const frames = KEYS[study]
  const h = ((hour % 24) + 24) % 24
  let i = 0
  while (i < frames.length - 2 && h > frames[i + 1]!.h) i += 1
  const last = frames[frames.length - 1]!
  const a = h >= last.h ? last : frames[i]!
  const b = h >= last.h ? last : frames[i + 1]!
  const t = a === b ? 0 : ease(Math.min(1, Math.max(0, (h - a.h) / Math.max(1e-3, b.h - a.h))))
  const out = studySky[study]
  for (const k of ['zenith', 'horizon', 'below', 'cloud', 'ink', 'key', 'shade', 'haze'] as const) out[k].copy(a.c[k]).lerp(b.c[k], t)
  out.night = a.night + (b.night - a.night) * t
  return out
}
