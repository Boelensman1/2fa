import type { UrlMatcher } from 'favalib'

import type { OtpConfidence } from '../detect'

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
 * - `gone`            the field was detached before or during the fill
 * - `empty-code`      there was nothing to type
 * - `partial`         the code and the row of boxes are different lengths
 * - `no-offer`        the token was unknown, stale or from another tab
 * - `locked`          the vault locked between opening the menu and clicking
 * - `unknown-entry`   the entry was not one this offer listed
 * - `no-frame`        the frame the offer named is no longer listening
 * - `stale-target`    the frame navigated, or lost the field, since it was offered
 * - `untrusted-frame` the field is in an embedded frame the entry does not
 *                     claim; the user has not been asked about it yet
 */
export type FillReason =
  | 'gone'
  | 'empty-code'
  | 'partial'
  | 'no-offer'
  | 'locked'
  | 'unknown-entry'
  | 'no-frame'
  | 'stale-target'
  | 'untrusted-frame'

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

/**
 * What a successful popup fill suggests writing down about the page.
 *
 * A fill the user just performed is the best evidence there is that the entry
 * belongs to the page, and the popup offers every entry for any site -- so the
 * entry that was filled very often does not claim the page at all. This is the
 * question that follows: keep it?
 *
 * The matcher is for the *page's* host, never the frame that was filled. A
 * matcher naming an embedded third party's origin would make
 * `isTrustedFrame`'s `entryClaimsFrame` branch true for it from then on and
 * retire the `FillConfirm` question permanently -- turning one "fill it
 * anyway" into a standing trust grant. Saying yes here must not be able to do
 * that.
 */
export interface SiteOffer {
  /**
   * The page url the offer is about, as the background resolved it.
   *
   * Carried so the popup can hand it straight back when the user accepts. By
   * then the page may well have submitted itself and navigated -- plenty of
   * sites do, the moment the code is complete -- so re-reading it at that
   * point would be reading a different page.
   */
  pageUrl: string
  /** `suggestMatchersForUrl`'s suggestion: a `BaseDomain` of the page's host. */
  matcher: UrlMatcher
  /**
   * The url to record as the entry's site, or null to leave it alone.
   *
   * Set only when the entry has none. `EntryMeta.url` is shown to the user and
   * never matched on, so this changes nothing about where the entry is
   * offered -- `matcher` is the half that does.
   */
  siteUrl: string | null
}

/**
 * What the popup gets back from a fill.
 *
 * `remember` is deliberately not a field on `FillResult`. That type travels to
 * the menu iframe, which is reachable from a tab; this half is the popup's and
 * is answered by an action the allowlist keeps a tab away from.
 */
export interface PopupFillResult extends FillResult {
  /** Set only on a fill that succeeded and taught us something. */
  remember?: SiteOffer | null
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

/**
 * The otp field the popup is offering to fill, as the background resolved it.
 *
 * Every field here is the background's answer, not the popup's claim.
 * `frameId`, `documentId` and `url` come from the `MessageSender` of the report
 * that produced it, and `host` is derived here rather than in the popup so the
 * origin the user is shown and the address the code is delivered to cannot
 * disagree -- the disclosure is this feature's main control, and a disclosure
 * computed from a different string than the delivery is no control at all.
 *
 * It travels back on the fill request, but as an *assertion* rather than an
 * instruction: the background re-derives it from a fresh report and refuses if
 * it has moved. This is what the user was shown; the registry is what is true.
 */
export interface FillTarget {
  tabId: number
  /** The frame holding the field, from the browser. */
  frameId: number
  /**
   * Chrome's per-document id for that frame (106+), absent on Firefox mv2.
   *
   * Preferred over `frameId` when delivering: a frame id belongs to the
   * browsing context and is reused across that frame's own navigations, so it
   * can outlive the document that was detected in it. A document id cannot.
   */
  documentId?: string
  /** Which detected field, within that frame. */
  fieldId: string
  /** The *frame's* url. Never the tab's -- they differ exactly when it matters. */
  url: string
  /** `new URL(url).host`, for the banner. Derived where the url is validated. */
  host: string
  confidence: OtpConfidence
  /** True when the field is in an embedded frame rather than the page itself. */
  inSubframe: boolean
}
