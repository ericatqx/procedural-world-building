import { useMemo, useState } from 'react'
import { archShade } from '../../project03/archGround.ts'
import { LIFECYCLE } from '../../project03/livingTime.ts'
import { currentPopulation } from '../../project03/livingSelection.ts'
import { islandAt } from '../../project03/Vegetation.tsx'
import type { IslandFields } from '../../project03/vegFields.ts'
import { ZONE_KEYS, ZONE_LABEL, effective, zonesOf, type Conditions, type Zones } from '../../project03/vegPlants.ts'
import { riverEdgeField } from '../../project03/vegRivers.ts'
import { shared } from '../../project03/vegShared.ts'
import { SPECIES, STRIDE, plantsInTile, type Water } from '../../project03/worldPlants.ts'
import { currentWorld } from '../../project03/world.ts'
import { Exhibit, INK, Key, Seg, Waiting, estimatedShade, pct, useLive, useWidth } from './common.tsx'

/**
 * VEGETATION — why does this plant grow here, but not there? One real 96 m patch of ground, seen three ways side by side, the same place in
 * each (pointing at one points at all three):
 *   SUITABILITY: how well the ground suits the chosen layer (trees, shrubs or ground cover), by its species' own rules over light, moisture,
 *   slope and water (vegPlants.ts).
 *   PLACEMENT: where the world's own placement (worldPlants.ts › plantsInTile) actually stood plants: a seeded draw among the suitable places.
 *   COMMUNITIES: the habitat each place belongs to (vegPlants.ts › zonesOf), whose community the plants come from.
 * The shade of a structure is part of the conditions here, as on the island's near ground: its lasting shade (archShade.ts) takes light and
 * keeps the ground damp (vegPlants.ts › effective), which is why shade-tolerant plants gather beneath the structures.
 */
const SIZE = 96
const CELLS = 32
type Layer = 'tall' | 'shrub' | 'cover'
const LAYERS: { key: Layer; label: string }[] = [
  { key: 'tall', label: 'Trees' },
  { key: 'shrub', label: 'Shrubs' },
  { key: 'cover', label: 'Ground cover' },
]
const fit = (c: Conditions, layer: Layer) => {
  const z = zonesOf(c)
  return SPECIES.filter((s) => s.group === layer).reduce((m, s) => Math.max(m, s.rule(c, z)), 0)
}
/** The habitats in the World's own colours (the island's palette), not the diagnostic lens's bright ones. */
const HABITAT_COLOUR: Record<keyof Zones, string> = { moist: '#4E5F45', shore: '#3E7A7B', dry: '#CB9B55', shaded: '#6C6499', alpine: '#E8E0D0', rock: '#B5603C' }
const leading = (z: Zones): keyof Zones => ZONE_KEYS.reduce((a, b) => (z[b] > z[a] ? b : a))

/** A structure's lasting shade and shelter at a point (archShade.ts; 0 where it has not been worked out). */
function shadeAt(x: number, z: number): { shade: number; shelter: number } {
  const img = archShade.texture.value.image as { data?: Uint8Array; width: number }
  if (!img.data) return { shade: 0, shelter: 0 }
  const n = img.width
  const cell = 4096 / n
  const i = Math.floor((x + 2048) / cell)
  const j = Math.floor((z + 2048) / cell)
  if (i < 0 || j < 0 || i >= n || j >= n) return { shade: 0, shelter: 0 }
  return { shade: img.data[(j * n + i) * 2]! / 255, shelter: img.data[(j * n + i) * 2 + 1]! / 255 }
}
/** The island's conditions with the structures' shade folded in, as the near tiles do. */
type Est = { x: number; z: number; radius: number; height: number } | null
const reader = (f: IslandFields, est: Est = null) => {
  const base = islandAt(f)
  return (x: number, z: number, y: number): Conditions => {
    const c = base(x, z, y)
    // (Measured shade where the world has it; for the estimated example, the structure's estimated shade (common.tsx), never both.)
    const s = est ? { shade: estimatedShade(est, x, z), shelter: 0 } : shadeAt(x, z)
    if (s.shade < 0.01 && s.shelter < 0.01) return c
    return { ...c, ...effective(c.light, c.moisture, s.shade, s.shelter), shade: s.shade, shelter: s.shelter }
  }
}

