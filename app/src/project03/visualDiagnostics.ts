import { Color, Vector2 } from 'three'
import { light, stageGeology, stageGround, stageHour, terrainSun } from './visualStudyWorlds.ts'

/**
 * Shadow Ecology 0.3 — EXPLORE DATA: diagnostic views of the data and rules behind what the world shows. Each is a flat, unlit drawing of one layer
 * (with a fixed, time-independent hill shade so the land's form still reads), on every styled surface; they change nothing in the world.
 *
 * Round 08C, one debugging system. Every view draws from ONE restrained palette (DIAG_COLOUR): muted categorical colours for categories, one
 * sequential ramp (dark slate, teal, pale sand) for every continuous measurement, and the same neutral for whatever a view is not about. And every
 * view decides, per pixel, a CATEGORY (dgCat: the index of its legend entry, or -1) and a VALUE (dgVal, 0 to 1: the continuous measurement, or the
 * dominant share), which serve three things at once:
 *   colour       the legend's colour for that category, or the ramp at that value
 *   highlight    uDiagFocus (a category) or uDiagBand (a range of values) keeps that part of the island and dims the rest (legend and island hover)
 *   probe        with uDiagProbe on, a surface writes its kind, category and value instead of a colour, so the pointer reads exactly what is drawn
 *                (dataProbe.tsx renders the one pixel under the pointer this way)
 *
 *   ground    Ground cover. Materials: the four ground weights the ecology writes (vegCoverage.ts › groundTexture, 16 m texels, raw), blended by
 *             share; what is left is bare rock; the category is the largest share. Habitat zones and Moisture: the island's own fields
 *             (vegCoverage.ts › overlayTexture, written as data: the dominant zone and its strength, the moisture).
 *   geology   Geology. Materials: the Black Stage's geological rules, exactly as the final render runs them (visualStudyWorlds.ts › stageGeology).
 *             Slope: the slope those rules read (the geology map, terrainGeology.ts), on the ramp, with the rules' thresholds as fine lines.
 *   sun       Sun and shadow now: full sun, glancing, turned away, the shadow map's cast shadows, and the sun below the horizon (stageHour).
 *   ecolight  Ecological light. Day's light: the share of the day's sun each place receives (the island's light field), with the shade the
 *             structures cast over the day hatched over it and the edge of the moss. Structures: the architecture's footprint, shelter and shade.
 *   water     Water flow: rivers with chevrons pointing downstream along their own course, steep reaches and falls, lakes; the land muted.
 */
export type DiagView = 'final' | 'ground' | 'geology' | 'sun' | 'ecolight' | 'water'
export type DiagSub = 0 | 1 | 2

export const DIAG_VIEWS: { value: DiagView; label: string }[] = [
  { value: 'final', label: 'Final render' },
  { value: 'ground', label: 'Ground cover' },
  { value: 'geology', label: 'Geology' },
  { value: 'sun', label: 'Sun & shadow' },
  { value: 'ecolight', label: 'Ecological light' },
  { value: 'water', label: 'Water flow' },
]

/** The one palette of the data views (sRGB), shared by the shader and the legend. */
export const DIAG_COLOUR = {
  // categories
  floor: '#58825A',
  moss: '#5C9A92',
  meadow: '#B4B26A',
  shore: '#D6C4A0',
  rock: '#8D8A85',
  zMoist: '#6F9A68',
  zShore: '#5C9A92',
  zDry: '#C9B06E',
  zShaded: '#86708F',
  zAlpine: '#9DB0C4',
  zRock: '#8D8A85',
  zBare: '#5E5C5A',
  cap: '#E6E0D2',
  sand: '#C2A57C',
  bed: '#B07A5E',
  talus: '#8E7A66',
  stain: '#86708F',
  covered: '#4A4E49',
  full: '#ECE5D3',
  glance: '#B6AFA2',
  away: '#5F6D84',
  cast: '#8E83B4',
  night: '#252B3A',
  river: '#7DB2C4',
  fall: '#D5E6EA',
  lake: '#4E7598',
  land: '#3C3D40',
  arrow: '#EEF4F5',
  structShade: '#B07A5E',
  mossEdge: '#E6E0D2',
  footprint: '#B07A5E',
  sheltered: '#C9B06E',
  shaded: '#6E8FB0',
  // the ramp, for every continuous measurement: little to much
  rampLow: '#25303F',
  rampMid: '#4C8A86',
  rampHigh: '#EDE2B8',
  // what a view is not about, and what a highlight sets aside
  water: '#3E5566',
  neutral: '#7E7E84',
  dim: '#232427',
} as const

