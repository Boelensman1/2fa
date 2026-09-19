import type { DetectedOtpField } from '../detect'

import type { CT_ACTION_KEYS } from '../state'
import type { FillResult } from './Autofill'

/**
 * Things the background tells every frame about, fire and forget.
 *
 * `vaultStateChanged` exists for exactly one job: taking down whatever this
 * frame has on screen -- an open menu, an unanswered remember prompt -- when
 * the vault locks. `entriesChanged` closes stale autofill menus and asks each
 * frame to report again for fresh selectors. Neither event carries vault data.
 */
export type CTEvent = 'configUpdated' | 'vaultStateChanged' | 'entriesChanged'
export interface EventNotificationCTActionObject {
  type: typeof CT_ACTION_KEYS.EVENT_NOTIFICATION
  data: { event: CTEvent }
}

/**
 * The background asking a frame to scan itself now, and report.
 *
 * Its own action rather than another `CTEvent` string: `CTEvent` is a
 * fire-and-forget notification with no meaningful return channel, and this one
 * answers. The answer is a convenience, though -- the *report* it triggers is
 * what the background is really waiting for, because only a report carries a
 * browser-supplied `sender.url` saying which frame the fields were found in.
 *
 * It carries **no `inputSelectors`, and must not grow any.** Those are vault
 * data, derived from a url; the background does not know a frame's url until
 * that frame reports, so the only list it could put here is the *tab's* --
 * which would push one frame's overrides into the isolated world of every
 * third-party frame on the page. That is the same leak matching against the
 * frame's own url exists to prevent. Each frame already holds the selectors it
 * was given for its own url, and the `REPORT_OTP_FIELDS` response re-delivers
 * them on every report.
 */
export interface DetectOtpFieldsCTActionObject {
  type: typeof CT_ACTION_KEYS.DETECT_OTP_FIELDS
}

/**
 * The background handing one frame a code to type.
 *
 * **Never log this payload.** A content script's `Logger` forwards every entry
 * to the background regardless of level -- filtering happens in the receiving
 * context -- so a `log.trace` on this path would write a live one-time code
 * into the background's console and into anything reading it.
 *
 * Addressed to a single frame with `tabs.sendMessage(tabId, msg, { frameId })`
 * rather than broadcast. Broadcasting would hand the code to every frame's
 * isolated world on the page, third-party ad frames included, and let each one
 * decide whether it owned the field. Frame targeting is load-bearing for
 * secrecy here, not just for correctness.
 */
export interface FillOtpFieldCTActionObject {
  type: typeof CT_ACTION_KEYS.FILL_OTP_FIELD
  data: { fieldId: string; otp: string }
}

/** The background telling one frame to take its menu down. */
export interface CloseAutofillMenuCTActionObject {
  type: typeof CT_ACTION_KEYS.CLOSE_AUTOFILL_MENU
}

/**
 * The background asking the *page's own* frame to put the remember prompt up.
 *
 * Sent to `{ frameId: 0 }` and nowhere else. The question is about the page,
 * never about the frame the code went into -- see `SiteOffer` -- and frame 0 is
 * also the only frame with a viewport the user is looking at.
 *
 * It carries a token and nothing else, for the same reason
 * `OPEN_AUTOFILL_MENU`'s answer does: the content script shares a realm with
 * the page, and the entry label lives on the other side of the iframe's origin
 * boundary. The token is meaningless to the page -- it names an offer the
 * background will only serve back into the tab it was minted for.
 */
export interface ShowRememberPromptCTActionObject {
  type: typeof CT_ACTION_KEYS.SHOW_REMEMBER_PROMPT
  data: { token: string }
}

export type CtActionObject =
  | EventNotificationCTActionObject
  | DetectOtpFieldsCTActionObject
  | FillOtpFieldCTActionObject
  | CloseAutofillMenuCTActionObject
  | ShowRememberPromptCTActionObject

export type DetectOtpFieldsResponse = DetectedOtpField[]
export type FillOtpFieldResponse = FillResult
