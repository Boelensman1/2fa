import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'
import { VitePWA } from 'vite-plugin-pwa'
// import devtools from 'solid-devtools/vite'

export default defineConfig({
  plugins: [
    /*
    Uncomment the following line to enable solid-devtools.
    For more info see https://github.com/thetarnav/solid-devtools/tree/main/packages/extension#readme
    */
    // devtools(),
    solidPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
    }),
  ],
  server: {
    port: 3005,
    host: '0.0.0.0',
  },
  build: {
    outDir: 'build',
    target: 'esnext',
  },
})
