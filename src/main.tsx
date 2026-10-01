import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { createBrowserCaptionStudio } from './web/browserBridge'

if (typeof window !== 'undefined' && !window.captionStudio) {
  window.captionStudio = createBrowserCaptionStudio()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)

// The splash only covers startup; it is not progress. Hold it ~0.7 s from navigation start so it reads as
// intentional, then fade and remove it.
const splash = document.getElementById('splash')
if (splash) {
  requestAnimationFrame(() => {
    window.setTimeout(() => {
      splash.classList.add('done')
      splash.addEventListener('transitionend', () => splash.remove(), { once: true })
      window.setTimeout(() => splash.remove(), 600)
    }, Math.max(0, 700 - performance.now()))
  })
}
