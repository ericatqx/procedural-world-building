import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, type MutableRefObject } from 'react'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RGBAFormat,
  ShaderMaterial,
  Vector3,
} from 'three'
import { sunAt } from '../project/sun.ts'
import { sunDirection } from '../shared/sun.ts'
import { environment } from './environment.ts'
import { livingArchitecture } from './livingArchitecture.ts'
import { styleUniforms } from './visualStyle.ts'
import { SunOrrery } from './Sky.tsx'
import { islandRadius, landscapeHeight, LANDSCAPE } from './terrain.ts'
import type { World } from './world.ts'

/**
 * FORMATION'S CONSTRUCTION LAYER. The /preview Project page's World Formation shows the island being generated, step by step. Everything drawn
 * here is a VISUALIZATION of the world's own data, read live from the same functions and structures the world uses (so it follows any change to
 * them), never a second generator:
 *   the terrain's height function (terrain.ts › landscapeHeight), sampled as a flat field, as coarse columns, as a wireframe grid and as a plain
 *   untextured surface. (The world's terrain is a chunked HEIGHTFIELD mesh, terrainMesh.ts; the columns only show coarse sampling, not voxels.)
 *   the lakes' own basins (water.ts › forEachWet: each wet node's depth below its lake's spill level), filling from the deepest point up;
 *   the rivers' own node chains (rivers.ts), at their own width, reaching from source to mouth in the order the hydrology connects them;
 *   the sun's own path over the day (project/sun.ts, shared/sun.ts), and the world's own stylized sun mark (Sky.tsx › SunOrrery), switched on.
 * It can also hide the real terrain and the Living Architecture while the construction stands in for them. Nothing here changes the world, and only
 * while a page turns it on (formation.ts); off, it draws nothing and builds nothing.
 *
 * Each value is 0 to 1:
 *   field    the height field, laid flat (all of it at once, faded in)
 *   voxels   the columns rising from it, coarse (one height per block of cells)
 *   refine   the columns refined, each block's one height becoming its cells' own (and `voxelFade` taking them away again)
 *   wire     the wireframe grid at the true heights
 *   neutral  the plain, untextured surface
 *   ground   the real terrain (0 hides it, and the island's sides)
 *   plain    the real terrain drawn as plain clay (1) or in its materials (0), the whole island at once; `show` brings it up out of the black
 *   worldWater  the world's own water (0 holds it back: hidden here, never by switching Explore's Water layer off)
 *   flow     the water's own order (waterSchedule): rivers reaching downstream, lakes filling as they are reached;  water  how strongly drawn
 *   life     the plants and animals (0 keeps them out of sight before their stages)
 *   sun      the sun mark and its path over the day
 *   architecture  the Living Architecture (0 hides it while its years are set back, so its earlier form never flashes)
 */
export const formationScene = { on: false, field: 0, voxels: 0, refine: 0, voxelFade: 0, wire: 0, neutral: 0, ground: 1, plain: 0, show: 1, groundCover: 1, worldWater: 1, flow: 0, water: 0, sun: 0, architecture: 1, life: 1 }
/** While the Living Architecture re-forms for a jump in its years (its meshes are rebuilt off the main thread), it stays hidden until this time
 *  (performance.now()), so a form from another year never flashes. */
export const architectureHold = { until: 0 }

// Neutral until the real terrain brings its own materials: greys of the page's ink, then the world's own teal for water and red for a spill point.
// The construction's one clay, the same grey the real terrain is drawn in before its materials (visualStyle.ts › uFormPlain), a little darker
// low and lighter high; lit by the sun alone as the plain terrain is, so nothing brightens or darkens as one stage gives way to the next.
const CLAY = new Color(0.6, 0.59, 0.565)
const LOW = CLAY.clone().multiplyScalar(0.78)
const HIGH = CLAY.clone().multiplyScalar(1.12)
const PLAIN = CLAY
// The water in the world's own colours (the Black Stage's water: visualStudyWorlds.ts › DIO_TEAL_SHALLOW, DIO_TEAL), shallow to deep as it draws
// them, so the construction's water hands over to the world's without a change of colour.
const WATER = new Color('#3E7A7B')
const WATER_DEEP = new Color('#1F4D52')
const INK = new Color('#E9E6DF')
const SUNLINE = new Color('#F2E4C4')

