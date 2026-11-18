import { Color, MeshLambertMaterial, SRGBColorSpace, type Side } from 'three'

/**
 * Style C — Composition study: neutral greys that judge form, framing and value structure apart from any rendering style.
 *
 *   silhouette  each kind of thing is one flat grey (architecture black, plants dark, ground and water light, sky white): tests the shapes only
 *   values      four values from the light itself: lit, turned (the face looks away from the sun), cast (the sun is blocked) and deep (persistent
 *               shade: under a roof, the undersides of shelves). Each kind keeps its own step on the scale, so masses still separate.
 *   clay        a neutral modelling material: a directional key (with soft shadows), a sky fill that falls off on faces turned down, a little bounce
 *               from the ground onto undersides, and ambient occlusion (aOcc, baked from the form's own distance field). Continuous tone, so
 *               curvature, thickness, junctions and the depth of the undercroft read as volume rather than as steps.
 *
 * Distance fades to the horizon grey (the scene's fog): atmospheric depth is part of the value structure being judged.
 * All values are display (sRGB) greys, 0 black to 1 white.
 */
export type NotanMode = 'silhouette' | 'values' | 'clay'
export type NotanKind = 'architecture' | 'ground' | 'plant'

/** The value scale. Change it here and every plate follows. */
export const VALUES = {
  sky: { top: 0.7, horizon: 0.85 },
  silhouette: { architecture: 0.06, plant: 0.32, ground: 0.8, water: 0.9 },
  // lit, turned, cast, deep
  architecture: [0.93, 0.6, 0.44, 0.2],
  ground: [0.8, 0.56, 0.42, 0.18],
  plant: [0.5, 0.36, 0.3, 0.16],
  water: 0.88,
  // clay albedo (display value): the architecture lightest, so its form leads; the ground a step down; plants darker masses
  clay: { architecture: 0.9, ground: 0.7, plant: 0.5, water: 0.78 },
} as const

export const notanUniforms = { uMode: { value: 1 } }
export const MODE_INDEX: Record<NotanMode, number> = { silhouette: 0, values: 1, clay: 2 }

const toLin = (v: number) => new Color().setRGB(v, v, v, SRGBColorSpace).r

export function fogGrey() {
  return new Color().setRGB(VALUES.sky.horizon, VALUES.sky.horizon, VALUES.sky.horizon, SRGBColorSpace)
}

export function notanMaterial(kind: NotanKind, { side }: { side?: Side } = {}) {
  const m = new MeshLambertMaterial({ color: '#ffffff', ...(side !== undefined ? { side } : {}) })
  const v = VALUES[kind]
  const flat = VALUES.silhouette[kind]
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, notanUniforms, {
      uVals: { value: v.map(toLin) },
      uFlat: { value: toLin(flat) },
      uWater: { value: toLin(VALUES.water) },
      uWaterFlat: { value: toLin(VALUES.silhouette.water) },
      uClay: { value: VALUES.clay[kind] },
      uClayWater: { value: VALUES.clay.water },
    })
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      'attribute float aDeep;\nattribute float aWater;\nattribute float aOcc;\nvarying float vDeep;\nvarying float vWater;\nvarying float vOcc;\nvoid main() {\n  vDeep = aDeep;\n  vWater = aWater;\n  vOcc = aOcc;',
    )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'uniform float uMode;\nuniform float uVals[4];\nuniform float uFlat;\nuniform float uWater;\nuniform float uWaterFlat;\nuniform float uClay;\nuniform float uClayWater;\nvarying float vDeep;\nvarying float vWater;\nvarying float vOcc;\nvoid main() {',
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `{
          vec3 wn = inverseTransformDirection(normalize(normal), viewMatrix);
          float ndl = 0.0;
          #if NUM_DIR_LIGHTS > 0
            ndl = dot(normalize(normal), directionalLights[0].direction);
          #endif
          // The sun's share that arrives (shadows included), against what an unshadowed face at this angle would get.
          float sunSeen = clamp(reflectedLight.directDiffuse.r / max(ndl, 1e-3), 0.0, 1.0);
          float turned = 1.0 - smoothstep(0.02, 0.1, ndl);
          float castSh = (1.0 - turned) * (1.0 - smoothstep(0.35, 0.65, sunSeen));
          float deep = max(vDeep, ${kind === 'architecture' ? 'smoothstep(-0.25, -0.55, wn.y)' : '0.0'});
          float val = uVals[0];
          val = mix(val, uVals[2], castSh);
          val = mix(val, uVals[1], turned);
          // Deep shade stays deep whatever the hour, unless the sun reaches straight in (then it is merely cast).
          val = mix(val, uVals[3], step(0.5, deep) * (1.0 - (1.0 - turned) * (1.0 - castSh) * 0.6));
          float sil = uFlat;
          // Clay: key + sky fill + bounce, the fill and bounce occluded; tone is continuous.
          float key = max(ndl, 0.0) * sunSeen;
          float ao = 1.0 - clamp(vOcc, 0.0, 1.0);
          float sky = 0.6 + 0.4 * wn.y;
          float bounce = 0.3 * max(-wn.y, 0.0);
          float albedo = uClay;
          ${kind === 'ground' ? 'albedo = mix(albedo, uClayWater, step(0.5, vWater));' : ''}
          float clay = albedo * (0.55 * key + (0.42 * sky + bounce) * ao + 0.05);
          clay = pow(clamp(clay, 0.0, 1.0), 2.2);
          ${kind === 'ground' ? 'val = mix(val, uWater, step(0.5, vWater)); sil = mix(sil, uWaterFlat, step(0.5, vWater));' : ''}
          float outV = uMode < 0.5 ? sil : uMode < 1.5 ? val : clay;
          outgoingLight = vec3(outV);
        }
        #include <opaque_fragment>`,
      )
  }
  m.customProgramCacheKey = () => `notan-${kind}`
  return m
}
