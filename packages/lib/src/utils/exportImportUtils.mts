import type { NewEntry, UrlMatcher } from '../interfaces/Entry.mjs'
import type Entry from '../interfaces/Entry.mjs'
import type { SupportedAlgorithmsType } from './constants.mjs'
import type { EntryId } from '../interfaces/Entry.mjs'
import type { QrCodeLib } from '../interfaces/QrCodeLib.mjs'
import type { OpenPgpLib } from '../interfaces/OpenPgpLib.mjs'
import type { UrlParser } from '../interfaces/UrlParserLib.mjs'
import { ExportImportError } from '../FavaLibError.mjs'
import { EXPORT_VERSION } from '../version.mjs'
import { sanitiseInputSelector } from './entrySanitisation.mjs'
import {
  MAX_MATCHERS_PER_ENTRY,
  MAX_URL_LENGTH,
  parseMatcherSpec,
} from './matcherValidation.mjs'

/**
 * The most matchers to write into an exported uri.
 *
 * Every matcher adds characters to the qr code, and a dense enough qr stops
 * being scannable. The text and html exports are a backup format, not a sync
 * channel, so trimming here is cheaper than an unreadable code.
 */
const MAX_EXPORTED_MATCHERS = 4

/** The longest single encoded matcher to write into an exported uri. */
const MAX_EXPORTED_MATCHER_LENGTH = 200

/**
 * Determines the hashing algorithm based on the input string.
 * @param alg - The algorithm string to parse.
 * @returns The standardized algorithm name or null if unsupported.
 */
const parseOtpAlgorithm = (
  alg: string | null,
): null | SupportedAlgorithmsType => {
  if (!alg) {
    return 'SHA-1' // default algorithm
  }
  switch (alg.toLowerCase()) {
    case 'sha1':
    case 'sha-1':
    case 'algorithm.sha1':
      return 'SHA-1'
    case 'sha-256':
      return 'SHA-256'
    default:
      return null
  }
}

/**
 * Parses an OTP URI and extracts the relevant information to create a new entry.
 * @param parseUrl - The platform's URL parser.
 * @param otpUri - The OTP URI to parse.
 * @returns An object representing the new entry.
 * @throws {ExportImportError} If the URI is invalid or contains unsupported features.
 */
export const parseOtpUri = (parseUrl: UrlParser, otpUri: string): NewEntry => {
  if (!otpUri.startsWith('otpauth://')) {
    throw new ExportImportError('Invalid OTP URI')
  }
  const parsedUri = parseUrl(otpUri)
  if (!parsedUri) {
    throw new ExportImportError('Failed to parse URI')
  }

  const { scheme, host, path, query } = parsedUri
  if (scheme !== 'otpauth') {
    throw new ExportImportError(`Unsupported protocol "${scheme}"`)
  }
  if (host !== 'totp') {
    throw new ExportImportError(`Unsupported OTP type "${String(host)}"`)
  }
  const searchParams = new URLSearchParams(query ?? '')

  // some use /, some use :
  const splitOn = path[0].includes('/') ? '/' : ':'

  // ente double encodes its exports
  let [issuer, name]: (string | null)[] = decodeURIComponent(
    decodeURIComponent(path[0]),
  ).split(splitOn)
  const secret = searchParams.get('secret')
  const algorithm = parseOtpAlgorithm(searchParams.get('algorithm'))
  const digits = parseInt(searchParams.get('digits') ?? '6', 10)
  const period = parseInt(searchParams.get('period') ?? '30', 10)
  const matchers = searchParams
    .getAll('favaMatcher')
    .map((spec) => parseMatcherSpec(spec))
    // One unusable matcher must not cost the user the secret it came with.
    .filter((matcher): matcher is UrlMatcher => matcher !== null)
    .slice(0, MAX_MATCHERS_PER_ENTRY)
  const url = searchParams.get('favaUrl')
  const inputSelector = searchParams.get('favaInputSelector')

  // if searchParams has an issuer, use that
  if (searchParams.get('issuer')) {
    if (!name) {
      name = issuer
    }
    issuer = searchParams.get('issuer')
  }

  // validate
  if (!secret) {
    throw new ExportImportError('Invalid OTP URI: missing secret')
  }
  if (!algorithm) {
    throw new ExportImportError(
      `Unsupported algorithm "${searchParams.get('algorithm')}"`,
    )
  }

  return {
    name: name && name.length > 0 ? name : 'Imported Entry',
    issuer: issuer && issuer.length > 0 ? issuer : 'Unknown Issuer',
    type: 'TOTP',
    matchers,
    url: url && url.length <= MAX_URL_LENGTH ? url : null,
    inputSelector: sanitiseInputSelector(inputSelector),
    payload: {
      secret,
      algorithm,
      digits,
      period,
    },
  }
}

/**
 * Generates the otpauth:// URI for a single entry.
 * @param entry - The OTP entry.
 * @returns The otpauth:// URI string.
 */
