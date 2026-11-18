import { OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BufferAttribute, BufferGeometry, CapsuleGeometry, Color, DirectionalLight, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D, type PerspectiveCamera, type Vector3 } from 'three'
import { currentPopulation } from '../project03/livingSelection.ts'
import { landscapeHeight } from '../project03/terrain.ts'
import { worldActions } from '../project03/worldActions.ts'
import { growVariant, SPECIES, STRIDE, VARIANTS } from '../project03/worldPlants.ts'
import { ControlField, ExerciseHeading, InstrumentPanel, PanelSection, Segmented, Slider, ViewTools, type ExerciseAbout } from '../shared/ui/instrument.tsx'
import { sculptOf } from './sculpt/build.ts'
import { inkOf } from './ink/build.ts'
import { InkScene } from './ink/InkScene.tsx'
import { Ink2Scene } from './ink2/Ink2Scene.tsx'
import { SculptScene } from './sculpt/SculptScene.tsx'
import { ComposeScene, useComposeLayout, type ComposeView } from './compose/ComposeScene.tsx'
import { HEROES, type SheetElevation } from './compose/framings.ts'
import type { NotanMode } from './compose/notan.ts'
import { ACTIVE_FORMS, DETAIL, FORMS, type FormId, type Scale } from './compose/forms.ts'
import { groundEye, loadSite, SITE, studySun, type StudySite } from './site.ts'
import '../shared/ui/system.css'
import './hstudy.css'

const ABOUT: ExerciseAbout = {
  text: 'A workspace for the art direction of Shadow Ecology 0.3, not a world version. One 260 m window of the island around the Reference Overhang, read from the world itself: the same ground, the same population and organism meshes, the same shade raster and the same plants, at the opening of the observation. The Data view draws them plainly, as the baseline every style is compared against; the styles redraw the same window without moving anything the ecology decides.',
  terms: 'habitat window · shade raster · plate camera · visual height · baseline',
  controls: 'H shade habitat · drag orbit · scroll zoom',
}

type Plate = 'overview' | 'structure' | 'ground' | 'plan'
const PLATES: { id: Plate; label: string; note: string }[] = [
  { id: 'overview', label: 'Overview', note: 'The whole window from high on the inland side, across the structure to the lake.' },
  { id: 'structure', label: 'Structure', note: 'The Reference Overhang from the side, its shadow on the ground beside it.' },
  { id: 'ground', label: 'Ground', note: 'Standing height under the structure’s roof, looking out toward the water.' },
  { id: 'plan', label: 'Plan', note: 'From straight above: the footprint, the shade and what grows in it.' },
]

type Pose = { position: [number, number, number]; target: [number, number, number]; fov: number }
type Style = 'data' | 'sculpt' | 'ink' | 'ink2' | 'compose'

/**
 * Each plate's camera, from the site itself: the reference organism and the direction of the water. The Sculptural style looks through a long lens
 * (a flatter, more composed, near-isometric picture), from further away; its Ground plate stands on the drawn ground.
 */
