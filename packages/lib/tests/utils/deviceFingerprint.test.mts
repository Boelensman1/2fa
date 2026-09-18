import { describe, it, expect } from 'vitest'
import { uint8ArrayToBase64 } from 'uint8array-extras'

import { deviceFingerprint } from '../../src/utils/deviceFingerprint.mjs'
import type {
  PublicKey,
  SigningPublicKey,
} from '../../src/interfaces/CryptoLib.mjs'
import type { DeviceId } from '../../src/interfaces/SyncTypes.mjs'
import {
  PUBLIC_KEY_BYTES,
  SIGNING_PUBLIC_KEY_BYTES,
} from '../../src/platformProviders/shared/asymmetric.mjs'

/**
 * Builds a base64 key of exactly the right length for its role.
 * @param bytes - How many raw bytes the role's key has.
 * @param fill - The byte to repeat, so two keys can be told apart.
 * @returns The base64 key.
 */
const key = (bytes: number, fill: number) =>
  uint8ArrayToBase64(new Uint8Array(bytes).fill(fill))

const device = {
  deviceId: 'a5b4e2b0-1f4e-4a4a-9a0e-2d9b5d5a1c11' as DeviceId,
  publicKey: key(PUBLIC_KEY_BYTES, 1) as PublicKey,
  signingPublicKey: key(SIGNING_PUBLIC_KEY_BYTES, 2) as SigningPublicKey,
}

describe('deviceFingerprint', () => {
  it('is a frozen vector', () => {
    // Pinned rather than merely shape-checked, because the whole value of a
    // fingerprint is that two devices compute the same one from the same keys.
    // A change here is a change every already-compared fingerprint disagrees
    // with, so it has to be a deliberate one.
    // Cross-checked against an independent SHA-256 of the canonical message
    // (`19:favalib:devicefp:v2` + `36:<deviceId>` + `1624:<publicKey>` +
    // `2648:<signingPublicKey>`), not merely read back from this
    // implementation. Eight groups rather than six: see FINGERPRINT_BYTES.
    expect(deviceFingerprint(device)).toBe(
      '5579-6908-68C6-5F83-2B84-CB51-C275-47E4',
    )
  })

  it('changes when the two keys are swapped', () => {
    // The two keys differ in length now, but nothing about their CONTENTS
    // tells them apart -- only their position in the digested message does. A
    // fingerprint that did not notice the swap would not be distinguishing the
    // two roles at all.
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
