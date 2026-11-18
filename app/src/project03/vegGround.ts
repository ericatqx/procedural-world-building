import { archGround, archShade } from './archGround.ts'
import { pickUniforms, styleUniforms, visualUniforms } from './visualStyle.ts'
import { illustrationUniforms, study02Uniforms } from './visualStudy02.ts'
import { DataTexture, NoColorSpace, LinearFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType, type WebGLProgramParametersWithUniforms } from 'three'

/**
 * Shadow Ecology 0.3 — vegetation as ground colour. Two island-wide textures (16 m texels) are sampled by the terrain's own
 * material by world position: `tint`, the living ground cover's colour and how much of the ground it covers (so the island
 * has vegetation in the overview, and the plants you can see close up stand on matching ground), and `overlay`, the colour
 * map the panel asks for (habitat, light or moisture). The terrain material calls applyVegGround; nothing else about it changes.
 */
const blank = () => {
  const t = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat, UnsignedByteType)
  t.colorSpace = SRGBColorSpace
  t.needsUpdate = true
  return t
}

export const vegGround = {
  tint: { value: blank() as DataTexture },
  overlay: { value: blank() as DataTexture },
  ground: { value: blank() as DataTexture },
  groundOn: { value: 0 },
  /** The geology map (terrainGeology.ts): slope, convexity and the cliff above, on the same 16 m grid; read by the Black Stage's rock. */
  geology: { value: blank() as DataTexture },
  /** The relief (terrainGeology.ts): the ground's smoothed slope direction, which way the terrain faces the sun on the Black Stage. */
  relief: { value: blank() as DataTexture },
  geologyOn: { value: 0 },
  origin: { value: -2048 },
  size: { value: 4096 },
  tintOn: { value: 0 },
  overlayOn: { value: 0 },
  /** Approach's marker, drawn on the terrain itself: x, z and radius in metres; shown when pickOn is 1 (a place that can be picked) or 2 (one that cannot). */
  pick: pickUniforms.uPick,
  pickOn: pickUniforms.uPickOn,
}

export function setGroundTexture(which: 'tint' | 'overlay' | 'ground' | 'geology' | 'relief', data: Uint8Array, n: number) {
  const old = vegGround[which].value
  const t = new DataTexture(data, n, n, RGBAFormat, UnsignedByteType)
  // The ground materials are data (weights), not colour.
  // (Round 08C: the overlay is data too, for Explore Data, visualDiagnostics.ts.)
  t.colorSpace = which === 'tint' ? SRGBColorSpace : NoColorSpace
  t.magFilter = LinearFilter
  t.minFilter = LinearFilter
  t.needsUpdate = true
  vegGround[which].value = t
  old.dispose()
}

