/**
 * Flattens a dom input into the `FieldSignals` record the scorer reads.
 *
 * Everything dom-shaped and fiddly lives here -- label association, the text
 * around an unlabelled field, and what the surrounding form is for -- so that
 * `scoreField.ts` can stay arithmetic.
 * @module
 */

import { CARD_CVC_RE, CARD_FIELD_RE, matchesAnySignal } from './patterns'
import { emptySignals } from './signals'
import type { FieldSignals } from './signals'
import { isPlausiblyVisible } from './visibility'

/** Input types that could plausibly hold a typed code. */
const TEXTUAL_INPUT_TYPES = new Set([
  '',
  'text',
  'tel',
  'number',
  'password',
  'search',
])

/** How much text before an unlabelled field is worth reading. */
const MAX_NEARBY_TEXT = 120

/**
 * How many inputs a container needs before it counts as a form in its own
 * right. Sites that skip `<form>` entirely still group their fields in a
 * `<div>`, and the context signals are worthless without some scope.
 */
const MIN_INPUTS_FOR_FALLBACK_SCOPE = 3

/** What the scorer needs to know about the form around a field. */
interface ScopeFacts {
  accessibleName: string
  textInputCount: number
  hasCreditCardField: boolean
  hasPasswordField: boolean
}

const textOf = (element: Element | null): string =>
  element?.textContent?.trim() ?? ''

/**
 * Parses an `autocomplete` attribute into its tokens.
 *
 * The attribute is a space-separated list -- "section-login one-time-code
 * webauthn" is legal and common -- so the whole attribute is never the answer
 * to "is this one-time-code".
 * @param element - The element to read.
 * @returns The lowercased tokens, or an empty array.
 */
export const autocompleteTokensOf = (element: Element): string[] => {
  const raw = element.getAttribute('autocomplete')
  if (raw === null || raw.trim() === '') return []
  return raw.toLowerCase().trim().split(/\s+/)
}

/** Resolves the text of whatever labels an input. */
const labelTextFor = (input: HTMLInputElement): string => {
  const parts: string[] = []

  const labelledBy = input.getAttribute('aria-labelledby')
  if (labelledBy !== null) {
    const root = input.getRootNode() as Document | ShadowRoot
    for (const id of labelledBy.split(/\s+/)) {
      if (id === '') continue
      parts.push(textOf(root.querySelector(`#${CSS.escape(id)}`)))
    }
  }

  // `labels` covers both `for=` and an ancestor `<label>`, and is the only
  // thing that gets the association rules right in every case.
  for (const label of input.labels ?? []) parts.push(textOf(label))

  return parts.filter((part) => part !== '').join(' ')
}

/**
 * The text immediately before an unlabelled field.
 *
 * Plenty of otp prompts are a bare `<p>Enter the code we sent</p>` above a
 * bare `<input>`, with no label and no useful name. Bounded hard: this walks
 * upwards, and without a cap a field low in the dom would end up reading the
 * whole page.
 */
export const nearbyTextFor = (element: Element): string => {
  const parts: string[] = []
  let current: Element | null = element

  for (let depth = 0; depth < 3 && current !== null; depth += 1) {
    let sibling: Element | null = current.previousElementSibling
    for (let seen = 0; sibling !== null && seen < 2; seen += 1) {
      const text = textOf(sibling)
      if (text !== '') parts.unshift(text)
      sibling = sibling.previousElementSibling
    }
    if (parts.length > 0) break
    current = current.parentElement
  }

  return parts.join(' ').slice(0, MAX_NEARBY_TEXT)
}

/** Finds the form, or the nearest container substantial enough to stand in. */
const scopeFor = (input: HTMLInputElement): Element | null => {
  if (input.form !== null) return input.form

  let current: Element | null = input.parentElement
  while (current !== null) {
    if (
      current.querySelectorAll('input').length >= MIN_INPUTS_FOR_FALLBACK_SCOPE
    ) {
      return current
    }
    current = current.parentElement
  }
  return input.parentElement
}

