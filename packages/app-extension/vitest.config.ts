import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The `@/` the popup's components import themselves by. wxt generates this
  // for the build; vitest is deliberately not wired to its plugin (below), so
  // it is repeated here rather than inherited.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    // The detection code is the only thing under test, and half of it walks
    // the DOM. happy-dom rather than jsdom because the walk descends into
    // shadow roots, which happy-dom implements natively and faithfully.
    //
    // Deliberately *not* wired to wxt's WxtVitest plugin: nothing under
    // lib/detect touches the extension apis, and keeping it out means the
    // tests are plain vitest with no build-time auto-import magic.
    environment: 'happy-dom',
    // `.tsx` as well: the popup's draft handling is tested by rendering the
    // real components, which is the only way to exercise a popup being
    // destroyed mid-form.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
})
