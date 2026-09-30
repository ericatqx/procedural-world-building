import { useEffect, useId, useLayoutEffect, useState, type ReactNode } from 'react'
import './learn.css'

/**
 * Guided LEARN mode: a dimmed layer with the step's regions lit and outlined,
 * and a floating card that walks through a fixed sequence of steps. The
 * exercise stays live underneath, so each step points at something and lets
 * the reader see or change it: explain briefly → point → try.
 *
 * Reusable across exercises: each one supplies its own steps, targets and
 * figures. Render inside the exercise's `.ui-system` root so the shared tokens
 * apply; the accent is `--learn-accent` (learn.css).
 */

/** Where a region is: a CSS selector (every match is unioned) or a rect. */
export type LearnSelector = string | (() => DOMRect | null)

/**
 * A region to light. Small UI targets get an accent outline; pass
 * `outline: false` for large areas such as the canvas, which are simply
 * brought to full brightness while the rest stays dimmed.
 */
export type LearnTarget = LearnSelector | { select: LearnSelector; outline?: boolean }

export type LearnStep = {
  title: string
  /** One or two sentences. */
  text: string
  /** Something to do with the live controls or the scene. */
  try?: string
  /** What to look at, or what the result shows. */
  notice?: string
  /** A small diagram shown above the text. */
  figure?: ReactNode
  /** Each entry is lit and outlined as its own region. */
  target?: LearnTarget | readonly LearnTarget[]
  /** Runs when the step opens, e.g. to select the study it is about. */
  enter?: () => void
}

const FOCUS_PADDING = 6

type Rect = { top: number; left: number; width: number; height: number; outline: boolean }

const isSingle = (target: LearnStep['target']): target is LearnTarget =>
  typeof target === 'string' || typeof target === 'function' || (typeof target === 'object' && 'select' in target)

const toList = (target: LearnStep['target']): readonly LearnTarget[] =>
  target === undefined ? [] : isSingle(target) ? [target] : target

const selectorOf = (target: LearnTarget): LearnSelector =>
  typeof target === 'object' ? target.select : target

const scrollParents = new WeakMap<Element, Element | null>()

function scrollParentOf(element: Element): Element | null {
  const cached = scrollParents.get(element)
  if (cached !== undefined) {
    return cached
  }
  let parent = element.parentElement
  while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) {
    parent = parent.parentElement
  }
  scrollParents.set(element, parent)
  return parent
}

/** The part of an element its scrolling panel actually shows. */
function visibleRect(element: Element): DOMRect {
  const rect = element.getBoundingClientRect()
  const parent = scrollParentOf(element)
  if (!parent) {
    return rect
  }
  const clip = parent.getBoundingClientRect()
  const left = Math.max(rect.left, clip.left)
  const top = Math.max(rect.top, clip.top)
  const right = Math.min(rect.right, clip.right)
  const bottom = Math.min(rect.bottom, clip.bottom)
  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top))
}

function measure(target: LearnTarget): Rect | null {
  const select = selectorOf(target)
  const rects =
    typeof select === 'function'
      ? [select()].filter((rect): rect is DOMRect => rect !== null)
      : Array.from(document.querySelectorAll(select), visibleRect)
  const visible = rects.filter((rect) => rect.width > 0 && rect.height > 0)
  if (visible.length === 0) {
    return null
  }
  const top = Math.min(...visible.map((rect) => rect.top)) - FOCUS_PADDING
  const left = Math.min(...visible.map((rect) => rect.left)) - FOCUS_PADDING
  const bottom = Math.max(...visible.map((rect) => rect.bottom)) + FOCUS_PADDING
  const right = Math.max(...visible.map((rect) => rect.right)) + FOCUS_PADDING
  const outline = typeof target === 'object' ? target.outline !== false : true
  return { top, left, width: right - left, height: bottom - top, outline }
}

const sameRects = (a: readonly Rect[], b: readonly Rect[]) =>
  a.length === b.length &&
  a.every((rect, i) => {
    const other = b[i]!
    return (
      rect.outline === other.outline &&
      Math.abs(rect.top - other.top) < 0.5 &&
      Math.abs(rect.left - other.left) < 0.5 &&
      Math.abs(rect.width - other.width) < 0.5 &&
      Math.abs(rect.height - other.height) < 0.5
    )
  })

/**
 * Follows the targets every frame, so scrolling panels, resizes and controls
 * that appear after `enter` keep the regions aligned. The first selector
 * target is scrolled into view once it exists, so list the control to act on
 * first.
 */
