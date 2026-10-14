import { BufferGeometry, Line, LineBasicMaterial, LineLoop, Vector3 } from 'three'
import { sunPath } from '../project/sun.ts'
import type { ArchLod, ArchRepresentation } from './archMesh.ts'
import type { TraceAmount } from './materials.ts'
import type { Divergence, WorldId } from './parallel.ts'
import type { CreatureView, WayOfSeeing } from './perception.ts'
import type { Eco } from './simulation.ts'

/** What the scene draws; none of it reaches the simulation. */
export type SceneView = {
  way: WayOfSeeing
  creatureView: CreatureView
  embodied: boolean
  overlays: boolean
  /** Light-seeking (exposure) and shadow-seeking (shelter) vegetation, each shown or hidden. */
  layers: { exposure: boolean; shelter: boolean; creatures: boolean }
  /** Worn path traces on the ground. */
  trail: 'off' | TraceAmount
  terrain: { contours: boolean; wireframe: boolean }
  lod: 'auto' | ArchLod
  /** How the architecture's voxels are drawn; the structure is the same either way. */
  representation: ArchRepresentation
  /** The observation lens: a magnifier that follows the cursor (click pins it). */
  lens: boolean
  autoRotate: boolean
  /** Tracers drawn through the wind field. */
  windField: boolean
  /** Rendering cost only: the world and the simulation are the same at every level. */
  quality: Quality
  parallel: ParallelView
}

/** An alternate world, computed headless from the shared past (parallel.ts). */
export type ParallelWorld = { id: Divergence; eco: Eco }

export type ParallelView = {
  open: boolean
  /** Alternates computed so far, in slot order. */
  worlds: ParallelWorld[]
  selected: WorldId
  select: (id: WorldId) => void
}

export type Quality = 'low' | 'normal' | 'high'

/**
 * What each quality level draws:
 *   dpr            device pixel ratio cap
 *   shadowMap      sun shadow map size; shadowEvery: frames between shadow redraws
 *   lodScale       multiplies the distances where architecture and vegetation step down
 *   plantShadows   whether vegetation casts shadows
 *   rain, tracers  share of rain drops and wind tracers drawn
 *   lensEvery      frames between lens redraws
 */
export const QUALITY: Record<
  Quality,
  { dpr: number; shadowMap: number; shadowEvery: number; lodScale: number; plantShadows: boolean; rain: number; tracers: number; lensEvery: number }
> = {
  low: { dpr: 1, shadowMap: 1024, shadowEvery: 6, lodScale: 0.6, plantShadows: false, rain: 0.35, tracers: 0.35, lensEvery: 4 },
  normal: { dpr: 1.5, shadowMap: 2048, shadowEvery: 2, lodScale: 1, plantShadows: true, rain: 1, tracers: 1, lensEvery: 2 },
  high: { dpr: 2, shadowMap: 3072, shadowEvery: 1, lodScale: 1.4, plantShadows: true, rain: 1, tracers: 1, lensEvery: 1 },
}

export const CAMERA_POSITION: [number, number, number] = [9.5, 9, 14]
export const ORBIT_TARGET: [number, number, number] = [0, 1.2, -1]
export const ORBIT_DISTANCE = { min: 3, max: 90, parallel: 200 } as const
export const SUN_MARKER_RADIUS = 30
/**
 * The lens on screen: a circle of `size` px at the cursor showing the
 * ground under it magnified `zoom` times; the world inside it runs slow.
 */
export const LENS = { size: 260, zoom: 2.6, slow: 0.15, minRadius: 0.4, maxRadius: 2.6 } as const

const GUIDE_COLOR = '#e9e6df'

function guideLine(points: [number, number, number][], opacity: number, loop: boolean) {
  const geometry = new BufferGeometry().setFromPoints(points.map((p) => new Vector3(...p)))
  const material = new LineBasicMaterial({ color: GUIDE_COLOR, transparent: true, opacity, depthWrite: false })
  return loop ? new LineLoop(geometry, material) : new Line(geometry, material)
}

export const sunArc = (noon: number) => guideLine(sunPath(noon, SUN_MARKER_RADIUS), 0.22, false)

export function disposeLine(line: Line) {
  line.geometry.dispose()
  ;(line.material as LineBasicMaterial).dispose()
}