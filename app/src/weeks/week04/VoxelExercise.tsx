import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { loadLegacyConfig } from '../../shared/persistence/snapshots.ts'
import { PageSnapshots, type PageSnapshotAdapter } from '../../shared/ui/PageSnapshots.tsx'
import {
  AUTO_ROTATE_SPEED,
  CollapsibleRow,
  ControlField,
  ExerciseHeading,
  InstrumentPanel,
  PanelSection,
  Segmented,
  Slider,
  Toggle,
  ViewTools,
  type SegmentOption,
} from '../../shared/ui/instrument.tsx'
import { LearnToggle, LearnTour } from '../../shared/ui/learn.tsx'
import { createVoxelLearnSteps } from './learnSteps.tsx'
import {
  buildDensityVolume,
  createDensityStep,
  CSG_OP_OPTIONS,
  DEFAULT_VOXEL_SETTINGS,
  DENSITY_SHAPE_OPTIONS,
  LEGACY_VOXEL_CONFIG_IDS,
  meshBlocks,
  meshMarchingCubes,
  parseVoxelSettings,
  type CsgOp,
  type DensityShapeKind,
  type DensityStep,
  type MeshMode,
  type VoxelSettings,
} from './voxels/index.ts'
import '../../shared/ui/system.css'

const SCENE_BG = '#000000'

const KEY_LIGHT = {
  position: [3.5, 4.5, -1] as [number, number, number],
  intensity: 3,
  color: '#fff8ec',
}

const AMBIENT_INTENSITY = 0.2

/** Warm off-white matte; faces separate through the key light, not colour. */
const VOXEL_COLOR = '#ece6da'
const VOXEL_ROUGHNESS = 0.9

/** Standard axis colours, matching the X / Y / Z tones in the panel. */
const AXIS_LENGTH = 1.2
const AXIS_X_COLOR = '#ff5c5c'
const AXIS_Y_COLOR = '#6ee07a'
const AXIS_Z_COLOR = '#5c8cff'

const CHUNK_LINE_COLOR = '#e9e6df'
const CHUNK_LINE_OPACITY = 0.35

/** The density volume spans −1…1; the shadow catcher sits at its floor. */
const VOLUME_FLOOR_Y = -1
const SHADOW_OPACITY = 0.45
const GRID_CENTER_COLOR = '#3d3d3a'
const GRID_COLOR = '#262624'

const MESH_MODES: readonly SegmentOption<MeshMode>[] = [
  { value: 'blocks', label: 'Blocks' },
  { value: 'marchingCubes', label: 'Marching cubes' },
]

function VoxelMesh({
  settings,
  steps,
  wireframe,
}: {
  settings: VoxelSettings
  steps: DensityStep[]
  wireframe: boolean
}) {
  const geometry = useMemo(() => new THREE.BufferGeometry(), [])

  const buffers = useMemo(() => {
    const volume = buildDensityVolume(settings.resolution, steps)
    return settings.meshMode === 'blocks'
      ? meshBlocks(volume)
      : meshMarchingCubes(volume)
  }, [settings.resolution, steps, settings.meshMode])

  useLayoutEffect(() => {
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(buffers.positions, 3),
    )
    geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(buffers.normals, 3),
    )
    geometry.computeBoundingSphere()
  }, [geometry, buffers])

  useEffect(() => {
    return () => {
      geometry.dispose()
    }
  }, [geometry])

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={VOXEL_COLOR}
        wireframe={wireframe}
        flatShading={settings.meshMode === 'blocks'}
        metalness={0}
        roughness={VOXEL_ROUGHNESS}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

function countSolid(densities: Float32Array): number {
  let n = 0
  for (let i = 0; i < densities.length; i++) {
    if (densities[i]! > 0) {
      n++
    }
  }
  return n
}

/**
 * One solid colour per axis (three's default fades each axis toward a lighter
 * tint), exempt from tone mapping so red, green and blue stay pure.
 */
