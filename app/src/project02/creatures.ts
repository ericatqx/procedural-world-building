import { cellCenter, cellIndex, CELL, GRID_EXTENT, GRID_SIZE, MinHeap, NEIGHBOURS, sampleGrid, smoothTrace } from './grid.ts'
import { solidAt, type Architecture } from './architecture.ts'
import { clamp01, lensFactor, random, smoothstep, type Lens, type Rng } from './core.ts'
import { splat, type Fields } from './fields.ts'
import type { Statics } from './statics.ts'
import type { Vegetation } from './vegetation.ts'
import { visibility, type Weather } from './weather.ts'

/**
 * Parked for the terrain and water pass. The niches, routes and embody
 * controls stay in the code; nothing draws them or offers them while this
 * is false.
 */
export const CREATURES_ENABLED = false

/**
 * Shadow Ecology 0.2 — creatures in three niches, and the paths their
 * movement makes. Walkers keep to dry ground, rubble and the low ledges of
 * the architecture; waders keep to the wet margins and the shallows;
 * flyers keep to the air, the ridges and the tops of structures. Ground
 * creatures (walkers and waders) run the chain
 *
 *   habitat / perception → destination → terrain-aware movement
 *     → repeated movement → worn path → easier future movement
 *
 * They read shelter, moisture and water, the ground's traversability and
 * disturbance within a sight radius the weather shortens, pick a
 * destination by need (water, rest in shelter, forage), route over the grid
 * by least cost — worn ground is cheaper, so routes converge onto paths —
 * and steer along it with heading inertia (Week 06), wearing the ground as
 * they go. Paths no longer walked fade into an abandoned trace.
 *
 * Flyers read altitude, open sky and perches: architecture tops, tall
 * exposure plants and ridges. They hop between perches or soar over open
 * high ground, stay low in fog and sit out rain.
 */

export type GroundReason = 'water' | 'shelter' | 'forage' | 'wander'
/** Walkers keep to dry ground and low ledges; waders to the wet margins and shallows. */
export type GroundNiche = 'walker' | 'wader'

export type GroundCreature = {
  id: number
  niche: GroundNiche
  x: number
  z: number
  y: number
  heading: number
  thirst: number
  fatigue: number
  hunger: number
  state: 'deciding' | 'travelling' | 'resting'
  reason: GroundReason
  /** Hours left in the current rest. */
  rest: number
  goalX: number
  goalZ: number
  /** Smoothed route as x, z pairs, and the index steered toward. */
  route: number[]
  routeAt: number
  /** Recent positions (x, z) for drawing the trail. */
  trail: number[]
  trailClock: number
}

export type Perch = { x: number; y: number; z: number; score: number; kind: 'architecture' | 'plant' | 'ridge' }

export type Flyer = {
  id: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  state: 'perched' | 'flying' | 'soaring'
  /** Hours left perched or soaring. */
  timer: number
  targetX: number
  targetY: number
  targetZ: number
  circleX: number
  circleZ: number
  circleAngle: number
  trail: number[]
  trailClock: number
}

export type Creatures = {
  ground: GroundCreature[]
  flyers: Flyer[]
  perches: Perch[]
  perchClock: number
  nextId: number
}

export const CREATURE_COUNTS = { walkers: 14, waders: 6, flyers: 10 } as const

const GROUND = {
  speed: 1.3,
  sight: 4.2,
  turn: 7,
  /** How much a fully worn cell cuts the cost of crossing it. */
  wearDiscount: 0.6,
  wearDeposit: 0.2,
  samples: 30,
  trail: 50,
  /** Architecture this low (world units) is a ledge a walker climbs onto. */
  ledge: 0.45,
} as const

const WADER = {
  speed: 0.8,
  sight: 3.2,
  /** Water shallower than this (world units) can be waded. */
  depth: 0.32,
  /** Distance from water (landform units) where dry ground starts to cost a wader. */
  margin: [0.08, 0.45],
} as const

