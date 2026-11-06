/**
 * Shadow Ecology 0.3 — VISUAL STUDY 03: Living Monochrome (Advanced settings → Visual experiments → Visual Study 03).
 *
 * A sculptural, near-monochrome island in which colour belongs to water and to ecological life:
 *   tone       the land on a three-stop ramp (warm off-white #E4E0D8, mineral grey #96948F, charcoal #333431), placed by what the ground is (bare rock and
 *              gravel light, meadow mid, woodland and moss darker) and, more so close up, by its own albedo, so its material detail survives
 *   stone      the architecture pale stone and neutral greys, with darker structural bands by height and its stressed, aged tissue toward charcoal
 *   plants     desaturated grey-green at their own value
 *   life       a muted botanical green (#739A55; small brighter growth #A9D238 close up) only where persistent ecological shade (archGround's raster: how much of the day the structures keep the sun
 *              off) meets living cover: moss and ground cover in the shade, plants growing in it, and a little moss on the structures' own shaded
 *              undersides. A moving cast shadow never turns anything green
 *   light      lit and unlit in neutral values (no blue or purple): lit faces keep a little modelling, the moving cast shadow is a neutral charcoal plane
 *              that keeps its midtones (never black), persistent shade a deeper tone with restrained marks close up
 *   lines      charcoal silhouettes (on the land only its ridges), the stone's creases and strata steps up close, plants outlined only close
 *   water      cobalt #0047AB, darker with depth, lighter and clearer toward the shore, where the pale bottom shows through (a colour treatment: the water
 *              stays an opaque surface)
 *   sky        the world's own black field and air, so the island keeps a clear silhouette
 * Creatures keep a little of their own colour, greyed. uMonoOn = 0 skips everything.
 */
export const monoUniforms = { uMonoOn: { value: 0 } }

export const MONO_HEAD = /* glsl */ `
uniform float uMonoOn;
const vec3 MONO_WHITE = vec3(0.776, 0.745, 0.687);
const vec3 MONO_GREY = vec3(0.305, 0.296, 0.275);
const vec3 MONO_CHAR = vec3(0.033, 0.034, 0.031);
const vec3 MONO_COBALT = vec3(0.0, 0.0648, 0.407);
const vec3 MONO_LIFE = vec3(0.171, 0.323, 0.091);
const vec3 MONO_GROWTH = vec3(0.397, 0.644, 0.04);
// The three-stop ramp: charcoal, mineral grey, off-white.
vec3 monoRamp(float t) { return t < 0.5 ? mix(MONO_CHAR, MONO_GREY, t * 2.0) : mix(MONO_GREY, MONO_WHITE, t * 2.0 - 2.0 * 0.5); }
`

export type MonoKind = 'terrain' | 'architecture' | 'plant' | 'water' | 'creature' | 'shell'

