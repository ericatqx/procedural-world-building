import { Sphere, Vector3, type Group, type InstancedMesh, type Mesh } from 'three'
import { setHabitatTile, dropHabitatTile } from './archGround.ts'
import { environment } from './environment.ts'
import { islandAt } from './Vegetation.tsx'
import { buildRegionFields, sampleField, TILE, type RegionFields } from './vegFields.ts'
import { readHabitat, type Habitat } from './vegHabitat.ts'
import { riverEdgeField } from './vegRivers.ts'
import { shared } from './vegShared.ts'
import { plantSquares, withInfluence } from './WorldPlants.tsx'
import { SPECIES, plantsInTile, STRIDE, type SpeciesId, type Water } from './worldPlants.ts'
import type { Conditions } from './vegPlants.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — what a creature can sense of the ground around its home, read from the architecture itself and not from what the camera happens
 * to have streamed. Two things, kept apart on purpose:
 *
 *   PERSISTENT   the structure's footprint, its roofed shelter and the share of the whole day's sun it keeps off each 3 m cell (vegHabitat.ts, the same
 *                raster the plants and the ground colour read): the long-term habitat. These tiles are also handed to the island-wide shade texture, so a
 *                creature's ground reads the same in the panel, in the ground's colour and in what grows there.
 *   NOW          the shadow the structure throws along the sun's direction at this moment: where a dweller can actually lie out of the sun now. It is
 *                re-read as the sun moves (one tile at a time).
 *
 * Before this, a creature read the island-wide shade texture, which is only filled as the plant renderer builds its architecture tiles (after every island
 * tile, one per pass, only while the camera is still): for the first half minute, and wherever the camera had not been, every shade read 0 %.
 */
type Tile = { key: string; ti: number; tj: number; fields: RegionFields; hab: Habitat | null; ver: number; now: Float32Array | null; sun: [number, number, number] | null }

const tiles = new Map<string, Tile>()
let lastWork = 0
let lastNow = 0
let worldOf: World | null = null
let water: Water | null = null
const keyOf = (ti: number, tj: number) => `${ti},${tj}`

/** The tiles covering a disc: what a creature living there will ask about. Cheap to call every frame. */
export function requestHabitat(x: number, z: number, r: number) {
  for (let tj = Math.floor((z - r) / TILE.size); tj <= Math.floor((z + r) / TILE.size); tj += 1) {
    for (let ti = Math.floor((x - r) / TILE.size); ti <= Math.floor((x + r) / TILE.size); ti += 1) {
      const key = keyOf(ti, tj)
      if (!tiles.has(key) && worldOf) tiles.set(key, { key, ti, tj, fields: buildRegionFields(worldOf, (ti + 0.5) * TILE.size, (tj + 0.5) * TILE.size), hab: null, ver: -1, now: null, sun: null })
    }
  }
}

export function resetHabitat(world: World) {
  if (worldOf === world) return
  for (const t of tiles.values()) dropHabitatTile(t.key)
  tiles.clear()
  worldOf = world
  water = { depth: (x, z) => world.water.depthAt(x, z), edge: riverEdgeField(world) }
}

/**
 * One frame's work, paced: at most one tile's persistent habitat (when the architecture has changed and held still for a moment), or one tile's shadow
 * of the moment (when the sun has moved a couple of degrees since it was read). Each is one pass over the nearby architecture's vertices.
 */
export function updateHabitat(root: Group | null, now: number) {
  if (!root || now - lastWork < 0.05) return
  const ver = shared.archVersion
  const settled = now - archChangedAt(ver, now) > 1.2
  if (settled) {
    for (const t of tiles.values()) {
      if (t.ver === ver) continue
      lastWork = now
      t.hab = readHabitat(root, t.fields)
      t.ver = ver
      t.now = null
      t.sun = null
      let any = false
      for (let k = 0; k < t.hab.shade.length && !any; k += 1) if (t.hab.shade[k]! > 0 || t.hab.shelter[k]! > 0 || t.hab.footprint[k]! > 0) any = true
      if (any) setHabitatTile(t.key, t.fields.region, t.hab.shade, t.hab.shelter)
      else dropHabitatTile(t.key)
      return
    }
  }
  // The shadow of the moment: the tile read longest ago (or never) first, no oftener than four times a second.
  const sun = environment.state.sun.direction
  if (sun[1] < 0.05 || now - lastNow < 0.25) return
  let pick: Tile | null = null
  let worst = 1
  for (const t of tiles.values()) {
    if (!t.hab) continue
    const dot = t.sun ? t.sun[0] * sun[0] + t.sun[1] * sun[1] + t.sun[2] * sun[2] : -1
    if (dot < 0.9992 && dot < worst) {
      worst = dot
      pick = t
    }
  }
  if (!pick) return
  lastNow = now
  lastWork = now
  pick.sun = [sun[0], sun[1], sun[2]]
  // The shadow raster marks a cell if any neighbour is hit (it fills the gaps between the structure's projected vertices), which widens every shadow by a
  // cell: closed again here (each cell the least of its neighbourhood), so its edge is where the shadow's edge is, and an animal at the edge does not read
  // as fully shaded.
  pick.now = shadowNow(root, pick.fields, pick.sun)
}

