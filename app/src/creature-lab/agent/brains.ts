import type { SpeciesId } from '../types.ts'
import { act, cond, sel, seq, type BtNode } from './bt.ts'
import { Fsm, type FsmConfig } from './fsm.ts'
import type { Goal } from './space.ts'
import type { Brain, BrainDebug, Env, Intent } from './types.ts'

/**
 * The agents. Each species has the same three layers:
 *   needs           slow internal quantities (hunger, fatigue, energy, curiosity) that rise and fall with what it is doing
 *   behaviour tree  reads the environment and the needs, in a fixed priority order, and says which behaviour it wants and why
 *   state machine   holds the current behaviour, enforces how long it lasts and which behaviours can follow which, and routes
 *                   through the intermediate ones; the body then plays that state's animation
 * Priorities are the ecology: a Dweller's first concern is a threat, then rest and cover, then exploring; a Crawler's is to roll up,
 * then to stay out of the light, then to eat. Nothing is random: the same environment and the same needs always give the same decision.
 * What a creature "senses" is the environment passed in; `perceive` is where a sensing range or noise would go.
 */

type Needs = Record<string, number>
type Ctx<S extends string> = { env: Env; needs: Needs; state: S; want: S; why: string; urgent: boolean; pace?: number; goal?: Goal }
type Spec<S extends string> = {
  fsm: FsmConfig<S>
  needs: Needs
  /** How the needs change in `dt` seconds in the current state. `acc` holds running totals worth showing. */
  step: (dt: number, state: S, env: Env, needs: Needs, acc: Needs) => void
  tree: BtNode<Ctx<S>>
  /** What the body does in each state. */
  intent: (state: S, env: Env) => Omit<Intent, 'behaviour' | 'goal'> & { goal: Goal }
  extra?: (acc: Needs) => string[]
}

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const go = <S extends string>(name: string, state: NoInfer<S>, why: string, o: { urgent?: boolean; pace?: number; goal?: Goal } = {}) =>
  act<Ctx<S>>(name, (c) => {
    c.want = state
    c.why = why
    c.urgent = o.urgent ?? false
    c.pace = o.pace
    c.goal = o.goal
  })

/** The environment as the creature takes it in: a stand-in for a sensing range. */
const perceive = (env: Env): Env => ({ ...env })

function makeBrain<S extends string>(spec: Spec<S>): Brain {
  const fsm = new Fsm<S>(spec.fsm)
  let needs: Needs = { ...spec.needs }
  let acc: Needs = {}
  const trend: Needs = {}
  return {
    reset() {
      fsm.reset()
      needs = { ...spec.needs }
      acc = {}
    },
    update(dt, rawEnv) {
      const env = perceive(rawEnv)
      fsm.tick(dt)
      const before = { ...needs }
      spec.step(dt, fsm.state, env, needs, acc)
      // FEEDBACK: which needs this state is changing, and which way (the outcome of what it is doing).
      for (const k of Object.keys(needs)) trend[k] = (trend[k] ?? 0) * 0.9 + ((needs[k]! - (before[k] ?? 0)) / Math.max(dt, 1e-3)) * 0.1
      const ctx: Ctx<S> = { env, needs, state: fsm.state, want: fsm.state, why: 'nothing pressing', urgent: false }
      const trace: string[] = []
      spec.tree.tick(ctx, trace)
      fsm.request(ctx.want, ctx.why, ctx.urgent)
      const base = spec.intent(fsm.state, env)
      const there = fsm.state === ctx.want
      const intent: Intent = { behaviour: fsm.state, ...base, pace: there && ctx.pace !== undefined ? ctx.pace : base.pace, goal: there && ctx.goal ? ctx.goal : base.goal }
      const debug: BrainDebug = {
        state: fsm.state,
        time: fsm.time,
        why: ctx.why,
        goal: intent.goal,
        heading: there ? undefined : ctx.want,
        trace: trace.slice(-5),
        needs: Object.entries(needs),
        recent: fsm.log.slice(-4).reverse().map((l) => `${l.at.toFixed(0)}s  ${l.from} → ${l.to}  (${l.why})`),
        extra: spec.extra ? spec.extra(acc) : [],
        effect: Object.entries(trend).filter(([, v]) => Math.abs(v) > 0.004).map(([k, v]) => `${k} ${v > 0 ? 'rising' : 'falling'}`),
        edges: spec.fsm.edges as Record<string, string[]>,
        senses: env,
      }
      return { intent, debug }
    },
  }
}

