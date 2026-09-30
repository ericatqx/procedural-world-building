import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useShortcuts } from './shortcuts.ts'

/**
 * Shared instrument-layer primitives (see STYLE-GUIDE.md › Interface).
 * Styling lives in ui/system.css under the `.ui-system` root class.
 */

/** Semantic colour roles; everything without a tone stays neutral. */
export type Tone = 'signal' | 'water' | 'sediment' | 'x' | 'y' | 'z'

const ANNOTATION_GAP_PX = 12

/** Aligns the annotation with its trigger, just left of the panel edge. */
function annotationPosition(trigger: HTMLElement | null): CSSProperties | null {
  if (!trigger) {
    return null
  }
  const anchor = trigger.closest<HTMLElement>('[data-annotation-anchor]') ?? trigger
  return {
    top: Math.max(8, trigger.getBoundingClientRect().top - 4),
    right: window.innerWidth - anchor.getBoundingClientRect().left + ANNOTATION_GAP_PX,
  }
}

/**
 * Click-to-open explanation. The annotation is fixed-positioned to the left of
 * the nearest `[data-annotation-anchor]` (the instrument panel), extending
 * into the canvas instead of covering neighbouring controls. It closes on a
 * second click, Escape, or any pointer-down outside the trigger, and follows
 * the trigger while the panel scrolls.
 */
/** A label that opens its explanation, extending left from the panel, when clicked. */
export function InfoLabel({
  title,
  tip,
  className,
}: {
  title: string
  tip: ReactNode
  className: string
}) {
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const isOpen = position !== null
  const id = useId()

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const close = () => setPosition(null)
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        close()
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }
    const follow = () => setPosition(annotationPosition(wrapperRef.current))
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [isOpen])

  return (
    <span ref={wrapperRef} className="info">
      <button
        type="button"
        className={`info-label ${className}`}
        aria-expanded={isOpen}
        aria-controls={isOpen ? id : undefined}
        onClick={() =>
          setPosition(isOpen ? null : annotationPosition(wrapperRef.current))
        }
      >
        {title}
      </button>
      {isOpen ? (
        <span id={id} role="note" className="annotation" style={position}>
          <span className="annotation-title">{title}</span>
          <span className="annotation-text">{tip}</span>
        </span>
      ) : null}
    </span>
  )
}

export function Chevron({ open }: { open: boolean }) {
  return <span className={open ? 'chevron is-open' : 'chevron'} aria-hidden="true" />
}

export type ExerciseAbout = {
  text: string
  /** Monospace line naming the concepts in play. */
  terms?: string
  /** Monospace line listing the interactions. */
  controls?: string
}

/**
 * Exercise title in the left annotation column. `About` opens a quiet
 * drawer directly beneath it rather than a separate panel.
 */
export function ExerciseHeading({
  title,
  about,
  actions,
}: {
  title: string
  about?: ExerciseAbout
  /** Extra heading-row controls after About, such as a LEARN toggle. */
  actions?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const drawerId = useId()

  return (
    <>
      <header className="exercise-heading">
        <h1 className="exercise-title">{title}</h1>
        {about ? (
          <button
            type="button"
            className="about-toggle"
            aria-expanded={open}
            aria-controls={drawerId}
            onClick={() => setOpen((current) => !current)}
          >
            About
          </button>
        ) : null}
        {actions}
      </header>

      {about && open ? (
        <section id={drawerId} className="about-drawer" aria-label="About this exercise">
          <p className="about-text">{about.text}</p>
          {about.terms ? <p className="about-terms">{about.terms}</p> : null}
          {about.controls ? <p className="about-controls">{about.controls}</p> : null}
        </section>
      ) : null}
    </>
  )
}

/** Right-hand instrument layer; collapses to its header row. */
export function InstrumentPanel({
  label,
  utilities,
  children,
}: {
  label: string
  /** Panel-level tools under the title, outside the scrolling sections. */
  utilities?: ReactNode
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={collapsed ? 'instrument-panel is-collapsed' : 'instrument-panel'}
      aria-label={`${label} controls`}
      data-annotation-anchor=""
    >
      <div className="instrument-head">
        <span className="instrument-label">{label}</span>
        <button
          type="button"
          className="icon-button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Show controls' : 'Hide controls'}
          onClick={() => setCollapsed((current) => !current)}
        >
          <Chevron open={!collapsed} />
        </button>
      </div>
      {utilities ? (
        <div className="instrument-utilities" hidden={collapsed}>
          {utilities}
        </div>
      ) : null}
      <div className="instrument-body" hidden={collapsed}>
        {children}
      </div>
    </aside>
  )
}

export function PanelSection({
  index,
  title,
  tip,
  tone,
  status,
  action,
  children,
}: {
  index: string
  title: string
  tip?: string
  tone?: Tone
  status?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="panel-section" data-tone={tone}>
      <header className="panel-section-head">
        <span className="panel-section-index">{index}</span>
        {tip ? (
          <InfoLabel title={title} tip={tip} className="panel-section-title" />
        ) : (
          <span className="panel-section-title">{title}</span>
        )}
        {status}
        {action ? <span className="panel-section-action">{action}</span> : null}
      </header>
      <div className="panel-section-body">{children}</div>
    </section>
  )
}

/** Label on the left, monospace value on the right, control below. */
export function ControlField({
  label,
  value,
  tip,
  tone,
  children,
}: {
  label: string
  value?: string
  tip?: string
  tone?: Tone
  children: ReactNode
}) {
  return (
    <div className="control-field" data-tone={tone}>
      <div className="control-row">
        {tip ? (
          <InfoLabel title={label} tip={tip} className="control-label" />
        ) : (
          <span className="control-label">{label}</span>
        )}
        {value !== undefined ? <span className="control-value">{value}</span> : null}
      </div>
      {children}
    </div>
  )
}

export function Slider({
  value,
  min,
  max,
  step,
  disabled,
  label,
  onChange,
}: {
  value: number
  min: number
  max: number
  step: number
  disabled?: boolean
  label?: string
  onChange: (next: number) => void
}) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <input
      type="range"
      className="slider"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={label}
      style={{ '--fill': `${fill}%` } as CSSProperties}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  )
}

