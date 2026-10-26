import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferAttribute, BufferGeometry, DoubleSide, type Mesh, MeshBasicMaterial, MeshStandardMaterial, Raycaster, Vector2, Vector3 } from 'three'
import { wetness, worldTime } from './environment.ts'
import { buildColony, livingArchitecture, skin } from './livingArchitecture.ts'
import { growColony } from './livingGrowth.ts'
import { growColony2 } from './livingGrowth2.ts'
import { growColony3 } from './livingGrowth3.ts'
import { LATE_FROM, organismState, type Link, type Population } from './livingEcology.ts'
import { fieldOptionsFromUrl, growField } from './livingField.ts'
import { growNetwork } from './livingNetwork.ts'
import { growStrata, strataOptionsFromUrl } from './livingStrata.ts'
import { growOverhang, overhangOptionsFromUrl } from './livingOverhang.ts'
import { growOverhang2 } from './livingOverhang2.ts'
import { growOverhang3 } from './livingOverhang3.ts'
import { buildCoarse, buildGrown, buildVoxel, buildOrganism, loadPopulation, organismAt, setViewpoint, type CoarseBuilt, type OverhangBuilt } from './livingOverhangAsync.ts'
import { createGrownDepthMaterial, createGrownMaterial, createLoftDepthMaterial, createLoftMaterial } from './livingMaterial.ts'
import { loftAt, loftGeometry, loftUniforms, planLoft } from './livingLoft.ts'
import { TICKS, voxelMesh, type VoxelOrganism } from './livingVoxel.ts'
import { anchor, select, setPopulation, useLiving, type Selection } from './livingSelection.ts'
import { applyMist } from './mist.ts'
import { landscapeHeight } from './terrain.ts'
import type { World } from './world.ts'

/**
 * Living Architecture in the scene. The default, the Overhang, is a population (livingEcology.ts): each organism grown
 * and re-meshed off the main thread (livingWorker.ts), each at its own lifecycle age and later-life state for the world's
 * time (livingTime.ts), with root connections between those that have fused, and each selectable for inspection. The
 * comparison builds are single colonies built here, as before. Everything takes the sun, shadows, mist and rain like the
 * terrain does, and darkens a little when wet.
 */
export type ArchitectureVariant = 'off' | 'grown2' | 'grown2x' | 'grown3' | 'grown3b' | 'grown3c' | 'network' | 'field' | 'strata' | 'overhang' | 'overhang2' | 'overhang3' | 'growth' | 'reveal' | 'voxel' | 'grown' | 'composed'

const MATURE = 10
/** How far an organism's state moves before it is re-meshed: lifecycle age before maturity, metres of later life after. */
const REMESH = { age: 0.004, metres: 0.12, regen: 0.03 }
const WORKERS = typeof Worker !== 'undefined'

export function LivingArchitecture({ world, variant }: { world: World; variant: ArchitectureVariant }) {
  const visible = variant !== 'off'
  // 'grown2' is the sheet-economy prototype. 'grown' (limbs and ribs) and 'composed' (hand-built Hall, Gate and
  // Pavilion) are kept for comparison; the page chooses them with ?architecture=grown|composed, Experiment 1 (structural cost and finite water) with ?architecture=grown2x, and Experiment 2a (growth on exposed faces) with ?architecture=grown3, and Experiment 2b (Grown3 with a slenderness limit) with ?architecture=grown3b, and Experiment 3a (persistent scaffold, a dry spell, regrowth) with ?architecture=grown3c, and P0 (a structural growth network with differential accretion, not a Grown3 variant) with ?architecture=network, and Volumetric P1 (growth as a field) with ?architecture=field (optional &steps=60, &yaw=30, &v=1), and Strata Stage 1 (interlocking living strata) with ?architecture=strata (optional &epochs=6, &v=1, and ablations &light=0, &structure=0, &recede=0), and the Overhang (form-first, one monumental organism) with ?architecture=overhang (optional &v=1), its macro-form revision with ?architecture=overhang2, and the final lifecycle-guided revision with ?architecture=overhang3 (both optional &v=1).
  const lifecycle = variant === 'overhang3' && WORKERS
  const growth = variant === 'reveal' && WORKERS
  const lofted = variant === 'growth'
  const voxel = variant === 'voxel' && WORKERS
  const colony = useMemo(() => {
    if (variant === 'off' || lifecycle || growth || lofted || voxel || variant === 'reveal' || variant === 'voxel') return null
    const built = variant === 'grown2' ? growColony2(world, world.seed) : variant === 'grown2x' ? growColony2(world, world.seed, { structural: true }) : variant === 'grown3' ? growColony3(world, world.seed) : variant === 'grown3b' ? growColony3(world, world.seed, { slender: true }) : variant === 'grown3c' ? growColony3(world, world.seed, { scaffold: true }) : variant === 'network' ? growNetwork(world, world.seed) : variant === 'field' ? growField(world, world.seed, fieldOptionsFromUrl()) : variant === 'strata' ? growStrata(world, world.seed, strataOptionsFromUrl()) : variant === 'overhang' ? growOverhang(world, world.seed, overhangOptionsFromUrl()) : variant === 'overhang2' ? growOverhang2(world, world.seed, overhangOptionsFromUrl()) : variant === 'overhang3' ? growOverhang3(world, world.seed, overhangOptionsFromUrl()) : variant === 'grown' ? growColony(world, world.seed) : buildColony(world, world.seed)
    if (built.stats) console.info(`[living architecture] ${variant}`, built.stats)
    return built
  }, [world, variant, lifecycle, growth, lofted, voxel])
  const grown2 = variant === 'grown2' || variant === 'grown2x' || variant === 'grown3' || variant === 'grown3b' || variant === 'grown3c' || variant === 'network' || variant === 'field' || variant === 'strata' || variant === 'overhang' || variant === 'overhang2' || variant === 'overhang3' || variant === 'growth' || variant === 'reveal' || variant === 'voxel'
  const material = useMemo(() => {
    // Grown2 reads the growth record on its vertices; the comparison builds keep the plain vertex-coloured material.
    if (grown2) return createGrownMaterial()
    const next = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: DoubleSide })
    next.customProgramCacheKey = () => 'living-architecture'
    next.onBeforeCompile = (shader) => applyMist(shader)
    return next
  }, [grown2])
  useFrame(() => material.color.setScalar(1 - 0.16 * wetness.value))
  // The shadow map is only redrawn when something it shows changes: showing or hiding the colony is one.
  useEffect(() => {
    livingArchitecture.version += 1
  }, [colony])
  useEffect(() => () => colony?.geometry.dispose(), [colony])
  useEffect(() => () => material.dispose(), [material])
  if (lifecycle) return <LivingPopulation world={world} visible={visible} />
  if (growth) return <GrowthPrototype world={world} visible={visible} />
  if (lofted) return <LoftedGrowth world={world} visible={visible} />
  if (voxel) return <VoxelGrowth world={world} visible={visible} />
  if (!colony) return null
  return <mesh geometry={colony.geometry} material={material} castShadow receiveShadow visible={visible} />
}

