import { FormationLayer } from './formationLayer.tsx'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { Color, DoubleSide, Fog, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from 'three'
import {
  EYE_HEIGHT,
  LANDSCAPE,
  SPRINT_SPEED,
  WALK_SPEED,
  approachPose,
  chunkOrigin,
  chunksAcross,
  coastLod,
  detailReach,
  isCoastChunk,
  exploreLook,
  islandRadius,
  landscapeHeight,
  lodForDistance,
  overviewFraming,
  overviewPose,
  type DetailLevel,
} from './terrain.ts'
import { loading, viewProjector } from './loading.ts'
import { buildChunkGeometry, buildIslandShell, drawnLods, refreshDrawnLift, type ChunkNeighbors } from './terrainMesh.ts'
import { smoothstep } from '../project02/core.ts'
import { environment, fogScale, wetness } from './environment.ts'
import { LivingArchitecture, type ArchitectureVariant } from './LivingArchitecture.tsx'
import { Vegetation } from './Vegetation.tsx'
import { WorldPlants } from './WorldPlants.tsx'
import { Creatures } from './Creatures.tsx'
import { creatureCam, creatureFocus } from './creatureCam.ts'
import { applyVegGround } from './vegGround.ts'
import { applyStyleFinish, specialiseStyle, styleScalars, syncStyleSwitches } from './visualStyle.ts'
import { focusPoint, takeLookRequest } from './livingSelection.ts'
import { PlacementCursor, type Placement } from './PlacementCursor.tsx'
import { applyMist } from './mist.ts'
import { Rain, Sky, SunDisc, SunOrrery, WindTracers } from './Sky.tsx'

/** Whether the sun's disc is drawn (Explore's sky disc, the Black Stage's paper disc). Off since Round 08G. */
const SHOW_SUN = false
import { WaterLayer } from './WaterLayer.tsx'
import { FlowParticles } from './FlowParticles.tsx'
import { WADE_DEPTH, type WaterSystem } from './water.ts'
import type { World } from './world.ts'

export type ViewMode = 'overview' | 'approach' | 'explore'

/**
 * Where the walker stands, written by the camera rig each frame. A teleport
 * request set by the map is applied on the next Explore frame, then cleared.
 */
export type Navigation = {
  x: number
  z: number
  yaw: number
  teleport: { x: number; z: number; yaw?: number; glide?: boolean } | null
  /** A camera pose for the orbiting views (the Waterfall Locator), applied on the next such frame, then cleared. */
  view: { position: [number, number, number]; target: [number, number, number] } | null
  /** The walker's actual speed in metres per second this frame (0 when still or blocked; 0 outside Explore), for the HUD. */
  speed: number
  /** A place for Approach to look at (picked on the terrain or the map): the camera glides to its Approach view, then this is cleared. */
  approach: { x: number; z: number; dist?: number; yaw?: number; aim?: number; glide?: number; arc?: boolean; elev?: number } | null
  /** Standing water the walker keeps out of, or null when water is hidden. */
  water: WaterSystem | null
}

export type TerrainReadout = {
  ground: number
  camera: number
  triangles: number
  pending: number
}

type Orbit = {
  enabled: boolean
  /** The element the controls listen on (Round 08A: a lost release is ended there). */
  domElement?: HTMLElement | null
  target: Vector3
  minDistance: number
  maxDistance: number
  maxPolarAngle: number
  getPolarAngle: () => number
  update: () => void
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

/** One zoom range for every orbiting view: from close to its target to well beyond the island. */
const ORBIT_DISTANCE = { min: 1, max: 32000 }
/** Closest the orbiting camera may come to the ground beneath it, in meters. */
const GROUND_CLEARANCE = 1.5
/** The orbiting views may not tilt below this polar angle (about 79° from straight up), except while handing over from Explore. */
const MAX_POLAR = 1.38
/** The hand-over from Explore: the orbit turns about where the view ray meets the ground, no nearer than the first and no farther than the second (meters). */
const HANDOFF_AHEAD = 10
const HANDOFF_REACH = 120
/** Zooming in this close to the orbit's target re-aims it further along the same view ray, so the zoom does not run out. */
const RETARGET_BELOW = 8
/** Ground clearance is checked this far to each side of the camera too, so it does not meet a rising slope. */
const CLEARANCE_SIDE = 8
/** Explore's far plane, which the hand-over keeps until the orbit's own far plane has grown past it. */
const EXPLORE_FAR = 8000

const ACROSS = chunksAcross()
const COUNT = ACROSS * ACROSS
const HALF = LANDSCAPE.size * 0.5

const centerY = new Float32Array(COUNT)

function fillCenters() {
  for (let iz = 0; iz < ACROSS; iz += 1) {
    for (let ix = 0; ix < ACROSS; ix += 1) {
      const [x, z] = chunkOrigin(ix, iz)
      centerY[ix + iz * ACROSS] = landscapeHeight(x + LANDSCAPE.chunkSize * 0.5, z + LANDSCAPE.chunkSize * 0.5)
    }
  }
}

fillCenters()

function chunkIndex(ix: number, iz: number) {
  return ix + iz * ACROSS
}

const HYSTERESIS = 1.12

function assignLods(lods: Int8Array, camera: Vector3, place: Vector3, detail: DetailLevel) {
  const reach = detailReach(detail)
  for (let iz = 0; iz < ACROSS; iz += 1) {
    for (let ix = 0; ix < ACROSS; ix += 1) {
      const id = chunkIndex(ix, iz)
      const [x, z] = chunkOrigin(ix, iz)
      const cx = x + LANDSCAPE.chunkSize * 0.5
      const cz = z + LANDSCAPE.chunkSize * 0.5
      const fromCamera = Math.hypot(camera.x - cx, camera.y - centerY[id]!, camera.z - cz)
      const fromPlace = Math.hypot(place.x - cx, place.z - cz)
      const nearTheGround = camera.y < 1800
      const distance = nearTheGround && fromPlace < reach ? fromPlace : fromCamera
      // A chunk keeps its lod until the distance is clearly past the band edge,
      // so orbiting near a boundary does not flip it back and forth.
      const previous = lods[id]!
      const wanted = lodForDistance(distance, detail)
      let lod = wanted
      if (previous >= 0 && wanted > previous) lod = Math.max(previous, Math.min(wanted, lodForDistance(distance / HYSTERESIS, detail)))
      else if (previous >= 0 && wanted < previous) lod = Math.min(previous, Math.max(wanted, lodForDistance(distance * HYSTERESIS, detail)))
      lods[id] = lod
      if (isCoastChunk(ix, iz)) lods[id] = Math.min(lods[id]!, coastLod(detail))
    }
  }
  for (let pass = 0; pass < LANDSCAPE.lodStep.length; pass += 1) {
    for (let iz = 0; iz < ACROSS; iz += 1) {
      for (let ix = 0; ix < ACROSS; ix += 1) {
        const id = chunkIndex(ix, iz)
        const lod = lods[id]!
        const relax = (nx: number, nz: number) => {
          if (nx < 0 || nz < 0 || nx >= ACROSS || nz >= ACROSS) return
          const nid = chunkIndex(nx, nz)
          if (lods[nid]! > lod + 1) lods[nid] = lod + 1
        }
        relax(ix + 1, iz)
        relax(ix - 1, iz)
        relax(ix, iz + 1)
        relax(ix, iz - 1)
      }
    }
  }
}

/**
 * The whole field, one mesh per chunk. Detail follows the camera: a chunk is
 * rebuilt when its spacing changes or a neighbor's does, a few per frame,
 * nearest first. The first view is built before paint.
 */
export function TerrainField({
  readout,
  rush,
  place,
  detail,
}: {
  readout: TerrainReadout
  rush: MutableRefObject<boolean>
  place: MutableRefObject<Vector3>
  detail: MutableRefObject<DetailLevel>
}) {
  const group = useRef<Group>(null)
  const camera = useThree((state) => state.camera)
  const material = useMemoMaterial()
  // Rain darkens the ground a little and takes the dryness off its surface.
  useFrame(() => {
    terrainWet.value = wetness.value
  })
  const lods = useRef(new Int8Array(COUNT).fill(-1))
  const meshLods = useRef(new Int8Array(COUNT).fill(-1))
  drawnLods.lods = meshLods.current
  const seen = useRef({ e: new Int8Array(COUNT), w: new Int8Array(COUNT), n: new Int8Array(COUNT), s: new Int8Array(COUNT) })
  const meshes = useRef<(Mesh | null)[]>(new Array(COUNT).fill(null))
  const ready = useRef(false)
  const liftDirty = useRef(true)

  useLayoutEffect(() => {
    const root = group.current
    if (!root) return
    fillCenters()
    const cameraY = camera.position.y
    const lifted = cameraY > 1800 ? camera.position : new Vector3(camera.position.x, 6000, camera.position.z)
    assignLods(lods.current, lifted, place.current, detail.current)
    for (let pass = 0; pass < 4; pass += 1) {
      let any = false
      for (let id = 0; id < COUNT; id += 1) {
        if (!stale(id)) continue
        rebuildId(id)
        any = true
      }
      if (!any) break
    }
    ready.current = true
    readout.pending = 0
    refreshDrawnLift()
    liftDirty.current = false
    return () => {
      for (const mesh of meshes.current) {
        mesh?.geometry.dispose()
        if (mesh) root.remove(mesh)
      }
      meshes.current.fill(null)
      meshLods.current.fill(-1)
      ready.current = false
    }
    // The field is built once for this mount. Camera motion updates it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame(() => {
    if (!ready.current) return
    assignLods(lods.current, camera.position, place.current, detail.current)
    // Under a loading cover nothing is seen yet, so the first fill takes bigger steps (loading.ts); the chunks and their order are the same.
    const limit = loading.covered ? 45 : rush.current ? 12 : 5
    const started = performance.now()
    const queue = staleQueue(camera.position)
    let rebuilt = 0
    while (rebuilt < queue.length && performance.now() - started < limit) {
      rebuildId(queue[rebuilt]!)
      rebuilt += 1
    }
    // A chunk whose own spacing is current but whose neighbor just changed is
    // redone in the same frame, so a seam never shows two different edges.
    for (let id = 0; id < COUNT; id += 1) {
      if (meshLods.current[id] === lods.current[id] && stale(id)) rebuildId(id)
    }
    let pending = 0
    let triangles = 0
    for (let id = 0; id < COUNT; id += 1) {
      const mesh = meshes.current[id]
      if (!mesh) continue
      const segs = Math.round(LANDSCAPE.chunkSize / LANDSCAPE.lodStep[meshLods.current[id]!]!)
      triangles += segs * segs * 2
      if (stale(id)) pending += 1
    }
    readout.triangles = triangles
    readout.pending = pending
    // The rivers' lift follows the levels the chunks are drawn at (terrainMesh.ts › drawnLift): rewritten only when chunks were rebuilt.
    if (liftDirty.current) {
      liftDirty.current = false
      refreshDrawnLift()
    }
    readout.camera = camera.position.y
    readout.ground = landscapeHeight(camera.position.x, camera.position.z)
    if (pending === 0) rush.current = false
  })

  return <group ref={group} />

  function neighborsOf(ix: number, iz: number, selfLod: number): ChunkNeighbors {
    const at = (nx: number, nz: number) => {
      if (nx < 0 || nz < 0 || nx >= ACROSS || nz >= ACROSS) return selfLod
      // A neighbor not built yet will be built at its assigned spacing: matching that now saves rebuilding this chunk
      // once it is (on the first fill, about a quarter of the chunks were built twice).
      const built = meshLods.current[chunkIndex(nx, nz)]!
      if (built >= 0) return built
      const planned = lods.current[chunkIndex(nx, nz)]!
      return planned >= 0 ? planned : selfLod
    }
    return { e: at(ix + 1, iz), w: at(ix - 1, iz), n: at(ix, iz + 1), s: at(ix, iz - 1) }
  }

  function stale(id: number): boolean {
    if (meshLods.current[id] !== lods.current[id]) return true
    const ix = id % ACROSS
    const iz = (id - ix) / ACROSS
    const have = neighborsOf(ix, iz, meshLods.current[id]!)
    const got = seen.current
    return have.e !== got.e[id] || have.w !== got.w[id] || have.n !== got.n[id] || have.s !== got.s[id]
  }

  function staleQueue(cameraPosition: Vector3): number[] {
    const refining: { id: number; d: number }[] = []
    const coarsening: { id: number; d: number }[] = []
    for (let iz = 0; iz < ACROSS; iz += 1) {
      for (let ix = 0; ix < ACROSS; ix += 1) {
        const id = chunkIndex(ix, iz)
        if (!stale(id)) continue
        const [x, z] = chunkOrigin(ix, iz)
        const d = Math.hypot(cameraPosition.x - (x + LANDSCAPE.chunkSize * 0.5), cameraPosition.z - (z + LANDSCAPE.chunkSize * 0.5))
        const built = meshLods.current[id]!
        const entry = { id, d }
        if (built < 0 || lods.current[id]! <= built) refining.push(entry)
        else coarsening.push(entry)
      }
    }
    refining.sort((a, b) => a.d - b.d)
    coarsening.sort((a, b) => b.d - a.d)
    return refining.map((entry) => entry.id).concat(coarsening.map((entry) => entry.id))
  }

  function rebuildId(id: number) {
    const ix = id % ACROSS
    const iz = (id - ix) / ACROSS
    const lod = lods.current[id]!
    const neighbors = neighborsOf(ix, iz, lod)
    const [ox, oz] = chunkOrigin(ix, iz)
    const geometry = buildChunkGeometry(ox, oz, lod, neighbors)
    const existing = meshes.current[id]
    const root = group.current
    if (!root) return
    if (existing) existing.geometry.dispose()
    else {
      const mesh = new Mesh(geometry, material)
      mesh.frustumCulled = true
      mesh.castShadow = true
      mesh.receiveShadow = true
      root.add(mesh)
      meshes.current[id] = mesh
    }
    if (existing) existing.geometry = geometry
    meshLods.current[id] = lod
    liftDirty.current = true
    seen.current.e[id] = neighbors.e
    seen.current.w[id] = neighbors.w
    seen.current.n[id] = neighbors.n
    seen.current.s[id] = neighbors.s
  }
}

const terrainWet = { value: 0 }

function useMemoMaterial() {
  const material = useRef<MeshStandardMaterial>(null)
  if (!material.current) {
    const next = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
    // Wet ground: darker and sleeker, most on flat ground, where rain would stand. One uniform, set by the weather.
    next.customProgramCacheKey = () => 'terrain-wet'
    next.onBeforeCompile = (shader) => {
      shader.uniforms.uWet = terrainWet
      applyMist(shader)
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float uWet;\nvoid main() {')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           float wetFlat = smoothstep(0.82, 0.97, inverseTransformDirection(normalize(vNormal), viewMatrix).y);
           float wetNow = uWet * (0.3 + 0.7 * wetFlat);
           diffuseColor.rgb *= 1.0 - 0.34 * wetNow;`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n           roughnessFactor = mix(roughnessFactor, 0.5, wetNow * 0.7);')
      applyVegGround(shader)
      applyStyleFinish(shader, 'terrain')
    }
    specialiseStyle(next)
    material.current = next
  }
  useEffect(() => () => material.current?.dispose(), [])
  return material.current
}

const FOG: Record<ViewMode, { near: number; far: number }> = {
  overview: { near: 9000, far: 22000 },
  approach: { near: 500, far: 4200 },
  explore: { near: 36, far: 1800 },
}

function Atmosphere({ mode }: { mode: ViewMode }) {
  const scene = useThree((state) => state.scene)
  useLayoutEffect(() => {
    scene.background = new Color('#000000')
    const fog = FOG[mode]
    scene.fog = new Fog('#050608', fog.near, fog.far)
    return () => {
      scene.fog = null
      scene.background = null
    }
  }, [scene, mode])
  return null
}

type Focus = { x: number; z: number; yaw: number; pitch: number; dist?: number; aim?: number; glide?: number; arc?: boolean; elev?: number }

const HOME = exploreLook(0, 0)

const lookScratch = new Vector3()
const GLIDE_SECONDS = 0.7

function ease(t: number) {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

const rayAt = new Vector3()

/**
 * The lowest the orbiting camera may be at (x, z): the highest ground under it or within CLEARANCE_SIDE of it, plus `clearance`; null
 * off the field. One rule for the frame's clearance and for the zoom, so the zoom stops where the camera would be lifted.
 */
/**
 * A composed LOW view (the /preview site's Formation: plants seen as a person would see them, not from above): the camera on a straight line at
 * `elev` radians above the target, raised only as far as the ground under the camera and along the line of sight asks (approachPose keeps at least
 * 25 degrees and 36 m of clearance over the midpoint, which up close looked straight down).
 */
function lowPose(x: number, z: number, yaw: number, dist: number, aim: number, elev: number): { position: [number, number, number]; target: [number, number, number] } {
  const ty = landscapeHeight(x, z) + aim
  const cx = x + Math.sin(yaw) * dist
  const cz = z + Math.cos(yaw) * dist
  let cy = Math.max(ty + dist * Math.tan(elev), landscapeHeight(cx, cz) + 3)
  for (let f = 0.15; f < 0.95; f += 0.1) {
    const g = landscapeHeight(cx + (x - cx) * f, cz + (z - cz) * f) + 2
    const line = cy + (ty - cy) * f
    if (g > line) cy += (g - line) / (1 - f)
  }
  return { position: [cx, cy, cz], target: [x, ty, z] }
}

function clearanceFloor(x: number, z: number, clearance: number, ring = true): number | null {
  if (Math.abs(x) >= HALF || Math.abs(z) >= HALF) return null
  let ground = landscapeHeight(x, z)
  if (ring) {
    for (let k = 0; k < 8; k += 1) ground = Math.max(ground, landscapeHeight(x + Math.cos(k * 0.7854) * CLEARANCE_SIDE, z + Math.sin(k * 0.7854) * CLEARANCE_SIDE))
  }
  return ground + clearance
}

/** How far along a ray (from `from`, unit `dir`) the ground first meets it, or null: the terrain's height field, inside the island. */
function groundAlong(from: Vector3, dir: Vector3, maxDistance: number): number | null {
  const below = (t: number) => {
    rayAt.copy(from).addScaledVector(dir, t)
    return Math.hypot(rayAt.x, rayAt.z) < islandRadius(Math.atan2(rayAt.z, rayAt.x)) && rayAt.y < landscapeHeight(rayAt.x, rayAt.z)
  }
  let last = 0
  for (let t = 0.5; t <= maxDistance; t += Math.max(1.5, t * 0.02)) {
    if (below(t)) {
      let lo = last
      let hi = t
      for (let n = 0; n < 8; n += 1) {
        const mid = (lo + hi) / 2
        if (below(mid)) hi = mid
        else lo = mid
      }
      return hi
    }
    last = t
  }
  return null
}

/** Overview and Approach orbit. Explore walks at eye height (1.75 m). Priority stays at 0 so the canvas still draws. */
export function LandscapeRig({
  mode,
  focus,
  place,
  nav,
  onOrbit,
  presetKey,
}: {
  mode: ViewMode
  focus: MutableRefObject<Focus>
  place: MutableRefObject<Vector3>
  nav: MutableRefObject<Navigation>
  /** Asked of the page when Explore, with the cursor free, is zoomed out: it moves to the orbiting view. */
  onOrbit: () => void
  /** Changes when a preset is clicked again, so its view is restored even though the mode did not change. */
  presetKey: number
}) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const controls = useThree((state) => state.controls) as unknown as Orbit | null
  const modeRef = useRef(mode)
  modeRef.current = mode
  /** The mode before the latest change, and whether the glide under way began in Walk (its haze, near plane and clearance then ease out of Walk's). */
  const previousMode = useRef(mode)
  const fromWalk = useRef(false)
  const glide = useRef(1)
  /** A composed move's arc height over the terrain (worked out once, at its first frame). */
  const arcLift = useRef<number | null>(null)
  const fromPos = useRef(new Vector3())
  const fromAim = useRef(new Vector3())
  const fromYaw = useRef(0)
  const fromPitch = useRef(0)
  const ready = useRef(false)
  const orbiting = useRef(false)
  const explore = useRef({ x: focus.current.x, z: focus.current.z, yaw: focus.current.yaw, pitch: focus.current.pitch })
  const keys = useRef({ forward: 0, strafe: 0, sprint: false })
  const dragging = useRef(false)
  const handOffRef = useRef<((scale: number) => void) | null>(null)
  /**
   * The orbit's own camera position (`want`) and what was drawn from it (`out`). The ground clearance lifts the drawn camera
   * without feeding that lift back into the orbit: the orbit controls recompute the view from the camera's position and aim
   * at their target every frame, so a lifted position would tilt the view downward and the zoom could not be undone.
   */
  const held = useRef({ want: new Vector3(), out: new Vector3(), valid: false })
  const orbitRef = useRef(onOrbit)
  orbitRef.current = onOrbit
  const controlsRef = useRef(controls)
  controlsRef.current = controls
  /** True from the hand-over out of Explore until the orbit's own limits (clearance, fog, planes) have caught up. */
  const handoff = useRef(false)
  /** How far the hand-over's target was from the camera: the fog, clearance and near plane ease in from there. */
  const handoffBase = useRef(HANDOFF_AHEAD)
  /** The haze the orbiting view last drew with: where the fog eases from when the walk begins. */
  const fogFrom = useRef({ near: FOG.overview.near, far: FOG.overview.far })
  /** What Approach turns about when it was asked to look at the selected organism (see livingSelection.ts); null: the place the camera is looking at. */
  const approachFocus = useRef<ReturnType<typeof focusPoint>>(null)
  useLayoutEffect(() => {
    place.current.set(focus.current.x, 0, focus.current.z)
    // Approach turns about an organism only when asked to ("Look closer"); otherwise about where the camera is looking.
    if (mode === 'approach') approachFocus.current = takeLookRequest() ? focusPoint(camera.position) : null
    if (mode === 'explore') handoff.current = false
    const cam = camera as PerspectiveCamera
    const leftWalk = previousMode.current === 'explore' && mode !== 'explore'
    previousMode.current = mode
    fromWalk.current = leftWalk
    if (!ready.current) {
      ready.current = true
      glide.current = 1
      return
    }
    fromPos.current.copy(camera.position)
    if (controls) fromAim.current.copy(controls.target)
    camera.getWorldDirection(lookScratch)
    fromYaw.current = Math.atan2(-lookScratch.x, -lookScratch.z)
    fromPitch.current = Math.asin(Math.max(-1, Math.min(1, lookScratch.y)))
    // Round 09: from Walk straight to the overview, the glide's aim starts on the walker's own line of sight (at the overview's own aim distance),
    // not at the orbit's old target from before the walk: the view then turns, rises and pulls back as one move, with no swing at the start.
    if (leftWalk) {
      const target = mode === 'overview' ? overviewPose(0, 0, undefined, fromYaw.current).target : approachPose(focus.current.x, focus.current.z, focus.current.yaw, undefined, focus.current.dist, focus.current.aim).target
      const reach = Math.max(30, camera.position.distanceTo(new Vector3(...target)))
      fromAim.current.copy(camera.position).addScaledVector(lookScratch, reach)
    }
    glide.current = 0
    orbiting.current = false
    if (mode === 'explore') {
      explore.current.x = focus.current.x
      explore.current.z = focus.current.z
      explore.current.yaw = focus.current.yaw
      explore.current.pitch = focus.current.pitch
    }
    if (mode === 'overview') {
      // (Leaving Walk the camera starts at eye height: the walker's near plane is kept, and the frame loop eases it out with the glide.)
      cam.near = leftWalk ? 0.25 : 40
      cam.far = 80000
    } else if (mode === 'approach') {
      cam.near = leftWalk ? 0.25 : 1
      cam.far = 30000
    } else {
      cam.near = 0.25
      cam.far = 8000
    }
    cam.updateProjectionMatrix()
  }, [mode, presetKey, camera, focus, place])

  useEffect(() => {
    if (mode !== 'explore') return
    const held = new Set<string>()
    const drive: Record<string, 'forward' | 'strafe'> = {
      w: 'forward',
      arrowup: 'forward',
      s: 'forward',
      arrowdown: 'forward',
      a: 'strafe',
      arrowleft: 'strafe',
      d: 'strafe',
      arrowright: 'strafe',
    }
    const negative = new Set(['s', 'arrowdown', 'a', 'arrowleft'])
    const emit = () => {
      let forward = 0
      let strafe = 0
      for (const key of held) {
        const axis = drive[key]
        const sign = negative.has(key) ? -1 : 1
        if (axis === 'forward') forward += sign
        if (axis === 'strafe') strafe += sign
      }
      keys.current.forward = Math.max(-1, Math.min(1, forward))
      keys.current.strafe = Math.max(-1, Math.min(1, strafe))
    }
    const editable = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    const down = (event: KeyboardEvent) => {
      if (!editable(event.target)) keys.current.sprint = event.shiftKey
      const key = event.key.toLowerCase()
      if (!(key in drive) || event.metaKey || event.ctrlKey || event.altKey || editable(event.target)) return
      event.preventDefault()
      held.add(key)
      emit()
    }
    const up = (event: KeyboardEvent) => {
      keys.current.sprint = event.shiftKey
      if (held.delete(event.key.toLowerCase())) emit()
    }
    const clear = () => {
      held.clear()
      keys.current.sprint = false
      emit()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
      keys.current.forward = 0
      keys.current.strafe = 0
      keys.current.sprint = false
    }
  }, [mode])

  useEffect(() => {
    if (mode !== 'explore') return
    const element = gl.domElement
    const locked = () => document.pointerLockElement === element
    // Some browsers report a large jump in the first moves after the lock starts or ends: those are not the user's hand.
    let lockedAt = 0
    const lockChanged = () => {
      if (locked()) lockedAt = performance.now()
      else dragging.current = false
    }
    document.addEventListener('pointerlockchange', lockChanged)
    let lastX = 0
    let lastY = 0
    const turn = (dx: number, dy: number) => {
      if (glide.current < 1) return
      explore.current.yaw -= dx * 0.0045
      explore.current.pitch = Math.max(-0.6, Math.min(0.45, explore.current.pitch - dy * 0.0035))
    }
    // Mouse-look: the pointer is locked to the scene and its movement turns the view. Clicking the scene asks for the lock
    // again after Esc. Where the browser will not lock the pointer, dragging still looks around.
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      // With the cursor free, Shift + click moves to the orbiting view from exactly where the camera is.
      if (event.shiftKey && !locked()) {
        handOffRef.current?.(1)
        return
      }
      dragging.current = true
      lastX = event.clientX
      lastY = event.clientY
      if (!locked()) {
        try {
          void (element.requestPointerLock() as Promise<void> | undefined)?.catch(() => {})
        } catch {
          // Drag-to-look stays available.
        }
      }
    }
    const move = (event: PointerEvent) => {
      if (locked()) {
        if (performance.now() - lockedAt < 120 || Math.abs(event.movementX) > 240 || Math.abs(event.movementY) > 240) return
        turn(event.movementX, event.movementY)
      } else if (dragging.current) {
        turn(event.clientX - lastX, event.clientY - lastY)
        lastX = event.clientX
        lastY = event.clientY
      }
    }
    const up = () => {
      dragging.current = false
    }
    element.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      document.removeEventListener('pointerlockchange', lockChanged)
      element.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      dragging.current = false
      // Leaving Explore hands the cursor back.
      if (document.pointerLockElement === element) document.exitPointerLock()
    }
  }, [gl, camera, nav, mode])

  // Zoom for every view, from one rule: whatever the wheel or the trackpad sends (a wheel turn, a two-finger scroll, a pinch)
  // is zoom, with no guessing which device sent it. Dragging orbits and Shift + drag pans (the orbit controls' own).
  // In the orbiting views the camera moves along the line to its target, so the target stays where it is; at the closest
  // distance it carries the camera and the target forward together instead of stopping.
  useEffect(() => {
    const element = gl.domElement
    const ahead = new Vector3()
    const probe = new Vector3()
    const locked = () => document.pointerLockElement === element
    // Cursor free in Explore, zooming:: the same camera continues in the orbit controls. It stays where it is, and they
    // take a point a few meters ahead, at the walker's feet, as the thing it turns about.
    const handOff = (scale = 1) => {
      // The orbit turns about a point on the exact view ray (where it meets the ground, within walking reach), so the camera
      // keeps its position and its heading and pitch. It is allowed to sit at the view's current tilt (looking level is about
      // 90°, past the 79° it keeps for the presets).
      const pose = explore.current
      const look = Math.cos(pose.pitch)
      ahead.set(-Math.sin(pose.yaw) * look, Math.sin(pose.pitch), -Math.cos(pose.yaw) * look)
      const hit = groundAlong(camera.position, ahead, 4000)
      const reach = Math.max(HANDOFF_AHEAD, Math.min(HANDOFF_REACH, hit ?? HANDOFF_REACH))
      const tilt = Math.PI / 2 + pose.pitch
      const orbit = controlsRef.current
      if (orbit) orbit.maxPolarAngle = Math.max(MAX_POLAR, tilt + 0.02)
      handoff.current = true
      handoffBase.current = reach
      const aimX = camera.position.x + ahead.x * reach
      const aimY = camera.position.y + ahead.y * reach
      const aimZ = camera.position.z + ahead.z * reach
      // The zoom that started the hand-over is the first step of the orbit's: the camera moves along the view toward that point.
      nav.current.view = {
        position: [aimX + (camera.position.x - aimX) * scale, aimY + (camera.position.y - aimY) * scale, aimZ + (camera.position.z - aimZ) * scale],
        target: [aimX, aimY, aimZ],
      }
      orbitRef.current()
    }
    handOffRef.current = handOff
    // scale < 1 zooms in, > 1 out. The camera moves along the line to its target by that factor: the target and the viewing
    // angle do not change, and a zoom followed by its opposite returns to where it began.
    const zoom = (scale: number) => {
      if (modeRef.current === 'explore') {
        handOff(Math.max(0.05, Math.min(scale, 4)))
        return
      }
      const orbit = controlsRef.current
      if (!orbit) return
      glide.current = 1
      const kept = held.current
      if (kept.valid && camera.position.equals(kept.out)) camera.position.copy(kept.want)
      let dist = camera.position.distanceTo(orbit.target)
      if (dist < 1e-3) return
      // Approach keeps its target where it is (an organism, or where the view was panned to): it zooms toward it, no further.
      if (scale < 1 && dist * scale < RETARGET_BELOW && modeRef.current !== 'approach') {
        // Close to the target: move it on along the same ray (to the ground there, or on by walking reach), so the camera
        // neither moves nor turns, and the zoom can go on until the ground itself is in the way.
        ahead.subVectors(orbit.target, camera.position).divideScalar(dist)
        const hit = groundAlong(camera.position, ahead, 4000)
        const to = Math.min(hit ?? HANDOFF_REACH, Math.max(dist, HANDOFF_REACH))
        if (to > dist) {
          orbit.target.copy(camera.position).addScaledVector(ahead, to)
          dist = to
        }
      }
      let next = Math.max(ORBIT_DISTANCE.min, Math.min(ORBIT_DISTANCE.max, dist * scale))
      // Zooming in stops where the camera would be lifted off the ground, not past it. (Past it, the orbit's own position went
      // on under the ground while the drawn camera stayed lifted, so the next zoom out had to climb back out before anything moved.)
      if (scale < 1 && !handoff.current) {
        probe.subVectors(camera.position, orbit.target).divideScalar(dist)
        const below = (d: number) => {
          const floor = clearanceFloor(orbit.target.x + probe.x * d, orbit.target.z + probe.z * d, GROUND_CLEARANCE)
          return floor !== null && orbit.target.y + probe.y * d < floor
        }
        if (below(next)) {
          if (below(dist)) next = dist
          else {
            let lo = next
            let hi = dist
            for (let n = 0; n < 8; n += 1) {
              const mid = (lo + hi) / 2
              if (below(mid)) lo = mid
              else hi = mid
            }
            next = hi
          }
        }
      }
      camera.position.sub(orbit.target).multiplyScalar(next / dist).add(orbit.target)
      orbit.update()
    }
    // A creature camera owns the camera and its own zoom (Creatures.tsx). This handler must stand aside then: it moved the shared camera toward the
    // orbit's stale target (often hundreds of metres away), and the terrain, the plants and the streaming read that pose in the next frame before the
    // creature camera put it back, so the plants near the creature were culled or dropped to a distant level for a moment on every wheel step.
    const creatureOwned = () => creatureCam.get().mode !== 'off'
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      if (creatureOwned() || locked() || glide.current < 1) return
      const unit = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 400 : 1
      // A pinch arrives as a wheel with Ctrl held and much smaller steps, so it gets a stronger factor.
      const gain = event.ctrlKey ? 0.012 : 0.0025
      const limit = event.ctrlKey ? 30 : 100
      zoom(Math.exp(Math.max(-limit, Math.min(limit, event.deltaY * unit)) * gain))
    }
    // Safari reports a pinch as its own gesture, with a scale that grows as the fingers spread.
    let lastScale = 1
    const gestureStart = (event: Event) => {
      event.preventDefault()
      lastScale = 1
    }
    const gestureChange = (event: Event) => {
      event.preventDefault()
      const scale = (event as Event & { scale: number }).scale
      if (creatureOwned() || locked() || glide.current < 1 || !(scale > 0)) return
      zoom(lastScale / scale)
      lastScale = scale
    }
    element.addEventListener('wheel', wheel, { passive: false })
    element.addEventListener('gesturestart', gestureStart)
    element.addEventListener('gesturechange', gestureChange)
    return () => {
      handOffRef.current = null
      element.removeEventListener('wheel', wheel)
      element.removeEventListener('gesturestart', gestureStart)
      element.removeEventListener('gesturechange', gestureChange)
    }
  }, [gl, camera, nav])

  useEffect(() => {
    if (!controls) return
    const before = new Vector3()
    const ray = new Vector3()
    const begin = () => {
      orbiting.current = true
      before.copy(controls.target)
    }
    const finish = () => {
      orbiting.current = false
      // After a pan the target has moved with the camera, but it may no longer be on the ground (panning is in the screen's
      // plane). It slides along the view ray to where the ground is, so the camera and the view do not change and the next
      // orbit and zoom turn about the place now in the middle of the view.
      if (modeRef.current === 'explore' || before.distanceToSquared(controls.target) < 0.25) return
      ray.subVectors(controls.target, camera.position)
      const dist = ray.length()
      if (dist < 1) return
      ray.divideScalar(dist)
      const hit = groundAlong(camera.position, ray, dist * 4)
      if (hit !== null && hit > 1) controls.target.copy(camera.position).addScaledVector(ray, hit)
    }
    controls.addEventListener('start', begin)
    controls.addEventListener('end', finish)
    // Round 08A — A LOST RELEASE. The orbit controls start a gesture on pointer-down and end it only on pointer-up or pointer-cancel; meanwhile
    // they listen to every pointer move on the page. If the release never reaches them (the window loses focus mid-drag, a context menu or
    // another app takes the button-up, pointer capture is dropped), the gesture stays open and plain pointer movement, with no button held,
    // keeps orbiting the island until the next click. Reproduced with synthetic events: ten button-less moves after a lost release turned the
    // camera through about 3 km. So a gesture is ended as soon as the mouse reports no button held, the window loses focus, or capture is lost.
    const element = controls.domElement ?? null
    let lastPointer = 1
    const noteDown = (event: PointerEvent) => {
      lastPointer = event.pointerId
    }
    const endGesture = (pointerId: number) => {
      if (!orbiting.current || !element) return
      element.dispatchEvent(new PointerEvent('pointercancel', { pointerId, pointerType: 'mouse', bubbles: true }))
    }
    const strayMove = (event: PointerEvent) => {
      if (orbiting.current && event.pointerType === 'mouse' && event.buttons === 0) endGesture(event.pointerId)
    }
    const lost = () => endGesture(lastPointer)
    element?.addEventListener('pointerdown', noteDown, true)
    element?.addEventListener('lostpointercapture', lost)
    // Capture phase on the document, so it runs before the controls' own move handler and the stray move does not orbit.
    document.addEventListener('pointermove', strayMove, true)
    window.addEventListener('blur', lost)
    return () => {
      element?.removeEventListener('pointerdown', noteDown, true)
      element?.removeEventListener('lostpointercapture', lost)
      document.removeEventListener('pointermove', strayMove, true)
      window.removeEventListener('blur', lost)
      controls.removeEventListener('start', begin)
      controls.removeEventListener('end', finish)
    }
  }, [controls])

  // Before the orbit controls update (they run at -1): the orbit goes on from its own position, not from the lifted drawn one,
  // unless something else (a drag, a preset) has moved the camera since.
  useFrame(() => {
    const kept = held.current
    if (modeRef.current !== 'explore' && kept.valid && camera.position.equals(kept.out)) camera.position.copy(kept.want)
  }, -2)

  // The page may draw annotations over the world (loading.ts › viewProjector): where a world point falls on it, as this camera sees it.
  useEffect(() => {
    const v = new Vector3()
    viewProjector.project = (x, y, z) => {
      v.set(x, y, z).project(camera)
      const r = gl.domElement.getBoundingClientRect()
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, front: v.z < 1 }
    }
    return () => {
      viewProjector.project = null
    }
  }, [camera, gl])

  // The lens shift (terrain.ts › overviewFraming.shiftX/Y): eased toward the framing's, and to none while walking or under a creature camera.
  const lensShift = useRef({ x: 0, y: 0 })
  useFrame((state, delta) => {
    const want = modeRef.current === 'explore' || creatureCam.get().mode !== 'off' ? { x: 0, y: 0 } : { x: overviewFraming.shiftX, y: overviewFraming.shiftY }
    const s = lensShift.current
    // (As slow as the overview's glide, when the page sets one, so the shift and the camera arrive together.)
    const k = 1 - Math.exp(-delta / (overviewFraming.glide ? overviewFraming.glide * 0.35 : 0.35))
    s.x += (want.x - s.x) * k
    s.y += (want.y - s.y) * k
    if (Math.abs(s.x - want.x) < 1e-4) s.x = want.x
    if (Math.abs(s.y - want.y) < 1e-4) s.y = want.y
    const cam = camera as PerspectiveCamera
    const { width, height } = state.size
    if (s.x === 0 && s.y === 0) {
      if (cam.view?.enabled) {
        cam.clearViewOffset()
      }
    } else if (!cam.view?.enabled || cam.view.offsetX !== -s.x * width || cam.view.offsetY !== -s.y * height || cam.view.fullWidth !== width) {
      cam.setViewOffset(width, height, -s.x * width, -s.y * height, width, height)
    }
  })

  useFrame((_, delta) => {
    // A creature camera (Follow, POV, or the glide of Locate) owns the camera: the rig stands aside, and the orbit controls rest.
    if (creatureCam.get().mode !== 'off') {
      if (controls) controls.enabled = false
      // The ground it looks at is what the terrain, the plants and the shadows stream for.
      focus.current.x = creatureFocus.x
      focus.current.z = creatureFocus.z
      place.current.set(creatureFocus.x, 0, creatureFocus.z)
      return
    }
    const orbit = controls
    const current = modeRef.current
    const cam = camera as PerspectiveCamera
    if (current !== 'explore') {
      if (!orbit) return
      orbit.enabled = true
      orbit.minDistance = ORBIT_DISTANCE.min
      orbit.maxDistance = ORBIT_DISTANCE.max
      const request = nav.current.view
      if (request) {
        nav.current.view = null
        camera.up.set(0, 1, 0)
        camera.position.set(...request.position)
        orbit.target.set(...request.target)
        orbit.update()
        glide.current = 1
      }
      const aim = nav.current.approach
      if (aim) {
        // A place chosen for Approach: the camera glides from where it is to that place's Approach view.
        nav.current.approach = null
        focus.current.x = aim.x
        focus.current.z = aim.z
        focus.current.dist = aim.dist
        // (Optional, for a composed shot (the /preview site's Formation): the side to look from, the height to aim at, and a slower glide.)
        if (aim.yaw !== undefined) focus.current.yaw = aim.yaw
        focus.current.aim = aim.aim
        focus.current.glide = aim.glide
        focus.current.arc = aim.arc
        focus.current.elev = aim.elev
        arcLift.current = null
        approachFocus.current = null
        fromPos.current.copy(camera.position)
        fromAim.current.copy(orbit.target)
        glide.current = 0
      }
      if (glide.current < 1 && !orbiting.current) {
        handoff.current = false
        // Overview always turns about the island's center, from the side the camera is already looking from. Approach is a
        // local view: it turns about the organism in focus (the one selected), from as far as its size asks; with none selected,
        // about the place the camera is looking at now.
        const local = approachFocus.current
        const pose =
          current === 'overview'
            ? overviewPose(0, 0, undefined, fromYaw.current)
            : local
              ? approachPose(local.x, local.z, local.yaw ?? focus.current.yaw, undefined, Math.max(110, Math.min(420, local.radius * 2.6 + local.height * 1.8 + 40)), local.height * 0.35)
              : focus.current.elev !== undefined
                ? lowPose(focus.current.x, focus.current.z, focus.current.yaw, focus.current.dist ?? 60, focus.current.aim ?? 2, focus.current.elev)
                : approachPose(focus.current.x, focus.current.z, focus.current.yaw, undefined, focus.current.dist, focus.current.aim)
        const glideSeconds = current === 'approach' && !local && focus.current.glide ? focus.current.glide : (current === 'overview' || fromWalk.current) && overviewFraming.glide ? overviewFraming.glide : GLIDE_SECONDS
        glide.current = Math.min(1, glide.current + Math.min(delta, 0.05) / glideSeconds)
        const t = ease(glide.current)
        // A composed move (the /preview site's Formation) may ask for an ARC: the camera rises on one smooth curve high enough to clear the terrain under
        // its whole path, instead of being pushed up and down by the ground clearance wherever the straight line would cut a hill (a bumpy ride).
        if (current === 'approach' && !local && focus.current.arc && arcLift.current === null) {
          // (Round 17: the clearance margin tapers to nothing at both ends, only the path's middle is tested, and the lift is held in proportion to
          // the move. A fixed 25 m margin against a destination a few metres over the ground, divided by the arc's small height there, asked for the
          // 600 m cap: between Living Architecture and Vegetation the camera shot up and showed the whole island for a moment.)
          let need = 0
          const span = Math.hypot(pose.position[0] - fromPos.current.x, pose.position[2] - fromPos.current.z)
          for (let k = 2; k < 19; k += 1) {
            const u = k / 20
            const arc = Math.sin(Math.PI * u)
            const x = fromPos.current.x + (pose.position[0] - fromPos.current.x) * u
            const z = fromPos.current.z + (pose.position[2] - fromPos.current.z) * u
            const y = fromPos.current.y + (pose.position[1] - fromPos.current.y) * u
            const short = landscapeHeight(x, z) + GROUND_CLEARANCE + 12 * arc - y
            if (short > 0) need = Math.max(need, short / arc)
          }
          arcLift.current = Math.min(Math.max(20, span * 0.35), need)
        }
        const lift = current === 'approach' && !local && focus.current.arc ? (arcLift.current ?? 0) * Math.sin(Math.PI * t) : 0
        camera.up.set(0, 1, 0)
        camera.position.set(
          fromPos.current.x + (pose.position[0] - fromPos.current.x) * t,
          fromPos.current.y + (pose.position[1] - fromPos.current.y) * t + lift,
          fromPos.current.z + (pose.position[2] - fromPos.current.z) * t,
        )
        orbit.target.set(
          fromAim.current.x + (pose.target[0] - fromAim.current.x) * t,
          fromAim.current.y + (pose.target[1] - fromAim.current.y) * t,
          fromAim.current.z + (pose.target[2] - fromAim.current.z) * t,
        )
        orbit.update()
      } else {
        if (glide.current < 1) glide.current = 1
        focus.current.x = orbit.target.x
        focus.current.z = orbit.target.z
        focus.current.yaw = Math.atan2(-(orbit.target.x - camera.position.x), -(orbit.target.z - camera.position.z))
        place.current.set(focus.current.x, 0, focus.current.z)
      }
      // The tilt limit follows the camera back up to its usual value, and never pushes it down.
      orbit.maxPolarAngle = Math.max(MAX_POLAR, Math.min(orbit.maxPolarAngle, orbit.getPolarAngle() + 0.002))
      const dist = Math.max(1, camera.position.distanceTo(orbit.target))
      // Never let the camera sink into the ground below it (inside the island's outline). Handing over from Explore, the
      // clearance starts at eye height and grows to the usual as the camera pulls back, so it does not lift at once.
      const clearance = handoff.current ? Math.min(GROUND_CLEARANCE, EYE_HEIGHT + 0.2 * Math.max(0, dist - handoffBase.current)) : GROUND_CLEARANCE
      const cx = camera.position.x
      const cz = camera.position.z
      held.current.want.copy(camera.position)
      // The highest ground under the camera or around it, so a rising slope beside it is not cut through. The ground the
      // terrain meshes draw can be coarser than this height field while they catch up with a moving camera, so the ring
      // is wide (CLEARANCE_SIDE) and the clearance holds on the whole field, not just inside the island's outline.
      // Handing over from Explore only the ground underfoot counts, so the camera is not lifted the moment the cursor is released.
      // Gliding out of Walk: how far the glide has come (eased), so its haze, near plane and clearance leave Walk's as the camera does.
      if (fromWalk.current && glide.current >= 1) fromWalk.current = false
      const walkBlend = fromWalk.current ? ease(glide.current) : null
      const floor = clearanceFloor(cx, cz, clearance, !handoff.current && walkBlend === null)
      if (floor !== null && camera.position.y < floor) camera.position.y = floor
      held.current.out.copy(camera.position)
      held.current.valid = true
      // The far plane never closes in with the target's distance: a camera close to its target can still be looking out over
      // the island, and a far plane at 14 times that distance would cut the view off a few dozen meters away, into the black.
      let near = Math.max(0.5, dist * 0.004)
      const far = Math.max(EXPLORE_FAR, dist * 14)
      if (handoff.current) {
        // Keep Explore's near plane until the orbit's own has grown past it.
        near = Math.max(0.25, dist * 0.004)
        if (dist * 14 >= EXPLORE_FAR) handoff.current = false
      }
      if (walkBlend !== null) near = 0.25 + (near - 0.25) * walkBlend
      if (Math.abs(cam.near - near) > near * 0.08 || Math.abs(cam.far - far) > far * 0.02) {
        cam.near = near
        cam.far = far
        cam.updateProjectionMatrix()
      }
      if (scene.fog instanceof Fog) {
        // The haze grows with the view's distance, the same for every orbiting view.
        const wide = smoothstep(1000, 4000, dist)
        let fogNear = Math.max(360, dist * (1.05 + 0.85 * wide)) * fogScale.near
        let fogFar = Math.max(2400, dist * (4.5 + 1.5 * wide)) * fogScale.far
        if (handoff.current) {
          // From Explore's close haze to the orbit's, as the camera pulls back.
          const k = smoothstep(handoffBase.current, handoffBase.current + 110, dist)
          fogNear = FOG.explore.near * fogScale.near + (fogNear - FOG.explore.near * fogScale.near) * k
          fogFar = FOG.explore.far * fogScale.far + (fogFar - FOG.explore.far * fogScale.far) * k
        }
        if (walkBlend !== null) {
          fogNear = FOG.explore.near * fogScale.near + (fogNear - FOG.explore.near * fogScale.near) * walkBlend
          fogFar = FOG.explore.far * fogScale.far + (fogFar - FOG.explore.far * fogScale.far) * walkBlend
        }
        // The illustrative styles may thicken the air (visualStyle.ts; 1 leaves it as it was).
        scene.fog.near = fogNear * styleScalars.fog
        scene.fog.far = fogFar * styleScalars.fog
        fogFrom.current = { near: fogNear, far: fogFar }
      }
      return
    }
    if (orbit) orbit.enabled = false
    held.current.valid = false
    const pose = explore.current
    const jump = nav.current.teleport
    if (jump) {
      nav.current.teleport = null
    }
    if (jump && (nav.current.water?.depthAt(jump.x, jump.z) ?? 0) <= WADE_DEPTH) {
      const reachTo = islandRadius(Math.atan2(jump.z, jump.x)) - 8
      const away = Math.hypot(jump.x, jump.z)
      const k = away > reachTo && away > 0 ? reachTo / away : 1
      pose.x = jump.x * k
      pose.z = jump.z * k
      // A placement keeps the heading the camera had and glides in from the orbit; a jump on the map is instant.
      if (jump.yaw !== undefined) {
        pose.yaw = jump.yaw
        pose.pitch = 0
      }
      if (!jump.glide) glide.current = 1
      place.current.set(pose.x, 0, pose.z)
    }
    if (glide.current < 1) {
      glide.current = Math.min(1, glide.current + Math.min(delta, 0.05) / GLIDE_SECONDS)
      const t = ease(glide.current)
      let turn = pose.yaw - fromYaw.current
      while (turn > Math.PI) turn -= Math.PI * 2
      while (turn < -Math.PI) turn += Math.PI * 2
      const yaw = fromYaw.current + turn * t
      const pitch = fromPitch.current + (pose.pitch - fromPitch.current) * t
      const x = fromPos.current.x + (pose.x - fromPos.current.x) * t
      const z = fromPos.current.z + (pose.z - fromPos.current.z) * t
      const eye = fromPos.current.y + (landscapeHeight(x, z) + EYE_HEIGHT - fromPos.current.y) * t
      const fx = -Math.sin(yaw)
      const fz = -Math.cos(yaw)
      const look = Math.cos(pitch)
      camera.up.set(0, 1, 0)
      camera.position.set(x, eye, z)
      camera.lookAt(x + fx * look, eye + Math.sin(pitch), z + fz * look)
      // The mode change gave the scene Explore's close haze at once, which hides the far ground while the camera is still
      // high above it. Ease the fog from the orbiting view's to Explore's along the glide instead.
      if (scene.fog instanceof Fog) {
        scene.fog.near = fogFrom.current.near + (FOG.explore.near * fogScale.near - fogFrom.current.near) * t
        scene.fog.far = fogFrom.current.far + (FOG.explore.far * fogScale.far - fogFrom.current.far) * t
      }
      nav.current.x = x
      nav.current.z = z
      nav.current.yaw = yaw
      return
    }
    const fx = -Math.sin(pose.yaw)
    const fz = -Math.cos(pose.yaw)
    const rx = Math.cos(pose.yaw)
    const rz = -Math.sin(pose.yaw)
    // Walking pace, faster while Shift is held.
    // Walking is a moderate 1.7 times the old pace (Shift is still the fast travel): close work stays precise, crossing open ground is less of a chore.
    const stride = (keys.current.sprint ? SPRINT_SPEED : WALK_SPEED * 1.7) * Math.min(delta, 0.05)
    const limit = HALF - 8
    let nx = Math.max(-limit, Math.min(limit, pose.x + (fx * keys.current.forward + rx * keys.current.strafe) * stride))
    let nz = Math.max(-limit, Math.min(limit, pose.z + (fz * keys.current.forward + rz * keys.current.strafe) * stride))
    const reach = islandRadius(Math.atan2(nz, nx)) - 8
    const dist = Math.hypot(nx, nz)
    if (dist > reach && dist > 0) {
      const scale = reach / dist
      nx *= scale
      nz *= scale
    }
    // Water deeper than a wade stops the walker; sliding along the shore keeps whichever axis is still dry.
    const water = nav.current.water
    const blocked = (x: number, z: number) => water !== null && water.depthAt(x, z) > WADE_DEPTH
    if (blocked(nx, nz)) {
      if (!blocked(nx, pose.z)) nz = pose.z
      else if (!blocked(pose.x, nz)) nx = pose.x
      else {
        nx = pose.x
        nz = pose.z
      }
    }
    // The speed actually made good this frame (collisions and the shore included), read by the HUD at once when Shift goes down or up.
    nav.current.speed = Math.hypot(nx - pose.x, nz - pose.z) / Math.max(1e-3, Math.min(delta, 0.05))
    pose.x = nx
    pose.z = nz
    const eye = landscapeHeight(pose.x, pose.z) + EYE_HEIGHT
    const look = Math.cos(pose.pitch)
    camera.position.set(pose.x, eye, pose.z)
    camera.up.set(0, 1, 0)
    camera.lookAt(pose.x + fx * look, eye + Math.sin(pose.pitch), pose.z + fz * look)
    focus.current.x = pose.x
    focus.current.z = pose.z
    focus.current.yaw = pose.yaw
    nav.current.x = pose.x
    nav.current.z = pose.z
    nav.current.yaw = pose.yaw
    focus.current.pitch = pose.pitch
    place.current.set(pose.x, 0, pose.z)
    if (scene.fog instanceof Fog) {
      scene.fog.near = FOG.explore.near * fogScale.near
      scene.fog.far = FOG.explore.far * fogScale.far
    }
  })

  return null
}

/** What the shell's bounce light reads from the sky: how much daylight there is, and which way the sun lies. */
const shellLight = { uLit: { value: 1 }, uSunDir: { value: new Vector3(-0.7, 0.5, -0.5) } }

function IslandShell() {
  const geometry = useMemo(() => buildIslandShell(), [])
  const material = useMemo(() => {
    const next = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: DoubleSide })
    next.customProgramCacheKey = () => 'shell-fill'
    next.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shellLight)
      applyMist(shader)
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float uLit;\nuniform vec3 uSunDir;\nvoid main() {')
        .replace(
          '#include <opaque_fragment>',
          `vec3 shellNormal = inverseTransformDirection(normal, viewMatrix);
         // Bounce light for the faces the sun cannot reach: a glow from low on the sunward side and a
         // cool one from below, over a small base. uLit takes all of it down with the day, so the shell
         // darkens with the terrain at night and keeps only a faint readable form.
         float warm = clamp(dot(shellNormal, normalize(vec3(uSunDir.x, -0.15, uSunDir.z))) * 0.5 + 0.5, 0.0, 1.0);
         float cool = clamp(dot(shellNormal, vec3(0.0, -1.0, 0.0)), 0.0, 1.0);
         outgoingLight += diffuseColor.rgb * (0.2 + warm * 0.5 + cool * 0.22) * uLit;
         #include <opaque_fragment>`,
        )
      applyStyleFinish(shader, 'shell')
    }
    specialiseStyle(next)
    return next
  }, [])
  useFrame(() => {
    const { sun, cloud } = environment.state
    shellLight.uLit.value = 0.1 + 0.9 * sun.daylight * (1 - 0.3 * cloud)
    shellLight.uSunDir.value.set(sun.direction[0], sun.direction[1], sun.direction[2])
  })
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )
  return <mesh geometry={geometry} material={material} castShadow receiveShadow />
}

