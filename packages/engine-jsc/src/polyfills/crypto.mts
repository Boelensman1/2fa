/**
 * `crypto.getRandomValues`, `crypto.randomUUID` and the part of
 * `crypto.subtle` that favalib and openpgp use.
 *
 * Randomness comes from the host (SecRandomCopyBytes). The subtle operations
 * are `@noble`'s audited pure-JS implementations: favalib's own payloads are
 * small, and an interpreted AES-GCM over a few KB costs well under a
 * millisecond. What has to be native is argon2id, and that never comes
 * through here (see shims/hash-wasm.mts).
 *
 * The subset, which is everything the browser provider and openpgp's
 * lightweight build (with `aeadProtect` and argon2 S2K) reach:
 *
 * - digest: SHA-1, SHA-256, SHA-384, SHA-512
 * - importKey / exportKey: 'raw' only
 * - generateKey: AES-GCM
 * - encrypt / decrypt: AES-GCM, 128-bit tag
 * - sign / verify: HMAC
 * - deriveBits: HKDF
 *
 * Anything else rejects with NotSupportedError. openpgp probes some
 * algorithms and falls back to its bundled JS implementations when WebCrypto
 * refuses, so a refusal is safe; a wrong answer would not be.
 */
import { gcm } from '@noble/ciphers/aes.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha1 } from '@noble/hashes/legacy.js'
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js'
import type { CHash } from '@noble/hashes/utils.js'

import { base64ToBytes } from './encoding.mjs'
import { getHost } from '../host.mjs'

type HashFn = CHash

const HASHES: Record<string, HashFn | undefined> = {
  'SHA-1': sha1,
  'SHA-256': sha256,
  'SHA-384': sha384,
  'SHA-512': sha512,
}

type AlgorithmInput = string | { name: string; [key: string]: unknown }

interface KeyAlgorithm {
  name: string
  length?: number
  hash?: { name: string }
}

/**
 * The object handed out as a CryptoKey. Its bytes live in a WeakMap rather
 * than on the object, so they are not enumerable and do not show up when the
 * key is logged or serialised.
 */
interface ShimCryptoKey {
  readonly type: 'secret'
  readonly extractable: boolean
  readonly algorithm: KeyAlgorithm
  readonly usages: string[]
}

const rawKeys = new WeakMap<ShimCryptoKey, Uint8Array>()

const domError = (name: string, message: string) => {
  const error = new Error(message)
  error.name = name
  return error
}

const algorithmName = (algorithm: AlgorithmInput | undefined): string => {
  const name = typeof algorithm === 'string' ? algorithm : algorithm?.name
  if (typeof name !== 'string') {
    throw domError('TypeError', 'Algorithm: name is missing')
  }
  return name.toUpperCase()
}

const hashFunction = (algorithm: AlgorithmInput | undefined): HashFn => {
  const fn = HASHES[algorithmName(algorithm)]
  if (!fn) {
    throw domError(
      'NotSupportedError',
      `Unsupported hash ${algorithmName(algorithm)}`,
    )
  }
  return fn
}

/**
 * A COPY of a BufferSource's bytes. WebCrypto copies every input when the
 * method is called, before it returns its promise, and callers rely on it:
 * openpgp's chunked AEAD reuses one nonce and one AAD buffer, rewriting them
 * for the next chunk while the previous encrypt is still pending. Reading the
 * caller's buffer later, when the work runs, encrypted chunks under the wrong
 * nonce -- output that only this shim could read back.
 * @param data - An ArrayBuffer or a view of one.
 * @returns A copy of the bytes.
 */
const copyBytes = (data: unknown): Uint8Array => {
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data).slice()
  }
  throw domError('TypeError', 'Expected a BufferSource')
}

/**
 * Runs a subtle method the way WebCrypto does: `prepare` validates and copies
 * the arguments synchronously, and returns the work to do asynchronously. Any
 * throw, from either step, becomes a rejection.
 * @param prepare - Validates and copies, returns the work.
 * @returns The work's result.
 */
const run = <T,>(prepare: () => () => T): Promise<T> =>
  // A promise executor runs synchronously, so `prepare` still copies at call
  // time, and anything it throws becomes the rejection.
  new Promise<() => T>((resolve) => {
    resolve(prepare())
  }).then((work) => work())

