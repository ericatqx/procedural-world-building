import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase.ts'
import type { VoxelSettings } from './types.ts'

function configRef(uid: string) {
  return doc(db, 'users', uid, 'configs', 'default')
}

export async function saveVoxelConfig(
  uid: string,
  settings: VoxelSettings,
): Promise<void> {
  await setDoc(configRef(uid), {
    updatedAt: serverTimestamp(),
    settings,
  })
}

export async function loadVoxelConfig(
  uid: string,
): Promise<VoxelSettings | null> {
  const snap = await getDoc(configRef(uid))
  if (!snap.exists()) {
    return null
  }
  const data = snap.data()
  const settings = data.settings
  if (!settings || typeof settings !== 'object') {
    return null
  }
  return settings as VoxelSettings
}
