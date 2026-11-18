/**
 * Which Overhang the world grows: `refined` (the Architecture Lab's refined Overhang with its terrain and habitat adaptation and its
 * seven-stage lifecycle: the default) or `classic` (the original form, its ages and later life, as it stood before). `?la=classic`.
 */
export type ArchitectureStyle = 'refined' | 'classic'
export function architectureStyle(): ArchitectureStyle {
  if (typeof location === 'undefined') return 'refined'
  return new URLSearchParams(location.search).get('la') === 'classic' ? 'classic' : 'refined'
}

