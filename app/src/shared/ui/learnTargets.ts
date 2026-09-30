import type { LearnTarget } from './learn.tsx'

/**
 * The exercise's 3D scene as a LEARN target: the canvas left of a side
 * instrument panel, lit at full brightness without an outline. `scope` is the
 * exercise root, such as `.week05`.
 */
export function canvasTarget(scope: string): LearnTarget {
  return {
    outline: false,
    select: () => {
      const canvas = document.querySelector(`${scope} .world-canvas-wrap`)?.getBoundingClientRect()
      if (!canvas) {
        return null
      }
      const panel = document
        .querySelector(`${scope} .instrument-panel:not(.is-collapsed)`)
        ?.getBoundingClientRect()
      // Only a side panel narrows the scene; in the stacked layout it sits below the canvas.
      const beside = panel && panel.left > canvas.left + canvas.width / 2
      const right = beside ? Math.min(canvas.right, panel.left - 12) : canvas.right
      return new DOMRect(canvas.left, canvas.top, right - canvas.left, canvas.height)
    },
  }
}
