import {
  Color,
  LineBasicMaterial,
  MeshDepthMaterial,
  MeshStandardMaterial,
  RGBADepthPacking,
  type IUniform,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { PROJECT_COLORS } from '../../project/materials.ts'
import { themeColor } from '../../shared/ui/theme.ts'
import type { GrowthResponse } from './turtle.ts'

/**
 * Week 07 Trace Growth — the organism's material. The growth front is a
 * path length: everything the front has not reached is discarded, and the
 * last `uTip` behind it narrows to a point, so the same mesh is revealed
 * from seed to tips. Tone records time and place: fresh growth is pale bone,
 * older growth weathers to grey, and growth that has stayed in shelter long
 * enough is colonised in the Project's lichen green. While growing, the
 * front itself is marked in signal red (active change).
 */

export const TRACE_COLORS = {
  fresh: PROJECT_COLORS.path,
  aged: PROJECT_COLORS.archWeathered,
  lichen: PROJECT_COLORS.habitat,
  lichenDeep: PROJECT_COLORS.habitatInk,
  bias: '#ff1f1f',
} as const

/**
 * The field each response reads, drawn on the ground: Seek shelter a lichen
 * wash as deep as the shelter, Seek light a pale wash as bright as the light
 * (1 − shelter), each with contours at 0.5 and 0.8. Free reads neither, so
 * only faint shelter contours mark the environment it ignores.
 */
export const FIELD_STYLES: Record<GrowthResponse, { color: string; wash: number; contour: number }> = {
  free: { color: TRACE_COLORS.aged, wash: 0, contour: 90 },
  light: { color: TRACE_COLORS.fresh, wash: 34, contour: 130 },
  shelter: { color: PROJECT_COLORS.habitatThin, wash: 60, contour: 150 },
}

export type TraceUniforms = {
  uFront: IUniform<number>
  uTip: IUniform<number>
  uAgeSpan: IUniform<number>
  uGrowing: IUniform<number>
  uFresh: IUniform<Color>
  uAged: IUniform<Color>
  uLichen: IUniform<Color>
  uLichenDeep: IUniform<Color>
  uSignal: IUniform<Color>
}

export function createTraceUniforms(): TraceUniforms {
  return {
    uFront: { value: 0 },
    uTip: { value: 0.12 },
    uAgeSpan: { value: 1 },
    uGrowing: { value: 0 },
    uFresh: { value: new Color(TRACE_COLORS.fresh) },
    uAged: { value: new Color(TRACE_COLORS.aged) },
    uLichen: { value: new Color(TRACE_COLORS.lichen) },
    uLichenDeep: { value: new Color(TRACE_COLORS.lichenDeep) },
    uSignal: { value: new Color(themeColor('--signal', TRACE_COLORS.bias)) },
  }
}

/** Places the growth front: `progress` 0 seed … 1 fully grown, over the longest path. */
export function setTraceReveal(
  uniforms: TraceUniforms,
  reveal: { progress: number; maxArrival: number; tip: number; ageSpan: number; growing: boolean },
) {
  uniforms.uTip.value = reveal.tip
  uniforms.uAgeSpan.value = reveal.ageSpan
  uniforms.uFront.value = reveal.progress * (reveal.maxArrival + reveal.tip)
  uniforms.uGrowing.value = reveal.growing ? 1 : 0
}

const VERTEX_DECL = /* glsl */ `
attribute float aArrival;
attribute float aShelter;
uniform float uFront;
uniform float uTip;
varying float vArrival;
varying float vShelter;
`

/** Tubes and buds shrink onto their centreline just behind the front. */
const VERTEX_GROW = /* glsl */ `
vec3 transformed = aCenter + (position - aCenter) * clamp((uFront - aArrival) / uTip, 0.0, 1.0);
vArrival = aArrival;
vShelter = aShelter;
`

const FRAGMENT_DECL = /* glsl */ `
uniform float uFront;
uniform float uTip;
uniform float uAgeSpan;
uniform float uGrowing;
uniform vec3 uFresh;
uniform vec3 uAged;
uniform vec3 uLichen;
uniform vec3 uLichenDeep;
uniform vec3 uSignal;
varying float vArrival;
varying float vShelter;
`

const FRAGMENT_TONE = /* glsl */ `
if (vArrival > uFront) discard;
float age = max(uFront - vArrival, 0.0);
float aged = smoothstep(0.0, uAgeSpan, age);
vec3 tone = mix(uFresh, uAged, aged);
float colonised = smoothstep(0.3, 0.8, vShelter) * smoothstep(uTip, uAgeSpan * 0.5, age);
tone = mix(tone, mix(uLichen, uLichenDeep, aged * 0.45), colonised);
diffuseColor.rgb = tone;
`

const FRAGMENT_FRONT = /* glsl */ `
totalEmissiveRadiance += uSignal * (1.0 - smoothstep(0.0, uTip * 1.6, uFront - vArrival)) * uGrowing * 0.85;
`

function bind(shader: WebGLProgramParametersWithUniforms, uniforms: TraceUniforms) {
  Object.assign(shader.uniforms, uniforms)
}

export function createTraceMaterial(uniforms: TraceUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ roughness: 0.78, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    bind(shader, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 aCenter;\n${VERTEX_DECL}`)
      .replace('#include <begin_vertex>', VERTEX_GROW)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_TONE}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAGMENT_FRONT}`)
  }
  return material
}

/** Shadows follow the reveal: the depth pass grows and discards the same way. */
export function createTraceDepthMaterial(uniforms: TraceUniforms): MeshDepthMaterial {
  const material = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
  material.onBeforeCompile = (shader) => {
    bind(shader, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 aCenter;\n${VERTEX_DECL}`)
      .replace('#include <begin_vertex>', VERTEX_GROW)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uFront;\nvarying float vArrival;`)
      .replace('void main() {', 'void main() {\nif (vArrival > uFront) discard;')
  }
  return material
}

/**
 * Lines revealed by the same front: `toned` lines take the organism's tone
 * (Low's twigs), otherwise they keep the material colour (tropism vectors).
 */
export function createTraceLineMaterial(
  uniforms: TraceUniforms,
  options: { color: string; opacity: number; toned: boolean },
): LineBasicMaterial {
  const material = new LineBasicMaterial({
    color: options.color,
    transparent: options.opacity < 1,
    opacity: options.opacity,
  })
  material.onBeforeCompile = (shader) => {
    bind(shader, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECL}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvArrival = aArrival;\nvShelter = aShelter;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECL}`)
      .replace(
        '#include <color_fragment>',
        options.toned
          ? `#include <color_fragment>\n${FRAGMENT_TONE}`
          : '#include <color_fragment>\nif (vArrival > uFront) discard;',
      )
  }
  material.customProgramCacheKey = () => `trace-line-${options.toned}`
  return material
}