const accessibleNameOf = (scope: Element): string => {
  const aria = scope.getAttribute('aria-label')
  if (aria !== null && aria.trim() !== '') return aria.trim()

  const labelledBy = scope.getAttribute('aria-labelledby')
  if (labelledBy !== null) {
    const root = scope.getRootNode() as Document | ShadowRoot
    const text = textOf(root.querySelector(`#${CSS.escape(labelledBy)}`))
    if (text !== '') return text
  }

  return textOf(scope.querySelector('legend, h1, h2, h3')).slice(
    0,
    MAX_NEARBY_TEXT,
  )
}

const factsFor = (scope: Element): ScopeFacts => {
  const inputs = [...scope.querySelectorAll('input')]
  let textInputCount = 0
  let hasCreditCardField = false
  let hasPasswordField = false

  for (const input of inputs) {
    const tokens = autocompleteTokensOf(input)
    const naming = [input.name, input.id, ...tokens]

    if (
      tokens.some((token) => token.startsWith('cc-')) ||
      matchesAnySignal(CARD_FIELD_RE, naming) ||
      matchesAnySignal(CARD_CVC_RE, naming)
    ) {
      hasCreditCardField = true
    }
    if (input.type === 'password') hasPasswordField = true
    if (
      input.type !== 'password' &&
      TEXTUAL_INPUT_TYPES.has(input.type) &&
      isPlausiblyVisible(input)
    ) {
      textInputCount += 1
    }
  }

  return {
    accessibleName: accessibleNameOf(scope),
    textInputCount,
    hasCreditCardField,
    hasPasswordField,
  }
}

/**
 * Builds a signal collector.
 *
 * A factory rather than a bare function so that the per-scope facts -- which
 * mean walking every input in the form -- are computed once per form instead
 * of once per field. On a checkout page with thirty inputs that is the
 * difference between one pass and thirty.
 * @returns A function mapping an input to its signals.
 */
export const createSignalCollector = (): ((
  input: HTMLInputElement,
  segmentCount?: number,
) => FieldSignals) => {
  const scopeCache = new WeakMap<Element, ScopeFacts>()

  const factsCached = (scope: Element): ScopeFacts => {
    const cached = scopeCache.get(scope)
    if (cached !== undefined) return cached
    const facts = factsFor(scope)
    scopeCache.set(scope, facts)
    return facts
  }

  return (input, segmentCount = 1) => {
    const scope = scopeFor(input)
    const facts =
      scope === null
        ? {
            accessibleName: '',
            textInputCount: 0,
            hasCreditCardField: false,
            hasPasswordField: false,
          }
        : factsCached(scope)

    const maxLength = input.maxLength
    const pattern = input.getAttribute('pattern')

    return {
      ...emptySignals(),
      type: input.type.toLowerCase(),
      autocompleteTokens: autocompleteTokensOf(input),
      name: input.name,
      id: input.id,
      placeholder: input.placeholder,
      ariaLabel: input.getAttribute('aria-label') ?? '',
      title: input.title,
      testId: input.getAttribute('data-testid') ?? '',
      labelText: labelTextFor(input),
      nearbyText: nearbyTextFor(input),
      inputMode: (input.getAttribute('inputmode') ?? '').toLowerCase(),
      pattern,
      // The dom reports an unset maxlength as -1, which would read as a very
      // short field rather than as an absent signal.
      maxLength: maxLength > 0 ? maxLength : null,
      segmentCount,
      formAccessibleName: facts.accessibleName,
      // Compared against `segmentCount`, so a row of six boxes counts as the
      // sole field of its form in exactly the way a single input does.
      isOnlyTextInputInForm: facts.textInputCount === segmentCount,
      formHasCreditCardField: facts.hasCreditCardField,
      formHasPasswordField: facts.hasPasswordField,
    }
  }
}
