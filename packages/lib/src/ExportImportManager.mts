import type { ImageData } from 'canvas'

import {
  parseOtpUri,
  generateHtmlExport,
  generateTextExport,
  processImportLines,
  encryptExport,
  decryptExport,
} from './utils/exportImportUtils.mjs'
import { getImageDataBrowser, getImageDataNode } from './utils/getImageData.mjs'
import type LibraryLoader from './LibraryLoader.mjs'
import type TwoFaLib from './TwoFaLib.mjs'
import { EntryId } from './interfaces/Entry.js'
import VaultManager from './VaultManager.js'

class ExportImportManager {
  constructor(
    private libraryLoader: LibraryLoader,
    private twoFaLib: TwoFaLib,
    private vaultManager: VaultManager,
  ) {}

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
      return encryptExport(
        await this.libraryLoader.getOpenPGPLib(),
        exportData,
        password,
      )
    }

    return exportData
  }

  private generateTextExport(): string {
    return generateTextExport(this.vaultManager.__getEntriesForExport())
  }

  private async generateHtmlExport(): Promise<string> {
    const qrGeneratorLib = await this.libraryLoader.getQrGeneratorLib()
    return generateHtmlExport(
      qrGeneratorLib,
      this.vaultManager.__getEntriesForExport(),
    )
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
        await this.libraryLoader.getOpenPGPLib(),
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
    await this.twoFaLib.save()

    return result
  }

  /**
   * Import an entry from an OTP URI.
   * @param otpUri - The OTP URI to import
   * @returns A promise that resolves to the newly added EntryId.
   * @throws {Error} If the URI is invalid or contains unsupported OTP type.
   */
  async importFromUri(otpUri: string): Promise<EntryId> {
    const UrlParser = await this.libraryLoader.getUrlParserLib()

    const newEntry = parseOtpUri(UrlParser, otpUri.trim())

    return this.vaultManager.addEntry(newEntry)
  }

  /**
   * Import an entry from a QR code image.
   * @param imageInput - The image input
   * @returns A promise that resolves to the newly added EntryId.
   * @throws {InvalidInputError} If the QR code is invalid or doesn't contain a valid OTP URI.
   */
  async importFromQRCode(imageInput: string | File | Buffer): Promise<EntryId> {
    const jsQr = await this.libraryLoader.getJsQrLib()
    let imageData: ImageData
    if (typeof window !== 'undefined') {
      // Browser environment
      imageData = await getImageDataBrowser(imageInput as string | File)
    } else {
      // Node.js environment
      const canvasLib = await this.libraryLoader.getCanvasLib()
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

export default ExportImportManager
