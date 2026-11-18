import { BufferAttribute, BufferGeometry } from 'three'
import { landscapeHeight } from '../../project03/terrain.ts'
import { SITE, type StudySite } from '../site.ts'

/**
 * Style C's ground: the window at 2 m (the real height, the water's surface where it stands), and a coarse ring of the real island around it out to
 * the horizon, so the composition has a middle distance and a background rather than a diorama's edge. Each vertex carries:
 *   aWater  1 where water stands (drawn as water, at its surface)
 *   aDeep   1 in persistent shade: under a roof, or where the structures keep the sun off for most of the day
 */
const FAR = 1500

function grid(site: StudySite, x0: number, z0: number, size: number, step: number, hole: number | null): BufferGeometry {
  const n = Math.round(size / step) + 1
  const pos = new Float32Array(n * n * 3)
  const water = new Float32Array(n * n)
  const deep = new Float32Array(n * n)
  const near = hole === null
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const x = x0 + i * step
      const z = z0 + j * step
      const k = j * n + i
      const d = site.world.water.depthAt(x, z)
      // The far ring sits a little below the window so the two never fight where they meet.
      pos[k * 3] = x
      pos[k * 3 + 1] = landscapeHeight(x, z) + Math.max(0, d) - (near ? 0 : 0.4)
      pos[k * 3 + 2] = z
      water[k] = d > 0 ? 1 : 0
      if (near) deep[k] = site.ceilingAt(x, z) < Infinity || site.shadeAt(x, z) > 0.62 ? 1 : 0
    }
  }
  const index: number[] = []
  const inHole = (x: number, z: number) => hole !== null && Math.abs(x - SITE.cx) < hole && Math.abs(z - SITE.cz) < hole
  for (let j = 0; j + 1 < n; j += 1) {
    for (let i = 0; i + 1 < n; i += 1) {
      if (inHole(x0 + (i + 1) * step, z0 + (j + 1) * step) && inHole(x0 + i * step, z0 + j * step)) continue
      const a = j * n + i
      index.push(a, a + n, a + 1, a + 1, a + n, a + n + 1)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('aWater', new BufferAttribute(water, 1))
  g.setAttribute('aDeep', new BufferAttribute(deep, 1))
  g.setAttribute('aOcc', new BufferAttribute(new Float32Array(n * n), 1))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

/** Sets the ground's ambient occlusion (the clay view), or clears it. */
export function setOcc(geometry: BufferGeometry, occ: Float32Array | null) {
  const a = geometry.getAttribute('aOcc') as BufferAttribute
  if (occ) a.copyArray(occ)
  else (a.array as Float32Array).fill(0)
  a.needsUpdate = true
}

/** Replaces the window's deep shade (aDeep) with another rule, e.g. the cover of a different form. */
export function setDeep(geometry: BufferGeometry, deepAt: (x: number, z: number) => boolean) {
  const pos = geometry.getAttribute('position')
  const deep = geometry.getAttribute('aDeep') as BufferAttribute
  for (let v = 0; v < pos.count; v += 1) deep.setX(v, deepAt(pos.getX(v), pos.getZ(v)) ? 1 : 0)
  deep.needsUpdate = true
}

const cache = new WeakMap<StudySite, { near: BufferGeometry; far: BufferGeometry }>()
export function composeGround(site: StudySite) {
  let g = cache.get(site)
  if (!g) {
    g = {
      near: grid(site, SITE.cx - SITE.half, SITE.cz - SITE.half, SITE.half * 2, 2, null),
      far: grid(site, SITE.cx - FAR, SITE.cz - FAR, FAR * 2, 10, SITE.half - 10),
    }
    cache.set(site, g)
  }
  return g
}
