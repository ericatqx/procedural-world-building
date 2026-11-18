import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { BufferAttribute, BufferGeometry, Color, ConeGeometry, DataTexture, IcosahedronGeometry, InstancedMesh, LinearFilter, type Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three'
import { environment } from './environment.ts'
import { livingArchitecture } from './livingArchitecture.ts'
import { applyMist } from './mist.ts'
import { applyStyleFinish, specialiseStyle } from './visualStyle.ts'
import { coverageTexture, groundTexture, islandConditions, overlayTexture } from './vegCoverage.ts'
import { buildRegionFields, islandBuilder, islandSample, ISLAND, sampleField, TILE, type IslandFields, type RegionFields } from './vegFields.ts'
import { setGroundTexture, vegGround } from './vegGround.ts'
import { geologyTexture } from './terrainGeology.ts'
import { readHabitat, type Habitat } from './vegHabitat.ts'
import { ARCHETYPES, effective, emptyInstances, planTile, plantsAt, SPECS, zonesOf, type Archetype, type Conditions, type Instances, type Plan } from './vegPlants.ts'
import { setVegetation, vegetationState, type VegOverlay } from './vegStore.ts'
import { shared } from './vegShared.ts'
import { landscapeHeight } from './terrain.ts'
import type { World } from './world.ts'
import { loading } from './loading.ts'

/**
 * Shadow Ecology 0.3 — vegetation across the island, at three scales (rules in vegPlants.ts, fields in vegFields.ts):
 *   ground colour   the coverage map: an analysis overlay (vegGround.ts), drawn on the terrain only when the panel asks; off by default
 *   far clumps      within ~1 km of where you look: shrubs and tall plants drawn larger and sparser, from the island's fields
 *   individuals     the 96 m tiles around where you look (a ring of 3×3 in Explore, 5×5 in Approach): every plant, on 3 m fields,
 *                   with the architecture's footprint, shade and shelter (vegHabitat.ts) acting on them
 * Tiles are built as the view moves, one a frame, and kept while near; plants are instanced.
 */
const CAP: Record<Archetype, number> = { cover: 40000, shrub: 26000, tall: 9000 }
const FAR_TILE = 192

type Tile = { key: string; ti: number; tj: number; fields: RegionFields; habitat: Habitat | null; plans: Partial<Record<Archetype, Plan>>; overlay?: { mesh: Mesh; data: Uint8Array; texture: DataTexture } }

function unitGeometry(a: Archetype): BufferGeometry {
  if (a === 'tall') {
    const g = new ConeGeometry(1, 1, 7, 3)
    // A slight sway and taper, so the spires are not identical rods.
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i += 1) {
      const y = p.getY(i)
      p.setX(i, p.getX(i) * (1 + 0.25 * Math.sin(y * 5)) + 0.08 * Math.sin(y * 3 + p.getZ(i)))
    }
    g.translate(0, 0.5, 0)
    return g
  }
  // Lumpy mounds: a subdivided icosahedron with each vertex pushed in or out by a fixed amount.
  const g = new IcosahedronGeometry(1, a === 'shrub' ? 2 : 1)
  const p = g.getAttribute('position')
  for (let i = 0; i < p.count; i += 1) {
    const k = 0.78 + 0.44 * Math.abs(Math.sin(p.getX(i) * 7.3 + p.getZ(i) * 5.1 + p.getY(i) * 3.7))
    p.setXYZ(i, p.getX(i) * k, Math.max(0, p.getY(i)) * k * (a === 'shrub' ? 0.9 : 0.55), p.getZ(i) * k)
  }
  g.computeVertexNormals()
  return g
}

