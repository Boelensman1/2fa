/**
 * The vocabulary the autofill menu is driven by.
 *
 * Split out from `VaultState.ts` because these cross three contexts rather
 * than two: the content script, the menu iframe and the background all speak
 * them, and which of them is allowed to see what is the whole design.
 * @module
 */

/**
 * Why the menu is, or is not, worth opening.
 *
 * - `ready`    there are entries for this frame's url
 * - `locked`   there is a vault, but no keys in memory
 * - `no-match` unlocked, and nothing claims this url
 * - `off`      the user turned the inline menu off, or there is no vault
 */
export type AutofillState = 'ready' | 'locked' | 'no-match' | 'off'

/**
 * What the *content script* is told when a detected field is focused.
 *
 * Deliberately not the entries. The content script shares a realm with the
 * page; the menu iframe does not, so the names travel background -> iframe and
 * never pass through here. `count` is the one number that does cross, and only
 * to size the iframe before it reports its own height -- which is also why the
 * offer is fetched on focus rather than prefetched at page load. Rendering
 * something page-measurable at load would publish "this user has N entries for
 * this site" to every site carrying an otp field, unprompted.
 */
export interface AutofillOfferSummary {
  state: AutofillState
  /** The handle the menu iframe authenticates with. Null unless `ready`. */
  token: string | null
  count: number
}

/**
 * - `gone`          the field was detached before or during the fill
 * - `empty-code`    there was nothing to type
 * - `partial`       the code and the row of boxes are different lengths
 * - `no-offer`      the token was unknown, stale or from another tab
 * - `locked`        the vault locked between opening the menu and clicking
 * - `unknown-entry` the entry was not one this offer listed
 * - `no-frame`      the frame the offer named is no longer listening
 */
export type FillReason =
  | 'gone'
  | 'empty-code'
  | 'partial'
  | 'no-offer'
  | 'locked'
  | 'unknown-entry'
  | 'no-frame'

/**
 * What a fill attempt reports back.
 *
 * It travels all the way to the menu rather than being fire-and-forget,
 * because `handles` is rebuilt wholesale on every rescan: if the framework
 * replaced the input between the menu opening and the user clicking, the fill
 * finds nothing and a silent failure looks exactly like a broken extension.
 */
export interface FillResult {
  filled: boolean
  reason?: FillReason
}

/** What the menu iframe may post up to the content script. */
export const MENU_MESSAGE_SOURCE = 'fava-menu' as const

/**
 * The menu's control channel to its parent.
 *
 * A narrow exception to "the menu talks to the background, not to the page".
 * The content script shares `window` with the page, so anything posted here is
 * page-visible -- which is why it carries a pixel count and a close request
 * and nothing else. Never an entry name, never a code.
 *
 * It exists because two things genuinely cannot be done any other way. Height,
 * because the menu's real height depends on wrapped text, the locked state and
 * the browser's minimum font size, so no shared constant can predict it -- and
 * the tempting alternative, an oversized transparent iframe, eats clicks on
 * the page's own submit button, since the parent's hit test stops at the
 * iframe element whatever the child says about `pointer-events`. And Escape,
 * because once focus is inside the iframe the keystroke lands in the menu's
 * document; routing it out through the background and back is two hops for a
 * keypress.
 *
 * It carries no token. The menu cannot know its parent's origin, so it has to
 * post with `'*'`, which means the page receives the message too -- and the
 * content script identifies the sender by `event.source` against the live
 * iframe's `contentWindow` anyway, which a replaced menu no longer matches. A
 * token here would be handed to the page for nothing.
 */
export type MenuControlMessage =
  | { source: typeof MENU_MESSAGE_SOURCE; height: number }
  | { source: typeof MENU_MESSAGE_SOURCE; action: 'close' }