function platePose(site: StudySite, plate: Plate, style: Style): Pose {
  const long = style === 'sculpt'
  const far = long ? 1.55 : 1
  const fov = long ? 24 : 32
  const groundAt = long ? sculptOf(site).land.heightAt : style === 'ink' || style === 'ink2' ? inkOf(site).heightAt : landscapeHeight
  const ref = site.organisms.find((o) => o.index === 0) ?? site.organisms[0]
  const ox = ref?.x ?? SITE.cx
  const oz = ref?.z ?? SITE.cz
  const oy = landscapeHeight(ox, oz)
  const [dx, dz] = site.audit.water.dir ?? [1, 0]
  const px = -dz
  const pz = dx
  const h = ref?.height ?? 30
  const r = ref?.radius ?? 20
  switch (plate) {
    case 'overview':
      return { position: [ox - dx * 300 * far + px * 150 * far, oy + 210 * far, oz - dz * 300 * far + pz * 150 * far], target: [ox + dx * 20, oy, oz + dz * 20], fov }
    case 'structure':
      return { position: [ox + px * (r * 2 + 70) * far - dx * 25 * far, oy + h * 0.7 * far, oz + pz * (r * 2 + 70) * far - dz * 25 * far], target: [ox, oy + h * 0.35, oz], fov }
    case 'ground': {
      // In the shade habitat at the roof's edge, low, looking back in under the great shelf: the roof overhead, the shade plants and the hollow beneath it.
      // (Without a roof: outside the footing on the water side, looking back at the structure.)
      const eye = groundEye(site)
      if (!eye) return { position: [ox + dx * (r * 2 + 20), oy + 1.6, oz + dz * (r * 2 + 20)], target: [ox, oy + h * 0.4, oz], fov: 54 }
      return { position: [eye.x, groundAt(eye.x, eye.z) + 1.4, eye.z], target: [eye.tx, groundAt(eye.tx, eye.tz) + 6, eye.tz], fov: 54 }
    }
    case 'plan':
      return { position: [SITE.cx, oy + 520 * (long ? 1.35 : 1), SITE.cz + 1], target: [SITE.cx, oy, SITE.cz], fov }
  }
}

// ------------------------------------------------------------------------------------------------------------- Data view

const GROUND = new Color('#b8b0a0')
const STEEP = new Color('#8f877a')
const SHADE = new Color('#5d7f9a')

/** The window's ground on a 2 m grid, from the real height (the rivers' carve included), coloured by slope and, when asked, by the shade habitat. */
function StudyGround({ site, shade }: { site: StudySite; shade: boolean }) {
  const geometry = useMemo(() => {
    const step = 2
    const n = Math.round((SITE.half * 2) / step) + 1
    const pos = new Float32Array(n * n * 3)
    const index: number[] = []
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const x = SITE.cx - SITE.half + i * step
        const z = SITE.cz - SITE.half + j * step
        const k = (j * n + i) * 3
        pos[k] = x
        pos[k + 1] = landscapeHeight(x, z)
        pos[k + 2] = z
        if (i + 1 < n && j + 1 < n) {
          const a = j * n + i
          index.push(a, a + n, a + 1, a + 1, a + n, a + n + 1)
        }
      }
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(pos, 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(n * n * 3), 3))
    g.setIndex(index)
    g.computeVertexNormals()
    return g
  }, [])
  useLayoutEffect(() => {
    const pos = geometry.getAttribute('position')
    const nor = geometry.getAttribute('normal')
    const col = geometry.getAttribute('color')
    const c = new Color()
    for (let v = 0; v < pos.count; v += 1) {
      c.copy(GROUND).lerp(STEEP, Math.min(1, Math.max(0, (1 - nor.getY(v)) * 6)))
      if (shade) c.lerp(SHADE, Math.min(1, site.shadeAt(pos.getX(v), pos.getZ(v))) * 0.75)
      col.setXYZ(v, c.r, c.g, c.b)
    }
    col.needsUpdate = true
  }, [geometry, shade, site])
  const material = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }), [])
  return <mesh geometry={geometry} material={material} receiveShadow castShadow />
}

