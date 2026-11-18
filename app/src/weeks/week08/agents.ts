/**
 * Week 08 — Agents. A small, seeded, deterministic simulation on a patch of terrain, in metres. Each agent is a finite state
 * machine (wander, seek, forage, rest) that senses only what is near it: food, shelter, water and rocks, other agents, and the
 * trail that earlier agents left on the ground. The trail is the whole point: a field that every agent writes to and reads from,
 * which decays and spreads, so paths appear without anyone planning them (stigmergy).
 *
 * Pure maths, no rendering. The same seed and settings always give the same run (one seeded random stream, a fixed time step,
 * and no dependence on frame rate).
 */

export type AgentState = 'wander' | 'seek' | 'forage' | 'rest'
/** Three behavioural archetypes: ground-bound, flying, and confined to water. */
export type Species = 'ground' | 'air' | 'water'
export const SPECIES: readonly Species[] = ['ground', 'air', 'water']
export const SPECIES_LABEL: Record<Species, string> = { ground: 'Terrestrial', air: 'Aerial', water: 'Aquatic' }
/** How many agents of each species: ground, air, water. */
export type Counts = [number, number, number]
/** The same four states, named for what each species does in them. */
export const STATE_NAME: Record<Species, Record<AgentState, string>> = {
  ground: { wander: 'Wander', seek: 'Seek food', forage: 'Forage', rest: 'Rest in shade' },
  air: { wander: 'Fly', seek: 'Seek food', forage: 'Feed', rest: 'Perch' },
  water: { wander: 'Swim', seek: 'Seek algae', forage: 'Graze', rest: 'Take refuge' },
}
export const STATES: readonly AgentState[] = ['wander', 'seek', 'forage', 'rest']
export const STATE_LABEL: Record<AgentState, string> = { wander: 'Wander', seek: 'Seek food', forage: 'Forage', rest: 'Rest' }

/** The patch: 96 m across in 64 × 64 cells of 1.5 m (the 0.3 occupancy voxel). */
export const PATCH = { size: 96, cells: 64, cell: 1.5 } as const
export const DT = 0.1
export const MAX_AGENTS = 240

export type Params = {
  /** Metres an agent can sense around itself. */
  perception: number
  /** Metres per second on level ground. */
  speed: number
  /** Seconds for a trail to fade to half. */
  halfLife: number
  /** 0 – 1: how strongly agents turn toward stronger trail. */
  pull: number
}

export const DEFAULT_PARAMS: Params = { perception: 8, speed: 1.5, halfLife: 40, pull: 0.6 }

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hash2 = (x: number, y: number, seed: number) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
const smooth = (t: number) => t * t * (3 - 2 * t)
function valueNoise(x: number, y: number, seed: number) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = smooth(x - x0)
  const fy = smooth(y - y0)
  const a = hash2(x0, y0, seed)
  const b = hash2(x0 + 1, y0, seed)
  const c = hash2(x0, y0 + 1, seed)
  const d = hash2(x0 + 1, y0 + 1, seed)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

export type Site = { x: number; z: number; amount: number }
export type Shelter = { x: number; z: number; w: number; d: number }

export const SITE_MAX = 80
const SITE_REGEN = 1
const FORAGE_TAKE = 8
const FORAGE_TIME = 4
const TRAIL_MAX = 8
const TRAIL_SPREAD = 0.1
const NUTRIENT_MAX = 4
/** Height of a perch above the ground at the slab's centre (the slab's top face). */
export const PERCH_TOP = 3.95
export const CRUISE_ALT = 9

const N = PATCH.cells
const CELL = PATCH.cell
const HALF = PATCH.size / 2

/** Terrain, water, rocks, shelters and food sites for one seed. Coordinates are metres, centred on the patch. */
export class World {
  /** Node heights, (N + 1)². */
  heights = new Float32Array((N + 1) * (N + 1))
  /** Per cell: 0 free, 1 water, 2 rock. */
  blocked = new Uint8Array(N * N)
  /** Per cell: 1 under a shelter slab. */
  sheltered = new Uint8Array(N * N)
  sites: Site[] = []
  shelters: Shelter[] = []
  waterLevel = 0
  /** Mean ground height per cell. */
  cellH = new Float32Array(N * N)
  /** Per cell: which connected body of water it belongs to, or -1. */
  lake = new Int16Array(N * N).fill(-1)
  lakeCells: number[][] = []
  /** Per cell: 1 in the deeper half of its lake (where fish take refuge). */
  deep = new Uint8Array(N * N)
  /** Lakes big enough to hold fish, largest first. */
  usableLakes: number[] = []
  /** Cells on and within 3 m of a shelter slab: the habitat the architecture makes. */
  habitat: number[] = []

  readonly seed: number

