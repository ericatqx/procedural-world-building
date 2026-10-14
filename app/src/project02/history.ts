import { CELL, cellIndex, cellX, GRID_EXTENT, GRID_SIZE } from './grid.ts'
import type { Fields } from './fields.ts'
import type { Statics } from './statics.ts'
import type { Vegetation } from './vegetation.ts'

/**
 * Shadow Ecology 0.2 — history. Week 07's chain, read off the running world:
 *
 *   event → environmental change → ecological response → trace
 *
 * An event (a collapse, a weather spell, a dieback) records the place as it
 * stood; the same place is measured again a few hours on (what the
 * environment did), half a day on (how plants, habitat and routes answered)
 * and a day and a half on (what trace remains). Each link is written as it
 * is measured, so an entry fills in while you watch.
 *
 * Small events of a kind close in time and place are gathered into one
 * entry (five small failures on one structure are one entry, ×5). Firsts,
 * weather spells, large collapses, diebacks and shifts in where creatures
 * shelter are milestones: the history as it would be told.
 *
 * Branches are whole-world snapshots: return to one, change the weather or
 * the growth, and a different outcome grows from the same world.
 */

export type HistoryKind =
  | 'collapse'
  | 'rain'
  | 'fog'
  | 'drought'
  | 'wind'
  | 'clear'
  | 'dieback'
  | 'colonise'
  | 'seed'
  | 'bridge'
  | 'migration'

export type Place = {
  light: number
  shelter: number
  habitat: number
  moisture: number
  wear: number
  abandoned: number
  rubble: number
  exposurePlants: number
  shelterPlants: number
  flyway: number
}

export type HistoryEntry = {
  id: number
  kind: HistoryKind
  clock: number
  x: number
  z: number
  radius: number
  title: string
  /** What happened, in a few words (sizes, counts, whether forced). */
  detail: string
  /** Events gathered into this entry, and their summed size (voxels, plants). */
  count: number
  amount: number
  /** The first of its kind in this history. */
  first: boolean
  milestone: boolean
  /** A manual weather experiment rather than the cycle. */
  forced: boolean
  /** Clock of the latest event gathered. */
  last: number
  before: Place
  /** Clock when the next link is measured. */
  due: number
  /** The chain, link by link; null until measured. */
  change: string | null
  response: string | null
  reorganisation: string | null
  trace: string | null
}

export type HistoryLog = { entries: HistoryEntry[]; nextId: number; firsts: HistoryKind[] }

const FOLLOW = { change: 3, response: 12, reorganisation: 36 } as const
const MAX_ENTRIES = 60
/** Events of a kind within this many hours and this distance are gathered into one entry. */
const GATHER = { hours: 12, distance: 2.4 } as const
/** Size that makes a gathered entry a milestone of its own: collapsed volume, plants lost. */
const MAJOR = { collapse: 0.03, dieback: 10 } as const
const major = (kind: HistoryKind, amount: number) =>
  (kind === 'collapse' || kind === 'dieback') && amount >= MAJOR[kind]

export const createHistoryLog = (): HistoryLog => ({ entries: [], nextId: 1, firsts: [] })

