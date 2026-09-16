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
} from '../noise/index.ts'
import {
  CONTROL_TOOLTIPS,
  NOISE_EXPLANATIONS,
  SHAPING_EXPLANATIONS,
} from '../noise/explanations.ts'

type AppChromeProps = {
  settings: NoiseSettings
  onChange: (next: NoiseSettings) => void
  onAddLayer: () => void
  onRemoveLayer: (layerId: string) => void
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

type LayerCardProps = {
  layer: NoiseLayer
  index: number
  isExpanded: boolean
  canRemove: boolean
  onToggleExpanded: () => void
  onChange: (next: NoiseLayer) => void
  onRemove: () => void
}

function LayerCard({
  layer,
  index,
  isExpanded,
  canRemove,
  onToggleExpanded,
  onChange,
  onRemove,
}: LayerCardProps) {
  const [showExplanation, setShowExplanation] = useState(false)
  const showShapeParam = shapingNeedsParam(layer.shaping)
  const shapeRange = shapingParamRange(layer.shaping)
  const noiseInfo = NOISE_EXPLANATIONS[layer.noiseType]
  const shapingInfo = SHAPING_EXPLANATIONS[layer.shaping]

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
            <span className="layer-title">Layer {index + 1}</span>
            <span className="layer-chip">{layer.noiseType}</span>
            <span className="layer-chip">{layer.shaping}</span>
            <span className="layer-chip">w {layer.weight.toFixed(2)}</span>
          </span>
          <span className="layer-summary">
            {isExpanded ? 'Hide controls' : 'Show controls'}
          </span>
        </button>
        <div className="layer-actions">
          <label className="layer-enabled">
            <input
              type="checkbox"
              checked={layer.enabled}
              onChange={(event) =>
                onChange({
                  ...layer,
                  enabled: event.target.checked,
                })
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
            label="Noise type"
            tip={CONTROL_TOOLTIPS.noiseType}
          >
            <select
              value={layer.noiseType}
              onChange={(event) =>
                onChange({
                  ...layer,
                  noiseType: event.target.value as NoiseType,
                })
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
            label={`Frequency / scale (${layer.frequency.toFixed(1)})`}
            tip={CONTROL_TOOLTIPS.frequency}
          >
            <input
              type="range"
              min={0.5}
              max={12}
              step={0.1}
              value={layer.frequency}
              onChange={(event) =>
                onChange({
                  ...layer,
                  frequency: Number(event.target.value),
                })
              }
            />
          </ControlField>

          <ControlField
            label={`Amplitude (${layer.amplitude.toFixed(2)})`}
            tip={CONTROL_TOOLTIPS.amplitude}
          >
            <input
              type="range"
              min={0}
              max={3}
              step={0.05}
              value={layer.amplitude}
              onChange={(event) =>
                onChange({
                  ...layer,
                  amplitude: Number(event.target.value),
                })
              }
            />
          </ControlField>

          <ControlField
            label={`Blend / weight (${layer.weight.toFixed(2)})`}
            tip={CONTROL_TOOLTIPS.weight}
          >
            <input
              type="range"
              min={0}
              max={3}
              step={0.05}
              value={layer.weight}
              onChange={(event) =>
                onChange({
                  ...layer,
                  weight: Number(event.target.value),
                })
              }
            />
          </ControlField>

          <div className="control-field shaping-block">
            <div className="control-tip">
              <span className="control-label">Shaping</span>
              <div className="control-tip-bubble" role="tooltip">
                {CONTROL_TOOLTIPS.shaping}
              </div>
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
            </div>

            <label className="explain-toggle">
              <input
                type="checkbox"
                checked={showExplanation}
                onChange={(event) => setShowExplanation(event.target.checked)}
              />
              <span>Show explanation</span>
            </label>

            {showExplanation ? (
              <div className="explain-box" aria-live="polite">
                <p className="explain-text">{shapingInfo.summary}</p>
                <code className="explain-eq">{shapingInfo.equation}</code>
                {shapingInfo.paramNote ? (
                  <p className="explain-param">{shapingInfo.paramNote}</p>
                ) : null}
                <p className="explain-noise">
                  <strong>Noise:</strong> {noiseInfo.summary}
                </p>
                <code className="explain-eq">{noiseInfo.equation}</code>
              </div>
            ) : null}
          </div>

          {showShapeParam ? (
            <ControlField
              label={`${shapingParamLabel(layer.shaping)} (${
                Number.isInteger(shapeRange.step)
                  ? layer.shapingParam
                  : layer.shapingParam.toFixed(2)
              })`}
              tip={shapingParamTooltip(layer.shaping)}
            >
              <input
                type="range"
                min={shapeRange.min}
                max={shapeRange.max}
                step={shapeRange.step}
                value={layer.shapingParam}
                onChange={(event) =>
                  onChange({
                    ...layer,
                    shapingParam: Number(event.target.value),
                  })
                }
              />
            </ControlField>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

export function AppChrome({
  settings,
  onChange,
  onAddLayer,
  onRemoveLayer,
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
    <div className="app-chrome">
      <header className="app-title-bar">
        <p className="app-kicker">Studio</p>
        <h1 className="app-title">Procedural World Building</h1>
      </header>

      <aside className="side-panel" aria-label="Noise controls">
        <h2 className="panel-title">Controls</h2>
        <p className="panel-hint">
          Same blended layers feed the 2D map and the 3D terrain. Drag to orbit
          in 3D.
        </p>

        <ControlField
          label={`Grid resolution (${settings.resolution})`}
          tip={CONTROL_TOOLTIPS.resolution}
        >
          <input
            type="range"
            min={16}
            max={128}
            step={1}
            value={settings.resolution}
            onChange={(event) =>
              onChange({
                ...settings,
                resolution: Number(event.target.value),
              })
            }
          />
        </ControlField>

        <div className="layers-header control-tip">
          <span className="control-label">Noise layers</span>
          <div className="control-tip-bubble" role="tooltip">
            {CONTROL_TOOLTIPS.layers}
          </div>
          <button type="button" className="layer-add" onClick={onAddLayer}>
            Add layer
          </button>
        </div>

        <div className="control-list">
          {settings.layers.map((layer, index) => (
            <LayerCard
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
      </aside>
    </div>
  )
}
