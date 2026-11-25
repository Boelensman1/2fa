/**
 * TextEncoder, TextDecoder, atob and btoa: WHATWG APIs that JavaScriptCore
 * leaves to WebCore, so a JSContext has none of them.
 *
 * Only UTF-8 is supported, which is the only encoding favalib and its
 * dependencies ask for.
 */

const REPLACEMENT = 0xfffd

/**
 * UTF-8 encoder with TextEncoder's semantics: lone surrogates become U+FFFD.
 */
export class Utf8Encoder {
  readonly encoding = 'utf-8'

  /**
   * Encodes a string as UTF-8.
   * @param input - The string.
   * @returns The UTF-8 bytes.
   */
  encode(input = ''): Uint8Array {
    const str = String(input)
    const out = new Uint8Array(str.length * 3)
    let o = 0
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i)
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0
        if (next >= 0xdc00 && next <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00)
          i++
        } else {
          c = REPLACEMENT
        }
      } else if (c >= 0xdc00 && c <= 0xdfff) {
        c = REPLACEMENT
      }
      if (c < 0x80) {
        out[o++] = c
      } else if (c < 0x800) {
        out[o++] = 0xc0 | (c >> 6)
        out[o++] = 0x80 | (c & 0x3f)
      } else if (c < 0x10000) {
        out[o++] = 0xe0 | (c >> 12)
        out[o++] = 0x80 | ((c >> 6) & 0x3f)
        out[o++] = 0x80 | (c & 0x3f)
      } else {
        out[o++] = 0xf0 | (c >> 18)
        out[o++] = 0x80 | ((c >> 12) & 0x3f)
        out[o++] = 0x80 | ((c >> 6) & 0x3f)
        out[o++] = 0x80 | (c & 0x3f)
      }
    }
    return out.slice(0, o)
  }
}

const toBytes = (input?: ArrayBuffer | ArrayBufferView): Uint8Array => {
  if (input === undefined) {
    return new Uint8Array(0)
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  }
  return new Uint8Array(input)
}

/**
 * UTF-8 decoder with TextDecoder's semantics: invalid sequences become U+FFFD
 * (one per maximal invalid subpart), or throw with `fatal: true`. A leading
 * BOM is stripped unless `ignoreBOM` is set. With `{ stream: true }` a
 * sequence cut off at the end of a chunk is held back for the next call, and
 * the next call without it ends the stream.
 */
export class Utf8Decoder {
  readonly fatal: boolean
  readonly ignoreBOM: boolean
  /** The start of a sequence the previous streaming call ended inside. */
  #pending = new Uint8Array(0)
  /** Whether this stream is past the point where a BOM could be. */
  #bomChecked = false

  /**
   * @param label - Must name UTF-8.
   * @param options - TextDecoder's options.
   * @param options.fatal - Throw on invalid input instead of replacing it.
   * @param options.ignoreBOM - Keep a leading byte order mark.
   */
  constructor(
    label = 'utf-8',
    options: { fatal?: boolean; ignoreBOM?: boolean } = {},
  ) {
    if (!/^\s*(unicode-1-1-)?utf-?8\s*$/i.test(label)) {
      throw new RangeError(`Unsupported encoding: ${label}`)
    }
    this.fatal = !!options.fatal
    this.ignoreBOM = !!options.ignoreBOM
  }

  readonly encoding = 'utf-8'

