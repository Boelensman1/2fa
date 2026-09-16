import type { DetectedOtpField } from '../detect'

import type { CT_ACTION_KEYS } from '../state'

export type CTEvent = 'configUpdated'
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

export type CtActionObject =
  EventNotificationCTActionObject | DetectOtpFieldsCTActionObject

export type DetectOtpFieldsResponse = DetectedOtpField[]