/** The water's surface where the world's lakes and pools stand in the window (rivers are cut into the ground and show as its channels). */
function StudyWater({ site }: { site: StudySite }) {
  const geometry = useMemo(() => {
    const step = 2
    const n = Math.round((SITE.half * 2) / step) + 1
    const depth = (x: number, z: number) => site.world.water.depthAt(x, z)
    const pos = new Float32Array(n * n * 3)
    const wet = new Uint8Array(n * n)
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const x = SITE.cx - SITE.half + i * step
        const z = SITE.cz - SITE.half + j * step
        const d = depth(x, z)
        const k = j * n + i
        wet[k] = d > 0 ? 1 : 0
        pos[k * 3] = x
        pos[k * 3 + 1] = landscapeHeight(x, z) + Math.max(0, d)
        pos[k * 3 + 2] = z
      }
    }
    const index: number[] = []
    for (let j = 0; j + 1 < n; j += 1) {
      for (let i = 0; i + 1 < n; i += 1) {
        const a = j * n + i
        if (wet[a]! + wet[a + 1]! + wet[a + n]! + wet[a + n + 1]! < 3) continue
        index.push(a, a + n, a + 1, a + 1, a + n, a + n + 1)
      }
    }
    // A shore vertex is dry: lift it to the neighbouring surface so the water's edge meets the bank rather than sloping to it.
    for (let k = 0; k < n * n; k += 1) {
      if (wet[k]) continue
      for (const nk of [k - 1, k + 1, k - n, k + n]) {
        if (nk >= 0 && nk < n * n && wet[nk]) {
          pos[k * 3 + 1] = pos[nk * 3 + 1]!
          break
        }
      }
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(pos, 3))
    g.setIndex(index)
    g.computeVertexNormals()
    return g
  }, [site])
  const material = useMemo(() => new MeshStandardMaterial({ color: '#7d93a0', roughness: 0.35, metalness: 0, transparent: true, opacity: 0.85 }), [])
  return <mesh geometry={geometry} material={material} receiveShadow />
}

function StudyOrganisms({ site }: { site: StudySite }) {
  const material = useMemo(() => new MeshStandardMaterial({ color: '#d8d3ca', roughness: 0.9, metalness: 0 }), [])
  return (
    <>
      {site.organisms.map((o) => (
        <mesh key={o.id} geometry={o.geometry} material={material} castShadow receiveShadow />
      ))}
    </>
  )
}

/** Every plant the world places in the window, with the world's own geometry (its nearest level), uncoloured by the visual presets. */
function StudyPlants({ site }: { site: StudySite }) {
  const material = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: 2 }), [])
  const meshes = useMemo(() => {
    const out: InstancedMesh[] = []
    const m = new Matrix4()
    const dummy = new Object3D()
    for (const [id, arr] of site.plants) {
      const sp = SPECIES.find((s) => s.id === id)
      if (!sp) continue
      const byVariant = new Map<number, number[]>()
      for (let o = 0; o < arr.length; o += STRIDE) {
        const v = Math.min(VARIANTS.length - 1, Math.max(0, Math.round(arr[o + 5]!)))
        if (!byVariant.has(v)) byVariant.set(v, [])
        byVariant.get(v)!.push(o)
      }
      for (const [v, list] of byVariant) {
        const mesh = new InstancedMesh(growVariant(sp, v, 0), material, list.length)
        list.forEach((o, k) => {
          dummy.position.set(arr[o]!, arr[o + 1]!, arr[o + 2]!)
          dummy.rotation.set(0, arr[o + 4]!, 0)
          dummy.scale.setScalar(arr[o + 3]!)
          dummy.updateMatrix()
          m.copy(dummy.matrix)
          mesh.setMatrixAt(k, m)
        })
        mesh.castShadow = sp.group !== 'cover'
        mesh.receiveShadow = true
        mesh.computeBoundingSphere()
        out.push(mesh)
      }
    }
    return out
  }, [site, material])
  useEffect(() => () => meshes.forEach((m) => m.geometry.dispose()), [meshes])
  return (
    <>
      {meshes.map((m, k) => (
        <primitive key={k} object={m} />
      ))}
    </>
  )
}

/** The Dwellers at their placed spots (where the world's creatures start), as plain markers of their size: their behaviour is not run here. */
function StudyDwellers({ site }: { site: StudySite }) {
  const geometry = useMemo(() => new CapsuleGeometry(0.35, 0.9, 4, 10).rotateZ(Math.PI / 2), [])
  const material = useMemo(() => new MeshStandardMaterial({ color: '#c0563f', roughness: 0.8 }), [])
  return (
    <>
      {site.dwellers.map((d, k) => (
        <mesh key={k} geometry={geometry} material={material} position={[d.x, landscapeHeight(d.x, d.z) + 0.45, d.z]} castShadow />
      ))}
    </>
  )
}

