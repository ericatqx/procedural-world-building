import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { BackSide, Color, DirectionalLight, DoubleSide, InstancedMesh, Object3D, ShaderMaterial, SphereGeometry, type Material } from 'three'
import { buildDweller } from '../../creature-lab/dweller.ts'
import { SITE, studySun, type StudySite } from '../site.ts'
import { sculptOf, type Built } from './build.ts'
import type { Archetype } from './forms.ts'
import { lightAt, PAL } from './palette.ts'
import { outlineMaterial, rampMaterial, rampUniforms } from './ramp.ts'

/**
 * Style A — The Ochre Benches, the scene: the window as a late-afternoon diorama. Pale sculpted ground in large colour regions, tiered rock benches and
 * a stone plinth, the Reference Overhang carved into broad planes, plants as clean solids in composed groups, flat violet shadow, one coral Dweller.
 * Built once per site (cached), so switching styles and hours is immediate.
 */
function Sky() {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uTop: { value: new Color() }, uHorizon: { value: new Color() }, uDeep: { value: new Color('#3b3049') } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop;
          uniform vec3 uHorizon;
          uniform vec3 uDeep;
          varying vec3 vDir;
          void main() {
            // Above the horizon the hour's sky; below it the deep ground the diorama stands over, so the window floats on a quiet, dark field.
            float t = smoothstep(-0.05, 0.55, vDir.y);
            vec3 c = mix(uHorizon, uTop, t);
            c = mix(c, uDeep, smoothstep(0.0, -0.18, vDir.y));
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    [],
  )
  const geometry = useMemo(() => new SphereGeometry(2500, 32, 16), [])
  return <mesh geometry={geometry} material={material} position={[SITE.cx, 0, SITE.cz]} renderOrder={-1} userData={{ sky: material }} name="sculpt-sky" />
}

/** The sun, intensity π (the ramp reads its light as 0 to 1), and the hour's palette: shadow hue, light tint, sky and the haze at the window's edge. */
function Light({ hour }: { hour: number }) {
  const light = useRef<DirectionalLight>(null)
  const scene = useThree((s) => s.scene)
  useLayoutEffect(() => {
    const l = light.current
    if (!l) return
    const sun = studySun(hour)
    const [x, y, z] = sun.direction
    const cy = 75
    l.position.set(SITE.cx + x * 500, cy + y * 500, SITE.cz + z * 500)
    l.target.position.set(SITE.cx, cy, SITE.cz)
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
    const k = lightAt(hour)
    rampUniforms.uShadowCol.value.copy(k.shadow)
    rampUniforms.uShadowMix.value = k.mix
    rampUniforms.uLightCol.value.copy(k.light)
    rampUniforms.uSkyCol.value.copy(k.top)
    const sky = scene.getObjectByName('sculpt-sky')
    const m = sky?.userData.sky as ShaderMaterial | undefined
    if (m) {
      m.uniforms.uTop!.value.copy(k.top)
      m.uniforms.uHorizon!.value.copy(k.horizon)
    }
  }, [hour, scene])
  const haze = lightAt(hour).horizon
  return (
    <>
      <fog attach="fog" args={[haze, 700, 2200]} />
      <directionalLight ref={light} castShadow shadow-mapSize={[4096, 4096]} shadow-bias={-0.0002} shadow-normalBias={0.35} color="#ffffff" />
    </>
  )
}

