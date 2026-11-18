import { OrbitControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, CircleGeometry, Color, ConeGeometry, DataTexture, InstancedMesh, LinearFilter, type Mesh, Object3D, RGBAFormat, SphereGeometry, SRGBColorSpace, Sphere, UnsignedByteType, Vector3 } from 'three'
import { AUTO_ROTATE_SPEED } from '../../shared/ui/instrument.tsx'
import { DT, MAX_AGENTS, PATCH, senseRadius, SITE_MAX, SPECIES, STATES, type Metrics, type Params, type Sim } from './agents.ts'

export const STATE_COLOR: Record<(typeof STATES)[number], string> = { wander: '#cfc9bb', seek: '#B69A80', forage: '#8A9D91', rest: '#7fa6d6' }
const FOOD = '#c9b27c'
const TRAIL = new Color('#d2c096')
const GREEN = new Color('#6f9a5e')
const ALGAE = new Color('#4f8f78')
const N = PATCH.cells
const HALF = PATCH.size / 2

/** Land as a heightfield, with its colour (height, water, trail) held in a small texture that is redrawn as the trail changes. */
function Ground({ sim, showTrails, showHabitat }: { sim: Sim; showTrails: boolean; showHabitat: boolean }) {
  const { geometry, base, texture } = useMemo(() => {
    const w = sim.world
    const g = new BufferGeometry()
    const pos = new Float32Array((N + 1) * (N + 1) * 3)
    const uv = new Float32Array((N + 1) * (N + 1) * 2)
    for (let j = 0; j <= N; j += 1) {
      for (let i = 0; i <= N; i += 1) {
        const k = j * (N + 1) + i
        pos.set([-HALF + i * PATCH.cell, Math.max(w.heights[k]!, w.waterLevel - 0.6), -HALF + j * PATCH.cell], k * 3)
        uv.set([i / N, j / N], k * 2)
      }
    }
    const index: number[] = []
    for (let j = 0; j < N; j += 1) {
      for (let i = 0; i < N; i += 1) {
        const a = j * (N + 1) + i
        const b = a + N + 1
        index.push(a, b, a + 1, b, b + 1, a + 1)
      }
    }
    g.setAttribute('position', new BufferAttribute(pos, 3))
    g.setAttribute('uv', new BufferAttribute(uv, 2))
    g.setIndex(index)
    g.computeVertexNormals()
    // Base colours: low ground dark, high ground paler; water and rock read as obstacles.
    const base = new Float32Array(N * N * 3)
    const low = new Color('#2a2c27')
    const high = new Color('#6e6d5e')
    const water = new Color('#27333c')
    const rock = new Color('#4b4a45')
    const c = new Color()
    for (let j = 0; j < N; j += 1) {
      for (let i = 0; i < N; i += 1) {
        const k = j * N + i
        const h = (w.heights[j * (N + 1) + i]! + w.heights[j * (N + 1) + i + 1]! + w.heights[(j + 1) * (N + 1) + i]! + w.heights[(j + 1) * (N + 1) + i + 1]!) / 4
        c.copy(low).lerp(high, Math.min(1, Math.max(0, (h - w.waterLevel) / 5)))
        if (w.blocked[k] === 1) c.copy(water)
        if (w.blocked[k] === 2) c.copy(rock)
        base.set([c.r, c.g, c.b], k * 3)
      }
    }
    const data = new Uint8Array(N * N * 4)
    const texture = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType)
    texture.colorSpace = SRGBColorSpace
    texture.magFilter = LinearFilter
    texture.minFilter = LinearFilter
    return { geometry: g, base, texture }
  }, [sim])

  const clock = useRef(0)
  const paint = () => {
    const data = texture.image.data as Uint8Array
    const trail = sim.trail
    const w = sim.world
    for (let k = 0; k < N * N; k += 1) {
      let r = base[k * 3]!
      let g = base[k * 3 + 1]!
      let b = base[k * 3 + 2]!
      if (showHabitat) {
        // Habitat quality: nutrient greens the ground, algae greens the water.
        const wet = w.blocked[k] === 1
        const q = wet ? Math.min(1, Math.max(0, (sim.algae[k]! - 0.3) * 1.6)) : 1 - Math.exp(-sim.nutrient[k]! * 1.4)
        const tint = wet ? ALGAE : GREEN
        r += (tint.r - r) * q * 0.7
        g += (tint.g - g) * q * 0.7
        b += (tint.b - b) * q * 0.7
      }
      const a = showTrails ? (1 - Math.exp(-trail[k]! * 0.45)) * 0.75 : 0
      data[k * 4] = Math.round((r + (TRAIL.r - r) * a) * 255)
      data[k * 4 + 1] = Math.round((g + (TRAIL.g - g) * a) * 255)
      data[k * 4 + 2] = Math.round((b + (TRAIL.b - b) * a) * 255)
      data[k * 4 + 3] = 255
    }
    texture.needsUpdate = true
  }
  useLayoutEffect(paint, [texture, showTrails, showHabitat]) // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, delta) => {
    clock.current += delta
    if (clock.current > 0.1) {
      clock.current = 0
      paint()
    }
  })
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial map={texture} roughness={1} metalness={0} />
    </mesh>
  )
}

