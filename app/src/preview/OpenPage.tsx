import { lazy, type ReactNode } from 'react'
import { ArchitectureLab } from '../architecture-lab/ArchitectureLab.tsx'
import { CreatureLab } from '../creature-lab/CreatureLab.tsx'
import { HabitatStudy } from '../habitat-study/HabitatStudy.tsx'
import { ShadowEcologyProject } from '../project/ShadowEcologyProject.tsx'
import { SHADOW_ECOLOGY_ABOUT } from '../project02/about.ts'
import { ShadowEcology02 } from '../project02/ShadowEcology02.tsx'
import { ShadowEcology03 } from '../project03/ShadowEcology03.tsx'
import { VegetationLab } from '../vegetation-lab/VegetationLab.tsx'
import { guideReturn } from '../project03/worldActions.ts'
import { follow, go, href } from './route.ts'

/** Everything the Project page links to, opened as it is (unchanged): the earlier versions, the full 0.3 instrument page, and the Labs. */
// The weekly exercises, each loaded only when opened.
const BasicsWeek = lazy(() => import('../weeks/week02/BasicsWeek.tsx').then((m) => ({ default: m.BasicsWeek })))
const NoiseTerrainWeek = lazy(() => import('../weeks/week03/NoiseTerrainWeek.tsx').then((m) => ({ default: m.NoiseTerrainWeek })))
const VoxelExercise = lazy(() => import('../weeks/week04/VoxelExercise.tsx').then((m) => ({ default: m.VoxelExercise })))
const ShadersWeek = lazy(() => import('../weeks/week05/ShadersWeek.tsx').then((m) => ({ default: m.ShadersWeek })))
const SpatialSystemsWeek = lazy(() => import('../weeks/week06/SpatialSystemsWeek.tsx').then((m) => ({ default: m.SpatialSystemsWeek })))
const BranchingSystemsWeek = lazy(() => import('../weeks/week07/BranchingSystemsWeek.tsx').then((m) => ({ default: m.BranchingSystemsWeek })))
const AgentsScaleWeek = lazy(() => import('../weeks/week08/AgentsScaleWeek.tsx').then((m) => ({ default: m.AgentsScaleWeek })))

const ARCHIVE: Record<string, { label: string; kind: 'Version' | 'Lab' | 'Exercise'; render: (tabs: ReactNode) => ReactNode }> = {
  '0.3': { label: 'Shadow Ecology 0.3 · the original instrument page', kind: 'Version', render: (tabs) => <ShadowEcology03 tabs={tabs} title="Shadow Ecology 0.3" /> },
  '0.2': { label: 'Shadow Ecology 0.2', kind: 'Version', render: (tabs) => <ShadowEcology02 tabs={tabs} /> },
  '0.1': { label: 'Shadow Ecology 0.1', kind: 'Version', render: (tabs) => <ShadowEcologyProject tabs={tabs} about={SHADOW_ECOLOGY_ABOUT} /> },
  'architecture-lab': { label: 'Architecture Lab', kind: 'Lab', render: (tabs) => <ArchitectureLab tabs={tabs} /> },
  'vegetation-lab': { label: 'Vegetation Lab', kind: 'Lab', render: (tabs) => <VegetationLab tabs={tabs} /> },
  'creature-lab': { label: 'Creature Lab', kind: 'Lab', render: (tabs) => <CreatureLab tabs={tabs} /> },
  'habitat-study': { label: 'Habitat Study', kind: 'Lab', render: (tabs) => <HabitatStudy tabs={tabs} /> },
  week02: { label: 'Week 02 · Basics', kind: 'Exercise', render: () => <BasicsWeek /> },
  week03: { label: 'Week 03 · Terrain', kind: 'Exercise', render: () => <NoiseTerrainWeek /> },
  week04: { label: 'Week 04 · Voxels', kind: 'Exercise', render: () => <VoxelExercise /> },
  week05: { label: 'Week 05 · Shaders', kind: 'Exercise', render: () => <ShadersWeek /> },
  week06: { label: 'Week 06 · Spatial Systems', kind: 'Exercise', render: () => <SpatialSystemsWeek /> },
  week07: { label: 'Week 07 · Branching Systems', kind: 'Exercise', render: () => <BranchingSystemsWeek /> },
  week08: { label: 'Week 08 · Agents & Scale', kind: 'Exercise', render: () => <AgentsScaleWeek /> },
}

/** An archived page in its own frame: a thin bar names it and leads back to the Project page; the page below is exactly as it was. */
export function OpenPage({ id }: { id: string }) {
  const entry = ARCHIVE[id]
  // Back to the section of Project it was opened from.
  const back = `${href({ page: 'project' })}#${entry?.kind === 'Lab' ? 'labs' : entry?.kind === 'Exercise' ? 'exercises' : 'archive'}`
  if (!entry) {
    return (
      <main className="pv-missing">
        <p>Nothing is filed under “{id}”.</p>
        <a href={back} onClick={follow(back)}>
          Back to the project
        </a>
      </main>
    )
  }
  const tabs = (
    <a className="pv-open-back" href={back} onClick={follow(back)}>
      ← Back to the project
    </a>
  )
  return (
    <div className="app-root pv-open">
      <header className="pv-open-bar">
        <a href={back} onClick={follow(back)} className="pv-open-crumb">
          <span className="pv-wordmark-name">Shadow Ecology</span>
          <span className="pv-open-sep">/</span>
          <span>Project</span>
          <span className="pv-open-sep">/</span>
          <span className="pv-open-kind">{entry.kind}</span>
        </a>
        <span className="pv-open-title">{entry.label}</span>
        {guideReturn.step !== null ? (
          // Opened from the Guide: the way back resumes it at the step it left (ShadowEcology03 reads guideReturn as it mounts).
          <button type="button" className="pv-enter is-button" onClick={() => go(href({ page: 'explore' }))}>
            <span>Return to the guide · step {guideReturn.step + 1}</span>
            <i aria-hidden />
          </button>
        ) : (
          <a className="pv-nav-classic" href={back} onClick={follow(back)}>
            Close ✕
          </a>
        )}
      </header>
      {entry.render(tabs)}
    </div>
  )
}
