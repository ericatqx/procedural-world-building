import { FigureArrow as Arrow, FigureCaption as Caption, LearnFigure } from '../../shared/ui/learn.tsx'

/** Mini diagrams for the Week 06 Paths LEARN steps, drawn with the shared `lf-*` classes. */

type P = { x: number; y: number }

const NODES: readonly P[] = [
  { x: 8, y: 10 },
  { x: 30, y: 6 },
  { x: 58, y: 12 },
  { x: 14, y: 34 },
  { x: 40, y: 28 },
  { x: 62, y: 40 },
  { x: 24, y: 54 },
  { x: 50, y: 54 },
]

const span = (a: P, b: P) => Math.hypot(b.x - a.x, b.y - a.y)

/** The study's greedy spanner on flat distances: shortest pairs first, kept when the network detours past `stretch`. */
function spanner(stretch: number): [number, number][] {
  const pairs: [number, number][] = []
  NODES.forEach((_, i) => NODES.forEach((__, j) => (j > i ? pairs.push([i, j]) : null)))
  pairs.sort((p, q) => span(NODES[p[0]]!, NODES[p[1]]!) - span(NODES[q[0]]!, NODES[q[1]]!))
  const kept: [number, number][] = []
  const through = (from: number, to: number) => {
    const best = NODES.map(() => Infinity)
    best[from] = 0
    for (let round = 0; round < NODES.length; round += 1) {
      for (const [i, j] of kept) {
        const d = span(NODES[i]!, NODES[j]!)
        best[j] = Math.min(best[j]!, best[i]! + d)
        best[i] = Math.min(best[i]!, best[j]! + d)
      }
    }
    return best[to]!
  }
  for (const [i, j] of pairs) {
    if (through(i, j) > stretch * span(NODES[i]!, NODES[j]!)) {
      kept.push([i, j])
    }
  }
  return kept
}

const TREE = spanner(Infinity)
const LOOPS = spanner(1.35)

function Network({ links }: { links: readonly [number, number][] }) {
  return (
    <>
      {links.map(([i, j]) => (
        <line key={`${i}-${j}`} className="lf-accent" x1={NODES[i]!.x} y1={NODES[i]!.y} x2={NODES[j]!.x} y2={NODES[j]!.y} />
      ))}
      {NODES.map((p, i) => (
        <circle key={i} className="lf-fill" cx={p.x} cy={p.y} r={2.2} />
      ))}
    </>
  )
}

/** Nodes → a tree at Directness 0 → shortcuts where the tree detours too far. */
export function SpannerFigure() {
  return (
    <LearnFigure label="Links are tried shortest first; one is kept only when the network so far detours too far">
      <svg viewBox="0 0 300 92">
        <g transform="translate(8 2)">
          {NODES.map((p, i) => (
            <circle key={i} className="lf-faint" cx={p.x} cy={p.y} r={2.4} />
          ))}
          <Caption x={35} y={74} title="Nodes" note="seeded, spread" />
        </g>
        <Arrow x={84} y={30} />
        <g transform="translate(110 2)">
          <Network links={TREE} />
          <Caption x={35} y={74} title="Directness 0" note="a tree: one route" />
        </g>
        <Arrow x={186} y={30} />
        <g transform="translate(212 2)">
          <Network links={LOOPS} />
          <Caption x={35} y={74} title="Directness up" note="loops cut detours" />
        </g>
      </svg>
    </LearnFigure>
  )
}

const PLANE_Y = 14
const ground = (x: number) => 64 - 12 * Math.sin(x / 38) - 9 * Math.exp(-(((x - 190) / 30) ** 2)) + 4 * Math.sin(x / 13)
const VERTICES = [34, 64, 96, 126, 158, 190, 222, 252]
const PROFILE = Array.from({ length: 131 }, (_, i) => 20 + i * 2)

/** Side view: a line grown flat in a plane, dropped vertex by vertex onto the ground. */
export function ProjectionFigure() {
  const outline = PROFILE.map((x) => `${x},${ground(x).toFixed(1)}`).join(' ')
  const spline = PROFILE.filter((x) => x >= VERTICES[0]! && x <= VERTICES.at(-1)!)
    .map((x) => `${x},${(ground(x) - 2).toFixed(1)}`)
    .join(' ')
  return (
    <LearnFigure label="The 2D line is grown in a flat plane, then each point drops to the ground and a spline is drawn through them">
      <svg viewBox="0 0 300 92">
        <line className="lf-faint" x1={20} y1={PLANE_Y} x2={280} y2={PLANE_Y} />
        {VERTICES.map((x) => (
          <g key={x}>
            <line className="lf-faint" x1={x} y1={PLANE_Y} x2={x} y2={ground(x) - 2} strokeDasharray="2 2" />
            <circle className="lf-fill" cx={x} cy={PLANE_Y} r={1.8} />
            <circle className="lf-dot" cx={x} cy={ground(x) - 2} r={1.8} />
          </g>
        ))}
        <polyline className="lf-line" points={outline} />
        <polyline className="lf-accent" points={spline} />
        <text className="lf-label" x={282} y={PLANE_Y + 3}>
          2D
        </text>
        <text className="lf-label" x={22} y={PLANE_Y - 4}>
          (x, z) in a plane
        </text>
        <text className="lf-label is-accent" x={22} y={88}>
          (x, h(x, z), z) on the ground
        </text>
      </svg>
    </LearnFigure>
  )
}
