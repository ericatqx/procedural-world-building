import { BufferAttribute, BufferGeometry } from 'three'

export type RibbonPoint = {
  x: number
  y: number
  z: number
  halfWidth: number
  /** Values for the custom attributes at this point. */
  values: Record<string, number>
}

/**
 * Collects triangles with named float attributes (e.g. `aFlow`) and builds
 * one indexed BufferGeometry with vertex normals.
 */
export class MeshBuilder {
  private positions: number[] = []
  private indices: number[] = []
  private attributes: Record<string, number[]>

  constructor(attributeNames: string[]) {
    this.attributes = Object.fromEntries(attributeNames.map((name) => [name, []]))
  }

  vertex(x: number, y: number, z: number, values: Record<string, number>): number {
    this.positions.push(x, y, z)
    for (const [name, list] of Object.entries(this.attributes)) {
      list.push(values[name] ?? 0)
    }
    return this.positions.length / 3 - 1
  }

  triangle(a: number, b: number, c: number) {
    this.indices.push(a, b, c)
  }

  /**
   * A strip of constant width across `side` (horizontal, perpendicular to
   * the direction of travel), facing up for strips that run level. Sets
   * `aAcross` to −1 on the left edge and +1 on the right, if registered.
   */
  ribbon(points: RibbonPoint[], side?: (k: number) => [number, number]) {
    if (points.length < 2) {
      return
    }
    let previous: [number, number] | null = null
    for (const [k, point] of points.entries()) {
      const before = points[Math.max(0, k - 1)]!
      const after = points[Math.min(points.length - 1, k + 1)]!
      let [sx, sz] = side ? side(k) : [-(after.z - before.z), after.x - before.x]
      const length = Math.hypot(sx, sz) || 1
      sx /= length
      sz /= length
      const left = this.vertex(
        point.x - sx * point.halfWidth,
        point.y,
        point.z - sz * point.halfWidth,
        { ...point.values, aAcross: -1 },
      )
      const right = this.vertex(
        point.x + sx * point.halfWidth,
        point.y,
        point.z + sz * point.halfWidth,
        { ...point.values, aAcross: 1 },
      )
      if (previous) {
        const [previousLeft, previousRight] = previous
        this.triangle(previousLeft, previousRight, left)
        this.triangle(previousRight, right, left)
      }
      previous = [left, right]
    }
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3))
    for (const [name, list] of Object.entries(this.attributes)) {
      geometry.setAttribute(name, new BufferAttribute(new Float32Array(list), 1))
    }
    geometry.setIndex(this.indices)
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
  }
}
