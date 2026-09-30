import { useId } from 'react'
import { FigureArrow, FigureCaption, LearnFigure } from '../../shared/ui/learn.tsx'

/**
 * Mini diagrams for the Week 04 LEARN steps, drawn with the shared `lf-*`
 * classes. Each shows a 2D slice through a density field (> 0 solid), in
 * slice coordinates −1…1.
 */

type Vec = readonly [number, number]

const circle = ([x, y]: Vec, [cx, cy]: Vec, r: number) => r - Math.hypot(x - cx, y - cy)

/** Two overlapping round shapes, united: the slice every figure samples. */
const blob = (p: Vec) => Math.max(circle(p, [-0.28, 0.12], 0.56), circle(p, [0.36, -0.22], 0.42))

const PANEL = 84
/** Half-width of the slice each panel shows, just wider than the blob. */
const EXTENT = 0.95

/** Sample positions of an n-per-axis grid across one panel, and their slice coordinates. */
function samples(n: number) {
  const step = PANEL / (n - 1)
  return Array.from({ length: n * n }, (_, i) => {
    const col = i % n
    const row = Math.floor(i / n)
    const point: Vec = [((col / (n - 1)) * 2 - 1) * EXTENT, ((row / (n - 1)) * 2 - 1) * EXTENT]
    return { col, row, x: col * step, y: row * step, value: blob(point) }
  })
}

/** The blob's zero contour, traced finely for reference outlines. */
function contourPath(): string {
  const n = 48
  const grid = samples(n)
  const step = PANEL / (n - 1)
  return marchingSquares(grid, n, step)
}

/** Line segments where the sampled field crosses 0, interpolated along cell edges. */
function marchingSquares(grid: ReturnType<typeof samples>, n: number, step: number): string {
  const at = (col: number, row: number) => grid[row * n + col]!.value
  const segments: string[] = []
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n - 1; col++) {
      const corners = [
        [col, row],
        [col + 1, row],
        [col + 1, row + 1],
        [col, row + 1],
      ] as const
      const crossings: Vec[] = []
      for (let edge = 0; edge < 4; edge++) {
        const [ac, ar] = corners[edge]!
        const [bc, br] = corners[(edge + 1) % 4]!
        const a = at(ac, ar)
        const b = at(bc, br)
        if (a > 0 !== b > 0) {
          const t = a / (a - b)
          crossings.push([(ac + (bc - ac) * t) * step, (ar + (br - ar) * t) * step])
        }
      }
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const [p, q] = [crossings[i]!, crossings[i + 1]!]
        segments.push(`M${p[0].toFixed(1)} ${p[1].toFixed(1)} L${q[0].toFixed(1)} ${q[1].toFixed(1)}`)
      }
    }
  }
  return segments.join(' ')
}

const CONTOUR = contourPath()

/** Density: a number at every point, positive inside, negative outside, zero on the surface. */
export function DensityFigure() {
  const grid = samples(9)
  return (
    <LearnFigure label="A density field: positive inside the shape, negative outside, zero on its surface">
      <svg viewBox="0 0 300 102">
        <g transform="translate(34 4)">
          {grid.map((sample) =>
            sample.value > 0 ? (
              <circle key={`${sample.col}-${sample.row}`} className="lf-fill" cx={sample.x} cy={sample.y} r={2.4} />
            ) : (
              <circle key={`${sample.col}-${sample.row}`} className="lf-faint" cx={sample.x} cy={sample.y} r={2.2} />
            ),
          )}
          <path className="lf-accent" d={CONTOUR} />
          <FigureCaption x={PANEL / 2} y={96} title="Density slice" />
        </g>
        <g transform="translate(152 0)">
          <circle className="lf-fill" cx={4} cy={24} r={2.4} />
          <text className="lf-label" x={14} y={27}>
            d &gt; 0 · inside, solid
          </text>
          <circle className="lf-faint" cx={4} cy={46} r={2.2} />
          <text className="lf-label" x={14} y={49}>
            d &lt; 0 · outside, empty
          </text>
          <line className="lf-accent" x1={0} y1={68} x2={9} y2={68} />
          <text className="lf-label is-accent" x={14} y={71}>
            d = 0 · the surface
          </text>
        </g>
      </svg>
    </LearnFigure>
  )
}

const A: Vec = [-9, 34]
const B: Vec = [11, 34]

