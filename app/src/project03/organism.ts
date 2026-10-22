import { sunAt } from '../project/sun.ts'
import {
  archIndex,
  architectureSolid,
  latticeX,
  latticeZ,
  ownerOf,
  solveSupport,
  SUPPORT_UNSOLVED,
  voxelCoords,
  type Architecture,
  type Site,
  type Tip,
} from '../project02/architecture.ts'
import { clamp01, LATTICE_BASE, LATTICE_X0, LATTICE_Z0, type Vec3 } from '../project02/core.ts'
import { sampleGrid } from '../project02/grid.ts'
import { sunVisible } from '../project02/light.ts'
import type { Eco } from '../project02/simulation.ts'
import type { Statics } from '../project02/statics.ts'
import { weatherLight } from '../project02/weather.ts'
import { dryLand, shoreFrame, type ShoreFrame } from './catchment.ts'

/**
 * One organism: a lip folded up off the wet bank. The root sits in the
 * ground; the crest leans inland and leaves the ground beneath it open.
 * It lengthens along the shore where the bank is moist and the crest is
 * in the sun, and only while that mass still reaches the ground.
 */

const FOLD = {
  crest: 1.32,
  endCrest: 0.62,
  lean: 0.55,
  /** New ribs start lower than the rooted crest. */
  tipCrest: 0.78,
  maxCrest: 1.6,
  reach: 3.6,
  step: 0.2,
  /** Ribs laid each way before play, so the lip can still lengthen. */
  rooted: 4,
}

const chunkIndex = (a: Architecture, i: number, k: number) =>
  Math.floor(i / a.chunk) + a.chunksAcross * Math.floor(k / a.chunk)

function touch(a: Architecture, i: number, k: number) {
  const ci = Math.floor(i / a.chunk)
  const ck = Math.floor(k / a.chunk)
  const bump = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= a.chunksAcross || z >= a.chunksAcross) return
    a.chunkVersion[x + a.chunksAcross * z]! += 1
  }
  bump(ci, ck)
  if (i % a.chunk === 0) bump(ci - 1, ck)
  if (i % a.chunk === a.chunk - 1) bump(ci + 1, ck)
  if (k % a.chunk === 0) bump(ci, ck - 1)
  if (k % a.chunk === a.chunk - 1) bump(ci, ck + 1)
  a.version += 1
}

function wipe(a: Architecture) {
  a.solid.fill(0)
  a.birth.fill(0)
  a.support.fill(255)
  a.occupied.fill(0)
  a.count = 0
  a.tips = []
  a.sites = []
  a.events = []
  a.rubble = []
  a.fragments = []
  a.collapsed = 0
  a.weathered = 0
  a.decayClock = 0
  a.seedClock = 0
  a.top = LATTICE_BASE
  a.nextTip = 1
  a.nextSite = 1
  a.version += 1
  // Empty chunks stay at 0 so the mesh does not rebuild the whole lattice.
  a.chunkVersion.fill(0)
}

function columnAt(a: Architecture, x: number, z: number): { i: number; k: number; g: number } | null {
  const i = Math.floor((x - LATTICE_X0) / a.voxel)
  const k = Math.floor((z - LATTICE_Z0) / a.voxel)
  if (i < 0 || k < 0 || i >= a.n || k >= a.n) return null
  const g = a.groundJ[i + a.n * k]!
  if (g < 0) return null
  return { i, k, g }
}

function stampCell(a: Architecture, i: number, j: number, k: number, site: number, clock: number, fresh: number[]): boolean {
  if (i < 0 || k < 0 || j < 0 || i >= a.n || k >= a.n || j >= a.ny) return false
  const g = a.groundJ[i + a.n * k]!
  if (g < 0 || j < g) return false
  const index = archIndex(a, i, j, k)
  if (a.solid[index]) return false
  a.solid[index] = ownerOf(site)
  a.birth[index] = clock
  a.support[index] = j === g ? 0 : SUPPORT_UNSOLVED
  a.count += 1
  a.occupied[chunkIndex(a, i, k)]! += 1
  a.top = Math.max(a.top, LATTICE_BASE + (j + 1) * a.voxel)
  touch(a, i, k)
  fresh.push(index)
  const owner = a.sites.find((s) => s.id === site)
  if (owner) owner.voxels += 1
  return true
}

