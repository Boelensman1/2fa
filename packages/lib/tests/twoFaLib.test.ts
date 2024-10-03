import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import _ from 'lodash'
import openpgp from 'openpgp'
import WebSocket from 'isomorphic-ws'

import {
  createTwoFaLib,
  CryptoLib,
  EncryptedPrivateKey,
  EntryId,
  NewEntry,
  TwoFaLib,
} from '../src/main.mjs'

import NodeCryptoProvider from '../src/CryptoProviders/node/index.mjs'
import {
  EncryptedSymmetricKey,
  Passphrase,
  Salt,
} from '../src/interfaces/CryptoLib.js'

import { EntryNotFoundError } from '../src/TwoFALibError.mjs'
import { SaveFunctionData } from '../src/interfaces/SaveFunction.js'

const deviceIdentifier = 'test-device'

const totpEntry: NewEntry = {
  name: 'Test TOTP',
  issuer: 'Test Issuer',
  type: 'TOTP',
  payload: {
    secret: 'TESTSECRET',
    period: 30,
    algorithm: 'SHA-1',
    digits: 6,
  },
}

const anotherTotpEntry: NewEntry = {
  ...totpEntry,
  name: 'Another TOTP',
  issuer: 'Another Issuer',
}

const clearEntries = async (twoFaLib: TwoFaLib) => {
  const entries = twoFaLib.vault.listEntries()
  for (const entryId of entries) {
    await twoFaLib.vault.deleteEntry(entryId)
  }
}
const sleep = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Mock WebSocket module
const OriginalWebSocket = WebSocket // Store the original WebSocket
vi.mock('isomorphic-ws', async (importOriginal) => {
  const originalModule: typeof import('isomorphic-ws') = await importOriginal()
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
  const MockWebSocket = vi.fn() as any

  /* eslint-disable @typescript-eslint/no-unsafe-member-access*/
  // Copy over required properties
  MockWebSocket.OPEN = originalModule.OPEN
  MockWebSocket.CLOSED = originalModule.CLOSED
  MockWebSocket.CLOSING = originalModule.CLOSING
  MockWebSocket.CLOSED = originalModule.CLOSED
  /* eslint-enable */

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  return { default: MockWebSocket }
})

