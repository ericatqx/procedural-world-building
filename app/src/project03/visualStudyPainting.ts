import { Color } from 'three'

/**
 * Shadow Ecology 0.3 — World Visual Study: ATMOSPHERIC PAINTING (prototype 01). The same world painted in light and air (GRIS's colour, SEASON's
 * painted calm, Journey's luminous distance): where the Illustrated Atlas draws the land, this one lights it. No contours, no outlines.
 *
 *   light    the sun's (or moon's) colour and the shade's colour come from the hour (studySky.ts): warm gold low in the morning and at sunset, near white at
 *            midday, a cool blue-violet in the shade, a dim blue moon by night. Light wraps softly round the form; shadows are coloured, never grey
 *   colour   painted materials: meadow, woodland and moss in rich greens drifting warm and cool over large areas, rock warm low and cool high, sand at the
 *            water; pigment gathers at the edges where one material meets another, as in a wash
 *   air      distance turns the land toward the hour's haze colour (gold at sunset, blue at noon, near black at night), so depth reads as colour, not grey
 *   leaves   lit through from behind when the sun is low (a warm rim on the trees at sunset)
 *   water    its body in deep blue-green, the sky's colour by angle, and the sun's glitter
 *   night    genuinely dark: only moonlight, the sky's faint shine on the water, and warm pools of light at the foot of the structures
 * Like the Atlas it is a finish on every styled material (visualStyle.ts), switched by one uniform; the surfaces it draws are not tone-mapped while it is on.
 */
export const paintUniforms = {
  uPaintOn: { value: 0 },
  uPtKey: { value: new Color('#FFF8EA') },
  uPtShade: { value: new Color('#5C77B2') },
  uPtSky: { value: new Color('#2F78D4') },
  uPtHaze: { value: new Color('#AFD0EE') },
  uPtNight: { value: 0 },
}

/** Whether the Painting is on, for the sky (Sky.tsx, StudySky.tsx). */
export const paintScene = { on: false }

