import { useState } from 'react'
import { BasicsWeek } from './scene/BasicsWeek.tsx'
import { NoiseTerrainWeek } from './scene/NoiseTerrainWeek.tsx'
import { VoxelExercise } from './scene/exercises/VoxelExercise.tsx'
import { AuthBar } from './ui/AuthBar.tsx'
import './App.css'

type WeekId = 'week02' | 'week03' | 'week04'

const WEEK_TABS: { id: WeekId; label: string }[] = [
  { id: 'week02', label: 'Week 02 — Basics' },
  { id: 'week03', label: 'Week 03 — Noise & Terrain' },
  { id: 'week04', label: 'Week 04 — Voxels' },
]

function App() {
  const [week, setWeek] = useState<WeekId>('week04')

  return (
    <div className="app-root">
      <div className="app-top-bar">
        <div className="week-tabs" role="tablist" aria-label="Course week">
          {WEEK_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={week === tab.id}
              onClick={() => setWeek(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <AuthBar />
      </div>

      {week === 'week02' ? <BasicsWeek /> : null}
      {week === 'week03' ? <NoiseTerrainWeek /> : null}
      {week === 'week04' ? <VoxelExercise /> : null}
    </div>
  )
}

export default App
