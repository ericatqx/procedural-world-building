import { useState } from 'react'
import type { HydraulicErosionParams } from '../simulation/hydraulicErosion.ts'
import {
  NoiseMapPreview,
  type FieldPreviewMode,
} from './NoiseMapPreview.tsx'

type SimulationMapViewProps = {
  heightmap: Float32Array
  water: Float32Array
  sediment: Float32Array
  resolution: number
  isSimulating: boolean
  params: HydraulicErosionParams
  onParamsChange: (next: HydraulicErosionParams) => void
  onStart: () => void
  onStop: () => void
  onReset: () => void
}

const FIELD_MODES: { value: FieldPreviewMode; label: string }[] = [
  { value: 'height', label: 'Height' },
  { value: 'water', label: 'Water' },
  { value: 'sediment', label: 'Sediment' },
]

function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  const display = Number.isInteger(step) ? value : value.toFixed(3)
  return (
    <label className="sim-param">
      <span>
        {label} ({display})
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

export function SimulationMapView({
  heightmap,
  water,
  sediment,
  resolution,
  isSimulating,
  params,
  onParamsChange,
  onStart,
  onStop,
  onReset,
}: SimulationMapViewProps) {
  const [fieldMode, setFieldMode] = useState<FieldPreviewMode>('height')

  const setParam = <K extends keyof HydraulicErosionParams>(
    key: K,
    value: HydraulicErosionParams[K],
  ) => {
    onParamsChange({ ...params, [key]: value })
  }

  const previewValues =
    fieldMode === 'height'
      ? heightmap
      : fieldMode === 'water'
        ? water
        : sediment

  return (
    <div className="simulation-view">
      <div className="simulation-toolbar">
        <div className="sim-controls-row">
          <button
            type="button"
            className="sim-button"
            onClick={onStart}
            disabled={isSimulating}
          >
            Start
          </button>
          <button
            type="button"
            className="sim-button"
            onClick={onStop}
            disabled={!isSimulating}
          >
            Stop
          </button>
          <button type="button" className="sim-button" onClick={onReset}>
            Reset
          </button>
        </div>

        <div
          className="sim-field-modes"
          role="tablist"
          aria-label="Simulation field"
        >
          {FIELD_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              role="tab"
              className="sim-mode-button"
              aria-selected={fieldMode === mode.value}
              onClick={() => setFieldMode(mode.value)}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="sim-params">
          <ParamSlider
            label="Rain"
            value={params.rain}
            min={0}
            max={0.05}
            step={0.001}
            onChange={(value) => setParam('rain', value)}
          />
          <ParamSlider
            label="Evaporation"
            value={params.evaporation}
            min={0.005}
            max={0.15}
            step={0.005}
            onChange={(value) => setParam('evaporation', value)}
          />
          <ParamSlider
            label="Erosion rate"
            value={params.erosionRate}
            min={0.05}
            max={1}
            step={0.05}
            onChange={(value) => setParam('erosionRate', value)}
          />
          <ParamSlider
            label="Deposition rate"
            value={params.depositionRate}
            min={0.05}
            max={1}
            step={0.05}
            onChange={(value) => setParam('depositionRate', value)}
          />
          <ParamSlider
            label="Sediment capacity"
            value={params.sedimentCapacity}
            min={0.5}
            max={12}
            step={0.5}
            onChange={(value) => setParam('sedimentCapacity', value)}
          />
          <ParamSlider
            label="Flow rate"
            value={params.flowRate}
            min={0.1}
            max={0.9}
            step={0.05}
            onChange={(value) => setParam('flowRate', value)}
          />
          <ParamSlider
            label="Steps per frame"
            value={params.stepsPerFrame}
            min={1}
            max={6}
            step={1}
            onChange={(value) => setParam('stepsPerFrame', value)}
          />
        </div>

        <p className="simulation-note">
          {isSimulating
            ? 'Hydraulic erosion is running. Switch Height / Water / Sediment to inspect buffers.'
            : 'Start to erode the noise terrain. Field modes only change visualization.'}
        </p>
      </div>
      <NoiseMapPreview
        values={previewValues}
        resolution={resolution}
        mode={fieldMode}
      />
    </div>
  )
}
