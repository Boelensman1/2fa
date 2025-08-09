import { base64ToString } from 'uint8array-extras'

import { InitiateAddDeviceFlowResult } from '../interfaces/SyncTypes.mjs'
import { SyncError } from '../FavaLibError.mjs'
import type { QrCodeLib } from '../interfaces/QrCodeLib.mjs'

/**
 * Decodes the initiator data from a string or QR code.
 * @param initiatorData - The initiator data to decode.
 * @param initiatorDataType The type of the initiatorData, determines how it should be decoded
 * @param jsQr - The QR code decoder.
 * @param qrCodeLib - The extended QR code library with platform-specific image processing.
 * @returns A promise that resolves to the decoded initiator data.
 */
export const decodeInitiatorData = async (
  initiatorData: string | Uint8Array | File,
  initiatorDataType: 'text' | 'qr',
  jsQr: typeof import('jsqr').default,
  qrCodeLib: QrCodeLib,
): Promise<InitiateAddDeviceFlowResult> => {
  if (initiatorDataType === 'qr') {
    try {
      const imageData = await qrCodeLib.getImageDataFromInput(initiatorData)
      const qrCodeResult = jsQr(
        imageData.data,
        imageData.width,
        imageData.height,
      )
      if (!qrCodeResult) {
        throw new SyncError('Invalid QR code')
      }
      return JSON.parse(qrCodeResult.data) as InitiateAddDeviceFlowResult
    } catch (error) {
      // eslint-disable-next-line no-restricted-globals
      if (error instanceof Error) {
        throw new SyncError('Failed to decode QR code: ' + error.message)
      }
      throw new SyncError('Failed to decode QR code: unknown error.')
    }
  } else {
    if (typeof initiatorData !== 'string') {
      throw new SyncError('Invalid initiator data')
    }
    const parsedInitiatorData = JSON.parse(
      base64ToString(initiatorData),
    ) as InitiateAddDeviceFlowResult

    if (!parsedInitiatorData || typeof parsedInitiatorData !== 'object') {
      throw new SyncError('Invalid initiator data')
    }

    return parsedInitiatorData
  }
}

/**
 * Converts a JSONified Uint8Array to a Uint8Array.
 * A JSONified Uint8Array is the output of JSON.stringify on a Uint8Array.
 * Example:
 * JSON.stringify(new Uint8Array([123, 456])) looks like this:
 * '{"0":123,"1":200}'
 * @param jsonObj - The JSONified Uint8Array to convert.
 * @returns A Uint8Array containing the values of the JSONified Uint8Array.
 */
export const jsonifiedUint8ArraytoUint8Array = (
  jsonObj: Record<string, number>,
) => {
  return new Uint8Array(Object.values(jsonObj))
}

/**
 * Converts a JSON object to a record of Uint8Arrays.
 * @param jsonObj - The JSON object to convert.
 * @returns A record of Uint8Arrays.
 */
export const jsonToUint8Array = (
  jsonObj: Record<string, Record<string, number>>,
): Record<string, Uint8Array> => {
  return Object.entries(jsonObj).reduce(
    (acc, [key, value]) => ({
      ...acc,
      [key]: jsonifiedUint8ArraytoUint8Array(value),
    }),
    {} as Record<string, Uint8Array>,
  )
}
