import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from 'react'
import { BufferAttribute, BufferGeometry, Group, Points, PointsMaterial, Quaternion, Vector3 } from 'three'
import { paleHide, styleCreature } from './worldMaterials.ts'
import { buildCrawler } from '../creature-lab/crawler.ts'
import { buildDweller } from '../creature-lab/dweller.ts'
import { buildGlider } from '../creature-lab/glider.ts'
import { buildStrider } from '../creature-lab/strider.ts'
import type { Creature, CreatureParams, MotionInput, SpeciesId } from '../creature-lab/types.ts'
import { creatureRelease, creatureCam, creatureFocus, type CreatureInfo } from './creatureCam.ts'
import { foodNear, habitatAt, requestHabitat, resetHabitat, trunksNear, updateHabitat } from './creatureHabitat.ts'
import { environment } from './environment.ts'
import type { Navigation } from './LandscapeView.tsx'
import { currentPopulation } from './livingSelection.ts'
import { creatureSpot, loading } from './loading.ts'
import { landscapeHeight } from './terrain.ts'
import { drawnHeight } from './terrainMesh.ts'
import { islandAt } from './Vegetation.tsx'
import { shared } from './vegShared.ts'
import { stand, type SpeciesId as PlantId } from './worldPlants.ts'
import { stageName } from '../creature-lab/growth.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — the island's creatures, from the Creature Lab, unchanged: its four builders and their animations are used as they are, so a creature
 * here is the same body, the same size and the same gait as in the Lab. A modest population, in small groups (so one is easy to find, not many to find),
 * placed once by the seed and the habitat each species reads:
 *
 *   Hollow Dweller   lives at a Living Architecture structure: by day it lies up where the structure roofs or shades the ground (the shelter of the hollow,
 *                    re-chosen as the sun moves the shadow round); at dusk, at night, or when hungry it goes out to the damp, shaded ground where ferns and
 *                    ground mats grow and grazes them plant by plant, then comes back. Pairs, at four structures.
 *   Litter Crawler   lives in the leaf litter of damp, shaded ground under trees and shrubs: it roots in the litter beside the shade plants while its ground is
 *                    in shade, and rolls up where it lies when the sun reaches it. Four groups of three.
 *   Strider          wades the lake shallows by day, from one feeding shallow to the next along the shore, and stands still at night. A group of three and a pair.
 *   Veil Glider      hawks along the woodland edge on a fixed circuit over the canopy by day and at dusk; it is away at night. Two pairs.
 *
 * What a creature senses is the habitat itself (creatureHabitat.ts): the structure's footprint, roof and long-term shade, and its shadow along the sun of the
 * moment; and the very plants that are drawn there. Its finite state machine (rest, travel, forage, return) moves only on what it senses and on its energy,
 * keeps each state a credible time, and only sets out for places it can walk to. The panel shows the state, the reason and the conditions where it is.
 * Nothing is simulated beyond the camera: a creature is built when the camera comes within range and animated within a nearer one; the creature a camera
 * is on is always both, and a glider's circuit is a function of time, so it is where it should be whenever it is seen.
 */
type Kind = SpeciesId
type Spec = { kind: Kind; x: number; z: number; seed: number; age: number; /** The structure it lives at (the dweller): its name, centre and radius. */ home: string; ox: number; oz: number; or: number }

const BUILD_RANGE = 260
const ANIMATE_RANGE = 170
const MAX_BUILT = 18

/**
 * What each species eats, by the plant species of worldPlants.ts (the Creature Lab's agents use the same diet): the dweller forages the forest floor
 * of shaded ground (fungi and seed among the ferns, moss mats and under the shade parasols), the crawler roots in the litter beside them.
 */
const DWELLER_FOOD = new Set<PlantId>(['fern', 'ground', 'tabular'])
const CRAWLER_FOOD = new Set<PlantId>(['fern', 'ground', 'tabular', 'canes'])
/** What makes cover over the litter: the trees and shrubs whose crowns shade a crawler's ground. */
const CANOPY = new Set<PlantId>(['veil', 'flood', 'stilts', 'tabular', 'canes', 'coppice'])

/** Each species' rhythm: the shortest rest and feeding bout (seconds of observation), how far it ranges from its resting place, and how close it lets another. */
/** Each animal's place now, by species, in the creature camera's index order (read only; refreshed by the creatures' frame loop). */
export const creaturePlaces: Record<string, { x: number; z: number; fsm: string }[]> = {}
let placesAt = 0

const RHYTHM: Record<Exclude<Kind, 'glider'>, { rest: number; forage: number; range: number; gap: number }> = {
  dweller: { rest: 28, forage: 18, range: 45, gap: 2.4 },
  crawler: { rest: 20, forage: 16, range: 14, gap: 0.8 },
  strider: { rest: 14, forage: 12, range: 32, gap: 1.8 },
}

const hash = (a: number, b: number, c: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
  return x - Math.floor(x)
}
const pct = (v: number) => `${Math.round(v * 100)}%`

/** Every creature of the world: where it lives, fixed by the seed and the habitat. */
function populate(world: World): Spec[] {
  const island = shared.island
  if (!island) return []
  const at = islandAt(island)
  const seed = world.seed
  const out: Spec[] = []
  const ground = (x: number, z: number) => landscapeHeight(x, z)
  const slope = (x: number, z: number) => Math.hypot(ground(x + 3, z) - ground(x - 3, z), ground(x, z + 3) - ground(x, z - 3)) / 6
  const dry = (x: number, z: number) => world.water.depthAt(x, z) <= 0
  const inside = (x: number, z: number) => Math.hypot(x, z) < 1700
  const population = currentPopulation()
  const make = (kind: Kind, x: number, z: number, k: number, home = '', ox = 0, oz = 0, or = 0): Spec => ({ kind, x, z, seed: Math.floor(hash(seed, k, 99) * 1e6), age: 0.55 + 0.45 * hash(seed, k, 98), home, ox, oz, or })
  // Dwellers: at the foot of four structures, two to each, a few metres apart. They find their shelter under it once its habitat has been read.
  if (population) {
    let n = 0
    for (const o of population.organisms) {
      if (n >= 4 || o.index % 6 !== 1) continue
      for (let k = 0; k < 10; k += 1) {
        const a = hash(seed, o.index, k) * 6.283
        const r = o.radius * 1.0 + 5
        const x = o.x + Math.cos(a) * r
        const z = o.z + Math.sin(a) * r
        if (!dry(x, z) || slope(x, z) > 0.45 || !inside(x, z)) continue
        out.push(make('dweller', x, z, o.index * 3, o.id, o.x, o.z, o.radius))
        for (let j = 0; j < 8; j += 1) {
          const b = hash(seed, o.index, 40 + j) * 6.283
          const x2 = x + Math.cos(b) * (4 + 3 * hash(seed, o.index, 60 + j))
          const z2 = z + Math.sin(b) * (4 + 3 * hash(seed, o.index, 60 + j))
          if (dry(x2, z2) && slope(x2, z2) < 0.45 && Math.hypot(x2 - o.x, z2 - o.z) > o.radius * 1.0 + 2) {
            out.push(make('dweller', x2, z2, o.index * 3 + 1, o.id, o.x, o.z, o.radius))
            break
          }
        }
        n += 1
        break
      }
    }
  }
  // Crawlers: damp, low-lit ground inside woodland (the stand field) where the drawn trees and shrubs actually cover the litter; in groups of three around four
  // places. Of the candidates the fields allow, those under the most canopy (read from the plants themselves) are taken.
  const candidates: { x: number; z: number; score: number }[] = []
  for (const woodland of [true, false]) {
    for (let k = 0; k < 6000 && candidates.length < 48; k += 1) {
      const x = (hash(seed, k, 1) - 0.5) * 3200
      const z = (hash(seed, k, 2) - 0.5) * 3200
      if (!inside(x, z) || !dry(x, z)) continue
      const c = at(x, z, ground(x, z))
      if (woodland && stand(seed, x, z) < 0.5) continue
      if (c.moisture > 0.5 && c.light < 0.66 && c.slope < 0.3 && c.waterDist > 12) candidates.push({ x, z, score: canopyAt(x, z) + 0.5 * c.moisture })
    }
    if (candidates.length >= 12) break
  }
  candidates.sort((a, b) => b.score - a.score)
  const groups: { x: number; z: number }[] = []
  for (const cand of candidates) if (groups.length < 4 && groups.every((g) => Math.hypot(g.x - cand.x, g.z - cand.z) > 220)) groups.push(cand)
  groups.forEach((g, gi) => {
    for (let j = 0; j < 3; j += 1) {
      const a = hash(seed, gi * 7 + j, 3) * 6.283
      const r = 2 + 4 * hash(seed, gi * 7 + j, 4)
      const x = g.x + Math.cos(a) * r
      const z = g.z + Math.sin(a) * r
      if (dry(x, z)) out.push(make('crawler', x, z, 200 + gi * 7 + j))
    }
  })
  // Striders: the shallows, where the water is a few decimetres deep. A group of three and a pair, each within a few metres.
  const wade: { x: number; z: number }[] = []
  for (let k = 0; k < 6000 && wade.length < 2; k += 1) {
    const x = (hash(seed, k, 11) - 0.5) * 3200
    const z = (hash(seed, k, 12) - 0.5) * 3200
    const d = world.water.depthAt(x, z)
    if (inside(x, z) && d > 0.12 && d < 0.4 && wade.every((w) => Math.hypot(w.x - x, w.z - z) > 250)) wade.push({ x, z })
  }
  wade.forEach((w, i) => {
    let placed = 0
    const want = i === 0 ? 3 : 2
    out.push(make('strider', w.x, w.z, 400 + i * 5))
    placed += 1
    for (let j = 0; j < 40 && placed < want; j += 1) {
      const a = hash(seed, i * 50 + j, 13) * 6.283
      const r = 4 + 6 * hash(seed, i * 50 + j, 14)
      const x = w.x + Math.cos(a) * r
      const z = w.z + Math.sin(a) * r
      const d = world.water.depthAt(x, z)
      if (d > 0.05 && d < 0.5) {
        out.push(make('strider', x, z, 400 + i * 5 + placed))
        placed += 1
      }
    }
  })
  // Gliders: over the woodland, near its edge (the stand field about half way between open and wooded); a pair shares each circuit.
  let homes = 0
  for (let k = 0; k < 4000 && homes < 2; k += 1) {
    const x = (hash(seed, k, 31) - 0.5) * 3200
    const z = (hash(seed, k, 32) - 0.5) * 3200
    if (!inside(x, z) || !dry(x, z)) continue
    const st = stand(seed, x, z)
    if (st > 0.4 && st < 0.7 && slope(x, z) < 0.5) {
      out.push(make('glider', x, z, 600 + homes * 3))
      out.push(make('glider', x, z, 600 + homes * 3 + 1))
      homes += 1
      k += 600
    }
  }
  return out
}

