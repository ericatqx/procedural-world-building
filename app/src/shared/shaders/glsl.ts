/** Anti-aliased lines, sized in screen pixels, drawn over lit colour. */
export const LINE_GLSL = /* glsl */ `
float contourLine(float value, float interval, float widthPx) {
  float f = value / interval;
  float density = max(fwidth(f), 1e-5);
  float d = abs(fract(f - 0.5) - 0.5) / density;
  float line = 1.0 - smoothstep(widthPx * 0.5 - 0.5, widthPx * 0.5 + 0.5, d);
  return line * (1.0 - smoothstep(0.25, 0.5, density));
}

float isoLine(float value, float level, float widthPx) {
  float d = abs(value - level) / max(fwidth(value), 1e-5);
  return 1.0 - smoothstep(widthPx * 0.5 - 0.5, widthPx * 0.5 + 0.5, d);
}

vec3 drawLine(vec3 lit, float line, float opacity) {
  float lum = dot(lit, vec3(0.2126, 0.7152, 0.0722));
  vec3 ink = mix(vec3(0.85), vec3(0.0), smoothstep(0.06, 0.25, lum));
  return mix(lit, ink, clamp(line * opacity, 0.0, 1.0));
}
`

export const NOISE_GLSL = /* glsl */ `
float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i);
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z
  );
}
`

/**
 * `lights` chunk: `float habitatExposure`, the direct sun reaching this pixel
 * after the shadow map (n·l times the shadow term). The scene's sun must be
 * its only directional light.
 */
export const SUN_EXPOSURE_GLSL = /* glsl */ `
float habitatExposure = 1.0;
#if NUM_DIR_LIGHTS > 0
  vec3 lumaWeights = vec3(0.2126, 0.7152, 0.0722);
  float sunShadow = dot(directLight.color, lumaWeights) / max(dot(directionalLights[0].color, lumaWeights), 1e-5);
  habitatExposure = max(dot(normal, directLight.direction), 0.0) * sunShadow;
#endif
`
