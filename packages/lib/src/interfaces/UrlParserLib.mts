/**
 * The components of a parsed OTP URI that the importer needs.
 *
 * Mirrors the shape that `whatwg-url`'s `parseURL` produced, so that any
 * platform can supply an equivalent parser.
 */
export interface ParsedOtpUrl {
  /** The URI scheme, e.g. "otpauth" (without the trailing colon). */
  scheme: string
  /** The host / authority, e.g. "totp". */
  host: string
  /** The raw (percent-encoded) path segments. */
  path: string[]
  /** The query string without the leading "?", or null when absent. */
  query: string | null
}

/**
 * Parses an OTP URI into its components, or returns null when the URI cannot be
 * parsed.
 *
 * Provided per-platform: browsers and Node use the spec-compliant native `URL`,
 * while environments without a reliable native `URL` (e.g. some mobile JS
 * engines) can inject their own implementation (e.g. backed by `whatwg-url`).
 */
export type UrlParser = (uri: string) => ParsedOtpUrl | null

export default UrlParser
