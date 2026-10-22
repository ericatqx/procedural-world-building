import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color, DoubleSide, MeshStandardMaterial } from 'three'
import { WATER_02 } from '../project02/materials.ts'
import { buildWaterGeometry, type WaterSystem } from './water.ts'

/**
 * 0.3's still water, in the family 0.1 and 0.2 share: matte cobalt that
 * deepens to ultramarine, a pale line where it meets the ground, a slow broad
 * swell rather than waves, and the sky caught at grazing angles. Depth is read
 * in meters. The swell is drawn in the normal only, so the surface stays a flat
 * contour at its level (the shoreline is that contour) and the ripple fades
 * with distance, which keeps far lakes calm instead of noisy.
 */
export const WATER_03_DEPTH = {
  /** Meters over which the shallows deepen from the shore tone to the mid tone, then to the deep tone. */
  shallow: 1.6,
  deepFrom: 1.2,
  deepTo: 14,
}

const WATER_VERTEX = /* glsl */ `
attribute float aDepth;
varying float vWaterDepth;
varying vec3 vWaterWorld;`

const WATER_FRAGMENT_HEAD = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uMid;
uniform vec3 uDeep;
uniform vec3 uLine;
uniform vec3 uSky;
uniform vec3 uGlint;
varying float vWaterDepth;
varying vec3 vWaterWorld;

float wHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float wNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(wHash(i), wHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(wHash(i + vec3(0.0, 1.0, 0.0)), wHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(wHash(i + vec3(0.0, 0.0, 1.0)), wHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(wHash(i + vec3(0.0, 1.0, 1.0)), wHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z
  );
}
// Surface height of the swell, in meters: a broad slow roll under a finer shimmer drifting the other way.
float swell(vec2 p) {
  float broad = wNoise(vec3(p / 46.0 + vec2(uTime * 0.012, 0.0), uTime * 0.045));
  float fine = wNoise(vec3(p / 9.0 - vec2(0.0, uTime * 0.02), uTime * 0.09 + 4.1));
  return broad * 1.1 + fine * 0.38;
}`

const WATER_ALBEDO = /* glsl */ `
float wDistance = length(vViewPosition);
vec3 waterColor = mix(uShallow, uMid, smoothstep(0.0, ${WATER_03_DEPTH.shallow.toFixed(2)}, vWaterDepth));
waterColor = mix(waterColor, uDeep, smoothstep(${WATER_03_DEPTH.deepFrom.toFixed(2)}, ${WATER_03_DEPTH.deepTo.toFixed(2)}, vWaterDepth));
// The shoreline is a contour: a thin pale line at the water's level, kept about two pixels wide at any distance.
float rimWidth = max(0.18, fwidth(vWaterDepth) * 2.2);
float rim = 1.0 - smoothstep(0.0, rimWidth, vWaterDepth);
waterColor = mix(waterColor, uLine, rim * 0.5);
float shimmer = swell(vWaterWorld.xz);
waterColor *= 1.0 + (shimmer - 0.75) * 0.11 * (1.0 - smoothstep(300.0, 2600.0, wDistance));
diffuseColor.rgb = waterColor;
`

const WATER_NORMAL = /* glsl */ `
float wFade = 1.0 - smoothstep(220.0, 2400.0, length(vViewPosition));
float wE = 0.6;
vec2 wP = vWaterWorld.xz;
float wH = swell(wP);
vec2 wSlope = vec2(swell(wP + vec2(wE, 0.0)) - wH, swell(wP + vec2(0.0, wE)) - wH) / wE;
vec3 wTilt = (viewMatrix * vec4(-wSlope.x, 0.0, -wSlope.y, 0.0)).xyz * 0.8 * wFade;
normal = normalize(normal + wTilt);
`

const WATER_LIT = /* glsl */ `
// The water stays readable in shade: part of its colour is its own, and the sky shows at grazing angles.
outgoingLight += diffuseColor.rgb * 0.2;
float wFresnel = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
outgoingLight = mix(outgoingLight, uSky * 0.75, wFresnel * 0.32);
// Where the sun catches the surface, the light turns to a soft blue glow, as in 0.2, rather than a white blowout.
float wGlow = smoothstep(0.5, 1.1, dot(outgoingLight, vec3(0.3333)));
outgoingLight = mix(outgoingLight, min(outgoingLight, uGlint * 1.12), wGlow);
`

export function createWater03Material() {
  const uniforms = {
    uTime: { value: 0 },
    uShallow: { value: new Color(WATER_02.uWaterShallow) },
    uMid: { value: new Color(WATER_02.uWaterMid) },
    uDeep: { value: new Color(WATER_02.uWaterDeep) },
    uLine: { value: new Color(WATER_02.uWaterLine) },
    uSky: { value: new Color(WATER_02.uWaterSky) },
    uGlint: { value: new Color(WATER_02.uWaterGlint) },
  }
  const material = new MeshStandardMaterial({ roughness: 0.3, metalness: 0, side: DoubleSide })
  material.customProgramCacheKey = () => 'water03'
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${WATER_VERTEX}\nvoid main() {`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvWaterDepth = aDepth;\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${WATER_FRAGMENT_HEAD}\nvoid main() {`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${WATER_ALBEDO}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${WATER_NORMAL}`)
      .replace('#include <opaque_fragment>', `${WATER_LIT}\n#include <opaque_fragment>`)
  }
  return { material, uniforms }
}

/** All of the world's still water as one surface, hidden or shown from Display. */
export function WaterLayer({ water, visible }: { water: WaterSystem; visible: boolean }) {
  const geometry = useMemo(() => buildWaterGeometry(water), [water])
  const { material, uniforms } = useMemo(createWater03Material, [])
  useFrame((_, delta) => {
    uniforms.uTime.value += Math.min(delta, 0.1)
  })
  useEffect(
    () => () => {
      geometry.dispose()
    },
    [geometry],
  )
  useEffect(() => () => material.dispose(), [material])
  return <mesh geometry={geometry} material={material} visible={visible} frustumCulled renderOrder={0} />
}
