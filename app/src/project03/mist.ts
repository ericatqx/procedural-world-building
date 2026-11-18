import { mistUniform } from './environment.ts'
import { styleUniforms } from './visualStyle.ts'

/**
 * Mist for 0.3's materials: the scene's fog, plus a haze that settles in low ground. A patch for a
 * material's `onBeforeCompile`: it keeps three's linear fog and adds a second term that thickens
 * with distance and is heaviest in the valleys (low world height), so mist fills hollows and
 * leaves ridges clear, instead of simply darkening everything. `mistUniform` (0–1) is the weather's mist.
 */
/**
 * DEPTH THAT STAYS INSIDE ITS TRIANGLE (Phase 1 QA: the pale dotted lines across the lakes). The Canvas uses a logarithmic depth buffer, so every
 * surface writes its depth from a varying (three's vFragDepth). With anti-aliasing on, a varying is evaluated at the pixel's centre even when the
 * triangle covers only a corner of the pixel, that is, extrapolated beyond the triangle. For a triangle seen almost edge-on (the vertical skirt
 * walls under each terrain chunk's border, seen from above) the depth changes by tens of metres within one pixel, so the extrapolated depth could
 * land in front of the lake's surface although the wall is entirely under the lake bed: the pale wall won those pixels, a dotted line along the
 * 128 m chunk borders, moving as the camera orbited (visible on the lakes because pale shows on teal; on land it had the ground's own colour).
 * `centroid` makes the GPU evaluate the varying inside the covered part of the pixel, so the depth written is always one the triangle really has.
 */
export function applyCentroidDepth(shader: { vertexShader: string; fragmentShader: string }) {
  shader.vertexShader = shader.vertexShader.replace(
    '#include <logdepthbuf_pars_vertex>',
    '#ifdef USE_LOGARITHMIC_DEPTH_BUFFER\n  centroid varying float vFragDepth;\n  varying float vIsPerspective;\n#endif',
  )
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <logdepthbuf_pars_fragment>',
    '#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )\n  uniform float logDepthBufFC;\n  centroid varying float vFragDepth;\n  varying float vIsPerspective;\n#endif',
  )
}

export function applyMist(shader: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }) {
  applyCentroidDepth(shader)
  shader.uniforms.uMist = mistUniform
  shader.uniforms.uStyMist = styleUniforms.uStyMist
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', 'varying vec3 vMistPos;\nvoid main() {')
    .replace('#include <fog_vertex>', '#include <fog_vertex>\n  vMistPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'uniform float uMist;\nuniform float uStyMist;\nvarying vec3 vMistPos;\nvoid main() {')
    .replace(
      '#include <fog_fragment>',
      `#ifdef USE_FOG
  float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  // Low ground holds the mist: its density falls off with height over a couple of hundred meters.
  float mistLow = 1.0 - smoothstep(30.0, 300.0, vMistPos.y);
  float mistK = 1.0 - exp(-vFogDepth * uMist * uStyMist * (0.0002 + 0.0016 * mistLow));
  fogFactor = 1.0 - (1.0 - fogFactor) * (1.0 - min(0.62, mistK));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`,
    )
}
