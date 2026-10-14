import {
  clamp01,
  LATTICE_BASE,
  LATTICE_HEIGHT,
  LATTICE_SPAN,
  LATTICE_X0,
  LATTICE_Z0,
  lensFactor,
  MEMBER,
  random,
  RESOLUTIONS,
  smoothstep,
  type Lens,
  type Resolution,
  type Rng,
  type Vec3,
} from './core.ts'
import { cellCenter } from './grid.ts'
import { daySamples, sunVisible, type Solid } from './light.ts'
import { seedSuitability, siteKind, type SiteKind, type Statics } from './statics.ts'

/**
 * Shadow Ecology 0.2 — architecture as a voxel lattice grown from small
 * rooted pads by several growth fronts. Fronts leave the pad and, every
 * member (MEMBER long), weigh their candidate moves:
 *
 *   score = light − own mass + connection + support + momentum − risk
 *
 * and take one by a soft, seeded choice. Own mass counts against a move, so
 * members stay slender rather than piling into blocks, and strong momentum
 * keeps each one directional. REACH fronts climb and lean toward the sun's
 * bearing; SPREAD fronts run level — beams, cantilevers and bridges that
 * seek other structures to join. When an arm overhangs far, a SUPPORT front
 * buds under it and grows down to the ground, the mass below or a lake bed:
 * a strut or pier, so gravity shapes the reach. Fronts store energy from the
 * light they stand in and spend it a voxel at a time; lifting material costs
 * more the higher it goes.
 *
 * Sites root by a seeded draw over the suitable regions of the site rule
 * (statics.ts: light, buildable slope, support and open sky first, water
 * weakly), kept apart by spacing with a weak pull to group, and again on
 * old rubble.
 *
 * Every voxel ages from its birth. Weathering takes exposed voxels at a rate
 * set by age × exposure × stress × weather, so thin parts go first and the
 * interior outlasts its skin. Support is re-solved after losses (vertical
 * runs free, horizontal runs cost, less inside a thick slab); whatever loses
 * its path to the ground, or overhangs too far, falls as rubble. Old sites
 * keep a little vigour and re-sprout from their survivors, so the world
 * accumulates architectural history rather than resetting.
 */

export type Site = {
  id: number
  x: number
  z: number
  born: number
  voxels: number
  collapsed: number
  /** Clock of the last collapse here, or −Infinity. */
  struck: number
  /** The setting it rooted in. */
  kind?: SiteKind
}

export type FrontRole = 'reach' | 'spread' | 'support'

export type Candidate = {
  x: number
  y: number
  z: number
  move: Vec3
  light: number
  /** Contact with the structure's own standing mass. */
  mass: number
  connection: number
  support: number
  momentum: number
  risk: number
  score: number
  chosen: boolean
}

export type Tip = {
  id: number
  site: number
  role: FrontRole
  /** Brush minimum corner on the lattice. */
  i: number
  j: number
  k: number
  /** Directional momentum, unit length. */
  dir: Vec3
  /** Lattice step of the member being laid. */
  move: Vec3
  /** Voxel steps left in the member. */
  remaining: number
  energy: number
  /** Light where the tip last chose, 0…1: what it grows on. */
  light: number
  /** Horizontal members since the last direct support. */
  cantilever: number
  born: number
  members: number
  /** The choice it last made, kept for the Architecture view and the lens. */
  candidates: Candidate[]
  /** After the member in progress the tip fuses with another structure and stops. */
  fusing: boolean
}

export type ArchEvent =
  | { kind: 'collapse'; x: number; y: number; z: number; voxels: number; site: number; clock: number }
  | { kind: 'bridge'; x: number; y: number; z: number; site: number; clock: number }
  | { kind: 'seed'; x: number; y: number; z: number; site: number; clock: number; ruin: boolean }
  | { kind: 'brace'; x: number; y: number; z: number; site: number; clock: number }

/** Voxels on their way down after a collapse; drawn, then gone. Rendering only. */
export type Fragment = { x: number; y: number; z: number; ground: number; size: number; born: number }

export type Architecture = {
  resolution: Resolution
  voxel: number
  brush: number
  /** Lattice cells along x and z, and along y. */
  n: number
  ny: number
  cols: number
  /** 0 empty, otherwise the owning site id + 1 (wrapping past 255). */
  solid: Uint8Array
  birth: Float32Array
  /** Support cost to the ground in half-steps; 255 unreachable. */
  support: Uint8Array
  /** Layer holding the ground surface per column; NO_GROUND where nothing may stand, AIR over open air. */
  groundJ: Int16Array
  /** Voxels per chunk column: the simulation visits only occupied chunks. */
  occupied: Uint32Array
  count: number
  tips: Tip[]
  sites: Site[]
  nextTip: number
  nextSite: number
  /** Per chunk column, bumped whenever a voxel in it changes. */
  chunkVersion: Uint32Array
  chunk: number
  chunksAcross: number
  version: number
  /** Version support was last solved at. */
  supportVersion: number
  collapsed: number
  weathered: number
  decayClock: number
  seedClock: number
  /** Top of the highest voxel. */
  top: number
  events: ArchEvent[]
  /** Fallen voxels to drop on the ground as rubble (world x, z, volume). */
  rubble: number[]
  fragments: Fragment[]
}

export type GrowthContext = {
  statics: Statics
  /** Daily sunlight on the ground per grid cell (for seeding new sites). */
  insolation: Float32Array
  rubble: Float32Array
  noon: number
  sunDirection: Vec3
  daylight: number
  /** 0…1 share of direct light the weather lets through. */
  weatherLight: number
  /** Rain, fog, drought intensities for weathering. */
  rain: number
  fog: number
  drought: number
  growthSpeed: number
  decaySpeed: number
  growing: boolean
  decaying: boolean
  lens: Lens | null
  rng: Rng
}

/** Score weights per front: reach climbs and leans toward light, spread branches locally around the structure. Connection is secondary. */
export const SCORE_WEIGHTS: Record<FrontRole, { light: number; mass: number; connection: number; support: number; momentum: number; risk: number }> = {
  reach: { light: 1.1, mass: -0.15, connection: 0.3, support: 0.7, momentum: 0.6, risk: 0.9 },
  spread: { light: 0.6, mass: 0.25, connection: 0.55, support: 0.8, momentum: 0.5, risk: 1 },
  support: { light: 0, mass: 0.2, connection: 0.3, support: 0, momentum: 0.5, risk: 0 },
}

const GROWTH = {
  /** Members per hour a tip lays in full light: slow enough to watch each member land. */
  rate: 0.45,
  /** Share of the rate kept at night and in the dark. */
  floor: 0.06,
  /** Softmax temperature of the choice; lower is greedier. */
  temperature: 0.07,
  /** A tip whose best move scores below this goes dormant. */
  minScore: 0.35,
  branch: 0.6,
  maxTips: 70,
  maxTipsPerSite: 11,
  /** Fronts a standing site keeps re-sprouting toward. */
  siteFronts: 5,
  /** Level members a tip may overhang before support runs out (a leaning member counts a third). */
  cantilever: 3,
  tipLife: 300,
  sitePrime: 140,
  siteLife: 420,
  /** Vigour an old site keeps while it still stands: it re-sprouts from survivors. */
  elder: 0.3,
  /** Hours between attempts to seed a new site, and the most living sites. */
  seedEvery: 30,
  maxLiveSites: 9,
  /** World distance kept between sites, and beyond which a new one is fully free of the others. */
  siteSpacing: 3.4,
  siteFree: 6,
  initialSites: 6,
  /** Overhang (members) at which a reaching arm may bud a support beneath it, and the longest drop it will brace. */
  braceAt: 2,
  braceDrop: 3,
  /** Footing radius in members, and the raised plinth inside it: a small pad, not a mound. */
  footing: 1.3,
  plinth: 0.7,
  /** Extra energy per voxel for each unit of height above the ground: lifting material costs. */
  lift: 0.45,
  /** Height (world) past which lifting costs no more. */
  liftCap: 5,
  /** Cost of a level move per front, and a reach front's bonus for climbing: growth is mostly vertical or leaning. */
  level: { reach: 0.3, spread: 0.08, support: 0 },
  rise: 0,
  /** World distance from the site's root where growth starts to be held back, and where it is held back fully. */
  compact: [1.6, 3],
  compactCost: 0.8,
  /** How far ahead (world) a front sees another structure to bridge to: only short bridges. */
  sight: 1.6,
  /** Height (world) a site needs under the lattice's top. */
  headroom: 3,
  /** Height (world) above its root a site grows to; past it fronts turn sideways or rest, nothing breaks. */
  maxHeight: 4,
  /** Share of the best suitability that still counts as a suitable region for a site. */
  region: 0.35,
  /** Weak preference for settling near (not on) a standing site. */
  cluster: 0.3,
} as const

