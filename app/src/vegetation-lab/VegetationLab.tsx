import { Grid, Html, Line, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MeshStandardMaterial, type BufferGeometry } from 'three'
import { ControlField, Disclosure, ExerciseHeading, InstrumentPanel, PanelSection, Segmented, Slider, ViewTools, type ExerciseAbout, type SegmentOption } from '../shared/ui/instrument.tsx'
import { AUTO_ROTATE_SPEED } from '../shared/ui/instrument.tsx'
import { HOURS, LabGround, LOOKS, StudioLight, WorldLight, type Hour, type Look } from '../shared/labLook.tsx'
import { relColour, worldPlantMaterial } from '../project03/worldMaterials.ts'
import { islandTint, speciesOfCandidate } from '../project03/worldPlants.ts'
import { candidatesOf } from './catalog.ts'
import { Geo, rng, type LodLevel } from './geo.ts'
import { ARCHETYPES, LIGHT_STRATEGY, type ArchetypeId, type PlantParams } from './types.ts'
import { leafForm, leafLabel, lightResponse } from './ecology.ts'
import { GROWTH, STAGES, stageAt } from './growthRules.ts'
import { IslandMap } from './IslandMap.tsx'
import '../shared/ui/system.css'
import './vlab.css'

const ABOUT: ExerciseAbout = {
  text: 'The island’s plants, generated. Each species has its own growth rule (a leader with tiers, shoots from a base, organs set by the golden angle, runners that fork, growth that follows a wall). Four views separate what makes plants differ: Variation (the seed), Growth (age, as structure is added), Light (adaptation to where it grows) and Island (where the island’s own rules put it). The same generators draw the island’s plants, and the World look draws them with the island’s own material and light.',
  terms: 'growth rule · monopodial · sympodial · phyllotaxis · clonal spread · heteroblasty · sun and shade leaves · suitability · placement · level of detail',
  controls: 'R auto rotate · F wireframe · G reference · drag orbit · scroll zoom',
}

const SURFACES: SegmentOption<PlantParams['surface']>[] = [
  { value: 'rock', label: 'Rock' },
  { value: 'architecture', label: 'Architecture' },
]

const DEFAULTS: Record<ArchetypeId, Partial<PlantParams>> = {
  upland: { light: 0.8, moisture: 0.5, wind: 0.3 },
  understory: { light: 0.2, moisture: 0.65, wind: 0.15 },
  cover: { light: 0.5, moisture: 0.65, wind: 0.15 },
  epiphyte: { light: 0.6, moisture: 0.6, wind: 0.25 },
  flood: { light: 0.7, moisture: 0.8, wind: 0.2, depth: 0.6 },
  shore: { light: 0.8, moisture: 0.7, wind: 0.35, depth: 0.25 },
  submerged: { light: 0.9, moisture: 0.6, wind: 0.3, depth: 1.2 },
}
const DEPTH_RANGE: Record<string, { min: number; max: number }> = { flood: { min: 0, max: 1.5 }, shore: { min: 0, max: 0.8 }, submerged: { min: 0.3, max: 3 } }
const BASE: PlantParams = { seed: 7, age: 0.85, light: 0.7, moisture: 0.6, wind: 0.25, depth: 0, surface: 'rock' }

type View = 'variation' | 'growth' | 'light' | 'island'
const VIEWS: SegmentOption<View>[] = [
  { value: 'variation', label: 'Variation' },
  { value: 'growth', label: 'Growth' },
  { value: 'light', label: 'Light' },
  { value: 'island', label: 'Island' },
]
const VIEW_NOTE: Record<View, string> = {
  variation: 'Three individuals of one species in the same place, from three seeds: what the seed alone changes.',
  growth: 'One individual through its life. Each step is grown anew at that age, so what you see added (tiers, shoots, dishes, runners) is the rule at work, not a model scaled up.',
  light: 'The same species, seed and age grown in open sun, part shade and deep shade: long-term adaptation (height, branching, leaf size and density, lean toward the gap), not the light of the moment. Each says how it does there: a sun specialist struggles in deep shade, a shade specialist in open sun.',
  island: 'Where the island’s own rules say this species can grow, and where it actually stands.',
}

/** Detail: how a plant is DRAWN, never what it is. Full, Reduced and Distant are the island's levels; Structure is the Lab's drawing of the growth's skeleton. */
type Detail = 'full' | 'reduced' | 'distant' | 'structure'
const DETAILS: SegmentOption<Detail>[] = [
  { value: 'full', label: 'Full' },
  { value: 'reduced', label: 'Reduced' },
  { value: 'distant', label: 'Distant' },
  { value: 'structure', label: 'Structure' },
]
const LEVEL: Record<Detail, LodLevel> = { full: 0, reduced: 1, distant: 2, structure: 0 }

