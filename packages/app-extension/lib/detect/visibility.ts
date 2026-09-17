/**
 * Whether a field is on screen for the user to type into.
 *
 * Worth filtering: pages leave otp inputs in the dom after a step completes,
 * and login forms carry honeypot fields that exist only to catch bots typing
 * into them.
 * @module
 */

/**
 * The options that make `checkVisibility` answer the question we are asking.
 *
 * `opacityProperty` is deliberately absent. A widespread segmented-otp pattern
 * is one real, focusable input rendered transparent underneath a row of
 * decorative boxes -- Slack and several banks do exactly this -- and testing
 * opacity would filter out the only field on the page worth filling. The same
 * reasoning rules out off-screen positioning and clip-path tests.
 */
const VISIBILITY_OPTIONS: CheckVisibilityOptions = {
  contentVisibilityAuto: true,
  visibilityProperty: true,
}

/**
 * Whether an element is plausibly visible.
 *
 * Built on `checkVisibility()` rather than on layout. `offsetParent` and
 * `getBoundingClientRect` are the obvious tools and are wrong for two
 * reasons: neither simulated dom implements layout, so a suite built on them
 * passes vacuously, and both force a reflow on every candidate. Ordered so
 * the attribute checks run first and the one call that consults style runs
 * last.
 *
 * `checkVisibility` is Chrome 105+, Firefox 125+, Safari 17.4+; the
 * `getClientRects` fallback is for anything older that somehow loads an mv3
 * extension.
 * @param element - The element to test.
 * @returns Whether it is plausibly visible.
 */
export const isPlausiblyVisible = (element: Element): boolean => {
  if (element instanceof HTMLElement && element.hidden) return false
  if (element instanceof HTMLInputElement && element.type === 'hidden') {
    return false
  }
  if (element.closest('[inert]') !== null) return false

  if (typeof element.checkVisibility === 'function') {
    return element.checkVisibility(VISIBILITY_OPTIONS)
  }
  return element.getClientRects().length > 0
}