// ------------------------------------------------------------------------------------------------ Hollow Dweller
type D = 'rest' | 'alert' | 'explore' | 'forage' | 'shelter' | 'retreat'
const dweller = () =>
  makeBrain<D>({
    fsm: {
      initial: 'alert',
      edges: { rest: ['alert'], alert: ['rest', 'explore', 'shelter', 'retreat'], explore: ['alert', 'forage', 'shelter', 'retreat'], forage: ['explore', 'alert', 'shelter', 'retreat'], shelter: ['alert', 'explore', 'retreat', 'rest'], retreat: ['shelter', 'alert', 'rest'] },
      dwell: { rest: 6, alert: 2.5, explore: 4, forage: 5, shelter: 3, retreat: 3 },
    },
    needs: { hunger: 0.55, fatigue: 0.2, curiosity: 0.6, alertness: 0.1 },
    step(dt, state, env, n, acc) {
      const move = state === 'explore' ? 0.018 : state === 'shelter' ? 0.03 : state === 'retreat' ? 0.07 : 0.004
      n.fatigue = clamp(n.fatigue! + move * dt - (state === 'rest' && env.shelter > 0.5 ? 0.05 * dt : 0))
      n.curiosity = clamp(n.curiosity! + (state === 'rest' || state === 'alert' ? 0.04 : -0.035) * dt)
      n.alertness = n.alertness! + (Math.max(env.threat, state === 'alert' ? 0.4 : 0.1) - n.alertness!) * Math.min(1, dt * 1.5)
      // Hunger rises all the time and falls only while it eats where there is food (fungi and seed on the forest floor).
      const eat = state === 'forage' ? 0.08 * env.food : 0
      n.hunger = clamp(n.hunger! + 0.01 * dt - eat * dt)
      acc.eaten = (acc.eaten ?? 0) + eat * dt
    },
    tree: sel<Ctx<D>>(
      'dweller',
      seq('threat close', cond('threat close', (c) => c.env.threat > 0.6), sel('react', seq('cover near', cond('in cover', (c) => c.env.shelter > 0.9), go('hide', 'rest', 'threat, and cover is close: hide', { urgent: true })), go('retreat', 'retreat', 'threat, no cover close: run for it', { urgent: true, goal: 'shelter' }))),
      seq('threat near', cond('threat near', (c) => c.env.threat > 0.25), go('alert', 'alert', 'something is near: freeze and listen', { urgent: true })),
      seq('worn out', cond('worn out', (c) => c.needs.fatigue! > 0.7), sel('tired', seq('cover', cond('in cover', (c) => c.env.shelter > 0.9), go('rest', 'rest', 'tired, in cover: rest')), go('shelter', 'shelter', 'tired: go to cover', { pace: 1, goal: 'shelter' }))),
      seq('too bright', cond('exposed', (c) => c.env.light > 0.75), sel('shade', seq('cover', cond('in cover', (c) => c.env.shelter > 0.9), go('rest', 'rest', 'bright: rest in cover')), go('shelter', 'shelter', 'bright: look for cover', { pace: 1.15, goal: 'shelter' }))),
      // Feeding: at dusk and night, or by day only when very hungry. It must reach food before it can eat.
      seq('hungry', cond('hungry', (c) => c.needs.hunger! > (c.state === 'forage' ? 0.15 : 0.5)), cond('its hours, or starving', (c) => c.env.daylight <= 0.45 || c.needs.hunger! > 0.85),
        sel('feed', seq('food here', cond('food here', (c) => c.env.food > 0.3), go('forage', 'forage', 'hungry, fungi and seed underfoot: eat')), go('search', 'explore', 'hungry: go out to the damp floor where food lies', { pace: 0.9, goal: 'food' }))),
      seq('by day', cond('day', (c) => c.env.daylight > 0.45), cond('not restless', (c) => c.needs.curiosity! < 0.9), sel('lie up', seq('cover', cond('in cover', (c) => c.env.shelter > 0.9), go('lie up', 'rest', 'daytime: it lies up in cover until dusk')), go('to cover', 'shelter', 'daytime: back to cover to lie up', { pace: 1, goal: 'shelter' }))),
      seq('curious', cond('rested', (c) => c.needs.fatigue! < 0.3), cond('curious', (c) => c.needs.curiosity! > 0.45), go('explore', 'explore', 'dusk or night, rested and curious: go out')),
      seq('rest a while', cond('somewhat tired', (c) => c.needs.fatigue! > 0.3), cond('in cover', (c) => c.env.shelter > 0.9), go('rest', 'rest', 'somewhat tired: rest in cover')),
      seq('tired out here', cond('somewhat tired', (c) => c.needs.fatigue! > 0.3), go('shelter', 'shelter', 'somewhat tired, no cover here: go to cover', { pace: 1, goal: 'shelter' })),
      go('watch', 'alert', 'nothing to do: watch'),
    ),
    intent: (s) => (s === 'rest' ? { motion: 'crouch', pace: 1, bank: 30, goal: 'stay' } : s === 'alert' || s === 'forage' ? { motion: 'idle', pace: 1, bank: 30, goal: 'stay' } : s === 'explore' ? { motion: 'walk', pace: 0.8, bank: 30, goal: 'wander' } : s === 'shelter' ? { motion: 'walk', pace: 1.15, bank: 30, goal: 'shelter' } : { motion: 'run', pace: 1, bank: 30, goal: 'shelter' }),
    extra: (acc) => [`eaten  ${(acc.eaten ?? 0).toFixed(2)}`],
  })

