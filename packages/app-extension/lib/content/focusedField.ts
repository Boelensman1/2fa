/**
 * Noticing that a field had focus before anyone knew it was an otp field.
 *
 * The menu opens on `focusin`, and two common shapes never produce one that
 * we see: a second-factor page that loads with `autofocus` -- the focus lands
 * before the content script runs at `document_idle` -- and a field that is
 * focused first and only becomes detectable a rescan later. Both end with the
 * cursor already in the box and no menu until the user clicks out and back.
 * @module
 */

import type { DetectedOtpFieldHandle } from '../detect'

/**
 * The focused element, followed down through open shadow roots.
 *
 * `document.activeElement` stops at a shadow host, but detection reaches into
 * open roots and keys its handles on the input itself.
 * @param doc - The document to ask.
 * @returns The innermost reachable focused element, or null.
 */
export const deepActiveElement = (doc: Document): Element | null => {
  let active = doc.activeElement
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement
  }
  return active
}

/**
 * The field to offer for, if focus is in one this scan has only just found.
 *
 * Only a *new* field counts. A field the previous scan already knew had its
 * chance through `focusin`, and offering again on every rescan would bring
 * back a menu the user had just dismissed with Escape or by picking a row.
 * @param active - The focused element.
 * @param ownerOf - Resolves an element to the field it belongs to.
 * @param previousIds - The field ids the scan before this one reported.
 * @returns The handle to offer for, or undefined.
 */
export const newlyFocusedField = (
  active: Element | null,
  ownerOf: (element: Element) => DetectedOtpFieldHandle | undefined,
  previousIds: ReadonlySet<string>,
): DetectedOtpFieldHandle | undefined => {
  if (active === null) return undefined
  const handle = ownerOf(active)
  if (handle === undefined || previousIds.has(handle.field.id)) return undefined
  return handle
}
