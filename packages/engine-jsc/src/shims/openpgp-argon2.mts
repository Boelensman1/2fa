/**
 * Replaces `argon2id.min.mjs` inside openpgp's lightweight build (scripts/build.mts
 * swaps it in), which loads a WebAssembly argon2.
 *
 * openpgp lazy-imports that module, awaits its default export to get an
 * argon2 function, then calls that function SYNCHRONOUSLY. That is why the
 * host's argon2id is synchronous rather than promise-based.
 */
import { base64ToBytes, bytesToBase64 } from '../polyfills/encoding.mjs'
import { getHost } from '../host.mjs'

interface OpenPgpArgon2Params {
  password: Uint8Array
  salt: Uint8Array
  tagLength: number
  memorySize: number
  parallelism: number
  passes: number
}

/**
 * The module's default export: resolves to openpgp's argon2 function.
 * @returns The argon2 function.
 */
const loadArgon2 = () =>
  Promise.resolve((params: OpenPgpArgon2Params): Uint8Array =>
    base64ToBytes(
      getHost().argon2id(
        bytesToBase64(params.password),
        bytesToBase64(params.salt),
        params.passes,
        params.memorySize,
        params.parallelism,
        params.tagLength,
      ),
    ),
  )

export default loadArgon2
