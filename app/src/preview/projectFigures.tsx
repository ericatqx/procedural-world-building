import type { ReactNode } from 'react'

/**
 * The Project page's small drawings: the data structures the world is built from, a preview for each Lab, and a mark for each weekly exercise.
 * Ink on near-black, the one red for what matters; all drawn here from a fixed seed, nothing read from the world (cheap, and the same every time).
 */

const INK = 'var(--ui-text)'
const MUTED = 'var(--ui-muted)'
const FAINT = 'var(--ui-faint)'
const RULE = 'var(--rule-strong)'
const RED = 'var(--signal)'

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function Frame({ w = 240, h = 150, label, children }: { w?: number; h?: number; label: string; children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="pv-fig">
      {children}
    </svg>
  )
}

/* ───────── Data structures ───────── */

/** The terrain: a height function sampled in chunks, finer near the camera (levels of detail). */
export function ChunkGridFigure() {
  const n = 8
  const size = 128
  const cell = size / n
  const cam = { x: 2.6, y: 5.3 }
  const cells: ReactNode[] = []
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) {
      const d = Math.hypot(i + 0.5 - cam.x, j + 0.5 - cam.y)
      const sub = d < 1.6 ? 4 : d < 3.2 ? 2 : 1
      const x = 56 + i * cell
      const y = 11 + j * cell
      cells.push(<rect key={`c${i},${j}`} x={x} y={y} width={cell} height={cell} fill="none" stroke={RULE} strokeWidth={0.6} />)
      for (let k = 1; k < sub; k += 1) {
        cells.push(<line key={`v${i},${j},${k}`} x1={x + (k * cell) / sub} y1={y} x2={x + (k * cell) / sub} y2={y + cell} stroke={sub === 4 ? MUTED : FAINT} strokeWidth={0.5} />)
        cells.push(<line key={`h${i},${j},${k}`} x1={x} y1={y + (k * cell) / sub} x2={x + cell} y2={y + (k * cell) / sub} stroke={sub === 4 ? MUTED : FAINT} strokeWidth={0.5} />)
      }
    }
  return (
    <Frame label="A grid of terrain chunks, finer near the camera">
      {cells}
      <circle cx={56 + cam.x * cell} cy={11 + cam.y * cell} r={3.2} fill={RED} />
      <text x={56 + cam.x * cell + 6} y={11 + cam.y * cell - 6} className="pv-fig-label" fill={RED}>
        camera
      </text>
    </Frame>
  )
}

/** Water: lakes as flooded hollows, rivers as chains of nodes running down to them. */
export function RiverGraphFigure() {
  const chains = [
    [
      [18, 22],
      [44, 34],
      [70, 40],
      [98, 58],
      [122, 74],
    ],
    [
      [40, 120],
      [64, 104],
      [90, 92],
      [122, 74],
    ],
    [
      [122, 74],
      [150, 82],
      [176, 88],
    ],
  ]
  return (
    <Frame label="Rivers as chains of nodes flowing into a lake">
      <path d="M176 70 C 196 58, 228 66, 230 88 C 232 112, 204 124, 184 114 C 168 106, 164 84, 176 70 Z" fill="rgba(233,230,223,0.06)" stroke={MUTED} strokeWidth={0.8} />
      <text x={190} y={136} className="pv-fig-label" fill={MUTED}>
        lake · spill level
      </text>
      {chains.map((c, k) => (
        <polyline key={k} points={c.map((p) => p.join(',')).join(' ')} fill="none" stroke={INK} strokeWidth={k === 2 ? 1.6 : 1} />
      ))}
      {chains.flat().map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2.3} fill="#000" stroke={INK} strokeWidth={0.9} />
      ))}
      <circle cx={122} cy={74} r={3.4} fill={RED} />
      <text x={100} y={64} className="pv-fig-label" fill={RED}>
        confluence
      </text>
      <text x={8} y={142} className="pv-fig-label" fill={MUTED}>
        node {'{'} x, z, level, width, depth {'}'}
      </text>
    </Frame>
  )
}

