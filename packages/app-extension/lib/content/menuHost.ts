/**
 * The menu's home on someone else's page.
 *
 * Three decisions are load-bearing here and each one is easy to undo by
 * accident, so they are spelled out rather than left in the code.
 * @module
 */

import { MENU_MESSAGE_SOURCE } from '../types/Autofill'
import type { MenuControlMessage } from '../types/Autofill'
/**
 * Where to put the host, in the frame's viewport.
 *
 * A subset of `MenuPosition` rather than that type itself: the remember prompt
 * uses this host too and has no anchor and no placement to report, and the
 * height is the iframe's to decide in both cases.
 */
export interface HostPosition {
  top: number
  left: number
  width: number
}

/** A height outside this range is not a menu, whatever the iframe says. */
const MIN_HEIGHT = 56
const MAX_HEIGHT = 320

/** Above everything a page is likely to have given itself. */
const Z_INDEX = '2147483647'

export interface MenuHostOptions {
  /** The menu page url, hash and all. */
  src: string
  /** Where to attach. The top layer needs this to be the dialog, not the root. */
  container: Element
  /** First paint, before the menu measures itself. */
  estimatedHeight: number
  /**
   * What the self-reported height is clamped to.
   *
   * Defaults to a menu's. The remember prompt is a different shape -- narrower
   * and taller, with wrapping copy rather than a row list -- so it sets its
   * own. Clamped either way: the height arrives by `postMessage`, and while it
   * comes from our own page it is not worth trusting unconditionally.
   */
  minHeight?: number
  maxHeight?: number
  onClose: () => void
}

export interface MenuHost {
  place: (position: HostPosition) => void
  /** Whether a node is the host, for outside-click and blur checks. */
  owns: (node: unknown) => boolean
  /** The menu's own measured height, once it has reported one. */
  height: () => number
  destroy: () => void
}

/**
 * A tag name the page cannot have written a selector for.
 *
 * Fresh per page load. A fixed name is something a hostile or merely
 * over-enthusiastic stylesheet can target, hide or move; a random one cannot
 * be styled by a page that has never seen it. It needs a hyphen to be a valid
 * custom element name, which is also what makes `attachShadow` legal on it --
 * the element is never registered, and does not need to be.
 */
const randomTagName = (): string =>
  `fava-${Math.random().toString(36).slice(2, 10)}`

const applyStyles = (
  element: HTMLElement,
  styles: Record<string, string>,
): void => {
  for (const [property, value] of Object.entries(styles)) {
    // `important` on every declaration: a page-wide `* { position: static }`
    // or a z-index reset is otherwise enough to make the menu vanish, and we
    // are a guest with no control over what the page ships.
    element.style.setProperty(property, value, 'important')
  }
}

/**
 * Where the menu has to be attached to be visible at all.
 *
 * A field inside a `<dialog>` opened with `showModal()`, or inside an open
 * popover, is in the **top layer**: nothing outside it paints above it, at any
 * z-index. So for those the host goes inside the dialog rather than at the
 * document root.
 *
 * Everything else attaches to `documentElement` rather than `body`, because
 * `position: fixed` is broken by any ancestor carrying `transform`, `filter`,
 * `perspective`, `backdrop-filter`, `will-change` or `contain: paint` -- and a
 * transformed `<body>` is what every page-transition library leaves behind.
 * @param field - The field the menu is anchored to.
 * @returns The element to attach the host to.
 */
export const containerFor = (field: Element): Element => {
  try {
    const topLayer = field.closest('dialog:modal, [popover]:popover-open')
    if (topLayer) return topLayer
  } catch {
    /* :modal and :popover-open are recent; an older engine just gets the root */
  }
  return field.ownerDocument.documentElement
}

/** The origin a message from the menu must have come from. */
const menuOrigin = (src: string): string => {
  try {
    return new URL(src).origin
  } catch {
    return ''
  }
}

/**
 * Mounts the menu.
 * @param options - See {@link MenuHostOptions}.
 * @returns A handle to place, inspect and tear it down.
 */
export const createMenuHost = (options: MenuHostOptions): MenuHost => {
  const {
    src,
    container,
    estimatedHeight,
    minHeight = MIN_HEIGHT,
    maxHeight = MAX_HEIGHT,
    onClose,
  } = options
  const doc = container.ownerDocument
  const origin = menuOrigin(src)

  const host = doc.createElement(randomTagName())
  applyStyles(host, {
    position: 'fixed',
    top: '0px',
    left: '0px',
    width: '0px',
    height: '0px',
    margin: '0',
    padding: '0',
    border: '0',
    'z-index': Z_INDEX,
    'color-scheme': 'normal',
  })

  // Closed, and that is not a formality. The content script runs in its own
  // isolated world with its own prototypes, so a page that patches
  // `Element.prototype.attachShadow` does not see this call, and a closed root
  // gives it no `shadowRoot` to read afterwards -- the entry list inside is
  // genuinely unreachable from the page.
  //
  // It also keeps our own detector out: `collectRoots` descends into open
  // shadow roots only, so nothing in here can ever be scanned as if it were
  // part of the page. Do not "helpfully" open this.
  const shadow = host.attachShadow({ mode: 'closed' })

  const iframe = doc.createElement('iframe')
  iframe.setAttribute('title', 'Fava')
  // Not sandboxed: the menu is an extension page and keeps `runtime.sendMessage`,
  // which is what lets it fetch the entry list itself instead of relaying it
  // back through this realm.
  applyStyles(iframe, {
    display: 'block',
    width: '100%',
    height: '100%',
    border: '0',
    margin: '0',
    padding: '0',
    background: 'transparent',
    'color-scheme': 'normal',
  })
  iframe.src = src
  shadow.append(iframe)
  container.append(host)

  let measured = estimatedHeight
  let placement: HostPosition | null = null

  const applyPlacement = () => {
    if (!placement) return
    applyStyles(host, {
      top: `${String(Math.round(placement.top))}px`,
      left: `${String(Math.round(placement.left))}px`,
      width: `${String(Math.round(placement.width))}px`,
      height: `${String(Math.round(measured))}px`,
    })
  }

  const onMessage = (event: MessageEvent) => {
    // Identity comparison against a cross-origin window is allowed; reading
    // properties off it is not. Origin is checked too, so a page that somehow
    // got a handle to a same-shaped window still cannot drive this.
    if (event.source !== iframe.contentWindow) return
    if (event.origin !== origin) return

    const message = event.data as Partial<MenuControlMessage> | null
    if (message?.source !== MENU_MESSAGE_SOURCE) return

    if ('action' in message && message.action === 'close') {
      onClose()
      return
    }

    if ('height' in message && typeof message.height === 'number') {
      // Untrusted, even coming from our own page: clamp rather than trust.
      measured = Math.min(Math.max(message.height, minHeight), maxHeight)
      applyPlacement()
    }
  }

  window.addEventListener('message', onMessage)

  return {
    place: (position) => {
      placement = position
      applyPlacement()
    },
    owns: (node) => node === host,
    height: () => measured,
    destroy: () => {
      window.removeEventListener('message', onMessage)
      host.remove()
    },
  }
}
