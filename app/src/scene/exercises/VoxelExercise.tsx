import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { useAuth } from '../../auth/useAuth.ts'
import {
  buildDensityVolume,
  createDensityStep,
  CSG_OP_OPTIONS,
  DEFAULT_VOXEL_SETTINGS,
  DENSITY_SHAPE_OPTIONS,
  loadVoxelConfig,
  meshBlocks,
  meshMarchingCubes,
  saveVoxelConfig,
  type CsgOp,
  type DensityShapeKind,
  type DensityStep,
  type MeshMode,
  type VoxelSettings,
} from '../../voxels/index.ts'

const SCENE_BG = '#0e1118'

function ControlField({
  label,
  tip,
  children,
}: {
  label: string
  tip: string
  children: ReactNode
}) {
  return (
    <div className="control-field">
      <div className="control-tip">
        <span className="control-label">{label}</span>
        <div className="control-tip-bubble" role="tooltip">
          {tip}
        </div>
        {children}
      </div>
    </div>
  )
}

function VoxelMesh({
  settings,
  wireframe,
}: {
  settings: VoxelSettings
  wireframe: boolean
}) {
  const geometry = useMemo(() => new THREE.BufferGeometry(), [])

  const buffers = useMemo(() => {
    const volume = buildDensityVolume(settings.resolution, settings.steps)
    return settings.meshMode === 'blocks'
      ? meshBlocks(volume)
      : meshMarchingCubes(volume)
  }, [settings.resolution, settings.steps, settings.meshMode])

  useLayoutEffect(() => {
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(buffers.positions, 3),
    )
    geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(buffers.normals, 3),
    )
    geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 3))
    geometry.computeBoundingSphere()
  }, [geometry, buffers])

  useEffect(() => {
    return () => {
      geometry.dispose()
    }
  }, [geometry])

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        vertexColors
        wireframe={wireframe}
        flatShading={settings.meshMode === 'blocks'}
        metalness={0.08}
        roughness={0.72}
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
          <lineBasicMaterial color="#f0c674" transparent opacity={0.55} />
        </lineSegments>
      ))}
    </group>
  )
}

function StepCard({
  step,
  index,
  isExpanded,
  canRemove,
  onToggleExpanded,
  onChange,
  onRemove,
}: {
  step: DensityStep
  index: number
  isExpanded: boolean
  canRemove: boolean
  onToggleExpanded: () => void
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
    <section className="layer-card">
      <div className="layer-header">
        <button
          type="button"
          className="layer-toggle"
          onClick={onToggleExpanded}
          aria-expanded={isExpanded}
        >
          <span className="layer-title-row">
            <span className="layer-title">Step {index + 1}</span>
            <span className="layer-chip">{step.op}</span>
            <span className="layer-chip">{step.shape}</span>
          </span>
          <span className="layer-summary">
            {isExpanded ? 'Hide controls' : 'Show controls'}
          </span>
        </button>
        <div className="layer-actions">
          <label className="layer-enabled">
            <input
              type="checkbox"
              checked={step.enabled}
              onChange={(event) =>
                onChange({ ...step, enabled: event.target.checked })
              }
            />
            <span>Enabled</span>
          </label>
          <button
            type="button"
            className="layer-remove"
            onClick={onRemove}
            disabled={!canRemove}
          >
            Remove
          </button>
        </div>
      </div>

      {isExpanded ? (
        <div className="layer-body">
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
            label={`Size (${step.size.toFixed(2)})`}
            tip="Primary radius / half-extent of the shape."
          >
            <input
              type="range"
              min={0.05}
              max={1.2}
              step={0.01}
              value={step.size}
              onChange={(event) =>
                onChange({ ...step, size: Number(event.target.value) })
              }
            />
          </ControlField>

          <ControlField
            label={`Offset Y (${step.offsetY.toFixed(2)})`}
            tip="Move the shape up/down in volume space (−1…1)."
          >
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={step.offsetY}
              onChange={(event) =>
                onChange({ ...step, offsetY: Number(event.target.value) })
              }
            />
          </ControlField>

          <ControlField
            label={`${detailLabel} (${step.detail.toFixed(2)})`}
            tip="Shape-specific secondary parameter (torus tube, plane thickness, noise frequency)."
          >
            <input
              type="range"
              min={0.02}
              max={0.8}
              step={0.01}
              value={step.detail}
              onChange={(event) =>
                onChange({ ...step, detail: Number(event.target.value) })
              }
            />
          </ControlField>
        </div>
      ) : null}
    </section>
  )
}

/**
 * Week 04 sandbox: density field → CSG steps → meshing → Three.js render.
 */
