import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Color, DataTexture, LinearFilter, RGBAFormat, SRGBColorSpace, Vector3 } from 'three'
import { PROJECT_COLORS } from '../../project/materials.ts'
import { SEED_POSITION, SHELTER_BOXES, shelterAt } from './environment.ts'
import {
  buildBiasGeometry,
  buildTraceLods,
  levelForDistance,
  type LodLevel,
  type LodMode,
  type LodStats,
  type TraceGeometry,
} from './traceMesh.ts'
import {
  createTraceDepthMaterial,
  createTraceLineMaterial,
  createTraceMaterial,
  createTraceUniforms,
  FIELD_STYLES,
  setTraceReveal,
  TRACE_COLORS,
} from './traceMaterial.ts'
import type { GrowthResponse, TraceModel } from './turtle.ts'

export type TraceOverlays = { field: boolean; bias: boolean }

/** Ground plate the specimen stands on. */
export const PLATE_RADIUS = 3
const PLATE_COLOR = '#262523'
const MASS_COLOR = PROJECT_COLORS.archFresh

/** The tip that narrows behind the front, as a share of the step length. */
const TIP_SHARE = 0.8
/** Tone spans this share of the longest path: older growth beyond it is fully aged. */
const AGE_SHARE = 0.7
/** Tropism vectors drawn this long at full strength. */
const BIAS_SCALE = 0.22

const FIELD_RES = 256
const FIELD_EXTENT = PLATE_RADIUS
const FIELD_LEVELS = [0.5, 0.8] as const

let shelterGrid: Float32Array | null = null

/** Shelter on the ground, sampled once. Texture rows run from the plane's +z edge (v = 0) to its −z edge once the plane lies flat. */
function groundShelter(): Float32Array {
  if (!shelterGrid) {
    shelterGrid = new Float32Array(FIELD_RES * FIELD_RES)
    const p = new Vector3()
    for (let j = 0; j < FIELD_RES; j++) {
      for (let i = 0; i < FIELD_RES; i++) {
        p.set(((i + 0.5) / FIELD_RES * 2 - 1) * FIELD_EXTENT, 0.02, (1 - ((j + 0.5) / FIELD_RES) * 2) * FIELD_EXTENT)
        shelterGrid[j * FIELD_RES + i] = shelterAt(p)
      }
    }
  }
  return shelterGrid
}