/**
 * EXPLORE'S LENSES (uDiagSoft on): the same views, drawn in the site's own colours rather than the technical palette, so a lens looks like Shadow
 * Ecology looking at its own data. The colours are taken from what the world and the site already use: the Black Stage's teal water and its moss
 * and olive greens (visualStudyWorlds.ts › DIO_TEAL, DIO_TEAL_SHALLOW, DIO_MOSS, DIO_OLIVE, DIO_OLIVE_DEEP), the site's signal red (--signal) and
 * its neutrals (--pv-black, --ui-title, DIO_CHALK). Neutral greys carry context (the land a lens is not about, the structures, the plants); teal is
 * only ever water; green only ecology; red only what must stand out (iron-stained cliffs, the steepest ground, the structures' shade). Every key
 * of the technical palette has its lens colour, so the views' own code draws both (diagChunk).
 */
const INK = '#0A0A0A'
const CHARCOAL = '#2B2B2D'
const GREY = '#7A7977'
const GREY_LIGHT = '#A9A7A2'
const BONE = '#CFCBC3'
const PAPER = '#E9E6DF'
const CHALK = '#F3EFE5'
const TEAL_DEEP = '#1F4D52'
const TEAL = '#3E7A7B'
const TEAL_PALE = '#9CC0BC'
const MOSS = '#4E5F45'
const MOSS_DEEP = '#2E3A2C'
const OLIVE_DEEP = '#5E6339'
const OLIVE = '#9D9B62'
const SIGNAL = '#FF1F1F'
export const LENS_COLOUR: Record<keyof typeof DIAG_COLOUR, string> = {
  // Plant cover: the greens for what grows, neutrals for what does not.
  floor: OLIVE_DEEP,
  moss: MOSS_DEEP,
  meadow: OLIVE,
  shore: BONE,
  rock: GREY,
  // Habitats: green for the living ground, teal for the shore, neutrals by how open or high, near-black where shade lasts.
  zMoist: MOSS,
  zShore: TEAL,
  zDry: OLIVE,
  zShaded: '#202822',
  zAlpine: PAPER,
  zRock: GREY_LIGHT,
  zBare: GREY,
  // Rock and soil: the rock in neutral steps, iron staining in red, ground under soil and plants in moss.
  cap: CHALK,
  sand: BONE,
  bed: GREY,
  talus: GREY_LIGHT,
  stain: SIGNAL,
  covered: MOSS,
  // Shadows now: light to dark, the cast shadow nearly black.
  full: CHALK,
  glance: GREY_LIGHT,
  away: GREY,
  cast: '#1C1E21',
  night: INK,
  // Water flow: running water a bright teal, still water the island's deep teal, over pale land: the two read apart at a glance.
  river: '#5FA19F',
  fall: TEAL_PALE,
  lake: TEAL_DEEP,
  land: BONE,
  arrow: CHALK,
  // Light over a day, and the structures.
  // Lasting shade: a structure's shade in the island's lavender shadow tone (terrain shade is the dark end of the ramp, a cool blue-grey),
  // and the moss edge in the plants' olive: where the shade-tolerant ground cover begins.
  structShade: '#8E83C8',
  mossEdge: '#B9C06A',
  // Lasting shade: the colours the structures' overlay is actually drawn in (Vegetation.tsx › paintArchitecture, owned by the vegetation
  // system), so the legend tells the truth. (To draw it in the world's lavender shadow tone, that overlay's colours change first.)
  footprint: '#B07A5E',
  sheltered: '#C9B06E',
  shaded: '#6E8FB0',
  rampLow: CHARCOAL,
  rampMid: GREY,
  rampHigh: CHALK,
  // Context: water a lens is not about, structures and plants, and what a selection sets aside.
  water: '#41595B',
  neutral: '#8C8A86',
  dim: '#1A1A1B',
}
/** The lenses' continuous measurements, each on its own ramp (low, middle, high): moisture dry to damp in teal, slope flat to cliff ending in red,
 *  the day's light dark to bright. */
