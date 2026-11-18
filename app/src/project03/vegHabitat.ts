import { Mesh, Sphere, Vector3, type InstancedMesh, type Object3D } from 'three'
import { sampleField, type Region, type RegionFields } from './vegFields.ts'

/**
 * Shadow Ecology 0.3 — what a structure does to the ground around it, as three rasters over the vegetation's region. This is the
 * whole interface between Living Architecture and vegetation:
 *
 *   footprint  the structure stands here (nothing grows on it)
 *   shelter    something stands over the ground here, clear of it: roofed, out of the rain and the open sky
 *   shade      the share of the day's sun the structure keeps off the ground here
 *
 * It is read from whatever is drawn under a scene-graph root (the architecture's group), vertex by vertex, so it holds for any
 * architecture variant, present or future, and for any number of structures: nothing asks which variant it is or where its
 * parts are. A structure that grows or recedes changes what is drawn, so it changes these.
 */
export type Habitat = {
  footprint: Float32Array
  shelter: Float32Array
  shade: Float32Array
  /** Metres of clear air between the ground and the lowest part of the structure over each cell: 0 where it stands, Infinity where nothing is over it. A plant taller than this does not fit. */
  ceiling: Float32Array
  vertices: number
  ms: number
}

export const emptyHabitat = (region: Region): Habitat => ({ footprint: new Float32Array(region.n * region.n), shelter: new Float32Array(region.n * region.n), shade: new Float32Array(region.n * region.n), ceiling: new Float32Array(region.n * region.n).fill(Infinity), vertices: 0, ms: 0 })

/** Above this height over the ground, a part is a roof, not a footprint (meters). */
const CLEARANCE = 2.5

/**
 * Cells the footprint ring encloses become footprint too. Flood from the region's border through empty cells; whatever
 * that flood cannot reach is inside a solid base. An undercroft open to the outside stays reachable, so it is not filled.
 */
function enclose(foot: Float32Array, n: number) {
  const outside = new Uint8Array(n * n)
  const stack: number[] = []
  const push = (k: number) => {
    if (k < 0 || k >= n * n || outside[k] || foot[k]! > 0) return
    outside[k] = 1
    stack.push(k)
  }
  for (let i = 0; i < n; i += 1) {
    push(i)
    push((n - 1) * n + i)
    push(i * n)
    push(i * n + (n - 1))
  }
  while (stack.length > 0) {
    const k = stack.pop()!
    const i = k % n
    const j = (k - i) / n
    if (i > 0) push(k - 1)
    if (i + 1 < n) push(k + 1)
    if (j > 0) push(k - n)
    if (j + 1 < n) push(k + n)
  }
  // Only the cells near the base. A ring that happens to meet the tile edge must not claim the rest of the tile.
  const dist = new Int16Array(n * n).fill(-1)
  const queue: number[] = []
  for (let k = 0; k < n * n; k += 1) {
    if (foot[k]! <= 0) continue
    dist[k] = 0
    queue.push(k)
  }
  for (let head = 0; head < queue.length; head += 1) {
    const k = queue[head]!
    const d = dist[k]!
    if (d >= 12) continue
    const i = k % n
    const j = (k - i) / n
    const step = (nk: number) => {
      if (dist[nk] !== -1) return
      dist[nk] = d + 1
      queue.push(nk)
    }
    if (i > 0) step(k - 1)
    if (i + 1 < n) step(k + 1)
    if (j > 0) step(k - n)
    if (j + 1 < n) step(k + n)
  }
  for (let k = 0; k < n * n; k += 1) if (!outside[k] && foot[k]! <= 0 && dist[k]! > 0) foot[k] = 1
}

