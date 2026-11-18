import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, Matrix4, type Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from 'three'
import { environment } from './environment.ts'
import { studySky } from './studySky.ts'
import { paintScene } from './visualStudyPainting.ts'
import { worldsScene } from './visualStudyWorlds.ts'

/**
 * Shadow Ecology 0.3 - the background of the World Visual Studies that have one: a backdrop drawn behind everything (a screen-filling quad that works out
 * the direction each pixel looks in). Deliberately restrained: the island carries each look, the background frames it. From Overview the camera looks
 * down, so most of what is seen lies below the horizon; every gradient runs continuously through it (no seam at the horizon) and nothing in it repeats.
 *
 *   Atmospheric Painting            one continuous gradient through the hour's colours, a single soft layer of luminous air just under the horizon, the
 *                                   sun's glow; by night, stars above the horizon only
 *   Illustrated World - Stylized    spacious bands of the palette's colour, softly stepped, two faint veils of lighter air beneath the island, and a flat
 *                                   graphic sun with a halo and two fine rings, drawn once, where the sun is
 *   Graphic Diorama                 a plain dark ground with a gentle vignette, darker at night, and a pale ivory sun disc where the sun is: the model on its
 *                                   table
 *   Graphic Diorama - Black Stage   a gallery black: near-pure black with a barely perceptible lift behind the island; no sun, nothing else
 * (The Illustrated Atlas uses the black stage, as Clear Ink does: nothing is drawn.) Colours come from studySky.ts, set each frame by Sky.tsx.
 */
const VERT = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

const FRAG = /* glsl */ `
uniform float uMode;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uSunDir;
uniform vec3 uZen;
uniform vec3 uHor;
uniform vec3 uBelow;
uniform vec3 uCloud;
uniform vec3 uKey;
uniform float uNight;
varying vec2 vNdc;
float skHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Stars on the sphere above the horizon: sparse, one point per cell, sized in pixels.
float skStars(vec3 d) {
  vec2 uv = vec2(d.x / (1.0 + d.y), d.z / (1.0 + d.y)) * 70.0;
  vec2 c = floor(uv);
  vec2 o = vec2(skHash(c + 3.1), skHash(c + 7.7)) * 0.7 + 0.15;
  float r = length(fract(uv) - o) / max(fwidth(uv.x), 1e-4);
  return step(0.93, skHash(c)) * (1.0 - smoothstep(0.6, 1.6, r)) * (0.4 + 0.6 * skHash(c + 1.3));
}
// A soft step: a gradient laid in a few broad bands with wide, gentle transitions.
float skBands(float t, float n) { float v = t * n; return (floor(v) + smoothstep(0.2, 0.8, fract(v))) / n; }
void main() {
  vec4 v = uInvProj * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize((uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz);
  float el = d.y;
  float sunD = dot(d, normalize(uSunDir));
  vec3 col;
  if (uMode < 2.5) {
    // ATMOSPHERIC PAINTING: one continuous gradient, zenith to horizon to the deep below (both halves meet at the horizon colour: no seam).
    vec3 above = mix(uHor, uZen, pow(clamp(el, 0.0, 1.0), 0.45));
    vec3 under = mix(uHor, uBelow, smoothstep(0.0, 0.7, -el));
    under = mix(under, uBelow * 0.7, smoothstep(0.6, 1.0, -el));
    col = el >= 0.0 ? above : under;
    // A single soft layer of luminous air a little under the horizon: depth, not cloud.
    float layer = exp(-pow((el + 0.16) / 0.11, 2.0));
    col = mix(col, uCloud, layer * 0.22 * (1.0 - 0.5 * uNight));
    // The sun's glow (the moon's, faint, at night) and, only above the horizon, its small disc.
    col += uKey * (pow(max(sunD, 0.0), 12.0) * 0.4 + pow(max(sunD, 0.0), 80.0) * 0.35) * (1.0 - 0.7 * uNight);
    col = mix(col, mix(vec3(1.0, 0.96, 0.86), vec3(0.86, 0.9, 0.98), uNight), smoothstep(0.99955, 0.9997, sunD) * step(0.0, el));
    col += vec3(0.85, 0.9, 1.0) * skStars(d) * uNight * smoothstep(0.02, 0.1, el) * 0.8;
  } else if (uMode < 3.5) {
    // ILLUSTRATED WORLD - STYLIZED: spacious, softly banded gradient through the palette, two faint veils beneath, a flat graphic sun.
    vec3 above = mix(uHor, uZen, skBands(clamp(el / 0.8, 0.0, 1.0), 3.0));
    vec3 under = mix(uHor, uBelow, skBands(clamp(-el / 0.85, 0.0, 1.0), 3.0));
    col = el >= 0.0 ? above : under;
    float veil1 = smoothstep(0.03, 0.0, abs(-el - 0.2) - 0.05);
    float veil2 = smoothstep(0.05, 0.0, abs(-el - 0.5) - 0.07);
    col = mix(col, mix(col, uCloud, 0.5), veil1 * 0.35 + veil2 * 0.2);
    // The sun, once, where it is: a flat disc with a soft halo and two fine concentric rings (the moon's, paler, by night).
    vec3 sd = normalize(uSunDir);
    float dUp = acos(clamp(dot(d, sd), -1.0, 1.0));
    float aa = max(fwidth(dUp), 1e-4);
    vec3 sunC = mix(vec3(1.0, 0.95, 0.85), vec3(0.88, 0.84, 0.92), uNight);
    float disc = 1.0 - smoothstep(0.06 - aa, 0.06 + aa, dUp);
    float halo = (1.0 - smoothstep(0.06, 0.2, dUp)) * 0.22;
    float rings = (1.0 - smoothstep(0.5, 1.4, abs(dUp - 0.11) / aa)) * 0.32 + (1.0 - smoothstep(0.5, 1.4, abs(dUp - 0.16) / aa)) * 0.18;
    float upper = step(0.0, el);
    col = mix(col, sunC, max(disc, halo) * upper);
    col = mix(col, sunC, rings * upper);
  } else if (uMode > 4.5) {
    // GRAPHIC DIORAMA - BLACK STAGE: a gallery's black. Almost pure black, with only a barely perceptible lift behind the middle of the frame and a
    // floor-like darkening toward the bottom, so the space has depth without reading as grey or as a gradient.
    float r = length(vNdc * vec2(0.9, 1.0));
    col = mix(vec3(0.0042, 0.0042, 0.0046), vec3(0.0006), smoothstep(0.15, 1.25, r));
    col *= 1.0 - 0.35 * smoothstep(0.0, -1.0, vNdc.y);
    // (Round 07: the faint warm glow on the sun's side, added in Round 04, is gone: it read as a halo. The light's direction is shown by the land and,
    // when wanted, by the panel's sun indicator.)
  } else {
    // GRAPHIC DIORAMA: a plain dark ground, lighter toward the middle of the frame, darker at night.
    float r = length(vNdc * vec2(1.0, 0.85));
    col = mix(vec3(0.0105, 0.0175, 0.0195), vec3(0.0045, 0.0065, 0.0072), smoothstep(0.2, 1.3, r));
    col *= 1.0 - 0.55 * uNight;
    // The sun, where the world's sun is, when it is up: a simple pale ivory disc with a faint glow. Nothing else.
    vec3 sd = normalize(uSunDir);
    float sa = acos(clamp(dot(d, sd), -1.0, 1.0));
    float saa = max(fwidth(sa), 1e-4);
    float up = smoothstep(0.0, 0.03, sd.y) * (1.0 - uNight);
    col = mix(col, vec3(0.92, 0.87, 0.76), (1.0 - smoothstep(0.045 - saa, 0.045 + saa, sa)) * up);
    col += vec3(0.25, 0.2, 0.14) * (1.0 - smoothstep(0.045, 0.3, sa)) * 0.15 * up;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`

