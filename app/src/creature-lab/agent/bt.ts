/**
 * A minimal behaviour tree. A selector tries its children in order and takes the first that succeeds, so the order is the priority;
 * a sequence needs every child to succeed. Conditions test the context; actions set what the agent wants. Each tick records the
 * path it took, which the lab shows as the reason for the decision.
 */
export type Status = 'success' | 'failure'
export type BtNode<C> = { name: string; tick: (ctx: C, trace: string[]) => Status }

export const sel = <C>(name: string, ...kids: BtNode<C>[]): BtNode<C> => ({
  name,
  tick(ctx, trace) {
    trace.push(name)
    for (const k of kids) if (k.tick(ctx, trace) === 'success') return 'success'
    return 'failure'
  },
})

export const seq = <C>(name: string, ...kids: BtNode<C>[]): BtNode<C> => ({
  name,
  tick(ctx, trace) {
    for (const k of kids) if (k.tick(ctx, trace) === 'failure') return 'failure'
    trace.push(name)
    return 'success'
  },
})

export const cond = <C>(name: string, test: (ctx: C) => boolean): BtNode<C> => ({
  name,
  tick(ctx, trace) {
    const ok = test(ctx)
    if (ok) trace.push(name)
    return ok ? 'success' : 'failure'
  },
})

export const act = <C>(name: string, run: (ctx: C) => void): BtNode<C> => ({
  name,
  tick(ctx, trace) {
    trace.push(`→ ${name}`)
    run(ctx)
    return 'success'
  },
})