export function Toggle({
  label,
  checked,
  disabled,
  tone,
  className,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  tone?: Tone
  className?: string
  onChange: (next: boolean) => void
}) {
  const classes = ['toggle', checked ? 'is-on' : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <label className={classes} data-tone={tone}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

/** Toggle bound to a keyboard shortcut, shown as a keycap. */
export function KeyToggle({
  keyLabel,
  label,
  pressed,
  onChange,
}: {
  keyLabel: string
  label: string
  pressed: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      className={pressed ? 'view-toggle key-toggle is-on' : 'view-toggle key-toggle'}
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
    >
      <kbd>{keyLabel}</kbd>
      <span>{label}</span>
    </button>
  )
}

/** One render toggle in the view strip; `key` binds a single-key shortcut. */
export type ViewTool = {
  label: string
  key: string
  on: boolean
  onChange: (next: boolean) => void
}

/**
 * OrbitControls speed for the Auto rotate (R) view tool: about 100 s per turn.
 * The camera orbits rather than the mesh, so world-space shading stays fixed
 * to the form. Negative, so the subject appears to turn counter-clockwise.
 */
export const AUTO_ROTATE_SPEED = -0.6

/**
 * Bottom-left canvas strip: the page's render toggles in one row, always in
 * the order F Wireframe, C Contours, R Auto rotate (omitting any the page
 * lacks), their shortcuts bound, then any readout below. `actions` sit at
 * the end of the row for page-specific buttons.
 */
export function ViewTools({
  tools,
  actions,
  children,
}: {
  tools: readonly ViewTool[]
  actions?: ReactNode
  children?: ReactNode
}) {
  useShortcuts((key) => {
    const tool = tools.find((item) => item.key.toLowerCase() === key.toLowerCase())
    tool?.onChange(!tool.on)
    return tool !== undefined
  })

  return (
    <div className="view-strip">
      <div className="view-strip-row">
        {tools.map((tool) => (
          <KeyToggle
            key={tool.label}
            keyLabel={tool.key}
            label={tool.label}
            pressed={tool.on}
            onChange={tool.onChange}
          />
        ))}
        {actions}
      </div>
      {children}
    </div>
  )
}

export type SegmentOption<T extends string> = {
  value: T
  label: string
  tone?: Tone
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          data-tone={option.tone}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * One layer / step in a ruled list: a chevron header with a monospace summary
 * and an enable box; controls are revealed only when expanded.
 */
export function CollapsibleRow({
  title,
  summary,
  expanded,
  enabled,
  onToggle,
  onEnabledChange,
  actions,
  children,
}: {
  title: string
  summary: string
  expanded: boolean
  enabled: boolean
  onToggle: () => void
  onEnabledChange: (next: boolean) => void
  /** Extra header controls, placed before the enable box. */
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={enabled ? 'row' : 'row is-disabled'}>
      <div className="row-head">
        <button
          type="button"
          className="row-toggle"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <Chevron open={expanded} />
          <span className="row-title">{title}</span>
          <span className="row-summary">{summary}</span>
        </button>
        {actions}
        <input
          type="checkbox"
          className="row-enabled"
          checked={enabled}
          aria-label={`${title} enabled`}
          title={enabled ? 'Enabled' : 'Disabled'}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
      </div>
      {expanded ? <div className="row-body">{children}</div> : null}
    </section>
  )
}

/** Inline chevron disclosure for secondary detail (e.g. explanations). */
export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="disclosure">
      <button
        type="button"
        className="disclosure-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Chevron open={open} />
        {label}
      </button>
      {open ? <div className="disclosure-body">{children}</div> : null}
    </div>
  )
}
