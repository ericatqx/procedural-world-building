import { BufferAttribute, BufferGeometry } from 'three'
import { cellCenter, cellIndex, CELL, GRID_EXTENT, GRID_SIZE } from './grid.ts'
import type { Hydrology } from './hydrology.ts'
import type { Solid } from './light.ts'
import { outlineRadius } from './terrain.ts'

/**
 * Shadow Ecology — architecture that emerges and grows by rule.
 *
 * Sites: land scored by  light · footing · water edge  (drawn to shores and
 * river banks, never in the water). The best becomes the first site; up to
 * two more gather close around it, scored again by nearness, so architecture
 * concentrates where sun, water and ground meet.
 * Each starts as a small stepped block.
 *
 * Growth: a grammar of moves on small square modules (MODULE × MODULE voxel
 * columns), one move at a time; a move may place several modules at once:
 *
 *   rise        lift a module, with its row, so rows rise into walls
 *   wall        continue a row at full height, a run of modules, broad face to the sun
 *   terrace     step down into a strip along the face, towards the sun
 *   cantilever  a thin slab out from a high module, open underneath
 *   span        a thin slab across a gap to an equally high module
 *   opening     open a passage through the foot of a thin wall
 *   cut         open a light well in the middle of a deep mass
 *
 * Each move is weighted by
 *
 *   sunlit now · sun direction · form (rows, edges, joins) · water edge · footing · site vigour
 *
 * and drawn at random by weight. Larger sites grow faster and moves that join
 * two structures are favoured, so growth consolidates into a few masses that
 * reach for the light and, as they grow, shade the ground and themselves.
 * Footing is the ground's steepest fall nearby, and a setback from the
 * island rim: grounded mass prefers stable interior ground, thins out on
 * steep ground and towards the rim, and stops short of both. Slabs may reach
 * out past it, over rivers, lakes and drops, but only as separate straight
 * arms: a slab carries a further cantilever only in the direction it already
 * runs, and no cantilever is laid beside another slab. Growth speed is a
 * voxel budget, independent of the module size.
 */
export const VOXEL_SIZE = 0.08
const MODULE = 2
export const MODULE_SIZE = MODULE * VOXEL_SIZE
const LATTICE = 80
const MODULES = LATTICE / MODULE
export const LATTICE_ORIGIN = -(LATTICE * VOXEL_SIZE) / 2
const LAYERS = 45
export const LAYER_BASE = -1.2
const FOUNDATION_DEPTH = 0.24

/** Up to this many sites, all gathered near the first (best) one. */
const SITE_COUNT = 3
const SITE_SPACING = 0.9
/** Later sites must lie within this distance of an earlier one, and prefer the nearest. */
const SITE_GATHER = 1.8
const SITE_PROXIMITY = 0.5
const SITE_MIN_SUITABILITY = 0.15
/** Seed block radius in modules, and the buildable modules of that square a site needs. */
const SEED_RADIUS = 2
const SITE_MIN_STANDING = 10
const SITE_RIM_LIMIT = 0.8
const SITE_FOOTING_FULL = 8
const SITE_FOOTING_NONE = 18
/** Distance from water (lake or river cells) most drawn to: just clear of the bank. */
const EDGE_BEST = 0.15
/** Distance past `EDGE_BEST` at which the pull of the water edge falls to 1/e. */
const EDGE_WIDTH = 0.25
/** Growth still spreads away from water, at this fraction of its pull along the edge. */
const EDGE_FLOOR = 0.3
const SLOPE_STEP = 0.05

/** Grounded cells must be clear of the water channel and inside this rim fraction. */
const BUILD_WATER_CLEARANCE = 0.1
const BUILD_RIM_LIMIT = 0.95
/**
 * Footing for grounded growth: the steepest fall from a module to the ground
 * within `FOOTING_REACH` modules, in degrees. Full up to `FOOTING_FULL`,
 * none from `FOOTING_NONE`, so a cliff rejects grounded mass along its edge.
 */
const FOOTING_REACH = 2
const FOOTING_FULL = 25
const FOOTING_NONE = 42
/**
 * Setback from the island rim for grounded growth, by distance to the
 * outline: none within `RIM_SETBACK`, full on interior ground from
 * `RIM_SETBACK_FULL`. Slabs may still reach out past it.
 */
const RIM_SETBACK = 0.35
const RIM_SETBACK_FULL = 1
const OUTLINE_SAMPLES = 720

const MAX_HEIGHT = 1.5
/** Seed block heights in layers above the ground, by ring out from the centre. */
const SEED_LAYERS = [6, 4, 2] as const
/** Layers per move. */
const RISE_LAYERS = 2
const TERRACE_LAYERS = 2
const SLAB_LAYERS = 1
/** Lowest a grounded module stands, and the least headroom under a slab. */
const MIN_LAYERS = 2
const SLAB_CLEARANCE = 3
const MAX_CANTILEVER = 3
/** Longest span, in modules of gap. */
const MAX_SPAN = 5
/** Longest wall run, and modules either side of a terrace's first. */
const WALL_RUN = 3
const TERRACE_REACH = 1
/** An opening clears this many layers above the ground, under a wall at least this tall. */
const OPENING_LAYERS = 3
const OPENING_MIN_LAYERS = 6

/** Growth in shade is not impossible, only much slower. */
const SHADED_GROWTH = 0.08
const UP_BASE = 0.5
const UP_SUN = 1.3
const SIDE_BASE = 0.35
const SIDE_SUN = 1.6
const WALL_WEIGHT = 0.8
const TERRACE_WEIGHT = 1
const CANTILEVER_WEIGHT = 0.2
const SPAN_WEIGHT = 0.5
const CUT_WEIGHT = 0.5
const OPENING_WEIGHT = 0.4
/** Voxel budget a cut or an opening costs. */
const CUT_COST = 10
const OPENING_COST = 8
/** Rising favoured in a row (wall) and next to taller modules (filling in). */
const ROW_BONUS = 1.5
const FILL_BONUS = 0.4
const ISOLATED = 0.3
/** Rising a module already enclosed on all sides only thickens a mass. */
const INTERIOR = 0.35
/** Extending favoured, a little, into notches with more occupied neighbours. */
const COMPACT_BONUS = 0.3
/** Moves that touch another site's structure. */
const JOIN_BONUS = 3
/** Distance from its site at which extension falls to 1/e. */
const SPREAD = 0.9
/** The smallest site still grows at this fraction of the largest one's rate. */
const VIGOUR_FLOOR = 0.2

