import { DataTexture, LinearFilter, RedFormat, RGFormat, UnsignedByteType, type BufferGeometry } from 'three'
import { smoothstep } from '../project02/core.ts'
import { landscapeHeight } from './terrain.ts'

/**
 * Shadow Ecology 0.3 — what each structure does to the ground it stands on, as one island-wide texture the terrain's material reads (vegGround.ts): where
 * mineral has crept out over the soil as pale sediment, where weathered rock lies, and the damp, darker fringe where it gives way to the ground.
 *
 * The influence is not drawn from a circle. It is stamped from the structure's own surface: every point of the mesh that stands within a few metres of the
 * ground puts its weight on the cells around it (falling off over about ten metres), so it follows the actual footprint and its irregular edge, the ground it
 * stands on, and the stage it is at: a young structure's small base stamps a small area, a mature one's broad base a broad one, and remains stamp what is
 * left, at a lower strength (the minerals they leave behind). Each structure keeps what it stamped, so a new mesh for it replaces the old, and one that has
 * gone leaves nothing. The texture is 4 m per texel over the island and is rebuilt (cheaply, on the CPU) at most every half second after a change.
 */
const N = 1024
const SIZE = 4096
const CELL = SIZE / N
/** How far from a surface point its weight reaches, in cells (about 10 m), and how near the ground a point must be to count. */
const REACH = 3
const NEAR = 3.2

const sum = new Float32Array(N * N)
const own = new Map<number, { cells: Int32Array; weights: Float32Array }>()
let dirty = false
let lastFlush = 0
let lastHabitat = 0
const data = new Uint8Array(N * N)
export const archGround = { texture: { value: makeTexture() }, on: { value: 1 } }

function makeTexture(): DataTexture {
  const t = new DataTexture(data, N, N, RedFormat, UnsignedByteType)
  t.magFilter = LinearFilter
  t.minFilter = LinearFilter
  t.needsUpdate = true
  return t
}

function remove(index: number) {
  const mine = own.get(index)
  if (!mine) return
  for (let k = 0; k < mine.cells.length; k += 1) sum[mine.cells[k]!] = Math.max(0, sum[mine.cells[k]!]! - mine.weights[k]!)
  own.delete(index)
  dirty = true
}

/** Puts a structure's footprint on the ground: `strength` is 1 for a living structure and less for what is left of a dead one. */
export function stampFootprint(index: number, geometry: BufferGeometry, strength: number) {
  remove(index)
  const pos = geometry.getAttribute('position')
  if (!pos) return
  const touched = new Map<number, number>()
  const stride = Math.max(1, Math.floor(pos.count / 6000))
  for (let v = 0; v < pos.count; v += stride) {
    const x = pos.getX(v)
    const z = pos.getZ(v)
    const above = pos.getY(v) - landscapeHeight(x, z)
    if (above > NEAR || above < -3) continue
    const ci = Math.floor((x + SIZE / 2) / CELL)
    const cj = Math.floor((z + SIZE / 2) / CELL)
    for (let dj = -REACH; dj <= REACH; dj += 1) {
      for (let di = -REACH; di <= REACH; di += 1) {
        const i = ci + di
        const j = cj + dj
        if (i < 0 || j < 0 || i >= N || j >= N) continue
        const d = Math.hypot(di, dj) / REACH
        if (d > 1) continue
        const w = (1 - smoothstep(0, 1, d)) * 0.12 * strength
        const key = j * N + i
        touched.set(key, (touched.get(key) ?? 0) + w)
      }
    }
  }
  const cells = new Int32Array(touched.size)
  const weights = new Float32Array(touched.size)
  let k = 0
  for (const [key, w] of touched) {
    // A cell is full at 1: how much one structure can give it is capped, so stacked points do not saturate the whole base.
    const give = Math.min(w, 1)
    cells[k] = key
    weights[k] = give
    sum[key] = sum[key]! + give
    k += 1
  }
  own.set(index, { cells, weights })
  dirty = true
}

