import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  DynamicDrawUsage,
  FloatType,
  Fog,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  NearestFilter,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Points,
  RedFormat,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import { smoothstep } from '../project02/core.ts'
import { environment, stepEnvironment, windBaseAt } from './environment.ts'
import { livingArchitecture } from './livingArchitecture.ts'
import { islandRadius, landscapeHeight } from './terrain.ts'
import type { WaterSystem } from './water.ts'
import type { TerrainReadout } from './LandscapeView.tsx'

// The field stays the near-black void of 0.1 and 0.2 all day; weather only lifts it a little.
const VOID = new Color('#050608')
const DAYLIT = new Color('#0a0c0f')
const MISTY = new Color('#171a1e')
// The haze: a soft neutral grey that mist and rain draw the distant land into (the void behind stays black); it dims with the day.
const HAZE = new Color('#454b52')
const scratch = new Color()

/**
 * The sun, its shadows, the sky's light and the haze, all from the shared environment. The light is
 * the neutral white of 0.2 at every hour (no sunrise tint): the sun only moves and dims. A
 * directional key light casts the terrain's shadows over the area around the camera's focus.
 *
 * The shadow map is only redrawn when something it shows has changed (the sun, the focus, the
 * view's width, the toggle, or terrain still streaming in, at most a few times a second), not
 * every frame: the terrain is a few hundred thousand triangles, and a redraw doubles the cost of a frame.
 */
