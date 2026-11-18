import type { MeshStandardMaterial } from 'three'
import { createGrownMaterial } from '../project03/livingMaterial.ts'

/**
 * The grown material of the world, drawn for the organism's age (the young are paler and warmer, the growth front a little
 * brighter, from the arrival each vertex carries; nothing is cut away: the mesh is already the organism at that age),
 * plus the lab's life: `live` (1 living tissue, 0 exposed mineral skeleton) and `dead` (how weathered and stained the mineral is).
 * Shaded and thin tissue dies first, so the skeleton shows through where the light is least. At live = 1 the colour is the world's own.
 * The strata themselves are the world's: broad and quiet. This only mixes in the mineral skeleton as the organism dies.
 */
export function createLifecycleMaterial(age: { value: number }, live: { value: number }, dead: { value: number }, pick: { value: number } = { value: 0 }, dissolve: { value: number } = { value: 2 }): MeshStandardMaterial {
  const material = createGrownMaterial(age, pick, dissolve, { value: 0 }) as MeshStandardMaterial
  const original = material.onBeforeCompile
  material.customProgramCacheKey = () => 'living-architecture-grown2-lab-life-strata'
  material.onBeforeCompile = (shader, renderer) => {
    original.call(material, shader, renderer)
    shader.uniforms.uLive = live
    shader.uniforms.uDead = dead
    shader.fragmentShader = shader.fragmentShader
      .replace('uniform float uRain;', 'uniform float uRain;\nuniform float uLive;\nuniform float uDead;')
      .replace(
        '    diffuseColor.rgb = base;',
        `    if (uLive < 0.999) {
      // Where the living skin is gone the mineral skeleton shows: dark and weathered while it stands (senescence), mid as it fails (death),
      // pale, dry and cracked in the remains. Shaded and thin tissue goes first.
      float lv = clamp(uLive * 1.45 - (1.0 - gLight) * 0.5 - (1.0 - gVital) * 0.25 + (mot - 0.5) * 0.3, 0.0, 1.0);
      lv = smoothstep(0.15, 0.85, lv);
      // The skeleton is the same stone, drier, and it bleaches as it ages: weathered stone in senescence, then progressively toward bone-white as it dies and its remains weather.
      vec3 dark = vec3(0.42, 0.39, 0.34) * (0.92 + 0.16 * mot);
      vec3 pale = vec3(0.84, 0.81, 0.72) * (0.95 + 0.08 * mot);
      vec3 mineral = mix(dark, mix(vec3(0.62, 0.58, 0.51), pale, smoothstep(0.5, 1.0, uDead)), smoothstep(0.08, 0.55, uDead));
      mineral = mix(mineral, mineral * vec3(0.82, 0.84, 0.8), gWet * 0.5 * (1.0 - smoothstep(0.6, 1.0, uDead)));
      mineral *= 1.0 - 0.16 * uDead * smoothstep(0.3, 0.9, gSide);
      float crackLine = (1.0 - smoothstep(0.0, 0.08, abs(gvn(vGW * vec3(0.14, 0.07, 0.14)) - 0.5))) * smoothstep(0.62, 0.84, gvn(vGW * 0.035));
      mineral *= 1.0 - 0.05 * crackLine * smoothstep(0.75, 1.0, uDead);
      // The tissue that is still alive bleaches with the rest as the organism ages: toward bone as uLive falls.
      vec3 bone = vec3(0.86, 0.83, 0.74);
      base = mix(mineral, mix(base, bone, (1.0 - uLive) * 0.45), lv);
    }
    diffuseColor.rgb = base;`,
      )
  }
  return material
}