const HALF = LANDSCAPE.size / 2
// The world's renderer uses a logarithmic depth buffer (ShadowEcology03.tsx): these shaders write depth the same way, or the terrain hides them.
const LOG_V = '#include <common>\n#include <logdepthbuf_pars_vertex>\n'
const LOG_F = '#include <logdepthbuf_pars_fragment>\n'
const onIsland = (x: number, z: number) => Math.hypot(x, z) < islandRadius(Math.atan2(z, x))
const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

/** The height field on a grid over the whole square, built once on first use. */
function sampleHeights(n: number) {
  const h = new Float32Array(n * n)
  const land = new Uint8Array(n * n)
  let lo = Infinity
  let hi = -Infinity
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) {
      const x = -HALF + ((i + 0.5) / n) * LANDSCAPE.size
      const z = -HALF + ((j + 0.5) / n) * LANDSCAPE.size
      const k = j * n + i
      h[k] = landscapeHeight(x, z)
      land[k] = onIsland(x, z) ? 1 : 0
      if (land[k]) {
        lo = Math.min(lo, h[k]!)
        hi = Math.max(hi, h[k]!)
      }
    }
  return { n, h, land, lo, hi }
}

function buildField(n = 160) {
  const s = sampleHeights(n)
  const data = new Uint8Array(n * n * 4)
  for (let k = 0; k < n * n; k += 1) {
    const v = (s.h[k]! - s.lo) / Math.max(1, s.hi - s.lo)
    // The field as the seed gives it: dark low ground to pale high ground, the sea left empty.
    // (Unlit: drawn at the brightness the lit clay averages, 0.36 + 0.7 × a typical 0.55, so the columns rise out of it without a jump.)
    const c = LOW.clone().lerp(HIGH, Math.pow(v, 0.7)).multiplyScalar(0.74)
    data[k * 4] = Math.min(255, c.r * 255)
    data[k * 4 + 1] = Math.min(255, c.g * 255)
    data[k * 4 + 2] = Math.min(255, c.b * 255)
    data[k * 4 + 3] = s.land[k] ? 255 : 0
  }
  const texture = new DataTexture(data, n, n, RGBAFormat)
  texture.needsUpdate = true
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: { uMap: { value: texture }, uOpacity: { value: 0 }, uCells: { value: 64 } },
    vertexShader: `${LOG_V} varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
 #include <logdepthbuf_vertex>
 }`,
    fragmentShader: `${LOG_F}
      uniform sampler2D uMap; uniform float uOpacity; uniform float uCells; varying vec2 vUv;
      void main() {
        #include <logdepthbuf_fragment>
        vec4 c = texture2D(uMap, vec2(vUv.x, 1.0 - vUv.y));
        if (c.a < 0.5) discard;
        // The sampling grid, faintly: a field of values, cell by cell (the whole island at once: no sweep).
        vec2 g = abs(fract(vUv * uCells) - 0.5);
        float line = smoothstep(0.47, 0.5, max(g.x, g.y));
        gl_FragColor = vec4(c.rgb * (1.0 - 0.35 * line), uOpacity);
        #include <colorspace_fragment>
      }`,
  })
  const geometry = new PlaneGeometry(LANDSCAPE.size, LANDSCAPE.size)
  geometry.rotateX(-Math.PI / 2)
  return { geometry, material, texture }
}

/**
 * The columns: one per cell of a 72² grid, which first stand as coarse 3×3 blocks (each block at its cells' mean height, in coarser steps) and
 * are then refined, each cell moving from its block's height to its own. One mesh throughout, so coarse to fine is one continuous change.
 */
