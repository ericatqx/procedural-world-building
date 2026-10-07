import {
  FigureArrow as Arrow,
  FigureCaption as Caption,
  LearnFigure,
} from '../../shared/ui/learn.tsx'
import { mulberry32 } from './distribution.ts'

/** Mini diagrams for the Week 06 LEARN steps, drawn with the shared `lf-*` classes. */

type Dot = { x: number; y: number; w: number }

const PANEL = { width: 70, height: 60 } as const

/** Seeded points in one panel, with a weight from `weightAt`. */
function dots(seed: number, count: number, weightAt: (x: number, y: number) => number): Dot[] {
  const random = mulberry32(seed)
  return Array.from({ length: count }, () => {
    const x = 4 + random() * (PANEL.width - 8)
    const y = 4 + random() * (PANEL.height - 8)
    return { x, y, w: weightAt(x, y) }
  })
}

const blob = (x: number, y: number, cx: number, cy: number, r: number) =>
  Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (r * r))

/** Two soft patches, standing in for coherent noise. */
const patches = (x: number, y: number) => Math.min(1, blob(x, y, 20, 18, 14) + blob(x, y, 52, 42, 12))

const PIPELINE = dots(7, 26, patches)
/** The same draw for every candidate, so the accepted set is reproducible. */
const ACCEPTED = (() => {
  const random = mulberry32(19)
  return PIPELINE.map((dot) => random() < dot.w)
})()

/** Candidates → weight → accepted. */
export function PipelineFigure() {
  return (
    <LearnFigure label="Candidates are drawn, weighted, and accepted by a weighted draw">
      <svg viewBox="0 0 300 92">
        <g transform="translate(8 0)">
          {PIPELINE.map((dot, i) => (
            <circle key={i} className="lf-faint" cx={dot.x} cy={dot.y} r={2.4} />
          ))}
          <Caption x={35} y={76} title="Candidates" note="seeded" />
        </g>
        <Arrow x={84} y={30} />
        <g transform="translate(110 0)">
          {PIPELINE.map((dot, i) => (
            <circle key={i} className="lf-faint" cx={dot.x} cy={dot.y} r={1 + 3.4 * Math.sqrt(dot.w)} />
          ))}
          <Caption x={35} y={76} title="Weight" note="size = w" />
        </g>
        <Arrow x={186} y={30} />
        <g transform="translate(212 0)">
          {PIPELINE.map((dot, i) =>
            ACCEPTED[i] ? (
              <circle key={i} className="lf-dot" cx={dot.x} cy={dot.y} r={2.6} />
            ) : (
              <circle key={i} className="lf-faint" cx={dot.x} cy={dot.y} r={1.2} />
            ),
          )}
          <Caption x={35} y={76} title="Accepted" note="u < w" />
        </g>
      </svg>
    </LearnFigure>
  )
}

const RANDOM_DOTS = dots(3, 34, () => 1)
const NOISE_DOTS = (() => {
  const random = mulberry32(5)
  return dots(11, 120, patches)
    .filter((dot) => random() < dot.w)
    .slice(0, 34)
})()

/** The same number of points, uniform vs coherent. */
export function RandomNoiseFigure() {
  return (
    <LearnFigure label="Random scatters evenly by chance; noise gathers points into patches">
      <svg viewBox="0 0 300 92">
        <g transform="translate(46 0)">
          <rect className="lf-faint" x={0} y={0} width={PANEL.width} height={PANEL.height} />
          {RANDOM_DOTS.map((dot, i) => (
            <circle key={i} className="lf-dot" cx={dot.x} cy={dot.y} r={1.8} />
          ))}
          <Caption x={35} y={76} title="Random" note="w = 1 everywhere" />
        </g>
        <g transform="translate(184 0)">
          <rect className="lf-faint" x={0} y={0} width={PANEL.width} height={PANEL.height} />
          {NOISE_DOTS.map((dot, i) => (
            <circle key={i} className="lf-dot" cx={dot.x} cy={dot.y} r={1.8} />
          ))}
          <Caption x={35} y={76} title="Noise" note="w = noise(x, z)" />
        </g>
      </svg>
    </LearnFigure>
  )
}

const FACTORS = [
  ['elevation', 0.9],
  ['slope', 1],
  ['moisture', 0.7],
  ['light', 0.45],
  ['water', 1],
] as const
const PRODUCT = FACTORS.reduce((product, [, value]) => product * value, 1)
const BAR = { left: 18, width: 30, gap: 12, height: 44, top: 8 } as const

/** Soft factors multiply into one weight. */
export function SuitabilityFigure() {
  const resultX = BAR.left + FACTORS.length * (BAR.width + BAR.gap) + 16
  return (
    <LearnFigure label="Each preference gives a factor; the factors multiply into the weight">
      <svg viewBox="0 0 300 92">
        {FACTORS.map(([name, value], i) => {
          const x = BAR.left + i * (BAR.width + BAR.gap)
          return (
            <g key={name}>
              <rect className="lf-faint" x={x} y={BAR.top} width={BAR.width} height={BAR.height} />
              <rect
                className="lf-fill"
                x={x}
                y={BAR.top + BAR.height * (1 - value)}
                width={BAR.width}
                height={BAR.height * value}
                opacity={0.55}
              />
              <text className="lf-label" x={x + BAR.width / 2} y={BAR.top + BAR.height + 12} textAnchor="middle">
                {name}
              </text>
              <text className="lf-label" x={x + BAR.width / 2} y={BAR.top + BAR.height + 22} textAnchor="middle">
                {value.toFixed(2)}
              </text>
              {i < FACTORS.length - 1 ? (
                <text className="lf-label" x={x + BAR.width + BAR.gap / 2} y={BAR.top + BAR.height / 2 + 3} textAnchor="middle">
                  ×
                </text>
              ) : null}
            </g>
          )
        })}
        <text className="lf-label" x={resultX - 12} y={BAR.top + BAR.height / 2 + 3} textAnchor="middle">
          =
        </text>
        <rect className="lf-faint" x={resultX} y={BAR.top} width={BAR.width} height={BAR.height} />
        <rect
          className="lf-dot"
          x={resultX}
          y={BAR.top + BAR.height * (1 - PRODUCT)}
          width={BAR.width}
          height={BAR.height * PRODUCT}
        />
        <text className="lf-label is-accent" x={resultX + BAR.width / 2} y={BAR.top + BAR.height + 12} textAnchor="middle">
          weight
        </text>
        <text className="lf-label is-accent" x={resultX + BAR.width / 2} y={BAR.top + BAR.height + 22} textAnchor="middle">
          {PRODUCT.toFixed(2)}
        </text>
      </svg>
    </LearnFigure>
  )
}
