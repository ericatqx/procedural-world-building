import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color, DoubleSide, MeshStandardMaterial, Vector2 } from 'three'
import { environment, skyLit } from './environment.ts'
import { applyMist } from './mist.ts'
import { WATER_02 } from '../project02/materials.ts'
import { buildFallGeometry, buildRiverGeometry, type RiverSystem } from './rivers.ts'
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

const NOISE_GLSL = /* glsl */ `
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
`

// Streaks and their crossfade, shared by rivers and falls so the flow carries over the lip unbroken.
// Sized for the island, not the channel: a river is tens of meters across and seen from hundreds
// to thousands, so a streak is a few channel widths long and the current moves at tens of m/s
// (0.2's 0.12 units/s on an island ~10 units across, scaled to this one). Slower than that, the
// motion is under a pixel per second from Approach and Overview.
const FLOW_GLSL = /* glsl */ `
// Streaks stretched along the flow: p is (meters along, share across).
float streak(vec2 p) {
  return wNoise(vec3(p.x * 0.014, p.y * 2.6, 0.0)) * 0.6 + wNoise(vec3(p.x * 0.036, p.y * 5.5, 3.7)) * 0.4;
}
// Two offset phases of the same streaks, each restarting every cycle and crossfaded, so they never shear apart (0.2).
float flowRipple(vec2 p, float speed) {
  float cycle = 8.0;
  float a = fract(uTime / cycle);
  float b = fract(uTime / cycle + 0.5);
  float ra = streak(vec2(p.x - a * cycle * speed, p.y));
  float rb = streak(vec2(p.x - b * cycle * speed + 31.0, p.y + 0.21));
  float r = mix(rb, ra, 1.0 - abs(2.0 * a - 1.0));
  // Value noise clusters around its mean; stretch it so the streaks span the whole 0..1 range.
  return clamp((r - 0.5) * 2.6 + 0.5, 0.0, 1.0);
}
`

const RAMP_GLSL = /* glsl */ `
// One depth ramp for every kind of water: lakes, rivers and the depth a fall leaves its channel with.
vec3 wRamp(float depth) {
  vec3 c = mix(uShallow, uMid, smoothstep(0.0, ${WATER_03_DEPTH.shallow.toFixed(2)}, depth));
  return mix(c, uDeep, smoothstep(${WATER_03_DEPTH.deepFrom.toFixed(2)}, ${WATER_03_DEPTH.deepTo.toFixed(2)}, depth));
}
`

const WATER_VERTEX = /* glsl */ `
attribute float aDepth;
attribute float aFall;
attribute float aAlong;
attribute float aAcross;
uniform float uRise;
varying float vWaterDepth;
varying float vWaterFall;
varying float vWaterAlong;
varying float vWaterAcross;
varying vec3 vWaterWorld;`

const WATER_FRAGMENT_HEAD = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uMid;
uniform vec3 uDeep;
uniform vec3 uLine;
uniform vec3 uSky;
uniform vec3 uGlint;
uniform vec2 uWindPhase;
uniform vec2 uWindDir;
uniform float uWind;
uniform float uRain;
uniform float uLit;
uniform float uFlow;
varying float vWaterDepth;
varying float vWaterFall;
varying float vWaterAlong;
varying float vWaterAcross;
varying vec3 vWaterWorld;