// ------------------------------------------------------------------------------------------------ Strider
type S = 'stand' | 'wade' | 'swim' | 'forage'
const strider = () =>
  makeBrain<S>({
    fsm: {
      initial: 'stand',
      edges: { stand: ['wade', 'forage'], wade: ['stand', 'swim', 'forage'], swim: ['wade'], forage: ['wade', 'stand'] },
      dwell: { stand: 3, wade: 4, swim: 4, forage: 5 },
    },
    needs: { hunger: 0.55, fatigue: 0.1 },
    step(dt, state, env, n) {
      n.hunger = clamp(n.hunger! + 0.012 * dt - (state === 'forage' ? 0.06 * env.food * dt : 0))
      n.fatigue = clamp(n.fatigue! + (state === 'swim' ? 0.014 : state === 'wade' ? 0.01 : state === 'forage' ? 0.004 : -0.05) * dt)
    },
    tree: sel<Ctx<S>>(
      'strider',
      seq('threat', cond('threat', (c) => c.env.threat > 0.5), sel('flee', seq('deep', cond('deep water', (c) => c.env.water > 0.55), go('swim away', 'swim', 'threat: swim away', { urgent: true, pace: 1.4, goal: 'deep' })), go('to the water', 'wade', 'threat: make for deeper water', { urgent: true, pace: 1.4, goal: 'deep' }))),
      seq('night', cond('night', (c) => c.env.daylight <= 0.15), sel('stand', seq('deep', cond('deep water', (c) => c.env.water >= 0.6), go('to the shallows', 'swim', 'night: back to the shallows to stand', { pace: 0.6, goal: 'food' })), go('stand', 'stand', 'night: it stands still in its shallow until day'))),
      seq('hungry', cond('hungry', (c) => c.needs.hunger! > (c.state === 'forage' ? 0.2 : 0.55)), sel('feed', seq('food here', cond('in the shallows', (c) => c.env.water > 0.08 && c.env.water < 0.6), cond('food here', (c) => c.env.food > 0.3), go('forage', 'forage', 'hungry, food in the shallows: forage')), seq('too deep', cond('too deep', (c) => c.env.water >= 0.6), go('to the shallows', 'swim', 'hungry: swim to the shallows', { pace: 0.8, goal: 'food' })), go('to the food', 'wade', 'hungry: go to where the food is', { pace: 0.8, goal: 'food' }))),
      seq('worn out', cond('worn out', (c) => c.needs.fatigue! > 0.7), sel('rest', seq('deep', cond('deep water', (c) => c.env.water > 0.6), go('float', 'swim', 'tired: float', { pace: 0.35 })), go('rest', 'stand', 'tired: stand and rest'))),
      sel('roam', seq('deep', cond('deep water', (c) => c.env.water >= 0.6), go('swim', 'swim', 'roam: swim', { pace: 0.7 })), go('wade', 'wade', 'roam: wade', { pace: 0.6 })),
    ),
    intent: (s, env) => (s === 'stand' ? { motion: 'stand', pace: 1, bank: 30, water: env.water, goal: 'stay' } : s === 'wade' ? { motion: 'wade', pace: 0.9, bank: 30, water: env.water, goal: 'wander' } : s === 'swim' ? { motion: 'swim', pace: 0.9, bank: 30, water: env.water, goal: 'wander' } : { motion: 'forage', pace: 1, bank: 30, water: env.water, goal: 'stay' }),
  })