export function Sky({ place, readout }: { place: MutableRefObject<Vector3>; readout: TerrainReadout }) {
  const scene = useThree((state) => state.scene)
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const key = useRef<DirectionalLight>(null)
  const moon = useRef<DirectionalLight>(null)
  const fill = useRef<DirectionalLight>(null)
  const sky = useRef<HemisphereLight>(null)
  const extent = useRef(0)
  const drawn = useRef({ signature: '', at: 0 })
  const color = useMemo(() => new Color(), [])

  useLayoutEffect(() => {
    gl.shadowMap.enabled = true
    gl.shadowMap.type = PCFSoftShadowMap
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    const light = key.current
    if (!light) return
    scene.add(light.target)
    return () => {
      scene.remove(light.target)
      gl.shadowMap.enabled = false
      gl.shadowMap.autoUpdate = true
    }
  }, [gl, scene])

  useFrame((state, delta) => {
    stepEnvironment(delta)
    // Held on every frame: the Canvas configures the renderer's shadows itself and must not be the last word.
    if (!gl.shadowMap.enabled) {
      gl.shadowMap.enabled = true
      gl.shadowMap.needsUpdate = true
    }
    const { sun, cloud, mist, rain } = environment.state
    const { shadows } = environment.controls
    const light = key.current
    if (light) {
      const [dx, dy, dz] = sun.direction
      const focus = place.current
      // Shadows cover the ground around the focus, as wide as the view needs: fine up close, island-wide from afar.
      const reach = Math.min(2900, Math.max(220, camera.position.distanceTo(focus) * 1.5))
      // The focus is held to a coarse step, so the shadow camera sits still while the view drifts a little.
      const step = Math.max(8, reach * 0.04)
      const fx = Math.round(focus.x / step) * step
      const fz = Math.round(focus.z / step) * step
      light.target.position.set(fx, 0, fz)
      light.position.set(fx + dx * 3600, dy * 3600, fz + dz * 3600)
      light.target.updateMatrixWorld()
      light.color.set('#fff8ee')
      // High sun is the flattest light: take a little off its brightness, and below, a little of the fill, so slopes keep their form.
      light.intensity = Math.PI * 0.95 * sun.direct * (1 - 0.14 * smoothstep(30, 58, sun.elevation))
      light.castShadow = shadows && sun.direct > 0.02
      // Cloud turns the sun into sky light: the shadows fade and their edges widen, long before the sun is gone.
      light.shadow.intensity = Math.max(0, 0.95 * (1 - cloud * 0.95))
      light.shadow.radius = 1 + 7 * cloud
      const bucket = Math.round(Math.log2(reach) * 4)
      if (bucket !== extent.current) {
        extent.current = bucket
        const cam = light.shadow.camera
        const half = 2 ** (bucket / 4)
        cam.left = -half
        cam.right = half
        cam.top = half
        cam.bottom = -half
        cam.near = 100
        cam.far = 8000
        cam.updateProjectionMatrix()
      }
      // Redraw the shadow map only when what it shows has changed; while terrain is still streaming in, a few times a second.
      const signature = `${livingArchitecture.version}|${light.castShadow}|${Math.round(dx * 300)}|${Math.round(dy * 300)}|${Math.round(dz * 300)}|${fx}|${fz}|${bucket}`
      const now = state.clock.elapsedTime
      const streaming = readout.pending > 0 && now - drawn.current.at > 0.4
      if (light.castShadow && (signature !== drawn.current.signature || streaming)) {
        gl.shadowMap.needsUpdate = true
        drawn.current = { signature, at: now }
      }
    }
    if (moon.current) moon.current.intensity = Math.PI * 0.14 * (1 - sun.daylight) * (1 - 0.5 * cloud)
    // The fill and the sky keep the shaded faces readable, and a little more so under cloud, when the sun's contrast is gone.
    // The light the sun gives up is given back by the sky from every side, so overcast looks soft and even, not just dim.
    if (fill.current) fill.current.intensity = Math.PI * 0.36 * (0.1 + 0.9 * sun.daylight) * (1 + 0.9 * cloud) * (1 - 0.55 * smoothstep(28, 58, sun.elevation) * (1 - cloud))
    // 0.2's sky fill: a little by day, more by night (so the land keeps a faint readable form), and more again under cloud.
    if (sky.current) sky.current.intensity = 0.3 - 0.2 * sun.daylight + 0.35 * cloud * sun.daylight
    gl.toneMappingExposure = environment.state.exposure
    // The field is the void at every hour; weather lifts it by a shade, and the fog follows it, a little lighter in mist and rain.
    color.copy(VOID).lerp(DAYLIT, sun.daylight * 0.6).lerp(MISTY, mist * 0.35)
    if (scene.background instanceof Color) scene.background.copy(color)
    if (scene.fog instanceof Fog) scene.fog.color.copy(scratch.copy(color).lerp(HAZE, Math.min(1, mist + rain * 0.15) * (0.25 + 0.75 * sun.daylight)))
  })

  return (
    <>
      <directionalLight ref={key} castShadow shadow-mapSize={[4096, 4096]} shadow-bias={-0.0004} shadow-normalBias={2} />
      <directionalLight ref={moon} position={[-900, 1600, 1100]} color="#c6cede" />
      <directionalLight ref={fill} position={[2600, 1300, 1900]} color="#c4bdb2" />
      <hemisphereLight ref={sky} args={['#c2beb6', '#4a443b', 0.32]} />
    </>
  )
}

const DROPS = 26000
const EDGE = 48
/** The ground the rain falls onto: a height map of the island's surface (land, or the lake's water) in this many texels across the field. */
const GROUND = 128
const FIELD_SIZE = 4096