const DECAY = {
  /** Removals per exposed voxel per hour at full age, Low resolution: slender members are exposed on most faces. */
  base: 0.018,
  onset: 72,
  full: 200,
  tick: 0.25,
  /** Share of the weathering a load-bearing voxel (solid above and below) takes. */
  bearing: 0.1,
} as const

/** Members of overhang beyond which a part breaks off. */
const BREAK_CANTILEVER = 8

/** Support of a voxel placed since support was last solved. */
export const SUPPORT_UNSOLVED = 254

const CHUNK_WORLD = 0.8

/** Ground missing from a column: nothing may stand there. */
export const NO_GROUND = -1
/** Open air (past the rim, or ground below the lattice): voxels may overhang it, never stand on it. */
export const AIR = -2

/** Moves a support front may take: down, and diagonally down. */
const DOWN: readonly Vec3[] = [
  [0, -1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [0, -1, 1],
  [0, -1, -1],
]

/** Lattice moves a tip may take: level, up, and leaning up along an axis or a diagonal. */
const MOVES: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [1, 0, 1],
  [1, 0, -1],
  [-1, 0, 1],
  [-1, 0, -1],
  [0, 1, 0],
  [1, 1, 0],
  [-1, 1, 0],
  [0, 1, 1],
  [0, 1, -1],
  [1, 1, 1],
  [1, 1, -1],
  [-1, 1, 1],
  [-1, 1, -1],
]

const LATERAL: readonly Vec3[] = MOVES.filter((m) => m[1] === 0)

const SKY: readonly Vec3[] = [
  [0, 1, 0],
  ...[0, 1, 2, 3].map((k): Vec3 => {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4
    return [Math.cos(a) * 0.64, 0.77, Math.sin(a) * 0.64]
  }),
]

const SIDES: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

const RING: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

export const archIndex = (a: Architecture, i: number, j: number, k: number) => i + a.n * k + a.cols * j

export const latticeX = (a: Architecture, i: number) => LATTICE_X0 + (i + 0.5) * a.voxel
export const latticeY = (a: Architecture, j: number) => LATTICE_BASE + (j + 0.5) * a.voxel
export const latticeZ = (a: Architecture, k: number) => LATTICE_Z0 + (k + 0.5) * a.voxel

/** Lattice coordinates of a voxel index. */
export function voxelCoords(a: Architecture, index: number): [number, number, number] {
  const j = Math.floor(index / a.cols)
  const col = index - j * a.cols
  const i = col % a.n
  return [i, j, (col - i) / a.n]
}

export function solidAt(a: Architecture, x: number, y: number, z: number): number {
  const i = Math.floor((x - LATTICE_X0) / a.voxel)
  const j = Math.floor((y - LATTICE_BASE) / a.voxel)
  const k = Math.floor((z - LATTICE_Z0) / a.voxel)
  if (i < 0 || k < 0 || j < 0 || i >= a.n || k >= a.n || j >= a.ny) {
    return 0
  }
  return a.solid[archIndex(a, i, j, k)]!
}

export function architectureSolid(a: Architecture): Solid {
  return { isSolid: (x, y, z) => solidAt(a, x, y, z) !== 0, top: a.top }
}

export const ownerOf = (site: number) => (site % 255) + 1

/** Ground under (x, z), or −Infinity over the void past the rim. */
export function floorAt(statics: Statics, x: number, z: number): number {
  const cell = statics.cellAt(x, z)
  return cell >= 0 && statics.inside[cell] ? statics.groundAt(x, z) : -Infinity
}

function emptyArchitecture(statics: Statics, resolution: Resolution): Architecture {
  const { voxel, brush } = RESOLUTIONS[resolution]
  const n = Math.round(LATTICE_SPAN / voxel)
  const ny = Math.round(LATTICE_HEIGHT / voxel)
  const cols = n * n
  const groundJ = new Int16Array(cols).fill(NO_GROUND)
  for (let k = 0; k < n; k += 1) {
    for (let i = 0; i < n; i += 1) {
      const x = LATTICE_X0 + (i + 0.5) * voxel
      const z = LATTICE_Z0 + (k + 0.5) * voxel
      const cell = statics.cellAt(x, z)
      if (cell < 0 || !statics.inside[cell]) {
        // Just past the rim a member may still overhang the drop.
        if (Math.hypot(x, z) < statics.outline(Math.atan2(z, x)) + 0.9) groundJ[i + n * k] = AIR
        continue
      }
      const j = Math.floor((statics.groundAt(x, z) - LATTICE_BASE) / voxel)
      groundJ[i + n * k] = j < 0 ? AIR : Math.min(ny - 1, j)
    }
  }
  // Even, so the Mass level's 2×2×2 blocks never straddle chunks.
  const chunk = Math.max(2, 2 * Math.round(CHUNK_WORLD / voxel / 2))
  const chunksAcross = Math.ceil(n / chunk)
  return {
    resolution,
    voxel,
    brush,
    n,
    ny,
    cols,
    solid: new Uint8Array(cols * ny),
    birth: new Float32Array(cols * ny),
    support: new Uint8Array(cols * ny).fill(255),
    groundJ,
    occupied: new Uint32Array(chunksAcross * chunksAcross),
    count: 0,
    tips: [],
    sites: [],
    nextTip: 1,
    nextSite: 0,
    chunkVersion: new Uint32Array(chunksAcross * chunksAcross),
    chunk,
    chunksAcross,
    version: 0,
    supportVersion: -1,
    collapsed: 0,
    weathered: 0,
    decayClock: 0,
    seedClock: 0,
    top: LATTICE_BASE,
    events: [],
    rubble: [],
    fragments: [],
  }
}

const chunkOf = (a: Architecture, i: number, k: number) => Math.floor(i / a.chunk) + a.chunksAcross * Math.floor(k / a.chunk)

/** Visits every column of every chunk that holds voxels: (column, i, k). */
export function forEachOccupied(a: Architecture, visit: (col: number, i: number, k: number) => void) {
  for (let c = 0; c < a.occupied.length; c += 1) {
    if (!a.occupied[c]) continue
    const i0 = (c % a.chunksAcross) * a.chunk
    const k0 = Math.floor(c / a.chunksAcross) * a.chunk
    const i1 = Math.min(a.n, i0 + a.chunk)
    const k1 = Math.min(a.n, k0 + a.chunk)
    for (let k = k0; k < k1; k += 1) {
      for (let i = i0; i < i1; i += 1) visit(i + a.n * k, i, k)
    }
  }
}

function touch(a: Architecture, i: number, k: number) {
  redraw(a, i, k)
  a.version += 1
}

/** Marks the chunks drawing column (i, k) for a rebuild without counting as a structural change. */
function redraw(a: Architecture, i: number, k: number) {
  const ci = Math.floor(i / a.chunk)
  const ck = Math.floor(k / a.chunk)
  a.chunkVersion[ci + a.chunksAcross * ck]! += 1
  // Faces on a chunk border belong to the neighbour too.
  if (i % a.chunk === 0 && ci > 0) a.chunkVersion[ci - 1 + a.chunksAcross * ck]! += 1
  if (i % a.chunk === a.chunk - 1 && ci < a.chunksAcross - 1) a.chunkVersion[ci + 1 + a.chunksAcross * ck]! += 1
  if (k % a.chunk === 0 && ck > 0) a.chunkVersion[ci + a.chunksAcross * (ck - 1)]! += 1
  if (k % a.chunk === a.chunk - 1 && ck < a.chunksAcross - 1) a.chunkVersion[ci + a.chunksAcross * (ck + 1)]! += 1
}

