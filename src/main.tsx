import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/inter'
import './styles.css'
import { App } from './App'
import { initStore } from './lib/store'
import { initCloud } from './lib/cloud'
import { registerSW } from 'virtual:pwa-register'

void initStore().then(() => initCloud())
registerSW({ immediate: true })
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
