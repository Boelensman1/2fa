import { describe, it, expect } from 'vitest'

import {
  CAPTCHA_RE,
  CARD_CVC_RE,
  DIGIT_PATTERN_RE,
  MAX_SIGNAL_LENGTH,
  OTP_FIELD_RE,
  PHONE_PART_RE,
  POSTCODE_RE,
  PROMO_CODE_RE,
  RECOVERY_CODE_RE,
  SOCIAL_SECURITY_RE,
  OTP_FIELD_EXTRA_RE,
  matchesAnyOtpField,
  matchesAnySignal,
  matchesOtpField,
  matchesSignal,
  normaliseSignal,
} from '../../lib/detect/patterns'

describe('normaliseSignal', () => {
  it('splits camel humps', () => {
    expect(normaliseSignal('otpCode')).toBe('otp code')
    expect(normaliseSignal('twoFactorToken')).toBe('two factor token')
  })

  it('does not split at letter/digit boundaries', () => {
    // The whole point: splitting here would give "login2 fa" and destroy the
    // 2fa token.
    expect(normaliseSignal('login2FA')).toBe('login2fa')
    expect(normaliseSignal('code6')).toBe('code6')
  })

  it('flattens punctuation and whitespace', () => {
    expect(normaliseSignal('mfa_token')).toBe('mfa token')
    expect(normaliseSignal('user[otp][0]')).toBe('user otp 0')
    expect(normaliseSignal('  Enter\n\tyour  code ')).toBe('enter your code')
  })

  it('bounds its input', () => {
    expect(normaliseSignal('a'.repeat(MAX_SIGNAL_LENGTH * 4))).toHaveLength(
      MAX_SIGNAL_LENGTH,
    )
  })
})

describe('matchesSignal', () => {
  it('matches values that only the normalised form reaches', () => {
    // `\b` never fires mid-hump, so the raw form matches nothing.
    expect(OTP_FIELD_RE.test('otpNumber')).toBe(false)
    expect(matchesSignal(OTP_FIELD_RE, 'otpNumber')).toBe(true)
  })

  it('matches values that only the raw form reaches', () => {
    // Normalisation flattens the hyphen, which loses this literal alternative.
    expect(OTP_FIELD_RE.test(normaliseSignal('wfls-token'))).toBe(false)
    expect(matchesSignal(OTP_FIELD_RE, 'wfls-token')).toBe(true)
    expect(matchesSignal(OTP_FIELD_RE, 'email_code')).toBe(true)
  })

  it('is false for the empty string', () => {
    expect(matchesSignal(OTP_FIELD_RE, '')).toBe(false)
  })

  it('checks every value in the any- form', () => {
    expect(matchesAnySignal(OTP_FIELD_RE, ['username', 'password'])).toBe(false)
    expect(matchesAnySignal(OTP_FIELD_RE, ['username', 'totp'])).toBe(true)
  })
})

describe('OTP_FIELD_RE', () => {
  // One case per alternative in the Chromium source, so a transcription error
  // in any branch shows up as a named failure rather than a mystery.
  it.each([
    ['one time literal', 'one-time password'],
    ['bare main token', 'otp'],
    ['main token, underscored', 'mfa_field'],
    ['main token plus companion', 'totp_code'],
    ['companion plus main token', 'login_otp'],
    ['sms.otp combination', 'sms-otp'],
    ['verification code', 'verification code'],
    ['verify code', 'verify_code'],
    ['vcode', 'vcode'],
    ['second factor', 'second factor'],
    ['two factor', 'twoFactor'],
    ['2 factor', '2-factor'],
    ['wfls token literal', 'wfls-token'],
    ['email_code literal', 'email_code'],
    ['camel case otp', 'smsCode'],
  ])('matches %s', (_label, value) => {
    expect(matchesSignal(OTP_FIELD_RE, value)).toBe(true)
  })

  it.each([
    ['username'],
    ['password'],
    ['current-password'],
    ['email'],
    ['firstName'],
    ['search'],
    ['address_line_1'],
  ])('does not match %s', (value) => {
    expect(matchesSignal(OTP_FIELD_RE, value)).toBe(false)
  })
})

