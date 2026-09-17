/**
 * The otp-field heuristic itself: plain data in, a verdict out.
 *
 * No dom, no imports beyond the patterns and the signal shape. See
 * `signals.ts` for why the seam is here.
 * @module
 */

import {
  CAPTCHA_RE,
  CARD_CVC_RE,
  DIGIT_PATTERN_RE,
  PHONE_PART_RE,
  POSTCODE_RE,
  PROMO_CODE_RE,
  RECOVERY_CODE_RE,
  SOCIAL_SECURITY_RE,
  matchesAnyOtpField,
  matchesAnySignal,
} from './patterns'
import { describingText, identifyingText } from './signals'
import type { FieldSignals } from './signals'
import type {
  DetectionReason,
  DetectionReasonCode,
  OtpConfidence,
} from './types'

/** The `autocomplete` token that settles the question outright. */
export const ONE_TIME_CODE_TOKEN = 'one-time-code'

/**
 * `autocomplete` tokens that say the field is something else.
 *
 * A field that declares itself is believed, in both directions. `cc-` is
 * matched as a prefix so the whole payment vocabulary is covered by one rule.
 */
const REJECTING_AUTOCOMPLETE_TOKENS = new Set([
  'postal-code',
  'email',
  'tel',
  'tel-national',
  'username',
  'current-password',
  'new-password',
  'name',
  'given-name',
  'family-name',
  'street-address',
  'organization',
])

/** Points at which a total becomes each confidence band. */
export const LIKELY_THRESHOLD = 60
export const POSSIBLE_THRESHOLD = 35

/**
 * Per-family caps.
 *
 * The signals within a family are heavily correlated: a field with
 * `inputmode="numeric"` almost always also carries a digit `pattern` and a
 * `maxlength`. Summing them uncapped triple-counts a single underlying fact
 * and lets three restatements of "this box holds a short number" outweigh the
 * page actually saying "authentication code". Capping each family keeps a
 * verdict a vote across independent kinds of evidence rather than a tally of
 * however many attributes the author happened to set.
 */
const TEXTUAL_CAP = 60
const STRUCTURAL_CAP = 40
const CONTEXTUAL_CAP = 25

export interface ScoreResult {
  verdict: 'reject' | 'candidate'
  score: number
  /** Null exactly when rejected, or when the score cleared no threshold. */
  confidence: OtpConfidence | null
  reasons: DetectionReason[]
}

const reject = (code: DetectionReasonCode, detail?: string): ScoreResult => ({
  verdict: 'reject',
  score: 0,
  confidence: null,
  reasons: [{ code, weight: 0, ...(detail === undefined ? {} : { detail }) }],
})

/** Sums a family's reasons, applying its cap. */
const capped = (reasons: DetectionReason[], cap: number): number =>
  Math.min(
    cap,
    reasons.reduce((total, reason) => total + reason.weight, 0),
  )

/**
 * Scores one candidate field.
 *
 * Rejections come first and are absolute: a veto is not negative points,
 * because a recovery-code box with six numeric digits and a "code" label
 * would otherwise out-score a real otp field on a plainer page.
 * @param signals - The flattened description of the field.
 * @returns The verdict, the total, and every reason that fed into it.
 */