const FLYER = { speed: 3.4, cruise: 1.0, turn: 3.5, trail: 60, circle: 1.6, soar: 1.5 } as const

const TRAIL_EVERY = 0.04

export function createCreatures(statics: Statics, rng: Rng): Creatures {
  const ground: GroundCreature[] = []
  const flyers: Flyer[] = []
  let id = 1
  const spawn = (wet: boolean) => {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const index = Math.floor(random(rng) * GRID_SIZE * GRID_SIZE)
      if (!statics.inside[index] || statics.water[index] || statics.rim[index]! > 0.85 || statics.slope[index]! > 25) continue
      if (wet !== statics.base.hydrology.waterDistance[index]! < 0.2) continue
      return cellCenter(index)
    }
    return [0, 0] as [number, number]
  }
  const niches: GroundNiche[] = [...Array<GroundNiche>(CREATURE_COUNTS.walkers).fill('walker'), ...Array<GroundNiche>(CREATURE_COUNTS.waders).fill('wader')]
  for (const niche of niches) {
    const [x, z] = spawn(niche === 'wader')
    ground.push({
      id: id++,
      niche,
      x,
      z,
      y: statics.groundAt(x, z),
      heading: random(rng) * Math.PI * 2,
      thirst: random(rng) * 0.6,
      fatigue: random(rng) * 0.6,
      hunger: random(rng) * 0.6,
      state: 'deciding',
      reason: 'wander',
      rest: 0,
      goalX: x,
      goalZ: z,
      route: [],
      routeAt: 0,
      trail: [],
      trailClock: 0,
    })
  }
  for (let n = 0; n < CREATURE_COUNTS.flyers; n += 1) {
    const [x, z] = spawn(false)
    const y = statics.groundAt(x, z) + FLYER.soar + random(rng) * 0.6
    flyers.push({
      id: id++,
      x,
      y,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      state: 'soaring',
      timer: 1 + random(rng) * 2,
      targetX: x,
      targetY: y,
      targetZ: z,
      circleX: x,
      circleZ: z,
      circleAngle: random(rng) * Math.PI * 2,
      trail: [],
      trailClock: 0,
    })
  }
  return { ground, flyers, perches: [], perchClock: Infinity, nextId: id }
}

/** Water depth over a cell, world units (0 on dry ground). */
export function waterDepth(statics: Statics, fields: Fields, index: number): number {
  if (!statics.water[index]) return 0
  return Math.max(0, statics.waterLevel[index]! + fields.waterOffset - statics.ground.heights[index]!)
}

/** Whether a walker stands on a ledge of architecture here (low enough to climb). */
const onLedge = (fields: Fields, index: number) => fields.footprint[index] === 1 && fields.archHeight[index]! <= GROUND.ledge

/**
 * Cost of stepping onto a cell for a ground creature of a niche; Infinity
 * where it cannot go. Walkers climb onto low architecture and cross rubble
 * but not lakes; waders wade the shallows and pay to leave the wet margins.
 */
export function stepCost(statics: Statics, fields: Fields, index: number, niche: GroundNiche = 'walker'): number {
  if (!statics.inside[index] || statics.rim[index]! > 0.95) return Infinity
  const slope = smoothstep(14, 38, statics.slope[index]!)
  const rubble = Math.min(1, fields.rubble[index]! / 0.08)
  const worn = Math.min(1, fields.wear[index]! * 1.5)
  const disturbed = 3 * fields.disturbance[index]!
  if (niche === 'wader') {
    if (fields.footprint[index]) return Infinity
    if (statics.water[index]) return waterDepth(statics, fields, index) < WADER.depth ? 1 + disturbed : Infinity
    const dry = smoothstep(WADER.margin[0], WADER.margin[1], statics.base.hydrology.waterDistance[index]!)
    return (1 + 2.6 * slope + disturbed + 2 * rubble + 5 * dry) * (1 - GROUND.wearDiscount * worn)
  }
  if (fields.footprint[index]) return onLedge(fields, index) ? 2.2 + 2 * fields.archHeight[index]! : Infinity
  if (statics.water[index]) {
    return statics.base.hydrology.lakeId[index]! >= 0 ? Infinity : 7
  }
  const mud = fields.wetness[index]! * (1 - worn) * 0.6
  return (1 + 2.6 * slope + disturbed + 1.2 * rubble + mud) * (1 - GROUND.wearDiscount * worn)
}