export type Site = { x: number; z: number; ground: number }

export type Architecture = {
  /** Per voxel: 0 empty, else the site number (1-based). */
  solid: Uint8Array
  /** Per voxel: the `clock` hour it was placed. */
  birth: Float32Array
  /** Simulated hours since Reset; every tick the time passes adds to it, played or scrubbed. */
  clock: number
  /** Per lattice column: ground height, or −Infinity off the island. */
  columnGround: Float32Array
  /** Per module: top layer, or −1 when empty. */
  moduleTop: Int16Array
  /** Per module: bottom layer of a slab; −1 when it stands on the ground. */
  moduleBottom: Int16Array
  moduleSite: Uint8Array
  /** Per module: modules of cantilever from the ground (0 = grounded). */
  moduleSupport: Uint8Array
  /** Per module: 1 once opened as a courtyard; it stays open. */
  moduleCut: Uint8Array
  /** Per module: highest ground (or lake surface) layer under it; −Infinity off the island. */
  moduleGround: Float32Array
  /** Per module: 1 where every column may rest on the ground. */
  moduleBuildable: Uint8Array
  /** Per module: pull of the water edge on growth there (0…1). */
  modulePreference: Float32Array
  /** Per module: footing for grounded growth, 1 on gentle ground … 0 on steep ground and cliff edges. */
  moduleFooting: Float32Array
  /** Per module: setback from the island rim for grounded growth, 1 on interior ground … 0 near the rim. */
  moduleSetback: Float32Array
  sites: Site[]
  /** Voxels above ground per site (foundations excluded). */
  siteVolume: number[]
  /** Voxels above ground (foundations excluded). */
  count: number
  top: number
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

const voxelIndex = (ix: number, iy: number, iz: number) => ix + iz * LATTICE + iy * LATTICE * LATTICE
const voxelCenter = (i: number) => LATTICE_ORIGIN + (i + 0.5) * VOXEL_SIZE
const layerCenter = (iy: number) => LAYER_BASE + (iy + 0.5) * VOXEL_SIZE
const latticeOf = (v: number) => Math.floor((v - LATTICE_ORIGIN) / VOXEL_SIZE)
const layerOf = (y: number) => Math.floor((y - LAYER_BASE) / VOXEL_SIZE)
const inLattice = (ix: number, iy: number, iz: number) =>
  ix >= 0 && iz >= 0 && iy >= 0 && ix < LATTICE && iz < LATTICE && iy < LAYERS
/** Height of the top face of a layer. */
const layerTop = (iy: number) => LAYER_BASE + (iy + 1) * VOXEL_SIZE

const moduleOf = (v: number) => Math.floor((v - LATTICE_ORIGIN) / MODULE_SIZE)
const moduleCenter = (m: number) => LATTICE_ORIGIN + (m + 0.5) * MODULE_SIZE
const moduleX = (m: number) => m % MODULES
const moduleZ = (m: number) => Math.floor(m / MODULES)
const moduleAt = (mx: number, mz: number) =>
  mx >= 0 && mz >= 0 && mx < MODULES && mz < MODULES ? mx + mz * MODULES : -1

/** Opposite sides are adjacent pairs, so side k faces side k ^ 1. */
const SIDES: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/** Where on the island structures can emerge, per hydrology grid cell. */
export function siteSuitability(
  hydrology: Hydrology,
  groundHeight: (x: number, z: number) => number,
  insolation: Float32Array,
): Float32Array {
  const suitability = new Float32Array(GRID_SIZE * GRID_SIZE)
  for (let index = 0; index < suitability.length; index += 1) {
    const [x, z] = cellCenter(index)
    const rim = Math.hypot(x, z) / outlineRadius(Math.atan2(z, x))
    const waterDistance = hydrology.waterDistance[index]!
    if (
      !hydrology.inside[index] ||
      hydrology.lakeId[index]! >= 0 ||
      waterDistance < BUILD_WATER_CLEARANCE ||
      rim > SITE_RIM_LIMIT
    ) {
      continue
    }
    const dx = (groundHeight(x + SLOPE_STEP, z) - groundHeight(x - SLOPE_STEP, z)) / (2 * SLOPE_STEP)
    const dz = (groundHeight(x, z + SLOPE_STEP) - groundHeight(x, z - SLOPE_STEP)) / (2 * SLOPE_STEP)
    const slope = (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI
    const footing = 1 - smoothstep(SITE_FOOTING_FULL, SITE_FOOTING_NONE, slope)
    const light = Math.min(1, insolation[index]!) ** 1.5
    suitability[index] = footing * light * waterEdge(waterDistance)
  }
  return suitability
}

/** Pull of the water edge, 0…1: strongest just clear of a bank or shore. */
function waterEdge(waterDistance: number): number {
  return Math.exp(-((Math.max(0, waterDistance - EDGE_BEST) / EDGE_WIDTH) ** 2))
}

export function createArchitecture(
  hydrology: Hydrology,
  groundHeight: (x: number, z: number) => number,
  insolation: Float32Array,
): Architecture {
  const columnGround = new Float32Array(LATTICE * LATTICE).fill(-Infinity)
  const buildable = new Uint8Array(LATTICE * LATTICE)
  const cellOf = (x: number, z: number) => {
    const i = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor((x + GRID_EXTENT) / CELL)))
    const j = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor((z + GRID_EXTENT) / CELL)))
    return cellIndex(i, j)
  }
  for (let iz = 0; iz < LATTICE; iz += 1) {
    for (let ix = 0; ix < LATTICE; ix += 1) {
      const x = voxelCenter(ix)
      const z = voxelCenter(iz)
      const rim = Math.hypot(x, z) / outlineRadius(Math.atan2(z, x))
      if (rim >= 1) {
        continue
      }
      const column = ix + iz * LATTICE
      columnGround[column] = groundHeight(x, z)
      const cell = cellOf(x, z)
      buildable[column] =
        rim < BUILD_RIM_LIMIT &&
        hydrology.lakeId[cell]! < 0 &&
        hydrology.waterDistance[cell]! >= BUILD_WATER_CLEARANCE
          ? 1
          : 0
    }
  }
  /** Height a slab must clear: the ground, or the lake surface over a lake. */
  const surfaceOf = (column: number) => {
    const lake = hydrology.lakeId[cellOf(voxelCenter(column % LATTICE), voxelCenter(Math.floor(column / LATTICE)))]!
    return lake >= 0 ? Math.max(columnGround[column]!, hydrology.lakes[lake]!.level) : columnGround[column]!
  }

  const moduleGround = new Float32Array(MODULES * MODULES).fill(-Infinity)
  const moduleBuildable = new Uint8Array(MODULES * MODULES)
  const modulePreference = new Float32Array(MODULES * MODULES)
  for (let m = 0; m < moduleGround.length; m += 1) {
    const x = moduleCenter(moduleX(m))
    const z = moduleCenter(moduleZ(m))
    const cell = cellOf(x, z)
    if (hydrology.inside[cell]) {
      modulePreference[m] = EDGE_FLOOR + (1 - EDGE_FLOOR) * waterEdge(hydrology.waterDistance[cell]!)
    }
    let everyColumn = true
    for (let cz = 0; cz < MODULE; cz += 1) {
      for (let cx = 0; cx < MODULE; cx += 1) {
        const column = moduleX(m) * MODULE + cx + (moduleZ(m) * MODULE + cz) * LATTICE
        if (Number.isFinite(columnGround[column]!)) {
          moduleGround[m] = Math.max(moduleGround[m]!, layerOf(surfaceOf(column)))
        }
        everyColumn &&= buildable[column] === 1
      }
    }
    moduleBuildable[m] = everyColumn ? 1 : 0
  }
  const moduleFooting = new Float32Array(MODULES * MODULES)
  for (let m = 0; m < moduleFooting.length; m += 1) {
    if (!moduleBuildable[m]) {
      continue
    }
    const x = moduleCenter(moduleX(m))
    const z = moduleCenter(moduleZ(m))
    const height = groundHeight(x, z)
    let fall = 0
    for (let dz = -FOOTING_REACH; dz <= FOOTING_REACH; dz += 1) {
      for (let dx = -FOOTING_REACH; dx <= FOOTING_REACH; dx += 1) {
        if (dx === 0 && dz === 0) {
          continue
        }
        const drop = Math.abs(groundHeight(x + dx * MODULE_SIZE, z + dz * MODULE_SIZE) - height)
        fall = Math.max(fall, drop / (Math.hypot(dx, dz) * MODULE_SIZE))
      }
    }
    moduleFooting[m] = 1 - smoothstep(FOOTING_FULL, FOOTING_NONE, (Math.atan(fall) * 180) / Math.PI)
  }
  const outline = Array.from({ length: OUTLINE_SAMPLES }, (_, s) => {
    const angle = (2 * Math.PI * s) / OUTLINE_SAMPLES
    const radius = outlineRadius(angle)
    return [radius * Math.cos(angle), radius * Math.sin(angle)] as const
  })
  const moduleSetback = new Float32Array(MODULES * MODULES)
  for (let m = 0; m < moduleSetback.length; m += 1) {
    if (!moduleBuildable[m]) {
      continue
    }
    const x = moduleCenter(moduleX(m))
    const z = moduleCenter(moduleZ(m))
    let distance = Infinity
    for (const [ox, oz] of outline) {
      distance = Math.min(distance, Math.hypot(ox - x, oz - z))
    }
    moduleSetback[m] = smoothstep(RIM_SETBACK, RIM_SETBACK_FULL, distance)
  }

  const modules = MODULES * MODULES
  const architecture: Architecture = {
    solid: new Uint8Array(LATTICE * LATTICE * LAYERS),
    birth: new Float32Array(LATTICE * LATTICE * LAYERS),
    clock: 0,
    columnGround,
    moduleTop: new Int16Array(modules).fill(-1),
    moduleBottom: new Int16Array(modules).fill(-1),
    moduleSite: new Uint8Array(modules),
    moduleSupport: new Uint8Array(modules),
    moduleCut: new Uint8Array(modules),
    moduleGround,
    moduleBuildable,
    modulePreference,
    moduleFooting,
    moduleSetback,
    sites: [],
    siteVolume: [],
    count: 0,
    top: -Infinity,
  }

  const suitability = siteSuitability(hydrology, groundHeight, insolation)
  // A site needs land to stand on: its own module and a few around it buildable.
  const standing = (index: number) => {
    const [x, z] = cellCenter(index)
    const mx = moduleOf(x)
    const mz = moduleOf(z)
    let around = 0
    for (let dz = -SEED_RADIUS; dz <= SEED_RADIUS; dz += 1) {
      for (let dx = -SEED_RADIUS; dx <= SEED_RADIUS; dx += 1) {
        const m = moduleAt(mx + dx, mz + dz)
        around += m >= 0 && moduleBuildable[m] ? 1 : 0
      }
    }
    const own = moduleAt(mx, mz)
    return own >= 0 && moduleBuildable[own] === 1 && around >= SITE_MIN_STANDING
  }
  const candidates = Array.from(suitability.keys()).filter(
    (index) => suitability[index]! >= SITE_MIN_SUITABILITY && standing(index),
  )
  while (architecture.sites.length < SITE_COUNT) {
    let index = -1
    let best = 0
    for (const candidate of candidates) {
      const [cx, cz] = cellCenter(candidate)
      const nearest = Math.min(...architecture.sites.map((site) => Math.hypot(site.x - cx, site.z - cz)))
      if (nearest < SITE_SPACING || (architecture.sites.length > 0 && nearest > SITE_GATHER)) {
        continue
      }
      const nearness = architecture.sites.length > 0 ? Math.exp(-(nearest - SITE_SPACING) / SITE_PROXIMITY) : 1
      const score = suitability[candidate]! * nearness
      if (score > best) {
        best = score
        index = candidate
      }
    }
    if (index < 0) {
      break
    }
    const [x, z] = cellCenter(index)
    // The seed block widens to its outer ring where the good ground around the site does.
    const wide = [0, 1, 2, 3].every((k) => {
      const angle = (k * Math.PI) / 2
      return suitability[cellOf(x + 0.3 * Math.cos(angle), z + 0.3 * Math.sin(angle))]! >= 0.6 * suitability[index]!
    })
    const outer = wide ? SEED_RADIUS : SEED_RADIUS - 1
    const mx = moduleOf(x)
    const mz = moduleOf(z)
    const siteX = moduleCenter(mx)
    const siteZ = moduleCenter(mz)
    architecture.sites.push({ x: siteX, z: siteZ, ground: groundHeight(siteX, siteZ) })
    architecture.siteVolume.push(0)
    const siteNumber = architecture.sites.length
    for (let dz = -outer; dz <= outer; dz += 1) {
      for (let dx = -outer; dx <= outer; dx += 1) {
        const ring = Math.max(Math.abs(dx), Math.abs(dz))
        const m = moduleAt(mx + dx, mz + dz)
        const corner = ring > 1 && Math.abs(dx) === Math.abs(dz)
        if (m < 0 || !moduleBuildable[m] || architecture.moduleTop[m]! >= 0 || corner) {
          continue
        }
        fillModule(architecture, m, -1, moduleGround[m]! + SEED_LAYERS[ring]!, siteNumber, 0)
      }
    }
  }
  return architecture
}