type Food = { x: number; z: number; id: PlantId }
/** The most animals the markers show. */
const MARKS = 128

type Live = {
  spec: Spec
  creature: Creature | null
  root: Group | null
  x: number
  z: number
  heading: number
  phase: number
  y: number
  /** 0 (hungry) to 1 (fed): what takes a creature out to feed, and back. */
  energy: number
  /** The finite state machine: where it is in rest, travel, forage, return; for how long; where it is going; and the place it rests. */
  fsm: 'rest' | 'travel' | 'forage' | 'return'
  t: number
  target: { x: number; z: number } | null
  rest: { x: number; z: number }
  /** Whether its resting place has been chosen from the habitat (until then it rests where it was placed). */
  settled: boolean
  stuck: number
  /** The side (+1 left, -1 right) a walker last stepped round an obstacle on, kept so it goes on round it rather than dithering; and how often it has re-planned this trip. */
  side?: number
  replans?: number
  lastGap: number
  /** Feeding: the plants of the patch it is working, the one it is at, and how long it has been at it. */
  food: Food[]
  bite: number
  /** Why it is doing what it does: set at each transition, shown on the panel; and what the feeding patch it set out for holds. */
  why: string
  patch: string
  /** Seconds until it next checks that its resting place still suits (the shadow moves). */
  check: number
  /** A glider's circuit: its centre, radius and direction, and its smoothed height. */
  circle: number
  /** A dweller's lift off the ground for its pose, and the pitch of its body along the slope (both eased): see the grounding in the frame loop. */
  lift: number
  pitch: number
  /** The guide's walk (Step 4): a fixed loop it follows over open ground, its centre, radius and the waypoint it is heading for; null otherwise. */
  loop: { x: number; z: number; r: number; k: number } | null
}