/** The world's sun at the study's hour, with a shadow map fitted to the window (so the shadows are as sharp as the window allows). */
function StudySun({ hour }: { hour: number }) {
  const light = useRef<DirectionalLight>(null)
  const scene = useThree((s) => s.scene)
  useLayoutEffect(() => {
    const l = light.current
    if (!l) return
    const sun = studySun(hour)
    const [x, y, z] = sun.direction
    const cy = landscapeHeight(SITE.cx, SITE.cz)
    l.position.set(SITE.cx + x * 500, cy + y * 500, SITE.cz + z * 500)
    l.target.position.set(SITE.cx, cy, SITE.cz)
    if (!l.target.parent) scene.add(l.target)
    l.intensity = 2.6 * sun.daylight
    const cam = l.shadow.camera
    cam.left = -190
    cam.right = 190
    cam.top = 190
    cam.bottom = -190
    cam.near = 50
    cam.far = 1100
    cam.updateProjectionMatrix()
    l.shadow.needsUpdate = true
  }, [hour, scene])
  return (
    <>
      <directionalLight ref={light} castShadow shadow-mapSize={[4096, 4096]} shadow-bias={-0.0003} shadow-normalBias={0.6} color="#fff6e8" />
      <hemisphereLight args={['#dfe6ee', '#8a8270', 0.9]} />
    </>
  )
}

function PlateCamera({ site, plate, style, tick }: { site: StudySite; plate: Plate; style: Style; tick: number }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => void } | null
  useLayoutEffect(() => {
    const pose = platePose(site, plate, style)
    camera.fov = pose.fov
    camera.updateProjectionMatrix()
    camera.position.set(...pose.position)
    camera.lookAt(...pose.target)
    if (controls) {
      controls.target.set(...pose.target)
      controls.update()
    }
  }, [site, plate, style, tick, camera, controls])
  return null
}

// ------------------------------------------------------------------------------------------------------------- View in Original

/**
 * Opens the 0.3 world on the Reference Overhang, as the Guide does: the page first, then, once its architecture is live, the reference organism
 * selected and Look closer, at the study's hour. Module-level, since the study unmounts as the world opens.
 */
function viewInOriginal(hour: number) {
  worldActions.labs.back()
  const started = performance.now()
  const id = window.setInterval(() => {
    if (performance.now() - started > 60000) window.clearInterval(id)
    if (!currentPopulation()) return
    window.clearInterval(id)
    worldActions.time.hour(hour)
    worldActions.architecture.select({ kind: 'organism', index: 0 })
    worldActions.architecture.lookCloser()
  }, 200)
}

// ------------------------------------------------------------------------------------------------------------- page

const memory: { plate: Plate; hour: number; shade: boolean; wash: boolean; style: Style; notan: NotanMode; view: ComposeView; guides: boolean; squint: boolean; clean: boolean; form: FormId; scale: Scale } = {
  plate: 'overview',
  hour: 16.5,
  shade: false,
  wash: true,
  style: 'compose',
  notan: 'silhouette',
  form: 'original',
  scale: 120,
  view: { kind: 'hero', id: 'h1' },
  guides: true,
  squint: false,
  clean: false,
}

/** Style C's overlay: the plate's thirds and edge, or the contact sheet's labels. Pointer events pass through to the canvas. */
function ComposeOverlay({ guides }: { guides: boolean }) {
  const { plate, cells } = useComposeLayout()
  return (
    <div className="compose-overlay" aria-hidden="true">
      {plate && guides ? (
        <div className="compose-plate" style={{ left: plate.x, top: plate.y, width: plate.w, height: plate.h }}>
          <span className="compose-third v" style={{ left: '33.333%' }} />
          <span className="compose-third v" style={{ left: '66.667%' }} />
          <span className="compose-third h" style={{ top: '33.333%' }} />
          <span className="compose-third h" style={{ top: '66.667%' }} />
        </div>
      ) : null}
      {cells.map((c, k) => (
        <span key={k} className="compose-cell-label" style={{ left: c.rect.x + 6, top: c.rect.y + 4 }}>
          {c.label}
        </span>
      ))}
    </div>
  )
}

