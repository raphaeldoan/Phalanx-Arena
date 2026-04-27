import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const workspaceRoot = fileURLToPath(new URL('..', import.meta.url))
const CLOUDFLARE_BASE_PATH = '/phalanxarena/'
const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version?: string }
const appVersion = packageJson.version?.trim() || '0.0.0'
const appVersionDisplay = appVersion.replace(/\.0$/, '')

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === 'cloudflare' ? CLOUDFLARE_BASE_PATH : '/',
  assetsInclude: ['**/*.fbx'],
  build: {
    outDir: mode === 'cloudflare' ? 'cloudflare-dist/phalanxarena' : 'dist',
  },
  define: {
    __PHALANX_APP_VERSION__: JSON.stringify(appVersionDisplay),
  },
  plugins: [react()],
  server: {
    fs: {
      allow: [workspaceRoot],
    },
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
}))