type Preset = 'sun' | 'shade' | 'damp'
/** Patches worth reading: lit open ground, a structure's lasting shade, damp ground near water. */
function presetTile(f: IslandFields, kind: Preset): [number, number] | null {
  const snap = (x: number, z: number): [number, number] => [Math.floor(x / SIZE) * SIZE, Math.floor(z / SIZE) * SIZE]
  if (kind === 'shade') {
    // The structure with the most lasting shade worked out beside it: the patch on its shaded side.
    const pop = currentPopulation()
    let best = { s: 0, x: 0, z: 0 }
    for (const o of pop?.organisms ?? []) {
      if (o.died >= 0 && o.died < LIFECYCLE.reference) continue
      for (let a = 0; a < 8; a += 1) {
        const x = o.x + Math.cos((a / 8) * Math.PI * 2) * (o.radius + 30)
        const z = o.z + Math.sin((a / 8) * Math.PI * 2) * (o.radius + 30)
        const s = shadeAt(x, z).shade
        if (s > best.s) best = { s, x, z }
      }
    }
    return best.s > 0.2 ? snap(best.x - SIZE / 2, best.z - SIZE / 2) : null
  }
  let best = { s: -1, x: 0, z: 0 }
  for (let j = 8; j < f.n - 8; j += 3)
    for (let i = 8; i < f.n - 8; i += 3) {
      const k = j * f.n + i
      if (!f.land[k] || f.waterDepth[k]! > 0 || f.waterDist[k]! < 24) continue
      const flat = 1 - Math.min(1, f.slope[k]! * 2)
      const s = kind === 'damp' ? f.moisture[k]! * flat * (f.waterDist[k]! < 120 ? 1.3 : 0.6) : f.light[k]! * flat * (0.4 + f.moisture[k]!)
      if (s > best.s) best = { s, x: f.x0 + (i + 0.5) * f.cell, z: f.x0 + (j + 0.5) * f.cell }
    }
  return snap(best.x, best.z)
}

