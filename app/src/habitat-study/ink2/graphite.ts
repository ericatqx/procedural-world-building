import { CanvasTexture, Color, LinearFilter, LinearMipmapLinearFilter, MeshLambertMaterial, RepeatWrapping, Vector2, Vector3, type Side } from 'three'

/**
 * Style B v2 — The Charcoal Notebook: light, tone and the one colour.
 *
 * The tonal hierarchy, white paper first:
 *   W   white       lit surfaces, open sky and water, distance: the default and most of the frame
 *   G1  whisper     surfaces only just turned from the sun: a flat breath of grey, no strokes
 *   G2  graphite    form shadow (faces turned from the sun): single hatching that follows the form (along the strata on walls, down the fall line on
 *                   the ground) over a half-tone, so it reads as drawn, never as a grey fill
 *   G3  graphite    cast shadow (the sun blocked): hatching laid in the direction of the light, a second direction in its core, and a drawn edge where
 *                   the shadow begins; it moves and turns with the sun
 *   G4  charcoal    recesses (the undercroft, the ground under a roof): soft filled masses, from a baked occlusion
 *   K   near-black  the Dweller only
 * Distance gives everything back to the paper (the scene's fog is the horizon's grey).
 *
 * Cobalt is the shade habitat: where the structures keep the sun off for much of the day. It is laid as pigment (multiplied over the drawing), with a
 * watercolour's wandering edge, a darker pooled margin and granulation, and it does not move with the hour; the graphite of the moving shadow is
 * drawn over it.
 */
export const COBALT = '#1f4cff'

/** The hour's keys: how dark form and cast shadow are drawn, the shadow edge's strength, the cross-hatching, the exposure, the sky and the cobalt. */
type Key = { h: number; form: number; cast: number; edge: number; cross: number; expo: number; top: number; horizon: number; cobalt: number }
const KEYS: Key[] = [
  { h: 5.5, form: 0.7, cast: 0.62, edge: 0.3, cross: 0.1, expo: 0.9, top: 0.84, horizon: 0.9, cobalt: 1 },
  // Morning: high-key and airy, long pale shadows in single strokes, the habitat at its most saturated (dew).
  { h: 8, form: 0.84, cast: 0.7, edge: 0.45, cross: 0.05, expo: 1, top: 1, horizon: 0.95, cobalt: 1 },
  // Noon: the brightest picture; short, compact shadows at their darkest, cross-hatched.
  { h: 12.5, form: 0.8, cast: 0.36, edge: 1, cross: 0.9, expo: 1, top: 1, horizon: 0.97, cobalt: 0.85 },
  // Late afternoon (the hero): long shadows reaching across the ground, firm edges, the turned faces fully hatched.
  { h: 17, form: 0.66, cast: 0.44, edge: 0.85, cross: 0.6, expo: 1, top: 0.98, horizon: 0.9, cobalt: 0.92 },
  // Dusk: the whole picture a value down, the sky greying from the top, shadows merging into charcoal.
  { h: 20, form: 0.5, cast: 0.34, edge: 0.4, cross: 1, expo: 0.82, top: 0.6, horizon: 0.76, cobalt: 0.95 },
  { h: 21, form: 0.42, cast: 0.3, edge: 0.3, cross: 1, expo: 0.7, top: 0.42, horizon: 0.6, cobalt: 0.9 },
]

export function keyAt(hour: number): Key {
  let i = 0
  while (i < KEYS.length - 2 && hour > KEYS[i + 1]!.h) i += 1
  const a = KEYS[i]!
  const b = KEYS[i + 1]!
  const t = Math.min(1, Math.max(0, (hour - a.h) / (b.h - a.h)))
  const m = (k: keyof Key) => a[k] + (b[k] - a[k]) * t
  return { h: hour, form: m('form'), cast: m('cast'), edge: m('edge'), cross: m('cross'), expo: m('expo'), top: m('top'), horizon: m('horizon'), cobalt: m('cobalt') }
}

// ------------------------------------------------------------------------------------------------------------- the hatching

/**
 * A sheet of pencil strokes, drawn once: rows of tapered, slightly bowed strokes of uneven length and pressure, spaced by hand rather than ruled.
 * Strokes run along the sheet's u; the shader turns the sheet so they run where the form or the light asks. Mipmapped, so at a distance the
 * strokes average into their own tone instead of shimmering.
 */
