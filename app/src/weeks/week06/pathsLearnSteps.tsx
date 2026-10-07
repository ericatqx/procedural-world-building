import type { LearnStep } from '../../shared/ui/learn.tsx'
import { canvasTarget } from '../../shared/ui/learnTargets.ts'
import type { PathMethod, PathSettingsMap } from './paths.ts'
import { ProjectionFigure, SpannerFigure } from './pathsLearnFigures.tsx'
import type { PathOverlays } from './PathsScene.tsx'

const SCENE = canvasTarget('.week06')
const METHOD = '.week06 [data-learn="method"]'
const GENERATION = '.week06 [data-learn="generation"]'
const STUDY = '.week06 [data-learn="study"]'
const IMPRINT = '.week06 [data-learn="imprint"]'

/** One method control, by its settings key. */
const control = <M extends PathMethod>(method: M, key: keyof PathSettingsMap[M] & string) =>
  `.week06 [data-control="${method}-${key}"]`

export type PathsLearnState = {
  method?: PathMethod
  overlays?: Partial<PathOverlays>
  imprint?: boolean
  progressive?: boolean
}

/**
 * Week 06 Paths guided sequence: points into lines → connection → curvature →
 * flow → meander → confluence → growth → branching → 2D to 3D → spline and mesh →
 * progressive generation. `show` sets up what a step is about.
 */
export function createPathsLearnSteps({ show }: { show: (state: PathsLearnState) => void }): readonly LearnStep[] {
  return [
    {
      title: 'Points into lines',
      text: 'A path is a line built by a rule. Each method here starts from a few points and grows them into lines over the same terrain block, with no water or assets: only the ground the lines read.',
      try: 'Press 1, 2 and 3 to switch method.',
      notice: 'Each method shows only the points it starts from: nodes, sources or anchors.',
      target: [METHOD, SCENE],
      enter: () => show({ method: 'connection', overlays: { nodes: true, links: false } }),
    },
    {
      title: 'Connection: a network',
      figure: <SpannerFigure />,
      text: 'Connection links seeded nodes. Every pair is a candidate link, costed by its length over the ground and tried shortest first. A link is kept only if the network so far cannot reach between its ends, or only by a detour longer than the allowed stretch.',
      try: 'Drag Directness from 0 up.',
      notice: 'At 0 the network is a tree, a single route between any two nodes; higher values add loops wherever the tree detours too far.',
      target: [control('connection', 'directness'), SCENE],
      enter: () => show({ method: 'connection', overlays: { nodes: true } }),
    },
    {
      title: 'Curvature is drawing, not routing',
      text: 'Which nodes connect is decided on straight links. Curvature only bows each link into a curve afterwards, so the network stays the same while the drawing changes.',
      try: 'Drag Curvature with Straight links on.',
      notice: 'The dashed links never move; the curves bend away from them and back.',
      target: [control('connection', 'curvature'), STUDY, SCENE],
      enter: () => show({ method: 'connection', overlays: { nodes: true, links: true } }),
    },
    {
      title: 'Flow: reading the ground',
      text: 'Flow starts paths on the highest ground and steps them along. At every step the heading turns toward downhill, the direction the ground falls fastest, so the terrain steers each path.',
      try: 'Drag Downhill strength.',
      notice: 'Strong pull bends paths along the field ticks; weak pull lets them run straight on and cut across the slope.',
      target: [control('flow', 'downhill'), SCENE],
      enter: () => show({ method: 'flow', overlays: { nodes: true, field: true } }),
    },
    {
      title: 'Meander and hollows',
      text: 'Meander swings each step from side to side with coherent noise, without changing the course itself. A stream runs on under the same rule until it ends where water would: at a channel it joins, in a hollow it cannot climb out of, or off the edge. Water never climbs; where a step would rise, it turns downhill instead.',
      try: 'Raise Meander from none.',
      notice: 'Streams wind more, but every one still ends in a pool, at a channel or off the edge.',
      target: [control('flow', 'meander'), SCENE],
      enter: () => show({ method: 'flow', overlays: { nodes: true, field: false } }),
    },
    {
      title: 'Confluence and accumulation',
      text: 'Streams are traced highest first. One whose ribbon comes near an earlier channel curves in and joins it, however soon after its source, at the first point downstream no higher than itself, and ends there: below the confluence the two are one channel. Each channel then carries the flow of every source above it, and its width grows with that flow: narrow at the source, wider below each confluence.',
      try: 'Raise Paths.',
      notice: 'New streams join the network rather than lying over it; small dots mark the confluences, and the channels below them widen.',
      target: [control('flow', 'count'), SCENE],
      enter: () => show({ method: 'flow', overlays: { nodes: true, field: false } }),
    },
    {
      title: 'Growth: heading and drift',
      text: 'Growth starts from anchors, each with a heading. Every step moves forward and turns the heading a little by coherent noise, so lines wander in long curves instead of jittering. Near the edge they bend back in.',
      try: 'Drag Drift from 0 to 1.',
      notice: 'At 0 each line runs straight; higher drift curls it.',
      target: [control('growth', 'drift'), SCENE],
      enter: () => show({ method: 'growth', overlays: { nodes: true, spline: true, source: false, projection: false }, imprint: false }),
    },
    {
      title: 'Branching',
      text: 'At each step a growing tip may split. A branch leaves at an angle with part of the remaining length, and can branch once more.',
      try: 'Raise Branch probability.',
      notice: 'Branches are drawn thinner, so the hierarchy reads at a glance.',
      target: [control('growth', 'branching'), SCENE],
      enter: () => show({ method: 'growth', overlays: { spline: true } }),
    },
    {
      title: 'From 2D to 3D',
      figure: <ProjectionFigure />,
      text: 'Growth never looks at the terrain. The line is grown flat, as points (x, z) in a plane, then projected: each point drops to the ground height h(x, z). A spline smoothed through the points and laid on the ground is the final path.',
      try: 'Turn the 2D source line, Projection and Terrain spline on and off.',
      notice: 'The flat line and the ground line have the same plan; only the height differs.',
      target: [STUDY, SCENE],
      enter: () => show({ method: 'growth', overlays: { source: true, projection: true, spline: true } }),
    },
    {
      title: 'Spline ↔ mesh',
      text: 'Lines can act back on the surface. With Imprint on, every terrain vertex near a Growth spline sinks by a smooth groove, with a low shoulder either side, and the spline then rides in the groove.',
      try: 'Turn Imprint on and drag its depth.',
      notice: 'Turn Contours on (C): the contour lines kink where the ground has been pressed.',
      target: [IMPRINT, SCENE],
      enter: () => show({ method: 'growth', overlays: { source: false, projection: false, spline: true }, imprint: true }),
    },
    {
      title: 'Progressive generation',
      text: 'Every vertex records the step at which it appears. Progressive replays the finished run step by step, so it always ends on the same lines for the same seed and settings.',
      try: 'Choose Progressive, then Play and Reset.',
      notice: 'Connection draws its nodes first, then links shortest first; Flow and Growth extend all their lines together.',
      target: [GENERATION, SCENE],
      enter: () => show({ progressive: true }),
    },
  ]
}