function Axes() {
  const axes = useMemo(() => {
    const helper = new THREE.AxesHelper(AXIS_LENGTH)
    helper.setColors(
      new THREE.Color(AXIS_X_COLOR),
      new THREE.Color(AXIS_Y_COLOR),
      new THREE.Color(AXIS_Z_COLOR),
    )
    const material = helper.material as THREE.LineBasicMaterial
    material.toneMapped = false
    return helper
  }, [])

  useEffect(() => {
    return () => {
      axes.dispose()
    }
  }, [axes])

  return <primitive object={axes} />
}

function ChunkBounds({ chunksPerAxis }: { chunksPerAxis: number }) {
  const helpers = useMemo(() => {
    const n = Math.max(1, chunksPerAxis)
    const size = 2 / n
    const box = new THREE.BoxGeometry(size, size, size)
    const edges = new THREE.EdgesGeometry(box)
    box.dispose()
    const items: { key: string; position: [number, number, number] }[] = []
    for (let cz = 0; cz < n; cz++) {
      for (let cy = 0; cy < n; cy++) {
        for (let cx = 0; cx < n; cx++) {
          items.push({
            key: `${cx}-${cy}-${cz}`,
            position: [
              -1 + size * (cx + 0.5),
              -1 + size * (cy + 0.5),
              -1 + size * (cz + 0.5),
            ],
          })
        }
      }
    }
    return { items, edges }
  }, [chunksPerAxis])

  useEffect(() => {
    return () => {
      helpers.edges.dispose()
    }
  }, [helpers])

  return (
    <group>
      {helpers.items.map((item) => (
        <lineSegments
          key={item.key}
          position={item.position}
          geometry={helpers.edges}
        >
          <lineBasicMaterial
            color={CHUNK_LINE_COLOR}
            transparent
            opacity={CHUNK_LINE_OPACITY}
          />
        </lineSegments>
      ))}
    </group>
  )
}

