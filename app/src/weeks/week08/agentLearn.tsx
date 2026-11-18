import type { LearnStep } from '../../shared/ui/learn.tsx'
import { canvasTarget } from '../../shared/ui/learnTargets.ts'

const SCENE = canvasTarget('.week08')
const READOUT = '.week08 .readout'
const SPECIES = '.week08 [data-learn="species"]'
const PERCEPTION = '.week08 [data-learn="perception"]'
const STATES = '.week08 [data-learn="states"]'
const TRAILS = '.week08 [data-learn="trails"]'
const HABITAT = '.week08 [data-learn="habitat"]'
const COMPARE = '.week08 [data-learn="compare"]'

/** What a step sets up. Anything left out stays as it is. */
export type AgentLearnState = {
  ground?: number
  air?: number
  water?: number
  run?: 'mixed' | 'ground' | 'air' | 'water'
  seed?: number
  perception?: number
  speed?: number
  halfLife?: number
  pull?: number
  simSpeed?: number
  trails?: boolean
  habitat?: boolean
  rings?: boolean
  /** Start the run again from t = 0. */
  reset?: boolean
  /** Run the same-seed comparison. */
  compare?: boolean
}

/** The four states and what moves an agent between them. */
function StateFigure() {
  const node = (x: number, y: number, label: string, tone: string) => (
    <g>
      <rect x={x - 34} y={y - 11} width={68} height={22} rx={3} fill="none" stroke={tone} strokeWidth={1} />
      <text x={x} y={y + 3} textAnchor="middle" fill={tone} fontSize={9} fontFamily="var(--mono)">
        {label}
      </text>
    </g>
  )
  const arrow = (d: string) => <path d={d} fill="none" stroke="var(--ui-faint)" strokeWidth={0.9} markerEnd="url(#arrow)" />
  const note = (x: number, y: number, text: string) => (
    <text x={x} y={y} textAnchor="middle" fill="var(--ui-muted)" fontSize={6.5} fontFamily="var(--mono)">
      {text}
    </text>
  )
  return (
    <svg viewBox="0 0 300 150" width="100%" role="img" aria-label="Roam to Seek when hungry and food is known; Seek to Feed on arrival; Feed back to Roam when fed; Roam or Seek to Rest when tired; Rest to Roam when recovered">
      <defs>
        <marker id="arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" fill="var(--ui-faint)" />
        </marker>
      </defs>
      {node(50, 40, 'Roam', '#cfc9bb')}
      {node(150, 40, 'Seek', '#B69A80')}
      {node(250, 40, 'Feed', '#8A9D91')}
      {node(150, 120, 'Rest', '#7fa6d6')}
      {arrow('M84,40 L114,40')}
      {note(99, 30, 'hungry')}
      {arrow('M184,40 L214,40')}
      {note(199, 30, 'arrived')}
      {arrow('M250,29 C250,8 50,8 50,29')}
      {note(150, 8, 'fed, or food gone')}
      {arrow('M70,51 C70,100 100,120 114,120')}
      {note(52, 96, 'tired')}
      {arrow('M186,120 C230,120 250,100 250,51')}
      {note(244, 110, 'tired')}
      {arrow('M130,109 C100,90 60,80 58,52')}
      {note(114, 84, 'recovered')}
    </svg>
  )
}

/**
 * Week 08 Agents guided sequence: three agent types → one state machine, three rule sets → perception and layers → stigmergy →
 * shared resources and environmental feedback → same-seed comparison → toward 0.3. `show` sets up what a step is about.
 */
