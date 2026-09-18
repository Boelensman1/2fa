import { describe, it, expect } from 'vitest'

import { deviceFingerprint } from '../../src/utils/deviceFingerprint.mjs'
import type {
  PublicKey,
  SigningPublicKey,
} from '../../src/interfaces/CryptoLib.mjs'
import type { DeviceId } from '../../src/interfaces/SyncTypes.mjs'

/**
 * Builds a base64 key of exactly the right length: 32 raw bytes.
 * @param fill - The character to repeat, so two keys can be told apart.
 * @returns The base64 key.
 */
const key = (fill: string) => (fill.repeat(43) + '=') as PublicKey

const device = {
  deviceId: 'a5b4e2b0-1f4e-4a4a-9a0e-2d9b5d5a1c11' as DeviceId,
  publicKey: key('A'),
  signingPublicKey: key('B') as string as SigningPublicKey,
}

describe('deviceFingerprint', () => {
  it('is a frozen vector', () => {
    // Pinned rather than merely shape-checked, because the whole value of a
    // fingerprint is that two devices compute the same one from the same keys.
    // A change here is a change every already-compared fingerprint disagrees
    // with, so it has to be a deliberate one.
    // Cross-checked against an independent SHA-256 of the canonical message
    // (`19:favalib:devicefp:v2` + `36:<deviceId>` + `44:<publicKey>` +
    // `44:<signingPublicKey>`), not merely read back from this implementation.
    expect(deviceFingerprint(device)).toBe('F94E-B724-E102-3FB2-514C-1743')
  })

  it('changes when the two keys are swapped', () => {
    // The sealing key and the signing key are both 44 characters of base64 over
    // 32 raw bytes, so nothing about their contents tells them apart -- only
    // their position in the signed message does. A fingerprint that did not
    // notice the swap would not be distinguishing the two roles at all.
    expect(
      deviceFingerprint({
        ...device,
        publicKey: device.signingPublicKey as string as PublicKey,
        signingPublicKey: device.publicKey as string as SigningPublicKey,
      }),
    ).not.toBe(deviceFingerprint(device))
  })

  it('changes when the deviceId changes', () => {
    // Bound to the identity the keys are listed under, so a record that keeps
    // the keys but swaps the id does not keep a fingerprint the user checked.
    expect(
      deviceFingerprint({ ...device, deviceId: 'other' as DeviceId }),
    ).not.toBe(deviceFingerprint(device))
  })
})