${NOISE_GLSL}
${RAMP_GLSL}
// Surface height of the swell, in meters: a broad slow roll under a finer shimmer drifting the other way.
// The swell drifts downwind: uWindPhase is the wind's own integrated push.
float swell(vec2 p) {
  p -= uWindPhase;
  float broad = wNoise(vec3(p / 46.0 + vec2(uTime * 0.012, 0.0), uTime * 0.045));
  float fine = wNoise(vec3(p / 9.0 - vec2(0.0, uTime * 0.02), uTime * 0.09 + 4.1));
  return broad * 1.1 + fine * 0.38;
}
${FLOW_GLSL}
// Rain on open water: rings spreading from random cells (0.2's rings, one layer), as many as the rain's strength allows.
float rainRings(vec2 p) {
  vec2 q = p * 0.7;
  vec2 cell = floor(q);
  float h = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 c = cell + vec2(float(x), float(y));
      float rnd = wHash(vec3(c, 0.5));
      if (rnd > uRain * 0.45) continue;
      vec2 centre = c + 0.2 + 0.6 * vec2(wHash(vec3(c, 3.1)), wHash(vec3(c, 5.7)));
      float phase = fract(uTime * 0.7 + rnd * 7.0);
      float behind = phase * 1.2 - length(q - centre);
      if (behind < 0.0 || behind > 0.9) continue;
      h += sin(behind * 22.0) * exp(-behind * 3.0) * (1.0 - phase) * (1.0 - phase);
    }
  }
  return h;
}`

const water_albedo = (river: boolean) => /* glsl */ `
float wRiver = ${river ? '1.0' : '0.0'};
float wDistance = length(vViewPosition);
float wNear = 1.0 - smoothstep(300.0, 2600.0, wDistance);
// Still water and rivers share one depth ramp, read from the carved ground.
vec3 waterColor = wRamp(vWaterDepth);
// The shoreline is only a hint: a faint lighter edge, a pixel or two wide, as in 0.2.
float rimWidth = max(0.12, fwidth(vWaterDepth) * 1.6);
float rim = 1.0 - smoothstep(0.0, rimWidth, vWaterDepth);
waterColor = mix(waterColor, uLine, rim * 0.14);
// Lakes drift on a slow swell; rivers carry streaks along their flow, faster over drops.
// The river runs with its discharge: a trickle in a dry spell, quick and full after rain.
float wSpeed = mix(14.0, 32.0, vWaterFall) * (0.45 + 1.4 * uFlow);
float wRipple = flowRipple(vec2(vWaterAlong, vWaterAcross), wSpeed);
float wShimmer = mix(swell(vWaterWorld.xz) - 0.75, (wRipple - 0.5) * 1.6, wRiver);
// The lake's shimmer livens with the wind: calm water is nearly flat, a breeze roughens it in drifting patches.
waterColor *= 1.0 + wShimmer * mix(0.11 * (1.0 + 2.6 * uWind), 0.16, wRiver) * wNear;
float wThread = wRiver * (1.0 - smoothstep(0.0, 0.8, abs(vWaterAcross))) * smoothstep(0.56, 0.86, wRipple);
waterColor = mix(waterColor, uLine, wThread * mix(0.12, 0.16, vWaterFall));
// Steep reaches of a river run paler and break into foam at their head.
float wRapid = wRiver * vWaterFall * smoothstep(0.5, 0.85, wRipple);
waterColor = mix(waterColor, uLine, wRapid * 0.14);
diffuseColor.rgb = waterColor;
// Height of the streaks for the normal below (view-space derivatives, as in 0.2).
float waterHeight = (wRipple - 0.5) * wRiver * 0.8;
float wDhdx = dFdx(waterHeight);
float wDhdy = dFdy(waterHeight);
`

const WATER_NORMAL = /* glsl */ `
float wFade = 1.0 - smoothstep(220.0, 2400.0, length(vViewPosition));
float wE = 0.6;
vec2 wP = vWaterWorld.xz;
float wH = swell(wP);
vec2 wSlope = vec2(swell(wP + vec2(wE, 0.0)) - wH, swell(wP + vec2(0.0, wE)) - wH) / wE;
vec3 wTilt = (viewMatrix * vec4(-wSlope.x, 0.0, -wSlope.y, 0.0)).xyz * 0.8 * (1.0 + uWind * (0.6 + 2.0 * wNoise(vec3((wP - uWindPhase * 2.0) / 55.0, uTime * 0.08)))) * wFade * (1.0 - wRiver);
normal = normalize(normal + wTilt);
// Wind raises wavelets that travel downwind across open water, in gusty patches: two crossing wave trains whose
// slope tilts the surface, so the light on a lake visibly moves with the wind.
if (wRiver < 0.5 && uWind > 0.04) {
  vec2 wd = uWindDir;
  vec2 cross2 = vec2(-wd.y, wd.x);
  float travelled = dot(uWindPhase, wd);
  float gustPatch = 0.35 + 0.65 * wNoise(vec3((wP - uWindPhase * 2.0) / 90.0, uTime * 0.04));
  float amp = uWind * uWind * gustPatch * wFade;
  float p1 = 0.42 * (dot(wP, wd) - 2.6 * travelled);
  float p2 = 1.15 * (dot(wP, wd * 0.93 + cross2 * 0.37) - 3.0 * travelled);
  vec2 slope = wd * cos(p1) * 0.2 + (wd * 0.93 + cross2 * 0.37) * cos(p2) * 0.26;
  normal = normalize(normal + (viewMatrix * vec4(-slope.x, 0.0, -slope.y, 0.0)).xyz * amp * 1.8);
}
if (uRain > 0.02 && wFade > 0.03) {
  float rE = 0.5;
  float r0 = rainRings(wP);
  vec2 rSlope = vec2(rainRings(wP + vec2(rE, 0.0)) - r0, rainRings(wP + vec2(0.0, rE)) - r0) / rE;
  normal = normalize(normal + (viewMatrix * vec4(-rSlope.x, 0.0, -rSlope.y, 0.0)).xyz * (0.05 + 0.1 * uRain) * wFade * (1.0 - smoothstep(50.0, 420.0, wDistance)));
}
// Streaks and falling lanes catch the light through the derivatives of their height.
vec3 wDpdx = dFdx(-vViewPosition);
vec3 wDpdy = dFdy(-vViewPosition);
vec3 wR1 = cross(wDpdy, normal);
vec3 wR2 = cross(normal, wDpdx);
float wDet = dot(wDpdx, wR1);
vec3 wGrad = sign(wDet) * (wDhdx * wR1 + wDhdy * wR2);
normal = normalize(abs(wDet) * normal - wGrad * 0.5 * wNear);
`

const WATER_LIT = /* glsl */ `
// The water stays readable in shade: part of its colour is its own, and the sky shows at grazing angles.
outgoingLight += diffuseColor.rgb * 0.2 * uLit;
float wStill = 1.0 - vWaterFall;
float wFresnel = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 3.0);
outgoingLight = mix(outgoingLight, uSky * 0.75, wFresnel * 0.3 * wStill * uLit);
// Where the sun catches the surface, the light turns to a soft blue glow, as in 0.2, rather than a white blowout.
vec3 wGlare = max(outgoingLight - vec3(0.26, 0.34, 0.85), 0.0);
outgoingLight -= wGlare * (1.0 - 1.0 / (1.0 + wGlare * 9.0));
float wGlow = smoothstep(0.5, 1.1, dot(outgoingLight, vec3(0.3333)));
outgoingLight = mix(outgoingLight, min(outgoingLight, uGlint * 1.12), wGlow);
`

/**
 * Far from the camera the ground is drawn on a coarse grid that cannot hold a narrow
 * channel, so a river ribbon would show through only in dashes. Rivers rise a few
 * meters with distance (nothing within a few hundred meters), which keeps the line
 * whole from afar and leaves the close view exact.
 */
const RIVER_FAR_LIFT = { near: 300, far: 2400, meters: 3 }

export function createWater03Material(farLift = false) {
  const uniforms = {
    uTime: { value: 0 },
    uShallow: { value: new Color(WATER_02.uWaterShallow) },
    uMid: { value: new Color(WATER_02.uWaterMid) },
    uDeep: { value: new Color(WATER_02.uWaterDeep) },
    uLine: { value: new Color(WATER_02.uWaterLine) },
    uSky: { value: new Color(WATER_02.uWaterSky) },
    uGlint: { value: new Color(WATER_02.uWaterGlint) },
    uWindPhase: { value: new Vector2() },
    uWindDir: { value: new Vector2(1, 0) },
    uWind: { value: 0 },
    uRain: { value: 0 },
    uRise: { value: 0 },
    uFlow: { value: 0.3 },
    uLit: skyLit,
  }
  const material = new MeshStandardMaterial({ roughness: 0.3, metalness: 0, side: DoubleSide })
  material.customProgramCacheKey = () => (farLift ? 'water03-river' : 'water03')
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${WATER_VERTEX}\nvoid main() {`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
${
  farLift
    ? `transformed.y += ${RIVER_FAR_LIFT.meters.toFixed(1)} * smoothstep(${RIVER_FAR_LIFT.near.toFixed(1)}, ${RIVER_FAR_LIFT.far.toFixed(1)}, distance(cameraPosition, (modelMatrix * vec4(transformed, 1.0)).xyz)) + uRise;`
    : 'transformed.y += uRise;'
}
vWaterDepth = aDepth + ${farLift ? '0.0' : 'uRise'};
vWaterFall = aFall;
vWaterAlong = aAlong;
vWaterAcross = aAcross;
vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${WATER_FRAGMENT_HEAD}\nvoid main() {`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${water_albedo(farLift)}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${WATER_NORMAL}`)
      .replace('#include <opaque_fragment>', `${WATER_LIT}\n#include <opaque_fragment>`)
    applyMist(shader)
  }
  return { material, uniforms }
}

