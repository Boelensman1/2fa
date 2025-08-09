import type { ImageData } from 'canvas'
import type { QrCodeLib } from '../../interfaces/QrCodeLib.mjs'
import { FavaLibError } from '../../FavaLibError.mjs'
import { isUint8Array } from 'uint8array-extras'

/**
 * Gets the ImageData from an image, for Node.js environments.
 * This ImageData is then further processed to get QR codes.
 * @param inputImage - The image to get the ImageData from.
 * @returns A promise that resolves to the ImageData.
 */
export const getImageDataFromInput = async (
  inputImage: string | File | Uint8Array,
): Promise<ImageData> => {
  if (inputImage instanceof File) {
    throw new FavaLibError(
      'Getting data from QR where image type is "File" is not supported in the node environment',
    )
  }

  const canvasLib = await import('canvas')
  const { createCanvas, loadImage } = canvasLib

  // eslint-disable-next-line no-restricted-globals
  const input = isUint8Array(inputImage) ? Buffer.from(inputImage) : inputImage
  const image = await loadImage(input) // canvaslib expects a buffer
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  return ctx.getImageData(0, 0, image.width, image.height)
}

/**
 * Node.js implementation of QR code library wrapper
 */
export class NodeQrCodeLib implements QrCodeLib {
  private qrCodeModule: typeof import('qrcode') | null = null

  /**
   * Gets the QR code module, loading it if necessary
   * @returns Promise that resolves to the QR code module
   */
  private async getQrCodeModule() {
    if (!this.qrCodeModule) {
      const qrcode = await import('qrcode')
      this.qrCodeModule = qrcode.default
    }
    return this.qrCodeModule
  }

  /**
   * @inheritdoc
   */
  async toDataURL(text: string): Promise<string> {
    const qrCode = await this.getQrCodeModule()
    return qrCode.toDataURL(text)
  }

  /**
   * @inheritdoc
   */
  async getImageDataFromInput(
    imageInput: string | File | Uint8Array,
  ): Promise<ImageData> {
    return getImageDataFromInput(imageInput)
  }
}
