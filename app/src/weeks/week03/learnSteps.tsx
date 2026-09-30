import type { LearnStep } from '../../shared/ui/learn.tsx'
import { canvasTarget } from '../../shared/ui/learnTargets.ts'
import { ErosionFigure, HeightmapFigure, LayersFigure } from './learnFigures.tsx'

type View = 'terrain' | 'simulation'

const SCENE = canvasTarget('.week03')
const FIELD_MAP = '.week03 .field-map'
const WORLD_READOUT = '.week03 .region-left .readout, .week03 .field-map'
const RESOLUTION = '.week03 [data-learn="resolution"]'
const COLOR_MODE = '.week03 [data-learn="color-mode"]'
const VIEW_TOGGLES = '.week03 .view-strip-row'
const SIMULATION_BUTTONS = '.week03 .button-row'
/** Each layer's header row, lit separately so an expanded layer doesn't join them. */
const LAYER_HEADS = [1, 2, 3, 4].map((n) => `.week03 .row-list > :nth-child(${n}) .row-head`)

/**
 * Week 03 guided sequence: noise → layered field → heightmap → how it is
 * drawn → erosion. `showView` switches between the Terrain and Simulation
 * views. The control to act on comes first in `target`, since the tour
 * scrolls the panel to it.
 */
export function createTerrainLearnSteps({ showView }: { showView: (view: View) => void }): readonly LearnStep[] {
  return [
    {
      title: 'Noise: a smooth random field',
      text: 'A noise function returns a pseudo-random value for any (x, z). Nearby points get similar values, so it reads as landform rather than static.',
      try: 'Press W A S D to travel across the field.',
      notice: 'The map never runs out: terrain is computed from coordinates, not stored.',
      target: [WORLD_READOUT, SCENE],
      enter: () => showView('terrain'),
    },
    {
      title: 'Layers: broad to fine',
      figure: <LayersFigure />,
      text: 'Four noise layers, each with its own frequency and amplitude, are blended by weight into one field. Shaping bends a layer: Ridged folds it into crests.',
      try: 'Untick the layers one at a time.',
      notice: 'Layer 2 (weight 1) sets the landforms; Layer 4 only adds grain.',
      target: [...LAYER_HEADS, SCENE],
      enter: () => showView('terrain'),
    },
    {
      title: 'Heightmap: one number per cell',
      figure: <HeightmapFigure />,
      text: 'The blended field is sampled on a square grid, one height per cell. That single array paints the 2D map and lifts every vertex of the 3D mesh.',
      try: 'Drag Grid resolution down to 16, then press F.',
      notice: 'Map pixels and mesh facets coarsen together: one dataset, two views.',
      target: [RESOLUTION, FIELD_MAP, SCENE],
      enter: () => showView('terrain'),
    },
    {
      title: 'Representation: reading the heights',
      text: 'How heights are drawn is a separate choice from the heights. Elevation maps height to colour; contours draw lines of equal height.',
      try: 'Set Color mode to Elevation, then press C to toggle Contours.',
      notice: 'The terrain data is unchanged; only how you read it.',
      target: [COLOR_MODE, VIEW_TOGGLES, SCENE],
      enter: () => showView('terrain'),
    },
    {
      title: 'Erosion: a process on the grid',
      figure: <ErosionFigure />,
      text: 'Simulation turns the heightmap into a process. Each step, rain falls on every cell, water flows to lower neighbours, and fast water carries sediment down to where it slows.',
      try: 'Press Start.',
      notice: 'Cyan gathers into streams and pools while the heights themselves change.',
      target: [SIMULATION_BUTTONS, SCENE],
      enter: () => showView('simulation'),
    },
    {
      title: 'The fields behind the picture',
      text: 'The simulation is three grids over the same cells: height, water and sediment, each updated every step.',
      try: 'Switch the Data view between Height, Water and Sediment.',
      notice: 'Water collects in valleys; sediment builds where streams slow down.',
      target: [FIELD_MAP, SCENE],
      enter: () => showView('simulation'),
    },
  ]
}