/**
 * The structure's shadow of this moment on the ground as it lies: each vertex of the drawn architecture is followed down the sun's ray to where it meets
 * the terrain (its height field, a few steps of refinement), not to the ground level under the vertex. On a slope that difference is metres: the flat
 * projection put a structure's shadow beside where it is drawn, so an animal in the sun read as shaded. The marks are closed (gaps between projected
 * vertices filled, then the edge brought back), so the edge is where the drawn shadow's edge is.
 */
function shadowNow(root: Group, fields: RegionFields, d: [number, number, number]): Float32Array {
  const { region } = fields
  const n = region.n
  const hit = new Uint8Array(n * n)
  const p = new Vector3()
  const sphere = new Sphere()
  const reach = Math.hypot(region.n * region.cell) / 2 + 90
  root.updateWorldMatrix(true, true)
  root.traverseVisible((obj) => {
    const mesh = obj as Mesh
    if (!mesh.isMesh || !mesh.geometry || (obj as InstancedMesh).isInstancedMesh || mesh.userData.habitat === false) return
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
    sphere.copy(mesh.geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld)
    if (Math.hypot(sphere.center.x - region.cx, sphere.center.z - region.cz) > reach + sphere.radius) return
    const pos = mesh.geometry.getAttribute('position')
    if (!pos) return
    for (let v = 0; v < pos.count; v += 1) {
      p.set(pos.getX(v), pos.getY(v), pos.getZ(v)).applyMatrix4(mesh.matrixWorld)
      const h = p.y - sampleField(region, fields.height, p.x, p.z)
      if (h < 0.3) continue
      let t = h / d[1]
      for (let k = 0; k < 3; k += 1) t = Math.max(0, (p.y - sampleField(region, fields.height, p.x - d[0] * t, p.z - d[2] * t)) / d[1])
      const i = Math.floor((p.x - d[0] * t - region.x0) / region.cell)
      const j = Math.floor((p.z - d[2] * t - region.z0) / region.cell)
      if (i >= 0 && j >= 0 && i < n && j < n) hit[j * n + i] = 1
    }
  })
  const grown = new Float32Array(n * n)
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      let m = 0
      for (let dj = -1; dj <= 1 && !m; dj += 1) for (let di = -1; di <= 1; di += 1) if (hit[Math.min(n - 1, Math.max(0, j + dj)) * n + Math.min(n - 1, Math.max(0, i + di))]) m = 1
      grown[j * n + i] = m
    }
  }
  return erode(grown, n)
}

function erode(f: Float32Array, n: number): Float32Array {
  const out = new Float32Array(f.length)
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      let m = 1
      for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) m = Math.min(m, f[Math.min(n - 1, Math.max(0, j + dj)) * n + Math.min(n - 1, Math.max(0, i + di))]!)
      out[j * n + i] = m
    }
  }
  return out
}

/** Whether the shadow of the moment has been read for the sun as it is now over the whole of a disc (a guide's showcase waits for it). */
export function shadowCurrent(x: number, z: number, r: number): boolean {
  const sun = environment.state.sun.direction
  for (let tj = Math.floor((z - r) / TILE.size); tj <= Math.floor((z + r) / TILE.size); tj += 1) {
    for (let ti = Math.floor((x - r) / TILE.size); ti <= Math.floor((x + r) / TILE.size); ti += 1) {
      const t = tiles.get(keyOf(ti, tj))
      if (!t?.now || !t.sun || t.sun[0] * sun[0] + t.sun[1] * sun[1] + t.sun[2] * sun[2] < 0.9992) return false
    }
  }
  return true
}

const change = { ver: -1, at: 0 }
function archChangedAt(ver: number, now: number) {
  if (change.ver !== ver) {
    change.ver = ver
    change.at = now
  }
  return change.at
}

export type HabitatHere = {
  /** Whether the architecture's habitat has been read here yet. */
  known: boolean
  /** Share of the whole day's sun the structures keep off, 0 to 1 (persistent). */
  shade: number
  /** Roofed: something stands over the ground here (persistent). */
  shelter: number
  /** The structure stands here. */
  footprint: number
  /** Metres of clear air under the structure (Infinity where nothing is over it). */
  ceiling: number
  /** In the structure's shadow at this moment, 0 to 1 (at night, or before it is read, 1 under shelter and the persistent shade otherwise). */
  now: number
}

