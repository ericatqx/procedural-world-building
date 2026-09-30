/** Typed arrays ↔ the bytes stored in a snapshot payload (platform byte order, little-endian in practice). */

type TypedArray = Float32Array | Int16Array | Uint8Array | Uint32Array

export const bytesOf = (array: TypedArray): Uint8Array =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength).slice()

type Reader<T> = (bytes: Uint8Array) => T

/** A copy of the bytes, since stored bytes need not be aligned for the element size. */
function aligned(bytes: Uint8Array, elementSize: number): ArrayBuffer {
  if (bytes.byteLength % elementSize !== 0) {
    throw new Error('Snapshot data is corrupted.')
  }
  return bytes.slice().buffer
}

export const readFloat32: Reader<Float32Array<ArrayBuffer>> = (bytes) => new Float32Array(aligned(bytes, 4))
export const readInt16: Reader<Int16Array<ArrayBuffer>> = (bytes) => new Int16Array(aligned(bytes, 2))
export const readUint8: Reader<Uint8Array<ArrayBuffer>> = (bytes) => new Uint8Array(aligned(bytes, 1))
export const readUint32: Reader<Uint32Array<ArrayBuffer>> = (bytes) => new Uint32Array(aligned(bytes, 4))

/** A named payload field, checked for its expected element count when given. */
export function payloadField<T extends TypedArray>(
  payload: Record<string, Uint8Array> | null,
  name: string,
  read: Reader<T>,
  length?: number,
): T {
  const bytes = payload?.[name]
  if (!bytes) {
    throw new Error(`Snapshot data is missing “${name}”.`)
  }
  const array = read(bytes)
  if (length !== undefined && array.length !== length) {
    throw new Error(`Snapshot data “${name}” does not match this page.`)
  }
  return array
}
