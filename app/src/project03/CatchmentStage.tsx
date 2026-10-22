import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { Vector3 } from 'three'
import type { Runtime } from '../project02/runtime.ts'
import { EYE_HEIGHT, explorePose, overviewPose } from './catchment.ts'
import { growOrganism } from './organism.ts'

export type CatchmentMode = 'overview' | 'explore'

type Orbit = { enabled: boolean; target: Vector3; update: () => void }

/**
 * 0.2 still owns the world step. Growth of its scattered sites stays off
 * for that step; the shore organism grows on the same hours afterwards.
 */
export function OrganismDriver({ runtime }: { runtime: Runtime }) {
  useFrame(() => {
    runtime.settings.growing = false
  }, -3)
  useFrame((_, delta) => {
    if (!runtime.playing || runtime.jumping || runtime.hoursPerSecond <= 0) return
    growOrganism(runtime.eco, runtime.statics, Math.min(delta, 0.1) * runtime.hoursPerSecond, runtime.settings.growthSpeed)
  }, -1)
  return null
}

function surfaceY(runtime: Runtime, x: number, z: number): number | null {
  const { statics, eco } = runtime
  const cell = statics.cellAt(x, z)
  if (cell < 0 || !statics.inside[cell]) return null
  const ground = statics.groundAt(x, z)
  if (statics.water[cell]) return Math.max(ground, statics.waterLevel[cell]! + eco.fields.waterOffset) + EYE_HEIGHT
  return ground + EYE_HEIGHT
}

/** Overview orbits the catchment. Explore walks it at eye height. */
export function CatchmentRig({ runtime, mode }: { runtime: Runtime; mode: CatchmentMode }) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const controls = useThree((state) => state.controls) as unknown as Orbit | null
  const modeRef = useRef(mode)
  modeRef.current = mode
  const snap = useRef(4)
  const explore = useRef(explorePose(runtime.statics))
  const keys = useRef({ forward: 0, strafe: 0 })
  const dragging = useRef(false)

  useLayoutEffect(() => {
    if (mode === 'overview') snap.current = 4
    else explore.current = explorePose(runtime.statics)
  }, [mode, runtime])

  useEffect(() => {
    if (mode !== 'explore') return
    const held = new Set<string>()
    const drive: Record<string, 'forward' | 'strafe'> = {
      w: 'forward',
      arrowup: 'forward',
      s: 'forward',
      arrowdown: 'forward',
      a: 'strafe',
      arrowleft: 'strafe',
      d: 'strafe',
      arrowright: 'strafe',
    }
    const negative = new Set(['s', 'arrowdown', 'a', 'arrowleft'])
    const emit = () => {
      let forward = 0
      let strafe = 0
      for (const key of held) {
        const axis = drive[key]
        const sign = negative.has(key) ? -1 : 1
        if (axis === 'forward') forward += sign
        if (axis === 'strafe') strafe += sign
      }
      keys.current.forward = Math.max(-1, Math.min(1, forward))
      keys.current.strafe = Math.max(-1, Math.min(1, strafe))
    }
    const editable = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (!(key in drive) || event.metaKey || event.ctrlKey || event.altKey || editable(event.target)) return
      event.preventDefault()
      held.add(key)
      emit()
    }
    const up = (event: KeyboardEvent) => {
      if (held.delete(event.key.toLowerCase())) emit()
    }
    const clear = () => {
      held.clear()
      emit()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
      keys.current.forward = 0
      keys.current.strafe = 0
    }
  }, [mode])

  useEffect(() => {
    if (mode !== 'explore') return
    const element = gl.domElement
    let lastX = 0
    let lastY = 0
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      dragging.current = true
      lastX = event.clientX
      lastY = event.clientY
    }
    const move = (event: PointerEvent) => {
      if (!dragging.current) return
      explore.current.yaw -= (event.clientX - lastX) * 0.005
      explore.current.pitch = Math.max(-0.5, Math.min(0.42, explore.current.pitch - (event.clientY - lastY) * 0.004))
      lastX = event.clientX
      lastY = event.clientY
    }
    const up = () => {
      dragging.current = false
    }
    element.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      element.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      dragging.current = false
    }
  }, [gl, mode])

  // Default priority (0), after the orbit controls. A positive priority tells
  // the renderer this callback draws the frame itself, and the canvas stays empty.
  useFrame((_, delta) => {
    const orbit = controls
    if (modeRef.current === 'overview') {
      if (!orbit) return
      orbit.enabled = true
      if (snap.current > 0) {
        const pose = overviewPose(runtime.statics)
        camera.position.set(pose.position[0], pose.position[1], pose.position[2])
        orbit.target.set(pose.target[0], pose.target[1], pose.target[2])
        orbit.update()
        snap.current -= 1
      }
      return
    }
    if (orbit) orbit.enabled = false
    const pose = explore.current
    const fx = -Math.sin(pose.yaw)
    const fz = -Math.cos(pose.yaw)
    const rx = Math.cos(pose.yaw)
    const rz = -Math.sin(pose.yaw)
    const speed = 2.4 * Math.min(delta, 0.05)
    const nx = pose.x + (fx * keys.current.forward + rx * keys.current.strafe) * speed
    const nz = pose.z + (fz * keys.current.forward + rz * keys.current.strafe) * speed
    const y = surfaceY(runtime, nx, nz)
    if (y !== null) {
      pose.x = nx
      pose.z = nz
    }
    const eye = surfaceY(runtime, pose.x, pose.z) ?? camera.position.y
    const look = Math.cos(pose.pitch)
    camera.position.set(pose.x, eye, pose.z)
    camera.up.set(0, 1, 0)
    camera.lookAt(pose.x + fx * look, eye + Math.sin(pose.pitch), pose.z + fz * look)
  })

  return null
}
