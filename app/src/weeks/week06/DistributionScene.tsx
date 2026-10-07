import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
  type Material,
} from 'three'
import { createVegetationForms, disposeVegetationForms } from '../../project/botany.ts'
import { GRID_EXTENT, sampleGrid } from '../../project/grid.ts'
import type { Hydrology } from '../../project/hydrology.ts'
import {
  advanceWaterTime,
  createArchitectureMaterial,
  createTerrainMaterial,
  createVegetationMaterial,
  createWaterMaterial,
  setArchitectureClock,
  setTerrainDisplay,
  setWaterContours,
} from '../../project/materials.ts'
import type { Plant } from '../../project/vegetation.ts'
import { COLONY_FORMS, createColonyGeometry, createStructureMassGeometry, type ColonyForm } from './assets.ts'
import {
  ANALYSIS_COLORS,
  COLONY_RADIUS,
  LAYERS,
  PLANT_HEIGHT,
  structureBlockers,
  type Candidate,
  type CandidateStatus,
  type Environment,
  type LayerId,
  type LayerSettingsMap,
  type Placement,
} from './distribution.ts'
import { structureMass } from './structureForms.ts'
import { isWaterAt, STUDY_HALF } from './studyTerrain.ts'

export type DistributionView = 'world' | 'analysis'

const STATUS_COLOR: Record<Exclude<CandidateStatus, 'accepted'>, string> = {
  rejected: ANALYSIS_COLORS.rejected,
  spacing: ANALYSIS_COLORS.rejected,
  invalid: ANALYSIS_COLORS.inactive,
  unsupported: ANALYSIS_COLORS.inactive,
  blocked: ANALYSIS_COLORS.inactive,
  unused: ANALYSIS_COLORS.inactive,
}

/** Mark sizes in world units: candidates grow with their weight. */
const MARK = { min: 0.01, range: 0.024, accepted: 0.022, other: 0.012, lift: 0.012 } as const
const SLOPE_STEP = 0.02
/** Plant vigour: opens the forms' blades and adds satellites, so each point reads as a full clump. */
const PLANT_VIGOUR = { min: 0.8, range: 0.2 } as const
/** Lower companions around each placed plant, their size relative to it, and how far out they stand. */
const CLUMP = { companions: 3, minScale: 0.45, maxScale: 0.8, minReach: 0.035, maxReach: 0.09, rim: 0.98 } as const

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

type Instance = {
  x: number
  y: number
  z: number
  turn?: number
  scale: number
  /** Lay the instance on the ground's slope instead of standing upright. */
  normal?: Vector3
  color?: string
}

/** One instanced mesh for a list of placements; rebuilt when the list changes. */
function Instances({
  geometry,
  material,
  items,
  shadows = false,
}: {
  geometry: BufferGeometry
  material: Material
  items: readonly Instance[]
  shadows?: boolean
}) {
  const mesh = useMemo(() => {
    const instanced = new InstancedMesh(geometry, material, Math.max(1, items.length))
    instanced.count = items.length
    instanced.castShadow = shadows
    instanced.receiveShadow = shadows
    const matrix = new Matrix4()
    const rotation = new Quaternion()
    const turn = new Quaternion()
    const up = new Vector3(0, 1, 0)
    const position = new Vector3()
    const scale = new Vector3()
    const color = new Color()
    items.forEach((item, index) => {
      rotation.identity()
      if (item.normal) {
        rotation.setFromUnitVectors(up, item.normal)
      }
      if (item.turn) {
        rotation.multiply(turn.setFromAxisAngle(up, item.turn))
      }
      position.set(item.x, item.y, item.z)
      scale.setScalar(item.scale)
      instanced.setMatrixAt(index, matrix.compose(position, rotation, scale))
      if (item.color) {
        instanced.setColorAt(index, color.set(item.color))
      }
    })
    instanced.instanceMatrix.needsUpdate = true
    if (instanced.instanceColor) {
      instanced.instanceColor.needsUpdate = true
    }
    return instanced
  }, [geometry, material, items, shadows])

  useEffect(() => () => mesh.dispose(), [mesh])

  return <primitive object={mesh} />
}