function erase(a: Architecture, index: number) {
  if (!a.solid[index]) return
  const owner = a.solid[index]!
  a.solid[index] = 0
  a.support[index] = 255
  a.count -= 1
  const [i, , k] = voxelCoords(a, index)
  const chunk = chunkIndex(a, i, k)
  a.occupied[chunk] = Math.max(0, a.occupied[chunk]! - 1)
  touch(a, i, k)
  const site = a.sites.find((s) => ownerOf(s.id) === owner)
  if (site && site.voxels > 0) site.voxels -= 1
}

/** Removes voxels that cannot reach the ground. `fresh` is the span just added. */
function commit(a: Architecture, fresh: number[], revertSpan: boolean): boolean {
  const fallen = new Set(solveSupport(a))
  const lost = fresh.filter((index) => fallen.has(index))
  if (lost.length && revertSpan) {
    for (const index of fresh) erase(a, index)
  } else {
    for (const index of lost) erase(a, index)
  }
  for (const index of solveSupport(a)) erase(a, index)
  a.supportVersion = a.version
  return lost.length === 0
}

type Anchor = { i: number; j: number; k: number }
type RibJoin = { base: Anchor; mid?: Anchor; crest: Anchor; anchors?: Anchor[] }

/** A 6-connected run of voxels. One cell thick, so neighbouring ribs can meet as a sheet. */
function link(
  a: Architecture,
  i0: number,
  j0: number,
  k0: number,
  i1: number,
  j1: number,
  k1: number,
  site: number,
  clock: number,
  fresh: number[],
) {
  let i = i0
  let j = j0
  let k = k0
  stampCell(a, i, j, k, site, clock, fresh)
  let guard = 0
  // Step the largest remaining gap, so a diagonal stays a stair instead of an elbow.
  while ((i !== i1 || j !== j1 || k !== k1) && guard < 48) {
    guard += 1
    const di = i1 - i
    const dj = j1 - j
    const dk = k1 - k
    const ai = Math.abs(di)
    const aj = Math.abs(dj)
    const ak = Math.abs(dk)
    if (ai >= aj && ai >= ak && di !== 0) i += Math.sign(di)
    else if (ak >= aj && dk !== 0) k += Math.sign(dk)
    else j += Math.sign(dj)
    stampCell(a, i, j, k, site, clock, fresh)
  }
}

/**
 * A single leaning rib. Its base is in the ground and its toe steps toward
 * the water; the crest leans inland and turns over as a one-voxel lip.
 */
function layRib(
  a: Architecture,
  x: number,
  z: number,
  inland: [number, number],
  height: number,
  lean: number,
  site: number,
  clock: number,
  fresh: number[],
): RibJoin | null {
  const base = columnAt(a, x, z)
  if (!base) return null
  const up = Math.max(1, Math.round(height / a.voxel))
  const over = Math.max(0, Math.round(lean / a.voxel))
  const steps = Math.max(up, over, 1)
  let pi = base.i
  let pj = base.g
  let pk = base.k
  const midAt = Math.floor(steps / 2)
  let mid: Anchor = { i: base.i, j: base.g, k: base.k }
  const anchors: Anchor[] = []
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps
    const dest = columnAt(a, x + inland[0] * lean * t, z + inland[1] * lean * t)
    if (!dest) break
    const j = Math.min(a.ny - 1, base.g + Math.round(up * t))
    link(a, pi, pj, pk, dest.i, j, dest.k, site, clock, fresh)
    const at: Anchor = { i: dest.i, j, k: dest.k }
    anchors.push(at)
    if (s === midAt) mid = at
    pi = dest.i
    pj = j
    pk = dest.k
  }
  const foot: Anchor = { i: base.i, j: base.g, k: base.k }
  const crest: Anchor = { i: pi, j: pj, k: pk }
  if (!anchors.length) anchors.push(foot)
  const toe = columnAt(a, x - inland[0] * a.voxel, z - inland[1] * a.voxel)
  if (toe) link(a, foot.i, foot.j, foot.k, toe.i, toe.g, toe.k, site, clock, fresh)
  const lip = columnAt(a, latticeX(a, crest.i) + inland[0] * a.voxel, latticeZ(a, crest.k) + inland[1] * a.voxel)
  if (lip) link(a, crest.i, crest.j, crest.k, lip.i, Math.min(a.ny - 1, crest.j), lip.k, site, clock, fresh)
  return { base: foot, mid, crest, anchors }
}

