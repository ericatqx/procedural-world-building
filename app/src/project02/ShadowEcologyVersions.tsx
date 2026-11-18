import { useEffect, useState } from 'react'
import { guideReturn, registerSite } from '../project03/worldActions.ts'
import { ArchitectureLab } from '../architecture-lab/ArchitectureLab.tsx'
import { CreatureLab } from '../creature-lab/CreatureLab.tsx'
import { HabitatStudy } from '../habitat-study/HabitatStudy.tsx'
import { ProjectNav, type NavEntry } from '../ProjectNav.tsx'
import { VegetationLab } from '../vegetation-lab/VegetationLab.tsx'
import { ShadowEcologyProject } from '../project/ShadowEcologyProject.tsx'
import { ShadowEcology03 } from '../project03/ShadowEcology03.tsx'
import { SHADOW_ECOLOGY_ABOUT } from './about.ts'
import { ShadowEcology02 } from './ShadowEcology02.tsx'

/** Project versions, newest first. The first opens by default. */
const VERSIONS: NavEntry[] = [
  { id: '0.3', label: '0.3', note: 'current', description: 'A 4.1 km island: ranges, lakes and rivers, with Living Architecture and vegetation growing under a moving sun.', render: (nav) => <ShadowEcology03 key="0.3" tabs={nav} /> },
  { id: '0.2', label: '0.2', description: 'The ecology as a chain: light, weather and water shape architecture, vegetation and creatures, and the traces they leave.', render: (nav) => <ShadowEcology02 key="0.2" tabs={nav} /> },
  { id: '0.1', label: '0.1', description: 'The first prototype: light → growth → shadow → habitat.', render: (nav) => <ShadowEcologyProject key="0.1" tabs={nav} about={SHADOW_ECOLOGY_ABOUT} /> },
]

/** Labs, in the order they were built. Add a new lab here. */
const LABS: NavEntry[] = [
  { id: 'architecture-lab', label: 'Architecture Lab', description: 'How one Living Architecture organism develops its form: two morphology families (the Overhang reference and the experimental Porous Growth, which can be compared side by side), one specimen on a small stage.', render: (nav) => <ArchitectureLab key="architecture-lab" tabs={nav} /> },
  { id: 'vegetation-lab', label: 'Vegetation Lab', description: 'The island’s plant life as procedural growth strategies, one archetype at a time.', render: (nav) => <VegetationLab key="vegetation-lab" tabs={nav} /> },
  { id: 'creature-lab', label: 'Creature Lab', description: 'Two species of the island’s creatures as procedural bodies with their own motion.', render: (nav) => <CreatureLab key="creature-lab" tabs={nav} /> },
  { id: 'habitat-study', label: 'Habitat Study', description: 'An art-direction study: one window of the 0.3 island around the Reference Overhang, drawn from the world’s own data, for comparing visual styles.', render: (nav) => <HabitatStudy key="habitat-study" tabs={nav} /> },
]

/** One project page at a time, so only its scene runs. Opens on 0.3; 0.1 and 0.2 stay as they are. */
export function ShadowEcologyVersions() {
  const [page, setPage] = useState(VERSIONS[0]!.id)
  // The 0.3 guide can open a Lab and come back to where it was (worldActions.ts). Choosing a page from the navigation leaves the guide for good.
  useEffect(() => {
    registerSite(setPage)
    return () => registerSite(null)
  }, [])
  const choose = (id: string) => {
    guideReturn.step = null
    guideReturn.lab = null
    setPage(id)
  }
  const nav = <ProjectNav versions={VERSIONS} labs={LABS} active={page} onSelect={choose} />
  const entry = [...VERSIONS, ...LABS].find((e) => e.id === page) ?? VERSIONS[0]!
  const fromGuide = guideReturn.step !== null && LABS.some((lab) => lab.id === page)
  return (
    <>
      {entry.render(nav)}
      {fromGuide ? (
        <div className="guide-return ui-system" role="region" aria-label="Guide">
          <span className="guide-return-label">Guide · Step {guideReturn.step! + 1} of 5</span>
          <button type="button" className="learn-button is-primary" onClick={() => setPage('0.3')}>
            Return to Guide
          </button>
        </div>
      ) : null}
    </>
  )
}
