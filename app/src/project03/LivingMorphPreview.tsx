import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MeshStandardMaterial, type BufferGeometry, type Mesh } from 'three'
import { growAscending } from '../architecture-lab/ascendingGrowth.ts'
import { growPorous, porousMesh, type PorousInputs } from '../architecture-lab/porousGrowth.ts'
import { wetness, worldTime } from './environment.ts'
import { livingArchitecture, waterBearing } from './livingArchitecture.ts'
import { organismState, type OrganismPlan, type Population } from './livingEcology.ts'
import { createGrownMaterial } from './livingMaterial.ts'
import { setPreviewStatus, usePreview } from './livingPreview.ts'
import { landscapeHeight } from './terrain.ts'
import type { World } from './world.ts'

/**
 * Draws the Porous Growth morphologies (Spreading, Ascending) on a few of the world's own Living Architecture sites, for visual
 * evaluation only (see livingPreview.ts). Each specimen is grown for its organism from the same ground the organism's plan read:
 * its light, moisture, supply, ridge or hollow, crowding by neighbours, distance and bearing to water, size and the opening's yaw.
 * The generators follow the real terrain height (the formation is built above the ground at each column), so each stands on the
 * island as it is. They are built here, one per turn of the event loop (a few hundred ms each), kept, and drawn mature.
 */
type Item = { key: string; index: number; morph: 'spreading' | 'ascending'; dx: number; dz: number }

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))

function inputsFor(world: World, population: Population, o: OrganismPlan, site: [number, number]): PorousInputs {
  const ground = landscapeHeight(site[0], site[1])
  let around = 0
  for (let k = 0; k < 8; k += 1) around += landscapeHeight(site[0] + Math.cos(k * 0.785) * 160, site[1] + Math.sin(k * 0.785) * 160)
  const ridge = clamp((ground - around / 8) / 25, -1, 1)
  const crowding = Math.min(1, population.organisms.reduce((acc, n) => (n.index === o.index ? acc : acc + (Math.hypot(n.x - o.x, n.z - o.z) < 260 ? Math.exp(-Math.hypot(n.x - o.x, n.z - o.z) / 110) : 0)), 0))
  const wd = o.base.waterDist
  const wb = wd < 400 ? waterBearing(world, site[0], site[1]) : null
  return {
    light: o.base.light,
    moisture: o.base.moisture,
    resource: o.base.resource,
    ridge,
    crowding,
    waterDist: wd < 400 ? wd : null,
    size: clamp(o.form.size ?? 1, 0.55, 1.2),
    sunAzimuth: Math.atan2(population.sunH[0], population.sunH[1]) - (o.form.yaw ?? 0),
    waterAzimuth: wb ? Math.atan2(wb[0], wb[2]) : null,
  }
}