function setVoxel(architecture: Architecture, ix: number, iy: number, iz: number, site: number) {
  const index = voxelIndex(ix, iy, iz)
  if (!inLattice(ix, iy, iz) || architecture.solid[index]) {
    return
  }
  architecture.solid[index] = site
  architecture.birth[index] = architecture.clock
  if (iy > layerOf(architecture.columnGround[ix + iz * LATTICE]!)) {
    architecture.count += 1
    architecture.siteVolume[site - 1]! += 1
  }
  architecture.top = Math.max(architecture.top, layerTop(iy))
}

/**
 * Fills a module from layer `bottom` to `top`; a `bottom` of −1 stands it on
 * the ground, with foundations down into it. Returns voxels added above ground.
 */
function fillModule(
  architecture: Architecture,
  m: number,
  bottom: number,
  top: number,
  site: number,
  support: number,
): number {
  const before = architecture.count
  for (let cz = 0; cz < MODULE; cz += 1) {
    for (let cx = 0; cx < MODULE; cx += 1) {
      const ix = moduleX(m) * MODULE + cx
      const iz = moduleZ(m) * MODULE + cz
      const ground = architecture.columnGround[ix + iz * LATTICE]!
      const from = bottom >= 0 ? bottom : Math.max(0, layerOf(ground - FOUNDATION_DEPTH))
      for (let iy = from; iy <= top; iy += 1) {
        setVoxel(architecture, ix, iy, iz, site)
      }
    }
  }
  architecture.moduleTop[m] = top
  architecture.moduleBottom[m] = bottom
  architecture.moduleSite[m] = site
  architecture.moduleSupport[m] = support
  return architecture.count - before
}