/** Means over a disc (whole island when radius is large). */
export function measurePlace(statics: Statics, fields: Fields, veg: Vegetation, x: number, z: number, radius: number): Place {
  const place: Place = {
    light: 0,
    shelter: 0,
    habitat: 0,
    moisture: 0,
    wear: 0,
    abandoned: 0,
    rubble: 0,
    exposurePlants: 0,
    shelterPlants: 0,
    flyway: 0,
  }
  let n = 0
  const i0 = Math.max(0, Math.floor((x - radius + GRID_EXTENT) / CELL))
  const i1 = Math.min(GRID_SIZE - 1, Math.ceil((x + radius + GRID_EXTENT) / CELL))
  const j0 = Math.max(0, Math.floor((z - radius + GRID_EXTENT) / CELL))
  const j1 = Math.min(GRID_SIZE - 1, Math.ceil((z + radius + GRID_EXTENT) / CELL))
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const index = cellIndex(i, j)
      if (!statics.inside[index] || statics.water[index]) continue
      if (Math.hypot(cellX(i) - x, cellX(j) - z) > radius) continue
      n += 1
      place.light += fields.insolation[index]!
      place.shelter += fields.shelter[index]!
      place.habitat += fields.habitat[index]!
      place.moisture += fields.moisture[index]!
      place.wear += fields.wear[index]!
      place.abandoned += fields.abandoned[index]!
      place.rubble += fields.rubble[index]!
      place.flyway += fields.flyway[index]!
    }
  }
  if (n) {
    for (const key of ['light', 'shelter', 'habitat', 'moisture', 'wear', 'abandoned', 'rubble', 'flyway'] as const) {
      place[key] /= n
    }
  }
  for (const p of veg.plants) {
    if (p.died >= 0 || Math.hypot(p.x - x, p.z - z) > radius) continue
    if (p.kind === 'exposure') place.exposurePlants += 1
    else place.shelterPlants += 1
  }
  return place
}

/** Titles as the history would tell them: the first of a kind, then the ones after. */
const TITLES: Record<HistoryKind, { first: string; later: string }> = {
  collapse: { first: 'First structural failure', later: 'Structural failure' },
  rain: { first: 'Rain reshapes habitat', later: 'Rain reshapes habitat' },
  fog: { first: 'Fog closes in', later: 'Fog closes in' },
  drought: { first: 'Drought draws the water back', later: 'Drought draws the water back' },
  wind: { first: 'Wind rises', later: 'Wind rises' },
  clear: { first: 'Weather clears', later: 'Weather clears' },
  dieback: { first: 'Dieback', later: 'Dieback' },
  colonise: { first: 'Colonisation', later: 'Vegetation takes new ground' },
  seed: { first: 'Architecture takes root', later: 'A new structure roots' },
  bridge: { first: 'Structures join', later: 'Structures join' },
  migration: { first: 'Shelter migration', later: 'Shelter migration' },
}

/** Kinds that are milestones every time; the rest only the first time (or when large). */
const ALWAYS_MILESTONE = new Set<HistoryKind>(['migration'])
/** Weather spells are milestones when forced, the first of their kind, or the first in this many hours. */
const WEATHER_KINDS = new Set<HistoryKind>(['rain', 'fog', 'drought', 'wind'])
const WEATHER_GAP = 48
const GATHERS = new Set<HistoryKind>(['collapse', 'bridge', 'colonise', 'seed', 'dieback'])

function titleFor(e: HistoryEntry, first: boolean): string {
  const t = TITLES[e.kind]
  if (e.kind === 'collapse' && e.amount >= MAJOR.collapse && !first) return 'Major collapse'
  return first ? t.first : t.later
}

/**
 * Records an event, or gathers it into a recent entry of the same kind
 * nearby. `amount` is its size (collapse volume, plant count); `detail` a
 * few words for the entry.
 */