// ------------------------------------------------------------------------------------------------ Litter Crawler
type C = 'rest' | 'forage' | 'shuffle' | 'curl'
const crawler = () =>
  makeBrain<C>({
    fsm: {
      initial: 'rest',
      edges: { rest: ['forage', 'shuffle', 'curl'], forage: ['rest', 'shuffle', 'curl'], shuffle: ['rest', 'forage', 'curl'], curl: ['rest'] },
      dwell: { rest: 4, forage: 6, shuffle: 4, curl: 3 },
    },
    needs: { hunger: 0.5, dryness: 0.1 },
    step(dt, state, env, n, acc) {
      n.hunger = clamp(n.hunger! + 0.011 * dt - (state === 'forage' ? 0.06 * env.food * dt : 0))
      n.dryness = clamp(n.dryness! + (env.light > 0.7 ? 0.03 : -0.02) * dt)
      if (state === 'forage') acc.processed = (acc.processed ?? 0) + env.food * 0.9 * dt
    },
    tree: sel<Ctx<C>>(
      'crawler',
      seq('threat', cond('threat', (c) => c.env.threat > (c.state === 'curl' ? 0.2 : 0.45)), go('roll up', 'curl', 'threat: roll up, and stay rolled', { urgent: true })),
      seq('drying', cond('drying out', (c) => c.env.light > 0.7 || (c.needs.dryness! > 0.6 && c.env.light > 0.4)), go('seek shade', 'shuffle', 'too much light: shuffle for shade', { pace: 0.7, goal: 'shade' })),
      seq('hungry', cond('hungry', (c) => c.needs.hunger! > (c.state === 'forage' ? 0.15 : 0.35)), sel('feed', seq('litter', cond('litter here', (c) => c.env.food > 0.3), go('forage', 'forage', 'hungry, litter here: root and eat')), go('search', 'shuffle', 'hungry, no litter: search', { pace: 0.5, goal: 'food' }))),
      go('rest', 'rest', 'fed, in shade: rest'),
    ),
    intent: (s) => (s === 'rest' ? { motion: 'idle', pace: 1, bank: 30, feed: 0, goal: 'stay' } : s === 'forage' ? { motion: 'idle', pace: 1, bank: 30, feed: 1, goal: 'stay' } : s === 'shuffle' ? { motion: 'scuttle', pace: 0.6, bank: 30, feed: 0, goal: 'wander' } : { motion: 'curl', pace: 1, bank: 30, feed: 0, goal: 'stay' }),
    extra: (acc) => [`litter broken down  ${(acc.processed ?? 0).toFixed(1)}`],
  })