const RAIN_COMMON = /* glsl */ `
uniform sampler2D uGround;
uniform vec3 uBox;
uniform vec3 uCenter;
uniform vec2 uDrift;
uniform float uFallFrac;
uniform vec2 uSlant;
uniform float uFall;
uniform float uHeight;
uniform float uEdge[48];
// The surface under a point: bilinear from the height map.
float groundAt(vec2 xz) {
  vec2 g = clamp((xz + ${FIELD_SIZE / 2}.0) / ${FIELD_SIZE}.0, 0.0, 1.0) * float(${GROUND - 1});
  ivec2 i = ivec2(floor(g));
  ivec2 j = min(i + 1, ivec2(${GROUND - 1}));
  vec2 f = fract(g);
  float a = mix(texelFetch(uGround, ivec2(i.x, i.y), 0).r, texelFetch(uGround, ivec2(j.x, i.y), 0).r, f.x);
  float b = mix(texelFetch(uGround, ivec2(i.x, j.y), 0).r, texelFetch(uGround, ivec2(j.x, j.y), 0).r, f.x);
  return mix(a, b, f.y);
}
// Rain belongs to the island: full strength to the outline, by the island's own radius at that bearing, then gone over the void.
float islandFade(vec2 xz) {
  float t = (atan(xz.y, xz.x) / 6.2831853 + 0.5) * 48.0;
  int i0 = int(mod(floor(t), 48.0));
  int i1 = int(mod(floor(t) + 1.0, 48.0));
  float edge = mix(uEdge[i0], uEdge[i1], fract(t));
  return 1.0 - smoothstep(edge * 0.97, edge * 1.03, length(xz));
}
// Where a drop is: wrapped around the box's centre, so the rain never runs out near the viewer, and how far down it is (0 at the
// top of the rain, 1 on the ground). Height is measured from the ground under the drop, so rain falls onto the land, hugs it, and
// stops at it (or at a lake's surface) wherever the land is high or low.
vec2 dropColumn(vec3 seed, float shift) {
  return uCenter.xz + mod(seed.xz * uBox.xz + uDrift - uSlant * shift - uCenter.xz, uBox.xz) - uBox.xz * 0.5;
}
float dropFall(vec3 seed) {
  return fract(seed.y + uFallFrac);
}`

const RAIN_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aSeed;
attribute float aTail;
uniform float uStreak;
uniform float uPx;
varying float vFade;
varying float vTail;
${RAIN_COMMON}
void main() {
  vec2 xz = dropColumn(aSeed, 0.0);
  float f = dropFall(aSeed);
  float ground = groundAt(xz);
  vec3 head = vec3(xz.x, ground + uHeight * (1.0 - f), xz.y);
  // Each drop has its own character: how long its streak is and how visible, fixed by its seed.
  float h1 = fract(aSeed.x * 37.17 + aSeed.z * 17.31);
  float h2 = fract(aSeed.y * 91.73 + aSeed.x * 5.91);
  float dist = length((viewMatrix * vec4(head, 1.0)).xyz);
  // A streak is a few pixels long on the screen, whatever the distance: short and fine, never longer than the view allows.
  float L = max(0.25, min(uStreak * (0.45 + 1.1 * h1), (3.0 + 6.0 * h1) * dist / max(uPx, 1.0)));
  // The streak trails behind the drop, against its motion, and never goes below the ground.
  vec3 p = head - normalize(vec3(uSlant.x, -uFall, uSlant.y)) * L * aTail;
  p.y = max(p.y, ground + 0.02);
  vec2 local = xz - uCenter.xz;
  // Individually visible near the camera, gradually only a texture of rain farther off, and a faint one from Overview.
  float view = 1.0 - 0.55 * smoothstep(200.0, 3000.0, dist);
  vFade = (1.0 - smoothstep(0.38 * uBox.x, 0.5 * uBox.x, length(local))) * smoothstep(0.0, 0.08, f) * islandFade(xz) * view * (0.3 + 0.7 * h2);
  vTail = aTail;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  #include <logdepthbuf_vertex>
}`
const RAIN_FRAGMENT = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform float uAlpha;
uniform vec3 uColor;
varying float vFade;
varying float vTail;
void main() {
  #include <logdepthbuf_fragment>
  // Brightest at the head, thinning to almost nothing at the tail.
  gl_FragColor = vec4(uColor, uAlpha * vFade * mix(1.0, 0.2, vTail));
}`

/**
 * Where a drop lands, a moment after it lands: a small ring that spreads and fades on the ground (or on a lake) at the
 * foot of the drop's own column. Each drop has one, computed from the same seed and the same fall as its streak, so every
 * ring starts exactly where and when a streak ends. Seen only near the camera.
 */
