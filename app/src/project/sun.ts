import { sunDirection } from '../shared/sun.ts'

/**
 * Shadow Ecology 0.1 — a stylised day. The sun rises in the east (+X) at
 * 06:00, crosses the south (−Z) at noon and sets in the west (−X) at 18:00.
 * Elevation follows a sine arc peaking at `noonElevation`.
 */
export const SUNRISE_HOUR = 6
export const SUNSET_HOUR = 18

/** Below this elevation the light is kept at the horizon so shadows stay stable. */
const MIN_LIGHT_ELEVATION = 2

export type SunState = {
  /** Degrees; 0° is +Z, 90° is +X (east), 180° is −Z (south). */
  azimuth: number
  /** Degrees above the horizon; negative at night. */
  elevation: number
  /** Unit vector towards the light, clamped to just above the horizon. */
  direction: [number, number, number]
  /** 0 at night, 1 in full day; scales the light's intensity. */
  daylight: number
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export function sunAt(hour: number, noonElevation: number): SunState {
  const dayFraction = (hour - SUNRISE_HOUR) / (SUNSET_HOUR - SUNRISE_HOUR)
  const azimuth = (((90 + 180 * dayFraction) % 360) + 360) % 360
  const elevation = noonElevation * Math.sin(Math.PI * dayFraction)
  return {
    azimuth,
    elevation,
    direction: sunDirection(azimuth, Math.max(elevation, MIN_LIGHT_ELEVATION)),
    daylight: smoothstep(-2, 4, elevation),
  }
}

/** Points along the day's arc, from sunrise to sunset, at `radius`. */
export function sunPath(noonElevation: number, radius: number, samples = 48): [number, number, number][] {
  return Array.from({ length: samples + 1 }, (_, i) => {
    const hour = SUNRISE_HOUR + ((SUNSET_HOUR - SUNRISE_HOUR) * i) / samples
    const { azimuth, elevation } = sunAt(hour, noonElevation)
    const [x, y, z] = sunDirection(azimuth, elevation)
    return [x * radius, y * radius, z * radius]
  })
}

export function formatHour(hour: number): string {
  const wrapped = ((hour % 24) + 24) % 24
  const minutes = Math.round(wrapped * 60) % (24 * 60)
  const hh = Math.floor(minutes / 60)
  const mm = minutes % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}