export function createAgentLearnSteps({ show }: { show: (state: AgentLearnState) => void }): readonly LearnStep[] {
  const mixed: AgentLearnState = { ground: 30, air: 16, water: 18, run: 'mixed', seed: 7 }
  return [
    {
      title: 'Three kinds of agent',
      text: 'Three behavioural archetypes share one patch: cones walk on the ground, flat kites fly above it with a shadow below, and slim fish swim under the water. They stand for ground animals, birds and fish, not for finished species.',
      try: 'Click one agent of each kind.',
      notice: 'Colour is state; shape and height tell the kinds apart.',
      target: [SPECIES, SCENE],
      enter: () => show({ ...mixed, perception: 8, speed: 1.5, pull: 0, simSpeed: 2, trails: false, habitat: false, rings: true, reset: true }),
    },
    {
      title: 'One state machine, three rule sets',
      figure: <StateFigure />,
      points: [
        'Terrestrial: walks on dry ground, avoids water and rocks, rests in the shade of a slab.',
        'Aerial: flies over everything, sees farther, perches on a slab to rest.',
        'Aquatic: stays in its own lake, grazes algae, shelters in deep water.',
      ],
      notice: 'Same four states, different triggers: hunger, tiredness, or shallow-water stress.',
      target: [STATES, SCENE],
      enter: () => show({ ...mixed, simSpeed: 2 }),
    },
    {
      title: 'Perception and layers',
      text: 'Each agent knows only what is inside its ring. A bird’s is the widest and it ignores trails; a fish’s is the smallest and is limited to its own lake. The bird’s shadow shows how high it is.',
      try: 'Click a bird, then a fish, then drag Perception.',
      notice: 'The ring changes size and height with the kind of agent.',
      target: [PERCEPTION, SCENE],
      enter: () => show({ ...mixed, rings: true, trails: false, habitat: false }),
    },
    {
      title: 'Traces: stigmergy',
      text: 'Walkers leave a trail that fades and spreads, and lean toward stronger trail. Nobody talks: the ground carries the message. Fliers and fish do not read it.',
      try: 'Set Trail attraction to 0, then to 1, and compare after a minute.',
      notice: 'Trail in the top 5% of ground is about 12% with no attraction, about twice that with it.',
      target: [TRAILS, READOUT, SCENE],
      enter: () => show({ ...mixed, run: 'ground', pull: 0.8, halfLife: 60, rings: false, trails: true, habitat: false, simSpeed: 4, reset: true }),
    },
    {
      title: 'Sharing and feedback',
      text: 'Birds and walkers eat at the same food sites, which is indirect competition. Everyone also leaves nutrient, most where it rests, perches or feeds. It spreads, runs off into the lakes, and feeds algae. Rich ground regrows food faster and restores tired walkers sooner.',
      try: 'Watch the green build under the slabs and in the lakes.',
      notice: 'The habitat readout rises as the agents’ own activity changes the place they live in.',
      target: [HABITAT, SCENE],
      enter: () => show({ ...mixed, rings: false, trails: false, habitat: true, simSpeed: 8, reset: true }),
    },
    {
      title: 'Same seed, one kind or all',
      text: 'The comparison runs the same seed four times without drawing it: everyone together, then each kind alone with the same number of agents. Each kind has its own random stream, so a kind behaves the same alone unless the others change something it shares.',
      try: 'Press Run comparison, then change a count and run it again.',
      notice: 'On seed 7, mixed has less food left and better-fed fish than the single-kind runs. Other seeds differ.',
      target: [COMPARE],
      enter: () => show({ ...mixed, simSpeed: 4, habitat: true, compare: true }),
    },
    {
      title: 'Toward 0.3',
      points: [
        'Creatures: ground, air and water archetypes sharing one state machine, driven by 0.3’s fields: shade from Living Architecture, light, moisture, terrain.',
        'Habitat: collective activity could write a nutrient or habitat field that feeds back on vegetation and shelter.',
        'Paths: trails from repeated walking could wear into the ground or steer where plants and shelter do well.',
      ],
      notice: 'Not integrated: this study is independent of 0.3, and its rules and numbers are tuned for clarity, not ecology.',
      target: [SCENE],
      enter: () => show({ ...mixed, simSpeed: 2 }),
    },
  ]
}
