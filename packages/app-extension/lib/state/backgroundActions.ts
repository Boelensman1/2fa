import { browser } from 'wxt/browser'
import type {
  BgActionObject,
  Config,
  GetConfigActionObject,
  GetStateActionObject,
  ResetConfigActionObject,
  SaveConfigActionObject,
  State,
  SendLogActionObject,
  LogEntryPayload,
  SendDebugCommandActionObject,
  ReportOtpFieldsActionObject,
  ReportOtpFieldsResponse,
} from '../types'
import type { DetectedOtpField } from '../detect'
import type { EntryId, Password } from 'favalib'
import type {
  AutofillOfferSummary,
  CloseAutofillMenuActionObject,
  CreateVaultActionObject,
  FillDetectedFieldActionObject,
  FillOtpFieldActionObject,
  FillResult,
  FillTarget,
  PopupFillResult,
  RememberEntrySiteActionObject,
  GetFillTargetActionObject,
  GetMenuEntriesActionObject,
  ListedEntry,
  OpenAutofillMenuActionObject,
  GetPasswordStrengthActionObject,
  PasswordStrength,
  EntryList,
  GetTokenActionObject,
  GetVaultStateActionObject,
  ListEntriesActionObject,
  LockVaultActionObject,
  PairDeviceActionObject,
  ResetVaultActionObject,
  UnlockVaultActionObject,
  VaultActionResult,
  VaultSummary,
} from '../types'

export const BG_ACTION_KEYS = {
  GET_STATE: 'GET_STATE' as const,
  GET_CONFIG: 'GET_CONFIG' as const,
  RESET_CONFIG: 'RESET_CONFIG' as const,
  SAVE_CONFIG: 'SAVE_CONFIG' as const,

  SEND_LOG: 'SEND_LOG' as const,
  SEND_DEBUG_COMMAND: 'SEND_DEBUG_COMMAND' as const,

  REPORT_OTP_FIELDS: 'REPORT_OTP_FIELDS' as const,

  OPEN_AUTOFILL_MENU: 'OPEN_AUTOFILL_MENU' as const,
  CLOSE_AUTOFILL_MENU: 'CLOSE_AUTOFILL_MENU' as const,
  GET_MENU_ENTRIES: 'GET_MENU_ENTRIES' as const,
  FILL_OTP_FIELD: 'FILL_OTP_FIELD' as const,

  GET_VAULT_STATE: 'GET_VAULT_STATE' as const,
  CREATE_VAULT: 'CREATE_VAULT' as const,
  PAIR_DEVICE: 'PAIR_DEVICE' as const,
  UNLOCK_VAULT: 'UNLOCK_VAULT' as const,
  LOCK_VAULT: 'LOCK_VAULT' as const,
  RESET_VAULT: 'RESET_VAULT' as const,
  LIST_ENTRIES: 'LIST_ENTRIES' as const,
  GET_TOKEN: 'GET_TOKEN' as const,
  GET_PASSWORD_STRENGTH: 'GET_PASSWORD_STRENGTH' as const,

  GET_FILL_TARGET: 'GET_FILL_TARGET' as const,
  FILL_DETECTED_FIELD: 'FILL_DETECTED_FIELD' as const,
  REMEMBER_ENTRY_SITE: 'REMEMBER_ENTRY_SITE' as const,
}

const send = <T extends BgActionObject, U = void>(arg: T): Promise<U | null> =>
  browser.runtime.sendMessage(arg)

// used for actions that are allowed even when extension has not finished loading
const sendAlways = <T extends BgActionObject, U = void>(arg: T): Promise<U> =>
  browser.runtime.sendMessage(arg)

