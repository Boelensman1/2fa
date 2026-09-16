/**
 * Assembles the parts into one scan of a page.
 * @module
 */

import { createSignalCollector, nearbyTextFor } from './collectSignals'
import { groupSegmentedInputs, stripSegmentIndex } from './groupSegments'
import type { SegmentGroup } from './groupSegments'
import { scoreCandidate } from './scoreField'
import type { FieldSignals } from './signals'
import { cssPathFor, describeElement, shadowHostPathFor } from './selector'
import type {
  DetectedOtpField,
  DetectedOtpFieldHandle,
  DetectionSource,
  OtpConfidence,
} from './types'
import { isPlausiblyVisible } from './visibility'
import {
  DEFAULT_MAX_SHADOW_ROOTS,
  collectInputs,
  collectRoots,
} from './walkDom'

export interface DetectionOptions {
  /** Defaults to the ambient `document`. */
  root?: Document | ShadowRoot
  /** The `inputSelector` of every entry matching this page's url. */
  inputSelectors?: readonly string[]
  /** Lowest band to report. Defaults to `possible`. */
  minConfidence?: OtpConfidence
  /** Injectable so the fixture suite can test the policy without layout. */
  isVisible?: (element: Element) => boolean
  maxShadowRoots?: number
}

export interface DetectionResult {
  handles: DetectedOtpFieldHandle[]
  /**
   * An entry supplied a selector and it matched nothing.
   *
   * Cheap to record now and impossible to reconstruct later; it is how a
   * later step can tell the user their saved override has gone stale rather
   * than silently falling back to the heuristic forever.
   */
  overrideMissed: boolean
  scannedRoots: number
}

const CONFIDENCE_ORDER: Record<OtpConfidence, number> = {
  possible: 0,
  likely: 1,
  definite: 2,
}

/**
 * Ids, stable for a surviving element across rescans within one page load.
 *
 * A `WeakMap` rather than the css path, because the path changes whenever the
 * page re-renders and the whole point of the id is that it does not.
 */
const ids = new WeakMap<Element, string>()
let nextId = 0

const idFor = (element: Element): string => {
  const existing = ids.get(element)
  if (existing !== undefined) return existing
  nextId += 1
  const id = `otp-${String(nextId)}`
  ids.set(element, id)
  return id
}

/**
 * Folds a segmented row's signals into one field's worth.
 *
 * The row is read through its first box, with three corrections: the index is
 * stripped off the name so `otp-0` reads as a word, the container's label
 * stands in when the boxes have none, and the expected length becomes the
 * number of boxes rather than the 1 each box reports. That last one matters --
 * without it a six-box row scores as an implausibly short field.
 */
const signalsForGroup = (
  collect: (input: HTMLInputElement, segmentCount?: number) => FieldSignals,
  group: SegmentGroup,
): FieldSignals | null => {
  const first = group.elements[0]
  if (first === undefined) return null

  const base = collect(first, group.elements.length)
  const containerLabel = group.container.getAttribute('aria-label') ?? ''

  return {
    ...base,
    name: stripSegmentIndex(base.name),
    id: stripSegmentIndex(base.id),
    testId: stripSegmentIndex(base.testId),
    ariaLabel: base.ariaLabel === '' ? containerLabel : base.ariaLabel,
    nearbyText:
      base.nearbyText === '' ? nearbyTextFor(group.container) : base.nearbyText,
    maxLength: group.elements.length,
  }
}

const handleFor = (
  elements: readonly HTMLInputElement[],
  signals: FieldSignals,
  source: DetectionSource,
  confidence: OtpConfidence,
  score: number,
  reasons: DetectedOtpField['reasons'],
  matchedInputSelectors: string[],
): DetectedOtpFieldHandle | null => {
  const first = elements[0]
  if (first === undefined) return null

  return {
    field: {
      id: idFor(first),
      kind: elements.length > 1 ? 'segmented' : 'single',
      confidence,
      score,
      source,
      reasons,
      selector: cssPathFor(first),
      elementDescription: describeElement(first),
      expectedLength: signals.maxLength,
      segmentCount: elements.length,
      matchedInputSelectors,
      inShadowRoot: first.getRootNode() !== first.ownerDocument,
      shadowHostPath: shadowHostPathFor(first),
    },
    elements,
  }
}