export function MorphPreview({ world, population, sites }: { world: World; population: Population; sites: number[] }) {
  const { mode } = usePreview()
  const items = useMemo<Item[]>(() => {
    if (mode === 'off') return []
    const out: Item[] = []
    for (const index of sites) {
      const o = population.organisms[index]!
      const px = -population.sunH[1]
      const pz = population.sunH[0]
      if (mode === 'compare') {
        // The two stand on either side of the Overhang, on dry ground: the first of a few distances and sides where neither is in water.
        const dry = (sx: number, sz: number) => [0, 20, -20].every((e) => world.water.depthAt(o.x + sx + e, o.z + sz + e) <= 0.2)
        let best = { sx: 1, d: o.radius * 1.05 + 45, wet: 9 }
        for (const k of [1, 0.8, 1.25, 1.5]) for (const sx of [1, -1]) {
          const d = (o.radius * 1.05 + 45) * k
          const wet = (dry(px * d * sx, pz * d * sx) ? 0 : 1) + (dry(-px * d * sx, -pz * d * sx) ? 0 : 1)
          if (wet < best.wet) best = { sx, d, wet }
          if (wet === 0) break
        }
        const { sx, d } = best
        out.push({ key: `${world.seed}:${index}:spreading:-`, index, morph: 'spreading', dx: -px * d * sx, dz: -pz * d * sx })
        out.push({ key: `${world.seed}:${index}:ascending:+`, index, morph: 'ascending', dx: px * d * sx, dz: pz * d * sx })
      } else out.push({ key: `${world.seed}:${index}:${mode}:0`, index, morph: mode, dx: 0, dz: 0 })
    }
    return out
  }, [mode, sites, population, world])
  const cache = useRef(new Map<string, BufferGeometry>())
  const [, bump] = useState(0)
  const material = useMemo<MeshStandardMaterial>(() => createGrownMaterial() as MeshStandardMaterial, [])
  const meshes = useRef(new Map<string, Mesh>())
  const [near, setNear] = useState(false)
  useEffect(
    () => () => {
      for (const g of cache.current.values()) g.dispose()
      cache.current.clear()
      material.dispose()
    },
    [material],
  )
  // Build what is missing, one specimen per turn of the event loop.
  useEffect(() => {
    let live = true
    let timer = 0
    const todo = items.filter((it) => !cache.current.has(it.key))
    let ms = 0
    const report = () => setPreviewStatus({ built: items.length - todo.length, total: items.length, ms: Math.round(ms) })
    report()
    const next = () => {
      if (!live) return
      const it = todo.shift()
      if (!it) return
      const o = population.organisms[it.index]!
      const site: [number, number] = [o.x + it.dx, o.z + it.dz]
      const seed = 1 + (Math.abs((world.seed | 0) + o.index * 37) % 99)
      const t0 = performance.now()
      try {
        const inputs = inputsFor(world, population, o, site)
        const plan = (it.morph === 'ascending' ? growAscending : growPorous)(seed, site, inputs)
        cache.current.set(it.key, porousMesh(plan, 1))
        console.info('[living architecture] morphology preview', { site: o.id, morph: it.morph, size: inputs.size, ms: Math.round(performance.now() - t0), height: plan.measure.height, length: plan.measure.length, width: plan.measure.width, overhang: { height: Math.round(o.height), radius: Math.round(o.radius) } })
      } catch (e) {
        console.warn('[living architecture] morphology preview failed', it.key, e)
      }
      ms += performance.now() - t0
      livingArchitecture.version += 1
      bump((v) => v + 1)
      report()
      timer = window.setTimeout(next, 30)
    }
    timer = window.setTimeout(next, 30)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [items, population, world])
  useEffect(() => {
    livingArchitecture.version += 1
  }, [mode])
  useFrame((state) => {
    material.color.setScalar(1 - 0.16 * wetness.value)
    // Labels only when the camera is within a kilometre of a previewed site.
    const cam = state.camera.position
    const close = sites.some((i) => Math.hypot(population.organisms[i]!.x - cam.x, population.organisms[i]!.z - cam.z) < 1000)
    if (close !== near) setNear(close)
    const t = worldTime()
    for (const it of items) {
      const m = meshes.current.get(it.key)
      if (m) m.visible = it.index === 0 || organismState(population, it.index, t).present
    }
  })
  return (
    <group>
      {items.map((it) => {
        const geometry = cache.current.get(it.key)
        if (!geometry) return null
        const o = population.organisms[it.index]!
        const x = o.x + it.dx
        const z = o.z + it.dz
        return (
          <group key={it.key}>
            <mesh
              ref={(m) => {
                if (m) meshes.current.set(it.key, m)
                else meshes.current.delete(it.key)
              }}
              geometry={geometry}
              material={material}
              castShadow
              receiveShadow
              frustumCulled={false}
            />
            {mode === 'compare' && near ? (
              <Html position={[x, landscapeHeight(x, z) + 70, z]} zIndexRange={[10, 0]} center>
                <span style={{ font: '11px/1 ui-monospace, monospace', color: '#d9d4c4', background: 'rgba(8,10,14,0.7)', padding: '3px 6px', whiteSpace: 'nowrap' }}>{it.morph === 'spreading' ? 'Spreading' : 'Ascending'}</span>
              </Html>
            ) : null}
          </group>
        )
      })}
    </group>
  )
}