/** Clears a grounded module down to its paving; it stays open as a courtyard. */
function cutModule(architecture: Architecture, m: number) {
  const { solid, columnGround, siteVolume } = architecture
  for (let cz = 0; cz < MODULE; cz += 1) {
    for (let cx = 0; cx < MODULE; cx += 1) {
      const ix = moduleX(m) * MODULE + cx
      const iz = moduleZ(m) * MODULE + cz
      for (let iy = Math.max(0, layerOf(columnGround[ix + iz * LATTICE]!) + 1); iy < LAYERS; iy += 1) {
        const index = voxelIndex(ix, iy, iz)
        if (solid[index]) {
          siteVolume[solid[index]! - 1]! -= 1
          solid[index] = 0
          architecture.count -= 1
        }
      }
    }
  }
  architecture.moduleTop[m] = -1
  architecture.moduleSite[m] = 0
  architecture.moduleCut[m] = 1
}

/** Clears the foot of a wall module up to `bottom`, leaving the wall above as a lintel. */
function openModule(architecture: Architecture, m: number, bottom: number) {
  const { solid, columnGround, siteVolume } = architecture
  for (let cz = 0; cz < MODULE; cz += 1) {
    for (let cx = 0; cx < MODULE; cx += 1) {
      const ix = moduleX(m) * MODULE + cx
      const iz = moduleZ(m) * MODULE + cz
      for (let iy = Math.max(0, layerOf(columnGround[ix + iz * LATTICE]!) + 1); iy < bottom; iy += 1) {
        const index = voxelIndex(ix, iy, iz)
        if (solid[index]) {
          siteVolume[solid[index]! - 1]! -= 1
          solid[index] = 0
          architecture.count -= 1
        }
      }
    }
  }
  architecture.moduleBottom[m] = bottom
  architecture.moduleSupport[m] = 1
}

export function architectureSolid(architecture: Architecture): Solid {
  return {
    top: architecture.top,
    isSolid: (x, y, z) => {
      const ix = latticeOf(x)
      const iy = layerOf(y)
      const iz = latticeOf(z)
      return inLattice(ix, iy, iz) && architecture.solid[voxelIndex(ix, iy, iz)]! > 0
    },
  }
}

type MoveKind = 'rise' | 'wall' | 'terrace' | 'cantilever' | 'span' | 'opening' | 'cut'

type Move = {
  kind: MoveKind
  modules: number[]
  /** Layer range to fill; a `bottom` of −1 stands on the ground. */
  bottom: number
  top: number
  site: number
  support: number
  weight: number
}

