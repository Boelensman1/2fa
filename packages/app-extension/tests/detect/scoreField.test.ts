import { describe, it, expect } from 'vitest'

import {
  LIKELY_THRESHOLD,
  POSSIBLE_THRESHOLD,
  scoreCandidate,
} from '../../lib/detect/scoreField'
import { emptySignals } from '../../lib/detect/signals'
import type { FieldSignals } from '../../lib/detect/signals'
import type { DetectionReasonCode } from '../../lib/detect/types'

const field = (overrides: Partial<FieldSignals> = {}): FieldSignals => ({
  ...emptySignals(),
  ...overrides,
})

const codes = (signals: FieldSignals): DetectionReasonCode[] =>
  scoreCandidate(signals).reasons.map((reason) => reason.code)

describe('the decisive tier', () => {
  it('accepts a one-time-code autocomplete outright', () => {
    const result = scoreCandidate(
      field({ autocompleteTokens: ['one-time-code'] }),
    )

    expect(result.confidence).toBe('definite')
    expect(result.score).toBe(100)
    expect(codes(field({ autocompleteTokens: ['one-time-code'] }))).toEqual([
      'autocompleteOneTimeCode',
    ])
  })

  it('reads autocomplete as a token list, not a single value', () => {
    // Legal whatwg, and what conditional-ui sites actually emit. An equality
    // comparison against the whole attribute misses every one of them.
    const result = scoreCandidate(
      field({
        autocompleteTokens: ['section-login', 'one-time-code', 'webauthn'],
      }),
    )

    expect(result.confidence).toBe('definite')
  })

  it('lets one-time-code win over a rejecting token in the same list', () => {
    const result = scoreCandidate(
      field({ autocompleteTokens: ['tel', 'one-time-code'] }),
    )

    expect(result.confidence).toBe('definite')
  })
})

describe('rejections', () => {
  it.each<[string, Partial<FieldSignals>, DetectionReasonCode]>([
    [
      'a declared username',
      { autocompleteTokens: ['username'], name: 'otp' },
      'rejectedAutocomplete',
    ],
    [
      'any cc- token',
      { autocompleteTokens: ['cc-csc'], name: 'verification_code' },
      'rejectedAutocomplete',
    ],
    [
      'a recovery code',
      { name: 'recovery_code', maxLength: 8 },
      'rejectedRecoveryCode',
    ],
    [
      'a backup code that also says code',
      { name: 'code', labelText: 'Backup code', maxLength: 6 },
      'rejectedRecoveryCode',
    ],
    ['a cvc', { name: 'cvv', maxLength: 4 }, 'rejectedCardCvc'],
    [
      'a three-character box',
      { name: 'totp', maxLength: 3 },
      'rejectedCardCvc',
    ],
    ['an ssn', { name: 'ssn', maxLength: 9 }, 'rejectedSocialSecurity'],
    ['a captcha', { name: 'captcha_code' }, 'rejectedCaptcha'],
    ['a promo code', { name: 'promo_code', maxLength: 8 }, 'rejectedPromoCode'],
    [
      'a postcode',
      // Structurally identical to a totp field -- short, numeric, six
      // characters. Only the word separates them.
      {
        name: 'postal_code',
        maxLength: 6,
        inputMode: 'numeric',
        pattern: '\\d{6}',
      },
      'rejectedPostcode',
    ],
    ['a phone country code', { name: 'country_code' }, 'rejectedPhonePart'],
  ])('rejects %s', (_label, overrides, expected) => {
    const result = scoreCandidate(field(overrides))

    expect(result.verdict).toBe('reject')
    expect(result.score).toBe(0)
    expect(result.reasons.map((reason) => reason.code)).toContain(expected)
  })

  it('rejects ambiguous card wording inside a payment form', () => {
    // "Security code" reads as a cvc here and as a totp prompt anywhere else.
    // The form is the only thing that disambiguates.
    const signals = {
      labelText: 'Security code',
      maxLength: 4,
      inputMode: 'numeric',
    }

    expect(
      scoreCandidate(field({ ...signals, formHasCreditCardField: true }))
        .verdict,
    ).toBe('reject')
    expect(
      scoreCandidate(field({ ...signals, formHasCreditCardField: false }))
        .verdict,
    ).toBe('candidate')
  })

  it('still trusts an explicit one-time-code inside a payment form', () => {
    const result = scoreCandidate(
      field({
        autocompleteTokens: ['one-time-code'],
        formHasCreditCardField: true,
      }),
    )

    expect(result.confidence).toBe('definite')
  })
})

