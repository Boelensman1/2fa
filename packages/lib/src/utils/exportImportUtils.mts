import type { NewEntry } from '../interfaces/Entry.mjs'
import type Entry from '../interfaces/Entry.mjs'
import type { SupportedAlgorithmsType } from './constants.mjs'
import type { EntryId } from '../interfaces/Entry.mjs'
import { ExportImportError } from '../TwoFALibError.mjs'

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
 * @param UrlParser - The URL parsing library.
 * @param otpUri - The OTP URI to parse.
 * @returns An object representing the new entry.
 * @throws ExportImportError if the URI is invalid or contains unsupported features.
 */
export const parseOtpUri = (
  UrlParser: typeof import('whatwg-url'),
  otpUri: string,
): NewEntry => {
  if (!otpUri.startsWith('otpauth://')) {
    throw new ExportImportError('Invalid OTP URI')
  }
  const parsedUri = UrlParser.parseURL(otpUri)
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
    payload: {
      secret,
      algorithm,
      digits,
      period,
    },
  }
}

const generateOtpUrl = (entry: Entry) => {
  const { name, issuer, payload } = entry
  const { secret, algorithm, digits, period } = payload

  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(name)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=${algorithm}&digits=${digits}&period=${period}`
}

/**
 * Generates an HTML page with QR codes for the provided OTP entries.
 * @param qrGeneratorLib - The QR code generation library.
 * @param entries - An array of OTP entries.
 * @returns A promise that resolves to the HTML string.
 */
export const generateHtmlExport = async (
  qrGeneratorLib: typeof import('qrcode'),
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
 * @returns A string containing the OTP URIs, one per line.
 */
export const generateTextExport = (entries: Entry[]) => {
  return entries
    .map((entry) => {
      return generateOtpUrl(entry)
    })
    .join('\n')
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
      .filter((line) => line !== '')
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
  openPgpLib: typeof import('openpgp'),
  data: string,
  password: string,
): Promise<string> => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const encrypted = await openPgpLib.encrypt({
    message: await openPgpLib.createMessage({ text: data }),
    passwords: [password],
    format: 'armored',
  })
  return encrypted as string
}

/**
 * Decrypts the given data using OpenPGP.
 * @param openPgpLib - The OpenPGP library.
 * @param data - The data to decrypt.
 * @param password - The password to use for decryption.
 * @returns A promise that resolves to the decrypted data.
 */
export const decryptExport = async (
  openPgpLib: typeof import('openpgp'),
  data: string,
  password: string,
): Promise<string> => {
  const decrypted = await openPgpLib.decrypt({
    message: await openPgpLib.readMessage({ armoredMessage: data }),
    passwords: [password],
  })
  return decrypted.data as string
}
