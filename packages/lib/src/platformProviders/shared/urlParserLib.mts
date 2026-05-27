import type { ParsedOtpUrl, UrlParser } from '../../interfaces/UrlParserLib.mjs'

/**
 * URL parser built on the standard, spec-compliant `URL` global, suitable for
 * browsers and Node (both ship a complete implementation).
 *
 * This deliberately avoids the `whatwg-url` polyfill: its bundled
 * `webidl-conversions` dereferences `SharedArrayBuffer` at module-load time,
 * which throws `ReferenceError: SharedArrayBuffer is not defined` in browsers
 * that aren't cross-origin isolated (the common case).
 * @param uri - The otpauth URI to parse.
 * @returns The parsed OTP URL, or null if the URI could not be parsed.
 */
export const nativeUrlParser: UrlParser = (
  uri: string,
): ParsedOtpUrl | null => {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }

  return {
    scheme: url.protocol.replace(/:$/, ''),
    host: url.hostname,
    // Match the raw, percent-encoded path-segment array `whatwg-url` produced.
    path: url.pathname.replace(/^\//, '').split('/'),
    query: url.search ? url.search.slice(1) : null,
  }
}

export default nativeUrlParser