export const scoreCandidate = (signals: FieldSignals): ScoreResult => {
  const tokens = signals.autocompleteTokens
  const naming = identifyingText(signals)
  const describing = describingText(signals)
  const textual = [...naming, ...describing, signals.nearbyText]

  if (signals.type === 'hidden') return reject('rejectedAutocomplete', 'hidden')

  const rejectingToken = tokens.find(
    (token) =>
      REJECTING_AUTOCOMPLETE_TOKENS.has(token) || token.startsWith('cc-'),
  )
  // ...unless the same attribute also claims one-time-code, which is legal and
  // is what conditional-ui sites emit: "section-login one-time-code webauthn".
  const declaresOneTimeCode = tokens.includes(ONE_TIME_CODE_TOKEN)
  if (rejectingToken !== undefined && !declaresOneTimeCode) {
    return reject('rejectedAutocomplete', rejectingToken)
  }

  if (!declaresOneTimeCode) {
    if (matchesAnySignal(RECOVERY_CODE_RE, textual)) {
      // A real second factor, and one a totp code must never be typed into:
      // filling it burns a recovery code to no effect.
      return reject('rejectedRecoveryCode')
    }
    if (matchesAnySignal(CARD_CVC_RE, textual)) return reject('rejectedCardCvc')
    if (matchesAnySignal(SOCIAL_SECURITY_RE, textual)) {
      return reject('rejectedSocialSecurity')
    }
    if (matchesAnySignal(CAPTCHA_RE, textual)) return reject('rejectedCaptcha')
    if (matchesAnySignal(PROMO_CODE_RE, textual)) {
      return reject('rejectedPromoCode')
    }
    if (matchesAnySignal(POSTCODE_RE, textual))
      return reject('rejectedPostcode')
    if (matchesAnySignal(PHONE_PART_RE, textual)) {
      return reject('rejectedPhonePart')
    }

    // A cvc is three or four characters and a totp is six or eight. Four stays
    // ambiguous -- amex cvcs and some sms codes are both four -- so only three
    // is decisive.
    if (signals.maxLength === 3) return reject('rejectedCardCvc', 'maxLength 3')

    // What is left of the cvc collision is the wording Chromium's kCardCvcRe
    // shares with its otp regex -- bare "verification", "security code" -- and
    // the only thing that separates those two readings is the form around
    // them. A payment form containing a genuine totp field is rare enough, and
    // filling a cvc box with a totp code bad enough, that the tie goes to the
    // card. A site that really does both can say so with autocomplete, which
    // is checked above.
    if (signals.formHasCreditCardField) return reject('rejectedPaymentContext')
  }

  if (declaresOneTimeCode) {
    return {
      verdict: 'candidate',
      score: 100,
      confidence: 'definite',
      reasons: [
        {
          code: 'autocompleteOneTimeCode',
          weight: 100,
          detail: tokens.join(' '),
        },
      ],
    }
  }

  const textualReasons: DetectionReason[] = []
  // Weighted above the `likely` threshold on its own. A `name` or `id` is an
  // author-chosen identifier rather than prose: nobody calls a field `otp`
  // except on purpose, so a name match needs no corroboration. A visible
  // label is nearly as good but shares its vocabulary with the rest of the
  // page, so it sits just under the bar and wants one more signal.
  if (matchesAnyOtpField(naming)) {
    textualReasons.push({ code: 'nameMatchesOtp', weight: 60 })
  }
  if (matchesAnyOtpField(describing)) {
    textualReasons.push({ code: 'labelMatchesOtp', weight: 45 })
  }
  if (matchesAnyOtpField([signals.nearbyText])) {
    textualReasons.push({ code: 'nearbyTextMatchesOtp', weight: 15 })
  }
  if (matchesAnyOtpField([signals.formAccessibleName])) {
    textualReasons.push({ code: 'formNameMatchesOtp', weight: 15 })
  }

  const structuralReasons: DetectionReason[] = []
  if (signals.maxLength === 6) {
    structuralReasons.push({ code: 'maxLengthSix', weight: 25 })
  } else if (
    signals.maxLength !== null &&
    signals.maxLength >= 4 &&
    signals.maxLength <= 8
  ) {
    structuralReasons.push({ code: 'maxLengthTypical', weight: 20 })
  }
  if (signals.inputMode === 'numeric' || signals.inputMode === 'tel') {
    structuralReasons.push({ code: 'inputModeNumeric', weight: 15 })
  }
  if (signals.pattern !== null && DIGIT_PATTERN_RE.test(signals.pattern)) {
    structuralReasons.push({ code: 'digitPattern', weight: 15 })
  }
  if (['text', 'tel', 'number'].includes(signals.type)) {
    structuralReasons.push({ code: 'plausibleType', weight: 5 })
  }

  const contextualReasons: DetectionReason[] = []
  if (signals.segmentCount > 1) {
    contextualReasons.push({
      code: 'segmentedGroup',
      weight: 15,
      detail: String(signals.segmentCount),
    })
  }
  if (
    signals.isOnlyTextInputInForm &&
    matchesAnyOtpField([signals.formAccessibleName])
  ) {
    contextualReasons.push({ code: 'soleFieldInOtpForm', weight: 20 })
  }
  if (signals.formHasPasswordField && signals.type !== 'password') {
    // A form holding both a password and something else short and numeric is
    // the classic single-page "password + code" login.
    contextualReasons.push({ code: 'siblingPasswordField', weight: 10 })
  }

  // A masked field with nothing textual behind it is a password, and saying so
  // outright beats deducting a magic number from it. The reverse case is real
  // and must survive: some banks do mask the otp box, and `type="password"
  // name="otpCode"` keeps its full textual score here rather than being
  // demoted out of `likely` by a penalty aimed at a different problem.
  if (signals.type === 'password' && textualReasons.length === 0) {
    return reject('passwordTypePenalty')
  }

  const reasons = [
    ...textualReasons,
    ...structuralReasons,
    ...contextualReasons,
  ]
  // Clamped below 100, which is reserved for the page telling us outright. A
  // caller can then treat `definite` as "the page said so" without also
  // having to check `source`.
  const score = Math.min(
    99,
    capped(textualReasons, TEXTUAL_CAP) +
      capped(structuralReasons, STRUCTURAL_CAP) +
      capped(contextualReasons, CONTEXTUAL_CAP),
  )

  const confidence: OtpConfidence | null =
    score >= LIKELY_THRESHOLD
      ? 'likely'
      : score >= POSSIBLE_THRESHOLD
        ? 'possible'
        : null

  return {
    verdict: confidence === null ? 'reject' : 'candidate',
    score,
    confidence,
    reasons,
  }
}
