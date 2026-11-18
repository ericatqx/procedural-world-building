import { Color } from 'three'

/**
 * Shadow Ecology 0.3 — World Visual Study: ILLUSTRATED ATLAS (prototype 01). The same world drawn as an illustrated landscape on warm paper: an engraved
 * relief map you can fly into (Moebius's line and colour, Sable's bold shapes, Owen D. Pomery's architectural restraint, the shaded relief and contours of
 * old cartography). It is a finish on every styled material (visualStyle.ts applyStyleFinish), switched by one uniform, so it costs nothing while off and
 * never touches geometry, placement, ecology, the simulation or time.
 *
 *   colour   each surface is moved onto one palette by what it is, not graded: the ground by its materials (vegGround's weights: woodland floor, moss,
 *            meadow, gravel; the rest is rock, sandstone low and slate high and steep), water by depth, the island's cut edge in sandstone strata,
 *            architecture warm off-white, plants in moss and sage with bark in sepia
 *   light    shaded relief: the sun blended with a fixed map light from the north-west, so form reads at every hour; shade is a cool slate wash, never black
 *   line     selective and coloured, never black: contours only on the mountains (their interval adapts to how many pixels apart they would be, so they never
 *            crowd or shimmer), slope marks only on steep rock turned from the sun, the woodland's edge in dark moss, ridgelines and skylines in slate,
 *            the shore drawn in the water as a few depth lines, the architecture outlined in sepia
 *   paper    the background and the haze are the same warm ivory, so distance fades into the page; the scene is not tone-mapped in this mode, so the
 *            palette is what is drawn
 */
export const atlasUniforms = { uAtlasOn: { value: 0 } }

/** What the sky writes while the Atlas is on (Sky.tsx): the paper, by day and by night. */
export const atlasScene = { on: false, paper: new Color('#F2EBDA'), night: new Color('#2B3140') }

