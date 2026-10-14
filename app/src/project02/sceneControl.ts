import { useEffect } from 'react'
import { Color, FogExp2, Vector3, type Camera, type PerspectiveCamera, type Scene, type WebGLRenderer, type WebGLRenderTarget } from 'three'
import { sunAt } from '../project/sun.ts'
import { lerp, smoothstep } from './core.ts'
import type { DriveInput } from './creatures.ts'
import { easeCamera, embodiedPose, focusTarget, type Runtime } from './runtime.ts'

/**
 * Shadow Ecology 0.2 — the parts of the scene that answer to time and
 * weather (sky, sun, fog), and the camera rig that carries the viewer into
 * an entity's perspective and back out.
 */
export const LIGHTING = {
  sunIntensity: 3,
  sunDay: '#fff8ec',
  sunLow: '#ffb27a',
  sunDistance: 60,
  ambient: 0.2,
  skyDay: 0.12,
  skyNight: 0.55,
  sky: '#c9cfdc',
  ground: '#1a1917',
  fog: '#11141a',
  background: '#050608',
} as const

export type Sky = {
  sun: [number, number, number]
  sunIntensity: number
  sunColor: Color
  sky: number
  background: Color
  fogDensity: number
  fogColor: Color
  daylight: number
}

const background = new Color(LIGHTING.background)
const fogBase = new Color(LIGHTING.fog)
/** Daylit fog: a muted cool gray the distance dissolves into. */
const fogDay = new Color('#6f757c')
/**
 * FogExp2 density at fog density 0 and 1. Quadratic in distance, so the
 * near island (~12 units from the default camera) stays clear while the far
 * side (~28) fades: about 8% / 37% at the default density, 40% / 95% at full.
 */
const FOG_RANGE = [0.012, 0.062] as const

/** Sun, sky fill and atmosphere for the current hour and weather. */
export function skyAt(rt: Runtime): Sky {
  const { eco } = rt
  const sun = sunAt(rt.viewHour, eco.noon)
  const { rain, fog, drought } = eco.weather
  const thickness = eco.weather.fogDensity ?? 0.25
  const overcast = Math.min(1, fog * (0.3 + 0.4 * thickness) + rain * 0.7)
  const low = 1 - smoothstep(2, 16, sun.elevation)
  const sunColor = new Color(LIGHTING.sunDay).lerp(new Color(LIGHTING.sunLow), low * 0.85)
  if (drought > 0) sunColor.lerp(new Color('#ffe6c2'), drought * 0.3)
  const night = 1 - sun.daylight
  // Depth fog: distance dissolves into the fog colour; the sky behind only darkens toward it a little.
  const haze = Math.min(1, fog + rain * 0.25)
  const fogColor = fogBase.clone().multiplyScalar(0.5 + 0.5 * sun.daylight).lerp(fogDay.clone().multiplyScalar(0.25 + 0.75 * sun.daylight), haze)
  const fogDensity = FOG_RANGE[0] * (0.2 + 0.8 * fog) + fog * thickness * (FOG_RANGE[1] - FOG_RANGE[0]) + 0.006 * rain
  return {
    sun: sun.direction,
    sunIntensity: LIGHTING.sunIntensity * sun.daylight * (1 - 0.45 * overcast) * (1 + drought * 0.12),
    sunColor,
    sky: lerp(LIGHTING.skyDay, LIGHTING.skyNight, night) + overcast * 0.35 * sun.daylight,
    background: background.clone().lerp(fogColor, haze * (0.12 + 0.25 * thickness)),
    fogDensity,
    fogColor,
    daylight: sun.daylight,
  }
}

/** Applies the background and fog to the scene (created on first use). */
export function applySky(scene: Scene, sky: Sky) {
  if (!(scene.background instanceof Color)) scene.background = new Color()
  ;(scene.background as Color).copy(sky.background)
  if (!(scene.fog instanceof FogExp2)) scene.fog = new FogExp2(LIGHTING.fog, 0)
  const fog = scene.fog as FogExp2
  fog.color.copy(sky.fogColor)
  fog.density = sky.fogDensity
}

export function clearSky(scene: Scene) {
  scene.fog = null
}

type Controls = { target: Vector3; enabled: boolean; update: () => void }

export type Rig = {
  mode: 'orbit' | 'embodied' | 'returning'
  savedPosition: Vector3
  savedTarget: Vector3
  look: Vector3
  timer: number
}

export const createRig = (): Rig => ({
  mode: 'orbit',
  savedPosition: new Vector3(),
  savedTarget: new Vector3(),
  look: new Vector3(),
  timer: 0,
})

