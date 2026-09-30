import {
  ControlField,
  PanelSection,
  Segmented,
  Slider,
  Toggle,
  type SegmentOption,
} from '../../shared/ui/instrument.tsx'
import type { TerrainFogSettings } from './terrainConfig.ts'
import type { TerrainColorMode } from './terrainContours.ts'

/** Instrument-panel section for the erosion simulation's environmental input. */
export function EnvironmentSection({
  index,
  rain,
  onRainChange,
}: {
  index: string
  rain: number
  onRainChange: (next: number) => void
}) {
  return (
    <PanelSection
      index={index}
      title="Environment"
      tip="Conditions around the terrain that drive the erosion simulation."
    >
      <ControlField
        label="Rain"
        value={rain.toFixed(3)}
        tip="Water added to every cell each step. More rain means more runoff and faster carving."
      >
        <Slider label="Rain" min={0} max={0.05} step={0.001} value={rain} onChange={onRainChange} />
      </ControlField>
    </PanelSection>
  )
}

const COLOR_MODES: readonly SegmentOption<TerrainColorMode>[] = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'elevation', label: 'Elevation' },
]

type AppearanceSectionProps = {
  index: string
  fog: TerrainFogSettings
  onFogChange: (next: TerrainFogSettings) => void
  colorMode?: TerrainColorMode
  /** When given, the section shows the Neutral / Elevation color mode. */
  onColorModeChange?: (next: TerrainColorMode) => void
}

/**
 * Instrument-panel section for how the world is drawn: terrain color mode and
 * fog. Rendering only. Fog distances appear only while fog is on.
 */
export function AppearanceSection({
  index,
  fog,
  onFogChange,
  colorMode = 'neutral',
  onColorModeChange,
}: AppearanceSectionProps) {
  return (
    <PanelSection
      index={index}
      title="Appearance"
      tip="How the world is drawn. These change rendering only, not the terrain or simulation data."
    >
      {onColorModeChange ? (
        <div data-learn="color-mode">
          <ControlField
            label="Color mode"
            tip="Neutral shows form through light and shadow on an off-white surface. Elevation maps height to a muted blue-to-gray ramp; the same colour always means the same height."
          >
            <Segmented
              label="Color mode"
              options={COLOR_MODES}
              value={colorMode}
              onChange={onColorModeChange}
            />
          </ControlField>
        </div>
      ) : null}
      <Toggle
        label="Fog"
        checked={fog.enabled}
        onChange={(enabled) => onFogChange({ ...fog, enabled })}
      />
      {fog.enabled ? <FogDistances fog={fog} onFogChange={onFogChange} /> : null}
    </PanelSection>
  )
}

function FogDistances({
  fog,
  onFogChange,
}: Pick<AppearanceSectionProps, 'fog' | 'onFogChange'>) {
  return (
    <>
      <ControlField
        label="Fog near"
        value={fog.near.toFixed(1)}
        tip="Distance from the camera where fog begins. Closer values haze more of the terrain."
      >
        <Slider
          label="Fog near"
          min={0.5}
          max={12}
          step={0.1}
          value={fog.near}
          onChange={(near) =>
            onFogChange({
              ...fog,
              near,
              far: Math.max(fog.far, near + 0.5),
            })
          }
        />
      </ControlField>
      <ControlField
        label="Fog far"
        value={fog.far.toFixed(1)}
        tip="Distance where fog becomes fully opaque and the terrain fades into the black field."
      >
        <Slider
          label="Fog far"
          min={2}
          max={40}
          step={0.5}
          value={fog.far}
          onChange={(far) =>
            onFogChange({
              ...fog,
              far,
              near: Math.min(fog.near, far - 0.5),
            })
          }
        />
      </ControlField>
    </>
  )
}
