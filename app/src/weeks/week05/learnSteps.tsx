import type { LearnStep } from '../../shared/ui/learn.tsx'
import { canvasTarget } from '../../shared/ui/learnTargets.ts'
import { DisplacementFigure, FlowFigure, FresnelFigure, PipelineFigure } from './learnFigures.tsx'
import type { ShaderStudyId } from './studies.ts'

const SCENE = canvasTarget('.week05')

const param = (...uniforms: string[]) =>
  uniforms.map((uniform) => `.week05 [data-param="${uniform}"]`).join(', ')

const STAGE_TRACK = '.week05 .stage-track'
const OUTPUT_VIEW = '.week05 [data-learn="output-view"]'
const studyGroup = (group: 'foundation' | 'application') =>
  `.week05 .study-select[data-group="${group}"]`

/**
 * Week 05 guided sequence: explain briefly, point at the live control or the
 * specimen, and let the reader try it. `showStudy` opens the study a step is
 * about (in the Result view). The control to act on comes first in `target`,
 * since the tour scrolls the panel to it.
 */
export function createShaderLearnSteps({
  showStudy,
}: {
  showStudy: (id: ShaderStudyId) => void
}): readonly LearnStep[] {
  return [
    {
      title: 'What a shader is',
      text: 'A small program the GPU runs for every vertex and pixel, every frame. Here, one rule decides what the specimen’s surface shows.',
      try: 'Press G to change geometry.',
      notice: 'The rule stays the same; only the form it reads changes.',
      target: SCENE,
    },
    {
      title: 'Vertex → Raster → Fragment',
      figure: <PipelineFigure />,
      text: 'The vertex stage places each corner. The rasteriser fills the triangle with pixels, blending vertex values between them. The fragment stage colours each pixel.',
      notice: 'The track marks where the current rule runs.',
      target: STAGE_TRACK,
    },
    {
      title: 'Geometry → Field → Rule → Result',
      figure: <FlowFigure />,
      text: 'Every study reads down the panel this way: the field taken from the geometry, the rule applied to it, and what it writes.',
      target: '.week05 .instrument-body',
      enter: () => showStudy('height'),
    },
    {
      title: 'Height: a mapping, not a shape',
      text: 'Six foundations each isolate one input. Height reads world y and maps it onto a ramp from Low to High.',
      try: 'Drag Low and High.',
      notice: 'The colours slide over the form. The mesh never moves.',
      target: [param('uHeightLow', 'uHeightHigh'), SCENE],
      enter: () => showStudy('height'),
    },
    {
      title: 'Fresnel: the view is an input',
      figure: <FresnelFigure />,
      text: 'Fresnel compares the surface normal with the direction to the camera. Where the surface turns away from you, it brightens.',
      try: 'Drag in the scene to orbit.',
      notice: 'The bright rim follows your viewpoint, not the form.',
      target: SCENE,
      enter: () => showStudy('fresnel'),
    },
    {
      title: 'Displacement: moving geometry',
      figure: <DisplacementFigure />,
      text: 'The one vertex rule: noise pushes each vertex along its normal before the triangles are rasterised.',
      try: 'Drag Amplitude a between 0 and max.',
      notice: 'The silhouette and cast shadow change, and the track marks Vertex.',
      target: [param('uDisplaceAmplitude'), STAGE_TRACK, SCENE],
      enter: () => showStudy('displacement'),
    },
    {
      title: 'Applications',
      text: 'Surface Material, Habitat, Growth and Exposure combine foundations into readings of a world: material, shelter, spread, weathering.',
      try: 'Scrub Growth progress.',
      notice: 'The front spreads along the form from where it touches the floor.',
      target: [param('uGrowthProgress'), studyGroup('application'), SCENE],
      enter: () => showStudy('growth'),
    },
    {
      title: 'Shaders make the invisible visible',
      text: 'Height, view angle, age and exposure are not visible on a plain surface. A rule turns that data into something you can see.',
      try: 'Set View to Term only.',
      notice: 'Exposure as a raw value, 0 black to 1 white: the weathering the material was hiding.',
      target: [OUTPUT_VIEW, SCENE],
      enter: () => showStudy('exposure'),
    },
  ]
}
