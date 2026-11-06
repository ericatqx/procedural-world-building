import { useSyncExternalStore } from 'react'
import { Color, Vector3 } from 'three'
import { archShade } from './archGround.ts'
import { monoUniforms } from './visualStudy03.ts'
import { styleScalars, styleUniforms } from './visualStyle.ts'

/**
 * Shadow Ecology 0.3 — VISUAL STUDY 02: Rendering Language (Advanced settings → Visual experiments → Visual Study 02). One experimental style, after
 * Sable (clear colour regions, cel light, fine lines) and Path to Mnemosyne (hand-drawn ink, strong tonal contrast). It changes how terrain and Living
 * Architecture are lit and drawn, not their palette: each surface keeps its own colour.
 *
 *   colour     the surface's own albedo with the grey pulled out (more chroma) and its values grouped into broad soft steps: regions, not speckle
 *   light      two clear states from the key light: lit (a near-flat plateau, a little modelling kept) or shadow (about half the value, shifted cool, never
 *              grey); the sun's own shadow map decides, so moving cast shadows stay crisp, flat planes
 *   shade      persistent ecological shade (archGround's raster) is a third state and a different medium: a deep ink-blue wash, cross-hatched, its edge
 *              broken by noise. On the architecture only its downward and side faces take it
 *   lines      three kinds, all about a pixel or two wide at any distance: the silhouette where a form turns away, creases where the surface folds sharply,
 *              and a broken ink line along the edge of the sun's light (cast-shadow and terminator edges)
 *   texture    strokes on the surface itself (down the slope on the land, on the face's own plane on the stone): sparse in shadow, crossed in persistent
 *              shade, absent in the light, plus a faint painted wash
 *   air        the haze is thinned (fog pushed back, low mist halved) so colours read clear
 * Original (uInkOn = 0) skips everything: the world renders exactly as before. Water, plants and creatures are unchanged.
 *
 * Three further modes (Sable Inspired, Painterly Ink, Illustrated World) share illustrationChunk below, which reaches every entity: terrain,
 * architecture, plants, water, creatures and the island's shell. See MODES for what distinguishes them.
 */
export type Study02 = 'original' | 'ink' | 'inkRefined' | 'clean' | 'sable' | 'painterly' | 'illustrated' | 'mono'

export const STUDY02_OPTIONS: { value: Study02; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'ink', label: 'Clear Ink' },
  { value: 'inkRefined', label: 'Clear Ink Refined' },
  { value: 'clean', label: 'Clean Illustrated' },
  { value: 'sable', label: 'Sable Inspired' },
  { value: 'painterly', label: 'Painterly Ink' },
  { value: 'illustrated', label: 'Illustrated World' },
]

export const STUDY02_NOTE: Record<Study02, string> = {
  original: 'Visual Study 02 off: the world as it is.',
  mono: 'Living Monochrome: a sculptural near-monochrome island under a pale sky; colour only in cobalt water and in the yellow-green life that grows where the structures keep persistent shade. Moving shadows stay neutral charcoal.',
  ink: 'Clear Ink: clear colour regions, two-state cel light with cool flat shadows, fine contour and shadow-edge lines; persistent shade drawn as a cross-hatched ink wash. Terrain and architecture only.',
  inkRefined:
    'Clear Ink Refined: Clear Ink’s natural, earthy colours on every entity (plants included), neutral warm shadows with their midtones kept, darks lifted for Overview, strata lines and fewer, form-following marks that appear as you come closer; a calmer natural blue water.',
  clean:
    'Clean Illustrated: a designed palette (sand, clay, warm stone with mauve secondary planes, sage foliage, mineral teal water), sculptural light with soft mauve-grey shadows, restrained structural lines, and fine marks only close up.',
  sable:
    'Sable Inspired: broad, luminous colour regions on one palette, crisp warm/cool cel light, coloured outlines on architecture, plants and creatures, no hatching. Persistent shade is a flat teal-blue wash.',
  painterly:
    'Painterly Ink: natural colours cleaned, soft light, strong strata contours, and organic strokes that follow the surface, gather in shade and fold, and fade with distance. Light stays quiet.',
  illustrated:
    'Illustrated World: Sable’s palette with Painterly’s marks held to close views and shade, an indigo shade wash and a warm aerial haze, carried through terrain, architecture, plants, water and creatures alike.',
}

export const study02Uniforms = { uInkOn: { value: 0 }, uInkShade: archShade.texture }

/**
 * The three illustration modes share one finish (illustrationChunk), set by these numbers and colours. Weights: cel (0 soft light, 1 crisp two-state),
 * line (outlines), hatch (surface marks in shadow), harmony (how far each material moves onto the mode's palette), air (warm aerial depth), shadowV
 * (shadow value as a share of lit), simplify (the ground's noise quietened, vegGround.ts).
 */
