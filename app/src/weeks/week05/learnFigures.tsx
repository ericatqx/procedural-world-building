import { useId } from 'react'
import {
  FigureArrow as Arrow,
  FigureCaption as Caption,
  LearnFigure,
} from '../../shared/ui/learn.tsx'
import { STUDY_COLORS } from './studies.ts'

/** Mini diagrams for the Week 05 LEARN steps, drawn with the shared `lf-*` classes. */

type Point = readonly [number, number]

const TRIANGLE: readonly [Point, Point, Point] = [
  [8, 62],
  [72, 62],
  [44, 6],
]
/** A value carried by each vertex, blended across the triangle by the rasteriser. */
const VERTEX_VALUES = [0.12, 0.92, 0.5] as const
const PIXEL = 6

function barycentric([px, py]: Point): [number, number, number] {
  const [[ax, ay], [bx, by], [cx, cy]] = TRIANGLE
  const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
  const u = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det
  const v = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det
  return [u, v, 1 - u - v]
}

/** Pixel cells whose centre falls inside the triangle, with the interpolated value. */
const PIXELS = (() => {
  const cells: { x: number; y: number; value: number }[] = []
  for (let y = 0; y < 66; y += PIXEL) {
    for (let x = 0; x < 80; x += PIXEL) {
      const weights = barycentric([x + PIXEL / 2, y + PIXEL / 2])
      if (weights.every((w) => w >= 0)) {
        const value = weights.reduce((sum, w, i) => sum + w * VERTEX_VALUES[i]!, 0)
        cells.push({ x, y, value })
      }
    }
  }
  return cells
})()

const trianglePath = `M${TRIANGLE.map(([x, y]) => `${x} ${y}`).join(' L')} Z`

const grey = (value: number) => {
  const level = Math.round(24 + value * 210)
  return `rgb(${level}, ${level - 2}, ${level - 6})`
}

/** Vertex → Raster → Fragment on one triangle. */
export function PipelineFigure() {
  return (
    <LearnFigure label="Vertex, raster and fragment stages on one triangle">
      <svg viewBox="0 0 300 92">
        <g>
          <path className="lf-faint" d={trianglePath} />
          {TRIANGLE.map(([x, y]) => (
            <circle key={`${x}-${y}`} className="lf-dot" cx={x} cy={y} r={2.6} />
          ))}
          <Caption x={40} title="Vertex" note="per corner" />
        </g>
        <Arrow x={88} y={36} />
        <g transform="translate(110 0)">
          {PIXELS.map((cell) => (
            <rect
              key={`${cell.x}-${cell.y}`}
              className="lf-faint"
              x={cell.x + 0.5}
              y={cell.y + 0.5}
              width={PIXEL - 1}
              height={PIXEL - 1}
            />
          ))}
          <path className="lf-line" d={trianglePath} />
          <Caption x={40} title="Raster" note="fills pixels" />
        </g>
        <Arrow x={198} y={36} />
        <g transform="translate(220 0)">
          {PIXELS.map((cell) => (
            <rect
              key={`${cell.x}-${cell.y}`}
              x={cell.x}
              y={cell.y}
              width={PIXEL}
              height={PIXEL}
              fill={grey(cell.value)}
            />
          ))}
          <Caption x={40} title="Fragment" note="per pixel" />
        </g>
      </svg>
    </LearnFigure>
  )
}

const HILL = 'M4 60 C 16 58 22 18 34 14 C 44 11 54 50 66 60 Z'
const RAMP = STUDY_COLORS.heightRamp

