/**
 * 2D cellular / Worley noise: distance to nearest feature point.
 * Returns roughly [-1, 1] after remapping F1 distance.
 */

function hash2(ix: number, iy: number): [number, number] {
  let n = ix * 374761393 + iy * 668265263
  n = (n ^ (n >> 13)) * 1274126177
  const hx = ((n & 0xffff) / 0xffff)
  n = (n ^ (n >> 16)) * 2246822519
  const hy = ((n & 0xffff) / 0xffff)
  return [hx, hy]
}

export function cellular2(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  let minDist = Infinity

  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox
      const cy = yi + oy
      const [px, py] = hash2(cx, cy)
      const dx = cx + px - x
      const dy = cy + py - y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < minDist) {
        minDist = dist
      }
    }
  }

  // Typical F1 distance is about [0, ~1.4]; remap toward [-1, 1].
  return Math.min(1, Math.max(-1, minDist * 2 - 1))
}
