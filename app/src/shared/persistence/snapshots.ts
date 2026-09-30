import {
  Bytes,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../../firebase.ts'

/**
 * Page snapshots: an append-only save history, one collection per page.
 *
 *   users/{uid}/pages/{page}/snapshots/{id}
 *     page, schema, createdAt, summary, hasPayload
 *     state                 controls and small values, plain data
 *   users/{uid}/pages/{page}/snapshots/{id}/payload/main
 *     one Bytes field per typed array (simulation fields, voxels, …)
 *
 * The payload sits in its own document so listing the history never
 * downloads it; it is read only on Restore. Access is limited to the owner by
 * firestore.rules. Firestore is touched only by Save, Load and Delete.
 */

export type PageId = 'week03' | 'week04' | 'week05' | 'project'

/** Firestore-safe plain data: no undefined, no nested arrays, no typed arrays. */
export type SnapshotState = Record<string, unknown>

export type SnapshotPayload = Record<string, Uint8Array>

export type SnapshotContent = {
  /** One line shown in the history list. */
  summary: string
  state: SnapshotState
  payload?: SnapshotPayload
}

export type SnapshotEntry = {
  id: string
  createdAt: Date | null
  summary: string
  schema: number
  state: SnapshotState
  hasPayload: boolean
}

/** Newest first; older snapshots beyond this stay stored but are not listed. */
const HISTORY_LIMIT = 50
/** Firestore's document limit is 1 MiB; leave room for field names. */
const MAX_PAYLOAD_BYTES = 1_000_000

const snapshotsOf = (uid: string, page: PageId) => collection(db, 'users', uid, 'pages', page, 'snapshots')

export async function saveSnapshot(uid: string, page: PageId, schema: number, content: SnapshotContent) {
  const ref = doc(snapshotsOf(uid, page))
  const batch = writeBatch(db)
  const payload = content.payload
  batch.set(ref, {
    page,
    schema,
    createdAt: serverTimestamp(),
    summary: content.summary,
    state: content.state,
    hasPayload: payload !== undefined,
  })
  if (payload) {
    const size = Object.values(payload).reduce((sum, bytes) => sum + bytes.byteLength, 0)
    if (size > MAX_PAYLOAD_BYTES) {
      throw new Error(`Snapshot data is ${Math.round(size / 1024)} KB, over Firestore's 1 MiB document limit.`)
    }
    batch.set(
      doc(ref, 'payload', 'main'),
      Object.fromEntries(Object.entries(payload).map(([name, bytes]) => [name, Bytes.fromUint8Array(bytes)])),
    )
  }
  await batch.commit()
}

export async function listSnapshots(uid: string, page: PageId): Promise<SnapshotEntry[]> {
  const snap = await getDocs(query(snapshotsOf(uid, page), orderBy('createdAt', 'desc'), limit(HISTORY_LIMIT)))
  return snap.docs.map((item) => {
    const data = item.data()
    return {
      id: item.id,
      createdAt: typeof data.createdAt?.toDate === 'function' ? data.createdAt.toDate() : null,
      summary: typeof data.summary === 'string' ? data.summary : '',
      schema: typeof data.schema === 'number' ? data.schema : 0,
      state: data.state && typeof data.state === 'object' ? data.state : {},
      hasPayload: data.hasPayload === true,
    }
  })
}

export async function loadPayload(uid: string, page: PageId, id: string): Promise<SnapshotPayload> {
  const snap = await getDoc(doc(snapshotsOf(uid, page), id, 'payload', 'main'))
  if (!snap.exists()) {
    throw new Error('This snapshot’s data is missing.')
  }
  return Object.fromEntries(
    Object.entries(snap.data())
      .filter(([, value]) => value instanceof Bytes)
      .map(([name, value]) => [name, (value as Bytes).toUint8Array()]),
  )
}

export async function deleteSnapshot(uid: string, page: PageId, entry: SnapshotEntry) {
  const ref = doc(snapshotsOf(uid, page), entry.id)
  const batch = writeBatch(db)
  if (entry.hasPayload) {
    batch.delete(doc(ref, 'payload', 'main'))
  }
  batch.delete(ref)
  await batch.commit()
}

/** The `settings` of the first existing legacy `users/{uid}/configs/{id}` document (Week 04 Cloud Config). */
export async function loadLegacyConfig(uid: string, ids: readonly string[]): Promise<object | null> {
  for (const id of ids) {
    const snap = await getDoc(doc(db, 'users', uid, 'configs', id))
    const settings = snap.exists() ? snap.data().settings : null
    if (settings && typeof settings === 'object') {
      return settings
    }
  }
  return null
}
