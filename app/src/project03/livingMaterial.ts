import { DoubleSide, MeshDepthMaterial, MeshStandardMaterial, RGBADepthPacking } from 'three'
import { wetness } from './environment.ts'
import { applyMist } from './mist.ts'

/**
 * Grown2's material: a standard material whose colour and relief read the growth record stored on each vertex
 * (`aGrowthA` = birth, vitality, stress, seam; `aGrowthB` = light, wet, unit, deposit; see livingGrowth2.ts).
 * Ideas taken from 0.2's architecture shader, driven here by the organism's own history instead of a lattice:
 *
 *   rings      iso-lines of birth time, drawn as a band that brightens toward its younger edge and ends in a thin dark
 *              seam, and as a stepped bump: the surface shows where the growth front stood, pulse by pulse
 *   age        pale bone where young, a little grayer where old; old, lit tops bleach
 *   vitality   chalky as it falls, charcoal as it fails (nothing here is failing yet; the ink is ready)
 *   stress     a warm tint and hairline cracks where the load path has been asked for the most
 *   seams      a slightly paler crest along the arteries that carry the income
 *   moisture   a cool stain low on the piers and wherever the ground is wet; rain streaks run down the sides of old,
 *              lit faces; the weather's wetness darkens and glosses it
 *
 * Mist and fog are the terrain's (applyMist). The palette stays pale and mineral.
 *
 * Lifecycle (the Overhang's, see livingLife.ts). `livingAge` is the organism's age; a geometry that carries `aArrival`
 * (when its tissue arrived) and `aDecay` (when it recedes) is drawn for that age:
 *
 *   young      tissue that arrived less than YOUTH ago is paler, warmer and smoother (its rings not yet laid down), and
 *              a thin brighter band marks the growth front itself; it mineralises into the mature colour as it ages
 *   dying      tissue about to recede turns chalky and dull just before it goes; the surface it leaves is darker and
 *              damper for a while, then weathers to the mature colour
 *
 * The default age is far past maturity and geometries without the attributes read them as 0 and NEVER, so every other
 * variant, and the Overhang without an age, are drawn exactly as before.
 */
/** The organism's age for the lifecycle treatment (0…1; the default is mature). Shared by every grown material. */
export const livingAge = { value: 10 }
const NOISE = /* glsl */ `
float gh(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float gvn(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(gh(i), gh(i + vec3(1.0, 0.0, 0.0)), f.x), mix(gh(i + vec3(0.0, 1.0, 0.0)), gh(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(gh(i + vec3(0.0, 0.0, 1.0)), gh(i + vec3(1.0, 0.0, 1.0)), f.x), mix(gh(i + vec3(0.0, 1.0, 1.0)), gh(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z
  );
}`

/*
 * GROWTH. One mesh, the mature one, at every age. Each vertex carries when its tissue arrives (aArrival, in age) and how far
 * inside the surface the tissue's middle lies (aHalf, metres). At an age the tissue that has not yet arrived is not drawn,
 * and the tissue that has just arrived is drawn collapsed toward its middle, a thin leading edge that thickens to its full
 * form over GROWTH_SPAN of age as the front moves on (the collapse is capped at 1.6 m: a larger one stretches triangles that
 * span two parts' different arrival times into shards; the front is a cut-open shell whose inside is drawn as the section): so shelves extend and thicken, the keep rises, and nothing is
 * rebuilt or swapped. At the mature age every vertex is exactly where the reference put it.
 */
const GROWTH_SPAN = '0.07'
const GROWTH_VERTEX = `uniform float uAge;
uniform float uGrow;
attribute float aHalf;
`
const GROWTH_DISPLACE = `  if (uGrow > 0.5) {
    float gg = smoothstep(0.0, ${GROWTH_SPAN}, uAge - aArrival);
    transformed -= normal * min(aHalf, 1.6) * (1.0 - gg);
  }`

