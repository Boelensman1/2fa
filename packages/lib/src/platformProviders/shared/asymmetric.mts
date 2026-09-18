import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { randomBytes } from '@noble/hashes/utils.js'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js'
import {
  base64ToUint8Array,
  concatUint8Arrays,
  uint8ArrayToBase64,
} from 'uint8array-extras'

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
import {
  buildPairingCombineMessage,
  buildPairingKemDigestMessage,
  encodeFields,
} from '../../utils/canonical.mjs'

/**
 * The asymmetric layer, shared verbatim by both platform providers.
 *
 * ## Why this is not implemented twice
 *
 * Unlike every other primitive in the providers, this one is NOT implemented
 * twice. The RSA layer it replaces was: node-forge in the browser, OpenSSL in
 * node, agreeing only as long as every padding parameter was set identically on
 * both sides -- which is how the OAEP MGF1-SHA-1/SHA-256 split got in, and why
 * tests/CryptoProviders has to pin it. The primitives here have no parameters to
 * disagree about, and `@noble/curves` and `@noble/post-quantum` run unchanged in
 * both environments, so the two providers share one implementation and the seam
 * disappears.
 *
 * The symmetric half stays split -- WebCrypto in the browser, node:crypto in
 * node -- because both environments have a fast native AES-GCM and neither
 * needs a library for it.
 *
 * ## Why every key is a hybrid
 *
 * X25519 and Ed25519 are discrete-log problems, and a quantum computer solves
 * those. For signatures that would mean forged commands from a device in the
 * peer list, which is bad but needs the attacker to be there when it happens.
 * For key agreement it is worse and it is retroactive: anyone who recorded the
 * sync traffic decrypts it later. Every TOTP secret this library exists to
 * protect travels that path.
 *
 * So each of the four key roles is two keys concatenated -- a classical one and
 * a post-quantum one -- and both halves have to fall before anything does:
 *
 * - key agreement: X25519 ++ ML-KEM-768, shared secrets fed to one HKDF
 * - signatures:    Ed25519 ++ ML-DSA-65, and `verifyMessage` demands BOTH
 *
 * That is the same pairing the OpenPGP PQC draft standardises as
 * `pqc_mlkem_x25519` and `pqc_mldsa_ed25519`. Hybrid rather than PQ-only
 * because ML-KEM and ML-DSA are young: a break of either leaves this library
 * exactly as secure as it was before any of this landed.
 *
 * ## What the PQ leg does NOT give: forward secrecy
 *
 * Worth stating plainly, because the classical leg does give it and the
 * asymmetry is easy to miss. The sender draws a throwaway X25519 keypair per
 * message, so recovering a device's long-term X25519 key does not decrypt
 * traffic captured earlier -- the other half of every past exchange was
 * discarded as soon as it was used. The ML-KEM leg has no such half: the sender
 * encapsulates to the recipient's LONG-TERM key, because a per-message PQ key
 * would have to be delivered to the recipient before they could use it, which is
 * a round trip this protocol does not have.
 *
 * The consequence is exact: an attacker who steals a device's `PrivateKey` AND
 * breaks X25519 reads its past traffic. Stealing the key alone does not (ML-KEM
 * still holds), and breaking X25519 alone does not (the seed is secret). It is
 * the standard hybrid-KEM trade-off and it is the price of one round trip.
 *
 * ## Why secret keys store a seed
 *
 * An ML-KEM-768 secret key is 2400 bytes and an ML-DSA-65 one is 4032. Both are
 * deterministic functions of a short seed, so what is sealed at rest is the seed
 * -- 64 and 32 bytes -- and the expanded key is recomputed on use. That keeps
 * `encryptedSecretKeys` small, and it keeps the rule the RSA layer already had:
 * public keys are DERIVED, never stored, so there is no second copy that can
 * disagree with the key material it claims to describe. Expansion costs about
 * 0.7 ms for ML-KEM and 2.1 ms for ML-DSA, against the ~260 ms argon2id pass
 * that every unlock already pays.
 */

