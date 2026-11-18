/**
 * Asking Explore to open its Saved views panel, from anywhere on the site (the account menu in the navigation). On Explore the panel opens at once;
 * from Home or Project the request is kept (this tab only) and Explore opens the panel when it arrives.
 */
const KEY = 'pv-open-saved-views'
const listeners = new Set<() => void>()

export function requestSavedViews() {
  try {
    window.sessionStorage.setItem(KEY, '1')
  } catch {
    // (storage blocked: the request still reaches an Explore that is open)
  }
  for (const l of listeners) l()
}

/** Explore: whether a request is waiting (and takes it). */
export function takeSavedViewsRequest(): boolean {
  try {
    if (window.sessionStorage.getItem(KEY) !== '1') return false
    window.sessionStorage.removeItem(KEY)
    return true
  } catch {
    return false
  }
}

export function onSavedViewsRequest(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
