export type StudyId = 'scale' | 'agents'

type Tab = { id: StudyId; index: string; label: string }

const TABS: readonly Tab[] = [
  { id: 'scale', index: '01', label: 'Scale' },
  { id: 'agents', index: '02', label: 'Agents' },
]

/** The Agents & Scale subtabs, as in Weeks 06 and 07. */
export function StudyTabs({ active, onSelect }: { active: StudyId; onSelect: (study: StudyId) => void }) {
  return (
    <div className="view-tabs" role="tablist" aria-label="Agents and scale study">
      {TABS.map((tab) => (
        <button key={tab.id} type="button" role="tab" aria-selected={tab.id === active} onClick={() => onSelect(tab.id)}>
          <span className="tab-index">{tab.index}</span>
          {tab.label}
        </button>
      ))}
    </div>
  )
}