/** Water, food, shelter slabs and rocks: the things agents sense. */
function Landmarks({ sim }: { sim: Sim }) {
  const w = sim.world
  const sites = useRef<(Mesh | null)[]>([])
  useFrame(() => {
    w.sites.forEach((s, i) => {
      const m = sites.current[i]
      if (!m) return
      const f = 0.25 + 0.75 * Math.max(0, s.amount) / SITE_MAX
      m.scale.set(f, f, f)
      m.position.y = w.heightAt(s.x, s.z) + 0.9 * f
    })
  })
  const rocks = useMemo(() => {
    const out: [number, number][] = []
    for (let j = 0; j < N; j += 1) for (let i = 0; i < N; i += 1) if (w.blocked[j * N + i] === 2) out.push([-HALF + (i + 0.5) * PATCH.cell, -HALF + (j + 0.5) * PATCH.cell])
    return out
  }, [w])
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, w.waterLevel, 0]}>
        <planeGeometry args={[PATCH.size, PATCH.size]} />
        <meshStandardMaterial color="#3a4c59" transparent opacity={0.55} roughness={0.4} />
      </mesh>
      {w.sites.map((s, i) => (
        <mesh key={i} ref={(m) => { sites.current[i] = m }} position={[s.x, w.heightAt(s.x, s.z) + 0.9, s.z]}>
          <icosahedronGeometry args={[1.1, 1]} />
          <meshStandardMaterial color={FOOD} emissive={FOOD} emissiveIntensity={0.25} roughness={0.7} />
        </mesh>
      ))}
      {w.shelters.map((s, i) => {
        const y = w.heightAt(s.x, s.z) + 3.6
        return (
          <group key={i} position={[s.x, y, s.z]}>
            <mesh>
              <boxGeometry args={[s.w, 0.7, s.d]} />
              <meshStandardMaterial color="#7a8290" roughness={0.9} transparent opacity={0.6} />
            </mesh>
            {([-1, 1] as const).map((sx) => (
              <mesh key={sx} position={[sx * (s.w / 2 - 1), -1.9, 0]}>
                <boxGeometry args={[1, 3.8, 1]} />
                <meshStandardMaterial color="#6a717d" roughness={0.9} />
              </mesh>
            ))}
          </group>
        )
      })}
      {rocks.map(([x, z], i) => (
        <mesh key={i} position={[x, w.heightAt(x, z) + 0.5, z]}>
          <dodecahedronGeometry args={[1.0, 0]} />
          <meshStandardMaterial color="#66645d" roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  )
}

/**
 * The agents, one instanced mesh per species so each reads at a glance: cones walk on the ground, flat kites fly above it with a
 * shadow on the ground below, and slim fish swim just under the water. All are coloured by state.
 */
function Agents({ sim, paramsRef, selected, showPerception, onSelect }: { sim: Sim; paramsRef: { current: Params }; selected: number; showPerception: boolean; onSelect: (i: number) => void }) {
  const meshes = [useRef<InstancedMesh>(null), useRef<InstancedMesh>(null), useRef<InstancedMesh>(null)]
  const shadows = useRef<InstancedMesh>(null)
  const ring = useRef<Mesh>(null)
  const mark = useRef<Mesh>(null)
  const dummy = useMemo(() => new Object3D(), [])
  const colors = useMemo(() => STATES.map((s) => new Color(STATE_COLOR[s])), [])
  const geometries = useMemo(() => {
    const ground = new ConeGeometry(0.55, 1.7, 10)
    ground.rotateX(Math.PI / 2)
    const air = new ConeGeometry(0.9, 2.0, 3)
    air.rotateX(Math.PI / 2)
    air.scale(1.5, 0.3, 1)
    const water = new SphereGeometry(0.5, 10, 8)
    water.scale(0.55, 0.45, 1.6)
    const shadow = new CircleGeometry(0.9, 12)
    shadow.rotateX(-Math.PI / 2)
    return { ground, air, water, shadow }
  }, [])
  useLayoutEffect(() => {
    for (const m of [...meshes.map((r) => r.current), shadows.current]) if (m) m.boundingSphere = new Sphere(new Vector3(0, 0, 0), PATCH.size)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(() => {
    const w = sim.world
    const used = [0, 0, 0]
    for (let i = 0; i < sim.count; i += 1) {
      const sp = sim.species[i]!
      const m = meshes[sp]!.current
      if (!m) continue
      const x = sim.x[i]!
      const z = sim.z[i]!
      dummy.position.set(x, sim.yOf(i), z)
      dummy.rotation.set(0, sim.heading[i]!, 0)
      dummy.updateMatrix()
      const n = used[sp]!
      m.setMatrixAt(n, dummy.matrix)
      m.setColorAt(n, colors[sim.state[i]!]!)
      if (sp === 1 && shadows.current) {
        dummy.position.set(x, sim.surfaceAt(i) + 0.08, z)
        dummy.rotation.set(0, sim.heading[i]!, 0)
        dummy.updateMatrix()
        shadows.current.setMatrixAt(n, dummy.matrix)
      }
      used[sp] = n + 1
    }
    for (let sp = 0; sp < 3; sp += 1) {
      const m = meshes[sp]!.current
      if (!m) continue
      m.count = used[sp]!
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    if (shadows.current) {
      shadows.current.count = used[1]!
      shadows.current.instanceMatrix.needsUpdate = true
    }
    if (selected < sim.count) {
      const sp = SPECIES[sim.species[selected]!]!
      const x = sim.x[selected]!
      const z = sim.z[selected]!
      const y = sim.yOf(selected) - 0.2
      if (ring.current) {
        ring.current.position.set(x, y, z)
        ring.current.scale.setScalar(senseRadius(sp, paramsRef.current.perception))
        ring.current.visible = showPerception
      }
      if (mark.current) mark.current.position.set(x, y, z)
    }
    void w
  })
  const offsets = [0, sim.counts[0], sim.counts[0] + sim.counts[1]]
  const pick = (sp: number) => (e: { stopPropagation: () => void; instanceId?: number }) => {
    e.stopPropagation()
    if (e.instanceId !== undefined) onSelect(offsets[sp]! + e.instanceId)
  }
  return (
    <group>
      {(['ground', 'air', 'water'] as const).map((name, sp) => (
        <instancedMesh key={name} ref={meshes[sp]} args={[geometries[name], undefined, MAX_AGENTS]} frustumCulled={false} onClick={pick(sp)}>
          <meshStandardMaterial roughness={0.8} metalness={0} />
        </instancedMesh>
      ))}
      <instancedMesh ref={shadows} args={[geometries.shadow, undefined, MAX_AGENTS]} frustumCulled={false} raycast={() => null}>
        <meshBasicMaterial color="#000000" transparent opacity={0.45} depthWrite={false} />
      </instancedMesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.97, 1, 72]} />
        <meshBasicMaterial color="#e8e4d8" transparent opacity={0.55} depthTest={false} />
      </mesh>
      <mesh ref={mark} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.0, 1.3, 24]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} depthTest={false} />
      </mesh>
    </group>
  )
}