function setVoxel(a: Architecture, i: number, j: number, k: number, site: number, clock: number): boolean {
  if (i < 0 || k < 0 || j < 0 || i >= a.n || k >= a.n || j >= a.ny) {
    return false
  }
  const groundJ = a.groundJ[i + a.n * k]!
  if (groundJ === NO_GROUND || j < groundJ) {
    return false
  }
  const index = archIndex(a, i, j, k)
  if (a.solid[index]) {
    return false
  }
  a.solid[index] = ownerOf(site)
  a.birth[index] = clock
  a.support[index] = j === groundJ ? 0 : SUPPORT_UNSOLVED
  a.count += 1
  a.occupied[chunkOf(a, i, k)]! += 1
  a.top = Math.max(a.top, LATTICE_BASE + (j + 1) * a.voxel)
  touch(a, i, k)
  return true
}

function clearVoxel(a: Architecture, index: number) {
  if (!a.solid[index]) {
    return
  }
  a.solid[index] = 0
  a.support[index] = 255
  a.count -= 1
  const [i, , k] = voxelCoords(a, index)
  a.occupied[chunkOf(a, i, k)]! -= 1
  touch(a, i, k)
}

const siteOf = (a: Architecture, id: number) => a.sites.find((s) => s.id === id)

/** Fills one member cross-section (the brush) at a tip's corner. */
function stamp(a: Architecture, tip: Pick<Tip, 'i' | 'j' | 'k' | 'site'>, clock: number): number {
  let placed = 0
  for (let dj = 0; dj < a.brush; dj += 1) {
    for (let dk = 0; dk < a.brush; dk += 1) {
      for (let di = 0; di < a.brush; di += 1) {
        if (setVoxel(a, tip.i + di, tip.j + dj, tip.k + dk, tip.site, clock)) {
          placed += 1
        }
      }
    }
  }
  const site = siteOf(a, tip.site)
  if (site) {
    site.voxels += placed
  }
  return placed
}

export const tipCenter = (a: Architecture, tip: Pick<Tip, 'i' | 'j' | 'k'>): Vec3 => [
  LATTICE_X0 + (tip.i + a.brush / 2) * a.voxel,
  LATTICE_BASE + (tip.j + a.brush / 2) * a.voxel,
  LATTICE_Z0 + (tip.k + a.brush / 2) * a.voxel,
]

const cornerFor = (a: Architecture, x: number, y: number, z: number) => ({
  i: Math.round((x - LATTICE_X0) / a.voxel - a.brush / 2),
  j: Math.round((y - LATTICE_BASE) / a.voxel - a.brush / 2),
  k: Math.round((z - LATTICE_Z0) / a.voxel - a.brush / 2),
})

/** Share of the brush at a corner that is solid, split by owner. */
function brushFill(a: Architecture, i: number, j: number, k: number, owner: number) {
  let own = 0
  let other = 0
  let total = 0
  for (let dj = 0; dj < a.brush; dj += 1) {
    for (let dk = 0; dk < a.brush; dk += 1) {
      for (let di = 0; di < a.brush; di += 1) {
        const ii = i + di
        const jj = j + dj
        const kk = k + dk
        total += 1
        if (ii < 0 || kk < 0 || jj < 0 || ii >= a.n || kk >= a.n || jj >= a.ny) {
          continue
        }
        const s = a.solid[archIndex(a, ii, jj, kk)]!
        if (s === owner) own += 1
        else if (s) other += 1
      }
    }
  }
  return { own: own / total, other: other / total }
}

/** Day sun directions for growth: every other sample of the day, with weights. */
export function growthSuns(noon: number) {
  const samples = daySamples(noon).filter((_, i) => i % 2 === 0)
  const total = samples.reduce((sum, s) => sum + s.weight, 0) || 1
  const mean: Vec3 = [0, 0, 0]
  for (const s of samples) {
    mean[0] += s.direction[0] * s.weight
    mean[1] += s.direction[1] * s.weight
    mean[2] += s.direction[2] * s.weight
  }
  return { samples, total, mean: normalize(mean) }
}

type Suns = ReturnType<typeof growthSuns>

/**
 * Light a move would find at (x, y, z): day sun, sun now, open sky, and a
 * lean toward the sun's bearing. The lean reads mostly the sun's azimuth, so
 * reaching toward the light means reaching out as much as up.
 */
function lightAt(ctx: GrowthContext, suns: Suns, solid: Solid, x: number, y: number, z: number, heading: Vec3) {
  const ground = ctx.statics.ground
  let day = 0
  for (const s of suns.samples) {
    if (sunVisible(x, y, z, s.direction, ground, solid)) day += s.weight
  }
  day /= suns.total
  const now = ctx.daylight > 0 && sunVisible(x, y, z, ctx.sunDirection, ground, solid) ? ctx.daylight : 0
  let sky = 0
  for (const d of SKY) {
    if (sunVisible(x, y, z, d, ground, solid)) sky += 1
  }
  sky /= SKY.length
  const toward = ctx.daylight > 0
    ? normalize([
        suns.mean[0] + ctx.sunDirection[0] * ctx.daylight,
        suns.mean[1] + ctx.sunDirection[1] * ctx.daylight,
        suns.mean[2] + ctx.sunDirection[2] * ctx.daylight,
      ])
    : suns.mean
  const bearing = normalize([toward[0], toward[1] * 0.7, toward[2]])
  const tropism = Math.max(0, heading[0] * bearing[0] + heading[1] * bearing[1] + heading[2] * bearing[2])
  return clamp01(0.38 * day + 0.12 * now + 0.12 * sky + 0.38 * tropism)
}

/** Share of the member positions around and below (x, y, z) that are solid: how broad a base it stands on. */
function baseBreadth(a: Architecture, x: number, y: number, z: number) {
  let solid = 0
  let total = 0
  for (let level = 1; level <= 3; level += 1) {
    const py = y - level * MEMBER
    for (const [dx, dz] of RING) {
      total += 1
      if (solidAt(a, x + dx * MEMBER, py, z + dz * MEMBER)) solid += 1
    }
  }
  return solid / total
}

/** Distance from (x, y, z) down to solid or ground, capped at `limit`. */
function dropBelow(a: Architecture, statics: Statics, x: number, y: number, z: number, limit: number) {
  const ground = floorAt(statics, x, z)
  for (let d = 0; d <= limit; d += a.voxel) {
    const py = y - d
    if (py <= ground || solidAt(a, x, py, z)) return d
  }
  return Infinity
}

/**
 * Contact with the structure's own mass at a member position: the faces
 * beside and below it held by its own site (not counting the tip it grows
 * from). 0 alone, 1 alongside a wall or over a lower level; and how many
 * faces are own, to keep the mass from closing every opening.
 */
function ownContact(a: Architecture, owner: number, x: number, y: number, z: number, move: Vec3, ground: number) {
  let faces = 0
  let weight = 0
  for (const s of SIDES) {
    if (s[0] === -move[0] && s[1] === -move[1] && s[2] === -move[2]) continue
    const py = y + s[1] * MEMBER
    const own = solidAt(a, x + s[0] * MEMBER, py, z + s[2] * MEMBER) === owner
    if (!own) continue
    faces += 1
    weight += s[1] < 0 ? 1.4 : s[1] > 0 ? 0.4 : 1
  }
  // The footing's own ground counts as mass for a first ring of spread.
  if (y - MEMBER < ground + MEMBER * 0.5 && move[1] === 0) weight += 0.3
  return { mass: clamp01(weight / 2.4), faces }
}

/** Overhang a move adds over nothing: a full member level, a third leaning up, none straight up. */
const overhangOf = (move: Vec3) => (move[0] === 0 && move[2] === 0 ? 0 : move[1] === 0 ? 1 : 1 / 3)

