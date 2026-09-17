import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { base64ToUint8Array, uint8ArrayToBase64 } from 'uint8array-extras'

import { CryptoError } from '../../FavaLibError.mjs'
import type CryptoLib from '../../interfaces/CryptoLib.mjs'
import type {
  DeviceSecretKeys,
  Encrypted,
  PrivateKey,
  PublicKey,
  SecretKeysString,
  Signature,
  SigningPublicKey,
  SigningSecretKey,
  SymmetricKey,
} from '../../interfaces/CryptoLib.mjs'
import { encodeFields } from '../../utils/canonical.mjs'

/**
 * The asymmetric layer, shared verbatim by both platform providers.
 *
 * Unlike every other primitive in the providers, this one is NOT implemented
 * twice. The RSA layer it replaces was: node-forge in the browser, OpenSSL in
 * node, agreeing only as long as every padding parameter was set identically on
 * both sides -- which is how the OAEP MGF1-SHA-1/SHA-256 split got in, and why
 * tests/CryptoProviders has to pin it. Ed25519 and X25519 have no parameters to
 * disagree about, and `@noble/curves` runs unchanged in both environments (it is
 * already in the tree: jpake-ts derives the pairing key with it), so the two
 * providers share one implementation and the seam disappears.
 *
 * The symmetric half stays split -- WebCrypto in the browser, node:crypto in
 * node -- because both environments have a fast native AES-GCM and neither
 * needs a library for it.
 */

/** Every key here is 32 bytes: X25519 and Ed25519 both, secret and public. */
const KEY_BYTES = 32

/**
 * Marks a storage version 2 envelope, sealed or symmetric.
 *
 * A seal is the ordinary v2 envelope with the ephemeral public key spliced in
 * behind the version: `v2:<ephemeral public key>:<nonce>:<ciphertext||tag>`.
 * It keeps the version first, where the symmetric envelope has it, and it is
 * what makes a v1 peer's bare-base64 RSA blob fail here as a format mismatch
 * rather than as arithmetic. The wire carries no version of its own -- a
 * command's `version` field is inside the ciphertext -- so this prefix is the
 * only thing that can say what these bytes are.
 */
const V2_ENVELOPE_PREFIX = 'v2'

/**
 * The AAD of the inner symmetric envelope of a seal.
 *
 * A domain separator and nothing more: everything else a seal needs bound --
 * the ephemeral key, the recipient -- is already in the HKDF info, where the
 * recipient recomputes it rather than reading it off the message.
 */
const SEAL_AAD = encodeFields(['favalib:seal:v2'])

/** An Ed25519 signature, R || S. */
const SIGNATURE_BYTES = 64

/**
 * Decodes a base64 key and checks its length before it reaches a curve.
 *
 * The length check is the whole point: a truncated or swapped-role key would
 * otherwise reach noble, which throws its own error mentioning the primitive
 * and the offending length. That is a decrypt oracle by another name, so
 * everything here fails with the same CryptoError the providers use.
 * @param value - The base64 encoded key.
 * @param what - What the key is, for the error message. Never includes the value.
 * @param expectedBytes - The exact length the decoded key must have.
 * @returns The decoded key bytes.
 * @throws {CryptoError} If the value is not base64 of exactly that length.
 */
const decodeKey = (
  value: string,
  what: string,
  expectedBytes = KEY_BYTES,
): Uint8Array => {
  let bytes: Uint8Array
  try {
    bytes = base64ToUint8Array(value)
  } catch {
    throw new CryptoError(`Malformed ${what}`)
  }
  if (bytes.length !== expectedBytes) {
    throw new CryptoError(`Malformed ${what}`)
  }
  return bytes
}

/**
 * Creates the device's signing keypair.
 * @returns The Ed25519 keypair, base64 encoded.
 */
export const createSigningKeyPair = (): {
  signingSecretKey: SigningSecretKey
  signingPublicKey: SigningPublicKey
} => {
  const { secretKey, publicKey } = ed25519.keygen()
  return {
    signingSecretKey: uint8ArrayToBase64(secretKey) as SigningSecretKey,
    signingPublicKey: uint8ArrayToBase64(publicKey) as SigningPublicKey,
  }
}

/**
 * Creates a X25519 keypair -- the device's own, or an ephemeral one per seal.
 * @returns The keypair, base64 encoded.
 */
export const createEncryptionKeyPair = (): {
  privateKey: PrivateKey
  publicKey: PublicKey
} => {
  const { secretKey, publicKey } = x25519.keygen()
  return {
    privateKey: uint8ArrayToBase64(secretKey) as PrivateKey,
    publicKey: uint8ArrayToBase64(publicKey) as PublicKey,
  }
}

/**
 * Recovers the signing public key from the secret key.
 *
 * Public keys are derived on unlock rather than stored, exactly as the RSA
 * layer derived them from the private key: a stored copy is one more field that
 * can disagree with the key material it claims to describe.
 * @param signingSecretKey - The device's Ed25519 secret key.
 * @returns The matching public key.
 * @throws {CryptoError} If the secret key is malformed.
 */
