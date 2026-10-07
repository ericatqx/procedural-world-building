import { BufferAttribute, BufferGeometry, Color } from 'three'
import { AGE_HOURS } from '../../project/architecture.ts'
import { PROJECT_COLORS } from '../../project/materials.ts'
import { MeshBuilder } from '../../project/meshBuilder.ts'
import type { StructureMass } from './structureForms.ts'

/**
 * Week 06 asset forms. Abstract rather than literal (Style Guide ›
 * Geometry): structures are block masses in the Project's grammar, built in
 * place in world units so the Project's architecture material reads them;
 * a colony is a low formation of dots on the ground, in unit size, which each
 * placed point scales and turns.
 */

/** Unit box faces: outward normal and corners, counter-clockwise from outside. */
const BOX_FACES: readonly { normal: [number, number, number]; corners: [number, number, number][] }[] = [
  { normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { normal: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { normal: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
]
/** Height above the ground past which `aLift` stops counting, as in the Project. */
const LIFT_CAP = 2
/** Material age range across the structures, as a share of the Project's ageing span. */
const AGE = { from: 0.1, span: 0.65 } as const
/** Exposure to wear: open slabs and the tallest block fully, the rest of the mass less. */
const WEATHER = { open: 1, below: 0.4 } as const

/**
 * All structures as one mesh, in world units, with the attributes the
 * Project's architecture material reads: `aBirth` (hours before a clock of
 * 0, so each mass shows its own age), `aLift` (height above the ground) and
 * `aWeather` (exposure to wear).
 */
export function createStructureMassGeometry(
  masses: readonly StructureMass[],
  groundHeight: (x: number, z: number) => number,
): BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const births: number[] = []
  const lifts: number[] = []
  const weathers: number[] = []
  const indices: number[] = []
  for (const mass of masses) {
    const birth = -(AGE.from + AGE.span * mass.age) * AGE_HOURS
    const highest = Math.max(...mass.blocks.map((b) => b.y1))
    for (const b of mass.blocks) {
      const weather = b.raised || b.y1 >= highest ? WEATHER.open : WEATHER.below
      for (const { normal, corners } of BOX_FACES) {
        const start = positions.length / 3
        for (const [cx, cy, cz] of corners) {
          const x = cx ? b.x1 : b.x0
          const y = cy ? b.y1 : b.y0
          const z = cz ? b.z1 : b.z0
          positions.push(x, y, z)
          normals.push(...normal)
          births.push(birth)
          lifts.push(Math.min(LIFT_CAP, Math.max(0, y - groundHeight(x, z))))
          weathers.push(weather)
        }
        indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setAttribute('aBirth', new BufferAttribute(new Float32Array(births), 1))
  geometry.setAttribute('aLift', new BufferAttribute(new Float32Array(lifts), 1))
  geometry.setAttribute('aWeather', new BufferAttribute(new Float32Array(weathers), 1))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

export type ColonyForm = 'bloom' | 'crescent' | 'drift'
export const COLONY_FORMS: readonly ColonyForm[] = ['bloom', 'crescent', 'drift']

/** Colony tones, from the Project's habitat palette: sage lichen dots around a dark core, apart from the olive plants. */
export const COLONY_TONES = { dot: PROJECT_COLORS.habitat, core: PROJECT_COLORS.habitatInk } as const

/** One dot's profile as (radius, height), in units of its own radius: a low cap, sunk a little. */
const DOT_PROFILE = [
  [1, -0.3],
  [1, 0],
  [0.72, 0.22],
  [0.36, 0.33],
  [0, 0.36],
] as const
const DOT_SEGMENTS = 10
/** Dots are drawn this much larger than laid out, so neighbours touch and a colony reads as one patch. */
const DOT_SCALE = 1.35

/** A dot: (x, z, radius) in units of the colony radius, and whether it is a core. */
type Dot = [number, number, number, boolean]

function dot(builder: MeshBuilder, [cx, cz, radius, core]: Dot) {
  const r = radius * DOT_SCALE
  const tone = core ? 0 : 1
  const rings = DOT_PROFILE.map(([spread, height]) => {
    if (spread === 0) {
      return [builder.vertex(cx, height * r, cz, { aTone: tone })]
    }
    return Array.from({ length: DOT_SEGMENTS }, (_, s) => {
      const angle = (s / DOT_SEGMENTS) * 2 * Math.PI
      return builder.vertex(cx + spread * r * Math.cos(angle), height * r, cz + spread * r * Math.sin(angle), {
        aTone: tone,
      })
    })
  })
  for (let k = 0; k < rings.length - 1; k += 1) {
    const lower = rings[k]!
    const upper = rings[k + 1]!
    for (let s = 0; s < DOT_SEGMENTS; s += 1) {
      const next = (s + 1) % DOT_SEGMENTS
      if (upper.length === 1) {
        builder.triangle(lower[s]!, upper[0]!, lower[next]!)
      } else {
        builder.triangle(lower[s]!, upper[next]!, lower[next]!)
        builder.triangle(lower[s]!, upper[s]!, upper[next]!)
      }
    }
  }
}

/** A dark core ringed by pale petals. */
function rosette(cx: number, cz: number, core: number, petals: number, reach: number, petal: number): Dot[] {
  return [
    [cx, cz, core, true],
    ...Array.from({ length: petals }, (_, k): Dot => {
      const angle = (k / petals) * 2 * Math.PI
      return [cx + reach * Math.cos(angle), cz + reach * Math.sin(angle), petal, false]
    }),
  ]
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

function colonyDots(form: ColonyForm): Dot[] {
  switch (form) {
    case 'bloom':
      // One rosette with three smaller ones budding around it.
      return [
        ...rosette(0, 0, 0.11, 7, 0.24, 0.06),
        ...[0.4, 2.5, 4.4].flatMap((angle) =>
          rosette(0.72 * Math.cos(angle), 0.72 * Math.sin(angle), 0.07, 5, 0.15, 0.04),
        ),
      ]
    case 'crescent': {
      // Two nested arcs tapering away from a dark head.
      const outer = Array.from({ length: 9 }, (_, k): Dot => {
        const angle = -2.2 + k * 0.55
        return [0.78 * Math.cos(angle), 0.78 * Math.sin(angle), 0.1 - 0.006 * k, k === 0]
      })
      const inner = Array.from({ length: 5 }, (_, k): Dot => {
        const angle = -1.2 + k * 0.6
        return [0.48 * Math.cos(angle), 0.48 * Math.sin(angle), 0.06, false]
      })
      return [...outer, ...inner]
    }
    case 'drift':
      // A loose sunflower spiral, thinning outward, with a few dark dots among the pale.
      return Array.from({ length: 22 }, (_, k): Dot => {
        const radius = 0.9 * Math.sqrt((k + 0.5) / 22)
        const angle = k * GOLDEN_ANGLE + 0.35 * Math.sin(k * 2.7)
        return [radius * Math.cos(angle), radius * Math.sin(angle), 0.1 - 0.0025 * k, k % 5 === 0]
      })
  }
}

/**
 * Unit-radius colony lying on y = 0: a formation of low dots, as a bloom of
 * rosettes, a crescent or a drift, dark cores among pale dots. Tone is baked
 * into vertex colours.
 */
export function createColonyGeometry(form: ColonyForm): BufferGeometry {
  const builder = new MeshBuilder(['aTone'])
  for (const d of colonyDots(form)) {
    dot(builder, d)
  }
  const geometry = builder.build()
  const tone = geometry.getAttribute('aTone')
  const pale = new Color(COLONY_TONES.dot)
  const core = new Color(COLONY_TONES.core)
  const mixed = new Color()
  const colors = new Float32Array(tone.count * 3)
  for (let i = 0; i < tone.count; i += 1) {
    mixed.copy(core).lerp(pale, tone.getX(i))
    colors.set([mixed.r, mixed.g, mixed.b], i * 3)
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.deleteAttribute('aTone')
  return geometry
}