/** Scores every move open to a tip. */
export function evaluateTip(a: Architecture, tip: Tip, ctx: GrowthContext, suns: Suns, solid: Solid): Candidate[] {
  if (tip.role === 'support') return evaluateSupport(a, tip, ctx)
  const { statics } = ctx
  const owner = ownerOf(tip.site)
  const [cx, cy, cz] = tipCenter(a, tip)
  const w = SCORE_WEIGHTS[tip.role]
  const site = siteOf(a, tip.site)
  const ceiling = site ? statics.groundAt(site.x, site.z) + GROWTH.maxHeight : Infinity
  const candidates: Candidate[] = []
  for (const move of MOVES) {
    const i = tip.i + move[0] * a.brush
    const j = tip.j + move[1] * a.brush
    const k = tip.k + move[2] * a.brush
    if (i < 0 || k < 0 || j < 0 || i + a.brush > a.n || k + a.brush > a.n || j + a.brush > a.ny) {
      continue
    }
    const x = cx + move[0] * MEMBER
    const y = cy + move[1] * MEMBER
    const z = cz + move[2] * MEMBER
    if (move[1] > 0 && y + MEMBER / 2 > ceiling) {
      continue
    }
    const groundJ = a.groundJ[Math.min(a.n - 1, i + (a.brush >> 1)) + a.n * Math.min(a.n - 1, k + (a.brush >> 1))]!
    if (groundJ === NO_GROUND) {
      continue
    }
    const ground = floorAt(statics, x, z)
    if (y - MEMBER / 2 < ground - MEMBER * 0.6) {
      continue
    }
    const cell = statics.cellAt(x, z)
    if (cell >= 0 && statics.water[cell] && y - MEMBER / 2 < statics.waterLevel[cell]! + 0.15) {
      continue
    }
    const fill = brushFill(a, i, j, k, owner)
    if (fill.own > 0.5) {
      continue
    }
    const heading = normalize(move)
    const light = lightAt(ctx, suns, solid, x, y, z, heading)

    const contact = ownContact(a, owner, x, y, z, move, ground)
    // An opening kept: a position walled in on four or more faces is left empty.
    const mass = contact.faces >= 4 ? 0.1 : contact.mass

    let adjacentOther = 0
    for (const s of SIDES) {
      const o = solidAt(a, x + s[0] * MEMBER, y + s[1] * MEMBER, z + s[2] * MEMBER)
      if (o && o !== owner) adjacentOther += 1
    }
    let approach = 0
    for (let d = MEMBER; d <= GROWTH.sight; d += MEMBER / 2) {
      const o = solidAt(a, x + heading[0] * d, y + heading[1] * d, z + heading[2] * d)
      if (o === owner) break
      if (o) {
        approach = 1 - d / GROWTH.sight
        break
      }
    }
    const fuse = fill.other > 0.3
    const connection = fuse ? 1 : clamp01(0.55 * Math.min(1, adjacentOther / 2) + 0.45 * approach)

    const drop = dropBelow(a, statics, x, y - MEMBER / 2, z, MEMBER * 0.6)
    const cantilever = drop <= MEMBER * 0.6 ? 0 : tip.cantilever + overhangOf(move)
    const support = clamp01(1 - cantilever / GROWTH.cantilever)
    const momentum = ((1 + heading[0] * tip.dir[0] + heading[1] * tip.dir[1] + heading[2] * tip.dir[2]) / 2) ** 2
    const height = Number.isFinite(ground) ? y - ground : 3
    // A lone column may grow tall; only a very tall one on a narrow base is at risk.
    const slender = (1 - baseBreadth(a, x, y, z)) * smoothstep(2, 4.5, height)
    const risk = Math.min(1.6, 0.8 * (cantilever / GROWTH.cantilever) ** 2 + 0.3 * smoothstep(3, 6, height) + 0.35 * slender)
    const form = move[1] === 0 ? -GROWTH.level[tip.role] : tip.role === 'reach' ? GROWTH.rise : 0
    const spread = site ? Math.hypot(x - site.x, z - site.z) : 0
    const compact = GROWTH.compactCost * smoothstep(GROWTH.compact[0], GROWTH.compact[1], spread)

    const score =
      w.light * light +
      w.mass * mass +
      w.connection * connection +
      w.support * support +
      w.momentum * momentum -
      w.risk * risk +
      form -
      compact
    candidates.push({ x, y, z, move, light, mass, connection, support, momentum, risk, score, chosen: false })
  }
  return candidates
}

/**
 * A support front's moves: down toward whatever will carry it, straight
 * down first. It stops when it lands on the ground or its own mass.
 */
function evaluateSupport(a: Architecture, tip: Tip, ctx: GrowthContext): Candidate[] {
  const { statics } = ctx
  const owner = ownerOf(tip.site)
  const [cx, cy, cz] = tipCenter(a, tip)
  const candidates: Candidate[] = []
  for (const move of DOWN) {
    const i = tip.i + move[0] * a.brush
    const j = tip.j + move[1] * a.brush
    const k = tip.k + move[2] * a.brush
    if (i < 0 || k < 0 || j < 0 || i + a.brush > a.n || k + a.brush > a.n) continue
    const groundJ = a.groundJ[Math.min(a.n - 1, i + (a.brush >> 1)) + a.n * Math.min(a.n - 1, k + (a.brush >> 1))]!
    if (groundJ === NO_GROUND || groundJ === AIR || j < groundJ) continue
    const x = cx + move[0] * MEMBER
    const y = cy + move[1] * MEMBER
    const z = cz + move[2] * MEMBER
    const fill = brushFill(a, i, j, k, owner)
    if (fill.own > 0.5 || fill.other > 0.5) continue
    const drop = dropBelow(a, statics, x, y - MEMBER / 2, z, GROWTH.braceDrop)
    const heading = normalize(move)
    const momentum = ((1 + heading[0] * tip.dir[0] + heading[1] * tip.dir[1] + heading[2] * tip.dir[2]) / 2) ** 2
    const support = clamp01(1 - drop / GROWTH.braceDrop)
    const straight = move[0] === 0 && move[2] === 0 ? 1 : 0.55
    const score = 0.5 * straight + 0.5 * support + 0.3 * momentum
    candidates.push({ x, y, z, move, light: 0, mass: 0, connection: 0, support, momentum, risk: 0, score, chosen: false })
  }
  return candidates
}

/** Whether a support front's member has landed: ground or its own mass right under it. */
function landed(a: Architecture, statics: Statics, tip: Tip) {
  const [x, y, z] = tipCenter(a, tip)
  const below = y - (a.brush * a.voxel) / 2 - a.voxel / 2
  return below <= floorAt(statics, x, z) + a.voxel * 0.5 || solidAt(a, x, below, z) === ownerOf(tip.site)
}

function pick(candidates: Candidate[], rng: Rng): number {
  let best = -Infinity
  for (const c of candidates) best = Math.max(best, c.score)
  let total = 0
  const weights = candidates.map((c) => {
    const w = Math.exp((c.score - best) / GROWTH.temperature)
    total += w
    return w
  })
  let r = random(rng) * total
  for (let n = 0; n < candidates.length; n += 1) {
    r -= weights[n]!
    if (r <= 0) return n
  }
  return candidates.length - 1
}

const siteAge = (site: Site | undefined, clock: number) => (site ? clock - site.born : Infinity)

/** A young site grows at full vigour; an old one keeps a little while it still stands. */
export function siteVigor(site: Site | undefined, clock: number) {
  if (!site) return 0
  const youth = 1 - smoothstep(GROWTH.sitePrime, GROWTH.siteLife, siteAge(site, clock))
  return site.voxels > 0 ? Math.max(GROWTH.elder, youth) : youth
}

export function tipVigor(a: Architecture, tip: Tip, clock: number) {
  return siteVigor(siteOf(a, tip.site), clock) * (1 - smoothstep(GROWTH.tipLife * 0.6, GROWTH.tipLife, clock - tip.born))
}