describe('2falib', () => {
  let cryptoLib: CryptoLib
  let twoFaLib: TwoFaLib
  let passphrase: Passphrase
  let salt: Salt
  let encryptedPrivateKey: EncryptedPrivateKey
  let encryptedSymmetricKey: EncryptedSymmetricKey
  let qrImageDataUrl: string

  beforeAll(async () => {
    cryptoLib = new NodeCryptoProvider()
    passphrase = 'testpassword' as Passphrase
    const result = await createTwoFaLib(deviceIdentifier, cryptoLib, passphrase)
    twoFaLib = result.twoFaLib
    encryptedPrivateKey = result.encryptedPrivateKey
    encryptedSymmetricKey = result.encryptedSymmetricKey
    salt = result.salt

    // Read the QR code image file
    const qrImageBuffer = await fs.readFile(path.join(__dirname, './qr.png'))
    qrImageDataUrl = `data:image/png;base64,${qrImageBuffer.toString('base64')}`
  })

  beforeEach(async () => {
    // empty out the twoFaLib
    twoFaLib = new TwoFaLib(deviceIdentifier, cryptoLib)
    await twoFaLib.init(
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      passphrase,
    )
  })

  describe('TwoFaLib constructor', () => {
    it('should throw an error if device identifier is not provided', () => {
      expect(() => new TwoFaLib('', cryptoLib)).toThrow(
        'Device identifier is required',
      )
    })

    it('should throw an error if device identifier is too long', () => {
      const longDeviceIdentifier = 'a'.repeat(257)
      expect(() => new TwoFaLib(longDeviceIdentifier, cryptoLib)).toThrow(
        'Device identifier is too long, max 256 characters',
      )
    })

    it('should throw an error if CryptoLib is not provided', () => {
      // @ts-expect-error null is not a valid argument for TwoFaLib
      expect(() => new TwoFaLib('valid-device', null)).toThrow(
        'CryptoLib is required',
      )
    })

    it('should create a TwoFaLib instance with valid parameters', () => {
      const validDeviceIdentifier = 'valid-device'
      const twoFaLib = new TwoFaLib(validDeviceIdentifier, cryptoLib)
      expect(twoFaLib).toBeInstanceOf(TwoFaLib)
      expect(twoFaLib.deviceIdentifier).toBe(validDeviceIdentifier)
    })
  })

  it('should return a locked representation', async () => {
    const result = await createTwoFaLib(
      deviceIdentifier,
      cryptoLib,
      'testpassword' as Passphrase,
    )

    const entryId = await result.twoFaLib.vault.addEntry(totpEntry)

    const locked =
      await result.twoFaLib.persistentStorage.getLockedRepresentation()
    expect(locked).toHaveLength(345)

    const second2faLib = new TwoFaLib(deviceIdentifier, cryptoLib)
    await second2faLib.init(
      result.encryptedPrivateKey,
      result.encryptedSymmetricKey,
      result.salt,
      'testpassword' as Passphrase,
    )
    await second2faLib.persistentStorage.loadFromLockedRepresentation(locked)

    const retrieved = second2faLib.vault.getEntryMeta(entryId)
    expect(retrieved).toEqual(
      _.omit(
        {
          ...totpEntry,
          id: entryId,
          order: 0,
          addedAt: expect.any(Number) as number,
          updatedAt: null,
        },
        'payload',
      ),
    )
  }, 15000) // long running test

  it('should throw an error on invalid passphrase', async () => {
    await expect(
      twoFaLib.init(
        encryptedPrivateKey,
        encryptedSymmetricKey,
        salt,
        'not-the-passphrase' as Passphrase,
      ),
    ).rejects.toThrow('Invalid passphrase')
  })

  it('should throw an error on invalid private key', async () => {
    await expect(
      twoFaLib.init(
        'not-a-key' as EncryptedPrivateKey,
        encryptedSymmetricKey,
        salt,
        'testpassword' as Passphrase,
      ),
    ).rejects.toThrow('Invalid private key')
  })

  it('should add and retrieve a Entry', async () => {
    const entryId = await twoFaLib.vault.addEntry(totpEntry)
    const retrieved = twoFaLib.vault.getEntryMeta(entryId)

    expect(retrieved).toEqual(
      _.omit(
        {
          ...totpEntry,
          id: entryId,
          order: 0,
          addedAt: expect.any(Number) as number,
          updatedAt: null,
        },
        'payload',
      ),
    )
  })

  it('should generate an otp', async () => {
    const id = await twoFaLib.vault.addEntry(totpEntry)
    const otp = twoFaLib.vault.generateTokenForEntry(id, new Date(0).getTime())

    expect(otp).toEqual({
      otp: '810290',
      validFrom: 0,
      validTill: totpEntry.payload.period * 1000,
    })
  })

  it('should get all Entries', async () => {
    const totpEntry2: NewEntry = {
      ...totpEntry,
      payload: { ...totpEntry.payload, secret: 'Secret2' },
    }

    const id1 = await twoFaLib.vault.addEntry(totpEntry)
    const id2 = await twoFaLib.vault.addEntry(totpEntry2)

    const allEntries = twoFaLib.vault.listEntries()
    expect(allEntries).toHaveLength(2)
    expect(allEntries[0]).toEqual(id1)
    expect(allEntries[1]).toEqual(id2)
  })

  it('should delete a Entry', async () => {
    const id = await twoFaLib.vault.addEntry(totpEntry)
    expect(twoFaLib.vault.listEntries()).toHaveLength(1)

    await twoFaLib.vault.deleteEntry(id)
    expect(twoFaLib.vault.listEntries()).toHaveLength(0)
  })

  it('should throw an error when getting a non-existent Entry', () => {
    expect(() =>
      twoFaLib.vault.getEntryMeta('non-existing' as EntryId),
    ).toThrow('Entry not found')
  })

  it('should throw an error when deleting a non-existent Entry', async () => {
    await expect(() =>
      twoFaLib.vault.deleteEntry('non-existing' as EntryId),
    ).rejects.toThrow('Entry not found')
  })

  it('should update an existing entry', async () => {
    const entryId = await twoFaLib.vault.addEntry(totpEntry)
    const updatedEntry = {
      ...totpEntry,
      name: 'Updated TOTP',
      issuer: 'Updated Issuer',
    }

    const updated = await twoFaLib.vault.updateEntry(entryId, updatedEntry)

    expect(updated).toEqual(
      expect.objectContaining({
        id: entryId,
        name: 'Updated TOTP',
        issuer: 'Updated Issuer',
      }),
    )

    const retrieved = twoFaLib.vault.getEntryMeta(entryId)
    expect(retrieved).toEqual(updated)
  })

  it('should throw an error when updating a non-existent entry', async () => {
    await expect(
      twoFaLib.vault.updateEntry('non-existing' as EntryId, totpEntry),
    ).rejects.toThrow(EntryNotFoundError)
  })

  it('should search for entries', async () => {
    const id1 = await twoFaLib.vault.addEntry(totpEntry)
    const id2 = await twoFaLib.vault.addEntry(anotherTotpEntry)

    const searchResults = twoFaLib.vault.searchEntries('test')
    expect(searchResults).toContain(id1)
    expect(searchResults).not.toContain(id2)

    const anotherSearch = twoFaLib.vault.searchEntries('another')
    expect(anotherSearch).toContain(id2)
    expect(anotherSearch).not.toContain(id1)
  })

  it('should search for entry metas', async () => {
    const id1 = await twoFaLib.vault.addEntry(totpEntry)
    const id2 = await twoFaLib.vault.addEntry(anotherTotpEntry)

    const searchResults = twoFaLib.vault.searchEntriesMetas('test')
    expect(searchResults).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: id1 })]),
    )
    expect(searchResults).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: id2 })]),
    )

    const anotherSearch = twoFaLib.vault.searchEntriesMetas('another')
    expect(anotherSearch).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: id2 })]),
    )
    expect(anotherSearch).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: id1 })]),
    )
  })

  it('should list all entry metas', async () => {
    const id1 = await twoFaLib.vault.addEntry(totpEntry)
    const id2 = await twoFaLib.vault.addEntry(anotherTotpEntry)

    const allMetas = twoFaLib.vault.listEntriesMetas()
    expect(allMetas).toHaveLength(2)
    expect(allMetas[0]).toEqual(expect.objectContaining({ id: id1 }))
    expect(allMetas[1]).toEqual(expect.objectContaining({ id: id2 }))
  })

  it('should change passphrase', async () => {
    const oldPassphrase = 'testpassword' as Passphrase
    const newPassphrase = 'newpassword' as Passphrase
    let savedData: SaveFunctionData

    const mockSaveFunction = vi.fn((data: SaveFunctionData) => {
      savedData = data
      return Promise.resolve()
    })

    const result = await createTwoFaLib(
      deviceIdentifier,
      cryptoLib,
      oldPassphrase,
      mockSaveFunction,
    )
    const originalTwoFaLib = result.twoFaLib

    await originalTwoFaLib.persistentStorage.changePassphrase(
      oldPassphrase,
      newPassphrase,
    )

    // Verify that the save function was called
    expect(mockSaveFunction).toHaveBeenCalled()

    if (!savedData!) {
      throw new Error('No saved data')
    }

    // Create a new TwoFaLib instance with the saved data
    const newTwoFaLib = new TwoFaLib(deviceIdentifier, cryptoLib)
    await newTwoFaLib.init(
      savedData.encryptedPrivateKey,
      savedData.encryptedSymmetricKey,
      savedData.salt,
      newPassphrase,
    )

    // Verify that the new passphrase works
    await expect(
      newTwoFaLib.persistentStorage.validatePassphrase(
        savedData.salt,
        newPassphrase,
      ),
    ).resolves.toBe(true)

    // Verify that the old passphrase no longer works
    await expect(
      newTwoFaLib.persistentStorage.validatePassphrase(
        savedData.salt,
        oldPassphrase,
      ),
    ).resolves.toBe(false)
  }, 15000) // long running test

  it('should validate correct passphrase', async () => {
    const isValid = await twoFaLib.persistentStorage.validatePassphrase(
      salt,
      passphrase,
    )
    expect(isValid).toBe(true)
  })

  it('should invalidate incorrect passphrase', async () => {
    const isValid = await twoFaLib.persistentStorage.validatePassphrase(
      salt,
      'wrongpassword!' as Passphrase,
    )
    expect(isValid).toBe(false)
  })

  it('should generate different OTPs for different timestamps', async () => {
    const entryId = await twoFaLib.vault.addEntry(totpEntry)
    const otp1 = twoFaLib.vault.generateTokenForEntry(entryId, 0)
    const otp2 = twoFaLib.vault.generateTokenForEntry(entryId, 30000) // 30 seconds later

    expect(otp1.otp).not.toEqual(otp2.otp)
    expect(otp1.validFrom).toBeLessThan(otp2.validFrom)
    expect(otp1.validTill).toBeLessThan(otp2.validTill)
  })

  it('should call save function when changes are made', async () => {
    const mockSaveFunction = vi.fn()
    const result = await createTwoFaLib(
      deviceIdentifier,
      cryptoLib,
      'testpassword' as Passphrase,
      mockSaveFunction,
    )
    const twoFaLib = result.twoFaLib
    // Check if save function was called
    expect(mockSaveFunction).toHaveBeenCalledTimes(1)

    // Add an entry
    await twoFaLib.vault.addEntry(totpEntry)

    // Check if save function was called again
    expect(mockSaveFunction).toHaveBeenCalledTimes(2)
    expect(mockSaveFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        lockedRepresentation: expect.any(String) as string,
        encryptedPrivateKey: expect.any(String) as string,
        encryptedSymmetricKey: expect.any(String) as string,
        salt: expect.any(String) as string,
      }),
      expect.objectContaining({
        lockedRepresentation: true,
        encryptedPrivateKey: true,
        encryptedSymmetricKey: true,
        salt: true,
      }),
    )

    // Reset mock
    mockSaveFunction.mockClear()

    // Update an entry
    const entries = twoFaLib.vault.listEntries()
    await twoFaLib.vault.updateEntry(entries[0], { name: 'Updated TOTP' })

    // Check if save function was called
    expect(mockSaveFunction).toHaveBeenCalledTimes(1)
    expect(mockSaveFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        lockedRepresentation: expect.any(String) as string,
        encryptedPrivateKey: expect.any(String) as string,
        encryptedSymmetricKey: expect.any(String) as string,
        salt: expect.any(String) as string,
      }),
      expect.objectContaining({
        lockedRepresentation: true,
        encryptedPrivateKey: false,
        encryptedSymmetricKey: false,
        salt: false,
      }),
    )
  }, 15000) // long running test

  describe('exportEntries', () => {
    beforeEach(async () => {
      await twoFaLib.vault.addEntry(totpEntry)
      await twoFaLib.vault.addEntry(anotherTotpEntry)
    })

    it('should export entries in text format', async () => {
      const result = await twoFaLib.exportImport.exportEntries('text')
      expect(result).toContain(
        'otpauth://totp/Test%20Issuer:Test%20TOTP?secret=TESTSECRET&issuer=Test%20Issuer&algorithm=SHA-1&digits=6&period=30',
      )
      expect(result).toContain(
        'otpauth://totp/Another%20Issuer:Another%20TOTP?secret=TESTSECRET&issuer=Another%20Issuer&algorithm=SHA-1&digits=6&period=30',
      )
    })

    it('should export entries in HTML format', async () => {
      const result = await twoFaLib.exportImport.exportEntries('html')
      expect(result).toContain('<html>')
      expect(result).toContain('Test TOTP')
      expect(result).toContain('Another TOTP')
      expect(result).toContain('Test Issuer')
      expect(result).toContain('Another Issuer')
    })

    it('should throw an error for invalid format', async () => {
      await expect(
        twoFaLib.exportImport.exportEntries('invalid' as 'html'),
      ).rejects.toThrow('Invalid export format')
    })

    it('should encrypt the export when password is provided', async () => {
      const password = 'exportPassword'
      const result = await twoFaLib.exportImport.exportEntries('text', password)

      expect(result).not.toContain('Test TOTP')
      expect(result).not.toContain('TESTSECRET')

      const decrypted = await openpgp.decrypt({
        message: await openpgp.readMessage({ armoredMessage: result }),
        passwords: [password],
      })

      expect(decrypted.data).toContain(
        'otpauth://totp/Test%20Issuer:Test%20TOTP?secret=TESTSECRET&issuer=Test%20Issuer&algorithm=SHA-1&digits=6&period=30',
      )
      expect(decrypted.data).toContain(
        'otpauth://totp/Another%20Issuer:Another%20TOTP?secret=TESTSECRET&issuer=Another%20Issuer&algorithm=SHA-1&digits=6&period=30',
      )
    })

    it('should encrypt HTML export when password is provided', async () => {
      const password = 'exportPassword'
      const result = await twoFaLib.exportImport.exportEntries('html', password)

      expect(result).not.toContain('<html>')
      expect(result).not.toContain('Test TOTP')

      const decrypted = await openpgp.decrypt({
        message: await openpgp.readMessage({ armoredMessage: result }),
        passwords: [password],
      })

      expect(decrypted.data).toContain('<html>')
      expect(decrypted.data).toContain('Test TOTP')
    })
  })

  it('should import a TOTP entry from a QR code image', async () => {
    // contains the same data as totpEntry
    const importedEntryId =
      await twoFaLib.exportImport.importFromQRCode(qrImageDataUrl)

    const importedEntry = twoFaLib.vault.getEntryMeta(importedEntryId)

    expect(importedEntry).toEqual(
      expect.objectContaining({
        name: totpEntry.name,
        issuer: totpEntry.issuer,
        type: totpEntry.type,
      }),
    )

    // Generate a token for the imported entry
    const token = twoFaLib.vault.generateTokenForEntry(importedEntryId)

    expect(token).toEqual({
      otp: expect.any(String) as string,
      validFrom: expect.any(Number) as number,
      validTill: expect.any(Number) as number,
    })

    expect(token.otp).toHaveLength(totpEntry.payload.digits)
  })

  it('should throw an error when importing an invalid QR code', async () => {
    const invalidQrData = Buffer.from('invalid data')

    await expect(
      twoFaLib.exportImport.importFromQRCode(invalidQrData),
    ).rejects.toThrow('Unsupported image type')
  })

  describe('importFromUri', () => {
    it('should successfully import a valid OTP URI', async () => {
      const otpUri =
        'otpauth://totp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example'

      const entryId = await twoFaLib.exportImport.importFromUri(otpUri)

      // Verify that an entry was added
      expect(entryId).toBeDefined()

      // Retrieve the entry and check its properties
      const entry = twoFaLib.vault.getEntryMeta(entryId)

      expect(entry).toEqual(
        expect.objectContaining({
          name: 'alice@google.com',
          issuer: 'Example',
          type: 'TOTP',
        }),
      )

      // Generate a token to ensure the entry is valid
      const token = twoFaLib.vault.generateTokenForEntry(entryId)
      expect(token).toEqual(
        expect.objectContaining({
          otp: expect.any(String) as string,
          validFrom: expect.any(Number) as number,
          validTill: expect.any(Number) as number,
        }),
      )
      expect(token.otp).toHaveLength(6) // Default digit length
    })

    it('should throw an error for an invalid OTP URI', async () => {
      const invalidUri = 'https://example.com'

      await expect(
        twoFaLib.exportImport.importFromUri(invalidUri),
      ).rejects.toThrow('Invalid OTP URI')
    })

    it('should throw an error for an unsupported OTP type', async () => {
      const hotp =
        'otpauth://hotp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example'

      await expect(twoFaLib.exportImport.importFromUri(hotp)).rejects.toThrow(
        'Unsupported OTP type "hotp"',
      )
    })

    it('should handle URIs with missing optional parameters', async () => {
      const minimalUri = 'otpauth://totp/Minimal?secret=JBSWY3DPEHPK3PXP'

      const entryId = await twoFaLib.exportImport.importFromUri(minimalUri)
      const entry = twoFaLib.vault.getEntryMeta(entryId)

      expect(entry).toEqual(
        expect.objectContaining({
          issuer: 'Minimal',
          name: 'Imported Entry',
          type: 'TOTP',
        }),
      )

      const token = twoFaLib.vault.generateTokenForEntry(entryId)
      expect(token.otp).toHaveLength(6) // Default digit length
    })
  })

  describe('importFromTextFile', () => {
    beforeEach(async () => {
      await clearEntries(twoFaLib)
    })

    it('should import valid entries from a text file', async () => {
      const fileContents = `
        otpauth://totp/Test%20Issuer:Test%20TOTP?secret=TESTSECRET&issuer=Test%20Issuer&algorithm=SHA-1&digits=6&period=30
        otpauth://totp/Another%20Issuer:Another%20TOTP?secret=ANOTHERSECRET&issuer=Another%20Issuer&algorithm=SHA-256&digits=8&period=60
      `.trim()

      const result =
        await twoFaLib.exportImport.importFromTextFile(fileContents)

      expect(result).toHaveLength(2)
      expect(result[0].entryId).toBeTruthy()
      expect(result[0].error).toBeNull()
      expect(result[1].entryId).toBeTruthy()
      expect(result[1].error).toBeNull()

      const entries = twoFaLib.vault.listEntriesMetas()
      expect(entries).toHaveLength(2)
      expect(entries[0]).toMatchObject({
        name: 'Test TOTP',
        issuer: 'Test Issuer',
        type: 'TOTP',
      })
      expect(entries[1]).toMatchObject({
        name: 'Another TOTP',
        issuer: 'Another Issuer',
        type: 'TOTP',
      })
    })

    it('should handle invalid entries in the text file', async () => {
      const fileContents = `
        otpauth://totp/Test%20Issuer:Test%20TOTP?secret=TESTSECRET&issuer=Test%20Issuer&algorithm=SHA-1&digits=6&period=30
        invalid_line
        otpauth://hotp/Invalid:HOTP?secret=INVALIDSECRET&issuer=Invalid&algorithm=SHA-1&digits=6&counter=0
      `.trim()

      const result =
        await twoFaLib.exportImport.importFromTextFile(fileContents)

      expect(result).toHaveLength(3)
      expect(result[0].entryId).toBeTruthy()
      expect(result[0].error).toBeNull()
      expect(result[1].entryId).toBeNull()
      expect(result[1].error).toBeTruthy()
      expect(result[2].entryId).toBeNull()
      expect(result[2].error).toBeTruthy()

      const entries = twoFaLib.vault.listEntriesMetas()
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        name: 'Test TOTP',
        issuer: 'Test Issuer',
        type: 'TOTP',
      })
    })

    it('should give no errors on importing empty file', async () => {
      const contents = await twoFaLib.exportImport.exportEntries('text')
      const result = await twoFaLib.exportImport.importFromTextFile(contents)
      expect(result).toHaveLength(0)

      const password = 'testPassword'
      const encryptedContents = await twoFaLib.exportImport.exportEntries(
        'text',
        password,
      )
      const resultEncrypted = await twoFaLib.exportImport.importFromTextFile(
        encryptedContents,
        password,
      )
      expect(resultEncrypted).toHaveLength(0)
    })

    it('should import entries from an encrypted text file', async () => {
      await twoFaLib.vault.addEntry(totpEntry)
      await twoFaLib.vault.addEntry(anotherTotpEntry)

      const password = 'testPassword'
      const encryptedContents = await twoFaLib.exportImport.exportEntries(
        'text',
        password,
      )

      await clearEntries(twoFaLib)

      const result = await twoFaLib.exportImport.importFromTextFile(
        encryptedContents,
        password,
      )

      expect(result).toHaveLength(2)
      expect(result[0].entryId).toBeTruthy()
      expect(result[0].error).toBeNull()
      expect(result[1].entryId).toBeTruthy()
      expect(result[1].error).toBeNull()

      const entries = twoFaLib.vault.listEntriesMetas()
      expect(entries).toHaveLength(2)
      expect(entries[0]).toMatchObject({
        name: 'Test TOTP',
        issuer: 'Test Issuer',
        type: 'TOTP',
      })
      expect(entries[1]).toMatchObject({
        name: 'Another TOTP',
        issuer: 'Another Issuer',
        type: 'TOTP',
      })
    })

    it('should throw an error when trying to decrypt with an incorrect password', async () => {
      const correctPassword = 'correctPassword'
      const incorrectPassword = 'incorrectPassword'
      const encryptedContents = await twoFaLib.exportImport.exportEntries(
        'text',
        correctPassword,
      )

      await expect(
        twoFaLib.exportImport.importFromTextFile(
          encryptedContents,
          incorrectPassword,
        ),
      ).rejects.toThrow()
    })
  })

  describe('Add device flow', () => {
    let mockWebSocketInstance: WebSocket

    beforeEach(() => {
      // Reset the mock before each test
      vi.mocked(WebSocket).mockClear()
      mockWebSocketInstance = {
        send: vi.fn(),
        close: vi.fn(),
        on: vi.fn((event, callback) => {
          if (event === 'message') {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            mockWebSocketInstance.onmessage = callback
          }
        }),
        onmessage: null,
        onopen: null,
        readyState: OriginalWebSocket.OPEN,
      } as unknown as WebSocket
      vi.mocked(WebSocket).mockImplementation(() => mockWebSocketInstance)
    })

    it('should complete the full flow', async () => {
      const senderTwoFaLib = new TwoFaLib('sender', cryptoLib)
      await senderTwoFaLib.init(
        encryptedPrivateKey,
        encryptedSymmetricKey,
        salt,
        passphrase,
        'ws://example.org',
      )

      const receiverTwoFaLib = new TwoFaLib('receiver', cryptoLib)
      await receiverTwoFaLib.init(
        encryptedPrivateKey,
        encryptedSymmetricKey,
        salt,
        passphrase,
        'ws://example.org',
      )

      if (!senderTwoFaLib.sync || !receiverTwoFaLib.sync) {
        throw new Error('Sync manager not initialized')
      }

      const initiateResultPromise =
        senderTwoFaLib.sync.initiateAddDeviceFlow(false)

      /* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
      // @ts-expect-error it's mocked
      const callbacks = mockWebSocketInstance.on.mock.calls
        .filter((call: any) => call[0] === 'message')
        .map(([, cb]: [any, any]) => cb) as ((data: any) => void)[]
      /* eslint-enable */
      const [callbackSender, callbackReceiver] = callbacks

      await sleep(10)

      // Simulate WebSocket response
      callbackSender({
        data: JSON.stringify({
          type: 'addDeviceFlowRequestRegistered',
        }),
      })

      const initiateResult = await initiateResultPromise

      await receiverTwoFaLib.sync.respondToAddDeviceFlow(initiateResult)

      // Capture the message sent by receiverTwoFaLib
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const mockSend = vi.mocked(mockWebSocketInstance.send)
      expect(mockSend).toHaveBeenCalled()
      const sentMessage = mockSend.mock.calls[1][0]

      // Parse the sent message
      const parsedMessage = JSON.parse(String(sentMessage)) as Record<
        string,
        unknown
      >

      callbackSender({
        data: JSON.stringify({
          type: 'addDevicePassPass2Result',
          data: parsedMessage.data,
        }),
      })

      await sleep(10)
      const sentMessage2 = mockSend.mock.calls[2][0]
      // Parse the sent message
      const parsedMessage2 = JSON.parse(String(sentMessage2)) as Record<
        string,
        unknown
      >

      callbackReceiver({
        data: JSON.stringify({
          type: 'addDevicePassPass3Result',
          data: parsedMessage2.data,
        }),
      })
    })

    /*
    describe('initiateAddDeviceFlow', () => {
      it('should initialize the add device flow and return necessary data', async () => {
        const result = await twoFaLib.sync.initiateAddDeviceFlow(false)

        expect(twoFaLib.inAddDeviceFlow).toBe(true)

        expect(result).toEqual({
          deviceIdentifier: expect.any(String) as string,
          addDevicePassword: expect.any(String) as string,
          pass1Result: {
            G1: expect.any(String) as string,
            G2: expect.any(String) as string,
            ZKPx1: expect.any(String) as string,
            ZKPx2: expect.any(String) as string,
          },
          timestamp: expect.any(Number) as number,
          userIdString: expect.any(String) as string,
        })
      })

      it('should generate a valid QR code for the add device flow', async () => {
        const twoFaLib = new TwoFaLib(deviceIdentifier, cryptoLib)
        await twoFaLib.init(
          encryptedPrivateKey,
          encryptedSymmetricKey,
          salt,
          passphrase,
        )

        const result = await twoFaLib.sync.initiateAddDeviceFlow(true)

        expect(result).toBeTruthy()
        expect(result).toMatch(/^data:image\/png;base64,/)
      })

      it('should throw an error if add device flow is already active', async () => {
        const twoFaLib = new TwoFaLib(deviceIdentifier, cryptoLib)
        await twoFaLib.init(
          encryptedPrivateKey,
          encryptedSymmetricKey,
          salt,
          passphrase,
        )

        await twoFaLib.sync.initiateAddDeviceFlow()

        await expect(twoFaLib.sync.initiateAddDeviceFlow()).rejects.toThrow(
          'Add device flow already active',
        )
      })
    })
    */
  })
})