const fmtHour = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`

export function HabitatStudy({ tabs }: { tabs: ReactNode }) {
  const [site, setSite] = useState<StudySite | null>(null)
  const [step, setStep] = useState('Making the world')
  const [plate, setPlateState] = useState<Plate>(memory.plate)
  const [tick, setTick] = useState(0)
  const [hour, setHour] = useState(memory.hour)
  const [shade, setShade] = useState(memory.shade)
  const [style, setStyle] = useState<Style>(memory.style)
  const [wash, setWash] = useState(memory.wash)
  const [notan, setNotan] = useState<NotanMode>(memory.notan)
  const [view, setViewState] = useState<ComposeView>(memory.view)
  const [guides, setGuides] = useState(memory.guides)
  const [squint, setSquint] = useState(memory.squint)
  const [clean, setClean] = useState(memory.clean)
  const [form, setForm] = useState<FormId>(ACTIVE_FORMS.includes(memory.form) ? memory.form : 'original')
  const [scale, setScale] = useState<Scale>(memory.scale)
  // The form the scene shows follows the one chosen a moment later: a form can take seconds to build on the main thread, and clicks made
  // meanwhile queue up. Waiting a beat lets those clicks collapse into the last one (only it is built), and lets "Building…" paint first.
  const [scene, setScene] = useState<{ form: FormId; scale: Scale }>({ form, scale: memory.scale })
  useEffect(() => {
    const id = window.setTimeout(() => setScene({ form, scale }), 80)
    return () => window.clearTimeout(id)
  }, [form, scale])
  const building = scene.form !== form || scene.scale !== scale
  const setView = (v: ComposeView) => {
    setViewState(v)
    setTick((t) => t + 1)
  }
  const setPlate = (p: Plate) => {
    setPlateState(p)
    setTick((t) => t + 1)
  }
  // Kept while the study is closed: the site shows one page at a time, so leaving it unmounts it.
  useEffect(() => {
    Object.assign(memory, { plate, hour, shade, wash, style, notan, view, guides, squint, clean, form, scale })
  }, [plate, hour, shade, wash, style, notan, view, guides, squint, clean, form, scale])
  useEffect(() => {
    let live = true
    void loadSite((s) => live && setStep(s)).then((made) => live && setSite(made))
    return () => {
      live = false
    }
  }, [])
  const audit = site?.audit
  const ref = audit?.organisms.find((o) => o.index === 0)
  const sun = studySun(hour)

  return (
    <div className={`app-shell ui-system hstudy${style === 'compose' && squint ? ' is-squint' : ''}${style === 'compose' && clean ? ' is-clean' : ''}`}>
      <div className="viz-stage">
        <div className="world-canvas-wrap">
          {/* One canvas per style: the Sculptural style's colours are its palette exactly (no tone mapping), and its shadows are crisp. */}
          <Canvas key={style} className="world-canvas" flat={style !== 'data'} shadows={style !== 'data' ? 'percentage' : true} camera={{ position: [SITE.cx - 200, 250, SITE.cz - 200], fov: 32, near: 0.5, far: 6000 }} gl={{ antialias: true }}>
            {style === 'data' ? (
              <>
                <color attach="background" args={['#2f3439']} />
                <fog attach="fog" args={['#2f3439', 600, 1600]} />
                <StudySun hour={hour} />
              </>
            ) : null}
            {site && style === 'data' ? (
              <>
                <StudyGround site={site} shade={shade} />
                <StudyWater site={site} />
                <StudyOrganisms site={site} />
                <StudyPlants site={site} />
                <StudyDwellers site={site} />
              </>
            ) : null}
            {site && style === 'sculpt' ? <SculptScene site={site} hour={hour} /> : null}
            {site && style === 'ink' ? <InkScene site={site} hour={hour} wash={wash} /> : null}
            {site && style === 'ink2' ? <Ink2Scene site={site} hour={hour} /> : null}
            {site && style === 'compose' ? <ComposeScene site={site} hour={hour} mode={notan} view={view} tick={tick} form={scene.form} scale={scene.scale} /> : null}
            {site && style !== 'compose' ? <PlateCamera site={site} plate={plate} style={style} tick={tick} /> : null}
            <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={2} maxDistance={900} maxPolarAngle={Math.PI * 0.49} />
          </Canvas>
          {style === 'compose' ? <ComposeOverlay guides={guides} /> : null}
          <ViewTools tools={style === 'compose' ? [{ label: 'Guides', key: 'G', on: guides, onChange: setGuides }, { label: 'Squint', key: 'S', on: squint, onChange: setSquint }, { label: 'Clean', key: 'F', on: clean, onChange: setClean }] : style === 'data' ? [{ label: 'Shade habitat', key: 'H', on: shade, onChange: setShade }] : style === 'ink' ? [{ label: 'Shade wash', key: 'W', on: wash, onChange: setWash }] : []}>
            <p className="readout" aria-live="polite">
              {site ? (
                <>
                  <span>{style === 'compose' ? `C · ${FORMS.find((f) => f.id === form)!.label} · ${scale} m · ${building ? 'Building…' : notan === 'values' ? 'Values' : notan === 'clay' ? 'Clay' : 'Silhouette'}` : style === 'data' ? 'Data view' : style === 'sculpt' ? 'A · The Ochre Benches' : style === 'ink' ? 'B · The Field Notebook' : 'B2 · The Charcoal Notebook'}</span>
                  <span>{style === 'compose' ? (view.kind === 'hero' ? HEROES.find((h) => h.id === view.id)?.label : view.kind === 'under' ? 'Under the roof' : view.kind === 'detail' ? `Junction · ${DETAIL[form]?.[view.index].label ?? '—'}` : `Contact sheet · ${view.elev}`) : PLATES.find((p) => p.id === plate)!.label}</span>
                  <span>{`${fmtHour(hour)} · sun ${Math.round(sun.elevation)}° up, from ${Math.round(sun.azimuth)}°`}</span>
                </>
              ) : (
                <span>{`${step}…`}</span>
              )}
            </p>
          </ViewTools>
        </div>
      </div>

      <div className="app-chrome">
        <div className="region-left">
          <ExerciseHeading title="Habitat Study" about={ABOUT} />
          {tabs}
        </div>

        <InstrumentPanel label="Habitat Study">
          <PanelSection index="01" title="View" tip="The Data view draws the window plainly: real ground, the organisms' own meshes, the world's plants, the Dwellers' placed spots. Styles A and B come in later phases.">
            <div data-group>
              <Segmented label="Style" options={[{ value: 'data', label: 'Data' }, { value: 'sculpt', label: 'A · Sculptural' }, { value: 'ink', label: 'B · Ink' }, { value: 'ink2', label: 'B2 · Charcoal' }, { value: 'compose', label: 'C · Compose' }]} value={style} onChange={setStyle} />
              {style === 'compose' ? (
                <ComposeControls notan={notan} setNotan={setNotan} view={view} setView={setView} disabled={!site} form={form} setForm={(f) => { setForm(f); setTick((t) => t + 1) }} scale={scale} setScale={(sc) => { setScale(sc); setTick((t) => t + 1) }} />
              ) : (
              <>
              <div className="choice-grid" role="group" aria-label="Plate">
                {PLATES.map((p) => (
                  <button key={p.id} type="button" className="choice" aria-pressed={p.id === plate} disabled={!site} onClick={() => setPlate(p.id)}>
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="note">{PLATES.find((p) => p.id === plate)!.note} Choosing a plate again puts the camera back.</p>
              </>
              )}
              <ControlField label="Hour" value={fmtHour(hour)} tip="The world's sun on Day 1 of the observation. Nothing else changes with it here: the plants and the shade habitat are those of the whole day.">
                <Slider label="Hour" min={6} max={20} step={0.25} value={hour} onChange={setHour} />
              </ControlField>
              {style === 'compose' ? (
                <>
                  <p className="note">
                    <b>Reading it.</b> No style: only shapes and values. <b>Silhouette</b> gives each kind of thing one grey (architecture black, plants dark, ground light, sky white). <b>Values</b> uses four steps from the light: lit, turned from the sun, cast shadow, and deep (persistent shade, under the roof). <b>Clay</b> is a neutral modelling material: the sun's direction raised to at least 38° as a key light with soft shadows, a sky fill, a little bounce onto undersides, and ambient occlusion from the form itself (for the Original, from a voxelised copy of its mesh), so thickness, junctions and the undercroft read as volume.
                  </p>
                  <p className="note">
                    Every framing is anchored to the sun at 16:30, so changing the hour moves the light, not the camera. <b>Squint</b> (S) blurs the plate: what still reads is the composition.
                  </p>
                </>
              ) : style === 'ink2' ? (
                <>
                  <p className="note">
                    <b>Reading it.</b> White is sunlight. Graphite hatching follows the form where it turns from the sun; cast shadow is hatched in the direction of the light, with a drawn edge, and moves and turns with the hour. Charcoal is enclosure: the undercroft and the ground under the roof.
                  </p>
                  <p className="note">
                    <b>Cobalt</b> is the shade habitat: where the structures keep the sun off for much of the day. It stays as the shadows move over it; the ferns and ground strokes inside it are drawn in cobalt pencil.
                  </p>
                </>
              ) : style === 'ink' ? (
                <>
                  <p className="note">
                    <b>Reading it.</b> Everything is paper; only shadow is laid in, as the faintest tone. The architecture is drawn in courses that wrap its form; under its shelves and on the faces turned from the sun the courses come closer, and those move with the hour. Light hatching on the ground marks the deep shade habitat, where the ferns are drawn thickest.
                  </p>
                  <p className="note">
                    <b>Accent.</b> The pale blue-grey wash (W) is the shade habitat: where the structures keep the sun off for much of the day. The coral of Style A becomes the Dweller’s solid ink: a specimen, as in A.
                  </p>
                </>
              ) : style === 'sculpt' ? (
                <>
                  <p className="note">
                    <b>Reading it.</b> Violet is shadow now: it sweeps with the sun. Sage-teal ground is the shade habitat, where the structures keep the sun off for much of the day: it stays put, and the ferns and mats gather there, fuller the deeper the shade. Warm meadow is where the grasses are thickest.
                  </p>
                  <p className="note">
                    <b>Specimen.</b> The coral Dweller is a study specimen: no Dweller lives at this structure in the world.
                  </p>
                </>
              ) : (
                <p className="note">
                  <b>Data.</b> The baseline: the window drawn plainly, from the world's own data.
                </p>
              )}
            </div>
          </PanelSection>

          <PanelSection index="02" title="Site" tip="What the window actually holds, read from the world at the opening of the observation.">
            <div data-group>
              {audit ? (
                <>
                  <p className="note">
                    <b>Ground.</b> {audit.ground.min}–{audit.ground.max} m; mean slope {audit.ground.meanSlope}°, steepest {audit.ground.maxSlope}°; {Math.round(audit.ground.steepShare * 100)}% steeper than 18°.
                  </p>
                  <p className="note">
                    <b>Water.</b> {audit.water.nearest === null ? 'none in the window' : `${audit.water.nearest} m from the centre; ${Math.round(audit.water.share * 100)}% of the window`}.
                  </p>
                  <p className="note">
                    <b>Architecture.</b>{' '}
                    {audit.organisms.map((o) => `${o.index === 0 ? 'Reference' : o.id} (${o.height} m, ${o.stage.toLowerCase()}, ${o.dist} m${o.dwellerHome ? ', Dweller home' : ''})`).join(' · ')}
                  </p>
                  <p className="note">
                    <b>Plants.</b> {audit.plants.map((p) => `${p.id} ${p.count}${p.inShade ? ` (${p.inShade} shaded)` : ''}`).join(' · ')}
                  </p>
                  <p className="note">
                    <b>Creatures.</b> {audit.dwellers ? `${audit.dwellers} Dweller${audit.dwellers === 1 ? '' : 's'} placed in the window.` : 'No Dweller is placed in this window (Dwellers live at the 2nd, 8th, 14th and 20th structures).'}
                  </p>
                  <p className="note">
                    <b>Load.</b> population {audit.ms.population} ms · organisms {audit.ms.organisms} ms · island fields {audit.ms.island} ms · shade {audit.ms.tiles} ms · plants {audit.ms.plants} ms
                  </p>
                </>
              ) : (
                <p className="note">{step}…</p>
              )}
            </div>
          </PanelSection>

          <PanelSection index="03" title="Compare" tip="Opens the 0.3 world itself on the Reference Overhang (Look closer), at this hour: the Original look, live, for comparison.">
            <div data-group>
              <button type="button" className="learn-button is-primary" disabled={!site || !ref} onClick={() => viewInOriginal(hour)}>
                View in Original
              </button>
              <p className="note">The world opens on Year 120 with the clock paused at {fmtHour(hour)}; return here from Labs.</p>
            </div>
          </PanelSection>
        </InstrumentPanel>
      </div>
    </div>
  )
}

function ComposeControls({ notan, setNotan, view, setView, disabled, form, setForm, scale, setScale }: { notan: NotanMode; setNotan: (m: NotanMode) => void; view: ComposeView; setView: (v: ComposeView) => void; disabled: boolean; form: FormId; setForm: (f: FormId) => void; scale: Scale; setScale: (s: Scale) => void }) {
  const hero = view.kind === 'hero' ? HEROES.find((h) => h.id === view.id) : null
  const elevs: SheetElevation[] = ['low', 'mid', 'high']
  return (
    <>
      <div className="choice-grid" role="group" aria-label="Form">
        {FORMS.filter((f) => ACTIVE_FORMS.includes(f.id)).map((f) => (
          <button key={f.id} type="button" className="choice" aria-pressed={form === f.id} disabled={disabled} onClick={() => setForm(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <p className="note">{FORMS.find((f) => f.id === form)!.note}</p>
      <Segmented label="Scale" options={[{ value: '120', label: '~120 m' }, { value: '60', label: '~60 m' }]} value={String(scale) as '120' | '60'} onChange={(v) => setScale(Number(v) as Scale)} />
      <Segmented label="Values" options={[{ value: 'silhouette', label: 'Silhouette' }, { value: 'values', label: 'Values' }, { value: 'clay', label: 'Clay' }]} value={notan} onChange={setNotan} />
      <div className="choice-grid" role="group" aria-label="Framing">
        {HEROES.map((h) => (
          <button key={h.id} type="button" className="choice" aria-pressed={view.kind === 'hero' && view.id === h.id} disabled={disabled} onClick={() => setView({ kind: 'hero', id: h.id })}>
            {h.label}
          </button>
        ))}
        <button type="button" className="choice" aria-pressed={view.kind === 'under'} disabled={disabled} onClick={() => setView({ kind: 'under' })}>
          Under the roof
        </button>
        {([0, 1] as const).map((i) => (
          <button key={i} type="button" className="choice" aria-pressed={view.kind === 'detail' && view.index === i} disabled={disabled || !DETAIL[form]} onClick={() => setView({ kind: 'detail', index: i })}>
            {`Junction ${i + 1}${DETAIL[form] ? ` · ${DETAIL[form]![i].label}` : ''}`}
          </button>
        ))}
      </div>
      <div className="choice-grid" role="group" aria-label="Contact sheet">
        {elevs.map((e) => (
          <button key={e} type="button" className="choice" aria-pressed={view.kind === 'sheet' && view.elev === e} disabled={disabled} onClick={() => setView({ kind: 'sheet', elev: e })}>
            {`Sheet · ${e}`}
          </button>
        ))}
      </div>
      <p className="note">
        {hero ? hero.note : view.kind === 'detail' ? 'A close view of where the roof meets what carries it (new forms only).' : view.kind === 'under' ? 'Standing in the shade habitat at the roof’s edge, looking back in under the great shelf.' : 'The structure from twelve sides (degrees from the sun’s side: 0 has the sun behind the camera, 180 looks into it), same lens and distance.'} Choosing a framing again puts the camera back.
      </p>
    </>
  )
}
