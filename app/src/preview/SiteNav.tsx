import { Suspense, lazy } from 'react'
import { BASE, follow, href, type Route } from './route.ts'

// (The account entry loads Firebase only for itself: the site never waits on it, and works whether or not it loads.)
const AccountMenu = lazy(() => import('./AccountMenu.tsx'))

const LINKS: { page: Route['page']; label: string; to: string }[] = [
  { page: 'home', label: 'Home', to: href({ page: 'home' }) },
  { page: 'explore', label: 'Explore', to: href({ page: 'explore' }) },
  { page: 'project', label: 'Project', to: href({ page: 'project' }) },
]

/** The site's one navigation: the wordmark and three pages. The versions, the classic site and the exercises live on the Project page. */
export function SiteNav({ page }: { page: Route['page'] }) {
  return (
    <header className="pv-nav">
      <a className="pv-wordmark" href={BASE} onClick={follow(BASE)}>
        <span className="pv-wordmark-name">Shadow Ecology</span>
      </a>
      <nav className="pv-nav-links" aria-label="Site">
        {LINKS.map((link) => (
          <a key={link.page} href={link.to} onClick={follow(link.to)} aria-current={page === link.page ? 'page' : undefined}>
            {link.label}
          </a>
        ))}
        <Suspense fallback={<span className="pv-account" aria-hidden />}>
          <AccountMenu page={page} />
        </Suspense>
      </nav>
    </header>
  )
}