/** `world`: a GLSL vec3 of the fragment's world position, or null (then rebuilt from the view). `depth`: the water has its depth varying. */
export function monoChunk(kind: MonoKind, world: string | null, depth = false): string {
  // Where the material has no world position of its own (instanced plants, creatures), it is rebuilt from the view position.
  const P = world ?? 'transpose(mat3(viewMatrix)) * (-vViewPosition - viewMatrix[3].xyz)'
  const shade = `float mSh = 0.0;
      vec2 mU = (mP.xz + 2048.0) / 4096.0;
      if (mU.x > 0.0 && mU.y > 0.0 && mU.x < 1.0 && mU.y < 1.0) mSh = texture2D(uInkShade, mU).r;
      mSh = smoothstep(0.1, 0.45, mSh + (styNoise(mP.xz * 0.3) - 0.5) * 0.2);`
  if (kind === 'water') {
    return `
    if (uMonoOn > 0.5) {
      vec3 mP = ${P};
      ${shade}
      float mL = dot(outgoingLight, INK_LUMA);
      // Depth: from the water's own depth where it has one, otherwise from its value.
      float mD = ${depth ? 'vWaterDepth' : '3.0 * smoothstep(0.25, 0.02, mL)'};
      float mShallow = 1.0 - smoothstep(0.0, 1.8, mD);
      // Cobalt, darker with depth, lighter and clearer toward the shore; the pale bottom shows through the last few decimetres.
      // (Cobalt at a value of its own: the water's light sets it, deep water at under half of it, shallows lifted.)
      vec3 mHue = mix(MONO_COBALT, vec3(0.25, 0.5, 0.85), 0.55 * mShallow);
      float mV = clamp(mL * 1.3, 0.05, 0.35) * mix(0.45, 1.0, 1.0 - smoothstep(1.2, 6.0, mD)) * (1.0 + 0.6 * mShallow);
      vec3 mW = ilAt(mHue, mV);
      mW = mix(mW, MONO_WHITE * mV * 0.9, (1.0 - smoothstep(0.0, 0.5, mD)) * 0.55);
      // Glints keep their own light where they are near white.
      float mCh = (max(outgoingLight.r, max(outgoingLight.g, outgoingLight.b)) - min(outgoingLight.r, min(outgoingLight.g, outgoingLight.b))) / max(1e-4, max(outgoingLight.r, max(outgoingLight.g, outgoingLight.b)));
      mW = mix(mW, outgoingLight, smoothstep(0.4, 0.9, mL) * (1.0 - smoothstep(0.2, 0.5, mCh)) * 0.7);
      // A pool the structures keep in shade is stiller and darker.
      outgoingLight = mW * (1.0 - 0.25 * mSh);
    }`
  }
  const arch = kind === 'architecture'
  const terrain = kind === 'terrain'
  const plant = kind === 'plant'
  const tone = terrain
    ? `// The ground's place on the ramp: from what it is (rock and gravel light, meadow mid, woodland and moss darker) and, more so close up, from its own albedo.
      float mSteep = 1.0 - smoothstep(0.55, 0.85, mWn.y);
      // (Mostly mid greys: off-white only for the lightest bare rock and gravel; darker for woodland, moss and cover.)
      float mT = mix(0.5, 0.58, mSteep);
      mT = mix(mT, 0.64, vgMat.a * 0.85);
      mT = mix(mT, 0.38, vgMat.b * 0.85);
      mT = mix(mT, 0.24, vgMat.r * 0.9);
      mT = mix(mT, 0.3, vgMat.g * 0.85);
      mT = mix(mT, 0.3, vgTint.a);
      // The ground's own value carries most of its variation (woodland and moss dark, meadow and bare rock lighter), stretched onto the ramp.
      float mOwn = mix(0.18, 0.74, smoothstep(0.3, 0.66, sqrt(mAL)));
      mT = mix(mT, mOwn, 0.6 + 0.2 * mNear);
      // Broad, slow swells of tone, so the land carries mid-grey variation rather than one even sheet.
      mT += (styNoise(mP.xz / 160.0 + 7.0) - 0.5) * 0.14 + (styNoise(mP.xz / 45.0) - 0.5) * 0.06;
      vec3 mC = monoRamp(clamp(mT, 0.0, 1.0));
      // Life: living cover (moss, woodland floor, plant cover) where the structures keep persistent shade, in irregular patches.
      float mCover = max(max(vgMat.g, vgMat.r * 0.7), max(vgTint.a, vgMat.b * 0.4));
      float mLife = mSh * (0.35 + 0.65 * smoothstep(0.1, 0.4, mCover)) * smoothstep(0.35, 0.65, styNoise(mP.xz * 0.12) * 0.55 + styNoise(mP.xz * 0.5 + 4.0) * 0.45 + 0.1);
      // A muted green at about the ground's own value, broken up so it never lies as a flat sheet; small brighter growth close up.
      mC = mix(mC, ilAt(MONO_LIFE, max(dot(mC, INK_LUMA) * 0.95, 0.06)) * (0.85 + 0.3 * styNoise(mP.xz * 0.9 + 2.0)), mLife * 0.6);
      float mGrowth = mLife * mNear * smoothstep(0.72, 0.86, styNoise(mP.xz * 2.3 + 9.0));
      mC = mix(mC, ilAt(MONO_GROWTH, max(dot(mC, INK_LUMA) * 1.15, 0.08)), mGrowth * 0.7);
      mC = mix(diffuseColor.rgb, mC, 1.0 - vgOverA);`
    : arch
      ? `// Pale stone and neutral greys, darker structural bands by height, stressed and aged tissue toward charcoal.
      float mT = 0.48 + 0.34 * smoothstep(0.04, 0.5, mAL);
      float mBand = smoothstep(0.58, 0.7, styNoise(vec2(mP.y * 0.28, 0.0) + mP.xz * 0.015));
      mT -= 0.24 * mBand;
      mT -= 0.35 * smoothstep(0.06, 0.25, mAlb.r - mAlb.b);
      vec3 mC = monoRamp(clamp(mT, 0.05, 0.95));
      // A little moss on the structure's own persistently shaded undersides and walls.
      float mDown = 1.0 - smoothstep(-0.2, 0.45, mWn.y);
      float mLife = mSh * mDown * smoothstep(0.55, 0.75, styNoise(mP.xz * 0.4 + mP.y * 0.3));
      mC = mix(mC, ilAt(MONO_LIFE, max(dot(mC, INK_LUMA) * 0.9, 0.06)), mLife * 0.55);`
      : plant
        ? `// Desaturated grey-green at the plant's own value; in persistent shade, its living yellow-green.
      vec3 mC = ilAt(mix(vec3(0.5), vec3(0.42, 0.5, 0.4), 0.8), mAL);
      float mLife = smoothstep(0.1, 0.6, mSh);
      mC = mix(mC, ilAt(MONO_LIFE, max(mAL * 1.1, 0.05)), mLife * 0.7);`
        : kind === 'shell'
          ? 'vec3 mC = monoRamp(clamp(sqrt(mAL) * 1.1, 0.1, 0.8));'
          : 'vec3 mC = mix(vec3(mAL), mAlb, 0.3);'
  const lines = `
      float mLine = 0.0;
      float mNdv = abs(dot(mN, normalize(vViewPosition)));
      float mSil = 1.0 - smoothstep(1.0, 2.4, mNdv / max(fwidth(mNdv), 1e-5));
      ${terrain ? 'mLine = mSil * 0.4;' : arch ? 'mLine = mSil * 0.9;' : kind === 'shell' ? '' : `mLine = mSil * ${plant ? '0.55' : '0.8'} * (1.0 - smoothstep(${plant ? '40.0, 220.0' : '60.0, 400.0'}, mDist));`}
      ${arch
        ? `mLine = max(mLine, smoothstep(0.18, 0.5, length(fwidth(mWn))) * 0.65);
      mLine = max(mLine, smoothstep(0.12, 0.35, fwidth(mAL) / mAL) * 0.5 * mNear);`
        : ''}
      mCol = mix(mCol, MONO_CHAR * (0.4 + 0.6 * mLitV), clamp(mLine * (0.7 + 0.3 * styNoise(mP.xz * 0.2 + mP.y * 0.3)), 0.0, 1.0));`
  const marks =
    terrain || arch
      ? `
      {
        // Restrained marks: only in persistent shade and the deepest unlit faces, only close up, following the surface.
        vec2 mPlane;
        vec2 mDir;
        ${arch
          ? `vec3 mA = abs(mWn);
        mPlane = mA.x > mA.y && mA.x > mA.z ? mP.zy : mA.y > mA.z ? mP.xz : mP.xy;
        mDir = mA.y > max(mA.x, mA.z) ? vec2(0.8, 0.6) : vec2(1.0, 0.04);`
          : `mPlane = mP.xz;
        float mS = length(mWn.xz);
        mDir = normalize(mix(vec2(0.7071, 0.7071), mWn.xz / max(mS, 1e-4), smoothstep(0.08, 0.25, mS)));`}
        mDir = ilTurn(mDir, (styNoise(mPlane * 0.04) - 0.5) * 1.2);
        float mDark = max(mSh, (1.0 - mLit) * 0.5);
        float mH = styStrokes(mPlane * 1.3, mDir) * smoothstep(0.3, 0.7, mDark) * smoothstep(0.35, 0.7, styNoise(mPlane * 0.09 + 3.0));
        mCol *= 1.0 - 0.35 * mNear * min(mH, 1.0);
      }`
      : ''
  return `
    if (uMonoOn > 0.5) {
      vec3 mAlb = max(diffuseColor.rgb, vec3(1e-4));
      float mAL = max(1e-3, dot(mAlb, INK_LUMA));
      vec3 mN = normalize(normal);
      vec3 mWn = inverseTransformDirection(mN, viewMatrix);
      float mDist = length(vViewPosition);
      vec3 mP = ${P};
      float mFoot = ${world ? 'length(fwidth(mP))' : 'mDist * 0.0015'};
      float mNear = 1.0 - smoothstep(0.06, 0.45, mFoot);
      float mNdl = 0.0;
      float mKey = 0.0;
      #if NUM_DIR_LIGHTS > 0
        mNdl = dot(mN, directionalLights[0].direction);
        mKey = dot(directionalLights[0].color, INK_LUMA) * RECIPROCAL_PI;
      #endif
      float mVis = 1.0;
      #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
      if (receiveShadow) {
        DirectionalLightShadow mDs = directionalLightShadows[0];
        mVis = getShadow(directionalShadowMap[0], mDs.shadowMapSize, mDs.shadowIntensity, mDs.shadowBias, mDs.shadowRadius, vDirectionalShadowCoord[0]);
      }
      #endif
      // Light in neutral values only: the rest of the scene's light (sky, fill) without the sun's share, as a value.
      float mOther = max(0.0, dot(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse, INK_LUMA) / mAL - mKey * max(mNdl, 0.0) * mVis);
      ${shade}
      ${arch ? 'mSh *= 1.0 - smoothstep(-0.2, 0.45, mWn.y);' : ''}
      ${tone}
      // Lit and unlit, a clear step; lit faces keep a little modelling; the moving shadow a neutral plane that keeps its midtones.
      float mLit = smoothstep(${plant ? '0.25, 0.75' : '0.42, 0.58'}, clamp(mNdl * 4.0, 0.0, 1.0) * mVis);
      float mNd = clamp(mNdl * 1.6, 0.0, 1.0);
      float mLitV = mOther + mKey * (${plant ? '0.35 + 0.65' : arch ? '0.6 + 0.4' : '0.4 + 0.6'} * mNd);
      float mShdV = mix(0.45 * mLitV, mOther, 0.3);
      vec3 mCol = mC * mix(mShdV, mLitV, mLit);
      ${terrain || arch ? `// Persistent shade: a deeper tone (its living colour, above, kept brighter than the stone around it).
      mCol *= 1.0 - 0.32 * mSh * (1.0 - 0.6 * mLife);` : ''}${marks}${lines}
      outgoingLight = mCol + totalEmissiveRadiance;
    }`
}