/**
 * A fresh ArrayBuffer holding a copy of the bytes, as subtle returns.
 * @param bytes - The bytes.
 * @returns The buffer.
 */
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer

const unsupported = (operation: string, algorithm: AlgorithmInput) =>
  domError(
    'NotSupportedError',
    `crypto.subtle.${operation}(${algorithmName(algorithm)}) is not supported in this engine`,
  )

const makeKey = (
  raw: Uint8Array,
  algorithm: KeyAlgorithm,
  extractable: boolean,
  usages: string[],
): ShimCryptoKey => {
  const key: ShimCryptoKey = Object.freeze({
    type: 'secret' as const,
    extractable,
    algorithm: Object.freeze(algorithm),
    usages: [...usages],
  })
  rawKeys.set(key, raw.slice())
  return key
}

const useKey = (key: unknown, usage: string, algorithm: string): Uint8Array => {
  const raw = rawKeys.get(key as ShimCryptoKey)
  const k = key as ShimCryptoKey
  if (!raw) {
    throw domError('TypeError', 'Not a CryptoKey from this engine')
  }
  if (k.algorithm.name.toUpperCase() !== algorithm) {
    throw domError(
      'InvalidAccessError',
      `Key is for ${k.algorithm.name}, not ${algorithm}`,
    )
  }
  if (!k.usages.includes(usage)) {
    throw domError('InvalidAccessError', `Key does not allow ${usage}`)
  }
  return raw
}

const IMPORTABLE: Record<string, string[] | undefined> = {
  'AES-GCM': ['encrypt', 'decrypt'],
  HMAC: ['sign', 'verify'],
  HKDF: ['deriveBits', 'deriveKey'],
}

const gcmParams = (algorithm: AlgorithmInput) => {
  const params = algorithm as {
    iv?: unknown
    additionalData?: unknown
    tagLength?: number
  }
  if (params.tagLength !== undefined && params.tagLength !== 128) {
    throw domError(
      'NotSupportedError',
      'Only a 128-bit AES-GCM tag is supported',
    )
  }
  return {
    iv: copyBytes(params.iv),
    aad:
      params.additionalData === undefined
        ? undefined
        : copyBytes(params.additionalData),
  }
}

/**
 * The SubtleCrypto subset described at the top of this file. Every method
 * validates and copies its arguments before returning (see `run`).
 */
