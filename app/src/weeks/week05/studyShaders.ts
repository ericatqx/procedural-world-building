import { Color } from 'three'
import { NOISE_GLSL, SUN_EXPOSURE_GLSL } from '../../shared/shaders/glsl.ts'
import type { SurfaceShader } from '../../shared/shaders/surfaceMaterial.ts'
import { CONVEXITY_ATTRIBUTE, GROWTH_AGE_ATTRIBUTE } from './fields.ts'
import { STUDY_COLORS, STUDY_CONSTANTS, type ShaderStudyId } from './studies.ts'

/**
 * GLSL for each shader study, injected into a MeshStandardMaterial so the key
 * light and shadows keep working (see shared/shaders/surfaceMaterial.ts).
 * Every study reads the shared varyings `vStudyWorldPos` / `vStudyWorldNormal`
 * and its own float uniforms, which are declared automatically from its
 * params.
 *
 * Each study must assign `float studyTerm` (0…1) somewhere in its fragment
 * chunks: the scalar its rule computes, shown on its own by the Term view.
 *
 * Guides: explanatory linework (contours, rings, thresholds) is multiplied by
 * `uGuides`, so the Guides view tool hides it without changing the result.
 */
const color = (hex: string) => ({ value: new Color(hex) })
const float = (value: number) => value.toFixed(4)

