import { LAYER_BASE, LATTICE_ORIGIN, MODULE_SIZE, VOXEL_SIZE } from '../../project/architecture.ts'
import type { Candidate } from './distribution.ts'
import { isWaterAt, STUDY_HALF } from './studyTerrain.ts'

/**
 * Week 06 structures: small architectural masses in the Shadow Ecology
 * grammar, without its growth. Each is a fixed composition of a few square
 * modules on the Project's module lattice, raised in voxel layers, compact
 * enough to read as accents rather than a town:
 *
 *   stepped     a seed block: one tall module, the rest stepping down toward the sun (−z)
 *   wall        a row of three modules, broad face to the sun, the middle one highest
 *   cantilever  a tower with a thin slab reaching out from its top, open beneath
 *   gate        two piers joined by a span across a one-module opening
 *
 * A placed point picks the composition (variety), its height (scale) and a
 * quarter turn (turn), and snaps to the lattice so the material's courses
 * and module joints fall on the block edges, as in the Project.
 */

export type StructureForm = 'stepped' | 'wall' | 'cantilever' | 'gate'
export const STRUCTURE_FORMS: readonly StructureForm[] = ['stepped', 'wall', 'cantilever', 'gate']

/** Height of the tallest module at scale 1, in voxel layers. */
const BASE_LAYERS = 4
const MIN_LAYERS = 3
const MAX_LAYERS = 6
/** Lowest step of a composition, in layers. */
const STEP_FLOOR = 1
/** Grounded modules reach this far below the lowest ground under them. */
const FOUNDATION = VOXEL_SIZE
/** Grounded modules stand at least this many layers clear of the highest ground under them. */
const MIN_CLEARANCE = 1
/** Ground the later layers cannot stand on reaches this far past a structure's grounded modules. */
const FOOTPRINT_MARGIN = 0.03
/**
 * Most the ground may fall under one grounded module, world units (about 2.5
 * layers): more is a cliff it would hang over. Flanks pass, each module
 * stepping down with the ground; the escarpment does not.
 */
const MAX_RELIEF = 0.2

/** A box of modules: (i, k) and size (w, d) in modules; top, and bottom for raised pieces, in layers above the base. */
type Piece = { i: number; k: number; w: number; d: number; top: number; bottom?: number }

/** A block in world units. Raised blocks (slabs, spans) leave the ground under them open. */
export type Block = {
  x0: number
  x1: number
  z0: number
  z1: number
  y0: number
  y1: number
  raised: boolean
}

export type StructureMass = {
  form: StructureForm
  blocks: Block[]
  /** 0…1: how weathered the material reads. */
  age: number
}

function layout(form: StructureForm, h: number): { width: number; depth: number; pieces: Piece[] } {
  const step = (top: number) => Math.max(STEP_FLOOR, top)
  switch (form) {
    case 'stepped':
      return {
        width: 2,
        depth: 2,
        pieces: [
          { i: 0, k: 1, w: 1, d: 1, top: h },
          { i: 1, k: 1, w: 1, d: 1, top: step(h - 2) },
          { i: 0, k: 0, w: 1, d: 1, top: step(h - 3) },
          { i: 1, k: 0, w: 1, d: 1, top: STEP_FLOOR },
        ],
      }
    case 'wall':
      return {
        width: 3,
        depth: 1,
        pieces: [
          { i: 0, k: 0, w: 1, d: 1, top: step(h - 1) },
          { i: 1, k: 0, w: 1, d: 1, top: h },
          { i: 2, k: 0, w: 1, d: 1, top: step(h - 3) },
        ],
      }
    case 'cantilever':
      return {
        width: 2,
        depth: 2,
        pieces: [
          { i: 0, k: 1, w: 1, d: 1, top: h },
          { i: 0, k: 0, w: 1, d: 1, top: STEP_FLOOR },
          { i: 1, k: 1, w: 1, d: 1, top: h, bottom: h - 1 },
        ],
      }
    case 'gate':
      return {
        width: 3,
        depth: 1,
        pieces: [
          { i: 0, k: 0, w: 1, d: 1, top: h },
          { i: 1, k: 0, w: 1, d: 1, top: h, bottom: h - 1 },
          { i: 2, k: 0, w: 1, d: 1, top: h },
        ],
      }
  }
}

/** Turns a layout a quarter turn: (i, k) → (k, width − i − w). */
function quarterTurn(width: number, pieces: Piece[]): Piece[] {
  return pieces.map((p) => ({ ...p, i: p.k, k: width - p.i - p.w, w: p.d, d: p.w }))
}

const snapLayer = (y: number) => LAYER_BASE + Math.round((y - LAYER_BASE) / VOXEL_SIZE) * VOXEL_SIZE
const floorLayer = (y: number) => LAYER_BASE + Math.floor((y - LAYER_BASE) / VOXEL_SIZE) * VOXEL_SIZE
const ceilLayer = (y: number) => LAYER_BASE + Math.ceil((y - LAYER_BASE) / VOXEL_SIZE) * VOXEL_SIZE