const NONE: HabitatHere = { known: false, shade: 0, shelter: 0, footprint: 0, ceiling: Infinity, now: 0 }

export function habitatAt(x: number, z: number): HabitatHere {
  const t = tiles.get(keyOf(Math.floor(x / TILE.size), Math.floor(z / TILE.size)))
  if (!t || !t.hab) return NONE
  const r = t.fields.region
  const i = Math.min(r.n - 1, Math.max(0, Math.floor((x - r.x0) / r.cell)))
  const j = Math.min(r.n - 1, Math.max(0, Math.floor((z - r.z0) / r.cell)))
  const k = j * r.n + i
  const shade = sampleField(r, t.hab.shade, x, z)
  const shelter = t.hab.shelter[k]!
  const now = t.now ? Math.max(shelter, sampleField(r, t.now, x, z)) : Math.max(shelter, shade)
  return { known: true, shade, shelter, footprint: t.hab.footprint[k]!, ceiling: t.hab.ceiling[k]!, now }
}

/**
 * The conditions at a point exactly as the plant renderer decided them: with the structure's influence inside the squares it draws architecture tiles
 * for, the island's fields elsewhere. So `foodNear` finds the very plants that are drawn there (same sites, same rules, same seed and year).
 */
function conditionsAt(x: number, z: number): ((x: number, z: number, y: number) => Conditions) | null {
  const island = shared.island
  if (!island) return null
  const atIsland = islandAt(island)
  const t = tiles.get(keyOf(Math.floor(x / TILE.size), Math.floor(z / TILE.size)))
  if (t?.hab && plantSquares.arch.has(t.key)) return withInfluence(atIsland, t.fields, t.hab)
  return atIsland
}

/** The plants of the given species that stand within `r` metres of a point: their positions and sizes, from the same placement the renderer draws. */
export function foodNear(x: number, z: number, r: number, species: Set<SpeciesId>): { x: number; z: number; s: number; id: SpeciesId; v: number }[] {
  const at = conditionsAt(x, z)
  const island = shared.island
  if (!at || !worldOf || !water || !island) return []
  const year = Math.floor(environment.controls.year / 10) * 10
  const isLand = (px: number, pz: number) => {
    const i = Math.floor((px - island.x0) / island.cell)
    const j = Math.floor((pz - island.x0) / island.cell)
    return i >= 0 && j >= 0 && i < island.n && j < island.n && island.land[j * island.n + i] === 1
  }
  const found = plantsInTile('all', x - r, z - r, r * 2, worldOf.seed, year, at, water, (px, pz) => !isLand(px, pz))
  const out: { x: number; z: number; s: number; id: SpeciesId; v: number }[] = []
  for (const [id, arr] of found) {
    if (!species.has(id)) continue
    for (let o = 0; o < arr.length; o += STRIDE) {
      const px = arr[o]!
      const pz = arr[o + 2]!
      if (Math.hypot(px - x, pz - z) <= r) out.push({ x: px, z: pz, s: arr[o + 3]!, id, v: Math.round(arr[o + 5]!) })
    }
  }
  return out
}

/**
 * TREE TRUNKS AS OBSTACLES (integration round 13). The trunks of the trees drawn on the island (the same placement, foodNear), cached per 8 m cell of
 * ground, so a walker's every step can ask whether it would walk into one. A trunk's radius follows the tree's drawn scale.
 */
const TRUNK_SPECIES = new Set<SpeciesId>(SPECIES.filter((s) => s.group === 'tall').map((s) => s.id))
const trunkCells = new Map<string, { x: number; z: number; r: number }[]>()
export function trunksNear(x: number, z: number): { x: number; z: number; r: number }[] {
  const year = Math.floor(environment.controls.year / 10)
  const cx = Math.floor(x / 8)
  const cz = Math.floor(z / 8)
  const key = `${cx},${cz},${year}`
  let v = trunkCells.get(key)
  if (!v) {
    // (Every tree within the cell and a margin round it: a trunk near the cell's edge still blocks a step from inside.)
    v = foodNear(cx * 8 + 4, cz * 8 + 4, 9, TRUNK_SPECIES).map((p) => ({ x: p.x, z: p.z, r: 0.28 + 0.22 * Math.min(2, p.s) }))
    if (!shared.island) return v
    if (trunkCells.size > 3000) trunkCells.clear()
    trunkCells.set(key, v)
  }
  return v
}
