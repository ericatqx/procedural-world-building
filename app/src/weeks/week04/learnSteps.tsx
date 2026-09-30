import type { LearnStep } from '../../shared/ui/learn.tsx'
import { canvasTarget } from '../../shared/ui/learnTargets.ts'
import type { MeshMode } from './voxels/index.ts'
import { CsgFigure, DensityFigure, MeshingFigure, ResolutionFigure } from './learnFigures.tsx'

const SCENE = canvasTarget('.week04')
const RESOLUTION = '.week04 [data-learn="resolution"]'
const MESH_MODE = '.week04 [data-learn="mesh-mode"]'
const CHUNKS = '.week04 [data-learn="chunks"]'
const READOUT = '.week04 .view-strip .readout'
const VIEW_STRIP = '.week04 .view-strip'
const stepRow = (n: number) => `.week04 .row-list > :nth-child(${n})`
/** The courtyard sphere in the default castle: the clearest single CSG step. */
const COURTYARD = 3

export type VoxelLearnActions = {
  /** Leave Isolate so the full CSG composite renders. */
  showComposite: () => void
  setMeshMode: (mode: MeshMode) => void
  /** Turn the chunk overlay on and collapse the step rows so the Chunks section is in view. */
  showChunks: () => void
}

/**
 * Week 04 guided sequence: density field → CSG → voxel sampling → meshing →
 * cost and chunks. The control to act on comes first in `target`, since the
 * tour scrolls the panel to it.
 */
export function createVoxelLearnSteps({
  showComposite,
  setMeshMode,
  showChunks,
}: VoxelLearnActions): readonly LearnStep[] {
  return [
    {
      title: 'Density: a number everywhere',
      figure: <DensityFigure />,
      text: 'The volume starts as a density field: every point in the cube has a value. Positive is solid, negative is empty, and the surface is where it crosses zero.',
      try: `Press Isolate on Step ${COURTYARD} to see one shape's field on its own.`,
      notice: 'Alone it is just a sphere; the castle only appears once steps combine.',
      target: [`${stepRow(COURTYARD)} .row-action`, SCENE],
      enter: showComposite,
    },
    {
      title: 'CSG: combining fields',
      figure: <CsgFigure />,
      text: 'Steps combine top to bottom, sample by sample. Union keeps the larger value, Subtract turns a shape inside out first, Intersect keeps only the overlap.',
      try: `Untick Step ${COURTYARD}, then tick it back on.`,
      notice: 'The courtyard is that sphere subtracted; without it the keep is a closed block.',
      target: [`${stepRow(COURTYARD)} .row-head`, SCENE],
      enter: showComposite,
    },
    {
      title: 'Voxels: sampling the volume',
      figure: <ResolutionFigure />,
      text: 'The field is sampled on a regular 3D grid, Resolution samples per axis. Each sample is a voxel: one density value at one point in the volume.',
      try: 'Drag Resolution down to 8, then back up.',
      notice: 'The readout counts them: 8³ = 512 samples, 20³ = 8,000.',
      target: [RESOLUTION, READOUT, SCENE],
      enter: () => {
        showComposite()
        setMeshMode('blocks')
      },
    },
    {
      title: 'Blocks vs Marching cubes',
      figure: <MeshingFigure />,
      text: 'Meshing turns samples into triangles. Blocks draws a cube face wherever solid meets empty. Marching cubes places vertices where density crosses zero.',
      try: 'Switch Meshing mode, then press F for wireframe.',
      notice: 'Same samples, different surfaces: stairs become slopes, and the triangle count changes.',
      target: [MESH_MODE, VIEW_STRIP, SCENE],
      enter: showComposite,
    },
    {
      title: 'Cost and chunks',
      text: 'Cost grows with the cube of resolution: doubling it means 8× the samples to evaluate and mesh. Large worlds split the volume into chunks so only nearby or edited ones rebuild.',
      try: 'Set Resolution to 48, then drag Chunks per axis.',
      notice: 'Edits slow down at 48³ = 110,592 samples. Chunks here are only an overlay; this demo still meshes one volume.',
      target: [CHUNKS, RESOLUTION, READOUT, SCENE],
      enter: () => {
        showComposite()
        showChunks()
      },
    },
  ]
}