/**
 * The scene, memoised: the page around it re-renders for its panel (several times a second while the camera or the clock moves), and every one of those
 * re-rendered all of the scene's components with it. Its props are values and refs, and the page keeps its callbacks stable (ShadowEcology03.tsx).
 */
export const LandscapeScene = memo(LandscapeSceneView)


function LandscapeSceneView({
  mode,
  readout,
  rush,
  detail,
  seed,
  nav,
  world,
  showWater,
  architecture,
  placing,
  onPlace,
  picking,
  onPick,
  onOrbit,
  presetKey,
}: {
  world: World
  showWater: boolean
  architecture: ArchitectureVariant
  placing: boolean
  onPlace: (placement: Placement) => void
  /** Approach is asking where to look: the terrain follows the pointer with a target area, and a click picks it. */
  picking: boolean
  onPick: (x: number, z: number) => void
  onOrbit: () => void
  presetKey: number
  mode: ViewMode
  readout: TerrainReadout
  rush: MutableRefObject<boolean>
  detail: MutableRefObject<DetailLevel>
  seed: number
  nav: MutableRefObject<Navigation>
}) {
  const focus = useRef<Focus>({ x: 0, z: 0, yaw: HOME.yaw, pitch: HOME.pitch })
  const place = useRef(new Vector3(0, 0, 0))
  const opening = useRef(overviewPose(0, 0))
  const target = useRef(new Vector3(...opening.current.target))
  // Whatever architecture is drawn lives under this group; vegetation reads its footprint, shade and shelter from it (vegHabitat.ts).
  const architectureRoot = useRef<Group | null>(null)
  const groundRoot = useRef<Group | null>(null)
  const lifeRoot = useRef<Group | null>(null)
  const waterRoot = useRef<Group | null>(null)
  // The visual filter's and data view's switches, folded into the shaders (visualStyle.ts): rebuilt when one changes.
  useFrame(syncStyleSwitches)
  return (
    <>
      <Atmosphere mode={mode} />
      <Sky place={place} readout={readout} />
      {/* Round 08G: the sun is not drawn for now (its direction and light are unchanged); set SHOW_SUN to bring the discs back. */}
      {SHOW_SUN ? (mode === 'explore' ? <SunDisc /> : <SunOrrery />) : null}
      <Rain key={`rain-${seed}`} place={place} water={world.water} />
      <WindTracers />
      <LandscapeRig mode={mode} focus={focus} place={place} nav={nav} onOrbit={onOrbit} presetKey={presetKey} />
      {/* (Grouped so the /preview site's World Formation can stand its construction in for them: formationLayer.tsx.) */}
      <group ref={groundRoot}>
        <TerrainField key={`terrain-${seed}`} readout={readout} rush={rush} place={place} detail={detail} />
        <IslandShell key={`shell-${seed}`} />
      </group>
      <FormationLayer key={`formation-${seed}`} world={world} ground={groundRoot} architecture={architectureRoot} life={lifeRoot} water={waterRoot} />
      <group ref={architectureRoot}>
        <LivingArchitecture key={`architecture-${seed}`} world={world} variant={architecture} />
      </group>
      {/* (Grouped so World Formation can keep the island's life out of sight until its stage: formationLayer.tsx.) */}
      <group ref={lifeRoot}>
        <Vegetation key={`vegetation-${seed}`} world={world} root={architectureRoot} />
        <WorldPlants key={`plants-${seed}`} world={world} root={architectureRoot} />
        <Creatures key={`creatures-${seed}`} world={world} nav={nav} root={architectureRoot} />
      </group>
      <PlacementCursor active={placing} water={world.water} onPlace={onPlace} />
      <PlacementCursor kind="look" active={picking} water={world.water} onPlace={(p) => onPick(p.x, p.z)} />
      {/* (Grouped so World Formation can hold the water back until its stage without touching Explore's own Water switch: formationLayer.tsx.) */}
      <group ref={waterRoot}>
        <WaterLayer key={`water-${seed}`} water={world.water} rivers={world.rivers} visible={showWater} />
        {/* Explore's Water flow: particles down the rivers (drawn only while that lens is on). */}
        <FlowParticles key={`flow-${seed}`} world={world} />
      </group>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        target={target.current}
        minPolarAngle={0.2}
        maxPolarAngle={1.38}
        minDistance={ORBIT_DISTANCE.min}
        maxDistance={ORBIT_DISTANCE.max}
        enableZoom={false}
      />
    </>
  )
}
