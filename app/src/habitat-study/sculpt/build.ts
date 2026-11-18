import type { BufferGeometry } from 'three'
import type { StudySite } from '../site.ts'
import { archetypes, carve, composePlants, dwellerSpot, type Archetype } from './forms.ts'
import { buildLandform, type Landform } from './landform.ts'

export type Built = { land: Landform; carved: { id: string; geometry: ReturnType<typeof carve> }[]; plants: ReturnType<typeof composePlants>; shapes: Record<Archetype, BufferGeometry>; dweller: [number, number] | null }
const cache = new WeakMap<StudySite, Built>()
export function sculptOf(site: StudySite): Built {
  let b = cache.get(site)
  if (!b) {
    const started = performance.now()
    const land = buildLandform(site)
    b = { land, carved: site.organisms.map((o) => ({ id: o.id, geometry: carve(o, land) })), plants: composePlants(site, land), shapes: archetypes(), dweller: dwellerSpot(site, land) }
    console.info('[habitat study] sculpt built', { ms: Math.round(performance.now() - started), plants: b.plants.length })
    cache.set(site, b)
  }
  return b
}