/**
 * Reads one length off a primitive, refusing to carry on without it.
 *
 * Every `lengths` field noble publishes is optional in its types, because one
 * interface covers primitives that do not all have a seed or a ciphertext. The
 * ones asked for below are not optional in practice -- they are the byte counts
 * this file's wire format is made of -- so a missing one means the library
 * underneath changed shape, and the honest moment to say so is at import, not
 * at the first seal that silently checks `undefined`.
 * @param value - The length as noble reports it.
 * @param what - What the length is, for the error message.
 * @returns The length.
 * @throws {CryptoError} If the primitive does not publish it.
 */
const lengthOf = (value: number | undefined, what: string): number => {
  if (value === undefined) {
    throw new CryptoError(`Cannot determine ${what} length`)
  }
  return value
}

/** The classical halves. Read off the primitives so they cannot drift. */
const X25519_SECRET_BYTES = lengthOf(x25519.lengths.secretKey, 'x25519 secret')
const X25519_PUBLIC_BYTES = lengthOf(x25519.lengths.publicKey, 'x25519 public')
const ED25519_SECRET_BYTES = lengthOf(
  ed25519.lengths.secretKey,
  'ed25519 secret',
)
const ED25519_PUBLIC_BYTES = lengthOf(
  ed25519.lengths.publicKey,
  'ed25519 public',
)
/**
 * Exported as well as used here: it is the offset a composite signature splits
 * at, which is what a test corrupting one half at a time needs to know.
 */
export const ED25519_SIGNATURE_BYTES = lengthOf(
  ed25519.lengths.signature,
  'ed25519 signature',
)

/** The post-quantum halves, likewise. */
const ML_KEM_SEED_BYTES = lengthOf(ml_kem768.lengths.seed, 'ml-kem seed')
const ML_KEM_PUBLIC_BYTES = lengthOf(
  ml_kem768.lengths.publicKey,
  'ml-kem public',
)
const ML_KEM_CIPHERTEXT_BYTES = lengthOf(
  ml_kem768.lengths.cipherText,
  'ml-kem ciphertext',
)
const ML_DSA_SEED_BYTES = lengthOf(ml_dsa65.lengths.seed, 'ml-dsa seed')
const ML_DSA_PUBLIC_BYTES = lengthOf(
  ml_dsa65.lengths.publicKey,
  'ml-dsa public',
)
const ML_DSA_SIGNATURE_BYTES = lengthOf(
  ml_dsa65.lengths.signature,
  'ml-dsa signature',
)

/**
 * The four composite lengths, in raw bytes before base64.
 *
 * Exported because they are the only honest source for the length checks in
 * `utils/syncDeviceValidation.mts`, which validates peer keys arriving from the
 * network. A hand-written 1624 there would be a second source of truth for a
 * number this file already knows.
 */
export const PRIVATE_KEY_BYTES = X25519_SECRET_BYTES + ML_KEM_SEED_BYTES
export const PUBLIC_KEY_BYTES = X25519_PUBLIC_BYTES + ML_KEM_PUBLIC_BYTES
export const SIGNING_SECRET_KEY_BYTES = ED25519_SECRET_BYTES + ML_DSA_SEED_BYTES
export const SIGNING_PUBLIC_KEY_BYTES =
  ED25519_PUBLIC_BYTES + ML_DSA_PUBLIC_BYTES
export const SIGNATURE_BYTES = ED25519_SIGNATURE_BYTES + ML_DSA_SIGNATURE_BYTES

/**
 * Marks a storage version 2 envelope, sealed or symmetric.
 *
 * A seal is the ordinary v2 envelope with the sender's per-message public key
 * and the ML-KEM ciphertext spliced in behind the version:
 * `v2:<ephemeral public key>:<kem ciphertext>:<nonce>:<ciphertext||tag>`. It
 * keeps the version first, where the symmetric envelope has it, and the field
 * COUNT is what makes an older peer's four-field seal fail here as a format
 * mismatch rather than as arithmetic. The wire carries no version of its own --
 * a command's `version` field is inside the ciphertext -- so this prefix and
 * that shape are the only things that can say what these bytes are.
 */
