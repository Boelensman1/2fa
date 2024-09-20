import { TOTP } from 'totp-generator'
import { v4 as genUuidV4 } from 'uuid'

import type { ImageData } from 'canvas'

import type Entry from './interfaces/Entry.js'
import type { EntryId, EntryMeta, NewEntry } from './interfaces/Entry.js'

import type CryptoLib from './interfaces/CryptoLib.js'
import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Passphrase,
  PrivateKey,
  Salt,
  SymmetricKey,
} from './interfaces/CryptoLib.js'

import {
  InitializationError,
  AuthenticationError,
  EntryNotFoundError,
  TokenGenerationError,
} from './TwoFALibError.mjs'
import { SaveFunction } from './interfaces/SaveFunction.js'

import {
  SUPPORTED_ALGORITHMS,
  SupportedAlgorithmsType,
} from './utils/constants.mjs'
import {
  parseOtpUri,
  generateHtmlExport,
  generateTextExport,
  processImportLines,
  encryptExport,
  decryptExport,
} from './utils/exportImportUtils.mjs'
import { getImageDataBrowser, getImageDataNode } from './utils/getImageData.mjs'

const exportMetaEntry = (entry: Entry) => ({
  id: entry.id,
  name: entry.name,
  issuer: entry.issuer,
  type: entry.type,
  order: entry.order,
  addedAt: entry.addedAt,
  updatedAt: entry.updatedAt,
})

/**
 * Two-Factor Authentication Library
 * This library provides functionality for managing 2FA entries
 * and handling encrypted data.
 */
class TwoFaLib {
  private vault: Entry[] = []
  private saveFunction?: SaveFunction
  private privateKey?: PrivateKey
  private encryptedPrivateKey?: EncryptedPrivateKey
  private encryptedSymmetricKey?: EncryptedSymmetricKey
  private symmetricKey?: SymmetricKey
  private salt?: Salt
  private cryptolib: CryptoLib

  // libraries that are loaded on demand
  private openPgpLib?: typeof import('openpgp')
  private qrGeneratorLib?: typeof import('qrcode')
  private jsQrLib?: typeof import('jsqr').default
  private canvasLib?: typeof import('canvas')
  private urlParserLib?: typeof import('whatwg-url')

  private wasChangedSinceLastSave = {
    lockedRepresentation: true,
    encryptedPrivateKey: true,
    encryptedSymmetricKey: true,
    salt: true,
  }

  constructor(cryptolib: CryptoLib, saveFunction?: SaveFunction) {
    this.cryptolib = cryptolib
    this.saveFunction = saveFunction
  }

  private async getOpenPGPLib() {
    if (!this.openPgpLib) {
      // Dynamic import
      const module = await import('openpgp')
      this.openPgpLib = module
    }
    return this.openPgpLib
  }

  private async getQrGeneratorLib() {
    if (!this.qrGeneratorLib) {
      // Dynamic import
      const module = await import('qrcode')
      this.qrGeneratorLib = module.default
    }
    return this.qrGeneratorLib
  }

  private async getJsQrLib() {
    if (!this.jsQrLib) {
      // Dynamic import
      const module = await import('jsqr')
      this.jsQrLib = module.default.default
    }
    return this.jsQrLib
  }

  private async getCanvasLib() {
    if (typeof window !== 'undefined') {
      throw new Error('Canvas lib can not be loaded in browser env')
    }

    if (!this.canvasLib) {
      const module = await import('canvas')
      this.canvasLib = module.default
    }
    return this.canvasLib
  }

  private async getUrlParserLib() {
    if (!this.urlParserLib) {
      // Dynamic import
      const module = await import('whatwg-url')
      this.urlParserLib = module.default
    }
    return this.urlParserLib
  }

  async save() {
    if (
      !this.encryptedPrivateKey ||
      !this.encryptedSymmetricKey ||
      !this.salt
    ) {
      throw new InitializationError('Initialisation not completed')
    }

    if (this.saveFunction) {
      const wasChangedSinceLastSaveCache = this.wasChangedSinceLastSave
      this.wasChangedSinceLastSave = {
        lockedRepresentation: false,
        encryptedPrivateKey: false,
        encryptedSymmetricKey: false,
        salt: false,
      }
      const lockedRepresentation = await this.getLockedRepresentation()
      return this.saveFunction(
        {
          lockedRepresentation,
          encryptedPrivateKey: this.encryptedPrivateKey,
          encryptedSymmetricKey: this.encryptedSymmetricKey,
          salt: this.salt,
        },
        wasChangedSinceLastSaveCache,
      )
    }
  }

