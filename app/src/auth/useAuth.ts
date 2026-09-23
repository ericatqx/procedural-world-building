import { useEffect, useState } from 'react'
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { auth } from '../firebase.ts'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return onAuthStateChanged(auth, (next) => {
      setUser(next)
      setReady(true)
    })
  }, [])

  const signInWithGoogle = async () => {
    setError(null)
    try {
      await signInWithPopup(auth, new GoogleAuthProvider())
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String(err.code)
          : ''
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return
      }
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    }
  }

  const signOutUser = async () => {
    setError(null)
    try {
      await signOut(auth)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-out failed')
    }
  }

  return { user, ready, error, signInWithGoogle, signOutUser }
}