/**
 * The voxel growth prototype (?architecture=voxel, see livingVoxel.ts): LA-01 grown as connected occupancy in the worker (about a
 * second, once), and shown as the surface of its occupancy at LEVELS ages. The surfaces are made one at a time as frames allow
 * (the one for the age on screen first, then the rest outward from it) and kept; the age on screen shows the nearest one made,
 * so scrubbing and playback never blank it. LA-01's own age at the world's time drives it; `&age=0.5` holds one (0 to 1).
 */
const LEVELS = 40
function VoxelGrowth({ world, visible }: { world: World; visible: boolean }) {
  const [plan, setLocal] = useState<Population | null>(null)
  const [org, setOrg] = useState<VoxelOrganism | null>(null)
  useEffect(() => {
    let live = true
    loadPopulation(world.seed).then((p) => {
      if (!live) return
      setLocal(p)
      setPopulation(p)
      select({ kind: 'organism', index: 0 })
    })
    buildVoxel(world.seed).then((o) => {
      if (!live) return
      console.info('[living architecture] voxel growth', o.stats)
      setOrg(o)
    })
    return () => {
      live = false
      setPopulation(null)
    }
  }, [world])
  const age = useMemo(() => ({ value: 1 }), [])
  const material = useMemo(() => createGrownMaterial(age), [age])
  useEffect(() => () => material.dispose(), [material])
  const levels = useRef<(BufferGeometry | null)[]>(Array.from({ length: LEVELS }, () => null))
  const shown = useRef(-1)
  const times = useRef<number[]>([])
  useEffect(
    () => () => {
      for (const g of levels.current) g?.dispose()
      levels.current = Array.from({ length: LEVELS }, () => null)
      shown.current = -1
    },
    [org],
  )
  const held = useMemo(() => {
    const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('age')
    return asked === null ? null : Math.max(0, Math.min(1, Number(asked)))
  }, [])
  const mesh = useRef<Mesh | null>(null)
  useFrame(() => {
    const m = mesh.current
    if (!m || !org) return
    material.color.setScalar(1 - 0.16 * wetness.value)
    const st = plan ? organismState(plan, 0, worldTime()) : null
    const now = held ?? (st && st.present ? Math.min(1, st.age) : 0)
    const show = visible && (held !== null || (st?.present ?? false))
    if (m.visible !== show) {
      m.visible = show
      livingArchitecture.version += 1
    }
    age.value = now
    const want = Math.round(now * (LEVELS - 1))
    const make = (l: number) => {
      const t0 = performance.now()
      levels.current[l] = voxelMesh(org, Math.round((l * (TICKS - 1)) / (LEVELS - 1)), plan?.organisms[0]?.base.moisture ?? 0.5)
      times.current.push(performance.now() - t0)
    }
    // One surface a frame: the one wanted, else the nearest missing one (outward from it).
    if (!levels.current[want]) make(want)
    else {
      for (let d = 1; d < LEVELS; d += 1) {
        const a = want - d
        const b = want + d
        if (a >= 0 && !levels.current[a]) {
          make(a)
          break
        }
        if (b < LEVELS && !levels.current[b]) {
          make(b)
          break
        }
      }
    }
    // The nearest one made at or below the age wanted (or above, if none below).
    let use = -1
    for (let l = want; l >= 0 && use < 0; l -= 1) if (levels.current[l]) use = l
    for (let l = want + 1; l < LEVELS && use < 0; l += 1) if (levels.current[l]) use = l
    if (use >= 0 && use !== shown.current) {
      shown.current = use
      m.geometry = levels.current[use]!
      livingArchitecture.version += 1
    }
    if (times.current.length === LEVELS) {
      console.info('[living architecture] voxel surfaces', { levels: LEVELS, meanMs: Math.round(times.current.reduce((a, b) => a + b, 0) / LEVELS), maxMs: Math.round(Math.max(...times.current)) })
      times.current.push(0)
    }
  })
  if (!org) return null
  return <mesh ref={mesh} material={material} castShadow receiveShadow visible={false} frustumCulled={false} />
}

/**
 * The lofted growth prototype (?architecture=growth, see livingLoft.ts): LA-01 as a skeleton of closed lofted parts that grow
 * and thicken in the vertex shader. Made once on the main thread (milliseconds, from LA-01's real conditions and its
 * neighbours), never rebuilt. `&age=0.4` holds an age; otherwise LA-01's own age at the world's time, so World Time
 * scrubs and plays it. (?architecture=reveal keeps the first prototype, which reveals the mature surface.)
 */