export function Creatures({ world, nav, root: archRoot }: { world: World; nav: MutableRefObject<Navigation>; root: RefObject<Group | null> }) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  // The creature camera's own state: where it looks, how it is turned about the creature and how far, and the smoothed heading it follows.
  const orb = useRef({ active: false, mode: 'off', az: 0, el: 0.35, dist: 8, target: new Vector3(), look: new Vector3(), pos: new Vector3(), since: 0, azRel: Math.PI + 0.5, lastHeading: 0, key: '', ty: 0, hold: new Vector3(), missing: 0 })
  const group = useRef<Group>(null)
  const lives = useRef<Live[] | null>(null)
  const input = useMemo<MotionInput>(() => ({ motion: 'idle', pace: 1, bank: 0 }), [])
  const tmpQ = useMemo(() => new Quaternion(), [])
  const info = useRef({ key: '', at: 0 })
  const clock = useRef(0)

  // Esc leaves a creature camera.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && creatureCam.get().mode !== 'off') creatureCam.setMode('off')
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  // Turning and zooming about a creature: drag to turn, wheel to zoom (the orbiting view's own wheel stands aside while a creature camera is on).
  useEffect(() => {
    const element = gl.domElement
    let down: { x: number; y: number } | null = null
    const press = (event: PointerEvent) => {
      if (creatureCam.get().mode === 'off' || event.button !== 0) return
      down = { x: event.clientX, y: event.clientY }
    }
    const move = (event: PointerEvent) => {
      if (!down) return
      const o = orb.current
      const dx = event.clientX - down.x
      const dy = event.clientY - down.y
      down = { x: event.clientX, y: event.clientY }
      if (creatureCam.get().mode === 'pov') return
      // The same turn as the orbit controls in Overview: a full turn for a drag of the view's height, dragging right swings the camera left about its target.
      const turn = (2 * Math.PI) / Math.max(200, element.clientHeight)
      o.azRel += dx * turn
      o.az += dx * turn
      o.el = Math.max(-0.15, Math.min(1.45, o.el + dy * turn))
    }
    const release = () => {
      down = null
    }
    const wheel = (event: WheelEvent) => {
      const mode = creatureCam.get().mode
      if (mode === 'off' || mode === 'pov') return
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 400 : 1
      const step = Math.max(-100, Math.min(100, event.deltaY * unit)) * (event.ctrlKey ? 0.012 : 0.0025)
      orb.current.dist = Math.max(0.8, Math.min(800, orb.current.dist * Math.exp(step)))
    }
    element.addEventListener('pointerdown', press)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', release)
    element.addEventListener('wheel', wheel, { passive: false })
    return () => {
      element.removeEventListener('pointerdown', press)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', release)
      element.removeEventListener('wheel', wheel)
    }
  }, [gl])

  useEffect(() => {
    const parent = group.current
    return () => {
      for (const l of lives.current ?? []) {
        l.creature?.dispose()
        if (l.root && parent) parent.remove(l.root)
      }
      lives.current = null
    }
  }, [world])

  // Before everything else in the frame (priority -1): the creature camera moves the camera here, so the terrain, the plants and the shadows, which read the
  // camera in their own frame callbacks, all stream and cull for the pose that is drawn this frame, not the one before it.
  // Markers (loading.ts › creatureMarks, a page's choice; off by default): each animal as a small fixed-size dot where it is, so the population can be
  // seen from far off, where the bodies themselves are under a pixel. Drawn only while asked for; the creatures themselves are untouched.
  const marks = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(MARKS * 3), 3))
    g.setDrawRange(0, 0)
    const p = new Points(g, new PointsMaterial({ color: '#ff3b2f', size: 3.5, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false }))
    p.frustumCulled = false
    p.renderOrder = 5
    p.visible = false
    return p
  }, [])
  useEffect(
    () => () => {
      marks.geometry.dispose()
      ;(marks.material as PointsMaterial).dispose()
    },
    [marks],
  )
  useFrame(() => {
    const all = lives.current
    marks.visible = loading.creatureMarks && !!all
    if (!marks.visible || !all) return
    const at = marks.geometry.getAttribute('position') as BufferAttribute
    const n = Math.min(MARKS, all.length)
    for (let i = 0; i < n; i += 1) at.setXYZ(i, all[i]!.x, all[i]!.y + 4, all[i]!.z)
    const one = all.find((l) => l.spec.kind === 'dweller') ?? all[0]
    if (one) Object.assign(creatureSpot, { x: one.x, y: one.y, z: one.z, valid: true })
    at.needsUpdate = true
    marks.geometry.setDrawRange(0, n)
  })

  useFrame((_, delta) => {
    const parent = group.current
    if (!parent) return
    resetHabitat(world)
    const count = currentPopulation()?.organisms.length ?? 0
    if (!lives.current && shared.island && count > 0) {
      lives.current = populate(world).map((spec) => ({
        spec,
        creature: null,
        root: null,
        x: spec.x,
        z: spec.z,
        heading: hash(spec.seed, 1, 1) * 6.283,
        phase: hash(spec.seed, 2, 2) * 6.283,
        y: landscapeHeight(spec.x, spec.z) + (spec.kind === 'glider' ? 22 : 0),
        energy: 0.45 + 0.45 * hash(spec.seed, 3, 3),
        fsm: 'rest' as const,
        t: 0,
        target: null,
        rest: { x: spec.x, z: spec.z },
        settled: spec.kind !== 'dweller' && spec.kind !== 'crawler',
        stuck: 0,
        lastGap: 1e9,
        food: [],
        bite: 0,
        why: '',
        patch: '',
        check: 0,
        circle: hash(spec.seed, 5, 5) * 6.283,
        lift: 0,
        pitch: 0,
        loop: null,
      }))
      const counts = { dweller: 0, crawler: 0, strider: 0, glider: 0 }
      const homes: Record<Kind, string[]> = { dweller: [], crawler: [], strider: [], glider: [] }
      for (const l of lives.current) {
        counts[l.spec.kind] += 1
        homes[l.spec.kind].push(l.spec.home)
      }
      creatureCam.setCounts(counts, homes)
    }
    const all = lives.current
    if (!all) return
    const now = performance.now() / 1000
    // THE GUIDE'S WALK (Step 4): while a walkthrough asks for it, the chosen Dweller walks a fixed loop over open, level ground beside its structure, at its
    // own gait, so its walk can be watched; when the walkthrough moves on it goes back to its ordinary life (to its resting place).
    const cue = creatureCam.get()
    const asked = all.filter((l) => l.spec.kind === cue.species)[cue.index]
    for (const l of all) {
      if (l.loop && (!cue.patrol || l !== asked)) {
        l.loop = null
        go(l, 'return', `Back to ${l.spec.home ? `the shelter of ${l.spec.home}` : 'its resting place'}`, l.rest)
      }
    }
    if (cue.patrol && asked?.spec.kind === 'dweller' && asked.creature && !asked.loop && habitatAt(asked.spec.ox, asked.spec.oz).known) {
      const site = loopSite(asked, { world, all })
      if (site) {
        asked.loop = { ...site, k: 1 }
        asked.x = site.x + site.r
        asked.z = site.z
        asked.heading = Math.PI / 2
        asked.energy = Math.max(asked.energy, 0.75)
        go(asked, 'travel', `Walking a set loop beside ${asked.spec.home} for this demonstration`)
      }
    }
    // The habitat a creature reads: its structure and the ground it ranges over (dweller), its patch of litter (crawler).
    for (const l of all) {
      if (l.spec.kind === 'dweller') requestHabitat(l.spec.ox, l.spec.oz, l.spec.or + RHYTHM.dweller.range)
      else if (l.spec.kind === 'crawler') requestHabitat(l.spec.x, l.spec.z, 20)
    }
    updateHabitat(archRoot.current, now)
    const dt = Math.min(delta, 0.05)
    // The glider's circuit runs on the same clamped step as its wing animation and the camera's smoothing, so after a slow frame its body does not jump
    // farther than its animation and the camera expect (a visible hitch in flight).
    clock.current += dt
    const daylight = environment.state.sun.daylight
    const cc = creatureCam.get()
    const chosen = all.filter((l) => l.spec.kind === cc.species)[cc.index] ?? null
    let built = all.filter((l) => l.creature).length
    let buildNow = 1
    let chosenInfo: CreatureInfo | null = null
    // Where each animal is (by species, in the creature camera's own index order), refreshed about twice a second, for pages that frame one.
    if (now - placesAt > 0.5) {
      placesAt = now
      const next: Record<string, { x: number; z: number; fsm: string }[]> = {}
      for (const l of all) (next[l.spec.kind] ??= []).push({ x: l.x, z: l.z, fsm: l.spec.kind === 'glider' ? 'glide' : l.fsm })
      Object.assign(creaturePlaces, next)
    }
    for (const l of all) {
      const forced = l === chosen && cc.mode !== 'off'
      // A glider's place is a function of time, kept up whether or not it is drawn, so it is never found where it was last seen.
      if (l.spec.kind === 'glider') fly(l, clock.current, dt)
      const d = forced || l === chosen ? 0 : Math.hypot(l.x - camera.position.x, l.z - camera.position.z)
      if (d > BUILD_RANGE) {
        if (l.root) l.root.visible = false
        continue
      }
      if (!l.creature) {
        // The cap never keeps the creature a camera is on from being built.
        // (While the camera follows an animal, a new body is not built on a frame that is already slow: each build takes about 13 ms, and a fast flier
        // keeps bringing new ones into range, which showed as a regular hitch in its flight. They are built on the next quick frame instead.)
        if (!forced && (buildNow <= 0 || built >= MAX_BUILT || (cc.mode !== 'off' && delta > 0.019))) continue
        buildNow -= 1
        built += 1
        const p: CreatureParams = { seed: l.spec.seed, age: l.spec.age, condition: 0.7, mineral: 0.4, habitat: l.spec.kind === 'strider' ? 0.35 : 0.5 }
        l.creature = { dweller: buildDweller, glider: buildGlider, strider: buildStrider, crawler: buildCrawler }[l.spec.kind](p)
        if (l.spec.kind === 'dweller') paleHide(l.creature)
        styleCreature(l.creature)
        l.root = l.creature.root
        parent.add(l.root)
      }
      const root = l.root!
      // The glider is away at night: nothing to draw.
      const away = l.spec.kind === 'glider' && daylight < 0.12 && !forced
      root.visible = !away && !(forced && cc.mode === 'pov')
      if (l.spec.kind === 'glider') {
        root.position.set(l.x, l.y, l.z)
        root.rotation.y = -l.heading
      }
      // Beyond the nearer range a creature keeps the pose it last had; the one the camera is on is always animated.
      if (away || (d > ANIMATE_RANGE && !forced)) continue
      const stateInfo = l.spec.kind === 'glider' ? glide(l, dt, daylight, input, world.seed) : step(l, dt, daylight, all, world, input)
      if (l.spec.kind !== 'glider') {
        // On the surface that is drawn (terrainMesh.ts), so it neither floats over a swell nor sinks into a hollow between the terrain's lattice points.
        l.y = drawnHeight(l.x, l.z)
        if (l.spec.kind === 'dweller') {
          // The Lab's dweller drops its chest and head below the plane of its feet as it crouches to rest (by about a fifth of its height), and the island's
          // ground is not flat: so it is lifted by its pose (eased as the pose is) and its body follows the slope under it, nose to tail, and neither the
          // resting head nor a walking paw goes into the ground.
          const h = l.creature!.size.height || 0.54
          const want = (input.motion === 'crouch' ? 0.2 : input.motion === 'walk' ? 0.03 : 0.08) * h
          l.lift += (want - l.lift) * (1 - Math.exp(-dt * 2.6))
          const half = (l.creature!.size.length || 1.6) * 0.4
          const ax = Math.cos(l.heading)
          const az = Math.sin(l.heading)
          const slope = Math.atan2(drawnHeight(l.x + ax * half, l.z + az * half) - drawnHeight(l.x - ax * half, l.z - az * half), 2 * half)
          l.pitch += (slope - l.pitch) * (1 - Math.exp(-dt * 4))
        }
        root.position.set(l.x, l.y + l.lift, l.z)
        root.rotation.set(0, -l.heading, l.pitch)
      }
      if (l === chosen) chosenInfo = stateInfo
    }
    // The panel's lines, when they change (and the energy figure at most twice a second).
    if (chosenInfo) {
      const key = `${chosenInfo.state}|${chosenInfo.why}|${chosenInfo.habitat}|${chosenInfo.detail}`
      if (key !== info.current.key && now - info.current.at > 0.5) {
        info.current = { key, at: now }
        creatureCam.setInfo(chosenInfo)
      }
    }
    trackCamera(chosen, cc.mode, dt)
  }, -1)

  /** The camera on the chosen creature. Locate frames it and lets the user turn and zoom about it; Follow keeps behind it; POV looks out of its head. */
  const trackCamera = (chosen: Live | null, mode: string, dt: number) => {
    const o = orb.current
    // A creature camera with no animal to be on (not built yet, away for the night) for a moment lets go by itself: while it is on, the rig and the
    // orbit stand aside, so the view was frozen with no way back but its own control. (Round 19.)
    if (mode !== 'off' && (!chosen || !chosen.creature || !chosen.root || (!chosen.root.visible && mode !== 'pov'))) {
      o.missing = (o.missing ?? 0) + dt
      if (o.missing > 1.5) {
        o.missing = 0
        creatureCam.setMode('off')
      }
    } else o.missing = 0
    if (mode === 'off' || !chosen || !chosen.creature || !chosen.root) {
      // (Released: whatever was waiting on the hand-back may set its view now, creatureCam.ts › creatureRelease. Cleared once the pose below is
      // handed back, or at once if the camera was never on an animal.)
      if (!o.active) creatureRelease.pending = false
      if (o.active) {
        creatureRelease.pending = false
        // Back to ordinary navigation from exactly where the camera is: the orbiting view takes up from this pose.
        o.active = false
        nav.current.view = { position: [camera.position.x, camera.position.y, camera.position.z], target: [o.look.x, o.look.y, o.look.z] }
      }
      return
    }
    const c = chosen.creature
    const glider = chosen.spec.kind === 'glider'
    const size = Math.max(c.size.length || 0, c.size.span || 0, c.size.height || 0, 0.3)
    const hgt = c.size.height || 0.4
    const base = new Vector3(chosen.x, chosen.y, chosen.z)
    if (!o.active || o.mode !== mode) {
      // Framing: the Lab gives each individual the point to look at and how far back to stand (its `frame`), seen from behind, a little to the side and
      // above (a glider from farther back). The camera goes there from where it is, in an arc.
      o.active = true
      o.mode = mode
      o.since = 0
      o.hold.set(Number.NaN, 0, 0)
      o.dist = Math.max(1.6, Math.min(120, (c.frame.distance || size * 3.6) * (glider ? 1.25 : 1.0)))
      o.el = glider ? 0.22 : 0.38
      // A walkthrough can ask for a wider, higher view (over the plants an animal rests among).
      const framing = creatureCam.get().framing
      if (framing) {
        o.dist *= framing.scale
        o.el = framing.elevation
        // From the open side: the camera stands beyond the animal from its structure, looking past it at the structure (not down through its roof).
        if (framing.awayFromHome && chosen.spec.or > 0) o.az = Math.atan2(chosen.z - chosen.spec.oz, chosen.x - chosen.spec.ox)
      }
      o.azRel = Math.PI + 0.5
      o.az = chosen.heading + o.azRel
      o.lastHeading = chosen.heading
      o.pos.copy(camera.position)
      o.target.copy(base)
      o.look.copy(base)
      o.ty = base.y
    }
    o.since += dt
    creatureFocus.x = chosen.x
    creatureFocus.z = chosen.z
    // Where the body is: the Lab's own look-at point, turned with the creature's heading (a glider's body is well above its origin). Across the ground it is
    // tracked exactly (a glider moves metres a second); its height is smoothed a little, so the terrain's facets under a walking animal do not shake the view.
    const ft = c.frame.target
    const cs = Math.cos(-chosen.heading)
    const sn = Math.sin(-chosen.heading)
    o.ty += (base.y + ft[1] - o.ty) * (1 - Math.exp(-dt * (glider ? 30 : 8)))
    o.target.set(base.x + ft[0] * cs + ft[2] * sn, o.ty, base.z - ft[0] * sn + ft[2] * cs)
    if (mode === 'locate' && !glider) {
      // Locate holds the frame still, so an animal walking about is seen to walk: the frame is dragged only when it leaves a central zone (locked to it,
      // a walking animal stood still in the middle of the view while the ground slid by). A glider, which crosses the view in moments, is tracked exactly.
      if (Number.isNaN(o.hold.x)) o.hold.copy(o.target)
      const zone = Math.max(0.6, o.dist * 0.22)
      const ox = o.target.x - o.hold.x
      const oz = o.target.z - o.hold.z
      const off = Math.hypot(ox, oz)
      if (off > zone) {
        o.hold.x += ox * (1 - zone / off)
        o.hold.z += oz * (1 - zone / off)
      }
      o.hold.y = o.target.y
      o.target.copy(o.hold)
    }
    let want: Vector3
    if (mode === 'pov') {
      // The eye is the head: its bone's place this frame (the root has just moved, so its matrices are brought up to date first), and the way the head points.
      chosen.root.updateMatrixWorld(true)
      const head = c.skeleton.bones.find((b) => b.name === 'head' || b.name.startsWith('head'))
      const eye = new Vector3()
      const dir = new Vector3(Math.cos(chosen.heading), 0, Math.sin(chosen.heading))
      if (head) {
        head.getWorldPosition(eye)
        head.getWorldQuaternion(tmpQ)
        const pointing = new Vector3(1, 0, 0).applyQuaternion(tmpQ)
        if (Math.hypot(pointing.x, pointing.z) > 0.5) dir.copy(pointing).normalize()
      } else eye.set(base.x, base.y + hgt * 0.9, base.z)
      eye.addScaledVector(dir, 0.06 * size)
      want = eye
      const aim = new Vector3(eye.x + dir.x * 10, eye.y + dir.y * 10 - 0.4, eye.z + dir.z * 10)
      o.pos.lerp(want, 1 - Math.exp(-dt * (o.since < 1 ? 3 : 18)))
      o.look.lerp(aim, 1 - Math.exp(-dt * (o.since < 1 ? 3 : 14)))
      camera.near = 0.04
    } else {
      if (mode === 'follow') {
        // Behind it, turning with it: the camera's heading eases after the animal's, so a turn on the spot swings the view round smoothly, not in a snap.
        let turn = chosen.heading - o.lastHeading
        turn = Math.atan2(Math.sin(turn), Math.cos(turn))
        const take = turn * (1 - Math.exp(-dt * (glider ? 6 : 2.5)))
        o.az += take
        o.lastHeading += take
      } else o.lastHeading = chosen.heading
      const ce = Math.cos(o.el)
      want = new Vector3(o.target.x + Math.cos(o.az) * ce * o.dist, o.target.y + Math.sin(o.el) * o.dist, o.target.z + Math.sin(o.az) * ce * o.dist)
      // From far, the camera arcs in over the ground between; near, it is held to its place stiffly, so a creature on the move does not leave the centre or shake.
      const gap = o.pos.distanceTo(want)
      const arriving = o.since < 4 && gap > 12
      const lift = arriving ? Math.min(260, Math.max(0, gap - 30) * 0.3) : 0
      const rate = arriving ? 2.6 : 22
      o.pos.lerp(new Vector3(want.x, want.y + lift, want.z), 1 - Math.exp(-dt * rate))
      o.look.copy(o.target)
      camera.near = Math.max(0.05, Math.min(5, o.dist * 0.02))
    }
    // The only obstruction: the ground itself (below it, the terrain's inside). Trees, plants and structures are never in the way.
    o.pos.y = Math.max(o.pos.y, landscapeHeight(o.pos.x, o.pos.z) + (mode === 'pov' ? 0.1 : 0.4))
    camera.far = 24000
    camera.up.set(0, 1, 0)
    camera.position.copy(o.pos)
    camera.lookAt(o.look)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
  }

  return (
    <>
      <group ref={group} />
      <primitive object={marks} />
    </>
  )
}

