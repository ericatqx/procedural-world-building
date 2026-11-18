import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three'
import { sunAt } from '../project/sun.ts'
import { clamp01, smoothstep } from '../project02/core.ts'
import { chooseSite, skin, waterBearing } from './livingArchitecture.ts'
import type { Population } from './livingEcology.ts'
import { FR_CELL, FR_LEVELS, FR_MAX_AGE, FR_NX, FR_NY, FR_NZ, FR_TICKS, frontsField, growFrontsCore, type Fronts, type FrontsInputs } from './livingFrontsCore.ts'
import { surfaceNets } from './livingMesh.ts'
import { landscapeHeight } from './terrain.ts'
import type { World } from './world.ts'

export { FR_LEVELS, FR_MAX_AGE }
export type { Fronts }

/**
 * Shadow Ecology 0.3 — Living Architecture, the fronts prototype (?architecture=fronts; `&age=0.6` holds an age, 0 to 1.7).
 * The growth rules are in livingFrontsCore.ts. This file gives them a site, the environment inputs, and the surface: the
 * field at an age is meshed by surface nets on a 2 m grid (about 10 to 20 ms a surface), for FR_LEVELS ages, one a frame, kept.
 */
export function growFronts(world: World, seed: number, population: Population | null): Fronts {
  const [sx, sz] = chooseSite(world, seed)
  const base = population?.organisms[0]?.base ?? { light: 0.7, moisture: 0.5, resource: 0.6, waterDist: 90 }
  const sun = sunAt(12, 55).direction
  const wb = waterBearing(world, sx, sz)
  const inputs: FrontsInputs = {
    light: clamp01(base.light),
    moisture: clamp01(base.moisture),
    sunAzimuth: Math.atan2(sun[0], sun[2]),
    waterAzimuth: Math.atan2(wb[0], wb[2]),
    activity: 0,
  }
  return growFrontsCore([sx, sz], inputs, seed, landscapeHeight)
}

const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** The surface at an age, with the growth record the grown material reads. */
export function frontsMesh(fr: Fronts, age: number): BufferGeometry {
  const { field, owner } = frontsField(fr, age)
  const net = surfaceNets(field, FR_NX, FR_NY, FR_NZ, [0, 0, 0], 0)
  const count = net.positions.length / 3
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const colours = new Float32Array(count * 3)
  const recordA = new Float32Array(count * 4)
  const recordB = new Float32Array(count * 4)
  const arrival = new Float32Array(count)
  const decay = new Float32Array(count).fill(9)
  const x0 = fr.site[0] - (FR_NX * FR_CELL) / 2
  const z0 = fr.site[1] - (FR_NZ * FR_CELL) / 2
  for (let v = 0; v < count; v += 1) {
    const gx = net.positions[v * 3]!
    const gy = net.positions[v * 3 + 1]!
    const gz = net.positions[v * 3 + 2]!
    positions[v * 3] = x0 + (gx + 0.5) * FR_CELL
    positions[v * 3 + 1] = fr.y0 + (gy + 0.5) * FR_CELL
    positions[v * 3 + 2] = z0 + (gz + 0.5) * FR_CELL
    normals[v * 3] = net.normals[v * 3]!
    normals[v * 3 + 1] = net.normals[v * 3 + 1]!
    normals[v * 3 + 2] = net.normals[v * 3 + 2]!
    const ci = Math.max(0, Math.min(FR_NX - 1, Math.round(gx)))
    const cj = Math.max(0, Math.min(FR_NY - 1, Math.round(gy)))
    const ck = Math.max(0, Math.min(FR_NZ - 1, Math.round(gz)))
    const who = owner[(ck * FR_NY + cj) * FR_NX + ci]!
    const bornAge = who >= 0 ? fr.born[who]! / FR_TICKS : 0
    const ground = fr.ground[ck * FR_NX + ci]!
    const above = Math.max(0, positions[v * 3 + 1]! - ground)
    const ny = normals[v * 3 + 1]!
    const colour = skin(above, 0.3 + 0.3 * (1 - Math.abs(ny)), 1, fr.moisture)
    colours.set([colour.r, colour.g, colour.b], v * 3)
    recordA.set([clamp01(bornAge), 0.8, above < 3 ? 0.25 : 0.05, 0], v * 4)
    recordB.set([clamp01(0.3 + 0.55 * Math.max(0, ny)), clamp01(fr.moisture * (1 - smoothstep(0, 7, above))), who >= 0 ? hash(who, 1) : 0.5, 0.5], v * 4)
    arrival[v] = bornAge
    if (who >= 0) decay[v] = 1.05 + 0.5 * (1 - fr.vul[who]!)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('color', new BufferAttribute(colours, 3))
  geometry.setAttribute('aGrowthA', new BufferAttribute(recordA, 4))
  geometry.setAttribute('aGrowthB', new BufferAttribute(recordB, 4))
  geometry.setAttribute('aArrival', new BufferAttribute(arrival, 1))
  geometry.setAttribute('aDecay', new BufferAttribute(decay, 1))
  geometry.setIndex(new BufferAttribute(new Uint32Array(net.indices), 1))
  geometry.boundingSphere = new Sphere(new Vector3(fr.site[0], fr.y0 + 30, fr.site[1]), 110)
  return geometry
}