export const subtle = {
  /**
   * @param algorithm - The hash.
   * @param data - What to hash.
   * @returns The digest.
   */
  digest(algorithm: AlgorithmInput, data: unknown): Promise<ArrayBuffer> {
    return run(() => {
      const hash = hashFunction(algorithm)
      const bytes = copyBytes(data)
      return () => toArrayBuffer(hash(bytes))
    })
  },

  /**
   * @param format - Must be 'raw'.
   * @param keyData - The key bytes.
   * @param algorithm - AES-GCM, HMAC (with hash) or HKDF.
   * @param extractable - Whether exportKey may read it back.
   * @param usages - What the key may be used for.
   * @returns The key.
   */
  importKey(
    format: string,
    keyData: unknown,
    algorithm: AlgorithmInput,
    extractable: boolean,
    usages: string[],
  ): Promise<ShimCryptoKey> {
    return run(() => {
      const name = algorithmName(algorithm)
      const allowed = IMPORTABLE[name]
      if (format !== 'raw' || !allowed) {
        throw domError(
          'NotSupportedError',
          `importKey(${format}, ${name}) is not supported in this engine`,
        )
      }
      if (usages.some((u) => !allowed.includes(u))) {
        throw domError('SyntaxError', `Invalid key usage for ${name}`)
      }
      const raw = copyBytes(keyData)
      const keyAlgorithm: KeyAlgorithm = { name }
      if (name === 'AES-GCM') {
        if (![16, 24, 32].includes(raw.length)) {
          throw domError('DataError', 'AES key must be 128, 192 or 256 bits')
        }
        keyAlgorithm.length = raw.length * 8
      }
      if (name === 'HMAC') {
        const hash = (algorithm as { hash?: AlgorithmInput }).hash
        hashFunction(hash)
        keyAlgorithm.hash = { name: algorithmName(hash) }
        keyAlgorithm.length = raw.length * 8
      }
      return () => makeKey(raw, keyAlgorithm, extractable, usages)
    })
  },

  /**
   * @param format - Must be 'raw'.
   * @param key - An extractable key.
   * @returns The key bytes.
   */
  exportKey(format: string, key: unknown): Promise<ArrayBuffer> {
    return run(() => {
      const raw = rawKeys.get(key as ShimCryptoKey)
      if (!raw) {
        throw domError('TypeError', 'Not a CryptoKey from this engine')
      }
      if (format !== 'raw') {
        throw domError(
          'NotSupportedError',
          `exportKey(${format}) is not supported`,
        )
      }
      if (!(key as ShimCryptoKey).extractable) {
        throw domError('InvalidAccessError', 'Key is not extractable')
      }
      return () => toArrayBuffer(raw)
    })
  },

  /**
   * @param algorithm - AES-GCM with a length.
   * @param extractable - Whether exportKey may read it back.
   * @param usages - What the key may be used for.
   * @returns The new key.
   */
  generateKey(
    algorithm: AlgorithmInput,
    extractable: boolean,
    usages: string[],
  ): Promise<ShimCryptoKey> {
    return run(() => {
      if (algorithmName(algorithm) !== 'AES-GCM') {
        throw unsupported('generateKey', algorithm)
      }
      const length = (algorithm as { length?: number }).length
      if (length !== 128 && length !== 192 && length !== 256) {
        throw domError(
          'OperationError',
          'AES key length must be 128, 192 or 256',
        )
      }
      return () =>
        makeKey(
          getRandomValues(new Uint8Array(length / 8)),
          { name: 'AES-GCM', length },
          extractable,
          usages,
        )
    })
  },

  /**
   * @param algorithm - AES-GCM with iv and optional additionalData.
   * @param key - An AES-GCM key allowing encrypt.
   * @param data - The plaintext.
   * @returns Ciphertext followed by the 16-byte tag.
   */
  encrypt(
    algorithm: AlgorithmInput,
    key: unknown,
    data: unknown,
  ): Promise<ArrayBuffer> {
    return run(() => {
      if (algorithmName(algorithm) !== 'AES-GCM') {
        throw unsupported('encrypt', algorithm)
      }
      const raw = useKey(key, 'encrypt', 'AES-GCM')
      const { iv, aad } = gcmParams(algorithm)
      const plaintext = copyBytes(data)
      return () => toArrayBuffer(gcm(raw, iv, aad).encrypt(plaintext))
    })
  },

  /**
   * @param algorithm - AES-GCM with iv and optional additionalData.
   * @param key - An AES-GCM key allowing decrypt.
   * @param data - Ciphertext followed by the tag.
   * @returns The plaintext.
   */
  decrypt(
    algorithm: AlgorithmInput,
    key: unknown,
    data: unknown,
  ): Promise<ArrayBuffer> {
    return run(() => {
      if (algorithmName(algorithm) !== 'AES-GCM') {
        throw unsupported('decrypt', algorithm)
      }
      const raw = useKey(key, 'decrypt', 'AES-GCM')
      const { iv, aad } = gcmParams(algorithm)
      const ciphertext = copyBytes(data)
      return () => {
        try {
          return toArrayBuffer(gcm(raw, iv, aad).decrypt(ciphertext))
        } catch {
          // WebCrypto says nothing more specific than this, deliberately.
          throw domError(
            'OperationError',
            'The operation failed for an operation-specific reason',
          )
        }
      }
    })
  },

  /**
   * @param algorithm - HMAC.
   * @param key - An HMAC key allowing sign.
   * @param data - The message.
   * @returns The MAC.
   */
  sign(
    algorithm: AlgorithmInput,
    key: unknown,
    data: unknown,
  ): Promise<ArrayBuffer> {
    return run(() => {
      if (algorithmName(algorithm) !== 'HMAC') {
        throw unsupported('sign', algorithm)
      }
      const raw = useKey(key, 'sign', 'HMAC')
      const hash = hashFunction((key as ShimCryptoKey).algorithm.hash)
      const message = copyBytes(data)
      return () => toArrayBuffer(hmac(hash, raw, message))
    })
  },

  /**
   * Constant-time comparison of the expected MAC against the given one.
   * @param algorithm - HMAC.
   * @param key - An HMAC key allowing verify.
   * @param signature - The MAC to check.
   * @param data - The message.
   * @returns Whether the MAC matches.
   */
  verify(
    algorithm: AlgorithmInput,
    key: unknown,
    signature: unknown,
    data: unknown,
  ): Promise<boolean> {
    return run(() => {
      if (algorithmName(algorithm) !== 'HMAC') {
        throw unsupported('verify', algorithm)
      }
      const raw = useKey(key, 'verify', 'HMAC')
      const hash = hashFunction((key as ShimCryptoKey).algorithm.hash)
      const given = copyBytes(signature)
      const message = copyBytes(data)
      return () => {
        const expected = hmac(hash, raw, message)
        if (expected.length !== given.length) {
          return false
        }
        let diff = 0
        for (let i = 0; i < expected.length; i++) {
          diff |= expected[i] ^ given[i]
        }
        return diff === 0
      }
    })
  },

  /**
   * @param algorithm - HKDF with hash, salt and info.
   * @param key - An HKDF key allowing deriveBits.
   * @param length - Output length in bits, a multiple of 8.
   * @returns The derived bytes.
   */
  deriveBits(
    algorithm: AlgorithmInput,
    key: unknown,
    length: number,
  ): Promise<ArrayBuffer> {
    return run(() => {
      if (algorithmName(algorithm) !== 'HKDF') {
        throw unsupported('deriveBits', algorithm)
      }
      const raw = useKey(key, 'deriveBits', 'HKDF')
      const params = algorithm as {
        hash?: AlgorithmInput
        salt?: unknown
        info?: unknown
      }
      if (length % 8 !== 0) {
        throw domError('OperationError', 'HKDF length must be a multiple of 8')
      }
      const hash = hashFunction(params.hash)
      const salt = copyBytes(params.salt)
      const info = copyBytes(params.info)
      return () => toArrayBuffer(hkdf(hash, raw, salt, info, length / 8))
    })
  },

  /**
   * Not supported.
   * @param algorithm - Any.
   * @returns A rejection.
   */
  deriveKey(algorithm: AlgorithmInput): Promise<never> {
    return Promise.reject(unsupported('deriveKey', algorithm))
  },

  /**
   * Not supported.
   * @param _format - Any.
   * @param _key - Any.
   * @param _wrappingKey - Any.
   * @param algorithm - Any.
   * @returns A rejection.
   */
  wrapKey(
    _format: string,
    _key: unknown,
    _wrappingKey: unknown,
    algorithm: AlgorithmInput,
  ): Promise<never> {
    return Promise.reject(unsupported('wrapKey', algorithm))
  },

  /**
   * Not supported.
   * @param _format - Any.
   * @param _wrapped - Any.
   * @param _unwrappingKey - Any.
   * @param algorithm - Any.
   * @returns A rejection.
   */
  unwrapKey(
    _format: string,
    _wrapped: unknown,
    _unwrappingKey: unknown,
    algorithm: AlgorithmInput,
  ): Promise<never> {
    return Promise.reject(unsupported('unwrapKey', algorithm))
  },
}

/**
 * `crypto.getRandomValues`, filled from the host's CSPRNG.
 * @param array - An integer typed array of at most 65536 bytes.
 * @returns The same array, filled.
 */
export const getRandomValues = <T extends ArrayBufferView>(array: T): T => {
  if (
    array instanceof Float32Array ||
    array instanceof Float64Array ||
    array instanceof DataView ||
    !ArrayBuffer.isView(array)
  ) {
    throw domError('TypeMismatchError', 'Expected an integer typed array')
  }
  if (array.byteLength > 65536) {
    throw domError(
      'QuotaExceededError',
      'getRandomValues: at most 65536 bytes per call',
    )
  }
  const random = base64ToBytes(getHost().randomBytes(array.byteLength))
  if (random.length !== array.byteLength) {
    throw domError('OperationError', 'host returned the wrong number of bytes')
  }
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(random)
  return array
}

/**
 * `crypto.randomUUID`: an RFC 4122 version 4 UUID.
 * @returns The UUID.
 */
export const randomUUID = (): string => {
  const b = getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Installs `crypto` if the global object lacks it.
 */
export const installCrypto = () => {
  const g = globalThis as Record<string, unknown>
  g.crypto ??= { getRandomValues, randomUUID, subtle }
}
