import { FavaLibError } from '../FavaLibError.mjs'
import LibraryLoader from '../subclasses/LibraryLoader.mjs'

/**
 * Import an entry from a QR code image.
 * @param libraryLoader - An instance of LibraryLoader.
 * @param imageInput - The image containing the QR code
 * @returns A promise that resolves to the qr data.
 * @throws {InvalidInputExportImportError} If the QR code is invalid or doesn't contain a valid OTP URI.
 */
export const getDataFromQRImage = async (
  libraryLoader: LibraryLoader,
  imageInput: string | File | Uint8Array,
) => {
  const jsQr = await libraryLoader.getJsQrLib()
  const qrLib = libraryLoader.getQrGeneratorLib()

  const imageData = await qrLib.getImageDataFromInput(imageInput)
  const qrCodeResult = jsQr(imageData.data, imageData.width, imageData.height)
  if (!qrCodeResult) {
    throw new FavaLibError("Couldn't read QR code data from image")
  }
  return qrCodeResult.data
}
