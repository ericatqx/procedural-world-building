import { Color, Vector3 } from 'three'

/**
 * Shadow Ecology 0.3 - two World Visual Studies whose island carries the look (prototype 01 each). Like the Atlas and the Painting they are finishes on
 * every styled material (visualStyle.ts), switched by a uniform, never touching geometry, placement, ecology or the simulation, and not tone-mapped.
 *
 * ILLUSTRATED WORLD - STYLIZED (uIwOn). GRIS, Journey, Sable and the European science-fiction landscape: the island and its sky are one illustration in one
 * palette, not a 3D island over a picture. Broad colour regions with soft, simplified edges (the ground's smooth weights, wandering only at a scale of
 * about 90 m: no fine grain), a non-natural palette (ochre and warm ivory rock, dusty-rose open ground, burgundy woodland, mauve wet ground, slate-teal
 * water, ivory architecture), two tones of light with a soft band between them coloured by the hour, and distance turning toward the sky's own colour
 * below the horizon so the island sits inside its world.
 *
 * GRAPHIC DIORAMA (uDioOn). The island as a carved editorial model: its volumes read as deliberate planes, toned by which way they face as in an
 * isometric illustration (tops lightest, faces toward the light a step down, faces away in dusty lilac), cut into thin elevation layers like stacked
 * board, each surface one flat material (parchment rock, terracotta cliffs, muted olive meadow and woodland, chalk sand and architecture, deep teal
 * water with a chalk shore line), the cut edge of the island in terracotta and parchment strata. The sun still casts its shadow (a lilac wash) and the
 * night dims it; the background is a plain dark ground.
 */
export const worldsUniforms = {
  uIwOn: { value: 0 },
  uIwKey: { value: new Color('#FFF1DE') },
  uIwShade: { value: new Color('#8C7591') },
  uIwHaze: { value: new Color('#C9939C') },
  uIwNight: { value: 0 },
  uDioOn: { value: 0 },
  /** The sun's daylight, 0–1 (set by Sky.tsx): the night is the sun's absence, not the first light's strength (by night that light is the moon). */
  uWDay: { value: 1 },
  /** The sun's direction in the world (set by Sky.tsx): the Diorama's planes are lit from where the sun actually is. */
  uWSun: { value: new Vector3(0, 1, 0) },
  /** The sun's true height in degrees, below zero after sunset (set by Sky.tsx; uWSun is held just above the horizon at night). */
  uWElev: { value: 45 },
  /** Cloud cover, 0–1 (set by Sky.tsx): the same cloud that fades the cast shadows. */
  uWCloud: { value: 0 },
}

/** Which of the two is on, for the sky (Sky.tsx, StudySky.tsx). */
export const worldsScene = { stylized: false, diorama: false, dioramaBlack: false }

