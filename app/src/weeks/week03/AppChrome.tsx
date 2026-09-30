import { useEffect, useState, type ReactNode } from 'react'
import {
  NOISE_TYPE_OPTIONS,
  SHAPING_OPTIONS,
  shapingNeedsParam,
  shapingParamLabel,
  shapingParamRange,
  type NoiseLayer,
  type NoiseSettings,
  type NoiseType,
  type ShapingType,
} from '../../shared/noise/index.ts'
import {
  CONTROL_TOOLTIPS,
  NOISE_EXPLANATIONS,
  SHAPING_EXPLANATIONS,
} from './noiseExplanations.ts'
import {
  CollapsibleRow,
  ControlField,
  Disclosure,
  InstrumentPanel,
  PanelSection,
  Slider,
} from '../../shared/ui/instrument.tsx'

type AppChromeProps = {
  settings: NoiseSettings
  onChange: (next: NoiseSettings) => void
  onAddLayer: () => void
  onRemoveLayer: (layerId: string) => void
  /** Panel-level tools under the title (Reset · Save · Load). */
  utilities?: ReactNode
  /** Extra panel sections for the active view (e.g. erosion). */
  children?: ReactNode
}

function shapingParamTooltip(shaping: ShapingType): string {
  switch (shaping) {
    case 'turbulence':
      return CONTROL_TOOLTIPS.shapingParam.turbulence
    case 'terracing':
      return CONTROL_TOOLTIPS.shapingParam.terracing
    case 'power':
      return CONTROL_TOOLTIPS.shapingParam.power
    case 'domainWarp':
      return CONTROL_TOOLTIPS.shapingParam.domainWarp
    default:
      return CONTROL_TOOLTIPS.shaping
  }
}

type LayerRowProps = {
  layer: NoiseLayer
  index: number
  isExpanded: boolean
  canRemove: boolean
  onToggleExpanded: () => void
  onChange: (next: NoiseLayer) => void
  onRemove: () => void
}