/** Conditions at a point in a tile: the fields, bilinear, with the architecture's habitat acting on the light and moisture. */
export const tileConditions = (fields: RegionFields, hab: Habitat | null) => (x: number, z: number, y: number): Conditions => {
  const r = fields.region
  const i = Math.min(r.n - 1, Math.max(0, Math.floor((x - r.x0) / r.cell)))
  const j = Math.min(r.n - 1, Math.max(0, Math.floor((z - r.z0) / r.cell)))
  const k = j * r.n + i
  const shade = hab ? sampleField(r, hab.shade, x, z) : 0
  const shelter = hab ? sampleField(r, hab.shelter, x, z) : 0
  const e = effective(sampleField(r, fields.light, x, z), sampleField(r, fields.moisture, x, z), shade, shelter)
  return { height: y, slope: sampleField(r, fields.slope, x, z), waterDepth: fields.waterDepth[k]!, waterDist: fields.waterDist[k]!, light: e.light, moisture: e.moisture, footprint: hab ? hab.footprint[k]! : 0, shade, shelter, x, z }
}

export const islandAt = (f: IslandFields) => (x: number, z: number, y: number): Conditions => {
  const i = Math.min(f.n - 1, Math.max(0, Math.floor((x - f.x0) / f.cell)))
  const j = Math.min(f.n - 1, Math.max(0, Math.floor((z - f.x0) / f.cell)))
  const k = j * f.n + i
  const e = effective(islandSample(f, f.light, x, z), islandSample(f, f.moisture, x, z), 0, 0)
  return { height: y, slope: islandSample(f, f.slope, x, z), waterDepth: f.waterDepth[k]!, waterDist: f.waterDist[k]!, light: e.light, moisture: e.moisture, footprint: 0, shade: 0, shelter: 0, x, z }
}

