import { useEffect, useState, type MouseEvent } from 'react'

/**
 * Site addresses. A tiny history-based router: real paths (shareable, back/forward work), no dependency.
 *   /              Home
 *   /explore       Explore (the world, full screen)
 *   /project       Project (concept, systems, history, labs)
 *   /present       Presentation Mode entry (optional; not in main nav)
 *   /open/<id>     An archived version or a Lab, opened on its own (0.1, 0.2, 0.3, architecture-lab, …)
 *
 * Legacy /preview and /preview/… URLs are accepted and rewritten to the same path without the prefix.
 */
export type Route = { page: 'home' } | { page: 'explore' } | { page: 'project' } | { page: 'present' } | { page: 'open'; id: string }

/** Public site root path. */
export const BASE = '/'

/** Strip a trailing slash (except `/`) and map legacy `/preview` → `/`. */
export function normalizePath(path: string): string {
  let p = path.split('?')[0]!.split('#')[0]!
  if (p === '/preview' || p.startsWith('/preview/')) p = p.slice('/preview'.length) || '/'
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p || '/'
}

export function parse(path: string): Route {
  const rest = normalizePath(path)
  if (rest === '/explore') return { page: 'explore' }
  if (rest === '/project') return { page: 'project' }
  if (rest === '/present') return { page: 'present' }
  const open = rest.match(/^\/open\/(.+)$/)
  if (open) return { page: 'open', id: decodeURIComponent(open[1]!) }
  return { page: 'home' }
}

export function href(route: Route): string {
  if (route.page === 'home') return '/'
  if (route.page === 'open') return `/open/${encodeURIComponent(route.id)}`
  return `/${route.page}`
}

const listeners = new Set<() => void>()

function rewriteLegacy(to: string): string {
  const mark = to.search(/[?#]/)
  const pathOnly = mark < 0 ? to : to.slice(0, mark)
  const suffix = mark < 0 ? '' : to.slice(mark)
  if (pathOnly === '/preview' || pathOnly.startsWith('/preview/')) return normalizePath(pathOnly) + suffix
  return to
}

export function go(to: string) {
  const next = rewriteLegacy(to)
  const cur = window.location.pathname + window.location.search + window.location.hash
  if (next === cur) return
  if (!next.includes('?') && !next.includes('#') && next === window.location.pathname) return
  window.history.pushState(null, '', next)
  listeners.forEach((l) => l())
}

/** Replace a legacy /preview URL in the address bar without adding history. */
export function adoptLegacyPreviewPath() {
  const raw = window.location.pathname
  if (raw !== '/preview' && !raw.startsWith('/preview/')) return
  window.history.replaceState(null, '', normalizePath(raw) + window.location.search + window.location.hash)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.pathname))
  useEffect(() => {
    const update = () => setRoute(parse(window.location.pathname))
    listeners.add(update)
    window.addEventListener('popstate', update)
    return () => {
      listeners.delete(update)
      window.removeEventListener('popstate', update)
    }
  }, [])
  return route
}

/** For <a href>: an ordinary click stays in the app; a modified click (new tab, etc.) is left to the browser. */
export function follow(to: string) {
  return (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    go(to)
  }
}