function LayerRow({
  layer,
  index,
  isExpanded,
  canRemove,
  onToggleExpanded,
  onChange,
  onRemove,
}: LayerRowProps) {
  const showShapeParam = shapingNeedsParam(layer.shaping)
  const shapeRange = shapingParamRange(layer.shaping)
  const noiseInfo = NOISE_EXPLANATIONS[layer.noiseType]
  const shapingInfo = SHAPING_EXPLANATIONS[layer.shaping]

  return (
    <CollapsibleRow
      title={`Layer ${index + 1}`}
      summary={`${layer.noiseType} · ${layer.shaping} · w ${layer.weight.toFixed(2)}`}
      expanded={isExpanded}
      enabled={layer.enabled}
      onToggle={onToggleExpanded}
      onEnabledChange={(enabled) => onChange({ ...layer, enabled })}
    >
      <ControlField label="Noise type" tip={CONTROL_TOOLTIPS.noiseType}>
        <select
          value={layer.noiseType}
          onChange={(event) =>
            onChange({ ...layer, noiseType: event.target.value as NoiseType })
          }
        >
          {NOISE_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </ControlField>

      <ControlField
        label="Frequency / scale"
        value={layer.frequency.toFixed(1)}
        tip={CONTROL_TOOLTIPS.frequency}
      >
        <Slider
          label="Frequency / scale"
          min={0.5}
          max={12}
          step={0.1}
          value={layer.frequency}
          onChange={(frequency) => onChange({ ...layer, frequency })}
        />
      </ControlField>

      <ControlField
        label="Amplitude"
        value={layer.amplitude.toFixed(2)}
        tip={CONTROL_TOOLTIPS.amplitude}
      >
        <Slider
          label="Amplitude"
          min={0}
          max={3}
          step={0.05}
          value={layer.amplitude}
          onChange={(amplitude) => onChange({ ...layer, amplitude })}
        />
      </ControlField>

      <ControlField
        label="Blend / weight"
        value={layer.weight.toFixed(2)}
        tip={CONTROL_TOOLTIPS.weight}
      >
        <Slider
          label="Blend / weight"
          min={0}
          max={3}
          step={0.05}
          value={layer.weight}
          onChange={(weight) => onChange({ ...layer, weight })}
        />
      </ControlField>

      <ControlField label="Shaping" tip={CONTROL_TOOLTIPS.shaping}>
        <select
          value={layer.shaping}
          onChange={(event) => {
            const shaping = event.target.value as ShapingType
            const range = shapingParamRange(shaping)
            onChange({
              ...layer,
              shaping,
              shapingParam: Math.min(
                range.max,
                Math.max(range.min, layer.shapingParam),
              ),
            })
          }}
        >
          {SHAPING_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </ControlField>

      {showShapeParam ? (
        <ControlField
          label={shapingParamLabel(layer.shaping)}
          value={
            Number.isInteger(shapeRange.step)
              ? String(layer.shapingParam)
              : layer.shapingParam.toFixed(2)
          }
          tip={shapingParamTooltip(layer.shaping)}
        >
          <Slider
            label={shapingParamLabel(layer.shaping)}
            min={shapeRange.min}
            max={shapeRange.max}
            step={shapeRange.step}
            value={layer.shapingParam}
            onChange={(shapingParam) => onChange({ ...layer, shapingParam })}
          />
        </ControlField>
      ) : null}

      <Disclosure label="Explanation">
        <p className="explain-text">{shapingInfo.summary}</p>
        <code className="explain-eq">{shapingInfo.equation}</code>
        {shapingInfo.paramNote ? (
          <p className="explain-param">{shapingInfo.paramNote}</p>
        ) : null}
        <p className="explain-noise">
          <strong>Noise:</strong> {noiseInfo.summary}
        </p>
        <code className="explain-eq">{noiseInfo.equation}</code>
      </Disclosure>

      <div className="row-foot">
        <button
          type="button"
          className="text-button"
          onClick={onRemove}
          disabled={!canRemove}
        >
          Remove layer
        </button>
      </div>
    </CollapsibleRow>
  )
}

/** Week 03 instrument panel: field resolution and noise layers. */
export function AppChrome({
  settings,
  onChange,
  onAddLayer,
  onRemoveLayer,
  utilities,
  children,
}: AppChromeProps) {
  const [expandedLayerId, setExpandedLayerId] = useState(
    settings.layers[0]?.id ?? '',
  )

  useEffect(() => {
    const hasExpandedLayer = settings.layers.some(
      (layer) => layer.id === expandedLayerId,
    )

    if (!hasExpandedLayer) {
      setExpandedLayerId(settings.layers[0]?.id ?? '')
    }
  }, [expandedLayerId, settings.layers])

  return (
    <InstrumentPanel label="Terrain" utilities={utilities}>
      <PanelSection
        index="01"
        title="Field"
        tip="The square grid of height samples that the noise layers fill, and that the terrain and erosion run on."
      >
        <div data-learn="resolution">
          <ControlField
            label="Grid resolution"
            value={String(settings.resolution)}
            tip={CONTROL_TOOLTIPS.resolution}
          >
            <Slider
              label="Grid resolution"
              min={16}
              max={128}
              step={1}
              value={settings.resolution}
              onChange={(resolution) => onChange({ ...settings, resolution })}
            />
          </ControlField>
        </div>
      </PanelSection>

      <PanelSection
        index="02"
        title="Noise layers"
        tip={CONTROL_TOOLTIPS.layers}
        action={
          <button type="button" className="text-button" onClick={onAddLayer}>
            + Add layer
          </button>
        }
      >
        <div className="row-list">
          {settings.layers.map((layer, index) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              index={index}
              isExpanded={expandedLayerId === layer.id}
              canRemove={settings.layers.length > 1}
              onToggleExpanded={() =>
                setExpandedLayerId((current) =>
                  current === layer.id ? '' : layer.id,
                )
              }
              onRemove={() => onRemoveLayer(layer.id)}
              onChange={(nextLayer) =>
                onChange({
                  ...settings,
                  layers: settings.layers.map((currentLayer) =>
                    currentLayer.id === nextLayer.id ? nextLayer : currentLayer,
                  ),
                })
              }
            />
          ))}
        </div>
      </PanelSection>

      {children}
    </InstrumentPanel>
  )
}
