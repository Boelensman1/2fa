import type { ImageData } from 'canvas'

/**
 * Interface for QR code operations
 */
export interface QrCodeLib {
  /**
   * Generates a QR code as a data URL.
   * @param text - The text to encode.
   * @returns A promise that resolves to a data URL string.
   */
  toDataURL(text: string): Promise<string>

  /**
   * Gets ImageData from various input types for QR code processing.
   * @param imageInput - The image input (string URL, File, or Uint8Array).
   * @returns A promise that resolves to ImageData.
   */
  getImageDataFromInput(
    imageInput: string | File | Uint8Array,
  ): Promise<ImageData>
}

export default QrCodeLib