// (paleHide and styleCreature: worldMaterials.ts, shared with the Creature Lab's World look.)

// ------------------------------------------------------------------------------------------------------------------- the glider

/**
 * The glider's circuit, as a function of time: a circle about its home over the woodland edge, at its own radius, direction and pace, so its heading turns
 * evenly. Its height follows the ground smoothly (the mean ground under a stretch of the circuit, eased), never the terrain's every swell, which made it, and
 * a camera locked to it, bounce at the terrain's own small scale.
 */
/** The circuit is the pair's (from their shared home); each keeps its own place on it, a little apart. */
const circuitRadius = (l: Live) => 70 + 50 * hash(l.spec.x, l.spec.z, 8)

function fly(l: Live, time: number, dt: number) {
  const R = circuitRadius(l)
  const dir = hash(l.spec.x, l.spec.z, 9) > 0.5 ? 1 : -1
  const v = 8.5
  const lag = 0.25 + 0.5 * hash(l.spec.seed, 5, 5)
  l.circle = hash(l.spec.x, l.spec.z, 5) * 6.283 + (dir * v * time) / R - lag
  l.x = l.spec.x + Math.cos(l.circle) * R
  l.z = l.spec.z + Math.sin(l.circle) * R
  l.heading = l.circle + (dir * Math.PI) / 2
  // Ground ahead and around, averaged over about forty metres: the height it keeps above is that, plus the canopy and a slow rise and fall.
  const ax = Math.cos(l.heading)
  const az = Math.sin(l.heading)
  let g = 0
  for (const s of [-20, 0, 20, 40]) g += landscapeHeight(l.x + ax * s, l.z + az * s)
  g /= 4
  const want = g + 21 + 3 * Math.sin(time * 0.21 + l.spec.seed)
  l.y += (want - l.y) * (1 - Math.exp(-dt * 0.8))
}

