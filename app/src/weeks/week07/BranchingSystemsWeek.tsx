import { useEffect, useState } from 'react'
import { BranchingHistoriesStudy } from './BranchingHistoriesStudy.tsx'
import { StudyTabs, type StudyId } from './StudyTabs.tsx'
import { TraceGrowthStudy } from './TraceGrowthStudy.tsx'

/** Week 07 — Branching Systems: one study at a time, chosen by the subtabs. */
export function BranchingSystemsWeek() {
  const [study, setStudy] = useState<StudyId>('trace')
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    document.body.classList.toggle('week07-immersive', hidden)
    return () => document.body.classList.remove('week07-immersive')
  }, [hidden])

  const tabs = <StudyTabs active={study} onSelect={setStudy} />
  const immersion = { hidden, setHidden }
  return study === 'histories' ? (
    <BranchingHistoriesStudy tabs={tabs} immersion={immersion} />
  ) : (
    <TraceGrowthStudy tabs={tabs} immersion={immersion} />
  )
}
