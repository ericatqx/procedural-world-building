import { BufferAttribute, BufferGeometry, Color, CylinderGeometry, IcosahedronGeometry, LatheGeometry, Vector2 } from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { STRIDE, type SpeciesId } from '../../project03/worldPlants.ts'
import { groundEye, SITE, type StudyOrganism, type StudySite } from '../site.ts'
import type { Landform } from './landform.ts'
import { merge } from './landform.ts'
import { PAL } from './palette.ts'

// ------------------------------------------------------------------------------------------------------------- the architecture

/**
 * An organism carved: its own mesh, its vertices gathered onto a coarse lattice (vertex clustering) so its surface becomes broad planes while its
 * silhouette stays, then drawn flat, one colour per face by what the face is: the lit tops of its shelves chalk, its walls stone in strata, its
 * undersides and hollows terracotta, its footing darker stone. A young organism's tissue is paler and greener: growth you can see.
 */
export function carve(o: StudyOrganism, land: Landform): { geometry: BufferGeometry; outline: BufferGeometry } {
  const src = o.geometry.index ? o.geometry : mergeVertices(o.geometry)
  const cell = o.index === 0 ? 1.15 : 0.7
  const pos = src.getAttribute('position')
  const idx = src.index!
  const key = new Map<string, number>()
  const sums: number[] = []
  const remap = new Int32Array(pos.count)
  for (let v = 0; v < pos.count; v += 1) {
    const k = `${Math.floor(pos.getX(v) / cell)},${Math.floor(pos.getY(v) / cell)},${Math.floor(pos.getZ(v) / cell)}`
    let c = key.get(k)
    if (c === undefined) {
      c = key.size
      key.set(k, c)
      sums.push(0, 0, 0, 0)
    }
    sums[c * 4]! += pos.getX(v)
    sums[c * 4 + 1]! += pos.getY(v)
    sums[c * 4 + 2]! += pos.getZ(v)
    sums[c * 4 + 3]! += 1
    remap[v] = c
  }
  const cpos = new Float32Array(key.size * 3)
  for (let c = 0; c < key.size; c += 1) cpos.set([sums[c * 4]! / sums[c * 4 + 3]!, sums[c * 4 + 1]! / sums[c * 4 + 3]!, sums[c * 4 + 2]! / sums[c * 4 + 3]!], c * 3)
  const tris: number[] = []
  const seen = new Set<string>()
  for (let t = 0; t < idx.count; t += 3) {
    const a = remap[idx.getX(t)]!
    const b = remap[idx.getX(t + 1)]!
    const c = remap[idx.getX(t + 2)]!
    if (a === b || b === c || a === c) continue
    const k = [a, b, c].sort((p, q) => p - q).join(',')
    if (seen.has(k)) continue
    seen.add(k)
    tris.push(a, b, c)
  }
  // Taubin smoothing (a shrink step, then a swell step): the lattice's teeth are taken off, the masses keep their size.
  const nbrs: number[][] = Array.from({ length: key.size }, () => [])
  for (let t = 0; t < tris.length; t += 3) {
    for (let e = 0; e < 3; e += 1) {
      const a = tris[t + e]!
      const b = tris[t + ((e + 1) % 3)]!
      nbrs[a]!.push(b)
      nbrs[b]!.push(a)
    }
  }
  const relax = (f: number) => {
    const next = new Float32Array(cpos)
    for (let v = 0; v < key.size; v += 1) {
      const nb = nbrs[v]!
      if (!nb.length) continue
      for (let q = 0; q < 3; q += 1) {
        let m = 0
        for (const u of nb) m += cpos[u * 3 + q]!
        m /= nb.length
        next[v * 3 + q] = cpos[v * 3 + q]! + f * (m - cpos[v * 3 + q]!)
      }
    }
    cpos.set(next)
  }
  for (let r = 0; r < 3; r += 1) {
    relax(0.55)
    relax(-0.58)
  }
  // Lit smooth (the ramp's three tones cut the form into broad planes of light, turn and shadow, which is the carving), coloured flat: one colour
  // per face, so the strata and the hollows have clean edges rather than smears.
  const outline = new BufferGeometry()
  outline.setAttribute('position', new BufferAttribute(cpos, 3))
  outline.setIndex(tris)
  outline.computeVertexNormals()
  const flat = outline.toNonIndexed()

  const fp = flat.getAttribute('position')
  const fn = flat.getAttribute('normal')
  const col = new Float32Array(fp.count * 3)
  const young = o.index !== 0 && o.staged
  const chalk = new Color(young ? PAL.youngTissue : PAL.chalk)
  const stoneA = new Color(PAL.stone)
  const stoneB = new Color(PAL.stoneAlt)
  const hollow = new Color(PAL.hollow)
  const footC = new Color(PAL.rockAlt)
  const c = new Color()
  const base = land.heightAt(o.x, o.z)
  for (let v = 0; v < fp.count; v += 3) {
    const x = (fp.getX(v) + fp.getX(v + 1) + fp.getX(v + 2)) / 3
    const y = (fp.getY(v) + fp.getY(v + 1) + fp.getY(v + 2)) / 3
    const z = (fp.getZ(v) + fp.getZ(v + 1) + fp.getZ(v + 2)) / 3
    const ny = (fn.getY(v) + fn.getY(v + 1) + fn.getY(v + 2)) / 3
    const above = y - land.heightAt(x, z)
    if (ny < -0.4) c.copy(hollow)
    else if (above < 1.6) c.copy(footC)
    else if (ny > 0.5) c.copy(chalk)
    else if (young) c.copy(chalk).lerp(stoneA, 0.35)
    else {
      // Strata on the walls: broad courses, every third a little deeper, the top course chalk.
      const course = Math.floor((y - base) / 2.4)
      c.copy(course % 3 === 2 ? stoneB : course % 2 ? stoneA : chalk)
    }
    for (let q = 0; q < 3; q += 1) col.set([c.r, c.g, c.b], (v + q) * 3)
  }
  flat.setAttribute('color', new BufferAttribute(col, 3))
  return { geometry: flat, outline }
}