export function logEvent(
  log: HistoryLog,
  kind: HistoryKind,
  clock: number,
  x: number,
  z: number,
  radius: number,
  detail: string,
  before: Place,
  amount = 0,
  forced = false,
) {
  if (GATHERS.has(kind)) {
    const near = log.entries.find(
      (e) => e.kind === kind && clock - e.clock < GATHER.hours && Math.hypot(e.x - x, e.z - z) < GATHER.distance,
    )
    if (near) {
      const total = near.count + 1
      near.x += (x - near.x) / total
      near.z += (z - near.z) / total
      near.radius = Math.max(near.radius, radius, Math.hypot(near.x - x, near.z - z) + radius * 0.5)
      near.count = total
      near.amount += amount
      near.last = clock
      near.detail = describeGathered(kind, near.count, near.amount, detail)
      near.title = titleFor(near, near.first)
      if (major(kind, near.amount)) near.milestone = true
      return
    }
  }
  const first = !log.firsts.includes(kind)
  if (first) log.firsts.push(kind)
  const lastSpell = log.entries.find((e) => e.kind === kind && e.milestone)
  const notableSpell = WEATHER_KINDS.has(kind) && (forced || !lastSpell || clock - lastSpell.clock >= WEATHER_GAP)
  const entry: HistoryEntry = {
    id: log.nextId,
    kind,
    clock,
    x,
    z,
    radius,
    title: '',
    detail: describeGathered(kind, 1, amount, detail),
    count: 1,
    amount,
    first,
    milestone: ALWAYS_MILESTONE.has(kind) || notableSpell || major(kind, amount) || (first && kind !== 'clear' && kind !== 'dieback'),
    forced,
    last: clock,
    before,
    due: clock + FOLLOW.change,
    change: null,
    response: null,
    reorganisation: null,
    trace: null,
  }
  entry.title = titleFor(entry, first)
  log.entries.unshift(entry)
  log.nextId += 1
  if (log.entries.length > MAX_ENTRIES) {
    // Keep milestones longest: drop the oldest minor entry first.
    const minor = log.entries.findLastIndex((e) => !e.milestone)
    log.entries.splice(minor >= 0 ? minor : log.entries.length - 1, 1)
  }
}

function describeGathered(kind: HistoryKind, count: number, amount: number, detail: string): string {
  if (kind === 'collapse') {
    const size = amount >= MAJOR.collapse ? 'a large mass fell' : amount >= MAJOR.collapse / 4 ? 'a span fell' : 'small pieces fell'
    return count > 1 ? `${count} failures on one structure; ${size}` : size
  }
  if (kind === 'colonise' || kind === 'dieback') return count > 1 ? `${Math.round(amount)} vegetation over ${count} rounds` : detail
  if (kind === 'bridge') return count > 1 ? `${count} joins` : 'two masses grew into one'
  if (kind === 'seed') return count > 1 ? `${count} footings on the high ground` : 'a footing on the high ground'
  return detail
}

const pct = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(Math.round(value * 100))}%`
const signed = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value)}`
const rel = (now: number, before: number) => (now - before) / Math.max(0.05, Math.abs(before))

const trend = (delta: number, up: string, down: string, threshold = 0.03) =>
  delta > threshold ? up : delta < -threshold ? down : null

function describeChange(e: HistoryEntry, now: Place): string {
  if (e.kind === 'collapse') {
    const light = trend(rel(now.light, e.before.light), 'light reaches the ground again', 'shade deepens', 0.05)
    return ['rubble on the ground', light].filter(Boolean).join('; ')
  }
  if (e.kind === 'rain' || e.kind === 'drought' || e.kind === 'clear') {
    const m = now.moisture - e.before.moisture
    return `ground ${m > 0.02 ? 'wetter' : m < -0.02 ? 'drier' : 'about as moist'} (moisture ${pct(m)})${e.kind === 'drought' ? '; the shore draws back' : e.kind === 'rain' ? '; the lakes rise' : ''}`
  }
  if (e.kind === 'fog') return 'sight shortened; direct light softened'
  if (e.kind === 'wind') return 'vegetation sways; the water ruffles downwind'
  if (e.kind === 'seed' || e.kind === 'bridge') return trend(rel(now.light, e.before.light), 'more light here', 'shade gathers beside the mass', 0.05) ?? 'shade gathers beside the mass'
  if (e.kind === 'migration') return 'shelter moved with the shade'
  const cover = now.exposurePlants + now.shelterPlants - e.before.exposurePlants - e.before.shelterPlants
  return `vegetation cover ${signed(cover)}`
}

