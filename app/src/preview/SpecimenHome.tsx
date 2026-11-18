import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { environment } from '../project03/environment.ts'
import { creatureSpot, viewProjector } from '../project03/loading.ts'
import { currentPopulation } from '../project03/livingSelection.ts'
import { LANDSCAPE, islandRadius, landscapeHeight } from '../project03/terrain.ts'
import { shared } from '../project03/vegShared.ts'
import { formatHour, useClock } from './clock.ts'
import { follow, href } from './route.ts'

/** A place on the island an annotation is pinned to: fixed, or followed (an animal). */
type Anchor = { key: string; label: string; text: string; at: () => { x: number; y: number; z: number } | null }
/** An annotation as drawn this moment: its marker, the bend of its leader, and where its label sits. */
type Drawn = { key: string; label: string; text: string; ax: number; ay: number; bx: number; ly: number; lx: number; left: boolean }

/** The strongest cell of a habitat zone on the island's 16 m grid: a real place of that kind, as the vegetation reads it. */
async function strongest(zone: 'moist' | 'shore'): Promise<{ x: number; z: number } | null> {
  const f = shared.island
  if (!f) return null
  const { habitatAt } = await import('../project03/vegCoverage.ts')
  let best = { v: 0.35, x: 0, z: 0 }
  // Toward the middle of the island (within 60% of its reach), so the mark sits on the specimen, not at its edge.
  for (let j = 0; j < f.n; j += 2) {
    for (let i = 0; i < f.n; i += 2) {
      if (!f.land[j * f.n + i]) continue
      const x = f.x0 + (i + 0.5) * f.cell
      const z = f.x0 + (j + 0.5) * f.cell
      if (Math.hypot(x, z) > islandRadius(Math.atan2(z, x)) * 0.6) continue
      const h = habitatAt(f, i, j)
      if (h.water) continue
      const v = h.zones[zone]
      if (v > best.v) best = { v, x, z }
    }
  }
  return best.v > 0.35 ? { x: best.x, z: best.z } : null
}

/**
 * The four places, read from the world: a structure near the island's middle (Living Architecture), the densest moist woodland (Vegetation), the
 * strongest shore ground (Habitat), and a Hollow Dweller where it is now (Creatures, followed as it moves).
 */
async function findAnchors(): Promise<Anchor[]> {
  const out: Anchor[] = []
  const organisms = currentPopulation()?.organisms ?? []
  const structure = organisms.reduce<(typeof organisms)[number] | null>((best, o) => (!best || Math.hypot(o.x, o.z) < Math.hypot(best.x, best.z) ? o : best), null)
  if (structure) out.push({ key: 'growth', label: 'Living architecture', text: 'grows toward the light', at: () => ({ x: structure.x, y: structure.ground + 16, z: structure.z }) })
  const wood = await strongest('moist')
  if (wood) out.push({ key: 'plants', label: 'Vegetation', text: 'woodland on damp ground', at: () => ({ x: wood.x, y: landscapeHeight(wood.x, wood.z) + 6, z: wood.z }) })
  const shore = await strongest('shore')
  if (shore) out.push({ key: 'habitat', label: 'Habitat', text: 'the shore, by light and water', at: () => ({ x: shore.x, y: landscapeHeight(shore.x, shore.z) + 2, z: shore.z }) })
  out.push({ key: 'creatures', label: 'Creatures', text: 'a Hollow Dweller, in shade', at: () => (creatureSpot.valid ? { x: creatureSpot.x, y: creatureSpot.y + 2, z: creatureSpot.z } : null) })
  return out
}

/** The island's left and right edges on screen (its outline, projected). */
function islandSpan(project: NonNullable<typeof viewProjector.project>) {
  let min = Infinity
  let max = -Infinity
  for (let k = 0; k < 24; k += 1) {
    const a = (k / 24) * Math.PI * 2
    const r = islandRadius(a)
    const p = project(Math.cos(a) * r, 40, Math.sin(a) * r)
    min = Math.min(min, p.x)
    max = Math.max(max, p.x)
  }
  return { min, max }
}

/**
 * HOME, CONCEPT B · THE DARK SPECIMEN. The live island (the same scene as everywhere; homeScene.ts frames it) as a specimen under study in dark space:
 * a title and one way in, four fine marks on real places with their labels set outside the island, and the plate's caption. Nothing else.
 */
