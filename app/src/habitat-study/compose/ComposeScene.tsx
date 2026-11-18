import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { BackSide, Color, DirectionalLight, InstancedMesh, Object3D, PerspectiveCamera, ShaderMaterial, SphereGeometry, SRGBColorSpace, Vector3 } from 'three'
import { landscapeHeight } from '../../project03/terrain.ts'
import { growVariant, SPECIES, STRIDE, VARIANTS } from '../../project03/worldPlants.ts'
import { groundEye, SITE, studySun, type StudySite } from '../site.ts'
import { ceilingAt, coverOf, DESIGN, DETAIL, formGeometry, frameOf, groundOcclusion, toWorld, UNDER, type FormId, type Scale } from './forms.ts'
import { HEROES, pose, poseUnder, sheetFramings, type Framing, type SheetElevation, type Subject } from './framings.ts'
import { composeGround, setDeep, setOcc } from './ground.ts'

/** A placed camera: at (ex, ez), standing at eye height (or at eyeY, never below eye height), looking at (tx, ty, tz). */
function aim(camera: PerspectiveCamera, ex: number, ez: number, tx: number, tz: number, ty: number, eyeY = -Infinity, fov = 52): Vector3 {
  camera.fov = fov
  camera.aspect = 16 / 9
  camera.position.set(ex, Math.max(landscapeHeight(ex, ez) + 1.6, eyeY), ez)
  const target = new Vector3(tx, ty, tz)
  camera.lookAt(target)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  return target
}
import { fogGrey, MODE_INDEX, notanMaterial, notanUniforms, VALUES, type NotanMode } from './notan.ts'

/**
 * Style C — Composition study. One subject, neutral values, a fixed 16:9 plate. Rendering is taken over here so the plate is an exact rectangle
 * (the same in every screenshot) and the contact sheet can draw twelve cameras at once.
 */
export type ComposeView = { kind: 'hero'; id: string } | { kind: 'under' } | { kind: 'detail'; index: 0 | 1 } | { kind: 'sheet'; elev: SheetElevation }

/** The hour every framing is anchored to: a camera keeps its place when the hour changes, so two hours compare like for like. */
export const ANCHOR_HOUR = 16.5

// ------------------------------------------------------------------------------------------------------------- layout (shared with the overlay)

export type Rect = { x: number; y: number; w: number; h: number }
export type Layout = { plate: Rect | null; cells: { rect: Rect; label: string }[] }
let layout: Layout = { plate: null, cells: [] }
const listeners = new Set<() => void>()
function setLayout(next: Layout) {
  if (JSON.stringify(next) === JSON.stringify(layout)) return
  layout = next
  for (const l of listeners) l()
}
export function useComposeLayout(): Layout {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => layout,
  )
}

const ASPECT = 16 / 9
/** The free area left of the instrument panel and above the view strip, and the largest 16:9 plate centred in it. */
function area(w: number, h: number): Rect {
  const panel = document.querySelector('.hstudy .instrument-panel')?.getBoundingClientRect()
  const right = panel && panel.width < w * 0.6 ? w - panel.left + 12 : 0
  const m = 16
  return { x: m, y: m, w: w - right - m * 2, h: h - 58 - m * 2 }
}
function fit(r: Rect, aspect: number): Rect {
  const w = Math.min(r.w, r.h * aspect)
  const h = w / aspect
  return { x: Math.round(r.x + (r.w - w) / 2), y: Math.round(r.y + (r.h - h) / 2), w: Math.round(w), h: Math.round(h) }
}
function grid(r: Rect, cols: number, rows: number, gap: number): Rect[] {
  const cw = Math.min((r.w - gap * (cols - 1)) / cols, ((r.h - gap * (rows - 1)) / rows) * ASPECT)
  const ch = cw / ASPECT
  const x0 = r.x + (r.w - (cw * cols + gap * (cols - 1))) / 2
  const y0 = r.y + (r.h - (ch * rows + gap * (rows - 1))) / 2
  const out: Rect[] = []
  for (let j = 0; j < rows; j += 1) for (let i = 0; i < cols; i += 1) out.push({ x: Math.round(x0 + i * (cw + gap)), y: Math.round(y0 + j * (ch + gap)), w: Math.round(cw), h: Math.round(ch) })
  return out
}

