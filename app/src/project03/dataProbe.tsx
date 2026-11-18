import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Fog, PerspectiveCamera, Raycaster, Sphere, Vector2, Vector3, WebGLRenderTarget, type Camera, type Mesh, type Object3D } from 'three'
import { sunAt } from '../project/sun.ts'
import { shadeAt } from './archGround.ts'
import { environment } from './environment.ts'
import { calloutAnchor, getCard, getExplore, getInspect, probeMarker, setInspect, setCard, type CardSection } from './exploreData.tsx'
import { currentPopulation, type Selection } from './livingSelection.ts'
import { organismState } from './livingEcology.ts'
import { worldYears } from './livingTime.ts'
import { useExperience } from './experience.ts'
import { groundHit } from './PlacementCursor.tsx'
import { landscapeHeight } from './terrain.ts'
import { habitatAt } from './vegCoverage.ts'
import { islandSample, sampleField } from './vegFields.ts'
import { vegGround } from './vegGround.ts'
import { ZONE_KEYS, ZONE_LABEL } from './vegPlants.ts'
import { shared } from './vegShared.ts'
import { DIAG_LEGENDS, PROBE_KIND, diagUniforms } from './visualDiagnostics.ts'
import { foodNear } from './creatureHabitat.ts'
import { plantClick, vegInspect } from './vegInspect.ts'
import { PART_VARIANT, SPECIES as PLANTS, speciesInfo, type SpeciesId } from './worldPlants.ts'
import { islandAt } from './Vegetation.tsx'
import { effective, zonesOf } from './vegPlants.ts'
import type { Ray } from 'three'
import { styleUniforms } from './visualStyle.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — EXPLORE DATA'S POINTER (Round 08C). While a data view is on, the pixel under the pointer is drawn once more, alone, with the
 * views' probe on (visualDiagnostics.ts › uDiagProbe): every surface writes its kind, the legend category it was drawn as and its value instead of a
 * colour, so the pointer reads exactly what the view decided there (the same rules, the same textures, the same level of detail). The numbers in the
 * card are then read from the data the view draws from: the ground weights, the geology map, the island's fields, the structures' habitat, the water
 * system. Nothing here is a second model of the world.
 *
 * It listens without capturing (passive pointermove on the canvas), skips while any button is held, and hides on pointerdown, so orbiting, dragging and
 * zooming are untouched; it reads at most about fourteen times a second.
 */
const pct = (v: number) => `${Math.round(v * 100)}%`
const deg = (rad: number) => `${Math.round((rad * 180) / Math.PI)}°`
const BEARING = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
/** A compass bearing for a direction in the world's plane: north is +z and east +x, as the sun's azimuth reads (project/sun.ts: 0° is +z, south -z). */
const bearing = (dx: number, dz: number) => BEARING[Math.round(((Math.atan2(dx, dz) * 180) / Math.PI + 360) / 45) % 8]!

/** A data texture's four channels (0..1) at a point, filtered as the GPU filters it (linear, texel centres). */
function texAt(which: 'ground' | 'geology', x: number, z: number): [number, number, number, number] {
  const image = vegGround[which].value.image as { data: Uint8Array; width: number } | undefined
  const out: [number, number, number, number] = [0, 0, 0, 0]
  if (!image?.data || image.width < 2) return out
  const n = image.width
  const u = Math.min(n - 1.001, Math.max(0, ((x - vegGround.origin.value) / vegGround.size.value) * n - 0.5))
  const v = Math.min(n - 1.001, Math.max(0, ((z - vegGround.origin.value) / vegGround.size.value) * n - 0.5))
  const i = Math.floor(u)
  const j = Math.floor(v)
  const fu = u - i
  const fv = v - j
  for (let c = 0; c < 4; c += 1) {
    const at = (a: number, b: number) => image.data[((j + b) * n + (i + a)) * 4 + c]! / 255
    out[c] = (at(0, 0) * (1 - fu) + at(1, 0) * fu) * (1 - fv) + (at(0, 1) * (1 - fu) + at(1, 1) * fu) * fv
  }
  return out
}

type Read = { title: string; tag: string; rows: [string, string][]; cat: number }

