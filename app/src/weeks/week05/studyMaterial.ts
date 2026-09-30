import type { IUniform, Texture } from 'three'
import { createSurfaceMaterial, type SurfaceMaterial } from '../../shared/shaders/surfaceMaterial.ts'
import {
  defaultStudyValues,
  getStudy,
  STUDY_COLORS,
  type ShaderStudyId,
  type StudyValues,
} from './studies.ts'
import { CONTACT_FLOOR_SHADER, STUDY_SHADERS } from './studyShaders.ts'
import { FOOTPRINT_FIELD_SIZE, FOOTPRINT_GAP_RANGE } from './specimen.ts'

export type StudyMaterial = SurfaceMaterial

/**
 * Builds the specimen material for one study. The rule is injected into a
 * matte MeshStandardMaterial, so light still reveals the form and the rule
 * only changes what it names. Switching study builds a new material.
 * `uGuides` (1 on) scales the study's explanatory linework.
 */
export function createStudyMaterial(id: ShaderStudyId): StudyMaterial {
  return createSurfaceMaterial(STUDY_SHADERS[id], {
    cacheKey: id,
    color: STUDY_COLORS.stone,
    params: { ...defaultStudyValues(getStudy(id)), uGuides: 1 },
  })
}

export function applyStudyValues(uniforms: Record<string, IUniform>, values: StudyValues) {
  for (const [name, value] of Object.entries(values)) {
    if (uniforms[name]) {
      uniforms[name].value = value
    }
  }
}

/** Term view: replaces the shaded result with the rule's scalar, unlit. */
export function setShowTerm(uniforms: Record<string, IUniform>, showTerm: boolean) {
  uniforms.uShowTerm.value = showTerm ? 1 : 0
}

/** Guides view tool: shows or hides the study's explanatory lines; the result is unchanged. */
export function setGuides(uniforms: Record<string, IUniform>, guides: boolean) {
  uniforms.uGuides!.value = guides ? 1 : 0
}

/** Advances `uTime` for studies that animate; a no-op for the rest. */
export function advanceStudyTime(uniforms: Record<string, IUniform>, delta: number) {
  if (uniforms.uTime) {
    uniforms.uTime.value += delta
  }
}

/**
 * Floor plate for the Contact study. It shares the specimen's contact and
 * Term-view uniforms, so one set of controls drives both halves.
 */
export function createContactFloorMaterial(
  uniforms: Record<string, IUniform>,
  footprintGap: Texture,
): StudyMaterial {
  const floor = createSurfaceMaterial(CONTACT_FLOOR_SHADER, {
    cacheKey: 'contact-floor',
    color: STUDY_COLORS.contactFloor,
    params: { uContactDistance: 0, uContactStrength: 0, uGuides: 1 },
  })
  // Replaced before the first compile, which reads this record.
  Object.assign(floor.uniforms, {
    uContactDistance: uniforms.uContactDistance,
    uContactStrength: uniforms.uContactStrength,
    uShowTerm: uniforms.uShowTerm,
    uGuides: uniforms.uGuides,
  })
  floor.uniforms.uFootprintGap!.value = footprintGap
  floor.uniforms.uFootprintGapRange!.value = FOOTPRINT_GAP_RANGE
  floor.uniforms.uFootprintFieldSize!.value = FOOTPRINT_FIELD_SIZE
  return floor
}
