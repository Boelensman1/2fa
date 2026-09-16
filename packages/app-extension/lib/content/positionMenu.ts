/**
 * Where to put the menu, as arithmetic.
 *
 * Pure on purpose, and pure is not a stylistic preference here: happy-dom does
 * no layout at all -- `getBoundingClientRect()` returns a zero rect for every
 * element, visible or not (`tests/environment.test.ts`) -- so anything that
 * reads geometry from the dom is untestable in this package. Keeping the
 * decision in a function that takes numbers and returns numbers is the only
 * way any of it gets covered.
 * @module
 */

/**
 * Where the menu ended up relative to the field.
 *
 * `over` is the interesting one. The menu renders in the frame that owns the
 * field -- that is what matching on the frame's own url commits us to -- and
 * `position: fixed` resolves against *that* frame's viewport. A hosted
 * second-factor widget in a 320x60 iframe therefore clips the menu to 320x60,
 * and no z-index helps: it is a containing-block and clip problem, and no css
 * escapes a nested browsing context. When neither below nor above fits, the
 * menu overlaps the field instead of being placed somewhere it cannot be seen.
 *
 * Escaping properly would mean relaying the anchor rect up through every
 * ancestor frame and recomputing on each one's scroll, which breaks the moment
 * an ancestor has no content script. That is its own feature.
 */
export type MenuPlacement = 'below' | 'above' | 'over'

/** The field's box, in viewport coordinates. */
export interface AnchorRect {
  top: number
  left: number
  width: number
  height: number
}

export interface BoxSize {
  width: number
  height: number
}

export interface PositionOptions {
  anchor: AnchorRect
  /** The *frame's* viewport, not the tab's. */
  viewport: BoxSize
  menu: BoxSize
  /** Space between the field and the menu. */
  gap?: number
  /** Smallest distance kept from any viewport edge. */
  margin?: number
}

export interface MenuPosition {
  top: number
  left: number
  width: number
  placement: MenuPlacement
}

const DEFAULT_GAP = 4
const DEFAULT_MARGIN = 8

/** Narrower than this and the issuer column stops being readable. */
export const MIN_MENU_WIDTH = 240

const clamp = (value: number, low: number, high: number): number =>
  high < low ? low : Math.min(Math.max(value, low), high)

/**
 * Decides where the menu goes.
 *
 * Prefers below the field, flips above when there is no room, and falls back
 * to overlapping it when the frame is too short for either -- see
 * {@link MenuPlacement}. The menu is at least as wide as the field, because a
 * menu narrower than what it is attached to reads as a detached tooltip.
 * @param options - See {@link PositionOptions}.
 * @returns The position to apply, in the same coordinate space as `anchor`.
 */
export const positionMenu = (options: PositionOptions): MenuPosition => {
  const {
    anchor,
    viewport,
    menu,
    gap = DEFAULT_GAP,
    margin = DEFAULT_MARGIN,
  } = options

  const width = clamp(
    Math.max(anchor.width, MIN_MENU_WIDTH),
    0,
    Math.max(viewport.width - margin * 2, 0),
  )

  const left = clamp(anchor.left, margin, viewport.width - width - margin)

  const below = anchor.top + anchor.height + gap
  const above = anchor.top - gap - menu.height

  if (below + menu.height <= viewport.height - margin) {
    return { top: below, left, width, placement: 'below' }
  }

  if (above >= margin) {
    return { top: above, left, width, placement: 'above' }
  }

  // Neither fits. Pin to the top of the frame and overlap the field: a menu
  // hanging off the bottom of a short iframe is invisible, which is worse.
  return {
    top: clamp(margin, 0, Math.max(viewport.height - menu.height - margin, 0)),
    left,
    width,
    placement: 'over',
  }
}
