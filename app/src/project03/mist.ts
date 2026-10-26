import { mistUniform } from './environment.ts'

/**
 * Mist for 0.3's materials: the scene's fog, plus a haze that settles in low ground. A patch for a
 * material's `onBeforeCompile`: it keeps three's linear fog and adds a second term that thickens
 * with distance and is heaviest in the valleys (low world height), so mist fills hollows and
 * leaves ridges clear, instead of simply darkening everything. `mistUniform` (0–1) is the weather's mist.
 */
export function applyMist(shader: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }) {
  shader.uniforms.uMist = mistUniform
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', 'varying vec3 vMistPos;\nvoid main() {')
    .replace('#include <fog_vertex>', '#include <fog_vertex>\n  vMistPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'uniform float uMist;\nvarying vec3 vMistPos;\nvoid main() {')
    .replace(
      '#include <fog_fragment>',
      `#ifdef USE_FOG
  float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  // Low ground holds the mist: its density falls off with height over a couple of hundred meters.
  float mistLow = 1.0 - smoothstep(30.0, 300.0, vMistPos.y);
  float mistK = 1.0 - exp(-vFogDepth * uMist * (0.0002 + 0.0016 * mistLow));
  fogFactor = 1.0 - (1.0 - fogFactor) * (1.0 - min(0.62, mistK));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`,
    )
}
