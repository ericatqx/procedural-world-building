import { BackSide, Color, MeshLambertMaterial, ShaderMaterial, type Side } from 'three'

/**
 * Style A's shading: three tones per surface (lit, turned, shadow) from one base colour. The sun's direct light, shadows included, decides which; the
 * light is set to intensity π so that light reads 0 to 1 here. Shadow is the base drawn toward the hour's shadow hue, so the scene's darks are one family.
 * Nothing else lights the surface: the sky's ambient is replaced by a faint bounce on upward faces in shadow.
 */
export const rampUniforms = {
  uShadowCol: { value: new Color('#7a6a9c') },
  uShadowMix: { value: 0.48 },
  uLightCol: { value: new Color('#ffe9cf') },
  uSkyCol: { value: new Color('#b9a9d6') },
}

const HEAD = /* glsl */ `
uniform vec3 uShadowCol;
uniform float uShadowMix;
uniform vec3 uLightCol;
uniform vec3 uSkyCol;
`
const BODY = /* glsl */ `
{
  vec3 base = diffuseColor.rgb;
  float lum = max(0.002, dot(base, vec3(0.3333)));
  float lit = clamp(dot(reflectedLight.directDiffuse, vec3(0.3333)) / lum, 0.0, 1.0);
  vec3 shadowC = mix(base * 0.58, uShadowCol, uShadowMix);
  vec3 turned = mix(shadowC, base, 0.62);
  float a = smoothstep(0.1, 0.17, lit);
  float b = smoothstep(0.5, 0.58, lit);
  vec3 c = mix(shadowC, mix(turned, base * uLightCol, b), a);
  vec3 wn = inverseTransformDirection(normal, viewMatrix);
  c += uSkyCol * 0.07 * max(wn.y, 0.0) * (1.0 - a);
  outgoingLight = c;
}
`

export function rampMaterial({ color = '#ffffff', vertexColors = true, side }: { color?: string; vertexColors?: boolean; side?: Side } = {}) {
  const m = new MeshLambertMaterial({ color, vertexColors, ...(side !== undefined ? { side } : {}) })
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, rampUniforms)
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `${HEAD}void main() {`).replace('#include <opaque_fragment>', `${BODY}\n#include <opaque_fragment>`)
  }
  m.customProgramCacheKey = () => 'sculpt-ramp'
  return m
}

/**
 * The selective outline: the back faces of a smooth-normalled copy, pushed out along their normals by a share of their distance (so the line keeps a
 * near-constant width on screen), drawn in the surface's own shadow hue, never black.
 */
export function outlineMaterial(color: string, width = 0.0018) {
  const c = new Color(color)
  return new ShaderMaterial({
    side: BackSide,
    uniforms: { uColor: { value: c }, uWidth: { value: width } },
    vertexShader: /* glsl */ `
      uniform float uWidth;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        mv.xyz += n * (-mv.z) * uWidth;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      void main() {
        gl_FragColor = vec4(uColor, 1.0);
        #include <colorspace_fragment>
      }`,
  })
}