export const generateOtpUrl = (entry: Entry) => {
  const {
    name,
    issuer,
    payload,
    matchers,
    url: entryUrl,
    inputSelector,
  } = entry
  const { secret, algorithm, digits, period } = payload

  // Note: Using manual encodeURIComponent instead of URLSearchParams because
  // URLSearchParams encodes spaces as '+' while encodeURIComponent uses '%20'.
  // OTP clients expect standard percent encoding (%20) for better compatibility.
  let url = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(name)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=${algorithm}&digits=${digits}&period=${period}`

  // Add the matching properties if they exist. Other authenticators ignore
  // query parameters they do not know, so these are safe to carry along.
  for (const matcher of matchers.slice(0, MAX_EXPORTED_MATCHERS)) {
    const spec = `${matcher.type}:${encodeURIComponent(matcher.value)}`
    if (spec.length <= MAX_EXPORTED_MATCHER_LENGTH) {
      url += `&favaMatcher=${spec}`
    }
  }
  if (entryUrl) {
    url += `&favaUrl=${encodeURIComponent(entryUrl)}`
  }
  if (inputSelector) {
    url += `&favaInputSelector=${encodeURIComponent(inputSelector)}`
  }

  return url
}

/**
 * Generates an HTML page with QR codes for the provided OTP entries.
 * @param qrGeneratorLib - The QR code generation library.
 * @param entries - An array of OTP entries.
 * @returns A promise that resolves to the HTML string.
 */
export const generateHtmlExport = async (
  qrGeneratorLib: QrCodeLib,
  entries: Entry[],
) => {
  const qrPromises = entries.map(async (entry) => {
    const { name, issuer } = entry
    const otpUrl = generateOtpUrl(entry)
    const qrCode = await qrGeneratorLib.toDataURL(otpUrl)
    return `
            <div class="entry">
              <img src="${qrCode}" alt="QR Code for ${name}">
              <p><strong>${name}</strong></p>
              <p>Issuer: ${issuer}</p>
            </div>
          `
  })

  const qrCodes = await Promise.all(qrPromises)
  return `
        <html>
          <head>
            <meta name="fava-export-version" content="${EXPORT_VERSION}">
            <style>
              .container { display: flex; flex-wrap: wrap; }
              .entry { margin: 10px; text-align: center; }
              img { width: 200px; height: 200px; }
            </style>
          </head>
          <body>
            <div class="container">
              ${qrCodes.join('')}
            </div>
          </body>
        </html>
      `
}

/**
 * Generates a text export of OTP URIs for the provided entries.
 * @param entries - An array of OTP entries.
 * @returns A version comment followed by the OTP URIs, one per line.
 */
export const generateTextExport = (entries: Entry[]) => {
  return [
    `# fava-export-version: ${EXPORT_VERSION}`,
    ...entries.map((entry) => generateOtpUrl(entry)),
  ].join('\n')
}

/**
 * Processes the lines of a text file containing OTP URIs and returns an array of objects, each containing the line number,
 * the EntryId or null if it was not a valid entry and the error if there was one.
 * @param lines - An array of strings, each containing an OTP URI.
 * @param importFromUri - A function that takes a URI and returns a promise that resolves to the EntryId.
 * @returns A promise that resolves to an array of objects, each containing the line number,
 *          the EntryId or null if it was not a valid entry and the error if there was one.
 */
export const processImportLines = async (
  lines: string[],
  importFromUri: (uri: string) => Promise<EntryId>,
): Promise<{ lineNr: number; entryId: EntryId | null; error: unknown }[]> => {
  return Promise.all(
    lines
      // The version is informational; accept any numeric version and legacy
      // exports without a marker. Do not send metadata to the OTP URI parser.
      .filter(
        (line) =>
          line !== '' && !/^# fava-export-version: \d+$/.test(line.trim()),
      )
      .map(async (line, lineNr) => {
        try {
          return {
            lineNr,
            entryId: await importFromUri(line),
            error: null,
          }
        } catch (err) {
          return { lineNr, entryId: null, error: err }
        }
      }),
  )
}

/**
 * Encrypts the given data using OpenPGP.
 * @param openPgpLib - The OpenPGP library.
 * @param data - The data to encrypt.
 * @param password - The password to use for encryption.
 * @returns A promise that resolves to the encrypted data.
 */
export const encryptExport = async (
  openPgpLib: OpenPgpLib,
  data: string,
  password: string,
): Promise<string> => {
  return openPgpLib.encrypt(data, password)
}

/**
 * Decrypts the given data using OpenPGP.
 * @param openPgpLib - The OpenPGP library.
 * @param data - The data to decrypt.
 * @param password - The password to use for decryption.
 * @returns A promise that resolves to the decrypted data.
 */
export const decryptExport = async (
  openPgpLib: OpenPgpLib,
  data: string,
  password: string,
): Promise<string> => {
  return openPgpLib.decrypt(data, password)
}
