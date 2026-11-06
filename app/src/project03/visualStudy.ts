import { useSyncExternalStore } from 'react'
import { Color } from 'three'
import { archShade } from './archGround.ts'

/**
 * Shadow Ecology 0.3 — VISUAL STUDY 01: Color × Light × Shade. Four palettes applied across terrain, Living Architecture, water and (subtly)
 * plants, compared live (Advanced settings → Visual experiments → Visual Study 01). Each palette is a set of tokens held in shared uniforms, read
 * by one finish that visualStyle.ts's applyStyleFinish adds to the world's materials; switching sets uniforms only (no rebuild, no recompile).
 * Original (uPalOn = 0) skips the finish: the world renders exactly as before.
 *
 * What the finish does (see paletteChunk):
 *   value      each surface keeps the light it actually received (sun, sky, fill, its own shading) and its procedural detail; only its albedo is
 *              mapped onto the palette (its own value, light to mid), with part of its original hue kept so materials stay apart
 *   sun        three states from the key light itself: lit (the sun reaches it), turned (faces away from the sun) and cast shadow (it faces the sun,
 *              something else blocks it). Lit is lifted a little, turned lowered, cast shadow lowered more and given the palette's shadow hue
 *              as a flat colour plane: the moving shadow
 *   shade      persistent ecological shade (archGround's raster: how much of the day the structures keep the sun off), its cell edges broken by
 *              noise: the ground there becomes another material (darker, damper, toward the palette's deep tone, mottled) and keeps its own
 *              hue in cast shadow; on the architecture only its downward and side faces take it
 *   water      the palette's water colour at the water's own luminance, so depth, shading and highlights all survive
 *   plants     a small hue shift toward the palette's foliage tone; creatures are unchanged
 */
export type StudyPalette = 'original' | 'mineral' | 'earth' | 'pale' | 'cobalt'

export const STUDY_PALETTES: { value: StudyPalette; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'mineral', label: 'Mineral Twilight' },
  { value: 'earth', label: 'Painted Earth' },
  { value: 'pale', label: 'Pale World / Deep Shade' },
  { value: 'cobalt', label: 'Cobalt / Olive / Rust' },
]

export const STUDY_NOTE: Record<StudyPalette, string> = {
  original: 'Visual Study 01 off: the world as it is.',
  mineral: 'Mineral Twilight: bone and stone in the light, violet cast shadow, mineral-teal water, deep slate shade.',
  earth: 'Painted Earth: warm parchment and terracotta, lilac cast shadow, dusty sage water, cool charcoal shade.',
  pale: 'Pale World / Deep Shade: a pale, high-key world; grey-green cast shadow; deep teal water; near-black blue shade.',
  cobalt: 'Cobalt / Olive / Rust (Style Guide A): light grey and olive ground, cobalt water, rust kept for the architecture’s stressed and aged tissue, olive-black shade.',
}

/** Roles: light (lit high value), mid (ground and stone), shadow (cast-shadow hue), water, deep (persistent shade), foliage, accent. */
type Tokens = { light: string; mid: string; shadow: string; water: string; deep: string; foliage: string; accent: string }
const TOKENS: Record<Exclude<StudyPalette, 'original'>, Tokens> = {
  // #D9C6AE #A49A91 #776D83 #477B81 #293C42
  mineral: { light: '#D9C6AE', mid: '#A49A91', shadow: '#776D83', water: '#477B81', deep: '#293C42', foliage: '#5f7f78', accent: '#477B81' },
  // #E5CDA8 #C58970 #A28CBB #718D79 #383E46
  earth: { light: '#E5CDA8', mid: '#C58970', shadow: '#A28CBB', water: '#718D79', deep: '#383E46', foliage: '#718D79', accent: '#C58970' },
  // #E5DFCE #BDB3A8 #A7B3AE #416C75 #202D37
  pale: { light: '#E5DFCE', mid: '#BDB3A8', shadow: '#A7B3AE', water: '#416C75', deep: '#202D37', foliage: '#8a9a90', accent: '#416C75' },
  // #E6E6E6 #74776B #0047AB #A3320B #171A19
  cobalt: { light: '#E6E6E6', mid: '#74776B', shadow: '#5a5d55', water: '#0047AB', deep: '#171A19', foliage: '#74776B', accent: '#A3320B' },
}