/** The card's contents for the view under the pointer: `cat`/`val` as the view drew them, the numbers from the view's own data. */
function describe(id: string, kind: number, cat: number, val: number, x: number, z: number, y: number, world: World): Read | null {
  const legend = DIAG_LEGENDS[id]
  const label = (c: number) => (legend?.kind === 'cat' ? legend.items[c]?.label : undefined) ?? '—'
  const rows: [string, string][] = []
  const f = shared.island
  const elevation: [string, string] = ['Elevation', `${y.toFixed(1)} m`]
  const position: [string, string] = ['At', `${Math.round(x)}, ${Math.round(z)}`]
  if (id === 'water-0') {
    const surface = world.water.surfaceAt(x, z)
    if (kind === PROBE_KIND.water && surface !== null) {
      const body = world.water.bodies.find((b) => x >= b.bounds.minX && x <= b.bounds.maxX && z >= b.bounds.minZ && z <= b.bounds.maxZ && b.grid.wet[Math.round((z - b.grid.z0) / b.grid.step) * b.grid.cols + Math.round((x - b.grid.x0) / b.grid.step)]! > 0)
      if (body) {
        rows.push(['Surface', `${body.level.toFixed(2)} m`], ['Depth here', `${world.water.depthAt(x, z).toFixed(1)} m`], ['Deepest', `${body.depth.toFixed(1)} m`], ['Area', `${(body.area / 1e6).toFixed(3)} km²`])
        return { title: body.kind === 'lake' ? `Lake ${body.id + 1}` : `Pool ${body.id + 1}`, tag: 'Still water', rows, cat: 2 }
      }
    }
    // The nearest river node, if the point lies within its channel.
    let best = { d: Infinity, r: -1, k: -1 }
    world.rivers.rivers.forEach((river, r) =>
      river.nodes.forEach((node, k) => {
        const d = Math.hypot(node.x - x, node.z - z) - node.halfWidth
        if (d < best.d) best = { d, r, k }
      }),
    )
    if (kind === PROBE_KIND.water && best.r >= 0 && best.d < 6) {
      const river = world.rivers.rivers[best.r]!
      const node = river.nodes[best.k]!
      const next = river.nodes[Math.min(river.nodes.length - 1, best.k + 1)]!
      const prev = river.nodes[Math.max(0, best.k - 1)]!
      const run = Math.hypot(next.x - prev.x, next.z - prev.z)
      const drop = prev.level - next.level
      rows.push(['Flows', `toward ${bearing(next.x - prev.x, next.z - prev.z)}`], ['Width', `${(node.halfWidth * 2).toFixed(1)} m`], ['Channel depth', `${node.depth.toFixed(1)} m`], ['Gradient', run > 0 ? `${((drop / run) * 100).toFixed(1)}%` : '—'], ['Catchment', `${(river.flow / 1e6).toFixed(2)} km²`])
      if (node.fall) rows.push(['Cascade', pct(node.fall)])
      if (river.rim && best.k >= river.nodes.length - 2) rows.push(['Leaves', 'over the island edge'])
      return { title: `River ${best.r + 1}`, tag: label(cat), rows, cat }
    }
    rows.push(elevation, ['Nearest river', best.r >= 0 ? `${Math.max(0, best.d).toFixed(0)} m` : '—'])
    return { title: 'Land', tag: '', rows, cat: 3 }
  }
  if (kind !== PROBE_KIND.terrain) {
    const what = kind === PROBE_KIND.water ? 'Water' : kind === PROBE_KIND.architecture ? 'Living architecture' : kind === PROBE_KIND.plant ? 'Plant' : kind === PROBE_KIND.shell ? 'Island edge' : 'Nothing'
    if (id === 'sun-0' && cat >= 0) {
      rows.push(['Sun off normal', deg(Math.acos(Math.max(-1, Math.min(1, val * 2 - 1))))])
      return { title: label(cat), tag: what, rows, cat }
    }
    // (Round 08H: a surface the view is not about gives no card at all, rather than one that says so.)
    return null
  }
  if (id === 'ground-0') {
    const [r, g, b, a] = texAt('ground', x, z)
    const sum = Math.min(1, r + g + b + a)
    rows.push(['Woodland floor', pct(r)], ['Moss', pct(g)], ['Meadow', pct(b)], ['Shore gravel', pct(a)], ['Bare rock', pct(1 - sum)], elevation)
    return { title: label(cat), tag: `${pct(val)} share`, rows, cat }
  }
  if ((id === 'ground-1' || id === 'ground-2') && f) {
    const i = Math.min(f.n - 1, Math.max(0, Math.floor((x - f.x0) / f.cell)))
    const j = Math.min(f.n - 1, Math.max(0, Math.floor((z - f.x0) / f.cell)))
    const k = j * f.n + i
    if (id === 'ground-1') {
      const h = habitatAt(f, i, j)
      // A plant habitat zone: how the vegetation rules sort this ground (vegPlants.ts › zonesOf), from what it is computed from. Animals and the
      // Living Architecture read their own measures, not these zones.
      const zones = ZONE_KEYS.map((key) => [ZONE_LABEL[key], h.zones[key]] as const).sort((p, q) => q[1] - p[1])
      rows.push(['From', `light ${pct(f.light[k]!)} · moisture ${pct(f.moisture[k]!)}`], ['Best plant fit', h.suited < 0.06 ? 'none (too steep, wet or bare)' : pct(h.suited)])
      for (const [name, m] of zones.slice(0, 3)) rows.push([`Zone: ${name}`, m.toFixed(2)])
      rows.push(['Slope', f.slope[k]!.toFixed(2)], ['To water', `${Math.round(f.waterDist[k]!)} m`], ['Height', `${Math.round(f.height[k]!)} m`])
      return { title: label(cat), tag: 'plant habitat zone', rows, cat }
    }
    // (The view draws each 16 m cell's own value: the title is what it drew, val; the cell's neighbours blend in only between cells.)
    rows.push(['Blended here', islandSample(f, f.moisture, x, z).toFixed(2)], ['To water', `${Math.round(f.waterDist[k]!)} m`], ['Slope', f.slope[k]!.toFixed(2)], elevation)
    return { title: `Moisture ${val.toFixed(2)}`, tag: 'of 1', rows, cat: 0 }
  }
  if (id === 'geology-0' || id === 'geology-1') {
    const [gr, gg, gb, ga] = texAt('geology', x, z)
    const slope = gr * 3
    if (id === 'geology-1') {
      const rule = slope < 0.5 ? 'gentle: weathers pale' : slope < 0.95 ? 'weathering fading, beds emerging' : slope < 1.6 ? 'fresh face, beds at full width' : slope < 2.6 ? 'cliff: iron staining' : 'cliff: fully stained'
      rows.push(['Angle', deg(Math.atan(slope))], ['Rule band', rule], elevation, position)
      return { title: `Slope ${slope.toFixed(2)}`, tag: 'rise / run', rows, cat: 0 }
    }
    rows.push(['Height in stack', `${(val * 500).toFixed(0)} m`], ['Slope', `${slope.toFixed(2)} (${deg(Math.atan(slope))})`], ['Convexity', `${((gg - 0.5) * 24).toFixed(1)} m`], ['Cliff above', gb > 0.02 ? pct(gb) : 'none'], ['Near water', pct(ga)], elevation)
    return { title: label(cat), tag: 'bare rock', rows, cat }
  }
  if (id === 'sun-0') {
    const sun = environment.state.sun
    const az = sunAt(environment.controls.hour, environment.controls.noonElevation).azimuth
    rows.push(['Sun off normal', deg(Math.acos(Math.max(-1, Math.min(1, val * 2 - 1))))], ['Sun height', `${sun.elevation.toFixed(1)}°`], ['Sun from', `${bearing(Math.sin((az * Math.PI) / 180), Math.cos((az * Math.PI) / 180))} (${Math.round(az)}°)`], ['Cloud', pct(environment.state.cloud)], elevation)
    return { title: label(cat), tag: 'now', rows, cat }
  }
  if (id === 'ecolight-0' && f) {
    const light = islandSample(f, f.light, x, z)
    const [, moss] = texAt('ground', x, z)
    const sd = shadeAt(x, z)
    // Which shade it is: a structure's (lasting, from its own form), the terrain's (a valley or north face the sun barely reaches), or none.
    const kind = sd > 0.15 ? 'A structure’s lasting shade' : light < 0.45 ? 'Terrain shade' : light > 0.75 ? 'Sun most of the day' : 'Part sun, part shade'
    rows.push(['Day’s sun', pct(light)], ['Structure shade', sd > 0.02 ? pct(sd) : 'none'], ['Ground cover', moss > 0.4 ? 'moss and fern: shade plants' : 'open-ground plants'], elevation)
    return { title: kind, tag: 'over the whole day', rows, cat: sd > 0.15 ? 1 : 0 }
  }
  if (id === 'ecolight-1') {
    for (const tile of shared.tiles.values()) {
      const reg = tile.fields.region
      if (!tile.habitat || x < reg.x0 || z < reg.z0 || x >= reg.x0 + reg.n * reg.cell || z >= reg.z0 + reg.n * reg.cell) continue
      const k = Math.floor((z - reg.z0) / reg.cell) * reg.n + Math.floor((x - reg.x0) / reg.cell)
      const fp = tile.habitat.footprint[k]!
      const sh = tile.habitat.shelter[k]!
      const sd = tile.habitat.shade[k]!
      rows.push(['Footprint', fp > 0 ? 'yes' : 'no'], ['Sheltered', sh > 0 ? pct(sh) : 'no'], ['Shade', pct(sd)], ['Light here', pct(sampleField(reg, tile.fields.light, x, z))])
      const c = fp > 0 ? 0 : sh > 0 ? 1 : sd > 0.02 ? 2 : -1
      return { title: c >= 0 ? label(c) : 'Open ground', tag: 'near the camera', rows, cat: c }
    }
    // (Away from any structure's reach there is nothing to report but the open ground itself.)
    return { title: 'Open ground', tag: 'no structure nearby', rows: [elevation], cat: -1 }
  }
  rows.push(elevation, position)
  return { title: label(cat), tag: '', rows, cat }
}

