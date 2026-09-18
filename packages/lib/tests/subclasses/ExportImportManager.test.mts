import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import * as openpgp from 'openpgp'

import { FavaLib } from '../../src/main.mjs'
import type { UrlMatcher } from '../../src/main.mjs'
import { MAX_INPUT_SELECTOR_LENGTH } from '../../src/utils/matcherValidation.mjs'

import {
  anotherNewTotpEntry,
  matcherNewTotpEntry,
  newTotpEntry,
  clearEntries,
  createFavaLibForTests,
  password,
} from '../testUtils.mjs'

describe('ExportImportManager', () => {
  let favaLib: FavaLib
  let qrImageDataUrl: string

  beforeAll(async () => {
    favaLib = (await createFavaLibForTests()).favaLib

    // Read the QR code image file
    const qrImageBuffer = await fs.readFile(path.join(__dirname, '../qr.png'))
    qrImageDataUrl = `data:image/png;base64,${qrImageBuffer.toString('base64')}`
  })

  beforeEach(async () => {
    await clearEntries(favaLib)
  })

  describe('exportEntries', () => {
    beforeEach(async () => {
      await favaLib.vault.addEntry(newTotpEntry)
      await favaLib.vault.addEntry(anotherNewTotpEntry)
    })

    it('should export entries in text format', async () => {
      const result = await favaLib.exportImport.exportEntries(
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
      const result = await favaLib.exportImport.exportEntries(
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
        favaLib.exportImport.exportEntries(
          'invalid' as 'html',
          undefined,
          true,
        ),
      ).rejects.toThrow('Invalid export format')
    })

    it('should encrypt the export when password is provided', async () => {
      const result = await favaLib.exportImport.exportEntries('text', password)

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
      const result = await favaLib.exportImport.exportEntries('html', password)

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
      await expect(favaLib.exportImport.exportEntries('text')).rejects.toThrow(
        'User was not warned about the dangers of unencrypted exporting',
      )
    })

    it('should throw an error when password is too weak', async () => {
      await favaLib.vault.addEntry(newTotpEntry)
      await favaLib.vault.addEntry(anotherNewTotpEntry)

      const weakPassword = 'weak'

      await expect(
        favaLib.exportImport.exportEntries('text', weakPassword),
      ).rejects.toThrow('Password is too weak')
    })

    it('should export and preserve match properties in text format', async () => {
      // Create an entry with match properties
      await favaLib.vault.addEntry({
        name: 'GitHub TOTP',
        issuer: 'GitHub',
        type: 'TOTP',
        matchers: [{ type: 'BaseDomain', value: 'github.com' }],
        payload: {
          secret: 'GITHUBSECRET',
          period: 30,
          algorithm: 'SHA-1',
          digits: 6,
        },
      })

      const result = await favaLib.exportImport.exportEntries(
        'text',
        undefined,
        true,
      )

      // Should include the matcher parameters in the export
      expect(result).toContain('favaMatcher=BaseDomain:github.com')
      expect(result).toContain('otpauth://totp/GitHub:GitHub%20TOTP')
    })
  })

  it('should import a TOTP entry from a QR code image', async () => {
    // contains the same data as totpEntry
    const importedEntryId =
      await favaLib.exportImport.importFromQRCode(qrImageDataUrl)

    const importedEntry = favaLib.vault.getEntryMeta(importedEntryId)

    expect(importedEntry).toEqual(
      expect.objectContaining({
        name: newTotpEntry.name,
        issuer: newTotpEntry.issuer,
        type: newTotpEntry.type,
      }),
    )

    // Generate a token for the imported entry
    const token = await favaLib.vault.generateTokenForEntry(importedEntryId)

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
      favaLib.exportImport.importFromQRCode(invalidQrData),
    ).rejects.toThrow('Unsupported image type')
  })

  describe('importFromUri', () => {
    it('should throw an error for an invalid OTP URI', async () => {
      const invalidUri = 'https://example.com'

      await expect(
        favaLib.exportImport.importFromUri(invalidUri),
      ).rejects.toThrow('Invalid OTP URI')
    })

    it('should throw an error for an unsupported OTP type', async () => {
      const hotp =
        'otpauth://hotp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example'

      await expect(favaLib.exportImport.importFromUri(hotp)).rejects.toThrow(
        'Unsupported OTP type "hotp"',
      )
    })

    it('should handle URIs with missing optional parameters', async () => {
      const minimalUri = 'otpauth://totp/Minimal?secret=JBSWY3DPEHPK3PXP'

      const entryId = await favaLib.exportImport.importFromUri(minimalUri)
      const entry = favaLib.vault.getEntryMeta(entryId)

      expect(entry).toEqual(
        expect.objectContaining({
          issuer: 'Minimal',
          name: 'Imported Entry',
          type: 'TOTP',
        }),
      )

      const token = await favaLib.vault.generateTokenForEntry(entryId)
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
        testCases.map((tc) => favaLib.exportImport.importFromUri(tc.uri)),
      )

      // Verify that entries were added
      expect(entryIds).toHaveLength(testCases.length)
      entryIds.forEach((id) => expect(id).toBeDefined())

      // Retrieve the entries and check their properties
      const entries = entryIds.map((id) => favaLib.vault.getEntryMeta(id))

      testCases.forEach((tc, index) => {
        expect(entries[index]).toEqual(expect.objectContaining(tc.expected))
      })

      // Generate tokens to ensure the entries are valid
      const tokens = await Promise.all(
        entryIds.map((id) => favaLib.vault.generateTokenForEntry(id)),
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

    it('should import and preserve match properties from URI', async () => {
      const uriWithMatchers =
        'otpauth://totp/GitHub:GitHub%20TOTP?secret=GITHUBSECRET&issuer=GitHub&algorithm=SHA-1&digits=6&period=30' +
        '&favaMatcher=BaseDomain:github.com' +
        '&favaMatcher=UrlPrefix:https%3A%2F%2Fgithub.com%2Flogin' +
        '&favaUrl=https%3A%2F%2Fgithub.com%2Flogin' +
        '&favaInputSelector=%23otp'

      const entryId = await favaLib.exportImport.importFromUri(uriWithMatchers)
      const entry = favaLib.vault.getEntryMeta(entryId)

      expect(entry).toEqual(
        expect.objectContaining({
          name: 'GitHub TOTP',
          issuer: 'GitHub',
          type: 'TOTP',
          matchers: [
            { type: 'BaseDomain', value: 'github.com' },
            { type: 'UrlPrefix', value: 'https://github.com/login' },
          ],
          url: 'https://github.com/login',
          inputSelector: '#otp',
        }),
      )
    })

    it('should drop an unusable matcher but keep the secret', async () => {
      const uriWithBadMatcher =
        'otpauth://totp/GitHub:GitHub%20TOTP?secret=GITHUBSECRET&issuer=GitHub&algorithm=SHA-1&digits=6&period=30' +
        '&favaMatcher=NotAType:github.com' +
        '&favaMatcher=Regex:(a%2B)%2B' +
        '&favaMatcher=Host:github.com'

      const entryId =
        await favaLib.exportImport.importFromUri(uriWithBadMatcher)
      const entry = favaLib.vault.getEntryMeta(entryId)

      expect(entry.matchers).toEqual([{ type: 'Host', value: 'github.com' }])
    })

    it('should round-trip matchers through an export', async () => {
      await clearEntries(favaLib)
      await favaLib.vault.addEntry(matcherNewTotpEntry)
      const uri = (
        await favaLib.exportImport.exportEntries('text', undefined, true)
      ).trim()

      await clearEntries(favaLib)
      const reimportedId = await favaLib.exportImport.importFromUri(uri)
      const reimported = favaLib.vault.getEntryMeta(reimportedId)

      expect(reimported.matchers).toEqual(matcherNewTotpEntry.matchers)
      expect(reimported.url).toEqual(matcherNewTotpEntry.url)
      expect(reimported.inputSelector).toEqual(
        matcherNewTotpEntry.inputSelector,
      )
    })

    it.each<{ matcher: UrlMatcher; url: string }>([
      ...['a%2Fb', 'a%25b', 'a%b', 'a+b'].map((path) => ({
        matcher: {
          type: 'UrlPrefix' as const,
          value: `https://example.com/${path}`,
        },
        url: `https://example.com/${path}`,
      })),
      {
        matcher: {
          type: 'Regex',
          value: String.raw`https://example\.com/\d+%2F\w+`,
        },
        url: 'https://example.com/123%2Fabc',
      },
    ])(
      'preserves matcher values and behavior for $url',
      async ({ matcher, url }) => {
        const originalId = await favaLib.vault.addEntry({
          ...newTotpEntry,
          matchers: [matcher],
        })
        expect(favaLib.vault.findEntriesForUrl(url)).toEqual([originalId])
        const exported = await favaLib.exportImport.exportEntries(
          'text',
          undefined,
          true,
        )

        await clearEntries(favaLib)
        const importedId = await favaLib.exportImport.importFromUri(exported)
        expect(favaLib.vault.getEntryMeta(importedId).matchers).toEqual([
          matcher,
        ])
        expect(favaLib.vault.findEntriesForUrl(url)).toEqual([importedId])
      },
    )

    it.each([
      ['LF', '#form\n input', null],
      ['CR', '#form\r input', null],
      ['CRLF', '#form\r\n input', null],
      ['empty', '', null],
      ['oversized', 'x'.repeat(MAX_INPUT_SELECTOR_LENGTH + 1), null],
      ['valid', '#form input[name="otp"]', '#form input[name="otp"]'],
    ])(
      'imports the secret with a %s selector',
      async (_label, selector, expected) => {
        const uri =
          'otpauth://totp/Example:Account?secret=TESTSECRET&issuer=Example' +
          `&favaInputSelector=${encodeURIComponent(selector)}`
        const entryId = await favaLib.exportImport.importFromUri(uri)

        expect(favaLib.vault.getEntryMeta(entryId).inputSelector).toBe(expected)
        expect(
          (await favaLib.vault.generateTokenForEntry(entryId, 0)).otp,
        ).toBe('810290')
      },
    )

    it('should keep the generated uri parseable and its otp params intact', async () => {
      await clearEntries(favaLib)
      await favaLib.vault.addEntry(matcherNewTotpEntry)
      const uri = (
        await favaLib.exportImport.exportEntries('text', undefined, true)
      ).trim()

      const parsed = new URL(uri)
      expect(parsed.searchParams.get('secret')).toBe('TESTSECRET')
      expect(parsed.searchParams.get('algorithm')).toBe('SHA-1')
      expect(parsed.searchParams.get('digits')).toBe('6')
      expect(parsed.searchParams.get('period')).toBe('30')
      expect(parsed.searchParams.get('issuer')).toBe('Matcher Issuer')
    })
  })

  describe('importFromTextFile', () => {
    beforeEach(async () => {
      await clearEntries(favaLib)
    })

    it('should import valid entries from a text file', async () => {
      const fileContents = `
        otpauth://totp/Test%20Issuer:Test%20TOTP?secret=TESTSECRET&issuer=Test%20Issuer&algorithm=SHA-1&digits=6&period=30
        otpauth://totp/Another%20Issuer:Another%20TOTP?secret=ANOTHERSECRET&issuer=Another%20Issuer&algorithm=SHA-256&digits=8&period=60
      `.trim()

      const result = await favaLib.exportImport.importFromTextFile(fileContents)

      expect(result).toHaveLength(2)
      expect(result[0].entryId).toBeTruthy()
      expect(result[0].error).toBeNull()
      expect(result[1].entryId).toBeTruthy()
      expect(result[1].error).toBeNull()

      const entries = favaLib.vault.listEntriesMetas()
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

      const result = await favaLib.exportImport.importFromTextFile(fileContents)

      expect(result).toHaveLength(3)
      expect(result[0].entryId).toBeTruthy()
      expect(result[0].error).toBeNull()
      expect(result[1].entryId).toBeNull()
      expect(result[1].error).toBeTruthy()
      expect(result[2].entryId).toBeNull()
      expect(result[2].error).toBeTruthy()

      const entries = favaLib.vault.listEntriesMetas()
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        name: 'Test TOTP',
        issuer: 'Test Issuer',
        type: 'TOTP',
      })
    })

    it('should give no errors on importing empty file', async () => {
      const contents = await favaLib.exportImport.exportEntries(
        'text',
        undefined,
        true,
      )
      const result = await favaLib.exportImport.importFromTextFile(contents)
      expect(result).toHaveLength(0)

      const encryptedContents = await favaLib.exportImport.exportEntries(
        'text',
        password,
      )
      const resultEncrypted = await favaLib.exportImport.importFromTextFile(
        encryptedContents,
        password,
      )
      expect(resultEncrypted).toHaveLength(0)
    })

    it('should import entries from an encrypted text file', async () => {
      await favaLib.vault.addEntry(newTotpEntry)
      await favaLib.vault.addEntry(anotherNewTotpEntry)

      const encryptedContents = await favaLib.exportImport.exportEntries(
        'text',
        password,
      )

      await clearEntries(favaLib)

      const result = await favaLib.exportImport.importFromTextFile(
        encryptedContents,
        password,
      )

      expect(result).toHaveLength(2)
      expect(result[0].entryId).toBeTruthy()
      expect(result[0].error).toBeNull()
      expect(result[1].entryId).toBeTruthy()
      expect(result[1].error).toBeNull()

      const entries = favaLib.vault.listEntriesMetas()
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
      const encryptedContents = await favaLib.exportImport.exportEntries(
        'text',
        correctPassword,
      )

      await expect(
        favaLib.exportImport.importFromTextFile(
          encryptedContents,
          incorrectPassword,
        ),
      ).rejects.toThrow()
    })
  })
})
