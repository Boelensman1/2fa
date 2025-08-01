import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import * as openpgp from 'openpgp'

import { TwoFaLib } from '../../src/main.mjs'

import {
  anotherNewTotpEntry,
  newTotpEntry,
  clearEntries,
  createTwoFaLibForTests,
  password,
} from '../testUtils.mjs'

describe('ExportImportManager', () => {
  let twoFaLib: TwoFaLib
  let qrImageDataUrl: string

  beforeAll(async () => {
    twoFaLib = (await createTwoFaLibForTests()).twoFaLib

    // Read the QR code image file
    const qrImageBuffer = await fs.readFile(path.join(__dirname, '../qr.png'))
    qrImageDataUrl = `data:image/png;base64,${qrImageBuffer.toString('base64')}`
  })

  beforeEach(async () => {
    await clearEntries(twoFaLib)
  })

  describe('exportEntries', () => {
    beforeEach(async () => {
      await twoFaLib.vault.addEntry(newTotpEntry)
      await twoFaLib.vault.addEntry(anotherNewTotpEntry)
    })

    it('should export entries in text format', async () => {
      const result = await twoFaLib.exportImport.exportEntries(
        'text',
        undefined,
        true,
      )
      expect(result).toContain(
        'otpauth://totp/Test%20Issuer:Test%20TOTP?secret=TESTSECRET&issuer=Test%20Issuer&algorithm=SHA-1&digits=6&period=30',
      )
      expect(result).toContain(
        'otpauth://totp/Another%20Issuer:Another%20TOTP?secret=TESTSECRET&issuer=Another%20Issuer&algorithm=SHA-1&digits=6&period=30',
      )
    })

    it('should export entries in HTML format', async () => {
      const result = await twoFaLib.exportImport.exportEntries(
        'html',
        undefined,
        true,
      )
      expect(result).toContain('<html>')
      expect(result).toContain('Test TOTP')
      expect(result).toContain('Another TOTP')
      expect(result).toContain('Test Issuer')
      expect(result).toContain('Another Issuer')
    })

    it('should throw an error for invalid format', async () => {
      await expect(
        twoFaLib.exportImport.exportEntries(
          'invalid' as 'html',
          undefined,
          true,
        ),
      ).rejects.toThrow('Invalid export format')
    })

    it('should encrypt the export when password is provided', async () => {
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

    it('should throw an error when user was not warned about exporting unencrypted', async () => {
      await expect(twoFaLib.exportImport.exportEntries('text')).rejects.toThrow(
        'User was not warned about the dangers of unencrypted exporting',
      )
    })

    it('should throw an error when password is too weak', async () => {
      await twoFaLib.vault.addEntry(newTotpEntry)
      await twoFaLib.vault.addEntry(anotherNewTotpEntry)

      const weakPassword = 'weak'

      await expect(
        twoFaLib.exportImport.exportEntries('text', weakPassword),
      ).rejects.toThrow('Password is too weak')
    })
  })

  it('should import a TOTP entry from a QR code image', async () => {
    // contains the same data as totpEntry
    const importedEntryId =
      await twoFaLib.exportImport.importFromQRCode(qrImageDataUrl)

    const importedEntry = twoFaLib.vault.getEntryMeta(importedEntryId)

    expect(importedEntry).toEqual(
      expect.objectContaining({
        name: newTotpEntry.name,
        issuer: newTotpEntry.issuer,
        type: newTotpEntry.type,
      }),
    )

    // Generate a token for the imported entry
    const token = twoFaLib.vault.generateTokenForEntry(importedEntryId)

    expect(token).toEqual({
      otp: expect.any(String) as string,
      validFrom: expect.any(Number) as number,
      validTill: expect.any(Number) as number,
    })

    expect(token.otp).toHaveLength(newTotpEntry.payload.digits)
  })

  it('should throw an error when importing an invalid QR code (Uint8Array)', async () => {
    const invalidQrData = new Uint8Array([1, 2, 3])

    await expect(
      twoFaLib.exportImport.importFromQRCode(invalidQrData),
    ).rejects.toThrow('Unsupported image type')
  })

  describe('importFromUri', () => {
    it('should successfully import valid OTP URIs', async () => {
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

    it('should successfully import multiple valid OTP URIs', async () => {
      const testCases = [
        {
          uri: 'otpauth://totp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example',
          expected: {
            name: 'alice@google.com',
            issuer: 'Example',
            type: 'TOTP',
          },
          digits: 6,
        },
        {
          uri: 'otpauth://totp/Another:bob@example.com?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ&issuer=Another&digits=8&period=60',
          expected: {
            name: 'bob@example.com',
            issuer: 'Another',
            type: 'TOTP',
          },
          digits: 8,
        },
        {
          // different format where the issuer is an url param
          uri: 'otpauth://totp/dave?secret=xxxxxxxxxxxxxx&issuer=Test',
          expected: {
            name: 'dave',
            issuer: 'Test',
            type: 'TOTP',
          },
          digits: 6,
        },
      ]

      const entryIds = await Promise.all(
        testCases.map((tc) => twoFaLib.exportImport.importFromUri(tc.uri)),
      )

      // Verify that entries were added
      expect(entryIds).toHaveLength(testCases.length)
      entryIds.forEach((id) => expect(id).toBeDefined())

      // Retrieve the entries and check their properties
      const entries = entryIds.map((id) => twoFaLib.vault.getEntryMeta(id))

      testCases.forEach((tc, index) => {
        expect(entries[index]).toEqual(expect.objectContaining(tc.expected))
      })

      // Generate tokens to ensure the entries are valid
      const tokens = entryIds.map((id) =>
        twoFaLib.vault.generateTokenForEntry(id),
      )

      tokens.forEach((token, index) => {
        expect(token).toEqual(
          expect.objectContaining({
            otp: expect.any(String) as string,
            validFrom: expect.any(Number) as number,
            validTill: expect.any(Number) as number,
          }),
        )
        expect(token.otp).toHaveLength(testCases[index].digits)
      })
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
      const contents = await twoFaLib.exportImport.exportEntries(
        'text',
        undefined,
        true,
      )
      const result = await twoFaLib.exportImport.importFromTextFile(contents)
      expect(result).toHaveLength(0)

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
      await twoFaLib.vault.addEntry(newTotpEntry)
      await twoFaLib.vault.addEntry(anotherNewTotpEntry)

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
      const correctPassword = password
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
})