describe('OTP_FIELD_EXTRA_RE', () => {
  // Chromium's regex has no `auth.?code` alternative -- `auth` is only ever a
  // companion token after otp/totp/mfa -- so every one of these matches
  // nothing without our supplement. "Authentication code" is the literal
  // label on GitHub's 2fa prompt.
  it.each([
    'authentication_code',
    'auth-code',
    'Authenticator app code',
    'passcode',
    'Enter the 6-digit code',
    'confirmation code',
  ])('matches %s, which Chromium misses', (value) => {
    expect(matchesSignal(OTP_FIELD_RE, value)).toBe(false)
    expect(matchesOtpField(value)).toBe(true)
  })

  it.each(['username', 'password', 'email', 'street address'])(
    'does not match %s',
    (value) => {
      expect(matchesSignal(OTP_FIELD_EXTRA_RE, value)).toBe(false)
    },
  )

  it('checks every value in the any- form', () => {
    expect(matchesAnyOtpField(['username', 'password'])).toBe(false)
    expect(matchesAnyOtpField(['username', 'Authentication code'])).toBe(true)
  })
})

describe('the exclusion patterns', () => {
  it.each([
    ['recovery_code', RECOVERY_CODE_RE],
    ['Backup code', RECOVERY_CODE_RE],
    ['scratchCode', RECOVERY_CODE_RE],
    ['recovery-key', RECOVERY_CODE_RE],
    ['promo_code', PROMO_CODE_RE],
    ['couponCode', PROMO_CODE_RE],
    ['gift-card', PROMO_CODE_RE],
    ['inviteCode', PROMO_CODE_RE],
    ['g-recaptcha-response', CAPTCHA_RE],
    ['captcha_code', CAPTCHA_RE],
    ['zip', POSTCODE_RE],
    ['postal_code', POSTCODE_RE],
    ['ssn', SOCIAL_SECURITY_RE],
    ['social-security-number', SOCIAL_SECURITY_RE],
    ['cvv', CARD_CVC_RE],
    ['card_cvc', CARD_CVC_RE],
    ['cardIdentification', CARD_CVC_RE],
    ['area_code', PHONE_PART_RE],
    ['countryCode', PHONE_PART_RE],
  ])('%s is excluded', (value, re) => {
    expect(matchesSignal(re, value)).toBe(true)
  })

  it('does not catch an otp field in the recovery pattern', () => {
    expect(matchesSignal(RECOVERY_CODE_RE, 'one-time code')).toBe(false)
    expect(matchesSignal(RECOVERY_CODE_RE, 'totp_code')).toBe(false)
  })

  it('does not treat cid inside a word as a card field', () => {
    // Chromium's own note: "cid" is a substring of "cidade".
    expect(matchesSignal(CARD_CVC_RE, 'cidade')).toBe(false)
  })

  it('leaves the ambiguous card wording to form context', () => {
    // These are in Chromium's kCardCvcRe but deliberately not in ours: they
    // are exactly what a 2fa screen says too.
    expect(matchesSignal(CARD_CVC_RE, 'verification')).toBe(false)
    expect(matchesSignal(CARD_CVC_RE, 'security code')).toBe(false)
  })
})

describe('DIGIT_PATTERN_RE', () => {
  it.each(['\\d{6}', '[0-9]{4,8}', '^\\d{6}$', '[0-9]*', '\\d+'])(
    'accepts %s',
    (pattern) => {
      expect(DIGIT_PATTERN_RE.test(pattern)).toBe(true)
    },
  )

  it.each(['[A-Za-z0-9]{6}', '.*', '^[a-z]+$', ''])('rejects %s', (pattern) => {
    expect(DIGIT_PATTERN_RE.test(pattern)).toBe(false)
  })
})