function useTargetRects(target: LearnStep['target']): Rect[] {
  const [rects, setRects] = useState<Rect[]>([])

  useEffect(() => {
    const targets = toList(target)
    const scrollTarget = targets.map(selectorOf).find((item): item is string => typeof item === 'string')
    let scrolled = scrollTarget === undefined
    let frame = 0
    const tick = () => {
      if (!scrolled) {
        // Last match first, so the whole group ends up in view when it fits.
        const elements = Array.from(document.querySelectorAll(scrollTarget!)).reverse()
        elements.forEach((element) => element.scrollIntoView({ block: 'nearest' }))
        scrolled = elements.length > 0
      }
      const next = targets.map(measure).filter((rect): rect is Rect => rect !== null)
      setRects((current) => (sameRects(current, next) ? current : next))
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [target])

  return rects
}

/** Heading-row toggle for LEARN mode, styled like the About toggle beside it; the Project calls it Guide. */
export function LearnToggle({
  active,
  onChange,
  label = 'Learn',
}: {
  active: boolean
  onChange: (next: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      className="about-toggle learn-toggle"
      aria-pressed={active}
      onClick={() => onChange(!active)}
    >
      {label}
    </button>
  )
}

/** Caption strip for a step figure; the SVG inside can use the `lf-*` classes. */
export function LearnFigure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="learn-figure" aria-label={label}>
      {children}
    </figure>
  )
}

/** Short connector between two panels of a figure strip (SVG units). */
export function FigureArrow({ x, y, length = 14 }: { x: number; y: number; length?: number }) {
  const tip = x + length
  return (
    <g>
      <line className="lf-faint" x1={x} y1={y} x2={tip} y2={y} />
      <path className="lf-faint" d={`M${tip - 4} ${y - 3} L${tip} ${y} L${tip - 4} ${y + 3}`} />
    </g>
  )
}

/** Two-line caption under a figure panel: accent title, muted note. */
export function FigureCaption({
  x,
  y = 80,
  title,
  note,
}: {
  x: number
  y?: number
  title: string
  note?: string
}) {
  return (
    <>
      <text className="lf-label is-accent" x={x} y={y} textAnchor="middle">
        {title}
      </text>
      {note ? (
        <text className="lf-label" x={x} y={y + 10} textAnchor="middle">
          {note}
        </text>
      ) : null}
    </>
  )
}

type CardSide = 'start' | 'end'

/**
 * The card sits under the heading; when that would cover an outlined target
 * (a control in the left column, say), it moves to the right of the scene.
 */
function useCardSide(card: HTMLElement | null, rects: readonly Rect[], step: LearnStep): CardSide {
  const [side, setSide] = useState<CardSide>('start')

  useLayoutEffect(() => {
    if (!card) {
      return
    }
    const box = card.getBoundingClientRect()
    const edge = parseFloat(getComputedStyle(card).getPropertyValue('--edge')) || 0
    const covers = rects.some(
      (rect) =>
        rect.outline &&
        rect.left < edge + box.width &&
        rect.left + rect.width > edge &&
        rect.top < box.bottom &&
        rect.top + rect.height > box.top,
    )
    setSide(covers ? 'end' : 'start')
    // The step changes the card's height, so it re-measures per step.
  }, [card, rects, step])

  return side
}

/** Dims everything except the lit regions; outlined ones also get the accent frame. */
function FocusLayer({ rects, stepKey }: { rects: readonly Rect[]; stepKey: number }) {
  const maskId = useId()
  return (
    <>
      <svg className="learn-dim" aria-hidden="true">
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            {rects.map((rect, i) => (
              <rect key={i} x={rect.left} y={rect.top} width={rect.width} height={rect.height} fill="black" />
            ))}
          </mask>
        </defs>
        <rect width="100%" height="100%" mask={`url(#${maskId})`} />
      </svg>
      {rects.map((rect, i) =>
        rect.outline ? (
          <div
            key={`${stepKey}-${i}`}
            className="learn-focus"
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
            aria-hidden="true"
          />
        ) : null,
      )}
    </>
  )
}

/**
 * The tour itself. Mount it while LEARN mode is on; it starts at step one.
 * ← / → step through, Escape exits. Keys typed into form fields are ignored.
 */
export function LearnTour({
  steps,
  label = 'Learn',
  onExit,
}: {
  steps: readonly LearnStep[]
  label?: string
  onExit: () => void
}) {
  const [index, setIndex] = useState(0)
  const [card, setCard] = useState<HTMLElement | null>(null)
  const step = steps[index]!
  const rects = useTargetRects(step.target)
  const side = useCardSide(card, rects, step)
  const isLast = index === steps.length - 1

  useEffect(() => {
    step.enter?.()
  }, [step])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (event.key === 'Escape') {
        onExit()
      } else if (event.key === 'ArrowRight') {
        setIndex((current) => Math.min(current + 1, steps.length - 1))
      } else if (event.key === 'ArrowLeft') {
        setIndex((current) => Math.max(current - 1, 0))
      } else {
        return
      }
      // Captured first, so exercises that also use these keys (Week 03 pans with arrows) don't react.
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [steps.length, onExit])

  return (
    <div className="learn-layer">
      <FocusLayer rects={rects} stepKey={index} />

      <section
        ref={setCard}
        className={side === 'end' ? 'learn-card is-end' : 'learn-card'}
        role="dialog"
        aria-label={`${label}: ${step.title}`}
      >
        <header className="learn-card-head">
          <span className="learn-card-kicker">{label}</span>
          <span className="learn-card-count">
            {String(index + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}
          </span>
        </header>
        <div className="learn-card-progress" aria-hidden="true">
          {steps.map((item, i) => (
            <span key={item.title} className={i <= index ? 'is-done' : undefined} />
          ))}
        </div>
        <div className="learn-card-body">
          <h2 className="learn-card-title">{step.title}</h2>
          {step.figure}
          <p className="learn-card-text">{step.text}</p>
          {step.try ? (
            <p className="learn-cue">
              <span className="learn-cue-label">Try</span>
              {step.try}
            </p>
          ) : null}
          {step.notice ? (
            <p className="learn-cue">
              <span className="learn-cue-label">Notice</span>
              {step.notice}
            </p>
          ) : null}
        </div>
        <footer className="learn-card-actions">
          <button type="button" className="text-button" onClick={onExit}>
            Exit
          </button>
          <span className="learn-card-nav">
            <button
              type="button"
              className="learn-button"
              disabled={index === 0}
              onClick={() => setIndex((current) => Math.max(current - 1, 0))}
            >
              Back
            </button>
            <button
              type="button"
              className="learn-button is-primary"
              onClick={() => (isLast ? onExit() : setIndex((current) => current + 1))}
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </span>
        </footer>
      </section>
    </div>
  )
}
