/**
 * 2D value noise: random values at lattice points, smoothly interpolated.
 * Returns roughly [-1, 1].
 */

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a)
}

function hash2(ix: number, iy: number): number {
  let n = ix * 374761393 + iy * 668265263
  n = (n ^ (n >> 13)) * 1274126177
  n = n ^ (n >> 16)
  return (n & 0xffff) / 0xffff * 2 - 1
}

export function value2(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = fade(xf)
  const v = fade(yf)

  const n00 = hash2(xi, yi)
  const n10 = hash2(xi + 1, yi)
  const n01 = hash2(xi, yi + 1)
  const n11 = hash2(xi + 1, yi + 1)

  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v)
}
