/**
 * The regular expressions behind the otp-field heuristic, and the text
 * normalisation they run against.
 *
 * ## Provenance and licensing
 *
 * `OTP_FIELD_RE` and `SOCIAL_SECURITY_RE` are taken verbatim from Chromium,
 * which is BSD-3-Clause and so compatible with this repo. `CARD_CVC_RE` is a
 * deliberately narrowed *subset* of a Chromium regex; see its comment.
 * Everything else here is ours.
 *
 * Bitwarden's clients repo solves the same problem and was consulted only for
 * what signals are worth having at all. It is GPL-3.0, publishing an extension
 * to a web store is distribution, and this package is ISC-compatible -- so not
 * a line of it is reproduced here, in this file or any other.
 *
 * Chromium sources:
 *   components/password_manager/core/common/password_manager_constants.h
 *     -- kOneTimePwdRe, kSocialSecurityRe
 *   components/autofill/core/common/autofill_regex_constants.h
 *     -- kCardCvcRe
 *
 *   Copyright 2015 The Chromium Authors
 *
 *   Redistribution and use in source and binary forms, with or without
 *   modification, are permitted provided that the following conditions are
 *   met:
 *
 *      * Redistributions of source code must retain the above copyright
 *   notice, this list of conditions and the following disclaimer.
 *      * Redistributions in binary form must reproduce the above
 *   copyright notice, this list of conditions and the following disclaimer
 *   in the documentation and/or other materials provided with the
 *   distribution.
 *      * Neither the name of Google LLC nor the names of its
 *   contributors may be used to endorse or promote products derived from
 *   this software without specific prior written permission.
 *
 *   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 *   "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 *   LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 *   A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 *   OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 *   SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 *   LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 *   DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 *   THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 *   (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 *   OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * The Chromium originals are RE2 sources, made case-insensitive by option
 * rather than by an inline flag; every construct in them is also valid
 * javascript, so they are reproduced as-is with the `i` flag added.
 * @module
 */

/**
 * The longest string any regex here is run against.
 *
 * `matcherValidation.mts` in favalib caps its subjects for the same reason:
 * backtracking cost is superlinear in subject length, and a page is free to
 * put a megabyte in an `aria-label`. Nothing legitimate is lost -- a field
 * name that needs more than this to be recognised was not going to be.
 */
export const MAX_SIGNAL_LENGTH = 256

/**
 * Chromium's `kOneTimePwdRe`, verbatim.
 *
 * Its own inline comments, worth keeping in mind when reading a match:
 * "one time" is a good signal on its own; the short main tokens (otp, otc,
 * totp, sms, 2fa, mfa) need word boundaries or a companion token around them;
 * "code" is weak alone but strong next to "verification".
 */
export const OTP_FIELD_RE =
  /one.?time|(?:\b|_)(?:otp|otc|totp|sms|2fa|mfa)(?:\b|_)|(?:otp|otc|totp|sms|2fa|mfa).?(?:code|token|input|val|pin|login|verif|pass|pwd|psw|auth|field)|(?:verif(?:y|ication)?|email|phone|text|login|input|txt|user).?(?:otp|otc|totp|sms|2fa|mfa)|sms.?otp|mfa.?otp|verif(?:y|ication)?.?code|(?:\b|_)vcode|(?:second|two|2).?factor|wfls-token|email_code/i

/**
 * Wording that Chromium's regex misses, and that real second-factor screens
 * use constantly. Ours, not Chromium's.
 *
 * `kOneTimePwdRe` has no `auth.?code` alternative at all -- `auth` appears in
 * it only as a companion *after* a main token, as in `otp_auth`. So
 * "Authentication code", which is the literal label on GitHub's 2fa prompt
 * and a dozen others, matches nothing. Chromium can live with that because it
 * only needs to know a field is *not* a password; we need to know it *is* a
 * totp field, which is a higher bar.
 *
 * Kept as its own constant rather than spliced into `OTP_FIELD_RE` so that
 * what is Chromium's and what is ours stays legible -- and so that a false
 * positive traced here can be tuned without touching the verbatim source.
 */
export const OTP_FIELD_EXTRA_RE =
  /auth(?:entication)?.?code|authenticator|passcode|\d\s?.?digit.?(?:code|pin)|digit.?code|confirmation.?code|security.?token/i