function buildVoxels(n = 72, block = 3) {
  const s = sampleHeights(n)
  const cell = LANDSCAPE.size / n
  const fine = 24
  const coarse = 64
  const base = Math.min(0, s.lo) - 6
  const range = Math.max(1, s.hi - s.lo)
  // Each block's mean height, over its land cells.
  const blocks = Math.ceil(n / block)
  const sum = new Float32Array(blocks * blocks)
  const count = new Uint16Array(blocks * blocks)
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i
      if (!s.land[k]) continue
      const b = Math.floor(j / block) * blocks + Math.floor(i / block)
      sum[b] += s.h[k]!
      count[b] += 1
    }
  const cells: { x: number; z: number; top: number; coarseTop: number; lag: number; color: Color; coarseColor: Color }[] = []
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i
      if (!s.land[k]) continue
      const b = Math.floor(j / block) * blocks + Math.floor(i / block)
      const mean = sum[b]! / count[b]!
      const v = (s.h[k]! - s.lo) / range
      const vc = (mean - s.lo) / range
      cells.push({
        x: -HALF + (i + 0.5) * cell,
        z: -HALF + (j + 0.5) * cell,
        top: Math.max(base + fine, Math.round(s.h[k]! / fine) * fine),
        coarseTop: Math.max(base + coarse, Math.round(mean / coarse) * coarse),
        // Everywhere at once, the higher blocks taking a little longer to reach their height (no sweep across the island).
        lag: vc * 0.3,
        color: LOW.clone().lerp(HIGH, 0.35 + 0.65 * v),
        coarseColor: LOW.clone().lerp(HIGH, 0.35 + 0.65 * vc),
      })
    }
  const geometry = new BoxGeometry(1, 1, 1)
  geometry.translate(0, 0.5, 0)
  // Lit as the plain terrain is (the sun alone: visualStyle.ts › uFormPlain), so the columns, the mesh and the clay ground are one material.
  const material = new ShaderMaterial({
    transparent: true,
    uniforms: { uSun: { value: new Vector3(0, 1, 0) }, uOpacity: { value: 1 } },
    vertexShader: `${LOG_V}
      varying vec3 vN; varying vec3 vC;
      void main() {
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = modelMatrix * instanceMatrix;
        #endif
        vN = normalize(mat3(m) * normal);
        vC = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vC = instanceColor;
        #endif
        gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `${LOG_F}
      uniform vec3 uSun; uniform float uOpacity; varying vec3 vN; varying vec3 vC;
      void main() {
        #include <logdepthbuf_fragment>
        // The sun, and a fixed key from high in the north-west so every face of a column reads apart from its neighbours: tops light, the
        // sides a step and two steps darker.
        vec3 n = normalize(vN);
        float l = max(dot(n, uSun), 0.0);
        float key = max(dot(n, normalize(vec3(-0.45, 0.8, -0.4))), 0.0);
        gl_FragColor = vec4(vC * (0.26 + 0.45 * l + 0.42 * key), uOpacity);
        #include <colorspace_fragment>
      }`,
  })
  const mesh = new InstancedMesh(geometry, material, cells.length)
  cells.forEach((c, i) => mesh.setColorAt(i, c.coarseColor))
  mesh.frustumCulled = false
  return { mesh, cells, cell, base, geometry, material, colored: -1 }
}

function buildWire(n = 112) {
  const s = sampleHeights(n)
  const cell = LANDSCAPE.size / n
  const pts: number[] = []
  const at = (i: number, j: number) => [-HALF + (i + 0.5) * cell, s.h[j * n + i]! + 2, -HALF + (j + 0.5) * cell]
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) {
      if (!s.land[j * n + i]) continue
      if (i + 1 < n && s.land[j * n + i + 1]) pts.push(...at(i, j), ...at(i + 1, j))
      if (j + 1 < n && s.land[(j + 1) * n + i]) pts.push(...at(i, j), ...at(i, j + 1))
    }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3))
  const material = new LineBasicMaterial({ color: INK, transparent: true, opacity: 0, depthWrite: false })
  return { lines: new LineSegments(geometry, material), geometry, material }
}

/** The height function as a plain surface, shaded but without any material of its own: sampled finely (about 24 m), close to the real mesh, so the
 *  real terrain's materials can be blended in over it without its shape changing. */
function buildSurface(n = 168) {
  const s = sampleHeights(n)
  const cell = LANDSCAPE.size / n
  const verts = new Float32Array(n * n * 3)
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) verts.set([-HALF + (i + 0.5) * cell, s.h[j * n + i]! + 1, -HALF + (j + 0.5) * cell], (j * n + i) * 3)
  const index: number[] = []
  for (let j = 0; j + 1 < n; j += 1)
    for (let i = 0; i + 1 < n; i += 1) {
      const a = j * n + i
      if (!s.land[a] || !s.land[a + 1] || !s.land[a + n] || !s.land[a + n + 1]) continue
      index.push(a, a + n, a + 1, a + 1, a + n, a + n + 1)
    }
  const surface = new BufferGeometry()
  surface.setAttribute('position', new BufferAttribute(verts, 3))
  surface.setIndex(index)
  surface.computeVertexNormals()
  const plain = new MeshStandardMaterial({ color: PLAIN, roughness: 1, metalness: 0, transparent: true, opacity: 0 })
  const mesh = new Mesh(surface, plain)
  mesh.frustumCulled = false
  return { mesh, surface, plain }
}

/** The sun's path over the day, as the world computes it, drawn faintly around the island at the stylized sun's own distance. */
const ORRERY_R = 2900
function buildSunPath() {
  const pts: number[] = []
  const noon = environment.controls.noonElevation
  for (let h = 5; h <= 19.001; h += 0.1) {
    const sun = sunAt(h, noon)
    if (sun.elevation < -1) continue
    const [dx, dy, dz] = sunDirection(sun.azimuth, sun.elevation)
    pts.push(dx * ORRERY_R, 60 + dy * ORRERY_R, dz * ORRERY_R)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3))
  const material = new LineBasicMaterial({ color: SUNLINE, transparent: true, opacity: 0, depthWrite: false })
  const line = new Line(geometry, material)
  line.frustumCulled = false
  return { line, geometry, material }
}

/**
 * THE WATER'S ORDER, from the world's own hydrology (rivers.ts, water.ts): when the water reaches each river node and each lake, on one clock
 * measured in meters at a steady pace. A curated order of what the world holds, not a simulation of flow:
 *   A stream's source starts by its height: the highest sources first, the low ones near the coast last (so no short coastal stream is
 *   complete before the island's main streams have begun). From its source the water runs downstream along the stream's own nodes.
 *   Where a tributary joins a larger stream, the water it brings runs on down that stream from the junction (if it gets there first).
 *   A lake begins to fill when the first water reaches it (a lake no stream reaches, by its own height, like a source), and rises for a time set
 *   by its size. A stream leaving a lake at its outlet starts only when that lake is full: its overflow, carried on downstream.
 */
function waterSchedule(world: World) {
  const rivers = world.rivers.rivers.filter((r) => r.nodes.length >= 2)
  const bodies = world.water.bodies
  // Each node's distance from its river's source.
  const along = rivers.map((r) => {
    const d = new Float32Array(r.nodes.length)
    for (let i = 1; i < r.nodes.length; i += 1) d[i] = d[i - 1]! + Math.hypot(r.nodes[i]!.x - r.nodes[i - 1]!.x, r.nodes[i]!.z - r.nodes[i - 1]!.z)
    return d
  })
  const longest = Math.max(1, ...along.map((d) => d[d.length - 1]!))
  const bodyNear = (x: number, z: number, margin: number) => {
    let best = -1
    let bestD = Infinity
    bodies.forEach((b, k) => {
      const { minX, maxX, minZ, maxZ } = b.bounds
      if (x < minX - margin || x > maxX + margin || z < minZ - margin || z > maxZ + margin) return
      const d = Math.hypot(x - b.x, z - b.z)
      if (d < bestD) {
        bestD = d
        best = k
      }
    })
    return best
  }
  // Which lake each river leaves (its first node at that lake's outlet), which it ends in, and which river it joins (and at which node).
  const leaves = rivers.map((r) => bodies.findIndex((b) => Math.hypot(r.nodes[0]!.x - b.outlet.x, r.nodes[0]!.z - b.outlet.z) < 120))
  const ends = rivers.map((r) => {
    const last = r.nodes[r.nodes.length - 1]!
    return world.water.depthAt(last.x, last.z) > 0 || world.water.surfaceAt(last.x, last.z) !== null ? bodyNear(last.x, last.z, 60) : -1
  })
  const joins = rivers.map((r, ri) => {
    if (ends[ri]! >= 0 || r.rim) return null
    const tail = r.nodes[r.nodes.length - 1]!
    let best: { river: number; node: number; d: number } | null = null
    rivers.forEach((m, mi) => {
      if (mi === ri) return
      m.nodes.forEach((n, ni) => {
        const d = Math.hypot(n.x - tail.x, n.z - tail.z)
        if (d < n.halfWidth + 12 && (!best || d < best.d)) best = { river: mi, node: ni, d }
      })
    })
    return best as { river: number; node: number; d: number } | null
  })

  // Sources by height: the highest start at once, the lowest after a spread of about half the longest stream.
  const levels = [...rivers.filter((_, r) => leaves[r]! < 0).map((r) => r.nodes[0]!.level), ...bodies.map((b) => b.level)]
  const top = Math.max(...levels, 1)
  const low = Math.min(...levels, 0)
  const spread = longest * 0.5
  const fromHeight = (level: number) => ((top - level) / Math.max(1, top - low)) * spread
  // A lake's filling, by its size, in the same units (meters at the water's pace).
  // (Long enough that a lake is seen to rise: the largest takes about as long as the water takes to run the longest stream.)
  const fill = bodies.map((b) => Math.max(500, Math.min(2600, 300 + Math.hypot(b.bounds.maxX - b.bounds.minX, b.bounds.maxZ - b.bounds.minZ) * 2.2)))

  const times = rivers.map((r) => new Float32Array(r.nodes.length))
  const lakeStart = bodies.map((b) => fromHeight(b.level))
  for (let pass = 0; pass < 16; pass += 1) {
    rivers.forEach((r, ri) => {
      const begin = leaves[ri]! >= 0 ? lakeStart[leaves[ri]!]! + fill[leaves[ri]!]! : fromHeight(r.nodes[0]!.level)
      const t = times[ri]!
      for (let i = 0; i < t.length; i += 1) t[i] = begin + along[ri]![i]!
    })
    // Tributaries carry their water on down the stream they join; repeated, so a chain of junctions passes it all the way down.
    for (let k = 0; k < 8; k += 1) {
      let changed = false
      joins.forEach((j, ri) => {
        if (!j) return
        const arrive = times[ri]![times[ri]!.length - 1]!
        const t = times[j.river]!
        const d = along[j.river]!
        for (let i = j.node; i < t.length; i += 1) {
          const v = arrive + d[i]! - d[j.node]!
          if (v < t[i]! - 0.5) {
            t[i] = v
            changed = true
          }
        }
      })
      if (!changed) break
    }
    bodies.forEach((b, bi) => {
      let first = Infinity
      rivers.forEach((_, ri) => {
        if (ends[ri] === bi) first = Math.min(first, times[ri]![times[ri]!.length - 1]!)
      })
      lakeStart[bi] = first === Infinity ? fromHeight(b.level) : first
    })
  }
  let total = 1
  times.forEach((t) => t.forEach((v) => (total = Math.max(total, v))))
  bodies.forEach((_, b) => (total = Math.max(total, lakeStart[b]! + fill[b]!)))
  return { rivers, times, lakeStart, fill, total }
}

/** The lakes as their own basins: a quad per wet node, each at the depth the water must reach before it is wet; each lake fills on its own time. */
function buildLakes(world: World, order: ReturnType<typeof waterSchedule>) {
  const cell = 16
  const seen = new Set<string>()
  const pos: number[] = []
  const depth: number[] = []
  const max: number[] = []
  const from: number[] = []
  const to: number[] = []
  const index = new Map(world.water.bodies.map((b, k) => [b, k]))
  world.water.forEachWet((x, z, d, body) => {
    const key = `${Math.round(x / cell)},${Math.round(z / cell)}`
    if (seen.has(key)) return
    seen.add(key)
    const k = index.get(body) ?? 0
    const a = order.lakeStart[k]! / order.total
    const b = (order.lakeStart[k]! + order.fill[k]!) / order.total
    const cx = Math.round(x / cell) * cell
    const cz = Math.round(z / cell) * cell
    const h = cell * 0.5 + 0.5
    for (const [qx, qz] of [
      [cx - h, cz - h],
      [cx + h, cz - h],
      [cx + h, cz + h],
      [cx - h, cz - h],
      [cx + h, cz + h],
      [cx - h, cz + h],
    ]) {
      pos.push(qx!, body.level + 0.4, qz!)
      depth.push(d)
      max.push(body.depth)
      from.push(a)
      to.push(b)
    }
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geometry.setAttribute('aDepth', new BufferAttribute(new Float32Array(depth), 1))
  geometry.setAttribute('aMax', new BufferAttribute(new Float32Array(max), 1))
  geometry.setAttribute('aFrom', new BufferAttribute(new Float32Array(from), 1))
  geometry.setAttribute('aTo', new BufferAttribute(new Float32Array(to), 1))
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // (Both sides: the quads above are wound clockwise seen from above, and drawn front-side only they were culled, so no lake ever showed.)
    side: DoubleSide,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: WATER }, uDeep: { value: WATER_DEEP } },
    vertexShader: `${LOG_V}
      attribute float aDepth; attribute float aMax; attribute float aFrom; attribute float aTo; uniform float uTime;
      varying float vDepth; varying float vLevel; varying float vMax;
      void main() {
        // The level rises steadily, slowing only as it nears the spill point (where the outlet then carries the overflow on).
        float f = clamp((uTime - aFrom) / max(0.0001, aTo - aFrom), 0.0, 1.0);
        f = 1.0 - (1.0 - f) * (1.0 - f);
        vDepth = aDepth; vMax = aMax;
        // The surface rises from the basin's deepest point to its spill level; the shore spreads as it does.
        vLevel = aMax * (1.0 - f);
        vec3 p = position; p.y -= vLevel;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `${LOG_F}
      uniform float uOpacity; uniform vec3 uColor; uniform vec3 uDeep; varying float vDepth; varying float vLevel; varying float vMax;
      void main() {
        #include <logdepthbuf_fragment>
        if (vLevel >= vMax - 0.001 || vDepth < vLevel) discard;
        // Shallow at the rising shore, deep over the basin, as the world's water is drawn.
        gl_FragColor = vec4(mix(uColor, uDeep, smoothstep(0.2, 2.5, vDepth - vLevel)), uOpacity);
        #include <colorspace_fragment>
      }`,
  })
  return { mesh: new Mesh(geometry, material), geometry, material }
}

