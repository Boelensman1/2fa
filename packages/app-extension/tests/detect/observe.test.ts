import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { observeOtpFields } from '../../lib/detect/observe'
import type { DetectionResult } from '../../lib/detect'

const flush = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
})

describe('observeOtpFields', () => {
  it('reports what is already on the page', () => {
    document.body.innerHTML = '<input autocomplete="one-time-code">'
    const onChange = vi.fn<(result: DetectionResult) => void>()

    const observer = observeOtpFields({ onChange })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]?.[0].handles).toHaveLength(1)
    observer.stop()
  })

  it('reports a field that only appears after the first step', async () => {
    // The overwhelmingly common shape: at load there is a username box, and
    // the otp field arrives when step one resolves.
    document.body.innerHTML = '<form><input name="username"></form>'
    const onChange = vi.fn<(result: DetectionResult) => void>()
    const observer = observeOtpFields({ onChange })

    expect(onChange.mock.calls[0]?.[0].handles).toHaveLength(0)

    document
      .querySelector('form')
      ?.insertAdjacentHTML(
        'beforeend',
        '<input name="otp_code" autocomplete="one-time-code">',
      )
    await flush(200)

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange.mock.calls[1]?.[0].handles).toHaveLength(1)
    observer.stop()
  })

  it('coalesces a burst of mutations into one scan', async () => {
    document.body.innerHTML = '<form></form>'
    const onChange = vi.fn<(result: DetectionResult) => void>()
    const observer = observeOtpFields({ onChange })
    const form = document.querySelector('form')

    for (let index = 0; index < 20; index += 1) {
      form?.insertAdjacentHTML(
        'beforeend',
        `<div data-i="${String(index)}"></div>`,
      )
    }
    form?.insertAdjacentHTML(
      'beforeend',
      '<input name="totp" autocomplete="one-time-code">',
    )
    await flush(500)

    // One initial report plus one for the whole burst.
    expect(onChange).toHaveBeenCalledTimes(2)
    observer.stop()
  })

  it('does not report again when the answer has not changed', async () => {
    document.body.innerHTML =
      '<form><input name="otp" autocomplete="one-time-code"></form>'
    const onChange = vi.fn<(result: DetectionResult) => void>()
    const observer = observeOtpFields({ onChange })

    // A form that re-renders on every keystroke would otherwise spam the
    // background with identical reports.
    document
      .querySelector('form')
      ?.insertAdjacentHTML('beforeend', '<span>irrelevant</span>')
    await flush(500)

    expect(onChange).toHaveBeenCalledTimes(1)
    observer.stop()
  })

  it('scans a continuously-mutating page anyway', async () => {
    document.body.innerHTML = '<form></form>'
    const onChange = vi.fn<(result: DetectionResult) => void>()
    const observer = observeOtpFields({ onChange, maxWaitMs: 400 })
    const form = document.querySelector('form')

    form?.insertAdjacentHTML(
      'beforeend',
      '<input name="otp" autocomplete="one-time-code">',
    )
    // Keep mutating faster than the debounce, so a plain trailing debounce
    // would never fire at all.
    for (let tick = 0; tick < 10; tick += 1) {
      form?.insertAdjacentHTML(
        'beforeend',
        `<div data-t="${String(tick)}"></div>`,
      )
      await flush(100)
    }

    expect(onChange).toHaveBeenCalledTimes(2)
    observer.stop()
  })

  it('watches shadow roots separately', async () => {
    // A subtree observer does not cross a shadow boundary.
    document.body.innerHTML = '<div id="host"></div>'
    const shadow = document
      .querySelector('#host')
      ?.attachShadow({ mode: 'open' })
    if (shadow === undefined) throw new Error('no shadow root')
    shadow.innerHTML = '<form></form>'

    const onChange = vi.fn<(result: DetectionResult) => void>()
    const observer = observeOtpFields({ onChange })

    shadow
      .querySelector('form')
      ?.insertAdjacentHTML(
        'beforeend',
        '<input name="otp" autocomplete="one-time-code">',
      )
    await flush(300)

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange.mock.calls[1]?.[0].handles[0]?.field.inShadowRoot).toBe(
      true,
    )
    observer.stop()
  })

  it('stops reporting once stopped', async () => {
    document.body.innerHTML = '<form></form>'
    const onChange = vi.fn<(result: DetectionResult) => void>()
    const observer = observeOtpFields({ onChange })
    observer.stop()

    document
      .querySelector('form')
      ?.insertAdjacentHTML('beforeend', '<input autocomplete="one-time-code">')
    await flush(500)

    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