const v3 = (hex: string) => {
  const c = new Color(hex)
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`
}

export const PAINT_HEAD = /* glsl */ `
uniform float uPaintOn;
uniform vec3 uPtKey;
uniform vec3 uPtShade;
uniform vec3 uPtSky;
uniform vec3 uPtHaze;
uniform float uPtNight;
const vec3 PT_MEADOW = ${v3('#8EB65A')};
const vec3 PT_MEADOW_GOLD = ${v3('#B6B95A')};
const vec3 PT_WOOD = ${v3('#3D6B43')};
const vec3 PT_MOSS = ${v3('#4C7A4C')};
const vec3 PT_SAND = ${v3('#E2CC9C')};
const vec3 PT_ROCK_WARM = ${v3('#C9A884')};
const vec3 PT_ROCK_COOL = ${v3('#9A97AE')};
const vec3 PT_WATER_SHALLOW = ${v3('#2FB3B0')};
const vec3 PT_WATER_DEEP = ${v3('#155E92')};
const vec3 PT_STONE = ${v3('#EADBC2')};
const vec3 PT_LEAF_DARK = ${v3('#2D5A36')};
const vec3 PT_LEAF_LIGHT = ${v3('#9CC662')};
const vec3 PT_BARK = ${v3('#6E5340')};
const vec3 PT_LAMP = vec3(1.0, 0.55, 0.22);
`

const LIGHT = /* glsl */ `
      vec3 ptN = normalize(normal);
      vec3 ptWn = inverseTransformDirection(ptN, viewMatrix);
      vec3 ptV = normalize(vViewPosition);
      float ptNdl = 0.0;
      vec3 ptL = vec3(0.0, 1.0, 0.0);
      #if NUM_DIR_LIGHTS > 0
        ptNdl = dot(ptN, directionalLights[0].direction);
        ptL = directionalLights[0].direction;
      #endif
      float ptVis = 1.0;
      #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
      {
        DirectionalLightShadow ptDs = directionalLightShadows[0];
        ptVis = getShadow(directionalShadowMap[0], ptDs.shadowMapSize, ptDs.shadowIntensity, ptDs.shadowBias, ptDs.shadowRadius, vDirectionalShadowCoord[0]);
      }
      #endif
      // By night the light is the moon's, from above: the shadow map (the sun's) is not used then.
      float ptSunVis = mix(mix(1.0, smoothstep(0.25, 0.75, ptVis), 0.85), 1.0, uPtNight);
      float ptFacing = mix(ptNdl, ptWn.y * 0.8, uPtNight);
      float ptWrap = clamp((ptFacing + 0.3) / 1.3, 0.0, 1.0);
      float ptDist = length(vViewPosition);
      // Aerial perspective: distance toward the hour's haze colour (from about a kilometre out).
      float ptAir = (1.0 - exp(-max(0.0, ptDist - 1500.0) / 6500.0)) * 0.5;`

export function paintChunk(kind: 'terrain' | 'architecture' | 'plant' | 'creature' | 'water' | 'shell', hasDepth: boolean): string {
  if (kind === 'creature') return ''
  if (kind === 'terrain') return terrain()
  if (kind === 'water') return water(hasDepth)
  if (kind === 'shell') return shell()
  if (kind === 'architecture') return architecture()
  return plant()
}

function terrain(): string {
  return `
    if (uPaintOn > 0.5) {
      vec3 ptP = vMistPos;
      ${LIGHT}
      // MATERIALS (vegGround's own drawing, with its organic edges): rock warm low and cool high, sand, meadow drifting toward gold, woodland, moss.
      float ptSteep = 1.0 - ptWn.y;
      float ptHigh = clamp(smoothstep(160.0, 400.0, ptP.y) * 0.7 + smoothstep(0.5, 0.85, ptSteep) * 0.45, 0.0, 1.0);
      vec3 ptAlb = mix(PT_ROCK_WARM, PT_ROCK_COOL, ptHigh);
      ptAlb = mix(ptAlb, PT_SAND, vgMat.a * 0.85);
      ptAlb = mix(ptAlb, mix(PT_MEADOW, PT_MEADOW_GOLD, smoothstep(0.45, 0.8, styNoise(ptP.xz / 220.0 + 7.0)) * 0.7), vgMat.b * 0.95);
      ptAlb = mix(ptAlb, PT_WOOD, vgMat.r * 0.95);
      ptAlb = mix(ptAlb, PT_MOSS, vgMat.g * 0.85);
      // Painted: large warm and cool drifts, and pigment gathered where one material gives way to another.
      ptAlb *= mix(vec3(1.06, 1.0, 0.92), vec3(0.94, 1.0, 1.07), styNoise(ptP.xz / 150.0));
      float ptPool = clamp(4.0 * vgMat.r * (1.0 - vgMat.r) + 2.4 * vgMat.b * (1.0 - vgMat.b), 0.0, 1.0);
      ptAlb *= 1.0 - 0.14 * ptPool;
      // LIGHT: the hour's key, wrapped softly, over the shade's own colour (more of it where the ground looks at the open sky).
      vec3 ptLight = uPtShade * (0.5 + 0.3 * ptWn.y) + uPtKey * ptWrap * ptSunVis;
      vec3 ptCol = ptAlb * ptLight;
      ptCol = mix(ptCol, uPtHaze, ptAir);
      // Night: warm pools of light at the foot of the structures (archGround's footprint field), the only warm light on the land.
      float ptLampK = smoothstep(0.02, 0.45, texture2D(uArch, (ptP.xz + 2048.0) / 4096.0).r);
      ptCol += PT_LAMP * ptLampK * 0.22 * uPtNight * (0.4 + ptAlb);
      outgoingLight = ptCol;
    }`
}

function water(hasDepth: boolean): string {
  return `
    if (uPaintOn > 0.5) {
      ${LIGHT}
      float ptD = ${hasDepth ? 'vWaterDepth' : '0.8'};
      float ptNdv = clamp(dot(ptN, ptV), 0.0, 1.0);
      float ptFres = pow(1.0 - ptNdv, 3.0);
      // The body keeps its own blue-green: lit by how bright the hour is, not tinted by the shade's colour (which made it grey).
      vec3 ptBody = mix(PT_WATER_SHALLOW, PT_WATER_DEEP, smoothstep(0.3, 5.0, ptD)) * (0.18 + 0.9 * dot(uPtKey, INK_LUMA)) * (1.0 - 0.6 * uPtNight);
      vec3 ptCol = mix(ptBody, mix(uPtHaze, uPtSky, 0.6), 0.06 + 0.55 * ptFres);
      // The sun's glitter (the moon's, faint, by night).
      vec3 ptR = reflect(-ptV, ptN);
      float ptSpec = pow(max(dot(ptR, ptL), 0.0), 140.0) * ptSunVis;
      ptCol += uPtKey * ptSpec * mix(1.6, 0.5, uPtNight);
      ptCol = mix(ptCol, uPtHaze, ptAir * 0.6);
      outgoingLight = ptCol;
    }`
}

function shell(): string {
  return `
    if (uPaintOn > 0.5) {
      vec3 ptP = vMistPos;
      ${LIGHT}
      // The island's cut edge: warm rock in soft beds, cooling toward the underside, lit like the land.
      vec3 ptAlb = mix(PT_ROCK_WARM, PT_ROCK_COOL, smoothstep(-40.0, -260.0, ptP.y));
      ptAlb *= 0.92 + 0.12 * styNoise(vec2(ptP.y / 9.0, ptP.x / 400.0 + ptP.z / 400.0));
      vec3 ptCol = ptAlb * (uPtShade * 0.6 + uPtKey * ptWrap * ptSunVis * 0.9);
      ptCol = mix(ptCol, uPtHaze, ptAir);
      outgoingLight = ptCol;
    }`
}

function architecture(): string {
  return `
    if (uPaintOn > 0.5) {
      ${LIGHT}
      // Warm pale stone carrying a little of its own colour, lit by the hour, its shade coloured; at night a faint warm light of its own (inhabited).
      vec3 ptOwn = max(diffuseColor.rgb, vec3(1e-4));
      float ptOwnL = dot(ptOwn, INK_LUMA);
      vec3 ptAlb = mix(PT_STONE, PT_STONE * ptOwn / max(ptOwnL, 1e-3) * 0.8, 0.2) * (0.88 + 0.24 * smoothstep(0.05, 0.5, ptOwnL));
      float ptLit = smoothstep(-0.1, 0.35, ptFacing) * ptSunVis;
      vec3 ptCol = ptAlb * (uPtShade * 0.62 + uPtKey * ptLit);
      ptCol += PT_LAMP * 0.05 * uPtNight * smoothstep(0.6, -0.2, ptWn.y);
      ptCol = mix(ptCol, uPtHaze, ptAir);
      outgoingLight = ptCol;
    }`
}

function plant(): string {
  return `
    if (uPaintOn > 0.5) {
      ${LIGHT}
      // Leaves in rich greens by their own value, bark warm brown; lit through from behind when the sun is low.
      vec3 ptOwn = max(diffuseColor.rgb, vec3(1e-4));
      float ptOwnL = dot(ptOwn, INK_LUMA);
      float ptGreen = smoothstep(-0.005, 0.02, ptOwn.g - max(ptOwn.r, ptOwn.b));
      vec3 ptAlb = mix(PT_BARK, mix(PT_LEAF_DARK, PT_LEAF_LIGHT, smoothstep(0.03, 0.24, ptOwnL)), ptGreen);
      float ptBack = pow(max(dot(-ptV, ptL), 0.0), 3.0) * ptGreen * (1.0 - uPtNight);
      vec3 ptCol = ptAlb * (uPtShade * 0.6 + uPtKey * ptWrap * ptSunVis) + ptAlb * uPtKey * ptBack * 0.6;
      ptCol = mix(ptCol, uPtHaze, ptAir);
      outgoingLight = ptCol;
    }`
}