/**
 * Embodied perspective: eases the camera to the focused entity and follows
 * it; on release, eases back to where the orbit left off.
 */
export function stepRig(rig: Rig, rt: Runtime, camera: Camera, controls: Controls | null, embodied: boolean, seconds: number) {
  const target = embodied ? focusTarget(rt) : null
  if (target) {
    if (rig.mode === 'orbit') {
      rig.savedPosition.copy(camera.position)
      rig.savedTarget.copy(controls?.target ?? new Vector3(0, -0.5, -0.7))
      rig.look.copy(rig.savedTarget)
    }
    rig.mode = 'embodied'
    if (controls) controls.enabled = false
    easeCamera(camera, rig.look, embodiedPose(rt, target), seconds)
    return
  }
  if (rig.mode === 'embodied') {
    rig.mode = 'returning'
    rig.timer = 0
  }
  if (rig.mode === 'returning') {
    rig.timer += seconds
    const p = rig.savedPosition
    const t = rig.savedTarget
    easeCamera(camera, rig.look, { position: [p.x, p.y, p.z], look: [t.x, t.y, t.z] }, seconds * 1.4)
    if (rig.timer > 1.6 || camera.position.distanceTo(p) < 0.02) {
      rig.mode = 'orbit'
      camera.position.copy(p)
      if (controls) {
        controls.target.copy(t)
        controls.enabled = true
        controls.update()
      }
    }
  }
}

/**
 * Aims the lens camera at the patch of the main view around the cursor
 * (screen px), magnified `zoom` times into a `size` px square: the same
 * viewpoint, a narrower window, so the lens reads as a magnifier.
 */
export function aimLensCamera(lens: PerspectiveCamera, main: PerspectiveCamera, cursor: { x: number; y: number }, view: { width: number; height: number }, zoom: number, size: number) {
  lens.position.copy(main.position)
  lens.quaternion.copy(main.quaternion)
  lens.fov = main.fov
  lens.near = main.near
  lens.far = main.far
  lens.aspect = view.width / view.height
  lens.setViewOffset(view.width * zoom, view.height * zoom, cursor.x * zoom - size / 2, cursor.y * zoom - size / 2, size, size)
  lens.updateMatrixWorld()
}

/** World radius covered by the lens at `distance` from the camera. */
export function lensWorldRadius(main: PerspectiveCamera, distance: number, viewHeight: number, zoom: number, size: number) {
  const perPixel = (2 * distance * Math.tan(((main.fov / 2) * Math.PI) / 180)) / viewHeight
  return (perPixel * size) / (2 * zoom)
}

/** Renders the scene into the lens target without re-rendering shadow maps. */
export function renderLens(gl: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, target: WebGLRenderTarget) {
  const auto = gl.shadowMap.autoUpdate
  gl.shadowMap.autoUpdate = false
  gl.setRenderTarget(target)
  gl.clear()
  gl.render(scene, camera)
  gl.setRenderTarget(null)
  gl.shadowMap.autoUpdate = auto
}

const DRIVE_KEYS: Record<string, keyof DriveInput | null> = {
  w: 'forward',
  arrowup: 'forward',
  s: 'forward',
  arrowdown: 'forward',
  a: 'turn',
  arrowleft: 'turn',
  d: 'turn',
  arrowright: 'turn',
  e: 'lift',
  q: 'lift',
}

const NEGATIVE = new Set(['s', 'arrowdown', 'a', 'arrowleft', 'q'])

/** Held keys as a drive input while `active` (WASD / arrows, Q E for height). */
export function useDriveKeys(active: boolean, onChange: (input: DriveInput) => void) {
  useEffect(() => {
    if (!active) return
    const held = new Set<string>()
    const emit = () => {
      const input: DriveInput = { forward: 0, turn: 0, lift: 0 }
      for (const key of held) {
        const axis = DRIVE_KEYS[key]
        if (axis) input[axis] += NEGATIVE.has(key) ? -1 : 1
      }
      input.forward = Math.max(-1, Math.min(1, input.forward))
      input.turn = Math.max(-1, Math.min(1, input.turn))
      input.lift = Math.max(-1, Math.min(1, input.lift))
      onChange(input)
    }
    const editable = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (!(key in DRIVE_KEYS) || event.metaKey || event.ctrlKey || event.altKey || editable(event.target)) return
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
      onChange({ forward: 0, turn: 0, lift: 0 })
    }
  }, [active, onChange])
}
