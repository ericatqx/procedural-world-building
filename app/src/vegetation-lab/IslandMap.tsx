import { useEffect, useMemo, useRef, useState } from 'react'
import { islandBuilder, suns, type IslandFields } from '../project03/vegFields.ts'
import { zonesOf, type Conditions } from '../project03/vegPlants.ts'
import { SPECIES, communityAt, groundWeights, placementChance, shadeAdjust, shadedAt, specialistGate, stand, type Species } from '../project03/worldPlants.ts'
import { DEFAULT_TERRAIN_SEED, setTerrainSeed } from '../project03/terrain.ts'
import { currentWorld, worldFor, type World } from '../project03/world.ts'
import { currentPopulation } from '../project03/livingSelection.ts'
import { loadPopulation } from '../project03/livingOverhangAsync.ts'
import { LIGHT_STRATEGY, type Candidate } from './types.ts'

/**
 * Vegetation Lab — WHERE THIS PLANT CAN GROW, AND WHERE IT DOES. One species at a time, on the real island, read with the island's own code
 * (worldPlants.ts) on its own 16 m fields. Three answers, drawn so they cannot be confused:
 *
 *   suitability   a soft fill: the species' own rule (light, moisture, slope, water, zones), with the shade adjustment and the shade-specialist
 *                 gate. Where it CAN grow.
 *   placement     dots: the island's placement chance at each site (placementChance: suitability thinned by the community it belongs to, its
 *                 patches, clumps and clearings). Where it DOES grow, as the island decides it for its distant tiles. Each dot is a 16 m cell
 *                 drawn with that chance, so dot density is the share of sites that carry a plant, not a count of plants.
 *   structures    dashed rings: Living Architecture's day-long shade, APPROXIMATED as a disc cast away from the day's mean sun. The World
 *                 works out a structure's shade exactly, but only near the camera; this map does not pretend to.
 *
 * A second layer shows the GROUND the terrain shader draws (forest floor, moss, meadow, gravel: groundWeights), the vegetation that is a colour
 * of the ground rather than 3D plants.
 */
const PX = 3
const PLACED = '#e0402a'

type Struct = { x: number; z: number; r: number }
type Cell = { suit: number; chance: number; local: number; light: number; moisture: number; slope: number; waterDist: number; canopy: number; inShade: number; community: string }
type Computed = { n: number; cells: (Cell | null)[]; land: number; suitable: number; placed: number; added: number }
type Layer = 'species' | 'ground'

function hash(i: number, j: number, k = 0) {
  const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453
  return s - Math.floor(s)
}

const conditionsAt = (f: IslandFields, i: number, j: number): Conditions => {
  const k = j * f.n + i
  return { height: f.height[k]!, slope: f.slope[k]!, waterDepth: 0, waterDist: f.waterDist[k]!, light: f.light[k]!, moisture: f.moisture[k]!, footprint: 0, shade: 0, shelter: 0, x: f.x0 + (i + 0.5) * f.cell, z: f.x0 + (j + 0.5) * f.cell }
}

function suitAt(sp: Species, c: Conditions, seed: number) {
  const zn = zonesOf(c)
  const grove = communityAt(c, zn, stand(seed, c.x, c.z), seed, c.x, c.z).grove
  return Math.min(1, shadeAdjust(sp.id, sp.rule(c, zn), shadedAt(c)) * specialistGate(sp.id, c, grove))
}

/** The factor whose ideal value raises the suitability most, in words. */
function limitOf(sp: Species, c: Conditions, seed: number, fit: number): string {
  const tries: [string, Partial<Conditions>[]][] = [
    [c.light > 0.5 ? 'too bright' : 'too dim', [{ light: 0.15 }, { light: 0.9 }]],
    [c.moisture < 0.5 ? 'too dry' : 'too wet', [{ moisture: 0.35 }, { moisture: 0.6 }, { moisture: 0.85 }]],
    ['too steep', [{ slope: 0.05 }]],
    [c.waterDist > 20 ? 'too far from water' : 'too near water', [{ waterDist: 0 }, { waterDist: 30 }, { waterDist: 150 }]],
  ]
  let best = ''
  let gain = 0.12
  for (const [label, alts] of tries) {
    for (const a of alts) {
      const g = suitAt(sp, { ...c, ...a }, seed) - fit
      if (g > gain) [gain, best] = [g, label]
    }
  }
  return best || (fit > 0.3 ? 'well suited' : 'unsuited here')
}