const V2_ENVELOPE_PREFIX = 'v2'

/** How many colon-separated fields a seal has. */
const SEAL_FIELDS = 5

/**
 * The AAD of the inner symmetric envelope of a seal.
 *
 * A domain separator and nothing more: everything else a seal needs bound --
 * the ephemeral key, the KEM ciphertext, the recipient -- is already in the
 * HKDF info, where the recipient recomputes it rather than reading it off the
 * message.
 */
const SEAL_AAD = encodeFields(['favalib:seal:v2'])

/**
 * Decodes a base64 key and checks its length before it reaches a primitive.
 *
 * The length check is the whole point: a truncated or swapped-role key would
 * otherwise reach noble, which throws its own error mentioning the primitive
 * and the offending length. That is a decrypt oracle by another name, so
 * everything here fails with the same CryptoError the providers use.
 *
 * `expectedBytes` has no default any more. The four roles used to be 32 bytes
 * each, so one constant covered them all and forgetting the argument was
 * harmless; they are now four different lengths, and a forgotten argument would
 * silently check the wrong one.
 * @param value - The base64 encoded key.
 * @param what - What the key is, for the error message. Never includes the value.
 * @param expectedBytes - The exact length the decoded key must have.
 * @returns The decoded key bytes.
 * @throws {CryptoError} If the value is not base64 of exactly that length.
 */
