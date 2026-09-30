import { useEffect, useRef, type ReactNode } from 'react'

export type FieldPreviewMode = 'height' | 'water' | 'sediment'

type NoiseMapPreviewProps = {
  values: Float32Array
  resolution: number
  mode?: FieldPreviewMode
  caption?: string
  ariaLabel?: string
  /** `stage` fills the view; `inset` is a small labelled figure. */
  variant?: 'stage' | 'inset'
  /** Heading for the `inset` variant. */
  label?: string
  /** Extra controls for the `inset` variant, placed under the label. */
  children?: ReactNode
}

function paintField(
  image: ImageData,
  values: Float32Array,
  mode: FieldPreviewMode,
): void {
  if (mode === 'height') {
    for (let i = 0; i < values.length; i++) {
      const gray = Math.round(((values[i]! + 1) / 2) * 255)
      const offset = i * 4
      image.data[offset] = gray
      image.data[offset + 1] = gray
      image.data[offset + 2] = gray
      image.data[offset + 3] = 255
    }
    return
  }

  let max = 0
  for (let i = 0; i < values.length; i++) {
    max = Math.max(max, values[i]!)
  }
  const scale = max > 1e-6 ? 1 / max : 0

  for (let i = 0; i < values.length; i++) {
    const t = Math.max(0, Math.min(1, values[i]! * scale))
    const offset = i * 4
    if (mode === 'water') {
      image.data[offset] = Math.round(20 + t * 80)
      image.data[offset + 1] = Math.round(40 + t * 180)
      image.data[offset + 2] = Math.round(60 + t * 195)
    } else {
      image.data[offset] = Math.round(30 + t * 210)
      image.data[offset + 1] = Math.round(24 + t * 150)
      image.data[offset + 2] = Math.round(16 + t * 70)
    }
    image.data[offset + 3] = 255
  }
}

const DEFAULT_CAPTIONS: Record<FieldPreviewMode, string> = {
  height: 'White is high, black is low',
  water: 'Brighter cyan = more water',
  sediment: 'Brighter sand = more sediment',
}

export function NoiseMapPreview({
  values,
  resolution,
  mode = 'height',
  caption,
  ariaLabel,
  variant = 'stage',
  label,
  children,
}: NoiseMapPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    canvas.width = resolution
    canvas.height = resolution

    const image = ctx.createImageData(resolution, resolution)
    paintField(image, values, mode)
    ctx.putImageData(image, 0, 0)
  }, [values, resolution, mode])

  if (variant === 'inset') {
    return (
      <figure className="field-map">
        {label ? <figcaption className="field-map-label">{label}</figcaption> : null}
        {children}
        <canvas
          ref={canvasRef}
          className="field-map-canvas"
          aria-label={ariaLabel ?? `${mode} field preview`}
        />
        <p className="field-map-caption" data-tone={mode === 'height' ? undefined : mode}>
          {caption ?? DEFAULT_CAPTIONS[mode]}
        </p>
      </figure>
    )
  }

  return (
    <div className="map-view">
      <canvas
        ref={canvasRef}
        className="noise-map-canvas"
        aria-label={ariaLabel ?? `${mode} field preview`}
      />
      <p className="map-caption" data-tone={mode === 'height' ? undefined : mode}>
        {caption ?? DEFAULT_CAPTIONS[mode]}
      </p>
    </div>
  )
}
