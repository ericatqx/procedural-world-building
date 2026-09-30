export type DensityShapeKind = 'sphere' | 'box' | 'plane' | 'torus' | 'noiseBlob'

export type CsgOp = 'replace' | 'union' | 'subtract' | 'intersect'

export type MeshMode = 'blocks' | 'marchingCubes'

export type DensityStep = {
  id: string
  enabled: boolean
  /** First enabled step should use replace; later steps use CSG ops. */
  op: CsgOp
  shape: DensityShapeKind
  /** Generic size / radius control (shape-dependent). */
  size: number
  /** Offset of the shape center along each axis (-1..1 in volume space). */
  offsetX: number
  offsetY: number
  offsetZ: number
  /** Extra shape param (torus tube, noise frequency, plane thickness). */
  detail: number
}

export type VoxelSettings = {
  resolution: number
  meshMode: MeshMode
  showChunkBounds: boolean
  /** Chunks per axis (1 = one volume, 2 = 2×2×2, …). */
  chunksPerAxis: number
  steps: DensityStep[]
}

export const DENSITY_SHAPE_OPTIONS: { value: DensityShapeKind; label: string }[] =
  [
    { value: 'sphere', label: 'Sphere' },
    { value: 'box', label: 'Box' },
    { value: 'plane', label: 'Ground plane' },
    { value: 'torus', label: 'Torus' },
    { value: 'noiseBlob', label: 'Noise blob' },
  ]

export const CSG_OP_OPTIONS: { value: CsgOp; label: string }[] = [
  { value: 'replace', label: 'Replace (base)' },
  { value: 'union', label: 'Union / add' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'intersect', label: 'Intersect' },
]

export function createDensityStep(
  overrides: Partial<DensityStep> = {},
): DensityStep {
  const makeId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? () => crypto.randomUUID()
      : () => `step-${Math.random().toString(36).slice(2, 10)}`

  return {
    id: makeId(),
    enabled: true,
    op: 'replace',
    shape: 'sphere',
    size: 0.55,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    detail: 0.2,
    ...overrides,
  }
}

export const DEFAULT_VOXEL_SETTINGS: VoxelSettings = {
  resolution: 20,
  meshMode: 'blocks',
  showChunkBounds: true,
  chunksPerAxis: 2,
  // Wide plinth → a keep block on top → an off-centre sphere hollows a
  // courtyard: corner towers stand where it misses, the front corner drops to
  // a stump and the front walls sag into a breach → a low torus cuts slots
  // into the plinth sides.
  steps: [
    createDensityStep({
      op: 'replace',
      shape: 'box',
      size: 0.95,
      offsetY: -1,
      detail: 0.2,
    }),
    createDensityStep({
      op: 'union',
      shape: 'box',
      size: 0.75,
      offsetY: 0.1,
      detail: 0.2,
    }),
    createDensityStep({
      op: 'subtract',
      shape: 'sphere',
      size: 0.86,
      offsetX: 0.12,
      offsetY: 0.6,
      offsetZ: 0.12,
      detail: 0.2,
    }),
    createDensityStep({
      op: 'subtract',
      shape: 'torus',
      size: 0.9,
      offsetY: -0.6,
      detail: 0.16,
    }),
  ],
}
