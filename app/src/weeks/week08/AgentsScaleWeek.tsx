import { useState } from 'react'
import { AgentsStudy } from './AgentsStudy.tsx'
import { ScaleStudy } from './ScaleStudy.tsx'
import { StudyTabs, type StudyId } from './StudyTabs.tsx'

/** Week 08 — Agents & Scale: one study at a time, chosen by the subtabs. */
export function AgentsScaleWeek() {
  const [study, setStudy] = useState<StudyId>('scale')
  const tabs = <StudyTabs active={study} onSelect={setStudy} />
  return study === 'agents' ? <AgentsStudy tabs={tabs} /> : <ScaleStudy tabs={tabs} />
}