// ------------------------------------------------------------------------------------------------ Veil Glider
type G = 'perch' | 'glide' | 'hawk' | 'seek'
const glider = () =>
  makeBrain<G>({
    fsm: {
      initial: 'perch',
      edges: { perch: ['glide'], glide: ['perch', 'seek', 'hawk'], hawk: ['glide', 'perch', 'seek'], seek: ['glide', 'perch'] },
      dwell: { perch: 6, glide: 5, hawk: 5, seek: 5 },
    },
    needs: { energy: 0.7, hunger: 0.4 },
    step(dt, state, env, n, acc) {
      const drain = state === 'perch' ? -0.05 : state === 'seek' ? 0.04 : state === 'hawk' ? 0.03 : Math.max(0.008, 0.03 - 0.025 * env.wind)
      n.energy = clamp(n.energy! - drain * dt)
      // It feeds on the wing: insects that rise over the canopy, caught only while it hawks where there are some.
      const catchRate = state === 'hawk' ? 0.09 * env.food : 0
      n.hunger = clamp(n.hunger! + 0.012 * dt - catchRate * dt)
      acc.caught = (acc.caught ?? 0) + catchRate * dt
    },
    tree: sel<Ctx<G>>(
      'glider',
      seq('threat', cond('threat', (c) => c.env.threat > 0.6), go('flee', 'glide', 'threat: take off', { urgent: true })),
      seq('night', cond('night', (c) => c.env.daylight < 0.12), sel('roost', seq('perch near', cond('perch near', (c) => c.env.perch > 0.3), go('roost', 'perch', 'night: it roosts until morning')), go('to roost', 'seek', 'night: it looks for a roost'))),
      seq('spent', cond('spent', (c) => c.needs.energy! < 0.3), sel('land', seq('perch near', cond('perch near', (c) => c.env.perch > 0.4), go('land', 'perch', 'spent, a perch is near: land')), go('look', 'seek', 'spent, no perch near: circle and look'))),
      seq('resting', cond('perched', (c) => c.state === 'perch'), cond('not rested', (c) => c.needs.energy! < 0.85), go('rest', 'perch', 'rest on the perch')),
      seq('hungry', cond('hungry', (c) => c.needs.hunger! > (c.state === 'hawk' ? 0.15 : 0.45)), sel('feed', seq('insects', cond('insects over the canopy', (c) => c.env.food > 0.3), go('hawk', 'hawk', 'hungry, insects rising over the canopy: hawk them in tight turns')), go('search', 'glide', 'hungry, no insects here: glide on along the edge'))),
      seq('lost', cond('no perch', (c) => c.env.perch < 0.3), cond('flagging', (c) => c.needs.energy! < 0.6), go('look', 'seek', 'flagging, no perch: circle and look')),
      seq('lift', cond('wind', (c) => c.env.wind > 0.25), go('soar', 'glide', 'wind: soar')),
      sel('still air', seq('perch near', cond('perch near', (c) => c.env.perch > 0.3), go('perch', 'perch', 'still air: wait on a perch')), go('glide', 'glide', 'nowhere to wait: keep gliding')),
    ),
    intent: (s) => (s === 'perch' ? { motion: 'perch', pace: 1, bank: 30, goal: 'stay' } : s === 'glide' ? { motion: 'glide', pace: 1, bank: 30, goal: 'stay' } : s === 'hawk' ? { motion: 'bank', pace: 1, bank: 45, goal: 'food' } : { motion: 'bank', pace: 1, bank: 30, goal: 'stay' }),
    extra: (acc) => [`insects caught  ${(acc.caught ?? 0).toFixed(2)}`],
  })

const BRAINS: Record<SpeciesId, () => Brain> = { dweller, glider, strider, crawler }

/** A fresh brain for a species. */
export const brainFor = (species: SpeciesId): Brain => BRAINS[species]()