/** Height a ground creature stands at: on the ground, or on a ledge it climbed. */
function standingHeight(statics: Statics, fields: Fields, x: number, z: number, niche: GroundNiche) {
  const ground = statics.groundAt(x, z)
  const index = statics.cellAt(x, z)
  if (niche === 'walker' && index >= 0 && onLedge(fields, index)) return ground + fields.archHeight[index]!
  return ground
}

/** Least-cost route over the grid (A*), smoothed, as x, z pairs; null if unreachable. */
export function planRoute(
  statics: Statics,
  fields: Fields,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  niche: GroundNiche = 'walker',
): number[] | null {
  const start = statics.cellAt(fromX, fromZ)
  const goal = statics.cellAt(toX, toZ)
  if (start < 0 || goal < 0) return null
  const count = GRID_SIZE * GRID_SIZE
  const g = new Float32Array(count).fill(Infinity)
  const came = new Int32Array(count).fill(-1)
  const closed = new Uint8Array(count)
  const heap = new MinHeap()
  const gi = goal % GRID_SIZE
  const gj = Math.floor(goal / GRID_SIZE)
  const floor = 1 - GROUND.wearDiscount
  const h = (index: number) => {
    const i = index % GRID_SIZE
    const j = (index - i) / GRID_SIZE
    return Math.hypot(i - gi, j - gj) * floor
  }
  g[start] = 0
  heap.push(start, h(start))
  let expanded = 0
  while (heap.size) {
    const current = heap.pop()!
    if (current === goal) break
    if (closed[current]) continue
    closed[current] = 1
    expanded += 1
    if (expanded > 9000) return null
    const i = current % GRID_SIZE
    const j = (current - i) / GRID_SIZE
    for (const [di, dj, step] of NEIGHBOURS) {
      const ni = i + di
      const nj = j + dj
      if (ni < 0 || nj < 0 || ni >= GRID_SIZE || nj >= GRID_SIZE) continue
      const next = cellIndex(ni, nj)
      if (closed[next]) continue
      const cost = stepCost(statics, fields, next, niche)
      if (!Number.isFinite(cost)) continue
      const total = g[current]! + step * cost
      if (total < g[next]!) {
        g[next] = total
        came[next] = current
        heap.push(next, total + h(next))
      }
    }
  }
  if (came[goal] < 0 && goal !== start) return null
  const cells: number[] = []
  for (let c = goal; c >= 0; c = came[c]!) {
    cells.push(c)
    if (c === start) break
  }
  cells.reverse()
  const points = cells.map((c) => {
    const [x, z] = cellCenter(c)
    return { x, z, value: 0 }
  })
  points[0] = { x: fromX, z: fromZ, value: 0 }
  points[points.length - 1] = { x: toX, z: toZ, value: 0 }
  const smooth = smoothTrace(points, 2)
  return smooth.flatMap((p) => [p.x, p.z])
}

type Need = { reason: GroundReason; x: number; z: number; score: number }