/** The island's fields: grids over the same ground, one value each, stacked. */
export function FieldStackFigure() {
  const names = ['height', 'slope', 'light', 'moisture']
  const r = rng(7)
  return (
    <Frame label="Stacked grids of island fields: height, slope, light, moisture">
      {names.map((name, k) => {
        const y = 20 + k * 30
        const pts = `${70},${y + 22} ${150},${y + 22} ${180},${y} ${100},${y}`
        const dots: ReactNode[] = []
        for (let i = 0; i < 9; i += 1) {
          const t = r()
          const u = r()
          dots.push(<circle key={i} cx={70 + u * 80 + (1 - t) * 30} cy={y + t * 22} r={1 + r() * 2.2} fill={k === 2 ? RED : MUTED} opacity={0.5 + r() * 0.5} />)
        }
        return (
          <g key={name}>
            <polygon points={pts} fill="rgba(0,0,0,0.85)" stroke={k === 2 ? RED : RULE} strokeWidth={0.8} />
            {dots}
            <text x={190} y={y + 15} className="pv-fig-label" fill={k === 2 ? RED : MUTED}>
              {name}
            </text>
          </g>
        )
      })}
      <text x={8} y={24} className="pv-fig-label" fill={MUTED}>
        256²
      </text>
      <text x={8} y={36} className="pv-fig-label" fill={FAINT}>
        16 m cells
      </text>
    </Frame>
  )
}

/** Living Architecture: an entity collection (organisms with a life track per year) and the links between them. */
export function PopulationFigure() {
  const r = rng(21)
  const nodes = Array.from({ length: 9 }, (_, i) => ({ x: 128 + r() * 100, y: 18 + r() * 110, s: 2.5 + r() * 4, i }))
  const links = [
    [0, 3],
    [3, 5],
    [1, 4],
    [4, 7],
    [2, 6],
    [6, 8],
    [5, 8],
  ]
  const rows = ['#00 mature', '#01 growing', '#02 decline', '#03 mature', '#04 seedling']
  return (
    <Frame label="A list of organisms, each with a life track, and links between them">
      {rows.map((row, k) => (
        <g key={row}>
          <text x={8} y={24 + k * 22} className="pv-fig-label" fill={k === 0 ? RED : MUTED}>
            {row}
          </text>
          <polyline points={Array.from({ length: 12 }, (_, t) => `${8 + t * 8},${34 + k * 22 - Math.min(1, Math.sin((t / 11) * Math.PI * (0.6 + k * 0.1))) * 6}`).join(' ')} fill="none" stroke={k === 0 ? RED : FAINT} strokeWidth={0.8} />
        </g>
      ))}
      {links.map(([a, b], k) => (
        <line key={k} x1={nodes[a]!.x} y1={nodes[a]!.y} x2={nodes[b]!.x} y2={nodes[b]!.y} stroke={RULE} strokeWidth={0.8} strokeDasharray="2 2" />
      ))}
      {nodes.map((n) => (
        <circle key={n.i} cx={n.x} cy={n.y} r={n.s} fill={n.i === 0 ? RED : 'none'} stroke={n.i === 0 ? RED : INK} strokeWidth={0.9} />
      ))}
    </Frame>
  )
}