/** Every move open to the structure under the sun of this moment. */
function growthMoves(
  architecture: Architecture,
  sun: readonly [number, number, number],
  sunlit: (x: number, y: number, z: number) => boolean,
): Move[] {
  const {
    moduleTop,
    moduleBottom,
    moduleSite,
    moduleSupport,
    moduleCut,
    moduleGround,
    moduleBuildable,
    modulePreference,
    moduleFooting,
    moduleSetback,
    sites,
  } = architecture
  const moves: Move[] = []
  /** How readily a module takes grounded mass: its footing, set back from the rim. */
  const stable = (m: number) => moduleFooting[m]! * moduleSetback[m]!
  const largest = Math.max(1, ...architecture.siteVolume)
  const vigour = architecture.siteVolume.map(
    (volume) => VIGOUR_FLOOR + (1 - VIGOUR_FLOOR) * (volume / largest) ** 2,
  )
  const ceiling = sites.map((site) => Math.min(LAYERS - 1, layerOf(site.ground + MAX_HEIGHT)))
  const up = UP_BASE + UP_SUN * Math.max(0, sun[1])
  const facing = (dx: number, dz: number) => SIDE_BASE + SIDE_SUN * Math.max(0, dx * sun[0] + dz * sun[2])
  const broadside = (dx: number, dz: number) => SIDE_BASE + SIDE_SUN * Math.abs(dx * sun[2] - dz * sun[0])

  const lightCache = new Map<number, number>()
  const light = (m: number, layer: number) => {
    const key = m * LAYERS + layer
    let value = lightCache.get(key)
    if (value === undefined) {
      const lit = sunlit(moduleCenter(moduleX(m)), layerTop(layer) + 0.001, moduleCenter(moduleZ(m)))
      value = lit ? 1 : SHADED_GROWTH
      lightCache.set(key, value)
    }
    return value
  }
  const occupied = (m: number) => m >= 0 && moduleTop[m]! >= 0
  const around = (m: number) =>
    SIDES.map(([dx, dz]) => moduleAt(moduleX(m) + dx, moduleZ(m) + dz))
  const reach = (m: number, site: number) => {
    if (around(m).some((n) => occupied(n) && moduleSite[n] !== site)) {
      return JOIN_BONUS
    }
    const home = sites[site - 1]!
    const distance = Math.hypot(moduleCenter(moduleX(m)) - home.x, moduleCenter(moduleZ(m)) - home.z)
    return Math.exp(-((distance / SPREAD) ** 2))
  }
  const push = (move: Omit<Move, 'weight'>, weight: number) => {
    if (weight > 0) {
      moves.push({ ...move, weight })
    }
  }

  for (let c = 0; c < moduleTop.length; c += 1) {
    const top = moduleTop[c]!
    if (top < 0) {
      continue
    }
    const site = moduleSite[c]!
    const grow = vigour[site - 1]!
    const limit = ceiling[site - 1]!
    const near = around(c)
    const grounded = moduleSupport[c] === 0
    const cx = moduleX(c)
    const cz = moduleZ(c)
    const filled = near.map(occupied)
    const rowX = filled[0] && filled[1] && !filled[2] && !filled[3]
    const rowZ = filled[2] && filled[3] && !filled[0] && !filled[1]

    if (grounded && top + RISE_LAYERS <= limit) {
      const next = top + RISE_LAYERS
      const taller = near.filter((n) => occupied(n) && moduleTop[n]! >= next).length
      const form = filled.some(Boolean)
        ? (1 + (rowX || rowZ ? ROW_BONUS : 0) + FILL_BONUS * taller) * (filled.every(Boolean) ? INTERIOR : 1)
        : ISOLATED
      const height = layerTop(next) - sites[site - 1]!.ground
      const headroom = Math.max(0, 1 - (height / MAX_HEIGHT) ** 2)
      const modules = [c]
      if (rowX || rowZ) {
        for (const k of rowX ? [0, 1] : [2, 3]) {
          const n = near[k]!
          if (moduleTop[n] === top && moduleSupport[n] === 0 && moduleSite[n] === site && stable(n) > 0) {
            modules.push(n)
          }
        }
      }
      push(
        { kind: 'rise', modules, bottom: -1, top: next, site, support: 0 },
        light(c, next) * up * form * headroom * stable(c) * grow,
      )
    }

    if (
      grounded &&
      (rowX || rowZ) &&
      top - moduleGround[c]! >= OPENING_MIN_LAYERS &&
      (rowX ? [0, 1] : [2, 3]).every((k) => moduleSupport[near[k]!] === 0 && moduleTop[near[k]!]! >= top - 1)
    ) {
      push(
        { kind: 'opening', modules: [c], bottom: moduleGround[c]! + OPENING_LAYERS + 1, top, site, support: 1 },
        light(c, top) * OPENING_WEIGHT * grow,
      )
    }

    for (const [k, [dx, dz]] of SIDES.entries()) {
      const n = near[k]!
      if (n < 0 || moduleTop[n]! >= 0 || moduleCut[n]) {
        continue
      }
      const ground = moduleGround[n]!
      const extent = reach(n, site)
      const compact = 1 + COMPACT_BONUS * (around(n).filter(occupied).length - 1)
      const edge = modulePreference[n]!
      /** Open ground that can take grounded mass. */
      const free = (m: number) =>
        m >= 0 && !occupied(m) && !moduleCut[m] && moduleBuildable[m] === 1 && stable(m) > 0
      const firmest = (list: number[]) => Math.min(...list.map(stable))
      const behind = near[k ^ 1]!

      if (free(n)) {
        if (occupied(behind) && Math.abs(moduleTop[behind]! - top) <= 1) {
          const run: number[] = []
          for (let j = 1; j <= WALL_RUN; j += 1) {
            const m = moduleAt(cx + dx * j, cz + dz * j)
            if (!free(m) || top < moduleGround[m]! + MIN_LAYERS) {
              break
            }
            run.push(m)
          }
          if (run.length > 0) {
            push(
              { kind: 'wall', modules: run, bottom: -1, top, site, support: 0 },
              light(n, top) * WALL_WEIGHT * broadside(dx, dz) * compact * extent * edge * firmest(run) * grow,
            )
          }
        }

        const strip = [n]
        let stripGround = ground
        for (const side of [1, -1]) {
          for (let j = 1; j <= TERRACE_REACH; j += 1) {
            const m = moduleAt(moduleX(n) + dz * side * j, moduleZ(n) + dx * side * j)
            if (!free(m) || !occupied(moduleAt(cx + dz * side * j, cz + dx * side * j))) {
              break
            }
            strip.push(m)
            stripGround = Math.max(stripGround, moduleGround[m]!)
          }
        }
        const step = Math.max(stripGround + MIN_LAYERS, top - TERRACE_LAYERS)
        if (step <= top) {
          push(
            { kind: 'terrace', modules: strip, bottom: -1, top: step, site, support: 0 },
            light(n, step) * TERRACE_WEIGHT * facing(dx, dz) * compact * extent * edge * firmest(strip) * grow,
          )
        }
      }

      const slab = top - SLAB_LAYERS + 1
      if (slab <= ground + SLAB_CLEARANCE) {
        continue
      }
      const besideSlab = around(n).some((o) => o !== c && occupied(o) && moduleBottom[o]! >= 0)
      if (moduleSupport[c]! < MAX_CANTILEVER && (grounded || occupied(behind)) && !besideSlab) {
        push(
          { kind: 'cantilever', modules: [n], bottom: slab, top, site, support: moduleSupport[c]! + 1 },
          light(n, top) * CANTILEVER_WEIGHT * facing(dx, dz) * extent * grow,
        )
      }
      const gap = [n]
      for (let j = 2; j <= MAX_SPAN + 1; j += 1) {
        const m = moduleAt(cx + dx * j, cz + dz * j)
        if (m < 0 || moduleCut[m]) {
          break
        }
        if (occupied(m)) {
          if (moduleTop[m]! >= top) {
            const join = moduleSite[m] !== site ? JOIN_BONUS : 1
            push(
              { kind: 'span', modules: [...gap], bottom: slab, top, site, support: 1 },
              light(gap[gap.length >> 1]!, top) * SPAN_WEIGHT * join * grow,
            )
          }
          break
        }
        if (slab <= moduleGround[m]! + SLAB_CLEARANCE) {
          break
        }
        gap.push(m)
      }
    }

    if (grounded && top - moduleGround[c]! > MIN_LAYERS + RISE_LAYERS) {
      let enclosed = true
      for (let dz = -1; dz <= 1 && enclosed; dz += 1) {
        for (let dx = -1; dx <= 1 && enclosed; dx += 1) {
          const m = moduleAt(cx + dx, cz + dz)
          enclosed = m >= 0 && occupied(m) && moduleSupport[m] === 0
        }
      }
      if (enclosed) {
        push(
          { kind: 'cut', modules: [c], bottom: -1, top, site, support: 0 },
          light(c, top) * CUT_WEIGHT * grow,
        )
      }
    }
  }
  return moves
}

