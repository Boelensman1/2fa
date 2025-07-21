import { describe, expect, test } from 'vitest'
import crypto from 'node:crypto'

import { browserProviders } from '../../src/platformProviders/browser/index.mjs'

// @ts-expect-error node crypto and webcrypto don't have the exact same types
globalThis.window = { crypto: crypto.webcrypto }

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
