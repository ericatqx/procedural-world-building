import { useEffect, useState, type MouseEvent } from 'react'

/**
 * The preview site's addresses. A tiny history-based router: real paths (shareable, back/forward work), no dependency.
 *   /preview            Home
 *   /preview/explore    Explore (the world, full screen)
 *   /preview/project    Project (concept, systems, history, labs)
 *   /preview/open/<id>  An archived version or a Lab, opened on its own (0.1, 0.2, 0.3, architecture-lab, …)
 */
export type Route = { page: 'home' } | { page: 'explore' } | { page: 'project' } | { page: 'present' } | { page: 'open'; id: string }

export const BASE = '/preview'

export function parse(path: string): Route {
  const rest = path.replace(/\/+$/, '').slice(BASE.length)
  if (rest === '/explore') return { page: 'explore' }
  if (rest === '/project') return { page: 'project' }
  // The presenter's companion (Present.tsx).
  if (rest === '/present') return { page: 'present' }
  const open = rest.match(/^\/open\/(.+)$/)
  if (open) return { page: 'open', id: decodeURIComponent(open[1]!) }
  return { page: 'home' }
}

export function href(route: Route): string {
  if (route.page === 'home') return BASE
  if (route.page === 'open') return `${BASE}/open/${encodeURIComponent(route.id)}`
  return `${BASE}/${route.page}`
}

const listeners = new Set<() => void>()

export function go(to: string) {
  if (to === window.location.pathname) return
  window.history.pushState(null, '', to)
  listeners.forEach((l) => l())
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
