import { allNodes, pathOf, STAGE_LABELS, type HistoryNode, type Stage } from './histories.ts'

/**
 * Week 07 Branching Histories — the possibility space as a tree, read left
 * to right: the shared origin, then one column per stage. Presents are
 * spaced evenly down the right; every other node sits midway between its
 * first and last child. The selected history is drawn from the origin to
 * its node.
 */

/** Columns sit far enough apart that a label above one node clears the next column. */
const COLUMNS: Record<Stage, number> = { 0: 36, 1: 154, 2: 298, 3: 412 }
const HEADER_Y = 13
const FIRST_Y = 50
const ROW = 34
const WIDTH = 540
const NODE_R = 3.5
const HIT_R = 13
/** Baseline of a non-leaf label, above the node so the branch can pass under it. */
const LABEL_ABOVE = 16

type Placed = { node: HistoryNode; x: number; y: number }

function layout(root: HistoryNode): Map<string, Placed> {
  const placed = new Map<string, Placed>()
  let row = 0
  const place = (node: HistoryNode): number => {
    let y: number
    if (node.children.length === 0) {
      y = FIRST_Y + row * ROW
      row += 1
    } else {
      const ys = node.children.map(place)
      y = (ys[0]! + ys[ys.length - 1]!) / 2
    }
    placed.set(node.id, { node, x: COLUMNS[node.stage], y })
    return y
  }
  place(root)
  return placed
}

const edge = (a: Placed, b: Placed) => {
  const mid = (a.x + b.x) / 2
  return `M ${a.x} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${b.x} ${b.y}`
}

export function HistoryTree({
  root,
  selected,
  hovered,
  onSelect,
  onHover,
}: {
  root: HistoryNode
  selected: HistoryNode
  hovered: HistoryNode | null
  onSelect: (node: HistoryNode) => void
  onHover: (node: HistoryNode | null) => void
}) {
  const placed = layout(root)
  const nodes = allNodes(root)
  const selectedPath = new Set(pathOf(selected).map((n) => n.id))
  const hoverPath = new Set(hovered ? pathOf(hovered).map((n) => n.id) : [])
  const leaves = nodes.filter((n) => n.children.length === 0).length
  const height = FIRST_Y + (leaves - 1) * ROW + 30
  const at = (node: HistoryNode) => placed.get(node.id)!
  const edges = nodes
    .filter((n) => n.parent)
    .slice()
    .sort((a, b) => Number(selectedPath.has(a.id)) - Number(selectedPath.has(b.id)))

  return (
    <svg
      className="history-tree"
      viewBox={`0 0 ${WIDTH} ${height}`}
      role="tree"
      aria-label="Possible histories"
      onMouseLeave={() => onHover(null)}
    >
      {([0, 1, 2, 3] as const).map((stage) => (
        <text key={stage} className="ht-stage" textAnchor="middle" x={COLUMNS[stage]} y={HEADER_Y}>
          {stage === 0 ? STAGE_LABELS[0] : `0${stage} ${STAGE_LABELS[stage]}`}
        </text>
      ))}

      {edges.map((n) => {
        const classes = ['ht-edge', hoverPath.has(n.id) ? 'is-hover' : '', selectedPath.has(n.id) ? 'is-path' : '']
        return <path key={n.id} className={classes.filter(Boolean).join(' ')} d={edge(at(n.parent!), at(n))} />
      })}

      {nodes.map((n) => {
        const { x, y } = at(n)
        const onPath = selectedPath.has(n.id)
        const isSelected = n === selected
        const leaf = n.children.length === 0
        // A parent well above this node sends its branch through the space over the dot, so the label sits below-left instead.
        const parentY = n.parent ? at(n.parent).y : y
        const labelBelow = !leaf && parentY < y - 24
        const label = n.rule?.label ?? 'Origin'
        const classes = [
          'ht-node',
          onPath ? 'is-path' : '',
          isSelected ? 'is-selected' : '',
          hoverPath.has(n.id) ? 'is-hover' : '',
        ]
        return (
          <g
            key={n.id}
            className={classes.filter(Boolean).join(' ')}
            transform={`translate(${x} ${y})`}
            role="treeitem"
            aria-selected={isSelected}
            aria-label={pathOf(n)
              .map((p) => p.rule?.label ?? 'Origin')
              .join(' → ')}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onSelect(n)}
            onMouseEnter={() => onHover(n)}
            onFocus={() => onHover(n)}
            onBlur={() => onHover(null)}
          >
            <circle className="ht-hit" r={HIT_R} />
            <circle className="ht-dot" r={NODE_R} />
            <text
              className="ht-label"
              textAnchor={leaf ? 'start' : labelBelow ? 'end' : 'middle'}
              dominantBaseline={leaf || labelBelow ? 'middle' : 'auto'}
              x={leaf ? 12 : labelBelow ? -12 : 0}
              y={leaf ? 0 : labelBelow ? 16 : -LABEL_ABOVE}
            >
              {label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
