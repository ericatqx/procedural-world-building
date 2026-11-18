import { Html, Line, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BufferAttribute, BufferGeometry, Color, type MeshStandardMaterial } from 'three'
import { Disclosure, ControlField, ExerciseHeading, InstrumentPanel, PanelSection, Slider, ViewTools, AUTO_ROTATE_SPEED, type ExerciseAbout } from '../shared/ui/instrument.tsx'
import { sunAt } from '../project/sun.ts'
import { createGrownMaterial } from '../project03/livingMaterial.ts'
import { createLifecycleMaterial } from './lifecycleMaterial.ts'
import { lifeAt, MATURITY, STAGES, STAGE_SAMPLES, stageOf as lifeStage } from './lifecycle.ts'
import { landscapeHeight, setTerrainCarve, setTerrainSeed } from '../project03/terrain.ts'
import { EXCLUDED, FAMILIES, NEUTRAL, PRESETS, SPECIMEN_SITE, TERRAIN_SEED, layoutSites, type FamilyId, type Habitat, type HabitatKey, type OverhangVariant } from './families.ts'
import { LabPool } from './labPool.ts'
import { CONTROL_SPEC, controlsFor, REFERENCE_CONTROLS, type StrataControls } from './strataDesign.ts'
import { OVERHANG_SLIDERS, SUPPORTS, type OverhangOverrides } from './overhangControls.ts'
import type { LabIn, LabOut, PackedMesh, Spec } from './labWorker.ts'
import { ROWS, SHEET_ROWS, explain, type Measure } from './compareText.ts'
import '../shared/ui/system.css'
import '../vegetation-lab/vlab.css'
import './alab.css'

const ABOUT: ExerciseAbout = {
  text: 'A workspace for how a Living Architecture organism takes its form, not a world version: specimens stand on a small stage (a patch of the island’s own ground, with no island, water, plants or other organisms). Two families: Overhang (the world’s own generator, refined so that the seed chooses the arrangement of its masses, cantilever and supports; the original is kept for comparison) and Porous Growth (designed first: a vertical cluster of tiered towers grown together, with bridges, a buttress and large openings). Seed picks the individual; habitat is what the place gives it; growth scrubs through its development. Compare puts two specimens on one stage, and the contact sheet shows six, grown in parallel and remembered, so coming back to a view is instant.',
  terms: 'family · composition · seed · habitat · growth · cantilever · pier · window · rib · toe · contact sheet',
  controls: 'R auto rotate · F wireframe · G reference · drag orbit · right-drag pan · scroll zoom',
}

type Status = { state: 'idle' | 'growing' | 'ready' | 'error'; id: number; ms?: number; message?: string; ground?: number; stats?: Record<string, number | string>[]; measures?: (Measure | null)[] }
type Shown = { geometries: BufferGeometry[]; ages: number[]; id: number; ms: number; width: number; depth: number; top: number; tops: number[] }
type View = 'single' | 'compare' | 'sheet'
type CompareMode = 'seed' | 'habitat' | 'family' | 'version'
type SheetMode = 'seeds' | 'habitats' | 'ages' | 'families' | 'versions'
const SHEET_AGES = [0.25, 0.45, 0.65, 0.85, 1, 1.25]

const HABITAT_FIELDS: Record<HabitatKey, { label: string; min: number; max: number; step: number; tip: string; show: (v: number) => string }> = {
  light: { label: 'Light', min: 0, max: 1, step: 0.01, tip: 'Open to shaded. Lit organisms reach out; shaded ones reach up.', show: (v) => v.toFixed(2) },
  moisture: { label: 'Moisture', min: 0, max: 1, step: 0.01, tip: 'Dry to damp: a broader base and more openings where it is wet.', show: (v) => v.toFixed(2) },
  resource: { label: 'Soil and water supply', min: 0, max: 1, step: 0.01, tip: 'Poor to rich ground: richer ground builds more, and an outlier body.', show: (v) => v.toFixed(2) },
  ridge: { label: 'Exposure', min: -1, max: 1, step: 0.02, tip: 'Hollow (-1) to ridge (+1): exposed ground grows broad and low, sheltered ground narrow and tall.', show: (v) => v.toFixed(2) },
  crowding: { label: 'Crowding', min: 0, max: 1, step: 0.01, tip: 'Neighbours shade and press it: lower, denser, lopsided.', show: (v) => v.toFixed(2) },
  waterDist: { label: 'Distance to water', min: 28, max: 400, step: 2, tip: 'A lake is placed this far from the specimen, on its +x/-z side: roots and toes reach toward it, and near it the organism anchors at the edge. At 400 m there is none.', show: (v) => (v >= 400 ? 'none near' : `${Math.round(v)} m`) },
  size: { label: 'Size', min: 0.55, max: 1.2, step: 0.01, tip: 'Metres of organism per unit: the same tissue at a smaller or larger scale.', show: (v) => v.toFixed(2) },
}

