import { describe, it, expect, beforeEach } from 'vitest'

import {
  autocompleteTokensOf,
  createSignalCollector,
} from '../../lib/detect/collectSignals'
import {
  cssPathFor,
  describeElement,
  isStableId,
  shadowHostPathFor,
} from '../../lib/detect/selector'
import { isPlausiblyVisible } from '../../lib/detect/visibility'

const render = (html: string): void => {
  document.body.innerHTML = html
}

const input = (selector: string): HTMLInputElement => {
  const element = document.querySelector<HTMLInputElement>(selector)
  if (element === null) throw new Error(`no element for ${selector}`)
  return element
}

const signalsFor = (selector: string) =>
  createSignalCollector()(input(selector))

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('autocompleteTokensOf', () => {
  it('splits the token list', () => {
    render('<input id="a" autocomplete="Section-Login One-Time-Code webauthn">')

    expect(autocompleteTokensOf(input('#a'))).toEqual([
      'section-login',
      'one-time-code',
      'webauthn',
    ])
  })

  it('is empty for an absent or blank attribute', () => {
    render('<input id="a"><input id="b" autocomplete="  ">')

    expect(autocompleteTokensOf(input('#a'))).toEqual([])
    expect(autocompleteTokensOf(input('#b'))).toEqual([])
  })
})

describe('collecting a field"s own attributes', () => {
  it('reads the obvious ones', () => {
    render(`
      <input id="otp" name="otp_code" type="tel" inputmode="numeric"
             pattern="\\d{6}" maxlength="6" placeholder="123456"
             aria-label="One-time code" title="Code" data-testid="otp-input">
    `)
    const signals = signalsFor('#otp')

    expect(signals).toMatchObject({
      type: 'tel',
      name: 'otp_code',
      id: 'otp',
      inputMode: 'numeric',
      pattern: '\\d{6}',
      maxLength: 6,
      placeholder: '123456',
      ariaLabel: 'One-time code',
      title: 'Code',
      testId: 'otp-input',
      segmentCount: 1,
    })
  })

  it('reports an unset maxlength as absent, not as zero', () => {
    // The dom reports -1 here, which would read as an extremely short field
    // rather than as no signal at all.
    render('<input id="a">')

    expect(signalsFor('#a').maxLength).toBeNull()
  })
})

describe('label association', () => {
  it('follows a for= label', () => {
    render('<label for="a">Authentication code</label><input id="a">')

    expect(signalsFor('#a').labelText).toBe('Authentication code')
  })

  it('follows an ancestor label', () => {
    render('<label>Verification code <input id="a"></label>')

    expect(signalsFor('#a').labelText).toContain('Verification code')
  })

  it('follows aria-labelledby', () => {
    render(
      '<span id="l">One-time code</span><input id="a" aria-labelledby="l">',
    )

    expect(signalsFor('#a').labelText).toContain('One-time code')
  })
})

describe('nearby text', () => {
  it('reads the prompt above an unlabelled field', () => {
    render('<div><p>Enter the code we sent you</p><input id="a"></div>')

    expect(signalsFor('#a').nearbyText).toContain('Enter the code we sent you')
  })

  it('is bounded', () => {
    render(`<div><p>${'word '.repeat(200)}</p><input id="a"></div>`)

    expect(signalsFor('#a').nearbyText.length).toBeLessThanOrEqual(120)
  })
})

describe('form context', () => {
  it('names the form from its legend', () => {
    render(`
      <form>
        <fieldset><legend>Two-factor authentication</legend>
          <input id="a"><input id="b"><input id="c">
        </fieldset>
      </form>
    `)

    expect(signalsFor('#a').formAccessibleName).toBe(
      'Two-factor authentication',
    )
  })

  it('notices a sibling password field', () => {
    render(`
      <form>
        <input id="u" name="username">
        <input id="p" type="password">
        <input id="a" name="otp">
      </form>
    `)
    const signals = signalsFor('#a')

    expect(signals.formHasPasswordField).toBe(true)
    expect(signals.formHasCreditCardField).toBe(false)
  })

  it('notices a credit card form', () => {
    render(`
      <form>
        <input id="n" autocomplete="cc-number">
        <input id="e" autocomplete="cc-exp">
        <input id="a" name="security_code" maxlength="4">
      </form>
    `)

    expect(signalsFor('#a').formHasCreditCardField).toBe(true)
  })

  it('notices a credit card form that uses no autocomplete', () => {
    render(`
      <form>
        <input id="n" name="card_number">
        <input id="x" name="expiry_month">
        <input id="a" name="security_code">
      </form>
    `)

    expect(signalsFor('#a').formHasCreditCardField).toBe(true)
  })

  it('reports a lone visible text input as such', () => {
    render(`
      <form aria-label="Two-factor authentication">
        <input id="a" name="code">
        <input type="hidden" name="csrf">
        <button type="submit">Verify</button>
      </form>
    `)

    expect(signalsFor('#a').isOnlyTextInputInForm).toBe(true)
  })

  it('falls back to a container when there is no form', () => {
    render(`
      <div>
        <h2>Two-step verification</h2>
        <input id="a"><input id="b"><input id="c">
      </div>
    `)

    expect(signalsFor('#a').formAccessibleName).toBe('Two-step verification')
  })
})

