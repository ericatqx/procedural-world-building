import type { LearnStep } from '../shared/ui/learn.tsx'
import { canvasTarget } from '../shared/ui/learnTargets.ts'
import { HabitatFigure, ShelterFigure } from './guideFigures.tsx'
import { MEMORY_DAYS } from './habitat.ts'

const SCENE = canvasTarget('.project')

const control = (name: string) => `.project [data-learn="${name}"]`
const VIEW_STRIP = '.project .view-strip'

/**
 * The Shadow Ecology GUIDE: the chain light → growth → shelter → habitat →
 * weathering, one link per step, each pointing at the live control that
 * drives it and the world where it shows. It ends in the 3D world, on
 * exploring the same ecology at different scales and viewpoints.
 * `setPlate` opens or closes the enlarged observation plate, which every step
 * leaves closed; `showWorld` returns the 3D view to World. The control to act
 * on comes first in `target`, since the tour scrolls the panel to it.
 */
export function createProjectGuideSteps({
  setPlate,
  showWorld,
}: {
  setPlate: (open: boolean) => void
  showWorld: () => void
}): readonly LearnStep[] {
  return [
    {
      title: 'Shadow Ecology',
      text: 'An island under a moving sun. Light, growth, shadow and weather act on it slowly, and each leaves a trace you can read: masses, shade, lichen, worn paths.',
      try: 'Press P to play the day.',
      notice: 'Shadows sweep round as the sun crosses. Everything that follows grows out of that movement.',
      target: SCENE,
      enter: () => setPlate(false),
    },
    {
      title: 'Light → Growth',
      text: 'Daylight pays for growth. Each lit hour buys new blocks on well-lit ground by the water; sunlit spots are strongly favoured, shaded ones rarely chosen, and the masses step toward the sun.',
      try: 'Drag Time of day through the afternoon.',
      notice: 'The voxel count climbs while the sun is up and holds through the night.',
      target: [control('time'), control('growth'), SCENE],
      enter: () => setPlate(false),
    },
    {
      title: 'Growth → Shelter',
      figure: <ShelterFigure />,
      text: 'Every block casts shadow. What grows toward the light leaves shade behind it: sheltered ground that was open before.',
      try: 'Lower Noon sun height.',
      notice: 'A lower sun stretches each shadow further across the ground.',
      target: [control('noon'), SCENE],
      enter: () => setPlate(false),
    },
    {
      title: 'Shelter → Habitat',
      figure: <HabitatFigure />,
      text: `Habitat remembers. Each sunset the world estimates a full day’s sunlight from the structure as it stands and blends it into ${MEMORY_DAYS} days of sunlight memory; ground kept under the sunlight limit, on gentle, moist footing, becomes suitable.`,
      try: 'Set Show to Field only.',
      notice: 'The lichen crust gathers where shade has lasted, a day or more behind the shadow.',
      target: [control('view'), control('habitat'), SCENE],
      enter: () => setPlate(false),
    },
    {
      title: 'Time → Weathering',
      text: 'Architecture ages. Weather turns old blocks from graphite to pale, pitted stone until they fall. The freed ground and light move the shade, and the habitat with it.',
      try: 'Jump to Day 50.',
      notice: 'Pale, pitted blocks are wearing away; where masses have gone, lichen thins and growth can start again.',
      target: [control('day-jump'), SCENE],
      enter: () => {
        setPlate(false)
        showWorld()
      },
    },
    {
      title: 'Ways of seeing',
      text: 'The ecology reads differently at every scale. Pull back to take in the whole island. Move close to a mass to read its weathering, follow a river down through the terrain, or look into the sheltered ground beside it, where lichen and plants gather.',
      try: 'Drag to orbit and scroll to zoom: out to the whole island, then in to one mass and the ground it shades.',
      notice: 'Show, F, C and R, and the observation plate are optional lenses. Each reveals a different relationship; none changes the ecology.',
      target: [control('view'), SCENE, VIEW_STRIP],
      enter: () => {
        setPlate(false)
        showWorld()
      },
    },
  ]
}