/**
 * Makes growth moves until `budget` voxels are spent (the last may overspend).
 * `sun` points towards the sun; `sunlit` tests whether a point sees it past
 * the terrain and the current structure. Returns the budget spent.
 */
export function growArchitecture(
  architecture: Architecture,
  budget: number,
  sun: readonly [number, number, number],
  sunlit: (x: number, y: number, z: number) => boolean,
  random: () => number,
): number {
  let spent = 0
  while (spent < budget) {
    const moves = growthMoves(architecture, sun, sunlit)
    const total = moves.reduce((sum, move) => sum + move.weight, 0)
    if (total <= 0) {
      break
    }
    let pick = random() * total
    let chosen = moves[moves.length - 1]!
    for (const move of moves) {
      pick -= move.weight
      if (pick <= 0) {
        chosen = move
        break
      }
    }
    if (chosen.kind === 'cut') {
      cutModule(architecture, chosen.modules[0]!)
      spent += CUT_COST
    } else if (chosen.kind === 'opening') {
      openModule(architecture, chosen.modules[0]!, chosen.bottom)
      spent += OPENING_COST
    } else {
      let added = 0
      for (const m of chosen.modules) {
        added += fillModule(architecture, m, chosen.bottom, chosen.top, chosen.site, chosen.support)
      }
      spent += Math.max(1, added)
    }
  }
  return spent
}

/** Simulated hours after which a voxel counts as fully aged: eight days. */
export const AGE_HOURS = 192

/** 0 just placed … 1 after AGE_HOURS of simulated time. */
function voxelAge(architecture: Architecture, index: number): number {
  return Math.min(1, (architecture.clock - architecture.birth[index]!) / AGE_HOURS)
}

/**
 * Weathering, the slow counter-process to growth: weather and time wear the
 * structure down, one module at a time, day and night. It reads form, not
 * sunlight:
 *
 *   slab    an unloaded slab (nothing cantilevers further out from it) falls
 *   wear    a grounded module loses two layers from its top, down to a plinth
 *   clear   a plinth at the edge of a mass is cleared; its ground reopens to growth
 *
 * weighted by  age (simulated time since placed) · openness (open sides) ·
 * height (standing proud of its neighbours) · poor support (overhang).
 * A module never wears below a slab it carries, and each site keeps its
 * last few modules, so masses erode from their tops, edges and overhangs and
 * stay coherent, and growth can build again where they wore away.
 */
const DECAY_YOUNG = 0.15
/** Age (0…1) from which decay starts to favour a module; the material starts to show wear here too. */
export const DECAY_AGE_FROM = 0.3
/** Per module of cantilever: slabs further from the ground weather faster. */
const DECAY_OVERHANG = 1.5
/** Per two layers standing above the tallest neighbour, capped at `DECAY_PROUD_CAP`. */
const DECAY_PROUD = 0.5
const DECAY_PROUD_CAP = 3
const DECAY_CLEAR = 0.5
/** Open sides a plinth needs before it clears. */
const DECAY_CLEAR_OPEN = 2
const SITE_KEEP = 6

