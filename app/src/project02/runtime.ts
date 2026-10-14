import { ClampToEdgeWrapping, DataTexture, LinearFilter, RGBAFormat, UnsignedByteType, type Vector3 } from 'three'
import { sunAt } from '../project/sun.ts'
import { tipCenter, type Tip } from './architecture.ts'
import { lerp, type Lens, type Resolution } from './core.ts'
import { CREATURES_ENABLED, flyerHeading, releaseCreature, type DriveInput, type GroundCreature } from './creatures.ts'
import { createLightTrace, stepLightTrace, writeFieldTextures, type LightTrace } from './fields.ts'
import { GRID_SIZE } from './grid.ts'
import type { HistoryEntry } from './history.ts'
import { createPerceptionTexture, senseKey, writePerception, type CreatureView, type SenseKey, type WayOfSeeing } from './perception.ts'
import {
  advanceEco,
  changeResolution,
  createEco,
  DEFAULT_SEED,
  defaultSettings,
  driveEco,
  fastForward,
  logWeather,
  rescan,
  snapshotEco,
  START_HOUR,
  type Eco,
  type Settings,
} from './simulation.ts'
import { packEco, unpackEco } from './persist.ts'
import { createStatics, seedSuitability, type Statics } from './statics.ts'
import { thinVegetation } from './vegetation.ts'
import { createWindTexture } from './wind.ts'
import { clearWeather, setAuto, setCondition, setFogDensity, setWind, upgradeWeather, weatherLabel, windSpeed, type Condition } from './weather.ts'

/**
 * Shadow Ecology 0.2 — the running world between React and three.js. The
 * page owns one Runtime; scene layers read it every frame, the panel reads a
 * throttled summary. Everything that changes the world goes through here.
 */
export type Fragment = { x: number; y: number; z: number; ground: number; size: number; start: number; water: boolean; landed: boolean }

export type LodTelemetry = {
  archChunks: [number, number, number]
  archTriangles: number
  plants: [number, number, number]
  plantTriangles: number
  creatures: [number, number, number]
  creatureTriangles: number
}

/** A ripple on the water: rubble, a creature's wake, a heavy drop. Rendering only. */
export type Impact = { x: number; z: number; strength: number }

/** Where the lens sits on screen (px from the canvas's top left), for the page's label. */
export type LensScreen = { x: number; y: number; size: number; pinned: boolean }

/** Day-start states kept for jumping back; Day 1 always, then the most recent. */
const KEPT_DAYS = 10

export type Runtime = {
  statics: Statics
  eco: Eco
  trace: LightTrace
  /** state and perception fields, and the wind field (wind.ts) for plant sway and water. */
  textures: { state: DataTexture; perception: DataTexture; wind: DataTexture }
  settings: Settings
  playing: boolean
  hoursPerSecond: number
  drive: DriveInput
  way: WayOfSeeing
  creatureView: CreatureView
  /** Index into the current way's focus list (tip, creature, plant). */
  focus: number
  /** Bumped whenever the world object is replaced (reset, branch, resolution). */
  epoch: number
  realTime: number
  /** Real seconds of playback: stands still while paused, so falling rubble and rain freeze with the world. */
  motionTime: number
  scannedVersion: number
  scanClock: number
  textureClock: number
  perceptionClock: number
  perceptionKey: SenseKey | null
  wakeClock: number
  seedable: { insolation: Float32Array; field: Float32Array } | null
  fragments: Fragment[]
  impacts: Impact[]
  lod: LodTelemetry
  lensScreen: LensScreen | null
  /** The world as it stood at the start of each day reached (Day 1 always kept), packed. */
  days: Map<number, Uint8Array>
  /** Time of day the scene is lit at: always the simulation's hour. */
  viewHour: number
  /** A jump is being computed off screen; the shown world holds still. */
  jumping: boolean
}