/** Advances the simulation in fixed steps and reports its metrics a few times a second. */
function Runner({ sim, paramsRef, speed, paused, onStats }: { sim: Sim; paramsRef: { current: Params }; speed: number; paused: boolean; onStats: (m: Metrics) => void }) {
  const acc = useRef(0)
  const last = useRef(0)
  useEffect(() => {
    onStats(sim.metrics())
  }, [sim, onStats])
  useFrame((_, delta) => {
    if (!paused) {
      acc.current += Math.min(delta, 0.1) * speed
      let n = 0
      while (acc.current >= DT && n < 40) {
        sim.step(paramsRef.current)
        acc.current -= DT
        n += 1
      }
      if (n === 40) acc.current = 0
    }
    last.current += delta
    if (last.current > 0.25) {
      last.current = 0
      onStats(sim.metrics())
    }
  })
  return null
}

export function AgentsScene({
  sim,
  paramsRef,
  speed,
  paused,
  showTrails,
  showHabitat,
  showPerception,
  autoRotate,
  selected,
  onSelect,
  onStats,
}: {
  sim: Sim
  paramsRef: { current: Params }
  speed: number
  paused: boolean
  showTrails: boolean
  showHabitat: boolean
  showPerception: boolean
  autoRotate: boolean
  selected: number
  onSelect: (i: number) => void
  onStats: (m: Metrics) => void
}) {
  return (
    <>
      <color attach="background" args={['#000000']} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#c9cfdc', '#1a1917', 0.6]} />
      <directionalLight position={[50, 90, 40]} intensity={2.0} color="#fff8ec" />
      <Ground sim={sim} showTrails={showTrails} showHabitat={showHabitat} />
      <Landmarks sim={sim} />
      <Agents sim={sim} paramsRef={paramsRef} selected={selected} showPerception={showPerception} onSelect={onSelect} />
      <Runner sim={sim} paramsRef={paramsRef} speed={speed} paused={paused} onStats={onStats} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={15} maxDistance={260} maxPolarAngle={Math.PI * 0.47} target={[0, 0, 0]} autoRotate={autoRotate} autoRotateSpeed={AUTO_ROTATE_SPEED} />
    </>
  )
}
