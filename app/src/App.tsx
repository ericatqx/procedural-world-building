import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_NOISE_SETTINGS,
  createNoiseLayer,
  generateHeightmap,
  type NoiseSettings,
  type WorldOffset,
} from './noise/index.ts'
import {
  DEFAULT_HYDRAULIC_EROSION_PARAMS,
  stepHydraulicErosion,
  type HydraulicErosionParams,
} from './simulation/hydraulicErosion.ts'
import {
  DEFAULT_TERRAIN_FOG,
  WorldCanvas,
  type TerrainFogSettings,
} from './scene/WorldCanvas.tsx'
import { AppChrome } from './ui/AppChrome.tsx'
import { NoiseMapPreview } from './ui/NoiseMapPreview.tsx'
import { SimulationMapView } from './ui/SimulationMapView.tsx'
import './App.css'

type VizView = 'map' | 'simulation' | 'terrain'

/** Fraction of one map window per keypress — small for continuous scrolling. */
const WORLD_STEP = 0.05

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

function App() {
  const [view, setView] = useState<VizView>('terrain')
  const [settings, setSettings] = useState<NoiseSettings>(DEFAULT_NOISE_SETTINGS)
  const [worldOffset, setWorldOffset] = useState<WorldOffset>({ x: 0, z: 0 })
  const [isSimulating, setIsSimulating] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const [fog, setFog] = useState<TerrainFogSettings>(DEFAULT_TERRAIN_FOG)
  const [simParams, setSimParams] = useState<HydraulicErosionParams>(
    DEFAULT_HYDRAULIC_EROSION_PARAMS,
  )

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

  // Noise settings or world region changes regenerate the base field and reset erosion.
  useEffect(() => {
    resetSimulationBuffers(baseHeightmap)
  }, [baseHeightmap])

  const resetSimulation = () => {
    resetSimulationBuffers(baseHeightmap)
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      if (isTypingTarget(event.target)) {
        return
      }

      if (event.key === 'f' || event.key === 'F') {
        if (view !== 'terrain') {
          return
        }
        event.preventDefault()
        setWireframe((current) => !current)
        return
      }

      let dx = 0
      let dz = 0
      switch (event.key) {
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
          return
      }

      event.preventDefault()
      setWorldOffset((current) => ({
        x: Number((current.x + dx).toFixed(4)),
        z: Number((current.z + dz).toFixed(4)),
      }))
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [view])

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
    <div className="app-shell">
      <div className="viz-stage">
        <div className="viz-tabs" role="tablist" aria-label="Visualization">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'map'}
            onClick={() => setView('map')}
          >
            2D Map
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'simulation'}
            onClick={() => setView('simulation')}
          >
            Simulation Map
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'terrain'}
            onClick={() => setView('terrain')}
          >
            3D Terrain
          </button>
        </div>

        <p className="world-coords" aria-live="polite">
          World X {worldOffset.x.toFixed(2)} · Z {worldOffset.z.toFixed(2)}
          <span className="world-coords-hint">WASD / arrows</span>
        </p>

        {view === 'map' ? (
          <NoiseMapPreview
            values={baseHeightmap}
            resolution={settings.resolution}
            mode="height"
          />
        ) : null}

        {view === 'simulation' ? (
          <SimulationMapView
            heightmap={simulatedHeightmap}
            water={waterField}
            sediment={sedimentField}
            resolution={settings.resolution}
            isSimulating={isSimulating}
            params={simParams}
            onParamsChange={setSimParams}
            onStart={() => setIsSimulating(true)}
            onStop={() => setIsSimulating(false)}
            onReset={resetSimulation}
          />
        ) : null}

        {view === 'terrain' ? (
          <WorldCanvas
            heightmap={simulatedHeightmap}
            resolution={settings.resolution}
            amplitude={1}
            wireframe={wireframe}
            fog={fog}
            onFogChange={setFog}
          />
        ) : null}
      </div>
      <AppChrome
        settings={settings}
        onChange={setSettings}
        onAddLayer={addLayer}
        onRemoveLayer={removeLayer}
      />
    </div>
  )
}

export default App
