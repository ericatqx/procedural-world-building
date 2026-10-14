import type { ReactNode } from 'react'
import { KeyToggle, type ViewTool } from '../../shared/ui/instrument.tsx'
import { useShortcuts } from '../../shared/ui/shortcuts.ts'

/** Week 07's Hide UI state, held by the week so it carries across its studies and resets on leaving. */
export type Immersion = { hidden: boolean; setHidden: (hidden: boolean) => void }

/**
 * Week 07 bottom-left strip: H Hide UI first, then the page's tools in the
 * shared order (F Wireframe, R Auto rotate), then page-specific keys, then
 * the readout. With the UI hidden only `H Show UI` remains; the tools'
 * shortcuts keep working.
 */
export function Week07ViewStrip({
  immersion,
  tools,
  children,
}: {
  immersion: Immersion
  tools: readonly ViewTool[]
  children?: ReactNode
}) {
  const { hidden, setHidden } = immersion
  useShortcuts((key) => {
    if (key.toLowerCase() === 'h') {
      setHidden(!hidden)
      return true
    }
    const tool = tools.find((item) => item.key.toLowerCase() === key.toLowerCase())
    tool?.onChange(!tool.on)
    return tool !== undefined
  })

  if (hidden) {
    return (
      <div className="view-strip week07-strip is-immersive">
        <KeyToggle keyLabel="H" label="Show UI" pressed={false} onChange={() => setHidden(false)} />
      </div>
    )
  }
  return (
    <div className="view-strip week07-strip">
      <div className="view-strip-row">
        <KeyToggle keyLabel="H" label="Hide UI" pressed={false} onChange={() => setHidden(true)} />
        {tools.map((tool) => (
          <KeyToggle key={tool.label} keyLabel={tool.key} label={tool.label} pressed={tool.on} onChange={tool.onChange} />
        ))}
      </div>
      {children}
    </div>
  )
}
