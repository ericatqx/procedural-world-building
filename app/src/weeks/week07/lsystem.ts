/**
 * Week 07 — a stochastic, context-free L-system, rewritten recursively.
 *
 *   F        grow one internode forward (drawn)
 *   X        an apex: a growing tip that the rules rewrite (not drawn; left as a bud)
 *   + -      yaw   about the turtle's up axis, by the branch angle
 *   & ^      pitch about its left axis, by the branch angle
 *   / \      roll  about its heading, by the golden angle (so forks spiral in 3D)
 *   [ ]      push / pop the turtle: a branch
 *
 * X and F have rules. Each rule has two weights: one at Randomness 0 (X
 * always splits in two and F never changes: a strict fractal) and one at
 * Randomness 1 (X becomes a split, alternating fork, creeping runner or
 * dormant bud, and old internodes may elongate, F → FF, so older growth
 * stretches and carries the organism further). Randomness blends between
 * them, so the same grammar runs from regular coral to irregular ivy.
 */

export type GrammarRule = {
  name: string
  successor: string
  /** Weight at Randomness 0 and at Randomness 1. */
  weight: readonly [number, number]
}

export type Grammar = {
  axiom: string
  rules: Readonly<Record<string, readonly GrammarRule[]>>
}

/** Three runners leave the seed, pitched three branch angles off vertical, rolled apart. */
export const TRACE_GRAMMAR: Grammar = {
  axiom: '[&&&X]/[&&&X]/[&&&X]',
  rules: {
    X: [
      { name: 'split', successor: 'F/[+X][-X]', weight: [1, 0.36] },
      { name: 'fork', successor: 'F[&X]/F[&X]/X', weight: [0, 0.34] },
      { name: 'runner', successor: 'FX', weight: [0, 0.2] },
      { name: 'dormant', successor: 'X', weight: [0, 0.1] },
    ],
    F: [
      { name: 'hold', successor: 'F', weight: [1, 0.6] },
      { name: 'elongate', successor: 'FF', weight: [0, 0.4] },
    ],
  },
}

/** Past this many symbols, apexes stop rewriting, so high iterations cannot run away. */
export const MAX_SYMBOLS = 90_000

/** Deterministic 0…1 sequence, so a seed always gives the same organism. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function chooseRule(rules: readonly GrammarRule[], randomness: number, rng: () => number): GrammarRule {
  const weights = rules.map((rule) => rule.weight[0] + (rule.weight[1] - rule.weight[0]) * randomness)
  const total = weights.reduce((sum, w) => sum + w, 0)
  let roll = rng() * total
  for (let i = 0; i < rules.length; i++) {
    roll -= weights[i]!
    if (roll <= 0 && weights[i]! > 0) {
      return rules[i]!
    }
  }
  return rules[0]!
}

export type Derivation = {
  /** The final word, read by the turtle. */
  word: string
  /** How many times each rule fired, by name. */
  fired: Record<string, number>
  /** True when MAX_SYMBOLS stopped the rewriting early. */
  capped: boolean
}

/**
 * Rewrites the axiom `iterations` times. Each symbol is expanded on its own,
 * depth first: `expand(X, n)` replaces X by a successor and expands every
 * symbol of that successor with n − 1. For a context-free grammar this gives
 * the same word as rewriting the whole string in parallel n times.
 */
export function derive(grammar: Grammar, iterations: number, randomness: number, seed: number): Derivation {
  const rng = mulberry32(seed * 7919 + 17)
  const fired: Record<string, number> = {}
  const out: string[] = []
  let length = 0
  let capped = false

  const expand = (symbol: string, depth: number) => {
    const rules = grammar.rules[symbol]
    if (depth === 0 || !rules) {
      out.push(symbol)
      length += 1
      return
    }
    if (length > MAX_SYMBOLS) {
      capped = true
      out.push(symbol)
      length += 1
      return
    }
    const rule = chooseRule(rules, randomness, rng)
    fired[rule.name] = (fired[rule.name] ?? 0) + 1
    for (const next of rule.successor) {
      expand(next, depth - 1)
    }
  }

  for (const symbol of grammar.axiom) {
    expand(symbol, iterations)
  }
  return { word: out.join(''), fired, capped }
}

/** The grammar as text for How it works, one rule per line with its current weight. */
export function grammarText(grammar: Grammar, randomness: number): string {
  const lines = [`ω  ${grammar.axiom}`]
  for (const [symbol, rules] of Object.entries(grammar.rules)) {
    const weights = rules.map((rule) => rule.weight[0] + (rule.weight[1] - rule.weight[0]) * randomness)
    const total = weights.reduce((sum, w) => sum + w, 0)
    rules.forEach((rule, i) => {
      const p = weights[i]! / total
      if (p > 0.001) {
        lines.push(`${symbol} →${p.toFixed(2)}  ${rule.successor.padEnd(14)} ${rule.name}`)
      }
    })
  }
  return lines.join('\n')
}
