import { MeshStandardMaterial, type Material } from 'three'
import { applyMist } from './mist.ts'
import { applyPlantStyle, applyStyleFinish, specialiseStyle } from './visualStyle.ts'
import type { Creature } from '../creature-lab/types.ts'

/**
 * THE ISLAND'S OWN MATERIALS, shared by the island and the Labs, so a plant or creature in a Lab is drawn with exactly the material and
 * shading it has on the island (the main visual's colours, its light, its lavender cast shadow and its night), not a stand-in.
 *
 *   plants     vertex colours under the island's plant finish (WorldPlants.tsx builds the same material). In the main visual (Graphic Diorama,
 *              Black Stage: visualStudyWorlds.ts) the finish takes a plant's own colour into the island's palette.
 *   creatures  the Lab's own materials with the island's style finish added; the Dweller's hide is taken toward a warm pale stone (paleHide)
 */
export function worldPlantMaterial(shadeLover = false): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: 2 })
  m.customProgramCacheKey = () => (shadeLover ? 'world-plants-shade' : 'world-plants')
  m.onBeforeCompile = (shader) => {
    applyMist(shader)
    applyPlantStyle(shader, shadeLover)
  }
  specialiseStyle(m)
  return m
}

/** Colour of an instance relative to the mean colour of the geometry it is drawn on, pulled most of the way to the target (the island's plant tint). */
export const relColour = (target: number, mean: number) => 1 + 0.9 * (Math.max(0.35, Math.min(1.5, target / Math.max(0.05, mean))) - 1)

/**
 * The Dweller's hide is a mid taupe-grey under its pale mineral plates. In bright studio light it reads as white stone; in the island's light, and
 * above all in a structure's shadow where it lives, the hide fell to a dark grey under bright plates, as if patterned. On the island its hide is
 * taken most of the way to a warm pale stone (on this individual's own geometry), so it reads as one clean sculpted body with a natural tone, which
 * darkens in shadow and brightens in sun. The darkest parts (eyes, nostrils, the mouth) are left as they are.
 */
export function paleHide(creature: Creature) {
  for (const mesh of creature.meshes) {
    const col = mesh.geometry.getAttribute('color')
    if (!col) continue
    for (let i = 0; i < col.count; i += 1) {
      const r = col.getX(i)
      const g = col.getY(i)
      const b = col.getZ(i)
      // The Lab's colours are sRGB values: the eyes (#1c1916, about 0.1), nostrils and mouth (about 0.2) stay as they are; the hide (about 0.5) is lifted.
      if (0.3 * r + 0.55 * g + 0.15 * b < 0.3) continue
      col.setXYZ(i, r + (0.72 - r) * 0.7, g + (0.67 - g) * 0.7, b + (0.58 - b) * 0.7)
    }
    col.needsUpdate = true
  }
}

/** The illustrative styles (visualStyle.ts) on this individual's own materials. */
export function styleCreature(creature: Creature) {
  const seen = new Set<Material>()
  for (const mesh of creature.meshes) {
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      // Only lit (standard) materials: the contour reads the surface normal, which an unlit material does not have.
      if (seen.has(m) || !(m as Material & { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) continue
      seen.add(m)
      const base = m.onBeforeCompile
      const key = m.customProgramCacheKey
      m.onBeforeCompile = (shader, renderer) => {
        base.call(m, shader, renderer)
        applyStyleFinish(shader, 'creature')
      }
      m.customProgramCacheKey = () => `${key.call(m)}-sty`
      specialiseStyle(m)
      m.needsUpdate = true
    }
  }
}

/** A creature as the island draws it (the same steps Creatures.tsx takes on each individual it builds). */
export function asOnIsland(creature: Creature, species: string) {
  if (species === 'dweller') paleHide(creature)
  styleCreature(creature)
}