function createFieldTexture(response: GrowthResponse): DataTexture {
  const shelter = groundShelter()
  const style = FIELD_STYLES[response]
  const read = (k: number) => (response === 'light' ? 1 - shelter[k]! : shelter[k]!)
  const hex = new Color(style.color).getHex()
  const color = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
  const data = new Uint8Array(FIELD_RES * FIELD_RES * 4)
  for (let j = 0; j < FIELD_RES; j++) {
    for (let i = 0; i < FIELD_RES; i++) {
      const v = read(j * FIELD_RES + i)
      const right = read(j * FIELD_RES + Math.min(i + 1, FIELD_RES - 1))
      const down = read(Math.min(j + 1, FIELD_RES - 1) * FIELD_RES + i)
      const contour = FIELD_LEVELS.some((level) => (v - level) * (right - level) < 0 || (v - level) * (down - level) < 0)
      const k = (j * FIELD_RES + i) * 4
      data[k] = color[0]!
      data[k + 1] = color[1]!
      data[k + 2] = color[2]!
      data[k + 3] = contour ? style.contour : Math.round(v * style.wash)
    }
  }
  const texture = new DataTexture(data, FIELD_RES, FIELD_RES, RGBAFormat)
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

export function TraceGrowthScene({
  model,
  response,
  step,
  lodMode,
  manualLevel,
  progress,
  growing,
  overlays,
  wireframe,
  onLevel,
  onGeometry,
}: {
  model: TraceModel
  /** Which field the overlay draws. */
  response: GrowthResponse
  step: number
  lodMode: LodMode
  /** The level drawn in Manual. */
  manualLevel: LodLevel
  /** 0 seed … 1 fully grown. */
  progress: number
  growing: boolean
  overlays: TraceOverlays
  wireframe: boolean
  onLevel: (level: LodLevel) => void
  onGeometry: (stats: Record<LodLevel, LodStats>) => void
}) {
  const [autoLevel, setAutoLevel] = useState<LodLevel>('full')
  const level = lodMode === 'auto' ? autoLevel : manualLevel
  const autoRef = useRef(autoLevel)
  const target = useMemo(() => new Vector3(), [])

  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as { target?: Vector3 } | null
  useFrame(() => {
    if (lodMode !== 'auto') {
      return
    }
    const distance = camera.position.distanceTo(controls?.target ?? target)
    const next = levelForDistance(distance, autoRef.current)
    if (next !== autoRef.current) {
      autoRef.current = next
      setAutoLevel(next)
    }
  })

  const uniforms = useMemo(() => createTraceUniforms(), [])
  const materials = useMemo(
    () => ({
      tube: createTraceMaterial(uniforms),
      depth: createTraceDepthMaterial(uniforms),
      bias: createTraceLineMaterial(uniforms, { color: TRACE_COLORS.bias, opacity: 0.7, toned: false }),
    }),
    [uniforms],
  )
  useEffect(
    () => () => {
      Object.values(materials).forEach((material) => material.dispose())
    },
    [materials],
  )

  // Built once per grown organism: changing level only chooses which representation to draw.
  const lods = useMemo(() => buildTraceLods(model), [model])
  useEffect(
    () => () => {
      Object.values(lods).forEach((lod) => lod.tubes.dispose())
    },
    [lods],
  )
  const geometry = lods[level]
  const bias = useMemo(() => (overlays.bias ? buildBiasGeometry(model, BIAS_SCALE) : null), [model, overlays.bias])
  useEffect(() => () => bias?.dispose(), [bias])

  const field = useMemo(() => (overlays.field ? createFieldTexture(response) : null), [overlays.field, response])
  useEffect(() => () => field?.dispose(), [field])

  useEffect(() => {
    onLevel(level)
  }, [level, onLevel])
  useEffect(() => {
    const stats = (lod: TraceGeometry): LodStats => ({ triangles: lod.triangles, internodes: lod.internodes, pieces: lod.pieces })
    onGeometry({ full: stats(lods.full), reduced: stats(lods.reduced), skeleton: stats(lods.skeleton) })
  }, [lods, onGeometry])

  useFrame(() =>
    setTraceReveal(uniforms, {
      progress,
      maxArrival: model.maxArrival,
      tip: step * TIP_SHARE,
      ageSpan: Math.max(model.maxArrival * AGE_SHARE, 0.1),
      growing,
    }),
  )

  return (
    <group>
      <mesh
        geometry={geometry.tubes}
        material={materials.tube}
        material-wireframe={wireframe}
        customDepthMaterial={materials.depth}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      {bias ? <lineSegments geometry={bias} material={materials.bias} frustumCulled={false} /> : null}

      {SHELTER_BOXES.map((box, i) => {
        const size: [number, number, number] = [0, 1, 2].map((a) => box.max[a]! - box.min[a]!) as [number, number, number]
        const center: [number, number, number] = [0, 1, 2].map((a) => (box.max[a]! + box.min[a]!) / 2) as [
          number,
          number,
          number,
        ]
        return (
          <mesh key={i} position={center} castShadow receiveShadow>
            <boxGeometry args={size} />
            <meshStandardMaterial color={MASS_COLOR} roughness={0.95} wireframe={wireframe} />
          </mesh>
        )
      })}

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[PLATE_RADIUS, 96]} />
        <meshStandardMaterial color={PLATE_COLOR} roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <ringGeometry args={[PLATE_RADIUS - 0.006, PLATE_RADIUS, 128]} />
        <meshBasicMaterial color="#5a5852" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[SEED_POSITION.x, 0.002, SEED_POSITION.z]}>
        <ringGeometry args={[0.05, 0.058, 48]} />
        <meshBasicMaterial color={TRACE_COLORS.fresh} transparent opacity={0.6} />
      </mesh>
      {field ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
          <planeGeometry args={[FIELD_EXTENT * 2, FIELD_EXTENT * 2]} />
          <meshBasicMaterial map={field} transparent depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  )
}