type IlMode = {
  cel: number; line: number; hatch: number; harmony: number; air: number; shadowV: number; simplify: number; fog: number; mist: number
  /** Refinements (absent: as the first three modes were): natural (own colour, clarified, instead of the palette), cross (the crossing strokes in shade),
   *  ownV (how much of the ground's own value the palette keeps), lift (darks raised in the albedo), contrast (midtone separation in the light), neutral
   *  (shadow light de-blued). */
  natural?: number; cross?: number; ownV?: number; lift?: number; contrast?: number; neutral?: number
  warm: [number, number, number]; cool: [number, number, number]
  shade: string; airC: string; ink: string
  meadow: string; forest: string; moss: string; gravel: string; rock: string; soil: string
  stoneA: string; stoneB: string; accent: string; leafLight: string; leafDark: string; waterShallow: string; waterDeep: string
}
const MODES: Record<'inkRefined' | 'clean' | 'sable' | 'painterly' | 'illustrated', IlMode> = {
  inkRefined: {
    cel: 0.8, line: 0.85, hatch: 0.55, harmony: 1, air: 0, shadowV: 0.62, simplify: 0.55, fog: 1.6, mist: 0.45,
    natural: 1, cross: 0.25, ownV: 0.3, lift: 0.25, contrast: 0.12, neutral: 0.75,
    warm: [1.04, 1.0, 0.94], cool: [1.0, 0.97, 0.94],
    shade: '#4E4A44', airC: '#D8D2C4', ink: '#2A2622',
    meadow: '#A8A66E', forest: '#3C5A48', moss: '#667F5A', gravel: '#BEB39A', rock: '#9C8471', soil: '#9F8F74',
    stoneA: '#CDB79A', stoneB: '#7E7C88', accent: '#8E4E36', leafLight: '#7C9460', leafDark: '#2C4638', waterShallow: '#5C8DAA', waterDeep: '#22506F',
  },
  clean: {
    cel: 0.7, line: 0.55, hatch: 0.3, harmony: 0.9, air: 0.06, shadowV: 0.6, simplify: 0.7, fog: 1.5, mist: 0.5,
    natural: 0, cross: 0, ownV: 0.5, lift: 0.15, contrast: 0.1, neutral: 0.5,
    warm: [1.05, 1.0, 0.92], cool: [0.93, 0.9, 1.0],
    shade: '#62596A', airC: '#EEDCB8', ink: '#414C55',
    meadow: '#B7B98F', forest: '#5E8273', moss: '#86A08A', gravel: '#EEDCB8', rock: '#C9A08A', soil: '#DCC4A0',
    stoneA: '#B4A18C', stoneB: '#8B788C', accent: '#C18C79', leafLight: '#A6B89A', leafDark: '#6F9382', waterShallow: '#75AAB0', waterDeep: '#326F80',
  },
  sable: {
    cel: 0.9, line: 0.65, hatch: 0, harmony: 0.85, air: 0.12, shadowV: 0.6, simplify: 0.9, fog: 1.6, mist: 0.45,
    warm: [1.06, 1.0, 0.9], cool: [0.8, 0.88, 1.18],
    shade: '#2E5368', airC: '#E9D7C0', ink: '#2B2A3A',
    meadow: '#D7C77E', forest: '#3F7A68', moss: '#7FA174', gravel: '#E2CFA6', rock: '#BC9C88', soil: '#D3BC94',
    stoneA: '#E3BE91', stoneB: '#9C8FA8', accent: '#B5603F', leafLight: '#8DB36B', leafDark: '#2E6458', waterShallow: '#6CC3BA', waterDeep: '#2A6A84',
  },
  painterly: {
    cel: 0.5, line: 1, hatch: 1, harmony: 0.5, air: 0.05, shadowV: 0.46, simplify: 0.5, fog: 1.4, mist: 0.6,
    warm: [1.04, 1.0, 0.93], cool: [0.84, 0.9, 1.1],
    shade: '#1E2C3A', airC: '#D8D2C4', ink: '#16171F',
    meadow: '#A8A66E', forest: '#3C5A48', moss: '#667F5A', gravel: '#BEB39A', rock: '#8F857A', soil: '#9F8F74',
    stoneA: '#CDB79A', stoneB: '#7E7C88', accent: '#8E4E36', leafLight: '#7C9460', leafDark: '#2C4638', waterShallow: '#6E9C9A', waterDeep: '#26404D',
  },
  illustrated: {
    cel: 0.75, line: 0.75, hatch: 0.45, harmony: 0.8, air: 0.2, shadowV: 0.55, simplify: 0.75, fog: 1.25, mist: 0.7,
    warm: [1.08, 0.99, 0.88], cool: [0.8, 0.84, 1.2],
    shade: '#38456E', airC: '#E3D4C2', ink: '#2A2440',
    meadow: '#CFC27A', forest: '#2F6F6A', moss: '#6E9C7E', gravel: '#E6C9A8', rock: '#B4908A', soil: '#CDB497',
    stoneA: '#E8C29C', stoneB: '#8E86B0', accent: '#C0583E', leafLight: '#9CBF6E', leafDark: '#245A5E', waterShallow: '#7CC4B8', waterDeep: '#2A4F7A',
  },
}
const COLOR_KEYS = ['shade', 'airC', 'ink', 'meadow', 'forest', 'moss', 'gravel', 'rock', 'soil', 'stoneA', 'stoneB', 'accent', 'leafLight', 'leafDark', 'waterShallow', 'waterDeep'] as const
const ilName = (k: string) => `uIl${k[0]!.toUpperCase()}${k.slice(1)}`