function StepRow({
  step,
  index,
  isExpanded,
  isIsolated,
  canRemove,
  onToggleExpanded,
  onToggleIsolated,
  onChange,
  onRemove,
}: {
  step: DensityStep
  index: number
  isExpanded: boolean
  isIsolated: boolean
  canRemove: boolean
  onToggleExpanded: () => void
  onToggleIsolated: () => void
  onChange: (next: DensityStep) => void
  onRemove: () => void
}) {
  const detailLabel =
    step.shape === 'torus'
      ? 'Tube radius'
      : step.shape === 'plane'
        ? 'Thickness'
        : step.shape === 'noiseBlob'
          ? 'Noise detail'
          : 'Detail'

  return (
    <CollapsibleRow
      title={`Step ${index + 1}`}
      summary={`${step.op} · ${step.shape}`}
      expanded={isExpanded}
      enabled={step.enabled}
      onToggle={onToggleExpanded}
      onEnabledChange={(enabled) => onChange({ ...step, enabled })}
      actions={
        <button
          type="button"
          className="row-action"
          aria-pressed={isIsolated}
          title="Preview this step's shape on its own, as solid, without the other steps"
          onClick={onToggleIsolated}
        >
          Isolate
        </button>
      }
    >
      <ControlField
        label="CSG operation"
        tip="First enabled step is always treated as the base field (replace). Later steps combine with union, subtract, or intersect."
      >
        <select
          value={step.op}
          disabled={index === 0}
          onChange={(event) =>
            onChange({ ...step, op: event.target.value as CsgOp })
          }
        >
          {CSG_OP_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </ControlField>

      <ControlField
        label="Density shape"
        tip="Primitive signed-density field. Density > 0 is solid."
      >
        <select
          value={step.shape}
          onChange={(event) =>
            onChange({
              ...step,
              shape: event.target.value as DensityShapeKind,
            })
          }
        >
          {DENSITY_SHAPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </ControlField>

      <ControlField
        label="Size"
        value={step.size.toFixed(2)}
        tip="Primary radius / half-extent of the shape."
      >
        <Slider
          label="Size"
          min={0.05}
          max={1.2}
          step={0.01}
          value={step.size}
          onChange={(size) => onChange({ ...step, size })}
        />
      </ControlField>

      <ControlField
        label="Offset X"
        value={step.offsetX.toFixed(2)}
        tip="Move the shape along X in volume space (−1…1)."
        tone="x"
      >
        <Slider
          label="Offset X"
          min={-1}
          max={1}
          step={0.01}
          value={step.offsetX}
          onChange={(offsetX) => onChange({ ...step, offsetX })}
        />
      </ControlField>

      <ControlField
        label="Offset Y"
        value={step.offsetY.toFixed(2)}
        tip="Move the shape up/down in volume space (−1…1)."
        tone="y"
      >
        <Slider
          label="Offset Y"
          min={-1}
          max={1}
          step={0.01}
          value={step.offsetY}
          onChange={(offsetY) => onChange({ ...step, offsetY })}
        />
      </ControlField>

      <ControlField
        label="Offset Z"
        value={step.offsetZ.toFixed(2)}
        tip="Move the shape along Z in volume space (−1…1)."
        tone="z"
      >
        <Slider
          label="Offset Z"
          min={-1}
          max={1}
          step={0.01}
          value={step.offsetZ}
          onChange={(offsetZ) => onChange({ ...step, offsetZ })}
        />
      </ControlField>

      <ControlField
        label={detailLabel}
        value={step.detail.toFixed(2)}
        tip="Shape-specific secondary parameter (torus tube, plane thickness, noise frequency)."
      >
        <Slider
          label={detailLabel}
          min={0.02}
          max={0.8}
          step={0.01}
          value={step.detail}
          onChange={(detail) => onChange({ ...step, detail })}
        />
      </ControlField>

      <div className="row-foot">
        <button
          type="button"
          className="text-button"
          onClick={onRemove}
          disabled={!canRemove}
        >
          Remove step
        </button>
      </div>
    </CollapsibleRow>
  )
}

const voxelSummary = (settings: VoxelSettings) =>
  `${settings.steps.length} steps · res ${settings.resolution} · ${settings.meshMode === 'blocks' ? 'Blocks' : 'Marching cubes'}`

/**
 * Week 04 sandbox: density field → CSG steps → meshing → Three.js render.
 */
export function VoxelExercise() {
  const [settings, setSettings] = useState<VoxelSettings>(DEFAULT_VOXEL_SETTINGS)
  const [wireframe, setWireframe] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [expandedStepId, setExpandedStepId] = useState(
    DEFAULT_VOXEL_SETTINGS.steps[0]?.id ?? '',
  )
  const [isolatedStepId, setIsolatedStepId] = useState<string | null>(null)
  const [learning, setLearning] = useState(false)
  const exitLearning = useCallback(() => setLearning(false), [])
  const learnSteps = useMemo(
    () =>
      createVoxelLearnSteps({
        showComposite: () => setIsolatedStepId(null),
        setMeshMode: (meshMode) => setSettings((current) => ({ ...current, meshMode })),
        showChunks: () => {
          setExpandedStepId('')
          setSettings((current) => ({ ...current, showChunkBounds: true }))
        },
      }),
    [],
  )

  const isolatedIndex = settings.steps.findIndex(
    (step) => step.id === isolatedStepId,
  )
  const isolatedStep =
    isolatedIndex >= 0 ? settings.steps[isolatedIndex] : undefined

  // An isolated step renders alone as a solid base shape, whatever its op or
  // enabled state; otherwise the full top-to-bottom composite renders.
  const previewSteps = useMemo(
    () =>
      isolatedStep
        ? [{ ...isolatedStep, enabled: true, op: 'replace' as const }]
        : settings.steps,
    [isolatedStep, settings.steps],
  )

  const stats = useMemo(() => {
    const volume = buildDensityVolume(settings.resolution, previewSteps)
    const buffers =
      settings.meshMode === 'blocks'
        ? meshBlocks(volume)
        : meshMarchingCubes(volume)
    return {
      solid: countSolid(volume.densities),
      triangles: buffers.positions.length / 9,
      cells: settings.resolution ** 3,
    }
  }, [settings.resolution, settings.meshMode, previewSteps])

  const meshModeLabel =
    settings.meshMode === 'blocks'
      ? 'Block / Minecraft-style faces'
      : 'Marching Cubes (smooth)'

  const updateStep = (next: DensityStep) => {
    setSettings((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === next.id ? next : step)),
    }))
  }

  const addStep = () => {
    const step = createDensityStep({
      op: 'union',
      shape: 'sphere',
      size: 0.35,
      offsetY: 0.2,
    })
    setSettings((current) => ({
      ...current,
      steps: [...current.steps, step],
    }))
    setExpandedStepId(step.id)
  }

  const removeStep = (id: string) => {
    setSettings((current) => {
      if (current.steps.length <= 1) {
        return current
      }
      return {
        ...current,
        steps: current.steps.filter((step) => step.id !== id),
      }
    })
  }

  const applySettings = (next: VoxelSettings, isolated: string | null = null) => {
    setSettings(next)
    setExpandedStepId(next.steps[0]?.id ?? '')
    setIsolatedStepId(next.steps.some((step) => step.id === isolated) ? isolated : null)
  }

  const snapshots: PageSnapshotAdapter = {
    page: 'week04',
    schema: 1,
    reset: () => {
      applySettings(DEFAULT_VOXEL_SETTINGS)
      setWireframe(false)
      setAutoRotate(false)
    },
    capture: () => ({
      summary: voxelSummary(settings),
      state: { settings, isolatedStepId, wireframe },
    }),
    restore: (state) => {
      const loaded = state.settings && typeof state.settings === 'object' ? parseVoxelSettings(state.settings) : null
      if (!loaded) {
        throw new Error('This snapshot has no voxel steps.')
      }
      applySettings(loaded, typeof state.isolatedStepId === 'string' ? state.isolatedStepId : null)
      setWireframe(state.wireframe === true)
    },
    loadLegacy: async (uid) => {
      const stored = await loadLegacyConfig(uid, LEGACY_VOXEL_CONFIG_IDS)
      const loaded = stored ? parseVoxelSettings(stored) : null
      return loaded
        ? { summary: `${voxelSummary(loaded)} · old Cloud config`, restore: () => applySettings(loaded) }
        : null
    },
  }

  return (
    <div className="app-shell ui-system week04">
      <div className="viz-stage">
        <div className="world-canvas-wrap">
          <Canvas
            className="world-canvas"
            camera={{ position: [2.8, 2.2, 3.4], fov: 50 }}
            gl={{ antialias: true }}
            shadows="percentage"
          >
            <color attach="background" args={[SCENE_BG]} />
            <ambientLight intensity={AMBIENT_INTENSITY} />
            <directionalLight
              position={KEY_LIGHT.position}
              intensity={KEY_LIGHT.intensity}
              color={KEY_LIGHT.color}
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-bias={-0.0005}
              shadow-normalBias={0.02}
              shadow-radius={2}
              shadow-camera-left={-3}
              shadow-camera-right={3}
              shadow-camera-top={3}
              shadow-camera-bottom={-3}
              shadow-camera-near={0.5}
              shadow-camera-far={15}
            />
            <VoxelMesh
              settings={settings}
              steps={previewSteps}
              wireframe={wireframe}
            />
            {settings.showChunkBounds ? (
              <ChunkBounds chunksPerAxis={settings.chunksPerAxis} />
            ) : null}
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, VOLUME_FLOOR_Y - 0.002, 0]}
              receiveShadow
            >
              <planeGeometry args={[4, 4]} />
              <shadowMaterial transparent opacity={SHADOW_OPACITY} />
            </mesh>
            <gridHelper args={[4, 8, GRID_CENTER_COLOR, GRID_COLOR]} />
            <Axes />
            <OrbitControls
              makeDefault
              enableDamping
              dampingFactor={0.08}
              autoRotate={autoRotate}
              autoRotateSpeed={AUTO_ROTATE_SPEED}
            />
          </Canvas>

          <ViewTools
            tools={[
              { label: 'Wireframe', key: 'F', on: wireframe, onChange: setWireframe },
              { label: 'Auto rotate', key: 'R', on: autoRotate, onChange: setAutoRotate },
            ]}
            actions={
              isolatedStep ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setIsolatedStepId(null)}
                >
                  Show composite
                </button>
              ) : null
            }
          >
            <p className="readout" aria-live="polite">
              {isolatedStep ? (
                <span>
                  Isolated{' '}
                  <strong>
                    Step {isolatedIndex + 1} · {isolatedStep.shape}
                  </strong>{' '}
                  · shape alone, before CSG
                </span>
              ) : null}
              <span>
                Meshing <strong>{meshModeLabel}</strong>
              </span>
              <span>
                {settings.resolution}³ = {stats.cells.toLocaleString()} samples ·{' '}
                {stats.solid.toLocaleString()} solid · ~
                {Math.round(stats.triangles)} tris
              </span>
            </p>
          </ViewTools>
        </div>
      </div>

      <div className="app-chrome">
        <div className="region-left">
          <ExerciseHeading
            title="Voxels"
            about={{
              text: 'Pipeline: density shapes → CSG ops → meshing → render. Start at low resolution, then raise it to feel the cost.',
            }}
            actions={<LearnToggle active={learning} onChange={setLearning} />}
          />
        </div>

        <InstrumentPanel label="Voxels" utilities={<PageSnapshots adapter={snapshots} />}>
          <PanelSection index="01" title="Volume">
            <div data-learn="resolution">
              <ControlField
                label="Resolution"
                value={String(settings.resolution)}
                tip="Samples per axis. Low = blocky/fast; high = more detail and slower rebuilds."
              >
                <Slider
                  label="Resolution"
                  min={8}
                  max={48}
                  step={1}
                  value={settings.resolution}
                  onChange={(resolution) =>
                    setSettings((current) => ({ ...current, resolution }))
                  }
                />
              </ControlField>
            </div>

            <div data-learn="mesh-mode">
              <ControlField
                label="Meshing mode"
                tip="Blocks expose solid cells as cubes. Marching Cubes extracts a smooth isosurface where density crosses 0."
              >
                <Segmented
                  label="Meshing mode"
                  options={MESH_MODES}
                  value={settings.meshMode}
                  onChange={(meshMode) =>
                    setSettings((current) => ({ ...current, meshMode }))
                  }
                />
              </ControlField>
            </div>
          </PanelSection>

          <PanelSection
            index="02"
            title="Density / CSG steps"
            action={
              <button type="button" className="text-button" onClick={addStep}>
                + Add step
              </button>
            }
          >
            <div className="row-list">
              {settings.steps.map((step, index) => (
                <StepRow
                  key={step.id}
                  step={step}
                  index={index}
                  isExpanded={expandedStepId === step.id}
                  isIsolated={isolatedStepId === step.id}
                  canRemove={settings.steps.length > 1}
                  onToggleExpanded={() =>
                    setExpandedStepId((current) =>
                      current === step.id ? '' : step.id,
                    )
                  }
                  onToggleIsolated={() =>
                    setIsolatedStepId((current) =>
                      current === step.id ? null : step.id,
                    )
                  }
                  onChange={updateStep}
                  onRemove={() => removeStep(step.id)}
                />
              ))}
            </div>
          </PanelSection>

          <PanelSection index="03" title="Chunks">
            <div data-learn="chunks">
              <Toggle
                label="Show chunk boundaries"
                checked={settings.showChunkBounds}
                onChange={(showChunkBounds) =>
                  setSettings((current) => ({ ...current, showChunkBounds }))
                }
              />
              <ControlField
                label="Chunks per axis"
                value={String(settings.chunksPerAxis)}
                tip="Educational overlay: how a volume might split into chunks for streaming/LOD. Meshing here is still one volume."
              >
                <Slider
                  label="Chunks per axis"
                  min={1}
                  max={4}
                  step={1}
                  value={settings.chunksPerAxis}
                  disabled={!settings.showChunkBounds}
                  onChange={(chunksPerAxis) =>
                    setSettings((current) => ({ ...current, chunksPerAxis }))
                  }
                />
              </ControlField>
            </div>
          </PanelSection>
        </InstrumentPanel>
      </div>

      {learning ? (
        <LearnTour steps={learnSteps} label="Learn · Voxels" onExit={exitLearning} />
      ) : null}
    </div>
  )
}
