import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { Color, DoubleSide, Fog, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from 'three'
import {
  EYE_HEIGHT,
  LANDSCAPE,
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
  overviewPose,
  type DetailLevel,
} from './terrain.ts'
import { buildChunkGeometry, buildIslandShell, type ChunkNeighbors } from './terrainMesh.ts'
import { WaterLayer } from './WaterLayer.tsx'
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
  teleport: { x: number; z: number } | null
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
  target: Vector3
  minDistance: number
  maxDistance: number
  update: () => void
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

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
  const lods = useRef(new Int8Array(COUNT).fill(-1))
  const meshLods = useRef(new Int8Array(COUNT).fill(-1))
  const seen = useRef({ e: new Int8Array(COUNT), w: new Int8Array(COUNT), n: new Int8Array(COUNT), s: new Int8Array(COUNT) })
  const meshes = useRef<(Mesh | null)[]>(new Array(COUNT).fill(null))
  const ready = useRef(false)

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
    const limit = rush.current ? 12 : 5
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
    readout.camera = camera.position.y
    readout.ground = landscapeHeight(camera.position.x, camera.position.z)
    if (pending === 0) rush.current = false
  })

  return <group ref={group} />

  function neighborsOf(ix: number, iz: number, selfLod: number): ChunkNeighbors {
    const at = (nx: number, nz: number) => {
      if (nx < 0 || nz < 0 || nx >= ACROSS || nz >= ACROSS) return selfLod
      const built = meshLods.current[chunkIndex(nx, nz)]!
      return built < 0 ? selfLod : built
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
      root.add(mesh)
      meshes.current[id] = mesh
    }
    if (existing) existing.geometry = geometry
    meshLods.current[id] = lod
    seen.current.e[id] = neighbors.e
    seen.current.w[id] = neighbors.w
    seen.current.n[id] = neighbors.n
    seen.current.s[id] = neighbors.s
  }
}

function useMemoMaterial() {
  const material = useRef<MeshStandardMaterial>(null)
  if (!material.current) {
    const next = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
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
  const gl = useThree((state) => state.gl)
  useLayoutEffect(() => {
    scene.background = new Color('#050608')
    const fog = FOG[mode]
    scene.fog = new Fog('#050608', fog.near, fog.far)
    gl.toneMappingExposure = 1.05
    return () => {
      scene.fog = null
      scene.background = null
    }
  }, [scene, gl, mode])
  return (
    <>
      {/* Key: a low warm sun, so slopes facing it brighten and the far faces fall into shade. */}
      <directionalLight position={[-2600, 2500, -1300]} intensity={Math.PI * 0.95} color="#fff8ee" />
      {/* Fill: a dim cool light from the opposite side keeps shaded faces readable without lifting the whole scene. */}
      <directionalLight position={[2600, 1300, 1900]} intensity={Math.PI * 0.36} color="#c4bdb2" />
      <hemisphereLight args={['#c2beb6', '#4a443b', 0.32]} />
    </>
  )
}

type Focus = { x: number; z: number; yaw: number; pitch: number }

const HOME = exploreLook(0, 0)

const lookScratch = new Vector3()
const GLIDE_SECONDS = 0.7

function ease(t: number) {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

/** Overview and Approach orbit. Explore walks at 1.6 m. Priority stays at 0 so the canvas still draws. */
export function LandscapeRig({
  mode,
  focus,
  place,
  speed,
  nav,
}: {
  mode: ViewMode
  focus: MutableRefObject<Focus>
  place: MutableRefObject<Vector3>
  speed: MutableRefObject<number>
  nav: MutableRefObject<Navigation>
}) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const controls = useThree((state) => state.controls) as unknown as Orbit | null
  const modeRef = useRef(mode)
  modeRef.current = mode
  const glide = useRef(1)
  const fromPos = useRef(new Vector3())
  const fromAim = useRef(new Vector3())
  const fromYaw = useRef(0)
  const fromPitch = useRef(0)
  const ready = useRef(false)
  const orbiting = useRef(false)
  const explore = useRef({ x: focus.current.x, z: focus.current.z, yaw: focus.current.yaw, pitch: focus.current.pitch })
  const keys = useRef({ forward: 0, strafe: 0 })
  const dragging = useRef(false)

  useLayoutEffect(() => {
    place.current.set(focus.current.x, 0, focus.current.z)
    const cam = camera as PerspectiveCamera
    if (cam.view?.enabled) cam.clearViewOffset()
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
    glide.current = 0
    orbiting.current = false
    if (mode === 'explore') {
      explore.current.x = focus.current.x
      explore.current.z = focus.current.z
      explore.current.yaw = focus.current.yaw
      explore.current.pitch = focus.current.pitch
    }
    if (mode === 'overview') {
      cam.near = 40
      cam.far = 80000
    } else if (mode === 'approach') {
      cam.near = 1
      cam.far = 30000
    } else {
      cam.near = 0.25
      cam.far = 8000
    }
    cam.updateProjectionMatrix()
  }, [mode, camera, focus, place])

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
      const key = event.key.toLowerCase()
      if (!(key in drive) || event.metaKey || event.ctrlKey || event.altKey || editable(event.target)) return
      event.preventDefault()
      held.add(key)
      emit()
    }
    const up = (event: KeyboardEvent) => {
      if (held.delete(event.key.toLowerCase())) emit()
    }
    const clear = () => {
      held.clear()
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
    }
  }, [mode])

  useEffect(() => {
    if (mode !== 'explore') return
    const element = gl.domElement
    let lastX = 0
    let lastY = 0
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      dragging.current = true
      lastX = event.clientX
      lastY = event.clientY
    }
    const move = (event: PointerEvent) => {
      if (!dragging.current || glide.current < 1) return
      explore.current.yaw -= (event.clientX - lastX) * 0.0045
      explore.current.pitch = Math.max(-0.6, Math.min(0.45, explore.current.pitch - (event.clientY - lastY) * 0.0035))
      lastX = event.clientX
      lastY = event.clientY
    }
    const up = () => {
      dragging.current = false
    }
    element.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      element.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      dragging.current = false
    }
  }, [gl, mode])

  useEffect(() => {
    if (!controls) return
    const begin = () => {
      orbiting.current = true
    }
    const finish = () => {
      orbiting.current = false
    }
    controls.addEventListener('start', begin)
    controls.addEventListener('end', finish)
    return () => {
      controls.removeEventListener('start', begin)
      controls.removeEventListener('end', finish)
    }
  }, [controls])

  useFrame((_, delta) => {
    const orbit = controls
    const current = modeRef.current
    const cam = camera as PerspectiveCamera
    if (current !== 'explore') {
      if (!orbit) return
      orbit.enabled = true
      orbit.minDistance = current === 'overview' ? 1600 : 120
      orbit.maxDistance = current === 'overview' ? 32000 : 12000
      if (glide.current < 1 && !orbiting.current) {
        const pose = current === 'overview' ? overviewPose(focus.current.x, focus.current.z) : approachPose(focus.current.x, focus.current.z, focus.current.yaw)
        glide.current = Math.min(1, glide.current + Math.min(delta, 0.05) / GLIDE_SECONDS)
        const t = ease(glide.current)
        camera.up.set(0, 1, 0)
        camera.position.set(
          fromPos.current.x + (pose.position[0] - fromPos.current.x) * t,
          fromPos.current.y + (pose.position[1] - fromPos.current.y) * t,
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
      const dist = Math.max(1, camera.position.distanceTo(orbit.target))
      const near = current === 'overview' ? Math.max(20, dist * 0.015) : Math.max(0.4, dist * 0.004)
      const far = dist * (current === 'overview' ? 6 : 14)
      if (Math.abs(cam.near - near) > near * 0.08) {
        cam.near = near
        cam.far = far
        cam.updateProjectionMatrix()
      }
      if (current === 'overview' && scene.fog instanceof Fog) {
        scene.fog.near = dist * 1.9
        scene.fog.far = dist * 6
      }
      if (current === 'approach' && scene.fog instanceof Fog) {
        scene.fog.near = Math.max(360, dist * 1.05)
        scene.fog.far = Math.max(2400, dist * 4.5)
      }
      return
    }
    if (orbit) orbit.enabled = false
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
      glide.current = 1
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
      nav.current.x = x
      nav.current.z = z
      nav.current.yaw = yaw
      return
    }
    const fx = -Math.sin(pose.yaw)
    const fz = -Math.cos(pose.yaw)
    const rx = Math.cos(pose.yaw)
    const rz = -Math.sin(pose.yaw)
    const stride = WALK_SPEED * speed.current * Math.min(delta, 0.05)
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
  })

  return null
}

