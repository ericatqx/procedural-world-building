import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  LineBasicMaterial,
  PointsMaterial,
  ShaderMaterial,
  Vector2,
  Vector4,
  type Mesh,
} from 'three'
import { GRID_EXTENT } from '../../project/grid.ts'
import {
  advanceWaterTime,
  createTerrainMaterial,
  createWaterMaterial,
  PROJECT_COLORS,
  setTerrainDisplay,
  setWaterContours,
} from '../../project/materials.ts'
import { themeColor } from '../../shared/ui/theme.ts'
import { mulberry32 } from './distribution.ts'
import {
  createParticles,
  groundAt,
  PARTICLE_PRESETS,
  PARTICLE_STEP,
  particleAlpha,
  stepParticles,
  surfaceAt,
  type AirSample,
  type ParticleKind,
  type ParticleSystem,
  type WeatherField,
} from './fields.ts'
import { STUDY_HALF, WATER_LEVEL, type StudyTerrain } from './studyTerrain.ts'

/** What the Study section reveals. */
export type FieldOverlays = {
  particles: boolean
  /** The field itself: arrows near the ground. */
  arrows: boolean
  /** Ground open to the wind, from the same field. */
  exposure: boolean
}

type Clock = { t: number; carry: number }
/** A ripple on the lake: where and when it started, and its size (1 a click, smaller for a raindrop). */
type Ripple = { x: number; z: number; born: number; size: number }

const SEDIMENT_FALLBACK = '#f0ae56'
/** Arrows are dark analysis marks on the pale ground, like the Paths downhill ticks. */
const ARROW_INK = '#1a1a19'
/** Pointer travel, in pixels, past which a press is an orbit drag rather than a click. */
const CLICK_SLOP = 4
/** Fixed steps run per frame at most; a stalled tab drops time rather than catching up. */
const MAX_STEPS = 6
/** Arrows: a grid near the ground, length ∝ speed. */
const ARROWS = { cells: 18, lift: 0.1, scale: 0.34, min: 0.05, max: 0.25, head: 0.3, spread: 0.45 } as const
const OVERLAY = { cells: 150, lift: 0.005, exposure: 0.5 } as const
/**
 * Ripples: thin rings spreading over the water at `speed`, `gap` apart, each a
 * crest with a shallow trough inside it, fading out over `life` seconds. A
 * click is size 1 with three rings; a raindrop is smaller, with two.
 */
const RIPPLE = { speed: 0.15, life: 2.6, gap: 0.045, width: 0.005, max: 24, crest: 0.55, trough: 0.35 } as const
/** Rain: the chance a drop landing on the lake rings it, and the size of its ripple. */
const RAIN_RIPPLE = { chance: 0.012, size: 0.55 } as const
/** Streaks: screen width in pixels, the share of it that is the bright core, and the dark edge either side. */
const STREAK = { wind: 3.2, rain: 2.4, core: 0.42, edge: 0.55 } as const

const linear = (hex: string) => new Color(hex)

/** The lake takes clicks, so it shows a crosshair. */
const setCursor = (cursor: string) => {
  document.body.style.cursor = cursor
}

/** A round sprite for point particles: a crisp flake or a soft veil. */
function spriteTexture(soft: boolean): CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  if (soft) {
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.5)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
  } else {
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.55, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.8, 'rgba(255,255,255,0)')
  }
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  return new CanvasTexture(canvas)
}

function dynamicGeometry(vertices: number): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(DynamicDrawUsage))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(vertices * 4), 4).setUsage(DynamicDrawUsage))
  return geometry
}

const STREAK_VERTEX = /* glsl */ `
uniform vec2 uViewport;
uniform float uWidth;
attribute vec3 aOther;
attribute vec2 aCorner;
attribute float aAlpha;
varying float vAcross;
varying float vAlpha;
void main() {
  vec4 a = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec4 b = projectionMatrix * modelViewMatrix * vec4(aOther, 1.0);
  vec2 along = (a.xy / a.w - b.xy / b.w) * uViewport * (aCorner.y > 0.5 ? -1.0 : 1.0);
  float len = length(along);
  vec2 dir = len > 1e-4 ? along / len : vec2(1.0, 0.0);
  a.xy += vec2(-dir.y, dir.x) * aCorner.x * uWidth / uViewport * a.w;
  vAcross = aCorner.x;
  vAlpha = aAlpha * (1.0 - aCorner.y);
  gl_Position = a;
}
`