/**
 * Rim falls: the river's own streaks carried over the lip and drawn out downward as the
 * water speeds up, on a sheet that is bent in the vertex shader by slow billows travelling
 * down it. Shape comes from smooth masks (a soft outline, a few slits that open lower down,
 * a long fade at the foot), never from per-pixel noise. Lighter and a little translucent,
 * with the same palette and glare cap as still water.
 */
const FALL_VERTEX = /* glsl */ `
attribute float aAlong;
attribute float aAcross;
attribute float aDrop;
attribute vec4 aFall;
uniform float uTime;
varying float vFallAlong;
varying float vFallAcross;
varying float vFallT;
varying vec4 vFallInfo;`

const FALL_DISPLACE = /* glsl */ `
vFallAlong = aAlong;
vFallAcross = aAcross;
vFallT = aDrop;
vFallInfo = aFall;
// Billows run down the sheet and bow it out and in, a fraction of its width, so every fall moves in proportion to itself.
float fPhase = aDrop * 9.0 * max(1.0, aFall.x / 150.0) - uTime * 2.4;
float fBillow = sin(fPhase + aAcross * 1.7) * 0.6 + sin(fPhase * 1.9 - aAcross * 2.6 + 1.3) * 0.4;
transformed += normal * fBillow * min(aFall.y * 0.12, aFall.x * 0.035) * smoothstep(0.1, 0.4, aDrop);`

