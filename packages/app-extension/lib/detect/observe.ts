/**
 * Rescanning when the page changes.
 *
 * A single scan at load is not enough. The overwhelmingly common shape of a
 * second-factor prompt is step two of a single-page login: at load there is a
 * username box and nothing else, and the otp field appears only after the
 * first step resolves.
 * @module
 */

import { detectOtpFields } from './detectOtpFields'
import type { DetectionOptions, DetectionResult } from './detectOtpFields'
import { collectRoots, DEFAULT_MAX_SHADOW_ROOTS } from './walkDom'

/**
 * Attributes worth re-reading a field for.
 *
 * `class` and `style` are deliberately absent. They re-fire continuously on
 * any page with an animation for almost no signal, and an unfiltered
 * attribute observer on a react app is a firehose. The cost is missing a
 * field revealed purely by a class change, which `rescan()` on focus covers
 * far more cheaply.
 */
const WATCHED_ATTRIBUTES = [
  'autocomplete',
  'inputmode',
  'maxlength',
  'pattern',
  'type',
  'name',
  'id',
  'placeholder',
  'aria-label',
  'hidden',
  'disabled',
]

const DEFAULT_DEBOUNCE_MS = 150
/** However busy the page, it gets scanned this often. */
const DEFAULT_MAX_WAIT_MS = 1000

export interface ObserveOptions extends DetectionOptions {
  /** Called only when the detected set actually differs from the last one. */
  onChange: (result: DetectionResult) => void
  debounceMs?: number
  maxWaitMs?: number
  /**
   * Timer functions. The content script passes wxt's `ContentScriptContext`,
   * whose timers are cancelled when the extension reloads -- otherwise every
   * open tab keeps an orphaned observer running against a dead script.
   */
  timers?: {
    setTimeout: (callback: () => void, ms: number) => number
    clearTimeout: (id: number) => void
  }
}

export interface OtpFieldObserver {
  /** Scan now, bypassing the debounce. */
  rescan: () => void
  /**
   * Scans and hands the result back, whether or not anything changed.
   *
   * `rescan` answers an unchanged page with silence, because its only output
   * is `onChange` and a form that re-renders per keystroke would otherwise
   * spam the background with identical reports. The background asks for this
   * one when its own registry is empty or suspect -- where "nothing has
   * changed since you last heard" is precisely the answer it cannot use.
   *
   * It still goes through the observer rather than calling `detectOtpFields`
   * directly, so the selectors and the fingerprint keep a single owner. A scan
   * run beside the observer would leave `lastFingerprint` describing a
   * different set and could suppress a later report that mattered.
   * @returns What is on the page now, or nothing once stopped.
   */
  scanNow: () => DetectionResult
  /**
   * Replaces the entry `inputSelector` overrides and rescans with them.
   *
   * The frame cannot know these when it starts: they live in the vault, which
   * only the background can read. So the first scan is always heuristic-only
   * and the overrides arrive a round trip later.
   * @param next - The selectors now in force.
   */
  setInputSelectors: (next: readonly string[]) => void
  stop: () => void
}

/** A cheap identity for a result set, to suppress unchanged reports. */
const fingerprint = (result: DetectionResult): string =>
  // overrideMissed is part of the identity: a saved selector that has gone
  // stale is a finding in itself, and on a frame with no fields it is the only
  // thing that changes when the overrides do.
  `${result.overrideMissed ? '!' : ''}${result.handles
    .map(
      ({ field }) =>
        `${field.id}:${field.confidence}:${String(field.score)}:${String(field.segmentCount)}`,
    )
    .join('|')}`

/**
 * Whether a batch of mutations could possibly have changed the answer.
 *
 * Runs on every batch, so it must stay O(records) and must not query the dom.
 * The debounce is what makes observing safe, not this -- this only keeps the
 * common no-op batch from arming a timer.
 */
const isRelevant = (records: readonly MutationRecord[]): boolean =>
  records.some((record) => {
    if (record.type === 'attributes') return true
    for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) return true
    }
    return record.removedNodes.length > 0
  })

/**
 * Watches a page and reports the otp fields on it as they change.
 *
 * Starts scanning immediately and then on mutation. Deliberately
 * start-on-demand rather than self-starting from the content script's `load`:
 * the shape this wants to grow into is that nothing runs until the background
 * confirms the url has matching entries, and retrofitting that later is far
 * more invasive than leaving the seam here now.
 * @param options - See {@link ObserveOptions}.
 * @returns A handle to rescan or stop.
 */
export const observeOtpFields = (options: ObserveOptions): OtpFieldObserver => {
  const {
    onChange,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
    timers = {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    },
    ...detectionOptions
  } = options

  const root = detectionOptions.root ?? document
  const maxShadowRoots =
    detectionOptions.maxShadowRoots ?? DEFAULT_MAX_SHADOW_ROOTS

  let inputSelectors: readonly string[] = detectionOptions.inputSelectors ?? []

  const observed = new WeakSet<Document | ShadowRoot>()
  const observers: MutationObserver[] = []
  let pending: number | null = null
  let firstPendingAt = 0
  let lastFingerprint: string | null = null
  let stopped = false

  const observeRoot = (scope: Document | ShadowRoot): void => {
    if (observed.has(scope)) return
    observed.add(scope)
    const observer = new MutationObserver((records) => {
      if (isRelevant(records)) schedule()
    })
    // A subtree observer does not cross a shadow boundary, so each root needs
    // its own or updates inside web components are silently missed.
    observer.observe(
      scope instanceof Document ? scope.documentElement : scope,
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: WATCHED_ATTRIBUTES,
      },
    )
    observers.push(observer)
  }

  const scan = (): DetectionResult => {
    pending = null
    firstPendingAt = 0

    for (const scope of collectRoots(root, maxShadowRoots)) observeRoot(scope)

    const result = detectOtpFields({ ...detectionOptions, inputSelectors })
    const current = fingerprint(result)
    // A six-digit form that re-renders on every keystroke would otherwise spam
    // the background with identical reports.
    if (current !== lastFingerprint) {
      lastFingerprint = current
      onChange(result)
    }
    return result
  }

  /** What a stopped observer reports: nothing, rather than a stale answer. */
  const NOTHING: DetectionResult = {
    handles: [],
    overrideMissed: false,
    scannedRoots: 0,
  }

  /** The scheduled entry point, which a stopped observer ignores. */
  const scanUnlessStopped = (): void => {
    if (stopped) return
    scan()
  }

  function schedule(): void {
    if (stopped) return
    const now = Date.now()
    if (pending !== null) {
      // Never let a continuously-mutating page starve the scan entirely.
      if (now - firstPendingAt >= maxWaitMs) return
      timers.clearTimeout(pending)
    } else {
      firstPendingAt = now
    }
    pending = timers.setTimeout(scanUnlessStopped, debounceMs)
  }

  scan()

  return {
    rescan: scanUnlessStopped,
    scanNow: () => (stopped ? NOTHING : scan()),
    setInputSelectors: (next) => {
      inputSelectors = next
      scanUnlessStopped()
    },
    stop: () => {
      stopped = true
      if (pending !== null) timers.clearTimeout(pending)
      pending = null
      for (const observer of observers) observer.disconnect()
      observers.length = 0
    },
  }
}
