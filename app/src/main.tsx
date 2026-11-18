import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/unbounded'
import './index.css'
import { adoptLegacyPreviewPath, normalizePath } from './preview/route.ts'

// Shadow Ecology website is the product. Weekly exercises remain reachable via /open/week0N from Project.
const PreviewSite = lazy(() => import('./preview/PreviewSite.tsx').then((m) => ({ default: m.PreviewSite })))

adoptLegacyPreviewPath()

const path = normalizePath(window.location.pathname)

// Black from the first paint so the document never flashes the old exercise-shell grey.
document.documentElement.style.background = '#000'
document.body.style.background = '#000'

// Prefetch the world with the site shell, except on Project / archive pages that do not need it immediately.
if (!/^\/(project|open)(\/|$)/.test(path)) void import('./project03/ShadowEcology03.tsx')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <PreviewSite />
    </Suspense>
  </StrictMode>,
)