const SPLASH_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aSeed;
uniform float uPx;
uniform float uSplashLife;
varying float vAge;
varying float vFade;
${RAIN_COMMON}
void main() {
  float f = dropFall(aSeed);
  // Seconds since this drop's column last reached the ground.
  float age = f * uHeight / uFall;
  vec2 xz = dropColumn(aSeed, age);
  vec3 at = vec3(xz.x, groundAt(xz) + 0.12, xz.y);
  vec4 view = viewMatrix * vec4(at, 1.0);
  float dist = length(view.xyz);
  float alive = 1.0 - step(uSplashLife, age);
  vAge = age / uSplashLife;
  vFade = alive * (1.0 - smoothstep(0.38 * uBox.x, 0.5 * uBox.x, length(xz - uCenter.xz))) * islandFade(xz) * (1.0 - smoothstep(120.0, 600.0, dist));
  gl_PointSize = clamp(1.4 * uPx / max(dist, 1.0), 2.0, 10.0);
  gl_Position = alive > 0.5 ? projectionMatrix * view : vec4(2.0, 2.0, 2.0, 1.0);
  #include <logdepthbuf_vertex>
}`
const SPLASH_FRAGMENT = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform float uAlpha;
uniform vec3 uColor;
varying float vAge;
varying float vFade;
void main() {
  #include <logdepthbuf_fragment>
  float d = length(gl_PointCoord - 0.5) * 2.0;
  // A ring that opens out as it fades.
  float radius = 0.2 + 0.7 * vAge;
  float ring = exp(-pow((d - radius) / 0.16, 2.0)) * (1.0 - vAge);
  gl_FragColor = vec4(uColor, uAlpha * vFade * ring);
}`

/**
 * The Canvas draws with a logarithmic depth buffer, so every custom shader that is depth-tested against the terrain must write
 * log depth too (the logdepthbuf chunks below); without them, rain's depth is the ordinary projective kind, which is far larger than
 * the terrain's log depth at the same spot, and rain is hidden wherever any terrain is behind it on screen.
 *
 * Rain falls from a layer above the ground, not from a box in the sky: a drop starts a set height over the terrain beneath
 * it and falls onto it, so the rain is always where the land is (never a wall hanging behind the island), reaches the
 * surface, and rings the ground and the lakes where it lands. One draw call of streaks and one of splashes.
 *
 * The rain's box and the height of the layer scale with the view: near the ground a few tens of meters thick and around
 * the camera; from afar a thin veil, over the island, that only reads as weather. Streaks keep to a modest length at every
 * distance, so Overview shows a surface under rain and not enormous lines.
 */