// ------------------------------------------------------------------------------------------------------------- the plants

export type Archetype = 'spire' | 'dome' | 'mesa' | 'canes' | 'fern' | 'mat' | 'tuft' | 'reed'

const withColor = (g: BufferGeometry, shade: number) => {
  const n = g.getAttribute('position').count
  const col = new Float32Array(n * 3).fill(shade)
  g.setAttribute('color', new BufferAttribute(col, 3))
  return g
}
const clean = (g: BufferGeometry, shade = 1) => {
  const out = g.index ? g.toNonIndexed() : g
  out.deleteAttribute('uv')
  out.computeVertexNormals()
  return withColor(out, shade)
}
/** A trunk: a thin, dark, six-sided post. */
const trunk = (h: number, r: number) => clean(new CylinderGeometry(r * 0.7, r, h, 6).translate(0, h / 2, 0), 0.45)

function blade(angle: number, len: number, lift: number, width: number): BufferGeometry {
  // A flat, tapering blade arching out from the centre: four segments along a curve.
  const pos: number[] = []
  const pts: [number, number, number][] = []
  for (let s = 0; s <= 4; s += 1) {
    const t = s / 4
    const r = len * t
    const y = lift * Math.sin(t * Math.PI * 0.75)
    pts.push([Math.cos(angle) * r, y, Math.sin(angle) * r])
  }
  const side: [number, number] = [-Math.sin(angle), Math.cos(angle)]
  for (let s = 0; s < 4; s += 1) {
    const w0 = width * (s === 0 ? 0.35 : 1 - s / 4.5)
    const w1 = width * (1 - (s + 1) / 4.5)
    const a = pts[s]!
    const b = pts[s + 1]!
    const a0 = [a[0] - side[0] * w0, a[1], a[2] - side[1] * w0]
    const a1 = [a[0] + side[0] * w0, a[1], a[2] + side[1] * w0]
    const b0 = [b[0] - side[0] * w1, b[1], b[2] - side[1] * w1]
    const b1 = [b[0] + side[0] * w1, b[1], b[2] + side[1] * w1]
    pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.computeVertexNormals()
  return withColor(g, 1)
}

/** Each archetype at unit size (about a metre tall): solids with a clear silhouette, a handful of faces each. */
export function archetypes(): Record<Archetype, BufferGeometry> {
  const lozenge = new LatheGeometry([new Vector2(0, 0.22), new Vector2(0.24, 0.38), new Vector2(0.27, 0.55), new Vector2(0.17, 0.8), new Vector2(0, 1)], 6)
  const domes = [
    new IcosahedronGeometry(0.42, 0).scale(1, 0.78, 1).translate(0, 0.5, 0),
    new IcosahedronGeometry(0.32, 0).scale(1, 0.8, 1).translate(0.34, 0.38, 0.12),
    new IcosahedronGeometry(0.28, 0).scale(1, 0.8, 1).translate(-0.28, 0.34, -0.2),
  ]
  const plates = [0, 1, 2].map((k) => new CylinderGeometry(0.5 - k * 0.13, 0.52 - k * 0.13, 0.07, 8).translate(0.04 * k, 0.5 + k * 0.2, -0.03 * k))
  const cane = (x: number, z: number, h: number, lean: number) => new CylinderGeometry(0.01, 0.055, h, 5).translate(0, h / 2, 0).rotateZ(lean).translate(x, 0, z)
  const fern = Array.from({ length: 7 }, (_, k) => blade((k / 7) * Math.PI * 2 + 0.3, 0.9, 0.55, 0.16))
  const tuft = [0, 1, 2].map((k) => blade((k / 3) * Math.PI * 2, 0.32, 1, 0.05))
  const reed = [0, 1, 2, 3].map((k) => blade((k / 4) * Math.PI * 2 + 0.4, 0.18, 1.1, 0.035))
  return {
    spire: merge([trunk(0.28, 0.035), clean(lozenge)]),
    dome: merge([trunk(0.3, 0.05), ...domes.map((d) => clean(d))]),
    mesa: merge([trunk(0.62, 0.05), ...plates.map((p) => clean(p))]),
    canes: merge([cane(0, 0, 1, 0.05), cane(0.12, 0.06, 0.8, -0.12), cane(-0.1, 0.08, 0.9, 0.14), cane(0.03, -0.12, 0.7, -0.05)].map((c) => clean(c))),
    fern: merge(fern),
    mat: merge([clean(new CylinderGeometry(0.5, 0.55, 0.08, 8).translate(0, 0.04, 0)), clean(new CylinderGeometry(0.3, 0.33, 0.07, 7).translate(0.5, 0.035, 0.2))]),
    tuft: merge(tuft),
    reed: merge(reed),
  }
}

/** What each species is drawn as, its height in metres at scale 1, and its colour. */
const LOOK: Record<SpeciesId, { arch: Archetype; h: number; color: string; alt?: string }> = {
  veil: { arch: 'spire', h: 13, color: PAL.woodland, alt: PAL.woodlandAlt },
  flood: { arch: 'spire', h: 10, color: PAL.woodlandAlt },
  stilts: { arch: 'spire', h: 9, color: PAL.woodlandAlt },
  coppice: { arch: 'dome', h: 3.6, color: PAL.shrub },
  broadleaf: { arch: 'dome', h: 3, color: PAL.broadleaf },
  tabular: { arch: 'mesa', h: 4.2, color: PAL.tabular },
  canes: { arch: 'canes', h: 3.4, color: PAL.canes },
  vine: { arch: 'canes', h: 2, color: PAL.canes },
  curtain: { arch: 'canes', h: 2, color: PAL.canes },
  fern: { arch: 'fern', h: 1.15, color: PAL.fernSun },
  ground: { arch: 'mat', h: 0.55, color: PAL.mat },
  grass: { arch: 'tuft', h: 0.75, color: PAL.grass },
  sedge: { arch: 'tuft', h: 0.6, color: PAL.sedge },
  reed: { arch: 'reed', h: 1.7, color: PAL.reed },
  ribbons: { arch: 'tuft', h: 0.8, color: PAL.sedge },
}

export type Placed = { arch: Archetype; x: number; y: number; z: number; s: number; yaw: number; color: Color; shadow: boolean }

const hash = (a: number, b: number, c: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
  return x - Math.floor(x)
}

/**
 * The plants, composed: every plant stands where the world places it, but they are drawn as groups. Each family is gathered on a grid suited to its
 * size; where it is plentiful (the ground suits it) its plants close toward their group's centre and the largest are kept, and where it is only a
 * scatter it is left out, so open ground stays open. The shade lovers in the structures' shade habitat are all kept, fuller and deeper the deeper the
 * shade: the shade is where they thrive. The grasses are drawn as a few tufts where they are thickest (the meadow's colour on the ground does the rest).
 */
export function composePlants(site: StudySite, land: Landform): Placed[] {
  const out: Placed[] = []
  // The Ground plate's foreground is kept open (its eye and the first metres of its view), so the camera stands in the habitat, not in a bush.
  const eye = groundEye(site)
  const plan: { ids: SpeciesId[]; cell: number; min: number; keep: number; pull: number; shadeKeepsAll?: boolean }[] = [
    { ids: ['veil', 'flood', 'stilts'], cell: 28, min: 3, keep: 6, pull: 0.55 },
    { ids: ['coppice', 'broadleaf'], cell: 18, min: 6, keep: 7, pull: 0.62 },
    { ids: ['tabular', 'canes'], cell: 14, min: 3, keep: 5, pull: 0.5, shadeKeepsAll: true },
    { ids: ['fern', 'ground'], cell: 12, min: 9, keep: 6, pull: 0.55, shadeKeepsAll: true },
    { ids: ['grass', 'sedge'], cell: 10, min: 20, keep: 4, pull: 0.75 },
    { ids: ['reed'], cell: 8, min: 3, keep: 6, pull: 0.5 },
  ]
  const shadeLover = new Set<SpeciesId>(['fern', 'ground', 'tabular', 'canes'])
  const color = new Color()
  for (const p of plan) {
    type Item = { id: SpeciesId; x: number; z: number; s: number; yaw: number; shade: number }
    const groups = new Map<string, Item[]>()
    const kept: Item[] = []
    for (const id of p.ids) {
      const arr = site.plants.get(id)
      if (!arr) continue
      for (let o = 0; o < arr.length; o += STRIDE) {
        const x = arr[o]!
        const z = arr[o + 2]!
        if (land.onRock(x, z)) continue
        const it: Item = { id, x, z, s: arr[o + 3]!, yaw: arr[o + 4]!, shade: site.shadeAt(x, z) }
        if (p.shadeKeepsAll && shadeLover.has(id) && it.shade > 0.22) {
          kept.push(it)
          continue
        }
        const k = `${Math.floor(x / p.cell)},${Math.floor(z / p.cell)}`
        if (!groups.has(k)) groups.set(k, [])
        groups.get(k)!.push(it)
      }
    }
    for (const list of groups.values()) {
      if (list.length < p.min) continue
      const cx = list.reduce((s, q) => s + q.x, 0) / list.length
      const cz = list.reduce((s, q) => s + q.z, 0) / list.length
      list.sort((a, b) => b.s - a.s)
      for (const it of list.slice(0, p.keep)) kept.push({ ...it, x: it.x + (cx - it.x) * p.pull, z: it.z + (cz - it.z) * p.pull })
    }
    for (const it of kept) {
      const look = LOOK[it.id]
      const thriving = shadeLover.has(it.id) ? it.shade : 0
      let size = look.h * Math.max(0.6, it.s) * (1 + 0.7 * thriving)
      if (look.arch === 'tuft') size *= 1.4
      color.set(look.color)
      if (look.alt && hash(it.x, it.z, 2) > 0.5) color.set(look.alt)
      if (it.id === 'fern') color.set(PAL.fernSun).lerp(new Color(PAL.fernShade), Math.min(1, it.shade * 1.6))
      color.offsetHSL(0, 0, (hash(it.x, it.z, 4) - 0.5) * 0.06)
      out.push({ arch: look.arch, x: it.x, y: land.heightAt(it.x, it.z), z: it.z, s: size, yaw: it.yaw, color: color.clone(), shadow: look.arch !== 'tuft' && look.arch !== 'mat' })
    }
  }
  return out.filter((q) => !(eye && Math.hypot(q.x - eye.x, q.z - eye.z) < (q.arch === 'fern' || q.arch === 'mat' || q.arch === 'tuft' ? 3 : 9))).filter((q) => Math.abs(q.x - SITE.cx) < SITE.half - 1 && Math.abs(q.z - SITE.cz) < SITE.half - 1 && (land.level === null || q.y > land.level - (q.arch === 'reed' ? 0.6 : 0.05)))
}

/** A place for the study's Dweller: the deepest shade near the Reference Overhang that is open ground (no footing over it, no stone). */
export function dwellerSpot(site: StudySite, land: Landform): [number, number] | null {
  const ref = site.organisms.find((o) => o.index === 0)
  if (!ref) return null
  const target = site.underRoof
  let best: [number, number] | null = null
  let score = -Infinity
  for (const { fields, hab } of site.tiles) {
    const r = fields.region
    for (let j = 0; j < r.n; j += 1) {
      for (let i = 0; i < r.n; i += 1) {
        const k = j * r.n + i
        if (hab.footprint[k]! > 0 || hab.ceiling[k]! < 3) continue
        const x = r.x0 + (i + 0.5) * r.cell
        const z = r.z0 + (j + 0.5) * r.cell
        if (land.onRock(x, z)) continue
        const d = Math.hypot(x - ref.x, z - ref.z)
        if (d > ref.radius * 2.2) continue
        const s = hab.shade[k]! - (target ? Math.hypot(x - target[0], z - target[1]) / 60 : 0)
        if (s > score) {
          score = s
          best = [x, z]
        }
      }
    }
  }
  return best
}