/** Vegetation: plants scattered per tile, the tiles near the camera at full detail, farther ones simpler. */
export function PlantTilesFigure() {
  const r = rng(3)
  const items: ReactNode[] = []
  const cam = { x: 1.5, y: 3.5 }
  for (let j = 0; j < 4; j += 1)
    for (let i = 0; i < 7; i += 1) {
      const x0 = 18 + i * 30
      const y0 = 12 + j * 30
      const d = Math.hypot(i + 0.5 - cam.x, j + 0.5 - cam.y)
      const level = d < 1.8 ? 0 : d < 3.6 ? 1 : 2
      items.push(<rect key={`t${i}${j}`} x={x0} y={y0} width={30} height={30} fill="none" stroke={RULE} strokeWidth={0.5} />)
      const count = level === 0 ? 14 : level === 1 ? 8 : 4
      for (let k = 0; k < count; k += 1) {
        const x = x0 + 3 + r() * 24
        const y = y0 + 3 + r() * 24
        if (level === 0) items.push(<path key={`p${i}${j}${k}`} d={`M${x} ${y + 3} L${x} ${y - 2} M${x} ${y} L${x - 2} ${y - 2} M${x} ${y} L${x + 2} ${y - 2}`} stroke={INK} strokeWidth={0.6} />)
        else items.push(<circle key={`p${i}${j}${k}`} cx={x} cy={y} r={level === 1 ? 1.3 : 0.9} fill={level === 1 ? MUTED : FAINT} />)
      }
    }
  return (
    <Frame label="Plant tiles, full detail near the camera and simpler farther away">
      {items}
      <circle cx={18 + cam.x * 30} cy={12 + cam.y * 30} r={3.2} fill={RED} />
      <text x={18} y={146} className="pv-fig-label" fill={MUTED}>
        96 m tiles · full / reduced / distant
      </text>
    </Frame>
  )
}

/** Creatures: agents, each with a position, a heading and a state. */
export function AgentsFigure() {
  const r = rng(11)
  const states = ['rest', 'feed', 'travel']
  const agents = Array.from({ length: 10 }, (_, i) => ({ x: 20 + r() * 200, y: 18 + r() * 110, a: r() * Math.PI * 2, s: states[Math.floor(r() * 3)]!, i }))
  return (
    <Frame label="Agents with position, heading and state">
      <path d="M150 40 C 170 30, 200 44, 196 66 C 192 86, 160 86, 150 70 Z" fill="rgba(233,230,223,0.05)" stroke={FAINT} strokeDasharray="2 3" />
      <text x={156} y={98} className="pv-fig-label" fill={FAINT}>
        shade
      </text>
      {agents.map((g) => (
        <g key={g.i}>
          <line x1={g.x} y1={g.y} x2={g.x + Math.cos(g.a) * 9} y2={g.y + Math.sin(g.a) * 9} stroke={g.i === 0 ? RED : MUTED} strokeWidth={0.9} />
          <circle cx={g.x} cy={g.y} r={g.i === 0 ? 3.2 : 2.2} fill={g.i === 0 ? RED : INK} />
          {g.i < 3 ? (
            <text x={g.x + 6} y={g.y + 10} className="pv-fig-label" fill={g.i === 0 ? RED : MUTED}>
              {g.s}
            </text>
          ) : null}
        </g>
      ))}
    </Frame>
  )
}

/* ───────── Lab previews ───────── */

/** A Living Architecture organism: a stratified tower reaching out an overhang carried on columns. */
export function ArchitecturePreview() {
  const strata = Array.from({ length: 9 }, (_, i) => i)
  return (
    <Frame w={260} h={160} label="A tower reaching out an overhang on columns">
      <line x1={10} y1={146} x2={250} y2={146} stroke={RULE} />
      {strata.map((i) => (
        <rect key={i} x={70 - i * 1.2} y={140 - (i + 1) * 13} width={34 + i * 2.4} height={11} fill="none" stroke={i % 3 === 0 ? INK : MUTED} strokeWidth={0.8} />
      ))}
      <path d="M100 36 C 140 30, 180 34, 220 46 L 220 54 C 180 44, 140 42, 100 48 Z" fill="none" stroke={INK} strokeWidth={0.9} />
      {[136, 168, 204].map((x, k) => (
        <line key={x} x1={x} y1={44} x2={x + (k - 1) * 3} y2={146} stroke={MUTED} strokeWidth={0.8} />
      ))}
      <path d="M100 52 L 220 56 L 228 146 L 96 146 Z" fill="rgba(233,230,223,0.05)" />
      <circle cx={232} cy={20} r={5} fill="none" stroke={RED} />
      <line x1={226} y1={26} x2={208} y2={42} stroke={RED} strokeWidth={0.8} strokeDasharray="2 2" />
    </Frame>
  )
}

