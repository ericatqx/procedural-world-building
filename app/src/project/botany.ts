import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type Material,
} from 'three'
import { sampleGrid } from './grid.ts'
import type { Hydrology } from './hydrology.ts'
import type { Plant } from './vegetation.ts'

/**
 * Shadow Ecology — vegetation forms. Each plant from the ecology becomes a
 * small cluster of one abstract botanical form, in unit height and scaled by
 * the plant's height. The form answers where it stands:
 *
 *   frond  wet or shaded ground: low, wide rosettes of long blades
 *   spire  dry, sunlit ground: tall, narrow, few short blades
 *   pod    scattered by seed: bare stems carrying a column of seed heads
 *   tier   the rest: a stem with tiers of blades turning by the golden angle
 *
 * The vegetation material then opens, spreads and droops each one from its
 * moisture, light and vigour (`aPlant`); `aForm` = (part, attachment height,
 * distance along the blade) tells it which part a vertex belongs to.
 */

type Form = {
  stemHeight: number
  stemBase: number
  stemTip: number
  tiers: readonly number[]
  bladesPerTier: number
  bladeReach: number
  /** How much shorter the top tier's blades are than the lowest. */
  bladeTaper: number
  bladeWidth: number
  bladeRise: number
  /** Seed heads as (height, distance from the stem, size). */
  buds: readonly (readonly [number, number, number])[]
}

const FORMS = {
  frond: {
    stemHeight: 0.5,
    stemBase: 0.04,
    stemTip: 0.012,
    tiers: [0.06, 0.16, 0.28, 0.4],
    bladesPerTier: 5,
    bladeReach: 0.62,
    bladeTaper: 0.5,
    bladeWidth: 0.075,
    bladeRise: 0.28,
    buds: [[0.5, 0, 0.035]],
  },
  spire: {
    stemHeight: 0.96,
    stemBase: 0.04,
    stemTip: 0.01,
    tiers: [0.34, 0.52, 0.68, 0.82],
    bladesPerTier: 2,
    bladeReach: 0.16,
    bladeTaper: 0.3,
    bladeWidth: 0.035,
    bladeRise: 0.22,
    buds: [[0.96, 0, 0.05]],
  },
  pod: {
    stemHeight: 0.8,
    stemBase: 0.035,
    stemTip: 0.01,
    tiers: [0.18],
    bladesPerTier: 3,
    bladeReach: 0.3,
    bladeTaper: 0,
    bladeWidth: 0.05,
    bladeRise: 0.1,
    buds: [
      [0.5, 0.05, 0.04],
      [0.6, 0.06, 0.045],
      [0.7, 0.05, 0.05],
      [0.8, 0, 0.06],
    ],
  },
  tier: {
    stemHeight: 0.94,
    stemBase: 0.05,
    stemTip: 0.012,
    tiers: [0.3, 0.5, 0.68, 0.84],
    bladesPerTier: 3,
    bladeReach: 0.36,
    bladeTaper: 0.45,
    bladeWidth: 0.06,
    bladeRise: 0.12,
    buds: [[0.94, 0, 0.05]],
  },
} as const satisfies Record<string, Form>

type FormName = keyof typeof FORMS

const BLADE_SEGMENTS = 4
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const PART = { stem: 0, blade: 1, bud: 2 } as const

/** Satellites per plant at full vigour, their size relative to the plant, and how far out they stand. */
const CLUSTER = { satellites: 4, minScale: 0.4, maxScale: 0.75, minReach: 0.025, maxReach: 0.075 } as const
/** Satellites keep this far from open water. */
const SATELLITE_WATER_CLEARANCE = 0.05

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

function formFor(plant: Plant): FormName {
  const lush = plant.moisture * 0.7 + (1 - plant.light) * 0.5
  if (lush > 0.8) {
    return 'frond'
  }
  if (plant.light > 0.6 && plant.moisture < 0.5) {
    return 'spire'
  }
  return plant.seed < 0.28 ? 'pod' : 'tier'
}

