import {
  BASE_REGIME,
  cloneWorld,
  damWater,
  measure,
  originWorld,
  rubbleAtWater,
  runStage,
  type Metrics,
  type Regime,
  type World,
} from './historyWorld.ts'

/**
 * Week 07 Branching Histories — one established ecology, rewritten by
 * events. Every history starts from the same origin world and runs the same
 * ecological rules (historyWorld.ts); a branch only changes the conditions
 * those rules act on. Stage 1 is the one free divergence, the rate at which
 * the structure fails. Later events are gated: each exists only where the
 * world its parent left makes it possible, so the tree is the possibility
 * space of the rules rather than a set of written stories.
 *
 *   Stage 1  Structure   how fast the architecture fails
 *   Stage 2  Water       whether fallen material changes the water
 *   Stage 3  Outcome     the ecology the changed environment settles into:
 *                        which one is possible follows from the shade,
 *                        water and rubble the parent left
 */

export type Stage = 0 | 1 | 2 | 3

export type HistoryRule = {
  id: string
  stage: 1 | 2 | 3
  label: string
  /** The condition, as written in the rule list. */
  condition: string
  when: (parent: HistoryNode, origin: HistoryNode) => boolean
  /** Changes to the regime the rules run under from this event on. */
  regime: Partial<Regime>
  /** A one-off change to the world before the stage runs. */
  event?: (w: World) => void
  /** What the event does, one line. */
  effect: string
}

export type HistoryNode = {
  id: string
  stage: Stage
  rule: HistoryRule | null
  parent: HistoryNode | null
  children: HistoryNode[]
  world: World
  metrics: Metrics
  regime: Regime
}

export const STAGE_LABELS: Record<Stage, string> = {
  0: 'Origin',
  1: 'Structure',
  2: 'Water',
  3: 'Outcome',
}

/** Seasons each stage runs for. */
const STAGE_STEPS: Record<1 | 2 | 3, number> = { 1: 10, 2: 8, 3: 8 }

const always = () => true
const pct = (share: number) => `${Math.round(share * 100)}%`

/** Rubble cells at the water it takes to hold it back. */
const DAM_RUBBLE = 8
/** Rubble cells enough to shelter separate pockets away from the ruin. */
const REFUGE_RUBBLE = 40
/** Share of the origin's shade at which the structure still holds the ecology together, and below which it no longer shelters anything. */
const SHADE_HELD = 0.9
const SHADE_LOST = 0.4

const shadeShare = (node: HistoryNode, origin: HistoryNode) => node.metrics.shade / Math.max(1, origin.metrics.shade)
const waterChanged = (node: HistoryNode, origin: HistoryNode) => node.metrics.water > origin.metrics.water

export const HISTORY_RULES: readonly HistoryRule[] = [
  {
    id: 'stable',
    stage: 1,
    label: 'Continued stability',
    condition: 'always · control',
    when: always,
    regime: { decay: 0 },
    effect: 'The structure stands. Nothing is disturbed; the rules keep running on an unchanged environment.',
  },
  {
    id: 'decay',
    stage: 1,
    label: 'Slow decay',
    condition: 'always',
    when: always,
    regime: { decay: 3, scatter: 0.35 },
    effect: 'A few exposed or unsupported voxels fail every season, from now on. Fallen material lands close by.',
  },
  {
    id: 'collapse',
    stage: 1,
    label: 'Sudden collapse',
    condition: 'always',
    when: always,
    regime: { decay: 0, burst: 150, scatter: 0.8 },
    effect: 'The same failure rule at once: half the structure goes in one season, and everything it held up follows. Rubble is thrown wide.',
  },
  {
    id: 'course',
    stage: 2,
    label: 'Water keeps its course',
    condition: 'always',
    when: always,
    regime: {},
    effect: 'The lake stays where it was; the rules keep running.',
  },
  {
    id: 'dam',
    stage: 2,
    label: 'Rubble dams the water',
    condition: `rubble in or beside water ≥ ${DAM_RUBBLE} cells`,
    when: (parent) => rubbleAtWater(parent.world) >= DAM_RUBBLE,
    regime: {},
    event: damWater,
    effect: 'Enough fallen material reaches the shore to hold the water back: the level rises and floods the low ground around the rubble, drowning what grew there.',
  },
  {
    id: 'ecology',
    stage: 3,
    label: 'Stable ecology',
    condition: `shade ≥ ${pct(SHADE_HELD)} of the origin’s · water unchanged`,
    when: (parent, origin) => shadeShare(parent, origin) >= SHADE_HELD && !waterChanged(parent, origin),
    regime: {},
    effect: 'The structure still shades the shore: shelter, water and habitat keep their places, and creatures keep their homes and routes.',
  },
  {
    id: 'corridor',
    stage: 3,
    label: 'Persistent corridor',
    condition: `shade ${pct(SHADE_LOST)}–${pct(SHADE_HELD)} of the origin’s · creatures ≥ 2 · worn path cells ≥ 6`,
    when: (parent, origin) =>
      shadeShare(parent, origin) >= SHADE_LOST &&
      shadeShare(parent, origin) < SHADE_HELD &&
      !waterChanged(parent, origin) &&
      parent.metrics.creatures >= 2 &&
      parent.metrics.paths >= 6,
    regime: { decay: 0, fidelity: 1, followWear: 1, trample: 2.5 },
    effect: 'The ruin settles. Creatures crowd into the shade it still casts and all walk the one worn route to water; trampling keeps it bare, and bare ground is easier walking, so the route deepens.',
  },
  {
    id: 'refuge',
    stage: 3,
    label: 'Fragmented refuge',
    condition: `shade ${pct(SHADE_LOST)}–${pct(SHADE_HELD)} of the origin’s · creatures ≥ 2 · rubble ≥ ${REFUGE_RUBBLE} cells`,
    when: (parent, origin) =>
      shadeShare(parent, origin) >= SHADE_LOST &&
      shadeShare(parent, origin) < SHADE_HELD &&
      !waterChanged(parent, origin) &&
      parent.metrics.creatures >= 2 &&
      parent.metrics.rubble >= REFUGE_RUBBLE,
    regime: { fidelity: 0, followWear: 0, disperse: true },
    effect: 'Decay continues. The ruin’s shade shrinks, but every rubble heap keeps damp, sheltered ground beside it: habitat breaks into separate pockets, creatures spread out between them, and the old shared route fades.',
  },
  {
    id: 'reclaimed',
    stage: 3,
    label: 'Reclaimed ground',
    condition: `shade < ${pct(SHADE_LOST)} of the origin’s · water unchanged`,
    when: (parent, origin) => shadeShare(parent, origin) < SHADE_LOST && !waterChanged(parent, origin),
    regime: { present: false },
    effect: 'The shade the colony formed around is gone: creatures leave across the plate. Nothing walks the paths any more, and vegetation grows back over them and over the rubble.',
  },
  {
    id: 'wetland',
    stage: 3,
    label: 'New wetland habitat',
    condition: 'water spread beyond its original shore',
    when: waterChanged,
    regime: { fidelity: 0, followWear: 0, disperse: true },
    effect: 'Rubble and the flood it held back make damp, sheltered margins that did not exist before: vegetation and creatures move to the new shore.',
  },
]

