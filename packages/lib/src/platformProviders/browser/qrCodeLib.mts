import type { ImageData } from 'canvas'
import type { QrCodeLib } from '../../interfaces/QrCodeLib.mjs'
import { FavaLibError } from '../../FavaLibError.mjs'

/**
 * Gets the ImageData from an image, for browser environments.
 * This ImageData is then further processed to get QR codes.
 * @param input - The image to get the ImageData from.
 * @returns A promise that resolves to the ImageData.
 */
export const getImageDataFromInput = (
  input: string | File | Uint8Array,
): Promise<ImageData> => {
  return new Promise((resolve, reject) => {
    if (input instanceof Uint8Array) {
      reject(
        new FavaLibError(
          'Uint8Array input not supported in browser environment',
        ),
      )
      return
    }

    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new FavaLibError('Could not create canvas context'))
        return
      }
      ctx.drawImage(img, 0, 0)
      resolve(ctx.getImageData(0, 0, img.width, img.height))
    }
    img.onerror = () => reject(new FavaLibError('Failed to load image'))

    if (typeof input === 'string') {
      // URL or Data URL
      img.src = input
    } else {
      // File object
      const reader = new FileReader()
      reader.onload = (e) => {
        img.src = e.target?.result as string
      }
      reader.onerror = () => reject(new FavaLibError('Failed to read file'))
      reader.readAsDataURL(input)
    }
  })
}

/**
 * Browser implementation of QR code library wrapper
 */
export class BrowserQrCodeLib implements QrCodeLib {
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

  getImageDataFromInput = getImageDataFromInput
}