function Plants({ built }: { built: Built }) {
  const material = useMemo(() => rampMaterial({ side: DoubleSide }), [])
  const meshes = useMemo(() => {
    const by = new Map<Archetype, typeof built.plants>()
    for (const p of built.plants) {
      if (!by.has(p.arch)) by.set(p.arch, [])
      by.get(p.arch)!.push(p)
    }
    const dummy = new Object3D()
    const out: InstancedMesh[] = []
    for (const [arch, list] of by) {
      const mesh = new InstancedMesh(built.shapes[arch], material, list.length)
      list.forEach((p, k) => {
        dummy.position.set(p.x, p.y - 0.05, p.z)
        dummy.rotation.set(0, p.yaw, 0)
        dummy.scale.setScalar(p.s)
        dummy.updateMatrix()
        mesh.setMatrixAt(k, dummy.matrix)
        mesh.setColorAt(k, p.color)
      })
      mesh.castShadow = list.some((p) => p.shadow)
      mesh.receiveShadow = true
      mesh.computeBoundingSphere()
      out.push(mesh)
    }
    return out
  }, [built, material])
  return (
    <>
      {meshes.map((m, k) => (
        <primitive key={k} object={m} />
      ))}
    </>
  )
}

/** The study's Dweller: a specimen, not a resident (no Dweller lives at this structure in the world). Lying up in the deepest shade beside it. */
function Dweller({ built, site }: { built: Built; site: StudySite }) {
  const creature = useMemo(() => buildDweller({ seed: 11, age: 0.8, condition: 0.75, mineral: 0.5, habitat: 0.6 }), [])
  const holder = useRef<Object3D>(null)
  useEffect(() => {
    const coral = rampMaterial({ color: PAL.coral, vertexColors: false })
    const pale = rampMaterial({ color: PAL.coralPale, vertexColors: false })
    creature.meshes.forEach((m, k) => {
      m.material = k === 0 ? coral : pale
      m.castShadow = true
      m.receiveShadow = true
    })
    creature.update(0.016, { motion: 'idle', pace: 1, bank: 0 })
    return () => creature.dispose()
  }, [creature])
  useFrame((_, dt) => {
    creature.update(Math.min(dt, 0.05), { motion: 'idle', pace: 1, bank: 0 })
  })
  const spot = built.dweller
  if (!spot) return null
  const [dx, dz] = site.audit.water.dir ?? [1, 0]
  return (
    <group ref={holder} position={[spot[0], built.land.heightAt(spot[0], spot[1]), spot[1]]} rotation={[0, Math.atan2(dx, dz), 0]}>
      <primitive object={creature.root} />
    </group>
  )
}

export function SculptScene({ site, hour }: { site: StudySite; hour: number }) {
  const built = useMemo(() => sculptOf(site), [site])
  const mats = useMemo(
    () => ({
      ground: rampMaterial(),
      stone: rampMaterial(),
      pedestal: rampMaterial({ side: DoubleSide }),
      arch: rampMaterial(),
      water: rampMaterial({ color: PAL.water, vertexColors: false }),
      outlineArch: outlineMaterial(PAL.outlineArch, 0.0016),
      outlineYoung: outlineMaterial(PAL.outlineArch, 0.0011),
      outlineRock: outlineMaterial(PAL.outlineRock, 0.0012),
    }),
    [],
  )
  useEffect(() => () => Object.values(mats).forEach((m: Material) => m.dispose()), [mats])
  const { land } = built
  return (
    <>
      <Sky />
      <Light hour={hour} />
      <mesh geometry={land.ground} material={mats.ground} receiveShadow castShadow />
      <mesh geometry={land.pedestal} material={mats.pedestal} />
      {land.water ? <mesh geometry={land.water} material={mats.water} receiveShadow /> : null}
      <mesh geometry={land.rocks} material={mats.stone} castShadow receiveShadow />
      <mesh geometry={land.rocksOutline} material={mats.outlineRock} />
      {built.carved.map(({ id, geometry }) => (
        <group key={id}>
          <mesh geometry={geometry.geometry} material={mats.arch} castShadow receiveShadow />
          <mesh geometry={geometry.outline} material={id === site.organisms.find((o) => o.index === 0)?.id ? mats.outlineArch : mats.outlineYoung} />
        </group>
      ))}
      <Plants built={built} />
      <Dweller built={built} site={site} />
    </>
  )
}
