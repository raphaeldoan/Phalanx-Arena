import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ReplayVideoRenderer from './ReplayVideoRenderer.tsx'
import { installWasmGameClient } from './wasmGameClient'

function renderRoot(content: ReactNode) {
  const rootElement = document.getElementById('root')
  if (!rootElement) {
    throw new Error('Missing root element.')
  }

  createRoot(rootElement).render(
    <StrictMode>
      {content}
    </StrictMode>,
  )
}

async function bootstrap() {
  await installWasmGameClient()
  const searchParams = new URLSearchParams(window.location.search)
  renderRoot(searchParams.has('replay-video-renderer') ? <ReplayVideoRenderer /> : <App />)
}

void bootstrap().catch((error) => {
  console.error('Local WASM game client failed to initialize.', error)
  renderRoot(
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Local WASM initialization failed</h1>
      <p>The browser engine did not finish loading, so the UI cannot start without rebuilding the WASM bundle.</p>
      <p>Check the dev console for the underlying error and rerun the frontend build if needed.</p>
    </main>,
  )
})
