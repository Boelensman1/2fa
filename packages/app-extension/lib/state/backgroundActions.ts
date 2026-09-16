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
} from '../types'
import type { DetectedOtpField } from '../detect'

export const BG_ACTION_KEYS = {
  GET_STATE: 'GET_STATE' as const,
  GET_CONFIG: 'GET_CONFIG' as const,
  RESET_CONFIG: 'RESET_CONFIG' as const,
  SAVE_CONFIG: 'SAVE_CONFIG' as const,

  SEND_LOG: 'SEND_LOG' as const,
  SEND_DEBUG_COMMAND: 'SEND_DEBUG_COMMAND' as const,

  REPORT_OTP_FIELDS: 'REPORT_OTP_FIELDS' as const,
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
  reportOtpFields: (fields: DetectedOtpField[], overrideMissed: boolean) =>
    sendAlways<ReportOtpFieldsActionObject>({
      type: BG_ACTION_KEYS.REPORT_OTP_FIELDS,
      data: { fields, overrideMissed, scannedAt: Date.now() },
    }),
}

export default actions
