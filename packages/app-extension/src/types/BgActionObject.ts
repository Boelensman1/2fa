import type { BG_ACTION_KEYS } from '../internals'
import type { Config, LogEntryPayload } from '../types'

export interface ElementPickerData {
  selector: string
  html: string
  pageUrl: string
  promptResult: string
}

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

export type BgActionObject =
  | GetStateActionObject
  | GetConfigActionObject
  | ResetConfigActionObject
  | SaveConfigActionObject
  | SendLogActionObject
  | SendDebugCommandActionObject