function stateTexture(): DataTexture {
  const texture = new DataTexture(new Uint8Array(GRID_SIZE * GRID_SIZE * 4), GRID_SIZE, GRID_SIZE, RGBAFormat, UnsignedByteType)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

/** Playback: simulated hours per real second. 1× is a day in a minute; slow is a day in five. */
export const PLAYBACK = { pause: 0, slow: 0.08, '1x': 0.4, '4x': 1.6 } as const
export type Playback = keyof typeof PLAYBACK

export function createRuntime(resolution: Resolution = 'medium'): Runtime {
  const statics = createStatics()
  const rt: Runtime = {
    statics,
    eco: createEco(statics, resolution),
    trace: createLightTrace(),
    textures: { state: stateTexture(), perception: createPerceptionTexture(), wind: createWindTexture() },
    settings: defaultSettings(),
    playing: true,
    hoursPerSecond: PLAYBACK['1x'],
    drive: { forward: 0, turn: 0, lift: 0 },
    way: 'world',
    creatureView: 'ground',
    focus: 0,
    epoch: 0,
    realTime: 0,
    motionTime: 0,
    scannedVersion: -1,
    scanClock: 0,
    textureClock: 0,
    perceptionClock: 0,
    perceptionKey: null,
    wakeClock: 0,
    seedable: null,
    fragments: [],
    impacts: [],
    lod: {
      archChunks: [0, 0, 0],
      archTriangles: 0,
      plants: [0, 0, 0],
      plantTriangles: 0,
      creatures: [0, 0, 0],
      creatureTriangles: 0,
    },
    lensScreen: null,
    days: new Map(),
    viewHour: 0,
    jumping: false,
  }
  rt.viewHour = rt.eco.hour
  rt.days.set(1, packEco(rt.eco))
  refreshTextures(rt)
  return rt
}

/** Keeps the world as it stands when a new day has begun. */
function recordDay(rt: Runtime) {
  const { day } = rt.eco
  if (rt.days.has(day) || rt.eco.hour > 6) return
  rt.days.set(day, packEco(rt.eco))
  const kept = [...rt.days.keys()].filter((d) => d !== 1).sort((a, b) => a - b)
  while (kept.length > KEPT_DAYS) rt.days.delete(kept.shift()!)
}

/** Days the world can return to. */
export const keptDays = (rt: Runtime) => [...rt.days.keys()].sort((a, b) => a - b)

/** Returns the world to the start of `day` (one that was kept). */
export function returnToDay(rt: Runtime, day: number) {
  const packed = rt.days.get(day)
  if (!packed) return
  for (const d of [...rt.days.keys()]) if (d > day) rt.days.delete(d)
  replaceWorld(rt, unpackEco(packed))
}

export function disposeRuntime(rt: Runtime) {
  rt.textures.state.dispose()
  rt.textures.perception.dispose()
  rt.textures.wind.dispose()
  rt.statics.base.landmass.geometry.dispose()
  rt.statics.base.water.dispose()
  rt.statics.base.field.dispose()
  rt.statics.base.habitatField.dispose()
}

const keyOf = (rt: Runtime) => senseKey(rt.way, rt.creatureView)

function writeSense(rt: Runtime) {
  const key = keyOf(rt)
  writePerception(rt.textures.perception, key, rt.statics, rt.eco.fields, seedableField(rt), rt.eco.veg)
  rt.perceptionKey = key
}

function refreshTextures(rt: Runtime) {
  const { base } = rt.statics
  writeFieldTextures(rt.eco.fields, rt.statics, { field: base.field, habitat: base.habitatField, state: rt.textures.state })
  writeSense(rt)
}

function seedableField(rt: Runtime): Float32Array | null {
  if (rt.way !== 'architecture') return null
  if (rt.seedable?.insolation !== rt.eco.fields.insolation) {
    rt.seedable = { insolation: rt.eco.fields.insolation, field: seedSuitability(rt.statics, rt.eco.fields.insolation) }
  }
  return rt.seedable.field
}

/** Wakes where creatures meet the water: ground creatures fording rivers, flyers skimming the surface. */
function collectWakes(rt: Runtime, dt: number) {
  if (!CREATURES_ENABLED) return
  rt.wakeClock += dt
  if (rt.wakeClock < 0.35) return
  rt.wakeClock = 0
  const { statics, eco } = rt
  for (const c of eco.creatures.ground) {
    const cell = statics.cellAt(c.x, c.z)
    if (cell >= 0 && statics.water[cell] && c.state === 'travelling') rt.impacts.push({ x: c.x, z: c.z, strength: 0.35 })
  }
  for (const f of eco.creatures.flyers) {
    const cell = statics.cellAt(f.x, f.z)
    if (cell < 0 || !statics.water[cell] || f.state === 'perched') continue
    if (f.y - (statics.waterLevel[cell]! + eco.fields.waterOffset) < 0.08) rt.impacts.push({ x: f.x, z: f.z, strength: 0.3 })
  }
}

/** One animation frame: simulate, keep light and fields current, collect render-only effects. */
export function stepRuntime(rt: Runtime, seconds: number) {
  const dt = Math.min(seconds, 0.1)
  rt.realTime += dt
  const { eco, statics } = rt
  if (rt.playing && !rt.jumping && rt.hoursPerSecond > 0) {
    rt.motionTime += dt
    advanceEco(eco, statics, rt.settings, dt * rt.hoursPerSecond)
  }
  rt.viewHour = eco.hour
  if (rt.settings.controlled) driveEco(eco, statics, rt.settings, rt.drive, dt)

  rt.scanClock += dt
  if (eco.arch.version !== rt.scannedVersion && rt.scanClock > 0.3) {
    rescan(eco, statics)
    rt.scannedVersion = eco.arch.version
    rt.scanClock = 0
  }
  const traced = stepLightTrace(rt.trace, statics, eco.arch, eco.noon, 160)
  if (traced) eco.fields.insolation = traced

  for (const f of eco.arch.fragments) {
    const cell = statics.cellAt(f.x, f.z)
    rt.fragments.push({ ...f, start: rt.motionTime, water: cell >= 0 && statics.water[cell] === 1, landed: false })
  }
  eco.arch.fragments = []
  if (rt.fragments.length > 600) rt.fragments.splice(0, rt.fragments.length - 600)
  if (rt.playing) collectWakes(rt, dt)
  recordDay(rt)

  rt.textureClock += dt
  if (rt.textureClock > 0.2) {
    rt.textureClock = 0
    const { base } = statics
    writeFieldTextures(eco.fields, statics, { field: base.field, habitat: base.habitatField, state: rt.textures.state })
  }
  rt.perceptionClock += dt
  if (rt.perceptionKey !== keyOf(rt) || rt.perceptionClock > 0.6) {
    rt.perceptionClock = 0
    writeSense(rt)
  }
}

function replaceWorld(rt: Runtime, eco: Eco) {
  rt.eco = eco
  rt.viewHour = eco.hour
  rt.trace = createLightTrace()
  rt.scannedVersion = -1
  rt.fragments = []
  rt.settings.controlled = 0
  rt.epoch += 1
  rescan(eco, rt.statics)
  refreshTextures(rt)
}

/** Starts the world again from day 1, drawn from `seed`. */
export function resetRuntime(rt: Runtime, resolution: Resolution, seed = rt.eco.seed ?? DEFAULT_SEED) {
  replaceWorld(rt, createEco(rt.statics, resolution, seed))
  rt.days.clear()
  rt.days.set(1, packEco(rt.eco))
}

/** Loads a saved world; days before it can no longer be returned to. */
export function restoreRuntime(rt: Runtime, eco: Eco) {
  upgradeWeather(eco.weather)
  replaceWorld(rt, eco)
  rt.days.clear()
  rt.days.set(rt.eco.day, packEco(rt.eco))
}

export function setResolution(rt: Runtime, resolution: Resolution) {
  changeResolution(rt.eco, rt.statics, resolution)
  rt.epoch += 1
  rt.scannedVersion = -1
}

/** Jumps the world forward whole hours, headless. */
export function skipHours(rt: Runtime, hours: number) {
  const until = rt.eco.clock + hours
  // Stop at each midnight on the way, so the days passed can be returned to.
  while (rt.eco.clock < until - 1e-6) {
    const toMidnight = 24 - rt.eco.hour
    fastForward(rt.eco, rt.statics, rt.settings, Math.min(until - rt.eco.clock, toMidnight > 1e-6 ? toMidnight : 24), rt.trace)
    recordDay(rt)
  }
  rt.scannedVersion = -1
  rt.epoch += 1
  rt.viewHour = rt.eco.hour
  refreshTextures(rt)
}

/**
 * Sets the simulation to `hour` of the current day, as 0.1 does: the clock
 * moves with it (nothing is simulated in between) and playback continues
 * from there.
 */
export function setViewHour(rt: Runtime, hour: number) {
  const { eco } = rt
  const next = Math.min(23.999, Math.max(0, hour))
  eco.clock = Math.max(0, eco.clock + next - eco.hour)
  eco.hour = next
  rt.viewHour = next
}

/**
 * A jump computed on a detached copy of the world: the shown world stays as
 * it is until `finishJump` swaps the result in, so no intermediate day is drawn.
 */
export type DayJump = {
  work: Eco
  trace: LightTrace
  /** Simulation clock to stop at. */
  until: number
  /** Kept days the shown world loses when the result replaces it (later than this). */
  from: number
  /** Hours between light re-traces: a long jump re-traces as seldom as `fastForward` does over days. */
  chunk: number
  days: Map<number, Uint8Array>
}

/** Starts a jump to simulation clock `until`, from the current world or, going back, the latest kept day before it. */
export function beginJump(rt: Runtime, until: number): DayJump {
  let work: Eco | null = null
  if (until < rt.eco.clock) {
    // A day is kept within its first six hours, so its start is at most this clock.
    const latestStart = (day: number) => (day === 1 ? 0 : (day - 1) * 24 - START_HOUR + 6)
    const kept = [...rt.days.keys()]
    const before = kept.filter((d) => latestStart(d) <= until)
    const packed = rt.days.get(before.length ? Math.max(...before) : Math.min(...kept))
    if (packed) {
      work = unpackEco(packed)
      work.noon = rt.eco.noon
    }
  }
  work ??= snapshotEco(rt.eco)
  rt.jumping = true
  const chunk = until - work.clock > 24 ? 6 : 3
  return { work, trace: createLightTrace(), until, from: work.day, chunk, days: new Map() }
}

/** Advances a jump by one re-trace interval at most, stopping at midnights to keep the last days; true when done. */
export function stepJump(rt: Runtime, job: DayJump): boolean {
  const { work } = job
  const left = job.until - work.clock
  if (left <= 1e-6) return true
  const toMidnight = 24 - work.hour
  fastForward(work, rt.statics, rt.settings, Math.min(left, job.chunk, toMidnight > 1e-6 ? toMidnight : 24), job.trace, job.chunk)
  const targetDay = work.day + Math.ceil((job.until - work.clock) / 24)
  if (work.hour <= 6 && !job.days.has(work.day) && work.day > targetDay - KEPT_DAYS) job.days.set(work.day, packEco(work))
  return job.until - work.clock <= 1e-6
}

export function finishJump(rt: Runtime, job: DayJump) {
  for (const d of [...rt.days.keys()]) if (d > job.from) rt.days.delete(d)
  for (const [d, packed] of job.days) rt.days.set(d, packed)
  const kept = [...rt.days.keys()].filter((d) => d !== 1).sort((a, b) => a - b)
  while (kept.length > KEPT_DAYS) rt.days.delete(kept.shift()!)
  rt.jumping = false
  replaceWorld(rt, job.work)
}

export function cancelJump(rt: Runtime) {
  rt.jumping = false
}

export function setNoon(rt: Runtime, noon: number) {
  rt.eco.noon = noon
}

/** AUTO on clears the manual choice and hands Rain / Fog / Wind back to the seeded cycle at once. */
export function setWeatherAuto(rt: Runtime, auto: boolean) {
  for (const began of setAuto(rt.eco.weather, auto)) logWeather(rt.eco, rt.statics, began, false)
}

/** One condition set by hand (AUTO turns off); a condition beginning is written into the history. */
export function setWeatherCondition(rt: Runtime, condition: Condition, on: boolean) {
  const began = setCondition(rt.eco.weather, condition, on)
  if (began) logWeather(rt.eco, rt.statics, began, true)
}

/** Clear: AUTO off and every condition gone at once. */
export function clearWeatherNow(rt: Runtime) {
  const began = clearWeather(rt.eco.weather)
  if (began) logWeather(rt.eco, rt.statics, began, true)
}

export function setFogThickness(rt: Runtime, density: number) {
  setFogDensity(rt.eco.weather, density)
}

/** A manual wind's heading (degrees, compass-free: 0 toward +x) and strength 0…1. */
export function setWindManual(rt: Runtime, degrees: number, strength: number) {
  setWind(rt.eco.weather, (degrees * Math.PI) / 180, strength)
}

/** Plant density: a multiplier on how many plants each strategy keeps. Thins at once when lowered. */
export function setPlantDensity(rt: Runtime, density: number) {
  rt.settings.density = density
  thinVegetation(rt.eco.veg, density)
}

export function setPlayback(rt: Runtime, playback: Playback) {
  rt.playing = playback !== 'pause'
  if (rt.playing) rt.hoursPerSecond = PLAYBACK[playback]
}

export type Processes = Pick<Settings, 'growing' | 'decaying' | 'growthSpeed' | 'decaySpeed'>

export function setProcesses(rt: Runtime, processes: Processes) {
  Object.assign(rt.settings, processes)
}

/** The observation lens in the world: inside it, time runs at `slow`. */
export function setLens(rt: Runtime, lens: Lens | null) {
  rt.settings.lens = lens
}

export function setWay(rt: Runtime, way: WayOfSeeing, creatureView: CreatureView, focus: number) {
  rt.way = way
  rt.creatureView = creatureView
  rt.focus = focus
}

export function setDrive(rt: Runtime, input: DriveInput) {
  rt.drive = input
}

/** Puts a creature under keyboard control (0 releases); a released creature rejoins the ecology. */
export function setControlled(rt: Runtime, id: number) {
  const previous = rt.settings.controlled
  if (previous && previous !== id) releaseCreature(rt.eco.creatures, previous)
  rt.settings.controlled = id
  if (!id) rt.drive = { forward: 0, turn: 0, lift: 0 }
}

export function setLensScreen(rt: Runtime, screen: LensScreen | null) {
  rt.lensScreen = screen
}

export function takeImpacts(rt: Runtime) {
  const impacts = rt.impacts
  rt.impacts = []
  return impacts
}

export function setLodTelemetry(rt: Runtime, patch: Partial<LodTelemetry>) {
  Object.assign(rt.lod, patch)
}

/** What the camera follows in a way of seeing, at `focus` (wrapping). */
export type FocusKind = 'tip' | 'ground' | 'wader' | 'flyer' | 'plant'
/** A need or reading of the focused entity, 0…1, for the panel. */
export type FocusValue = { label: string; value: number }
export type FocusTarget = {
  id: number
  kind: FocusKind
  label: string
  position: Vector3Like
  heading: Vector3Like
  values: FocusValue[]
}

const percent = (v: number) => Math.max(0, Math.min(1, v))

function groundValues(rt: Runtime, c: GroundCreature): FocusValue[] {
  const { statics, eco } = rt
  const cell = statics.cellAt(c.x, c.z)
  const at = (field: Float32Array) => (cell >= 0 ? field[cell]! : 0)
  return [
    { label: 'Thirst', value: c.thirst },
    { label: 'Hunger', value: c.hunger },
    { label: 'Fatigue', value: c.fatigue },
    { label: 'Shelter here', value: percent(at(eco.fields.shelter)) },
    { label: 'Water near', value: cell >= 0 ? percent(Math.exp(-statics.base.hydrology.waterDistance[cell]! / 0.12)) : 0 },
    { label: 'Habitat', value: percent(at(eco.fields.habitat)) },
  ]
}
type Vector3Like = [number, number, number]

function liveTips(rt: Runtime): Tip[] {
  return [...rt.eco.arch.tips].sort((a, b) => a.id - b.id)
}

export function focusTarget(rt: Runtime): FocusTarget | null {
  const { eco, statics } = rt
  const wrap = <T,>(list: T[]) => (list.length ? list[((rt.focus % list.length) + list.length) % list.length]! : null)
  if (rt.way === 'architecture') {
    const tip = wrap(liveTips(rt))
    if (!tip) return null
    const role = tip.role === 'reach' ? 'Reaching' : tip.role === 'spread' ? 'Spreading' : 'Bracing'
    const chosen = tip.candidates.find((c) => c.chosen)
    return {
      id: tip.id,
      kind: 'tip',
      label: `${role} front ${tip.id}`,
      position: tipCenter(eco.arch, tip),
      heading: tip.dir,
      values: chosen
        ? [
            { label: 'Light', value: percent(chosen.light) },
            { label: 'Support', value: percent(chosen.support) },
            { label: 'Risk', value: percent(chosen.risk) },
          ]
        : [],
    }
  }
  if (rt.way === 'creature' && rt.creatureView !== 'flying') {
    const niche = rt.creatureView === 'wading' ? 'wader' : 'walker'
    const c = wrap(eco.creatures.ground.filter((g) => g.niche === niche))
    if (!c) return null
    const doing = c.state === 'travelling' ? `going to ${c.reason}` : c.state
    const name = niche === 'wader' ? 'Wader' : 'Walker'
    return {
      id: c.id,
      kind: niche === 'wader' ? 'wader' : 'ground',
      label: `${name} ${c.id} · ${c.id === rt.settings.controlled ? 'under your control' : doing}`,
      position: [c.x, c.y, c.z],
      heading: [Math.cos(c.heading), 0, Math.sin(c.heading)],
      values: groundValues(rt, c),
    }
  }
  if (rt.way === 'creature') {
    const f = wrap(eco.creatures.flyers)
    if (!f) return null
    const h = flyerHeading(f)
    const cell = statics.cellAt(f.x, f.z)
    return {
      id: f.id,
      kind: 'flyer',
      label: `Flyer ${f.id} · ${f.id === rt.settings.controlled ? 'under your control' : f.state}`,
      position: [f.x, f.y, f.z],
      heading: [Math.cos(h), 0, Math.sin(h)],
      values: [
        { label: 'Height', value: percent((f.y - statics.groundAt(f.x, f.z)) / 2.5) },
        { label: 'Open air', value: cell >= 0 ? percent(1 - statics.enclosure[cell]!) : 1 },
        { label: 'Flyway', value: cell >= 0 ? percent(eco.fields.flyway[cell]! * 2.5) : 0 },
      ],
    }
  }
  const plants = eco.veg.plants.filter((p) => p.died < 0 && p.growth > 0.5)
  const p = wrap(plants)
  if (!p) return null
  const sun = sunAt(rt.viewHour, eco.noon)
  return {
    id: p.id,
    kind: 'plant',
    label: `${p.kind === 'exposure' ? 'Exposure' : 'Shelter'} plant ${p.id}`,
    position: [p.x, statics.groundAt(p.x, p.z), p.z],
    heading: sun.direction,
    values: [],
  }
}

/** Camera pose for embodied perspective: where to stand and where to look. */
export function embodiedPose(rt: Runtime, target: FocusTarget): { position: Vector3Like; look: Vector3Like } {
  const [x, y, z] = target.position
  const [hx, hy, hz] = target.heading
  // Rising ground behind the entity would otherwise swallow the camera.
  const above = (position: Vector3Like, clearance: number): Vector3Like => [
    position[0],
    Math.max(position[1], rt.statics.groundAt(position[0], position[2]) + clearance),
    position[2],
  ]
  if (target.kind === 'tip') {
    return { position: above([x - hx * 1.2 + 0.4, y + 0.5 - hy * 0.4, z - hz * 1.2 + 0.4], 0.25), look: [x + hx * 0.5, y + hy * 0.5, z + hz * 0.5] }
  }
  if (target.kind === 'ground' || target.kind === 'wader') {
    const lift = target.kind === 'wader' ? 0.5 : 0.38
    return { position: above([x - hx * 0.95, y + lift, z - hz * 0.95], 0.28), look: above([x + hx * 1.6, y + 0.1, z + hz * 1.6], 0.1) }
  }
  if (target.kind === 'flyer') {
    return { position: above([x - hx * 1.1, y + 0.35, z - hz * 1.1], 0.3), look: [x + hx * 1.5, y - 0.35, z + hz * 1.5] }
  }
  // A plant's view: low among the stems, looking up toward its sun.
  return { position: above([x - hx * 0.22 + 0.03, y + 0.05, z - hz * 0.22 + 0.03], 0.05), look: [x + hx * 0.8, y + Math.max(0.25, hy * 0.8), z + hz * 0.8] }
}

/** Smoothly moves a camera toward a pose (rendering only). */
export function easeCamera(camera: { position: Vector3; lookAt: (x: number, y: number, z: number) => void }, look: Vector3, pose: { position: Vector3Like; look: Vector3Like }, seconds: number) {
  const k = 1 - Math.exp(-seconds * 4)
  camera.position.set(
    lerp(camera.position.x, pose.position[0], k),
    lerp(camera.position.y, pose.position[1], k),
    lerp(camera.position.z, pose.position[2], k),
  )
  look.set(lerp(look.x, pose.look[0], k), lerp(look.y, pose.look[1], k), lerp(look.z, pose.look[2], k))
  camera.lookAt(look.x, look.y, look.z)
}

/** What the panel shows, read four times a second. */
export type Stats = {
  day: number
  hour: number
  /** Time of day the scene is lit at. */
  viewHour: number
  noon: number
  weather: string
  weatherOn: Record<Condition, boolean>
  weatherAuto: boolean
  fogDensity: number
  /** Prevailing wind heading (degrees, 0 toward +x) and speed 0…1. */
  windHeading: number
  windSpeed: number
  resolution: Resolution
  voxels: number
  fronts: number
  structures: number
  collapsed: number
  weathered: number
  exposurePlants: number
  shelterPlants: number
  ground: number
  flyers: number
  log: HistoryEntry[]
  focus: string | null
  focusValues: FocusValue[]
  lod: LodTelemetry
  clock: number
  seed: number
  /** Trips walked so far, and the length of ground they have worn into paths (world units). */
  trips: number
  pathLength: number
}

export function readStats(rt: Runtime): Stats {
  const { eco } = rt
  const target = focusTarget(rt)
  let exposure = 0
  let shelter = 0
  for (const p of eco.veg.plants) {
    if (p.died >= 0) continue
    if (p.kind === 'exposure') exposure += 1
    else shelter += 1
  }
  return {
    day: eco.day,
    hour: eco.hour,
    viewHour: rt.viewHour,
    noon: eco.noon,
    weather: weatherLabel(eco.weather),
    weatherOn: { ...eco.weather.on },
    weatherAuto: eco.weather.auto,
    fogDensity: eco.weather.fogDensity,
    windHeading: ((((eco.weather.windDir ?? 0) * 180) / Math.PI) % 360 + 360) % 360,
    windSpeed: windSpeed(eco.weather),
    resolution: eco.arch.resolution,
    voxels: eco.arch.count,
    fronts: eco.arch.tips.length,
    structures: eco.arch.sites.filter((s) => s.voxels > 0).length,
    collapsed: eco.arch.collapsed,
    weathered: eco.arch.weathered,
    exposurePlants: exposure,
    shelterPlants: shelter,
    ground: eco.creatures.ground.length,
    flyers: eco.creatures.flyers.length,
    log: eco.log.entries.slice(0, 24).map((e) => ({ ...e })),
    focus: target?.label ?? null,
    focusValues: target?.values ?? [],
    lod: { ...rt.lod, archChunks: [...rt.lod.archChunks], plants: [...rt.lod.plants], creatures: [...rt.lod.creatures] },
    clock: eco.clock,
    seed: eco.seed ?? DEFAULT_SEED,
    trips: eco.fields.trailTrips ?? 0,
    pathLength: eco.fields.trailLength ?? 0,
  }
}
