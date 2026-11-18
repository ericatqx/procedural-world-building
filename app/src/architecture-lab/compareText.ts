/**
 * The comparison text for specimens of the grown families: every number is a measure the generator itself reported for that specimen
 * (see `measure` in organismGrowth.ts), and every sentence is made from the difference between two of them.
 */
export type Measure = Record<string, number>

export type Row = { key: string; label: string; show: (m: Measure) => string }

const n = (v: number) => `${Math.round(v)}`
export const ROWS: Row[] = [
  { key: 'height', label: 'Height', show: (m) => `${n(m.height!)} m` },
  { key: 'length', label: 'Footprint, long axis', show: (m) => `${n(m.length!)} m` },
  { key: 'width', label: 'Footprint, short axis', show: (m) => `${n(m.width!)} m` },
  { key: 'chamber', label: 'Growth that is vertical', show: (m) => `${n(m.chamber!)}%` },
  { key: 'roof', label: 'Longest reach', show: (m) => `${n(m.roof!)} m` },
  { key: 'massifs', label: 'Shoots', show: (m) => n(m.massifs!) },
  { key: 'windows', label: 'Fusions (loops)', show: (m) => n(m.windows!) },
  { key: 'openings', label: 'Loops and roots', show: (m) => n(m.openings!) },
  { key: 'pits', label: 'Piers', show: (m) => n(m.pits!) },
  { key: 'openingArea', label: 'Wear porosity (mature)', show: (m) => `${n(m.openingArea!)}%` },
]

/** The short set shown for a contact sheet. */
export const SHEET_ROWS = ['height', 'length', 'chamber', 'roof', 'windows', 'pits', 'openingArea']

/** Plain sentences for the largest differences, from the two measures. */
export function explain(a: Measure, b: Measure, nameA: string, nameB: string): string[] {
  const out: { score: number; text: string }[] = []
  const rel = (key: string, noun: string, bigger: string, smaller: string, unit: string, minRel = 0.12) => {
    const x = a[key]!
    const y = b[key]!
    if (Math.max(x, y) <= 0) return
    const r = (y - x) / Math.max(x, y, 1e-6)
    if (Math.abs(r) < minRel) return
    out.push({ score: Math.abs(r), text: `${nameB}’s ${noun} is ${Math.round(Math.abs(r) * 100)}% ${r > 0 ? bigger : smaller} than ${nameA}’s (${Math.round(y)}${unit} against ${Math.round(x)}${unit}).` })
  }
  rel('height', 'height', 'higher', 'lower', ' m')
  rel('length', 'long footprint axis', 'longer', 'shorter', ' m')
  rel('width', 'short footprint axis', 'wider', 'narrower', ' m')
  rel('roof', 'longest reach', 'longer', 'shorter', ' m', 0.2)
  rel('openingArea', 'wear porosity', 'higher', 'lower', '%', 0.2)
  const dv = b.chamber! - a.chamber!
  if (Math.abs(dv) >= 8) out.push({ score: Math.abs(dv) / 60, text: `${nameB} grows ${Math.abs(Math.round(dv))} points ${dv > 0 ? 'more' : 'less'} vertically than ${nameA} (${Math.round(b.chamber!)}% against ${Math.round(a.chamber!)}%): ${dv > 0 ? 'more of it rises' : 'more of it reaches sideways'}.` })
  if (a.windows !== b.windows) out.push({ score: 0.4, text: `${nameB} has ${b.windows! > a.windows! ? 'more' : 'fewer'} fusions (${b.windows} against ${a.windows}): ${b.windows! > a.windows! ? 'more loops enclosing space' : 'fewer enclosed loops'}.` })
  if (a.pits !== b.pits) out.push({ score: 0.3, text: `${nameB} has ${b.pits! > a.pits! ? 'more' : 'fewer'} piers under its reaches (${b.pits} against ${a.pits}).` })
  if (Math.abs(a.massifs! - b.massifs!) >= 2) out.push({ score: 0.3, text: `${nameB} has ${b.massifs} shoots against ${a.massifs}.` })
  out.sort((p, q) => q.score - p.score)
  return out.slice(0, 5).map((o) => o.text)
}