const FALL_FRAGMENT_HEAD = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uMid;
uniform vec3 uDeep;
uniform vec3 uLine;
uniform vec3 uSky;
uniform vec3 uGlint;
uniform float uLit;
uniform float uFlow;
varying float vFallAlong;
varying float vFallAcross;
varying float vFallT;
varying vec4 vFallInfo;
${NOISE_GLSL}
${RAMP_GLSL}
${FLOW_GLSL}`

const FALL_ALBEDO = /* glsl */ `
float fT = vFallT;
float fX = vFallAcross;
float fHeight = vFallInfo.x;
float fRim = vFallInfo.z;
float fEase = smoothstep(0.0, 0.2, fT);
// The river's own streaks, carried over the lip and drawn down the fall: shorter than on the river
// so that a streak fits in the drop, and moving at the speed gravity gives the water by that point.
float fScale = mix(1.0, clamp(400.0 / fHeight, 2.0, 14.0), fEase);
float fSpeed = (22.0 + 3.5 * sqrt(fHeight) * fT) * (0.45 + 1.4 * uFlow);
float fFlow = flowRipple(vec2(vFallAlong * fScale, fX * mix(1.0, 0.85, fEase)), fSpeed * fScale);
// Outline: full width at the lip, then a soft edge that wanders slowly with the flow.
float fWander = (wNoise(vec3(fT * 6.0 * max(1.0, fHeight / 150.0) - uTime * 0.5, fX * 0.8, 2.2)) - 0.5) * 0.12 * fEase;
float fBody = 1.0 - smoothstep(mix(0.97, 0.78, fEase), 1.0, abs(fX) + fWander);
// A few thinner streams: slits that open in the lower half, drifting very slowly.
float fSlitN = wNoise(vec3(fX * 2.1 + 4.0, fT * 1.6 * max(1.0, fHeight / 150.0) - uTime * 0.04, 9.1));
float fSlitAt = 0.0;
float fSlit = smoothstep(fSlitAt, fSlitAt + 0.1, fSlitN);
// Only a fall into open air ends in mist, and only at the very end; a plunge lands in its channel.
float fFoot = 1.0 - fRim * smoothstep(0.8, 1.0, fT);
// The colour the river arrived in, treated by its streaks exactly as the river's own are.
vec3 fColor = wRamp(vFallInfo.w);
fColor *= 1.0 + (fFlow - 0.5) * 0.16;
fColor = mix(fColor, uLine, smoothstep(0.56, 0.86, fFlow) * (1.0 - smoothstep(0.0, 0.8, abs(fX))) * 0.2);
// A touch of white at the lip and (for a plunge) the pool, added after lighting so it reads at grazing sun.
float fLane = (1.0 - smoothstep(0.0, 0.05, fT)) * 0.12 + (1.0 - fRim) * smoothstep(0.86, 1.0, fT) * 0.14;
diffuseColor.rgb = fColor;
diffuseColor.a = fBody * fSlit * fFoot * 0.94;
float fHeightMap = (fFlow - 0.5) * 1.6;
float fDhdx = dFdx(fHeightMap);
float fDhdy = dFdy(fHeightMap);
`

const FALL_NORMAL = /* glsl */ `
vec3 fDpdx = dFdx(-vViewPosition);
vec3 fDpdy = dFdy(-vViewPosition);
vec3 fR1 = cross(fDpdy, normal);
vec3 fR2 = cross(normal, fDpdx);
float fDet = dot(fDpdx, fR1);
vec3 fGrad = sign(fDet) * (fDhdx * fR1 + fDhdy * fR2);
normal = normalize(abs(fDet) * normal - fGrad * 0.5);
// Lit as the river above it is lit, so the colour doesn't change at the lip: the sheet's normal leans toward up.
normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), mix(0.45, 0.8, fRim) * fEase));
`

const FALL_LIT = /* glsl */ `
outgoingLight += diffuseColor.rgb * 0.2 * uLit;
float fFresnel = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 3.0);
outgoingLight = mix(outgoingLight, uSky * 0.75, fFresnel * 0.15 * uLit);
vec3 fGlare = max(outgoingLight - vec3(0.26, 0.34, 0.85), 0.0);
outgoingLight -= fGlare * (1.0 - 1.0 / (1.0 + fGlare * 9.0));
float fGlow = smoothstep(0.5, 1.1, dot(outgoingLight, vec3(0.3333)));
outgoingLight = mix(outgoingLight, min(outgoingLight, uGlint * 1.12), fGlow);
outgoingLight = mix(outgoingLight, uLine, fLane * fBody * uLit);
`

export function createFall03Material() {
  const uniforms = {
    uTime: { value: 0 },
    uShallow: { value: new Color(WATER_02.uWaterShallow) },
    uMid: { value: new Color(WATER_02.uWaterMid) },
    uDeep: { value: new Color(WATER_02.uWaterDeep) },
    uLine: { value: new Color(WATER_02.uWaterLine) },
    uSky: { value: new Color(WATER_02.uWaterSky) },
    uGlint: { value: new Color(WATER_02.uWaterGlint) },
    uLit: skyLit,
    uFlow: { value: 0.3 },
  }
  const material = new MeshStandardMaterial({ roughness: 0.3, metalness: 0, side: DoubleSide, transparent: true, depthWrite: false })
  material.customProgramCacheKey = () => 'water03-fall'
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${FALL_VERTEX}\nvoid main() {`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${FALL_DISPLACE}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${FALL_FRAGMENT_HEAD}\nvoid main() {`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FALL_ALBEDO}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FALL_NORMAL}`)
      .replace('#include <opaque_fragment>', `${FALL_LIT}\n#include <opaque_fragment>`)
    applyMist(shader)
  }
  return { material, uniforms }
}