/** The finish's uniforms: shared objects, so every material that holds them sees a change at once. Colours are linear (three's Color). */
export const paletteUniforms = {
  uPalOn: { value: 0 },
  uPalLight: { value: new Color('#ffffff') },
  uPalMid: { value: new Color('#808080') },
  uPalShadow: { value: new Color('#808080') },
  uPalWater: { value: new Color('#808080') },
  uPalDeep: { value: new Color('#202020') },
  uPalFoliage: { value: new Color('#808080') },
  uPalAccent: { value: new Color('#808080') },
  uPalShade: archShade.texture,
}

let palette: StudyPalette = 'original'
const listeners = new Set<() => void>()

export function setStudyPalette(next: StudyPalette) {
  palette = next
  const u = paletteUniforms
  u.uPalOn.value = next === 'original' ? 0 : 1
  if (next !== 'original') {
    const t = TOKENS[next]
    u.uPalLight.value.set(t.light)
    u.uPalMid.value.set(t.mid)
    u.uPalShadow.value.set(t.shadow)
    u.uPalWater.value.set(t.water)
    u.uPalDeep.value.set(t.deep)
    u.uPalFoliage.value.set(t.foliage)
    u.uPalAccent.value.set(t.accent)
  }
  for (const l of listeners) l()
}

export function useStudyPalette(): StudyPalette {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => palette,
  )
}

export type PaletteKind = 'terrain' | 'architecture' | 'water' | 'plant' | 'other'

export const PALETTE_HEAD = /* glsl */ `
uniform float uPalOn;
uniform vec3 uPalLight;
uniform vec3 uPalMid;
uniform vec3 uPalShadow;
uniform vec3 uPalWater;
uniform vec3 uPalDeep;
uniform vec3 uPalFoliage;
uniform vec3 uPalAccent;
uniform sampler2D uPalShade;
const vec3 PAL_LUMA = vec3(0.2126, 0.7152, 0.0722);
// A colour's hue and saturation at another colour's value.
vec3 palAt(vec3 hue, float value) { return hue / max(1e-4, dot(hue, PAL_LUMA)) * value; }
`

/**
 * The finish for one kind of surface, inserted at the top of applyStyleFinish's block (after the material's lighting, before fog). `xz` is a
 * GLSL expression for the fragment's world x, z (null where there is none: plants, which are instanced). Needs styNoise (visualStyle's head).
 */