/** Geometry → Field → Rule → Result, on the Height study. */
export function FlowFigure() {
  const id = useId()
  const fieldId = `${id}-field`
  const rampId = `${id}-ramp`
  const clipId = `${id}-clip`
  return (
    <LearnFigure label="Geometry, field, rule and result for the Height study">
      <svg viewBox="0 0 300 92">
        <defs>
          <linearGradient id={fieldId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#000000" />
            <stop offset="1" stopColor="#ffffff" />
          </linearGradient>
          <linearGradient id={rampId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={RAMP[0]} />
            <stop offset="0.4" stopColor={RAMP[1]} />
            <stop offset="0.7" stopColor={RAMP[2]} />
            <stop offset="1" stopColor={RAMP[3]} />
          </linearGradient>
          <clipPath id={clipId}>
            <path d={HILL} />
          </clipPath>
        </defs>

        <path className="lf-line" d={HILL} />
        <Caption x={35} title="Geometry" note="the form" />
        <Arrow x={66} y={36} />

        <g transform="translate(76 0)">
          <path d={HILL} fill={`url(#${fieldId})`} />
          <Caption x={35} title="Field" note="height y" />
        </g>
        <Arrow x={142} y={36} />

        <g transform="translate(152 0)">
          <path className="lf-faint" d="M8 60 H64 M8 60 V8" />
          <path className="lf-accent" d="M8 56 H20 L52 14 H64" />
          <Caption x={35} title="Rule" note="low → high" />
        </g>
        <Arrow x={218} y={36} />

        <g transform="translate(228 0)">
          <g clipPath={`url(#${clipId})`}>
            <rect x="0" y="0" width="70" height="62" fill={`url(#${rampId})`} />
            {[22, 34, 46].map((y) => (
              <line key={y} x1="0" x2="70" y1={y} y2={y} stroke="#f6f3ec" strokeWidth="0.8" />
            ))}
          </g>
          <Caption x={35} title="Result" note="colour" />
        </g>
      </svg>
    </LearnFigure>
  )
}

/** Fresnel: brightness from the angle between the normal and the view. */
export function FresnelFigure() {
  const rimId = `${useId()}-rim`
  const cx = 62
  const cy = 46
  const r = 32
  const arrowTip = cx + r + 24
  return (
    <LearnFigure label="Fresnel: the rim brightens where the surface turns away from the view">
      <svg viewBox="0 0 300 88">
        <defs>
          <radialGradient id={rimId}>
            <stop offset="0.55" stopColor="#141414" />
            <stop offset="0.85" stopColor="#4a4945" />
            <stop offset="1" stopColor={STUDY_COLORS.rim} />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r} fill={`url(#${rimId})`} />

        {[cy - 18, cy + 18].map((y) => (
          <g key={y}>
            <line className="lf-faint" x1={294} y1={y} x2={arrowTip} y2={y} />
            <path className="lf-faint" d={`M${arrowTip + 4} ${y - 3} L${arrowTip} ${y} L${arrowTip + 4} ${y + 3}`} />
          </g>
        ))}
        <text className="lf-label" x={294} y={cy - 24} textAnchor="end">
          View from camera
        </text>

        <line className="lf-accent" x1={cx} y1={cy - r} x2={cx} y2={cy - r - 12} />
        <text className="lf-label is-accent" x={cx + 8} y={cy - r - 4}>
          Grazing · n·v ≈ 0 · bright
        </text>
        <line className="lf-accent" x1={cx + r} y1={cy} x2={cx + r + 14} y2={cy} />
        <text className="lf-label is-accent" x={cx + r + 20} y={cy + 3}>
          Facing · n·v ≈ 1 · dark
        </text>
      </svg>
    </LearnFigure>
  )
}

const SURFACE_Y = 36
const DISPLACE_X = Array.from({ length: 15 }, (_, i) => 12 + i * 19.7)
const displaced = (x: number) =>
  SURFACE_Y - 17 * Math.sin(x * 0.045 + 0.6) * Math.cos(x * 0.017) - 8 * Math.sin(x * 0.13)

/** Displacement: vertices move along their normals before rasterising. */
export function DisplacementFigure() {
  const points = DISPLACE_X.map((x) => [x, displaced(x)] as const)
  return (
    <LearnFigure label="Displacement: each vertex moves along its normal">
      <svg viewBox="0 0 300 92">
        <line className="lf-faint" x1={6} y1={SURFACE_Y} x2={294} y2={SURFACE_Y} />
        {points.map(([x, y]) => (
          <line key={x} className="lf-faint" x1={x} y1={SURFACE_Y} x2={x} y2={y} />
        ))}
        <path className="lf-accent" d={`M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')}`} />
        {points.map(([x, y]) => (
          <circle key={x} className="lf-dot" cx={x} cy={y} r={1.8} />
        ))}
        <text className="lf-label is-accent" x={150} y={80} textAnchor="middle">
          transformed += n · a · noise
        </text>
        <text className="lf-label" x={150} y={90} textAnchor="middle">
          grey: original · accent: moved vertices
        </text>
      </svg>
    </LearnFigure>
  )
}
