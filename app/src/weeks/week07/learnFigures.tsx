import { FigureArrow as Arrow, FigureCaption as Caption, LearnFigure } from '../../shared/ui/learn.tsx'

/** Mini diagrams for the Week 07 Trace Growth LEARN steps, drawn with the shared `lf-*` classes. */

type Line = readonly [number, number, number, number]

/**
 * A strict split tree in 2D, the same rule as X → F/[+X][-X] at Randomness 0.
 * `lean` turns every branch a share of the way toward `toward` (radians from
 * vertical), as a tropism would.
 */
function splitTree(
  x: number,
  y: number,
  angle: number,
  length: number,
  depth: number,
  spread: number,
  lean = 0,
  toward = 0,
): Line[] {
  const heading = angle + (toward - angle) * lean
  const x2 = x + Math.sin(heading) * length
  const y2 = y - Math.cos(heading) * length
  const lines: Line[] = [[x, y, x2, y2]]
  if (depth > 0) {
    for (const side of [-1, 1]) {
      lines.push(...splitTree(x2, y2, heading + side * spread, length * 0.72, depth - 1, spread, lean, toward))
    }
  }
  return lines
}

function Lines({ lines, accentFrom }: { lines: readonly Line[]; accentFrom?: number }) {
  return (
    <>
      {lines.map(([x1, y1, x2, y2], i) => (
        <line
          key={i}
          className={accentFrom !== undefined && i >= accentFrom ? 'lf-accent' : 'lf-line'}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
        />
      ))}
    </>
  )
}

/** One rewrite: an apex X becomes an internode and two new apexes. */
export function RewriteFigure() {
  return (
    <LearnFigure label="One apex X rewritten into an internode F and two new apexes">
      <svg viewBox="0 0 300 96">
        <g transform="translate(70 0)">
          <circle className="lf-dot" cx={0} cy={56} r={3} />
          <text className="lf-label is-accent" x={8} y={52}>
            X
          </text>
          <Caption x={0} y={80} title="Apex" note="a growing tip" />
        </g>
        <Arrow x={118} y={48} length={22} />
        <g transform="translate(210 0)">
          <line className="lf-line" x1={0} y1={62} x2={0} y2={40} />
          <line className="lf-accent" x1={0} y1={40} x2={-16} y2={24} />
          <line className="lf-accent" x1={0} y1={40} x2={16} y2={24} />
          <circle className="lf-dot" cx={-16} cy={24} r={2.5} />
          <circle className="lf-dot" cx={16} cy={24} r={2.5} />
          <text className="lf-label" x={5} y={56}>
            F
          </text>
          <text className="lf-label is-accent" x={-30} y={22}>
            X
          </text>
          <text className="lf-label is-accent" x={21} y={22}>
            X
          </text>
          <Caption x={0} y={80} title="F/[+X][−X]" note="internode, two new tips" />
        </g>
      </svg>
    </LearnFigure>
  )
}

/** Generations: the same rule applied 1, 2 and 4 times; the newest internodes in accent. */
export function GenerationsFigure() {
  const panel = (cx: number, depth: number) => {
    const lines = splitTree(cx, 64, 0, 18, depth, 0.5)
    const newest = lines.length - 2 ** depth
    return <Lines lines={lines} accentFrom={newest} />
  }
  return (
    <LearnFigure label="The split rule applied once, twice and four times">
      <svg viewBox="0 0 300 96">
        {panel(50, 1)}
        <Caption x={50} title="n = 1" note="3 internodes" />
        <Arrow x={88} y={44} />
        {panel(150, 2)}
        <Caption x={150} title="n = 2" note="7" />
        <Arrow x={196} y={44} />
        {panel(250, 4)}
        <Caption x={250} title="n = 4" note="31" />
      </svg>
    </LearnFigure>
  )
}

/** The turtle's frame, and a branch that saves the turtle at [ and returns to it at ]. */
export function TurtleFigure() {
  return (
    <LearnFigure label="The turtle's heading, left and up axes, and a branch saved and restored">
      <svg viewBox="0 0 300 102">
        <g transform="translate(70 52)">
          <line className="lf-accent" x1={0} y1={0} x2={0} y2={-34} />
          <line className="lf-line" x1={0} y1={0} x2={-30} y2={8} />
          <line className="lf-line" x1={0} y1={0} x2={22} y2={14} />
          <circle className="lf-dot" cx={0} cy={0} r={2.5} />
          <text className="lf-label is-accent" x={5} y={-30}>
            H
          </text>
          <text className="lf-label" x={-42} y={12}>
            L
          </text>
          <text className="lf-label" x={25} y={22}>
            U
          </text>
          <Caption x={0} y={36} title="Frame" note="+ − yaw · &amp; ^ pitch · / roll" />
        </g>
        <g transform="translate(220 0)">
          <line className="lf-line" x1={0} y1={70} x2={0} y2={40} />
          <line className="lf-line" x1={0} y1={40} x2={0} y2={14} />
          <line className="lf-accent" x1={0} y1={40} x2={24} y2={20} />
          <circle className="lf-dot" cx={0} cy={40} r={3} />
          <path className="lf-faint" d="M24 20 Q 26 38 5 41" strokeDasharray="2 2" />
          <text className="lf-label is-accent" x={-14} y={44}>
            [
          </text>
          <text className="lf-label" x={28} y={36}>
            ]
          </text>
          <Caption x={0} y={88} title="F [ +F F ] F" note="branch, then back to the fork" />
        </g>
      </svg>
    </LearnFigure>
  )
}

/** One grammar, three responses: the same strict tree free, leaning to the sun, and drawn under a slab. */
export function ResponseFigure() {
  const free = splitTree(50, 66, 0, 16, 3, 0.55)
  const light = splitTree(150, 66, 0, 16, 3, 0.55, 0.55, 0.9)
  return (
    <LearnFigure label="The same tree grown free, toward light, and toward shelter">
      <svg viewBox="0 0 300 96">
        <line className="lf-faint" x1={14} y1={66} x2={286} y2={66} />
        <Lines lines={free} />
        <Caption x={50} title="Free" note="the grammar alone" />

        <Lines lines={light} />
        <circle className="lf-accent" cx={190} cy={12} r={5} />
        <Caption x={150} title="Seek light" note="toward the sun" />

        <rect className="lf-fill" x={234} y={30} width={50} height={4} />
        <rect className="lf-fill" x={278} y={34} width={6} height={32} />
        <circle className="lf-dot" cx={222} cy={65} r={2} />
        <polyline className="lf-line" points="222,65 238,63 256,64 270,62" />
        <polyline className="lf-line" points="238,63 250,58 266,56" />
        <polyline className="lf-accent" points="256,64 262,60 274,58" />
        <polyline className="lf-accent" points="270,62 276,52" />
        <polyline className="lf-line" points="250,58 258,48 268,44" />
        <Caption x={250} title="Seek shelter" note="toward the shade" />
      </svg>
    </LearnFigure>
  )
}