function glide(l: Live, dt: number, daylight: number, input: MotionInput, seed: number): CreatureInfo {
  const c = l.creature!
  input.motion = 'glide'
  input.pace = 0.9
  input.bank = 18
  input.water = undefined
  input.feed = undefined
  c.update(dt, input)
  const R = circuitRadius(l)
  const alt = Math.round(l.y - landscapeHeight(l.x, l.z))
  const dusk = daylight < 0.45
  return {
    species: 'Veil Glider',
    stage: stageName(l.spec.age),
    state: dusk ? 'Hawking insects low over the woodland edge' : 'Gliding its circuit over the canopy',
    why: `Daylight ${pct(daylight)}: on the wing by day and at dusk, when insects rise along the edge where wood meets open ground; away at night`,
    habitat: `Woodland edge (stand ${pct(stand(seed, l.x, l.z))} wooded here) · ${alt} m above the ground`,
    detail: `Wingspan ${c.size.span.toFixed(2)} m · circuit ${Math.round(R * 2)} m across at 8.5 m/s`,
  }
}

// ------------------------------------------------------------------------------------------------------------------- the walkers

type Ctx = { world: World; all: Live[] }

/** Whether a creature of this kind can stand at a point: water it avoids, the structure's solid footprint, a roof too low, a cliff. */
function standable(kind: Kind, x: number, z: number, world: World, height: number): boolean {
  const depth = world.water.depthAt(x, z)
  if (kind === 'strider' ? depth > 0.6 : depth > 0.04) return false
  if (kind !== 'strider') {
    const h = habitatAt(x, z)
    if (h.known ? h.footprint > 0 || h.ceiling < height + 0.25 : false) return false
    // Before the habitat is read, keep out of the middle of a structure.
    if (!h.known) for (const o of currentPopulation()?.organisms ?? []) if (Math.hypot(x - o.x, z - o.z) < o.radius * 0.55) return false
    // A tree's trunk is solid: no step may end within it (the body's own half-width counted), so the side-steps in walk() steer round it and a
    // straight way (open) through a stand of trees is not taken as clear.
    const body = kind === 'crawler' ? 0.22 : 0.45
    for (const t of trunksNear(x, z)) if (Math.hypot(x - t.x, z - t.z) < t.r + body) return false
  }
  return Math.abs(landscapeHeight(x + 1.5, z) - landscapeHeight(x - 1.5, z)) + Math.abs(landscapeHeight(x, z + 1.5) - landscapeHeight(x, z - 1.5)) < 2.4
}

/** Whether a straight walk from one point to another is open, sampled every metre and a half. A strider keeps to the water's edge and the shallows. */
function open(kind: Kind, ax: number, az: number, bx: number, bz: number, world: World, height: number): boolean {
  const len = Math.hypot(bx - ax, bz - az)
  const n = Math.max(1, Math.ceil(len / 1.5))
  let dry = 0
  for (let i = 1; i <= n; i += 1) {
    const x = ax + ((bx - ax) * i) / n
    const z = az + ((bz - az) * i) / n
    if (!standable(kind, x, z, world, height)) return false
    if (kind === 'strider' && world.water.depthAt(x, z) <= 0.02) dry += 1
  }
  return kind !== 'strider' || dry <= Math.max(1, n * 0.25)
}

const heightOf = (l: Live) => l.creature?.size.height ?? 0.5

/**
 * The dweller's resting place: of the ground around its structure, where it is roofed (shelter) or in the structure's shadow now, by day; where it is
 * roofed or shaded most of the day, by night. Not on the footprint, not under a roof too low for it, not where the other of its pair lies, and only where it
 * can walk to. Returns the place and the habitat there, or null before the habitat has been read.
 */
function chooseShelter(l: Live, ctx: Ctx, day: boolean, awayFrom = 0): { x: number; z: number; score: number; now: number } | null {
  const { ox, oz, or } = l.spec
  if (!habitatAt(ox, oz).known) return null
  const h0 = heightOf(l)
  const found: { x: number; z: number; score: number; now: number }[] = []
  const others = ctx.all.filter((o) => o !== l && o.spec.kind === 'dweller' && o.spec.home === l.spec.home)
  for (let ring = 0; ring < 8; ring += 1) {
    const r = or * 0.35 + ring * Math.max(2, (or * 0.75 + 10) / 8)
    const count = 10 + ring * 3
    for (let k = 0; k < count; k += 1) {
      const a = (k / count) * 6.283 + ring * 0.37
      const x = ox + Math.cos(a) * r
      const z = oz + Math.sin(a) * r
      if (!standable('dweller', x, z, ctx.world, h0)) continue
      if (awayFrom > 0 && Math.hypot(x - l.x, z - l.z) < awayFrom) continue
      const h = habitatAt(x, z)
      // By day the shadow of the moment matters most (it has to be out of the sun now); a roof is best at any hour.
      let score = day ? 1.3 * h.now + 0.9 * h.shelter + 0.35 * h.shade : 1.1 * h.shelter + 0.8 * h.shade
      score -= 0.012 * Math.hypot(x - l.x, z - l.z)
      for (const o of others) if (Math.hypot(o.rest.x - x, o.rest.z - z) < RHYTHM.dweller.gap + 0.8) score -= 2
      found.push({ x, z, score, now: h.now })
    }
  }
  // The best it can walk to.
  found.sort((a, b) => b.score - a.score)
  for (let k = 0; k < Math.min(found.length, 30); k += 1) if (open('dweller', l.x, l.z, found[k]!.x, found[k]!.z, ctx.world, h0)) return found[k]!
  return null
}

/** The share of an animal's body in the structure's shadow of this moment: its nose, middle and tail, lying along `heading`. */
function bodyShade(x: number, z: number, heading: number, length: number): number {
  const hx = Math.cos(heading)
  const hz = Math.sin(heading)
  let sum = 0
  for (const t of [0.45, 0, -0.55]) sum += habitatAt(x + hx * length * t, z + hz * length * t).now
  return sum / 3
}

/**
 * Where the guide's walk loops: of the open ground around the Dweller's structure, the first place (in a fixed order, so the same every time) with a level
 * circle of about six metres it can walk all the way round: every point standable, dry, out of the structure's shadow of this moment, the ground varying by
 * under two metres. Null if there is none.
 */
function loopSite(l: Live, ctx: Ctx): { x: number; z: number; r: number } | null {
  const { ox, oz, or } = l.spec
  const h0 = heightOf(l)
  for (const r of [6, 4.5]) {
    for (let ring = 0; ring < 6; ring += 1) {
      const d = or + 12 + ring * 6
      for (let k = 0; k < 16; k += 1) {
        const a = (k / 16) * 6.283
        const x = ox + Math.cos(a) * d
        const z = oz + Math.sin(a) * d
        let lo = Infinity
        let hi = -Infinity
        let ok = true
        for (let w = 0; w < 12 && ok; w += 1) {
          const b = (w / 12) * 6.283
          const px = x + Math.cos(b) * r
          const pz = z + Math.sin(b) * r
          if (!standable('dweller', px, pz, ctx.world, h0) || habitatAt(px, pz).now > 0.15) ok = false
          const g = drawnHeight(px, pz)
          lo = Math.min(lo, g)
          hi = Math.max(hi, g)
        }
        if (ok && hi - lo < 2) return { x, z, r }
      }
    }
  }
  return null
}

