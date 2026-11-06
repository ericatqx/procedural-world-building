import { useSyncExternalStore } from 'react'
import { PALETTE_HEAD, paletteChunk, paletteUniforms, type PaletteKind } from './visualStudy.ts'
import { illustrationChunk, illustrationUniforms, STUDY02_HEAD, study02Chunk, study02Uniforms } from './visualStudy02.ts'
import { MONO_HEAD, monoChunk, monoUniforms } from './visualStudy03.ts'

/**
 * Shadow Ecology 0.3 — VISUAL EXPERIMENTS: four looks for the same world, compared live. Each is a set of a few numbers that the terrain's and the plants'
 * existing shaders read as uniforms (vegGround.ts, WorldPlants.tsx), so switching is instant: no geometry, placement, ecology, camera or time changes, and
 * Original (all zero) is exactly the world as it was.
 *
 *   grade    Graphic Contrast: richer woodland greens, a brighter, warmer meadow, warmer and lighter mineral rock, deeper moss; plants a little richer
 *   glow     Shadow Glow: shade-loving plants (ferns, ground mats, the hanging curtain) carry a soft cyan-teal light of their own that shows most where
 *            they are dark, in shadow, and barely at all in the sun
 *   shade    shadow tint: ground in shadow is cooled toward deep blue-teal, so shadow reads as a place of its own rather than only a darker region
 */
export type VisualPreset = 'original' | 'contrast' | 'glow' | 'hybrid' | 'sculpt' | 'ink'

export const VISUAL_PRESETS: { value: VisualPreset; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'contrast', label: 'Contrast' },
  { value: 'glow', label: 'Glow' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'sculpt', label: 'Sculpt' },
  { value: 'ink', label: 'Ink' },
]

type Setting = { grade: number; glow: number; shade: number; simplify?: number; bands?: number; mono?: number; ink?: number; rim?: number; lift?: number; key?: number; fill?: number; fog?: number; fogNeutral?: number; mist?: number }
const SETTINGS: Record<VisualPreset, Setting> = {
  original: { grade: 0, glow: 0, shade: 0 },
  contrast: { grade: 1, glow: 0, shade: 0 },
  glow: { grade: 0, glow: 1, shade: 0.7 },
  hybrid: { grade: 1, glow: 0.8, shade: 0.6 },
  // A — Sculptural Illustration: simplification first (large calm regions), soft bands, a restrained palette, the architecture lifted clear of the ground.
  sculpt: { grade: 0.5, glow: 0, shade: 0, simplify: 1, bands: 0.4, mono: 0.18, lift: 1, key: 1.06, fill: 0.92, mist: 0.7 },
  // B — Monochrome Ink: INSIDE's greyscale, depth and light; drawn in ink where the light fails, with hand-drawn contours on the large forms.
  ink: { grade: 0, glow: 0, shade: 0, simplify: 0.6, bands: 0.2, mono: 1, ink: 1, rim: 1, key: 1.15, fill: 0.72, fog: 0.75, fogNeutral: 1, mist: 1.7 },
}

/** The shaders' uniforms: shared objects, so every material that holds them sees a change at once. */
export const visualUniforms = { uVisGrade: { value: 0 }, uVisGlow: { value: 0 }, uVisShade: { value: 0 } }

/** The two illustrative styles' uniforms (all at rest in Original: zero, and the mist factor 1). */
export const styleUniforms = { uStySimplify: { value: 0 }, uStyBands: { value: 0 }, uStyMono: { value: 0 }, uStyInk: { value: 0 }, uStyRim: { value: 0 }, uStyLift: { value: 0 }, uStyMist: { value: 1 } }

/** Factors on what the sky writes each frame (Sky.tsx) and the orbiting views' haze (LandscapeView.tsx): 1 and 0 leave them as they were. */
export const styleScalars = { key: 1, fill: 1, fog: 1, fogNeutral: 0 }

let preset: VisualPreset = 'original'
const listeners = new Set<() => void>()

