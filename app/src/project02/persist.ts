import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import type { Eco } from './simulation.ts'

/**
 * Shadow Ecology 0.2 — the world as bytes: plain data as JSON, every typed
 * array (lattice, fields) as raw bytes after it, the whole deflated. The
 * lattice is mostly empty, so a world packs small enough to keep a state
 * per day in memory and to save one to Firestore.
 */
const TYPED = {
  Float32Array,
  Float64Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Uint8Array,
  Uint16Array,
  Uint32Array,
} as const
type TypedName = keyof typeof TYPED
type TypedArray = InstanceType<(typeof TYPED)[TypedName]>

const FORMAT = 1
const ALIGN = 8

type Header = { format: number; buffers: [TypedName, number, number][] }

const special = (n: number) => (Number.isNaN(n) ? 'nan' : n === Infinity ? 'inf' : n === -Infinity ? '-inf' : null)

export function packEco(eco: Eco, level: 1 | 6 = 1): Uint8Array {
  const arrays: TypedArray[] = []
  const json = JSON.stringify(eco, (_key, value: unknown) => {
    if (ArrayBuffer.isView(value)) {
      arrays.push(value as TypedArray)
      return { $t: value.constructor.name, $i: arrays.length - 1 }
    }
    if (typeof value === 'number') {
      const name = special(value)
      if (name) return { $n: name }
    }
    return value
  })
  const header: Header = { format: FORMAT, buffers: [] }
  let offset = 0
  for (const array of arrays) {
    header.buffers.push([array.constructor.name as TypedName, offset, array.byteLength])
    offset += Math.ceil(array.byteLength / ALIGN) * ALIGN
  }
  const head = strToU8(JSON.stringify(header))
  const body = strToU8(json)
  const start = Math.ceil((8 + head.length + body.length) / ALIGN) * ALIGN
  const out = new Uint8Array(start + offset)
  const view = new DataView(out.buffer)
  view.setUint32(0, head.length, true)
  view.setUint32(4, body.length, true)
  out.set(head, 8)
  out.set(body, 8 + head.length)
  arrays.forEach((array, k) => {
    out.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), start + header.buffers[k]![1])
  })
  return deflateSync(out, { level })
}

export function unpackEco(packed: Uint8Array): Eco {
  const bytes = inflateSync(packed)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const headLength = view.getUint32(0, true)
  const bodyLength = view.getUint32(4, true)
  const header = JSON.parse(strFromU8(bytes.subarray(8, 8 + headLength))) as Header
  if (header.format !== FORMAT) throw new Error('This saved world was written by a different version.')
  const start = Math.ceil((8 + headLength + bodyLength) / ALIGN) * ALIGN
  return JSON.parse(strFromU8(bytes.subarray(8 + headLength, 8 + headLength + bodyLength)), (_key, value: unknown) => {
    if (value && typeof value === 'object') {
      const tagged = value as { $t?: TypedName; $i?: number; $n?: string }
      if (tagged.$t !== undefined && tagged.$i !== undefined) {
        const [name, offset, length] = header.buffers[tagged.$i]!
        const copy = bytes.slice(start + offset, start + offset + length)
        return new TYPED[name](copy.buffer)
      }
      if (tagged.$n !== undefined) return tagged.$n === 'nan' ? NaN : tagged.$n === 'inf' ? Infinity : -Infinity
    }
    return value
  }) as Eco
}