describe('isPlausiblyVisible', () => {
  it.each([
    ['a plain input', '<input id="t">', true],
    ['a display:none input', '<input id="t" style="display:none">', false],
    [
      'an input in a display:none container',
      '<div style="display:none"><input id="t"></div>',
      false,
    ],
    [
      'an input in a visibility:hidden container',
      '<div style="visibility:hidden"><input id="t"></div>',
      false,
    ],
    ['a hidden-attribute input', '<input id="t" hidden>', false],
    ['a type=hidden input', '<input id="t" type="hidden">', false],
    ['an inert input', '<div inert><input id="t"></div>', false],
    // Deliberate: the one real input under a row of decorative boxes is a
    // common segmented-otp pattern, and it is usually transparent.
    ['a transparent input', '<input id="t" style="opacity:0">', true],
  ])('%s', (_label, html, expected) => {
    render(html)

    expect(isPlausiblyVisible(input('#t'))).toBe(expected)
  })
})

describe('cssPathFor', () => {
  it('prefers a stable id', () => {
    render('<input id="otp-field">')

    expect(cssPathFor(input('#otp-field'))).toBe('#otp-field')
  })

  it('refuses framework-generated ids', () => {
    // React useId emits these. Saved as an inputSelector one would work once
    // and then silently never match again.
    expect(isStableId(':r1:')).toBe(false)
    expect(isStableId('input-42')).toBe(false)
    expect(isStableId('otp-field')).toBe(true)
  })

  it('falls back to a name', () => {
    render('<input id=":r3:" name="otp_code">')

    expect(cssPathFor(input('[name="otp_code"]'))).toBe(
      'input[name="otp_code"]',
    )
  })

  it('falls back to a positional path', () => {
    render('<div><span></span><input><input id=":r7:"></div>')
    const target = document.querySelectorAll('input').item(1)
    const path = cssPathFor(target)

    expect(path).toContain('nth-of-type(2)')
    expect(document.querySelector(path)).toBe(target)
  })
})

describe('describeElement', () => {
  it('reads like a devtools breadcrumb', () => {
    render(
      '<input id="code" class="form-control is-lg" type="tel" name="otp"' +
        ' placeholder="6-digit code">',
    )

    expect(describeElement(input('#code'))).toBe(
      'input#code.form-control.is-lg[type="tel"][name="otp"]' +
        '[placeholder="6-digit code"]',
    )
  })

  it('keeps ids the selector builder rejects', () => {
    // The whole reason this exists next to cssPathFor: `:r1:` is useless in a
    // saved inputSelector but is the fastest way to find the box right now.
    render('<input id=":r1:" name="otp">')

    expect(describeElement(input('[name="otp"]'))).toBe(
      'input#:r1:[name="otp"]',
    )
    expect(cssPathFor(input('[name="otp"]'))).toBe('input[name="otp"]')
  })

  it('truncates a long value and a long class list', () => {
    render(
      '<input class="a b c d" aria-label="' +
        'enter the six digit code we just texted you' +
        '">',
    )
    const description = describeElement(input('input'))

    expect(description).toBe(
      'input.a.b.c.…[aria-label="enter the six digit code we jus…"]',
    )
  })

  it('omits what the element does not have', () => {
    render('<input>')

    expect(describeElement(input('input'))).toBe('input')
  })
})

describe('shadowHostPathFor', () => {
  it('is null in the document', () => {
    render('<input id="code">')

    expect(shadowHostPathFor(input('#code'))).toBeNull()
  })

  it('names the hosts outermost first', () => {
    render('<div id="outer"></div>')
    const outer = document.querySelector('#outer')
    if (outer === null) throw new Error('no host')
    const outerRoot = outer.attachShadow({ mode: 'open' })
    outerRoot.innerHTML = '<x-inner id="inner"></x-inner>'

    const inner = outerRoot.querySelector('#inner')
    if (inner === null) throw new Error('no inner host')
    const innerRoot = inner.attachShadow({ mode: 'open' })
    innerRoot.innerHTML = '<input id="code">'

    const field = innerRoot.querySelector('#code')
    if (field === null) throw new Error('no field')

    expect(shadowHostPathFor(field)).toBe('#outer >> #inner')
  })
})