/** Union, subtract and intersect as shapes: max, min with a negation, min. */
export function CsgFigure() {
  const id = useId()
  const panels = [
    { key: 'union', title: 'Union', note: 'max(a, b)' },
    { key: 'subtract', title: 'Subtract', note: 'min(a, −b)' },
    { key: 'intersect', title: 'Intersect', note: 'min(a, b)' },
  ] as const
  return (
    <LearnFigure label="CSG: union, subtract and intersect of two shapes">
      <svg viewBox="0 0 300 92">
        <defs>
          <mask id={`${id}-minus`}>
            <rect x={-40} y={0} width={80} height={70} fill="white" />
            <circle cx={B[0]} cy={B[1]} r={19} fill="black" />
          </mask>
          <clipPath id={`${id}-and`}>
            <circle cx={B[0]} cy={B[1]} r={19} />
          </clipPath>
        </defs>
        {panels.map((panel, i) => (
          <g key={panel.key} transform={`translate(${50 + i * 100} 0)`}>
            {panel.key === 'union' ? (
              <>
                <circle className="lf-solid" cx={A[0]} cy={A[1]} r={24} />
                <circle className="lf-solid" cx={B[0]} cy={B[1]} r={19} />
              </>
            ) : null}
            {panel.key === 'subtract' ? (
              <circle className="lf-solid" cx={A[0]} cy={A[1]} r={24} mask={`url(#${id}-minus)`} />
            ) : null}
            {panel.key === 'intersect' ? (
              <circle className="lf-solid" cx={A[0]} cy={A[1]} r={24} clipPath={`url(#${id}-and)`} />
            ) : null}
            <circle className="lf-faint" strokeDasharray="2 2" cx={A[0]} cy={A[1]} r={24} />
            <circle className="lf-faint" strokeDasharray="2 2" cx={B[0]} cy={B[1]} r={19} />
            <FigureCaption x={0} title={panel.title} note={panel.note} />
          </g>
        ))}
      </svg>
    </LearnFigure>
  )
}

/** Solid cells of an n-per-axis grid, each centred on its sample. */
function VoxelSlice({ n }: { n: number }) {
  const step = PANEL / (n - 1)
  return (
    <>
      {samples(n)
        .filter((sample) => sample.value > 0)
        .map((sample) => (
          <rect
            key={`${sample.col}-${sample.row}`}
            className="lf-cell"
            x={sample.x - step / 2}
            y={sample.y - step / 2}
            width={step}
            height={step}
          />
        ))}
    </>
  )
}

/** The same shape sampled coarsely and finely. */
export function ResolutionFigure() {
  return (
    <LearnFigure label="The same density field sampled at two resolutions">
      <svg viewBox="0 0 300 114">
        <g transform="translate(34 8)">
          <VoxelSlice n={7} />
          <path className="lf-accent" d={CONTOUR} />
          <FigureCaption x={PANEL / 2} y={96} title="7 per axis" note="343 samples" />
        </g>
        <FigureArrow x={134} y={50} length={28} />
        <g transform="translate(180 8)">
          <VoxelSlice n={14} />
          <path className="lf-accent" d={CONTOUR} />
          <FigureCaption x={PANEL / 2} y={96} title="14 per axis" note="2,744 samples · ×8" />
        </g>
      </svg>
    </LearnFigure>
  )
}

const MESH_N = 9

/** Block faces between solid and empty cells, for one slice. */
function blockOutline(): string {
  const grid = samples(MESH_N)
  const step = PANEL / (MESH_N - 1)
  const solid = (col: number, row: number) =>
    col >= 0 && row >= 0 && col < MESH_N && row < MESH_N && grid[row * MESH_N + col]!.value > 0
  const edges: string[] = []
  for (const { col, row, x, y } of grid) {
    if (!solid(col, row)) {
      continue
    }
    const [l, t, r, b] = [x - step / 2, y - step / 2, x + step / 2, y + step / 2]
    if (!solid(col, row - 1)) edges.push(`M${l} ${t} H${r}`)
    if (!solid(col, row + 1)) edges.push(`M${l} ${b} H${r}`)
    if (!solid(col - 1, row)) edges.push(`M${l} ${t} V${b}`)
    if (!solid(col + 1, row)) edges.push(`M${r} ${t} V${b}`)
  }
  return edges.join(' ')
}

const BLOCK_OUTLINE = blockOutline()
const SMOOTH_OUTLINE = marchingSquares(samples(MESH_N), MESH_N, PANEL / (MESH_N - 1))

/** Blocks vs Marching Cubes on the same samples. */
export function MeshingFigure() {
  const grid = samples(MESH_N)
  const emptyDot = (sample: (typeof grid)[number]) => (
    <circle key={`${sample.col}-${sample.row}`} className="lf-faint" cx={sample.x} cy={sample.y} r={1.4} />
  )
  const dots = grid.map((sample) =>
    sample.value > 0 ? (
      <circle key={`${sample.col}-${sample.row}`} className="lf-fill" cx={sample.x} cy={sample.y} r={1.6} />
    ) : (
      emptyDot(sample)
    ),
  )
  return (
    <LearnFigure label="Blocks and marching cubes surfaces from the same samples">
      <svg viewBox="0 0 300 114">
        <g transform="translate(34 8)">
          {grid.filter((sample) => sample.value <= 0).map(emptyDot)}
          <VoxelSlice n={MESH_N} />
          <path className="lf-accent" d={BLOCK_OUTLINE} />
          <FigureCaption x={PANEL / 2} y={96} title="Blocks" note="faces between cells" />
        </g>
        <FigureArrow x={134} y={50} length={28} />
        <g transform="translate(180 8)">
          {dots}
          <path className="lf-accent" d={SMOOTH_OUTLINE} />
          <FigureCaption x={PANEL / 2} y={96} title="Marching cubes" note="vertices where d = 0" />
        </g>
      </svg>
    </LearnFigure>
  )
}
