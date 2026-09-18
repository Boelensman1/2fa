/**
 * How long a log message may be once it reaches a consumer.
 *
 * A log event is one line by contract, and almost every message in the sync
 * path interpolates something a peer or the server chose. Those are bounded
 * individually -- a deviceId, a deviceType and a deviceFriendlyName are 256
 * characters each -- but several of them land in the same sentence, so the cap
 * is what keeps one hostile record from turning a single notice into a
 * screenful the real message scrolls off the top of.
 */
export const MAX_LOG_MESSAGE_LENGTH = 1024

/**
 * Characters replaced by a space: control characters and the two line
 * separators.
 *
 * A space rather than nothing, so that stripping a tab out of `a\tb` leaves two
 * words rather than one. This is the half that carries the actual risk: an ESC
 * here is the start of an ANSI sequence that can repaint the line it is printed
 * on, and a carriage return can hide everything before it.
 */
const TO_SPACE = /[\p{Cc}\p{Zl}\p{Zp}]/gu

/**
 * Characters removed outright: zero-width and bidirectional formatting.
 *
 * Nothing here has a legitimate use in a device name or an error message, and a
 * bidi override can reorder the digits of the fingerprint the user is being
 * asked to compare -- the one thing in the message that is worth trusting. ZWJ
 * (U+200D) is deliberately absent: it holds emoji sequences together, and a
 * name is allowed to be an emoji.
 */
const TO_NOTHING =
  /[\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu

/**
 * Whitespace that is ordinary rather than evidence.
 *
 * A tab or a newline in a message means something wrapped, which is normal and
 * gets quietly collapsed. A carriage return, an ESC, a NUL or a bidi override
 * means someone put it there. Removed before the check below so that
 * `\p{Cc}` can be asked about everything else, which is also what keeps a
 * literal control character out of a regex in this file.
 */
const BENIGN_WHITESPACE = /[\t\n]/gu

/**
 * Whether a string holds anything that had to be removed before printing.
 *
 * Separate from `sanitiseForDisplay` rather than a second return value,
 * because the two answer different questions: one produces the string to show,
 * the other is evidence about whoever sent it. Truncation and whitespace
 * collapsing are deliberately not unsafe -- a long name is ordinary.
 * @param value - The string to examine.
 * @returns True when the string contains something that must not be printed.
 */
export const containsUnsafeText = (value: string): boolean =>
  new RegExp(TO_NOTHING.source, 'u').test(value) ||
  /[\p{Cc}\p{Zl}\p{Zp}]/u.test(value.replace(BENIGN_WHITESPACE, ''))

/**
 * Reduces a string that may have come from a peer to something safe to print.
 *
 * Sanitising, not escaping: a consumer may write this straight to a terminal,
 * and there is no one escaping convention that is right for a terminal, a
 * devtools console and a JSON document at once. Nothing removed here can be
 * part of a name or a message a user meant to read.
 * @param value - The string to clean.
 * @param maxLength - The longest the result may be, ellipsis included.
 * @returns The cleaned string, no longer than `maxLength`.
 */
export const sanitiseForDisplay = (
  value: string,
  maxLength: number,
): string => {
  const cleaned = value
    .replace(TO_NOTHING, '')
    .replace(TO_SPACE, ' ')
    // Collapsed after the two replacements above, so that a run of stripped
    // characters does not leave a run of spaces behind.
    .replace(/\s+/gu, ' ')
    .trim()

  if (cleaned.length <= maxLength) {
    return cleaned
  }
  // The ellipsis is part of the budget: a caller asking for 48 characters gets
  // 48, not 49.
  return `${cleaned.slice(0, Math.max(maxLength - 1, 0))}…`
}
