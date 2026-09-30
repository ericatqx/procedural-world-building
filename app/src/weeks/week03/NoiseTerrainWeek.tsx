import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_NOISE_SETTINGS,
  createNoiseLayer,
  generateHeightmap,
  type NoiseSettings,
  type WorldOffset,
} from '../../shared/noise/index.ts'
import {
  DEFAULT_HYDRAULIC_EROSION_PARAMS,
  stepHydraulicErosion,
  type HydraulicErosionParams,
} from './hydraulicErosion.ts'
import { TerrainCanvas } from './TerrainCanvas.tsx'
import { DEFAULT_TERRAIN_FOG, type TerrainFogSettings } from './terrainConfig.ts'
import { AppearanceSection, EnvironmentSection } from './TerrainPanels.tsx'
import type { TerrainColorMode } from './terrainContours.ts'
import { AppChrome } from './AppChrome.tsx'
import {
  ExerciseHeading,
  Segmented,
  type SegmentOption,
} from '../../shared/ui/instrument.tsx'
import { LearnToggle, LearnTour } from '../../shared/ui/learn.tsx'
import { PageSnapshots, type PageSnapshotAdapter } from '../../shared/ui/PageSnapshots.tsx'
import { bytesOf, payloadField, readFloat32 } from '../../shared/persistence/codec.ts'
import { useShortcuts } from '../../shared/ui/shortcuts.ts'
import { createTerrainLearnSteps } from './learnSteps.tsx'
import { NoiseMapPreview, type FieldPreviewMode } from './NoiseMapPreview.tsx'
import { SimulationControls } from './SimulationControls.tsx'
import '../../shared/ui/system.css'

type VizView = 'terrain' | 'simulation'

const VIEWS: { id: VizView; label: string }[] = [
  { id: 'terrain', label: 'Terrain' },
  { id: 'simulation', label: 'Simulation' },
]

const ABOUT = {
  text: 'Same blended layers feed the field map and the 3D terrain. In Simulation, erosion reshapes that terrain and cyan marks where water collects and flows. Drag to orbit in 3D.',
}

const FIELD_MODES: readonly SegmentOption<FieldPreviewMode>[] = [
  { value: 'height', label: 'Height' },
  { value: 'water', label: 'Water', tone: 'water' },
  { value: 'sediment', label: 'Sediment', tone: 'sediment' },
]

/** Rain amount (the Rain slider's maximum) drawn with the most streaks. */
const RAIN_FOR_FULL_STREAKS = 0.05

/** Fraction of one map window per keypress — small for continuous scrolling. */
const WORLD_STEP = 0.05

type Field = Float32Array<ArrayBuffer>
type ErosionFields = { height: Field; water: Field; sediment: Field }