function hatchSheet(spacing: number, seed: number): CanvasTexture {
  const S = 512
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, S, S)
  let r = seed * 9301 + 49297
  const rand = () => {
    r = (r * 9301 + 49297) % 233280
    return r / 233280
  }
  ctx.lineCap = 'round'
  for (let y = spacing / 2; y < S; y += spacing) {
    let x = rand() * 40
    while (x < S + 40) {
      const len = 50 + rand() * 170
      const yy = y + (rand() - 0.5) * spacing * 0.45
      const bow = (rand() - 0.5) * 3
      const w = 1.3 + rand() * 1.1
      const a = 0.55 + rand() * 0.45
      // Each stroke three times, wrapped, so the sheet tiles; drawn as tapering pieces (heavier in the middle, light at the ends).
      for (const ox of [-S, 0, S]) {
        for (let k = 0; k < 4; k += 1) {
          const t0 = k / 4
          const t1 = (k + 1) / 4
          const press = Math.sin(((t0 + t1) / 2) * Math.PI)
          ctx.strokeStyle = `rgba(255,255,255,${a * (0.5 + 0.5 * press)})`
          ctx.lineWidth = w * (0.55 + 0.45 * press)
          ctx.beginPath()
          ctx.moveTo(ox + x + len * t0, yy + bow * Math.sin(t0 * Math.PI))
          ctx.lineTo(ox + x + len * t1, yy + bow * Math.sin(t1 * Math.PI))
          ctx.stroke()
        }
      }
      x += len + 4 + rand() * 26
    }
  }
  const t = new CanvasTexture(canvas)
  t.wrapS = RepeatWrapping
  t.wrapT = RepeatWrapping
  t.magFilter = LinearFilter
  t.minFilter = LinearMipmapLinearFilter
  t.anisotropy = 8
  t.generateMipmaps = true
  return t
}

let sheets: { light: CanvasTexture; dense: CanvasTexture } | null = null
const sheetsOnce = () => (sheets ??= { light: hatchSheet(16, 3), dense: hatchSheet(8, 7) })

/** Shared by every graphite material: the sun (in view space for the shading, in world xz for the cast-shadow strokes) and the hour's keys. */
export const graphiteUniforms = {
  uSunView: { value: new Vector3(0, 1, 0) },
  uSunUp: { value: 0.5 },
  uSunAz: { value: new Vector2(1, 0) },
  uForm: { value: 0.66 },
  uCast: { value: 0.44 },
  uEdge: { value: 0.85 },
  uCross: { value: 0.6 },
  uExpo: { value: 1 },
  uCobaltK: { value: 0.92 },
  uCobalt: { value: new Color(COBALT) },
  uHatchLight: { value: null as CanvasTexture | null },
  uHatchDense: { value: null as CanvasTexture | null },
}