/** The depth material for the growth shader's shadows: the same collapse and cut, so a young organism casts a young shadow. */
export function createGrownDepthMaterial(age: { value: number }, grow: { value: number }) {
  const material = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
  material.customProgramCacheKey = () => 'living-architecture-grown-depth'
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAge = age
    shader.uniforms.uGrow = grow
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${GROWTH_VERTEX}attribute float aArrival;\nvarying float vArrival;\nvoid main() {\n  vArrival = aArrival;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + GROWTH_DISPLACE)
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'uniform float uAge;\nuniform float uGrow;\nvarying float vArrival;\nvoid main() {\n  if (uGrow > 0.5 && vArrival > uAge) discard;')
  }
  return material
}

/*
 * LOFT (livingLoft.ts). Every vertex belongs to a ring of a part (aLoft = s along the part, phi around it, the part). The
 * shader places it from the part's nodes (their present radii are written each frame, for the age), then shrink-wraps it onto
 * the smooth union of every part's distance field: a vertex that lies just inside another part is drawn onto the blended
 * surface, one that lies deep inside is left there, hidden; so the parts merge, with fillets where they meet. The normal is the
 * blended surface's gradient. Strata are cut by world height afterwards, alike across all the parts.
 */
const LOFT_GLSL = `#define LK 12
#define LP 24
uniform vec4 uLoftA[288];
uniform vec4 uLoftB[288];
uniform vec4 uLoftInfo[24];
uniform vec4 uLoftRef[24];
uniform vec4 uLoftBound[24];
uniform int uLoftParts;
uniform float uStrata;
uniform float uGround;
attribute vec4 aLoft;
const float NT[12] = float[12](0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.88, 0.95, 1.0);

float smin2(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float segDist(vec3 q, int p, int j, float en) {
  vec4 a0 = uLoftA[p * LK + j];
  vec4 a1 = uLoftA[p * LK + j + 1];
  vec4 b0 = uLoftB[p * LK + j];
  vec4 b1 = uLoftB[p * LK + j + 1];
  vec3 ab = a1.xyz - a0.xyz;
  float ll = dot(ab, ab);
  float h = ll > 1e-6 ? clamp(dot(q - a0.xyz, ab) / ll, 0.0, 1.0) : 0.0;
  vec3 T = ll > 1e-6 ? ab * inversesqrt(ll) : vec3(0.0, 1.0, 0.0);
  vec3 d = q - (a0.xyz + ab * h);
  float rU = max(mix(a0.w, a1.w, h), 0.02);
  float rV = max(mix(b0.x, b1.x, h), 0.02);
  vec3 side = normalize(cross(uLoftRef[p].xyz, T));
  vec3 up2 = cross(T, side);
  float x = abs(dot(d, side)) / rU;
  float y = abs(dot(d, up2)) / rV;
  float pn = pow(pow(x, en) + pow(y, en), 1.0 / en);
  float sd = (pn - 1.0) * min(rU, rV);
  float ax = (h <= 0.0 || h >= 1.0) ? abs(dot(d, T)) : 0.0;
  return length(vec2(max(sd, 0.0), ax)) + min(sd, 0.0);
}

float sdfAll(vec3 q) {
  float F = 1e4;
  for (int p = 0; p < LP; p++) {
    if (p >= uLoftParts) break;
    vec4 inf = uLoftInfo[p];
    if (inf.w < 0.5) continue;
    vec4 bd = uLoftBound[p];
    if (distance(q, bd.xyz) > bd.w + 4.0) continue;
    float d = 1e4;
    for (int j = 0; j < LK - 1; j++) d = min(d, segDist(q, p, j, inf.x));
    F = smin2(F, d, 3.5);
  }
  return F;
}

vec3 sdfGrad(vec3 p) {
  const float e = 0.45;
  vec2 k = vec2(1.0, -1.0);
  vec3 g = k.xyy * sdfAll(p + k.xyy * e) + k.yyx * sdfAll(p + k.yyx * e) + k.yxy * sdfAll(p + k.yxy * e) + k.xxx * sdfAll(p + k.xxx * e);
  return dot(g, g) > 1e-10 ? normalize(g) : vec3(0.0, 1.0, 0.0);
}

vec3 loftPlace(float sRaw, float phi, int p) {
  vec4 inf = uLoftInfo[p];
  // The first 86% of the rings are the body; the last 14% are the dome that closes its tip.
  float body = min(sRaw / 0.86, 1.0);
  float capT = max(sRaw - 0.86, 0.0) / 0.14;
  float se = min(body, inf.z);
  int j = 0;
  for (int i = 0; i < LK - 2; i++) {
    if (se > NT[i + 1]) j = i + 1;
  }
  float t = (se - NT[j]) / (NT[j + 1] - NT[j]);
  vec4 a0 = uLoftA[p * LK + j];
  vec4 a1 = uLoftA[p * LK + j + 1];
  vec4 b0 = uLoftB[p * LK + j];
  vec4 b1 = uLoftB[p * LK + j + 1];
  vec3 centre = mix(a0.xyz, a1.xyz, t);
  float rU = mix(a0.w, a1.w, t);
  float rV = mix(b0.x, b1.x, t);
  vec3 T = normalize(a1.xyz - a0.xyz + vec3(1e-5));
  vec3 side = normalize(cross(uLoftRef[p].xyz, T));
  vec3 up2 = cross(T, side);
  float c = cos(phi);
  float sn = sin(phi);
  float e = 2.0 / inf.x;
  float x = sign(c) * pow(abs(c), e);
  float y = sign(sn) * pow(abs(sn), e);
  float th = capT * 1.5707963;
  float k = cos(th);
  return centre + side * (x * rU * k) + up2 * (y * rV * k) + T * (sin(th) * 0.45 * (rU + rV));
}

vec3 loftSurface() {
  int part = int(aLoft.z + 0.5);
  vec3 P = loftPlace(aLoft.x, aLoft.y, part);
  // A part that has not begun stays where it begins, inside what it grows from. Elsewhere what lies near the surface is drawn onto it.
  if (uLoftInfo[part].w > 0.5 && sdfAll(P) > -3.5) {
    for (int it = 0; it < 2; it++) {
      float F = sdfAll(P);
      P -= sdfGrad(P) * F;
    }
  }
  return P;
}

vec3 loftStrata(vec3 P, vec3 N) {
  float yy = (P.y - uGround) / 4.4 + 0.3 * sin(P.x * 0.09 + P.z * 0.06);
  return P + N * (uStrata * (0.5 - fract(yy)) * (1.0 - abs(N.y)));
}
`