/** What a ground creature perceives within sight, and where it chooses to go. */
function chooseDestination(
  c: GroundCreature,
  statics: Statics,
  fields: Fields,
  veg: Vegetation,
  weather: Weather,
  rng: Rng,
): Need {
  const wader = c.niche === 'wader'
  const sight = (wader ? WADER.sight : GROUND.sight) * (0.4 + 0.6 * visibility(weather))
  let best: Need = { reason: 'wander', x: c.x, z: c.z, score: -Infinity }
  const shelterDrive = clamp01(c.fatigue + weather.rain * 0.8)
  for (let n = 0; n < GROUND.samples; n += 1) {
    const a = random(rng) * Math.PI * 2
    const r = sight * Math.sqrt(0.05 + 0.95 * random(rng))
    const x = c.x + Math.cos(a) * r
    const z = c.z + Math.sin(a) * r
    const index = statics.cellAt(x, z)
    if (index < 0 || !Number.isFinite(stepCost(statics, fields, index, c.niche))) continue
    if (statics.water[index] && !wader) continue
    const water = Math.exp(-statics.base.hydrology.waterDistance[index]! / 0.12)
    const shelter = fields.habitat[index]!
    const forage = wader
      ? (statics.water[index] ? 0.8 : water) * 0.7 + fields.moisture[index]! * 0.3
      : sampleGrid(veg.shelterSuit, x, z) * 0.6 + fields.moisture[index]! * 0.4
    const disturbance = fields.disturbance[index]!
    const distance = r / sight
    const options: [GroundReason, number][] = [
      ['water', c.thirst * water * 1.6],
      ['shelter', shelterDrive * shelter * (wader ? 0.8 : 1.5)],
      ['forage', c.hunger * forage * (wader ? 1.6 : 1.2)],
      ['wander', 0.12 * random(rng)],
    ]
    for (const [reason, value] of options) {
      const score = value - 0.25 * distance - 1.5 * disturbance - weather.rain * (1 - fields.shelter[index]!) * 0.4
      if (score > best.score) best = { reason, x, z, score }
    }
  }
  return best
}

const pushTrail = (trail: number[], max: number, ...values: number[]) => {
  trail.push(...values)
  if (trail.length > max * values.length) trail.splice(0, values.length)
}

export type CreatureContext = {
  statics: Statics
  fields: Fields
  veg: Vegetation
  arch: Architecture
  weather: Weather
  lens: Lens | null
  rng: Rng
  daylight: number
  /** Creature under keyboard control: the simulation leaves it alone. */
  controlled: number
}

