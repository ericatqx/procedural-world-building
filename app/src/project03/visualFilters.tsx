import { Segmented } from '../shared/ui/instrument.tsx'
import { setVisualPreset, useVisualPreset, type VisualPreset } from './visualStyle.ts'
import { setStudyPalette } from './visualStudy.ts'
import { setStudy02, STUDY02_NOTE, useStudy02, type Study02 } from './visualStudy02.ts'

/**
 * Shadow Ecology 0.3 — VISUAL FILTERS: the main visual (Graphic Diorama — Black Stage, the look the world opens in) and every other rendering style
 * kept as an alternative. The styles come from three families of code (Visual Study 02 and 03 in visualStudy02.ts and visualStudy03.ts, the earlier
 * presets in visualStyle.ts); here they are one list, and choosing one returns the others to rest, as before. Nothing about the world changes.
 */
export const MAIN_VISUAL: Study02 = 'dioramaBlack'

type FilterKey = `study:${Study02}` | `preset:${VisualPreset}`

const ALTERNATIVES: { value: FilterKey; label: string }[] = [
  { value: 'study:ink', label: 'Clear Ink' },
  { value: 'study:inkRefined', label: 'Clear Ink Refined' },
  { value: 'study:atlas', label: 'Illustrated Atlas' },
  { value: 'study:painting', label: 'Atmospheric Painting' },
  { value: 'study:stylized', label: 'Illustrated World — Stylized' },
  { value: 'study:diorama', label: 'Graphic Diorama — Dark Table' },
  { value: 'study:mono', label: 'Living Monochrome' },
  { value: 'preset:contrast', label: 'Graphic Contrast' },
  { value: 'preset:glow', label: 'Shadow Glow' },
  { value: 'preset:hybrid', label: 'Contrast + Glow' },
  { value: 'preset:sculpt', label: 'Sculptural Illustration' },
  { value: 'preset:ink', label: 'Monochrome Ink' },
  { value: 'study:original', label: 'Original (unstyled)' },
]

const PRESET_NOTE: Record<VisualPreset, string> = {
  original: STUDY02_NOTE.original,
  contrast: 'Graphic Contrast: deeper woodland greens, a brighter, warmer meadow, warmer mineral rock and richer plants.',
  glow: 'Shadow Glow: ferns, ground mats and hanging curtains carry a soft teal light, strongest in shadow; shaded ground is cooled.',
  hybrid: 'Contrast + Glow: Graphic Contrast with Shadow Glow.',
  sculpt: 'Sculptural Illustration (experimental): quieter ground in large clean regions, soft bands of light, a restrained palette, the architecture lifted clear.',
  ink: 'Monochrome Ink (experimental): greyscale and deep air; shade drawn in ink strokes that follow the slopes, contours on the large forms.',
}

/** Chooses a style: the studies and the presets do not stack, so choosing one returns the others to rest (presets first, so a study's air is set last). */
export function chooseVisual(key: FilterKey) {
  if (key.startsWith('preset:')) {
    const preset = key.slice(7) as VisualPreset
    setStudyPalette('original')
    setStudy02('original')
    setVisualPreset(preset)
    return
  }
  const study = key.slice(6) as Study02
  setVisualPreset('original')
  setStudyPalette('original')
  setStudy02(study)
}

export function VisualFilters() {
  const study = useStudy02()
  const preset = useVisualPreset()
  const current: FilterKey = preset !== 'original' ? `preset:${preset}` : `study:${study}`
  const isMain = current === `study:${MAIN_VISUAL}`
  return (
    <>
      <div className="eco-detail">
        <span className="eco-detail-head">Main visual</span>
        <div className="eco-visual-main">
          <Segmented label="Main visual" options={[{ value: `study:${MAIN_VISUAL}` as FilterKey, label: 'Graphic Diorama — Black Stage' }]} value={current} onChange={chooseVisual} />
        </div>
      </div>
      <div className="eco-detail">
        <span className="eco-detail-head">Alternative filters</span>
        <div className="eco-visuals eco-studies">
          <Segmented label="Alternative filters" options={ALTERNATIVES} value={current} onChange={chooseVisual} />
        </div>
      </div>
      <p className="eco-note">{preset !== 'original' ? PRESET_NOTE[preset] : STUDY02_NOTE[study]}</p>
      {!isMain ? (
        <button type="button" className="text-button" onClick={() => chooseVisual(`study:${MAIN_VISUAL}`)}>
          Back to the main visual
        </button>
      ) : null}
    </>
  )
}
