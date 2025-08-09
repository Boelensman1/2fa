/* eslint-disable no-console */
import { bgActions } from '../internals'
import type { LogEntryPayload } from '../types'

const LEVEL_TRACE = 10
const LEVEL_DEBUG = 20
const LEVEL_INFO = 30
const LEVEL_WARN = 40
const LEVEL_ERROR = 50

const BASE_OUTPUT_LEVEL = Number(
  import.meta.env.VITE_LOG_LEVEL ??
    (import.meta.env.MODE === 'development' ? LEVEL_DEBUG : LEVEL_WARN),
)
const ADD_TIMEINFO = false

const loggers: Logger[] = []

class Logger {
  private identifier: string
  outputLevel: number

  constructor(identifier: string) {
    this.identifier = identifier
    this.outputLevel = BASE_OUTPUT_LEVEL
    loggers.push(this)
  }

  setIdentifier(identifier: string) {
    this.identifier = identifier
  }

  inBackgroundScript(): boolean {
    // @ts-expect-error only valid when testing
    if (global.__vitest_environment__) {
      return true
    }
    return location.protocol.endsWith('-extension:')
  }

  outputEntryToConsole(entryData: LogEntryPayload) {
    const { identifier, level, msg, data, ts } = entryData
    if (level < this.outputLevel) {
      return
    }

    const timeInfo = ADD_TIMEINFO ? `${new Date(ts).toISOString()} - ` : ''
    const label = `${timeInfo}[${identifier}] ${msg}`
    if (data) {
      if (entryData.color) {
        console.groupCollapsed(`%c ${label}`, `color: ${entryData.color}`)
      } else {
        console.groupCollapsed(label)
      }
      console.log(JSON.parse(data))
      console.groupEnd()
      console.groupEnd()
    } else {
      if (entryData.color) {
        console.log(`%c ${label}`, `color: ${entryData.color}`)
      } else {
        console.log(label)
      }
    }
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  private sendLog(level: number, msg: string, data?: any, color?: string) {
    const payload: LogEntryPayload = {
      identifier: this.identifier,
      level,
      msg,
      data:
        data instanceof Error
          ? JSON.stringify(data, Object.getOwnPropertyNames(data)) // https://stackoverflow.com/a/26199752
          : JSON.stringify(data),
      ts: Date.now(),
      color,
    }

    if (this.inBackgroundScript()) {
      this.outputEntryToConsole(payload)
    } else {
      void bgActions.sendLog(payload)
    }
  }

  trace(msg: string, data?: any, color?: string) {
    this.sendLog(LEVEL_TRACE, msg, data, color)
  }
  debug(msg: string, data?: any, color?: string) {
    this.sendLog(LEVEL_DEBUG, msg, data, color)
  }
  info(msg: string, data?: any, color?: string) {
    this.sendLog(LEVEL_INFO, msg, data, color)
  }
  warn(msg: string, data?: any, color?: string) {
    this.sendLog(LEVEL_WARN, msg, data, color)
  }
  error(error: Error) {
    this.sendLog(LEVEL_ERROR, error.message, error)
  }
}

// for debug purposes, is used to set the level of all active loggers
export const getLoggers = () => loggers

export default Logger
