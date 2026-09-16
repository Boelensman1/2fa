import { describe, it, expect } from 'vitest'

/**
 * A smoke test for the test environment itself, not for any of our code.
 *
 * Everything under lib/detect depends on a dom that behaves like a browser's,
 * and specifically on shadow roots, which are the one thing the two candidate
 * environments differ on most. If happy-dom is ever swapped out or
 * misconfigured, this fails first and says so plainly, rather than a hundred
 * detection tests failing for a reason that looks like a regex bug.
 */
describe('the test environment', () => {
  it('provides a dom', () => {
    document.body.innerHTML = '<input name="otp" maxlength="6">'
    const input = document.querySelector('input')

    expect(input).toBeInstanceOf(HTMLInputElement)
    expect(input?.getAttribute('name')).toBe('otp')
    expect(input?.maxLength).toBe(6)
  })

  it('provides open shadow roots', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<input autocomplete="one-time-code">'

    expect(host.shadowRoot).toBe(root)
    expect(root.querySelector('input')?.autocomplete).toBe('one-time-code')
  })

  /**
   * happy-dom does no layout: `offsetParent` is `undefined`, `offsetWidth` is
   * always 0 and `getBoundingClientRect()` always returns a zero rect, for
   * visible and hidden elements alike. So the visibility filter in
   * `lib/detect/collectFields.ts` cannot be built on any of those, and is
   * built on `checkVisibility()` instead -- which happy-dom does implement,
   * ancestors and all. This test pins that, because the day it stops being
   * true every visibility assertion in the suite goes quietly green.
   */
  it('implements checkVisibility, including ancestors', () => {
    document.body.innerHTML = `
      <input id="shown">
      <input id="own-display" style="display: none">
      <div style="display: none"><input id="inherited-display"></div>
      <div style="visibility: hidden"><input id="inherited-visibility"></div>
      <input id="transparent" style="opacity: 0">
    `
    const visible = (id: string) =>
      document.querySelector<HTMLInputElement>(`#${id}`)?.checkVisibility({
        contentVisibilityAuto: true,
        visibilityProperty: true,
      })

    expect(visible('shown')).toBe(true)
    expect(visible('own-display')).toBe(false)
    expect(visible('inherited-display')).toBe(false)
    expect(visible('inherited-visibility')).toBe(false)
    // Not passing `opacityProperty`, so a transparent field still counts. See
    // collectFields.ts for why that is deliberate.
    expect(visible('transparent')).toBe(true)
  })

  it('does no layout, which is why the above is needed', () => {
    document.body.innerHTML = '<input id="shown">'
    const shown = document.querySelector<HTMLInputElement>('#shown')

    expect(shown?.getBoundingClientRect().width).toBe(0)
    expect(shown?.offsetParent).toBeUndefined()
  })
})
