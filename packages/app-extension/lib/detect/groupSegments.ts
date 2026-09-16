/**
 * Recognises a row of single-character boxes as one otp field.
 *
 * Common enough -- most hosted login flows render six boxes rather than one
 * input -- that missing it means missing a large share of real sites. Each box
 * on its own is a one-character text input with no name worth reading; only
 * the row means anything.
 * @module
 */

/** Runs shorter than this are not an otp code; longer ones are something else. */
const MIN_SEGMENTS = 4
const MAX_SEGMENTS = 10

/** Types a single-character box is plausibly rendered as. */
const SEGMENT_TYPES = new Set(['', 'text', 'tel', 'number', 'password'])

export interface SegmentGroup {
  readonly elements: readonly HTMLInputElement[]
  /** The nearest element containing the whole run, and nothing else typeable. */
  readonly container: Element
}

/**
 * Whether an input could be one box of a segmented row.
 *
 * Deliberately says nothing about `disabled`. Many implementations enable
 * only the first box and enable each next one as you type, so filtering
 * disabled inputs here would silently reduce every six-box widget to a
 * one-box detection -- which then scores as a one-character field and is
 * thrown away.
 * @param input - The input to test.
 * @returns Whether it looks like a single-character box.
 */
export const isSegmentCandidate = (input: HTMLInputElement): boolean => {
  if (!SEGMENT_TYPES.has(input.type.toLowerCase())) return false
  if (input.maxLength === 1) return true
  // Some widgets set only `size`, leaving maxlength unset (-1 in the dom).
  return input.maxLength < 0 && input.size === 1
}

/**
 * Strips the index off one box's name, so the row reads as a word.
 *
 * `otp-0`, `code[1]` and `digit3` all mean "digit of otp"; scoring them with
 * the number attached loses the only word in them.
 * @param value - The raw name or id.
 * @returns The value without a trailing index.
 */
export const stripSegmentIndex = (value: string): string =>
  value.replace(/[-_]?\[?\d+\]?$/, '')

const commonAncestorOf = (elements: readonly Element[]): Element | null => {
  const [first, ...rest] = elements
  if (first === undefined) return null

  let ancestor: Element | null = first.parentElement
  while (ancestor !== null) {
    const current = ancestor
    if (rest.every((element) => current.contains(element))) return current
    ancestor = ancestor.parentElement
  }
  return null
}

/**
 * Partitions inputs into segmented rows and everything else.
 *
 * A run is consecutive segment candidates, in document order, sharing one
 * form, whose common ancestor contains no other input. That last condition is
 * what keeps the per-box wrapper `<div>`s that every implementation uses from
 * needing a depth heuristic, and what stops a row absorbing the submit field
 * next to it.
 * @param inputs - Visible inputs, in document order.
 * @returns The rows found, and the inputs that belong to none of them.
 */
export const groupSegmentedInputs = (
  inputs: readonly HTMLInputElement[],
): { groups: SegmentGroup[]; ungrouped: HTMLInputElement[] } => {
  const groups: SegmentGroup[] = []
  const grouped = new Set<HTMLInputElement>()

  let run: HTMLInputElement[] = []

  const flush = (): void => {
    if (run.length >= MIN_SEGMENTS && run.length <= MAX_SEGMENTS) {
      const container = commonAncestorOf(run)
      if (
        container !== null &&
        container.querySelectorAll('input').length === run.length
      ) {
        groups.push({ elements: run, container })
        for (const element of run) grouped.add(element)
      }
    }
    run = []
  }

  for (const input of inputs) {
    if (!isSegmentCandidate(input)) {
      flush()
      continue
    }
    if (run.length > 0 && run[0]?.form !== input.form) flush()
    run.push(input)
  }
  flush()

  return {
    groups,
    ungrouped: inputs.filter((input) => !grouped.has(input)),
  }
}
