import {
  Color,
  DoubleSide,
  MeshStandardMaterial,
  type IUniform,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { LINE_GLSL, NOISE_GLSL, SUN_EXPOSURE_GLSL } from '../shared/shaders/glsl.ts'
import {
  createSurfaceMaterial,
  type SurfaceMaterial,
  type SurfaceShader,
} from '../shared/shaders/surfaceMaterial.ts'
import {
  AGE_HOURS,
  DECAY_AGE_FROM,
  LATTICE_ORIGIN,
  LAYER_BASE,
  MODULE_SIZE,
  VOXEL_SIZE,
} from './architecture.ts'
import { SUITABLE } from './habitat.ts'

/**
 * Shadow Ecology — one material identity per kind of matter. Colour carries
 * meaning: neutral for rock and architecture, cobalt only for water, warm
 * olive only for vegetation, cool lichen green only for creature habitat.
 * Shadow is the lighting itself: nothing is tinted for being in shade.
 *
 * Terrain and architecture read the direct sun through the shared
 * sun-exposure `lights` chunk. Habitat is not the instant shadow: the terrain reads
 * the simulated habitat field (remembered daylight shelter, moisture,
 * footing) as ground colonised by lichen, stained into its albedo and
 * roughness so it takes light like the rest of the ground: scattered
 * greyed-sage colonies where thin, coalescing around the suitable level into
 * a mottled, darker moss crust with deeper old centres and a few dark
 * grains. Against the habitat of the previous sunset, ground just gained
 * pales toward fresh lichen and ground just lost keeps a faint ghost of
 * hatching. Field only adds the analytical marks: hatching and the suitable edge.
 */
export const PROJECT_COLORS = {
  terrainLow: '#4d4b48',
  terrainValley: '#a19e97',
  terrainHigh: '#e2dac9',
  terrainSlope: '#8c8f91',
  terrainRock: '#76797c',
  terrainDust: '#ece5d5',
  terrainStrata: '#8a8b8b',
  terrainDeep: '#2c2d2f',
  vegetationGround: '#6e7258',
  archFresh: '#5e5b56',
  archBase: '#33312e',
  archWeathered: '#8d8981',
  archPatina: '#282725',
  archDust: '#9a958c',
  waterShallow: '#3d63ff',
  waterDeep: '#1530c4',
  waterLine: '#a9bbff',
  vegetationBase: '#434a33',
  vegetationTip: '#8c9466',
  vegetationDry: '#a8a482',
  path: '#f1ece2',
  pathWorn: '#4a4640',
  habitat: '#6a8b7b',
  habitatThin: '#9fada6',
  habitatInk: '#3b584c',
} as const

export const HABITAT_MARKS = {
  /** Noise offset of the habitat lookup (texture units), so patch edges wander off the grid. */
  warp: 0.012,
  /** Habitat range over which colonised ground fades in from nothing. */
  patchFrom: 0.08,
  patchTo: 0.55,
  /** In Field only, the rest of the ground dims by this much. */
  fieldDim: 0.3,
  /** Habitat range over which the lichen goes from greyed sage to full moss green. */
  deepFrom: 0.25,
  deepTo: 0.7,
  /** Colony blotches, crust mottling and fine crust texture, per world unit. */
  colonyScale: 9,
  mottleScale: 16,
  crustScale: 34,
  /** Tonal range of the crust mottling, so colonised ground is uneven rather than a flat wash. */
  mottleDark: 0.74,
  mottleLight: 1.12,
  /**
   * Habitat range around SUITABLE over which scattered colonies coalesce
   * into a continuous crust, so suitability reads as a change in the ground.
   */
  coalesceBelow: 0.15,
  coalesceAbove: 0.1,
  /** How far the stain pulls the ground's value toward the lichen's, thin to dense: a darker, damp crust. */
  valueThin: 0.25,
  valueDense: 0.68,
  /** Stain strength at full cover in World, then in Field only. */
  worldStain: 0.92,
  fieldStain: 1,
  /** Old colony centres deepen toward moss ink. */
  colonyCore: 0.3,
  /** Lichen is matte: roughness added at full cover. */
  roughness: 0.12,
  /** Sparse dark fruiting grains per world unit, and the share of cells holding one, thin to dense. */
  stippleScale: 28,
  stippleThin: 0,
  stippleDense: 0.05,
  stippleShade: 0.22,
  /** Hatch pitch in world units: coarse enough to resolve at viewing distance. */
  hatchSpacing: 0.075,
  /** Habitat below this draws no hatching. */
  hatchFloor: 0.15,
  /** Hatching opacity in World (a trace under the crust), then in Field only. */
  worldOpacity: 0.1,
  fieldOpacity: 0.6,
  /** Hatching is drawn in deep moss, darker than the field it sits on. */
  inkShade: 0.85,
  /** The suitable edge (habitat = SUITABLE) is drawn in Field only; in World the crust coalescing marks it. */
  fieldSuitableOpacity: 0.65,
  /** Change since the previous sunset: the habitat difference over which it shows, fresh pale lichen on gains, a ghost of hatching on losses. */
  changeFrom: 0.04,
  changeTo: 0.2,
  fresh: 0.35,
  lossOpacity: 0.3,
  /** In Field only, colonised ground keeps at least this much light, so shaded habitat still reads. */
  fieldLight: 0.55,
  elevationInterval: 0.1,
  /** Elevation contours stay faint, and fade out under the crust, so habitat leads. */
  elevationOpacity: 0.035,
  fieldElevationOpacity: 0.06,
} as const

const EXPOSURE_RESPONSE = {
  /** How much direct sun flattens surface texture. */
  flatten: 0.08,
  /** How much direct sun desaturates. */
  bleach: 0.18,
} as const

const WATER = {
  /** Water stays readable in shade: part of its colour is self-lit. */
  selfLit: 0.2,
  flowSpacing: 0.14,
  flowSpeed: 0.12,
  flowOpacity: 0.12,
  depthInterval: 0.04,
  depthOpacity: 0.08,
  /** Depth at which a lake reaches its deepest colour. */
  deepAt: 0.18,
  /** Ripple height (world units) on lakes, rivers per unit of current, and falls. */
  lakeRipple: 0.0015,
  riverRipple: 0.003,
  fallRipple: 0.008,
  /** Ripples are advected in two offset phases that restart each cycle, so they never shear apart. */
  flowCycle: 2,
  foamOpacity: 0.55,
  /** Lakes pale toward their shore over this depth. */
  shoreDepth: 0.03,
  /** Still lakes are glassy; rivers less so; falls are broken, matte water. */
  lakeRoughness: 0.12,
  riverRoughness: 0.3,
  fallRoughness: 0.6,
} as const

const TERRAIN_CLIFF = {
  /** Depth below the rim over which the ground colour gives way to the cliff's strata. */
  blend: 0.12,
  /** Depth at which the strata reach their darkest. */
  deepAt: 2.2,
  /** Cliffs keep this much of their colour out of the sun, so they read as rock, not a black cut. */
  fill: 0.14,
  /** How much worn ground around paths darkens. */
  pathWear: 0.24,
} as const

/**
 * Rock beds on cliffs and the underside. Beds vary in thickness and their
 * seams break off, so the strata never read as evenly spaced contour lines.
 */
const STRATA = {
  /** Mean beds per world unit, and how much bed thickness wanders (bed units). */
  beds: 6,
  thickness: 1.5,
  /** How much a seam darkens the rock where it shows: a soft band, not a line. */
  seam: 0.08,
} as const

const PATH_WEAR = { edgeOpacity: 0.5, coreOpacity: 0.9 } as const

const float = (value: number) => value.toFixed(4)
/** Comma-separated GLSL floats, for a `vec3(...)` constructor. */
const triple = (r: number, g: number, b: number) => [r, g, b].map(float).join(', ')

/**
 * Terrain mineral character, all multipliers around 1 so the warm off-white
 * base holds: warped zones drifting a few percent warm or cool, lower ground
 * a touch cooler, faint ridged veins (stronger on steep faces), specks that
 * only appear once resolvable, and a darker weathered film on steep rock.
 */
const MINERAL = {
  warm: triple(1.045, 1.0, 0.94),
  cool: triple(0.94, 0.955, 0.985),
  low: triple(0.95, 0.965, 0.99),
  veinTop: 0.06,
  veinSteep: 0.13,
  /** Specks per world unit. */
  speckScale: 110,
  varnish: triple(0.76, 0.75, 0.74),
  varnishAmount: 0.85,
  /** Broad tonal mottling, ± this fraction. */
  broadMottle: 0.12,
  /** Moderate slopes cool toward `terrainSlope` by up to this much before steep faces turn to rock. */
  slopeCool: 0.6,
  /** Grain amplitude in the ground colour. */
  grain: 0.12,
} as const
const color = (hex: string) => ({ value: new Color(hex) })
const marks = HABITAT_MARKS
/** `lights` chunk for terrain and architecture; they have no term view, so the term stays 0. */
const SUN_LIGHTS = `${SUN_EXPOSURE_GLSL}\nfloat studyTerm = 0.0;`

const SHARED_HEAD = /* glsl */ `
${NOISE_GLSL}
float projectFbm(vec3 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amplitude * valueNoise(p);
    p = p * 2.07 + vec3(13.7, 3.1, 7.9);
    amplitude *= 0.5;
  }
  return sum / 0.9375;
}
`

/**
 * Lit chunk shared by terrain and architecture: direct sun flattens and
 * bleaches surface texture. Each albedo sets `float surfaceDetail` (−1…1, how
 * far this texel is from the material's mean).
 */
const EXPOSURE_CHUNK = /* glsl */ `
{
  float sunExposure = clamp(habitatExposure, 0.0, 1.0);
  outgoingLight *= 1.0 - surfaceDetail * ${float(EXPOSURE_RESPONSE.flatten)} * sunExposure;
  float litLuma = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  outgoingLight = mix(outgoingLight, vec3(litLuma), ${float(EXPOSURE_RESPONSE.bleach)} * sunExposure);
}
`

/**
 * Terrain marks, after lighting, so sun flattening does not wash them out.
 * The colonised ground itself is albedo; here, Field only keeps it a floor
 * of light. Then faint elevation contours (Contours only) that give way under
 * the crust, short broken diagonal hatching whose strokes survive in
 * proportion to suitability (a trace in World, firm in Field only), the ghost
 * of hatching on ground lost since the previous sunset (field texture G), and
 * the suitable edge in Field only. Marks take the light the ground receives
 * as a neutral factor, so the moving shadow darkens them like any ground.
 */
const TERRAIN_MARKS = /* glsl */ `
float groundTop = step(0.2, terrainNormal.y) * (1.0 - terrainWall);
float groundLuma = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
float groundLight = clamp(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)) / groundLuma, 0.0, 1.2);
float markLight = mix(groundLight, max(groundLight, ${float(marks.fieldLight)}), uHabitatEmphasis);
outgoingLight = mix(outgoingLight, max(outgoingLight, diffuseColor.rgb * ${float(marks.fieldLight)}), colonyCover * uHabitatEmphasis);
outgoingLight = drawLine(
  outgoingLight,
  contourLine(vStudyWorldPos.y, ${float(marks.elevationInterval)}, 0.8) * groundTop * uContours * (1.0 - colonyCover),
  mix(${float(marks.elevationOpacity)}, ${float(marks.fieldElevationOpacity)}, uHabitatEmphasis)
);

vec2 hatchPlane = vStudyWorldPos.xz;
float hatchCoord = dot(hatchPlane, vec2(0.8, 0.6)) + habitatWarp * 0.12;
float hatchResolved = 1.0 - smoothstep(0.3, 0.6, fwidth(hatchCoord) / ${float(marks.hatchSpacing)});
float hatchLine = contourLine(hatchCoord, ${float(marks.hatchSpacing)}, 1.2) * hatchResolved;
float strokeNoise = valueNoise(vec3(hatchPlane * vec2(15.0, 11.0), 1.7));
float strokeKeep = 1.0 - smoothstep(habitatValue - 0.08, habitatValue + 0.08, strokeNoise);
float habitatHatch = hatchLine * strokeKeep * smoothstep(${float(marks.hatchFloor)}, ${float(marks.hatchFloor + 0.1)}, habitatValue);
float habitatInk = habitatHatch * fieldUp * groundTop * uHabitatVisible
  * mix(${float(marks.worldOpacity)}, ${float(marks.fieldOpacity)}, uHabitatEmphasis);

outgoingLight = mix(outgoingLight, uHabitatInk * ${float(marks.inkShade)} * markLight, clamp(habitatInk, 0.0, 1.0));

float habitatGround = fieldUp * groundTop * (1.0 - terrainWall) * uHabitatVisible;
float habitatLoss = smoothstep(${float(marks.changeFrom)}, ${float(marks.changeTo)}, habitatBefore - habitatValue);
float ghostKeep = 1.0 - smoothstep(habitatBefore - 0.08, habitatBefore + 0.08, strokeNoise);
float habitatGhost = hatchLine * ghostKeep * habitatLoss * habitatGround
  * mix(${float(marks.lossOpacity)}, ${float(marks.lossOpacity * 1.5)}, uHabitatEmphasis);
outgoingLight = mix(outgoingLight, mix(uHabitatThin, uHabitatInk, 0.5) * markLight, clamp(habitatGhost, 0.0, 1.0));
float suitableEdge = isoLine(habitatValue, ${float(SUITABLE)}, 1.0) * habitatGround
  * uHabitatEmphasis * ${float(marks.fieldSuitableOpacity)};
outgoingLight = mix(outgoingLight, uHabitatInk * markLight, clamp(suitableEdge, 0.0, 1.0));
`

/**
 * Terrain: a height ramp from dark underside to the top, and across the top
 * from cooler grey valleys to warm chalky heights; slopes cool toward a
 * mineral grey, with broad mottling and grain throughout. Steep faces show
 * warped rock beds of uneven thickness (see `STRATA`), each its own hardness
 * and tone, softly parted by broken seams and
 * streaked where water runs down; the underside darkens with drip stains.
 * On top: scree on moderate slopes, dust on flats, fbm mottling and grain,
 * then mineral character throughout (see `MINERAL`).
 * Ground read from the world field: damp (in irregular patches) near water,
 * wetter at the banks, a faint tint where vegetation can stand, darker where
 * paths wear it. Below the rim (`aBelow`) the ground colour continues down
 * the cliff and underside as grey strata that darken with depth, with a
 * little fill light so shaded faces stay rock rather than a black cut.
 */
const terrainShader = (field: Texture, habitatField: Texture, extent: number): SurfaceShader => ({
  lights: SUN_LIGHTS,
  uniforms: () => ({
    uHabitatColor: color(PROJECT_COLORS.habitat),
    uHabitatThin: color(PROJECT_COLORS.habitatThin),
    uHabitatInk: color(PROJECT_COLORS.habitatInk),
    uHabitatField: { value: habitatField },
    uHabitatVisible: { value: 1 },
    uHabitatEmphasis: { value: 0 },
    uContours: { value: 0 },
    uTerrainLow: color(PROJECT_COLORS.terrainLow),
    uTerrainValley: color(PROJECT_COLORS.terrainValley),
    uTerrainHigh: color(PROJECT_COLORS.terrainHigh),
    uTerrainSlope: color(PROJECT_COLORS.terrainSlope),
    uTerrainRock: color(PROJECT_COLORS.terrainRock),
    uTerrainDust: color(PROJECT_COLORS.terrainDust),
    uTerrainStrata: color(PROJECT_COLORS.terrainStrata),
    uTerrainDeep: color(PROJECT_COLORS.terrainDeep),
    uVegetationGround: color(PROJECT_COLORS.vegetationGround),
    uWorldField: { value: field },
    uWorldExtent: { value: extent },
  }),
  vertexHead: 'attribute float aBelow;\nvarying float vTerrainBelow;',
  vertex: 'vTerrainBelow = aBelow;',
  fragmentHead: `${SHARED_HEAD}
uniform vec3 uTerrainLow;
uniform vec3 uTerrainValley;
uniform vec3 uTerrainHigh;
uniform vec3 uTerrainSlope;
uniform vec3 uTerrainRock;
uniform vec3 uTerrainDust;
uniform vec3 uTerrainStrata;
uniform vec3 uTerrainDeep;
uniform vec3 uVegetationGround;
uniform vec3 uHabitatColor;
uniform vec3 uHabitatThin;
uniform vec3 uHabitatInk;
uniform sampler2D uWorldField;
uniform sampler2D uHabitatField;
uniform float uWorldExtent;
uniform float uHabitatVisible;
uniform float uHabitatEmphasis;
uniform float uContours;
varying float vTerrainBelow;`,
  albedo: /* glsl */ `
vec3 terrainNormal = normalize(vStudyWorldNormal);
float mottling = projectFbm(vStudyWorldPos * 2.2);
float grain = valueNoise(vStudyWorldPos * 40.0);
float fine = valueNoise(vStudyWorldPos * 120.0);
float heightT = smoothstep(-2.4, 0.8, vStudyWorldPos.y + (mottling - 0.5) * 0.4);
float topT = smoothstep(-0.65, 0.8, vStudyWorldPos.y + (mottling - 0.5) * 0.3);
vec3 terrainColor = mix(mix(uTerrainLow, uTerrainValley, heightT), uTerrainHigh, topT);
float slopeT = smoothstep(0.05, 0.45, 1.0 - terrainNormal.y);
terrainColor = mix(terrainColor, uTerrainSlope, slopeT * ${float(MINERAL.slopeCool)});
float broadMottle = smoothstep(0.25, 0.75, projectFbm(vStudyWorldPos * 0.75 + vec3(1.3, 0.0, 4.2)));
terrainColor *= 1.0 + (broadMottle - 0.5) * ${float(2 * MINERAL.broadMottle)};

float strataWarp = projectFbm(vStudyWorldPos * vec3(0.7, 0.25, 0.7)) - 0.5;
float bedCoord = vStudyWorldPos.y * ${float(STRATA.beds)} + strataWarp * 3.0
  + valueNoise(vec3(1.7, vStudyWorldPos.y * 1.6, 4.3)) * ${float(STRATA.thickness)};
float bedFract = fract(bedCoord);
float bedHardness = mix(
  hash31(vec3(floor(bedCoord), 7.1, 3.3)),
  hash31(vec3(floor(bedCoord) + 1.0, 7.1, 3.3)),
  smoothstep(0.7, 1.0, bedFract)
);
float bedSeamLine = 1.0 - smoothstep(0.0, 0.35, bedFract) * (1.0 - smoothstep(0.75, 1.0, bedFract));
float bedSeam = 1.0 - bedSeamLine * smoothstep(0.45, 0.7, projectFbm(vStudyWorldPos * vec3(1.4, 0.5, 1.4) + vec3(0.0, 2.9, 6.1)));
float runoff = valueNoise(vec3(vStudyWorldPos.x * 14.0, vStudyWorldPos.y * 1.2, vStudyWorldPos.z * 14.0));
float steep = smoothstep(0.3, 0.65, 1.0 - terrainNormal.y);
vec3 rock = uTerrainRock * mix(0.84, 1.08, bedHardness) * mix(${float(1 - STRATA.seam)}, 1.0, bedSeam) * mix(0.72, 1.0, heightT);
rock *= 1.0 - smoothstep(0.55, 0.9, runoff) * 0.16;
terrainColor = mix(terrainColor, rock, steep);

float underside = smoothstep(0.1, -0.6, terrainNormal.y);
terrainColor *= 1.0 - underside * (0.18 + 0.14 * smoothstep(0.4, 0.8, runoff));

float scree = smoothstep(0.06, 0.22, 1.0 - terrainNormal.y) * (1.0 - steep);
terrainColor *= 1.0 - scree * 0.12 * (0.4 + fine);
terrainColor *= 1.0 + (grain - 0.5) * ${float(MINERAL.grain)};
float dust = (1.0 - steep) * smoothstep(0.5, 0.72, mottling);
terrainColor = mix(terrainColor, uTerrainDust, dust * 0.5);

float mineralWarp = projectFbm(vStudyWorldPos * 0.9 + vec3(3.1, 0.0, 7.7)) - 0.5;
vec3 mineralPos = vStudyWorldPos * 1.7 + mineralWarp * 1.4;
float mineralZone = projectFbm(mineralPos);
float mineralVein = smoothstep(0.88, 0.985, 1.0 - abs(2.0 * valueNoise(mineralPos * 2.3) - 1.0));
vec3 mineralTint = mix(
  vec3(${MINERAL.warm}),
  vec3(${MINERAL.cool}),
  smoothstep(0.35, 0.65, mineralZone)
) * mix(vec3(${MINERAL.low}), vec3(1.0), heightT);
vec3 speckCell = vStudyWorldPos * ${float(MINERAL.speckScale)};
float speckResolved = 1.0 - smoothstep(0.35, 0.9, length(fwidth(speckCell)));
float speck = hash31(floor(speckCell));
float speckShade = 1.0 + speckResolved * (step(speck, 0.02) * 0.08 - step(0.965, speck) * mix(0.1, 0.18, steep));
float varnish = smoothstep(0.45, 0.8, projectFbm(vStudyWorldPos * 2.6 + vec3(9.2, 4.1, 0.0)));
terrainColor *= mineralTint * speckShade;
terrainColor *= 1.0 - mineralVein * mix(${float(MINERAL.veinTop)}, ${float(MINERAL.veinSteep)}, steep);
terrainColor *= mix(vec3(1.0), vec3(${MINERAL.varnish}), varnish * steep * ${float(MINERAL.varnishAmount)});

vec2 fieldUv = (vStudyWorldPos.xz + uWorldExtent) / (2.0 * uWorldExtent);
vec4 worldField = texture2D(uWorldField, fieldUv);
float habitatWarp = projectFbm(vec3(vStudyWorldPos.xz * 3.1, 2.7)) - 0.5;
vec2 habitatSample = texture2D(uHabitatField, fieldUv + habitatWarp * ${float(marks.warp)}).rg;
float habitatValue = habitatSample.r;
float habitatBefore = habitatSample.g;
float fieldUp = smoothstep(0.55, 0.85, terrainNormal.y);
float dampPatch = worldField.r * smoothstep(0.35, 0.7, mottling + worldField.r * 0.4);
terrainColor *= 1.0 - (0.18 * worldField.r + 0.14 * dampPatch + 0.2 * worldField.a) * fieldUp;
terrainColor *= mix(vec3(1.0), vec3(0.95, 0.975, 1.0), worldField.r * fieldUp);
terrainColor = mix(terrainColor, uVegetationGround, worldField.g * 0.4 * fieldUp);
terrainColor *= 1.0 - worldField.b * ${float(TERRAIN_CLIFF.pathWear)} * fieldUp;

float below = max(vTerrainBelow, 0.0);
float terrainWall = smoothstep(0.0, ${float(TERRAIN_CLIFF.blend)}, below);
vec3 strata = mix(uTerrainHigh * 0.9, uTerrainStrata, smoothstep(0.0, 0.5, below));
strata = mix(strata, uTerrainDeep, smoothstep(0.35, ${float(TERRAIN_CLIFF.deepAt)}, below + (mottling - 0.5) * 0.3));
strata *= mix(0.9, 1.06, bedHardness) * mix(${float(1 - STRATA.seam)}, 1.0, bedSeam);
strata *= 1.0 - smoothstep(0.55, 0.9, runoff) * 0.14 * (1.0 - underside);
strata *= 1.0 - underside * 0.12;
strata *= mineralTint * speckShade * (1.0 - mineralVein * ${float(MINERAL.veinSteep)} * (1.0 - 0.6 * underside));
strata *= mix(vec3(1.0), vec3(${MINERAL.varnish}), varnish * ${float(MINERAL.varnishAmount)});
terrainColor = mix(terrainColor, strata, terrainWall);

float habitatMottle = projectFbm(vec3(vStudyWorldPos.xz * 9.0, 8.1));
float colonyBlot = projectFbm(vec3(vStudyWorldPos.xz * 3.3, 4.4));
float habitatPatch = smoothstep(
  ${float(marks.patchFrom)},
  ${float(marks.patchTo)},
  habitatValue + (habitatMottle - 0.5) * 0.35 + (colonyBlot - 0.5) * 0.2
) * fieldUp * (1.0 - terrainWall) * uHabitatVisible;
terrainColor *= 1.0 - ${float(marks.fieldDim)} * uHabitatEmphasis * (1.0 - habitatPatch) * (1.0 - terrainWall);
float habitatDepth = smoothstep(${float(marks.deepFrom)}, ${float(marks.deepTo)}, habitatValue);

float colonyBody = projectFbm(vec3(vStudyWorldPos.xz * ${float(marks.colonyScale)}, 3.3));
float colonyCrust = valueNoise(vec3(vStudyWorldPos.xz * ${float(marks.crustScale)}, 5.1));
float colonyJoined = smoothstep(
  ${float(SUITABLE - marks.coalesceBelow)},
  ${float(SUITABLE + marks.coalesceAbove)},
  habitatValue + (colonyBody - 0.5) * 0.3
);
float colonyCover = habitatPatch * mix(
  smoothstep(0.5, 0.8, colonyBody + 0.08 * colonyCrust),
  smoothstep(0.05, 0.45, colonyBody + 0.08 * colonyCrust),
  colonyJoined
);
float habitatGain = smoothstep(${float(marks.changeFrom)}, ${float(marks.changeTo)}, habitatValue - habitatBefore);
float colonyMottle = projectFbm(vec3(vStudyWorldPos.xz * ${float(marks.mottleScale)}, 6.7));
float crustShade = mix(${float(marks.mottleDark)}, ${float(marks.mottleLight)}, smoothstep(0.3, 0.7, colonyMottle))
  * mix(0.94, 1.06, colonyCrust);
vec3 lichenTone = mix(uHabitatThin, uHabitatColor, max(habitatDepth, colonyJoined * 0.6));
float colonyOld = ${float(marks.colonyCore)} * smoothstep(0.6, 0.9, colonyBody) * colonyJoined;
float colonyFresh = habitatGain * ${float(marks.fresh)};
lichenTone = mix(mix(lichenTone, uHabitatInk, colonyOld), mix(uHabitatThin, vec3(1.0), 0.3), colonyFresh);
crustShade *= (1.0 - 0.5 * colonyOld) * (1.0 + 0.5 * colonyFresh);
float stainGroundLuma = max(dot(terrainColor, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
float lichenLuma = max(dot(lichenTone, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
float stainLuma = mix(stainGroundLuma, lichenLuma, mix(${float(marks.valueThin)}, ${float(marks.valueDense)}, habitatDepth));
terrainColor = mix(
  terrainColor,
  lichenTone * (stainLuma / lichenLuma) * crustShade,
  colonyCover * mix(${float(marks.worldStain)}, ${float(marks.fieldStain)}, uHabitatEmphasis)
);

vec2 stippleCoord = vStudyWorldPos.xz * ${float(marks.stippleScale)};
vec2 stippleCell = floor(stippleCoord);
vec2 stippleCentre = stippleCell + 0.25 + 0.5 * vec2(hash31(vec3(stippleCell, 7.3)), hash31(vec3(stippleCell, 8.7)));
float stippleDot = 1.0 - smoothstep(0.12, 0.26, length(stippleCoord - stippleCentre));
float stippleResolved = 1.0 - smoothstep(0.2, 0.35, max(fwidth(stippleCoord.x), fwidth(stippleCoord.y)));
float stippleDensity = colonyCover * mix(${float(marks.stippleThin)}, ${float(marks.stippleDense)}, habitatDepth);
terrainColor *= 1.0 - ${float(marks.stippleShade)} * stippleDot * step(hash31(vec3(stippleCell, 6.1)), stippleDensity) * stippleResolved;

float surfaceDetail = clamp(
  (mottling - 0.5) * 2.0 + (mineralZone - 0.5) * 0.6 + (grain - 0.5) * 0.5 + (fine - 0.5) * 0.3
    + ((colonyMottle - 0.5) * 0.8 + (colonyCrust - 0.5) * 0.3) * colonyCover,
  -1.0,
  1.0
);
diffuseColor.rgb = terrainColor * (1.0 + surfaceDetail * 0.12);
`,
  roughness: `roughnessFactor = mix(0.82, 1.0, grain) - 0.15 * worldField.a * fieldUp + ${float(marks.roughness)} * colonyCover;`,
  lit: `outgoingLight += diffuseColor.rgb * ${float(TERRAIN_CLIFF.fill)} * terrainWall;
${EXPOSURE_CHUNK}
${TERRAIN_MARKS}`,
})

/**
 * Shaded architecture keeps this much of its colour, so it holds a silhouette
 * on the black field; worn stone keeps more, up to the second value, so wear
 * still reads from the shaded side.
 */
const ARCH_SHADE_FLOOR = { intact: 0.1, worn: 0.24 } as const

const ARCH_WEATHER = {
  /** Tone difference between voxel courses on walls, so accretion reads layer by layer. */
  course: 0.07,
  /** How far age alone pales open faces toward weathered grey; the rest of the way is wear. */
  agedPale: 0.35,
  patina: 0.75,
  /** Pale mineral bloom on old, exposed faces. */
  bloom: 0.45,
  grain: 0.16,
} as const

/** Wear toward removal: age since DECAY_AGE_FROM times exposure to decay (`aWeather`). */
const ARCH_WEAR = {
  /** Share of full wear a sheltered block (enclosed, not standing proud) still reaches. */
  sheltered: 0.25,
  /** Wear bands: weathered from `weatheredFrom`…`weatheredTo`, heavily weathered from `heavyFrom`…`heavyTo`. */
  weatheredFrom: 0.12,
  weatheredTo: 0.45,
  heavyFrom: 0.45,
  heavyTo: 0.85,
  /**
   * Weathered: the graphite leaches to a paler, cooler mineral grey, mottled
   * in patches about half a block across, so it reads at viewing distance.
   */
  leach: 0.7,
  leachScale: 3.2,
  leachMottle: 0.3,
  /** Block edges (world units wide, weathered to heavy) wear to chalk first. */
  edgeFrom: 0.012,
  edgeTo: 0.03,
  edge: 0.45,
  /** Heavily weathered: friable stone, paler than dust, eaten into dark pockets. */
  friable: 0.6,
  friableLift: 1.2,
  pocketScale: 7,
  pocket: 0.7,
  /** Relief of the worn surface (world units), so the sun rakes it; pockets sink. */
  relief: 0.012,
  /** Joints between courses and modules open and darken once weathered, darker and wider once heavily weathered. */
  joint: 0.12,
  heavyJoint: 0.35,
  /** Roughness added once weathered, and again once heavily weathered. */
  roughWeathered: 0.1,
  roughHeavy: 0.12,
} as const

/**
 * Architecture: colour records the growth. Age is simulated time since a
 * block was placed (`aBirth` against `uArchClock`), full after AGE_HOURS.
 * Fresh blocks are an even graphite; with age they part by orientation —
 * sheltered faces sink to charcoal, open ones (turned to the noon sun, −Z,
 * tops, high blocks) lighten a little, leaving the pale end to wear — each
 * voxel course a slightly different tone.
 * Faces turned away gather dark patina; the foot is damp and stained, taller
 * near water (`aLift`, world field); old exposed faces grow a pale mineral
 * bloom; the shared lit chunk bleaches sunlit texels. Fine grain throughout;
 * tops catch dust, so terraces read.
 * Wear toward removal follows decay's own weighting: old blocks where decay
 * reads open, proud or overhanging form (`aWeather`) go through three
 * material states, each legible at viewing distance: intact graphite →
 * weathered (leached to a mottled mineral grey, matte, edges chalking) →
 * heavily weathered (pale friable stone eaten into dark pockets, raked by
 * the sun through a worn relief, joints wide) before decay takes them.
 */
const architectureShader = (field: Texture, extent: number): SurfaceShader => ({
  lights: SUN_LIGHTS,
  uniforms: () => ({
    uArchFresh: color(PROJECT_COLORS.archFresh),
    uArchBase: color(PROJECT_COLORS.archBase),
    uArchWeathered: color(PROJECT_COLORS.archWeathered),
    uArchPatina: color(PROJECT_COLORS.archPatina),
    uArchDust: color(PROJECT_COLORS.archDust),
    uWorldField: { value: field },
    uWorldExtent: { value: extent },
    uArchClock: { value: 0 },
  }),
  vertexHead: /* glsl */ `
uniform float uArchClock;
attribute float aBirth;
attribute float aLift;
attribute float aWeather;
varying float vArchAge;
varying float vArchLift;
varying float vArchWeather;`,
  vertex: `vArchAge = clamp((uArchClock - aBirth) / ${float(AGE_HOURS)}, 0.0, 1.0);\nvArchLift = aLift;\nvArchWeather = aWeather;`,
  fragmentHead: `${SHARED_HEAD}
uniform vec3 uArchFresh;
uniform vec3 uArchBase;
uniform vec3 uArchWeathered;
uniform vec3 uArchPatina;
uniform vec3 uArchDust;
uniform sampler2D uWorldField;
uniform float uWorldExtent;
varying float vArchAge;
varying float vArchLift;
varying float vArchWeather;`,
  albedo: /* glsl */ `
vec3 archNormal = normalize(vStudyWorldNormal);
vec3 blockCell = vec3(${float(MODULE_SIZE)}, ${float(2 * VOXEL_SIZE)}, ${float(MODULE_SIZE)});
vec3 blockOrigin = vec3(${float(LATTICE_ORIGIN)}, ${float(LAYER_BASE)}, ${float(LATTICE_ORIGIN)});
float blockTint = hash31(floor((vStudyWorldPos - archNormal * 0.02 - blockOrigin) / blockCell));
float patina = projectFbm(vStudyWorldPos * 2.8);
float streaks = valueNoise(vec3(vStudyWorldPos.x * 16.0, vStudyWorldPos.y * 1.3, vStudyWorldPos.z * 16.0));
float wall = 1.0 - abs(archNormal.y);
float age = smoothstep(0.0, 1.0, vArchAge);
float sunward = clamp(-archNormal.z, 0.0, 1.0) * wall;
float shadeward = clamp(archNormal.z, 0.0, 1.0) * wall;
vec4 worldField = texture2D(uWorldField, (vStudyWorldPos.xz + uWorldExtent) / (2.0 * uWorldExtent));
float dampFoot = 1.0 - smoothstep(0.0, 0.25 + 0.35 * worldField.a, vArchLift);

float archGrain = valueNoise(vStudyWorldPos * 90.0);
float courseTint = hash31(vec3(floor((vStudyWorldPos.y - archNormal.y * 0.02 - blockOrigin.y) / ${float(VOXEL_SIZE)}), 5.3, 1.7));
float archExposure = clamp(sunward * 0.6 + max(archNormal.y, 0.0) * 0.5 + smoothstep(0.1, 1.2, vArchLift) * 0.3, 0.0, 1.0);
float bloomNoise = projectFbm(vStudyWorldPos * 6.0 + vec3(2.3, 0.0, 5.1));
float mineralBloom = smoothstep(0.56, 0.84, bloomNoise + archGrain * 0.12) * age * archExposure;

vec3 archAged = mix(
  uArchBase,
  mix(uArchFresh, uArchWeathered, ${float(ARCH_WEATHER.agedPale)}),
  smoothstep(0.15, 0.85, archExposure + (patina - 0.5) * 0.3)
);
vec3 archColor = mix(uArchFresh, archAged, age) * mix(0.88, 1.1, blockTint);
archColor *= mix(1.0, mix(${float(1 - ARCH_WEATHER.course)}, ${float(1 + ARCH_WEATHER.course)}, courseTint), wall);
float patinaAmount = smoothstep(0.45, 0.8, patina + dampFoot * 0.35 + shadeward * 0.25) * age;
archColor = mix(archColor, uArchPatina, patinaAmount * ${float(ARCH_WEATHER.patina)});
archColor *= 1.0 - dampFoot * (0.12 + 0.18 * worldField.a) * (0.4 + 0.6 * age);
archColor *= 1.0 - wall * smoothstep(0.55, 0.9, streaks) * 0.22 * age;
archColor = mix(archColor, uArchDust, mineralBloom * ${float(ARCH_WEATHER.bloom)});
archColor = mix(archColor, uArchDust, max(archNormal.y, 0.0) * (0.25 + 0.35 * smoothstep(0.4, 0.7, patina)));
archColor *= 1.0 + (archGrain - 0.5) * ${float(ARCH_WEATHER.grain)} * (0.5 + 0.5 * age);
archColor *= mix(1.0, 0.8, max(-archNormal.y, 0.0));

float wear = smoothstep(${float(DECAY_AGE_FROM)}, 1.0, vArchAge) * mix(${float(ARCH_WEAR.sheltered)}, 1.0, vArchWeather);
float weathered = smoothstep(${float(ARCH_WEAR.weatheredFrom)}, ${float(ARCH_WEAR.weatheredTo)}, wear);
float heavy = smoothstep(${float(ARCH_WEAR.heavyFrom)}, ${float(ARCH_WEAR.heavyTo)}, wear);
float leach = projectFbm(vStudyWorldPos * ${float(ARCH_WEAR.leachScale)} + vec3(5.1, 1.7, 0.0));
vec3 leached = uArchWeathered * vec3(0.97, 0.99, 1.02) * (1.0 + (leach - 0.5) * ${float(2 * ARCH_WEAR.leachMottle)});
archColor = mix(archColor, leached, weathered * ${float(ARCH_WEAR.leach)});

vec3 wearPos = vStudyWorldPos - archNormal * 0.02 - blockOrigin;
vec3 cellFract = fract(wearPos / blockCell);
vec3 edgeGap = min(cellFract, 1.0 - cellFract) * blockCell;
float edgeWidth = mix(${float(ARCH_WEAR.edgeFrom)}, ${float(ARCH_WEAR.edgeTo)}, heavy) * mix(0.6, 1.4, leach);
vec3 edgeNear = (1.0 - smoothstep(vec3(0.0), vec3(edgeWidth), edgeGap)) * (1.0 - abs(archNormal));
float blockEdge = max(max(edgeNear.x, edgeNear.y), edgeNear.z);
archColor = mix(archColor, uArchDust, blockEdge * weathered * ${float(ARCH_WEAR.edge)});

float erosion = projectFbm(vStudyWorldPos * ${float(ARCH_WEAR.pocketScale)} + vec3(2.0, 9.0, 4.0));
float pocket = smoothstep(0.52, 0.68, erosion + (archGrain - 0.5) * 0.12) * heavy;
archColor = mix(archColor, uArchDust * ${float(ARCH_WEAR.friableLift)} * (1.0 + (leach - 0.5) * 0.2), heavy * ${float(ARCH_WEAR.friable)});
archColor = mix(archColor, uArchPatina, pocket * ${float(ARCH_WEAR.pocket)});
float wearRelief = (weathered * 0.3 + heavy) * (erosion - pocket * 0.8) * ${float(ARCH_WEAR.relief)};

float jointWidth = 1.0 + 1.5 * heavy;
float courseJoint = contourLine(wearPos.y, ${float(VOXEL_SIZE)}, jointWidth) * wall;
float moduleJoint = max(
  contourLine(wearPos.x, ${float(MODULE_SIZE)}, jointWidth) * (1.0 - abs(archNormal.x)),
  contourLine(wearPos.z, ${float(MODULE_SIZE)}, jointWidth) * (1.0 - abs(archNormal.z))
);
float joint = max(courseJoint, moduleJoint) * mix(0.6, 1.0, archGrain);
archColor = mix(archColor, uArchPatina, joint * (weathered * ${float(ARCH_WEAR.joint)} + heavy * ${float(ARCH_WEAR.heavyJoint)}));

float surfaceDetail = clamp(
  (blockTint - 0.5) + (patina - 0.5) * 1.5 + (archGrain - 0.5) * 0.4 + mineralBloom * 0.5 + (erosion - 0.5) * heavy,
  -1.0,
  1.0
);
diffuseColor.rgb = archColor;
`,
  roughness: `roughnessFactor = mix(0.72, 0.95, blockTint) + 0.05 * age + 0.04 * archGrain
  + ${float(ARCH_WEAR.roughWeathered)} * weathered + ${float(ARCH_WEAR.roughHeavy)} * heavy;`,
  normal: /* glsl */ `
vec3 wearDpdx = dFdx(-vViewPosition);
vec3 wearDpdy = dFdy(-vViewPosition);
vec3 wearR1 = cross(wearDpdy, normal);
vec3 wearR2 = cross(normal, wearDpdx);
float wearDet = dot(wearDpdx, wearR1);
vec3 wearGrad = sign(wearDet) * (dFdx(wearRelief) * wearR1 + dFdy(wearRelief) * wearR2);
normal = normalize(abs(wearDet) * normal - wearGrad);
`,
  lit: `outgoingLight = max(
  outgoingLight,
  diffuseColor.rgb * mix(${float(ARCH_SHADE_FLOOR.intact)}, ${float(ARCH_SHADE_FLOOR.worn)}, max(weathered * 0.5, heavy))
);
${EXPOSURE_CHUNK}`,
})

export function createTerrainMaterial(
  field: Texture,
  habitatField: Texture,
  extent: number,
): SurfaceMaterial {
  return createSurfaceMaterial(terrainShader(field, habitatField, extent), {
    cacheKey: 'project-terrain',
    color: PROJECT_COLORS.terrainHigh,
  })
}

export type TerrainDisplay = {
  habitat: boolean
  /** Field only: habitat emphasised, the rest of the ground dimmed. */
  fieldOnly: boolean
  contours: boolean
  wireframe: boolean
}

export function setTerrainDisplay(terrain: SurfaceMaterial, display: TerrainDisplay) {
  terrain.uniforms.uHabitatVisible!.value = display.habitat ? 1 : 0
  terrain.uniforms.uHabitatEmphasis!.value = display.fieldOnly ? 1 : 0
  terrain.uniforms.uContours!.value = display.contours ? 1 : 0
  terrain.material.wireframe = display.wireframe
}

export function createArchitectureMaterial(field: Texture, extent: number): SurfaceMaterial {
  return createSurfaceMaterial(architectureShader(field, extent), {
    cacheKey: 'project-architecture',
    color: PROJECT_COLORS.archFresh,
  })
}

/** The architecture clock (simulated hours since Reset) the blocks age against. */
export function setArchitectureClock(architecture: SurfaceMaterial, clock: number) {
  architecture.uniforms.uArchClock!.value = clock
}

type Patch = {
  key: string
  uniforms: Record<string, IUniform>
  vertexHead?: string
  vertex?: string
  fragmentHead?: string
  albedo?: string
  roughness?: string
  normal?: string
  lit?: string
}

/** Injects GLSL into a MeshStandardMaterial, keeping its lighting and shadows. */
function patch(material: MeshStandardMaterial, { key, uniforms, ...glsl }: Patch) {
  material.onBeforeCompile = (program: WebGLProgramParametersWithUniforms) => {
    Object.assign(program.uniforms, uniforms)
    program.vertexShader = program.vertexShader
      .replace('void main() {', `${glsl.vertexHead ?? ''}\nvoid main() {`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${glsl.vertex ?? ''}`)
    program.fragmentShader = program.fragmentShader
      .replace('void main() {', `${glsl.fragmentHead ?? ''}\nvoid main() {`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${glsl.albedo ?? ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${glsl.roughness ?? ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${glsl.normal ?? ''}`)
      .replace('#include <opaque_fragment>', `${glsl.lit ?? ''}\n#include <opaque_fragment>`)
  }
  material.customProgramCacheKey = () => `project-${key}`
  return material
}

export type WaterMaterial = {
  material: MeshStandardMaterial
  uniforms: { uTime: IUniform<number>; uContours: IUniform<number> }
}

/**
 * Water: cobalt, deeper in colour with depth, its surface moved by the
 * hydrology. Rivers carry ripples and streaks advected downstream at their
 * current (`aSpeed`, from the channel grade), fastest mid-channel (`aAcross`);
 * lakes only swell slowly; falls stream fast and break into foam as they drop,
 * dissolving into a dither past the underside. The ripples perturb the normal,
 * so the sun catches them. Analytical linework follows the Contours view
 * tool: flow lines down rivers and falls, depth contours (bathymetry) on lakes.
 */
export function createWaterMaterial(): WaterMaterial {
  const uniforms = {
    uTime: { value: 0 },
    uContours: { value: 0 },
    uWaterShallow: color(PROJECT_COLORS.waterShallow),
    uWaterDeep: color(PROJECT_COLORS.waterDeep),
    uWaterLine: color(PROJECT_COLORS.waterLine),
  }
  const material = patch(
    new MeshStandardMaterial({ roughness: 0.3, metalness: 0, side: DoubleSide }),
    {
      key: 'water',
      uniforms,
      vertexHead: /* glsl */ `
attribute float aFlow;
attribute float aDepth;
attribute float aFall;
attribute float aAcross;
attribute float aSpeed;
varying float vFlow;
varying float vDepth;
varying float vFall;
varying float vAcross;
varying float vSpeed;
varying vec3 vWaterPos;`,
      vertex: /* glsl */ `
vFlow = aFlow;
vDepth = aDepth;
vFall = aFall;
vAcross = aAcross;
vSpeed = aSpeed;
vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      fragmentHead: /* glsl */ `
uniform float uTime;
uniform float uContours;
uniform vec3 uWaterShallow;
uniform vec3 uWaterDeep;
uniform vec3 uWaterLine;
varying float vFlow;
varying float vDepth;
varying float vFall;
varying float vAcross;
varying float vSpeed;
varying vec3 vWaterPos;
${LINE_GLSL}
${NOISE_GLSL}
float streakRipple(vec2 p) {
  return valueNoise(vec3(p.x * 18.0, p.y * 3.0, 0.0)) * 0.6
    + valueNoise(vec3(p.x * 46.0, p.y * 5.0, 3.7)) * 0.4;
}
float flowRipple(vec2 p, float current) {
  float cycle = ${float(WATER.flowCycle)};
  float phaseA = fract(uTime / cycle);
  float phaseB = fract(uTime / cycle + 0.5);
  float a = streakRipple(vec2(p.x - phaseA * cycle * current, p.y));
  float b = streakRipple(vec2(p.x - phaseB * cycle * current + 0.37, p.y + 0.21));
  return mix(b, a, 1.0 - abs(2.0 * phaseA - 1.0));
}`,
      albedo: /* glsl */ `
float isRiver = step(-0.5, vFlow);
float isFall = step(0.001, vFall);
float current = vSpeed * ${float(WATER.flowSpeed)} * (0.5 + 0.5 * (1.0 - vAcross * vAcross));
float lakeSwell = valueNoise(vec3(vWaterPos.xz * 14.0, uTime * 0.12)) * 0.65
  + valueNoise(vec3(vWaterPos.xz * 34.0 + uTime * 0.02, uTime * 0.2)) * 0.35;
float riverRipple = flowRipple(vec2(vFlow, vAcross), current);
float fallStreak = flowRipple(vec2(vFlow * 0.35, vAcross * 2.5), current * 0.35);
float waterWave = mix(lakeSwell, mix(riverRipple, fallStreak, isFall), isRiver);
float waterAmplitude = mix(
  ${float(WATER.lakeRipple)},
  mix(${float(WATER.riverRipple)} * vSpeed, ${float(WATER.fallRipple)}, isFall),
  isRiver
);
float waterHeight = waterWave * waterAmplitude;
vec3 waterDpdx = dFdx(-vViewPosition);
vec3 waterDpdy = dFdy(-vViewPosition);
float waterDhdx = dFdx(waterHeight);
float waterDhdy = dFdy(waterHeight);

if (vFall > 0.0) {
  float dither = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  if (dither < pow(vFall, 1.4)) discard;
}
vec3 waterColor = mix(uWaterShallow, uWaterDeep, smoothstep(0.0, ${float(WATER.deepAt)}, vDepth));
float lakeShore = (1.0 - isRiver) * (1.0 - smoothstep(0.0, ${float(WATER.shoreDepth)}, vDepth));
waterColor = mix(waterColor, uWaterLine, lakeShore * 0.3);
float riverThread = isRiver * (1.0 - isFall) * (1.0 - smoothstep(0.0, 0.4, abs(vAcross)))
  * smoothstep(0.55, 0.85, riverRipple) * min(1.0, vSpeed);
waterColor = mix(waterColor, uWaterLine, riverThread * 0.3);
waterColor = mix(waterColor, uWaterLine, isFall * (0.15 + 0.3 * fallStreak));
float waterContrast = mix(0.1, mix(0.3 * min(1.0, vSpeed), 0.2, isFall), isRiver);
diffuseColor.rgb = waterColor * (1.0 + (waterWave - 0.5) * waterContrast);
`,
      roughness: `roughnessFactor = mix(${float(WATER.lakeRoughness)}, mix(${float(WATER.riverRoughness)}, ${float(WATER.fallRoughness)}, isFall), isRiver);`,
      normal: /* glsl */ `
vec3 waterR1 = cross(waterDpdy, normal);
vec3 waterR2 = cross(normal, waterDpdx);
float waterDet = dot(waterDpdx, waterR1);
vec3 waterGrad = sign(waterDet) * (waterDhdx * waterR1 + waterDhdy * waterR2);
normal = normalize(abs(waterDet) * normal - waterGrad);
`,
      lit: /* glsl */ `
outgoingLight += diffuseColor.rgb * ${float(WATER.selfLit)};
float fallLip = 1.0 - smoothstep(0.0, 0.12, vFall);
float fallFoam = isFall * max(smoothstep(0.55, 0.8, fallStreak) * (0.35 + 0.65 * smoothstep(0.0, 0.3, vFall)), fallLip * smoothstep(0.4, 0.7, fallStreak));
float rapids = isRiver * (1.0 - isFall) * smoothstep(1.2, 1.8, vSpeed) * smoothstep(0.7, 0.9, riverRipple) * 0.5;
outgoingLight = mix(outgoingLight, uWaterLine, max(fallFoam, rapids) * ${float(WATER.foamOpacity)});
float flowLine = contourLine(vFlow - uTime * ${float(WATER.flowSpeed)}, ${float(WATER.flowSpacing)}, 1.0) * isRiver * uContours;
float depthLine = contourLine(vDepth, ${float(WATER.depthInterval)}, 1.0) * step(0.005, vDepth) * (1.0 - isRiver) * uContours;
outgoingLight = mix(
  outgoingLight,
  uWaterLine,
  max(flowLine * ${float(WATER.flowOpacity)}, depthLine * ${float(WATER.depthOpacity)})
);
`,
    },
  )
  return { material, uniforms }
}

export function advanceWaterTime(water: WaterMaterial, delta: number) {
  water.uniforms.uTime.value += delta
}

export function setWaterContours(water: WaterMaterial, contours: boolean) {
  water.uniforms.uContours.value = contours ? 1 : 0
}

/**
 * Vegetation: an abstract botanical form (stem, tiers of blades, a bud; see
 * `aForm`) shaped per plant by `aPlant` (moisture, light, vigour, seed). Wet,
 * shaded plants spread and droop; dry, sunlit ones stay upright and tight.
 * Vigour decides how many tiers open. Colour deepens with moisture, bleaches
 * in full sun and pales toward the blade tips.
 */
export function createVegetationMaterial(): MeshStandardMaterial {
  return patch(new MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: DoubleSide }), {
    key: 'vegetation',
    uniforms: {
      uVegetationBase: color(PROJECT_COLORS.vegetationBase),
      uVegetationTip: color(PROJECT_COLORS.vegetationTip),
      uVegetationDry: color(PROJECT_COLORS.vegetationDry),
    },
    vertexHead: /* glsl */ `
attribute vec3 aForm;
attribute vec4 aPlant;
varying vec3 vVegForm;
varying vec4 vVegPlant;
varying float vVegHeight;`,
    vertex: /* glsl */ `
float vegLush = clamp(aPlant.x * 0.7 + (1.0 - aPlant.y) * 0.5, 0.0, 1.0);
vec3 vegAttach = vec3(0.0, aForm.y, 0.0);
if (aForm.x > 0.5 && aForm.x < 1.5) {
  float vegOpen = smoothstep(aForm.y - 0.12, aForm.y + 0.04, 0.3 + 0.75 * aPlant.z);
  vec3 vegBlade = transformed - vegAttach;
  vegBlade.xz *= mix(0.75, 1.5, vegLush);
  vegBlade.y -= aForm.z * aForm.z * mix(0.02, 0.22, vegLush);
  transformed = vegAttach + vegBlade * vegOpen;
} else if (aForm.x > 1.5) {
  transformed = vegAttach + (transformed - vegAttach) * mix(0.3, 1.2, aPlant.y * aPlant.z);
}
transformed.x += transformed.y * transformed.y * (aPlant.w - 0.5) * 0.16;
vVegForm = aForm;
vVegPlant = aPlant;
vVegHeight = position.y;`,
    fragmentHead: /* glsl */ `
uniform vec3 uVegetationBase;
uniform vec3 uVegetationTip;
uniform vec3 uVegetationDry;
varying vec3 vVegForm;
varying vec4 vVegPlant;
varying float vVegHeight;`,
    albedo: /* glsl */ `
float vegRise = clamp(max(vVegHeight, vVegForm.z), 0.0, 1.0);
vec3 vegColor = mix(uVegetationBase, uVegetationTip, smoothstep(0.0, 1.0, vegRise));
vegColor *= mix(1.08, 0.78, vVegPlant.x);
vegColor = mix(vegColor, uVegetationDry, smoothstep(0.55, 1.0, vVegPlant.y) * (1.0 - vVegPlant.x) * 0.6);
vegColor = mix(vegColor, uVegetationDry * 1.1, step(1.5, vVegForm.x) * 0.5);
diffuseColor.rgb = vegColor * mix(0.86, 1.1, vVegPlant.w);
`,
  })
}

/**
 * Paths: a continuous band of worn ground draped on the terrain, darkest
 * along the trodden centre, with a ragged, grainy edge so it sits in the
 * ground. Where routes join into trunks the bands overlap and read darker.
 */
export function createPathMaterial(): MeshStandardMaterial {
  return patch(
    new MeshStandardMaterial({
      roughness: 1,
      metalness: 0,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    {
      key: 'path',
      uniforms: {
        uPathWorn: color(PROJECT_COLORS.pathWorn),
      },
      vertexHead: 'attribute float aFlow;\nattribute float aAcross;\nvarying float vFlow;\nvarying float vAcross;',
      vertex: 'vFlow = aFlow;\nvAcross = aAcross;',
      fragmentHead: `uniform vec3 uPathWorn;
varying float vFlow;
varying float vAcross;
${NOISE_GLSL}`,
      albedo: /* glsl */ `
float pathRagged = (valueNoise(vec3(vFlow * 22.0, 0.0, 1.3)) - 0.5) * 0.35;
float pathEdge = abs(vAcross + pathRagged * 0.4) + pathRagged * 0.3;
float pathGrain = valueNoise(vec3(vFlow * 90.0, vAcross * 7.0, 4.1));
float pathCore = 1.0 - smoothstep(0.0, 0.45, pathEdge);
diffuseColor.rgb = uPathWorn * mix(1.12, 0.82, pathCore) * mix(0.9, 1.1, pathGrain);
diffuseColor.a = (1.0 - smoothstep(0.3, 1.0, pathEdge)) * mix(0.7, 1.0, pathGrain)
  * mix(${float(PATH_WEAR.edgeOpacity)}, ${float(PATH_WEAR.coreOpacity)}, pathCore);
`,
    },
  )
}