const COMMUNITIES = ['grove', 'scrub', 'meadow', 'riparian', 'wetland'] as const

function compute(f: IslandFields, sp: Species, seed: number, structs: Struct[]): Computed {
  const { n } = f
  const cells: (Cell | null)[] = new Array(n * n).fill(null)
  const [sx, sz] = suns().mean
  const discs = structs.map((s) => ({ x: s.x - sx * s.r * 0.6, z: s.z - sz * s.r * 0.6, r: s.r * 1.25 }))
  let land = 0
  let suitable = 0
  let placed = 0
  let added = 0
  const wet = sp.water !== 'land'
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i
      if (!f.land[k]) continue
      const depth = f.waterDepth[k]!
      // Land plants keep to dry ground; the shore plants may stand in the shallows (as the island lets them: reeds to 0.8 m, others to 0.45 m).
      if (sp.water === 'submerged') {
        // The submerged meadow: only the lit shallows' bed, a metre or more down (as the island places it).
        if (depth < 0.95 || depth > 2.8) continue
      } else if (depth > 0 && (!wet || depth > (sp.id === 'reed' ? 0.8 : 0.45))) continue
      const c = conditionsAt(f, i, j)
      c.waterDepth = depth
      const suit = suitAt(sp, c, seed)
      const pc = placementChance(sp, c, c.x, c.z, seed)
      const comm = communityAt(c, pc.zones, stand(seed, c.x, c.z), seed, c.x, c.z)
      let inShade = 0
      for (const d of discs) {
        const q = Math.hypot(c.x - d.x, c.z - d.z) / d.r
        if (q < 1) inShade = Math.max(inShade, 0.8 * (1 - q * q))
      }
      let local = suit
      if (inShade > 0.05) {
        // The same effect the World applies (vegPlants.ts effective): shade takes light and keeps the ground damper.
        const sc: Conditions = { ...c, shade: inShade, light: c.light * (1 - 0.85 * inShade), moisture: Math.min(1, c.moisture + 0.4 * inShade * (1 - c.moisture)) }
        local = suitAt(sp, sc, seed)
      }
      land += 1
      if (suit > 0.2) suitable += 1
      else if (local > 0.2) added += 1
      placed += pc.chance
      const top = COMMUNITIES.reduce((a, b) => (comm[b] > comm[a] ? b : a), 'meadow' as (typeof COMMUNITIES)[number])
      cells[k] = { suit, chance: pc.chance, local, light: c.light, moisture: c.moisture, slope: c.slope, waterDist: c.waterDist, canopy: 0.55 * comm.grove, inShade, community: top }
    }
  }
  return { n, cells, land, suitable, placed, added }
}

/** Hillshade of the island from its height field, lit from the north-west: the land's form under every layer. */
function relief(f: IslandFields, i: number, j: number) {
  const n = f.n
  const h = (a: number, b: number) => f.height[Math.min(n - 1, Math.max(0, b)) * n + Math.min(n - 1, Math.max(0, a))]!
  const dx = (h(i + 1, j) - h(i - 1, j)) / (2 * f.cell)
  const dz = (h(i, j + 1) - h(i, j - 1)) / (2 * f.cell)
  const shade = (0.6 * dx + 0.6 * dz + 1) / Math.sqrt(1 + dx * dx + dz * dz)
  return Math.max(0.45, Math.min(1.15, shade))
}

const GROUND: { label: string; rgb: [number, number, number]; note: string }[] = [
  { label: 'Forest floor', rgb: [122, 92, 64], note: 'litter under groves and scrub' },
  { label: 'Moss', rgb: [62, 98, 74], note: 'shaded, damp ground' },
  { label: 'Meadow', rgb: [150, 160, 98], note: 'low grass on open ground' },
  { label: 'Gravel', rgb: [176, 160, 128], note: 'shorelines and scree' },
]

