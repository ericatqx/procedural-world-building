import type { LearnStep } from '../../shared/ui/learn.tsx'
import { canvasTarget } from '../../shared/ui/learnTargets.ts'

const SCENE = canvasTarget('.week08')
const READOUT = '.week08 .readout'
const OBJECT = '.week08 [data-control="scale-object"]'
const CAMERA = '.week08 [data-learn="camera"]'
const FOV = '.week08 [data-learn="fov"]'
const DEPTH = '.week08 [data-learn="depth"]'
const RESOLUTION = '.week08 [data-learn="resolution"]'
const LADDER = '.week08 [data-learn="ladder"]'
const MESH = '.week08 [data-learn="mesh"]'

/** What a step sets up. Anything left out stays as it is. */
export type ScaleLearnState = {
  object?: string
  form?: 'smooth' | 'voxels' | 'mesh'
  mesh?: 'low' | 'medium' | 'high'
  /** Cell size, metres. */
  cell?: number
  fov?: number
  dolly?: boolean
  poles?: boolean
  reference?: boolean
  dimensions?: boolean
  /** Camera distance, metres, and elevation, degrees. */
  distance?: number
  elevation?: number
}

/**
 * Week 08 Scale guided sequence: working scale → proportions → distance → field of view → dolly zoom → sampling
 * resolution → mesh and screen resolution → what it means for 0.3. `show` sets up what a step is about.
 */
export function createScaleLearnSteps({ show }: { show: (state: ScaleLearnState) => void }): readonly LearnStep[] {
  return [
    {
      title: 'One working scale',
      text: 'Everything here is in metres: 1 unit is 1 m. The grid has 1 m cells and 10 m lines, and the blue person is the project’s walker, eye at 1.75 m. Reading size starts from something you know.',
      try: 'Press 1–5 to change the object.',
      notice: 'The dimension lines say how big each one is in metres, not in screen units.',
      target: [OBJECT, SCENE],
      enter: () => show({ object: 'la01', form: 'smooth', fov: 42, dolly: false, poles: false, reference: true, dimensions: true, distance: 95, elevation: 10 }),
    },
    {
      title: 'Proportions',
      text: 'A creature’s wing is 3 cm thin and its span 3.3 m; a spire plant is 9 m; LA-01 is 38 m. Four orders of magnitude fit on one ruler, but no single camera shows them all.',
      try: 'Select the creature, then the spire, then LA-01.',
      notice: 'The ruler marks each size; sizes of creatures and plants are provisional.',
      target: [LADDER, OBJECT, SCENE],
      enter: () => show({ object: 'creature', fov: 42, dolly: false, poles: false, reference: true, dimensions: true, distance: 9, elevation: 12 }),
    },
    {
      title: 'Distance',
      text: 'Twice as far, half as big on screen. Distance changes how big a thing looks, never how big it is. These are the project’s three cameras: a walker, an approach, the whole island.',
      try: 'Press Explore, Approach, then Overview, or drag the distance.',
      notice: 'The readout: pixels and per cent of the view fall as the camera backs away.',
      target: [CAMERA, READOUT, SCENE],
      enter: () => show({ object: 'la01', fov: 42, dolly: false, poles: false, reference: true, distance: 95, elevation: 10 }),
    },
    {
      title: 'Field of view',
      text: 'The lens is a zoom. Narrow it and the subject fills more of the view and depth flattens; widen it and the subject shrinks and depth stretches. The camera has not moved and the object has not changed.',
      try: 'Drag Field of view, or press Telephoto then Wide.',
      notice: 'The subject’s share of the view changes. The two poles are fixed in the world.',
      target: [FOV, READOUT, SCENE],
      enter: () => show({ object: 'la01', fov: 42, dolly: false, poles: true, reference: true, distance: 95, elevation: 10 }),
    },
    {
      title: 'Dolly zoom',
      text: 'Now walk while you zoom: back away as the lens narrows, or step in as it widens, at exactly the rate that holds the subject’s size. The subject stays put. The sage pole in front and the clay one behind do not.',
      try: 'Turn Dolly zoom on, press Sweep, then turn it off and press Sweep again.',
      notice: 'On: the subject bar stays still while the poles trade places. Off: the subject itself swells and shrinks.',
      target: [DEPTH, FOV, SCENE],
      enter: () => show({ object: 'la01', fov: 42, dolly: true, poles: true, reference: true, distance: 95, elevation: 10 }),
    },
    {
      title: 'Sampling resolution',
      text: 'Cells is how finely a grid samples the object, and Smooth is only a geometric reference. A cell is kept if its centre is inside, so anything thinner than a cell vanishes: at 0.25 m the creature’s 3 cm wings are gone.',
      try: 'Drag Cell size down until the wings return.',
      notice: 'They come back only when a cell is about as thin as they are.',
      target: [RESOLUTION, SCENE],
      enter: () => show({ object: 'creature', form: 'voxels', cell: 0.25, fov: 42, dolly: false, poles: false, reference: true, distance: 7, elevation: 14 }),
    },
    {
      title: 'Mesh and screen resolution',
      text: 'Mesh is a different resolution: triangles describing a curve. Low shows facets up close. But what you see is set by pixels, so as the camera backs away the edge error shrinks and the cheap mesh becomes as good as the dense one.',
      try: 'Press Low, High, then drag Distance far out.',
      notice: 'Past a certain distance the edge is under a pixel off at every level.',
      target: [MESH, CAMERA, SCENE],
      enter: () => show({ object: 'la01', form: 'mesh', mesh: 'low', fov: 46, dolly: false, poles: false, reference: true, distance: 70, elevation: 12 }),
    },
    {
      title: 'What it means for 0.3',
      points: [
        'Proportional scale: work in metres. The person, LA-01 (38 m) and the island (4.1 km) are computed from the project’s constants; creature and plant sizes are still assumptions.',
        'Readability depends on the camera: at 46° a 1.5 m cell is blocks at Explore, grain at Approach and invisible at Overview. Choose detail by the view that sees it.',
        'Right geometry for each: Architecture can be coarse from afar, Vegetation spires read as landmarks and shade shrubs only up close, and Creatures need meshes, not cells, for 3 cm wings.',
      ],
      notice: 'Computed here: the pixel and distance maths. Provisional: every creature, plant and LA-01 size.',
      target: [SCENE],
      enter: () => show({ object: 'la01', form: 'smooth', fov: 46, dolly: false, poles: false, reference: true, distance: 95, elevation: 10 }),
    },
  ]
}
