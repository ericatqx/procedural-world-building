import { Color, type WebGLProgramParametersWithUniforms } from 'three'

/** Neutral: the off-white matte surface. Elevation: height mapped to a ramp. */
export type TerrainColorMode = 'neutral' | 'elevation'

/**
 * Restrained cartographic ramp, low → high: muted blue, slate, cool gray,
 * pale gray. Blended continuously — no bands.
 */
const ELEVATION_STOPS = ['#4b5f78', '#6e7f92', '#a2a9b0', '#ebe9e4'].map(
  (hex) => new Color(hex),
)

/** Contour spacing is in displayed height units (heightmap × amplitude). */
const CONTOUR_STYLE = {
  interval: 0.05,
  indexEvery: 5,
  minorWidthPx: 0.8,
  indexWidthPx: 1.4,
  minorOpacity: 0.18,
  indexOpacity: 0.4,
}

/**
 * Anti-aliased iso-line of `value` every `interval`, `widthPx` wide on screen.
 * Fades out where lines would pack tighter than a few pixels (grazing angles),
 * otherwise they merge into solid smears.
 */
const CONTOUR_GLSL = /* glsl */ `
float contourLine(float value, float interval, float widthPx) {
  float f = value / interval;
  float density = max(fwidth(f), 1e-5);
  float d = abs(fract(f - 0.5) - 0.5) / density;
  float line = 1.0 - smoothstep(widthPx * 0.5 - 0.5, widthPx * 0.5 + 0.5, d);
  return line * (1.0 - smoothstep(0.25, 0.5, density));
}
`

/** Maps displayed height in [-range, range] onto the elevation ramp. */
const ELEVATION_GLSL = /* glsl */ `
vec3 elevationColor(float height, float range) {
  float t = clamp(height / max(range, 1e-5) * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(uElevationStops[0], uElevationStops[1], smoothstep(0.0, 0.4, t));
  c = mix(c, uElevationStops[2], smoothstep(0.4, 0.7, t));
  return mix(c, uElevationStops[3], smoothstep(0.7, 1.0, t));
}
`

/**
 * Thin elevation contours drawn over the lit surface of a MeshStandardMaterial.
 * Lines darken lit areas and lighten shadowed ones so they stay neutral and
 * readable on both. Toggle with `setContoursVisible` — no recompile.
 *
 * Also carries an optional elevation tint that replaces the surface colour
 * with the height ramp (`setColorMode`). The ramp spans ±amplitude, so a
 * colour always means the same height.
 */
export function createTerrainContours() {
  const visibility = { value: 1 }
  const elevation = { value: 0 }
  const elevationRange = { value: 1 }
  const uniforms = {
    uElevationMix: elevation,
    uElevationRange: elevationRange,
    uElevationStops: { value: ELEVATION_STOPS },
    uContourVisibility: visibility,
    uContourInterval: { value: CONTOUR_STYLE.interval },
    uContourIndexEvery: { value: CONTOUR_STYLE.indexEvery },
    uContourMinorWidth: { value: CONTOUR_STYLE.minorWidthPx },
    uContourIndexWidth: { value: CONTOUR_STYLE.indexWidthPx },
    uContourMinorOpacity: { value: CONTOUR_STYLE.minorOpacity },
    uContourIndexOpacity: { value: CONTOUR_STYLE.indexOpacity },
  }

  const onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying float vContourHeight;\nvoid main() {')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvContourHeight = transformed.z;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying float vContourHeight;
uniform float uContourVisibility;
uniform float uContourInterval;
uniform float uContourIndexEvery;
uniform float uContourMinorWidth;
uniform float uContourIndexWidth;
uniform float uContourMinorOpacity;
uniform float uContourIndexOpacity;
uniform float uElevationMix;
uniform float uElevationRange;
uniform vec3 uElevationStops[4];
${CONTOUR_GLSL}
${ELEVATION_GLSL}
void main() {`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, elevationColor(vContourHeight, uElevationRange), uElevationMix);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `float contourStep = floor(vContourHeight / uContourInterval + 0.5);
float contourIsIndex = 1.0 - step(0.5, mod(contourStep, uContourIndexEvery));
float contourMinor = contourLine(vContourHeight, uContourInterval, uContourMinorWidth) * (1.0 - contourIsIndex);
float contourIndex = contourLine(vContourHeight, uContourInterval, uContourIndexWidth) * contourIsIndex;
float contourMix = max(contourMinor * uContourMinorOpacity, contourIndex * uContourIndexOpacity) * uContourVisibility;
float contourLum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
vec3 contourInk = mix(vec3(0.85), vec3(0.0), smoothstep(0.06, 0.25, contourLum));
outgoingLight = mix(outgoingLight, contourInk, contourMix);
#include <opaque_fragment>`,
      )
  }

  return {
    setContoursVisible: (visible: boolean) => {
      visibility.value = visible ? 1 : 0
    },
    setColorMode: (mode: TerrainColorMode, amplitude: number) => {
      elevation.value = mode === 'elevation' ? 1 : 0
      elevationRange.value = amplitude
    },
    onBeforeCompile,
    customProgramCacheKey: () => 'terrain-contours',
  }
}
