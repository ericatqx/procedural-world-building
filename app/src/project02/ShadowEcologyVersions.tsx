import { useState } from 'react'
import { ConceptLab } from '../concept-lab/ConceptLab.tsx'
import { ShadowEcologyProject } from '../project/ShadowEcologyProject.tsx'
import { ShadowEcology03 } from '../project03/ShadowEcology03.tsx'
import { SHADOW_ECOLOGY_ABOUT } from './about.ts'
import { ShadowEcology02 } from './ShadowEcology02.tsx'

type ProjectPage = '0.1' | '0.2' | '0.3' | 'lab'

const PAGES: readonly { id: ProjectPage; label: string }[] = [
  { id: '0.1', label: '0.1' },
  { id: '0.2', label: '0.2' },
  { id: '0.3', label: '0.3' },
  { id: 'lab', label: 'Concept Lab' },
]

function ProjectTabs({ active, onSelect }: { active: ProjectPage; onSelect: (page: ProjectPage) => void }) {
  return (
    <div className="view-tabs" role="tablist" aria-label="Project">
      {PAGES.map((page) => (
        <button key={page.id} type="button" role="tab" aria-selected={page.id === active} onClick={() => onSelect(page.id)}>
          {page.label}
        </button>
      ))}
    </div>
  )
}

/** One project page at a time, so only its scene runs. 0.1, 0.2, and Concept Lab stay as they are. */
export function ShadowEcologyVersions() {
  const [page, setPage] = useState<ProjectPage>('0.2')
  const tabs = <ProjectTabs active={page} onSelect={setPage} />
  if (page === '0.1') return <ShadowEcologyProject key="0.1" tabs={tabs} about={SHADOW_ECOLOGY_ABOUT} />
  if (page === '0.3') return <ShadowEcology03 key="0.3" tabs={tabs} />
  if (page === 'lab') return <ConceptLab key="lab" tabs={tabs} />
  return <ShadowEcology02 key="0.2" tabs={tabs} />
}