/** Ribs at voxel spacing between two stations, welded into one sheet. */
function laySpan(
  a: Architecture,
  from: { x: number; z: number; inland: [number, number]; height: number; lean: number },
  to: { x: number; z: number; inland: [number, number]; height: number; lean: number },
  site: number,
  clock: number,
  fresh: number[],
  previous: RibJoin | null,
): RibJoin | null {
  const span = Math.hypot(to.x - from.x, to.z - from.z)
  const cuts = Math.max(1, Math.round(span / a.voxel))
  let prev = previous
  for (let s = previous ? 1 : 0; s <= cuts; s += 1) {
    const t = s / cuts
    const ix = from.inland[0] + (to.inland[0] - from.inland[0]) * t
    const iz = from.inland[1] + (to.inland[1] - from.inland[1]) * t
    const len = Math.hypot(ix, iz) || 1
    const rib = layRib(
      a,
      from.x + (to.x - from.x) * t,
      from.z + (to.z - from.z) * t,
      [ix / len, iz / len],
      from.height + (to.height - from.height) * t,
      from.lean + (to.lean - from.lean) * t,
      site,
      clock,
      fresh,
    )
    if (!rib) continue
    if (prev) {
      const left = prev.anchors
      const right = rib.anchors
      if (left && right && left.length > 1 && right.length > 1) {
        for (let n = 0; n < left.length; n += 1) {
          const m = Math.round((n * (right.length - 1)) / (left.length - 1))
          const p = left[n]!
          const q = right[m]!
          link(a, p.i, p.j, p.k, q.i, q.j, q.k, site, clock, fresh)
        }
      } else {
        link(a, prev.base.i, prev.base.j, prev.base.k, rib.base.i, rib.base.j, rib.base.k, site, clock, fresh)
        if (prev.mid && rib.mid) link(a, prev.mid.i, prev.mid.j, prev.mid.k, rib.mid.i, rib.mid.j, rib.mid.k, site, clock, fresh)
        link(a, prev.crest.i, prev.crest.j, prev.crest.k, rib.crest.i, rib.crest.j, rib.crest.k, site, clock, fresh)
      }
    }
    prev = rib
  }
  return prev
}

const ribHeight = (dist: number) => {
  const t = clamp01(1 - dist / 1.1)
  return FOLD.endCrest + (FOLD.crest - FOLD.endCrest) * t
}

type ShoreStep = { x: number; z: number; dx: number; dz: number; inland: [number, number] }