type GroundHeight = (x: number, z: number) => number

function groundNormal(groundHeight: GroundHeight, x: number, z: number): Vector3 {
  const dx = (groundHeight(x + SLOPE_STEP, z) - groundHeight(x - SLOPE_STEP, z)) / (2 * SLOPE_STEP)
  const dz = (groundHeight(x, z + SLOPE_STEP) - groundHeight(x, z - SLOPE_STEP)) / (2 * SLOPE_STEP)
  return new Vector3(-dx, 1, -dz).normalize()
}

/** An analysis mark lying on the ground at a candidate. */
const mark = (groundHeight: GroundHeight, c: Candidate, scale: number, color: string, lift = 0): Instance => ({
  x: c.x,
  y: groundHeight(c.x, c.z) + MARK.lift + lift,
  z: c.z,
  scale,
  normal: groundNormal(groundHeight, c.x, c.z),
  color,
})

/** The placed assets: structures, the Project's plant forms, colonies. */
function WorldAssets({
  env,
  placements,
  layers,
}: {
  env: Environment
  placements: Record<LayerId, Placement>
  layers: LayerSettingsMap
}) {
  const { groundHeight, waterDistance, field } = env.terrain
  const forms = useMemo(
    () => ({
      colonies: Object.fromEntries(COLONY_FORMS.map((form) => [form, createColonyGeometry(form)])) as Record<
        ColonyForm,
        BufferGeometry
      >,
      structureMaterial: createArchitectureMaterial(field, GRID_EXTENT),
      colonyMaterial: new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }),
      vegetationMaterial: createVegetationMaterial(),
    }),
    [field],
  )
  useEffect(
    () => () => {
      for (const geometry of Object.values(forms.colonies)) {
        geometry.dispose()
      }
      forms.structureMaterial.material.dispose()
      forms.colonyMaterial.dispose()
      forms.vegetationMaterial.dispose()
    },
    [forms],
  )
  // Ages are baked into the blocks as hours before a clock of 0.
  useLayoutEffect(() => setArchitectureClock(forms.structureMaterial, 0), [forms])

  const structures = useMemo(
    () =>
      createStructureMassGeometry(
        placements.structures.accepted.map((s) => structureMass(groundHeight, s)),
        groundHeight,
      ),
    [placements.structures, groundHeight],
  )
  useEffect(() => () => structures.dispose(), [structures])

  /** Each colony lies on the slope, its form picked by its variety draw. */
  const colonies = useMemo(() => {
    const byForm = Object.fromEntries(COLONY_FORMS.map((form) => [form, [] as Instance[]])) as Record<
      ColonyForm,
      Instance[]
    >
    for (const c of placements.colonies.accepted) {
      const form = COLONY_FORMS[Math.min(COLONY_FORMS.length - 1, Math.floor(c.variety * COLONY_FORMS.length))]!
      byForm[form].push({
        x: c.x,
        y: groundHeight(c.x, c.z),
        z: c.z,
        turn: c.turn,
        scale: COLONY_RADIUS * c.scale,
        normal: groundNormal(groundHeight, c.x, c.z),
      })
    }
    return byForm
  }, [placements.colonies, groundHeight])

  const blockers = useMemo(
    () => (layers.structures.enabled ? structureBlockers(env, placements.structures.accepted) : []),
    [env, layers.structures.enabled, placements.structures],
  )

  /**
   * Each placed point is a clump: its plant, with a few lower companions
   * around it on the same valid ground, so the layer reads as cover.
   */
  const vegetation = useMemo(() => {
    const { accepted, lightField } = placements.vegetation
    const plant = (x: number, z: number, height: number, seed: number): Plant => ({
      x,
      y: groundHeight(x, z),
      z,
      height,
      seed,
      moisture: sampleGrid(env.moisture, x, z),
      light: Math.min(1, Math.max(0, sampleGrid(lightField, x, z))),
      vigour: PLANT_VIGOUR.min + PLANT_VIGOUR.range * seed,
    })
    const plants: Plant[] = []
    for (const p of accepted) {
      const height = PLANT_HEIGHT * p.scale
      plants.push(plant(p.x, p.z, height, p.variety))
      for (let k = 0; k < CLUMP.companions; k += 1) {
        const h = hash(p.variety * 53.7 + k * 9.1)
        const angle = p.turn + (k / CLUMP.companions) * 2 * Math.PI + h
        const reach = CLUMP.minReach + (CLUMP.maxReach - CLUMP.minReach) * hash(h * 17.3)
        const x = p.x + Math.cos(angle) * reach
        const z = p.z + Math.sin(angle) * reach
        const valid =
          Math.max(Math.abs(x), Math.abs(z)) < STUDY_HALF * CLUMP.rim &&
          (layers.vegetation.onWater || !isWaterAt(x, z)) &&
          !blockers.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1)
        if (valid) {
          plants.push(plant(x, z, height * (CLUMP.minScale + (CLUMP.maxScale - CLUMP.minScale) * h), hash(h * 5.3)))
        }
      }
    }
    // The plant forms read only the water distance, to keep satellites off the water.
    return createVegetationForms(plants, forms.vegetationMaterial, { waterDistance } as Hydrology, groundHeight)
  }, [placements.vegetation, layers.vegetation.onWater, blockers, forms, env.moisture, waterDistance, groundHeight])
  useEffect(() => () => disposeVegetationForms(vegetation), [vegetation])

  return (
    <>
      {layers.structures.enabled ? (
        <mesh geometry={structures} material={forms.structureMaterial.material} castShadow receiveShadow />
      ) : null}
      {layers.vegetation.enabled ? <primitive object={vegetation} /> : null}
      {layers.colonies.enabled
        ? COLONY_FORMS.map((form) => (
            <Instances
              key={form}
              geometry={forms.colonies[form]}
              material={forms.colonyMaterial}
              items={colonies[form]}
            />
          ))
        : null}
    </>
  )
}

