/**
 * 2D Simplex noise (Ashima / Stefan Gustavson style). Returns roughly [-1, 1].
 */

const F2 = 0.5 * (Math.sqrt(3) - 1)
const G2 = (3 - Math.sqrt(3)) / 6

const PERM = new Uint8Array(512)
const GRAD2 = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

;(() => {
  const source = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    source[i] = i
  }
  let seed = 1337
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807) % 2147483647
    const j = seed % (i + 1)
    const tmp = source[i]!
    source[i] = source[j]!
    source[j] = tmp
  }
  for (let i = 0; i < 512; i++) {
    PERM[i] = source[i & 255]!
  }
})()

function dot2(g: number[], x: number, y: number): number {
  return g[0]! * x + g[1]! * y
}

export function simplex2(x: number, y: number): number {
  const s = (x + y) * F2
  const i = Math.floor(x + s)
  const j = Math.floor(y + s)
  const t = (i + j) * G2
  const x0 = x - (i - t)
  const y0 = y - (j - t)

  const i1 = x0 > y0 ? 1 : 0
  const j1 = x0 > y0 ? 0 : 1

  const x1 = x0 - i1 + G2
  const y1 = y0 - j1 + G2
  const x2 = x0 - 1 + 2 * G2
  const y2 = y0 - 1 + 2 * G2

  const ii = i & 255
  const jj = j & 255

  let n0 = 0
  let n1 = 0
  let n2 = 0

  let t0 = 0.5 - x0 * x0 - y0 * y0
  if (t0 >= 0) {
    const g = GRAD2[PERM[ii + PERM[jj]!]! % 8]!
    t0 *= t0
    n0 = t0 * t0 * dot2(g, x0, y0)
  }

  let t1 = 0.5 - x1 * x1 - y1 * y1
  if (t1 >= 0) {
    const g = GRAD2[PERM[ii + i1 + PERM[jj + j1]!]! % 8]!
    t1 *= t1
    n1 = t1 * t1 * dot2(g, x1, y1)
  }

  let t2 = 0.5 - x2 * x2 - y2 * y2
  if (t2 >= 0) {
    const g = GRAD2[PERM[ii + 1 + PERM[jj + 1]!]! % 8]!
    t2 *= t2
    n2 = t2 * t2 * dot2(g, x2, y2)
  }

  return 70 * (n0 + n1 + n2)
}