/** The next station along the bank: wet, lit on its crest, and still near the water. */
function shoreStep(
  eco: Eco,
  statics: Statics,
  x: number,
  z: number,
  dx: number,
  dz: number,
  height: number,
  needLight: boolean,
): ShoreStep | null {
  const len = Math.hypot(dx, dz) || 1
  const hx = dx / len
  const hz = dz / len
  let best = Infinity
  let pick: ShoreStep | null = null
  for (let deg = -60; deg <= 60; deg += 15) {
    const rad = (deg * Math.PI) / 180
    const tx = hx * Math.cos(rad) - hz * Math.sin(rad)
    const tz = hx * Math.sin(rad) + hz * Math.cos(rad)
    const px = x + tx * FOLD.step
    const pz = z + tz * FOLD.step
    const cell = statics.cellAt(px, pz)
    if (cell < 0 || !statics.inside[cell] || statics.water[cell]) continue
    if (statics.slope[cell]! > 24) continue
    const wd = statics.waterDistance[cell]!
    if (wd < 0.32 || wd > 1.15) continue
    const moisture = sampleGrid(eco.fields.moisture, px, pz)
    if (moisture < 0.5) continue
    const inland = shoreFrame(statics, px, pz).inland
    const lean = FOLD.lean * (height / FOLD.crest)
    if (needLight && !crestIsLit(eco, statics, px, pz, inland, height, lean, tx, tz)) continue
    const score = Math.abs(wd - 0.55) * 1.6 + Math.abs(deg) / 200 - moisture * 0.4
    if (score < best) {
      best = score
      pick = { x: px, z: pz, dx: tx, dz: tz, inland }
    }
  }
  return pick
}

function layFold(a: Architecture, eco: Eco, statics: Statics, frame: ShoreFrame, clock: number) {
  const fresh: number[] = []
  const ends: { x: number; z: number; dir: Vec3 }[] = []
  const root = { x: frame.x, z: frame.z, inland: frame.inland, height: FOLD.crest, lean: FOLD.lean }
  for (const sign of [1, -1]) {
    let x = frame.x
    let z = frame.z
    let dx = frame.along[0] * sign
    let dz = frame.along[1] * sign
    let from = root
    let placed = layRib(a, root.x, root.z, root.inland, root.height, root.lean, 1, clock, fresh)
    let last = { x, z, dx, dz }
    for (let n = 0; n < FOLD.rooted; n += 1) {
      const dist = Math.hypot(x - frame.x, z - frame.z) + FOLD.step
      const step = shoreStep(eco, statics, x, z, dx, dz, ribHeight(dist), false)
      if (!step) break
      const height = ribHeight(Math.hypot(step.x - frame.x, step.z - frame.z))
      const lean = FOLD.lean * (height / FOLD.crest)
      const to = { x: step.x, z: step.z, inland: step.inland, height, lean }
      placed = laySpan(a, from, to, 1, clock, fresh, placed)
      from = to
      x = step.x
      z = step.z
      dx = step.dx
      dz = step.dz
      last = { x, z, dx, dz }
    }
    ends.push({ x: last.x, z: last.z, dir: [last.dx, 0, last.dz] })
  }
  return { fresh, ends }
}

function makeTip(a: Architecture, x: number, z: number, dir: Vec3, clock: number): Tip {
  const col = columnAt(a, x, z)
  return {
    id: a.nextTip++,
    site: 1,
    role: 'spread',
    i: col?.i ?? 0,
    j: col?.g ?? 0,
    k: col?.k ?? 0,
    dir,
    move: dir,
    remaining: 0,
    energy: 0,
    light: 1,
    cantilever: 0,
    born: clock,
    members: 0,
    candidates: [],
    fusing: false,
  }
}

/** Clears the seeded 0.2 sites and roots the fold on the wet bank. */
export function placeOrganism(eco: Eco, statics: Statics) {
  const a = eco.arch
  wipe(a)
  const frame = shoreFrame(statics)
  const spot = dryLand(statics, frame.x, frame.z, frame.inland)
  const site: Site = {
    id: 1,
    x: spot.x,
    z: spot.z,
    born: eco.clock,
    voxels: 0,
    collapsed: 0,
    struck: -Infinity,
    kind: 'water',
  }
  a.sites = [site]
  a.nextSite = 2
  const rooted = shoreFrame(statics, spot.x, spot.z)
  const laid = layFold(a, eco, statics, rooted, eco.clock)
  commit(a, laid.fresh, false)
  a.tips = laid.ends.map((end) => makeTip(a, end.x, end.z, end.dir, eco.clock))
}

