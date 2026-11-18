import { plantClick } from './vegInspect.ts'
import { useFrame, useThree } from '@react-three/fiber'
import { getExperience } from './experience.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferAttribute, BufferGeometry, DoubleSide, type Group, type Mesh, MeshBasicMaterial, MeshStandardMaterial, Raycaster, Vector2, Vector3 } from 'three'
import { wetness, worldTime } from './environment.ts'
import { buildColony, livingArchitecture, skin } from './livingArchitecture.ts'
import { growColony } from './livingGrowth.ts'
import { growColony2 } from './livingGrowth2.ts'
import { growColony3 } from './livingGrowth3.ts'
import { LATE_FROM, organismState, type Link, type Population } from './livingEcology.ts'
import { lifeStateAt } from './livingLifecycle.ts'
import { architectureStyle } from './livingStyle.ts'
import { needsRebuild } from '../architecture-lab/lifecycle.ts'
import { acceptsArrival, isYoung } from './livingStageGate.ts'
import { clearFootprint, flushGround, stampFootprint } from './archGround.ts'
import { createLifecycleMaterial } from '../architecture-lab/lifecycleMaterial.ts'
import { fieldOptionsFromUrl, growField } from './livingField.ts'
import { growNetwork } from './livingNetwork.ts'
import { growStrata, strataOptionsFromUrl } from './livingStrata.ts'
import { growOverhang, overhangOptionsFromUrl } from './livingOverhang.ts'
import { growOverhang2 } from './livingOverhang2.ts'
import { growOverhang3 } from './livingOverhang3.ts'
import { buildGrown, buildVoxel, buildOrganism, loadPopulation, organismAt, setViewpoint, type CoarseBuilt, type OverhangBuilt } from './livingOverhangAsync.ts'
import { createGrownDepthMaterial, createGrownMaterial, createLoftDepthMaterial, createLoftMaterial } from './livingMaterial.ts'
import { loftAt, loftGeometry, loftUniforms, planLoft } from './livingLoft.ts'
import { FR_LEVELS, FR_MAX_AGE, frontsMesh, growFronts, type Fronts } from './livingFronts.ts'
import { growSkeleton, skeletonMesh, SK_LEVELS, SK_MAX_AGE, type Skeleton } from './livingSkeleton.ts'
import { TICKS, voxelMesh, type VoxelOrganism } from './livingVoxel.ts'
import { anchor, select, setPopulation, useLiving, type Selection } from './livingSelection.ts'
import { MorphPreview } from './LivingMorphPreview.tsx'
import { previewSites, usePreview } from './livingPreview.ts'
import { applyStyleFinish, specialiseStyle } from './visualStyle.ts'
import { organismMeshes } from './organismSize.ts'
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
export type ArchitectureVariant = 'off' | 'grown2' | 'grown2x' | 'grown3' | 'grown3b' | 'grown3c' | 'network' | 'field' | 'strata' | 'overhang' | 'overhang2' | 'overhang3' | 'growth' | 'reveal' | 'voxel' | 'skeleton' | 'fronts' | 'grown' | 'composed'

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
  const skeleton = variant === 'skeleton'
  const fronts = variant === 'fronts'
  const colony = useMemo(() => {
    if (variant === 'off' || lifecycle || growth || lofted || voxel || skeleton || fronts || variant === 'reveal' || variant === 'voxel') return null
    const built = variant === 'grown2' ? growColony2(world, world.seed) : variant === 'grown2x' ? growColony2(world, world.seed, { structural: true }) : variant === 'grown3' ? growColony3(world, world.seed) : variant === 'grown3b' ? growColony3(world, world.seed, { slender: true }) : variant === 'grown3c' ? growColony3(world, world.seed, { scaffold: true }) : variant === 'network' ? growNetwork(world, world.seed) : variant === 'field' ? growField(world, world.seed, fieldOptionsFromUrl()) : variant === 'strata' ? growStrata(world, world.seed, strataOptionsFromUrl()) : variant === 'overhang' ? growOverhang(world, world.seed, overhangOptionsFromUrl()) : variant === 'overhang2' ? growOverhang2(world, world.seed, overhangOptionsFromUrl()) : variant === 'overhang3' ? growOverhang3(world, world.seed, overhangOptionsFromUrl()) : variant === 'grown' ? growColony(world, world.seed) : buildColony(world, world.seed)
    if (built.stats) console.info(`[living architecture] ${variant}`, built.stats)
    return built
  }, [world, variant, lifecycle, growth, lofted, voxel, skeleton, fronts])
  const grown2 = variant === 'grown2' || variant === 'grown2x' || variant === 'grown3' || variant === 'grown3b' || variant === 'grown3c' || variant === 'network' || variant === 'field' || variant === 'strata' || variant === 'overhang' || variant === 'overhang2' || variant === 'overhang3' || variant === 'growth' || variant === 'reveal' || variant === 'voxel' || variant === 'skeleton' || variant === 'fronts'
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
  if (skeleton) return <SkeletonGrowth world={world} visible={visible} />
  if (fronts) return <FrontsGrowth world={world} visible={visible} />
  if (!colony) return null
  return <mesh geometry={colony.geometry} material={material} castShadow receiveShadow visible={visible} />
}

/**
 * The skeleton experiment (?architecture=skeleton, see livingSkeleton.ts): LA-01 as a tree of nodes, each grown from its parent
 * by tips that steer by light, crowding and ground, thickened by the load they carry, merged into a smooth volume and meshed
 * at SK_LEVELS ages (0 to 3: 1 is the reference form, then senescence and renewal). The network is grown once on the main
 * thread (tens of milliseconds); the surfaces are made one a frame and kept, as in the voxel prototype, so the age on screen
 * shows the nearest one made. `&age=1.8` holds an age (0 to 3).
 */