const HEAD = /* glsl */ `
varying vec3 vG2W;
#ifdef G2_AO
varying float vG2Ao;
#endif
#ifdef G2_HAB
varying float vG2Hab;
#endif
`
const VERT_HEAD = /* glsl */ `
#ifdef G2_AO
attribute float ao;
#endif
#ifdef G2_HAB
attribute float habitat;
#endif
`
const VERT = /* glsl */ `
  {
    vec4 g2 = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
    g2 = instanceMatrix * g2;
    #endif
    vG2W = (modelMatrix * g2).xyz;
    #ifdef G2_AO
    vG2Ao = ao;
    #endif
    #ifdef G2_HAB
    vG2Hab = habitat;
    #endif
  }
`
const FRAG_HEAD = /* glsl */ `
uniform vec3 uSunView;
uniform float uSunUp;
uniform vec2 uSunAz;
uniform float uForm;
uniform float uCast;
uniform float uEdge;
uniform float uCross;
uniform float uExpo;
uniform float uCobaltK;
uniform vec3 uCobalt;
uniform sampler2D uHatchLight;
uniform sampler2D uHatchDense;
float g2Hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float g2Noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(g2Hash(i), g2Hash(i + vec2(1.0, 0.0)), f.x), mix(g2Hash(i + vec2(0.0, 1.0)), g2Hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// The stroke sheet turned so its strokes run along d (world metres in, about 0.4 m between light strokes).
float g2Hatch(sampler2D t, vec2 p, vec2 d) {
  d = normalize(d);
  return texture2D(t, vec2(dot(p, d), dot(p, vec2(-d.y, d.x))) * 0.075).r;
}
`
const FRAG = /* glsl */ `
{
  float lum = max(0.002, dot(diffuseColor.rgb, vec3(0.3333)));
  float lit = clamp(dot(reflectedLight.directDiffuse, vec3(0.3333)) / lum, 0.0, 1.0);
  float ndl = dot(normal, uSunView);
  // How much of the sun reaches the surface for its angle: 1 lit, 0 in cast shadow.
  float vis = ndl > 0.03 ? clamp(lit / ndl, 0.0, 1.0) : 1.0;
  // The surface's light relative to flat ground at this hour, so a low sun does not grey the whole page.
  float rel = ndl / max(0.2, uSunUp);
  vec3 wn = inverseTransformDirection(normal, viewMatrix);
  bool wall = abs(wn.y) < 0.6;
  vec2 across = normalize(vec2(-wn.z, wn.x) + vec2(1e-4));
  // The plane strokes are laid in: on a wall, (along the wall, up); on the ground, the ground itself.
  vec2 P = wall ? vec2(dot(vG2W.xz, across), vG2W.y) : vG2W.xz;
  vec2 fall = length(wn.xz) > 0.08 ? normalize(wn.xz) : vec2(0.7071, 0.7071);

  float v = 1.0;
  // G1: just turned from the sun, a flat breath of grey.
  v = mix(v, 0.94, 1.0 - smoothstep(0.32, 0.55, rel));
  // G2: form shadow, hatched along the form (the strata on walls, the fall line on slopes).
  float turned = 1.0 - smoothstep(0.08, 0.24, rel);
  float h1 = g2Hatch(uHatchLight, P, wall ? vec2(1.0, 0.0) : fall);
  float formTone = mix(mix(1.0, uForm, 0.45), uForm * 0.72, h1);
  v = mix(v, formTone, turned);
  // G3: cast shadow, hatched in the light's direction, cross-hatched in its core.
  float castAmt = (1.0 - smoothstep(0.3, 0.7, vis)) * smoothstep(0.0, 0.06, ndl);
  vec2 castDir = wall ? vec2(0.7071, -0.7071) : uSunAz;
  float h2 = g2Hatch(uHatchDense, P, castDir);
  float hx = g2Hatch(uHatchLight, P + 3.7, vec2(-castDir.y, castDir.x) + castDir * 0.6) * uCross;
  float castTone = mix(mix(1.0, uCast, 0.55), uCast * 0.6, max(h2, hx));
  v = min(v, mix(1.0, castTone, castAmt));
  // The shadow's edge, drawn: where the sun's reach changes, a broken pencil line.
  float e = fwidth(vis);
  float edge = smoothstep(0.06, 0.28, e) * smoothstep(0.25, 0.6, g2Noise(vG2W.xz * 0.6 + vG2W.y));
  v *= 1.0 - uEdge * 0.6 * edge;
  #ifdef G2_AO
  // G4: recesses, soft charcoal masses (a little of the hatching shows through, so the mass is still drawn).
  float ao = smoothstep(0.12, 0.62, vG2Ao);
  // A ceiling is never lit from above: what faces down is enclosed the more for it.
  ao = max(ao, smoothstep(-0.25, -0.8, wn.y) * smoothstep(0.3, 0.6, vG2Ao));
  v = min(v, mix(1.0, 0.2 + 0.12 * h1, ao));
  #endif
  v *= uExpo;
  vec3 c = vec3(v);
  #ifdef G2_HAB
  {
    // Cobalt, as pigment on the drawing: a wandering edge, a darker pooled margin, granulation in the body.
    float hab = vG2Hab + (g2Noise(vG2W.xz * 0.06) - 0.5) * 0.22 + (g2Noise(vG2W.xz * 0.21) - 0.5) * 0.1 + (g2Noise(vG2W.xz * 0.8) - 0.5) * 0.03;
    float body = smoothstep(0.2, 0.26, hab);
    float pool = body * (1.0 - smoothstep(0.3, 0.42, hab));
    float gran = g2Noise(vG2W.xz * 2.7) * 0.6 + g2Noise(vG2W.xz * 7.3) * 0.4;
    float a = clamp((0.62 + 0.32 * pool + 0.22 * (gran - 0.5)) * body * uCobaltK, 0.0, 1.0);
    c *= mix(vec3(1.0), uCobalt, a);
  }
  #endif
  outgoingLight = c;
}
`

/**
 * A graphite surface: the drawing's material for every solid thing. `ao` reads a baked occlusion attribute (the charcoal of recesses), `habitat`
 * the shade habitat attribute (the cobalt). Pushed back in depth a little, so the lines drawn on it always win.
 */
export function graphiteMaterial({ ao = false, habitat = false, side }: { ao?: boolean; habitat?: boolean; side?: Side } = {}) {
  const s = sheetsOnce()
  graphiteUniforms.uHatchLight.value = s.light
  graphiteUniforms.uHatchDense.value = s.dense
  const m = new MeshLambertMaterial({ color: '#ffffff', polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2, ...(side !== undefined ? { side } : {}) })
  m.defines = { ...(ao ? { G2_AO: '' } : {}), ...(habitat ? { G2_HAB: '' } : {}) }
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, graphiteUniforms)
    shader.vertexShader = shader.vertexShader.replace('void main() {', `${HEAD}${VERT_HEAD}void main() {`).replace('#include <project_vertex>', `#include <project_vertex>\n${VERT}`)
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `${HEAD}${FRAG_HEAD}void main() {`).replace('#include <opaque_fragment>', `${FRAG}\n#include <opaque_fragment>`)
  }
  m.customProgramCacheKey = () => `graphite-${ao ? 'a' : ''}${habitat ? 'h' : ''}`
  return m
}
