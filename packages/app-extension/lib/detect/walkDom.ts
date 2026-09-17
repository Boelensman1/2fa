/**
 * Enumerating the inputs on a page, shadow roots included.
 * @module
 */

/**
 * How many shadow roots one scan will descend into.
 *
 * Design-system-heavy pages have thousands of shadow hosts, and an unbounded
 * walk on one of those is a real hang on every page load. The bound is a
 * safety valve, not a tuning knob: a page with more than this many components
 * above an otp field is not a page we were going to get right anyway.
 */
export const DEFAULT_MAX_SHADOW_ROOTS = 50

/**
 * Collects a root and every open shadow root beneath it.
 *
 * Closed roots are unreachable and stay that way. The way to reach into one
 * is to monkeypatch `Element.prototype.attachShadow` from a main-world
 * injection, which is a page-visible side effect that breaks sites and
 * changes the extension's whole store-review posture. `EntryMeta.inputSelector`
 * is the escape hatch for those pages instead.
 * @param start - The root to walk.
 * @param maxShadowRoots - How many shadow roots to descend into.
 * @returns The roots, `start` first.
 */
export const collectRoots = (
  start: Document | ShadowRoot,
  maxShadowRoots: number = DEFAULT_MAX_SHADOW_ROOTS,
): (Document | ShadowRoot)[] => {
  const roots: (Document | ShadowRoot)[] = [start]
  const queue: (Document | ShadowRoot)[] = [start]

  while (queue.length > 0 && roots.length <= maxShadowRoots) {
    const root = queue.shift()
    if (root === undefined) break
    for (const element of root.querySelectorAll('*')) {
      const shadow = element.shadowRoot
      if (shadow === null) continue
      roots.push(shadow)
      queue.push(shadow)
      if (roots.length > maxShadowRoots) break
    }
  }

  return roots.slice(0, maxShadowRoots)
}

/**
 * Collects the inputs of several roots, in document order within each.
 * @param roots - The roots to read.
 * @param isVisible - The visibility filter to apply.
 * @returns The visible inputs.
 */
export const collectInputs = (
  roots: readonly (Document | ShadowRoot)[],
  isVisible: (element: Element) => boolean,
): HTMLInputElement[] =>
  roots.flatMap((root) => [...root.querySelectorAll('input')].filter(isVisible))
