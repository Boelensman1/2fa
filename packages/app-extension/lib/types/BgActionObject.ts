import type { DetectedOtpField } from '../detect'

import type { EntryId, Password } from 'favalib'

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

export interface GetVaultStateActionObject {
  type: typeof BG_ACTION_KEYS.GET_VAULT_STATE
}

export interface CreateVaultActionObject {
  type: typeof BG_ACTION_KEYS.CREATE_VAULT
  data: {
    password: Password
    /** `connect` leaves the new vault unsaved until pairing delivers one. */
    mode: 'create' | 'connect'
  }
}

export interface PairDeviceActionObject {
  type: typeof BG_ACTION_KEYS.PAIR_DEVICE
  data: {
    /** The text code from another device. Qr images cannot be decoded here. */
    connectionString: string
    deviceFriendlyName?: string
  }
}

export interface UnlockVaultActionObject {
  type: typeof BG_ACTION_KEYS.UNLOCK_VAULT
  data: { password: Password }
}

export interface LockVaultActionObject {
  type: typeof BG_ACTION_KEYS.LOCK_VAULT
}

export interface ResetVaultActionObject {
  type: typeof BG_ACTION_KEYS.RESET_VAULT
}

export interface ListEntriesActionObject {
  type: typeof BG_ACTION_KEYS.LIST_ENTRIES
  data: {
    query: string
    /**
     * The active tab's url, for the "for this site" group.
     *
     * Unlike REPORT_OTP_FIELDS this one *is* taken from the payload: the popup
     * is an extension page, not a content script, and it reads the url from
     * browser.tabs -- there is no untrusted page in the chain to lie about it.
     */
    url: string | null
  }
}

export interface GetTokenActionObject {
  type: typeof BG_ACTION_KEYS.GET_TOKEN
  data: { entryId: EntryId }
}

export interface GetPasswordStrengthActionObject {
  type: typeof BG_ACTION_KEYS.GET_PASSWORD_STRENGTH
  data: { password: Password }
}

export type BgActionObject =
  | GetStateActionObject
  | GetConfigActionObject
  | ResetConfigActionObject
  | SaveConfigActionObject
  | SendLogActionObject
  | SendDebugCommandActionObject
  | ReportOtpFieldsActionObject
  | GetVaultStateActionObject
  | CreateVaultActionObject
  | PairDeviceActionObject
  | UnlockVaultActionObject
  | LockVaultActionObject
  | ResetVaultActionObject
  | ListEntriesActionObject
  | GetTokenActionObject
  | GetPasswordStrengthActionObject