/** Adds the vegetation's colour to a terrain material's shaders (call it after the material's own replacements). */
export function applyVegGround(shader: WebGLProgramParametersWithUniforms) {
  // Shadow tint (visualStyle.ts): ground in shadow cooled toward a deep blue-teal, so shadow reads as a place of its own; nothing changes where it is lit.
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <opaque_fragment>',
    `{
      float vsd = 1.0 - smoothstep(0.03, 0.24, dot(outgoingLight, vec3(0.3333)));
      outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.74, 0.96, 1.12) + vec3(0.0, 0.006, 0.01), vsd * uVisShade);
    }
    #include <opaque_fragment>`,
  )
  shader.uniforms.uVegTint = vegGround.tint
  shader.uniforms.uVegOverlay = vegGround.overlay
  shader.uniforms.uVegOrigin = vegGround.origin
  shader.uniforms.uVegSize = vegGround.size
  shader.uniforms.uVegTintOn = vegGround.tintOn
  shader.uniforms.uVegOverlayOn = vegGround.overlayOn
  shader.uniforms.uVegGround = vegGround.ground
  shader.uniforms.uVegGroundOn = vegGround.groundOn
  shader.uniforms.uVegGeo = vegGround.geology
  shader.uniforms.uVegRelief = vegGround.relief
  shader.uniforms.uVegGeoOn = vegGround.geologyOn
  shader.uniforms.uArch = archGround.texture
  shader.uniforms.uArchShade = archShade.texture
  Object.assign(shader.uniforms, visualUniforms, styleUniforms)
  shader.uniforms.uIlSimplify = illustrationUniforms.uIlSimplify
  // Clear Ink's on/off (visualStudy02.ts), read here under its own name: the ground's Clear Ink transitions and distance tone.
  shader.uniforms.uVgInk = study02Uniforms.uInkOn
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', 'varying vec2 vVegXZ;\nvoid main() {')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n vVegXZ = (modelMatrix * vec4(transformed, 1.0)).xz;')
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'uniform float uVisShade;\nuniform sampler2D uArch;\nuniform sampler2D uArchShade;\nuniform sampler2D uVegTint;\nuniform sampler2D uVegOverlay;\nuniform float uVegOrigin;\nuniform float uVegSize;\nuniform float uVegTintOn;\nuniform float uVegOverlayOn;\nuniform sampler2D uVegGround;\nuniform float uVegGroundOn;\nuniform sampler2D uVegGeo;\nuniform sampler2D uVegRelief;\nuniform float uVegGeoOn;\nvarying vec2 vVegXZ;\n' + GROUND_GLSL + 'void main() {')
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       vec2 vegUv = (vVegXZ - vec2(uVegOrigin)) / uVegSize;
       if (uVegGroundOn > 0.5 && vegUv.x > 0.0 && vegUv.y > 0.0 && vegUv.x < 1.0 && vegUv.y < 1.0) {
         diffuseColor.rgb = vegGroundColour(diffuseColor.rgb, texture2D(uVegGround, vegUv), vVegXZ, inverseTransformDirection(normalize(vNormal), viewMatrix).y);
       }
       {
         // What the structures do to the ground (archGround.ts): pale mineral sediment out of their footprint, weathered rock fragments, and the darker, damper soil at
         // the fringe, all broken up by noise so none has a circular or hard edge.
         vec2 au = (vVegXZ + 2048.0) / 4096.0;
         if (au.x > 0.0 && au.y > 0.0 && au.x < 1.0 && au.y < 1.0) {
           // The ground a structure shades is cooler and damper: deeper green-gray, mossier, darker under a roof, irregular at its edge, from the shadow the structure casts.
           vec2 shd = texture2D(uArchShade, au).rg;
           if (shd.r > 0.02 || shd.g > 0.02) {
             float cool = smoothstep(0.08, 0.7, shd.r) * (0.55 + 0.45 * vgNoise(vVegXZ * 0.5 + 9.0));
             vec3 cg = diffuseColor.rgb;
             cg = mix(cg, cg * vec3(0.8, 0.93, 0.9), cool * 0.55);
             cg = mix(cg, vec3(0.16, 0.235, 0.15) * (0.9 + 0.2 * vgNoise(vVegXZ * 1.3)), cool * smoothstep(0.35, 0.85, shd.r) * 0.35);
             cg *= 1.0 - 0.14 * shd.g;
             diffuseColor.rgb = cg;
           }
           float inf = texture2D(uArch, au).r;
           if (inf > 0.01) {
             float an1 = vgNoise(vVegXZ * 0.35);
             float an2 = vgNoise(vVegXZ * 1.7 + 4.0);
             float an3 = vgNoise(vVegXZ * 5.3);
             // The edge is the structure's own irregular footprint, eaten into by several scales of noise (patches, tongues, gaps), never a smooth halo; and the colour is the
             // local soil lightened and cooled toward mineral, not a fixed pale paint, so it carries the ground's own variation and meets the soil without a line.
             float av = clamp(inf * (0.25 + 1.3 * an1 * (0.6 + 0.8 * an2)) - 0.04 * an3, 0.0, 1.0);
             float sed = smoothstep(0.22, 0.85, av) * (0.55 + 0.45 * an2);
             float rim = smoothstep(0.05, 0.2, av) * (1.0 - smoothstep(0.25, 0.55, av)) * an1;
             float frag = smoothstep(0.72, 0.82, an3 * 0.6 + an2 * 0.4) * smoothstep(0.12, 0.4, av) * (1.0 - smoothstep(0.6, 0.95, av));
             vec3 soil = diffuseColor.rgb;
             soil = mix(soil, soil * vec3(0.9, 0.88, 0.84), rim * 0.45);
             soil = mix(soil, soil * vec3(1.22, 1.2, 1.15) + vec3(0.025, 0.025, 0.03), sed * 0.4);
             soil = mix(soil, soil * vec3(1.3, 1.27, 1.2), frag * 0.35);
             diffuseColor.rgb = soil;
           }
         }
       }
       {
         // Contrast (visualStyle.ts): bare rock and the ground with no plant material warmer and lighter, a warmer mineral.
         diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.1, 1.03, 0.9), uVisGrade * (1.0 - smoothstep(0.0, 0.5, dot(texture2D(uVegGround, vegUv), vec4(1.0)))));
       }
       // (Approach's marker is drawn over the finished colour, in every visual: visualStyle.ts › PICK_MARKER.)
       if (vegUv.x > 0.0 && vegUv.y > 0.0 && vegUv.x < 1.0 && vegUv.y < 1.0) {
         vec4 vt = texture2D(uVegTint, vegUv);
         diffuseColor.rgb = mix(diffuseColor.rgb, vt.rgb, vt.a * uVegTintOn);
         vec4 vo = texture2D(uVegOverlay, vegUv);
         diffuseColor.rgb = mix(diffuseColor.rgb, vo.rgb, vo.a * uVegOverlayOn);
         // (Kept for Visual Study 02's illustration modes, which recolour the ground by what covers it and leave the data overlays alone.)
         vgTint = vec4(vt.rgb, vt.a * uVegTintOn);
         vgOverA = vo.a * uVegOverlayOn;
       }`,
    )
}

/**
 * The ground materials in GLSL. The texture gives each material's share at 16 m; value noise at several scales moves the edges
 * (so patches are irregular, not texels) and grades colour within a material, and slope keeps soil and moss off steep rock.
 * Muted, natural colours: this is ground, not a data tint.
 */
const GROUND_GLSL = `
uniform float uVisGrade;
uniform float uStySimplify;
uniform float uIlSimplify;
uniform float uVgInk;
// What the ground is made of (woodland floor, moss, meadow, gravel), its living cover and whether a data overlay is shown: read by Visual Study 02.
vec4 vgMat = vec4(0.0);
vec4 vgTint = vec4(0.0);
float vgOverA = 0.0;
float vgHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vgNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(vgHash(i), vgHash(i + vec2(1.0, 0.0)), f.x), mix(vgHash(i + vec2(0.0, 1.0)), vgHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float vgFbm(vec2 p) { return 0.55 * vgNoise(p) + 0.3 * vgNoise(p * 2.3 + 7.0) + 0.15 * vgNoise(p * 5.1 + 3.0); }
vec3 vegGroundColour(vec3 base, vec4 w, vec2 xz, float ny) {
  // Vegetation holds on moderate slopes too (the island is steep): only the steep faces are left to bare rock.
  float flatness = smoothstep(0.42, 0.78, ny);
  float n1 = vgFbm(xz / 9.0);
  float n2 = vgFbm(xz / 2.2 + 11.0);
  float n3 = vgNoise(xz * 1.7);
  // Sculpt and Ink (visualStyle.ts): the ground's noise quietened, so its materials lie in large, clean regions with calm edges.
  // (Visual Study 02's illustration modes quieten it only with distance: broad regions from afar, the grain kept close up.)
  float styK = 1.0 - 0.85 * max(uStySimplify, uIlSimplify * smoothstep(0.08, 0.8, fwidth(xz.x)));
  n1 = mix(0.5, n1, styK);
  n2 = mix(0.5, n2, styK);
  n3 = mix(0.5, n3, styK);
  // Each material's share, with its edge moved by noise so a patch has an irregular, broken outline.
  // Clear Ink: the woodland floor and the meadow meet over a wider band (the weights already ramp; a second narrow threshold made it a line), with the
  // large-scale edge noise a little calmer, so the edge follows the ground's own conditions more than the noise.
  float ecoWide = 0.07 * uVgInk;
  float edgeN = mix(0.55, 0.42, uVgInk);
  float floorW = smoothstep(0.3 - ecoWide, 0.62 + ecoWide, w.r * flatness + (n1 - 0.5) * edgeN);
  float mossW = smoothstep(0.28, 0.6, w.g * (0.45 + 0.55 * flatness) + (n2 - 0.5) * 0.5);
  float meadW = smoothstep(0.3 - ecoWide, 0.62 + ecoWide, w.b * flatness + (n1 - 0.5) * mix(0.5, 0.4, uVgInk) + (n3 - 0.5) * 0.15);
  // Clear Ink: the ecotone. Where the floor gives way to open ground it does not fade evenly: it breaks into tongues of litter and tufts of grass (a few metres
  // across) that interleave, so the band reads as the edge of a wood, still made of the two materials, not a mud-coloured blend.
  float ecoBand = 4.0 * floorW * (1.0 - floorW) * uVgInk;
  floorW = clamp(floorW + (n2 - 0.5) * 0.7 * ecoBand, 0.0, 1.0);
  // Clear Ink: scree on the steep slopes (a gravel share under about 0.3) sits just below this threshold, so only the peaks of the fine noise crossed it: isolated
  // pale flecks, stretched down the slope by the plan-view noise and flickering at a distance. There it follows a larger pattern (bands of scree a few
  // metres across) with the fine noise faded out as a pixel grows, so its marks are fewer, grouped and stable. The shoreline's gravel is unchanged.
  float gravFine = (n2 - 0.5) * mix(0.5, 0.4 * (1.0 - smoothstep(0.08, 0.5, fwidth(xz.x))), uVgInk);
  float gravW = smoothstep(0.3, 0.6, w.a + gravFine + (n1 - 0.5) * 0.25 * uVgInk);
  vgMat = vec4(floorW, mossW, meadW, gravW);
  // Soil and leaf litter: litter is darker and warmer, in dapples among the soil.
  // Muted sage, olive-gray and moss with warm earth and cool mineral gravel: no yellow-green.
  vec3 soil = mix(vec3(0.27, 0.23, 0.18), vec3(0.2, 0.185, 0.145), smoothstep(0.4, 0.7, n2));
  vec3 litter = mix(soil, vec3(0.33, 0.26, 0.17), smoothstep(0.45, 0.75, n3) * 0.6);
  vec3 forest = mix(soil, litter, smoothstep(0.35, 0.6, n1));
  vec3 moss = mix(vec3(0.16, 0.235, 0.15), vec3(0.23, 0.30, 0.19), n3);
  vec3 meadow = mix(vec3(0.255, 0.30, 0.21), vec3(0.35, 0.385, 0.29), n2);
  // Fine short grass for the meadow, made of the ground colour itself (no geometry, nothing that rebuilds with the camera): blade-scale streaks and tufts of
  // tone, and a few sun-dried tufts. Each fades into the plain colour as its detail shrinks below a pixel, so from far away the meadow is one even
  // green and up close it has grain.
  float bladeK = (1.0 - smoothstep(0.25, 0.8, fwidth(xz.x) * 11.0)) * styK;
  float tuftK = (1.0 - smoothstep(0.25, 0.8, fwidth(xz.x) * 3.1)) * styK;
  float blade = vgNoise(vec2(xz.x * 11.0, xz.y * 5.5)) * 0.55 + vgNoise(xz * 27.0) * 0.45;
  float tuft = vgNoise(xz * 3.1 + 5.0);
  meadow *= 1.0 + bladeK * (blade - 0.5) * 0.34 + tuftK * (tuft - 0.5) * 0.2;
  meadow = mix(meadow, meadow * vec3(1.07, 1.03, 0.86), tuftK * smoothstep(0.58, 0.88, tuft) * 0.4);
  vec3 gravel = mix(vec3(0.43, 0.42, 0.395), vec3(0.54, 0.53, 0.495), n3);
  // Clear Ink: scree is broken rock of the slope's own colour, a step lighter, not pale chalk (shoreline gravel keeps its own colour).
  gravel = mix(gravel, mix(base * 1.22, gravel, 0.3), uVgInk * (1.0 - smoothstep(0.35, 0.6, w.a)));
  // From far off a grove is its canopy, not its floor: as a pixel grows past a few decimetres the forest floor turns to the dark sage of the crowns over it
  // (the same family as the trees' own tint, WORLD_FOLIAGE in worldPlants.ts), and the meadow to a lighter, warmer sage, so from Overview groves, scrub and
  // meadow separate by value, and the trees stand on ground that reads as theirs.
  float farK = smoothstep(0.35, 2.6, fwidth(xz.x));
  vec3 canopy = mix(vec3(0.135, 0.175, 0.125), vec3(0.17, 0.205, 0.14), n1);
  // Clear Ink: the same family at every distance. The floor's turn toward the canopy's sage starts much nearer (by Approach it is mostly there, as at
  // Overview), and close up a third of it stays, so the soil and the litter keep their dapples and grain but sit in the woodland's tone, not as bright brown.
  float forestK = mix(farK, 0.3 + 0.7 * smoothstep(0.03, 0.6, fwidth(xz.x)), uVgInk);
  forest = mix(forest, canopy, forestK * 0.85);
  meadow = mix(meadow, meadow * vec3(1.08, 1.06, 0.92), farK * 0.6);
  // Contrast (visualStyle.ts): a deeper, greener woodland, a brighter, warmer meadow, a richer moss and a warmer gravel, each further from the others.
  forest = mix(forest, forest * vec3(0.72, 1.02, 0.7), uVisGrade * (0.4 + 0.6 * farK));
  meadow = mix(meadow, meadow * vec3(1.16, 1.18, 0.82), uVisGrade);
  moss = mix(moss, moss * vec3(0.8, 1.12, 0.9), uVisGrade);
  gravel = mix(gravel, gravel * vec3(1.08, 1.02, 0.9), uVisGrade);
  // Broad, slow swells of tone over everything (and a fine grain), so no patch of ground reads as one flat colour.
  float swell = mix(1.0, 0.86 + 0.28 * vgFbm(xz / 55.0 + 31.0), styK);
  float grain = mix(1.0, 0.94 + 0.12 * vgNoise(xz * 0.9), styK);
  vec3 c = base * mix(1.0, swell * grain, 0.8);
  c = mix(c, gravel, gravW * 0.85);
  c = mix(c, meadow, meadW * 0.85);
  c = mix(c, forest, floorW * 0.9);
  c = mix(c, moss, mossW * 0.85);
  c *= mix(1.0, swell * grain, floorW * 0.7 + meadW * 0.7 + mossW * 0.5);
  return c;
}
`

// Development only: this module holds state that compiled shaders depend on (uniforms, specialised switches). A hot update would load a second copy
// of it while existing materials keep the first, and the scene falls back to the unstyled look (cobalt water, plain underside, grey ground) until a
// reload. A full reload instead (Round 08D; Vite's hot.decline() is a no-op, so the update is accepted here and answered with a reload).
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload())