/** The crest near a tip: the highest solid voxel within the lean, inland of the root. */
function nearbyCrest(a: Architecture, tip: Tip, inland: [number, number]): Anchor | null {
  const di = Math.abs(inland[0]) >= Math.abs(inland[1]) ? Math.sign(inland[0]) : 0
  const dk = Math.abs(inland[1]) > Math.abs(inland[0]) ? Math.sign(inland[1]) : 0
  const reach = Math.ceil(FOLD.lean / a.voxel) + 1
  let best: Anchor | null = null
  for (let along = -2; along <= 2; along += 1) {
    for (let step = 0; step <= reach; step += 1) {
      const i = tip.i + di * step - dk * along
      const k = tip.k + dk * step + di * along
      if (i < 0 || k < 0 || i >= a.n || k >= a.n) continue
      const g = a.groundJ[i + a.n * k]!
      if (g < 0) continue
      for (let j = a.ny - 1; j >= g; j -= 1) {
        if (!a.solid[archIndex(a, i, j, k)]) continue
        if (!best || j > best.j) best = { i, j, k }
        break
      }
    }
  }
  return best
}

/** Highest voxel in the column, or the ground cell when the column is still empty. */
function crestAnchor(a: Architecture, x: number, z: number): Anchor | null {
  const col = columnAt(a, x, z)
  if (!col) return null
  for (let j = a.ny - 1; j >= col.g; j -= 1) {
    if (a.solid[archIndex(a, col.i, j, col.k)]) return { i: col.i, j, k: col.k }
  }
  return { i: col.i, j: col.g, k: col.k }
}

function crestIsLit(
  eco: Eco,
  statics: Statics,
  x: number,
  z: number,
  inland: [number, number],
  height: number,
  lean: number,
  aheadX = 0,
  aheadZ = 0,
) {
  const sun = sunAt(eco.hour, eco.noon)
  const px = x + inland[0] * lean + aheadX * 0.15
  const pz = z + inland[1] * lean + aheadZ * 0.15
  const y = Math.max(statics.groundAt(x, z), statics.groundAt(px, pz)) + height + 0.08
  return sunVisible(px, y, pz, sun.direction, statics.ground, architectureSolid(eco.arch))
}

function extendTip(eco: Eco, statics: Statics, tip: Tip): boolean {
  const a = eco.arch
  const site = a.sites[0]
  if (!site) return false
  const x0 = latticeX(a, tip.i)
  const z0 = latticeZ(a, tip.k)
  if (Math.hypot(x0 - site.x, z0 - site.z) >= FOLD.reach) return false
  const step = shoreStep(eco, statics, x0, z0, tip.dir[0], tip.dir[2], FOLD.tipCrest, true)
  if (!step || Math.hypot(step.x - site.x, step.z - site.z) > FOLD.reach) return false
  if (Math.abs(statics.groundAt(step.x, step.z) - statics.groundAt(site.x, site.z)) > 1.1) return false
  const lean = FOLD.lean * (FOLD.tipCrest / FOLD.crest)
  const fresh: number[] = []
  const base = crestAnchor(a, x0, z0)
  const crest = nearbyCrest(a, tip, step.inland) ?? base
  const from = { x: x0, z: z0, inland: step.inland, height: FOLD.tipCrest, lean }
  const to = { x: step.x, z: step.z, inland: step.inland, height: FOLD.tipCrest, lean }
  laySpan(a, from, to, site.id, eco.clock, fresh, base && crest ? { base, crest } : null)
  if (fresh.length < 4) {
    for (const index of fresh) erase(a, index)
    return false
  }
  if (!commit(a, fresh, true)) return false
  const dest = columnAt(a, step.x, step.z)
  if (dest) {
    tip.i = dest.i
    tip.j = dest.g
    tip.k = dest.k
  }
  tip.dir = [step.dx, 0, step.dz]
  tip.move = tip.dir
  tip.members += 1
  tip.light = 1
  if (tip.members % 4 === 0) liftCrest(eco, statics, tip, step.inland)
  return true
}