function stem(x: number, y: number, len: number, angle: number, depth: number, r: () => number, out: ReactNode[], key: string) {
  const x2 = x + Math.sin(angle) * len
  const y2 = y - Math.cos(angle) * len
  out.push(<line key={key} x1={x} y1={y} x2={x2} y2={y2} stroke={depth > 2 ? INK : MUTED} strokeWidth={0.4 + depth * 0.25} />)
  if (depth === 0) return
  const n = 2 + (r() < 0.3 ? 1 : 0)
  for (let k = 0; k < n; k += 1) stem(x2, y2, len * (0.62 + r() * 0.12), angle + (k - (n - 1) / 2) * (0.5 + r() * 0.3), depth - 1, r, out, `${key}.${k}`)
}

/** Three of the plant archetypes, grown by branching rules. */
export function VegetationPreview() {
  const r = rng(5)
  const out: ReactNode[] = []
  stem(56, 146, 34, 0, 4, r, out, 'a')
  for (let k = 0; k < 9; k += 1) {
    const a = -0.9 + k * 0.22
    out.push(<path key={`f${k}`} d={`M130 146 Q ${130 + Math.sin(a) * 30} ${146 - 40} ${130 + Math.sin(a) * 52} ${146 - Math.cos(a) * 44}`} fill="none" stroke={MUTED} strokeWidth={0.7} />)
  }
  for (let k = 0; k < 14; k += 1) out.push(<line key={`g${k}`} x1={190 + k * 4} y1={146} x2={186 + k * 4 + r() * 10} y2={110 - r() * 22} stroke={k === 6 ? RED : INK} strokeWidth={0.6} />)
  return (
    <Frame w={260} h={160} label="A shrub, a fern and a grass tuft drawn by branching rules">
      <line x1={10} y1={146} x2={250} y2={146} stroke={RULE} />
      {out}
    </Frame>
  )
}

/** The four species as simple bodies: legs, segments, wings. */
export function CreaturePreview() {
  return (
    <Frame w={260} h={160} label="Four creature bodies: dweller, crawler, strider, glider">
      <line x1={10} y1={146} x2={250} y2={146} stroke={RULE} />
      {/* Dweller: a heavy body low on four legs. */}
      <ellipse cx={52} cy={116} rx={26} ry={13} fill="none" stroke={INK} />
      <circle cx={80} cy={110} r={7} fill="none" stroke={INK} />
      {[34, 44, 60, 70].map((x, k) => (
        <polyline key={x} points={`${x},124 ${x + (k % 2 ? 4 : -4)},134 ${x},146`} fill="none" stroke={MUTED} />
      ))}
      {/* Crawler: segments. */}
      {[0, 1, 2, 3, 4].map((k) => (
        <circle key={k} cx={108 + k * 8} cy={140} r={4.2} fill="none" stroke={MUTED} />
      ))}
      {/* Strider: a small body high on long legs. */}
      <ellipse cx={176} cy={84} rx={10} ry={5} fill="none" stroke={INK} />
      {[-1, 1].map((s) => (
        <g key={s}>
          <polyline points={`176,86 ${176 + s * 22},68 ${176 + s * 30},146`} fill="none" stroke={MUTED} />
          <polyline points={`176,86 ${176 + s * 12},62 ${176 + s * 16},146`} fill="none" stroke={MUTED} />
        </g>
      ))}
      {/* Glider: veil wings. */}
      <path d="M210 40 Q 226 26 246 34 Q 230 38 222 46 Q 214 52 210 40 Z" fill="none" stroke={RED} />
      <path d="M210 40 Q 196 24 180 30 Q 194 36 200 46 Q 206 52 210 40 Z" fill="none" stroke={RED} />
    </Frame>
  )
}

