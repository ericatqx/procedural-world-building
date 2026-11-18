import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Color, DirectionalLight, InstancedMesh, MeshBasicMaterial, Object3D, Vector3, type Material } from 'three'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { buildDweller } from '../../creature-lab/dweller.ts'
import { SITE, studySun, type StudySite } from '../site.ts'
import { drawArchitecture } from './architecture.ts'
import { inkOf, type InkBuilt, type InkSolids } from './build.ts'
import { hullMaterial, INK, paperMaterial, Pen, penLines, type V3 } from './paper.ts'

/**
 * Style B — The Field Notebook, the scene: the window drawn on paper. Paper surfaces with the faintest shadow tone; the pen's lines for every form;
 * the Dweller the only solid ink on the page. Line widths are in screen pixels, so the drawing keeps its weight from every plate.
 */
const WIDTH = { medium: 1.45, fine: 1.05, faint: 0.85 }

/** Keeps every fat line's resolution in step with the canvas (their widths are in its pixels). */
function useLineResolution(lines: LineSegments2[]) {
  const size = useThree((s) => s.size)
  useLayoutEffect(() => {
    for (const l of lines) (l.material as LineMaterial).resolution.set(size.width, size.height)
  }, [lines, size])
}

function Lines({ pens }: { pens: { pen: Pen; width: number; opacity?: number }[] }) {
  const lines = useMemo(() => pens.filter((p) => p.pen.pos.length).map((p) => penLines(p.pen, p.width, p.opacity)), [pens])
  useLineResolution(lines)
  useEffect(
    () => () =>
      lines.forEach((l) => {
        l.geometry.dispose()
        ;(l.material as Material).dispose()
      }),
    [lines],
  )
  return (
    <>
      {lines.map((l, k) => (
        <primitive key={k} object={l} />
      ))}
    </>
  )
}

function Light({ hour }: { hour: number }) {
  const light = useRef<DirectionalLight>(null)
  const scene = useThree((s) => s.scene)
  useLayoutEffect(() => {
    const l = light.current
    if (!l) return
    const sun = studySun(hour)
    const [x, y, z] = sun.direction
    l.position.set(SITE.cx + x * 500, 75 + y * 500, SITE.cz + z * 500)
    l.target.position.set(SITE.cx, 75, SITE.cz)
    if (!l.target.parent) scene.add(l.target)
    l.intensity = Math.PI * sun.daylight
    const cam = l.shadow.camera
    cam.left = -175
    cam.right = 175
    cam.top = 175
    cam.bottom = -175
    cam.near = 50
    cam.far = 1100
    cam.updateProjectionMatrix()
    l.shadow.needsUpdate = true
  }, [hour, scene])
  return <directionalLight ref={light} castShadow shadow-mapSize={[4096, 4096]} shadow-bias={-0.0002} shadow-normalBias={0.35} color="#ffffff" />
}

/** The ground's silhouettes from wherever the camera stands (ridges and the far edges of swells), redrawn as the camera moves. */
function TerrainSilhouettes({ built }: { built: InkBuilt }) {
  const camera = useThree((s) => s.camera)
  const line = useMemo(() => {
    const seed = new Pen('terrain')
    seed.seg([0, 0, 0], [0, 0, 0], new Color(INK.paper))
    return penLines(seed, WIDTH.medium)
  }, [])
  useLineResolution(useMemo(() => [line], [line]))
  const last = useRef({ at: 0, pos: new Vector3(Infinity, 0, 0), dir: new Vector3() })
  const dir = useMemo(() => new Vector3(), [])
  const sepia = useMemo(() => new Color(INK.sepia), [])
  useFrame(({ clock }) => {
    camera.getWorldDirection(dir)
    const l = last.current
    const t = clock.elapsedTime
    if (t - l.at < 0.12 || (l.pos.distanceTo(camera.position) < 0.3 && l.dir.angleTo(dir) < 0.01)) return
    l.at = t
    l.pos.copy(camera.position)
    l.dir.copy(dir)
    const { n, pos, nor } = built.grid
    const s = new Float32Array(n * n)
    const c = camera.position
    for (let k = 0; k < n * n; k += 1) s[k] = nor[k * 3]! * (c.x - pos[k * 3]!) + nor[k * 3 + 1]! * (c.y - pos[k * 3 + 1]!) + nor[k * 3 + 2]! * (c.z - pos[k * 3 + 2]!)
    const pen = new Pen('terrain')
    const cross = (a: number, b: number): V3 => {
      const u = s[a]! / (s[a]! - s[b]!)
      return [pos[a * 3]! + (pos[b * 3]! - pos[a * 3]!) * u, pos[a * 3 + 1]! + (pos[b * 3 + 1]! - pos[a * 3 + 1]!) * u + 0.12, pos[a * 3 + 2]! + (pos[b * 3 + 2]! - pos[a * 3 + 2]!) * u]
    }
    const tri = (a: number, b: number, d: number) => {
      const pts: V3[] = []
      if (s[a]! < 0 !== s[b]! < 0) pts.push(cross(a, b))
      if (s[b]! < 0 !== s[d]! < 0) pts.push(cross(b, d))
      if (s[d]! < 0 !== s[a]! < 0) pts.push(cross(d, a))
      if (pts.length === 2) pen.seg(pts[0]!, pts[1]!, sepia)
    }
    for (let j = 0; j + 1 < n; j += 1) {
      for (let i = 0; i + 1 < n; i += 1) {
        const k = j * n + i
        tri(k, k + n, k + 1)
        tri(k + 1, k + n, k + n + 1)
      }
    }
    if (built.level !== null) {
      // Under the water the ground is not drawn.
      const keep: number[] = []
      const col: number[] = []
      for (let q = 0; q < pen.pos.length; q += 6) {
        if (pen.pos[q + 1]! < built.level + 0.1 && pen.pos[q + 4]! < built.level + 0.1) continue
        keep.push(...pen.pos.slice(q, q + 6))
        col.push(...pen.col.slice(q, q + 6))
      }
      pen.pos = keep
      pen.col = col
    }
    line.geometry.setPositions(pen.pos.length ? pen.pos : [0, 0, 0, 0, 0, 0])
    line.geometry.setColors(pen.col.length ? pen.col : [1, 1, 1, 1, 1, 1])
  })
  return <primitive object={line} />
}