/**
 * POINT & INSPECT (Round 08F): what is at a place, in five parts, from the data the world is made of (not from the picture): the terrain and its
 * rock, the colour the final render gives the ground and the rule that gives it, the vegetation, the water, and the light, where the sun's cast
 * shadow NOW (a ray traced to the sun through the terrain) is kept apart from the ECOLOGICAL light (the share of the whole day's sun, which is
 * what the plants grow on). The rock unit follows the same stack the geology rules use (elevation, dipping 2 %); their slow ±12 m warp is not
 * repeated here, so a place within a few metres of a unit's edge may read as its neighbour.
 */
const STRATA_AT: [number, number, string][] = [[150, 9, 'Lower/Middle Sandstone boundary'], [236, 12, 'middle bed'], [328, 7, 'Caprock base']]
/**
 * PLANTS, INSPECTED (integration round 13). The plant the pointer's ray meets: of the plants the world draws near where the ray reaches the ground
 * (the same placement, creatureHabitat.ts › foodNear), the one whose stem, from its base to its full height, passes closest to the ray, within
 * its crown. Its card says what the placement knows: species and layer, growth stage and the light form it grew in, the light where it stands
 * (and whose shade that is), what light it prefers (the Vegetation Lab's catalogue), its habitat, and why it grows there.
 */