/** A window of the island, drawn as contours with the shade of a structure washed over it. */
export function HabitatPreview() {
  const rings = Array.from({ length: 7 }, (_, i) => i)
  return (
    <Frame w={260} h={160} label="A window of the island in contours, with a patch of shade habitat">
      <rect x={14} y={10} width={232} height={140} fill="none" stroke={RULE} />
      {rings.map((i) => (
        <path key={i} d={`M ${30 + i * 6} ${120 - i * 4} C ${70 + i * 8} ${60 - i * 5}, ${150 - i * 4} ${50 + i * 2}, ${226 - i * 8} ${96 - i * 6}`} fill="none" stroke={i === 3 ? INK : MUTED} strokeWidth={0.7} />
      ))}
      <ellipse cx={168} cy={112} rx={34} ry={16} fill="rgba(255,31,31,0.08)" stroke={RED} strokeDasharray="3 2" />
      <text x={140} y={140} className="pv-fig-label" fill={RED}>
        shade habitat
      </text>
    </Frame>
  )
}

/* ───────── Exercise marks ───────── */

/**
 * The weekly exercises' marks: one family of fine-line studies, each the exercise's own subject drawn as an engraver might (one weight of line,
 * the page's ink and its quieter grey, one red accent), so the seven read as a set: a lit sphere and its hatched shade (Basics), octaves of
 * noise summing to a terrain profile (Noise & Terrain), an isometric cluster of voxels (Voxels), the contour bands a surface rule draws
 * (Shaders), an even scatter thinning with suitability, crossed by a path (Spatial Systems), an L-system's branching (Branching Systems), and
 * agents with their headings, one with its trail (Agents & Scale).
 */
