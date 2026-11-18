import { MATURITY } from '../architecture-lab/lifecycle.ts'

/**
 * Shadow Ecology 0.3 — which mesh an organism may show while the worker is still making the one for its state (kept apart from
 * the scene so it can be tested without a renderer).
 *
 * Two rules, both about never leaving an organism blank:
 *   1. The mature mesh is the wrong shape only while the organism is still growing toward it. From senescence on, the form still
 *      stands (the first stage's mesh is the mature one with a little receding), so the mature mesh stays until the stage's own mesh
 *      arrives and the two dissolve into each other. Only a young organism drops it.
 *   2. A mesh that arrives for a state the clock has already left is still taken when it is nearer the organism's state now than
 *      what is on screen (or nothing is), instead of being thrown away: at fast playback every reply would otherwise be stale.
 */
export type StageState = { age: number; recede: number; ruin?: number }
export type Tolerance = { age: number; metre: number; ruin: number }

/** Whether the organism has yet to reach the mature form. `L` is its lifecycle position; without a lifecycle, its age (1 is mature). */
export const isYoung = (L: number | null, age: number): boolean => (L === null ? age < 1 : L < MATURITY)

/** How far two states are apart, in units of the tolerance on each axis. */
export function gap(a: StageState, b: StageState, tol: Tolerance): number {
  return Math.abs(a.age - b.age) / tol.age + Math.abs(a.recede - b.recede) / tol.metre + Math.abs((a.ruin ?? 0) - (b.ruin ?? 0)) / tol.ruin
}

export type Front = { kind: 'mature' | 'stage'; state: StageState | null; shown: boolean }

/** Whether a mesh made for `want` is shown now that the organism is at `now`. `matureNow`: the organism is mature, or not present. */
export function acceptsArrival(o: { matureNow: boolean; front: Front; now: StageState; want: StageState; tol: Tolerance; young?: boolean }): boolean {
  if (o.matureNow) return false
  // A young organism is never shown a mesh of an older (larger) age than it has now: a reply for a request made before the clock was turned back is dropped, not drawn.
  if (o.young && o.want.age > o.now.age + 1.5 * o.tol.age) return false
  const toWant = gap(o.now, o.want, o.tol)
  const close = Math.abs(o.now.age - o.want.age) <= o.tol.age && Math.abs(o.now.recede - o.want.recede) <= o.tol.metre && Math.abs((o.now.ruin ?? 0) - (o.want.ruin ?? 0)) <= o.tol.ruin
  if (close || !o.front.shown || o.front.kind === 'mature' || !o.front.state) return true
  return toWant < gap(o.now, o.front.state, o.tol)
}