export const STUDY_SHADERS: Record<ShaderStudyId, SurfaceShader> = {
  height: {
    uniforms: () => ({
      uHeightRamp: { value: STUDY_COLORS.heightRamp.map((hex) => new Color(hex)) },
    }),
    fragmentHead: /* glsl */ `
uniform vec3 uHeightRamp[4];
vec3 heightRamp(float t) {
  vec3 c = mix(uHeightRamp[0], uHeightRamp[1], smoothstep(0.0, 0.4, t));
  c = mix(c, uHeightRamp[2], smoothstep(0.4, 0.7, t));
  return mix(c, uHeightRamp[3], smoothstep(0.7, 1.0, t));
}
`,
    albedo: /* glsl */ `
float studyTerm = clamp(
  (vStudyWorldPos.y - uHeightLow) / max(uHeightHigh - uHeightLow, 1e-3),
  0.0,
  1.0
);
diffuseColor.rgb = heightRamp(studyTerm);
`,
    lit: /* glsl */ `
if (uHeightInterval > 0.0) {
  outgoingLight = drawLine(outgoingLight, contourLine(vStudyWorldPos.y, uHeightInterval, 1.0) * uGuides, 0.45);
}
`,
  },

  slope: {
    uniforms: () => ({ uSlopeColor: color(STUDY_COLORS.sediment) }),
    fragmentHead: 'uniform vec3 uSlopeColor;',
    albedo: /* glsl */ `
float slopeAngle = degrees(acos(clamp(normalize(vStudyWorldNormal).y, -1.0, 1.0)));
float slopeSoft = max(uSlopeSoftness, 0.01);
float studyTerm = smoothstep(uSlopeThreshold - slopeSoft, uSlopeThreshold + slopeSoft, slopeAngle);
diffuseColor.rgb = mix(diffuseColor.rgb, uSlopeColor, studyTerm);
`,
    lit: /* glsl */ `
outgoingLight = drawLine(outgoingLight, isoLine(slopeAngle, uSlopeThreshold, 1.2) * uGuides, 0.7);
`,
  },

  distance: {
    uniforms: () => ({ uDistanceColor: color(STUDY_COLORS.signal) }),
    fragmentHead: 'uniform vec3 uDistanceColor;',
    albedo: /* glsl */ `
float probeDistance = distance(vStudyWorldPos, vec3(uProbeX, uProbeY, 0.0));
float studyTerm = 1.0 - smoothstep(0.0, uProbeRadius, probeDistance);
diffuseColor.rgb = mix(diffuseColor.rgb, uDistanceColor, studyTerm);
`,
    lit: /* glsl */ `
outgoingLight = drawLine(outgoingLight, contourLine(probeDistance, ${float(STUDY_CONSTANTS.distanceRingSpacing)}, 1.0) * uGuides, 0.3);
outgoingLight = drawLine(outgoingLight, isoLine(probeDistance, uProbeRadius, 1.4) * uGuides, 0.8);
`,
  },

  fresnel: {
    uniforms: () => ({ uRimColor: color(STUDY_COLORS.rim) }),
    fragmentHead: 'uniform vec3 uRimColor;',
    lit: /* glsl */ `
float facing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
float studyTerm = pow(1.0 - facing, uFresnelPower) * uFresnelStrength;
outgoingLight = outgoingLight * ${float(STUDY_CONSTANTS.fresnelSurface)} + uRimColor * studyTerm;
`,
  },

  displacement: {
    flatShading: true,
    uniforms: () => ({ uTime: { value: 0 } }),
    vertexHead: `uniform float uTime;\nvarying float vDisplaceNoise;\nvarying float vDisplace;\n${NOISE_GLSL}`,
    vertex: /* glsl */ `
vDisplaceNoise = valueNoise(position * uDisplaceFrequency + vec3(0.0, -uTime * uDisplaceSpeed, 0.0));
vDisplace = uDisplaceAmplitude * (vDisplaceNoise * 2.0 - 1.0);
transformed += normal * vDisplace;
`,
    fragmentHead: 'varying float vDisplaceNoise;\nvarying float vDisplace;',
    albedo: /* glsl */ `
float studyTerm = vDisplaceNoise;
float pitDepth = clamp(-vDisplace / ${float(STUDY_CONSTANTS.displacementMaxAmplitude)}, 0.0, 1.0);
diffuseColor.rgb *= mix(1.0, ${float(STUDY_CONSTANTS.displacementPitShade)}, pitDepth);
`,
    lit: /* glsl */ `
outgoingLight = drawLine(outgoingLight, isoLine(vDisplace, 0.0, 1.2) * step(1e-4, uDisplaceAmplitude) * uGuides, 0.6);
`,
  },

  contact: {
    albedo: /* glsl */ `
float contactGap = max(vStudyWorldPos.y, 0.0);
float contactFacing = 1.0 - max(normalize(vStudyWorldNormal).y, 0.0);
float studyTerm = pow(1.0 - clamp(contactGap / uContactDistance, 0.0, 1.0), ${float(STUDY_CONSTANTS.contactFalloff)}) * contactFacing * uContactStrength;
`,
    lit: 'outgoingLight *= 1.0 - studyTerm;',
  },

  surface: {
    uniforms: () => ({
      uSurfacePalettes: {
        value: STUDY_COLORS.surfacePalettes.flat().map((hex) => new Color(hex)),
      },
    }),
    fragmentHead: /* glsl */ `
uniform vec3 uSurfacePalettes[${STUDY_COLORS.surfacePalettes.length * 3}];
${NOISE_GLSL}
float surfaceFbm(vec3 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  float total = 0.0;
  for (int i = 0; i < ${STUDY_CONSTANTS.surfaceOctaves}; i++) {
    sum += amplitude * valueNoise(p);
    total += amplitude;
    p = p * 2.03 + vec3(17.1, 5.3, 11.7);
    amplitude *= 0.5;
  }
  return sum / total;
}
vec3 surfacePalette(float t) {
  int base = int(uSurfacePalette + 0.5) * 3;
  vec3 c = mix(uSurfacePalettes[base], uSurfacePalettes[base + 1], smoothstep(0.0, 0.5, t));
  return mix(c, uSurfacePalettes[base + 2], smoothstep(0.5, 1.0, t));
}
`,
    albedo: /* glsl */ `
float surfaceNoise = surfaceFbm(vStudyWorldPos * uSurfaceScale);
float studyTerm = clamp((surfaceNoise - 0.5) * uSurfaceContrast + 0.5, 0.0, 1.0);
diffuseColor.rgb = surfacePalette(studyTerm);
`,
    roughness: 'roughnessFactor = mix(0.65, 1.0, studyTerm);',
    normal: /* glsl */ `
{
  float bumpHeight = studyTerm * uSurfaceRelief;
  vec3 dpdx = dFdx(-vViewPosition);
  vec3 dpdy = dFdy(-vViewPosition);
  vec3 r1 = cross(dpdy, normal);
  vec3 r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dFdx(bumpHeight) * r1 + dFdy(bumpHeight) * r2);
  normal = normalize(abs(det) * normal - grad);
}
`,
  },

  habitat: {
    uniforms: () => ({ uHabitatColor: color(STUDY_COLORS.habitat) }),
    fragmentHead: 'uniform vec3 uHabitatColor;',
    lights: /* glsl */ `
${SUN_EXPOSURE_GLSL}
float habitatSlope = degrees(acos(clamp(normalize(vStudyWorldNormal).y, -1.0, 1.0)));
float shelter = 1.0 - smoothstep(
  uHabitatExposure - ${float(STUDY_CONSTANTS.habitatExposureSoftness)},
  uHabitatExposure + ${float(STUDY_CONSTANTS.habitatExposureSoftness)},
  habitatExposure
);
float footing = 1.0 - smoothstep(
  uHabitatSlope - ${float(STUDY_CONSTANTS.habitatSlopeSoftness)},
  uHabitatSlope + ${float(STUDY_CONSTANTS.habitatSlopeSoftness)},
  habitatSlope
);
float studyTerm = shelter * footing;
`,
    lit: /* glsl */ `
outgoingLight = mix(
  outgoingLight,
  uHabitatColor * ${float(STUDY_CONSTANTS.habitatGlow)},
  studyTerm * ${float(STUDY_CONSTANTS.habitatOverlay)}
);
outgoingLight = drawLine(outgoingLight, isoLine(studyTerm, 0.5, 1.2) * uGuides, 0.7);
`,
  },

  growth: {
    uniforms: () => ({
      uGrowthGrown: color(STUDY_COLORS.growthGrown),
      uGrowthFront: color(STUDY_COLORS.growthFront),
    }),
    vertexHead: `attribute float ${GROWTH_AGE_ATTRIBUTE};\nvarying float vGrowthAge;`,
    vertex: `vGrowthAge = ${GROWTH_AGE_ATTRIBUTE};`,
    fragmentHead: 'uniform vec3 uGrowthGrown;\nuniform vec3 uGrowthFront;\nvarying float vGrowthAge;',
    albedo: /* glsl */ `
float growthAa = max(fwidth(vGrowthAge), 1e-4);
float studyTerm = 1.0 - smoothstep(uGrowthProgress - growthAa, uGrowthProgress + growthAa, vGrowthAge);
float growthYoung = studyTerm * (1.0 - smoothstep(0.0, max(uGrowthEdge, 1e-3), uGrowthProgress - vGrowthAge));
diffuseColor.rgb = uGrowthShowField > 0.5
  ? pow(vec3(vGrowthAge), vec3(2.2))
  : mix(diffuseColor.rgb, uGrowthGrown, studyTerm);
`,
    lit: /* glsl */ `
outgoingLight = mix(outgoingLight, uGrowthFront, growthYoung * ${float(STUDY_CONSTANTS.growthFrontOverlay)});
float growthRings = contourLine(vGrowthAge, ${float(STUDY_CONSTANTS.growthRingSpacing)}, 1.0) * step(1e-3, vGrowthAge);
outgoingLight = drawLine(outgoingLight, growthRings * studyTerm * uGuides, 0.35);
outgoingLight = drawLine(outgoingLight, isoLine(vGrowthAge, uGrowthProgress, 1.4) * step(1e-3, uGrowthProgress) * uGuides, 0.9);
`,
  },

  exposure: {
    uniforms: () => ({
      uExposurePatina: color(STUDY_COLORS.patina),
      uExposureBleached: color(STUDY_COLORS.bleached),
    }),
    vertexHead: `attribute float ${CONVEXITY_ATTRIBUTE};\nvarying float vConvexity;`,
    vertex: `vConvexity = ${CONVEXITY_ATTRIBUTE};`,
    fragmentHead: `uniform vec3 uExposurePatina;\nuniform vec3 uExposureBleached;\nvarying float vConvexity;\n${NOISE_GLSL}`,
    albedo: /* glsl */ `
float exposureSky = 0.5 * normalize(vStudyWorldNormal).y + 0.5;
float exposureField = 0.5 * exposureSky + 0.5 * vConvexity;
float exposureOnset = 1.0 - uExposure;
float studyTerm = smoothstep(exposureOnset, exposureOnset + ${float(STUDY_CONSTANTS.exposureSoftness)}, exposureField) * uWeathering;
float exposurePits = smoothstep(0.55, 0.85, valueNoise(vStudyWorldPos * ${float(STUDY_CONSTANTS.exposurePitScale)})) * studyTerm;
diffuseColor.rgb = uExposureShowField > 0.5
  ? pow(vec3(exposureField), vec3(2.2))
  : mix(uExposurePatina, uExposureBleached, studyTerm) * (1.0 - ${float(STUDY_CONSTANTS.exposurePitShade)} * exposurePits);
`,
    roughness: 'roughnessFactor = mix(0.7, 1.0, studyTerm);',
    normal: /* glsl */ `
{
  float bumpHeight = -exposurePits * ${float(STUDY_CONSTANTS.exposurePitRelief)};
  vec3 dpdx = dFdx(-vViewPosition);
  vec3 dpdy = dFdy(-vViewPosition);
  vec3 r1 = cross(dpdy, normal);
  vec3 r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dFdx(bumpHeight) * r1 + dFdy(bumpHeight) * r2);
  normal = normalize(abs(det) * normal - grad);
}
`,
    lit: /* glsl */ `
outgoingLight = drawLine(outgoingLight, isoLine(exposureField, exposureOnset, 1.2) * uGuides, 0.6);
`,
  },
}

