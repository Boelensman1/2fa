import { describe, it, expect, beforeEach } from 'vitest'

import {
  deepActiveElement,
  newlyFocusedField,
} from '../../lib/content/focusedField'
import { detectOtpFields } from '../../lib/detect'
import type { DetectedOtpFieldHandle } from '../../lib/detect'

/** Scans the page and returns what the content script would remember. */
const scan = () => {
  const owners = new Map<Element, DetectedOtpFieldHandle>()
  const { handles } = detectOtpFields({ isVisible: () => true })
  for (const handle of handles) {
    for (const element of handle.elements) owners.set(element, handle)
  }
  return {
    handles,
    ownerOf: (element: Element) => owners.get(element),
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('deepActiveElement', () => {
  it('follows focus into an open shadow root', () => {
    document.body.innerHTML = '<div id="host"></div>'
    const shadow = document.querySelector('#host')?.attachShadow({
      mode: 'open',
    })
    if (shadow === undefined) throw new Error('no shadow root')
    shadow.innerHTML = '<input id="inner">'
    const inner = shadow.querySelector('input')
    inner?.focus()

    expect(document.activeElement?.id).toBe('host')
    expect(deepActiveElement(document)).toBe(inner)
  })

  it('returns the element itself outside any shadow root', () => {
    document.body.innerHTML = '<input id="plain">'
    const plain = document.querySelector('input')
    plain?.focus()

    expect(deepActiveElement(document)).toBe(plain)
  })
})

describe('newlyFocusedField', () => {
  it('offers for a focused field this scan has just found', () => {
    document.body.innerHTML =
      '<form><input id="code" autocomplete="one-time-code" autofocus></form>'
    document.querySelector<HTMLInputElement>('#code')?.focus()
    const { ownerOf } = scan()

    const handle = newlyFocusedField(
      deepActiveElement(document),
      ownerOf,
      new Set(),
    )

    expect(handle?.elements[0]?.id).toBe('code')
  })

  it('stays quiet for a field the previous scan already knew', () => {
    // The user had their focusin already, and may have dismissed the menu
    // since; a later rescan must not bring it back.
    document.body.innerHTML =
      '<form><input id="code" autocomplete="one-time-code"></form>'
    document.querySelector<HTMLInputElement>('#code')?.focus()
    const { handles, ownerOf } = scan()
    const previousIds = new Set(handles.map((handle) => handle.field.id))

    expect(
      newlyFocusedField(deepActiveElement(document), ownerOf, previousIds),
    ).toBeUndefined()
  })

  it('stays quiet when focus is not in a detected field', () => {
    document.body.innerHTML =
      '<form><input id="name" autocomplete="username"><input id="code" autocomplete="one-time-code"></form>'
    document.querySelector<HTMLInputElement>('#name')?.focus()
    const { ownerOf } = scan()

    expect(
      newlyFocusedField(deepActiveElement(document), ownerOf, new Set()),
    ).toBeUndefined()
  })

  it('stays quiet when nothing has focus', () => {
    expect(newlyFocusedField(null, () => undefined, new Set())).toBeUndefined()
  })
})
