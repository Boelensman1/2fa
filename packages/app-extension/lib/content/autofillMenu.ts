/**
 * Offering to fill, and never filling on its own.
 *
 * The whole feature from the page's side: notice that a detected field has
 * been focused, ask the background whether there is anything to offer, put the
 * menu on screen if there is, and take it down again on any of the half-dozen
 * things that should end it.
 *
 * What it deliberately never holds is an entry name or a code. The offer that
 * crosses into this realm is a state, a token and a row count; the names go
 * straight from the background to the menu iframe, and the code arrives later
 * addressed to one frame.
 * @module
 */

import { browser } from 'wxt/browser'

import Logger from '../classes/Logger'
import { bgActions } from '../state'
import { containerFor, createMenuHost } from './menuHost'
import type { MenuHost } from './menuHost'
import { positionMenu } from './positionMenu'
import type { AnchorRect } from './positionMenu'
import type { DetectedOtpFieldHandle } from '../detect'

const log = new Logger('content-script/autofillMenu')

/** The menu page, as wxt emits it: `entrypoints/menu/index.html`. */
const MENU_PAGE = '/menu.html'

/**
 * A first guess at the menu's height, corrected the moment it measures itself.
 *
 * Only ever an anti-flicker measure. The real height depends on wrapped
 * issuers, the locked state and the browser's minimum font size, which is why
 * the menu reports its own rather than having this be authoritative.
 */
const ESTIMATED_ROW_HEIGHT = 44
const ESTIMATED_CHROME_HEIGHT = 60
const LOCKED_HEIGHT = 96

export interface AutofillMenuOptions {
  /** Finds the detection a focused element belongs to, if any. */
  handleForElement: (element: Element) => DetectedOtpFieldHandle | undefined
}

export interface AutofillMenu {
  /** Call from `focusin`. Does nothing for elements we did not detect. */
  focused: (target: EventTarget | null) => void
  /** Call when the field's frame should stop offering: lock, navigation, teardown. */
  close: () => void
  /** Whether a menu is on screen right now. */
  isOpen: () => boolean
  stop: () => void
}

/**
 * The union of a field's element rects.
 *
 * A segmented row is six boxes; anchoring to the first one hangs the menu off
 * a single digit. Zero rects are skipped rather than folded in -- a field can
 * be present and unrendered, and a zero rect would drag the union to the
 * origin.
 * @param elements - The field's inputs.
 * @returns The box to anchor to, or null when nothing is rendered.
 */
const anchorRectFor = (
  elements: readonly HTMLInputElement[],
): AnchorRect | null => {
  let top = Infinity
  let left = Infinity
  let right = -Infinity
  let bottom = -Infinity

  for (const element of elements) {
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    top = Math.min(top, rect.top)
    left = Math.min(left, rect.left)
    right = Math.max(right, rect.right)
    bottom = Math.max(bottom, rect.bottom)
  }

  if (!Number.isFinite(top)) return null
  return { top, left, width: right - left, height: bottom - top }
}

const rectKey = (rect: AnchorRect): string =>
  `${String(Math.round(rect.top))}:${String(Math.round(rect.left))}:${String(
    Math.round(rect.width),
  )}:${String(Math.round(rect.height))}`

