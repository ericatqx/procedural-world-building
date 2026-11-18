import type { River } from './rivers.ts'
import type { World } from './world.ts'

/**
 * THE RIVER NETWORK'S TOPOLOGY, read from the generated hydrology (rivers.ts, water.ts), for what draws the flow (Explore's flow particles,
 * FlowParticles.tsx) and what explains it (the Project page's World Anatomy). Nothing is generated: the links are found the way the world's
 * renderer finds them (rivers.ts › riverGeometry): a river's tail within reach of another river's node is a junction; a tail in standing water
 * ends in that lake; a river whose first node is at a lake's outlet leaves that lake.
 */
export type Next = { kind: 'join'; river: number; node: number } | { kind: 'lake'; body: number } | { kind: 'rim' } | { kind: 'end' }
export type RiverNetwork = {
  rivers: River[]
  /** Each node's distance from its river's source, in metres. */
  along: Float32Array[]
  length: number[]
  next: Next[]
  /** The lake each river leaves by its outlet, or -1. */
  source: number[]
  /** The rivers that leave each lake by its outlet. */
  outflow: number[][]
}

const cache = new WeakMap<World, RiverNetwork>()

export function riverNetwork(world: World): RiverNetwork {
  const have = cache.get(world)
  if (have) return have
  const rivers = world.rivers.rivers.filter((r) => r.nodes.length >= 2)
  const bodies = world.water.bodies
  const along = rivers.map((r) => {
    const d = new Float32Array(r.nodes.length)
    for (let i = 1; i < r.nodes.length; i += 1) d[i] = d[i - 1]! + Math.hypot(r.nodes[i]!.x - r.nodes[i - 1]!.x, r.nodes[i]!.z - r.nodes[i - 1]!.z)
    return d
  })
  const length = along.map((d) => d[d.length - 1]!)
  const outflow = bodies.map(() => [] as number[])
  const source = rivers.map((r, ri) => {
    const b = bodies.findIndex((w) => Math.hypot(r.nodes[0]!.x - w.outlet.x, r.nodes[0]!.z - w.outlet.z) < 120)
    if (b >= 0) outflow[b]!.push(ri)
    return b
  })
  const next = rivers.map((r, ri): Next => {
    const tail = r.nodes[r.nodes.length - 1]!
    if (r.rim) return { kind: 'rim' }
    if (world.water.depthAt(tail.x, tail.z) > 0 || world.water.surfaceAt(tail.x, tail.z) !== null) {
      const b = bodies.findIndex((w) => tail.x >= w.bounds.minX - 60 && tail.x <= w.bounds.maxX + 60 && tail.z >= w.bounds.minZ - 60 && tail.z <= w.bounds.maxZ + 60)
      if (b >= 0) return { kind: 'lake', body: b }
    }
    let best: { river: number; node: number; d: number } | null = null
    rivers.forEach((m, mi) => {
      if (mi === ri) return
      m.nodes.forEach((n, ni) => {
        const d = Math.hypot(n.x - tail.x, n.z - tail.z)
        if (d < n.halfWidth + 12 && (!best || d < best.d)) best = { river: mi, node: ni, d }
      })
    })
    const b = best as { river: number; node: number; d: number } | null
    return b ? { kind: 'join', river: b.river, node: b.node } : { kind: 'end' }
  })
  const net = { rivers, along, length, next, source, outflow }
  cache.set(world, net)
  return net
}