/** The crawler's resting place: of the ground within a few metres of where it lives, the most covered (canopy over it, the structure's shade) and dampest. */
function chooseLitter(l: Live, ctx: Ctx, now = false): { x: number; z: number } {
  const island = shared.island
  const at = island ? islandAt(island) : null
  let best = { x: l.spec.x, z: l.spec.z }
  let bestScore = -1e9
  for (let k = 0; k < 9; k += 1) {
    const a = hash(l.spec.seed, 31, k) * 6.283
    const r = k === 0 ? 0 : 1 + 5 * hash(l.spec.seed, 32, k)
    const x = l.spec.x + Math.cos(a) * r
    const z = l.spec.z + Math.sin(a) * r
    if (!standable('crawler', x, z, ctx.world, 0.15)) continue
    const c = at ? at(x, z, landscapeHeight(x, z)) : null
    // (`now`: the cover from the sun of this moment counts too, a structure's shadow where it falls now, so a crawler the sun has found picks the litter in
    // shade at this hour, not the same spot as before.)
    const score = canopyAt(x, z) + 0.8 * habitatAt(x, z).shade + (now ? 1.2 * habitatAt(x, z).now : 0) + (c ? c.moisture - 0.4 * c.light : 0)
    if (score > bestScore) {
      bestScore = score
      best = { x, z }
    }
  }
  return best
}

/** How much the crowns of trees and shrubs within a few metres cover the ground, 0 to 0.85: read from the very plants drawn there. */
const canopyCache = new Map<string, number>()
function canopyAt(x: number, z: number): number {
  const key = `${Math.round(x)},${Math.round(z)},${Math.floor(environment.controls.year / 10)}`
  let v = canopyCache.get(key)
  if (v === undefined) {
    const near = foodNear(x, z, 4.5, CANOPY)
    v = Math.min(0.85, near.reduce((s, p) => s + (p.id === 'veil' || p.id === 'flood' || p.id === 'stilts' ? 0.45 : 0.22) * Math.min(1.4, p.s), 0))
    if (canopyCache.size > 400) canopyCache.clear()
    canopyCache.set(key, v)
  }
  return v
}

/**
 * A feeding place: of a dozen candidates about where it rests, the best it can walk to. A dweller or a crawler goes where its food plants actually stand
 * (the drawn plants, from the same placement), in damp, shaded ground; a strider to a shallow of the right depth along the shore. Returns the place and the
 * plants it will feed on there (an empty list for a strider, which feeds in the water itself), or null if none is open.
 */
function chooseFeeding(l: Live, ctx: Ctx): { x: number; z: number; food: Food[]; why: string } | null {
  const kind = l.spec.kind as Exclude<Kind, 'glider'>
  const range = RHYTHM[kind].range
  const island = shared.island
  const at = island ? islandAt(island) : null
  const h0 = heightOf(l)
  let best: { x: number; z: number; food: Food[]; why: string } | null = null
  let bestScore = -1e9
  const salt = Math.floor(l.phase * 7) + Math.floor(l.energy * 100)
  for (let k = 0; k < 12; k += 1) {
    const a = hash(l.spec.seed, salt, 100 + k) * 6.283
    const r = (0.3 + 0.7 * hash(l.spec.seed, salt, 120 + k)) * range
    const cx = kind === 'dweller' ? l.spec.ox : l.rest.x
    const cz = kind === 'dweller' ? l.spec.oz : l.rest.z
    const x = cx + Math.cos(a) * (kind === 'dweller' ? l.spec.or + r : r)
    const z = cz + Math.sin(a) * (kind === 'dweller' ? l.spec.or + r : r)
    const depth = ctx.world.water.depthAt(x, z)
    let score: number
    let food: Food[] = []
    let why = ''
    if (kind === 'strider') {
      if (depth < 0.08 || depth > 0.45) continue
      score = 1 - Math.abs(depth - 0.22) * 2 - Math.hypot(x - l.x, z - l.z) / (range * 2) + 0.3 * hash(l.spec.seed, salt, 140 + k)
      why = `a shallow ${depth.toFixed(2)} m deep, where it can probe the bed`
    } else {
      if (!standable(kind, x, z, ctx.world, h0)) continue
      const c = at ? at(x, z, landscapeHeight(x, z)) : null
      const hab = habitatAt(x, z)
      food = foodNear(x, z, kind === 'dweller' ? 6 : 3.5, kind === 'dweller' ? DWELLER_FOOD : CRAWLER_FOOD)
        .filter((p) => standable(kind, p.x, p.z, ctx.world, h0))
        .map((p) => ({ x: p.x, z: p.z, id: p.id }))
      if (food.length === 0) continue
      score = Math.min(1.2, food.length * 0.12) + (c ? c.moisture : 0.5) + 0.7 * hab.shade - (c ? 0.3 * c.light : 0) - Math.hypot(x - l.x, z - l.z) / (range * 2.5)
      const names = [...new Set(food.map((p) => (p.id === 'ground' ? 'ground mat' : p.id)))].join(', ')
      why = `${food.length} ${names} plants on damp${hab.shade > 0.15 ? `, ${pct(hab.shade)} architecture-shaded` : ''} ground`
    }
    if (score > bestScore && open(kind, l.x, l.z, x, z, ctx.world, h0)) {
      bestScore = score
      best = { x, z, food, why }
    }
  }
  if (best && best.food.length > 0) {
    // Graze them nearest-first from where it arrives: a short walk from plant to plant, not back and forth.
    const rest = [...best.food]
    const order: Food[] = []
    let px = best.x
    let pz = best.z
    while (rest.length > 0 && order.length < 8) {
      let bi = 0
      for (let i = 1; i < rest.length; i += 1) if (Math.hypot(rest[i]!.x - px, rest[i]!.z - pz) < Math.hypot(rest[bi]!.x - px, rest[bi]!.z - pz)) bi = i
      const f = rest.splice(bi, 1)[0]!
      order.push(f)
      px = f.x
      pz = f.z
    }
    best.food = order
  }
  return best
}

/** Changes state: the time in it starts again and the reason is kept for the panel. */
function go(l: Live, fsm: Live['fsm'], why: string, target: { x: number; z: number } | null = null) {
  l.fsm = fsm
  l.t = 0
  l.why = why
  l.target = target
  l.stuck = 0
  l.lastGap = 1e9
}

