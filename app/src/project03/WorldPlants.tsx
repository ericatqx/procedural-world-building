import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { BufferGeometry, Box3, Frustum, type Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { environment } from './environment.ts'
import { applyMist } from './mist.ts'
import { applyPlantStyle, specialiseStyle } from './visualStyle.ts'
import { relColour } from './worldMaterials.ts'
import { PART_VARIANT } from './worldPlants.ts'
import { islandAt } from './Vegetation.tsx'
import { shared } from './vegShared.ts'
import { setVegetation, vegetationState } from './vegStore.ts'
import { riverEdgeField } from './vegRivers.ts'
import { buildRegionFields, sampleField, type RegionFields } from './vegFields.ts'
import { readHabitat, type Habitat } from './vegHabitat.ts'
import { dropHabitatTile, setHabitatTile } from './archGround.ts'
import { creatureCam } from './creatureCam.ts'
import { SPECIES, STRIDE, VARIANTS, growVariant, plantsInTile, tint, type Species, type SpeciesId, type TileInstances, type Water } from './worldPlants.ts'
import { effective, zonesOf, type Conditions } from './vegPlants.ts'
import type { LodLevel } from '../vegetation-lab/geo.ts'
import type { World } from './world.ts'
import { loading } from './loading.ts'

/** When each layer begins, in a tile's growth (0 to 1), while a page grows the plants in by hand: ground cover, then shrubs, then trees. */
const LAYER_START: Record<string, number> = { cover: 0, shrub: 0.25, tall: 0.45 }

/**
 * Shadow Ecology 0.3 — the Lab plants on the island (rules and species in worldPlants.ts).
 *
 * WHO IS WHERE is decided once, from the island's fields, the seed, the year and Living Architecture, and never by the camera:
 *   island tiles (256 m)   every plant that is drawn at a distance, over the whole island, from the island's 16 m fields
 *   architecture tiles     96 m tiles around whatever Living Architecture is drawn, wherever the camera is. They re-decide the same
 *                          sites with what the structure does to the ground: its FOOTPRINT (nothing grows on it), its SHADE (light),
 *                          its SHELTER (wind and rain cover, which keeps the ground damp and spares plants the exposed form).
 *                          They replace the island tile's plants inside their squares; outside any influence they give the same plants.
 *   mat tiles              the ground mats a few centimetres tall, around the camera (they are drawn only close up)
 * HOW EACH IS DRAWN is the only thing the camera chooses, and it is the same plant at every level. The Lab's generator is run once
 * per level from the same seed: Full (every stem and leaf), Reduced and Distant (fewer sides and segments, thin twigs left out, leaves
 * merged into masses where they were; see vegetation-lab/geo.ts). Each plant takes its level from its distance to the CAMERA, with a
 * band of hysteresis remembered per plant so it does not flip at a threshold. The switch is direct: the levels share their structure.
 * Which plants are written to the GPU is also the camera's: tiles and plants outside the view (with a margin that grows with distance, for
 * the moment between two assemblies) are skipped, so their cost is not paid; their identity and level memory are untouched.
 * Clinging plants (vine, curtain) are placed on Living Architecture's actual surfaces, at vertices chosen by a hash of their position.
 */
const NEAR_TILE = 96
/** The plants that can carry the Glow of the visual experiments: those whose habitat is shade. */
const SHADE_LOVERS = new Set<SpeciesId>(['fern', 'ground', 'curtain'])
const ISLAND_TILE = 256
/** Most plants of one species and variant drawn at Reduced or Distant at once. */
const FAR_CAP = 10000
/** A plant must move this far, as a share of a threshold, past it before it changes level. */
const HYSTERESIS = 0.12
/** Plants nearer than this to the camera are always written, view or not (turning round must not reveal a bare ring). */
const ALWAYS = 40
/** Colour of an instance relative to the mean colour of the geometry it is drawn on, pulled most of the way to the target. */

/** `born`: when the tile first appeared (performance.now()), for growing it in (loading.ts › growIn); 0 when it needs no growing. */
type Stored = { ver: string; data: TileInstances; cx: number; cz: number; seen: number; half: number; ymin: number; ymax: number; born?: number }
/** How long a newly built tile takes to grow to full size, when growing in is on. */
const GROW_MS = 1600
/** One instanced mesh being filled: how many plants it holds this assembly, and how many the last. */
type Slot = { mesh: InstancedMesh; cap: number; n: number; was: number }
/** What a plant of a species, level and variant is drawn with (the nearest level that has been grown). */
type Pick = { level: number; slot: Slot; mean: [number, number, number] }

/** Mean vertex colour of a geometry. */
function meanColour(g: BufferGeometry): [number, number, number] {
  const col = g.getAttribute('color')
  const m: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < col.count; i += 1) {
    m[0] += col.getX(i)
    m[1] += col.getY(i)
    m[2] += col.getZ(i)
  }
  return [m[0] / col.count, m[1] / col.count, m[2] / col.count]
}

/** The levels a species is built at: mats are not drawn beyond Reduced, clinging plants only at Full. */
const levelsOf = (sp: Species): LodLevel[] => (!sp.spacing ? [0] : sp.far ? [0, 1, 2] : [0, 1])

