import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three'

/**
 * Week 07 Branching Histories — the two vegetation strategies drawn with
 * the Project's botanical forms (`project/botany.ts`), in unit height, for
 * the Project's vegetation material, which opens, spreads and droops each
 * plant from its moisture, light and vigour (`aPlant`):
 *
 *   frond  shelter vegetation: a low, wide rosette of long blades, in clumps
 *   spire  exposure vegetation: upright, side branches climbing the stem
 *   tier   exposure vegetation: upright, wider tiers of side branches
 *
 * Side branches are drawn as blades of their tier, each carrying paired
 * leaflets, so the material opens and droops them with the rest.
 */

type Branches = {
  /** Attachment heights. */
  at: readonly number[]
  perTier: number
  length: number
  /** Rise per unit of length: steeper for light-seeking stems. */
  rise: number
  width: number
  /** Leaflet pairs along each branch. */
  leaflets: number
  leafletReach: number
  leafletWidth: number
}

type Form = {
  stemHeight: number
  stemBase: number
  stemTip: number
  tiers: readonly number[]
  bladesPerTier: number
  bladeReach: number
  bladeTaper: number
  bladeWidth: number
  bladeRise: number
  branches?: Branches
  buds: readonly (readonly [number, number, number])[]
}

export const PLANT_FORMS = {
  frond: {
    stemHeight: 0.3,
    stemBase: 0.045,
    stemTip: 0.015,
    tiers: [0.03, 0.08, 0.14, 0.2],
    bladesPerTier: 7,
    bladeReach: 0.8,
    bladeTaper: 0.45,
    bladeWidth: 0.09,
    bladeRise: 0.16,
    buds: [[0.3, 0, 0.035]],
  },
  spire: {
    stemHeight: 1,
    stemBase: 0.065,
    stemTip: 0.014,
    tiers: [0.72, 0.86],
    bladesPerTier: 3,
    bladeReach: 0.18,
    bladeTaper: 0.3,
    bladeWidth: 0.045,
    bladeRise: 0.2,
    branches: {
      at: [0.24, 0.36, 0.48, 0.6, 0.72],
      perTier: 2,
      length: 0.34,
      rise: 0.8,
      width: 0.02,
      leaflets: 3,
      leafletReach: 0.15,
      leafletWidth: 0.045,
    },
    buds: [[1, 0, 0.05]],
  },
  tier: {
    stemHeight: 0.94,
    stemBase: 0.075,
    stemTip: 0.016,
    tiers: [0.7, 0.84],
    bladesPerTier: 3,
    bladeReach: 0.26,
    bladeTaper: 0.45,
    bladeWidth: 0.055,
    bladeRise: 0.12,
    branches: {
      at: [0.28, 0.42, 0.56, 0.7],
      perTier: 3,
      length: 0.44,
      rise: 0.45,
      width: 0.022,
      leaflets: 3,
      leafletReach: 0.16,
      leafletWidth: 0.05,
    },
    buds: [[0.94, 0, 0.05]],
  },
} as const satisfies Record<string, Form>

export type PlantFormName = keyof typeof PLANT_FORMS

const BLADE_SEGMENTS = 4
const LEAFLET_SEGMENTS = 2
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const PART = { stem: 0, blade: 1, bud: 2 } as const

/** Stem, tiers of blades and side branches turning by the golden angle, and buds; `aForm` = (part, attachment height, distance along the blade). */
export function plantFormGeometry(name: PlantFormName): BufferGeometry {
  const form: Form = PLANT_FORMS[name]
  const positions: number[] = []
  const forms: number[] = []
  const emit = (point: Vector3, data: readonly [number, number, number]) => {
    positions.push(point.x, point.y, point.z)
    forms.push(...data)
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
    for (const point of [base[k]!, base[next]!, tip[next]!, base[k]!, tip[next]!, tip[k]!]) {
      emit(point, [PART.stem, 0, 0])
    }
  }

  /**
   * A tapering blade from `start` along horizontal `out`, rising as it goes;
   * `along` maps its own 0…1 onto the distance recorded in `aForm`.
   */
  const blade = (
    start: Vector3,
    out: Vector3,
    reach: number,
    width: number,
    rise: number,
    attach: number,
    along: (s: number) => number,
    segments: number,
  ) => {
    const side = new Vector3(-out.z, 0, out.x)
    const edge = (s: number, sign: number) =>
      start
        .clone()
        .addScaledVector(out, reach * s)
        .addScaledVector(side, sign * width * Math.sin(Math.PI * (0.15 + 0.85 * s)))
        .setY(start.y + rise * s)
    const at = (s: number) => [PART.blade, attach, along(s)] as const
    for (let i = 0; i < segments; i += 1) {
      const s0 = i / segments
      const s1 = (i + 1) / segments
      emit(edge(s0, -1), at(s0))
      emit(edge(s1, -1), at(s1))
      emit(edge(s1, 1), at(s1))
      emit(edge(s0, -1), at(s0))
      emit(edge(s1, 1), at(s1))
      emit(edge(s0, 1), at(s0))
    }
  }

  const lastTier = Math.max(1, form.tiers.length - 1)
  for (const [t, attach] of form.tiers.entries()) {
    const reach = form.bladeReach * (1 - (form.bladeTaper * t) / lastTier)
    for (let b = 0; b < form.bladesPerTier; b += 1) {
      const angle = t * GOLDEN_ANGLE + (b * 2 * Math.PI) / form.bladesPerTier
      const out = new Vector3(Math.cos(angle), 0, Math.sin(angle))
      blade(new Vector3(0, attach, 0), out, reach, form.bladeWidth, form.bladeRise, attach, (s) => s, BLADE_SEGMENTS)
    }
  }

  const branches = form.branches
  if (branches) {
    const lastBranch = Math.max(1, branches.at.length - 1)
    for (const [t, attach] of branches.at.entries()) {
      const length = branches.length * (1 - (0.4 * t) / lastBranch)
      for (let b = 0; b < branches.perTier; b += 1) {
        const angle = (t + 0.5) * GOLDEN_ANGLE + (b * 2 * Math.PI) / branches.perTier
        const out = new Vector3(Math.cos(angle), 0, Math.sin(angle))
        const start = new Vector3(0, attach, 0)
        blade(start, out, length, branches.width, length * branches.rise, attach, (s) => 0.6 * s, BLADE_SEGMENTS)
        for (let k = 1; k <= branches.leaflets; k += 1) {
          const u = k / (branches.leaflets + 0.4)
          const node = start.clone().addScaledVector(out, length * u).setY(attach + length * branches.rise * u)
          const leafReach = branches.leafletReach * (1 - 0.35 * u)
          for (const sign of [-1, 1]) {
            const turn = angle + sign * 0.85
            const leafOut = new Vector3(Math.cos(turn), 0, Math.sin(turn))
            blade(node, leafOut, leafReach, branches.leafletWidth, leafReach * 0.5, attach, (s) => 0.6 * u + 0.4 * s, LEAFLET_SEGMENTS)
          }
        }
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
      for (const point of [centre, around[next]!, around[i]!, around[i]!, around[next]!, top]) {
        emit(point, [PART.bud, height, 1])
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aForm', new Float32BufferAttribute(forms, 3))
  geometry.computeVertexNormals()
  return geometry
}