export function ExerciseMark({ week }: { week: string }) {
  const s = { fill: 'none', stroke: INK, strokeWidth: 0.7, strokeLinecap: 'round' as const }
  let body: ReactNode = null
  if (week === 'week02') {
    // A sphere under one light: its outline, the terminator, and hatching that thickens into the shade.
    const hatch: ReactNode[] = []
    for (let k = 0; k < 9; k += 1) {
      const x = 46 + k * 3.2
      const half = Math.sqrt(Math.max(0, 22 * 22 - (x - 44) ** 2))
      const top = 30 - half
      hatch.push(<line key={k} x1={x} y1={top + (k < 3 ? half * 0.9 : 1)} x2={x} y2={30 + half - 0.5} stroke={k < 3 ? MUTED : INK} strokeWidth={0.55} />)
    }
    body = (
      <g {...s}>
        <circle cx={44} cy={30} r={22} />
        <path d="M44 8 A11 22 0 0 1 44 52" stroke={MUTED} />
        {hatch}
        <ellipse cx={50} cy={55} rx={20} ry={2.4} stroke={MUTED} />
        <circle cx={14} cy={12} r={2.2} fill={RED} stroke="none" />
        <line x1={18} y1={14} x2={27} y2={19} stroke={RED} />
      </g>
    )
  } else if (week === 'week03') {
    // Three octaves (fine, quieter) and their sum (the terrain), the drainage cut in red.
    const curve = (f: number, a: number, phase: number, y: number) =>
      Array.from({ length: 49 }, (_, k) => `${k ? 'L' : 'M'}${(6 + k * 2).toFixed(1)} ${(y - Math.sin(k * f + phase) * a - Math.sin(k * f * 2.1 + phase) * a * 0.3).toFixed(1)}`).join(' ')
    const sum = Array.from({ length: 49 }, (_, k) => {
      const v = Math.sin(k * 0.09 + 0.4) * 11 + Math.sin(k * 0.31 + 1.3) * 4 + Math.sin(k * 0.9) * 1.4
      return `${k ? 'L' : 'M'}${(6 + k * 2).toFixed(1)} ${(40 - v).toFixed(1)}`
    }).join(' ')
    body = (
      <g {...s}>
        <path d={curve(0.09, 6, 0.4, 12)} stroke={MUTED} strokeWidth={0.5} />
        <path d={curve(0.31, 2.2, 1.3, 20)} stroke={MUTED} strokeWidth={0.5} />
        <path d={curve(0.9, 1, 0, 26)} stroke={MUTED} strokeWidth={0.5} />
        <path d={sum} />
        <line x1={6} y1={56} x2={102} y2={56} stroke={MUTED} strokeWidth={0.5} />
        <path d="M58 40 L61 47 L64 41" stroke={RED} />
      </g>
    )
  } else if (week === 'week04') {
    // Isometric voxels: each cube its three faces, the topmost picked out.
    const cube = (gx: number, gy: number, gz: number, key: string, red = false) => {
      const x = 52 + (gx - gz) * 7
      const y = 40 + (gx + gz) * 4 - gy * 8
      const top = `M${x} ${y - 8} L${x + 7} ${y - 4} L${x} ${y} L${x - 7} ${y - 4} Z`
      return (
        <g key={key} stroke={red ? RED : INK}>
          <path d={top} />
          <path d={`M${x - 7} ${y - 4} L${x - 7} ${y + 4} L${x} ${y + 8} L${x + 7} ${y + 4} L${x + 7} ${y - 4} M${x} ${y} L${x} ${y + 8}`} stroke={red ? RED : MUTED} />
        </g>
      )
    }
    body = (
      <g {...s}>
        {[
          [0, 0, 1],
          [1, 0, 1],
          [-1, 0, 0],
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, -1],
          [0, 1, 1],
          [0, 2, 0],
        ].map(([gx, gy, gz], k) => cube(gx!, gy!, gz!, String(k), k === 8))}
      </g>
    )
  } else if (week === 'week05') {
    // A surface rule drawn as contour bands over a hill; one threshold in red.
    body = (
      <g {...s}>
        {[0, 1, 2, 3, 4, 5].map((k) => (
          <ellipse key={k} cx={50 + k * 1.5} cy={34 - k * 1.2} rx={44 - k * 7} ry={20 - k * 3.2} stroke={k === 3 ? RED : k % 2 ? MUTED : INK} strokeWidth={k === 3 ? 0.9 : 0.6} />
        ))}
      </g>
    )
  } else if (week === 'week06') {
    // An even scatter (no two closer than a spacing), thinning where the ground suits less, and a path across it.
    const r = rng(6)
    const pts: [number, number][] = []
    for (let t = 0; t < 400 && pts.length < 46; t += 1) {
      const x = 6 + r() * 92
      const y = 6 + r() * 48
      if (r() > 0.25 + (x / 104) * 0.75) continue
      if (pts.some(([a, b]) => Math.hypot(a - x, b - y) < 5.2)) continue
      pts.push([x, y])
    }
    body = (
      <g>
        {pts.map(([x, y], k) => (
          <circle key={k} cx={x} cy={y} r={1} fill={INK} />
        ))}
        <path d="M4 50 C 24 44, 36 26, 56 30 S 86 18, 100 8" fill="none" stroke={RED} strokeWidth={0.8} />
      </g>
    )
  } else if (week === 'week07') {
    const r = rng(9)
    const out: ReactNode[] = []
    stem(52, 56, 16, 0, 4, r, out, 'w')
    body = <g>{out}</g>
  } else if (week === 'week08') {
    // Agents and their headings; one with the trail it has walked.
    const r = rng(4)
    body = (
      <g>
        <path d="M14 48 C 22 44, 26 50, 34 44 S 44 34, 50 34" fill="none" stroke={RED} strokeWidth={0.6} strokeDasharray="1.5 2" />
        <circle cx={50} cy={34} r={1.8} fill={RED} />
        <line x1={50} y1={34} x2={57} y2={30} stroke={RED} strokeWidth={0.7} />
        {Array.from({ length: 11 }, (_, i) => {
          const x = 12 + r() * 82
          const y = 8 + r() * 44
          const a = -0.6 + (r() - 0.5) * 1.2
          return (
            <g key={i}>
              <line x1={x} y1={y} x2={x + Math.cos(a) * 6} y2={y + Math.sin(a) * 6} stroke={MUTED} strokeWidth={0.7} />
              <circle cx={x} cy={y} r={1.3} fill={INK} />
            </g>
          )
        })}
      </g>
    )
  }
  return (
    <svg viewBox="0 0 104 60" className="pv-week-mark" aria-hidden>
      {body}
    </svg>
  )
}
