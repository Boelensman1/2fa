import { describe, expect, it } from 'vitest'
import QRCode from 'qrcode'
import { pairingQr } from '../src/utils/pairingQr.mjs'

describe('terminal pairing QR', () => {
  it('renders the raw JSON expected by QR receivers with a surrounding margin', async () => {
    const json = JSON.stringify({
      pairingVersion: '2.0',
      initiatorDeviceId: 'example',
      timestamp: 123,
      addDevicePassword: 'example-password',
      pass1Result: {},
    })
    const result = await pairingQr(Buffer.from(json).toString('base64url'))
    const expected = QRCode.create(json)
    // Remove renderer colour sequences, then expand each half-block character
    // back into the two QR pixels it represents.
    const rows = result.text
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*m/g, '')
      .trimEnd()
      .split('\n')
    expect(result.columns).toBe(expected.modules.size + 2)
    for (let y = 0; y < expected.modules.size; y++) {
      for (let x = 0; x < expected.modules.size; x++) {
        const character = rows[Math.floor((y + 1) / 2)][x + 1]
        const dark =
          (y + 1) % 2 === 0
            ? '▀█'.includes(character)
            : '▄█'.includes(character)
        expect(dark).toBe(Boolean(expected.modules.get(y, x)))
      }
    }
  })
})