/** One ground creature over `hours`; `plans` is the A* budget left this frame. */
function stepGround(c: GroundCreature, ctx: CreatureContext, hours: number, plans: { left: number }) {
  const { statics, fields, weather } = ctx
  const local = hours * lensFactor(ctx.lens, c.x, c.z)
  const index = statics.cellAt(c.x, c.z)
  const speed = c.niche === 'wader' ? WADER.speed : GROUND.speed
  const shelterHere = index >= 0 ? fields.shelter[index]! : 0
  c.thirst = clamp01(c.thirst + local * (0.045 + 0.09 * weather.drought + 0.03 * (1 - shelterHere) * ctx.daylight))
  c.hunger = clamp01(c.hunger + local * 0.035)
  c.fatigue = clamp01(c.fatigue + local * (0.03 + 0.03 * ctx.daylight))

  if (c.state === 'resting') {
    c.rest -= local
    if (c.reason === 'water') c.thirst = Math.max(0, c.thirst - local * 1.2)
    if (c.reason === 'shelter') c.fatigue = Math.max(0, c.fatigue - local * 0.3)
    if (c.reason === 'forage') c.hunger = Math.max(0, c.hunger - local * 0.6)
    const disturbed = index >= 0 && fields.disturbance[index]! > 0.3
    if (c.rest <= 0 || disturbed) c.state = 'deciding'
    return
  }

  if (c.state === 'deciding') {
    const caged = index >= 0 && !Number.isFinite(stepCost(statics, fields, index, c.niche))
    const exit = caged ? nearestOpen(statics, fields, index, c.niche) : -1
    if (exit >= 0) {
      const [x, z] = cellCenter(exit)
      c.route = [c.x, c.z, x, z]
      c.routeAt = 1
      c.goalX = x
      c.goalZ = z
      c.reason = 'wander'
      c.state = 'travelling'
      return
    }
    if (plans.left <= 0) return
    plans.left -= 1
    const need = chooseDestination(c, statics, fields, ctx.veg, weather, ctx.rng)
    const route = planRoute(statics, fields, c.x, c.z, need.x, need.z, c.niche)
    if (!route || route.length < 4) {
      c.state = 'resting'
      c.reason = 'wander'
      c.rest = 0.3
      return
    }
    c.route = route
    c.routeAt = 1
    c.goalX = need.x
    c.goalZ = need.z
    c.reason = need.reason
    c.state = 'travelling'
    return
  }

  // Travelling: steer toward a point a little ahead on the route.
  let tx = c.route[c.routeAt * 2]!
  let tz = c.route[c.routeAt * 2 + 1]!
  while (Math.hypot(tx - c.x, tz - c.z) < 0.14 && c.routeAt < c.route.length / 2 - 1) {
    c.routeAt += 1
    tx = c.route[c.routeAt * 2]!
    tz = c.route[c.routeAt * 2 + 1]!
  }
  if (Math.hypot(c.goalX - c.x, c.goalZ - c.z) < 0.08 || (c.routeAt >= c.route.length / 2 - 1 && Math.hypot(tx - c.x, tz - c.z) < 0.07)) {
    c.state = 'resting'
    c.rest = c.reason === 'shelter' ? 2 + 3 * c.fatigue : c.reason === 'wander' ? 0.4 : 1
    return
  }
  const desired = Math.atan2(tz - c.z, tx - c.x)
  let turn = desired - c.heading
  turn = Math.atan2(Math.sin(turn), Math.cos(turn))
  const maxTurn = GROUND.turn * local
  c.heading += Math.max(-maxTurn, Math.min(maxTurn, turn)) + (random(ctx.rng) - 0.5) * 0.6 * local
  const cost = index >= 0 ? stepCost(statics, fields, index, c.niche) : 1
  const step = (speed / Math.max(0.5, Number.isFinite(cost) ? cost : 3)) * (1 + 0.25 * weather.rain) * local
  if (move(c, ctx, Math.cos(c.heading) * step, Math.sin(c.heading) * step, local)) return
  // Inertia carried it at a wall: turn straight onto the route instead.
  c.heading = desired
  if (!move(c, ctx, Math.cos(desired) * step, Math.sin(desired) * step, local)) c.state = 'deciding'
}

/** Nearest cell a ground creature may stand on, searching outward from `index`; −1 if none near. */
function nearestOpen(statics: Statics, fields: Fields, index: number, niche: GroundNiche): number {
  const i = index % GRID_SIZE
  const j = (index - i) / GRID_SIZE
  for (let r = 1; r <= 10; r += 1) {
    for (let dj = -r; dj <= r; dj += 1) {
      for (let di = -r; di <= r; di += 1) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue
        const ni = i + di
        const nj = j + dj
        if (ni < 0 || nj < 0 || ni >= GRID_SIZE || nj >= GRID_SIZE) continue
        const next = cellIndex(ni, nj)
        if (Number.isFinite(stepCost(statics, fields, next, niche)) && !statics.water[next]) return next
      }
    }
  }
  return -1
}

/** Whether a ground creature at (x, z) may step to (nx, nz). */
function canStep(statics: Statics, fields: Fields, x: number, z: number, nx: number, nz: number, niche: GroundNiche) {
  const index = statics.cellAt(nx, nz)
  if (index < 0) return false
  const here = statics.cellAt(x, z)
  // Ground that became impassable around a creature is walked out of, not a cage.
  if (here >= 0 && here !== index && !Number.isFinite(stepCost(statics, fields, here, niche)) && fields.footprint[index] === fields.footprint[here]) return true
  return Number.isFinite(stepCost(statics, fields, index, niche))
}

