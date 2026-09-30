import type { HydraulicErosionParams } from './hydraulicErosion.ts'
import { ControlField, PanelSection, Slider } from '../../shared/ui/instrument.tsx'

function ParamSlider({
  label,
  tip,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  tip: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  const display = Number.isInteger(step) ? String(value) : value.toFixed(3)
  return (
    <ControlField label={label} value={display} tip={tip}>
      <Slider
        label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
      />
    </ControlField>
  )
}

type SimulationControlsProps = {
  index: string
  isSimulating: boolean
  params: HydraulicErosionParams
  onParamsChange: (next: HydraulicErosionParams) => void
  onStart: () => void
  onStop: () => void
  onReset: () => void
}

/** Erosion operation and parameters — shown only with the Simulation view. */
export function SimulationControls({
  index,
  isSimulating,
  params,
  onParamsChange,
  onStart,
  onStop,
  onReset,
}: SimulationControlsProps) {
  const setParam = <K extends keyof HydraulicErosionParams>(
    key: K,
    value: HydraulicErosionParams[K],
  ) => {
    onParamsChange({ ...params, [key]: value })
  }

  return (
    <PanelSection
      index={index}
      title="Erosion"
      tip="Hydraulic erosion on the terrain grid. Each step, rain falls on every cell and water flows downhill, split across all lower neighbours, so it gathers into streams and fills basins into pools. Fast water on slopes picks up sediment and slowly cuts the terrain; where it slows, it drops that sediment. Reset simulation restores the generated terrain."
      status={isSimulating ? <span className="live-tag">Live</span> : null}
      action={
        <button type="button" className="text-button" onClick={onReset}>
          Reset simulation
        </button>
      }
    >
      <div className="button-row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onStart}
          disabled={isSimulating}
        >
          Start
        </button>
        <button
          type="button"
          className="btn"
          onClick={onStop}
          disabled={!isSimulating}
        >
          Stop
        </button>
      </div>

      <ParamSlider
        label="Evaporation"
        tip="Fraction of each cell's water removed every step. Higher values keep water shallow and short-lived."
        value={params.evaporation}
        min={0.005}
        max={0.15}
        step={0.005}
        onChange={(value) => setParam('evaporation', value)}
      />
      <ParamSlider
        label="Erosion rate"
        tip="How quickly moving water removes terrain when it can carry more sediment than it holds."
        value={params.erosionRate}
        min={0.05}
        max={1}
        step={0.05}
        onChange={(value) => setParam('erosionRate', value)}
      />
      <ParamSlider
        label="Deposition rate"
        tip="How quickly water drops sediment back onto the terrain when it carries more than it can hold."
        value={params.depositionRate}
        min={0.05}
        max={1}
        step={0.05}
        onChange={(value) => setParam('depositionRate', value)}
      />
      <ParamSlider
        label="Sediment capacity"
        tip="How much sediment water can carry: slope × water × this value. Higher capacity cuts deeper channels."
        value={params.sedimentCapacity}
        min={0.5}
        max={12}
        step={0.5}
        onChange={(value) => setParam('sedimentCapacity', value)}
      />
      <ParamSlider
        label="Flow rate"
        tip="Fraction of a cell's water that can move each flow pass, split across its lower neighbours in proportion to how much lower their water surface is. Sediment moves with it."
        value={params.flowRate}
        min={0.1}
        max={0.9}
        step={0.05}
        onChange={(value) => setParam('flowRate', value)}
      />
      <ParamSlider
        label="Steps per frame"
        tip="Simulation steps run per animation frame. Higher is faster, but heavier on the browser."
        value={params.stepsPerFrame}
        min={1}
        max={6}
        step={1}
        onChange={(value) => setParam('stepsPerFrame', value)}
      />

      <p className="simulation-note">
        {isSimulating
          ? 'Erosion is running. Cyan shows where water collects and flows; the terrain reshapes as it erodes.'
          : 'Start to erode the terrain. The data view inspects the height, water and sediment fields.'}
      </p>
    </PanelSection>
  )
}
