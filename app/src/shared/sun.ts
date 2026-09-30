/** Unit vector towards the sun; azimuth 0° is +Z, 90° is +X. */
export function sunDirection(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const azimuth = (azimuthDeg * Math.PI) / 180
  const elevation = (elevationDeg * Math.PI) / 180
  return [
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  ]
}