/** The level a plant at distance `d` should be at, given the level it was at (so it changes only past a band around each threshold). */
function levelFor(sp: Species, d: number, was: number): number {
  let level = was === 255 ? (d < sp.lod[0] ? 0 : d < sp.lod[1] ? 1 : 2) : was
  while (level < 2 && d > sp.lod[level]! * (1 + HYSTERESIS)) level += 1
  while (level > 0 && d < sp.lod[level - 1]! * (1 - HYSTERESIS)) level -= 1
  return level
}

/** The conditions at a point under a structure's influence: the island's, with the structure's footprint, shade and shelter acting. */
export const withInfluence = (atIsland: (x: number, z: number, y: number) => Conditions, fields: RegionFields, hab: Habitat) => (x: number, z: number, y: number): Conditions => {
  const c = atIsland(x, z, y)
  const r = fields.region
  const i = Math.min(r.n - 1, Math.max(0, Math.floor((x - r.x0) / r.cell)))
  const j = Math.min(r.n - 1, Math.max(0, Math.floor((z - r.z0) / r.cell)))
  const shade = sampleField(r, hab.shade, x, z)
  const shelter = sampleField(r, hab.shelter, x, z)
  const e = effective(c.light, c.moisture, shade, shelter)
  c.light = e.light
  c.moisture = e.moisture
  c.shade = shade
  c.shelter = shelter
  c.footprint = hab.footprint[j * r.n + i]!
  // The air under the structure here, and within the reach of a crown: a tall plant keeps out of both.
  const clear = (px: number, pz: number) => {
    const pi = Math.floor((px - r.x0) / r.cell)
    const pj = Math.floor((pz - r.z0) / r.cell)
    return pi < 0 || pj < 0 || pi >= r.n || pj >= r.n ? Infinity : hab.ceiling[pj * r.n + pi]!
  }
  c.ceiling = hab.ceiling[j * r.n + i]!
  c.crown = Math.min(c.ceiling, clear(x + CROWN, z), clear(x - CROWN, z), clear(x, z + CROWN), clear(x, z - CROWN))
  return c
}

/** The squares whose plants are drawn from an architecture tile (with the structure's influence), by `ti,tj`: what a creature's food search reads (creatureHabitat.ts). */
export const plantSquares = { arch: new Set<string>() }

/** How far a tall plant's crown reaches from its trunk, for keeping it clear of a structure (metres). */
const CROWN = 3.5

/** Each plant's current level, kept beside its tile's rows (reset when the tile is rebuilt). */
const levels = new WeakMap<Float32Array, Uint8Array>()
const squareKey = (x: number, z: number) => (Math.floor(x / NEAR_TILE) + 512) * 1024 + (Math.floor(z / NEAR_TILE) + 512)

const stored = (ver: string, data: TileInstances, cx: number, cz: number, seen: number, half: number): Stored => {
  let ymin = Infinity
  let ymax = -Infinity
  for (const arr of data.values()) {
    for (let o = 1; o < arr.length; o += STRIDE) {
      const y = arr[o]!
      if (y < ymin) ymin = y
      if (y > ymax) ymax = y
    }
  }
  if (ymin > ymax) {
    ymin = 0
    ymax = 0
  }
  return { ver, data, cx, cz, seen, half, ymin, ymax }
}