export const createAutofillMenu = (
  options: AutofillMenuOptions,
): AutofillMenu => {
  const { handleForElement } = options

  let host: MenuHost | null = null
  let openFor: DetectedOtpFieldHandle | null = null
  let token: string | null = null
  let frame: number | null = null
  let lastKey = ''
  /** Bumped on every open, so a slow reply for a field we have left is dropped. */
  let generation = 0

  const close = () => {
    generation += 1
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    host?.destroy()
    host = null
    openFor = null
    lastKey = ''
    if (token !== null) {
      const closing = token
      token = null
      // Best effort: the offer is replaced by the next open and dropped when
      // the tab closes, so a failure here costs nothing.
      void bgActions.closeAutofillMenu(closing).catch(() => undefined)
    }
  }

  /**
   * Keeps the menu under its field.
   *
   * One rAF loop rather than a collection of listeners: it catches document
   * scroll, scrolling in an inner container, resize, an accordion opening and
   * plain layout shift with a single mechanism, and it stops existing when the
   * menu does. A `scroll` listener needs capture to see inner containers at
   * all and still misses everything that is not a scroll.
   */
  const track = () => {
    frame = requestAnimationFrame(track)
    const handle = openFor
    if (!handle || !host) return

    const first = handle.elements[0]
    if (!first?.isConnected) {
      close()
      return
    }

    const anchor = anchorRectFor(handle.elements)
    if (!anchor) {
      close()
      return
    }

    const key = `${rectKey(anchor)}:${String(host.height())}`
    if (key === lastKey) return
    lastKey = key

    host.place(
      positionMenu({
        anchor,
        // The *frame's* viewport. In a hosted widget's iframe this is tiny,
        // which is what `positionMenu`'s `over` placement exists for.
        viewport: { width: window.innerWidth, height: window.innerHeight },
        menu: { width: anchor.width, height: host.height() },
      }),
    )
  }

  const open = async (handle: DetectedOtpFieldHandle) => {
    const mine = (generation += 1)

    const offer = await bgActions.openAutofillMenu(handle.field.id)
    // Focus moved on, or the menu was closed, while the background answered.
    if (mine !== generation) return
    if (!offer) return
    if (offer.state === 'off' || offer.state === 'no-match') return

    const first = handle.elements[0]
    if (!first?.isConnected) return

    const parameters = new URLSearchParams(
      offer.state === 'ready' && offer.token !== null
        ? { token: offer.token }
        : { state: 'locked' },
    )

    token = offer.token
    openFor = handle
    host = createMenuHost({
      src: `${browser.runtime.getURL(MENU_PAGE)}#${parameters.toString()}`,
      container: containerFor(first),
      estimatedHeight:
        offer.state === 'locked'
          ? LOCKED_HEIGHT
          : ESTIMATED_CHROME_HEIGHT + offer.count * ESTIMATED_ROW_HEIGHT,
      onClose: close,
    })

    lastKey = ''
    track()
  }

  const focused = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return

    const handle = handleForElement(target)
    if (!handle) {
      // Focus went somewhere that is not a detected field. If it went into the
      // menu itself the target is the host element, which owns() recognises;
      // anything else means the user has moved on.
      if (host && !host.owns(target)) close()
      return
    }

    if (openFor?.field.id === handle.field.id) return
    close()
    void open(handle).catch((error: unknown) => {
      log.error(error instanceof Error ? error : new Error(String(error)))
    })
  }

  /**
   * Closes when focus leaves the field for anything but the menu.
   *
   * Focus inside a shadow root retargets to the host, and a closed root has no
   * reachable `activeElement`, so `document.activeElement === host` is the only
   * check available -- comparing against the iframe is always false. Deferred
   * a task because during the blur itself `activeElement` is still the body.
   */
  const onFocusOut = () => {
    setTimeout(() => {
      if (!host) return
      if (host.owns(document.activeElement)) return
      const active = document.activeElement
      if (active instanceof Element && handleForElement(active) === openFor) {
        return
      }
      close()
    }, 0)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && host) close()
  }

  const onPointerDown = (event: Event) => {
    if (!host) return
    if (host.owns(event.target)) return
    if (event.target instanceof Element && handleForElement(event.target)) {
      return
    }
    close()
  }

  window.addEventListener('focusout', onFocusOut, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('pointerdown', onPointerDown, true)
  // onInvalidated covers an extension reload, not a real or SPA navigation.
  window.addEventListener('pagehide', close)

  return {
    focused,
    close,
    isOpen: () => host !== null,
    stop: () => {
      close()
      window.removeEventListener('focusout', onFocusOut, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pagehide', close)
    },
  }
}