export const LENS_RAMPS: Record<string, [string, string, string]> = {
  'ground-2': [PAPER, TEAL, TEAL_DEEP],
  'geology-1': [PAPER, GREY, SIGNAL],
  // (Sun exposure: deep blue-grey where the terrain keeps the sun off most of the day, warm sand where it falls all day.)
  'ecolight-0': ['#22303F', '#7C8079', '#E8DDBF'],
}

export type LegendItem = { label: string; colour: string }
/** A view's legend: categories (index = dgCat), or a continuous ramp (dgVal 0..1 mapped to min..max) with optional extra keys. */
export type Legend =
  | { kind: 'cat'; title: string; items: LegendItem[]; fixed?: boolean }
  | { kind: 'ramp'; title: string; min: number; max: number; unit: string; low: string; high: string; ticks?: number[]; extras?: LegendItem[] }

const legendsIn = (C: Record<keyof typeof DIAG_COLOUR, string>): Record<string, Legend> => ({
  'ground-0': { kind: 'cat', title: 'Largest ground share', items: [
    { label: 'Woodland floor', colour: C.floor }, { label: 'Moss', colour: C.moss }, { label: 'Meadow', colour: C.meadow }, { label: 'Shore gravel', colour: C.shore }, { label: 'Bare rock', colour: C.rock },
  ] },
  'ground-1': { kind: 'cat', title: 'Dominant habitat zone', items: [
    { label: 'Moist lowland', colour: C.zMoist }, { label: 'Shore', colour: C.zShore }, { label: 'Dry, exposed', colour: C.zDry }, { label: 'Sheltered, shaded', colour: C.zShaded },
    { label: 'High ground', colour: C.zAlpine }, { label: 'Rock, steep', colour: C.zRock }, { label: 'Nothing suited', colour: C.zBare },
  ] },
  'ground-2': { kind: 'ramp', title: 'Soil moisture', min: 0, max: 1, unit: '', low: 'dry', high: 'damp' },
  'geology-0': { kind: 'cat', title: 'Bare rock', items: [
    { label: 'Caprock', colour: C.cap }, { label: 'Sandstone', colour: C.sand }, { label: 'Mudstone bed', colour: C.bed }, { label: 'Scree', colour: C.talus },
    { label: 'Iron-stained cliff', colour: C.stain }, { label: 'Covered by ground', colour: C.covered },
  ] },
  'geology-1': { kind: 'ramp', title: 'Slope (rise / run)', min: 0, max: 3, unit: '', low: 'flat', high: 'cliff', ticks: [0.5, 0.95, 1.6, 2.6] },
  'sun-0': { kind: 'cat', title: 'Sun now', items: [
    { label: 'Full sun', colour: C.full }, { label: 'Glancing', colour: C.glance }, { label: 'Turned away', colour: C.away }, { label: 'Cast shadow', colour: C.cast }, { label: 'Sun down', colour: C.night },
  ] },
  'ecolight-0': { kind: 'ramp', title: "Day's sunlight", min: 0, max: 100, unit: '%', low: 'little', high: 'most', extras: [
    { label: 'Structure shade (hatched)', colour: C.structShade }, { label: 'Moss edge', colour: C.mossEdge },
  ] },
  'ecolight-1': { kind: 'cat', title: 'What structures do to the ground', fixed: true, items: [
    { label: 'Footprint: the structure stands here', colour: C.footprint }, { label: 'Shelter: roofed or overhung', colour: C.sheltered }, { label: 'Shade: its shade over the day', colour: C.shaded },
  ] },
  'water-0': { kind: 'cat', title: 'Water', items: [
    { label: 'River (chevrons downstream)', colour: C.river }, { label: 'Steep reach, fall', colour: C.fall }, { label: 'Lake, calm mouth', colour: C.lake }, { label: 'Land', colour: C.land },
  ] },
})
export const DIAG_LEGENDS = legendsIn(DIAG_COLOUR)
/** The same legends in the lenses' colours (Explore), named as Explore names its lenses; Sun exposure is the day's sunlight alone. */
export const LENS_LEGENDS = legendsIn(LENS_COLOUR)
LENS_LEGENDS['ground-1'] = { ...(LENS_LEGENDS['ground-1'] as Extract<Legend, { kind: 'cat' }>), title: 'Plant habitat zone' }
LENS_LEGENDS['water-0'] = { kind: 'cat', title: 'Water', items: [{ label: 'River: marks move downstream', colour: LENS_COLOUR.river }, { label: 'Steep reach, fall', colour: LENS_COLOUR.fall }, { label: 'Lake, calm mouth', colour: LENS_COLOUR.lake }, { label: 'Land', colour: LENS_COLOUR.land }] }
LENS_LEGENDS['ecolight-0'] = { kind: 'ramp', title: 'Lasting shade: share of the day’s sun', min: 30, max: 100, unit: '%', low: 'terrain shade', high: 'sun all day', extras: [
  { label: 'Shade a structure keeps all day', colour: LENS_COLOUR.structShade }, { label: 'Moss edge: shade plants begin', colour: LENS_COLOUR.mossEdge },
] }

