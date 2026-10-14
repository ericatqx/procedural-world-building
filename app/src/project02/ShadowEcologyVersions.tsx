import { useState } from 'react'
import { ShadowEcologyProject } from '../project/ShadowEcologyProject.tsx'
import { SHADOW_ECOLOGY_ABOUT } from './about.ts'
import { ShadowEcology02 } from './ShadowEcology02.tsx'

type Version = '0.1' | '0.2'

const VERSIONS: readonly Version[] = ['0.1', '0.2']

function VersionTabs({ active, onSelect }: { active: Version; onSelect: (version: Version) => void }) {
  return (
    <div className="view-tabs" role="tablist" aria-label="Shadow Ecology version">
      {VERSIONS.map((version) => (
        <button key={version} type="button" role="tab" aria-selected={version === active} onClick={() => onSelect(version)}>
          {version}
        </button>
      ))}
    </div>
  )
}

/** Shadow Ecology: one version mounted at a time, so only its scene runs. About is shared; each has its own Guide. */
export function ShadowEcologyVersions() {
  const [version, setVersion] = useState<Version>('0.2')
  const tabs = <VersionTabs active={version} onSelect={setVersion} />
  return version === '0.1' ? (
    <ShadowEcologyProject key="0.1" tabs={tabs} about={SHADOW_ECOLOGY_ABOUT} />
  ) : (
    <ShadowEcology02 key="0.2" tabs={tabs} />
  )
}