/** A patch of the island's own ground around the specimen's site: what the generators sampled, and nothing else of the island. */
function groundPatch(): BufferGeometry {
  const half = 200
  const step = 4
  const n = Math.round((half * 2) / step) + 1
  const pos = new Float32Array(n * n * 3)
  const col = new Float32Array(n * n * 3)
  const tone = new Color()
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const x = SPECIMEN_SITE[0] - half + i * step
      const z = SPECIMEN_SITE[1] - half + j * step
      const y = landscapeHeight(x, z)
      const k = (j * n + i) * 3
      pos[k] = x
      pos[k + 1] = y
      pos[k + 2] = z
      const fade = Math.min(1, Math.max(0, (half - Math.hypot(x - SPECIMEN_SITE[0], z - SPECIMEN_SITE[1])) / 24))
      tone.setRGB(0.26, 0.245, 0.22).multiplyScalar(0.55 + 0.45 * fade)
      col[k] = tone.r
      col[k + 1] = tone.g
      col[k + 2] = tone.b
    }
  }
  const index: number[] = []
  for (let j = 0; j < n - 1; j += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      const cx = SPECIMEN_SITE[0] - half + (i + 0.5) * step
      const cz = SPECIMEN_SITE[1] - half + (j + 0.5) * step
      if (Math.hypot(cx - SPECIMEN_SITE[0], cz - SPECIMEN_SITE[1]) > half) continue
      const a = j * n + i
      index.push(a, a + n, a + 1, a + 1, a + n, a + n + 1)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('color', new BufferAttribute(col, 3))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

function unpack(mesh: PackedMesh): BufferGeometry {
  const g = new BufferGeometry()
  for (const [name, a] of Object.entries(mesh.attributes)) g.setAttribute(name, new BufferAttribute(a.array, a.itemSize))
  if (mesh.index) g.setIndex(new BufferAttribute(mesh.index, 1))
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

/** A person and a ruler beside the specimen, on the ground there, for scale. */
function Reference({ ground, size }: { ground: number; size: number }) {
  const x = SPECIMEN_SITE[0] - 0.5 * size
  const z = SPECIMEN_SITE[1] + 0.42 * size
  const y = landscapeHeight(x, z)
  void ground
  return (
    <group position={[x, y, z]}>
      <Line points={[[0, 0, 0], [0, 10, 0]]} color="#a7a294" lineWidth={1.2} />
      {Array.from({ length: 11 }, (_, i) => i).map((h) => (
        <Line key={h} points={[[0, h, 0], [h % 5 === 0 ? 1.2 : 0.6, h, 0]]} color="#a7a294" lineWidth={1} />
      ))}
      <Html position={[1.5, 10, 0]} zIndexRange={[10, 0]}>
        <span className="ref-label">10 m</span>
      </Html>
      <mesh position={[2.4, 0.875, 0]}>
        <capsuleGeometry args={[0.24, 1.27, 4, 10]} />
        <meshStandardMaterial color="#c8b68e" roughness={0.9} />
      </mesh>
      <Html position={[2.4, 2.2, 0]} zIndexRange={[10, 0]}>
        <span className="ref-label">person 1.75 m</span>
      </Html>
    </group>
  )
}

/** Frames the specimens once their first meshes of a view have come (from what they measure), and not again as sliders move. */
function CameraRig({ frameKey, size, ground, high }: { frameKey: string; size: number; ground: number; high: boolean }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { target: { set: (x: number, y: number, z: number) => void }; update: () => void } | null
  const latest = useRef({ size, ground, high })
  latest.current = { size, ground, high }
  useLayoutEffect(() => {
    const [sx, sz] = SPECIMEN_SITE
    const { size: s, ground: g, high: hi } = latest.current
    const d = Math.max(40, s * (hi ? 2.05 : 2.7))
    // Seen from the side of the organism's own frame (its shelves reach toward the day's mean sun), so a cantilever is in profile.
    let lx = 0
    let lz = 0
    for (const hour of [8, 10, 12, 14, 16]) {
      const sd = sunAt(hour, 55).direction
      lx += sd[0]
      lz += sd[2]
    }
    const ll = Math.hypot(lx, lz) || 1
    let bx = lz / ll
    let bz = -lx / ll
    if (bz < 0) {
      bx = -bx
      bz = -bz
    }
    const cx = bx * 0.95 + (lx / ll) * 0.3
    const cz = bz * 0.95 + (lz / ll) * 0.3
    const cl = Math.hypot(cx, cz)
    camera.position.set(sx + (cx / cl) * d, g + s * 0.3 + d * (hi ? 0.72 : 0.16), sz + (cz / cl) * d)
    controls?.target.set(sx, g + s * 0.15, sz)
    controls?.update()
  }, [camera, controls, frameKey])
  return null
}

/** One material for each specimen, so each draws at its own place in its lifecycle (the Overhang) or its own growth age (Porous Growth). */
function Specimens({ shown, wireframe, labels, kinds }: { shown: Shown; wireframe: boolean; labels: string[]; kinds: FamilyId[] }) {
  const n = shown.geometries.length
  const rigs = useMemo(() => {
    return Array.from({ length: n }, (_, i) => {
      const age = { value: 1 }
      const live = { value: 1 }
      const dead = { value: 0 }
      const material = kinds[i] === 'overhang' ? createLifecycleMaterial(age, live, dead) : (createGrownMaterial(age) as MeshStandardMaterial)
      return { age, live, dead, material }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, kinds.join('|')])
  useEffect(() => () => rigs.forEach((r) => r.material.dispose()), [rigs])
  useFrame(() => {
    rigs.forEach((r, i) => {
      const L = shown.ages[i] ?? shown.ages[0] ?? 1
      if (kinds[i] === 'overhang') {
        const p = lifeAt(L)
        r.age.value = p.age
        r.live.value = p.live
        r.dead.value = p.dead
      } else r.age.value = Math.min(1.5, L)
      r.material.wireframe = wireframe
    })
  })
  const sites = layoutSites(n)
  return (
    <>
      {shown.geometries.map((g, i) => (rigs[i] ? <mesh key={i} geometry={g} material={rigs[i]!.material} castShadow receiveShadow frustumCulled={false} /> : null))}
      {n > 1
        ? shown.geometries.map((_, i) => (
            <Html key={`l${i}`} position={[sites[i]![0], (shown.tops[i] ?? shown.top) + 4, sites[i]![1]]} zIndexRange={[10, 0]} center>
              <span className="ref-label">{labels[i] ?? ''}</span>
            </Html>
          ))
        : null}
    </>
  )
}

/** Debounces a value: the UI shows every change at once, the expensive work follows the last one. */
function useDebounced<T>(value: T, ms: number): T {
  const [d, setD] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setD(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return d
}

const stageOf = (stages: [number, string][], age: number) => (stages.find(([upTo]) => age <= upTo) ?? stages[stages.length - 1]!)[1]
const habitatFull = (h: Habitat): Habitat => ({ ...NEUTRAL, ...h, waterDist: (h.waterDist ?? 400) >= 400 ? null : h.waterDist })
const presetHabitat = (id: string): Habitat => {
  const p = PRESETS.find((q) => q.id === id) ?? PRESETS[0]!
  return habitatFull({ ...NEUTRAL, ...p.habitat, waterDist: p.habitat.waterDist === null ? 400 : (p.habitat.waterDist ?? NEUTRAL.waterDist ?? 400) })
}

export function ArchitectureLab({ tabs }: { tabs: ReactNode }) {
  const [familyId, setFamilyId] = useState<FamilyId>('overhang')
  const family = FAMILIES.find((f) => f.id === familyId)!
  const [variant, setVariant] = useState<OverhangVariant>('refined')
  const [seed, setSeed] = useState(7)
  // Strata: the morphology controls set by hand (the others come from the seed).
  const [morph, setMorph] = useState<Partial<StrataControls>>({})
  // Overhang: morphology set by hand, applied over what the seed and habitat grew (empty: exactly as grown).
  const [ovr, setOvr] = useState<OverhangOverrides>({})
  const [habitat, setHabitat] = useState<Habitat>(NEUTRAL)
  const [presetA, setPresetA] = useState<string | null>('reference')
  const [ages, setAges] = useState<Record<FamilyId, number>>({ overhang: 0.54, porous: 1, strata: 1 })
  const age = ages[familyId]
  const [view, setView] = useState<View>('single')
  const [cmpMode, setCmpMode] = useState<CompareMode>('seed')
  const [cmpPreset, setCmpPreset] = useState('ridge')
  const [cmpSeed, setCmpSeed] = useState(23)
  const [sheetMode, setSheetMode] = useState<SheetMode>('seeds')
  const [status, setStatus] = useState<Status>({ state: 'idle', id: 0 })
  const [shown, setShown] = useState<Shown | null>(null)
  const [reference, setReference] = useState(true)
  const [wireframe, setWireframe] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [frame, setFrame] = useState<{ key: string; size: number } | null>(null)

  const slow = familyId === 'overhang'
  // The sliders show every change at once; the specimens regrow from the last one (a short pause), never from the ones in between.
  const dSeed = useDebounced(seed, 220)
  const dHabitat = useDebounced(habitat, 220)
  const dMorph = useDebounced(morph, 220)
  const dOvr = useDebounced(ovr, 220)
  const pending = dSeed !== seed || dHabitat !== habitat || dMorph !== morph || dOvr !== ovr
  const effView: View = view

  // What is grown: one, two or six specimens, each a spec with its own seed, habitat and family, standing where the layout puts it.
  const plan = useMemo(() => {
    const hab = habitatFull(dHabitat)
    const seed = dSeed
    const mk = (family: FamilyId, s: number, h: Habitat, label: string, a?: number, v: OverhangVariant = variant) => ({ family, seed: s, habitat: h, label, age: a, variant: v })
    let list: ReturnType<typeof mk>[]
    const other: FamilyId = familyId === 'overhang' ? 'porous' : 'overhang'
    if (effView === 'single') list = [mk(familyId, seed, hab, `seed ${seed}`)]
    else if (effView === 'compare') {
      list =
        cmpMode === 'seed'
          ? [mk(familyId, seed, hab, `A · seed ${seed}`), mk(familyId, cmpSeed, hab, `B · seed ${cmpSeed}`)]
          : cmpMode === 'habitat'
            ? [mk(familyId, seed, hab, `A · seed ${seed}, your habitat`), mk(familyId, seed, presetHabitat(cmpPreset), `B · seed ${seed}, ${PRESETS.find((p) => p.id === cmpPreset)?.label}`)]
            : cmpMode === 'version'
              ? [mk('overhang', seed, hab, `A · original, seed ${seed}`, undefined, 'original'), mk('overhang', seed, hab, `B · refined, seed ${seed}`, undefined, 'refined')]
              : [mk(familyId, seed, hab, `A · ${family.label}`), mk(other, seed, hab, `B · ${FAMILIES.find((f) => f.id === other)!.label}`)]
    } else if (sheetMode === 'seeds') list = Array.from({ length: 6 }, (_, i) => mk(familyId, seed + i, hab, `seed ${seed + i}`))
    else if (sheetMode === 'habitats') list = [mk(familyId, seed, hab, 'your habitat'), ...PRESETS.map((p) => mk(familyId, seed, presetHabitat(p.id), p.label))]
    else if (sheetMode === 'ages') list = familyId === 'overhang' ? STAGE_SAMPLES.map((a) => mk(familyId, seed, hab, lifeStage(a).label, a)) : SHEET_AGES.map((a) => mk(familyId, seed, hab, `age ${a.toFixed(2)}`, a))
    else if (sheetMode === 'versions') list = [0, 1, 2].map((i) => mk('overhang', seed + i, hab, `original · seed ${seed + i}`, undefined, 'original')).concat([0, 1, 2].map((i) => mk('overhang', seed + i, hab, `refined · seed ${seed + i}`, undefined, 'refined')))
    else {
      const second: FamilyId = familyId === 'strata' ? 'strata' : 'porous'
      const label = second === 'strata' ? 'Strata' : 'Porous'
      list = [0, 1, 2].map((i) => mk('overhang', seed + i, hab, `Overhang · seed ${seed + i}`)).concat([0, 1, 2].map((i) => mk(second, seed + i, hab, `${label} · seed ${seed + i}`)))
    }
    const sites = layoutSites(list.length)
    const specs: Spec[] = list.map((s, i) => ({ family: s.family, variant: s.variant, seed: s.seed, habitat: s.habitat, site: sites[i]!, ...(s.family === 'strata' ? { morph: dMorph } : {}), ...(s.family === 'overhang' && Object.keys(dOvr).length > 0 ? { overhang: dOvr } : {}) }))
    return { specs, labels: list.map((s) => s.label), fixedAges: list.map((s) => s.age), kinds: list.map((s) => s.family) }
  }, [familyId, family.label, variant, effView, cmpMode, cmpPreset, cmpSeed, sheetMode, dSeed, dHabitat, dMorph, dOvr])
  const agesNow = useMemo(() => plan.fixedAges.map((a, i) => a ?? ages[plan.kinds[i]!]), [plan, ages])

  const worker = useRef<LabPool | null>(null)
  const growId = useRef(0)
  const requestSeq = useRef(0)
  const growStart = useRef(0)
  const lastGrow = useRef(0)
  const firstShown = useRef(0)
  const [total, setTotal] = useState<{ ms: number; grow: number } | null>(null)
  const inflight = useRef(false)
  const wanted = useRef<{ id: number; ages: number[] } | null>(null)
  const cache = useRef(new Map<string, Shown>())
  const step = family.age.step
  const keyOf = (id: number, a: number[]) => `${id}:${a.map((x) => Math.round(x / step)).join('|')}`

  const ground = useMemo(() => {
    setTerrainSeed(TERRAIN_SEED)
    setTerrainCarve(null)
    return { geometry: groundPatch(), y: landscapeHeight(...SPECIMEN_SITE) }
  }, [])
  useEffect(() => () => ground.geometry.dispose(), [ground])

  const dispose = (s: Shown) => s.geometries.forEach((g) => g.dispose())
  const pump = useCallback(() => {
    const w = worker.current
    const want = wanted.current
    if (!w || !want || inflight.current || want.id !== growId.current) return
    const hit = cache.current.get(keyOf(want.id, want.ages))
    if (hit) {
      setShown(hit)
      return
    }
    inflight.current = true
    requestSeq.current += 1
    const message: LabIn = { type: 'mesh', id: want.id, req: requestSeq.current, ages: want.ages }
    w.postMessage(message)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // One worker for the lab's lifetime, ended with it.
  useEffect(() => {
    const w = new LabPool()
    worker.current = w
    const store = cache.current
    w.onmessage = (event: { data: LabOut }) => {
      const m = event.data
      if (m.type === 'error') {
        if (m.id === growId.current) setStatus({ state: 'error', id: m.id, message: m.message })
        inflight.current = false
        return
      }
      if (m.id !== growId.current) {
        inflight.current = false
        return
      }
      if (m.type === 'grown') {
        lastGrow.current = m.ms
        setStatus({ state: 'ready', id: m.id, ms: m.ms, ground: m.ground, stats: m.stats, measures: m.measures })
        pump()
        return
      }
      inflight.current = false
      const geometries = m.meshes.map(unpack)
      let w0 = 0
      let d0 = 0
      let top = 0
      const tops: number[] = []
      for (const g of geometries) {
        const b = g.boundingBox!
        w0 = Math.max(w0, b.max.x - b.min.x)
        d0 = Math.max(d0, b.max.z - b.min.z)
        top = Math.max(top, b.max.y)
        tops.push(b.max.y)
      }
      const item: Shown = { geometries, ages: m.ages, id: m.id, ms: m.ms, width: w0, depth: d0, top, tops }
      for (const [k, v] of store) {
        if (v.id !== m.id) {
          dispose(v)
          store.delete(k)
        }
      }
      if (store.size > 24) {
        const first = store.keys().next().value
        if (first) {
          dispose(store.get(first)!)
          store.delete(first)
        }
      }
      store.set(keyOf(m.id, m.ages), item)
      if (firstShown.current !== m.id) {
        firstShown.current = m.id
        setTotal({ ms: Math.round(performance.now() - growStart.current), grow: lastGrow.current })
      }
      setShown(item)
      pump()
    }
    return () => {
      w.terminate()
      worker.current = null
      for (const v of store.values()) dispose(v)
      store.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pump])

  // What is grown regrows it: the specs (not the age) are the key.
  const inputs = useMemo(() => JSON.stringify(plan.specs), [plan])
  useEffect(() => {
    const timer = setTimeout(() => {
      const id = growId.current + 1
      growId.current = id
      inflight.current = false
      setStatus({ state: 'growing', id })
      growStart.current = performance.now()
      firstShown.current = 0
      const message: LabIn = { type: 'grow', id, specs: plan.specs, slots: plan.specs.map((_, i) => i) }
      worker.current?.postMessage(message)
    }, 40)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs])

  // Age: scrubs the specimens through their real development (a new mesh set for each step), most recent request first.
  useEffect(() => {
    wanted.current = { id: growId.current, ages: agesNow }
    if (status.state === 'ready') pump()
  }, [agesNow, status.state, status.id, pump])

  useEffect(() => {
    if (status.state !== 'growing') {
      setElapsed(0)
      return
    }
    const t0 = performance.now()
    const timer = setInterval(() => setElapsed(Math.round((performance.now() - t0) / 1000)), 500)
    return () => clearInterval(timer)
  }, [status.state, status.id])

  const frameKey = `${familyId}-${effView}`
  useEffect(() => {
    if (!shown || status.ground === undefined || frame?.key === frameKey || shown.geometries.length !== plan.specs.length) return
    const n = shown.geometries.length
    const span = n === 1 ? 0 : n === 2 ? 100 + shown.width * 0.6 : 215
    setFrame({ key: frameKey, size: Math.max(20, shown.width, shown.depth, shown.top - status.ground, span) })
  }, [shown, status.ground, frameKey, frame, plan])

  const setHab = (patch: Partial<Habitat>) => {
    setPresetA(null)
    setHabitat((h) => ({ ...h, ...patch }))
  }
  const unused = (['light', 'moisture', 'resource', 'ridge', 'crowding', 'waterDist', 'size'] as HabitatKey[]).filter((k) => !family.habitat.includes(k))
  const measures = (status.measures ?? []).filter((m): m is Measure => !!m)
  const sentences = effView === 'compare' && measures.length === 2 ? explain(measures[0]!, measures[1]!, 'A', 'B') : []
  const dims = shown && status.ground !== undefined ? { w: Math.max(shown.width, shown.depth), h: Math.max(0, shown.top - status.ground) } : null
  const many = (shown?.geometries.length ?? 0) > 1

  return (
    <div className="app-shell ui-system vlab alab">
      <div className="viz-stage">
        <div className="world-canvas-wrap">
          <Canvas className="world-canvas" shadows camera={{ position: [SPECIMEN_SITE[0] + 62, ground.y + 34, SPECIMEN_SITE[1] + 108], fov: 38, near: 0.5, far: 3000 }} gl={{ antialias: true }}>
            <color attach="background" args={['#050608']} />
            <hemisphereLight args={['#c9cfdc', '#2a2824', 0.7]} />
            <ambientLight intensity={0.25} />
            <directionalLight
              position={[SPECIMEN_SITE[0] + 120, ground.y + 150, SPECIMEN_SITE[1] + 70]}
              intensity={2.4}
              color="#fff4e2"
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-camera-left={-190}
              shadow-camera-right={190}
              shadow-camera-top={190}
              shadow-camera-bottom={-190}
              shadow-camera-near={20}
              shadow-camera-far={600}
              shadow-bias={-0.0005}
              shadow-normalBias={0.6}
            />
            <mesh geometry={ground.geometry} receiveShadow>
              <meshStandardMaterial vertexColors roughness={1} side={2} />
            </mesh>
            {shown ? <Specimens shown={shown} wireframe={wireframe} labels={plan.labels} kinds={plan.specs.map((x) => x.family)} /> : null}
            {reference ? <Reference ground={ground.y} size={frame?.size ?? 60} /> : null}
            {frame ? <CameraRig frameKey={frame.key} size={frame.size} ground={ground.y} high={effView === 'sheet'} /> : null}
            <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={4} maxDistance={900} maxPolarAngle={Math.PI * 0.495} autoRotate={autoRotate} autoRotateSpeed={AUTO_ROTATE_SPEED} />
          </Canvas>
          {pending || status.state === 'growing' ? <div className="alab-busy" role="status">{pending ? 'Regenerating specimen…' : 'Generating specimen…'}</div> : null}
          <ViewTools
            tools={[
              { label: 'Auto rotate', key: 'R', on: autoRotate, onChange: setAutoRotate },
              { label: 'Wireframe', key: 'F', on: wireframe, onChange: setWireframe },
              { label: 'Reference', key: 'G', on: reference, onChange: setReference },
            ]}
          >
            <p className="readout" aria-live="polite">
              <span>{family.label}{familyId === 'overhang' ? (variant === 'refined' ? ' (refined)' : ' (original)') : ''}</span>
              <span>{effView === 'single' ? `seed ${seed}` : effView === 'compare' ? 'comparing A and B' : `sheet: ${sheetMode}`}</span>
              <span>{familyId === 'overhang' ? '' : `${family.age.label.toLowerCase()} `}{effView === 'sheet' && sheetMode === 'ages' ? 'by sheet' : familyId === 'overhang' ? lifeStage(shown?.ages[0] ?? age).label : (shown?.ages[0] ?? age).toFixed(2)}</span>
              {dims && !many ? <span>{dims.w.toFixed(0)} m wide · {dims.h.toFixed(0)} m high</span> : null}
              <span>{pending ? 'regenerating…' : status.state === 'growing' ? `growing… ${elapsed}s` : status.state === 'error' ? 'error' : shown ? `ready in ${total ? (total.ms / 1000).toFixed(1) : '?'} s (grown ${total ? (total.grow / 1000).toFixed(1) : '?'} s · meshed ${shown.ms} ms)` : ''}</span>
            </p>
          </ViewTools>
        </div>
      </div>

      <div className="app-chrome">
        <div className="region-left">
          <ExerciseHeading title="Architecture Lab" about={ABOUT} />
          {tabs}
        </div>

        <InstrumentPanel label="Living Architecture">
          <PanelSection index="01" title="Morphology" tip="Two families. Overhang is the world's own generator, refined with a seed-chosen composition (the original stays for comparison). Porous Growth is the lab's new family.">
            <div data-group>
              <div className="choice-grid" role="group" aria-label="Morphology family">
                {FAMILIES.map((f) => (
                  <button key={f.id} type="button" className="choice" aria-pressed={f.id === familyId} onClick={() => { setFamilyId(f.id); setShown(null) }}>
                    {f.label}
                  </button>
                ))}
              </div>
              {familyId === 'overhang' ? (
                <div className="choice-grid" role="group" aria-label="Overhang form">
                  <button type="button" className="choice" aria-pressed={variant === 'refined'} title="The world's generator with a composition chosen from the seed." onClick={() => { setVariant('refined'); setShown(null) }}>
                    Refined
                  </button>
                  <button type="button" className="choice" aria-pressed={variant === 'original'} title="The world's own generator, unchanged." onClick={() => { setVariant('original'); setShown(null) }}>
                    Original (world)
                  </button>
                </div>
              ) : null}
              <p className="note">{family.summary}</p>
              <p className="note"><b>Growth.</b> {family.growth}</p>
              <p className="note"><b>Status.</b> {family.status}</p>
            </div>
          </PanelSection>

          <PanelSection index="02" title={familyId === 'overhang' ? 'Lifecycle' : 'Growth'} tip={familyId === 'overhang' ? 'One slider from establishment to mineral remains. Up to maturity the one mature form is revealed from the roots outward; past it the generator builds a new mesh (weathering, then structural failure).' : 'How far the specimens have developed. Each step is a real mesh from the generator, not a scaled one.'}>
            <div data-group>
              {familyId === 'strata' ? null : (
                <ControlField label={family.age.label} value={effView === 'sheet' && sheetMode === 'ages' ? 'set by the sheet' : familyId === 'overhang' ? lifeStage(age).label : age.toFixed(2)} tip={familyId === 'overhang' ? 'Maturity (the approved form) is marked on the scale.' : '0 is a seed; 1 is the mature form.'}>
                  <Slider label={family.age.label} min={family.age.min} max={family.age.max} step={family.age.step} value={age} onChange={(v) => setAges((a) => ({ ...a, [familyId]: v }))} />
                </ControlField>
              )}
              {familyId === 'overhang' ? (
                <>
                  <div className="alab-bar" aria-hidden="true">
                    {STAGES.map((st) => (
                      <span key={st.id} className={`alab-seg${lifeStage(age).id === st.id ? ' on' : ''}${st.id === 'maturity' ? ' milestone' : ''}`} style={{ width: `${(st.to - st.from) * 100}%` }} />
                    ))}
                  </div>
                  <ol className="alab-stagelist" aria-label="Lifecycle stages">
                    {STAGES.map((st, i) => (
                      <li key={st.id} className={lifeStage(age).id === st.id ? 'on' : ''}>
                        <button type="button" onClick={() => setAges((x) => ({ ...x, overhang: st.id === 'maturity' ? MATURITY + 0.04 : (st.from + st.to) / 2 }))} aria-current={lifeStage(age).id === st.id ? 'step' : undefined}>
                          <b>{i + 1}</b>
                          <span className="name">{st.label}{st.id === 'maturity' ? ' ◆' : ''}</span>
                          <span className="desc">{st.short}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              ) : null}
              {familyId === 'overhang' ? null : <p className="note"><b>Stage.</b> {`${stageOf(family.age.stages, age)}.`}</p>}
              {status.state === 'growing' ? <p className="note">{slow ? 'Growing the Overhang: a few seconds for each specimen. The last form stays until it is ready.' : 'Growing…'}</p> : null}
              {status.state === 'error' ? <p className="note">The generator stopped: {status.message}</p> : null}
            </div>
          </PanelSection>

          <PanelSection index="03" title="Individual" tip="Seed is one individual of the family: how many shoots, which rise and which reach, where shelves aim, where it branches and fuses. The same seed under another habitat keeps its identity.">
            <div data-group>
              <ControlField label="Seed" value={`${seed}`}>
                <Slider label="Seed" min={1} max={99} step={1} value={seed} onChange={setSeed} />
              </ControlField>
              <div className="note">
                <button type="button" className="text-button" onClick={() => setSeed(1 + Math.floor(Math.random() * 99))}>
                  Random seed
                </button>
              </div>
              {familyId === 'overhang' ? (
                <>
                  {OVERHANG_SLIDERS.map((c) => {
                    const value = ovr[c.key] ?? 1
                    return (
                      <ControlField key={c.key} label={c.label} value={value === 1 ? '× 1.00 · as grown' : `× ${value.toFixed(2)}`} tip={c.tip}>
                        <Slider label={c.label} min={c.min} max={c.max} step={0.01} value={value} onChange={(v) => setOvr((o) => ({ ...o, [c.key]: v }))} />
                      </ControlField>
                    )
                  })}
                  <div className="choice-grid" role="group" aria-label="Supports">
                    <button type="button" className="choice" aria-pressed={ovr.supports === undefined} title="As the seed grew them." onClick={() => setOvr(({ supports: _s, ...o }) => o)}>
                      Seed supports
                    </button>
                    {SUPPORTS.map((s) => (
                      <button key={s.value} type="button" className="choice" aria-pressed={ovr.supports === s.value} title={s.tip} onClick={() => setOvr((o) => ({ ...o, supports: s.value }))}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <div className="note">
                    <button type="button" className="text-button" onClick={() => setOvr({})}>
                      Reset to seed
                    </button>
                  </div>
                  <p className="note">Multipliers on what the seed and habitat grew (× 1 is exactly as grown), for every specimen in view and every lifecycle stage. Lab only.</p>
                </>
              ) : null}
              {familyId === 'strata' ? (
                <>
                  {CONTROL_SPEC.map((c) => {
                    const value = controlsFor(seed, morph)[c.key]
                    const set = morph[c.key] !== undefined
                    return (
                      <ControlField key={c.key} label={c.label} value={`${c.key === 'tiers' ? Math.round(value) : value.toFixed(2)}${set ? ' · set' : ''}`} tip={c.tip}>
                        <Slider label={c.label} min={c.min} max={c.max} step={c.step} value={value} onChange={(v) => setMorph((m) => ({ ...m, [c.key]: v }))} />
                      </ControlField>
                    )
                  })}
                  <div className="note">
                    <button type="button" className="text-button" onClick={() => setMorph({})}>
                      From the seed
                    </button>{' '}
                    ·{' '}
                    <button type="button" className="text-button" onClick={() => setMorph({ ...REFERENCE_CONTROLS })}>
                      Reference (Strata Refined)
                    </button>
                  </div>
                  <p className="note">The seed draws every control; moving one sets it by hand (marked “set”) for every specimen in view. The joints are derived, so the leg and the shelves stay attached.</p>
                </>
              ) : null}
            </div>
          </PanelSection>

          <PanelSection index="04" title="Habitat" tip="What the place gives the organism. Both families read all of these; each regrows the specimens.">
            <div data-group>
              <div className="choice-grid" role="group" aria-label="Habitat preset">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="choice"
                    aria-pressed={presetA === p.id}
                    title={p.note}
                    onClick={() => {
                      setPresetA(p.id)
                      setHabitat({ ...NEUTRAL, ...p.habitat, waterDist: p.habitat.waterDist === null ? 400 : (p.habitat.waterDist ?? NEUTRAL.waterDist ?? 400) })
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="note"><b>{presetA ? PRESETS.find((q) => q.id === presetA)?.label : 'Custom habitat'}.</b> {presetA ? PRESETS.find((q) => q.id === presetA)?.rule : 'Each slider acts on the growth rules: light turns shoots to the sun, exposure lowers and thickens them, moisture opens the tissue, crowding turns shoots away from neighbours, water draws toes and roots.'}</p>
              {family.habitat.map((k) => {
                const f = HABITAT_FIELDS[k]
                const value = k === 'waterDist' ? (habitat.waterDist ?? 400) : (habitat[k] as number)
                return (
                  <ControlField key={k} label={f.label} value={f.show(value)} tip={f.tip}>
                    <Slider label={f.label} min={f.min} max={k === 'waterDist' ? 400 : f.max} step={f.step} value={value} onChange={(v) => setHab(k === 'waterDist' ? { waterDist: v } : ({ [k]: v } as Partial<Habitat>))} />
                  </ControlField>
                )
              })}
              {unused.length > 0 ? <p className="note"><b>Not read by {family.label}:</b> {unused.map((k) => HABITAT_FIELDS[k].label.toLowerCase()).join(', ')}.</p> : null}
              <div className="note">
                <button type="button" className="text-button" onClick={() => { setPresetA('reference'); setHabitat(NEUTRAL) }}>
                  Reset habitat
                </button>
              </div>
            </div>
          </PanelSection>

          <PanelSection index="05" title="Compare" tip="Evaluate specimens together on one stage, at one scale and camera: one specimen, two to compare, or a contact sheet of six.">
            <div data-group>
              <div className="choice-grid" role="group" aria-label="View">
                {(['single', 'compare', 'sheet'] as View[]).map((v) => (
                  <button key={v} type="button" className="choice" aria-pressed={effView === v} onClick={() => setView(v)}>
                    {v === 'single' ? 'One' : v === 'compare' ? 'Compare two' : 'Contact sheet'}
                  </button>
                ))}
              </div>
              {effView === 'compare' ? (
                <>
                  <div className="choice-grid" role="group" aria-label="Compare what">
                    {(familyId === 'overhang' ? (['seed', 'habitat', 'family', 'version'] as CompareMode[]) : (['seed', 'habitat', 'family'] as CompareMode[])).map((m) => (
                      <button key={m} type="button" className="choice" aria-pressed={cmpMode === m} onClick={() => setCmpMode(m)}>
                        {m === 'seed' ? 'Two seeds' : m === 'habitat' ? 'Two habitats' : m === 'family' ? 'Two families' : 'Original vs refined'}
                      </button>
                    ))}
                  </div>
                  {cmpMode === 'seed' ? (
                    <ControlField label="Seed for B" value={`${cmpSeed}`}>
                      <Slider label="Seed for B" min={1} max={99} step={1} value={cmpSeed} onChange={setCmpSeed} />
                    </ControlField>
                  ) : cmpMode === 'habitat' ? (
                    <>
                      <p className="note">A is seed {seed} in your habitat. B is the same seed in:</p>
                      <div className="choice-grid" role="group" aria-label="Habitat for B">
                        {PRESETS.map((p) => (
                          <button key={p.id} type="button" className="choice" aria-pressed={cmpPreset === p.id} title={p.note} onClick={() => setCmpPreset(p.id)}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="note">{cmpMode === 'version' ? 'The same seed and habitat: the world’s original Overhang (A) and the refined one (B).' : 'The same seed and habitat, grown by each family.'}</p>
                  )}
                  {measures.length === 2 ? (
                    <>
                      <table className="alab-compare">
                        <thead>
                          <tr>
                            <th />
                            <th>A</th>
                            <th>B</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ROWS.map((r) => (
                            <tr key={r.key}>
                              <th>{r.label}</th>
                              <td>{r.show(measures[0]!)}</td>
                              <td>{r.show(measures[1]!)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="note"><b>What differs.</b> {sentences.length > 0 ? '' : 'The two are almost the same in everything measured.'}</p>
                      {sentences.map((t) => (
                        <p className="note" key={t}>{t}</p>
                      ))}
                      <p className="note">Measured on the generator’s plan of the mature form, not the mesh at this age.</p>
                    </>
                  ) : null}
                </>
              ) : null}
              {effView === 'sheet' ? (
                <>
                  <div className="choice-grid" role="group" aria-label="Sheet shows">
                    {(familyId === 'overhang' ? (['seeds', 'habitats', 'ages', 'families', 'versions'] as SheetMode[]) : familyId === 'strata' ? (['seeds', 'habitats', 'families'] as SheetMode[]) : (['seeds', 'habitats', 'ages', 'families'] as SheetMode[])).map((m) => (
                      <button key={m} type="button" className="choice" aria-pressed={sheetMode === m} onClick={() => setSheetMode(m)}>
                        {m === 'seeds' ? 'Six seeds' : m === 'habitats' ? 'Six habitats' : m === 'ages' ? (familyId === 'overhang' ? 'Lifecycle' : 'Six ages') : m === 'families' ? 'Both families' : 'Original vs refined'}
                      </button>
                    ))}
                  </div>
                  <p className="note">
                    {sheetMode === 'seeds' ? `Seeds ${seed} to ${seed + 5}, one habitat.` : sheetMode === 'habitats' ? `Seed ${seed} in your habitat, then each preset.` : sheetMode === 'ages' ? familyId === 'overhang' ? `Seed ${seed} at one sample of each stage: ${STAGES.map((x) => x.label).join(' → ')}.` : `Seed ${seed} at ages ${SHEET_AGES.join(', ')}.` : sheetMode === 'versions' ? `Seeds ${seed} to ${seed + 2}: the original Overhang above, the refined one below.` : `Seeds ${seed} to ${seed + 2}: Overhang above, ${familyId === 'strata' ? 'Strata' : 'Porous Growth'} below.`}
                  </p>
                  {measures.length > 1 ? (
                    <table className="alab-compare">
                      <thead>
                        <tr>
                          <th />
                          {plan.labels.map((l, i) => (
                            <th key={i} title={l}>{i + 1}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ROWS.filter((r) => SHEET_ROWS.includes(r.key)).map((r) => (
                          <tr key={r.key}>
                            <th>{r.label}</th>
                            {(status.measures ?? []).map((m, i) => (
                              <td key={i}>{m ? r.show(m).replace(/ m$/, '') : ''}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </>
              ) : null}
            </div>
          </PanelSection>

          <PanelSection index="06" title="Specimen">
            <div data-group>
              <dl className="alab-facts">
                <div><dt>Family</dt><dd>{family.label}{familyId === 'overhang' ? (variant === 'refined' ? ' (refined)' : ' (original, world)') : ' (lab only)'}</dd></div>
                {!many ? <div><dt>{family.age.label}</dt><dd>{familyId === 'overhang' ? lifeStage(shown?.ages[0] ?? age).label : `${(shown?.ages[0] ?? age).toFixed(2)} of ${family.age.max}`}</dd></div> : null}
                {dims && !many ? <div><dt>Size</dt><dd>{dims.w.toFixed(0)} m across, {dims.h.toFixed(0)} m high</dd></div> : null}
                {!many && status.stats?.[0] && 'massifs' in status.stats[0] ? <div><dt>{familyId === 'porous' ? 'Composition' : 'Shoots'}</dt><dd>{String(status.stats[0].massifs)}</dd></div> : null}
                {!many && status.stats?.[0] && 'openings' in status.stats[0] ? <div><dt>Space</dt><dd>{String(status.stats[0].openings)}</dd></div> : null}
                {!many && status.stats?.[0] && 'pieces' in status.stats[0] ? (
                  <div>
                    <dt>Checks</dt>
                    <dd>{`${status.stats[0].pieces === 1 ? 'one piece' : `${String(status.stats[0].pieces)} pieces (${String(status.stats[0].detachedVertices)} vertices apart)`} · void ${String(status.stats[0].voidWidth)} m wide, ${String(status.stats[0].headroom)} m high, tallest open space ${String(status.stats[0].openRun)} m · ${String(status.stats[0].tiers)} shelves · built in ${String(status.stats[0].buildMs)} ms`}</dd>
                  </div>
                ) : null}
                {shown ? <div><dt>Mesh</dt><dd>{shown.geometries.reduce((a, g) => a + g.getAttribute('position').count, 0).toLocaleString()} vertices · {shown.ms} ms</dd></div> : null}
              </dl>
            </div>
          </PanelSection>

          <PanelSection index="07" title="About this lab">
            <Disclosure label="What is kept in the code, not offered here">
              {EXCLUDED.map((e) => (
                <p className="note" key={e.variants}>
                  <code>{e.variants}</code>: {e.why}
                </p>
              ))}
              <p className="note"><b>Not implemented yet.</b> Sun and wind as controls (the sun is the day’s mean, the wind is fixed); the new families in the world’s population (the world preview can show them beside the Overhang); later-life states beyond the wear.</p>
            </Disclosure>
          </PanelSection>
        </InstrumentPanel>
      </div>
    </div>
  )
}
