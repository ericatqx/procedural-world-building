import type { LearnStep } from '../../shared/ui/learn.tsx'
import { canvasTarget } from '../../shared/ui/learnTargets.ts'
import { GenerationsFigure, ResponseFigure, RewriteFigure, TurtleFigure } from './learnFigures.tsx'
import type { LodLevel, LodMode } from './traceMesh.ts'
import type { TraceOverlays } from './TraceGrowthScene.tsx'
import type { GrowthResponse, TraceSettings } from './turtle.ts'

const SCENE = canvasTarget('.week07')
const READOUT = '.week07 .readout'
const RESPONSE = '.week07 [data-learn="response"]'
const GROWTH = '.week07 [data-learn="growth"]'
const DETAIL = '.week07 [data-learn="detail"]'

/** One grammar control, by its settings key. */
const control = (key: keyof TraceSettings) => `.week07 [data-control="trace-${key}"]`

export type TraceLearnState = {
  settings?: Partial<TraceSettings>
  response?: GrowthResponse
  overlays?: Partial<TraceOverlays>
  lod?: LodMode
  /** The level Manual holds. */
  level?: LodLevel
  /** Restart the growth from the seed. */
  replay?: boolean
}

const SAME = 'Same grammar. Different environmental response.'

/**
 * Week 07 Trace Growth guided sequence: grammar → recursion → turtle →
 * Free → Seek light → Seek shelter (one seed throughout) → growth through
 * time → level of detail. `show` sets up what a step is about.
 */
export function createTraceLearnSteps({
  show,
  defaults,
}: {
  show: (state: TraceLearnState) => void
  /** The page's default settings, restored before the response steps so all three share them. */
  defaults: TraceSettings
}): readonly LearnStep[] {
  return [
    {
      title: 'Grammar: X and F',
      figure: <RewriteFigure />,
      text: 'An L-system is a word and rules for rewriting it. F is an internode, drawn; X is a growing tip, never drawn. Here the only rule at Randomness 0 is X → F/[+X][−X]: every tip becomes an internode and two new tips.',
      try: 'Drag Randomness up from strict.',
      notice: 'Other rules join in: forks, creeping runners, dormant buds, and old internodes elongating (F → FF).',
      target: [control('randomness'), SCENE],
      enter: () => show({ settings: { iterations: 3, randomness: 0 }, response: 'free', replay: true }),
    },
    {
      title: 'Recursion: iterations',
      figure: <GenerationsFigure />,
      text: 'Each iteration rewrites every X again, so tips roughly double each time. The code recurses: expanding X at depth n expands each symbol of its successor at depth n − 1.',
      try: 'Drag Iterations from 1 to 8.',
      notice: 'The segment count in the readout roughly doubles with each step.',
      target: [control('iterations'), READOUT, SCENE],
      enter: () => show({ settings: { iterations: 4, randomness: 0 }, response: 'free' }),
    },
    {
      title: '3D turtle',
      figure: <TurtleFigure />,
      text: 'A turtle reads the word left to right with a position and a frame: heading, left, up. Turns rotate the frame, F steps forward and draws, [ saves the turtle and ] returns it to the fork. The golden-angle roll spirals each fork out of the plane.',
      try: 'Drag Branch angle, then orbit the specimen.',
      notice: 'Narrow angles read as veins and runners, wide ones as coral fans.',
      target: [control('angle'), SCENE],
      enter: () => show({ settings: { iterations: 5, randomness: 0.3 }, response: 'free' }),
    },
    {
      title: 'Response 1 · Free',
      text: 'Now one organism, one seed. Free reads nothing from the environment: only the grammar and its jitter, though the ground and the slab still deflect it.',
      try: 'Note the shape and the % sheltered in the readout. Press 1–3 at any time.',
      notice: 'A shrub around the seed, out in the sun.',
      target: [RESPONSE, READOUT, SCENE],
      enter: () => show({ settings: defaults, response: 'free', overlays: { field: true, bias: false }, replay: true }),
    },
    {
      title: 'Response 2 · Seek light',
      text: `${SAME} Each internode now turns toward the sun, hardest where it is shaded, and lit internodes grow longer.`,
      try: 'Turn Tropism vectors on.',
      notice: 'Segments, branches and tips are unchanged; the form rises and leans east, and almost nothing is sheltered.',
      target: [RESPONSE, READOUT, SCENE],
      enter: () => show({ response: 'light', overlays: { field: true }, replay: true }),
    },
    {
      title: 'Response 3 · Seek shelter',
      figure: <ResponseFigure />,
      text: `${SAME} Exposed tips turn toward the nearest deep shade, then spread over the ground beneath the slab; sheltered internodes grow longer.`,
      try: 'Drag Tropism strength to 0 and back.',
      notice: 'Most of the organism now ends in shelter, and lichen green records where it stayed.',
      target: [RESPONSE, READOUT, SCENE],
      enter: () => show({ response: 'shelter', overlays: { field: true }, replay: true }),
    },
    {
      title: 'Growth through time',
      text: 'The finished organism is revealed along its paths from the seed: the front reaches each point at its path length, narrowing to a tip, marked in red while it grows. Tone keeps the time: old growth weathered, new growth pale.',
      try: 'Pause, then drag the Growth slider back and forth.',
      notice: 'Every branch advances at the same speed, so long runners finish last.',
      target: [GROWTH, SCENE],
      enter: () => show({ overlays: { field: false, bias: false }, replay: true }),
    },
    {
      title: 'Level of detail',
      text: 'Far away, fine twigs cover less than a pixel, yet each still costs triangles to draw. So the one grown organism keeps three representations: 0 Full, every internode; 1 Reduced, the major limbs and selected secondary branches; 2 Skeleton, only the dominant limbs. Each kept limb still runs out along its leader to its tip, so Free, Seek light and Seek shelter keep their silhouettes. Auto picks the level by camera distance.',
      try: 'With Auto on, scroll out slowly, then back in. Click a level to hold it in Manual.',
      notice: 'The readout steps LOD 0 → 1 → 2 as the camera recedes, and triangles drop to a few percent of Full. Zooming back in restores the identical organism: it is never regrown, only drawn differently.',
      target: [DETAIL, READOUT, SCENE],
      enter: () => show({ lod: 'auto' }),
    },
  ]
}
