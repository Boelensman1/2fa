import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd } from 'node:process'

import { describe, it, expect, beforeEach } from 'vitest'

import { detectOtpFields } from '../../lib/detect'
import type { DetectedOtpFieldHandle } from '../../lib/detect'

/**
 * Under `environment: 'happy-dom'`, `import.meta.url` resolves against the
 * document's `http://localhost/`, not against this file, so the usual
 * `new URL(..., import.meta.url)` idiom silently reads from the filesystem
 * root. vitest runs with the package as its cwd, which does work.
 */
const FIXTURE_DIR = join(cwd(), 'tests', 'fixtures', 'otpFields')

const fixture = (name: string): string =>
  readFileSync(join(FIXTURE_DIR, `${name}.html`), 'utf8')

const scan = (
  name: string,
  options: Parameters<typeof detectOtpFields>[0] = {},
): DetectedOtpFieldHandle[] => {
  document.body.innerHTML = fixture(name)
  return detectOtpFields(options).handles
}

const only = (handles: DetectedOtpFieldHandle[]): DetectedOtpFieldHandle => {
  expect(handles).toHaveLength(1)
  const handle = handles[0]
  if (handle === undefined) throw new Error('no handle')
  return handle
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('fields that must be found', () => {
  it('finds an explicit one-time-code field', () => {
    const handle = only(scan('autocomplete-one-time-code'))

    expect(handle.field.confidence).toBe('definite')
    expect(handle.field.source).toBe('autocomplete')
    expect(handle.field.kind).toBe('single')
    expect(handle.elements[0]?.id).toBe('code')
  })

  it('finds one-time-code inside an autocomplete token list', () => {
    const handle = only(scan('autocomplete-token-list'))

    expect(handle.field.confidence).toBe('definite')
  })

  it('finds a field named for what it is', () => {
    const handle = only(scan('name-only-totp'))

    expect(handle.field.confidence).toBe('likely')
    expect(handle.field.reasons.map((reason) => reason.code)).toContain(
      'nameMatchesOtp',
    )
  })

  it('finds a github-style authentication code field', () => {
    // The field Chromium's own regex misses: `auth` is only a companion token
    // there, so this leans on OTP_FIELD_EXTRA_RE.
    const handle = only(scan('github-style'))

    expect(handle.field.confidence).toBe('likely')
  })

  it('finds a field identified only by its label', () => {
    const handle = only(scan('label-only-verification-code'))

    expect(handle.field.reasons.map((reason) => reason.code)).toContain(
      'labelMatchesOtp',
    )
  })

  it('finds a field identified only by its placeholder', () => {
    const handle = only(scan('placeholder-six-digits'))

    expect(handle.field.confidence).toBeTruthy()
  })

  it('finds a field identified only by the prompt above it', () => {
    const handle = only(scan('prompt-text-only'))

    expect(handle.field.reasons.map((reason) => reason.code)).toContain(
      'nearbyTextMatchesOtp',
    )
  })

  it('finds a camel-cased name', () => {
    // `\b` never fires mid-hump, so this only works because of normalisation.
    const handle = only(scan('sms-code-camel'))

    expect(handle.field.confidence).toBe('likely')
  })

  it('finds the otp field beside a password, and not the password', () => {
    const handle = only(scan('two-step-password-then-otp'))

    expect(handle.elements[0]?.getAttribute('name')).toBe('mfa_token')
    expect(handle.field.reasons.map((reason) => reason.code)).toContain(
      'siblingPasswordField',
    )
  })
})

describe('segmented rows', () => {
  it('reads six boxes as one field', () => {
    const handle = only(scan('segmented-six-inputs'))

    expect(handle.field.kind).toBe('segmented')
    expect(handle.field.segmentCount).toBe(6)
    expect(handle.elements).toHaveLength(6)
    // The row expects six characters, not the one each box reports.
    expect(handle.field.expectedLength).toBe(6)
  })

  it('reads a row whose tail is disabled', () => {
    // Widgets routinely enable one box at a time. Filtering disabled inputs
    // would reduce every six-box row to a one-box detection.
    const handle = only(scan('segmented-disabled-tail'))

    expect(handle.field.kind).toBe('segmented')
    expect(handle.elements).toHaveLength(6)
  })
})

describe('fields that must not be found', () => {
  it.each([
    ['credit-card-cvc'],
    ['credit-card-cvc-ambiguous'],
    ['recovery-code'],
    ['coupon-code'],
    ['postal-code'],
    ['ssn-segments'],
    ['captcha'],
    ['password-login'],
    ['hidden-leftover-otp'],
  ])('finds nothing in %s', (name) => {
    expect(scan(name)).toHaveLength(0)
  })
})

describe('shadow roots', () => {
  it('finds a field inside an open shadow root', () => {
    document.body.innerHTML = '<div id="host"></div>'
    const host = document.querySelector('#host')
    const shadow = host?.attachShadow({ mode: 'open' })
    if (shadow === undefined) throw new Error('no shadow root')
    shadow.innerHTML =
      '<form><input name="otp" autocomplete="one-time-code"></form>'

    const handle = only(detectOtpFields().handles)

    expect(handle.field.inShadowRoot).toBe(true)
    // The css path stops at the shadow boundary, so on its own it is a
    // selector document.querySelector can never match. The host path is what
    // makes the report actionable.
    expect(handle.field.selector).toBe('input[name="otp"]')
    expect(handle.field.shadowHostPath).toBe('#host')
    expect(handle.field.elementDescription).toBe('input[name="otp"]')
  })

  it('does not descend into a closed shadow root', () => {
    // Nothing can, short of monkeypatching attachShadow from the main world.
    // Documented as a limitation with inputSelector as the escape hatch.
    document.body.innerHTML = '<div id="host"></div>'
    const shadow = document
      .querySelector('#host')
      ?.attachShadow({ mode: 'closed' })
    if (shadow === undefined) throw new Error('no shadow root')
    shadow.innerHTML = '<input autocomplete="one-time-code">'

    expect(detectOtpFields().handles).toHaveLength(0)
  })
})

describe('the inputSelector override', () => {
  it('wins outright over the heuristic', () => {
    const handle = only(
      scan('override-target', { inputSelectors: ['#field-a'] }),
    )

    expect(handle.field.source).toBe('inputSelector')
    expect(handle.field.confidence).toBe('definite')
    expect(handle.elements[0]?.id).toBe('field-a')
  })

  it('suppresses the heuristic rather than merging with it', () => {
    // The user wrote a selector because the heuristic picked the wrong box.
    // Offering that box again alongside the right one reinstates the bug.
    const handles = scan('override-target', { inputSelectors: ['#field-a'] })

    expect(handles.map((handle) => handle.field.source)).toEqual([
      'inputSelector',
    ])
  })

  it('descends from a wrapper to the input inside it', () => {
    const handle = only(
      scan('override-target', { inputSelectors: ['#magic-box'] }),
    )

    expect(handle.elements[0]?.id).toBe('field-a')
  })

  it('falls back to the heuristic and flags a stale selector', () => {
    document.body.innerHTML = fixture('override-target')
    const result = detectOtpFields({ inputSelectors: ['#gone'] })

    expect(result.overrideMissed).toBe(true)
    expect(result.handles[0]?.field.source).toBe('heuristic')
  })

  it('survives a selector that is not valid css', () => {
    // These arrive from a synced vault and are untrusted input; one bad entry
    // must not take detection down for the page.
    document.body.innerHTML = fixture('override-target')

    expect(() => detectOtpFields({ inputSelectors: ['((('] })).not.toThrow()
  })
})

describe('the result', () => {
  it('orders by score, highest first', () => {
    document.body.innerHTML = `
      <form aria-label="Verify">
        <input name="something" maxlength="6" inputmode="numeric">
        <input name="otp_code" autocomplete="one-time-code">
      </form>
    `
    const scores = detectOtpFields().handles.map((handle) => handle.field.score)

    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('keeps a field"s id stable across rescans', () => {
    document.body.innerHTML = fixture('autocomplete-one-time-code')
    const first = detectOtpFields().handles[0]?.field.id
    const second = detectOtpFields().handles[0]?.field.id

    expect(first).toBeDefined()
    expect(second).toBe(first)
  })
})
