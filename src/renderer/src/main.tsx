import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { setLogLevel } from '@shared/logger'

import App from './App'
import './styles.css'

setLogLevel(import.meta.env.DEV ? 'debug' : 'info')

function syncColorScheme(): void {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', dark)
}

syncColorScheme()
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncColorScheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