function Solids({ built }: { built: InkBuilt }) {
  const fill = useMemo(() => paperMaterial(), [])
  // Plants are drawn more lightly than the architecture: a graphite line, thin, so the crowns read as drawn masses, not cut-outs.
  const hull = useMemo(() => hullMaterial(INK.graphite, 0.0008), [])
  const meshes = useMemo(() => {
    const by = new Map<InkSolids, InkBuilt['solids']>()
    for (const s of built.solids) {
      if (!by.has(s.kind)) by.set(s.kind, [])
      by.get(s.kind)!.push(s)
    }
    const dummy = new Object3D()
    const out: InstancedMesh[] = []
    for (const [kind, list] of by) {
      for (const material of [fill, hull]) {
        const mesh = new InstancedMesh(built.shapes[kind], material, list.length)
        list.forEach((p, k) => {
          dummy.position.set(p.x, p.y, p.z)
          dummy.rotation.set(0, p.yaw, 0)
          dummy.scale.setScalar(p.s)
          dummy.updateMatrix()
          mesh.setMatrixAt(k, dummy.matrix)
        })
        mesh.castShadow = material === fill
        mesh.receiveShadow = material === fill
        mesh.computeBoundingSphere()
        out.push(mesh)
      }
    }
    return out
  }, [built, fill, hull])
  return (
    <>
      {meshes.map((m, k) => (
        <primitive key={k} object={m} />
      ))}
    </>
  )
}

function Architecture({ site, hour }: { site: StudySite; hour: number }) {
  const paper = useMemo(() => paperMaterial(), [])
  const heavy = useMemo(() => hullMaterial(INK.ink, 0.0021), [])
  const light = useMemo(() => hullMaterial(INK.graphite, 0.0012), [])
  // The courses move with the sun (contour hatching on the turned faces), redrawn on the half hour.
  const slot = Math.round(hour * 2) / 2
  const pens = useMemo(() => {
    const sun = studySun(slot).direction as V3
    const all: { pen: Pen; width: number; opacity?: number }[] = []
    for (const o of site.organisms) {
      const young = o.index !== 0 && o.staged
      const lines = drawArchitecture(o.geometry, young, young ? null : sun, inkOf(site).heightAt(o.x, o.z))
      all.push({ pen: lines.medium, width: WIDTH.medium }, { pen: lines.fine, width: WIDTH.fine }, { pen: lines.faint, width: WIDTH.faint, opacity: 0.85 })
    }
    return all
  }, [site, slot])
  return (
    <>
      {site.organisms.map((o) => (
        <group key={o.id}>
          <mesh geometry={o.geometry} material={paper} castShadow receiveShadow />
          <mesh geometry={o.geometry} material={o.index !== 0 && o.staged ? light : heavy} />
        </group>
      ))}
      <Lines pens={pens} />
    </>
  )
}

/** The study's Dweller (a specimen: none lives at this structure in the world), the one solid ink on the page. */
function Dweller({ built, site }: { built: InkBuilt; site: StudySite }) {
  const creature = useMemo(() => buildDweller({ seed: 11, age: 0.8, condition: 0.75, mineral: 0.5, habitat: 0.6 }), [])
  useEffect(() => {
    const ink = new MeshBasicMaterial({ color: INK.ink })
    creature.meshes.forEach((m) => {
      m.material = ink
      m.castShadow = true
    })
    return () => creature.dispose()
  }, [creature])
  useFrame((_, dt) => {
    creature.update(Math.min(dt, 0.05), { motion: 'idle', pace: 1, bank: 0 })
  })
  const spot = built.dweller
  if (!spot) return null
  const [dx, dz] = site.audit.water.dir ?? [1, 0]
  return (
    <group position={[spot[0], built.heightAt(spot[0], spot[1]), spot[1]]} rotation={[0, Math.atan2(dx, dz), 0]}>
      <primitive object={creature.root} />
    </group>
  )
}

export function InkScene({ site, hour, wash }: { site: StudySite; hour: number; wash: boolean }) {
  const built = useMemo(() => inkOf(site), [site])
  const mats = useMemo(() => ({ ground: paperMaterial({ vertexColors: true }), plain: paperMaterial(), water: paperMaterial({ color: '#efece5' }) }), [])
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])
  const pens = useMemo(
    () => [
      { pen: built.pens.medium, width: WIDTH.medium },
      { pen: built.pens.fine, width: WIDTH.fine },
      { pen: built.pens.faint, width: WIDTH.faint, opacity: 0.8 },
    ],
    [built],
  )
  return (
    <>
      <color attach="background" args={[INK.paper]} />
      <fog attach="fog" args={[INK.paper, 520, 1500]} />
      <Light hour={hour} />
      <mesh geometry={built.ground} material={wash ? mats.ground : mats.plain} receiveShadow />
      {built.water ? <mesh geometry={built.water} material={mats.water} receiveShadow /> : null}
      <TerrainSilhouettes built={built} />
      <Lines pens={pens} />
      <Solids built={built} />
      <Architecture site={site} hour={hour} />
      <Dweller built={built} site={site} />
    </>
  )
}