/** All of the world's still water as one surface, hidden or shown from Display. */
export function WaterLayer({ water, rivers, visible }: { water: WaterSystem; rivers: RiverSystem; visible: boolean }) {
  const geometry = useMemo(() => buildWaterGeometry(water), [water])
  const riverGeometry = useMemo(() => buildRiverGeometry(rivers), [rivers])
  const { material, uniforms } = useMemo(() => createWater03Material(), [])
  const river = useMemo(() => createWater03Material(true), [])
  const fallGeometry = useMemo(() => buildFallGeometry(rivers), [rivers])
  const fall = useMemo(() => createFall03Material(), [])
  useFrame((_, delta) => {
    uniforms.uTime.value += Math.min(delta, 0.1)
    river.uniforms.uTime.value = uniforms.uTime.value
    fall.uniforms.uTime.value = uniforms.uTime.value
    // The shared environment: wind drifts the swell and stirs it, rain rings the open water.
    const { windPhase, wind, rain, lakeRise, flow } = environment.state
    // After rain the lakes stand a little higher (the surface only; shorelines follow the ground, rivers and hydrology are unchanged).
    uniforms.uRise.value = lakeRise
    // Rivers stand a little higher in flood (their banks run under the surface, so they widen), and run faster.
    river.uniforms.uRise.value = Math.min(0.7, Math.max(0, flow - 0.15) * 0.9)
    uniforms.uFlow.value = flow
    river.uniforms.uFlow.value = flow
    fall.uniforms.uFlow.value = flow
    for (const target of [uniforms, river.uniforms]) {
      target.uWindPhase.value.set(windPhase.x, windPhase.z)
      target.uWindDir.value.set(wind.x, wind.z)
      target.uWind.value = Math.min(1, (wind.speed * wind.gust) / 16)
      target.uRain.value = rain
    }
  })
  useEffect(
    () => () => {
      geometry.dispose()
    },
    [geometry],
  )
  useEffect(
    () => () => {
      riverGeometry.dispose()
    },
    [riverGeometry],
  )
  useEffect(() => () => fallGeometry?.dispose(), [fallGeometry])
  useEffect(() => () => fall.material.dispose(), [fall])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => river.material.dispose(), [river])
  return (
    <>
      <mesh geometry={geometry} material={material} visible={visible} frustumCulled renderOrder={0} />
      <mesh geometry={riverGeometry} material={river.material} visible={visible} frustumCulled renderOrder={0} />
      {fallGeometry && <mesh geometry={fallGeometry} material={fall.material} visible={visible} frustumCulled renderOrder={1} />}
    </>
  )
}
