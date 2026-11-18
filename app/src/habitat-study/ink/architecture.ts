import { Color, type BufferGeometry } from 'three'
import { INK, Pen, wobble, type V3 } from './paper.ts'

/**
 * The architecture drawn: lines cut across its own surface at fixed heights, so they wrap its form as its strata do. On the walls, broad courses, one
 * in three gone over again in sepia; in its hollows and undersides, the courses come closer (the shade under a shelf is drawn by line density, not
 * by grey); and on the faces turned from the sun at this hour, a course between each pair: contour hatching that moves with the light. A young
 * organism is drawn lightly: fewer courses, in graphite only, as a form still being found.
 */
export type ArchLines = { medium: Pen; fine: Pen; faint: Pen }

export function drawArchitecture(geometry: BufferGeometry, young: boolean, sun: V3 | null, base: number): ArchLines {
  const pens: ArchLines = { medium: new Pen('arch-medium'), fine: new Pen('arch-fine'), faint: new Pen('arch-faint') }
  const sepia = new Color(INK.sepia)
  const graphite = new Color(INK.graphite)
  const faint = new Color(INK.faint)
  const pos = geometry.getAttribute('position')
  const idx = geometry.index
  const count = idx ? idx.count : pos.count
  const at = (k: number) => (idx ? idx.getX(k) : k)
  const p: V3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  const course = young ? 2.6 : 2.1
  for (let t = 0; t < count; t += 3) {
    for (let q = 0; q < 3; q += 1) {
      const v = at(t + q)
      p[q] = [pos.getX(v), pos.getY(v), pos.getZ(v)]
    }
    const [a, b, c] = p as [V3, V3, V3]
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const nl = Math.hypot(nx, ny, nz) || 1
    nx /= nl
    ny /= nl
    nz /= nl
    const lo = Math.min(a[1], b[1], c[1])
    const hi = Math.max(a[1], b[1], c[1])
    const cut = (spacing: number, offset: number, pen: Pen, ink: Color, lift: number, accent?: { every: number; pen: Pen; ink: Color }) => {
      for (let k = Math.ceil((lo - base - offset) / spacing); base + offset + k * spacing <= hi; k += 1) {
        const y = base + offset + k * spacing
        const hits: V3[] = []
        for (const [e0, e1] of [[a, b], [b, c], [c, a]] as [V3, V3][]) {
          if (e0[1] < y === e1[1] < y) continue
          const s = (y - e0[1]) / (e1[1] - e0[1])
          hits.push([e0[0] + (e1[0] - e0[0]) * s + nx * 0.07, y + ny * 0.07, e0[2] + (e1[2] - e0[2]) * s + nz * 0.07])
        }
        if (hits.length < 2) continue
        const [h0, h1] = hits as [V3, V3]
        // The pen lifts now and then along a course, so the courses read as drawn, not ruled.
        if (wobble(h0[0] * 0.45, y * 0.9 + k, h0[2] * 0.45) < -1 + lift * 2) continue
        if (accent && ((k % accent.every) + accent.every) % accent.every === 0) accent.pen.seg(h0, h1, accent.ink)
        else pen.seg(h0, h1, ink)
      }
    }
    const wall = Math.abs(ny) < 0.78
    if (wall) cut(course, 0, young ? pens.faint : pens.fine, young ? faint : graphite, 0.22, young ? undefined : { every: 3, pen: pens.medium, ink: sepia })
    if (young) continue
    // Only the undersides that turn down steeply: a near-flat ceiling cut by level planes would give long, sweeping lines, not hatching.
    if (ny < -0.3 && ny > -0.85) cut(0.55, 0.2, pens.faint, graphite, 0.12)
    if (sun && wall && nx * sun[0] + ny * sun[1] + nz * sun[2] < -0.1) cut(course / 3, course / 3, pens.faint, graphite, 0.3)
  }
  return pens
}