function grow(parent: HistoryNode, rule: HistoryRule, origin: HistoryNode): HistoryNode {
  const world = cloneWorld(parent.world)
  rule.event?.(world)
  const regime: Regime = { ...parent.regime, burst: 0, ...rule.regime }
  const id = `${parent.id}/${rule.id}`
  let seed = 0
  for (let k = 0; k < id.length; k++) {
    seed = (seed * 31 + id.charCodeAt(k)) | 0
  }
  runStage(world, regime, STAGE_STEPS[rule.stage], seed)
  const node: HistoryNode = {
    id,
    stage: rule.stage,
    rule,
    parent,
    children: [],
    world,
    metrics: measure(world),
    regime: { ...regime, burst: 0 },
  }
  node.children = HISTORY_RULES.filter((r) => r.stage === rule.stage + 1 && r.when(node, origin)).map((r) => grow(node, r, origin))
  return node
}

export function buildHistoryTree(): HistoryNode {
  const world = originWorld()
  const root: HistoryNode = {
    id: 'origin',
    stage: 0,
    rule: null,
    parent: null,
    children: [],
    world,
    metrics: measure(world),
    regime: BASE_REGIME,
  }
  root.children = HISTORY_RULES.filter((r) => r.stage === 1).map((r) => grow(root, r, root))
  return root
}

let built: HistoryNode | null = null

/** The tree is fixed by the rules; it is simulated once, the first time the study opens. */
export function historyTree(): HistoryNode {
  built ??= buildHistoryTree()
  return built
}

export function allNodes(root: HistoryNode): HistoryNode[] {
  return [root, ...root.children.flatMap(allNodes)]
}

export function leavesOf(root: HistoryNode): HistoryNode[] {
  return allNodes(root).filter((n) => n.children.length === 0)
}

export function pathOf(node: HistoryNode): HistoryNode[] {
  const path: HistoryNode[] = []
  for (let n: HistoryNode | null = node; n; n = n.parent) {
    path.unshift(n)
  }
  return path
}

const signed = (n: number, digits = 0) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(digits)}`

/** What changed against the parent, in the terms of the ontology. */
export function describeChange(node: HistoryNode): { label: string; value: string }[] {
  const m = node.metrics
  const p = node.parent?.metrics
  const was = (key: keyof Metrics, digits = 0) => (p ? ` (${signed(m[key] - p[key], digits)})` : '')
  return [
    { label: 'Architecture', value: `${m.structure} voxels standing${was('structure')}` },
    { label: 'Shade', value: `${m.shade} cells${was('shade')}` },
    { label: 'Habitat', value: `${m.habitat} cells, ${m.patches} ${m.patches === 1 ? 'patch' : 'patches'}${was('habitat')}` },
    {
      label: 'Creatures',
      value: m.creatures > 0 ? `${m.creatures} in ${m.occupied} ${m.occupied === 1 ? 'pocket' : 'pockets'}${was('creatures')}` : `none${was('creatures')}`,
    },
    { label: 'Paths', value: `${m.paths} worn · ${m.trodden} trodden bare · ${m.reclaimed} overgrown` },
    { label: 'Vegetation', value: `shelter ${m.vegShelter.toFixed(0)} · exposure ${m.vegExposure.toFixed(0)}` },
    { label: 'Water', value: `${m.water} cells${was('water')}` },
  ]
}