/**
 * Resolves an entry's `inputSelector` overrides against one root.
 *
 * A selector arriving from a synced vault is untrusted input and may be
 * syntactically invalid, so each runs in its own try/catch -- one bad entry
 * must not take down detection for the page. Length and newlines are already
 * bounded by favalib's `entryValidation.mts`, so they are not re-checked here.
 *
 * Applied per root, shadow roots included, because no `querySelector` syntax
 * crosses a shadow boundary: an override naming an element inside a component
 * can only ever match when tried against that component's own root.
 */
const resolveOverrides = (
  root: Document | ShadowRoot,
  selectors: readonly string[],
): Map<HTMLInputElement, string[]> => {
  const matched = new Map<HTMLInputElement, string[]>()

  for (const selector of selectors) {
    let elements: Element[]
    try {
      elements = [...root.querySelectorAll(selector)]
    } catch {
      continue
    }

    for (const element of elements) {
      // Users point a selector at the wrapper div surprisingly often; descend
      // rather than failing.
      const input =
        element instanceof HTMLInputElement
          ? element
          : element.querySelector('input')
      if (input === null) continue
      matched.set(input, [...(matched.get(input) ?? []), selector])
    }
  }

  return matched
}

/**
 * Scans a page for otp fields.
 * @param options - See {@link DetectionOptions}.
 * @returns The fields found, highest confidence first.
 */
export const detectOtpFields = (
  options: DetectionOptions = {},
): DetectionResult => {
  const {
    root = document,
    inputSelectors = [],
    minConfidence = 'possible',
    isVisible = isPlausiblyVisible,
    maxShadowRoots = DEFAULT_MAX_SHADOW_ROOTS,
  } = options

  const roots = collectRoots(root, maxShadowRoots)
  const collect = createSignalCollector()

  if (inputSelectors.length > 0) {
    const handles: DetectedOtpFieldHandle[] = []
    for (const scope of roots) {
      for (const [input, selectors] of resolveOverrides(
        scope,
        inputSelectors,
      )) {
        const handle = handleFor(
          [input],
          collect(input),
          'inputSelector',
          'definite',
          100,
          [
            {
              code: 'inputSelectorOverride',
              weight: 100,
              detail: selectors[0],
            },
          ],
          selectors,
        )
        if (handle !== null) handles.push(handle)
      }
    }

    // The heuristic is suppressed, not merged. The user wrote a selector
    // precisely because the heuristic picked the wrong box; offering that box
    // again alongside the right one reinstates the bug.
    if (handles.length > 0) {
      return { handles, overrideMissed: false, scannedRoots: roots.length }
    }
  }

  const inputs = collectInputs(roots, isVisible)
  const { groups, ungrouped } = groupSegmentedInputs(inputs)
  const handles: DetectedOtpFieldHandle[] = []

  const consider = (
    elements: readonly HTMLInputElement[],
    signals: FieldSignals | null,
  ): void => {
    if (signals === null) return
    const result = scoreCandidate(signals)
    if (result.verdict === 'reject' || result.confidence === null) return
    if (CONFIDENCE_ORDER[result.confidence] < CONFIDENCE_ORDER[minConfidence]) {
      return
    }

    const source: DetectionSource =
      result.confidence === 'definite' ? 'autocomplete' : 'heuristic'
    const handle = handleFor(
      elements,
      signals,
      source,
      result.confidence,
      result.score,
      result.reasons,
      [],
    )
    if (handle !== null) handles.push(handle)
  }

  for (const group of groups) {
    consider(group.elements, signalsForGroup(collect, group))
  }
  for (const input of ungrouped) consider([input], collect(input))

  handles.sort((a, b) => b.field.score - a.field.score)

  return {
    handles,
    overrideMissed: inputSelectors.length > 0,
    scannedRoots: roots.length,
  }
}
