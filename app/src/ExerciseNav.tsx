import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export type NavItem = { id: string; number: string; name: string }

/**
 * The exercise index: a bounded strip that scrolls sideways when the weeks do not fit, so it never wraps, squeezes or pushes the
 * other header regions. Arrows appear only when there is more to see in that direction; the active exercise is kept in view;
 * trackpads scroll it sideways, and a mouse wheel is turned into sideways scrolling over it.
 */
export function ExerciseNav({ items, active, onSelect }: { items: readonly NavItem[]; active: string; onSelect: (id: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ left: false, right: false })

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setMore({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
  }, [])

  useLayoutEffect(measure, [measure, items])
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && el.scrollWidth > el.clientWidth) {
        el.scrollLeft += event.deltaY
        event.preventDefault()
      }
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      observer.disconnect()
      el.removeEventListener('wheel', wheel)
    }
  }, [measure])

  // Keep the active exercise in view when it changes.
  useEffect(() => {
    const el = scroller.current
    const tab = el?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (el && tab) {
      const pad = 36
      const box = el.getBoundingClientRect()
      const at = tab.getBoundingClientRect()
      if (at.left - pad < box.left) el.scrollBy({ left: at.left - pad - box.left, behavior: 'smooth' })
      else if (at.right + pad > box.right) el.scrollBy({ left: at.right + pad - box.right, behavior: 'smooth' })
    }
  }, [active])

  const page = (direction: -1 | 1) => scroller.current?.scrollBy({ left: direction * scroller.current.clientWidth * 0.6, behavior: 'smooth' })

  return (
    <div className="exercise-nav" data-left={more.left} data-right={more.right}>
      <button type="button" className="nav-arrow" aria-label="Earlier exercises" tabIndex={more.left ? 0 : -1} data-visible={more.left} onClick={() => page(-1)}>
        ‹
      </button>
      <div ref={scroller} className="exercise-index" role="tablist" aria-label="Exercise" onScroll={measure}>
        {items.map((item, index) => (
          <Fragment key={item.id}>
            {index > 0 ? (
              <span className="exercise-index-sep" aria-hidden="true">
                ·
              </span>
            ) : null}
            <button type="button" role="tab" aria-selected={active === item.id} onClick={() => onSelect(item.id)}>
              <span className="exercise-number">{item.number}</span>
              {item.name}
            </button>
          </Fragment>
        ))}
      </div>
      <button type="button" className="nav-arrow" aria-label="Later exercises" tabIndex={more.right ? 0 : -1} data-visible={more.right} onClick={() => page(1)}>
        ›
      </button>
    </div>
  )
}
