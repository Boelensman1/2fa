import type Entry from '../interfaces/Entry.mjs'
import type { TotpPayload } from '../interfaces/Entry.mjs'
import {
  MAX_INPUT_SELECTOR_LENGTH,
  MAX_MATCHERS_PER_ENTRY,
  MAX_URL_LENGTH,
  validateUrlMatcher,
} from './matcherValidation.mjs'

const MAX_NAME_LENGTH = 256
const MAX_PERIOD_SECONDS = 3600
const MIN_DIGITS = 4
const MAX_DIGITS = 10

/**
 * Checks that a value is a string within a length limit.
 * @param value - The value to check.
 * @param maxLength - The longest the value may be.
 * @returns True when the value is a usable non-empty string.
 */
const isBoundedString = (value: unknown, maxLength: number): boolean =>
  typeof value === 'string' && value.length > 0 && value.length <= maxLength

/**
 * Checks the payload of a TOTP entry.
 * @param payload - The payload to check, which may be anything at all.
 * @returns Null when the payload is usable, otherwise the reason it is not.
 */
const validateTotpPayload = (payload: unknown): string | null => {
  if (typeof payload !== 'object' || payload === null) {
    return 'payload is missing'
  }

  const { secret, period, digits, algorithm } = payload as Partial<TotpPayload>

  if (typeof secret !== 'string' || secret.length === 0) {
    return 'payload.secret is missing'
  }
  if (
    typeof period !== 'number' ||
    !Number.isFinite(period) ||
    period <= 0 ||
    period > MAX_PERIOD_SECONDS
  ) {
    return 'payload.period is out of range'
  }
  if (
    typeof digits !== 'number' ||
    !Number.isInteger(digits) ||
    digits < MIN_DIGITS ||
    digits > MAX_DIGITS
  ) {
    return 'payload.digits is out of range'
  }
  // Deliberately not checked against SUPPORTED_ALGORITHMS: a peer running a
  // newer version must not have its entries vaporised here. Token generation
  // rejects an unsupported algorithm with a clear error at the point of use.
  if (typeof algorithm !== 'string' || algorithm.length === 0) {
    return 'payload.algorithm is missing'
  }

  return null
}

/**
 * Checks the parts of an entry without which it is simply unusable.
 *
 * This is the tier applied to entries arriving from a peer. Anything that can
 * be repaired by dropping a field is deliberately *not* checked here:
 * `CommandManager.processRemoteCommands` drops a failing remote command and
 * never retries it, so a strict check would lose the entry permanently.
 * @param raw - The entry to check, which may be anything at all.
 * @returns Null when the entry is usable, otherwise the reason it is not.
 */
export const validateEntryFatal = (raw: unknown): string | null => {
  if (typeof raw !== 'object' || raw === null) {
    return 'entry is not an object'
  }

  const entry = raw as Partial<Entry>

  if (typeof entry.id !== 'string' || entry.id.length === 0) {
    return 'entry has no id'
  }
  if (!isBoundedString(entry.name, MAX_NAME_LENGTH)) {
    return 'entry has no usable name'
  }
  if (!isBoundedString(entry.issuer, MAX_NAME_LENGTH)) {
    return 'entry has no usable issuer'
  }
  if (!isBoundedString(entry.type, MAX_NAME_LENGTH)) {
    return 'entry has no type'
  }
  if (entry.type === 'TOTP') {
    const payloadReason = validateTotpPayload(entry.payload)
    if (payloadReason) {
      return payloadReason
    }
  }
  if (
    typeof entry.addedAt !== 'number' ||
    !Number.isFinite(entry.addedAt) ||
    entry.addedAt <= 0
  ) {
    return 'entry has no addedAt'
  }
  if (
    entry.updatedAt !== null &&
    entry.updatedAt !== undefined &&
    (typeof entry.updatedAt !== 'number' || !Number.isFinite(entry.updatedAt))
  ) {
    return 'entry has an invalid updatedAt'
  }
  if (entry.matchers !== undefined && !Array.isArray(entry.matchers)) {
    return 'entry.matchers is not an array'
  }

  return null
}

/**
 * Checks an entry fully, matching fields included.
 *
 * This is the tier applied to entries originating on this device, where a
 * problem can still be shown to the user who caused it.
 * @param raw - The entry to check, which may be anything at all.
 * @returns Null when the entry is usable, otherwise the reason it is not.
 */
export const validateEntryStrict = (raw: unknown): string | null => {
  const fatalReason = validateEntryFatal(raw)
  if (fatalReason) {
    return fatalReason
  }

  const entry = raw as Partial<Entry>

  if (entry.matchers !== undefined) {
    if (entry.matchers.length > MAX_MATCHERS_PER_ENTRY) {
      return `entry has more than ${MAX_MATCHERS_PER_ENTRY} matchers`
    }
    for (const matcher of entry.matchers) {
      const matcherReason = validateUrlMatcher(matcher)
      if (matcherReason) {
        return matcherReason
      }
    }
  }
  if (
    entry.url !== null &&
    entry.url !== undefined &&
    !isBoundedString(entry.url, MAX_URL_LENGTH)
  ) {
    return `entry.url is empty or exceeds ${MAX_URL_LENGTH} characters`
  }
  if (
    entry.inputSelector !== null &&
    entry.inputSelector !== undefined &&
    (!isBoundedString(entry.inputSelector, MAX_INPUT_SELECTOR_LENGTH) ||
      /[\r\n]/.test(entry.inputSelector))
  ) {
    return `entry.inputSelector is empty, contains a newline, or exceeds ${MAX_INPUT_SELECTOR_LENGTH} characters`
  }

  return null
}
