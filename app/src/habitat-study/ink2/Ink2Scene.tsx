import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { BackSide, Color, DirectionalLight, InstancedMesh, MeshBasicMaterial, Object3D, ShaderMaterial, SphereGeometry, Vector3, type Material } from 'three'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { buildDweller } from '../../creature-lab/dweller.ts'
import { drawArchitecture } from '../ink/architecture.ts'
import { inkOf, type InkBuilt, type InkSolids } from '../ink/build.ts'
import { hullMaterial, penLines, type Pen, type V3 } from '../ink/paper.ts'
import { SITE, studySun, type StudySite } from '../site.ts'
import { ink2Of, grey } from './build2.ts'
import { graphiteMaterial, graphiteUniforms, keyAt } from './graphite.ts'

/**
 * Style B v2 — The Charcoal Notebook, Phase B2.1: light, tone and cobalt. White paper; graphite form and cast shadow, hatched; charcoal recesses;
 * the shade habitat in cobalt pigment. v1's lines are kept (regraded) so the tone can be judged on its own; their character comes in B2.2.
 */
const WIDTH = { medium: 1.45, fine: 1.05, faint: 0.85 }

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

/** The sky: white at the zenith, a grey haze at the horizon; both darken at dusk. Distance fades into the horizon's grey (the scene's fog). */
function Sky({ hour }: { hour: number }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uTop: { value: 1 }, uHorizon: { value: 0.95 } },
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
            float v = mix(uHorizon, uTop, smoothstep(-0.02, 0.5, vDir.y));
            v = mix(v, uHorizon * 0.97, smoothstep(0.0, -0.2, vDir.y));
            gl_FragColor = vec4(vec3(v), 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    [],
  )
  const geometry = useMemo(() => new SphereGeometry(2500, 32, 16), [])
  const k = keyAt(hour)
  material.uniforms.uTop!.value = k.top
  material.uniforms.uHorizon!.value = k.horizon
  const haze = new Color(k.horizon, k.horizon, k.horizon)
  return (
    <>
      <fog attach="fog" args={[haze, 420, 1700]} />
      <mesh geometry={geometry} material={material} position={[SITE.cx, 0, SITE.cz]} renderOrder={-1} />
    </>
  )
}

/** The sun, intensity π (the shader reads its light as 0 to 1); its direction, in view space, kept current for the shading every frame. */
function Light({ hour }: { hour: number }) {
  const light = useRef<DirectionalLight>(null)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const world = useMemo(() => new Vector3(), [])
  useLayoutEffect(() => {
    const l = light.current
    if (!l) return
    const sun = studySun(hour)
    const [x, y, z] = sun.direction
    world.set(x, y, z).normalize()
    l.position.set(SITE.cx + x * 500, 75 + y * 500, SITE.cz + z * 500)
    l.target.position.set(SITE.cx, 75, SITE.cz)
    if (!l.target.parent) scene.add(l.target)
    l.intensity = Math.PI * Math.max(0.15, sun.daylight)
    const cam = l.shadow.camera
    cam.left = -175
    cam.right = 175
    cam.top = 175
    cam.bottom = -175
    cam.near = 50
    cam.far = 1100
    cam.updateProjectionMatrix()
    l.shadow.needsUpdate = true
    const k = keyAt(hour)
    const u = graphiteUniforms
    u.uSunUp.value = Math.max(0.05, world.y)
    // The cast shadow's strokes run with the light: from the sun, across the ground.
    u.uSunAz.value.set(-world.x, -world.z).normalize()
    u.uForm.value = k.form
    u.uCast.value = k.cast
    u.uEdge.value = k.edge
    u.uCross.value = k.cross
    u.uExpo.value = k.expo
    u.uCobaltK.value = k.cobalt
  }, [hour, scene, world])
  useFrame(() => {
    graphiteUniforms.uSunView.value.copy(world).transformDirection(camera.matrixWorldInverse)
  })
  return <directionalLight ref={light} castShadow shadow-mapSize={[4096, 4096]} shadow-bias={-0.0002} shadow-normalBias={0.35} color="#ffffff" />
}

function Solids({ built }: { built: InkBuilt }) {
  const fill = useMemo(() => graphiteMaterial(), [])
  const hull = useMemo(() => hullMaterial('#4a4a4a', 0.0008), [])
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
  const b2 = useMemo(() => ink2Of(site), [site])
  const surface = useMemo(() => graphiteMaterial({ ao: true }), [])
  const heavy = useMemo(() => hullMaterial('#141414', 0.0021), [])
  const light = useMemo(() => hullMaterial('#6a6a6a', 0.0012), [])
  const slot = Math.round(hour * 2) / 2
  const pens = useMemo(() => {
    const sun = studySun(slot).direction as V3
    const all: { pen: Pen; width: number; opacity?: number }[] = []
    for (const o of site.organisms) {
      const young = o.index !== 0 && o.staged
      const lines = drawArchitecture(o.geometry, young, young ? null : sun, inkOf(site).heightAt(o.x, o.z))
      all.push({ pen: grey(lines.medium), width: WIDTH.medium }, { pen: grey(lines.fine), width: WIDTH.fine }, { pen: grey(lines.faint), width: WIDTH.faint, opacity: 0.85 })
    }
    return all
  }, [site, slot])
  return (
    <>
      {site.organisms.map((o) => (
        <group key={o.id}>
          <mesh geometry={b2.organisms.get(o.id) ?? o.geometry} material={surface} castShadow receiveShadow />
          <mesh geometry={o.geometry} material={o.index !== 0 && o.staged ? light : heavy} />
        </group>
      ))}
      <Lines pens={pens} />
    </>
  )
}

/** The study's Dweller (a specimen: none lives at this structure in the world), near-black: the darkest small shape on the page. */
function Dweller({ built, site }: { built: InkBuilt; site: StudySite }) {
  const creature = useMemo(() => buildDweller({ seed: 11, age: 0.8, condition: 0.75, mineral: 0.5, habitat: 0.6 }), [])
  useEffect(() => {
    const k = new MeshBasicMaterial({ color: '#151515' })
    creature.meshes.forEach((m) => {
      m.material = k
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

export function Ink2Scene({ site, hour }: { site: StudySite; hour: number }) {
  const built = useMemo(() => inkOf(site), [site])
  const b2 = useMemo(() => ink2Of(site), [site])
  const mats = useMemo(() => ({ ground: graphiteMaterial({ ao: true, habitat: true }), water: graphiteMaterial() }), [])
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])
  const pens = useMemo(
    () => [
      { pen: b2.pens.medium, width: WIDTH.medium },
      { pen: b2.pens.fine, width: WIDTH.fine },
      { pen: b2.pens.faint, width: WIDTH.faint, opacity: 0.85 },
    ],
    [b2],
  )
  return (
    <>
      <Sky hour={hour} />
      <Light hour={hour} />
      <mesh geometry={b2.ground} material={mats.ground} receiveShadow />
      {built.water ? <mesh geometry={built.water} material={mats.water} receiveShadow /> : null}
      <Lines pens={pens} />
      <Solids built={built} />
      <Architecture site={site} hour={hour} />
      <Dweller built={built} site={site} />
    </>
  )
}
