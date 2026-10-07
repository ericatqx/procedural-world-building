import {
  Color,
  MeshStandardMaterial,
  ShaderMaterial,
  type IUniform,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { PROJECT_COLORS } from '../../project/materials.ts'

/**
 * Week 06 Paths — the Flow channels, in the Project's water colours. Streaks
 * are carried downstream at each point's current (`aSpeed`) along `aFlow`
 * (distance along the channel), in two offset phases that restart in turn so
 * the pattern never shears where the current changes; finer glints ride
 * faster on top. Deep mid-channel, shallow and see-through at the banks, a
 * pale wet line at the edge, foam flecks where `aFoam` is set, and a faint
 * sky reflection at grazing angles.
 */

const WATER = {
  /** World units per second at current 1. */
  flowSpeed: 0.16,
  cycle: 2,
  /** Streak frequency along the channel (per world unit) and across it (per half-width). */
  along: 9,
  across: 2.2,
  contrast: 0.3,
  /** Glints: finer than the streaks, carried this much faster. */
  glintScale: 2.6,
  glintSpeed: 1.6,
  glint: 0.22,
  /** The pale wet line, over the outer share of each half-width. */
  edge: 0.2,
  edgeFrom: 0.86,
  /** Opacity mid-channel and at the bank. */
  opacity: 0.92,
  edgeOpacity: 0.5,
  foam: 0.75,
  selfLit: 0.15,
  /** Share of the diffuse shading replaced by a flat tone, so the water keeps its colour on sunlit slopes. */
  flat: 0.55,
  flatTone: 0.8,
  specular: 0.25,
  sky: 0.15,
  roughness: 0.45,
} as const

const SKY = '#c9cfdc'
const FOAM = '#eef1f6'

const float = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(value))

export type StreamMaterial = { material: MeshStandardMaterial; uniforms: { uTime: IUniform<number> } }

export function createStreamMaterial(): StreamMaterial {
  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new Color(PROJECT_COLORS.waterDeep) },
    uShallow: { value: new Color(PROJECT_COLORS.waterShallow) },
    uLine: { value: new Color(PROJECT_COLORS.waterLine) },
    uSky: { value: new Color(SKY) },
    uFoam: { value: new Color(FOAM) },
  }
  const material = new MeshStandardMaterial({
    roughness: WATER.roughness,
    metalness: 0,
    transparent: true,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  material.onBeforeCompile = (program: WebGLProgramParametersWithUniforms) => {
    Object.assign(program.uniforms, uniforms)
    program.vertexShader = program.vertexShader.replace(
      'void main() {',
      /* glsl */ `attribute float aFlow;
attribute float aAcross;
attribute float aSpeed;
attribute float aFoam;
varying float vFlow;
varying float vAcross;
varying float vSpeed;
varying float vFoam;
void main() {
  vFlow = aFlow;
  vAcross = aAcross;
  vSpeed = aSpeed;
  vFoam = aFoam;`,
    )
    program.fragmentShader = program.fragmentShader
      .replace(
        'void main() {',
        /* glsl */ `uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uLine;
uniform vec3 uSky;
uniform vec3 uFoam;
varying float vFlow;
varying float vAcross;
varying float vSpeed;
varying float vFoam;
float streamHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float streamNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(streamHash(i), streamHash(i + vec2(1.0, 0.0)), u.x),
    mix(streamHash(i + vec2(0.0, 1.0)), streamHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float streak(vec2 p) {
  vec2 q = vec2(p.x * ${float(WATER.along)}, p.y * ${float(WATER.across)});
  return streamNoise(q) * 0.6 + streamNoise(q * vec2(2.3, 1.7) + 3.7) * 0.4;
}
/** A pattern carried downstream at the current, in two phases blended so it never shears. */
float carried(float scale, float speed, vec2 seed) {
  float current = vSpeed * ${float(WATER.flowSpeed)} * speed;
  float phaseA = fract(uTime / ${float(WATER.cycle)});
  float phaseB = fract(uTime / ${float(WATER.cycle)} + 0.5);
  float a = streak(vec2(vFlow * scale - phaseA * ${float(WATER.cycle)} * current * scale, vAcross * scale) + seed);
  float b = streak(vec2(vFlow * scale - phaseB * ${float(WATER.cycle)} * current * scale + 0.37, vAcross * scale + 0.21) + seed);
  return mix(b, a, 1.0 - abs(2.0 * phaseA - 1.0));
}
void main() {`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
float across = abs(vAcross);
float wave = carried(1.0, 1.0, vec2(0.0));
float fine = carried(${float(WATER.glintScale)}, ${float(WATER.glintSpeed)}, vec2(5.1, 1.3));
vec3 water = mix(uDeep, uShallow, smoothstep(0.15, 0.95, across));
water *= 1.0 + (wave - 0.5) * ${float(WATER.contrast)};
water = mix(water, uLine, smoothstep(${float(WATER.edgeFrom)}, 1.0, across) * ${float(WATER.edge)});
float foam = smoothstep(0.5, 0.78, fine) * vFoam * ${float(WATER.foam)};
water = mix(water, uFoam, foam);
float glint = smoothstep(0.74, 0.93, fine) * (1.0 - smoothstep(0.25, 0.9, across)) * (1.0 - foam);
diffuseColor.rgb = water;
diffuseColor.a = max(mix(${float(WATER.opacity)}, ${float(WATER.edgeOpacity)}, smoothstep(0.55, 1.0, across)), foam);`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
float fresnel = pow(1.0 - facing, 4.0);
outgoingLight = mix(totalDiffuse, diffuseColor.rgb * ${float(WATER.flatTone)}, ${float(WATER.flat)})
  + totalSpecular * ${float(WATER.specular)} + totalEmissiveRadiance;
outgoingLight += diffuseColor.rgb * ${float(WATER.selfLit)};
outgoingLight = mix(outgoingLight, uSky, fresnel * ${float(WATER.sky)});
outgoingLight += uLine * glint * ${float(WATER.glint)};
#include <opaque_fragment>`,
      )
  }
  material.customProgramCacheKey = () => 'week06-stream'
  return { material, uniforms }
}

export function advanceStreamTime(stream: StreamMaterial, delta: number) {
  stream.uniforms.uTime.value += delta
}

/**
 * The wet bank under and beside the water: dark at the water's edge, fading
 * out. It writes depth, and its middle stands a hair above its edge, so where
 * banks overlap the darker part wins instead of darkening twice.
 */
export function createStreamBankMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: { uColor: { value: new Color('#1d1c1a') }, uOpacity: { value: 0.34 } },
    vertexShader: /* glsl */ `attribute float aBank;
varying float vBank;
void main() {
  vBank = aBank;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `uniform vec3 uColor;
uniform float uOpacity;
varying float vBank;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * (1.0 - smoothstep(0.0, 1.0, vBank)));
}`,
  })
}