/** Chromium's `kSocialSecurityRe`, verbatim. */
export const SOCIAL_SECURITY_RE = /ssn|social.?security.?(num(ber)?|#)*/i

/**
 * A narrowed subset of Chromium's `kCardCvcRe`: the alternatives that can
 * only ever mean a payment card.
 *
 * The full `kCardCvcRe` also carries bare `verification`, `security.?code`
 * and `security.?number`, which collide head-on with `OTP_FIELD_RE`'s
 * `verif(?:y|ication)?.?code`. Chromium can afford that collision because it
 * is using the regex to *exclude* otp fields from password parsing; we want
 * the opposite answer from the same words. So the ambiguous alternatives are
 * dropped here and resolved by form context instead -- see
 * `looksLikePaymentContext` in `scoreField.ts`.
 *
 * `cid` keeps Chromium's word boundaries: unanchored it is a substring of
 * "cidade".
 */
export const CARD_CVC_RE =
  /(?:\b|_)(?:cvn|cvv|cvc|csc|cvd|ccv)(?:\b|_)|card.?identification|card.?security|card.?code|c-v-v|cccid|\bcid\b|karten.?prüfn|código de seg/i

/**
 * Names that mark a form as a payment form.
 *
 * Used only for context: it is what tells "security code" next to a card
 * number apart from "security code" on a login screen. Ours.
 */
export const CARD_FIELD_RE =
  /card.?number|cardnum|ccnum|credit.?card|(?:\b|_)(?:exp|expiry|expiration).?(?:date|month|year)/i

/**
 * Recovery and backup codes -- the highest-value exclusion here.
 *
 * A recovery-code box is a genuine second-factor field and looks identical to
 * a totp box on every signal we have: same length, same numeric-ish input,
 * often the same form. The only thing separating them is the word, and
 * filling one with a totp code burns a recovery code for nothing.
 *
 * Deliberately avoids `one.?time.?use`, which collides with `OTP_FIELD_RE`'s
 * first alternative.
 */
export const RECOVERY_CODE_RE =
  /(?:\b|_)(?:recovery|backup|scratch|emergency|fallback)(?:\b|_)|backup.?code|recovery.?key/i

/** Discount and referral codes, which are short, alphanumeric and everywhere. */
export const PROMO_CODE_RE =
  /coupon|promo(?:tion)?|discount|voucher|gift.?(?:card|code)|referral|invite.?code|redeem/i

/** Captchas, including the well-known widget field names. */
export const CAPTCHA_RE = /captcha|turnstile|g-recaptcha|h-captcha/i

/**
 * Postcodes. Structurally indistinguishable from a totp field -- short,
 * numeric, `inputmode="numeric"` -- so the word is the only thing to go on.
 */
export const POSTCODE_RE = /(?:\b|_)(?:zip|postal|postcode|post.?code)(?:\b|_)/i

/** Phone-number parts, which are also short and numeric. */
export const PHONE_PART_RE = /(?:\b|_)(?:area|country|dial)(?:\b|_)?.?code/i

/** A `pattern` attribute that admits only a bounded run of digits. */
export const DIGIT_PATTERN_RE =
  /^\^?(?:\\d|\[0-9\])(?:\{\d+(?:,\d*)?\}|\*|\+)?\$?$/

/**
 * Splits camel humps, so that `otpCode` reads as two words.
 *
 * This matters more than it looks. `OTP_FIELD_RE` leans on `\b` and `_` for
 * its short tokens, and `\b` never fires mid-hump: `otpNumber` matches no
 * alternative at all until it becomes `otp number`.
 *
 * Deliberately only letter-to-letter. Splitting at letter/digit transitions
 * as well would turn `login2FA` into `login2 FA` and destroy the `2fa` token,
 * which is the opposite of the point.
 */
const splitCamelHumps = (value: string): string =>
  value.replace(/([a-z])([A-Z])/g, '$1 $2')

/**
 * Folds a raw attribute value into the form the regexes expect: camel humps
 * split, lowercased, punctuation and runs of whitespace reduced to single
 * spaces.
 * @param value - The raw attribute or text value.
 * @returns The normalised value, bounded to `MAX_SIGNAL_LENGTH`.
 */
export const normaliseSignal = (value: string): string =>
  splitCamelHumps(value.slice(0, MAX_SIGNAL_LENGTH))
    .toLowerCase()
    .replace(/[-_.:/\\[\]()+,#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Tests a regex against a raw value, both as-is and normalised.
 *
 * Both forms are needed. Normalisation is what lets `otpNumber` match at all,
 * but it also flattens `-` and `_` to spaces, which would lose
 * `OTP_FIELD_RE`'s two literal alternatives `wfls-token` and `email_code`.
 * Testing both costs one extra pass over a string bounded at 256 characters
 * and keeps every alternative reachable.
 * @param re - The pattern to test.
 * @param value - The raw value.
 * @returns Whether either form matches.
 */
export const matchesSignal = (re: RegExp, value: string): boolean => {
  if (value === '') return false
  const bounded = value.slice(0, MAX_SIGNAL_LENGTH)
  return re.test(bounded) || re.test(normaliseSignal(bounded))
}

/**
 * Tests a regex against every one of several raw values.
 * @param re - The pattern to test.
 * @param values - The raw values.
 * @returns Whether any value matches in either form.
 */
export const matchesAnySignal = (
  re: RegExp,
  values: readonly string[],
): boolean => values.some((value) => matchesSignal(re, value))

/**
 * Whether a value names an otp field, by either pattern.
 * @param value - The raw attribute or text value.
 * @returns Whether it matches Chromium's pattern or our supplement.
 */
export const matchesOtpField = (value: string): boolean =>
  matchesSignal(OTP_FIELD_RE, value) || matchesSignal(OTP_FIELD_EXTRA_RE, value)

/**
 * Whether any of several values names an otp field.
 * @param values - The raw values.
 * @returns Whether any matches.
 */
export const matchesAnyOtpField = (values: readonly string[]): boolean =>
  values.some(matchesOtpField)
