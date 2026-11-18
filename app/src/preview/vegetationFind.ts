import { foodNear } from '../project03/creatureHabitat.ts'
import { islandAt } from '../project03/Vegetation.tsx'
import { zonesOf } from '../project03/vegPlants.ts'
import { shared } from '../project03/vegShared.ts'
import { SPECIES, type SpeciesId } from '../project03/worldPlants.ts'

/**
 * FINDING A REAL PLANT OF A SPECIES, near where the visitor is looking (Explore's Vegetation drawer). Two cheap steps, no island-wide placement:
 *   1. the island's 16 m fields, scored by the species' own placement rule (worldPlants.ts › rule), every 32 m out to 900 m from the view's focus,
 *      nearer places favoured;
 *   2. at the best few, the world's own placement (creatureHabitat.ts › foodNear, the plants the renderer draws) for an actual individual, a mature
 *      one first. Returns up to six, so "Another" can step through them.
 */
export type Found = { id: SpeciesId; x: number; z: number; v: number; s: number }
export function findPlants(id: SpeciesId): Found[] {
  const f = shared.island
  const sp = SPECIES.find((s) => s.id === id)
  if (!f || !sp) return []
  const at = islandAt(f)
  const fx = shared.focus.ready ? shared.focus.x : 0
  const fz = shared.focus.ready ? shared.focus.z : 0
  const cells: { x: number; z: number; s: number }[] = []
  for (let j = 2; j < f.n - 2; j += 2)
    for (let i = 2; i < f.n - 2; i += 2) {
      const k = j * f.n + i
      if (!f.land[k]) continue
      const x = f.x0 + (i + 0.5) * f.cell
      const z = f.x0 + (j + 0.5) * f.cell
      const d = Math.hypot(x - fx, z - fz)
      if (d > 900) continue
      const c = at(x, z, 0)
      const s = sp.rule(c, zonesOf(c)) * Math.exp(-d / 600)
      if (s > 0.05) cells.push({ x, z, s })
    }
  cells.sort((a, b) => b.s - a.s)
  const out: Found[] = []
  const only = new Set<SpeciesId>([id])
  for (const c of cells.slice(0, 10)) {
    const near = foodNear(c.x, c.z, 20, only).sort((a, b) => Number(a.v === 0) - Number(b.v === 0) || b.s - a.s)
    const p = near[0]
    if (p && !out.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 30)) out.push({ id, x: p.x, z: p.z, v: p.v, s: p.s })
    if (out.length >= 6) break
  }
  return out
}