/** The illustration finish's uniforms (shared objects: switching sets values only, no recompile). uIlSimplify is read by the ground (vegGround.ts). */
export const illustrationUniforms: Record<string, { value: number | Color | Vector3 }> = {
  uIlOn: { value: 0 }, uIlNatural: { value: 0 }, uIlCross: { value: 1 }, uIlOwnV: { value: 0.3 }, uIlLift: { value: 0 }, uIlContrast: { value: 0 }, uIlNeutral: { value: 0 }, uIlCel: { value: 0 }, uIlLine: { value: 0 }, uIlHatch: { value: 0 }, uIlHarmony: { value: 0 }, uIlAir: { value: 0 }, uIlShadowV: { value: 0.5 },
  uIlSimplify: { value: 0 }, uIlWarm: { value: new Vector3(1, 1, 1) }, uIlCool: { value: new Vector3(1, 1, 1) },
  ...Object.fromEntries(COLOR_KEYS.map((k) => [ilName(k), { value: new Color('#808080') }])),
}

let current: Study02 = 'original'
const listeners = new Set<() => void>()

export function setStudy02(next: Study02) {
  const was = current
  current = next
  study02Uniforms.uInkOn.value = next === 'ink' ? 1 : 0
  const u = illustrationUniforms
  const mode = next === 'original' || next === 'ink' || next === 'mono' ? null : MODES[next]
  // Visual Study 03 (visualStudy03.ts) shares this one state, so every study stays mutually exclusive.
  monoUniforms.uMonoOn.value = next === 'mono' ? 1 : 0
  u.uIlOn.value = mode ? 1 : 0
  u.uIlSimplify.value = mode ? mode.simplify : 0
  if (mode) {
    for (const k of ['cel', 'line', 'hatch', 'harmony', 'air', 'shadowV'] as const) u[ilName(k)]!.value = mode[k]
    u.uIlNatural.value = mode.natural ?? 0
    u.uIlCross.value = mode.cross ?? 1
    u.uIlOwnV.value = mode.ownV ?? 0.3
    u.uIlLift.value = mode.lift ?? 0
    u.uIlContrast.value = mode.contrast ?? 0
    u.uIlNeutral.value = mode.neutral ?? 0
    ;(u.uIlWarm.value as Vector3).set(...mode.warm)
    ;(u.uIlCool.value as Vector3).set(...mode.cool)
    for (const k of COLOR_KEYS) (u[ilName(k)]!.value as Color).set(mode[k])
  }
  // The air: clearer while on; returned to the presets' rest values when switched off (the presets are at Original whenever this is on).
  // (Living Monochrome keeps the world's own air and black field.)
  if (next === 'ink' || mode) {
    styleScalars.fog = mode ? mode.fog : 1.6
    styleUniforms.uStyMist.value = mode ? mode.mist : 0.45
  } else if (was !== 'original') {
    styleScalars.fog = 1
    styleUniforms.uStyMist.value = 1
  }
  for (const l of listeners) l()
}

