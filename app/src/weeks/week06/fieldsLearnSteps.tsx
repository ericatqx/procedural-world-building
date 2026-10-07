import type { LearnStep } from '../../shared/ui/learn.tsx'
import { canvasTarget } from '../../shared/ui/learnTargets.ts'
import type { FieldSettings, ParticleKind } from './fields.ts'
import { ParticlesFigure, RippleFigure } from './fieldsLearnFigures.tsx'
import type { FieldOverlays } from './FieldsScene.tsx'

const SCENE = canvasTarget('.week06')
const PARTICLES = '.week06 [data-learn="particles"]'
const STUDY = '.week06 [data-learn="study"]'

/** One field control, by its settings key. */
const control = (key: keyof FieldSettings) => `.week06 [data-control="field-${key}"]`

export type FieldsLearnState = {
  kind?: ParticleKind
  overlays?: Partial<FieldOverlays>
}

/**
 * Week 06 Fields guided sequence: an invisible field → direction and
 * strength → terrain → turbulence → same field, different particles →
 * ripples on the lake → toward weathering. `show` sets up what a step is about.
 */
export function createFieldsLearnSteps({ show }: { show: (state: FieldsLearnState) => void }): readonly LearnStep[] {
  return [
    {
      title: 'A field you cannot see',
      text: 'A vector field gives every point a direction and a speed. Here it is the air over the terrain block. Nothing draws the air itself: particles carried by it make it visible, and the arrows show the field directly.',
      try: 'Watch the streaks, then turn Field arrows on.',
      notice: 'Each streak runs along the arrows around it: the particles only trace the field.',
      target: [STUDY, SCENE],
      enter: () => show({ kind: 'wind', overlays: { particles: true, arrows: false, exposure: false } }),
    },
    {
      title: 'Direction and strength',
      text: 'The prevailing wind is the base of the field: one direction and one speed everywhere, before the ground has any say. Direction is the compass bearing it blows from.',
      try: 'Drag Direction, then Strength.',
      notice: 'The arrows swing together and lengthen; the streaks follow within a second or two.',
      target: [control('direction'), SCENE],
      enter: () => show({ kind: 'wind', overlays: { particles: true, arrows: true } }),
    },
    {
      title: 'The ground steers the wind',
      text: 'Terrain response lets the ground shape the field. Wind meeting rising ground turns along it; it speeds up over the high ground; and wherever higher ground stands upwind, the air near the surface is sheltered and slows. At 0 the wind is the same everywhere.',
      try: 'Drag Terrain response from 0 to 1.',
      notice: 'At 0 the arrows are all alike. Raised, they bend around the massif’s flanks, lengthen over the plateau and the massif, and shorten below the escarpment and behind the massif: the lee.',
      target: [control('terrain'), SCENE],
      enter: () => show({ kind: 'wind', overlays: { particles: true, arrows: true } }),
    },
    {
      title: 'Turbulence: eddies carried downwind',
      text: 'Turbulence adds eddies: the curl of a noise stream function, so the air swirls without piling up anywhere. The eddies drift downwind with the wind as they slowly change, and are stronger in the lee.',
      try: 'Drag Turbulence from 0 up.',
      notice: 'At 0 the arrows are steady; raised, a pattern of swirls travels across the block.',
      target: [control('turbulence'), SCENE],
      enter: () => show({ kind: 'wind', overlays: { particles: true, arrows: true } }),
    },
    {
      title: 'Same field, different particles',
      figure: <ParticlesFigure />,
      text: 'Every particle relaxes toward the air it sits in, scaled by its influence, plus its own fall; its response, drag over mass, sets how quickly. Change those three numbers and the same field reads as different weather.',
      try: 'Press 1 to 4: Wind, Rain, Snow, Mist.',
      notice: 'Rain slants and lands; snow drifts with the eddies and lies a moment; mist hugs the ground and drains into the hollows and over the lake.',
      target: [PARTICLES, SCENE],
      enter: () => show({ overlays: { particles: true, arrows: false } }),
    },
    {
      title: 'Ripples on the lake',
      figure: <RippleFigure />,
      text: 'Where rain meets the lake, a drop now and then rings the surface: two thin rings that spread and fade. A click on the lake starts a larger ripple of three. The ripples belong to the water, drawn on its surface; they do not move the air.',
      try: 'Watch the lake in Rain, then click the water.',
      notice: 'The rings stay on the water and stop at the shore; clicking land does nothing.',
      target: SCENE,
      enter: () => show({ kind: 'rain', overlays: { particles: true, arrows: false } }),
    },
    {
      title: 'Toward weathering',
      text: 'Exposure reads the same field at the ground: high, open to the wind, or facing into it. In Shadow Ecology this is the missing weather term: weather field → exposure and shelter → accumulated weathering → decay. Decay is not modelled here.',
      try: 'Turn Exposure on, then drag Direction.',
      notice: 'The worn-looking faces move with the wind; the lee stays clear.',
      target: [STUDY, control('direction'), SCENE],
      enter: () => show({ overlays: { exposure: true, arrows: false } }),
    },
  ]
}