function draw(ctx: CanvasRenderingContext2D, f: IslandFields, layer: Layer, data: Computed | null, colour: string, seed: number, structs: Struct[]) {
  const n = f.n
  const [cr, cg, cb] = [1, 3, 5].map((o) => parseInt(colour.slice(o, o + 2), 16)) as [number, number, number]
  const img = ctx.createImageData(n * PX, n * PX)
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i
      let rgb: [number, number, number]
      if (!f.land[k]) rgb = [0, 0, 0]
      else if (f.waterDepth[k]! > 0) {
        const d = Math.min(1, f.waterDepth[k]! / 8)
        rgb = [16 - 6 * d, 38 - 12 * d, 42 - 10 * d]
      } else {
        // Quiet relief: a warm grey whose value follows the land's facing and, a little, its height.
        const sh = relief(f, i, j)
        const v = (30 + 22 * Math.min(1, f.height[k]! / 500)) * sh
        rgb = [v, v * 0.98, v * 0.93]
        if (layer === 'species' && data) {
          const c = data.cells[k]
          if (c && c.suit > 0.04) {
            const a = 0.15 + 0.6 * Math.min(1, c.suit * 1.3)
            rgb = [rgb[0] + (cr - rgb[0]) * a, rgb[1] + (cg - rgb[1]) * a, rgb[2] + (cb - rgb[2]) * a]
          }
        } else if (layer === 'ground') {
          const c = conditionsAt(f, i, j)
          const w = groundWeights(c, zonesOf(c), seed)
          for (let g = 0; g < 4; g += 1) {
            const a = Math.min(1, w[g]! * 0.9)
            const t = GROUND[g]!.rgb
            rgb = [rgb[0] + (t[0] * sh - rgb[0]) * a, rgb[1] + (t[1] * sh - rgb[1]) * a, rgb[2] + (t[2] * sh - rgb[2]) * a]
          }
        }
      }
      for (let b = 0; b < PX; b += 1) {
        for (let a = 0; a < PX; a += 1) {
          const o = ((j * PX + b) * n * PX + i * PX + a) * 4
          img.data[o] = rgb[0]
          img.data[o + 1] = rgb[1]
          img.data[o + 2] = rgb[2]
          img.data[o + 3] = 255
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0)
  if (layer === 'species' && data) {
    // Placement: a red dot where the island's own placement chance comes up (one draw per 16 m cell). Red is the editorial mark for what the
    // island actually does; the species' own colour is only what it could do.
    ctx.fillStyle = PLACED
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const c = data.cells[j * n + i]
        if (!c || c.chance <= 0) continue
        if (hash(i, j, 3) > Math.min(1, c.chance * 1.4)) continue
        ctx.fillRect(i * PX + 0.5, j * PX + 0.5, 2, 2)
      }
    }
    // What a structure's shade would add (estimated): a pale stipple, so it is never read as placement.
    ctx.fillStyle = 'rgba(232, 228, 216, 0.7)'
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const c = data.cells[j * n + i]
        if (!c || c.local - c.suit < 0.08) continue
        if (hash(i, j) > (c.local - c.suit) * 1.6) continue
        ctx.fillRect(i * PX + 1, j * PX + 1, 1, 1)
      }
    }
  }
  // Living Architecture's approximate day-long shade, as dashed rings.
  const [sx, sz] = suns().mean
  ctx.strokeStyle = 'rgba(232, 228, 216, 0.75)'
  ctx.setLineDash([2, 3])
  ctx.lineWidth = 1
  const toPx = (v: number) => ((v - f.x0) / f.cell) * PX
  for (const s of structs) {
    ctx.beginPath()
    ctx.arc(toPx(s.x - sx * s.r * 0.6), toPx(s.z - sz * s.r * 0.6), ((s.r * 1.25) / f.cell) * PX, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.setLineDash([])
}

/** The island's fields, then (separately, so the map never waits on them) its Living Architecture. */
function useIsland() {
  const [state, setState] = useState<{ fields: IslandFields; world: World } | null>(null)
  const [structs, setStructs] = useState<Struct[]>([])
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    let raf = 0
    let cancelled = false
    const t = setTimeout(() => {
      let world = currentWorld()
      if (!world) {
        // The Lab opened on its own: make the default island (the seed the World opens on).
        setTerrainSeed(DEFAULT_TERRAIN_SEED)
        world = worldFor(DEFAULT_TERRAIN_SEED)
      }
      const w = world
      const b = islandBuilder(w)
      const population = currentPopulation()
      void (population?.seed === w.seed ? Promise.resolve(population) : loadPopulation(w.seed))
        .then((p) => {
          if (!cancelled) setStructs(p.organisms.filter((o) => o.died < 0).map((o) => ({ x: o.x, z: o.z, r: Math.max(o.radius, o.height * 0.5) })))
        })
        .catch(() => undefined)
      let steps = 0
      const tick = () => {
        if (cancelled) return
        const t0 = performance.now()
        let done = false
        while (!done && performance.now() - t0 < 12) {
          done = b.step()
          steps += 1
        }
        setProgress(Math.min(0.99, steps / 18))
        if (done) setState({ fields: b.fields, world: w })
        else raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }, 30)
    return () => {
      cancelled = true
      clearTimeout(t)
      cancelAnimationFrame(raf)
    }
  }, [])
  return { state, structs, progress }
}