function IslandShell() {
  const geometry = useMemo(() => buildIslandShell(), [])
  const material = useMemo(() => {
    const next = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: DoubleSide })
    next.customProgramCacheKey = () => 'shell-fill'
    next.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `vec3 shellNormal = inverseTransformDirection(normal, viewMatrix);
         // Bounce light for the faces the sun cannot reach: a warm glow from low
         // on the sunward side and a cool one from below, over a small base.
         float warm = clamp(dot(shellNormal, normalize(vec3(-0.7, -0.15, -0.5))) * 0.5 + 0.5, 0.0, 1.0);
         float cool = clamp(dot(shellNormal, vec3(0.0, -1.0, 0.0)), 0.0, 1.0);
         outgoingLight += diffuseColor.rgb * (0.2 + warm * 0.5 + cool * 0.22);
         #include <opaque_fragment>`,
      )
    }
    return next
  }, [])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )
  return <mesh geometry={geometry} material={material} />
}

export function LandscapeScene({
  mode,
  readout,
  rush,
  detail,
  seed,
  speed,
  nav,
  world,
  showWater,
}: {
  world: World
  showWater: boolean
  mode: ViewMode
  readout: TerrainReadout
  rush: MutableRefObject<boolean>
  detail: MutableRefObject<DetailLevel>
  seed: number
  speed: MutableRefObject<number>
  nav: MutableRefObject<Navigation>
}) {
  const focus = useRef<Focus>({ x: 0, z: 0, yaw: HOME.yaw, pitch: HOME.pitch })
  const place = useRef(new Vector3(0, 0, 0))
  const opening = useRef(overviewPose(0, 0))
  const target = useRef(new Vector3(...opening.current.target))
  return (
    <>
      <Atmosphere mode={mode} />
      <LandscapeRig mode={mode} focus={focus} place={place} speed={speed} nav={nav} />
      <TerrainField key={seed} readout={readout} rush={rush} place={place} detail={detail} />
      <IslandShell key={seed} />
      <WaterLayer key={seed} water={world.water} visible={showWater} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        target={target.current}
        minPolarAngle={mode === 'overview' ? 0.2 : 0.2}
        maxPolarAngle={mode === 'overview' ? 1.35 : 1.38}
        minDistance={mode === 'overview' ? 1600 : 120}
        maxDistance={mode === 'overview' ? 32000 : 12000}
      />
    </>
  )
}
