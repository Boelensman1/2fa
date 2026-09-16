/**
 * Typing a code into a field the way a user would.
 *
 * Deliberately knows nothing about the vault, the menu or messaging -- it
 * takes elements and a string. That makes it the one part of the autofill path
 * with real test coverage, which matters because this is also the part most
 * likely to quietly do nothing on a real widget.
 *
 * Derived from the html spec's value-setter semantics and the fixtures in
 * `tests/fixtures/otpFields/`. Bitwarden's autofill is GPL-3.0 and must not be
 * read while working on this file; see AGENTS.md.
 * @module
 */

import type { FillResult } from '../types/Autofill'

export type { FillResult }

export interface FillOptions {
  /**
   * Yields to the browser between segmented boxes.
   *
   * Injectable so the suite can run the loop synchronously; a test that really
   * waited six frames under fake timers would hang.
   */
  nextFrame?: () => Promise<void>
}

/**
 * The value setter from the prototype, not from the element.
 *
 * React installs its own `value` accessor on the node to track changes.
 * Assigning through it leaves React's tracker believing nothing changed, so
 * the next render puts the old value back and the field appears to reject the
 * fill. Going through the prototype's setter bypasses the tracker, which is
 * what makes React notice the subsequent `input` event.
 *
 * On Firefox this is a no-op that costs nothing: a content script sees page
 * objects through Xray vision, where page-defined own properties -- React's
 * accessor is exactly that -- are invisible, so a plain assignment already
 * reaches the native setter. Written once rather than branched, because the
 * behaviour is identical and only the reason differs.
 */
/* eslint-disable @typescript-eslint/unbound-method --
   Detaching this setter from its prototype is the entire point; it is only
   ever invoked as `.call(element, value)`, never as a method. */
const nativeValueSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'value',
)?.set
/* eslint-enable @typescript-eslint/unbound-method */

const setValue = (element: HTMLInputElement, value: string): void => {
  if (nativeValueSetter) {
    nativeValueSetter.call(element, value)
  } else {
    element.value = value
  }
}

/**
 * Fires the `input` event a framework will actually listen to.
 *
 * An `InputEvent` rather than a plain `Event`, because hand-rolled otp widgets
 * routinely branch on `inputType` to tell typing from deleting, and read
 * `event.data` -- which is `undefined` on a plain `Event` and throws the
 * moment anything reads `.length` off it.
 * @param element - The input to fire on.
 * @param data - The characters that were "typed".
 */
const dispatchInput = (element: HTMLInputElement, data: string): void => {
  const event =
    typeof InputEvent === 'function'
      ? new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: 'insertText',
          data,
        })
      : new Event('input', { bubbles: true })

  element.dispatchEvent(event)
}

const dispatchChange = (element: HTMLInputElement): void => {
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

/** `setSelectionRange` throws on input types that have no text selection. */
const putCaretAtEnd = (element: HTMLInputElement): void => {
  try {
    element.setSelectionRange(element.value.length, element.value.length)
  } catch {
    /* number and tel inputs do not support selection; nothing to do */
  }
}

/**
 * Writes one box.
 *
 * `focus()` first, because widgets that advance on input read
 * `document.activeElement` to decide where to move next. A disabled box cannot
 * take focus -- and will not have a handler run either -- but the value is
 * still worth setting: the common pattern enables the box a moment later and
 * reads what is already there.
 * @param element - The input to write.
 * @param value - What to put in it.
 */
const fillOne = (element: HTMLInputElement, value: string): void => {
  if (!element.disabled) element.focus()
  setValue(element, value)
  dispatchInput(element, value)
  dispatchChange(element)
}

const rafNextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })

/**
 * Types a code into a detected field.
 *
 * Nothing here submits: no `Enter`, no `requestSubmit()`, no click on a submit
 * button. That is as far as the promise goes -- plenty of sites submit
 * themselves the instant the value is complete, and that is their decision to
 * make, not something this can prevent.
 * @param elements - The field's inputs: one, or a segmented row in document order.
 * @param otp - The code to type.
 * @param options - See {@link FillOptions}.
 * @returns What happened, so the menu can say so rather than closing silently.
 */
export const fillOtpField = async (
  elements: readonly HTMLInputElement[],
  otp: string,
  options: FillOptions = {},
): Promise<FillResult> => {
  const { nextFrame = rafNextFrame } = options

  const code = otp.trim()
  if (code === '') return { filled: false, reason: 'empty-code' }

  const first = elements[0]
  if (!first?.isConnected) {
    return { filled: false, reason: 'gone' }
  }

  if (elements.length === 1) {
    fillOne(first, code)
    putCaretAtEnd(first)
    return { filled: true }
  }

  const characters = [...code]

  fillOne(first, characters[0] ?? '')
  await nextFrame()

  // Several widgets treat a multi-character value as a paste and spread it
  // across the rest of the row themselves. Carrying on from here would then
  // write every character twice and produce 112233.
  if (elements.every((element) => element.value.length > 0)) {
    return {
      filled: true,
      ...(characters.length === elements.length ? {} : { reason: 'partial' }),
    }
  }

  for (let index = 1; index < characters.length; index += 1) {
    // Re-read rather than hoisting: the overwhelmingly common shape enables
    // box i+1 only in response to box i, which is why `isSegmentCandidate`
    // deliberately does not filter disabled inputs.
    const element = elements[index]
    if (element === undefined) break
    if (!element.isConnected) return { filled: false, reason: 'gone' }

    fillOne(element, characters[index] ?? '')
    await nextFrame()
  }

  return {
    filled: true,
    ...(characters.length === elements.length ? {} : { reason: 'partial' }),
  }
}