/** Moves a ground creature if the ground ahead allows, sliding along a wall if only one axis is open; wears the ground. */
function move(c: GroundCreature, ctx: CreatureContext, dx: number, dz: number, hours: number): boolean {
  const { statics, fields } = ctx
  let nx = c.x + dx
  let nz = c.z + dz
  if (!canStep(statics, fields, c.x, c.z, nx, nz, c.niche)) {
    if (canStep(statics, fields, c.x, c.z, nx, c.z, c.niche)) nz = c.z
    else if (canStep(statics, fields, c.x, c.z, c.x, nz, c.niche)) nx = c.x
    else return false
  }
  c.x = nx
  c.z = nz
  c.y = standingHeight(statics, fields, nx, nz, c.niche)
  const distance = Math.hypot(dx, dz)
  splat(fields.wear, nx, nz, 0.08, GROUND.wearDeposit * distance * 10, 2)
  c.trailClock += hours
  if (c.trailClock >= TRAIL_EVERY) {
    c.trailClock = 0
    pushTrail(c.trail, GROUND.trail, c.x, c.z)
  }
  return true
}

/** Perches a flyer can read: architecture tops, tall exposure plants, ridges. */
export function findPerches(statics: Statics, fields: Fields, veg: Vegetation): Perch[] {
  const perches: Perch[] = []
  const top = statics.ground.top
  for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 3) {
    if (!statics.inside[index]) continue
    const [x, z] = cellCenter(index)
    const ground = statics.groundAt(x, z)
    const altitude = smoothstep(-0.8, top + 1.2, ground + fields.archHeight[index]!)
    if (fields.archHeight[index]! > 0.25) {
      perches.push({ x, y: ground + fields.archHeight[index]!, z, score: 0.35 + 0.45 * altitude + 0.2 * fields.insolation[index]!, kind: 'architecture' })
    } else if (statics.slope[index]! < 30 && (statics.edge[index]! > 0.6 || statics.ridge[index]! > 0.6 || ground > top - 0.5)) {
      perches.push({ x, y: ground, z, score: 0.15 + 0.4 * altitude + 0.15 * Math.max(statics.edge[index]!, statics.ridge[index]!), kind: 'ridge' })
    }
  }
  for (const p of veg.plants) {
    if (p.died >= 0 || p.kind !== 'exposure' || p.growth < 0.65 || p.scale < 0.85) continue
    perches.push({ x: p.x, y: p.y + 0.32 * p.scale * p.growth, z: p.z, score: 0.25 + 0.3 * p.growth, kind: 'plant' })
  }
  perches.sort((a, b) => b.score - a.score)
  // The best few per neighbourhood, so perches spread over the island.
  const kept: Perch[] = []
  for (const p of perches) {
    if (kept.filter((k) => Math.hypot(k.x - p.x, k.z - p.z) < 0.9).length >= 2) continue
    kept.push(p)
    if (kept.length >= 70) break
  }
  return kept
}

function choosePerch(f: Flyer, ctx: CreatureContext, perches: Perch[], others: Flyer[]): Perch | null {
  let best: Perch | null = null
  let bestScore = -Infinity
  const rain = ctx.weather.rain
  for (const p of perches) {
    const d = Math.hypot(p.x - f.x, p.z - f.z)
    if (d < 0.6) continue
    const crowd = others.some((o) => o !== f && Math.hypot(o.targetX - p.x, o.targetZ - p.z) < 0.3) ? 0.4 : 0
    const cell = ctx.statics.cellAt(p.x, p.z)
    const cover = cell >= 0 ? ctx.fields.shelter[cell]! : 0
    const score = p.score - 0.05 * d - crowd + rain * cover * 0.5 + 0.3 * random(ctx.rng)
    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }
  return best
}