export function setVisualPreset(next: VisualPreset) {
  preset = next
  const s = SETTINGS[next]
  visualUniforms.uVisGrade.value = s.grade
  visualUniforms.uVisGlow.value = s.glow
  visualUniforms.uVisShade.value = s.shade
  styleUniforms.uStySimplify.value = s.simplify ?? 0
  styleUniforms.uStyBands.value = s.bands ?? 0
  styleUniforms.uStyMono.value = s.mono ?? 0
  styleUniforms.uStyInk.value = s.ink ?? 0
  styleUniforms.uStyRim.value = s.rim ?? 0
  styleUniforms.uStyLift.value = s.lift ?? 0
  styleUniforms.uStyMist.value = s.mist ?? 1
  styleScalars.key = s.key ?? 1
  styleScalars.fill = s.fill ?? 1
  styleScalars.fog = s.fog ?? 1
  styleScalars.fogNeutral = s.fogNeutral ?? 0
  for (const l of listeners) l()
}

export function useVisualPreset(): VisualPreset {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => preset,
  )
}

/** For a plant material: the Contrast grading of its colour, and (for the shade-loving plants) the Glow. */
export function applyPlantStyle(shader: Shader, shadeLover: boolean) {
  Object.assign(shader.uniforms, visualUniforms, styleUniforms)
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'uniform float uVisGrade;\nuniform float uVisGlow;\nuniform float uStySimplify;\nvoid main() {')
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        // Contrast: a little more colour and a greener, deeper foliage, its darks kept dark (not simply brighter).
        vec3 c = diffuseColor.rgb;
        float l = dot(c, vec3(0.3, 0.59, 0.11));
        vec3 rich = mix(vec3(l), c, 1.3) * vec3(0.9, 1.07, 0.86);
        rich *= mix(0.88, 1.0, smoothstep(0.08, 0.3, l));
        diffuseColor.rgb = mix(c, max(rich, vec3(0.0)), uVisGrade);
        // Simplify: a plant's leaves drawn toward one even value, a mass rather than a speckle.
        float sl = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        diffuseColor.rgb *= mix(1.0, mix(sl, 0.3, 0.65) / max(sl, 0.02), uStySimplify);
      }`,
    )
  if (!shadeLover) {
    applyStyleFinish(shader, 'plant')
    return
  }
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <opaque_fragment>',
    `{
        // Glow: a soft cyan-teal light of the plant's own, strongest where it is dark (in a structure's or the land's shadow), faint in the sun.
        float visDark = 1.0 - smoothstep(0.04, 0.32, dot(outgoingLight, vec3(0.3333)));
        outgoingLight += vec3(0.07, 0.24, 0.22) * uVisGlow * (0.12 + 0.88 * visDark) * (0.6 + 0.8 * diffuseColor.g);
      }
      #include <opaque_fragment>`,
  )
  applyStyleFinish(shader, 'plant')
}

// ------------------------------------------------------------------------------------------------------------- the illustrative styles

type Shader = { uniforms: Record<string, { value: unknown }>; fragmentShader: string; vertexShader: string }
export type StyleKind = 'terrain' | 'architecture' | 'plant' | 'creature' | 'water' | 'shell'

/** How much of each treatment a kind of surface takes: ink strokes, hand-drawn contour, lift (Sculpt's light architecture). */
const KIND: Record<StyleKind, { ink: number; rim: number; lift: number; world: 'xz' | 'vary' | 'none' }> = {
  terrain: { ink: 1, rim: 0.45, lift: 0, world: 'xz' },
  architecture: { ink: 0.9, rim: 1, lift: 1, world: 'vary' },
  plant: { ink: 0, rim: 0, lift: 0, world: 'none' },
  creature: { ink: 0, rim: 0.8, lift: 0, world: 'none' },
  // (Water carries its world position for Visual Study 01's persistent shade; the presets do not read it.)
  water: { ink: 0, rim: 0, lift: 0, world: 'vary' },
  shell: { ink: 0, rim: 0, lift: 0, world: 'none' },
}

