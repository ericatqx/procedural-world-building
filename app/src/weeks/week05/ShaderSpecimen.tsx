import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import {
  advanceStudyTime,
  applyStudyValues,
  createContactFloorMaterial,
  createStudyMaterial,
  FOOTPRINT_FIELD_SIZE,
  setGuides,
  setShowTerm,
  type ShaderStudyId,
  type Specimen,
  type StudyValues,
} from './index.ts'

const PROBE_COLOR = '#ff4a1c'

/** The selected specimen, shaded by the selected study's rule. */
export function ShaderSpecimen({
  specimen,
  studyId,
  values,
  showTerm,
  guides,
  wireframe,
}: {
  specimen: Specimen
  studyId: ShaderStudyId
  values: StudyValues
  showTerm: boolean
  /** Study guide lines (Guides view tool). */
  guides: boolean
  wireframe: boolean
}) {
  const study = useMemo(() => createStudyMaterial(studyId), [studyId])
  const contactFloor = useMemo(
    () =>
      studyId === 'contact' ? createContactFloorMaterial(study.uniforms, specimen.footprintGap) : null,
    [studyId, study, specimen],
  )

  useEffect(
    () => () => {
      study.material.dispose()
      study.depthMaterial?.dispose()
    },
    [study],
  )
  useEffect(() => () => contactFloor?.material.dispose(), [contactFloor])

  // Before the next frame, so a freshly built material never shows defaults.
  useLayoutEffect(() => {
    applyStudyValues(study.uniforms, values)
    setShowTerm(study.uniforms, showTerm)
    setGuides(study.uniforms, guides)
  }, [study, values, showTerm, guides])

  useFrame((_, delta) => advanceStudyTime(study.uniforms, delta))

  return (
    <>
      <mesh
        geometry={specimen.geometry}
        customDepthMaterial={study.depthMaterial ?? undefined}
        castShadow
        receiveShadow
      >
        <primitive object={study.material} attach="material" wireframe={wireframe} />
      </mesh>

      {contactFloor ? (
        // Just below y = 0: a specimen rim that eases onto the floor must win the depth test, or it fights the plate.
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -0.001, 0]}
          material={contactFloor.material}
          receiveShadow
        >
          <planeGeometry args={[FOOTPRINT_FIELD_SIZE, FOOTPRINT_FIELD_SIZE]} />
        </mesh>
      ) : null}

      {studyId === 'distance' ? (
        <mesh position={[values.uProbeX, values.uProbeY, 0]} renderOrder={10}>
          <sphereGeometry args={[0.035, 16, 12]} />
          <meshBasicMaterial color={PROBE_COLOR} toneMapped={false} depthTest={false} />
        </mesh>
      ) : null}
    </>
  )
}
