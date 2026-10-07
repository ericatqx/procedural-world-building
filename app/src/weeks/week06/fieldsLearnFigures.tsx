import { FigureArrow as Arrow, FigureCaption as Caption, LearnFigure } from '../../shared/ui/learn.tsx'

/** Mini diagrams for the Week 06 Fields LEARN steps, drawn with the shared `lf-*` classes. */

const GROUND = 80
const WIND_ROWS = [16, 34, 52]
const WIND_COLUMNS = [20, 70, 120, 170, 220, 270]

const polyline = (points: readonly (readonly [number, number])[]) => points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
const sample = (from: number, to: number, f: (x: number) => number) =>
  Array.from({ length: 41 }, (_, i) => {
    const x = from + ((to - from) * i) / 40
    return [x, f(x)] as const
  })

/** One field, four readings: the same arrows carry a tracer, rain, snow and mist differently. */
export function ParticlesFigure() {
  return (
    <LearnFigure label="The same wind, read by particles of different fall, drag and influence">
      <svg viewBox="0 0 300 96">
        {WIND_ROWS.flatMap((y) =>
          WIND_COLUMNS.map((x) => (
            <g key={`${x}-${y}`}>
              <line className="lf-faint" x1={x - 7} y1={y} x2={x + 7} y2={y} />
              <polyline className="lf-faint" points={`${x + 3},${y - 3} ${x + 7},${y} ${x + 3},${y + 3}`} />
            </g>
          )),
        )}
        <line className="lf-line" x1={10} y1={GROUND} x2={290} y2={GROUND} />
        <polyline className="lf-accent" points={polyline(sample(14, 286, (x) => 25 + 3 * Math.sin(x / 18)))} />
        <polyline className="lf-line" points={polyline(sample(40, 92, (x) => 8 + (x - 40) * 1.38))} />
        <polyline className="lf-line" points={polyline(sample(130, 250, (x) => 10 + (x - 130) * 0.55 + 4 * Math.sin(x / 7)))} />
        <polyline className="lf-line" points={polyline(sample(150, 290, (x) => GROUND - 5 - 1.5 * Math.sin(x / 11)))} strokeDasharray="3 2" />
        <text className="lf-label is-accent" x={232} y={20}>
          wind
        </text>
        <text className="lf-label" x={66} y={92}>
          rain
        </text>
        <text className="lf-label" x={214} y={70}>
          snow
        </text>
        <text className="lf-label" x={120} y={92}>
          mist
        </text>
      </svg>
    </LearnFigure>
  )
}

/** A ripple: a drop meets the water, thin rings spread from it and fade. Drawn in perspective, as the lake is seen. */
export function RippleFigure() {
  const ring = (rx: number, opacity: number, accent = false) => (
    <ellipse key={rx} className={accent ? 'lf-accent' : 'lf-line'} cx={0} cy={0} rx={rx} ry={rx * 0.32} opacity={opacity} />
  )
  return (
    <LearnFigure label="A raindrop meets the lake; two thin rings spread from it and fade">
      <svg viewBox="0 0 300 92">
        <g transform="translate(48 40)">
          <line className="lf-line" x1={0} y1={-26} x2={0} y2={-8} />
          <circle className="lf-dot" cx={0} cy={0} r={2} />
          <Caption x={0} y={38} title="Drop lands" note="on open water" />
        </g>
        <Arrow x={88} y={40} />
        <g transform="translate(150 40)">
          {ring(10, 0.7)}
          {ring(20, 1, true)}
          <Caption x={0} y={38} title="Rings spread" note="crest, then trough" />
        </g>
        <Arrow x={196} y={40} />
        <g transform="translate(252 40)">
          {ring(20, 0.25)}
          {ring(32, 0.4, true)}
          <Caption x={0} y={38} title="Fades" note="the water settles" />
        </g>
      </svg>
    </LearnFigure>
  )
}