export function StudySky() {
  const mesh = useRef<Mesh>(null)
  const geometry = useMemo(() => new PlaneGeometry(2, 2), [])
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
        uniforms: {
          uMode: { value: 2 },
          uInvProj: { value: new Matrix4() },
          uCamWorld: { value: new Matrix4() },
          uSunDir: { value: new Vector3(0, 1, 0) },
          uZen: { value: new Color() },
          uHor: { value: new Color() },
          uBelow: { value: new Color() },
          uCloud: { value: new Color() },
          uKey: { value: new Color() },
          uNight: { value: 0 },
        },
      }),
    [],
  )
  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])
  useFrame(({ camera }) => {
    const m = mesh.current
    if (!m) return
    const mode = paintScene.on ? 2 : worldsScene.stylized ? 3 : worldsScene.diorama ? 4 : worldsScene.dioramaBlack ? 5 : 0
    m.visible = mode > 0
    if (!mode) return
    const u = material.uniforms
    u.uMode!.value = mode
    ;(u.uInvProj!.value as Matrix4).copy(camera.projectionMatrixInverse)
    ;(u.uCamWorld!.value as Matrix4).copy(camera.matrixWorld)
    if (mode >= 4) {
      u.uNight!.value = 1 - environment.state.sun.daylight
      const [sx, sy, sz] = environment.state.sun.direction
      ;(u.uSunDir!.value as Vector3).set(sx, sy, sz)
      return
    }
    const s = mode === 2 ? studySky.paint : studySky.stylized
    const [x, y, z] = environment.state.sun.direction
    // By night the disc is the moon, high in the south-west (the sun's own direction is held just above the horizon after it sets).
    if (s.night > 0.5) (u.uSunDir!.value as Vector3).set(-0.35, 0.62, 0.7).normalize()
    else (u.uSunDir!.value as Vector3).set(x, y, z)
    ;(u.uZen!.value as Color).copy(s.zenith)
    ;(u.uHor!.value as Color).copy(s.horizon)
    ;(u.uBelow!.value as Color).copy(s.below)
    ;(u.uCloud!.value as Color).copy(s.cloud)
    ;(u.uKey!.value as Color).copy(s.key)
    u.uNight!.value = s.night
  })
  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} renderOrder={-1000} visible={false} />
}