/** The rivers as their own node chains, at their own width: each node appears when the water reaches it (waterSchedule), its front tapering. */
function buildRivers(order: ReturnType<typeof waterSchedule>) {
  const pos: number[] = []
  const when: number[] = []
  order.rivers.forEach((river, r) => {
    const nodes = river.nodes
    const times = order.times[r]!
    for (let i = 0; i < nodes.length - 1; i += 1) {
      const a = nodes[i]!
      const b = nodes[i + 1]!
      const dx = b.x - a.x
      const dz = b.z - a.z
      const len = Math.max(0.001, Math.hypot(dx, dz))
      const nx = -dz / len
      const nz = dx / len
      const wa = Math.max(a.halfWidth, 1)
      const wb = Math.max(b.halfWidth, 1)
      const ta = times[i]! / order.total
      const tb = times[i + 1]! / order.total
      const v = [
        [a.x + nx * wa, a.level + 0.3, a.z + nz * wa, ta],
        [a.x - nx * wa, a.level + 0.3, a.z - nz * wa, ta],
        [b.x + nx * wb, b.level + 0.3, b.z + nz * wb, tb],
        [b.x - nx * wb, b.level + 0.3, b.z - nz * wb, tb],
      ]
      for (const k of [0, 1, 2, 1, 3, 2]) {
        const p = v[k]!
        pos.push(p[0]!, p[1]!, p[2]!)
        when.push(p[3]!)
      }
    }
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geometry.setAttribute('aWhen', new BufferAttribute(new Float32Array(when), 1))
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: WATER } },
    vertexShader: `${LOG_V} attribute float aWhen; varying float vWhen; void main() { vWhen = aWhen; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
 #include <logdepthbuf_vertex>
 }`,
    fragmentShader: `${LOG_F}
      uniform float uTime; uniform float uOpacity; uniform vec3 uColor; varying float vWhen;
      void main() {
        #include <logdepthbuf_fragment>
        // The front of the water: a short taper where it has only just arrived.
        float a = clamp((uTime - vWhen) / 0.006, 0.0, 1.0);
        if (a <= 0.0) discard;
        gl_FragColor = vec4(uColor, uOpacity * (0.35 + 0.65 * a));
        #include <colorspace_fragment>
      }`,
  })
  return { mesh: new Mesh(geometry, material), geometry, material }
}