function LoftedGrowth({ world, visible }: { world: World; visible: boolean }) {
  const [plan, setLocal] = useState<Population | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let live = true
    loadPopulation(world.seed).then((p) => {
      if (!live) return
      setLocal(p)
      setPopulation(p)
      select({ kind: 'organism', index: 0 })
      setReady(true)
    })
    return () => {
      live = false
      setPopulation(null)
    }
  }, [world])
  const built = useMemo(() => {
    if (!ready) return null
    const t0 = performance.now()
    const loft = planLoft(world, world.seed, plan)
    const geometry = loftGeometry(loft, plan?.organisms[0]?.base.moisture ?? 0.5)
    const uniforms = loftUniforms(loft)
    console.info('[living architecture] lofted growth', { ...loft.stats, vertices: geometry.getAttribute('position').count, triangles: (geometry.index?.count ?? 0) / 3, buildMs: Math.round(performance.now() - t0) })
    return { geometry, loft, uniforms }
  }, [ready, world, plan])
  const age = useMemo(() => ({ value: 1 }), [])
  const material = useMemo(() => (built ? createLoftMaterial(age, built.uniforms) : null), [age, built])
  const depth = useMemo(() => (built ? createLoftDepthMaterial(built.uniforms) : null), [built])
  useEffect(
    () => () => {
      built?.geometry.dispose()
    },
    [built],
  )
  useEffect(
    () => () => {
      material?.dispose()
      depth?.dispose()
    },
    [material, depth],
  )
  // `&age=1.8` holds an age (0 to 3: 1 is the reference form).
  const held = useMemo(() => {
    const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('age')
    return asked === null ? null : Math.max(0, Math.min(3.2, Number(asked)))
  }, [])
  const mesh = useRef<Mesh | null>(null)
  const last = useRef(-1)
  useFrame(() => {
    const m = mesh.current
    if (!m || !built || !material) return
    material.color.setScalar(1 - 0.16 * wetness.value)
    const st = plan ? organismState(plan, 0, worldTime()) : null
    const now = held ?? (st && st.present ? Math.min(3.2, st.age) : 0)
    const show = held !== null || (st?.present ?? false)
    if (m.visible !== show) {
      m.visible = show
      livingArchitecture.version += 1
    }
    age.value = now
    // The nodes' radii for the age: a few hundred numbers, written in place; the mesh is never touched.
    loftAt(built.loft, now, built.uniforms)
    if (Math.abs(now - last.current) > 0.004) {
      last.current = now
      livingArchitecture.version += 1
    }
  })
  if (!built || !material || !depth) return null
  return <mesh ref={mesh} geometry={built.geometry} material={material} customDepthMaterial={depth} castShadow receiveShadow visible={visible} frustumCulled={false} />
}

/**
 * The first continuous-growth prototype (?architecture=reveal): LA-01 alone, from ONE mesh. It is the mature reference mesh with, for
 * every vertex, the age its tissue arrives and how far inside the surface the tissue's middle lies; the growth shader draws only
 * what has arrived by the organism's age and the newest tissue collapsed to its middle, so shelves extend and thicken and the
 * keep rises as the age runs, with no mesh rebuilt, swapped or dissolved, at any speed of playback. The age is LA-01's own at
 * the world's time (World Time drives it, so scrubbing and fifty years a second work), or `&age=0.4` holds one.
 */
function GrowthPrototype({ world, visible }: { world: World; visible: boolean }) {
  const [grown, setGrown] = useState<CoarseBuilt | null>(null)
  const [plan, setLocal] = useState<Population | null>(null)
  useEffect(() => {
    let live = true
    loadPopulation(world.seed).then((p) => {
      if (!live) return
      setLocal(p)
      // LA-01 is the one organism here: selected, so its card and "Look closer" are there.
      setPopulation(p)
      select({ kind: 'organism', index: 0 })
    })
    buildGrown(world.seed).then((g) => {
      if (!live) return
      console.info('[living architecture] growth prototype', g.stats)
      setGrown({ geometry: g.geometry, site: [0, 0], ground: 0, height: 0 })
    })
    return () => {
      live = false
      setPopulation(null)
    }
  }, [world])
  const uniforms = useMemo(() => ({ age: { value: 1 }, pick: { value: 0 }, dissolve: { value: 2 }, grow: { value: 1 } }), [])
  const material = useMemo(() => createGrownMaterial(uniforms.age, uniforms.pick, uniforms.dissolve, uniforms.grow), [uniforms])
  const depth = useMemo(() => createGrownDepthMaterial(uniforms.age, uniforms.grow), [uniforms])
  useEffect(
    () => () => {
      material.dispose()
      depth.dispose()
    },
    [material, depth],
  )
  const held = useMemo(() => {
    const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('age')
    return asked === null ? null : Math.max(0, Math.min(1, Number(asked)))
  }, [])
  const mesh = useRef<Mesh | null>(null)
  const last = useRef(-1)
  useFrame(() => {
    material.color.setScalar(1 - 0.16 * wetness.value)
    const m = mesh.current
    if (!m || !grown) return
    const st = plan ? organismState(plan, 0, worldTime()) : null
    const age = held ?? (st && st.present ? Math.min(1, st.age) : 0)
    const show = held !== null || (st?.present ?? false)
    if (m.visible !== show) {
      m.visible = show
      livingArchitecture.version += 1
    }
    uniforms.age.value = age
    // The shadow map is redrawn only when the organism has grown a little: a visible step in its shadow, not every frame.
    if (Math.abs(age - last.current) > 0.004) {
      last.current = age
      livingArchitecture.version += 1
    }
  })
  if (!grown) return null
  return <mesh ref={mesh} geometry={grown.geometry} material={material} customDepthMaterial={depth} castShadow receiveShadow visible={visible} frustumCulled={false} />
}

/** The population: its plan from the worker, an organism for each, a connection for each fusion, and the picker. */
function LivingPopulation({ world, visible }: { world: World; visible: boolean }) {
  const [population, setPlan] = useState<Population | null>(null)
  useEffect(() => {
    let live = true
    loadPopulation(world.seed).then((plan) => {
      if (!live) return
      console.info('[living architecture] population', { organisms: plan.organisms.length, links: plan.links.length, fieldMs: plan.fieldMs, simMs: plan.simMs })
      setPlan(plan)
      setPopulation(plan)
    })
    return () => {
      live = false
      setPopulation(null)
    }
  }, [world])
  const { selection } = useLiving()
  const [meshes] = useState(() => new Map<string, Mesh>())
  if (!population) return null
  return (
    <group visible={visible}>
      {population.organisms.map((o) => (
        <Organism key={o.id} world={world} population={population} index={o.index} selected={selection?.kind === 'organism' && selection.index === o.index} meshes={meshes} />
      ))}
      {population.links.map((link, i) => (
        <Connection key={`${link.a}-${link.b}`} population={population} link={link} index={i} selected={selection?.kind === 'link' && selection.index === i} meshes={meshes} />
      ))}
      <Picker meshes={meshes} />
      <ViewTracker />
      <CommunityMarks population={population} />
      <AnchorTracker population={population} selection={selection} meshes={meshes} visible={visible} />
    </group>
  )
}

const tops = new WeakMap<BufferGeometry, Vector3>()
/** The top of a geometry's bounds, at the middle of its footprint, in its own coordinates (worked out once per mesh). */
function topOf(geometry: BufferGeometry): Vector3 {
  let top = tops.get(geometry)
  if (!top) {
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    top = new Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2)
    tops.set(geometry, top)
  }
  return top
}