/** A structure that is gone leaves no footprint. */
export function clearFootprint(index: number) {
  remove(index)
}

/** Writes the texture when something changed, at most every half second. Call each frame. */
export function flushGround(now: number) {
  if (habitatDirty && now - lastHabitat > 0.5) {
    lastHabitat = now
    flushHabitat(now)
  }
  if (!dirty || now - lastFlush < 0.5) return
  dirty = false
  lastFlush = now
  for (let k = 0; k < sum.length; k += 1) data[k] = Math.min(255, sum[k]! * 255)
  archGround.texture.value.needsUpdate = true
}

/**
 * THE SHADE THE STRUCTURES CAST. Each architecture tile (96 m, 3 m cells) of the vegetation system reads, from the drawn structure itself, how much of the day's sun
 * the structure keeps off each cell (a shadow swept through the day's sun directions) and which cells are roofed. Those rasters go here too, into one island-wide
 * texture (4 m texels, two channels: shade, shelter): the terrain's material cools and dampens the ground where the structure shades it (the ground there is deeper
 * green-gray, mossier), a creature that wants shade reads it, and the plants have already read the same raster (light and moisture) when they were placed. So the
 * microhabitat is one thing seen three ways: in the ground's colour, in what grows there, and in who rests there.
 */
type HabitatTile = { x0: number; z0: number; cell: number; n: number; shade: Float32Array; shelter: Float32Array }
const habitat = new Map<string, HabitatTile>()
const shadeData = new Uint8Array(N * N * 2)
let habitatDirty = false
export const archShade = { texture: { value: makeShadeTexture() } }

function makeShadeTexture(): DataTexture {
  const t = new DataTexture(shadeData, N, N, RGFormat, UnsignedByteType)
  t.magFilter = LinearFilter
  t.minFilter = LinearFilter
  t.needsUpdate = true
  return t
}

export function setHabitatTile(key: string, region: { x0: number; z0: number; cell: number; n: number }, shade: Float32Array, shelter: Float32Array) {
  habitat.set(key, { x0: region.x0, z0: region.z0, cell: region.cell, n: region.n, shade: shade.slice(), shelter: shelter.slice() })
  habitatDirty = true
}

export function dropHabitatTile(key: string) {
  if (habitat.delete(key)) habitatDirty = true
}

/** The share of the day's sun the structures keep off the ground at a point, 0 to 1 (0 where none stands). */
export function shadeAt(x: number, z: number): number {
  const i = Math.floor((x + SIZE / 2) / CELL)
  const j = Math.floor((z + SIZE / 2) / CELL)
  if (i < 0 || j < 0 || i >= N || j >= N) return 0
  return shadeData[(j * N + i) * 2]! / 255
}

/** Rebuilds the shade texture from the tiles when they have changed (called with flushGround, at most every half second). */
export function flushHabitat(now: number) {
  if (!habitatDirty || now - lastFlush < 0) return
  habitatDirty = false
  shadeData.fill(0)
  for (const t of habitat.values()) {
    for (let j = 0; j < t.n; j += 1) {
      for (let i = 0; i < t.n; i += 1) {
        const k = j * t.n + i
        const sh = t.shade[k]!
        const sl = t.shelter[k]!
        if (sh <= 0 && sl <= 0) continue
        const x = t.x0 + (i + 0.5) * t.cell
        const z = t.z0 + (j + 0.5) * t.cell
        const ti = Math.floor((x + SIZE / 2) / CELL)
        const tj = Math.floor((z + SIZE / 2) / CELL)
        if (ti < 0 || tj < 0 || ti >= N || tj >= N) continue
        const o = (tj * N + ti) * 2
        if (sh * 255 > shadeData[o]!) shadeData[o] = sh * 255
        if (sl * 255 > shadeData[o + 1]!) shadeData[o + 1] = sl * 255
      }
    }
  }
  archShade.texture.value.needsUpdate = true
}