type Decay = { module: number; kind: 'slab' | 'wear' | 'clear'; top: number; weight: number }

/** The form decay reads for an occupied module: its neighbours, open sides, and layer pairs standing proud. */
function decayForm(architecture: Architecture, m: number) {
  const { moduleTop } = architecture
  const occupied = (n: number) => n >= 0 && moduleTop[n]! >= 0
  const near = SIDES.map(([dx, dz]) => moduleAt(moduleX(m) + dx, moduleZ(m) + dz))
  const open = near.filter((n) => !occupied(n)).length
  const tallest = Math.max(-1, ...near.filter(occupied).map((n) => moduleTop[n]!))
  const proud = Math.min(DECAY_PROUD_CAP, Math.max(0, moduleTop[m]! - tallest) / RISE_LAYERS)
  return { near, open, proud }
}

function decayMoves(architecture: Architecture): Decay[] {
  const { moduleTop, moduleBottom, moduleSupport, moduleGround, moduleSite } = architecture
  const occupied = (m: number) => m >= 0 && moduleTop[m]! >= 0
  const siteModules = architecture.sites.map(() => 0)
  for (let m = 0; m < moduleTop.length; m += 1) {
    if (occupied(m)) {
      siteModules[moduleSite[m]! - 1]! += 1
    }
  }
  const decays: Decay[] = []
  for (let m = 0; m < moduleTop.length; m += 1) {
    const top = moduleTop[m]!
    if (top < 0) {
      continue
    }
    const { near, open, proud } = decayForm(architecture, m)
    const age = voxelAge(architecture, voxelIndex(moduleX(m) * MODULE, top, moduleZ(m) * MODULE))
    const weight =
      (DECAY_YOUNG + (1 - DECAY_YOUNG) * smoothstep(DECAY_AGE_FROM, 1, age)) *
      (0.25 + open / 4) *
      (1 + DECAY_PROUD * proud)
    const slabs = near.filter((n) => occupied(n) && moduleBottom[n]! >= 0)

    if (moduleBottom[m]! >= 0) {
      if (!slabs.some((n) => moduleSupport[n]! > moduleSupport[m]!)) {
        decays.push({ module: m, kind: 'slab', top: -1, weight: weight * (1 + DECAY_OVERHANG * moduleSupport[m]!) })
      }
      continue
    }
    const plinth = moduleGround[m]! + MIN_LAYERS
    if (top > plinth) {
      const lowered = Math.max(plinth, top - RISE_LAYERS)
      if (slabs.every((n) => moduleBottom[n]! <= lowered)) {
        decays.push({ module: m, kind: 'wear', top: lowered, weight })
      }
    } else if (open >= DECAY_CLEAR_OPEN && slabs.length === 0 && siteModules[moduleSite[m]! - 1]! > SITE_KEEP) {
      decays.push({ module: m, kind: 'clear', top: -1, weight: weight * DECAY_CLEAR })
    }
  }
  return decays
}

/** Form factor (the decay weight without age) at which a module reads as fully exposed. */
const WEATHER_FULL = 1.5
/** Layers below the ones decay takes next keep this share of their module's exposure. */
const WEATHER_BELOW = 0.5

/**
 * Per module, 0…1: how strongly decay weighs its form (openness, standing
 * proud, overhang), the same factors as `decayMoves` without age. Display
 * only; the material combines it with age so wear shows before removal.
 */
function moduleWeather(architecture: Architecture): Float32Array {
  const { moduleTop, moduleBottom, moduleSupport } = architecture
  const weather = new Float32Array(moduleTop.length)
  for (let m = 0; m < moduleTop.length; m += 1) {
    if (moduleTop[m]! < 0) {
      continue
    }
    const { open, proud } = decayForm(architecture, m)
    const overhang = moduleBottom[m]! >= 0 ? 1 + DECAY_OVERHANG * moduleSupport[m]! : 1
    const form = (0.25 + open / 4) * (1 + DECAY_PROUD * proud) * overhang
    weather[m] = Math.min(1, (form - 0.25) / (WEATHER_FULL - 0.25))
  }
  return weather
}

/** Empties layers `from`…`to` of a module; returns voxels removed above ground. */
function clearLayers(architecture: Architecture, m: number, from: number, to: number): number {
  const { solid, columnGround, siteVolume } = architecture
  let removed = 0
  for (let cz = 0; cz < MODULE; cz += 1) {
    for (let cx = 0; cx < MODULE; cx += 1) {
      const ix = moduleX(m) * MODULE + cx
      const iz = moduleZ(m) * MODULE + cz
      const ground = layerOf(columnGround[ix + iz * LATTICE]!)
      for (let iy = Math.max(0, from, ground + 1); iy <= Math.min(LAYERS - 1, to); iy += 1) {
        const index = voxelIndex(ix, iy, iz)
        if (solid[index]) {
          siteVolume[solid[index]! - 1]! -= 1
          solid[index] = 0
          removed += 1
        }
      }
    }
  }
  architecture.count -= removed
  return removed
}

/**
 * Weathers modules away until `budget` voxels are spent (the last may
 * overspend). Returns the voxels removed.
 */
export function weatherArchitecture(architecture: Architecture, budget: number, random: () => number): number {
  let removed = 0
  while (removed < budget) {
    const decays = decayMoves(architecture)
    const total = decays.reduce((sum, decay) => sum + decay.weight, 0)
    if (total <= 0) {
      break
    }
    let pick = random() * total
    let chosen = decays[decays.length - 1]!
    for (const decay of decays) {
      pick -= decay.weight
      if (pick <= 0) {
        chosen = decay
        break
      }
    }
    const m = chosen.module
    const top = architecture.moduleTop[m]!
    if (chosen.kind === 'wear') {
      removed += Math.max(1, clearLayers(architecture, m, chosen.top + 1, top))
      architecture.moduleTop[m] = chosen.top
      continue
    }
    removed += Math.max(1, clearLayers(architecture, m, chosen.kind === 'slab' ? architecture.moduleBottom[m]! : 0, top))
    architecture.moduleTop[m] = -1
    architecture.moduleBottom[m] = -1
    architecture.moduleSite[m] = 0
    architecture.moduleSupport[m] = 0
  }
  return removed
}

