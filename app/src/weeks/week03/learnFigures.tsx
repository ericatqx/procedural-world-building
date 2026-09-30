import { FigureArrow, FigureCaption, LearnFigure } from '../../shared/ui/learn.tsx'

/** Mini diagrams for the Week 03 LEARN steps, drawn with the shared `lf-*` classes. */

const polyline = (points: readonly (readonly [number, number])[]) =>
  `M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')}`

const sampleX = (from: number, to: number, count: number) =>
  Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1))

/** Three octaves of the same idea: broad, mid and fine waves. */
const OCTAVES = [
  { label: 'Broad', wave: (t: number) => Math.sin(t * 5.2 + 0.4) * 0.9 + Math.sin(t * 2.1) * 0.4 },
  { label: 'Mid', wave: (t: number) => Math.sin(t * 14 + 1.3) * 0.45 },
  { label: 'Fine', wave: (t: number) => Math.sin(t * 41 + 2.1) * 0.18 },
] as const

/** Noise layers at different frequencies, weighted and summed into one field. */
export function LayersFigure() {
  const rowX = sampleX(34, 122, 60)
  const sumX = sampleX(158, 296, 90)
  const sum = (t: number) => OCTAVES.reduce((total, octave) => total + octave.wave(t), 0)
  return (
    <LearnFigure label="Noise layers at different frequencies summed into one height field">
      <svg viewBox="0 0 300 92">
        {OCTAVES.map((octave, row) => {
          const y = 12 + row * 24
          const points = rowX.map((x) => [x, y - octave.wave((x - 34) / 88) * 9] as const)
          return (
            <g key={octave.label}>
              <text className="lf-label" x={0} y={y + 3}>
                {octave.label}
              </text>
              <path className="lf-line" d={polyline(points)} />
            </g>
          )
        })}
        <FigureArrow x={132} y={36} length={16} />
        <path
          className="lf-accent"
          d={polyline(sumX.map((x) => [x, 36 - sum((x - 158) / 138) * 15] as const))}
        />
        <FigureCaption x={78} title="Layers" note="frequency · amplitude" />
        <FigureCaption x={227} title="Weighted sum" note="one field" />
      </svg>
    </LearnFigure>
  )
}

const GRID = 6
const CELL = 12
const HIGHLIGHT_ROW = 3
const heightAt = (col: number, row: number) =>
  0.5 + 0.35 * Math.sin(col * 0.9 + 0.3) * Math.cos(row * 0.7 - 0.4) + 0.12 * Math.sin(col * 2.3 + row)

const grey = (value: number) => {
  const level = Math.round(20 + Math.max(0, Math.min(1, value)) * 215)
  return `rgb(${level}, ${level - 2}, ${level - 6})`
}

/** One number per cell: the same grid read as a map and lifted into a mesh. */
export function HeightmapFigure() {
  const cells = Array.from({ length: GRID * GRID }, (_, i) => ({
    col: i % GRID,
    row: Math.floor(i / GRID),
  }))
  const barBase = 66
  const barScale = 52
  const bars = Array.from({ length: GRID }, (_, col) => ({
    x: 186 + col * 16,
    value: heightAt(col, HIGHLIGHT_ROW),
  }))
  return (
    <LearnFigure label="A heightmap grid shown as a 2D map and as 3D heights">
      <svg viewBox="0 0 300 92">
        <g transform="translate(40 0)">
          {cells.map(({ col, row }) => (
            <rect
              key={`${col}-${row}`}
              x={col * CELL}
              y={row * CELL}
              width={CELL}
              height={CELL}
              fill={grey(heightAt(col, row))}
            />
          ))}
          <rect className="lf-accent" x={0} y={HIGHLIGHT_ROW * CELL} width={GRID * CELL} height={CELL} />
          <FigureCaption x={36} title="2D map" note="one value per cell" />
        </g>
        <FigureArrow x={134} y={HIGHLIGHT_ROW * CELL + 6} length={30} />
        {bars.map((bar) => (
          <rect
            key={bar.x}
            x={bar.x - 6}
            y={barBase - bar.value * barScale}
            width={12}
            height={bar.value * barScale}
            fill={grey(bar.value)}
          />
        ))}
        <path
          className="lf-accent"
          d={polyline(bars.map((bar) => [bar.x, barBase - bar.value * barScale] as const))}
        />
        {bars.map((bar) => (
          <circle key={bar.x} className="lf-dot" cx={bar.x} cy={barBase - bar.value * barScale} r={1.8} />
        ))}
        <FigureCaption x={226} title="3D mesh" note="value lifts the vertex" />
      </svg>
    </LearnFigure>
  )
}

/* Screen y grows downward: a larger value is lower ground. */
const profileX = sampleX(8, 292, 90)
const bump = (x: number, centre: number, width: number) => Math.exp(-(((x - centre) / width) ** 2))
/** A slope falling left to right into a basin. */
const original = (x: number) => 18 + 24 / (1 + Math.exp(-(x - 110) / 20)) + 16 * bump(x, 240, 26)
/** The slope cut lower, the basin floor raised by what the water carried. */
const eroded = (x: number) => original(x) + 5 * bump(x, 112, 24) - 6 * bump(x, 240, 16)
const POOL_LEVEL = 46

/** Rain runs downhill, cuts the slope, and drops sediment where it slows. */
export function ErosionFigure() {
  const before = profileX.map((x) => [x, original(x)] as const)
  const after = profileX.map((x) => [x, eroded(x)] as const)
  const pool = profileX.filter((x) => x > 190 && eroded(x) > POOL_LEVEL)
  const poolPath =
    pool.length > 1
      ? `M${pool[0]!.toFixed(1)} ${POOL_LEVEL} ${pool.map((x) => `L${x.toFixed(1)} ${eroded(x).toFixed(1)}`).join(' ')} L${pool.at(-1)!.toFixed(1)} ${POOL_LEVEL} Z`
      : ''
  return (
    <LearnFigure label="Erosion: rain flows downhill, cutting slopes and depositing in basins">
      <svg viewBox="0 0 300 92">
        {[40, 64, 88, 112, 136].map((x) => (
          <line key={x} className="lf-faint" x1={x} y1={2} x2={x - 3} y2={9} />
        ))}
        <text className="lf-label" x={4} y={9}>
          Rain
        </text>
        <path className="lf-faint" strokeDasharray="2 3" d={polyline(before)} />
        <path className="lf-water" d={poolPath} />
        <path className="lf-line" d={polyline(after)} />
        <path className="lf-accent" d="M80 16 Q 108 22 136 33" />
        <path className="lf-accent" d="M131 29.5 L136 33 L130.5 34" />
        <text className="lf-label is-accent" x={100} y={46}>
          Cut
        </text>
        <text className="lf-label is-accent" x={240} y={70} textAnchor="middle">
          Deposit
        </text>
        <FigureCaption x={150} y={82} title="Water moves height" note="dashed: before · line: after" />
      </svg>
    </LearnFigure>
  )
}
