/**
 * Reads a colour token from the shared theme (index.css), so WebGL scenes
 * follow the same accent as the interface. `fallback` only applies where
 * there is no document, or the token is missing.
 */
export function themeColor(token: `--${string}`, fallback: string): string {
  if (typeof document === 'undefined') {
    return fallback
  }
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback
}