/** Why a candidate has no island-wide map. */
const ABSENT: Record<string, string> = {
  vine: 'Architecture-bound: the adhering vine grows only on Living Architecture (the dashed rings). The World places it on each structure’s own surfaces, at vertices chosen by their position, and only near the camera, so there is no island-wide placement to draw here.',
  curtain: 'Architecture-bound: the hanging curtain hangs only from Living Architecture’s overhangs (the dashed rings). The World places it on the structures’ own surfaces near the camera, so there is no island-wide placement to draw here.',
  brackets: 'Not placed on the island: a Lab candidate for clinging growth, not chosen for the World.',
  cushion: 'Not placed on the island: a Lab candidate for rock crevices, not chosen for the World.',
  stonewort: 'Not placed on the island: the ribbon meadow is the island’s submerged plant; this is a Lab alternative.',
}

export function IslandMap({ candidate }: { candidate: Candidate }) {
  const { state, structs, progress } = useIsland()
  const [layer, setLayer] = useState<Layer>('species')
  const [hover, setHover] = useState<(Cell & { why: string }) | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const sp = SPECIES.find((s) => s.cand === candidate.id && s.spacing > 0) ?? null
  const strategy = LIGHT_STRATEGY[candidate.light ?? 'broad']
  const data = useMemo(() => (state && sp ? compute(state.fields, sp, state.world.seed, structs) : null), [state, sp, structs])

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx || !state) return
    draw(ctx, state.fields, layer, data, strategy.colour, state.world.seed, structs)
  }, [data, state, layer, strategy.colour, structs])

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!data || !state || !sp) return
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.floor(((e.clientX - r.left) / r.width) * data.n)
    const j = Math.floor(((e.clientY - r.top) / r.height) * data.n)
    const cell = i >= 0 && j >= 0 && i < data.n && j < data.n ? data.cells[j * data.n + i] : null
    if (!cell) return setHover(null)
    setHover({ ...cell, why: limitOf(sp, conditionsAt(state.fields, i, j), state.world.seed, cell.suit) })
  }

  const pct = (v: number) => {
    if (!data) return ''
    const x = (100 * v) / Math.max(1, data.land)
    return `${x < 1 ? x.toFixed(1) : Math.round(x)}%`
  }
  return (
    <div className="vlab-map">
      <div className="vlab-map-frame">
        <canvas ref={canvas} width={256 * PX} height={256 * PX} onMouseMove={onMove} onMouseLeave={() => setHover(null)} aria-label={`Where the ${candidate.name} can grow on the island`} />
        {state ? null : <p className="vlab-map-wait">Reading the island · {Math.round(progress * 100)}%</p>}
      </div>
      <div className="vlab-map-side">
        <div className="segmented" role="radiogroup" aria-label="Map layer">
          <button type="button" role="radio" aria-checked={layer === 'species'} onClick={() => setLayer('species')}>This species</button>
          <button type="button" role="radio" aria-checked={layer === 'ground'} onClick={() => setLayer('ground')}>Ground layer</button>
        </div>
        {layer === 'ground' ? (
          <>
            <p className="vlab-map-title">Ground the terrain shader draws</p>
            <div className="vlab-legend">
              {GROUND.map((g) => (
                <p key={g.label}><i style={{ background: `rgb(${g.rgb.join(',')})` }} /> {g.label}: {g.note}</p>
              ))}
            </div>
            <p className="vlab-dim">Not 3D plants: the island’s meadow, moss and litter are colours of the ground, laid by the same communities that place the plants (groundWeights), so a grove stands on its own floor. Close to the camera the World adds 3D grass tufts and stolon mats over the meadow.</p>
          </>
        ) : sp ? (
          <>
            <p className="vlab-map-title">
              <i style={{ background: strategy.colour }} /> {candidate.name}
              <span>{strategy.label}</span>
            </p>
            <div className="vlab-legend">
              <p><i style={{ background: strategy.colour, opacity: 0.5 }} /> <b>Can grow</b>: its own rule allows it. {pct(data?.suitable ?? 0)} {sp.water === 'submerged' ? 'of the lake bed 1 to 2.8 m down' : sp.water === 'shallow' ? 'of the land and shallows' : 'of the land'}</p>
              <p><i className="dot" style={{ background: PLACED }} /> <b>Grows</b>: where the island places it, after its community, patches and clumps thin the stand. About {pct(data?.placed ?? 0)} of sites</p>
              <p><i className="stipple" /> Structure shade would add {data ? pct(data.added) : ''} (estimate)</p>
              <p><i className="ring" /> Dashed rings: Living Architecture structures, each drawn as its day-long shade (a disc set away from the day’s mean sun: an approximation)</p>
            </div>
            <dl className="vlab-probe">
              {hover ? (
                <>
                  <dt>Can grow</dt><dd>{hover.suit.toFixed(2)}{hover.local > hover.suit + 0.05 ? ` · ${hover.local.toFixed(2)} in structure shade (est.)` : ''}</dd>
                  <dt>Grows</dt><dd>{hover.chance > 0.005 ? `${Math.round(hover.chance * 100)}% of sites` : 'no'}</dd>
                  <dt>Limited by</dt><dd>{hover.why}</dd>
                  <dt>Light</dt><dd>{hover.light.toFixed(2)} day-averaged{hover.canopy > 0.05 ? ` · canopy takes ${Math.round(hover.canopy * 100)}% at the floor` : ''}</dd>
                  <dt>Moisture</dt><dd>{hover.moisture.toFixed(2)}</dd>
                  <dt>Slope</dt><dd>{Math.round(Math.atan(hover.slope) * 57.3)}°</dd>
                  <dt>Water</dt><dd>{hover.waterDist < 1 ? 'in or at the water' : `${Math.round(hover.waterDist)} m away`}</dd>
                  <dt>Community</dt><dd>{hover.community}</dd>
                </>
              ) : (
                <dd className="vlab-dim">Point at the island: whether it can grow there, whether it does, and what limits it.</dd>
              )}
            </dl>
            <p className="vlab-dim">Placement is the island’s rule for its distant tiles. Near a structure the World decides again with the structure’s exact shade, footprint and roof; the rings here only approximate that shade.</p>
          </>
        ) : (
          <>
            <p className="vlab-map-title">{candidate.name}</p>
            <p className="vlab-dim">{ABSENT[candidate.id] ?? 'Not placed on the island.'}</p>
            <p className="vlab-dim">Switch to Ground layer to see the vegetation the terrain shader draws.</p>
          </>
        )}
      </div>
    </div>
  )
}