export function VoxelExercise() {
  const { user, ready } = useAuth()
  const [settings, setSettings] = useState<VoxelSettings>(DEFAULT_VOXEL_SETTINGS)
  const [wireframe, setWireframe] = useState(false)
  const [expandedStepId, setExpandedStepId] = useState(
    DEFAULT_VOXEL_SETTINGS.steps[0]?.id ?? '',
  )
  const [cloudBusy, setCloudBusy] = useState(false)
  const [cloudMessage, setCloudMessage] = useState<string | null>(null)

  const stats = useMemo(() => {
    const volume = buildDensityVolume(settings.resolution, settings.steps)
    const buffers =
      settings.meshMode === 'blocks'
        ? meshBlocks(volume)
        : meshMarchingCubes(volume)
    return {
      solid: countSolid(volume.densities),
      triangles: buffers.positions.length / 9,
      cells: settings.resolution ** 3,
    }
  }, [settings])

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

  const handleSave = async () => {
    if (!user) {
      setCloudMessage('Sign in to save.')
      return
    }
    setCloudBusy(true)
    setCloudMessage(null)
    try {
      await saveVoxelConfig(user.uid, settings)
      setCloudMessage('Saved.')
    } catch (err) {
      setCloudMessage(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setCloudBusy(false)
    }
  }

  const handleLoad = async () => {
    if (!user) {
      setCloudMessage('Sign in to load.')
      return
    }
    setCloudBusy(true)
    setCloudMessage(null)
    try {
      const loaded = await loadVoxelConfig(user.uid)
      if (!loaded) {
        setCloudMessage('No saved config yet.')
        return
      }
      setSettings(loaded)
      setExpandedStepId(loaded.steps[0]?.id ?? '')
      setCloudMessage('Loaded.')
    } catch (err) {
      setCloudMessage(err instanceof Error ? err.message : 'Load failed.')
    } finally {
      setCloudBusy(false)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault()
        setWireframe((current) => !current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="app-shell">
      <div className="viz-stage">
        <div className="world-canvas-wrap">
          <Canvas
            className="world-canvas"
            camera={{ position: [2.8, 2.2, 3.4], fov: 50 }}
            gl={{ antialias: true }}
          >
            <color attach="background" args={[SCENE_BG]} />
            <ambientLight intensity={0.55} />
            <hemisphereLight args={['#d7e3ff', '#1a1d26', 0.45]} />
            <directionalLight position={[6, 8, 4]} intensity={1.2} />
            <VoxelMesh settings={settings} wireframe={wireframe} />
            {settings.showChunkBounds ? (
              <ChunkBounds chunksPerAxis={settings.chunksPerAxis} />
            ) : null}
            <gridHelper args={[4, 8, '#3d4a63', '#252a36']} />
            <axesHelper args={[1.2]} />
            <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
          </Canvas>

          <div className="terrain-overlays">
            <p className="mesh-mode-badge" aria-live="polite">
              Meshing: <strong>{meshModeLabel}</strong>
            </p>
            <p className="wireframe-hint">
              <kbd>F</kbd> — Wireframe {wireframe ? '(on)' : '(off)'}
            </p>
            <p className="voxel-stats" aria-live="polite">
              {settings.resolution}³ = {stats.cells.toLocaleString()} samples ·{' '}
              {stats.solid.toLocaleString()} solid · ~{Math.round(stats.triangles)}{' '}
              tris
            </p>
          </div>
        </div>
      </div>

      <div className="app-chrome">
        <header className="app-title-bar">
          <p className="app-kicker">Week 04</p>
          <h1 className="app-title">Voxels</h1>
        </header>

        <aside className="side-panel" aria-label="Voxel controls">
          <h2 className="panel-title">Controls</h2>
          <p className="panel-hint">
            Pipeline: density shapes → CSG ops → meshing → render. Start at low
            resolution, then raise it to feel the cost.
          </p>

          <div className="cloud-config">
            <span className="control-label">Cloud config</span>
            <div className="cloud-config-actions">
              <button
                type="button"
                className="layer-add"
                onClick={() => void handleSave()}
                disabled={!ready || !user || cloudBusy}
              >
                Save
              </button>
              <button
                type="button"
                className="layer-add"
                onClick={() => void handleLoad()}
                disabled={!ready || !user || cloudBusy}
              >
                Load
              </button>
            </div>
            {!user && ready ? (
              <p className="cloud-config-hint">Sign in to save or load.</p>
            ) : null}
            {cloudMessage ? (
              <p className="cloud-config-hint" aria-live="polite">
                {cloudMessage}
              </p>
            ) : null}
          </div>

          <ControlField
            label={`Resolution (${settings.resolution})`}
            tip="Samples per axis. Low = blocky/fast; high = more detail and slower rebuilds."
          >
            <input
              type="range"
              min={8}
              max={48}
              step={1}
              value={settings.resolution}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  resolution: Number(event.target.value),
                }))
              }
            />
          </ControlField>

          <ControlField
            label="Meshing mode"
            tip="Blocks expose solid cells as cubes. Marching Cubes extracts a smooth isosurface where density crosses 0."
          >
            <select
              value={settings.meshMode}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  meshMode: event.target.value as MeshMode,
                }))
              }
            >
              <option value="blocks">Blocks (Minecraft-style)</option>
              <option value="marchingCubes">Marching Cubes (smooth)</option>
            </select>
          </ControlField>

          <label className="layer-enabled voxel-toggle">
            <input
              type="checkbox"
              checked={settings.showChunkBounds}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  showChunkBounds: event.target.checked,
                }))
              }
            />
            <span>Show chunk boundaries</span>
          </label>

          <ControlField
            label={`Chunks per axis (${settings.chunksPerAxis})`}
            tip="Educational overlay: how a volume might split into chunks for streaming/LOD. Meshing here is still one volume."
          >
            <input
              type="range"
              min={1}
              max={4}
              step={1}
              value={settings.chunksPerAxis}
              disabled={!settings.showChunkBounds}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  chunksPerAxis: Number(event.target.value),
                }))
              }
            />
          </ControlField>

          <div className="layers-header">
            <span className="control-label">Density / CSG steps</span>
            <button type="button" className="layer-add" onClick={addStep}>
              Add step
            </button>
          </div>

          <div className="control-list">
            {settings.steps.map((step, index) => (
              <StepCard
                key={step.id}
                step={step}
                index={index}
                isExpanded={expandedStepId === step.id}
                canRemove={settings.steps.length > 1}
                onToggleExpanded={() =>
                  setExpandedStepId((current) =>
                    current === step.id ? '' : step.id,
                  )
                }
                onChange={updateStep}
                onRemove={() => removeStep(step.id)}
              />
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}