  constructor(seed: number) {
    this.seed = seed
    const rng = mulberry32(seed * 7919 + 13)
    for (let j = 0; j <= N; j += 1) {
      for (let i = 0; i <= N; i += 1) {
        const x = i * CELL
        const z = j * CELL
        const h = valueNoise(x / 38, z / 38, seed) * 0.65 + valueNoise(x / 15, z / 15, seed + 101) * 0.35
        this.heights[j * (N + 1) + i] = h * 7
      }
    }
    const sorted = Array.from(this.heights).sort((a, b) => a - b)
    this.waterLevel = sorted[Math.floor(sorted.length * 0.1)]!
    for (let j = 0; j < N; j += 1) {
      for (let i = 0; i < N; i += 1) {
        const h = (this.heights[j * (N + 1) + i]! + this.heights[j * (N + 1) + i + 1]! + this.heights[(j + 1) * (N + 1) + i]! + this.heights[(j + 1) * (N + 1) + i + 1]!) / 4
        this.cellH[j * N + i] = h
        if (h < this.waterLevel) this.blocked[j * N + i] = 1
      }
    }
    for (let k0 = 0; k0 < N * N; k0 += 1) {
      if (this.blocked[k0] !== 1 || this.lake[k0]! >= 0) continue
      const id = this.lakeCells.length
      const cells: number[] = []
      const stack = [k0]
      this.lake[k0] = id
      while (stack.length) {
        const k = stack.pop()!
        cells.push(k)
        const i = k % N
        const j = (k - i) / N
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const ni = i + di
          const nj = j + dj
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue
          const nk = nj * N + ni
          if (this.blocked[nk] === 1 && this.lake[nk]! < 0) {
            this.lake[nk] = id
            stack.push(nk)
          }
        }
      }
      this.lakeCells.push(cells)
      const deepest = Math.max(...cells.map((c) => this.waterLevel - this.cellH[c]!))
      for (const c of cells) if (this.waterLevel - this.cellH[c]! >= 0.5 * deepest) this.deep[c] = 1
    }
    this.usableLakes = this.lakeCells
      .map((cells, id) => ({ id, size: cells.length }))
      .filter((l) => l.size >= 6)
      .sort((a, b) => b.size - a.size)
      .slice(0, 3)
      .map((l) => l.id)
    const free = (x: number, z: number, r: number) => {
      for (let dz = -r; dz <= r; dz += CELL) {
        for (let dx = -r; dx <= r; dx += CELL) {
          if (this.blockedAt(x + dx, z + dz) !== 0) return false
        }
      }
      return true
    }
    for (let tries = 0; tries < 400 && this.shelters.length < 3; tries += 1) {
      const x = (rng() - 0.5) * (PATCH.size - 36)
      const z = (rng() - 0.5) * (PATCH.size - 36)
      if (!free(x, z, 8)) continue
      if (this.shelters.some((s) => Math.hypot(s.x - x, s.z - z) < 30)) continue
      this.shelters.push({ x, z, w: 14, d: 9 })
    }
    for (const s of this.shelters) {
      for (let j = 0; j < N; j += 1) {
        for (let i = 0; i < N; i += 1) {
          const cx = -HALF + (i + 0.5) * CELL
          const cz = -HALF + (j + 0.5) * CELL
          if (Math.abs(cx - s.x) <= s.w / 2 && Math.abs(cz - s.z) <= s.d / 2) this.sheltered[j * N + i] = 1
          if (Math.abs(cx - s.x) <= s.w / 2 + 3 && Math.abs(cz - s.z) <= s.d / 2 + 3 && this.blocked[j * N + i] === 0) this.habitat.push(j * N + i)
        }
      }
    }
    for (let tries = 0; tries < 800 && this.sites.length < 6; tries += 1) {
      const x = (rng() - 0.5) * (PATCH.size - 14)
      const z = (rng() - 0.5) * (PATCH.size - 14)
      if (!free(x, z, 3)) continue
      if (this.shelters.some((s) => Math.hypot(s.x - x, s.z - z) < 22)) continue
      if (this.sites.some((s) => Math.hypot(s.x - x, s.z - z) < 24)) continue
      this.sites.push({ x, z, amount: SITE_MAX })
    }
    for (let tries = 0; tries < 300 && tries < 400; tries += 1) {
      const x = (rng() - 0.5) * (PATCH.size - 6)
      const z = (rng() - 0.5) * (PATCH.size - 6)
      const k = this.cellIndex(x, z)
      if (k < 0 || this.blocked[k] !== 0 || this.sheltered[k] !== 0) continue
      if (this.sites.some((s) => Math.hypot(s.x - x, s.z - z) < 5)) continue
      if (this.shelters.some((s) => Math.abs(s.x - x) < s.w / 2 + 3 && Math.abs(s.z - z) < s.d / 2 + 3)) continue
      this.blocked[k] = 2
      if (this.blocked.reduce((n, v) => n + (v === 2 ? 1 : 0), 0) >= 14) break
    }
  }

  cellIndex(x: number, z: number): number {
    const i = Math.floor((x + HALF) / CELL)
    const j = Math.floor((z + HALF) / CELL)
    return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i
  }

  /** 0 free, 1 water, 2 rock, 3 outside the patch. */
  blockedAt(x: number, z: number): number {
    const k = this.cellIndex(x, z)
    return k < 0 ? 3 : this.blocked[k]!
  }

  heightAt(x: number, z: number): number {
    const gx = Math.min(N - 1e-6, Math.max(0, (x + HALF) / CELL))
    const gz = Math.min(N - 1e-6, Math.max(0, (z + HALF) / CELL))
    const i = Math.floor(gx)
    const j = Math.floor(gz)
    const fx = gx - i
    const fz = gz - j
    const h = this.heights
    const a = h[j * (N + 1) + i]!
    const b = h[j * (N + 1) + i + 1]!
    const c = h[(j + 1) * (N + 1) + i]!
    const d = h[(j + 1) * (N + 1) + i + 1]!
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz
  }

  /** Distance from a point to a shelter's footprint (0 inside). */
  shelterDistance(s: Shelter, x: number, z: number): number {
    const dx = Math.max(0, Math.abs(x - s.x) - s.w / 2)
    const dz = Math.max(0, Math.abs(z - s.z) - s.d / 2)
    return Math.hypot(dx, dz)
  }
}

/** How far each species senses, metres, for a given Perception setting: birds see far, fish see less through water. */
export function senseRadius(species: Species, perception: number): number {
  return species === 'air' ? Math.min(50, perception * 2.5) : species === 'water' ? Math.max(3, perception * 0.75) : perception
}

export type Metrics = {
  /** Agents in each state, all species together. */
  counts: Record<AgentState, number>
  /** The same, for ground, air and water. */
  bySpecies: Record<AgentState, number>[]
  /** Mean energy of each species, or null when it has no agents. */
  energyBy: (number | null)[]
  /** Total trail on the ground. */
  trailMass: number
  /** Share of all trail that lies in the strongest 5% of cells: near 5% is spread evenly, high is a few paths. */
  concentration: number
  /** Food left across all sites, 0 – 1. */
  food: number
  energy: number
  time: number
  /** Mean nutrient on dry ground, and in the habitat around the shelter slabs. */
  nutrient: number
  habitat: number
  /** Mean algae over water, or null with no water. */
  algae: number | null
}

export type Inspection = {
  species: Species
  state: AgentState
  energy: number
  fatigue: number
  neighbours: number
  /** Distance to the nearest food it can sense, metres, or null. */
  food: number | null
  shelter: number | null
  trail: number
  target: string
}