const VIEW_INDEX: Record<DiagView, number> = { final: 0, ground: 1, geology: 2, sun: 3, ecolight: 4, water: 5 }

export const diagUniforms = {
  uDiag: { value: 0 },
  uDiagSub: { value: 0 },
  /** The legend category to keep (others dimmed), or -1. */
  uDiagFocus: { value: -1 },
  /** The range of values (0..1) to keep (others dimmed); x < 0: none. */
  uDiagBand: { value: new Vector2(-1, -1) },
  /** How far the rest steps back: a light preview while a legend entry is hovered, more for one pinned. */
  uDiagFocusK: { value: 0.8 },
  /** 1 while dataProbe.tsx reads the pixel under the pointer: surfaces write their kind, category and value instead of a colour. */
  uDiagProbe: { value: 0 },
  /**
   * How a view is drawn. 0, the TECHNICAL drawing (the 0.3 page, the Project page's World Anatomy): flat, unlit colours that replace the island's
   * look, exact for reading data. 1, the LENS (the /preview site's Explore): the island as it is lit and made, TINTED by the same colours, with fine
   * height contours on the ground, so a lens reads as a way of looking at the island rather than a second picture of it. Same data, same rules,
   * same categories and highlight; the probe reads the same values either way. (A plain uniform, not a specialised switch: no recompile.)
   */
  uDiagSoft: { value: 0 },
}

/** Explore's lenses (soft) or the technical drawing (flat): see uDiagSoft. */
export function setDiagSoft(soft: boolean) {
  diagUniforms.uDiagSoft.value = soft ? 1 : 0
}

export function setDiagnostics(view: DiagView, sub: DiagSub) {
  diagUniforms.uDiag.value = VIEW_INDEX[view]
  diagUniforms.uDiagSub.value = sub
}

/** What the island keeps lit: one category, or a range of values (0..1), or everything; `strength`, how far the rest steps back (0 to 1). */
export function setDiagFocus(focus: { cat: number } | { band: [number, number] } | null, strength = 0.8) {
  diagUniforms.uDiagFocusK.value = strength
  diagUniforms.uDiagFocus.value = focus && 'cat' in focus ? focus.cat : -1
  if (focus && 'band' in focus) diagUniforms.uDiagBand.value.set(focus.band[0], focus.band[1])
  else diagUniforms.uDiagBand.value.set(-1, -1)
}

/** The probe's surface kinds (the high bits of its red channel). */
export const PROBE_KIND = { none: 0, terrain: 1, water: 2, architecture: 3, plant: 4, shell: 5 } as const