/** Each frame, where the selection stands on screen (its top, or the middle of a connection), for the card beside it. */
function AnchorTracker({ population, selection, meshes, visible }: { population: Population; selection: Selection; meshes: Map<string, Mesh>; visible: boolean }) {
  const { camera, size } = useThree()
  const point = useMemo(() => new Vector3(), [])
  useEffect(() => () => void (anchor.visible = false), [])
  useFrame(() => {
    anchor.visible = false
    if (!selection || !visible) return
    if (selection.kind === 'organism') {
      const m = meshes.get(`o${selection.index}`)
      if (!m || !m.visible) return
      point.copy(topOf(m.geometry)).applyMatrix4(m.matrixWorld)
    } else {
      const l = population.links[selection.index]!
      const a = population.organisms[l.a]!
      const b = population.organisms[l.b]!
      const x = (a.x + b.x) / 2
      const z = (a.z + b.z) / 2
      point.set(x, landscapeHeight(x, z) + 3, z)
    }
    point.project(camera)
    if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1.05 || Math.abs(point.y) > 1.05) return
    anchor.x = ((point.x + 1) / 2) * size.width
    anchor.y = ((1 - point.y) / 2) * size.height
    anchor.visible = true
  })
  return null
}

type Shown = { age: number; grow: number; recede: number; regen: number }

/** A grown material with its own lifecycle age, selection and dissolve (each mesh, and each connection, has its own). */
function tissue(): MeshStandardMaterial {
  const uniforms = { age: { value: MATURE }, pick: { value: 0 }, dissolve: { value: 2 } }
  const material = createGrownMaterial(uniforms.age, uniforms.pick, uniforms.dissolve)
  material.userData.uniforms = uniforms
  return material
}
function setUniform(material: MeshStandardMaterial, name: 'age' | 'pick' | 'dissolve', value: number) {
  ;(material.userData.uniforms as Record<string, { value: number }>)[name]!.value = value
}

/**
 * Communities, from far away. At the island's scale one organism is a few pixels, but a colony (a founder and its recruits)
 * is a group: a pale, soft mark on the ground under and around each present member, which overlap and merge where members
 * stand close, so a colony reads as one silhouette and an isolated organism as a single small mark. It is one mesh of a few
 * hundred triangles, redrawn as the world's years pass, and fades out as the camera comes down to where the organisms
 * themselves can be seen.
 */
function CommunityMarks({ population }: { population: Population }) {
  const camera = useThree((state) => state.camera)
  const material = useMemo(() => new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), [])
  const mesh = useRef<Mesh | null>(null)
  const drawn = useRef(-1e9)
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => void mesh.current?.geometry.dispose(), [])
  useFrame(() => {
    const m = mesh.current
    if (!m) return
    const height = camera.position.y - 80
    const fade = Math.min(1, Math.max(0, (height - 500) / 1400))
    material.opacity = 0.85 * fade
    const show = fade > 0.01
    if (m.visible !== show) m.visible = show
    if (!show) return
    const time = worldTime()
    const key = Math.floor(time / 4)
    if (key === drawn.current) return
    drawn.current = key
    const present = population.organisms.filter((_, i) => i === 0 || organismState(population, i, time).present)
    const old = m.geometry
    m.geometry = marksGeometry(present.map((o) => ({ x: o.x, z: o.z, r: o.radius })))
    old.dispose()
  })
  return <mesh ref={mesh} material={material} renderOrder={2} frustumCulled={false} receiveShadow={false} />
}