export function SpecimenHome({ onEnter }: { onEnter: (event: MouseEvent) => void }) {
  const [clock] = useClock()
  const [drawn, setDrawn] = useState<Drawn[]>([])
  const anchors = useRef<Anchor[]>([])

  useEffect(() => {
    let live = true
    // The structures and the ground's habitats arrive a moment after the land: look again until all four places are found.
    const find = async () => {
      const found = await findAnchors()
      if (!live) return
      anchors.current = found
      if (found.length < 4) window.setTimeout(find, 1500)
    }
    void find()
    let raf = 0
    let last = 0
    let signature = ''
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < 80) return
      last = now
      const project = viewProjector.project
      if (!project || anchors.current.length === 0) return
      const span = islandSpan(project)
      const points = anchors.current
        .map((a) => {
          const at = a.at()
          const p = at ? project(at.x, at.y, at.z) : null
          return p && p.front ? { a, p } : null
        })
        .filter((v): v is { a: Anchor; p: { x: number; y: number; front: boolean } } => v !== null)
      // Balanced on two sides: the marks furthest left take the left (half of them), the rest the right. Each label sits beyond the island's edge
      // on its side, in the order of the marks from top to bottom, never closer than a line apart.
      const byX = [...points].sort((u, v) => u.p.x - v.p.x)
      const leftKeys = new Set(byX.slice(0, Math.floor(byX.length / 2)).map(({ a }) => a.key))
      const next: Drawn[] = []
      for (const left of [true, false]) {
        const side = points.filter(({ a }) => leftKeys.has(a.key) === left).sort((u, v) => u.p.y - v.p.y)
        let y = -Infinity
        for (const { a, p } of side) {
          y = Math.max(p.y, y + 58)
          const edge = left ? span.min - 36 : span.max + 36
          next.push({ key: a.key, label: a.label, text: a.text, ax: Math.round(p.x), ay: Math.round(p.y), bx: Math.round(edge), ly: Math.round(y), lx: Math.round(left ? edge - 8 : edge + 8), left })
        }
      }
      const sig = next.map((d) => `${d.key}${d.ax},${d.ay},${d.ly},${d.bx}`).join('|')
      if (sig !== signature) {
        signature = sig
        setDrawn(next)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      live = false
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="pv-spec">
      <div className="pv-spec-air" aria-hidden />

      <svg className="pv-spec-leaders" aria-hidden>
        {drawn.map((d) => (
          <g key={d.key}>
            {/* From the mark, out to the island's edge at the label's height, then level to the label. */}
            <polyline points={`${d.ax},${d.ay} ${d.bx},${d.ly} ${d.lx},${d.ly}`} />
            <circle cx={d.ax} cy={d.ay} r={3.5} className="pv-spec-ring" />
            <circle cx={d.ax} cy={d.ay} r={1.2} className="pv-spec-dot" />
          </g>
        ))}
      </svg>
      {drawn.map((d) => (
        <p key={d.key} className="pv-spec-note" data-left={d.left} style={d.left ? { right: `calc(100% - ${d.lx}px)`, top: d.ly } : { left: d.lx, top: d.ly }}>
          <span className="pv-spec-note-label">{d.label}</span>
          <span className="pv-spec-note-text">{d.text}</span>
        </p>
      ))}

      <header className="pv-spec-head">
        <h1 className="pv-spec-title">
          Shadow
          <br />
          Ecology.
        </h1>
        <p className="pv-spec-sub">An island grown from one seed, observed under a moving sun.</p>
        <p className="pv-spec-ways">
          <a className="pv-spec-enter" href={href({ page: 'explore' })} onClick={onEnter}>
            Enter the island <span aria-hidden>→</span>
          </a>
          <a className="pv-spec-quiet" href={href({ page: 'project' })} onClick={follow(href({ page: 'project' }))}>
            How it is made
          </a>
        </p>
      </header>

      <p className="pv-spec-caption">
        <span>Fig. 1</span>
        <span>
          The island, year {Math.floor(clock.year)}, {formatHour(clock.hour)} · {(LANDSCAPE.size / 1000).toFixed(1)} km · seed {environment.seed}
        </span>
      </p>
    </div>
  )
}
