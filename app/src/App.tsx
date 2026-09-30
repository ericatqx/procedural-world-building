import { Fragment, useState } from 'react'
import { BasicsWeek } from './weeks/week02/BasicsWeek.tsx'
import { NoiseTerrainWeek } from './weeks/week03/NoiseTerrainWeek.tsx'
import { ShadersWeek } from './weeks/week05/ShadersWeek.tsx'
import { ShadowEcologyProject } from './project/ShadowEcologyProject.tsx'
import { VoxelExercise } from './weeks/week04/VoxelExercise.tsx'
import { AuthBar } from './shared/ui/AuthBar.tsx'
import './App.css'

type WeekId = 'week02' | 'week03' | 'week04' | 'week05' | 'project'

const EXERCISES: { id: WeekId; number: string; name: string }[] = [
  { id: 'week02', number: '02', name: 'Basics' },
  { id: 'week03', number: '03', name: 'Terrain' },
  { id: 'week04', number: '04', name: 'Voxels' },
  { id: 'week05', number: '05', name: 'Shaders' },
  { id: 'project', number: '0.1', name: 'Project' },
]

function App() {
  const [week, setWeek] = useState<WeekId>('project')

  return (
    <div className="app-root">
      <header className="app-header">
        <p className="app-identity">Procedural World Building</p>
        <nav className="exercise-index" role="tablist" aria-label="Exercise">
          {EXERCISES.map((exercise, index) => (
            <Fragment key={exercise.id}>
              {index > 0 ? (
                <span className="exercise-index-sep" aria-hidden="true">
                  {exercise.id === 'project' ? '|' : '·'}
                </span>
              ) : null}
              <button
                type="button"
                role="tab"
                aria-selected={week === exercise.id}
                onClick={() => setWeek(exercise.id)}
              >
                <span className="exercise-number">{exercise.number}</span>
                {exercise.name}
              </button>
            </Fragment>
          ))}
        </nav>
        <AuthBar />
      </header>

      {week === 'week02' ? <BasicsWeek /> : null}
      {week === 'week03' ? <NoiseTerrainWeek /> : null}
      {week === 'week04' ? <VoxelExercise /> : null}
      {week === 'week05' ? <ShadersWeek /> : null}
      {week === 'project' ? <ShadowEcologyProject /> : null}
    </div>
  )
}

export default App