/** The Light gradient: one individual, grown three times at these lights. */
const GRADIENT: { light: number; label: string }[] = [
  { light: 0.9, label: 'Open sun' },
  { light: 0.5, label: 'Part shade' },
  { light: 0.15, label: 'Deep shade' },
]

type Built = { geometry: BufferGeometry; vertices: number; height: number; width: number; label: string; sub?: string; light: number; mean: [number, number, number] }

function meanColour(g: BufferGeometry): [number, number, number] {
  const col = g.getAttribute('color')
  if (!col) return [0.5, 0.5, 0.5]
  const m: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < col.count; i += 1) {
    m[0] += col.getX(i)
    m[1] += col.getY(i)
    m[2] += col.getZ(i)
  }
  return [m[0] / col.count, m[1] / col.count, m[2] / col.count]
}

/** Frames the subject from its measured size, once per species and view (not as sliders move). */
function CameraRig({ height, total, id }: { height: number; total: number; id: string }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { target: { set: (x: number, y: number, z: number) => void }; update: () => void } | null
  const latest = useRef({ height, total })
  latest.current = { height, total }
  useLayoutEffect(() => {
    const { height: h, total: w } = latest.current
    const tan = Math.tan((40 * Math.PI) / 360)
    const d = Math.max(0.7, Math.max((w / 2) / (tan * 0.95), (h / 2) / tan) * 1.2)
    camera.position.set(d * 0.3, h * 0.5 + d * 0.16, d * 0.95)
    // The panel covers the right of the canvas: the subject is framed a little left of centre.
    controls?.target.set(w * 0.12, h * 0.45, 0)
    controls?.update()
  }, [camera, controls, id])
  return null
}

/** A thin ruler beside the plants, with a length that suits their size. */
function Reference({ height, x }: { height: number; x: number }) {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5]
  const len = [...steps].reverse().find((v) => v <= height * 0.7) ?? 0.1
  const unit = len >= 1 ? `${len} m` : `${Math.round(len * 100)} cm`
  const ticks = len >= 2 ? len : 4
  return (
    <group position={[x, 0, 0.3]}>
      <Line points={[[0, 0, 0], [0, len, 0]]} color="#8c877b" lineWidth={1} />
      {Array.from({ length: ticks + 1 }, (_, i) => (i / ticks) * len).map((h, i) => (
        <Line key={i} points={[[0, h, 0], [len * 0.05, h, 0]]} color="#8c877b" lineWidth={1} />
      ))}
      <Html position={[len * 0.07, len, 0]} zIndexRange={[10, 0]}>
        <span className="ref-label">{unit}</span>
      </Html>
    </group>
  )
}

/** One plant: in the World look, the island's own material, tinted as its species is tinted on the island; in Studio, plain vertex colour. */
function Specimen({ item, look, tintAt, wireframe, structure }: { item: Built; look: Look; tintAt: (light: number) => [number, number, number] | null; wireframe: boolean; structure: boolean }) {
  const material = useMemo(() => {
    if (look === 'studio' || structure) return new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: 2 })
    const m = worldPlantMaterial(false)
    const t = tintAt(item.light)
    if (t) m.color.setRGB(relColour(t[0], item.mean[0]), relColour(t[1], item.mean[1]), relColour(t[2], item.mean[2]))
    return m
  }, [look, structure, item, tintAt])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => {
    material.wireframe = wireframe
  }, [material, wireframe])
  return <mesh geometry={item.geometry} material={material} castShadow receiveShadow />
}

