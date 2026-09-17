import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import {
  base64ToUint8Array,
  stringToUint8Array,
  uint8ArrayToBase64,
} from 'uint8array-extras'

import type { ServerSecret } from '../interfaces/BrandedTypes.mjs'
import { buildConnectAuthMessage } from './canonical.mjs'

/**
 * The connection gate on the sync server: a static secret, shared by every
 * device of a deployment, proved rather than transmitted.
 *
 * ## Why this module is shared rather than implemented twice
 *
 * The same reason `platformProviders/shared/curves.mts` gives. The RSA layer
 * used to be written once for the browser and once for node, and the two agreed
 * only for as long as every parameter matched on both sides -- which is how the
 * OAEP MGF1 split got in. Here the two sides are not two providers but two
 * PACKAGES: `favalib` computes the proof and `favaserver` checks it. A server
 * with its own copy of this arithmetic is the same hazard one repository
 * boundary further out, and it would fail as "everyone is suddenly
 * unauthorized" rather than as a test.
 *
 * So this is a pure leaf. It imports `@noble/hashes`, `uint8array-extras` and
 * `canonical.mjs`, which imports nothing at all, and it is reachable from the
 * server as the `favalib/protocol/connectAuth` subpath without dragging a
 * platform provider -- or canvas, or openpgp -- along with it.
 *
 * ## What it is NOT
 *
 * It is not device authentication, and nothing here should be read as if it
 * were. Every device holds the same secret, so a valid proof says "someone who
 * may use this deployment" and stops there; the `deviceId` a socket claims
 * immediately afterwards is as unverified as it ever was. See
 * key-hierarchy-review/16-server-authentication.md, which this NARROWS and does
 * not close.
 */

/**
 * The shortest secret the server will accept, in characters.
 *
 * Enforced where the value enters the system -- the server's config schema --
 * rather than here, because this module sees a secret that is already in use
 * and refusing it at that point would only turn a weak deployment into a broken
 * one. Thirty-two characters is what `openssl rand -base64 32` produces once
 * padding is counted, which is the documented way to make one.
 */
export const SERVER_SECRET_MIN_LENGTH = 32

/**
 * The length of a proof in raw bytes: HMAC-SHA256, so one SHA-256 digest.
 */
const PROOF_BYTES = 32

/**
 * Computes the HMAC a client sends in answer to a server's challenge.
 * @param secret - The shared secret, used as its UTF-8 bytes.
 * @param nonce - The server's per-socket challenge, exactly as received.
 * @returns The base64 encoded proof.
 */
export const createConnectProof = (
  secret: ServerSecret,
  nonce: string,
): string =>
  uint8ArrayToBase64(
    hmac(
      sha256,
      stringToUint8Array(secret),
      stringToUint8Array(buildConnectAuthMessage(nonce)),
    ),
  )

/**
 * Compares two byte strings without branching on their contents.
 *
 * The lengths are compared first and in the clear, which is safe here because
 * the expected length is the constant above: an attacker learns the size of a
 * SHA-256 digest, which they already knew.
 * @param a - The first value.
 * @param b - The second value.
 * @returns Whether the two are identical.
 */
const equalInConstantTime = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) {
    return false
  }
  let difference = 0
  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i]
  }
  return difference === 0
}

/**
 * Checks a client's proof against the secret this server was configured with.
 *
 * Returns false for every failure -- a wrong secret, a truncated proof, one
 * that is not base64 at all -- and never throws, for the same reason
 * `CryptoLib.verify` does not: the caller is deciding whether to drop something
 * that arrived from the network, and an error that named the cause would tell
 * whoever is probing which half they got wrong.
 *
 * Freshness is not checked here and cannot be: this function is handed a nonce,
 * not a record of which nonces are still live. Issuing each one for a single
 * socket and accepting it once is the caller's job -- `ConnectionAuthManager`
 * in the server.
 * @param secret - The shared secret this server was configured with.
 * @param nonce - The nonce this socket was challenged with.
 * @param proof - The base64 proof the client sent, which may be anything.
 * @returns Whether the proof is the one this nonce and secret produce.
 */
export const verifyConnectProof = (
  secret: ServerSecret,
  nonce: string,
  proof: string,
): boolean => {
  let received: Uint8Array
  try {
    received = base64ToUint8Array(proof)
  } catch {
    return false
  }
  if (received.length !== PROOF_BYTES) {
    return false
  }

  return equalInConstantTime(
    received,
    base64ToUint8Array(createConnectProof(secret, nonce)),
  )
}