const STYLE_HEAD = /* glsl */ `
uniform float uStyBands;
uniform float uStyMono;
uniform float uStyInk;
uniform float uStyRim;
uniform float uStyLift;
float styHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float styNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(styHash(i), styHash(i + vec2(1.0, 0.0)), f.x), mix(styHash(i + vec2(0.0, 1.0)), styHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// One family of hand-drawn strokes on a world-space plane: lines across dir that wander (low-frequency noise), vary in weight and break into dashes. Where
// they would be finer than a pixel or two they fade to their own average tone, so the drawing keeps its value at a distance and never shimmers.
float styStroke(vec2 p, vec2 dir, float freq) {
  vec2 n = vec2(-dir.y, dir.x);
  float phase = dot(p, n) * freq + (styNoise(p * 0.07) - 0.5) * 1.8 + (styNoise(p * 0.29 + 7.0) - 0.5) * 0.4;
  float aa = fwidth(phase);
  float w = 0.11 + 0.12 * styNoise(p * 0.5 + 3.0);
  float d = abs(fract(phase) - 0.5);
  float line = 1.0 - smoothstep(w - aa, w + aa, d);
  float dash = smoothstep(0.3, 0.5, styNoise(vec2(dot(p, dir) * freq * 0.22, floor(phase) * 1.7)));
  return mix(line * dash, w * 1.1, smoothstep(0.2, 0.55, aa));
}
// Strokes whose spacing follows the pixel size by octaves (blended), so a drawn surface keeps a pen-like density from the ground and from above.
float styStrokes(vec2 p, vec2 dir) {
  float k = log2(max(1e-4, length(fwidth(p))) * 9.0);
  float o = floor(k);
  float f = exp2(-o);
  return mix(styStroke(p, dir, f), styStroke(p, dir, f * 0.5), fract(k));
}
`

/** Visual Study 01 (visualStudy.ts): which treatment each kind takes, and where its world x, z comes from. */
const PALETTE: Record<StyleKind, { kind: PaletteKind; xz: string | null }> = {
  terrain: { kind: 'terrain', xz: 'vVegXZ' },
  architecture: { kind: 'architecture', xz: 'vStyWorld.xz' },
  water: { kind: 'water', xz: 'vStyWorld.xz' },
  plant: { kind: 'plant', xz: null },
  creature: { kind: 'other', xz: null },
  shell: { kind: 'other', xz: null },
}