/** The growth material for lofted parts: the grown material, its position and normal from the loft. */
export function createLoftMaterial(age: { value: number }, loft: Record<string, { value: unknown }>) {
  const material = createGrownMaterial(age)
  const base = material.onBeforeCompile
  material.customProgramCacheKey = () => 'living-architecture-loft-sdf'
  material.onBeforeCompile = (shader, renderer) => {
    base.call(material, shader, renderer)
    shader.uniforms.uLoftA = loft.nodeA!
    shader.uniforms.uLoftB = loft.nodeB!
    shader.uniforms.uLoftInfo = loft.info!
    shader.uniforms.uLoftRef = loft.ref!
    shader.uniforms.uLoftBound = loft.bound!
    shader.uniforms.uLoftParts = loft.parts!
    shader.uniforms.uStrata = loft.strata!
    shader.uniforms.uGround = loft.ground!
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${LOFT_GLSL}\nvoid main() {`)
      .replace('#include <beginnormal_vertex>', 'vec3 loftP = loftSurface();\n  vec3 loftN = sdfGrad(loftP);\n  loftP = loftStrata(loftP, loftN);\n  vec3 objectNormal = loftN;')
      .replace('#include <begin_vertex>', 'vec3 transformed = loftP;')
  }
  return material
}

export function createLoftDepthMaterial(loft: Record<string, { value: unknown }>) {
  const material = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
  material.customProgramCacheKey = () => 'living-architecture-loft-sdf-depth'
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLoftA = loft.nodeA!
    shader.uniforms.uLoftB = loft.nodeB!
    shader.uniforms.uLoftInfo = loft.info!
    shader.uniforms.uLoftRef = loft.ref!
    shader.uniforms.uLoftBound = loft.bound!
    shader.uniforms.uLoftParts = loft.parts!
    shader.uniforms.uStrata = loft.strata!
    shader.uniforms.uGround = loft.ground!
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${LOFT_GLSL}\nvoid main() {`)
      .replace('#include <begin_vertex>', 'vec3 loftP = loftSurface();\n  vec3 loftN = sdfGrad(loftP);\n  loftP = loftStrata(loftP, loftN);\n  vec3 transformed = loftP;')
  }
  return material
}

