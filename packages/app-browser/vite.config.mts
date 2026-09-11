import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'child_process'
import process from 'node:process'

const commitHash = execSync('git rev-parse --short HEAD').toString().trim()

// Where the favaserver sync server actually listens. The browser never needs to
// know this: it connects to /api/sync on whatever origin serves the app, and we
// forward the upgrade from here. preview.proxy defaults to server.proxy, so this
// covers `vite preview` as well as `vite dev`.
const syncServerTarget = process.env.SYNC_SERVER_TARGET ?? 'ws://localhost:8080'

export default defineConfig({
  plugins: [
    solidPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: { theme_color: 'white' },
    }),
  ],
  server: {
    port: 3266, // 2f in utf-8 hex
    host: '0.0.0.0',
    proxy: {
      '/api/sync': {
        target: syncServerTarget,
        ws: true,
        // The sync server ignores the path; rewriting to '/' keeps it from
        // receiving an empty url once the prefix is stripped.
        rewrite: () => '/',
      },
    },
  },
  build: {
    outDir: 'build',
    target: 'esnext',
  },
  define: {
    'import.meta.env.VITE_COMMIT_HASH': JSON.stringify(commitHash),
  },
})