export function useStudy02(): Study02 {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

export const STUDY02_HEAD = /* glsl */ `
uniform float uInkOn;
uniform sampler2D uInkShade;
const vec3 INK_LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec3 INK_LINE = vec3(0.018, 0.022, 0.04);
// The albedo made clear: the grey pulled out, values grouped into broad soft steps (in a perceptual scale) and lifted a little.
vec3 inkClarify(vec3 c) {
  float l = max(1e-4, dot(c, INK_LUMA));
  c = max(vec3(0.0), l + (c - l) * 1.6);
  float v = sqrt(l) * 5.0;
  float q = (floor(v) + smoothstep(0.25, 0.75, fract(v))) / 5.0;
  float lq = pow(mix(sqrt(l), q, 0.6), 2.0) * 1.12;
  return c * lq / max(1e-4, dot(c, INK_LUMA));
}
uniform float uIlOn;
uniform float uIlNatural;
uniform float uIlCross;
uniform float uIlOwnV;
uniform float uIlLift;
uniform float uIlContrast;
uniform float uIlNeutral;
uniform float uIlCel;
uniform float uIlLine;
uniform float uIlHatch;
uniform float uIlHarmony;
uniform float uIlAir;
uniform float uIlShadowV;
uniform vec3 uIlWarm;
uniform vec3 uIlCool;
uniform vec3 uIlShade;
uniform vec3 uIlAirC;
uniform vec3 uIlInk;
uniform vec3 uIlMeadow;
uniform vec3 uIlForest;
uniform vec3 uIlMoss;
uniform vec3 uIlGravel;
uniform vec3 uIlRock;
uniform vec3 uIlSoil;
uniform vec3 uIlStoneA;
uniform vec3 uIlStoneB;
uniform vec3 uIlAccent;
uniform vec3 uIlLeafLight;
uniform vec3 uIlLeafDark;
uniform vec3 uIlWaterShallow;
uniform vec3 uIlWaterDeep;
// A colour's hue at another value; a direction turned by an angle.
vec3 ilAt(vec3 hue, float v) { return hue / max(1e-4, dot(hue, INK_LUMA)) * v; }
vec2 ilTurn(vec2 d, float a) { float c = cos(a); float s = sin(a); return vec2(c * d.x - s * d.y, s * d.x + c * d.y); }
`

/** The finish for terrain or architecture, inserted at the top of applyStyleFinish's block. `world` is a GLSL vec3 of the fragment's world position. */
export function study02Chunk(kind: 'terrain' | 'architecture' | 'other', world: string): string {
  if (kind === 'other') return ''
  const arch = kind === 'architecture'
  return `
    if (uInkOn > 0.5) {
      vec3 inkAlb = max(diffuseColor.rgb, vec3(1e-4));
      float inkAL = max(1e-3, dot(inkAlb, INK_LUMA));
      vec3 inkN = normalize(normal);
      vec3 inkWn = inverseTransformDirection(inkN, viewMatrix);
      vec3 inkP = ${world};
      // The key light: which way the face turns, how strong the sun is, and whether it reaches here.
      float inkNdl = 0.0;
      vec3 inkKey = vec3(0.0);
      #if NUM_DIR_LIGHTS > 0
        inkNdl = dot(inkN, directionalLights[0].direction);
        inkKey = directionalLights[0].color * RECIPROCAL_PI;
      #endif
      float inkVis = 1.0;
      #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
      {
        DirectionalLightShadow inkDs = directionalLightShadows[0];
        inkVis = getShadow(directionalShadowMap[0], inkDs.shadowMapSize, inkDs.shadowIntensity, inkDs.shadowBias, inkDs.shadowRadius, vDirectionalShadowCoord[0]);
      }
      #endif
      // The light the rest of the scene gives (sky, fill, ambient occlusion), without the sun's own share.
      // (In colour: the warm sun and the tinted sky are kept, only their distribution changes.)
      vec3 inkAll = (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) / inkAlb;
      vec3 inkOther = max(vec3(0.0), inkAll - inkKey * max(inkNdl, 0.0) * inkVis);
      // Two states, with a narrow edge: lit (faces the sun and the sun reaches it) or not.
      float inkLit = smoothstep(0.0, 0.1, inkNdl) * smoothstep(0.35, 0.65, inkVis);
      // Persistent shade, its raster cells broken by noise into a ragged, brushed edge.
      float inkSh = 0.0;
      vec2 inkU = (inkP.xz + 2048.0) / 4096.0;
      if (inkU.x > 0.0 && inkU.y > 0.0 && inkU.x < 1.0 && inkU.y < 1.0) inkSh = texture2D(uInkShade, inkU).r;
      inkSh = smoothstep(0.2, 0.5, inkSh + (styNoise(inkP.xz * 0.3) - 0.5) * 0.28 + (styNoise(inkP.xz * 1.3 + 5.0) - 0.5) * 0.08);
      ${arch ? 'inkSh *= 1.0 - smoothstep(-0.2, 0.45, inkWn.y);' : ''}
      // Colour and the two light states. The lit plateau keeps a little modelling; shadow is about half the value and shifted cool.
      vec3 inkC = inkClarify(inkAlb);
      vec3 inkLitE = (inkOther + inkKey * (${arch ? '0.5 + 0.5' : '0.72 + 0.28'} * clamp(inkNdl * 1.8, 0.0, 1.0))) * 1.08;
      float inkLitV = dot(inkLitE, INK_LUMA);
      // Shadow: about half the lit value, lit by the sky alone and shifted cool.
      vec3 inkShdE = inkOther / max(1e-4, dot(inkOther, INK_LUMA)) * mix(0.42 * inkLitV, dot(inkOther, INK_LUMA), 0.25) * vec3(0.78, 0.88, 1.16);
      float inkWash = 0.95 + 0.1 * styNoise(inkP.xz * 0.045 + inkP.y * 0.03);
      vec3 inkLitC = inkC * inkLitE * inkWash;
      vec3 inkShdC = inkC * inkShdE;
      vec3 inkCol = mix(inkShdC, inkLitC, inkLit);
      // Strokes on the surface: on the land down the slope, on the stone along the face's own plane, so they stay put as the camera moves.
      vec2 inkPlane;
      vec2 inkDir;
      ${arch
        ? `vec3 inkA = abs(inkWn);
      inkPlane = inkA.x > inkA.y && inkA.x > inkA.z ? inkP.zy : inkA.y > inkA.z ? inkP.xz : inkP.xy;
      inkDir = vec2(0.8, 0.6);`
        : `inkPlane = inkP.xz;
      float inkS = length(inkWn.xz);
      inkDir = normalize(mix(vec2(0.7071, 0.7071), inkWn.xz / max(inkS, 1e-4), smoothstep(0.08, 0.25, inkS)));`}
      float inkHatch1 = styStrokes(inkPlane * 1.6, inkDir);
      float inkHatch2 = styStrokes(inkPlane * 1.6 + 13.0, vec2(-inkDir.y, inkDir.x));
      // Moving shadow: a clean, flat plane with only a few strokes.
      inkCol *= 1.0 - 0.22 * min(inkHatch1, 1.0) * (1.0 - inkLit) * (1.0 - inkSh);
      // Persistent shade: a different medium, a deep ink-blue wash, cross-hatched; the sun on it is muted, not removed.
      float inkShV = dot(inkCol, INK_LUMA) * 0.42;
      vec3 inkDeep = inkShV / dot(vec3(0.42, 0.62, 0.95), INK_LUMA) * vec3(0.42, 0.62, 0.95);
      inkDeep = mix(inkDeep, inkC * inkShV / max(1e-4, dot(inkC, INK_LUMA)), 0.3);
      inkDeep *= 1.0 - 0.55 * max(min(inkHatch1, 1.0), min(inkHatch2, 1.0) * 0.8);
      inkCol = mix(inkCol, inkDeep, inkSh * ${arch ? '0.75' : '0.85'});
      // LINES, each about one to two pixels wide at any distance.
      float inkLine = 0.0;
      float inkDist = length(vViewPosition);
      float inkHand = 0.65 + 0.35 * smoothstep(0.25, 0.6, styNoise(inkP.xz * 0.22 + inkP.y * 0.31));
      // Silhouette: where the form turns away from the eye.
      float inkNdv = abs(dot(inkN, normalize(vViewPosition)));
      inkLine = max(inkLine, (1.0 - smoothstep(1.0, 2.6, inkNdv / max(fwidth(inkNdv), 1e-5))) * ${arch ? '1.0' : '0.6'});
      // Creases: where the surface folds sharply between neighbouring pixels.
      float inkCrease = length(fwidth(inkWn));
      inkLine = max(inkLine, smoothstep(${arch ? '0.14, 0.42' : '0.22, 0.6'}, inkCrease) * ${arch ? '0.9' : '0.5 * (1.0 - smoothstep(300.0, 900.0, inkDist))'});
      // The edge of the sun's light: a broken ink line along cast-shadow and terminator edges.
      float inkEdge = abs(inkLit - 0.5) / max(fwidth(inkLit), 1e-4);
      inkLine = max(inkLine, (1.0 - smoothstep(0.8, 2.0, inkEdge)) * step(0.02, fwidth(inkLit)) * 0.75 * smoothstep(0.35, 0.55, styNoise(inkPlane * 0.6)));
      inkCol = mix(inkCol, INK_LINE * (0.6 + 0.4 * inkLitV), clamp(inkLine * inkHand, 0.0, 1.0));
      outgoingLight = inkCol + totalEmissiveRadiance;
    }`
}

export type IlKind = 'terrain' | 'architecture' | 'plant' | 'water' | 'creature' | 'shell'

/**
 * The illustration finish (Sable Inspired, Painterly Ink, Illustrated World) for one kind of surface, inserted at the top of applyStyleFinish's
 * block. `world` is a GLSL vec3 of the fragment's world position, or null where the material has none (plants, creatures, the shell).
 *
 *   colour    each material is moved onto the mode's palette by what it is: the ground by its ground material (vegGround's weights: woodland, moss,
 *             meadow, gravel; bare soil and rock by slope) and its living cover; the stone between a warm and a cool tone by height band, its
 *             stressed tissue to the accent, and never brighter than a held value (no chalk white); leaves between the palette's two greens, with a
 *             little of each species' own hue and its flowers kept; water between the palette's shallow and deep, at its own value
 *   light     the sun's two states, crisp or soft by mode: lit (warm, a little modelling) and shadow (a share of the lit value, cool, never black)
 *   shade     persistent ecological shade (archGround's raster) a third state: the mode's shade colour as a mottled wash, hatched in the ink modes
 *   marks     strokes only in shadow and shade, only close (they fade as a pixel grows past a few decimetres), in clusters rather than everywhere, more on
 *             folded ground; their direction follows the surface (down the slope on land, along the strata on stone) and wanders
 *   lines     coloured, not black: silhouettes everywhere (on the land only its ridges), creases and the strata's own colour steps on the stone,
 *             plants and creatures outlined only close
 *   air       a warm aerial tint with distance (Illustrated World most)
 */
export function illustrationChunk(kind: IlKind, world: string | null): string {
  const P = world ?? 'vec3(0.0)'
  const air = `
      {
        float ilKeyV = 0.0;
        #if NUM_DIR_LIGHTS > 0
          ilKeyV = dot(directionalLights[0].color, INK_LUMA) * RECIPROCAL_PI;
        #endif
        float ilAirK = uIlAir * smoothstep(250.0, 3000.0, length(vViewPosition));
        outgoingLight = mix(outgoingLight, ilAt(uIlAirC, mix(dot(outgoingLight, INK_LUMA), 0.3 * ilKeyV + 0.02, 0.5)), ilAirK);
      }`
  const shadeAt = world
    ? `float ilSh = 0.0;
      vec2 ilU = (ilP.xz + 2048.0) / 4096.0;
      if (ilU.x > 0.0 && ilU.y > 0.0 && ilU.x < 1.0 && ilU.y < 1.0) ilSh = texture2D(uInkShade, ilU).r;
      ilSh = smoothstep(0.2, 0.5, ilSh + (styNoise(ilP.xz * 0.3) - 0.5) * 0.24 + (styNoise(ilP.xz * 1.3 + 5.0) - 0.5) * 0.06);`
    : 'float ilSh = 0.0;'
  if (kind === 'water') {
    return `
    if (uIlOn > 0.5) {
      vec3 ilP = ${P};
      ${shadeAt}
      // Water on the palette at its own value (depth, shading and glints kept), a little lifted; glints keep part of their own light; a shaded pool darker, toward the shade.
      float ilL = dot(outgoingLight, INK_LUMA);
      vec3 ilW = ilAt(mix(uIlWaterDeep, uIlWaterShallow, smoothstep(0.015, 0.22, ilL)), ilL * 1.2);
      vec3 ilOwn = outgoingLight;
      float ilChroma = (max(ilOwn.r, max(ilOwn.g, ilOwn.b)) - min(ilOwn.r, min(ilOwn.g, ilOwn.b))) / max(1e-4, max(ilOwn.r, max(ilOwn.g, ilOwn.b)));
      ilW = mix(ilW, outgoingLight, smoothstep(0.4, 0.9, ilL) * (1.0 - smoothstep(0.2, 0.5, ilChroma)) * 0.7);
      ilW = mix(ilW, ilAt(uIlShade, dot(ilW, INK_LUMA) * 0.7), ilSh * 0.45);
      outgoingLight = mix(outgoingLight, ilW, 0.97);${air}
    }`
  }
  const arch = kind === 'architecture'
  const terrain = kind === 'terrain'
  const plant = kind === 'plant'
  // The albedo on the palette, by kind.
  const colour = terrain
    ? `float ilSteep = 1.0 - smoothstep(0.55, 0.85, ilWn.y);
      vec3 ilP0 = mix(uIlSoil, uIlRock, ilSteep);
      ilP0 = mix(ilP0, uIlGravel, vgMat.a * 0.85);
      ilP0 = mix(ilP0, uIlMeadow, vgMat.b * 0.85);
      ilP0 = mix(ilP0, uIlForest, vgMat.r * 0.9);
      ilP0 = mix(ilP0, uIlMoss, vgMat.g * 0.85);
      // The living cover (plants drawn as ground colour) in the leaves' own two greens, so the plants stand on ground that matches them.
      ilP0 = mix(ilP0, mix(uIlLeafDark, uIlLeafLight, smoothstep(0.03, 0.2, dot(vgTint.rgb, INK_LUMA))), vgTint.a);
      // Mostly the palette's value, part of the ground's own (so sediment, wet ground and the like still show).
      // (More of it close up, where the ground's grain should show; broad regions from afar.)
      vec3 ilC = ilAt(ilP0, mix(dot(ilP0, INK_LUMA), ilAL * 1.25, uIlOwnV + 0.4 * ilNear) * (0.94 + 0.12 * styNoise(ilP.xz * 0.25 + 2.0)));
      // Natural modes: the ground's own colour, made clear, in place of the palette.
      // (Close up it keeps the ground's own fine values, so grain and small marks survive the clean-up.)
      vec3 ilNat = inkClarify(ilAlb);
      ilNat = mix(ilNat, ilAt(ilNat, ilAL * 1.12), ilNear);
      ilC = mix(ilC, ilNat, uIlNatural);
      ilC = mix(ilAlb, ilC, uIlHarmony * (1.0 - vgOverA));`
    : arch
      ? `float ilT = smoothstep(0.04, 0.5, ilAL);
      // Warm and cool stone by height band (the strata), so the form reads in more than one tone.
      float ilBand = styNoise(vec2(ilP.y * 0.35, 0.0) + ilP.xz * 0.02);
      vec3 ilP0 = mix(uIlStoneB, uIlStoneA, clamp(0.2 + 0.8 * ilT + (ilBand - 0.5) * 0.55, 0.0, 1.0));
      ilP0 = mix(ilP0, uIlAccent, 0.5 * smoothstep(0.06, 0.25, ilAlb.r - ilAlb.b));
      vec3 ilC = mix(ilAlb, mix(ilAt(ilP0, mix(dot(ilP0, INK_LUMA), ilAL, 0.45)), inkClarify(ilAlb), uIlNatural), uIlHarmony);
      // Never chalk: the stone's value is held.
      ilC *= min(1.0, 0.4 / max(dot(ilC, INK_LUMA), 1e-4));`
      : plant
        ? `float ilT = smoothstep(0.015, 0.2, ilAL);
      vec3 ilP0 = mix(uIlLeafDark, uIlLeafLight, ilT);
      vec3 ilC = ilAt(ilP0, mix(dot(ilP0, INK_LUMA), ilAL, 0.8));
      // A little of each species' own hue; its flowers (strongly coloured) and its wood (warmer than green) keep theirs.
      float ilOwn = max(smoothstep(0.12, 0.3, length(ilAlb - ilAL) / max(ilAL, 0.02) * 0.25), smoothstep(0.0, 0.12, (ilAlb.r - ilAlb.g) / ilAL));
      ilC = mix(ilC, ilAt(inkClarify(ilAlb), dot(ilC, INK_LUMA)), 0.25 + 0.75 * ilOwn);
      // Natural modes: each species' own colour, made clear (a little richer, its values grouped), not the palette's greens.
      // (Near-grey parts, such as pale trunks, keep their own hue: the clean-up would otherwise push them green.)
      vec3 ilNat = inkClarify(ilAlb);
      float ilSat = (max(ilAlb.r, max(ilAlb.g, ilAlb.b)) - min(ilAlb.r, min(ilAlb.g, ilAlb.b))) / max(1e-4, max(ilAlb.r, max(ilAlb.g, ilAlb.b)));
      ilNat = mix(ilAt(ilAlb, dot(ilNat, INK_LUMA)), ilNat, smoothstep(0.12, 0.3, ilSat));
      ilC = mix(ilC, ilNat, uIlNatural);
      ilC = mix(ilAlb, ilC, uIlHarmony);`
        : kind === 'shell'
          ? 'vec3 ilC = mix(ilAlb, mix(ilAt(uIlRock, ilAL * 0.9), inkClarify(ilAlb), uIlNatural), uIlHarmony);'
          : 'vec3 ilC = mix(ilAlb, inkClarify(ilAlb), 0.6 * uIlHarmony);'
  // How much modelling the light keeps, and how crisp the terminator is, by kind (foliage normals are restless: softer).
  const model = arch ? '0.45' : plant ? '0.8' : '0.3'
  const crisp = plant ? '0.55' : '1.0'
  const marks =
    terrain || arch
      ? `
      if (uIlHatch > 0.0) {
        // Surface marks: only where the sun does not reach or the shade lies, only close, in clusters, more on folded ground.
        vec2 ilPlane;
        vec2 ilDir;
        ${arch
          ? `vec3 ilA = abs(ilWn);
        // Along the strata (horizontal) on the walls; across the tops and undersides at a slant.
        ilPlane = ilA.x > ilA.y && ilA.x > ilA.z ? ilP.zy : ilA.y > ilA.z ? ilP.xz : ilP.xy;
        ilDir = ilA.y > max(ilA.x, ilA.z) ? vec2(0.8, 0.6) : vec2(1.0, 0.04);`
          : `ilPlane = ilP.xz;
        float ilS = length(ilWn.xz);
        ilDir = normalize(mix(vec2(0.7071, 0.7071), ilWn.xz / max(ilS, 1e-4), smoothstep(0.08, 0.25, ilS)));`}
        ilDir = ilTurn(ilDir, (styNoise(ilPlane * 0.04) - 0.5) * 1.3);
        float ilCurv = length(fwidth(ilWn)) / max(ilFoot, 1e-3);
        float ilCluster = smoothstep(0.35, 0.7, styNoise(ilPlane * 0.09 + 3.0));
        float ilDark = max(1.0 - ilLit, ilSh);
        float ilDens = ilDark * (0.4 + 0.6 * ilCluster) + 0.35 * smoothstep(0.1, 0.6, ilCurv) * ilDark;
        float ilH = styStrokes(ilPlane * 1.3, ilDir) * smoothstep(0.15, 0.5, ilDens);
        // A second, crossing family only deep in persistent shade, and only where the clusters gather.
        ilH = max(ilH, styStrokes(ilPlane * 1.3 + 17.0, ilTurn(ilDir, 1.1)) * smoothstep(0.55, 0.9, ilSh * ilCluster) * uIlCross);
        ilCol *= 1.0 - uIlHatch * ${arch ? '0.5' : '0.42'} * ilNear * min(ilH, 1.0);
      }`
      : ''
  const lines = `
      // Lines, coloured from the local shadow (not black), a pixel or two wide at any distance.
      float ilLine = 0.0;
      float ilNdv = abs(dot(ilN, normalize(vViewPosition)));
      float ilSil = 1.0 - smoothstep(1.0, 2.4, ilNdv / max(fwidth(ilNdv), 1e-5));
      ${terrain ? 'ilLine = ilSil * 0.35;' : arch ? 'ilLine = ilSil;' : kind === 'shell' ? '' : `ilLine = ilSil * ${plant ? '0.6' : '0.85'} * (1.0 - smoothstep(${plant ? '40.0, 220.0' : '60.0, 400.0'}, ilDist));`}
      ${arch
        ? `ilLine = max(ilLine, smoothstep(0.16, 0.45, length(fwidth(ilWn))) * 0.8);
      // The strata's own colour steps, drawn: close up only.
      ilLine = max(ilLine, smoothstep(0.12, 0.35, fwidth(ilAL) / ilAL) * 0.6 * (1.0 - smoothstep(0.15, 1.2, ilFoot)));`
        : ''}
      float ilHand = ${world ? '0.65 + 0.35 * smoothstep(0.25, 0.6, styNoise(ilP.xz * 0.22 + ilP.y * 0.31))' : '1.0'};
      vec3 ilInkC = mix(uIlInk * (0.35 + 0.65 * ilLitV), ilShdC * 0.45, 0.5);
      ilCol = mix(ilCol, ilInkC, clamp(ilLine * uIlLine * ilHand, 0.0, 1.0));`
  return `
    if (uIlOn > 0.5) {
      vec3 ilAlb = max(diffuseColor.rgb, vec3(1e-4));
      float ilAL = max(1e-3, dot(ilAlb, INK_LUMA));
      vec3 ilN = normalize(normal);
      vec3 ilWn = inverseTransformDirection(ilN, viewMatrix);
      float ilDist = length(vViewPosition);
      vec3 ilP = ${P};
      float ilFoot = ${world ? 'length(fwidth(ilP))' : 'ilDist * 0.0015'};
      float ilNear = 1.0 - smoothstep(0.06, 0.45, ilFoot);
      float ilNdl = 0.0;
      vec3 ilKey = vec3(0.0);
      #if NUM_DIR_LIGHTS > 0
        ilNdl = dot(ilN, directionalLights[0].direction);
        ilKey = directionalLights[0].color * RECIPROCAL_PI;
      #endif
      float ilVis = 1.0;
      #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
      if (receiveShadow) {
        DirectionalLightShadow ilDs = directionalLightShadows[0];
        ilVis = getShadow(directionalShadowMap[0], ilDs.shadowMapSize, ilDs.shadowIntensity, ilDs.shadowBias, ilDs.shadowRadius, vDirectionalShadowCoord[0]);
      }
      #endif
      // The light the rest of the scene gives (sky, fill), in colour, without the sun's own share.
      vec3 ilOther = max(vec3(0.0), (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) / ilAlb - ilKey * max(ilNdl, 0.0) * ilVis);
      ${shadeAt}
      ${arch ? 'ilSh *= 1.0 - smoothstep(-0.2, 0.45, ilWn.y);' : ''}
      ${colour}
      // Darks raised (about a value of 0.25), so Overview is not dominated by dark patches (lift 0: unchanged).
      { float ilCL = max(1e-4, dot(ilC, INK_LUMA)); ilC *= 0.25 * pow(ilCL / 0.25, 1.0 - uIlLift) / ilCL; }
      // The sun's two states: crisp or soft by mode.
      float ilW = mix(0.5, 0.06, uIlCel * ${crisp});
      float ilLit = smoothstep(0.5 - ilW, 0.5 + ilW, clamp(ilNdl * 4.0, 0.0, 1.0) * ilVis);
      float ilNd = clamp(ilNdl * 1.6, 0.0, 1.0);
      vec3 ilLitE = ilOther + ilKey * mix(ilNd, 1.0 - ${model} + ${model} * ilNd, uIlCel);
      float ilLitV = dot(ilLitE, INK_LUMA);
      float ilOtherV = max(1e-4, dot(ilOther, INK_LUMA));
      vec3 ilShdE = mix(ilOther / ilOtherV, vec3(1.0), uIlNeutral) * mix(uIlShadowV * ilLitV, ilOtherV, 0.25) * uIlCool;
      vec3 ilShdC = ilC * ilShdE;
      vec3 ilCol = mix(ilShdC, ilC * ilLitE * uIlWarm, ilLit);
      ${world && (terrain || arch)
        ? `// Persistent shade: the mode's shade colour as a mottled wash, a place of its own (the moving shadow stays the cool flat plane above).
      vec3 ilDeep = ilAt(mix(uIlShade, ilC, 0.25), dot(ilCol, INK_LUMA) * 0.62) * (0.9 + 0.2 * styNoise(ilP.xz * 0.6));
      ilCol = mix(ilCol, ilDeep, ilSh * 0.8);`
        : ''}${marks}
      // Midtone separation around the lit midtone (contrast 0: unchanged).
      { float ilV = max(1e-4, dot(ilCol, INK_LUMA)); ilCol *= pow(ilV / (0.25 * max(ilLitV, 0.05)), uIlContrast); }${lines}
      outgoingLight = ilCol + totalEmissiveRadiance;${air}
    }`
}