/**
 * `age` is the organism's own lifecycle age (each organism of a population has its own); `pick` lifts it a little when selected.
 * `dissolve` hands one mesh over to another without a flash: 2 draws it whole; between 0 and 1 it draws only that share of its
 * pixels (a fixed screen pattern: the share coming in), and between 0 and −1 all but that share (the share going out), so the
 * two meshes together always cover every pixel exactly once.
 * `grow` (1) draws the mesh as it is at its age by the growth shader (see GROWTH below): the same mesh at every age.
 */
export function createGrownMaterial(age: { value: number } = livingAge, pick: { value: number } = { value: 0 }, dissolve: { value: number } = { value: 2 }, grow: { value: number } = { value: 0 }) {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: DoubleSide })
  material.customProgramCacheKey = () => 'living-architecture-grown2-strata'
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRain = wetness
    shader.uniforms.uAge = age
    shader.uniforms.uPick = pick
    shader.uniforms.uDissolve = dissolve
    shader.uniforms.uGrow = grow
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', GROWTH_VERTEX + 'attribute vec4 aGrowthA;\nattribute vec4 aGrowthB;\nattribute float aArrival;\nattribute float aDecay;\nvarying vec4 vGrowA;\nvarying vec4 vGrowB;\nvarying vec2 vLife;\nvarying vec3 vGW;\nvarying vec3 vGN;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + GROWTH_DISPLACE)
      .replace('#include <color_vertex>', '#include <color_vertex>\n  vGrowA = aGrowthA;\n  vGrowB = aGrowthB;\n  vLife = vec2(aArrival, aDecay);\n  vGW = (modelMatrix * vec4(position, 1.0)).xyz;\n  vGN = normalize(mat3(modelMatrix) * normal);')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform float uRain;
