/**
 * The flattened description of one candidate field that the scorer reads.
 *
 * This is the seam the whole module is built around. Everything above it
 * walks the dom; everything below it is arithmetic over a plain object. That
 * means the part with all the judgement in it -- which words count, how much,
 * and what vetoes what -- has a regression suite that is a table of literals,
 * with no fixtures and no document.
 * @module
 */

/** One candidate field, as plain data. */
export interface FieldSignals {
  /** The `type` attribute, lowercased. `'text'` when absent. */
  type: string
  /** The `autocomplete` attribute parsed as the space-separated token list it is. */
  autocompleteTokens: readonly string[]
  name: string
  id: string
  placeholder: string
  ariaLabel: string
  title: string
  /** `data-testid`, which is often the most honest name on the page. */
  testId: string
  /** The associated `<label>`, via `for=`, an ancestor label, or aria-labelledby. */
  labelText: string
  /** Bounded text immediately preceding the field, for unlabelled inputs. */
  nearbyText: string
  inputMode: string
  pattern: string | null
  maxLength: number | null
  /** 1 for a single input; N for a segmented row scored as one unit. */
  segmentCount: number
  /** The enclosing form's accessible name, or the fallback container's. */
  formAccessibleName: string
  /** Whether this is the only visible text-ish input in its form. */
  isOnlyTextInputInForm: boolean
  /** Whether the form also holds a credit-card field. Resolves the cvc collision. */
  formHasCreditCardField: boolean
  /** Whether the form also holds a password field. A two-step login tell. */
  formHasPasswordField: boolean
}

/**
 * A `FieldSignals` with everything empty, to be spread over in tests and in
 * the dom collector.
 *
 * Exported rather than inlined so that adding a signal is a one-line change
 * here instead of a sweep through every test case.
 * @returns A neutral signal record.
 */
export const emptySignals = (): FieldSignals => ({
  type: 'text',
  autocompleteTokens: [],
  name: '',
  id: '',
  placeholder: '',
  ariaLabel: '',
  title: '',
  testId: '',
  labelText: '',
  nearbyText: '',
  inputMode: '',
  pattern: null,
  maxLength: null,
  segmentCount: 1,
  formAccessibleName: '',
  isOnlyTextInputInForm: false,
  formHasCreditCardField: false,
  formHasPasswordField: false,
})

/** The signals that name the field itself. The strongest textual evidence. */
export const identifyingText = (signals: FieldSignals): string[] => [
  signals.name,
  signals.id,
  signals.testId,
  // A non-standard autocomplete value -- sites write autocomplete="otp" -- is
  // as good as a name. The standard tokens are handled separately.
  ...signals.autocompleteTokens,
]

/** The signals a human reads off the screen. Nearly as strong. */
export const describingText = (signals: FieldSignals): string[] => [
  signals.placeholder,
  signals.ariaLabel,
  signals.title,
  signals.labelText,
]
