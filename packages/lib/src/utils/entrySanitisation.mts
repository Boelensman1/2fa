import type Entry from '../interfaces/Entry.mjs'
import type { UrlMatcher } from '../interfaces/Entry.mjs'
import {
  MAX_INPUT_SELECTOR_LENGTH,
  MAX_MATCHERS_PER_ENTRY,
  MAX_URL_LENGTH,
  validateUrlMatcher,
} from './matcherValidation.mjs'

/**
 * Keeps only the matchers that are usable.
 *
 * Malformed matchers are dropped rather than rejected. A remote command that
 * throws is dropped by `CommandManager.processRemoteCommands` and never
 * retried, so refusing a whole entry over one bad matcher would lose that
 * entry on this device permanently.
 * @param matchers - The matchers to filter, which may be anything at all.
 * @returns The usable matchers, capped at `MAX_MATCHERS_PER_ENTRY`.
 */
const sanitiseMatchers = (matchers: unknown): UrlMatcher[] => {
  if (!Array.isArray(matchers)) {
    return []
  }

  return (matchers as unknown[])
    .filter((matcher) => validateUrlMatcher(matcher) === null)
    .slice(0, MAX_MATCHERS_PER_ENTRY)
    .map((matcher) => {
      const { type, value } = matcher as UrlMatcher
      return { type, value }
    })
}

/**
 * Keeps a string field only when it is within its length limit.
 * @param value - The value to check, which may be anything at all.
 * @param maxLength - The longest the value may be.
 * @param rejectNewlines - Whether a value containing a newline should be dropped.
 * @returns The value, or null when it is unusable.
 */
const sanitiseOptionalString = (
  value: unknown,
  maxLength: number,
  rejectNewlines = false,
): string | null => {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }
  if (value.length > maxLength) {
    return null
  }
  if (rejectNewlines && /[\r\n]/.test(value)) {
    return null
  }
  return value
}

/**
 * Drops an unusable selector before it reaches strict entry validation.
 * @param value - The selector to check, which may be anything at all.
 * @returns The selector, or null when it is empty, too long, or contains CR/LF.
 */
export const sanitiseInputSelector = (value: unknown): string | null =>
  sanitiseOptionalString(value, MAX_INPUT_SELECTOR_LENGTH, true)

/**
 * Repairs the matching fields of an entry that may have come from somewhere
 * untrusted: a peer's sync command, or an imported otpauth uri.
 *
 * Total, never throws, and idempotent, so it is safe to run on every entry
 * entering the vault regardless of where it came from.
 * @param entry - The entry to sanitise.
 * @returns The entry, with unusable matching fields dropped.
 */
export const sanitiseEntry = (entry: Entry): Entry => {
  const loose = entry as Entry & Record<string, unknown>

  return {
    ...entry,
    matchers: sanitiseMatchers(loose.matchers),
    url: sanitiseOptionalString(loose.url, MAX_URL_LENGTH),
    inputSelector: sanitiseInputSelector(loose.inputSelector),
  }
}

export default sanitiseEntry