const actions = {
  getState: (): Promise<State> =>
    sendAlways<GetStateActionObject, State>({
      type: BG_ACTION_KEYS.GET_STATE,
    }),
  getConfig: (): Promise<Config | null> =>
    send<GetConfigActionObject, Config>({
      type: BG_ACTION_KEYS.GET_CONFIG,
    }),
  resetConfig: () =>
    send<ResetConfigActionObject>({
      type: BG_ACTION_KEYS.RESET_CONFIG,
    }),
  saveConfig: (config: Partial<Config>) =>
    send<SaveConfigActionObject>({
      type: BG_ACTION_KEYS.SAVE_CONFIG,
      data: config,
    }),
  sendLog: (payload: LogEntryPayload) =>
    sendAlways<SendLogActionObject>({
      type: BG_ACTION_KEYS.SEND_LOG,
      data: payload,
    }),
  sendDebugCommand: (command: string, extraData?: string): Promise<unknown> =>
    send<SendDebugCommandActionObject, unknown>({
      type: BG_ACTION_KEYS.SEND_DEBUG_COMMAND,
      data: command,
      extraData,
    }),
  // sendAlways: the first report arrives at document_idle, while the service
  // worker may still be booting. Gated behind the loaded check it would be
  // dropped and never retried.
  reportOtpFields: (
    fields: DetectedOtpField[],
    overrideMissed: boolean,
    usedInputSelectors: string[],
  ) =>
    sendAlways<ReportOtpFieldsActionObject, ReportOtpFieldsResponse>({
      type: BG_ACTION_KEYS.REPORT_OTP_FIELDS,
      data: {
        fields,
        overrideMissed,
        scannedAt: Date.now(),
        usedInputSelectors,
      },
    }),

  // Sent by the content script. The url and frame come from the MessageSender,
  // so there is nothing here for a page to influence.
  openAutofillMenu: (fieldId: string): Promise<AutofillOfferSummary | null> =>
    send<OpenAutofillMenuActionObject, AutofillOfferSummary>({
      type: BG_ACTION_KEYS.OPEN_AUTOFILL_MENU,
      data: { fieldId },
    }),
  closeAutofillMenu: (token: string) =>
    send<CloseAutofillMenuActionObject>({
      type: BG_ACTION_KEYS.CLOSE_AUTOFILL_MENU,
      data: { token },
    }),
  // The two below are sent by the *menu iframe*, not by the content script.
  // That is the point of them: the reply reaches an extension document the
  // page cannot read into, so entry names never enter the page's realm.
  getMenuEntries: (token: string): Promise<ListedEntry[] | null> =>
    send<GetMenuEntriesActionObject, ListedEntry[]>({
      type: BG_ACTION_KEYS.GET_MENU_ENTRIES,
      data: { token },
    }),
  fillOtpField: (token: string, entryId: EntryId): Promise<FillResult | null> =>
    send<FillOtpFieldActionObject, FillResult>({
      type: BG_ACTION_KEYS.FILL_OTP_FIELD,
      data: { token, entryId },
    }),

  getVaultState: (): Promise<VaultSummary | null> =>
    send<GetVaultStateActionObject, VaultSummary>({
      type: BG_ACTION_KEYS.GET_VAULT_STATE,
    }),
  // The create/pair/unlock trio resolve a VaultActionResult rather than
  // rejecting, because a rejection across sendMessage arrives as a bare
  // "could not establish connection" string with the real reason -- a wrong
  // password, a weak one, a dead sync server -- lost on the way.
  createVault: (
    password: Password,
    mode: 'create' | 'connect',
  ): Promise<VaultActionResult | null> =>
    send<CreateVaultActionObject, VaultActionResult>({
      type: BG_ACTION_KEYS.CREATE_VAULT,
      data: { password, mode },
    }),
  pairDevice: (
    connectionString: string,
    deviceFriendlyName?: string,
  ): Promise<VaultActionResult | null> =>
    send<PairDeviceActionObject, VaultActionResult>({
      type: BG_ACTION_KEYS.PAIR_DEVICE,
      data: { connectionString, deviceFriendlyName },
    }),
  unlockVault: (password: Password): Promise<VaultActionResult | null> =>
    send<UnlockVaultActionObject, VaultActionResult>({
      type: BG_ACTION_KEYS.UNLOCK_VAULT,
      data: { password },
    }),
  lockVault: () =>
    send<LockVaultActionObject>({ type: BG_ACTION_KEYS.LOCK_VAULT }),
  resetVault: () =>
    send<ResetVaultActionObject>({ type: BG_ACTION_KEYS.RESET_VAULT }),
  listEntries: (query: string, url: string | null): Promise<EntryList | null> =>
    send<ListEntriesActionObject, EntryList>({
      type: BG_ACTION_KEYS.LIST_ENTRIES,
      data: { query, url },
    }),
  // Returns the code itself: the popup owns the clipboard write, because a
  // service worker has no navigator.clipboard.
  getToken: (entryId: EntryId): Promise<string | null> =>
    send<GetTokenActionObject, string>({
      type: BG_ACTION_KEYS.GET_TOKEN,
      data: { entryId },
    }),
  getPasswordStrength: (password: Password): Promise<PasswordStrength | null> =>
    send<GetPasswordStrengthActionObject, PasswordStrength>({
      type: BG_ACTION_KEYS.GET_PASSWORD_STRENGTH,
      data: { password },
    }),
  getFillTarget: (tabId: number): Promise<FillTarget | null> =>
    send<GetFillTargetActionObject, FillTarget>({
      type: BG_ACTION_KEYS.GET_FILL_TARGET,
      data: { tabId },
    }),
  /**
   * Fills the detected field with a code for one entry.
   *
   * `confirmed` answers one question and one only: the user has been shown the
   * frame this is going into and said yes. It is not a way past anything else.
   */
  fillDetectedField: (
    target: FillTarget,
    entryId: EntryId,
    confirmed = false,
  ): Promise<PopupFillResult | null> =>
    send<FillDetectedFieldActionObject, PopupFillResult>({
      type: BG_ACTION_KEYS.FILL_DETECTED_FIELD,
      data: { target, entryId, confirmed },
    }),
  /**
   * Accepts the offer a fill came back with.
   *
   * The url is the page's, echoed back from the offer rather than looked up
   * again: the site may well have submitted the form itself the moment the
   * code was complete, and the background re-derives everything else from it.
   */
  rememberEntrySite: (
    entryId: EntryId,
    url: string,
  ): Promise<VaultActionResult | null> =>
    send<RememberEntrySiteActionObject, VaultActionResult>({
      type: BG_ACTION_KEYS.REMEMBER_ENTRY_SITE,
      data: { entryId, url },
    }),
}

export default actions