function describeResponse(e: HistoryEntry, now: Place): string {
  const exposure = now.exposurePlants - e.before.exposurePlants
  const shelter = now.shelterPlants - e.before.shelterPlants
  const plants: string[] = []
  if (Math.abs(exposure) >= 2) plants.push(`light-seeking ${signed(exposure)}`)
  if (Math.abs(shelter) >= 2) plants.push(`shadow-seeking ${signed(shelter)}`)
  const habitat = trend(now.habitat - e.before.habitat, 'habitat grows', 'habitat shrinks', 0.02)
  return [plants.join(', ') || 'vegetation holds', habitat].filter(Boolean).join(' · ')
}

function describeReorganisation(e: HistoryEntry, now: Place): string {
  const wear = now.wear - e.before.wear
  const routes = wear > 0.02 ? 'routes now pass here' : wear < -0.02 ? 'routes move away' : 'routes hold'
  const flight = now.flyway - e.before.flyway
  const flyers = flight > 0.01 ? 'flyers cross more often' : flight < -0.01 ? 'flyers avoid it' : null
  return [routes, flyers].filter(Boolean).join(' · ')
}

function describeTrace(e: HistoryEntry, now: Place): string {
  const parts: string[] = []
  if (now.rubble > 0.004) parts.push('rubble remains')
  if (now.abandoned > e.before.abandoned + 0.02) parts.push('a path abandoned')
  if (e.kind === 'collapse' && now.shelter < e.before.shelter - 0.03) parts.push('lost shelter')
  if (now.exposurePlants + now.shelterPlants < e.before.exposurePlants + e.before.shelterPlants - 2) parts.push('thinned stands')
  if (now.habitat > e.before.habitat + 0.03) parts.push('new habitat')
  return parts.length ? parts.join(' · ') : 'little trace'
}

/** Fills in the links whose time has come. */
export function followUp(log: HistoryLog, clock: number, statics: Statics, fields: Fields, veg: Vegetation) {
  for (const e of log.entries) {
    const age = clock - e.clock
    if (e.trace !== null || clock < e.due) continue
    const now = measurePlace(statics, fields, veg, e.x, e.z, e.radius)
    if (e.change === null) e.change = describeChange(e, now)
    if (e.response === null && age >= FOLLOW.response) e.response = describeResponse(e, now)
    if (e.reorganisation === null && age >= FOLLOW.reorganisation) {
      e.reorganisation = describeReorganisation(e, now)
      e.trace = describeTrace(e, now)
    }
    e.due = e.clock + (e.response === null ? FOLLOW.response : FOLLOW.reorganisation)
  }
}

/** A point the world can return to. */
export type BranchNode<State> = {
  id: number
  parent: number | null
  label: string
  clock: number
  summary: string
  state: State
}

export type BranchTree<State> = { nodes: BranchNode<State>[]; head: number; nextId: number }

export function createBranchTree<State>(origin: State, summary: string): BranchTree<State> {
  return { nodes: [{ id: 0, parent: null, label: 'Origin', clock: 0, summary, state: origin }], head: 0, nextId: 1 }
}

export function markBranch<State>(tree: BranchTree<State>, state: State, clock: number, label: string, summary: string): BranchTree<State> {
  const node: BranchNode<State> = { id: tree.nextId, parent: tree.head, label, clock, summary, state }
  return { nodes: [...tree.nodes, node], head: node.id, nextId: tree.nextId + 1 }
}

/** Depth of each node, for drawing the tree as an indented list. */
export function branchDepths<State>(tree: BranchTree<State>): Map<number, number> {
  const depth = new Map<number, number>()
  for (const node of tree.nodes) {
    depth.set(node.id, node.parent === null ? 0 : (depth.get(node.parent) ?? 0) + 1)
  }
  return depth
}

/** Nodes in depth-first order, children after their parent. */
export function branchOrder<State>(tree: BranchTree<State>): BranchNode<State>[] {
  const out: BranchNode<State>[] = []
  const visit = (parent: number | null) => {
    for (const node of tree.nodes) {
      if (node.parent === parent) {
        out.push(node)
        visit(node.id)
      }
    }
  }
  visit(null)
  return out
}
