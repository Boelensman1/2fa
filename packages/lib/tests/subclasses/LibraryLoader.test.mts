import { describe, it, expect, beforeEach, vi } from 'vitest'
import LibraryLoader from '../../src/subclasses/LibraryLoader.mjs'
import CryptoLib from '../../src/interfaces/CryptoLib.mjs'
import { InitializationError, TwoFALibError } from '../../src/TwoFALibError.mjs'

// Mock the external libraries
vi.mock('openpgp', () => ({ mockOpenPGP: true }))
vi.mock('qrcode', () => ({ default: { mockQRCode: true } }))
vi.mock('jsqr', () => ({ default: { default: { mockJsQR: true } } }))
vi.mock('canvas', () => ({ default: { mockCanvas: true } }))
vi.mock('whatwg-url', () => ({ default: { mockWhatwgUrl: true } }))

describe('LibraryLoader', () => {
  let cryptoLib: CryptoLib
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
    libraryLoader = new LibraryLoader(cryptoLib)
  })

  it('should create a LibraryLoader instance', () => {
    expect(libraryLoader).toBeInstanceOf(LibraryLoader)
  })

  it('should throw an error if CryptoLib is not provided', () => {
    expect(() => new LibraryLoader(null as unknown as CryptoLib)).toThrow(
      InitializationError,
    )
    expect(() => new LibraryLoader(null as unknown as CryptoLib)).toThrow(
      'CryptoLib is required',
    )
  })

  it('should return the CryptoLib instance', () => {
    expect(libraryLoader.getCryptoLib()).toBe(cryptoLib)
  })

  it('should load OpenPGP library', async () => {
    const openPgpLib = await libraryLoader.getOpenPGPLib()

    expect(openPgpLib).toBeDefined()
    expect(openPgpLib).toEqual({ mockOpenPGP: true })
  })

  it('should load QR Generator library', async () => {
    const qrGeneratorLib = await libraryLoader.getQrGeneratorLib()
    expect(qrGeneratorLib).toEqual({ mockQRCode: true })
  })

  it('should load JsQR library', async () => {
    const jsQrLib = await libraryLoader.getJsQrLib()
    expect(jsQrLib).toEqual({ mockJsQR: true })
  })

  it('should load Canvas library in non-browser environment', async () => {
    const canvasLib = await libraryLoader.getCanvasLib()
    expect(canvasLib).toEqual({ mockCanvas: true })
  })

  it('should throw an error when loading Canvas library in browser environment', async () => {
    // Mock window to simulate browser environment
    vi.stubGlobal('window', {})

    await expect(libraryLoader.getCanvasLib()).rejects.toThrow(TwoFALibError)
    await expect(libraryLoader.getCanvasLib()).rejects.toThrow(
      'Canvas lib can not be loaded in browser env',
    )

    // Clean up the mock
    vi.unstubAllGlobals()
  })

  it('should load URL Parser library', async () => {
    const urlParserLib = await libraryLoader.getUrlParserLib()
    expect(urlParserLib).toEqual({ mockWhatwgUrl: true })
  })

  it('should cache libraries after first load', async () => {
    const openPgpLib1 = await libraryLoader.getOpenPGPLib()
    const openPgpLib2 = await libraryLoader.getOpenPGPLib()
    expect(openPgpLib1).toBe(openPgpLib2)

    const qrGeneratorLib1 = await libraryLoader.getQrGeneratorLib()
    const qrGeneratorLib2 = await libraryLoader.getQrGeneratorLib()
    expect(qrGeneratorLib1).toBe(qrGeneratorLib2)

    const jsQrLib1 = await libraryLoader.getJsQrLib()
    const jsQrLib2 = await libraryLoader.getJsQrLib()
    expect(jsQrLib1).toBe(jsQrLib2)

    const canvasLib1 = await libraryLoader.getCanvasLib()
    const canvasLib2 = await libraryLoader.getCanvasLib()
    expect(canvasLib1).toBe(canvasLib2)

    const urlParserLib1 = await libraryLoader.getUrlParserLib()
    const urlParserLib2 = await libraryLoader.getUrlParserLib()
    expect(urlParserLib1).toBe(urlParserLib2)
  })
})