export function VegetationLab({ tabs }: { tabs: ReactNode }) {
  const [arch, setArch] = useState<ArchetypeId>('upland')
  const [pick, setPick] = useState<Record<ArchetypeId, string>>({ upland: 'spar', understory: 'parasol', cover: 'rosette', epiphyte: 'vine', flood: 'buttress', shore: 'reed', submerged: 'meadow' })
  const [params, setParams] = useState<PlantParams>({ ...BASE, ...DEFAULTS.upland })
  const [reference, setReference] = useState(true)
  const [wireframe, setWireframe] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [view, setView] = useState<View>('variation')
  const [look, setLook] = useState<Look>('world')
  const [hour, setHour] = useState<Hour>('day')
  const [detail, setDetail] = useState<Detail>('full')
  const [growAge, setGrowAge] = useState(0.55)
  const [playing, setPlaying] = useState(false)

  const list = candidatesOf(arch)
  const candidate = list.find((c) => c.id === pick[arch]) ?? list[0]!
  const waterTop = candidate.depth ? params.depth : 0
  const onIsland = speciesOfCandidate(candidate.id)
  const life = onIsland?.life.life
  const rule = GROWTH[candidate.id]

  const choose = (a: ArchetypeId) => {
    setArch(a)
    setParams((p) => ({ ...p, ...DEFAULTS[a], depth: DEFAULTS[a].depth ?? 0 }))
  }
  const set = (patch: Partial<PlantParams>) => setParams((p) => ({ ...p, ...patch }))

  // Growth: play the timeline, a step about every 120 ms (each step is a new growth, not an interpolation).
  useEffect(() => {
    if (!playing || view !== 'growth') return
    const id = window.setInterval(() => {
      setGrowAge((a) => {
        if (a >= 1) {
          setPlaying(false)
          return 1
        }
        return Math.min(1, a + 0.025)
      })
    }, 120)
    return () => window.clearInterval(id)
  }, [playing, view])

  const built = useMemo(() => {
    const t0 = performance.now()
    const out: Built[] = []
    const growOne = (seedKey: number, label: string, patch: Partial<PlantParams>, sub?: string) => {
      const g = new Geo(LEVEL[detail], candidate.size, detail === 'structure')
      const p = { ...params, ...patch }
      candidate.build(g, p, rng(params.seed * 31 + seedKey * 977 + 5))
      const geometry = g.build()
      const bb = geometry.boundingBox
      const height = bb && Number.isFinite(bb.max.y) ? bb.max.y : 0.2
      const width = bb && Number.isFinite(bb.max.x) ? Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) : 0.3
      out.push({ geometry, vertices: g.pos.length / 3, height, width, label, sub, light: p.light, mean: meanColour(geometry) })
    }
    if (view === 'light') {
      // The same individual (the middle seed) in the same place: only the light it grew in differs.
      for (const gr of GRADIENT) {
        const perf = lightResponse(candidate.id, gr.light)
        growOne(1, gr.label, { light: gr.light }, `${perf ? `${perf.word} · ` : ''}${leafLabel(leafForm(gr.light, candidate.light === 'shade'))}`)
      }
    } else if (view === 'growth') {
      growOne(1, '', { age: Math.max(0.03, growAge) })
    } else if (view === 'island') {
      growOne(1, '', {})
    } else {
      for (let k = 0; k < 3; k += 1) growOne(k, `seed ${params.seed + k}`, {})
    }
    return { items: out, ms: performance.now() - t0 }
  }, [candidate, params, view, detail, growAge])
  useEffect(() => () => built.items.forEach((b) => b.geometry.dispose()), [built])

  // The island's tint for this species at a light (null where the island does not place it): stable per species and moisture.
  const moisture = params.moisture
  const tintAt = useMemo(() => (light: number) => islandTint(candidate.id, light, moisture), [candidate.id, moisture])

  const range = DEPTH_RANGE[arch] ?? { min: 0, max: 1 }
  const first = built.items[0]!
  // The individuals stand apart by what they measure, so none overlaps, whatever the plant.
  const widest = Math.max(...built.items.map((b) => b.width), 0.3)
  const spacing = widest * 1.12
  // Growth is framed for the grown plant, so the camera does not move as it grows.
  const tallest = Math.max(...built.items.map((b) => b.height), waterTop * 1.1, 0.2, view === 'growth' ? candidate.size * 0.8 : 0)
  const n = built.items.length
  const total = view === 'growth' ? Math.max(widest, candidate.size * 0.7) : spacing * (n - 1) + widest
  const world = look === 'world'
  const years = life ? Math.round(growAge * life) : null

  return (
    <div className="app-shell ui-system vlab">
      <div className="viz-stage">
        <div className="world-canvas-wrap">
          {view === 'island' ? <IslandMap candidate={candidate} /> : null}
          <Canvas shadows style={view === 'island' ? { visibility: 'hidden' } : undefined} className="world-canvas" camera={{ position: [4, 4, 9], fov: 40, near: 0.05, far: 300 }} gl={{ antialias: true }}>
            {world ? <WorldLight hour={hour} reach={Math.max(tallest, total) * 0.9} centre={[0, tallest * 0.4, 0]} /> : <StudioLight reach={Math.max(tallest, total) * 0.9} />}
            {view === 'island' ? null : <LabGround look={look} radius={Math.max(total, tallest) * 1.1} />}
            {world ? null : <Grid position={[0, 0.001, 0]} args={[10, 10]} cellSize={1} cellThickness={0.5} cellColor="#3a3935" sectionSize={5} sectionThickness={1} sectionColor="#66635b" fadeDistance={40} fadeStrength={1.4} infiniteGrid />}
            {candidate.depth ? (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, params.depth, 0]}>
                <planeGeometry args={[80, 80]} />
                <meshStandardMaterial color={world ? '#3e7a7b' : '#5a8a96'} transparent opacity={0.42} roughness={0.25} depthWrite={false} />
              </mesh>
            ) : null}
            {built.items.map((b, i) => (
              <group key={`${view}-${detail}-${i}`} position={[(i - (n - 1) / 2) * spacing, 0, 0]}>
                <Specimen item={b} look={look} tintAt={tintAt} wireframe={wireframe} structure={detail === 'structure'} />
                {b.label ? (
                  <Html position={[0, b.height + Math.max(0.04, b.height * 0.04), 0]} center zIndexRange={[10, 0]}>
                    <span className="ref-label">{b.label}</span>
                    {b.sub ? <span className="ref-label vlab-sub">{b.sub} · {b.height.toFixed(1)} m</span> : null}
                  </Html>
                ) : null}
              </group>
            ))}
            {reference ? <Reference height={tallest} x={-((n - 1) / 2) * spacing - widest * 0.62} /> : null}
            <CameraRig height={tallest} total={total} id={`${candidate.id}:${view}`} />
            <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={0.4} maxDistance={120} maxPolarAngle={Math.PI * 0.495} autoRotate={autoRotate} autoRotateSpeed={AUTO_ROTATE_SPEED} />
          </Canvas>
          {view === 'island' ? null : (
            <ViewTools
              tools={[
                { label: 'Auto rotate', key: 'R', on: autoRotate, onChange: setAutoRotate },
                { label: 'Wireframe', key: 'F', on: wireframe, onChange: setWireframe },
                { label: 'Reference', key: 'G', on: reference, onChange: setReference },
              ]}
              actions={
                <div className="look-row">
                  <Segmented label="Look" options={LOOKS} value={look} onChange={setLook} />
                  {world ? <Segmented label="Hour" options={HOURS} value={hour} onChange={setHour} /> : null}
                  <Segmented label="Detail" options={DETAILS} value={detail} onChange={setDetail} />
                </div>
              }
            >
              <p className="readout" aria-live="polite">
                <span>{candidate.name}</span>
                {view === 'growth' ? <span>{stageAt(growAge)}{years !== null ? ` · year ${years} of about ${life}` : ''}</span> : <span>seed {params.seed}</span>}
                <span>{first.height.toFixed(2)} m high</span>
                <span>{built.items.reduce((a, b) => a + b.vertices, 0).toLocaleString()} vertices</span>
                <span>{onIsland ? (world ? 'island colours' : 'own colours') : 'not placed on the island'}</span>
              </p>
            </ViewTools>
          )}
        </div>
      </div>

      <div className="app-chrome">
        <div className="region-left">
          <ExerciseHeading title="Vegetation Lab" about={ABOUT} />
          {tabs}
        </div>

        <InstrumentPanel label="Plants">
          <PanelSection index="01" title="Species" tip="What the plant is: its growth rule and its light strategy. These do not change with where it grows.">
            <div data-group>
              <div className="choice-grid" role="group" aria-label="Archetype">
                {ARCHETYPES.map((a) => (
                  <button key={a.id} type="button" className="choice" aria-pressed={a.id === arch} onClick={() => choose(a.id)}>
                    {a.label}
                  </button>
                ))}
              </div>
              <div className="choice-grid" role="group" aria-label="Species">
                {list.map((c) => (
                  <button key={c.id} type="button" className="choice" aria-pressed={c.id === candidate.id} onClick={() => setPick((p) => ({ ...p, [arch]: c.id }))}>
                    <i className="strategy-dot" style={{ background: LIGHT_STRATEGY[c.light ?? 'broad'].colour }} />
                    {c.name}
                  </button>
                ))}
              </div>
              <p className="note"><b>{LIGHT_STRATEGY[candidate.light ?? 'broad'].label}.</b> {candidate.strategy}</p>
              {rule ? (
                <Disclosure label={`Growth rule · ${rule.kind}`}>
                  <p className="note">{rule.rule}</p>
                  <p className="note"><b>With age.</b> {rule.age}</p>
                </Disclosure>
              ) : null}
              {candidate.basis ? (
                <Disclosure label="Evidence and invention">
                  <p className="note">{candidate.basis}</p>
                </Disclosure>
              ) : null}
            </div>
          </PanelSection>

          <PanelSection index="02" title="View">
            <div data-group>
              <Segmented label="View" options={VIEWS} value={view} onChange={setView} />
              <p className="note">{VIEW_NOTE[view]}</p>
              {view === 'growth' ? (
                <>
                  <ControlField label="Age" value={`${stageAt(growAge)}${years !== null ? ` · year ${years}` : ` · ${growAge.toFixed(2)}`}`} tip={life ? `This species lives about ${life} years on the island; the island’s plants are this same generator at their own ages.` : 'Share of a life, from seedling to old age.'}>
                    <Slider label="Age" min={0.03} max={1} step={0.01} value={growAge} onChange={(v) => { setPlaying(false); setGrowAge(v) }} />
                  </ControlField>
                  <div className="stage-ticks">
                    {STAGES.map((s) => (
                      <button key={s.label} type="button" className="text-button" aria-pressed={stageAt(growAge) === s.label} onClick={() => { setPlaying(false); setGrowAge(s.at) }}>{s.label}</button>
                    ))}
                  </div>
                  <div className="note">
                    <button type="button" className="text-button" onClick={() => { if (growAge >= 1) setGrowAge(0.03); setPlaying(!playing) }}>{playing ? 'Pause' : 'Play growth'}</button>
                    {'  ·  '}
                    <button type="button" className="text-button" onClick={() => setDetail(detail === 'structure' ? 'full' : 'structure')}>{detail === 'structure' ? 'Show the whole plant' : 'Show its structure'}</button>
                  </div>
                </>
              ) : null}
            </div>
          </PanelSection>

          {view === 'island' ? null : (
            <PanelSection index="03" title="Individual and place" tip="Seed: which individual. The rest: where it grows. The plant adapts; it stays the same species.">
              <div data-group>
                <ControlField label="Seed" value={view === 'variation' ? `${params.seed} to ${params.seed + 2}` : `${params.seed}`}>
                  <Slider label="Seed" min={1} max={97} step={1} value={params.seed} onChange={(v) => set({ seed: v })} />
                </ControlField>
                {view === 'growth' ? null : (
                  <ControlField label="Age" value={`${params.age.toFixed(2)} · ${stageAt(params.age)}`}>
                    <Slider label="Age" min={0.05} max={1} step={0.01} value={params.age} onChange={(v) => set({ age: v })} />
                  </ControlField>
                )}
                {view === 'light' ? null : (
                  <ControlField label={arch === 'submerged' ? 'Surface light' : 'Light where it grows'} value={`${params.light.toFixed(2)}${arch === 'submerged' ? '' : ` · ${leafLabel(leafForm(params.light))}`}`} tip="The day-averaged light where it stands (the island’s stable light, past terrain and structures), not the light of this moment.">
                    <Slider label="Light" min={0} max={1} step={0.01} value={params.light} onChange={(v) => set({ light: v })} />
                  </ControlField>
                )}
                <ControlField label="Moisture" value={params.moisture.toFixed(2)}>
                  <Slider label="Moisture" min={0} max={1} step={0.01} value={params.moisture} onChange={(v) => set({ moisture: v })} />
                </ControlField>
                <ControlField label={arch === 'submerged' ? 'Current' : 'Exposure'} value={params.wind.toFixed(2)} tip="Wind blows along +x.">
                  <Slider label="Exposure" min={0} max={1} step={0.01} value={params.wind} onChange={(v) => set({ wind: v })} />
                </ControlField>
                {candidate.depth ? (
                  <ControlField label="Water depth" value={`${params.depth.toFixed(2)} m`}>
                    <Slider label="Water depth" min={range.min} max={range.max} step={0.05} value={Math.min(range.max, Math.max(range.min, params.depth))} onChange={(v) => set({ depth: v })} />
                  </ControlField>
                ) : null}
                {candidate.surface ? (
                  <ControlField label="Grows on">
                    <Segmented label="Attachment surface" options={SURFACES} value={params.surface} onChange={(v) => set({ surface: v })} />
                  </ControlField>
                ) : null}
                <Disclosure label="How it adapts">
                  <p className="note">{candidate.adaptation}</p>
                </Disclosure>
                <div className="note">
                  <button type="button" className="text-button" onClick={() => setParams({ ...BASE, ...DEFAULTS[arch], depth: DEFAULTS[arch].depth ?? 0 })}>
                    Reset
                  </button>
                </div>
              </div>
            </PanelSection>
          )}
        </InstrumentPanel>
      </div>
    </div>
  )
}