export function paletteChunk(kind: PaletteKind, xz: string | null): string {
  if (kind === 'other') return ''
  if (kind === 'plant') {
    return `
    if (uPalOn > 0.5) {
      float palL = dot(outgoingLight, PAL_LUMA);
      outgoingLight = mix(outgoingLight, palAt(uPalFoliage, palL), 0.18);
    }`
  }
  if (kind === 'water') {
    return `
    if (uPalOn > 0.5) {
      float palL = dot(outgoingLight, PAL_LUMA);
      float palSh = 0.0;
      ${xz ? `vec2 palU = (${xz} + 2048.0) / 4096.0;
      if (palU.x > 0.0 && palU.y > 0.0 && palU.x < 1.0 && palU.y < 1.0) palSh = smoothstep(0.08, 0.75, texture2D(uPalShade, palU).r);` : ''}
      // The palette's water at the water's own value (depth, shading and highlights kept); a shaded pool is a little darker and stiller.
      outgoingLight = mix(outgoingLight, palAt(uPalWater, palL), 0.88) * (1.0 - 0.22 * palSh);
    }`
  }
  const arch = kind === 'architecture'
  return `
    if (uPalOn > 0.5) {
      vec3 palAlb = max(diffuseColor.rgb, vec3(1e-4));
      float palAL = max(1e-3, dot(palAlb, PAL_LUMA));
      float palE = dot(outgoingLight, PAL_LUMA) / palAL;
      vec3 palWn = inverseTransformDirection(normalize(normal), viewMatrix);
      // The sun: which way the face turns, and whether the sun reaches it (the key light's own shadow).
      float palNdl = 0.0;
      #if NUM_DIR_LIGHTS > 0
        palNdl = dot(normalize(normal), directionalLights[0].direction);
      #endif
      float palVis = 1.0;
      #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
      {
        DirectionalLightShadow palDs = directionalLightShadows[0];
        palVis = getShadow(directionalShadowMap[0], palDs.shadowMapSize, palDs.shadowIntensity, palDs.shadowBias, palDs.shadowRadius, vDirectionalShadowCoord[0]);
      }
      #endif
      float palTurned = 1.0 - smoothstep(0.0, 0.12, palNdl);
      float palCast = (1.0 - palTurned) * (1.0 - palVis);
      float palLit = (1.0 - palTurned) * palVis;
      // Persistent shade, its raster cells broken by noise.
      float palSh = 0.0;
      vec2 palXZ = ${xz};
      vec2 palU = (palXZ + 2048.0) / 4096.0;
      if (palU.x > 0.0 && palU.y > 0.0 && palU.x < 1.0 && palU.y < 1.0) palSh = smoothstep(0.08, 0.75, texture2D(uPalShade, palU).r);
      palSh = clamp(palSh * (0.7 + 0.6 * styNoise(palXZ * 0.35)), 0.0, 1.0);
      ${arch ? '// On the architecture, only its downward and side faces (its undersides, walls in the undercroft) take the shade.\n      palSh *= 1.0 - smoothstep(-0.2, 0.45, palWn.y);' : ''}
      // The albedo on the palette: its own value from mid to light, part of its own hue kept so materials (rock, sediment, cover, tissue) stay apart.
      float palT = smoothstep(${arch ? '0.04, 0.45' : '0.02, 0.32'}, palAL);
      // (The surface keeps its own value: only its hue moves onto the palette, so the palette does not wash the world out.)
      vec3 pal = palAt(mix(${arch ? 'uPalMid, uPalLight, 0.35 + 0.65 * palT' : 'uPalMid, uPalLight, palT'}), palAL);
      pal = mix(pal, palAt(palAlb, dot(pal, PAL_LUMA)), ${arch ? '0.38' : '0.3'});
      ${arch ? '// Stressed, aged tissue (the warm or dark marks of the growth record) leans to the accent.\n      pal = mix(pal, palAt(uPalAccent, dot(pal, PAL_LUMA)), 0.35 * smoothstep(0.08, 0.3, palAlb.r - palAlb.b));' : ''}
      // Shade is a material of its own: darker, damper, toward the deep tone, mottled.
      float palMott = 0.82 + 0.36 * styNoise(palXZ * 1.7 + 3.0);
      pal = mix(pal, palAt(uPalDeep, dot(pal, PAL_LUMA) * 0.55) * palMott, palSh * ${arch ? '0.5' : '0.7'});
      // Light: clearer steps between lit, turned and cast; persistent shade lower still.
      float palEv = palE * (1.0 + 0.12 * palLit) * (1.0 - 0.14 * palTurned) * (1.0 - 0.24 * palCast) * (1.0 - 0.3 * palSh);
      vec3 palC = pal * palEv;
      // The moving shadow is a flat plane of the palette's shadow hue (less so where persistent shade gives it its own).
      palC = mix(palC, palAt(uPalShadow, dot(palC, PAL_LUMA)), (0.6 * palCast + 0.3 * palTurned) * (1.0 - 0.7 * palSh));
      outgoingLight = palC;
    }`
}