/** Week 03 — noise layers, erosion simulation, and height-field terrain. */
export function NoiseTerrainWeek() {
  const [view, setView] = useState<VizView>('terrain')
  const [settings, setSettings] = useState<NoiseSettings>(DEFAULT_NOISE_SETTINGS)
  const [worldOffset, setWorldOffset] = useState<WorldOffset>({ x: 0, z: 0 })
  const [isSimulating, setIsSimulating] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const [contours, setContours] = useState(true)
  const [fog, setFog] = useState<TerrainFogSettings>(DEFAULT_TERRAIN_FOG)
  const [colorMode, setColorMode] = useState<TerrainColorMode>('neutral')
  const [fieldMode, setFieldMode] = useState<FieldPreviewMode>('height')
  const [simParams, setSimParams] = useState<HydraulicErosionParams>(
    DEFAULT_HYDRAULIC_EROSION_PARAMS,
  )
  const [learning, setLearning] = useState(false)
  const exitLearning = useCallback(() => setLearning(false), [])
  const learnSteps = useMemo(() => createTerrainLearnSteps({ showView: setView }), [])

  const baseHeightmap = useMemo(
    () => generateHeightmap(settings, worldOffset),
    [settings, worldOffset],
  )

  const heightRef = useRef(new Float32Array(baseHeightmap))
  const waterRef = useRef(new Float32Array(baseHeightmap.length))
  const sedimentRef = useRef(new Float32Array(baseHeightmap.length))
  const simParamsRef = useRef(simParams)
  const resolutionRef = useRef(settings.resolution)

  const [simulatedHeightmap, setSimulatedHeightmap] = useState(
    () => new Float32Array(baseHeightmap),
  )
  const [waterField, setWaterField] = useState(
    () => new Float32Array(baseHeightmap.length),
  )
  const [sedimentField, setSedimentField] = useState(
    () => new Float32Array(baseHeightmap.length),
  )

  simParamsRef.current = simParams
  resolutionRef.current = settings.resolution

  const publishSimulationFields = () => {
    setSimulatedHeightmap(new Float32Array(heightRef.current))
    setWaterField(new Float32Array(waterRef.current))
    setSedimentField(new Float32Array(sedimentRef.current))
  }

  const resetSimulationBuffers = (source: Float32Array) => {
    heightRef.current = new Float32Array(source)
    waterRef.current = new Float32Array(source.length)
    sedimentRef.current = new Float32Array(source.length)
    publishSimulationFields()
    setIsSimulating(false)
  }

  // A restored snapshot's erosion fields wait here until its settings have
  // regenerated the heightmap they belong to.
  const pendingFieldsRef = useRef<ErosionFields | null>(null)
  const [restoreSeq, setRestoreSeq] = useState(0)

  useEffect(() => {
    const pending = pendingFieldsRef.current
    pendingFieldsRef.current = null
    if (pending && pending.height.length === baseHeightmap.length) {
      heightRef.current = pending.height
      waterRef.current = pending.water
      sedimentRef.current = pending.sediment
      publishSimulationFields()
      setIsSimulating(false)
    } else {
      resetSimulationBuffers(baseHeightmap)
    }
  }, [baseHeightmap, restoreSeq])

  const resetSimulation = () => {
    resetSimulationBuffers(baseHeightmap)
  }

  const snapshots: PageSnapshotAdapter = {
    page: 'week03',
    schema: 1,
    reset: () => {
      setIsSimulating(false)
      pendingFieldsRef.current = null
      setView('terrain')
      setSettings(DEFAULT_NOISE_SETTINGS)
      setWorldOffset({ x: 0, z: 0 })
      setWireframe(false)
      setContours(true)
      setFog(DEFAULT_TERRAIN_FOG)
      setColorMode('neutral')
      setFieldMode('height')
      setSimParams(DEFAULT_HYDRAULIC_EROSION_PARAMS)
      setRestoreSeq((seq) => seq + 1)
    },
    capture: () => {
      const eroded = heightRef.current.some((value, index) => value !== baseHeightmap[index])
      const offset = worldOffset.x !== 0 || worldOffset.z !== 0
        ? ` · offset ${worldOffset.x.toFixed(2)}, ${worldOffset.z.toFixed(2)}`
        : ''
      return {
        summary: `${settings.resolution}² · ${settings.layers.length} layers · ${eroded ? 'eroded' : 'not eroded'}${offset}`,
        state: { view, settings, worldOffset, wireframe, contours, fog, colorMode, fieldMode, simParams },
        payload: {
          height: bytesOf(heightRef.current),
          water: bytesOf(waterRef.current),
          sediment: bytesOf(sedimentRef.current),
        },
      }
    },
    restore: (state, payload) => {
      const saved = state.settings as Partial<NoiseSettings> | undefined
      if (!saved || !Array.isArray(saved.layers) || saved.layers.length === 0 || typeof saved.resolution !== 'number') {
        throw new Error('This snapshot has no noise layers.')
      }
      const nextSettings: NoiseSettings = {
        resolution: saved.resolution,
        layers: saved.layers.map((layer) => createNoiseLayer(layer)),
      }
      const cells = nextSettings.resolution * nextSettings.resolution
      if (!payload) {
        throw new Error('This snapshot is missing its erosion fields.')
      }
      pendingFieldsRef.current = {
        height: payloadField(payload, 'height', readFloat32, cells),
        water: payloadField(payload, 'water', readFloat32, cells),
        sediment: payloadField(payload, 'sediment', readFloat32, cells),
      }
      const offset = state.worldOffset as Partial<WorldOffset> | undefined
      setIsSimulating(false)
      setView(state.view === 'simulation' ? 'simulation' : 'terrain')
      setSettings(nextSettings)
      setWorldOffset({ x: Number(offset?.x) || 0, z: Number(offset?.z) || 0 })
      setWireframe(state.wireframe === true)
      setContours(state.contours !== false)
      setFog({ ...DEFAULT_TERRAIN_FOG, ...(state.fog as Partial<TerrainFogSettings> | undefined) })
      setColorMode(state.colorMode === 'elevation' ? 'elevation' : 'neutral')
      setFieldMode(FIELD_MODES.find((mode) => mode.value === state.fieldMode)?.value ?? 'height')
      setSimParams({
        ...DEFAULT_HYDRAULIC_EROSION_PARAMS,
        ...(state.simParams as Partial<HydraulicErosionParams> | undefined),
      })
      setRestoreSeq((seq) => seq + 1)
    },
  }

  useEffect(() => {
    if (!isSimulating) {
      return
    }

    let frameId = 0

    const tick = () => {
      const resolution = resolutionRef.current
      const params = simParamsRef.current
      const height = heightRef.current
      const water = waterRef.current
      const sediment = sedimentRef.current

      for (let step = 0; step < params.stepsPerFrame; step++) {
        stepHydraulicErosion(height, water, sediment, resolution, params)
      }

      publishSimulationFields()
      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [isSimulating])

  useShortcuts((key) => {
    let dx = 0
    let dz = 0
    switch (key) {
      case 'w':
      case 'W':
      case 'ArrowUp':
        dz = -WORLD_STEP
        break
      case 's':
      case 'S':
      case 'ArrowDown':
        dz = WORLD_STEP
        break
      case 'a':
      case 'A':
      case 'ArrowLeft':
        dx = -WORLD_STEP
        break
      case 'd':
      case 'D':
      case 'ArrowRight':
        dx = WORLD_STEP
        break
      default:
        return false
    }
    setWorldOffset((current) => ({
      x: Number((current.x + dx).toFixed(4)),
      z: Number((current.z + dz).toFixed(4)),
    }))
    return true
  })

  const addLayer = () => {
    setSettings((current) => ({
      ...current,
      layers: [...current.layers, createNoiseLayer()],
    }))
  }

  const removeLayer = (layerId: string) => {
    setSettings((current) => ({
      ...current,
      layers:
        current.layers.length > 1
          ? current.layers.filter((layer) => layer.id !== layerId)
          : current.layers,
    }))
  }

  return (
    <div className="app-shell ui-system week03">
      <div className="viz-stage">
        <TerrainCanvas
          heightmap={simulatedHeightmap}
          resolution={settings.resolution}
          amplitude={1}
          wireframe={wireframe}
          onWireframeChange={setWireframe}
          contours={contours}
          onContoursChange={setContours}
          fog={fog}
          water={view === 'simulation' ? waterField : undefined}
          rainIntensity={
            isSimulating ? Math.sqrt(simParams.rain / RAIN_FOR_FULL_STREAKS) : 0
          }
          colorMode={view === 'terrain' ? colorMode : 'neutral'}
        />
      </div>

      <div className="app-chrome">
        <div className="region-left">
          <ExerciseHeading
            title="Noise & Terrain"
            about={ABOUT}
            actions={<LearnToggle active={learning} onChange={setLearning} />}
          />

          <div className="view-tabs" role="tablist" aria-label="Visualization">
            {VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={view === item.id}
                onClick={() => setView(item.id)}
              >
                {item.label}
                {item.id === 'simulation' && isSimulating ? (
                  <span className="live-dot" aria-hidden="true" />
                ) : null}
              </button>
            ))}
          </div>

          <p className="readout" aria-live="polite">
            <span>
              World <span className="axis-label" data-tone="x">X</span>{' '}
              {worldOffset.x.toFixed(2)} ·{' '}
              <span className="axis-label" data-tone="z">Z</span>{' '}
              {worldOffset.z.toFixed(2)}
            </span>
            <span className="readout-hint">WASD / arrows</span>
          </p>

          {view === 'terrain' ? (
            <NoiseMapPreview
              variant="inset"
              label="Field map"
              values={baseHeightmap}
              resolution={settings.resolution}
              mode="height"
            />
          ) : (
            <NoiseMapPreview
              variant="inset"
              label="Data view"
              values={
                fieldMode === 'height'
                  ? simulatedHeightmap
                  : fieldMode === 'water'
                    ? waterField
                    : sedimentField
              }
              resolution={settings.resolution}
              mode={fieldMode}
            >
              <Segmented
                label="Simulation field"
                options={FIELD_MODES}
                value={fieldMode}
                onChange={setFieldMode}
              />
            </NoiseMapPreview>
          )}
        </div>

        <AppChrome
          utilities={<PageSnapshots adapter={snapshots} />}
          settings={settings}
          onChange={setSettings}
          onAddLayer={addLayer}
          onRemoveLayer={removeLayer}
        >
          {view === 'simulation' ? (
            <SimulationControls
              index="03"
              isSimulating={isSimulating}
              params={simParams}
              onParamsChange={setSimParams}
              onStart={() => setIsSimulating(true)}
              onStop={() => setIsSimulating(false)}
              onReset={resetSimulation}
            />
          ) : null}
          {view === 'simulation' ? (
            <EnvironmentSection
              index="04"
              rain={simParams.rain}
              onRainChange={(rain) => setSimParams((current) => ({ ...current, rain }))}
            />
          ) : null}
          <AppearanceSection
            index={view === 'simulation' ? '05' : '03'}
            fog={fog}
            onFogChange={setFog}
            colorMode={colorMode}
            onColorModeChange={view === 'terrain' ? setColorMode : undefined}
          />
        </AppChrome>
      </div>

      {learning ? (
        <LearnTour steps={learnSteps} label="Learn · Terrain" onExit={exitLearning} />
      ) : null}
    </div>
  )
}