/**
 * The landmass sharing the terrain's buffers, coloured by a field and a fixed
 * hillshade. Water is drawn as invalid ground unless the layer may stand on it.
 */
function FieldTerrain({
  env,
  values,
  waterInvalid,
  wireframe,
}: {
  env: Environment
  values: Float32Array
  waterInvalid: boolean
  wireframe: boolean
}) {
  const source = env.terrain.geometry
  const geometry = useMemo(() => {
    const shared = new BufferGeometry()
    shared.setAttribute('position', source.getAttribute('position'))
    shared.setAttribute('normal', source.getAttribute('normal'))
    shared.setIndex(source.getIndex())
    shared.setAttribute(
      'color',
      new BufferAttribute(new Float32Array(source.getAttribute('position').count * 3), 3),
    )
    return shared
  }, [source])
  useLayoutEffect(() => {
    const position = source.getAttribute('position')
    const normal = source.getAttribute('normal')
    const below = source.getAttribute('aBelow')
    const color = geometry.getAttribute('color') as BufferAttribute
    const low = new Color(ANALYSIS_COLORS.fieldLow)
    const high = new Color(ANALYSIS_COLORS.fieldHigh)
    const cliff = new Color(ANALYSIS_COLORS.cliff)
    const invalid = new Color(ANALYSIS_COLORS.invalid)
    const mixed = new Color()
    for (let i = 0; i < position.count; i += 1) {
      const shade = 0.7 + 0.3 * Math.max(0, normal.getY(i))
      const x = position.getX(i)
      const z = position.getZ(i)
      if (below.getX(i) > 1e-4) {
        mixed.copy(cliff)
      } else if (waterInvalid && isWaterAt(x, z)) {
        mixed.copy(invalid)
      } else {
        mixed.copy(low).lerp(high, Math.min(1, Math.max(0, sampleGrid(values, x, z))))
      }
      color.setXYZ(i, mixed.r * shade, mixed.g * shade, mixed.b * shade)
    }
    color.needsUpdate = true
  }, [geometry, source, values, waterInvalid])

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial vertexColors wireframe={wireframe} />
    </mesh>
  )
}