function createFormGeometry(form: Form): BufferGeometry {
  const positions: number[] = []
  const forms: number[] = []
  const emit = (point: Vector3, data: readonly [number, number, number]) => {
    positions.push(point.x, point.y, point.z)
    forms.push(...data)
  }
  const triangle = (points: Vector3[], data: readonly [number, number, number]) => {
    for (const point of points) {
      emit(point, data)
    }
  }
  const ring = (centre: Vector3, radius: number) =>
    [0, 1, 2].map((k) => {
      const angle = (k * 2 * Math.PI) / 3
      return centre.clone().add(new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius))
    })

  const base = ring(new Vector3(), form.stemBase)
  const tip = ring(new Vector3(0, form.stemHeight, 0), form.stemTip)
  for (let k = 0; k < 3; k += 1) {
    const next = (k + 1) % 3
    triangle([base[k]!, base[next]!, tip[next]!], [PART.stem, 0, 0])
    triangle([base[k]!, tip[next]!, tip[k]!], [PART.stem, 0, 0])
  }

  const lastTier = Math.max(1, form.tiers.length - 1)
  for (const [t, attach] of form.tiers.entries()) {
    const reach = form.bladeReach * (1 - (form.bladeTaper * t) / lastTier)
    for (let b = 0; b < form.bladesPerTier; b += 1) {
      const angle = t * GOLDEN_ANGLE + (b * 2 * Math.PI) / form.bladesPerTier
      const out = new Vector3(Math.cos(angle), 0, Math.sin(angle))
      const side = new Vector3(-out.z, 0, out.x)
      const edge = (s: number, sign: number) =>
        out
          .clone()
          .multiplyScalar(reach * s)
          .addScaledVector(side, sign * form.bladeWidth * Math.sin(Math.PI * (0.15 + 0.85 * s)))
          .setY(attach + form.bladeRise * s)
      const at = (s: number) => [PART.blade, attach, s] as const
      for (let i = 0; i < BLADE_SEGMENTS; i += 1) {
        const s0 = i / BLADE_SEGMENTS
        const s1 = (i + 1) / BLADE_SEGMENTS
        emit(edge(s0, -1), at(s0))
        emit(edge(s1, -1), at(s1))
        emit(edge(s1, 1), at(s1))
        emit(edge(s0, -1), at(s0))
        emit(edge(s1, 1), at(s1))
        emit(edge(s0, 1), at(s0))
      }
    }
  }

  for (const [k, [height, offset, size]] of form.buds.entries()) {
    const angle = k * GOLDEN_ANGLE
    const centre = new Vector3(Math.cos(angle) * offset, height, Math.sin(angle) * offset)
    const top = centre.clone().setY(height + 2 * size)
    const around = ring(centre.clone().setY(height + size * 0.8), size)
    for (let i = 0; i < 3; i += 1) {
      const next = (i + 1) % 3
      triangle([centre, around[next]!, around[i]!], [PART.bud, height, 1])
      triangle([around[i]!, around[next]!, top], [PART.bud, height, 1])
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aForm', new Float32BufferAttribute(forms, 3))
  geometry.computeVertexNormals()
  return geometry
}

type Instance = { x: number; y: number; z: number; scale: number; turn: number; plant: Plant }

/**
 * One instanced mesh per form. Each plant stands at its place with up to
 * `CLUSTER.satellites` smaller ones of the same form around it, more where
 * it is more vigorous, so plants gather in clumps.
 */
export function createVegetationForms(
  plants: Plant[],
  material: Material,
  hydrology: Hydrology,
  groundHeight: (x: number, z: number) => number,
): Group {
  const byForm = new Map<FormName, Instance[]>()
  for (const plant of plants) {
    const name = formFor(plant)
    const list = byForm.get(name) ?? []
    byForm.set(name, list)
    list.push({ x: plant.x, y: plant.y, z: plant.z, scale: plant.height, turn: plant.seed * 2 * Math.PI, plant })
    const satellites = Math.floor(plant.vigour * CLUSTER.satellites + plant.seed)
    for (let k = 0; k < satellites; k += 1) {
      const h = hash(plant.seed * 97.3 + k * 13.1)
      const angle = (plant.seed + k / satellites) * 2 * Math.PI + h
      const reach = CLUSTER.minReach + (CLUSTER.maxReach - CLUSTER.minReach) * hash(h * 31.7)
      const x = plant.x + Math.cos(angle) * reach
      const z = plant.z + Math.sin(angle) * reach
      if (sampleGrid(hydrology.waterDistance, x, z) < SATELLITE_WATER_CLEARANCE) {
        continue
      }
      list.push({
        x,
        y: groundHeight(x, z),
        z,
        scale: plant.height * (CLUSTER.minScale + (CLUSTER.maxScale - CLUSTER.minScale) * h),
        turn: h * 2 * Math.PI,
        plant: { ...plant, seed: hash(h * 7.9) },
      })
    }
  }

  const group = new Group()
  const matrix = new Matrix4()
  const turn = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const scale = new Vector3()
  const position = new Vector3()
  for (const [name, instances] of byForm) {
    const geometry = createFormGeometry(FORMS[name])
    const data = new Float32Array(instances.length * 4)
    const mesh = new InstancedMesh(geometry, material, instances.length)
    for (const [index, instance] of instances.entries()) {
      turn.setFromAxisAngle(up, instance.turn)
      scale.setScalar(instance.scale)
      position.set(instance.x, instance.y - 0.01, instance.z)
      mesh.setMatrixAt(index, matrix.compose(position, turn, scale))
      const { moisture, light, vigour, seed } = instance.plant
      data.set([moisture, light, vigour, seed], index * 4)
    }
    geometry.setAttribute('aPlant', new InstancedBufferAttribute(data, 4))
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  return group
}

export function disposeVegetationForms(group: Group) {
  for (const child of group.children) {
    if (child instanceof InstancedMesh) {
      child.geometry.dispose()
      child.dispose()
    }
  }
}
