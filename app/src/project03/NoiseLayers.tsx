import { useEffect, useMemo, useRef } from 'react'
import { Disclosure } from '../shared/ui/instrument.tsx'
import {
  LANDSCAPE,
  NOISE_TYPE_LABEL,
  SHAPING_LABEL,
  TERRAIN_LAYERS,
  terrainLayerPreview,
  type TerrainLayer,
} from './terrain.ts'

function LayerPreview({ id, seed }: { id: string; seed: number }) {
  const values = useMemo(() => terrainLayerPreview(id, 48), [id, seed])
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const image = context.createImageData(48, 48)
    for (let i = 0; i < values.length; i += 1) {
      const gray = Math.round(((values[i]! + 1) / 2) * 255)
      const offset = i * 4
      image.data[offset] = gray
      image.data[offset + 1] = gray
      image.data[offset + 2] = gray
      image.data[offset + 3] = 255
    }
    context.putImageData(image, 0, 0)
  }, [values])

  return <canvas ref={canvasRef} className="terrain-preview" width={48} height={48} aria-label="Layer heightmap" />
}

function LayerFacts({ layer, seed }: { layer: TerrainLayer; seed: number }) {
  const wavelength = Math.round(LANDSCAPE.size / layer.frequency)
  return (
    <>
      <div className="control-row">
        <span className="control-label">Type</span>
        <span className="control-value">{NOISE_TYPE_LABEL[layer.noiseType]}</span>
      </div>
      <div className="control-row">
        <span className="control-label">Shaping</span>
        <span className="control-value">{SHAPING_LABEL[layer.shaping]}</span>
      </div>
      <div className="control-row">
        <span className="control-label">Frequency</span>
        <span className="control-value">{layer.frequency.toFixed(2)}</span>
      </div>
      <div className="control-row">
        <span className="control-label">Wavelength</span>
        <span className="control-value">{wavelength} m</span>
      </div>
      <div className="control-row">
        <span className="control-label">Amplitude</span>
        <span className="control-value">{layer.amplitude} m</span>
      </div>
      <div className="control-row">
        <span className="control-label">Weight</span>
        <span className="control-value">{layer.weight}</span>
      </div>
      <LayerPreview id={layer.id} seed={seed} />
      <p className="eco-note">White is high, black is low.</p>
    </>
  )
}

/** Read-only view of the layers that build the current seed. */
export function NoiseLayers({ seed }: { seed: number }) {
  return (
    <Disclosure label="Noise layers">
      <p className="eco-note">
        Highland regions place several massifs of different height and width across the island. The mountain network branches along them, hills fill the skirts, and the drainage network carves channels down into the lowlands. Every layer shares the warped domain.
      </p>
      {TERRAIN_LAYERS.map((layer) => (
        <Disclosure key={layer.id} label={layer.name}>
          <LayerFacts layer={layer} seed={seed} />
        </Disclosure>
      ))}
    </Disclosure>
  )
}