export function Rain({ place, water }: { place: MutableRefObject<Vector3>; water: WaterSystem }) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const lines = useRef<LineSegments>(null)
  const dots = useRef<Points>(null)
  const ground = useMemo(() => {
    const data = new Float32Array(GROUND * GROUND)
    const cell = FIELD_SIZE / (GROUND - 1)
    const probe = cell * 0.35
    const surface = (x: number, z: number) => water.surfaceAt(x, z) ?? landscapeHeight(x, z)
    for (let j = 0; j < GROUND; j += 1) {
      for (let i = 0; i < GROUND; i += 1) {
        const x = i * cell - FIELD_SIZE / 2
        const z = j * cell - FIELD_SIZE / 2
        // The lowest of a few nearby points, so the rain never stops in the air above a valley.
        data[j * GROUND + i] = Math.min(surface(x, z), surface(x + probe, z + probe), surface(x - probe, z + probe), surface(x + probe, z - probe), surface(x - probe, z - probe))
      }
    }
    const texture = new DataTexture(data, GROUND, GROUND, RedFormat, FloatType)
    texture.minFilter = NearestFilter
    texture.magFilter = NearestFilter
    texture.needsUpdate = true
    return texture
  }, [water])
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    const seeds = new Float32Array(DROPS * 2 * 3)
    const tails = new Float32Array(DROPS * 2)
    // A fixed pseudo-random pattern, so the same rain falls every time.
    let state = 12345
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) | 0
      return (state >>> 0) / 4294967296
    }
    for (let i = 0; i < DROPS; i += 1) {
      const x = next()
      const y = next()
      const z = next()
      for (let v = 0; v < 2; v += 1) {
        seeds.set([x, y, z], (i * 2 + v) * 3)
        tails[i * 2 + v] = v
      }
    }
    g.setAttribute('position', new BufferAttribute(new Float32Array(DROPS * 2 * 3), 3))
    g.setAttribute('aSeed', new BufferAttribute(seeds, 3))
    g.setAttribute('aTail', new BufferAttribute(tails, 1))
    return g
  }, [])
  const splashGeometry = useMemo(() => {
    const g = new BufferGeometry()
    const seeds = new Float32Array(DROPS * 3)
    // The same seeds as the streaks (the first vertex of each), so a ring belongs to its drop.
    const source = geometry.getAttribute('aSeed').array as Float32Array
    for (let i = 0; i < DROPS; i += 1) seeds.set(source.subarray(i * 6, i * 6 + 3), i * 3)
    g.setAttribute('position', new BufferAttribute(new Float32Array(DROPS * 3), 3))
    g.setAttribute('aSeed', new BufferAttribute(seeds, 3))
    return g
  }, [geometry])
  const uniforms = useMemo(
    () => ({
      uGround: { value: ground },
      uBox: { value: new Vector3(220, 130, 220) },
      uCenter: { value: new Vector3() },
      uDrift: { value: new Vector2() },
      uFallFrac: { value: 0 },
      uSlant: { value: new Vector2() },
      uFall: { value: 22 },
      uHeight: { value: 40 },
      uEdge: { value: Float32Array.from({ length: EDGE }, (_, k) => islandRadius((k / EDGE - 0.5) * Math.PI * 2)) },
      uStreak: { value: 1.2 },
      uAlpha: { value: 0 },
      uColor: { value: new Color('#c3cce2') },
      uPx: { value: 700 },
      uSplashLife: { value: 0.4 },
    }),
    [ground],
  )
  const material = useMemo(
    () => new ShaderMaterial({ vertexShader: RAIN_VERTEX, fragmentShader: RAIN_FRAGMENT, transparent: true, depthWrite: false, uniforms }),
    [uniforms],
  )
  const splashMaterial = useMemo(
    () => new ShaderMaterial({ vertexShader: SPLASH_VERTEX, fragmentShader: SPLASH_FRAGMENT, transparent: true, depthWrite: false, blending: AdditiveBlending, uniforms: { ...uniforms, uAlpha: { value: 0 } } }),
    [uniforms],
  )
  useFrame((_, delta) => {
    const object = lines.current
    const splashes = dots.current
    if (!object || !splashes) return
    const { rain, wind } = environment.state
    const dt = Math.min(delta, 0.1)
    const amount = rain
    object.visible = amount > 0.02
    splashes.visible = object.visible
    if (!object.visible) return
    const focus = place.current
    // The rain covers the ground the view is looking at: a disc around the view's focus (the orbit's target, or the walker's
    // own spot), wide enough for what the camera sees from where it stands (a little over its distance from the focus,
    // and never less than the walker's surroundings). The view's footprint is what counts, not where the camera is:
    // a camera hundreds of meters up and back from the focus would otherwise rain over the ground beneath itself only.
    const far = camera.position.distanceTo(focus)
    const radius = Math.min(2400, Math.max(160, far * 1.25))
    // Held to half-octave steps, so the rain is not constantly rescaling as the camera moves.
    const box = 2 ** (Math.round(Math.log2(radius * 2) * 2) / 2)
    // The layer's thickness: tens of meters at a walker's scale, a couple of hundred over the whole island, so a wide view sees rain.
    const height = Math.min(260, Math.max(30, 28 + box * 0.05))
    ;(uniforms.uBox.value as Vector3).set(box, height, box)
    ;(uniforms.uCenter.value as Vector3).set(focus.x, 0, focus.z)
    // Gravity first: drops fall at a steady speed, and the wind only leans them over. Both are integrated, so a gust
    // or a change of box never moves the drops that are already falling.
    // Fast: rain crosses its layer in a second or two, so it reads as falling, not drifting.
    const fall = 40 + Math.min(40, box * 0.02)
    const drift = Math.min(fall * 0.35, wind.speed * wind.gust * 0.45)
    uniforms.uFall.value = fall
    uniforms.uHeight.value = height
    uniforms.uFallFrac.value = (uniforms.uFallFrac.value + (fall * dt) / height) % 1000
    ;(uniforms.uDrift.value as Vector2).add(new Vector2(wind.x * drift * dt, wind.z * drift * dt))
    ;(uniforms.uSlant.value as Vector2).set(wind.x * drift, wind.z * drift)
    // How hard it rains sets everything together: how many drops, how long their streaks run, how visible they are, and (the same
    // drops) how many rings open on the ground and the lakes. Light rain is a few fine streaks; a downpour is many, a little longer.
    const hard = Math.min(1, amount)
    uniforms.uStreak.value = Math.min(24, Math.max(0.8, box / 140)) * (0.75 + 0.45 * hard)
    uniforms.uAlpha.value = (0.3 + 0.4 * hard) * Math.min(1, amount * 3)
    splashMaterial.uniforms.uAlpha!.value = 0.35 + 0.35 * hard
    uniforms.uPx.value = size.height / (2 * Math.tan(((camera as PerspectiveCamera).fov * Math.PI) / 360))
    const share = 0.06 + 0.94 * hard ** 1.7
    geometry.setDrawRange(0, Math.max(2, Math.floor(DROPS * share)) * 2)
    splashGeometry.setDrawRange(0, Math.max(1, Math.floor(DROPS * share)))
  })
  useEffect(
    () => () => {
      geometry.dispose()
      splashGeometry.dispose()
      material.dispose()
      splashMaterial.dispose()
      ground.dispose()
    },
    [geometry, splashGeometry, material, splashMaterial, ground],
  )
  return (
    <>
      <lineSegments ref={lines} geometry={geometry} material={material} frustumCulled={false} visible={false} renderOrder={5} />
      <points ref={dots} geometry={splashGeometry} material={splashMaterial} frustumCulled={false} visible={false} renderOrder={5} />
    </>
  )
}

