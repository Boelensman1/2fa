import type { ImageData } from 'canvas'
import type { NonEmptyTuple } from 'type-fest'

import {
  parseOtpUri,
  generateHtmlExport,
  generateTextExport,
  processImportLines,
  encryptExport,
  decryptExport,
} from '../utils/exportImportUtils.mjs'
import {
  getImageDataBrowser,
  getImageDataNode,
} from '../utils/getImageData.mjs'
import { EntryId } from '../interfaces/Entry.mjs'
import type { Passphrase } from '../interfaces/CryptoLib.mjs'

import type TwoFaLibMediator from '../TwoFaLibMediator.mjs'
import { ExportImportError } from '../TwoFALibError.mjs'
import { validatePassphraseStrength } from '../utils/creationUtils.mjs'

/**
 * Manages the export and import of entries in various formats.
 */
class ExportImportManager {
  /**
   * Constructs a new instance of ExportImportManager.
   * @param mediator - The mediator for accessing other components.
   * @param passphraseExtraDict - Additional words to be used for passphrase strength evaluation.
   */
  constructor(
    private readonly mediator: TwoFaLibMediator,
    private readonly passphraseExtraDict: NonEmptyTuple<string>,
  ) {}

  private get libraryLoader() {
    return this.mediator.getComponent('libraryLoader')
  }
  private get vaultDataManager() {
    return this.mediator.getComponent('vaultDataManager')
  }
  private get vaultOperationsManager() {
    return this.mediator.getComponent('vaultOperationsManager')
  }
  private get persistentStorageManager() {
    return this.mediator.getComponent('persistentStorageManager')
  }

  /**
   * Export entries in the specified format, optionally (when a password is provided) encrypted.
   * If the password is not provided, the user be warned about the dangers of exporting clear text.
   * @param format - The export format ('text' or 'html').
   * @param passphrase - Optional password for encryption.
   * @param userWasWarnedAboutExportingClearText - Whether the user was warned about exporting clear text.
   * @returns A promise that resolves to the exported data as a string.
   */
  async exportEntries(
    format: 'text' | 'html',
    passphrase?: string,
    userWasWarnedAboutExportingClearText?: boolean,
  ): Promise<string> {
    let exportData: string

    if (!passphrase && !userWasWarnedAboutExportingClearText) {
      throw new ExportImportError(
        'User was not warned about the dangers of unencrypted exporting',
      )
    }

    if (format === 'text') {
      exportData = this.generateTextExport()
    } else if (format === 'html') {
      exportData = await this.generateHtmlExport()
    } else {
      throw new ExportImportError('Invalid export format')
    }

    if (passphrase) {
      await validatePassphraseStrength(
        this.libraryLoader,
        passphrase as Passphrase,
        this.passphraseExtraDict,
      )
      return encryptExport(
        await this.libraryLoader.getOpenPGPLib(),
        exportData,
        passphrase,
      )
    }

    return exportData
  }

  private generateTextExport(): string {
    return generateTextExport(this.vaultDataManager.getAllEntries())
  }

  private async generateHtmlExport(): Promise<string> {
    const qrGeneratorLib = await this.libraryLoader.getQrGeneratorLib()
    return generateHtmlExport(
      qrGeneratorLib,
      this.vaultDataManager.getAllEntries(),
    )
  }

  /**
   * Import entries from a text file, optionally (when a password is provided) decrypt first
   * @param fileContents - The contents of the text file.
   * @param passphrase - Optional password for decryption.
   * @returns A promise that resolves to an array of objects, each containing the line number,
   *          the EntryId or null if it was not a valid entry and the error if there was one.
   */
  async importFromTextFile(
    fileContents: string,
    passphrase?: string,
  ): Promise<{ lineNr: number; entryId: EntryId | null; error: unknown }[]> {
    if (passphrase) {
      const decrypted = await decryptExport(
        await this.libraryLoader.getOpenPGPLib(),
        fileContents,
        passphrase,
      )
      return this.importFromTextFile(decrypted)
    }

    const lines = fileContents.trim().split('\n')
    const result = await processImportLines(lines, (uri) =>
      this.importFromUri(uri),
    )

    // force save to make sure we're not caught in a race condition
    await this.persistentStorageManager.setChanged(['lockedRepresentation'])

    return result
  }

  /**
   * Import an entry from an OTP URI.
   * @param otpUri - The OTP URI to import
   * @returns A promise that resolves to the newly added EntryId.
   * @throws {ExportImportError} If the URI is invalid or contains unsupported OTP type.
   */
  async importFromUri(otpUri: string): Promise<EntryId> {
    const UrlParser = await this.libraryLoader.getUrlParserLib()

    const newEntry = parseOtpUri(UrlParser, otpUri.trim())

    return this.vaultOperationsManager.addEntry(newEntry)
  }

  /**
   * Import an entry from a QR code image.
   * @param imageInput - The image input
   * @returns A promise that resolves to the newly added EntryId.
   * @throws {InvalidInputExportImportError} If the QR code is invalid or doesn't contain a valid OTP URI.
   */
  async importFromQRCode(
    imageInput: string | File | Uint8Array,
  ): Promise<EntryId> {
    const jsQr = await this.libraryLoader.getJsQrLib()
    let imageData: ImageData
    if (typeof window !== 'undefined') {
      // Browser environment
      imageData = await getImageDataBrowser(imageInput as string | File)
    } else {
      if (imageInput instanceof File) {
        throw new ExportImportError(
          'Imports of type "File" are not supported in the node environment',
        )
      }
      // Node.js environment
      const canvasLib = await this.libraryLoader.getCanvasLib()
      imageData = await getImageDataNode(canvasLib, imageInput)
    }
    const qrCodeResult = jsQr(imageData.data, imageData.width, imageData.height)
    if (!qrCodeResult) {
      throw new ExportImportError('Invalid QR code')
    }
    const otpUri = qrCodeResult.data
    return this.importFromUri(otpUri)
  }
}

export default ExportImportManager
