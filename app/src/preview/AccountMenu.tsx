import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth.ts'
import { follow, href, type Route } from './route.ts'
import { requestSavedViews } from './savedViews.ts'

/**
 * THE ACCOUNT ENTRY in the site's navigation (loaded lazily: Firebase is fetched only for it). Signed out: "Sign in" (Google, the site's existing
 * auth/useAuth.ts). Signed in: "Account", a small menu with Saved views (Explore's saved views: on another page it goes to Explore and opens them
 * there) and Sign out. Nothing on the site needs signing in.
 */
export default function AccountMenu({ page }: { page: Route['page'] }) {
  const { user, ready, error, signInWithGoogle, signOutUser } = useAuth()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  const savedViews = (e: React.MouseEvent) => {
    setOpen(false)
    requestSavedViews()
    if (page !== 'explore') follow(href({ page: 'explore' }))(e as React.MouseEvent<HTMLAnchorElement>)
    else e.preventDefault()
  }
  if (!ready) return <span className="pv-account" aria-hidden />
  if (!user)
    return (
      <div className="pv-account">
        <button type="button" className="pv-account-button" onClick={() => void signInWithGoogle()}>
          Sign in
        </button>
        {error ? (
          <p className="pv-account-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    )
  const name = user.displayName || user.email || 'Signed in'
  return (
    <div className="pv-account" ref={box}>
      <button type="button" className="pv-account-button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Account
      </button>
      {open ? (
        <div className="pv-account-menu" role="menu">
          <p className="pv-account-name" title={name}>
            {name}
          </p>
          <a role="menuitem" href={href({ page: 'explore' })} onClick={savedViews}>
            Saved views <em>Explore</em>
          </a>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void signOutUser()
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="pv-account-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
