export type StudyId = 'distribution' | 'paths' | 'fields'

type Tab = { id: StudyId; index: string; label: string; ready: boolean }

const TABS: readonly Tab[] = [
  { id: 'distribution', index: '01', label: 'Distribution', ready: true },
  { id: 'paths', index: '02', label: 'Paths', ready: true },
  { id: 'fields', index: '03', label: 'Fields', ready: true },
]

/** The Spatial Systems subtabs; unbuilt studies stay visible but inert. */
export function StudyTabs({ active, onSelect }: { active: StudyId; onSelect: (study: StudyId) => void }) {
  return (
    <div className="view-tabs" role="tablist" aria-label="Spatial systems study">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          disabled={!tab.ready}
          title={tab.ready ? undefined : 'Not built yet'}
          onClick={() => onSelect(tab.id)}
        >
          <span className="tab-index">{tab.index}</span>
          {tab.label}
        </button>
      ))}
    </div>
  )
}