function newTip(a: Architecture, site: number, role: FrontRole, corner: { i: number; j: number; k: number }, dir: Vec3, clock: number): Tip {
  const tip: Tip = {
    id: a.nextTip,
    site,
    role,
    ...corner,
    dir,
    move: [0, 1, 0],
    remaining: 0,
    energy: 0,
    light: 0.6,
    cantilever: 0,
    born: clock,
    members: 0,
    candidates: [],
    fusing: false,
  }
  a.nextTip += 1
  return tip
}

/** A tip chooses its next member, perhaps branching. Returns false when it goes dormant. */
function decide(a: Architecture, tip: Tip, ctx: GrowthContext, suns: Suns, solid: Solid, clock: number): boolean {
  if (tip.fusing) {
    const [x, y, z] = tipCenter(a, tip)
    a.events.push({ kind: 'bridge', x, y, z, site: tip.site, clock })
    return false
  }
  if (tip.role === 'support' && tip.members > 0 && landed(a, ctx.statics, tip)) {
    const [x, y, z] = tipCenter(a, tip)
    a.events.push({ kind: 'brace', x, y, z, site: tip.site, clock })
    return false
  }
  const candidates = evaluateTip(a, tip, ctx, suns, solid)
  tip.candidates = candidates
  if (candidates.length === 0) return false
  const best = candidates.reduce((m, c) => Math.max(m, c.score), -Infinity)
  if (best < GROWTH.minScore) return false
  const chosen = candidates[pick(candidates, ctx.rng)]!
  chosen.chosen = true
  const heading = normalize(chosen.move)
  tip.dir = normalize([
    tip.dir[0] * 0.5 + heading[0] * 0.5,
    tip.dir[1] * 0.5 + heading[1] * 0.5,
    tip.dir[2] * 0.5 + heading[2] * 0.5,
  ])
  tip.move = chosen.move
  tip.remaining = a.brush
  tip.light = chosen.light
  const drop = dropBelow(a, ctx.statics, chosen.x, chosen.y - MEMBER / 2, chosen.z, MEMBER * 0.6)
  tip.cantilever = drop <= MEMBER * 0.6 ? 0 : tip.cantilever + overhangOf(chosen.move)
  tip.fusing = tip.role !== 'support' && chosen.connection >= 1
  tip.members += 1
  if (tip.role === 'support') return true

  const vigor = tipVigor(a, tip, clock)
  const live = a.tips.length
  const siteTips = a.tips.filter((t) => t.site === tip.site).length
  // Far out over nothing: bud a strut beneath the arm, if there is ground to reach.
  if (
    tip.cantilever >= GROWTH.braceAt &&
    live < GROWTH.maxTips + 4 &&
    !a.tips.some((t) => t.role === 'support' && t.site === tip.site && clock - t.born < 6) &&
    random(ctx.rng) < 0.6
  ) {
    const [x, y, z] = tipCenter(a, tip)
    const below = y - MEMBER
    if (below > LATTICE_BASE && !solidAt(a, x, below, z) && dropBelow(a, ctx.statics, x, below, z, GROWTH.braceDrop) < GROWTH.braceDrop) {
      const strut = newTip(a, tip.site, 'support', { i: tip.i, j: tip.j, k: tip.k }, [0, -1, 0], clock)
      strut.move = [0, -1, 0]
      strut.light = tip.light
      a.tips.push(strut)
    }
  }
  if (live < GROWTH.maxTips && siteTips < GROWTH.maxTipsPerSite && random(ctx.rng) < GROWTH.branch * vigor * (0.4 + 0.6 * chosen.light)) {
    const other = candidates
      .filter((c) => !c.chosen && c.score > best * 0.55)
      .filter((c) => {
        const h = normalize(c.move)
        return h[0] * heading[0] + h[1] * heading[1] + h[2] * heading[2] < 0.75
      })
      .sort((p, q) => q.score - p.score)[0]
    if (other) {
      // Fronts alternate: a reaching arm buds a spreading one that thickens it, and the reverse.
      const flip = random(ctx.rng) < (tip.role === 'reach' ? 0.55 : 0.35)
      const role: FrontRole = flip ? (tip.role === 'reach' ? 'spread' : 'reach') : tip.role
      const child = newTip(a, tip.site, role, { i: tip.i, j: tip.j, k: tip.k }, normalize(other.move), clock)
      child.move = other.move
      child.remaining = a.brush
      child.light = other.light
      child.cantilever = tip.cantilever
      a.tips.push(child)
    }
  }
  return true
}

/**
 * The rooted mass a site begins from: every column within the footing
 * radius filled from its own ground up one member, and a plinth a member
 * higher inside, so the base follows the slope and stands broad.
 */
function layFooting(a: Architecture, site: Site, clock: number): { ci: number; ck: number; top: number } {
  const ci = Math.round((site.x - LATTICE_X0) / a.voxel)
  const ck = Math.round((site.z - LATTICE_Z0) / a.voxel)
  const r = GROWTH.footing * a.brush
  const inner = GROWTH.plinth * a.brush
  let top = 0
  for (let dk = -Math.ceil(r); dk <= Math.ceil(r); dk += 1) {
    for (let di = -Math.ceil(r); di <= Math.ceil(r); di += 1) {
      const d = Math.hypot(di, dk)
      if (d > r) continue
      const i = ci + di
      const k = ck + dk
      if (i < 0 || k < 0 || i >= a.n || k >= a.n) continue
      const g = a.groundJ[i + a.n * k]!
      if (g < 0) continue
      const height = (d <= inner ? 2 : 1) * a.brush
      for (let j = g; j < Math.min(a.ny, g + height); j += 1) {
        if (setVoxel(a, i, j, k, site.id, clock)) site.voxels += 1
      }
      if (d <= 0.5) top = Math.min(a.ny - 1, g + height)
    }
  }
  return { ci, ck, top }
}

/**
 * Seeds a new site where the ground stands out and is lit, away from the
 * standing structures (so the architecture spreads over the island's
 * high places rather than crowding one), or on the rubble of an old one.
 */
function seedSite(a: Architecture, ctx: GrowthContext, suitability: Float32Array, clock: number): boolean {
  const { statics, rng } = ctx
  const live = a.sites.filter((s) => siteVigor(s, clock) > 0.5)
  if (live.length >= GROWTH.maxLiveSites) return false
  const standing = a.sites.filter((s) => s.voxels > 0)
  // The environment decides the suitable regions: ground within a share of the best on offer.
  let best = 0
  for (let index = 0; index < suitability.length; index += 3) best = Math.max(best, suitability[index]!)
  const region = Math.max(0.04, best * GROWTH.region)
  const options: { index: number; weight: number }[] = []
  let total = 0
  for (let index = 0; index < suitability.length; index += 3) {
    let s = suitability[index]!
    if (s < region) continue
    const [x, z] = cellCenter(index)
    let nearest = Infinity
    for (const site of standing) nearest = Math.min(nearest, Math.hypot(site.x - x, site.z - z))
    if (nearest < GROWTH.siteSpacing) continue
    const ruin = Math.min(1, ctx.rubble[index]! * 10)
    // Spacing keeps sites apart; a weak pull settles new ones near (not on) others, so they group loosely.
    const spacing = 0.5 + 0.5 * smoothstep(GROWTH.siteSpacing, GROWTH.siteFree, nearest)
    const cluster = Number.isFinite(nearest) ? 1 + GROWTH.cluster * Math.exp(-(((nearest - GROWTH.siteSpacing * 1.5) / 2) ** 2)) : 1
    s *= spacing * cluster * (1 + 0.5 * ruin)
    const weight = s * s
    options.push({ index, weight })
    total += weight
  }
  for (let attempt = 0; attempt < 24 && options.length; attempt += 1) {
    let r = random(rng) * total
    let chosen = options[0]!
    for (const o of options) {
      r -= o.weight
      if (r <= 0) {
        chosen = o
        break
      }
    }
    const [x, z] = cellCenter(chosen.index)
    const i = Math.round((x - LATTICE_X0) / a.voxel)
    const k = Math.round((z - LATTICE_Z0) / a.voxel)
    if (i < 0 || k < 0 || i >= a.n || k >= a.n || a.groundJ[i + a.n * k]! < 0) continue
    if (statics.groundAt(x, z) > LATTICE_BASE + LATTICE_HEIGHT - GROWTH.headroom) continue
    if (nearSolid(a, x, statics.groundAt(x, z), z, 0.8)) continue
    const site: Site = { id: a.nextSite, x, z, born: clock, voxels: 0, collapsed: 0, struck: -Infinity, kind: siteKind(statics, chosen.index) }
    a.nextSite += 1
    a.sites.push(site)
    const footing = layFooting(a, site, clock)
    sproutFronts(a, site, footing, ctx, clock)
    a.events.push({ kind: 'seed', x, y: statics.groundAt(x, z), z, site: site.id, clock, ruin: ctx.rubble[chosen.index]! > 0.03 })
    return true
  }
  return false
}

