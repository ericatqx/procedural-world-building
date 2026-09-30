import {
  MeshDepthMaterial,
  MeshStandardMaterial,
  RGBADepthPacking,
  type IUniform,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { LINE_GLSL } from './glsl.ts'

/**
 * GLSL injected into a MeshStandardMaterial, so the key light and shadows
 * keep working. Every chunk can read the varyings `vStudyWorldPos` /
 * `vStudyWorldNormal`, the float `params` uniforms and LINE_GLSL.
 *
 * The fragment chunks must assign `float studyTerm` (0…1) somewhere: the
 * scalar the rule computes, shown on its own while `uShowTerm` is 1.
 */
export type SurfaceShader = {
  /** Declarations before `main()` in the vertex programs (shading and shadow depth). */
  vertexHead?: string
  /** Runs after `#include <begin_vertex>`; may move `transformed`. */
  vertex?: string
  /** Declarations before `main()` in the fragment program. */
  fragmentHead?: string
  /** Runs after `#include <color_fragment>`; edits the albedo `diffuseColor` before lighting. */
  albedo?: string
  /** Runs after `#include <roughnessmap_fragment>`; edits `roughnessFactor`. */
  roughness?: string
  /** Runs after `#include <normal_fragment_maps>`; edits the view-space `normal`. */
  normal?: string
  /**
   * Runs after `#include <lights_fragment_begin>`, where `directLight` still
   * holds the key light with its shadow applied.
   */
  lights?: string
  /** Runs before `#include <opaque_fragment>`; edits the lit `outgoingLight`. */
  lit?: string
  /** Face normals from screen-space derivatives, for surfaces the vertex stage moved. */
  flatShading?: boolean
  /** Uniforms beyond the float params (colours, textures, time). */
  uniforms?: () => Record<string, IUniform>
}

export type SurfaceMaterial = {
  material: MeshStandardMaterial
  /** Shadow-map material carrying the same vertex rule, when the shader moves vertices. */
  depthMaterial: MeshDepthMaterial | null
  uniforms: Record<string, IUniform>
}

/**
 * Builds a matte MeshStandardMaterial with `shader` injected. `params` are
 * float uniforms with their starting values, declared in every stage;
 * `cacheKey` keeps each shader's programs apart.
 */
export function createSurfaceMaterial(
  shader: SurfaceShader,
  { cacheKey, color, params = {} }: { cacheKey: string; color: string; params?: Record<string, number> },
): SurfaceMaterial {
  const uniforms: Record<string, IUniform> = {
    ...Object.fromEntries(Object.entries(params).map(([name, value]) => [name, { value }])),
    ...shader.uniforms?.(),
    uShowTerm: { value: 0 },
  }
  const paramDeclarations = Object.keys(params)
    .map((name) => `uniform float ${name};`)
    .join('\n')
  const vertexHead = `${paramDeclarations}\n${shader.vertexHead ?? ''}`

  const injectVertex = (source: string) =>
    source
      .replace('void main() {', `${vertexHead}\nvoid main() {`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${shader.vertex ?? ''}`)

  const material = new MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0,
    flatShading: shader.flatShading ?? false,
  })
  material.onBeforeCompile = (program: WebGLProgramParametersWithUniforms) => {
    Object.assign(program.uniforms, uniforms)
    program.vertexShader = injectVertex(program.vertexShader)
      .replace(
        'void main() {',
        'varying vec3 vStudyWorldPos;\nvarying vec3 vStudyWorldNormal;\nvoid main() {',
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vStudyWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vStudyWorldNormal = normalize(mat3(modelMatrix) * normal);`,
      )
    program.fragmentShader = program.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vStudyWorldPos;
varying vec3 vStudyWorldNormal;
uniform float uShowTerm;
${paramDeclarations}
${LINE_GLSL}
${shader.fragmentHead ?? ''}
void main() {`,
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${shader.albedo ?? ''}`)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\n${shader.roughness ?? ''}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${shader.normal ?? ''}`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `#include <lights_fragment_begin>\n${shader.lights ?? ''}`,
      )
      .replace('#include <opaque_fragment>', `${shader.lit ?? ''}\n#include <opaque_fragment>`)
      // After tone mapping and before the sRGB encode, so the term reads 0 → black, 1 → white.
      .replace(
        '#include <tonemapping_fragment>',
        `#include <tonemapping_fragment>
gl_FragColor.rgb = mix(gl_FragColor.rgb, pow(vec3(clamp(studyTerm, 0.0, 1.0)), vec3(2.2)), uShowTerm);`,
      )
  }
  material.customProgramCacheKey = () => `shader-study-${cacheKey}`

  let depthMaterial: MeshDepthMaterial | null = null
  if (shader.vertex) {
    depthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
    depthMaterial.onBeforeCompile = (program: WebGLProgramParametersWithUniforms) => {
      Object.assign(program.uniforms, uniforms)
      program.vertexShader = injectVertex(program.vertexShader)
    }
    depthMaterial.customProgramCacheKey = () => `shader-study-depth-${cacheKey}`
  }

  return { material, depthMaterial, uniforms }
}