/** Candidates as rings sized by weight; kept points as filled marks. */
function AnalysisMarks({
  env,
  placements,
  layers,
  focus,
  showCandidates,
  showAccepted,
}: {
  env: Environment
  placements: Record<LayerId, Placement>
  layers: LayerSettingsMap
  focus: LayerId
  showCandidates: boolean
  showAccepted: boolean
}) {
  const { groundHeight } = env.terrain
  const shapes = useMemo(() => {
    const ring = new RingGeometry(0.7, 1, 20).rotateX(-Math.PI / 2)
    const disc = new CircleGeometry(1, 20).rotateX(-Math.PI / 2)
    const material = new MeshBasicMaterial({ polygonOffset: true, polygonOffsetFactor: -2 })
    return { ring, disc, material }
  }, [])
  useEffect(
    () => () => {
      shapes.ring.dispose()
      shapes.disc.dispose()
      shapes.material.dispose()
    },
    [shapes],
  )

  const candidates = useMemo(
    () =>
      placements[focus].candidates.flatMap((c) =>
        c.status === 'accepted'
          ? []
          : [mark(groundHeight, c, MARK.min + MARK.range * Math.sqrt(c.weight), STATUS_COLOR[c.status])],
      ),
    [placements, focus, groundHeight],
  )

  const accepted = useMemo(
    () =>
      LAYERS.flatMap((layer) => {
        if (layer !== focus && !layers[layer].enabled) {
          return []
        }
        const isFocus = layer === focus
        return placements[layer].accepted.map((c) =>
          isFocus
            ? mark(groundHeight, c, MARK.accepted, ANALYSIS_COLORS.accepted, 0.002)
            : mark(groundHeight, c, MARK.other, ANALYSIS_COLORS.otherAccepted, 0.001),
        )
      }),
    [placements, layers, focus, groundHeight],
  )

  return (
    <>
      {showCandidates ? <Instances geometry={shapes.ring} material={shapes.material} items={candidates} /> : null}
      {showAccepted ? <Instances geometry={shapes.disc} material={shapes.material} items={accepted} /> : null}
    </>
  )
}

export function DistributionScene({
  env,
  view,
  placements,
  layers,
  focus,
  fieldValues,
  showCandidates,
  showAccepted,
  contours,
  wireframe,
}: {
  env: Environment
  view: DistributionView
  placements: Record<LayerId, Placement>
  layers: LayerSettingsMap
  focus: LayerId
  fieldValues: Float32Array
  showCandidates: boolean
  showAccepted: boolean
  contours: boolean
  wireframe: boolean
}) {
  const ground = env.terrain
  const terrain = useMemo(
    () => createTerrainMaterial(ground.field, ground.habitatField, GRID_EXTENT),
    [ground],
  )
  const water = useMemo(() => createWaterMaterial(), [])
  useEffect(
    () => () => {
      terrain.material.dispose()
      water.material.dispose()
    },
    [terrain, water],
  )

  useLayoutEffect(
    () => setTerrainDisplay(terrain, { habitat: false, fieldOnly: false, contours, wireframe }),
    [terrain, contours, wireframe],
  )
  useLayoutEffect(() => setWaterContours(water, contours), [water, contours])
  useFrame((_, delta) => advanceWaterTime(water, delta))

  // Both views stay mounted, so switching does not rebuild materials and plant forms.
  return (
    <>
      <group visible={view === 'world'}>
        <mesh geometry={ground.geometry} material={terrain.material} castShadow receiveShadow />
        <mesh geometry={ground.water} material={water.material} receiveShadow />
        <WorldAssets env={env} placements={placements} layers={layers} />
      </group>
      <group visible={view === 'analysis'}>
        <FieldTerrain
          env={env}
          values={fieldValues}
          waterInvalid={!layers[focus].onWater}
          wireframe={wireframe}
        />
        <AnalysisMarks
          env={env}
          placements={placements}
          layers={layers}
          focus={focus}
          showCandidates={showCandidates}
          showAccepted={showAccepted}
        />
      </group>
    </>
  )
}
