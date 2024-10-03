import type { ImageData } from 'canvas'

import { getImageDataBrowser, getImageDataNode } from './getImageData.mjs'
import { InitiateAddDeviceFlowResult } from '../interfaces/SyncTypes.js'
import { SyncError } from '../TwoFALibError.mjs'

export const decodeInitiatorData = async (
  initiatorData: InitiateAddDeviceFlowResult | string | Buffer | File,
  jsQr: typeof import('jsqr').default,
  getCanvasLib: () => Promise<typeof import('canvas')>,
): Promise<InitiateAddDeviceFlowResult> => {
  if (
    typeof initiatorData === 'string' ||
    initiatorData instanceof Buffer ||
    initiatorData instanceof File
  ) {
    try {
      let imageData: ImageData

      if (typeof window !== 'undefined') {
        if (initiatorData instanceof Buffer) {
          throw new SyncError(
            'Invalid initiator data type, should be a string or File in browser environment',
          )
        }
        // Browser environment
        imageData = await getImageDataBrowser(initiatorData)
      } else {
        if (!(initiatorData instanceof Buffer)) {
          throw new SyncError(
            'Invalid initiator data type, should be a Buffer in Node.js environment',
          )
        }
        // Node.js environment
        const canvasLib = await getCanvasLib()
        imageData = await getImageDataNode(canvasLib, initiatorData)
      }

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
      throw new SyncError(
        'Failed to decode QR code: ' + (error as Error).message,
      )
    }
  }

  if (!initiatorData || typeof initiatorData !== 'object') {
    throw new SyncError('Invalid initiator data')
  }

  return initiatorData
}

export const toUint8Array = (jsonObj: Record<string, number>) => {
  return new Uint8Array(Object.values(jsonObj))
}

export const jsonToUint8Array = (
  jsonObj: Record<string, Record<string, number>>,
): Record<string, Uint8Array> => {
  return Object.entries(jsonObj).reduce(
    (acc, [key, value]) => ({
      ...acc,
      [key]: toUint8Array(value),
    }),
    {} as Record<string, Uint8Array>,
  )
}