/** Adds one course on a lit crest, and gives it back if the mass cannot carry it. */
function liftCrest(eco: Eco, statics: Statics, tip: Tip, inland: [number, number]) {
  const a = eco.arch
  const site = a.sites[0]
  if (!site) return
  let best = -1
  let bestJ = -1
  const di = Math.abs(inland[0]) >= Math.abs(inland[1]) ? Math.sign(inland[0]) : 0
  const dk = Math.abs(inland[1]) > Math.abs(inland[0]) ? Math.sign(inland[1]) : 0
  for (let dk0 = -2; dk0 <= 6; dk0 += 1) {
    for (let di0 = -2; di0 <= 6; di0 += 1) {
      const i = tip.i + di * di0 - dk * dk0
      const k = tip.k + dk * di0 + di * dk0
      if (i < 0 || k < 0 || i >= a.n || k >= a.n) continue
      const g = a.groundJ[i + a.n * k]!
      if (g < 0) continue
      for (let j = a.ny - 1; j >= g; j -= 1) {
        if (!a.solid[archIndex(a, i, j, k)]) continue
        if (j > bestJ) {
          bestJ = j
          best = archIndex(a, i, j, k)
        }
        break
      }
    }
  }
  if (best < 0) return
  const [i, j, k] = voxelCoords(a, best)
  const g = a.groundJ[i + a.n * k]!
  if ((j + 1 - g) * a.voxel > FOLD.maxCrest) return
  const x = latticeX(a, i) + inland[0] * a.voxel
  const z = latticeZ(a, k) + inland[1] * a.voxel
  const y = LATTICE_BASE + (j + 2) * a.voxel
  if (!sunVisible(x, y, z, sunAt(eco.hour, eco.noon).direction, statics.ground, architectureSolid(a))) return
  const fresh: number[] = []
  let previous: Anchor | null = null
  for (let along = -2; along <= 2; along += 1) {
    const ii = i - dk * along
    const kk = k + di * along
    if (ii < 0 || kk < 0 || ii >= a.n || kk >= a.n) continue
    const gg = a.groundJ[ii + a.n * kk]!
    if (gg < 0 || !a.solid[archIndex(a, ii, j, kk)]) continue
    const px = latticeX(a, ii) + inland[0] * a.voxel
    const pz = latticeZ(a, kk) + inland[1] * a.voxel
    const dest = columnAt(a, px, pz)
    if (!dest) continue
    const raised: Anchor = { i: dest.i, j: j + 1, k: dest.k }
    if (previous) link(a, previous.i, previous.j, previous.k, raised.i, raised.j, raised.k, site.id, eco.clock, fresh)
    else stampCell(a, raised.i, raised.j, raised.k, site.id, eco.clock, fresh)
    link(a, ii, j, kk, raised.i, raised.j, raised.k, site.id, eco.clock, fresh)
    previous = raised
  }
  if (fresh.length) commit(a, fresh, true)
}

/**
 * Feeds every tip from the root's moisture and the daylight, then spends
 * that energy on another rib. A dry root or a dark crest simply waits.
 */
export function growOrganism(eco: Eco, statics: Statics, hours: number, growthSpeed = 1) {
  const a = eco.arch
  const site = a.sites[0]
  if (!site || hours <= 0 || growthSpeed <= 0) return
  const wet = clamp01(sampleGrid(eco.fields.moisture, site.x, site.z))
  const sun = sunAt(eco.hour, eco.noon)
  const sky = clamp01(sun.daylight * weatherLight(eco.weather))
  const rate = 1.15 * growthSpeed * (0.05 + 0.95 * wet) * (0.15 + 0.85 * sky)
  const gain = hours * rate
  const tips = a.tips.filter((tip) => {
    const col = tip.i + a.n * tip.k
    const g = a.groundJ[col]
    return g !== undefined && g >= 0
  })
  a.tips = tips
  for (const tip of tips) {
    tip.energy = Math.min(1.25, tip.energy + gain)
    if (tip.energy < 1) continue
    if (extendTip(eco, statics, tip)) tip.energy -= 1
    else tip.energy = 0.35
  }
}