  /**
   * Initialize the library with an encrypted private key and passphrase.
   * @param encryptedPrivateKey - The encrypted private key used for secure operations.
   * @param encryptedSymmetricKey - The encrypted symmetric key used for secure operations.
   * @param passphrase - The passphrase to decrypt the private key.
   * @returns A promise that resolves when initialization is complete.
   * @throws {InitializationError} If initialization fails due to technical issues.
   * @throws {AuthenticationError} If the provided passphrase is incorrect.
   */
  async init(
    encryptedPrivateKey: EncryptedPrivateKey,
    encryptedSymmetricKey: EncryptedSymmetricKey,
    salt: Salt,
    passphrase: Passphrase,
  ): Promise<void> {
    const { privateKey, symmetricKey } = await this.cryptolib.decryptKeys(
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      passphrase,
    )
    this.privateKey = privateKey
    this.symmetricKey = symmetricKey
    this.encryptedPrivateKey = encryptedPrivateKey
    this.encryptedSymmetricKey = encryptedSymmetricKey
    this.salt = salt
    this.wasChangedSinceLastSave = {
      lockedRepresentation: true,
      encryptedPrivateKey: true,
      encryptedSymmetricKey: true,
      salt: true,
    }
  }

  /**
   * Get a locked representation of the library's current state.
   * This can be used for secure storage or transmission of the library's data.
   * @returns A promise that resolves with a string representation of the locked state.
   */
  async getLockedRepresentation(): Promise<string> {
    if (!this.symmetricKey) {
      throw new InitializationError('PublicKey missing')
    }
    return await this.cryptolib.encryptSymmetric(
      this.symmetricKey,
      JSON.stringify(this.vault),
    )
  }

  /**
   * Load the library state from a previously locked representation.
   * @param lockedRepresentation - The string representation of the locked state.
   * @returns A promise that resolves when loading is complete.
   * @throws {InitializationError} If loading fails due to invalid or corrupted data.
   */
  async loadFromLockedRepresentation(
    lockedRepresentation: string,
  ): Promise<void> {
    if (!this.symmetricKey) {
      throw new InitializationError('PrivateKey missing')
    }
    this.vault = JSON.parse(
      await this.cryptolib.decryptSymmetric(
        this.symmetricKey,
        lockedRepresentation,
      ),
    ) as Entry[]
    this.wasChangedSinceLastSave.lockedRepresentation = true
  }

  /**
   * Retrieve metadata for a specific entry.
   * @param entryId - The unique identifier of the entry.
   * @returns The entry's metadata.
   * @throws {EntryNotFoundError} If no entry exists with the given ID.
   */
  getEntryMeta(entryId: EntryId): EntryMeta {
    const entry = this.vault.find((e) => e.id === entryId)
    if (!entry) throw new EntryNotFoundError('Entry not found')
    return exportMetaEntry(entry)
  }

  /**
   * Search for entries matching the provided query.
   * @param query - The search query string.
   * @returns An array of matching entry IDs.
   */
  searchEntries(query: string): EntryId[] {
    const lowercaseQuery = query.toLowerCase()
    return this.vault
      .filter(
        (entry) =>
          entry.name.toLowerCase().includes(lowercaseQuery) ||
          entry.issuer.toLowerCase().includes(lowercaseQuery),
      )
      .map((entry) => entry.id)
  }

  /**
   * Search for entries matching the provided query.
   * @param query - The search query string.
   * @returns An array of matching entry metas.
   */
  searchEntriesMetas(query: string): EntryMeta[] {
    const lowercaseQuery = query.toLowerCase()
    return this.vault
      .filter(
        (entry) =>
          entry.name.toLowerCase().includes(lowercaseQuery) ||
          entry.issuer.toLowerCase().includes(lowercaseQuery),
      )
      .map((entry) => exportMetaEntry(entry))
  }

  /**
   * Retrieve a list of all entry IDs in the library.
   * @returns An array of all entry IDs.
   */
  listEntries(): EntryId[] {
    return this.vault.map((entry) => entry.id)
  }

  /**
   * Retrieve a list of all entry metas in the library.
   * @returns An array of all entry metas.
   */
  listEntriesMetas(): EntryMeta[] {
    return this.vault.map((entry) => exportMetaEntry(entry))
  }

