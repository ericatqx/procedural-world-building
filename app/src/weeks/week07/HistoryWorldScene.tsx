import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  LatheGeometry,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector2,
  Vector3,
  type InstancedMesh,
  type Material,
  type PerspectiveCamera,
} from 'three'
import {
  advanceWaterTime,
  createArchitectureMaterial,
  createPathMaterial,
  createTerrainMaterial,
  createVegetationMaterial,
  createWaterMaterial,
  setTerrainDisplay,
} from '../../project/materials.ts'
import { createStudyTerrain } from '../week06/studyTerrain.ts'
import { GROWN_HOURS, standingGeometry } from './architecture.ts'
import { HISTORY_COLORS } from './historyColors.ts'
import { HALF, type World } from './historyWorld.ts'
import { plantFormGeometry, PLANT_FORMS, type PlantFormName } from './plantForms.ts'
import {
  blankField,
  deadPlacements,
  floodGeometry,
  formerShore,
  formerStructure,
  habitatField,
  hash,
  pointOnRoute,
  routeBands,
  routeGraph,
  routeLine,
  rubblePlacements,
  setWorldFields,
  tracesBlock,
  troddenGeometry,
  worldField,
  type Placement,
  type RouteLine,
} from './worldMeshes.ts'
import { plantPlacements } from './vegetationLayout.ts'

/**
 * Week 07 Branching Histories — the selected node's own world, drawn with
 * the Project's materials on the Week 06 study block. WORLD is what exists
 * now: the ground stained by habitat (lichen where creatures could live; a
 * ghost of hatching where the history before it had habitat this one
 * lost), water, the standing structure, rubble, both vegetation strategies,
 * creatures on their routes, worn paths and ground trodden bare. TRACES dims the present and draws
 * the evidence of how it came to be: the former structure, rubble, ground
 * that lost its shelter, every route walked (trodden corridors widest,
 * overgrown ones in the vegetation's colour), dead vegetation, and where
 * the water spread, the shore it had before.
 */

export type HistoryView = 'world' | 'traces'

/** Simulated hours per history step, so the structure ages as a history runs on. */
const HOURS_PER_STEP = 8

/* ─── Instanced things ────────────────────────────────────────────────── */

const scratch = {
  m: new Matrix4(),
  q: new Quaternion(),
  tilt: new Quaternion(),
  v: new Vector3(),
  s: new Vector3(),
  axis: new Vector3(),
}

function writePlacements(mesh: InstancedMesh, items: readonly Placement[]) {
  items.forEach((item, k) => {
    scratch.q.setFromAxisAngle(scratch.axis.set(0, 1, 0), item.yaw ?? 0)
    if (item.tilt) {
      scratch.q.multiply(scratch.tilt.setFromAxisAngle(scratch.axis.set(1, 0, 0), item.tilt))
    }
    scratch.m.compose(scratch.v.set(...item.p), scratch.q, scratch.s.set(...item.s))
    mesh.setMatrixAt(k, scratch.m)
  })
  mesh.count = items.length
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
}

function Instances({
  items,
  children,
  shadows = true,
}: {
  items: readonly Placement[]
  children: ReactNode
  shadows?: boolean
}) {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    if (ref.current) {
      writePlacements(ref.current, items)
    }
  }, [items])
  if (items.length === 0) {
    return null
  }
  return (
    <instancedMesh
      key={items.length}
      ref={ref}
      args={[undefined, undefined, items.length]}
      castShadow={shadows}
      receiveShadow={shadows}
      frustumCulled={false}
    >
      {children}
    </instancedMesh>
  )
}

/** One plant form, instanced, each instance carrying its plant data for the vegetation material. */
function Plants({
  geometry,
  items,
  plant,
  material,
  shadows,
}: {
  geometry: BufferGeometry
  items: readonly Placement[]
  plant: Float32Array
  material: Material
  shadows: boolean
}) {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    if (ref.current) {
      geometry.setAttribute('aPlant', new InstancedBufferAttribute(plant, 4))
      writePlacements(ref.current, items)
    }
  }, [geometry, items, plant])
  if (items.length === 0) {
    return null
  }
  return (
    <instancedMesh
      key={items.length}
      ref={ref}
      args={[geometry, material, items.length]}
      castShadow={shadows}
      receiveShadow={shadows}
      frustumCulled={false}
    />
  )
}