const decodeKey = (
  value: string,
  what: string,
  expectedBytes: number,
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
 * Splits a composite value into its classical and post-quantum halves.
 *
 * Copies rather than returning views. The post-quantum half is handed straight
 * to a keygen, and a view would leave that call writing into -- or reading
 * around -- a buffer the caller still holds.
 * @param bytes - The decoded composite value.
 * @param classicalBytes - How many leading bytes are the classical half.
 * @returns The two halves, in that order.
 */
const split = (
  bytes: Uint8Array,
  classicalBytes: number,
): [Uint8Array, Uint8Array] => [
  Uint8Array.from(bytes.subarray(0, classicalBytes)),
  Uint8Array.from(bytes.subarray(classicalBytes)),
]

/**
 * Joins a classical half and a post-quantum half into one base64 value.
 *
 * Classical first, always. Nothing reads these by offset except `split` above,
 * but the order is a wire format and the seal transcript commits to it.
 * @param classical - The classical half.
 * @param postQuantum - The post-quantum half.
 * @returns The base64 encoded composite.
 */
const join = (classical: Uint8Array, postQuantum: Uint8Array): string =>
  uint8ArrayToBase64(concatUint8Arrays([classical, postQuantum]))

/**
 * Creates the device's signing keypair.
 * @returns The composite Ed25519 ++ ML-DSA-65 keypair, base64 encoded.
 */
export const createSigningKeyPair = (): {
  signingSecretKey: SigningSecretKey
  signingPublicKey: SigningPublicKey
} => {
  const classical = ed25519.keygen()
  const seed = randomBytes(ML_DSA_SEED_BYTES)
  const postQuantum = ml_dsa65.keygen(seed)
  return {
    signingSecretKey: join(classical.secretKey, seed) as SigningSecretKey,
    signingPublicKey: join(
      classical.publicKey,
      postQuantum.publicKey,
    ) as SigningPublicKey,
  }
}

/**
 * Creates the device's key agreement keypair.
 *
 * Only the device's long-term pair, unlike the version this replaced: the
 * per-message ephemeral half of a seal is an X25519 keypair and nothing else,
 * because the ML-KEM leg encapsulates to a long-term key rather than agreeing
 * with a fresh one. See `createSealEphemeral`.
 * @returns The composite X25519 ++ ML-KEM-768 keypair, base64 encoded.
 */
export const createEncryptionKeyPair = (): {
  privateKey: PrivateKey
  publicKey: PublicKey
} => {
  const classical = x25519.keygen()
  const seed = randomBytes(ML_KEM_SEED_BYTES)
  const postQuantum = ml_kem768.keygen(seed)
  return {
    privateKey: join(classical.secretKey, seed) as PrivateKey,
    publicKey: join(classical.publicKey, postQuantum.publicKey) as PublicKey,
  }
}

/**
 * Expands a device's signing secret key into the keys the primitives want.
 * @param signingSecretKey - The device's composite signing secret key.
 * @returns The Ed25519 secret key and the expanded ML-DSA keypair.
 * @throws {CryptoError} If the secret key is malformed.
 */
const expandSigningSecretKey = (signingSecretKey: SigningSecretKey) => {
  const [classicalSecretKey, seed] = split(
    decodeKey(signingSecretKey, 'signing secret key', SIGNING_SECRET_KEY_BYTES),
    ED25519_SECRET_BYTES,
  )
  return { classicalSecretKey, postQuantum: ml_dsa65.keygen(seed) }
}

/**
 * Expands a device's key agreement secret key into the keys the primitives want.
 * @param privateKey - The device's composite key agreement secret key.
 * @returns The X25519 secret key and the expanded ML-KEM keypair.
 * @throws {CryptoError} If the secret key is malformed.
 */
const expandEncryptionSecretKey = (privateKey: PrivateKey) => {
  const [classicalSecretKey, seed] = split(
    decodeKey(privateKey, 'encryption secret key', PRIVATE_KEY_BYTES),
    X25519_SECRET_BYTES,
  )
  return { classicalSecretKey, postQuantum: ml_kem768.keygen(seed) }
}

/**
 * Recovers the signing public key from the secret key.
 *
 * Public keys are derived on unlock rather than stored, exactly as the RSA
 * layer derived them from the private key: a stored copy is one more field that
 * can disagree with the key material it claims to describe.
 * @param signingSecretKey - The device's composite signing secret key.
 * @returns The matching public key.
 * @throws {CryptoError} If the secret key is malformed.
 */
export const signingPublicKeyFromSecret = (
  signingSecretKey: SigningSecretKey,
): SigningPublicKey => {
  const { classicalSecretKey, postQuantum } =
    expandSigningSecretKey(signingSecretKey)
  return join(
    ed25519.getPublicKey(classicalSecretKey),
    postQuantum.publicKey,
  ) as SigningPublicKey
}

/**
 * Recovers the key agreement public key from the secret key.
 * @param privateKey - The device's composite key agreement secret key.
 * @returns The matching public key.
 * @throws {CryptoError} If the secret key is malformed.
 */
export const encryptionPublicKeyFromSecret = (
  privateKey: PrivateKey,
): PublicKey => {
  const { classicalSecretKey, postQuantum } =
    expandEncryptionSecretKey(privateKey)
  return join(
    x25519.getPublicKey(classicalSecretKey),
    postQuantum.publicKey,
  ) as PublicKey
}

/**
 * Signs a message with both halves of the device's signing key.
 * @param signingSecretKey - The device's composite signing secret key.
 * @param message - The canonical message to sign, from canonical.mts.
 * @returns The base64 encoded composite signature.
 * @throws {CryptoError} If the secret key is malformed.
 */
export const signMessage = (
  signingSecretKey: SigningSecretKey,
  message: string,
): Signature => {
  const { classicalSecretKey, postQuantum } =
    expandSigningSecretKey(signingSecretKey)
  const bytes = new TextEncoder().encode(message)
  return join(
    ed25519.sign(bytes, classicalSecretKey),
    ml_dsa65.sign(bytes, postQuantum.secretKey),
  ) as Signature
}

/**
 * Verifies a composite signature against a composite public key.
 *
 * BOTH halves must verify. An OR here would make the composite exactly as
 * strong as its weaker half, which is the opposite of the point: the whole
 * reason to carry two signatures is that an attacker has to forge both.
 *
 * Both halves are checked even when the first fails. Nothing secret is being
 * compared -- a signature and a public key are public by definition -- so this
 * is not about timing; it is so that neither half can be the one that is
 * silently never exercised.
 *
 * Returns false for every failure, malformed input included, and never throws:
 * its callers are deciding whether to drop a message that arrived from the
 * network, and a thrown error there would separate "bad signature" from "bad
 * base64" for whoever is probing.
 * @param signingPublicKey - The claimed sender's composite public key.
 * @param message - The canonical message the signature should cover.
 * @param signature - The base64 encoded composite signature.
 * @returns Whether both halves of the signature are valid.
 */
export const verifyMessage = (
  signingPublicKey: SigningPublicKey,
  message: string,
  signature: Signature,
): boolean => {
  try {
    const [classicalSignature, postQuantumSignature] = split(
      decodeKey(signature, 'signature', SIGNATURE_BYTES),
      ED25519_SIGNATURE_BYTES,
    )
    const [classicalPublicKey, postQuantumPublicKey] = split(
      decodeKey(
        signingPublicKey,
        'signing public key',
        SIGNING_PUBLIC_KEY_BYTES,
      ),
      ED25519_PUBLIC_BYTES,
    )
    const bytes = new TextEncoder().encode(message)

    const classicalValid = ed25519.verify(
      classicalSignature,
      bytes,
      classicalPublicKey,
    )
    const postQuantumValid = ml_dsa65.verify(
      postQuantumSignature,
      bytes,
      postQuantumPublicKey,
    )
    return classicalValid && postQuantumValid
  } catch {
    return false
  }
}

/**
 * Combines the two key agreement shares into the key one seal is encrypted
 * under.
 *
 * The post-quantum share goes first, and the transcript in the HKDF info binds
 * the ephemeral public key, the ML-KEM ciphertext and the recipient's public
 * key, length-prefixed by the same encoder the AADs use.
 *
 * Including the CIPHERTEXT is what makes the combiner binding, and it is not
 * optional. A KEM shared secret does not by itself commit to the ciphertext it
 * came from, so a combiner that hashes only the two secrets lets an attacker who
 * can produce a second ciphertext for the same secret move a seal between
 * contexts. Hashing the ciphertext and the recipient key pins the seal to one
 * exchange with one recipient -- the same construction, and the same reason, as
 * the OpenPGP PQC draft's KEM combiner.
 *
 * It is also why `encrypt` needs no separate aad parameter: everything an AAD
 * would bind is already here, where the recipient RECOMPUTES it rather than
 * reading it off a message the sender wrote.
 * @param postQuantumShare - The ML-KEM shared secret.
 * @param classicalShare - The X25519 shared secret.
 * @param ephemeralPublicKey - The per-message X25519 public key.
 * @param kemCipherText - The ML-KEM ciphertext, base64, exactly as it travels.
 * @param recipientPublicKey - The recipient's long-term composite public key.
 * @returns The derived AES-256 key, base64 encoded.
 */
const combineSealShares = (
  postQuantumShare: Uint8Array,
  classicalShare: Uint8Array,
  ephemeralPublicKey: string,
  kemCipherText: string,
  recipientPublicKey: PublicKey,
): SymmetricKey => {
  const info = new TextEncoder().encode(
    encodeFields([
      'favalib:seal:v2',
      ephemeralPublicKey,
      kemCipherText,
      recipientPublicKey,
    ]),
  )
  return uint8ArrayToBase64(
    hkdf(
      sha256,
      concatUint8Arrays([postQuantumShare, classicalShare]),
      new Uint8Array(0),
      info,
      32,
    ),
  ) as SymmetricKey
}

/**
 * Creates the per-message keypair the sender agrees with.
 *
 * X25519 only -- see the forward secrecy note in this file's header for why
 * there is no per-message ML-KEM half.
 * @returns The ephemeral keypair, base64 encoded.
 */
const createSealEphemeral = (): {
  secretKey: Uint8Array
  publicKey: string
} => {
  const { secretKey, publicKey } = x25519.keygen()
  return { secretKey, publicKey: uint8ArrayToBase64(publicKey) }
}

/**
 * Derives the seal key on the sending side, and the ciphertext that lets the
 * recipient reach the same one.
 *
 * Unlike the version this replaces it returns two things, because the ML-KEM
 * leg produces a value that has to travel: encapsulation is where the shared
 * secret is CREATED, not merely agreed, so the ciphertext is as much part of
 * the result as the key is.
 * @param ephemeral - The per-message X25519 keypair, from createSealEphemeral.
 * @param ephemeral.secretKey - Its secret half, discarded after this call.
 * @param ephemeral.publicKey - Its public half, sent with the ciphertext.
 * @param recipientPublicKey - The recipient's long-term composite public key.
 * @returns The derived key and the base64 ML-KEM ciphertext to send with it.
 * @throws {CryptoError} If the recipient's public key is malformed.
 */
export const deriveSealKeyForSender = (
  ephemeral: { secretKey: Uint8Array; publicKey: string },
  recipientPublicKey: PublicKey,
): { key: SymmetricKey; kemCipherText: string } => {
  const [classicalPublicKey, postQuantumPublicKey] = split(
    decodeKey(recipientPublicKey, 'encryption public key', PUBLIC_KEY_BYTES),
    X25519_PUBLIC_BYTES,
  )

  let encapsulated: { cipherText: Uint8Array; sharedSecret: Uint8Array }
  try {
    encapsulated = ml_kem768.encapsulate(postQuantumPublicKey)
  } catch {
    throw new CryptoError('Malformed encryption public key')
  }
  const kemCipherText = uint8ArrayToBase64(encapsulated.cipherText)

  return {
    key: combineSealShares(
      encapsulated.sharedSecret,
      x25519.getSharedSecret(ephemeral.secretKey, classicalPublicKey),
      ephemeral.publicKey,
      kemCipherText,
      recipientPublicKey,
    ),
    kemCipherText,
  }
}

/**
 * Derives the same key on the receiving side.
 *
 * The recipient's own public key is recomputed from its secret key rather than
 * taken from the message: the transcript has to describe who the sender sealed
 * TO, and a value the sender chose could name someone else.
 * @param privateKey - This device's long-term composite secret key.
 * @param ephemeralPublicKey - The per-message X25519 public key from the message.
 * @param kemCipherText - The base64 ML-KEM ciphertext from the message.
 * @returns The derived AES-256 key, base64 encoded.
 * @throws {CryptoError} If any of the three is malformed.
 */
export const deriveSealKeyForRecipient = (
  privateKey: PrivateKey,
  ephemeralPublicKey: string,
  kemCipherText: string,
): SymmetricKey => {
  const { classicalSecretKey, postQuantum } =
    expandEncryptionSecretKey(privateKey)

  const classicalShare = x25519.getSharedSecret(
    classicalSecretKey,
    decodeKey(ephemeralPublicKey, 'ephemeral public key', X25519_PUBLIC_BYTES),
  )

  // ML-KEM decapsulation is designed not to fail: a ciphertext that does not
  // belong to this key yields an unrelated shared secret rather than an error,
  // which is exactly the implicit rejection that keeps it from being an oracle.
  // The seal then fails at the GCM tag, alongside every other cause.
  const postQuantumShare = ml_kem768.decapsulate(
    decodeKey(kemCipherText, 'kem ciphertext', ML_KEM_CIPHERTEXT_BYTES),
    postQuantum.secretKey,
  )

  return combineSealShares(
    postQuantumShare,
    classicalShare,
    ephemeralPublicKey,
    kemCipherText,
    join(
      x25519.getPublicKey(classicalSecretKey),
      postQuantum.publicKey,
    ) as PublicKey,
  )
}

/**
 * Seals a message to a public key, using the provider's own AES-GCM.
 *
 * The asymmetric half is shared; the symmetric half is the caller's, which is
 * why this takes the provider rather than living inside one. Both providers
 * therefore produce byte-compatible seals without either of them owning the
 * primitives.
 * @param crypto - The provider whose encryptSymmetric to use.
 * @param publicKey - The recipient's composite public key.
 * @param plainText - The text to seal.
 * @returns A promise resolving to the sealed text.
 * @throws {CryptoError} If the public key is malformed.
 */
export const sealTo = async <T extends string>(
  crypto: Pick<CryptoLib, 'encryptSymmetric'>,
  publicKey: PublicKey,
  plainText: T,
): Promise<Encrypted<T>> => {
  const ephemeral = createSealEphemeral()
  const { key, kemCipherText } = deriveSealKeyForSender(ephemeral, publicKey)
  const [prefix, nonce, cipherText] = (
    await crypto.encryptSymmetric(key, plainText, SEAL_AAD)
  ).split(':')

  return [prefix, ephemeral.publicKey, kemCipherText, nonce, cipherText].join(
    ':',
  ) as Encrypted<T>
}

/**
 * Opens a message sealed to this device.
 *
 * Every failure is the same CryptoError with the same message -- a malformed
 * ephemeral key, a malformed or foreign KEM ciphertext, a wrong recipient, a
 * tampered tag, a four-field seal from a build that predates the KEM. Which one
 * it was is exactly what an attacker probing the sync path wants told.
 * @param crypto - The provider whose decryptSymmetric to use.
 * @param privateKey - This device's composite secret key.
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
  if (parts.length !== SEAL_FIELDS || parts[0] !== V2_ENVELOPE_PREFIX) {
    throw new CryptoError('Could not decrypt data')
  }
  const [prefix, ephemeralPublicKey, kemCipherText, nonce, cipherText] = parts

  let key: SymmetricKey
  try {
    key = deriveSealKeyForRecipient(
      privateKey,
      ephemeralPublicKey,
      kemCipherText,
    )
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
 * a primitive instead of a vault.
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

/**
 * The pairing KEM: the post-quantum half of the add-device key exchange.
 *
 * Separate from the seal above because it is a different exchange with a
 * different lifetime. A seal encapsulates to a device's long-term key; this
 * keypair exists for one pairing and is thrown away with the flow, so the
 * initial vault -- every TOTP secret the vault holds, in one message -- gets the
 * forward secrecy a seal cannot have.
 *
 * It lives here rather than in `SyncManager` for the same reason the rest of
 * this file does: one implementation of each primitive, in the one place that
 * imports it. `SyncManager` already drives `jpake-ts` directly, and these three
 * functions are the matching surface for the other leg.
 */

/**
 * Creates the initiator's one-pairing KEM keypair.
 * @returns The secret key as raw bytes, and the public key base64 encoded --
 * base64 because the public half travels as JSON through the sync server.
 */
export const createPairingKemKeyPair = (): {
  secretKey: Uint8Array
  publicKey: string
} => {
  const { secretKey, publicKey } = ml_kem768.keygen()
  return { secretKey, publicKey: uint8ArrayToBase64(publicKey) }
}

/**
 * Digests a pairing KEM public key, for the initiator to send out of band.
 * @param initiatorDeviceId - The device that generated the key.
 * @param kemPublicKey - The base64 public key, exactly as it will travel.
 * @returns The base64 digest.
 */
export const pairingKemPublicKeyDigest = (
  initiatorDeviceId: string,
  kemPublicKey: string,
): string =>
  uint8ArrayToBase64(
    sha256(
      new TextEncoder().encode(
        buildPairingKemDigestMessage(initiatorDeviceId, kemPublicKey),
      ),
    ),
  )

/**
 * Checks a relayed pairing KEM public key against the digest that came out of
 * band.
 *
 * This is the only thing standing between the pairing and a sync server that
 * substitutes its own key, so it runs before the responder sends anything at
 * all. Compared without branching on content: until the real key is relayed the
 * digest is known only to whoever scanned the code, and a compare that returns
 * early would leak it a character at a time to an attacker willing to restart
 * the flow.
 *
 * Returns false rather than throwing, like every other verifier here -- the
 * caller is deciding whether to abandon something that arrived from the
 * network.
 * @param expectedDigest - The base64 digest from the out-of-band payload.
 * @param initiatorDeviceId - The device the payload claimed to come from.
 * @param kemPublicKey - The base64 public key the server relayed.
 * @returns Whether the relayed key is the one the digest vouches for.
 */
export const verifyPairingKemPublicKey = (
  expectedDigest: string,
  initiatorDeviceId: string,
  kemPublicKey: string,
): boolean => {
  let expected: Uint8Array
  let actual: Uint8Array
  try {
    expected = base64ToUint8Array(expectedDigest)
    actual = base64ToUint8Array(
      pairingKemPublicKeyDigest(initiatorDeviceId, kemPublicKey),
    )
  } catch {
    return false
  }
  if (expected.length !== actual.length) {
    return false
  }
  let difference = 0
  for (let i = 0; i < expected.length; i++) {
    difference |= expected[i] ^ actual[i]
  }
  return difference === 0
}

/**
 * Encapsulates a shared secret to a verified pairing KEM public key.
 * @param kemPublicKey - The base64 public key, already checked against its digest.
 * @returns The base64 ciphertext to send back, and the shared secret.
 * @throws {CryptoError} If the public key is malformed.
 */
export const pairingKemEncapsulate = (
  kemPublicKey: string,
): { kemCipherText: string; sharedSecret: Uint8Array } => {
  const publicKey = decodeKey(
    kemPublicKey,
    'pairing kem public key',
    ML_KEM_PUBLIC_BYTES,
  )
  let encapsulated: { cipherText: Uint8Array; sharedSecret: Uint8Array }
  try {
    encapsulated = ml_kem768.encapsulate(publicKey)
  } catch {
    throw new CryptoError('Malformed pairing kem public key')
  }
  return {
    kemCipherText: uint8ArrayToBase64(encapsulated.cipherText),
    sharedSecret: encapsulated.sharedSecret,
  }
}

/**
 * Recovers the pairing shared secret from the responder's ciphertext.
 *
 * A ciphertext that does not belong to this keypair yields an unrelated secret
 * rather than an error -- ML-KEM's implicit rejection -- so the two sides simply
 * fail to agree, and the failure surfaces where it should: the handshake
 * payload does not decrypt.
 * @param kemCipherText - The base64 ciphertext from the responder.
 * @param secretKey - This flow's KEM secret key.
 * @returns The shared secret.
 * @throws {CryptoError} If the ciphertext is malformed.
 */
export const pairingKemDecapsulate = (
  kemCipherText: string,
  secretKey: Uint8Array,
): Uint8Array =>
  ml_kem768.decapsulate(
    decodeKey(kemCipherText, 'pairing kem ciphertext', ML_KEM_CIPHERTEXT_BYTES),
    secretKey,
  )

/**
 * Combines the two pairing shares into the input the sync key is stretched from.
 *
 * Post-quantum share first, transcript in the HKDF info -- the same shape and
 * the same reasoning as `combineSealShares`, which the doc comment on
 * `buildPairingCombineMessage` sets out.
 *
 * The combining happens HERE, in the shared layer, rather than in each provider
 * and their two different HKDFs. The providers already agree byte for byte
 * about the seal for that reason, and the pairing has a worse failure mode than
 * a seal does: a divergence would not throw, it would leave two devices holding
 * two different sync keys and blaming the password.
 *
 * Returns 64 bytes because that is what argon2id is handed next, and a longer
 * input costs nothing there.
 * @param postQuantumShare - The ML-KEM shared secret.
 * @param jpakeShare - The key J-PAKE derived from the out-of-band password.
 * @param responderDeviceId - The device joining the vault.
 * @param kemCipherText - The base64 ML-KEM ciphertext, exactly as it travelled.
 * @returns The combined key material.
 */
export const combinePairingShares = (
  postQuantumShare: Uint8Array,
  jpakeShare: Uint8Array,
  responderDeviceId: string,
  kemCipherText: string,
): Uint8Array =>
  hkdf(
    sha256,
    concatUint8Arrays([postQuantumShare, jpakeShare]),
    new Uint8Array(0),
    new TextEncoder().encode(
      buildPairingCombineMessage(responderDeviceId, kemCipherText),
    ),
    64,
  )
