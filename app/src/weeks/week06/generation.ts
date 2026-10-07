import { useEffect, useLayoutEffect, useRef } from 'react'
import type { SegmentOption } from '../../shared/ui/instrument.tsx'

/**
 * Progressive generation shared by the Week 06 studies: a finished,
 * deterministic run is replayed step by step, so stopping early shows the
 * same run cut short and running to the end always gives the same result.
 */

/** How often a running generation updates the scene, seconds. */
const GENERATION_COMMIT = 1 / 12
const MAX_FRAME_SECONDS = 0.1
/** A generation run through to the end. */
export const COMPLETE = Infinity

export type GenerationMode = 'instant' | 'progressive'
export const GENERATION_OPTIONS: SegmentOption<GenerationMode>[] = [
  { value: 'instant', label: 'Instant' },
  { value: 'progressive', label: 'Progressive' },
]

/**
 * While `playing`, calls `onAdvance` with whole steps to take, `rate` per
 * second, batched to a few updates a second so the scene is not rebuilt
 * every frame.
 */
export function useGenerationClock(playing: boolean, rate: number, onAdvance: (steps: number) => void) {
  const advanceRef = useRef(onAdvance)
  useLayoutEffect(() => {
    advanceRef.current = onAdvance
  })
  useEffect(() => {
    if (!playing) {
      return
    }
    let last = performance.now()
    let pending = 0
    let sinceCommit = 0
    let frame = requestAnimationFrame(function tick(now) {
      const seconds = Math.min((now - last) / 1000, MAX_FRAME_SECONDS)
      last = now
      pending += seconds * rate
      sinceCommit += seconds
      if (sinceCommit >= GENERATION_COMMIT && pending >= 1) {
        const steps = Math.floor(pending)
        pending -= steps
        sinceCommit = 0
        advanceRef.current(steps)
      }
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, rate])
}