function stepFlyer(f: Flyer, ctx: CreatureContext, hours: number, perches: Perch[], flyers: Flyer[]) {
  const { statics, weather } = ctx
  const local = hours * lensFactor(ctx.lens, f.x, f.z)
  if (local <= 0) return
  const fog = weather.fog
  if (f.state === 'perched') {
    f.timer -= local * (1 - 0.7 * weather.rain)
    if (f.timer <= 0) {
      const soar = weather.rain < 0.3 && fog < 0.5 && ctx.daylight > 0.2 && random(ctx.rng) < 0.6
      if (soar) {
        f.state = 'soaring'
        f.timer = 1.5 + random(ctx.rng) * 2.5
        f.circleX = f.x + (random(ctx.rng) - 0.5) * 4
        f.circleZ = f.z + (random(ctx.rng) - 0.5) * 4
        const angle = Math.atan2(f.circleZ, f.circleX)
        const limit = statics.outline(angle) * 0.85
        const r = Math.hypot(f.circleX, f.circleZ)
        if (r > limit) {
          f.circleX *= limit / r
          f.circleZ *= limit / r
        }
      } else {
        const perch = choosePerch(f, ctx, perches, flyers)
        if (perch) {
          f.state = 'flying'
          f.targetX = perch.x
          f.targetY = perch.y
          f.targetZ = perch.z
        } else {
          f.timer = 1
        }
      }
    }
    return
  }

  let tx: number
  let ty: number
  let tz: number
  const groundBelow = statics.groundAt(f.x, f.z)
  const cruise = FLYER.cruise * (1 - 0.6 * fog)
  if (f.state === 'soaring') {
    f.timer -= local
    f.circleAngle += local * 2.1
    tx = f.circleX + Math.cos(f.circleAngle) * FLYER.circle
    tz = f.circleZ + Math.sin(f.circleAngle) * FLYER.circle
    ty = Math.max(statics.groundAt(tx, tz), statics.groundAt(f.circleX, f.circleZ)) + FLYER.soar * (0.6 + 0.4 * (1 - fog))
    if (f.timer <= 0) {
      const perch = choosePerch(f, ctx, perches, flyers)
      if (perch) {
        f.state = 'flying'
        f.targetX = perch.x
        f.targetY = perch.y
        f.targetZ = perch.z
      } else {
        f.timer = 1
      }
    }
  } else {
    const d = Math.hypot(f.targetX - f.x, f.targetZ - f.z)
    tx = f.targetX
    tz = f.targetZ
    const approach = smoothstep(0.15, 1.4, d)
    ty = f.targetY + 0.03 + approach * Math.max(cruise, groundBelow + cruise - f.targetY)
    if (d < 0.06 && Math.abs(f.y - f.targetY) < 0.07) {
      f.state = 'perched'
      f.x = f.targetX
      f.y = f.targetY
      f.z = f.targetZ
      f.vx = f.vy = f.vz = 0
      f.timer = 0.5 + random(ctx.rng) * 1.4
      return
    }
  }
  const speed = FLYER.speed * (1 - 0.45 * fog)
  let dx = tx - f.x
  let dy = ty - f.y
  let dz = tz - f.z
  const l = Math.hypot(dx, dy, dz) || 1
  const slow = f.state === 'flying' ? Math.min(1, l / 0.4) * 0.8 + 0.2 : 1
  dx = (dx / l) * speed * slow
  dy = (dy / l) * speed * slow
  dz = (dz / l) * speed * slow
  const k = 1 - Math.exp(-local * FLYER.turn)
  f.vx += (dx - f.vx) * k
  f.vy += (dy - f.vy) * k
  f.vz += (dz - f.vz) * k
  // Climb over architecture ahead.
  if (solidAt(ctx.arch, f.x + f.vx * 0.1, f.y + f.vy * 0.1, f.z + f.vz * 0.1)) f.vy = Math.max(f.vy, speed * 0.8)
  f.x += f.vx * local
  f.y += f.vy * local
  f.z += f.vz * local
  f.y = Math.max(f.y, statics.groundAt(f.x, f.z) + 0.03)
  const r = Math.hypot(f.x, f.z)
  if (r > GRID_EXTENT - 0.3) {
    f.x *= (GRID_EXTENT - 0.3) / r
    f.z *= (GRID_EXTENT - 0.3) / r
  }
  splat(ctx.fields.flyway, f.x, f.z, 0.2, local * 0.3, 1)
  f.trailClock += local
  if (f.trailClock >= TRAIL_EVERY) {
    f.trailClock = 0
    pushTrail(f.trail, FLYER.trail, f.x, f.y, f.z)
  }
}