/**
 * Floor half of the Contact study: a dark graphite ground under the specimen.
 * Same rule as the specimen, with the gap read from the footprint field: the
 * horizontal distance to the nearest point where the form touches the floor.
 * Guides: faint rings every quarter of d, and a firmer one where the gap
 * reaches d. Ground and rings fade into the black background toward the rim.
 */
export const CONTACT_FLOOR_SHADER: SurfaceShader = {
  uniforms: () => ({
    uFootprintGap: { value: null },
    uFootprintGapRange: { value: 1 },
    uFootprintFieldSize: { value: 1 },
  }),
  fragmentHead: /* glsl */ `
uniform sampler2D uFootprintGap;
uniform float uFootprintGapRange;
uniform float uFootprintFieldSize;
`,
  albedo: /* glsl */ `
float contactGap = texture2D(uFootprintGap, vStudyWorldPos.xz / uFootprintFieldSize + 0.5).r * uFootprintGapRange;
float studyTerm = pow(1.0 - clamp(contactGap / uContactDistance, 0.0, 1.0), ${float(STUDY_CONSTANTS.contactFalloff)}) * uContactStrength;
float contactPlate = 1.0 - smoothstep(${float(STUDY_CONSTANTS.contactPlateInner)}, ${float(STUDY_CONSTANTS.contactPlateOuter)}, length(vStudyWorldPos.xz));
`,
  lit: /* glsl */ `
outgoingLight *= (1.0 - studyTerm) * contactPlate;
float contactRings = contourLine(contactGap, uContactDistance * 0.25, 1.0)
  * smoothstep(0.0, uContactDistance * 0.125, contactGap)
  * step(contactGap, uContactDistance * 0.875);
float contactGuide = contactPlate * uGuides;
outgoingLight = drawLine(outgoingLight, contactRings * contactGuide, ${float(STUDY_CONSTANTS.contactRingOpacity)});
outgoingLight = drawLine(outgoingLight, isoLine(contactGap, uContactDistance, 1.2) * contactGuide, ${float(STUDY_CONSTANTS.contactReachOpacity)});
`,
}

/** Studies that draw guide lines, where the Guides view tool applies. */
export const GUIDED_STUDIES: ReadonlySet<ShaderStudyId> = new Set([
  'height',
  'slope',
  'distance',
  'displacement',
  'contact',
  'habitat',
  'growth',
  'exposure',
])