export function WorldPlants({ world, root }: { world: World; root: RefObject<Group | null> }) {
  const group = useRef<Group>(null)
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: 2 })
    m.customProgramCacheKey = () => 'world-plants'
    m.onBeforeCompile = (shader) => {
      applyMist(shader)
      applyPlantStyle(shader, false)
    }
    specialiseStyle(m)
    return m
  }, [])
  /** The same, for the shade-loving plants (ferns, ground mats, the hanging curtain), which can also carry the Glow of the visual experiments (visualStyle.ts). */
  const shadeMaterial = useMemo(() => {
    const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: 2 })
    m.customProgramCacheKey = () => 'world-plants-shade'
    m.onBeforeCompile = (shader) => {
      applyMist(shader)
      applyPlantStyle(shader, true)
    }
    specialiseStyle(m)
    return m
  }, [])
  /** banks[species][level][variant]: the same plant grown at each level. */
  const banks = useRef(new Map<SpeciesId, (BufferGeometry | null)[][]>())
  /** The mean vertex colour of each geometry (`species:variant:level`): an instance's tint is relative to it. */
  const means = useRef(new Map<string, [number, number, number]>())
  const slots = useRef<Slot[]>([])
  /** picks[species][level][variant], resolved once per change of what has been grown, not per plant. */
  const picks = useRef<(Pick | null)[][][]>([])
  const grownCount = useRef(0)
  /** Every tile id that has been drawn this visit (so its plants are never grown in twice). */
  const everShown = useRef(new Set<string>())
  /** When the next geometry may be grown (the growth is paced: see the frame loop). */
  const nextGrowAt = useRef(0)
  /** Where the camera was when it last moved, and when (growth waits while it moves). */
  const camMoved = useRef({ x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, at: 0 })
  const pickedAt = useRef(-1)
  const attachSlots = useRef(new Map<string, Slot>())
  const queue = useRef<{ level: LodLevel; run: () => void }[]>([])
  /** Built tiles by id. A tile is kept and drawn until its replacement (a new year or architecture) is built, so nothing blinks out. */
  const tiles = useRef(new Map<string, Stored>())
  const pass = useRef(0)
  const lastKey = useRef('')
  /** Whether the current showing of the plants has been assembled at least once (until then the group is kept hidden). */
  const drawn = useRef(false)
  const lastMoveAt = useRef(0)
  const lastView = useRef('')
  const lastStore = useRef(0)
  const rivers = useRef<((x: number, z: number) => number) | null>(null)
  const lastBuild = useRef(0)
  const clock = useRef(0)
  /** The architecture's tiles and clinging sites, worked out when the architecture changes (not when the camera does). */
  const arch = useRef<{ ver: number; tiles: { ti: number; tj: number }[]; sites: Site[] }>({ ver: -1, tiles: [], sites: [] })
  /** The architecture's version, as the plants take it: after it has held still for a moment (it ticks all through a growth). */
  const archSeen = useRef({ seen: -1, at: 0, used: -1, usedAt: 0 })
  const frustum = useMemo(() => new Frustum(), [])
  const projView = useMemo(() => new Matrix4(), [])
  const aim = useMemo(() => new Vector3(), [])

  // The banks are grown one geometry a frame as the page loads: Distant first (it is what the overview shows), then Reduced, then Full.
  useEffect(() => {
    for (const level of [2, 1, 0] as LodLevel[]) {
      for (const sp of SPECIES) {
        if (!levelsOf(sp).includes(level)) continue
        if (!banks.current.has(sp.id)) banks.current.set(sp.id, [0, 1, 2].map(() => VARIANTS.map(() => null)))
        for (let v = 0; v < VARIANTS.length; v += 1) {
          queue.current.push({
            level,
            run: () => {
              const geo = growVariant(sp, v, level)
              means.current.set(`${sp.id}:${v}:${level}`, meanColour(geo))
              banks.current.get(sp.id)![level]![v] = geo
              grownCount.current += 1
            },
          })
        }
      }
    }
    const g = group.current
    const s = slots.current
    const a = attachSlots.current
    const bank = banks.current
    return () => {
      for (const slot of [...s, ...a.values()]) {
        g?.remove(slot.mesh)
        slot.mesh.dispose()
      }
      s.length = 0
      a.clear()
      for (const byLevel of bank.values()) for (const list of byLevel) for (const geo of list) geo?.dispose()
      material.dispose()
      shadeMaterial.dispose()
    }
  }, [material, shadeMaterial])

  const makeSlot = (geometry: BufferGeometry, cap: number, shadeLover = false): Slot => {
    const mesh = new InstancedMesh(geometry, shadeLover ? shadeMaterial : material, cap)
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3), 3)
    mesh.frustumCulled = false
    mesh.count = 0
    group.current?.add(mesh)
    return { mesh, cap, n: 0, was: 0 }
  }

  /** Resolves what every (species, level, variant) is drawn with, from the geometries grown so far (the nearest level that exists). */
  const resolvePicks = () => {
    SPECIES.forEach((sp, si) => {
      const by = banks.current.get(sp.id)
      const perLevel: (Pick | null)[][] = [[], [], []]
      for (let level = 0; level < 3; level += 1) {
        for (let v = 0; v < VARIANTS.length; v += 1) {
          let found: Pick | null = null
          if (by) {
            for (const l of [level, level + 1, level - 1, level + 2, level - 2]) {
              const geo = by[l]?.[v]
              const mean = means.current.get(`${sp.id}:${v}:${l}`)
              if (!geo || !mean) continue
              // Reuse the slot already made for this geometry.
              let slot = slots.current.find((s) => s.mesh.geometry === geo)
              if (!slot) {
                slot = makeSlot(geo, l === 0 ? sp.cap : FAR_CAP, SHADE_LOVERS.has(sp.id))
                slots.current.push(slot)
              }
              found = { level: l, slot, mean }
              break
            }
          }
          perLevel[level]![v] = found
        }
      }
      picks.current[si] = perLevel as (Pick | null)[][]
    })
    pickedAt.current = grownCount.current
  }

  useFrame(({ camera }, delta) => {
    const st = vegetationState()
    const g = group.current
    // ROUND 21, THE PLANTS NEVER SHOW A STALE FRAME. While hidden, nothing is assembled, so the instance buffers keep whatever was last drawn (the mature
    // plants of Home or Explore, or of the end of the last Formation). Shown again, they were drawn as they were until the next assembly, which waits
    // for its 120 ms throttle and for any plant geometry being grown that frame (100-250 ms): Formation's Vegetation stage opened on a flash of grown
    // plants before growing them from bare ground. Now a showing stays hidden until its first assembly, which is run at once, and that assembly shows it.
    const showIt = st.show && st.renderer === 'world'
    if (!showIt) drawn.current = false
    const fresh = showIt && !drawn.current
    if (g) g.visible = showIt && !fresh
    // Grow the next bank entry. Measured at load: the Lab's generators take 100 to 250 ms each, there are about 130 of them, and growing one every frame kept the page in long
    // tasks for most of the first twenty seconds (102 long tasks, 15.9 s of the first 21 s), so the first camera rotations stuttered. Now a growth is followed by a pause as long as
    // it took (about half the time to the camera and the tiles), spreading the same work over a longer time without a run of blocked frames.
    const nowMs = performance.now()
    // Round 03: a growth blocks its frame for 100-250 ms, which read as navigation lag in the first minute (a camera move or a glide to Approach stalled mid-way).
    // So growing waits while the camera is moving, and goes on once it has been still for a moment. (A creature camera is never still: there it goes on as before.)
    const cm = camMoved.current
    const p = camera.position
    const q = camera.quaternion
    if (Math.abs(p.x - cm.x) + Math.abs(p.y - cm.y) + Math.abs(p.z - cm.z) > 0.05 || Math.abs(q.x - cm.qx) + Math.abs(q.y - cm.qy) + Math.abs(q.z - cm.qz) + Math.abs(q.w - cm.qw) > 1e-4) {
      camMoved.current = { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, at: nowMs }
    }
    const settled = nowMs - camMoved.current.at > 350 || creatureCam.get().mode !== 'off'
    // Under a loading cover (loading.ts) only the Distant geometries are grown (the closer levels wait for the cover to lift, then grow as
    // before), several in a frame within its budget, and the tiles are not held back behind them.
    const growNow = queue.current.length > 0 && (!loading.covered || queue.current[0]!.level === 2)
    if (growNow && !fresh && nowMs >= nextGrowAt.current && settled) {
      do queue.current.shift()!.run()
      while (loading.covered && queue.current.length > 0 && queue.current[0]!.level === 2 && performance.now() - nowMs < 30)
      nextGrowAt.current = performance.now() + (loading.covered ? 0 : Math.max(30, performance.now() - nowMs))
      if (!loading.covered) return
    }
    if (!g || !showIt || !shared.focus.ready || !shared.island) return
    clock.current += delta
    // Under a loading cover (loading.ts) the tiles are built every frame and in bigger steps: the same tiles, sooner.
    if (!fresh && clock.current < (loading.covered ? 0 : 0.12)) return
    clock.current = 0
    const t0 = performance.now()
    const { x: fx, z: fz } = shared.focus
    const cx0 = camera.position.x
    const cy0 = camera.position.y
    const cz0 = camera.position.z
    camera.getWorldDirection(aim)
    // When the view last changed: tiles are built while it is still, so the camera never waits behind them.
    const view = `${Math.round(cx0 / 5)},${Math.round(cy0 / 5)},${Math.round(cz0 / 5)}|${Math.round(aim.x / 0.03)},${Math.round(aim.y / 0.03)},${Math.round(aim.z / 0.03)}`
    if (view !== lastView.current) {
      lastView.current = view
      lastMoveAt.current = t0
    }
    // Tiles are built while the view is still, so the camera never waits behind them: but a creature camera is never still (it tracks an animal), so there the near tiles are
    // built as it goes, within the frame's budget below, and plants do not pop in when it stops.
    const still = t0 - lastMoveAt.current > 250 || tiles.current.size < 12 || creatureCam.get().mode !== 'off'
    const island = shared.island
    const year = Math.floor(environment.controls.year / 10)
    const isLand = (x: number, z: number) => {
      const i = Math.floor((x - island.x0) / island.cell)
      const j = Math.floor((z - island.x0) / island.cell)
      return i >= 0 && j >= 0 && i < island.n && j < island.n && island.land[j * island.n + i] === 1
    }
    const atIsland = islandAt(island)
    if (!rivers.current) rivers.current = riverEdgeField(world)
    const water: Water = { depth: (x, z) => world.water.depthAt(x, z), edge: rivers.current }
    pass.current += 1
    const now = pass.current
    const archOn = st.influence && !!root.current

    // The architecture's tiles and clinging sites follow the architecture, not the camera.
    const av = archSeen.current
    if (av.seen !== shared.archVersion) {
      av.seen = shared.archVersion
      av.at = t0
    }
    // The plants follow the architecture once it has settled; one that keeps changing (Evolution playing) is followed every few seconds (not oftener: every refresh reads the architecture's vertices), so a growing structure never stays long over plants.
    if (av.used !== av.seen && (av.used < 0 || t0 - av.at > 1500 || t0 - av.usedAt > 6000)) {
      av.used = av.seen
      av.usedAt = t0
    }
    if (arch.current.ver !== av.used) arch.current = { ver: av.used, ...readArchitecture(root.current, world.seed) }
    const sig = `${year}|${av.used}`

    type Need = { id: string; ver: string; cx: number; cz: number; half: number; d: number; make: () => TileInstances }
    const needs: Need[] = []
    const wanted = new Set<string>()
    const dist = (x: number, z: number) => Math.hypot(x - fx, z - fz)
    const want = (id: string, ver: string, cx: number, cz: number, half: number, d: number, make: () => TileInstances) => {
      wanted.add(id)
      const have = tiles.current.get(id)
      if (have) have.seen = now
      if (!have) needs.push({ id, ver, cx, cz, half, d, make })
      else if (have.ver !== ver) needs.push({ id, ver, cx, cz, half, d: d + 100000, make })
    }
    if (archOn) {
      for (const { ti, tj } of arch.current.tiles) {
        const cx = (ti + 0.5) * NEAR_TILE
        const cz = (tj + 0.5) * NEAR_TILE
        // In distance order with the island's tiles (a little after one as near): the architecture tiles carry the structures' shade communities and the
        // shade the creatures and the ground read, so those near the view should not wait behind every island tile out to the far shore.
        want(`a:${ti},${tj}`, sig, cx, cz, NEAR_TILE / 2, dist(cx, cz) + 120, () => {
          const fields = buildRegionFields(world, cx, cz)
          const hab = readHabitat(root.current!, fields)
          setHabitatTile(`${ti},${tj}`, fields.region, hab.shade, hab.shelter)
          return plantsInTile('all', fields.region.x0, fields.region.z0, NEAR_TILE, world.seed, year * 10, withInfluence(atIsland, fields, hab), water, (x, z) => !isLand(x, z))
        })
      }
    }
    const half = Math.ceil(2300 / ISLAND_TILE)
    for (let tj = -half; tj < half; tj += 1) {
      for (let ti = -half; ti < half; ti += 1) {
        const cx = (ti + 0.5) * ISLAND_TILE
        const cz = (tj + 0.5) * ISLAND_TILE
        want(`i:${ti},${tj}`, `${year}`, cx, cz, ISLAND_TILE / 2, dist(cx, cz), () => plantsInTile('island', ti * ISLAND_TILE, tj * ISLAND_TILE, ISLAND_TILE, world.seed, year * 10, atIsland, water, (x, z) => !isLand(x, z)))
      }
    }
    // The mats stand around the camera when it is low enough to see them.
    const archSquares = new Set(archOn ? arch.current.tiles.map(({ ti, tj }) => `${ti},${tj}`) : [])
    if (shared.focus.above < 400) {
      const ti0 = Math.floor(cx0 / NEAR_TILE)
      const tj0 = Math.floor(cz0 / NEAR_TILE)
      for (let tj = tj0 - 1; tj <= tj0 + 1; tj += 1) {
        for (let ti = ti0 - 1; ti <= ti0 + 1; ti += 1) {
          if (archSquares.has(`${ti},${tj}`)) continue
          const cx = (ti + 0.5) * NEAR_TILE
          const cz = (tj + 0.5) * NEAR_TILE
          want(`m:${ti},${tj}`, `${year}`, cx, cz, NEAR_TILE / 2, dist(cx, cz), () => plantsInTile('mat', ti * NEAR_TILE, tj * NEAR_TILE, NEAR_TILE, world.seed, year * 10, atIsland, water, (x, z) => !isLand(x, z)))
        }
      }
    }
    let built = 0
    if (still && needs.length > 0) {
      needs.sort((a, b) => a.d - b.d)
      for (const n of needs) {
        if (built > 0 && performance.now() - t0 > (loading.covered ? 30 : 8)) break
        const before = tiles.current.get(n.id)
        const made = stored(n.ver, n.make(), n.cx, n.cz, now, n.half)
        // Growing in (loading.ts › growIn): a tile appearing where there was none grows to full size; a replacement keeps its predecessor's age,
        // and a tile built under a loading cover is simply there when the cover lifts.
        // (Integration round 13: only ground that has never shown plants grows them in. A near tile (a:, m:) refines ground an island tile already
        // drew, and a tile dropped when the camera left and rebuilt on its return is the same plants again: both appear as they are, mature. Growing
        // those in made trees "grow again" as the camera zoomed toward them.)
        const fresh = !everShown.current.has(n.id) && n.id.startsWith('i:')
        everShown.current.add(n.id)
        made.born = before ? before.born : fresh && loading.growIn && !loading.covered ? performance.now() : 0
        tiles.current.set(n.id, made)
        built += 1
        if (n.id.startsWith('a:') && !loading.covered) break
      }
    }
    // For a loading cover (loading.ts): the Distant geometries still to grow (what an island-wide view draws; the closer levels go on growing
    // afterwards, as they always have). The island's tiles keep filling in after the cover lifts, as before.
    loading.plantsPending = queue.current.filter((task) => task.level === 2).length
    loading.plantTiles = needs.length - built
    // An architecture tile the architecture no longer reaches goes, and the island's plants stand there again.
    for (const k of [...tiles.current.keys()])
      if (k.startsWith('a:') && !wanted.has(k)) {
        tiles.current.delete(k)
        dropHabitatTile(k.slice(2))
      }
    if (tiles.current.size > 900) {
      const old = [...tiles.current.entries()].filter(([k, v]) => k.startsWith('m:') && v.seen !== now).sort((a, b) => a[1].seen - b[1].seen)
      for (const [k] of old) {
        tiles.current.delete(k)
        if (tiles.current.size < 650) break
      }
    }

    // Reassemble when the view has changed a little, the year or the architecture changes, or tiles or geometries arrive.
    // (While a tile is still growing in, the assembly runs again, so it grows in steps of a tenth of a second.)
    let growing = false
    if (loading.growIn) for (const tile of tiles.current.values()) if (tile.born && t0 - tile.born < GROW_MS) growing = true
    const key = `${view}|${sig}|${built}|${archOn}|${grownCount.current}${growing ? `|${t0}` : ''}${loading.plantGrowth < 1 ? `|g${loading.plantGrowth}` : ''}`
    if (!fresh && (key === lastKey.current || t0 - lastBuild.current < 120)) return
    lastKey.current = key
    lastBuild.current = t0

    if (pickedAt.current !== grownCount.current) resolvePicks()
    const asm0 = performance.now()
    camera.updateMatrixWorld()
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(projView)
    const planes = frustum.planes
    const archCovers = new Set<number>()
    plantSquares.arch.clear()
    for (const [k, v] of tiles.current) {
      if (!k.startsWith('a:')) continue
      archCovers.add(squareKey(v.cx, v.cz))
      plantSquares.arch.add(k.slice(2))
    }
    for (const s of slots.current) s.n = 0
    const full = new Int32Array(SPECIES.length)
    let nFull = 0
    let nMid = 0
    let nFar = 0

    // Every visible plant, once: tiles outside the view are skipped whole, the rest plant by plant. A plant's level comes from its
    // distance to the camera, with its own memory of where it was.
    for (const [id, tile] of tiles.current) {
      const dx = tile.cx - cx0
      const dz = tile.cz - cz0
      const reach = tile.half * 1.42 + (tile.ymax - tile.ymin) / 2 + 14
      if (id.startsWith('m:') && Math.hypot(dx, dz) > 260) continue
      // Tile sphere against the view, with the margin that grows with distance.
      {
        const cyT = (tile.ymin + tile.ymax) / 2
        const dT = Math.hypot(dx, cyT - cy0, dz)
        const r = reach + 0.2 * dT
        let out = false
        if (dT > r + ALWAYS) {
          for (let p = 0; p < 6; p += 1) {
            const pl = planes[p]!
            if (pl.normal.x * tile.cx + pl.normal.y * cyT + pl.normal.z * tile.cz + pl.constant < -r) {
              out = true
              break
            }
          }
        }
        if (out) continue
      }
      const isIsland = id.startsWith('i:')
      let age = tile.born ? (t0 - tile.born) / GROW_MS : 1
      // A page growing the plants in by hand (loading.ts › plantGrowth): each tile at its own moment, so they spread across the island.
      if (loading.plantGrowth < 1) {
        const h = Math.sin(tile.cx * 12.9898 + tile.cz * 78.233) * 43758.5453
        age = Math.min(age, (loading.plantGrowth - (h - Math.floor(h)) * 0.6) / 0.4)
      }
      // (Clamped below as well as above: a tile not yet begun has a negative age, and the smoothstep of a negative age is large and positive.)
      const grow = age >= 1 ? 1 : age <= 0 ? 0 : age * age * (3 - 2 * age)
      if (grow <= 0.01) continue
      for (let si = 0; si < SPECIES.length; si += 1) {
        const sp = SPECIES[si]!
        const arr = tile.data.get(sp.id)
        if (!arr) continue
        // (A page growing the plants in by hand: the layers in their order, ground cover first, then shrubs, then trees, each over part of the
        // tile's growth, so a patch fills from the ground up. Presentation only: who stands where is unchanged.)
        const layered = loading.plantGrowth < 1 ? Math.max(0, Math.min(1, (grow - (LAYER_START[sp.group] ?? 0)) / (1 - (LAYER_START[sp.group] ?? 0)))) : grow
        if (layered <= 0.01) continue
        let mem = levels.get(arr)
        if (!mem) {
          mem = new Uint8Array(arr.length / STRIDE).fill(255)
          levels.set(arr, mem)
        }
        const byLevel = picks.current[si]!
        const lod1 = sp.lod[1]
        for (let o = 0, slot = 0; o < arr.length; o += STRIDE, slot += 1) {
          const x = arr[o]!
          const y = arr[o + 1]!
          const z = arr[o + 2]!
          if (isIsland && archCovers.size > 0 && archCovers.has(squareKey(x, z))) continue
          const ex = x - cx0
          const ey = y - cy0
          const ez = z - cz0
          const d = Math.sqrt(ex * ex + ey * ey + ez * ez)
          if (d > ALWAYS) {
            const r = 10 + 0.2 * d
            let out = false
            for (let p = 0; p < 6; p += 1) {
              const pl = planes[p]!
              if (pl.normal.x * x + pl.normal.y * y + pl.normal.z * z + pl.constant < -r) {
                out = true
                break
              }
            }
            if (out) continue
          }
          const level = levelFor(sp, d, mem[slot]!)
          mem[slot] = level
          // A mat is only drawn up to its Reduced limit.
          if (!sp.far && (level > 1 || d > lod1 * (1 + HYSTERESIS))) continue
          const variant = arr[o + 5]!
          let pick = byLevel[level]?.[variant]
          if (!pick) continue
          // Over the species' cap of Full plants: the next level, not nothing.
          if (pick.level === 0 && full[si]! >= sp.cap) {
            pick = byLevel[1]?.[variant] ?? null
            if (!pick) continue
          }
          const s = pick.slot
          if (s.n >= s.cap) continue
          const b = s.n * 16
          const m = s.mesh.instanceMatrix.array as Float32Array
          const sc = arr[o + 3]! * layered
          const yaw = arr[o + 4]!
          const c = Math.cos(yaw) * sc
          const sn = Math.sin(yaw) * sc
          m[b] = c
          m[b + 1] = 0
          m[b + 2] = -sn
          m[b + 3] = 0
          m[b + 4] = 0
          m[b + 5] = sc
          m[b + 6] = 0
          m[b + 7] = 0
          m[b + 8] = sn
          m[b + 9] = 0
          m[b + 10] = c
          m[b + 11] = 0
          m[b + 12] = x
          m[b + 13] = y
          m[b + 14] = z
          m[b + 15] = 1
          const cb = s.n * 3
          const col = s.mesh.instanceColor!.array as Float32Array
          col[cb] = relColour(arr[o + 6]!, pick.mean[0])
          col[cb + 1] = relColour(arr[o + 7]!, pick.mean[1])
          col[cb + 2] = relColour(arr[o + 8]!, pick.mean[2])
          s.n += 1
          if (pick.level === 0) {
            full[si]! += 1
            nFull += 1
          } else if (pick.level === 1) nMid += 1
          else nFar += 1
        }
      }
    }

    // Plants on Living Architecture's surfaces.
    const attached = attach(arch.current.sites, cx0, cz0, banks.current, means.current, attachSlots.current, makeSlot)

    // Upload only what was written, and only for meshes that hold, or held, something.
    for (const s of [...slots.current, ...attachSlots.current.values()]) {
      if (s.n === 0 && s.was === 0) continue
      s.mesh.count = s.n
      const im = s.mesh.instanceMatrix
      im.clearUpdateRanges()
      im.addUpdateRange(0, Math.max(1, s.n) * 16)
      im.needsUpdate = true
      const ic = s.mesh.instanceColor!
      ic.clearUpdateRanges()
      ic.addUpdateRange(0, Math.max(1, s.n) * 3)
      ic.needsUpdate = true
      s.was = s.n
    }
    // (This showing has its first assembly: drawn from this frame on.)
    if (fresh) {
      drawn.current = true
      g.visible = true
    }
    // The panel's numbers change at most once a second.
    if (t0 - lastStore.current > 1000) {
      lastStore.current = t0
      setVegetation({ plants: { near: nFull, mid: nMid, far: nFar, attached, ms: performance.now() - asm0, banks: grownCount.current } })
    }
  })
  return <group ref={group} />
}

