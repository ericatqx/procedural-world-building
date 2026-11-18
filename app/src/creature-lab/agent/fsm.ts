/**
 * A small finite state machine: named states, the transitions that are allowed, and a minimum time to stay in each state so that a
 * behaviour does not flicker. If the tree wants a state that is not one step away, the machine goes through the intermediate states
 * (the shortest path), so a creature does not jump from resting to running without ever getting up. An urgent request (a threat)
 * skips the minimum time, never the path.
 */
export type FsmConfig<S extends string> = { initial: S; edges: Record<S, S[]>; dwell: Record<S, number> }

export class Fsm<S extends string> {
  state: S
  time = 0
  clock = 0
  log: { at: number; from: S; to: S; why: string }[] = []
  /** The state being worked toward, if it is not yet reached. */
  heading: S | null = null
  private readonly cfg: FsmConfig<S>
  constructor(cfg: FsmConfig<S>) {
    this.cfg = cfg
    this.state = cfg.initial
  }

  reset() {
    this.state = this.cfg.initial
    this.time = 0
    this.clock = 0
    this.log = []
    this.heading = null
  }

  tick(dt: number) {
    this.time += dt
    this.clock += dt
  }

  /** The first step on the shortest path from here to `target`. */
  private firstStep(target: S): S | null {
    if (target === this.state) return null
    const seen = new Set<S>([this.state])
    const queue: { s: S; first: S }[] = this.cfg.edges[this.state].map((s) => ({ s, first: s }))
    while (queue.length) {
      const { s, first } = queue.shift()!
      if (s === target) return first
      if (seen.has(s)) continue
      seen.add(s)
      for (const n of this.cfg.edges[s]) if (!seen.has(n)) queue.push({ s: n, first })
    }
    return null
  }

  request(target: S, why: string, urgent = false): boolean {
    this.heading = target === this.state ? null : target
    if (target === this.state) return false
    if (!urgent && this.time < this.cfg.dwell[this.state]) return false
    const next = this.firstStep(target)
    if (!next) return false
    this.log.push({ at: this.clock, from: this.state, to: next, why })
    if (this.log.length > 12) this.log.shift()
    this.state = next
    this.time = 0
    return true
  }
}
