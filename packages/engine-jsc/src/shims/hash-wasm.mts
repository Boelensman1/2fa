/**
 * Stands in for `hash-wasm` in the bundle (scripts/build.mts aliases it).
 *
 * favalib's browser crypto provider runs argon2id through hash-wasm, which is
 * WebAssembly, and an iOS JSContext has none. A pure-JS argon2id is not an
 * option either: with the JIT off, one derivation at the vault's parameters
 * (64 MiB, 3 passes, 4 lanes) takes over a minute. So it goes to the host,
 * which runs the reference C implementation.
 *
 * Only the one function, and only the options favalib passes.
 */
import {
  base64ToBytes,
  bytesToBase64,
  Utf8Encoder,
} from '../polyfills/encoding.mjs'
import { getHost } from '../host.mjs'

interface Argon2Options {
  password: string | Uint8Array
  salt: string | Uint8Array
  iterations: number
  memorySize: number
  parallelism: number
  hashLength: number
  outputType?: 'hex' | 'binary'
}

const encoder = new Utf8Encoder()
const asBytes = (value: string | Uint8Array) =>
  typeof value === 'string' ? encoder.encode(value) : value

/**
 * hash-wasm's argon2id, computed by the host.
 * @param options - hash-wasm's argon2id options; strings are UTF-8 encoded,
 * as hash-wasm does.
 * @returns The hash as lowercase hex (the default) or bytes.
 */
export function argon2id(
  options: Argon2Options & { outputType: 'binary' },
): Promise<Uint8Array>
/**
 * @inheritdoc
 */
export function argon2id(
  options: Argon2Options & { outputType?: 'hex' },
): Promise<string>
/**
 * @inheritdoc
 */
export function argon2id(options: Argon2Options): Promise<string | Uint8Array> {
  return Promise.resolve().then(() => {
    const out = base64ToBytes(
      getHost().argon2id(
        bytesToBase64(asBytes(options.password)),
        bytesToBase64(asBytes(options.salt)),
        options.iterations,
        options.memorySize,
        options.parallelism,
        options.hashLength,
      ),
    )
    if (options.outputType === 'binary') {
      return out
    }
    return Array.from(out, (b) => b.toString(16).padStart(2, '0')).join('')
  })
}