function SkeletonGrowth({ world, visible }: { world: World; visible: boolean }) {
  const [plan, setLocal] = useState<Population | null>(null)
  const [sk, setSk] = useState<Skeleton | null>(null)
  useEffect(() => {
    let live = true
    loadPopulation(world.seed).then((p) => {
      if (!live) return
      setLocal(p)
      setPopulation(p)
      select({ kind: 'organism', index: 0 })
    })
    return () => {
      live = false
      setPopulation(null)
    }
  }, [world])
  // The network depends on the neighbours (the plan), so it is grown once the plan is there.
  useEffect(() => {
    if (!plan) return
    const grown = growSkeleton(world, world.seed, plan)
    console.info('[living architecture] skeleton growth', grown.stats)
    setSk(grown)
  }, [plan, world])
  const age = useMemo(() => ({ value: 1 }), [])
  const material = useMemo(() => createGrownMaterial(age), [age])
  useEffect(() => () => material.dispose(), [material])
  const levels = useRef<(BufferGeometry | null)[]>(Array.from({ length: SK_LEVELS }, () => null))
  const shown = useRef(-1)
  const times = useRef<number[]>([])
  useEffect(
    () => () => {
      for (const g of levels.current) g?.dispose()
      levels.current = Array.from({ length: SK_LEVELS }, () => null)
      shown.current = -1
    },
    [sk],
  )
  const held = useMemo(() => {
    const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('age')
    return asked === null ? null : Math.max(0, Math.min(SK_MAX_AGE, Number(asked)))
  }, [])
  const mesh = useRef<Mesh | null>(null)
  useFrame(() => {
    const m = mesh.current
    if (!m || !sk) return
    material.color.setScalar(1 - 0.16 * wetness.value)
    const st = plan ? organismState(plan, 0, worldTime()) : null
    const now = held ?? (st && st.present ? Math.min(SK_MAX_AGE, st.age) : 0)
    const show = visible && (held !== null || (st?.present ?? false))
    if (m.visible !== show) {
      m.visible = show
      livingArchitecture.version += 1
    }
    age.value = Math.min(1.5, now)
    const want = Math.round((now / SK_MAX_AGE) * (SK_LEVELS - 1))
    const make = (l: number) => {
      const t0 = performance.now()
      levels.current[l] = skeletonMesh(sk, (l / (SK_LEVELS - 1)) * SK_MAX_AGE)
      times.current.push(performance.now() - t0)
    }
    if (!levels.current[want]) make(want)
    else {
      for (let d = 1; d < SK_LEVELS; d += 1) {
        const a = want - d
        const b = want + d
        if (a >= 0 && !levels.current[a]) {
          make(a)
          break
        }
        if (b < SK_LEVELS && !levels.current[b]) {
          make(b)
          break
        }
      }
    }
    let use = -1
    for (let l = want; l >= 0 && use < 0; l -= 1) if (levels.current[l]) use = l
    for (let l = want + 1; l < SK_LEVELS && use < 0; l += 1) if (levels.current[l]) use = l
    if (use >= 0 && use !== shown.current) {
      shown.current = use
      m.geometry = levels.current[use]!
      livingArchitecture.version += 1
    }
    if (times.current.length === SK_LEVELS) {
      console.info('[living architecture] skeleton surfaces', { levels: SK_LEVELS, meanMs: Math.round(times.current.reduce((a, b) => a + b, 0) / SK_LEVELS), maxMs: Math.round(Math.max(...times.current)) })
      times.current.push(0)
    }
  })
  if (!sk) return null
  return <mesh ref={mesh} material={material} castShadow receiveShadow visible={false} frustumCulled={false} />
}

/**
 * The fronts prototype (?architecture=fronts, see livingFrontsCore.ts): LA-01 as a few growth fronts that rise from a mound,
 * curl over and fuse into one another or into the ground, thickened by the load they carry. One organism, a few milliseconds to
 * grow, FR_LEVELS surfaces made one a frame (10 to 20 ms each) and kept; `&age=0.6` holds an age (0 to 1.7).
 */