/** One creature's moment: its state by what it senses, one step of its gait, and where that takes it. Returns what the panel shows. */
function step(l: Live, dt: number, daylight: number, all: Live[], world: World, input: MotionInput): CreatureInfo {
  const kind = l.spec.kind as Exclude<Kind, 'glider'>
  const rhythm = RHYTHM[kind]
  const c = l.creature!
  const ctx: Ctx = { world, all }
  l.phase += dt
  l.t += dt
  l.check -= dt
  input.pace = 0.9
  input.bank = 0
  input.water = undefined
  input.feed = undefined
  const day = daylight > 0.45
  const direct = environment.state.sun.direct
  const here = habitatAt(l.x, l.z)

  // Settling: the resting place is chosen from the habitat once it is known (the structure's roof and shadow; the crawler's litter).
  if (!l.settled && l.fsm === 'rest') {
    if (kind === 'dweller') {
      const s = chooseShelter(l, ctx, day)
      if (s) {
        l.settled = true
        l.rest = { x: s.x, z: s.z }
        l.check = 8
        if (Math.hypot(s.x - l.x, s.z - l.z) > 1) go(l, 'return', day ? `It goes to lie up where ${l.spec.home} roofs or shades the ground` : `It goes to the hollow under ${l.spec.home}`, l.rest)
      }
    } else if (kind === 'crawler' && shared.island) {
      l.settled = true
      l.rest = chooseLitter(l, ctx)
      if (Math.hypot(l.rest.x - l.x, l.rest.z - l.z) > 0.6) go(l, 'return', 'It goes to the most covered litter near by', l.rest)
    }
  }

  // The guide's walk: round its loop from waypoint to waypoint at its walking gait, nothing else (see the frame loop); the card says just that.
  if (l.loop) {
    const L = l.loop
    const a = (L.k / 12) * 6.283
    const tx = L.x + Math.cos(a) * L.r
    const tz = L.z + Math.sin(a) * L.r
    if (Math.hypot(tx - l.x, tz - l.z) < 1.2) L.k = (L.k + 1) % 12
    l.target = { x: tx, z: tz }
    input.motion = 'walk'
    const gait = c.update(dt, input)
    walk(l, gait.speed, dt, ctx)
    return {
      species: 'Hollow Dweller',
      stage: stageName(l.spec.age),
      state: 'Walking a loop',
      why: l.why,
      habitat: `Open, level ground beside ${l.spec.home}`,
      detail: `Walking at ${gait.speed.toFixed(2)} m/s · ${(c.size.length || 1.6).toFixed(2)} m long, ${(c.size.height || 0.54).toFixed(2)} m tall`,
    }
  }

  // The sun on the ground it is on: the sun that gets through the cloud, less what the canopy over it and a structure's shadow of the moment take.
  const canopy = kind === 'crawler' ? canopyAt(l.x, l.z) : 0
  const sunOnGround = direct * (1 - canopy) * (1 - 0.9 * here.now)
  let motion: MotionInput['motion'] = 'idle'
  let moving = false

  switch (l.fsm) {
    case 'rest': {
      // Resting costs little: a fed animal lies up for several minutes of observation before hunger takes it out by day.
      l.energy = Math.max(0, l.energy - 0.0009 * dt)
      const hungry = l.energy < 0.3
      if (kind === 'dweller') {
        // (It lies down only once it has its resting place: until the habitat is known and the place chosen it stands, alert, never lying up in the
        // open where it happened to start.)
        motion = l.settled ? 'crouch' : 'idle'
        // By day it checks every few seconds that the shadow still covers it; the sun moves it round its structure.
        if (day && l.settled && l.check <= 0) {
          l.check = 8
          if (habitatAt(l.rest.x, l.rest.z).now < 0.4) {
            const s = chooseShelter(l, ctx, true)
            if (s && s.now > 0.5 && Math.hypot(s.x - l.rest.x, s.z - l.rest.z) > 2) {
              l.rest = { x: s.x, z: s.z }
              go(l, 'return', `The sun has moved its shadow off its resting place: it moves round ${l.spec.home} into the shade again`, l.rest)
              break
            }
          }
        }
        const out = !day || hungry
        if (out && l.t > rhythm.rest) {
          const f = chooseFeeding(l, ctx)
          if (f) {
            l.food = f.food
            l.bite = 0
            l.patch = f.why
            go(l, 'travel', day ? `Hungry (energy ${pct(l.energy)}) though it is day: it goes out to ${f.why}` : `Daylight ${pct(daylight)}: dusk and night are when it feeds. It goes out to ${f.why}`, f)
          } else l.t = rhythm.rest * 0.6
        }
      } else if (kind === 'crawler') {
        // In the sun it rolls up where it lies; in shade it rests in the litter and goes out to root when hungry and its ground is shaded.
        motion = sunOnGround > 0.45 ? 'curl' : 'idle'
        // The sun has found its litter: it does not stay curled in the open if covered litter is near; it shuffles there first, and rests on arrival.
        if (l.settled && sunOnGround > 0.5 && l.check <= 0) {
          l.check = 6
          const cover = chooseLitter(l, ctx, true)
          if (Math.hypot(cover.x - l.x, cover.z - l.z) > 0.6 && habitatAt(cover.x, cover.z).now > habitatAt(l.x, l.z).now + 0.2) {
            l.rest = cover
            go(l, 'return', `The sun has reached its litter (${pct(sunOnGround)}): it shuffles into cover before resting`, l.rest)
            break
          }
        }
        if (sunOnGround < 0.35 && l.energy < 0.8 && l.t > rhythm.rest) {
          const f = chooseFeeding(l, ctx)
          if (f) {
            l.food = f.food
            l.bite = 0
            l.patch = f.why
            go(l, 'travel', `Its ground is shaded (sun on it ${pct(sunOnGround)}) and it is hungry (${pct(l.energy)}): it shuffles to ${f.why}`, f)
          } else l.t = rhythm.rest * 0.6
        }
      } else {
        motion = 'stand'
        if (daylight > 0.15 && l.t > rhythm.rest + 8 * hash(l.spec.seed, Math.floor(l.phase / 40), 7)) {
          const f = chooseFeeding(l, ctx)
          if (f) {
            l.patch = f.why
            go(l, 'travel', `Daylight ${pct(daylight)}: it works the shore by day. It wades to ${f.why}`, f)
          }
          else l.t = rhythm.rest * 0.5
        }
      }
      break
    }
    case 'travel':
    case 'return': {
      const goal = l.target ?? l.rest
      motion = kind === 'strider' ? 'wade' : kind === 'crawler' ? 'scuttle' : 'walk'
      moving = true
      const gap = Math.hypot(goal.x - l.x, goal.z - l.z)
      if (gap > l.lastGap - 0.05) l.stuck += dt
      else l.stuck = 0
      l.lastGap = Math.min(l.lastGap, gap + 0.3)
      l.energy = Math.max(0, l.energy - 0.004 * dt)
      const arrive = kind === 'crawler' ? 0.35 : 0.9
      if (gap < arrive) {
        if (l.fsm === 'travel') {
          l.replans = 0
          go(l, 'forage', `Feeding at ${l.patch}`)
        }
        else {
          // What it found there, said as it is: a dweller that could find no deep shade at its structure says so.
          const there = habitatAt(l.rest.x, l.rest.z)
          const shaded = there.shelter > 0 || there.now > 0.5
          go(l, 'rest', kind === 'dweller' ? (!day ? `Resting in the hollow of ${l.spec.home}` : shaded ? `Lying up out of the sun under ${l.spec.home}` : `No deep shade at ${l.spec.home} now: it rests where the shadow is best`) : kind === 'crawler' ? 'Back in its litter' : 'Standing in its shallow')
        }
      } else if (l.stuck > 3 || l.t > 90) {
        // The way was not open after all: a traveller turns back, one returning takes the nearest open resting place it can reach.
        if (l.fsm === 'travel') {
          // Blocked: first another feeding place (twice at most this trip), then home.
          const f = (l.replans ?? 0) < 2 ? chooseFeeding(l, ctx) : null
          if (f) {
            l.replans = (l.replans ?? 0) + 1
            l.food = f.food
            l.bite = 0
            l.patch = f.why
            go(l, 'travel', `Its way was blocked: it goes instead to ${f.why}`, f)
          } else {
            l.replans = 0
            go(l, 'return', 'The way to its feeding place was blocked: it turns back', l.rest)
          }
        }
        else {
          const s = kind === 'dweller' ? chooseShelter(l, ctx, day) : null
          if (s) l.rest = { x: s.x, z: s.z }
          else l.rest = { x: l.x, z: l.z }
          go(l, s ? 'return' : 'rest', 'Its way back was blocked: it takes another resting place', s ? l.rest : null)
        }
      }
      break
    }
    case 'forage': {
      // Feeding is at plants: it walks to each in turn and feeds there a few seconds (a dweller crouches to graze, a crawler roots, a strider probes).
      const plant = l.food[l.bite]
      const goal = plant ?? l.target
      const gap = goal ? Math.hypot(goal.x - l.x, goal.z - l.z) : 0
      const reach = kind === 'crawler' ? 0.25 : kind === 'dweller' ? 0.75 : 0.5
      if (goal && gap > reach && kind !== 'strider') {
        moving = true
        motion = kind === 'crawler' ? 'scuttle' : 'walk'
        input.pace = 0.6
        l.target = goal
        if (gap > l.lastGap - 0.03) l.stuck += dt
        else l.stuck = 0
        l.lastGap = Math.min(l.lastGap, gap + 0.2)
        if (l.stuck > 2) {
          l.bite += 1
          l.stuck = 0
          l.lastGap = 1e9
        }
      } else {
        motion = kind === 'strider' ? 'forage' : kind === 'dweller' ? 'crouch' : 'idle'
        if (kind === 'crawler') input.feed = 0.9
        l.energy = Math.min(1, l.energy + (kind === 'strider' ? 0.03 : 0.04) * dt)
        // Turn to the plant it feeds on.
        if (plant) l.heading += Math.max(-1.5 * dt, Math.min(1.5 * dt, Math.atan2(Math.sin(Math.atan2(plant.z - l.z, plant.x - l.x) - l.heading), Math.cos(Math.atan2(plant.z - l.z, plant.x - l.x) - l.heading))))
        l.stuck += dt
        // A few seconds at each plant, then the next.
        if (plant && l.stuck > 3.5 + 2.5 * hash(l.spec.seed, l.bite, 9)) {
          l.bite += 1
          l.stuck = 0
          l.lastGap = 1e9
        }
      }
      const done = l.t > rhythm.forage && (l.energy > 0.92 || l.bite >= l.food.length || l.t > rhythm.forage * 4)
      if (done) {
        const again = l.energy < 0.85 && (kind === 'dweller' ? !day : kind === 'strider' ? daylight > 0.15 : sunOnGround < 0.35)
        const f = again ? chooseFeeding(l, ctx) : null
        if (f) {
          l.food = f.food
          l.bite = 0
          l.patch = f.why
          go(l, 'travel', `Still hungry (${pct(l.energy)}) after that patch: it goes on to ${f.why}`, f)
        } else {
          if (kind === 'dweller') {
            const s = chooseShelter(l, ctx, day)
            if (s) l.rest = { x: s.x, z: s.z }
          }
          go(l, 'return', l.energy > 0.85 ? `Fed (energy ${pct(l.energy)}): it goes back to ${kind === 'dweller' ? `the shelter of ${l.spec.home}` : kind === 'crawler' ? 'its litter' : 'its shallow'}` : `The patch is grazed: it goes back to ${kind === 'dweller' ? 'its shelter' : 'rest'}`, l.rest)
        }
      }
      break
    }
  }
  // What overrides: a crawler caught in the sun goes back under cover (and rolls up there); a strider stops at nightfall; a dweller out by day that is fed goes in.
  if (kind === 'crawler' && sunOnGround > 0.5 && (l.fsm === 'travel' || l.fsm === 'forage') && l.t > 2) go(l, 'return', `The sun has reached its ground (${pct(sunOnGround)}): it hurries back under cover`, l.rest)
  if (kind === 'strider' && daylight <= 0.15 && (l.fsm === 'travel' || l.fsm === 'forage')) go(l, 'return', `Daylight ${pct(daylight)}: night falls, it goes back to stand in its shallow`, l.rest)
  if (kind === 'strider') input.water = Math.max(0.05, Math.min(0.8, world.water.depthAt(l.x, l.z) * 1.6))
  input.motion = motion
  const frame = c.update(dt, input)
  if (moving) walk(l, frame.speed, dt, ctx)
  // Keeping apart: two of a kind never overlap. One at rest gives way; one on the move is only nudged, more slowly than it walks (a push as fast as
  // its gait held a walker in place beside its resting partner while its card said it was on its way).
  for (const o of all) {
    if (o === l || o.spec.kind !== l.spec.kind || !o.creature) continue
    const dx = l.x - o.x
    const dz = l.z - o.z
    const dd = Math.hypot(dx, dz)
    if (dd > 0.001 && dd < rhythm.gap) {
      const push = Math.min((moving ? 0.08 : 0.6) * dt, rhythm.gap - dd) / dd
      const nx = l.x + dx * push
      const nz = l.z + dz * push
      if (standable(kind, nx, nz, world, heightOf(l))) {
        l.x = nx
        l.z = nz
      }
    }
  }
  return describe(l, daylight, sunOnGround, canopy, world)
}

