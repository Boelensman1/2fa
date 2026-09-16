import type { DetectedOtpField } from '../detect'

import type { BG_ACTION_KEYS } from '../state'
import type { Config, LogEntryPayload } from './'

export interface GetStateActionObject {
  type: typeof BG_ACTION_KEYS.GET_STATE
}

export interface GetConfigActionObject {
  type: typeof BG_ACTION_KEYS.GET_CONFIG
}

export interface ResetConfigActionObject {
  type: typeof BG_ACTION_KEYS.RESET_CONFIG
}

export interface SaveConfigActionObject {
  type: typeof BG_ACTION_KEYS.SAVE_CONFIG
  data: Partial<Config>
}

export interface SendLogActionObject {
  type: typeof BG_ACTION_KEYS.SEND_LOG
  data: LogEntryPayload
}

export interface SendDebugCommandActionObject {
  type: typeof BG_ACTION_KEYS.SEND_DEBUG_COMMAND
  data: string
  extraData?: string
}

/**
 * A content script telling the background what it found on its page.
 *
 * Deliberately carries no tab, frame or url: `handleMessage` is already given
 * a `MessageSender` whose `tabId`, `frameId` and `url` are supplied by the
 * browser and are trustworthy. A content script must not be trusted to name
 * its own origin, and putting those in the payload invites exactly that.
 */
export interface ReportOtpFieldsActionObject {
  type: typeof BG_ACTION_KEYS.REPORT_OTP_FIELDS
  data: {
    fields: DetectedOtpField[]
    /** An entry supplied an `inputSelector` and it matched nothing. */
    overrideMissed: boolean
    scannedAt: number
  }
}

export type BgActionObject =
  | GetStateActionObject
  | GetConfigActionObject
  | ResetConfigActionObject
  | SaveConfigActionObject
  | SendLogActionObject
  | SendDebugCommandActionObject
  | ReportOtpFieldsActionObject