const v3 = (hex: string) => {
  const c = new Color(hex)
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`
}

export const WORLDS_HEAD = /* glsl */ `
uniform float uIwOn;
uniform vec3 uIwKey;
uniform vec3 uIwShade;
uniform vec3 uIwHaze;
uniform float uIwNight;
uniform float uDioOn;
uniform float uWDay;
uniform vec3 uWSun;
uniform float uWElev;
uniform float uWCloud;
// Illustrated World - Stylized. Each colour has one role: warm ivory and pale clay are the mountains, coral only their cliff faces, ochre-gold the open
// ground (the largest surface), wine the woodland, deep teal the water and the wet ground beside it, violet only in the shade (studySky.ts).
const vec3 IW_CLAY = ${v3('#DDC4A0')};
const vec3 IW_IVORY = ${v3('#F3E7D0')};
const vec3 IW_CORAL = ${v3('#C8786A')};
const vec3 IW_GOLD = ${v3('#CB9B55')};
const vec3 IW_WINE = ${v3('#6C2841')};
const vec3 IW_WET = ${v3('#3D6E6C')};
const vec3 IW_SAND = ${v3('#F1DFC2')};
const vec3 IW_WATER = ${v3('#17666F')};
const vec3 IW_WATER_SHALLOW = ${v3('#3E9C98')};
const vec3 IW_ARCH = ${v3('#F6EEDF')};
const vec3 IW_LEAF_DARK = ${v3('#4E1F33')};
const vec3 IW_LEAF_LIGHT = ${v3('#B5707A')};
const vec3 IW_BARK = ${v3('#4B2832')};
const vec3 IW_LINE = ${v3('#3E2234')};
// Graphic Diorama. Cream is the rock: parchment on the tops and gentle ground, sandstone on the slopes; terracotta only in a few named strata and the
// great cliff walls; olive ground, deep teal water, chalk architecture; the shade a saturated lilac-violet, a full step down in value.
const vec3 DIO_PARCHMENT = ${v3('#EADDC0')};
const vec3 DIO_SANDSTONE = ${v3('#D7C29B')};
const vec3 DIO_TERRACOTTA = ${v3('#B5603C')};
const vec3 DIO_OLIVE = ${v3('#9D9B62')};
const vec3 DIO_OLIVE_DEEP = ${v3('#5E6339')};
const vec3 DIO_MOSS = ${v3('#4E5F45')};
const vec3 DIO_CHALK = ${v3('#F3EFE5')};
const vec3 DIO_STONE = ${v3('#E8E0D0')};
const vec3 DIO_TEAL = ${v3('#1F4D52')};
const vec3 DIO_TEAL_SHALLOW = ${v3('#3E7A7B')};
const vec3 DIO_SHADE = ${v3('#6C6499')};
const vec3 DIO_UNDER = ${v3('#4A4560')};
const vec3 DIO_CLAY = ${v3('#C79A80')};
// (Round 14: a softer, greyer warm brown, in the island's palette between its clay and its moss; the old #7A4A36 read as a harsh terracotta on every trunk.)
const vec3 DIO_BARK = ${v3('#6B5A4C')};
// Black Stage (Round 08C): the palette is the Black Stage's own (olive, olive-deep, moss, the teals above). Only the shore's washed sand is its own,
// a warmer sand than the chalk mix (which drew the shorelines as white outlines).
const vec3 DS_SAND = ${v3('#E2D3B2')};
// The cast shadow's lavender: the sky's light in the shadow, a cool violet.
const vec3 DS_LAVENDER = ${v3('#8F86C2')};
`

/** The light terms both use: the sun's facing and shadow, how strong it is (day), distance. `p` names the variables. */
export const light = (p: string) => /* glsl */ `
      vec3 ${p}N = normalize(normal);
      vec3 ${p}Wn = inverseTransformDirection(${p}N, viewMatrix);
      float ${p}Ndl = 0.0;
      float ${p}KeyV = 0.0;
      #if NUM_DIR_LIGHTS > 0
        ${p}Ndl = dot(${p}N, directionalLights[0].direction);
        ${p}KeyV = dot(directionalLights[0].color, INK_LUMA);
      #endif
      float ${p}Vis = 1.0;
      #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
      {
        DirectionalLightShadow ${p}Ds = directionalLightShadows[0];
        ${p}Vis = getShadow(directionalShadowMap[0], ${p}Ds.shadowMapSize, ${p}Ds.shadowIntensity, ${p}Ds.shadowBias, ${p}Ds.shadowRadius, vDirectionalShadowCoord[0]);
      }
      #endif
      float ${p}Day = uWDay * smoothstep(0.02, 0.4, ${p}KeyV);
      float ${p}Dist = length(vViewPosition);`

/** The ground's own smooth weights (vegGround.ts, 16 m) as materials with soft edges that wander only at a broad scale. */
const weights = (p: string, wander: number, lo: number, hi: number) => /* glsl */ `
      vec4 ${p}W = vec4(0.0);
      if (uVegGroundOn > 0.5 && vegUv.x > 0.0 && vegUv.y > 0.0 && vegUv.x < 1.0 && vegUv.y < 1.0) ${p}W = texture2D(uVegGround, vegUv);
      float ${p}Flat = smoothstep(0.42, 0.78, ${p}Wn.y);
      float ${p}E = (styNoise(${p}P.xz / ${wander.toFixed(1)}) - 0.5) * 0.24;
      vec4 ${p}M = vec4(
        smoothstep(${lo.toFixed(2)}, ${hi.toFixed(2)}, ${p}W.r * ${p}Flat + ${p}E),
        smoothstep(${lo.toFixed(2)}, ${hi.toFixed(2)}, ${p}W.g * (0.45 + 0.55 * ${p}Flat) + ${p}E),
        smoothstep(${(lo - 0.02).toFixed(2)}, ${(hi - 0.02).toFixed(2)}, ${p}W.b * ${p}Flat + ${p}E),
        smoothstep(${lo.toFixed(2)}, ${hi.toFixed(2)}, ${p}W.a + ${p}E * 0.6)) * uFormGround;`

type Kind = 'terrain' | 'architecture' | 'plant' | 'creature' | 'water' | 'shell'

export function worldsChunk(kind: Kind, hasDepth: boolean): string {
  if (kind === 'creature') return ''
  return stylized(kind, hasDepth) + diorama(kind, hasDepth) + dioramaStage(kind, hasDepth)
}

// ------------------------------------------------------------------------------------------------- Illustrated World - Stylized

function stylized(kind: Kind, hasDepth: boolean): string {
  const open = `
    if (uIwOn > 0.5) {
      ${light('iw')}
      // Two tones of light with a soft band between, coloured by the hour (studySky.ts): the shade violet by day, a cool slate by night.
      float iwLit = smoothstep(-0.06, 0.32, iwNdl) * smoothstep(0.3, 0.7, iwVis);
      // Distance toward the colour of the world beneath the horizon: the island belongs to its sky.
      float iwAir = (1.0 - exp(-max(0.0, iwDist - 1200.0) / 7000.0)) * 0.45;`
  const close = `
      outgoingLight = mix(iwCol, uIwHaze, iwAir);
    }`
  if (kind === 'terrain') {
    return `${open}
      vec3 iwP = vMistPos;
      // COLOUR BLOCKING. The ground's weights, averaged over about sixty metres, cut with a short soft edge that wanders only at a broad scale. On steep
      // faces the plan-view map would stretch into slivers down the slope, so there the ground's colours give way (gradually) to the mountain's own.
      vec4 iwW = vec4(0.0);
      if (uVegGroundOn > 0.5 && vegUv.x > 0.0 && vegUv.y > 0.0 && vegUv.x < 1.0 && vegUv.y < 1.0) {
        float o = 30.0 / uVegSize;
        iwW = 0.36 * texture2D(uVegGround, vegUv) + 0.16 * (texture2D(uVegGround, vegUv + vec2(o, 0.0)) + texture2D(uVegGround, vegUv - vec2(o, 0.0)) + texture2D(uVegGround, vegUv + vec2(0.0, o)) + texture2D(uVegGround, vegUv - vec2(0.0, o)));
      }
      float iwSteep = 1.0 - iwWn.y;
      float iwKeep = 1.0 - smoothstep(0.36, 0.6, iwSteep);
      float iwE = (styNoise(iwP.xz / 160.0) - 0.5) * 0.18;
      float iwWood = smoothstep(0.28, 0.36, iwW.r + iwE) * iwKeep;
      float iwWet = smoothstep(0.3, 0.38, iwW.g + iwE) * (1.0 - iwWood) * iwKeep;
      float iwOpen = smoothstep(0.24, 0.32, iwW.b + iwE) * (1.0 - iwWood) * iwKeep;
      float iwSand = smoothstep(0.32, 0.42, iwW.a + iwE * 0.5) * (1.0 - iwWood) * (1.0 - iwOpen) * iwKeep;
      // (Formation: the ground's cover cross-fades in as a whole after the thresholds, so no hard-edged block sweeps across while it comes.)
      iwWood *= uFormGround; iwWet *= uFormGround; iwOpen *= uFormGround; iwSand *= uFormGround;
      float iwMtn = clamp(1.0 - iwWood - iwWet - iwOpen - iwSand, 0.0, 1.0);
      // The mountain: pale clay low, warm ivory high, coral only on its steep faces.
      vec3 iwAlb = mix(IW_CLAY, IW_IVORY, smoothstep(140.0, 360.0, iwP.y));
      // (Coral is the cliff face itself: a crisp, anti-aliased edge where the slope turns to cliff, not a soft blush over it.)
      float iwAaS = max(fwidth(iwSteep), 0.008);
      iwAlb = mix(iwAlb, IW_CORAL, smoothstep(0.56 - iwAaS, 0.56 + iwAaS, iwSteep) * 0.8);
      iwAlb = mix(iwAlb, IW_SAND, iwSand);
      iwAlb = mix(iwAlb, IW_GOLD, iwOpen);
      iwAlb = mix(iwAlb, IW_WET, iwWet * 0.85);
      iwAlb = mix(iwAlb, IW_WINE, iwWood);
      // VALUE HIERARCHY: woodland the darkest mass (its rim a touch deeper), open ground mid and evenly lit, mountains the lightest and the most
      // modelled: their shade goes a full step down into the hour's shade colour, the open ground's only half a step.
      iwAlb *= 1.0 - 0.18 * 4.0 * iwWood * (1.0 - iwWood);
      float iwModel = mix(0.45, 1.0, iwMtn);
      vec3 iwShadeC = iwAlb * uIwShade * mix(1.35, 0.95, iwModel);
      vec3 iwLitC = iwAlb * uIwKey * (1.0 + 0.06 * iwMtn);
      vec3 iwCol = mix(iwShadeC, iwLitC, iwLit * iwDay);
      iwCol = mix(iwCol, iwAlb * uIwShade * 0.9, uIwNight * 0.6);${close}`
  }
  if (kind === 'water') {
    return `${open}
      // Water keeps its own deep teal at every hour: lit by how bright the hour is, not tinted by its colour; a clearer shallow band, a little of the
      // sky at grazing angles, and the sun's glint kept small.
      float iwD = ${hasDepth ? 'vWaterDepth' : '0.8'};
      vec3 iwAlb = mix(IW_WATER_SHALLOW, IW_WATER, smoothstep(0.25, 2.2, iwD));
      float iwKeyL = dot(uIwKey, INK_LUMA);
      vec3 iwCol = iwAlb * (0.22 + 0.9 * iwKeyL) * (1.0 - 0.4 * uIwNight);
      float iwFres = pow(1.0 - clamp(abs(dot(iwN, normalize(vViewPosition))), 0.0, 1.0), 4.0);
      iwCol = mix(iwCol, uIwHaze * 0.9, iwFres * 0.35);
      iwCol += uIwKey * smoothstep(1.6, 3.0, dot(outgoingLight, INK_LUMA)) * 0.25 * iwDay;
      ${hasDepth ? 'iwCol = mix(iwCol, IW_IVORY * (0.3 + 0.75 * iwKeyL), atLine(iwD - 0.05, fwidth(iwD), 1.2) * 0.55);' : ''}${close}`
  }
  if (kind === 'shell') {
    return `${open}
      vec3 iwP = vMistPos;
      // The cut edge in a few broad bands of clay and coral, deepening to wine beneath.
      float iwB = floor(iwP.y / 40.0);
      vec3 iwAlb = mix(IW_CLAY, IW_CORAL, step(0.5, fract(iwB * 0.5)) * 0.45);
      iwAlb = mix(iwAlb, IW_WINE, smoothstep(-40.0, -260.0, iwP.y));
      vec3 iwCol = mix(iwAlb * uIwShade * 1.05, iwAlb * uIwKey, iwLit * iwDay);${close}`
  }
  if (kind === 'architecture') {
    return `${open}
      vec3 iwCol = mix(IW_ARCH * uIwShade * 1.1, IW_ARCH * uIwKey, iwLit * iwDay);
      float iwNdv = abs(dot(iwN, normalize(vViewPosition)));
      iwCol = mix(iwCol, IW_LINE, (1.0 - smoothstep(1.0, 2.4, iwNdv / max(fwidth(iwNdv), 1e-5))) * 0.6);${close}`
  }
  return `${open}
      vec3 iwOwn = max(diffuseColor.rgb, vec3(1e-4));
      float iwGreen = smoothstep(-0.005, 0.02, iwOwn.g - max(iwOwn.r, iwOwn.b));
      vec3 iwAlb = mix(IW_BARK, mix(IW_LEAF_DARK, IW_LEAF_LIGHT, smoothstep(0.03, 0.24, dot(iwOwn, INK_LUMA))), iwGreen);
      vec3 iwCol = mix(iwAlb * uIwShade * 1.1, iwAlb * uIwKey, iwLit * iwDay);${close}`
}

// ------------------------------------------------------------------------------------------------- Graphic Diorama

/**
 * The Graphic Diorama on its dark table (uDioOn = 1): prototype 01 as it was, kept unchanged so the refined Black Stage below can be compared with it.
 * (The Black Stage, uDioOn = 2, is dioramaStage.)
 */
function diorama(kind: Kind, hasDepth: boolean): string {
  const open = `
    if (uDioOn > 0.5 && uDioOn < 1.5) {
      ${light('dio')}
      // PLANES LIT BY THE SUN, IN THREE VALUES. Each surface is one of three flat planes by how it faces where the sun actually is (uWSun): full sun (the
      // colour itself, warmed as the sun lowers), glancing sun (a clear step down), or turned away / in cast shadow (the colour drawn toward a saturated
      // lilac-violet and a full step down again). The planes meet at narrow, anti-aliased edges, so volumes read as carved faces at any hour. The shade is
      // a cool lilac TINT on each material (its own hue kept, a full step down) with a little of the one shared lilac, so shaded olive stays olive rather
      // than going grey, and the island never turns muddy at sunset.
      vec3 dioS = normalize(uWSun);
      float dioSunNdl = dot(dioWn, dioS);
      float dioAa = max(fwidth(dioSunNdl), 0.012);
      float dioCast = (1.0 - smoothstep(0.3, 0.7, dioVis)) * dioDay;
      float dioUp = step(0.0, dioS.y);
      float dioSun = smoothstep(0.05 - dioAa, 0.05 + dioAa, dioSunNdl) * (1.0 - dioCast) * dioUp;
      float dioFull = smoothstep(0.45 - dioAa, 0.45 + dioAa, dioSunNdl) * dioSun;
      vec3 dioWarm = mix(vec3(1.0, 0.99, 0.97), vec3(1.07, 0.97, 0.84), 1.0 - smoothstep(0.15, 0.6, dioS.y));
      float dioNight = 1.0 - dioDay;`
  const close = `
      // (Applied in linear light: these are deep, so the night reads dark after the display's encoding.)
      dioCol *= mix(vec3(1.0), vec3(0.07, 0.08, 0.12), dioNight);
      outgoingLight = dioCol;
    }`
  const planes = (alb: string) =>
    `mix(mix(${alb} * vec3(0.5, 0.49, 0.66), DIO_SHADE * 0.62, 0.22), mix(${alb} * 0.8, ${alb} * dioWarm, dioFull), dioSun)`
  if (kind === 'terrain') {
    return `${open}
      vec3 dioP = vMistPos;
      ${weights('dio', 60, 0.38, 0.46)}
      float dioSteep = 1.0 - dioWn.y;
      float dioAaS = max(fwidth(dioSteep), 0.008);
      float dioRock = 1.0 - clamp(dioM.r + dioM.g + dioM.b + dioM.a, 0.0, 1.0);
      // GEOLOGY. Cream is the rock: parchment where it is gentle, sandstone where it slopes, the two meeting at a crisp edge. Terracotta is three named
      // strata at fixed elevations (warped by a broad, slow undulation of about +/-12 m, so they are not ruler-straight), each exposed only where the rock is
      // steep enough to show its beds, plus the great cliff walls. Every edge is a narrow anti-aliased step, not a soft ramp: no smeared blobs.
      float dioY = dioP.y + (styNoise(dioP.xz / 700.0) - 0.5) * 24.0;
      float dioAaY = max(fwidth(dioY), 0.05);
      float dioStrata = max(max(
        1.0 - smoothstep(9.0 - dioAaY, 9.0 + dioAaY, abs(dioY - 150.0)),
        1.0 - smoothstep(12.0 - dioAaY, 12.0 + dioAaY, abs(dioY - 236.0))),
        1.0 - smoothstep(7.0 - dioAaY, 7.0 + dioAaY, abs(dioY - 328.0)));
      float dioSlope = smoothstep(0.3 - dioAaS, 0.3 + dioAaS, dioSteep);
      float dioWall = smoothstep(0.74 - dioAaS, 0.74 + dioAaS, dioSteep);
      float dioTerra = dioRock * max(dioSlope * dioStrata, dioWall * 0.9);
      vec3 dioAlb = mix(DIO_PARCHMENT, DIO_SANDSTONE, dioSlope * dioRock);
      dioAlb = mix(dioAlb, DIO_TERRACOTTA, dioTerra);
      dioAlb = mix(dioAlb, DIO_CHALK, dioM.a);
      dioAlb = mix(dioAlb, DIO_OLIVE, dioM.b);
      dioAlb = mix(dioAlb, DIO_OLIVE_DEEP, dioM.r);
      dioAlb = mix(dioAlb, DIO_MOSS, dioM.g * 0.85);
      vec3 dioCol = ${planes('dioAlb')};
      // Stacked board: thin elevation layers, each a shade apart, with a fine cut line between them.
      float dioL = dioP.y / 30.0;
      dioCol *= 1.0 + 0.025 * (step(0.5, fract(floor(dioL) * 0.5)) * 2.0 - 1.0);
      dioCol *= 1.0 - 0.15 * atLine(fract(dioL + 0.5) - 0.5, fwidth(dioL), 0.8) * (1.0 - smoothstep(2500.0, 6000.0, dioDist));${close}`
  }
  if (kind === 'water') {
    return `${open}
      float dioD = ${hasDepth ? 'vWaterDepth' : '0.8'};
      vec3 dioCol = mix(DIO_TEAL_SHALLOW, DIO_TEAL, smoothstep(0.2, 2.5, dioD)) * mix(0.82, 1.0, dioUp * (1.0 - dioCast));
      ${hasDepth ? 'dioCol = mix(dioCol, DIO_CHALK, atLine(dioD - 0.06, fwidth(dioD), 1.6) * 0.85);' : ''}${close}`
  }
  if (kind === 'shell') {
    return `${open}
      vec3 dioP = vMistPos;
      // THE CUT EDGE, QUIET. A few broad strata (about 70 m, gently warped so they run on round the island), sandstone, clay and a pale terracotta close
      // in value and low in saturation, with soft edges; under them the layers sink into a deep, quiet slate-plum. Lit smoothly by the sun's direction
      // (no cast shadow, no plane edges: the underside's irregular facets made dark marks), so the underside stays secondary to the land.
      float dioY = dioP.y + (styNoise(dioP.xz / 500.0) - 0.5) * 20.0;
      float dioB = dioY / 70.0;
      float dioBi = floor(dioB);
      float dioF = fract(dioB);
      vec3 dioA = mix(DIO_SANDSTONE, DIO_CLAY, step(0.5, fract(dioBi * 0.5)));
      vec3 dioNext = mix(DIO_SANDSTONE, DIO_CLAY, step(0.5, fract((dioBi + 1.0) * 0.5)));
      vec3 dioAlb = mix(dioA, dioNext, smoothstep(0.88, 1.0, dioF));
      dioAlb = mix(dioAlb, DIO_UNDER, smoothstep(-20.0, -230.0, dioP.y));
      float dioSoft = clamp(dioSunNdl * 0.5 + 0.5, 0.0, 1.0) * dioUp;
      vec3 dioCol = mix(mix(dioAlb, DIO_SHADE, 0.35) * 0.62, dioAlb * 0.9, dioSoft);${close}`
  }
  if (kind === 'architecture') {
    return `${open}
      // Chalk stone in the same three planes, a little below white, with its folds drawn by a quiet step in value (structure, not outline).
      vec3 dioCol = ${planes('DIO_STONE')};
      // Its own planes as well, whatever the sun: tops lightest, the two wall orientations a step apart, so even at noon (when the sun lights most walls
      // alike) a structure reads as a carved block and never as one white shape.
      dioCol *= mix(mix(0.8, 0.9, step(abs(dioWn.z), abs(dioWn.x))), 0.98, smoothstep(0.55, 0.85, dioWn.y));
      float dioFold = smoothstep(0.18, 0.5, length(fwidth(dioWn)));
      dioCol *= 1.0 - 0.2 * dioFold;${close}`
  }
  return `${open}
      vec3 dioOwn = max(diffuseColor.rgb, vec3(1e-4));
      float dioGreen = smoothstep(-0.005, 0.02, dioOwn.g - max(dioOwn.r, dioOwn.b));
      vec3 dioAlb = mix(DIO_BARK, mix(DIO_MOSS, DIO_OLIVE, smoothstep(0.04, 0.24, dot(dioOwn, INK_LUMA))), dioGreen);
      vec3 dioCol = ${planes('dioAlb')};${close}`
}

// ------------------------------------------------------------------------------------------------- Graphic Diorama - Black Stage (refinement 01)

/**
 * The Graphic Diorama on its black stage (uDioOn = 2): the same palette and the same carved, three-plane language as the dark table above, with the
 * hour drawn through light rather than effects.
 *
 *   day          the three planes as before: full sun (warmed as the sun lowers), glancing sun, and turned away or in cast shadow (the lilac)
 *   cloud        softens the planes toward sky light over the same range of cloud in which the cast shadows fade
 *   golden hour  warmer light, cooler shade, a little more depth with distance
 *   dusk         the sun's planes fade with the sun itself; the island is lit by the sky, dimming toward blue
 *   night        no sun at all (its direction is only held at the horizon): a soft, cool moonlight from above, each material keeping a trace of its hue
 */

// ------------------------------------------------------------------------------------------------- the Black Stage's rules, shared with Explore Data

/**
 * The Black Stage's light, ground and geology as GLSL snippets with a variable prefix, so the diagnostic views (visualDiagnostics.ts) read exactly the
 * same rules as the final render. stageHour needs <p>Wn and <p>Vis (from light()); stageGround and stageGeology need <p>Wn and <p>P.
 */
export const stageHour = (p: string) => /* glsl */ `
      // THE HOUR, from the sun's true height (uWElev: degrees, below zero after sunset; uWSun is held just above the horizon at night and cannot say
      // whether the sun is up) and the cloud. Each phase is its own ramp, so morning, midday, golden hour, dusk and night move into one another.
      float ${p}El = uWElev;
      // Round 08B: the light is two sources ADDED, the sun and the sky (stageLit), so there is nothing to switch. The sun's share fades with its
      // height (7 to -2 degrees); a cast shadow is the place that sun does not reach, so as the sun fades the lit land darkens toward the shadows'
      // own value and the two meet: shadows cannot vanish while the land stays bright, nor the land brighten before its shadows appear. The sky's
      // light dims over 8 to -8 degrees, overlapping the sun's fade (as real skylight falls steeply near sunset), and night comes by -14. (Sky.tsx keeps the shadow map in place through the horizon.)
      float ${p}SunK = smoothstep(-2.0, 7.0, ${p}El);
      float ${p}SunI = ${p}SunK * (1.0 - 0.85 * smoothstep(0.45, 0.95, uWCloud));
      float ${p}SkyK = smoothstep(-14.0, 1.0, ${p}El);
      float ${p}Gold = (1.0 - smoothstep(4.0, 26.0, ${p}El)) * smoothstep(-3.0, 1.0, ${p}El);
      vec3 ${p}Twi = mix(vec3(0.3, 0.3, 0.42), vec3(1.0), smoothstep(-8.0, 8.0, ${p}El));
      vec3 ${p}NightT = vec3(0.066, 0.075, 0.125);
      // Cloud softens the planes over the range in which it fades the cast shadows (Sky.tsx: the shadow's intensity falls with cloud).
      // (Round 15: over the same range as the cast shadows now fade (Sky.tsx): a moderate overcast keeps the sun's modelling and its lavender shadow.)
      float ${p}CloudK = smoothstep(0.45, 0.95, uWCloud);
      vec3 ${p}S = normalize(uWSun);
      float ${p}SunNdl = dot(${p}Wn, ${p}S);
      // (The facing the light planes are cut on: on the terrain, terrainSun replaces it with the relief's alone.)
      float ${p}SunNdlR = ${p}SunNdl;
      float ${p}Aa = max(fwidth(${p}SunNdl), 0.012);
      // (A wider step on the shadow map: its ragged, texel-stepped edges read as a soft edge, not a saw.)
      float ${p}Cast = 1.0 - smoothstep(0.2, 0.8, ${p}Vis);
      float ${p}SunP = smoothstep(0.05 - ${p}Aa, 0.05 + ${p}Aa, ${p}SunNdl) * (1.0 - ${p}Cast);
      // Full sun against glancing sun over a broader step than the shade's edge: on undulating ground it was a scatter of small grey patches;
      // the main graphic edge, sun against shade, stays crisp.
      float ${p}Full = smoothstep(0.45 - max(${p}Aa, 0.06), 0.45 + max(${p}Aa, 0.06), ${p}SunNdl) * ${p}SunP;
      vec3 ${p}Warm = mix(vec3(1.0, 0.99, 0.97), vec3(1.08, 0.96, 0.82), ${p}Gold);
      // How much of the sky a face sees, and how it faces the moon (Sky.tsx's moon light).
      float ${p}SkyN = ${p}Wn.y * 0.5 + 0.5;
      float ${p}Moon = clamp(dot(${p}Wn, normalize(vec3(-0.42, 0.75, 0.51))) * 0.5 + 0.5, 0.0, 1.0);`

export const stageGround = (p: string) => /* glsl */ `
      // GROUND MATERIALS. The ground's own weights (vegGround.ts, 16 m texels), averaged over five taps about twenty metres apart, so a weight hovering
      // at a threshold no longer leaves texel-sized specks and each material reads as one coherent area. Where each material lies is unchanged.
      vec4 ${p}W = vec4(0.0);
      if (uVegGroundOn > 0.5 && vegUv.x > 0.0 && vegUv.y > 0.0 && vegUv.x < 1.0 && vegUv.y < 1.0) {
        float o = 20.0 / uVegSize;
        ${p}W = 0.4 * texture2D(uVegGround, vegUv) + 0.15 * (texture2D(uVegGround, vegUv + vec2(o, 0.0)) + texture2D(uVegGround, vegUv - vec2(o, 0.0)) + texture2D(uVegGround, vegUv + vec2(0.0, o)) + texture2D(uVegGround, vegUv - vec2(0.0, o)));
        // And a broader ring (about 45 m): a weak patch standing alone in rock (a few texels of thin meadow on a mountain bench) no longer becomes an
        // isolated island of colour, while a real meadow or grove, present all around, keeps its shape. (Rendering only: the weights are the ecology's.)
        float o2 = 45.0 / uVegSize;
        vec4 ${p}Wb = 0.25 * (texture2D(uVegGround, vegUv + vec2(o2, 0.0)) + texture2D(uVegGround, vegUv - vec2(o2, 0.0)) + texture2D(uVegGround, vegUv + vec2(0.0, o2)) + texture2D(uVegGround, vegUv - vec2(0.0, o2)));
        ${p}W = mix(${p}W, ${p}Wb, 0.35);
      }
      float ${p}Steep = 1.0 - ${p}Wn.y;
      // Round 08B: plants keep to the ground by its SLOPE FROM THE GEOLOGY MAP (rise over run on the 16 m grid, the same at every distance), over a
      // broad ramp that lets them climb to about 1.1, so a mountainside the ecology covers stays one connected zone. From the mesh's normal (as
      // before) the greens broke into fragments wherever the facets tilted, and moved with the level of detail. (Until the map exists, the normal.)
      float ${p}SlG = sqrt(max(1.0 - ${p}Wn.y * ${p}Wn.y, 0.0)) / max(${p}Wn.y, 0.05);
      if (uVegGeoOn > 0.5 && vegUv.x > 0.0 && vegUv.y > 0.0 && vegUv.x < 1.0 && vegUv.y < 1.0) ${p}SlG = texture2D(uVegGeo, vegUv).r * 3.0;
      float ${p}Flat = 1.0 - smoothstep(0.45, 1.15, ${p}SlG);
      // The edge wanders at two scales (about 90 m and 23 m), so the zones have organic outlines, not the 16 m map's soft blocks.
      float ${p}E = (styNoise(${p}P.xz / 90.0) - 0.5) * 0.12 + (styNoise(${p}P.xz / 23.0 + 5.3) - 0.5) * 0.08;
      // The two dark greens, woodland floor and moss (the damp, shaded ground), are one mass, cut once; inside it the hue moves softly from one to the
      // other by which weight leads, so a grove and its mossy hollow make one shape instead of two sets of fragments.
      float ${p}FloorW = ${p}W.r * ${p}Flat;
      float ${p}MossW = ${p}W.g * (0.45 + 0.55 * ${p}Flat);
      // Each material is cut at its threshold with an edge a pixel or so wide (anti-aliased by its own screen gradient), not over a fixed range of
      // weight: a fixed range became a wide blur up close, where the 16 m weights change slowly across the screen. The shapes come from the weights
      // (smooth already) and the broad wander, so a crisp edge is still a calm one, and from afar it widens on its own.
      // Round 08B: each edge a narrow feathered band (about 0.03 of weight, a few metres) rather than a pixel: the zones meet as ground does, not as
      // cut paper. The shapes are still the ecology's.
      float ${p}Dv = max(${p}FloorW, ${p}MossW) + ${p}E;
      float ${p}DvW = max(fwidth(${p}Dv) * 1.5, 0.03);
      float ${p}Dark = smoothstep(0.41 - ${p}DvW, 0.41 + ${p}DvW, ${p}Dv);
      vec3 ${p}DarkC = mix(DIO_OLIVE_DEEP, mix(DIO_OLIVE_DEEP, DIO_MOSS, 0.85), smoothstep(-0.1, 0.1, ${p}MossW - ${p}FloorW));
      float ${p}Mv = ${p}W.b * ${p}Flat + ${p}E;
      float ${p}MvW = max(fwidth(${p}Mv) * 1.5, 0.03);
      float ${p}Mead = smoothstep(0.4 - ${p}MvW, 0.4 + ${p}MvW, ${p}Mv) * (1.0 - ${p}Dark);
      // The shore on the land: gravel (the shoreline weight) only in the narrow band at the water itself, where its weight is highest.
      float ${p}Sv = ${p}W.a + ${p}E * 0.5;
      float ${p}Shore = smoothstep(0.57 - max(fwidth(${p}Sv) * 1.2, 0.004), 0.57 + max(fwidth(${p}Sv) * 1.2, 0.004), ${p}Sv) * (1.0 - ${p}Dark) * (1.0 - ${p}Mead);
      // (Formation: the cover cross-fades in after the thresholds, never by moving them, which swept hard-edged blocks across the ground.)
      ${p}Dark *= uFormGround; ${p}Mead *= uFormGround; ${p}Shore *= uFormGround;
      float ${p}Live = clamp(${p}Dark + ${p}Mead, 0.0, 1.0);
      float ${p}Rock = 1.0 - clamp(${p}Live + ${p}Shore, 0.0, 1.0);
`

/**
 * THE ROCK: a geological model, not decoration (Round 04). The island's landforms (terrain.ts) are uplifted massifs cut by ridges and drainage, read here as
 * a flat-lying stack of sedimentary rock, raised and eroded. The colour of bare rock at a place follows from two things only:
 *
 *   WHERE IT SITS IN THE STACK (stratigraphic height: the elevation, with the stack dipping 2 % to the north-east and broadly warped, so the layers cross
 *   the contours at a slight angle, as tilted strata do)
 *     Lower Sandstone     below about 150 m   the oldest unit: warm sandstone, iron-tinged (sandstone toward clay)
 *     Middle Sandstone    150 to 330 m        sandstone, paling upward as its sand gets cleaner (sandstone toward parchment)
 *     Caprock             above about 330 m   pale, resistant rock (parchment) that holds up the summits
 *     red mudstone beds   at 150, 236, 328 m  soft, iron-rich mudstone between the sandstone units (the first and last at the units' bases). Being soft,
 *                                             it is buried under weathered debris on gentle ground and shows only where a slope cuts through it.
 *
 *   WHAT THE SURFACE HAS DONE TO IT (from the geology map, terrainGeology.ts: the slope, the convexity and the cliff above, all on the island's 16 m grid,
 *   so they read the same at every camera distance)
 *     weathered           gentle bare rock and crests bleach toward a pale rind (the weathered surface)
 *     fresh               steep faces show the rock as it is, a little deeper and warmer
 *     iron-stained        the steepest cliffs are stained toward terracotta by iron oxide washed down from the mudstone
 *     scree               below a cliff, on the concave footslope where fallen rock rests: debris of the rock above, a shade darker, reddened where a
 *                         mudstone bed lies just above it
 *
 * The rest is illustrative: the palette, the two broad tonal variations (lateral facies, about 650 m) and, close up on fresh faces only, faint bedding lines.
 */
export const stageGeology = (p: string) => ROCK_MODEL === 'zones' ? stageGeologyZones(p) : /* glsl */ `
      vec4 ${p}G = vec4(0.0, 0.5, 0.0, 0.0);
      bool ${p}GeoOk = uVegGeoOn > 0.5 && vegUv.x > 0.0 && vegUv.y > 0.0 && vegUv.x < 1.0 && vegUv.y < 1.0;
      if (${p}GeoOk) ${p}G = texture2D(uVegGeo, vegUv);
      // Slope as rise over run; until the map is built (the first seconds), from the surface's own normal.
      float ${p}Sl = ${p}GeoOk ? ${p}G.r * 3.0 : sqrt(max(1.0 - ${p}Wn.y * ${p}Wn.y, 0.0)) / max(${p}Wn.y, 0.05);
      float ${p}Cv = ${p}GeoOk ? (${p}G.g - 0.5) * 24.0 : 0.0;
      float ${p}Cliff = ${p}GeoOk ? ${p}G.b : 0.0;
      // Stratigraphic height.
      float ${p}Y = ${p}P.y + dot(${p}P.xz, vec2(0.012, 0.016)) + (styNoise(${p}P.xz / 700.0) - 0.5) * 24.0;
      float ${p}AaY = max(fwidth(${p}Y), 0.05);
      // The formations, meeting over a few metres at the mudstone beds that divide them; the Middle Sandstone pales gradually upward.
      vec3 ${p}Lith = mix(mix(DIO_SANDSTONE, DIO_CLAY, 0.32), DIO_SANDSTONE, smoothstep(140.0, 160.0, ${p}Y));
      ${p}Lith = mix(${p}Lith, mix(DIO_SANDSTONE, DIO_PARCHMENT, 0.45), smoothstep(170.0, 310.0, ${p}Y));
      ${p}Lith = mix(${p}Lith, DIO_PARCHMENT, smoothstep(318.0, 338.0, ${p}Y));
      float ${p}Form = smoothstep(140.0, 160.0, ${p}Y) + smoothstep(318.0, 338.0, ${p}Y);
      // Lateral facies: one formation a shade warmer or paler from place to place, broadly (about 650 m), as its sand was laid down a little differently.
      ${p}Lith *= 1.0 + (styNoise(${p}P.xz / 650.0 + 17.0) - 0.5) * 0.07;
      // Weathered: gentle bare rock and crests (the most exposed ground) bleach toward a pale ivory rind.
      float ${p}Weath = clamp((1.0 - smoothstep(0.5, 0.95, ${p}Sl)) * 0.38 + smoothstep(1.5, 8.0, ${p}Cv) * 0.32, 0.0, 0.6);
      vec3 ${p}GeoC = mix(${p}Lith, mix(DIO_PARCHMENT, DIO_CHALK, 0.3), ${p}Weath);
      // The most exposed crests and ridge lines (strongly convex) weather palest of all: an ivory highlight along the ridges, from the ground's shape.
      ${p}GeoC = mix(${p}GeoC, mix(DIO_PARCHMENT, DIO_CHALK, 0.6), smoothstep(5.0, 12.0, ${p}Cv) * 0.45);
      // Fresh: steep faces show the rock itself, a little deeper and warmer.
      float ${p}Fresh = smoothstep(0.9, 1.6, ${p}Sl);
      ${p}GeoC = mix(${p}GeoC, ${p}Lith * vec3(0.95, 0.9, 0.84), ${p}Fresh * 0.7);
      // Iron-stained: the steepest cliffs.
      float ${p}Stain = smoothstep(1.6, 2.6, ${p}Sl);
      ${p}GeoC = mix(${p}GeoC, DIO_TERRACOTTA, ${p}Stain * 0.42);
      // Scree: below a cliff, on the concave footslope, at a slope fallen rock can rest on.
      float ${p}Talus = ${p}Cliff * (1.0 - smoothstep(-1.0, 3.0, ${p}Cv)) * smoothstep(0.3, 0.55, ${p}Sl) * (1.0 - smoothstep(1.2, 1.8, ${p}Sl));
      // The red mudstone beds (Round 05: no longer one even band around every mountain). Each bed is a LENS: it swells and pinches out laterally, as
      // mud laid in broad, shallow basins does, each on its own pattern (the middle bed thinnest and most broken), and its height undulates a little
      // of its own. It is EXPOSED only where a slope cuts through it (from a slope of 0.66, full by 1.0) and the soft mudstone is not hidden: on spurs
      // and open faces it shows full; in hollows and gullies debris covers most of it (it narrows there), and under scree all of it. So a bed runs
      // across a face, narrows through a gully, and swells, pinches out and returns along the range.
      float ${p}Out = smoothstep(0.58, 0.95, ${p}Sl) * mix(0.4, 1.0, smoothstep(-7.0, -0.5, ${p}Cv)) * (1.0 - 0.85 * ${p}Talus);
      float ${p}Bed = 0.0;
      float ${p}BedAbove = 0.0;
      ${STRATA.map(([h, w], i) => `{
        float lens = smoothstep(${i === 1 ? '0.28, 0.62' : '0.1, 0.45'}, styNoise(${p}P.xz / ${[520, 380, 610][i]}.0 + ${(i * 7.3 + 2.1).toFixed(1)}));
        float bh = ${h.toFixed(1)} + (styNoise(${p}P.xz / 300.0 + ${(i * 3.1 + 5.0).toFixed(1)}) - 0.5) * 10.0;
        float hw = ${w.toFixed(1)} * 1.35 * sqrt(lens) * ${p}Out;
        ${p}Bed = max(${p}Bed, (1.0 - smoothstep(hw - ${p}AaY, hw + ${p}AaY, abs(${p}Y - bh))) * smoothstep(0.0, 2.0 * ${p}AaY, hw));
        ${p}BedAbove = max(${p}BedAbove, lens * smoothstep(-${w.toFixed(1)}, 0.0, bh - ${p}Y) * (1.0 - smoothstep(10.0, 45.0, bh - ${p}Y)));
      }`).join('\n      ')}
      vec3 ${p}Debris = mix(mix(${p}Lith, DIO_SANDSTONE, 0.5) * 0.94, DIO_TERRACOTTA, 0.2 * ${p}BedAbove);
      ${p}GeoC = mix(${p}GeoC, ${p}Debris, ${p}Talus * 0.75);
      ${BEDDING ? `// Bedding, close up on fresh faces only: faint partings between beds of uneven thickness (about 3 to 7 m), each running out here and there
      // along the face, gone before they could crowd on screen; not a contour: they follow the dipping stack, not the elevation.
      float ${p}Lm = ${p}Y / 5.0 + 0.8 * styNoise(vec2(${p}Y * 0.11, 3.7));
      float ${p}LmFw = fwidth(${p}Lm);
      float ${p}LmRun = smoothstep(0.3, 0.6, styNoise(${p}P.xz / 45.0 + floor(${p}Lm) * 1.7));
      ${p}GeoC *= 1.0 - 0.04 * atLine(fract(${p}Lm + 0.5) - 0.5, ${p}LmFw, 0.7) * ${p}LmRun * (1.0 - smoothstep(0.04, 0.1, ${p}LmFw)) * ${p}Fresh;` : ''}
      ${p}GeoC = mix(${p}GeoC, DIO_TERRACOTTA, ${p}Bed);
      // (For the data view: a steep wall, as the zones model had it.)
      float ${p}Wall = ${p}Stain;
`

const stageGeologyZones = (p: string) => /* glsl */ `
      // GEOLOGY. Cream is the rock, in layers: the terracotta beds divide it into zones of sandstone and parchment (sandstone below the first bed,
      // parchment to the second, sandstone to the third, parchment above), so the mountains read as stacked rock rather than a mottle; within a
      // parchment zone, steep faces take a little of the sandstone (a hint of slope, no hard edge). The slope alone had decided it before, and on
      // bumpy ground, from level-of-detail normals, that broke the rock into small tan and white islands that moved as the camera came in.
      float ${p}Zy = ${p}P.y + (styNoise(${p}P.xz / 700.0) - 0.5) * 24.0;
      float ${p}Zone = 1.0 - smoothstep(144.0, 156.0, ${p}Zy) + smoothstep(228.0, 244.0, ${p}Zy) - smoothstep(322.0, 334.0, ${p}Zy);
      float ${p}Sand = ${ROCK_ZONES ? `max(${p}Zone, 0.4 * smoothstep(0.25, 0.5, ${p}Steep))` : `smoothstep(0.25, 0.35, ${p}Steep)`};
      // The terracotta beds: three named strata at fixed elevations, warped broadly, in their full colour. Each is exposed where the rock is steep enough
      // to show its beds; toward gentler ground it now tapers over a short span (an outcrop's lens) instead of being cut off at a line, so its ends do
      // not jump as the camera's level of detail changes. From a slope of 0.3 on (the old threshold) it is at its full thickness, as before.
      float ${p}Y = ${p}P.y + (styNoise(${p}P.xz / 700.0) - 0.5) * 24.0;
      float ${p}AaY = max(fwidth(${p}Y), 0.05);
      float ${p}Out = smoothstep(0.18, 0.3, ${p}Steep);
      float ${p}Bed = 0.0;
      ${STRATA.map(([h, w]) => `{
        float hw = ${w.toFixed(1)} * ${p}Out;
        ${p}Bed = max(${p}Bed, (1.0 - smoothstep(hw - ${p}AaY, hw + ${p}AaY, abs(${p}Y - ${h.toFixed(1)}))) * smoothstep(0.0, 2.0 * ${p}AaY, hw));
      }`).join('\n      ')}
      // The great cliff walls stay terracotta, over a wider, softer step (the hairline turned whole walls on and off with the level of detail).
      float ${p}Wall = smoothstep(0.68, 0.82, ${p}Steep);
      // (Shared outputs, as the formation model's: the rock's colour and its parts.)
      vec3 ${p}GeoC = mix(mix(DIO_PARCHMENT, DIO_SANDSTONE, ${p}Sand), DIO_TERRACOTTA, max(${p}Bed, ${p}Wall * 0.9));
      float ${p}Form = 2.0 - 2.0 * ${p}Sand;
      float ${p}Talus = 0.0;
      float ${p}Stain = ${p}Wall;
      vec4 ${p}G = vec4(0.0, 0.5, 0.0, 0.0);
      bool ${p}GeoOk = false;
      float ${p}Sl = ${p}Steep;
`

/**
 * The thin contour lines every 30 m and the faint board tones between them (the "stacked board"). Off on the Black Stage: they added noise, most of
 * all in Approach. The code is kept; set this to true to restore them (they now fade where the lines crowd on screen).
 */
const CONTOURS = false

/**
 * Bare rock in zones between the terracotta beds (refinement 02), with only a hint of sandstone on steep faces. False restores refinement 01's rule,
 * sandstone by slope alone (more modelled at midday, but mottled on bumpy ground and shifting with the camera's level of detail).
 */
const ROCK_ZONES = true

/**
 * Which rock model the Black Stage draws: 'formations' (Round 04: the geological model above stageGeology) or 'zones' (Refinement 02: parchment and
 * sandstone zones between the beds, terracotta cliff walls). One word restores the earlier look.
 */
const ROCK_MODEL: 'formations' | 'zones' = 'formations'

/** Faint bedding lines on fresh rock faces, close up only (part of the formations model). */
const BEDDING = true

/** The three terracotta strata: elevation (m) and half-thickness (m). */
const STRATA: [number, number][] = [[150, 9], [236, 12], [328, 7]]

/** The shore on the land, in a pale sand drawn from the palette (it was chalk: with the water's chalk line, a sticker-like outline). */
const SHORE_COLOUR = 'mix(DS_SAND, DIO_SANDSTONE, 0.3)'

/** Shoreline sediment: washed sand at the water's edge, on the land (stageGround's neighbour) and seen through the shallows. Round 08B: a warmer sand, not near-white. */
const SEDIMENT_COLOUR = 'DS_SAND'

/**
 * TERRAIN FACING THE SUN (Round 05), after stageHour: on the terrain, which way the ground faces the sun is decided from its smoothed slope
 * direction (the relief map, terrainGeology.ts, about 48 m) blended with the mesh's own normal, not from the mesh alone: the mesh's facets change
 * with its level of detail, and at a low sun they broke slopes into angular shade fragments that changed as the camera moved. And on grazing faces
 * (barely lit) the shadow map's cast shadow is let go: there it speckled into small islands (shadow acne); such a face reads as glancing light.
 */
export const terrainSun = (p: string) => /* glsl */ `
      if (uVegGeoOn > 0.5 && vegUv.x > 0.0 && vegUv.y > 0.0 && vegUv.x < 1.0 && vegUv.y < 1.0) {
        vec2 ${p}Rg = (texture2D(uVegRelief, vegUv).rg - 0.5) * 6.0;
        vec3 ${p}Fn = normalize(vec3(-${p}Rg.x, 1.0, -${p}Rg.y));
        // Round 06: gentle ground (the plains, slopes under about 0.15 to 0.45) is lit as the level ground it reads as. At a low sun its small
        // undulations each crossed the glancing and turned-away thresholds, so the plains broke into large grey and lilac patches that looked like
        // cast shadows but followed no object. Mountains keep their full modelling; real cast shadows (the shadow map) are untouched.
        float ${p}Plain = 1.0 - smoothstep(0.15, 0.45, ${p}Sl);
        // (Round 08B: a little more of the mesh's own normal on the mountains (0.5, was 0.35) and of the plains' undulation (0.7 flattened, was
        // 0.85): the light is continuous now, with no thresholds for small undulations to cross, so they model the land instead of breaking it up.)
        // (Round 08D: back to the earlier blend, 0.65 relief and 0.85 flattening on the plains, with the earlier light.)
        ${p}SunNdl = dot(normalize(mix(mix(${p}Wn, ${p}Fn, 0.65), vec3(0.0, 1.0, 0.0), ${p}Plain * 0.85)), ${p}S);
        // Round 08G: the light planes are cut on the relief ALONE (no share of the mesh's facets, which broke the planes into fragments);
        // the mesh's detail stays in the soft gradient inside each plane.
        ${p}SunNdlR = dot(normalize(mix(${p}Fn, vec3(0.0, 1.0, 0.0), ${p}Plain * 0.85)), ${p}S);
        ${p}Aa = max(fwidth(${p}SunNdl), 0.012);
      }
      // Round 07: on the terrain the cast shadow is crisp (a pixel-wide anti-aliased edge on the shadow map's own value, not a wide soft ramp), so
      // a place is in shadow or in light: at a low sun the wide ramp left broad half-shadows over the plains, which read as diffuse grey patches.
      // And the grazing exception (shadow acne on faces barely lit) holds for slopes only: on the plains every face is grazing at a low sun, and
      // the exception faded their real shadows (from the hills) to a third, the same grey patches.
      {
        float ${p}Vw = max(fwidth(${p}Vis), 0.06);
        float ${p}PlainK = 1.0 - smoothstep(0.15, 0.45, ${p}GeoOk ? ${p}Sl : 1.0);
        // (Round 08B: not scaled by the sun's strength here: stageLit takes away only the sun's own share, which fades with it.)
        ${p}Cast = 1.0 - smoothstep(0.5 - ${p}Vw, 0.5 + ${p}Vw, ${p}Vis);
        // Round 08C: the exemption only for faces truly grazing the sun (under 0.08). Over 0.03-0.22, as before, it erased real shadows cast by
        // neighbouring ridges on every glancing slope (measured against a ray traced through the terrain: about a third of all the ground the sun
        // could not reach was drawn lit), so shadows broke off where a slope turned a little from the sun.
        ${p}Cast *= mix(smoothstep(0.0, 0.08, ${p}SunNdl), 1.0, ${p}PlainK);
      }
      ${p}SunP = smoothstep(0.05 - ${p}Aa, 0.05 + ${p}Aa, ${p}SunNdl) * (1.0 - ${p}Cast);
      ${p}Full = smoothstep(0.45 - max(${p}Aa, 0.06), 0.45 + max(${p}Aa, 0.06), ${p}SunNdl) * ${p}SunP;
`

function dioramaStage(kind: Kind, hasDepth: boolean): string {
  const open = `
    if (uDioOn > 1.5) {
      ${light('ds')}
      ${stageHour('ds')}`
  const close = `
      // (Round 08A: the Round 04 sun-side brightening across the island is gone: a pseudo-effect the lighting itself does not explain.)
      // Depth: distant land loses a little colour and cools (more at golden hour), without brightening, so ranges separate by distance on the black.
      float dsAir = smoothstep(2500.0, 10000.0, dsDist) * (0.16 + 0.2 * dsGold) * dsSkyK;
      dsCol = mix(dsCol, vec3(dot(dsCol, INK_LUMA)) * vec3(0.93, 0.92, 1.1), dsAir);
      outgoingLight = dsCol;
    }`
  /**
   * The hour's light on a material (GLSL vec3 `alb`) into `out` (Round 08A: one simple language). FORM: how squarely a face meets the sun, shaded
   * continuously in the material's own colour (a little darker and cooler turned away), with no stepped planes, no grey band and no lilac. CAST
   * SHADOW, from the shadow map only, and only on faces the sun would otherwise light, is the one lavender: a restrained cool grey-purple over the
   * material. So lavender always means "the sun is blocked here", and a material's colour never reads as a shadow. (The third argument is unused.)
   */
  const lit = (out: string, alb: string, occ: string) => `
      vec3 ${out};
      {
        vec3 dsA = ${alb};
        // Round 08D: the earlier (Round 08A) light restored, by request: FORM is shaded continuously in the material's own colour (a little darker
        // and cooler turned away), CAST SHADOW (the shadow map, only on faces the sun would light) is the one lavender, and SKY light alone at dusk
        // and under cloud. Kept from later rounds: the overlapping sunset ramps (stageHour: the sun's share fades over 7 to -2 degrees while the
        // land dims over 8 to -8), the cast shadow on glancing slopes (terrainSun) and a mild openness term; the cast is a step more legible
        // than 08A's. (Round 08B's added sun-and-sky light, with its darker shade, is replaced.)
        // Round 08E, the Dark Table's character within this light (taken as qualities, not its stepped planes, which broke up close):
        //   a firmer turn from light to shade (still continuous, on the smoothed relief normal, so it holds at every distance)
        //   a faint core shadow just past the turn, as a painter darkens it: graphic, and where real form turns
        //   faces turned away a little cooler, toward lavender, but clearly lighter than a cast shadow
        //   the cast shadow a full step down in a lilac-violet (only the shadow map puts it there, so it always follows real geometry)
        // Round 08F, THE DARK TABLE'S PLANES, MADE STABLE. Three tones as the Dark Table cut them (full sun, glancing sun, turned away), with
        // graphic edges, but decided on the smoothed relief normal (terrainSun: the 48 m relief map on the terrain), not the mesh's facets, so
        // the planes are the land's large forms and do not break up or flicker with the level of detail. Each edge is a few pixels wide (never
        // under the relief map's own resolution), and a quarter of the continuous gradient is kept inside each plane so a plane still turns.
        // Round 08G: fewer, larger planes. The edges are wider (about 0.06 of facing, never under a few pixels) so the relief's small kinks no
        // longer cut their own little planes; the turned-away plane is a neutral cool grey (violet is kept for cast shadows alone).
        float dsEdge = max(fwidth(dsSunNdlR) * 2.5, 0.06);
        float dsFullP = smoothstep(0.45 - dsEdge, 0.45 + dsEdge, dsSunNdlR);
        float dsSunSide = smoothstep(0.05 - dsEdge, 0.05 + dsEdge, dsSunNdlR);
        vec3 dsAway = dsA * vec3(0.6, 0.6, 0.67);
        vec3 dsGlance = dsA * vec3(0.81, 0.81, 0.84);
        vec3 dsPlanes = mix(dsAway, mix(dsGlance, dsA * dsWarm, dsFullP), dsSunSide);
        vec3 dsSmooth = mix(dsAway, dsA * dsWarm, smoothstep(-0.05, 0.62, dsSunNdl));
        vec3 dsLitC = mix(dsSmooth, dsPlanes, 0.8) * mix(1.0, ${occ}, 0.5);
        // CAST SHADOW: a full step down in a rich violet (the Dark Table's), only where the shadow map has the sun blocked, so it always
        // follows real occlusion; deeper and more saturated than a face merely turned away, so the two read apart.
        vec3 dsCastC = mix(dsA * vec3(0.44, 0.43, 0.6), DIO_SHADE * 0.64, 0.3) * mix(vec3(1.0), vec3(0.95, 0.94, 1.05), dsGold);
        float dsCastK = dsCast * dsSunSide;
        vec3 dsSunC = mix(dsLitC, min(dsCastC, dsLitC), dsCastK);
        vec3 dsSkyC = mix(dsAway, dsA * vec3(0.84, 0.84, 0.9), 0.2 + 0.5 * dsSkyN);
        vec3 dsDay = mix(dsSkyC, mix(dsSunC, dsSkyC, dsCloudK * 0.85), dsSunK);
        // NIGHT: the moon's soft, cool light, a smooth wrap; each material keeps part of its own hue.
        // (Round 08F: each material keeps more of its own hue under a less blue moonlight, so meadow, woodland, rock and the strata stay apart at
        // night; the shared shade and the full blue tint had turned every surface one grey-violet.)
        vec3 dsNightC = mix(dsA, DIO_SHADE, 0.12) * mix(dsNightT, vec3(dot(dsNightT, INK_LUMA)) * vec3(0.92, 0.96, 1.12), 0.5) * 1.12 * (0.38 + 0.2 * dsSkyN + 0.6 * smoothstep(0.3, 1.0, dsMoon));
        ${out} = mix(dsNightC, dsDay * dsTwi, dsSkyK);
      }`
  if (kind === 'terrain') {
    return `${open}
      vec3 dsP = vMistPos;
      ${stageGround('ds')}
      ${stageGeology('ds')}
      ${terrainSun('ds')}
      vec3 dsRockC = dsGeoC;
      float dsCvT = dsGeoOk ? (dsG.g - 0.5) * 24.0 : 0.0;
      float dsGeoOk1 = dsGeoOk ? 1.0 : 0.0;
      // Round 05, SPARSE COVER (a little plant material, too little to make meadow: thin, dry soil over rock) is a pale ivory on gentle ground.
      float dsCover = dsW.r + dsW.g + dsW.b + dsW.a;
      float dsSparse = smoothstep(0.08, 0.22, dsCover) * (1.0 - smoothstep(0.42, 0.6, dsCover)) * (1.0 - smoothstep(0.45, 0.95, dsSl));
      dsRockC = mix(dsRockC, mix(DIO_PARCHMENT, DIO_CHALK, 0.25), dsSparse * 0.5 * (1.0 - dsBed));
      // SHORELINE SEDIMENT (the geology map's nearness to water, terrainGeology.ts): washed sand on the gentle ground at a lake's or river's edge.
      float dsNearW = dsGeoOk ? dsG.a : 0.0;
      dsRockC = mix(dsRockC, ${SEDIMENT_COLOUR}, dsNearW * (1.0 - smoothstep(0.45, 1.0, dsSl)) * 0.8 * (1.0 - dsBed));
      vec3 dsAlb = mix(dsRockC, ${SHORE_COLOUR}, dsShore);
      // Phase 1 QA, DEPTH ON THE PLAINS: the meadow was one flat olive wherever it grew. Its colour now follows how much meadow the ecology put
      // there (its own smoothed weight): thin, dry meadow at the edge of rock or sand is a little paler and drier (olive toward parchment), a
      // full sward is the olive itself, a touch deeper. One hue, a soft gradient of the ecology's own data: no new patches, no speckle.
      float dsSward = smoothstep(0.42, 0.85, dsW.b * dsFlat);
      dsAlb = mix(dsAlb, mix(mix(DIO_OLIVE, DIO_PARCHMENT, 0.2), DIO_OLIVE * vec3(0.93, 0.95, 0.9), dsSward), dsMead);
      dsAlb = mix(dsAlb, dsDarkC, dsDark);
      // OPENNESS (Round 08B): hollows and footslopes see less of the sky than crests and spurs (the geology map's convexity), so the mountains keep
      // their sculpture in the sky's light as well as the sun's.
      float dsOcc = mix(0.8, 1.08, smoothstep(-8.0, 7.0, dsCvT));
      ${lit('dsCol', 'dsAlb', 'dsOcc')}
      // Round 08F, ILLUSTRATED ACCENTS, only where the geology has a real edge: a fine ink line along each mudstone bed's margin (where the soft
      // red bed meets the sandstone). (Round 08G: the crest highlight is gone: close up it read as stray contour lines) (its convexity crossing 6 m). Lines a pixel or so wide at any distance, fading out where they would crowd on
      // screen (their field changing fast per pixel), and not on living ground; drawn after the light, so they dim with it at night.
      {
        float dsInk = (1.0 - dsLive) * dsGeoOk1;
        float dsBedFw = max(fwidth(dsBed), 1e-4);
        float dsBedLine = atLine(dsBed - 0.5, dsBedFw, 0.9) * (1.0 - smoothstep(0.25, 0.5, dsBedFw));
        dsCol *= 1.0 - 0.28 * dsBedLine * dsInk;
      }
      ${CONTOURS ? `// Stacked board: thin elevation layers a shade apart and a fine cut line between them, only where the lines stand clearly apart on screen.
      float dsL = dsP.y / 30.0;
      float dsLfw = fwidth(dsL);
      float dsLineK = (1.0 - smoothstep(0.06, 0.18, dsLfw)) * (1.0 - smoothstep(2500.0, 6000.0, dsDist)) * mix(1.0, 0.45, dsLive);
      dsCol *= 1.0 + 0.025 * dsLineK * (step(0.5, fract(floor(dsL) * 0.5)) * 2.0 - 1.0);
      dsCol *= 1.0 - 0.1 * atLine(fract(dsL + 0.5) - 0.5, dsLfw, 0.8) * dsLineK;` : '// (Contour lines and board tones: off, see CONTOURS.)'}${close}`
  }
  if (kind === 'water') {
    return `${open}
      float dsD = ${hasDepth ? 'vWaterDepth' : '0.8'};
      // Round 08C, DEPTH IN THE BLACK STAGE'S OWN TEALS. The deep water is the original deep teal (and the deepest basins its cooler shade, as in
      // Round 07); the variation is in the shallows, where the light reaches the bed: from a pale, sand-lit teal at the edge through the shallow
      // teal to the teal over the first two and a half metres.
      vec3 dsWA = mix(mix(DIO_TEAL_SHALLOW, DS_SAND, 0.22), DIO_TEAL_SHALLOW, smoothstep(0.05, 0.6, dsD));
      dsWA = mix(dsWA, DIO_TEAL, smoothstep(0.5, 2.5, dsD));
      // (Phase 1 QA: the cooler deep shade arrives over 3 to 16 m, not 3 to 9: most of a lake is deeper than 9 m, so its whole middle was one flat
      // tone and only a rim near the shore showed any depth. The colours are unchanged; the basins' shape now reads across the lake.)
      // (Round 08D: a deeper teal, the same blue-green, not a bluer one: the lakes' middles had drifted toward blue.)
      dsWA = mix(dsWA, DIO_TEAL * vec3(0.8, 0.86, 0.86), smoothstep(3.0, 16.0, dsD));
      ${hasDepth ? `// THE BED THROUGH THE WATER (Round 08B): washed sand under a thin layer, taking the water's colour as it deepens and fading over about
      // 0.7 m, so the shallows by a shore are translucent and run on into the sand of the shore without a line (no drawn outline, Round 05).
      float dsBedVis = exp(-dsD / 0.7);
      dsWA = mix(dsWA, mix(DS_SAND, DIO_TEAL_SHALLOW, 0.35 + 0.45 * smoothstep(0.05, 0.8, dsD)), dsBedVis * 0.6);` : ''}
      // LIGHT: the open water sees the whole sky (its main light) and the sun; a cast shadow takes the sun's share, toward the same lavender as on
      // the land; a little of the sky's light at grazing angles. The same hour as the land (stageHour).
      float dsWSun = dsSunI * clamp(dsS.y * 2.5, 0.0, 1.0);
      // (Round 08E: the cast shadow on water in the same lilac family as on land, a step deeper.)
      vec3 dsWDay = dsWA * (0.74 + 0.32 * dsWSun * (1.0 - dsCast)) * mix(vec3(1.0), vec3(0.86, 0.83, 1.06), dsCast * dsWSun);
      // Round 08D: the grazing light from the surface as it lies (straight up), not from the base water's wind ripples: those are two trains of
      // straight wavelets, and through this term they drew pale parallel lines across a lake whenever the weather brought wind.
      float dsFres = pow(1.0 - clamp(abs(dot(normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), normalize(vViewPosition))), 0.0, 1.0), 4.0);
      dsWDay = mix(dsWDay, DIO_TEAL_SHALLOW, dsFres * 0.2);
      // NIGHT (Round 08D): the water keeps its teal under the moon, about as bright as the land beside it (it was a tenth of that: near black), a muted teal.
      // (Round 08F: under the same moonlight as the land, dsNightT, so the water darkens with the island: a deep, unlit teal a step below the
      // land beside it, as water reflects little light at night; Round 08D's fixed tint read as self-lit.)
      // Round 08G: the same moonlight the land takes (lit(): the moon's tint half-desaturated, from above), on the water's own colour, then a
      // quarter of its saturation taken away as the land's is by the dark: brightness and colour both fall with the island's.
      float dsWMoon = 0.38 + 0.2 + 0.6 * smoothstep(0.3, 1.0, clamp(normalize(vec3(-0.42, 0.75, 0.51)).y * 0.5 + 0.5, 0.0, 1.0));
      vec3 dsWNight = dsWA * mix(dsNightT, vec3(dot(dsNightT, INK_LUMA)) * vec3(0.92, 0.96, 1.12), 0.5) * 1.12 * dsWMoon;
      dsWNight = mix(dsWNight, vec3(dot(dsWNight, INK_LUMA)), 0.25);
      vec3 dsCol = mix(dsWNight, dsWDay * dsTwi, dsSkyK);
      #ifdef DS_FALL
      // A FALL (Round 08C), drawn from its own sheet (WaterLayer.tsx › FALL_*): it leaves the lip in the river's colour (the river's shading depth
      // at the lip, through the same teals, so there is no step where the river turns over the edge), its water streaked downward at the speed it
      // falls, and paling as it aerates and breaks into spray lower down: the shallow teal toward chalk. Its edges thin a little.
      {
        float fD = vFallInfo.w;
        vec3 fA = mix(mix(DIO_TEAL_SHALLOW, DS_SAND, 0.22), DIO_TEAL_SHALLOW, smoothstep(0.05, 0.6, fD));
        fA = mix(fA, DIO_TEAL, smoothstep(0.5, 2.5, fD));
        // Phase 1 QA: the streaks used to be offset by uTime * speed with a speed that grows down the fall. Time multiplied by a speed that varies
        // in space shears the pattern without limit: after some seconds the streaks were compressed into fine grain and ran upward. Now two copies
        // of the streaks each restart every few seconds, offset by half a cycle and crossfaded (the 0.2 river's method, WaterLayer.tsx ›
        // flowRipple), so the offset is bounded: the water always moves down, faster lower in the fall, and the streaks keep their size.
        float fSp = 14.0 + 30.0 * vFallT;
        float fCyc = 3.0;
        float fPa = fract(uTime / fCyc);
        float fPb = fract(uTime / fCyc + 0.5);
        float fUa = vFallAlong - fPa * fCyc * fSp;
        float fUb = vFallAlong - fPb * fCyc * fSp + 53.0;
        float fSa = styNoise(vec2(vFallAcross * 5.0 + 3.1, fUa / 24.0)) * 0.6 + styNoise(vec2(vFallAcross * 13.0 + 1.7, fUa / 9.0)) * 0.4;
        float fSb = styNoise(vec2(vFallAcross * 5.0 + 7.8, fUb / 24.0)) * 0.6 + styNoise(vec2(vFallAcross * 13.0 + 6.4, fUb / 9.0)) * 0.4;
        // (Two crossfaded patterns average toward their mean: stretched back so the streaks keep their contrast.)
        float fS = clamp((mix(fSb, fSa, 1.0 - abs(2.0 * fPa - 1.0)) - 0.5) * 1.5 + 0.5, 0.0, 1.0);
        float fAir = smoothstep(0.04, 0.75, vFallT);
        vec3 fFoam = mix(DIO_TEAL_SHALLOW, DIO_CHALK, 0.55);
        vec3 fC = mix(fA, fFoam, clamp(fAir * 0.55 + smoothstep(0.55, 0.85, fS) * (0.25 + 0.35 * fAir), 0.0, 1.0));
        fC *= 1.0 + (fS - 0.5) * 0.18 - 0.12 * smoothstep(0.6, 1.0, abs(vFallAcross));
        dsCol = mix(fC * mix(dsNightT, vec3(dot(dsNightT, INK_LUMA)) * vec3(0.92, 0.96, 1.12), 0.5) * 1.12 * dsWMoon, fC * (0.78 + 0.28 * dsWSun) * dsTwi, dsSkyK);
      }
      #endif
      ${hasDepth ? `      // THE CURRENT (Round 07), on the rivers only: faint, long streaks of value carried downstream along the river's own course coordinate (its
      // distance from the head), faster where the bed is steep (the falls' share), none in a calm mouth or on a lake, and gone at a distance before
      // they could shimmer. Rendering only: the direction is the river's own.
      if (uRiver > 0.5) {
        // Phase 1 QA: (1) the offset was uTime * speed, and the speed changes along the river (with its steepness), so the pattern sheared more and
        // more with time: grain, and upstream drift, wherever a reach steepens or eases. Two copies now restart every few seconds, half a cycle
        // apart, crossfaded (WaterLayer.tsx › flowRipple's method), so the offset stays bounded and the motion is always downstream. (2) At 1 to 4
        // m/s with 3 to 8 m streaks the motion was under a pixel a second from Approach: a static ribbon. The streaks are longer and quicker
        // (sized for how the river is seen, as the cobalt river's were), quicker in mid-channel than at the banks, and they hold to a greater
        // distance; mid-channel crests run a little lighter, more so on steep reaches.
        float dsSp = (5.0 + 9.0 * vWaterFall) * (1.0 - 0.35 * vWaterAcross * vWaterAcross);
        float dsCyc = 5.0;
        float dsPa = fract(uTime / dsCyc);
        float dsPb = fract(uTime / dsCyc + 0.5);
        float dsUa = vWaterAlong - dsPa * dsCyc * dsSp;
        float dsUb = vWaterAlong - dsPb * dsCyc * dsSp + 37.0;
        float dsFa = styNoise(vec2(dsUa / 14.0, vWaterAcross * 2.0 + 3.1)) * 0.6 + styNoise(vec2(dsUa / 5.0, vWaterAcross * 4.5 + 7.0)) * 0.4;
        float dsFb = styNoise(vec2(dsUb / 14.0, vWaterAcross * 2.0 + 8.6)) * 0.6 + styNoise(vec2(dsUb / 5.0, vWaterAcross * 4.5 + 1.9)) * 0.4;
        float dsFlow = clamp((mix(dsFb, dsFa, 1.0 - abs(2.0 * dsPa - 1.0)) - 0.5) * 1.5 + 0.5, 0.0, 1.0);
        float dsFk = (1.0 - smoothstep(1.0, 4.0, fwidth(vWaterAlong))) * (1.0 - vWaterCalm) * dsSkyK;
        dsCol *= 1.0 + (dsFlow - 0.5) * 0.42 * dsFk * (0.7 + 0.3 * abs(vWaterAcross));
        float dsThread = smoothstep(0.58, 0.85, dsFlow) * (1.0 - smoothstep(0.3, 0.95, abs(vWaterAcross))) * dsFk;
        dsCol = mix(dsCol, dsCol * 1.25 + DIO_TEAL_SHALLOW * 0.12 * dsTwi, dsThread * (0.45 + 0.4 * vWaterFall));
      }` : ''}${close}`
  }
  if (kind === 'shell') {
    return `${open}
      vec3 dsP = vMistPos;
      // THE CUT EDGE AS A CROSS-SECTION. The cut face falls some 400-600 m and the underside curves on down to about 1300 m below the rim, so the
      // layers are spread over that whole depth: about 55 m beds at the top, each lower bed a little thicker (rock compacted under the weight above),
      // cycling sandstone, clay and a pale terracotta and meeting softly (softer the deeper they lie). Going down, the beds turn first toward the
      // lilac and then into the slate-plum, and their contrast with one another fades step by step, so the bottom stays a calm, dark purple.
      float dsDm = max(0.0, 20.0 - dsP.y);
      float dsT = clamp(dsDm / 1100.0, 0.0, 1.0);
      // Irregular, broadly: a slow warp at the top, a larger and slower one lower down (the deep beds undulate more), never a ruler line.
      float dsY = dsDm - (styNoise(dsP.xz / 500.0) - 0.5) * 20.0 - (styNoise(dsP.xz / 280.0 + 4.0) - 0.5) * 70.0 * smoothstep(0.05, 0.5, dsT);
      dsY = max(dsY, 0.0);
      float dsB = dsY / (55.0 + 0.08 * dsY);
      float dsBi = floor(dsB);
      float dsK0 = mod(dsBi, 3.0);
      float dsK1 = mod(dsBi + 1.0, 3.0);
      vec3 dsA0 = mix(mix(DIO_SANDSTONE, DIO_CLAY, step(0.5, dsK0)), mix(DIO_CLAY, DIO_TERRACOTTA, 0.35), step(1.5, dsK0));
      vec3 dsA1 = mix(mix(DIO_SANDSTONE, DIO_CLAY, step(0.5, dsK1)), mix(DIO_CLAY, DIO_TERRACOTTA, 0.35), step(1.5, dsK1));
      vec3 dsAlb = mix(dsA0, dsA1, smoothstep(mix(0.86, 0.55, dsT), 1.0, fract(dsB)));
      // How deep, for the colour: each bed a step (its middle's depth) blended with the continuous descent, so the change arrives bed by bed but softly.
      float dsBm = (dsBi + 0.5);
      float dsMid = dsBm * 55.0 / max(1.0 - 0.08 * dsBm, 0.2);
      float dsDeep = mix(clamp(dsMid / 1100.0, 0.0, 1.0), dsT, 0.5);
      // Quieter with depth: the beds drawn toward one shared stone, then a lilac-clay middle, then the slate-plum.
      dsAlb = mix(dsAlb, mix(DIO_SANDSTONE, DIO_CLAY, 0.5), smoothstep(0.0, 0.55, dsDeep) * 0.65);
      dsAlb = mix(dsAlb, mix(DIO_CLAY, DIO_SHADE, 0.55), smoothstep(0.12, 0.5, dsDeep) * 0.7);
      // Round 04: each bed its own small step of value, and a fine parting between beds in the upper cut face (where the layers are lightest and
      // closest to the land), both fading out with depth so the bottom stays calm.
      float dsUpper = 1.0 - smoothstep(0.25, 0.6, dsDeep);
      dsAlb *= 1.0 + (fract(sin(dsBi * 12.9898) * 43758.5453) - 0.5) * 0.09 * dsUpper;
      float dsBfw = fwidth(dsB);
      dsAlb *= 1.0 - 0.13 * atLine(fract(dsB + 0.5) - 0.5, dsBfw, 0.9) * (1.0 - smoothstep(0.05, 0.25, dsBfw)) * dsUpper;
      // In the slate-plum the beds survive only as a faint alternation of value, fading out toward the calm bottom.
      float dsAlt = (step(0.5, fract(dsBi * 0.5)) * 2.0 - 1.0) * 0.07 * (1.0 - smoothstep(0.5, 0.8, dsDeep));
      dsAlb = mix(dsAlb, DIO_UNDER * (1.0 + dsAlt), smoothstep(0.25, 0.72, dsDeep));
      ${shellLit}${close}`
  }
  if (kind === 'architecture') {
    return `${open}
      ${lit('dsCol', 'DIO_STONE', '1.0')}
      // Its own planes as well, whatever the light: tops lightest, the two wall orientations a step apart; folds a quiet step darker.
      dsCol *= mix(mix(0.8, 0.9, step(abs(dsWn.z), abs(dsWn.x))), 0.98, smoothstep(0.55, 0.85, dsWn.y));
      dsCol *= 1.0 - 0.2 * smoothstep(0.18, 0.5, length(fwidth(dsWn)));${close}`
  }
  return `${open}
      vec3 dsOwn = max(diffuseColor.rgb, vec3(1e-4));
      // Labs refinement: foliage is what is greener OR bluer than it is red (a blue-green or teal leaf was read as bark before, and the shade
      // parasol's blue-sheened dishes turned brown on the island). The palette keeps its role (bark, moss, olive by value), and each species keeps
      // a share of its OWN hue at the palette's value, so species stay distinct on the island as they are in the Lab, within one palette.
      // (Bark or leaf is told by the plant's own colour, before its tint and grade, where the material passes it (visualStyle.ts › PLANT_RAW).)
      #ifdef PLANT_RAW
      vec3 dsKind = vPlantRaw;
      #else
      vec3 dsKind = dsOwn;
      #endif
      float dsGreen = smoothstep(-0.005, 0.03, max(dsKind.g, dsKind.b * 0.96) - dsKind.r);
      // (The value ramp spans the leaves' own range, about 0.1 to 0.45 here, not 0.04 to 0.24, which put nearly every leaf at the palest olive: the crowns
      // were khaki and the woodland lost its darker mass. Now a deep, shade-tinted crown reads as moss and a sunlit meadow plant as olive.)
      // (Round 15: a sage-green middle step between moss and olive, so most foliage lands on natural greens and only the brightest, sunniest leaves
      // reach the khaki olive; before, the ramp ran straight to olive and sunlit crowns read pale and yellowish.)
      float dsLv = dot(dsOwn, INK_LUMA);
      vec3 dsLeafRamp = mix(mix(DIO_MOSS * 0.85, vec3(0.42, 0.5, 0.33), smoothstep(0.08, 0.3, dsLv)), DIO_OLIVE, smoothstep(0.32, 0.6, dsLv));
      vec3 dsPal = mix(DIO_BARK, dsLeafRamp, dsGreen);
      vec3 dsHue = dsOwn * (dot(dsPal, INK_LUMA) / max(dot(dsOwn, INK_LUMA), 1e-3));
      vec3 dsAlb = mix(dsPal, dsHue, 0.42 * dsGreen + 0.25 * (1.0 - dsGreen));
      ${lit('dsCol', 'dsAlb', '1.0')}${close}`
}

/** The cut edge's light: smooth (no planes, no cast shadow: its irregular facets made dark marks), by the same hour. Reads dsAlb, writes dsCol. */
const shellLit = /* glsl */ `
      float dsSoft = mix(clamp(dsSunNdl * 0.5 + 0.5, 0.0, 1.0), 0.5, dsCloudK * 0.7);
      vec3 dsShadeU = mix(dsAlb, DIO_SHADE, 0.35);
      vec3 dsDayU = mix(dsShadeU * 0.62, dsAlb * 0.9, dsSoft);
      vec3 dsDuskU = mix(dsShadeU * 0.7, dsDayU, dsSunK) * dsTwi;
      vec3 dsCol = mix(dsShadeU * dsNightT * 0.8, dsDuskU, dsSkyK);`

// Development only: this module holds state that compiled shaders depend on (uniforms, specialised switches). A hot update would load a second copy
// of it while existing materials keep the first, and the scene falls back to the unstyled look (cobalt water, plain underside, grey ground) until a
// reload. A full reload instead (Round 08D; Vite's hot.decline() is a no-op, so the update is accepted here and answered with a reload).
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload())