const v3 = (hex: string) => {
  const c = new Color(hex)
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`
}

export const DIAG_HEAD = /* glsl */ `
uniform float uDiag;
uniform float uDiagSub;
uniform float uDiagFocus;
uniform vec2 uDiagBand;
uniform float uDiagProbe;
uniform float uDiagSoft;
uniform float uDiagFocusK;
${Object.entries(DIAG_COLOUR).map(([k, hex]) => `const vec3 DG_${k.replace(/[A-Z]/g, (m) => '_' + m).toUpperCase()} = ${v3(hex)};`).join('\n')}
${Object.entries(LENS_COLOUR).map(([k, hex]) => `const vec3 LN_${k.replace(/[A-Z]/g, (m) => '_' + m).toUpperCase()} = ${v3(hex)};`).join('\n')}
vec3 dgRamp(float v) { return mix(mix(DG_RAMP_LOW, DG_RAMP_MID, smoothstep(0.0, 0.5, v)), DG_RAMP_HIGH, smoothstep(0.5, 1.0, v)); }
vec3 lnRamp3(vec3 a, vec3 b, vec3 c, float v) { return mix(mix(a, b, smoothstep(0.0, 0.5, v)), c, smoothstep(0.5, 1.0, v)); }
// The lenses' ramps, by view (uDiag is a specialised constant: only one survives): moisture, slope, the day's light.
vec3 lnRamp(float v) {
  if (uDiag < 1.5) return lnRamp3(${LENS_RAMPS['ground-2']!.map(v3).join(', ')}, v);
  if (uDiag < 2.5) return lnRamp3(${LENS_RAMPS['geology-1']!.map(v3).join(', ')}, v);
  return lnRamp3(${LENS_RAMPS['ecolight-0']!.map(v3).join(', ')}, v);
}
`

type Kind = 'terrain' | 'architecture' | 'plant' | 'creature' | 'water' | 'shell'

/** The sun-and-shadow classification (view 3), for any surface: reads dgFull, dgCast, dgSunK, dgSunNdl, dgAa, dgCloudK from stageHour('dg'). */
const SUN = /* glsl */ `
        float dgFacing = smoothstep(0.05 - dgAa, 0.05 + dgAa, dgSunNdl);
        float dgCastV = dgCast * dgFacing;
        dgCol = mix(DG_GLANCE, DG_FULL, dgFull);
        dgCol = mix(DG_AWAY, dgCol, dgFacing);
        dgCol = mix(dgCol, DG_CAST, dgCastV);
        // Cloud: the sun's planes and shadows soften together (toward grey as the cloud thickens).
        dgCol = mix(dgCol, vec3(dot(dgCol, INK_LUMA)), dgCloudK * 0.6);
        dgCol = mix(DG_NIGHT, dgCol, dgSunK);
        dgCat = dgSunK < 0.5 ? 4.0 : dgCastV > 0.5 ? 3.0 : dgFacing < 0.5 ? 2.0 : dgFull > 0.5 ? 0.0 : 1.0;
        dgVal = clamp(dgSunNdl * 0.5 + 0.5, 0.0, 1.0);`

const KIND_ID: Record<Kind, number> = { terrain: 1, water: 2, architecture: 3, plant: 4, shell: 5, creature: 0 }

export function diagChunk(kind: Kind, hasDepth: boolean): string {
  if (kind === 'creature') return ''
  const open = `
    if (uDiag > 0.5) {
      ${light('dg')}
      ${stageHour('dg')}
      // A fixed hill shade (not the sun's: these views do not change with the hour), only so the land's form reads under the flat colours.
      float dgShade = 0.7 + 0.3 * clamp(dot(dgWn, normalize(vec3(-0.4, 0.82, -0.3))), 0.0, 1.0);
      vec3 dgCol = DG_NEUTRAL;
      float dgCat = -1.0;
      float dgVal = 0.0;`
  const close = `
      // HIGHLIGHT: the legend entry (or the range of values) being looked at stays; the rest steps back to a dim, near-neutral version of itself.
      float dgOff = 0.0;
      // (Only a surface that carries the view's data steps back: context (a structure, plants, water the view is not about: no category) keeps
      // its colour whatever is highlighted, so hovering or pinning never changes how the architecture or the water look.)
      if (uDiagFocus > -0.5 && dgCat > -0.5 && abs(dgCat - uDiagFocus) > 0.5) dgOff = 1.0;
      if (uDiagBand.x > -0.5 && dgCat > -0.5 && (dgVal < uDiagBand.x || dgVal > uDiagBand.y)) dgOff = 1.0;
      // How far is the focus's strength (uDiagFocusK): a light preview while a legend entry is hovered, more for one pinned. In a lens what is set
      // aside turns to a quiet grey of its own lightness, so the island keeps its form and nothing flashes to black.
      vec3 dgAside = uDiagSoft > 0.5 ? mix(vec3(dot(dgCol, INK_LUMA)), LN_NEUTRAL, 0.55) * 0.62 : mix(DG_DIM, vec3(dot(dgCol, INK_LUMA)), 0.22);
      dgCol = mix(dgCol, dgAside, dgOff * uDiagFocusK);
      if (uDiagProbe > 0.5) {
        // PROBE: kind and category in red, the value in 16 bits over green and blue (exact bytes: the probe target is not colour-converted).
        float dgV = floor(clamp(dgVal, 0.0, 1.0) * 65535.0 + 0.5);
        outgoingLight = vec3((${KIND_ID[kind]}.0 * 32.0 + clamp(dgCat + 1.0, 0.0, 31.0)) / 255.0, floor(dgV / 256.0) / 255.0, mod(dgV, 256.0) / 255.0);
      } else if (uDiagSoft > 0.5) {
        // THE LENS: the lens's colours in place of the island's materials (no texture, no material colour), over a stronger fixed hill shade than
        // the technical drawing's, so the island's form and depth read while the data decides its appearance.
        // (A narrow range, 0.84 to 1.04: enough for the form to read, little enough that a colour on the island is the colour in its legend.)
        float lnShade = 0.84 + 0.2 * clamp(dot(dgWn, normalize(vec3(-0.4, 0.82, -0.3))), 0.0, 1.0);
        outgoingLight = dgCol * lnShade;
      } else outgoingLight = dgCol * dgShade;
    }`
  // Each view's colouring is written once, in the technical palette; the lens draws the same code in its own palette and ramps (LENS_COLOUR).
  const lens = (mid: string) => mid.replace(/DG_/g, 'LN_').replace(/dgRamp\(/g, 'lnRamp(')
  const both = (pre: string, mid: string, extra = '') => `${open}${pre}
      if (uDiagSoft > 0.5) {${lens(mid)}
      } else {${mid}
      }${extra}${close}`
  if (kind !== 'terrain') {
    // Everything but the ground: one neutral per kind (so the ground's data stands alone), and its own light and shadow in the sun view.
    const base = kind === 'water' ? 'DG_WATER' : kind === 'shell' ? 'DG_DIM * 1.5' : kind === 'architecture' ? 'DG_NEUTRAL' : 'DG_NEUTRAL * 0.72'
    // WATER FLOW (view 5): the water bright and everything else muted. A river's ribbon carries chevrons pointing downstream, laid along its own
    // course coordinate (its distance from the head, rivers.ts: the nodes run from source to mouth), so the arrows are the hydrology's flow, not a
    // drawing; steep reaches and falls go pale; a lake (and a river's calm mouth) is still water, plain. (Unchanged in Round 08C but for the palette.)
    const water = kind !== 'water'
      ? `dgCol = DG_LAND * 1.18; dgCat = 3.0;`
      : hasDepth
        ? `if (uRiver > 0.5) {
          float dgS = vWaterAlong / 14.0 + 0.45 * abs(vWaterAcross) - uTime * 0.08;
          float dgFw = max(fwidth(dgS), 1e-4);
          float dgArrow = atLine(fract(dgS) - 0.5, dgFw, 1.6) * (1.0 - smoothstep(0.12, 0.3, dgFw)) * step(abs(vWaterAcross), 0.85);
          float dgSteep = smoothstep(0.05, 0.5, vWaterFall);
          float dgCalm = smoothstep(0.3, 0.9, vWaterCalm);
          dgCol = mix(DG_RIVER, DG_FALL, dgSteep);
          dgCol = mix(dgCol, DG_LAKE, dgCalm);
          // (The chevrons are the technical drawing's; Explore's Water flow shows the flow as particles along the rivers instead: FlowParticles.)
          dgCol = mix(dgCol, DG_ARROW, dgArrow * (1.0 - dgCalm) * step(uDiagSoft, 0.5));
          dgCat = dgCalm > 0.5 ? 2.0 : dgSteep > 0.5 ? 1.0 : 0.0;
          dgVal = clamp(vWaterFall, 0.0, 1.0);
        } else {
          dgCol = DG_LAKE;
          // (Explore's lens: a lake's surface moves, slowly: two faint crossing swells drifting across it, much calmer than any river.)
          if (uDiagSoft > 0.5) {
            vec2 dgW = vStyWorld.xz;
            float dgR = sin(dot(dgW, vec2(0.031, 0.022)) - uTime * 0.35) * sin(dot(dgW, vec2(-0.018, 0.034)) - uTime * 0.27);
            dgCol = mix(dgCol, dgCol * 1.35 + 0.03, smoothstep(0.8, 0.98, dgR) * 0.4);
          }
          dgCat = 2.0;
          dgVal = clamp(vWaterDepth / 20.0, 0.0, 1.0);
        }`
        : `dgCol = DG_FALL; dgCat = 1.0; dgVal = 1.0;`
    return both('', `
      dgCol = ${base};
      if (uDiag > 2.5 && uDiag < 3.5) {${SUN}
      }
      if (uDiag > 4.5) {
        ${water}
      }`)
  }
  return both(`
      vec3 dgP = vMistPos;`, `
      if (uDiag < 1.5) {
        if (uDiagSub < 0.5) {
          // GROUND COVER, the raw weights (no averaging, no thresholds): each material's colour by its share; what the four leave is bare rock.
          vec4 dgR = vec4(0.0);
          if (uVegGroundOn > 0.5 && vegUv.x > 0.0 && vegUv.y > 0.0 && vegUv.x < 1.0 && vegUv.y < 1.0) dgR = texture2D(uVegGround, vegUv);
          float dgSum = min(1.0, dgR.r + dgR.g + dgR.b + dgR.a);
          dgCol = DG_FLOOR * dgR.r + DG_MOSS * dgR.g + DG_MEADOW * dgR.b + DG_SHORE * dgR.a;
          dgCol = dgCol / max(dgR.r + dgR.g + dgR.b + dgR.a, 1e-3) * dgSum + DG_ROCK * (1.0 - dgSum);
          dgCat = 0.0;
          dgVal = dgR.r;
          if (dgR.g > dgVal) { dgCat = 1.0; dgVal = dgR.g; }
          if (dgR.b > dgVal) { dgCat = 2.0; dgVal = dgR.b; }
          if (dgR.a > dgVal) { dgCat = 3.0; dgVal = dgR.a; }
          if (1.0 - dgSum > dgVal) { dgCat = 4.0; dgVal = 1.0 - dgSum; }
        } else {
          // The island's own data, per 16 m cell (nearest: an index must not be blended between cells): R the moisture or the day's light, G the
          // dominant habitat zone (index x 32), B its strength, A whether there is land to show.
          ivec2 dgSz = textureSize(uVegOverlay, 0);
          vec4 dgO = texelFetch(uVegOverlay, clamp(ivec2(vegUv * vec2(dgSz)), ivec2(0), dgSz - 1), 0);
          if (dgO.a * uVegOverlayOn < 0.01) {
            dgCol = DG_DIM * 1.8;
          } else if (uDiagSub < 1.5) {
            dgCat = floor(dgO.g * 255.0 / 32.0 + 0.5);
            dgVal = dgO.b;
            dgCol = dgCat < 0.5 ? DG_Z_MOIST : dgCat < 1.5 ? DG_Z_SHORE : dgCat < 2.5 ? DG_Z_DRY : dgCat < 3.5 ? DG_Z_SHADED : dgCat < 4.5 ? DG_Z_ALPINE : dgCat < 5.5 ? DG_Z_ROCK : DG_Z_BARE;
            // A weak membership reads paler: a zone only just ahead of the next.
            dgCol = mix(DG_NEUTRAL, dgCol, 0.45 + 0.55 * smoothstep(0.2, 0.7, dgVal));
          } else {
            dgCat = 0.0;
            dgVal = dgO.r;
            dgCol = dgRamp(dgVal);
          }
        }
      } else if (uDiag < 2.5) {
        ${stageGround('dg')}
        ${stageGeology('dg')}
        if (uDiagSub < 0.5) {
          // GEOLOGY, exactly as the final render decides it: the formation, then scree, staining and the mudstone beds over it.
          float dgCapK = smoothstep(1.5, 2.0, dgForm);
          dgCol = mix(DG_SAND * mix(0.82, 1.0, clamp(dgForm, 0.0, 1.0)), DG_CAP, dgCapK);
          dgCol = mix(dgCol, DG_TALUS, dgTalus);
          dgCol = mix(dgCol, DG_STAIN, dgStain);
          dgCol = mix(dgCol, DG_BED, dgBed);
          dgCol = mix(dgCol, DG_COVERED, 1.0 - dgRock);
          dgCat = 1.0 - dgRock > 0.5 ? 5.0 : dgBed > 0.5 ? 2.0 : dgStain > 0.5 ? 4.0 : dgTalus > 0.5 ? 3.0 : dgCapK > 0.5 ? 0.0 : 1.0;
          // The value: the height in the stack the rules read (metres / 500).
          dgVal = clamp(dgY / 500.0, 0.0, 1.0);
        } else {
          // SLOPE: the slope the rules read (rise over run, from the geology map), on the ramp; the rules' thresholds as fine lines.
          dgCat = 0.0;
          dgVal = clamp(dgSl / 3.0, 0.0, 1.0);
          dgCol = dgRamp(dgVal);
          float dgFw = max(fwidth(dgSl), 1e-4);
          float dgTick = max(max(atLine(dgSl - 0.5, dgFw, 1.0), atLine(dgSl - 0.95, dgFw, 1.0)), max(atLine(dgSl - 1.6, dgFw, 1.0), atLine(dgSl - 2.6, dgFw, 1.0)));
          dgCol = mix(dgCol, DG_DIM, dgTick * 0.6);
        }
      } else if (uDiag < 3.5) {
        ${stageGround('dg')}
        ${stageGeology('dg')}${terrainSun('dg')}${SUN}
      } else if (uDiag > 4.5) {
        // WATER FLOW: the land muted (its own hill shade only), so the water stands alone.
        dgCol = DG_LAND;
        dgCat = 3.0;
      } else {
        if (uDiagSub < 0.5) {
          // ECOLOGICAL LIGHT: the day's sunlight each place receives (the island's light field, written as data in the overlay's red).
          ivec2 dgSz = textureSize(uVegOverlay, 0);
          vec4 dgO = texture2D(uVegOverlay, vegUv);
          dgCat = 0.0;
          // (Explore's Lasting shade spreads its ramp over the island's own range, 30 to 100% of the day's sun: below a third nowhere on it.)
          dgVal = uDiagSoft > 0.5 ? clamp((dgO.r - 0.3) / 0.7, 0.0, 1.0) : clamp(dgO.r, 0.0, 1.0);
          dgCol = mix(DG_DIM * 1.8, dgRamp(dgVal), step(0.01, dgO.a * uVegOverlayOn));
          {
            // The structures' lasting shade over the day (4 m): hatched in the technical drawing, a soft lavender wash in Explore's Lasting shade,
            // so the shade the architecture makes reads apart from the shade the terrain makes (the dark end of the ramp).
            vec2 dgAu = (dgP.xz + 2048.0) / 4096.0;
            float dgSh = max(texture2D(uArchShade, dgAu).r, texture2D(uArchShade, dgAu).g);
            float dgHatch = step(0.5, fract((dgP.x + dgP.z) / 5.0));
            dgCol = mix(dgCol, uDiagSoft > 0.5 ? LN_STRUCT_SHADE : DG_STRUCT_SHADE, smoothstep(0.05, 0.6, dgSh) * (uDiagSoft > 0.5 ? 0.85 : mix(0.3, 0.85, dgHatch)));
            if (dgSh > 0.05) dgCat = 1.0;
            // The edge of the moss: the ground the ecology marks as shaded and damp.
            vec4 dgR = texture2D(uVegGround, vegUv);
            dgCol = mix(dgCol, uDiagSoft > 0.5 ? LN_MOSS_EDGE : DG_MOSS_EDGE, atLine(dgR.g - 0.4, max(fwidth(dgR.g), 1e-4), uDiagSoft > 0.5 ? 1.8 : 1.2) * 0.9);
          }
        } else {
          // Structures: the land in a plain grey, so the architecture's own map (drawn above the ground near the camera) stands alone.
          dgCol = DG_NEUTRAL * 0.8;
        }
      }
`, `
      if (uDiagSoft > 0.5 && (uDiag > 4.5 || (uDiag > 1.5 && uDiag < 2.5))) {
        // Contours every 20 m, only where the land's form is part of the reading (water flow, rock and slope), a little darker than what they cross.
        float lnCy = dgP.y / 20.0;
        dgCol = mix(dgCol, dgCol * 0.72, atLine(fract(lnCy + 0.5) - 0.5, max(fwidth(lnCy), 1e-4), 1.0) * 0.5);
      }`)
}

// Development only: this module holds state that compiled shaders depend on (uniforms, specialised switches). A hot update would load a second copy
// of it while existing materials keep the first, and the scene falls back to the unstyled look (cobalt water, plain underside, grey ground) until a
// reload. A full reload instead (Round 08D; Vite's hot.decline() is a no-op, so the update is accepted here and answered with a reload).
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload())