/** Advances every creature by `hours` (sub-stepped by the caller). */
export function stepCreatures(creatures: Creatures, ctx: CreatureContext, hours: number, plans: { left: number }) {
  creatures.perchClock += hours
  if (creatures.perchClock > 3) {
    creatures.perchClock = 0
    creatures.perches = findPerches(ctx.statics, ctx.fields, ctx.veg)
  }
  for (const c of creatures.ground) {
    if (c.id !== ctx.controlled) stepGround(c, ctx, hours, plans)
  }
  for (const f of creatures.flyers) {
    if (f.id !== ctx.controlled) stepFlyer(f, ctx, hours, creatures.perches, creatures.flyers)
  }
}

export type DriveInput = { forward: number; turn: number; lift: number }

/**
 * Embodied control: the player moves the creature in real seconds,
 * whatever the simulation speed. A ground creature still wears the ground,
 * so a walked line can become a path the others take.
 */
export function driveCreature(creatures: Creatures, id: number, input: DriveInput, seconds: number, ctx: CreatureContext) {
  const ground = creatures.ground.find((c) => c.id === id)
  if (ground) {
    ground.heading += input.turn * 2.4 * seconds
    const speed = (ground.niche === 'wader' ? 0.45 : 0.7) * input.forward
    ground.state = 'deciding'
    ground.route = []
    if (speed !== 0) move(ground, ctx, Math.cos(ground.heading) * speed * seconds, Math.sin(ground.heading) * speed * seconds, seconds * 0.25)
    return
  }
  const flyer = creatures.flyers.find((f) => f.id === id)
  if (!flyer) return
  flyer.state = 'flying'
  const heading = Math.atan2(flyer.vz, flyer.vx) + input.turn * 2.2 * seconds
  const speed = 0.5 + 1.1 * Math.max(0, input.forward)
  flyer.vx = Math.cos(heading) * speed
  flyer.vz = Math.sin(heading) * speed
  flyer.vy = input.lift * 0.8
  flyer.x += flyer.vx * seconds
  flyer.z += flyer.vz * seconds
  flyer.y = Math.max(ctx.statics.groundAt(flyer.x, flyer.z) + 0.06, Math.min(5, flyer.y + flyer.vy * seconds))
  flyer.targetX = flyer.x
  flyer.targetY = flyer.y
  flyer.targetZ = flyer.z
  splat(ctx.fields.flyway, flyer.x, flyer.z, 0.12, seconds * 0.1, 1)
  flyer.trailClock += seconds * 0.25
  if (flyer.trailClock >= TRAIL_EVERY) {
    flyer.trailClock = 0
    pushTrail(flyer.trail, FLYER.trail, flyer.x, flyer.y, flyer.z)
  }
}

/**
 * Hands a creature back to the ecology after control: a ground creature
 * decides afresh from where it stands; a flyer circles where it is, then
 * picks a perch.
 */
export function releaseCreature(creatures: Creatures, id: number) {
  const ground = creatures.ground.find((c) => c.id === id)
  if (ground) {
    ground.state = 'deciding'
    ground.route = []
    return
  }
  const flyer = creatures.flyers.find((f) => f.id === id)
  if (!flyer) return
  flyer.state = 'soaring'
  flyer.timer = 0.6
  flyer.circleX = flyer.x
  flyer.circleZ = flyer.z
}

/** Heading of a flyer from its velocity (or last known). */
export const flyerHeading = (f: Flyer) => Math.atan2(f.vz, f.vx)

export function wornShare(statics: Statics, fields: Fields): { worn: number; abandoned: number } {
  let worn = 0
  let abandoned = 0
  for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 1) {
    if (!statics.inside[index]) continue
    if (fields.wear[index]! > 0.25) worn += CELL * CELL
    if (fields.abandoned[index]! > 0.3) abandoned += CELL * CELL
  }
  return { worn, abandoned }
}