  /**
   * Generate a time-based one-time password (TOTP) for a specific entry.
   * @param id - The unique identifier of the entry.
   * @param timestamp - Optional timestamp to use for token generation (default is current time).
   * @returns An object containing the token and between which timestamps it is valid
   * @throws {EntryNotFoundError} If no entry exists with the given ID.
   * @throws {TokenGenerationError} If token generation fails due to invalid entry data or technical issues.
   */
  generateTokenForEntry(
    id: EntryId,
    timestamp?: number,
  ): { validFrom: number; validTill: number; otp: string } {
    const entry = this.vault.find((e) => e.id === id)
    if (!entry || entry.type !== 'TOTP') {
      throw new EntryNotFoundError('TOTP entry not found')
    }

    const { secret, period, algorithm, digits } = entry.payload

    if (!SUPPORTED_ALGORITHMS.includes(algorithm as SupportedAlgorithmsType)) {
      throw new TokenGenerationError(`Algorithm ${algorithm} is not supported`)
    }

    const totpOptions = {
      digits,
      period,
      algorithm: algorithm as SupportedAlgorithmsType,
      timestamp: timestamp ?? Date.now(),
    }

    const { otp, expires } = TOTP.generate(secret, totpOptions)
    return { otp, validFrom: expires - period * 1000, validTill: expires }
  }

  /**
   * Add a new entry to the library.
   * @param entry - The entry data to add (without an ID, as it will be generated).
   * @returns A promise that resolves to the newly generated EntryId.
   * @throws {InvalidInputError} If the provided entry data is invalid or incomplete.
   */
  async addEntry(entry: NewEntry): Promise<EntryId> {
    const newId = genUuidV4() as EntryId
    const newEntry: Entry = {
      ...entry,
      id: newId,
      order: entry.order ?? 0,
      addedAt: Date.now(),
      updatedAt: null,
    }
    this.vault.push(newEntry)

    this.wasChangedSinceLastSave.lockedRepresentation = true

    await this.save()

    return newId
  }

  /**
   * Delete an existing entry from the library.
   * @param entryId - The unique identifier of the entry to delete.
   * @throws {EntryNotFoundError} If no entry exists with the given ID.
   */
  async deleteEntry(entryId: EntryId): Promise<void> {
    const index = this.vault.findIndex((e) => e.id === entryId)
    if (index === -1) throw new EntryNotFoundError('Entry not found')
    this.vault.splice(index, 1)

    this.wasChangedSinceLastSave.lockedRepresentation = true
    await this.save()
  }

  /**
   * Update an existing entry in the library.
   * @param id - The unique identifier of the entry to update.
   * @param updates - An object containing the fields to update and their new values.
   * @returns A promise that resolves to the updated entry's metadata.
   * @throws {EntryNotFoundError} If no entry exists with the given ID.
   * @throws {InvalidInputError} If the update data is invalid or would result in an invalid entry.
   */
  async updateEntry(
    id: EntryId,
    updates: Partial<Omit<Entry, 'id'>>,
  ): Promise<EntryMeta> {
    const index = this.vault.findIndex((e) => e.id === id)
    if (index === -1) throw new EntryNotFoundError('Entry not found')

    this.vault[index] = { ...this.vault[index], ...updates, id }

    this.wasChangedSinceLastSave.lockedRepresentation = true
    await this.save()

    return this.getEntryMeta(id)
  }

  /**
   * Validate the provided passphrase against the current library passphrase.
   * @param passphrase - The passphrase to validate.
   * @returns A promise that resolves with a boolean indicating whether the passphrase is valid.
   */
  async validatePassphrase(
    salt: Salt,
    passphrase: Passphrase,
  ): Promise<boolean> {
    if (!this.encryptedPrivateKey)
      throw new InitializationError('EncryptedPrivateKey missing')
    if (!this.encryptedSymmetricKey)
      throw new InitializationError('EncryptedSymmetricKey missing')
    try {
      await this.cryptolib.decryptKeys(
        this.encryptedPrivateKey,
        this.encryptedSymmetricKey,
        salt,
        passphrase,
      )
      return true
    } catch {
      return false
    }
  }

  /**
   * Change the library's passphrase.
   * @param oldPassphrase - The current passphrase.
   * @param newPassphrase - The new passphrase to set.
   * @returns A promise that resolves when the passphrase change is complete.
   * @throws {AuthenticationError} If the provided old passphrase is incorrect.
   */
  async changePassphrase(
    oldPassphrase: Passphrase,
    newPassphrase: Passphrase,
  ): Promise<void> {
    if (!this.privateKey) throw new InitializationError('PrivateKey missing')
    if (!this.symmetricKey)
      throw new InitializationError('SymmetricKey missing')
    if (!this.salt) throw new InitializationError('Salt missing')

    const isValid = await this.validatePassphrase(this.salt, oldPassphrase)
    if (!isValid) throw new AuthenticationError('Invalid old passphrase')

    const {
      encryptedPrivateKey: newEncryptedPrivateKey,
      encryptedSymmetricKey: newEncryptedSymmetricKey,
    } = await this.cryptolib.encryptKeys(
      this.privateKey,
      this.symmetricKey,
      this.salt,
      newPassphrase,
    )
    this.wasChangedSinceLastSave.encryptedPrivateKey = true
    this.wasChangedSinceLastSave.lockedRepresentation = true
    await this.init(
      newEncryptedPrivateKey,
      newEncryptedSymmetricKey,
      this.salt,
      newPassphrase,
    )
    await this.save()
  }

