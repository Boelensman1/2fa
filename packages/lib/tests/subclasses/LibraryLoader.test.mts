import { describe, it, expect, beforeEach, vi } from 'vitest'
import LibraryLoader from '../../src/subclasses/LibraryLoader.mjs'
import type CryptoLib from '../../src/interfaces/CryptoLib.mjs'
import type { PlatformProviders } from '../../src/interfaces/PlatformProviders.mjs'
import { InitializationError } from '../../src/TwoFALibError.mjs'

// Mock the external libraries
vi.mock('openpgp', () => ({
  config: {},
  mockOpenPGP: true,
}))
vi.mock('qrcode', () => ({ default: { mockQRCode: true } }))
vi.mock('jsqr', () => ({ default: { default: { mockJsQR: true } } }))
vi.mock('canvas', () => ({ default: { mockCanvas: true } }))
vi.mock('whatwg-url', () => ({ default: { mockWhatwgUrl: true } }))

describe('LibraryLoader', () => {
  let cryptoLib: CryptoLib
  let platformProviders: PlatformProviders
  let libraryLoader: LibraryLoader

  beforeEach(() => {
    cryptoLib = {
      createKeys: vi.fn(),
      decryptKeys: vi.fn(),
      encryptKeys: vi.fn(),
      encrypt: vi.fn(),
      decrypt: vi.fn(),
      encryptSymmetric: vi.fn(),
      decryptSymmetric: vi.fn(),
      getRandomBytes: vi.fn(),
      createSyncKey: vi.fn(),
      createSymmetricKey: vi.fn(),
    }
    platformProviders = {
      CryptoLib: vi.fn(() => cryptoLib),
      WebSocketLib: () => WebSocket,
      QrCodeLib: vi.fn(),
      OpenPgpLib: vi.fn(),
    }
    libraryLoader = new LibraryLoader(platformProviders)
  })

  it('should create a LibraryLoader instance', () => {
    expect(libraryLoader).toBeInstanceOf(LibraryLoader)
  })

  it('should throw an error if PlatformProviders is not provided', () => {
    expect(
      () => new LibraryLoader(null as unknown as PlatformProviders),
    ).toThrow(InitializationError)
    expect(
      () => new LibraryLoader(null as unknown as PlatformProviders),
    ).toThrow('PlatformProviders with CryptoLib is required')
  })

  it('should return the CryptoLib instance', () => {
    expect(libraryLoader.getCryptoLib()).toBe(cryptoLib)
  })

  it('should load OpenPGP library', () => {
    const openPgpLib = libraryLoader.getOpenPGPLib()

    expect(openPgpLib).toBeDefined()
    expect(platformProviders.OpenPgpLib).toHaveBeenCalled()
  })

  it('should load QR Generator library', () => {
    const qrGeneratorLib = libraryLoader.getQrGeneratorLib()
    expect(qrGeneratorLib).toBeDefined()
    expect(platformProviders.QrCodeLib).toHaveBeenCalled()
  })

  it('should load JsQR library', async () => {
    const jsQrLib = await libraryLoader.getJsQrLib()
    expect(jsQrLib).toEqual({ mockJsQR: true })
  })

  it('should load URL Parser library', async () => {
    const urlParserLib = await libraryLoader.getUrlParserLib()
    expect(urlParserLib).toEqual({ mockWhatwgUrl: true })
  })

  it('should cache libraries after first load', async () => {
    const openPgpLib1 = libraryLoader.getOpenPGPLib()
    const openPgpLib2 = libraryLoader.getOpenPGPLib()
    expect(openPgpLib1).toBe(openPgpLib2)
    expect(platformProviders.OpenPgpLib).toHaveBeenCalledTimes(1)

    const qrGeneratorLib1 = libraryLoader.getQrGeneratorLib()
    const qrGeneratorLib2 = libraryLoader.getQrGeneratorLib()
    expect(qrGeneratorLib1).toBe(qrGeneratorLib2)
    expect(platformProviders.QrCodeLib).toHaveBeenCalledTimes(1)

    const jsQrLib1 = await libraryLoader.getJsQrLib()
    const jsQrLib2 = await libraryLoader.getJsQrLib()
    expect(jsQrLib1).toBe(jsQrLib2)

    const urlParserLib1 = await libraryLoader.getUrlParserLib()
    const urlParserLib2 = await libraryLoader.getUrlParserLib()
    expect(urlParserLib1).toBe(urlParserLib2)
  })
})