/** Where the ground under a rectangle is read: its corners and centre. */
const footprintSamples = (x0: number, x1: number, z0: number, z1: number): [number, number][] => [
  [x0, z0],
  [x1, z0],
  [x0, z1],
  [x1, z1],
  [(x0 + x1) / 2, (z0 + z1) / 2],
]

/** Lowest and highest ground under a rectangle. */
function groundRange(groundHeight: (x: number, z: number) => number, x0: number, x1: number, z0: number, z1: number) {
  const samples = footprintSamples(x0, x1, z0, z1).map(([x, z]) => groundHeight(x, z))
  return { low: Math.min(...samples), high: Math.max(...samples) }
}

export function structureForm(variety: number): StructureForm {
  return STRUCTURE_FORMS[Math.min(STRUCTURE_FORMS.length - 1, Math.floor(variety * STRUCTURE_FORMS.length))]!
}

/** The blocks of the structure at a placed point. */
export function structureMass(groundHeight: (x: number, z: number) => number, s: Candidate): StructureMass {
  const form = structureForm(s.variety)
  const h = Math.min(MAX_LAYERS, Math.max(MIN_LAYERS, Math.round(BASE_LAYERS * s.scale)))
  let { width, depth, pieces } = layout(form, h)
  const turns = Math.floor((s.turn / (2 * Math.PI)) * 4) % 4
  for (let t = 0; t < turns; t += 1) {
    pieces = quarterTurn(width, pieces)
    ;[width, depth] = [depth, width]
  }
  const originX = LATTICE_ORIGIN + Math.round((s.x - (width * MODULE_SIZE) / 2 - LATTICE_ORIGIN) / MODULE_SIZE) * MODULE_SIZE
  const originZ = LATTICE_ORIGIN + Math.round((s.z - (depth * MODULE_SIZE) / 2 - LATTICE_ORIGIN) / MODULE_SIZE) * MODULE_SIZE
  const base = snapLayer(groundHeight(s.x, s.z))

  const blocks = pieces.map((p): Block => {
    const x0 = originX + p.i * MODULE_SIZE
    const z0 = originZ + p.k * MODULE_SIZE
    const x1 = x0 + p.w * MODULE_SIZE
    const z1 = z0 + p.d * MODULE_SIZE
    const ground = groundRange(groundHeight, x0, x1, z0, z1)
    const clear = ceilLayer(ground.high) + MIN_CLEARANCE * VOXEL_SIZE
    const y1 = Math.max(base + p.top * VOXEL_SIZE, clear)
    // A raised piece too close to the ground under it stands on the ground instead.
    const raised = p.bottom !== undefined && base + p.bottom * VOXEL_SIZE >= clear
    const y0 = raised ? base + p.bottom! * VOXEL_SIZE : floorLayer(ground.low - FOUNDATION)
    return { x0, x1, z0, z1, y0, y1, raised }
  })
  const age = (s.variety * 7.31) % 1
  return { form, blocks, age }
}

/**
 * Whether a structure has footing over its whole footprint, not only at its
 * anchor: every block, slabs included, lies over the block's top, so none
 * hangs past the cut edge; and each grounded module stands on dry ground
 * (unless water is allowed) that varies under it by no more than MAX_RELIEF,
 * so none hangs over a cliff. Slabs may still reach out over a drop.
 */
export function hasFooting(
  groundHeight: (x: number, z: number) => number,
  mass: StructureMass,
  allowWater: boolean,
): boolean {
  const onBlock = mass.blocks.every(
    (b) => b.x0 >= -STUDY_HALF && b.x1 <= STUDY_HALF && b.z0 >= -STUDY_HALF && b.z1 <= STUDY_HALF,
  )
  return (
    onBlock &&
    mass.blocks
      .filter((b) => !b.raised)
      .every((b) => {
        const samples = footprintSamples(b.x0, b.x1, b.z0, b.z1)
        if (!allowWater && samples.some(([x, z]) => isWaterAt(x, z))) {
          return false
        }
        const heights = samples.map(([x, z]) => groundHeight(x, z))
        return Math.max(...heights) - Math.min(...heights) <= MAX_RELIEF
      })
  )
}

/** Grounded footprints, with a small margin: ground the later layers cannot stand on. */
export function massFootprints(mass: StructureMass) {
  return mass.blocks
    .filter((b) => !b.raised)
    .map((b) => ({
      x0: b.x0 - FOOTPRINT_MARGIN,
      x1: b.x1 + FOOTPRINT_MARGIN,
      z0: b.z0 - FOOTPRINT_MARGIN,
      z1: b.z1 + FOOTPRINT_MARGIN,
    }))
}