const GRID = 72
const TRACERS = 900
const TRAIL = 6

/**
 * The shared wind, drawn the way 0.2 draws it: tracers carried by the wind field, each head moving with the wind
 * where it is and its streak traced back along the field, so the lines bend round hills, thin out in a lee and
 * speed up over high ground. They ride a little above the ground over the whole island, and show only with
 * the Wind field toggle. The terrain's effect on the wind is tabulated on a coarse grid (re-tabulated about
 * three times a second while the wind eases), so each frame is a few thousand lookups.
 */
export function WindTracers() {
  const lines = useRef<LineSegments>(null)
  const field = useMemo(
    () => ({ vx: new Float32Array(GRID * GRID), vz: new Float32Array(GRID * GRID), h: new Float32Array(GRID * GRID), at: -10, key: '' }),
    [],
  )
  const tracers = useMemo(() => {
    const t = { x: new Float32Array(TRACERS), z: new Float32Array(TRACERS), lift: new Float32Array(TRACERS), age: new Float32Array(TRACERS), life: new Float32Array(TRACERS) }
    let state = 4242
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) | 0
      return (state >>> 0) / 4294967296
    }
    const place = (k: number, age: number) => {
      for (let tries = 0; tries < 24; tries += 1) {
        const x = (next() * 2 - 1) * 2000
        const z = (next() * 2 - 1) * 2000
        if (Math.hypot(x, z) < islandRadius(Math.atan2(z, x)) * 0.96) {
          t.x[k] = x
          t.z[k] = z
          break
        }
      }
      t.lift[k] = 8 + next() * 26
      t.life[k] = 3 + next() * 4
      t.age[k] = age
    }
    for (let k = 0; k < TRACERS; k += 1) place(k, next() * 5)
    return { ...t, place }
  }, [])
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    const segments = TRACERS * (TRAIL - 1)
    g.setAttribute('position', new BufferAttribute(new Float32Array(segments * 6), 3).setUsage(DynamicDrawUsage))
    g.setAttribute('color', new BufferAttribute(new Float32Array(segments * 8), 4).setUsage(DynamicDrawUsage))
    return g
  }, [])
  const material = useMemo(() => new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }), [])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  const SIZE = 4096
  const cell = SIZE / (GRID - 1)
  const sample = (a: Float32Array, x: number, z: number) => {
    const gx = Math.min(GRID - 1.001, Math.max(0, (x + SIZE / 2) / cell))
    const gz = Math.min(GRID - 1.001, Math.max(0, (z + SIZE / 2) / cell))
    const i = Math.floor(gx)
    const j = Math.floor(gz)
    const fx = gx - i
    const fz = gz - j
    const o = j * GRID + i
    return (a[o]! * (1 - fx) + a[o + 1]! * fx) * (1 - fz) + (a[o + GRID]! * (1 - fx) + a[o + GRID + 1]! * fx) * fz
  }

  useFrame((state, delta) => {
    const object = lines.current
    if (!object) return
    const on = environment.controls.windField
    object.visible = on
    if (!on) return
    const { wind } = environment.state
    const dt = Math.min(delta, 0.05)
    // Re-tabulate the terrain's effect on the wind when the wind has changed, or the first time.
    const key = `${wind.x.toFixed(2)}|${wind.z.toFixed(2)}|${wind.speed.toFixed(1)}`
    const now = state.clock.elapsedTime
    if (key !== field.key && now - field.at > 0.3) {
      for (let j = 0; j < GRID; j += 1) {
        for (let i = 0; i < GRID; i += 1) {
          const x = i * cell - SIZE / 2
          const z = j * cell - SIZE / 2
          const [vx, vz] = windBaseAt(x, z)
          const o = j * GRID + i
          field.vx[o] = vx
          field.vz[o] = vz
          field.h[o] = landscapeHeight(x, z)
        }
      }
      field.key = key
      field.at = now
    }
    const strength = Math.min(1, wind.speed / 12)
    const pace = 26
    // Tracers and their trails. A trail segment is longer in a faster wind, so a gale reads as longer streaks, too.
    const reach = 5 + 9 * strength
    const position = geometry.getAttribute('position') as BufferAttribute
    const color = geometry.getAttribute('color') as BufferAttribute
    const p = position.array as Float32Array
    const c = color.array as Float32Array
    let n = 0
    for (let k = 0; k < TRACERS; k += 1) {
      tracers.x[k] += sample(field.vx, tracers.x[k]!, tracers.z[k]!) * pace * dt * wind.gust
      tracers.z[k] += sample(field.vz, tracers.x[k]!, tracers.z[k]!) * pace * dt * wind.gust
      tracers.age[k] += dt
      const r = Math.hypot(tracers.x[k]!, tracers.z[k]!)
      if (tracers.age[k]! > tracers.life[k]! || r > islandRadius(Math.atan2(tracers.z[k]!, tracers.x[k]!)) * 0.98) tracers.place(k, 0)
      const t = tracers.age[k]! / tracers.life[k]!
      const fade = smoothstep(0, 0.15, t) * (1 - smoothstep(0.7, 1, t)) * smoothstep(0.03, 0.2, strength)
      let px = tracers.x[k]!
      let pz = tracers.z[k]!
      let py = sample(field.h, px, pz) + tracers.lift[k]!
      for (let s = 0; s < TRAIL - 1; s += 1) {
        const vx = sample(field.vx, px, pz)
        const vz = sample(field.vz, px, pz)
        const length = Math.hypot(vx, vz) || 1
        const nx = px - (vx / length) * reach
        const nz = pz - (vz / length) * reach
        const ny = sample(field.h, nx, nz) + tracers.lift[k]!
        const a0 = fade * (1 - s / (TRAIL - 1)) * 0.4
        const a1 = fade * (1 - (s + 1) / (TRAIL - 1)) * 0.4
        const o = n * 6
        p[o] = px
        p[o + 1] = py
        p[o + 2] = pz
        p[o + 3] = nx
        p[o + 4] = ny
        p[o + 5] = nz
        const q = n * 8
        c[q] = 0.8
        c[q + 1] = 0.87
        c[q + 2] = 1
        c[q + 3] = a0
        c[q + 4] = 0.8
        c[q + 5] = 0.87
        c[q + 6] = 1
        c[q + 7] = a1
        n += 1
        px = nx
        pz = nz
        py = ny
      }
    }
    geometry.setDrawRange(0, n * 2)
    position.needsUpdate = true
    color.needsUpdate = true
  })
  return <lineSegments ref={lines} geometry={geometry} material={material} frustumCulled={false} visible={false} renderOrder={4} />
}
