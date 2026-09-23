import { useAuth } from '../auth/useAuth.ts'

export function AuthBar() {
  const { user, ready, error, signInWithGoogle, signOutUser } = useAuth()

  const label = user?.displayName || user?.email || 'Signed in'

  return (
    <div className="auth-bar">
      {ready && user ? (
        <>
          <span className="auth-name" title={label}>
            {label}
          </span>
          <button type="button" onClick={() => void signOutUser()}>
            Sign out
          </button>
        </>
      ) : (
        <button type="button" onClick={() => void signInWithGoogle()}>
          Sign in with Google
        </button>
      )}
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
