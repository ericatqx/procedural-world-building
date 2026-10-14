import { FigureArrow as Arrow, FigureCaption as Caption, LearnFigure } from '../../shared/ui/learn.tsx'

/** Mini diagrams for the Week 07 Branching Histories LEARN steps, drawn with the shared `lf-*` classes. */

type Point = readonly [number, number]

const TREE_NODES: Record<string, Point> = {
  origin: [22, 40],
  stable: [86, 12],
  decay: [86, 40],
  collapse: [86, 66],
  stableCourse: [150, 12],
  decayCourse: [150, 40],
  collapseCourse: [150, 58],
  dam: [150, 72],
  ecology: [214, 12],
  corridor: [214, 32],
  refuge: [214, 46],
  reclaimed: [214, 58],
  wetland: [214, 72],
}

const TREE_LINKS: readonly [string, string][] = [
  ['origin', 'stable'],
  ['origin', 'decay'],
  ['origin', 'collapse'],
  ['stable', 'stableCourse'],
  ['decay', 'decayCourse'],
  ['collapse', 'collapseCourse'],
  ['collapse', 'dam'],
  ['stableCourse', 'ecology'],
  ['decayCourse', 'corridor'],
  ['decayCourse', 'refuge'],
  ['collapseCourse', 'reclaimed'],
  ['dam', 'wetland'],
]

const TREE_PATH = new Set(['origin-decay', 'decay-decayCourse', 'decayCourse-corridor'])

const PRESENTS: readonly [string, string][] = [
  ['ecology', 'Stable'],
  ['corridor', 'Corridor'],
  ['refuge', 'Refuge'],
  ['reclaimed', 'Reclaimed'],
  ['wetland', 'Wetland'],
]

/** The history tree: one origin, stages left to right, five presents; one history traced in accent. */
export function HistoryTreeFigure() {
  return (
    <LearnFigure label="One origin branching through structure and water stages into five presents">
      <svg viewBox="0 0 300 100">
        {TREE_LINKS.map(([a, b]) => {
          const [x1, y1] = TREE_NODES[a]!
          const [x2, y2] = TREE_NODES[b]!
          const mid = (x1 + x2) / 2
          return (
            <path
              key={`${a}-${b}`}
              className={TREE_PATH.has(`${a}-${b}`) ? 'lf-accent' : 'lf-line'}
              d={`M${x1} ${y1} C ${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`}
            />
          )
        })}
        {Object.entries(TREE_NODES).map(([id, [x, y]]) => (
          <circle key={id} className={id === 'origin' || id === 'corridor' ? 'lf-dot' : 'lf-fill'} cx={x} cy={y} r={2.2} />
        ))}
        {PRESENTS.map(([id, label]) => (
          <text key={id} className={id === 'corridor' ? 'lf-label is-accent' : 'lf-label'} x={222} y={TREE_NODES[id]![1] + 3}>
            {label}
          </text>
        ))}
        <Caption x={22} y={90} title="Origin" />
        <Caption x={86} y={90} title="Structure" />
        <Caption x={150} y={90} title="Water" />
        <Caption x={232} y={90} title="Presents" />
      </svg>
    </LearnFigure>
  )
}

const CELL = 7

/** A column of architecture `height` cells tall, standing on the ground at (x, ground). */
function Stack({ x, ground, height }: { x: number; ground: number; height: number }) {
  return (
    <>
      {Array.from({ length: height }, (_, k) => (
        <rect key={k} className="lf-cell" x={x} y={ground - (k + 1) * CELL} width={CELL * 2} height={CELL} />
      ))}
    </>
  )
}

function Rubble({ at }: { at: readonly Point[] }) {
  return (
    <>
      {at.map(([x, y], k) => (
        <rect key={k} className="lf-fill" x={x} y={y} width={3} height={3} />
      ))}
    </>
  )
}

/** One failure rule at two rates: a few blocks lost and dropped close, or half the structure thrown wide at once. */
export function RatesFigure() {
  const ground = 64
  return (
    <LearnFigure label="The same structural failure rule run slowly and suddenly">
      <svg viewBox="0 0 300 96">
        <line className="lf-faint" x1={10} y1={ground} x2={140} y2={ground} />
        <Stack x={22} ground={ground} height={6} />
        <Arrow x={50} y={40} />
        <Stack x={86} ground={ground} height={4} />
        <Rubble at={[[104, 61], [109, 61]]} />
        <Caption x={75} title="Slow decay" note="a few voxels a season" />

        <line className="lf-faint" x1={160} y1={ground} x2={290} y2={ground} />
        <Stack x={172} ground={ground} height={6} />
        <Arrow x={200} y={40} />
        <Stack x={232} ground={ground} height={2} />
        <Rubble at={[[220, 61], [214, 61], [250, 61], [256, 59], [262, 61], [270, 61], [278, 60], [207, 61]]} />
        <Caption x={225} title="Sudden collapse" note="half of it in one season" />
      </svg>
    </LearnFigure>
  )
}

/** A conditional branch: rubble short of the water changes nothing; rubble in it dams it and the water spreads. */
export function DamFigure() {
  const ground = 60
  return (
    <LearnFigure label="Rubble that stops short of the water leaves it; rubble that reaches it dams it">
      <svg viewBox="0 0 300 96">
        <line className="lf-faint" x1={10} y1={ground} x2={140} y2={ground} />
        <rect className="lf-water" x={100} y={ground - 4} width={40} height={4} />
        <Rubble at={[[30, 57], [38, 57], [46, 57], [60, 57]]} />
        <Caption x={75} title="Short of the water" note="condition fails · no branch" />

        <line className="lf-faint" x1={160} y1={ground} x2={290} y2={ground} />
        <rect className="lf-water" x={214} y={ground - 4} width={76} height={4} />
        <line className="lf-accent" x1={250} y1={ground - 12} x2={250} y2={ground + 4} strokeDasharray="2 2" />
        <Rubble at={[[180, 57], [196, 57], [242, 57], [247, 54], [253, 57]]} />
        <text className="lf-label" x={254} y={ground - 14}>
          shore before
        </text>
        <Caption x={225} title="In the water" note="it dams · the water spreads" />
      </svg>
    </LearnFigure>
  )
}

/** The same place read two ways: what stands now, and the evidence of what happened. */
export function EvidenceFigure() {
  const ground = 62
  return (
    <LearnFigure label="World shows the present; Traces shows the former structure, rubble and routes">
      <svg viewBox="0 0 300 96">
        <line className="lf-faint" x1={10} y1={ground} x2={140} y2={ground} />
        <Stack x={40} ground={ground} height={2} />
        <polyline className="lf-line" points="86,62 86,46 82,40" />
        <polyline className="lf-line" points="86,52 92,44" />
        <polyline className="lf-line" points="98,62 98,50" />
        <circle className="lf-fill" cx={116} cy={59} r={2.5} />
        <Caption x={75} title="World" note="what exists now" />

        <line className="lf-faint" x1={160} y1={ground} x2={290} y2={ground} />
        <rect className="lf-faint" x={190} y={ground - 6 * CELL} width={CELL * 2} height={6 * CELL} strokeDasharray="2 2" />
        <Rubble at={[[210, 59], [216, 59], [224, 59], [184, 59]]} />
        <path className="lf-accent" d="M232 60 C 246 52 258 52 276 60" />
        <Caption x={225} title="Traces" note="how it came to be" />
      </svg>
    </LearnFigure>
  )
}
