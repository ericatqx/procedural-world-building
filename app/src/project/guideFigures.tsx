import { useId } from 'react'
import { FigureArrow as Arrow, FigureCaption as Caption, LearnFigure } from '../shared/ui/learn.tsx'
import { MEMORY_DAYS } from './habitat.ts'
import { PROJECT_COLORS } from './materials.ts'

/** Mini diagrams for the Project GUIDE steps, drawn with the shared `lf-*` classes. */

const GROUND_Y = 66
/** Sunlight falls down and to the right, this much down per unit across. */
const RAY_SLOPE = 0.6
const rayAt = (x: number, y: number, toY: number) => x + (toY - y) / RAY_SLOPE

/** Growth → Shelter: a section through one mass; the ray past its top edge bounds the sheltered ground. */
export function ShelterFigure() {
  const corner = [132, 22] as const
  const shadowEnd = rayAt(corner[0], corner[1], GROUND_Y)
  const top = 4
  /** One ray stopped by the mass, one grazing its top edge, one reaching open ground. */
  const rays = [
    [34, top, 104, top + (104 - 34) * RAY_SLOPE],
    [rayAt(corner[0], corner[1], top), top, shadowEnd, GROUND_Y],
    [176, top, rayAt(176, top, GROUND_Y), GROUND_Y],
  ] as const
  return (
    <LearnFigure label="A block casts shadow: the ground beyond it becomes sheltered">
      <svg viewBox="0 0 300 92">
        <circle className="lf-line" cx={16} cy={8} r={4.5} />
        <text className="lf-label" x={26} y={11}>
          Sun
        </text>
        {rays.map(([x1, y1, x2, y2]) => (
          <line key={x1} className="lf-faint" x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
        <path className="lf-solid" d="M104 66 V34 H116 V22 H132 V34 H140 V66 Z" />
        <line className="lf-line" x1={6} y1={GROUND_Y} x2={294} y2={GROUND_Y} />
        {Array.from({ length: 11 }, (_, k) => 142 + k * 6).map((x) =>
          x < shadowEnd - 2 ? (
            <line key={x} className="lf-accent" x1={x} y1={GROUND_Y + 1} x2={x - 4} y2={GROUND_Y + 6} />
          ) : null,
        )}
        <line className="lf-accent" x1={140} y1={GROUND_Y} x2={shadowEnd} y2={GROUND_Y} />
        <Caption x={122} y={80} title="Growth" note="mass" />
        <Caption x={(140 + shadowEnd) / 2} y={80} title="Sheltered" note="new shade" />
        <text className="lf-label" x={294} y={GROUND_Y - 6} textAnchor="end">
          Open ground
        </text>
      </svg>
    </LearnFigure>
  )
}

/** Remembered daily sunlight, as a share of open ground, over the memory days. */
const DAYS = [0.82, 0.46, 0.38, 0.3] as const
const LIMIT = 0.7
const BAR = { x: 8, width: 12, gap: 4, base: 62, height: 52 } as const

/** Shelter → Habitat: days of remembered sunlight under the limit, with footing and moisture, make habitat. */
export function HabitatFigure() {
  const clipId = `${useId()}-patch`
  const mean = DAYS.reduce((sum, value) => sum + value, 0) / DAYS.length
  const level = (value: number) => BAR.base - value * BAR.height
  const barsRight = BAR.x + DAYS.length * (BAR.width + BAR.gap) - BAR.gap
  return (
    <LearnFigure label="Remembered sunlight under the limit, with footing and moisture, makes habitat">
      <svg viewBox="0 0 300 92">
        {DAYS.slice(0, MEMORY_DAYS).map((value, k) => {
          const x = BAR.x + k * (BAR.width + BAR.gap)
          return <rect key={x} className="lf-cell" x={x} y={level(value)} width={BAR.width} height={value * BAR.height} />
        })}
        <line className="lf-faint" x1={BAR.x - 3} y1={level(LIMIT)} x2={barsRight + 3} y2={level(LIMIT)} strokeDasharray="3 2" />
        <text className="lf-label" x={barsRight + 6} y={level(LIMIT) + 3}>
          limit
        </text>
        <line className="lf-accent" x1={BAR.x - 3} y1={level(mean)} x2={barsRight + 3} y2={level(mean)} />
        <Caption x={36} title="Shelter" note={`${MEMORY_DAYS} days’ sun`} />

        <text className="lf-label" x={102} y={40} textAnchor="middle">
          ×
        </text>
        <g transform="translate(110 0)">
          <line className="lf-faint" x1={2} y1={GROUND_Y - 4} x2={50} y2={GROUND_Y - 4} />
          <path className="lf-line" d="M2 58 L50 46" />
          <Caption x={26} title="Footing" note="not too steep" />
        </g>
        <text className="lf-label" x={170} y={40} textAnchor="middle">
          ×
        </text>
        <g transform="translate(178 0)">
          <path className="lf-water" d="M2 50 Q 14 44 26 50 T 50 50 V62 H2 Z" />
          <Caption x={26} title="Moisture" note="near water" />
        </g>
        <Arrow x={234} y={40} length={12} />

        <g transform="translate(252 0)">
          <defs>
            <clipPath id={clipId}>
              <path d="M4 58 C 2 42 14 30 28 32 C 42 34 46 48 40 58 Z" />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            {Array.from({ length: 12 }, (_, k) => k * 5 - 10).map((x) => (
              <line key={x} x1={x} y1={62} x2={x + 30} y2={28} stroke={PROJECT_COLORS.habitat} strokeWidth="1" />
            ))}
          </g>
          <path className="lf-accent" d="M4 58 C 2 42 14 30 28 32 C 42 34 46 48 40 58 Z" />
          <Caption x={22} title="Habitat" note="suitable" />
        </g>
      </svg>
    </LearnFigure>
  )
}
