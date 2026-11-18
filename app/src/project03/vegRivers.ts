import { riverEdges } from './rivers.ts'
import type { World } from './world.ts'

/**
 * Shadow Ecology 0.3 — where the rendered rivers are, for plants. The lakes' `depthAt` does not know the rivers (they are ribbons
 * laid on the carved ground), so this reads the same ribbon the water layer draws: each river's nodes with the shore distances its
 * mesh uses (plus the 1.1 m margin its edge columns reach past them), indexed on a grid. `riverEdge(x, z)` is the distance to the
 * nearest water's edge in metres: negative inside the ribbon.
 */
type Seg = { ax: number; az: number; bx: number; bz: number; wa: number; wb: number }
const CELL = 48

export function riverEdgeField(world: World): (x: number, z: number) => number {
  const grid = new Map<string, Seg[]>()
  const reach = 4
  for (const river of world.rivers.rivers) {
    const nodes = river.nodes
    const { left, right } = riverEdges(nodes)
    for (let k = 0; k + 1 < nodes.length; k += 1) {
      // The plunge's free fall has no ribbon under it.
      if (river.plunge && k >= river.plunge.from && k < river.plunge.to) continue
      const a = nodes[k]!
      const b = nodes[k + 1]!
      const wa = Math.max(left[k]!, right[k]!) + 1.1
      const wb = Math.max(left[k + 1]!, right[k + 1]!) + 1.1
      const seg = { ax: a.x, az: a.z, bx: b.x, bz: b.z, wa, wb }
      const r = Math.max(wa, wb) + reach
      for (let j = Math.floor((Math.min(a.z, b.z) - r) / CELL); j <= Math.floor((Math.max(a.z, b.z) + r) / CELL); j += 1) {
        for (let i = Math.floor((Math.min(a.x, b.x) - r) / CELL); i <= Math.floor((Math.max(a.x, b.x) + r) / CELL); i += 1) {
          const key = `${i},${j}`
          const list = grid.get(key)
          if (list) list.push(seg)
          else grid.set(key, [seg])
        }
      }
    }
  }
  return (x, z) => {
    const list = grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`)
    if (!list) return 99
    let best = 99
    for (const s of list) {
      const dx = s.bx - s.ax
      const dz = s.bz - s.az
      const len2 = dx * dx + dz * dz || 1
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / len2))
      const d = Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t)) - (s.wa + (s.wb - s.wa) * t)
      if (d < best) best = d
    }
    return best
  }
}