  /**
   * Decodes UTF-8 bytes.
   * @param input - The bytes.
   * @param options - TextDecodeOptions.
   * @param options.stream - More chunks follow this one.
   * @returns The string.
   */
  decode(
    input?: ArrayBuffer | ArrayBufferView,
    options: { stream?: boolean } = {},
  ): string {
    const stream = !!options.stream
    let bytes = toBytes(input)
    if (this.#pending.length) {
      const joined = new Uint8Array(this.#pending.length + bytes.length)
      joined.set(this.#pending)
      joined.set(bytes, this.#pending.length)
      bytes = joined
      this.#pending = new Uint8Array(0)
    }
    try {
      return this.#decode(bytes, stream)
    } finally {
      if (!stream) {
        // The stream is over: the next call starts a new one.
        this.#pending = new Uint8Array(0)
        this.#bomChecked = false
      } else if (bytes.length > this.#pending.length) {
        // Something was consumed, so a BOM has either been stripped or cannot
        // come any more. Bytes merely held back (a lone 0xef) do not count.
        this.#bomChecked = true
      }
    }
  }

  #decode(bytes: Uint8Array, stream: boolean): string {
    const units: number[] = []
    let out = ''
    const flush = () => {
      out += String.fromCharCode(...units)
      units.length = 0
    }
    const bad = () => {
      if (this.fatal) {
        throw new TypeError('The encoded data was not valid utf-8')
      }
      units.push(REPLACEMENT)
    }
    let i = 0
    if (
      !this.#bomChecked &&
      !this.ignoreBOM &&
      bytes[0] === 0xef &&
      bytes[1] === 0xbb &&
      bytes[2] === 0xbf
    ) {
      i = 3
    }
    while (i < bytes.length) {
      const b = bytes[i]
      let need = 0
      let cp = 0
      let lower = 0x80
      let upper = 0xbf
      if (b < 0x80) {
        units.push(b)
        i++
      } else {
        if (b >= 0xc2 && b <= 0xdf) {
          need = 1
          cp = b & 0x1f
        } else if (b >= 0xe0 && b <= 0xef) {
          need = 2
          cp = b & 0xf
          if (b === 0xe0) lower = 0xa0
          if (b === 0xed) upper = 0x9f
        } else if (b >= 0xf0 && b <= 0xf4) {
          need = 3
          cp = b & 0x7
          if (b === 0xf0) lower = 0x90
          if (b === 0xf4) upper = 0x8f
        } else {
          bad()
          i++
          continue
        }
        let j = 1
        for (; j <= need; j++) {
          const next = bytes[i + j]
          if (next === undefined && stream) {
            // Valid so far and cut off by the chunk: finish it next call.
            this.#pending = bytes.slice(i)
            break
          }
          if (next === undefined || next < lower || next > upper) {
            break
          }
          lower = 0x80
          upper = 0xbf
          cp = (cp << 6) | (next & 0x3f)
        }
        if (this.#pending.length) {
          break
        }
        if (j <= need) {
          bad()
          i += j
          continue
        }
        i += need + 1
        if (cp >= 0x10000) {
          cp -= 0x10000
          units.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
        } else {
          units.push(cp)
        }
      }
      if (units.length >= 0x4000) {
        flush()
      }
    }
    flush()
    return out
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_LOOKUP = new Map([...B64].map((ch, i) => [ch, i]))

const invalidCharacter = (message: string) => {
  const error = new Error(message)
  error.name = 'InvalidCharacterError'
  return error
}

/**
 * `btoa`: base64 of a binary string (every char code below 256).
 * @param data - The binary string.
 * @returns The base64 string.
 */
export const btoaPolyfill = (data: string): string => {
  const str = String(data)
  let out = ''
  for (let i = 0; i < str.length; i += 3) {
    const a = str.charCodeAt(i)
    const b = i + 1 < str.length ? str.charCodeAt(i + 1) : 0
    const c = i + 2 < str.length ? str.charCodeAt(i + 2) : 0
    if (a > 255 || b > 255 || c > 255) {
      throw invalidCharacter('btoa: string contains characters above U+00FF')
    }
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)]
    out += i + 1 < str.length ? B64[((b & 15) << 2) | (c >> 6)] : '='
    out += i + 2 < str.length ? B64[c & 63] : '='
  }
  return out
}

/**
 * `atob`: decodes base64 to a binary string. Accepts what the forgiving-base64
 * algorithm accepts: ASCII whitespace anywhere, and padding that is either
 * absent or correct.
 * @param data - The base64 string.
 * @returns The binary string.
 */
export const atobPolyfill = (data: string): string => {
  let str = String(data).replace(/[\t\n\f\r ]/g, '')
  if (str.length % 4 === 0) {
    str = str.replace(/={1,2}$/, '')
  }
  if (str.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(str)) {
    throw invalidCharacter('atob: the string is not valid base64')
  }
  let out = ''
  let bits = 0
  let count = 0
  for (const ch of str) {
    bits = (bits << 6) | (B64_LOOKUP.get(ch) ?? 0)
    count += 6
    if (count >= 8) {
      count -= 8
      out += String.fromCharCode((bits >> count) & 255)
    }
  }
  return out
}

/**
 * Base64 of raw bytes; the host contract's binary format.
 * @param bytes - The bytes.
 * @returns The base64 string.
 */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x4000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x4000))
  }
  return btoaPolyfill(binary)
}

/**
 * Raw bytes from base64; the host contract's binary format.
 * @param base64 - The base64 string.
 * @returns The bytes.
 */
export const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atobPolyfill(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

/**
 * Installs whatever of the above the global object lacks.
 */
export const installEncoding = () => {
  const g = globalThis as Record<string, unknown>
  g.TextEncoder ??= Utf8Encoder
  g.TextDecoder ??= Utf8Decoder
  g.btoa ??= btoaPolyfill
  g.atob ??= atobPolyfill
}