describe('the heuristic tier', () => {
  it('clears likely on a name match alone', () => {
    const result = scoreCandidate(field({ name: 'totp_code' }))

    expect(result.score).toBeGreaterThanOrEqual(LIKELY_THRESHOLD)
    expect(result.confidence).toBe('likely')
  })

  it('clears likely on a label match plus structure', () => {
    const result = scoreCandidate(
      field({
        id: 'x',
        labelText: 'Enter your authentication code',
        maxLength: 6,
        inputMode: 'numeric',
      }),
    )

    expect(result.confidence).toBe('likely')
  })

  it('reaches only possible on structure alone', () => {
    const result = scoreCandidate(
      field({ maxLength: 6, inputMode: 'numeric', pattern: '\\d{6}' }),
    )

    expect(result.score).toBeLessThan(LIKELY_THRESHOLD)
    expect(result.score).toBeGreaterThanOrEqual(POSSIBLE_THRESHOLD)
    expect(result.confidence).toBe('possible')
  })

  it('reports nothing for an ordinary text input', () => {
    const result = scoreCandidate(field({ name: 'first_name' }))

    expect(result.verdict).toBe('reject')
    expect(result.confidence).toBeNull()
  })
})

describe('family caps', () => {
  it('does not let restatements of one structural fact stack', () => {
    // maxlength 6 + inputmode numeric + digit pattern + plausible type is
    // 25+15+15+5 = 60 uncapped, which would clear `likely` with the page
    // never having said the word "code".
    const saturated = scoreCandidate(
      field({
        maxLength: 6,
        inputMode: 'numeric',
        pattern: '\\d{6}',
        type: 'text',
      }),
    )

    expect(saturated.score).toBe(40)
    expect(saturated.confidence).toBe('possible')
  })

  it('caps the textual family too', () => {
    const everyTextualSignal = scoreCandidate(
      field({
        name: 'otp',
        labelText: 'One-time code',
        nearbyText: 'Enter the verification code we sent',
        formAccessibleName: 'Two-factor authentication',
      }),
    )

    // 60 + 45 + 15 + 15 = 135 uncapped; 60 capped, plus 5 for a plausible type.
    expect(everyTextualSignal.score).toBe(65)
  })

  it('lets independent families combine past a single cap', () => {
    const result = scoreCandidate(
      field({ name: 'otp', maxLength: 6, inputMode: 'numeric' }),
    )

    // 60 textual + 40 structural, clamped below the 100 reserved for
    // `definite`.
    expect(result.score).toBe(99)
    expect(result.confidence).toBe('likely')
  })
})

describe('individual signals', () => {
  it('keeps a masked field that names itself', () => {
    // Some banks really do mask the otp box. A penalty aimed at stray password
    // fields must not knock this one out of `likely`.
    const masked = scoreCandidate(field({ name: 'otp_code', type: 'password' }))

    expect(masked.confidence).toBe('likely')
    expect(masked.reasons.map((reason) => reason.code)).not.toContain(
      'passwordTypePenalty',
    )
  })

  it('rejects a masked field with nothing textual behind it', () => {
    const result = scoreCandidate(
      field({ type: 'password', maxLength: 6, inputMode: 'numeric' }),
    )

    expect(result.verdict).toBe('reject')
    expect(result.reasons.map((reason) => reason.code)).toContain(
      'passwordTypePenalty',
    )
  })

  it('credits a segmented group', () => {
    expect(codes(field({ name: 'code', segmentCount: 6 }))).toContain(
      'segmentedGroup',
    )
  })

  it('credits being the sole field in an otp-named form', () => {
    expect(
      codes(
        field({
          isOnlyTextInputInForm: true,
          formAccessibleName: 'Two-factor authentication',
        }),
      ),
    ).toContain('soleFieldInOtpForm')
  })

  it('credits a sibling password field, but not on the password itself', () => {
    expect(
      codes(field({ name: 'code', formHasPasswordField: true })),
    ).toContain('siblingPasswordField')
    expect(
      codes(
        field({ name: 'code', type: 'password', formHasPasswordField: true }),
      ),
    ).not.toContain('siblingPasswordField')
  })

  it('never reports a heuristic score as definite', () => {
    // 100 is reserved for the page telling us outright, so that a caller can
    // trust `definite` without also checking `source`.
    const result = scoreCandidate(
      field({
        name: 'otp_code',
        labelText: 'One-time code',
        maxLength: 6,
        inputMode: 'numeric',
        pattern: '\\d{6}',
        segmentCount: 6,
        isOnlyTextInputInForm: true,
        formAccessibleName: 'Two-factor authentication',
        formHasPasswordField: true,
      }),
    )

    expect(result.score).toBeLessThan(100)
    expect(result.confidence).toBe('likely')
  })
})
