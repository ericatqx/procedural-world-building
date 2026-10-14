import type { LearnStep } from '../shared/ui/learn.tsx'
import { canvasTarget } from '../shared/ui/learnTargets.ts'
import type { CreatureView, WayOfSeeing } from './perception.ts'

const SCENE = canvasTarget('.project02')

const control = (name: string) => `.project02 [data-learn="${name}"]`

const CHAIN = ['Light', 'Growth', 'Structure', 'Shadow', 'Habitat', 'Trace', 'Future world']

const DEMO_ORDER = ['Overview', 'Architecture', 'Vegetation', 'Paths', 'Weather', 'Ways', 'Lens', 'Parallel']

/**
 * The Shadow Ecology 0.2 GUIDE, written as a presentation cheat sheet: one
 * card per part of the talk, in demo order. Points are sentences to read
 * aloud; the Demo cue is what to click while saying them.
 */
export function createGuide02Steps({
  setWay,
  setLens,
  release,
}: {
  setWay: (way: WayOfSeeing, view?: CreatureView) => void
  setLens: (on: boolean) => void
  release: () => void
}): readonly LearnStep[] {
  const enter = (way: WayOfSeeing) => () => {
    release()
    setWay(way)
    setLens(false)
  }
  return [
    {
      title: 'Shadow Ecology',
      figure: (
        <>
          <p className="learn-chain">
            {CHAIN.map((link, i) => (
              <span key={link}>
                {i > 0 ? <span className="learn-chain-arrow"> → </span> : null}
                {link}
              </span>
            ))}
          </p>
          <ol className="learn-order" aria-label="Demo order">
            {DEMO_ORDER.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </>
      ),
      points: [
        'Shadow Ecology asks how environmental processes leave traces over time.',
        'Architecture grows toward light, and the shade it casts makes room for other life.',
      ],
      try: 'Press Day 10, then 1×.',
      target: [control('time'), SCENE],
      enter: enter('world'),
    },
    {
      title: 'Terrain and water',
      points: [
        'Layered procedural noise creates the terrain; water follows its valleys and basins.',
        'These terrain fields become inputs for the systems that grow on top of it.',
      ],
      try: 'Orbit the world; optionally show contours.',
      target: [SCENE],
      enter: enter('world'),
    },
    {
      title: 'Architecture',
      points: [
        'Architecture grows voxel by voxel toward light while balancing support and structural risk.',
        'Over time it weathers, fails, and leaves rubble that becomes part of the environment.',
      ],
      try: 'Zoom in; show growth, resolution, and decay.',
      target: [control('growth'), SCENE],
      enter: enter('world'),
    },
    {
      title: 'Vegetation',
      points: [
        'Light-seeking plants take the open ground; shadow-seeking plants take the shade.',
        'They grow where conditions suit them, so architecture’s shadow changes where they live.',
      ],
      try: 'Toggle Light-seeking and Shadow-seeking.',
      target: [control('vegetation'), SCENE],
      enter: enter('world'),
    },
    {
      title: 'Paths and traces',
      points: [
        'Paths are not drawn; repeated trips wear them into the ground.',
        'Worn ground is easier to reuse, so traces reinforce themselves over time.',
      ],
      try: 'Toggle Paths.',
      target: [control('paths'), SCENE],
      enter: enter('world'),
    },
    {
      title: 'Weather and material memory',
      points: [
        'Rain, wind, and fog change moisture, water, growth, and stress, not just the look.',
        'The ground and architecture remember it as wetness, staining, and weathering.',
      ],
      try: 'Toggle Rain, Wind, and Fog; then turn Auto back on.',
      target: [control('weather'), SCENE],
      enter: enter('world'),
    },
    {
      title: 'Ways of Seeing',
      points: [
        'The same world can be read through World, Architecture, and Habitat.',
        'Each view reveals a different definition of what matters.',
      ],
      quote: 'There is no neutral view of the world.',
      try: 'Switch through the three views.',
      target: [control('ways'), SCENE],
      enter: enter('world'),
    },
    {
      title: 'Observation lens',
      points: [
        'The lens slows time locally, so one process can be watched up close.',
      ],
      try: 'Optional: press L and hover over a structure.',
      target: [control('lens'), SCENE],
      enter: enter('world'),
    },
    {
      title: 'Parallel Worlds',
      points: [
        'The same world can diverge after different environmental disturbances.',
        'The worlds share a past, but rain, drought, wind, or collapse produce different futures.',
      ],
      quote: 'Its state is its history, and different disturbances produce different possible worlds.',
      try: 'Open Parallel Worlds and select an alternate.',
      target: [control('parallel'), SCENE],
      enter: enter('world'),
    },
  ]
}
