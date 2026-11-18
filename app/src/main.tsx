import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/unbounded'
import './index.css'

// Each site loads only its own code: /preview never downloads the weekly exercises, and the existing site never downloads the preview.
const App = lazy(() => import('./App.tsx'))
const PreviewSite = lazy(() => import('./preview/PreviewSite.tsx').then((m) => ({ default: m.PreviewSite })))

/** /preview is the website prototype (preview/); every other address is the existing site. */
const preview = window.location.pathname === '/preview' || window.location.pathname.startsWith('/preview/')
// (The site is black from the first paint: until its code has arrived nothing of it is mounted, and the document showed the exercises' grey.)
if (preview) {
  document.documentElement.style.background = '#000'
  document.body.style.background = '#000'
}
// The preview's world is fetched at once, alongside the site's own code, rather than after it has rendered.
if (preview && !/^\/preview\/(project|open)/.test(window.location.pathname)) void import('./project03/ShadowEcology03.tsx')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>{preview ? <PreviewSite /> : <App />}</Suspense>
  </StrictMode>,
)