  /**
   * Export entries in the specified format, optionally encrypted with a password.
   * @param format - The export format ('text' or 'html').
   * @param password - Optional password for encryption.
   * @returns A promise that resolves to the exported data as a string.
   */
  async exportEntries(
    format: 'text' | 'html',
    password?: string,
  ): Promise<string> {
    let exportData: string

    if (format === 'text') {
      exportData = this.generateTextExport()
    } else if (format === 'html') {
      exportData = await this.generateHtmlExport()
    } else {
      throw new Error('Invalid export format')
    }

    if (password) {
      return encryptExport(await this.getOpenPGPLib(), exportData, password)
    }

    return exportData
  }

  private generateTextExport(): string {
    return generateTextExport(this.vault)
  }

  private async generateHtmlExport(): Promise<string> {
    const qrGeneratorLib = await this.getQrGeneratorLib()
    return generateHtmlExport(qrGeneratorLib, this.vault)
  }

  /**
   * Import entries from a text file, optionally decrypt first
   * @param fileContents - The contents of the text file.
   * @param password - Optional password for decryption.
   * @returns A promise that resolves to an array of objects, each containing the line number,
   *          the EntryId or null if it was not a valid entry and the error if there was one.
   */
  async importFromTextFile(
    fileContents: string,
    password?: string,
  ): Promise<{ lineNr: number; entryId: EntryId | null; error: unknown }[]> {
    if (password) {
      const decrypted = await decryptExport(
        await this.getOpenPGPLib(),
        fileContents,
        password,
      )
      return this.importFromTextFile(decrypted)
    }

    const lines = fileContents.trim().split('\n')
    const result = await processImportLines(lines, (uri) =>
      this.importFromUri(uri),
    )

    // call save again to make sure we're not caught in a race condition
    await this.save()

    return result
  }

  /**
   * Import an entry from an OTP URI.
   * @param otpUri - The OTP URI to import
   * @returns A promise that resolves to the newly added EntryId.
   * @throws {Error} If the URI is invalid or contains unsupported OTP type.
   */
  async importFromUri(otpUri: string): Promise<EntryId> {
    const UrlParser = await this.getUrlParserLib()

    const newEntry = parseOtpUri(UrlParser, otpUri.trim())

    return this.addEntry(newEntry)
  }

  /**
   * Import an entry from a QR code image.
   * @param imageInput - The image input
   * @returns A promise that resolves to the newly added EntryId.
   * @throws {InvalidInputError} If the QR code is invalid or doesn't contain a valid OTP URI.
   */
  async importFromQRCode(imageInput: string | File | Buffer): Promise<EntryId> {
    const jsQr = await this.getJsQrLib()
    let imageData: ImageData
    if (typeof window !== 'undefined') {
      // Browser environment
      imageData = await getImageDataBrowser(imageInput as string | File)
    } else {
      // Node.js environment
      const canvasLib = await this.getCanvasLib()
      imageData = await getImageDataNode(canvasLib, imageInput as Buffer)
    }
    const qrCodeResult = jsQr(imageData.data, imageData.width, imageData.height)
    if (!qrCodeResult) {
      throw new Error('Invalid QR code')
    }
    const otpUri = qrCodeResult.data
    return this.importFromUri(otpUri)
  }
}

export const createTwoFaLib = async (
  cryptolib: CryptoLib,
  passphrase: Passphrase,
  saveFunction?: SaveFunction,
) => {
  const { publicKey, encryptedPrivateKey, encryptedSymmetricKey, salt } =
    await cryptolib.createKeys(passphrase)

  const twoFaLib = new TwoFaLib(cryptolib, saveFunction)
  await twoFaLib.init(
    encryptedPrivateKey,
    encryptedSymmetricKey,
    salt,
    passphrase,
  )
  await twoFaLib.save()

  return {
    twoFaLib,
    publicKey,
    encryptedPrivateKey,
    encryptedSymmetricKey,
    salt,
  }
}

export default TwoFaLib