/** The simulation: agents as parallel arrays, one trail field, one seeded random stream. */
export class Sim {
  readonly world: World
  readonly count: number
  readonly seed: number
  x: Float32Array
  z: Float32Array
  heading: Float32Array
  state: Uint8Array
  energy: Float32Array
  fatigue: Float32Array
  timer: Float32Array
  fed: Float32Array
  /** The site or shelter an agent is heading for, or -1. */
  target: Int16Array
  memSite: Int16Array
  memShelter: Int16Array
  species: Uint8Array
  /** Height above the surface, metres (aerial agents). */
  alt: Float32Array
  /** The trail ground agents leave; the nutrient everyone leaves; the algae that nutrient feeds in water. */
  trail = new Float32Array(N * N)
  nutrient = new Float32Array(N * N)
  algae = new Float32Array(N * N)
  private scratch = new Float32Array(N * N)
  private scratchN = new Float32Array(N * N)
  private rngs: (() => number)[]
  private bucketHead = new Int32Array(24 * 24)
  private bucketNext: Int32Array
  steps = 0
  /** Agents of each species actually present (aquatic is zero on a seed with no lake). */
  readonly counts: Counts

  constructor(seed: number, counts: Counts) {
    this.seed = seed
    this.world = new World(seed)
    const w = this.world
    const want: Counts = [Math.max(0, counts[0]), Math.max(0, counts[1]), w.usableLakes.length ? Math.max(0, counts[2]) : 0]
    while (want[0] + want[1] + want[2] > MAX_AGENTS) want[0] -= 1
    this.counts = want
    this.count = want[0] + want[1] + want[2]
    // One random stream per species, so a species behaves the same whoever else is present: differences come from interaction.
    this.rngs = [mulberry32(seed * 104729 + 7), mulberry32(seed * 130363 + 11), mulberry32(seed * 15485863 + 5)]
    const n = this.count
    this.x = new Float32Array(n)
    this.z = new Float32Array(n)
    this.heading = new Float32Array(n)
    this.state = new Uint8Array(n)
    this.energy = new Float32Array(n)
    this.fatigue = new Float32Array(n)
    this.timer = new Float32Array(n)
    this.fed = new Float32Array(n)
    this.species = new Uint8Array(n)
    this.alt = new Float32Array(n)
    this.target = new Int16Array(n).fill(-1)
    this.memSite = new Int16Array(n).fill(-1)
    this.memShelter = new Int16Array(n).fill(-1)
    this.bucketNext = new Int32Array(n)
    for (const cells of w.lakeCells) for (const c of cells) this.algae[c] = 0.3
    const shelters = w.shelters
    for (let i = 0; i < n; i += 1) {
      const sp = i < want[0] ? 0 : i < want[0] + want[1] ? 1 : 2
      const si = sp === 0 ? i : sp === 1 ? i - want[0] : i - want[0] - want[1]
      const rng = this.rngs[sp]!
      this.species[i] = sp
      let x = 0
      let z = 0
      if (sp === 2) {
        const cells = w.lakeCells[w.usableLakes[si % w.usableLakes.length]!]!
        const c = cells[Math.floor(rng() * cells.length)]!
        x = -HALF + ((c % N) + 0.5) * CELL
        z = -HALF + (Math.floor(c / N) + 0.5) * CELL
        this.memShelter[i] = -1
      } else {
        // Ground agents start at home, in and around the shelters, so every journey begins from the same few places; birds start above them.
        const s = shelters[si % Math.max(1, shelters.length)]
        for (let tries = 0; tries < 20; tries += 1) {
          x = s ? s.x + (rng() - 0.5) * s.w : (rng() - 0.5) * 60
          z = s ? s.z + (rng() - 0.5) * s.d : (rng() - 0.5) * 60
          if (sp === 1 || w.blockedAt(x, z) === 0) break
        }
        this.memShelter[i] = shelters.length ? si % shelters.length : -1
        if (sp === 1) this.alt[i] = CRUISE_ALT
      }
      this.x[i] = x
      this.z[i] = z
      this.heading[i] = rng() * Math.PI * 2
      this.energy[i] = 0.5 + rng() * 0.5
      this.fatigue[i] = rng() * 0.4
    }
  }

  private open(x: number, z: number): boolean {
    return this.world.blockedAt(x, z) === 0
  }

  private trailAt(x: number, z: number): number {
    const k = this.world.cellIndex(x, z)
    return k < 0 ? 0 : this.trail[k]!
  }

