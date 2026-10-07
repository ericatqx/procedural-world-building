import { useState } from 'react'
import { DistributionStudy } from './DistributionStudy.tsx'
import { FieldsStudy } from './FieldsStudy.tsx'
import { PathsStudy } from './PathsStudy.tsx'
import { StudyTabs, type StudyId } from './StudyTabs.tsx'

/** Week 06 — Spatial Systems: one study at a time, chosen by the subtabs. */
export function SpatialSystemsWeek() {
  const [study, setStudy] = useState<StudyId>('distribution')
  const tabs = <StudyTabs active={study} onSelect={setStudy} />
  if (study === 'paths') {
    return <PathsStudy tabs={tabs} />
  }
  return study === 'fields' ? <FieldsStudy tabs={tabs} /> : <DistributionStudy tabs={tabs} />
}