const ALL_PLANTS = new Set<SpeciesId>(PLANTS.filter((p) => p.id !== 'vine' && p.id !== 'curtain').map((p) => p.id))
const FORM_NAME: Record<number, string> = { 0: 'young', 1: 'deep-shade form', 2: 'sun form', 3: 'exposed form (dry, windy)', 4: 'old', [PART_VARIANT]: 'partial-shade form' }
const LAYER: Record<string, string> = { tall: 'Tree (canopy)', shrub: 'Shrub (understory)', cover: 'Ground cover' }
const PREFERS: Record<string, string> = { sun: 'Sun: it thins out in shade', shade: 'Shade: a shade specialist', broad: 'Sun or shade: it tolerates both' }
const nearCache = new Map<string, ReturnType<typeof foodNear>>()
export function plantHit(ray: Ray, ground: Vector3 | null): { id: SpeciesId; x: number; y: number; z: number; v: number; d: number } | null {
  if (!ground) return null
  // (Cached per 4 m of ground and decade: the hover asks every 70 ms, and the placement is the same for the same ground and year.)
  const key = `${Math.round(ground.x / 4)},${Math.round(ground.z / 4)},${Math.floor(environment.controls.year / 10)}`
  let near = nearCache.get(key)
  if (!near) {
    near = foodNear(Math.round(ground.x / 4) * 4, Math.round(ground.z / 4) * 4, 16, ALL_PLANTS)
    if (nearCache.size > 200) nearCache.clear()
    if (near.length) nearCache.set(key, near)
  }
  let best: { id: SpeciesId; x: number; y: number; z: number; v: number; d: number } | null = null
  const a = new Vector3()
  const b = new Vector3()
  const onRay = new Vector3()
  const onSeg = new Vector3()
  for (const p of near) {
    const info = speciesInfo(p.id)
    const h = Math.max(0.3, info.height * p.s * (p.v === 0 ? 0.6 : 1))
    const y = landscapeHeight(p.x, p.z)
    a.set(p.x, y, p.z)
    b.set(p.x, y + h, p.z)
    const d2 = ray.distanceSqToSegment(a, b, onRay, onSeg)
    const reach = Math.max(0.5, h * (info.group === 'tall' ? 0.32 : 0.45))
    if (d2 > reach * reach) continue
    const along = onRay.distanceTo(ray.origin)
    if (!best || along < best.d) best = { id: p.id, x: p.x, y: y + h * 0.55, z: p.z, v: p.v, d: along }
  }
  // (A plant only if it stands before the ground the ray reaches: never one hidden behind a hill.)
  return best && best.d <= ground.distanceTo(ray.origin) + 2 ? best : null
}
export function inspectPlant(hit: { id: SpeciesId; x: number; z: number; v: number }): { title: string; tag: string; sections: CardSection[]; summary: [string, string][] } | null {
  const f = shared.island
  if (!f) return null
  const info = speciesInfo(hit.id)
  const base = islandAt(f)(hit.x, hit.z, landscapeHeight(hit.x, hit.z))
  const sd = shadeAt(hit.x, hit.z)
  const e = effective(base.light, base.moisture, sd, 0)
  const c = { ...base, light: e.light, moisture: e.moisture, shade: sd }
  const zones = zonesOf(c)
  const zone = ZONE_KEYS.reduce((m, k) => (zones[k] > zones[m] ? k : m))
  const source = sd > 0.15 ? 'a structure keeps the sun off it' : base.light < 0.45 ? 'the terrain keeps the sun off it (a valley or north face)' : base.light > 0.75 ? 'open to the sun most of the day' : 'part sun, part shade'
  const form = FORM_NAME[hit.v] ?? 'mature'
  const stage = hit.v === 0 ? 'Young' : hit.v === 4 ? 'Old' : 'Mature'
  const L = pct(c.light)
  const why =
    info.light === 'shade'
      ? `A shade specialist: little sun reaches this ground (${L} of the day), and it is damp enough (${pct(c.moisture)}).`
      : info.light === 'sun'
        ? c.light > 0.66
          ? `A sun plant on well-lit ground (${L} of the day's sun).`
          : `A sun plant at the shaded edge of its range (${L} of the day's sun): it grows here in its ${form}, thinner than in the open.`
        : `It tolerates sun and shade; the ${L} of the day's sun here gave it its ${form}.`
  return {
    title: info.name,
    tag: `${stage} · ${LAYER[info.group] ?? info.group}`,
    summary: [
      ['Light here', `${L} of the day's sun: ${source}`],
      ...(info.form ? [['Form', info.form] as [string, string]] : []),
      ['Grown as', form],
      ['Prefers', PREFERS[info.light] ?? PREFERS.broad!],
      ['Habitat', ZONE_LABEL[zone]],
      ['Why here', `${why}${c.waterDist < 25 ? ` Water is ${Math.round(c.waterDist)} m off.` : ''}`],
    ],
    sections: [],
  }
}

