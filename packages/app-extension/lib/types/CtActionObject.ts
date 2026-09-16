import type { DetectedOtpField } from '../detect'

import type { CT_ACTION_KEYS } from '../state'
import type { FillResult } from './Autofill'

/**
 * Things the background tells every frame about, fire and forget.
 *
 * `vaultStateChanged` exists for exactly one job: closing a menu that is
 * already open when the vault locks. Everything else about the offer is
 * fetched on focus, so there is no cached state anywhere that needs
 * invalidating.
 */
export type CTEvent = 'configUpdated' | 'vaultStateChanged'
export interface EventNotificationCTActionObject {
  type: typeof CT_ACTION_KEYS.EVENT_NOTIFICATION
  data: { event: CTEvent }
}

/**
 * The background asking a frame to scan itself now.
 *
 * Its own action rather than another `CTEvent` string: `CTEvent` is a
 * fire-and-forget notification with no meaningful return channel, and this
 * one answers.
 */
export interface DetectOtpFieldsCTActionObject {
  type: typeof CT_ACTION_KEYS.DETECT_OTP_FIELDS
  /** The `inputSelector` of every entry matching this frame's url. */
  data: { inputSelectors: string[] }
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

export type CtActionObject =
  | EventNotificationCTActionObject
  | DetectOtpFieldsCTActionObject
  | FillOtpFieldCTActionObject
  | CloseAutofillMenuCTActionObject

export type DetectOtpFieldsResponse = DetectedOtpField[]
export type FillOtpFieldResponse = FillResult