/** Per hydrology grid cell: 1 where architecture stands on the ground. */
export function architectureFootprint(architecture: Architecture): Uint8Array {
  const footprint = new Uint8Array(GRID_SIZE * GRID_SIZE)
  for (let index = 0; index < footprint.length; index += 1) {
    const [x, z] = cellCenter(index)
    const ix = latticeOf(x)
    const iz = latticeOf(z)
    if (ix < 0 || iz < 0 || ix >= LATTICE || iz >= LATTICE) {
      continue
    }
    const ground = architecture.columnGround[ix + iz * LATTICE]!
    if (!Number.isFinite(ground)) {
      continue
    }
    const iy = layerOf(ground) + 1
    if (inLattice(ix, iy, iz) && architecture.solid[voxelIndex(ix, iy, iz)]) {
      footprint[index] = 1
    }
  }
  return footprint
}

/** One occupied voxel column seen from above. */
export type PlanColumn = {
  /** Centre of the column. */
  x: number
  z: number
  /** Top of the structure above its ground. */
  height: number
  /** False where the column is a slab over open ground (cantilever, span, opening). */
  grounded: boolean
  /** 0 fresh … 1 fully aged, from its top voxel. */
  age: number
}

/** The structure as a plan: every occupied column, with its width `VOXEL_SIZE`. */
export function architecturePlan(architecture: Architecture): PlanColumn[] {
  const columns: PlanColumn[] = []
  for (let iz = 0; iz < LATTICE; iz += 1) {
    for (let ix = 0; ix < LATTICE; ix += 1) {
      const ground = architecture.columnGround[ix + iz * LATTICE]!
      if (!Number.isFinite(ground)) {
        continue
      }
      const base = Math.max(0, layerOf(ground) + 1)
      for (let iy = LAYERS - 1; iy >= base; iy -= 1) {
        const index = voxelIndex(ix, iy, iz)
        if (architecture.solid[index]) {
          columns.push({
            x: voxelCenter(ix),
            z: voxelCenter(iz),
            height: layerCenter(iy) + VOXEL_SIZE / 2 - ground,
            grounded: architecture.solid[voxelIndex(ix, base, iz)]! > 0,
            age: voxelAge(architecture, index),
          })
          break
        }
      }
    }
  }
  return columns
}

/** Height of free space above the ground at (x, z) before the structure; Infinity if open. */
export function clearanceAbove(architecture: Architecture, x: number, z: number, ground: number): number {
  const ix = latticeOf(x)
  const iz = latticeOf(z)
  if (ix < 0 || iz < 0 || ix >= LATTICE || iz >= LATTICE) {
    return Infinity
  }
  for (let iy = Math.max(0, layerOf(ground) + 1); iy < LAYERS; iy += 1) {
    if (architecture.solid[voxelIndex(ix, iy, iz)]) {
      return layerCenter(iy) - VOXEL_SIZE / 2 - ground
    }
  }
  return Infinity
}

const FACES: readonly { normal: [number, number, number]; corners: [number, number, number][] }[] = [
  { normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { normal: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { normal: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
]

/** Height above the ground past which `aLift` stops counting. */
const LIFT_CAP = 2

/**
 * Block mesh of the lattice: one quad per voxel face open to the air.
 * Attributes: `aBirth` (the `clock` hour the voxel was placed; the material
 * ages it against the running clock), `aLift` (height above the ground
 * beneath the voxel) and `aWeather` (its module's exposure to decay, 0…1;
 * full on the layers decay would take next: a slab, a plinth, or the top
 * two layers of a wall, less further down).
 */
export function createArchitectureGeometry(architecture: Architecture): BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const births: number[] = []
  const lifts: number[] = []
  const weathers: number[] = []
  const indices: number[] = []
  const { solid, birth, columnGround, moduleTop, moduleBottom, moduleGround } = architecture
  const moduleExposure = moduleWeather(architecture)
  for (let index = 0; index < solid.length; index += 1) {
    if (!solid[index]) {
      continue
    }
    const ix = index % LATTICE
    const iz = Math.floor(index / LATTICE) % LATTICE
    const iy = Math.floor(index / (LATTICE * LATTICE))
    const x0 = LATTICE_ORIGIN + ix * VOXEL_SIZE
    const y0 = LAYER_BASE + iy * VOXEL_SIZE
    const z0 = LATTICE_ORIGIN + iz * VOXEL_SIZE
    const ground = columnGround[ix + iz * LATTICE]!
    if (y0 + VOXEL_SIZE < ground - VOXEL_SIZE) {
      continue
    }
    const m = moduleAt(Math.floor(ix / MODULE), Math.floor(iz / MODULE))
    const top = moduleTop[m]!
    const takenNext = moduleBottom[m]! >= 0 || top <= moduleGround[m]! + MIN_LAYERS || iy > top - RISE_LAYERS
    const weather = moduleExposure[m]! * (takenNext ? 1 : WEATHER_BELOW)
    for (const { normal, corners } of FACES) {
      const nx = ix + normal[0]
      const ny = iy + normal[1]
      const nz = iz + normal[2]
      if (inLattice(nx, ny, nz) && solid[voxelIndex(nx, ny, nz)]) {
        continue
      }
      const start = positions.length / 3
      for (const [cx, cy, cz] of corners) {
        const y = y0 + cy * VOXEL_SIZE
        positions.push(x0 + cx * VOXEL_SIZE, y, z0 + cz * VOXEL_SIZE)
        normals.push(...normal)
        births.push(birth[index]!)
        lifts.push(Math.min(LIFT_CAP, Math.max(0, y - ground)))
        weathers.push(weather)
      }
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
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