export function inspectAt(x: number, z: number, world: World): { title: string; tag: string; sections: CardSection[]; summary: [string, string][]; y: number } {
  const y = landscapeHeight(x, z)
  const [gr, gg] = texAt('geology', x, z)
  const slope = gr * 3
  const convex = (gg - 0.5) * 24
  const [wFloor, wMoss, wMead, wShore] = texAt('ground', x, z)
  const f = shared.island
  const stack = y + 0.012 * x + 0.016 * z
  const unit = stack < 150 ? 'Lower Sandstone (warm, iron-tinged)' : stack < 330 ? 'Middle Sandstone (paling upward)' : 'Caprock (pale, resistant)'
  const bed = STRATA_AT.find(([h, w]) => Math.abs(stack - h) < w * 1.35)
  const bedShows = !!bed && slope >= 0.58
  const landform = convex > 5 ? 'crest or spur' : convex < -5 ? 'hollow or footslope' : slope > 1.3 ? 'cliff face' : slope > 0.45 ? 'slope' : 'gentle ground'
  const depth = world.water.depthAt(x, z)
  // The ground's colour, as the Black Stage decides it (stageGround: woodland and moss cut at 0.41, meadow at 0.40, shore gravel at 0.57,
  // the greens held to gentler ground by the geology map's slope; otherwise bare rock, coloured by the geology rules).
  const flat = 1 - Math.min(1, Math.max(0, (slope - 0.45) / 0.7))
  const dark = Math.max(wFloor * flat, wMoss * (0.45 + 0.55 * flat))
  let colour: [string, string]
  if (depth > 0) colour = ['Water', 'teal by depth: pale where the sandy bed shows through, deep teal over the basin']
  else if (dark >= 0.41) colour = [wMoss > wFloor ? 'Moss (olive-deep, greener)' : 'Woodland floor (olive-deep)', `woodland/moss weight ${dark.toFixed(2)} ≥ 0.41`]
  else if (wMead * flat >= 0.4) colour = ['Meadow (olive)', `meadow weight ${(wMead * flat).toFixed(2)} ≥ 0.40; paler where the sward thins`]
  else if (wShore >= 0.57) colour = ['Shore sand', `shoreline weight ${wShore.toFixed(2)} ≥ 0.57`]
  else if (bedShows) colour = ['Terracotta (mudstone bed)', `a soft red bed near ${bed![0]} m, exposed because the slope (${slope.toFixed(2)}) cuts through it`]
  else if (slope > 1.6) colour = ['Iron-stained rock', `slope ${slope.toFixed(2)} > 1.6: the steepest faces stain toward terracotta`]
  else if (slope < 0.5 || convex > 5) colour = ['Pale weathered rock', 'gentle bare rock and crests weather to an ivory rind']
  else colour = ['Sandstone', `bare rock of the ${unit.split(' (')[0]}, its colour by height in the stack`]
  const sections: CardSection[] = []
  sections.push({ head: 'Terrain', rows: [['Elevation', `${y.toFixed(1)} m`], ['Slope', `${slope.toFixed(2)} (${deg(Math.atan(slope))})`], ['Landform', landform], ['Rock unit', unit], ...(bed ? [['Mudstone bed', bedShows ? `exposed, ${bed[2]}` : `buried (slope under 0.58)`] as [string, string]] : [])] })
  // (The colour and its reason lead the callout: its title and the summary's first line.)
  const veg: [string, string][] = [['Ground weights', `woodland ${pct(wFloor)}, moss ${pct(wMoss)}, meadow ${pct(wMead)}, shore ${pct(wShore)}`]]
  if (f) {
    const i = Math.min(f.n - 1, Math.max(0, Math.floor((x - f.x0) / f.cell)))
    const j = Math.min(f.n - 1, Math.max(0, Math.floor((z - f.x0) / f.cell)))
    const h = habitatAt(f, i, j)
    const zone = h.index === 6 ? 'nothing suited (bare)' : `${ZONE_LABEL[ZONE_KEYS[h.index]!]} (${h.strength.toFixed(2)})`
    veg.push(['Habitat', zone], ['Moisture', f.moisture[j * f.n + i]!.toFixed(2)])
  }
  sections.push({ head: 'Vegetation', rows: veg })
  const water: [string, string][] = []
  if (depth > 0) water.push(['Lake', `${depth.toFixed(1)} m deep`])
  let near = Infinity
  for (const river of world.rivers.rivers) for (const node of river.nodes) near = Math.min(near, Math.hypot(node.x - x, node.z - z) - node.halfWidth)
  water.push(['Nearest river', near <= 0 ? 'in the channel' : `${Math.round(near)} m`])
  if (f) water.push(['To any water', `${Math.round(islandSample(f, f.waterDist, x, z))} m`])
  sections.push({ head: 'Water', rows: water })
  // Light: the cast shadow now (a ray from here toward the sun, through the terrain only: structures cast too, but are not traced here), and
  // the ecological light (the island's light field: the share of the whole day's sun past the terrain's horizon).
  const sun = environment.state.sun
  const [sx, sy, sz] = sun.direction
  let castNow = 'sun below the horizon'
  if (sun.elevation > -1) {
    let blockedAt = -1
    for (let s = 2; s < 5000; s += Math.min(25, 1 + s * 0.03)) {
      const qy = y + 0.5 + sy * s
      if (qy > 900) break
      if (landscapeHeight(x + sx * s, z + sz * s) > qy) {
        blockedAt = s
        break
      }
    }
    const az = sunAt(environment.controls.hour, environment.controls.noonElevation).azimuth
    // Which way the ground itself faces the sun (its own slope, over 4 m): a face turned away is not in a cast shadow, it is simply unlit.
    const e = 2
    const nx = landscapeHeight(x - e, z) - landscapeHeight(x + e, z)
    const nz = landscapeHeight(x, z - e) - landscapeHeight(x, z + e)
    const facing = (nx * sx + 2 * e * sy + nz * sz) / Math.hypot(nx, 2 * e, nz)
    castNow = facing < 0.03 ? 'none: the slope faces away from the sun' : blockedAt > 0 ? `in the shadow of terrain ${Math.round(blockedAt)} m toward ${bearing(Math.sin((az * Math.PI) / 180), Math.cos((az * Math.PI) / 180))}` : 'in sun'
  }
  const light: [string, string][] = [['Cast shadow now', castNow], ['Sun now', `${sun.elevation.toFixed(1)}° high`]]
  if (f) light.push(["Day's light (ecology)", `${pct(islandSample(f, f.light, x, z))} of the day's sun`])
  const sd = shadeAt(x, z)
  if (sd > 0.01) light.push(['Structure shade (day)', pct(sd)])
  sections.push({ head: 'Light', rows: light })
  // The callout's first lines (Round 08G): what it is, why it looks so, the ground and the light at a glance; the sections are the details.
  const summary: [string, string][] = [
    ['Why', colour[1]],
    ['Ground', `${y.toFixed(0)} m · ${deg(Math.atan(slope))} · ${landform}`],
    ['Light now', castNow],
  ]
  if (f) summary.push(["Day's light", `${pct(islandSample(f, f.light, x, z))} (ecology)`])
  return { title: colour[0], tag: depth > 0 ? `lake, ${depth.toFixed(1)} m deep` : unit.split(' (')[0]!, sections, summary, y: depth > 0 ? (world.water.surfaceAt(x, z) ?? y) : y }
}


/**
 * The structure under a ray (How It's Made, Round 08I): the Living Architecture meshes that carry a pick (the picker's own targets), tested
 * against their bounding spheres first and exactly only where a sphere is hit, so it is cheap enough for hover as well as for clicks.
 */
