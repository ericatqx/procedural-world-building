import type { LearnStep } from '../../shared/ui/learn.tsx'
import { canvasTarget } from '../../shared/ui/learnTargets.ts'
import { DamFigure, EvidenceFigure, HistoryTreeFigure, RatesFigure } from './historyLearnFigures.tsx'
import type { HistoryView } from './HistoryWorldScene.tsx'

const SCENE = canvasTarget('.week07')
const TREE = '.week07 .history-map'
const HISTORY = '.week07 [data-learn="history"]'
const STATE = '.week07 [data-learn="state"]'
const VIEW = '.week07 [data-learn="view"]'
const RULES = '.week07 [data-learn="rules"]'

export type HistoryLearnState = {
  /** The history node to select, by id. */
  node?: string
  view?: HistoryView
}

/**
 * Week 07 Branching Histories guided sequence: one world, many histories →
 * shared rules → rates → conditional consequences → ecological response →
 * evidence → comparing the presents. `show` selects the node and view a
 * step is about and opens the tree.
 */
export function createHistoryLearnSteps({ show }: { show: (state: HistoryLearnState) => void }): readonly LearnStep[] {
  return [
    {
      title: 'One world, many histories',
      figure: <HistoryTreeFigure />,
      text: 'Every node in the tree is a simulated state of the same world. The origin is one established ecology; each column is a stage of its history; each node on the right is a present one history has arrived at.',
      try: 'Hover a node to preview it; click it to build its world.',
      notice: 'The scene is rebuilt from that node’s own state, not swapped for a prepared scene.',
      target: [TREE, SCENE],
      enter: () => show({ node: 'origin', view: 'world' }),
    },
    {
      title: 'Shared rules',
      text: 'Every history starts from the same terrain, the same structure and the same ecology, and every season of every history runs the same rules: light through the architecture, shelter, moisture, habitat, vegetation, creatures and the paths they wear. The presents are not handcrafted scenes; an event only changes what the rules act on.',
      try: 'Open How it works under Rules.',
      notice: 'One list of ecological rules for every history; the stage rules are only conditions on the world a parent left.',
      target: [RULES, SCENE],
      enter: () => show({ node: 'origin', view: 'world' }),
    },
    {
      title: 'Different rates, different futures',
      figure: <RatesFigure />,
      text: 'Slow decay and sudden collapse are one structural failure rule (exposed, high, unsupported voxels fail first, and mass left unheld follows) run at different rates. Slow decay leaves a standing ruin that still casts shade; collapse brings half the structure down in one season and throws its rubble wide.',
      try: 'Select Slow decay, then Sudden collapse, and compare Architecture, Shade and Rubble.',
      notice: 'The tick on each bar is the parent’s value: one origin, two different inherited conditions.',
      target: [TREE, STATE, SCENE],
      enter: () => show({ node: 'origin/decay', view: 'world' }),
    },
    {
      title: 'Consequences create branches',
      figure: <DamFigure />,
      text: 'Later branches exist only where their condition holds on the world the parent left. Rubble dams the water only when enough collapsed architectural material has actually reached it. Sudden collapse throws it into the lake; slow decay drops only a few blocks at the shore, so its history has no dam branch.',
      try: 'Select Rubble dams the water, then press T for Traces.',
      notice: 'The new water and the shore it had before. Under Slow decay the dam never appears: its condition failed.',
      target: [TREE, HISTORY, SCENE],
      enter: () => show({ node: 'origin/collapse/dam', view: 'world' }),
    },
    {
      title: 'Ecology responds',
      text: 'Shade, water, moisture, rubble and disturbance set where habitat, vegetation and creatures can be. Plants are placed as in Week 06 Distribution’s Environment method, each strategy by its own weighted preferences: exposure plants follow the sun across open ground, plateau and ridges, with moisture only a secondary pull; shelter plants gather where architecture shadow, the foot of the escarpment and moisture meet. Slope thins both gradually; trodden ground stays bare. Where the dam spreads the water, the moist sheltered ground moves and the shelter stands with it.',
      try: 'Compare Reclaimed ground with New wetland habitat: the same collapse, with and without the dam.',
      notice: 'The same seeds are weighed in every history, so plants that persist stand in the same places; only changed fields move them. Trodden ground stays bare.',
      target: [STATE, SCENE],
      enter: () => show({ node: 'origin/collapse/dam/wetland', view: 'world' }),
    },
    {
      title: 'Read the evidence',
      figure: <EvidenceFigure />,
      text: 'WORLD shows what exists now. TRACES dims the present and draws how it became so: the structure that stood, rubble, ground that lost its shelter, every route walked (trodden bare or grown over), dead vegetation, and the shore before the water spread.',
      try: 'Press W and T on Persistent corridor, then on Reclaimed ground.',
      notice: 'Two ruins that look alike in places hold very different histories: a route trodden into the ground, and routes abandoned and overgrown.',
      target: [VIEW, SCENE],
      enter: () => show({ node: 'origin/decay/course/corridor', view: 'traces' }),
    },
    {
      title: 'Compare the presents',
      text: 'Five presents, one origin. Each should be readable from the world alone: whether the tower stands, where the rubble lies, where the ground is trodden, where creatures gather or have left, where the water reaches.',
      try: 'Press H to hide the interface, then ↑ ↓ to step through the outcomes.',
      notice: 'Every difference you can see traces back through the tree to one rate and the consequences it allowed.',
      target: [TREE, SCENE],
      enter: () => show({ node: 'origin/stable/course/ecology', view: 'world' }),
    },
  ]
}
