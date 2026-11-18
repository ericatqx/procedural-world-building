import { sunAt } from '../project/sun.ts'
import { environment, setHour, setTimeScale, setYear } from '../project03/environment.ts'
import { setExperience } from '../project03/experience.ts'
import { setCard, setExplore } from '../project03/exploreData.tsx'
import { setDiagSoft } from '../project03/visualDiagnostics.ts'
import { architectureHold, formationScene } from '../project03/formationLayer.tsx'
import { currentPopulation } from '../project03/livingSelection.ts'
import { currentWorld } from '../project03/world.ts'
import { islandAt } from '../project03/Vegetation.tsx'
import { zonesOf } from '../project03/vegPlants.ts'
import { shared } from '../project03/vegShared.ts'
import { PART_VARIANT, SPECIES as PLANT_SPECIES, STRIDE, plantsInTile } from '../project03/worldPlants.ts'
import { riverEdgeField } from '../project03/vegRivers.ts'
import { LIFECYCLE } from '../project03/livingTime.ts'
import { loading } from '../project03/loading.ts'
import { DEFAULT_TERRAIN_SEED, LANDSCAPE, landscapeHeight } from '../project03/terrain.ts'
import { setVegetation } from '../project03/vegStore.ts'
import { worldActions } from '../project03/worldActions.ts'
import { creatureCam } from '../project03/creatureCam.ts'
import { creaturePlaces } from '../project03/Creatures.tsx'
import { setLayer, showOverview } from './homeScene.ts'

/**
 * WORLD FORMATION: the island generated step by step, in the world's own materials (never a data lens).
 *
 * What is the world itself and what is a visualization of it:
 *   Terrain     VISUALIZATION, then the world. The height function the world uses, sampled as a field, as columns (coarse blocks refined into
 *               cells: an illustration of sampling, the terrain is a heightfield mesh, not voxels), as a wireframe grid and as a plain surface
 *               (formationLayer.tsx); then the real terrain, its own materials blended in over the plain surface.
 *   Water       VISUALIZATION, then the world. The rivers' own node chains, reached in the order the river network connects them (sources by
 *               height, tributaries into the streams they join), the lakes' own basins rising from their deepest point to their spill level, and
 *               the overflow carried on from each full lake's outlet; then the world's own water.
 *   Sun         The world: its sun moved across the day, its own shadows (the Black Stage's lavender cast shadow) and its own stylized sun mark,
 *               with the day's path drawn from the world's own sun function.
 *   Living Arch The world: its population run from one organism's germination to maturity, that organism framed by the world's own Approach camera.
 *   Vegetation  The world: its plant tiles and geometry, grown in by scale (loading.ts › plantGrowth) where the habitat rules put them.
 *   Creatures   The world: its animals and its own creature camera.
 *
 * The timeline runs from 0 to STAGES.length: the whole part is the stage, the fraction how far into it. Each stage plays for its own `seconds`.
 * Everything a stage shows is a function of that position alone (the camera's moves are started when the position crosses into a new camera
 * phase), so playing, scrubbing and restarting all show the same thing at the same point.
 */
export type Camera = 'overview' | 'organism' | 'plants' | 'wide' | 'follow'
type Build = Omit<typeof formationScene, 'on'>

export type Stage = {
  key: string
  title: string
  /** What depends on what: the line that says why this comes now. */
  because: string
  text: string
  /** Seconds the stage plays for at 1×. */
  seconds: number
  /** The generation step being shown, by how far into the stage the timeline is (0 to 1). */
  step: (t: number) => string
  /** What the stage reads, the rules it applies, and what it leaves for the stages after it. */
  inputs: string[]
  rules: string[]
  outputs: string[]
  /** Where to look further: a part of Systems, an Explore lens, a Lab. */
  system: string
  lens?: string
  lab?: string
  /** The construction drawn over the world, and what of the world is shown (formationLayer.tsx), by how far into the stage. */
  build: (t: number) => Build
  /** The world's real water. */
  water: (t: number) => boolean
  /** The plants: whether the vegetation is on (its tiles build even at no growth), and how far grown, 0 to 1. */
  plants: (t: number) => { on: boolean; grow: number }
  time: (t: number) => { scale: 'daily' | 'evolution'; year: number; hour: number }
  camera: (t: number) => Camera
}

