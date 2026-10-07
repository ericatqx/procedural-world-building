import type { LearnStep } from '../../shared/ui/learn.tsx'
import { canvasTarget } from '../../shared/ui/learnTargets.ts'
import type { DistributionView } from './DistributionScene.tsx'
import type { FieldId, LayerId, LayerSettings, Method } from './distribution.ts'
import { PipelineFigure, RandomNoiseFigure, SuitabilityFigure } from './learnFigures.tsx'

const SCENE = canvasTarget('.week06')
const METHOD = '.week06 [data-learn="method"]'
const VIEW = '.week06 [data-learn="view"]'
const FIELD = '.week06 [data-learn="field"]'
const LAYER_ROWS = '.week06 .row-list'

/** One layer control, by its settings key. */
const control = (layer: LayerId, key: keyof LayerSettings) => `.week06 [data-control="${layer}-${key}"]`

export type DistributionLearnState = {
  method?: Method
  view?: DistributionView
  field?: FieldId
  /** Expands this layer's row and analyses it. */
  layer?: LayerId
}

/**
 * Week 06 Distribution guided sequence: scattering → one pipeline → seeds →
 * random → noise → fields → suitability → soft preferences → layers. `show`
 * sets up what a step is about. The control to act on comes first in
 * `target`, since the tour scrolls the panel to it.
 */
export function createDistributionLearnSteps({
  show,
}: {
  show: (state: DistributionLearnState) => void
}): readonly LearnStep[] {
  return [
    {
      title: 'Scattering',
      text: 'Scattering places many things by a rule instead of by hand. Three layers are scattered over the Shadow Ecology island: structures, vegetation and colonies.',
      try: 'Press 1, 2 and 3 to switch method.',
      notice: 'Same island, same counts: only the rule for where things go changes.',
      target: [METHOD, SCENE],
      enter: () => show({ method: 'environment', view: 'world' }),
    },
    {
      title: 'One pipeline',
      figure: <PipelineFigure />,
      text: 'Every layer runs the same steps: draw candidate points, give each a weight from 0 to 1, accept it when a random draw falls below its weight, and skip it if it stands too close to an accepted point.',
      notice: 'In Analysis, rings are candidates sized by their weight; the filled marks were accepted.',
      target: [VIEW, SCENE],
      enter: () => show({ view: 'analysis', field: 'weight', layer: 'vegetation' }),
    },
    {
      title: 'Seeds: chance you can repeat',
      text: 'Every random number comes from a seeded generator. The same seed and settings always give exactly the same points; a new seed gives a new, equally valid draw.',
      try: 'Change the Structures seed, then set it back.',
      notice: 'The original layout returns exactly.',
      target: [control('structures', 'seed'), SCENE],
      enter: () => show({ view: 'world', layer: 'structures' }),
    },
    {
      title: 'Random',
      figure: <RandomNoiseFigure />,
      text: 'Random gives every candidate weight 1, so every place on the island is equally likely.',
      try: 'Raise the Vegetation count.',
      notice: 'With no rule at all, points still clump and leave gaps by chance.',
      target: [control('vegetation', 'count'), SCENE],
      enter: () => show({ method: 'random', view: 'world', layer: 'vegetation' }),
    },
    {
      title: 'Noise: coherent clusters',
      text: 'Coherent noise changes smoothly, so neighbouring candidates get similar weights and points gather in patches. Cluster size sets how large the patches are; coverage, how much of the island they take.',
      try: 'Drag Cluster size.',
      notice: 'The patches grow and shrink; a new seed moves them.',
      target: [control('vegetation', 'clusterSize'), SCENE],
      enter: () => show({ method: 'noise', view: 'world', layer: 'vegetation' }),
    },
    {
      title: 'Environmental fields',
      text: 'Environment reads the world itself. Elevation, slope, moisture, nearness to water and daily light are fields: a value at every point of the island, read from the Shadow Ecology terrain.',
      try: 'Step through the Field options.',
      notice: 'Light is daily sunlight. For vegetation and colonies it already includes the structures’ shade.',
      target: [FIELD, SCENE],
      enter: () => show({ method: 'environment', view: 'analysis', field: 'light', layer: 'colonies' }),
    },
    {
      title: 'Suitability',
      figure: <SuitabilityFigure />,
      text: 'A layer’s preferences turn each field into a factor, and the factors multiply into one weight: its suitability, scaled so the island’s best ground is 1.',
      try: 'Drag the Colonies Light preference from shade toward sun.',
      notice: 'The weight field turns over, and the accepted points follow it.',
      target: [control('colonies', 'light'), FIELD, SCENE],
      enter: () => show({ method: 'environment', view: 'analysis', field: 'weight', layer: 'colonies' }),
    },
    {
      title: 'Preferences, not exclusions',
      text: 'A preference only scales the weight: even at full strength, ground at the wrong end keeps a tenth of it. Valid ground is a separate, hard rule: water is not valid unless a layer allows it.',
      try: 'Push the Vegetation Waterside preference toward shore.',
      notice: 'Plants gather along the shores, yet some stay inland, and none stand in the water itself.',
      target: [control('vegetation', 'waterside'), SCENE],
      enter: () => show({ method: 'environment', view: 'world', layer: 'vegetation' }),
    },
    {
      title: 'Layers read each other',
      text: 'Layers are placed in order. Structures go first; vegetation and colonies cannot stand in their footprints, and they read the light after the structures’ shade.',
      try: 'Untick Structures, then tick it back on.',
      notice: 'Without the shade, the colonies spread out into the open.',
      target: [LAYER_ROWS, SCENE],
      enter: () => show({ method: 'environment', view: 'world' }),
    },
  ]
}
