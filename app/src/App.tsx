import { useState } from 'react'
import { BasicsWeek } from './weeks/week02/BasicsWeek.tsx'
import { NoiseTerrainWeek } from './weeks/week03/NoiseTerrainWeek.tsx'
import { ShadersWeek } from './weeks/week05/ShadersWeek.tsx'
import { SpatialSystemsWeek } from './weeks/week06/SpatialSystemsWeek.tsx'
import { BranchingSystemsWeek } from './weeks/week07/BranchingSystemsWeek.tsx'
import { AgentsScaleWeek } from './weeks/week08/AgentsScaleWeek.tsx'
import { ShadowEcologyVersions } from './project02/ShadowEcologyVersions.tsx'
import { VoxelExercise } from './weeks/week04/VoxelExercise.tsx'
import { AuthBar } from './shared/ui/AuthBar.tsx'
import { ExerciseNav } from './ExerciseNav.tsx'
import './App.css'

type WeekId = 'week02' | 'week03' | 'week04' | 'week05' | 'week06' | 'week07' | 'week08' | 'project'

const EXERCISES: { id: Exclude<WeekId, 'project'>; number: string; name: string }[] = [
  { id: 'week02', number: '02', name: 'Basics' },
  { id: 'week03', number: '03', name: 'Terrain' },
  { id: 'week04', number: '04', name: 'Voxels' },
  { id: 'week05', number: '05', name: 'Shaders' },
  { id: 'week06', number: '06', name: 'Spatial Systems' },
  { id: 'week07', number: '07', name: 'Branching Systems' },
  { id: 'week08', number: '08', name: 'Agents & Scale' },
]

function App() {
  const [week, setWeek] = useState<WeekId>('project')

  return (
    <div className="app-root">
      <header className="app-header">
        <p className="app-identity">Procedural World Building</p>
        <ExerciseNav items={EXERCISES} active={week} onSelect={(id) => setWeek(id as WeekId)} />
        <div className="header-end">
          <button type="button" className="project-link" aria-current={week === 'project' ? 'page' : undefined} onClick={() => setWeek('project')}>
            Project
          </button>
          <AuthBar />
        </div>
      </header>

      {week === 'week02' ? <BasicsWeek /> : null}
      {week === 'week03' ? <NoiseTerrainWeek /> : null}
      {week === 'week04' ? <VoxelExercise /> : null}
      {week === 'week05' ? <ShadersWeek /> : null}
      {week === 'week06' ? <SpatialSystemsWeek /> : null}
      {week === 'week07' ? <BranchingSystemsWeek /> : null}
      {week === 'week08' ? <AgentsScaleWeek /> : null}
      {week === 'project' ? <ShadowEcologyVersions /> : null}
    </div>
  )
}

export default App