  /** The nearest food site with something left within `r`, or -1. */
  private nearestSite(x: number, z: number, r: number): number {
    let best = -1
    let bestD = r
    const sites = this.world.sites
    for (let s = 0; s < sites.length; s += 1) {
      if (sites[s]!.amount < 2) continue
      const d = Math.hypot(sites[s]!.x - x, sites[s]!.z - z)
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return best
  }

  private nearestShelter(x: number, z: number, r: number): number {
    let best = -1
    let bestD = r
    const shelters = this.world.shelters
    for (let s = 0; s < shelters.length; s += 1) {
      const d = this.world.shelterDistance(shelters[s]!, x, z)
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return best
  }

  private turnToward(i: number, angle: number, rate: number) {
    let d = angle - this.heading[i]!
    d = Math.atan2(Math.sin(d), Math.cos(d))
    this.heading[i] = this.heading[i]! + Math.max(-rate, Math.min(rate, d))
  }

  private buildBuckets() {
    this.bucketHead.fill(-1)
    for (let i = 0; i < this.count; i += 1) {
      const bx = Math.min(23, Math.max(0, Math.floor((this.x[i]! + HALF) / 4)))
      const bz = Math.min(23, Math.max(0, Math.floor((this.z[i]! + HALF) / 4)))
      const b = bz * 24 + bx
      this.bucketNext[i] = this.bucketHead[b]!
      this.bucketHead[b] = i
    }
  }

  /** Calls `visit` for each other agent within `r`. */
  private forNeighbours(i: number, r: number, visit: (j: number, d: number) => void) {
    const x = this.x[i]!
    const z = this.z[i]!
    const reach = Math.ceil(r / 4)
    const bx = Math.min(23, Math.max(0, Math.floor((x + HALF) / 4)))
    const bz = Math.min(23, Math.max(0, Math.floor((z + HALF) / 4)))
    for (let oz = -reach; oz <= reach; oz += 1) {
      for (let ox = -reach; ox <= reach; ox += 1) {
        const cx = bx + ox
        const cz = bz + oz
        if (cx < 0 || cz < 0 || cx >= 24 || cz >= 24) continue
        for (let j = this.bucketHead[cz * 24 + cx]!; j >= 0; j = this.bucketNext[j]!) {
          if (j === i) continue
          const d = Math.hypot(this.x[j]! - x, this.z[j]! - z)
          if (d <= r) visit(j, d)
        }
      }
    }
  }

  step(p: Params) {
    this.buildBuckets()
    for (let i = 0; i < this.count; i += 1) {
      const sp = this.species[i]
      if (sp === 1) this.stepAir(i, p)
      else if (sp === 2) this.stepWater(i, p)
      else this.stepGround(i, p)
    }
    this.updateFields(p)
    this.steps += 1
  }

  /** Terrestrial: walks on dry ground, senses food and shade within R, follows trail, avoids water and rocks. */
  private stepGround(i: number, p: Params) {
    const w = this.world
    const rng = this.rngs[0]!
    const R = p.perception
    const lookAhead = Math.min(8, Math.max(2, R * 0.6))

    {
      const x = this.x[i]!
      const z = this.z[i]!
      const k = w.cellIndex(x, z)
      const inShelter = k >= 0 && w.sheltered[k] === 1
      let st = this.state[i]!
      const hungry = this.energy[i]! < 0.7
      const tired = this.fatigue[i]! > 0.7

      // ── Transitions ──────────────────────────────────────────────
      if (st === 0) {
        if (tired) {
          st = 3
          this.target[i] = this.nearestShelter(x, z, R)
          if (this.target[i]! < 0) this.target[i] = this.memShelter[i]!
        } else if (hungry) {
          let t = this.nearestSite(x, z, R)
          if (t < 0) {
            // Another agent foraging nearby is information too: it knows where food is.
            this.forNeighbours(i, R, (j) => {
              if (t < 0 && this.species[j] === 0 && this.state[j] === 2 && this.target[j]! >= 0 && w.sites[this.target[j]!]!.amount >= 2) t = this.target[j]!
            })
          }
          if (t < 0 && this.memSite[i]! >= 0 && w.sites[this.memSite[i]!]!.amount >= 2) t = this.memSite[i]!
          if (t >= 0) {
            st = 1
            this.target[i] = t
          }
        }
      } else if (st === 1) {
        const t = this.target[i]!
        if (this.fatigue[i]! > 0.85) {
          st = 3
          this.target[i] = this.memShelter[i]!
        } else if (t < 0 || w.sites[t]!.amount < 2) {
          this.memSite[i] = -1
          this.target[i] = -1
          st = 0
        } else if (Math.hypot(w.sites[t]!.x - x, w.sites[t]!.z - z) < 2.2) {
          st = 2
          this.timer[i] = FORAGE_TIME
        }
      } else if (st === 2) {
        const t = this.target[i]!
        this.timer[i] = this.timer[i]! - DT
        const site = w.sites[t]!
        const take = Math.min(site.amount, (FORAGE_TAKE / FORAGE_TIME) * DT)
        site.amount -= take
        this.energy[i] = Math.min(1, this.energy[i]! + (0.5 / FORAGE_TIME) * DT)
        if (this.timer[i]! <= 0 || site.amount < 1) {
          this.memSite[i] = t
          this.fed[i] = 40
          this.target[i] = -1
          st = 0
        }
      } else {
        // Rest: find shelter, then recover under it.
        if (this.target[i]! < 0) {
          const s = this.nearestShelter(x, z, R)
          this.target[i] = s >= 0 ? s : this.memShelter[i]!
        }
        if (inShelter) {
          const s = this.nearestShelter(x, z, 0.01)
          if (s >= 0) this.memShelter[i] = s
          if (this.fatigue[i]! < 0.15) {
            st = 0
            this.target[i] = -1
          }
        }
      }
      this.state[i] = st

      // ── Needs ───────────────────────────────────────────────────
      const moving = st !== 2 && !(st === 3 && inShelter)
      if (st === 3 && inShelter) this.fatigue[i] = Math.max(0, this.fatigue[i]! - 0.08 * DT * (1 + 0.6 * Math.min(1, this.nutrient[k]!)))
      if (moving) {
        const heat = inShelter ? 0.5 : 1.5
        this.fatigue[i] = Math.min(1, this.fatigue[i]! + 0.007 * heat * DT)
        this.energy[i] = Math.max(0, this.energy[i]! - 0.009 * DT)
      } else {
        this.energy[i] = Math.max(0, this.energy[i]! - 0.003 * DT)
      }
      this.fed[i] = Math.max(0, this.fed[i]! - DT)
      if (k >= 0) this.addNutrient(k, st === 3 && inShelter ? 0.05 : st === 2 ? 0.025 : 0.012)
      if (!moving) return

      // ── Steering ─────────────────────────────────────────────────
      const t = this.target[i]!
      let h = this.heading[i]!
      if (st === 1 && t >= 0) {
        this.turnToward(i, Math.atan2(w.sites[t]!.x - x, w.sites[t]!.z - z), 0.35)
      } else if (st === 3 && t >= 0) {
        const s = w.shelters[t]!
        this.turnToward(i, Math.atan2(s.x - x, s.z - z), 0.35)
      } else {
        // Wandering (or resting with nowhere known to go): jitter, and lean toward stronger trail.
        this.heading[i] = h + (rng() - 0.5) * 0.3
        if (p.pull > 0) {
          h = this.heading[i]!
          const l = this.trailAt(x + Math.sin(h - 0.7) * lookAhead, z + Math.cos(h - 0.7) * lookAhead)
          const c = this.trailAt(x + Math.sin(h) * lookAhead, z + Math.cos(h) * lookAhead)
          const r = this.trailAt(x + Math.sin(h + 0.7) * lookAhead, z + Math.cos(h + 0.7) * lookAhead)
          const top = Math.max(l, c, r)
          if (top > 0.05) {
            const turn = 0.32 * p.pull
            if (l > c && l >= r) this.heading[i] = h - turn
            else if (r > c && r > l) this.heading[i] = h + turn
          }
        }
      }
      // Keep off water, rocks and the edge: look ahead, and swing to whichever side is free.
      h = this.heading[i]!
      if (!this.open(x + Math.sin(h) * 2.5, z + Math.cos(h) * 2.5)) {
        const left = this.open(x + Math.sin(h - 0.9) * 2.5, z + Math.cos(h - 0.9) * 2.5)
        const right = this.open(x + Math.sin(h + 0.9) * 2.5, z + Math.cos(h + 0.9) * 2.5)
        this.heading[i] = h + (left && !right ? -0.5 : right && !left ? 0.5 : rng() < 0.5 ? -0.5 : 0.5)
      }
      // Keep apart from neighbours.
      let ax = 0
      let az = 0
      this.forNeighbours(i, 1.6, (j, d) => {
        if (this.species[j] !== 0) return
        const f = (1.6 - d) / 1.6
        ax += ((x - this.x[j]!) / Math.max(0.05, d)) * f
        az += ((z - this.z[j]!) / Math.max(0.05, d)) * f
      })
      if (ax !== 0 || az !== 0) this.turnToward(i, Math.atan2(ax, az), 0.2)

      // ── Movement ─────────────────────────────────────────────────
      h = this.heading[i]!
      const h0 = w.heightAt(x, z)
      const dist = p.speed * DT
      const nx = x + Math.sin(h) * dist
      const nz = z + Math.cos(h) * dist
      if (this.open(nx, nz)) {
        const slope = (w.heightAt(nx, nz) - h0) / Math.max(1e-3, dist)
        const factor = Math.max(0.45, Math.min(1.3, 1 - 0.6 * slope)) * (1 - 0.4 * this.fatigue[i]!) * (this.energy[i]! <= 0.02 ? 0.5 : 1)
        const mx = x + Math.sin(h) * dist * factor
        const mz = z + Math.cos(h) * dist * factor
        if (this.open(mx, mz)) {
          this.x[i] = mx
          this.z[i] = mz
        }
      } else {
        this.heading[i] = h + Math.PI / 2 + rng()
      }
      // Leave a trace: stronger after a meal, or when heading straight for something.
      const kk = w.cellIndex(this.x[i]!, this.z[i]!)
      if (kk >= 0) {
        const amount = 0.12 * (this.fed[i]! > 0 ? 6 : 1) * (st === 1 ? 3 : 1)
        this.trail[kk] = Math.min(TRAIL_MAX, this.trail[kk]! + amount)
      }
    }

  }

  private addNutrient(k: number, amount: number) {
    this.nutrient[k] = Math.min(NUTRIENT_MAX, this.nutrient[k]! + amount)
  }

  private cellX(c: number) {
    return -HALF + ((c % N) + 0.5) * CELL
  }

  private cellZ(c: number) {
    return -HALF + (Math.floor(c / N) + 0.5) * CELL
  }

  /** Aerial: flies over everything, sees far, ignores the trail, perches on the shelter slabs and feeds at the same food sites. */
  private stepAir(i: number, p: Params) {
    const w = this.world
    const rng = this.rngs[1]!
    const R = Math.min(50, p.perception * 2.5)
    const x = this.x[i]!
    const z = this.z[i]!
    const k = w.cellIndex(x, z)
    const surface = Math.max(w.heightAt(x, z), w.waterLevel)
    let st = this.state[i]!
    const hungry = this.energy[i]! < 0.7
    const tired = this.fatigue[i]! > 0.7
    const slab = this.target[i]! >= 0 && st === 3 ? w.shelters[this.target[i]!] : undefined
    const perchAlt = slab ? w.heightAt(slab.x, slab.z) + PERCH_TOP - surface + 0.2 : 0
    const perched = st === 3 && slab !== undefined && w.shelterDistance(slab, x, z) < 0.5 && Math.abs(this.alt[i]! - perchAlt) < 0.3

    if (st === 0) {
      if (tired) {
        st = 3
        const s = this.nearestShelter(x, z, R)
        this.target[i] = s >= 0 ? s : this.memShelter[i]!
      } else if (hungry) {
        let t = this.nearestSite(x, z, R)
        if (t < 0 && this.memSite[i]! >= 0 && w.sites[this.memSite[i]!]!.amount >= 2) t = this.memSite[i]!
        if (t >= 0) {
          st = 1
          this.target[i] = t
        }
      }
    } else if (st === 1) {
      const t = this.target[i]!
      if (this.fatigue[i]! > 0.85) {
        st = 3
        this.target[i] = this.memShelter[i]!
      } else if (t < 0 || w.sites[t]!.amount < 2) {
        this.memSite[i] = -1
        this.target[i] = -1
        st = 0
      } else if (Math.hypot(w.sites[t]!.x - x, w.sites[t]!.z - z) < 2.2) {
        st = 2
        this.timer[i] = FORAGE_TIME
      }
    } else if (st === 2) {
      const t = this.target[i]!
      this.timer[i] = this.timer[i]! - DT
      const site = w.sites[t]!
      site.amount -= Math.min(site.amount, (FORAGE_TAKE / FORAGE_TIME) * DT)
      this.energy[i] = Math.min(1, this.energy[i]! + (0.5 / FORAGE_TIME) * DT)
      if (this.timer[i]! <= 0 || site.amount < 1) {
        this.memSite[i] = t
        this.target[i] = -1
        st = 0
      }
    } else {
      if (this.target[i]! < 0) {
        const s = this.nearestShelter(x, z, R)
        this.target[i] = s >= 0 ? s : this.memShelter[i]!
      }
      if (perched) {
        this.memShelter[i] = this.target[i]!
        if (this.fatigue[i]! < 0.15) {
          st = 0
          this.target[i] = -1
        }
      }
    }
    this.state[i] = st

    // Altitude: cruise high, glide down to food, settle on the slab's top face.
    const t = this.target[i]!
    let want = CRUISE_ALT
    if (st === 1 && t >= 0) want = Math.min(CRUISE_ALT, 1 + Math.hypot(w.sites[t]!.x - x, w.sites[t]!.z - z) * 0.4)
    else if (st === 2) want = 0.9
    else if (st === 3 && t >= 0) {
      const s = w.shelters[t]!
      if (w.shelterDistance(s, x, z) < 5) want = w.heightAt(s.x, s.z) + PERCH_TOP - surface + 0.2
    }
    this.alt[i] = this.alt[i]! + Math.max(-3 * DT, Math.min(3 * DT, want - this.alt[i]!))

    const moving = st !== 2 && !perched
    if (perched) {
      this.fatigue[i] = Math.max(0, this.fatigue[i]! - 0.1 * DT * (1 + 0.6 * Math.min(1, k >= 0 ? this.nutrient[k]! : 0)))
      this.energy[i] = Math.max(0, this.energy[i]! - 0.002 * DT)
    } else if (moving) {
      this.fatigue[i] = Math.min(1, this.fatigue[i]! + 0.01 * DT)
      this.energy[i] = Math.max(0, this.energy[i]! - 0.014 * DT)
    } else {
      this.energy[i] = Math.max(0, this.energy[i]! - 0.004 * DT)
    }
    if (k >= 0) this.addNutrient(k, perched ? 0.07 : 0.012)
    if (!moving) return

    if (st === 1 && t >= 0) this.turnToward(i, Math.atan2(w.sites[t]!.x - x, w.sites[t]!.z - z), 0.3)
    else if (st === 3 && t >= 0) this.turnToward(i, Math.atan2(w.shelters[t]!.x - x, w.shelters[t]!.z - z), 0.3)
    else this.heading[i] = this.heading[i]! + (rng() - 0.5) * 0.14
    if (Math.abs(x) > HALF - 5 || Math.abs(z) > HALF - 5) this.turnToward(i, Math.atan2(-x, -z), 0.3)
    let ax = 0
    let az = 0
    this.forNeighbours(i, 3, (j, d) => {
      if (this.species[j] !== 1) return
      ax += (x - this.x[j]!) / Math.max(0.05, d)
      az += (z - this.z[j]!) / Math.max(0.05, d)
    })
    if (ax !== 0 || az !== 0) this.turnToward(i, Math.atan2(ax, az), 0.12)
    const h = this.heading[i]!
    const dist = p.speed * 2.2 * DT * (1 - 0.3 * this.fatigue[i]!) * (this.energy[i]! <= 0.02 ? 0.6 : 1)
    this.x[i] = Math.max(-HALF + 1, Math.min(HALF - 1, x + Math.sin(h) * dist))
    this.z[i] = Math.max(-HALF + 1, Math.min(HALF - 1, z + Math.cos(h) * dist))
  }

  /** The richest algae cell, or the nearest deep-water cell, within `r` in the same body of water; -1 if none. */
  private scanLake(x: number, z: number, r: number, lakeId: number, kind: 'algae' | 'deep'): number {
    const w = this.world
    const ci = Math.floor((x + HALF) / CELL)
    const cj = Math.floor((z + HALF) / CELL)
    const reach = Math.ceil(r / CELL)
    let best = -1
    let bestScore = -Infinity
    for (let dj = -reach; dj <= reach; dj += 1) {
      for (let di = -reach; di <= reach; di += 1) {
        const i = ci + di
        const j = cj + dj
        if (i < 0 || j < 0 || i >= N || j >= N) continue
        const c = j * N + i
        if (w.lake[c] !== lakeId) continue
        const d = Math.hypot(di * CELL, dj * CELL)
        if (d > r) continue
        const score = kind === 'algae' ? (this.algae[c]! >= 0.35 ? this.algae[c]! - d * 0.02 : -Infinity) : w.deep[c] === 1 ? -d : -Infinity
        if (score > bestScore) {
          bestScore = score
          best = c
        }
      }
    }
    return best
  }

  /** Aquatic: swims only within its own connected body of water, grazes algae, takes refuge in the deep. */
  private stepWater(i: number, p: Params) {
    const w = this.world
    const rng = this.rngs[2]!
    const Rw = Math.max(3, p.perception * 0.75)
    const x = this.x[i]!
    const z = this.z[i]!
    const k = w.cellIndex(x, z)
    if (k < 0) return
    const lakeId = w.lake[k]!
    const inDeep = w.deep[k] === 1
    let st = this.state[i]!
    const hungry = this.energy[i]! < 0.7
    const tired = this.fatigue[i]! > 0.7

    if (st === 0) {
      if (tired) {
        st = 3
        const c = this.scanLake(x, z, Rw, lakeId, 'deep')
        this.target[i] = c >= 0 ? c : this.memShelter[i]!
      } else if (hungry && (this.steps + i) % 4 === 0) {
        let c = this.scanLake(x, z, Rw, lakeId, 'algae')
        const m = this.memSite[i]!
        if (c < 0 && m >= 0 && w.lake[m] === lakeId && this.algae[m]! >= 0.35) c = m
        if (c >= 0) {
          st = 1
          this.target[i] = c
        }
      }
    } else if (st === 1) {
      const c = this.target[i]!
      if (this.fatigue[i]! > 0.85) {
        st = 3
        this.target[i] = this.memShelter[i]!
      } else if (c < 0 || this.algae[c]! < 0.2) {
        this.memSite[i] = -1
        this.target[i] = -1
        st = 0
      } else if (Math.hypot(this.cellX(c) - x, this.cellZ(c) - z) < 1.2) {
        st = 2
        this.timer[i] = FORAGE_TIME
      }
    } else if (st === 2) {
      const c = this.target[i]!
      this.timer[i] = this.timer[i]! - DT
      const a = this.algae[c]!
      const take = Math.min(0.004, Math.max(0, a - 0.05))
      this.algae[c] = a - take
      this.energy[i] = Math.min(1, this.energy[i]! + take * 3)
      if (this.timer[i]! <= 0 || a < 0.08) {
        this.memSite[i] = c
        this.target[i] = -1
        st = 0
      }
    } else {
      if (this.target[i]! < 0) {
        const c = this.scanLake(x, z, Rw, lakeId, 'deep')
        this.target[i] = c >= 0 ? c : this.memShelter[i]!
      }
      if (inDeep) {
        this.memShelter[i] = k
        this.fatigue[i] = Math.max(0, this.fatigue[i]! - 0.06 * DT)
        if (this.fatigue[i]! < 0.15) {
          st = 0
          this.target[i] = -1
        }
      }
    }
    this.state[i] = st

    this.addNutrient(k, 0.004)
    // Shallow, open water stresses a fish; deep water slowly calms it.
    this.fatigue[i] = Math.max(0, Math.min(1, this.fatigue[i]! + (inDeep ? -0.01 : 0.006) * DT))
    if (st === 2) {
      this.energy[i] = Math.max(0, this.energy[i]! - 0.003 * DT)
      return
    }
    this.energy[i] = Math.max(0, this.energy[i]! - 0.008 * DT)

    const t = this.target[i]!
    if ((st === 1 || st === 3) && t >= 0) this.turnToward(i, Math.atan2(this.cellX(t) - x, this.cellZ(t) - z), 0.35)
    else this.heading[i] = this.heading[i]! + (rng() - 0.5) * 0.5
    // Stay in this body of water: look ahead, and swing to whichever side is still water.
    const water = (hh: number, d: number) => {
      const c = w.cellIndex(x + Math.sin(hh) * d, z + Math.cos(hh) * d)
      return c >= 0 && w.lake[c] === lakeId
    }
    let h = this.heading[i]!
    if (!water(h, 1.8)) {
      const left = water(h - 0.9, 1.8)
      const right = water(h + 0.9, 1.8)
      this.heading[i] = h + (left && !right ? -0.6 : right && !left ? 0.6 : rng() < 0.5 ? -0.6 : 0.6)
    }
    let ax = 0
    let az = 0
    this.forNeighbours(i, 1.2, (j, d) => {
      if (this.species[j] !== 2) return
      ax += (x - this.x[j]!) / Math.max(0.05, d)
      az += (z - this.z[j]!) / Math.max(0.05, d)
    })
    if (ax !== 0 || az !== 0) this.turnToward(i, Math.atan2(ax, az), 0.2)
    h = this.heading[i]!
    const dist = p.speed * 0.8 * DT * (1 - 0.3 * this.fatigue[i]!) * (this.energy[i]! <= 0.02 ? 0.5 : 1)
    const nx = x + Math.sin(h) * dist
    const nz = z + Math.cos(h) * dist
    const nc = w.cellIndex(nx, nz)
    if (nc >= 0 && w.lake[nc] === lakeId) {
      this.x[i] = nx
      this.z[i] = nz
    } else {
      this.heading[i] = h + Math.PI / 2 + rng()
    }
  }

  /** The ground and water: trail decays and spreads; nutrient spreads (across the shore too) and fades; algae follows nutrient; food regrows faster where it is rich. */
  private updateFields(p: Params) {
    const w = this.world
    const decay = Math.pow(0.5, DT / Math.max(1, p.halfLife))
    const s = this.scratch
    const t = this.trail
    const n = this.nutrient
    const sn = this.scratchN
    for (let j = 0; j < N; j += 1) {
      for (let i = 0; i < N; i += 1) {
        const k = j * N + i
        const l = i > 0 ? t[k - 1]! : t[k]!
        const r = i < N - 1 ? t[k + 1]! : t[k]!
        const u = j > 0 ? t[k - N]! : t[k]!
        const d = j < N - 1 ? t[k + N]! : t[k]!
        s[k] = (t[k]! * (1 - TRAIL_SPREAD) + ((l + r + u + d) / 4) * TRAIL_SPREAD) * decay
        const nl = i > 0 ? n[k - 1]! : n[k]!
        const nr = i < N - 1 ? n[k + 1]! : n[k]!
        const nu = j > 0 ? n[k - N]! : n[k]!
        const nd = j < N - 1 ? n[k + N]! : n[k]!
        sn[k] = (n[k]! * 0.94 + ((nl + nr + nu + nd) / 4) * 0.06) * 0.9992
      }
    }
    t.set(s)
    n.set(sn)
    for (const cells of w.lakeCells) {
      for (const c of cells) {
        const want = 0.3 + 0.6 * Math.min(1, n[c]!)
        this.algae[c] = this.algae[c]! + 0.01 * (want - this.algae[c]!)
      }
    }
    for (const site of w.sites) {
      const k = w.cellIndex(site.x, site.z)
      const rich = k >= 0 ? Math.min(1.5, n[k]!) : 0
      site.amount = Math.min(SITE_MAX, site.amount + SITE_REGEN * DT * (1 + 2 * rich))
    }
  }

  metrics(): Metrics {
    const blank = (): Record<AgentState, number> => ({ wander: 0, seek: 0, forage: 0, rest: 0 })
    const counts = blank()
    const bySpecies = [blank(), blank(), blank()]
    const e = [0, 0, 0]
    let energy = 0
    for (let i = 0; i < this.count; i += 1) {
      const st = STATES[this.state[i]!]!
      counts[st] += 1
      bySpecies[this.species[i]!]![st] += 1
      e[this.species[i]!]! += this.energy[i]!
      energy += this.energy[i]!
    }
    let mass = 0
    for (let k = 0; k < this.trail.length; k += 1) mass += this.trail[k]!
    const sorted = Float32Array.from(this.trail).sort()
    let top = 0
    const topN = Math.ceil(sorted.length * 0.05)
    for (let k = sorted.length - topN; k < sorted.length; k += 1) top += sorted[k]!
    let food = 0
    for (const s of this.world.sites) food += s.amount
    let dry = 0
    let dryN = 0
    for (let k = 0; k < N * N; k += 1) {
      if (this.world.blocked[k] !== 1) {
        dry += this.nutrient[k]!
        dryN += 1
      }
    }
    let hab = 0
    for (const c of this.world.habitat) hab += this.nutrient[c]!
    let alg = 0
    let algN = 0
    for (const cells of this.world.lakeCells) {
      for (const c of cells) {
        alg += this.algae[c]!
        algN += 1
      }
    }
    return {
      counts,
      bySpecies,
      energyBy: e.map((v, sp) => (this.counts[sp]! > 0 ? v / this.counts[sp]! : null)),
      trailMass: mass,
      concentration: mass > 20 ? top / mass : 0,
      food: food / (SITE_MAX * Math.max(1, this.world.sites.length)),
      energy: this.count ? energy / this.count : 0,
      time: this.steps * DT,
      nutrient: dryN ? dry / dryN : 0,
      habitat: this.world.habitat.length ? hab / this.world.habitat.length : 0,
      algae: algN ? alg / algN : null,
    }
  }

  /** Where an agent is drawn: on the ground, in the air above it, or just under the water's surface. */
  yOf(i: number): number {
    const w = this.world
    const sp = this.species[i]
    const x = this.x[i]!
    const z = this.z[i]!
    if (sp === 1) return Math.max(w.heightAt(x, z), w.waterLevel) + this.alt[i]! + 0.25
    if (sp === 2) return w.waterLevel - 0.35
    return w.heightAt(x, z) + 0.4
  }

  /** The ground (or water surface) beneath an agent: where an aerial agent's shadow falls. */
  surfaceAt(i: number): number {
    return Math.max(this.world.heightAt(this.x[i]!, this.z[i]!), this.world.waterLevel)
  }

  inspect(i: number, p: Params): Inspection {
    const w = this.world
    const x = this.x[i]!
    const z = this.z[i]!
    const sp = this.species[i]!
    const st = STATES[this.state[i]!]!
    const t = this.target[i]!
    let neighbours = 0
    this.buildBuckets()
    const R = sp === 1 ? Math.min(50, p.perception * 2.5) : sp === 2 ? Math.max(3, p.perception * 0.75) : p.perception
    this.forNeighbours(i, R, (j) => {
      if (this.species[j] === sp) neighbours += 1
    })
    let food: number | null = null
    let shelter: number | null = null
    let target = 'none'
    if (sp === 2) {
      const k = w.cellIndex(x, z)
      const lake = k >= 0 ? w.lake[k]! : -1
      const a = this.scanLake(x, z, R, lake, 'algae')
      const d = this.scanLake(x, z, R, lake, 'deep')
      food = a >= 0 ? Math.hypot(this.cellX(a) - x, this.cellZ(a) - z) : null
      shelter = d >= 0 ? Math.hypot(this.cellX(d) - x, this.cellZ(d) - z) : null
      target = t < 0 ? 'none' : st === 'rest' ? 'deep water' : 'algae'
    } else {
      const site = this.nearestSite(x, z, R)
      const slab = this.nearestShelter(x, z, R)
      food = site >= 0 ? Math.hypot(w.sites[site]!.x - x, w.sites[site]!.z - z) : null
      shelter = slab >= 0 ? w.shelterDistance(w.shelters[slab]!, x, z) : null
      target = t < 0 ? 'none' : st === 'rest' ? `shelter ${t + 1}` : `food ${t + 1}`
    }
    const k = w.cellIndex(x, z)
    return { species: SPECIES[sp]!, state: st, energy: this.energy[i]!, fatigue: this.fatigue[i]!, neighbours, food, shelter, trail: k >= 0 ? this.trail[k]! : 0, target }
  }

  /** A short fingerprint of every agent's place and state, to compare runs. */
  checksum(): string {
    let a = 0
    let b = 0
    for (let i = 0; i < this.count; i += 1) {
      a = (a * 31 + Math.round(this.x[i]! * 100) + this.state[i]! * 7) % 1000000007
      b = (b * 17 + Math.round(this.z[i]! * 100) + Math.round(this.alt[i]! * 10)) % 1000000007
    }
    return `${a.toString(16)}-${b.toString(16)}`
  }
}

export type RunSummary = {
  label: string
  counts: Counts
  /** Mean energy per species over the second half of the run, or null if absent. */
  energy: (number | null)[]
  /** Food left, nutrient in the habitat around the slabs, and algae, as time-averages over the second half. */
  food: number
  habitat: number
  algae: number | null
  concentration: number
}

/**
 * The same seed run four times: everyone together, then each species alone with the same number of agents. Because each species has
 * its own random stream, a species behaves the same alone as in company unless something it shares has changed.
 */
export function compareRuns(seed: number, counts: Counts, p: Params, seconds = 120): RunSummary[] {
  const configs: [string, Counts][] = [
    ['Mixed', counts],
    ['Terrestrial only', [counts[0], 0, 0]],
    ['Aerial only', [0, counts[1], 0]],
    ['Aquatic only', [0, 0, counts[2]]],
  ]
  const out: RunSummary[] = []
  for (const [label, c] of configs) {
    if (c[0] + c[1] + c[2] === 0) continue
    const sim = new Sim(seed, c)
    const total = Math.round(seconds / DT)
    const energy = [0, 0, 0]
    const have = [0, 0, 0]
    let food = 0
    let habitat = 0
    let algae = 0
    let algaeN = 0
    let conc = 0
    let samples = 0
    for (let k = 1; k <= total; k += 1) {
      sim.step(p)
      if (k > total / 2 && k % 25 === 0) {
        const m = sim.metrics()
        samples += 1
        food += m.food
        habitat += m.habitat
        conc += m.concentration
        if (m.algae !== null) {
          algae += m.algae
          algaeN += 1
        }
        m.energyBy.forEach((v, sp) => {
          if (v !== null) {
            energy[sp]! += v
            have[sp]! += 1
          }
        })
      }
    }
    out.push({
      label,
      counts: sim.counts,
      energy: energy.map((v, sp) => (have[sp]! > 0 ? v / have[sp]! : null)),
      food: samples ? food / samples : 0,
      habitat: samples ? habitat / samples : 0,
      algae: algaeN ? algae / algaeN : null,
      concentration: samples ? conc / samples : 0,
    })
  }
  return out
}