/**
 * Fronts leave a fresh pad: two reaching fronts from its edge, climbing
 * with a slight lean either side of the sun's bearing, and one spreading
 * front from its centre that branches around them.
 */
function sproutFronts(a: Architecture, site: Site, footing: { ci: number; ck: number; top: number }, ctx: GrowthContext, clock: number) {
  const suns = growthSuns(ctx.noon)
  const sunAngle = Math.atan2(suns.mean[2], suns.mean[0])
  const half = a.brush >> 1
  const edge = Math.round((GROWTH.footing - 0.5) * a.brush)
  for (let n = 0; n < 2; n += 1) {
    const angle = sunAngle + (n ? 1 : -1) * (0.9 + random(ctx.rng) * 0.7)
    const dir = LATERAL.reduce((best, m) => {
      const h = normalize(m)
      const score = h[0] * Math.cos(angle) + h[2] * Math.sin(angle)
      const b = normalize(best)
      return score > b[0] * Math.cos(angle) + b[2] * Math.sin(angle) ? m : best
    }, LATERAL[0]!)
    const h = normalize(dir)
    const i = Math.max(0, Math.min(a.n - a.brush, footing.ci + Math.round(h[0] * edge) - half))
    const k = Math.max(0, Math.min(a.n - a.brush, footing.ck + Math.round(h[2] * edge) - half))
    const g = a.groundJ[Math.min(a.n - 1, i + half) + a.n * Math.min(a.n - 1, k + half)]!
    if (g < 0) continue
    const j = Math.min(a.ny - a.brush, Math.max(g, footing.top - a.brush))
    a.tips.push(newTip(a, site.id, 'reach', { i, j, k }, normalize([h[0] * 0.35, 1, h[2] * 0.35]), clock))
  }
  const toward = normalize([suns.mean[0] * 0.5, 1, suns.mean[2] * 0.5])
  const corner = { i: footing.ci - half, j: Math.max(0, Math.min(a.ny - a.brush, footing.top - a.brush)), k: footing.ck - half }
  a.tips.push(newTip(a, site.id, 'spread', corner, toward, clock))
}

function nearSolid(a: Architecture, x: number, y: number, z: number, radius: number) {
  for (let dz = -radius; dz <= radius; dz += MEMBER) {
    for (let dx = -radius; dx <= radius; dx += MEMBER) {
      for (let dy = 0; dy <= 0.6; dy += MEMBER) {
        if (solidAt(a, x + dx, y + dy, z + dz)) return true
      }
    }
  }
  return false
}

/**
 * A site re-sprouts from its own survivors: a well-lit top becomes a
 * reaching front, a lit side face of the mass a spreading one. After a
 * collapse it heals from the broken edge first.
 */
function reiterate(a: Architecture, site: Site, ctx: GrowthContext, suns: Suns, solid: Solid, clock: number) {
  const owner = ownerOf(site.id)
  let best: { i: number; j: number; k: number; light: number; dir: Vec3; role: FrontRole } | null = null
  const r = Math.round(1.6 / a.voxel)
  const ci = Math.floor((site.x - LATTICE_X0) / a.voxel)
  const ck = Math.floor((site.z - LATTICE_Z0) / a.voxel)
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const i = ci + Math.floor((random(ctx.rng) * 2 - 1) * r)
    const k = ck + Math.floor((random(ctx.rng) * 2 - 1) * r)
    if (i < 1 || k < 1 || i >= a.n - 1 || k >= a.n - 1) continue
    const g = a.groundJ[i + a.n * k]!
    if (g < 0) continue
    // Topmost own voxel of the column.
    let topJ = -1
    for (let j = a.ny - 2; j >= g; j -= 1) {
      const s = a.solid[archIndex(a, i, j, k)]!
      if (!s) continue
      if (s === owner) topJ = j
      break
    }
    if (topJ < 0) continue
    const side = random(ctx.rng) < 0.55
    if (side) {
      // A lit side face part-way up: grow sideways out of the mass.
      const j = g + Math.floor(random(ctx.rng) * (topJ - g + 1))
      if (a.solid[archIndex(a, i, j, k)] !== owner) continue
      const m = LATERAL[Math.floor(random(ctx.rng) * 4)]!
      const ni = i + m[0]
      const nk = k + m[2]
      if (a.solid[archIndex(a, ni, j, nk)]) continue
      const x = latticeX(a, ni)
      const y = latticeY(a, j)
      const z = latticeZ(a, nk)
      const light = lightAt(ctx, suns, solid, x, y, z, normalize(m))
      if (!best || light > best.light) best = { i: ni, j, k: nk, light, dir: normalize(m), role: 'spread' }
    } else {
      const x = latticeX(a, i)
      const y = latticeY(a, topJ) + a.voxel
      const z = latticeZ(a, k)
      if (y > ctx.statics.groundAt(site.x, site.z) + GROWTH.maxHeight - MEMBER) continue
      const light = lightAt(ctx, suns, solid, x, y, z, [0, 1, 0])
      if (!best || light > best.light) best = { i, j: topJ + 1, k, light, dir: normalize([suns.mean[0], 0.8, suns.mean[2]]), role: 'reach' }
    }
  }
  if (!best || best.light < 0.4) return
  const corner = { i: best.i - (a.brush >> 1), j: best.j, k: best.k - (a.brush >> 1) }
  a.tips.push(newTip(a, site.id, best.role, corner, best.dir, clock))
}

/** Advances every tip by the light it has gathered over `hours`. */
export function growArchitecture(a: Architecture, ctx: GrowthContext, hours: number, clock: number) {
  if (!ctx.growing || hours <= 0) return
  const suns = growthSuns(ctx.noon)
  const solid = architectureSolid(a)
  const survivors: Tip[] = []
  for (const tip of a.tips) {
    const vigor = tipVigor(a, tip, clock)
    if (vigor < 0.05) continue
    const [x, , z] = tipCenter(a, tip)
    const day = GROWTH.floor + (1 - GROWTH.floor) * ctx.daylight * ctx.weatherLight
    const fed = tip.role === 'support' ? 0.8 : 0.25 + 0.75 * tip.light
    tip.energy += hours * GROWTH.rate * a.brush * fed * day * vigor * ctx.growthSpeed * lensFactor(ctx.lens, x, z)
    let alive = true
    let guard = 0
    while (tip.energy >= 1 && alive && guard < 12) {
      guard += 1
      if (tip.remaining <= 0) {
        solid.top = a.top
        alive = decide(a, tip, ctx, suns, solid, clock)
        if (!alive) break
      }
      tip.remaining -= 1
      if (a.brush === 1) {
        // Single-voxel members step one axis at a time, so a leaning member stays face-connected.
        if (tip.move[0]) {
          tip.i += tip.move[0]
          stamp(a, tip, clock)
        }
        if (tip.move[2]) {
          tip.k += tip.move[2]
          stamp(a, tip, clock)
        }
        if (tip.move[1]) {
          tip.j += tip.move[1]
          stamp(a, tip, clock)
        }
      } else {
        tip.i += tip.move[0]
        tip.j += tip.move[1]
        tip.k += tip.move[2]
        stamp(a, tip, clock)
      }
      const [hx, hy, hz] = tipCenter(a, tip)
      const lifted = tip.role === 'support' ? 0 : Math.min(GROWTH.liftCap, Math.max(0, hy - floorAt(ctx.statics, hx, hz)))
      tip.energy -= 1 + GROWTH.lift * lifted
    }
    if (alive) survivors.push(tip)
  }
  // Branches pushed during the pass were visited by it too, so survivors holds them.
  a.tips = survivors

  a.seedClock += hours * ctx.growthSpeed
  const youngSites = a.sites.filter((s) => siteVigor(s, clock) > 0.5)
  if (a.seedClock >= GROWTH.seedEvery || (youngSites.length < 2 && a.seedClock >= GROWTH.seedEvery / 4)) {
    a.seedClock = 0
    seedSite(a, ctx, ctxSuitability(ctx), clock)
  }
  for (const site of a.sites) {
    if (site.voxels <= 0) continue
    const fronts = a.tips.filter((t) => t.site === site.id).length
    if (fronts >= GROWTH.siteFronts) continue
    const healing = clock - site.struck < 24 ? 3 : 1
    const odds = (fronts === 0 ? 0.08 : 0.03) * healing * siteVigor(site, clock) * hours * ctx.growthSpeed
    if (random(ctx.rng) < odds) reiterate(a, site, ctx, suns, solid, clock)
  }
}