function FrontsGrowth({ world, visible }: { world: World; visible: boolean }) {
  const [plan, setLocal] = useState<Population | null>(null)
  const [sk, setSk] = useState<Fronts | null>(null)
  useEffect(() => {
    let live = true
    loadPopulation(world.seed).then((p) => {
      if (!live) return
      setLocal(p)
      setPopulation(p)
      select({ kind: 'organism', index: 0 })
    })
    return () => {
      live = false
      setPopulation(null)
    }
  }, [world])
  // The network depends on the neighbours (the plan), so it is grown once the plan is there.
  useEffect(() => {
    if (!plan) return
    const grown = growFronts(world, world.seed, plan)
    console.info('[living architecture] fronts growth', grown.stats)
    setSk(grown)
  }, [plan, world])
  const age = useMemo(() => ({ value: 1 }), [])
  const material = useMemo(() => createGrownMaterial(age), [age])
  useEffect(() => () => material.dispose(), [material])
  const levels = useRef<(BufferGeometry | null)[]>(Array.from({ length: FR_LEVELS }, () => null))
  const shown = useRef(-1)
  const times = useRef<number[]>([])
  useEffect(
    () => () => {
      for (const g of levels.current) g?.dispose()
      levels.current = Array.from({ length: FR_LEVELS }, () => null)
      shown.current = -1
    },
    [sk],
  )
  const held = useMemo(() => {
    const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('age')
    return asked === null ? null : Math.max(0, Math.min(FR_MAX_AGE, Number(asked)))
  }, [])
  const mesh = useRef<Mesh | null>(null)
  useFrame(() => {
    const m = mesh.current
    if (!m || !sk) return
    material.color.setScalar(1 - 0.16 * wetness.value)
    const st = plan ? organismState(plan, 0, worldTime()) : null
    const now = held ?? (st && st.present ? Math.min(FR_MAX_AGE, st.age) : 0)
    const show = visible && (held !== null || (st?.present ?? false))
    if (m.visible !== show) {
      m.visible = show
      livingArchitecture.version += 1
    }
    age.value = Math.min(1.5, now)
    const want = Math.round((now / FR_MAX_AGE) * (FR_LEVELS - 1))
    const make = (l: number) => {
      const t0 = performance.now()
      levels.current[l] = frontsMesh(sk, (l / (FR_LEVELS - 1)) * FR_MAX_AGE)
      times.current.push(performance.now() - t0)
    }
    if (!levels.current[want]) make(want)
    else {
      for (let d = 1; d < FR_LEVELS; d += 1) {
        const a = want - d
        const b = want + d
        if (a >= 0 && !levels.current[a]) {
          make(a)
          break
        }
        if (b < FR_LEVELS && !levels.current[b]) {
          make(b)
          break
        }
      }
    }
    let use = -1
    for (let l = want; l >= 0 && use < 0; l -= 1) if (levels.current[l]) use = l
    for (let l = want + 1; l < FR_LEVELS && use < 0; l += 1) if (levels.current[l]) use = l
    if (use >= 0 && use !== shown.current) {
      shown.current = use
      m.geometry = levels.current[use]!
      livingArchitecture.version += 1
    }
    if (times.current.length === FR_LEVELS) {
      console.info('[living architecture] fronts surfaces', { levels: FR_LEVELS, meanMs: Math.round(times.current.reduce((a, b) => a + b, 0) / FR_LEVELS), maxMs: Math.round(Math.max(...times.current)) })
      times.current.push(0)
    }
  })
  if (!sk) return null
  return <mesh ref={mesh} material={material} castShadow receiveShadow visible={false} frustumCulled={false} />
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

/**
 * THE FIRST APPEARANCE. The structures do not pop in one by one as their meshes arrive: the population is held back until every organism has its first mesh
 * (or knows it is absent at this year), or until 2.5 seconds after the first one is ready (15 at most), and then all of them dissolve in together. One that
 * is still waiting then dissolves in on its own when its mesh comes. Later changes (Evolution, a new stage) are not held.
 */
const reveal = { open: false, since: 0, first: 0, openedAt: 0, organisms: new Set<number>(), ready: new Set<number>() }
/** Whether the population has made its first appearance (read only; for a loading screen, /preview). */
export const architectureRevealed = () => reveal.open
function resetReveal() {
  reveal.open = false
  reveal.since = performance.now()
  reveal.first = 0
  reveal.openedAt = 0
  reveal.ready.clear()
}
function markReady(index: number, shown: boolean) {
  if (reveal.open || reveal.ready.has(index)) return
  reveal.ready.add(index)
  if (shown && !reveal.first) reveal.first = performance.now()
}

/** The population: its plan from the worker, an organism for each, a connection for each fusion, and the picker. */
function LivingPopulation({ world, visible }: { world: World; visible: boolean }) {
  const [population, setPlan] = useState<Population | null>(null)
  const held = useRef<Group | null>(null)
  useFrame(() => {
    if (!reveal.open) {
      const now = performance.now()
      const all = reveal.organisms.size > 0 && reveal.ready.size >= reveal.organisms.size
      if (all || (reveal.first > 0 && now - reveal.first > 2500) || (reveal.organisms.size > 0 && now - reveal.since > 15000)) {
        reveal.open = true
        reveal.openedAt = now
        console.info('[living architecture] revealed', { ready: reveal.ready.size, of: reveal.organisms.size, ms: Math.round(now - reveal.since) })
      }
    }
    if (held.current) held.current.visible = visible && reveal.open
  })
  useEffect(() => {
    let live = true
    resetReveal()
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
  // The morphology preview (livingPreview.ts): off by default. In its single-morphology modes the Overhang is not drawn at the preview sites.
  const preview = usePreview()
  const sites = useMemo(() => (population ? previewSites(population) : []), [population])
  if (!population) return null
  const replaced = preview.mode === 'spreading' || preview.mode === 'ascending' ? new Set(sites) : null
  return (
    <group ref={held} visible={visible && reveal.open}>
      <MorphPreview world={world} population={population} sites={sites} />
      {population.organisms.filter((o) => !replaced?.has(o.index)).map((o) => (
        <Organism key={o.id} world={world} population={population} index={o.index} selected={selection?.kind === 'organism' && selection.index === o.index} meshes={meshes} />
      ))}
      {population.links.map((link, i) => (
        <Connection key={`${link.a}-${link.b}`} population={population} link={link} index={i} selected={selection?.kind === 'link' && selection.index === i} meshes={meshes} />
      ))}
      <Picker meshes={meshes} />
      <ViewTracker />
      <CommunityMarks population={population} />
      <AnchorTracker population={population} selection={selection} visible={visible} />
    </group>
  )
}

/** Each frame, where the selection's anchor stands on screen (a fixed point on the organism, or the middle of a connection), for the card beside it. */
function AnchorTracker({ population, selection, visible }: { population: Population; selection: Selection; visible: boolean }) {
  const { camera, size } = useThree()
  const point = useMemo(() => new Vector3(), [])
  useEffect(() => () => void (anchor.visible = false), [])
  useFrame(() => {
    anchor.visible = false
    if (!selection || !visible) return
    // The anchor is a fixed point of the organism itself, from its plan: on its axis, over its ground, a little over half way up. It does not read
    // the mesh (which is swapped as the organism grows and decays), so it neither moves with a vertex nor vanishes while a mesh is being replaced.
    if (selection.kind === 'organism') {
      const o = population.organisms[selection.index]!
      point.set(o.x, landscapeHeight(o.x, o.z) + o.height * 0.55, o.z)
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

type Shown = { age: number; grow: number; recede: number; regen: number; ruin?: number }
type LinkPose = 'live' | 'failed' | 'ruin'

/** A grown material with its own lifecycle age, selection and dissolve (each mesh, and each connection, has its own). */
function tissue(refined = false): MeshStandardMaterial {
  const uniforms = { age: { value: MATURE }, pick: { value: 0 }, dissolve: { value: 2 }, live: { value: 1 }, dead: { value: 0 } }
  // The refined Overhang's lifecycle material adds `live` (living tissue to exposed skeleton) and `dead` (weathering): see architecture-lab/lifecycleMaterial.ts.
  const material = refined ? createLifecycleMaterial(uniforms.age, uniforms.live, uniforms.dead, uniforms.pick, uniforms.dissolve) : createGrownMaterial(uniforms.age, uniforms.pick, uniforms.dissolve)
  // The illustrative styles (visualStyle.ts), added on the world's side only: the Architecture Lab's materials are built from the same functions untouched.
  const base = material.onBeforeCompile
  const key = material.customProgramCacheKey
  material.onBeforeCompile = (shader, renderer) => {
    base.call(material, shader, renderer)
    applyStyleFinish(shader, 'architecture')
  }
  material.customProgramCacheKey = () => `${key.call(material)}-sty`
  specialiseStyle(material)
  material.userData.uniforms = uniforms
  return material
}
function setUniform(material: MeshStandardMaterial, name: 'age' | 'pick' | 'dissolve' | 'live' | 'dead', value: number) {
  ;(material.userData.uniforms as Record<string, { value: number }>)[name]!.value = value
}
function getUniform(material: MeshStandardMaterial, name: 'live' | 'dead'): number {
  return (material.userData.uniforms as Record<string, { value: number }>)[name]!.value
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
  // Not a structure: the habitat readers (vegHabitat.ts, creatureHabitat.ts, Vegetation.tsx) skip it, so it never counts as shade, shelter or footprint.
  return <mesh ref={mesh} material={material} renderOrder={2} frustumCulled={false} receiveShadow={false} userData={{ habitat: false }} />
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

/** Seconds one mesh takes to dissolve into the next. */
const DISSOLVE = 0.8
/** No drawable surface. Used while an organism is hidden so a mature mesh cannot remain attached to it. */
const blankGeometry = new BufferGeometry()

type Face = { geometry: BufferGeometry | null; owned: boolean; kind: 'mature' | 'stage'; age: number; state: Shown | null; scale: number; pos: [number, number, number] }
const none = (): Face => ({ geometry: null, owned: false, kind: 'stage', age: 0, state: null, scale: 1, pos: [0, 0, 0] })

/**
 * One organism, drawn by two meshes: the one in front (what it looks like now) and, for under half a second after a change,
 * the one it is dissolving out of. A new mesh never replaces the old by a hard swap: it takes over pixel by pixel (see
 * createGrownMaterial's dissolve). Nothing is drawn until the mesh for this age exists. A young organism stays hidden rather
 * than showing its mature form scaled down. Maturity is the one built mesh. Each mesh is drawn for the age it was made for,
 * not for the world's age of the moment, which at fifty years a second runs far ahead of any mesh the worker can grow; it asks
 * for a new stage only when the organism has moved a step (a bigger step for those far from the camera, nearest first) and one
 * at a time. A mesh that arrives after a rebuild, or for a state the year has already left, is thrown away. Growth before
 * maturity is the field rebuilt at that age (livingLife.ts).
 */
function Organism({ world, population, index, selected, meshes }: { world: World; population: Population; index: number; selected: boolean; meshes: Map<string, Mesh> }) {
  const camera = useThree((state) => state.camera)
  const [built, setBuilt] = useState<OverhangBuilt | null>(null)
  useEffect(() => {
    let live = true
    buildOrganism(world, world.seed, population, index).then((b) => {
      if (!live) return
      if (index === 0) console.info('[living architecture] overhang3', architectureStyle(), b.stats)
      setBuilt(b)
    })
    return () => {
      live = false
    }
  }, [world, population, index])
  const refined = useMemo(() => architectureStyle() === 'refined', [])
  const frontMaterial = useMemo(() => tissue(refined), [refined])
  const backMaterial = useMemo(() => tissue(refined), [refined])
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
  /** A mesh that arrived while another was still dissolving in: it waits (the newest only) rather than cutting the dissolve short. */
  const pending = useRef<Face | null>(null)
  /** The world time and mesh of the last full pass: while neither has changed and nothing is in flight, the pass has nothing new to decide. */
  const settled = useRef<{ t: number; built: unknown } | null>(null)
  const clearPending = () => {
    if (pending.current?.owned) pending.current.geometry?.dispose()
    pending.current = null
  }
  const here = useMemo(() => new Vector3(population.organisms[index]!.x, camera.position.y, population.organisms[index]!.z), [population, index, camera])
  // A new build (another seed): the meshes it made are gone.
  useEffect(
    () => () => {
      const f = face.current
      for (const x of [f.front, f.back]) if (x.owned) x.geometry?.dispose()
      face.current = { front: none(), back: none(), t: 1 }
      clearPending()
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
    const had = !!f.front.geometry && f.front.geometry !== blankGeometry
    if (had) {
      f.back = f.front
      b.geometry = f.back.geometry!
      b.scale.setScalar(f.back.scale)
      b.position.set(...f.back.pos)
      setUniform(backMaterial, 'age', f.back.age)
      setUniform(backMaterial, 'live', getUniform(frontMaterial, 'live'))
      setUniform(backMaterial, 'dead', getUniform(frontMaterial, 'dead'))
      setUniform(backMaterial, 'dissolve', -0.001)
      b.visible = true
    } else {
      f.back = none()
      b.geometry = blankGeometry
      b.visible = false
    }
    f.front = next
    m.geometry = next.geometry!
    m.scale.setScalar(next.scale)
    m.position.set(...next.pos)
    setUniform(frontMaterial, 'age', next.age)
    // The first mesh for this appearance is the age mesh itself: held whole for the population's reveal, or (after it) dissolving in. A later mesh crossfades from the one before it.
    const fadeIn = !had && reveal.open
    setUniform(frontMaterial, 'dissolve', had || fadeIn ? 0 : 2)
    f.t = had || fadeIn ? 0 : 1
    if (!had) markReady(index, true)
    m.visible = true
    livingArchitecture.version += 1
    // The ground under it takes on what it is now: the footprint of this mesh, weaker for what is left of a dead structure.
    if (next.geometry && next.geometry !== blankGeometry) stampFootprint(index, next.geometry, next.kind === 'mature' ? 1 : 1 - 0.5 * (next.state?.ruin ?? 0))
  }

  useEffect(() => {
    reveal.organisms.add(index)
    return () => {
      reveal.organisms.delete(index)
    }
  }, [index])
  const revealed = useRef(false)
  useFrame((_, delta) => {
    flushGround(performance.now() / 1000)
    frontMaterial.color.setScalar(1 - 0.16 * wetness.value)
    backMaterial.color.setScalar(1 - 0.16 * wetness.value)
    setUniform(frontMaterial, 'pick', selected ? 1 : 0)
    setUniform(backMaterial, 'pick', selected ? 1 : 0)
    const m = front.current
    const b = back.current
    if (!m || !b) return
    const f = face.current
    // The population's reveal: what was held whole dissolves in, all together.
    if (reveal.open && !revealed.current) {
      revealed.current = true
      if (f.front.geometry && f.t >= 1 && !b.visible) {
        f.t = 0
        setUniform(frontMaterial, 'dissolve', 0)
      }
    }
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
    // Nothing to decide while the clock stands still (paused, or Evolution not playing), the mesh is the same and nothing is dissolving or being asked for:
    // the forty-odd organisms skip their pass instead of redoing the same lifecycle arithmetic every frame.
    const tNow = worldTime()
    const was = settled.current
    if (was && was.t === tNow && was.built === built && f.t >= 1 && !asking.current && !pending.current) return
    settled.current = { t: tNow, built }
    const st = organismState(population, index, tNow)
    // The refined Overhang's life (livingLifecycle.ts): where it is in the seven-stage lifecycle, from its age and its conditions.
    const o = population.organisms[index]!
    const ls = refined ? lifeStateAt(population.track[index]!, population.from, o.established, o.died, worldTime()) : null
    const ph = ls ? ls.phase : null
    if (ph) {
      setUniform(frontMaterial, 'live', ph.live)
      setUniform(frontMaterial, 'dead', ph.dead)
    }
    if (!(ls ? ls.present : st.present)) {
      markReady(index, false)
      clearPending()
      clearFootprint(index)
      const absentMature = f.front.kind === 'mature' || (!!built && (f.front.geometry === built.geometry || m.geometry === built.geometry))
      if (absentMature) {
        if (f.back.owned && f.back.geometry !== f.front.geometry && f.back.geometry !== built?.geometry) f.back.geometry?.dispose()
        f.back = none()
        b.geometry = blankGeometry
        b.visible = false
        f.front = none()
        f.t = 1
        m.geometry = blankGeometry
        m.visible = false
        livingArchitecture.version += 1
      } else if (m.visible || b.visible) {
        m.visible = false
        b.visible = false
        livingArchitecture.version += 1
      }
      return
    }
    const late = !ph && st.age >= LATE_FROM
    const mature = ph ? !needsRebuild(ls!.L) : st.age >= 1 && !late
    const holdingMature = f.front.kind === 'mature' || f.front.geometry === built?.geometry || m.geometry === built?.geometry
    // A mature mesh on screen while the organism is young is the wrong shape. Drop it and stay hidden until the age mesh arrives.
    // From senescence on the form still stands: the mature mesh stays until the stage's own mesh arrives and dissolves in.
    const young = isYoung(ls ? ls.L : null, st.age)
    if (mature || young) clearPending()
    if (young && !mature && built && holdingMature && (f.front.geometry || m.geometry === built.geometry)) {
      if (f.back.owned && f.back.geometry !== f.front.geometry && f.back.geometry !== built.geometry) f.back.geometry?.dispose()
      f.back = none()
      b.geometry = blankGeometry
      b.visible = false
      f.front = none()
      f.t = 1
      m.geometry = blankGeometry
      m.visible = false
      livingArchitecture.version += 1
    }
    if (f.front.geometry && !m.visible) {
      m.visible = true
      if (f.t < 1) b.visible = true
      livingArchitecture.version += 1
    }
    if (!built) return
    if (mature) {
      // The mature form (for the reference organism, its reference form) is the built mesh itself.
      if (f.front.geometry !== built.geometry) swap({ geometry: built.geometry, owned: false, kind: 'mature', age: 1, state: null, scale: 1, pos: [0, 0, 0] })
      return
    }
    // Young or in later life: the mesh for its state, asked of the worker. Until it comes the mesh in front stays.
    const want: Shown = ph ? { age: ph.age, grow: 0, recede: ph.recede, regen: 0, ruin: ph.ruin } : { age: st.age, grow: st.grow, recede: st.recede, regen: st.regen }
    const s = pending.current?.state ?? (f.front.kind === 'stage' ? f.front.state : null)
    // How big a step of state is worth a new mesh: the farther the organism from the camera, the bigger.
    const far = camera.position.distanceTo(here)
    // Early growth changes fastest (the volume grows several-fold between ages 0.04 and 0.2), so its steps are half as large.
    const stepAge = Math.min(0.065, 0.01 + far / 70000) * (want.age < 0.3 ? 0.5 : 1)
    const stepM = Math.min(0.65, 0.1 + far / 10000)
    const stepRuin = Math.min(0.09, 0.022 + far / 25000)
    // A mesh that waited out the dissolve is checked against the organism as it is now, and dropped if the clock has since moved far from it (or back before it).
    const waiting = pending.current
    if (waiting && f.t >= 1) {
      pending.current = null
      const stale = waiting.state ? Math.abs(waiting.state.age - want.age) > stepAge * 3 || Math.abs(waiting.state.recede - want.recede) > stepM * 3 || (want.age < 1 && waiting.state.age > want.age + stepAge * 1.5) : true
      if (stale) {
        if (waiting.owned) waiting.geometry?.dispose()
      } else swap(waiting)
    }
    const moved = !s || (ph ? Math.abs(want.age - s.age) > stepAge || Math.abs(want.recede - s.recede) > stepM || Math.abs((want.ruin ?? 0) - (s.ruin ?? 0)) > stepRuin : false) || (late ? Math.abs(want.grow - s.grow) > stepM || Math.abs(want.recede - s.recede) > stepM || Math.abs(want.regen - s.regen) > REMESH.regen || s.age < LATE_FROM : Math.abs(want.age - s.age) > stepAge || s.age >= LATE_FROM)
    if (asking.current || !moved) return
    asking.current = true
    const asked = epoch.current
    organismAt(built.key, Math.min(want.age, 1.5), ph ? { grow: 0, recede: want.recede, regen: 0, ruin: want.ruin } : late ? { grow: want.grow, recede: want.recede, regen: want.regen } : undefined, far).then((geometry) => {
      asking.current = false
      settled.current = null
      // Not wanted: the organism was rebuilt since, or the year has moved on, or the field came back empty.
      const count = geometry.getAttribute('position')?.count ?? 0
      if (!front.current || asked !== epoch.current || count < 24) {
        geometry.dispose()
        return
      }
      const time = worldTime()
      const stNow = organismState(population, index, time)
      const oNow = population.organisms[index]!
      const lsNow = refined ? lifeStateAt(population.track[index]!, population.from, oNow.established, oNow.died, time) : null
      const phNow = lsNow ? lsNow.phase : null
      const lateNow = !phNow && stNow.age >= LATE_FROM
      const matureNow = !(lsNow ? lsNow.present : stNow.present) || (phNow ? !needsRebuild(lsNow!.L) : stNow.age >= 1 && !lateNow)
      const farNow = camera.position.distanceTo(here)
      const ageTol = Math.min(0.065, 0.01 + farNow / 70000) * (want.age < 0.3 ? 0.5 : 1) * 2.5
      const metreTol = Math.min(0.65, 0.1 + farNow / 10000) * 2.5
      const ruinTol = Math.min(0.09, 0.022 + farNow / 25000) * 2.5
      const now: Shown = phNow ? { age: phNow.age, grow: 0, recede: phNow.recede, regen: 0, ruin: phNow.ruin } : { age: stNow.age, grow: stNow.grow, recede: stNow.recede, regen: stNow.regen }
      const frontNow = face.current.front
      const close = phNow
        ? acceptsArrival({ matureNow: false, young: lsNow ? lsNow.L < 0.5 : false, front: { kind: frontNow.kind, state: frontNow.state, shown: !!frontNow.geometry && m.visible }, now, want, tol: { age: ageTol, metre: metreTol, ruin: ruinTol } })
        : lateNow
          ? Math.abs(now.grow - want.grow) <= metreTol && Math.abs(now.recede - want.recede) <= metreTol && Math.abs(now.regen - want.regen) <= REMESH.regen * 2
          : Math.abs(now.age - want.age) <= ageTol
      if (matureNow || !close) {
        geometry.dispose()
        return
      }
      // Remains settle: as the structure fails it sinks a little into the ground it falls on, so the rubble sits in the terrain and not on it.
      const sink = 2.4 * Math.max(0, Math.min(1, ((want.ruin ?? 0) - 0.5) / 0.5)) ** 1.5
      const next: Face = { geometry, owned: true, kind: 'stage', age: Math.min(want.age, 1.5), state: want, scale: 1, pos: [0, -sink, 0] }
      if (face.current.t < 1) {
        clearPending()
        pending.current = next
        return
      }
      swap(next)
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
            organismMeshes.set(index, m)
          } else {
            meshes.delete(`o${index}`)
            organismMeshes.delete(index)
          }
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
 * A root between two fused organisms (kin, close, over ground a root can cross: see rootPath). It grows out from both
 * footings as one mineral ridge that follows the ground. Where the ground falls away under the line between the two
 * footings, that stretch becomes a deck sprung from the banks, not a tube at some height in between. The ends are closed
 * and sunk into the footings. If either organism dies the ridge breaks and slumps; remains leave only a low broken ridge.
 * Which pairs fuse is unchanged: this only draws the link the ecology already recorded.
 */
function Connection({ population, link, index, selected, meshes }: { population: Population; link: Link; index: number; selected: boolean; meshes: Map<string, Mesh> }) {
  const refined = useMemo(() => architectureStyle() === 'refined', [])
  const geometry = useMemo(() => {
    const a = population.organisms[link.a]!
    const b = population.organisms[link.b]!
    const d = Math.hypot(b.x - a.x, b.z - a.z)
    const ux = (b.x - a.x) / d
    const uz = (b.z - a.z) / d
    // Where each leaves: inside the plinth's edge, so the root grows out of the footing rather than butting against it.
    const start = (o: typeof a, sign: number): [number, number] => [o.x + sign * ux * o.radius * 0.34, o.z + sign * uz * o.radius * 0.34]
    const pa = start(a, 1)
    const pb = start(b, -1)
    const wander = (salt: number) => {
      const n = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453
      return n - Math.floor(n)
    }
    const bend = 0.1 * wander(5)
    const size = Math.min(a.form.size ?? 1, b.form.size ?? 1)
    const solids = new Map<string, BufferGeometry>()
    const solid = (grow: number, pose: LinkPose) => {
      const key = `${Math.round(grow * 5)}-${pose}`
      let g = solids.get(key)
      if (!g) {
        g = rootLink(pa, pb, size, Math.round(grow * 5) / 5, pose, index, bend)
        solids.set(key, g)
      }
      return g
    }
    return { solid, solids }
  }, [population, link, index])
  useEffect(
    () => () => {
      geometry.solids.forEach((g) => g.dispose())
    },
    [geometry],
  )
  const material = useMemo(() => tissue(refined), [refined])
  useEffect(() => () => material.dispose(), [material])
  const body = useRef<Mesh | null>(null)
  const drawn = useRef('')
  useFrame(() => {
    material.color.setScalar(1 - 0.16 * wetness.value)
    setUniform(material, 'pick', selected ? 1 : 0)
    const time = worldTime()
    const years = time - link.since
    const sa = organismState(population, link.a, time)
    const sb = organismState(population, link.b, time)
    let pose: LinkPose = 'live'
    if (refined) {
      const oA = population.organisms[link.a]!
      const oB = population.organisms[link.b]!
      const la = lifeStateAt(population.track[link.a]!, population.from, oA.established, oA.died, time)
      const lb = lifeStateAt(population.track[link.b]!, population.from, oB.established, oB.died, time)
      setUniform(material, 'live', Math.min(la.phase.live, lb.phase.live))
      setUniform(material, 'dead', Math.max(la.phase.dead, lb.phase.dead))
      const rank = (id: string) => (id === 'remains' ? 2 : id === 'death' ? 1 : 0)
      const worse = Math.max(rank(la.stage.id), rank(lb.stage.id))
      pose = worse === 2 ? 'ruin' : worse === 1 ? 'failed' : 'live'
    } else if (Math.min(sa.age, sb.age) > 2.4) pose = 'failed'
    // It thickens and meets in the middle over about sixty years. The height does not depend on this: see rootLink.
    const grow = Math.min(1, Math.max(0, years / 60))
    const key = years <= 0 || !sa.present || !sb.present ? 'none' : `${Math.round(grow * 5)}-${pose}`
    if (key === drawn.current) return
    drawn.current = key
    const m = body.current
    if (!m) return
    if (key === 'none') m.visible = false
    else {
      m.geometry = geometry.solid(grow, pose)
      m.visible = true
    }
    livingArchitecture.version += 1
  })
  return (
    <mesh
      ref={(m) => {
        body.current = m
        if (m) {
          m.userData.pick = { kind: 'link', index } satisfies Selection
          meshes.set(`l${index}`, m)
        } else meshes.delete(`l${index}`)
      }}
      material={material}
      castShadow
      receiveShadow
      visible={false}
    />
  )
}

/**
 * The grown form of a root connection. On ground that holds the chord between the two footings it is a low ridge, half
 * buried, flared and capped where it enters each organism. Where the ground drops well below that chord, the same body
 * becomes a deck sprung from the two banks. `grow` (0 to 1) only lengthens it from both ends and thickens it. `failed`
 * (one organism has died) breaks the middle and slumps the span. `ruin` (remains) is a low broken ridge on the ground.
 */
function rootLink(from: [number, number], to: [number, number], size: number, grow: number, pose: LinkPose, salt: number, bend: number): BufferGeometry {
  const RINGS = 56
  const SIDES = 12
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1
  const grown = Math.max(0.2, grow)
  const ruin = pose === 'ruin'
  const failed = pose === 'failed'
  const smooth = (a: number, b: number, t: number) => {
    const k = Math.min(1, Math.max(0, (t - a) / (b - a || 1)))
    return k * k * (3 - 2 * k)
  }
  const thick = (ruin ? 0.5 : 1) * (1.05 + 1.35 * size) * (0.62 + 0.38 * grown)
  const wide = (ruin ? 0.72 : 1) * (3.4 + 4.6 * size) * (0.75 + 0.25 * grown)
  const h0 = landscapeHeight(from[0], from[1])
  const h1 = landscapeHeight(to[0], to[1])
  const positions: number[] = []
  const colours: number[] = []
  const recordA: number[] = []
  const recordB: number[] = []
  const index: number[] = []
  const rings: number[] = []
  const centre: [number, number, number][] = []
  const reach = 0.5 * grown + 0.02
  for (let i = 0; i < RINGS; i += 1) {
    const t = i / (RINGS - 1)
    if ((failed || ruin) && t > 0.34 && t < 0.66) continue
    if (grown < 0.98 && t > reach && t < 1 - reach) continue
    rings.push(i)
  }
  const weathered = failed || ruin
  const push = (x: number, y: number, z: number, above: number, t: number, v: number) => {
    positions.push(x, y, z)
    const col = skin(Math.max(0, above), 0.45, 0.96, 0.55)
    colours.push(col.r, col.g, col.b)
    recordA.push(above * 0.05 + t * 0.15, weathered ? 0.26 : 0.82, weathered ? 0.55 : 0.06, 0)
    recordB.push(0.4 + 0.35 * Math.max(0, v), 0.5, ((salt * 2654435761 + Math.round(t * 180) * 97) >>> 0) / 4294967296, 0.35)
  }
  const sx = -(to[1] - from[1]) / length
  const sz = (to[0] - from[0]) / length
  for (const i of rings) {
    const t = i / (RINGS - 1)
    const sway = length * bend * Math.sin(t * Math.PI) + length * 0.01 * Math.sin(t * 7 + salt)
    const x = from[0] + (to[0] - from[0]) * t + sx * sway
    const z = from[1] + (to[1] - from[1]) * t + sz * sway
    const h = landscapeHeight(x, z)
    const chord = h0 + (h1 - h0) * t
    let span = ruin ? 0 : smooth(3.2, 7.5, chord - h)
    if (failed) span *= 0.22
    const end = Math.max(smooth(0.2, 0, t), smooth(0.8, 1, t))
    const flare = 0.4 + 1.05 * end
    const ridgeTop = h + 0.42 + thick * 0.4
    const spanTop = chord + 0.3 + thick * 0.18 + Math.sin(t * Math.PI) * Math.min(2.2, Math.max(0, chord - h) * 0.08)
    let top = ridgeTop + (spanTop - ridgeTop) * span
    top += (h + 0.38 - top) * end * 0.7
    const ridgeBottom = h - 1.15
    const spanBottom = spanTop - thick * (0.9 + 0.2 * (1 - end))
    const bottom = Math.min(ridgeBottom + (spanBottom - ridgeBottom) * span, top - 0.4)
    const hw = (wide * (0.64 + 0.65 * flare) * (1 + 0.07 * Math.sin(t * 5 + salt))) / 2
    const slot = rings.indexOf(i)
    const q = rings[Math.min(rings.length - 1, slot + 1)]!
    const o = rings[Math.max(0, slot - 1)]!
    const tx = (to[0] - from[0]) * ((q - o) / (RINGS - 1))
    const tz = (to[1] - from[1]) * ((q - o) / (RINGS - 1))
    const tl = Math.hypot(tx, tz) || 1
    const ax = -tz / tl
    const az = tx / tl
    const yc = (top + bottom) / 2
    const hh = Math.max(0.28, (top - bottom) / 2)
    for (let k = 0; k < SIDES; k += 1) {
      const angle = (k / SIDES) * Math.PI * 2
      const c = Math.cos(angle)
      const sn = Math.sin(angle)
      const u = Math.sign(c) * Math.abs(c) ** 0.42
      const v = Math.sign(sn) * Math.abs(sn) ** 0.62
      const y = yc + hh * v
      const ledge = 1 + 0.045 * (((y - h) / 2.6) % 1 < 0.55 ? 1 : -1) * Math.min(1, Math.abs(u) * 1.4)
      push(x + ax * hw * u * ledge, y, z + az * hw * u * ledge, Math.max(0, y - h), t, v)
    }
    centre.push([x, yc, z])
  }
  for (let r = 0; r < rings.length - 1; r += 1) {
    if (rings[r + 1]! - rings[r]! > 1) continue
    for (let k = 0; k < SIDES; k += 1) {
      const a = r * SIDES + k
      const b = r * SIDES + ((k + 1) % SIDES)
      index.push(a, a + SIDES, b, b, a + SIDES, b + SIDES)
    }
  }
  const cap = (ring: number, flip: boolean, bury: boolean) => {
    const c = centre[ring]!
    const t = rings[ring]! / (RINGS - 1)
    const y = bury ? landscapeHeight(c[0], c[2]) - 0.2 : c[1]
    const at = positions.length / 3
    push(c[0], y, c[2], 0.15, t, 0)
    for (let k = 0; k < SIDES; k += 1) {
      const a = ring * SIDES + k
      const b = ring * SIDES + ((k + 1) % SIDES)
      if (flip) index.push(at, b, a)
      else index.push(at, a, b)
    }
  }
  if (rings.length > 1) {
    cap(0, false, true)
    cap(rings.length - 1, true, true)
    for (let r = 0; r < rings.length - 1; r += 1) {
      if (rings[r + 1]! - rings[r]! <= 1) continue
      cap(r, true, false)
      cap(r + 1, false, false)
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
    let down: { x: number; y: number; moved: number; wasLocked: boolean } | null = null
    const locked = () => document.pointerLockElement === element
    const press = (event: PointerEvent) => {
      if (event.button === 0) down = { x: event.clientX, y: event.clientY, moved: 0, wasLocked: locked() }
    }
    const move = (event: PointerEvent) => {
      if (down && locked()) down.moved += Math.abs(event.movementX) + Math.abs(event.movementY)
    }
    const release = (event: PointerEvent) => {
      if (!down || event.button !== 0) return
      // (A click the Vegetation inspector has taken for a plant selects no structure: vegInspect.ts › plantClick.)
      if (plantClick.claimed) {
        down = null
        return
      }
      // How It's Made inspects structures with its own card (dataProbe.tsx): no selection, no Living Architecture popup there.
      if (getExperience() === 'made') {
        down = null
        return
      }
      const drag = locked() ? down.moved : Math.hypot(event.clientX - down.x, event.clientY - down.y)
      // The click that took the mouse back (the pointer was free when it went down and is locked now) only recaptures it: it picks nothing.
      const recapture = !down.wasLocked && locked()
      down = null
      if (drag > 6 || recapture) return
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