function styleFinish(kind: StyleKind, studyOnly = false, waterDepth = false): string {
  const k = KIND[kind]
  const world = k.world === 'xz' ? 'vec3(vVegXZ.x, 0.0, vVegXZ.y)' : k.world === 'vary' ? 'vStyWorld' : 'vec3(0.0)'
  const strokes = k.ink > 0
    ? `
    if (uStyInk > 0.0) {
      // INK, where the light fails: the sun this surface receives (the direct light, shadows included) decides how much is drawn. Lit faces stay clean,
      // half-light takes single strokes, deep shadow cross-strokes and a wash.
      float styLit = clamp(dot(reflectedLight.directDiffuse, vec3(0.3333)) / max(0.02, dot(diffuseColor.rgb, vec3(0.3333))), 0.0, 1.0);
      float styDens = 1.0 - smoothstep(0.12, 0.95, styLit);
      vec3 styP = ${world};
      vec3 styN = inverseTransformDirection(normalize(normal), viewMatrix);
      vec2 styPlane;
      vec2 styDir;
      ${kind === 'terrain'
        ? `styPlane = styP.xz;
      // On the land the strokes run down the slope (hachures); on the flat, a constant diagonal.
      float styS = length(styN.xz);
      styDir = normalize(mix(vec2(0.7071, 0.7071), styN.xz / max(styS, 1e-4), smoothstep(0.08, 0.25, styS)));`
        : `vec3 styA = abs(styN);
      // On the stone, the plane the face looks along (its dominant axis): the strokes stay on the surface as the camera moves.
      styPlane = styA.x > styA.y && styA.x > styA.z ? styP.zy : styA.y > styA.z ? styP.xz : styP.xy;
      styDir = vec2(0.8, 0.6);`}
      float styInkC = styStrokes(styPlane * 1.6, styDir) * smoothstep(0.02, 0.3, styDens);
      styInkC = max(styInkC, styStrokes(styPlane * 1.6 + 13.0, vec2(-styDir.y, styDir.x)) * smoothstep(0.55, 0.95, styDens));
      outgoingLight *= 1.0 - uStyInk * ${k.ink.toFixed(2)} * (0.8 * min(styInkC, 1.0) + 0.18 * styDens);
    }`
    : ''
  const rim = k.rim > 0
    ? `
    if (uStyRim > 0.0) {
      // A hand-drawn contour where the form turns away: its weight wobbles along the line like a pen's.
      float styNdv = abs(dot(normalize(normal), normalize(vViewPosition)));
      float styTh = ${(0.22 * k.rim).toFixed(3)}${k.world !== 'none' ? ` * (0.7 + 0.6 * styNoise(${world}.xz * 0.35 + ${world}.y * 0.2))` : ''};
      float styAa = fwidth(styNdv);
      float styRimC = 1.0 - smoothstep(styTh - styAa, styTh + styAa, styNdv);
      outgoingLight *= 1.0 - uStyRim * 0.85 * styRimC;
    }`
    : ''
  // Visual Study 02 (visualStudy02.ts): terrain and architecture only.
  const ink = study02Chunk(kind === 'terrain' || kind === 'architecture' ? kind : 'other', world)
  // …and its illustration modes, on every kind.
  const il = illustrationChunk(kind, k.world === 'none' ? null : world) + monoChunk(kind, k.world === 'none' ? null : world, waterDepth)
  if (studyOnly) return `{${il}
  }
  `
  return `{${paletteChunk(PALETTE[kind].kind, PALETTE[kind].xz)}${ink}${il}
    float styLum = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
    ${k.lift > 0 ? `outgoingLight *= 1.0 + 0.12 * uStyLift; styLum *= 1.0 + 0.12 * uStyLift;` : ''}
    if (uStyBands > 0.0) {
      // Soft bands of light: the value drawn toward three broad steps, the colour kept.
      float styB = styLum * 3.0;
      float styQ = (floor(styB) + smoothstep(0.3, 0.7, fract(styB))) / 3.0;
      float styL = mix(styLum, styQ, uStyBands);
      outgoingLight *= styL / max(styLum, 1e-4);
      styLum = styL;
    }
    if (uStyMono > 0.0) {
      // Monochrome: the value with a little more contrast than the colour world had (deeper shade, held highs), on a faintly warm paper grey.
      float styT = pow(clamp(styLum, 0.0, 4.0), 1.15) * 1.1;
      outgoingLight = mix(outgoingLight, vec3(styT) * vec3(1.0, 0.985, 0.95)${kind === 'water' ? ' * 0.45' : ''}, uStyMono);
    }${strokes}${rim}
  }
  `
}

/**
 * Adds the illustrative styles to a material's shader, just before its opaque output (after its lighting and its own patches, before fog). Every anchor is
 * checked first: if one is missing, the material is left exactly as it was and the miss is reported, rather than compiling a different shader.
 */
/** `studyOnly`: only Visual Study 02's illustration modes (for a material the presets never styled, so they still leave it as it was). */
export function applyStyleFinish(shader: Shader, kind: StyleKind, studyOnly = false) {
  const vary = KIND[kind].world === 'vary'
  const need: [string, string][] = [['fragment', 'void main() {'], ['fragment', '#include <opaque_fragment>']]
  if (vary) need.push(['vertex', 'void main() {'], ['vertex', '#include <worldpos_vertex>'])
  for (const [stage, anchor] of need) {
    if (!(stage === 'fragment' ? shader.fragmentShader : shader.vertexShader).includes(anchor)) {
      console.error(`[visual style] ${kind}: anchor "${anchor}" not found; this material is left unstyled`)
      return
    }
  }
  Object.assign(shader.uniforms, styleUniforms, paletteUniforms, study02Uniforms, illustrationUniforms, monoUniforms)
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', `${STYLE_HEAD}${PALETTE_HEAD}${STUDY02_HEAD}${MONO_HEAD}${vary ? 'varying vec3 vStyWorld;\n' : ''}void main() {`)
    .replace('#include <opaque_fragment>', `${styleFinish(kind, studyOnly, shader.fragmentShader.includes('varying float vWaterDepth'))}\n#include <opaque_fragment>`)
  if (vary) {
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vStyWorld;\nvoid main() {')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vStyWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
  }
}
