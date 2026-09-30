import { useEffect, useLayoutEffect, useRef } from 'react'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * Single-key shortcuts on the window. `onKey` receives `event.key` and
 * returns true when it handled it, which prevents the default. Keys are
 * ignored with a modifier held or while a form field has focus.
 */
export function useShortcuts(onKey: (key: string) => boolean) {
  const onKeyRef = useRef(onKey)
  useLayoutEffect(() => {
    onKeyRef.current = onKey
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) {
        return
      }
      if (onKeyRef.current(event.key)) {
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