export function Vegetation({ world, root }: { world: World; root: RefObject<Group | null> }) {
  const camera = useThree((s) => s.camera)
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true })
    m.customProgramCacheKey = () => 'vegetation-sty'
    m.onBeforeCompile = (shader) => {
      applyMist(shader)
      // Visual Study 02's illustration modes only: the shrub mounds and tall spires take the same treatment as the plants (the presets leave them as they were).
      applyStyleFinish(shader, 'plant', true)
    }
    specialiseStyle(m)
    return m
  }, [])
  const geometries = useMemo(() => ({ cover: unitGeometry('cover'), shrub: unitGeometry('shrub'), tall: unitGeometry('tall') }), [])
  const meshes = useRef<Record<Archetype, InstancedMesh | null>>({ cover: null, shrub: null, tall: null })
  const buffers = useMemo(() => ({ cover: emptyInstances(CAP.cover), shrub: emptyInstances(CAP.shrub), tall: emptyInstances(CAP.tall) }), [])
  const dummy = useMemo(() => new Object3D(), [])
  const colour = useMemo(() => new Color(), [])
  const warm = useMemo(() => new Color('#b9a463'), [])
  const deep = useMemo(() => new Color('#2c5a40'), [])
  const island = useRef<{ fields: IslandFields; build: ReturnType<typeof islandBuilder>; done: boolean } | null>(null)
  const tiles = useRef(new Map<string, Tile>())
  const farPlans = useRef(new Map<string, Plan[]>())
  const overlayState = useRef<{ mode: VegOverlay | ''; show: boolean }>({ mode: '', show: false })
  const sig = useRef('')
  const lastKey = useRef('')
  const lastBuild = useRef(0)
  const clock = useRef(0)
  const dirty = useRef(true)
  const sunMean = useRef<[number, number]>([0, 1])
  const wanted = useRef<{ t1: string[]; inner: Set<string>; t2: { ti: number; tj: number }[]; box: [number, number, number, number] } | null>(null)
  const archGroup = useRef<Group | null>(null)
  shared.tiles = tiles.current

  // The island: its fields, built in slices, then its ground colour.
  useEffect(() => {
    const built = islandBuilder(world)
    island.current = { fields: built.fields, build: built, done: false }
    const started = performance.now()
    let live = true
    const run = () => {
      if (!live) return
      if (!built.step()) {
        window.setTimeout(run, 0)
        return
      }
      island.current!.done = true
      shared.island = built.fields
      const cover = coverageTexture(built.fields, world.seed)
      setGroundTexture('tint', cover, ISLAND.n)
      setGroundTexture('ground', groundTexture(built.fields, world.seed), ISLAND.n)
      const geo = geologyTexture(built.fields)
      setGroundTexture('geology', geo.geology, ISLAND.n)
      setGroundTexture('relief', geo.relief, ISLAND.n)
      vegGround.geologyOn.value = 1
      vegGround.origin.value = ISLAND.x0
      vegGround.size.value = ISLAND.n * ISLAND.cell
      overlayState.current = { mode: '', show: false }
      setVegetation({ ready: true, ms: { ...vegetationState().ms, island: performance.now() - started } })
    }
    // Under a loading cover (loading.ts) there is no first frame to keep smooth: start at once.
    window.setTimeout(run, loading.covered ? 0 : 300)
    return () => {
      live = false
      vegGround.tintOn.value = 0
      vegGround.groundOn.value = 0
      vegGround.geologyOn.value = 0
      vegGround.overlayOn.value = 0
      setVegetation({ ready: false })
    }
  }, [world])
  useEffect(
    () => () => {
      material.dispose()
      for (const g of Object.values(geometries)) g.dispose()
    },
    [material, geometries],
  )

  const ensureOverlayMesh = (t: Tile) => {
    if (t.overlay) return t.overlay
    const r = t.fields.region
    const n = r.n
    const g = new BufferGeometry()
    const pos = new Float32Array(n * n * 3)
    const uv = new Float32Array(n * n * 2)
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const k = j * n + i
        pos.set([r.x0 + (i + 0.5) * r.cell, t.fields.height[k]! + 0.5, r.z0 + (j + 0.5) * r.cell], k * 3)
        uv.set([(i + 0.5) / n, (j + 0.5) / n], k * 2)
      }
    }
    const index: number[] = []
    for (let j = 0; j < n - 1; j += 1) for (let i = 0; i < n - 1; i += 1) index.push(j * n + i, (j + 1) * n + i, j * n + i + 1, (j + 1) * n + i, (j + 1) * n + i + 1, j * n + i + 1)
    g.setAttribute('position', new BufferAttribute(pos, 3))
    g.setAttribute('uv', new BufferAttribute(uv, 2))
    g.setIndex(index)
    const data = new Uint8Array(n * n * 4)
    const texture = new DataTexture(data, n, n, RGBAFormat, UnsignedByteType)
    texture.colorSpace = SRGBColorSpace
    texture.magFilter = LinearFilter
    texture.minFilter = LinearFilter
    const mesh = new Mesh(g, new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))
    mesh.frustumCulled = false
    mesh.renderOrder = 4
    t.overlay = { mesh, data, texture }
    groupRef.current?.add(mesh)
    return t.overlay
  }
  const groupRef = useRef<Group | null>(null)
  const paintArchitecture = (t: Tile) => {
    const o = ensureOverlayMesh(t)
    const hab = t.habitat
    const n = t.fields.region.n
    for (let k = 0; k < n * n; k += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      if (hab) {
        // (Round 08C: Explore Data's palette, visualDiagnostics.ts › DIAG_COLOUR footprint, sheltered, shaded.)
        if (hab.footprint[k]! > 0) [r, g, b, a] = [0.69, 0.48, 0.37, 0.85]
        else if (hab.shelter[k]! > 0) [r, g, b, a] = [0.79, 0.69, 0.43, 0.75]
        else if (hab.shade[k]! > 0.02) [r, g, b, a] = [0.43, 0.56, 0.69, 0.2 + 0.6 * hab.shade[k]!]
      }
      o.data[k * 4] = Math.round(r * 255)
      o.data[k * 4 + 1] = Math.round(g * 255)
      o.data[k * 4 + 2] = Math.round(b * 255)
      o.data[k * 4 + 3] = Math.round(a * 255)
    }
    o.texture.needsUpdate = true
  }

  useFrame((_, delta) => {
    const st = vegetationState()
    const isl = island.current
    vegGround.tintOn.value = st.show && st.ready && st.coverage ? 1 : 0
    vegGround.groundOn.value = st.show && st.ready ? 1 : 0
    // The overlay map (habitat, light, moisture) is the island's, redrawn when the mode changes.
    if (isl?.done && (overlayState.current.mode !== st.overlay || !overlayState.current.show)) {
      overlayState.current = { mode: st.overlay, show: true }
      if (st.overlay === 'habitat' || st.overlay === 'light' || st.overlay === 'moisture') {
        setGroundTexture('overlay', overlayTexture(isl.fields, st.overlay), ISLAND.n)
        vegGround.overlayOn.value = 1
      } else vegGround.overlayOn.value = 0
    }
    const above = camera.position.y - landscapeHeight(camera.position.x, camera.position.z)
    for (const a of ARCHETYPES) {
      const m = meshes.current[a]
      if (m) m.visible = st.show && st.renderer === 'previous' && above < (a === 'cover' ? 520 : a === 'shrub' ? 1700 : 2700)
    }
    for (const t of tiles.current.values()) if (t.overlay) t.overlay.mesh.visible = st.overlay === 'architecture' && st.show
    if (!isl?.done || !st.show) return
    clock.current += delta
    if (clock.current < 0.1) return
    clock.current = 0

    // Where to build plants: the ground the camera is looking at (or stands on, near the ground).
    let fx = camera.position.x
    let fz = camera.position.z
    if (above > 40) {
      const dir = camera.getWorldDirection(dummy.position)
      let t = 0
      for (let s = 0; s < 34; s += 1) {
        t += 28
        const px = camera.position.x + dir.x * t
        const pz = camera.position.z + dir.z * t
        if (camera.position.y + dir.y * t < landscapeHeight(px, pz)) {
          fx = px
          fz = pz
          break
        }
      }
      // From a great height (the overview) the ground is further than that: take where the view meets the ground's mean level.
      if (fx === camera.position.x && dir.y < -0.02) {
        const tt = Math.min(7000, (camera.position.y - 30) / -dir.y)
        fx = camera.position.x + dir.x * tt
        fz = camera.position.z + dir.z * tt
      }
    }
    // The 3 m tiles (fields and the architecture's habitat) are for the earlier plants and the architecture overlay. The Lab plants
    // (WorldPlants.tsx) keep their own, so with them on, nothing is built here as the camera moves.
    const needTiles = st.renderer === 'previous' || st.overlay === 'architecture'
    const near = needTiles && above < 650
    const far = needTiles && above < 2200
    const ti0 = Math.floor(fx / TILE.size)
    const tj0 = Math.floor(fz / TILE.size)
    const radius = above < 60 ? 1 : 2
    const t1: string[] = []
    const inner = new Set<string>()
    if (near) {
      for (let dj = -radius; dj <= radius; dj += 1) {
        for (let di = -radius; di <= radius; di += 1) {
          const key = `${ti0 + di},${tj0 + dj}`
          t1.push(key)
          if (Math.abs(di) <= 1 && Math.abs(dj) <= 1) inner.add(key)
        }
      }
    }
    const box: [number, number, number, number] = near ? [(ti0 - radius) * TILE.size, (tj0 - radius) * TILE.size, (ti0 + radius + 1) * TILE.size, (tj0 + radius + 1) * TILE.size] : [0, 0, 0, 0]
    const fi0 = Math.floor(fx / FAR_TILE)
    const fj0 = Math.floor(fz / FAR_TILE)
    const t2: { ti: number; tj: number }[] = []
    if (far) for (let dj = -2; dj <= 2; dj += 1) for (let di = -2; di <= 2; di += 1) t2.push({ ti: fi0 + di, tj: fj0 + dj })
    wanted.current = { t1, inner, t2, box }
    shared.focus = { x: fx, z: fz, above, ready: true }
    // The focus's habitat, for the panel.
    const ic = islandConditions(isl.fields, Math.min(ISLAND.n - 1, Math.max(0, Math.floor((fx - ISLAND.x0) / ISLAND.cell))), Math.min(ISLAND.n - 1, Math.max(0, Math.floor((fz - ISLAND.x0) / ISLAND.cell))))
    const focusTile = tiles.current.get(`${ti0},${tj0}`)
    let here = ic
    if (focusTile) here = tileConditions(focusTile.fields, st.influence ? focusTile.habitat : null)(fx, fz, ic.height)
    // Round 03: the panel's reading of the focus, posted only when it changes as the panel shows it (every post re-renders the page, and this ran about ten times a second).
    const hereNext = { zones: zonesOf(here), light: here.light, moisture: here.moisture, slope: here.slope, height: here.height, shade: here.shade, shelter: here.shelter }
    const hereWas = st.here
    if (!hereWas || JSON.stringify(hereWas.zones) !== JSON.stringify(hereNext.zones) || Math.round(hereWas.light * 100) !== Math.round(hereNext.light * 100) || Math.round(hereWas.moisture * 100) !== Math.round(hereNext.moisture * 100) || Math.round(Math.atan(hereWas.slope) * 57.3) !== Math.round(Math.atan(hereNext.slope) * 57.3) || Math.round(hereWas.shade * 100) !== Math.round(hereNext.shade * 100) || hereWas.shelter !== hereNext.shelter)
      setVegetation({ here: hereNext })

    // Build one missing tile a frame; drop tiles that are far.
    // Nearest tiles first, two a tick (each takes about 15 ms).
    const todo = t1.filter((k) => !tiles.current.has(k)).sort((a, b) => {
      const d = (k: string) => {
        const [ti, tj] = k.split(',').map(Number) as [number, number]
        return Math.hypot(ti - fx / TILE.size + 0.5, tj - fz / TILE.size + 0.5)
      }
      return d(a) - d(b)
    })
    const missing = todo.length > 2 ? todo[2] : undefined
    let built = false
    for (const k of todo.slice(0, 2)) {
      const [ti, tj] = k.split(',').map(Number) as [number, number]
      const t0 = performance.now()
      const fields = buildRegionFields(world, (ti + 0.5) * TILE.size, (tj + 0.5) * TILE.size)
      tiles.current.set(k, { key: k, ti, tj, fields, habitat: root.current ? readHabitat(root.current, fields) : null, plans: {} })
      sunMean.current = fields.sunMean
      built = true
      setVegetation({ ms: { ...vegetationState().ms, tile: performance.now() - t0 }, tiles: tiles.current.size })
    }
    if (tiles.current.size > 40) {
      for (const [k, t] of tiles.current) {
        const [ti, tj] = k.split(',').map(Number) as [number, number]
        if (Math.abs(ti - ti0) > 4 || Math.abs(tj - tj0) > 4) {
          if (t.overlay) {
            groupRef.current?.remove(t.overlay.mesh)
            t.overlay.mesh.geometry.dispose()
            t.overlay.texture.dispose()
          }
          tiles.current.delete(k)
        }
      }
    }
    // What the architecture is doing to the ground: read again whenever what is drawn changes.
    const group = root.current
    let signature = 'none'
    if (group) {
      let parts = 0
      let verts = 0
      group.traverseVisible((o) => {
        const mesh = o as { isMesh?: boolean; geometry?: BufferGeometry; userData: Record<string, unknown> }
        if (mesh.isMesh && mesh.geometry && mesh.userData.habitat !== false) {
          parts += 1
          verts += mesh.geometry.getAttribute('position')?.count ?? 0
        }
      })
      signature = `${livingArchitecture.version}:${parts}:${verts}`
    }
    if (signature !== sig.current && group && !built) {
      sig.current = signature
      const t0 = performance.now()
      for (const t of tiles.current.values()) {
        t.habitat = readHabitat(group, t.fields)
        if (t.overlay) paintArchitecture(t)
      }
      archGroup.current = group
      shared.archVersion += 1
      setVegetation({ ms: { ...vegetationState().ms, habitat: performance.now() - t0 } })
      dirty.current = true
    }
    if (built) dirty.current = true
    const year = Math.round(environment.controls.year * 2) / 2
    const key = `${year}|${st.influence}|${st.overlay}|${ti0},${tj0},${radius},${near},${far}|${fi0},${fj0}|${tiles.current.size}`
    if (key === lastKey.current && !dirty.current) return
    if (performance.now() - lastBuild.current < 220 || missing) return
    lastBuild.current = performance.now()
    lastKey.current = key
    dirty.current = false
    const t0 = performance.now()
    // The Lab-plant renderer draws the plants; this one keeps the ground colour, the maps and the near tiles it reads.
    if (st.renderer === 'world') {
      if (st.overlay === 'architecture') for (const t of tiles.current.values()) paintArchitecture(t)
      setVegetation({ year })
      return
    }

    // Individuals: the detailed tiles.
    for (const a of ARCHETYPES) buffers[a].count = 0
    const counts: Record<Archetype, { now: number; other: number }> = { cover: { now: 0, other: 0 }, shrub: { now: 0, other: 0 }, tall: { now: 0, other: 0 } }
    for (const key2 of t1) {
      const tile = tiles.current.get(key2)
      if (!tile) continue
      const r = tile.fields.region
      const atNow = tileConditions(tile.fields, st.influence ? tile.habitat : null)
      const atOther = tileConditions(tile.fields, st.influence ? null : tile.habitat)
      for (const a of ARCHETYPES) {
        if (a === 'cover' && !inner.has(key2)) continue
        const plan = (tile.plans[a] ??= planTile(a, world.seed, r.x0, r.z0, TILE.size))
        counts[a].now += plantsAt(plan, atNow, tile.fields.sunMean, world.seed, year, buffers[a])
        if (tile.habitat) counts[a].other += plantsAt(plan, atOther, tile.fields.sunMean, world.seed, year, null)
        else counts[a].other = counts[a].now
      }
    }
    // Far clumps: larger and sparser, from the island's fields, where the detailed tiles are not.
    let farCount = 0
    const atFar = islandAt(isl.fields)
    const inBox = (x: number, z: number) => x >= box[0] && x < box[2] && z >= box[1] && z < box[3]
    for (const { ti, tj } of t2) {
      const k2 = `${ti},${tj}`
      let plans = farPlans.current.get(k2)
      if (!plans) {
        plans = [planTile('shrub', world.seed + 11, ti * FAR_TILE, tj * FAR_TILE, FAR_TILE, 9), planTile('tall', world.seed + 11, ti * FAR_TILE, tj * FAR_TILE, FAR_TILE, 14)]
        farPlans.current.set(k2, plans)
        if (farPlans.current.size > 120) farPlans.current.delete(farPlans.current.keys().next().value as string)
      }
      for (const plan of plans) farCount += plantsAt(plan, atFar, isl.fields.sunMean, world.seed, year, buffers[plan.arch], plan.arch === 'shrub' ? 1.5 : 1.35, near ? inBox : undefined)
    }
    for (const a of ARCHETYPES) {
      const mesh = meshes.current[a]
      const inst: Instances = buffers[a]
      if (!mesh) continue
      const spec = SPECS[a]
      const count = Math.min(inst.count, CAP[a])
      for (let i = 0; i < count; i += 1) {
        dummy.position.set(inst.x[i]!, inst.y[i]!, inst.z[i]!)
        if (a === 'tall') dummy.rotation.set(inst.leanZ[i]!, 0, -inst.leanX[i]!)
        else dummy.rotation.set(0, inst.yaw[i]!, 0)
        dummy.scale.set(inst.sx[i]!, inst.sy[i]!, inst.sx[i]! * (a === 'shrub' ? 0.8 + 0.3 * inst.tint[i]! : 1))
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        colour.set(spec.colour).offsetHSL(0, 0, (inst.tint[i]! - 0.5) * spec.tint)
        // Dry ground bleaches them toward straw; shade and the shore deepen them.
        colour.lerp(warm, 0.55 * inst.dry[i]!).lerp(deep, 0.45 * inst.deep[i]!)
        mesh.setColorAt(i, colour)
      }
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    if (st.overlay === 'architecture') for (const t of tiles.current.values()) paintArchitecture(t)
    // Posted only when the counts change (the page re-renders on every post); the update's own timing is not shown, so it waits for the next change.
    const was = vegetationState()
    if (JSON.stringify(was.counts) !== JSON.stringify(counts) || was.far !== farCount || was.year !== year) setVegetation({ counts, far: farCount, ms: { ...was.ms, update: performance.now() - t0 }, year })
  })
  return (
    <group ref={groupRef}>
      {ARCHETYPES.map((a) => (
        <instancedMesh key={a} ref={(m) => { meshes.current[a] = m }} args={[geometries[a], material, CAP[a]]} frustumCulled={false} receiveShadow />
      ))}
    </group>
  )
}
