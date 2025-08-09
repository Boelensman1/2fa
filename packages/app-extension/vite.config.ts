import path from 'node:path'

import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import react from '@vitejs/plugin-react'
import webExtension from '@samrum/vite-plugin-web-extension'
import { visualizer } from 'rollup-plugin-visualizer'
import svgr from 'vite-plugin-svgr'

import { getManifest as getFirefoxManifest } from './src/manifests/firefox'
import { getManifest as getChromeManifest } from './src/manifests/chrome'

const BUILD_FOR = process.env.VITE_BUILDFOR ?? 'chrome'
const IN_WATCH_MODE = process.argv.includes('--watch')
const WITH_PERFORMANCE_LOGGING = process.env.VITE_LOG_PERFORMANCE === '1'
const SOURCEMAPS = Boolean(process.env.SOURCEMAPS)

const getManifest = (buildFor: string) => {
  switch (buildFor) {
    case 'firefox':
      return getFirefoxManifest()
    case 'chrome':
      return getChromeManifest()
    default:
      throw new Error(`No manifest found for "${buildFor}"`)
  }
}

const getOutDir = (
  buildFor: string,
  watchMode: boolean,
  performance: boolean,
): string => {
  return path.join(
    'dist',
    performance ? 'performance' : '',
    watchMode ? 'watch' : '',
    buildFor,
  )
}

const manifest = getManifest(BUILD_FOR)
const outDir = getOutDir(BUILD_FOR, IN_WATCH_MODE, WITH_PERFORMANCE_LOGGING)

// https://vitejs.dev/config/
// @ts-expect-error Manifest types are not perfectly compatible
export default defineConfig(() => {
  return {
    plugins: [
      react(),
      webExtension({
        manifest,
      }),
      nodePolyfills({
        // To add only specific polyfills, add them here. If no option is passed, adds all polyfills
        include: ['util', 'buffer'],
      }),
      ...(process.env.GENERATE_STATS ? [visualizer()] : []),
      svgr(),
    ],
    resolve: {
      alias: {
        '~': path.resolve(__dirname, './src'),
      },
    },
    build: {
      outDir,
      sourcemap: SOURCEMAPS,
      rollupOptions: {
        output: {
          manualChunks: {
            react: [
              'react',
              'react-dom',
              'react-dom',
              '@emotion/react',
              '@emotion/styled',
              'formik',
            ],
            materialui: ['@mui/material', '@mui/icons-material'],
          },
        },
      },
    },
  }
})
