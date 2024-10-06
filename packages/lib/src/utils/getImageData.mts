import type { ImageData } from 'canvas'
import { isUint8Array } from 'uint8array-extras'

import { TwoFALibError } from '../TwoFALibError.mjs'

export const getImageDataBrowser = (
  input: string | File,
): Promise<ImageData> => {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new TwoFALibError('Could not create canvas context'))
        return
      }
      ctx.drawImage(img, 0, 0)
      resolve(ctx.getImageData(0, 0, img.width, img.height))
    }
    img.onerror = () => reject(new TwoFALibError('Failed to load image'))

    if (typeof input === 'string') {
      // URL or Data URL
      img.src = input
    } else {
      // File object
      const reader = new FileReader()
      reader.onload = (e) => {
        img.src = e.target?.result as string
      }
      reader.onerror = () => reject(new TwoFALibError('Failed to read file'))
      reader.readAsDataURL(input)
    }
  })
}

export const getImageDataNode = async (
  canvasLib: typeof import('canvas'),
  inputImage: Uint8Array | string,
): Promise<ImageData> => {
  const { createCanvas, loadImage } = canvasLib

  // eslint-disable-next-line no-restricted-globals
  const input = isUint8Array(inputImage) ? Buffer.from(inputImage) : inputImage
  const image = await loadImage(input) // canvaslib expects a buffer
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  return ctx.getImageData(0, 0, image.width, image.height)
}