uniform float uAge;
uniform float uPick;
uniform float uDissolve;
uniform float uGrow;
varying vec2 vLife;
varying vec4 vGrowA;
varying vec4 vGrowB;
varying vec3 vGW;
varying vec3 vGN;
${NOISE}
float gBump;
float gRough;
void main() {
  if (uGrow > 0.5 && vLife.x > uAge) discard;
  if (uDissolve < 1.5) {
    float dn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    if (uDissolve >= 0.0 ? dn > uDissolve : dn <= -uDissolve) discard;
  }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  {
    float gUp = clamp(vGN.y, 0.0, 1.0);
    float gSide = 1.0 - gUp;
    float gBirth = vGrowA.x;
    float gVital = vGrowA.y;
    float gStress = vGrowA.z;
    float gSeam = vGrowA.w;
    float gLight = vGrowB.x;
    float gWet = vGrowB.y;
    float gUnit = vGrowB.z;
    float gDep = vGrowB.w;
    float mot = gvn(vGW * 0.45) * 0.6 + gvn(vGW * 1.7) * 0.4;
    float age = 1.0 - gBirth;
    vec3 base = diffuseColor.rgb;
    // FUNCTIONAL PALETTE. Linear albedo, kept in the terrain's own range (0.25 to 0.5): the key light is strong and the tone mapping compresses it, so a pale
    // albedo reads as white and every difference between the parts is lost. The stone stands a little lighter than the ground, and the parts differ in hue as
    // well as value. Birth runs with height, so: the grounded base (first to arrive) is warm, weathered taupe-gray; the structure above it denser, cooler gray; the
    // shelves and upper growth (last to arrive) limestone, lighter where they face up and are exposed; the supports (the tissue carrying the most load) cool mineral gray.
    vec3 tone = mix(vec3(0.31, 0.265, 0.225), vec3(0.285, 0.305, 0.325), smoothstep(0.05, 0.38, gBirth));
    tone = mix(tone, vec3(0.57, 0.535, 0.45), smoothstep(0.38, 0.85, gBirth) * (0.5 + 0.5 * gUp));
    tone = mix(tone, vec3(0.27, 0.29, 0.315), smoothstep(0.15, 0.3, gStress) * 0.75);
    tone *= 0.88 + 0.24 * gLight * (0.4 + 0.6 * gUp);
    tone *= 0.92 + 0.16 * mot;
    base = mix(base, tone, 0.92);
    // Recesses and the undersides of the overhangs: the less light they get, the darker and the warmer and more weathered, never black.
    base *= 0.82 + 0.18 * smoothstep(0.05, 0.6, gLight);
    // In shadow the stone is cool mineral gray (the lit faces are the warm limestone and ivory).
    base = mix(base, base * vec3(0.9, 0.96, 1.06), (1.0 - smoothstep(0.1, 0.55, gLight)) * 0.45);
    // Lifecycle: how fresh this tissue is, the growth front, and whether it is about to recede or has just been exposed.
    float gSince = uAge - vLife.x;
    // Young tissue is only a little warmer and paler than the mature stone, and the change takes a long span of age: no white start.
    float gFresh = 1.0 - smoothstep(0.0, 0.3, gSince);
    float gFront = (1.0 - smoothstep(0.0, 0.02, abs(gSince))) * step(0.0005, vLife.x);
    float gDying = smoothstep(vLife.y - 0.1, vLife.y, uAge) * (1.0 - smoothstep(vLife.y, vLife.y + 0.04, uAge));
    float gExposed = step(vLife.y, uAge) * (1.0 - smoothstep(vLife.y + 0.04, vLife.y + 0.14, uAge));
    // Broad mineral strata: a few horizontal beds of birth (height), warped only at a geological scale.
    float rings = gBirth * 6.5 + (gvn(vGW * vec3(0.045, 0.015, 0.045)) - 0.5) * 0.32;
    float rf = fract(rings);
    // Where the contours crowd together (steep growth gradients) they would alias: fade them out there.
    float ringKeep = 1.0 - smoothstep(0.35, 0.9, fwidth(rings));
    // Young tissue has not laid its rings down yet.
    ringKeep *= 1.0 - 0.85 * gFresh;
    float seamLine = (1.0 - smoothstep(0.0, 0.11, rf)) * ringKeep;
    float ramp = 0.9 + 0.13 * rf;
    gBump = 0.052 * ringKeep * rf * rf * (1.0 - smoothstep(0.88, 1.0, rf)) * (0.4 + 0.6 * smoothstep(0.05, 0.4, gDep));
    // Age and bleaching.
    base = mix(base, base * vec3(0.95, 0.95, 0.93), smoothstep(0.1, 0.95, age + (mot - 0.5) * 0.3));
    float bleach = gUp * smoothstep(0.35, 0.9, gLight) * smoothstep(0.2, 0.9, age);
    float luma = dot(base, vec3(0.3333));
    base = mix(base, vec3(luma * 1.04), bleach * 0.12);
    // Vitality: chalky as it falls, charcoal as it fails.
    base = mix(base, vec3(luma * 0.8 + 0.02), smoothstep(0.62, 0.2, gVital) * 0.6);
    base = mix(base, vec3(0.34, 0.32, 0.29), smoothstep(0.3, 0.05, gVital) * 0.55);
    // Stress: a warm tint, and a few broad cracks only where the tissue is old and loaded. Not a uniform crack field.
    float st = smoothstep(0.18, 0.6, gStress);
    base = mix(base, base * vec3(1.0, 0.86, 0.72), st * 0.55);
    float cf = gvn(vGW * vec3(0.16, 0.08, 0.16) + gUnit * 1.4);
    float crackGate = smoothstep(0.64, 0.82, gvn(vGW * 0.04 + gUnit));
    float crack = (1.0 - smoothstep(0.0, 0.09, abs(cf - 0.5))) * smoothstep(0.5, 0.9, gStress) * smoothstep(0.4, 0.85, age) * crackGate;
    base *= 1.0 - crack * 0.06;
    base *= 1.0 + gSeam * 0.05;
    // Moisture and rain.
    base = mix(base, base * vec3(0.78, 0.82, 0.76), gWet * 0.55);
    float streak = smoothstep(0.58, 0.9, gvn(vGW * vec3(0.11, 0.03, 0.11) + gUnit));
    base *= 1.0 - gSide * streak * (0.08 + 0.11 * smoothstep(0.35, 0.95, age)) * (0.35 + 0.65 * gLight);
    base *= 0.96 + 0.08 * gUnit;
    // A slow mineral mottling, warm and cool, coarser than a crack. The beds sit on top of it.
    float mineral = gvn(vGW * vec3(0.04, 0.018, 0.04));
    base *= 0.88 + 0.2 * mineral;
    base = mix(base, base * vec3(1.06, 0.98, 0.9), (gvn(vGW * 0.085) - 0.5) * 0.55);
    base = mix(base * vec3(0.93, 0.92, 0.88), base, smoothstep(0.12, 0.82, gBirth));
    base *= (0.97 + 0.03 * rf) * (1.0 - seamLine * 0.06);
    base *= 1.0 - 0.1 * uRain * (0.5 + 0.5 * gUp);
    // Young: paler, warmer, smoother, the front a little brighter. Dying: chalky and dull. Just exposed: darker, damper.
    float gLuma = dot(base, vec3(0.3333));
    base = mix(base, base * vec3(1.1, 1.05, 0.92) + vec3(0.02, 0.015, 0.0), gFresh * 0.4);
    base *= 1.0 + 0.12 * gFront;
    base = mix(base, vec3(gLuma * 1.04 + 0.01), gDying * 0.3);
    base = mix(base, base * vec3(0.72, 0.74, 0.7), gExposed * 0.6);
    // Sedimentary strata, irregular: thick beds (about nine metres) and thin ones (about three) from smooth noise of height, the height warped across the body so
    // the beds tilt and undulate and do not run level, each bed a slightly different tone and warmth. Soft-edged, with no dark line between them.
    float strWarp = (gvn(vec3(vGW.x * 0.02, vGW.y * 0.03, vGW.z * 0.02)) - 0.5) * 7.0;
    float strH = vGW.y + strWarp;
    float strThick = smoothstep(0.38, 0.62, gvn(vec3(7.3, strH * 0.11, 2.1)));
    float strThin = smoothstep(0.44, 0.56, gvn(vec3(3.9, strH * 0.33, 8.4)));
    base *= 0.9 + 0.13 * strThick + 0.05 * strThin;
    base = mix(base, base * vec3(1.07, 1.0, 0.9), strThick * 0.45);
    // Selected: a faint lift only (the organism's marker on screen says which one it is).
    base = mix(base, base * 1.05 + vec3(0.008, 0.006, 0.0), uPick * 0.6);
    diffuseColor.rgb = base;
    // Where the growth front has cut the shell open, the inside seen through it reads as the section of solid tissue.
    if (uGrow > 0.5 && !gl_FrontFacing) diffuseColor.rgb = vec3(0.6, 0.55, 0.47);
    gRough = 0.86 + 0.12 * mot + 0.08 * smoothstep(0.62, 0.2, gVital) - 0.3 * uRain * (0.5 + 0.5 * gUp);
    gRough += 0.1 * gDying - 0.14 * gFresh;
  }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(gRough, 0.3, 1.0);')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  {
    vec3 sx = dFdx(-vViewPosition);
    vec3 sy = dFdy(-vViewPosition);
    vec3 r1 = cross(sy, normal);
    vec3 r2 = cross(normal, sx);
    float det = dot(sx, r1);
    vec3 grad = sign(det) * (dFdx(gBump) * r1 + dFdy(gBump) * r2);
    normal = normalize(abs(det) * normal - grad);
  }`,
      )
    applyMist(shader)
  }
  return material
}
