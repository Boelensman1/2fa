import type { DetectedOtpField } from '../detect'

import type { EntryId, Password } from 'favalib'

import type { BG_ACTION_KEYS } from '../state'
import type { Config, FillTarget, LogEntryPayload } from './'

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
    /** The selectors this frame has already scanned with, so the background
     * can tell a first report from one that already used them. */
    usedInputSelectors: string[]
  }
}

/**
 * What a frame gets back for reporting.
 *
 * Only the `inputSelector` overrides that apply to its url, because the
 * background is the only side that can know them -- knowing them means reading
 * the vault. Until this existed the content script called `observeOtpFields`
 * with no selectors at all, so `detectOtpFields` never took the override
 * branch and `EntryMeta.inputSelector` did nothing end to end.
 *
 * Safe to answer on every report, unlike an autofill offer: this crosses to
 * the content script's isolated world and produces nothing the page can see.
 */
export interface ReportOtpFieldsResponse {
  inputSelectors: string[]
}

/**
 * A content script saying a detected field has been focused.
 *
 * Asked on focus rather than prefetched with the field report, for two
 * reasons. Every frame reports at load whether or not it found anything, so
 * answering there would put a vault query on the hot path of every page load
 * in the browser. And the answer sizes an overlay the page can measure, so
 * producing one unprompted would tell every site carrying an otp field how
 * many entries the user has for it.
 *
 * Carries no url and no frame: `handleMessage` reads those off the
 * `MessageSender`, which the browser fills in and a content script cannot
 * forge.
 */
export interface OpenAutofillMenuActionObject {
  type: typeof BG_ACTION_KEYS.OPEN_AUTOFILL_MENU
  data: { fieldId: string }
}

export interface CloseAutofillMenuActionObject {
  type: typeof BG_ACTION_KEYS.CLOSE_AUTOFILL_MENU
  data: { token: string }
}

/**
 * The menu iframe asking what to render. **Sent by the menu, not the page.**
 *
 * This is the message that keeps entry names out of the page's realm: the
 * answer goes to an extension document the page cannot read into. The token is
 * what makes that safe -- the menu url is web-accessible, so any site can
 * frame it and ask, and only an unguessable handle distinguishes our menu from
 * theirs. See `AutofillOfferRegistry`.
 */
export interface GetMenuEntriesActionObject {
  type: typeof BG_ACTION_KEYS.GET_MENU_ENTRIES
  data: { token: string }
}

/**
 * The menu iframe asking for a code to be typed into the field.
 *
 * The entry is named, the field is not: which field, in which frame, is read
 * from the offer the token resolves to. The menu could not be trusted with it
 * anyway -- it is one `postMessage` away from the page.
 */
export interface FillOtpFieldActionObject {
  type: typeof BG_ACTION_KEYS.FILL_OTP_FIELD
  data: { token: string; entryId: EntryId }
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

export interface SetSyncServerActionObject {
  type: typeof BG_ACTION_KEYS.SET_SYNC_SERVER
  data: {
    /** Absolute; an extension page has no origin for a path to resolve against. */
    serverUrl: string
    /**
     * The server's shared secret, which the user supplies.
     *
     * It crosses to the background because that is where the vault is, and it
     * is stored in the vault there. It is never sent to the server -- favalib
     * proves it over a nonce the server draws -- and it must not be logged.
     */
    serverSecret: string
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

/**
 * The popup asking whether the tab it is open over has a field worth filling.
 *
 * The tab id *is* taken from the payload, like `LIST_ENTRIES`'s url and unlike
 * `REPORT_OTP_FIELDS`'s: this action is popup-only -- see
 * `actionsReachableFromATab` in `background/handleMessage.ts` -- so there is no
 * untrusted page in the chain to lie about it. `tab.id` is also the one thing
 * `tabs.query` returns whatever the permissions are, which is why the popup
 * passes an id rather than a url. The origin the answer discloses is the
 * *frame's*, and that reaches the background on a `MessageSender`.
 */
export interface GetFillTargetActionObject {
  type: typeof BG_ACTION_KEYS.GET_FILL_TARGET
  data: { tabId: number }
}

/**
 * The popup asking for a code to be typed into the detected field.
 *
 * There is no offer token, because there is no offer: `AutofillOfferRegistry`
 * resolves against `sender.tab.id` and the popup has no tab. The equivalent
 * guarantee is rebuilt instead -- the target is confirmed against a fresh
 * report from the live frame before a code is ever generated.
 *
 * `entryId` is unrestricted, deliberately, and that is the feature. The inline
 * menu may only fill an entry its offer listed, because the *page* caused that
 * menu to appear. Here the user opened the popup and picked a row, which is
 * the authorisation, and reaching an entry whose matchers do not claim the
 * site is the whole point. The compensating control is disclosure: the popup
 * names the host before the click, and asks again for an embedded frame the
 * entry does not vouch for.
 *
 * `confirmed` is the answer to that second question, and only that. It is not
 * a way to skip any other check.
 */
export interface FillDetectedFieldActionObject {
  type: typeof BG_ACTION_KEYS.FILL_DETECTED_FIELD
  data: { target: FillTarget; entryId: EntryId; confirmed?: boolean }
}

/**
 * The popup accepting the offer a successful fill came back with.
 *
 * The extension's only write into the vault, and the narrowest one that does
 * the job: it names an entry and a url, and the background derives the matcher
 * and the site url from that url itself, with `siteOfferFor` -- the same
 * function that produced the offer. Nothing the caller says can turn into a
 * matcher the background would not have suggested on its own.
 *
 * The url *is* taken from the payload, like `LIST_ENTRIES`'s and unlike
 * `REPORT_OTP_FIELDS`'s: this action is popup-only -- see
 * `actionsReachableFromATab` in `background/handleMessage.ts` -- so there is no
 * untrusted page in the chain to lie about it. It is the page url the offer
 * named, echoed back rather than re-read, because a page that submitted itself
 * the moment the code was complete has already navigated by now.
 */
export interface RememberEntrySiteActionObject {
  type: typeof BG_ACTION_KEYS.REMEMBER_ENTRY_SITE
  data: { entryId: EntryId; url: string }
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
  | OpenAutofillMenuActionObject
  | CloseAutofillMenuActionObject
  | GetMenuEntriesActionObject
  | FillOtpFieldActionObject
  | GetVaultStateActionObject
  | CreateVaultActionObject
  | PairDeviceActionObject
  | SetSyncServerActionObject
  | UnlockVaultActionObject
  | LockVaultActionObject
  | ResetVaultActionObject
  | ListEntriesActionObject
  | GetFillTargetActionObject
  | FillDetectedFieldActionObject
  | RememberEntrySiteActionObject
  | GetTokenActionObject
  | GetPasswordStrengthActionObject
