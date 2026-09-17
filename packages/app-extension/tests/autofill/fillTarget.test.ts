import { describe, it, expect } from 'vitest'

import {
  isTrustedFrame,
  pickFillTarget,
  stillHoldsTarget,
} from '../../lib/background/fillTarget'
import type { OtpFieldReport } from '../../lib/ioc/entities/OtpFieldRegistry'
import type { DetectedOtpField } from '../../lib/detect'
import type { FillTarget } from '../../lib/types'

/**
 * Where the popup's fill decides what it is pointing at.
 *
 * Pure on purpose, and tested here rather than through the message handler,
 * because these three functions are the whole of it: which field a code is
 * generated for, whether that field is still the one the user was shown, and
 * whether it may be typed into without a second look. Each fails silently in
 * the safe direction, so a regression reads as "fill is a bit flaky".
 */

const field = (
  id: string,
  over: Partial<DetectedOtpField> = {},
): DetectedOtpField => ({
  id,
  kind: 'single',
  confidence: 'likely',
  score: 60,
  source: 'heuristic',
  reasons: [],
  selector: '#code',
  elementDescription: 'input#code',
  expectedLength: 6,
  segmentCount: 1,
  matchedInputSelectors: [],
  inShadowRoot: false,
  shadowHostPath: null,
  ...over,
})

const report = (over: Partial<OtpFieldReport> = {}): OtpFieldReport => ({
  tabId: 7,
  frameId: 0,
  url: 'https://github.com/login',
  fields: [field('otp-1')],
  overrideMissed: false,
  scannedAt: 0,
  ...over,
})

describe('pickFillTarget', () => {
  it('describes the frame the field is in, not the tab', () => {
    const target = pickFillTarget([
      report({ frameId: 4, url: 'https://widget.example/otp' }),
    ])

    expect(target).toEqual({
      tabId: 7,
      frameId: 4,
      documentId: undefined,
      fieldId: 'otp-1',
      url: 'https://widget.example/otp',
      host: 'widget.example',
      confidence: 'likely',
      inSubframe: true,
    })
  })

  it('is not a subframe in the tab own document', () => {
    expect(pickFillTarget([report()])?.inSubframe).toBe(false)
  })

  /** The sort is redone rather than trusted; the input here is out of order. */
  it('takes the most confident field in the most confident frame', () => {
    const target = pickFillTarget([
      report({ frameId: 4, fields: [field('otp-low', { score: 40 })] }),
      report({
        frameId: 0,
        fields: [
          field('otp-best', { score: 95 }),
          field('otp-b', { score: 3 }),
        ],
      }),
    ])

    expect(target?.fieldId).toBe('otp-best')
  })

  /**
   * `forTab` includes them, because a report with no fields is still how
   * `overrideMissed` reaches the debug pane.
   */
  it('ignores frames that reported no fields', () => {
    expect(pickFillTarget([report({ fields: [] })])).toBeNull()
  })

  /**
   * The disclosure is this feature's only real control, so a frame whose
   * origin cannot be named to the user is not offered at all. The empty string
   * is what `REPORT_OTP_FIELDS` stores when the browser supplied no url.
   */
  it.each(['', 'about:blank', 'data:text/html,x', 'chrome-extension://abc/x'])(
    'refuses a frame at %s',
    (url) => {
      expect(pickFillTarget([report({ url })])).toBeNull()
    },
  )

  it('returns null for a tab that has reported nothing', () => {
    expect(pickFillTarget([])).toBeNull()
  })
})

describe('stillHoldsTarget', () => {
  const target: FillTarget = {
    tabId: 7,
    frameId: 4,
    documentId: undefined,
    fieldId: 'otp-1',
    url: 'https://widget.example/otp',
    host: 'widget.example',
    confidence: 'likely',
    inSubframe: true,
  }
  const current = report({ frameId: 4, url: 'https://widget.example/otp' })

  it('accepts a frame still showing the same field', () => {
    expect(stillHoldsTarget(current, target)).toBe(true)
  })

  /**
   * The check the whole round trip exists for. Nothing clears the registry on
   * navigation, and a frame id is reused across a frame's own navigations, so
   * without this a popup left open while an embedded widget navigated could
   * put a live code into whatever replaced it.
   */
  it('refuses a frame that has navigated', () => {
    expect(
      stillHoldsTarget({ ...current, url: 'https://evil.example/' }, target),
    ).toBe(false)
  })

  it('refuses a frame whose document was replaced', () => {
    expect(stillHoldsTarget({ ...current, documentId: 'd2' }, target)).toBe(
      false,
    )
  })

  it('refuses a frame that has lost the field', () => {
    expect(
      stillHoldsTarget({ ...current, fields: [field('otp-9')] }, target),
    ).toBe(false)
  })

  it('refuses a frame that is no longer reporting at all', () => {
    expect(stillHoldsTarget(undefined, target)).toBe(false)
  })
})

describe('isTrustedFrame', () => {
  const question = {
    frameId: 4,
    frameUrl: 'https://widget.example/otp',
    pageUrl: 'https://bank.example/login',
    entryClaimsFrame: false,
  }

  it('trusts the page the user navigated to', () => {
    expect(isTrustedFrame({ ...question, frameId: 0 })).toBe(true)
  })

  /** The hosted second-factor widget: another origin, but a named one. */
  it('trusts a frame the entry itself claims', () => {
    expect(isTrustedFrame({ ...question, entryClaimsFrame: true })).toBe(true)
  })

  it('trusts a subdomain of the page', () => {
    expect(
      isTrustedFrame({ ...question, frameUrl: 'https://auth.bank.example/x' }),
    ).toBe(true)
  })

  /** A page at `www.` embedding the bare domain is as much one site. */
  it('trusts the page being a subdomain of the frame', () => {
    expect(
      isTrustedFrame({
        ...question,
        frameUrl: 'https://bank.example/x',
        pageUrl: 'https://www.bank.example/login',
      }),
    ).toBe(true)
  })

  it('asks about a third-party frame the entry does not name', () => {
    expect(isTrustedFrame(question)).toBe(false)
  })

  /** The dot boundary, which is the only thing between these two. */
  it('is not fooled by a suffix that is not a subdomain', () => {
    expect(
      isTrustedFrame({
        ...question,
        frameUrl: 'https://bank.example.evil.com/x',
      }),
    ).toBe(false)
  })

  /** No top-frame report means no comparison; ask rather than assume. */
  it('asks when the page url is unknown', () => {
    expect(
      isTrustedFrame({
        ...question,
        frameUrl: 'https://auth.bank.example/x',
        pageUrl: null,
      }),
    ).toBe(false)
  })
})
