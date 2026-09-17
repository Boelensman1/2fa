/**
 * The vocabulary of otp-field detection.
 *
 * Nothing here imports anything -- not from `lib/`, not from `wxt/*`. The
 * detector is deliberately a standalone module: it makes the scoring testable
 * as plain data, and it keeps the door open to moving the whole directory into
 * favalib later if a second client ever needs it.
 * @module
 */

/** Whether a detection is one input or a row of single-character boxes. */
export type OtpFieldKind = 'single' | 'segmented'

/**
 * How sure we are, in the three bands a caller actually branches on.
 *
 * `definite` means the page told us outright, via `autocomplete` or via the
 * user's own `inputSelector`. `likely` is a heuristic verdict solid enough to
 * fill without asking. `possible` is worth offering, not worth doing
 * unprompted.
 */
export type OtpConfidence = 'definite' | 'likely' | 'possible'

/** What produced a detection. */
export type DetectionSource = 'inputSelector' | 'autocomplete' | 'heuristic'

/**
 * Why a field scored as it did.
 *
 * Every verdict carries these, because "the extension filled the wrong box"
 * is otherwise an unfalsifiable bug report. They are also what the fixture
 * suite asserts on, so a weight change that happens to keep a total above
 * the threshold still shows up as a diff.
 */
export type DetectionReasonCode =
  // Decisive
  | 'inputSelectorOverride'
  | 'autocompleteOneTimeCode'
  // Textual
  | 'nameMatchesOtp'
  | 'labelMatchesOtp'
  | 'nearbyTextMatchesOtp'
  | 'formNameMatchesOtp'
  // Structural
  | 'maxLengthSix'
  | 'maxLengthTypical'
  | 'inputModeNumeric'
  | 'digitPattern'
  | 'plausibleType'
  | 'passwordTypePenalty'
  // Contextual
  | 'soleFieldInOtpForm'
  | 'siblingPasswordField'
  | 'segmentedGroup'
  | 'ambiguousCardContext'
  // Rejections
  | 'rejectedAutocomplete'
  | 'rejectedCardCvc'
  | 'rejectedPaymentContext'
  | 'rejectedSocialSecurity'
  | 'rejectedRecoveryCode'
  | 'rejectedCaptcha'
  | 'rejectedPromoCode'
  | 'rejectedPostcode'
  | 'rejectedPhonePart'

export interface DetectionReason {
  code: DetectionReasonCode
  /** The points this contributed, before any family cap. Zero for rejections. */
  weight: number
  /** The value that triggered it, for debugging. */
  detail?: string
}

/**
 * A detected field, in the form that crosses the message boundary.
 *
 * Structured-cloneable by construction: no elements, no functions. The live
 * elements stay in the content script on a {@link DetectedOtpFieldHandle}.
 * Keeping these two apart is what lets a later step say "fill field `otp-1`"
 * without the background ever holding a dom reference it cannot serialise.
 */
export interface DetectedOtpField {
  /** Stable for a surviving element across rescans, within one page load. */
  id: string
  kind: OtpFieldKind
  confidence: OtpConfidence
  score: number
  source: DetectionSource
  reasons: DetectionReason[]
  /**
   * A css path to the field, for display and for a future "save this as the
   * entry's inputSelector". Never used to re-find the element -- the handle
   * holds it directly, and a path goes stale on the next render.
   */
  selector: string
  /**
   * A devtools-style one-line description of the field's first element, for
   * the debug view: `input#code.form-control[name="otp"]`.
   *
   * Unlike {@link DetectedOtpField.selector} this is a label rather than
   * something to feed back to `querySelector` -- it keeps ids the selector
   * builder rejects as unstable, precisely because those are still the
   * quickest way to find the element in the console right now.
   */
  elementDescription: string
  /** How many characters the field expects, when it says. */
  expectedLength: number | null
  /** 1 for a single input, N for a segmented row. */
  segmentCount: number
  /** Which of the entry's `inputSelector` overrides matched, if any. */
  matchedInputSelectors: string[]
  inShadowRoot: boolean
  /**
   * Host path from the document down to the field's shadow root, if it is in
   * one. `null` when the field is in the document, where `selector` alone is
   * enough to find it.
   */
  shadowHostPath: string | null
}

/** A detected field plus its live elements. Stays in the content script. */
export interface DetectedOtpFieldHandle {
  readonly field: DetectedOtpField
  readonly elements: readonly HTMLInputElement[]
}