const STREAK_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uEdge;
varying float vAcross;
varying float vAlpha;
void main() {
  float d = abs(vAcross);
  float aa = fwidth(vAcross);
  float core = 1.0 - smoothstep(${STREAK.core.toFixed(2)} - aa, ${STREAK.core.toFixed(2)} + aa, d);
  float edge = 1.0 - smoothstep(1.0 - 2.0 * aa, 1.0, d);
  float alpha = vAlpha * max(core, edge * ${STREAK.edge.toFixed(2)});
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(mix(uEdge, uColor, core), alpha);
  #include <colorspace_fragment>
}
`

/** Streaks as thin screen-space ribbons: a bright core along the motion with a dark edge, so they read on pale ground and dark sky alike. */
function streakGeometry(count: number): BufferGeometry {
  const geometry = new BufferGeometry()
  const dynamic = (size: number) => new BufferAttribute(new Float32Array(count * 4 * size), size).setUsage(DynamicDrawUsage)
  const corners = new Float32Array(count * 8)
  const indices = new Uint32Array(count * 6)
  for (let i = 0; i < count; i += 1) {
    corners.set([-1, 0, 1, 0, -1, 1, 1, 1], i * 8)
    const v = i * 4
    indices.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6)
  }
  geometry.setAttribute('position', dynamic(3))
  geometry.setAttribute('aOther', dynamic(3))
  geometry.setAttribute('aAlpha', dynamic(1))
  geometry.setAttribute('aCorner', new BufferAttribute(corners, 2))
  geometry.setIndex(new BufferAttribute(indices, 1))
  return geometry
}

/** The particles of one preset: streaks along their motion, or round points. */
function Particles({ system, kind }: { system: RefObject<ParticleSystem | null>; kind: ParticleKind }) {
  const preset = PARTICLE_PRESETS[kind]
  const parts = useMemo(() => {
    const streak = preset.draw === 'streak'
    const geometry = streak ? streakGeometry(preset.count) : dynamicGeometry(preset.count)
    const sprite = streak ? null : spriteTexture(kind === 'mist')
    const material = streak
      ? new ShaderMaterial({
          vertexShader: STREAK_VERTEX,
          fragmentShader: STREAK_FRAGMENT,
          uniforms: {
            uViewport: { value: new Vector2(1, 1) },
            uWidth: { value: kind === 'rain' ? STREAK.rain : STREAK.wind },
            uColor: { value: linear(preset.color) },
            uEdge: { value: linear(ARROW_INK) },
          },
          transparent: true,
          depthWrite: false,
        })
      : new PointsMaterial({
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
          size: preset.size,
          sizeAttenuation: true,
          map: sprite,
          alphaTest: 0.002,
        })
    return { streak, geometry, material, sprite, color: linear(preset.color) }
  }, [preset, kind])
  useEffect(
    () => () => {
      parts.geometry.dispose()
      parts.material.dispose()
      parts.sprite?.dispose()
    },
    [parts],
  )
  const viewport = useMemo(() => new Vector2(), [])

  useFrame(({ gl }) => {
    const current = system.current
    if (!current || current.kind !== kind) {
      return
    }
    const position = parts.geometry.getAttribute('position') as BufferAttribute
    const pa = position.array as Float32Array
    const { opacity, streak } = preset
    if (parts.streak) {
      const material = parts.material as ShaderMaterial
      gl.getDrawingBufferSize(viewport)
      ;(material.uniforms.uViewport!.value as Vector2).copy(viewport)
      const other = parts.geometry.getAttribute('aOther') as BufferAttribute
      const alphas = parts.geometry.getAttribute('aAlpha') as BufferAttribute
      const oa = other.array as Float32Array
      const aa = alphas.array as Float32Array
      for (let i = 0; i < current.count; i += 1) {
        const p = i * 3
        const alpha = particleAlpha(current, i) * opacity
        const hx = current.position[p]!
        const hy = current.position[p + 1]!
        const hz = current.position[p + 2]!
        const tx = hx - current.velocity[p]! * streak
        const ty = hy - current.velocity[p + 1]! * streak
        const tz = hz - current.velocity[p + 2]! * streak
        const v = i * 12
        pa.set([hx, hy, hz, hx, hy, hz, tx, ty, tz, tx, ty, tz], v)
        oa.set([tx, ty, tz, tx, ty, tz, hx, hy, hz, hx, hy, hz], v)
        aa.fill(alpha, i * 4, i * 4 + 4)
      }
      other.needsUpdate = true
      alphas.needsUpdate = true
    } else {
      const color = parts.geometry.getAttribute('color') as BufferAttribute
      const ca = color.array as Float32Array
      const { r, g, b } = parts.color
      for (let i = 0; i < current.count; i += 1) {
        const p = i * 3
        pa[p] = current.position[p]!
        pa[p + 1] = current.position[p + 1]!
        pa[p + 2] = current.position[p + 2]!
        const c = i * 4
        ca[c] = r
        ca[c + 1] = g
        ca[c + 2] = b
        ca[c + 3] = particleAlpha(current, i) * opacity
      }
      color.needsUpdate = true
    }
    position.needsUpdate = true
  })

  return parts.streak ? (
    <mesh geometry={parts.geometry} material={parts.material} frustumCulled={false} renderOrder={4} raycast={() => null} />
  ) : (
    <points geometry={parts.geometry} material={parts.material} frustumCulled={false} renderOrder={4} />
  )
}

/** The field itself: a grid of dark arrows near the ground, longer where faster. */
function FieldArrows({ field, clock }: { field: WeatherField; clock: RefObject<Clock> }) {
  const n = ARROWS.cells
  const parts = useMemo(() => {
    const geometry = dynamicGeometry(n * n * 6)
    const material = new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false })
    const centres = Array.from({ length: n * n }, (_, k) => {
      const spacing = (2 * STUDY_HALF) / n
      return [-STUDY_HALF + spacing * ((k % n) + 0.5), -STUDY_HALF + spacing * (Math.floor(k / n) + 0.5)] as const
    })
    return { geometry, material, centres, ink: linear(ARROW_INK) }
  }, [n])
  useEffect(
    () => () => {
      parts.geometry.dispose()
      parts.material.dispose()
    },
    [parts],
  )
  const air = useMemo<AirSample>(() => ({ x: 0, y: 0, z: 0 }), [])

  useFrame(() => {
    const position = parts.geometry.getAttribute('position') as BufferAttribute
    const color = parts.geometry.getAttribute('color') as BufferAttribute
    const pa = position.array as Float32Array
    const ca = color.array as Float32Array
    const t = clock.current.t
    const cos = Math.cos(ARROWS.spread)
    const sin = Math.sin(ARROWS.spread)
    const { r, g, b } = parts.ink
    parts.centres.forEach(([x, z], k) => {
      field.sample(x, surfaceAt(x, z) + ARROWS.lift, z, t, air)
      const speed = Math.hypot(air.x, air.z)
      const ux = speed > 1e-5 ? air.x / speed : 1
      const uz = speed > 1e-5 ? air.z / speed : 0
      const half = Math.min(ARROWS.max, Math.max(ARROWS.min, speed * ARROWS.scale)) / 2
      const head = 2 * half * ARROWS.head
      const tipX = x + ux * half
      const tipZ = z + uz * half
      const points = [
        [x - ux * half, z - uz * half],
        [tipX, tipZ],
        [tipX, tipZ],
        [tipX - (ux * cos - uz * sin) * head, tipZ - (uz * cos + ux * sin) * head],
        [tipX, tipZ],
        [tipX - (ux * cos + uz * sin) * head, tipZ - (uz * cos - ux * sin) * head],
      ] as const
      const alpha = speed > 1e-5 ? Math.min(1, 0.35 + 0.5 * Math.min(1, speed)) : 0
      points.forEach(([px, pz], v) => {
        const index = k * 6 + v
        pa[index * 3] = px
        pa[index * 3 + 1] = surfaceAt(px, pz) + ARROWS.lift
        pa[index * 3 + 2] = pz
        ca[index * 4] = r
        ca[index * 4 + 1] = g
        ca[index * 4 + 2] = b
        ca[index * 4 + 3] = alpha
      })
    })
    position.needsUpdate = true
    color.needsUpdate = true
  })

  return <lineSegments geometry={parts.geometry} material={parts.material} frustumCulled={false} renderOrder={3} />
}

const OVERLAY_VERTEX = /* glsl */ `
attribute float aExposure;
varying float vExposure;
void main() {
  vExposure = aExposure;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const OVERLAY_FRAGMENT = /* glsl */ `
uniform vec3 uExposed;
varying float vExposure;
void main() {
  float alpha = ${OVERLAY.exposure.toFixed(2)} * smoothstep(0.3, 0.95, vExposure);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uExposed, alpha);
  #include <colorspace_fragment>
}
`

/** The exposure tint: a skin over the ground and lake. */
function ExposureOverlay({ field }: { field: WeatherField }) {
  const parts = useMemo(() => {
    const n = OVERLAY.cells
    const positions = new Float32Array((n + 1) * (n + 1) * 3)
    const indices: number[] = []
    for (let j = 0; j <= n; j += 1) {
      for (let i = 0; i <= n; i += 1) {
        const x = -STUDY_HALF + (2 * STUDY_HALF * i) / n
        const z = -STUDY_HALF + (2 * STUDY_HALF * j) / n
        positions.set([x, surfaceAt(x, z) + OVERLAY.lift, z], (j * (n + 1) + i) * 3)
        if (i < n && j < n) {
          const a = j * (n + 1) + i
          indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2)
        }
      }
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('aExposure', new BufferAttribute(new Float32Array((n + 1) * (n + 1)), 1))
    geometry.setIndex(indices)
    geometry.computeBoundingSphere()
    const material = new ShaderMaterial({
      vertexShader: OVERLAY_VERTEX,
      fragmentShader: OVERLAY_FRAGMENT,
      uniforms: { uExposed: { value: linear(themeColor('--sediment', SEDIMENT_FALLBACK)) } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    return { geometry, material }
  }, [])
  useEffect(
    () => () => {
      parts.geometry.dispose()
      parts.material.dispose()
    },
    [parts],
  )
  useLayoutEffect(() => {
    const position = parts.geometry.getAttribute('position')
    const values = parts.geometry.getAttribute('aExposure') as BufferAttribute
    for (let k = 0; k < values.count; k += 1) {
      values.setX(k, field.exposureAt(position.getX(k), position.getZ(k)))
    }
    values.needsUpdate = true
  }, [parts, field])

  return <mesh geometry={parts.geometry} material={parts.material} renderOrder={2} raycast={() => null} />
}

const RIPPLE_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const RIPPLE_FRAGMENT = /* glsl */ `
uniform vec4 uRipples[${RIPPLE.max}];
uniform vec3 uCrest;
uniform vec3 uTrough;
varying vec3 vWorld;
void main() {
  if (vWorld.y < ${(WATER_LEVEL - 0.001).toFixed(4)}) discard; // the outlet's cut face
  float pixel = length(fwidth(vWorld.xz)) * 0.7;
  float width = max(${RIPPLE.width.toFixed(4)}, pixel);
  float thin = ${RIPPLE.width.toFixed(4)} / width;
  float h = 0.0;
  for (int i = 0; i < ${RIPPLE.max}; i++) {
    vec4 r = uRipples[i];
    if (r.w <= 0.0) continue;
    float life = ${RIPPLE.life.toFixed(3)} * (0.4 + 0.6 * r.w);
    if (r.z >= life) continue;
    float scale = 0.55 + 0.45 * r.w;
    float lead = ${RIPPLE.speed.toFixed(3)} * scale * r.z;
    float d = distance(vWorld.xz, r.xy);
    if (d > lead + 4.0 * width) continue;
    float fade = pow(1.0 - r.z / life, 1.6) * (0.5 + 0.5 * r.w);
    float rings = r.w > 0.8 ? 3.0 : 2.0;
    for (int k = 0; k < 3; k++) {
      float radius = lead - float(k) * ${RIPPLE.gap.toFixed(3)} * scale;
      if (float(k) >= rings || radius <= 0.0) break;
      float u = (d - radius) / width;
      float wave = exp(-u * u) - 0.6 * exp(-(u + 1.8) * (u + 1.8));
      h += wave * fade * (1.0 - 0.3 * float(k)) * smoothstep(0.0, 2.0 * width, radius);
    }
  }
  h *= thin;
  float alpha = h > 0.0 ? min(1.0, h) * ${RIPPLE.crest.toFixed(2)} : min(1.0, -h) * ${RIPPLE.trough.toFixed(2)};
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(h > 0.0 ? uCrest : uTrough, alpha);
  #include <colorspace_fragment>
}
`

/** Ripples drawn on the water surface itself: light crests with a shallow trough inside, over the lake only. */
function WaterRipples({ terrain, clock, ripples }: { terrain: StudyTerrain; clock: RefObject<Clock>; ripples: RefObject<Ripple[]> }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: RIPPLE_VERTEX,
        fragmentShader: RIPPLE_FRAGMENT,
        uniforms: {
          uRipples: { value: Array.from({ length: RIPPLE.max }, () => new Vector4()) },
          uCrest: { value: linear(PROJECT_COLORS.waterLine) },
          uTrough: { value: linear(PROJECT_COLORS.waterDeep) },
        },
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  useFrame(() => {
    const t = clock.current.t
    ;(material.uniforms.uRipples!.value as Vector4[]).forEach((slot, k) => {
      const r = ripples.current[k]
      slot.set(r?.x ?? 0, r?.z ?? 0, r ? t - r.born : 0, r?.size ?? 0)
    })
  })

  return <mesh geometry={terrain.water} material={material} renderOrder={2} raycast={() => null} />
}

/** Smaller ripples die sooner; matches `life` in the ripple shader. */
const rippleLife = (size: number) => RIPPLE.life * (0.4 + 0.6 * size)
/** Clicks and raindrops ring only open water, not the shore line. */
const onLake = (x: number, z: number) => groundAt(x, z) < WATER_LEVEL - 0.005

export function FieldsScene({
  terrain,
  field,
  kind,
  overlays,
  contours,
  wireframe,
}: {
  terrain: StudyTerrain
  field: WeatherField
  kind: ParticleKind
  overlays: FieldOverlays
  contours: boolean
  wireframe: boolean
}) {
  const materials = useMemo(
    () => ({
      terrain: createTerrainMaterial(terrain.field, terrain.habitatField, GRID_EXTENT),
      water: createWaterMaterial(),
    }),
    [terrain],
  )
  useEffect(
    () => () => {
      materials.terrain.material.dispose()
      materials.water.material.dispose()
    },
    [materials],
  )
  useLayoutEffect(
    () => setTerrainDisplay(materials.terrain, { habitat: false, fieldOnly: false, contours, wireframe }),
    [materials, contours, wireframe],
  )
  useLayoutEffect(() => setWaterContours(materials.water, contours), [materials, contours])

  const clock = useRef<Clock>({ t: 0, carry: 0 })
  const ripples = useRef<Ripple[]>([])
  const fieldRef = useRef(field)
  useLayoutEffect(() => {
    fieldRef.current = field
  }, [field])

  // A new preset or seed starts a fresh run of particles; field changes act on the particles in flight.
  const system = useRef<ParticleSystem | null>(null)
  const rainRandom = useRef<() => number>(Math.random)
  const seed = field.settings.seed
  useLayoutEffect(() => {
    system.current = createParticles(kind, seed, fieldRef.current)
    rainRandom.current = mulberry32(seed * 7919 + 606)
  }, [kind, seed])

  const addRipple = (x: number, z: number, size: number) => {
    const live = ripples.current
    if (size < 1 && live.length >= RIPPLE.max) {
      return
    }
    ripples.current = [...live, { x, z, born: clock.current.t, size }].slice(-RIPPLE.max)
  }
  const rainLanded = (x: number, z: number) => {
    if (onLake(x, z) && rainRandom.current() < RAIN_RIPPLE.chance) {
      addRipple(x, z, RAIN_RIPPLE.size)
    }
  }

  // Before anything draws: advance the clock in fixed steps and move the particles.
  useFrame((_, delta) => {
    advanceWaterTime(materials.water, delta)
    const c = clock.current
    c.carry += delta
    let steps = 0
    while (c.carry >= PARTICLE_STEP && steps < MAX_STEPS) {
      c.carry -= PARTICLE_STEP
      c.t += PARTICLE_STEP
      steps += 1
      if (overlays.particles && system.current) {
        stepParticles(system.current, fieldRef.current, c.t, system.current.kind === 'rain' ? rainLanded : undefined)
      }
    }
    if (steps === MAX_STEPS) {
      c.carry = 0
    }
    if (ripples.current.some((r) => c.t - r.born > rippleLife(r.size))) {
      ripples.current = ripples.current.filter((r) => c.t - r.born <= rippleLife(r.size))
    }
  }, -1)

  useEffect(() => () => setCursor(''), [])

  const water = useRef<Mesh>(null)
  /** The nearest surface under the pointer, if it is open lake. */
  const lakePoint = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
    const hit = event.intersections[0]
    return hit && hit.object === water.current && onLake(hit.point.x, hit.point.z) ? hit.point : null
  }
  const ripple = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    const point = lakePoint(event)
    if (point && event.delta <= CLICK_SLOP) {
      addRipple(point.x, point.z, 1)
    }
  }
  const hover = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    setCursor(lakePoint(event) ? 'crosshair' : '')
  }

  return (
    <>
      <group onClick={ripple} onPointerMove={hover} onPointerOut={() => setCursor('')}>
        <mesh geometry={terrain.geometry} material={materials.terrain.material} castShadow receiveShadow />
        <mesh ref={water} geometry={terrain.water} material={materials.water.material} receiveShadow />
      </group>
      <WaterRipples terrain={terrain} clock={clock} ripples={ripples} />
      {overlays.exposure ? <ExposureOverlay field={field} /> : null}
      {overlays.arrows ? <FieldArrows field={field} clock={clock} /> : null}
      {overlays.particles ? <Particles system={system} kind={kind} /> : null}
    </>
  )
}