export function VegetationInspection() {
  const f = useLive(() => shared.island)
  const world = useLive(currentWorld)
  const [preset, setPreset] = useState<Preset>('sun')
  const [tile, setTile] = useState<[number, number] | null>(null)
  const [layer, setLayer] = useState<Layer>('tall')
  const [hover, setHover] = useState<[number, number] | null>(null)
  const [wrap, width] = useWidth(1120)
  const shadeTile = useMemo(() => (f ? presetTile(f, 'shade') : null), [f])
  // Where no structure's shade has been measured yet: the largest living structure, its shade ESTIMATED, the patch where that shade lies longest.
  const example = useMemo(() => {
    if (shadeTile) return null
    const pop = currentPopulation()
    const o = pop?.organisms.filter((m) => m.died < 0 || m.died > LIFECYCLE.reference).sort((a, b) => b.height * b.radius - a.height * a.radius)[0]
    if (!o) return null
    let best = { s: -1, x: o.x, z: o.z }
    for (let a = 0; a < 16; a += 1)
      for (const r of [o.radius * 0.8, o.radius * 1.3]) {
        const x = o.x + Math.cos((a / 16) * Math.PI * 2) * r
        const z = o.z + Math.sin((a / 16) * Math.PI * 2) * r
        const v = estimatedShade(o, x, z)
        if (v > best.s) best = { s: v, x, z }
      }
    return { est: { x: o.x, z: o.z, radius: o.radius, height: o.height }, tile: [Math.floor((best.x - SIZE / 2) / SIZE) * SIZE, Math.floor((best.z - SIZE / 2) / SIZE) * SIZE] as [number, number] }
  }, [shadeTile, f])
  const estimating = preset === 'shade' && !tile && !shadeTile && !!example
  const at: [number, number] = tile ?? (f ? (preset === 'shade' && shadeTile ? shadeTile : estimating ? example!.tile : presetTile(f, preset === 'shade' ? 'sun' : preset)!) : [0, 0])
  const water = useMemo<Water | null>(() => (world ? { depth: (x, z) => world.water.depthAt(x, z), edge: riverEdgeField(world) } : null), [world])
  const read = useMemo(() => (f ? reader(f, estimating ? example!.est : null) : null), [f, estimating, example])
  const placed = useMemo(() => {
    if (!read || !world || !water) return null
    return plantsInTile('all', at[0], at[1], SIZE, world.seed, Math.floor(LIFECYCLE.reference / 10) * 10, read, water)
  }, [read, world, water, at])
  const grid = useMemo(() => {
    if (!read || !world) return null
    const cells: { c: Conditions; wet: boolean; fit: Record<Layer, number>; zone: keyof Zones }[] = []
    for (let j = 0; j < CELLS; j += 1)
      for (let i = 0; i < CELLS; i += 1) {
        const x = at[0] + (i + 0.5) * (SIZE / CELLS)
        const z = at[1] + (j + 0.5) * (SIZE / CELLS)
        const c = read(x, z, 0)
        const wet = world.water.depthAt(x, z) > 0
        cells.push({ c, wet, fit: { tall: wet ? 0 : fit(c, 'tall'), shrub: wet ? 0 : fit(c, 'shrub'), cover: wet ? 0 : fit(c, 'cover') }, zone: leading(zonesOf(c)) })
      }
    return cells
  }, [read, world, at])

  if (!f || !world || !placed || !grid || !read) return <Waiting what="island’s fields" />
  const T = Math.max(220, Math.floor((width - 2 * 24) / 3))
  const s = T / CELLS
  const marks: { x: number; z: number; r: number; group: Layer }[] = []
  for (const sp of SPECIES) {
    const buf = placed.get(sp.id)
    if (!buf) continue
    for (let k = 0; k < buf.length; k += STRIDE) marks.push({ x: ((buf[k]! - at[0]) / SIZE) * T, z: ((buf[k + 2]! - at[1]) / SIZE) * T, r: buf[k + 3]!, group: sp.group as Layer })
  }
  const count = (g: Layer) => marks.filter((m) => m.group === g).length
  const here = hover ? read(hover[0], hover[1], 0) : null
  const pointer = hover ? [((hover[0] - at[0]) / SIZE) * T, ((hover[1] - at[1]) / SIZE) * T] : null
  const shaded = grid.filter((g) => g.c.shade > 0.3).length / grid.length
  const zones = new Map<keyof Zones, number>()
  grid.forEach((g) => !g.wet && zones.set(g.zone, (zones.get(g.zone) ?? 0) + 1))
  const zoneList = [...zones.entries()].sort((a, b) => b[1] - a[1])
  const suitable = grid.filter((g) => g.fit[layer] > 0.6).length / grid.length
  const lname = LAYERS.find((l) => l.key === layer)!.label.toLowerCase()
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setHover([at[0] + ((e.clientX - r.left) / r.width) * SIZE, at[1] + ((e.clientY - r.top) / r.height) * SIZE])
  }
  const cross = pointer ? <circle cx={pointer[0]} cy={pointer[1]} r={7} fill="none" stroke={INK.signal} strokeWidth={1.5} /> : null
  const panel = (title: string, body: React.ReactNode) => (
    <figure className="pv-ex-panel">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${T} ${T}`} width={T} height={T} role="img" aria-label={title} onPointerMove={move} onPointerLeave={() => setHover(null)}>
        {body}
        {cross}
      </svg>
    </figure>
  )
  return (
    <Exhibit
      controls={
        <>
          <Seg label="Patch" items={[{ key: 'sun' as Preset, label: 'Sunlit open ground' }, { key: 'shade' as Preset, label: 'A structure’s lasting shade' }, { key: 'damp' as Preset, label: 'Damp ground by water' }]} value={tile ? ('' as Preset) : preset} onChange={(v) => { setTile(null); setPreset(v) }} />
          <Seg label="Plant layer" items={LAYERS.map((l) => ({ key: l.key, label: `${l.label} · ${count(l.key)}` }))} value={layer} onChange={setLayer} />
        </>
      }
      stage={
        <div ref={wrap} className="pv-ex-triptych">
          {panel(
            `1 · Where ${lname} can grow`,
            grid.map((cell, k) => {
              const i = k % CELLS
              const j = Math.floor(k / CELLS)
              if (cell.wet) return <rect key={k} x={i * s} y={j * s} width={s + 0.5} height={s + 0.5} fill="#1F4D52" />
              // A continuous ramp, near-black (unsuitable) to the plants' pale olive (ideal): the rule's own score, uncut.
              const v = Math.max(0, Math.min(1, cell.fit[layer]))
              const t = v * v
              return <rect key={k} x={i * s} y={j * s} width={s + 0.5} height={s + 0.5} fill={`rgb(${Math.round(24 + t * 133)}, ${Math.round(25 + t * 130)}, ${Math.round(22 + t * 76)})`} />
            }),
          )}
          {panel(
            `2 · Where they grew`,
            <>
              <rect width={T} height={T} fill="#1b1c1a" />
              {grid.map((cell, k) => (cell.wet ? <rect key={k} x={(k % CELLS) * s} y={Math.floor(k / CELLS) * s} width={s + 0.5} height={s + 0.5} fill="#1F4D52" /> : cell.c.shade > 0.05 ? <rect key={k} x={(k % CELLS) * s} y={Math.floor(k / CELLS) * s} width={s + 0.5} height={s + 0.5} fill={`rgba(108,100,153,${(cell.c.shade * 0.6).toFixed(2)})`} /> : null))}
              {marks
                .slice()
                .sort((a, b) => (a.group === layer ? 1 : 0) - (b.group === layer ? 1 : 0))
                .map((m, k) => {
                  const on = m.group === layer
                  if (m.group === 'tall') return <circle key={k} cx={m.x} cy={m.z} r={Math.max(3, m.r * (T / SIZE) * 1.6)} fill={on ? 'rgba(78, 95, 69, 0.95)' : 'rgba(78,95,69,0.3)'} stroke={on ? '#9D9B62' : 'none'} strokeWidth={1} />
                  if (m.group === 'shrub') return <circle key={k} cx={m.x} cy={m.z} r={on ? 3.2 : 2} fill={on ? '#5E6339' : 'rgba(94,99,57,0.35)'} />
                  return <circle key={k} cx={m.x} cy={m.z} r={on ? 1.3 : 0.8} fill={on ? '#9D9B62' : 'rgba(157,155,98,0.2)'} />
                })}
            </>,
          )}
          {panel(
            '3 · Its habitats',
            grid.map((cell, k) => (
              <rect key={k} x={(k % CELLS) * s} y={Math.floor(k / CELLS) * s} width={s + 0.5} height={s + 0.5} fill={cell.wet ? '#1F4D52' : HABITAT_COLOUR[cell.zone]} />
            )),
          )}
        </div>
      }
      legend={
        <>
          <Key swatch="linear-gradient(90deg,#18191a,#9D9B62)">how well it suits {lname}: dark poorly, pale ideally</Key>
          <Key swatch="#4E5F45">tree crown</Key>
          <Key swatch="#5E6339">shrub</Key>
          <Key swatch="#9D9B62">ground cover</Key>
          <Key swatch="#6C6499">a structure’s lasting shade</Key>
          {zoneList.slice(0, 4).map(([z]) => (
            <Key key={z} swatch={HABITAT_COLOUR[z]}>
              {ZONE_LABEL[z].toLowerCase()}
            </Key>
          ))}
        </>
      }
      chain={{
        input: here ? (
          <>
            At the red ring: light {pct(here.light)}
            {here.shade > 0.05 ? ` (a structure’s shade takes ${pct(0.85 * here.shade)})` : ''}, moisture {pct(here.moisture)}, slope {Math.round(Math.atan(here.slope) * 57.3)}°, water {Math.round(here.waterDist)} m off.
          </>
        ) : (
          estimating ? (
            <>Beside the island’s largest structure, with its shade ESTIMATED from its size and the day’s sun (the world measures the real shade once a structure has been seen close). {pct(shaded)} of the patch lies in that lasting shade.</>
          ) : <>Light, moisture, slope and distance to water across the patch{shaded > 0.05 ? `; ${pct(shaded)} of it lies in a structure’s lasting shade` : ''}. Point at any panel to read a place.</>
        ),
        rule: here ? (
          <>
            Fit here: trees {pct(fit(here, 'tall'))}, shrubs {pct(fit(here, 'shrub'))}, ground cover {pct(fit(here, 'cover'))}. Each species has its rule; a seeded draw then decides which suitable places hold one.
          </>
        ) : (
          'Each species scores the ground by its own rule; where the score is high a seeded draw may place one. Shade takes light and keeps the ground damp.'
        ),
        result: here ? (
          <>This place is {ZONE_LABEL[leading(zonesOf(here))].toLowerCase()} ground, and takes that habitat’s community.</>
        ) : (
          <>
            {pct(suitable)} of the patch suits {lname} well (a score over 60%), and {count(layer)} grew there. Mostly {zoneList.slice(0, 2).map(([z]) => ZONE_LABEL[z].toLowerCase()).join(' and ')}.
          </>
        ),
      }}
    />
  )
}

