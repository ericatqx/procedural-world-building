export type StudyId = 'trace' | 'histories'

type Tab = { id: StudyId; index: string; label: string }

const TABS: readonly Tab[] = [
  { id: 'trace', index: '01', label: 'Trace Growth' },
  { id: 'histories', index: '02', label: 'Branching Histories' },
]

/** The Branching Systems subtabs, as in Week 06. */
export function StudyTabs({ active, onSelect }: { active: StudyId; onSelect: (study: StudyId) => void }) {
  return (
    <div className="view-tabs" role="tablist" aria-label="Branching systems study">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          onClick={() => onSelect(tab.id)}
        >
          <span className="tab-index">{tab.index}</span>
          {tab.label}
        </button>
      ))}
    </div>
  )
}