const seedCache = new WeakMap<Float32Array, Float32Array>()

/** The site rule on the current daylight, computed once per traced daylight field. */
function ctxSuitability(ctx: GrowthContext): Float32Array {
  let result = seedCache.get(ctx.insolation)
  if (!result) {
    result = seedSuitability(ctx.statics, ctx.insolation)
    seedCache.set(ctx.insolation, result)
  }
  return result
}

/**
 * Re-solves support as a least-cost spread from anchored voxels (those on
 * the ground), in half-steps: vertical steps are free, a horizontal step
 * costs 2, or 1 inside a slab (solid above or below the voxel it reaches),
 * so thick work carries further than a single member. Returns indices that
 * lost their way to the ground or overhang too far.
 */
export function solveSupport(a: Architecture): number[] {
  const { support, solid, n, cols, ny } = a
  const limit = Math.min(254, 2 * BREAK_CANTILEVER * a.brush)
  const buckets: number[][] = Array.from({ length: limit + 1 }, () => [])
  forEachOccupied(a, (col, i, k) => {
    let placed = false
    for (let j = 0; j < ny; j += 1) {
      const index = col + cols * j
      if (solid[index] && support[index] === SUPPORT_UNSOLVED) placed = true
      support[index] = 255
    }
    // Drawn while their support was unknown; redrawn once it is.
    if (placed) redraw(a, i, k)
    const g = a.groundJ[col]!
    if (g < 0) return
    // Within a member of the ground a voxel bears on it, even if the one under it has worn away.
    for (let j = g; j <= Math.min(ny - 1, g + a.brush); j += 1) {
      const index = col + cols * j
      if (solid[index]) {
        support[index] = 0
        buckets[0]!.push(index)
      }
    }
  })
  for (let level = 0; level <= limit; level += 1) {
    const stack = buckets[level]!
    while (stack.length) {
      const index = stack.pop()!
      if (support[index]! !== level) continue
      const j = Math.floor(index / cols)
      const col = index - j * cols
      const i = col % n
      const k = (col - i) / n
      for (const dj of [-1, 1]) {
        const jj = j + dj
        if (jj < 0 || jj >= ny) continue
        const m = index + dj * cols
        if (solid[m] && support[m]! > level) {
          support[m] = level
          stack.push(m)
        }
      }
      for (const [di, dk] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const ii = i + di
        const kk = k + dk
        if (ii < 0 || kk < 0 || ii >= n || kk >= n) continue
        const m = index + di + dk * n
        if (!solid[m]) continue
        const slab = (j > 0 && solid[m - cols]) || (j < ny - 1 && solid[m + cols])
        const cost = level + (slab ? 1 : 2)
        if (cost <= limit && support[m]! > cost) {
          support[m] = cost
          buckets[cost]!.push(m)
        }
      }
    }
  }
  const fallen: number[] = []
  forEachOccupied(a, (col) => {
    for (let j = Math.max(0, a.groundJ[col]!); j < ny; j += 1) {
      const index = col + cols * j
      if (solid[index] && support[index]! > limit) fallen.push(index)
    }
  })
  return fallen
}

/** Stress 0…1: cantilever over its limit, more for an unsupported underside. */
export function voxelStress(a: Architecture, index: number): number {
  const s = a.support[index]!
  if (s === 255) return 1
  const limit = 2 * BREAK_CANTILEVER * a.brush
  const below = index - a.cols
  const overhang = below >= 0 && !a.solid[below] && s > 0 ? 0.2 : 0
  return clamp01(s / limit + overhang)
}

export function openFaces(a: Architecture, index: number): number {
  const [i, j, k] = voxelCoords(a, index)
  const col = i + a.n * k
  let open = 0
  if (i === 0 || !a.solid[index - 1]) open += 1
  if (i === a.n - 1 || !a.solid[index + 1]) open += 1
  if (k === 0 || !a.solid[index - a.n]) open += 1
  if (k === a.n - 1 || !a.solid[index + a.n]) open += 1
  if (j === a.ny - 1 || !a.solid[index + a.cols]) open += 1
  if (j > a.groundJ[col]! && (j === 0 || !a.solid[index - a.cols])) open += 1
  return open
}

/**
 * Removes fallen voxels as collapses: each connected piece falls on its own
 * (rubble below, fragments to draw falling, an event), so a failure stays
 * local to where it happened.
 */