const sphereScratch = new Sphere()
function structureHit(ray: Raycaster, scene: Object3D): { pick: Exclude<Selection, null>; point: Vector3; distance: number } | null {
  const near: Mesh[] = []
  scene.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh || !m.userData?.pick || !m.visible || m.parent?.visible === false) return
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere()
    sphereScratch.copy(m.geometry.boundingSphere!).applyMatrix4(m.matrixWorld)
    if (ray.ray.intersectsSphere(sphereScratch)) near.push(m)
  })
  if (!near.length) return null
  const hit = ray.intersectObjects(near, false)[0]
  return hit ? { pick: hit.object.userData.pick as Exclude<Selection, null>, point: hit.point.clone(), distance: hit.distance } : null
}

/** A structure's card: its simulation state now (livingEcology.ts › organismState), as numbers; a root connection's, likewise. */
function inspectStructure(pick: Exclude<Selection, null>, point: Vector3): { title: string; tag: string; sections: CardSection[]; summary: [string, string][]; y: number } | null {
  const pop = currentPopulation()
  if (!pop) return null
  const c = environment.controls
  const time = worldYears(c.year, (c.day - 1) * 24 + c.hour)
  if (pick.kind === 'link') {
    const l = pop.links[pick.index]!
    const grown = Math.min(1, Math.max(0, (time - l.since) / 18))
    return {
      title: 'Root connection',
      tag: grown < 1 ? 'growing' : 'established',
      summary: [['Joins', `${pop.organisms[l.a]!.id} and ${pop.organisms[l.b]!.id}`], ['Since', `year ${l.since}`], ['Grown', pct(grown)], ['Span', `${Math.round(l.distance)} m`]],
      sections: [],
      y: point.y,
    }
  }
  const o = pop.organisms[pick.index]!
  const st = organismState(pop, pick.index, time)
  return {
    title: o.id,
    tag: st.stage,
    summary: [['Age', `${st.age.toFixed(1)} years`], ['Vigor', pct(st.vigor)], ['Light / moisture', `${pct(st.light)} / ${pct(st.moisture)}`], ['Root links', String(st.links.length)]],
    sections: [
      { head: 'Growth', rows: [['Established', `year ${o.established}`], ['Matures in', `${o.maturity.toFixed(0)} years at full vigor`], ['Growing', pct(st.grow)], ['Receding', pct(st.recede)]] },
      { head: 'Resources', rows: [['Resource', pct(st.resource)], ['Shade on it', pct(st.shade)], ['Draw', pct(st.draw)]] },
    ],
    y: point.y,
  }
}

/** Which of a place's properties each lens is about (inspectAt's sections), for a click's detailed reading. */
const LENS_SECTION: Record<string, string> = { geology: 'Terrain', water: 'Water', ground: 'Vegetation', sun: 'Light', ecolight: 'Light' }

