import { useState, type ReactNode } from 'react'
import { ArchitectureInspection } from './anatomy/Architecture.tsx'
import { CreaturesInspection } from './anatomy/Creatures.tsx'
import { TerrainInspection } from './anatomy/Terrain.tsx'
import { VegetationInspection } from './anatomy/Vegetation.tsx'
import { WaterInspection } from './anatomy/Water.tsx'
import { follow, href } from './route.ts'

/**
 * 02 WORLD ANATOMY: a gallery of five exhibits, one shown at a time. Each takes one system apart in its own terms (not a common
 * set of controls): the rule that generates it, the data it is held in, and how the one produces the other, drawn from the live world's own
 * data and functions (read only: preview/anatomy/*). It does not repeat Explore's maps of the environment or Formation's replay, and it does not
 * take the 3D island: the page scrolls through it like any other section.
 */
export type SystemKey = 'terrain' | 'water' | 'architecture' | 'vegetation' | 'creatures'

const SYSTEMS: { key: SystemKey; title: string; subject: string; question: string; lede: string; view: () => ReactNode; lab?: { id: string; label: string } }[] = [
  { key: 'terrain', title: 'Terrain', subject: 'Why this shape', question: 'Why does the island have this shape?', lede: 'Five layers of noise, summed, make the mountains, valleys and grain; the shape they leave decides where shade lasts.', view: () => <TerrainInspection /> },
  { key: 'water', title: 'Water', subject: 'Why it flows here', question: 'Why does water flow where it does?', lede: 'The ground’s slope sends water down; where enough of the island drains to one line a river forms, and hollows fill.', view: () => <WaterInspection /> },
  { key: 'architecture', title: 'Living Architecture', subject: 'Why this form', question: 'Why does a structure take its form, and what does its shade do?', lede: 'Each structure grows from the ground it stands on, and its form decides the shade it casts.', view: () => <ArchitectureInspection />, lab: { id: 'architecture-lab', label: 'Architecture Lab' } },
  { key: 'vegetation', title: 'Vegetation', subject: 'Why here, not there', question: 'Why does a plant grow here, but not there?', lede: 'Each plant’s rule over light, moisture and slope draws where it may grow; a seeded draw decides where it does.', view: () => <VegetationInspection />, lab: { id: 'vegetation-lab', label: 'Vegetation Lab' } },
  { key: 'creatures', title: 'Creatures', subject: 'Why it behaves so', question: 'Why does an animal do what it does, when it does?', lede: 'A body built on a rig of bones, moved through the day by light, and by the shade it can find.', view: () => <CreaturesInspection />, lab: { id: 'creature-lab', label: 'Creature Lab' } },
]

/** `asked`: a system chosen from elsewhere on the page (an exercise's link). */
export function WorldAnatomy({ asked }: { asked: { system: SystemKey; at: number } | null }) {
  const [system, setSystem] = useState<SystemKey>('terrain')
  const [seen, setSeen] = useState(0)
  if (asked && asked.at !== seen) {
    setSeen(asked.at)
    setSystem(asked.system)
  }
  const sys = SYSTEMS.find((s) => s.key === system)!
  return (
    <>
      <header className="pv-sec-head">
        <p className="pv-sec-n">02</p>
        <h2 className="pv-sec-title">World anatomy</h2>
        <p className="pv-sec-intro">Why this island looks and behaves as it does. Five of its systems, each one question answered with the live world’s own data. Light and shadow run through all of them.</p>
      </header>
      <ol className="pv-an-tabs" role="tablist" aria-label="Systems">
        {SYSTEMS.map((s, i) => (
          <li key={s.key}>
            <button type="button" role="tab" aria-selected={s.key === system} onClick={() => setSystem(s.key)}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              {s.title}
              <em>{s.subject}</em>
            </button>
          </li>
        ))}
      </ol>
      <div className="pv-an-panel" role="tabpanel" key={sys.key}>
        <div className="pv-an-head">
          <div>
            <h3>{sys.title}</h3>
            <p className="pv-an-q">{sys.question}</p>
          </div>
          <p>{sys.lede}</p>
          {/* Where the system has a Lab: one clear action, always here, beside the exhibit's title. */}
          {sys.lab ? (
            <a className="pv-an-labbtn" href={href({ page: 'open', id: sys.lab.id })} onClick={follow(href({ page: 'open', id: sys.lab.id }))}>
              Explore in {sys.lab.label} <span aria-hidden>→</span>
            </a>
          ) : null}
        </div>
        {sys.view()}
      </div>
    </>
  )
}