// ------------------------------------------------------------------------------------------------------------- the scene

function Sky() {
  const material = useMemo(() => {
    const lin = (v: number) => new Color().setRGB(v, v, v, SRGBColorSpace).r
    return new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTop: { value: lin(VALUES.sky.top) }, uHorizon: { value: lin(VALUES.sky.horizon) } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTop;
        uniform float uHorizon;
        varying vec3 vDir;
        void main() {
          gl_FragColor = vec4(vec3(mix(uHorizon, uTop, smoothstep(0.0, 0.45, vDir.y))), 1.0);
          #include <colorspace_fragment>
        }`,
    })
  }, [])
  const geometry = useMemo(() => new SphereGeometry(3000, 32, 16), [])
  return <mesh geometry={geometry} material={material} position={[SITE.cx, 0, SITE.cz]} renderOrder={-1} frustumCulled={false} />
}

/** The clay view's key: the hour's sun in azimuth, never lower than this (a modelling light, so the forms read in the round). */
const CLAY_KEY_ELEVATION = 38

function Sun({ hour, clay }: { hour: number; clay: boolean }) {
  const light = useRef<DirectionalLight>(null)
  const scene = useThree((s) => s.scene)
  useLayoutEffect(() => {
    const l = light.current
    if (!l) return
    let [x, y, z] = studySun(hour).direction
    if (clay) {
      const e = Math.max(Math.asin(Math.min(1, y)), (CLAY_KEY_ELEVATION * Math.PI) / 180)
      const h = Math.hypot(x, z) || 1
      ;[x, y, z] = [(x / h) * Math.cos(e), Math.sin(e), (z / h) * Math.cos(e)]
    }
    // Soft edges in clay (a large penumbra), crisp ones otherwise.
    l.shadow.radius = clay ? 6 : 1
    l.position.set(SITE.cx + x * 600, 75 + y * 600, SITE.cz + z * 600)
    l.target.position.set(SITE.cx, 75, SITE.cz)
    if (!l.target.parent) scene.add(l.target)
    l.intensity = Math.PI
    const cam = l.shadow.camera
    cam.left = -190
    cam.right = 190
    cam.top = 190
    cam.bottom = -190
    cam.near = 50
    cam.far = 1400
    cam.updateProjectionMatrix()
    l.shadow.needsUpdate = true
  }, [hour, scene, clay])
  return <directionalLight ref={light} castShadow shadow-mapSize={[4096, 4096]} shadow-bias={-0.0002} shadow-normalBias={0.4} color="#ffffff" />
}

function Plants({ site, keep }: { site: StudySite; keep: (x: number, z: number) => boolean }) {
  const material = useMemo(() => notanMaterial('plant', { side: 2 }), [])
  const meshes = useMemo(() => {
    const out: InstancedMesh[] = []
    const dummy = new Object3D()
    for (const [id, arr] of site.plants) {
      const sp = SPECIES.find((s) => s.id === id)
      if (!sp) continue
      const byVariant = new Map<number, number[]>()
      for (let o = 0; o < arr.length; o += STRIDE) {
        if (!keep(arr[o]!, arr[o + 2]!)) continue
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
          mesh.setMatrixAt(k, dummy.matrix)
        })
        mesh.castShadow = sp.group !== 'cover'
        mesh.receiveShadow = true
        mesh.computeBoundingSphere()
        out.push(mesh)
      }
    }
    return out
  }, [site, material, keep])
  useEffect(() => () => meshes.forEach((m) => m.geometry.dispose()), [meshes])
  return (
    <>
      {meshes.map((m, k) => (
        <primitive key={k} object={m} />
      ))}
    </>
  )
}

/** Takes over drawing: the plate (one camera in an exact 16:9 rectangle) or the sheet (twelve cameras), on the chrome's dark ground. */
function Renderer({ site, view, tick, subject, place, shadowKey }: { site: StudySite; view: ComposeView; tick: number; subject: Subject; place: (camera: PerspectiveCamera, view: ComposeView) => Vector3 | null; shadowKey: string }) {
  const { gl, scene, size } = useThree()
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => void; enabled: boolean } | null
  const sheetCams = useMemo(() => Array.from({ length: 12 }, () => new PerspectiveCamera(24, ASPECT, 0.5, 6000)), [])
  const bg = useMemo(() => new Color('#1c1d20'), [])

  // A framing chosen (or chosen again) puts the camera back.
  useLayoutEffect(() => {
    if (view.kind === 'sheet') return
    const target = view.kind === 'hero' ? pose(camera, site, HEROES.find((h) => h.id === view.id) ?? HEROES[0]!, ANCHOR_HOUR, ASPECT, subject) : place(camera, view)
    if (controls && target) {
      controls.target.copy(target)
      controls.update()
    }
  }, [site, view.kind, view.kind === 'hero' ? view.id : view.kind === 'detail' ? view.index : '', tick, camera, controls, subject, place])

  // Development only: try a framing from the console, e.g. __compose({ az: 45, elev: 4, dist: 6, fov: 20, lift: 0.4, shift: [0.2, 0.1] }).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __compose?: (f: Partial<Framing>) => void }
    w.__compose = (f) => {
      const target = pose(camera, site, { ...HEROES[0]!, ...f }, ANCHOR_HOUR, ASPECT, subject)
      if (controls) {
        controls.target.copy(target)
        controls.update()
      }
    }
    return () => {
      delete w.__compose
    }
  }, [camera, controls, site, subject])

  const elev = view.kind === 'sheet' ? view.elev : null
  useLayoutEffect(() => {
    if (!elev) return
    sheetFramings(elev).forEach((f, k) => pose(sheetCams[k]!, site, f, ANCHOR_HOUR, ASPECT, subject))
  }, [elev, site, sheetCams, subject])

  useEffect(() => {
    if (controls) controls.enabled = view.kind !== 'sheet'
  }, [controls, view.kind])

  // The shadow map (4096²) is redrawn only when what casts or lights it changes (the hour, the form, the light mode), for a few frames so
  // late updates (a material compiling, an attribute uploaded) are caught; the camera moving does not change it.
  const shadowFrames = useRef(4)
  useEffect(() => {
    shadowFrames.current = 4
  }, [shadowKey, view.kind])

  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    return () => {
      gl.shadowMap.autoUpdate = true
      setLayout({ plate: null, cells: [] })
    }
  }, [gl])

  useFrame(() => {
    const a = area(size.width, size.height)
    const H = size.height
    gl.setScissorTest(false)
    gl.setClearColor(bg, 1)
    gl.clear()
    gl.shadowMap.needsUpdate = shadowFrames.current > 0
    if (shadowFrames.current > 0) shadowFrames.current -= 1
    gl.setScissorTest(true)
    const draw = (r: Rect, cam: PerspectiveCamera) => {
      gl.setViewport(r.x, H - r.y - r.h, r.w, r.h)
      gl.setScissor(r.x, H - r.y - r.h, r.w, r.h)
      gl.render(scene, cam)
      gl.shadowMap.needsUpdate = false
    }
    if (view.kind === 'sheet') {
      const rects = grid(a, 4, 3, 8)
      const labels = sheetFramings(view.elev).map((f) => f.label)
      rects.forEach((r, k) => draw(r, sheetCams[k]!))
      setLayout({ plate: null, cells: rects.map((rect, k) => ({ rect, label: labels[k]! })) })
    } else {
      const r = fit(a, ASPECT)
      camera.aspect = ASPECT
      camera.updateProjectionMatrix()
      draw(r, camera)
      setLayout({ plate: r, cells: [] })
    }
    gl.setScissorTest(false)
    gl.setViewport(0, 0, size.width, size.height)
  }, 1)
  return null
}

export function ComposeScene({ site, hour, mode, view, tick, form, scale }: { site: StudySite; hour: number; mode: NotanMode; view: ComposeView; tick: number; form: FormId; scale: Scale }) {
  const ground = useMemo(() => composeGround(site), [site])
  const S = scale / 120
  const frame = useMemo(() => frameOf(site), [site])
  const reference = useMemo(() => formGeometry(site, form, scale), [site, form, scale])
  // What the form does to the ground: deep shade where it roofs the ground with standing room, no plants where it stands or roofs them low.
  const cover = useMemo(() => coverOf(reference, SITE.cx - SITE.half, SITE.cz - SITE.half, SITE.half + 1, 2), [reference])
  useLayoutEffect(() => {
    setDeep(ground.near, (x, z) => {
      const c = ceilingAt(cover, x, z)
      return c < Infinity && c > 1.5
    })
  }, [ground, cover])
  const keep = useMemo(() => (x: number, z: number) => ceilingAt(cover, x, z) > 14, [cover])
  // The same cameras for every form at a scale: they frame the design envelope, not each form's own bounds.
  const subject = useMemo<Subject>(() => ({ center: new Vector3(frame.cx, frame.g0, frame.cz), base: frame.g0, height: DESIGN.height * S, radius: DESIGN.radius * S }), [frame, S])
  // Occlusion on the ground from this form (clay only reads it).
  useLayoutEffect(() => {
    setOcc(ground.near, groundOcclusion(site, form, scale, ground.near))
  }, [ground, site, form, scale])
  const place = useCallback(
    (camera: PerspectiveCamera, v: ComposeView) => {
      if (v.kind === 'detail') {
        const d = DETAIL[form]?.[v.index]
        if (!d) return null
        const [ex, ez] = toWorld(frame, d.eye[0] * S, d.eye[1] * S)
        const [tx, tz] = toWorld(frame, d.at[0] * S, d.at[1] * S)
        return aim(camera, ex, ez, tx, tz, frame.g0 + d.at[2] * S, frame.g0 + d.eye[2] * S, d.fov)
      }
      if (form === 'original' || form === 'originalRefined') {
        if (S === 1) return poseUnder(camera, site)
        const e = groundEye(site)
        if (!e) return null
        const sc = (x: number, z: number): [number, number] => [frame.cx + (x - frame.cx) * S, frame.cz + (z - frame.cz) * S]
        const [ex, ez] = sc(e.x, e.z)
        const [tx, tz] = sc(e.tx, e.tz)
        return aim(camera, ex, ez, tx, tz, frame.g0 + 7 * S)
      }
      const u = UNDER[form]
      const [ex, ez] = toWorld(frame, u.eye[0] * S, u.eye[1] * S)
      const [tx, tz] = toWorld(frame, u.at[0] * S, u.at[1] * S)
      return aim(camera, ex, ez, tx, tz, frame.g0 + u.at[2] * S)
    },
    [form, S, site, frame],
  )
  const mats = useMemo(() => ({ ground: notanMaterial('ground'), architecture: notanMaterial('architecture') }), [])
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])
  notanUniforms.uMode.value = MODE_INDEX[mode]
  const fog = useMemo(() => fogGrey(), [])
  return (
    <>
      <fog attach="fog" args={[fog, 220, 1500]} />
      <Sky />
      <Sun hour={hour} clay={mode === 'clay'} />
      <mesh geometry={ground.near} material={mats.ground} receiveShadow castShadow />
      <mesh geometry={ground.far} material={mats.ground} receiveShadow />
      {site.organisms.map((o) => (
        <mesh key={o.id} geometry={o.index === 0 ? reference : o.geometry} material={mats.architecture} castShadow receiveShadow />
      ))}
      <Plants site={site} keep={keep} />
      <Renderer site={site} view={view} tick={tick} subject={subject} place={place} shadowKey={`${hour}|${form}|${scale}|${mode}`} />
    </>
  )
}