/**
 * One step toward the goal at exactly its gait's speed (so its feet do not slide), turning as it goes. It turns on the spot only for a sharp turn, and only
 * as fast as it could; a step into water or a structure is tried a little to either side before it counts as blocked.
 */
function walk(l: Live, speed: number, dt: number, ctx: Ctx) {
  const goal = l.target ?? l.rest
  const want = Math.atan2(goal.z - l.z, goal.x - l.x)
  const diff = Math.atan2(Math.sin(want - l.heading), Math.cos(want - l.heading))
  const turnRate = l.spec.kind === 'crawler' ? 1.6 : 2.0
  l.heading += Math.max(-turnRate * dt, Math.min(turnRate * dt, diff))
  if (Math.abs(diff) > 1.1 || speed < 0.02) return
  const stepLen = Math.min(speed * dt * (1 - 0.5 * Math.abs(diff) / 1.1), Math.hypot(goal.x - l.x, goal.z - l.z))
  // Straight on, else round the obstacle: on the side it last went round first (so it keeps going round a trunk instead of turning back and forth
  // against it), out to a sharp turn and, if need be, a step back past it.
  const s = l.side ?? 1
  for (const a of [0, 0.4, 0.8, 1.3, 1.9, 2.5]) {
    for (const off of a === 0 ? [0] : [a * s, -a * s]) {
      const h = l.heading + off
      const nx = l.x + Math.cos(h) * stepLen
      const nz = l.z + Math.sin(h) * stepLen
      if (standable(l.spec.kind, nx, nz, ctx.world, heightOf(l))) {
        l.x = nx
        l.z = nz
        if (off !== 0) {
          l.heading += off * 0.25
          l.side = Math.sign(off)
        }
        return
      }
    }
  }
}

/** The panel's lines for a walker: its state, why, the habitat where it is (measured there, now), and its energy and size. */
function describe(l: Live, daylight: number, sunOnGround: number, canopy: number, world: World): CreatureInfo {
  const kind = l.spec.kind
  const c = l.creature!
  const h = habitatAt(l.x, l.z)
  const stage = stageName(l.spec.age)
  const size = `${c.size.length.toFixed(2)} m long, ${c.size.height.toFixed(2)} m tall`
  const energy = `Energy ${pct(l.energy)}`
  const feeding = l.fsm === 'forage' && l.food[l.bite] ? l.food[l.bite]!.id : ''
  if (kind === 'dweller') {
    // The shade it has is measured along its body (nose, middle, tail), not at one point, so an animal half across the edge of the shadow reads as half shaded.
    const body = h.known ? bodyShade(l.x, l.z, l.heading, c.size.length || 1.6) : 0
    const shadeLine = h.known ? `${h.shelter > 0 ? 'roofed by the structure, ' : ''}its body ${pct(body)} in the structure’s shadow now; the ground here is shaded ${pct(h.shade)} of the day` : 'the structure’s shade not yet read'
    const state =
      l.fsm === 'rest'
        ? h.shelter > 0
          ? 'Resting under the roof of its shelter'
          : body > 0.8
            ? 'Resting in the structure’s shadow'
            : body > 0.3
              ? 'Resting at the edge of the shadow'
              : 'Resting in the open'
        : l.fsm === 'forage'
          ? feeding
            ? `Grazing ${feeding === 'ground' ? 'a ground mat' : `a ${feeding}`}`
            : 'Moving between food plants'
          : l.fsm === 'travel'
            ? 'Travelling to a feeding patch'
            : 'Returning to its shelter'
    return { species: 'Hollow Dweller', stage, state, why: l.why || `Daylight ${pct(daylight)}: it lies up by day under ${l.spec.home}`, habitat: `${l.spec.home}: ${shadeLine}`, detail: `${energy} · ${size}` }
  }
  if (kind === 'crawler') {
    const state = l.fsm === 'rest' ? (sunOnGround > 0.45 ? 'Rolled up against the sun' : 'Resting in the litter') : l.fsm === 'forage' ? (feeding ? `Rooting in the litter by a ${feeding === 'ground' ? 'ground mat' : feeding}` : 'Shuffling to the next plant') : l.fsm === 'travel' ? 'Shuffling to damp, shaded litter' : 'Returning to its litter'
    return {
      species: 'Litter Crawler',
      stage,
      state,
      why: l.why || `Sun on its ground ${pct(sunOnGround)}: above about half it rolls up, in shade it feeds`,
      habitat: `Litter: canopy cover ${pct(canopy)}${h.known && h.shade > 0.05 ? `, architecture shade ${pct(h.shade)}` : ''} · sun on the ground ${pct(sunOnGround)}`,
      detail: `${energy} · ${size}`,
    }
  }
  const depth = world.water.depthAt(l.x, l.z)
  const state = l.fsm === 'rest' ? (daylight > 0.15 ? 'Standing in the shallows' : 'Standing still for the night') : l.fsm === 'forage' ? 'Probing the bed of the shallow' : l.fsm === 'travel' ? 'Wading along the shore' : 'Wading back to its shallow'
  return { species: 'Strider', stage, state, why: l.why || `Daylight ${pct(daylight)}: it works the shore by day and stands at night`, habitat: `Shallows ${depth > 0 ? depth.toFixed(2) : '0.00'} m deep (it feeds in 0.08 to 0.45 m)`, detail: `${energy} · ${size}` }
}