// ------------------------------------------------------------------------------------------------ Living Architecture

const _up = new Vector3(0, 1, 0)
const _p = new Vector3()
const _n = new Vector3()
const _box = new Box3()
const _m = new Matrix4()
const _s = new Vector3()
const _x = new Vector3()
const _y = new Vector3()
const _z = new Vector3()

type Site = { x: number; y: number; z: number; nx: number; ny: number; nz: number; kind: 'vine' | 'curtain'; h: number }
const CLING_CAP = 400
/** Beyond this from the camera clinging plants are not drawn (a few metres of leaf, small at that range). */
const CLING_RANGE = 420

/**
 * What the architecture is, read when it changes: the 96 m tiles its parts reach (grown by how far its shade can fall), and the sites
 * where clinging plants stand. A site is a vertex of the drawn surface chosen by a hash of its position, so the same vertices are
 * chosen every time, wherever the camera is; the vine takes walls, the curtain the undersides of ledges.
 */
function readArchitecture(rootGroup: Group | null, seed: number): { tiles: { ti: number; tj: number }[]; sites: Site[] } {
  if (!rootGroup) return { tiles: [], sites: [] }
  const found: Site[] = []
  const square = new Map<string, { ti: number; tj: number }>()
  const reach = 50
  rootGroup.updateWorldMatrix(true, true)
  rootGroup.traverseVisible((obj) => {
    const mesh = obj as Mesh
    // Only solid architecture: the community marks and the picker are drawn in the same group but are not structures.
    if (!mesh.isMesh || !mesh.geometry || !mesh.castShadow) return
    const pos = mesh.geometry.getAttribute('position')
    const nor = mesh.geometry.getAttribute('normal')
    if (!pos) return
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    _box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld)
    if (!Number.isFinite(_box.min.x)) return
    // The squares this part's shade and shelter can reach.
    for (let tj = Math.floor((_box.min.z - reach) / NEAR_TILE); tj <= Math.floor((_box.max.z + reach) / NEAR_TILE); tj += 1) {
      for (let ti = Math.floor((_box.min.x - reach) / NEAR_TILE); ti <= Math.floor((_box.max.x + reach) / NEAR_TILE); ti += 1) square.set(`${ti},${tj}`, { ti, tj })
    }
    if (!nor) return
    const stride = Math.max(1, Math.floor(pos.count / 4000))
    const rec = mesh.geometry.getAttribute('aGrowthB')
    const mine: Site[] = []
    for (let v = 0; v < pos.count; v += stride) {
      _p.set(pos.getX(v), pos.getY(v), pos.getZ(v)).applyMatrix4(mesh.matrixWorld)
      _n.set(nor.getX(v), nor.getY(v), nor.getZ(v)).transformDirection(mesh.matrixWorld)
      const h = Math.abs(Math.sin(Math.floor(_p.x / 3) * 12.9898 + Math.floor(_p.y / 3) * 78.233 + Math.floor(_p.z / 3) * 37.719 + seed * 0.001) * 43758.5453) % 1
      // The growth record gives each point's light and wetness (aGrowthB: light, wet): the vine takes walls that are lit but not scorched and damp enough, the
      // hanging curtain the shaded undersides; neither stands in the dark (the vine needs some light) nor sun-baked where it is dry.
      const light = rec ? rec.getX(v) : 0.5
      const wet = rec ? rec.getY(v) : 0.5
      if (Math.abs(_n.y) < 0.45 && h < 0.1 && light > 0.3 && light < 0.9 && wet > 0.12) mine.push({ x: _p.x, y: _p.y, z: _p.z, nx: _n.x, ny: _n.y, nz: _n.z, kind: 'vine', h })
      else if (_n.y < -0.35 && h < 0.12 && light < 0.6) mine.push({ x: _p.x, y: _p.y, z: _p.z, nx: _n.x, ny: _n.y, nz: _n.z, kind: 'curtain', h })
    }
    // Each structure keeps its own share (the lowest hashes), so every one wears some, and none takes the whole.
    mine.sort((a, b) => a.h - b.h)
    let vines = 0
    let curtains = 0
    for (const f of mine) {
      if (f.kind === 'vine' ? vines >= 26 : curtains >= 16) continue
      if (f.kind === 'vine') vines += 1
      else curtains += 1
      found.push(f)
    }
  })
  const tiles = [...square.values()].slice(0, 260)
  // A stable choice: the lowest hash first, so the same sites survive when others come and go.
  found.sort((a, b) => a.h - b.h)
  const sites: Site[] = []
  const taken = { vine: 0, curtain: 0 }
  for (const f of found) {
    if (taken[f.kind] >= CLING_CAP * 2) continue
    taken[f.kind] += 1
    sites.push(f)
  }
  return { tiles, sites }
}

