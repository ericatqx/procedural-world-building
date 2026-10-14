import {
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three'
import { createTerrainMaterial, createWaterMaterial, PROJECT_COLORS, type WaterMaterial } from '../project/materials.ts'
import type { BaseWorld } from '../project/world.ts'
import { NOISE_GLSL, SUN_EXPOSURE_GLSL } from '../shared/shaders/glsl.ts'
import { createSurfaceMaterial, type SurfaceMaterial } from '../shared/shaders/surfaceMaterial.ts'
import { ARCH_LIMITS } from './architecture.ts'
import { LATTICE_BASE, LATTICE_X0, LATTICE_Z0, WORLD_SCALE } from './core.ts'
import { GRID_EXTENT } from './grid.ts'
import { SENSE, type SenseKey } from './perception.ts'
import { WIND_RANGE } from './wind.ts'

/**
 * Shadow Ecology 0.2 — simulation state made visible through shaders, in
 * 0.1's material language (neutral rock and architecture, cobalt water,
 * olive vegetation, lichen habitat):
 *
 *   terrain       0.1's ground, plus rain wetness and puddles, drought
 *                 dust and crackle, rubble grit, the pale ghost of
 *                 abandoned paths, litter where plants died, and the
 *                 active way of seeing as quiet tints and contours
 *   water         cobalt to ultramarine: calm shimmering lakes, rivers
 *                 drifting downstream, falls pouring; rings where rain
 *                 falls, stronger rings where rubble lands or a creature wades
 *   architecture  medium warm gray, a little darker with age, stress and
 *                 near failure; dark warm gray rubble;
 *                 exposure, stress cracking, rain darkening; per way of seeing
 *   vegetation    Week 07's growth front revealed per plant, leaning to its
 *                 light or flattened in shelter; health dries it. Exposure
 *                 warm muted sage, shelter cool dark gray-green
 */

const color = (hex: string) => ({ value: new Color(hex) })
const f = (value: number) => (Number.isInteger(value) ? `${value}.0` : `${value}`)

/** Architecture's lifecycle, restrained like 0.1's: medium warm gray new, dark warm gray mature, a little darker under stress. */
/** Lifecycle: pale warm stone when new and carried, grayer with age, darker under stress, charcoal near failure. */
const ARCH_LIFE = { fresh: '#b2a792', mature: '#9a968e', stressed: '#6c675f', charcoal: '#3e3b37' } as const
/** World hours a new block takes to extrude into place: about 1.5 s at 1×, never slowing the simulation. */
const GROW_HOURS = 0.6
/** Fallen architecture: dark warm gray rubble. */
/** Darker than any standing block. */
export const ARCH_RUBBLE = '#33302c'

/**
 * 0.2's ground: light warm stone near 0.1's. Low, valley and high stay close,
 * since the taller relief spans the whole height blend and would otherwise patch.
 */
const TERRAIN_02 = {
  uTerrainLow: '#a39d93',
  uTerrainValley: '#b7b0a5',
  uTerrainHigh: '#d3cbbd',
  uTerrainSlope: '#aaa69f',
  uTerrainRock: '#9a958d',
  uTerrainDust: '#ddd5c6',
  uTerrainStrata: '#8f8a83',
  uTerrainDeep: '#3a3733',
  /** Ground under plant cover: a little darker stone, not a green stain. */
  uVegetationGround: '#8f8a80',
} as const
const SENSE_INDEX: Record<SenseKey, number> = { world: 0, architecture: 1, habitat: 2, ground: 2, wading: 2, flying: 3 }
/** Ripples the water can hold at once (rubble, wakes, heavy drops). */
export const IMPACT_SLOTS = 12

/** Uniforms for reading the wind field (wind.ts) in a shader. */
const windUniforms = (): Record<string, IUniform> => ({
  uWindTex: { value: null },
  uWindSpeed: { value: 0 },
  uWindTime: { value: 0 },
  uWindDir: { value: new Vector2(1, 0) },
})
const WIND_GLSL = /* glsl */ `
uniform sampler2D uWindTex;
uniform float uWindSpeed;
uniform float uWindTime;
uniform vec2 uWindDir;
vec2 windAtWorld(vec2 p) {
  vec2 e = texture2D(uWindTex, (p + ${f(GRID_EXTENT)}) / ${f(2 * GRID_EXTENT)}).rg;
  return (e * 2.0 - 1.0) * ${f(WIND_RANGE)} * uWindSpeed;
}`

/** Points a material's wind uniforms at the current field, speed, prevailing heading (radians) and (pausable) time. */
export function setWindUniforms(uniforms: Record<string, IUniform>, texture: Texture, speed: number, heading: number, time: number) {
  uniforms.uWindTex!.value = texture
  uniforms.uWindSpeed!.value = speed
  uniforms.uWindTime!.value = time
  ;(uniforms.uWindDir!.value as Vector2).set(Math.cos(heading), Math.sin(heading))
}

type Wrapped = { key: string; uniforms: Record<string, IUniform>; edit: (source: string) => string }

/** Layers extra GLSL onto a material that already has an onBeforeCompile. */
function wrap(material: Material, { key, uniforms, edit }: Wrapped) {
  const inner = material.onBeforeCompile.bind(material)
  material.onBeforeCompile = (program: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => {
    inner(program, renderer)
    Object.assign(program.uniforms, uniforms)
    program.fragmentShader = edit(program.fragmentShader)
  }
  material.customProgramCacheKey = () => key
}

export type EcoTerrain = SurfaceMaterial

export function createEcoTerrain(base: BaseWorld, state: Texture, perception: Texture): EcoTerrain {
  const surface = createTerrainMaterial(base.field, base.habitatField, base.fieldExtent * WORLD_SCALE)
  for (const [name, hex] of Object.entries(TERRAIN_02)) (surface.uniforms[name]?.value as Color | undefined)?.set(hex)
  const extra: Record<string, IUniform> = {
    uEcoState: { value: state },
    uEcoSense: { value: perception },
    uSenseMix: { value: 0 },
    uSense0: color('#000000'),
    uSense1: color('#000000'),
    uSense2: color('#000000'),
    uSenseFill: { value: new Vector4() },
    uSenseLine: { value: new Vector4() },
    uRain: { value: 0 },
    uDrought: { value: 0 },
    uDaylight: { value: 1 },
    uPuddle: color('#1d2330'),
    uDust: color(TERRAIN_02.uTerrainDust),
    uRubble: color(ARCH_RUBBLE),
    uLitter: color('#7a6f58'),
    uTrail: { value: new Vector3(...TRAIL.normal) },
    uTrailTint: color('#6f5c48'),
  }
  Object.assign(surface.uniforms, extra)
  wrap(surface.material, {
    key: 'eco02-terrain',
    uniforms: extra,
    edit: (source) =>
      source
        .replace(
          'void main() {',
          /* glsl */ `uniform sampler2D uEcoState;
uniform sampler2D uEcoSense;
uniform float uSenseMix;
uniform vec3 uSense0;
uniform vec3 uSense1;
uniform vec3 uSense2;
uniform vec4 uSenseFill;
uniform vec4 uSenseLine;
uniform float uRain;
uniform float uDrought;
uniform float uDaylight;
uniform vec3 uPuddle;
uniform vec3 uDust;
uniform vec3 uRubble;
uniform vec3 uLitter;
uniform vec3 uTrail;
uniform vec3 uTrailTint;
float ecoCrackle(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  float nearest = 8.0;
  float second = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 c = o + vec2(hash31(vec3(cell + o, 1.7)), hash31(vec3(cell + o, 4.1)));
      float d = length(c - local);
      if (d < nearest) { second = nearest; nearest = d; } else if (d < second) { second = d; }
    }
  }
  return 1.0 - smoothstep(0.0, 0.06, second - nearest);
}
void main() {`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `vec4 ecoState = texture2D(uEcoState, fieldUv);
float ecoOpen = fieldUp * (1.0 - terrainWall);
// Material memory: wet ground darkens and dries in patches (higher ground first); where it is
// often wet a faint cool stain stays for days after.
float ecoWet = clamp(ecoState.r * 1.2 - (1.0 - mottling) * 0.3 * (1.0 - ecoState.r), 0.0, 1.0) * (1.0 - terrainWall * 0.6);
float ecoStain = texture2D(uHabitatField, fieldUv).b * (0.55 + 0.45 * smoothstep(0.3, 0.7, mottling)) * (1.0 - terrainWall * 0.5);
float ecoFlat = smoothstep(0.93, 0.99, terrainNormal.y);
float ecoPuddle = smoothstep(0.55, 0.85, ecoState.r + (mottling - 0.5) * 0.7) * ecoFlat * (1.0 - terrainWall);
// Under low light the same memory reads as black blotches, so its contrast eases at night.
float ecoMemory = mix(0.45, 1.0, smoothstep(0.0, 0.45, uDaylight));
diffuseColor.rgb *= 1.0 - 0.34 * ecoWet * ecoMemory;
diffuseColor.rgb *= mix(vec3(1.0), vec3(0.86, 0.87, 0.9), ecoStain * (1.0 - ecoWet) * ecoMemory);
diffuseColor.rgb = mix(diffuseColor.rgb, uPuddle, ecoPuddle * 0.6 * ecoMemory);
float ecoDry = uDrought * (1.0 - smoothstep(0.15, 0.55, worldField.r)) * ecoOpen;
float ecoCrack = ecoDry > 0.0 ? ecoCrackle(vStudyWorldPos.xz * 24.0) * smoothstep(0.3, 0.7, valueNoise(vStudyWorldPos * 6.0)) : 0.0;
diffuseColor.rgb = mix(diffuseColor.rgb, uDust, ecoDry * 0.4);
diffuseColor.rgb *= 1.0 - ecoDry * ecoCrack * 0.4;
float ecoGrit = hash31(floor(vStudyWorldPos * 90.0));
float ecoRubble = smoothstep(0.15, 0.65, ecoState.g + (ecoGrit - 0.5) * 0.45) * fieldUp;
diffuseColor.rgb = mix(diffuseColor.rgb, uRubble * mix(0.6, 1.15, ecoGrit), ecoRubble * 0.75);
float ecoGhost = ecoState.b * ecoOpen * (0.7 + 0.3 * valueNoise(vStudyWorldPos * 40.0));
diffuseColor.rgb = mix(diffuseColor.rgb, min(vec3(1.0), diffuseColor.rgb * 1.18 + 0.04), ecoGhost * 0.55);
float ecoLitter = ecoState.a * ecoOpen * step(0.45, valueNoise(vStudyWorldPos * 60.0));
diffuseColor.rgb = mix(diffuseColor.rgb, uLitter, ecoLitter * 0.45);
// Worn trace: compacted earth where trips repeat, a little darker and warmer, edges broken by grit.
float ecoTrailUse = texture2D(uHabitatField, fieldUv).a + (valueNoise(vStudyWorldPos * 34.0) - 0.5) * 0.18;
float ecoWorn = smoothstep(uTrail.x, uTrail.y, ecoTrailUse) * uTrail.z * (1.0 - terrainWall) * (1.0 - ecoPuddle);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uTrailTint, ecoWorn * 0.8);
#include <roughnessmap_fragment>`,
        )
        .replace(
          '#include <lights_physical_fragment>',
          `roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.85, ecoWorn);
roughnessFactor = mix(roughnessFactor, 0.4, ecoWet * 0.8 * ecoMemory);
roughnessFactor = mix(roughnessFactor, 0.06, ecoPuddle * ecoMemory);
#include <lights_physical_fragment>`,
        )
        .replace(
          '#include <opaque_fragment>',
          /* glsl */ `vec4 ecoSense = texture2D(uEcoSense, fieldUv);
float senseOn = uSenseMix * (1.0 - terrainWall * 0.6);
float senseLuma = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
outgoingLight = mix(outgoingLight, mix(outgoingLight, vec3(senseLuma), 0.55) * 0.72, senseOn);
outgoingLight = mix(outgoingLight, uSense0 * (0.35 + 0.65 * senseLuma * 3.0), clamp(ecoSense.r * uSenseFill.x, 0.0, 1.0) * senseOn);
outgoingLight = mix(outgoingLight, uSense1 * (0.35 + 0.65 * senseLuma * 3.0), clamp(ecoSense.g * uSenseFill.y, 0.0, 1.0) * senseOn);
outgoingLight = mix(outgoingLight, uSense2 * (0.35 + 0.65 * senseLuma * 3.0), clamp(ecoSense.b * uSenseFill.z, 0.0, 1.0) * senseOn);
outgoingLight *= 1.0 - 0.5 * ecoSense.a * senseOn;
float senseEdge0 = isoLine(ecoSense.r, 0.45, 1.1) * uSenseLine.x;
float senseEdge1 = isoLine(ecoSense.g, 0.4, 1.1) * uSenseLine.y;
outgoingLight = mix(outgoingLight, uSense0, senseEdge0 * 0.75 * senseOn);
outgoingLight = mix(outgoingLight, uSense1, senseEdge1 * 0.6 * senseOn);
#include <opaque_fragment>`,
        ),
  })
  return surface
}

export type TerrainState = {
  sense: SenseKey
  /** Whether the way's ground overlay is shown. */
  overlay: boolean
  rain: number
  drought: number
  contours: boolean
  wireframe: boolean
  /** Worn path traces: hidden, or drawn at one of three amounts. */
  trail: 'off' | TraceAmount
  /** 0 at night, 1 in full day. */
  daylight: number
}

export type TraceAmount = 'low' | 'normal' | 'high'
/** Per amount: the trail level where a trace starts to show, where it is full, and its strength. */
const TRAIL: Record<TraceAmount, [number, number, number]> = {
  low: [0.15, 0.5, 0.75],
  normal: [0.05, 0.3, 1],
  high: [0.02, 0.18, 1.2],
}

export function setEcoTerrain(terrain: EcoTerrain, state: TerrainState) {
  const u = terrain.uniforms
  const trail = u.uTrail!.value as Vector3
  if (state.trail === 'off') trail.setZ(0)
  else trail.set(...TRAIL[state.trail])
  const channels = SENSE[state.sense]
  u.uSenseMix!.value = state.overlay && channels.length ? 1 : 0
  const fill = u.uSenseFill!.value as Vector4
  const line = u.uSenseLine!.value as Vector4
  fill.set(0, 0, 0, 0)
  line.set(0, 0, 0, 0)
  channels.forEach((c, n) => {
    ;(u[`uSense${n}`]!.value as Color).set(c.color)
    fill.setComponent(n, c.fill)
    line.setComponent(n, c.line ? 1 : 0)
  })
  u.uRain!.value = state.rain
  u.uDrought!.value = state.drought
  u.uDaylight!.value = state.daylight
  u.uHabitatVisible!.value = state.sense === 'world' ? 0 : 1
  u.uHabitatEmphasis!.value = 0
  u.uContours!.value = state.contours ? 1 : 0
  terrain.material.wireframe = state.wireframe
}

export type EcoWater = WaterMaterial & { extra: Record<string, IUniform> }

/** 0.2's water: 0.1's bright cobalt, a little deeper with depth, lighter at the shallow edge. */
const WATER_02 = {
  uWaterShallow: '#4466f2',
  uWaterMid: '#3155e4',
  uWaterDeep: '#2242cc',
  uWaterLine: '#a9bbff',
  /** Sky caught at grazing angles. */
  uWaterSky: '#5a7cf2',
  /** Where the water catches the sun: a soft blue glow, not a white blowout. */
  uWaterGlint: '#8ea8ff',
} as const

/** Replaces `from` in `source`, failing loudly if the shader it patches has changed. */
function must(source: string, from: string, to: string) {
  if (!source.includes(from)) throw new Error(`eco02-water: shader patch target not found: ${from.slice(0, 60)}`)
  return source.replace(from, to)
}

/**
 * 0.1's water, restyled: cobalt in the shallows deepening to ultramarine,
 * lighter along shores and banks. Lakes are calm, a slow broad swell giving
 * a gentle shimmer and the sky at grazing angles; rivers carry a faint
 * ripple and streak downstream; falls run in lanes that pour downward.
 * Bright sun on the surface softens into a cool glow. Everything else is
 * caused: each raindrop opens a small set of concentric rings, and rubble,
 * wading creatures and heavy impacts open larger ones (uImpacts: x, z,
 * start time, strength).
 */
export function createEcoWater(): EcoWater {
  const water = createWaterMaterial()
  const uniforms = water.uniforms as unknown as Record<string, IUniform>
  for (const name of ['uWaterShallow', 'uWaterDeep', 'uWaterLine'] as const) (uniforms[name]!.value as Color).set(WATER_02[name])
  const extra: Record<string, IUniform> = {
    uRain: { value: 0 },
    uImpacts: { value: Array.from({ length: IMPACT_SLOTS }, () => new Vector4()) },
    uWaterMid: color(WATER_02.uWaterMid),
    uWaterSky: color(WATER_02.uWaterSky),
    uWaterGlint: color(WATER_02.uWaterGlint),
    ...windUniforms(),
  }
  const edits: [string, string][] = [
    [
      'valueNoise(vec3(vWaterPos.xz * 14.0, uTime * 0.12)) * 0.65',
      'valueNoise(vec3(vWaterPos.xz * 2.4 + vec2(uTime * 0.03, 0.0), uTime * 0.05)) * 0.65',
    ],
    [
      'valueNoise(vec3(vWaterPos.xz * 34.0 + uTime * 0.02, uTime * 0.2)) * 0.35',
      'valueNoise(vec3(vWaterPos.xz * 6.5 - vec2(0.0, uTime * 0.02), uTime * 0.08)) * 0.35',
    ],
    ['float fallStreak = flowRipple(vec2(vFlow * 0.35, vAcross * 2.5), current * 0.35);', 'float fallStreak = ecoFall(vFlow, vAcross, uTime);'],
    [
      'float waterHeight = waterWave * waterAmplitude;',
      'float waterHeight = waterWave * mix(0.004, mix(0.0018 * vSpeed, 0.008, isFall), isRiver);',
    ],
    [
      'vec3 waterColor = mix(uWaterShallow, uWaterDeep, smoothstep(0.0, 0.1800, vDepth));',
      /* glsl */ `vec3 waterColor = mix(mix(uWaterShallow, uWaterMid, smoothstep(0.0, 0.06, vDepth)), uWaterDeep, smoothstep(0.03, 0.32, vDepth));
waterColor = mix(waterColor, mix(uWaterMid, uWaterShallow, smoothstep(0.55, 1.0, abs(vAcross)) * 0.6), isRiver);`,
    ],
    ['waterColor = mix(waterColor, uWaterLine, riverThread * 0.3);', 'waterColor = mix(waterColor, uWaterLine, riverThread * 0.16);'],
    // Lakes a little less glassy, so the sun spreads into a soft sheen rather than a hard white patch.
    ['roughnessFactor = mix(0.1200,', 'roughnessFactor = mix(0.2200,'],
    [
      'float waterContrast = mix(0.1, mix(0.3 * min(1.0, vSpeed), 0.2, isFall), isRiver);',
      'float waterContrast = mix(0.06, mix(0.16 * min(1.0, vSpeed), 0.3, isFall), isRiver);',
    ],
  ]
  wrap(water.material, {
    key: 'eco02-water',
    uniforms: extra,
    edit: (source) =>
      edits
        .reduce((s, [from, to]) => must(s, from, to), source)
        .replace(
          'void main() {',
          /* glsl */ `uniform float uRain;
uniform vec4 uImpacts[${IMPACT_SLOTS}];
uniform vec3 uWaterMid;
uniform vec3 uWaterSky;
uniform vec3 uWaterGlint;
${WIND_GLSL}
float ecoFall(float along, float across, float t) {
  float lanes = valueNoise(vec3(across * 9.0, along * 1.6 - t * 3.2, 1.3));
  float spray = valueNoise(vec3(across * 23.0, along * 3.4 - t * 5.5, 7.9));
  return lanes * 0.65 + spray * 0.35;
}
float ecoRainRings(vec2 p, float t) {
  float h = 0.0;
  for (int layer = 0; layer < 2; layer++) {
    float scale = 22.0 + 13.0 * float(layer);
    vec2 q = p * scale + float(layer) * 17.3;
    vec2 cell = floor(q);
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 c = cell + vec2(float(x), float(y));
        float rnd = hash31(vec3(c, float(layer) + 0.5));
        if (rnd > uRain) continue;
        vec2 centre = c + 0.2 + 0.6 * vec2(hash31(vec3(c, 3.1)), hash31(vec3(c, 5.7)));
        float phase = fract(t * 0.55 + rnd * 7.0);
        float front = phase * 1.2;
        float d = length(q - centre);
        float behind = front - d;
        if (behind < 0.0 || behind > 0.9) continue;
        h += sin(behind * 22.0) * exp(-behind * 3.0) * (1.0 - phase) * (1.0 - phase);
      }
    }
  }
  return h;
}
float ecoImpacts(vec2 p, float t) {
  float h = 0.0;
  for (int k = 0; k < ${IMPACT_SLOTS}; k++) {
    vec4 im = uImpacts[k];
    float age = t - im.z;
    if (im.w <= 0.0 || age < 0.0 || age > 5.0) continue;
    float front = age * (0.12 + 0.12 * im.w);
    float behind = front - length(p - im.xy);
    if (behind < 0.0) continue;
    h += sin(behind * 90.0) * exp(-behind * 14.0) * (1.0 - age / 5.0) * im.w;
  }
  return h;
}
void main() {`,
        )
        .replace(
          'float waterDhdx = dFdx(waterHeight);',
          `float ecoRings = ecoRainRings(vWaterPos.xz, uTime) * smoothstep(0.02, 0.3, uRain) * (1.0 - isFall);
float ecoImpact = ecoImpacts(vWaterPos.xz, uTime) * (1.0 - isFall);
waterHeight += ecoRings * 0.0014 + ecoImpact * 0.0028;
// Wind waves: soft irregular swells, stretched along the crests (across the
// heading) and carried downwind. Noise, not crossing sine gratings, so no
// interference rings; broad gust patches drift over the lake.
float ecoGust = clamp(max(length(windAtWorld(vWaterPos.xz)) / 0.9, uWindSpeed * 0.6), 0.0, 1.0);
vec2 ecoWindSide = vec2(-uWindDir.y, uWindDir.x);
float ecoAlong = dot(vWaterPos.xz, uWindDir);
float ecoAcross = dot(vWaterPos.xz, ecoWindSide);
float ecoDrift = uWindTime * (0.35 + 0.45 * ecoGust);
float ecoSwellA = valueNoise(vec3(ecoAlong * 3.2 - ecoDrift * 2.0, ecoAcross * 0.9, 2.0));
float ecoSwellB = valueNoise(vec3(ecoAlong * 6.5 - ecoDrift * 3.1, ecoAcross * 1.7 + 3.1, 5.0));
float ecoPatch = smoothstep(0.25, 0.75, valueNoise(vec3(ecoAlong * 0.45 - ecoDrift * 0.5, ecoAcross * 0.45, 4.0)));
float ecoWindWave = ((ecoSwellA * 0.65 + ecoSwellB * 0.35) - 0.5) * 2.0 * mix(0.4, 1.0, ecoPatch);
float ecoWindLift = ecoGust * (1.0 - isFall) * mix(1.0, 0.15, isRiver);
waterHeight += ecoWindWave * 0.005 * ecoWindLift;
float waterDhdx = dFdx(waterHeight);`,
        )
        .replace(
          '#include <opaque_fragment>',
          /* glsl */ `float stillWater = 1.0 - isFall;
float grazing = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 4.0);
outgoingLight = mix(outgoingLight, uWaterSky, grazing * 0.35 * stillWater);
vec3 glare = max(outgoingLight - vec3(0.26, 0.34, 0.85), 0.0);
float glint = smoothstep(0.0, 0.6, dot(glare, vec3(0.5)));
outgoingLight -= glare * (1.0 - 1.0 / (1.0 + glare * 9.0)) * stillWater;
outgoingLight = mix(outgoingLight, uWaterGlint, glint * 0.2 * stillWater);
float lakeEdge = (1.0 - isRiver) * (1.0 - smoothstep(0.0, 0.012, vDepth));
float bankEdge = isRiver * (1.0 - isFall) * smoothstep(0.8, 0.98, abs(vAcross));
outgoingLight = mix(outgoingLight, uWaterLine, max(lakeEdge, bankEdge * 0.6) * 0.22);
outgoingLight = mix(outgoingLight, uWaterLine, clamp(max(ecoRings, 0.0) * 0.35 + max(ecoImpact, 0.0) * 0.4, 0.0, 0.55));
outgoingLight = mix(outgoingLight, uWaterSky, smoothstep(0.15, 0.85, ecoWindWave) * ecoWindLift * 0.22);
#include <opaque_fragment>`,
        ),
  })
  return { ...water, extra }
}

export function setEcoWater(water: EcoWater, rain: number, contours: boolean) {
  water.extra.uRain!.value = rain
  water.uniforms.uContours.value = contours ? 1 : 0
}

/** Records a ripple at (x, z) at the water's current time. */
export function addImpact(water: EcoWater, x: number, z: number, strength: number) {
  const impacts = water.extra.uImpacts!.value as Vector4[]
  let oldest = impacts[0]!
  for (const im of impacts) if (im.z < oldest.z) oldest = im
  oldest.set(x, z, water.uniforms.uTime.value, strength)
}

/** Architecture: age, exposure, stress and weather, drawn per way of seeing. */
export function createEcoArchitecture(): SurfaceMaterial {
  return createSurfaceMaterial(
    {
      lights: `${SUN_EXPOSURE_GLSL}`,
      uniforms: () => ({
        uClock: { value: 0 },
        uVoxel: { value: 0.08 },
        uWet: { value: 0 },
        uDoseRate: { value: 0 },
        uWay: { value: 0 },
        uFresh: color(ARCH_LIFE.fresh),
        uMature: color(ARCH_LIFE.mature),
        uStressed: color(ARCH_LIFE.stressed),
        uCharcoal: color(ARCH_LIFE.charcoal),
        uStressInk: color('#ff6a3d'),
        uLightInk: color('#ffd27a'),
      }),
      vertexHead: /* glsl */ `
attribute float aBirth;
attribute float aStress;
attribute float aExposure;
attribute float aSeed;
attribute vec4 aGrow;
uniform float uClock;
varying float vBirth;
varying float vStress;
varying float vExposure;
varying float vSeed;`,
      // A new block extrudes out of the face it grew from over a short span of world time.
      vertex: /* glsl */ `vBirth = aBirth;
vStress = aStress;
vExposure = aExposure;
vSeed = aSeed;
float growAge = clamp((uClock - aBirth) / ${f(GROW_HOURS)}, 0.0, 1.0);
float growT = 1.0 - (1.0 - growAge) * (1.0 - growAge) * (1.0 - growAge);
transformed += aGrow.xyz * (aGrow.w - dot(transformed, aGrow.xyz)) * (1.0 - growT);`,
      fragmentHead: /* glsl */ `
${NOISE_GLSL}
uniform float uClock;
uniform float uVoxel;
uniform float uWet;
uniform float uDoseRate;
uniform float uWay;
uniform vec3 uFresh;
uniform vec3 uMature;
uniform vec3 uStressed;
uniform vec3 uCharcoal;
uniform vec3 uStressInk;
uniform vec3 uLightInk;
varying float vBirth;
varying float vStress;
varying float vExposure;
varying float vSeed;`,
      albedo: /* glsl */ `
float studyTerm = 0.0;
vec3 archN = normalize(vStudyWorldNormal);
float hoursOld = max(uClock - vBirth, 0.0);
float newness = 1.0 - smoothstep(0.0, 4.0, hoursOld);
float age = smoothstep(0.0, ${f(ARCH_LIMITS.decayFull)}, hoursOld);
float wear = smoothstep(${f(ARCH_LIMITS.decayOnset / ARCH_LIMITS.decayFull)}, 1.0, age) * (0.45 + 0.55 * vExposure * 1.6);
float grain = valueNoise(vStudyWorldPos * 85.0);
float mottle = valueNoise(vStudyWorldPos * 7.0) * 0.6 + valueNoise(vStudyWorldPos * 19.0) * 0.4;
float up = max(archN.y, 0.0);
float leached = smoothstep(0.1, 0.5, wear + (mottle - 0.5) * 0.25);
// New growth stays pale while it settles; dark is kept for stress, decay and failure.
float settled = 1.0 - newness * 0.8;
float stressed = smoothstep(0.25, 0.65, vStress + (mottle - 0.5) * 0.08) * settled;
float failing = max(smoothstep(0.65, 0.95, vStress) * settled, smoothstep(0.6, 0.98, wear + (mottle - 0.5) * 0.2));
vec3 c = mix(uFresh, uMature, smoothstep(0.04, 0.6, age + (mottle - 0.5) * 0.12));
c = mix(c, uStressed, stressed);
c = mix(c, uCharcoal, failing * 0.85);
c *= mix(0.94, 1.06, vSeed);
// Material memory: the rain and wind a block has taken since it was laid (world dose rate × age),
// more on exposed faces. Tops bleach toward a pale weathered gray; sides streak where rain runs.
float side = 1.0 - up;
float dose = hoursOld * uDoseRate * (0.45 + 0.55 * clamp(vExposure * 1.6, 0.0, 1.0));
float weathered = smoothstep(3.0, 45.0, dose + (mottle - 0.5) * 5.0);
float rainStreak = smoothstep(0.45, 0.8, valueNoise(vStudyWorldPos * vec3(38.0, 2.5, 38.0) + vSeed * 7.0));
vec3 bleached = vec3(dot(c, vec3(0.333))) * 1.02 + vec3(0.012, 0.01, 0.006);
c = mix(c, bleached, weathered * (0.25 + 0.3 * up) * (1.0 - failing));
c *= 1.0 - weathered * side * rainStreak * 0.16;
float crackField = valueNoise(vStudyWorldPos * vec3(30.0, 9.0, 30.0) + vSeed * 13.0);
float crack = isoLine(crackField, 0.5, 1.3) * smoothstep(0.25, 0.9, vStress) * settled;
c = mix(c, uCharcoal * 0.85, crack * 0.5);
c = max(c, uCharcoal * 0.82);
vec3 joint = fract((vStudyWorldPos - vec3(${f(LATTICE_X0)}, ${f(LATTICE_BASE)}, ${f(LATTICE_Z0)})) / uVoxel);
vec3 jointGap = min(joint, 1.0 - joint) * uVoxel;
vec3 jointNear = (1.0 - smoothstep(vec3(0.0), vec3(0.004 + 0.006 * leached), jointGap)) * (1.0 - abs(archN));
float jointLine = max(max(jointNear.x, jointNear.y), jointNear.z);
c *= 1.0 - jointLine * (0.18 + 0.3 * leached);
c *= 1.0 + (grain - 0.5) * 0.14;
float wetFace = uWet * (0.5 + 0.5 * up) * (0.4 + 0.6 * vExposure * 1.6) * (1.0 + 0.4 * weathered);
c *= 1.0 - 0.2 * clamp(wetFace, 0.0, 1.0);
diffuseColor.rgb = c;`,
      roughness: `roughnessFactor = mix(0.7, 0.95, grain) + 0.1 * leached + 0.08 * weathered + 0.1 * stressed + 0.08 * failing - 0.45 * clamp(wetFace, 0.0, 1.0);`,
      lit: /* glsl */ `
float archLuma = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
outgoingLight = max(outgoingLight, diffuseColor.rgb * mix(0.3, 0.36, leached));
outgoingLight += uFresh * newness * 0.05;
if (uWay > 0.5 && uWay < 1.5) {
  // Pale where carried, red toward failure, gold on sunlit faces that are still sound.
  float archShade = 0.22 + 0.78 * clamp(archLuma * 2.2, 0.0, 1.0);
  vec3 supportInk = mix(vec3(0.84, 0.82, 0.78), uStressInk, smoothstep(0.45, 0.9, vStress));
  outgoingLight = supportInk * archShade;
  outgoingLight = mix(outgoingLight, uLightInk * archShade, habitatExposure * 0.5 * (1.0 - smoothstep(0.35, 0.65, vStress)));
  outgoingLight = mix(outgoingLight, vec3(0.98, 0.96, 0.9), newness * 0.4);
} else if (uWay > 1.5 && uWay < 2.5) {
  outgoingLight = mix(outgoingLight, vec3(archLuma) * 0.55, 0.75);
} else if (uWay > 2.5) {
  outgoingLight = mix(outgoingLight, vec3(archLuma) * 0.5, 0.7);
  outgoingLight = mix(outgoingLight, vec3(0.9, 0.93, 0.98), up * 0.35);
}`,
    },
    { cacheKey: 'eco02-architecture', color: PROJECT_COLORS.archFresh },
  )
}

/**
 * `damp` is the architecture's remembered wetness and `doseRate` the world's
 * mean rain-and-wind exposure per hour (fields.ts), so material change
 * accumulates and fades rather than following the weather.
 */
export function setEcoArchitecture(material: SurfaceMaterial, clock: number, voxel: number, damp: number, doseRate: number, sense: SenseKey) {
  material.uniforms.uClock!.value = clock
  material.uniforms.uVoxel!.value = voxel
  material.uniforms.uWet!.value = damp
  material.uniforms.uDoseRate!.value = doseRate
  material.uniforms.uWay!.value = SENSE_INDEX[sense]
}

/** Plants: Week 07's trace forms, per instance grown, leaned, flattened and dried. */
export function createEcoVegetation(): SurfaceMaterial {
  const surface = createSurfaceMaterial(
    {
      lights: `${SUN_EXPOSURE_GLSL}`,
      uniforms: () => ({
        uExposureStem: color('#6b6350'),
        uExposureLeaf: color('#a3a078'),
        uShelterStem: color('#323b39'),
        uShelterLeaf: color('#56655f'),
        uDry: color('#8d877a'),
        uSnag: color('#77736a'),
        uEmphasis: { value: [1, 1] },
        uWayVeg: { value: 0 },
        ...windUniforms(),
      }),
      vertexHead: /* glsl */ `${WIND_GLSL}
attribute vec3 aCenter;
attribute float aArrival;
attribute float aShelter;
attribute vec4 iPlant;
attribute vec3 iLean;
varying float vVegShelter;
varying vec4 vVegPlant;
varying float vVegRise;`,
      vertex: /* glsl */ `
float vegReveal = clamp((iPlant.x - aArrival) / 0.08, 0.0, 1.0);
transformed = aCenter + (transformed - aCenter) * vegReveal;
float vegRise = max(transformed.y, 0.0);
transformed.y *= mix(1.0, 0.8, iLean.z);
transformed.xz *= mix(1.0, 1.2, iLean.z);
transformed.xz += iLean.xy * vegRise * vegRise * 0.6;
transformed.y *= mix(0.7, 1.0, clamp(iPlant.y * 2.0, 0.0, 1.0));
// Sway in the local wind: the field read at the plant's root, turned into the instance's frame, gusting per plant.
vec3 vegRoot = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
vec2 vegWind = windAtWorld(vegRoot.xz);
float vegScale2 = max(dot(instanceMatrix[0].xyz, instanceMatrix[0].xyz), 1e-6);
vec3 vegWindLocal = transpose(mat3(instanceMatrix)) * vec3(vegWind.x, 0.0, vegWind.y) / vegScale2;
float vegGust = 0.65 + 0.35 * sin(uWindTime * (1.5 + length(vegWind)) + iPlant.z * 6.2832 + vegRoot.x * 0.6 + vegRoot.z * 0.4);
transformed.xz += vegWindLocal.xz * (vegRise * 0.25 + vegRise * vegRise) * 0.22 * vegGust;
vVegShelter = aShelter;
vVegPlant = iPlant;
vVegRise = aArrival;`,
      fragmentHead: /* glsl */ `
uniform vec3 uExposureStem;
uniform vec3 uExposureLeaf;
uniform vec3 uShelterStem;
uniform vec3 uShelterLeaf;
uniform vec3 uDry;
uniform vec3 uSnag;
uniform float uEmphasis[2];
uniform float uWayVeg;
varying float vVegShelter;
varying vec4 vVegPlant;
varying float vVegRise;`,
      albedo: /* glsl */ `
float studyTerm = 0.0;
float vegBud = step(1.5, vVegShelter);
float vegShelterKind = step(0.5, fract(vVegShelter));
vec3 vegStem = mix(uExposureStem, uShelterStem, vegShelterKind);
vec3 vegLeaf = mix(uExposureLeaf, uShelterLeaf, vegShelterKind);
vec3 vegColor = mix(vegStem, vegLeaf, max(vegBud * 0.95, 0.2 + smoothstep(0.1, 1.0, vVegRise) * 0.55));
vegColor *= mix(0.88, 1.12, vVegPlant.z);
vegColor = mix(vegColor, uDry, (1.0 - smoothstep(0.15, 0.6, vVegPlant.y)) * 0.75);
vegColor = mix(vegColor, uSnag, step(vVegPlant.w, 0.0));
diffuseColor.rgb = vegColor;`,
      lit: /* glsl */ `
float vegEmph = mix(uEmphasis[0], uEmphasis[1], vegShelterKind);
float vegLuma = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
outgoingLight = mix(vec3(vegLuma) * 0.45, outgoingLight, vegEmph);
outgoingLight = max(outgoingLight, diffuseColor.rgb * 0.16 * vegEmph);
outgoingLight += diffuseColor.rgb * 0.14 * uWayVeg * vegEmph;`,
    },
    { cacheKey: 'eco02-vegetation', color: PROJECT_COLORS.vegetationBase },
  )
  surface.material.side = DoubleSide
  return surface
}

/** How strongly each way of seeing draws exposure and shelter plants. */
export function setEcoVegetation(material: SurfaceMaterial, sense: SenseKey) {
  const emphasis: Record<SenseKey, [number, number]> = {
    world: [1, 1],
    architecture: [0.4, 0.4],
    habitat: [0.75, 0.75],
    ground: [0.4, 1],
    wading: [0.4, 0.8],
    flying: [1, 0.35],
  }
  material.uniforms.uEmphasis!.value = emphasis[sense]
  material.uniforms.uWayVeg!.value = sense === 'world' ? 1 : 0
}

/** Creatures: pale, faintly self-lit so they read against shaded ground at a distance. */
export const createCreatureMaterial = () =>
  new MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, metalness: 0, emissive: '#3a3833', side: DoubleSide })

export const createMarkerMaterial = () => new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false })