type Built = {
  sunPath: ReturnType<typeof buildSunPath>
  field: ReturnType<typeof buildField>
  voxels: ReturnType<typeof buildVoxels>
  wire: ReturnType<typeof buildWire>
  surface: ReturnType<typeof buildSurface>
  lakes: ReturnType<typeof buildLakes>
  rivers: ReturnType<typeof buildRivers>
}

/** What the layer has built (for inspecting it in the browser's console; read only). */
export const formationBuilt: { current: unknown } = { current: null }

const matrix = new Matrix4()
const mixed = new Color()

/** Mounted in the world's scene (LandscapeView.tsx). `ground` holds the terrain and the island's sides, `architecture` the Living Architecture,
 *  `life` the plants and animals, `water` the world's own water: each hidden while the construction stands in for it, or before its stage. */
export function FormationLayer({
  world,
  ground,
  architecture,
  life,
  water,
}: {
  world: World
  ground: MutableRefObject<Group | null>
  architecture: MutableRefObject<Group | null>
  life: MutableRefObject<Group | null>
  water: MutableRefObject<Group | null>
}) {
  const root = useRef<Group>(null)
  const sunMark = useRef<Group>(null)
  const built = useRef<Built | null>(null)
  const last = useRef('')
  // Built on first use (the layer is mounted afresh for each world: LandscapeView keys it by seed); dropped with it.
  useEffect(
    () => () => {
      const b = built.current
      if (!b) return
      b.field.geometry.dispose()
      b.field.material.dispose()
      b.field.texture.dispose()
      b.voxels.geometry.dispose()
      b.voxels.material.dispose()
      b.wire.geometry.dispose()
      b.wire.material.dispose()
      b.surface.surface.dispose()
      b.surface.plain.dispose()
      b.sunPath.geometry.dispose()
      b.sunPath.material.dispose()
      b.lakes.geometry.dispose()
      b.lakes.material.dispose()
      b.rivers.geometry.dispose()
      b.rivers.material.dispose()
    },
    [],
  )

  useFrame(() => {
    const f = formationScene
    // What of the world itself is shown. Every frame, from formationScene alone: nothing here depends on what an earlier frame or page did.
    const showGround = !f.on || f.ground > 0
    const showArchitecture = !f.on || (f.architecture > 0 && performance.now() >= architectureHold.until)
    const showLife = !f.on || f.life > 0
    const showWater = !f.on || f.worldWater > 0
    // (Showing or hiding what casts shadows is a change the shadow map must see: it is otherwise only redrawn when something it shows changes.)
    for (const [g, on, casts] of [
      [ground.current, showGround, true],
      [architecture.current, showArchitecture, true],
      [life.current, showLife, true],
      [water.current, showWater, false],
    ] as const) {
      if (!g || g.visible === on) continue
      g.visible = on
      if (casts) livingArchitecture.version += 1
    }
    if (sunMark.current) sunMark.current.visible = f.on && f.sun > 0
    // The real terrain as plain clay, and how far up out of the black (visualStyle.ts): only while the construction is on.
    styleUniforms.uFormPlain.value = f.on ? f.plain : 0
    styleUniforms.uFormShow.value = f.on ? f.show : 1
    styleUniforms.uFormGround.value = f.on ? f.groundCover : 1
    const group = root.current
    if (!group) return
    if (!f.on) {
      if (group.visible) group.visible = false
      return
    }
    group.visible = true
    let b = built.current
    if (!b) {
      const order = waterSchedule(world)
      b = { field: buildField(), voxels: buildVoxels(), wire: buildWire(), surface: buildSurface(), lakes: buildLakes(world, order), rivers: buildRivers(order), sunPath: buildSunPath() }
      built.current = b
      formationBuilt.current = b
      const plane = new Mesh(b.field.geometry, b.field.material)
      plane.position.y = 1
      plane.renderOrder = 1
      plane.frustumCulled = false
      group.add(plane, b.voxels.mesh, b.wire.lines, b.surface.mesh, b.lakes.mesh, b.rivers.mesh, b.sunPath.line)
      b.lakes.mesh.renderOrder = 2
      b.rivers.mesh.renderOrder = 3
      b.lakes.mesh.frustumCulled = false
      b.rivers.mesh.frustumCulled = false
      b.wire.lines.frustumCulled = false
    }
    const key = `${f.field.toFixed(3)}|${f.voxels.toFixed(3)}|${f.refine.toFixed(3)}|${f.voxelFade.toFixed(3)}|${f.wire.toFixed(3)}|${f.neutral.toFixed(3)}|${f.ground}|${f.flow.toFixed(4)}|${f.water.toFixed(3)}|${f.sun.toFixed(3)}`
    if (key === last.current) return
    last.current = key

    // The flat field, all of it at once; it gives way as the columns rise out of it.
    const fieldOpacity = f.field * (1 - smooth((f.voxels - 0.15) / 0.45))
    b.field.material.uniforms.uOpacity!.value = fieldOpacity
    const plane = group.children[0]!
    plane.visible = fieldOpacity > 0.001

    const v = b.voxels
    const [sx, sy, sz] = environment.state.sun.direction
    v.material.uniforms.uSun!.value.set(sx, sy, sz).normalize()
    v.mesh.visible = f.voxels > 0 && f.voxelFade < 1
    if (v.mesh.visible) {
      const fade = smooth(f.voxelFade)
      const refine = smooth(f.refine)
      v.material.uniforms.uOpacity!.value = 1 - fade
      // (Writing depth until they are gone: nothing behind shows through a half-faded column.)
      v.material.depthWrite = true
      v.cells.forEach((c, i) => {
        // Rising together (higher blocks a little later), each at its block's height and then its own: coarse to fine, one continuous change.
        const rise = smooth((f.voxels - c.lag) / (1 - 0.3))
        const top = c.coarseTop + (c.top - c.coarseTop) * refine
        // (A little narrower than its cell: a fine gap between columns, so they read as blocks.)
        matrix.makeScale(v.cell * 0.9, Math.max(0.01, (top - v.base) * rise), v.cell * 0.9)
        matrix.setPosition(c.x, v.base, c.z)
        v.mesh.setMatrixAt(i, matrix)
      })
      v.mesh.instanceMatrix.needsUpdate = true
      // Their shading follows, block by block to cell by cell (only while it changes).
      const shade = Math.round(refine * 40)
      if (shade !== v.colored && v.mesh.instanceColor) {
        v.colored = shade
        v.cells.forEach((c, i) => v.mesh.setColorAt(i, mixed.copy(c.coarseColor).lerp(c.color, refine)))
        v.mesh.instanceColor.needsUpdate = true
      }
    }

    b.wire.material.opacity = 0.55 * f.wire
    b.wire.lines.visible = f.wire > 0.001
    // The plain surface; once the real terrain is under it, it only fades (writing no depth), so the terrain's materials come through it evenly.
    const plain = smooth(f.neutral)
    b.surface.plain.opacity = plain
    b.surface.plain.depthWrite = plain > 0.5 && f.ground === 0
    b.surface.mesh.visible = plain > 0.001

    b.sunPath.material.opacity = 0.32 * f.sun
    b.sunPath.line.visible = f.sun > 0.001

    b.lakes.material.uniforms.uTime!.value = f.flow
    b.lakes.material.uniforms.uOpacity!.value = 0.92 * f.water
    b.lakes.mesh.visible = f.water > 0.001 && f.flow > 0
    b.rivers.material.uniforms.uTime!.value = f.flow
    b.rivers.material.uniforms.uOpacity!.value = 0.95 * f.water
    b.rivers.mesh.visible = f.water > 0.001 && f.flow > 0
  })

  return (
    <>
      <group ref={root} visible={false} />
      {/* The world's own stylized sun (otherwise not drawn: LandscapeView.tsx › SHOW_SUN), shown while Formation asks for it. */}
      <group ref={sunMark} visible={false}>
        <SunOrrery />
      </group>
    </>
  )
}