/** Stands clinging plants on their sites: flush against the surface, facing along its normal. */
function attach(
  sites: Site[],
  cx: number,
  cz: number,
  banks: Map<SpeciesId, (BufferGeometry | null)[][]>,
  means: Map<string, [number, number, number]>,
  slots: Map<string, Slot>,
  makeSlot: (geometry: BufferGeometry, cap: number, shadeLover?: boolean) => Slot,
): number {
  for (const s of slots.values()) s.n = 0
  const sp = { vine: SPECIES.find((s) => s.id === 'vine')!, curtain: SPECIES.find((s) => s.id === 'curtain')! }
  let total = 0
  for (const f of sites) {
    if (Math.hypot(f.x - cx, f.z - cz) > CLING_RANGE) continue
    const sps = sp[f.kind]
    // (A climber on a structure grows in the structure's half-light: mostly the partial-shade form, some sun-grown, a few deep-shade; never the
    // stressed form, which the old 1 + h % 3 gave a third of them.)
    const variant = [PART_VARIANT, 2, PART_VARIANT, 1][Math.floor(f.h * 1000) % 4]!
    const geo = banks.get(sps.id)?.[0]?.[variant]
    if (!geo) continue
    const k = `${sps.id}:${variant}`
    let slot = slots.get(k)
    if (!slot) {
      slot = makeSlot(geo, CLING_CAP, SHADE_LOVERS.has(sps.id))
      slots.set(k, slot)
    }
    if (slot.n >= slot.cap) continue
    const s = 1.3 + 1.0 * ((f.h * 997) % 1)
    _s.set(s, s, s)
    if (f.kind === 'vine') {
      _z.set(f.nx, f.ny, f.nz)
      _x.crossVectors(_up, _z).normalize()
      _y.crossVectors(_z, _x).normalize()
      _m.makeBasis(_x, _y, _z)
      _m.scale(_s)
      _m.setPosition(f.x + f.nx * 0.03 - _y.x * 0.7 * s, f.y + f.ny * 0.03 - _y.y * 0.7 * s, f.z + f.nz * 0.03 - _y.z * 0.7 * s)
    } else {
      _z.set(f.nx, 0, f.nz)
      if (_z.length() < 0.2) _z.set(Math.cos(f.h * 40), 0, Math.sin(f.h * 40))
      _z.normalize()
      _x.crossVectors(_up, _z).normalize()
      _m.makeBasis(_x, _up, _z)
      _m.scale(_s)
      _m.setPosition(f.x - _z.x * 0.1, f.y - 1.4 * s, f.z - _z.z * 0.1)
    }
    slot.mesh.setMatrixAt(slot.n, _m)
    const t = tint(sps, zonesOf({ height: 0, slope: 0, waterDepth: 0, waterDist: 99, light: 0.5, moisture: 0.7, footprint: 0, shade: 0.5, shelter: 0.5, x: 0, z: 0 }), f.h)
    const mean = means.get(`${sps.id}:${variant}:0`) ?? [0.5, 0.5, 0.5]
    const col = slot.mesh.instanceColor!.array as Float32Array
    col[slot.n * 3] = relColour(t[0], mean[0])
    col[slot.n * 3 + 1] = relColour(t[1], mean[1])
    col[slot.n * 3 + 2] = relColour(t[2], mean[2])
    slot.n += 1
    total += 1
  }
  return total
}