function marksGeometry(members: { x: number; z: number; r: number }[]): BufferGeometry {
  const SIDES = 20
  const positions: number[] = []
  const colours: number[] = []
  const index: number[] = []
  for (const m of members) {
    const R = m.r * 2.1
    const base = positions.length / 3
    // A centre and two rings: opaque-ish in the middle, fading to nothing at the edge.
    const ring = [[0, 0.62], [0.55, 0.46], [1, 0]] as const
    for (const [k, alpha] of ring) {
      for (let i = 0; i < (k === 0 ? 1 : SIDES); i += 1) {
        const a = (i / SIDES) * Math.PI * 2
        const x = m.x + Math.cos(a) * R * k
        const z = m.z + Math.sin(a) * R * k
        positions.push(x, landscapeHeight(x, z) + 24, z)
        colours.push(0.92, 0.88, 0.76, alpha)
      }
    }
    for (let i = 0; i < SIDES; i += 1) {
      const n = (i + 1) % SIDES
      const r1 = base + 1
      const r2 = base + 1 + SIDES
      index.push(base, r1 + i, r1 + n)
      index.push(r1 + i, r2 + i, r1 + n, r1 + n, r2 + i, r2 + n)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  g.setAttribute('color', new BufferAttribute(new Float32Array(colours), 4))
  g.setIndex(index)
  return g
}

/**
 * Tells the worker where the view is (about once a second, and only when it has moved), so the organisms still waiting for
 * their fine mesh are refined nearest the view first. The view is where the camera looks at the ground.
 */
function ViewTracker() {
  const camera = useThree((state) => state.camera)
  const last = useRef({ x: 1e9, z: 1e9, at: 0 })
  const dir = useMemo(() => new Vector3(), [])
  useFrame(() => {
    const now = performance.now()
    if (now - last.current.at < 800) return
    last.current.at = now
    camera.getWorldDirection(dir)
    const p = camera.position
    const reach = dir.y < -0.05 ? Math.min(6000, Math.max(0, (p.y - landscapeHeight(p.x, p.z)) / -dir.y)) : 300
    const x = p.x + dir.x * reach
    const z = p.z + dir.z * reach
    if (Math.hypot(x - last.current.x, z - last.current.z) < 60) return
    last.current.x = x
    last.current.z = z
    setViewpoint(x, z)
  })
  return null
}

/** The size a young organism is shown at while only its coarse form is there: its mature form, grown to scale (in steps, so it is not redrawn every frame). */
const youngScale = (age: number) => Math.round((age >= 1 ? 1 : Math.pow(Math.max(0.2, age), 0.8)) * 50) / 50
/** Seconds one mesh takes to dissolve into the next. */
const DISSOLVE = 0.45

type Face = { geometry: BufferGeometry | null; owned: boolean; kind: 'coarse' | 'mature' | 'stage'; age: number; state: Shown | null; scale: number; pos: [number, number, number] }
const none = (): Face => ({ geometry: null, owned: false, kind: 'coarse', age: 0, state: null, scale: 1, pos: [0, 0, 0] })
/** Where a coarse mesh sits when it is grown to scale `k` about the organism's base. */
const coarsePos = (c: CoarseBuilt, k: number): [number, number, number] => [c.site[0] * (1 - k), c.ground * (1 - k), c.site[1] * (1 - k)]

/**
 * One organism, drawn by two meshes: the one in front (what it looks like now) and, for under half a second after a change,
 * the one it is dissolving out of. A new mesh (coarse at first, then the mature or the stage mesh) never replaces the old by
 * a swap: it takes over pixel by pixel (see createGrownMaterial's dissolve), so nothing flashes, and the coarse form is
 * never drawn again once a fine mesh has been. Each mesh is drawn for the age it was made for, not for the world's age of
 * the moment, which at fifty years a second runs far ahead of any mesh the worker can grow; it asks for a new stage only when
 * the organism has moved a step (a bigger step for those far from the camera, nearest first) and one at a time, and a mesh
 * that arrives for an organism that has been rebuilt since is thrown away.
 */
function Organism({ world, population, index, selected, meshes }: { world: World; population: Population; index: number; selected: boolean; meshes: Map<string, Mesh> }) {
  const camera = useThree((state) => state.camera)
  const [built, setBuilt] = useState<OverhangBuilt | null>(null)
  const [coarse, setCoarse] = useState<CoarseBuilt | null>(null)
  useEffect(() => {
    let live = true
    buildCoarse(world.seed, index).then((b) => {
      if (live) setCoarse(b)
    })
    buildOrganism(world, world.seed, population, index).then((b) => {
      if (!live) return
      if (index === 0) console.info('[living architecture] overhang3', b.stats)
      setBuilt(b)
    })
    return () => {
      live = false
    }
  }, [world, population, index])
  const frontMaterial = useMemo(() => tissue(), [])
  const backMaterial = useMemo(() => tissue(), [])
  useEffect(
    () => () => {
      frontMaterial.dispose()
      backMaterial.dispose()
    },
    [frontMaterial, backMaterial],
  )
  const front = useRef<Mesh | null>(null)
  const back = useRef<Mesh | null>(null)
  const face = useRef<{ front: Face; back: Face; t: number }>({ front: none(), back: none(), t: 1 })
  const asking = useRef(false)
  const epoch = useRef(0)
  const here = useMemo(() => new Vector3(population.organisms[index]!.x, camera.position.y, population.organisms[index]!.z), [population, index, camera])
  // A new build (another seed): the meshes it made are gone.
  useEffect(
    () => () => {
      const f = face.current
      for (const x of [f.front, f.back]) if (x.owned) x.geometry?.dispose()
      face.current = { front: none(), back: none(), t: 1 }
      epoch.current += 1
    },
    [built],
  )

  /** Puts `next` on the front mesh; what was there goes behind it and dissolves out. */
  const swap = (next: Face) => {
    const f = face.current
    if (f.back.owned && f.back.geometry !== f.front.geometry) f.back.geometry?.dispose()
    const b = back.current
    const m = front.current
    if (!m || !b) return
    if (f.front.geometry) {
      f.back = f.front
      b.geometry = f.back.geometry!
      b.scale.setScalar(f.back.scale)
      b.position.set(...f.back.pos)
      setUniform(backMaterial, 'age', f.back.age)
      setUniform(backMaterial, 'dissolve', -0.001)
      b.visible = true
    } else f.back = none()
    f.front = next
    m.geometry = next.geometry!
    m.scale.setScalar(next.scale)
    m.position.set(...next.pos)
    setUniform(frontMaterial, 'age', next.age)
    setUniform(frontMaterial, 'dissolve', 0)
    f.t = 0
    m.visible = true
    livingArchitecture.version += 1
  }

  useFrame((_, delta) => {
    frontMaterial.color.setScalar(1 - 0.16 * wetness.value)
    backMaterial.color.setScalar(1 - 0.16 * wetness.value)
    setUniform(frontMaterial, 'pick', selected ? 1 : 0)
    setUniform(backMaterial, 'pick', selected ? 1 : 0)
    const m = front.current
    const b = back.current
    if (!m || !b) return
    const f = face.current
    // The dissolve in progress.
    if (f.t < 1) {
      f.t = Math.min(1, f.t + delta / DISSOLVE)
      if (f.t >= 1) {
        setUniform(frontMaterial, 'dissolve', 2)
        b.visible = false
        if (f.back.owned && f.back.geometry !== f.front.geometry) f.back.geometry?.dispose()
        f.back = none()
        livingArchitecture.version += 1
      } else {
        setUniform(frontMaterial, 'dissolve', f.t)
        setUniform(backMaterial, 'dissolve', -Math.max(0.001, f.t))
      }
    }
    const st = organismState(population, index, worldTime())
    if (!st.present) {
      if (m.visible || b.visible) {
        m.visible = false
        b.visible = false
        livingArchitecture.version += 1
      }
      return
    }
    if (f.front.geometry && !m.visible) {
      m.visible = true
      if (f.t < 1) b.visible = true
      livingArchitecture.version += 1
    }
    const late = st.age >= LATE_FROM
    const mature = st.age >= 1 && !late
    const k = youngScale(st.age)
    // A coarse mesh is drawn grown to the size of its age (in steps) until a fine one has been.
    const sizeNow = late ? 1 : k
    if (f.front.kind === 'coarse' && f.front.geometry && coarse && f.front.scale !== sizeNow) {
      f.front.scale = sizeNow
      f.front.pos = coarsePos(coarse, sizeNow)
      m.scale.setScalar(sizeNow)
      m.position.set(...f.front.pos)
      livingArchitecture.version += 1
    }
    if (!built) {
      if (coarse && !f.front.geometry) swap({ geometry: coarse.geometry, owned: false, kind: 'coarse', age: st.age, state: null, scale: sizeNow, pos: coarsePos(coarse, sizeNow) })
      return
    }
    if (mature) {
      // The mature form (for the reference organism, its reference form) is the built mesh itself.
      if (f.front.geometry !== built.geometry) swap({ geometry: built.geometry, owned: false, kind: 'mature', age: 1, state: null, scale: 1, pos: [0, 0, 0] })
      return
    }
    // Young or in later life: the mesh for its state, asked of the worker. Until it comes the mesh in front stays.
    const want: Shown = { age: st.age, grow: st.grow, recede: st.recede, regen: st.regen }
    const s = f.front.kind === 'stage' ? f.front.state : null
    // How big a step of state is worth a new mesh: the farther the organism from the camera, the bigger.
    const far = camera.position.distanceTo(here)
    const stepAge = Math.min(0.08, 0.012 + far / 50000)
    const stepM = Math.min(0.8, 0.12 + far / 8000)
    const moved = !s || (late ? Math.abs(want.grow - s.grow) > stepM || Math.abs(want.recede - s.recede) > stepM || Math.abs(want.regen - s.regen) > REMESH.regen || s.age < LATE_FROM : Math.abs(want.age - s.age) > stepAge || s.age >= LATE_FROM)
    if (asking.current || !moved) return
    asking.current = true
    const asked = epoch.current
    organismAt(built.key, Math.min(want.age, 1.5), late ? { grow: want.grow, recede: want.recede, regen: want.regen } : undefined, far).then((geometry) => {
      asking.current = false
      // Not wanted: the organism was rebuilt since.
      if (!front.current || asked !== epoch.current) {
        geometry.dispose()
        return
      }
      swap({ geometry, owned: true, kind: 'stage', age: Math.min(want.age, 1.5), state: want, scale: 1, pos: [0, 0, 0] })
    })
  })
  return (
    <>
      <mesh ref={back} material={backMaterial} receiveShadow visible={false} />
      <mesh
        ref={(m) => {
          front.current = m
          if (m) {
            m.userData.pick = { kind: 'organism', index } satisfies Selection
            meshes.set(`o${index}`, m)
          } else meshes.delete(`o${index}`)
        }}
        material={frontMaterial}
        castShadow
        receiveShadow
        visible={false}
      />
    </>
  )
}

/**
 * A connection between two fused organisms (kin, close, over ground a root can cross: see rootPath). It begins as a thin runner
 * that leaves each organism at the foot of its plinth and grows out to the middle; over the decades it thickens into a layered,
 * mineralised ridge and then a bridge: a deck that follows the ground where the ground rises and arches clear of it where
 * the ground falls away, its ends grown down into the two plinths. When both organisms are old it breaks in the middle.
 */
function Connection({ population, link, index, selected, meshes }: { population: Population; link: Link; index: number; selected: boolean; meshes: Map<string, Mesh> }) {
  const geometry = useMemo(() => {
    const a = population.organisms[link.a]!
    const b = population.organisms[link.b]!
    const d = Math.hypot(b.x - a.x, b.z - a.z)
    const ux = (b.x - a.x) / d
    const uz = (b.z - a.z) / d
    // Where each leaves: at its footing, a little inside the plinth's edge, so the root grows out of it.
    const start = (o: typeof a, sign: number): [number, number] => [o.x + sign * ux * o.radius * 0.42, o.z + sign * uz * o.radius * 0.42]
    const pa = start(a, 1)
    const pb = start(b, -1)
    const thick = (o: typeof a) => 1.7 * Math.sqrt(o.form.size ?? 1) + 0.4
    // The meeting point wanders off the straight line by an amount that is its own for each link.
    const wander = (salt: number) => (Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453) % 1
    const along = 0.42 + 0.16 * Math.abs(wander(1))
    const mid: [number, number] = [pa[0] + (pb[0] - pa[0]) * along + -uz * d * 0.1 * wander(2), pa[1] + (pb[1] - pa[1]) * along + ux * d * 0.1 * wander(2)]
    const bend = (salt: number) => 0.12 * wander(salt)
    const runners = [runner(pa, mid, thick(a), 0.32 * thick(a), index * 2, bend(3), true), runner(pb, mid, thick(b), 0.32 * thick(b), index * 2 + 1, bend(4), true)]
    const size = Math.min(a.form.size ?? 1, b.form.size ?? 1)
    const solids = new Map<string, BufferGeometry>()
    const solid = (grow: number, broken: boolean) => {
      const key = `${Math.round(grow * 5)}${broken ? 'b' : ''}`
      let g = solids.get(key)
      if (!g) {
        g = bridge(pa, pb, size, Math.round(grow * 5) / 5, broken, index, bend(5))
        solids.set(key, g)
      }
      return g
    }
    return { runners, solid, solids }
  }, [population, link, index])
  useEffect(
    () => () => {
      geometry.runners.forEach((h) => h.dispose())
      geometry.solids.forEach((g) => g.dispose())
    },
    [geometry],
  )
  const material = useMemo(() => tissue(), [])
  useEffect(() => () => material.dispose(), [material])
  const group = useRef<(Mesh | null)[]>([])
  const body = useRef<Mesh | null>(null)
  const drawn = useRef('')
  useFrame(() => {
    material.color.setScalar(1 - 0.16 * wetness.value)
    setUniform(material, 'pick', selected ? 1 : 0)
    const time = worldTime()
    const years = time - link.since
    const sa = organismState(population, link.a, time)
    const sb = organismState(population, link.b, time)
    // Runner for the first years (it grows out from both ends), then a ridge that thickens into a bridge over about seventy
    // years; broken in the middle once both organisms are old.
    const runnerStage = years < 14
    const grow = Math.min(1, Math.max(0, (years - 14) / 70))
    const broken = grow >= 1 && Math.min(sa.age, sb.age) > 2.4
    const step = runnerStage ? Math.round(Math.min(1, Math.max(0, years / 14)) * 60) : 0
    const key = years <= 0 || !sa.present || !sb.present ? 'none' : runnerStage ? `r${step}` : `s${Math.round(grow * 5)}${broken ? 'b' : ''}`
    if (key === drawn.current) return
    drawn.current = key
    const showRunner = key[0] === 'r'
    for (const [i, h] of geometry.runners.entries()) {
      const rings = h.userData.rings as number
      h.setDrawRange(0, Math.floor((rings - 1) * (step / 60)) * h.userData.perRing)
      const m = group.current[i]
      if (m) m.visible = showRunner && step > 0
    }
    const m = body.current
    if (m) {
      const showSolid = key[0] === 's'
      if (showSolid) m.geometry = geometry.solid(grow, broken)
      m.visible = showSolid
    }
    livingArchitecture.version += 1
  })
  return (
    <>
      {geometry.runners.map((h, i) => (
        <mesh
          key={i}
          ref={(m) => {
            group.current[i] = m
            if (m) {
              m.userData.pick = { kind: 'link', index } satisfies Selection
              meshes.set(`l${index}-${i}`, m)
            } else meshes.delete(`l${index}-${i}`)
          }}
          geometry={h}
          material={material}
          castShadow
          receiveShadow
          visible={false}
        />
      ))}
      <mesh
        ref={(m) => {
          body.current = m
          if (m) {
            m.userData.pick = { kind: 'link', index } satisfies Selection
            meshes.set(`l${index}-2`, m)
          } else meshes.delete(`l${index}-2`)
        }}
        material={material}
        castShadow
        receiveShadow
        visible={false}
      />
    </>
  )
}

/**
 * The grown form of a connection: a stratified deck swept from `from` to `to`. The deck follows the ground where the ground
 * rises and arches clear of it where it falls away (the line between the two ends, lifted in the middle); its underside is
 * grown down to the ground near each end, and in the middle only where the ground is too close to leave an opening. `grow`
 * (0 to 1) takes it from a low ridge to the full bridge; `broken` takes the middle out (two stumps, capped).
 */
function bridge(from: [number, number], to: [number, number], size: number, grow: number, broken: boolean, salt: number, bend: number): BufferGeometry {
  const RINGS = 64
  const SIDES = 16
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1
  const sx = -(to[1] - from[1]) / length
  const sz = (to[0] - from[0]) / length
  // The deck leaves each organism at the height of its plinth top, so it reads as the plinth's own extension.
  const hA = landscapeHeight(from[0], from[1]) + 3 + 6 * size
  const hB = landscapeHeight(to[0], to[1]) + 3 + 6 * size
  const g = Math.max(0.12, grow)
  const smooth = (a: number, b: number, t: number) => {
    const k = Math.min(1, Math.max(0, (t - a) / (b - a)))
    return k * k * (3 - 2 * k)
  }
  const thick = (1.4 + 2.6 * size) * (0.45 + 0.55 * g)
  const wide = (4 + 8 * size) * (0.4 + 0.6 * g)
  const arch = Math.min(7, Math.max(2, 0.06 * length)) * smooth(0.25, 0.85, grow)
  // How far the underside is grown down to the ground along the way: all of it for a ridge, only near the ends for a bridge.
  const grounded = 1 - smooth(0.3, 0.85, grow)
  const positions: number[] = []
  const colours: number[] = []
  const recordA: number[] = []
  const recordB: number[] = []
  const index: number[] = []
  const rings: number[] = []
  const centre: [number, number, number][] = []
  for (let i = 0; i < RINGS; i += 1) {
    const t = i / (RINGS - 1)
    if (broken && t > 0.4 && t < 0.6) continue
    rings.push(i)
  }
  for (const i of rings) {
    const t = i / (RINGS - 1)
    const sway = length * bend * Math.sin(t * Math.PI) + length * 0.012 * Math.sin(t * 9 + salt)
    const x = from[0] + (to[0] - from[0]) * t + sx * sway
    const z = from[1] + (to[1] - from[1]) * t + sz * sway
    const h = landscapeHeight(x, z)
    const line = hA + (hB - hA) * t + arch * Math.sin(t * Math.PI)
    const flare = Math.exp(-5 * Math.min(t, 1 - t))
    const top = Math.max(line, h + 0.5 + 0.6 * thick) + thick * 0.5 * flare
    const end = Math.max(smooth(0.3, 0, t), smooth(0.7, 1, t))
    const free = top - thick
    const floor = h - 1.4
    const w = Math.max(grounded, end)
    const bottom = free + (floor - free) * w
    const hw = (wide * (0.55 + 1.1 * flare) * (1 + 0.12 * Math.sin(t * 9 + salt))) / 2
    const p = rings.indexOf(i)
    const q = rings[Math.min(rings.length - 1, p + 1)]!
    const o = rings[Math.max(0, p - 1)]!
    const tx = from[0] + (to[0] - from[0]) * (q / (RINGS - 1)) - (from[0] + (to[0] - from[0]) * (o / (RINGS - 1)))
    const tz = from[1] + (to[1] - from[1]) * (q / (RINGS - 1)) - (from[1] + (to[1] - from[1]) * (o / (RINGS - 1)))
    const tl = Math.hypot(tx, tz) || 1
    const ax = -tz / tl
    const az = tx / tl
    const yc = (top + bottom) / 2
    const hh = Math.max(0.3, (top - bottom) / 2)
    for (let k = 0; k < SIDES; k += 1) {
      const angle = (k / SIDES) * Math.PI * 2
      const c = Math.cos(angle)
      const sn = Math.sin(angle)
      const u = Math.sign(c) * Math.pow(Math.abs(c), 0.5)
      const v = Math.sign(sn) * Math.pow(Math.abs(sn), 0.4)
      const y = yc + hh * v
      // Stepped sides (a ledge for each stratum), and an underside drawn in where the deck is clear of the ground.
      const ledge = 1 + 0.07 * (((y - h) / 3.4) % 1 < 0.5 ? 1 : -1) * Math.min(1, Math.abs(u) * 1.6)
      const under = v < 0 ? 1 - 0.22 * (1 - w) : 1
      positions.push(x + ax * hw * u * ledge * under, y, z + az * hw * u * ledge * under)
      const col = skin(Math.max(0, y - h), 0.5, 0.97, 0.5)
      colours.push(col.r, col.g, col.b)
      // Birth by height: the strata of the deck, bands as it was laid down; older and weathered where it is broken.
      recordA.push((y - h) * 0.06 + t * 0.2, broken ? 0.45 : 0.8, broken ? 0.5 : 0.08, 0)
      recordB.push(0.35 + 0.45 * Math.max(0, v), 0.45, ((salt * 2654435761 + i * 97) >>> 0) / 4294967296, 0.5)
    }
    centre.push([x, yc, z])
  }
  for (let r = 0; r < rings.length - 1; r += 1) {
    if (broken && rings[r + 1]! - rings[r]! > 1) continue
    for (let k = 0; k < SIDES; k += 1) {
      const a = r * SIDES + k
      const b = r * SIDES + ((k + 1) % SIDES)
      index.push(a, a + SIDES, b, b, a + SIDES, b + SIDES)
    }
  }
  // Caps where the middle is taken out.
  if (broken) {
    for (let r = 0; r < rings.length - 1; r += 1) {
      if (rings[r + 1]! - rings[r]! <= 1) continue
      for (const [ring, flip] of [[r, false], [r + 1, true]] as const) {
        const c = centre[ring]!
        const at = positions.length / 3
        positions.push(c[0], c[1], c[2])
        colours.push(0.7, 0.68, 0.6)
        recordA.push(0.5, 0.4, 0.5, 0)
        recordB.push(0.4, 0.4, 0.5, 0.5)
        for (let k = 0; k < SIDES; k += 1) {
          const a = ring * SIDES + k
          const b = ring * SIDES + ((k + 1) % SIDES)
          if (flip) index.push(at, b, a)
          else index.push(at, a, b)
        }
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3))
  geometry.setAttribute('aGrowthA', new BufferAttribute(new Float32Array(recordA), 4))
  geometry.setAttribute('aGrowthB', new BufferAttribute(new Float32Array(recordB), 4))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * A runner from `from` to `to` along the ground: a tube half buried and flattened, its path bending sideways by `bend` (a
 * share of its length), flaring where it leaves its organism (radius r0 there, narrowing to r1 where it meets the other half),
 * its girth uneven along the way; its rings in order.
 */
function runner(from: [number, number], to: [number, number], r0: number, r1: number, salt: number, bend: number, flare: boolean): BufferGeometry {
  const RINGS = 48
  const SIDES = 10
  const positions: number[] = []
  const normals: number[] = []
  const colours: number[] = []
  const recordA: number[] = []
  const recordB: number[] = []
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1
  const sx = -(to[1] - from[1]) / length
  const sz = (to[0] - from[0]) / length
  const radiusAt = (t: number) => {
    const flared = flare ? 1 + 1.1 * Math.exp(-t * 7) : 1
    const uneven = 1 + 0.2 * Math.sin(t * 11 + salt * 1.7) + 0.1 * Math.sin(t * 27 + salt * 3.1)
    return (r0 + (r1 - r0) * Math.pow(t, 0.7)) * flared * uneven
  }
  const pts: [number, number, number][] = []
  for (let i = 0; i < RINGS; i += 1) {
    const t = i / (RINGS - 1)
    const sway = length * bend * Math.sin(t * Math.PI) + length * 0.015 * Math.sin(t * 9 + salt)
    const x = from[0] + (to[0] - from[0]) * t + sx * sway
    const z = from[1] + (to[1] - from[1]) * t + sz * sway
    pts.push([x, landscapeHeight(x, z) - 0.45 * radiusAt(t), z])
  }
  for (let i = 0; i < RINGS; i += 1) {
    const t = i / (RINGS - 1)
    const p = pts[i]!
    const q = pts[Math.min(RINGS - 1, i + 1)]!
    const o = pts[Math.max(0, i - 1)]!
    const tx = q[0] - o[0]
    const ty = q[1] - o[1]
    const tz = q[2] - o[2]
    const tl = Math.hypot(tx, ty, tz) || 1
    // A frame around the path: across (level) and up.
    let ax = -tz / tl
    let az = tx / tl
    const al = Math.hypot(ax, az) || 1
    ax /= al
    az /= al
    const r = radiusAt(t)
    for (let k = 0; k < SIDES; k += 1) {
      const angle = (k / SIDES) * Math.PI * 2
      const c = Math.cos(angle)
      const sn = Math.sin(angle)
      const nx = ax * c
      const ny = sn
      const nz = az * c
      positions.push(p[0] + nx * r * 1.15, p[1] + ny * r * 0.62, p[2] + nz * r * 1.15)
      normals.push(nx, ny, nz)
      const colour = skin(Math.max(0, ny * r), 0.4, 0.98, 0.5)
      colours.push(colour.r, colour.g, colour.b)
      recordA.push(t * 0.5, 0.78, 0.05, 0)
      recordB.push(0.4 + 0.4 * Math.max(0, ny), 0.45, ((salt * 2654435761) >>> 0) / 4294967296, 0.5)
    }
  }
  const index: number[] = []
  for (let i = 0; i < RINGS - 1; i += 1) {
    for (let k = 0; k < SIDES; k += 1) {
      const a = i * SIDES + k
      const b = i * SIDES + ((k + 1) % SIDES)
      const c = a + SIDES
      const d = b + SIDES
      index.push(a, c, b, b, c, d)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  g.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3))
  g.setAttribute('aGrowthA', new BufferAttribute(new Float32Array(recordA), 4))
  g.setAttribute('aGrowthB', new BufferAttribute(new Float32Array(recordB), 4))
  g.setIndex(index)
  g.computeBoundingSphere()
  g.userData.rings = RINGS
  g.userData.perRing = SIDES * 6
  return g
}

/**
 * Picks an organism (or a connection) with a click that is not a drag: at the cursor, or at the centre of the view while
 * the pointer is locked (walking in Explore). A click on nothing leaves the selection as it is.
 */
function Picker({ meshes }: { meshes: Map<string, Mesh> }) {
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  useEffect(() => {
    const element = gl.domElement
    const ray = new Raycaster()
    const ndc = new Vector2()
    let down: { x: number; y: number; moved: number } | null = null
    const locked = () => document.pointerLockElement === element
    const press = (event: PointerEvent) => {
      if (event.button === 0) down = { x: event.clientX, y: event.clientY, moved: 0 }
    }
    const move = (event: PointerEvent) => {
      if (down && locked()) down.moved += Math.abs(event.movementX) + Math.abs(event.movementY)
    }
    const release = (event: PointerEvent) => {
      if (!down || event.button !== 0) return
      const drag = locked() ? down.moved : Math.hypot(event.clientX - down.x, event.clientY - down.y)
      down = null
      if (drag > 6) return
      const rect = element.getBoundingClientRect()
      if (locked()) ndc.set(0, 0)
      else ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const targets = [...meshes.values()].filter((m) => m.visible && m.parent?.visible !== false)
      const hit = ray.intersectObjects(targets, false)[0]
      if (hit) select(hit.object.userData.pick as Selection)
    }
    element.addEventListener('pointerdown', press)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', release)
    return () => {
      element.removeEventListener('pointerdown', press)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', release)
    }
  }, [gl, camera, meshes])
  return null
}
