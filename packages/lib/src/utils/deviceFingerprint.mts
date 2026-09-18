import { sha256 } from '@noble/hashes/sha2.js'
import { stringToUint8Array, uint8ArrayToHex } from 'uint8array-extras'

import { buildDeviceFingerprintMessage } from './canonical.mjs'
import type { DeviceFingerprint } from '../interfaces/BrandedTypes.mjs'
import type { SyncDevice } from '../interfaces/SyncTypes.mjs'

/**
 * How many bytes of the digest a fingerprint shows.
 *
 * The adversary this defends against is one grinding their own keypair until it
 * renders as a fingerprint the user is reading off another screen. A collision
 * only has to fool a person doing a visual comparison, so the usual birthday
 * bound is the wrong model: what matters is the cost of a second preimage on a
 * specific target.
 *
 * 16 bytes -- 128 bits -- because that grind is exactly the search a quantum
 * computer speeds up. Grover takes a second preimage from 2^n to roughly 2^(n/2)
 * work, which would have left the 12 bytes this used to be at about 2^48: not a
 * number to hand an attacker who only has to fool a human comparison once. At 16
 * bytes the same argument lands at 2^64.
 *
 * The cost is eight groups to read instead of six. Longer would be safer still
 * and less likely to be compared at all, which is the real limit here.
 */
const FINGERPRINT_BYTES = 16

/** How many hex characters go between the dashes. */
const FINGERPRINT_GROUP = 4

/**
 * Derives the fingerprint a user compares two devices by.
 *
 * Synchronous, and deliberately outside `CryptoLib`. This is a digest of values
 * that are public by definition, with no key and no secret input, so the
 * provider abstraction would buy nothing but an await on every call -- and
 * `getSyncDevices` is called from render paths. `@noble/hashes` is already a
 * direct dependency and already the hash both platform providers agree through
 * in `platformProviders/shared/curves.mts`, so there is one implementation
 * here rather than two to keep in step.
 * @param device - The device to fingerprint.
 * @returns The fingerprint, as uppercase hex in dash-separated groups.
 */
export const deviceFingerprint = (
  device: Pick<SyncDevice, 'deviceId' | 'publicKey' | 'signingPublicKey'>,
): DeviceFingerprint => {
  // `@noble/hashes` 2.x takes bytes, not strings, and `encodeFields` prefixes
  // each field with its UTF-8 byte length -- so UTF-8 is the encoding the
  // length prefixes already describe, not a choice being made here.
  const digest = sha256(
    stringToUint8Array(
      buildDeviceFingerprintMessage(
        device.deviceId,
        device.publicKey,
        device.signingPublicKey,
      ),
    ),
  )
  const hex = uint8ArrayToHex(digest.slice(0, FINGERPRINT_BYTES)).toUpperCase()
  return (hex.match(new RegExp(`.{1,${FINGERPRINT_GROUP}}`, 'g')) ?? []).join(
    '-',
  ) as DeviceFingerprint
}