export const signingPublicKeyFromSecret = (
  signingSecretKey: SigningSecretKey,
): SigningPublicKey =>
  uint8ArrayToBase64(
    ed25519.getPublicKey(decodeKey(signingSecretKey, 'signing secret key')),
  ) as SigningPublicKey

/**
 * Recovers the encryption public key from the secret key.
 * @param privateKey - The device's X25519 secret key.
 * @returns The matching public key.
 * @throws {CryptoError} If the secret key is malformed.
 */
export const encryptionPublicKeyFromSecret = (
  privateKey: PrivateKey,
): PublicKey =>
  uint8ArrayToBase64(
    x25519.getPublicKey(decodeKey(privateKey, 'encryption secret key')),
  ) as PublicKey

/**
 * Signs a message with the device's signing key.
 * @param signingSecretKey - The device's Ed25519 secret key.
 * @param message - The canonical message to sign, from canonical.mts.
 * @returns The base64 encoded signature.
 * @throws {CryptoError} If the secret key is malformed.
 */
export const signMessage = (
  signingSecretKey: SigningSecretKey,
  message: string,
): Signature =>
  uint8ArrayToBase64(
    ed25519.sign(
      new TextEncoder().encode(message),
      decodeKey(signingSecretKey, 'signing secret key'),
    ),
  ) as Signature

/**
 * Verifies a signature against a public key.
 *
 * Returns false for every failure, malformed input included, and never throws:
 * its callers are deciding whether to drop a message that arrived from the
 * network, and a thrown error there would separate "bad signature" from "bad
 * base64" for whoever is probing.
 * @param signingPublicKey - The claimed sender's Ed25519 public key.
 * @param message - The canonical message the signature should cover.
 * @param signature - The base64 encoded signature.
 * @returns Whether the signature is valid.
 */
export const verifyMessage = (
  signingPublicKey: SigningPublicKey,
  message: string,
  signature: Signature,
): boolean => {
  try {
    return ed25519.verify(
      decodeKey(signature, 'signature', SIGNATURE_BYTES),
      new TextEncoder().encode(message),
      decodeKey(signingPublicKey, 'signing public key'),
    )
  } catch {
    return false
  }
}

/**
 * Derives the key one sealed message is encrypted under.
 *
 * X25519 between the two keys, then HKDF-SHA256 over the shared secret. Both
 * public keys go into the HKDF info, length-prefixed by the same encoder the
 * AADs use: binding them is what stops one shared secret being reused to mean
 * something else, and it is why `encrypt` needs no separate AAD parameter.
 * @param secretKey - The secret half held by whichever side is deriving.
 * @param otherPublicKey - The public half it agrees with.
 * @param ephemeralPublicKey - The per-message public key, first in the info.
 * @param recipientPublicKey - The long-term public key, second in the info.
 * @returns The derived AES-256 key, base64 encoded.
 * @throws {CryptoError} If either key is malformed.
 */
const deriveSealKey = (
  secretKey: PrivateKey,
  otherPublicKey: PublicKey,
  ephemeralPublicKey: PublicKey,
  recipientPublicKey: PublicKey,
): SymmetricKey => {
  const sharedSecret = x25519.getSharedSecret(
    decodeKey(secretKey, 'encryption secret key'),
    decodeKey(otherPublicKey, 'encryption public key'),
  )
  const info = new TextEncoder().encode(
    encodeFields(['favalib:seal:v2', ephemeralPublicKey, recipientPublicKey]),
  )
  return uint8ArrayToBase64(
    hkdf(sha256, sharedSecret, new Uint8Array(0), info, 32),
  ) as SymmetricKey
}

/**
 * Derives the seal key on the sending side, from a keypair that exists for
 * this one message.
 *
 * The ephemeral half is what buys the forward secrecy the RSA wrap never had:
 * recovering a device's long-term secret key does not decrypt traffic captured
 * earlier, because the other half of every past exchange was discarded as soon
 * as it was used.
 * @param ephemeralKeyPair - The per-message keypair, from createEncryptionKeyPair.
 * @param ephemeralKeyPair.privateKey - Its secret half, discarded after this call.
 * @param ephemeralKeyPair.publicKey - Its public half, sent with the ciphertext.
 * @param recipientPublicKey - The recipient's long-term X25519 public key.
 * @returns The derived AES-256 key, base64 encoded.
 * @throws {CryptoError} If either key is malformed.
 */
export const deriveSealKeyForSender = (
  ephemeralKeyPair: { privateKey: PrivateKey; publicKey: PublicKey },
  recipientPublicKey: PublicKey,
): SymmetricKey =>
  deriveSealKey(
    ephemeralKeyPair.privateKey,
    recipientPublicKey,
    ephemeralKeyPair.publicKey,
    recipientPublicKey,
  )

