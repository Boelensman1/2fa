import { describe, expect, test } from 'vitest'

import { browserProviders } from '../../src/platformProviders/browser/index.mjs'

// No `globalThis.window` shim here, deliberately.
//
// The browser provider reads WebCrypto off `globalThis`, which resolves in a
// page, a worker and an mv3 service worker alike. These tests used to define a
// fake `window` so the provider could find `window.crypto`, and that shim was
// precisely what hid the fact that it could not run in a service worker at
// all. Running window-less is the point; a regression to `window.crypto` must
// fail here.

describe('BrowserCryptoLib', () => {
  const browserCrypto = new browserProviders.CryptoLib()

  test('successive calls to getRandomBytes should return different results', async () => {
    const bytes1 = await browserCrypto.getRandomBytes(16)
    const bytes2 = await browserCrypto.getRandomBytes(16)
    const bytes3 = await browserCrypto.getRandomBytes(16)

    expect(bytes1).not.toEqual(bytes2)
    expect(bytes1).not.toEqual(bytes3)
    expect(bytes2).not.toEqual(bytes3)

    expect(bytes1).toHaveLength(16)
    expect(bytes2).toHaveLength(16)
    expect(bytes3).toHaveLength(16)
  })
})