/* ─── Creatures: abstract bodies walking their routes ─────────────────── */

const CREATURE = {
  speed: 0.3,
  pause: 1.1,
  length: 0.17,
  trail: 0.36,
  trailWidth: 0.016,
  trailSamples: 14,
  /** Where along the body (−0.5 tail … 0.5 nose) the darker fore part begins. */
  fore: 0.22,
  foreTone: 0.42,
} as const

/**
 * A low, two-part body along +X: a broad rear tapering to a point behind,
 * a waist, and a smaller, darker fore part, so its heading reads from above.
 */
function creatureBody(): BufferGeometry {
  const profile = [
    [0, -0.5],
    [0.07, -0.44],
    [0.19, -0.3],
    [0.27, -0.1],
    [0.27, 0.05],
    [0.2, 0.17],
    [0.13, 0.24],
    [0.17, 0.32],
    [0.16, 0.42],
    [0.08, 0.5],
    [0, 0.52],
  ].map(([r, y]) => new Vector2(r, y))
  const geometry = new LatheGeometry(profile, 16)
  geometry.rotateZ(-Math.PI / 2)
  geometry.scale(1, 0.5, 0.75)
  const position = geometry.getAttribute('position')
  const tone = new Float32Array(position.count * 3)
  for (let v = 0; v < position.count; v++) {
    const t = position.getX(v) > CREATURE.fore ? CREATURE.foreTone : 1
    tone.set([t, t, t], v * 3)
  }
  geometry.setAttribute('color', new BufferAttribute(tone, 3))
  geometry.translate(0, 0.12, 0)
  return geometry
}

type Walker = { x: number; y: number; z: number; dx: number; dz: number }
const walker: Walker = { x: 0, y: 0, z: 0, dx: 1, dz: 0 }

/** Where a creature is on its route at `time`: walking out to water, pausing, walking home, pausing. */
function walkerState(line: RouteLine, k: number, time: number, at: Walker) {
  const walk = line.length / CREATURE.speed
  const cycle = 2 * (walk + CREATURE.pause)
  const t = (time + hash(k * 97 + 5) * cycle) % cycle
  let s: number
  let heading: 1 | -1
  let turn = 0
  let moving = 1
  if (t < walk) {
    s = t * CREATURE.speed
    heading = 1
  } else if (t < walk + CREATURE.pause) {
    s = line.length
    heading = 1
    turn = (t - walk) / CREATURE.pause
    moving = 0
  } else if (t < 2 * walk + CREATURE.pause) {
    s = line.length - (t - walk - CREATURE.pause) * CREATURE.speed
    heading = -1
  } else {
    s = 0
    heading = -1
    turn = (t - 2 * walk - CREATURE.pause) / CREATURE.pause
    moving = 0
  }
  pointOnRoute(line, s, at)
  let yaw = Math.atan2(-at.dz * heading, at.dx * heading)
  yaw += Math.PI * turn * turn * (3 - 2 * turn)
  return { s, heading, yaw, moving, sinceStop: moving ? 0 : turn }
}

