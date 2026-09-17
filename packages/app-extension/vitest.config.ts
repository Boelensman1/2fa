import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The detection code is the only thing under test, and half of it walks
    // the DOM. happy-dom rather than jsdom because the walk descends into
    // shadow roots, which happy-dom implements natively and faithfully.
    //
    // Deliberately *not* wired to wxt's WxtVitest plugin: nothing under
    // lib/detect touches the extension apis, and keeping it out means the
    // tests are plain vitest with no build-time auto-import magic.
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
})
