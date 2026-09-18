/**
 * Asking, on the page, whether to remember the site that was just filled.
 *
 * The question used to be put in the popup, which is where it could not be
 * answered: a browser action popup is destroyed the moment it loses focus, and
 * clicking the page to press Enter is the very next thing anyone does after a
 * fill. So it moved here, into an extension page framed in a closed shadow
 * root -- the same shape as the autofill menu, and for the same reason: the
 * entry's name is on the other side of an origin boundary the page cannot read
 * across.
 *
 * Bitwarden's notification bar is the reference for the mechanism. **Their
 * autofill source is GPL-3.0 and must not be read while working on this**; see
 * `lib/detect/patterns.ts`. Theirs spans the top of the page, this is a corner
 * panel: a full-width bar covers the page's own header, which on a
 * second-factor screen is usually what the user is looking at.
 * @module
 */

import { browser } from 'wxt/browser'

import Logger from '../classes/Logger'
import { bgActions } from '../state'
import { createMenuHost } from './menuHost'
import type { MenuHost } from './menuHost'

const log = new Logger('content-script/rememberPrompt')

/** The prompt page, as wxt emits it: `entrypoints/remember/index.html`. */
const REMEMBER_PAGE = '/remember.html'

/** Distance from the top and right edges of the frame's viewport. */
const MARGIN = 12

/** Wide enough for a matcher on one line, narrow enough to not own the page. */
const PANEL_WIDTH = 360

/**
 * First paint, before the panel measures itself.
 *
 * Only an anti-flicker measure, like the menu's. The real height depends on the
 * wrapped entry label, the embedded-frame sentence and the browser's minimum
 * font size, which is why the panel reports its own.
 */
const ESTIMATED_HEIGHT = 190
const MIN_HEIGHT = 72
const MAX_HEIGHT = 420

/**
 * How long the prompt stays up unanswered.
 *
 * Matches `REMEMBER_OFFER_TTL_MS` in the background, which is the side that
 * actually decides -- this is the visible half, and it is here rather than
 * there because the background may be evicted while the prompt is on screen and
 * a timer in a dead worker fires for nobody.
 */
const DISMISS_AFTER_MS = 60_000

/** Why the prompt is coming down, which decides whether to tell the background. */
type CloseReason =
  /** The panel answered for itself, yes or no. Nothing left to say. */
  | 'answered'
  /** Escape, or the timeout. The offer is retired so it is not re-shown. */
  | 'dismissed'
  /** The vault locked, or the script was invalidated. The offer is gone already. */
  | 'torn-down'

export interface RememberPromptOptions {
  /**
   * wxt's `ctx.setTimeout`, so the dismissal timer dies with the script.
   *
   * Without it an extension reload leaves a timer running against dead code on
   * every open tab -- the same reason `observeOtpFields` takes its timers.
   */
  setTimeout: (_callback: () => void, _ms: number) => number
  clearTimeout: (_id: number) => void
}

export interface RememberPrompt {
  /** Mounts the prompt for one offer, replacing any already up. */
  show: (_token: string) => void
  /** Takes it down. Safe to call when nothing is up. */
  close: (_reason?: CloseReason) => void
  stop: () => void
}

export const createRememberPrompt = (
  options: RememberPromptOptions,
): RememberPrompt => {
  let host: MenuHost | null = null
  let token: string | null = null
  let timer: number | null = null

  const place = () => {
    if (!host) return
    const width = Math.min(PANEL_WIDTH, window.innerWidth - MARGIN * 2)
    host.place({
      top: MARGIN,
      left: Math.max(MARGIN, window.innerWidth - width - MARGIN),
      width,
    })
  }

  const onResize = () => place()

  /**
   * Escape, from the page's side.
   *
   * The menu binds this inside its own document, because focus is in there.
   * This panel deliberately never takes focus -- the user is about to press
   * Enter on the page -- so the keystroke lands on the page instead and the
   * listener has to be here.
   */
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    close('dismissed')
  }

  function close(reason: CloseReason = 'torn-down'): void {
    const closing = token

    if (timer !== null) options.clearTimeout(timer)
    timer = null
    window.removeEventListener('resize', onResize)
    window.removeEventListener('keydown', onKeyDown, true)
    host?.destroy()
    host = null
    token = null

    if (reason !== 'dismissed' || closing === null) return
    // Best effort. A no is worth sending: it retires the offer, so it is not
    // put back on the next page this tab loads.
    void bgActions.answerRememberOffer(closing, false).catch(() => undefined)
  }

  return {
    show: (next) => {
      close()
      token = next

      const src = `${browser.runtime.getURL(
        REMEMBER_PAGE,
      )}#token=${encodeURIComponent(next)}`

      host = createMenuHost({
        src,
        // Always the document root. Unlike the menu there is no field to be
        // in a `<dialog>` with, and the question is about the page as a whole.
        container: document.documentElement,
        estimatedHeight: ESTIMATED_HEIGHT,
        minHeight: MIN_HEIGHT,
        maxHeight: MAX_HEIGHT,
        // The panel answers before it asks to be closed, so there is nothing
        // left to tell the background.
        onClose: () => close('answered'),
      })

      place()
      window.addEventListener('resize', onResize)
      // Capturing, so a page that stops Escape from bubbling cannot trap the
      // prompt on screen.
      window.addEventListener('keydown', onKeyDown, true)
      timer = options.setTimeout(() => close('dismissed'), DISMISS_AFTER_MS)

      log.info('Showing the remember-site prompt.')
    },
    close,
    stop: () => close('torn-down'),
  }
}