function Creatures({ lines }: { lines: readonly RouteLine[] }) {
  const body = useRef<InstancedMesh>(null)
  const trail = useRef<BufferGeometry>(null)
  const geometry = useMemo(() => creatureBody(), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  const buffers = useMemo(() => {
    const vertices = lines.length * CREATURE.trailSamples * 2
    const index: number[] = []
    for (let k = 0; k < lines.length; k++) {
      for (let i = 0; i < CREATURE.trailSamples - 1; i++) {
        const a = (k * CREATURE.trailSamples + i) * 2
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    return { position: new Float32Array(vertices * 3), color: new Float32Array(vertices * 4), index }
  }, [lines])
  useLayoutEffect(() => {
    const g = trail.current
    if (!g) {
      return
    }
    g.setAttribute('position', new BufferAttribute(buffers.position, 3).setUsage(DynamicDrawUsage))
    g.setAttribute('color', new BufferAttribute(buffers.color, 4).setUsage(DynamicDrawUsage))
    g.setIndex(buffers.index)
  }, [buffers])

  useFrame(({ clock }) => {
    const at = walker
    const mesh = body.current
    const g = trail.current
    if (!mesh || !g) {
      return
    }
    const time = clock.elapsedTime
    lines.forEach((line, k) => {
      const state = walkerState(line, k, time, at)
      const bob = 0.005 * Math.abs(Math.sin(state.s * 55)) * state.moving
      scratch.q.setFromAxisAngle(scratch.axis.set(0, 1, 0), state.yaw)
      scratch.m.compose(scratch.v.set(at.x, at.y + bob, at.z), scratch.q, scratch.s.setScalar(CREATURE.length))
      mesh.setMatrixAt(k, scratch.m)

      const length = CREATURE.trail * Math.max(0, 1 - 2 * state.sinceStop)
      for (let i = 0; i < CREATURE.trailSamples; i++) {
        const f = i / (CREATURE.trailSamples - 1)
        pointOnRoute(line, state.s - state.heading * (0.02 + length * f), at)
        const norm = Math.hypot(at.dx, at.dz) || 1
        const width = CREATURE.trailWidth * (1 - f)
        const sx = (-at.dz / norm) * width
        const sz = (at.dx / norm) * width
        const v = (k * CREATURE.trailSamples + i) * 2
        buffers.position.set([at.x - sx, at.y + 0.006, at.z - sz, at.x + sx, at.y + 0.006, at.z + sz], v * 3)
        const alpha = 0.55 * (1 - f) * (length > 0 ? 1 : 0)
        buffers.color.set([1, 1, 1, alpha, 1, 1, 1, alpha], v * 4)
      }
    })
    mesh.instanceMatrix.needsUpdate = true
    g.getAttribute('position').needsUpdate = true
    g.getAttribute('color').needsUpdate = true
  })
  if (lines.length === 0) {
    return null
  }
  return (
    <>
      <instancedMesh key={lines.length} ref={body} args={[geometry, undefined, lines.length]} castShadow frustumCulled={false}>
        <meshStandardMaterial vertexColors color={HISTORY_COLORS.creature} emissive={HISTORY_COLORS.creature} emissiveIntensity={0.12} roughness={0.55} />
      </instancedMesh>
      <mesh frustumCulled={false} renderOrder={2}>
        <bufferGeometry ref={trail} />
        <meshBasicMaterial color={HISTORY_COLORS.creature} vertexColors transparent depthWrite={false} side={DoubleSide} />
      </mesh>
    </>
  )
}

/* ─── Framing ─────────────────────────────────────────────────────────── */

/** Matches the page layout: the tree's width on the left, the panel's on the right (system.css, week07.css). */
const FRAME = { edge: 24, tree: 540, panel: 248, stacked: 720 } as const

export type Framing = { tree: boolean; panel: boolean }

/**
 * Keeps the world centred in the space the tree and the panel leave free,
 * by sliding the film rather than the camera, so orbiting still turns
 * about the site.
 */
function frameCamera(camera: PerspectiveCamera, width: number, framing: Framing) {
  let shift = 0
  if (width > FRAME.stacked) {
    const treeRight = framing.tree ? FRAME.edge + Math.min(FRAME.tree, width - FRAME.panel - 3 * FRAME.edge) : 0
    const panelLeft = framing.panel ? width - FRAME.edge - FRAME.panel : width
    shift = ((treeRight + panelLeft) / 2 - width / 2) / width
  }
  const offset = -shift * camera.getFilmWidth()
  if (Math.abs(camera.filmOffset - offset) > 1e-3) {
    camera.filmOffset = offset
    camera.updateProjectionMatrix()
  }
}

/* ─── The world ───────────────────────────────────────────────────────── */

/** Built once: the Week 06 block and its lake do not change between histories. */
function useSiteMeshes() {
  const meshes = useMemo(
    () => ({
      block: createStudyTerrain(),
      plants: Object.fromEntries(
        (Object.keys(PLANT_FORMS) as PlantFormName[]).map((name) => [name, plantFormGeometry(name)]),
      ) as Record<PlantFormName, BufferGeometry>,
    }),
    [],
  )
  const materials = useMemo(() => {
    const blank = blankField()
    return {
      blank,
      terrain: createTerrainMaterial(blank, blank, HALF),
      architecture: createArchitectureMaterial(blank, HALF),
      water: createWaterMaterial(),
      vegetation: createVegetationMaterial(),
      dimVegetation: new MeshStandardMaterial({ color: HISTORY_COLORS.vegetationDim, roughness: 0.9, side: DoubleSide }),
      path: createPathMaterial(),
    }
  }, [])
  useEffect(
    () => () => {
      meshes.block.geometry.dispose()
      meshes.block.water.dispose()
      meshes.block.field.dispose()
      meshes.block.habitatField.dispose()
      Object.values(meshes.plants).forEach((g) => g.dispose())
      materials.blank.dispose()
      materials.terrain.material.dispose()
      materials.architecture.material.dispose()
      materials.water.material.dispose()
      materials.vegetation.dispose()
      materials.dimVegetation.dispose()
      materials.path.dispose()
    },
    [meshes, materials],
  )
  useLayoutEffect(
    () => setTerrainDisplay(materials.terrain, { habitat: true, fieldOnly: false, contours: false, wireframe: false }),
    [materials],
  )
  useFrame((_, delta) => advanceWaterTime(materials.water, delta))
  return { meshes, materials }
}

export function HistoryWorldScene({
  world,
  before,
  view,
  framing,
}: {
  world: World
  /** The world of the history before this one, for the habitat it has since gained or lost. */
  before: World | null
  view: HistoryView
  framing: Framing
}) {
  const traces = view === 'traces'
  const camera = useThree((state) => state.camera) as PerspectiveCamera
  const width = useThree((state) => state.size.width)
  useFrame(() => frameCamera(camera, width, framing))

  const { meshes, materials } = useSiteMeshes()

  const fields = useMemo(() => ({ world: worldField(world), habitat: habitatField(world, before) }), [world, before])
  useLayoutEffect(() => {
    setWorldFields(
      materials.terrain,
      materials.architecture,
      fields.world,
      fields.habitat,
      GROWN_HOURS + world.step * HOURS_PER_STEP,
    )
    return () => {
      fields.world.dispose()
      fields.habitat.dispose()
    }
  }, [materials, fields, world])

  const lines = useMemo(() => world.routes.filter((r) => r.length > 1).map(routeLine), [world])
  const geometry = useMemo(
    () => ({
      structure: standingGeometry(world.voxels),
      flood: floodGeometry(world),
      trodden: troddenGeometry(world),
      bands: routeBands(lines),
      graph: routeGraph(world),
      former: formerStructure(world),
      shore: formerShore(world),
    }),
    [world, lines],
  )
  useEffect(
    () => () => {
      Object.values(geometry).forEach((g) => g?.dispose())
    },
    [geometry],
  )
  const placements = useMemo(
    () => ({ rubble: rubblePlacements(world), dead: deadPlacements(world), plants: plantPlacements(world) }),
    [world],
  )

  const tracesGround = useMemo(() => (traces ? tracesBlock(meshes.block.geometry, world) : null), [traces, meshes, world])
  useEffect(() => () => tracesGround?.dispose(), [tracesGround])

  return (
    <group>
      {tracesGround ? (
        <mesh key="ground-traces" geometry={tracesGround} receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.95} />
        </mesh>
      ) : (
        <mesh key="ground-world" geometry={meshes.block.geometry} material={materials.terrain.material} castShadow receiveShadow />
      )}

      {traces ? (
        <>
          <mesh key="water-traces" geometry={meshes.block.water}>
            <meshStandardMaterial color={HISTORY_COLORS.waterDeep} transparent opacity={0.35} roughness={0.9} side={DoubleSide} />
          </mesh>
          {geometry.flood ? (
            <mesh key="flood-traces" geometry={geometry.flood}>
              <meshStandardMaterial
                color={HISTORY_COLORS.newWater}
                emissive={HISTORY_COLORS.newWater}
                emissiveIntensity={0.35}
                transparent
                opacity={0.7}
                roughness={0.9}
              />
            </mesh>
          ) : null}
          {geometry.shore ? (
            <lineSegments key="shore-traces" geometry={geometry.shore}>
              <lineBasicMaterial color={HISTORY_COLORS.formerShore} transparent opacity={0.85} depthWrite={false} />
            </lineSegments>
          ) : null}
        </>
      ) : (
        <>
          <mesh key="water-world" geometry={meshes.block.water} material={materials.water.material} receiveShadow />
          {geometry.flood ? (
            <mesh key="flood-world" geometry={geometry.flood} material={materials.water.material} receiveShadow />
          ) : null}
        </>
      )}

      {traces ? (
        <>
          <mesh key="structure-traces" geometry={geometry.structure}>
            <meshStandardMaterial color={HISTORY_COLORS.ghost} roughness={0.9} transparent opacity={0.16} depthWrite={false} />
          </mesh>
          <lineSegments geometry={geometry.former}>
            <lineBasicMaterial color={HISTORY_COLORS.formerStructure} transparent opacity={0.5} depthWrite={false} />
          </lineSegments>
        </>
      ) : (
        <mesh
          key="structure-world"
          geometry={geometry.structure}
          material={materials.architecture.material}
          castShadow
          receiveShadow
        />
      )}

      <Instances key={traces ? 'rubble-traces' : 'rubble-world'} items={placements.rubble}>
        <boxGeometry />
        <meshStandardMaterial
          color={traces ? HISTORY_COLORS.rubbleTrace : HISTORY_COLORS.rubble}
          emissive={traces ? HISTORY_COLORS.rubbleTrace : '#000000'}
          emissiveIntensity={traces ? 0.3 : 0}
          roughness={1}
        />
      </Instances>

      {(Object.keys(PLANT_FORMS) as PlantFormName[]).map((name) => (
        <Plants
          key={`${name}-${traces ? 'traces' : 'world'}`}
          geometry={meshes.plants[name]}
          items={placements.plants[name].items}
          plant={placements.plants[name].plant}
          material={traces ? materials.dimVegetation : materials.vegetation}
          shadows={!traces}
        />
      ))}

      {traces ? (
        <>
          <Instances items={placements.dead} shadows={false}>
            <boxGeometry />
            <meshStandardMaterial color={HISTORY_COLORS.deadVegetation} emissive={HISTORY_COLORS.deadVegetation} emissiveIntensity={0.2} />
          </Instances>
          <mesh geometry={geometry.graph} frustumCulled={false} renderOrder={2}>
            <meshBasicMaterial
              vertexColors
              transparent
              opacity={0.95}
              depthWrite={false}
              side={DoubleSide}
              polygonOffset
              polygonOffsetFactor={-2}
            />
          </mesh>
        </>
      ) : (
        <>
          {geometry.trodden ? (
            <mesh geometry={geometry.trodden} receiveShadow>
              <meshStandardMaterial
                color={HISTORY_COLORS.trodden}
                roughness={1}
                transparent
                opacity={0.75}
                depthWrite={false}
                polygonOffset
                polygonOffsetFactor={-1}
              />
            </mesh>
          ) : null}
          <mesh geometry={geometry.bands} material={materials.path} receiveShadow />
          <Creatures lines={lines} />
        </>
      )}
    </group>
  )
}