const ref = LIFECYCLE.reference
const lin = (a: number, b: number, t: number) => Math.max(0, Math.min(1, (t - a) / (b - a)))
const smooth = (a: number, b: number, t: number) => {
  const x = lin(a, b, t)
  return x * x * (3 - 2 * x)
}
const clock = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`
/** Steps by where they begin: the last one begun. */
const steps = (list: [number, string][]) => (t: number) => list.reduce((at, [from, label]) => (t >= from ? label : at), list[0]![1])

/** Nothing drawn over the world; the terrain shown; the architecture shown or not. */
const plain = (architecture: number, life = 0): Build => ({ field: 0, voxels: 0, refine: 1, voxelFade: 1, wire: 0, neutral: 0, ground: 1, plain: 0, show: 1, groundCover: 1, worldWater: 1, flow: 0, water: 0, sun: 0, architecture, life })
const noPlants = () => ({ on: false, grow: 0 })
const afternoon = () => ({ scale: 'daily' as const, year: ref, hour: 15.3 })
const before = () => ({ scale: 'daily' as const, year: 0, hour: 15.3 })

/**
 * THE SHOTS. The Living Architecture stage watches one organism and the Vegetation stage the planted ground beside it, so the camera moves from
 * one to the other rather than jumping: the organism is a large one, alive at the reference year, germinated early enough for its whole growth
 * to play out, clear of lakes and rivers and of tall neighbours, and with lush ground near it. The lushness is the plants' own rules
 * (worldPlants.ts › SPECIES, read over the island's fields: what the habitat lets grow there), summed over the species, at sites on rings around
 * the organism; the richest site, clear of water, is where the plants are watched. The organism is seen from the side that keeps that ground in
 * the frame beside it, aimed at its middle height. Chosen once per population, from the world's own data.
 */
type Shot = { x: number; z: number; dist: number; yaw: number; aim: number; elev?: number }
type Featured = { aim?: number; id: string; x: number; z: number; established: number; distance: number; height: number; yaw: number; plants: { x: number; z: number }; plantsShot?: Shot }
let featuredFor: unknown = null
let featuredOne: Featured | null = null
function lushness(x: number, z: number): number {
  const f = shared.island
  const world = currentWorld()
  if (!f || !world || world.water.depthAt(x, z) > 0) return 0
  const c = islandAt(f)(x, z, 0)
  if (c.waterDist < 6 || c.slope > 0.6) return 0
  const zn = zonesOf(c)
  return PLANT_SPECIES.reduce((a, sp) => a + Math.max(0, sp.rule(c, zn)), 0)
}
/**
 * THE CURATED SHOWCASE (integration round 14). For the island the site opens on (its default seed), Formation's two close shots are composed by hand,
 * after looking at the candidates rendered at 1440 × 900: the structures are the world's own, procedurally grown; only the choice of which one, and
 * from where, is fixed. Candidates looked at (world x, z; camera yaw, distance, aim): LA-30 (1104, -208) and LA-44 beside it, a crowded pair;
 * LA-42 (-656, 720), low; LA-18 (-1040, -1104) and LA-15 (-560, -1392), low single masses on open slopes; LA-28 (304, -432): a tall layered tower on
 * a lake islet, base, tower and overhang shelf all in view across open water, chosen. Its plants: the grove at its foot (312, -450), veil trees over
 * shrubs and ground cover in the structure's sun and shade, seen low and close with the tower behind. Any other seed takes the automatic choice.
 */
const CURATED = {
  seed: DEFAULT_TERRAIN_SEED,
  arch: { id: 'LA-28', yaw: 2.528, dist: 110, aim: 22 },
  veg: { x: 312, z: -450, dist: 50, yaw: 2.128, aim: 3, elev: 0.2 },
}
const curatedOn = () => currentWorld()?.seed === CURATED.seed

function featured(): Featured | null {
  const population = currentPopulation()
  if (!population) return null
  if (featuredFor === population) return featuredOne
  if (curatedOn()) {
    const o = population.organisms.find((m) => m.id === CURATED.arch.id && (m.died < 0 || m.died > ref))
    if (o) {
      featuredFor = population
      featuredOne = { id: o.id, x: o.x, z: o.z, established: Math.max(0, Math.floor(o.established)), distance: CURATED.arch.dist, height: o.height, yaw: CURATED.arch.yaw, aim: CURATED.arch.aim, plants: { x: CURATED.veg.x, z: CURATED.veg.z } }
      return featuredOne
    }
  }
  // (The island's fields are needed for the plants' rules: until they are built, the choice waits.)
  if (!shared.island) return null
  featuredFor = population
  const world = currentWorld()
  const alive = population.organisms.filter((o) => o.died < 0 || o.died > ref)
  let best: (Featured & { score: number }) | null = null
  const ranked: (Featured & { score: number })[] = []
  for (const o of alive) {
    if (o.established > ref * 0.45) continue
    let score = o.height * o.radius
    if (world) {
      // Near water, not at it: the nearest lake or river edge, best about 120 to 260 m off (close enough to share the frame, clear of the bank).
      let near = Infinity
      for (const r of [40, 80, 130, 190, 260, 340])
        for (let k = 0; k < 16 && near === Infinity; k += 1) {
          const a = (k / 16) * Math.PI * 2
          if (world.water.depthAt(o.x + Math.cos(a) * r, o.z + Math.sin(a) * r) > 0) near = r
        }
      for (const rv of world.rivers.rivers) for (const n of rv.nodes) near = Math.min(near, Math.hypot(n.x - o.x, n.z - o.z) - n.halfWidth)
      score *= near < o.radius + 30 ? 0.1 : near < 400 ? 0.4 + 0.6 * Math.exp(-(((near - 190) / 130) ** 2)) : 0.3
      // Low, open ground: an organism on the lowlands rather than on a mountain side.
      score *= 1 - 0.85 * Math.min(1, Math.max(0, (o.ground - 30) / 170))
    }
    for (const n of alive) {
      if (n === o || n.height < o.height * 0.5) continue
      if (Math.hypot(n.x - o.x, n.z - o.z) < o.radius + n.radius + 70) score *= 0.5
    }
    // How lush the ground beside it is, by the plants' own rules on rings just beyond its footprint.
    // (The mean over the rings, not the best spot: open, planted ground on a good share of its sides, not one lucky patch.)
    let lush = 0
    for (const r of [o.radius + 45, o.radius + 85, o.radius + 130]) for (let k = 0; k < 16; k += 1) lush += lushness(o.x + Math.cos((k / 16) * Math.PI * 2) * r, o.z + Math.sin((k / 16) * Math.PI * 2) * r) / 48
    score *= 0.2 + Math.min(1.5, lush * 1.6)
    // A Hollow Dweller's home, when the creatures are placed: the animal of the next stage then lives beside these plants.
    const homes = creatureCam.get().homes.dweller ?? []
    if (homes.includes(o.id)) score *= 1.8
    const distance = Math.max(170, Math.min(400, o.radius * 2.4 + o.height * 1.7 + 50))
    ranked.push({ id: o.id, x: o.x, z: o.z, established: Math.max(0, Math.floor(o.established)), distance, height: o.height, yaw: 0, plants: { x: o.x, z: o.z }, score })
  }
  // THE VIEW DECIDES (integration round 13). Of the best-rated dozen, the one that can actually be SEEN whole: from each of 24 sides, the line of
  // sight to its base, its middle and its top, with the terrain and the other structures as obstacles; the structure and side with the clearest
  // view win. (Turning the camera after choosing the structure was not enough: a structure in a hollow is hidden from every side.)
  ranked.sort((a, b) => b.score - a.score)
  for (const c of ranked.slice(0, 12)) {
    const others = alive.filter((m) => m.id !== c.id)
    let view = 0
    let yaw = 0
    for (let k = 0; k < 24; k += 1) {
      const y = (k / 24) * Math.PI * 2
      const v = lineClear(c.x, c.z, c.distance, 3, y, others) * lineClear(c.x, c.z, c.distance, c.height * 0.5, y, others) * lineClear(c.x, c.z, c.distance, c.height * 0.9, y, others)
      if (v > view) {
        view = v
        yaw = y
      }
    }
    c.yaw = yaw
    c.score *= 0.05 + view * view
    if (!best || c.score > best.score) best = c
  }
  if (best && world && shared.island) {
    // Where the plants are watched: of the sites the rules rate best, the one where the world's own placement (worldPlants.ts › plantsInTile, as
    // the island's distant tiles call it) actually stands the most plants.
    const o = best
    const sites: { x: number; z: number; a: number; v: number }[] = []
    for (const r of [50, 80, 115])
      for (let k = 0; k < 16; k += 1) {
        const a = (k / 16) * Math.PI * 2
        const x = o.x + Math.cos(a) * r
        const z = o.z + Math.sin(a) * r
        sites.push({ x, z, a, v: lushness(x, z) })
      }
    // Sites that hold both: some in the structure's afternoon shade (away from the sun), some in the open, so sunlit and shaded communities meet.
    const sun = sunAt(15.3, 55).direction
    const sl = Math.hypot(sun[0], sun[2]) || 1
    const shadeSide = (a: number) => Math.max(0, -(Math.cos(a) * sun[0] + Math.sin(a) * sun[2]) / sl)
    sites.sort((p, q) => q.v - p.v)
    const water = { depth: (x: number, z: number) => world.water.depthAt(x, z), edge: riverEdgeField(world) }
    const at = islandAt(shared.island)
    const year = Math.floor(ref / 10) * 10
    let pick = sites[0]!
    let most = -1
    for (const site of sites.slice(0, 10)) {
      let n = 0
      const groups = new Set<string>()
      plantsInTile('island', site.x - 24, site.z - 24, 48, world.seed, year, at, water).forEach((buf, id) => {
        n += buf.length / STRIDE
        if (buf.length) groups.add(PLANT_SPECIES.find((sp) => sp.id === id)?.group ?? '')
      })
      // Every layer present (cover, shrubs, trees) counts most; then half in shade, half out: the edge of the shade.
      const slope = at(site.x, site.z, 0).slope
      n *= (0.4 + 0.3 * groups.size) * (0.6 + 0.8 * (1 - Math.abs(shadeSide(site.a) - 0.5) * 2)) * (1 - Math.min(0.8, slope))
      if (n > most) {
        most = n
        pick = site
      }
    }
    best.plants = { x: pick.x, z: pick.z }
    // The organism is seen with the planted ground beside it (the camera about 60° round from that side).
    // (The organism's side is the clearest view found above: kept.)
    // The plants: close enough to read each one, low over them, from a side where nothing stands between (the ground along the line of sight is
    // checked), with the structure behind them and off centre: it gives their shade, it does not fill the frame.
    const D = 78
    let shot: (Shot & { s: number }) | null = null
    for (let k = 0; k < 24; k += 1) {
      const yaw = (k / 24) * Math.PI * 2
      const cx = pick.x + Math.sin(yaw) * D
      const cz = pick.z + Math.cos(yaw) * D
      const g0 = landscapeHeight(pick.x, pick.z)
      const cy = Math.max(g0 + D * 0.47, landscapeHeight(cx, cz) + D * 0.25)
      let clear = 1
      for (let f = 0.1; f < 0.95; f += 0.1) {
        const lx = cx + (pick.x - cx) * f
        const lz = cz + (pick.z - cz) * f
        const ly = cy + (g0 + 3 - cy) * f
        if (landscapeHeight(lx, lz) + 3 > ly) clear *= 0.15
      }
      if (world.water.depthAt(cx, cz) > 0) clear *= 0.5
      // The structure from the camera: behind the plants (further away) and 15° to 40° off the line of sight.
      const vx = pick.x - cx
      const vz = pick.z - cz
      const ox = o.x - cx
      const oz = o.z - cz
      const off = Math.abs(Math.atan2(vx * oz - vz * ox, vx * ox + vz * oz))
      const behind = Math.hypot(ox, oz) > D ? 1 : 0.3
      const side = Math.exp(-(((off - 0.45) / 0.25) ** 2))
      // The light across the frame, from the side, models the plants; straight into the sun flattens them to silhouettes.
      const into = (vx * sun[0] + vz * sun[2]) / (D * sl)
      const s = clear * behind * (0.2 + side) * (1 - 0.5 * Math.max(0, -into))
      if (!shot || s > shot.s) shot = { x: pick.x, z: pick.z, dist: D, yaw, aim: 4, s }
    }
    if (shot) best.plantsShot = shot
  }
  if (best) {
    // The organism's own shot: from the side the plants were chosen for, turned (within 90 degrees) to the clearest line of sight, so no hillside
    // in the foreground covers the structure.
    const o = best
    best.yaw = clearestYaw(o.x, o.z, o.distance, o.height * 0.4, best.yaw, Math.PI / 6, alive.filter((m) => m.id !== o.id))
  }
  featuredOne = best
  return best
}

/**
 * How clear a camera's line of sight is, from a pose like approachPose's (terrain.ts: at least 0.47 of the distance above the target's ground), to a
 * point `aim` metres above the target: 1 when nothing stands in it; less for each sample of terrain that rises into it, and (when `structures` is
 * given) for any structure whose body the line passes through.
 */
function lineClear(x: number, z: number, dist: number, aim: number, yaw: number, structures: { x: number; z: number; radius: number; height: number }[] | null): number {
  const cx = x + Math.sin(yaw) * dist
  const cz = z + Math.cos(yaw) * dist
  const g0 = landscapeHeight(x, z)
  const cy = Math.max(g0 + dist * 0.47, landscapeHeight(cx, cz) + Math.min(80, dist * 0.25))
  let clear = 1
  for (let f = 0.08; f < 0.96; f += 0.06) {
    const lx = cx + (x - cx) * f
    const lz = cz + (z - cz) * f
    const ly = cy + (g0 + aim - cy) * f
    if (landscapeHeight(lx, lz) + 2 > ly) clear *= 0.3
    if (structures)
      for (const o of structures) if (Math.hypot(lx - o.x, lz - o.z) < o.radius + 4 && ly < landscapeHeight(o.x, o.z) + o.height + 4) clear *= 0.2
  }
  return clear
}
function clearestYaw(x: number, z: number, dist: number, aim: number, prefer: number, within: number, structures: { x: number; z: number; radius: number; height: number }[] | null): number {
  let best = { s: -1, yaw: prefer }
  for (let k = -12; k <= 12; k += 1) {
    const yaw = prefer + (k / 12) * within
    const s = lineClear(x, z, dist, aim, yaw, structures) * (1 - 0.15 * Math.abs(k / 12))
    if (s > best.s) best = { s, yaw }
  }
  return best.yaw
}

/**
 * THE VEGETATION SHOT, chosen on its own (not tied to the Living Architecture's structure, nor to a creature's home). Over the whole island: open,
 * gentle ground where the world's own placement (worldPlants.ts › plantsInTile) stands the most plants, with all three layers (ground cover, shrubs,
 * trees) and with plants in each of the light forms (sun-grown, partial shade, deep shade), so the sunlit and the shaded communities are both in the
 * frame. The camera is a natural oblique view, low and close enough to read single plants, on a side where neither the terrain nor a structure
 * stands between it and them; a structure may stand behind them.
 */
type VegShot = Shot & { note: string }
let vegFor: unknown = null
let vegOne: VegShot | null = null
export function vegetationShot(): VegShot | null {
  const population = currentPopulation()
  const world = currentWorld()
  const f = shared.island
  if (!population || !world || !f) return null
  if (vegFor === population) return vegOne
  if (curatedOn()) {
    vegFor = population
    vegOne = { ...CURATED.veg, note: 'curated: the grove at LA-28' }
    return vegOne
  }
  vegFor = population
  const alive = population.organisms.filter((o) => o.died < 0 || o.died > ref)
  // 1. A coarse sweep (every 64 m): gentle, dry ground near enough to water, whose surroundings hold both bright and shaded light.
  const cands: { x: number; z: number; s: number }[] = []
  for (let j = 6; j < f.n - 6; j += 4)
    for (let i = 6; i < f.n - 6; i += 4) {
      const k = j * f.n + i
      if (!f.land[k] || f.waterDepth[k]! > 0 || f.waterDist[k]! < 24 || f.slope[k]! > 0.3) continue
      let lo = 1
      let hi = 0
      for (let dj = -4; dj <= 4; dj += 2)
        for (let di = -4; di <= 4; di += 2) {
          const q = (j + dj) * f.n + (i + di)
          if (!f.land[q] || f.waterDepth[q]! > 0) continue
          lo = Math.min(lo, f.light[q]!)
          hi = Math.max(hi, f.light[q]!)
        }
      const x = f.x0 + (i + 0.5) * f.cell
      const z = f.x0 + (j + 0.5) * f.cell
      // (Structures shade too: a structure within 120 m counts as shaded ground beside it.)
      const near = alive.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + 120)
      const mix = Math.max(smooth(0.08, 0.3, hi - lo), near ? 0.7 : 0) * smooth(0.55, 0.75, hi)
      const inside = alive.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + 20)
      if (inside) continue
      cands.push({ x, z, s: lushness(x, z) * (0.3 + mix) * (1 - f.slope[k]!) })
    }
  cands.sort((a, b) => b.s - a.s)
  // 2. The world's own placement on the best: how many plants, of how many layers, in how many light forms.
  const water = { depth: (x: number, z: number) => world.water.depthAt(x, z), edge: riverEdgeField(world) }
  const at = islandAt(f)
  const year = Math.floor(ref / 10) * 10
  const group = new Map(PLANT_SPECIES.map((sp) => [sp.id, sp.group]))
  let pick: { x: number; z: number; s: number; n: number; layers: number; forms: number } | null = null
  for (const c of cands.slice(0, 16)) {
    let n = 0
    const layers = new Set<string>()
    const forms = new Set<number>()
    plantsInTile('all', c.x - 32, c.z - 32, 64, world.seed, year, at, water).forEach((buf, id) => {
      const count = buf.length / STRIDE
      n += count
      if (count) layers.add(group.get(id) ?? '')
      for (let o = 0; o < buf.length; o += STRIDE) {
        const v = Math.round(buf[o + 5]!)
        if (v === 1 || v === 2 || v === PART_VARIANT) forms.add(v)
      }
    })
    const s = Math.log(1 + n) * (0.4 + 0.25 * layers.size) * (0.6 + 0.2 * forms.size)
    if (!pick || s > pick.s) pick = { x: c.x, z: c.z, s, n, layers: layers.size, forms: forms.size }
  }
  if (!pick) return (vegOne = null)
  // 3. The camera: a natural oblique view (approachPose keeps it about 25 degrees above), 55 m off, from the clearest side, structures counted as
  // obstacles; between equally clear sides, the one with the sun across the frame rather than behind the plants.
  const D = 55
  const sun = sunAt(15.3, 55).direction
  const sl = Math.hypot(sun[0], sun[2]) || 1
  let best = { s: -1, yaw: 0 }
  for (let k = 0; k < 24; k += 1) {
    const yaw = (k / 24) * Math.PI * 2
    const clear = lineClear(pick.x, pick.z, D, 2, yaw, alive)
    const vx = -Math.sin(yaw)
    const vz = -Math.cos(yaw)
    const into = (vx * sun[0] + vz * sun[2]) / sl
    const s = clear * (1 - 0.45 * Math.max(0, into)) * (world.water.depthAt(pick.x + Math.sin(yaw) * D, pick.z + Math.cos(yaw) * D) > 0 ? 0.8 : 1)
    if (s > best.s) best = { s, yaw }
  }
  vegOne = { x: pick.x, z: pick.z, dist: D, yaw: best.yaw, aim: 2, note: `${pick.n} plants, ${pick.layers} layers, ${pick.forms} light forms, clear ${best.s.toFixed(2)}` }
  return vegOne
}

/** The Living Architecture stage: hidden while the camera settles on the organism, then grown from its germination to maturity. */
const ARCH_START = 0.14
const growYear = (t: number) => {
  const from = featured()?.established ?? 0
  return Math.round(from + (ref - from) * smooth(ARCH_START, 0.88, t))
}
/** The Sun stage's hour: one whole day, from just before sunrise to just after sunset, at a steady pace (easing only at its ends). */
const AFTERNOON = 15.3
const DAWN = 5.7
const DUSK = 18.3
const sunHour = (t: number) => {
  const x = lin(0.03, 0.97, t)
  return DAWN + (DUSK - DAWN) * (0.7 * x + 0.3 * x * x * (3 - 2 * x))
}
/** The Living Architecture stage's hour: from the Sun stage's dusk back to the afternoon light, while its camera moves in (nothing grows yet). */
const archHour = (t: number) => DUSK + (AFTERNOON - DUSK) * smooth(0, ARCH_START, t)

export const STAGES: Stage[] = [
  {
    key: 'terrain',
    title: 'Terrain',
    because: 'From one seed',
    text: 'One height function of the seed, drawn as a heightfield mesh: sampled coarsely, refined, shaded plain, then given its materials.',
    seconds: 9,
    step: steps([
      [0, 'The height function, sampled'],
      [0.05, 'Coarse: one height per block'],
      [0.3, 'Refined: each cell its own height'],
      [0.5, 'The mesh: a grid at those heights'],
      [0.6, 'The heightfield, as plain clay'],
      [0.74, 'Materials over the whole island'],
    ]),
    inputs: ['World seed', 'Island outline (radius by angle)'],
    rules: ['Massifs of different height and width', 'Ridged noise cuts branching ridges', 'Foothills and drainage between them', 'Meshed as a heightfield in chunks, finer near the camera', 'Geology by slope: rock bands, scree, soil'],
    outputs: [`Height function over ${LANDSCAPE.size} m`, `${LANDSCAPE.size / LANDSCAPE.chunkSize}×${LANDSCAPE.size / LANDSCAPE.chunkSize} chunks of ${LANDSCAPE.chunkSize} m`, `Vertex spacing ${LANDSCAPE.lodStep.slice(0, 4).join(' / ')} m`],
    system: 'terrain',
    lens: 'rock',
    // One continuous progression in one clay: the flat field; coarse columns rising out of it; each refined to its cell; the columns melting away
    // to leave the mesh's wireframe at the same heights; the real terrain coming up as plain clay under the wire; then its materials over the
    // whole island at once.
    build: (t) => ({
      ...plain(0),
      field: lin(0, 0.06, t),
      voxels: lin(0.04, 0.3, t),
      refine: lin(0.3, 0.44, t),
      voxelFade: lin(0.44, 0.52, t),
      // (The wireframe on its own once the columns have gone, then the clay rising under it.)
      wire: lin(0.5, 0.56, t) * (1 - lin(0.8, 0.9, t)),
      ground: t >= 0.58 ? 1 : 0,
      show: smooth(0.58, 0.7, t),
      plain: 1 - smooth(0.74, 0.97, t),
    }),
    water: () => false,
    plants: noPlants,
    time: before,
    camera: () => 'overview',
  },
  {
    key: 'water',
    title: 'Water',
    because: 'Reads the land',
    text: 'Streams start high and run down the drainage, joining as they go. Each hollow fills to the lowest pass on its rim, then overflows downstream.',
    seconds: 10,
    step: steps([
      [0, 'High sources first, running downhill'],
      [0.25, 'Tributaries join larger streams'],
      [0.45, 'Hollows fill as the water reaches them'],
      [0.62, 'Full lakes overflow downstream'],
      [0.84, 'The water, as the world draws it'],
    ]),
    inputs: ['Uncut height function', 'Drainage directions'],
    rules: ['Every cell drains to its lowest neighbour', 'A stream starts where its catchment is large enough', 'Each hollow floods to its spill level → lakes and pools', 'Channels cut into the terrain; falls where a bed breaks'],
    outputs: ['Water bodies (lakes, pools) with outlets', 'River graph: nodes with level, width, depth', 'Terrain carve'],
    system: 'water',
    lens: 'flow',
    build: (t) => ({ ...plain(0), flow: lin(0.03, 0.8, t), water: 1 - lin(0.84, 0.97, t) }),
    water: (t) => t >= 0.8,
    plants: noPlants,
    time: before,
    camera: () => 'overview',
  },
  {
    key: 'sun',
    title: 'Sun & shadows',
    because: 'Crosses the land',
    text: 'One day: the sun rises in the east, swings through the south and sets in the west. Shadows turn with it, long, then short at noon, then long.',
    seconds: 7,
    step: (t) => {
      const h = sunHour(t)
      const e = sunAt(h, environment.controls.noonElevation).elevation
      if (e < 2) return `${clock(h)} · ${h < 12 ? 'sunrise' : 'sunset'}`
      return `${clock(h)} · sun ${Math.round(e)}° · shadows ${(1 / Math.tan((e * Math.PI) / 180)).toFixed(1)}× height`
    },
    inputs: ['Terrain shape', 'Hour and day', 'Noon sun height (the season)'],
    rules: ['Sunrise 06:00, noon due south', 'The terrain casts shadows (lavender where the sun is cut off)', 'Light over a day: what each place receives, summed'],
    outputs: ['Sun direction and daylight', 'Cast shadows', 'Light over a day (island light field)'],
    system: 'light',
    lens: 'shadow',
    build: () => ({ ...plain(0), sun: 1 }),
    water: () => true,
    plants: noPlants,
    time: (t) => ({ scale: 'daily', year: 0, hour: sunHour(t) }),
    camera: () => 'overview',
  },
  {
    key: 'architecture',
    title: 'Living Architecture',
    because: 'Grows toward the light',
    text: 'One organism from germination to maturity: a base, a tower rising toward the light, an overhang reaching out on columns, and the shade it casts.',
    seconds: 13,
    step: (t) => {
      if (t < ARCH_START) return 'A site where light, water and support allow'
      const y = growYear(t)
      const age = y - (featured()?.established ?? 0)
      const share = age / Math.max(1, ref - (featured()?.established ?? 0))
      return `Year ${y} · ${share < 0.08 ? 'germination' : share < 0.4 ? 'the tower rises' : share < 0.8 ? 'the overhang reaches out' : 'maturity, and its shade'}`
    },
    inputs: ['Light over a day', 'Moisture and soil', 'Slope and distance to water'],
    rules: ['Germinate on suitable, uncrowded ground', 'Grow toward the light; form follows habitat', 'Neighbours compete for light and draw', 'Root links; maturity, decline and ruin'],
    outputs: ['Population: organisms with a life track per year', 'Links between organisms', 'Footprint, shelter and shade'],
    system: 'architecture',
    lab: 'architecture-lab',
    build: (t) => plain(t >= ARCH_START ? 1 : 0),
    water: () => true,
    plants: noPlants,
    time: (t) => ({ scale: 'evolution', year: growYear(t), hour: archHour(t) }),
    camera: () => 'organism',
  },
  {
    key: 'vegetation',
    title: 'Vegetation',
    because: 'Settles by habitat',
    text: 'Light, moisture, slope and lasting shade sort the ground into habitats; each takes its own plants, grown here from small to mature.',
    seconds: 14,
    step: steps([
      [0, 'Bare ground, sorted by light, moisture and slope'],
      [0.1, 'Ground cover first'],
      [0.3, 'Then shrubs'],
      [0.46, 'Then trees, and the shade-tolerant plants beneath'],
      [0.8, 'Sun and lasting shade, each with its own community'],
    ]),
    inputs: ['Light over a day', 'Moisture', 'Slope', 'Shelter and shade of the structures'],
    rules: ['Classify: moist · shore · dry · shaded · alpine · rock', 'Each habitat has its community: fern and moss in shade, grass and sedge in the open', 'Scatter per 96 m tile; three levels of detail'],
    outputs: ['Habitat field', 'Plant tiles (species instances)', 'Food and cover for animals'],
    system: 'habitat',
    lens: 'habitat',
    lab: 'vegetation-lab',
    // (The ground's own cover (moss, meadow, woodland floor) comes in with the plants, not before them.)
    build: (t) => ({ ...plain(1, 1), groundCover: smooth(0.42, 0.9, t) }),
    water: () => true,
    // Grown in the close-up, from bare ground to mature, the camera staying with them.
    plants: (t) => ({ on: true, grow: smooth(0.08, 0.78, t) }),
    time: afternoon,
    // The close look at the plants, then a slow pull back to the structure and its planted ground together (not the whole island: the one
    // wide move is at the end of Creatures).
    camera: () => 'plants',
  },
  {
    key: 'creatures',
    title: 'Creatures',
    because: 'Live by all of it',
    text: 'Four species, each keeping to the habitat it needs. A Strider works the lake shallows by day; then the whole island, complete.',
    seconds: 13,
    step: steps([
      [0, 'A Strider, wading the shallows by day'],
      [0.72, 'Back to the whole island'],
      [0.92, 'The complete island'],
    ]),
    inputs: ['Habitat and shade now', 'Food (plants, litter)', 'Hour of the day'],
    rules: ['Each species keeps to its habitat', 'Behaviour by hour: rest, feed, travel', 'Procedural bodies with their own gait'],
    outputs: ['Agents: position, heading, state', 'Paths through the island'],
    system: 'creatures',
    lab: 'creature-lab',
    build: () => plain(1, 1),
    water: () => true,
    plants: () => ({ on: true, grow: 1 }),
    time: afternoon,
    // The close look holds for two thirds of the stage; the last third is the way back out (the Explore link comes once it has settled).
    camera: (t) => (t < 0.72 ? 'follow' : 'overview'),
  },
]

export const END = STAGES.length - 0.001
/** Where the timeline holds on the complete island (the Explore link shows from here). */
export const COMPLETE = STAGES.length - 1 + 0.92
export function stageAt(position: number): { index: number; t: number } {
  const p = Math.max(0, Math.min(STAGES.length - 1e-6, position))
  const index = Math.floor(p)
  return { index, t: p - index }
}

let shown = -1
let phase = ''
let plantsShown = ''
let yearShown = -1

function camera(next: Camera) {
  const was = phase
  phase = next
  if (next === 'follow') {
    // A STRIDER, the island's daytime animal (round 16): by day the Hollow Dweller lies up under its structure, and the structure hid it from the
    // camera; a Strider works the open lake shallows while there is daylight (over 15%), moving, with nothing over it but sky. The one nearest the
    // plants just watched (its place from the creatures' own simulation, Creatures.tsx › creaturePlaces), a feeding or travelling one first, seen from
    // a little back and low over the water, so the whole animal is in the frame.
    worldActions.creatures.framing({ scale: 1.5, elevation: 0.34 })
    worldActions.creatures.species('strider')
    const veg = vegetationShot()
    const feat = featured()
    const site = veg ? { x: veg.x, z: veg.z } : feat
    const places = creaturePlaces.strider ?? []
    if (site && places.length) {
      let pick = 0
      let best = Infinity
      places.forEach((p, i) => {
        const d = Math.hypot(p.x - site.x, p.z - site.z) * (p.fsm === 'forage' || p.fsm === 'travel' ? 1 : 1.6)
        if (d < best) {
          best = d
          pick = i
        }
      })
      worldActions.creatures.choose('strider', pick)
    }
    worldActions.creatures.camera('follow')
    return
  }
  const close = next === 'organism' || next === 'plants' || next === 'wide'
  const site = close ? featured() : null
  if (close && !site) {
    // The population is still loading (it arrives off the main thread, LivingArchitecture.tsx): this close look is not settled yet, so it is
    // asked for again on the next apply, and taken as soon as the organism can be chosen. Meanwhile the whole island, once.
    phase = `waiting-${next}`
    if (was !== phase) showOverview('formation')
    return
  }
  if (!site) {
    // (showOverview releases a creature camera first and gives it a few frames to let go.)
    showOverview('formation')
    return
  }
  // The organism: from its chosen side, aimed at its middle. The plants: the camera moves on toward the planted ground beside it (same side, closer
  // and lower), so the one shot becomes the other. Both glide slowly: one camera move, not a cut.
  const shot =
    next === 'plants'
      ? // The plants, close: each layer readable, the structure behind them and to one side.
        { ...(vegetationShot() ?? site.plantsShot ?? { x: site.plants.x, z: site.plants.z, dist: 90, yaw: site.yaw, aim: 4 }), glide: 3.2 }
      : next === 'wide'
        ? // Between the structure and its plants, from further back and a little higher: both in one frame.
          { x: (site.x + site.plants.x) / 2, z: (site.z + site.plants.z) / 2, dist: site.distance * 2.1, yaw: site.yaw, aim: site.height * 0.25, glide: 4.5 }
        : { x: site.x, z: site.z, dist: site.distance, yaw: site.yaw, aim: site.aim ?? site.height * 0.4, glide: 3.6 }
  const approach = (instant = false) => {
    if (phase !== next) return
    // (The place first, then the view: the elevated camera glides down to look at it, lens-shifted into the page's visual area. A composed move rises
    // on one clean arc over the terrain rather than riding every hill under a straight line: LandscapeView › arc.)
    worldActions.navigation.approach(shot.x, shot.z, shot.dist, { yaw: shot.yaw, aim: shot.aim, glide: instant ? 0.05 : shot.glide, arc: !instant, elev: 'elev' in shot ? (shot as { elev?: number }).elev : undefined })
    worldActions.navigation.view('approach', true)
  }
  // From the structure to the plants: a short move arcs over (about three seconds); a long one (the plants chosen far off) is a clean dip through
  // black: the island fades out, the camera is placed, and it fades back in on the plants, so there is no long journey across the island.
  if (next === 'plants' && was === 'organism' && Math.hypot(shot.x - site.x, shot.z - site.z) > 450) {
    dip(() => approach(true))
    return
  }
  if (was !== 'follow') {
    approach()
    return
  }
  // From a creature camera: released first, and given a few frames to let go, as showOverview does.
  worldActions.creatures.camera('off')
  let frames = 0
  const wait = () => (++frames < 4 ? requestAnimationFrame(wait) : approach())
  requestAnimationFrame(wait)
}

/** A clean cut: the world's canvas fades to black, `between` runs, and it fades back in (preview.css › .pv-world[data-dip]). */
function dip(between: () => void) {
  const world = document.querySelector<HTMLElement>('.pv-world')
  if (!world) {
    between()
    return
  }
  world.dataset.dipping = ''
  world.dataset.dip = ''
  window.setTimeout(() => {
    between()
    // (A few frames for the new view to be drawn before it is shown.)
    window.setTimeout(() => {
      delete world.dataset.dip
      window.setTimeout(() => delete world.dataset.dipping, 700)
    }, 350)
  }, 480)
}

/** Shows the world as it stands at this point of the formation. Called as the timeline moves (each frame while playing). */
export function applyFormation(position: number) {
  const { index, t } = stageAt(position)
  const s = STAGES[index]!
  formationScene.on = true
  if (index !== shown) {
    shown = index
    setLayer('architecture', true)
    setCard(null)
    // Always the final render: the world's own materials, never a data lens. No weather: the seed's sky is held clear.
    setExplore({ view: 'final', sub: 0 })
    setExperience('explore')
    loading.creatureMarks = false
    const c = environment.controls
    c.weatherMode = 'manual'
    c.conditions = { overcast: false, rain: false, mist: false, wind: false }
  }
  Object.assign(formationScene, s.build(t))
  // The world's own water, held back until its stage by the construction layer: never by Explore's Water switch, which stays Explore's.
  formationScene.worldWater = s.water(t) ? 1 : 0

  const next = s.camera(t)
  if (next !== phase) camera(next)

  // The plants: on (their tiles build, unseen at no growth), then grown in by scale (WorldPlants.tsx reads loading.plantGrowth).
  const p = s.plants(t)
  const grow = Math.round(p.grow * 50) / 50
  const key = `${p.on}|${grow}`
  if (key !== plantsShown) {
    plantsShown = key
    loading.plantGrowth = grow
    // (The overlay is the lens's: setExplore sets it.)
    setVegetation({ show: p.on })
  }

  const time = s.time(t)
  // A jump in the years (scrubbing, a stage chosen, a restart): the architecture waits, hidden, while its meshes are rebuilt for the new year.
  if (yearShown >= 0 && Math.abs(time.year - yearShown) > 4) architectureHold.until = performance.now() + 900
  yearShown = time.year
  setTimeScale(time.scale)
  setYear(time.year)
  setHour(time.hour)
}

/**
 * The island held back from the moment Formation opens, before the world is ready to be built up: otherwise the finished island, which the
 * world draws as soon as it can, shows for a moment before the construction takes its place.
 */
export function holdFormation() {
  Object.assign(formationScene, { on: true, field: 0, voxels: 0, refine: 0, voxelFade: 1, wire: 0, neutral: 0, ground: 0, plain: 0, show: 1, groundCover: 1, worldWater: 0, flow: 0, water: 0, sun: 0, architecture: 0, life: 0 })
}

/** Forgets what was shown, so the next apply sets everything (on entering Formation, or restarting). */
export function resetFormation() {
  shown = -1
  phase = ''
  plantsShown = ''
}

/** Gives back what Formation borrowed beyond Explore's kept state: no construction, the plants at full size, the seed's own weather. */
export function endFormation() {
  resetFormation()
  yearShown = -1
  architectureHold.until = 0
  formationScene.on = false
  formationScene.ground = 1
  formationScene.architecture = 1
  formationScene.worldWater = 1
  loading.plantGrowth = 1
  loading.creatureMarks = false
  setDiagSoft(false)
  // (The creature camera's usual framing again, for Explore.)
  worldActions.creatures.framing(null)
  environment.controls.weatherMode = 'timeline'
}