/**
 * Derives the same key on the receiving side.
 *
 * The recipient's own public key is recomputed from its secret key rather than
 * taken from the message: the info has to describe who the sender sealed TO,
 * and a value the sender chose could name someone else.
 * @param privateKey - This device's long-term X25519 secret key.
 * @param ephemeralPublicKey - The per-message public key from the ciphertext.
 * @returns The derived AES-256 key, base64 encoded.
 * @throws {CryptoError} If either key is malformed.
 */
export const deriveSealKeyForRecipient = (
  privateKey: PrivateKey,
  ephemeralPublicKey: PublicKey,
): SymmetricKey =>
  deriveSealKey(
    privateKey,
    ephemeralPublicKey,
    ephemeralPublicKey,
    encryptionPublicKeyFromSecret(privateKey),
  )

/**
 * Seals a message to a public key, using the provider's own AES-GCM.
 *
 * The asymmetric half is shared; the symmetric half is the caller's, which is
 * why this takes the provider rather than living inside one. Both providers
 * therefore produce byte-compatible seals without either of them owning the
 * curve code.
 * @param crypto - The provider whose encryptSymmetric to use.
 * @param publicKey - The recipient's X25519 public key.
 * @param plainText - The text to seal.
 * @returns A promise resolving to the sealed text.
 * @throws {CryptoError} If the public key is malformed.
 */
export const sealTo = async <T extends string>(
  crypto: Pick<CryptoLib, 'encryptSymmetric'>,
  publicKey: PublicKey,
  plainText: T,
): Promise<Encrypted<T>> => {
  const ephemeral = createEncryptionKeyPair()
  const key = deriveSealKeyForSender(ephemeral, publicKey)
  const [prefix, nonce, cipherText] = (
    await crypto.encryptSymmetric(key, plainText, SEAL_AAD)
  ).split(':')

  return [prefix, ephemeral.publicKey, nonce, cipherText].join(
    ':',
  ) as Encrypted<T>
}

/**
 * Opens a message sealed to this device.
 *
 * Every failure is the same CryptoError with the same message -- a malformed
 * ephemeral key, a wrong recipient, a tampered tag, a v1 blob. Which one it was
 * is exactly what an attacker probing the sync path wants told.
 * @param crypto - The provider whose decryptSymmetric to use.
 * @param privateKey - This device's X25519 secret key.
 * @param encryptedText - The sealed text.
 * @returns A promise resolving to the decrypted text.
 * @throws {CryptoError} If the seal cannot be opened, for any reason.
 */
export const openSeal = async <T extends string>(
  crypto: Pick<CryptoLib, 'decryptSymmetric'>,
  privateKey: PrivateKey,
  encryptedText: Encrypted<T>,
): Promise<T> => {
  const parts = encryptedText.split(':')
  if (parts.length !== 4 || parts[0] !== V2_ENVELOPE_PREFIX) {
    throw new CryptoError('Could not decrypt data')
  }
  const [prefix, ephemeralPublicKey, nonce, cipherText] = parts

  let key: SymmetricKey
  try {
    key = deriveSealKeyForRecipient(privateKey, ephemeralPublicKey as PublicKey)
  } catch {
    throw new CryptoError('Could not decrypt data')
  }

  return crypto.decryptSymmetric(
    key,
    [prefix, nonce, cipherText].join(':') as Encrypted<T>,
    SEAL_AAD,
  )
}

/**
 * Serialises a device's secret keys for sealing at rest.
 * @param secretKeys - The two secret keys.
 * @returns The JSON to seal.
 */
export const serialiseSecretKeys = (
  secretKeys: DeviceSecretKeys,
): SecretKeysString =>
  JSON.stringify({
    privateKey: secretKeys.privateKey,
    signingSecretKey: secretKeys.signingSecretKey,
  }) as SecretKeysString

/**
 * Reads a device's secret keys back after their seal has been opened.
 *
 * The seal authenticates these bytes, so this is not a trust boundary -- it is
 * the check that a vault written by a build with a different idea of the shape
 * fails loudly here rather than several calls later, where the error would name
 * a curve instead of a vault.
 * @param serialised - The JSON from inside the seal.
 * @returns The two secret keys.
 * @throws {CryptoError} If the JSON is not a pair of keys.
 */
export const parseSecretKeys = (serialised: string): DeviceSecretKeys => {
  let parsed: Partial<DeviceSecretKeys>
  try {
    parsed = JSON.parse(serialised) as Partial<DeviceSecretKeys>
  } catch {
    throw new CryptoError('Invalid secret keys')
  }
  if (
    typeof parsed?.privateKey !== 'string' ||
    typeof parsed.signingSecretKey !== 'string'
  ) {
    throw new CryptoError('Invalid secret keys')
  }
  return {
    privateKey: parsed.privateKey,
    signingSecretKey: parsed.signingSecretKey,
  }
}