function collapse(a: Architecture, statics: Statics, fallen: number[], clock: number, rng: Rng) {
  if (!fallen.length) return
  const pending = new Set(fallen)
  const volume = a.voxel ** 3
  for (const start of fallen) {
    if (!pending.has(start)) continue
    const piece: number[] = []
    const stack = [start]
    pending.delete(start)
    while (stack.length) {
      const index = stack.pop()!
      piece.push(index)
      for (const step of [1, -1, a.n, -a.n, a.cols, -a.cols]) {
        const m = index + step
        if (pending.has(m)) {
          pending.delete(m)
          stack.push(m)
        }
      }
    }
    let sx = 0
    let sy = 0
    let sz = 0
    const owners = new Map<number, number>()
    const stride = Math.max(1, Math.floor(piece.length / 160))
    piece.forEach((index, n) => {
      const [i, j, k] = voxelCoords(a, index)
      const x = latticeX(a, i)
      const y = latticeY(a, j)
      const z = latticeZ(a, k)
      sx += x
      sy += y
      sz += z
      const owner = a.solid[index]!
      owners.set(owner, (owners.get(owner) ?? 0) + 1)
      const below = floorAt(statics, x, z)
      const scatter = 0.25 * Math.min(3, y - below)
      const rx = x + (random(rng) - 0.5) * scatter
      const rz = z + (random(rng) - 0.5) * scatter
      const lands = floorAt(statics, rx, rz)
      // Whatever falls past the rim is gone into the cloud below.
      if (Number.isFinite(lands)) a.rubble.push(rx, rz, volume)
      if (n % stride === 0) {
        a.fragments.push({ x, y, z, ground: Number.isFinite(lands) ? lands : statics.cloud, size: a.voxel * Math.cbrt(stride), born: clock })
      }
      clearVoxel(a, index)
    })
    const count = piece.length
    a.collapsed += count
    const owner = [...owners.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? 1
    const site = a.sites.find((s) => ownerOf(s.id) === owner && s.voxels > 0) ?? a.sites.find((s) => ownerOf(s.id) === owner)
    if (site) {
      site.collapsed += count
      site.voxels = Math.max(0, site.voxels - count)
      site.struck = clock
    }
    a.events.push({ kind: 'collapse', x: sx / count, y: sy / count, z: sz / count, voxels: count, site: site?.id ?? -1, clock })
  }
  // Tips whose head fell go with it.
  a.tips = a.tips.filter((t) => {
    const [x, y, z] = tipCenter(a, t)
    return solidAt(a, x, y, z) !== 0
  })
}

/** Whether another voxel reaches the ground through this one: solid above, or a side neighbour further from the ground. */
function carriesLoad(a: Architecture, index: number, i: number, j: number, k: number): boolean {
  const { solid, support, n, cols, ny } = a
  if (j < ny - 1 && solid[index + cols]) return true
  const s = support[index]!
  if (s === 255) return false
  if (i > 0 && solid[index - 1] && support[index - 1]! > s) return true
  if (i < n - 1 && solid[index + 1] && support[index + 1]! > s) return true
  if (k > 0 && solid[index - n] && support[index - n]! > s) return true
  return k < n - 1 && !!solid[index + n] && support[index + n]! > s
}

/** Weathers exposed voxels for `hours`; then collapses whatever lost support. */
export function decayArchitecture(a: Architecture, ctx: GrowthContext, hours: number, clock: number) {
  if (!ctx.decaying) return
  a.decayClock += hours
  if (a.decayClock < DECAY.tick) return
  const dt = a.decayClock
  a.decayClock = 0
  const weather = 1 + 1.2 * ctx.rain + 0.3 * ctx.fog + 0.5 * ctx.drought
  const scale = DECAY.base * (MEMBER / a.voxel) * weather * ctx.decaySpeed * dt
  const removed: number[] = []
  const { solid, birth, cols, ny } = a
  forEachOccupied(a, (col, i, k) => {
    const g = a.groundJ[col]!
    const slow = lensFactor(ctx.lens, latticeX(a, i), latticeZ(a, k))
    for (let j = Math.max(0, g); j < ny; j += 1) {
      const index = col + cols * j
      if (!solid[index]) continue
      const age = clock - birth[index]!
      if (age < DECAY.onset) continue
      const open = openFaces(a, index)
      if (open < 2) continue
      const height = g >= 0 ? (j - g) * a.voxel : 2.4
      const footing = g >= 0 && j - g < 2 * a.brush ? 0.35 : 1
      // A voxel something else rests on weathers slowly, so structures wear from their tops and ends inward.
      const bearing = carriesLoad(a, index, i, j, k) ? DECAY.bearing : 1
      const hazard =
        scale *
        smoothstep(DECAY.onset, DECAY.full, age) ** 1.5 *
        ((open - 1) / 5) ** 1.6 *
        (0.5 + 2.6 * voxelStress(a, index)) *
        (1 + 0.4 * smoothstep(0.4, 2.4, height)) *
        footing *
        bearing *
        slow
      if (random(ctx.rng) < hazard) removed.push(index)
    }
  })
  if (!removed.length) {
    if (a.supportVersion !== a.version) {
      collapse(a, ctx.statics, solveSupport(a), clock, ctx.rng)
      a.supportVersion = a.version
    }
    return
  }
  for (const index of removed) {
    const [i, , k] = voxelCoords(a, index)
    if (a.groundJ[i + a.n * k]! >= 0) a.rubble.push(latticeX(a, i), latticeZ(a, k), a.voxel ** 3 * 0.5)
    const site = a.sites.find((s) => ownerOf(s.id) === solid[index] && s.voxels > 0)
    if (site) site.voxels -= 1
    clearVoxel(a, index)
  }
  a.weathered += removed.length
  collapse(a, ctx.statics, solveSupport(a), clock, ctx.rng)
  a.supportVersion = a.version
}

export function createArchitecture(statics: Statics, resolution: Resolution): Architecture {
  return emptyArchitecture(statics, resolution)
}

/** Seeds the first sites. */
export function seedInitialSites(a: Architecture, ctx: GrowthContext, clock: number) {
  for (let s = 0; s < GROWTH.initialSites; s += 1) {
    a.seedClock = 0
    seedSite(a, ctx, ctxSuitability(ctx), clock)
  }
}

/**
 * The same structure on another lattice. Finer: every new voxel whose centre
 * lies in an old one. Coarser: every new voxel holding an old one's centre,
 * so thin members survive. Tips keep their world positions; support is
 * re-solved.
 */
export function resampleArchitecture(old: Architecture, statics: Statics, resolution: Resolution): Architecture {
  const a = emptyArchitecture(statics, resolution)
  a.tips = []
  a.sites = old.sites.map((s) => ({ ...s }))
  a.nextTip = old.nextTip
  a.nextSite = old.nextSite
  a.collapsed = old.collapsed
  a.weathered = old.weathered
  a.seedClock = old.seedClock
  const put = (i: number, j: number, k: number, owner: number, born: number) => {
    if (i < 0 || k < 0 || j < 0 || i >= a.n || k >= a.n || j >= a.ny) return
    const g = a.groundJ[i + a.n * k]!
    if (g === NO_GROUND || j < g) return
    const index = archIndex(a, i, j, k)
    if (a.solid[index]) return
    a.solid[index] = owner
    a.birth[index] = born
    a.count += 1
    a.occupied[chunkOf(a, i, k)]! += 1
    a.top = Math.max(a.top, LATTICE_BASE + (j + 1) * a.voxel)
  }
  const finer = a.voxel < old.voxel
  forEachOccupied(old, (col, oi, ok) => {
    for (let oj = Math.max(0, old.groundJ[col]!); oj < old.ny; oj += 1) {
      const index = col + old.cols * oj
      const owner = old.solid[index]!
      if (!owner) continue
      const born = old.birth[index]!
      if (!finer) {
        put(
          Math.floor((latticeX(old, oi) - LATTICE_X0) / a.voxel),
          Math.floor((latticeY(old, oj) - LATTICE_BASE) / a.voxel),
          Math.floor((latticeZ(old, ok) - LATTICE_Z0) / a.voxel),
          owner,
          born,
        )
        continue
      }
      const range = (o: number) => [Math.ceil((o * old.voxel) / a.voxel - 0.5), Math.floor(((o + 1) * old.voxel) / a.voxel - 0.5)] as const
      const [i0, i1] = range(oi)
      const [j0, j1] = range(oj)
      const [k0, k1] = range(ok)
      for (let j = j0; j <= j1; j += 1) for (let k = k0; k <= k1; k += 1) for (let i = i0; i <= i1; i += 1) put(i, j, k, owner, born)
    }
  })
  // The ground voxel under each anchored column, so footings stay anchored.
  forEachOccupied(a, (col, i, k) => {
    const g = a.groundJ[col]!
    if (g < 0 || g + 1 >= a.ny) return
    const above = col + a.cols * (g + 1)
    if (a.solid[above] && !a.solid[col + a.cols * g]) put(i, g, k, a.solid[above]!, a.birth[above]!)
  })
  // Site counts follow the resampled lattice.
  const counts = new Map<number, number>()
  forEachOccupied(a, (col) => {
    for (let j = 0; j < a.ny; j += 1) {
      const s = a.solid[col + a.cols * j]!
      if (s) counts.set(s, (counts.get(s) ?? 0) + 1)
    }
  })
  for (const site of a.sites) site.voxels = site.voxels > 0 ? (counts.get(ownerOf(site.id)) ?? 0) : 0
  for (const tip of old.tips) {
    const [x, y, z] = tipCenter(old, tip)
    const corner = cornerFor(a, x, y, z)
    a.tips.push({
      ...tip,
      ...corner,
      remaining: 0,
      energy: (tip.energy / old.brush) * a.brush,
      candidates: [],
    })
  }
  solveSupport(a)
  a.chunkVersion.fill(1)
  a.version = old.version + 1
  return a
}

export const ARCH_LIMITS = { cantilever: GROWTH.cantilever, breakCantilever: BREAK_CANTILEVER, decayOnset: DECAY.onset, decayFull: DECAY.full, siteLife: GROWTH.siteLife, tipLife: GROWTH.tipLife } as const
