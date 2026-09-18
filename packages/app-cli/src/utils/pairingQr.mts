import QRCode from 'qrcode'

/**
 * Renders the JSON payload expected by Fava's QR receiver, not its base64 text encoding.
 * @param connectionString - The text returned by initiateAddDeviceFlow.
 * @returns Terminal rendering and its required column count.
 */
export const pairingQr = async (connectionString: string) => {
  const payload = Buffer.from(connectionString, 'base64url').toString('utf8')
  return {
    text: await QRCode.toString(payload, { type: 'terminal', small: true }),
    columns: QRCode.create(payload).modules.size + 2,
  }
}