export function readHabitat(root: Object3D, fields: RegionFields): Habitat {
  const started = performance.now()
  const { region, suns } = fields
  const { n } = region
  const foot = new Uint8Array(n * n)
  const roof = new Uint8Array(n * n)
  const low = new Float32Array(n * n).fill(Infinity)
  const shadow = new Float32Array(n * n * suns.length)
  const p = new Vector3()
  let vertices = 0
  const visit = (x: number, y: number, z: number) => {
    const i = Math.floor((x - region.x0) / region.cell)
    const j = Math.floor((z - region.z0) / region.cell)
    const ground = i >= 0 && j >= 0 && i < n && j < n ? fields.height[j * n + i]! : sampleField(region, fields.height, x, z)
    const h = y - ground
    // A base sunk into a slope still occupies that ground. Only what is clearly buried is ignored.
    if (h < -2.5) return
    vertices += 1
    if (i >= 0 && j >= 0 && i < n && j < n) {
      if (h < CLEARANCE) foot[j * n + i] = 1
      else roof[j * n + i] = 1
      if (h < low[j * n + i]!) low[j * n + i] = Math.max(0, h)
    }
    // The shadow this point throws on the ground, along each of the day's sun directions.
    for (let s = 0; s < suns.length; s += 1) {
      const d = suns[s]!
      const t = h / d[1]
      const si = Math.floor((x - d[0] * t - region.x0) / region.cell)
      const sj = Math.floor((z - d[2] * t - region.z0) / region.cell)
      if (si >= 0 && sj >= 0 && si < n && sj < n) shadow[(sj * n + si) * suns.length + s] = 1
    }
  }
  root.updateWorldMatrix(true, true)
  // Only what can reach this region: a part's bounding sphere, grown by how far a shadow can fall.
  const reach = Math.hypot(region.n * region.cell) / 2 + 90
  const sphere = new Sphere()
  root.traverseVisible((obj) => {
    const mesh = obj as Mesh
    // The community marks hover over the ground in the same group and are shown only from high up: not a structure (see LivingArchitecture.tsx).
    if (!mesh.isMesh || !mesh.geometry || mesh.userData.habitat === false) return
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
    sphere.copy(mesh.geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld)
    if (Math.hypot(sphere.center.x - region.cx, sphere.center.z - region.cz) > reach + sphere.radius) return
    const pos = mesh.geometry.getAttribute('position')
    if (!pos) return
    const inst = (obj as InstancedMesh).isInstancedMesh ? (obj as InstancedMesh) : null
    if (inst) return // instanced parts are not read (none of the architecture's are)
    const m = mesh.matrixWorld
    for (let v = 0; v < pos.count; v += 1) {
      p.set(pos.getX(v), pos.getY(v), pos.getZ(v)).applyMatrix4(m)
      visit(p.x, p.y, p.z)
    }
  })
  // Fill the gaps between vertices: a cell is touched if a neighbour is.
  const grow = (src: Uint8Array) => {
    const out = new Float32Array(n * n)
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        let hit = 0
        for (let dj = -1; dj <= 1 && !hit; dj += 1) for (let di = -1; di <= 1; di += 1) if (src[Math.min(n - 1, Math.max(0, j + dj)) * n + Math.min(n - 1, Math.max(0, i + di))]) hit = 1
        out[j * n + i] = hit
      }
    }
    return out
  }
  const footprint = grow(foot)
  // The vertex samples hit the shell, not the solid interior. Fill cells the base ring encloses, so plants do not stand inside it.
  enclose(footprint, n)
  const shelter = grow(roof)
  for (let k = 0; k < n * n; k += 1) if (footprint[k]) shelter[k] = 0
  // The clear air under the structure: the lowest part over a cell or its neighbours (a cell holds only the vertices that fell in it),
  // and none where it stands.
  const ceiling = new Float32Array(n * n).fill(Infinity)
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      let m = Infinity
      for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) m = Math.min(m, low[Math.min(n - 1, Math.max(0, j + dj)) * n + Math.min(n - 1, Math.max(0, i + di))]!)
      ceiling[j * n + i] = footprint[j * n + i] ? 0 : m
    }
  }
  const shade = new Float32Array(n * n)
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      let sum = 0
      for (let s = 0; s < suns.length; s += 1) {
        let hit = 0
        for (let dj = -1; dj <= 1 && !hit; dj += 1) {
          for (let di = -1; di <= 1; di += 1) {
            const ii = Math.min(n - 1, Math.max(0, i + di))
            const jj = Math.min(n - 1, Math.max(0, j + dj))
            if (shadow[(jj * n + ii) * suns.length + s]) hit = 1
          }
        }
        sum += hit
      }
      shade[j * n + i] = suns.length ? sum / suns.length : 0
    }
  }
  return { footprint, shelter, shade, ceiling, vertices, ms: performance.now() - started }
}