/** A colour as a GLSL vec3 in the renderer's linear working space. */
const v3 = (hex: string) => {
  const c = new Color(hex)
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`
}

export const ATLAS_HEAD = /* glsl */ `
uniform float uAtlasOn;
const vec3 AT_MEADOW = ${v3('#B9C68F')};
const vec3 AT_MEADOW_DRY = ${v3('#CFC896')};
const vec3 AT_WOOD = ${v3('#6C8650')};
const vec3 AT_MOSS = ${v3('#5C7D57')};
const vec3 AT_SAND = ${v3('#E0CFA8')};
const vec3 AT_STONE = ${v3('#D2B893')};
const vec3 AT_STONE_DEEP = ${v3('#BE9C78')};
const vec3 AT_SLATE = ${v3('#949DAA')};
const vec3 AT_INK = ${v3('#4A5262')};
const vec3 AT_SEPIA = ${v3('#6B5442')};
const vec3 AT_WOOD_LINE = ${v3('#3D5234')};
const vec3 AT_SHADE = ${v3('#B7BED0')};
const vec3 AT_WATER_SHALLOW = ${v3('#A3CDD0')};
const vec3 AT_WATER_DEEP = ${v3('#4D8FA6')};
const vec3 AT_WATER_LINE = ${v3('#2C6A82')};
const vec3 AT_ARCH = ${v3('#EFE6D4')};
const vec3 AT_ARCH_SHADE = ${v3('#B9B3C2')};
const vec3 AT_LEAF_DARK = ${v3('#47643C')};
const vec3 AT_LEAF_LIGHT = ${v3('#A9BF7E')};
const vec3 AT_BARK = ${v3('#7A6450')};
const vec3 AT_NIGHT = vec3(0.30, 0.34, 0.48);
// The fixed map light (world space): from the north-west and high, as on a shaded-relief map.
const vec3 AT_MAP_L = vec3(-0.5, 0.78, -0.38);
// A line of about a pixel where a value crosses a level: d is the distance to the level in that value's own units.
float atLine(float d, float fw, float w) { return 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.0, abs(d) / max(fw, 1e-5)); }
`

/** The common light terms: the sun's facing and shadow, its strength (day), and the fixed map light. */
const LIGHT = /* glsl */ `
      vec3 atN = normalize(normal);
      vec3 atWn = inverseTransformDirection(atN, viewMatrix);
      float atNdl = 0.0;
      float atKeyV = 0.0;
      #if NUM_DIR_LIGHTS > 0
        atNdl = dot(atN, directionalLights[0].direction);
        atKeyV = dot(directionalLights[0].color, INK_LUMA);
      #endif
      float atVis = 1.0;
      #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
      {
        DirectionalLightShadow atDs = directionalLightShadows[0];
        atVis = getShadow(directionalShadowMap[0], atDs.shadowMapSize, atDs.shadowIntensity, atDs.shadowBias, atDs.shadowRadius, vDirectionalShadowCoord[0]);
      }
      #endif
      float atDay = smoothstep(0.05, 0.9, atKeyV);
      float atSun = clamp(atNdl * 1.35, 0.0, 1.0) * smoothstep(0.3, 0.7, atVis);
      float atMap = clamp(dot(atWn, normalize(AT_MAP_L)), 0.0, 1.0);
      float atDist = length(vViewPosition);`

export function atlasChunk(kind: 'terrain' | 'architecture' | 'plant' | 'creature' | 'water' | 'shell', hasDepth: boolean): string {
  if (kind === 'creature') return ''
  if (kind === 'terrain') return terrain()
  if (kind === 'water') return water(hasDepth)
  if (kind === 'shell') return shell()
  if (kind === 'architecture') return architecture()
  return plant()
}

/** Whether a kind is drawn by the Atlas (and so is shown without tone mapping while it is on). */
export const atlasDraws = (kind: string) => kind !== 'creature'

function terrain(): string {
  return `
    if (uAtlasOn > 0.5) {
      vec3 atP = vMistPos;
      ${LIGHT}
      // MATERIALS, from the ground's own weights (vegGround.ts, 16 m, smooth) rather than its noise-broken drawing: bold, clean shapes whose edges wander
      // only at a broad scale (about 40 m and 12 m), so a wood is one mass with a drawn edge, not lace. Whatever the ground is not is rock.
      float atSteep = 1.0 - atWn.y;
      vec4 atW = vec4(0.0);
      if (uVegGroundOn > 0.5 && vegUv.x > 0.0 && vegUv.y > 0.0 && vegUv.x < 1.0 && vegUv.y < 1.0) atW = texture2D(uVegGround, vegUv);
      float atFlat = smoothstep(0.42, 0.78, atWn.y);
      float atEdgeN = (styNoise(atP.xz / 40.0) - 0.5) * 0.3 + (styNoise(atP.xz / 12.0 + 5.0) - 0.5) * 0.12;
      vec4 atM = vec4(
        smoothstep(0.36, 0.5, atW.r * atFlat + atEdgeN),
        smoothstep(0.34, 0.5, atW.g * (0.45 + 0.55 * atFlat) + atEdgeN),
        smoothstep(0.32, 0.48, atW.b * atFlat + atEdgeN),
        smoothstep(0.34, 0.52, atW.a + atEdgeN * 0.6));
      float atSlateK = clamp(smoothstep(170.0, 400.0, atP.y) * 0.75 + smoothstep(0.45, 0.8, atSteep) * 0.55, 0.0, 1.0);
      vec3 atAlb = mix(mix(AT_STONE, AT_STONE_DEEP, smoothstep(0.3, 0.6, atSteep) * (1.0 - atSlateK)), AT_SLATE, atSlateK);
      atAlb = mix(atAlb, AT_SAND, atM.a * 0.9);
      atAlb = mix(atAlb, mix(AT_MEADOW, AT_MEADOW_DRY, smoothstep(0.55, 0.85, styNoise(atP.xz * 0.004 + 17.0)) * 0.6), atM.b * 0.95);
      atAlb = mix(atAlb, AT_WOOD, atM.r * 0.95);
      atAlb = mix(atAlb, AT_MOSS, atM.g * 0.8);
      float atVeg = clamp(atM.r + atM.g + atM.b, 0.0, 1.0);
      // Broad, slow variation of tone (about 150 m), fixed to the ground: no flat colour, no grain.
      atAlb *= 0.95 + 0.1 * styNoise(atP.xz * 0.0065 + 3.0);
      // SHADED RELIEF: the sun and the map light together; the shade is a cool slate wash a step down, never black.
      float atRelief = mix(atMap, atSun, 0.55 * atDay);
      float atTone = 0.7 + 0.36 * atRelief;
      float atShadeK = (1.0 - smoothstep(0.05, 0.45, atSun)) * atDay;
      vec3 atCol = atAlb * atTone;
      atCol = mix(atCol, atCol * AT_SHADE * 1.06, atShadeK * 0.75);
      // LINES. Contours only on the high ground: the interval is chosen (by octaves, blended) so lines stay at least about sixteen pixels apart.
      float atMtn = (1.0 - atVeg) * smoothstep(110.0, 240.0, atP.y);
      float atHy = max(fwidth(atP.y), 1e-4);
      float atK = log2(max(atHy * 16.0 / 10.0, 1.0));
      float atI = 10.0 * exp2(floor(atK));
      float atC1 = atLine(fract(atP.y / atI + 0.5) - 0.5, fwidth(atP.y / atI), 0.9);
      float atC2 = atLine(fract(atP.y / (atI * 2.0) + 0.5) - 0.5, fwidth(atP.y / (atI * 2.0)), 0.9);
      float atContour = mix(atC1, atC2, fract(atK));
      // Every fifth line (an index contour) a little heavier.
      float atIdx = atLine(fract(atP.y / (atI * 5.0) + 0.5) - 0.5, fwidth(atP.y / (atI * 5.0)), 1.4);
      atContour = max(atContour * 0.3, atIdx * 0.55) * atMtn * (1.0 - smoothstep(1400.0, 3200.0, atDist) * 0.5);
      // Slope marks: only on steep rock, mostly on the side turned from the sun, running down the fall line; their spacing follows the pixel size.
      vec2 atFall = atWn.xz / max(length(atWn.xz), 1e-4);
      float atHatchK = smoothstep(0.38, 0.72, atSteep) * (1.0 - atVeg) * (0.18 + 0.62 * atShadeK);
      float atHatch = min(styStrokes(atP.xz * 0.9, atFall), 1.0) * atHatchK * 0.55;
      // Ridgelines and skylines: where the form turns from the eye, in slate; and the folds of steep bare rock, close only (not the mesh's seams on gentle ground).
      float atNdv = abs(dot(atN, normalize(vViewPosition)));
      float atSil = (1.0 - smoothstep(1.0, 2.4, atNdv / max(fwidth(atNdv), 1e-5))) * smoothstep(0.25, 0.6, atSteep) * 0.7;
      float atFold = smoothstep(0.25, 0.6, length(fwidth(atWn))) * 0.45 * (1.0 - smoothstep(250.0, 900.0, atDist)) * (1.0 - atVeg) * smoothstep(0.3, 0.6, atSteep);
      // The woodland's edge, a dark moss line where the floor gives way to open ground.
      float atWoodEdge = atLine(atM.r - 0.5, fwidth(atM.r), 0.8) * 0.55 * (1.0 - smoothstep(900.0, 2600.0, atDist));
      // Close range only (they fade out as a pixel grows past a few decimetres): the woodland as loose clusters of crowns, the meadow as a few short
      // strokes of grass. Both are fixed to the ground, sized in metres, and drawn as shapes, not grain.
      float atPx = length(fwidth(atP.xz));
      vec2 atCell = atP.xz / 6.5;
      vec2 atCi = floor(atCell);
      vec2 atJit = vec2(styHash(atCi), styHash(atCi + 17.3)) * 0.5 - 0.25;
      float atCr = length(fract(atCell) - 0.5 - atJit);
      float atCrownAa = fwidth(atCell.x) * 1.2;
      float atCrown = (1.0 - smoothstep(0.3 - atCrownAa, 0.3 + atCrownAa, atCr)) * step(0.35, styHash(atCi + 3.1)) * (1.0 - smoothstep(0.6, 1.4, atPx));
      atCol = mix(atCol, atCol * vec3(0.78, 0.84, 0.8), atCrown * atM.r * 0.7);
      float atGrass = min(styStrokes(atP.xz * 2.4, atFall), 1.0) * (1.0 - smoothstep(0.05, 0.3, atPx)) * smoothstep(0.4, 0.62, styNoise(atP.xz * 0.12));
      atCol = mix(atCol, atCol * vec3(0.84, 0.88, 0.8), atGrass * atM.b * (1.0 - atM.r) * 0.5);
      vec3 atInkC = mix(AT_SEPIA, AT_INK, atSlateK);
      atCol = mix(atCol, atInkC * (0.75 + 0.25 * atTone), clamp(max(max(atContour, atHatch), max(atSil, atFold)), 0.0, 1.0));
      atCol = mix(atCol, AT_WOOD_LINE, atWoodEdge * (1.0 - atMtn));
      // Night: the paper's own blue dusk, never black.
      atCol *= mix(AT_NIGHT, vec3(1.0), smoothstep(0.0, 0.25, atDay + 0.02));
      outgoingLight = atCol;
    }`
}

function water(hasDepth: boolean): string {
  return `
    if (uAtlasOn > 0.5) {
      ${LIGHT}
      // Mineral blue by depth (rivers, which carry no depth, are drawn shallow), with the shore drawn inside the water as a few depth lines.
      float atD = ${hasDepth ? 'vWaterDepth' : '0.6'};
      vec3 atCol = mix(AT_WATER_SHALLOW, AT_WATER_DEEP, smoothstep(0.2, 5.0, atD));
      ${hasDepth
        ? `float atFw = fwidth(atD);
      float atRings = atLine(atD - 0.06, atFw, 1.3) * 0.75 + atLine(atD - 0.55, atFw, 0.9) * 0.4 + atLine(atD - 1.6, atFw, 0.9) * 0.25;
      atRings *= 1.0 - smoothstep(1800.0, 4000.0, atDist) * 0.6;
      atCol = mix(atCol, AT_WATER_LINE, clamp(atRings, 0.0, 1.0));`
        : ''}
      // The water's own glints kept, a little: where the lit surface is much brighter than its body.
      float atGlint = smoothstep(1.4, 3.0, dot(outgoingLight, INK_LUMA));
      atCol = mix(atCol, vec3(1.0, 0.98, 0.93), atGlint * 0.5 * atDay);
      atCol *= 0.92 + 0.08 * atMap;
      atCol *= mix(AT_NIGHT, vec3(1.0), smoothstep(0.0, 0.25, atDay + 0.02));
      outgoingLight = atCol;
    }`
}

function shell(): string {
  return `
    if (uAtlasOn > 0.5) {
      vec3 atP = vMistPos;
      ${LIGHT}
      // The island's cut edge as sandstone strata: bands by height, a sepia line at each bed, going to slate toward the underside.
      float atBand = atP.y / 16.0 + 0.6 * styNoise(atP.xz * 0.01);
      float atBed = fract(atBand);
      vec3 atAlb = mix(AT_STONE, AT_STONE_DEEP, step(0.5, fract(floor(atBand) * 0.618)));
      atAlb = mix(atAlb, AT_SLATE, smoothstep(-60.0, -260.0, atP.y));
      float atTone = 0.68 + 0.36 * mix(atMap, atSun, 0.5 * atDay);
      vec3 atCol = atAlb * atTone;
      atCol = mix(atCol, atCol * AT_SHADE, (1.0 - smoothstep(0.05, 0.45, atSun)) * atDay * 0.6);
      float atStrata = atLine(atBed - 0.5, fwidth(atBand), 0.8) * 0.5 * (1.0 - smoothstep(1500.0, 4000.0, atDist) * 0.6);
      atCol = mix(atCol, AT_SEPIA, atStrata);
      atCol *= mix(AT_NIGHT, vec3(1.0), smoothstep(0.0, 0.25, atDay + 0.02));
      outgoingLight = atCol;
    }`
}

function architecture(): string {
  return `
    if (uAtlasOn > 0.5) {
      ${LIGHT}
      // Warm off-white stone with a little of its own colour (its age and weathering), a crisp cool shade, and sepia line on its silhouette and folds.
      vec3 atOwn = max(diffuseColor.rgb, vec3(1e-4));
      float atOwnL = dot(atOwn, INK_LUMA);
      vec3 atAlb = mix(AT_ARCH, AT_ARCH * atOwn / max(atOwnL, 1e-3) * 0.8, 0.18) * (0.9 + 0.2 * smoothstep(0.05, 0.5, atOwnL));
      float atLit = smoothstep(-0.02, 0.22, atNdl) * smoothstep(0.35, 0.65, atVis) * atDay;
      vec3 atCol = mix(AT_ARCH_SHADE * (atAlb / AT_ARCH) * (0.88 + 0.12 * atMap), atAlb * (0.94 + 0.08 * clamp(atNdl * 1.6, 0.0, 1.0)), atLit);
      float atNdv = abs(dot(atN, normalize(vViewPosition)));
      float atLine1 = 1.0 - smoothstep(1.0, 2.4, atNdv / max(fwidth(atNdv), 1e-5));
      float atCrease = smoothstep(0.18, 0.5, length(fwidth(inverseTransformDirection(atN, viewMatrix))));
      atCol = mix(atCol, AT_SEPIA, clamp(max(atLine1, atCrease * 0.7), 0.0, 1.0) * 0.85);
      atCol *= mix(AT_NIGHT, vec3(1.0), smoothstep(0.0, 0.25, atDay + 0.02));
      outgoingLight = atCol;
    }`
}

function plant(): string {
  return `
    if (uAtlasOn > 0.5) {
      ${LIGHT}
      // Leaves onto moss and sage by their own value; bark (where green does not lead) in sepia. Two soft tones of light, no speckle.
      vec3 atOwn = max(diffuseColor.rgb, vec3(1e-4));
      float atOwnL = dot(atOwn, INK_LUMA);
      float atGreen = smoothstep(-0.005, 0.02, atOwn.g - max(atOwn.r, atOwn.b));
      vec3 atLeaf = mix(AT_LEAF_DARK, AT_LEAF_LIGHT, smoothstep(0.03, 0.22, atOwnL));
      vec3 atAlb = mix(AT_BARK, atLeaf, atGreen);
      float atLit = smoothstep(-0.15, 0.35, atNdl) * smoothstep(0.3, 0.7, atVis) * atDay;
      vec3 atCol = atAlb * mix(0.72, 1.04, atLit);
      atCol = mix(atCol, atCol * AT_SHADE, (1.0 - atLit) * atDay * 0.45);
      atCol *= mix(AT_NIGHT, vec3(1.0), smoothstep(0.0, 0.25, atDay + 0.02));
      outgoingLight = atCol;
    }`
}
