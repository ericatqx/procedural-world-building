import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BoxGeometry, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import { buildProxy, PROXY_GRID, WORLD_TEXT, type WorldId } from './parallel.ts'
import type { Runtime } from './runtime.ts'
import type { Statics } from './statics.ts'
import type { ParallelView, ParallelWorld, Quality } from './view.ts'

/**
 * Parallel worlds in the scene: the camera pulls back from the live world and
 * the alternates surface around it as small low-detail proxies, half size,
 * set behind and beside the island as seen from where the viewer stood.
 */
const RING = 34
const PROXY_SCALE = 0.5
const OVERVIEW = { distance: 108, elevation: 0.92 } as const
/** Angles (local, the viewer toward +z) of the alternates: beside and behind the live world. */
const SLOTS = [0.5, 0.84, 1.16, 1.5].map((t) => t * Math.PI)
const PULL_SECONDS = 1.8
/** Label height above a world (local, unscaled). */
const LABEL_Y = 9

const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
const ground = { dim: material(0.74), lit: material(1) }
const stone = new MeshStandardMaterial({ color: '#b2a792', roughness: 0.9, metalness: 0, fog: false })

function material(shade: number) {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, fog: false })
  m.color.setScalar(shade)
  return m
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

type Controls = { target: Vector3; enabled: boolean; update: () => void }

function ProxyWorld({
  world,
  statics,
  slot,
  quality,
  selected,
  labelled,
  presence,
  onSelect,
}: {
  world: ParallelWorld
  statics: Statics
  slot: number
  quality: Quality
  selected: boolean
  labelled: boolean
  presence: { current: number }
  onSelect: (id: WorldId) => void
}) {
  const group = useRef<Group>(null)
  const grow = useRef(0)
  const proxy = useMemo(() => buildProxy(world.eco, statics, PROXY_GRID[quality]), [world.eco, statics, quality])
  const columns = useMemo(() => {
    const count = proxy.columns.length / 4
    const mesh = new InstancedMesh(box, stone, Math.max(1, count))
    const m = new Matrix4()
    const q = new Quaternion()
    const p = new Vector3()
    const s = new Vector3()
    for (let k = 0; k < count; k += 1) {
      const o = k * 4
      p.set(proxy.columns[o]!, proxy.columns[o + 2]!, proxy.columns[o + 1]!)
      s.set(proxy.width, proxy.columns[o + 3]!, proxy.width)
      mesh.setMatrixAt(k, m.compose(p, q, s))
    }
    mesh.count = count
    return mesh
  }, [proxy])
  useEffect(
    () => () => {
      proxy.terrain.dispose()
      columns.dispose()
    },
    [proxy, columns],
  )
  useFrame((_, delta) => {
    grow.current = Math.min(1, grow.current + delta / 1.2)
    const s = PROXY_SCALE * ease(grow.current) * ease(presence.current) * (selected ? 1.06 : 1)
    group.current?.scale.setScalar(Math.max(1e-4, s))
  })
  const angle = SLOTS[slot] ?? 0
  return (
    <group ref={group} position={[Math.sin(angle) * RING, 0, Math.cos(angle) * RING]}>
      <mesh
        geometry={proxy.terrain}
        material={selected ? ground.lit : ground.dim}
        onClick={(event) => {
          event.stopPropagation()
          onSelect(world.id)
        }}
      />
      <primitive object={columns} />
      {labelled ? <WorldLabel id={world.id} selected={selected} onSelect={onSelect} /> : null}
    </group>
  )
}

function WorldLabel({ id, selected, onSelect }: { id: WorldId; selected: boolean; onSelect: (id: WorldId) => void }) {
  return (
    <Html position={[0, LABEL_Y, 0]} center zIndexRange={[5, 0]}>
      <button type="button" className="eco-world-label" data-active={selected ? '' : undefined} onClick={() => onSelect(id)}>
        {WORLD_TEXT[id].label}
        {id === 'this' ? <span> · live</span> : null}
      </button>
    </Html>
  )
}

/** Pulls the camera out to the field of worlds and back; draws the proxies while the field is open. */
export function ParallelWorlds({ runtime, parallel, quality }: { runtime: Runtime; parallel: ParallelView; quality: Quality }) {
  const get = useThree((state) => state.get)
  const field = useRef<Group>(null)
  const presence = useRef(0)
  const rig = useRef({
    mode: 'idle' as 'idle' | 'out' | 'field' | 'back',
    t: 0,
    from: new Vector3(),
    fromTarget: new Vector3(),
    to: new Vector3(),
    toTarget: new Vector3(),
    saved: new Vector3(),
    savedTarget: new Vector3(),
  })

  useEffect(() => {
    const r = rig.current
    const { camera, controls } = get()
    const target = (controls as unknown as Controls | null)?.target ?? new Vector3()
    if (parallel.open) {
      if (r.mode === 'idle' || r.mode === 'back') {
        if (r.mode === 'idle') {
          r.saved.copy(camera.position)
          r.savedTarget.copy(target)
        }
        const azimuth = Math.atan2(r.saved.x - r.savedTarget.x, r.saved.z - r.savedTarget.z)
        if (field.current) field.current.rotation.y = azimuth
        const { distance, elevation } = OVERVIEW
        r.to.set(Math.sin(azimuth) * Math.cos(elevation) * distance, Math.sin(elevation) * distance, Math.cos(azimuth) * Math.cos(elevation) * distance)
        r.toTarget.set(0, 0, 0)
        r.from.copy(camera.position)
        r.fromTarget.copy(target)
        r.mode = 'out'
        r.t = 0
      }
    } else if (r.mode !== 'idle') {
      r.from.copy(camera.position)
      r.fromTarget.copy(target)
      r.to.copy(r.saved)
      r.toTarget.copy(r.savedTarget)
      r.mode = 'back'
      r.t = 0
    }
  }, [get, parallel.open])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    const r = rig.current
    const controls = state.controls as unknown as Controls | null
    presence.current += ((parallel.open ? 1 : 0) - presence.current) * (1 - Math.exp(-dt * 3))
    if (field.current) field.current.visible = presence.current > 0.01
    if (r.mode !== 'out' && r.mode !== 'back') return
    r.t = Math.min(1, r.t + dt / PULL_SECONDS)
    const s = ease(r.t)
    state.camera.position.lerpVectors(r.from, r.to, s)
    if (controls) {
      controls.enabled = false
      controls.target.lerpVectors(r.fromTarget, r.toTarget, s)
      state.camera.lookAt(controls.target)
    }
    if (r.t < 1) return
    r.mode = r.mode === 'out' ? 'field' : 'idle'
    if (controls) {
      controls.enabled = true
      controls.update()
    }
  })

  const { selected, select } = parallel
  return (
    <group ref={field} visible={false}>
      {parallel.open ? <WorldLabel id="this" selected={selected === 'this'} onSelect={select} /> : null}
      {parallel.worlds.map((world, k) => (
        <ProxyWorld
          key={world.id}
          world={world}
          statics={runtime.statics}
          slot={k}
          quality={quality}
          selected={selected === world.id}
          labelled={parallel.open}
          presence={presence}
          onSelect={select}
        />
      ))}
    </group>
  )
}