/** `blocked`: Approach's area pick or Explore's place pick owns the pointer and its marker. */
export function DataProbe({ world, blocked: placeBlocked = false, mode = '' }: { world: World; blocked?: boolean; mode?: string }) {
  // Inspect lives in How It's Made only (Round 08I): in Explore World the probe does nothing.
  const experience = useExperience()
  const blocked = placeBlocked || experience !== 'made'
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const pending = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const last = useRef(0)
  const probeLast = useRef(0)
  const anchorScratch = useMemo(() => new Vector3(), [])
  const target = useMemo(() => new WebGLRenderTarget(1, 1), [])
  const probeCamera = useMemo(() => new PerspectiveCamera(), [])
  const ray = useMemo(() => new Raycaster(), [])
  const pixel = useMemo(() => new Uint8Array(4), [])
  useEffect(() => () => target.dispose(), [target])
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked
  // PLANTS IN THE PLAIN WORLD (round 14). Explore's plain world (no lens) runs the 'explore' experience, where the probe was off entirely, so a plant
  // could be inspected only under a lens. There, now, plants alone: hovering one names it, clicking one opens its card; everything else under the
  // pointer (a structure, a creature, the ground) is left to its own selection, untouched.
  // (Round 17: and only while the Vegetation drawer is open, vegInspect.ts: free exploration is never interrupted by plant readouts.)
  const plantsOnly = !placeBlocked && experience === 'explore'
  const plantsOnlyRef = useRef(plantsOnly)
  plantsOnlyRef.current = plantsOnly
  const plantsNow = () => plantsOnlyRef.current && vegInspect.get().on
  // A camera mode change or a placement taking the pointer ends any inspection in progress (no card, readout or crosshair carried over).
  useEffect(() => {
    setCard(null)
    setInspect(null)
    probeMarker.hide()
  }, [blocked, mode, experience])
  useEffect(() => {
    const element = gl.domElement
    let down: { x: number; y: number } | null = null
    // The lens's reading under the pointer as the button goes down (the hover readout is cleared by the press itself).
    let held: ReturnType<typeof getInspect> = null
    const press = (event: PointerEvent) => {
      plantClick.claimed = false
      down = event.button === 0 ? { x: event.clientX, y: event.clientY } : null
      held = getInspect()
    }
    const release = (event: PointerEvent) => {
      const start = down
      down = null
      // A click (not a drag): one card, for the structure under the pointer if there is one, else the place; a new click replaces it.
      if ((blockedRef.current && !plantsNow()) || !start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return
      const rect = element.getBoundingClientRect()
      const sx = event.clientX - rect.left
      const sy = event.clientY - rect.top
      ray.setFromCamera(new Vector2((sx / rect.width) * 2 - 1, -(sy / rect.height) * 2 + 1), camera as Camera)
      const hit = groundHit(ray.ray.origin, ray.ray.direction)
      if (blockedRef.current) {
        // Plants only: a structure in front is the structure's (its own selection); a plant opens its card; anywhere else closes a plant card.
        const st = structureHit(ray, scene)
        if (st && (!hit || st.distance < hit.distanceTo(ray.ray.origin))) return
        const plant = plantHit(ray.ray, hit)
        const read = plant ? inspectPlant(plant) : null
        if (plant && read) {
          // (Round 18: the drawer is the plant's persistent card. No world card: one open hid the hover readout, so inspection seemed to stop after
          // the first click. And the click is the plant's alone: it no longer reaches the world's own click handlers, which moved the camera.)
          // (Only the click event that follows is stopped: the pointerup itself must reach the orbit controls, or they stay mid-drag and the next
          // mouse movement turns the camera.)
          swallowClick = true
          plantClick.claimed = true
          vegInspect.show({ title: read.title, tag: read.tag, summary: read.summary })
        }
        return
      }
      const explore = getExplore()
      if (explore.view !== 'final') {
        // A LENS: the click keeps that lens's reading, in full, with the part of the place's properties the lens is about (its terrain, water,
        // vegetation or light), and nothing else. Off the island, or where the lens has nothing to say, it clears.
        if (!hit || !held) {
          setCard(null)
          return
        }
        const head = LENS_SECTION[explore.view]
        const about = inspectAt(hit.x, hit.z, world).sections.filter((sec) => sec.head === head)
        setCard({ sx, sy, w: rect.width, h: rect.height, x: hit.x, z: hit.z, y: landscapeHeight(hit.x, hit.z), title: held.title, tag: held.tag, summary: held.rows, sections: about, full: true })
        return
      }
      // ALL PROPERTIES: a structure's state, or everything known at the place, opened in full.
      const structure = structureHit(ray, scene)
      if (structure && (!hit || structure.distance < hit.distanceTo(ray.ray.origin))) {
        const read = inspectStructure(structure.pick, structure.point)
        if (read) {
          setCard({ sx, sy, w: rect.width, h: rect.height, x: structure.point.x, z: structure.point.z, ...read, full: true })
          return
        }
      }
      // A plant: its own card (the ray meets its stem and crown before the ground).
      const plant = plantHit(ray.ray, hit)
      if (plant) {
        const read = inspectPlant(plant)
        if (read) {
          setCard({ sx, sy, w: rect.width, h: rect.height, x: plant.x, y: plant.y, z: plant.z, ...read, full: true })
          return
        }
      }
      if (!hit) {
        setCard(null)
        return
      }
      // (Titled as the place, not by its ground colour's rule: that is one property among the rest, its first line.)
      const all = inspectAt(hit.x, hit.z, world)
      setCard({ sx, sy, w: rect.width, h: rect.height, x: hit.x, z: hit.z, ...all, title: 'At this place', tag: all.tag, summary: [['Surface', all.title], ...all.summary], full: true })
    }
    // (The release is heard before the world's own handlers, on the canvas's parent in the capture phase, so a plant's click can stop there; the
    // click event that follows it is stopped too.)
    const host = element.parentElement ?? element
    let swallowClick = false
    const click = (event: MouseEvent) => {
      if (!swallowClick) return
      swallowClick = false
      event.stopPropagation()
      event.preventDefault()
    }
    element.addEventListener('pointerdown', press)
    host.addEventListener('pointerup', release, true)
    host.addEventListener('click', click, true)
    // Round 08H, ONE RULE FOR HOVER: the readout follows the pointer whenever a data layer is shown, whether or not Point & Inspect is on
    // (that switch only adds click-to-pin). The probe's own crosshair (a DOM mark at the pointer, not Explore's ground ring) shows where a
    // reading is taken, while a layer is shown or pinning is on, over the island only. A held button is a drag: no reading, no crosshair.
    const move = (event: PointerEvent) => {
      if (blockedRef.current && !plantsNow()) {
        probeMarker.hide()
        return
      }
      if (event.buttons !== 0) {
        pending.current = null
        setInspect(null)
        probeMarker.hide()
        return
      }
      const rect = element.getBoundingClientRect()
      pending.current = { x: event.clientX - rect.left, y: event.clientY - rect.top, w: rect.width, h: rect.height }
      probeMarker.move(pending.current.x, pending.current.y)
    }
    const clear = () => {
      pending.current = null
      setInspect(null)
      probeMarker.hide()
    }
    const leave = clear
    element.addEventListener('pointermove', move, { passive: true })
    element.addEventListener('pointerleave', leave)
    element.addEventListener('pointerdown', clear)
    element.addEventListener('wheel', clear, { passive: true })
    return () => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerleave', leave)
      element.removeEventListener('pointerdown', clear)
      element.removeEventListener('wheel', clear)
      element.removeEventListener('pointerdown', press)
      host.removeEventListener('pointerup', release, true)
      host.removeEventListener('click', click, true)
      probeMarker.hide()
    }
  }, [gl, camera, ray, world, scene])
  useFrame(() => {
    // The callout's anchor: the clicked place, projected each frame, so the marker and its line stay on it as the camera moves.
    const c = getCard()
    if (c) {
      const v = anchorScratch.set(c.x, c.y, c.z).project(camera)
      calloutAnchor.x = ((v.x + 1) / 2) * gl.domElement.clientWidth
      calloutAnchor.y = ((1 - v.y) / 2) * gl.domElement.clientHeight
      calloutAnchor.visible = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05
    }
    const p = pending.current
    if (!p || (blockedRef.current && !plantsNow())) return
    const now = performance.now()
    // (The ring every 30 ms, the probe's pixel every 70: the ring is a cheap march; drawing the scene for one pixel is not.)
    if (now - last.current < 30) return
    const probeDue = now - probeLast.current >= 70
    last.current = now
    if (blockedRef.current) {
      // Plants only: the plant under the pointer, named, with a hint that a click explains it; nothing for anything else (no crosshair).
      if (!probeDue) return
      pending.current = null
      probeLast.current = now
      ray.setFromCamera(new Vector2((p.x / p.w) * 2 - 1, -(p.y / p.h) * 2 + 1), camera as Camera)
      const ground = groundHit(ray.ray.origin, ray.ray.direction)
      const st = structureHit(ray, scene)
      const plant = st && (!ground || st.distance < ground.distanceTo(ray.ray.origin)) ? null : plantHit(ray.ray, ground)
      const read = plant ? inspectPlant(plant) : null
      // (The mark at the pointer only while it is on a plant: hover identifies; it never moves anything.)
      if (read) probeMarker.show()
      else probeMarker.hide()
      setInspect(read ? { sx: p.x, sy: p.y, w: p.w, h: p.h, title: read.title, tag: read.tag, rows: [['Light here', read.summary[0]![1].split(':')[0]!], ['', 'Click: why it grows here']], cat: -1, val: 0 } : null)
      return
    }
    const explore = getExplore()
    // The crosshair shows only over the island (a reading or a pin needs ground under it).
    ray.setFromCamera(new Vector2((p.x / p.w) * 2 - 1, -(p.y / p.h) * 2 + 1), camera as Camera)
    if (groundHit(ray.ray.origin, ray.ray.direction)) probeMarker.show()
    else {
      probeMarker.hide()
      setInspect(null)
    }
    // (The last position is kept until the probe has read it, so the reading always catches up with a pointer that has stopped.)
    if (explore.view === 'final') {
      // The normal render has no layer to read: the hover readout is the place's (or the structure's) card title and first line.
      if (!probeDue) return
      pending.current = null
      probeLast.current = now
      const ground = groundHit(ray.ray.origin, ray.ray.direction)
      const structure = structureHit(ray, scene)
      const onStructure = structure && (!ground || structure.distance < ground.distanceTo(ray.ray.origin))
      // (Hovering a plant names it, with a hint that a click opens its card.)
      const plant = onStructure ? null : plantHit(ray.ray, ground)
      const plantRead = plant ? inspectPlant(plant) : null
      const read = onStructure ? inspectStructure(structure.pick, structure.point) : plantRead ? { ...plantRead, summary: [['Light here', plantRead.summary[0]![1].split(':')[0]!], ['', 'Click for why it grows here']] as [string, string][] } : ground ? inspectAt(ground.x, ground.z, world) : null
      setInspect(read ? { sx: p.x, sy: p.y, w: p.w, h: p.h, title: read.title, tag: read.tag, rows: read.summary.slice(0, 1), cat: -1, val: 0 } : null)
      return
    }
    if (!probeDue) return
    pending.current = null
    probeLast.current = now
    // The one pixel, drawn with the probe on.
    probeCamera.copy(camera as PerspectiveCamera)
    // (The main camera may carry a lens shift (terrain.ts › overviewFraming): the pixel under the pointer is then that much further across.)
    const shift = (camera as PerspectiveCamera).view
    const ox = shift?.enabled ? shift.offsetX : 0
    const oy = shift?.enabled ? shift.offsetY : 0
    probeCamera.setViewOffset(p.w, p.h, Math.floor(p.x + ox), Math.floor(p.y + oy), 1, 1)
    probeCamera.updateProjectionMatrix()
    const before = gl.getRenderTarget()
    // Phase 1 QA: the probe's bytes are data, and the distance haze was mixed into them like a colour (mist.ts runs after the views). A percent of
    // haze took one off the red byte: far water (64) read as terrain of an unknown category (63), far bare rock as shore gravel, and the card and
    // the highlight were wrong over the far half of the island from Overview. For this one pixel the haze is pushed out of range and the mist off.
    const fog = scene.fog instanceof Fog ? scene.fog : null
    const held = { near: fog?.near ?? 0, far: fog?.far ?? 0, mist: styleUniforms.uStyMist.value }
    if (fog) {
      fog.near = 1e9
      fog.far = 2e9
    }
    styleUniforms.uStyMist.value = 0
    diagUniforms.uDiagProbe.value = 1
    gl.setRenderTarget(target)
    gl.render(scene, probeCamera)
    gl.readRenderTargetPixels(target, 0, 0, 1, 1, pixel)
    gl.setRenderTarget(before)
    diagUniforms.uDiagProbe.value = 0
    styleUniforms.uStyMist.value = held.mist
    if (fog) {
      fog.near = held.near
      fog.far = held.far
    }
    const kind = pixel[0]! >> 5
    const cat = (pixel[0]! & 31) - 1
    const val = (pixel[1]! * 256 + pixel[2]!) / 65535
    // (A category beyond the legend is not a reading: a blended pixel, such as a translucent fall over the ground.)
    const legend = DIAG_LEGENDS[`${explore.view}-${explore.sub}`]
    if (kind < 1 || kind > 5 || (legend?.kind === 'cat' && cat >= legend.items.length)) {
      setInspect(null)
      return
    }
    // Where on the ground (or the water's surface) that pixel is.
    ray.setFromCamera(new Vector2((p.x / p.w) * 2 - 1, -(p.y / p.h) * 2 + 1), camera as Camera)
    const hit = groundHit(ray.ray.origin, ray.ray.direction)
    if (!hit) {
      setInspect(null)
      return
    }
    const id = `${explore.view}-${explore.sub}`
    const read = describe(id, kind, cat, val, hit.x, hit.z, landscapeHeight(hit.x, hit.z), world)
    setInspect(read ? { sx: p.x, sy: p.y, w: p.w, h: p.h, ...read, val } : null)
  })
  return null
}
